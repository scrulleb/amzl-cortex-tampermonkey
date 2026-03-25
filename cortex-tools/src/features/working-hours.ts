// features/working-hours.ts – Working Hours Dashboard

import { log, err, esc, todayStr, withRetry, getCSRFToken, extractSessionFromCookie } from '../core/utils';
import { onDispose } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';

// ── Pure helper functions ──────────────────────────────────────────────────────

/** Normalise an epoch value to milliseconds. */
export function whdNormalizeEpochMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (isNaN(n)) return null;
  if (n > 1_000_000_000_000_000) return Math.floor(n / 1000);
  if (n > 1_000_000_000_000) return n;
  if (n > 1_000_000_000) return n * 1000;
  return n;
}

export function whdFormatTime(epochMs: number | null | undefined): string {
  if (epochMs === null || epochMs === undefined) return '—';
  try {
    return new Date(epochMs).toLocaleTimeString('de-DE', {
      timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return '—'; }
}

export function whdFormatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const n = Number(ms);
  if (isNaN(n)) return '—';
  const totalSec = Math.floor(n / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export interface WhdRow {
  itineraryId: string | null;
  transporterId: string | null;
  routeCode: string | null;
  serviceTypeName: string | null;
  driverName: string | null;
  blockDurationInMinutes: number | null;
  waveStartTime: number | null;
  itineraryStartTime: number | null;
  plannedDepartureTime: number | null;
  actualDepartureTime: number | null;
  plannedOutboundStemTime: unknown;
  actualOutboundStemTime: unknown;
  lastDriverEventTime: number | null;
  sessionEndTime: number | null;
  lastStopExecutionTime: number | null;
  [key: string]: unknown;
}

export function whdExtractRow(item: Record<string, unknown>): WhdRow {
  const tta = (item['transporterTimeAttributes'] as Record<string, unknown>) || {};
  return {
    itineraryId:             (item['itineraryId'] as string | null) ?? null,
    transporterId:           (item['transporterId'] as string | null) ?? null,
    routeCode:               (item['routeCode'] as string | null) ?? null,
    serviceTypeName:         (item['serviceTypeName'] as string | null) ?? null,
    driverName:              null,
    blockDurationInMinutes:  (item['blockDurationInMinutes'] as number | null) ?? null,
    waveStartTime:           whdNormalizeEpochMs(item['waveStartTime']),
    itineraryStartTime:      whdNormalizeEpochMs(item['itineraryStartTime']),
    plannedDepartureTime:    whdNormalizeEpochMs(item['plannedDepartureTime']),
    actualDepartureTime:     whdNormalizeEpochMs(tta['actualDepartureTime']),
    plannedOutboundStemTime: tta['plannedOutboundStemTime'] ?? null,
    actualOutboundStemTime:  tta['actualOutboundStemTime'] ?? null,
    lastDriverEventTime:     whdNormalizeEpochMs(item['lastDriverEventTime']),
    sessionEndTime:          whdNormalizeEpochMs(item['sessionEndTime']),
    lastStopExecutionTime:   whdNormalizeEpochMs(item['lastStopExecutionTime']),
  };
}

export function whdSortRows(rows: WhdRow[], column: string, direction: 'asc' | 'desc'): WhdRow[] {
  const mult = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = a[column];
    const vb = b[column];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'string') return mult * (va as string).localeCompare(vb as string);
    return mult * ((va as number) - (vb as number));
  });
}

const WHD_COLUMNS = [
  { key: 'routeCode',              label: 'Route Code',        type: 'string'   },
  { key: 'serviceTypeName',        label: 'Service Type',      type: 'string'   },
  { key: 'driverName',             label: 'Driver',            type: 'string'   },
  { key: 'blockDurationInMinutes', label: 'Block (min)',       type: 'integer'  },
  { key: 'waveStartTime',          label: 'Wave Start',        type: 'time'     },
  { key: 'itineraryStartTime',     label: 'Itin. Start',       type: 'time'     },
  { key: 'plannedDepartureTime',   label: 'Planned Dep.',      type: 'time'     },
  { key: 'actualDepartureTime',    label: 'Actual Dep.',       type: 'time'     },
  { key: 'plannedOutboundStemTime',label: 'Planned OB Stem',   type: 'duration' },
  { key: 'actualOutboundStemTime', label: 'Actual OB Stem',    type: 'duration' },
  { key: 'lastDriverEventTime',    label: 'Last Driver Event', type: 'time'     },
  { key: 'sessionEndTime',         label: 'Logout',            type: 'time'     },
  { key: 'lastStopExecutionTime',  label: 'Last Stop',         type: 'time'     },
] as const;

