import React from 'react';
import { useApp } from '../context/AppContext';
import ReciterDropdown from '../components/quran-setup/ReciterDropdown';
import DownloadAudioStep from '../components/quran-setup/DownloadAudioStep';
import VerifyFilesStep from '../components/quran-setup/VerifyFilesStep';
import '../components/quran-setup/QuranSetup.css';

export default function QuranSetupPage() {
  const {
    reciters,
    selectedReciter,
    selectReciter,
    currentVerification,
    verifyCurrentReciter,
    refreshReciters,
    isVerified,
    surahAudioMissing,
    selectedSurah,
    loadDrafts,
  } = useApp();

  // Only show the audio setup guide when the selected Surah's audio is missing or the reciter has 0 Surahs.
  // When Surah 001 (starter sample) is ready, let the user try the app peacefully without setup cards!
  const needsSetup = Boolean(
    selectedReciter &&
    !selectedReciter.installed &&
    !isVerified &&
    (surahAudioMissing || (selectedReciter.downloaded_count ?? 0) === 0)
  );

  const handleAudioReady = async () => {
    await refreshReciters();
    const res = await verifyCurrentReciter(selectedReciter.id);
    if (res?.source_id) {
      await loadDrafts(selectedSurah, res.source_id);
    }
  };

  return (
    <div className="quran-setup-page">
      <ReciterDropdown
        reciters={reciters}
        selectedReciter={selectedReciter}
        onSelect={selectReciter}
      />

      {needsSetup && (
        <DownloadAudioStep
          reciter={selectedReciter}
          verification={currentVerification}
          onVerify={verifyCurrentReciter}
          onCompleted={handleAudioReady}
          onFolderSelected={handleAudioReady}
        />
      )}
    </div>
  );
}
