import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { TRANSLATIONS } from '../i18n/translations';

const I18nContext = createContext(null);

function detectDefaultLang() {
  try {
    const saved = localStorage.getItem('qvs.lang');
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    // ignore storage errors
  }
  try {
    const langs = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ''];
    if (langs.some((l) => String(l).toLowerCase().startsWith('ar'))) {
      return 'ar';
    }
  } catch {
    // ignore navigator errors
  }
  return 'en';
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectDefaultLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.setAttribute('dir', 'ltr');
    try {
      localStorage.setItem('qvs.lang', lang);
    } catch {
      // ignore storage errors
    }
  }, [lang]);

  const setLang = useCallback((next) => {
    setLangState(next === 'ar' ? 'ar' : 'en');
  }, []);

  const t = useCallback(
    (key, params) => {
      const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
      let text = dict[key] ?? TRANSLATIONS.en[key] ?? key;
      if (params && typeof text === 'string') {
        for (const [k, v] of Object.entries(params)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, isRtl: lang === 'ar', t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
