import React from 'react';
import { I18nProvider, useI18n } from './context/I18nContext';
import { AppProvider, useApp } from './context/AppContext';
import { useVideoSettings } from './hooks/useVideoSettings';
import Navbar from './components/layout/Navbar';
import HeroBanner from './components/layout/HeroBanner';
import QuranSetupPage from './pages/QuranSetupPage';
import ReelAudioPage from './pages/ReelAudioPage';
import VideoStudioPanel from './components/reel-video/VideoStudioPanel';
import './components/layout/Layout.css';
import './components/reel-video/ReelVideo.css';

function AppShell() {
  const { lang, t } = useI18n();
  const { refreshLibrary, sourceId, selectedSurah, currentReel, loadDrafts } = useApp();
  const {
    backgrounds,
    settings,
    selectedBackground,
    saveState,
    handleUserChange,
    handleApproveVideo,
    handleResetVideo,
    handleResetDefaults,
  } = useVideoSettings();

  return (
    <div className="app-shell">
      <Navbar />
      <HeroBanner />

      {/* Compact single-page two-column workspace:
          LTR (English): Setup, Reel Audio & Export on left; unified CapCut-style Video Studio sticky on right.
          Arabic: preserves the same layout with the video on the right. */}
      <main className="app-main">
        <div className="workspace-grid">
          <div className="workspace-edits">
            <div id="section-setup" className="page-section">
              <QuranSetupPage />
            </div>

            <div id="section-audio" className="page-section">
              <ReelAudioPage />
            </div>
          </div>

          <aside className="workspace-preview-col">
            <div className="workspace-sticky">
              <VideoStudioPanel
                surah={selectedSurah}
                sourceId={sourceId}
                reel={currentReel}
                backgrounds={backgrounds}
                settings={settings}
                selectedBackground={selectedBackground}
                saveState={saveState}
                onChangeSettings={handleUserChange}
                onImported={refreshLibrary}
                onApproveVideo={handleApproveVideo}
                onResetVideo={handleResetVideo}
                onResetDefaults={handleResetDefaults}
                onExported={() => loadDrafts(selectedSurah, sourceId)}
              />
            </div>
          </aside>
        </div>
      </main>
      <footer className="app-credit-footer" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="app-credit-line">
          {t('footerLine1')}
        </div>
        <div className="app-credit-line">
          {t('footerLine2')}
        </div>
        <div className="app-credit-author">
          <span>{t('footerAuthor')}</span>
          <span className="app-credit-sep" aria-hidden="true">{lang === 'ar' ? '|' : '·'}</span>
          <a
            href="https://github.com/devMohamedA1i"
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
          >
            https://github.com/devMohamedA1i
          </a>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </I18nProvider>
  );
}
