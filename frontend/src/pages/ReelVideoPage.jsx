import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../context/I18nContext';
import { api } from '../services/api';
import BackgroundSelector from '../components/reel-video/BackgroundSelector';
import VideoSettingsForm from '../components/reel-video/VideoSettingsForm';
import ReelPreview from '../components/reel-video/ReelPreview';
import '../components/reel-video/ReelVideo.css';

const DEFAULT_SETTINGS = {
  background_id: '',
  effect: 'fade',
  font_size: 42,
  vertical_offset: 0,
  panel_opacity: 155,
  text_color: '#FFFFFF',
  opening_seconds: 3,
  closing_seconds: 3,
};

function mergeSettings(reel, backgrounds) {
  const saved = reel?.video_settings || {};
  return {
    background_id: saved.background_id || backgrounds[0]?.id || '',
    effect: saved.effect || DEFAULT_SETTINGS.effect,
    font_size: Number(saved.font_size ?? DEFAULT_SETTINGS.font_size),
    vertical_offset: Number(saved.vertical_offset ?? saved.vertical ?? DEFAULT_SETTINGS.vertical_offset),
    panel_opacity: Number(saved.panel_opacity ?? saved.opacity ?? DEFAULT_SETTINGS.panel_opacity),
    text_color: saved.text_color || DEFAULT_SETTINGS.text_color,
    opening_seconds: Number(saved.opening_seconds ?? DEFAULT_SETTINGS.opening_seconds),
    closing_seconds: Number(saved.closing_seconds ?? DEFAULT_SETTINGS.closing_seconds),
  };
}

export default function ReelVideoPage() {
  const { t } = useI18n();
  const {
    library,
    refreshLibrary,
    isVerified,
    sourceId,
    selectedSurah,
    currentReel,
    updateReelInList,
    saveCurrentReel,
    saveState,
    setActiveTab,
  } = useApp();

  const backgrounds = library.backgrounds || [];
  const [settings, setSettings] = useState(() => mergeSettings(currentReel, backgrounds));
  const saveTimerRef = useRef(null);

  useEffect(() => {
    setSettings(mergeSettings(currentReel, backgrounds));
  }, [currentReel?.reel, currentReel?.updated_at, backgrounds.length]);

  const handleUserChange = useCallback((nextSettings) => {
    setSettings(nextSettings);
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveCurrentReel({
        video_settings: nextSettings,
        editing_progress: {
          background_id: nextSettings.background_id,
          effect: nextSettings.effect,
          updated_at: new Date().toISOString(),
        },
      }).catch(() => {});
    }, 350);
  }, [saveCurrentReel]);

  const handleApproveVideo = async () => {
    if (!currentReel) return;
    const res = await api.approveVideo(selectedSurah, currentReel.reel, sourceId);
    if (res.reel) updateReelInList(res.reel);
  };

  const handleResetVideo = async () => {
    if (!currentReel) return;
    const res = await api.resetVideo(selectedSurah, currentReel.reel, sourceId);
    if (res.reel) {
      updateReelInList(res.reel);
      setSettings(mergeSettings(res.reel, backgrounds));
    }
  };

  const selectedBackground = backgrounds.find((b) => b.id === settings.background_id) || backgrounds[0] || null;

  return (
    <div className="reel-video-page">
      <div className="reel-video-left qvs-panel">
        <BackgroundSelector
          backgrounds={backgrounds}
          selectedId={settings.background_id}
          onSelect={(bgId) => handleUserChange({ ...settings, background_id: bgId })}
          onImported={refreshLibrary}
        />
        <VideoSettingsForm
          settings={settings}
          onChange={handleUserChange}
          saveState={saveState}
          onResetDefaults={() =>
            handleUserChange({
              ...DEFAULT_SETTINGS,
              background_id: settings.background_id,
            })
          }
        />
      </div>

      <ReelPreview
        surah={selectedSurah}
        sourceId={sourceId}
        reel={currentReel}
        settings={settings}
        selectedBackground={selectedBackground}
        onApproveVideo={handleApproveVideo}
        onResetVideo={handleResetVideo}
      />
    </div>
  );
}
