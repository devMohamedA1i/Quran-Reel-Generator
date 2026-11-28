import React from 'react';
import { useI18n } from '../../context/I18nContext';
import { useApp } from '../../context/AppContext';

const TABS = [
  { id: 'setup', labelKey: 'navSetup', step: '1' },
  { id: 'audio', labelKey: 'navAudio', step: '2' },
  { id: 'video', labelKey: 'navVideo', step: '3' },
  { id: 'export', labelKey: 'navExport', step: '4' },
];

export default function PrimaryNav() {
  const { t } = useI18n();
  const { activeTab, setActiveTab, isVerified } = useApp();

  return (
    <nav className="primary-nav" aria-label="Primary sections">
      <div className="primary-nav-inner" role="tablist">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const locked = tab.id !== 'setup' && !isVerified;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-tab={tab.id}
              className={`primary-nav-tab ${isActive ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(tab.id);
                const el = document.getElementById(`section-${tab.id}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              <span className="tab-step">{tab.step}</span>
              <span className="tab-label">{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
