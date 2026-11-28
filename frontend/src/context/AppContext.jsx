import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../services/api';

const AppContext = createContext(null);

const SELECTION_KEY = 'qvs.selection';
const RECITER_KEY = 'qvs.active_reciter';

function loadSavedSelection() {
  return { surah: 1, reel: 1 };
}

function loadSavedReciterId() {
  try {
    return localStorage.getItem(RECITER_KEY) || '';
  } catch {
    return '';
  }
}

export function AppProvider({ children }) {
  const initialSel = loadSavedSelection();

  const [activeTab, setActiveTab] = useState('setup');
  const [library, setLibrary] = useState({ surahs: [], backgrounds: [], font_ok: false, ffmpeg_ok: false });
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const [reciters, setReciters] = useState([]);
  const [selectedReciterId, setSelectedReciterId] = useState(loadSavedReciterId);
  const [verificationByReciter, setVerificationByReciter] = useState({});
  const [sourceId, setSourceId] = useState(null);

  const [selectedSurah, setSelectedSurahState] = useState(initialSel.surah);
  const [selectedReelNum, setSelectedReelNumState] = useState(initialSel.reel);

  const [reels, setReels] = useState([]);
  const [surahDuration, setSurahDuration] = useState(0);
  const [reelsLoading, setReelsLoading] = useState(false);
  const [reelsError, setReelsError] = useState('');
  const [surahAudioMissing, setSurahAudioMissing] = useState(false);
  const [saveState, setSaveState] = useState('idle');

  const saveSeqRef = useRef(0);
  const draftsSeqRef = useRef(0);

  const persistSelection = useCallback((surah, reel) => {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify({ surah, reel }));
    } catch {
      // ignore
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    try {
      const data = await api.getLibrary();
      setLibrary(data);
    } catch {
      // keep existing
    } finally {
      setLibraryLoaded(true);
    }
  }, []);

  const refreshReciters = useCallback(async () => {
    try {
      const data = await api.getSetupReciters();
      setReciters(data.reciters || []);
      return data.reciters || [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    refreshLibrary();
    refreshReciters();
  }, [refreshLibrary, refreshReciters]);

  const selectReciter = useCallback(async (reciterId) => {
    setSelectedReciterId(reciterId);
    try {
      if (reciterId) {
        localStorage.setItem(RECITER_KEY, reciterId);
      } else {
        localStorage.removeItem(RECITER_KEY);
      }
    } catch {
      // ignore
    }
    if (!reciterId) {
      setSourceId(null);
      return null;
    }
    // Restore existing installation status without deleting or overwriting anything
    try {
      const res = await api.verifyReciter(reciterId, true);
      setVerificationByReciter((prev) => ({ ...prev, [reciterId]: res }));
      // Activate source_id even in starter mode (e.g. bundled Surah 001) so the user can try peacefully
      setSourceId(res.source_id || null);
      return res;
    } catch {
      return null;
    }
  }, []);

  // On initial mount, restore previously selected reciter silently — or auto-select the first reciter
  useEffect(() => {
    if (selectedReciterId) {
      api.verifyReciter(selectedReciterId, true)
        .then((res) => {
          setVerificationByReciter((prev) => ({ ...prev, [selectedReciterId]: res }));
          setSourceId(res.source_id || null);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If no reciter was saved yet, auto-select the first available reciter so Surah 001 opens peacefully
  useEffect(() => {
    if (!selectedReciterId && reciters.length > 0) {
      selectReciter(reciters[0].id);
    }
  }, [selectedReciterId, reciters, selectReciter]);

  const verifyCurrentReciter = useCallback(async (reciterId = selectedReciterId) => {
    if (!reciterId) return null;
    const res = await api.verifyReciter(reciterId, true);
    setVerificationByReciter((prev) => ({ ...prev, [reciterId]: res }));
    setSourceId(res.source_id || null);
    await refreshReciters();
    return res;
  }, [selectedReciterId, refreshReciters]);

  const loadDrafts = useCallback(async (surah = selectedSurah, src = sourceId) => {
    if (!src) {
      // Wait for reciter source_id to resolve instead of throwing a legacy "No Draft folder" error
      setReels([]);
      setSurahDuration(0);
      setReelsError('');
      setSurahAudioMissing(false);
      return null;
    }
    const seq = ++draftsSeqRef.current;
    setReelsLoading(true);
    setReelsError('');
    setSurahAudioMissing(false);
    try {
      const data = await api.getDrafts(surah, src);
      if (seq !== draftsSeqRef.current) return null;
      const list = data.reels || [];
      setReels(list);
      setSurahDuration(Number(data.duration || 0));
      setSurahAudioMissing(false);
      setSelectedReelNumState((prevReel) => {
        const exists = list.some((r) => Number(r.reel) === Number(prevReel));
        const nextReel = exists ? prevReel : (list[0]?.reel || 1);
        persistSelection(surah, nextReel);
        return nextReel;
      });
      return data;
    } catch (err) {
      if (seq !== draftsSeqRef.current) return null;
      setReels([]);
      setSurahDuration(0);
      const msg = String(err.message || '');
      if (err.status === 404 || /no draft folder|no master|not found|cannot read|missing/i.test(msg)) {
        // Audio for this Surah is not downloaded yet — guide the user calmly instead of showing a red error
        setSurahAudioMissing(true);
        setReelsError('');
      } else {
        setReelsError(msg || 'Could not load drafts for this Surah.');
      }
      return null;
    } finally {
      if (seq === draftsSeqRef.current) {
        setReelsLoading(false);
      }
    }
  }, [selectedSurah, sourceId, persistSelection]);

  const setSelectedSurah = useCallback((surahNum) => {
    const n = Number(surahNum);
    if (!Number.isFinite(n) || n < 1 || n > 114) return;
    setSelectedSurahState(n);
    setSelectedReelNumState(1);
    persistSelection(n, 1);
  }, [persistSelection]);

  const setSelectedReelNum = useCallback((reelNum) => {
    const n = Number(reelNum);
    if (!Number.isFinite(n) || n < 1) return;
    setSelectedReelNumState(n);
    persistSelection(selectedSurah, n);
  }, [selectedSurah, persistSelection]);

  // Reload drafts when surah or active source changes (only if a reciter is verified or legacy exists)
  const selectedReciter = reciters.find((r) => r.id === selectedReciterId) || null;
  const currentVerification = selectedReciterId ? verificationByReciter[selectedReciterId] || null : null;
  const isVerified = Boolean(currentVerification?.verified);

  useEffect(() => {
    loadDrafts(selectedSurah, sourceId);
  }, [selectedSurah, sourceId, loadDrafts]);

  const currentReel = reels.find((r) => Number(r.reel) === Number(selectedReelNum)) || reels[0] || null;

  const updateReelInList = useCallback((updated) => {
    if (!updated) return;
    setReels((prev) =>
      prev.map((r) => (Number(r.reel) === Number(updated.reel) ? updated : r))
    );
  }, []);

  const saveCurrentReel = useCallback(async (patch) => {
    if (!currentReel) return null;
    const seq = ++saveSeqRef.current;
    setSaveState('saving');
    try {
      const res = await api.saveDraft(
        selectedSurah,
        currentReel.reel,
        {
          ...patch,
          expected_updated_at: currentReel.updated_at,
        },
        sourceId
      );
      if (seq === saveSeqRef.current && res.reel) {
        updateReelInList(res.reel);
        setSaveState('saved');
      }
      return res.reel;
    } catch (err) {
      if (seq === saveSeqRef.current) {
        setSaveState('error');
      }
      throw err;
    }
  }, [currentReel, selectedSurah, sourceId, updateReelInList]);

  const value = {
    activeTab,
    setActiveTab,
    library,
    libraryLoaded,
    refreshLibrary,
    reciters,
    refreshReciters,
    selectedReciterId,
    selectedReciter,
    selectReciter,
    currentVerification,
    verifyCurrentReciter,
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
    surahAudioMissing,
    loadDrafts,
    updateReelInList,
    saveCurrentReel,
    saveState,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