const WHD_DETAIL_FIELDS = [
  { key: 'itineraryId',            label: 'Itinerary ID',      format: 'string',   suffix: ''    },
  { key: 'routeCode',              label: 'Route Code',        format: 'string',   suffix: ''    },
  { key: 'serviceTypeName',        label: 'Service Type',      format: 'string',   suffix: ''    },
  { key: 'driverName',             label: 'Driver',            format: 'string',   suffix: ''    },
  { key: 'blockDurationInMinutes', label: 'Block Duration',    format: 'integer',  suffix: ' min'},
  { key: 'waveStartTime',          label: 'Wave Start',        format: 'time',     suffix: ''    },
  { key: 'itineraryStartTime',     label: 'Itin. Start',       format: 'time',     suffix: ''    },
  { key: 'plannedDepartureTime',   label: 'Planned Departure', format: 'time',     suffix: ''    },
  { key: 'actualDepartureTime',    label: 'Actual Departure',  format: 'time',     suffix: ''    },
  { key: 'plannedOutboundStemTime',label: 'Planned OB Stem',   format: 'duration', suffix: ''    },
  { key: 'actualOutboundStemTime', label: 'Actual OB Stem',    format: 'duration', suffix: ''    },
  { key: 'lastDriverEventTime',    label: 'Last Driver Event', format: 'time',     suffix: ''    },
  { key: 'sessionEndTime',         label: 'Logout',            format: 'time',     suffix: ''    },
  { key: 'lastStopExecutionTime',  label: 'Last Stop',         format: 'time',     suffix: ''    },
] as const;

// ── Dashboard class ────────────────────────────────────────────────────────────

export class WorkingHoursDashboard {
  private _overlayEl: HTMLElement | null = null;
  private _detailEl: HTMLElement | null = null;
  private _active = false;
  private _data: WhdRow[] = [];
  private _sort: { column: string; direction: 'asc' | 'desc' } = { column: 'routeCode', direction: 'asc' };
  private _page = 1;
  private _pageSize = 50;
  private _driverCache = new Map<string, string>();

