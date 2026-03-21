// features/scorecard.ts – Weekly DA quality Scorecard Dashboard

import { log, err, esc, withRetry, getCSRFToken } from '../core/utils';
import { onDispose } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';

// ── Pure helper functions (exported for testing) ───────────────────────────────

export function scConvertToDecimal(value: unknown): number {
  if (value === undefined || value === null) return NaN;
  const s = String(value).trim();
  if (s === '-' || s === '') return NaN;
  const number = parseFloat(s.replace(',', '.'));
  return isNaN(number) ? NaN : number;
}

export interface ScorecardRow {
  transporterId: string;
  delivered: string;
  dcr: string;
  dnrDpmo: string;
  lorDpmo: string;
  pod: string;
  cc: string;
  ce: string;
  cdfDpmo: string;
  daName: string;
  week: string;
  year: string;
  stationCode: string;
  dspCode: string;
  dataDate: string;
  country: string;
  program: string;
  region: string;
  lastUpdated: string;
  _raw: Record<string, unknown>;
}

export function scParseRow(jsonStr: string | Record<string, unknown>): ScorecardRow {
  const raw: Record<string, unknown> = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) { out[k.trim()] = v; }

  const dcrRatio = out['dcr_metric'] !== undefined ? Number(out['dcr_metric']) : NaN;
  const podRatio = out['pod_metric'] !== undefined ? Number(out['pod_metric']) : NaN;
  const ccRatio  = out['cc_metric']  !== undefined ? Number(out['cc_metric'])  : NaN;

  return {
    transporterId: String(out['country_program_providerid_stationcode'] || out['dsp_code'] || ''),
    delivered:     String(out['delivered'] || '0'),
    dcr:           isNaN(dcrRatio) ? '-' : (dcrRatio * 100).toFixed(2),
    dnrDpmo:       String(out['dnr_dpmo'] ?? '0'),
    lorDpmo:       String(out['lor_dpmo'] ?? '0'),
    pod:           isNaN(podRatio) ? '-' : (podRatio * 100).toFixed(2),
    cc:            isNaN(ccRatio)  ? '-' : (ccRatio * 100).toFixed(2),
    ce:            String(out['ce_metric'] ?? '0'),
    cdfDpmo:       String(out['cdf_dpmo'] ?? '0'),
    daName:        String(out['da_name'] || ''),
    week:          String(out['week'] || ''),
    year:          String(out['year'] || ''),
    stationCode:   String(out['station_code'] || ''),
    dspCode:       String(out['dsp_code'] || ''),
    dataDate:      String(out['data_date'] || ''),
    country:       String(out['country'] || ''),
    program:       String(out['program'] || ''),
    region:        String(out['region'] || ''),
    lastUpdated:   String(out['last_updated_time'] || ''),
    _raw:          out,
  };
}

export interface CalculatedRow {
  transporterId: string;
  delivered: string;
  dcr: string;
  dnrDpmo: string;
  lorDpmo: string;
  pod: string;
  cc: string;
  ce: string;
  cdfDpmo: string;
  status: string;
  totalScore: number;
  daName: string;
  week: string;
  year: string;
  stationCode: string;
  dspCode: string;
  dataDate: string;
  lastUpdated: string;
  originalData: Record<string, string>;
  [key: string]: unknown;
}

