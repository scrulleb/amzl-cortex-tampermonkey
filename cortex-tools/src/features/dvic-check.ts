// features/dvic-check.ts – DVIC (Daily Vehicle Inspection Check) Dashboard

import { log, err, esc, withRetry, getCSRFToken, addDays } from '../core/utils';
import { onDispose } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { AppConfig as AppConfigType } from '../core/storage';
import { setConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';

interface VehicleRecord {
  vehicleIdentifier: string;
  preTripTotal: number;
  postTripTotal: number;
  missingCount: number;
  status: string;
  inspectedAt: string | null;
  shiftDate: string | null;
  reporterIds: string[];
  reporterNames: string[];
}

export class DvicCheck {
  private _overlayEl: HTMLElement | null = null;
  private _active = false;
  private _vehicles: VehicleRecord[] = [];
  private _nameCache = new Map<string, string>();
  private _lastTimestamp: number | null = null;
  private _loading = false;
  private _pageSize = 25;
  private _pageCurrent = 1;
  private _pageMissing = 1;
  private _currentTab: 'all' | 'missing' = 'all';

  get _showTransporters(): boolean {
    return this.config.features.dvicShowTransporters !== false;
  }

  constructor(
    private readonly config: AppConfig,
    private readonly companyConfig: CompanyConfig,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(): void {
    if (this._overlayEl) return;

    const overlay = document.createElement('div');
    overlay.id = 'ct-dvic-overlay';
    overlay.className = 'ct-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'DVIC Check');
    overlay.innerHTML = `
      <div class="ct-dvic-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <h2>🚛 DVIC Check</h2>
            <div id="ct-dvic-asof" style="font-size:11px;color:var(--ct-muted);margin-top:2px;"></div>
          </div>
          <button class="ct-btn ct-btn--close" id="ct-dvic-close" aria-label="Schließen">✕ Schließen</button>
        </div>
        <div id="ct-dvic-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-dvic-tiles"></div>
        <div class="ct-dvic-tabs" role="tablist">
          <button class="ct-dvic-tab ct-dvic-tab--active" data-tab="all" role="tab"
                  aria-selected="true" id="ct-dvic-tab-all">Alle Fahrzeuge</button>
          <button class="ct-dvic-tab" data-tab="missing" role="tab"
                  aria-selected="false" id="ct-dvic-tab-missing">⚠️ DVIC Fehlend</button>
        </div>
        <div id="ct-dvic-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._overlayEl = overlay;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hide(); });
    document.getElementById('ct-dvic-close')!.addEventListener('click', () => this.hide());

    overlay.querySelector('.ct-dvic-tabs')!.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest('.ct-dvic-tab') as HTMLElement | null;
      if (!btn) return;
      this._switchTab(btn.dataset['tab'] as 'all' | 'missing');
    });

    onDispose(() => this.dispose());
    log('DVIC Check initialized');
  }

  dispose(): void {
    this._overlayEl?.remove(); this._overlayEl = null;
    this._vehicles = [];
    this._active = false;
    this._lastTimestamp = null;
    this._loading = false;
  }

  toggle(): void {
    if (!this.config.features.dvicCheck) {
      alert('DVIC Check ist deaktiviert. Bitte in den Einstellungen aktivieren.');
      return;
    }
    this.init();
    if (this._active) this.hide(); else this.show();
  }

  show(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
    this._pageCurrent = 1;
    this._pageMissing = 1;
    this._currentTab = 'all';
    this._switchTab('all');
    this._refresh();
  }

  hide(): void {
    this._overlayEl?.classList.remove('visible');
    this._active = false;
  }

  // ── Tab management ─────────────────────────────────────────────────────────

  private _switchTab(tab: 'all' | 'missing'): void {
    this._currentTab = tab;
    this._overlayEl?.querySelectorAll('.ct-dvic-tab').forEach((btn) => {
      const active = (btn as HTMLElement).dataset['tab'] === tab;
      btn.classList.toggle('ct-dvic-tab--active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    if (this._vehicles.length > 0) this._renderBody();
  }

  // ── Timestamp helpers ──────────────────────────────────────────────────────

  private _getTodayBremenTimestamp(): number {
    const now = new Date();
    const dateStr = now.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' });
    const [y, mo, d] = dateStr.split('-').map(Number);
    const utcRef = new Date(Date.UTC(y, mo - 1, d, 6, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(utcRef);
    const berlinH = parseInt(parts.find((p) => p.type === 'hour')!.value, 10) % 24;
    const berlinM = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
    const offsetMinutes = (berlinH * 60 + berlinM) - 6 * 60;
    return Date.UTC(y, mo - 1, d) - offsetMinutes * 60000;
  }

  // ── API ────────────────────────────────────────────────────────────────────

  private async _fetchInspectionStats(timestamp: number): Promise<unknown> {
    const url = `https://logistics.amazon.de/fleet-management/api/inspection-stats?startTimestamp=${timestamp}`;
    const csrf = getCSRFToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const resp = await withRetry(async () => {
      const r = await fetch(url, { method: 'GET', headers, credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r;
    }, { retries: 2, baseMs: 800 });

    return resp.json();
  }

  private async _getEmployeeNames(reporterIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(reporterIds)];
    const uncached = unique.filter((id) => !this._nameCache.has(id));

    if (uncached.length > 0) {
      try {
        const saId = this.companyConfig.getDefaultServiceAreaId();
        const today = new Date().toISOString().split('T')[0];
        const fromDate = addDays(today, -30);
        const url = `https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${fromDate}&toDate=${today}&serviceAreaId=${saId}`;
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
                this._nameCache.set(String(entry['driverPersonId']), entry['driverName'] as string);
              }
            }
          };
          if (Array.isArray(roster)) processEntries(roster);
          else if (typeof roster === 'object') {
            for (const val of Object.values(roster)) {
              if (Array.isArray(val)) processEntries(val as Array<Record<string, unknown>>);
            }
          }
          log('[DVIC] Roster fetch: added', this._nameCache.size, 'names to cache');
        }
      } catch (e) {
        log('[DVIC] Roster lookup failed:', e);
      }
    }

    const result = new Map<string, string>();
    for (const id of reporterIds) {
      result.set(id, this._nameCache.get(id) || id);
    }
    return result;
  }

  // ── Data normalisation ─────────────────────────────────────────────────────

  private _normalizeVehicle(vehicleStat: Record<string, unknown>): VehicleRecord {
    const vehicleIdentifier = String(vehicleStat?.['vehicleIdentifier'] ?? '').trim() || 'Unknown';
    const inspStats = Array.isArray(vehicleStat?.['inspectionStats']) ? vehicleStat['inspectionStats'] as Record<string, unknown>[] : [];

    const preStat  = inspStats.find((s) => (s?.['inspectionType'] ?? s?.['type']) === 'PRE_TRIP_DVIC')  ?? null;
    const postStat = inspStats.find((s) => (s?.['inspectionType'] ?? s?.['type']) === 'POST_TRIP_DVIC') ?? null;

    const preTripTotal  = Number(preStat?.['totalInspectionsDone']  ?? 0);
    const postTripTotal = Number(postStat?.['totalInspectionsDone'] ?? 0);

    const missingDVIC = preTripTotal - postTripTotal;
    const status      = missingDVIC > 0 ? 'Post Trip DVIC Missing' : 'OK';
    const missingCount = status === 'OK' ? 0 : missingDVIC;

    const candidateDates = [preStat, postStat]
      .filter(Boolean)
      .map((s) => (s as Record<string, unknown>)['inspectedAt'] ?? (s as Record<string, unknown>)['lastInspectedAt'] ?? null)
      .filter(Boolean) as string[];
    const inspectedAt = candidateDates.length > 0 ? candidateDates.sort().at(-1) ?? null : null;
    const shiftDate = (preStat?.['shiftDate'] ?? postStat?.['shiftDate'] ?? null) as string | null;

    const reporterIdSet = new Set<string>();
    for (const stat of inspStats) {
      const details = Array.isArray(stat?.['inspectionDetails']) ? stat['inspectionDetails'] as Record<string, unknown>[] : [];
      for (const detail of details) {
        const rid = detail?.['reporterId'];
        if (rid != null && String(rid).trim() !== '') reporterIdSet.add(String(rid).trim());
      }
    }

    return { vehicleIdentifier, preTripTotal, postTripTotal, missingCount, status, inspectedAt, shiftDate, reporterIds: [...reporterIdSet], reporterNames: [] };
  }

  private _processApiResponse(json: unknown): VehicleRecord[] {
    if (json === null || typeof json !== 'object') throw new Error('API response is not a JSON object');
    const list = (json as Record<string, unknown>)?.['inspectionsStatList'];
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) throw new Error(`inspectionsStatList has unexpected type: ${typeof list}`);
    return list.map((v) => this._normalizeVehicle(v as Record<string, unknown>));
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  private async _refresh(): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._vehicles = [];

    const ts = this._getTodayBremenTimestamp();
    this._lastTimestamp = ts;
    const dateLabel = new Date(ts).toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
    });

    this._setStatus(`⏳ Lade DVIC-Daten für heute (${dateLabel})…`);
    this._setTiles('');
    this._setBody('<div class="ct-dvic-loading" role="status">Daten werden geladen…</div>');

    try {
      const json = await this._fetchInspectionStats(ts);
      let vehicles: VehicleRecord[];
      try {
        vehicles = this._processApiResponse(json);
      } catch (parseErr) {
        err('DVIC response parse error:', parseErr);
        this._setBody(`<div class="ct-dvic-error" role="alert">⚠️ DVIC data unavailable for this date.<br><small>${esc((parseErr as Error).message)}</small></div>`);
        this._setStatus('⚠️ Daten konnten nicht verarbeitet werden.');
        this._loading = false;
        return;
      }

      const allIds = [...new Set(vehicles.flatMap((v) => v.reporterIds))];
      if (allIds.length > 0) {
        this._setStatus('⏳ Lade Mitarbeiternamen…');
        try {
          const nameMap = await this._getEmployeeNames(allIds);
          for (const v of vehicles) {
            v.reporterNames = [...new Set(v.reporterIds.map((id) => nameMap.get(id) || id))];
          }
        } catch (nameErr) {
          log('Name enrichment failed, using IDs as fallback:', nameErr);
          for (const v of vehicles) { v.reporterNames = [...v.reporterIds]; }
        }
      } else {
        for (const v of vehicles) { v.reporterNames = []; }
      }

      this._vehicles = vehicles;
      const missingVehicles = vehicles.filter((v) => v.status !== 'OK').length;
      const totalMissing    = vehicles.reduce((s, v) => s + v.missingCount, 0);

      this._setStatus(`✅ ${vehicles.length} Fahrzeuge | ${missingVehicles} mit fehlendem Post-Trip DVIC | ${totalMissing} fehlende DVICs gesamt`);

      const asOfEl = document.getElementById('ct-dvic-asof');
      if (asOfEl) {
        const fetchedAt = new Date().toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        asOfEl.textContent = `Stand: ${fetchedAt} (Daten ab ${dateLabel})`;
      }
      this._renderTiles(vehicles.length, missingVehicles, totalMissing);
      this._updateMissingTabBadge(missingVehicles);
      this._renderBody();
    } catch (e) {
      err('DVIC fetch failed:', e);
      this._setBody(`<div class="ct-dvic-error" role="alert">❌ DVIC-Daten konnten nicht geladen werden.<br><small>${esc((e as Error).message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-dvic-retry">🔄 Erneut versuchen</button></div>`);
      this._setStatus('❌ Fehler beim Laden.');
      document.getElementById('ct-dvic-retry')?.addEventListener('click', () => this._refresh());
    } finally {
      this._loading = false;
    }
  }

  // ── Status helpers ─────────────────────────────────────────────────────────

  private _setStatus(msg: string): void { const el = document.getElementById('ct-dvic-status'); if (el) el.textContent = msg; }
  private _setBody(html: string): void { const el = document.getElementById('ct-dvic-body'); if (el) el.innerHTML = html; }
  private _setTiles(html: string): void { const el = document.getElementById('ct-dvic-tiles'); if (el) el.innerHTML = html; }

  private _updateMissingTabBadge(count: number): void {
    const tab = document.getElementById('ct-dvic-tab-missing');
    if (tab) tab.textContent = count > 0 ? `⚠️ DVIC Fehlend (${count})` : '⚠️ DVIC Fehlend';
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _renderTiles(total: number, missingVehicles: number, missingTotal: number): void {
    const errCls = missingVehicles === 0 ? 'ct-dvic-tile--ok' : missingVehicles < 5 ? 'ct-dvic-tile--warn' : 'ct-dvic-tile--danger';
    this._setTiles(`
      <div class="ct-dvic-tiles">
        <div class="ct-dvic-tile"><div class="ct-dvic-tile-val">${total}</div><div class="ct-dvic-tile-lbl">Fahrzeuge gesamt</div></div>
        <div class="ct-dvic-tile ${errCls}"><div class="ct-dvic-tile-val">${missingVehicles}</div><div class="ct-dvic-tile-lbl">Fahrzeuge mit Fehler</div></div>
        <div class="ct-dvic-tile ${missingTotal === 0 ? 'ct-dvic-tile--ok' : 'ct-dvic-tile--danger'}"><div class="ct-dvic-tile-val">${missingTotal}</div><div class="ct-dvic-tile-lbl">DVIC fehlend gesamt</div></div>
        <div class="ct-dvic-tile ${missingVehicles === 0 ? 'ct-dvic-tile--ok' : ''}"><div class="ct-dvic-tile-val">${total - missingVehicles}</div><div class="ct-dvic-tile-lbl">Fahrzeuge OK</div></div>
      </div>`);
  }

  private _renderBody(): void {
    if (!this._overlayEl) return;
    if (this._vehicles.length === 0) {
      this._setBody('<div class="ct-dvic-empty">Keine DVIC-Daten verfügbar für dieses Datum.</div>');
      return;
    }
    if (this._currentTab === 'all') this._renderAllTab();
    else this._renderMissingTab();
  }

  private _renderTransporterNames(v: VehicleRecord): string {
    const ids = (v.reporterIds ?? []).filter((id) => String(id).trim() !== '');
    if (ids.length === 0) return `<em class="ct-dvic-tp-unknown" aria-label="Unbekannter Transporter">Unbekannter Transporter</em>`;
    const labels = ids.map((id) => {
      const name = this._nameCache.get(id);
      return (name && name !== id) ? `${name} (ID: ${id})` : id;
    });
    if (labels.length === 0) return `<em class="ct-dvic-tp-unknown">Unbekannter Transporter</em>`;
    const [primary, ...rest] = labels;
    const secondary = rest.length > 0 ? `<span class="ct-dvic-tp-secondary">, ${esc(rest.join(', '))}</span>` : '';
    return `<span class="ct-dvic-tp-primary" aria-label="Transporter: ${esc(labels.join(', '))}">${esc(primary)}${secondary}</span>`;
  }

  private _renderAllTab(): void {
    const page = this._pageCurrent;
    const total = this._vehicles.length;
    const totalPages = Math.ceil(total / this._pageSize);
    const start = (page - 1) * this._pageSize;
    const slice = this._vehicles.slice(start, start + this._pageSize);
    const showTp = this._showTransporters;

    const rows = slice.map((v) => {
      const isMissing = v.status !== 'OK';
      const rowCls = isMissing ? 'ct-dvic-row--missing' : '';
      const badgeCls = isMissing ? 'ct-dvic-badge--missing' : 'ct-dvic-badge--ok';
      const tpCell = showTp ? `<td class="ct-dvic-tp-cell">${this._renderTransporterNames(v)}</td>` : '';
      return `<tr class="${rowCls}" role="row">
        <td>${esc(v.vehicleIdentifier)}</td>
        <td>${v.preTripTotal}</td><td>${v.postTripTotal}</td>
        <td>${v.missingCount > 0 ? `<strong>${v.missingCount}</strong>` : '0'}</td>
        <td><span class="${badgeCls}">${esc(v.status)}</span></td>
        ${tpCell}<td></td>
      </tr>`;
    }).join('');

    const tpToggleLabel = showTp ? 'Transporter ausblenden' : 'Transporter einblenden';
    const tpHeader = showTp ? `<th scope="col" class="ct-dvic-tp-th">Transporter</th>` : '';

    this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-all">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${showTp}">👤 ${tpToggleLabel}</button>
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip ✓</th><th scope="col">Post-Trip ✓</th>
            <th scope="col">Fehlend</th><th scope="col">Status</th>
            ${tpHeader}<th scope="col" style="width:4px;"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${this._renderPagination(total, page, totalPages, 'all')}
      </div>`);

    document.getElementById('ct-dvic-tp-toggle')?.addEventListener('click', () => {
      this.config.features.dvicShowTransporters = !this._showTransporters;
      setConfig(this.config);
      this._renderBody();
    });
    this._attachPaginationHandlers('all');
  }

  private _renderMissingTab(): void {
    const missing = this._vehicles.filter((v) => v.status !== 'OK');
    if (missing.length === 0) {
      this._setBody('<div class="ct-dvic-empty">✅ Alle Fahrzeuge haben Post-Trip DVICs — kein Handlungsbedarf.</div>');
      return;
    }

    const page = this._pageMissing;
    const totalPages = Math.ceil(missing.length / this._pageSize);
    const start = (page - 1) * this._pageSize;
    const slice = missing.slice(start, start + this._pageSize);
    const showTp = this._showTransporters;

    const rows = slice.map((v) => {
      const tpCell = showTp ? `<td class="ct-dvic-tp-cell">${this._renderTransporterNames(v)}</td>` : '';
      return `<tr class="ct-dvic-row--missing" role="row">
        <td>${esc(v.vehicleIdentifier)}</td>
        <td>${v.preTripTotal}</td><td>${v.postTripTotal}</td>
        <td><strong>${v.missingCount}</strong></td>
        ${tpCell}
      </tr>`;
    }).join('');

    const tpToggleLabel = showTp ? 'Transporter ausblenden' : 'Transporter einblenden';
    const tpHeader = showTp ? `<th scope="col" class="ct-dvic-tp-th">Transporter</th>` : '';

    this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-missing">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${showTp}">👤 ${tpToggleLabel}</button>
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip ✓</th><th scope="col">Post-Trip ✓</th>
            <th scope="col">Fehlend</th>${tpHeader}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${this._renderPagination(missing.length, page, totalPages, 'missing')}
      </div>`);

    document.getElementById('ct-dvic-tp-toggle')?.addEventListener('click', () => {
      this.config.features.dvicShowTransporters = !this._showTransporters;
      setConfig(this.config);
      this._renderBody();
    });
    this._attachPaginationHandlers('missing');
  }

  private _renderPagination(total: number, current: number, totalPages: number, tabKey: string): string {
    if (totalPages <= 1) return '';
    return `
      <div class="ct-dvic-pagination">
        <button class="ct-btn ct-btn--secondary ct-dvic-prev-page" data-tab="${tabKey}" ${current <= 1 ? 'disabled' : ''}>‹ Zurück</button>
        <span class="ct-dvic-page-info">Seite ${current} / ${totalPages} (${total} Einträge)</span>
        <button class="ct-btn ct-btn--secondary ct-dvic-next-page" data-tab="${tabKey}" ${current >= totalPages ? 'disabled' : ''}>Weiter ›</button>
      </div>`;
  }

  private _attachPaginationHandlers(tabKey: string): void {
    const body = document.getElementById('ct-dvic-body');
    if (!body) return;
    body.querySelector(`.ct-dvic-prev-page[data-tab="${tabKey}"]`)?.addEventListener('click', () => {
      if (tabKey === 'all') { if (this._pageCurrent > 1) { this._pageCurrent--; this._renderAllTab(); } }
      else { if (this._pageMissing > 1) { this._pageMissing--; this._renderMissingTab(); } }
    });
    body.querySelector(`.ct-dvic-next-page[data-tab="${tabKey}"]`)?.addEventListener('click', () => {
      const t = tabKey === 'all' ? this._vehicles.length : this._vehicles.filter((v) => v.status !== 'OK').length;
      const tp = Math.ceil(t / this._pageSize);
      if (tabKey === 'all') { if (this._pageCurrent < tp) { this._pageCurrent++; this._renderAllTab(); } }
      else { if (this._pageMissing < tp) { this._pageMissing++; this._renderMissingTab(); } }
    });
  }
}
