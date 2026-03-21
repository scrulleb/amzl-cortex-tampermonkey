// features/returns-dashboard.ts – Returns Dashboard

import { log, err, esc, todayStr, withRetry, getCSRFToken } from '../core/utils';
import { onDispose } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';

// ── Pure helpers ───────────────────────────────────────────────────────────────

function retFormatTimestamp(epochMs: unknown): string {
  if (!epochMs) return '—';
  try {
    return new Date(Number(epochMs)).toLocaleString('de-DE', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

function retGetCoords(pkg: Record<string, unknown>): { lat: number; lon: number } | null {
  const addr = (pkg['address'] as Record<string, unknown>) || {};
  const lat = addr['geocodeLatitude'] ?? (addr['geocode'] as Record<string, unknown>)?.['latitude'];
  const lon = addr['geocodeLongitude'] ?? (addr['geocode'] as Record<string, unknown>)?.['longitude'];
  if (lat != null && lon != null) return { lat: Number(lat), lon: Number(lon) };
  return null;
}

function retReasonClass(code: unknown): string {
  if (!code) return 'ct-ret-card-reason--ok';
  const c = String(code).toUpperCase();
  if (c.includes('DAMAGE') || c.includes('DEFECT')) return 'ct-ret-card-reason--error';
  if (c.includes('CUSTOMER') || c.includes('REFUSAL')) return 'ct-ret-card-reason--warn';
  return 'ct-ret-card-reason--ok';
}

// ── Dashboard class ────────────────────────────────────────────────────────────

export class ReturnsDashboard {
  private _overlayEl: HTMLElement | null = null;
  private _active = false;
  private _allPackages: Record<string, unknown>[] = [];
  private _filteredPackages: Record<string, unknown>[] = [];
  private _page = 1;
  private _pageSize = 50;
  private _sort: { field: string; direction: string } = { field: 'lastUpdatedTime', direction: 'desc' };
  private _filters = { search: '', city: '', postalCode: '', routeCode: '', reasonCode: '' };
  private _viewMode: 'table' | 'cards' = 'table';
  private _cache = new Map<string, { data: Record<string, unknown>[]; timestamp: number }>();
  private _cacheExpiry = 5 * 60 * 1000;
  private _transporterCache = new Map<string, string>();

  constructor(
    private readonly config: AppConfig,
    private readonly companyConfig: CompanyConfig,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(): void {
    if (this._overlayEl) return;

    const today = todayStr();
    const overlay = document.createElement('div');
    overlay.id = 'ct-ret-overlay';
    overlay.className = 'ct-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Returns Dashboard');
    overlay.innerHTML = `
      <div class="ct-ret-panel">
        <h2>📦 Returns Dashboard</h2>
        <div class="ct-ret-controls">
          <label for="ct-ret-date">Datum:</label>
          <input type="date" id="ct-ret-date" class="ct-input" value="${today}">
          <label for="ct-ret-sa">Service Area:</label>
          <select id="ct-ret-sa" class="ct-select"></select>
          <label style="display:flex;align-items:center;gap:4px;margin-left:8px;">
            <input type="checkbox" id="ct-ret-routeview" checked> RouteView
          </label>
          <button class="ct-btn ct-btn--accent" id="ct-ret-go">🔍 Laden</button>
          <button class="ct-btn ct-btn--primary" id="ct-ret-export">📋 Export</button>
          <button class="ct-btn ct-btn--close" id="ct-ret-close">✕ Schließen</button>
        </div>
        <div id="ct-ret-filters" class="ct-ret-filters">
          <input type="text" class="ct-input ct-ret-search" id="ct-ret-search" placeholder="ScannableId suchen..." aria-label="Suche">
          <div class="ct-ret-filter-group"><label>Stadt:</label><input type="text" class="ct-input" id="ct-ret-city" placeholder="Filter Stadt" style="width:100px"></div>
          <div class="ct-ret-filter-group"><label>PLZ:</label><input type="text" class="ct-input" id="ct-ret-postal" placeholder="PLZ" style="width:80px"></div>
          <div class="ct-ret-filter-group"><label>Route:</label><input type="text" class="ct-input" id="ct-ret-route" placeholder="Route" style="width:80px"></div>
          <div class="ct-ret-filter-group"><label>Reason:</label><input type="text" class="ct-input" id="ct-ret-reason" placeholder="Reason Code" style="width:80px"></div>
          <button class="ct-btn ct-btn--secondary" id="ct-ret-clear-filters">✕ Filter</button>
        </div>
        <div id="ct-ret-sort-bar" class="ct-ret-sort-bar">
          <label>Sortieren:</label>
          <select id="ct-ret-sort-field" class="ct-select">
            <option value="lastUpdatedTime">Zeit (neueste)</option>
            <option value="scannableId">ScannableId</option>
            <option value="city">Stadt</option>
            <option value="routeCode">Route</option>
          </select>
          <select id="ct-ret-sort-dir" class="ct-select">
            <option value="desc">Absteigend</option>
            <option value="asc">Aufsteigend</option>
          </select>
          <div class="ct-ret-view-toggle">
            <button id="ct-ret-view-table" class="active">📋 Tabelle</button>
            <button id="ct-ret-view-cards">▦ Karten</button>
          </div>
          <span id="ct-ret-count" style="margin-left:auto;color:var(--ct-muted);"></span>
        </div>
        <div id="ct-ret-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-ret-stats"></div>
        <div id="ct-ret-body"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._overlayEl = overlay;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hide(); });
    document.getElementById('ct-ret-close')!.addEventListener('click', () => this.hide());
    document.getElementById('ct-ret-go')!.addEventListener('click', () => this._loadData());
    document.getElementById('ct-ret-export')!.addEventListener('click', () => this._exportCSV());
    document.getElementById('ct-ret-clear-filters')!.addEventListener('click', () => this._clearFilters());

    ['ct-ret-search', 'ct-ret-city', 'ct-ret-postal', 'ct-ret-route', 'ct-ret-reason'].forEach((id) => {
      document.getElementById(id)!.addEventListener('input', () => this._applyFilters());
    });
    ['ct-ret-sort-field', 'ct-ret-sort-dir'].forEach((id) => {
      document.getElementById(id)!.addEventListener('change', () => this._applyFilters());
    });

    document.getElementById('ct-ret-view-table')!.addEventListener('click', () => {
      this._viewMode = 'table'; this._updateViewToggle(); this._renderCards();
    });
    document.getElementById('ct-ret-view-cards')!.addEventListener('click', () => {
      this._viewMode = 'cards'; this._updateViewToggle(); this._renderCards();
    });

    this._initSaDropdown();
    onDispose(() => this.dispose());
    log('Returns Dashboard initialized');
  }

  dispose(): void {
    this._overlayEl?.remove(); this._overlayEl = null;
    this._allPackages = []; this._filteredPackages = [];
    this._active = false;
  }

  toggle(): void {
    if (!this.config.features.returnsDashboard) {
      alert('Returns Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.');
      return;
    }
    this.init();
    if (this._active) this.hide(); else this.show();
  }

  show(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
    (document.getElementById('ct-ret-date') as HTMLInputElement).focus();
  }

  hide(): void {
    this._overlayEl?.classList.remove('visible');
    this._active = false;
  }

  // ── SA dropdown ────────────────────────────────────────────────────────────

  private async _initSaDropdown(): Promise<void> {
    const select = document.getElementById('ct-ret-sa') as HTMLSelectElement;
    select.innerHTML = '';
    await this.companyConfig.load();
    const areas = this.companyConfig.getServiceAreas();
    const list = areas.length > 0 ? areas : [];
    const defaultId = this.companyConfig.getDefaultServiceAreaId();
    list.forEach((sa) => {
      const opt = document.createElement('option');
      opt.value = sa.serviceAreaId;
      opt.textContent = sa.stationCode;
      if (sa.serviceAreaId === defaultId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // ── Driver name resolution ─────────────────────────────────────────────────

  private async _resolveTransporterNames(packages: Record<string, unknown>[], date: string, serviceAreaId: string): Promise<void> {
    const ids = [...new Set(packages.map((p) => p['transporterId'] as string | null).filter((id): id is string => id != null))];
    if (ids.length === 0) return;

    const uncached = ids.filter((id) => !this._transporterCache.has(id));
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
                this._transporterCache.set(String(entry['driverPersonId']), entry['driverName'] as string);
              }
            }
          };
          if (Array.isArray(roster)) processEntries(roster);
          else if (typeof roster === 'object') {
            for (const val of Object.values(roster as Record<string, unknown>)) {
              if (Array.isArray(val)) processEntries(val as Array<Record<string, unknown>>);
            }
          }
          log(`[Returns] Roster loaded: ${this._transporterCache.size} driver names cached`);
        }
      } catch (e) { log('[Returns] Roster lookup failed:', e); }
    }
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  private async _loadData(): Promise<void> {
    const date = (document.getElementById('ct-ret-date') as HTMLInputElement).value;
    const serviceAreaId = (document.getElementById('ct-ret-sa') as HTMLSelectElement).value;
    const routeView = (document.getElementById('ct-ret-routeview') as HTMLInputElement).checked;

    if (!date) { this._setStatus('⚠️ Bitte Datum auswählen.'); return; }
    if (!serviceAreaId) { this._setStatus('⚠️ Bitte Service Area auswählen.'); return; }

    const cacheKey = `${date}|${serviceAreaId}`;
    const cached = this._cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < this._cacheExpiry)) {
      log('Returns: using cached data');
      this._allPackages = cached.data;
      this._applyFilters();
      this._setStatus(`✅ ${this._allPackages.length} Pakete aus Cache geladen`);
      return;
    }

    this._setStatus('⏳ Lade Returns-Daten…');
    this._setBody('<div class="ct-ret-loading">Daten werden geladen…</div>');

    const params = new URLSearchParams({
      historicalDay: 'false', localDate: date, packageStatus: 'RETURNED',
      routeView: String(routeView), serviceAreaId, statsFromSummaries: 'true',
    });

    try {
      const resp = await withRetry(async () => {
        const r = await fetch(`https://logistics.amazon.de/operations/execution/api/packages/packagesByStatus?${params}`, {
          method: 'GET', credentials: 'same-origin',
          headers: { Accept: 'application/json, text/plain, */*', 'Accept-Language': 'de,en-US;q=0.7,en;q=0.3', Referer: location.href },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r;
      }, { retries: 3, baseMs: 500 });

      const json = await resp.json();
      const packages = Array.isArray(json?.packages) ? json.packages : [];
      this._cache.set(cacheKey, { data: packages, timestamp: Date.now() });
      this._allPackages = packages;

      this._setStatus(`⏳ ${packages.length} Pakete geladen, lade Fahrernamen…`);
      await this._resolveTransporterNames(packages, date, serviceAreaId);

      this._page = 1;
      this._applyFilters();
      this._setStatus(`✅ ${packages.length} Pakete geladen für ${date}`);
    } catch (e) {
      err('Returns fetch failed:', e);
      this._setBody(`<div class="ct-ret-error" role="alert">❌ Daten konnten nicht geladen werden.<br><small>${esc((e as Error).message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-ret-retry">🔄 Erneut versuchen</button></div>`);
      this._setStatus('❌ Fehler beim Laden.');
      document.getElementById('ct-ret-retry')?.addEventListener('click', () => this._loadData());
    }
  }

  // ── Filters ────────────────────────────────────────────────────────────────

  private _clearFilters(): void {
    ['ct-ret-search', 'ct-ret-city', 'ct-ret-postal', 'ct-ret-route', 'ct-ret-reason'].forEach((id) => {
      (document.getElementById(id) as HTMLInputElement).value = '';
    });
    this._filters = { search: '', city: '', postalCode: '', routeCode: '', reasonCode: '' };
    this._applyFilters();
  }

  private _applyFilters(): void {
    this._filters = {
      search:     ((document.getElementById('ct-ret-search') as HTMLInputElement).value || '').toLowerCase().trim(),
      city:       ((document.getElementById('ct-ret-city') as HTMLInputElement).value || '').toLowerCase().trim(),
      postalCode: ((document.getElementById('ct-ret-postal') as HTMLInputElement).value || '').toLowerCase().trim(),
      routeCode:  ((document.getElementById('ct-ret-route') as HTMLInputElement).value || '').toLowerCase().trim(),
      reasonCode: ((document.getElementById('ct-ret-reason') as HTMLInputElement).value || '').toLowerCase().trim(),
    };

    const sortField = (document.getElementById('ct-ret-sort-field') as HTMLSelectElement).value;
    const sortDir   = (document.getElementById('ct-ret-sort-dir') as HTMLSelectElement).value;

    this._filteredPackages = this._allPackages.filter((pkg) => {
      const addr = (pkg['address'] as Record<string, unknown>) || {};
      if (this._filters.search && !(String(pkg['scannableId'] || '')).toLowerCase().includes(this._filters.search)) return false;
      if (this._filters.city && !(String(addr['city'] || '')).toLowerCase().includes(this._filters.city)) return false;
      if (this._filters.postalCode && !(String(addr['postalCode'] || '')).toLowerCase().includes(this._filters.postalCode)) return false;
      if (this._filters.routeCode && !(String(pkg['routeCode'] || '')).toLowerCase().includes(this._filters.routeCode)) return false;
      if (this._filters.reasonCode && !(String(pkg['reasonCode'] || '')).toLowerCase().includes(this._filters.reasonCode)) return false;
      return true;
    });

    this._filteredPackages.sort((a, b) => {
      let va: unknown = a[sortField], vb: unknown = b[sortField];
      let va2: string | number, vb2: string | number;
      if (sortField === 'lastUpdatedTime') { va2 = Number(va) || 0; vb2 = Number(vb) || 0; }
      else if (sortField === 'city') { va2 = ((a['address'] as Record<string, unknown>)?.['city'] || '').toString().toLowerCase(); vb2 = ((b['address'] as Record<string, unknown>)?.['city'] || '').toString().toLowerCase(); }
      else if (sortField === 'routeCode') { va2 = (a['routeCode'] || '').toString().toLowerCase(); vb2 = (b['routeCode'] || '').toString().toLowerCase(); }
      else { va2 = (va || '').toString().toLowerCase(); vb2 = (vb || '').toString().toLowerCase(); }
      if (va2 < vb2) return sortDir === 'asc' ? -1 : 1;
      if (va2 > vb2) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    this._renderStats();
    this._renderCards();
  }

  private _renderStats(): void {
    const total = this._allPackages.length;
    const filtered = this._filteredPackages.length;
    const el = document.getElementById('ct-ret-count');
    if (el) el.textContent = filtered === total ? `${total} Pakete` : `${filtered} von ${total} Paketen`;
  }

  private _updateViewToggle(): void {
    document.getElementById('ct-ret-view-table')!.classList.toggle('active', this._viewMode === 'table');
    document.getElementById('ct-ret-view-cards')!.classList.toggle('active', this._viewMode === 'cards');
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _renderCards(): void {
    const totalPages = Math.ceil(this._filteredPackages.length / this._pageSize);
    if (this._page > totalPages) this._page = Math.max(1, totalPages);
    const start = (this._page - 1) * this._pageSize;
    const slice = this._filteredPackages.slice(start, start + this._pageSize);

    if (slice.length === 0) {
      this._setBody('<div class="ct-ret-empty">Keine Returns für die gewählten Filter gefunden.</div>');
      this._renderPagination(0, 1, 1);
      return;
    }

    if (this._viewMode === 'table') {
      this._renderTable(slice);
    } else {
      const cardsHtml = slice.map((pkg) => this._renderCard(pkg)).join('');
      this._setBody(`<div class="ct-ret-cards">${cardsHtml}</div>`);
    }
    this._renderPagination(this._filteredPackages.length, this._page, totalPages);
  }

  private _renderTable(slice: Record<string, unknown>[]): void {
    const rows = slice.map((pkg) => {
      const addr = (pkg['address'] as Record<string, unknown>) || {};
      const coords = retGetCoords(pkg);
      const transporterName = pkg['transporterId'] ? (this._transporterCache.get(String(pkg['transporterId'])) || '—') : '—';
      return `<tr>
        <td title="${esc(pkg['scannableId'] || '')}">${esc(String(pkg['scannableId'] || '—'))}</td>
        <td>${esc(transporterName)}</td>
        <td>${retFormatTimestamp(pkg['lastUpdatedTime'])}</td>
        <td>${esc(String(pkg['reasonCode'] || '—'))}</td>
        <td>${esc(String(pkg['routeCode'] || '—'))}</td>
        <td>${esc(String(addr['address1'] || ''))}</td>
        <td>${esc(String(addr['postalCode'] || ''))}</td>
        <td>${esc(String(addr['city'] || '—'))}</td>
        <td>${coords ? `<a href="https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}" target="_blank" rel="noopener">📍</a>` : '—'}</td>
      </tr>`;
    }).join('');

    this._setBody(`
      <div class="ct-ret-table-wrap">
        <table class="ct-table ct-ret-table">
          <thead><tr>
            <th>ScannableId</th><th>Transporter</th><th>Zeit</th><th>Reason</th>
            <th>Route</th><th>Adresse</th><th>PLZ</th><th>Stadt</th><th>Map</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`);
  }

  private _renderCard(pkg: Record<string, unknown>): string {
    const addr = (pkg['address'] as Record<string, unknown>) || {};
    const coords = retGetCoords(pkg);
    const mapLink = coords ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}` : null;
    const reason = String(pkg['reasonCode'] || 'Unbekannt');
    const transporterName = pkg['transporterId'] ? (this._transporterCache.get(String(pkg['transporterId'])) || '—') : '—';

    return `<div class="ct-ret-card">
      <div class="ct-ret-card-header">
        <span class="ct-ret-card-id">${esc(String(pkg['scannableId'] || '—'))}</span>
        <span class="ct-ret-card-reason ${retReasonClass(pkg['reasonCode'])}">${esc(reason)}</span>
      </div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Transporter:</span><span class="ct-ret-card-value">${esc(transporterName)}</span></div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Aktualisiert:</span><span class="ct-ret-card-value">${retFormatTimestamp(pkg['lastUpdatedTime'])}</span></div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Route:</span><span class="ct-ret-card-value">${esc(String(pkg['routeCode'] || '—'))}</span></div>
      <div class="ct-ret-card-address">
        ${esc(String(addr['address1'] || ''))}${addr['address2'] ? ', ' + esc(String(addr['address2'])) : ''}<br>
        ${esc(String(addr['postalCode'] || ''))} ${esc(String(addr['city'] || ''))}
        ${coords ? `<br><small>📍 ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}</small>` : ''}
        ${mapLink ? `<a href="${mapLink}" class="ct-ret-card-map" target="_blank" rel="noopener">📍 In Karte öffnen</a>` : ''}
      </div>
    </div>`;
  }

  private _renderPagination(total: number, current: number, totalPages: number): void {
    const el = document.getElementById('ct-ret-body');
    if (!el) return;
    const existing = el.parentNode?.querySelector('.ct-ret-pagination');
    if (existing) existing.remove();
    if (totalPages <= 1) return;

    el.insertAdjacentHTML('afterend', `
      <div class="ct-ret-pagination">
        <button class="ct-btn ct-btn--secondary ct-ret-prev" ${current <= 1 ? 'disabled' : ''}>‹ Zurück</button>
        <span class="ct-ret-page-info">Seite ${current} / ${totalPages} (${total} Einträge)</span>
        <button class="ct-btn ct-btn--secondary ct-ret-next" ${current >= totalPages ? 'disabled' : ''}>Weiter ›</button>
      </div>`);

    el.parentNode?.querySelector('.ct-ret-prev')?.addEventListener('click', () => {
      if (this._page > 1) { this._page--; this._renderCards(); }
    });
    el.parentNode?.querySelector('.ct-ret-next')?.addEventListener('click', () => {
      if (this._page < totalPages) { this._page++; this._renderCards(); }
    });
  }

  private _exportCSV(): void {
    if (this._filteredPackages.length === 0) { alert('Keine Daten zum Exportieren.'); return; }
    const headers = ['scannableId', 'transporter', 'lastUpdatedTime', 'reasonCode', 'routeCode', 'address1', 'address2', 'city', 'postalCode', 'latitude', 'longitude'];
    let csv = headers.join(';') + '\n';

    for (const pkg of this._filteredPackages) {
      const addr = (pkg['address'] as Record<string, unknown>) || {};
      const coords = retGetCoords(pkg);
      const transporterName = pkg['transporterId'] ? (this._transporterCache.get(String(pkg['transporterId'])) || '') : '';
      const row = [
        pkg['scannableId'] || '',
        transporterName,
        retFormatTimestamp(pkg['lastUpdatedTime']),
        pkg['reasonCode'] || '', pkg['routeCode'] || '',
        addr['address1'] || '', addr['address2'] || '',
        addr['city'] || '', addr['postalCode'] || '',
        coords?.lat ?? '', coords?.lon ?? '',
      ];
      csv += row.map((v) => String(v).replace(/;/g, ',')).join(';') + '\n';
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `returns_${todayStr()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  private _setStatus(msg: string): void { const el = document.getElementById('ct-ret-status'); if (el) el.textContent = msg; }
  private _setBody(html: string): void { const el = document.getElementById('ct-ret-body'); if (el) el.innerHTML = html; }
}
