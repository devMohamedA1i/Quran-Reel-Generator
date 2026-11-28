import React, { useState, useRef, useEffect } from 'react';
import { toArabicDigits } from '../data/i18n';

export default function SurahPicker({ chapters, selectedNum, onSelect, lang, t }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const activeRef = useRef(null);

  const selected = chapters.find((c) => c.id === selectedNum) || chapters[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('touchstart', onDoc, true);
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' });
    }
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('touchstart', onDoc, true);
    };
  }, [open]);

  if (!selected) return null;
  const fmtNum = (n) => (lang === 'ar' ? toArabicDigits(String(n).padStart(3, '0')) : String(n).padStart(3, '0'));
  const fmtCount = (n) => (lang === 'ar' ? toArabicDigits(n) : n);

  return (
    <div className="mac-card" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="mac-card-title">{t.chooseSurah}</div>
      <div className="mac-dropdown" ref={wrapRef}>
        <button
          type="button"
          className={`mac-surah-trigger ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="mac-surah-line">
            <span className="mac-surah-num">{fmtNum(selected.id)}</span>
            <span className="mac-sep">·</span>
            <span className="mac-surah-ar">{selected.name}</span>
            <span className="mac-sep">—</span>
            <span className="mac-surah-en">{selected.transliteration}</span>
            <span className="mac-surah-verses">({fmtCount(selected.total_verses)} {t.verses})</span>
          </span>
          <span className={`mac-chevron ${open ? 'up' : ''}`} aria-hidden="true">▾</span>
        </button>

        {open && (
          <ul className="mac-listbox" role="listbox">
            {chapters.map((c) => {
              const isSel = c.id === selected.id;
              return (
                <li
                  key={c.id}
                  ref={isSel ? activeRef : null}
                  role="option"
                  aria-selected={isSel}
                  className={`mac-option ${isSel ? 'selected' : ''}`}
                  onClick={() => {
                    onSelect(c.id);
                    setOpen(false);
                  }}
                >
                  <span className="mac-surah-line">
                    <span className="mac-surah-num">{fmtNum(c.id)}</span>
                    <span className="mac-sep">·</span>
                    <span className="mac-surah-ar">{c.name}</span>
                    <span className="mac-sep">—</span>
                    <span className="mac-surah-en">{c.transliteration}</span>
                    <span className="mac-surah-verses">({fmtCount(c.total_verses)})</span>
                  </span>
                  {isSel && <span className="mac-check" aria-hidden="true">✓</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