export function scCalculateScore(row: ScorecardRow): CalculatedRow {
  const dcr = (scConvertToDecimal(row.dcr === '-' ? '100' : row.dcr) || 0) / 100;
  const dnrDpmo = parseFloat(row.dnrDpmo) || 0;
  const lorDpmo = parseFloat(row.lorDpmo) || 0;
  const pod = (scConvertToDecimal(row.pod === '-' ? '100' : row.pod) || 0) / 100;
  const cc  = (scConvertToDecimal(row.cc  === '-' ? '100' : row.cc)  || 0) / 100;
  const ce  = parseFloat(row.ce) || 0;
  const cdfDpmo = parseFloat(row.cdfDpmo) || 0;
  const delivered = parseFloat(row.delivered) || 0;

  let totalScore = Math.max(Math.min(
    (132.88 * dcr) + (10 * Math.max(0, 1 - (cdfDpmo / 10000))) -
    (0.0024 * dnrDpmo) - (8.54 * ce) + (10 * pod) + (4 * cc) +
    (0.00045 * delivered) - 60.88,
    100), 0);

  if (dcr === 1 && pod === 1 && cc === 1 && cdfDpmo === 0 && ce === 0 && dnrDpmo === 0 && lorDpmo === 0) {
    totalScore = 100;
  } else {
    let poorCount = 0;
    if ((dcr * 100) < 97) poorCount++;
    if (dnrDpmo >= 1500) poorCount++;
    if ((pod * 100) < 94) poorCount++;
    if ((cc * 100) < 70) poorCount++;
    if (ce !== 0) poorCount++;
    if (cdfDpmo >= 8000) poorCount++;

    if (poorCount >= 2 || poorCount === 1) {
      let severitySum = 0;
      if ((dcr * 100) < 97) severitySum += (97 - dcr * 100) / 5;
      if (dnrDpmo >= 1500) severitySum += (dnrDpmo - 1500) / 1000;
      if ((pod * 100) < 94) severitySum += (94 - pod * 100) / 10;
      if ((cc * 100) < 70) severitySum += (70 - cc * 100) / 50;
      if (ce !== 0) severitySum += ce * 1;
      if (cdfDpmo >= 8000) severitySum += (cdfDpmo - 8000) / 2000;
      const penalty = Math.min(3, severitySum);
      totalScore = Math.min(totalScore, (poorCount >= 2 ? 70 : 85) - penalty);
    }
  }

  const roundedScore = parseFloat(totalScore.toFixed(2));
  const status = roundedScore < 40 ? 'Poor' : roundedScore < 70 ? 'Fair' : roundedScore < 85 ? 'Great' : roundedScore < 93 ? 'Fantastic' : 'Fantastic Plus';

  return {
    transporterId: row.transporterId,
    delivered: row.delivered,
    dcr: (dcr * 100).toFixed(2), dnrDpmo: dnrDpmo.toFixed(2),
    lorDpmo: lorDpmo.toFixed(2), pod: (pod * 100).toFixed(2),
    cc: (cc * 100).toFixed(2), ce: ce.toFixed(2), cdfDpmo: cdfDpmo.toFixed(2),
    status, totalScore: roundedScore,
    daName: row.daName, week: row.week, year: row.year,
    stationCode: row.stationCode, dspCode: row.dspCode,
    dataDate: row.dataDate, lastUpdated: row.lastUpdated,
    originalData: { dcr: row.dcr, dnrDpmo: row.dnrDpmo, lorDpmo: row.lorDpmo, pod: row.pod, cc: row.cc, ce: row.ce, cdfDpmo: row.cdfDpmo },
  };
}

export function scKpiClass(value: number, type: string): string {
  switch (type) {
    case 'DCR':     return value < 97 ? 'poor' : value < 98.5 ? 'fair' : value < 99.5 ? 'great' : 'fantastic';
    case 'DNRDPMO':
    case 'LORDPMO': return value < 1100 ? 'fantastic' : value < 1300 ? 'great' : value < 1500 ? 'fair' : 'poor';
    case 'POD':     return value < 94 ? 'poor' : value < 95.5 ? 'fair' : value < 97 ? 'great' : 'fantastic';
    case 'CC':      return value < 70 ? 'poor' : value < 95 ? 'fair' : value < 98.5 ? 'great' : 'fantastic';
    case 'CE':      return value === 0 ? 'fantastic' : 'poor';
    case 'CDFDPMO': return value > 5460 ? 'poor' : value > 4450 ? 'fair' : value > 3680 ? 'great' : 'fantastic';
    default:        return '';
  }
}

