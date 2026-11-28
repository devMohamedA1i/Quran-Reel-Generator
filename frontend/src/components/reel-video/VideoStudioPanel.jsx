import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useI18n } from '../../context/I18nContext';
import { api } from '../../services/api';
import { formatTime } from '../../utils/format';

const EFFECT_OPTIONS = [
  { value: 'none', label: 'None', labelAr: 'بدون', icon: 'none' },
  { value: 'soft_dim', label: 'Dim', labelAr: 'تعتيم ناعم', icon: 'dim' },
  { value: 'night_calm', label: 'Night', labelAr: 'ليلي هادئ', icon: 'moon' },
  { value: 'golden_hour', label: 'Golden', labelAr: 'ذهبي', icon: 'sun' },
  { value: 'emerald_mist', label: 'Emerald', labelAr: 'زمردي', icon: 'leaf' },
  { value: 'muted_tone', label: 'Soft Tone', labelAr: 'لون هادئ', icon: 'mute' },
  { value: 'crisp_clear', label: 'Crisp', labelAr: 'نقي واضح', icon: 'crisp' },
  { value: 'fade', label: 'Soft Fade', labelAr: 'تلاشي ناعم', icon: 'spark' },
  { value: 'slow_zoom', label: 'Zoom', labelAr: 'تكبير بطيء', icon: 'zoom' },
  { value: 'pan', label: 'Pan', labelAr: 'تحريك', icon: 'pan' },
  { value: 'fade_slow', label: 'Slow Fade', labelAr: 'تلاشي بطيء', icon: 'moon' },
  { value: 'fade_fast', label: 'Quick Fade', labelAr: 'تلاشي سريع', icon: 'bolt' },
  { value: 'monochrome', label: 'B&W', labelAr: 'أبيض وأسود', icon: 'contrast' },
  { value: 'warm_cinematic', label: 'Warm', labelAr: 'دافئ', icon: 'sun' },
  { value: 'cool_cinematic', label: 'Cool', labelAr: 'بارد', icon: 'snow' },
  { value: 'vintage', label: 'Vintage', labelAr: 'كلاسيكي', icon: 'film' },
  { value: 'soft_focus', label: 'Soft Focus', labelAr: 'ضبابية ناعمة', icon: 'blur' },
  { value: 'vignette', label: 'Vignette', labelAr: 'تظليل الأطراف', icon: 'frame' },
];

const SIZE_OPTIONS = [
  { value: 30, label: 'Small', labelAr: 'صغير', tag: 'S' },
  { value: 42, label: 'Medium', labelAr: 'متوسط', tag: 'M' },
  { value: 54, label: 'Large', labelAr: 'كبير', tag: 'L' },
  { value: 68, label: 'X-Large', labelAr: 'كبير جداً', tag: 'XL' },
  { value: 80, label: 'Max', labelAr: 'أقصى حجم', tag: '2X' },
];

const POSITION_OPTIONS = [
  { value: -180, label: 'Top', labelAr: 'أعلى', pos: 'top' },
  { value: -90, label: 'Upper', labelAr: 'فوق الوسط', pos: 'upper' },
  { value: 0, label: 'Centre', labelAr: 'الوسط', pos: 'center' },
  { value: 90, label: 'Lower', labelAr: 'تحت الوسط', pos: 'lower' },
  { value: 180, label: 'Bottom', labelAr: 'أسفل', pos: 'bottom' },
];

const BACKDROP_OPTIONS = [
  { value: 0, label: 'None', labelAr: 'بدون', alpha: 0 },
  { value: 80, label: 'Light', labelAr: 'خفيف', alpha: 0.3 },
  { value: 155, label: 'Balanced', labelAr: 'متوازن', alpha: 0.6 },
  { value: 205, label: 'Dark', labelAr: 'داكن', alpha: 0.8 },
  { value: 235, label: 'Strong', labelAr: 'قوي', alpha: 0.95 },
];

const COLOUR_OPTIONS = [
  { value: '#FFFFFF', label: 'White', labelAr: 'أبيض' },
  { value: '#FFFFF0', label: 'Ivory', labelAr: 'عاجي' },
  { value: '#F5F5DC', label: 'Beige', labelAr: 'بيج' },
  { value: '#D3D3D3', label: 'Light Grey', labelAr: 'رمادي فاتح' },
  { value: '#808080', label: 'Grey', labelAr: 'رمادي' },
  { value: '#C0C0C0', label: 'Silver', labelAr: 'فضي' },
  { value: '#000000', label: 'Black', labelAr: 'أسود' },
  { value: '#D4AF37', label: 'Gold', labelAr: 'ذهبي' },
  { value: '#FFFF00', label: 'Yellow', labelAr: 'أصفر' },
  { value: '#FFD700', label: 'Gold Yellow', labelAr: 'ذهبي لامع' },
  { value: '#FF8C00', label: 'Orange', labelAr: 'برتقالي' },
  { value: '#FF4500', label: 'Orange Red', labelAr: 'برتقالي محمر' },
  { value: '#FF0000', label: 'Red', labelAr: 'أحمر' },
  { value: '#DC143C', label: 'Crimson', labelAr: 'قرمزي' },
  { value: '#800000', label: 'Maroon', labelAr: 'عنابي' },
  { value: '#FFC0CB', label: 'Light Pink', labelAr: 'وردي فاتح' },
  { value: '#FF69B4', label: 'Hot Pink', labelAr: 'وردي زاهي' },
  { value: '#FF1493', label: 'Deep Pink', labelAr: 'وردي غامق' },
  { value: '#FF00FF', label: 'Magenta', labelAr: 'أرجواني' },
  { value: '#E6E6FA', label: 'Lavender', labelAr: 'لافندر' },
  { value: '#D9C7FF', label: 'Soft Lilac', labelAr: 'ليلكي ناعم' },
  { value: '#800080', label: 'Purple', labelAr: 'بنفسجي' },
  { value: '#4B0082', label: 'Indigo', labelAr: 'نيلي' },
  { value: '#0000FF', label: 'Blue', labelAr: 'أزرق' },
  { value: '#000080', label: 'Navy', labelAr: 'كحلي' },
  { value: '#4169E1', label: 'Royal Blue', labelAr: 'أزرق ملكي' },
  { value: '#00BFFF', label: 'Sky Blue', labelAr: 'أزرق سماوي' },
  { value: '#00FFFF', label: 'Cyan', labelAr: 'سماوي فاتح' },
  { value: '#008080', label: 'Teal', labelAr: 'أخضر مائل للأزرق' },
  { value: '#008000', label: 'Green', labelAr: 'أخضر' },
  { value: '#00FF00', label: 'Lime', labelAr: 'ليموني' },
  { value: '#00FF7F', label: 'Spring', labelAr: 'أخضر ربيعي' },
  { value: '#98FF98', label: 'Mint', labelAr: 'نعناعي' },
  { value: '#808000', label: 'Olive', labelAr: 'زيتوني' },
  { value: '#8B4513', label: 'Brown', labelAr: 'بني' },
  { value: '#D2691E', label: 'Chocolate', labelAr: 'شوكولاتة' },
  { value: '#F8E6C0', label: 'Warm Ivory', labelAr: 'عاجي دافئ' },
  { value: '#D9F0FF', label: 'Ice White', labelAr: 'أبيض ثلجي' },
  { value: '#FFDE9A', label: 'Champagne', labelAr: 'شمبانيا' },
  { value: '#BCEEE6', label: 'Soft Mint', labelAr: 'نعناعي ناعم' },
  { value: '#FFD2DE', label: 'Rose', labelAr: 'وردي ناعم' },
];

