// features/delivery-performance.ts – Daily Delivery Performance Dashboard

import { log, err, esc, todayStr, withRetry, getCSRFToken } from '../core/utils';
import { onDispose } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';

// ── Field-type classification maps ────────────────────────────────────────────

export const DP_STRING_FIELDS = new Set([
  'country', 'station_code', 'program',
  'country_dspid_stationcode', 'country_program_stationcode',
  'region', 'dsp_code', 'country_program_dspid_stationcode',
  'country_stationcode', 'country_program_data_date',
]);

export const DP_INT_FIELDS = new Set([
  'delivered', 'unbucketed_delivery_misses', 'address_not_found',
  'return_to_station_utl', 'return_to_station_uta', 'customer_not_available',
  'return_to_station_all', 'successful_c_return_pickups', 'rts_other',
  'dispatched', 'transferred_out', 'dnr', 'return_to_station_nsl',
  'completed_routes', 'first_delv_with_test_dim', 'pde_photos_taken',
  'packages_not_on_van', 'first_disp_with_test_dim', 'delivery_attempt',
  'return_to_station_bc', 'pod_bypass', 'pod_opportunity', 'pod_success',
  'next_day_routes', 'scheduled_mfn_pickups', 'successful_mfn_pickups',
  'rejected_packages', 'payment_not_ready', 'scheduled_c_return_pickups',
  'return_to_station_cu', 'return_to_station_oodt', 'rts_dpmo', 'dnr_dpmo', 'ttl',
]);

export const DP_PERCENT_FIELDS = new Set([
  'pod_success_rate', 'rts_cu_percent', 'rts_other_percent', 'rts_oodt_percent',
  'rts_utl_percent', 'rts_bc_percent', 'delivery_attempt_percent',
  'customer_not_available_percent', 'first_day_delivery_success_percent',
  'rts_all_percent', 'rejected_packages_percent', 'payment_not_ready_percent',
  'delivery_success_dsp', 'delivery_success',
  'unbucketed_delivery_misses_percent', 'address_not_found_percent',
]);

export const DP_RATE_FIELDS = new Set(['shipment_zone_per_hour']);
export const DP_DATETIME_FIELDS = new Set(['last_updated_time']);
export const DP_EPOCH_FIELDS   = new Set(['messageTimestamp']);
export const DP_DATE_FIELDS    = new Set(['data_date']);

export const DP_LABELS: Record<string, string> = {
  country: 'Country', station_code: 'Station', program: 'Program',
  country_dspid_stationcode: 'Country/DSP/Station',
  country_program_stationcode: 'Country/Program/Station',
  region: 'Region', dsp_code: 'DSP',
  country_program_dspid_stationcode: 'Country/Program/DSP/Station',
  country_stationcode: 'Country/Station',
  country_program_data_date: 'Country/Program/Date',
  delivered: 'Delivered', dispatched: 'Dispatched',
  completed_routes: 'Completed Routes', delivery_attempt: 'Delivery Attempts',
  unbucketed_delivery_misses: 'Unbucketed Misses',
  address_not_found: 'Address Not Found',
  return_to_station_utl: 'RTS UTL', return_to_station_uta: 'RTS UTA',
  customer_not_available: 'Customer N/A',
  return_to_station_all: 'RTS All', return_to_station_cu: 'RTS CU',
  return_to_station_bc: 'RTS BC', return_to_station_nsl: 'RTS NSL',
  return_to_station_oodt: 'RTS OODT',
  successful_c_return_pickups: 'C-Return Pickups',
  rts_other: 'RTS Other', transferred_out: 'Transferred Out', dnr: 'DNR',
  first_delv_with_test_dim: 'First Delv (dim)', pde_photos_taken: 'PDE Photos',
  packages_not_on_van: 'Pkgs Not on Van',
  first_disp_with_test_dim: 'First Disp (dim)',
  pod_bypass: 'POD Bypass', pod_opportunity: 'POD Opportunity',
  pod_success: 'POD Success', next_day_routes: 'Next Day Routes',
  scheduled_mfn_pickups: 'Sched MFN Pickups',
  successful_mfn_pickups: 'Successful MFN Pickups',
  rejected_packages: 'Rejected Pkgs', payment_not_ready: 'Payment N/Ready',
  scheduled_c_return_pickups: 'Sched C-Return',
  rts_dpmo: 'RTS DPMO', dnr_dpmo: 'DNR DPMO', ttl: 'TTL',
  shipment_zone_per_hour: 'Shipments/Zone/Hour',
  pod_success_rate: 'POD Success Rate',
  rts_cu_percent: 'RTS CU %', rts_other_percent: 'RTS Other %',
  rts_oodt_percent: 'RTS OODT %', rts_utl_percent: 'RTS UTL %',
  rts_bc_percent: 'RTS BC %', delivery_attempt_percent: 'Delivery Attempt %',
  customer_not_available_percent: 'Customer N/A %',
  first_day_delivery_success_percent: 'First-Day Success %',
  rts_all_percent: 'RTS All %', rejected_packages_percent: 'Rejected Pkgs %',
  payment_not_ready_percent: 'Payment N/Ready %',
  delivery_success_dsp: 'Delivery Success (DSP)',
  delivery_success: 'Delivery Success',
  unbucketed_delivery_misses_percent: 'Unbucketed Misses %',
  address_not_found_percent: 'Address Not Found %',
  last_updated_time: 'Last Updated', messageTimestamp: 'Message Timestamp',
  data_date: 'Data Date',
};

