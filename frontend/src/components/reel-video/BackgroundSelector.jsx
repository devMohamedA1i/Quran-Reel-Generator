import React, { useState, useRef } from 'react';
import { useI18n } from '../../context/I18nContext';
import { useContainWheel } from '../../hooks/useContainWheel';
import { api } from '../../services/api';

export default function BackgroundSelector({
  backgrounds,
  selectedId,
  onSelect,
  onImported,
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('video');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);
  const gridRef = useRef(null);
  useContainWheel(gridRef);

  const videoCount = backgrounds.filter((b) => b.kind === 'video').length;
  const imageCount = backgrounds.filter((b) => b.kind === 'image').length;
  const filtered = backgrounds.filter((b) => filter === 'all' || b.kind === filter);

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const isVideo =
      files[0].type.startsWith('video/') ||
      /\.(mp4|mov|m4v|webm)$/i.test(files[0].name);
    setImporting(true);
    setImportError('');
    try {
      await api.importBackgrounds(isVideo ? 'video' : 'image', files);
      await onImported?.();
    } catch (err) {
      setImportError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="qvs-bg-section">
      <div className="qvs-section-heading">
        <h2>Background &amp; Effects</h2>
        <p>{backgrounds.length} available</p>
      </div>

      <div className="qvs-media-toolbar">
        <button
          type="button"
          className={`qvs-media-tab ${filter === 'video' ? 'active' : ''}`}
          onClick={() => setFilter('video')}
        >
          <span>▷ {t('videosOnly')}</span>
          <span className="qvs-tab-count">{videoCount}</span>
        </button>
        <button
          type="button"
          className={`qvs-media-tab ${filter === 'image' ? 'active' : ''}`}
          onClick={() => setFilter('image')}
        >
          <span>▧ {t('imagesOnly')}</span>
          <span className="qvs-tab-count">{imageCount}</span>
        </button>
        <button
          type="button"
          className="qvs-folder-button"
          title={t('importBackground')}
          aria-label={t('importBackground')}
          disabled={importing}
          onClick={() => fileRef.current?.click()}
        >
          📂
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
        />
      </div>

      {importError && (
        <div className="status-banner error" role="alert">
          {importError}
        </div>
      )}

      <div ref={gridRef} className="bg-grid">
        {filtered.map((bg) => {
          const active = bg.id === selectedId;
          return (
            <button
              key={bg.id}
              type="button"
              className={`bg-tile ${active ? 'active' : ''}`}
              title={bg.filename}
              onClick={() => onSelect(bg.id)}
            >
              {bg.kind === 'video' ? (
                <video
                  src={`/api/background/${bg.id}`}
                  muted
                  preload="none"
                  playsInline
                  onMouseEnter={(e) => {
                    if (e.currentTarget.preload === 'none') {
                      e.currentTarget.preload = 'metadata';
                    }
                  }}
                />
              ) : (
                <img src={`/api/background/${bg.id}`} alt={bg.name} loading="lazy" />
              )}
              <small className="bg-tile-label">{bg.name}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
