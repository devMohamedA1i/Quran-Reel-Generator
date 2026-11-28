const AUDIO_CACHE = 'qrg-pwa-audio-v1';
// Surahs larger than 14 MB (e.g. Al-Baqarah at ~250 MB) stream directly via HTTP Range
// instead of decoding ~2+ GB of uncompressed PCM into mobile Safari RAM.
const MAX_FULL_DECODE_BYTES = 14 * 1024 * 1024;

export function surahAudioUrl(reciter, surahNum) {
  const pad = String(surahNum).padStart(3, '0');
  return `${reciter.server.replace(/\/+$/, '')}/${pad}.mp3`;
}

function probeAudioDuration(url, fallbackSec = 0) {
  return new Promise((resolve) => {
    const el = document.createElement('audio');
    el.crossOrigin = 'anonymous';
    el.preload = 'metadata';
    let settled = false;
    const finish = (dur) => {
      if (settled) return;
      settled = true;
      el.removeAttribute('src');
      el.load();
      resolve(Number.isFinite(dur) && dur > 0 ? dur : fallbackSec);
    };
    const timer = setTimeout(() => finish(fallbackSec), 6000);
    el.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      finish(el.duration);
    }, { once: true });
    el.addEventListener('error', () => {
      clearTimeout(timer);
      finish(fallbackSec);
    }, { once: true });
    el.src = url;
  });
}

function deriveTimingPauses(timings = [], duration = 0) {
  if (!Array.isArray(timings) || !timings.length) return [];
  const pauses = [];
  for (let i = 0; i < timings.length; i++) {
    const cur = timings[i];
    const next = timings[i + 1];
    if (next) {
      const gap = next.start - cur.end;
      if (gap >= 0.12) {
        pauses.push({ start: cur.end, end: next.start, mid: (cur.end + next.start) / 2 });
      } else {
        pauses.push({ start: Math.max(0, cur.end - 0.1), end: Math.min(duration || next.start, cur.end + 0.1), mid: cur.end });
      }
    }
  }
  return pauses;
}

function buildTimingWaveform(timings = [], duration = 60, columns = 1200) {
  const dur = Math.max(1, duration);
  const out = new Array(columns);
  const hasTimings = Array.isArray(timings) && timings.length > 0;
  let tIdx = 0;

  for (let i = 0; i < columns; i++) {
    const sec = (i / columns) * dur;
    let active = true;
    let posInAyah = 0.5;
    if (hasTimings) {
      while (tIdx < timings.length - 1 && sec > timings[tIdx].end) tIdx++;
      const row = timings[tIdx];
      active = Boolean(row && sec >= row.start && sec <= row.end);
      if (active) {
        const span = Math.max(0.2, row.end - row.start);
        posInAyah = (sec - row.start) / span;
      }
    }
    if (!active) {
      out[i] = [-0.04, 0.04];
      continue;
    }
    // Natural phrase contour with gentle breath dips at start/end of each ayah
    const edgeFade = Math.min(1, posInAyah * 8) * Math.min(1, (1 - posInAyah) * 8);
    const wave =
      0.46 +
      0.24 * Math.abs(Math.sin(i * 0.27 + sec * 0.7)) +
      0.18 * Math.abs(Math.cos(i * 0.63)) +
      0.10 * Math.sin(i * 1.37);
    const amp = Math.max(0.08, Math.min(0.95, wave * (0.35 + 0.65 * edgeFade)));
    out[i] = [-amp * 0.94, amp];
  }
  return out;
}

/**
 * Load Surah MP3 from MP3Quran:
 * - Short/medium Surahs (<= 14 MB): cache via Cache API + decode via Web Audio for exact peaks & fast WebCodecs export.
 * - Long Surahs (> 14 MB, e.g. Al-Baqarah ~250 MB): stream directly via HTTP Range so mobile Safari never OOMs.
 */
