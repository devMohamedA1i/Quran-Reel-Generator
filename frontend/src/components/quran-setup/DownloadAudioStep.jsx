import React, { useEffect, useState, useRef } from 'react';
import { useI18n } from '../../context/I18nContext';
import { api } from '../../services/api';
import { formatBytes, padSurah } from '../../utils/format';

export default function DownloadAudioStep({
  reciter,
  verification,
  onVerify,
  onCompleted,
  onFolderSelected,
}) {
  const { lang, t } = useI18n();
  const [dlState, setDlState] = useState(null);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    let active = true;
    setDlState(null);
    if (!reciter?.id) return () => {};

    api.getReciterDownloadStatus(reciter.id)
      .then((data) => {
        if (active) setDlState(data);
      })
      .catch(() => {});

    return () => {
      active = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [reciter?.id]);

  useEffect(() => {
    if (dlState?.state !== 'downloading' || !reciter?.id) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const data = await api.getReciterDownloadStatus(reciter.id);
        setDlState(data);
        if (data.state === 'completed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          onCompleted?.();
        } else if (data.state === 'error' || data.state === 'cancelled') {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // keep polling transiently
      }
    }, 450);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [dlState?.state, reciter?.id, onCompleted]);

  if (!reciter) return null;

  const reciterName = lang === 'ar' ? reciter.name_ar : reciter.name;
  const savePath = dlState?.display_path || reciter.display_path;
  const status = dlState?.state || (reciter.installed ? 'completed' : 'idle');
  const isDownloading = status === 'downloading';
  const isCompleted = status === 'completed';
  const isError = status === 'error';

  const handleStart = async () => {
    if (isDownloading || isCompleted) return;
    try {
      const data = await api.startReciterDownload(reciter.id);
      setDlState(data);
      if (data.state === 'completed') {
        onCompleted?.();
      }
    } catch (err) {
      setDlState((prev) => ({
        ...(prev || {}),
        state: 'error',
        error: err.message,
      }));
    }
  };

  const percent = Math.max(0, Math.min(100, Number(dlState?.percent || 0)));
  const currentSurah = padSurah(dlState?.current_surah || 1);
  const loadedLabel = formatBytes(dlState?.current_bytes || 0);
  const totalLabel = formatBytes(dlState?.current_total_bytes || 0);
  const verifyStatus = verification?.status;

  const handleVerifyClick = async () => {
    if (!onVerify) return;
    setChecking(true);
    try {
      await onVerify(reciter.id);
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="setup-card" aria-labelledby="step2-heading">
      <div className="setup-step-header">
        <h2 id="step2-heading" className="setup-step-title">
          {t('downloadQuranAudio')} — <span className="gold-accent">{reciterName}</span>
        </h2>
        <div className="setup-header-actions">
          <button
            type="button"
            className="verify-btn"
            onClick={async () => {
              try {
                const res = await api.selectAudioFolder();
                if (res?.ok) {
                  onFolderSelected?.();
                }
              } catch {
                // ignore cancelled/failed dialog
              }
            }}
          >
            {t('selectAudioFolder')}
          </button>
          <button
            type="button"
            className="verify-btn"
            onClick={handleVerifyClick}
            disabled={checking}
          >
            <span className="verify-btn-icon" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="8.5 12.5 11 15 16 9.5" />
              </svg>
            </span>
            <span>{checking ? t('verifying') : t('verifyBtn')}</span>
          </button>
        </div>
      </div>

      {/* Inline status / guidance banner directly above Download button */}
      <div className="verify-inline-wrap" role="status" aria-live="polite">
        {verifyStatus === 'verified' ? (
          <div className="verify-banner is-verified">
            <span className="verify-banner-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="8.5 12.5 11 15 16 9.5" />
              </svg>
            </span>
            <div className="verify-banner-body">
              <strong className="verify-banner-title">{t('verifiedTitle')}</strong>
              <span className="verify-banner-detail"> — {t('verifiedDetail')}</span>
            </div>
          </div>
        ) : (
          <div className="verify-banner is-guide">
            <span className="verify-banner-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </span>
            <div className="verify-banner-body">
              <span className="verify-banner-detail">
                {verifyStatus === 'incomplete'
                  ? t('verifyGuidanceSample')
                  : t('audioNeededGuide')}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="download-action-wrap">
        {isDownloading ? (
          <button
            type="button"
            className="download-btn is-downloading"
            aria-live="polite"
            disabled
          >
            <span className="download-btn-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </span>
            <span className="download-btn-progress-col">
              <span className="download-btn-progress-text">
                {t('downloadingSurah', {
                  surah: currentSurah,
                  loaded: loadedLabel,
                  total: totalLabel,
                })}
              </span>
              <span className="download-btn-track" aria-hidden="true">
                <span className="download-btn-fill" style={{ width: `${percent}%` }} />
              </span>
            </span>
            <span className="download-btn-percent">{percent}%</span>
          </button>
        ) : isCompleted ? (
          <button
            type="button"
            className="download-btn is-completed"
            disabled
          >
            <span className="download-btn-check" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="8.5 12.5 11 15 16 9.5" />
              </svg>
            </span>
            <span>{t('downloadCompleted')}</span>
          </button>
        ) : (
          <button
            type="button"
            className="download-btn is-idle"
            onClick={handleStart}
          >
            <span className="download-btn-icon-plain" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </span>
            <span>{isError ? t('retryDownload') : t('downloadBtn')}</span>
          </button>
        )}
      </div>

      {isError && dlState?.error && (
        <p className="download-error-note" role="alert">
          {dlState.error}
        </p>
      )}
    </section>
  );
}
