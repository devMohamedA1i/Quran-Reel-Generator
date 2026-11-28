import {
  Input,
  BlobSource,
  ALL_FORMATS,
  VideoSampleSink,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  canEncodeAudio,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import { drawReelFrame, STAGE_W, STAGE_H } from './canvasRenderer';
import { resolveActiveVerse } from './quranStore';

let aacEncoderRegistered = false;
const bgBlobCache = new Map();

async function getBackgroundBlob(background, signal) {
  if (background.file instanceof Blob) return background.file;
  const key = background.url;
  if (bgBlobCache.has(key)) return bgBlobCache.get(key);
  const res = await fetch(key, { signal });
  const blob = await res.blob();
  if (bgBlobCache.size >= 3) {
    const oldest = bgBlobCache.keys().next().value;
    bgBlobCache.delete(oldest);
  }
  bgBlobCache.set(key, blob);
  return blob;
}

async function ensureAacEncoder() {
  if (aacEncoderRegistered) return;
  const nativeSupported = await canEncodeAudio('aac').catch(() => false);
  if (!nativeSupported) {
    registerAacEncoder();
    aacEncoderRegistered = true;
  }
}

/**
 * For large streamed Surahs (e.g. 253 MB Al-Baqarah), fetch ONLY the ~1-5 MB byte range
 * covering [startSec, endSec] and decode it into a small AudioBuffer.
 */
async function fetchTrimmedAudioBuffer({ audioUrl, contentLength, duration, startSec, endSec, signal }) {
  if (!audioUrl || !contentLength || !duration) return null;
  const bytesPerSec = contentLength / duration;
  const padBytes = Math.min(65536, Math.floor(bytesPerSec * 1.0));
  const b0 = Math.max(0, Math.floor(startSec * bytesPerSec) - padBytes);
  const b1 = Math.min(contentLength - 1, Math.ceil(endSec * bytesPerSec) + padBytes);
  if (b1 <= b0 + 1024) return null;

  const res = await fetch(audioUrl, {
    mode: 'cors',
    headers: { Range: `bytes=${b0}-${b1}` },
    signal,
  });
  if (!res.ok && res.status !== 206) return null;
  const ab = await res.arrayBuffer();
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    const sliceStart = Math.max(0, startSec - b0 / bytesPerSec);
    return { buffer: decoded, localStartSec: sliceStart };
  } catch {
    return null;
  } finally {
    ctx.close().catch(() => {});
  }
}

/**
 * Slice exact [bufStartSec, bufStartSec + durationSec] from an AudioBuffer into a fresh AudioBuffer.
 */
function sliceAudioBuffer(audioBuffer, bufStartSec, durationSec) {
  const sampleRate = audioBuffer.sampleRate || 44100;
  const numChannels = Math.min(2, audioBuffer.numberOfChannels || 1);
  const startSample = Math.max(0, Math.floor(bufStartSec * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.floor((bufStartSec + durationSec) * sampleRate));
  const length = Math.max(1, endSample - startSample);

  const out = new AudioBuffer({ numberOfChannels: numChannels, length, sampleRate });
  for (let ch = 0; ch < numChannels; ch++) {
    const src = audioBuffer.getChannelData(ch);
    out.copyToChannel(src.subarray(startSample, startSample + length), ch);
  }
  return out;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load background image'));
    img.src = url;
  });
}

/**
 * Sequential hardware-decoded video stream reader using Mediabunny VideoSampleSink.
 * Streams full-resolution original video frames in a single forward pass with ZERO DOM <video> seeking
 * and holds at most 2 VideoSamples in memory (~7 MB).
 * Uses zero-seam iterator promotion: during the calm 2.0s dissolve at the end of each full video pass,
 * the incoming cycle's iterator plays from t0 -> t0+xf and then seamlessly promotes into the main iterator
 * without any re-seek or frame jump.
 */
class SequentialVideoStreamer {
  constructor(sink, firstTimestampSec, endTimestampSec) {
    this.sink = sink;
    this.t0 = Math.max(0, Number(firstTimestampSec || 0));
    const rawDur = Math.max(0.4, Number(endTimestampSec || 10) - this.t0);
    // Trim a tiny 0.08s safety margin at tail so main video never freezes on the final frame during dissolve
    this.duration = rawDur > 1.0 ? rawDur - 0.08 : rawDur;
    this.tEnd = this.t0 + this.duration;
    // Calm cinematic dissolve: 2.0s (capped at 30% of clip duration for very short videos)
    this.xf = this.duration > 2.2 ? Math.min(2.0, this.duration * 0.3) : 0;
    this.cycle = Math.max(0.5, this.duration - this.xf);

    this.mainIter = null;
    this.mainSample = null;
    this.headIter = null;
    this.headSample = null;
    this.activeCycle = -1;
  }

