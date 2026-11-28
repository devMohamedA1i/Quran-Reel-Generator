import React, { useRef, useEffect, useState } from 'react';
import { formatTime, toArabicDigits } from '../data/i18n';
import { analyzeAudioWindow } from '../engine/audioEngine';

const NICE_STEPS = [
  0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function niceStep(raw) {
  for (const step of NICE_STEPS) {
    if (step >= raw) return step;
  }
  return NICE_STEPS[NICE_STEPS.length - 1];
}

function formatTick(t, step) {
  if (step < 1) {
    const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : 1;
    return `${t.toFixed(decimals)}s`;
  }
  return formatTime(t);
}

export default function TouchWaveform({
  peaks = [],
  pauses = [],
  timings = [],
  duration = 0,
  audioBuffer = null,
  audioUrl = '',
  contentLength = 0,
  startSec = 0,
  endSec = 0,
  playTime = 0,
  isPlaying = false,
  volume = 0.2,
  onChangeVolume,
  onTogglePlay,
  onStop,
  onChangeRange,
  onSeek,
  onSnapPause,
  onResetAudio,
  lang,
  t,
}) {
  const canvasRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [volOpen, setVolOpen] = useState(false);
  const [view, setView] = useState({ start: 0, span: 0 });
  const [detailWave, setDetailWave] = useState(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const panRef = useRef(null);

  useEffect(() => {
    setView({ start: 0, span: duration || 0 });
    setDetailWave(null);
  }, [duration, audioUrl]);

  const maxDur = Math.max(0.01, duration || 1);
  const winSpan = Math.max(Math.min(2, maxDur), Math.min(maxDur, view.span || maxDur));
  const winStart = Math.max(0, Math.min(maxDur - winSpan, view.start || 0));
  const winEnd = Math.min(maxDur, winStart + winSpan);

  // Fetch razor-sharp real MP3 peaks + real RMS silence pause boxes after pinch/zoom settles
  useEffect(() => {
    if (!duration || duration <= 0.1) return undefined;
    const isZoomed = winSpan < duration * 0.92;
    if (!isZoomed && !audioBuffer) {
      setDetailWave(null);
      return undefined;
    }
    // If already covered cleanly by current detailWave at high enough resolution, skip refetching
    if (
      !audioBuffer &&
      detailWave?.peaks?.length &&
      winStart >= detailWave.start &&
      winEnd <= detailWave.end &&
      (detailWave.end - detailWave.start) / Math.max(1, winSpan) <= 2.2
    ) {
      return undefined;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      analyzeAudioWindow({
        audioBuffer,
        audioUrl,
        contentLength,
        duration,
        winStart,
        winEnd,
        columns: 1200,
        signal: ctrl.signal,
      })
        .then((res) => {
          if (!ctrl.signal.aborted) setDetailWave(res || null);
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setDetailWave(null);
        });
    }, audioBuffer ? 40 : 420);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [audioBuffer, audioUrl, contentLength, duration, winStart, winEnd, winSpan]);

  const zoomBy = (factor, anchorSec = null) => {
    if (!duration) return;
    const center = anchorSec != null
      ? anchorSec
      : (playTime >= winStart && playTime <= winEnd ? playTime : (startSec + endSec) / 2);
    const ratio = winSpan > 0 ? clamp((center - winStart) / winSpan, 0, 1) : 0.5;
    const nextSpan = Math.max(Math.min(0.5, duration), Math.min(duration, winSpan * factor));
    const nextStart = Math.max(0, Math.min(duration - nextSpan, center - ratio * nextSpan));
    setView({ start: nextStart, span: nextSpan });
  };

  // Native non-passive wheel listener so hover + scroll zooms in/out on Mac & iPad trackpads (exact desktop WaveformEditor.jsx)
  const wheelStateRef = useRef({ winStart, winSpan, duration });
  wheelStateRef.current = { winStart, winSpan, duration };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      const { winStart: ws, winSpan: wsp, duration: dur } = wheelStateRef.current;
      if (!dur) return;
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const delta = ((e.deltaX || e.deltaY) / 400) * wsp;
        const nextStart = clamp(ws + delta, 0, Math.max(0, dur - wsp));
        setView((prev) => ({ ...prev, start: nextStart }));
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const anchor = ws + ratio * wsp;
      const limited = clamp(e.deltaY || 0, -120, 120);
      const step = e.ctrlKey || e.metaKey ? 0.01 : 0.0025;
      const minSp = Math.min(0.5, dur);
      const nextSpan = clamp(wsp * Math.exp(limited * step), minSp, dur);
      const nextStart = clamp(anchor - ratio * nextSpan, 0, Math.max(0, dur - nextSpan));
      setView({ start: nextStart, span: nextSpan });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(260, Math.round(rect.width));
    const rulerH = 26;
    const ayahH = 22;
    const waveH = 112;
    const totalH = rulerH + ayahH + waveH;

    // Only reallocate GPU canvas buffer when size actually changes (fixes iPhone Safari redraw lag!)
    const pixelW = Math.round(w * dpr);
    const pixelH = Math.round(totalH * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clean warm ivory canvas matching desktop WaveformEditor.jsx
    ctx.fillStyle = '#faf6ee';
    ctx.fillRect(0, 0, w, totalH);

    const xOf = (sec) => ((sec - winStart) / winSpan) * w;
    const topW = rulerH;
    const ayahTop = rulerH + waveH;

    // 1. Exact Desktop Top Time Ruler with minor, half-step, and major ticks + grid lines
    ctx.fillStyle = '#f1e9da';
    ctx.fillRect(0, 0, w, rulerH);
    ctx.strokeStyle = 'rgba(182, 144, 72, 0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rulerH - 0.5);
    ctx.lineTo(w, rulerH - 0.5);
    ctx.stroke();

    const step = niceStep(winSpan / (w < 460 ? 6 : 9));
    const halfStep = step / 2;
    const minor = step / 4;

    // Minor ruler ticks (quarter steps)
    ctx.strokeStyle = 'rgba(138, 121, 100, 0.34)';
    ctx.beginPath();
    for (let tTick = Math.ceil(winStart / minor) * minor; tTick <= winStart + winSpan + 1e-9; tTick += minor) {
      const x = Math.round(xOf(tTick)) + 0.5;
      ctx.moveTo(x, rulerH - 4);
      ctx.lineTo(x, rulerH);
    }
    ctx.stroke();

    // Half-step ticks + soft vertical guide line
    ctx.lineWidth = 1;
    for (let tTick = Math.ceil(winStart / halfStep) * halfStep; tTick <= winStart + winSpan + 1e-9; tTick += halfStep) {
      if (Math.abs(tTick / step - Math.round(tTick / step)) < 1e-6) continue;
      const x = Math.round(xOf(tTick)) + 0.5;
      ctx.strokeStyle = 'rgba(125, 97, 52, 0.42)';
      ctx.beginPath();
      ctx.moveTo(x, rulerH - 7);
      ctx.lineTo(x, rulerH);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(158, 126, 62, 0.08)';
      ctx.beginPath();
      ctx.moveTo(x, topW);
      ctx.lineTo(x, ayahTop);
      ctx.stroke();
    }

    // Major ruler ticks, labels, and subtle vertical grid lines
    ctx.font = '10.5px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'start';
    let lastTickRight = -999;
    for (let tTick = Math.ceil(winStart / step) * step; tTick <= winStart + winSpan + 1e-9; tTick += step) {
      const x = Math.round(xOf(tTick)) + 0.5;
      ctx.strokeStyle = 'rgba(125, 97, 52, 0.55)';
      ctx.beginPath();
      ctx.moveTo(x, rulerH - 10);
      ctx.lineTo(x, rulerH);
      ctx.stroke();

      const label = formatTick(tTick, step);
      const textWidth = ctx.measureText(label).width;
      const lx = clamp(x - textWidth / 2, 2, Math.max(2, w - textWidth - 2));
      if (lx >= lastTickRight + 6) {
        ctx.strokeStyle = 'rgba(158, 126, 62, 0.14)';
        ctx.beginPath();
        ctx.moveTo(x, topW);
        ctx.lineTo(x, ayahTop);
        ctx.stroke();

        ctx.fillStyle = '#5c4c38';
        ctx.fillText(label, lx, 4);
        lastTickRight = lx + textWidth;
      }
    }

    // 2. Symmetrical Waveform body in the middle (exact desktop WaveformEditor.jsx)
    const sx = xOf(startSec);
    const ex = xOf(endSec);

    // Selected range highlight in warm orange
    if (endSec > startSec) {
      const cx1 = Math.max(0, sx);
      const cx2 = Math.min(w, ex);
      if (cx2 > cx1) {
        ctx.fillStyle = 'rgba(255, 145, 0, 0.17)';
        ctx.fillRect(cx1, topW, cx2 - cx1, waveH);
      }
    }

    const hasDetail = Boolean(
      detailWave?.peaks?.length &&
      detailWave.end > winStart &&
      detailWave.start < winEnd
    );
    const activePauses = hasDetail && detailWave.pauses?.length ? detailWave.pauses : pauses;
    const dStart = hasDetail ? detailWave.start : 0;
    const dSpan = hasDetail ? Math.max(0.01, detailWave.end - detailWave.start) : 1;

    // Quiet pause bands in soft sky blue
    ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
    for (const p of activePauses) {
      if (p.end < winStart || p.start > winEnd) continue;
      const px1 = Math.max(0, xOf(p.start));
      const px2 = Math.min(w, xOf(p.end));
      if (px2 - px1 < 3) continue;
      ctx.fillRect(px1, topW, px2 - px1, waveH);
    }

    // Center line
    const midY = topW + waveH / 2;
    ctx.strokeStyle = 'rgba(138, 121, 100, 0.22)';
    ctx.beginPath();
    ctx.moveTo(0, Math.round(midY) + 0.5);
    ctx.lineTo(w, Math.round(midY) + 0.5);
    ctx.stroke();

    // Crisp pointy diamond-tip sky-blue (#38a3e8) waveform spikes matching desktop app
    // Uses real detailWave inside its decoded range and seamlessly falls back to overview peaks outside it (never empty!)
    if (peaks.length || hasDetail) {
      const stepPx = 2.5;
      const barW = 1.5;
      const halfW = barW / 2;
      const amplitude = waveH * 0.42;
      ctx.fillStyle = '#38a3e8';
      for (let x = 0; x < w; x += stepPx) {
        const sec = winStart + (x / w) * winSpan;
        let symRaw = 0;
        if (hasDetail && sec >= detailWave.start && sec <= detailWave.end) {
          const dRel = (sec - dStart) / dSpan;
          const dIdx = Math.min(detailWave.peaks.length - 1, Math.max(0, Math.floor(dRel * detailWave.peaks.length)));
          const pair = detailWave.peaks[dIdx];
          if (!pair) continue;
          const rawLo = Array.isArray(pair) ? Math.abs(pair[0]) : Math.abs(pair || 0);
          const rawHi = Array.isArray(pair) ? Math.abs(pair[1]) : Math.abs(pair || 0);
          symRaw = (rawLo + rawHi) * 0.5;
        } else if (peaks.length) {
          // Smoothly interpolate overview peaks + natural vocal spike texture so zooming NEVER shows flat blue boxes!
          const fIdx = clamp((sec / maxDur) * (peaks.length - 1), 0, peaks.length - 1);
          const i0 = Math.floor(fIdx);
          const i1 = Math.min(peaks.length - 1, i0 + 1);
          const frac = fIdx - i0;
          const p0 = peaks[i0];
          const p1 = peaks[i1];
          const a0 = Array.isArray(p0) ? (Math.abs(p0[0]) + Math.abs(p0[1])) * 0.5 : Math.abs(p0 || 0);
          const a1 = Array.isArray(p1) ? (Math.abs(p1[0]) + Math.abs(p1[1])) * 0.5 : Math.abs(p1 || 0);
          const env = a0 + (a1 - a0) * frac;
          const tex = 0.58 + 0.42 * Math.abs(Math.sin(sec * 7.3) * Math.cos(sec * 3.1));
          symRaw = env > 0.08 ? env * tex : env;
        } else {
          continue;
        }

        const edgeSec = Math.min(maxDur * 0.04, Math.max(0.5, winSpan * 0.025));
        const edgeEnv = Math.sin((Math.min(clamp(sec / edgeSec, 0, 1), clamp((maxDur - sec) / edgeSec, 0, 1)) * Math.PI) / 2);
        const barH = Math.pow(clamp(symRaw, 0, 1), 1.45) * amplitude * edgeEnv;

        const yTop = midY - Math.max(0.5, barH);
        const yBot = midY + Math.max(0.5, barH);
        const tip = Math.min(3, (yBot - yTop) * 0.25);

        ctx.beginPath();
        ctx.moveTo(x, yTop);
        ctx.lineTo(x + halfW, yTop + tip);
        ctx.lineTo(x + halfW, yBot - tip);
        ctx.lineTo(x, yBot);
        ctx.lineTo(x - halfW, yBot - tip);
        ctx.lineTo(x - halfW, yTop + tip);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Quiet gap outlines on top of waveform (exact Mac app sky-blue pause boxes)
    ctx.strokeStyle = 'rgba(34, 158, 194, 0.52)';
    ctx.lineWidth = 1;
    for (const p of activePauses) {
      if (p.end < winStart || p.start > winEnd) continue;
      const px1 = Math.max(0, xOf(p.start));
      const px2 = Math.min(w, xOf(p.end));
      if (px2 - px1 < 4) continue;
      ctx.strokeRect(Math.round(px1) + 0.5, topW + 0.5, px2 - px1 - 1, waveH - 1);
    }

    // 3. Dedicated bottom Ayah number bar (numbers only — exact desktop WaveformEditor.jsx, never "Basmala")
    ctx.fillStyle = '#f1e9da';
    ctx.fillRect(0, ayahTop, w, ayahH);
    ctx.strokeStyle = 'rgba(182, 144, 72, 0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ayahTop + 0.5);
    ctx.lineTo(w, ayahTop + 0.5);
    ctx.stroke();

    if (timings?.length) {
      const numbered = timings.filter((e) => Number(e.ayah) > 0 && e.start >= winStart - 5 && e.start <= winEnd + 5);
      const activeAyah = numbered.find((a) => playTime >= a.start && playTime <= a.end)?.ayah ?? null;
      const showGuideLines = numbered.length > 0 && w / numbered.length >= 32;
      let lastLabelX = -999;
      ctx.font = '11px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'start';
      ctx.textBaseline = 'middle';

      for (const entry of numbered) {
        const x = Math.round(xOf(entry.start)) + 0.5;
        const isCurrent = entry.ayah === activeAyah;

        if (showGuideLines || isCurrent) {
          ctx.strokeStyle = isCurrent ? 'rgba(196, 138, 36, 0.95)' : 'rgba(138, 121, 100, 0.30)';
          ctx.lineWidth = isCurrent ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x, topW);
          ctx.lineTo(x, ayahTop + 5);
          ctx.stroke();
        } else if (x - lastLabelX > 28) {
          ctx.strokeStyle = 'rgba(138, 121, 100, 0.42)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, ayahTop);
          ctx.lineTo(x, ayahTop + 5);
          ctx.stroke();
        }

        if (x - lastLabelX > 28) {
          ctx.fillStyle = isCurrent ? '#8f5e0c' : '#5c4c38';
          const numTxt = lang === 'ar' ? toArabicDigits(entry.ayah) : String(entry.ayah);
          ctx.fillText(numTxt, x + 4, ayahTop + ayahH / 2 + 0.5);
          lastLabelX = x;
        }
      }
    }

    // Start (sage S) & End (orange E) handles — exact desktop style
    const drawHandle = (x, color, tag) => {
      if (x < -12 || x > w + 12) return;
      const rx = Math.round(clamp(x, 1, w - 1)) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(rx, topW);
      ctx.lineTo(rx, totalH);
      ctx.stroke();

      const pw = 18;
      const ph = 16;
      const px = clamp(x - pw / 2, 1, w - pw - 1);
      const py = topW + 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, px + pw / 2, py + ph / 2 + 0.5);
      ctx.textAlign = 'start';
    };
    if (endSec > startSec) {
      drawHandle(sx, '#5b7846', 'S');
      drawHandle(ex, '#ff8800', 'E');
    }

    // Playhead with crisp umber triangle pointer (exact desktop WaveformEditor.jsx)
    if (playTime >= winStart && playTime <= winEnd) {
      const px = xOf(playTime);
      ctx.strokeStyle = '#382b1d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, topW);
      ctx.lineTo(px, totalH);
      ctx.stroke();

      ctx.fillStyle = '#382b1d';
      ctx.beginPath();
      ctx.moveTo(px - 6, topW);
      ctx.lineTo(px + 6, topW);
      ctx.lineTo(px, topW + 8);
      ctx.closePath();
      ctx.fill();
    }
  }, [peaks, pauses, detailWave, timings, duration, startSec, endSec, playTime, winStart, winSpan, winEnd, maxDur, lang]);

  const timeFromClientX = (clientX) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !duration) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return winStart + ratio * winSpan;
  };

  const handlePointerDown = (e) => {
    if (!duration) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // Two-finger pinch-to-zoom on touchscreens
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const midX = (pts[0].x + pts[1].x) / 2;
      const rect = canvasRef.current?.getBoundingClientRect();
      const ratio = rect ? clamp((midX - rect.left) / rect.width, 0, 1) : 0.5;
      pinchRef.current = {
        dist,
        startSpan: winSpan,
        anchor: winStart + ratio * winSpan,
        ratio,
      };
      setDragging(null);
      panRef.current = null;
      return;
    }

    const tSec = timeFromClientX(e.clientX);
    const dStart = Math.abs(tSec - startSec);
    const dEnd = Math.abs(tSec - endSec);
    const tol = Math.max(0.8, winSpan * 0.08);
    if (dStart <= tol && dStart <= dEnd) {
      setDragging('start');
      panRef.current = null;
    } else if (dEnd <= tol) {
      setDragging('end');
      panRef.current = null;
    } else {
      panRef.current = { x: e.clientX, startAtDown: winStart, moved: false };
    }
  };

  const handlePointerMove = (e) => {
    if (!duration) return;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Active two-finger pinch zoom
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const scale = pinchRef.current.dist / dist;
      const minSp = Math.min(0.5, duration);
      const nextSpan = clamp(pinchRef.current.startSpan * scale, minSp, duration);
      const nextStart = clamp(
        pinchRef.current.anchor - pinchRef.current.ratio * nextSpan,
        0,
        Math.max(0, duration - nextSpan)
      );
      setView({ start: nextStart, span: nextSpan });
      return;
    }

    if (dragging) {
      const tSec = timeFromClientX(e.clientX);
      if (dragging === 'start') {
        onChangeRange(Math.max(0, Math.min(endSec - 1.0, tSec)), endSec);
      } else if (dragging === 'end') {
        onChangeRange(startSec, Math.min(duration, Math.max(startSec + 1.0, tSec)));
      }
      return;
    }

    if (panRef.current) {
      const dx = e.clientX - panRef.current.x;
      if (Math.abs(dx) > 5) panRef.current.moved = true;
      if (panRef.current.moved && winSpan < duration) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const dt = -(dx / rect.width) * winSpan;
          const nextStart = clamp(panRef.current.startAtDown + dt, 0, Math.max(0, duration - winSpan));
          setView((prev) => ({ ...prev, start: nextStart }));
        }
      }
    }
  };

  const handlePointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (panRef.current) {
      if (!panRef.current.moved && duration) {
        const tSec = timeFromClientX(e.clientX);
        onSeek?.(clamp(tSec, 0, duration));
      }
      panRef.current = null;
    }
    setDragging(null);
  };

  const handleMarkStart = () => {
    if (!duration) return;
    const next = Math.max(0, Math.min(endSec - 1.0, playTime));
    onChangeRange(next, endSec);
  };

  const handleMarkEnd = () => {
    if (!duration) return;
    const next = Math.min(duration, Math.max(startSec + 1.0, playTime));
    onChangeRange(startSec, next);
  };

  // Exact port of desktop WaveformEditor.jsx handleSnap():
  // Moves playhead to the nearest pause boundary/midpoint from active pauses (or zoomed detailWave pauses).
  const handleSnapLocal = () => {
    const srcPauses = detailWave?.pauses?.length ? detailWave.pauses : pauses;
    if (!srcPauses?.length) return;
    const candidates = [];
    for (const p of srcPauses) {
      candidates.push(p.start, p.end, (p.start + p.end) / 2);
    }
    candidates.sort((a, b) => Math.abs(a - playTime) - Math.abs(b - playTime));
    const target = candidates[0];
    if (target != null) {
      onSeek?.(clamp(target, 0, duration));
    }
  };

  return (
    <div className="mac-card wf-card">
      {/* Exact Mac App Compact Audio Player Bar: Play + Left-aligned Time + Circular Volume */}
      <div className="wf-player-top" dir="ltr">
        <button
          type="button"
          className={`wf-play-btn ${isPlaying ? 'is-playing' : ''}`}
          onClick={onTogglePlay}
          disabled={!duration}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="5" y="4" width="5" height="16" rx="1.5" />
              <rect x="14" y="4" width="5" height="16" rx="1.5" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }} aria-hidden="true">
              <path d="M6 4.5L20 12L6 19.5V4.5Z" />
            </svg>
          )}
        </button>

        <div className="wf-top-time">
          {formatTime(playTime)} / {formatTime(duration)}
        </div>

        <div className={`wf-vol-wrap ${volOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="wf-vol-btn"
            onClick={() => setVolOpen((v) => !v)}
            aria-label="Volume"
          >
            {volume === 0 ? '🔇' : '🔊'}
          </button>
          {volOpen && (
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              style={{ '--vol-pct': `${Math.round(volume * 100)}%` }}
              onChange={(e) => onChangeVolume?.(Number(e.target.value))}
              className="wf-vol-slider"
              aria-label="Audio volume"
            />
          )}
        </div>
      </div>

      {/* Exact Original Full Surah Seek Rail (delicate ticks + gold fill + champagne thumb) */}
      <div className="wf-full-rail-wrap" dir="ltr">
        <div className="wf-rail-label">{t.fullSurah}</div>
        <div
          className="wf-rail wf-full-rail"
          style={{ '--seek-pct': `${duration > 0 ? clamp((playTime / duration) * 100, 0, 100) : 0}%` }}
        >
          <span className="wf-full-fill" aria-hidden="true" />
          <input
            type="range"
            className="wf-full-seek"
            min={0}
            max={Math.max(0.1, duration)}
            step={0.1}
            value={Math.min(duration || 0, playTime)}
            disabled={!duration}
            onChange={(e) => onSeek?.(Number(e.target.value))}
            aria-label="Seek full Surah"
          />
        </div>
        <div className="wf-rail-times">
          <span>{formatTime(playTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Symmetrical Waveform Canvas */}
      <div className="wf-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="wf-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={(e) => {
            e.preventDefault();
            zoomBy(0.35, timeFromClientX(e.clientX));
          }}
        />
      </div>

      {/* Mac App Action Buttons: 1 single row on wide screens; balanced 2 + 3 rows on phone */}
      <div className="wf-btn-group" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="wf-btn-row wf-btn-row-marks">
          <button type="button" className="wf-act-btn wf-mark-start" onClick={handleMarkStart} disabled={!duration}>
            <span className="wf-badge is-s">S</span>
            <span className="wf-mark-label">{t.startTime}</span>
            <span className="wf-mark-time" dir="ltr">{formatTime(startSec)}</span>
          </button>
          <button type="button" className="wf-act-btn wf-mark-end" onClick={handleMarkEnd} disabled={!duration}>
            <span className="wf-mark-label">{t.endTime}</span>
            <span className="wf-mark-time" dir="ltr">{formatTime(endSec)}</span>
            <span className="wf-badge is-e">E</span>
          </button>
        </div>
        <div className="wf-btn-row wf-btn-row-tools">
          <button type="button" className="wf-act-btn wf-stop-btn" onClick={onStop} disabled={!duration}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
            <span>{t.stop}</span>
          </button>
          <button type="button" className="wf-act-btn" onClick={() => zoomBy(0.55)} disabled={!duration} aria-label="Zoom In">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="M14.5 14.5L21 21M7 10h6M10 7v6" /></svg>
            <span>{t.zoomIn}</span>
          </button>
          <button type="button" className="wf-act-btn" onClick={() => zoomBy(1.75)} disabled={!duration} aria-label="Zoom Out">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="M14.5 14.5L21 21M7 10h6" /></svg>
            <span>{t.zoomOut}</span>
          </button>
        </div>
      </div>

      {/* Mac App Action Buttons Row 2: Snap to closest Pause | Reset Audio */}
      <div className="wf-btn-row wf-btn-row-sub" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <button
          type="button"
          className="wf-act-btn"
          onClick={handleSnapLocal}
          disabled={!(detailWave?.pauses?.length || pauses.length)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 1 7 7" /><path d="M8 19h4v-4" /></svg>
          <span>{t.snapPause}</span>
        </button>
        <button type="button" className="wf-act-btn" onClick={onResetAudio} disabled={!duration}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v5h5" /></svg>
          <span>{t.resetAudio}</span>
        </button>
      </div>
    </div>
  );
}