function ToolIcon({ name }) {
  switch (name) {
    case 'media':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <polygon points="10 9 16 12 10 15 10 9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'effects':
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
    case 'position':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
        </svg>
      );
    case 'backdrop':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
    case 'colour':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

function EffectGlyph({ icon }) {
  switch (icon) {
    case 'zoom':
      return (
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></svg>
      );
    case 'pan':
      return (
        <svg viewBox="0 0 24 24"><path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /></svg>
      );
    case 'moon':
      return (
        <svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
      );
    case 'bolt':
      return (
        <svg viewBox="0 0 24 24"><polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2" /></svg>
      );
    case 'contrast':
      return (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 4v16" /></svg>
      );
    case 'sun':
      return (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></svg>
      );
    case 'snow':
      return (
        <svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" /></svg>
      );
    case 'film':
      return (
        <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 10h4M17 10h4M3 14h4M17 14h4" /></svg>
      );
    case 'blur':
      return (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" strokeDasharray="3 3" /></svg>
      );
    case 'frame':
      return (
        <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" /><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
      );
    case 'dim':
      return (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4" opacity="0.6" /></svg>
      );
    case 'leaf':
      return (
        <svg viewBox="0 0 24 24"><path d="M19 5C12 5 6 10 5 19c9-1 14-7 14-14z" /><path d="M5 19l7-7" /></svg>
      );
    case 'mute':
      return (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" strokeOpacity="0.6" /><circle cx="12" cy="12" r="3" /></svg>
      );
    case 'crisp':
      return (
        <svg viewBox="0 0 24 24"><polygon points="12 3 15 9 21 12 15 15 12 21 9 15 3 12 9 9 12 3" /></svg>
      );
    case 'none':
      return (
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /></svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24"><path d="M12 3l2 5.5L19.5 10 14 12l-2 5.5L10 12l-5.5-2L10 8.5z" /></svg>
      );
  }
}

function PositionGlyph({ pos }) {
  const y = pos === 'top' ? 5 : pos === 'upper' ? 8.5 : pos === 'center' ? 12 : pos === 'lower' ? 15.5 : 19;
  return (
    <svg viewBox="0 0 24 24">
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" strokeOpacity="0.45" />
      <line x1="7.5" y1={y} x2="16.5" y2={y} strokeWidth="2.6" />
    </svg>
  );
}

const TOOLS = [
  { id: 'media', label: 'Media', icon: 'media' },
  { id: 'effects', label: 'Effects', icon: 'effects' },
  { id: 'size', label: 'Size', icon: 'size' },
  { id: 'position', label: 'Position', icon: 'position' },
  { id: 'backdrop', label: 'Backdrop', icon: 'backdrop' },
  { id: 'colour', label: 'Colour', icon: 'colour' },
];

export default function VideoStudioPanel({
  surah,
  sourceId,
  reel,
  backgrounds,
  settings,
  selectedBackground,
  saveState,
  onChangeSettings,
  onImported,
  onApproveVideo,
  onResetVideo,
  onResetDefaults,
  onExported,
}) {
  const { t, lang } = useI18n();
  const [activeTool, setActiveTool] = useState(null);
  const [bgVolume, setBgVolume] = useState(0.2);
  const [volOpen, setVolOpen] = useState(false);
  const trayRef = useRef(null);
  const dockRef = useRef(null);
  const [overlayUrl, setOverlayUrl] = useState('');
  const [overlayKey, setOverlayKey] = useState('init');
  const [prevOverlay, setPrevOverlay] = useState('');
  const overlayUrlRef = useRef('');
  // Two persistent text layers: new ayah text crossfades in, old fades out. Never remounted -> no flashing.
  const [layers, setLayers] = useState({ a: { url: '', slot: '' }, b: { url: '', slot: '' }, front: 'a' });
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportJob, setExportJob] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // Live playable preview state
  const [ayahs, setAyahs] = useState([]);
  const [sourceOpeningSeconds, setSourceOpeningSeconds] = useState(0);
  const [introElapsed, setIntroElapsed] = useState(0);
  const [pauses, setPauses] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);

  const seqRef = useRef(0);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const videoAltRef = useRef(null);
  const [activeBgSlot, setActiveBgSlot] = useState(0);
  const loopCrossfadeLockRef = useRef(false);
  const crossfadeTimerRef = useRef(null);
  const audioRef = useRef(null);
  const exportPollRef = useRef(null);
  const overlayCacheRef = useRef(new Map());
  const overlayInFlightRef = useRef(new Map());

  const isVideoBg = selectedBackground?.kind === 'video';
  const reelStart = reel ? Number(reel.audio_start || 0) : 0;
  const reelEnd = reel ? Number(reel.audio_end || 0) : 0;
  const reelDuration = Math.max(0, reelEnd - reelStart);

  const openingCardSeconds = reelStart <= .01 ? sourceOpeningSeconds : 0;
  const inOpeningCard = introElapsed < openingCardSeconds;
  const previewDuration = reelDuration + openingCardSeconds;

  // Fetch Ayah timings for the current Surah so live preview switches Ayah text in sync
  useEffect(() => {
    let active = true;
    setSourceOpeningSeconds(0);
    if (!surah) {
      setAyahs([]);
      return undefined;
    }
    api.getAyahs(surah, sourceId)
      .then((data) => {
        if (active) {
          setAyahs(Array.isArray(data.ayahs) ? data.ayahs : []);
          setSourceOpeningSeconds(Number(data.opening_card_seconds || 0));
        }
      })
      .catch(() => {
        if (active) setAyahs([]);
      });
    return () => {
      active = false;
    };
  }, [surah, sourceId]);

  // Pauses BETWEEN ayahs only (server anchors each pause to an ayah boundary).
  useEffect(() => {
    let active = true;
    setPauses([]);
    if (!surah) return undefined;
    api.getPauses(surah, sourceId)
      .then((d) => {
        if (!active) return;
        setPauses((Array.isArray(d.pauses) ? d.pauses : [])
          .map((p) => ({ start: Number(p.start), end: Number(p.end) })));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [surah, sourceId]);

  const inPause = useMemo(
    () => pauses.some((p) => playTime >= Number(p.start) && playTime < Number(p.end)),
    [pauses, playTime]
  );

  // Reset playback when Surah, reciter, or selected reel changes
  useEffect(() => {
    setIsPlaying(false);
    setPlayTime(reelStart);
    setIntroElapsed(0);
    if (audioRef.current) {
      audioRef.current.pause();
      try {
        audioRef.current.currentTime = reelStart;
      } catch {
        // ignore if metadata not yet loaded
      }
    }
    for (const vid of [videoRef.current, videoAltRef.current]) {
      if (vid) {
        vid.pause();
        try {
          vid.currentTime = 0;
        } catch {
          // ignore
        }
      }
    }
    setActiveBgSlot(0);
  }, [surah, sourceId, reel?.reel, reelStart]);

  // Sync preview audio volume/mute with the top-right sound control
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = bgVolume;
    audio.muted = bgVolume === 0;
  }, [bgVolume, surah, sourceId]);

  // Sync background video play/pause with preview playback (dual-layer seamless loop)
  useEffect(() => {
    const v0 = videoRef.current;
    const v1 = videoAltRef.current;
    const activeVid = activeBgSlot === 0 ? v0 : v1;
    const standbyVid = activeBgSlot === 0 ? v1 : v0;
    if (isPlaying) {
      activeVid?.play().catch(() => {});
    } else {
      if (crossfadeTimerRef.current) {
        clearTimeout(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
      loopCrossfadeLockRef.current = false;
      v0?.pause();
      v1?.pause();
      if (standbyVid) {
        try { standbyVid.currentTime = 0; } catch {}
      }
    }
  }, [isPlaying, selectedBackground?.id, activeBgSlot]);

  useEffect(() => {
    if (crossfadeTimerRef.current) {
      clearTimeout(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }
    setActiveBgSlot(0);
    loopCrossfadeLockRef.current = false;
    return () => {
      if (crossfadeTimerRef.current) {
        clearTimeout(crossfadeTimerRef.current);
        crossfadeTimerRef.current = null;
      }
    };
  }, [selectedBackground?.id]);

  const handleBgVideoTimeUpdate = useCallback((slotIndex, e) => {
    if (!isPlaying || slotIndex !== activeBgSlot || loopCrossfadeLockRef.current) return;
    const vid = e.currentTarget;
    const dur = Number(vid.duration || 0);
    if (!Number.isFinite(dur) || dur < 2.2) return;
    const fadeSec = Math.min(1.2, dur / 3);
    const remaining = dur - vid.currentTime;
    if (remaining <= fadeSec) {
      const nextSlot = slotIndex === 0 ? 1 : 0;
      const nextVid = nextSlot === 0 ? videoRef.current : videoAltRef.current;
      if (!nextVid) return;
      loopCrossfadeLockRef.current = true;
      try { nextVid.currentTime = 0; } catch {}
      const playPromise = nextVid.play();
      const finishSwitch = () => {
        setActiveBgSlot(nextSlot);
        if (crossfadeTimerRef.current) clearTimeout(crossfadeTimerRef.current);
        crossfadeTimerRef.current = setTimeout(() => {
          crossfadeTimerRef.current = null;
          try {
            vid.pause();
            vid.currentTime = 0;
          } catch {}
          loopCrossfadeLockRef.current = false;
        }, Math.round(fadeSec * 1000) + 120);
      };
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(finishSwitch).catch(() => {
          // Fallback if WebKit suspended the hidden video: keep current slot looping smoothly
          loopCrossfadeLockRef.current = false;
        });
      } else {
        finishSwitch();
      }
    }
  }, [isPlaying, activeBgSlot]);

  const handleBgVideoEnded = useCallback((slotIndex, e) => {
    if (!isPlaying || slotIndex !== activeBgSlot) return;
    const vid = e.currentTarget;
    try { vid.currentTime = 0; } catch {}
    vid.play().catch(() => {});
  }, [isPlaying, activeBgSlot]);

  const sortedBackgrounds = useMemo(() => {
    return [...backgrounds].sort((a, b) =>
      String(a.name || a.filename || '').localeCompare(
        String(b.name || b.filename || ''),
        undefined,
        { numeric: true, sensitivity: 'base' }
      )
    );
  }, [backgrounds]);

  // Determine which Ayah (or Surah title) corresponds to the current preview time
  const activeSlot = useMemo(() => {
    const timed = ayahs.filter((a) => Number(a.ayah) > 0 || (Number(a.ayah) === 0 && ![1,9].includes(Number(surah))));
    const mid = (a) => Number(a.start) + Math.min(0.05, Math.max(0, (Number(a.end) - Number(a.start)) / 2));
    let idx = -1;
    for (let i = 0; i < timed.length; i += 1) {
      if (Number(timed[i].start) <= playTime) idx = i;
      else break;
    }
    if (idx < 0) {
      const first = timed[0];
      return {
        key: 'none',
        previewTime: 0,
        label: '',
        nextKey: first ? `ayah-${first.ayah}` : '',
        nextTime: first ? mid(first) : 0,
      };
    }
    const cur = timed[idx];
    const next = timed[idx + 1] || null;
    return {
      key: `ayah-${cur.ayah}`,
      previewTime: mid(cur),
      label: Number(cur.ayah) === 0 ? (lang === 'ar' ? 'البسملة' : 'Bismillah') : `Ayah ${cur.ayah}`,
      nextKey: next ? `ayah-${next.ayah}` : '',
      nextTime: next ? mid(next) : 0,
    };
  }, [ayahs, playTime, surah, lang]);

  const styleSignature = useMemo(
    () =>
      [
        surah,
        sourceId || '',
        settings.background_id || '',
        settings.font_size,
        settings.vertical_offset,
        settings.panel_opacity,
        settings.text_color,
        settings.text_language,
        settings.show_surah_name,
        settings.show_ayah_number,
      ].join('|'),
    [
      surah,
      sourceId,
      settings.background_id,
      settings.font_size,
      settings.vertical_offset,
      settings.panel_opacity,
      settings.text_color,
      settings.text_language,
      settings.show_surah_name,
      settings.show_ayah_number,
    ]
  );

  const clearOverlayCache = useCallback(() => {
    for (const url of overlayCacheRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    overlayCacheRef.current.clear();
    overlayInFlightRef.current.clear();
  }, []);

  // Invalidate cached overlay PNGs whenever style, Surah, or reciter changes
  useEffect(() => {
    clearOverlayCache();
  }, [styleSignature, clearOverlayCache]);

  const fetchSlotOverlay = useCallback(
    async (slotKey, previewTime) => {
      const bgId = selectedBackground?.id || '';
      if (!surah || !bgId) return null;
      const cacheKey = `${styleSignature}|${slotKey}`;
      const cached = overlayCacheRef.current.get(cacheKey);
      if (cached) return cached;
      if (overlayInFlightRef.current.has(cacheKey)) {
        return overlayInFlightRef.current.get(cacheKey);
      }
      const payload = {
        surah,
        start: 1,
        end: 1,
        source: sourceId || null,
        background_id: bgId,
        effect: settings.effect,
        resolution: '720',
        font_size: settings.font_size,
        vertical_offset: settings.vertical_offset,
        panel_opacity: settings.panel_opacity,
        text_color: settings.text_color,
        text_language: settings.text_language,
        show_surah_name: settings.show_surah_name,
        show_ayah_number: settings.show_ayah_number,
        opening_seconds: settings.opening_seconds,
        closing_seconds: settings.closing_seconds,
        reel_mode: true,
        preview_time: previewTime,
      };
      const promise = api
        .fetchPreviewOverlayBlob(payload)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          overlayCacheRef.current.set(cacheKey, url);
          overlayInFlightRef.current.delete(cacheKey);
          return url;
        })
        .catch((err) => {
          overlayInFlightRef.current.delete(cacheKey);
          throw err;
        });
      overlayInFlightRef.current.set(cacheKey, promise);
      return promise;
    },
    [
      surah,
      sourceId,
      selectedBackground?.id,
      settings.effect,
      settings.font_size,
      settings.vertical_offset,
      settings.panel_opacity,
      settings.text_color,
      settings.text_language,
      settings.show_surah_name,
      settings.show_ayah_number,
      settings.opening_seconds,
      settings.closing_seconds,
      styleSignature,
    ]
  );

  // Load current slot overlay immediately if cached, else fetch (debounced only when editing styles)
  useEffect(() => {
    if (!surah || !settings.background_id) return undefined;
    if (activeSlot.key === 'none') {
      // Pause / gap: keep the last overlay mounted so it fades out; pre-fetch next.
      if ((activeSlot.nextKey ? { key: activeSlot.nextKey, previewTime: activeSlot.nextTime } : null)) {
        fetchSlotOverlay((activeSlot.nextKey ? { key: activeSlot.nextKey, previewTime: activeSlot.nextTime } : null).key, (activeSlot.nextKey ? { key: activeSlot.nextKey, previewTime: activeSlot.nextTime } : null).previewTime).catch(() => {});
      }
      return undefined;
    }
    const cacheKey = `${styleSignature}|${activeSlot.key}`;
    const cached = overlayCacheRef.current.get(cacheKey);
    const seq = ++seqRef.current;

    const run = async () => {
      if (!cached) setLoading(true);
      setError('');
      try {
        const url = cached || (await fetchSlotOverlay(activeSlot.key, activeSlot.previewTime));
        if (seq !== seqRef.current || !url) return;
        overlayUrlRef.current = url;
        const slot = activeSlot.key;
        setLayers((l) => {
          if (l[l.front].url === url) return l.front && l[l.front].slot === slot ? l : { ...l, [l.front]: { url, slot } };
          const back = l.front === 'a' ? 'b' : 'a';
          return { ...l, [back]: { url, slot }, front: back };
        });
        setOverlayUrl(url);
        setOverlayKey(`${activeSlot.key}-${styleSignature}`);
        // Pre-fetch the next Ayah overlay in the background so transitions are instant
        if ((activeSlot.nextKey ? { key: activeSlot.nextKey, previewTime: activeSlot.nextTime } : null)) {
          fetchSlotOverlay((activeSlot.nextKey ? { key: activeSlot.nextKey, previewTime: activeSlot.nextTime } : null).key, (activeSlot.nextKey ? { key: activeSlot.nextKey, previewTime: activeSlot.nextTime } : null).previewTime).catch(() => {});
        }
      } catch (err) {
        if (seq === seqRef.current) setError(err.message || 'Preview error');
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    };

    if (cached || isPlaying) {
      run();
      return undefined;
    }
    const timer = setTimeout(run, 180);
    return () => clearTimeout(timer);
  }, [surah, settings.background_id, styleSignature, activeSlot.key, activeSlot.previewTime, activeSlot.nextKey, activeSlot.nextTime, isPlaying, fetchSlotOverlay]);

  useEffect(() => {
    return () => {
      clearOverlayCache();
    };
  }, [clearOverlayCache]);

  const togglePlayPreview = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !reel || reelDuration <= 0) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    const startFrom =
      playTime >= reelEnd - 0.08 || playTime < reelStart ? reelStart : playTime;
    try {
      audio.currentTime = startFrom;
    } catch {
      // ignore
    }
    setPlayTime(startFrom);
    const activeVid = activeBgSlot === 0 ? videoRef.current : videoAltRef.current;
    if (activeVid && activeVid.duration > 0) {
      try {
        activeVid.currentTime = (startFrom - reelStart) % activeVid.duration;
      } catch {
        // ignore
      }
    }
    if (inOpeningCard) {
      setIsPlaying(true);
      return;
    }
    if (startFrom === reelStart && playTime >= reelEnd-.08 && openingCardSeconds) {
      setIntroElapsed(0);
      setIsPlaying(true);
      return;
    }
    audio.play()
      .then(() => setIsPlaying(true))
      .catch((err) => setError(err.message || t('previewAudioError')));
  }, [isPlaying, playTime, reel, reelStart, reelEnd, reelDuration, inOpeningCard, openingCardSeconds, activeBgSlot, t]);

  // The opening card has its own clock; source audio remains paused and unmodified.
  useEffect(() => {
    if (!isPlaying || !inOpeningCard) return undefined;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const delta = (now-last)/1000;
      last = now;
      setIntroElapsed((value) => Math.min(openingCardSeconds, value+delta));
    }, 50);
    return () => clearInterval(timer);
  }, [isPlaying, inOpeningCard, openingCardSeconds]);

  useEffect(() => {
    if (isPlaying && !inOpeningCard && audioRef.current?.paused) {
      audioRef.current.play().catch((err) => {
        setIsPlaying(false);
        setError(err.message || 'Could not play preview audio.');
      });
    }
  }, [isPlaying, inOpeningCard]);

  const handleScrubPreview = useCallback(
    (e) => {
      const offset = Number(e.target.value);
      setIntroElapsed(Math.min(openingCardSeconds, offset));
      const nextTime = Math.min(reelEnd, Math.max(reelStart, reelStart + offset-openingCardSeconds));
      if (offset < openingCardSeconds) audioRef.current?.pause();
      setPlayTime(nextTime);
      if (audioRef.current) {
        try {
          audioRef.current.currentTime = nextTime;
        } catch {
          // ignore
        }
      }
      const activeVid = activeBgSlot === 0 ? videoRef.current : videoAltRef.current;
      if (activeVid && activeVid.duration > 0) {
        try {
          activeVid.currentTime = offset % activeVid.duration;
        } catch {
          // ignore
        }
      }
    },
    [reelStart, reelEnd, openingCardSeconds, activeBgSlot]
  );

  const handleAudioTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const now = Number(audio.currentTime || 0);
    if (reelEnd > reelStart && now >= reelEnd) {
      audio.pause();
      try {
        audio.currentTime = reelStart;
      } catch {
        // ignore
      }
      setIsPlaying(false);
      setPlayTime(reelStart);
      setIntroElapsed(0);
      for (const vid of [videoRef.current, videoAltRef.current]) {
        if (vid) {
          vid.pause();
          try {
            vid.currentTime = 0;
          } catch {
            // ignore
          }
        }
      }
      setActiveBgSlot(0);
      return;
    }
    setPlayTime(now);
  }, [reelStart, reelEnd]);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const isVid =
      files[0].type.startsWith('video/') ||
      /\.(mp4|mov|m4v|webm)$/i.test(files[0].name);
    setImporting(true);
    setError('');
    try {
      const res = await api.importBackgrounds(isVid ? 'video' : 'image', files);
      await onImported?.();
      const firstId = res?.imported?.[0]?.id;
      if (firstId) {
        onChangeSettings({ ...settings, background_id: firstId });
      }
    } catch (err) {
      setError(err.message || t('uploadFailedNotice'));
    } finally {
      setImporting(false);
    }
  };

  const handleApprove = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await onApproveVideo();
      setNotice(t('videoApprovedNotice'));
    } catch (err) {
      setError(err.message || t('exportFailedNotice'));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await onResetVideo();
      onResetDefaults?.();
      setNotice(t('videoResetNotice'));
    } catch (err) {
      setError(err.message || t('exportFailedNotice'));
    } finally {
      setBusy(false);
    }
  };

  const exportDoneTimerRef = useRef(null);

  useEffect(() => {
    setExportJob(null);
    if (exportPollRef.current) {
      clearInterval(exportPollRef.current);
      exportPollRef.current = null;
    }
    if (exportDoneTimerRef.current) {
      clearTimeout(exportDoneTimerRef.current);
      exportDoneTimerRef.current = null;
    }
    return () => {
      if (exportPollRef.current) clearInterval(exportPollRef.current);
      if (exportDoneTimerRef.current) clearTimeout(exportDoneTimerRef.current);
    };
  }, [surah, reel?.reel, sourceId]);

  const handleExportReel = async () => {
    if (!reel || reelDuration <= 0) return;
    setError('');
    setNotice('');
    if (exportDoneTimerRef.current) {
      clearTimeout(exportDoneTimerRef.current);
      exportDoneTimerRef.current = null;
    }
    try {
      const { job_id } = await api.exportDraftReel(surah, reel.reel, sourceId, {
        direct: true,
        audio_start: reelStart,
        audio_end: reelEnd,
        video_settings: settings,
      });
      setExportJob({ job_id, state: 'running', percent: 3, message: t('exporting') });
      exportPollRef.current = setInterval(async () => {
        try {
          const st = await api.getJob(job_id);
          if (st.state === 'cancelled') {
            clearInterval(exportPollRef.current);
            exportPollRef.current = null;
            setExportJob(null);
            return;
          }
          setExportJob((prev) => ({
            ...st,
            job_id,
            percent: st.state === 'done' ? 100 : Math.max(Number(prev?.percent || 0), Number(st.percent || 0)),
          }));
          if (st.state === 'done') {
            clearInterval(exportPollRef.current);
            exportPollRef.current = null;
            onExported?.();
            exportDoneTimerRef.current = setTimeout(() => {
              setExportJob((cur) => (cur?.state === 'done' ? null : cur));
              exportDoneTimerRef.current = null;
            }, 10000);
          } else if (st.state === 'error') {
            clearInterval(exportPollRef.current);
            exportPollRef.current = null;
            setError(st.message || t('exportFailedNotice'));
          }
        } catch (err) {
          clearInterval(exportPollRef.current);
          exportPollRef.current = null;
          setError(err.message);
        }
      }, 600);
    } catch (err) {
      setError(err.message || t('exportStartFailedNotice'));
    }
  };

  const handleCancelExport = async () => {
    const jid = exportJob?.job_id;
    if (exportPollRef.current) {
      clearInterval(exportPollRef.current);
      exportPollRef.current = null;
    }
    setExportJob(null);
    if (jid) {
      api.cancelJob(jid).catch(() => {});
    }
  };

  const isExporting = exportJob?.state === 'running';
  const canExport = Boolean(reel && reelDuration > 0 && !isExporting);

  const update = (key, val) => {
    onChangeSettings({ ...settings, [key]: val });
  };

  // Parse comma-separated effects so multiple effects can be combined
  const activeEffects = useMemo(() => {
    const raw = String(settings.effect || 'none')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const cleaned = raw.filter((e) => e !== 'none');
    return cleaned.length ? cleaned : ['none'];
  }, [settings.effect]);

  const toggleEffect = (val) => {
    if (val === 'none') {
      update('effect', 'none');
      return;
    }
    const current = activeEffects.filter((e) => e !== 'none');
    const exists = current.includes(val);
    let next;
    if (exists) {
      next = current.filter((e) => e !== val);
    } else {
      // Mutually exclusive fade speed or motion pairs replace their sibling while combining with everything else
      const fadeGroup = ['fade', 'fade_slow', 'fade_fast'];
      const motionGroup = ['slow_zoom', 'pan'];
      next = current.filter((e) => {
        if (fadeGroup.includes(val) && fadeGroup.includes(e)) return false;
        if (motionGroup.includes(val) && motionGroup.includes(e)) return false;
        return true;
      });
      next.push(val);
    }
    update('effect', next.length ? next.join(',') : 'none');
  };

  // Close floating video settings tray when clicking outside the tray and dock
  useEffect(() => {
    if (!activeTool) return undefined;
    const handleOutside = (e) => {
      if (trayRef.current?.contains(e.target)) return;
      if (dockRef.current?.contains(e.target)) return;
      setActiveTool(null);
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') setActiveTool(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [activeTool]);

  // Combine CSS filters for all selected effects so live preview reflects multi-selection
  const combinedMediaFilter = useMemo(() => {
    const map = {
      monochrome: 'grayscale(100%) contrast(1.08)',
      warm_cinematic: 'sepia(0.28) saturate(1.25) brightness(1.02) hue-rotate(-8deg)',
      cool_cinematic: 'saturate(0.95) brightness(0.98) hue-rotate(14deg) contrast(1.06)',
      vintage: 'sepia(0.45) contrast(0.92) brightness(0.96) saturate(0.85)',
      soft_focus: 'blur(2.2px) brightness(1.03)',
      golden_hour: 'sepia(0.32) saturate(1.22) brightness(1.02) hue-rotate(-10deg)',
      emerald_mist: 'brightness(0.90) saturate(0.95) hue-rotate(38deg) contrast(1.04)',
      night_calm: 'brightness(0.72) contrast(1.08) saturate(0.86) hue-rotate(16deg)',
      soft_dim: 'brightness(0.76)',
      muted_tone: 'saturate(0.55) contrast(0.96)',
      crisp_clear: 'contrast(1.16) saturate(1.06) brightness(1.02)',
    };
    const parts = activeEffects.map((e) => map[e]).filter(Boolean);
    return parts.length ? parts.join(' ') : undefined;
  }, [activeEffects]);

  const effectClasses = useMemo(
    () => activeEffects.map((e) => `effect-${e}`).join(' '),
    [activeEffects]
  );

  const toggleTool = (id) => {
    setActiveTool((prev) => (prev === id ? null : id));
  };

  const elapsedInReel = Math.max(0, Math.min(reelDuration, playTime - reelStart));

  return (
    <section id="section-video" className="video-studio-card page-section">
      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
        onChange={handleUpload}
      />

      {surah && (
        <audio
          ref={audioRef}
          key={`${surah}-${sourceId || 'legacy'}`}
          src={api.audioFileUrl(surah, sourceId)}
          preload="metadata"
          muted={bgVolume === 0}
          onLoadedMetadata={(e) => {
            e.currentTarget.volume = bgVolume;
            e.currentTarget.muted = bgVolume === 0;
          }}
          onTimeUpdate={handleAudioTimeUpdate}
          onEnded={() => {
            setIsPlaying(false);
            setPlayTime(reelStart);
            setIntroElapsed(0);
          }}
        />
      )}

      {/* 9:16 Video Stage + compact frosted-glass CapCut-style pop-up tray on top */}
      <div className="vs-stage">
        <div
          className={`preview-frame-9-16 ltr-island ${effectClasses} ${isPlaying ? 'is-playing' : 'is-paused'}`}
          onClick={(e) => {
            if (e.target.closest('.vs-vol-control')) return;
            togglePlayPreview();
          }}
          role="button"
          tabIndex={0}
          aria-label={isPlaying ? 'Pause video preview' : 'Play video preview'}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              togglePlayPreview();
            }
          }}
        >
          {selectedBackground ? (
            <>
              {isVideoBg ? (
                <>
                  <video
                    ref={videoRef}
                    key={`${selectedBackground.id}-0`}
                    src={`/api/background/${selectedBackground.id}`}
                    loop
                    muted
                    playsInline
                    preload="auto"
                    onTimeUpdate={(e) => handleBgVideoTimeUpdate(0, e)}
                    onEnded={(e) => handleBgVideoEnded(0, e)}
                    className="preview-media"
                    style={{
                      ...(combinedMediaFilter ? { filter: combinedMediaFilter } : {}),
                      opacity: activeBgSlot === 0 ? 1 : 0,
                      transition: 'opacity 1.2s ease-in-out',
                    }}
                  />
                  <video
                    ref={videoAltRef}
                    key={`${selectedBackground.id}-1`}
                    src={`/api/background/${selectedBackground.id}`}
                    loop
                    muted
                    playsInline
                    preload="auto"
                    onTimeUpdate={(e) => handleBgVideoTimeUpdate(1, e)}
                    onEnded={(e) => handleBgVideoEnded(1, e)}
                    className="preview-media"
                    style={{
                      ...(combinedMediaFilter ? { filter: combinedMediaFilter } : {}),
                      opacity: activeBgSlot === 1 ? 1 : 0,
                      transition: 'opacity 1.2s ease-in-out',
                    }}
                  />
                </>
              ) : (
                <img
                  key={selectedBackground.id}
                  src={`/api/background/${selectedBackground.id}`}
                  alt="9:16 Reel preview background"
                  className="preview-media"
                  style={combinedMediaFilter ? { filter: combinedMediaFilter } : undefined}
                />
              )}
              <div
                className={`vs-vol-control ltr-island ${volOpen ? 'is-open' : ''}`}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className={`vs-vol-btn ${bgVolume === 0 ? 'is-muted' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setVolOpen((o) => !o);
                  }}
                  aria-label={bgVolume === 0 ? 'Preview muted' : 'Preview volume'}
                  title={bgVolume === 0 ? 'Preview sound muted' : `Preview volume ${Math.round(bgVolume * 100)}%`}
                >
                  {bgVolume === 0 ? '🔇' : '🔊'}
                </button>
                {volOpen && (
                  <input
                    type="range"
                    className="vs-vol-slider"
                    min="0"
                    max="1"
                    step="0.01"
                    value={bgVolume}
                    aria-label="Preview volume"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBgVolume(v);
                      if (audioRef.current) {
                        audioRef.current.volume = v;
                        audioRef.current.muted = v === 0;
                      }
                    }}
                  />
                )}
              </div>
              {activeEffects.includes('vignette') && <div className="vs-vignette-layer" aria-hidden="true" />}
              {['a', 'b'].map((id) => {
                const layer = layers[id];
                if (!layer.url) return null;
                const isFront = layers.front === id;
                const show = isFront && (!isPlaying || (layer.slot === activeSlot.key && activeSlot.key !== 'none' && (!inPause || activeSlot.key === 'ayah-0')));
                const [fin, fout] = activeEffects.includes('fade_slow') ? [1.0, 0.4]
                  : activeEffects.includes('fade_fast') ? [0.25, 0.15] : [0.6, 0.3];
                return (
                  <img
                    key={`layer-${id}`}
                    src={layer.url}
                    alt={isFront ? 'Quran text overlay' : ''}
                    className="preview-overlay-img"
                    style={{
                      opacity: show ? 1 : 0,
                      transition: show ? `opacity ${fin}s ease-in-out` : `opacity ${fout}s ease-out`,
                    }}
                  />
                );
              })}
            </>
          ) : (
            <div className="preview-placeholder">
              {loading ? t('loadingAssets') : t('uploadOrPickBg')}
            </div>
          )}
        </div>

        {/* Wide floating option tray that appears ON TOP when an effect tool is clicked */}
        {activeTool && (
          <div ref={trayRef} className="vs-tray" role="dialog" aria-label={activeTool}>
            <div className="vs-tray-head">
              <span className="vs-tray-title">
                {t(`videoTool_${activeTool}`)}
              </span>
              <button
                type="button"
                className="vs-tray-close"
                aria-label="Close"
                onClick={() => setActiveTool(null)}
              >
                ✕
              </button>
            </div>

            {activeTool === 'media' && (
              <div className="vs-tray-media">
                <button
                  type="button"
                  className="vs-chip vs-upload-chip"
                  onClick={() => fileRef.current?.click()}
                  disabled={importing}
                >
                  <span className="vs-chip-icon">⬆</span>
                  <span>{importing ? t('uploading') : t('uploadFile')}</span>
                </button>
                {sortedBackgrounds.map((bg) => (
                  <button
                    key={bg.id}
                    type="button"
                    className={`vs-media-chip ${settings.background_id === bg.id ? 'active' : ''}`}
                    title={bg.filename}
                    onClick={() => update('background_id', bg.id)}
                  >
                    {bg.kind === 'video' ? (
                      <video src={`/api/background/${bg.id}#t=0.5`} muted preload="metadata" playsInline />
                    ) : (
                      <img src={`/api/background/${bg.id}`} alt={bg.name} loading="lazy" />
                    )}
                    <span>{bg.name}</span>
                  </button>
                ))}
              </div>
            )}

            {activeTool === 'effects' && (
              <div className="vs-tray-grid">
                {EFFECT_OPTIONS.map((opt) => {
                  const isSelected = activeEffects.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`vs-chip ${isSelected ? 'active' : ''}`}
                      aria-pressed={isSelected}
                      onClick={() => toggleEffect(opt.value)}
                    >
                      {isSelected && (
                        <span className="vs-chip-check" aria-hidden="true">
                          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
                          </svg>
                        </span>
                      )}
                      <span className="vs-chip-icon">
                        <EffectGlyph icon={opt.icon} />
                      </span>
                      <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {activeTool === 'size' && (
              <div className="vs-tray-grid vs-tray-5">
                {SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`vs-chip ${Number(settings.font_size) === opt.value ? 'active' : ''}`}
                    onClick={() => update('font_size', opt.value)}
                  >
                    <span className="vs-chip-tag">{opt.tag}</span>
                    <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                  </button>
                ))}
              </div>
            )}

            {activeTool === 'position' && (
              <div className="vs-tray-grid vs-tray-5">
                {POSITION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`vs-chip ${Number(settings.vertical_offset) === opt.value ? 'active' : ''}`}
                    onClick={() => update('vertical_offset', opt.value)}
                  >
                    <span className="vs-chip-icon">
                      <PositionGlyph pos={opt.pos} />
                    </span>
                    <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                  </button>
                ))}
              </div>
            )}

            {activeTool === 'backdrop' && (
              <div className="vs-tray-grid vs-tray-5">
                {BACKDROP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`vs-chip ${Number(settings.panel_opacity) === opt.value ? 'active' : ''}`}
                    onClick={() => update('panel_opacity', opt.value)}
                  >
                    <span className="vs-backdrop-swatch">
                      <span
                        className="vs-backdrop-fill"
                        style={{ background: `rgba(0, 0, 0, ${opt.alpha})` }}
                      />
                    </span>
                    <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                  </button>
                ))}
              </div>
            )}

            {activeTool === 'colour' && (
              <div className="vs-tray-grid">
                {COLOUR_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`vs-chip ${String(settings.text_color).toUpperCase() === opt.value ? 'active' : ''}`}
                    onClick={() => update('text_color', opt.value)}
                  >
                    <span
                      className="vs-colour-dot"
                      style={{ backgroundColor: opt.value }}
                    />
                    <span>{lang === 'ar' ? opt.labelAr : opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Video Preview Playback Bar */}
      <div className="vs-player-bar ltr-island">
        <button
          type="button"
          className={`vs-play-btn ${isPlaying ? 'is-playing' : ''}`}
          onClick={togglePlayPreview}
          disabled={!reel || reelDuration <= 0}
          aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
          title={isPlaying ? 'Pause video preview' : 'Play video preview'}
        >
          {isPlaying ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="5" y="4" width="5" height="16" rx="1.4" />
              <rect x="14" y="4" width="5" height="16" rx="1.4" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '1.5px' }} aria-hidden="true">
              <path d="M6 4.5L20 12L6 19.5V4.5Z" />
            </svg>
          )}
        </button>
        <input
          type="range"
          className="vs-scrub-slider"
          min="0"
          max={previewDuration || 1}
          step="0.05"
          value={inOpeningCard ? introElapsed : elapsedInReel+openingCardSeconds}
          disabled={!reel || reelDuration <= 0}
          onChange={handleScrubPreview}
          aria-label="Preview timeline"
        />
        <span className="vs-time-label">
          {formatTime(inOpeningCard ? introElapsed : elapsedInReel+openingCardSeconds)} / {formatTime(previewDuration)}
        </span>
      </div>

      {/* CapCut / TikTok-style main bottom icon dock */}
      <div ref={dockRef} className="vs-dock" role="toolbar" aria-label="Video edits">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`vs-dock-btn ${activeTool === tool.id ? 'active' : ''}`}
            aria-expanded={activeTool === tool.id}
            onClick={() => toggleTool(tool.id)}
          >
            <span className="vs-dock-icon">
              <ToolIcon name={tool.icon} />
            </span>
            <span className="vs-dock-label">{t(`videoTool_${tool.id}`)}</span>
          </button>
        ))}
      </div>

      <div className="vs-text-options" role="group" aria-label={t('textDisplay')}>
        <label>
          <input type="checkbox" checked={Boolean(settings.show_surah_name)}
            onChange={(event) => update('show_surah_name',event.target.checked)} />
          <span>{t('showSurahName')}</span>
        </label>
        <label>
          <input type="checkbox" checked={Boolean(settings.show_ayah_number)}
            onChange={(event) => update('show_ayah_number',event.target.checked)} />
          <span>{t('showAyahNumber')}</span>
        </label>
        <button
          type="button"
          className="btn vs-reset-btn vs-reset-inline"
          onClick={handleReset}
          disabled={busy || !reel}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.3-5.7" />
            <path d="M4 4v5h5" />
          </svg>
          <span>{t('resetVideo')}</span>
        </button>
      </div>

      {/* 1-click Export Reel button — progress bar & ✓ Exported successfully live INSIDE the button (zero layout shift) */}
      <div className="vs-export-row">
        <button
          id="section-export"
          type="button"
          className={`btn vs-export-btn ${isExporting ? 'is-exporting' : ''} ${exportJob?.state === 'done' ? 'is-done' : ''}`}
          disabled={!canExport}
          onClick={handleExportReel}
          title={exportJob?.state === 'done' && exportJob.file ? String(exportJob.file).split('/').pop() : t('exportReelBtn')}
        >
          {isExporting && (
            <span
              className="vs-export-btn-fill"
              style={{ width: `${exportJob.percent || 0}%` }}
              aria-hidden="true"
            />
          )}
          <span className="vs-export-btn-label" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {isExporting ? (
              <>
                <span>{t('exporting')}</span>{' '}
                <bdi dir="ltr">{exportJob.percent || 0}%</bdi>
              </>
            ) : exportJob?.state === 'done' ? (
              `✓ ${t('exportSuccess')}`
            ) : (
              t('exportReelBtn')
            )}
          </span>
        </button>

        {isExporting && (
          <button
            type="button"
            className="btn vs-cancel-export-btn"
            onClick={handleCancelExport}
          >
            {t('cancelExport')}
          </button>
        )}

        {exportJob?.state === 'done' && (
          <button
            type="button"
            className="btn vs-reveal-inline-btn"
            onClick={() => api.revealExport(exportJob.file || '').catch(() => {})}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>{t('showInFinder')}</span>
          </button>
        )}
      </div>

      {error && <div className="vs-status-note is-err" role="alert">{error}</div>}
    </section>
  );
}