  async _closeIter(iter, sample) {
    if (sample) {
      try { sample.close(); } catch {}
    }
    if (iter && typeof iter.return === 'function') {
      try { await iter.return(); } catch {}
    }
  }

  async _advanceTo(iter, currentSample, targetTime) {
    let cur = currentSample;
    while (true) {
      if (cur && cur.timestamp + (cur.duration || 0.04) >= targetTime) {
        return cur;
      }
      const next = await iter.next();
      if (next.done || !next.value) {
        return cur;
      }
      if (cur) {
        try { cur.close(); } catch {}
      }
      cur = next.value;
    }
  }

  async getFramesAt(elapsedSec) {
    if (this.xf <= 0) {
      const cycleIdx = Math.floor(elapsedSec / this.duration);
      const t = this.t0 + (elapsedSec - cycleIdx * this.duration);
      if (cycleIdx !== this.activeCycle) {
        await this._closeIter(this.mainIter, this.mainSample);
        this.mainSample = null;
        this.mainIter = this.sink.samples(this.t0, this.tEnd + 0.1)[Symbol.asyncIterator]();
        this.activeCycle = cycleIdx;
      }
      this.mainSample = await this._advanceTo(this.mainIter, this.mainSample, t);
      return { main: this.mainSample, blend: null, blendAlpha: 0 };
    }

    // Cycle 0 covers [0, duration) playing t0 -> tEnd (full video from frame 0!).
    // Cycle k >= 1 covers [duration + (k-1)*cycle, duration + k*cycle) playing t0+xf -> tEnd
    // by seamlessly promoting the already-running headIter from the previous cycle's dissolve!
    let cycleIdx = 0;
    let mainTarget = this.t0 + elapsedSec;
    if (elapsedSec >= this.duration) {
      const afterFirst = elapsedSec - this.duration;
      cycleIdx = 1 + Math.floor(afterFirst / this.cycle);
      const p = afterFirst - (cycleIdx - 1) * this.cycle;
      mainTarget = this.t0 + this.xf + p;
    }

    if (cycleIdx !== this.activeCycle) {
      if (cycleIdx > 0 && cycleIdx === this.activeCycle + 1 && this.headIter) {
        // Seamless zero-seek handoff: incoming dissolve stream becomes the new main stream!
        await this._closeIter(this.mainIter, this.mainSample);
        this.mainIter = this.headIter;
        this.mainSample = this.headSample;
        this.headIter = null;
        this.headSample = null;
      } else {
        await this._closeIter(this.mainIter, this.mainSample);
        await this._closeIter(this.headIter, this.headSample);
        this.mainSample = null;
        this.headIter = null;
        this.headSample = null;
        const startAt = cycleIdx === 0 ? this.t0 : this.t0 + this.xf;
        this.mainIter = this.sink.samples(startAt, this.tEnd + 0.1)[Symbol.asyncIterator]();
      }
      this.activeCycle = cycleIdx;
    }

    this.mainSample = await this._advanceTo(this.mainIter, this.mainSample, mainTarget);

    let blend = null;
    let blendAlpha = 0;
    const dissolveStart = this.tEnd - this.xf;
    if (mainTarget > dissolveStart) {
      const tb = Math.max(0, Math.min(1, (mainTarget - dissolveStart) / this.xf));
      const headTarget = this.t0 + tb * this.xf;
      if (!this.headIter) {
        // Open full-length incoming stream starting from t0 so it can seamlessly promote at cycle end
        this.headIter = this.sink.samples(this.t0, this.tEnd + 0.1)[Symbol.asyncIterator]();
        this.headSample = null;
      }
      this.headSample = await this._advanceTo(this.headIter, this.headSample, headTarget);
      blend = this.headSample;
      // Gentle cosine ease-in-out for a calm, invisible dissolve
      blendAlpha = 0.5 - 0.5 * Math.cos(Math.PI * tb);
    }

    return { main: this.mainSample, blend, blendAlpha };
  }

  async close() {
    await this._closeIter(this.mainIter, this.mainSample);
    await this._closeIter(this.headIter, this.headSample);
    this.mainIter = null;
    this.mainSample = null;
    this.headIter = null;
    this.headSample = null;
  }
}

/**
 * Primary Hardware-Accelerated Export Engine using Mediabunny + WebCodecs.
 * - Full-resolution original video (zero chopping, zero downscaling, smooth 1.2s loop crossfade)
 * - Sequential hardware VideoDecoder (zero DOM <video> seeking, low RAM, cool battery)
 * - Native H.264 hardware VideoEncoder + compliant AAC audio (with lightweight @mediabunny/aac-encoder fallback)
 */
