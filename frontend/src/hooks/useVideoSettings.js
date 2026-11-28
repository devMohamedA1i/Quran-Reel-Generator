import { useEffect, useState, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../context/I18nContext';
import { api } from '../services/api';

const LAST_BG_KEY = 'qvs.last_background_id';

function loadLastBackgroundId() {
  try {
    return localStorage.getItem(LAST_BG_KEY) || '';
  } catch {
    return '';
  }
}

function saveLastBackgroundId(id) {
  try {
    if (id) localStorage.setItem(LAST_BG_KEY, id);
  } catch {
    // ignore
  }
}

export const DEFAULT_VIDEO_SETTINGS = {
  background_id: '',
  effect: 'none',
  font_size: 42,
  vertical_offset: 0,
  panel_opacity: 155,
  text_color: '#FFFFFF',
  opening_seconds: 3,
  closing_seconds: 3,
  show_surah_name: false,
  show_ayah_number: false,
};

function mergeSettings(reel, backgrounds) {
  const saved = reel?.video_settings || {};
  const hasSavedBg = saved.background_id && backgrounds.some((b) => b.id === saved.background_id);
  const lastBg = loadLastBackgroundId();
  const validLastBg = backgrounds.some((b) => b.id === lastBg) ? lastBg : '';
  const fallbackBg = validLastBg || backgrounds[0]?.id || '';
  return {
    show_surah_name: saved.show_surah_name === true,
    show_ayah_number: saved.show_ayah_number === true,
    background_id: hasSavedBg ? saved.background_id : fallbackBg,
    effect: saved.effect || DEFAULT_VIDEO_SETTINGS.effect,
    font_size: Number(saved.font_size ?? DEFAULT_VIDEO_SETTINGS.font_size),
    vertical_offset: Number(saved.vertical_offset ?? saved.vertical ?? DEFAULT_VIDEO_SETTINGS.vertical_offset),
    panel_opacity: Number(saved.panel_opacity ?? saved.opacity ?? DEFAULT_VIDEO_SETTINGS.panel_opacity),
    text_color: saved.text_color || DEFAULT_VIDEO_SETTINGS.text_color,
    opening_seconds: Number(saved.opening_seconds ?? DEFAULT_VIDEO_SETTINGS.opening_seconds),
    closing_seconds: Number(saved.closing_seconds ?? DEFAULT_VIDEO_SETTINGS.closing_seconds),
  };
}

export function useVideoSettings() {
  const { lang } = useI18n();
  const {
    library,
    sourceId,
    selectedSurah,
    currentReel,
    updateReelInList,
    saveCurrentReel,
    saveState,
  } = useApp();

  const backgrounds = library.backgrounds || [];
  const [settings, setSettings] = useState(() => mergeSettings(currentReel, backgrounds));
  const saveTimerRef = useRef(null);

  useEffect(() => {
    setSettings(mergeSettings(currentReel, backgrounds));
  }, [selectedSurah, currentReel?.reel, currentReel?.updated_at, backgrounds.length]);

  const handleUserChange = useCallback(
    (nextSettings) => {
      if (nextSettings.background_id) {
        saveLastBackgroundId(nextSettings.background_id);
      }
      setSettings(nextSettings);
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveCurrentReel({
          video_settings: { ...nextSettings, text_language: lang },
          editing_progress: {
            background_id: nextSettings.background_id,
            effect: nextSettings.effect,
            updated_at: new Date().toISOString(),
          },
        }).catch(() => {});
      }, 350);
    },
    [saveCurrentReel, lang]
  );

  const handleApproveVideo = useCallback(async () => {
    if (!currentReel) return;
    clearTimeout(saveTimerRef.current);
    await saveCurrentReel({video_settings: {...settings, text_language: lang}});
    const res = await api.approveVideo(selectedSurah, currentReel.reel, sourceId);
    if (res.reel) updateReelInList(res.reel);
  }, [currentReel, selectedSurah, sourceId, updateReelInList, saveCurrentReel, settings, lang]);

  const handleResetVideo = useCallback(async () => {
    if (!currentReel) return;
    const res = await api.resetVideo(selectedSurah, currentReel.reel, sourceId);
    if (res.reel) {
      updateReelInList(res.reel);
      setSettings(mergeSettings(res.reel, backgrounds));
    }
  }, [currentReel, selectedSurah, sourceId, updateReelInList, backgrounds]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), [selectedSurah, sourceId, currentReel?.reel]);

  const selectedBackground =
    (settings.background_id && backgrounds.find((b) => b.id === settings.background_id)) ||
    backgrounds[0] ||
    null;

  return {
    backgrounds,
    settings: { ...settings, text_language: lang },
    selectedBackground,
    saveState,
    handleUserChange,
    handleApproveVideo,
    handleResetVideo,
    handleResetDefaults: () =>
      handleUserChange({
        ...DEFAULT_VIDEO_SETTINGS,
        background_id: settings.background_id,
      }),
  };
}
