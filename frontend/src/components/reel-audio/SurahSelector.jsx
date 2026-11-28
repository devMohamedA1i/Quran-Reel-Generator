import React, { useState, useRef, useEffect } from 'react';
import { useI18n } from '../../context/I18nContext';

export default function SurahSelector({
  surahs,
  selectedSurah,
  onChangeSurah,
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const activeItemRef = useRef(null);

  const current = surahs.find((s) => Number(s.number) === Number(selectedSurah)) || null;

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleEsc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  useEffect(() => {
    if (open && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [open]);

  const handleSelect = (num) => {
    setOpen(false);
    onChangeSurah(Number(num));
  };

  return (
    <div className="surah-bar card">
      <div className="surah-bar-select">
        <span id="surahSelectLabel" className="field-label">
          {t('selectSurah')}
        </span>

        <div className="surah-dropdown" ref={containerRef}>
          <button
            id="surahSelect"
            type="button"
            className={`surah-trigger ${open ? 'is-open' : ''}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby="surahSelectLabel surahSelect"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="surah-trigger-text">
              {current ? (
                <>
                  <span className="surah-num">{String(current.number).padStart(3, '0')}</span>
                  <span className="surah-sep">—</span>
                  <strong className="surah-ar">{current.name}</strong>
                  <span className="surah-en">({current.englishName})</span>
                  <span className="surah-dot">·</span>
                  <span className="surah-verses">{current.verses} {t('ayahWord')}</span>
                </>
              ) : (
                t('selectSurah')
              )}
            </span>
            <span className={`surah-chevron ${open ? 'up' : ''}`} aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>

          {open && (
            <ul
              className="surah-listbox"
              role="listbox"
              aria-labelledby="surahSelectLabel"
            >
              {surahs.map((s) => {
                const isSelected = Number(s.number) === Number(selectedSurah);
                return (
                  <li
                    key={s.number}
                    ref={isSelected ? activeItemRef : null}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    className={`surah-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect(s.number)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(s.number);
                      }
                    }}
                  >
                    <span className="surah-option-text">
                      <span className="surah-num">{String(s.number).padStart(3, '0')}</span>
                      <span className="surah-sep">—</span>
                      <strong className="surah-ar">{s.name}</strong>
                      <span className="surah-en">({s.englishName})</span>
                      <span className="surah-dot">·</span>
                      <span className="surah-verses">{s.verses} {t('ayahWord')}</span>
                    </span>
                    {isSelected && (
                      <span className="surah-check" aria-hidden="true">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
      </div>
    </div>
  );
}
