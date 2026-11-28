import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Load Uthmani Hafs v18 with subpath-safe relative URL (works on GitHub Pages)
if (typeof FontFace !== 'undefined') {
  const font = new FontFace('UthmanicHafs', "url('./data/fonts/UthmanicHafs1Ver18.ttf')");
  font.load().then((loaded) => document.fonts.add(loaded)).catch(() => {});
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
