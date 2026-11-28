import { toArabicDigits } from '../data/i18n';

export const STAGE_W = 720;
export const STAGE_H = 1280;

export function parseEffects(effectStr) {
  const list = String(effectStr || 'none')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'none');
  return list.length ? list : ['none'];
}

export function getEffectCssFilter(effectStr) {
  const effects = parseEffects(effectStr);
  const parts = [];
  for (const effect of effects) {
    switch (effect) {
      case 'soft_dim': parts.push('brightness(0.76) contrast(1.04)'); break;
      case 'night_calm': parts.push('brightness(0.68) contrast(1.08) saturate(0.82) hue-rotate(-10deg)'); break;
      case 'golden_hour': parts.push('brightness(0.95) sepia(0.28) saturate(1.22)'); break;
      case 'emerald_mist': parts.push('brightness(0.84) saturate(1.1) hue-rotate(28deg)'); break;
      case 'warm_cinematic': parts.push('brightness(0.92) contrast(1.06) sepia(0.18) saturate(1.15)'); break;
      case 'cool_cinematic': parts.push('brightness(0.9) contrast(1.06) saturate(0.92) hue-rotate(-16deg)'); break;
      case 'muted_tone': parts.push('brightness(0.86) saturate(0.62) contrast(0.98)'); break;
      case 'crisp_clear': parts.push('contrast(1.12) saturate(1.08)'); break;
      case 'vintage': parts.push('sepia(0.38) contrast(0.95) brightness(0.9)'); break;
      case 'monochrome': parts.push('grayscale(1) contrast(1.08) brightness(0.88)'); break;
      case 'soft_focus': parts.push('blur(4px) brightness(0.86)'); break;
      default: break;
    }
  }
  return parts.length ? parts.join(' ') : 'none';
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = '';
  for (const w of words) {
    const trial = current ? `${current} ${w}` : w;
    if (current && ctx.measureText(trial).width > maxWidth) {
      lines.push(current);
      current = w;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

let cardCacheCanvas = null;
let cardCacheCtx = null;
let cardCacheKey = '';

function getCardCacheKey(verse, settings) {
  return [
    verse.ayah,
    verse.arabic,
    verse.english || '',
    verse.surahNameAr || '',
    verse.surahNameEn || '',
    Number(settings.fontSize || 42),
    settings.showSurahName ? 1 : 0,
    settings.showAyahNum ? 1 : 0,
    settings.showEnglish ? 1 : 0,
    Number(settings.backdropAlpha ?? 155),
    settings.textColor || '#FFFFFF',
    Number(settings.verticalOffset || 0),
  ].join('|');
}

/**
 * Exact JS port of desktop renderer.py build_bilingual_overlay():
 * Order: Arabic verse -> English translation (if EN) -> Surah name AR (bottom) -> Surah name EN (bottom, if EN).
 * Panel: midnight navy rgba(5, 12, 24, boxAlpha), radius 26, x=35..W-35, padY=24.
 * Caches the rendered Ayah card onto a reusable offscreen layer so repeated frames stamp in <0.1ms
 * instead of re-shaping Arabic Uthmani calligraphy on every single video frame.
 */
function paintQuranCard(ctx, { verse, settings }) {
  const W = STAGE_W;
  const H = STAGE_H;
  if (!verse || !verse.arabic || verse.alpha <= 0.01) return;

  const key = getCardCacheKey(verse, settings);
  if (typeof document !== 'undefined') {
    if (!cardCacheCanvas) {
      cardCacheCanvas = document.createElement('canvas');
      cardCacheCanvas.width = W;
      cardCacheCanvas.height = H;
      cardCacheCtx = cardCacheCanvas.getContext('2d');
    }
    if (cardCacheKey !== key && cardCacheCtx) {
      cardCacheCtx.clearRect(0, 0, W, H);
      renderQuranCardOpaque(cardCacheCtx, { verse, settings });
      cardCacheKey = key;
    }
    if (cardCacheCanvas && cardCacheKey === key) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, verse.alpha));
      ctx.drawImage(cardCacheCanvas, 0, 0);
      ctx.restore();
      return;
    }
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, verse.alpha));
  renderQuranCardOpaque(ctx, { verse, settings });
  ctx.restore();
}

