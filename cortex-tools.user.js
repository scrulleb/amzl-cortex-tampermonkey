// ==UserScript==
// @name         Cortex Tools
// @namespace    https://github.com/jurib/amzl-cortex-tampermonkey
// @version      1.0.0
// @description  Produktivitäts-Tools für logistics.amazon.de (Cortex)
// @author       Juri B.
// @match        https://logistics.amazon.de/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      logistics.amazon.de
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTANTS & CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  const DEFAULTS = {
    enabled: true,
    dev: false,
    serviceAreaId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    features: {
      whcDashboard: true,
      dateExtractor: true,
    },
  };

  function getConfig() {
    const raw = GM_getValue('ct_config', null);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return {
        ...DEFAULTS,
        ...saved,
        features: { ...DEFAULTS.features, ...(saved.features || {}) },
      };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  function setConfig(cfg) {
    GM_setValue('ct_config', JSON.stringify(cfg));
  }

  let config = getConfig();
  if (!config.enabled) return;

  const API_URL = 'https://logistics.amazon.de/scheduling/home/api/v2/associate-attributes';
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGGING
  // ═══════════════════════════════════════════════════════════════════════════

  const LOG_PREFIX = '[CortexTools]';
  const log = (...a) => config.dev && console.log(LOG_PREFIX, ...a);
  const err = (...a) => console.error(LOG_PREFIX, ...a);

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPOSE / CLEANUP SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  const disposers = [];

  function onDispose(fn) {
    disposers.push(fn);
    return fn;
  }

  function disposeAll() {
    while (disposers.length) {
      try { disposers.pop()(); } catch (e) { /* ignore */ }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function waitForElement(selector, { timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const el2 = document.querySelector(selector);
        if (el2) { obs.disconnect(); resolve(el2); }
      });
      obs.observe(document, { childList: true, subtree: true });
      if (timeout) {
        setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout waiting for ${selector}`)); }, timeout);
      }
    });
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function withRetry(fn, { retries = 3, baseMs = 500 } = {}) {
    let attempt = 0;
    while (true) {
      try { return await fn(); }
      catch (e) {
        if (++attempt > retries) throw e;
        await delay(baseMs * 2 ** (attempt - 1));
      }
    }
  }

  function getCSRFToken() {
    const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]');
    if (meta) return meta.getAttribute('content');
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === 'anti-csrftoken-a2z') return v;
    }
    return null;
  }

  function extractSessionFromCookie() {
    const m = document.cookie.match(/session-id=([^;]+)/);
    return m ? m[1] : null;
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CSS BLOCK
  // ═══════════════════════════════════════════════════════════════════════════

  GM_addStyle(`
    /* ── Root Variables ───────────────────────────────── */
    :root {
      --ct-primary: #232f3e;
      --ct-accent: #ff9900;
      --ct-accent-hover: #e88b00;
      --ct-text-light: #ffffff;
      --ct-bg: #ffffff;
      --ct-border: #ddd;
      --ct-success: #0a7d3e;
      --ct-warning: #e67e00;
      --ct-danger: #cc0000;
      --ct-info: #007185;
      --ct-muted: #6e777f;
      --ct-radius: 4px;
      --ct-radius-lg: 10px;
      --ct-shadow: 0 4px 20px rgba(0,0,0,0.15);
      --ct-shadow-heavy: 0 4px 30px rgba(0,0,0,0.4);
      --ct-font: 'Amazon Ember', Arial, sans-serif;
    }

    /* ── Navbar Divider ───────────────────────────────── */
    .ct-divider {
      border-top: 1px solid var(--ct-border);
      margin: 4px 0;
      padding: 0 !important;
      list-style: none;
    }

    /* ── Overlays ─────────────────────────────────────── */
    .ct-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); z-index: 100000; display: none;
      justify-content: center; align-items: flex-start; padding-top: 40px;
    }
    .ct-overlay.visible { display: flex; }

    /* ── Panels / Dialogs ─────────────────────────────── */
    .ct-panel {
      background: var(--ct-bg); border-radius: var(--ct-radius-lg);
      padding: 24px; max-width: 95vw; max-height: 90vh; overflow: auto;
      box-shadow: var(--ct-shadow-heavy); min-width: 600px;
      font-family: var(--ct-font);
    }
    .ct-panel h2 { margin: 0 0 16px; color: var(--ct-primary); }

    .ct-dialog {
      background: var(--ct-bg); border-radius: var(--ct-radius-lg);
      padding: 25px; max-width: 95vw; box-shadow: var(--ct-shadow-heavy);
      min-width: 380px; font-family: var(--ct-font);
    }
    .ct-dialog h3 { margin-top: 0; color: var(--ct-info); }

    /* ── Controls Row ─────────────────────────────────── */
    .ct-controls {
      display: flex; gap: 10px; align-items: center;
      flex-wrap: wrap; margin-bottom: 16px;
    }

    /* ── Inputs / Selects ─────────────────────────────── */
    .ct-input, .ct-select {
      padding: 8px 12px; border-radius: 5px; border: 1px solid #ccc;
      font-size: 13px; font-family: var(--ct-font);
    }
    .ct-input:focus, .ct-select:focus {
      outline: none; border-color: var(--ct-accent);
      box-shadow: 0 0 0 2px rgba(255,153,0,0.2);
    }
    .ct-input--full { width: 100%; box-sizing: border-box; }

    /* ── Buttons ──────────────────────────────────────── */
    .ct-btn {
      padding: 8px 14px; border-radius: var(--ct-radius); border: none;
      font-size: 13px; font-weight: bold; cursor: pointer;
      font-family: var(--ct-font); transition: background 0.15s;
    }
    .ct-btn--primary { background: var(--ct-primary); color: var(--ct-text-light); }
    .ct-btn--primary:hover { background: #37475a; }
    .ct-btn--accent { background: var(--ct-accent); color: var(--ct-primary); }
    .ct-btn--accent:hover { background: var(--ct-accent-hover); }
    .ct-btn--danger { background: var(--ct-danger); color: var(--ct-text-light); }
    .ct-btn--danger:hover { background: #a00; }
    .ct-btn--success { background: var(--ct-success); color: var(--ct-text-light); }
    .ct-btn--success:hover { background: #086b33; }
    .ct-btn--close { background: var(--ct-danger); color: var(--ct-text-light); margin-left: auto; }
    .ct-btn--close:hover { background: #a00; }
    .ct-btn--secondary { background: #6c757d; color: var(--ct-text-light); }
    .ct-btn--secondary:hover { background: #5a6268; }
    .ct-btn--info { background: var(--ct-info); color: var(--ct-text-light); }
    .ct-btn--info:hover { background: #005f6b; }

    /* ── Tables ───────────────────────────────────────── */
    .ct-table {
      width: 100%; border-collapse: collapse; font-size: 12px;
      font-family: var(--ct-font);
    }
    .ct-table th, .ct-table td {
      border: 1px solid var(--ct-border); padding: 6px 8px;
      text-align: center; white-space: nowrap;
    }
    .ct-table th {
      background: var(--ct-primary); color: var(--ct-accent);
      position: sticky; top: 0; z-index: 1;
    }
    .ct-table tr:nth-child(even) { background: #f9f9f9; }
    .ct-table tr:hover { background: #fff3d6; }

    /* ── Status Classes ───────────────────────────────── */
    .ct-ok { color: var(--ct-success); font-weight: bold; }
    .ct-warn { color: var(--ct-warning); font-weight: bold; }
    .ct-danger { color: var(--ct-danger); font-weight: bold; }
    .ct-breach { background: #ffe0e0 !important; }
    .ct-nodata { color: #aaa; }

    /* ── Status Bar ───────────────────────────────────── */
    .ct-status {
      padding: 8px; margin-bottom: 10px; font-style: italic;
      color: var(--ct-muted);
    }

    /* ── Progress ─────────────────────────────────────── */
    .ct-progress {
      background: #f0f0f0; height: 20px; border-radius: 10px;
      overflow: hidden;
    }
    .ct-progress__fill {
      background: var(--ct-info); height: 100%; width: 0%;
      transition: width 0.3s; border-radius: 10px;
    }

    /* ── Settings ─────────────────────────────────────── */
    .ct-settings-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 0; border-bottom: 1px solid #eee;
    }
    .ct-settings-row:last-child { border-bottom: none; }
    .ct-settings-row label { font-size: 14px; color: #333; }
    .ct-toggle {
      position: relative; width: 44px; height: 24px; display: inline-block;
    }
    .ct-toggle input { opacity: 0; width: 0; height: 0; }
    .ct-toggle .ct-slider {
      position: absolute; cursor: pointer; inset: 0;
      background: #ccc; border-radius: 24px; transition: 0.3s;
    }
    .ct-toggle .ct-slider::before {
      content: ''; position: absolute; height: 18px; width: 18px;
      left: 3px; bottom: 3px; background: white; border-radius: 50%;
      transition: 0.3s;
    }
    .ct-toggle input:checked + .ct-slider { background: var(--ct-accent); }
    .ct-toggle input:checked + .ct-slider::before { transform: translateX(20px); }

    /* ── Batch result items ───────────────────────────── */
    .ct-result-item {
      border: 1px solid var(--ct-border); margin: 8px 0;
      padding: 10px; border-radius: 5px;
    }
    .ct-result-item h4 { margin: 0 0 4px; }
    .ct-result-success { color: var(--ct-success); }
    .ct-result-failure { color: var(--ct-danger); }
    .ct-summary-box {
      background: #f8f9fa; padding: 15px; border-radius: 5px;
      margin-bottom: 20px;
    }
    .ct-info-box {
      background: #e7f3ff; padding: 10px; border-radius: var(--ct-radius);
      margin-top: 10px; font-size: 12px;
    }
    .ct-note-box {
      background: #f8f9fa; padding: 10px; border-radius: var(--ct-radius);
      margin: 15px 0; font-size: 12px; color: #666;
    }

    /* ── History table ────────────────────────────────── */
    .ct-history-table { width: 100%; border-collapse: collapse; }
    .ct-history-table th, .ct-history-table td {
      border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px;
    }
    .ct-history-table th { background: var(--ct-info); color: white; }
    .ct-history-success { color: var(--ct-success); }
    .ct-history-partial { color: var(--ct-warning); }
    .ct-history-failure { color: var(--ct-danger); }

    /* ── Responsive ───────────────────────────────────── */
    @media (max-width: 768px) {
      .ct-panel, .ct-dialog { min-width: unset; width: 95vw; }
    }
  `);

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVBAR INJECTION SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  function injectNavItem() {
    try {
      if (document.getElementById('ct-nav-item')) return;

      const navList = document.querySelector('.fp-nav-menu-list');
      if (!navList) { log('Nav list not found'); return; }

      // Find "Support" item
      let supportItem = null;
      const items = navList.querySelectorAll(':scope > li.fp-nav-menu-list-item');
      for (const li of items) {
        const anchor = li.querySelector(':scope > a');
        if (anchor && anchor.textContent.trim().toLowerCase() === 'support') {
          supportItem = li;
          break;
        }
      }

      const li = document.createElement('li');
      li.id = 'ct-nav-item';
      li.className = 'fp-nav-menu-list-item';
      li.innerHTML = `
        <a href="#">Tools</a>
        <i class="fa fa-sort-down fa-2x fp-sub-menu-icon show"></i>
        <i class="fa fa-sort-up fa-2x fp-sub-menu-icon"></i>
        <ul class="fp-sub-menu" aria-expanded="false" role="menu">
          <li class="fp-sub-menu-list-item">
            <a href="#" data-ct-tool="whc-dashboard">📊 WHC Dashboard</a>
          </li>
          <li class="fp-sub-menu-list-item">
            <a href="#" data-ct-tool="date-extractor">📅 Date Range Extractor</a>
          </li>
          <li class="ct-divider" role="separator"></li>
          <li class="fp-sub-menu-list-item">
            <a href="#" data-ct-tool="settings">⚙ Einstellungen</a>
          </li>
        </ul>
      `;

      // Event delegation on the submenu
      const submenu = li.querySelector('.fp-sub-menu');
      submenu.addEventListener('click', (e) => {
        const anchor = e.target.closest('a[data-ct-tool]');
        if (!anchor) return;
        e.preventDefault();
        e.stopPropagation();
        const tool = anchor.getAttribute('data-ct-tool');
        try {
          switch (tool) {
            case 'whc-dashboard': whcDashboard.toggle(); break;
            case 'date-extractor': dateRangeExtractor.showDialog(); break;
            case 'settings': openSettings(); break;
          }
        } catch (ex) {
          err('Tool action failed:', tool, ex);
        }
      });

      if (supportItem) {
        supportItem.after(li);
      } else {
        navList.appendChild(li);
      }

      log('Nav item injected');
    } catch (e) {
      err('Failed to inject nav item:', e);
    }
  }

  function watchNavigation() {
    // Listen for Cortex's custom navigation reload event
    const handler = () => {
      log('fp-navigation-loaded event');
      setTimeout(injectNavItem, 100);
    };
    document.addEventListener('fp-navigation-loaded', handler);
    onDispose(() => document.removeEventListener('fp-navigation-loaded', handler));

    // MutationObserver fallback — watch for nav being replaced
    const obs = new MutationObserver(() => {
      if (!document.getElementById('ct-nav-item') && document.querySelector('.fp-nav-menu-list')) {
        injectNavItem();
      }
    });
    const navContainer = document.querySelector('.fp-navigation-container') || document.body;
    obs.observe(navContainer, { childList: true, subtree: true });
    onDispose(() => obs.disconnect());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE: WHC DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  const whcDashboard = {
    _active: false,
    _overlayEl: null,

    // State
    _nameMap: {},
    _associates: [],
    _lastQueryResult: null,
    _lastQueryMode: null,

    // ── Lifecycle ─────────────────────────────────────────
    init() {
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

      // Backdrop click to close
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.hide();
      });

      document.getElementById('ct-whc-close').addEventListener('click', () => this.hide());
      document.getElementById('ct-whc-go').addEventListener('click', () => this._runQuery());
      document.getElementById('ct-whc-export').addEventListener('click', () => this._exportCSV());

      onDispose(() => this.dispose());
      log('WHC Dashboard initialized');
    },

    dispose() {
      if (this._overlayEl) {
        this._overlayEl.remove();
        this._overlayEl = null;
      }
      this._active = false;
      this._nameMap = {};
      this._associates = [];
      this._lastQueryResult = null;
      this._lastQueryMode = null;
    },

    toggle() {
      if (!config.features.whcDashboard) {
        alert('WHC Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.');
        return;
      }
      this.init();
      if (this._active) this.hide(); else this.show();
    },

    show() {
      this.init();
      this._overlayEl.classList.add('visible');
      this._active = true;
    },

    hide() {
      if (this._overlayEl) this._overlayEl.classList.remove('visible');
      this._active = false;
    },

    // ── Helpers ───────────────────────────────────────────
    _resolveName(id) {
      return this._nameMap[id] || id;
    },

    _minsToHM(mins) {
      if (mins === null || mins === undefined || mins === 0) return '-';
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m.toString().padStart(2, '0')}m`;
    },

    _minsClass(mins) {
      if (!mins || mins === 0) return 'ct-nodata';
      if (mins > 600) return 'ct-danger';
      if (mins > 540) return 'ct-warn';
      return 'ct-ok';
    },

    _getMonday(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      return d.toISOString().split('T')[0];
    },

    _addDays(dateStr, n) {
      const d = new Date(dateStr + 'T00:00:00');
      d.setDate(d.getDate() + n);
      return d.toISOString().split('T')[0];
    },

    // ── API Calls ─────────────────────────────────────────
    async _fetchNames(fromDate, toDate) {
      const saId = config.serviceAreaId;
      const url =
        `https://logistics.amazon.de/scheduling/home/api/v2/rosters` +
        `?fromDate=${fromDate}` +
        `&serviceAreaId=${saId}` +
        `&toDate=${toDate || fromDate}`;

      const csrf = getCSRFToken();
      const headers = { Accept: 'application/json' };
      if (csrf) headers['anti-csrftoken-a2z'] = csrf;

      const resp = await fetch(url, { method: 'GET', headers, credentials: 'include' });
      if (!resp.ok) throw new Error(`Roster API Fehler ${resp.status}`);
      const json = await resp.json();

      const roster = Array.isArray(json) ? json : json?.data || json?.rosters || [];
      const ids = new Set();

      const processEntries = (entries) => {
        for (const entry of entries) {
          if (entry.driverPersonId) {
            ids.add(entry.driverPersonId);
            if (entry.driverName) {
              this._nameMap[entry.driverPersonId] = entry.driverName;
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
    },

    async _fetchDay(date) {
      const payload = {
        associatesList: this._associates,
        date: date,
        mode: 'daily',
        serviceAreaId: config.serviceAreaId,
      };

      const csrf = getCSRFToken();
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (csrf) headers['anti-csrftoken-a2z'] = csrf;

      const resp = await fetch(API_URL, {
        method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include',
      });
      if (!resp.ok) throw new Error(`API Fehler ${resp.status} für ${date}`);
      return resp.json();
    },

    // ── Data Processing ───────────────────────────────────
    _extractDayData(json) {
      const result = {};
      const data = json?.data?.daWorkSummaryAndEligibility || {};
      for (const [id, entry] of Object.entries(data)) {
        const ws = entry?.workSummary;
        if (!ws) continue;
        result[id] = {
          scheduledDay: ws.daScheduledDayMins || 0,
          actualDay: ws.daActualWorkDayMins || 0,
          scheduledWeek: ws.daScheduledWeekMins || 0,
          actualWeek: ws.daActualWorkWeekMins || 0,
          last7Days: ws.daScheduledLast7DaysMins || 0,
          breached: ws.isDailyLeapThresholdBreached || false,
        };
      }
      return result;
    },

    // ── Rendering ─────────────────────────────────────────
    _renderSingleDay(date, dayData) {
      const self = this;
      const rows = Object.entries(dayData)
        .sort((a, b) => b[1].actualDay - a[1].actualDay)
        .map(([id, d]) => {
          const cls = d.breached ? 'ct-breach' : '';
          return `<tr class="${cls}">
            <td title="${esc(id)}">${esc(self._resolveName(id))}</td>
            <td>${self._minsToHM(d.scheduledDay)}</td>
            <td class="${self._minsClass(d.actualDay)}">${self._minsToHM(d.actualDay)}</td>
            <td>${self._minsToHM(d.scheduledWeek)}</td>
            <td>${self._minsToHM(d.actualWeek)}</td>
            <td>${self._minsToHM(d.last7Days)}</td>
            <td>${d.breached ? '⚠️ JA' : '✅ Nein'}</td>
          </tr>`;
        })
        .join('');

      return `
        <table class="ct-table">
          <thead><tr>
            <th>Fahrer</th>
            <th>Geplant (Tag)</th>
            <th>Ist (Tag)</th>
            <th>Geplant (Woche)</th>
            <th>Ist (Woche)</th>
            <th>Letzten 7 Tage</th>
            <th>Threshold Breach</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    },

    _renderWeek(weekData) {
      const self = this;
      const dates = Object.keys(weekData).sort();
      const allIds = new Set();
      for (const dd of Object.values(weekData)) {
        for (const id of Object.keys(dd)) allIds.add(id);
      }

      const dayHeaders = dates
        .map((d, i) => {
          const label = DAYS[i] || d;
          return `<th colspan="2">${esc(label)} (${esc(d.slice(5))})</th>`;
        })
        .join('');

      const subHeaders = dates
        .map(() => '<th>Geplant</th><th>Ist</th>')
        .join('');

      const sortedRows = [...allIds]
        .map((id) => {
          let totalActual = 0;
          let anyBreach = false;
          let weekActual = 0;

          const cells = dates
            .map((date) => {
              const d = weekData[date]?.[id];
              if (!d)
                return '<td class="ct-nodata">-</td><td class="ct-nodata">-</td>';
              totalActual += d.actualDay;
              if (d.breached) anyBreach = true;
              weekActual = d.actualWeek;
              return `
                <td>${self._minsToHM(d.scheduledDay)}</td>
                <td class="${self._minsClass(d.actualDay)}">${self._minsToHM(d.actualDay)}</td>
              `;
            })
            .join('');

          const cls = anyBreach ? 'ct-breach' : '';
          const row = `<tr class="${cls}">
            <td title="${esc(id)}">${esc(self._resolveName(id))}</td>
            ${cells}
            <td class="${self._minsClass(totalActual / dates.length)}">${self._minsToHM(totalActual)}</td>
            <td>${self._minsToHM(weekActual)}</td>
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
              <th rowspan="2">Σ Ist</th>
              <th rowspan="2">API Woche</th>
              <th rowspan="2">Breach</th>
            </tr>
            <tr>${subHeaders}</tr>
          </thead>
          <tbody>${sortedRows}</tbody>
        </table>
      `;
    },

    // ── Query ─────────────────────────────────────────────
    async _runQuery() {
      const date = document.getElementById('ct-whc-date').value;
      const mode = document.getElementById('ct-whc-mode').value;
      const statusEl = document.getElementById('ct-whc-status');
      const resultEl = document.getElementById('ct-whc-result');

      if (!date) {
        statusEl.textContent = '⚠️ Bitte Datum auswählen!';
        return;
      }

      resultEl.innerHTML = '';
      this._lastQueryMode = mode;

      // Load roster for names + IDs
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
        statusEl.textContent = `❌ Roster-Fehler: ${e.message}`;
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
          statusEl.textContent = `❌ Fehler: ${e.message}`;
          err(e);
        }
      } else {
        const monday = this._getMonday(date);
        const weekData = {};

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
          statusEl.textContent = `❌ Fehler: ${e.message}`;
          err(e);
        }
      }
    },

    // ── CSV Export ─────────────────────────────────────────
    _exportCSV() {
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
        const allIds = new Set();
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
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE: DATE RANGE EXTRACTOR
  // ═══════════════════════════════════════════════════════════════════════════

  const dateRangeExtractor = {
    _progress: { isRunning: false, current: 0, total: 0, dates: [], results: [] },
    _dialogEl: null,
    _progressEl: null,
    _resultsEl: null,
    _historyEl: null,

    // ── Lifecycle ─────────────────────────────────────────
    init() { /* no-op — lazy creation */ },

    dispose() {
      this._stopExtraction();
      if (this._dialogEl) { this._dialogEl.remove(); this._dialogEl = null; }
      if (this._progressEl) { this._progressEl.remove(); this._progressEl = null; }
      if (this._resultsEl) { this._resultsEl.remove(); this._resultsEl = null; }
      if (this._historyEl) { this._historyEl.remove(); this._historyEl = null; }
    },

    // ── Date Range Dialog ─────────────────────────────────
    showDialog() {
      if (!config.features.dateExtractor) {
        alert('Date Range Extractor ist deaktiviert. Bitte in den Einstellungen aktivieren.');
        return;
      }

      // Remove existing dialog if open
      if (this._dialogEl) { this._dialogEl.remove(); this._dialogEl = null; }

      const today = todayStr();
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const saId = esc(config.serviceAreaId);

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
            <label><strong>Service Area ID:</strong></label><br>
            <input type="text" class="ct-input ct-input--full" id="ct-dre-sa" value="${saId}" style="margin-top:5px;">
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

      // Backdrop click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); this._dialogEl = null; }
      });

      // Preview
      document.getElementById('ct-dre-preview').addEventListener('click', () => {
        const startDate = document.getElementById('ct-dre-start').value;
        const endDate = document.getElementById('ct-dre-end').value;
        if (!startDate || !endDate) { alert('Please select both start and end dates'); return; }
        try {
          const dates = this._generateDateRange(startDate, endDate);
          document.getElementById('ct-dre-preview-area').innerHTML = `
            <div class="ct-info-box">
              <strong>📋 Dates to extract (${dates.length}):</strong><br>
              <div style="max-height: 150px; overflow-y: auto; margin-top: 5px; font-size: 12px;">
                ${esc(dates.join(', '))}
              </div>
            </div>
          `;
        } catch (error) {
          alert('Error: ' + error.message);
        }
      });

      // Start extraction
      document.getElementById('ct-dre-start-btn').addEventListener('click', () => {
        const startDate = document.getElementById('ct-dre-start').value;
        const endDate = document.getElementById('ct-dre-end').value;
        const serviceAreaId = document.getElementById('ct-dre-sa').value;

        if (!startDate || !endDate) { alert('Please select both start and end dates'); return; }
        if (!serviceAreaId.trim()) { alert('Please enter a Service Area ID'); return; }

        overlay.remove();
        this._dialogEl = null;
        this._extractDateRange(startDate, endDate, serviceAreaId.trim());
      });

      // History
      document.getElementById('ct-dre-history').addEventListener('click', () => {
        overlay.remove();
        this._dialogEl = null;
        this.showHistory();
      });

      // Cancel
      document.getElementById('ct-dre-cancel').addEventListener('click', () => {
        overlay.remove();
        this._dialogEl = null;
      });
    },

    // ── Batch History ─────────────────────────────────────
    showHistory() {
      if (this._historyEl) { this._historyEl.remove(); this._historyEl = null; }

      const batchIndex = JSON.parse(GM_getValue('batch_index', '[]'));

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
              <button class="ct-btn ct-btn--info ct-btn--sm" data-ct-batch-download="${esc(batch.key)}">Download</button>
            </td>
          </tr>
        `;
      }).join('');

      overlay.innerHTML = `
        <div class="ct-panel" style="min-width:700px;">
          <h2>📈 Batch Extraction History</h2>
          <table class="ct-history-table">
            <thead>
              <tr>
                <th>Date Range</th>
                <th>Extracted</th>
                <th>Success Rate</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="margin-top: 16px; text-align: right;">
            <button class="ct-btn ct-btn--secondary" id="ct-dre-history-close">Close</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      this._historyEl = overlay;

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); this._historyEl = null; }
        // Download batch button
        const dlBtn = e.target.closest('[data-ct-batch-download]');
        if (dlBtn) {
          const key = dlBtn.getAttribute('data-ct-batch-download');
          this._downloadBatch(key);
        }
      });

      document.getElementById('ct-dre-history-close').addEventListener('click', () => {
        overlay.remove();
        this._historyEl = null;
      });
    },

    _downloadBatch(key) {
      try {
        const raw = GM_getValue(key, null);
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
    },

    // ── Extraction Core ───────────────────────────────────
    async _extractDateRange(startDate, endDate, serviceAreaId) {
      const dates = this._generateDateRange(startDate, endDate);
      log(`Extracting data for ${dates.length} dates:`, dates);

      this._progress = {
        isRunning: true,
        current: 0,
        total: dates.length,
        dates: dates,
        results: [],
      };

      this._updateProgressDisplay();

      for (let i = 0; i < dates.length; i++) {
        if (!this._progress.isRunning) break; // stopped

        const date = dates[i];
        this._progress.current = i + 1;

        try {
          log(`Extracting data for ${date} (${i + 1}/${dates.length})`);
          this._updateProgressDisplay();

          const data = await this._extractSingleDate(date, serviceAreaId);
          this._progress.results.push({
            date: date,
            success: true,
            data: data,
            timestamp: new Date().toISOString(),
          });

          log(`Success for ${date}`);

          // Delay between requests
          if (i < dates.length - 1) {
            await delay(1000 + Math.random() * 1000);
          }
        } catch (error) {
          err(`Failed for ${date}:`, error);
          this._progress.results.push({
            date: date,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
          });
          await delay(2000);
        }
      }

      this._progress.isRunning = false;
      this._updateProgressDisplay(); // removes progress overlay
      log('Date range extraction completed');

      this._saveBatchResults(this._progress.results, startDate, endDate);
      this._showBatchResults(this._progress.results);
    },

    _extractSingleDate(localDate, serviceAreaId) {
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
            'X-Cortex-Session': extractSessionFromCookie(),
            Referer: location.href,
          },
        })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return response.json();
          })
          .then((data) => {
            this._saveIndividualData(data, localDate);
            resolve(data);
          })
          .catch(reject);
      });
    },

    _generateDateRange(startDate, endDate) {
      const dates = [];
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start > end) throw new Error('Start date must be before end date');

      const current = new Date(start);
      while (current <= end) {
        if (current.getDay() !== 0) { // Skip Sundays
          dates.push(current.toISOString().split('T')[0]);
        }
        current.setDate(current.getDate() + 1);
      }
      return dates;
    },

    // ── Storage ───────────────────────────────────────────
    _saveIndividualData(data, date) {
      const key = `logistics_data_${date}`;
      const processed = {
        date: date,
        extractedAt: new Date().toISOString(),
        rawData: data,
        summary: this._extractDataSummary(data),
      };
      GM_setValue(key, JSON.stringify(processed));
      log(`Saved data for ${date}`);
    },

    _saveBatchResults(results, startDate, endDate) {
      const batchKey = `batch_${startDate}_${endDate}_${Date.now()}`;
      const batchData = {
        startDate: startDate,
        endDate: endDate,
        extractedAt: new Date().toISOString(),
        totalDates: results.length,
        successCount: results.filter((r) => r.success).length,
        results: results,
      };

      GM_setValue(batchKey, JSON.stringify(batchData));

      const batchIndex = JSON.parse(GM_getValue('batch_index', '[]'));
      batchIndex.push({
        key: batchKey,
        startDate: startDate,
        endDate: endDate,
        timestamp: new Date().toISOString(),
        successCount: batchData.successCount,
        totalCount: batchData.totalDates,
      });

      // Keep only last 20 batches
      if (batchIndex.length > 20) {
        const oldBatch = batchIndex.shift();
        GM_setValue(oldBatch.key, null);
      }

      GM_setValue('batch_index', JSON.stringify(batchIndex));
      log(`Saved batch: ${batchKey}`);
    },

    _extractDataSummary(data) {
      const summary = {};
      try {
        if (data.summary) {
          summary.totalRoutes = data.summary.totalRoutes || 0;
          summary.completedRoutes = data.summary.completedRoutes || 0;
          summary.totalPackages = data.summary.totalPackages || 0;
          summary.deliveredPackages = data.summary.deliveredPackages || 0;
        }
        if (data.metrics) {
          summary.metrics = data.metrics;
        }
      } catch (e) {
        console.warn('Could not extract summary:', e);
      }
      return summary;
    },

    // ── Progress Display ──────────────────────────────────
    _updateProgressDisplay() {
      if (!this._progress.isRunning) {
        if (this._progressEl) { this._progressEl.remove(); this._progressEl = null; }
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
          </div>
        `;
        document.body.appendChild(overlay);
        this._progressEl = overlay;

        document.getElementById('ct-dre-stop').addEventListener('click', () => this._stopExtraction());
      }

      const pct = Math.round((this._progress.current / this._progress.total) * 100);
      const currentDate = this._progress.dates[this._progress.current - 1] || 'Starting...';

      document.getElementById('ct-dre-progress-inner').innerHTML = `
        <div style="margin: 15px 0;">
          <div class="ct-progress">
            <div class="ct-progress__fill" style="width: ${pct}%;"></div>
          </div>
          <div style="margin-top: 10px; font-size: 14px;">
            ${this._progress.current} / ${this._progress.total} (${pct}%)
          </div>
        </div>
        <div style="color: #666; font-size: 12px;">Current: ${esc(currentDate)}</div>
      `;
    },

    _stopExtraction() {
      this._progress.isRunning = false;
      if (this._progressEl) { this._progressEl.remove(); this._progressEl = null; }
      log('Extraction stopped by user');
    },

    // ── Batch Results Display ─────────────────────────────
    _showBatchResults(results) {
      if (this._resultsEl) { this._resultsEl.remove(); this._resultsEl = null; }

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
            : '<p>Error: ' + esc(result.error) + '</p>'
          }
          <small>Time: ${esc(new Date(result.timestamp).toLocaleString())}</small>
        </div>
      `).join('');

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
        </div>
      `;

      document.body.appendChild(overlay);
      this._resultsEl = overlay;

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { overlay.remove(); this._resultsEl = null; }
      });

      document.getElementById('ct-dre-results-close').addEventListener('click', () => {
        overlay.remove();
        this._resultsEl = null;
      });

      document.getElementById('ct-dre-dl-all').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logistics_batch_data_${todayStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });

      document.getElementById('ct-dre-dl-summary').addEventListener('click', () => {
        const summary = {
          totalDates: results.length,
          successCount: successCount,
          failureCount: failureCount,
          successRate: successRate,
        };
        const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logistics_summary_${todayStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS DIALOG
  // ═══════════════════════════════════════════════════════════════════════════

  function openSettings() {
    // Remove existing settings overlay if open
    const existing = document.getElementById('ct-settings-overlay');
    if (existing) existing.remove();

    // Re-read config to get latest
    config = getConfig();

    const overlay = document.createElement('div');
    overlay.id = 'ct-settings-overlay';
    overlay.className = 'ct-overlay visible';

    function toggleHTML(id, label, checked) {
      return `
        <div class="ct-settings-row">
          <label for="${id}">${esc(label)}</label>
          <label class="ct-toggle">
            <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
            <span class="ct-slider"></span>
          </label>
        </div>
      `;
    }

    overlay.innerHTML = `
      <div class="ct-dialog" style="min-width: 400px;">
        <h3>⚙ Einstellungen</h3>

        ${toggleHTML('ct-set-whc', 'WHC Dashboard', config.features.whcDashboard)}
        ${toggleHTML('ct-set-dre', 'Date Range Extractor', config.features.dateExtractor)}
        ${toggleHTML('ct-set-dev', 'Dev-Mode (ausführliches Logging)', config.dev)}

        <div class="ct-settings-row" style="flex-direction: column; align-items: stretch;">
          <label for="ct-set-sa" style="margin-bottom: 6px;"><strong>Service Area ID:</strong></label>
          <input type="text" id="ct-set-sa" class="ct-input ct-input--full" value="${esc(config.serviceAreaId)}">
        </div>

        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button class="ct-btn ct-btn--secondary" id="ct-set-cancel">Abbrechen</button>
          <button class="ct-btn ct-btn--accent" id="ct-set-save">Speichern</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.getElementById('ct-set-cancel').addEventListener('click', () => overlay.remove());

    document.getElementById('ct-set-save').addEventListener('click', () => {
      config.features.whcDashboard = document.getElementById('ct-set-whc').checked;
      config.features.dateExtractor = document.getElementById('ct-set-dre').checked;
      config.dev = document.getElementById('ct-set-dev').checked;
      config.serviceAreaId = document.getElementById('ct-set-sa').value.trim() || DEFAULTS.serviceAreaId;
      setConfig(config);
      overlay.remove();
      log('Settings saved:', config);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPA NAVIGATION HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  function onUrlChange(cb) {
    let last = location.href;
    new MutationObserver(() => {
      if (location.href !== last) { last = location.href; cb(location.href); }
    }).observe(document, { subtree: true, childList: true });

    for (const method of ['pushState', 'replaceState']) {
      const orig = history[method];
      history[method] = function (...args) {
        const ret = orig.apply(this, args);
        window.dispatchEvent(new Event('locationchange'));
        return ret;
      };
    }
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
    window.addEventListener('locationchange', () => cb(location.href));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOT FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  function boot(url = location.href) {
    log('Boot for', url);
    injectNavItem();
  }

  // Initial injection — wait for nav to appear
  waitForElement('.fp-nav-menu-list')
    .then(() => {
      boot();
      watchNavigation();
    })
    .catch((e) => {
      err('Nav not found, retrying...', e);
      setTimeout(() => {
        injectNavItem();
        watchNavigation();
      }, 3000);
    });

  // Re-inject nav item if lost after SPA navigation
  onUrlChange((url) => {
    log('URL changed:', url);
    if (!document.getElementById('ct-nav-item')) {
      injectNavItem();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TAMPERMONKEY MENU COMMANDS
  // ═══════════════════════════════════════════════════════════════════════════

  GM_registerMenuCommand('📊 WHC Dashboard', () => whcDashboard.toggle());
  GM_registerMenuCommand('📅 Date Range Extractor', () => dateRangeExtractor.showDialog());
  GM_registerMenuCommand('⚙ Einstellungen', openSettings);
  GM_registerMenuCommand('⏸ Skript pausieren', () => {
    config.enabled = false;
    setConfig(config);
    disposeAll();
    const navItem = document.getElementById('ct-nav-item');
    if (navItem) navItem.remove();
    alert('Cortex Tools pausiert. Seite neu laden zum Reaktivieren.');
  });

  log('Cortex Tools loaded');
})();