// ── Pure helper functions (also exported for testing) ─────────────────────────

export function dpParseRow(jsonStr: string | Record<string, unknown>): Record<string, unknown> {
  const raw = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k.trim()] = v;
  }
  return out;
}

export function dpClassifyField(field: string): string {
  if (DP_STRING_FIELDS.has(field))   return 'string';
  if (DP_INT_FIELDS.has(field))      return 'int';
  if (DP_PERCENT_FIELDS.has(field))  return 'percent';
  if (DP_RATE_FIELDS.has(field))     return 'rate';
  if (DP_DATETIME_FIELDS.has(field)) return 'datetime';
  if (DP_EPOCH_FIELDS.has(field))    return 'epoch';
  if (DP_DATE_FIELDS.has(field))     return 'date';
  return 'unknown';
}

export function dpFormatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const type = dpClassifyField(field);
  switch (type) {
    case 'percent': return `${(Number(value) * 100).toFixed(2)}%`;
    case 'rate':    return Number(value).toFixed(2);
    case 'datetime':
    case 'epoch': {
      try {
        const ms = type === 'epoch' ? Number(value) : new Date(value as string).getTime();
        return new Date(ms).toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      } catch { return String(value); }
    }
    case 'date': return String(value);
    case 'int':  return Number(value).toLocaleString();
    default:     return String(value);
  }
}

export function dpRateClass(field: string, value: number): string {
  const v = Number(value);
  if (field.startsWith('rts_') || field.includes('miss') ||
      field === 'customer_not_available_percent' ||
      field === 'rejected_packages_percent' ||
      field === 'payment_not_ready_percent' ||
      field === 'address_not_found_percent') {
    if (v < 0.005) return 'great';
    if (v < 0.01)  return 'ok';
    return 'bad';
  }
  if (v >= 0.99)  return 'great';
  if (v >= 0.97)  return 'ok';
  return 'bad';
}

export function dpValidateDateRange(from: string, to: string): string | null {
  if (!from || !to) return 'Both From and To dates are required.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return 'From date format must be YYYY-MM-DD.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to))   return 'To date format must be YYYY-MM-DD.';
  if (from > to) return 'From date must not be after To date.';
  return null;
}

