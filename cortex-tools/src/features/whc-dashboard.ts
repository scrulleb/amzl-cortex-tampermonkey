// features/whc-dashboard.ts – WHC (Working Hours Check) Dashboard

import { log, err, esc, todayStr, delay, getCSRFToken } from '../core/utils';
import { onDispose } from '../core/utils';
import { API_URL, DAYS } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';

interface DayEntry {
  scheduledDay: number;
  actualDay: number;
  scheduledWeek: number;
  actualWeek: number;
  last7Days: number;
  breached: boolean;
}

type WeekData = Record<string, Record<string, DayEntry>>;

export class WhcDashboard {
  private _active = false;
  private _overlayEl: HTMLElement | null = null;
  private _nameMap: Record<string, string> = {};
  private _associates: string[] = [];
  private _lastQueryResult: WeekData | null = null;
  private _lastQueryMode: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly companyConfig: CompanyConfig,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init(): void {
    if (this._overlayEl) return;

    const overlay = document.createElement('div');
    overlay.id = 'ct-whc-overlay';
    overlay.className = 'ct-overlay';
    overlay.innerHTML = `
      <div class="ct-panel">
        <h2>📊 DA WHC-Dashboard</h2>
        <div class="ct-controls">
          <label>Datum:</label>
          <input type="date" id="ct-whc-date" class="ct-input" value="${todayStr()}">
          <label for="ct-whc-sa">Service Area:</label>
          <select id="ct-whc-sa" class="ct-select" aria-label="Service Area">
            <option value="">Wird geladen…</option>
          </select>
          <select id="ct-whc-mode" class="ct-select">
            <option value="day">Einzelner Tag</option>
            <option value="week">Ganze Woche (Mo–So)</option>
          </select>
          <button class="ct-btn ct-btn--accent" id="ct-whc-go">🔍 Abfragen</button>
          <button class="ct-btn ct-btn--primary" id="ct-whc-export">📋 CSV Export</button>
          <button class="ct-btn ct-btn--close" id="ct-whc-close">✕ Schließen</button>
        </div>
        <div id="ct-whc-status" class="ct-status"></div>
        <div id="ct-whc-result"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._overlayEl = overlay;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hide(); });
    document.getElementById('ct-whc-close')!.addEventListener('click', () => this.hide());
    document.getElementById('ct-whc-go')!.addEventListener('click', () => this._runQuery());
    document.getElementById('ct-whc-export')!.addEventListener('click', () => this._exportCSV());

    this.companyConfig.load().then(() => {
      this.companyConfig.populateSaSelect(
        document.getElementById('ct-whc-sa') as HTMLSelectElement,
      );
    });

    onDispose(() => this.dispose());
    log('WHC Dashboard initialized');
  }

  dispose(): void {
    this._overlayEl?.remove();
    this._overlayEl = null;
    this._active = false;
    this._nameMap = {};
    this._associates = [];
    this._lastQueryResult = null;
    this._lastQueryMode = null;
  }

  toggle(): void {
    if (!this.config.features.whcDashboard) {
      alert('WHC Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.');
      return;
    }
    this.init();
    if (this._active) this.hide(); else this.show();
  }

  show(): void {
    this.init();
    this._overlayEl!.classList.add('visible');
    this._active = true;
  }

  hide(): void {
    this._overlayEl?.classList.remove('visible');
    this._active = false;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _resolveName(id: string): string {
    return this._nameMap[id] || id;
  }

  private _minsToHM(mins: number | null | undefined): string {
    if (mins === null || mins === undefined || mins === 0) return '-';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  }

  private _minsClass(mins: number | null | undefined): string {
    if (!mins || mins === 0) return 'ct-nodata';
    if (mins > 600) return 'ct-danger';
    if (mins > 540) return 'ct-warn';
    return 'ct-ok';
  }

  private _getMonday(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().split('T')[0];
  }

  private _addDays(dateStr: string, n: number): string {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  // ── API ────────────────────────────────────────────────────────────────────

  private _getSelectedSaId(): string {
    const sel = document.getElementById('ct-whc-sa') as HTMLSelectElement | null;
    return (sel && sel.value) ? sel.value : this.companyConfig.getDefaultServiceAreaId();
  }

  private async _fetchNames(fromDate: string, toDate?: string): Promise<void> {
    const saId = this._getSelectedSaId();
    const url =
      `https://logistics.amazon.de/scheduling/home/api/v2/rosters` +
      `?fromDate=${fromDate}` +
      `&serviceAreaId=${saId}` +
      `&toDate=${toDate || fromDate}`;

    const csrf = getCSRFToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
    if (!resp.ok) throw new Error(`Roster API Fehler ${resp.status}`);
    const json = await resp.json();

    const roster = Array.isArray(json) ? json : json?.data || json?.rosters || [];
    const ids = new Set<string>();

    const processEntries = (entries: Array<Record<string, unknown>>) => {
      for (const entry of entries) {
        if (entry['driverPersonId']) {
          ids.add(entry['driverPersonId'] as string);
          if (entry['driverName']) {
            this._nameMap[entry['driverPersonId'] as string] = entry['driverName'] as string;
          }
        }
      }
    };

    if (Array.isArray(roster)) {
      processEntries(roster);
    } else if (typeof roster === 'object') {
      for (const val of Object.values(roster)) {
        if (Array.isArray(val)) processEntries(val);
      }
    }

    this._associates = [...ids];
    log(`${this._associates.length} Fahrer gefunden, ${Object.keys(this._nameMap).length} Namen geladen`);
  }