  constructor(
    private readonly config: AppConfig,
    private readonly companyConfig: CompanyConfig,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(): void {
    if (this._overlayEl) return;

    const overlay = document.createElement('div');
    overlay.id = 'ct-whd-overlay';
    overlay.className = 'ct-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Working Hours Dashboard');
    overlay.innerHTML = `
      <div class="ct-whd-panel">
        <h2>⏱ Working Hours Dashboard</h2>
        <div class="ct-controls">
          <label for="ct-whd-date">Datum:</label>
          <input type="date" id="ct-whd-date" class="ct-input" value="${todayStr()}" aria-label="Datum auswählen">
          <label for="ct-whd-sa">Service Area:</label>
          <select id="ct-whd-sa" class="ct-select" aria-label="Service Area"></select>
          <button class="ct-btn ct-btn--accent" id="ct-whd-go">🔍 Abfragen</button>
          <button class="ct-btn ct-btn--primary" id="ct-whd-export">📋 CSV Export</button>
          <button class="ct-btn ct-btn--close" id="ct-whd-close">✕ Schließen</button>
        </div>
        <div id="ct-whd-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-whd-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._overlayEl = overlay;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hide(); });
    overlay.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') this.hide(); });
    document.getElementById('ct-whd-close')!.addEventListener('click', () => this.hide());
    document.getElementById('ct-whd-go')!.addEventListener('click', () => this._fetchData());
    document.getElementById('ct-whd-export')!.addEventListener('click', () => this._exportCSV());

    this.companyConfig.load().then(() => {
      this.companyConfig.populateSaSelect(document.getElementById('ct-whd-sa') as HTMLSelectElement);
    });

    onDispose(() => this.dispose());
    log('Working Hours Dashboard initialized');
  }

  dispose(): void {
    this._overlayEl?.remove(); this._overlayEl = null;
    this._detailEl?.remove(); this._detailEl = null;
    this._data = [];
    this._active = false;
  }

  toggle(): void {
    if (!this.config.features.workingHours) {
      alert('Working Hours Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.');
      return;
    }
    this.init();
    if (this._active) this.hide(); else this.show();
  }

  show(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
    (document.getElementById('ct-whd-date') as HTMLInputElement).focus();
  }

  hide(): void {
    this._overlayEl?.classList.remove('visible');
    this._active = false;
  }

  // ── Driver name resolution ─────────────────────────────────────────────────

  private async _resolveDriverNames(rows: WhdRow[], date: string, serviceAreaId: string): Promise<void> {
    const allIds = [...new Set(rows.map((r) => r.transporterId).filter((id): id is string => id != null))];
    const uncached = allIds.filter((id) => !this._driverCache.has(id));

    if (uncached.length > 0) {
      try {
        const queryDate = new Date(date + 'T00:00:00');
        const fromDate = new Date(queryDate); fromDate.setDate(fromDate.getDate() - 7);
        const toDate = new Date(queryDate); toDate.setDate(toDate.getDate() + 1);

        const url = `https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${fromDate.toISOString().split('T')[0]}&toDate=${toDate.toISOString().split('T')[0]}&serviceAreaId=${serviceAreaId}`;
        const csrf = getCSRFToken();
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (csrf) headers['anti-csrftoken-a2z'] = csrf;

        const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
        if (resp.ok) {
          const json = await resp.json();
          const roster = Array.isArray(json) ? json : json?.data || json?.rosters || [];
          const processEntries = (entries: Array<Record<string, unknown>>) => {
            for (const entry of entries) {
              if (entry['driverPersonId'] && entry['driverName']) {
                this._driverCache.set(String(entry['driverPersonId']), entry['driverName'] as string);
              }
            }
          };
          if (Array.isArray(roster)) processEntries(roster);
          else if (typeof roster === 'object') {
            for (const val of Object.values(roster as Record<string, unknown>)) {
              if (Array.isArray(val)) processEntries(val as Array<Record<string, unknown>>);
            }
          }
          log(`[WHD] Roster loaded: ${this._driverCache.size} driver names cached`);
        }
      } catch (e) {
        log('[WHD] Roster lookup failed (non-fatal):', e);
      }
    }

    for (const row of rows) {
      if (row.transporterId) {
        row.driverName = this._driverCache.get(row.transporterId) || null;
      }
    }
  }

  // ── Data Fetching ──────────────────────────────────────────────────────────

  private async _fetchData(): Promise<void> {
    const date = (document.getElementById('ct-whd-date') as HTMLInputElement)?.value;
    const sel = document.getElementById('ct-whd-sa') as HTMLSelectElement | null;
    const serviceAreaId = (sel && sel.value) ? sel.value : this.companyConfig.getDefaultServiceAreaId();

    if (!date) { this._setStatus('⚠️ Bitte Datum auswählen.'); return; }
    if (!serviceAreaId) { this._setStatus('⚠️ Bitte Service Area auswählen.'); return; }

    this._setStatus(`⏳ Lade Daten für ${date}…`);
    this._setBody('<div class="ct-whd-loading" role="status">Daten werden geladen…</div>');

    try {
      const apiUrl = `https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${date}&serviceAreaId=${serviceAreaId}`;

      const resp = await withRetry(async () => {
        const r = await fetch(apiUrl, {
          method: 'GET', credentials: 'same-origin',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
            'user-ref': 'cortex-webapp-user',
            'X-Cortex-Timestamp': Date.now().toString(),
            'X-Cortex-Session': extractSessionFromCookie() ?? '',
            Referer: location.href,
          },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r;
      }, { retries: 2, baseMs: 800 });

      const json = await resp.json();
      const summaries = json?.itinerarySummaries || json?.summaries || json?.data?.itinerarySummaries || json?.data || (Array.isArray(json) ? json : []);

      if (summaries.length === 0) {
        this._data = [];
        this._setBody(`<div class="ct-whd-empty">📭 Keine Itineraries gefunden.<br><small>Bitte Datum/Service Area prüfen.</small></div>`);
        this._setStatus('⚠️ Keine Daten für diesen Tag/Service Area.');
        return;
      }

      this._data = (summaries as Record<string, unknown>[]).map(whdExtractRow);
      this._setStatus(`⏳ ${this._data.length} Itineraries geladen, lade Fahrernamen…`);
      await this._resolveDriverNames(this._data, date, serviceAreaId);

      this._page = 1;
      this._sort = { column: 'routeCode', direction: 'asc' };
      this._renderTable();

      const stationCode = this.companyConfig.getServiceAreas().find((sa) => sa.serviceAreaId === serviceAreaId)?.stationCode || serviceAreaId;
      const resolvedCount = this._data.filter((r) => r.driverName !== null).length;
      this._setStatus(`✅ ${this._data.length} Itineraries geladen — ${date} / ${stationCode} | ${resolvedCount} Fahrer zugeordnet`);
    } catch (e) {
      err('WHD fetch failed:', e);
      this._data = [];
      this._setBody(`<div class="ct-whd-error" role="alert">❌ Daten konnten nicht geladen werden.<br><small>${esc((e as Error).message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-whd-retry">🔄 Erneut versuchen</button></div>`);
      this._setStatus('❌ Fehler beim Laden.');
      document.getElementById('ct-whd-retry')?.addEventListener('click', () => this._fetchData());
    }
  }

  // ── Table Rendering ────────────────────────────────────────────────────────

  private _renderTable(): void {
    const sorted = whdSortRows(this._data, this._sort.column, this._sort.direction);
    const totalPages = Math.max(1, Math.ceil(sorted.length / this._pageSize));
    if (this._page > totalPages) this._page = totalPages;
    const start = (this._page - 1) * this._pageSize;
    const slice = sorted.slice(start, start + this._pageSize);

    const thSortIcon = (col: string) => {
      if (this._sort.column !== col) return '';
      return `<span class="ct-whd-sort-icon">${this._sort.direction === 'asc' ? '▲' : '▼'}</span>`;
    };

    const ariaSort = (col: string) => {
      if (this._sort.column !== col) return 'none';
      return this._sort.direction === 'asc' ? 'ascending' : 'descending';
    };

    const thHtml = WHD_COLUMNS.map((h) =>
      `<th scope="col" role="columnheader" aria-sort="${ariaSort(h.key)}" data-sort="${h.key}" title="Sort by ${esc(h.label)}">
        ${esc(h.label)}${thSortIcon(h.key)}
      </th>`,
    ).join('');

    const trHtml = slice.map((row) => {
      const cells = WHD_COLUMNS.map((h) => {
        const val = row[h.key];
        if (h.key === 'driverName') {
          return val === null || val === undefined
            ? '<td class="ct-whd-driver ct-nodata">Unassigned</td>'
            : `<td class="ct-whd-driver">${esc(String(val))}</td>`;
        }
        if (val === null || val === undefined) return '<td class="ct-nodata">—</td>';
        switch (h.type) {
          case 'duration': return `<td>${esc(whdFormatDuration(val as number))}</td>`;
          case 'time':     return `<td>${esc(whdFormatTime(val as number))}</td>`;
          default:         return `<td>${esc(String(val))}</td>`;
        }
      }).join('');
      return `<tr data-itinerary-id="${esc(row.itineraryId || '')}" role="row" tabindex="0">${cells}</tr>`;
    }).join('');

    const paginationHtml = this._renderPagination(sorted.length, this._page, totalPages);

    this._setBody(`
      <div class="ct-whd-table-wrap">
        <table class="ct-table ct-whd-table" role="grid" aria-label="Working Hours Dashboard">
          <thead><tr>${thHtml}</tr></thead>
          <tbody>${trHtml}</tbody>
        </table>
      </div>
      ${paginationHtml}`);

    this._attachTableHandlers();
  }

  private _attachTableHandlers(): void {
    const body = document.getElementById('ct-whd-body');
    if (!body) return;

    body.querySelectorAll<HTMLElement>('th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset['sort']!;
        if (this._sort.column === col) {
          this._sort.direction = this._sort.direction === 'asc' ? 'desc' : 'asc';
        } else {
          this._sort.column = col;
          this._sort.direction = 'asc';
        }
        this._renderTable();
      });
    });

    body.querySelectorAll<HTMLElement>('tr[data-itinerary-id]').forEach((tr) => {
      tr.addEventListener('click', () => { const id = tr.dataset['itineraryId']; if (id) this._showDetail(id); });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const id = tr.dataset['itineraryId']; if (id) this._showDetail(id); }
      });
    });

    body.querySelector('.ct-whd-prev')?.addEventListener('click', () => {
      if (this._page > 1) { this._page--; this._renderTable(); }
    });
    body.querySelector('.ct-whd-next')?.addEventListener('click', () => {
      const totalPages = Math.ceil(this._data.length / this._pageSize);
      if (this._page < totalPages) { this._page++; this._renderTable(); }
    });
  }

  private _renderPagination(total: number, current: number, totalPages: number): string {
    if (totalPages <= 1) return '';
    return `
      <div class="ct-whd-pagination">
        <button class="ct-btn ct-btn--secondary ct-whd-prev" ${current <= 1 ? 'disabled' : ''} aria-label="Vorherige Seite">‹ Zurück</button>
        <span class="ct-whd-page-info">Seite ${current} / ${totalPages} (${total} Einträge)</span>
        <button class="ct-btn ct-btn--secondary ct-whd-next" ${current >= totalPages ? 'disabled' : ''} aria-label="Nächste Seite">Weiter ›</button>
      </div>`;
  }

  private _showDetail(itineraryId: string): void {
    const row = this._data.find((r) => r.itineraryId === itineraryId);
    if (!row) return;

    this._detailEl?.remove(); this._detailEl = null;

    const formatForDisplay = (field: typeof WHD_DETAIL_FIELDS[number], value: unknown): string => {
      if (value === null || value === undefined) return '—';
      switch (field.format) {
        case 'time':     return whdFormatTime(value as number);
        case 'duration': return whdFormatDuration(value as number);
        case 'integer':  return String(value) + (field.suffix || '');
        default:         return String(value);
      }
    };

    const fieldsHtml = WHD_DETAIL_FIELDS.map((f) => {
      const displayValue = formatForDisplay(f, row[f.key]);
      return `<div class="ct-whd-detail-row">
        <div>
          <span class="ct-whd-detail-label">${esc(f.label)}</span><br>
          <span class="ct-whd-detail-value">${esc(displayValue)}</span>
        </div>
        <button class="ct-whd-copy-btn" data-copy-value="${esc(displayValue)}" aria-label="Copy ${esc(f.label)}">📋 Copy</button>
      </div>`;
    }).join('');

    const allText = WHD_DETAIL_FIELDS.map((f) => `${f.label}: ${formatForDisplay(f, row[f.key])}`).join('\n');

    const modal = document.createElement('div');
    modal.className = 'ct-overlay visible';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="ct-dialog" style="min-width:420px;max-width:580px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;color:var(--ct-primary);">📋 Itinerary Details</h3>
          <button class="ct-btn ct-btn--close" id="ct-whd-detail-close" aria-label="Close" style="margin-left:auto;">✕</button>
        </div>
        ${fieldsHtml}
        <div style="margin-top:16px;text-align:center;">
          <button class="ct-btn ct-btn--primary" id="ct-whd-copy-all">📋 Copy All</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    this._detailEl = modal;

    const closeModal = () => { modal.remove(); this._detailEl = null; };
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.getElementById('ct-whd-detail-close')!.addEventListener('click', closeModal);
    modal.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') closeModal(); });

    modal.querySelectorAll<HTMLElement>('.ct-whd-copy-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = btn.dataset['copyValue']!;
        navigator.clipboard.writeText(val).then(() => {
          const orig = btn.textContent; btn.textContent = '✅ Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        }).catch(() => { btn.textContent = '⚠️ Failed'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500); });
      });
    });

    document.getElementById('ct-whd-copy-all')!.addEventListener('click', () => {
      const btn = document.getElementById('ct-whd-copy-all')!;
      navigator.clipboard.writeText(allText).then(() => {
        btn.textContent = '✅ All Copied!'; setTimeout(() => { btn.textContent = '📋 Copy All'; }, 1500);
      }).catch(() => { btn.textContent = '⚠️ Failed'; setTimeout(() => { btn.textContent = '📋 Copy All'; }, 1500); });
    });

    document.getElementById('ct-whd-detail-close')!.focus();
  }

  private _exportCSV(): void {
    if (!this._data || this._data.length === 0) { alert('Bitte zuerst Daten laden.'); return; }

    const sep = ';';
    const csvHeaders = ['routeCode', 'serviceTypeName', 'blockDurationInMinutes', 'waveStartTime', 'itineraryStartTime', 'plannedDepartureTime', 'actualDepartureTime', 'plannedOutboundStemTime', 'actualOutboundStemTime', 'lastDriverEventTime', 'itineraryId'];

    let csv = csvHeaders.join(sep) + '\n';
    const sorted = whdSortRows(this._data, this._sort.column, this._sort.direction);

    for (const row of sorted) {
      const cells = csvHeaders.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (h === 'plannedOutboundStemTime' || h === 'actualOutboundStemTime') return whdFormatDuration(val as number);
        if (h === 'routeCode' || h === 'serviceTypeName' || h === 'itineraryId' || h === 'blockDurationInMinutes') return String(val);
        return whdFormatTime(val as number);
      });
      csv += cells.join(sep) + '\n';
    }

    const date = (document.getElementById('ct-whd-date') as HTMLInputElement)?.value || todayStr();
    const sel = document.getElementById('ct-whd-sa') as HTMLSelectElement | null;
    const saId = (sel && sel.value) ? sel.value : '';
    const stationCode = this.companyConfig.getServiceAreas().find((sa) => sa.serviceAreaId === saId)?.stationCode || 'unknown';
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `working_hours_${date}_${stationCode}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  private _setStatus(msg: string): void { const el = document.getElementById('ct-whd-status'); if (el) el.textContent = msg; }
  private _setBody(html: string): void { const el = document.getElementById('ct-whd-body'); if (el) el.innerHTML = html; }
}