export async function loadAndAnalyzeAudio(url, columns = 1200, timings = []) {
  // 1. Lightweight HEAD check to detect huge Surahs before downloading into RAM
  let contentLength = 0;
  try {
    const head = await fetch(url, { method: 'HEAD', mode: 'cors' });
    if (!head.ok) throw new Error(`HTTP ${head.status}`);
    contentLength = Number(head.headers.get('content-length') || 0);
  } catch {
    // Some proxies disallow HEAD; fall through to normal path
  }

  const timingMaxEnd = timings?.length ? Number(timings[timings.length - 1]?.end || 0) : 0;

  if (contentLength > MAX_FULL_DECODE_BYTES) {
    const duration = await probeAudioDuration(url, timingMaxEnd);
    if (!duration || duration <= 0) throw new Error('Could not read audio duration');
    const pauses = deriveTimingPauses(timings, duration);
    const peaks = buildTimingWaveform(timings, duration, 2400);
    return {
      objectUrl: url,
      audioUrl: url,
      contentLength,
      isStreamed: true,
      blob: null,
      audioBuffer: null,
      duration,
      peaks,
      pauses,
    };
  }

  let blob = null;
  try {
    if ('caches' in window) {
      const cache = await caches.open(AUDIO_CACHE);
      const hit = await cache.match(url);
      if (hit) {
        blob = await hit.blob();
      } else {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const clone = res.clone();
        blob = await res.blob();
        cache.put(url, clone).catch(() => {});
      }
    }
  } catch {
    // fallback to direct fetch
  }

  if (!blob) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  }

  const objectUrl = URL.createObjectURL(blob);

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const duration = audioBuffer.duration;
    const peaks = computePeaks(channel, columns);
    const pauses = detectPauses(channel, audioBuffer.sampleRate);
    return { objectUrl, audioUrl: url, contentLength: blob.size, isStreamed: false, blob, audioBuffer, duration, peaks, pauses };
  } catch {
    // Graceful fallback if mobile Safari rejects decoding a larger MP3
    const duration = await probeAudioDuration(objectUrl, timingMaxEnd);
    if (!duration || duration <= 0) {
      URL.revokeObjectURL(objectUrl);
      throw new Error('Could not decode audio');
    }
    return {
      objectUrl,
      audioUrl: url,
      contentLength: blob.size,
      isStreamed: true,
      blob,
      audioBuffer: null,
      duration,
      peaks: buildTimingWaveform(timings, duration, 2400),
      pauses: deriveTimingPauses(timings, duration),
    };
  } finally {
    ctx.close().catch(() => {});
  }
}

/**
 * Compute razor-sharp real waveform peaks & real RMS silence pauses for the currently visible
 * zoomed window [winStart, winEnd]:
 * - If audioBuffer is in RAM: instant slice (< 2ms), infinite zoom precision.
 * - If huge streamed Surah (e.g. 253 MB Al-Baqarah): fetches ONLY the ~1-8 MB HTTP byte-range
 *   for [winStart, winEnd] and decodes the real MP3 audio for that window!
 */