  private async _fetchDay(date: string): Promise<unknown> {
    const payload = {
      associatesList: this._associates,
      date,
      mode: 'daily',
      serviceAreaId: this._getSelectedSaId(),
    };

    const csrf = getCSRFToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (csrf) headers['anti-csrftoken-a2z'] = csrf;

    const resp = await fetch(API_URL, {
      method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include',
    });
    if (!resp.ok) throw new Error(`API Fehler ${resp.status} für ${date}`);
    return resp.json();
  }

  // ── Data Processing ────────────────────────────────────────────────────────

  private _extractDayData(json: unknown): Record<string, DayEntry> {
    const result: Record<string, DayEntry> = {};
    const data = ((json as Record<string, unknown>)?.['data'] as Record<string, unknown> | undefined)?.['daWorkSummaryAndEligibility'] || {};
    for (const [id, entry] of Object.entries(data as Record<string, unknown>)) {
      const ws = (entry as Record<string, unknown>)?.['workSummary'] as Record<string, unknown>;
      if (!ws) continue;
      result[id] = {
        scheduledDay: (ws['daScheduledDayMins'] as number) || 0,
        actualDay: (ws['daActualWorkDayMins'] as number) || 0,
        scheduledWeek: (ws['daScheduledWeekMins'] as number) || 0,
        actualWeek: (ws['daActualWorkWeekMins'] as number) || 0,
        last7Days: (ws['daScheduledLast7DaysMins'] as number) || 0,
        breached: (ws['isDailyLeapThresholdBreached'] as boolean) || false,
      };
    }
    return result;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _renderSingleDay(date: string, dayData: Record<string, DayEntry>): string {
    const rows = Object.entries(dayData)
      .sort((a, b) => b[1].actualDay - a[1].actualDay)
      .map(([id, d]) => {
        const cls = d.breached ? 'ct-breach' : '';
        return `<tr class="${cls}">
          <td title="${esc(id)}">${esc(this._resolveName(id))}</td>
          <td>${this._minsToHM(d.scheduledDay)}</td>
          <td class="${this._minsClass(d.actualDay)}">${this._minsToHM(d.actualDay)}</td>
          <td>${this._minsToHM(d.scheduledWeek)}</td>
          <td>${this._minsToHM(d.actualWeek)}</td>
          <td>${this._minsToHM(d.last7Days)}</td>
          <td>${d.breached ? '⚠️ JA' : '✅ Nein'}</td>
        </tr>`;
      }).join('');

    return `
      <table class="ct-table">
        <thead><tr>
          <th>Fahrer</th><th>Geplant (Tag)</th><th>Ist (Tag)</th>
          <th>Geplant (Woche)</th><th>Ist (Woche)</th>
          <th>Letzten 7 Tage</th><th>Threshold Breach</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private _renderWeek(weekData: WeekData): string {
    const dates = Object.keys(weekData).sort();
    const allIds = new Set<string>();
    for (const dd of Object.values(weekData)) {
      for (const id of Object.keys(dd)) allIds.add(id);
    }

    const dayHeaders = dates
      .map((d, i) => `<th colspan="2">${esc(DAYS[i] ?? d)} (${esc(d.slice(5))})</th>`)
      .join('');
    const subHeaders = dates.map(() => '<th>Geplant</th><th>Ist</th>').join('');

    const sortedRows = [...allIds]
      .map((id) => {
        let totalActual = 0;
        let anyBreach = false;
        let weekActual = 0;

        const cells = dates.map((date) => {
          const d = weekData[date]?.[id];
          if (!d) return '<td class="ct-nodata">-</td><td class="ct-nodata">-</td>';
          totalActual += d.actualDay;
          if (d.breached) anyBreach = true;
          weekActual = d.actualWeek;
          return `<td>${this._minsToHM(d.scheduledDay)}</td>
                  <td class="${this._minsClass(d.actualDay)}">${this._minsToHM(d.actualDay)}</td>`;
        }).join('');

        const cls = anyBreach ? 'ct-breach' : '';
        const row = `<tr class="${cls}">
          <td title="${esc(id)}">${esc(this._resolveName(id))}</td>
          ${cells}
          <td class="${this._minsClass(totalActual / dates.length)}">${this._minsToHM(totalActual)}</td>
          <td>${this._minsToHM(weekActual)}</td>
          <td>${anyBreach ? '⚠️ JA' : '✅'}</td>
        </tr>`;
        return { row, anyBreach, totalActual };
      })
      .sort((a, b) => {
        if (a.anyBreach !== b.anyBreach) return a.anyBreach ? -1 : 1;
        return b.totalActual - a.totalActual;
      })
      .map((r) => r.row)
      .join('');

    return `
      <table class="ct-table">
        <thead>
          <tr>
            <th rowspan="2">Fahrer</th>
            ${dayHeaders}
            <th rowspan="2">Σ Ist</th><th rowspan="2">API Woche</th><th rowspan="2">Breach</th>
          </tr>
          <tr>${subHeaders}</tr>
        </thead>
        <tbody>${sortedRows}</tbody>
      </table>
    `;
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  private async _runQuery(): Promise<void> {
    const date = (document.getElementById('ct-whc-date') as HTMLInputElement).value;
    const mode = (document.getElementById('ct-whc-mode') as HTMLSelectElement).value;
    const statusEl = document.getElementById('ct-whc-status')!;
    const resultEl = document.getElementById('ct-whc-result')!;

    if (!date) { statusEl.textContent = '⚠️ Bitte Datum auswählen!'; return; }

    resultEl.innerHTML = '';
    this._lastQueryMode = mode;

    try {
      statusEl.textContent = '⏳ Lade Fahrer-Liste...';
      if (mode === 'week') {
        const monday = this._getMonday(date);
        const sunday = this._addDays(monday, 6);
        await this._fetchNames(monday, sunday);
      } else {
        await this._fetchNames(date);
      }
      statusEl.textContent = `⏳ ${this._associates.length} Fahrer gefunden, lade Daten...`;
    } catch (e) {
      statusEl.textContent = `❌ Roster-Fehler: ${(e as Error).message}`;
      err(e);
      return;
    }

    if (this._associates.length === 0) {
      statusEl.textContent = '⚠️ Keine Fahrer im Roster gefunden für dieses Datum!';
      return;
    }

    if (mode === 'day') {
      statusEl.textContent = `⏳ Lade Daten für ${date}...`;
      try {
        const json = await this._fetchDay(date);
        const dayData = this._extractDayData(json);
        this._lastQueryResult = { [date]: dayData };
        resultEl.innerHTML = this._renderSingleDay(date, dayData);
        const count = Object.keys(dayData).length;
        const breaches = Object.values(dayData).filter((d) => d.breached).length;
        statusEl.textContent = `✅ ${count} Fahrer geladen | ${breaches} Threshold-Breaches | ${date}`;
      } catch (e) {
        statusEl.textContent = `❌ Fehler: ${(e as Error).message}`;
        err(e);
      }
    } else {
      const monday = this._getMonday(date);
      const weekData: WeekData = {};

      try {
        for (let i = 0; i < 7; i++) {
          const d = this._addDays(monday, i);
          statusEl.textContent = `⏳ Lade ${DAYS[i]} (${d})... (${i + 1}/7)`;
          try {
            const json = await this._fetchDay(d);
            weekData[d] = this._extractDayData(json);
          } catch (e) {
            console.warn(`Fehler für ${d}:`, e);
            weekData[d] = {};
          }
          if (i < 6) await delay(500);
        }
        this._lastQueryResult = weekData;
        resultEl.innerHTML = this._renderWeek(weekData);

        let totalBreaches = 0;
        for (const dd of Object.values(weekData)) {
          for (const d of Object.values(dd)) {
            if (d.breached) totalBreaches++;
          }
        }
        statusEl.textContent = `✅ Woche ${monday} geladen | ${totalBreaches} Breach-Einträge`;
      } catch (e) {
        statusEl.textContent = `❌ Fehler: ${(e as Error).message}`;
        err(e);
      }
    }
  }

  // ── CSV Export ─────────────────────────────────────────────────────────────

  private _exportCSV(): void {
    if (!this._lastQueryResult) {
      alert('Bitte zuerst eine Abfrage starten!');
      return;
    }

    let csv = '';

    if (this._lastQueryMode === 'day') {
      const date = Object.keys(this._lastQueryResult)[0];
      const data = this._lastQueryResult[date];
      csv = 'Name;Associate ID;Geplant (Tag);Ist (Tag);Geplant (Woche);Ist (Woche);Letzten 7 Tage;Breach\n';
      for (const [id, d] of Object.entries(data)) {
        csv += `${this._resolveName(id)};${id};${d.scheduledDay};${d.actualDay};${d.scheduledWeek};${d.actualWeek};${d.last7Days};${d.breached}\n`;
      }
    } else {
      const dates = Object.keys(this._lastQueryResult).sort();
      const allIds = new Set<string>();
      for (const dd of Object.values(this._lastQueryResult)) {
        for (const id of Object.keys(dd)) allIds.add(id);
      }

      csv = 'Name;Associate ID';
      for (const d of dates) { csv += `;${d} Geplant;${d} Ist`; }
      csv += ';Breach\n';

      for (const id of allIds) {
        csv += `${this._resolveName(id)};${id}`;
        let anyBreach = false;
        for (const date of dates) {
          const d = this._lastQueryResult[date]?.[id];
          csv += `;${d?.scheduledDay || 0};${d?.actualDay || 0}`;
          if (d?.breached) anyBreach = true;
        }
        csv += `;${anyBreach}\n`;
      }
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arbeitszeiten_${this._lastQueryMode}_${Object.keys(this._lastQueryResult)[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
