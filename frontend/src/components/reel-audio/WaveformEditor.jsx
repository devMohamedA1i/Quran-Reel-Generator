import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useI18n } from '../../context/I18nContext';
import { api } from '../../services/api';

const WAVE = {
  columns: 1600,
  height: 240,
  rulerHeight: 26,
  ayahBarHeight: 24,
  minSpan: 0.05,
  sensitivity: {
    strict: { threshold: -28, minSilence: 0.25 },
    normal: { threshold: -20, minSilence: 0.18 },
    loose: { threshold: -14, minSilence: 0.12 },
  },
};

const NICE_STEPS = [
  0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function fmt(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
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
  return fmt(t);
}

function formatSpan(span) {
  if (span < 1) return `${Math.round(span * 1000)} ms`;
  if (span < 60) return `${span.toFixed(span < 10 ? 2 : 1)} s`;
  const minutes = Math.floor(span / 60);
  const seconds = Math.round(span - minutes * 60);
  return `${minutes} m ${String(seconds).padStart(2, '0')} s`;
}

export default function WaveformEditor({
  surah,
  sourceId,
  reel,
  surahDuration,
  ayahs,
  timingAvailable,
  onSaveRange,
  onResetAudio,
  onRepropose,
}) {
  const { t } = useI18n();
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const reqIdRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.2);
  const [volOpen, setVolOpen] = useState(false);
  const [hoverEdge, setHoverEdge] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sensitivity, setSensitivity] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState(null);

  const maxDur = Math.max(surahDuration || 0, reel ? Number(reel.audio_end) : 0, 0.001);
  const minSpan = Math.min(WAVE.minSpan, maxDur);

  const [view, setView] = useState({ start: 0, span: maxDur });
  const [waveData, setWaveData] = useState({ peaks: [], pauses: [], loaded: null });

  const start = reel ? Number(reel.audio_start) : 0;
  const end = reel ? Number(reel.audio_end) : maxDur;

  const [selStart, setSelStart] = useState(start);
  const [selEnd, setSelEnd] = useState(end);

  useEffect(() => {
    setView({ start: 0, span: maxDur });
  }, [surah, sourceId, maxDur]);

  useEffect(() => {
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      try {
        audioRef.current.currentTime = 0;
      } catch {
        // metadata not ready yet
      }
    }
  }, [surah, sourceId]);

  // Apply default and updated volume to the audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = volume === 0;
  }, [volume, surah, sourceId]);

  useEffect(() => {
    if (!reel) return;
    const s = Number(reel.audio_start);
    const e = Number(reel.audio_end);
    setSelStart(s);
    setSelEnd(e);
    setCurrentTime(s);
    setNotice('');
    setError('');
    setPendingConfirm(null);
    if (audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      try {
        audioRef.current.currentTime = s;
      } catch {
        // metadata not ready yet
      }
    }
  }, [reel?.reel, reel?.audio_start, reel?.audio_end, surah, sourceId]);

  const winSpan = clamp(view.span || maxDur, minSpan, maxDur);
  const winStart = clamp(view.start || 0, 0, Math.max(0, maxDur - winSpan));
  const winEnd = Math.min(maxDur, winStart + winSpan);

  // Fetch exact interleaved [min, max] peaks and quiet gaps from Flask
  useEffect(() => {
    let cancelled = false;
    if (!surah || maxDur <= 0.01) return () => {};
    const cfg = WAVE.sensitivity[sensitivity] || WAVE.sensitivity.normal;
    const reqId = ++reqIdRef.current;

    const timer = setTimeout(() => {
      api
        .getWaveform(
          surah,
          {
            start: winStart,
            end: winEnd,
            columns: WAVE.columns,
            threshold: cfg.threshold,
            minSilence: cfg.minSilence,
          },
          sourceId
        )
        .then((data) => {
          if (cancelled || reqId !== reqIdRef.current) return;
          setWaveData({
            peaks: data.peaks || [],
            pauses: data.pauses || [],
            loaded: {
              start: winStart,
              end: winEnd,
              columns: data.columns || WAVE.columns,
            },
          });
        })
        .catch(() => {
          if (!cancelled && reqId === reqIdRef.current) {
            setNotice(t('waveformLoadFailed'));
          }
        });
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [surah, sourceId, winStart, winEnd, maxDur, sensitivity]);

  const activeAyahObj = ayahs?.find((a) => currentTime >= a.start && currentTime <= a.end);
  const currentAyahNum = activeAyahObj?.ayah ?? null;

  // Exact drawWaveform() ported from before Antigravity/Quran Reel Generator/static/reel_planner.js
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width || canvas.width / dpr));
    const height = WAVE.height;

    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Clean warm ivory canvas matching banner theme (so orange highlight is pure orange, never brown)
    ctx.fillStyle = '#faf6ee';
    ctx.fillRect(0, 0, width, height);

    const vStart = winStart;
    const span = Math.max(0.001, winSpan);
    const ruler = WAVE.rulerHeight;
    const ayahBar = WAVE.ayahBarHeight;
    const waveTop = ruler;
    const waveHeight = height - ruler - ayahBar;
    const ayahBarTop = waveTop + waveHeight;
    const mid = waveTop + waveHeight / 2;
    const toX = (t) => ((t - vStart) / span) * width;

    const loaded = waveData.loaded;
    const dx = loaded ? ((loaded.start - vStart) / span) * width : 0;
    const loadedSpan = loaded ? Math.max(0.001, loaded.end - loaded.start) : span;
    const loadedScale = loaded ? (loadedSpan / span) * width : width;

    // ruler band
    ctx.fillStyle = '#f1e9da';
    ctx.fillRect(0, 0, width, ruler);
    ctx.strokeStyle = 'rgba(182, 144, 72, 0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ruler - 0.5);
    ctx.lineTo(width, ruler - 0.5);
    ctx.stroke();

    const step = niceStep(span / 9);
    const halfStep = step / 2;
    const minor = step / 4;

    // minor ruler ticks (quarter steps)
    ctx.strokeStyle = 'rgba(138, 121, 100, 0.34)';
    ctx.beginPath();
    for (let t = Math.ceil(vStart / minor) * minor; t <= vStart + span; t += minor) {
      const x = Math.round(toX(t)) + 0.5;
      ctx.moveTo(x, ruler - 4);
      ctx.lineTo(x, ruler);
    }
    ctx.stroke();

    // half-step ticks (e.g. 15 min between 30 min marks) + thinner/softer vertical guide line
    ctx.lineWidth = 1;
    for (let t = Math.ceil(vStart / halfStep) * halfStep; t <= vStart + span + 1e-9; t += halfStep) {
      // Skip major step positions (drawn below)
      if (Math.abs((t / step) - Math.round(t / step)) < 1e-6) continue;
      const x = Math.round(toX(t)) + 0.5;
      ctx.strokeStyle = 'rgba(125, 97, 52, 0.42)';
      ctx.beginPath();
      ctx.moveTo(x, ruler - 7);
      ctx.lineTo(x, ruler);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(158, 126, 62, 0.08)';
      ctx.beginPath();
      ctx.moveTo(x, waveTop);
      ctx.lineTo(x, ayahBarTop);
      ctx.stroke();
    }

    // major ruler ticks, labels, and subtle vertical grid lines (skip overlapping labels cleanly)
    ctx.font = '11px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'top';
    let lastTickRight = -999;
    for (let t = Math.ceil(vStart / step) * step; t <= vStart + span + 1e-9; t += step) {
      const x = Math.round(toX(t)) + 0.5;
      ctx.strokeStyle = 'rgba(125, 97, 52, 0.55)';
      ctx.beginPath();
      ctx.moveTo(x, ruler - 10);
      ctx.lineTo(x, ruler);
      ctx.stroke();

      const label = formatTick(t, step);
      const textWidth = ctx.measureText(label).width;
      const lx = clamp(x - textWidth / 2, 2, Math.max(2, width - textWidth - 2));
      if (lx >= lastTickRight + 6) {
        // Subtle vertical grid line through waveform aligned with each visible timestamp
        ctx.strokeStyle = 'rgba(158, 126, 62, 0.14)';
        ctx.beginPath();
        ctx.moveTo(x, waveTop);
        ctx.lineTo(x, ayahBarTop);
        ctx.stroke();

        ctx.fillStyle = '#5c4c38';
        ctx.fillText(label, lx, 6);
        lastTickRight = lx + textWidth;
      }
    }

    // Selected start-to-end range highlighted in pure orange
    if (reel && selEnd > selStart) {
      const x1 = toX(selStart);
      const x2 = toX(selEnd);
      if (x2 > 0 && x1 < width) {
        const clampedX1 = Math.max(0, x1);
        const clampedX2 = Math.min(width, x2);
        ctx.fillStyle = 'rgba(255, 145, 0, 0.17)';
        ctx.fillRect(clampedX1, waveTop, clampedX2 - clampedX1, waveHeight);
      }
    }

    // quiet gaps behind the waveform
    if (loaded) {
      for (const pause of waveData.pauses) {
        const x1 = dx + ((pause.start - loaded.start) / loadedSpan) * loadedScale;
        const x2 = dx + ((pause.end - loaded.start) / loadedSpan) * loadedScale;
        if (x2 < 0 || x1 > width) continue;
        if (x2 - x1 < 3) continue;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.fillRect(x1, waveTop, x2 - x1, waveHeight);
      }
    }

    // centre line
    ctx.strokeStyle = 'rgba(138, 121, 100, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(mid) + 0.5);
    ctx.lineTo(width, Math.round(mid) + 0.5);
    ctx.stroke();

    // pro waveform — crisp pointy vertical spikes with natural dynamic taper (never flat-cropped)
    const peaks = waveData.peaks;
    if (loaded && peaks.length > 3) {
      const columns = Math.min(loaded.columns || Math.floor(peaks.length / 2), Math.floor(peaks.length / 2));
      const columnWidth = loadedScale / columns;
      const amplitude = waveHeight * 0.42;

      // Sample into crisp ~2.5px-spaced bars with natural power curve so peaks stay pointy
      const stepPx = 2.5;
      const barW = 1.5;
      const startCol = Math.max(0, Math.floor((0 - dx) / columnWidth));
      const endCol = Math.min(columns - 1, Math.ceil((width - dx) / columnWidth));
      const colsPerBar = Math.max(1, stepPx / Math.max(0.001, columnWidth));

      ctx.fillStyle = '#38a3e8';
      for (let c = startCol; c <= endCol; c += colsPerBar) {
        const i0 = Math.floor(c);
        const i1 = Math.min(columns - 1, Math.max(i0, Math.floor(c + colsPerBar) - 1));
        let sumPos = 0;
        let sumNeg = 0;
        let maxPos = 0;
        let maxNeg = 0;
        let count = 0;
        for (let i = i0; i <= i1; i++) {
          const p = Math.max(0, peaks[i * 2 + 1] / 32768);
          const n = Math.max(0, -peaks[i * 2] / 32768);
          sumPos += p;
          sumNeg += n;
          if (p > maxPos) maxPos = p;
          if (n > maxNeg) maxNeg = n;
          count++;
        }
        // Blend peak & mean with power curve so loud passages keep sharp pointy contours
        const rawPos = count ? (maxPos * 0.55 + (sumPos / count) * 0.45) : 0;
        const rawNeg = count ? (maxNeg * 0.55 + (sumNeg / count) * 0.45) : 0;
        const x = dx + (c + colsPerBar * 0.5) * columnWidth;
        if (x < -barW || x > width + barW) continue;

        // Smooth taper from/to centre line at the very start and end of the Surah
        const barTime = vStart + (x / width) * span;
        const edgeSec = Math.min(maxDur * 0.04, Math.max(0.5, span * 0.025));
        const startFade = clamp(barTime / edgeSec, 0, 1);
        const endFade = clamp((maxDur - barTime) / edgeSec, 0, 1);
        const edgeEnv = Math.sin((Math.min(startFade, endFade) * Math.PI) / 2);

        // Symmetrical amplitude cancels out DC offset in older studio/tape recordings
        const symRaw = (rawPos + rawNeg) * 0.5;
        const barH = Math.pow(clamp(symRaw, 0, 1), 1.45) * amplitude * edgeEnv;

        const halfW = barW / 2;
        const yTop = mid - Math.max(0.5, barH);
        const yBot = mid + Math.max(0.5, barH);
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

    // quiet gap outlines on top of the waveform
    if (loaded) {
      ctx.strokeStyle = 'rgba(34, 158, 194, 0.52)';
      ctx.lineWidth = 1;
      for (const pause of waveData.pauses) {
        const x1 = dx + ((pause.start - loaded.start) / loadedSpan) * loadedScale;
        const x2 = dx + ((pause.end - loaded.start) / loadedSpan) * loadedScale;
        if (x2 < 0 || x1 > width) continue;
        if (x2 - x1 < 4) continue;
        ctx.strokeRect(
          Math.round(x1) + 0.5,
          waveTop + 0.5,
          x2 - x1 - 1,
          waveHeight - 1
        );
      }
    }

    // Dedicated bottom Ayah number bar (outside waveform, matching top time ruler)
    ctx.fillStyle = '#f1e9da';
    ctx.fillRect(0, ayahBarTop, width, ayahBar);
    ctx.strokeStyle = 'rgba(182, 144, 72, 0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ayahBarTop + 0.5);
    ctx.lineTo(width, ayahBarTop + 0.5);
    ctx.stroke();

    // Ayah markers (show vertical guide lines only when zoomed in enough that they aren't crowded)
    if (ayahs?.length) {
      const visible = ayahs.filter((e) => e.start >= vStart - 5 && e.start <= vStart + span + 5);
      const showGuideLines = visible.length > 0 && (width / visible.length) >= 32;
      let lastLabelX = -999;
      ctx.font = '11px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'middle';

      for (const entry of visible) {
        const x = Math.round(toX(entry.start)) + 0.5;
        const isCurrent = entry.ayah === currentAyahNum;

        if (showGuideLines || isCurrent) {
          ctx.strokeStyle = isCurrent
            ? 'rgba(196, 138, 36, 0.95)'
            : 'rgba(138, 121, 100, 0.30)';
          ctx.lineWidth = isCurrent ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x, waveTop);
          ctx.lineTo(x, ayahBarTop + 5);
          ctx.stroke();
        } else if (x - lastLabelX > 28) {
          ctx.strokeStyle = 'rgba(138, 121, 100, 0.42)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, ayahBarTop);
          ctx.lineTo(x, ayahBarTop + 5);
          ctx.stroke();
        }

        if (x - lastLabelX > 28) {
          ctx.fillStyle = isCurrent ? '#8f5e0c' : '#5c4c38';
          ctx.fillText(String(entry.ayah), x + 4, ayahBarTop + ayahBar / 2 + 0.5);
          lastLabelX = x;
        }
      }
    }

    // Draggable Start (sage S) & End (orange E) boundary lines + matching top pill handles
    if (reel && selEnd > selStart) {
      const drawBoundary = (timeSec, tag, isActive, color, activeColor) => {
        const x = toX(timeSec);
        if (x < -12 || x > width + 12) return;
        const rx = Math.round(x) + 0.5;
        ctx.strokeStyle = isActive ? activeColor : color;
        ctx.lineWidth = isActive ? 3 : 2.2;
        ctx.beginPath();
        ctx.moveTo(rx, waveTop);
        ctx.lineTo(rx, height);
        ctx.stroke();

        // Rounded handle pill at top of boundary
        const pw = 18;
        const ph = 16;
        const px = clamp(x - pw / 2, 1, width - pw - 1);
        const py = waveTop + 2;
        ctx.fillStyle = isActive ? activeColor : color;
        ctx.beginPath();
        ctx.roundRect(px, py, pw, ph, 5);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, px + pw / 2, py + ph / 2 + 0.5);
        ctx.textAlign = 'start';
      };

      drawBoundary(selStart, 'S', hoverEdge === 'start', '#5b7846', '#445c33');
      drawBoundary(selEnd, 'E', hoverEdge === 'end', '#ff8800', '#ff6a00');
    }

    // playhead with crisp umber triangle pointer
    const px = toX(currentTime);
    if (px >= -1 && px <= width + 1) {
      ctx.strokeStyle = '#382b1d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, waveTop);
      ctx.lineTo(px, height);
      ctx.stroke();

      ctx.fillStyle = '#382b1d';
      ctx.beginPath();
      ctx.moveTo(px - 7, waveTop);
      ctx.lineTo(px + 7, waveTop);
      ctx.lineTo(px, waveTop + 9);
      ctx.closePath();
      ctx.fill();
    }
  }, [waveData, ayahs, currentAyahNum, winStart, winSpan, reel, selStart, selEnd, currentTime, hoverEdge]);

  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  useEffect(() => {
    const onResize = () => drawWaveform();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drawWaveform]);

  const setSpan = useCallback(
    (nextSpan, anchorTime = currentTime) => {
      const clampedSpan = clamp(nextSpan, minSpan, maxDur);
      const ratio =
        winEnd > winStart
          ? clamp((anchorTime - winStart) / (winEnd - winStart), 0, 1)
          : 0.5;
      const nextStart = clamp(
        anchorTime - ratio * clampedSpan,
        0,
        Math.max(0, maxDur - clampedSpan)
      );
      setView({ start: nextStart, span: clampedSpan });
    },
    [currentTime, minSpan, maxDur, winStart, winEnd]
  );

  const zoomIn = () => setSpan(winSpan / 2);
  const zoomOut = () => setSpan(winSpan * 2);
  const fitView = () => {
    setView({ start: 0, span: maxDur });
    setNotice('Showing the complete Surah');
  };

  // Cubic zoom slider matching original reel_planner.js
  const zoomSliderValue = (() => {
    if (maxDur <= minSpan) return 0;
    const ratio = clamp(Math.log(winSpan / maxDur) / Math.log(minSpan / maxDur), 0, 1);
    return Math.round(Math.cbrt(ratio) * 100);
  })();

  const handleZoomSlider = (e) => {
    const t = Number(e.target.value) / 100;
    setSpan(maxDur * Math.pow(minSpan / maxDur, Math.pow(t, 3)));
  };

  const timeFromClientX = (clientX) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return winStart + ratio * winSpan;
  };

  const hitBoundaryEdge = (clientX) => {
    if (!reel || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const sx = ((selStart - winStart) / Math.max(0.001, winSpan)) * rect.width;
    const ex = ((selEnd - winStart) / Math.max(0.001, winSpan)) * rect.width;
    const hitTol = 11;
    const dStart = Math.abs(x - sx);
    const dEnd = Math.abs(x - ex);
    if (dStart <= hitTol && dStart <= dEnd) return 'start';
    if (dEnd <= hitTol) return 'end';
    return null;
  };

  const handlePointerDown = (e) => {
    const edge = hitBoundaryEdge(e.clientX);
    if (edge) {
      dragRef.current = { mode: edge, x: e.clientX, moved: true };
      setHoverEdge(edge);
      setIsDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    dragRef.current = { mode: 'pan', x: e.clientX, startAtDown: winStart, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) {
      setHoverEdge(hitBoundaryEdge(e.clientX));
      return;
    }
    if (drag.mode === 'start' || drag.mode === 'end') {
      const t = Math.round(clamp(timeFromClientX(e.clientX), 0, maxDur) * 100) / 100;
      if (drag.mode === 'start') {
        const nextStart = Math.min(t, Math.max(0, selEnd - 0.5));
        setSelStart(nextStart);
      } else {
        const nextEnd = Math.max(t, Math.min(maxDur, selStart + 0.5));
        setSelEnd(nextEnd);
      }
      return;
    }
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) {
      drag.moved = true;
      setIsDragging(true);
    }
    if (!drag.moved) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dt = -(dx / rect.width) * winSpan;
    const nextStart = clamp(drag.startAtDown + dt, 0, Math.max(0, maxDur - winSpan));
    setView((prev) => ({ ...prev, start: nextStart }));
  };

  const handlePointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    if (!drag) return;
    if (drag.mode === 'start' || drag.mode === 'end') {
      onSaveRange?.(selStart, selEnd);
      return;
    }
    if (drag.moved) return;
    const sec = timeFromClientX(e.clientX);
    setCurrentTime(sec);
    if (audioRef.current) audioRef.current.currentTime = sec;
  };

  const handleDoubleClick = (e) => {
    e.preventDefault();
    const t = timeFromClientX(e.clientX);
    setSpan(winSpan / 4, t);
  };

  const wheelStateRef = useRef({ winStart, winSpan, maxDur, setSpan });
  wheelStateRef.current = { winStart, winSpan, maxDur, setSpan };

  // Native non-passive wheel listener so e.preventDefault() stops page scrolling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const { winStart: ws, winSpan: wsp, maxDur: md, setSpan: applySpan } = wheelStateRef.current;
      if (e.shiftKey) {
        const delta = ((e.deltaY || e.deltaX) / 400) * wsp;
        const nextStart = clamp(ws + delta, 0, Math.max(0, md - wsp));
        setView((prev) => ({ ...prev, start: nextStart }));
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const anchor = ws + ratio * wsp;
      const limited = clamp(e.deltaY || 0, -120, 120);
      const step = e.ctrlKey || e.metaKey ? 0.01 : 0.0025;
      applySpan(wsp * Math.exp(limited * step), anchor);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const handlePlayPause = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const handleStop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = selStart;
    setCurrentTime(selStart);
    setPlaying(false);
    setNotice(reel ? `Stopped at start (${fmt(selStart)})` : 'Playback stopped');
  };

  const handleMarkStart = () => {
    const t = Math.round(clamp(currentTime, 0, maxDur) * 100) / 100;
    const nextEnd = selEnd <= t + 0.5 ? Math.min(maxDur, t + 10) : selEnd;
    setSelStart(t);
    setSelEnd(nextEnd);
    onSaveRange?.(t, nextEnd);
  };

  const handleMarkEnd = () => {
    const tEnd = Math.round(clamp(currentTime, 0, maxDur) * 100) / 100;
    if (tEnd <= selStart + 0.5) {
      setError(t('endAfterStartErr'));
      return;
    }
    setError('');
    setSelEnd(tEnd);
    onSaveRange?.(selStart, tEnd);
  };

  const handleSnap = () => {
    if (!waveData.pauses.length) {
      setNotice(t('noPauseInView'));
      return;
    }
    const candidates = [];
    for (const p of waveData.pauses) {
      candidates.push(p.start, p.end, (p.start + p.end) / 2);
    }
    candidates.sort((a, b) => Math.abs(a - currentTime) - Math.abs(b - currentTime));
    const target = candidates[0];
    if (target != null) {
      setCurrentTime(target);
      if (audioRef.current) audioRef.current.currentTime = target;
      setNotice(`Snapped to nearest pause at ${fmt(target)}`);
    }
  };

  const handleApprove = async (confirm = false) => {
    if (!reel) return;
    setBusy(true);
    setError('');
    setNotice('');
    const intendedEnd = selEnd > selStart + 0.5 ? Math.round(selEnd * 100) / 100 : end;
    try {
      await onApproveAudio(intendedEnd, confirm);
      setPendingConfirm(null);
      setNotice(`Reel ${String(reel.reel).padStart(2, '0')} audio approved (${fmt(selStart)} – ${fmt(intendedEnd)})`);
    } catch (err) {
      if (err.status === 409 && err.detail?.confirmation_required) {
        setPendingConfirm({ action: 'approve', message: err.message, detail: err.detail });
      } else {
        setError(err.message || 'Could not approve audio.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async (confirm = false) => {
    if (!reel) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await onResetAudio(confirm);
      setPendingConfirm(null);
      setNotice(`Reel ${String(reel.reel).padStart(2, '0')} audio reset to its original proposal`);
    } catch (err) {
      if (err.status === 409 && err.detail?.confirmation_required) {
        setPendingConfirm({ action: 'reset', message: err.message, detail: err.detail });
      } else {
        setError(err.message || 'Could not reset audio.');
      }
    } finally {
      setBusy(false);
    }
  };

  const startPct = maxDur > 0 ? (start / maxDur) * 100 : 0;
  const endPct = maxDur > 0 ? (end / maxDur) * 100 : 0;

  return (
    <section className="qvs-audio-editor-box">
      <audio
        ref={audioRef}
        src={api.audioFileUrl(surah, sourceId)}
        preload="metadata"
        onLoadedMetadata={(e) => {
          e.currentTarget.volume = volume;
          e.currentTarget.muted = volume === 0;
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
      />

      <div className="qvs-audio-top qvs-player-compact">
        <button
          type="button"
          className={`qvs-play-btn ${playing ? 'is-playing' : ''}`}
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={handlePlayPause}
        >
          {playing ? (
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

        <div className="qvs-time-wrap">
          <div className="qvs-top-time ltr-island">
            {fmt(currentTime)} / {fmt(maxDur)}
          </div>
        </div>

        <div className={`qvs-volume-wrap ltr-island ${volOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="qvs-volume-icon"
            aria-label={volume === 0 ? 'Audio muted' : 'Audio volume'}
            onClick={() => setVolOpen((o) => !o)}
          >
            {volume === 0 ? '🔇' : '🔊'}
          </button>
          {volOpen && (
            <input
              type="range"
              className="qvs-volume-slider"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              aria-label="Volume"
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                if (audioRef.current) {
                  audioRef.current.volume = v;
                  audioRef.current.muted = v === 0;
                }
              }}
            />
          )}
        </div>
      </div>

      <div className="qvs-bars-wrap ltr-island">
        <div className="qvs-bar-group">
          <div className="qvs-bar-label">{t('fullSurah')}</div>
          <div
            className="qvs-rail qvs-full-rail"
            style={{ '--seek-pct': `${maxDur > 0 ? clamp((currentTime / maxDur) * 100, 0, 100) : 0}%` }}
          >
            <span className="qvs-full-fill" aria-hidden="true" />
            <input
              id="qvsFullSeek"
              type="range"
              className="qvs-full-seek"
              min="0"
              max={maxDur}
              step="0.1"
              value={Math.min(maxDur, currentTime)}
              aria-label="Seek through full Surah"
              onChange={(e) => {
                const sec = Number(e.target.value);
                setCurrentTime(sec);
                if (audioRef.current) audioRef.current.currentTime = sec;
              }}
            />
          </div>
          <div className="qvs-rail-times">
            <span>00:00</span>
            <span>{fmt(maxDur)}</span>
          </div>
        </div>
      </div>

      <div className="qvs-wave-wrap ltr-island">
        <canvas
          ref={canvasRef}
          id="qvsWaveform"
          width={1200}
          height={240}
          className={`waveform-canvas ${hoverEdge ? 'is-edge-hover' : ''} ${isDragging ? 'is-dragging' : ''}`}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => { if (!dragRef.current) setHoverEdge(null); }}
          onDoubleClick={handleDoubleClick}
        />
      </div>

      <div className="qvs-buttons-row">
        <button type="button" className="qvs-secondary-btn qvs-mark-btn qvs-mark-start" onClick={handleMarkStart} title={t('startTime')}>
          <span className="qvs-mark-badge">S</span>
          <span className="qvs-mark-label">{t('startTime')}</span>
          <span className="qvs-mark-time ltr-island">{fmt(selStart)}</span>
        </button>
        <button type="button" className="qvs-secondary-btn qvs-mark-btn qvs-mark-end" onClick={handleMarkEnd} title={t('endTime')}>
          <span className="qvs-mark-label">{t('endTime')}</span>
          <span className="qvs-mark-time ltr-island">{fmt(selEnd)}</span>
          <span className="qvs-mark-badge">E</span>
        </button>
        <button type="button" id="qvsStopBtn" className="qvs-secondary-btn" onClick={handleStop}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          <span>{t('stop')}</span>
        </button>
        <button type="button" className="qvs-secondary-btn" onClick={zoomIn} aria-label={t('zoomIn')} title={t('zoomIn')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="M14.5 14.5L21 21M7 10h6M10 7v6" /></svg>
          <span>{t('zoomIn')}</span>
        </button>
        <button type="button" className="qvs-secondary-btn" onClick={zoomOut} aria-label={t('zoomOut')} title={t('zoomOut')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="M14.5 14.5L21 21M7 10h6" /></svg>
          <span>{t('zoomOut')}</span>
        </button>
      </div>

      <div className="qvs-buttons-row qvs-buttons-row-sub">
        <button type="button" className="qvs-secondary-btn" onClick={handleSnap}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12a7 7 0 1 1 7 7" /><path d="M8 19h4v-4" /></svg>
          <span>{t('snapClosestPause')}</span>
        </button>
        <button
          type="button"
          className="qvs-secondary-btn"
          disabled={busy || !reel}
          onClick={() => handleReset(false)}
          title={t('resetAudio')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v5h5" /></svg>
          <span>{t('resetAudio')}</span>
        </button>
      </div>

      {error && <div className="status-banner error" role="alert">{error}</div>}
    </section>
  );
}