async function exportWithMediabunny({
  audioBuffer,
  audioLocalStartSec = null,
  startSec,
  endSec,
  background,
  surahObj,
  uthmaniMap,
  englishMap,
  timings,
  pauses,
  settings,
  onProgress,
  signal,
}) {
  await ensureAacEncoder();
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

  const fps = 24;
  const frameDur = 1 / fps;
  const durationSec = Math.max(0.5, endSec - startSec);
  const totalFrames = Math.max(1, Math.round(durationSec * fps));

  const canvas = document.createElement('canvas');
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  const ctx = canvas.getContext('2d');

  // Prepare background source (either static Image or Mediabunny hardware VideoSampleSink)
  let imageEl = null;
  let videoInput = null;
  let videoStreamer = null;

  if (background.kind === 'image') {
    imageEl = await loadImage(background.url);
  } else {
    onProgress?.(6);
    const bgBlob = await getBackgroundBlob(background, signal);
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    onProgress?.(7);

    videoInput = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(bgBlob),
    });
    const videoTrack = await videoInput.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('No video track found in background file');
    const canDec = await videoTrack.canDecode();
    if (!canDec) throw new Error('Background video codec not supported by hardware decoder');

    const firstTs = (await videoTrack.getFirstTimestamp().catch(() => 0)) || 0;
    const trackDur = (await videoTrack.computeDuration().catch(() => null))
      || (await videoInput.computeDuration().catch(() => 10))
      || 10;
    const sink = new VideoSampleSink(videoTrack);
    videoStreamer = new SequentialVideoStreamer(sink, firstTs, trackDur);
  }

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });

  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: 2_800_000,
    keyFrameInterval: 3,
  });
  output.addVideoTrack(videoSource, { frameRate: fps });

  let audioSource = null;
  let trimmedAudio = null;
  if (audioBuffer) {
    const bufStartSec = audioLocalStartSec != null ? audioLocalStartSec : startSec;
    trimmedAudio = sliceAudioBuffer(audioBuffer, bufStartSec, durationSec);
    audioSource = new AudioBufferSource({
      codec: 'aac',
      bitrate: 128_000,
    });
    output.addAudioTrack(audioSource);
  }

  try {
    await output.start();
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    // Encode audio track cleanly up front
    if (audioSource && trimmedAudio) {
      onProgress?.(8);
      await audioSource.add(trimmedAudio);
      audioSource.close();
      onProgress?.(9);
    }

    let lastPct = 10;
    onProgress?.(lastPct);

    for (let i = 0; i < totalFrames; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

      const elapsedSec = i * frameDur;
      const audioTime = startSec + elapsedSec;

      const verse = resolveActiveVerse({
        timeSec: audioTime,
        surahObj,
        uthmaniMap,
        englishMap,
        timings,
        pauses,
        showEnglish: settings.showEnglish,
        isPlaying: true,
        effect: settings.effect,
      });

      if (videoStreamer) {
        const { main, blend, blendAlpha } = await videoStreamer.getFramesAt(elapsedSec);
        drawReelFrame(ctx, {
          mediaEl: main,
          mediaKind: 'sample',
          blendEl: blend,
          blendAlpha,
          elapsedSec,
          totalSec: durationSec,
          verse,
          settings,
        });
      } else {
        drawReelFrame(ctx, {
          mediaEl: imageEl,
          mediaKind: 'image',
          elapsedSec,
          totalSec: durationSec,
          verse,
          settings,
        });
      }

      await videoSource.add(elapsedSec, frameDur, { keyFrame: i % (fps * 3) === 0 });

      if (i % 24 === 0) {
        const pct = Math.min(96, Math.max(lastPct, 10 + Math.round(((i + 1) / totalFrames) * 86)));
        if (pct > lastPct) {
          lastPct = pct;
          onProgress?.(pct);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    videoSource.close();
    await output.finalize();
    onProgress?.(100);

    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      mime: 'video/mp4',
      engine: 'Hardware HD MP4',
    };
  } catch (err) {
    try { await output.cancel(); } catch {}
    throw err;
  } finally {
    if (videoStreamer) await videoStreamer.close();
    if (videoInput) {
      try { videoInput.dispose(); } catch {}
    }
  }
}

/**
 * Last-resort MediaRecorder fallback ONLY for browsers without WebCodecs VideoEncoder.
 */
async function exportWithMediaRecorder({
  audioBuffer,
  audioLocalStartSec = null,
  startSec,
  endSec,
  background,
  surahObj,
  uthmaniMap,
  englishMap,
  timings,
  pauses,
  settings,
  onProgress,
  signal,
  unlockedAudioCtx = null,
}) {
  const durationSec = Math.max(0.5, endSec - startSec);
  const canvas = document.createElement('canvas');
  canvas.width = STAGE_W;
  canvas.height = STAGE_H;
  const ctx = canvas.getContext('2d');

  let mediaEl = null;
  if (background.kind === 'image') {
    mediaEl = await loadImage(background.url);
  } else {
    mediaEl = await new Promise((resolve, reject) => {
      const vid = document.createElement('video');
      vid.crossOrigin = 'anonymous';
      vid.muted = true;
      vid.playsInline = true;
      vid.loop = true;
      vid.preload = 'auto';
      vid.onloadeddata = () => resolve(vid);
      vid.onerror = () => reject(new Error('Could not load background video'));
      vid.src = background.url;
      vid.load();
    });
  }

  const canvasStream = canvas.captureStream(24);
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = unlockedAudioCtx || new AudioCtx();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume().catch(() => {});
  }
  const dest = audioCtx.createMediaStreamDestination();
  let sourceNode = null;

  if (audioBuffer) {
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(dest);
  }

  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const recorder = new MediaRecorder(combined, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 3_500_000,
    audioBitsPerSecond: 128_000,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve, reject) => {
    let rafId = null;
    let stopped = false;

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId);
      try { sourceNode?.stop(); } catch {}
      try { mediaEl?.pause?.(); } catch {}
      if (!unlockedAudioCtx) audioCtx.close().catch(() => {});
    };

    const onAbort = () => {
      stopped = true;
      cleanup();
      try { recorder.stop(); } catch {}
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    recorder.onstop = () => {
      signal?.removeEventListener('abort', onAbort);
      cleanup();
      if (stopped) return;
      const outMime = recorder.mimeType || mime || 'video/mp4';
      onProgress?.(100);
      resolve({
        blob: new Blob(chunks, { type: outMime }),
        mime: outMime,
        engine: 'MediaRecorder',
      });
    };

    recorder.onerror = (e) => {
      cleanup();
      reject(e?.error || new Error('MediaRecorder failed'));
    };

    const t0 = performance.now();
    if (background.kind === 'video') {
      try { mediaEl.currentTime = 0; } catch {}
      mediaEl.play().catch(() => {});
    }
    if (sourceNode) {
      const bufStart = audioLocalStartSec != null ? audioLocalStartSec : startSec;
      sourceNode.start(0, bufStart, durationSec);
    }

    recorder.start(250);

    const tick = () => {
      if (stopped) return;
      const elapsedSec = (performance.now() - t0) / 1000;
      if (elapsedSec >= durationSec) {
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      const verse = resolveActiveVerse({
        timeSec: startSec + elapsedSec,
        surahObj,
        uthmaniMap,
        englishMap,
        timings,
        pauses,
        showEnglish: settings.showEnglish,
        isPlaying: true,
        effect: settings.effect,
      });
      drawReelFrame(ctx, {
        mediaEl,
        mediaKind: background.kind,
        elapsedSec,
        totalSec: durationSec,
        verse,
        settings,
      });
      onProgress?.(Math.min(98, Math.round((elapsedSec / durationSec) * 98)));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
}

export async function exportReelOnDevice(params) {
  const hasWebCodecs =
    typeof window !== 'undefined' &&
    typeof window.VideoEncoder === 'function' &&
    typeof window.VideoFrame === 'function';

  // Pre-slice AudioBuffer once for large streamed Surahs (e.g. 253 MB Al-Baqarah)
  let sharedAudioBuffer = params.audioBuffer;
  let sharedLocalStart = null;
  if (!sharedAudioBuffer && params.audioUrl && params.contentLength && params.surahDuration) {
    params.onProgress?.(4);
    const sliced = await fetchTrimmedAudioBuffer({
      audioUrl: params.audioUrl,
      contentLength: params.contentLength,
      duration: params.surahDuration,
      startSec: params.startSec,
      endSec: params.endSec,
      signal: params.signal,
    });
    if (sliced?.buffer) {
      sharedAudioBuffer = sliced.buffer;
      sharedLocalStart = sliced.localStartSec;
    }
  }

  const enriched = { ...params, audioBuffer: sharedAudioBuffer, audioLocalStartSec: sharedLocalStart };

  // Primary Path: Mediabunny Hardware WebCodecs (iOS Safari, Android Chrome, Desktop Chrome/Safari/Edge)
  let hwErrMsg = '';
  if (hasWebCodecs && sharedAudioBuffer) {
    try {
      return await exportWithMediabunny(enriched);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      hwErrMsg = err?.message || String(err);
    }
  }

  // Fallback ONLY if WebCodecs is unavailable or fails
  if (typeof window.MediaRecorder === 'function') {
    const res = await exportWithMediaRecorder(enriched);
    return { ...res, engine: hwErrMsg ? `Fallback (${hwErrMsg})` : 'MediaRecorder' };
  }
  throw new Error('UNSUPPORTED');
}
