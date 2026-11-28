import React from 'react';
import { useI18n } from '../../context/I18nContext';

const EFFECTS = [
  { value: 'fade', label: 'Soft fade' },
  { value: 'slow_zoom', label: 'Gentle zoom' },
  { value: 'pan', label: 'Slow side-to-side pan' },
  { value: 'fade_slow', label: 'Slow cinematic fade' },
  { value: 'fade_fast', label: 'Quick fade' },
  { value: 'monochrome', label: 'Black & white' },
  { value: 'warm_cinematic', label: 'Warm Cinematic' },
  { value: 'cool_cinematic', label: 'Cool Cinematic' },
  { value: 'vintage', label: 'Vintage Film' },
  { value: 'soft_focus', label: 'Soft Focus' },
  { value: 'vignette', label: 'Subtle Vignette' },
  { value: 'none', label: 'No Effects' },
];

const FONT_SIZES = [
  { value: 30, label: 'Small' },
  { value: 42, label: 'Medium' },
  { value: 54, label: 'Large' },
  { value: 68, label: 'Extra Large' },
  { value: 80, label: 'Maximum' },
];

const POSITIONS = [
  { value: -180, label: 'Top' },
  { value: -90, label: 'Upper' },
  { value: 0, label: 'Centre' },
  { value: 90, label: 'Lower' },
  { value: 180, label: 'Bottom' },
];

const BACKDROPS = [
  { value: 0, label: 'Transparent' },
  { value: 80, label: 'Light' },
  { value: 155, label: 'Balanced' },
  { value: 205, label: 'Dark' },
  { value: 235, label: 'Strong' },
];

const COLOURS = [
  { value: '#FFFFFF', label: 'White' },
  { value: '#FFFFF0', label: 'Ivory' },
  { value: '#F5F5DC', label: 'Beige' },
  { value: '#F8E6C0', label: 'Warm ivory' },
  { value: '#D4AF37', label: 'Gold' },
  { value: '#FFD700', label: 'Golden Yellow' },
  { value: '#FFDE9A', label: 'Champagne' },
  { value: '#D9F0FF', label: 'Ice white' },
  { value: '#BCEEE6', label: 'Mint' },
  { value: '#FFD2DE', label: 'Rose' },
  { value: '#C0C0C0', label: 'Silver' },
  { value: '#000000', label: 'Black' },
];

export default function VideoSettingsForm({ settings, onChange, saveState, onResetDefaults }) {
  const { t } = useI18n();

  const update = (key, value) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className="qvs-effect-section">
      <div className="qvs-effect-fields">
        <div className="qvs-field">
          <label htmlFor="videoEffect">Video Effects</label>
          <select
            id="videoEffect"
            value={settings.effect}
            onChange={(e) => update('effect', e.target.value)}
          >
            {EFFECTS.map((ef) => (
              <option key={ef.value} value={ef.value}>{ef.label}</option>
            ))}
          </select>
        </div>

        <div className="qvs-field">
          <label htmlFor="videoFontSize">
            Text size <output>{settings.font_size}</output>
          </label>
          <select
            id="videoFontSize"
            value={settings.font_size}
            onChange={(e) => update('font_size', Number(e.target.value))}
          >
            {FONT_SIZES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="qvs-field">
          <label htmlFor="videoVerticalOffset">
            Position <output>{settings.vertical_offset}</output>
          </label>
          <select
            id="videoVerticalOffset"
            value={settings.vertical_offset}
            onChange={(e) => update('vertical_offset', Number(e.target.value))}
          >
            {POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="qvs-field">
          <label htmlFor="videoPanelOpacity">
            Backdrop <output>{settings.panel_opacity}</output>
          </label>
          <select
            id="videoPanelOpacity"
            value={settings.panel_opacity}
            onChange={(e) => update('panel_opacity', Number(e.target.value))}
          >
            {BACKDROPS.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        <div className="qvs-field">
          <label htmlFor="videoTextColor">Colour</label>
          <select
            id="videoTextColor"
            value={settings.text_color}
            onChange={(e) => update('text_color', e.target.value)}
          >
            {COLOURS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="qvs-settings-footer">
        <button type="button" className="qvs-reset-effects" onClick={onResetDefaults}>
          ↺ Reset settings
        </button>
        {saveState === 'saving' && <span className="badge badge-gold">{t('saving')}</span>}
        {saveState === 'saved' && <span className="badge badge-success">{t('saved')}</span>}
      </div>
    </div>
  );
}