export function scStatusClass(status: string): string {
  switch (status) {
    case 'Poor': return 'poor'; case 'Fair': return 'fair';
    case 'Great': return 'great'; case 'Fantastic': case 'Fantastic Plus': return 'fantastic';
    default: return '';
  }
}

export function scParseApiResponse(json: unknown): ScorecardRow[] {
  try {
    const tableData = (json as Record<string, unknown>)?.['tableData'] as Record<string, unknown> | undefined;
    const scData = tableData?.['da_dsp_station_weekly_quality'] as Record<string, unknown> | undefined;
    const rows = scData?.['rows'];
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const parsed: ScorecardRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      try { parsed.push(scParseRow(rows[i] as string | Record<string, unknown>)); }
      catch (e) { err('Scorecard: failed to parse row', i, e); }
    }
    return parsed;
  } catch (e) { err('scParseApiResponse error:', e); return []; }
}

export function scValidateWeek(week: string): string | null {
  if (!week) return 'Week is required.';
  if (!/^\d{4}-W\d{2}$/.test(week)) return 'Week format must be YYYY-Www (e.g. 2026-W12).';
  return null;
}

export function scCurrentWeek(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function scWeeksAgo(n: number): string {
  const now = new Date();
  now.setDate(now.getDate() - (n * 7));
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function _scImgKpiColor(value: number, type: string): string {
  switch (type) {
    case 'DCR':     return value < 97 ? 'rgb(235,50,35)' : value < 98.5 ? 'rgb(223,130,68)' : value < 99.5 ? 'rgb(126,170,85)' : 'rgb(77,115,190)';
    case 'DNRDPMO':
    case 'LORDPMO': return value < 1100 ? 'rgb(77,115,190)' : value < 1300 ? 'rgb(126,170,85)' : value < 1500 ? 'rgb(223,130,68)' : 'rgb(235,50,35)';
    case 'POD':     return value < 94 ? 'rgb(235,50,35)' : value < 95.5 ? 'rgb(223,130,68)' : value < 97 ? 'rgb(126,170,85)' : 'rgb(77,115,190)';
    case 'CC':      return value < 70 ? 'rgb(235,50,35)' : value < 95 ? 'rgb(223,130,68)' : value < 98.5 ? 'rgb(126,170,85)' : 'rgb(77,115,190)';
    case 'CE':      return value === 0 ? 'rgb(77,115,190)' : 'rgb(235,50,35)';
    case 'CDFDPMO': return value > 5460 ? 'rgb(235,50,35)' : value > 4450 ? 'rgb(223,130,68)' : value > 3680 ? 'rgb(126,170,85)' : 'rgb(77,115,190)';
    default:        return '#111111';
  }
}

function _scImgStatusColor(status: string): string {
  switch (status) {
    case 'Poor': return 'rgb(235,50,35)'; case 'Fair': return 'rgb(223,130,68)';
    case 'Great': return 'rgb(126,170,85)'; case 'Fantastic': case 'Fantastic Plus': return 'rgb(77,115,190)';
    default: return '#111111';
  }
}

// ── Dashboard class ────────────────────────────────────────────────────────────

export class ScorecardDashboard {
  private _overlayEl: HTMLElement | null = null;
  private _active = false;
  private _cache = new Map<string, unknown>();
  private _calculatedData: CalculatedRow[] = [];
  private _currentSort = { field: 'totalScore', dir: 'desc' };
  private _currentPage = 0;
  private _pageSize = 50;

  /** Expose pure helpers for unit testing */
  readonly helpers = { scConvertToDecimal, scParseRow, scCalculateScore, scKpiClass, scStatusClass, scParseApiResponse, scValidateWeek, scCurrentWeek, scWeeksAgo };

  constructor(
    private readonly config: AppConfig,
    private readonly companyConfig: CompanyConfig,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(): void {
    if (this._overlayEl) return;

    const curWeek = scCurrentWeek();
    const overlay = document.createElement('div');
    overlay.id = 'ct-sc-overlay';
    overlay.className = 'ct-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Scorecard Dashboard');
    overlay.innerHTML = `
      <div class="ct-sc-panel">
        <h2>📋 Scorecard</h2>
        <div class="ct-controls">
          <label for="ct-sc-week">Week:</label>
          <input type="text" id="ct-sc-week" class="ct-input" value="${curWeek}" placeholder="YYYY-Www" maxlength="8" style="width:100px">
          <label for="ct-sc-sa">Service Area:</label>
          <select id="ct-sc-sa" class="ct-input"><option value="">Wird geladen…</option></select>
          <button class="ct-btn ct-btn--accent" id="ct-sc-go">🔍 Fetch</button>
          <button class="ct-btn ct-btn--primary" id="ct-sc-export">📋 CSV Export</button>
          <button class="ct-btn ct-btn--secondary" id="ct-sc-imgdl">🖼 Download Image</button>
          <button class="ct-btn ct-btn--close" id="ct-sc-close">✕ Close</button>
        </div>
        <div id="ct-sc-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-sc-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._overlayEl = overlay;

    this.companyConfig.load().then(() => {
      this.companyConfig.populateSaSelect(document.getElementById('ct-sc-sa') as HTMLSelectElement);
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hide(); });
    overlay.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') this.hide(); });
    document.getElementById('ct-sc-close')!.addEventListener('click', () => this.hide());
    document.getElementById('ct-sc-go')!.addEventListener('click', () => this._triggerFetch());
    document.getElementById('ct-sc-export')!.addEventListener('click', () => this._exportCSV());
    document.getElementById('ct-sc-imgdl')!.addEventListener('click', () => this._downloadAsImage());

    onDispose(() => this.dispose());
    log('Scorecard Dashboard initialized');
  }

  dispose(): void {
    this._overlayEl?.remove(); this._overlayEl = null;
    this._active = false; this._cache.clear(); this._calculatedData = [];
  }

  toggle(): void {
    if (!this.config.features.scorecard) {
      alert('Scorecard ist deaktiviert. Bitte in den Einstellungen aktivieren.');
      return;
    }
    this.init();
    if (this._active) this.hide(); else this.show();
  }

  show(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
    (document.getElementById('ct-sc-week') as HTMLInputElement).focus();
  }

  hide(): void {
    this._overlayEl?.classList.remove('visible');
    this._active = false;
  }

  // ── API ────────────────────────────────────────────────────────────────────

  private _buildUrl(week: string, station: string, dsp: string): string {
    return (
      'https://logistics.amazon.de/performance/api/v1/getData' +
      `?dataSetId=${encodeURIComponent('da_dsp_station_weekly_quality')}` +
      `&dsp=${encodeURIComponent(dsp)}&from=${encodeURIComponent(week)}` +
      `&station=${encodeURIComponent(station)}&timeFrame=Weekly&to=${encodeURIComponent(week)}`
    );
  }

  private async _fetchData(week: string, station: string, dsp: string): Promise<unknown> {
    const cacheKey = `sc|${week}|${station}|${dsp}`;
    if (this._cache.has(cacheKey)) { log('Scorecard cache hit:', cacheKey); return this._cache.get(cacheKey); }

    const csrf = getCSRFToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const resp = await withRetry(async () => {
      const r = await fetch(this._buildUrl(week, station, dsp), { method: 'GET', headers, credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r;
    }, { retries: 2, baseMs: 800 });

    const json = await resp.json();
    this._cache.set(cacheKey, json);
    if (this._cache.size > 50) this._cache.delete(this._cache.keys().next().value as string);
    return json;
  }

  // ── Trigger ────────────────────────────────────────────────────────────────

  private async _triggerFetch(): Promise<void> {
    const week = (document.getElementById('ct-sc-week') as HTMLInputElement).value.trim();
    const validErr = scValidateWeek(week);
    if (validErr) { this._setStatus('⚠️ ' + validErr); return; }

    const saSelect = document.getElementById('ct-sc-sa') as HTMLSelectElement;
    const station = saSelect.options[saSelect.selectedIndex]?.textContent?.trim().toUpperCase() || this.companyConfig.getDefaultStation();
    const dsp = this.companyConfig.getDspCode();

    this._setStatus('⏳ Loading…');
    this._setBody('<div class="ct-sc-loading" role="status">Fetching scorecard data…</div>');

    try {
      const json = await this._fetchData(week, station, dsp);
      const parsedRows = scParseApiResponse(json);

      if (parsedRows.length === 0) {
        this._setBody('<div class="ct-sc-empty">No data returned for the selected week.</div>');
        this._setStatus('⚠️ No records found.');
        return;
      }

      const calculated = parsedRows.map((row) => {
        try { return scCalculateScore(row); }
        catch (e) { err('Scorecard: failed to calculate score:', row, e); return null; }
      }).filter((r): r is CalculatedRow => r !== null);

      if (calculated.length === 0) {
        this._setBody('<div class="ct-sc-error">All rows failed score calculation.</div>');
        this._setStatus('❌ Calculation failed for all rows.'); return;
      }

      calculated.sort((a, b) => b.totalScore - a.totalScore);
      this._calculatedData = calculated;
      this._currentPage = 0;
      this._currentSort = { field: 'totalScore', dir: 'desc' };
      this._renderAll();
      this._setStatus(`✅ ${calculated.length} record(s) loaded — ${week}`);
    } catch (e) {
      err('Scorecard fetch failed:', e);
      this._setBody(`<div class="ct-sc-error">❌ ${esc((e as Error).message)}</div>`);
      this._setStatus('❌ Failed to load data.');
    }
  }

  private _setStatus(msg: string): void { const el = document.getElementById('ct-sc-status'); if (el) el.textContent = msg; }
  private _setBody(html: string): void { const el = document.getElementById('ct-sc-body'); if (el) el.innerHTML = html; }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _renderAll(): void {
    const data = this._calculatedData;
    if (!data.length) return;

    const avgScore = data.reduce((s, r) => s + r.totalScore, 0) / data.length;
    const counts: Record<string, number> = {};
    for (const r of data) { counts[r.status] = (counts[r.status] || 0) + 1; }

    const tilesHtml = `
      <div class="ct-sc-tiles">
        <div class="ct-sc-tile"><div class="ct-sc-tile-val">${data.length}</div><div class="ct-sc-tile-lbl">Total Records</div></div>
        <div class="ct-sc-tile"><div class="ct-sc-tile-val">${avgScore.toFixed(1)}</div><div class="ct-sc-tile-lbl">Avg Score</div></div>
        <div class="ct-sc-tile ct-sc-tile--fantastic"><div class="ct-sc-tile-val">${(counts['Fantastic'] || 0) + (counts['Fantastic Plus'] || 0)}</div><div class="ct-sc-tile-lbl">Fantastic(+)</div></div>
        <div class="ct-sc-tile ct-sc-tile--great"><div class="ct-sc-tile-val">${counts['Great'] || 0}</div><div class="ct-sc-tile-lbl">Great</div></div>
        <div class="ct-sc-tile ct-sc-tile--fair"><div class="ct-sc-tile-val">${counts['Fair'] || 0}</div><div class="ct-sc-tile-lbl">Fair</div></div>
        <div class="ct-sc-tile ct-sc-tile--poor"><div class="ct-sc-tile-val">${counts['Poor'] || 0}</div><div class="ct-sc-tile-lbl">Poor</div></div>
      </div>`;

    const start = this._currentPage * this._pageSize;
    const pageData = data.slice(start, Math.min(start + this._pageSize, data.length));
    const totalPages = Math.ceil(data.length / this._pageSize);

    const sortArrow = (field: string) => this._currentSort.field !== field ? '' : this._currentSort.dir === 'asc' ? ' ▲' : ' ▼';

    const rowsHtml = pageData.map((row, i) => {
      const place = start + i + 1;
      const sClass = scStatusClass(row.status);
      return `<tr>
        <td>${place}</td>
        <td title="${esc(row.transporterId)}">${esc(row.daName || row.transporterId)}</td>
        <td class="ct-sc-status--${sClass}">${esc(row.status)}</td>
        <td><strong>${row.totalScore.toFixed(2)}</strong></td>
        <td>${esc(Number(row.delivered).toLocaleString())}</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.dcr), 'DCR')}">${row.dcr}%</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.dnrDpmo), 'DNRDPMO')}">${parseInt(row.dnrDpmo, 10)}</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.lorDpmo), 'LORDPMO')}">${parseInt(row.lorDpmo, 10)}</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.pod), 'POD')}">${row.pod}%</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.cc), 'CC')}">${row.cc}%</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.ce), 'CE')}">${parseInt(row.ce, 10)}</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.cdfDpmo), 'CDFDPMO')}">${parseInt(row.cdfDpmo, 10)}</td>
      </tr>`;
    }).join('');

    const tableHtml = `
      <div class="ct-sc-table-wrap">
        <table class="ct-sc-table">
          <thead><tr>
            <th data-sort="place">#${sortArrow('place')}</th>
            <th data-sort="daName">DA${sortArrow('daName')}</th>
            <th data-sort="status">Status${sortArrow('status')}</th>
            <th data-sort="totalScore">Total Score${sortArrow('totalScore')}</th>
            <th data-sort="delivered">Delivered${sortArrow('delivered')}</th>
            <th data-sort="dcr">DCR${sortArrow('dcr')}</th>
            <th data-sort="dnrDpmo">DNR DPMO${sortArrow('dnrDpmo')}</th>
            <th data-sort="lorDpmo">LOR DPMO${sortArrow('lorDpmo')}</th>
            <th data-sort="pod">POD${sortArrow('pod')}</th>
            <th data-sort="cc">CC${sortArrow('cc')}</th>
            <th data-sort="ce">CE${sortArrow('ce')}</th>
            <th data-sort="cdfDpmo">CDF DPMO${sortArrow('cdfDpmo')}</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;

    const paginationHtml = totalPages > 1 ? `
      <div class="ct-sc-pagination">
        <button class="ct-btn ct-btn--secondary ct-sc-page-prev" ${this._currentPage === 0 ? 'disabled' : ''}>◀ Prev</button>
        <span class="ct-sc-page-info">Page ${this._currentPage + 1} of ${totalPages}</span>
        <button class="ct-btn ct-btn--secondary ct-sc-page-next" ${this._currentPage >= totalPages - 1 ? 'disabled' : ''}>Next ▶</button>
      </div>` : '';

    this._setBody(tilesHtml + tableHtml + paginationHtml);

    document.querySelectorAll<HTMLElement>('.ct-sc-table th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-sort')!;
        if (field === 'place') return;
        if (this._currentSort.field === field) this._currentSort.dir = this._currentSort.dir === 'asc' ? 'desc' : 'asc';
        else this._currentSort = { field, dir: 'desc' };
        this._sortData(); this._currentPage = 0; this._renderAll();
      });
    });

    document.querySelector('.ct-sc-page-prev')?.addEventListener('click', () => { this._currentPage--; this._renderAll(); });
    document.querySelector('.ct-sc-page-next')?.addEventListener('click', () => { this._currentPage++; this._renderAll(); });
  }

  private _sortData(): void {
    const { field, dir } = this._currentSort;
    const mult = dir === 'asc' ? 1 : -1;
    this._calculatedData.sort((a, b) => {
      const na = parseFloat(String(a[field])), nb = parseFloat(String(b[field]));
      if (!isNaN(na) && !isNaN(nb)) return (na - nb) * mult;
      return String(a[field] || '').localeCompare(String(b[field] || '')) * mult;
    });
  }

  // ── Image Download ─────────────────────────────────────────────────────────

  private _downloadAsImage(): void {
    const data = this._calculatedData;
    if (!data.length) { this._setStatus('⚠️ No data to capture. Fetch data first.'); return; }
    this._setStatus('⏳ Generating image…');

    try {
      const SCALE = 2, FONT = 'Arial, sans-serif', FONT_SZ = 12, HEAD_SZ = 11, PAD_X = 8, PAD_Y = 6;
      const ROW_H = FONT_SZ + PAD_Y * 2, HEAD_H = HEAD_SZ + PAD_Y * 2, TITLE_H = 32;
      const week = (document.getElementById('ct-sc-week') as HTMLInputElement)?.value || '';
      const COLS = [
        { label: '#',         w: 36,  get: (_r: CalculatedRow, i: number) => String(i + 1), color: undefined as undefined | ((r: CalculatedRow) => string) },
        { label: 'DA',        w: 180, get: (r: CalculatedRow) => r.daName || r.transporterId, color: undefined },
        { label: 'Status',    w: 90,  get: (r: CalculatedRow) => r.status, color: (r: CalculatedRow) => _scImgStatusColor(r.status) },
        { label: 'Score',     w: 60,  get: (r: CalculatedRow) => r.totalScore.toFixed(2), color: undefined },
        { label: 'Delivered', w: 70,  get: (r: CalculatedRow) => String(Number(r.delivered).toLocaleString()), color: undefined },
        { label: 'DCR',       w: 58,  get: (r: CalculatedRow) => r.dcr + '%', color: (r: CalculatedRow) => _scImgKpiColor(parseFloat(r.dcr), 'DCR') },
        { label: 'DNR DPMO',  w: 72,  get: (r: CalculatedRow) => String(parseInt(r.dnrDpmo, 10)), color: (r: CalculatedRow) => _scImgKpiColor(parseFloat(r.dnrDpmo), 'DNRDPMO') },
        { label: 'LOR DPMO',  w: 72,  get: (r: CalculatedRow) => String(parseInt(r.lorDpmo, 10)), color: (r: CalculatedRow) => _scImgKpiColor(parseFloat(r.lorDpmo), 'LORDPMO') },
        { label: 'POD',       w: 58,  get: (r: CalculatedRow) => r.pod + '%', color: (r: CalculatedRow) => _scImgKpiColor(parseFloat(r.pod), 'POD') },
        { label: 'CC',        w: 58,  get: (r: CalculatedRow) => r.cc + '%', color: (r: CalculatedRow) => _scImgKpiColor(parseFloat(r.cc), 'CC') },
        { label: 'CE',        w: 44,  get: (r: CalculatedRow) => String(parseInt(r.ce, 10)), color: (r: CalculatedRow) => _scImgKpiColor(parseFloat(r.ce), 'CE') },
        { label: 'CDF DPMO',  w: 72,  get: (r: CalculatedRow) => String(parseInt(r.cdfDpmo, 10)), color: (r: CalculatedRow) => _scImgKpiColor(parseFloat(r.cdfDpmo), 'CDFDPMO') },
      ];

      const totalW = COLS.reduce((s, c) => s + c.w, 0);
      const totalH = TITLE_H + HEAD_H + data.length * ROW_H;

      const canvas = document.createElement('canvas');
      canvas.width = totalW * SCALE; canvas.height = totalH * SCALE;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(SCALE, SCALE);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, totalW, totalH);
      ctx.fillStyle = '#232f3e'; ctx.fillRect(0, 0, totalW, TITLE_H);
      ctx.fillStyle = '#ff9900'; ctx.font = `bold 14px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(`📋 Scorecard${week ? ' — ' + week : ''}`, PAD_X, TITLE_H / 2);

      let x = 0;
      ctx.fillStyle = '#232f3e'; ctx.fillRect(0, TITLE_H, totalW, HEAD_H);
      ctx.font = `bold ${HEAD_SZ}px ${FONT}`; ctx.fillStyle = '#ff9900'; ctx.textBaseline = 'middle';
      for (const col of COLS) {
        ctx.textAlign = 'center'; ctx.save(); ctx.beginPath(); ctx.rect(x, TITLE_H, col.w, HEAD_H); ctx.clip();
        ctx.fillText(col.label, x + col.w / 2, TITLE_H + HEAD_H / 2); ctx.restore();
        ctx.strokeStyle = '#3d4f60'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(x, TITLE_H); ctx.lineTo(x, TITLE_H + HEAD_H); ctx.stroke();
        x += col.w;
      }

      ctx.font = `${FONT_SZ}px ${FONT}`; ctx.lineWidth = 0.5;
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const rowY = TITLE_H + HEAD_H + i * ROW_H;
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f9f9f9'; ctx.fillRect(0, rowY, totalW, ROW_H);
        ctx.strokeStyle = '#dddddd'; ctx.beginPath(); ctx.moveTo(0, rowY + ROW_H); ctx.lineTo(totalW, rowY + ROW_H); ctx.stroke();
        x = 0;
        for (const col of COLS) {
          const text = col.get(row, i);
          const color = col.color ? col.color(row) : '#111111';
          ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
          ctx.save(); ctx.beginPath(); ctx.rect(x + 1, rowY, col.w - 2, ROW_H); ctx.clip();
          ctx.fillText(text, x + col.w / 2, rowY + ROW_H / 2); ctx.restore();
          ctx.strokeStyle = '#dddddd'; ctx.beginPath(); ctx.moveTo(x, rowY); ctx.lineTo(x, rowY + ROW_H); ctx.stroke();
          x += col.w;
        }
      }

      ctx.strokeStyle = '#aaaaaa'; ctx.lineWidth = 1; ctx.strokeRect(0, 0, totalW, totalH);

      canvas.toBlob((blob) => {
        if (!blob) { this._setStatus('❌ Image generation failed.'); return; }
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl; a.download = `scorecard_${week || 'export'}.png`;
        a.click(); URL.revokeObjectURL(dlUrl);
        this._setStatus('✅ Image downloaded.');
      }, 'image/png');
    } catch (e) {
      err('Scorecard image download failed:', e);
      this._setStatus('❌ Image generation failed: ' + (e as Error).message);
    }
  }

  // ── CSV Export ─────────────────────────────────────────────────────────────

  private _exportCSV(): void {
    if (!this._calculatedData.length) { this._setStatus('⚠️ No data to export.'); return; }
    const headers = ['Place', 'DA', 'Status', 'Total Score', 'Delivered', 'DCR', 'DNR DPMO', 'LOR DPMO', 'POD', 'CC', 'CE', 'CDF DPMO', 'Station', 'DSP'];
    const csvRows = [headers.join(';')];
    this._calculatedData.forEach((row, i) => {
      csvRows.push([i + 1, row.daName || row.transporterId, row.status, row.totalScore.toFixed(2), row.delivered, row.dcr, parseInt(row.dnrDpmo, 10), parseInt(row.lorDpmo, 10), row.pod, row.cc, parseInt(row.ce, 10), parseInt(row.cdfDpmo, 10), row.stationCode, row.dspCode].join(';'));
    });

    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scorecard_${(document.getElementById('ct-sc-week') as HTMLInputElement)?.value || 'data'}.csv`;
    a.click(); URL.revokeObjectURL(url);
    this._setStatus('✅ CSV exported.');
  }
}
