import React, { useState, useRef, useEffect } from 'react';

export default function ReciterPicker({ reciters, selected, onSelect, lang, t }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('touchstart', onDoc, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('touchstart', onDoc, true);
    };
  }, [open]);

  return (
    <div className="mac-card" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="mac-card-title">{t.chooseReciter}</div>
      <div className="mac-dropdown" ref={wrapRef}>
        <button
          type="button"
          className={`mac-reciter-trigger ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="mac-reciter-row">
            <img src={selected.portrait} alt="" className="mac-reciter-pic" />
            <span className="mac-reciter-meta">
              <strong className="mac-reciter-name">{lang === 'ar' ? selected.nameAr : selected.name}</strong>
              <span className="mac-reciter-details">{lang === 'ar' ? selected.detailsAr : selected.details}</span>
            </span>
          </span>
          <span className={`mac-chevron ${open ? 'up' : ''}`} aria-hidden="true">▾</span>
        </button>

        {open && (
          <ul className="mac-listbox" role="listbox">
            {reciters.map((r) => {
              const isSel = r.id === selected.id;
              return (
                <li
                  key={r.id}
                  role="option"
                  aria-selected={isSel}
                  className={`mac-option ${isSel ? 'selected' : ''}`}
                  onClick={() => {
                    onSelect(r.id);
                    setOpen(false);
                  }}
                >
                  <span className="mac-reciter-row">
                    <img src={r.portrait} alt="" className="mac-reciter-pic" />
                    <span className="mac-reciter-meta">
                      <strong className="mac-reciter-name">{lang === 'ar' ? r.nameAr : r.name}</strong>
                      <span className="mac-reciter-details">{lang === 'ar' ? r.detailsAr : r.details}</span>
                    </span>
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