export async function analyzeAudioWindow({
  audioBuffer,
  audioUrl,
  contentLength = 0,
  duration = 0,
  winStart = 0,
  winEnd = 0,
  columns = 1200,
  signal,
}) {
  const span = Math.max(0.05, winEnd - winStart);
  if (!duration || duration <= 0) return null;

  // Case 1: Full AudioBuffer already decoded — instant exact slice
  if (audioBuffer) {
    const sr = audioBuffer.sampleRate;
    const channel = audioBuffer.getChannelData(0);
    const s0 = Math.max(0, Math.floor(winStart * sr));
    const s1 = Math.min(channel.length, Math.ceil(winEnd * sr));
    if (s1 <= s0 + 16) return null;
    const slice = channel.subarray(s0, s1);
    const peaks = computePeaks(slice, columns);
    const rawPauses = detectPauses(slice, sr, 0.22, -26);
    const pauses = rawPauses.map((p) => ({
      start: winStart + p.start,
      end: winStart + p.end,
      mid: winStart + p.mid,
    }));
    return { start: winStart, end: winEnd, peaks, pauses };
  }

  // Case 2: Huge streamed Surah — fetch ONLY a fast <= 3.5 MB byte range (when <= 4.5 min) so iPhone never lags
  if (!audioUrl || !contentLength || span > 270) return null;
  const bytesPerSec = contentLength / duration;
  const estBytes = Math.ceil(span * bytesPerSec);
  if (estBytes > 3.5 * 1024 * 1024) return null;

  const padBytes = Math.min(32768, Math.floor(bytesPerSec * 0.5));
  const b0 = Math.max(0, Math.floor(winStart * bytesPerSec) - padBytes);
  const b1 = Math.min(contentLength - 1, Math.ceil(winEnd * bytesPerSec) + padBytes);
  if (b1 <= b0 + 1024) return null;

  const res = await fetch(audioUrl, {
    mode: 'cors',
    headers: { Range: `bytes=${b0}-${b1}` },
    signal,
  });
  if (!res.ok && res.status !== 206) return null;
  const ab = await res.arrayBuffer();
  if (signal?.aborted) return null;

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    const channel = decoded.getChannelData(0);
    const actualStart = b0 / bytesPerSec;
    const actualEnd = Math.min(duration, actualStart + decoded.duration);
    const peaks = computePeaks(channel, columns);
    const rawPauses = detectPauses(channel, decoded.sampleRate, 0.22, -26);
    const pauses = rawPauses.map((p) => ({
      start: actualStart + p.start,
      end: actualStart + p.end,
      mid: actualStart + p.mid,
    }));
    return { start: actualStart, end: actualEnd, peaks, pauses };
  } catch {
    return null;
  } finally {
    ctx.close().catch(() => {});
  }
}

function computePeaks(samples, columns) {
  const total = samples.length;
  const block = Math.max(1, Math.floor(total / columns));
  const mins = new Float32Array(columns);
  const maxs = new Float32Array(columns);
  let globalMax = 0.01;
  for (let i = 0; i < columns; i++) {
    const start = i * block;
    const end = Math.min(total, start + block);
    let lo = 0;
    let hi = 0;
    const step = Math.max(1, Math.floor((end - start) / 96));
    for (let j = start; j < end; j += step) {
      const v = samples[j];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    mins[i] = lo;
    maxs[i] = hi;
    const abs = Math.max(-lo, hi);
    if (abs > globalMax) globalMax = abs;
  }
  const out = new Array(columns);
  for (let i = 0; i < columns; i++) {
    out[i] = [mins[i] / globalMax, maxs[i] / globalMax];
  }
  return out;
}

function detectPauses(samples, sampleRate, minSilenceSec = 0.22, thresholdDb = -26) {
  const threshold = Math.pow(10, thresholdDb / 20);
  const winSec = 0.04;
  const winSize = Math.max(1, Math.floor(sampleRate * winSec));
  const pauses = [];
  let inQuiet = false;
  let qStart = 0;

  for (let i = 0; i < samples.length; i += winSize) {
    const end = Math.min(samples.length, i + winSize);
    let sum = 0;
    const step = Math.max(1, Math.floor((end - i) / 32));
    let count = 0;
    for (let j = i; j < end; j += step) {
      sum += samples[j] * samples[j];
      count++;
    }
    const rms = Math.sqrt(sum / Math.max(1, count));
    const t = i / sampleRate;
    if (rms < threshold) {
      if (!inQuiet) {
        inQuiet = true;
        qStart = t;
      }
    } else if (inQuiet) {
      inQuiet = false;
      if (t - qStart >= minSilenceSec) {
        pauses.push({ start: qStart, end: t, mid: (qStart + t) / 2 });
      }
    }
  }
  return pauses;
}

export function snapToNearestPause(timeSec, pauses, maxDist = 2.0) {
  if (!pauses?.length) return timeSec;
  let best = timeSec;
  let bestDist = maxDist;
  for (const p of pauses) {
    const d = Math.abs(p.mid - timeSec);
    if (d < bestDist) {
      bestDist = d;
      best = p.mid;
    }
  }
  return best;
}
