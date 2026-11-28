import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../../context/I18nContext';

export default function ReciterDropdown({ reciters, selectedReciter, onSelect }) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const handleChoose = (reciter) => {
    setOpen(false);
    onSelect(reciter.id);
  };

  return (
    <section className="setup-card" aria-labelledby="step1-heading">
      <div className="setup-step-header">
        <h2 id="step1-heading" className="setup-step-title">
          {t('chooseReciter')}
        </h2>
      </div>

      <div className="reciter-dropdown" ref={containerRef}>
        <button
          type="button"
          className={`reciter-trigger ${open ? 'is-open' : ''} ${selectedReciter ? 'has-value' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {selectedReciter ? (
            <span className="reciter-row-content">
              <img
                src={selectedReciter.portrait}
                alt={lang === 'ar' ? selectedReciter.name_ar : selectedReciter.name}
                className="reciter-portrait"
              />
              <span className="reciter-text">
                <strong className="reciter-name">
                  {lang === 'ar' ? selectedReciter.name_ar : selectedReciter.name}
                </strong>
                <span className="reciter-sep"> — </span>
                <span className="reciter-details">
                  {lang === 'ar' ? selectedReciter.details_ar : selectedReciter.details}
                </span>
              </span>
            </span>
          ) : (
            <span className="reciter-placeholder">{t('chooseReciter')}</span>
          )}
          <span className={`reciter-chevron ${open ? 'up' : ''}`} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>

        {open && (
          <ul
            className="reciter-listbox"
            role="listbox"
            aria-label={t('chooseReciter')}
          >
            {reciters.map((reciter) => {
              const isSelected = selectedReciter?.id === reciter.id;
              return (
                <li
                  key={reciter.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`reciter-option ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleChoose(reciter)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleChoose(reciter);
                    }
                  }}
                >
                  <span className="reciter-row-content">
                    <img
                      src={reciter.portrait}
                      alt={lang === 'ar' ? reciter.name_ar : reciter.name}
                      className="reciter-portrait"
                    />
                    <span className="reciter-text">
                      <strong className="reciter-name">
                        {lang === 'ar' ? reciter.name_ar : reciter.name}
                      </strong>
                      <span className="reciter-sep"> — </span>
                      <span className="reciter-details">
                        {lang === 'ar' ? reciter.details_ar : reciter.details}
                      </span>
                    </span>
                  </span>
                  {isSelected && (
                    <span className="reciter-check" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