function renderQuranCardOpaque(ctx, { verse, settings }) {
  const W = STAGE_W;
  const H = STAGE_H;
  const maxW = W - 126;
  const requestedSize = Number(settings.fontSize || 42);
  const showSurahName = Boolean(settings.showSurahName);
  const showAyahNum = Boolean(settings.showAyahNum);
  const showEnglish = Boolean(settings.showEnglish && verse.english);
  const showSurahAr = Boolean(showSurahName && verse.surahNameAr);
  const showSurahEn = Boolean(showSurahName && settings.showEnglish && verse.surahNameEn);
  const boxAlpha = Number(settings.backdropAlpha ?? 155) / 255;
  const textColor = settings.textColor || '#FFFFFF';
  const offsetY = Number(settings.verticalOffset || 0);

  let arText = verse.arabic;
  if (showAyahNum && verse.ayah > 0) {
    arText = `${arText} ﴿${toArabicDigits(verse.ayah)}﴾`;
  }

  let arSize = requestedSize;
  let arLines = [];
  let enLines = [];
  let enSize = Math.max(18, Math.round(arSize * 0.58));

  while (arSize >= 18) {
    ctx.font = `${arSize}px "UthmanicHafs", "Geeza Pro", serif`;
    arLines = wrapText(ctx, arText, maxW);
    enSize = Math.max(18, Math.round(arSize * 0.58));
    if (showEnglish) {
      ctx.font = `${enSize}px Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      enLines = wrapText(ctx, verse.english, maxW);
    } else {
      enLines = [];
    }
    const astep = arSize * 1.65;
    const estep = enSize * 1.4;
    const total =
      arLines.length * astep +
      (enLines.length ? 24 + enLines.length * estep : 0) +
      (showSurahAr ? 44 : 0) +
      (showSurahEn ? 34 : 0);
    if (total <= H - 240) break;
    arSize -= 1;
  }

  const arStep = arSize * 1.65;
  const enStep = enSize * 1.4;
  const enGap = enLines.length ? 24 : 0;
  const surahArH = showSurahAr ? 44 : 0;
  const surahEnH = showSurahEn ? 34 : 0;
  const total = arLines.length * arStep + enGap + enLines.length * enStep + surahArH + surahEnH;

  const cy = Math.max(100 + total / 2, Math.min(H - 100 - total / 2, H / 2 + offsetY));
  let top = cy - total / 2;

  // Exact desktop midnight-navy translucent panel
  if (boxAlpha > 0.02) {
    ctx.fillStyle = `rgba(5, 12, 24, ${boxAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.roundRect(35, top - 24, W - 70, total + 48, 26);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 1. Arabic Uthmani lines with subtle #0b1525 stroke (exact renderer.py)
  ctx.save();
  ctx.direction = 'rtl';
  ctx.font = `${arSize}px "UthmanicHafs", "Geeza Pro", serif`;
  ctx.fillStyle = textColor;
  ctx.strokeStyle = '#0b1525';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const line of arLines) {
    const yMid = top + arStep / 2;
    ctx.strokeText(line, W / 2, yMid);
    ctx.fillText(line, W / 2, yMid);
    top += arStep;
  }
  ctx.restore();

  // 2. English translation lines (when EN mode is active)
  if (enLines.length) {
    top += enGap;
    ctx.save();
    ctx.direction = 'ltr';
    ctx.font = `${enSize}px Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = textColor;
    for (const line of enLines) {
      ctx.fillText(line, W / 2, top + enStep / 2);
      top += enStep;
    }
    ctx.restore();
  }

  // 3. Surah name in Arabic at the BOTTOM (exact renderer.py)
  if (showSurahAr) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.font = `26px "UthmanicHafs", "Geeza Pro", serif`;
    ctx.fillStyle = textColor;
    ctx.fillText(verse.surahNameAr, W / 2, top + 22);
    ctx.restore();
    top += 44;
  }

  // 4. Surah name in English below Arabic Surah name (exact renderer.py)
  if (showSurahEn) {
    ctx.save();
    ctx.direction = 'ltr';
    ctx.font = `21px Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillStyle = textColor;
    ctx.fillText(verse.surahNameEn, W / 2, top + 17);
    ctx.restore();
    top += 34;
  }
}

/**
 * Draw only the transparent Quran text overlay (used on top of the live HTML <video> on iPhone/Android).
 */
export function drawOverlayOnly(ctx, { verse = null, settings = {} }) {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  paintQuranCard(ctx, { verse, settings });
}

/**
 * Draw one complete 720x1280 frame (background + effects + Uthmani Quran text overlay).
 */
export function drawReelFrame(ctx, {
  mediaEl,
  mediaKind = 'video',
  blendEl = null,
  blendAlpha = 0,
  elapsedSec = 0,
  totalSec = 10,
  verse = null,
  settings = {},
}) {
  const W = STAGE_W;
  const H = STAGE_H;

  ctx.save();
  ctx.fillStyle = '#121614';
  ctx.fillRect(0, 0, W, H);

  // 1. Background video/image with cover crop + stackable effects + motion
  const effects = parseEffects(settings.effect || 'none');
  const hasZoom = effects.includes('slow_zoom');
  const hasPan = effects.includes('pan');
  const hasSoftFocus = effects.includes('soft_focus');
  const hasVignette = effects.includes('vignette');

  if (mediaEl) {
    const isSample = mediaKind === 'sample';
    const mw = isSample
      ? mediaEl.displayWidth
      : mediaKind === 'video'
        ? mediaEl.videoWidth
        : mediaKind === 'bitmap'
          ? mediaEl.width
          : mediaEl.naturalWidth;
    const mh = isSample
      ? mediaEl.displayHeight
      : mediaKind === 'video'
        ? mediaEl.videoHeight
        : mediaKind === 'bitmap'
          ? mediaEl.height
          : mediaEl.naturalHeight;
    if (mw > 0 && mh > 0) {
      ctx.save();
      const filter = getEffectCssFilter(settings.effect);
      if (filter !== 'none') ctx.filter = filter;

      const progress = totalSec > 0 ? Math.min(1, elapsedSec / totalSec) : 0;
      let scale = Math.max(W / mw, H / mh);
      let shiftX = 0;
      if (hasZoom) {
        scale *= 1 + 0.14 * progress;
      } else if (hasPan) {
        scale *= 1.16;
        shiftX = (progress - 0.5) * W * 0.12;
      } else if (hasSoftFocus) {
        scale *= 1.04;
      }
      const dw = mw * scale;
      const dh = mh * scale;
      const dx = (W - dw) / 2 + shiftX;
      const dy = (H - dh) / 2;
      if (isSample) {
        mediaEl.draw(ctx, dx, dy, dw, dh);
      } else {
        ctx.drawImage(mediaEl, dx, dy, dw, dh);
      }
      if (blendEl && blendAlpha > 0.01) {
        ctx.globalAlpha = Math.max(0, Math.min(1, blendAlpha));
        if (isSample && typeof blendEl.draw === 'function') {
          blendEl.draw(ctx, dx, dy, dw, dh);
        } else {
          ctx.drawImage(blendEl, dx, dy, dw, dh);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  // Vignette overlay
  if (hasVignette) {
    const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, H * 0.65);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.68)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Subtle readability scrim
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(0, 0, W, H);

  // 2. Quran Text Overlay (exact desktop renderer.py layout)
  paintQuranCard(ctx, { verse, settings });

  ctx.restore();
}
