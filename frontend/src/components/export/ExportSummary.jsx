import React from 'react';
import { useI18n } from '../../context/I18nContext';
import { api } from '../../services/api';
import { formatTime } from '../../utils/format';

export default function ExportSummary({
  reciter,
  surahInfo,
  surahNum,
  reel,
  sourceId,
}) {
  const { lang, t } = useI18n();

  const alreadyExported = Boolean(reel?.export?.path);
  const audioApproved = Boolean(reel?.audio_approved);
  const videoApproved = Boolean(reel?.video_approved);

  return (
    <section className="card export-summary">
      <h3>{t('exportSummary')}</h3>

      <dl className="export-meta-grid">
        <div>
          <dt>{t('activeReciter')}</dt>
          <dd>{reciter ? (lang === 'ar' ? reciter.name_ar : reciter.name) : '—'}</dd>
        </div>
        <div>
          <dt>{t('activeSurah')}</dt>
          <dd>
            {surahInfo
              ? `${String(surahInfo.number).padStart(3, '0')} — ${surahInfo.name} (${surahInfo.englishName})`
              : `Surah ${surahNum}`}
          </dd>
        </div>
        <div>
          <dt>{t('activeReel')}</dt>
          <dd>{reel ? t('reelLabel', { num: reel.reel }) : '—'}</dd>
        </div>
        <div>
          <dt>{t('audioRange')}</dt>
          <dd className="ltr-island">
            {reel
              ? `${formatTime(reel.audio_start)} → ${formatTime(reel.audio_end)} (${formatTime(
                  Math.max(0, Number(reel.audio_end) - Number(reel.audio_start))
                )})`
              : '—'}
          </dd>
        </div>
      </dl>

      <div className="readiness-row">
        <span className={`badge ${audioApproved ? 'badge-success' : 'badge-error'}`}>
          {audioApproved ? '✓' : '✕'} {t('audioApprovalCheck')}
        </span>
        <span className={`badge ${videoApproved ? 'badge-success' : 'badge-error'}`}>
          {videoApproved ? '✓' : '✕'} {t('videoApprovalCheck')}
        </span>
      </div>

      {alreadyExported && reel && (
        <div className="export-result-box">
          <h4>{t('exportResult')}</h4>
          <p className="export-result-path ltr-island">{reel.export.path}</p>
          <video
            controls
            className="export-player ltr-island"
            src={api.draftVideoUrl(surahNum, reel.reel, sourceId)}
          />
        </div>
      )}
    </section>
  );
}
