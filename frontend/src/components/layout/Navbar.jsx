import React from 'react';
import { useI18n } from '../../context/I18nContext';
import { api } from '../../services/api';

export default function Navbar() {
  const { lang, setLang, t } = useI18n();

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <div className="navbar-brand">
          <span className="navbar-seal">
            <img src="/assets/quran-header-icon.png?v=3" alt="" aria-hidden="true" />
          </span>
          <span className="navbar-title">{t('appName')}</span>
        </div>

        <div className="navbar-controls">
          <button
            type="button"
            className="navbar-action-btn"
            onClick={() => api.revealExport('').catch(() => {})}
            title={t('exportedReelsBtn')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>{t('exportedReelsBtn')}</span>
          </button>

          <button
            type="button"
            className="navbar-action-btn"
            onClick={() => api.openGuide().catch(() => {})}
            title={t('guideBtn')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
            <span>{t('guideBtn')}</span>
          </button>

          <div className="lang-switch" role="group" aria-label="Language">
            <button
              type="button"
              className={lang === 'en' ? 'active' : ''}
              aria-pressed={lang === 'en'}
              onClick={() => setLang('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === 'ar' ? 'active' : ''}
              aria-pressed={lang === 'ar'}
              onClick={() => setLang('ar')}
            >
              عربي
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
