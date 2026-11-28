import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import {
  RECITERS,
  STARTER_BACKGROUNDS,
  EFFECT_OPTIONS,
  SIZE_OPTIONS,
  POSITION_OPTIONS,
  BACKDROP_OPTIONS,
  COLOR_OPTIONS,
} from './data/reciters';
import { T, detectDefaultLang, formatTime, buildExportFilename } from './data/i18n';
import { loadChapters, loadUthmani, loadEnglish, loadSurahTimings, resolveActiveVerse } from './engine/quranStore';
import { surahAudioUrl, loadAndAnalyzeAudio, snapToNearestPause } from './engine/audioEngine';
import { drawOverlayOnly, getEffectCssFilter, parseEffects, STAGE_W, STAGE_H } from './engine/canvasRenderer';
import { exportReelOnDevice } from './engine/mp4Exporter';
import ReciterPicker from './components/ReciterPicker';
import SurahPicker from './components/SurahPicker';
import ReelQueue, { buildProposedReels, rebalanceReels } from './components/ReelQueue';
import TouchWaveform from './components/TouchWaveform';
import InfoModal from './components/InfoModal';

const DEFAULT_SETTINGS = {
  backgroundId: 'sample1',
  effect: 'none',
  fontSize: 42,
  verticalOffset: 0,
  backdropAlpha: 155,
  textColor: '#FFFFFF',
  showSurahName: false,
  showAyahNum: false,
};

function EffectGlyph({ val }) {
  switch (val) {
    case 'none':
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><line x1="6" y1="18" x2="18" y2="6" /></svg>;
    case 'soft_dim':
    case 'night_calm':
    case 'fade_slow':
      return <svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>;
    case 'golden_hour':
    case 'warm_cinematic':
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" /></svg>;
    case 'slow_zoom':
      return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>;
    case 'pan':
      return <svg viewBox="0 0 24 24"><path d="M5 12h14M9 8l-4 4 4 4M15 8l4 4-4 4" /></svg>;
    case 'monochrome':
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" /></svg>;
    case 'vignette':
      return <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="12" r="4" /></svg>;
    case 'soft_focus':
      return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" strokeDasharray="3 3" /></svg>;
    default:
      return <svg viewBox="0 0 24 24"><path d="M12 2l2.2 6.2L20 10l-5.8 1.8L12 18l-2.2-6.2L4 10l5.8-1.8z" /></svg>;
  }
}

function ToolIcon({ name }) {
  switch (name) {
    case 'bg':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <polygon points="10 9 16 12 10 15 10 9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'effect':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l2.2 6.2L20 10l-5.8 1.8L12 18l-2.2-6.2L4 10l5.8-1.8z" />
        </svg>
      );
    case 'size':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7V5h12v2M10 5v14M7 19h6M16 11h5M18.5 11v8" />
        </svg>
      );
    case 'pos':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
        </svg>
      );
    case 'backdrop':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="6" width="16" height="12" rx="3" />
          <path d="M8 12h8" />
        </svg>
      );
    case 'color':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

