// features/vsa-qr.ts – VSA QR Code Generator

import { log, err, esc, withRetry, getCSRFToken } from '../core/utils';
import { onDispose } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';
import qrcode from 'qrcode-generator';

interface VehicleData {
  vin: string;
  registrationNo: string;
  stationCode: string;
  status: string;
}

export class VsaQrGenerator {
  private _overlayEl: HTMLElement | null = null;
  private _active = false;
  private _vehicles: VehicleData[] = [];
  private _selectedVins = new Set<string>();
  private _loading = false;
  private _pageSize = 25;
  private _currentPage = 1;
  private _searchTerm = '';
  private _searchTimer: ReturnType<typeof setTimeout> | null = null;
  private _sortColumn: 'registrationNo' | 'vin' | null = null;
  private _sortAsc = true;

  constructor(
    private readonly config: AppConfig,
    private readonly companyConfig: CompanyConfig,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(): void {
    if (this._overlayEl) return;

    const overlay = document.createElement('div');
    overlay.id = 'ct-vsa-overlay';
    overlay.className = 'ct-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'VSA QR Code Generator');
    overlay.innerHTML = `
      <div class="ct-vsa-panel">
        <div class="ct-vsa-header">
          <div>
            <h2>📱 VSA QR Code Generator</h2>
            <div id="ct-vsa-asof" style="font-size:11px;color:var(--ct-muted);margin-top:2px;"></div>
          </div>
          <button class="ct-btn ct-btn--close" id="ct-vsa-close" aria-label="Schließen">✕ Schließen</button>
        </div>
        <div id="ct-vsa-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-vsa-tiles"></div>
        <div class="ct-vsa-toolbar">
          <input type="text" class="ct-input ct-vsa-search" id="ct-vsa-search"
                 placeholder="Suche nach Kennzeichen, VIN oder Station…" aria-label="Fahrzeuge filtern">
          <div class="ct-vsa-selection-info" id="ct-vsa-selection-info"></div>
        </div>
        <div id="ct-vsa-body"></div>
        <div class="ct-vsa-footer" id="ct-vsa-footer">
          <button class="ct-btn ct-btn--accent" id="ct-vsa-print" disabled>🖨 Ausgewählte drucken</button>
          <span class="ct-vsa-selection-badge" id="ct-vsa-badge">0 ausgewählt</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._overlayEl = overlay;

    // Event bindings
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hide(); });
    document.getElementById('ct-vsa-close')!.addEventListener('click', () => this.hide());
    document.getElementById('ct-vsa-print')!.addEventListener('click', () => this._printSelected());

    const searchInput = document.getElementById('ct-vsa-search') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      if (this._searchTimer) clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => {
        this._searchTerm = searchInput.value.trim().toLowerCase();
        this._currentPage = 1;
        this._renderBody();
      }, 300);
    });

    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });

    onDispose(() => this.dispose());
    log('VSA QR Generator initialized');
  }

  dispose(): void {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._overlayEl?.remove();
    this._overlayEl = null;
    this._vehicles = [];
    this._selectedVins.clear();
    this._active = false;
    this._loading = false;
  }

  toggle(): void {
    if (!this.config.features.vsaQr) {
      alert('VSA QR Code Generator ist deaktiviert. Bitte in den Einstellungen aktivieren.');
      return;
    }
    this.init();
    if (this._active) this.hide(); else this.show();
  }

  show(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
    this._currentPage = 1;
    this._searchTerm = '';
    this._sortColumn = null;
    this._sortAsc = true;
    const searchInput = document.getElementById('ct-vsa-search') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    this._refresh();
  }

  hide(): void {
    this._overlayEl?.classList.remove('visible');
    this._active = false;
  }

  // ── API ────────────────────────────────────────────────────────────────────

  private async _fetchVehicles(): Promise<unknown> {
    const url = 'https://logistics.amazon.de/fleet-management/api/vehicles?vehicleStatuses=ACTIVE,MAINTENANCE,PENDING';
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

  // ── Data processing ────────────────────────────────────────────────────────

  private _processResponse(json: unknown): VehicleData[] {
    if (!json || typeof json !== 'object') return [];

    let vehicleList: unknown[];
    if (Array.isArray(json)) {
      vehicleList = json;
    } else {
      const obj = json as Record<string, unknown>;

      // Try direct array keys first
      const directArray = obj['vehicles'] ?? obj['content'];
      if (Array.isArray(directArray) && directArray.length > 0) {
        vehicleList = directArray;
      } else {
        // 'data' may be an array OR a nested object containing the vehicle list
        const dataVal = obj['data'];
        if (Array.isArray(dataVal) && dataVal.length > 0) {
          vehicleList = dataVal;
        } else if (dataVal && typeof dataVal === 'object' && !Array.isArray(dataVal)) {
          // data is an object — look for vehicle arrays inside it
          const dataObj = dataVal as Record<string, unknown>;
          const nested = dataObj['vehicles'] ?? dataObj['content'] ?? dataObj['items'] ?? dataObj['results'];
          if (Array.isArray(nested) && nested.length > 0) {
            vehicleList = nested;
          } else {
            // Scan all values of data for the first non-empty array
            vehicleList = [];
            for (const val of Object.values(dataObj)) {
              if (Array.isArray(val) && val.length > 0) {
                vehicleList = val;
                break;
              }
            }
          }
        } else {
          // Last resort: scan all top-level values for the first non-empty array
          vehicleList = [];
          for (const val of Object.values(obj)) {
            if (Array.isArray(val) && val.length > 0) {
              vehicleList = val;
              break;
            }
          }
        }
      }
    }

    if (!Array.isArray(vehicleList)) return [];

    return vehicleList
      .map((v: unknown) => {
        if (!v || typeof v !== 'object') return null;
        const rec = v as Record<string, unknown>;
        const vin = String(rec['vin'] ?? '').trim();
        const registrationNo = String(rec['registrationNo'] ?? rec['licensePlate'] ?? rec['registration_no'] ?? '').trim();
        const svcStation = rec['serviceStation'] as Record<string, unknown> | null | undefined;
        const stationCode = String(
          rec['stationCode'] ?? svcStation?.['stationCode'] ?? rec['station_code'] ?? rec['station'] ?? '',
        ).trim();
        const status = String(rec['vehicleStatus'] ?? rec['status'] ?? 'ACTIVE').trim();
        if (!vin) return null;
        return { vin, registrationNo, stationCode, status } as VehicleData;
      })
      .filter((v): v is VehicleData => v !== null);
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  private async _refresh(): Promise<void> {
    if (this._loading) return;
    this._loading = true;
    this._vehicles = [];
    this._selectedVins.clear();

    this._setStatus('⏳ Lade Fahrzeugdaten…');
    this._setTiles('');
    this._setBody('<div class="ct-vsa-loading" role="status">Fahrzeugdaten werden geladen…</div>');
    this._updateFooter();

    try {
      const json = await this._fetchVehicles();
      const vehicles = this._processResponse(json);

      if (vehicles.length === 0) {
        this._setBody('<div class="ct-vsa-empty">Keine Fahrzeuge gefunden.</div>');
        this._setStatus('⚠️ Keine Fahrzeuge verfügbar.');
        this._loading = false;
        return;
      }

      this._vehicles = vehicles;

      // Auto-select all vehicles
      for (const v of vehicles) {
        this._selectedVins.add(v.vin);
      }

      this._setStatus(`✅ ${vehicles.length} Fahrzeuge geladen`);

      const asOfEl = document.getElementById('ct-vsa-asof');
      if (asOfEl) {
        const fetchedAt = new Date().toLocaleString('de-DE', {
          timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        asOfEl.textContent = `Stand: ${fetchedAt}`;
      }

      this._renderTiles();
      this._renderBody();
      this._updateFooter();
    } catch (e) {
      err('VSA QR vehicle fetch failed:', e);
      this._setBody(`<div class="ct-vsa-error" role="alert">
        ❌ Fahrzeugdaten konnten nicht geladen werden.<br>
        <small>${esc((e as Error).message)}</small><br><br>
        <button class="ct-btn ct-btn--accent" id="ct-vsa-retry">🔄 Erneut versuchen</button>
      </div>`);
      this._setStatus('❌ Fehler beim Laden.');
      document.getElementById('ct-vsa-retry')?.addEventListener('click', () => this._refresh());
    } finally {
      this._loading = false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _setStatus(msg: string): void {
    const el = document.getElementById('ct-vsa-status');
    if (el) el.textContent = msg;
  }

  private _setBody(html: string): void {
    const el = document.getElementById('ct-vsa-body');
    if (el) el.innerHTML = html;
  }

  private _setTiles(html: string): void {
    const el = document.getElementById('ct-vsa-tiles');
    if (el) el.innerHTML = html;
  }

  private _getFilteredVehicles(): VehicleData[] {
    let list = this._vehicles;

    if (this._searchTerm) {
      const term = this._searchTerm;
      list = list.filter((v) =>
        v.registrationNo.toLowerCase().includes(term) ||
        v.vin.toLowerCase().includes(term) ||
        v.stationCode.toLowerCase().includes(term) ||
        v.status.toLowerCase().includes(term),
      );
    }

    if (this._sortColumn) {
      const col = this._sortColumn;
      const dir = this._sortAsc ? 1 : -1;
      list = [...list].sort((a, b) => a[col].localeCompare(b[col]) * dir);
    }

    return list;
  }

  // ── Tiles ──────────────────────────────────────────────────────────────────

  private _renderTiles(): void {
    const total = this._vehicles.length;
    const selected = this._selectedVins.size;
    const stations = new Set(this._vehicles.map((v) => v.stationCode)).size;
    this._setTiles(`
      <div class="ct-vsa-tiles">
        <div class="ct-vsa-tile">
          <div class="ct-vsa-tile-val">${total}</div>
          <div class="ct-vsa-tile-lbl">Fahrzeuge gesamt</div>
        </div>
        <div class="ct-vsa-tile ct-vsa-tile--accent">
          <div class="ct-vsa-tile-val">${selected}</div>
          <div class="ct-vsa-tile-lbl">Ausgewählt</div>
        </div>
        <div class="ct-vsa-tile">
          <div class="ct-vsa-tile-val">${stations}</div>
          <div class="ct-vsa-tile-lbl">Stationen</div>
        </div>
        <div class="ct-vsa-tile">
          <div class="ct-vsa-tile-val">${esc(this.companyConfig.getDspCode())}</div>
          <div class="ct-vsa-tile-lbl">DSP Shortcode</div>
        </div>
      </div>
    `);
  }

  // ── Table Rendering ────────────────────────────────────────────────────────

  private _renderBody(): void {
    if (!this._overlayEl) return;
    if (this._vehicles.length === 0) {
      this._setBody('<div class="ct-vsa-empty">Keine Fahrzeuge verfügbar.</div>');
      return;
    }

    const filtered = this._getFilteredVehicles();
    const total = filtered.length;
    const totalPages = Math.ceil(total / this._pageSize);

    if (this._currentPage > totalPages) this._currentPage = totalPages || 1;

    const start = (this._currentPage - 1) * this._pageSize;
    const slice = filtered.slice(start, start + this._pageSize);

    const allVisibleSelected = slice.length > 0 && slice.every((v) => this._selectedVins.has(v.vin));

    const sortIcon = (col: 'registrationNo' | 'vin'): string => {
      if (this._sortColumn !== col) return ' ↕';
      return this._sortAsc ? ' ↑' : ' ↓';
    };

    const rows = slice.map((v, i) => {
      const isSelected = this._selectedVins.has(v.vin);
      const rowNum = start + i + 1;
      const statusCls = v.status === 'ACTIVE' ? 'ct-vsa-status--active' :
                         v.status === 'MAINTENANCE' ? 'ct-vsa-status--maintenance' :
                         'ct-vsa-status--pending';
      return `<tr class="${isSelected ? 'ct-vsa-row--selected' : ''}" role="row">
        <td class="ct-vsa-td-check">
          <input type="checkbox" class="ct-vsa-check" data-vin="${esc(v.vin)}"
                 ${isSelected ? 'checked' : ''} aria-label="Fahrzeug ${esc(v.registrationNo)} auswählen">
        </td>
        <td>${rowNum}</td>
        <td>${esc(v.stationCode)}</td>
        <td><strong>${esc(v.registrationNo)}</strong></td>
        <td class="ct-vsa-td-vin">${esc(v.vin)}</td>
        <td><span class="${statusCls}">${esc(v.status)}</span></td>
      </tr>`;
    }).join('');

    this._setBody(`
      <div class="ct-vsa-table-wrap">
        <table class="ct-table ct-vsa-table" role="grid">
          <thead><tr>
            <th scope="col" class="ct-vsa-th-check">
              <input type="checkbox" id="ct-vsa-select-all" ${allVisibleSelected ? 'checked' : ''}
                     aria-label="Alle sichtbaren Fahrzeuge auswählen">
            </th>
            <th scope="col">#</th>
            <th scope="col">Station</th>
            <th scope="col" class="ct-vsa-th-sortable" data-sort="registrationNo">Kennzeichen${sortIcon('registrationNo')}</th>
            <th scope="col" class="ct-vsa-th-sortable" data-sort="vin">VIN${sortIcon('vin')}</th>
            <th scope="col">Status</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="ct-vsa-empty">Keine Treffer für den Suchbegriff.</td></tr>'}</tbody>
        </table>
      </div>
      ${this._renderPagination(total, this._currentPage, totalPages)}
    `);

    // Event: select all checkbox
    document.getElementById('ct-vsa-select-all')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      const visibleVins = slice.map((v) => v.vin);
      for (const vin of visibleVins) {
        if (checked) this._selectedVins.add(vin);
        else this._selectedVins.delete(vin);
      }
      this._renderTiles();
      this._renderBody();
      this._updateFooter();
    });

    // Event: individual checkboxes
    this._overlayEl.querySelectorAll('.ct-vsa-check').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const vin = input.dataset['vin']!;
        if (input.checked) this._selectedVins.add(vin);
        else this._selectedVins.delete(vin);
        this._renderTiles();
        this._updateFooter();

        // Update "select all" checkbox state
        const selectAll = document.getElementById('ct-vsa-select-all') as HTMLInputElement | null;
        if (selectAll) {
          selectAll.checked = slice.every((v) => this._selectedVins.has(v.vin));
        }
      });
    });

    // Event: sortable column headers
    this._overlayEl.querySelectorAll('.ct-vsa-th-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const col = (th as HTMLElement).dataset['sort'] as 'registrationNo' | 'vin';
        if (this._sortColumn === col) {
          this._sortAsc = !this._sortAsc;
        } else {
          this._sortColumn = col;
          this._sortAsc = true;
        }
        this._currentPage = 1;
        this._renderBody();
      });
    });

    this._attachPaginationHandlers();
  }

  private _renderPagination(total: number, current: number, totalPages: number): string {
    if (totalPages <= 1) return '';
    return `
      <div class="ct-vsa-pagination">
        <button class="ct-btn ct-btn--secondary" id="ct-vsa-prev" ${current <= 1 ? 'disabled' : ''}>‹ Zurück</button>
        <span class="ct-vsa-page-info">Seite ${current} / ${totalPages} (${total} Fahrzeuge)</span>
        <button class="ct-btn ct-btn--secondary" id="ct-vsa-next" ${current >= totalPages ? 'disabled' : ''}>Weiter ›</button>
      </div>`;
  }

  private _attachPaginationHandlers(): void {
    const body = document.getElementById('ct-vsa-body');
    if (!body) return;
    body.querySelector('#ct-vsa-prev')?.addEventListener('click', () => {
      if (this._currentPage > 1) { this._currentPage--; this._renderBody(); }
    });
    body.querySelector('#ct-vsa-next')?.addEventListener('click', () => {
      const filtered = this._getFilteredVehicles();
      const tp = Math.ceil(filtered.length / this._pageSize);
      if (this._currentPage < tp) { this._currentPage++; this._renderBody(); }
    });
  }

  // ── Footer / Selection UI ─────────────────────────────────────────────────

  private _updateFooter(): void {
    const count = this._selectedVins.size;
    const badge = document.getElementById('ct-vsa-badge');
    const btn = document.getElementById('ct-vsa-print') as HTMLButtonElement | null;
    if (badge) badge.textContent = `${count} von ${this._vehicles.length} Fahrzeuge ausgewählt`;
    if (btn) btn.disabled = count === 0;
  }

  // ── QR Code Generation ─────────────────────────────────────────────────────

  private _generateQRSvg(data: string, cellSize = 3): string {
    try {
      const qr = qrcode(0, 'H');
      qr.addData(data);
      qr.make();
      const moduleCount = qr.getModuleCount();
      const size = moduleCount * cellSize;
      let paths = '';
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(row, col)) {
            paths += `M${col * cellSize},${row * cellSize}h${cellSize}v${cellSize}h${-cellSize}z`;
          }
        }
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><path d="${paths}" fill="#000"/></svg>`;
    } catch (e) {
      err('QR generation failed for:', data, e);
      return `<div style="width:120px;height:120px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">QR Error</div>`;
    }
  }