export function dpParseApiResponse(json: unknown): Record<string, unknown>[] {
  try {
    const tableData = (json as Record<string, unknown>)?.['tableData'] as Record<string, unknown> | undefined;
    const dsqData = tableData?.['dsp_daily_supplemental_quality'] as Record<string, unknown> | undefined;
    const rows = dsqData?.['rows'];
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return (rows as (string | Record<string, unknown>)[])
      .map(dpParseRow)
      .sort((a, b) => ((a['data_date'] as string) || '').localeCompare((b['data_date'] as string) || ''));
  } catch (e) {
    err('dpParseApiResponse error:', e);
    return [];
  }
}

// ── Dashboard class ────────────────────────────────────────────────────────────

export class DeliveryPerformance {
  private _overlayEl: HTMLElement | null = null;
  private _active = false;
  private _cache = new Map<string, unknown>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Expose pure helpers for testing */
  readonly helpers = {
    dpParseRow,
    dpClassifyField,
    dpFormatValue,
    dpRateClass,
    dpValidateDateRange,
    dpParseApiResponse,
  };

  constructor(
    private readonly config: AppConfig,
    private readonly companyConfig: CompanyConfig,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this._overlayEl) return;

    const today = todayStr();
    const overlay = document.createElement('div');
    overlay.id = 'ct-dp-overlay';
    overlay.className = 'ct-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Daily Delivery Performance Dashboard');
    overlay.innerHTML = `
      <div class="ct-dp-panel">
        <h2>📦 Daily Delivery Performance</h2>
        <div class="ct-controls">
          <label for="ct-dp-date">Date:</label>
          <input type="date" id="ct-dp-date" class="ct-input" value="${today}" aria-label="Select date">
          <label for="ct-dp-sa">Service Area:</label>
          <select id="ct-dp-sa" class="ct-input" aria-label="Service Area">
            <option value="">Wird geladen…</option>
          </select>
          <button class="ct-btn ct-btn--accent" id="ct-dp-go">🔍 Fetch</button>
          <button class="ct-btn ct-btn--close" id="ct-dp-close" aria-label="Close">✕ Close</button>
        </div>
        <div id="ct-dp-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-dp-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._overlayEl = overlay;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hide(); });
    document.getElementById('ct-dp-close')!.addEventListener('click', () => this.hide());
    document.getElementById('ct-dp-go')!.addEventListener('click', () => this._triggerFetch());

    const debounced = (() => {
      let t: ReturnType<typeof setTimeout>;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => this._triggerFetch(), 600);
      };
    })();
    document.getElementById('ct-dp-date')!.addEventListener('change', debounced);

    await this.companyConfig.load();
    this.companyConfig.populateSaSelect(document.getElementById('ct-dp-sa') as HTMLSelectElement);

    onDispose(() => this.dispose());
    log('Delivery Performance Dashboard initialized');
  }

  dispose(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._overlayEl?.remove(); this._overlayEl = null;
    this._active = false;
    this._cache.clear();
  }

  toggle(): void {
    if (!this.config.features.deliveryPerf) {
      alert('Daily Delivery Performance ist deaktiviert. Bitte in den Einstellungen aktivieren.');
      return;
    }
    this.init();
    if (this._active) this.hide(); else this.show();
  }

  show(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
    (document.getElementById('ct-dp-date') as HTMLInputElement).focus();
  }

  hide(): void {
    this._overlayEl?.classList.remove('visible');
    this._active = false;
  }

  // ── API ────────────────────────────────────────────────────────────────────

  private _buildUrl(from: string, to: string, station: string, dsp: string): string {
    return (
      'https://logistics.amazon.de/performance/api/v1/getData' +
      `?dataSetId=dsp_daily_supplemental_quality` +
      `&dsp=${encodeURIComponent(dsp)}` +
      `&from=${encodeURIComponent(from)}` +
      `&station=${encodeURIComponent(station)}` +
      `&timeFrame=Daily` +
      `&to=${encodeURIComponent(to)}`
    );
  }

  private async _fetchData(from: string, to: string, station: string, dsp: string): Promise<unknown> {
    const cacheKey = `${from}|${to}|${station}|${dsp}`;
    if (this._cache.has(cacheKey)) {
      log('DP cache hit:', cacheKey);
      return this._cache.get(cacheKey);
    }

    const url = this._buildUrl(from, to, station, dsp);
    const csrf = getCSRFToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const resp = await withRetry(async () => {
      const r = await fetch(url, { method: 'GET', headers, credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r;
    }, { retries: 2, baseMs: 800 });

    const json = await resp.json();
    this._cache.set(cacheKey, json);
    if (this._cache.size > 50) {
      const oldest = this._cache.keys().next().value as string;
      this._cache.delete(oldest);
    }
    return json;
  }

  // ── Trigger ────────────────────────────────────────────────────────────────

  private async _triggerFetch(): Promise<void> {
    const date = (document.getElementById('ct-dp-date') as HTMLInputElement).value;
    if (!date) { this._setStatus('⚠️ Please select a date.'); return; }

    const saSelect = document.getElementById('ct-dp-sa') as HTMLSelectElement;
    const station = saSelect.options[saSelect.selectedIndex]?.textContent?.trim().toUpperCase()
                  || this.companyConfig.getDefaultStation();
    const dsp = this.companyConfig.getDspCode();

    this._setStatus('⏳ Loading…');
    this._setBody('<div class="ct-dp-loading" role="status">Fetching data…</div>');

    try {
      const json = await this._fetchData(date, date, station, dsp);
      const records = dpParseApiResponse(json);
      if (records.length === 0) {
        this._setBody('<div class="ct-dp-empty">No data returned for the selected date.</div>');
        this._setStatus('⚠️ No records found.');
        return;
      }
      this._setBody(this._renderAll(records));
      this._setStatus(`✅ ${records.length} record(s) loaded — ${date}`);
    } catch (e) {
      err('Delivery perf fetch failed:', e);
      this._setBody(`<div class="ct-dp-error">❌ ${esc((e as Error).message)}</div>`);
      this._setStatus('❌ Failed to load data.');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _setStatus(msg: string): void {
    const el = document.getElementById('ct-dp-status');
    if (el) el.textContent = msg;
  }

  private _setBody(html: string): void {
    const el = document.getElementById('ct-dp-body');
    if (el) el.innerHTML = html;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _renderAll(records: Record<string, unknown>[]): string {
    const badgesHtml = this._renderBadges(records[0]);
    const recordsHtml = records.map((r) => this._renderRecord(r)).join('');
    return badgesHtml + recordsHtml;
  }

  private _renderBadges(record: Record<string, unknown>): string {
    const badges: string[] = [];
    for (const field of DP_STRING_FIELDS) {
      const val = record[field];
      if (val === undefined || val === null || val === '') continue;
      const label = DP_LABELS[field] || field;
      badges.push(
        `<span class="ct-dp-badge" title="${esc(field)}">${esc(label)}<span>${esc(String(val))}</span></span>`,
      );
    }
    if (!badges.length) return '';
    return `<div class="ct-dp-badges" aria-label="Identifiers">${badges.join('')}</div>`;
  }

  private _renderRecord(record: Record<string, unknown>): string {
    const dateLabel = esc(String(record['data_date'] || 'Unknown date'));
    return `
      <div class="ct-dp-record">
        <div class="ct-dp-record-header">📅 ${dateLabel}</div>
        <div class="ct-dp-record-body">
          ${this._renderKeyTiles(record)}
          ${this._renderCounts(record)}
          ${this._renderRates(record)}
          ${this._renderTimestamps(record)}
        </div>
      </div>`;
  }

  private _renderKeyTiles(record: Record<string, unknown>): string {
    const KEY_TILES = [
      { field: 'delivered',        label: 'Delivered',        pct: false },
      { field: 'dispatched',       label: 'Dispatched',       pct: false },
      { field: 'completed_routes', label: 'Routes',           pct: false },
      { field: 'delivery_success', label: 'Delivery Success', pct: true  },
      { field: 'pod_success_rate', label: 'POD Rate',         pct: true  },
    ];
    const tiles = KEY_TILES.map(({ field, label, pct }) => {
      const val = record[field];
      if (val === undefined || val === null) return '';
      let displayVal: string, cls = '';
      if (pct) {
        const n = Number(val);
        displayVal = `${(n * 100).toFixed(1)}%`;
        const rc = dpRateClass(field, n);
        cls = rc === 'great' ? 'ct-dp-tile--success' : rc === 'ok' ? 'ct-dp-tile--warn' : 'ct-dp-tile--danger';
      } else {
        displayVal = Number(val).toLocaleString();
      }
      return `<div class="ct-dp-tile ${cls}"><div class="ct-dp-tile-val">${esc(displayVal)}</div><div class="ct-dp-tile-lbl">${esc(label)}</div></div>`;
    }).join('');
    return `<div class="ct-dp-full-col"><div class="ct-dp-tiles">${tiles}</div></div>`;
  }

  private _renderCounts(record: Record<string, unknown>): string {
    const rows: string[] = [];
    for (const field of DP_INT_FIELDS) {
      const val = record[field];
      if (val === undefined || val === null) continue;
      const label = DP_LABELS[field] || field;
      rows.push(`<tr><td>${esc(label)}</td><td>${esc(Number(val).toLocaleString())}</td></tr>`);
    }
    if (!rows.length) return '';
    return `<div>
      <p class="ct-dp-section-title">Counts</p>
      <table class="ct-dp-count-table" aria-label="Count metrics">
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
  }

  private _renderRates(record: Record<string, unknown>): string {
    const pctRows: string[] = [];
    for (const field of DP_PERCENT_FIELDS) {
      const val = record[field];
      if (val === undefined || val === null) continue;
      const n = Number(val);
      const rc = dpRateClass(field, n);
      const barWidth = Math.min(100, Math.round(n * 100));
      const label = DP_LABELS[field] || field;
      pctRows.push(`
        <div class="ct-dp-rate-row" role="listitem">
          <span class="ct-dp-rate-label">${esc(label)}</span>
          <div class="ct-dp-rate-bar-wrap" aria-hidden="true">
            <div class="ct-dp-rate-bar ct-dp-rate--bar--${rc}" style="width:${barWidth}%"></div>
          </div>
          <span class="ct-dp-rate-value ct-dp-rate--${rc}">${(n * 100).toFixed(2)}%</span>
        </div>`);
    }
    for (const field of DP_RATE_FIELDS) {
      const val = record[field];
      if (val === undefined || val === null) continue;
      const label = DP_LABELS[field] || field;
      pctRows.push(`
        <div class="ct-dp-rate-row" role="listitem">
          <span class="ct-dp-rate-label">${esc(label)}</span>
          <span class="ct-dp-rate-value ct-dp-rate--neutral">${Number(val).toFixed(2)}</span>
        </div>`);
    }
    if (!pctRows.length) return '';
    return `<div>
      <p class="ct-dp-section-title">Rates &amp; Percentages</p>
      <div class="ct-dp-rates" role="list">${pctRows.join('')}</div>
    </div>`;
  }

  private _renderTimestamps(record: Record<string, unknown>): string {
    const items: string[] = [];
    if (record['data_date']) {
      items.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Data Date</span>
        <span class="ct-dp-ts-val">${esc(String(record['data_date']))}</span>
      </div>`);
    }
    if (record['last_updated_time']) {
      items.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Last Updated</span>
        <span class="ct-dp-ts-val">${esc(dpFormatValue('last_updated_time', record['last_updated_time']))}</span>
      </div>`);
    }
    if (record['messageTimestamp'] !== undefined && record['messageTimestamp'] !== null) {
      items.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Message Timestamp</span>
        <span class="ct-dp-ts-val">${esc(dpFormatValue('messageTimestamp', record['messageTimestamp']))}</span>
      </div>`);
    }
    if (!items.length) return '';
    return `<div class="ct-dp-full-col">
      <div class="ct-dp-ts-row" aria-label="Timestamps">${items.join('')}</div>
    </div>`;
  }
}
