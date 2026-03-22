// features/settings.ts – Settings Dialog

import { esc } from '../core/utils';
import { setConfig } from '../core/storage';
import type { AppConfig } from '../core/storage';
import { toggleHTML } from '../ui/components';

export function openSettings(config: AppConfig): void {
  const existing = document.getElementById('ct-settings-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ct-settings-overlay';
  overlay.className = 'ct-overlay visible';

  overlay.innerHTML = `
    <div class="ct-dialog" style="min-width: 400px;">
      <h3>⚙ Einstellungen</h3>

      ${toggleHTML('ct-set-whc',  'WHC Dashboard', config.features.whcDashboard)}
      ${toggleHTML('ct-set-dre',  'Date Range Extractor', config.features.dateExtractor)}
      ${toggleHTML('ct-set-dp',   'Daily Delivery Performance', config.features.deliveryPerf)}
      ${toggleHTML('ct-set-dvic', 'DVIC Check', config.features.dvicCheck)}
      ${toggleHTML('ct-set-dvic-tp', 'DVIC: Transporter-Spalte', config.features.dvicShowTransporters)}
      ${toggleHTML('ct-set-whd',  'Working Hours Dashboard', config.features.workingHours)}
      ${toggleHTML('ct-set-ret',  'Returns Dashboard', config.features.returnsDashboard)}
      ${toggleHTML('ct-set-sc',   'Scorecard', config.features.scorecard)}
      ${toggleHTML('ct-set-vsa', 'VSA QR Code Generator', config.features.vsaQr)}
      ${toggleHTML('ct-set-dev',  'Dev-Mode (ausführliches Logging)', config.dev)}

      <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
        <button class="ct-btn ct-btn--secondary" id="ct-set-cancel">Abbrechen</button>
        <button class="ct-btn ct-btn--accent" id="ct-set-save">Speichern</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('ct-set-cancel')!.addEventListener('click', () => overlay.remove());

  document.getElementById('ct-set-save')!.addEventListener('click', () => {
    const boolVal = (id: string): boolean =>
      (document.getElementById(id) as HTMLInputElement).checked;

    config.features.whcDashboard        = boolVal('ct-set-whc');
    config.features.dateExtractor       = boolVal('ct-set-dre');
    config.features.deliveryPerf        = boolVal('ct-set-dp');
    config.features.dvicCheck           = boolVal('ct-set-dvic');
    config.features.dvicShowTransporters = boolVal('ct-set-dvic-tp');
    config.features.workingHours        = boolVal('ct-set-whd');
    config.features.returnsDashboard    = boolVal('ct-set-ret');
    config.features.scorecard           = boolVal('ct-set-sc');
    config.features.vsaQr               = boolVal('ct-set-vsa');
    config.dev                          = boolVal('ct-set-dev');

    setConfig(config);
    overlay.remove();
    alert('Einstellungen gespeichert! Seite neu laden für vollständige Aktivierung.');
  });
}