  // ── Print ──────────────────────────────────────────────────────────────────

  private _printSelected(): void {
    const selectedVehicles = this._vehicles.filter((v) => this._selectedVins.has(v.vin));
    if (selectedVehicles.length === 0) return;

    const dspCode = this.companyConfig.getDspCode();
    const perPage = 8;

    // Build pages (8 per DIN A4 page — 2 columns × 4 rows)
    const pages: string[] = [];
    for (let i = 0; i < selectedVehicles.length; i += perPage) {
      const pageVehicles = selectedVehicles.slice(i, i + perPage);
      const pageFrames = pageVehicles.map((v) => {
        const qrSvg = this._generateQRSvg(v.vin, 3);
        return `
          <div class="vehicle-frame">
            <div class="title">${esc(v.stationCode)}</div>
            <div class="shortcode">${esc(dspCode)}</div>
            <div class="license-plate">License Plate: <span class="bold-text">${esc(v.registrationNo)}</span></div>
            <div class="vin">VIN: <span class="bold-text">${esc(v.vin)}</span></div>
            <div class="qr-code">${qrSvg}</div>
          </div>`;
      }).join('\n');
      pages.push(`<div class="print-page">${pageFrames}</div>`);
    }

    const printHTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>VSA QR Codes – ${esc(dspCode)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Amazon Ember', Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .print-page {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-content: flex-start;
      gap: 4px;
      page-break-after: always;
      width: 100%;
      min-height: calc(297mm - 20mm);
    }
    .print-page:last-child {
      page-break-after: auto;
    }

    .vehicle-frame {
      width: 310px;
      height: 189px;
      border: 2px dashed black;
      position: relative;
      box-sizing: border-box;
      background-color: white;
      flex-shrink: 0;
    }

    .title {
      position: absolute;
      top: 13px;
      left: 45px;
      font-size: 17px;
    }
    .shortcode {
      position: absolute;
      top: 45px;
      left: 20px;
      font-size: 34px;
      font-weight: bold;
    }
    .license-plate {
      position: absolute;
      top: 113px;
      left: 8px;
      font-size: 12px;
    }
    .vin {
      position: absolute;
      top: 136px;
      left: 8px;
      font-size: 12px;
    }
    .bold-text {
      font-weight: bold;
    }
    .qr-code {
      position: absolute;
      top: 15px;
      right: 15px;
      width: 120px;
      height: 120px;
      overflow: hidden;
    }
    .qr-code svg {
      width: 100%;
      height: 100%;
    }

    @media screen {
      body { padding: 20px; background: #f0f0f0; }
      .print-page {
        background: white;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        padding: 10mm;
        margin-bottom: 20px;
        min-height: auto;
      }
    }
  </style>
</head>
<body>
  ${pages.join('\n')}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  <\/script>
</body>
</html>`;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Popup-Blocker verhindert das Öffnen des Druckfensters. Bitte Popups erlauben.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(printHTML);
    printWindow.document.close();
  }
}
