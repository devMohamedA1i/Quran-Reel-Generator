import React, { useEffect, useState, useRef } from 'react';
import { useI18n } from '../../context/I18nContext';
import { api } from '../../services/api';

export default function ReelPreview({
  surah,
  sourceId,
  reel,
  settings,
  selectedBackground,
  onApproveVideo,
  onResetVideo,
}) {
  const { t } = useI18n();
  const [stillUrl, setStillUrl] = useState('');
  const [overlayUrl, setOverlayUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const seqRef = useRef(0);

  const isVideoBg = selectedBackground?.kind === 'video';

  const loadPreview = async () => {
    if (!surah || !settings.background_id) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError('');
    try {
      const payload = {
        surah,
        start: 1,
        end: 1,
        source: sourceId || null,
        background_id: settings.background_id,
        effect: settings.effect,
        resolution: '720',
        font_size: settings.font_size,
        vertical_offset: settings.vertical_offset,
        panel_opacity: settings.panel_opacity,
        text_color: settings.text_color,
        opening_seconds: settings.opening_seconds,
        closing_seconds: settings.closing_seconds,
        reel_mode: true,
        preview_time: reel ? Number(reel.audio_start) : 0,
      };
      if (isVideoBg) {
        const blob = await api.fetchPreviewOverlayBlob(payload);
        if (seq !== seqRef.current) return;
        const url = URL.createObjectURL(blob);
        setOverlayUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } else {
        const blob = await api.fetchPreviewBlob(payload);
        if (seq !== seqRef.current) return;
        const url = URL.createObjectURL(blob);
        setStillUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      }
    } catch (err) {
      if (seq === seqRef.current) {
        setError(err.message || 'Preview error');
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadPreview();
    }, 320);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    surah,
    sourceId,
    reel?.reel,
    settings.background_id,
    settings.effect,
    settings.font_size,
    settings.vertical_offset,
    settings.panel_opacity,
    settings.text_color,
    isVideoBg,
  ]);

  useEffect(() => {
    return () => {
      if (stillUrl) URL.revokeObjectURL(stillUrl);
      if (overlayUrl) URL.revokeObjectURL(overlayUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await onApproveVideo();
      setNotice('Video settings approved.');
    } catch (err) {
      setError(err.message || 'Could not approve video.');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await onResetVideo();
      setNotice('Video settings reset.');
    } catch (err) {
      setError(err.message || 'Could not reset video.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="card preview-panel">
      <div className="preview-head">
        <h3>{t('previewTitle')}</h3>
        <button type="button" className="btn btn-secondary" onClick={loadPreview} disabled={loading}>
          {t('refreshPreview')}
        </button>
      </div>

      <div className="preview-frame-9-16 ltr-island">
        {isVideoBg && selectedBackground ? (
          <>
            <video
              key={selectedBackground.id}
              src={`/api/background/${selectedBackground.id}`}
              autoPlay
              loop
              muted
              playsInline
              className="preview-media"
            />
            {overlayUrl && (
              <img src={overlayUrl} alt="Quran text overlay" className="preview-overlay-img" />
            )}
          </>
        ) : stillUrl ? (
          <img src={stillUrl} alt="9:16 Reel preview" className="preview-media" />
        ) : (
          <div className="preview-placeholder">
            {loading ? t('loadingAssets') : '9:16 Preview'}
          </div>
        )}
      </div>

      <div className="preview-actions">
        <button
          type="button"
          className="btn btn-success"
          onClick={handleApprove}
          disabled={busy || !reel}
        >
          {t('approveVideo')}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleReset}
          disabled={busy || !reel}
        >
          {t('resetVideo')}
        </button>
      </div>

      {notice && <div className="status-banner success">{notice}</div>}
      {error && <div className="status-banner error" role="alert">{error}</div>}
    </aside>
  );
}
