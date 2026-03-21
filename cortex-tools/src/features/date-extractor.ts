// features/date-extractor.ts – Date Range Extractor (batch WHC data extraction)

import { log, err, esc, todayStr, delay, extractSessionFromCookie } from '../core/utils';
import { onDispose } from '../core/utils';
import type { AppConfig } from '../core/storage';
import type { CompanyConfig } from '../core/api';

interface ExtractionResult {
  date: string;
  success: boolean;
  data?: unknown;
  error?: string;
  timestamp: string;
}

interface BatchIndexEntry {
  key: string;
  startDate: string;
  endDate: string;
  timestamp: string;
  successCount: number;
  totalCount: number;
}

interface ProgressState {
  isRunning: boolean;
  current: number;
  total: number;
  dates: string[];
  results: ExtractionResult[];
}

export class DateRangeExtractor {
  private _progress: ProgressState = { isRunning: false, current: 0, total: 0, dates: [], results: [] };
  private _dialogEl: HTMLElement | null = null;
  private _progressEl: HTMLElement | null = null;
  private _resultsEl: HTMLElement | null = null;
  private _historyEl: HTMLElement | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly companyConfig: CompanyConfig,
  ) {}

  init(): void { /* no-op — lazy creation */ }

  dispose(): void {
    this._stopExtraction();
    this._dialogEl?.remove(); this._dialogEl = null;
    this._progressEl?.remove(); this._progressEl = null;
    this._resultsEl?.remove(); this._resultsEl = null;
    this._historyEl?.remove(); this._historyEl = null;
  }

  // ── Date Range Dialog ──────────────────────────────────────────────────────

  showDialog(): void {
    if (!this.config.features.dateExtractor) {
      alert('Date Range Extractor ist deaktiviert. Bitte in den Einstellungen aktivieren.');
      return;
    }

    this._dialogEl?.remove(); this._dialogEl = null;

    const today = todayStr();
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const overlay = document.createElement('div');
    overlay.className = 'ct-overlay visible';
    overlay.innerHTML = `
      <div class="ct-dialog">
        <h3>📅 Select Date Range</h3>
        <div style="margin: 15px 0;">
          <label><strong>Start Date:</strong></label><br>
          <input type="date" class="ct-input ct-input--full" id="ct-dre-start" value="${lastWeek}" style="margin-top:5px;">
        </div>
        <div style="margin: 15px 0;">
          <label><strong>End Date:</strong></label><br>
          <input type="date" class="ct-input ct-input--full" id="ct-dre-end" value="${today}" style="margin-top:5px;">
        </div>
        <div style="margin: 15px 0;">
          <label><strong>Service Area:</strong></label><br>
          <select class="ct-input ct-input--full" id="ct-dre-sa" style="margin-top:5px;">
            <option value="">Wird geladen…</option>
          </select>
        </div>
        <div class="ct-note-box">
          ℹ️ <strong>Note:</strong> Sundays will be automatically excluded from the range.
        </div>
        <div style="text-align: center; margin-top: 20px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
          <button class="ct-btn ct-btn--success" id="ct-dre-preview">👁️ Preview Dates</button>
          <button class="ct-btn ct-btn--info" id="ct-dre-start-btn">🚀 Start Extraction</button>
          <button class="ct-btn ct-btn--accent" id="ct-dre-history">📈 Batch History</button>
          <button class="ct-btn ct-btn--secondary" id="ct-dre-cancel">Cancel</button>
        </div>
        <div id="ct-dre-preview-area"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._dialogEl = overlay;

    this.companyConfig.load().then(() => {
      this.companyConfig.populateSaSelect(
        document.getElementById('ct-dre-sa') as HTMLSelectElement,
      );
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); this._dialogEl = null; }
    });

    document.getElementById('ct-dre-preview')!.addEventListener('click', () => {
      const startDate = (document.getElementById('ct-dre-start') as HTMLInputElement).value;
      const endDate = (document.getElementById('ct-dre-end') as HTMLInputElement).value;
      if (!startDate || !endDate) { alert('Please select both start and end dates'); return; }
      try {
        const dates = this._generateDateRange(startDate, endDate);
        document.getElementById('ct-dre-preview-area')!.innerHTML = `
          <div class="ct-info-box">
            <strong>📋 Dates to extract (${dates.length}):</strong><br>
            <div style="max-height: 150px; overflow-y: auto; margin-top: 5px; font-size: 12px;">
              ${esc(dates.join(', '))}
            </div>
          </div>`;
      } catch (error) {
        alert('Error: ' + (error as Error).message);
      }
    });

    document.getElementById('ct-dre-start-btn')!.addEventListener('click', () => {
      const startDate = (document.getElementById('ct-dre-start') as HTMLInputElement).value;
      const endDate = (document.getElementById('ct-dre-end') as HTMLInputElement).value;
      const serviceAreaId = (document.getElementById('ct-dre-sa') as HTMLSelectElement).value;
      if (!startDate || !endDate) { alert('Please select both start and end dates'); return; }
      if (!serviceAreaId.trim()) { alert('Bitte Service Area auswählen'); return; }
      overlay.remove(); this._dialogEl = null;
      this._extractDateRange(startDate, endDate, serviceAreaId.trim());
    });

    document.getElementById('ct-dre-history')!.addEventListener('click', () => {
      overlay.remove(); this._dialogEl = null;
      this.showHistory();
    });

    document.getElementById('ct-dre-cancel')!.addEventListener('click', () => {
      overlay.remove(); this._dialogEl = null;
    });
  }

  // ── Batch History ──────────────────────────────────────────────────────────

  showHistory(): void {
    this._historyEl?.remove(); this._historyEl = null;

    const batchIndex: BatchIndexEntry[] = JSON.parse(
      GM_getValue('batch_index', '[]') as string,
    );

    if (batchIndex.length === 0) {
      alert('No batch history found');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'ct-overlay visible';

    const rows = [...batchIndex].reverse().map((batch) => {
      const successRate = Math.round((batch.successCount / batch.totalCount) * 100);
      const cls = successRate === 100 ? 'ct-history-success' : successRate > 50 ? 'ct-history-partial' : 'ct-history-failure';
      return `
        <tr>
          <td>${esc(batch.startDate)} to ${esc(batch.endDate)}</td>
          <td>${esc(new Date(batch.timestamp).toLocaleString())}</td>
          <td class="${cls}">${batch.successCount}/${batch.totalCount} (${successRate}%)</td>
          <td>
            <button class="ct-btn ct-btn--info" data-ct-batch-download="${esc(batch.key)}">Download</button>
          </td>
        </tr>`;
    }).join('');

    overlay.innerHTML = `
      <div class="ct-panel" style="min-width:700px;">
        <h2>📈 Batch Extraction History</h2>
        <table class="ct-history-table">
          <thead>
            <tr><th>Date Range</th><th>Extracted</th><th>Success Rate</th><th>Actions</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top: 16px; text-align: right;">
          <button class="ct-btn ct-btn--secondary" id="ct-dre-history-close">Close</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this._historyEl = overlay;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); this._historyEl = null; }
      const dlBtn = (e.target as Element).closest('[data-ct-batch-download]');
      if (dlBtn) {
        const key = dlBtn.getAttribute('data-ct-batch-download')!;
        this._downloadBatch(key);
      }
    });

    document.getElementById('ct-dre-history-close')!.addEventListener('click', () => {
      overlay.remove(); this._historyEl = null;
    });
  }

  private _downloadBatch(key: string): void {
    try {
      const raw = GM_getValue(key, null) as string | null;
      if (!raw) { alert('Batch data not found — it may have been removed.'); return; }
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `batch_${key}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      err('Download batch failed:', e);
      alert('Failed to download batch data.');
    }
  }

  // ── Extraction Core ────────────────────────────────────────────────────────

  private async _extractDateRange(startDate: string, endDate: string, serviceAreaId: string): Promise<void> {
    const dates = this._generateDateRange(startDate, endDate);
    log(`Extracting data for ${dates.length} dates:`, dates);

    this._progress = { isRunning: true, current: 0, total: dates.length, dates, results: [] };
    this._updateProgressDisplay();

    for (let i = 0; i < dates.length; i++) {
      if (!this._progress.isRunning) break;
      const date = dates[i];
      this._progress.current = i + 1;

      try {
        log(`Extracting data for ${date} (${i + 1}/${dates.length})`);
        this._updateProgressDisplay();
        const data = await this._extractSingleDate(date, serviceAreaId);
        this._progress.results.push({ date, success: true, data, timestamp: new Date().toISOString() });
        if (i < dates.length - 1) await delay(1000 + Math.random() * 1000);
      } catch (error) {
        err(`Failed for ${date}:`, error);
        this._progress.results.push({ date, success: false, error: (error as Error).message, timestamp: new Date().toISOString() });
        await delay(2000);
      }
    }

    this._progress.isRunning = false;
    this._updateProgressDisplay();
    log('Date range extraction completed');
    this._saveBatchResults(this._progress.results, startDate, endDate);
    this._showBatchResults(this._progress.results);
  }

  private _extractSingleDate(localDate: string, serviceAreaId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const apiUrl = `https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${localDate}&serviceAreaId=${serviceAreaId}`;
      fetch(apiUrl, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
          'user-ref': 'cortex-webapp-user',
          'X-Cortex-Timestamp': Date.now().toString(),
          'X-Cortex-Session': extractSessionFromCookie() ?? '',
          Referer: location.href,
        },
      })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          return response.json();
        })
        .then((data) => { this._saveIndividualData(data, localDate); resolve(data); })
        .catch(reject);
    });
  }

  private _generateDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start > end) throw new Error('Start date must be before end date');
    const current = new Date(start);
    while (current <= end) {
      if (current.getDay() !== 0) {
        dates.push(current.toISOString().split('T')[0]);
      }
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  private _saveIndividualData(data: unknown, date: string): void {
    const key = `logistics_data_${date}`;
    const processed = {
      date,
      extractedAt: new Date().toISOString(),
      rawData: data,
      summary: this._extractDataSummary(data),
    };
    GM_setValue(key, JSON.stringify(processed));
    log(`Saved data for ${date}`);
  }

  private _saveBatchResults(results: ExtractionResult[], startDate: string, endDate: string): void {
    const batchKey = `batch_${startDate}_${endDate}_${Date.now()}`;
    const batchData = {
      startDate, endDate,
      extractedAt: new Date().toISOString(),
      totalDates: results.length,
      successCount: results.filter((r) => r.success).length,
      results,
    };
    GM_setValue(batchKey, JSON.stringify(batchData));

    const batchIndex: BatchIndexEntry[] = JSON.parse(GM_getValue('batch_index', '[]') as string);
    batchIndex.push({
      key: batchKey, startDate, endDate,
      timestamp: new Date().toISOString(),
      successCount: batchData.successCount,
      totalCount: batchData.totalDates,
    });
    if (batchIndex.length > 20) {
      const oldBatch = batchIndex.shift()!;
      GM_setValue(oldBatch.key, '');
    }
    GM_setValue('batch_index', JSON.stringify(batchIndex));
    log(`Saved batch: ${batchKey}`);
  }

  private _extractDataSummary(data: unknown): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    try {
      const d = data as Record<string, Record<string, unknown>>;
      if (d['summary']) {
        summary['totalRoutes'] = d['summary']['totalRoutes'] || 0;
        summary['completedRoutes'] = d['summary']['completedRoutes'] || 0;
        summary['totalPackages'] = d['summary']['totalPackages'] || 0;
        summary['deliveredPackages'] = d['summary']['deliveredPackages'] || 0;
      }
      if (d['metrics']) summary['metrics'] = d['metrics'];
    } catch (e) {
      console.warn('Could not extract summary:', e);
    }
    return summary;
  }

  // ── Progress Display ───────────────────────────────────────────────────────

  private _updateProgressDisplay(): void {
    if (!this._progress.isRunning) {
      this._progressEl?.remove(); this._progressEl = null;
      return;
    }
    if (!this._progressEl) {
      const overlay = document.createElement('div');
      overlay.className = 'ct-overlay visible';
      overlay.innerHTML = `
        <div class="ct-dialog" style="min-width:320px; text-align:center;">
          <h3>📊 Extracting Data</h3>
          <div id="ct-dre-progress-inner"></div>
          <button class="ct-btn ct-btn--danger" id="ct-dre-stop" style="margin-top:15px;">Stop</button>
        </div>`;
      document.body.appendChild(overlay);
      this._progressEl = overlay;
      document.getElementById('ct-dre-stop')!.addEventListener('click', () => this._stopExtraction());
    }
    const pct = Math.round((this._progress.current / this._progress.total) * 100);
    const currentDate = this._progress.dates[this._progress.current - 1] || 'Starting...';
    document.getElementById('ct-dre-progress-inner')!.innerHTML = `
      <div style="margin: 15px 0;">
        <div class="ct-progress">
          <div class="ct-progress__fill" style="width: ${pct}%;"></div>
        </div>
        <div style="margin-top: 10px; font-size: 14px;">
          ${this._progress.current} / ${this._progress.total} (${pct}%)
        </div>
      </div>
      <div style="color: #666; font-size: 12px;">Current: ${esc(currentDate)}</div>`;
  }

  private _stopExtraction(): void {
    this._progress.isRunning = false;
    this._progressEl?.remove(); this._progressEl = null;
    log('Extraction stopped by user');
  }

  // ── Batch Results Display ──────────────────────────────────────────────────

  private _showBatchResults(results: ExtractionResult[]): void {
    this._resultsEl?.remove(); this._resultsEl = null;

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;
    const successRate = results.length > 0 ? Math.round((successCount / results.length) * 100) : 0;

    const resultItems = results.map((result) => `
      <div class="ct-result-item">
        <h4>${esc(result.date)}
          <span class="${result.success ? 'ct-result-success' : 'ct-result-failure'}">
            ${result.success ? '✅' : '❌'}
          </span>
        </h4>
        ${result.success
          ? '<p>Data extracted successfully</p>'
          : '<p>Error: ' + esc(result.error ?? '') + '</p>'
        }
        <small>Time: ${esc(new Date(result.timestamp).toLocaleString())}</small>
      </div>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'ct-overlay visible';
    overlay.innerHTML = `
      <div class="ct-panel" style="min-width:600px;">
        <h2>📊 Batch Extraction Results</h2>
        <div class="ct-summary-box">
          <h3>Summary</h3>
          <p><strong>Total Dates:</strong> ${results.length}</p>
          <p><strong class="ct-result-success">Successful:</strong> ${successCount}</p>
          <p><strong class="ct-result-failure">Failed:</strong> ${failureCount}</p>
          <p><strong>Success Rate:</strong> ${successRate}%</p>
        </div>
        <div style="margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="ct-btn ct-btn--primary" id="ct-dre-dl-all">💾 Download All Data</button>
          <button class="ct-btn ct-btn--info" id="ct-dre-dl-summary">📋 Download Summary</button>
        </div>
        <h3>Individual Results</h3>
        <div style="max-height: 400px; overflow-y: auto;">${resultItems}</div>
        <div style="margin-top: 16px; text-align: right;">
          <button class="ct-btn ct-btn--secondary" id="ct-dre-results-close">Close</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this._resultsEl = overlay;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); this._resultsEl = null; }
    });

    document.getElementById('ct-dre-results-close')!.addEventListener('click', () => {
      overlay.remove(); this._resultsEl = null;
    });

    document.getElementById('ct-dre-dl-all')!.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logistics_batch_data_${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('ct-dre-dl-summary')!.addEventListener('click', () => {
      const summary = { totalDates: results.length, successCount, failureCount, successRate };
      const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logistics_summary_${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}
