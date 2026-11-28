import React from 'react';
import { useI18n } from '../../context/I18nContext';
import { formatBytes } from '../../utils/format';

export default function OutputHistory({ outputs, loading }) {
  const { t } = useI18n();

  return (
    <section className="card output-history">
      <div className="output-history-head">
        <h3>{t('outputHistory')}</h3>
        <span className="badge">{outputs.length}</span>
      </div>

      {loading ? (
        <p className="muted-note">{t('loadingAssets')}</p>
      ) : outputs.length === 0 ? (
        <p className="muted-note">{t('noOutputsYet')}</p>
      ) : (
        <ul className="output-list">
          {outputs.map((item) => (
            <li key={item.path} className="output-item">
              <div className="output-item-info">
                <strong className="ltr-island">{item.name}</strong>
                <span className="output-item-path ltr-island">{item.path}</span>
              </div>
              <span className="badge">{formatBytes(item.size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
