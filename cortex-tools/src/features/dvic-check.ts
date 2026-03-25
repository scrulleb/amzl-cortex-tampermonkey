// features/dvic-check.ts – DVIC (Daily Vehicle Inspection Check) Dashboard

const DEBUG = false;
// Using console.warn for ALL debug logs so they appear without enabling "Verbose" in browser console
const dbg = (...a: unknown[]) => DEBUG && console.warn('[dvic-check]', ...a);
const dbgWarn = (...a: unknown[]) => DEBUG && console.warn('[dvic-check]', ...a);

import { log, err, esc, withRetry, getCSRFToken, addDays } from '../core/utils';
import { onDispose } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { AppConfig as AppConfigType } from '../core/storage';
import { setConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';

interface UploadTemplate {
  'AX-Signature': string;
  'AX-SessionID': string;
  'AX-DocumentDisposition': string;
  filenames: string[];
  action: string;
  token: string;
}

interface InspectionPayload {
  inspectionStartTime: number;
  inspectionType: 'POST_TRIP_DVIC';
  VIN: string;
  defectsFound: never[];
  paperInspectionDocId: string;
  reporterId: string;
  serviceAreaId: string;
}

interface SubmitResult {
  vehicleIdentifier: string;
  success: boolean;
  error?: string;
}

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

interface VsaRecord {
  vehicleIdentifier: string;
  inspectionType: string;
  inspectedAt: string | null;
  reporterId: string;
  reporterName: string;
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
  private _pageVsa = 1;
  private _currentTab: 'all' | 'missing' | 'vsa' = 'all';
  private _vsaInspections: VsaRecord[] = [];
  private _assetIdCache = new Map<string, string>();
  private _submitting = false;

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
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="ct-btn ct-btn--close" id="ct-dvic-close" aria-label="Schließen">✕ Schließen</button>
          </div>
        </div>
        <div id="ct-dvic-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-dvic-tiles"></div>
        <div class="ct-dvic-tabs" role="tablist">
          <button class="ct-dvic-tab ct-dvic-tab--active" data-tab="all" role="tab"
                  aria-selected="true" id="ct-dvic-tab-all">Alle Fahrzeuge</button>
          <button class="ct-dvic-tab" data-tab="missing" role="tab"
                  aria-selected="false" id="ct-dvic-tab-missing">⚠️ DVIC Fehlend</button>
          <button class="ct-dvic-tab" data-tab="vsa" role="tab"
                  aria-selected="false" id="ct-dvic-tab-vsa">🔍 VSA</button>
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
      this._switchTab(btn.dataset['tab'] as 'all' | 'missing' | 'vsa');
    });

    onDispose(() => this.dispose());
    log('DVIC Check initialized');
  }

  dispose(): void {
    this._overlayEl?.remove(); this._overlayEl = null;
    this._vehicles = [];
    this._vsaInspections = [];
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

  /** Open the overlay directly on the Missing tab */
  showMissing(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
    this._pageCurrent = 1;
    this._pageMissing = 1;
    this._pageVsa = 1;
    this._currentTab = 'missing';
    this._switchTab('missing');
    this._refresh();
  }

  show(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
    this._pageCurrent = 1;
    this._pageMissing = 1;
    this._pageVsa = 1;
    this._currentTab = 'all';
    this._switchTab('all');
    this._refresh();
  }

  hide(): void {
    this._overlayEl?.classList.remove('visible');
    this._active = false;
  }

  // ── Tab management ─────────────────────────────────────────────────────────

  private _switchTab(tab: 'all' | 'missing' | 'vsa'): void {
    this._currentTab = tab;
    this._overlayEl?.querySelectorAll('.ct-dvic-tab').forEach((btn) => {
      const active = (btn as HTMLElement).dataset['tab'] === tab;
      btn.classList.toggle('ct-dvic-tab--active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    if (this._vehicles.length > 0) this._renderBody();
  }

  // ── Timestamp helpers ──────────────────────────────────────────────────────

  private _getTodayBerlinStartTimestamp(): number {
    const now = new Date();
    const dateStr = now.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' });
    const [y, mo, d] = dateStr.split('-').map(Number);
    // Fire a reference point at 06:00 UTC to determine the Berlin offset on this date
    const utcRef = new Date(Date.UTC(y, mo - 1, d, 6, 0, 0));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(utcRef);
    const berlinH = parseInt(parts.find((p) => p.type === 'hour')!.value, 10) % 24;
    const berlinM = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
    // offsetMinutes = Berlin local time minus UTC at that reference (06:00 UTC → berlinH:berlinM Berlin)
    const offsetMinutes = (berlinH * 60 + berlinM) - 6 * 60;
    // Midnight Berlin = UTC midnight minus offsetMinutes
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

    dbg('_getEmployeeNames called with', reporterIds.length, 'IDs,', uncached.length, 'uncached:', uncached);

    if (uncached.length > 0) {
      try {
        const allSaIds = this.companyConfig.getServiceAreas().map((sa) => sa.serviceAreaId);
        const saIds = allSaIds.length > 0 ? allSaIds : [this.companyConfig.getDefaultServiceAreaId()];
        dbg('Fetching roster for service areas:', saIds);
        const today = new Date().toISOString().split('T')[0];
        const fromDate = addDays(today, -30);
        const csrf = getCSRFToken();
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (csrf) headers['anti-csrftoken-a2z'] = csrf;

        const processEntries = (entries: Array<Record<string, unknown>>) => {
          let hitTransporterId = 0;
          let hitDriverPersonId = 0;
          let hitDriverProviderId = 0;
          let missedAll = 0;
          if (entries.length > 0) {
            dbg('First entry ALL KEYS:', Object.keys(entries[0]));
            dbg('First entry FULL DUMP:', JSON.parse(JSON.stringify(entries[0])));
          }
          for (const entry of entries) {
            const name = entry['driverName'] as string | undefined;
            if (!name) { missedAll++; continue; }
            if (entry['transporterId']) {
              this._nameCache.set(String(entry['transporterId']), name);
              hitTransporterId++;
            }
            if (entry['driverPersonId']) {
              this._nameCache.set(String(entry['driverPersonId']), name);
              hitDriverPersonId++;
            }
            // Also index by the Flex provider ID (driverProviderId) in case reporterId uses that namespace
            if (entry['driverProviderId']) {
              this._nameCache.set(String(entry['driverProviderId']), name);
              hitDriverProviderId++;
            }
            if (!entry['transporterId'] && !entry['driverPersonId'] && !entry['driverProviderId']) {
              missedAll++;
            }
          }
          dbg(`processEntries: ${entries.length} entries → transporterId:${hitTransporterId} driverPersonId:${hitDriverPersonId} driverProviderId:${hitDriverProviderId} missed:${missedAll}`);
        };

        // Fetch roster for all service areas (inspection data spans all SAs)
        let totalFetched = 0;
        let totalPages = 0;
        for (const saId of saIds) {
          let pageToken: string | null = null;
          let pageIndex = 0;
          const MAX_PAGES = 20; // safety cap per SA
          do {
            const params = new URLSearchParams({
              fromDate, toDate: today, serviceAreaId: saId, pageSize: '200',
            });
            if (pageToken) params.set('pageToken', pageToken);
            const url = `https://logistics.amazon.de/scheduling/home/api/v2/rosters?${params}`;
            dbg(`Roster SA=${saId} page ${pageIndex} request:`, url);

            const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
            if (!resp.ok) {
              dbgWarn(`Roster SA=${saId} page ${pageIndex} HTTP ${resp.status} — stopping`);
              break;
            }
            const json = await resp.json() as Record<string, unknown>;
            dbg(`Roster SA=${saId} page ${pageIndex} top-level keys:`, Object.keys(json));
            dbg(`Roster SA=${saId} page ${pageIndex} meta:`, json['meta']);

            const entries: Array<Record<string, unknown>> =
              Array.isArray(json) ? json as Array<Record<string, unknown>> :
              Array.isArray(json['data']) ? json['data'] as Array<Record<string, unknown>> :
              Array.isArray(json['rosters']) ? json['rosters'] as Array<Record<string, unknown>> :
              [];

            dbg(`Roster SA=${saId} page ${pageIndex}: ${entries.length} entries`);
            processEntries(entries);
            totalFetched += entries.length;
            totalPages++;

            const meta = json['meta'] as Record<string, unknown> | undefined;
            const next =
              (meta?.['nextPageToken'] as string | undefined) ??
              (meta?.['nextToken'] as string | undefined) ??
              (meta?.['pageToken'] as string | undefined) ??
              (json['nextPageToken'] as string | undefined) ??
              (json['nextToken'] as string | undefined) ??
              null;
            const hasMore =
              !!next ||
              (meta?.['hasMore'] as boolean | undefined) === true ||
              (typeof meta?.['totalCount'] === 'number' && totalFetched < (meta['totalCount'] as number));

            dbg(`Roster SA=${saId} page ${pageIndex}: hasMore=${hasMore}, nextToken=${next}`);
            pageToken = next;
            pageIndex++;
            if (!hasMore || entries.length === 0) break;
          } while (pageIndex < MAX_PAGES);
        }

        log('[DVIC] Roster fetch complete: fetched', totalFetched, 'entries across', totalPages, 'page(s) and', saIds.length, 'SA(s); cache size:', this._nameCache.size);

        const cacheEntries = [...this._nameCache.entries()];
        dbg('_nameCache final — size:', cacheEntries.length, '| sample (first 10):', cacheEntries.slice(0, 10));
      } catch (e) {
        log('[DVIC] Roster lookup failed:', e);
      }
    }

    const result = new Map<string, string>();
    for (const id of reporterIds) {
      const hit = this._nameCache.get(id);
      if (hit) {
        dbg(`Cache HIT  key="${id}" → "${hit}"`);
        result.set(id, hit);
      } else {
        // Find candidate keys that share the same length or partially match for mismatch diagnosis
        const candidates = [...this._nameCache.keys()].filter(
          (k) => k.length === id.length || k.toLowerCase().includes(id.toLowerCase()) || id.toLowerCase().includes(k.toLowerCase()),
        );
        dbgWarn(`Cache MISS key="${id}" (type: ${typeof id}). Similar keys in cache:`, candidates.length > 0 ? candidates : '(none)');
        result.set(id, id);
      }
    }
    return result;
  }

  // ── Data normalisation ─────────────────────────────────────────────────────

  private _isVsaInspection(stat: Record<string, unknown>): boolean {
    const details = Array.isArray(stat?.['inspectionDetails']) ? stat['inspectionDetails'] as Record<string, unknown>[] : [];
    // A VSA inspection has reporterId that looks like an Amazon employee email address
    return details.some((d) => {
      const rid = String(d?.['reporterId'] ?? '');
      return rid.includes('@') && (rid.endsWith('amazon.com') || rid.endsWith('amazon.de'));
    });
  }

  /** Returns true when a vehicle stat has at least one non-VSA inspection entry. */
  private _hasNonVsaStats(vehicleStat: Record<string, unknown>): boolean {
    const allInspStats = Array.isArray(vehicleStat?.['inspectionStats'])
      ? (vehicleStat['inspectionStats'] as Record<string, unknown>[])
      : [];
    return allInspStats.some((s) => {
      const itype = s?.['inspectionType'] ?? s?.['type'];
      if (itype === 'VSA') return false;
      if (this._isVsaInspection(s as Record<string, unknown>)) return false;
      return true;
    });
  }

  private _normalizeVehicle(vehicleStat: Record<string, unknown>): VehicleRecord {
    const vehicleIdentifier = String(vehicleStat?.['vehicleIdentifier'] ?? '').trim() || 'Unknown';
    const allInspStats = Array.isArray(vehicleStat?.['inspectionStats']) ? vehicleStat['inspectionStats'] as Record<string, unknown>[] : [];

    // Exclude VSA inspections — identified by inspectionType === 'VSA' or by reporter being an Amazon employee email
    const inspStats = allInspStats.filter((s) => {
      const itype = (s?.['inspectionType'] ?? s?.['type']);
      if (itype === 'VSA') return false;
      if (this._isVsaInspection(s)) return false;
      return true;
    });

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
        if (rid != null && String(rid).trim() !== '') {
          const ridStr = String(rid).trim();
          // Exclude Amazon employee email addresses from reporter IDs (VSA reporters)
          if (!ridStr.includes('@')) reporterIdSet.add(ridStr);
        }
      }
    }

    return { vehicleIdentifier, preTripTotal, postTripTotal, missingCount, status, inspectedAt, shiftDate, reporterIds: [...reporterIdSet], reporterNames: [] };
  }

  private _extractVsaRecords(vehicleStatList: Record<string, unknown>[]): VsaRecord[] {
    const records: VsaRecord[] = [];
    for (const vehicleStat of vehicleStatList) {
      const vehicleIdentifier = String(vehicleStat?.['vehicleIdentifier'] ?? '').trim() || 'Unknown';
      const allInspStats = Array.isArray(vehicleStat?.['inspectionStats']) ? vehicleStat['inspectionStats'] as Record<string, unknown>[] : [];
      for (const stat of allInspStats) {
        const inspectionType = String(stat?.['inspectionType'] ?? stat?.['type'] ?? '');
        const details = Array.isArray(stat?.['inspectionDetails']) ? stat['inspectionDetails'] as Record<string, unknown>[] : [];
        for (const detail of details) {
          const rid = String(detail?.['reporterId'] ?? '').trim();
          if (rid.includes('@') && (rid.endsWith('amazon.com') || rid.endsWith('amazon.de'))) {
            const inspectedAt = String(detail?.['inspectedAt'] ?? detail?.['timestamp'] ?? stat?.['lastInspectedAt'] ?? '').trim() || null;
            records.push({ vehicleIdentifier, inspectionType, inspectedAt, reporterId: rid, reporterName: rid });
          }
        }
      }
    }
    return records;
  }

  private _processApiResponse(json: unknown): { vehicles: VehicleRecord[]; vsaInspections: VsaRecord[] } {
    if (json === null || typeof json !== 'object') throw new Error('API response is not a JSON object');
    const list = (json as Record<string, unknown>)?.['inspectionsStatList'];
    if (list === undefined || list === null) return { vehicles: [], vsaInspections: [] };
    if (!Array.isArray(list)) throw new Error(`inspectionsStatList has unexpected type: ${typeof list}`);
    const vehicleStatList = list as Record<string, unknown>[];
    return {
      // Exclude vehicles that have only VSA inspection entries — they are shown in the VSA tab instead
      vehicles: vehicleStatList
        .filter((v) => this._hasNonVsaStats(v))
        .map((v) => this._normalizeVehicle(v)),
      vsaInspections: this._extractVsaRecords(vehicleStatList),
    };
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  private async _refresh(): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._vehicles = [];

    const ts = this._getTodayBerlinStartTimestamp();
    this._lastTimestamp = ts;

    this._setStatus(`⏳ Lade DVIC-Daten für heute…`);
    this._setTiles('');
    this._setBody('<div class="ct-dvic-loading" role="status">Daten werden geladen…</div>');

    try {
      const json = await this._fetchInspectionStats(ts);

      // Dump first inspection detail to check if reporter names are embedded in the data
      try {
        const rawList = (json as Record<string, unknown>)?.['inspectionsStatList'] as Array<Record<string, unknown>> | undefined;
        if (rawList && rawList.length > 0) {
          const firstVehicle = rawList[0];
          dbg('Raw inspection first vehicle keys:', Object.keys(firstVehicle));
          const firstStats = Array.isArray(firstVehicle['inspectionStats']) ? firstVehicle['inspectionStats'] as Array<Record<string, unknown>> : [];
          if (firstStats.length > 0) {
            dbg('Raw inspection first stat keys:', Object.keys(firstStats[0]));
            const details = Array.isArray(firstStats[0]['inspectionDetails']) ? firstStats[0]['inspectionDetails'] as Array<Record<string, unknown>> : [];
            if (details.length > 0) {
              dbg('Raw inspection first detail FULL DUMP:', JSON.parse(JSON.stringify(details[0])));
            }
          }
        }
      } catch (_) { /* non-fatal diagnostic */ }

      // Pre-populate the VIN → assetId cache so submit buttons work without
      // a separate per-vehicle API call on the critical path.
      this._fetchVehicleAssetIds().catch((e) => log('[DVIC] Asset ID pre-fetch error:', e));

      let vehicles: VehicleRecord[];
      let vsaInspections: VsaRecord[];
      try {
        ({ vehicles, vsaInspections } = this._processApiResponse(json));
      } catch (parseErr) {
        err('DVIC response parse error:', parseErr);
        this._setBody(`<div class="ct-dvic-error" role="alert">⚠️ DVIC data unavailable.<br><small>${esc((parseErr as Error).message)}</small></div>`);
        this._setStatus('⚠️ Daten konnten nicht verarbeitet werden.');
        this._loading = false;
        return;
      }

      this._vsaInspections = vsaInspections;

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
        asOfEl.textContent = `Stand: ${fetchedAt}`;
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
    if (this._currentTab === 'vsa') {
      this._renderVsaTab();
      return;
    }
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
      if (name && name !== id) {
        dbg(`Render HIT  key="${id}" → "${name}"`);
        return `${name} (ID: ${id})`;
      } else {
        const candidates = [...this._nameCache.keys()].filter(
          (k) => k.length === id.length || k.toLowerCase().includes(id.toLowerCase()) || id.toLowerCase().includes(k.toLowerCase()),
        );
        dbgWarn(`Render MISS key="${id}" (type: ${typeof id}). Similar keys:`, candidates.length > 0 ? candidates : '(none)');
        return id;
      }
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
    const showSubmit = this.config.features.dvicAutoSubmit === true;

    const rows = slice.map((v) => {
      const tpCell = showTp ? `<td class="ct-dvic-tp-cell">${this._renderTransporterNames(v)}</td>` : '';
      const submitCell = showSubmit
        ? `<td><button class="ct-btn ct-btn--submit ct-dvic-submit-btn" data-vin="${esc(v.vehicleIdentifier)}" ${this._submitting ? 'disabled' : ''}>▶ Einreichen</button></td>`
        : '';
      return `<tr class="ct-dvic-row--missing" role="row">
        <td>${esc(v.vehicleIdentifier)}</td>
        <td>${v.preTripTotal}</td><td>${v.postTripTotal}</td>
        <td><strong>${v.missingCount}</strong></td>
        ${tpCell}${submitCell}
      </tr>`;
    }).join('');

    const tpToggleLabel = showTp ? 'Transporter ausblenden' : 'Transporter einblenden';
    const tpHeader = showTp ? `<th scope="col" class="ct-dvic-tp-th">Transporter</th>` : '';
    const submitHeader = showSubmit ? `<th scope="col">Aktion</th>` : '';
    const bulkBtn = showSubmit
      ? `<button class="ct-btn ct-btn--accent ct-dvic-bulk-submit" id="ct-dvic-bulk-submit" ${this._submitting ? 'disabled' : ''}>🔄 Alle fehlenden einreichen</button>`
      : '';

    this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-missing">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${showTp}">👤 ${tpToggleLabel}</button>
          ${bulkBtn}
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip ✓</th><th scope="col">Post-Trip ✓</th>
            <th scope="col">Fehlend</th>${tpHeader}${submitHeader}
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

    if (showSubmit) {
      document.querySelectorAll('.ct-dvic-submit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const vin = (btn as HTMLElement).dataset['vin']!;
          const vehicle = missing.find((v) => v.vehicleIdentifier === vin);
          if (vehicle) this._handleSingleSubmit(vehicle, btn as HTMLButtonElement);
        });
      });
      document.getElementById('ct-dvic-bulk-submit')?.addEventListener('click', () => {
        this._handleBulkSubmit();
      });
    }

    this._attachPaginationHandlers('missing');
  }

  // ── DVIC Auto-Submit helpers ───────────────────────────────────────────────

  private _createDummyPNG(): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Failed to create PNG blob'));
        resolve(new File([blob], 'inspection-report.png', { type: 'image/png' }));
      }, 'image/png');
    });
  }

  private async _getUploadTemplate(): Promise<UploadTemplate> {
    const csrf = getCSRFToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const resp = await withRetry(async () => {
      const r = await fetch(
        'https://logistics.amazon.de/document/api/v2/template?docClass=PaperInspectionReport&numFiles=1&numCSVFiles=0&clientAppId=FleetMgmt',
        { method: 'GET', headers, credentials: 'include' },
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r;
    }, { retries: 3, baseMs: 500 });

    return resp.json() as Promise<UploadTemplate>;
  }

  private async _uploadDummyFile(template: UploadTemplate, file: File): Promise<string> {
    const csrf = getCSRFToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const formData = new FormData();
    formData.append('_utf8_enable', '✓');
    formData.append('AX-SessionID', template['AX-SessionID']);
    formData.append('AX-DocumentDisposition', template['AX-DocumentDisposition']);
    formData.append('AX-Signature', template['AX-Signature']);
    formData.append(template.filenames[0], file);

    const isAbsolute = /^https?:\/\//i.test(template.action);
    const uploadUrl = isAbsolute ? template.action : `https://logistics.amazon.de${template.action}`;

    const resp = await withRetry(async () => {
      const r = await fetch(uploadUrl, {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r;
    }, { retries: 3, baseMs: 500 });

    const rawText = await resp.text();
    // Alexandria responses may have leading whitespace and a while(1); anti-hijack prefix
    const text = rawText.trim();
    const json = JSON.parse(text.replace(/^while\(1\);/, '')) as Record<string, unknown>;
    const content = (json['content'] as Record<string, unknown>)?.['documentUploadResponseList'] as Record<string, unknown>;
    const fileEntry = content?.[template.filenames[0]] as Record<string, unknown>;
    const documentId = (fileEntry?.['content'] as Record<string, unknown>)?.['documentId'] as string;
    if (!documentId) throw new Error('documentId not found in upload response');
    return documentId;
  }

  private async _setDocumentMetadata(vehicleAssetId: string, documentId: string, token: string): Promise<string> {
    const csrf = await this._getCSRF();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const doubleEncodedToken = encodeURIComponent(token);
    const url = `https://logistics.amazon.de/document/api/v1/metadata?clientAppId=FleetMgmt&token=${doubleEncodedToken}`;

    const body = JSON.stringify({
      docSubjectId: vehicleAssetId,
      docClass: 'PaperInspectionReport',
      docSubjectType: 'Vehicle',
      files: [{ title: 'inspection-report.png', storeToken: documentId, fileStore: 'Alexandria' }],
    });

    const resp = await withRetry(async () => {
      const r = await fetch(url, { method: 'POST', headers, body, credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r;
    }, { retries: 3, baseMs: 500 });

    const json = await resp.json() as Record<string, unknown>;
    const docInstanceId = json['docInstanceId'] as string;
    if (!docInstanceId) throw new Error('docInstanceId not found in metadata response');
    return docInstanceId;
  }

  /**
   * Returns the anti-CSRF token. Tries the current document first (meta/cookie/global),
   * then falls back to fetching the fleet-management page HTML to extract the
   * <meta name="anti-csrftoken-a2z"> value — necessary when the user is on a Cortex
   * route (e.g. /performance) that doesn't embed the token in the current DOM.
   */
  private async _getCSRF(): Promise<string | null> {
    // Fast path: token available in current document
    const local = getCSRFToken();
    if (local) return local;

    // Slow path: fetch fleet-management page to extract the meta tag
    log('[DVIC] CSRF not in current page — fetching from fleet-management');
    try {
      const resp = await fetch('https://logistics.amazon.de/fleet-management/', {
        credentials: 'include',
        headers: { Accept: 'text/html' },
      });
      if (!resp.ok) return null;
      const html = await resp.text();
      const m = html.match(/<meta\s+name=["']anti-csrftoken-a2z["']\s+content=["']([^"']+)["']/i);
      if (m?.[1]) { log('[DVIC] CSRF extracted from fleet-management page'); return m[1]; }
      // Broader pattern — token may also appear in inline JSON/script
      const m2 = html.match(/anti-csrftoken-a2z['":\s]+['"]([A-Za-z0-9+/=]+)['"]/);
      if (m2?.[1] && m2[1].length > 10) { log('[DVIC] CSRF extracted from fleet-management page (broad pattern)'); return m2[1]; }
    } catch (e) {
      log('[DVIC] Failed to fetch CSRF from fleet-management:', e);
    }
    return null;
  }

  private async _submitInspection(payload: InspectionPayload): Promise<unknown> {
    const csrf = await this._getCSRF();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const resp = await withRetry(async () => {
      const r = await fetch('https://logistics.amazon.de/fleet-management/api/inspections', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      return r;
    }, { retries: 3, baseMs: 500 });

    return resp.json();
  }

  /**
   * Fetches ALL active fleet vehicles from the known-good endpoint used by the
   * VSA QR feature and populates _assetIdCache for every vehicle.
   *
   * Endpoint: GET /fleet-management/api/vehicles?vehicleStatuses=ACTIVE,MAINTENANCE,PENDING
   * The response is the authoritative source for vehicleIdentifier → assetId mapping.
   * Called once during _refresh() so the cache is populated before any submit attempt.
   */
  private async _fetchVehicleAssetIds(): Promise<void> {
    const url = 'https://logistics.amazon.de/fleet-management/api/vehicles?vehicleStatuses=ACTIVE,MAINTENANCE,PENDING';
    const csrf = getCSRFToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    let json: unknown;
    try {
      const r = await fetch(url, { method: 'GET', headers, credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
      json = await r.json();
    } catch (e) {
      log('[DVIC] Vehicle asset ID pre-fetch failed (submit will attempt on-demand):', e);
      return;
    }

    // Normalise the response — the fleet vehicles API returns:
    //   { "meta": null, "data": { "vehicles": [ { "assetId": "aaid_...", "vin": "...", ... } ] } }
    // We also handle flat shapes (direct array, or direct vehicles/data array) for resilience.
    let vehicleList: unknown[] = [];
    if (Array.isArray(json)) {
      vehicleList = json;
    } else if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      // Primary: data.vehicles (confirmed API shape)
      const dataObj = obj['data'];
      if (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) {
        const nested = (dataObj as Record<string, unknown>)['vehicles'];
        if (Array.isArray(nested)) vehicleList = nested;
      }
      // Fallbacks for alternative shapes
      if (vehicleList.length === 0) {
        const candidate = obj['vehicles'] ?? obj['content'];
        if (Array.isArray(candidate)) vehicleList = candidate;
      }
      if (vehicleList.length === 0 && Array.isArray(obj['data'])) {
        vehicleList = obj['data'] as unknown[];
      }
    }

    let cached = 0;
    for (const v of vehicleList) {
      if (!v || typeof v !== 'object') continue;
      const rec = v as Record<string, unknown>;
      // The API returns assetId (confirmed by VSA QR feature and user).
      // Index by both vin and registrationNo so vehicleIdentifier (whichever form it takes) resolves.
      const assetId = String(rec['assetId'] ?? rec['vehicleAssetId'] ?? '').trim();
      if (!assetId) continue;
      const vin = String(rec['vin'] ?? '').trim();
      const plate = String(rec['registrationNo'] ?? rec['licensePlate'] ?? '').trim();
      if (vin)   { this._assetIdCache.set(vin, assetId);   cached++; }
      if (plate && plate !== vin) { this._assetIdCache.set(plate, assetId); }
    }
    log('[DVIC] Vehicle asset ID cache populated:', cached, 'entries');
  }

  /**
   * Resolves a vehicleIdentifier to its fleet vehicleAssetId (format: aaid_...).
   *
   * Primary path: cache lookup — populated during _refresh() via _fetchVehicleAssetIds().
   * Fallback: single on-demand fetch from the fleet vehicles endpoint (for edge cases
   *   where the vehicle is not yet in the pre-populated cache).
   * Error path: if assetId cannot be resolved automatically, throws a descriptive error
   *   so the caller can surface an inline message — no window.prompt is shown.
   */
  private async _resolveVehicleAssetId(vin: string): Promise<string> {
    // 1. Cache hit (populated at refresh time — the happy path)
    if (this._assetIdCache.has(vin)) return this._assetIdCache.get(vin)!;

    // 2. Fallback: re-fetch all vehicles on-demand (e.g. cache miss due to new vehicle or
    //    early submit before refresh completed).
    log('[DVIC] Asset ID cache miss for', vin, '— fetching fleet vehicle list on-demand');
    await this._fetchVehicleAssetIds();

    if (this._assetIdCache.has(vin)) return this._assetIdCache.get(vin)!;

    // 3. Not found — surface a descriptive error; never prompt the user.
    throw new Error(
      `Fahrzeug "${vin}" nicht im Fuhrpark gefunden. ` +
      `Bitte prüfen Sie, ob das Fahrzeug den Status ACTIVE, MAINTENANCE oder PENDING hat.`,
    );
  }

  private _promptReporterId(): string | null {
    const val = window.prompt(
      'Kein Reporter aus Pre-Trip DVIC gefunden.\n\nBitte geben Sie die Reporter-ID (Transporter-ID) manuell ein:',
    );
    return val ? val.trim() || null : null;
  }

  private async _submitPostTripDvic(vehicle: VehicleRecord): Promise<SubmitResult> {
    const vin = vehicle.vehicleIdentifier;
    try {
      let reporterId: string | null = vehicle.reporterIds[0] ?? null;
      if (!reporterId) {
        reporterId = this._promptReporterId();
        if (!reporterId) return { vehicleIdentifier: vin, success: false, error: 'Reporter-ID nicht angegeben' };
      }

      const serviceAreaId = this.companyConfig.getDefaultServiceAreaId();
      log('[DVIC Submit] Starte für', vin, '| Reporter:', reporterId, '| SA:', serviceAreaId);

      log('[DVIC Submit] Schritt 1: Ermittle Vehicle Asset ID…');
      const vehicleAssetId = await this._resolveVehicleAssetId(vin);
      log('[DVIC Submit] Vehicle Asset ID:', vehicleAssetId);

      log('[DVIC Submit] Schritt 2: Erstelle Dummy-PNG…');
      const file = await this._createDummyPNG();

      log('[DVIC Submit] Schritt 3: Hole Upload-Template…');
      const template = await this._getUploadTemplate();
      log('[DVIC Submit] Template erhalten, action:', template.action);

      log('[DVIC Submit] Schritt 4: Lade Datei hoch…');
      const documentId = await this._uploadDummyFile(template, file);
      log('[DVIC Submit] Document ID:', documentId);

      log('[DVIC Submit] Schritt 5: Setze Dokument-Metadaten…');
      const docInstanceId = await this._setDocumentMetadata(vehicleAssetId, documentId, template.token);
      log('[DVIC Submit] Doc Instance ID:', docInstanceId);

      log('[DVIC Submit] Schritt 6: Reiche Inspektion ein…');
      const inspectionStartTime = Date.now();
      const payload: InspectionPayload = {
        inspectionStartTime,
        inspectionType: 'POST_TRIP_DVIC',
        VIN: vin,
        defectsFound: [],
        paperInspectionDocId: docInstanceId,
        reporterId,
        serviceAreaId,
      };
      await this._submitInspection(payload);
      log('[DVIC Submit] Erfolgreich eingereicht für', vin);

      return { vehicleIdentifier: vin, success: true };
    } catch (e) {
      err('[DVIC Submit] Fehler für', vin, ':', e);
      return { vehicleIdentifier: vin, success: false, error: (e as Error).message };
    }
  }

  private async _handleSingleSubmit(vehicle: VehicleRecord, buttonEl: HTMLButtonElement): Promise<void> {
    const vin = vehicle.vehicleIdentifier;
    const reporterId = vehicle.reporterIds[0] ?? '(unbekannt)';
    const confirmed = vehicle.reporterIds.length > 0
      ? confirm(`Post-Trip DVIC für Fahrzeug ${vin} einreichen?\n\nDie Reporter-ID "${reporterId}" wird vom Pre-Trip DVIC übernommen.`)
      : confirm(`Post-Trip DVIC für Fahrzeug ${vin} einreichen?\n\nKein Reporter aus Pre-Trip DVIC gefunden. Sie werden nach der Reporter-ID gefragt.`);
    if (!confirmed) return;

    this._submitting = true;
    buttonEl.textContent = '⏳';
    buttonEl.classList.add('ct-dvic-submit-btn--loading');
    buttonEl.disabled = true;

    const result = await this._submitPostTripDvic(vehicle);

    if (result.success) {
      buttonEl.textContent = '✅';
      buttonEl.classList.remove('ct-dvic-submit-btn--loading');
      buttonEl.classList.add('ct-dvic-submit-btn--success');
      setTimeout(() => {
        this._submitting = false;
        this._refresh();
      }, 1500);
    } else {
      buttonEl.textContent = '❌';
      buttonEl.classList.remove('ct-dvic-submit-btn--loading');
      buttonEl.classList.add('ct-dvic-submit-btn--error');
      buttonEl.title = result.error ?? 'Unbekannter Fehler';
      this._submitting = false;
    }
  }

  private async _handleBulkSubmit(): Promise<void> {
    const missing = this._vehicles.filter((v) => v.status !== 'OK');
    const count = missing.length;
    if (count === 0) return;

    const confirmed = confirm(
      `Post-Trip DVIC für ${count} Fahrzeuge einreichen?\n\nFür jedes Fahrzeug wird die Reporter-ID vom jeweiligen Pre-Trip DVIC übernommen.\nFahrzeuge ohne Reporter-ID werden übersprungen.`,
    );
    if (!confirmed) return;

    this._submitting = true;
    const bulkBtn = document.getElementById('ct-dvic-bulk-submit') as HTMLButtonElement | null;
    if (bulkBtn) { bulkBtn.disabled = true; bulkBtn.textContent = '⏳ Läuft…'; }

    const results: SubmitResult[] = [];
    for (const vehicle of missing) {
      if (!vehicle.reporterIds[0]) {
        results.push({ vehicleIdentifier: vehicle.vehicleIdentifier, success: false, error: 'Kein Reporter-ID' });
        continue;
      }
      const result = await this._submitPostTripDvic(vehicle);
      results.push(result);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);
    const failLines = failed.map((r) => `• ${r.vehicleIdentifier}: ${r.error ?? 'Fehler'}`).join('\n');
    const summary = `Ergebnis: ${succeeded} erfolgreich, ${failed.length} fehlgeschlagen.`
      + (failLines ? `\n\nFehler:\n${failLines}` : '');
    alert(summary);

    this._submitting = false;
    this._refresh();
  }

  private _renderVsaTab(): void {
    const records = this._vsaInspections;
    if (records.length === 0) {
      this._setBody('<div class="ct-dvic-empty">Keine VSA-Inspektionen für dieses Datum gefunden.</div>');
      return;
    }
    const page = this._pageVsa;
    const totalPages = Math.ceil(records.length / this._pageSize);
    const start = (page - 1) * this._pageSize;
    const slice = records.slice(start, start + this._pageSize);

    const rows = slice.map((r) => {
      const name = this._nameCache.get(r.reporterId) || r.reporterId;
      const ts = r.inspectedAt
        ? new Date(r.inspectedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
      return `<tr role="row">
        <td>${esc(r.vehicleIdentifier)}</td>
        <td>${esc(r.inspectionType)}</td>
        <td>${esc(ts)}</td>
        <td>${esc(name)}</td>
      </tr>`;
    }).join('');

    this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-vsa">
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Inspektionstyp</th>
            <th scope="col">Zeitstempel</th>
            <th scope="col">Reporter</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${this._renderPagination(records.length, page, totalPages, 'vsa')}
      </div>`);
    this._attachPaginationHandlers('vsa');
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
      else if (tabKey === 'missing') { if (this._pageMissing > 1) { this._pageMissing--; this._renderMissingTab(); } }
      else if (tabKey === 'vsa') { if (this._pageVsa > 1) { this._pageVsa--; this._renderVsaTab(); } }
    });
    body.querySelector(`.ct-dvic-next-page[data-tab="${tabKey}"]`)?.addEventListener('click', () => {
      if (tabKey === 'all') {
        const tp = Math.ceil(this._vehicles.length / this._pageSize);
        if (this._pageCurrent < tp) { this._pageCurrent++; this._renderAllTab(); }
      } else if (tabKey === 'missing') {
        const t = this._vehicles.filter((v) => v.status !== 'OK').length;
        const tp = Math.ceil(t / this._pageSize);
        if (this._pageMissing < tp) { this._pageMissing++; this._renderMissingTab(); }
      } else if (tabKey === 'vsa') {
        const tp = Math.ceil(this._vsaInspections.length / this._pageSize);
        if (this._pageVsa < tp) { this._pageVsa++; this._renderVsaTab(); }
      }
    });
  }
}
