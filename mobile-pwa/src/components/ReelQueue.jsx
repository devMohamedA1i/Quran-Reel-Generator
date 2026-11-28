import React, { useState } from 'react';
import { formatTime, toArabicDigits } from '../data/i18n';

// Exact port of desktop ayah_data.py propose_reels_from() + reel_planner.py fallback
export const TARGET_REEL_SEC = 180.0;

function formatTimeDec(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const rStr = r.toFixed(1).padStart(4, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${rStr}`;
  return `${String(m).padStart(2, '0')}:${rStr}`;
}

export function buildProposedReels(duration, pauses = [], timings = [], targetSec = TARGET_REEL_SEC) {
  if (!duration || duration <= 0.5) return [];

  // 1. Primary path (exact desktop ayah_data.py propose_reels_from):
  // Every reel starts at 0 / previous end and waits until an Ayah ends at >= 180.0s,
  // so every reel ends cleanly on a complete Ayah boundary (matching Mac to the exact 0.1s!).
  const ayahEntries = Array.isArray(timings)
    ? timings.filter((e) => Number(e.ayah) > 0 && Number.isFinite(e.end) && e.end > 0)
    : [];

  if (ayahEntries.length) {
    const reels = [];
    let start = 0;
    let idx = 1;
    for (const entry of ayahEntries) {
      if (entry.end - start < targetSec) continue;
      reels.push({
        reel: idx,
        start: Number(start.toFixed(3)),
        end: Number(Math.min(duration, entry.end).toFixed(3)),
        exported: false,
      });
      start = entry.end;
      idx += 1;
    }
    if (start < duration - 0.01) {
      // Guard: if timing JSON ends much earlier than the MP3 (e.g. Murattal timings vs 4h Mujawwad MP3),
      // keep slicing the remaining audio into clean ~3-minute reels instead of one giant multi-hour final reel!
      let pos = start;
      while (pos < duration - 0.02 && idx <= 500) {
        const rem = duration - pos;
        const end = rem <= targetSec + 15 ? duration : Math.min(duration, pos + targetSec);
        reels.push({
          reel: idx,
          start: Number(pos.toFixed(3)),
          end: Number(end.toFixed(3)),
          exported: false,
        });
        pos = end;
        idx += 1;
      }
    }
    if (reels.length) return reels;
  }

  // 2. Fallback when no per-reciter timing JSON exists (e.g. Al-Ajmi): exact reel_planner.py
  const good = pauses
    .map((p) => (typeof p === 'number' ? p : p.mid))
    .filter((p) => Number.isFinite(p) && p > 0 && p < duration)
    .sort((a, b) => a - b);

  const reels = [];
  let pos = 0;
  let idx = 1;
  while (pos < duration - 0.02 && idx <= 500) {
    const remaining = duration - pos;
    let end;
    if (remaining <= targetSec + 15) {
      end = duration;
    } else {
      const minP = Math.max(pos + 30, pos + targetSec - 35);
      const maxP = Math.min(duration - 10, pos + targetSec + 35);
      const near = good.filter((p) => p >= minP && p <= maxP);
      if (near.length) {
        near.sort((a, b) => Math.abs(a - (pos + targetSec)) - Math.abs(b - (pos + targetSec)) || a - b);
        end = near[0];
      } else {
        end = Math.min(duration, pos + targetSec);
      }
    }
    if (end <= pos + 0.01) break;
    reels.push({ reel: idx, start: Number(pos.toFixed(3)), end: Number(end.toFixed(3)), exported: false });
    pos = end;
    idx += 1;
  }
  return reels;
}

/**
 * Keep subsequent reels continuous whenever a reel's end boundary changes (no gaps or overlaps).
 */
export function rebalanceReels(prevReels, editedReelNum, nextStart, nextEnd, totalDuration, pauses = [], timings = []) {
  const before = prevReels.filter((r) => r.reel < editedReelNum);
  const current = prevReels.find((r) => r.reel === editedReelNum) || { reel: editedReelNum, exported: false };
  const updated = { ...current, start: nextStart, end: nextEnd };
  const result = [...before, updated];

  const remaining = totalDuration - nextEnd;
  if (remaining > 1.5) {
    const shiftedPauses = pauses
      .map((p) => (typeof p === 'number' ? p - nextEnd : p.mid - nextEnd))
      .filter((p) => p > 0);
    const shiftedTimings = Array.isArray(timings)
      ? timings
          .filter((e) => Number(e.ayah) > 0 && e.end > nextEnd + 0.5)
          .map((e) => ({ ...e, start: Math.max(0, e.start - nextEnd), end: e.end - nextEnd }))
      : [];
    const tail = buildProposedReels(remaining, shiftedPauses, shiftedTimings, TARGET_REEL_SEC);
    let num = editedReelNum + 1;
    for (const seg of tail) {
      const existing = prevReels.find((r) => r.reel === num);
      result.push({
        reel: num,
        start: Number((nextEnd + seg.start).toFixed(3)),
        end: Number(Math.min(totalDuration, nextEnd + seg.end).toFixed(3)),
        exported: Boolean(existing?.exported),
      });
      num += 1;
    }
  }
  return result;
}

export default function ReelQueue({ reels, activeReelNum, onSelectReel, lang, t }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!reels.length) {
    return (
      <div className="mac-card mac-queue-card" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="mac-queue-head">
          <span className="mac-card-title" style={{ margin: 0 }}>
            {t.reelQueue} <span className="mac-queue-count">(0 {t.reelsUnit})</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mac-card mac-queue-card" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <button
        type="button"
        className="mac-queue-toggle"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="mac-card-title" style={{ margin: 0 }}>
          {t.reelQueue}{' '}
          <span className="mac-queue-count">
            ({lang === 'ar' ? toArabicDigits(reels.length) : reels.length} {t.reelsUnit})
          </span>
        </span>
        <span className={`mac-chevron ${collapsed ? '' : 'up'}`} aria-hidden="true">▾</span>
      </button>

      {!collapsed && (
        <ul className="mac-queue-list">
          {reels.map((r) => {
            const isActive = r.reel === activeReelNum;
            const rLabel = lang === 'ar'
              ? `${t.reelPrefix} ${toArabicDigits(String(r.reel).padStart(2, '0'))}`
              : `${t.reelPrefix} ${String(r.reel).padStart(2, '0')}`;
            return (
              <li key={r.reel}>
                <button
                  type="button"
                  className={`mac-queue-item ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectReel(r)}
                >
                  <span className="mac-queue-name">{rLabel}</span>
                  <span className="mac-queue-range" dir="ltr">
                    {formatTimeDec(r.start)} – {formatTimeDec(r.end)}
                  </span>
                  <span className={`mac-queue-state ${isActive ? 'is-active-pill' : r.exported ? 'is-exported' : ''}`}>
                    {isActive ? t.activePill : r.exported ? t.statusExported : t.statusDraft}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
