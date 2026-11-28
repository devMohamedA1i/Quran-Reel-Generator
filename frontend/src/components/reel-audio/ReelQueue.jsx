import React, { useRef, useState } from 'react';
import { useI18n } from '../../context/I18nContext';
import { useContainWheel } from '../../hooks/useContainWheel';
import { formatTime } from '../../utils/format';

function statusBadge(reel, t) {
  if (reel.status === 'exported' || reel.export?.path) {
    return { label: t('statusExported'), cls: 'badge-success' };
  }
  if (reel.video_approved) {
    return { label: t('statusVideoApproved'), cls: 'badge-success' };
  }
  if (reel.audio_approved) {
    return { label: t('statusAudioApproved'), cls: 'badge-gold' };
  }
  return { label: t('statusDraft'), cls: '' };
}

export default function ReelQueue({ reels, selectedReelNum, onSelectReel, loading }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const listRef = useRef(null);
  useContainWheel(listRef, [reels.length, loading, expanded]);

  return (
    <aside className="reel-queue card" aria-label={t('reelQueue')}>
      <button
        type="button"
        className="qvs-queue-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="qvs-queue-heading">
          <span>{t('reelQueue')}</span>
          <span className="qvs-queue-count">
            {loading ? `(${t('loadingAssets')})` : t('reelsCount', { count: reels.length })}
          </span>
        </span>
        <span className={`qvs-queue-chevron ${expanded ? '' : 'collapsed'}`} aria-hidden="true">
          ⌃
        </span>
      </button>

      {expanded && reels.length > 0 && (
        <ul ref={listRef} className={`reel-queue-list ${loading ? 'is-loading' : ''}`}>
          {reels.map((reel) => {
            const active = Number(reel.reel) === Number(selectedReelNum);
            const badge = statusBadge(reel, t);
            return (
              <li key={reel.reel}>
                <button
                  type="button"
                  className={`reel-queue-item ${active ? 'active' : ''}`}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onSelectReel(reel.reel)}
                >
                  <span className="qvs-reel-name">
                    {t('reelLabel', { num: String(reel.reel).padStart(2, '0') })}
                  </span>
                  <span className="reel-queue-item-times ltr-island">
                    {formatTime(reel.audio_start)} – {formatTime(reel.audio_end)}
                  </span>
                  <span className={`qvs-reel-state ${active ? 'is-active-pill' : ''}`}>
                    {active ? t('statusActive') : badge.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
