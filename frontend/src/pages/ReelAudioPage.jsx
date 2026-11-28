import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../context/I18nContext';
import { api } from '../services/api';
import SurahSelector from '../components/reel-audio/SurahSelector';
import ReelQueue from '../components/reel-audio/ReelQueue';
import WaveformEditor from '../components/reel-audio/WaveformEditor';
import '../components/reel-audio/ReelAudio.css';

export default function ReelAudioPage() {
  const { t } = useI18n();
  const {
    library,
    isVerified,
    sourceId,
    selectedSurah,
    setSelectedSurah,
    selectedReelNum,
    setSelectedReelNum,
    reels,
    setReels,
    currentReel,
    surahDuration,
    reelsLoading,
    reelsError,
    loadDrafts,
    saveCurrentReel,
    setActiveTab,
  } = useApp();

  const [ayahs, setAyahs] = useState([]);
  const [timingAvailable, setTimingAvailable] = useState(false);
  const [reproposing, setReproposing] = useState(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    let active = true;
    api.getAyahs(selectedSurah, sourceId)
      .then((data) => {
        if (active) {
          setAyahs(data.ayahs || []);
          setTimingAvailable(Boolean(data.timing_available));
        }
      })
      .catch(() => {
        if (active) {
          setAyahs([]);
          setTimingAvailable(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedSurah, sourceId]);

  const handleSaveRange = useCallback((nextStart, nextEnd) => {
    if (!currentReel) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      api.updateReelRange(
        selectedSurah,
        currentReel.reel,
        { audio_start: nextStart, audio_end: nextEnd },
        sourceId
      )
        .then((res) => {
          if (res?.reels) setReels(res.reels);
        })
        .catch(() => {});
    }, 180);
  }, [currentReel, selectedSurah, sourceId, setReels]);

  const handleApproveAudio = useCallback(async (end, confirm) => {
    if (!currentReel) return;
    const res = await api.approveAudio(
      selectedSurah,
      currentReel.reel,
      { end, confirm },
      sourceId
    );
    if (res.reels) {
      setReels(res.reels);
    } else {
      await loadDrafts(selectedSurah, sourceId);
    }
  }, [currentReel, selectedSurah, sourceId, setReels, loadDrafts]);

  const handleResetAudio = useCallback(async (confirm) => {
    if (!currentReel) return;
    const res = await api.resetAudio(
      selectedSurah,
      currentReel.reel,
      { confirm },
      sourceId
    );
    if (res.reels) {
      setReels(res.reels);
    } else {
      await loadDrafts(selectedSurah, sourceId);
    }
  }, [currentReel, selectedSurah, sourceId, setReels, loadDrafts]);

  const handleRepropose = async () => {
    setReproposing(true);
    try {
      const res = await api.reproposeDrafts(selectedSurah, sourceId);
      if (res.reels) setReels(res.reels);
    } finally {
      setReproposing(false);
    }
  };

  return (
    <div className="reel-audio-page">
      <SurahSelector
        surahs={library.surahs || []}
        selectedSurah={selectedSurah}
        onChangeSurah={setSelectedSurah}
        timingAvailable={timingAvailable}
        onRepropose={handleRepropose}
        reproposing={reproposing}
      />

      {reelsError && (
        <div className="status-banner error" role="alert">
          {reelsError}
        </div>
      )}

      <div className="reel-audio-grid">
        <ReelQueue
          reels={reels}
          selectedReelNum={selectedReelNum}
          onSelectReel={setSelectedReelNum}
          loading={reelsLoading}
        />

        <WaveformEditor
          surah={selectedSurah}
          sourceId={sourceId}
          reel={currentReel}
          surahDuration={surahDuration}
          ayahs={ayahs}
          timingAvailable={timingAvailable}
          onSaveRange={handleSaveRange}
          onResetAudio={handleResetAudio}
          onRepropose={handleRepropose}
        />
      </div>
    </div>
  );
}
