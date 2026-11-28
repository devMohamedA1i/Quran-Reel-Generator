import React, { useState } from 'react';
import { useI18n } from '../../context/I18nContext';

export default function VerifyFilesStep({ reciter, verification, onVerify }) {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);

  if (!reciter) return null;

  const handleVerify = async () => {
    setChecking(true);
    try {
      await onVerify(reciter.id);
    } finally {
      setChecking(false);
    }
  };

  const status = verification?.status;

  return (
    <section className="setup-card verify-card" aria-labelledby="step3-heading">
      <div className="verify-header-row">
        <h2 id="step3-heading" className="setup-step-title">
          {t('verifyQuranFiles')}
        </h2>
        <button
          type="button"
          className="verify-btn"
          onClick={handleVerify}
          disabled={checking}
        >
          <span className="verify-btn-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="8.5 12.5 11 15 16 9.5" />
            </svg>
          </span>
          <span>{checking ? t('verifying') : t('verifyBtn')}</span>
        </button>
      </div>

      {verification && (
        <div className="verify-result-wrap" role="status" aria-live="polite">
          {status === 'verified' ? (
            <div className="verify-banner is-verified">
              <span className="verify-banner-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </span>
              <div className="verify-banner-body">
                <strong className="verify-banner-title">
                  {status === 'not_found'
                    ? t('downloadQuranAudio')
                    : status === 'incomplete'
                      ? t('incompleteTitle')
                      : t('invalidTitle')}
                </strong>
                <span className="verify-banner-detail">
                  {' — '}
                  {status === 'not_found'
                    ? t('verifyGuidanceMissing')
                    : status === 'incomplete'
                      ? t('verifyGuidanceSample')
                      : verification.message}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
