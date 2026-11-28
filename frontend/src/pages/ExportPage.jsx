import React from 'react';
import { useApp } from '../context/AppContext';
import ExportSummary from '../components/export/ExportSummary';
import '../components/export/Export.css';

export default function ExportPage() {
  const {
    library,
    selectedReciter,
    sourceId,
    selectedSurah,
    currentReel,
    loadDrafts,
  } = useApp();

  const surahInfo = (library.surahs || []).find(
    (s) => Number(s.number) === Number(selectedSurah)
  );

  return (
    <div className="export-page">
      <ExportSummary
        reciter={selectedReciter}
        surahInfo={surahInfo}
        surahNum={selectedSurah}
        reel={currentReel}
        sourceId={sourceId}
        onExported={() => {
          loadDrafts(selectedSurah, sourceId);
        }}
      />
    </div>
  );
}