export default function App() {
  const [lang, setLang] = useState(detectDefaultLang);
  const t = T[lang] || T.en;

  const [chapters, setChapters] = useState([]);
  const [uthmaniMap, setUthmaniMap] = useState(null);
  const [englishMap, setEnglishMap] = useState(null);

  const [reciterId, setReciterId] = useState(RECITERS[0].id);
  const [surahNum, setSurahNum] = useState(1);
  const [timings, setTimings] = useState([]);

  const [audioData, setAudioData] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState('');

  const [reels, setReels] = useState([]);
  const [activeReelNum, setActiveReelNum] = useState(1);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(15);
  const [playTime, setPlayTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.2);
  const [volOpen, setVolOpen] = useState(false);

  const [backgrounds, setBackgrounds] = useState(STARTER_BACKGROUNDS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [openTray, setOpenTray] = useState(null); // null | 'bg' | 'effect' | 'size' | 'pos' | 'backdrop' | 'color'

  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);
  const [exportResult, setExportResult] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [exportError, setExportError] = useState('');

  const [installPrompt, setInstallPrompt] = useState(() =>
    typeof window !== 'undefined' ? window.__qrgInstallPrompt || null : null
  );
  const [installFeedback, setInstallFeedback] = useState('');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [fontReady, setFontReady] = useState(false);

  const audioRef = useRef(null);
  const bgVideoRef = useRef(null);
  const bgVideoAltRef = useRef(null);
  const [activeBgSlot, setActiveBgSlot] = useState(0);
  const loopCrossfadeLockRef = useRef(false);
  const previewCanvasRef = useRef(null);
  const abortRef = useRef(null);
  const uploadInputRef = useRef(null);

  const clearExportResult = useCallback(() => {
    setExportResult((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      setExportResult((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
    };
  }, []);

  const reciter = useMemo(() => RECITERS.find((r) => r.id === reciterId) || RECITERS[0], [reciterId]);
  const surahObj = useMemo(() => chapters.find((c) => c.id === surahNum) || chapters[0] || null, [chapters, surahNum]);
  const selectedBg = useMemo(
    () => backgrounds.find((b) => b.id === settings.backgroundId) || backgrounds[0],
    [backgrounds, settings.backgroundId]
  );
  const activeEffects = useMemo(() => parseEffects(settings.effect), [settings.effect]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem('qrg.pwa.lang', lang); } catch {}
  }, [lang]);

  useEffect(() => {
    document.fonts?.ready?.then(() => setFontReady(true)).catch(() => {});
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.navigator?.standalone === true;
    setIsStandalone(Boolean(standalone));
  }, []);

  useEffect(() => {
    if (window.__qrgInstallPrompt) {
      setInstallPrompt(window.__qrgInstallPrompt);
    }
    const handler = (e) => {
      e.preventDefault();
      window.__qrgInstallPrompt = e;
      setInstallPrompt(e);
      setInstallFeedback('');
    };
    const onInstalled = () => {
      window.__qrgInstallPrompt = null;
      setInstallPrompt(null);
      setIsStandalone(true);
      setInstallFeedback('installed');
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    Promise.all([loadChapters(), loadUthmani(), loadEnglish()])
      .then(([ch, ut, en]) => {
        setChapters(ch);
        setUthmaniMap(ut);
        setEnglishMap(en);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setAudioLoading(true);
    setAudioError('');
    setIsPlaying(false);
    clearExportResult();
    setReels([]);
    setStartSec(0);
    setEndSec(0);
    setPlayTime(0);
    setAudioData((prev) => {
      if (prev?.objectUrl && !prev?.isStreamed) URL.revokeObjectURL(prev.objectUrl);
      return null;
    });
    if (audioRef.current) audioRef.current.pause();

    const url = surahAudioUrl(reciter, surahNum);
    loadSurahTimings(reciter, surahNum)
      .then((rows) => {
        if (active) setTimings(rows);
        return loadAndAnalyzeAudio(url, 1200, rows).then((res) => ({ res, rows }));
      })
      .then(({ res, rows }) => {
        if (!active) {
          if (res.objectUrl && !res.isStreamed) URL.revokeObjectURL(res.objectUrl);
          return;
        }
        setAudioData((prev) => {
          if (prev?.objectUrl && !prev?.isStreamed) URL.revokeObjectURL(prev.objectUrl);
          return res;
        });
        const proposed = buildProposedReels(res.duration, res.pauses, rows);
        setReels(proposed);
        const first = proposed[0] || { reel: 1, start: 0, end: res.duration };
        setActiveReelNum(first.reel);
        setStartSec(first.start);
        setEndSec(first.end);
        setPlayTime(first.start);
      })
      .catch(() => {
        if (active) setAudioError(t.audioError);
      })
      .finally(() => {
        if (active) setAudioLoading(false);
      });

    return () => { active = false; };
  }, [reciter, surahNum]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = volume === 0;
    }
  }, [volume, audioData]);

  // Live 9:16 transparent Quran text overlay render loop
  useEffect(() => {
    let rafId = 0;
    const render = () => {
      const canvas = previewCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const audio = audioRef.current;
        const current = isPlaying && audio ? Number(audio.currentTime || playTime) : playTime;
        const verse = resolveActiveVerse({
          timeSec: current,
          surahObj,
          uthmaniMap,
          englishMap,
          timings,
          pauses: audioData?.pauses || [],
          showEnglish: lang === 'en',
          isPlaying,
          effect: settings.effect,
        });
        drawOverlayOnly(ctx, { verse, settings: { ...settings, showEnglish: lang === 'en' } });
      }
      if (isPlaying) {
        rafId = requestAnimationFrame(render);
      }
    };
    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, playTime, surahObj, uthmaniMap, englishMap, timings, audioData, settings, fontReady, lang]);

  // Dual-video seamless loop crossfade (exact Mac VideoStudioPanel.jsx behavior)
  useEffect(() => {
    setActiveBgSlot(0);
    loopCrossfadeLockRef.current = false;
  }, [selectedBg?.id]);

  // Close open video settings tray when clicking/tapping anywhere outside the tray & toolbar dock
  useEffect(() => {
    if (!openTray) return undefined;
    const onOutside = (e) => {
      if (e.target.closest?.('.vs-tray') || e.target.closest?.('.vs-dock')) return;
      setOpenTray(null);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('touchstart', onOutside, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('touchstart', onOutside, true);
    };
  }, [openTray]);

  useEffect(() => {
    if (selectedBg?.kind !== 'video') return;
    const activeVid = activeBgSlot === 0 ? bgVideoRef.current : bgVideoAltRef.current;
    const standbyVid = activeBgSlot === 0 ? bgVideoAltRef.current : bgVideoRef.current;
    if (isPlaying) {
      activeVid?.play().catch(() => {});
    } else {
      activeVid?.pause();
      standbyVid?.pause();
    }
  }, [isPlaying, selectedBg, activeBgSlot]);

  const handleBgLoopCrossfade = (slot, e) => {
    if (slot !== activeBgSlot || !isPlaying || loopCrossfadeLockRef.current) return;
    const vid = e.currentTarget;
    const dur = Number(vid.duration || 0);
    const xf = Math.min(2.0, dur * 0.3);
    if (dur < 2.2 || dur - vid.currentTime > xf) return;
    const nextSlot = slot === 0 ? 1 : 0;
    const nextVid = nextSlot === 0 ? bgVideoRef.current : bgVideoAltRef.current;
    if (!nextVid) return;
    loopCrossfadeLockRef.current = true;
    try { nextVid.currentTime = 0; } catch {}
    nextVid.play().catch(() => {});
    setActiveBgSlot(nextSlot);
    setTimeout(() => {
      try {
        vid.pause();
        vid.currentTime = 0;
      } catch {}
      loopCrossfadeLockRef.current = false;
    }, Math.round(xf * 1000) + 100);
  };

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioData) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    const startFrom = playTime < startSec || playTime >= endSec - 0.1 ? startSec : playTime;
    audio.currentTime = startFrom;
    setPlayTime(startFrom);
    audio.play().then(() => setIsPlaying(true)).catch(() => {});
  }, [isPlaying, audioData, playTime, startSec, endSec]);

  const handleAudioTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const cur = audio.currentTime;
    if (cur >= endSec) {
      audio.pause();
      audio.currentTime = startSec;
      setIsPlaying(false);
      setPlayTime(startSec);
      return;
    }
    setPlayTime(cur);
  };

  const handleSelectReel = (r) => {
    if (audioRef.current) audioRef.current.pause();
    setIsPlaying(false);
    setActiveReelNum(r.reel);
    setStartSec(r.start);
    setEndSec(r.end);
    setPlayTime(r.start);
    setExportResult(null);
  };

  const handleChangeRange = (nextStart, nextEnd) => {
    setStartSec(nextStart);
    setEndSec(nextEnd);
    setReels((prev) =>
      rebalanceReels(prev, activeReelNum, nextStart, nextEnd, audioData?.duration || nextEnd, audioData?.pauses || [], timings)
    );
    if (playTime < nextStart || playTime > nextEnd) setPlayTime(nextStart);
  };

  const handleStopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = startSec;
    }
    setIsPlaying(false);
    setPlayTime(startSec);
  };

  const handleResetAudio = () => {
    if (!audioData) return;
    const proposed = buildProposedReels(audioData.duration, audioData.pauses, timings);
    setReels(proposed);
    const first = proposed[0] || { reel: 1, start: 0, end: audioData.duration };
    setActiveReelNum(first.reel);
    setStartSec(first.start);
    setEndSec(first.end);
    setPlayTime(first.start);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = first.start;
    }
    setIsPlaying(false);
  };

  const handleSnapPause = () => {
    if (!audioData?.pauses?.length) return;
    const nextStart = startSec > 0.5 ? snapToNearestPause(startSec, audioData.pauses, 2.0) : 0;
    const nextEnd = snapToNearestPause(endSec, audioData.pauses, 2.5);
    if (nextEnd - nextStart >= 1.0) {
      handleChangeRange(nextStart, nextEnd);
    }
  };

  const toggleEffect = (val) => {
    if (val === 'none') {
      setSettings((s) => ({ ...s, effect: 'none' }));
      return;
    }
    const cur = activeEffects.filter((e) => e !== 'none');
    const exists = cur.includes(val);
    let next;
    if (exists) {
      next = cur.filter((e) => e !== val);
    } else {
      const fadeGroup = ['fade', 'fade_slow', 'fade_fast'];
      const motionGroup = ['slow_zoom', 'pan'];
      let base = cur;
      if (fadeGroup.includes(val)) base = base.filter((e) => !fadeGroup.includes(e));
      if (motionGroup.includes(val)) base = base.filter((e) => !motionGroup.includes(e));
      next = [...base, val];
    }
    setSettings((s) => ({ ...s, effect: next.length ? next.join(',') : 'none' }));
  };

  const handleUploadMedia = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const kind = file.type.startsWith('image/') ? 'image' : 'video';
    const id = `custom-${Date.now()}`;
    const label = file.name.replace(/\.[^.]+$/, '').slice(0, 12);
    const item = { id, label, labelAr: label, kind, url };
    setBackgrounds((prev) => [item, ...prev]);
    setSettings((s) => ({ ...s, backgroundId: id }));
  };

  const handleInstallClick = async () => {
    const promptEvt = installPrompt || window.__qrgInstallPrompt;
    if (promptEvt) {
      try {
        await promptEvt.prompt();
        const choice = await promptEvt.userChoice;
        window.__qrgInstallPrompt = null;
        setInstallPrompt(null);
        if (choice?.outcome === 'accepted') {
          setInstallFeedback('installed');
        } else {
          setInstallFeedback('dismissed');
        }
        return;
      } catch {
        // Fall through to manual browser guidance
      }
    }
    const ua = navigator.userAgent || '';
    const isInApp = /FBAN|FBAV|Instagram|WhatsApp|Telegram|Line|Snapchat|wv\)/i.test(ua);
    const isIos = /iPhone|iPad|iPod/i.test(ua);
    if (isInApp) {
      setInstallFeedback('in-app');
    } else if (isIos) {
      setInstallFeedback('ios');
    } else {
      setInstallFeedback('manual-android');
    }
  };

  const handleExport = async () => {
    if (!audioData || exporting) return;
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    }
    setOpenTray(null);
    setExporting(true);
    setExportPct(3);
    setExportError('');
    clearExportResult();

    // Unlock an AudioContext synchronously inside the user tap so iOS Safari never mutes audio
    let unlockedAudioCtx = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        unlockedAudioCtx = new AC();
        unlockedAudioCtx.resume().catch(() => {});
      }
    } catch {}

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const { blob, mime, engine } = await exportReelOnDevice({
        audioBuffer: audioData.audioBuffer,
        audioBlob: audioData.blob || null,
        audioUrl: audioData.objectUrl || audioData.audioUrl,
        contentLength: audioData.contentLength || 0,
        surahDuration: audioData.duration || 0,
        unlockedAudioCtx,
        startSec,
        endSec,
        background: selectedBg,
        surahObj,
        uthmaniMap,
        englishMap,
        timings,
        pauses: audioData.pauses || [],
        settings: { ...settings, showEnglish: lang === 'en' },
        onProgress: (p) => setExportPct((prev) => Math.max(prev, p)),
        signal: ctrl.signal,
      });
      const baseName = buildExportFilename(surahObj, activeReelNum, startSec, endSec, lang);
      const filename = mime.includes('webm') ? baseName.replace(/\.mp4$/, '.webm') : baseName;
      const url = URL.createObjectURL(blob);
      setExportResult({ blob, url, filename, mime, engine: engine || '' });
      setSavedNotice(false);
      setShowExportModal(true);
      setReels((prev) => prev.map((r) => (r.reel === activeReelNum ? { ...r, exported: true } : r)));
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setExportError(err?.message === 'UNSUPPORTED' ? t.exportUnsupported : (err?.message || 'Export failed'));
      }
    } finally {
      setExporting(false);
      abortRef.current = null;
    }
  };

  const handleCancelExport = () => {
    abortRef.current?.abort();
    setExporting(false);
    setExportPct(0);
  };

  const triggerDownload = (res) => {
    const a = document.createElement('a');
    a.href = res.url;
    a.download = res.filename;
    a.click();
  };

  const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const res = String(reader.result || '');
        const idx = res.indexOf(',');
        resolve(idx >= 0 ? res.slice(idx + 1) : res);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const handleShareOrSave = async () => {
    if (!exportResult) return;
    if (Capacitor.isNativePlatform()) {
      try {
        const base64Data = await blobToBase64(exportResult.blob);
        const safeName = exportResult.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const cached = await Filesystem.writeFile({
          path: safeName,
          data: base64Data,
          directory: Directory.Cache,
        });
        try {
          await Filesystem.writeFile({
            path: `QuranReels/${safeName}`,
            data: base64Data,
            directory: Directory.Documents,
            recursive: true,
          });
        } catch {
          // Scoped storage fallback: Share sheet below still lets user save anywhere
        }
        await Share.share({
          title: exportResult.filename,
          url: cached.uri,
          dialogTitle: lang === 'ar' ? 'حفظ أو مشاركة الريل' : 'Save or Share Quran Reel',
        });
        setSavedNotice(true);
        return;
      } catch (err) {
        if (err?.message && /cancel/i.test(err.message)) return;
      }
    }
    try {
      const file = new File([exportResult.blob], exportResult.filename, { type: exportResult.mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: exportResult.filename });
        setSavedNotice(true);
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
    triggerDownload(exportResult);
    setSavedNotice(true);
  };

  const stageMotionClass = activeEffects.includes('slow_zoom')
    ? 'effect-slow_zoom'
    : activeEffects.includes('pan')
      ? 'effect-pan'
      : activeEffects.includes('soft_focus')
        ? 'effect-soft_focus'
        : '';

  return (
    <div className="mac-shell">
      {/* Sticky Navbar identical to Mac App */}
      <header className="mac-navbar">
        <div className="mac-navbar-brand">
          <img src="./assets/quran-header-icon.png" alt="" className="mac-navbar-icon" />
          <span className="mac-navbar-title">{t.appName}</span>
        </div>
        <div className="mac-navbar-controls">
          <button
            type="button"
            className="mac-info-icon-btn"
            onClick={() => setShowInfoModal(true)}
            aria-label={lang === 'ar' ? 'معلومات التطبيق والتثبيت' : 'App info & install guide'}
            title={lang === 'ar' ? 'معلومات التطبيق والتثبيت' : 'App info & install guide'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="11" x2="12" y2="16" />
              <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <div className="mac-lang-switch" role="group" aria-label="Language">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={lang === 'ar' ? 'active' : ''} onClick={() => setLang('ar')}>عربي</button>
          </div>
        </div>
      </header>

      {/* Approved Quran Hero Banner */}
      <div className="mac-hero-banner">
        <img src="./assets/Banner.png" alt="Quran Reel Generator" className="mac-hero-img" />
      </div>

      <main className="mac-main">
        <div className="mac-workspace-grid">
          <div className="mac-edits-col">
            {/* 1. Custom Reciter Dropdown (with portraits) */}
            <ReciterPicker
              reciters={RECITERS}
              selected={reciter}
              onSelect={setReciterId}
              lang={lang}
              t={t}
            />

            {/* 2. Custom Surah Dropdown */}
            <SurahPicker
              chapters={chapters}
              selectedNum={surahNum}
              onSelect={setSurahNum}
              lang={lang}
              t={t}
            />

            {/* 3. Reel Queue */}
            <ReelQueue
              reels={reels}
              activeReelNum={activeReelNum}
              onSelectReel={handleSelectReel}
              lang={lang}
              t={t}
            />

            {/* 4. Symmetrical Waveform Editor (identical Mac app controls) */}
            <TouchWaveform
              peaks={audioData?.peaks || []}
              pauses={audioData?.pauses || []}
              timings={timings}
              duration={audioData?.duration || 0}
              audioBuffer={audioData?.audioBuffer || null}
              audioUrl={audioData?.audioUrl || ''}
              contentLength={audioData?.contentLength || 0}
              startSec={startSec}
              endSec={endSec}
              playTime={playTime}
              isPlaying={isPlaying}
              volume={volume}
              onChangeVolume={setVolume}
              onTogglePlay={togglePlay}
              onStop={handleStopAudio}
              onChangeRange={handleChangeRange}
              onSeek={(sec) => {
                setPlayTime(sec);
                if (audioRef.current) audioRef.current.currentTime = sec;
              }}
              onSnapPause={handleSnapPause}
              onResetAudio={handleResetAudio}
              lang={lang}
              t={t}
            />

            {audioLoading && <div className="mac-status-pill">{t.loadingAudio}</div>}
            {audioError && <div className="mac-status-pill is-err">{audioError}</div>}
          </div>

          <div className="mac-preview-col">
            <div className="mac-sticky-studio">
              {/* 5. 9:16 Video Studio Card (identical frosted-glass pop-up trays) */}
              <section className="mac-card vs-card">
          <div className="vs-stage-wrap">
            <div className={`vs-frame-916 ${stageMotionClass}`} onClick={() => (openTray ? setOpenTray(null) : togglePlay())}>
              {selectedBg?.kind === 'image' ? (
                <img
                  src={selectedBg.url}
                  alt=""
                  className="vs-media"
                  style={{ filter: getEffectCssFilter(settings.effect) }}
                />
              ) : (
                <>
                  <video
                    ref={bgVideoRef}
                    key={`${selectedBg?.id}-0`}
                    src={selectedBg?.url}
                    poster={selectedBg?.poster || undefined}
                    className="vs-media"
                    style={{
                      filter: getEffectCssFilter(settings.effect),
                      opacity: activeBgSlot === 0 ? 1 : 0,
                      transition: 'opacity 1.8s ease-in-out',
                    }}
                    muted
                    loop
                    playsInline
                    crossOrigin="anonymous"
                    preload="metadata"
                    onLoadedData={(e) => {
                      if (!isPlaying && e.currentTarget.currentTime === 0) {
                        try { e.currentTarget.currentTime = 0.05; } catch {}
                      }
                    }}
                    onTimeUpdate={(e) => handleBgLoopCrossfade(0, e)}
                  />
                  <video
                    ref={bgVideoAltRef}
                    key={`${selectedBg?.id}-1`}
                    src={selectedBg?.url}
                    poster={selectedBg?.poster || undefined}
                    className="vs-media"
                    style={{
                      filter: getEffectCssFilter(settings.effect),
                      opacity: activeBgSlot === 1 ? 1 : 0,
                      transition: 'opacity 1.8s ease-in-out',
                    }}
                    muted
                    loop
                    playsInline
                    crossOrigin="anonymous"
                    preload={isPlaying ? 'auto' : 'none'}
                    onTimeUpdate={(e) => handleBgLoopCrossfade(1, e)}
                  />
                </>
              )}
              {activeEffects.includes('vignette') && <div className="vs-vignette" aria-hidden="true" />}
              <div className="vs-scrim" aria-hidden="true" />
              <canvas ref={previewCanvasRef} width={STAGE_W} height={STAGE_H} className="vs-overlay" />

              {/* Floating Volume Pill */}
              <div
                className={`vs-vol-pill ${volOpen ? 'is-open' : ''}`}
                onClick={(e) => e.stopPropagation()}
              >
                {volOpen && (
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    style={{ '--vol-pct': `${Math.round(volume * 100)}%` }}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="vs-vol-slider"
                    aria-label="Volume"
                  />
                )}
                <button
                  type="button"
                  className="vs-vol-btn"
                  onClick={() => setVolOpen((v) => !v)}
                  aria-label="Volume"
                >
                  {volume === 0 ? '🔇' : '🔊'}
                </button>
              </div>
            </div>

            {/* Frosted-Glass Pop-up Tray (anchored over bottom of stage, exact Mac app behavior) */}
            {openTray && (
              <div className="vs-tray" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <div className="vs-tray-head">
                  <span className="vs-tray-title">
                    {openTray === 'bg' && t.toolBg}
                    {openTray === 'effect' && t.toolEffect}
                    {openTray === 'size' && t.toolSize}
                    {openTray === 'pos' && t.toolPos}
                    {openTray === 'backdrop' && t.toolBgBox}
                    {openTray === 'color' && t.toolColor}
                  </span>
                  <button type="button" className="vs-tray-close" onClick={() => setOpenTray(null)}>✕</button>
                </div>

                <div
                  className={`vs-tray-strip ${
                    openTray === 'size' || openTray === 'pos' || openTray === 'backdrop'
                      ? 'is-centered-5'
                      : openTray === 'bg' && backgrounds.length <= 4
                        ? 'is-centered-media'
                        : ''
                  }`}
                >
                  {openTray === 'bg' && (
                    <>
                      <button type="button" className="vs-media-chip is-upload" onClick={() => uploadInputRef.current?.click()}>
                        <span className="vs-upload-plus">+</span>
                        <span>{t.uploadFile}</span>
                      </button>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept="video/*,image/*"
                        style={{ display: 'none' }}
                        onChange={handleUploadMedia}
                      />
                      {backgrounds.map((bg) => (
                        <button
                          key={bg.id}
                          type="button"
                          className={`vs-media-chip ${settings.backgroundId === bg.id ? 'active' : ''}`}
                          onClick={() => setSettings((s) => ({ ...s, backgroundId: bg.id }))}
                        >
                          {bg.poster ? (
                            <img src={bg.poster} alt={bg.label} loading="lazy" />
                          ) : bg.kind === 'video' ? (
                            <video src={`${bg.url}#t=0.5`} muted preload="metadata" playsInline />
                          ) : (
                            <img src={bg.url} alt={bg.label} loading="lazy" />
                          )}
                          <span>{lang === 'ar' ? bg.labelAr : bg.label}</span>
                        </button>
                      ))}
                    </>
                  )}

                  {openTray === 'effect' &&
                    EFFECT_OPTIONS.map((opt) => {
                      const isOn = opt.value === 'none'
                        ? activeEffects.length === 1 && activeEffects[0] === 'none'
                        : activeEffects.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          className={`vs-chip ${isOn ? 'active' : ''}`}
                          onClick={() => toggleEffect(opt.value)}
                        >
                          {isOn && <span className="vs-chip-check" aria-hidden="true">✓</span>}
                          <span className="vs-chip-icon"><EffectGlyph val={opt.value} /></span>
                          <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                        </button>
                      );
                    })}

                  {openTray === 'size' &&
                    SIZE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`vs-chip ${settings.fontSize === opt.value ? 'active' : ''}`}
                        onClick={() => setSettings((s) => ({ ...s, fontSize: opt.value }))}
                      >
                        <strong className="vs-size-tag">{opt.tag}</strong>
                        <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                      </button>
                    ))}

                  {openTray === 'pos' &&
                    POSITION_OPTIONS.map((opt, idx) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`vs-chip ${settings.verticalOffset === opt.value ? 'active' : ''}`}
                        onClick={() => setSettings((s) => ({ ...s, verticalOffset: opt.value }))}
                      >
                        <span className="vs-pos-glyph" aria-hidden="true">
                          <span className="vs-pos-bar" style={{ top: `${15 + idx * 17}%` }} />
                        </span>
                        <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                      </button>
                    ))}

                  {openTray === 'backdrop' &&
                    BACKDROP_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`vs-chip ${settings.backdropAlpha === opt.value ? 'active' : ''}`}
                        onClick={() => setSettings((s) => ({ ...s, backdropAlpha: opt.value }))}
                      >
                        <span className="vs-backdrop-swatch">
                          <span className="vs-backdrop-fill" style={{ background: `rgba(0, 0, 0, ${opt.alpha})` }} />
                        </span>
                        <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                      </button>
                    ))}

                  {openTray === 'color' &&
                    COLOR_OPTIONS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        className={`vs-chip ${settings.textColor === c.value ? 'active' : ''}`}
                        onClick={() => setSettings((s) => ({ ...s, textColor: c.value }))}
                      >
                        <span className="vs-colour-dot" style={{ backgroundColor: c.value }} />
                        <span>{lang === 'ar' ? c.labelAr : c.label}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          <audio
            ref={audioRef}
            src={audioData?.objectUrl || ''}
            crossOrigin="anonymous"
            onTimeUpdate={handleAudioTimeUpdate}
            onEnded={() => setIsPlaying(false)}
          />

          {/* Compact Scrub Bar */}
          <div className="vs-player-bar">
            <button
              type="button"
              className={`vs-play-btn ${isPlaying ? 'is-playing' : ''}`}
              onClick={togglePlay}
              disabled={!audioData}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="5" y="4" width="5" height="16" rx="1.5" />
                  <rect x="14" y="4" width="5" height="16" rx="1.5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }} aria-hidden="true">
                  <path d="M6 4.5L20 12L6 19.5V4.5Z" />
                </svg>
              )}
            </button>
            <input
              type="range"
              className="vs-scrub"
              min={startSec}
              max={Math.max(startSec + 0.1, endSec)}
              step={0.05}
              value={Math.min(endSec, Math.max(startSec, playTime))}
              onChange={(e) => {
                const v = Number(e.target.value);
                setPlayTime(v);
                if (audioRef.current) audioRef.current.currentTime = v;
              }}
              disabled={!audioData}
            />
            <span className="vs-time-label" dir="ltr">
              {formatTime(Math.max(0, playTime - startSec))} / {formatTime(Math.max(0, endSec - startSec))}
            </span>
          </div>

          {/* 6 Studio Tool Icons Dock (exact Mac app layout) */}
          <div className="vs-dock">
            {[
              ['bg', t.toolBg],
              ['effect', t.toolEffect],
              ['size', t.toolSize],
              ['pos', t.toolPos],
              ['backdrop', t.toolBgBox],
              ['color', t.toolColor],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`vs-dock-btn ${openTray === id ? 'active' : ''}`}
                onClick={() => setOpenTray((cur) => (cur === id ? null : id))}
              >
                <ToolIcon name={id} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Exact Mac App Display Options Row: Show surah name | Show ayah number | Reset Video */}
          <div className="vs-options-row" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            <label>
              <input
                type="checkbox"
                checked={settings.showSurahName}
                onChange={(e) => setSettings((s) => ({ ...s, showSurahName: e.target.checked }))}
              />
              <span>{t.showSurahName}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showAyahNum}
                onChange={(e) => setSettings((s) => ({ ...s, showAyahNum: e.target.checked }))}
              />
              <span>{t.showAyahNum}</span>
            </label>
            <button
              type="button"
              className="vs-reset-pill vs-reset-inline"
              onClick={() => setSettings({ ...DEFAULT_SETTINGS, backgroundId: settings.backgroundId })}
            >
              ↺ {t.resetVideo}
            </button>
          </div>

          {/* Export Reel Row (Monotonic Gold Fill + Cancel) */}
          <div className="vs-export-row">
            <button
              type="button"
              className={`vs-export-btn ${exporting ? 'is-exporting' : ''} ${exportResult ? 'is-done' : ''}`}
              onClick={exportResult ? () => setShowExportModal(true) : handleExport}
              disabled={!audioData || exporting}
            >
              {exporting && <span className="vs-export-fill" style={{ width: `${exportPct}%` }} />}
              <span className="vs-export-label" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                {exporting ? (
                  <>
                    {t.exporting} <bdi dir="ltr">{exportPct}%</bdi>
                  </>
                ) : exportResult ? (
                  `✓ ${t.exportDone}`
                ) : (
                  t.exportBtn
                )}
              </span>
            </button>

            {exporting && (
              <button type="button" className="vs-cancel-btn" onClick={handleCancelExport}>
                {t.cancel}
              </button>
            )}
          </div>

          {exportError && <div className="mac-status-pill is-err">{exportError}</div>}
              </section>
            </div>
          </div>
        </div>
      </main>

      <footer className="mac-footer" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div>{t.footerLine2}</div>
      </footer>

      <InfoModal
        open={showInfoModal}
        onClose={() => {
          setShowInfoModal(false);
          setInstallFeedback('');
        }}
        lang={lang}
        t={t}
        installPrompt={installPrompt}
        installFeedback={installFeedback}
        isStandalone={isStandalone}
        onInstallClick={handleInstallClick}
      />

      {/* Sleek Export Ready Preview & Save Sheet */}
      {showExportModal && exportResult && (
        <div
          className="mac-modal-backdrop"
          onClick={() => setShowExportModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label={t.exportDone}
        >
          <div className="mac-modal-sheet vs-export-sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
            <div className="mac-modal-head">
              <div className="mac-modal-brand">
                <span className="vs-export-check-badge" aria-hidden="true">✓</span>
                <div>
                  <h2 className="mac-modal-title">{t.exportDone}</h2>
                  <span className="mac-modal-sub" dir="ltr">
                    {exportResult.filename}{exportResult.engine ? ` · ${exportResult.engine}` : ''}
                  </span>
                </div>
              </div>
              <button type="button" className="mac-modal-close" onClick={() => setShowExportModal(false)} aria-label="Close">✕</button>
            </div>
            <div className="vs-export-sheet-body">
              <video
                src={`${exportResult.url}#t=0.05`}
                controls
                playsInline
                preload="auto"
                className="vs-export-preview-video"
              />
              <div className="vs-export-sheet-actions">
                <button
                  type="button"
                  className={`vs-export-primary-save ${savedNotice ? 'is-saved' : ''}`}
                  onClick={handleShareOrSave}
                >
                  {savedNotice
                    ? (lang === 'ar' ? '✓ تم الحفظ بنجاح!' : '✓ Video Saved!')
                    : (lang === 'ar' ? 'حفظ الفيديو / مشاركة' : 'Save Video / Share')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
