// ==UserScript==
// @name         Cortex Tools
// @namespace    https://github.com/jurib/amzl-cortex-tampermonkey
// @version      1.3.1
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

"use strict";
(() => {
  // src/core/storage.ts
  var DEFAULTS = {
    enabled: true,
    dev: false,
    serviceAreaId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    deliveryPerfStation: "XYZ1",
    deliveryPerfDsp: "TEST",
    features: {
      whcDashboard: true,
      dateExtractor: true,
      deliveryPerf: true,
      dvicCheck: true,
      dvicShowTransporters: true,
      workingHours: true,
      returnsDashboard: true,
      scorecard: true,
      vsaQr: true
    }
  };
  var CONFIG_KEY = "ct_config";
  function getConfig() {
    const raw = GM_getValue(CONFIG_KEY, null);
    if (!raw)
      return JSON.parse(JSON.stringify(DEFAULTS));
    try {
      const saved = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        ...DEFAULTS,
        ...saved,
        features: { ...DEFAULTS.features, ...saved.features || {} },
        deliveryPerfStation: saved.deliveryPerfStation || DEFAULTS.deliveryPerfStation,
        deliveryPerfDsp: saved.deliveryPerfDsp || DEFAULTS.deliveryPerfDsp
      };
    } catch {
      return JSON.parse(JSON.stringify(DEFAULTS));
    }
  }
  function setConfig(cfg) {
    GM_setValue(CONFIG_KEY, JSON.stringify(cfg));
  }

  // src/core/utils.ts
  var LOG_PREFIX = "[CortexTools]";
  var DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  var API_URL = "https://logistics.amazon.de/scheduling/home/api/v2/associate-attributes";
  var _config = null;
  function initLogging(config) {
    _config = config;
  }
  var log = (...args) => {
    if (_config == null ? void 0 : _config.dev)
      console.log(LOG_PREFIX, ...args);
  };
  var err = (...args) => {
    console.error(LOG_PREFIX, ...args);
  };
  var _disposers = [];
  function onDispose(fn) {
    _disposers.push(fn);
    return fn;
  }
  function disposeAll() {
    while (_disposers.length) {
      try {
        _disposers.pop()();
      } catch {
      }
    }
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function waitForElement(selector, { timeout = 15e3 } = {}) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el)
        return resolve(el);
      const obs = new MutationObserver(() => {
        const el2 = document.querySelector(selector);
        if (el2) {
          obs.disconnect();
          resolve(el2);
        }
      });
      obs.observe(document, { childList: true, subtree: true });
      if (timeout) {
        setTimeout(() => {
          obs.disconnect();
          reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);
      }
    });
  }
  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  async function withRetry(fn, { retries = 3, baseMs = 500 } = {}) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (e) {
        if (++attempt > retries)
          throw e;
        await delay(baseMs * 2 ** (attempt - 1));
      }
    }
  }
  function getCSRFToken() {
    const meta = document.querySelector('meta[name="anti-csrftoken-a2z"]');
    if (meta)
      return meta.getAttribute("content");
    const cookies = document.cookie.split(";");
    for (const c of cookies) {
      const [k, v] = c.trim().split("=");
      if (k === "anti-csrftoken-a2z")
        return v;
    }
    return null;
  }
  function extractSessionFromCookie() {
    const m = document.cookie.match(/session-id=([^;]+)/);
    return m ? m[1] : null;
  }
  function todayStr() {
    return (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  }
  function addDays(dateStr, n) {
    const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().split("T")[0];
  }

  // src/core/api.ts
  var CompanyConfig = class {
    constructor(config) {
      this.config = config;
    }
    _loaded = false;
    _loading = null;
    _serviceAreas = [];
    _dspCode = null;
    _defaultStation = null;
    _defaultServiceAreaId = null;
    /**
     * Load service areas and auto-detect DSP. Safe to call multiple times —
     * subsequent calls return the same promise.
     */
    async load() {
      if (this._loaded)
        return;
      if (this._loading)
        return this._loading;
      this._loading = this._doLoad();
      await this._loading;
      this._loaded = true;
      this._loading = null;
    }
    async _doLoad() {
      var _a, _b, _c, _d;
      try {
        const resp = await fetch(
          "https://logistics.amazon.de/account-management/data/get-company-service-areas",
          { credentials: "include" }
        );
        const json = await resp.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          this._serviceAreas = json.data;
          this._defaultServiceAreaId = json.data[0].serviceAreaId;
          this._defaultStation = json.data[0].stationCode;
          log("Loaded", json.data.length, "service areas");
        }
      } catch (e) {
        err("Failed to load service areas:", e);
      }
      try {
        const resp = await fetch(
          "https://logistics.amazon.de/account-management/data/get-company-details",
          { credentials: "include" }
        );
        const json = await resp.json();
        const dsp = ((_a = json == null ? void 0 : json.data) == null ? void 0 : _a.dspShortCode) || ((_b = json == null ? void 0 : json.data) == null ? void 0 : _b.companyShortCode) || ((_c = json == null ? void 0 : json.data) == null ? void 0 : _c.shortCode) || (json == null ? void 0 : json.dspShortCode) || null;
        if (dsp) {
          this._dspCode = String(dsp).toUpperCase();
          log("Auto-detected DSP code:", this._dspCode);
        }
      } catch {
        log("Company details not available, will detect DSP from performance data");
      }
      if (!this._dspCode) {
        try {
          const navEl = document.querySelector(
            '[data-testid="company-name"], .company-name, .dsp-name'
          );
          if (navEl) {
            const text = ((_d = navEl.textContent) == null ? void 0 : _d.trim()) ?? "";
            if (text && text.length <= 10) {
              this._dspCode = text.toUpperCase();
              log("DSP code from page element:", this._dspCode);
            }
          }
        } catch {
        }
      }
      if (!this._dspCode) {
        this._dspCode = this.config.deliveryPerfDsp || DEFAULTS.deliveryPerfDsp;
        log("Using saved DSP code:", this._dspCode);
      }
      if (!this._defaultStation) {
        this._defaultStation = this.config.deliveryPerfStation || DEFAULTS.deliveryPerfStation;
      }
      if (!this._defaultServiceAreaId) {
        this._defaultServiceAreaId = this.config.serviceAreaId || DEFAULTS.serviceAreaId;
      }
    }
    getServiceAreas() {
      return this._serviceAreas;
    }
    getDspCode() {
      return this._dspCode || this.config.deliveryPerfDsp || DEFAULTS.deliveryPerfDsp;
    }
    getDefaultStation() {
      return this._defaultStation || this.config.deliveryPerfStation || DEFAULTS.deliveryPerfStation;
    }
    getDefaultServiceAreaId() {
      return this._defaultServiceAreaId || this.config.serviceAreaId || DEFAULTS.serviceAreaId;
    }
    /**
     * Build a service area `<option>` list for `<select>` elements.
     */
    buildSaOptions(selectedId) {
      if (this._serviceAreas.length === 0) {
        const fallback = selectedId || this.getDefaultServiceAreaId();
        return `<option value="${esc(fallback)}">${esc(this.getDefaultStation())}</option>`;
      }
      const sel = selectedId || this.getDefaultServiceAreaId();
      return this._serviceAreas.map((sa) => {
        const selected = sa.serviceAreaId === sel ? " selected" : "";
        return `<option value="${esc(sa.serviceAreaId)}"${selected}>${esc(sa.stationCode)}</option>`;
      }).join("");
    }
    populateSaSelect(selectEl, selectedId) {
      if (!selectEl)
        return;
      selectEl.innerHTML = this.buildSaOptions(selectedId);
    }
  };

  // src/ui/styles.ts
  var CSS_BASE = `
  /* \u2500\u2500 Root Variables \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

  /* \u2500\u2500 Navbar Divider \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-divider {
    border-top: 1px solid var(--ct-border);
    margin: 4px 0;
    padding: 0 !important;
    list-style: none;
  }

  /* \u2500\u2500 Overlays \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-overlay {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.6); z-index: 100000; display: none;
    justify-content: center; align-items: flex-start; padding-top: 40px;
  }
  .ct-overlay.visible { display: flex; }

  /* \u2500\u2500 Panels / Dialogs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

  /* \u2500\u2500 Controls Row \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-controls {
    display: flex; gap: 10px; align-items: center;
    flex-wrap: wrap; margin-bottom: 16px;
  }

  /* \u2500\u2500 Inputs / Selects \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-input, .ct-select {
    padding: 8px 12px; border-radius: 5px; border: 1px solid #ccc;
    font-size: 13px; font-family: var(--ct-font);
  }
  .ct-input:focus, .ct-select:focus {
    outline: none; border-color: var(--ct-accent);
    box-shadow: 0 0 0 2px rgba(255,153,0,0.2);
  }
  .ct-input--full { width: 100%; box-sizing: border-box; }

  /* \u2500\u2500 Buttons \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

  /* \u2500\u2500 Tables \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

  /* \u2500\u2500 Status Classes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-ok { color: var(--ct-success); font-weight: bold; }
  .ct-warn { color: var(--ct-warning); font-weight: bold; }
  .ct-danger { color: var(--ct-danger); font-weight: bold; }
  .ct-breach { background: #ffe0e0 !important; }
  .ct-nodata { color: #aaa; }

  /* \u2500\u2500 Status Bar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-status {
    padding: 8px; margin-bottom: 10px; font-style: italic;
    color: var(--ct-muted);
  }

  /* \u2500\u2500 Progress \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-progress {
    background: #f0f0f0; height: 20px; border-radius: 10px;
    overflow: hidden;
  }
  .ct-progress__fill {
    background: var(--ct-info); height: 100%; width: 0%;
    transition: width 0.3s; border-radius: 10px;
  }

  /* \u2500\u2500 Settings \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

  /* \u2500\u2500 Batch result items \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
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

  /* \u2500\u2500 History table \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-history-table { width: 100%; border-collapse: collapse; }
  .ct-history-table th, .ct-history-table td {
    border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px;
  }
  .ct-history-table th { background: var(--ct-info); color: white; }
  .ct-history-success { color: var(--ct-success); }
  .ct-history-partial { color: var(--ct-warning); }
  .ct-history-failure { color: var(--ct-danger); }

  /* \u2500\u2500 Responsive \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  @media (max-width: 768px) {
    .ct-panel, .ct-dialog { min-width: unset; width: 95vw; }
  }
`;
  var CSS_DELIVERY_PERF = `
  /* \u2500\u2500 Delivery Performance Dashboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-dp-panel {
    background: var(--ct-bg); border-radius: var(--ct-radius-lg);
    padding: 24px; max-width: 1200px; width: 95vw; max-height: 92vh;
    overflow-y: auto; box-shadow: var(--ct-shadow-heavy);
    font-family: var(--ct-font);
  }
  .ct-dp-panel h2 { margin: 0 0 16px; color: var(--ct-primary); }

  .ct-dp-badges {
    display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px;
  }
  .ct-dp-badge {
    background: var(--ct-primary); color: var(--ct-accent);
    border-radius: 12px; padding: 3px 10px; font-size: 11px;
    font-weight: bold; white-space: nowrap;
  }
  .ct-dp-badge span { color: var(--ct-text-light); font-weight: normal; margin-left: 4px; }

  .ct-dp-record {
    border: 1px solid var(--ct-border); border-radius: var(--ct-radius);
    margin-bottom: 20px; overflow: hidden;
  }
  .ct-dp-record-header {
    background: var(--ct-primary); color: var(--ct-text-light);
    padding: 8px 14px; font-weight: bold; font-size: 13px;
    display: flex; align-items: center; gap: 10px;
  }
  .ct-dp-record-body {
    padding: 14px; display: grid;
    grid-template-columns: 1fr 1fr; gap: 14px;
  }
  @media (max-width: 900px) {
    .ct-dp-record-body { grid-template-columns: 1fr; }
  }

  .ct-dp-section-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--ct-muted); margin: 0 0 8px; font-weight: bold;
  }

  .ct-dp-count-table {
    width: 100%; border-collapse: collapse; font-size: 12px;
  }
  .ct-dp-count-table td {
    padding: 3px 6px; border-bottom: 1px solid #f0f0f0; vertical-align: middle;
  }
  .ct-dp-count-table td:first-child { color: #555; font-size: 11px; width: 65%; }
  .ct-dp-count-table td:last-child { text-align: right; font-weight: bold; }

  .ct-dp-rates { display: flex; flex-direction: column; gap: 6px; }
  .ct-dp-rate-row { display: flex; align-items: center; gap: 8px; }
  .ct-dp-rate-label { font-size: 11px; color: #555; flex: 1 1 60%; }
  .ct-dp-rate-value {
    font-weight: bold; font-size: 12px; text-align: right;
    white-space: nowrap; min-width: 60px;
  }
  .ct-dp-rate-bar-wrap {
    flex: 0 0 60px; height: 6px; background: #eee;
    border-radius: 3px; overflow: hidden;
  }
  .ct-dp-rate-bar { height: 100%; border-radius: 3px; }

  .ct-dp-rate--great { color: var(--ct-success); }
  .ct-dp-rate--bar--great { background: var(--ct-success); }
  .ct-dp-rate--ok { color: var(--ct-warning); }
  .ct-dp-rate--bar--ok { background: var(--ct-warning); }
  .ct-dp-rate--bad { color: var(--ct-danger); }
  .ct-dp-rate--bar--bad { background: var(--ct-danger); }
  .ct-dp-rate--neutral { color: var(--ct-info); }
  .ct-dp-rate--bar--neutral { background: var(--ct-info); }

  .ct-dp-ts-row {
    display: flex; gap: 20px; flex-wrap: wrap; font-size: 12px;
    padding: 8px 0; border-top: 1px solid #f0f0f0; margin-top: 4px;
  }
  .ct-dp-ts-item { display: flex; flex-direction: column; gap: 2px; }
  .ct-dp-ts-label { font-size: 10px; color: var(--ct-muted); text-transform: uppercase; }
  .ct-dp-ts-val { font-weight: bold; }

  .ct-dp-tiles {
    display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px;
  }
  .ct-dp-tile {
    background: #f7f8fa; border: 1px solid #e0e0e0;
    border-radius: var(--ct-radius); padding: 10px 16px;
    text-align: center; min-width: 90px; flex: 1 1 90px;
  }
  .ct-dp-tile-val {
    font-size: 20px; font-weight: bold; color: var(--ct-primary); line-height: 1.2;
  }
  .ct-dp-tile-lbl { font-size: 10px; color: var(--ct-muted); margin-top: 2px; }
  .ct-dp-tile--success .ct-dp-tile-val { color: var(--ct-success); }
  .ct-dp-tile--warn .ct-dp-tile-val { color: var(--ct-warning); }
  .ct-dp-tile--danger .ct-dp-tile-val { color: var(--ct-danger); }

  .ct-dp-loading {
    text-align: center; padding: 40px; color: var(--ct-muted); font-style: italic;
  }
  .ct-dp-error {
    background: #fff0f0; border: 1px solid #ffcccc;
    border-radius: var(--ct-radius); padding: 14px;
    color: var(--ct-danger); font-size: 13px;
  }
  .ct-dp-empty { text-align: center; padding: 30px; color: var(--ct-muted); }
  .ct-dp-full-col { grid-column: 1 / -1; }
`;
  var CSS_DVIC = `
  /* \u2500\u2500 DVIC Check \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-dvic-panel {
    background: var(--ct-bg); border-radius: var(--ct-radius-lg);
    padding: 24px; max-width: 1100px; width: 95vw; max-height: 92vh;
    overflow-y: auto; box-shadow: var(--ct-shadow-heavy);
    font-family: var(--ct-font);
  }
  .ct-dvic-panel h2 { margin: 0; color: var(--ct-primary); }

  .ct-dvic-tabs {
    display: flex; gap: 0; margin-bottom: 16px;
    border-bottom: 2px solid var(--ct-border);
  }
  .ct-dvic-tab {
    padding: 8px 18px; cursor: pointer; font-size: 13px; font-weight: bold;
    border: none; background: none; color: var(--ct-muted);
    font-family: var(--ct-font); border-bottom: 3px solid transparent;
    margin-bottom: -2px; transition: color 0.15s;
  }
  .ct-dvic-tab:hover { color: var(--ct-primary); }
  .ct-dvic-tab--active { color: var(--ct-primary); border-bottom-color: var(--ct-accent); }

  .ct-dvic-tiles {
    display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
  }
  .ct-dvic-tile {
    background: #f7f8fa; border: 1px solid #e0e0e0;
    border-radius: var(--ct-radius); padding: 10px 18px;
    text-align: center; flex: 1 1 100px; min-width: 90px;
  }
  .ct-dvic-tile-val {
    font-size: 22px; font-weight: bold; color: var(--ct-primary); line-height: 1.2;
  }
  .ct-dvic-tile-lbl { font-size: 10px; color: var(--ct-muted); margin-top: 2px; }
  .ct-dvic-tile--ok   .ct-dvic-tile-val { color: var(--ct-success); }
  .ct-dvic-tile--warn .ct-dvic-tile-val { color: var(--ct-warning); }
  .ct-dvic-tile--danger .ct-dvic-tile-val { color: var(--ct-danger); }

  .ct-dvic-badge--ok {
    background: #d4edda; color: var(--ct-success);
    border-radius: 10px; padding: 2px 8px; font-size: 11px; font-weight: bold;
  }
  .ct-dvic-badge--missing {
    background: #ffe0e0; color: var(--ct-danger);
    border-radius: 10px; padding: 2px 8px; font-size: 11px; font-weight: bold;
  }

  .ct-dvic-row--missing { background: #fff8f0 !important; }
  .ct-dvic-row--missing:hover { background: #fff0d6 !important; }

  .ct-dvic-expand-btn {
    background: none; border: 1px solid var(--ct-border); border-radius: 3px;
    cursor: pointer; font-size: 11px; padding: 1px 6px; color: var(--ct-info);
    font-family: var(--ct-font);
  }
  .ct-dvic-expand-btn:hover { background: #e7f3ff; }

  .ct-dvic-detail-row { display: none; }
  .ct-dvic-detail-row.visible { display: table-row; }
  .ct-dvic-detail-cell {
    background: #f4f8ff !important; padding: 8px 16px !important;
    font-size: 12px; text-align: left !important;
  }

  .ct-dvic-pagination {
    display: flex; align-items: center; gap: 10px;
    margin-top: 12px; justify-content: center; font-size: 13px;
  }
  .ct-dvic-page-info { color: var(--ct-muted); }

  .ct-dvic-error {
    background: #fff0f0; border: 1px solid #ffcccc;
    border-radius: var(--ct-radius); padding: 14px;
    color: var(--ct-danger); font-size: 13px; line-height: 1.6;
  }
  .ct-dvic-empty { text-align: center; padding: 30px; color: var(--ct-muted); }
  .ct-dvic-loading {
    text-align: center; padding: 40px; color: var(--ct-muted); font-style: italic;
  }

  /* \u2500\u2500 Transporter column \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-dvic-toolbar {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 8px; flex-wrap: wrap;
  }
  .ct-dvic-tp-toggle {
    font-size: 11px; padding: 3px 10px;
    border: 1px solid var(--ct-border); border-radius: 4px;
    background: #f7f8fa; cursor: pointer; color: var(--ct-primary);
    font-family: var(--ct-font);
  }
  .ct-dvic-tp-toggle:hover { background: #e7f3ff; }
  .ct-dvic-tp-toggle[aria-pressed="true"] { background: #e7f3ff; border-color: var(--ct-info); }

  .ct-dvic-tp-th {
    min-width: 140px; max-width: 260px;
  }
  .ct-dvic-tp-cell {
    font-size: 12px; color: var(--ct-primary);
    white-space: normal; word-break: break-word;
    max-width: 260px; min-width: 120px;
  }
  .ct-dvic-tp-primary { font-weight: 500; }
  .ct-dvic-tp-secondary { color: var(--ct-muted); font-weight: normal; }
  .ct-dvic-tp-unknown { color: var(--ct-muted); font-style: italic; font-size: 11px; }

  @media (max-width: 680px) {
    .ct-dvic-table { display: block; overflow-x: auto; }
    .ct-dvic-tp-cell { display: block; max-width: 100%; }
  }
`;
  var CSS_WORKING_HOURS = `
  /* \u2500\u2500 Working Hours Dashboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-whd-panel {
    background: var(--ct-bg); border-radius: var(--ct-radius-lg);
    padding: 24px; max-width: 1400px; width: 95vw; max-height: 92vh;
    overflow-y: auto; box-shadow: var(--ct-shadow-heavy);
    font-family: var(--ct-font);
  }
  .ct-whd-panel h2 { margin: 0 0 16px; color: var(--ct-primary); }

  .ct-whd-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  .ct-whd-table tr[data-itinerary-id] { cursor: pointer; }
  .ct-whd-table tr[data-itinerary-id]:hover { background: #fff3d6 !important; }
  .ct-whd-table tr[data-itinerary-id]:focus {
    outline: 2px solid var(--ct-accent); outline-offset: -2px;
  }

  .ct-whd-table th[data-sort] {
    cursor: pointer; user-select: none; position: relative;
  }
  .ct-whd-table th[data-sort]:hover { background: #37475a; }

  .ct-whd-table th[data-sort="driverName"],
  .ct-whd-table td.ct-whd-driver {
    min-width: 180px; width: 180px; text-align: center;
  }
  .ct-whd-sort-icon {
    font-size: 10px; margin-left: 3px; opacity: 0.7;
  }

  .ct-whd-empty, .ct-whd-loading {
    text-align: center; padding: 40px; color: var(--ct-muted);
    font-style: italic;
  }
  .ct-whd-error {
    background: #fff0f0; border: 1px solid #ffcccc;
    border-radius: var(--ct-radius); padding: 14px;
    color: var(--ct-danger); font-size: 13px;
  }

  .ct-whd-detail-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px solid #eee;
  }
  .ct-whd-detail-row:last-child { border-bottom: none; }
  .ct-whd-detail-label { font-size: 12px; color: var(--ct-muted); }
  .ct-whd-detail-value { font-weight: bold; font-size: 13px; }
  .ct-whd-copy-btn {
    padding: 3px 8px; font-size: 11px; border: 1px solid var(--ct-border);
    border-radius: 3px; background: #f7f8fa; cursor: pointer;
    font-family: var(--ct-font); color: var(--ct-info);
  }
  .ct-whd-copy-btn:hover { background: #e7f3ff; }

  .ct-whd-pagination {
    display: flex; align-items: center; gap: 10px;
    margin-top: 12px; justify-content: center; font-size: 13px;
  }
  .ct-whd-page-info { color: var(--ct-muted); }

  @media (max-width: 768px) {
    .ct-whd-panel { min-width: unset; width: 95vw; padding: 16px; }
  }
`;
  var CSS_RETURNS = `
  /* \u2500\u2500 Returns Dashboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-ret-panel {
    background: var(--ct-bg); border-radius: var(--ct-radius-lg);
    padding: 24px; max-width: 1400px; width: 95vw; max-height: 92vh;
    overflow-y: auto; box-shadow: var(--ct-shadow-heavy);
    font-family: var(--ct-font);
  }
  .ct-ret-panel h2 { margin: 0 0 16px; color: var(--ct-primary); }

  .ct-ret-controls {
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    margin-bottom: 16px; padding: 12px; background: #f7f8fa;
    border-radius: var(--ct-radius);
  }
  .ct-ret-controls label { font-size: 13px; font-weight: 500; color: #333; }
  .ct-ret-controls .ct-input, .ct-ret-controls .ct-select {
    padding: 6px 10px; font-size: 13px;
  }

  .ct-ret-filters {
    display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;
  }
  .ct-ret-search {
    flex: 1 1 200px; min-width: 150px;
  }
  .ct-ret-filter-group {
    display: flex; align-items: center; gap: 6px;
  }
  .ct-ret-filter-group label { font-size: 12px; color: var(--ct-muted); }

  .ct-ret-sort-bar {
    display: flex; gap: 10px; align-items: center; margin-bottom: 12px;
    font-size: 12px;
  }
  .ct-ret-sort-bar select { padding: 4px 8px; font-size: 12px; }

  .ct-ret-view-toggle {
    display: flex; gap: 4px; margin-left: auto;
  }
  .ct-ret-view-toggle button {
    padding: 4px 10px; font-size: 11px; border: 1px solid var(--ct-border);
    background: #f7f8fa; cursor: pointer; border-radius: 3px;
    font-family: var(--ct-font);
  }
  .ct-ret-view-toggle button:hover { background: #e7f3ff; }
  .ct-ret-view-toggle button.active { background: var(--ct-info); color: white; border-color: var(--ct-info); }

  .ct-ret-table-wrap {
    overflow-x: auto; -webkit-overflow-scrolling: touch;
  }
  .ct-ret-table {
    width: 100%; border-collapse: collapse; font-size: 12px;
    font-family: var(--ct-font);
  }
  .ct-ret-table th, .ct-ret-table td {
    border: 1px solid var(--ct-border); padding: 6px 8px;
    text-align: left; white-space: nowrap;
  }
  .ct-ret-table th {
    background: var(--ct-info); color: white;
    position: sticky; top: 0; z-index: 1;
  }
  .ct-ret-table tr:nth-child(even) { background: #f9f9f9; }
  .ct-ret-table tr:hover { background: #fff3d6; }
  .ct-ret-table td { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }

  .ct-ret-cards {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 12px;
  }
  .ct-ret-card {
    background: #fff; border: 1px solid var(--ct-border);
    border-radius: var(--ct-radius); padding: 14px;
    transition: box-shadow 0.15s;
  }
  .ct-ret-card:hover { box-shadow: var(--ct-shadow); }
  .ct-ret-card-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 10px;
  }
  .ct-ret-card-id {
    font-weight: bold; font-size: 14px; color: var(--ct-primary);
    word-break: break-all;
  }
  .ct-ret-card-reason {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    font-weight: bold; white-space: nowrap;
  }
  .ct-ret-card-reason--ok { background: #d4edda; color: var(--ct-success); }
  .ct-ret-card-reason--warn { background: #fff3cd; color: var(--ct-warning); }
  .ct-ret-card-reason--error { background: #f8d7da; color: var(--ct-danger); }

  .ct-ret-card-row {
    display: flex; justify-content: space-between; font-size: 12px;
    padding: 4px 0; border-bottom: 1px solid #f0f0f0;
  }
  .ct-ret-card-row:last-child { border-bottom: none; }
  .ct-ret-card-label { color: var(--ct-muted); }
  .ct-ret-card-value { font-weight: 500; color: #333; text-align: right; }

  .ct-ret-card-address {
    font-size: 12px; color: #555; margin-top: 8px; padding-top: 8px;
    border-top: 1px solid #eee; line-height: 1.4;
  }
  .ct-ret-card-map {
    display: inline-block; margin-top: 8px; font-size: 11px;
    color: var(--ct-info); text-decoration: none;
  }
  .ct-ret-card-map:hover { text-decoration: underline; }

  .ct-ret-pagination {
    display: flex; align-items: center; justify-content: center; gap: 12px;
    margin-top: 20px; font-size: 13px;
  }
  .ct-ret-page-info { color: var(--ct-muted); }

  .ct-ret-loading, .ct-ret-empty, .ct-ret-error {
    text-align: center; padding: 40px; color: var(--ct-muted);
    font-style: italic;
  }
  .ct-ret-error {
    background: #fff0f0; border: 1px solid #ffcccc;
    border-radius: var(--ct-radius); padding: 14px; color: var(--ct-danger);
    font-style: normal;
  }

  .ct-ret-stats {
    display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
  }
  .ct-ret-stat {
    background: #f7f8fa; border: 1px solid #e0e0e0;
    border-radius: var(--ct-radius); padding: 8px 14px;
    text-align: center; flex: 1 1 80px; min-width: 70px;
  }
  .ct-ret-stat-val { font-size: 18px; font-weight: bold; color: var(--ct-primary); }
  .ct-ret-stat-lbl { font-size: 10px; color: var(--ct-muted); margin-top: 2px; }
`;
  var CSS_SCORECARD = `
  /* \u2500\u2500 Scorecard Dashboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-sc-panel {
    background: var(--ct-bg); border-radius: var(--ct-radius-lg);
    padding: 24px; max-width: 1400px; width: 95vw; max-height: 92vh;
    overflow-y: auto; box-shadow: var(--ct-shadow-heavy);
    font-family: var(--ct-font);
  }
  .ct-sc-panel h2 { margin: 0 0 16px; color: var(--ct-primary); }

  .ct-sc-tiles {
    display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
  }
  .ct-sc-tile {
    background: #f7f8fa; border: 1px solid #e0e0e0;
    border-radius: var(--ct-radius); padding: 10px 18px;
    text-align: center; flex: 1 1 100px; min-width: 90px;
  }
  .ct-sc-tile-val {
    font-size: 22px; font-weight: bold; color: var(--ct-primary); line-height: 1.2;
  }
  .ct-sc-tile-lbl { font-size: 10px; color: var(--ct-muted); margin-top: 2px; }
  .ct-sc-tile--fantastic .ct-sc-tile-val { color: rgb(77, 115, 190); }
  .ct-sc-tile--great .ct-sc-tile-val { color: var(--ct-success); }
  .ct-sc-tile--fair .ct-sc-tile-val { color: var(--ct-warning); }
  .ct-sc-tile--poor .ct-sc-tile-val { color: var(--ct-danger); }

  .ct-sc-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .ct-sc-table {
    width: 100%; border-collapse: collapse; font-size: 12px;
    font-family: var(--ct-font);
  }
  .ct-sc-table th, .ct-sc-table td {
    border: 1px solid var(--ct-border); padding: 6px 8px;
    text-align: center; white-space: nowrap;
  }
  .ct-sc-table th {
    background: var(--ct-primary); color: var(--ct-accent);
    position: sticky; top: 0; z-index: 1; cursor: pointer; user-select: none;
  }
  .ct-sc-table th:hover { background: #37475a; }
  .ct-sc-table tr:nth-child(even) { background: #f9f9f9; }
  .ct-sc-table tr:hover { background: #fff3d6; }

  .ct-sc-status--poor { color: rgb(235, 50, 35); font-weight: bold; }
  .ct-sc-status--fair { color: rgb(223, 130, 68); font-weight: bold; }
  .ct-sc-status--great { color: rgb(126, 170, 85); font-weight: bold; }
  .ct-sc-status--fantastic { color: rgb(77, 115, 190); font-weight: bold; }

  .ct-sc-color--poor { color: rgb(235, 50, 35); }
  .ct-sc-color--fair { color: rgb(223, 130, 68); }
  .ct-sc-color--great { color: rgb(126, 170, 85); }
  .ct-sc-color--fantastic { color: rgb(77, 115, 190); }

  .ct-sc-loading, .ct-sc-empty, .ct-sc-error {
    text-align: center; padding: 40px; color: var(--ct-muted); font-style: italic;
  }
  .ct-sc-error {
    background: #fff0f0; border: 1px solid #ffcccc;
    border-radius: var(--ct-radius); padding: 14px; color: var(--ct-danger);
    font-style: normal;
  }

  .ct-sc-pagination {
    display: flex; align-items: center; justify-content: center; gap: 12px;
    margin-top: 12px; font-size: 13px;
  }
  .ct-sc-page-info { color: var(--ct-muted); }

  .ct-sc-week-selector {
    display: flex; gap: 8px; align-items: center;
  }
`;
  var CSS_VSA_QR = `
  /* \u2500\u2500 VSA QR Code Generator \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
  .ct-vsa-panel {
    background: var(--ct-bg); border-radius: var(--ct-radius-lg);
    padding: 24px; max-width: 1200px; width: 95vw; max-height: 92vh;
    overflow-y: auto; box-shadow: var(--ct-shadow-heavy);
    font-family: var(--ct-font);
  }
  .ct-vsa-panel h2 { margin: 0; color: var(--ct-primary); }

  .ct-vsa-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px;
  }

  .ct-vsa-toolbar {
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .ct-vsa-search {
    flex: 1 1 250px; min-width: 200px; padding: 8px 12px;
    border-radius: 5px; border: 1px solid #ccc; font-size: 13px;
    font-family: var(--ct-font);
  }
  .ct-vsa-search:focus {
    outline: none; border-color: var(--ct-accent);
    box-shadow: 0 0 0 2px rgba(255,153,0,0.2);
  }
  .ct-vsa-selection-info {
    font-size: 12px; color: var(--ct-muted); white-space: nowrap;
  }

  .ct-vsa-tiles {
    display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px;
  }
  .ct-vsa-tile {
    background: #f7f8fa; border: 1px solid #e0e0e0;
    border-radius: var(--ct-radius); padding: 10px 18px;
    text-align: center; flex: 1 1 100px; min-width: 90px;
  }
  .ct-vsa-tile-val {
    font-size: 22px; font-weight: bold; color: var(--ct-primary); line-height: 1.2;
  }
  .ct-vsa-tile-lbl { font-size: 10px; color: var(--ct-muted); margin-top: 2px; }
  .ct-vsa-tile--accent .ct-vsa-tile-val { color: var(--ct-accent); }

  .ct-vsa-table-wrap {
    overflow-x: auto; -webkit-overflow-scrolling: touch;
    max-height: 50vh; overflow-y: auto;
  }

  .ct-vsa-table {
    width: 100%; border-collapse: collapse; font-size: 12px;
    font-family: var(--ct-font);
  }
  .ct-vsa-table th, .ct-vsa-table td {
    border: 1px solid var(--ct-border); padding: 6px 8px;
    text-align: center; white-space: nowrap;
  }
  .ct-vsa-table th {
    background: var(--ct-primary); color: var(--ct-accent);
    position: sticky; top: 0; z-index: 1;
  }
  .ct-vsa-table tr:nth-child(even) { background: #f9f9f9; }
  .ct-vsa-table tr:hover { background: #fff3d6; }
  .ct-vsa-th-check, .ct-vsa-td-check { width: 36px; text-align: center; }
  .ct-vsa-td-vin { font-family: monospace; font-size: 11px; letter-spacing: 0.5px; }

  .ct-vsa-row--selected { background: #fff8e1 !important; }
  .ct-vsa-row--selected:hover { background: #fff3cd !important; }

  .ct-vsa-status--active { color: var(--ct-success); font-weight: bold; font-size: 11px; }
  .ct-vsa-status--maintenance { color: var(--ct-warning); font-weight: bold; font-size: 11px; }
  .ct-vsa-status--pending { color: var(--ct-info); font-weight: bold; font-size: 11px; }

  .ct-vsa-pagination {
    display: flex; align-items: center; gap: 10px;
    margin-top: 12px; justify-content: center; font-size: 13px;
  }
  .ct-vsa-page-info { color: var(--ct-muted); }

  .ct-vsa-footer {
    display: flex; align-items: center; gap: 12px;
    margin-top: 16px; padding-top: 16px;
    border-top: 1px solid var(--ct-border);
  }
  .ct-vsa-selection-badge {
    font-size: 12px; color: var(--ct-muted); font-weight: 500;
  }

  .ct-vsa-loading, .ct-vsa-empty {
    text-align: center; padding: 40px; color: var(--ct-muted); font-style: italic;
  }
  .ct-vsa-error {
    background: #fff0f0; border: 1px solid #ffcccc;
    border-radius: var(--ct-radius); padding: 14px;
    color: var(--ct-danger); font-size: 13px;
  }

  @media (max-width: 768px) {
    .ct-vsa-panel { min-width: unset; width: 95vw; padding: 16px; }
    .ct-vsa-table-wrap { max-height: 40vh; }
  }
`;
  function injectStyles() {
    GM_addStyle(CSS_BASE);
    GM_addStyle(CSS_DELIVERY_PERF);
    GM_addStyle(CSS_DVIC);
    GM_addStyle(CSS_WORKING_HOURS);
    GM_addStyle(CSS_RETURNS);
    GM_addStyle(CSS_SCORECARD);
    GM_addStyle(CSS_VSA_QR);
  }

  // src/features/whc-dashboard.ts
  var WhcDashboard = class {
    constructor(config, companyConfig) {
      this.config = config;
      this.companyConfig = companyConfig;
    }
    _active = false;
    _overlayEl = null;
    _nameMap = {};
    _associates = [];
    _lastQueryResult = null;
    _lastQueryMode = null;
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    init() {
      if (this._overlayEl)
        return;
      const overlay = document.createElement("div");
      overlay.id = "ct-whc-overlay";
      overlay.className = "ct-overlay";
      overlay.innerHTML = `
      <div class="ct-panel">
        <h2>\u{1F4CA} DA WHC-Dashboard</h2>
        <div class="ct-controls">
          <label>Datum:</label>
          <input type="date" id="ct-whc-date" class="ct-input" value="${todayStr()}">
          <label for="ct-whc-sa">Service Area:</label>
          <select id="ct-whc-sa" class="ct-select" aria-label="Service Area">
            <option value="">Wird geladen\u2026</option>
          </select>
          <select id="ct-whc-mode" class="ct-select">
            <option value="day">Einzelner Tag</option>
            <option value="week">Ganze Woche (Mo\u2013So)</option>
          </select>
          <button class="ct-btn ct-btn--accent" id="ct-whc-go">\u{1F50D} Abfragen</button>
          <button class="ct-btn ct-btn--primary" id="ct-whc-export">\u{1F4CB} CSV Export</button>
          <button class="ct-btn ct-btn--close" id="ct-whc-close">\u2715 Schlie\xDFen</button>
        </div>
        <div id="ct-whc-status" class="ct-status"></div>
        <div id="ct-whc-result"></div>
      </div>
    `;
      document.body.appendChild(overlay);
      this._overlayEl = overlay;
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay)
          this.hide();
      });
      document.getElementById("ct-whc-close").addEventListener("click", () => this.hide());
      document.getElementById("ct-whc-go").addEventListener("click", () => this._runQuery());
      document.getElementById("ct-whc-export").addEventListener("click", () => this._exportCSV());
      this.companyConfig.load().then(() => {
        this.companyConfig.populateSaSelect(
          document.getElementById("ct-whc-sa")
        );
      });
      onDispose(() => this.dispose());
      log("WHC Dashboard initialized");
    }
    dispose() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.remove();
      this._overlayEl = null;
      this._active = false;
      this._nameMap = {};
      this._associates = [];
      this._lastQueryResult = null;
      this._lastQueryMode = null;
    }
    toggle() {
      if (!this.config.features.whcDashboard) {
        alert("WHC Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");
        return;
      }
      this.init();
      if (this._active)
        this.hide();
      else
        this.show();
    }
    show() {
      this.init();
      this._overlayEl.classList.add("visible");
      this._active = true;
    }
    hide() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.classList.remove("visible");
      this._active = false;
    }
    // ── Helpers ────────────────────────────────────────────────────────────────
    _resolveName(id) {
      return this._nameMap[id] || id;
    }
    _minsToHM(mins) {
      if (mins === null || mins === void 0 || mins === 0)
        return "-";
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m.toString().padStart(2, "0")}m`;
    }
    _minsClass(mins) {
      if (!mins || mins === 0)
        return "ct-nodata";
      if (mins > 600)
        return "ct-danger";
      if (mins > 540)
        return "ct-warn";
      return "ct-ok";
    }
    _getMonday(dateStr) {
      const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      return d.toISOString().split("T")[0];
    }
    _addDays(dateStr, n) {
      const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
      d.setDate(d.getDate() + n);
      return d.toISOString().split("T")[0];
    }
    // ── API ────────────────────────────────────────────────────────────────────
    _getSelectedSaId() {
      const sel = document.getElementById("ct-whc-sa");
      return sel && sel.value ? sel.value : this.companyConfig.getDefaultServiceAreaId();
    }
    async _fetchNames(fromDate, toDate) {
      const saId = this._getSelectedSaId();
      const url = `https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${fromDate}&serviceAreaId=${saId}&toDate=${toDate || fromDate}`;
      const csrf = getCSRFToken();
      const headers = { Accept: "application/json" };
      if (csrf)
        headers["anti-csrftoken-a2z"] = csrf;
      const resp = await fetch(url, { method: "GET", headers, credentials: "include" });
      if (!resp.ok)
        throw new Error(`Roster API Fehler ${resp.status}`);
      const json = await resp.json();
      const roster = Array.isArray(json) ? json : (json == null ? void 0 : json.data) || (json == null ? void 0 : json.rosters) || [];
      const ids = /* @__PURE__ */ new Set();
      const processEntries = (entries) => {
        for (const entry of entries) {
          if (entry["driverPersonId"]) {
            ids.add(entry["driverPersonId"]);
            if (entry["driverName"]) {
              this._nameMap[entry["driverPersonId"]] = entry["driverName"];
            }
          }
        }
      };
      if (Array.isArray(roster)) {
        processEntries(roster);
      } else if (typeof roster === "object") {
        for (const val of Object.values(roster)) {
          if (Array.isArray(val))
            processEntries(val);
        }
      }
      this._associates = [...ids];
      log(`${this._associates.length} Fahrer gefunden, ${Object.keys(this._nameMap).length} Namen geladen`);
    }
    async _fetchDay(date) {
      const payload = {
        associatesList: this._associates,
        date,
        mode: "daily",
        serviceAreaId: this._getSelectedSaId()
      };
      const csrf = getCSRFToken();
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json"
      };
      if (csrf)
        headers["anti-csrftoken-a2z"] = csrf;
      const resp = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        credentials: "include"
      });
      if (!resp.ok)
        throw new Error(`API Fehler ${resp.status} f\xFCr ${date}`);
      return resp.json();
    }
    // ── Data Processing ────────────────────────────────────────────────────────
    _extractDayData(json) {
      var _a;
      const result = {};
      const data = ((_a = json == null ? void 0 : json["data"]) == null ? void 0 : _a["daWorkSummaryAndEligibility"]) || {};
      for (const [id, entry] of Object.entries(data)) {
        const ws = entry == null ? void 0 : entry["workSummary"];
        if (!ws)
          continue;
        result[id] = {
          scheduledDay: ws["daScheduledDayMins"] || 0,
          actualDay: ws["daActualWorkDayMins"] || 0,
          scheduledWeek: ws["daScheduledWeekMins"] || 0,
          actualWeek: ws["daActualWorkWeekMins"] || 0,
          last7Days: ws["daScheduledLast7DaysMins"] || 0,
          breached: ws["isDailyLeapThresholdBreached"] || false
        };
      }
      return result;
    }
    // ── Rendering ──────────────────────────────────────────────────────────────
    _renderSingleDay(date, dayData) {
      const rows = Object.entries(dayData).sort((a, b) => b[1].actualDay - a[1].actualDay).map(([id, d]) => {
        const cls = d.breached ? "ct-breach" : "";
        return `<tr class="${cls}">
          <td title="${esc(id)}">${esc(this._resolveName(id))}</td>
          <td>${this._minsToHM(d.scheduledDay)}</td>
          <td class="${this._minsClass(d.actualDay)}">${this._minsToHM(d.actualDay)}</td>
          <td>${this._minsToHM(d.scheduledWeek)}</td>
          <td>${this._minsToHM(d.actualWeek)}</td>
          <td>${this._minsToHM(d.last7Days)}</td>
          <td>${d.breached ? "\u26A0\uFE0F JA" : "\u2705 Nein"}</td>
        </tr>`;
      }).join("");
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
    _renderWeek(weekData) {
      const dates = Object.keys(weekData).sort();
      const allIds = /* @__PURE__ */ new Set();
      for (const dd of Object.values(weekData)) {
        for (const id of Object.keys(dd))
          allIds.add(id);
      }
      const dayHeaders = dates.map((d, i) => `<th colspan="2">${esc(DAYS[i] ?? d)} (${esc(d.slice(5))})</th>`).join("");
      const subHeaders = dates.map(() => "<th>Geplant</th><th>Ist</th>").join("");
      const sortedRows = [...allIds].map((id) => {
        let totalActual = 0;
        let anyBreach = false;
        let weekActual = 0;
        const cells = dates.map((date) => {
          var _a;
          const d = (_a = weekData[date]) == null ? void 0 : _a[id];
          if (!d)
            return '<td class="ct-nodata">-</td><td class="ct-nodata">-</td>';
          totalActual += d.actualDay;
          if (d.breached)
            anyBreach = true;
          weekActual = d.actualWeek;
          return `<td>${this._minsToHM(d.scheduledDay)}</td>
                  <td class="${this._minsClass(d.actualDay)}">${this._minsToHM(d.actualDay)}</td>`;
        }).join("");
        const cls = anyBreach ? "ct-breach" : "";
        const row = `<tr class="${cls}">
          <td title="${esc(id)}">${esc(this._resolveName(id))}</td>
          ${cells}
          <td class="${this._minsClass(totalActual / dates.length)}">${this._minsToHM(totalActual)}</td>
          <td>${this._minsToHM(weekActual)}</td>
          <td>${anyBreach ? "\u26A0\uFE0F JA" : "\u2705"}</td>
        </tr>`;
        return { row, anyBreach, totalActual };
      }).sort((a, b) => {
        if (a.anyBreach !== b.anyBreach)
          return a.anyBreach ? -1 : 1;
        return b.totalActual - a.totalActual;
      }).map((r) => r.row).join("");
      return `
      <table class="ct-table">
        <thead>
          <tr>
            <th rowspan="2">Fahrer</th>
            ${dayHeaders}
            <th rowspan="2">\u03A3 Ist</th><th rowspan="2">API Woche</th><th rowspan="2">Breach</th>
          </tr>
          <tr>${subHeaders}</tr>
        </thead>
        <tbody>${sortedRows}</tbody>
      </table>
    `;
    }
    // ── Query ──────────────────────────────────────────────────────────────────
    async _runQuery() {
      const date = document.getElementById("ct-whc-date").value;
      const mode = document.getElementById("ct-whc-mode").value;
      const statusEl = document.getElementById("ct-whc-status");
      const resultEl = document.getElementById("ct-whc-result");
      if (!date) {
        statusEl.textContent = "\u26A0\uFE0F Bitte Datum ausw\xE4hlen!";
        return;
      }
      resultEl.innerHTML = "";
      this._lastQueryMode = mode;
      try {
        statusEl.textContent = "\u23F3 Lade Fahrer-Liste...";
        if (mode === "week") {
          const monday = this._getMonday(date);
          const sunday = this._addDays(monday, 6);
          await this._fetchNames(monday, sunday);
        } else {
          await this._fetchNames(date);
        }
        statusEl.textContent = `\u23F3 ${this._associates.length} Fahrer gefunden, lade Daten...`;
      } catch (e) {
        statusEl.textContent = `\u274C Roster-Fehler: ${e.message}`;
        err(e);
        return;
      }
      if (this._associates.length === 0) {
        statusEl.textContent = "\u26A0\uFE0F Keine Fahrer im Roster gefunden f\xFCr dieses Datum!";
        return;
      }
      if (mode === "day") {
        statusEl.textContent = `\u23F3 Lade Daten f\xFCr ${date}...`;
        try {
          const json = await this._fetchDay(date);
          const dayData = this._extractDayData(json);
          this._lastQueryResult = { [date]: dayData };
          resultEl.innerHTML = this._renderSingleDay(date, dayData);
          const count = Object.keys(dayData).length;
          const breaches = Object.values(dayData).filter((d) => d.breached).length;
          statusEl.textContent = `\u2705 ${count} Fahrer geladen | ${breaches} Threshold-Breaches | ${date}`;
        } catch (e) {
          statusEl.textContent = `\u274C Fehler: ${e.message}`;
          err(e);
        }
      } else {
        const monday = this._getMonday(date);
        const weekData = {};
        try {
          for (let i = 0; i < 7; i++) {
            const d = this._addDays(monday, i);
            statusEl.textContent = `\u23F3 Lade ${DAYS[i]} (${d})... (${i + 1}/7)`;
            try {
              const json = await this._fetchDay(d);
              weekData[d] = this._extractDayData(json);
            } catch (e) {
              console.warn(`Fehler f\xFCr ${d}:`, e);
              weekData[d] = {};
            }
            if (i < 6)
              await delay(500);
          }
          this._lastQueryResult = weekData;
          resultEl.innerHTML = this._renderWeek(weekData);
          let totalBreaches = 0;
          for (const dd of Object.values(weekData)) {
            for (const d of Object.values(dd)) {
              if (d.breached)
                totalBreaches++;
            }
          }
          statusEl.textContent = `\u2705 Woche ${monday} geladen | ${totalBreaches} Breach-Eintr\xE4ge`;
        } catch (e) {
          statusEl.textContent = `\u274C Fehler: ${e.message}`;
          err(e);
        }
      }
    }
    // ── CSV Export ─────────────────────────────────────────────────────────────
    _exportCSV() {
      var _a;
      if (!this._lastQueryResult) {
        alert("Bitte zuerst eine Abfrage starten!");
        return;
      }
      let csv = "";
      if (this._lastQueryMode === "day") {
        const date = Object.keys(this._lastQueryResult)[0];
        const data = this._lastQueryResult[date];
        csv = "Name;Associate ID;Geplant (Tag);Ist (Tag);Geplant (Woche);Ist (Woche);Letzten 7 Tage;Breach\n";
        for (const [id, d] of Object.entries(data)) {
          csv += `${this._resolveName(id)};${id};${d.scheduledDay};${d.actualDay};${d.scheduledWeek};${d.actualWeek};${d.last7Days};${d.breached}
`;
        }
      } else {
        const dates = Object.keys(this._lastQueryResult).sort();
        const allIds = /* @__PURE__ */ new Set();
        for (const dd of Object.values(this._lastQueryResult)) {
          for (const id of Object.keys(dd))
            allIds.add(id);
        }
        csv = "Name;Associate ID";
        for (const d of dates) {
          csv += `;${d} Geplant;${d} Ist`;
        }
        csv += ";Breach\n";
        for (const id of allIds) {
          csv += `${this._resolveName(id)};${id}`;
          let anyBreach = false;
          for (const date of dates) {
            const d = (_a = this._lastQueryResult[date]) == null ? void 0 : _a[id];
            csv += `;${(d == null ? void 0 : d.scheduledDay) || 0};${(d == null ? void 0 : d.actualDay) || 0}`;
            if (d == null ? void 0 : d.breached)
              anyBreach = true;
          }
          csv += `;${anyBreach}
`;
        }
      }
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arbeitszeiten_${this._lastQueryMode}_${Object.keys(this._lastQueryResult)[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // src/features/date-extractor.ts
  var DateRangeExtractor = class {
    constructor(config, companyConfig) {
      this.config = config;
      this.companyConfig = companyConfig;
    }
    _progress = { isRunning: false, current: 0, total: 0, dates: [], results: [] };
    _dialogEl = null;
    _progressEl = null;
    _resultsEl = null;
    _historyEl = null;
    init() {
    }
    dispose() {
      var _a, _b, _c, _d;
      this._stopExtraction();
      (_a = this._dialogEl) == null ? void 0 : _a.remove();
      this._dialogEl = null;
      (_b = this._progressEl) == null ? void 0 : _b.remove();
      this._progressEl = null;
      (_c = this._resultsEl) == null ? void 0 : _c.remove();
      this._resultsEl = null;
      (_d = this._historyEl) == null ? void 0 : _d.remove();
      this._historyEl = null;
    }
    // ── Date Range Dialog ──────────────────────────────────────────────────────
    showDialog() {
      var _a;
      if (!this.config.features.dateExtractor) {
        alert("Date Range Extractor ist deaktiviert. Bitte in den Einstellungen aktivieren.");
        return;
      }
      (_a = this._dialogEl) == null ? void 0 : _a.remove();
      this._dialogEl = null;
      const today = todayStr();
      const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
      const overlay = document.createElement("div");
      overlay.className = "ct-overlay visible";
      overlay.innerHTML = `
      <div class="ct-dialog">
        <h3>\u{1F4C5} Select Date Range</h3>
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
            <option value="">Wird geladen\u2026</option>
          </select>
        </div>
        <div class="ct-note-box">
          \u2139\uFE0F <strong>Note:</strong> Sundays will be automatically excluded from the range.
        </div>
        <div style="text-align: center; margin-top: 20px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
          <button class="ct-btn ct-btn--success" id="ct-dre-preview">\u{1F441}\uFE0F Preview Dates</button>
          <button class="ct-btn ct-btn--info" id="ct-dre-start-btn">\u{1F680} Start Extraction</button>
          <button class="ct-btn ct-btn--accent" id="ct-dre-history">\u{1F4C8} Batch History</button>
          <button class="ct-btn ct-btn--secondary" id="ct-dre-cancel">Cancel</button>
        </div>
        <div id="ct-dre-preview-area"></div>
      </div>
    `;
      document.body.appendChild(overlay);
      this._dialogEl = overlay;
      this.companyConfig.load().then(() => {
        this.companyConfig.populateSaSelect(
          document.getElementById("ct-dre-sa")
        );
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.remove();
          this._dialogEl = null;
        }
      });
      document.getElementById("ct-dre-preview").addEventListener("click", () => {
        const startDate = document.getElementById("ct-dre-start").value;
        const endDate = document.getElementById("ct-dre-end").value;
        if (!startDate || !endDate) {
          alert("Please select both start and end dates");
          return;
        }
        try {
          const dates = this._generateDateRange(startDate, endDate);
          document.getElementById("ct-dre-preview-area").innerHTML = `
          <div class="ct-info-box">
            <strong>\u{1F4CB} Dates to extract (${dates.length}):</strong><br>
            <div style="max-height: 150px; overflow-y: auto; margin-top: 5px; font-size: 12px;">
              ${esc(dates.join(", "))}
            </div>
          </div>`;
        } catch (error) {
          alert("Error: " + error.message);
        }
      });
      document.getElementById("ct-dre-start-btn").addEventListener("click", () => {
        const startDate = document.getElementById("ct-dre-start").value;
        const endDate = document.getElementById("ct-dre-end").value;
        const serviceAreaId = document.getElementById("ct-dre-sa").value;
        if (!startDate || !endDate) {
          alert("Please select both start and end dates");
          return;
        }
        if (!serviceAreaId.trim()) {
          alert("Bitte Service Area ausw\xE4hlen");
          return;
        }
        overlay.remove();
        this._dialogEl = null;
        this._extractDateRange(startDate, endDate, serviceAreaId.trim());
      });
      document.getElementById("ct-dre-history").addEventListener("click", () => {
        overlay.remove();
        this._dialogEl = null;
        this.showHistory();
      });
      document.getElementById("ct-dre-cancel").addEventListener("click", () => {
        overlay.remove();
        this._dialogEl = null;
      });
    }
    // ── Batch History ──────────────────────────────────────────────────────────
    showHistory() {
      var _a;
      (_a = this._historyEl) == null ? void 0 : _a.remove();
      this._historyEl = null;
      const batchIndex = JSON.parse(
        GM_getValue("batch_index", "[]")
      );
      if (batchIndex.length === 0) {
        alert("No batch history found");
        return;
      }
      const overlay = document.createElement("div");
      overlay.className = "ct-overlay visible";
      const rows = [...batchIndex].reverse().map((batch) => {
        const successRate = Math.round(batch.successCount / batch.totalCount * 100);
        const cls = successRate === 100 ? "ct-history-success" : successRate > 50 ? "ct-history-partial" : "ct-history-failure";
        return `
        <tr>
          <td>${esc(batch.startDate)} to ${esc(batch.endDate)}</td>
          <td>${esc(new Date(batch.timestamp).toLocaleString())}</td>
          <td class="${cls}">${batch.successCount}/${batch.totalCount} (${successRate}%)</td>
          <td>
            <button class="ct-btn ct-btn--info" data-ct-batch-download="${esc(batch.key)}">Download</button>
          </td>
        </tr>`;
      }).join("");
      overlay.innerHTML = `
      <div class="ct-panel" style="min-width:700px;">
        <h2>\u{1F4C8} Batch Extraction History</h2>
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
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.remove();
          this._historyEl = null;
        }
        const dlBtn = e.target.closest("[data-ct-batch-download]");
        if (dlBtn) {
          const key = dlBtn.getAttribute("data-ct-batch-download");
          this._downloadBatch(key);
        }
      });
      document.getElementById("ct-dre-history-close").addEventListener("click", () => {
        overlay.remove();
        this._historyEl = null;
      });
    }
    _downloadBatch(key) {
      try {
        const raw = GM_getValue(key, null);
        if (!raw) {
          alert("Batch data not found \u2014 it may have been removed.");
          return;
        }
        const data = typeof raw === "string" ? JSON.parse(raw) : raw;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `batch_${key}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        err("Download batch failed:", e);
        alert("Failed to download batch data.");
      }
    }
    // ── Extraction Core ────────────────────────────────────────────────────────
    async _extractDateRange(startDate, endDate, serviceAreaId) {
      const dates = this._generateDateRange(startDate, endDate);
      log(`Extracting data for ${dates.length} dates:`, dates);
      this._progress = { isRunning: true, current: 0, total: dates.length, dates, results: [] };
      this._updateProgressDisplay();
      for (let i = 0; i < dates.length; i++) {
        if (!this._progress.isRunning)
          break;
        const date = dates[i];
        this._progress.current = i + 1;
        try {
          log(`Extracting data for ${date} (${i + 1}/${dates.length})`);
          this._updateProgressDisplay();
          const data = await this._extractSingleDate(date, serviceAreaId);
          this._progress.results.push({ date, success: true, data, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          if (i < dates.length - 1)
            await delay(1e3 + Math.random() * 1e3);
        } catch (error) {
          err(`Failed for ${date}:`, error);
          this._progress.results.push({ date, success: false, error: error.message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
          await delay(2e3);
        }
      }
      this._progress.isRunning = false;
      this._updateProgressDisplay();
      log("Date range extraction completed");
      this._saveBatchResults(this._progress.results, startDate, endDate);
      this._showBatchResults(this._progress.results);
    }
    _extractSingleDate(localDate, serviceAreaId) {
      return new Promise((resolve, reject) => {
        const apiUrl = `https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${localDate}&serviceAreaId=${serviceAreaId}`;
        fetch(apiUrl, {
          method: "GET",
          credentials: "same-origin",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "de,en-US;q=0.7,en;q=0.3",
            "user-ref": "cortex-webapp-user",
            "X-Cortex-Timestamp": Date.now().toString(),
            "X-Cortex-Session": extractSessionFromCookie() ?? "",
            Referer: location.href
          }
        }).then((response) => {
          if (!response.ok)
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          return response.json();
        }).then((data) => {
          this._saveIndividualData(data, localDate);
          resolve(data);
        }).catch(reject);
      });
    }
    _generateDateRange(startDate, endDate) {
      const dates = [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (start > end)
        throw new Error("Start date must be before end date");
      const current = new Date(start);
      while (current <= end) {
        if (current.getDay() !== 0) {
          dates.push(current.toISOString().split("T")[0]);
        }
        current.setDate(current.getDate() + 1);
      }
      return dates;
    }
    // ── Storage ────────────────────────────────────────────────────────────────
    _saveIndividualData(data, date) {
      const key = `logistics_data_${date}`;
      const processed = {
        date,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        rawData: data,
        summary: this._extractDataSummary(data)
      };
      GM_setValue(key, JSON.stringify(processed));
      log(`Saved data for ${date}`);
    }
    _saveBatchResults(results, startDate, endDate) {
      const batchKey = `batch_${startDate}_${endDate}_${Date.now()}`;
      const batchData = {
        startDate,
        endDate,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        totalDates: results.length,
        successCount: results.filter((r) => r.success).length,
        results
      };
      GM_setValue(batchKey, JSON.stringify(batchData));
      const batchIndex = JSON.parse(GM_getValue("batch_index", "[]"));
      batchIndex.push({
        key: batchKey,
        startDate,
        endDate,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        successCount: batchData.successCount,
        totalCount: batchData.totalDates
      });
      if (batchIndex.length > 20) {
        const oldBatch = batchIndex.shift();
        GM_setValue(oldBatch.key, "");
      }
      GM_setValue("batch_index", JSON.stringify(batchIndex));
      log(`Saved batch: ${batchKey}`);
    }
    _extractDataSummary(data) {
      const summary = {};
      try {
        const d = data;
        if (d["summary"]) {
          summary["totalRoutes"] = d["summary"]["totalRoutes"] || 0;
          summary["completedRoutes"] = d["summary"]["completedRoutes"] || 0;
          summary["totalPackages"] = d["summary"]["totalPackages"] || 0;
          summary["deliveredPackages"] = d["summary"]["deliveredPackages"] || 0;
        }
        if (d["metrics"])
          summary["metrics"] = d["metrics"];
      } catch (e) {
        console.warn("Could not extract summary:", e);
      }
      return summary;
    }
    // ── Progress Display ───────────────────────────────────────────────────────
    _updateProgressDisplay() {
      var _a;
      if (!this._progress.isRunning) {
        (_a = this._progressEl) == null ? void 0 : _a.remove();
        this._progressEl = null;
        return;
      }
      if (!this._progressEl) {
        const overlay = document.createElement("div");
        overlay.className = "ct-overlay visible";
        overlay.innerHTML = `
        <div class="ct-dialog" style="min-width:320px; text-align:center;">
          <h3>\u{1F4CA} Extracting Data</h3>
          <div id="ct-dre-progress-inner"></div>
          <button class="ct-btn ct-btn--danger" id="ct-dre-stop" style="margin-top:15px;">Stop</button>
        </div>`;
        document.body.appendChild(overlay);
        this._progressEl = overlay;
        document.getElementById("ct-dre-stop").addEventListener("click", () => this._stopExtraction());
      }
      const pct = Math.round(this._progress.current / this._progress.total * 100);
      const currentDate = this._progress.dates[this._progress.current - 1] || "Starting...";
      document.getElementById("ct-dre-progress-inner").innerHTML = `
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
    _stopExtraction() {
      var _a;
      this._progress.isRunning = false;
      (_a = this._progressEl) == null ? void 0 : _a.remove();
      this._progressEl = null;
      log("Extraction stopped by user");
    }
    // ── Batch Results Display ──────────────────────────────────────────────────
    _showBatchResults(results) {
      var _a;
      (_a = this._resultsEl) == null ? void 0 : _a.remove();
      this._resultsEl = null;
      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;
      const successRate = results.length > 0 ? Math.round(successCount / results.length * 100) : 0;
      const resultItems = results.map((result) => `
      <div class="ct-result-item">
        <h4>${esc(result.date)}
          <span class="${result.success ? "ct-result-success" : "ct-result-failure"}">
            ${result.success ? "\u2705" : "\u274C"}
          </span>
        </h4>
        ${result.success ? "<p>Data extracted successfully</p>" : "<p>Error: " + esc(result.error ?? "") + "</p>"}
        <small>Time: ${esc(new Date(result.timestamp).toLocaleString())}</small>
      </div>`).join("");
      const overlay = document.createElement("div");
      overlay.className = "ct-overlay visible";
      overlay.innerHTML = `
      <div class="ct-panel" style="min-width:600px;">
        <h2>\u{1F4CA} Batch Extraction Results</h2>
        <div class="ct-summary-box">
          <h3>Summary</h3>
          <p><strong>Total Dates:</strong> ${results.length}</p>
          <p><strong class="ct-result-success">Successful:</strong> ${successCount}</p>
          <p><strong class="ct-result-failure">Failed:</strong> ${failureCount}</p>
          <p><strong>Success Rate:</strong> ${successRate}%</p>
        </div>
        <div style="margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="ct-btn ct-btn--primary" id="ct-dre-dl-all">\u{1F4BE} Download All Data</button>
          <button class="ct-btn ct-btn--info" id="ct-dre-dl-summary">\u{1F4CB} Download Summary</button>
        </div>
        <h3>Individual Results</h3>
        <div style="max-height: 400px; overflow-y: auto;">${resultItems}</div>
        <div style="margin-top: 16px; text-align: right;">
          <button class="ct-btn ct-btn--secondary" id="ct-dre-results-close">Close</button>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      this._resultsEl = overlay;
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) {
          overlay.remove();
          this._resultsEl = null;
        }
      });
      document.getElementById("ct-dre-results-close").addEventListener("click", () => {
        overlay.remove();
        this._resultsEl = null;
      });
      document.getElementById("ct-dre-dl-all").addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `logistics_batch_data_${todayStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
      document.getElementById("ct-dre-dl-summary").addEventListener("click", () => {
        const summary = { totalDates: results.length, successCount, failureCount, successRate };
        const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `logistics_summary_${todayStr()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  };

  // src/features/delivery-performance.ts
  var DP_STRING_FIELDS = /* @__PURE__ */ new Set([
    "country",
    "station_code",
    "program",
    "country_dspid_stationcode",
    "country_program_stationcode",
    "region",
    "dsp_code",
    "country_program_dspid_stationcode",
    "country_stationcode",
    "country_program_data_date"
  ]);
  var DP_INT_FIELDS = /* @__PURE__ */ new Set([
    "delivered",
    "unbucketed_delivery_misses",
    "address_not_found",
    "return_to_station_utl",
    "return_to_station_uta",
    "customer_not_available",
    "return_to_station_all",
    "successful_c_return_pickups",
    "rts_other",
    "dispatched",
    "transferred_out",
    "dnr",
    "return_to_station_nsl",
    "completed_routes",
    "first_delv_with_test_dim",
    "pde_photos_taken",
    "packages_not_on_van",
    "first_disp_with_test_dim",
    "delivery_attempt",
    "return_to_station_bc",
    "pod_bypass",
    "pod_opportunity",
    "pod_success",
    "next_day_routes",
    "scheduled_mfn_pickups",
    "successful_mfn_pickups",
    "rejected_packages",
    "payment_not_ready",
    "scheduled_c_return_pickups",
    "return_to_station_cu",
    "return_to_station_oodt",
    "rts_dpmo",
    "dnr_dpmo",
    "ttl"
  ]);
  var DP_PERCENT_FIELDS = /* @__PURE__ */ new Set([
    "pod_success_rate",
    "rts_cu_percent",
    "rts_other_percent",
    "rts_oodt_percent",
    "rts_utl_percent",
    "rts_bc_percent",
    "delivery_attempt_percent",
    "customer_not_available_percent",
    "first_day_delivery_success_percent",
    "rts_all_percent",
    "rejected_packages_percent",
    "payment_not_ready_percent",
    "delivery_success_dsp",
    "delivery_success",
    "unbucketed_delivery_misses_percent",
    "address_not_found_percent"
  ]);
  var DP_RATE_FIELDS = /* @__PURE__ */ new Set(["shipment_zone_per_hour"]);
  var DP_DATETIME_FIELDS = /* @__PURE__ */ new Set(["last_updated_time"]);
  var DP_EPOCH_FIELDS = /* @__PURE__ */ new Set(["messageTimestamp"]);
  var DP_DATE_FIELDS = /* @__PURE__ */ new Set(["data_date"]);
  var DP_LABELS = {
    country: "Country",
    station_code: "Station",
    program: "Program",
    country_dspid_stationcode: "Country/DSP/Station",
    country_program_stationcode: "Country/Program/Station",
    region: "Region",
    dsp_code: "DSP",
    country_program_dspid_stationcode: "Country/Program/DSP/Station",
    country_stationcode: "Country/Station",
    country_program_data_date: "Country/Program/Date",
    delivered: "Delivered",
    dispatched: "Dispatched",
    completed_routes: "Completed Routes",
    delivery_attempt: "Delivery Attempts",
    unbucketed_delivery_misses: "Unbucketed Misses",
    address_not_found: "Address Not Found",
    return_to_station_utl: "RTS UTL",
    return_to_station_uta: "RTS UTA",
    customer_not_available: "Customer N/A",
    return_to_station_all: "RTS All",
    return_to_station_cu: "RTS CU",
    return_to_station_bc: "RTS BC",
    return_to_station_nsl: "RTS NSL",
    return_to_station_oodt: "RTS OODT",
    successful_c_return_pickups: "C-Return Pickups",
    rts_other: "RTS Other",
    transferred_out: "Transferred Out",
    dnr: "DNR",
    first_delv_with_test_dim: "First Delv (dim)",
    pde_photos_taken: "PDE Photos",
    packages_not_on_van: "Pkgs Not on Van",
    first_disp_with_test_dim: "First Disp (dim)",
    pod_bypass: "POD Bypass",
    pod_opportunity: "POD Opportunity",
    pod_success: "POD Success",
    next_day_routes: "Next Day Routes",
    scheduled_mfn_pickups: "Sched MFN Pickups",
    successful_mfn_pickups: "Successful MFN Pickups",
    rejected_packages: "Rejected Pkgs",
    payment_not_ready: "Payment N/Ready",
    scheduled_c_return_pickups: "Sched C-Return",
    rts_dpmo: "RTS DPMO",
    dnr_dpmo: "DNR DPMO",
    ttl: "TTL",
    shipment_zone_per_hour: "Shipments/Zone/Hour",
    pod_success_rate: "POD Success Rate",
    rts_cu_percent: "RTS CU %",
    rts_other_percent: "RTS Other %",
    rts_oodt_percent: "RTS OODT %",
    rts_utl_percent: "RTS UTL %",
    rts_bc_percent: "RTS BC %",
    delivery_attempt_percent: "Delivery Attempt %",
    customer_not_available_percent: "Customer N/A %",
    first_day_delivery_success_percent: "First-Day Success %",
    rts_all_percent: "RTS All %",
    rejected_packages_percent: "Rejected Pkgs %",
    payment_not_ready_percent: "Payment N/Ready %",
    delivery_success_dsp: "Delivery Success (DSP)",
    delivery_success: "Delivery Success",
    unbucketed_delivery_misses_percent: "Unbucketed Misses %",
    address_not_found_percent: "Address Not Found %",
    last_updated_time: "Last Updated",
    messageTimestamp: "Message Timestamp",
    data_date: "Data Date"
  };
  function dpParseRow(jsonStr) {
    const raw = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k.trim()] = v;
    }
    return out;
  }
  function dpClassifyField(field) {
    if (DP_STRING_FIELDS.has(field))
      return "string";
    if (DP_INT_FIELDS.has(field))
      return "int";
    if (DP_PERCENT_FIELDS.has(field))
      return "percent";
    if (DP_RATE_FIELDS.has(field))
      return "rate";
    if (DP_DATETIME_FIELDS.has(field))
      return "datetime";
    if (DP_EPOCH_FIELDS.has(field))
      return "epoch";
    if (DP_DATE_FIELDS.has(field))
      return "date";
    return "unknown";
  }
  function dpFormatValue(field, value) {
    if (value === null || value === void 0 || value === "")
      return "\u2014";
    const type = dpClassifyField(field);
    switch (type) {
      case "percent":
        return `${(Number(value) * 100).toFixed(2)}%`;
      case "rate":
        return Number(value).toFixed(2);
      case "datetime":
      case "epoch": {
        try {
          const ms = type === "epoch" ? Number(value) : new Date(value).getTime();
          return new Date(ms).toLocaleString(void 0, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          });
        } catch {
          return String(value);
        }
      }
      case "date":
        return String(value);
      case "int":
        return Number(value).toLocaleString();
      default:
        return String(value);
    }
  }
  function dpRateClass(field, value) {
    const v = Number(value);
    if (field.startsWith("rts_") || field.includes("miss") || field === "customer_not_available_percent" || field === "rejected_packages_percent" || field === "payment_not_ready_percent" || field === "address_not_found_percent") {
      if (v < 5e-3)
        return "great";
      if (v < 0.01)
        return "ok";
      return "bad";
    }
    if (v >= 0.99)
      return "great";
    if (v >= 0.97)
      return "ok";
    return "bad";
  }
  function dpValidateDateRange(from, to) {
    if (!from || !to)
      return "Both From and To dates are required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from))
      return "From date format must be YYYY-MM-DD.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to))
      return "To date format must be YYYY-MM-DD.";
    if (from > to)
      return "From date must not be after To date.";
    return null;
  }
  function dpParseApiResponse(json) {
    try {
      const tableData = json == null ? void 0 : json["tableData"];
      const dsqData = tableData == null ? void 0 : tableData["dsp_daily_supplemental_quality"];
      const rows = dsqData == null ? void 0 : dsqData["rows"];
      if (!Array.isArray(rows) || rows.length === 0)
        return [];
      return rows.map(dpParseRow).sort((a, b) => (a["data_date"] || "").localeCompare(b["data_date"] || ""));
    } catch (e) {
      err("dpParseApiResponse error:", e);
      return [];
    }
  }
  var DeliveryPerformance = class {
    constructor(config, companyConfig) {
      this.config = config;
      this.companyConfig = companyConfig;
    }
    _overlayEl = null;
    _active = false;
    _cache = /* @__PURE__ */ new Map();
    _debounceTimer = null;
    /** Expose pure helpers for testing */
    helpers = {
      dpParseRow,
      dpClassifyField,
      dpFormatValue,
      dpRateClass,
      dpValidateDateRange,
      dpParseApiResponse
    };
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    async init() {
      if (this._overlayEl)
        return;
      const today = todayStr();
      const overlay = document.createElement("div");
      overlay.id = "ct-dp-overlay";
      overlay.className = "ct-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Daily Delivery Performance Dashboard");
      overlay.innerHTML = `
      <div class="ct-dp-panel">
        <h2>\u{1F4E6} Daily Delivery Performance</h2>
        <div class="ct-controls">
          <label for="ct-dp-date">Date:</label>
          <input type="date" id="ct-dp-date" class="ct-input" value="${today}" aria-label="Select date">
          <label for="ct-dp-sa">Service Area:</label>
          <select id="ct-dp-sa" class="ct-input" aria-label="Service Area">
            <option value="">Wird geladen\u2026</option>
          </select>
          <button class="ct-btn ct-btn--accent" id="ct-dp-go">\u{1F50D} Fetch</button>
          <button class="ct-btn ct-btn--close" id="ct-dp-close" aria-label="Close">\u2715 Close</button>
        </div>
        <div id="ct-dp-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-dp-body"></div>
      </div>
    `;
      document.body.appendChild(overlay);
      this._overlayEl = overlay;
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay)
          this.hide();
      });
      document.getElementById("ct-dp-close").addEventListener("click", () => this.hide());
      document.getElementById("ct-dp-go").addEventListener("click", () => this._triggerFetch());
      const debounced = /* @__PURE__ */ (() => {
        let t;
        return () => {
          clearTimeout(t);
          t = setTimeout(() => this._triggerFetch(), 600);
        };
      })();
      document.getElementById("ct-dp-date").addEventListener("change", debounced);
      await this.companyConfig.load();
      this.companyConfig.populateSaSelect(document.getElementById("ct-dp-sa"));
      onDispose(() => this.dispose());
      log("Delivery Performance Dashboard initialized");
    }
    dispose() {
      var _a;
      if (this._debounceTimer)
        clearTimeout(this._debounceTimer);
      (_a = this._overlayEl) == null ? void 0 : _a.remove();
      this._overlayEl = null;
      this._active = false;
      this._cache.clear();
    }
    toggle() {
      if (!this.config.features.deliveryPerf) {
        alert("Daily Delivery Performance ist deaktiviert. Bitte in den Einstellungen aktivieren.");
        return;
      }
      this.init();
      if (this._active)
        this.hide();
      else
        this.show();
    }
    show() {
      this.init();
      this._overlayEl.classList.add("visible");
      this._active = true;
      document.getElementById("ct-dp-date").focus();
    }
    hide() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.classList.remove("visible");
      this._active = false;
    }
    // ── API ────────────────────────────────────────────────────────────────────
    _buildUrl(from, to, station, dsp) {
      return `https://logistics.amazon.de/performance/api/v1/getData?dataSetId=dsp_daily_supplemental_quality&dsp=${encodeURIComponent(dsp)}&from=${encodeURIComponent(from)}&station=${encodeURIComponent(station)}&timeFrame=Daily&to=${encodeURIComponent(to)}`;
    }
    async _fetchData(from, to, station, dsp) {
      const cacheKey = `${from}|${to}|${station}|${dsp}`;
      if (this._cache.has(cacheKey)) {
        log("DP cache hit:", cacheKey);
        return this._cache.get(cacheKey);
      }
      const url = this._buildUrl(from, to, station, dsp);
      const csrf = getCSRFToken();
      const headers = { Accept: "application/json" };
      if (csrf)
        headers["anti-csrftoken-a2z"] = csrf;
      const resp = await withRetry(async () => {
        const r = await fetch(url, { method: "GET", headers, credentials: "include" });
        if (!r.ok)
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r;
      }, { retries: 2, baseMs: 800 });
      const json = await resp.json();
      this._cache.set(cacheKey, json);
      if (this._cache.size > 50) {
        const oldest = this._cache.keys().next().value;
        this._cache.delete(oldest);
      }
      return json;
    }
    // ── Trigger ────────────────────────────────────────────────────────────────
    async _triggerFetch() {
      var _a, _b;
      const date = document.getElementById("ct-dp-date").value;
      if (!date) {
        this._setStatus("\u26A0\uFE0F Please select a date.");
        return;
      }
      const saSelect = document.getElementById("ct-dp-sa");
      const station = ((_b = (_a = saSelect.options[saSelect.selectedIndex]) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim().toUpperCase()) || this.companyConfig.getDefaultStation();
      const dsp = this.companyConfig.getDspCode();
      this._setStatus("\u23F3 Loading\u2026");
      this._setBody('<div class="ct-dp-loading" role="status">Fetching data\u2026</div>');
      try {
        const json = await this._fetchData(date, date, station, dsp);
        const records = dpParseApiResponse(json);
        if (records.length === 0) {
          this._setBody('<div class="ct-dp-empty">No data returned for the selected date.</div>');
          this._setStatus("\u26A0\uFE0F No records found.");
          return;
        }
        this._setBody(this._renderAll(records));
        this._setStatus(`\u2705 ${records.length} record(s) loaded \u2014 ${date}`);
      } catch (e) {
        err("Delivery perf fetch failed:", e);
        this._setBody(`<div class="ct-dp-error">\u274C ${esc(e.message)}</div>`);
        this._setStatus("\u274C Failed to load data.");
      }
    }
    // ── Helpers ────────────────────────────────────────────────────────────────
    _setStatus(msg) {
      const el = document.getElementById("ct-dp-status");
      if (el)
        el.textContent = msg;
    }
    _setBody(html) {
      const el = document.getElementById("ct-dp-body");
      if (el)
        el.innerHTML = html;
    }
    // ── Rendering ──────────────────────────────────────────────────────────────
    _renderAll(records) {
      const badgesHtml = this._renderBadges(records[0]);
      const recordsHtml = records.map((r) => this._renderRecord(r)).join("");
      return badgesHtml + recordsHtml;
    }
    _renderBadges(record) {
      const badges = [];
      for (const field of DP_STRING_FIELDS) {
        const val = record[field];
        if (val === void 0 || val === null || val === "")
          continue;
        const label = DP_LABELS[field] || field;
        badges.push(
          `<span class="ct-dp-badge" title="${esc(field)}">${esc(label)}<span>${esc(String(val))}</span></span>`
        );
      }
      if (!badges.length)
        return "";
      return `<div class="ct-dp-badges" aria-label="Identifiers">${badges.join("")}</div>`;
    }
    _renderRecord(record) {
      const dateLabel = esc(String(record["data_date"] || "Unknown date"));
      return `
      <div class="ct-dp-record">
        <div class="ct-dp-record-header">\u{1F4C5} ${dateLabel}</div>
        <div class="ct-dp-record-body">
          ${this._renderKeyTiles(record)}
          ${this._renderCounts(record)}
          ${this._renderRates(record)}
          ${this._renderTimestamps(record)}
        </div>
      </div>`;
    }
    _renderKeyTiles(record) {
      const KEY_TILES = [
        { field: "delivered", label: "Delivered", pct: false },
        { field: "dispatched", label: "Dispatched", pct: false },
        { field: "completed_routes", label: "Routes", pct: false },
        { field: "delivery_success", label: "Delivery Success", pct: true },
        { field: "pod_success_rate", label: "POD Rate", pct: true }
      ];
      const tiles = KEY_TILES.map(({ field, label, pct }) => {
        const val = record[field];
        if (val === void 0 || val === null)
          return "";
        let displayVal, cls = "";
        if (pct) {
          const n = Number(val);
          displayVal = `${(n * 100).toFixed(1)}%`;
          const rc = dpRateClass(field, n);
          cls = rc === "great" ? "ct-dp-tile--success" : rc === "ok" ? "ct-dp-tile--warn" : "ct-dp-tile--danger";
        } else {
          displayVal = Number(val).toLocaleString();
        }
        return `<div class="ct-dp-tile ${cls}"><div class="ct-dp-tile-val">${esc(displayVal)}</div><div class="ct-dp-tile-lbl">${esc(label)}</div></div>`;
      }).join("");
      return `<div class="ct-dp-full-col"><div class="ct-dp-tiles">${tiles}</div></div>`;
    }
    _renderCounts(record) {
      const rows = [];
      for (const field of DP_INT_FIELDS) {
        const val = record[field];
        if (val === void 0 || val === null)
          continue;
        const label = DP_LABELS[field] || field;
        rows.push(`<tr><td>${esc(label)}</td><td>${esc(Number(val).toLocaleString())}</td></tr>`);
      }
      if (!rows.length)
        return "";
      return `<div>
      <p class="ct-dp-section-title">Counts</p>
      <table class="ct-dp-count-table" aria-label="Count metrics">
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>`;
    }
    _renderRates(record) {
      const pctRows = [];
      for (const field of DP_PERCENT_FIELDS) {
        const val = record[field];
        if (val === void 0 || val === null)
          continue;
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
        if (val === void 0 || val === null)
          continue;
        const label = DP_LABELS[field] || field;
        pctRows.push(`
        <div class="ct-dp-rate-row" role="listitem">
          <span class="ct-dp-rate-label">${esc(label)}</span>
          <span class="ct-dp-rate-value ct-dp-rate--neutral">${Number(val).toFixed(2)}</span>
        </div>`);
      }
      if (!pctRows.length)
        return "";
      return `<div>
      <p class="ct-dp-section-title">Rates &amp; Percentages</p>
      <div class="ct-dp-rates" role="list">${pctRows.join("")}</div>
    </div>`;
    }
    _renderTimestamps(record) {
      const items = [];
      if (record["data_date"]) {
        items.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Data Date</span>
        <span class="ct-dp-ts-val">${esc(String(record["data_date"]))}</span>
      </div>`);
      }
      if (record["last_updated_time"]) {
        items.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Last Updated</span>
        <span class="ct-dp-ts-val">${esc(dpFormatValue("last_updated_time", record["last_updated_time"]))}</span>
      </div>`);
      }
      if (record["messageTimestamp"] !== void 0 && record["messageTimestamp"] !== null) {
        items.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Message Timestamp</span>
        <span class="ct-dp-ts-val">${esc(dpFormatValue("messageTimestamp", record["messageTimestamp"]))}</span>
      </div>`);
      }
      if (!items.length)
        return "";
      return `<div class="ct-dp-full-col">
      <div class="ct-dp-ts-row" aria-label="Timestamps">${items.join("")}</div>
    </div>`;
    }
  };

  // src/features/dvic-check.ts
  var DvicCheck = class {
    constructor(config, companyConfig) {
      this.config = config;
      this.companyConfig = companyConfig;
    }
    _overlayEl = null;
    _active = false;
    _vehicles = [];
    _nameCache = /* @__PURE__ */ new Map();
    _lastTimestamp = null;
    _loading = false;
    _pageSize = 25;
    _pageCurrent = 1;
    _pageMissing = 1;
    _currentTab = "all";
    get _showTransporters() {
      return this.config.features.dvicShowTransporters !== false;
    }
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    init() {
      if (this._overlayEl)
        return;
      const overlay = document.createElement("div");
      overlay.id = "ct-dvic-overlay";
      overlay.className = "ct-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "DVIC Check");
      overlay.innerHTML = `
      <div class="ct-dvic-panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <h2>\u{1F69B} DVIC Check</h2>
            <div id="ct-dvic-asof" style="font-size:11px;color:var(--ct-muted);margin-top:2px;"></div>
          </div>
          <button class="ct-btn ct-btn--close" id="ct-dvic-close" aria-label="Schlie\xDFen">\u2715 Schlie\xDFen</button>
        </div>
        <div id="ct-dvic-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-dvic-tiles"></div>
        <div class="ct-dvic-tabs" role="tablist">
          <button class="ct-dvic-tab ct-dvic-tab--active" data-tab="all" role="tab"
                  aria-selected="true" id="ct-dvic-tab-all">Alle Fahrzeuge</button>
          <button class="ct-dvic-tab" data-tab="missing" role="tab"
                  aria-selected="false" id="ct-dvic-tab-missing">\u26A0\uFE0F DVIC Fehlend</button>
        </div>
        <div id="ct-dvic-body"></div>
      </div>
    `;
      document.body.appendChild(overlay);
      this._overlayEl = overlay;
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay)
          this.hide();
      });
      document.getElementById("ct-dvic-close").addEventListener("click", () => this.hide());
      overlay.querySelector(".ct-dvic-tabs").addEventListener("click", (e) => {
        const btn = e.target.closest(".ct-dvic-tab");
        if (!btn)
          return;
        this._switchTab(btn.dataset["tab"]);
      });
      onDispose(() => this.dispose());
      log("DVIC Check initialized");
    }
    dispose() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.remove();
      this._overlayEl = null;
      this._vehicles = [];
      this._active = false;
      this._lastTimestamp = null;
      this._loading = false;
    }
    toggle() {
      if (!this.config.features.dvicCheck) {
        alert("DVIC Check ist deaktiviert. Bitte in den Einstellungen aktivieren.");
        return;
      }
      this.init();
      if (this._active)
        this.hide();
      else
        this.show();
    }
    show() {
      this.init();
      this._overlayEl.classList.add("visible");
      this._active = true;
      this._pageCurrent = 1;
      this._pageMissing = 1;
      this._currentTab = "all";
      this._switchTab("all");
      this._refresh();
    }
    hide() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.classList.remove("visible");
      this._active = false;
    }
    // ── Tab management ─────────────────────────────────────────────────────────
    _switchTab(tab) {
      var _a;
      this._currentTab = tab;
      (_a = this._overlayEl) == null ? void 0 : _a.querySelectorAll(".ct-dvic-tab").forEach((btn) => {
        const active = btn.dataset["tab"] === tab;
        btn.classList.toggle("ct-dvic-tab--active", active);
        btn.setAttribute("aria-selected", String(active));
      });
      if (this._vehicles.length > 0)
        this._renderBody();
    }
    // ── Timestamp helpers ──────────────────────────────────────────────────────
    _getTodayBremenTimestamp() {
      const now = /* @__PURE__ */ new Date();
      const dateStr = now.toLocaleDateString("sv", { timeZone: "Europe/Berlin" });
      const [y, mo, d] = dateStr.split("-").map(Number);
      const utcRef = new Date(Date.UTC(y, mo - 1, d, 6, 0, 0));
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Berlin",
        hour: "numeric",
        minute: "numeric",
        hour12: false
      }).formatToParts(utcRef);
      const berlinH = parseInt(parts.find((p) => p.type === "hour").value, 10) % 24;
      const berlinM = parseInt(parts.find((p) => p.type === "minute").value, 10);
      const offsetMinutes = berlinH * 60 + berlinM - 6 * 60;
      return Date.UTC(y, mo - 1, d) - offsetMinutes * 6e4;
    }
    // ── API ────────────────────────────────────────────────────────────────────
    async _fetchInspectionStats(timestamp) {
      const url = `https://logistics.amazon.de/fleet-management/api/inspection-stats?startTimestamp=${timestamp}`;
      const csrf = getCSRFToken();
      const headers = { Accept: "application/json" };
      if (csrf)
        headers["anti-csrftoken-a2z"] = csrf;
      const resp = await withRetry(async () => {
        const r = await fetch(url, { method: "GET", headers, credentials: "include" });
        if (!r.ok)
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r;
      }, { retries: 2, baseMs: 800 });
      return resp.json();
    }
    async _getEmployeeNames(reporterIds) {
      const unique = [...new Set(reporterIds)];
      const uncached = unique.filter((id) => !this._nameCache.has(id));
      if (uncached.length > 0) {
        try {
          const saId = this.companyConfig.getDefaultServiceAreaId();
          const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
          const fromDate = addDays(today, -30);
          const url = `https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${fromDate}&toDate=${today}&serviceAreaId=${saId}`;
          const csrf = getCSRFToken();
          const headers = { Accept: "application/json" };
          if (csrf)
            headers["anti-csrftoken-a2z"] = csrf;
          const resp = await fetch(url, { method: "GET", headers, credentials: "include" });
          if (resp.ok) {
            const json = await resp.json();
            const roster = Array.isArray(json) ? json : (json == null ? void 0 : json.data) || (json == null ? void 0 : json.rosters) || [];
            const processEntries = (entries) => {
              for (const entry of entries) {
                if (entry["driverPersonId"] && entry["driverName"]) {
                  this._nameCache.set(String(entry["driverPersonId"]), entry["driverName"]);
                }
              }
            };
            if (Array.isArray(roster))
              processEntries(roster);
            else if (typeof roster === "object") {
              for (const val of Object.values(roster)) {
                if (Array.isArray(val))
                  processEntries(val);
              }
            }
            log("[DVIC] Roster fetch: added", this._nameCache.size, "names to cache");
          }
        } catch (e) {
          log("[DVIC] Roster lookup failed:", e);
        }
      }
      const result = /* @__PURE__ */ new Map();
      for (const id of reporterIds) {
        result.set(id, this._nameCache.get(id) || id);
      }
      return result;
    }
    // ── Data normalisation ─────────────────────────────────────────────────────
    _normalizeVehicle(vehicleStat) {
      const vehicleIdentifier = String((vehicleStat == null ? void 0 : vehicleStat["vehicleIdentifier"]) ?? "").trim() || "Unknown";
      const inspStats = Array.isArray(vehicleStat == null ? void 0 : vehicleStat["inspectionStats"]) ? vehicleStat["inspectionStats"] : [];
      const preStat = inspStats.find((s) => ((s == null ? void 0 : s["inspectionType"]) ?? (s == null ? void 0 : s["type"])) === "PRE_TRIP_DVIC") ?? null;
      const postStat = inspStats.find((s) => ((s == null ? void 0 : s["inspectionType"]) ?? (s == null ? void 0 : s["type"])) === "POST_TRIP_DVIC") ?? null;
      const preTripTotal = Number((preStat == null ? void 0 : preStat["totalInspectionsDone"]) ?? 0);
      const postTripTotal = Number((postStat == null ? void 0 : postStat["totalInspectionsDone"]) ?? 0);
      const missingDVIC = preTripTotal - postTripTotal;
      const status = missingDVIC > 0 ? "Post Trip DVIC Missing" : "OK";
      const missingCount = status === "OK" ? 0 : missingDVIC;
      const candidateDates = [preStat, postStat].filter(Boolean).map((s) => s["inspectedAt"] ?? s["lastInspectedAt"] ?? null).filter(Boolean);
      const inspectedAt = candidateDates.length > 0 ? candidateDates.sort().at(-1) ?? null : null;
      const shiftDate = (preStat == null ? void 0 : preStat["shiftDate"]) ?? (postStat == null ? void 0 : postStat["shiftDate"]) ?? null;
      const reporterIdSet = /* @__PURE__ */ new Set();
      for (const stat of inspStats) {
        const details = Array.isArray(stat == null ? void 0 : stat["inspectionDetails"]) ? stat["inspectionDetails"] : [];
        for (const detail of details) {
          const rid = detail == null ? void 0 : detail["reporterId"];
          if (rid != null && String(rid).trim() !== "")
            reporterIdSet.add(String(rid).trim());
        }
      }
      return { vehicleIdentifier, preTripTotal, postTripTotal, missingCount, status, inspectedAt, shiftDate, reporterIds: [...reporterIdSet], reporterNames: [] };
    }
    _processApiResponse(json) {
      if (json === null || typeof json !== "object")
        throw new Error("API response is not a JSON object");
      const list = json == null ? void 0 : json["inspectionsStatList"];
      if (list === void 0 || list === null)
        return [];
      if (!Array.isArray(list))
        throw new Error(`inspectionsStatList has unexpected type: ${typeof list}`);
      return list.map((v) => this._normalizeVehicle(v));
    }
    // ── Refresh ────────────────────────────────────────────────────────────────
    async _refresh() {
      var _a;
      if (this._loading)
        return;
      this._loading = true;
      this._vehicles = [];
      const ts = this._getTodayBremenTimestamp();
      this._lastTimestamp = ts;
      const dateLabel = new Date(ts).toLocaleDateString("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
      this._setStatus(`\u23F3 Lade DVIC-Daten f\xFCr heute (${dateLabel})\u2026`);
      this._setTiles("");
      this._setBody('<div class="ct-dvic-loading" role="status">Daten werden geladen\u2026</div>');
      try {
        const json = await this._fetchInspectionStats(ts);
        let vehicles;
        try {
          vehicles = this._processApiResponse(json);
        } catch (parseErr) {
          err("DVIC response parse error:", parseErr);
          this._setBody(`<div class="ct-dvic-error" role="alert">\u26A0\uFE0F DVIC data unavailable for this date.<br><small>${esc(parseErr.message)}</small></div>`);
          this._setStatus("\u26A0\uFE0F Daten konnten nicht verarbeitet werden.");
          this._loading = false;
          return;
        }
        const allIds = [...new Set(vehicles.flatMap((v) => v.reporterIds))];
        if (allIds.length > 0) {
          this._setStatus("\u23F3 Lade Mitarbeiternamen\u2026");
          try {
            const nameMap = await this._getEmployeeNames(allIds);
            for (const v of vehicles) {
              v.reporterNames = [...new Set(v.reporterIds.map((id) => nameMap.get(id) || id))];
            }
          } catch (nameErr) {
            log("Name enrichment failed, using IDs as fallback:", nameErr);
            for (const v of vehicles) {
              v.reporterNames = [...v.reporterIds];
            }
          }
        } else {
          for (const v of vehicles) {
            v.reporterNames = [];
          }
        }
        this._vehicles = vehicles;
        const missingVehicles = vehicles.filter((v) => v.status !== "OK").length;
        const totalMissing = vehicles.reduce((s, v) => s + v.missingCount, 0);
        this._setStatus(`\u2705 ${vehicles.length} Fahrzeuge | ${missingVehicles} mit fehlendem Post-Trip DVIC | ${totalMissing} fehlende DVICs gesamt`);
        const asOfEl = document.getElementById("ct-dvic-asof");
        if (asOfEl) {
          const fetchedAt = (/* @__PURE__ */ new Date()).toLocaleString("de-DE", {
            timeZone: "Europe/Berlin",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
          });
          asOfEl.textContent = `Stand: ${fetchedAt} (Daten ab ${dateLabel})`;
        }
        this._renderTiles(vehicles.length, missingVehicles, totalMissing);
        this._updateMissingTabBadge(missingVehicles);
        this._renderBody();
      } catch (e) {
        err("DVIC fetch failed:", e);
        this._setBody(`<div class="ct-dvic-error" role="alert">\u274C DVIC-Daten konnten nicht geladen werden.<br><small>${esc(e.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-dvic-retry">\u{1F504} Erneut versuchen</button></div>`);
        this._setStatus("\u274C Fehler beim Laden.");
        (_a = document.getElementById("ct-dvic-retry")) == null ? void 0 : _a.addEventListener("click", () => this._refresh());
      } finally {
        this._loading = false;
      }
    }
    // ── Status helpers ─────────────────────────────────────────────────────────
    _setStatus(msg) {
      const el = document.getElementById("ct-dvic-status");
      if (el)
        el.textContent = msg;
    }
    _setBody(html) {
      const el = document.getElementById("ct-dvic-body");
      if (el)
        el.innerHTML = html;
    }
    _setTiles(html) {
      const el = document.getElementById("ct-dvic-tiles");
      if (el)
        el.innerHTML = html;
    }
    _updateMissingTabBadge(count) {
      const tab = document.getElementById("ct-dvic-tab-missing");
      if (tab)
        tab.textContent = count > 0 ? `\u26A0\uFE0F DVIC Fehlend (${count})` : "\u26A0\uFE0F DVIC Fehlend";
    }
    // ── Rendering ──────────────────────────────────────────────────────────────
    _renderTiles(total, missingVehicles, missingTotal) {
      const errCls = missingVehicles === 0 ? "ct-dvic-tile--ok" : missingVehicles < 5 ? "ct-dvic-tile--warn" : "ct-dvic-tile--danger";
      this._setTiles(`
      <div class="ct-dvic-tiles">
        <div class="ct-dvic-tile"><div class="ct-dvic-tile-val">${total}</div><div class="ct-dvic-tile-lbl">Fahrzeuge gesamt</div></div>
        <div class="ct-dvic-tile ${errCls}"><div class="ct-dvic-tile-val">${missingVehicles}</div><div class="ct-dvic-tile-lbl">Fahrzeuge mit Fehler</div></div>
        <div class="ct-dvic-tile ${missingTotal === 0 ? "ct-dvic-tile--ok" : "ct-dvic-tile--danger"}"><div class="ct-dvic-tile-val">${missingTotal}</div><div class="ct-dvic-tile-lbl">DVIC fehlend gesamt</div></div>
        <div class="ct-dvic-tile ${missingVehicles === 0 ? "ct-dvic-tile--ok" : ""}"><div class="ct-dvic-tile-val">${total - missingVehicles}</div><div class="ct-dvic-tile-lbl">Fahrzeuge OK</div></div>
      </div>`);
    }
    _renderBody() {
      if (!this._overlayEl)
        return;
      if (this._vehicles.length === 0) {
        this._setBody('<div class="ct-dvic-empty">Keine DVIC-Daten verf\xFCgbar f\xFCr dieses Datum.</div>');
        return;
      }
      if (this._currentTab === "all")
        this._renderAllTab();
      else
        this._renderMissingTab();
    }
    _renderTransporterNames(v) {
      const ids = (v.reporterIds ?? []).filter((id) => String(id).trim() !== "");
      if (ids.length === 0)
        return `<em class="ct-dvic-tp-unknown" aria-label="Unbekannter Transporter">Unbekannter Transporter</em>`;
      const labels = ids.map((id) => {
        const name = this._nameCache.get(id);
        return name && name !== id ? `${name} (ID: ${id})` : id;
      });
      if (labels.length === 0)
        return `<em class="ct-dvic-tp-unknown">Unbekannter Transporter</em>`;
      const [primary, ...rest] = labels;
      const secondary = rest.length > 0 ? `<span class="ct-dvic-tp-secondary">, ${esc(rest.join(", "))}</span>` : "";
      return `<span class="ct-dvic-tp-primary" aria-label="Transporter: ${esc(labels.join(", "))}">${esc(primary)}${secondary}</span>`;
    }
    _renderAllTab() {
      var _a;
      const page = this._pageCurrent;
      const total = this._vehicles.length;
      const totalPages = Math.ceil(total / this._pageSize);
      const start = (page - 1) * this._pageSize;
      const slice = this._vehicles.slice(start, start + this._pageSize);
      const showTp = this._showTransporters;
      const rows = slice.map((v) => {
        const isMissing = v.status !== "OK";
        const rowCls = isMissing ? "ct-dvic-row--missing" : "";
        const badgeCls = isMissing ? "ct-dvic-badge--missing" : "ct-dvic-badge--ok";
        const tpCell = showTp ? `<td class="ct-dvic-tp-cell">${this._renderTransporterNames(v)}</td>` : "";
        return `<tr class="${rowCls}" role="row">
        <td>${esc(v.vehicleIdentifier)}</td>
        <td>${v.preTripTotal}</td><td>${v.postTripTotal}</td>
        <td>${v.missingCount > 0 ? `<strong>${v.missingCount}</strong>` : "0"}</td>
        <td><span class="${badgeCls}">${esc(v.status)}</span></td>
        ${tpCell}<td></td>
      </tr>`;
      }).join("");
      const tpToggleLabel = showTp ? "Transporter ausblenden" : "Transporter einblenden";
      const tpHeader = showTp ? `<th scope="col" class="ct-dvic-tp-th">Transporter</th>` : "";
      this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-all">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${showTp}">\u{1F464} ${tpToggleLabel}</button>
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip \u2713</th><th scope="col">Post-Trip \u2713</th>
            <th scope="col">Fehlend</th><th scope="col">Status</th>
            ${tpHeader}<th scope="col" style="width:4px;"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${this._renderPagination(total, page, totalPages, "all")}
      </div>`);
      (_a = document.getElementById("ct-dvic-tp-toggle")) == null ? void 0 : _a.addEventListener("click", () => {
        this.config.features.dvicShowTransporters = !this._showTransporters;
        setConfig(this.config);
        this._renderBody();
      });
      this._attachPaginationHandlers("all");
    }
    _renderMissingTab() {
      var _a;
      const missing = this._vehicles.filter((v) => v.status !== "OK");
      if (missing.length === 0) {
        this._setBody('<div class="ct-dvic-empty">\u2705 Alle Fahrzeuge haben Post-Trip DVICs \u2014 kein Handlungsbedarf.</div>');
        return;
      }
      const page = this._pageMissing;
      const totalPages = Math.ceil(missing.length / this._pageSize);
      const start = (page - 1) * this._pageSize;
      const slice = missing.slice(start, start + this._pageSize);
      const showTp = this._showTransporters;
      const rows = slice.map((v) => {
        const tpCell = showTp ? `<td class="ct-dvic-tp-cell">${this._renderTransporterNames(v)}</td>` : "";
        return `<tr class="ct-dvic-row--missing" role="row">
        <td>${esc(v.vehicleIdentifier)}</td>
        <td>${v.preTripTotal}</td><td>${v.postTripTotal}</td>
        <td><strong>${v.missingCount}</strong></td>
        ${tpCell}
      </tr>`;
      }).join("");
      const tpToggleLabel = showTp ? "Transporter ausblenden" : "Transporter einblenden";
      const tpHeader = showTp ? `<th scope="col" class="ct-dvic-tp-th">Transporter</th>` : "";
      this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-missing">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${showTp}">\u{1F464} ${tpToggleLabel}</button>
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip \u2713</th><th scope="col">Post-Trip \u2713</th>
            <th scope="col">Fehlend</th>${tpHeader}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${this._renderPagination(missing.length, page, totalPages, "missing")}
      </div>`);
      (_a = document.getElementById("ct-dvic-tp-toggle")) == null ? void 0 : _a.addEventListener("click", () => {
        this.config.features.dvicShowTransporters = !this._showTransporters;
        setConfig(this.config);
        this._renderBody();
      });
      this._attachPaginationHandlers("missing");
    }
    _renderPagination(total, current, totalPages, tabKey) {
      if (totalPages <= 1)
        return "";
      return `
      <div class="ct-dvic-pagination">
        <button class="ct-btn ct-btn--secondary ct-dvic-prev-page" data-tab="${tabKey}" ${current <= 1 ? "disabled" : ""}>\u2039 Zur\xFCck</button>
        <span class="ct-dvic-page-info">Seite ${current} / ${totalPages} (${total} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-dvic-next-page" data-tab="${tabKey}" ${current >= totalPages ? "disabled" : ""}>Weiter \u203A</button>
      </div>`;
    }
    _attachPaginationHandlers(tabKey) {
      var _a, _b;
      const body = document.getElementById("ct-dvic-body");
      if (!body)
        return;
      (_a = body.querySelector(`.ct-dvic-prev-page[data-tab="${tabKey}"]`)) == null ? void 0 : _a.addEventListener("click", () => {
        if (tabKey === "all") {
          if (this._pageCurrent > 1) {
            this._pageCurrent--;
            this._renderAllTab();
          }
        } else {
          if (this._pageMissing > 1) {
            this._pageMissing--;
            this._renderMissingTab();
          }
        }
      });
      (_b = body.querySelector(`.ct-dvic-next-page[data-tab="${tabKey}"]`)) == null ? void 0 : _b.addEventListener("click", () => {
        const t = tabKey === "all" ? this._vehicles.length : this._vehicles.filter((v) => v.status !== "OK").length;
        const tp = Math.ceil(t / this._pageSize);
        if (tabKey === "all") {
          if (this._pageCurrent < tp) {
            this._pageCurrent++;
            this._renderAllTab();
          }
        } else {
          if (this._pageMissing < tp) {
            this._pageMissing++;
            this._renderMissingTab();
          }
        }
      });
    }
  };

  // src/features/working-hours.ts
  function whdNormalizeEpochMs(value) {
    if (value === null || value === void 0)
      return null;
    const n = Number(value);
    if (isNaN(n))
      return null;
    if (n > 1e15)
      return Math.floor(n / 1e3);
    if (n > 1e12)
      return n;
    if (n > 1e9)
      return n * 1e3;
    return n;
  }
  function whdFormatTime(epochMs) {
    if (epochMs === null || epochMs === void 0)
      return "\u2014";
    try {
      return new Date(epochMs).toLocaleTimeString("de-DE", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch {
      return "\u2014";
    }
  }
  function whdFormatDuration(ms) {
    if (ms === null || ms === void 0)
      return "\u2014";
    const n = Number(ms);
    if (isNaN(n))
      return "\u2014";
    const totalSec = Math.floor(n / 1e3);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  function whdExtractRow(item) {
    const tta = item["transporterTimeAttributes"] || {};
    return {
      itineraryId: item["itineraryId"] ?? null,
      transporterId: item["transporterId"] ?? null,
      routeCode: item["routeCode"] ?? null,
      serviceTypeName: item["serviceTypeName"] ?? null,
      driverName: null,
      blockDurationInMinutes: item["blockDurationInMinutes"] ?? null,
      waveStartTime: whdNormalizeEpochMs(item["waveStartTime"]),
      itineraryStartTime: whdNormalizeEpochMs(item["itineraryStartTime"]),
      plannedDepartureTime: whdNormalizeEpochMs(item["plannedDepartureTime"]),
      actualDepartureTime: whdNormalizeEpochMs(tta["actualDepartureTime"]),
      plannedOutboundStemTime: tta["plannedOutboundStemTime"] ?? null,
      actualOutboundStemTime: tta["actualOutboundStemTime"] ?? null,
      lastDriverEventTime: whdNormalizeEpochMs(item["lastDriverEventTime"])
    };
  }
  function whdSortRows(rows, column, direction) {
    const mult = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[column];
      const vb = b[column];
      if (va === null && vb === null)
        return 0;
      if (va === null)
        return 1;
      if (vb === null)
        return -1;
      if (typeof va === "string")
        return mult * va.localeCompare(vb);
      return mult * (va - vb);
    });
  }
  var WHD_COLUMNS = [
    { key: "routeCode", label: "Route Code", type: "string" },
    { key: "serviceTypeName", label: "Service Type", type: "string" },
    { key: "driverName", label: "Driver", type: "string" },
    { key: "blockDurationInMinutes", label: "Block (min)", type: "integer" },
    { key: "waveStartTime", label: "Wave Start", type: "time" },
    { key: "itineraryStartTime", label: "Itin. Start", type: "time" },
    { key: "plannedDepartureTime", label: "Planned Dep.", type: "time" },
    { key: "actualDepartureTime", label: "Actual Dep.", type: "time" },
    { key: "plannedOutboundStemTime", label: "Planned OB Stem", type: "duration" },
    { key: "actualOutboundStemTime", label: "Actual OB Stem", type: "duration" },
    { key: "lastDriverEventTime", label: "Last Driver Event", type: "time" }
  ];
  var WHD_DETAIL_FIELDS = [
    { key: "itineraryId", label: "Itinerary ID", format: "string", suffix: "" },
    { key: "routeCode", label: "Route Code", format: "string", suffix: "" },
    { key: "serviceTypeName", label: "Service Type", format: "string", suffix: "" },
    { key: "driverName", label: "Driver", format: "string", suffix: "" },
    { key: "blockDurationInMinutes", label: "Block Duration", format: "integer", suffix: " min" },
    { key: "waveStartTime", label: "Wave Start", format: "time", suffix: "" },
    { key: "itineraryStartTime", label: "Itin. Start", format: "time", suffix: "" },
    { key: "plannedDepartureTime", label: "Planned Departure", format: "time", suffix: "" },
    { key: "actualDepartureTime", label: "Actual Departure", format: "time", suffix: "" },
    { key: "plannedOutboundStemTime", label: "Planned OB Stem", format: "duration", suffix: "" },
    { key: "actualOutboundStemTime", label: "Actual OB Stem", format: "duration", suffix: "" },
    { key: "lastDriverEventTime", label: "Last Driver Event", format: "time", suffix: "" }
  ];
  var WorkingHoursDashboard = class {
    constructor(config, companyConfig) {
      this.config = config;
      this.companyConfig = companyConfig;
    }
    _overlayEl = null;
    _detailEl = null;
    _active = false;
    _data = [];
    _sort = { column: "routeCode", direction: "asc" };
    _page = 1;
    _pageSize = 50;
    _driverCache = /* @__PURE__ */ new Map();
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    init() {
      if (this._overlayEl)
        return;
      const overlay = document.createElement("div");
      overlay.id = "ct-whd-overlay";
      overlay.className = "ct-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Working Hours Dashboard");
      overlay.innerHTML = `
      <div class="ct-whd-panel">
        <h2>\u23F1 Working Hours Dashboard</h2>
        <div class="ct-controls">
          <label for="ct-whd-date">Datum:</label>
          <input type="date" id="ct-whd-date" class="ct-input" value="${todayStr()}" aria-label="Datum ausw\xE4hlen">
          <label for="ct-whd-sa">Service Area:</label>
          <select id="ct-whd-sa" class="ct-select" aria-label="Service Area"></select>
          <button class="ct-btn ct-btn--accent" id="ct-whd-go">\u{1F50D} Abfragen</button>
          <button class="ct-btn ct-btn--primary" id="ct-whd-export">\u{1F4CB} CSV Export</button>
          <button class="ct-btn ct-btn--close" id="ct-whd-close">\u2715 Schlie\xDFen</button>
        </div>
        <div id="ct-whd-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-whd-body"></div>
      </div>
    `;
      document.body.appendChild(overlay);
      this._overlayEl = overlay;
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay)
          this.hide();
      });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape")
          this.hide();
      });
      document.getElementById("ct-whd-close").addEventListener("click", () => this.hide());
      document.getElementById("ct-whd-go").addEventListener("click", () => this._fetchData());
      document.getElementById("ct-whd-export").addEventListener("click", () => this._exportCSV());
      this.companyConfig.load().then(() => {
        this.companyConfig.populateSaSelect(document.getElementById("ct-whd-sa"));
      });
      onDispose(() => this.dispose());
      log("Working Hours Dashboard initialized");
    }
    dispose() {
      var _a, _b;
      (_a = this._overlayEl) == null ? void 0 : _a.remove();
      this._overlayEl = null;
      (_b = this._detailEl) == null ? void 0 : _b.remove();
      this._detailEl = null;
      this._data = [];
      this._active = false;
    }
    toggle() {
      if (!this.config.features.workingHours) {
        alert("Working Hours Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");
        return;
      }
      this.init();
      if (this._active)
        this.hide();
      else
        this.show();
    }
    show() {
      this.init();
      this._overlayEl.classList.add("visible");
      this._active = true;
      document.getElementById("ct-whd-date").focus();
    }
    hide() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.classList.remove("visible");
      this._active = false;
    }
    // ── Driver name resolution ─────────────────────────────────────────────────
    async _resolveDriverNames(rows, date, serviceAreaId) {
      const allIds = [...new Set(rows.map((r) => r.transporterId).filter((id) => id != null))];
      const uncached = allIds.filter((id) => !this._driverCache.has(id));
      if (uncached.length > 0) {
        try {
          const queryDate = /* @__PURE__ */ new Date(date + "T00:00:00");
          const fromDate = new Date(queryDate);
          fromDate.setDate(fromDate.getDate() - 7);
          const toDate = new Date(queryDate);
          toDate.setDate(toDate.getDate() + 1);
          const url = `https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${fromDate.toISOString().split("T")[0]}&toDate=${toDate.toISOString().split("T")[0]}&serviceAreaId=${serviceAreaId}`;
          const csrf = getCSRFToken();
          const headers = { Accept: "application/json" };
          if (csrf)
            headers["anti-csrftoken-a2z"] = csrf;
          const resp = await fetch(url, { method: "GET", headers, credentials: "include" });
          if (resp.ok) {
            const json = await resp.json();
            const roster = Array.isArray(json) ? json : (json == null ? void 0 : json.data) || (json == null ? void 0 : json.rosters) || [];
            const processEntries = (entries) => {
              for (const entry of entries) {
                if (entry["driverPersonId"] && entry["driverName"]) {
                  this._driverCache.set(String(entry["driverPersonId"]), entry["driverName"]);
                }
              }
            };
            if (Array.isArray(roster))
              processEntries(roster);
            else if (typeof roster === "object") {
              for (const val of Object.values(roster)) {
                if (Array.isArray(val))
                  processEntries(val);
              }
            }
            log(`[WHD] Roster loaded: ${this._driverCache.size} driver names cached`);
          }
        } catch (e) {
          log("[WHD] Roster lookup failed (non-fatal):", e);
        }
      }
      for (const row of rows) {
        if (row.transporterId) {
          row.driverName = this._driverCache.get(row.transporterId) || null;
        }
      }
    }
    // ── Data Fetching ──────────────────────────────────────────────────────────
    async _fetchData() {
      var _a, _b, _c, _d;
      const date = (_a = document.getElementById("ct-whd-date")) == null ? void 0 : _a.value;
      const sel = document.getElementById("ct-whd-sa");
      const serviceAreaId = sel && sel.value ? sel.value : this.companyConfig.getDefaultServiceAreaId();
      if (!date) {
        this._setStatus("\u26A0\uFE0F Bitte Datum ausw\xE4hlen.");
        return;
      }
      if (!serviceAreaId) {
        this._setStatus("\u26A0\uFE0F Bitte Service Area ausw\xE4hlen.");
        return;
      }
      this._setStatus(`\u23F3 Lade Daten f\xFCr ${date}\u2026`);
      this._setBody('<div class="ct-whd-loading" role="status">Daten werden geladen\u2026</div>');
      try {
        const apiUrl = `https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${date}&serviceAreaId=${serviceAreaId}`;
        const resp = await withRetry(async () => {
          const r = await fetch(apiUrl, {
            method: "GET",
            credentials: "same-origin",
            headers: {
              Accept: "application/json, text/plain, */*",
              "Accept-Language": "de,en-US;q=0.7,en;q=0.3",
              "user-ref": "cortex-webapp-user",
              "X-Cortex-Timestamp": Date.now().toString(),
              "X-Cortex-Session": extractSessionFromCookie() ?? "",
              Referer: location.href
            }
          });
          if (!r.ok)
            throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r;
        }, { retries: 2, baseMs: 800 });
        const json = await resp.json();
        const summaries = (json == null ? void 0 : json.itinerarySummaries) || (json == null ? void 0 : json.summaries) || ((_b = json == null ? void 0 : json.data) == null ? void 0 : _b.itinerarySummaries) || (json == null ? void 0 : json.data) || (Array.isArray(json) ? json : []);
        if (summaries.length === 0) {
          this._data = [];
          this._setBody(`<div class="ct-whd-empty">\u{1F4ED} Keine Itineraries gefunden.<br><small>Bitte Datum/Service Area pr\xFCfen.</small></div>`);
          this._setStatus("\u26A0\uFE0F Keine Daten f\xFCr diesen Tag/Service Area.");
          return;
        }
        this._data = summaries.map(whdExtractRow);
        this._setStatus(`\u23F3 ${this._data.length} Itineraries geladen, lade Fahrernamen\u2026`);
        await this._resolveDriverNames(this._data, date, serviceAreaId);
        this._page = 1;
        this._sort = { column: "routeCode", direction: "asc" };
        this._renderTable();
        const stationCode = ((_c = this.companyConfig.getServiceAreas().find((sa) => sa.serviceAreaId === serviceAreaId)) == null ? void 0 : _c.stationCode) || serviceAreaId;
        const resolvedCount = this._data.filter((r) => r.driverName !== null).length;
        this._setStatus(`\u2705 ${this._data.length} Itineraries geladen \u2014 ${date} / ${stationCode} | ${resolvedCount} Fahrer zugeordnet`);
      } catch (e) {
        err("WHD fetch failed:", e);
        this._data = [];
        this._setBody(`<div class="ct-whd-error" role="alert">\u274C Daten konnten nicht geladen werden.<br><small>${esc(e.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-whd-retry">\u{1F504} Erneut versuchen</button></div>`);
        this._setStatus("\u274C Fehler beim Laden.");
        (_d = document.getElementById("ct-whd-retry")) == null ? void 0 : _d.addEventListener("click", () => this._fetchData());
      }
    }
    // ── Table Rendering ────────────────────────────────────────────────────────
    _renderTable() {
      const sorted = whdSortRows(this._data, this._sort.column, this._sort.direction);
      const totalPages = Math.max(1, Math.ceil(sorted.length / this._pageSize));
      if (this._page > totalPages)
        this._page = totalPages;
      const start = (this._page - 1) * this._pageSize;
      const slice = sorted.slice(start, start + this._pageSize);
      const thSortIcon = (col) => {
        if (this._sort.column !== col)
          return "";
        return `<span class="ct-whd-sort-icon">${this._sort.direction === "asc" ? "\u25B2" : "\u25BC"}</span>`;
      };
      const ariaSort = (col) => {
        if (this._sort.column !== col)
          return "none";
        return this._sort.direction === "asc" ? "ascending" : "descending";
      };
      const thHtml = WHD_COLUMNS.map(
        (h) => `<th scope="col" role="columnheader" aria-sort="${ariaSort(h.key)}" data-sort="${h.key}" title="Sort by ${esc(h.label)}">
        ${esc(h.label)}${thSortIcon(h.key)}
      </th>`
      ).join("");
      const trHtml = slice.map((row) => {
        const cells = WHD_COLUMNS.map((h) => {
          const val = row[h.key];
          if (h.key === "driverName") {
            return val === null || val === void 0 ? '<td class="ct-whd-driver ct-nodata">Unassigned</td>' : `<td class="ct-whd-driver">${esc(String(val))}</td>`;
          }
          if (val === null || val === void 0)
            return '<td class="ct-nodata">\u2014</td>';
          switch (h.type) {
            case "duration":
              return `<td>${esc(whdFormatDuration(val))}</td>`;
            case "time":
              return `<td>${esc(whdFormatTime(val))}</td>`;
            default:
              return `<td>${esc(String(val))}</td>`;
          }
        }).join("");
        return `<tr data-itinerary-id="${esc(row.itineraryId || "")}" role="row" tabindex="0">${cells}</tr>`;
      }).join("");
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
    _attachTableHandlers() {
      var _a, _b;
      const body = document.getElementById("ct-whd-body");
      if (!body)
        return;
      body.querySelectorAll("th[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
          const col = th.dataset["sort"];
          if (this._sort.column === col) {
            this._sort.direction = this._sort.direction === "asc" ? "desc" : "asc";
          } else {
            this._sort.column = col;
            this._sort.direction = "asc";
          }
          this._renderTable();
        });
      });
      body.querySelectorAll("tr[data-itinerary-id]").forEach((tr) => {
        tr.addEventListener("click", () => {
          const id = tr.dataset["itineraryId"];
          if (id)
            this._showDetail(id);
        });
        tr.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            const id = tr.dataset["itineraryId"];
            if (id)
              this._showDetail(id);
          }
        });
      });
      (_a = body.querySelector(".ct-whd-prev")) == null ? void 0 : _a.addEventListener("click", () => {
        if (this._page > 1) {
          this._page--;
          this._renderTable();
        }
      });
      (_b = body.querySelector(".ct-whd-next")) == null ? void 0 : _b.addEventListener("click", () => {
        const totalPages = Math.ceil(this._data.length / this._pageSize);
        if (this._page < totalPages) {
          this._page++;
          this._renderTable();
        }
      });
    }
    _renderPagination(total, current, totalPages) {
      if (totalPages <= 1)
        return "";
      return `
      <div class="ct-whd-pagination">
        <button class="ct-btn ct-btn--secondary ct-whd-prev" ${current <= 1 ? "disabled" : ""} aria-label="Vorherige Seite">\u2039 Zur\xFCck</button>
        <span class="ct-whd-page-info">Seite ${current} / ${totalPages} (${total} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-whd-next" ${current >= totalPages ? "disabled" : ""} aria-label="N\xE4chste Seite">Weiter \u203A</button>
      </div>`;
    }
    _showDetail(itineraryId) {
      var _a;
      const row = this._data.find((r) => r.itineraryId === itineraryId);
      if (!row)
        return;
      (_a = this._detailEl) == null ? void 0 : _a.remove();
      this._detailEl = null;
      const formatForDisplay = (field, value) => {
        if (value === null || value === void 0)
          return "\u2014";
        switch (field.format) {
          case "time":
            return whdFormatTime(value);
          case "duration":
            return whdFormatDuration(value);
          case "integer":
            return String(value) + (field.suffix || "");
          default:
            return String(value);
        }
      };
      const fieldsHtml = WHD_DETAIL_FIELDS.map((f) => {
        const displayValue = formatForDisplay(f, row[f.key]);
        return `<div class="ct-whd-detail-row">
        <div>
          <span class="ct-whd-detail-label">${esc(f.label)}</span><br>
          <span class="ct-whd-detail-value">${esc(displayValue)}</span>
        </div>
        <button class="ct-whd-copy-btn" data-copy-value="${esc(displayValue)}" aria-label="Copy ${esc(f.label)}">\u{1F4CB} Copy</button>
      </div>`;
      }).join("");
      const allText = WHD_DETAIL_FIELDS.map((f) => `${f.label}: ${formatForDisplay(f, row[f.key])}`).join("\n");
      const modal = document.createElement("div");
      modal.className = "ct-overlay visible";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.innerHTML = `
      <div class="ct-dialog" style="min-width:420px;max-width:580px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;color:var(--ct-primary);">\u{1F4CB} Itinerary Details</h3>
          <button class="ct-btn ct-btn--close" id="ct-whd-detail-close" aria-label="Close" style="margin-left:auto;">\u2715</button>
        </div>
        ${fieldsHtml}
        <div style="margin-top:16px;text-align:center;">
          <button class="ct-btn ct-btn--primary" id="ct-whd-copy-all">\u{1F4CB} Copy All</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
      this._detailEl = modal;
      const closeModal = () => {
        modal.remove();
        this._detailEl = null;
      };
      modal.addEventListener("click", (e) => {
        if (e.target === modal)
          closeModal();
      });
      document.getElementById("ct-whd-detail-close").addEventListener("click", closeModal);
      modal.addEventListener("keydown", (e) => {
        if (e.key === "Escape")
          closeModal();
      });
      modal.querySelectorAll(".ct-whd-copy-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const val = btn.dataset["copyValue"];
          navigator.clipboard.writeText(val).then(() => {
            const orig = btn.textContent;
            btn.textContent = "\u2705 Copied!";
            setTimeout(() => {
              btn.textContent = orig;
            }, 1500);
          }).catch(() => {
            btn.textContent = "\u26A0\uFE0F Failed";
            setTimeout(() => {
              btn.textContent = "\u{1F4CB} Copy";
            }, 1500);
          });
        });
      });
      document.getElementById("ct-whd-copy-all").addEventListener("click", () => {
        const btn = document.getElementById("ct-whd-copy-all");
        navigator.clipboard.writeText(allText).then(() => {
          btn.textContent = "\u2705 All Copied!";
          setTimeout(() => {
            btn.textContent = "\u{1F4CB} Copy All";
          }, 1500);
        }).catch(() => {
          btn.textContent = "\u26A0\uFE0F Failed";
          setTimeout(() => {
            btn.textContent = "\u{1F4CB} Copy All";
          }, 1500);
        });
      });
      document.getElementById("ct-whd-detail-close").focus();
    }
    _exportCSV() {
      var _a, _b;
      if (!this._data || this._data.length === 0) {
        alert("Bitte zuerst Daten laden.");
        return;
      }
      const sep = ";";
      const csvHeaders = ["routeCode", "serviceTypeName", "blockDurationInMinutes", "waveStartTime", "itineraryStartTime", "plannedDepartureTime", "actualDepartureTime", "plannedOutboundStemTime", "actualOutboundStemTime", "lastDriverEventTime", "itineraryId"];
      let csv = csvHeaders.join(sep) + "\n";
      const sorted = whdSortRows(this._data, this._sort.column, this._sort.direction);
      for (const row of sorted) {
        const cells = csvHeaders.map((h) => {
          const val = row[h];
          if (val === null || val === void 0)
            return "";
          if (h === "plannedOutboundStemTime" || h === "actualOutboundStemTime")
            return whdFormatDuration(val);
          if (h === "routeCode" || h === "serviceTypeName" || h === "itineraryId" || h === "blockDurationInMinutes")
            return String(val);
          return whdFormatTime(val);
        });
        csv += cells.join(sep) + "\n";
      }
      const date = ((_a = document.getElementById("ct-whd-date")) == null ? void 0 : _a.value) || todayStr();
      const sel = document.getElementById("ct-whd-sa");
      const saId = sel && sel.value ? sel.value : "";
      const stationCode = ((_b = this.companyConfig.getServiceAreas().find((sa) => sa.serviceAreaId === saId)) == null ? void 0 : _b.stationCode) || "unknown";
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `working_hours_${date}_${stationCode}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    _setStatus(msg) {
      const el = document.getElementById("ct-whd-status");
      if (el)
        el.textContent = msg;
    }
    _setBody(html) {
      const el = document.getElementById("ct-whd-body");
      if (el)
        el.innerHTML = html;
    }
  };

  // src/features/returns-dashboard.ts
  function retFormatTimestamp(epochMs) {
    if (!epochMs)
      return "\u2014";
    try {
      return new Date(Number(epochMs)).toLocaleString("de-DE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "\u2014";
    }
  }
  function retGetCoords(pkg) {
    var _a, _b;
    const addr = pkg["address"] || {};
    const lat = addr["geocodeLatitude"] ?? ((_a = addr["geocode"]) == null ? void 0 : _a["latitude"]);
    const lon = addr["geocodeLongitude"] ?? ((_b = addr["geocode"]) == null ? void 0 : _b["longitude"]);
    if (lat != null && lon != null)
      return { lat: Number(lat), lon: Number(lon) };
    return null;
  }
  function retReasonClass(code) {
    if (!code)
      return "ct-ret-card-reason--ok";
    const c = String(code).toUpperCase();
    if (c.includes("DAMAGE") || c.includes("DEFECT"))
      return "ct-ret-card-reason--error";
    if (c.includes("CUSTOMER") || c.includes("REFUSAL"))
      return "ct-ret-card-reason--warn";
    return "ct-ret-card-reason--ok";
  }
  var ReturnsDashboard = class {
    constructor(config, companyConfig) {
      this.config = config;
      this.companyConfig = companyConfig;
    }
    _overlayEl = null;
    _active = false;
    _allPackages = [];
    _filteredPackages = [];
    _page = 1;
    _pageSize = 50;
    _sort = { field: "lastUpdatedTime", direction: "desc" };
    _filters = { search: "", city: "", postalCode: "", routeCode: "", reasonCode: "" };
    _viewMode = "table";
    _cache = /* @__PURE__ */ new Map();
    _cacheExpiry = 5 * 60 * 1e3;
    _transporterCache = /* @__PURE__ */ new Map();
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    init() {
      if (this._overlayEl)
        return;
      const today = todayStr();
      const overlay = document.createElement("div");
      overlay.id = "ct-ret-overlay";
      overlay.className = "ct-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Returns Dashboard");
      overlay.innerHTML = `
      <div class="ct-ret-panel">
        <h2>\u{1F4E6} Returns Dashboard</h2>
        <div class="ct-ret-controls">
          <label for="ct-ret-date">Datum:</label>
          <input type="date" id="ct-ret-date" class="ct-input" value="${today}">
          <label for="ct-ret-sa">Service Area:</label>
          <select id="ct-ret-sa" class="ct-select"></select>
          <label style="display:flex;align-items:center;gap:4px;margin-left:8px;">
            <input type="checkbox" id="ct-ret-routeview" checked> RouteView
          </label>
          <button class="ct-btn ct-btn--accent" id="ct-ret-go">\u{1F50D} Laden</button>
          <button class="ct-btn ct-btn--primary" id="ct-ret-export">\u{1F4CB} Export</button>
          <button class="ct-btn ct-btn--close" id="ct-ret-close">\u2715 Schlie\xDFen</button>
        </div>
        <div id="ct-ret-filters" class="ct-ret-filters">
          <input type="text" class="ct-input ct-ret-search" id="ct-ret-search" placeholder="ScannableId suchen..." aria-label="Suche">
          <div class="ct-ret-filter-group"><label>Stadt:</label><input type="text" class="ct-input" id="ct-ret-city" placeholder="Filter Stadt" style="width:100px"></div>
          <div class="ct-ret-filter-group"><label>PLZ:</label><input type="text" class="ct-input" id="ct-ret-postal" placeholder="PLZ" style="width:80px"></div>
          <div class="ct-ret-filter-group"><label>Route:</label><input type="text" class="ct-input" id="ct-ret-route" placeholder="Route" style="width:80px"></div>
          <div class="ct-ret-filter-group"><label>Reason:</label><input type="text" class="ct-input" id="ct-ret-reason" placeholder="Reason Code" style="width:80px"></div>
          <button class="ct-btn ct-btn--secondary" id="ct-ret-clear-filters">\u2715 Filter</button>
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
            <button id="ct-ret-view-table" class="active">\u{1F4CB} Tabelle</button>
            <button id="ct-ret-view-cards">\u25A6 Karten</button>
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
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay)
          this.hide();
      });
      document.getElementById("ct-ret-close").addEventListener("click", () => this.hide());
      document.getElementById("ct-ret-go").addEventListener("click", () => this._loadData());
      document.getElementById("ct-ret-export").addEventListener("click", () => this._exportCSV());
      document.getElementById("ct-ret-clear-filters").addEventListener("click", () => this._clearFilters());
      ["ct-ret-search", "ct-ret-city", "ct-ret-postal", "ct-ret-route", "ct-ret-reason"].forEach((id) => {
        document.getElementById(id).addEventListener("input", () => this._applyFilters());
      });
      ["ct-ret-sort-field", "ct-ret-sort-dir"].forEach((id) => {
        document.getElementById(id).addEventListener("change", () => this._applyFilters());
      });
      document.getElementById("ct-ret-view-table").addEventListener("click", () => {
        this._viewMode = "table";
        this._updateViewToggle();
        this._renderCards();
      });
      document.getElementById("ct-ret-view-cards").addEventListener("click", () => {
        this._viewMode = "cards";
        this._updateViewToggle();
        this._renderCards();
      });
      this._initSaDropdown();
      onDispose(() => this.dispose());
      log("Returns Dashboard initialized");
    }
    dispose() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.remove();
      this._overlayEl = null;
      this._allPackages = [];
      this._filteredPackages = [];
      this._active = false;
    }
    toggle() {
      if (!this.config.features.returnsDashboard) {
        alert("Returns Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");
        return;
      }
      this.init();
      if (this._active)
        this.hide();
      else
        this.show();
    }
    show() {
      this.init();
      this._overlayEl.classList.add("visible");
      this._active = true;
      document.getElementById("ct-ret-date").focus();
    }
    hide() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.classList.remove("visible");
      this._active = false;
    }
    // ── SA dropdown ────────────────────────────────────────────────────────────
    async _initSaDropdown() {
      const select = document.getElementById("ct-ret-sa");
      select.innerHTML = "";
      await this.companyConfig.load();
      const areas = this.companyConfig.getServiceAreas();
      const list = areas.length > 0 ? areas : [];
      const defaultId = this.companyConfig.getDefaultServiceAreaId();
      list.forEach((sa) => {
        const opt = document.createElement("option");
        opt.value = sa.serviceAreaId;
        opt.textContent = sa.stationCode;
        if (sa.serviceAreaId === defaultId)
          opt.selected = true;
        select.appendChild(opt);
      });
    }
    // ── Driver name resolution ─────────────────────────────────────────────────
    async _resolveTransporterNames(packages, date, serviceAreaId) {
      const ids = [...new Set(packages.map((p) => p["transporterId"]).filter((id) => id != null))];
      if (ids.length === 0)
        return;
      const uncached = ids.filter((id) => !this._transporterCache.has(id));
      if (uncached.length > 0) {
        try {
          const queryDate = /* @__PURE__ */ new Date(date + "T00:00:00");
          const fromDate = new Date(queryDate);
          fromDate.setDate(fromDate.getDate() - 7);
          const toDate = new Date(queryDate);
          toDate.setDate(toDate.getDate() + 1);
          const url = `https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${fromDate.toISOString().split("T")[0]}&toDate=${toDate.toISOString().split("T")[0]}&serviceAreaId=${serviceAreaId}`;
          const csrf = getCSRFToken();
          const headers = { Accept: "application/json" };
          if (csrf)
            headers["anti-csrftoken-a2z"] = csrf;
          const resp = await fetch(url, { method: "GET", headers, credentials: "include" });
          if (resp.ok) {
            const json = await resp.json();
            const roster = Array.isArray(json) ? json : (json == null ? void 0 : json.data) || (json == null ? void 0 : json.rosters) || [];
            const processEntries = (entries) => {
              for (const entry of entries) {
                if (entry["driverPersonId"] && entry["driverName"]) {
                  this._transporterCache.set(String(entry["driverPersonId"]), entry["driverName"]);
                }
              }
            };
            if (Array.isArray(roster))
              processEntries(roster);
            else if (typeof roster === "object") {
              for (const val of Object.values(roster)) {
                if (Array.isArray(val))
                  processEntries(val);
              }
            }
            log(`[Returns] Roster loaded: ${this._transporterCache.size} driver names cached`);
          }
        } catch (e) {
          log("[Returns] Roster lookup failed:", e);
        }
      }
    }
    // ── Data loading ───────────────────────────────────────────────────────────
    async _loadData() {
      var _a;
      const date = document.getElementById("ct-ret-date").value;
      const serviceAreaId = document.getElementById("ct-ret-sa").value;
      const routeView = document.getElementById("ct-ret-routeview").checked;
      if (!date) {
        this._setStatus("\u26A0\uFE0F Bitte Datum ausw\xE4hlen.");
        return;
      }
      if (!serviceAreaId) {
        this._setStatus("\u26A0\uFE0F Bitte Service Area ausw\xE4hlen.");
        return;
      }
      const cacheKey = `${date}|${serviceAreaId}`;
      const cached = this._cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this._cacheExpiry) {
        log("Returns: using cached data");
        this._allPackages = cached.data;
        this._applyFilters();
        this._setStatus(`\u2705 ${this._allPackages.length} Pakete aus Cache geladen`);
        return;
      }
      this._setStatus("\u23F3 Lade Returns-Daten\u2026");
      this._setBody('<div class="ct-ret-loading">Daten werden geladen\u2026</div>');
      const params = new URLSearchParams({
        historicalDay: "false",
        localDate: date,
        packageStatus: "RETURNED",
        routeView: String(routeView),
        serviceAreaId,
        statsFromSummaries: "true"
      });
      try {
        const resp = await withRetry(async () => {
          const r = await fetch(`https://logistics.amazon.de/operations/execution/api/packages/packagesByStatus?${params}`, {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json, text/plain, */*", "Accept-Language": "de,en-US;q=0.7,en;q=0.3", Referer: location.href }
          });
          if (!r.ok)
            throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r;
        }, { retries: 3, baseMs: 500 });
        const json = await resp.json();
        const packages = Array.isArray(json == null ? void 0 : json.packages) ? json.packages : [];
        this._cache.set(cacheKey, { data: packages, timestamp: Date.now() });
        this._allPackages = packages;
        this._setStatus(`\u23F3 ${packages.length} Pakete geladen, lade Fahrernamen\u2026`);
        await this._resolveTransporterNames(packages, date, serviceAreaId);
        this._page = 1;
        this._applyFilters();
        this._setStatus(`\u2705 ${packages.length} Pakete geladen f\xFCr ${date}`);
      } catch (e) {
        err("Returns fetch failed:", e);
        this._setBody(`<div class="ct-ret-error" role="alert">\u274C Daten konnten nicht geladen werden.<br><small>${esc(e.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-ret-retry">\u{1F504} Erneut versuchen</button></div>`);
        this._setStatus("\u274C Fehler beim Laden.");
        (_a = document.getElementById("ct-ret-retry")) == null ? void 0 : _a.addEventListener("click", () => this._loadData());
      }
    }
    // ── Filters ────────────────────────────────────────────────────────────────
    _clearFilters() {
      ["ct-ret-search", "ct-ret-city", "ct-ret-postal", "ct-ret-route", "ct-ret-reason"].forEach((id) => {
        document.getElementById(id).value = "";
      });
      this._filters = { search: "", city: "", postalCode: "", routeCode: "", reasonCode: "" };
      this._applyFilters();
    }
    _applyFilters() {
      this._filters = {
        search: (document.getElementById("ct-ret-search").value || "").toLowerCase().trim(),
        city: (document.getElementById("ct-ret-city").value || "").toLowerCase().trim(),
        postalCode: (document.getElementById("ct-ret-postal").value || "").toLowerCase().trim(),
        routeCode: (document.getElementById("ct-ret-route").value || "").toLowerCase().trim(),
        reasonCode: (document.getElementById("ct-ret-reason").value || "").toLowerCase().trim()
      };
      const sortField = document.getElementById("ct-ret-sort-field").value;
      const sortDir = document.getElementById("ct-ret-sort-dir").value;
      this._filteredPackages = this._allPackages.filter((pkg) => {
        const addr = pkg["address"] || {};
        if (this._filters.search && !String(pkg["scannableId"] || "").toLowerCase().includes(this._filters.search))
          return false;
        if (this._filters.city && !String(addr["city"] || "").toLowerCase().includes(this._filters.city))
          return false;
        if (this._filters.postalCode && !String(addr["postalCode"] || "").toLowerCase().includes(this._filters.postalCode))
          return false;
        if (this._filters.routeCode && !String(pkg["routeCode"] || "").toLowerCase().includes(this._filters.routeCode))
          return false;
        if (this._filters.reasonCode && !String(pkg["reasonCode"] || "").toLowerCase().includes(this._filters.reasonCode))
          return false;
        return true;
      });
      this._filteredPackages.sort((a, b) => {
        var _a, _b;
        let va = a[sortField], vb = b[sortField];
        let va2, vb2;
        if (sortField === "lastUpdatedTime") {
          va2 = Number(va) || 0;
          vb2 = Number(vb) || 0;
        } else if (sortField === "city") {
          va2 = (((_a = a["address"]) == null ? void 0 : _a["city"]) || "").toString().toLowerCase();
          vb2 = (((_b = b["address"]) == null ? void 0 : _b["city"]) || "").toString().toLowerCase();
        } else if (sortField === "routeCode") {
          va2 = (a["routeCode"] || "").toString().toLowerCase();
          vb2 = (b["routeCode"] || "").toString().toLowerCase();
        } else {
          va2 = (va || "").toString().toLowerCase();
          vb2 = (vb || "").toString().toLowerCase();
        }
        if (va2 < vb2)
          return sortDir === "asc" ? -1 : 1;
        if (va2 > vb2)
          return sortDir === "asc" ? 1 : -1;
        return 0;
      });
      this._renderStats();
      this._renderCards();
    }
    _renderStats() {
      const total = this._allPackages.length;
      const filtered = this._filteredPackages.length;
      const el = document.getElementById("ct-ret-count");
      if (el)
        el.textContent = filtered === total ? `${total} Pakete` : `${filtered} von ${total} Paketen`;
    }
    _updateViewToggle() {
      document.getElementById("ct-ret-view-table").classList.toggle("active", this._viewMode === "table");
      document.getElementById("ct-ret-view-cards").classList.toggle("active", this._viewMode === "cards");
    }
    // ── Rendering ──────────────────────────────────────────────────────────────
    _renderCards() {
      const totalPages = Math.ceil(this._filteredPackages.length / this._pageSize);
      if (this._page > totalPages)
        this._page = Math.max(1, totalPages);
      const start = (this._page - 1) * this._pageSize;
      const slice = this._filteredPackages.slice(start, start + this._pageSize);
      if (slice.length === 0) {
        this._setBody('<div class="ct-ret-empty">Keine Returns f\xFCr die gew\xE4hlten Filter gefunden.</div>');
        this._renderPagination(0, 1, 1);
        return;
      }
      if (this._viewMode === "table") {
        this._renderTable(slice);
      } else {
        const cardsHtml = slice.map((pkg) => this._renderCard(pkg)).join("");
        this._setBody(`<div class="ct-ret-cards">${cardsHtml}</div>`);
      }
      this._renderPagination(this._filteredPackages.length, this._page, totalPages);
    }
    _renderTable(slice) {
      const rows = slice.map((pkg) => {
        const addr = pkg["address"] || {};
        const coords = retGetCoords(pkg);
        const transporterName = pkg["transporterId"] ? this._transporterCache.get(String(pkg["transporterId"])) || "\u2014" : "\u2014";
        return `<tr>
        <td title="${esc(pkg["scannableId"] || "")}">${esc(String(pkg["scannableId"] || "\u2014"))}</td>
        <td>${esc(transporterName)}</td>
        <td>${retFormatTimestamp(pkg["lastUpdatedTime"])}</td>
        <td>${esc(String(pkg["reasonCode"] || "\u2014"))}</td>
        <td>${esc(String(pkg["routeCode"] || "\u2014"))}</td>
        <td>${esc(String(addr["address1"] || ""))}</td>
        <td>${esc(String(addr["postalCode"] || ""))}</td>
        <td>${esc(String(addr["city"] || "\u2014"))}</td>
        <td>${coords ? `<a href="https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}" target="_blank" rel="noopener">\u{1F4CD}</a>` : "\u2014"}</td>
      </tr>`;
      }).join("");
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
    _renderCard(pkg) {
      const addr = pkg["address"] || {};
      const coords = retGetCoords(pkg);
      const mapLink = coords ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}` : null;
      const reason = String(pkg["reasonCode"] || "Unbekannt");
      const transporterName = pkg["transporterId"] ? this._transporterCache.get(String(pkg["transporterId"])) || "\u2014" : "\u2014";
      return `<div class="ct-ret-card">
      <div class="ct-ret-card-header">
        <span class="ct-ret-card-id">${esc(String(pkg["scannableId"] || "\u2014"))}</span>
        <span class="ct-ret-card-reason ${retReasonClass(pkg["reasonCode"])}">${esc(reason)}</span>
      </div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Transporter:</span><span class="ct-ret-card-value">${esc(transporterName)}</span></div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Aktualisiert:</span><span class="ct-ret-card-value">${retFormatTimestamp(pkg["lastUpdatedTime"])}</span></div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Route:</span><span class="ct-ret-card-value">${esc(String(pkg["routeCode"] || "\u2014"))}</span></div>
      <div class="ct-ret-card-address">
        ${esc(String(addr["address1"] || ""))}${addr["address2"] ? ", " + esc(String(addr["address2"])) : ""}<br>
        ${esc(String(addr["postalCode"] || ""))} ${esc(String(addr["city"] || ""))}
        ${coords ? `<br><small>\u{1F4CD} ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}</small>` : ""}
        ${mapLink ? `<a href="${mapLink}" class="ct-ret-card-map" target="_blank" rel="noopener">\u{1F4CD} In Karte \xF6ffnen</a>` : ""}
      </div>
    </div>`;
    }
    _renderPagination(total, current, totalPages) {
      var _a, _b, _c, _d, _e;
      const el = document.getElementById("ct-ret-body");
      if (!el)
        return;
      const existing = (_a = el.parentNode) == null ? void 0 : _a.querySelector(".ct-ret-pagination");
      if (existing)
        existing.remove();
      if (totalPages <= 1)
        return;
      el.insertAdjacentHTML("afterend", `
      <div class="ct-ret-pagination">
        <button class="ct-btn ct-btn--secondary ct-ret-prev" ${current <= 1 ? "disabled" : ""}>\u2039 Zur\xFCck</button>
        <span class="ct-ret-page-info">Seite ${current} / ${totalPages} (${total} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-ret-next" ${current >= totalPages ? "disabled" : ""}>Weiter \u203A</button>
      </div>`);
      (_c = (_b = el.parentNode) == null ? void 0 : _b.querySelector(".ct-ret-prev")) == null ? void 0 : _c.addEventListener("click", () => {
        if (this._page > 1) {
          this._page--;
          this._renderCards();
        }
      });
      (_e = (_d = el.parentNode) == null ? void 0 : _d.querySelector(".ct-ret-next")) == null ? void 0 : _e.addEventListener("click", () => {
        if (this._page < totalPages) {
          this._page++;
          this._renderCards();
        }
      });
    }
    _exportCSV() {
      if (this._filteredPackages.length === 0) {
        alert("Keine Daten zum Exportieren.");
        return;
      }
      const headers = ["scannableId", "transporter", "lastUpdatedTime", "reasonCode", "routeCode", "address1", "address2", "city", "postalCode", "latitude", "longitude"];
      let csv = headers.join(";") + "\n";
      for (const pkg of this._filteredPackages) {
        const addr = pkg["address"] || {};
        const coords = retGetCoords(pkg);
        const transporterName = pkg["transporterId"] ? this._transporterCache.get(String(pkg["transporterId"])) || "" : "";
        const row = [
          pkg["scannableId"] || "",
          transporterName,
          retFormatTimestamp(pkg["lastUpdatedTime"]),
          pkg["reasonCode"] || "",
          pkg["routeCode"] || "",
          addr["address1"] || "",
          addr["address2"] || "",
          addr["city"] || "",
          addr["postalCode"] || "",
          (coords == null ? void 0 : coords.lat) ?? "",
          (coords == null ? void 0 : coords.lon) ?? ""
        ];
        csv += row.map((v) => String(v).replace(/;/g, ",")).join(";") + "\n";
      }
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `returns_${todayStr()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
    _setStatus(msg) {
      const el = document.getElementById("ct-ret-status");
      if (el)
        el.textContent = msg;
    }
    _setBody(html) {
      const el = document.getElementById("ct-ret-body");
      if (el)
        el.innerHTML = html;
    }
  };

  // src/features/scorecard.ts
  function scConvertToDecimal(value) {
    if (value === void 0 || value === null)
      return NaN;
    const s = String(value).trim();
    if (s === "-" || s === "")
      return NaN;
    const number = parseFloat(s.replace(",", "."));
    return isNaN(number) ? NaN : number;
  }
  function scParseRow(jsonStr) {
    const raw = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k.trim()] = v;
    }
    const dcrRatio = out["dcr_metric"] !== void 0 ? Number(out["dcr_metric"]) : NaN;
    const podRatio = out["pod_metric"] !== void 0 ? Number(out["pod_metric"]) : NaN;
    const ccRatio = out["cc_metric"] !== void 0 ? Number(out["cc_metric"]) : NaN;
    return {
      transporterId: String(out["country_program_providerid_stationcode"] || out["dsp_code"] || ""),
      delivered: String(out["delivered"] || "0"),
      dcr: isNaN(dcrRatio) ? "-" : (dcrRatio * 100).toFixed(2),
      dnrDpmo: String(out["dnr_dpmo"] ?? "0"),
      lorDpmo: String(out["lor_dpmo"] ?? "0"),
      pod: isNaN(podRatio) ? "-" : (podRatio * 100).toFixed(2),
      cc: isNaN(ccRatio) ? "-" : (ccRatio * 100).toFixed(2),
      ce: String(out["ce_metric"] ?? "0"),
      cdfDpmo: String(out["cdf_dpmo"] ?? "0"),
      daName: String(out["da_name"] || ""),
      week: String(out["week"] || ""),
      year: String(out["year"] || ""),
      stationCode: String(out["station_code"] || ""),
      dspCode: String(out["dsp_code"] || ""),
      dataDate: String(out["data_date"] || ""),
      country: String(out["country"] || ""),
      program: String(out["program"] || ""),
      region: String(out["region"] || ""),
      lastUpdated: String(out["last_updated_time"] || ""),
      _raw: out
    };
  }
  function scCalculateScore(row) {
    const dcr = (scConvertToDecimal(row.dcr === "-" ? "100" : row.dcr) || 0) / 100;
    const dnrDpmo = parseFloat(row.dnrDpmo) || 0;
    const lorDpmo = parseFloat(row.lorDpmo) || 0;
    const pod = (scConvertToDecimal(row.pod === "-" ? "100" : row.pod) || 0) / 100;
    const cc = (scConvertToDecimal(row.cc === "-" ? "100" : row.cc) || 0) / 100;
    const ce = parseFloat(row.ce) || 0;
    const cdfDpmo = parseFloat(row.cdfDpmo) || 0;
    const delivered = parseFloat(row.delivered) || 0;
    let totalScore = Math.max(Math.min(
      132.88 * dcr + 10 * Math.max(0, 1 - cdfDpmo / 1e4) - 24e-4 * dnrDpmo - 8.54 * ce + 10 * pod + 4 * cc + 45e-5 * delivered - 60.88,
      100
    ), 0);
    if (dcr === 1 && pod === 1 && cc === 1 && cdfDpmo === 0 && ce === 0 && dnrDpmo === 0 && lorDpmo === 0) {
      totalScore = 100;
    } else {
      let poorCount = 0;
      if (dcr * 100 < 97)
        poorCount++;
      if (dnrDpmo >= 1500)
        poorCount++;
      if (pod * 100 < 94)
        poorCount++;
      if (cc * 100 < 70)
        poorCount++;
      if (ce !== 0)
        poorCount++;
      if (cdfDpmo >= 8e3)
        poorCount++;
      if (poorCount >= 2 || poorCount === 1) {
        let severitySum = 0;
        if (dcr * 100 < 97)
          severitySum += (97 - dcr * 100) / 5;
        if (dnrDpmo >= 1500)
          severitySum += (dnrDpmo - 1500) / 1e3;
        if (pod * 100 < 94)
          severitySum += (94 - pod * 100) / 10;
        if (cc * 100 < 70)
          severitySum += (70 - cc * 100) / 50;
        if (ce !== 0)
          severitySum += ce * 1;
        if (cdfDpmo >= 8e3)
          severitySum += (cdfDpmo - 8e3) / 2e3;
        const penalty = Math.min(3, severitySum);
        totalScore = Math.min(totalScore, (poorCount >= 2 ? 70 : 85) - penalty);
      }
    }
    const roundedScore = parseFloat(totalScore.toFixed(2));
    const status = roundedScore < 40 ? "Poor" : roundedScore < 70 ? "Fair" : roundedScore < 85 ? "Great" : roundedScore < 93 ? "Fantastic" : "Fantastic Plus";
    return {
      transporterId: row.transporterId,
      delivered: row.delivered,
      dcr: (dcr * 100).toFixed(2),
      dnrDpmo: dnrDpmo.toFixed(2),
      lorDpmo: lorDpmo.toFixed(2),
      pod: (pod * 100).toFixed(2),
      cc: (cc * 100).toFixed(2),
      ce: ce.toFixed(2),
      cdfDpmo: cdfDpmo.toFixed(2),
      status,
      totalScore: roundedScore,
      daName: row.daName,
      week: row.week,
      year: row.year,
      stationCode: row.stationCode,
      dspCode: row.dspCode,
      dataDate: row.dataDate,
      lastUpdated: row.lastUpdated,
      originalData: { dcr: row.dcr, dnrDpmo: row.dnrDpmo, lorDpmo: row.lorDpmo, pod: row.pod, cc: row.cc, ce: row.ce, cdfDpmo: row.cdfDpmo }
    };
  }
  function scKpiClass(value, type) {
    switch (type) {
      case "DCR":
        return value < 97 ? "poor" : value < 98.5 ? "fair" : value < 99.5 ? "great" : "fantastic";
      case "DNRDPMO":
      case "LORDPMO":
        return value < 1100 ? "fantastic" : value < 1300 ? "great" : value < 1500 ? "fair" : "poor";
      case "POD":
        return value < 94 ? "poor" : value < 95.5 ? "fair" : value < 97 ? "great" : "fantastic";
      case "CC":
        return value < 70 ? "poor" : value < 95 ? "fair" : value < 98.5 ? "great" : "fantastic";
      case "CE":
        return value === 0 ? "fantastic" : "poor";
      case "CDFDPMO":
        return value > 5460 ? "poor" : value > 4450 ? "fair" : value > 3680 ? "great" : "fantastic";
      default:
        return "";
    }
  }
  function scStatusClass(status) {
    switch (status) {
      case "Poor":
        return "poor";
      case "Fair":
        return "fair";
      case "Great":
        return "great";
      case "Fantastic":
      case "Fantastic Plus":
        return "fantastic";
      default:
        return "";
    }
  }
  function scParseApiResponse(json) {
    try {
      const tableData = json == null ? void 0 : json["tableData"];
      const scData = tableData == null ? void 0 : tableData["da_dsp_station_weekly_quality"];
      const rows = scData == null ? void 0 : scData["rows"];
      if (!Array.isArray(rows) || rows.length === 0)
        return [];
      const parsed = [];
      for (let i = 0; i < rows.length; i++) {
        try {
          parsed.push(scParseRow(rows[i]));
        } catch (e) {
          err("Scorecard: failed to parse row", i, e);
        }
      }
      return parsed;
    } catch (e) {
      err("scParseApiResponse error:", e);
      return [];
    }
  }
  function scValidateWeek(week) {
    if (!week)
      return "Week is required.";
    if (!/^\d{4}-W\d{2}$/.test(week))
      return "Week format must be YYYY-Www (e.g. 2026-W12).";
    return null;
  }
  function scCurrentWeek() {
    const now = /* @__PURE__ */ new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }
  function scWeeksAgo(n) {
    const now = /* @__PURE__ */ new Date();
    now.setDate(now.getDate() - n * 7);
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
  }
  function _scImgKpiColor(value, type) {
    switch (type) {
      case "DCR":
        return value < 97 ? "rgb(235,50,35)" : value < 98.5 ? "rgb(223,130,68)" : value < 99.5 ? "rgb(126,170,85)" : "rgb(77,115,190)";
      case "DNRDPMO":
      case "LORDPMO":
        return value < 1100 ? "rgb(77,115,190)" : value < 1300 ? "rgb(126,170,85)" : value < 1500 ? "rgb(223,130,68)" : "rgb(235,50,35)";
      case "POD":
        return value < 94 ? "rgb(235,50,35)" : value < 95.5 ? "rgb(223,130,68)" : value < 97 ? "rgb(126,170,85)" : "rgb(77,115,190)";
      case "CC":
        return value < 70 ? "rgb(235,50,35)" : value < 95 ? "rgb(223,130,68)" : value < 98.5 ? "rgb(126,170,85)" : "rgb(77,115,190)";
      case "CE":
        return value === 0 ? "rgb(77,115,190)" : "rgb(235,50,35)";
      case "CDFDPMO":
        return value > 5460 ? "rgb(235,50,35)" : value > 4450 ? "rgb(223,130,68)" : value > 3680 ? "rgb(126,170,85)" : "rgb(77,115,190)";
      default:
        return "#111111";
    }
  }
  function _scImgStatusColor(status) {
    switch (status) {
      case "Poor":
        return "rgb(235,50,35)";
      case "Fair":
        return "rgb(223,130,68)";
      case "Great":
        return "rgb(126,170,85)";
      case "Fantastic":
      case "Fantastic Plus":
        return "rgb(77,115,190)";
      default:
        return "#111111";
    }
  }
  var ScorecardDashboard = class {
    constructor(config, companyConfig) {
      this.config = config;
      this.companyConfig = companyConfig;
    }
    _overlayEl = null;
    _active = false;
    _cache = /* @__PURE__ */ new Map();
    _calculatedData = [];
    _currentSort = { field: "totalScore", dir: "desc" };
    _currentPage = 0;
    _pageSize = 50;
    /** Expose pure helpers for unit testing */
    helpers = { scConvertToDecimal, scParseRow, scCalculateScore, scKpiClass, scStatusClass, scParseApiResponse, scValidateWeek, scCurrentWeek, scWeeksAgo };
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    init() {
      if (this._overlayEl)
        return;
      const curWeek = scCurrentWeek();
      const overlay = document.createElement("div");
      overlay.id = "ct-sc-overlay";
      overlay.className = "ct-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Scorecard Dashboard");
      overlay.innerHTML = `
      <div class="ct-sc-panel">
        <h2>\u{1F4CB} Scorecard</h2>
        <div class="ct-controls">
          <label for="ct-sc-week">Week:</label>
          <input type="text" id="ct-sc-week" class="ct-input" value="${curWeek}" placeholder="YYYY-Www" maxlength="8" style="width:100px">
          <label for="ct-sc-sa">Service Area:</label>
          <select id="ct-sc-sa" class="ct-input"><option value="">Wird geladen\u2026</option></select>
          <button class="ct-btn ct-btn--accent" id="ct-sc-go">\u{1F50D} Fetch</button>
          <button class="ct-btn ct-btn--primary" id="ct-sc-export">\u{1F4CB} CSV Export</button>
          <button class="ct-btn ct-btn--secondary" id="ct-sc-imgdl">\u{1F5BC} Download Image</button>
          <button class="ct-btn ct-btn--close" id="ct-sc-close">\u2715 Close</button>
        </div>
        <div id="ct-sc-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-sc-body"></div>
      </div>
    `;
      document.body.appendChild(overlay);
      this._overlayEl = overlay;
      this.companyConfig.load().then(() => {
        this.companyConfig.populateSaSelect(document.getElementById("ct-sc-sa"));
      });
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay)
          this.hide();
      });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape")
          this.hide();
      });
      document.getElementById("ct-sc-close").addEventListener("click", () => this.hide());
      document.getElementById("ct-sc-go").addEventListener("click", () => this._triggerFetch());
      document.getElementById("ct-sc-export").addEventListener("click", () => this._exportCSV());
      document.getElementById("ct-sc-imgdl").addEventListener("click", () => this._downloadAsImage());
      onDispose(() => this.dispose());
      log("Scorecard Dashboard initialized");
    }
    dispose() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.remove();
      this._overlayEl = null;
      this._active = false;
      this._cache.clear();
      this._calculatedData = [];
    }
    toggle() {
      if (!this.config.features.scorecard) {
        alert("Scorecard ist deaktiviert. Bitte in den Einstellungen aktivieren.");
        return;
      }
      this.init();
      if (this._active)
        this.hide();
      else
        this.show();
    }
    show() {
      this.init();
      this._overlayEl.classList.add("visible");
      this._active = true;
      document.getElementById("ct-sc-week").focus();
    }
    hide() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.classList.remove("visible");
      this._active = false;
    }
    // ── API ────────────────────────────────────────────────────────────────────
    _buildUrl(week, station, dsp) {
      return `https://logistics.amazon.de/performance/api/v1/getData?dataSetId=${encodeURIComponent("da_dsp_station_weekly_quality")}&dsp=${encodeURIComponent(dsp)}&from=${encodeURIComponent(week)}&station=${encodeURIComponent(station)}&timeFrame=Weekly&to=${encodeURIComponent(week)}`;
    }
    async _fetchData(week, station, dsp) {
      const cacheKey = `sc|${week}|${station}|${dsp}`;
      if (this._cache.has(cacheKey)) {
        log("Scorecard cache hit:", cacheKey);
        return this._cache.get(cacheKey);
      }
      const csrf = getCSRFToken();
      const headers = { Accept: "application/json" };
      if (csrf)
        headers["anti-csrftoken-a2z"] = csrf;
      const resp = await withRetry(async () => {
        const r = await fetch(this._buildUrl(week, station, dsp), { method: "GET", headers, credentials: "include" });
        if (!r.ok)
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r;
      }, { retries: 2, baseMs: 800 });
      const json = await resp.json();
      this._cache.set(cacheKey, json);
      if (this._cache.size > 50)
        this._cache.delete(this._cache.keys().next().value);
      return json;
    }
    // ── Trigger ────────────────────────────────────────────────────────────────
    async _triggerFetch() {
      var _a, _b;
      const week = document.getElementById("ct-sc-week").value.trim();
      const validErr = scValidateWeek(week);
      if (validErr) {
        this._setStatus("\u26A0\uFE0F " + validErr);
        return;
      }
      const saSelect = document.getElementById("ct-sc-sa");
      const station = ((_b = (_a = saSelect.options[saSelect.selectedIndex]) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim().toUpperCase()) || this.companyConfig.getDefaultStation();
      const dsp = this.companyConfig.getDspCode();
      this._setStatus("\u23F3 Loading\u2026");
      this._setBody('<div class="ct-sc-loading" role="status">Fetching scorecard data\u2026</div>');
      try {
        const json = await this._fetchData(week, station, dsp);
        const parsedRows = scParseApiResponse(json);
        if (parsedRows.length === 0) {
          this._setBody('<div class="ct-sc-empty">No data returned for the selected week.</div>');
          this._setStatus("\u26A0\uFE0F No records found.");
          return;
        }
        const calculated = parsedRows.map((row) => {
          try {
            return scCalculateScore(row);
          } catch (e) {
            err("Scorecard: failed to calculate score:", row, e);
            return null;
          }
        }).filter((r) => r !== null);
        if (calculated.length === 0) {
          this._setBody('<div class="ct-sc-error">All rows failed score calculation.</div>');
          this._setStatus("\u274C Calculation failed for all rows.");
          return;
        }
        calculated.sort((a, b) => b.totalScore - a.totalScore);
        this._calculatedData = calculated;
        this._currentPage = 0;
        this._currentSort = { field: "totalScore", dir: "desc" };
        this._renderAll();
        this._setStatus(`\u2705 ${calculated.length} record(s) loaded \u2014 ${week}`);
      } catch (e) {
        err("Scorecard fetch failed:", e);
        this._setBody(`<div class="ct-sc-error">\u274C ${esc(e.message)}</div>`);
        this._setStatus("\u274C Failed to load data.");
      }
    }
    _setStatus(msg) {
      const el = document.getElementById("ct-sc-status");
      if (el)
        el.textContent = msg;
    }
    _setBody(html) {
      const el = document.getElementById("ct-sc-body");
      if (el)
        el.innerHTML = html;
    }
    // ── Rendering ──────────────────────────────────────────────────────────────
    _renderAll() {
      var _a, _b;
      const data = this._calculatedData;
      if (!data.length)
        return;
      const avgScore = data.reduce((s, r) => s + r.totalScore, 0) / data.length;
      const counts = {};
      for (const r of data) {
        counts[r.status] = (counts[r.status] || 0) + 1;
      }
      const tilesHtml = `
      <div class="ct-sc-tiles">
        <div class="ct-sc-tile"><div class="ct-sc-tile-val">${data.length}</div><div class="ct-sc-tile-lbl">Total Records</div></div>
        <div class="ct-sc-tile"><div class="ct-sc-tile-val">${avgScore.toFixed(1)}</div><div class="ct-sc-tile-lbl">Avg Score</div></div>
        <div class="ct-sc-tile ct-sc-tile--fantastic"><div class="ct-sc-tile-val">${(counts["Fantastic"] || 0) + (counts["Fantastic Plus"] || 0)}</div><div class="ct-sc-tile-lbl">Fantastic(+)</div></div>
        <div class="ct-sc-tile ct-sc-tile--great"><div class="ct-sc-tile-val">${counts["Great"] || 0}</div><div class="ct-sc-tile-lbl">Great</div></div>
        <div class="ct-sc-tile ct-sc-tile--fair"><div class="ct-sc-tile-val">${counts["Fair"] || 0}</div><div class="ct-sc-tile-lbl">Fair</div></div>
        <div class="ct-sc-tile ct-sc-tile--poor"><div class="ct-sc-tile-val">${counts["Poor"] || 0}</div><div class="ct-sc-tile-lbl">Poor</div></div>
      </div>`;
      const start = this._currentPage * this._pageSize;
      const pageData = data.slice(start, Math.min(start + this._pageSize, data.length));
      const totalPages = Math.ceil(data.length / this._pageSize);
      const sortArrow = (field) => this._currentSort.field !== field ? "" : this._currentSort.dir === "asc" ? " \u25B2" : " \u25BC";
      const rowsHtml = pageData.map((row, i) => {
        const place = start + i + 1;
        const sClass = scStatusClass(row.status);
        return `<tr>
        <td>${place}</td>
        <td title="${esc(row.transporterId)}">${esc(row.daName || row.transporterId)}</td>
        <td class="ct-sc-status--${sClass}">${esc(row.status)}</td>
        <td><strong>${row.totalScore.toFixed(2)}</strong></td>
        <td>${esc(Number(row.delivered).toLocaleString())}</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.dcr), "DCR")}">${row.dcr}%</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.dnrDpmo), "DNRDPMO")}">${parseInt(row.dnrDpmo, 10)}</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.lorDpmo), "LORDPMO")}">${parseInt(row.lorDpmo, 10)}</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.pod), "POD")}">${row.pod}%</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.cc), "CC")}">${row.cc}%</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.ce), "CE")}">${parseInt(row.ce, 10)}</td>
        <td class="ct-sc-color--${scKpiClass(parseFloat(row.cdfDpmo), "CDFDPMO")}">${parseInt(row.cdfDpmo, 10)}</td>
      </tr>`;
      }).join("");
      const tableHtml = `
      <div class="ct-sc-table-wrap">
        <table class="ct-sc-table">
          <thead><tr>
            <th data-sort="place">#${sortArrow("place")}</th>
            <th data-sort="daName">DA${sortArrow("daName")}</th>
            <th data-sort="status">Status${sortArrow("status")}</th>
            <th data-sort="totalScore">Total Score${sortArrow("totalScore")}</th>
            <th data-sort="delivered">Delivered${sortArrow("delivered")}</th>
            <th data-sort="dcr">DCR${sortArrow("dcr")}</th>
            <th data-sort="dnrDpmo">DNR DPMO${sortArrow("dnrDpmo")}</th>
            <th data-sort="lorDpmo">LOR DPMO${sortArrow("lorDpmo")}</th>
            <th data-sort="pod">POD${sortArrow("pod")}</th>
            <th data-sort="cc">CC${sortArrow("cc")}</th>
            <th data-sort="ce">CE${sortArrow("ce")}</th>
            <th data-sort="cdfDpmo">CDF DPMO${sortArrow("cdfDpmo")}</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
      const paginationHtml = totalPages > 1 ? `
      <div class="ct-sc-pagination">
        <button class="ct-btn ct-btn--secondary ct-sc-page-prev" ${this._currentPage === 0 ? "disabled" : ""}>\u25C0 Prev</button>
        <span class="ct-sc-page-info">Page ${this._currentPage + 1} of ${totalPages}</span>
        <button class="ct-btn ct-btn--secondary ct-sc-page-next" ${this._currentPage >= totalPages - 1 ? "disabled" : ""}>Next \u25B6</button>
      </div>` : "";
      this._setBody(tilesHtml + tableHtml + paginationHtml);
      document.querySelectorAll(".ct-sc-table th[data-sort]").forEach((th) => {
        th.addEventListener("click", () => {
          const field = th.getAttribute("data-sort");
          if (field === "place")
            return;
          if (this._currentSort.field === field)
            this._currentSort.dir = this._currentSort.dir === "asc" ? "desc" : "asc";
          else
            this._currentSort = { field, dir: "desc" };
          this._sortData();
          this._currentPage = 0;
          this._renderAll();
        });
      });
      (_a = document.querySelector(".ct-sc-page-prev")) == null ? void 0 : _a.addEventListener("click", () => {
        this._currentPage--;
        this._renderAll();
      });
      (_b = document.querySelector(".ct-sc-page-next")) == null ? void 0 : _b.addEventListener("click", () => {
        this._currentPage++;
        this._renderAll();
      });
    }
    _sortData() {
      const { field, dir } = this._currentSort;
      const mult = dir === "asc" ? 1 : -1;
      this._calculatedData.sort((a, b) => {
        const na = parseFloat(String(a[field])), nb = parseFloat(String(b[field]));
        if (!isNaN(na) && !isNaN(nb))
          return (na - nb) * mult;
        return String(a[field] || "").localeCompare(String(b[field] || "")) * mult;
      });
    }
    // ── Image Download ─────────────────────────────────────────────────────────
    _downloadAsImage() {
      var _a;
      const data = this._calculatedData;
      if (!data.length) {
        this._setStatus("\u26A0\uFE0F No data to capture. Fetch data first.");
        return;
      }
      this._setStatus("\u23F3 Generating image\u2026");
      try {
        const SCALE = 2, FONT = "Arial, sans-serif", FONT_SZ = 12, HEAD_SZ = 11, PAD_X = 8, PAD_Y = 6;
        const ROW_H = FONT_SZ + PAD_Y * 2, HEAD_H = HEAD_SZ + PAD_Y * 2, TITLE_H = 32;
        const week = ((_a = document.getElementById("ct-sc-week")) == null ? void 0 : _a.value) || "";
        const COLS = [
          { label: "#", w: 36, get: (_r, i) => String(i + 1), color: void 0 },
          { label: "DA", w: 180, get: (r) => r.daName || r.transporterId, color: void 0 },
          { label: "Status", w: 90, get: (r) => r.status, color: (r) => _scImgStatusColor(r.status) },
          { label: "Score", w: 60, get: (r) => r.totalScore.toFixed(2), color: void 0 },
          { label: "Delivered", w: 70, get: (r) => String(Number(r.delivered).toLocaleString()), color: void 0 },
          { label: "DCR", w: 58, get: (r) => r.dcr + "%", color: (r) => _scImgKpiColor(parseFloat(r.dcr), "DCR") },
          { label: "DNR DPMO", w: 72, get: (r) => String(parseInt(r.dnrDpmo, 10)), color: (r) => _scImgKpiColor(parseFloat(r.dnrDpmo), "DNRDPMO") },
          { label: "LOR DPMO", w: 72, get: (r) => String(parseInt(r.lorDpmo, 10)), color: (r) => _scImgKpiColor(parseFloat(r.lorDpmo), "LORDPMO") },
          { label: "POD", w: 58, get: (r) => r.pod + "%", color: (r) => _scImgKpiColor(parseFloat(r.pod), "POD") },
          { label: "CC", w: 58, get: (r) => r.cc + "%", color: (r) => _scImgKpiColor(parseFloat(r.cc), "CC") },
          { label: "CE", w: 44, get: (r) => String(parseInt(r.ce, 10)), color: (r) => _scImgKpiColor(parseFloat(r.ce), "CE") },
          { label: "CDF DPMO", w: 72, get: (r) => String(parseInt(r.cdfDpmo, 10)), color: (r) => _scImgKpiColor(parseFloat(r.cdfDpmo), "CDFDPMO") }
        ];
        const totalW = COLS.reduce((s, c) => s + c.w, 0);
        const totalH = TITLE_H + HEAD_H + data.length * ROW_H;
        const canvas = document.createElement("canvas");
        canvas.width = totalW * SCALE;
        canvas.height = totalH * SCALE;
        const ctx = canvas.getContext("2d");
        ctx.scale(SCALE, SCALE);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, totalW, totalH);
        ctx.fillStyle = "#232f3e";
        ctx.fillRect(0, 0, totalW, TITLE_H);
        ctx.fillStyle = "#ff9900";
        ctx.font = `bold 14px ${FONT}`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(`\u{1F4CB} Scorecard${week ? " \u2014 " + week : ""}`, PAD_X, TITLE_H / 2);
        let x = 0;
        ctx.fillStyle = "#232f3e";
        ctx.fillRect(0, TITLE_H, totalW, HEAD_H);
        ctx.font = `bold ${HEAD_SZ}px ${FONT}`;
        ctx.fillStyle = "#ff9900";
        ctx.textBaseline = "middle";
        for (const col of COLS) {
          ctx.textAlign = "center";
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, TITLE_H, col.w, HEAD_H);
          ctx.clip();
          ctx.fillText(col.label, x + col.w / 2, TITLE_H + HEAD_H / 2);
          ctx.restore();
          ctx.strokeStyle = "#3d4f60";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(x, TITLE_H);
          ctx.lineTo(x, TITLE_H + HEAD_H);
          ctx.stroke();
          x += col.w;
        }
        ctx.font = `${FONT_SZ}px ${FONT}`;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const rowY = TITLE_H + HEAD_H + i * ROW_H;
          ctx.fillStyle = i % 2 === 0 ? "#ffffff" : "#f9f9f9";
          ctx.fillRect(0, rowY, totalW, ROW_H);
          ctx.strokeStyle = "#dddddd";
          ctx.beginPath();
          ctx.moveTo(0, rowY + ROW_H);
          ctx.lineTo(totalW, rowY + ROW_H);
          ctx.stroke();
          x = 0;
          for (const col of COLS) {
            const text = col.get(row, i);
            const color = col.color ? col.color(row) : "#111111";
            ctx.fillStyle = color;
            ctx.textBaseline = "middle";
            ctx.textAlign = "center";
            ctx.save();
            ctx.beginPath();
            ctx.rect(x + 1, rowY, col.w - 2, ROW_H);
            ctx.clip();
            ctx.fillText(text, x + col.w / 2, rowY + ROW_H / 2);
            ctx.restore();
            ctx.strokeStyle = "#dddddd";
            ctx.beginPath();
            ctx.moveTo(x, rowY);
            ctx.lineTo(x, rowY + ROW_H);
            ctx.stroke();
            x += col.w;
          }
        }
        ctx.strokeStyle = "#aaaaaa";
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, totalW, totalH);
        canvas.toBlob((blob) => {
          if (!blob) {
            this._setStatus("\u274C Image generation failed.");
            return;
          }
          const dlUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = dlUrl;
          a.download = `scorecard_${week || "export"}.png`;
          a.click();
          URL.revokeObjectURL(dlUrl);
          this._setStatus("\u2705 Image downloaded.");
        }, "image/png");
      } catch (e) {
        err("Scorecard image download failed:", e);
        this._setStatus("\u274C Image generation failed: " + e.message);
      }
    }
    // ── CSV Export ─────────────────────────────────────────────────────────────
    _exportCSV() {
      var _a;
      if (!this._calculatedData.length) {
        this._setStatus("\u26A0\uFE0F No data to export.");
        return;
      }
      const headers = ["Place", "DA", "Status", "Total Score", "Delivered", "DCR", "DNR DPMO", "LOR DPMO", "POD", "CC", "CE", "CDF DPMO", "Station", "DSP"];
      const csvRows = [headers.join(";")];
      this._calculatedData.forEach((row, i) => {
        csvRows.push([i + 1, row.daName || row.transporterId, row.status, row.totalScore.toFixed(2), row.delivered, row.dcr, parseInt(row.dnrDpmo, 10), parseInt(row.lorDpmo, 10), row.pod, row.cc, parseInt(row.ce, 10), parseInt(row.cdfDpmo, 10), row.stationCode, row.dspCode].join(";"));
      });
      const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `scorecard_${((_a = document.getElementById("ct-sc-week")) == null ? void 0 : _a.value) || "data"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      this._setStatus("\u2705 CSV exported.");
    }
  };

  // node_modules/qrcode-generator/dist/qrcode.mjs
  var qrcode = function(typeNumber, errorCorrectionLevel) {
    const PAD0 = 236;
    const PAD1 = 17;
    let _typeNumber = typeNumber;
    const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    let _modules = null;
    let _moduleCount = 0;
    let _dataCache = null;
    const _dataList = [];
    const _this = {};
    const makeImpl = function(test, maskPattern) {
      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        const modules = new Array(moduleCount);
        for (let row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (let col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);
      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);
      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }
      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }
      mapData(_dataCache, maskPattern);
    };
    const setupPositionProbePattern = function(row, col) {
      for (let r = -1; r <= 7; r += 1) {
        if (row + r <= -1 || _moduleCount <= row + r)
          continue;
        for (let c = -1; c <= 7; c += 1) {
          if (col + c <= -1 || _moduleCount <= col + c)
            continue;
          if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };
    const getBestMaskPattern = function() {
      let minLostPoint = 0;
      let pattern = 0;
      for (let i = 0; i < 8; i += 1) {
        makeImpl(true, i);
        const lostPoint = QRUtil.getLostPoint(_this);
        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }
      return pattern;
    };
    const setupTimingPattern = function() {
      for (let r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = r % 2 == 0;
      }
      for (let c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = c % 2 == 0;
      }
    };
    const setupPositionAdjustPattern = function() {
      const pos = QRUtil.getPatternPosition(_typeNumber);
      for (let i = 0; i < pos.length; i += 1) {
        for (let j = 0; j < pos.length; j += 1) {
          const row = pos[i];
          const col = pos[j];
          if (_modules[row][col] != null) {
            continue;
          }
          for (let r = -2; r <= 2; r += 1) {
            for (let c = -2; c <= 2; c += 1) {
              if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };
    const setupTypeNumber = function(test) {
      const bits = QRUtil.getBCHTypeNumber(_typeNumber);
      for (let i = 0; i < 18; i += 1) {
        const mod = !test && (bits >> i & 1) == 1;
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }
      for (let i = 0; i < 18; i += 1) {
        const mod = !test && (bits >> i & 1) == 1;
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };
    const setupTypeInfo = function(test, maskPattern) {
      const data = _errorCorrectionLevel << 3 | maskPattern;
      const bits = QRUtil.getBCHTypeInfo(data);
      for (let i = 0; i < 15; i += 1) {
        const mod = !test && (bits >> i & 1) == 1;
        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }
      for (let i = 0; i < 15; i += 1) {
        const mod = !test && (bits >> i & 1) == 1;
        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }
      _modules[_moduleCount - 8][8] = !test;
    };
    const mapData = function(data, maskPattern) {
      let inc = -1;
      let row = _moduleCount - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      const maskFunc = QRUtil.getMaskFunction(maskPattern);
      for (let col = _moduleCount - 1; col > 0; col -= 2) {
        if (col == 6)
          col -= 1;
        while (true) {
          for (let c = 0; c < 2; c += 1) {
            if (_modules[row][col - c] == null) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) == 1;
              }
              const mask = maskFunc(row, col - c);
              if (mask) {
                dark = !dark;
              }
              _modules[row][col - c] = dark;
              bitIndex -= 1;
              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };
    const createBytes = function(buffer, rsBlocks) {
      let offset = 0;
      let maxDcCount = 0;
      let maxEcCount = 0;
      const dcdata = new Array(rsBlocks.length);
      const ecdata = new Array(rsBlocks.length);
      for (let r = 0; r < rsBlocks.length; r += 1) {
        const dcCount = rsBlocks[r].dataCount;
        const ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = new Array(dcCount);
        for (let i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;
        const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
        const modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (let i = 0; i < ecdata[r].length; i += 1) {
          const modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
        }
      }
      let totalCodeCount = 0;
      for (let i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }
      const data = new Array(totalCodeCount);
      let index = 0;
      for (let i = 0; i < maxDcCount; i += 1) {
        for (let r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }
      for (let i = 0; i < maxEcCount; i += 1) {
        for (let r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }
      return data;
    };
    const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
      const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
      const buffer = qrBitBuffer();
      for (let i = 0; i < dataList.length; i += 1) {
        const data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
        data.write(buffer);
      }
      let totalDataCount = 0;
      for (let i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }
      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
      }
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }
      while (true) {
        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);
        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }
      return createBytes(buffer, rsBlocks);
    };
    _this.addData = function(data, mode) {
      mode = mode || "Byte";
      let newData = null;
      switch (mode) {
        case "Numeric":
          newData = qrNumber(data);
          break;
        case "Alphanumeric":
          newData = qrAlphaNum(data);
          break;
        case "Byte":
          newData = qr8BitByte(data);
          break;
        case "Kanji":
          newData = qrKanji(data);
          break;
        default:
          throw "mode:" + mode;
      }
      _dataList.push(newData);
      _dataCache = null;
    };
    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + "," + col;
      }
      return _modules[row][col];
    };
    _this.getModuleCount = function() {
      return _moduleCount;
    };
    _this.make = function() {
      if (_typeNumber < 1) {
        let typeNumber2 = 1;
        for (; typeNumber2 < 40; typeNumber2++) {
          const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
          const buffer = qrBitBuffer();
          for (let i = 0; i < _dataList.length; i++) {
            const data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
            data.write(buffer);
          }
          let totalDataCount = 0;
          for (let i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }
          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }
        _typeNumber = typeNumber2;
      }
      makeImpl(false, getBestMaskPattern());
    };
    _this.createTableTag = function(cellSize, margin) {
      cellSize = cellSize || 2;
      margin = typeof margin == "undefined" ? cellSize * 4 : margin;
      let qrHtml = "";
      qrHtml += '<table style="';
      qrHtml += " border-width: 0px; border-style: none;";
      qrHtml += " border-collapse: collapse;";
      qrHtml += " padding: 0px; margin: " + margin + "px;";
      qrHtml += '">';
      qrHtml += "<tbody>";
      for (let r = 0; r < _this.getModuleCount(); r += 1) {
        qrHtml += "<tr>";
        for (let c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += " border-width: 0px; border-style: none;";
          qrHtml += " border-collapse: collapse;";
          qrHtml += " padding: 0px; margin: 0px;";
          qrHtml += " width: " + cellSize + "px;";
          qrHtml += " height: " + cellSize + "px;";
          qrHtml += " background-color: ";
          qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
          qrHtml += ";";
          qrHtml += '"/>';
        }
        qrHtml += "</tr>";
      }
      qrHtml += "</tbody>";
      qrHtml += "</table>";
      return qrHtml;
    };
    _this.createSvgTag = function(cellSize, margin, alt, title) {
      let opts = {};
      if (typeof arguments[0] == "object") {
        opts = arguments[0];
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }
      cellSize = cellSize || 2;
      margin = typeof margin == "undefined" ? cellSize * 4 : margin;
      alt = typeof alt === "string" ? { text: alt } : alt || {};
      alt.text = alt.text || null;
      alt.id = alt.text ? alt.id || "qrcode-description" : null;
      title = typeof title === "string" ? { text: title } : title || {};
      title.text = title.text || null;
      title.id = title.text ? title.id || "qrcode-title" : null;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      let c, mc, r, mr, qrSvg = "", rect;
      rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
      qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
      qrSvg += ">";
      qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
      qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';
      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c)) {
            mc = c * cellSize + margin;
            qrSvg += "M" + mc + "," + mr + rect;
          }
        }
      }
      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += "</svg>";
      return qrSvg;
    };
    _this.createDataURL = function(cellSize, margin) {
      cellSize = cellSize || 2;
      margin = typeof margin == "undefined" ? cellSize * 4 : margin;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      const min = margin;
      const max = size - margin;
      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          const c = Math.floor((x - min) / cellSize);
          const r = Math.floor((y - min) / cellSize);
          return _this.isDark(r, c) ? 0 : 1;
        } else {
          return 1;
        }
      });
    };
    _this.createImgTag = function(cellSize, margin, alt) {
      cellSize = cellSize || 2;
      margin = typeof margin == "undefined" ? cellSize * 4 : margin;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      let img = "";
      img += "<img";
      img += ' src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += ' width="';
      img += size;
      img += '"';
      img += ' height="';
      img += size;
      img += '"';
      if (alt) {
        img += ' alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += "/>";
      return img;
    };
    const escapeXml = function(s) {
      let escaped = "";
      for (let i = 0; i < s.length; i += 1) {
        const c = s.charAt(i);
        switch (c) {
          case "<":
            escaped += "&lt;";
            break;
          case ">":
            escaped += "&gt;";
            break;
          case "&":
            escaped += "&amp;";
            break;
          case '"':
            escaped += "&quot;";
            break;
          default:
            escaped += c;
            break;
        }
      }
      return escaped;
    };
    const _createHalfASCII = function(margin) {
      const cellSize = 1;
      margin = typeof margin == "undefined" ? cellSize * 2 : margin;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      const min = margin;
      const max = size - margin;
      let y, x, r1, r2, p;
      const blocks = {
        "\u2588\u2588": "\u2588",
        "\u2588 ": "\u2580",
        " \u2588": "\u2584",
        "  ": " "
      };
      const blocksLastLineNoMargin = {
        "\u2588\u2588": "\u2580",
        "\u2588 ": "\u2580",
        " \u2588": " ",
        "  ": " "
      };
      let ascii = "";
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = "\u2588";
          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = " ";
          }
          if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += " ";
          } else {
            p += "\u2588";
          }
          ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
        }
        ascii += "\n";
      }
      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("\u2580");
      }
      return ascii.substring(0, ascii.length - 1);
    };
    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;
      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }
      cellSize -= 1;
      margin = typeof margin == "undefined" ? cellSize * 2 : margin;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      const min = margin;
      const max = size - margin;
      let y, x, r, p;
      const white = Array(cellSize + 1).join("\u2588\u2588");
      const black = Array(cellSize + 1).join("  ");
      let ascii = "";
      let line = "";
      for (y = 0; y < size; y += 1) {
        r = Math.floor((y - min) / cellSize);
        line = "";
        for (x = 0; x < size; x += 1) {
          p = 1;
          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }
          line += p ? white : black;
        }
        for (r = 0; r < cellSize; r += 1) {
          ascii += line + "\n";
        }
      }
      return ascii.substring(0, ascii.length - 1);
    };
    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      const length = _this.getModuleCount();
      for (let row = 0; row < length; row++) {
        for (let col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? "black" : "white";
          context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    };
    return _this;
  };
  qrcode.stringToBytes = function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      bytes.push(c & 255);
    }
    return bytes;
  };
  qrcode.createStringToBytes = function(unicodeData, numChars) {
    const unicodeMap = function() {
      const bin = base64DecodeInputStream(unicodeData);
      const read = function() {
        const b = bin.read();
        if (b == -1)
          throw "eof";
        return b;
      };
      let count = 0;
      const unicodeMap2 = {};
      while (true) {
        const b0 = bin.read();
        if (b0 == -1)
          break;
        const b1 = read();
        const b2 = read();
        const b3 = read();
        const k = String.fromCharCode(b0 << 8 | b1);
        const v = b2 << 8 | b3;
        unicodeMap2[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + " != " + numChars;
      }
      return unicodeMap2;
    }();
    const unknownChar = "?".charCodeAt(0);
    return function(s) {
      const bytes = [];
      for (let i = 0; i < s.length; i += 1) {
        const c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          const b = unicodeMap[s.charAt(i)];
          if (typeof b == "number") {
            if ((b & 255) == b) {
              bytes.push(b);
            } else {
              bytes.push(b >>> 8);
              bytes.push(b & 255);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };
  var QRMode = {
    MODE_NUMBER: 1 << 0,
    MODE_ALPHA_NUM: 1 << 1,
    MODE_8BIT_BYTE: 1 << 2,
    MODE_KANJI: 1 << 3
  };
  var QRErrorCorrectionLevel = {
    L: 1,
    M: 0,
    Q: 3,
    H: 2
  };
  var QRMaskPattern = {
    PATTERN000: 0,
    PATTERN001: 1,
    PATTERN010: 2,
    PATTERN011: 3,
    PATTERN100: 4,
    PATTERN101: 5,
    PATTERN110: 6,
    PATTERN111: 7
  };
  var QRUtil = function() {
    const PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    const _this = {};
    const getBCHDigit = function(data) {
      let digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };
    _this.getBCHTypeInfo = function(data) {
      let d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
      }
      return (data << 10 | d) ^ G15_MASK;
    };
    _this.getBCHTypeNumber = function(data) {
      let d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
      }
      return data << 12 | d;
    };
    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };
    _this.getMaskFunction = function(maskPattern) {
      switch (maskPattern) {
        case QRMaskPattern.PATTERN000:
          return function(i, j) {
            return (i + j) % 2 == 0;
          };
        case QRMaskPattern.PATTERN001:
          return function(i, j) {
            return i % 2 == 0;
          };
        case QRMaskPattern.PATTERN010:
          return function(i, j) {
            return j % 3 == 0;
          };
        case QRMaskPattern.PATTERN011:
          return function(i, j) {
            return (i + j) % 3 == 0;
          };
        case QRMaskPattern.PATTERN100:
          return function(i, j) {
            return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
          };
        case QRMaskPattern.PATTERN101:
          return function(i, j) {
            return i * j % 2 + i * j % 3 == 0;
          };
        case QRMaskPattern.PATTERN110:
          return function(i, j) {
            return (i * j % 2 + i * j % 3) % 2 == 0;
          };
        case QRMaskPattern.PATTERN111:
          return function(i, j) {
            return (i * j % 3 + (i + j) % 2) % 2 == 0;
          };
        default:
          throw "bad maskPattern:" + maskPattern;
      }
    };
    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      let a = qrPolynomial([1], 0);
      for (let i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
      }
      return a;
    };
    _this.getLengthInBits = function(mode, type) {
      if (1 <= type && type < 10) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 10;
          case QRMode.MODE_ALPHA_NUM:
            return 9;
          case QRMode.MODE_8BIT_BYTE:
            return 8;
          case QRMode.MODE_KANJI:
            return 8;
          default:
            throw "mode:" + mode;
        }
      } else if (type < 27) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 12;
          case QRMode.MODE_ALPHA_NUM:
            return 11;
          case QRMode.MODE_8BIT_BYTE:
            return 16;
          case QRMode.MODE_KANJI:
            return 10;
          default:
            throw "mode:" + mode;
        }
      } else if (type < 41) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 14;
          case QRMode.MODE_ALPHA_NUM:
            return 13;
          case QRMode.MODE_8BIT_BYTE:
            return 16;
          case QRMode.MODE_KANJI:
            return 12;
          default:
            throw "mode:" + mode;
        }
      } else {
        throw "type:" + type;
      }
    };
    _this.getLostPoint = function(qrcode2) {
      const moduleCount = qrcode2.getModuleCount();
      let lostPoint = 0;
      for (let row = 0; row < moduleCount; row += 1) {
        for (let col = 0; col < moduleCount; col += 1) {
          let sameCount = 0;
          const dark = qrcode2.isDark(row, col);
          for (let r = -1; r <= 1; r += 1) {
            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }
            for (let c = -1; c <= 1; c += 1) {
              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }
              if (r == 0 && c == 0) {
                continue;
              }
              if (dark == qrcode2.isDark(row + r, col + c)) {
                sameCount += 1;
              }
            }
          }
          if (sameCount > 5) {
            lostPoint += 3 + sameCount - 5;
          }
        }
      }
      ;
      for (let row = 0; row < moduleCount - 1; row += 1) {
        for (let col = 0; col < moduleCount - 1; col += 1) {
          let count = 0;
          if (qrcode2.isDark(row, col))
            count += 1;
          if (qrcode2.isDark(row + 1, col))
            count += 1;
          if (qrcode2.isDark(row, col + 1))
            count += 1;
          if (qrcode2.isDark(row + 1, col + 1))
            count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }
      for (let row = 0; row < moduleCount; row += 1) {
        for (let col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode2.isDark(row, col) && !qrcode2.isDark(row, col + 1) && qrcode2.isDark(row, col + 2) && qrcode2.isDark(row, col + 3) && qrcode2.isDark(row, col + 4) && !qrcode2.isDark(row, col + 5) && qrcode2.isDark(row, col + 6)) {
            lostPoint += 40;
          }
        }
      }
      for (let col = 0; col < moduleCount; col += 1) {
        for (let row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode2.isDark(row, col) && !qrcode2.isDark(row + 1, col) && qrcode2.isDark(row + 2, col) && qrcode2.isDark(row + 3, col) && qrcode2.isDark(row + 4, col) && !qrcode2.isDark(row + 5, col) && qrcode2.isDark(row + 6, col)) {
            lostPoint += 40;
          }
        }
      }
      let darkCount = 0;
      for (let col = 0; col < moduleCount; col += 1) {
        for (let row = 0; row < moduleCount; row += 1) {
          if (qrcode2.isDark(row, col)) {
            darkCount += 1;
          }
        }
      }
      const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;
      return lostPoint;
    };
    return _this;
  }();
  var QRMath = function() {
    const EXP_TABLE = new Array(256);
    const LOG_TABLE = new Array(256);
    for (let i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (let i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
    }
    for (let i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i]] = i;
    }
    const _this = {};
    _this.glog = function(n) {
      if (n < 1) {
        throw "glog(" + n + ")";
      }
      return LOG_TABLE[n];
    };
    _this.gexp = function(n) {
      while (n < 0) {
        n += 255;
      }
      while (n >= 256) {
        n -= 255;
      }
      return EXP_TABLE[n];
    };
    return _this;
  }();
  var qrPolynomial = function(num, shift) {
    if (typeof num.length == "undefined") {
      throw num.length + "/" + shift;
    }
    const _num = function() {
      let offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      const _num2 = new Array(num.length - offset + shift);
      for (let i = 0; i < num.length - offset; i += 1) {
        _num2[i] = num[i + offset];
      }
      return _num2;
    }();
    const _this = {};
    _this.getAt = function(index) {
      return _num[index];
    };
    _this.getLength = function() {
      return _num.length;
    };
    _this.multiply = function(e) {
      const num2 = new Array(_this.getLength() + e.getLength() - 1);
      for (let i = 0; i < _this.getLength(); i += 1) {
        for (let j = 0; j < e.getLength(); j += 1) {
          num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
        }
      }
      return qrPolynomial(num2, 0);
    };
    _this.mod = function(e) {
      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }
      const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
      const num2 = new Array(_this.getLength());
      for (let i = 0; i < _this.getLength(); i += 1) {
        num2[i] = _this.getAt(i);
      }
      for (let i = 0; i < e.getLength(); i += 1) {
        num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
      }
      return qrPolynomial(num2, 0).mod(e);
    };
    return _this;
  };
  var QRRSBlock = function() {
    const RS_BLOCK_TABLE = [
      // L
      // M
      // Q
      // H
      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],
      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],
      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],
      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],
      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],
      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],
      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],
      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],
      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],
      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],
      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],
      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],
      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],
      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],
      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],
      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],
      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],
      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],
      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],
      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],
      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],
      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],
      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],
      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],
      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],
      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],
      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],
      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],
      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],
      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],
      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],
      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],
      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],
      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],
      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],
      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],
      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],
      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],
      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],
      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];
    const qrRSBlock = function(totalCount, dataCount) {
      const _this2 = {};
      _this2.totalCount = totalCount;
      _this2.dataCount = dataCount;
      return _this2;
    };
    const _this = {};
    const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case QRErrorCorrectionLevel.L:
          return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
        case QRErrorCorrectionLevel.M:
          return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
        case QRErrorCorrectionLevel.Q:
          return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
        case QRErrorCorrectionLevel.H:
          return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
      const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
      if (typeof rsBlock == "undefined") {
        throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
      }
      const length = rsBlock.length / 3;
      const list = [];
      for (let i = 0; i < length; i += 1) {
        const count = rsBlock[i * 3 + 0];
        const totalCount = rsBlock[i * 3 + 1];
        const dataCount = rsBlock[i * 3 + 2];
        for (let j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount));
        }
      }
      return list;
    };
    return _this;
  }();
  var qrBitBuffer = function() {
    const _buffer = [];
    let _length = 0;
    const _this = {};
    _this.getBuffer = function() {
      return _buffer;
    };
    _this.getAt = function(index) {
      const bufIndex = Math.floor(index / 8);
      return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
    };
    _this.put = function(num, length) {
      for (let i = 0; i < length; i += 1) {
        _this.putBit((num >>> length - i - 1 & 1) == 1);
      }
    };
    _this.getLengthInBits = function() {
      return _length;
    };
    _this.putBit = function(bit) {
      const bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }
      if (bit) {
        _buffer[bufIndex] |= 128 >>> _length % 8;
      }
      _length += 1;
    };
    return _this;
  };
  var qrNumber = function(data) {
    const _mode = QRMode.MODE_NUMBER;
    const _data = data;
    const _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _data.length;
    };
    _this.write = function(buffer) {
      const data2 = _data;
      let i = 0;
      while (i + 2 < data2.length) {
        buffer.put(strToNum(data2.substring(i, i + 3)), 10);
        i += 3;
      }
      if (i < data2.length) {
        if (data2.length - i == 1) {
          buffer.put(strToNum(data2.substring(i, i + 1)), 4);
        } else if (data2.length - i == 2) {
          buffer.put(strToNum(data2.substring(i, i + 2)), 7);
        }
      }
    };
    const strToNum = function(s) {
      let num = 0;
      for (let i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i));
      }
      return num;
    };
    const chatToNum = function(c) {
      if ("0" <= c && c <= "9") {
        return c.charCodeAt(0) - "0".charCodeAt(0);
      }
      throw "illegal char :" + c;
    };
    return _this;
  };
  var qrAlphaNum = function(data) {
    const _mode = QRMode.MODE_ALPHA_NUM;
    const _data = data;
    const _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _data.length;
    };
    _this.write = function(buffer) {
      const s = _data;
      let i = 0;
      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
          11
        );
        i += 2;
      }
      if (i < s.length) {
        buffer.put(getCode(s.charAt(i)), 6);
      }
    };
    const getCode = function(c) {
      if ("0" <= c && c <= "9") {
        return c.charCodeAt(0) - "0".charCodeAt(0);
      } else if ("A" <= c && c <= "Z") {
        return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
      } else {
        switch (c) {
          case " ":
            return 36;
          case "$":
            return 37;
          case "%":
            return 38;
          case "*":
            return 39;
          case "+":
            return 40;
          case "-":
            return 41;
          case ".":
            return 42;
          case "/":
            return 43;
          case ":":
            return 44;
          default:
            throw "illegal char :" + c;
        }
      }
    };
    return _this;
  };
  var qr8BitByte = function(data) {
    const _mode = QRMode.MODE_8BIT_BYTE;
    const _data = data;
    const _bytes = qrcode.stringToBytes(data);
    const _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _bytes.length;
    };
    _this.write = function(buffer) {
      for (let i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };
    return _this;
  };
  var qrKanji = function(data) {
    const _mode = QRMode.MODE_KANJI;
    const _data = data;
    const stringToBytes2 = qrcode.stringToBytes;
    !function(c, code) {
      const test = stringToBytes2(c);
      if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
        throw "sjis not supported.";
      }
    }("\u53CB", 38726);
    const _bytes = stringToBytes2(data);
    const _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };
    _this.write = function(buffer) {
      const data2 = _bytes;
      let i = 0;
      while (i + 1 < data2.length) {
        let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
        if (33088 <= c && c <= 40956) {
          c -= 33088;
        } else if (57408 <= c && c <= 60351) {
          c -= 49472;
        } else {
          throw "illegal char at " + (i + 1) + "/" + c;
        }
        c = (c >>> 8 & 255) * 192 + (c & 255);
        buffer.put(c, 13);
        i += 2;
      }
      if (i < data2.length) {
        throw "illegal char at " + (i + 1);
      }
    };
    return _this;
  };
  var byteArrayOutputStream = function() {
    const _bytes = [];
    const _this = {};
    _this.writeByte = function(b) {
      _bytes.push(b & 255);
    };
    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };
    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (let i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };
    _this.writeString = function(s) {
      for (let i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i));
      }
    };
    _this.toByteArray = function() {
      return _bytes;
    };
    _this.toString = function() {
      let s = "";
      s += "[";
      for (let i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ",";
        }
        s += _bytes[i];
      }
      s += "]";
      return s;
    };
    return _this;
  };
  var base64EncodeOutputStream = function() {
    let _buffer = 0;
    let _buflen = 0;
    let _length = 0;
    let _base64 = "";
    const _this = {};
    const writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 63));
    };
    const encode = function(n) {
      if (n < 0) {
        throw "n:" + n;
      } else if (n < 26) {
        return 65 + n;
      } else if (n < 52) {
        return 97 + (n - 26);
      } else if (n < 62) {
        return 48 + (n - 52);
      } else if (n == 62) {
        return 43;
      } else if (n == 63) {
        return 47;
      } else {
        throw "n:" + n;
      }
    };
    _this.writeByte = function(n) {
      _buffer = _buffer << 8 | n & 255;
      _buflen += 8;
      _length += 1;
      while (_buflen >= 6) {
        writeEncoded(_buffer >>> _buflen - 6);
        _buflen -= 6;
      }
    };
    _this.flush = function() {
      if (_buflen > 0) {
        writeEncoded(_buffer << 6 - _buflen);
        _buffer = 0;
        _buflen = 0;
      }
      if (_length % 3 != 0) {
        const padlen = 3 - _length % 3;
        for (let i = 0; i < padlen; i += 1) {
          _base64 += "=";
        }
      }
    };
    _this.toString = function() {
      return _base64;
    };
    return _this;
  };
  var base64DecodeInputStream = function(str) {
    const _str = str;
    let _pos = 0;
    let _buffer = 0;
    let _buflen = 0;
    const _this = {};
    _this.read = function() {
      while (_buflen < 8) {
        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw "unexpected end of file./" + _buflen;
        }
        const c = _str.charAt(_pos);
        _pos += 1;
        if (c == "=") {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/)) {
          continue;
        }
        _buffer = _buffer << 6 | decode(c.charCodeAt(0));
        _buflen += 6;
      }
      const n = _buffer >>> _buflen - 8 & 255;
      _buflen -= 8;
      return n;
    };
    const decode = function(c) {
      if (65 <= c && c <= 90) {
        return c - 65;
      } else if (97 <= c && c <= 122) {
        return c - 97 + 26;
      } else if (48 <= c && c <= 57) {
        return c - 48 + 52;
      } else if (c == 43) {
        return 62;
      } else if (c == 47) {
        return 63;
      } else {
        throw "c:" + c;
      }
    };
    return _this;
  };
  var gifImage = function(width, height) {
    const _width = width;
    const _height = height;
    const _data = new Array(width * height);
    const _this = {};
    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };
    _this.write = function(out) {
      out.writeString("GIF87a");
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(128);
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(255);
      out.writeByte(255);
      out.writeByte(255);
      out.writeString(",");
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);
      const lzwMinCodeSize = 2;
      const raster = getLZWRaster(lzwMinCodeSize);
      out.writeByte(lzwMinCodeSize);
      let offset = 0;
      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }
      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0);
      out.writeString(";");
    };
    const bitOutputStream = function(out) {
      const _out = out;
      let _bitLength = 0;
      let _bitBuffer = 0;
      const _this2 = {};
      _this2.write = function(data, length) {
        if (data >>> length != 0) {
          throw "length over";
        }
        while (_bitLength + length >= 8) {
          _out.writeByte(255 & (data << _bitLength | _bitBuffer));
          length -= 8 - _bitLength;
          data >>>= 8 - _bitLength;
          _bitBuffer = 0;
          _bitLength = 0;
        }
        _bitBuffer = data << _bitLength | _bitBuffer;
        _bitLength = _bitLength + length;
      };
      _this2.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };
      return _this2;
    };
    const getLZWRaster = function(lzwMinCodeSize) {
      const clearCode = 1 << lzwMinCodeSize;
      const endCode = (1 << lzwMinCodeSize) + 1;
      let bitLength = lzwMinCodeSize + 1;
      const table = lzwTable();
      for (let i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i));
      }
      table.add(String.fromCharCode(clearCode));
      table.add(String.fromCharCode(endCode));
      const byteOut = byteArrayOutputStream();
      const bitOut = bitOutputStream(byteOut);
      bitOut.write(clearCode, bitLength);
      let dataIndex = 0;
      let s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      while (dataIndex < _data.length) {
        const c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;
        if (table.contains(s + c)) {
          s = s + c;
        } else {
          bitOut.write(table.indexOf(s), bitLength);
          if (table.size() < 4095) {
            if (table.size() == 1 << bitLength) {
              bitLength += 1;
            }
            table.add(s + c);
          }
          s = c;
        }
      }
      bitOut.write(table.indexOf(s), bitLength);
      bitOut.write(endCode, bitLength);
      bitOut.flush();
      return byteOut.toByteArray();
    };
    const lzwTable = function() {
      const _map = {};
      let _size = 0;
      const _this2 = {};
      _this2.add = function(key) {
        if (_this2.contains(key)) {
          throw "dup key:" + key;
        }
        _map[key] = _size;
        _size += 1;
      };
      _this2.size = function() {
        return _size;
      };
      _this2.indexOf = function(key) {
        return _map[key];
      };
      _this2.contains = function(key) {
        return typeof _map[key] != "undefined";
      };
      return _this2;
    };
    return _this;
  };
  var createDataURL = function(width, height, getPixel) {
    const gif = gifImage(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y));
      }
    }
    const b = byteArrayOutputStream();
    gif.write(b);
    const base64 = base64EncodeOutputStream();
    const bytes = b.toByteArray();
    for (let i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();
    return "data:image/gif;base64," + base64;
  };
  var qrcode_default = qrcode;
  var stringToBytes = qrcode.stringToBytes;

  // src/features/vsa-qr.ts
  var VsaQrGenerator = class {
    constructor(config, companyConfig) {
      this.config = config;
      this.companyConfig = companyConfig;
    }
    _overlayEl = null;
    _active = false;
    _vehicles = [];
    _selectedVins = /* @__PURE__ */ new Set();
    _loading = false;
    _pageSize = 25;
    _currentPage = 1;
    _searchTerm = "";
    _searchTimer = null;
    _sortColumn = null;
    _sortAsc = true;
    // ── Lifecycle ──────────────────────────────────────────────────────────────
    init() {
      if (this._overlayEl)
        return;
      const overlay = document.createElement("div");
      overlay.id = "ct-vsa-overlay";
      overlay.className = "ct-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "VSA QR Code Generator");
      overlay.innerHTML = `
      <div class="ct-vsa-panel">
        <div class="ct-vsa-header">
          <div>
            <h2>\u{1F4F1} VSA QR Code Generator</h2>
            <div id="ct-vsa-asof" style="font-size:11px;color:var(--ct-muted);margin-top:2px;"></div>
          </div>
          <button class="ct-btn ct-btn--close" id="ct-vsa-close" aria-label="Schlie\xDFen">\u2715 Schlie\xDFen</button>
        </div>
        <div id="ct-vsa-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-vsa-tiles"></div>
        <div class="ct-vsa-toolbar">
          <input type="text" class="ct-input ct-vsa-search" id="ct-vsa-search"
                 placeholder="Suche nach Kennzeichen, VIN oder Station\u2026" aria-label="Fahrzeuge filtern">
          <div class="ct-vsa-selection-info" id="ct-vsa-selection-info"></div>
        </div>
        <div id="ct-vsa-body"></div>
        <div class="ct-vsa-footer" id="ct-vsa-footer">
          <button class="ct-btn ct-btn--accent" id="ct-vsa-print" disabled>\u{1F5A8} Ausgew\xE4hlte drucken</button>
          <span class="ct-vsa-selection-badge" id="ct-vsa-badge">0 ausgew\xE4hlt</span>
        </div>
      </div>
    `;
      document.body.appendChild(overlay);
      this._overlayEl = overlay;
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay)
          this.hide();
      });
      document.getElementById("ct-vsa-close").addEventListener("click", () => this.hide());
      document.getElementById("ct-vsa-print").addEventListener("click", () => this._printSelected());
      const searchInput = document.getElementById("ct-vsa-search");
      searchInput.addEventListener("input", () => {
        if (this._searchTimer)
          clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => {
          this._searchTerm = searchInput.value.trim().toLowerCase();
          this._currentPage = 1;
          this._renderBody();
        }, 300);
      });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape")
          this.hide();
      });
      onDispose(() => this.dispose());
      log("VSA QR Generator initialized");
    }
    dispose() {
      var _a;
      if (this._searchTimer)
        clearTimeout(this._searchTimer);
      (_a = this._overlayEl) == null ? void 0 : _a.remove();
      this._overlayEl = null;
      this._vehicles = [];
      this._selectedVins.clear();
      this._active = false;
      this._loading = false;
    }
    toggle() {
      if (!this.config.features.vsaQr) {
        alert("VSA QR Code Generator ist deaktiviert. Bitte in den Einstellungen aktivieren.");
        return;
      }
      this.init();
      if (this._active)
        this.hide();
      else
        this.show();
    }
    show() {
      this.init();
      this._overlayEl.classList.add("visible");
      this._active = true;
      this._currentPage = 1;
      this._searchTerm = "";
      this._sortColumn = null;
      this._sortAsc = true;
      const searchInput = document.getElementById("ct-vsa-search");
      if (searchInput)
        searchInput.value = "";
      this._refresh();
    }
    hide() {
      var _a;
      (_a = this._overlayEl) == null ? void 0 : _a.classList.remove("visible");
      this._active = false;
    }
    // ── API ────────────────────────────────────────────────────────────────────
    async _fetchVehicles() {
      const url = "https://logistics.amazon.de/fleet-management/api/vehicles?vehicleStatuses=ACTIVE,MAINTENANCE,PENDING";
      const csrf = getCSRFToken();
      const headers = { Accept: "application/json" };
      if (csrf)
        headers["anti-csrftoken-a2z"] = csrf;
      const resp = await withRetry(async () => {
        const r = await fetch(url, { method: "GET", headers, credentials: "include" });
        if (!r.ok)
          throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r;
      }, { retries: 2, baseMs: 800 });
      return resp.json();
    }
    // ── Data processing ────────────────────────────────────────────────────────
    _processResponse(json) {
      if (!json || typeof json !== "object")
        return [];
      let vehicleList;
      if (Array.isArray(json)) {
        vehicleList = json;
      } else {
        const obj = json;
        vehicleList = obj["vehicles"] || obj["data"] || obj["content"] || [];
        if (!Array.isArray(vehicleList)) {
          for (const val of Object.values(obj)) {
            if (Array.isArray(val) && val.length > 0) {
              vehicleList = val;
              break;
            }
          }
        }
      }
      if (!Array.isArray(vehicleList))
        return [];
      return vehicleList.map((v) => {
        if (!v || typeof v !== "object")
          return null;
        const rec = v;
        const vin = String(rec["vin"] ?? "").trim();
        const registrationNo = String(rec["registrationNo"] ?? rec["licensePlate"] ?? rec["registration_no"] ?? "").trim();
        const stationCode = String(rec["stationCode"] ?? rec["station_code"] ?? rec["station"] ?? "").trim();
        const status = String(rec["vehicleStatus"] ?? rec["status"] ?? "ACTIVE").trim();
        if (!vin)
          return null;
        return { vin, registrationNo, stationCode, status };
      }).filter((v) => v !== null);
    }
    // ── Refresh ────────────────────────────────────────────────────────────────
    async _refresh() {
      var _a;
      if (this._loading)
        return;
      this._loading = true;
      this._vehicles = [];
      this._selectedVins.clear();
      this._setStatus("\u23F3 Lade Fahrzeugdaten\u2026");
      this._setTiles("");
      this._setBody('<div class="ct-vsa-loading" role="status">Fahrzeugdaten werden geladen\u2026</div>');
      this._updateFooter();
      try {
        const json = await this._fetchVehicles();
        const vehicles = this._processResponse(json);
        if (vehicles.length === 0) {
          this._setBody('<div class="ct-vsa-empty">Keine Fahrzeuge gefunden.</div>');
          this._setStatus("\u26A0\uFE0F Keine Fahrzeuge verf\xFCgbar.");
          this._loading = false;
          return;
        }
        this._vehicles = vehicles;
        for (const v of vehicles) {
          this._selectedVins.add(v.vin);
        }
        this._setStatus(`\u2705 ${vehicles.length} Fahrzeuge geladen`);
        const asOfEl = document.getElementById("ct-vsa-asof");
        if (asOfEl) {
          const fetchedAt = (/* @__PURE__ */ new Date()).toLocaleString("de-DE", {
            timeZone: "Europe/Berlin",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          });
          asOfEl.textContent = `Stand: ${fetchedAt}`;
        }
        this._renderTiles();
        this._renderBody();
        this._updateFooter();
      } catch (e) {
        err("VSA QR vehicle fetch failed:", e);
        this._setBody(`<div class="ct-vsa-error" role="alert">
        \u274C Fahrzeugdaten konnten nicht geladen werden.<br>
        <small>${esc(e.message)}</small><br><br>
        <button class="ct-btn ct-btn--accent" id="ct-vsa-retry">\u{1F504} Erneut versuchen</button>
      </div>`);
        this._setStatus("\u274C Fehler beim Laden.");
        (_a = document.getElementById("ct-vsa-retry")) == null ? void 0 : _a.addEventListener("click", () => this._refresh());
      } finally {
        this._loading = false;
      }
    }
    // ── Helpers ────────────────────────────────────────────────────────────────
    _setStatus(msg) {
      const el = document.getElementById("ct-vsa-status");
      if (el)
        el.textContent = msg;
    }
    _setBody(html) {
      const el = document.getElementById("ct-vsa-body");
      if (el)
        el.innerHTML = html;
    }
    _setTiles(html) {
      const el = document.getElementById("ct-vsa-tiles");
      if (el)
        el.innerHTML = html;
    }
    _getFilteredVehicles() {
      let list = this._vehicles;
      if (this._searchTerm) {
        const term = this._searchTerm;
        list = list.filter(
          (v) => v.registrationNo.toLowerCase().includes(term) || v.vin.toLowerCase().includes(term) || v.stationCode.toLowerCase().includes(term) || v.status.toLowerCase().includes(term)
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
    _renderTiles() {
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
          <div class="ct-vsa-tile-lbl">Ausgew\xE4hlt</div>
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
    _renderBody() {
      var _a;
      if (!this._overlayEl)
        return;
      if (this._vehicles.length === 0) {
        this._setBody('<div class="ct-vsa-empty">Keine Fahrzeuge verf\xFCgbar.</div>');
        return;
      }
      const filtered = this._getFilteredVehicles();
      const total = filtered.length;
      const totalPages = Math.ceil(total / this._pageSize);
      if (this._currentPage > totalPages)
        this._currentPage = totalPages || 1;
      const start = (this._currentPage - 1) * this._pageSize;
      const slice = filtered.slice(start, start + this._pageSize);
      const allVisibleSelected = slice.length > 0 && slice.every((v) => this._selectedVins.has(v.vin));
      const sortIcon = (col) => {
        if (this._sortColumn !== col)
          return " \u2195";
        return this._sortAsc ? " \u2191" : " \u2193";
      };
      const rows = slice.map((v, i) => {
        const isSelected = this._selectedVins.has(v.vin);
        const rowNum = start + i + 1;
        const statusCls = v.status === "ACTIVE" ? "ct-vsa-status--active" : v.status === "MAINTENANCE" ? "ct-vsa-status--maintenance" : "ct-vsa-status--pending";
        return `<tr class="${isSelected ? "ct-vsa-row--selected" : ""}" role="row">
        <td class="ct-vsa-td-check">
          <input type="checkbox" class="ct-vsa-check" data-vin="${esc(v.vin)}"
                 ${isSelected ? "checked" : ""} aria-label="Fahrzeug ${esc(v.registrationNo)} ausw\xE4hlen">
        </td>
        <td>${rowNum}</td>
        <td>${esc(v.stationCode)}</td>
        <td><strong>${esc(v.registrationNo)}</strong></td>
        <td class="ct-vsa-td-vin">${esc(v.vin)}</td>
        <td><span class="${statusCls}">${esc(v.status)}</span></td>
      </tr>`;
      }).join("");
      this._setBody(`
      <div class="ct-vsa-table-wrap">
        <table class="ct-table ct-vsa-table" role="grid">
          <thead><tr>
            <th scope="col" class="ct-vsa-th-check">
              <input type="checkbox" id="ct-vsa-select-all" ${allVisibleSelected ? "checked" : ""}
                     aria-label="Alle sichtbaren Fahrzeuge ausw\xE4hlen">
            </th>
            <th scope="col">#</th>
            <th scope="col">Station</th>
            <th scope="col" class="ct-vsa-th-sortable" data-sort="registrationNo">Kennzeichen${sortIcon("registrationNo")}</th>
            <th scope="col" class="ct-vsa-th-sortable" data-sort="vin">VIN${sortIcon("vin")}</th>
            <th scope="col">Status</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="ct-vsa-empty">Keine Treffer f\xFCr den Suchbegriff.</td></tr>'}</tbody>
        </table>
      </div>
      ${this._renderPagination(total, this._currentPage, totalPages)}
    `);
      (_a = document.getElementById("ct-vsa-select-all")) == null ? void 0 : _a.addEventListener("change", (e) => {
        const checked = e.target.checked;
        const visibleVins = slice.map((v) => v.vin);
        for (const vin of visibleVins) {
          if (checked)
            this._selectedVins.add(vin);
          else
            this._selectedVins.delete(vin);
        }
        this._renderTiles();
        this._renderBody();
        this._updateFooter();
      });
      this._overlayEl.querySelectorAll(".ct-vsa-check").forEach((cb) => {
        cb.addEventListener("change", (e) => {
          const input = e.target;
          const vin = input.dataset["vin"];
          if (input.checked)
            this._selectedVins.add(vin);
          else
            this._selectedVins.delete(vin);
          this._renderTiles();
          this._updateFooter();
          const selectAll = document.getElementById("ct-vsa-select-all");
          if (selectAll) {
            selectAll.checked = slice.every((v) => this._selectedVins.has(v.vin));
          }
        });
      });
      this._overlayEl.querySelectorAll(".ct-vsa-th-sortable").forEach((th) => {
        th.addEventListener("click", () => {
          const col = th.dataset["sort"];
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
    _renderPagination(total, current, totalPages) {
      if (totalPages <= 1)
        return "";
      return `
      <div class="ct-vsa-pagination">
        <button class="ct-btn ct-btn--secondary" id="ct-vsa-prev" ${current <= 1 ? "disabled" : ""}>\u2039 Zur\xFCck</button>
        <span class="ct-vsa-page-info">Seite ${current} / ${totalPages} (${total} Fahrzeuge)</span>
        <button class="ct-btn ct-btn--secondary" id="ct-vsa-next" ${current >= totalPages ? "disabled" : ""}>Weiter \u203A</button>
      </div>`;
    }
    _attachPaginationHandlers() {
      var _a, _b;
      const body = document.getElementById("ct-vsa-body");
      if (!body)
        return;
      (_a = body.querySelector("#ct-vsa-prev")) == null ? void 0 : _a.addEventListener("click", () => {
        if (this._currentPage > 1) {
          this._currentPage--;
          this._renderBody();
        }
      });
      (_b = body.querySelector("#ct-vsa-next")) == null ? void 0 : _b.addEventListener("click", () => {
        const filtered = this._getFilteredVehicles();
        const tp = Math.ceil(filtered.length / this._pageSize);
        if (this._currentPage < tp) {
          this._currentPage++;
          this._renderBody();
        }
      });
    }
    // ── Footer / Selection UI ─────────────────────────────────────────────────
    _updateFooter() {
      const count = this._selectedVins.size;
      const badge = document.getElementById("ct-vsa-badge");
      const btn = document.getElementById("ct-vsa-print");
      if (badge)
        badge.textContent = `${count} von ${this._vehicles.length} Fahrzeuge ausgew\xE4hlt`;
      if (btn)
        btn.disabled = count === 0;
    }
    // ── QR Code Generation ─────────────────────────────────────────────────────
    _generateQRSvg(data, cellSize = 3) {
      try {
        const qr = qrcode_default(0, "H");
        qr.addData(data);
        qr.make();
        const moduleCount = qr.getModuleCount();
        const size = moduleCount * cellSize;
        let paths = "";
        for (let row = 0; row < moduleCount; row++) {
          for (let col = 0; col < moduleCount; col++) {
            if (qr.isDark(row, col)) {
              paths += `M${col * cellSize},${row * cellSize}h${cellSize}v${cellSize}h${-cellSize}z`;
            }
          }
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><path d="${paths}" fill="#000"/></svg>`;
      } catch (e) {
        err("QR generation failed for:", data, e);
        return `<div style="width:120px;height:120px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">QR Error</div>`;
      }
    }
    // ── Print ──────────────────────────────────────────────────────────────────
    _printSelected() {
      const selectedVehicles = this._vehicles.filter((v) => this._selectedVins.has(v.vin));
      if (selectedVehicles.length === 0)
        return;
      const dspCode = this.companyConfig.getDspCode();
      const perPage = 8;
      const pages = [];
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
        }).join("\n");
        pages.push(`<div class="print-page">${pageFrames}</div>`);
      }
      const printHTML = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>VSA QR Codes \u2013 ${esc(dspCode)}</title>
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
  ${pages.join("\n")}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  <\/script>
</body>
</html>`;
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        alert("Popup-Blocker verhindert das \xD6ffnen des Druckfensters. Bitte Popups erlauben.");
        return;
      }
      printWindow.document.open();
      printWindow.document.write(printHTML);
      printWindow.document.close();
    }
  };

  // src/ui/components.ts
  function toggleHTML(id, label, checked) {
    return `
    <div class="ct-settings-row">
      <label for="${esc(id)}">${esc(label)}</label>
      <label class="ct-toggle">
        <input type="checkbox" id="${esc(id)}" ${checked ? "checked" : ""}>
        <span class="ct-slider"></span>
      </label>
    </div>
  `;
  }

  // src/features/settings.ts
  function openSettings(config) {
    const existing = document.getElementById("ct-settings-overlay");
    if (existing)
      existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "ct-settings-overlay";
    overlay.className = "ct-overlay visible";
    overlay.innerHTML = `
    <div class="ct-dialog" style="min-width: 400px;">
      <h3>\u2699 Einstellungen</h3>

      ${toggleHTML("ct-set-whc", "WHC Dashboard", config.features.whcDashboard)}
      ${toggleHTML("ct-set-dre", "Date Range Extractor", config.features.dateExtractor)}
      ${toggleHTML("ct-set-dp", "Daily Delivery Performance", config.features.deliveryPerf)}
      ${toggleHTML("ct-set-dvic", "DVIC Check", config.features.dvicCheck)}
      ${toggleHTML("ct-set-dvic-tp", "DVIC: Transporter-Spalte", config.features.dvicShowTransporters)}
      ${toggleHTML("ct-set-whd", "Working Hours Dashboard", config.features.workingHours)}
      ${toggleHTML("ct-set-ret", "Returns Dashboard", config.features.returnsDashboard)}
      ${toggleHTML("ct-set-sc", "Scorecard", config.features.scorecard)}
      ${toggleHTML("ct-set-vsa", "VSA QR Code Generator", config.features.vsaQr)}
      ${toggleHTML("ct-set-dev", "Dev-Mode (ausf\xFChrliches Logging)", config.dev)}

      <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
        <button class="ct-btn ct-btn--secondary" id="ct-set-cancel">Abbrechen</button>
        <button class="ct-btn ct-btn--accent" id="ct-set-save">Speichern</button>
      </div>
    </div>
  `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay)
        overlay.remove();
    });
    document.getElementById("ct-set-cancel").addEventListener("click", () => overlay.remove());
    document.getElementById("ct-set-save").addEventListener("click", () => {
      const boolVal = (id) => document.getElementById(id).checked;
      config.features.whcDashboard = boolVal("ct-set-whc");
      config.features.dateExtractor = boolVal("ct-set-dre");
      config.features.deliveryPerf = boolVal("ct-set-dp");
      config.features.dvicCheck = boolVal("ct-set-dvic");
      config.features.dvicShowTransporters = boolVal("ct-set-dvic-tp");
      config.features.workingHours = boolVal("ct-set-whd");
      config.features.returnsDashboard = boolVal("ct-set-ret");
      config.features.scorecard = boolVal("ct-set-sc");
      config.features.vsaQr = boolVal("ct-set-vsa");
      config.dev = boolVal("ct-set-dev");
      setConfig(config);
      overlay.remove();
      alert("Einstellungen gespeichert! Seite neu laden f\xFCr vollst\xE4ndige Aktivierung.");
    });
  }

  // src/features/navbar.ts
  function injectNavItem(tools) {
    var _a;
    try {
      if (document.getElementById("ct-nav-item"))
        return;
      const navList = document.querySelector(".fp-nav-menu-list");
      if (!navList) {
        log("Nav list not found");
        return;
      }
      let supportItem = null;
      const items = Array.from(navList.querySelectorAll(":scope > li.fp-nav-menu-list-item"));
      for (const li2 of items) {
        const anchor = li2.querySelector(":scope > a");
        if (anchor && ((_a = anchor.textContent) == null ? void 0 : _a.trim().toLowerCase()) === "support") {
          supportItem = li2;
          break;
        }
      }
      const li = document.createElement("li");
      li.id = "ct-nav-item";
      li.className = "fp-nav-menu-list-item";
      li.innerHTML = `
      <a href="#">Tools</a>
      <i class="fa fa-sort-down fa-2x fp-sub-menu-icon show"></i>
      <i class="fa fa-sort-up fa-2x fp-sub-menu-icon"></i>
      <ul class="fp-sub-menu" aria-expanded="false" role="menu">
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="whc-dashboard">\u{1F4CA} WHC Dashboard</a>
        </li>
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="delivery-perf">\u{1F4E6} Daily Delivery Performance</a>
        </li>
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="dvic-check">\u{1F69B} DVIC Check</a>
        </li>
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="working-hours">\u23F1 Working Hours</a>
        </li>
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="returns">\u{1F4E6} Returns</a>
        </li>
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="scorecard">\u{1F4CB} Scorecard</a>
        </li>
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="vsa-qr">\u{1F4F1} VSA QR Codes</a>
        </li>
        <li class="ct-divider"></li>
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="settings">\u2699 Einstellungen</a>
        </li>
      </ul>
    `;
      const submenu = li.querySelector(".fp-sub-menu");
      submenu.addEventListener("click", (e) => {
        const anchor = e.target.closest("a[data-ct-tool]");
        if (!anchor)
          return;
        e.preventDefault();
        e.stopPropagation();
        const tool = anchor.getAttribute("data-ct-tool");
        try {
          switch (tool) {
            case "whc-dashboard":
              tools.whcDashboard.toggle();
              break;
            case "date-extractor":
              tools.dateRangeExtractor.showDialog();
              break;
            case "delivery-perf":
              tools.deliveryPerformance.toggle();
              break;
            case "dvic-check":
              tools.dvicCheck.toggle();
              break;
            case "working-hours":
              tools.workingHoursDashboard.toggle();
              break;
            case "returns":
              tools.returnsDashboard.toggle();
              break;
            case "scorecard":
              tools.scorecardDashboard.toggle();
              break;
            case "vsa-qr":
              tools.vsaQrGenerator.toggle();
              break;
            case "settings":
              tools.openSettings();
              break;
          }
        } catch (ex) {
          err("Tool action failed:", tool, ex);
        }
      });
      if (supportItem) {
        supportItem.after(li);
      } else {
        navList.appendChild(li);
      }
      log("Nav item injected");
    } catch (e) {
      err("Failed to inject nav item:", e);
    }
  }
  function watchNavigation(getTools) {
    const handler = () => {
      log("fp-navigation-loaded event");
      setTimeout(() => injectNavItem(getTools()), 100);
    };
    document.addEventListener("fp-navigation-loaded", handler);
    onDispose(() => document.removeEventListener("fp-navigation-loaded", handler));
    const obs = new MutationObserver(() => {
      if (!document.getElementById("ct-nav-item") && document.querySelector(".fp-nav-menu-list")) {
        injectNavItem(getTools());
      }
    });
    const navContainer = document.querySelector(".fp-navigation-container") || document.body;
    obs.observe(navContainer, { childList: true, subtree: true });
    onDispose(() => obs.disconnect());
  }
  function onUrlChange(cb) {
    let last = location.href;
    new MutationObserver(() => {
      if (location.href !== last) {
        last = location.href;
        cb(location.href);
      }
    }).observe(document, { subtree: true, childList: true });
    for (const method of ["pushState", "replaceState"]) {
      const orig = history[method];
      history[method] = function(...args) {
        const ret = orig.apply(this, args);
        window.dispatchEvent(new Event("locationchange"));
        return ret;
      };
    }
    window.addEventListener("popstate", () => window.dispatchEvent(new Event("locationchange")));
    window.addEventListener("locationchange", () => cb(location.href));
  }
  async function boot(tools, companyConfigLoad, url = location.href) {
    log("Boot for", url);
    injectNavItem(tools);
    try {
      await companyConfigLoad();
      log("Company config loaded");
    } catch (e) {
      err("Company config load failed:", e);
    }
  }

  // src/index.ts
  (function() {
    "use strict";
    let config = getConfig();
    if (!config.enabled)
      return;
    initLogging(config);
    log("Cortex Tools loading\u2026");
    injectStyles();
    const companyConfig = new CompanyConfig(config);
    const whcDashboard = new WhcDashboard(config, companyConfig);
    const dateRangeExtractor = new DateRangeExtractor(config, companyConfig);
    const deliveryPerformance = new DeliveryPerformance(config, companyConfig);
    const dvicCheck = new DvicCheck(config, companyConfig);
    const workingHoursDashboard = new WorkingHoursDashboard(config, companyConfig);
    const returnsDashboard = new ReturnsDashboard(config, companyConfig);
    const scorecardDashboard = new ScorecardDashboard(config, companyConfig);
    const vsaQrGenerator = new VsaQrGenerator(config, companyConfig);
    const handleOpenSettings = () => {
      config = getConfig();
      openSettings(config);
    };
    const tools = {
      whcDashboard,
      dateRangeExtractor,
      deliveryPerformance,
      dvicCheck,
      workingHoursDashboard,
      returnsDashboard,
      scorecardDashboard,
      vsaQrGenerator,
      openSettings: handleOpenSettings
    };
    GM_registerMenuCommand("\u{1F4CA} WHC Dashboard", () => whcDashboard.toggle());
    GM_registerMenuCommand("\u{1F4C5} Date Range Extractor", () => dateRangeExtractor.showDialog());
    GM_registerMenuCommand("\u{1F4E6} Daily Delivery Performance", () => deliveryPerformance.toggle());
    GM_registerMenuCommand("\u{1F69B} DVIC Check", () => dvicCheck.toggle());
    GM_registerMenuCommand("\u23F1 Working Hours", () => workingHoursDashboard.toggle());
    GM_registerMenuCommand("\u{1F4E6} Returns Dashboard", () => returnsDashboard.toggle());
    GM_registerMenuCommand("\u{1F4CB} Scorecard", () => scorecardDashboard.toggle());
    GM_registerMenuCommand("\u{1F4F1} VSA QR Codes", () => vsaQrGenerator.toggle());
    GM_registerMenuCommand("\u2699 Einstellungen", handleOpenSettings);
    GM_registerMenuCommand("\u23F8 Skript pausieren", () => {
      config.enabled = false;
      setConfig(config);
      disposeAll();
      const navItem = document.getElementById("ct-nav-item");
      if (navItem)
        navItem.remove();
      alert("Cortex Tools pausiert. Seite neu laden zum Reaktivieren.");
    });
    waitForElement(".fp-nav-menu-list").then(() => {
      boot(tools, () => companyConfig.load());
      watchNavigation(() => tools);
    }).catch((e) => {
      err("Nav not found, retrying...", e);
      setTimeout(() => {
        injectNavItem(tools);
        watchNavigation(() => tools);
      }, 3e3);
    });
    onUrlChange((url) => {
      log("URL changed:", url);
      if (!document.getElementById("ct-nav-item")) {
        injectNavItem(tools);
      }
    });
    log("Cortex Tools loaded");
  })();
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2NvcmUvc3RvcmFnZS50cyIsICIuLi9zcmMvY29yZS91dGlscy50cyIsICIuLi9zcmMvY29yZS9hcGkudHMiLCAiLi4vc3JjL3VpL3N0eWxlcy50cyIsICIuLi9zcmMvZmVhdHVyZXMvd2hjLWRhc2hib2FyZC50cyIsICIuLi9zcmMvZmVhdHVyZXMvZGF0ZS1leHRyYWN0b3IudHMiLCAiLi4vc3JjL2ZlYXR1cmVzL2RlbGl2ZXJ5LXBlcmZvcm1hbmNlLnRzIiwgIi4uL3NyYy9mZWF0dXJlcy9kdmljLWNoZWNrLnRzIiwgIi4uL3NyYy9mZWF0dXJlcy93b3JraW5nLWhvdXJzLnRzIiwgIi4uL3NyYy9mZWF0dXJlcy9yZXR1cm5zLWRhc2hib2FyZC50cyIsICIuLi9zcmMvZmVhdHVyZXMvc2NvcmVjYXJkLnRzIiwgIi4uL25vZGVfbW9kdWxlcy9xcmNvZGUtZ2VuZXJhdG9yL2Rpc3QvcXJjb2RlLm1qcyIsICIuLi9zcmMvZmVhdHVyZXMvdnNhLXFyLnRzIiwgIi4uL3NyYy91aS9jb21wb25lbnRzLnRzIiwgIi4uL3NyYy9mZWF0dXJlcy9zZXR0aW5ncy50cyIsICIuLi9zcmMvZmVhdHVyZXMvbmF2YmFyLnRzIiwgIi4uL3NyYy9pbmRleC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gY29yZS9zdG9yYWdlLnRzIFx1MjAxMyBHTV9nZXRWYWx1ZSAvIEdNX3NldFZhbHVlIHdyYXBwZXJzIHdpdGggdHlwZWQgZGVmYXVsdHNcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgRmVhdHVyZXNDb25maWcge1xyXG4gIHdoY0Rhc2hib2FyZDogYm9vbGVhbjtcclxuICBkYXRlRXh0cmFjdG9yOiBib29sZWFuO1xyXG4gIGRlbGl2ZXJ5UGVyZjogYm9vbGVhbjtcclxuICBkdmljQ2hlY2s6IGJvb2xlYW47XHJcbiAgZHZpY1Nob3dUcmFuc3BvcnRlcnM6IGJvb2xlYW47XHJcbiAgd29ya2luZ0hvdXJzOiBib29sZWFuO1xyXG4gIHJldHVybnNEYXNoYm9hcmQ6IGJvb2xlYW47XHJcbiAgc2NvcmVjYXJkOiBib29sZWFuO1xyXG4gIHZzYVFyOiBib29sZWFuO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEFwcENvbmZpZyB7XHJcbiAgZW5hYmxlZDogYm9vbGVhbjtcclxuICBkZXY6IGJvb2xlYW47XHJcbiAgc2VydmljZUFyZWFJZDogc3RyaW5nO1xyXG4gIGRlbGl2ZXJ5UGVyZlN0YXRpb246IHN0cmluZztcclxuICBkZWxpdmVyeVBlcmZEc3A6IHN0cmluZztcclxuICBmZWF0dXJlczogRmVhdHVyZXNDb25maWc7XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBERUZBVUxUUzogQXBwQ29uZmlnID0ge1xyXG4gIGVuYWJsZWQ6IHRydWUsXHJcbiAgZGV2OiBmYWxzZSxcclxuICBzZXJ2aWNlQXJlYUlkOiAnY2YxNDRjNDYtMWM1Ni00NGQzLWIzNDQtZmNkMzI5ODZiNmQ1JyxcclxuICBkZWxpdmVyeVBlcmZTdGF0aW9uOiAnREhCMScsXHJcbiAgZGVsaXZlcnlQZXJmRHNwOiAnRk9VUicsXHJcbiAgZmVhdHVyZXM6IHtcclxuICAgIHdoY0Rhc2hib2FyZDogdHJ1ZSxcclxuICAgIGRhdGVFeHRyYWN0b3I6IHRydWUsXHJcbiAgICBkZWxpdmVyeVBlcmY6IHRydWUsXHJcbiAgICBkdmljQ2hlY2s6IHRydWUsXHJcbiAgICBkdmljU2hvd1RyYW5zcG9ydGVyczogdHJ1ZSxcclxuICAgIHdvcmtpbmdIb3VyczogdHJ1ZSxcclxuICAgIHJldHVybnNEYXNoYm9hcmQ6IHRydWUsXHJcbiAgICBzY29yZWNhcmQ6IHRydWUsXHJcbiAgICB2c2FRcjogdHJ1ZSxcclxuICB9LFxyXG59O1xyXG5cclxuY29uc3QgQ09ORklHX0tFWSA9ICdjdF9jb25maWcnO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGdldENvbmZpZygpOiBBcHBDb25maWcge1xyXG4gIGNvbnN0IHJhdyA9IEdNX2dldFZhbHVlKENPTkZJR19LRVksIG51bGwpIGFzIHN0cmluZyB8IG51bGw7XHJcbiAgaWYgKCFyYXcpIHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSkgYXMgQXBwQ29uZmlnO1xyXG4gIHRyeSB7XHJcbiAgICBjb25zdCBzYXZlZDogUGFydGlhbDxBcHBDb25maWc+ID0gdHlwZW9mIHJhdyA9PT0gJ3N0cmluZycgPyBKU09OLnBhcnNlKHJhdykgOiByYXc7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAuLi5ERUZBVUxUUyxcclxuICAgICAgLi4uc2F2ZWQsXHJcbiAgICAgIGZlYXR1cmVzOiB7IC4uLkRFRkFVTFRTLmZlYXR1cmVzLCAuLi4oc2F2ZWQuZmVhdHVyZXMgfHwge30pIH0sXHJcbiAgICAgIGRlbGl2ZXJ5UGVyZlN0YXRpb246IHNhdmVkLmRlbGl2ZXJ5UGVyZlN0YXRpb24gfHwgREVGQVVMVFMuZGVsaXZlcnlQZXJmU3RhdGlvbixcclxuICAgICAgZGVsaXZlcnlQZXJmRHNwOiBzYXZlZC5kZWxpdmVyeVBlcmZEc3AgfHwgREVGQVVMVFMuZGVsaXZlcnlQZXJmRHNwLFxyXG4gICAgfTtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KERFRkFVTFRTKSkgYXMgQXBwQ29uZmlnO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNldENvbmZpZyhjZmc6IEFwcENvbmZpZyk6IHZvaWQge1xyXG4gIEdNX3NldFZhbHVlKENPTkZJR19LRVksIEpTT04uc3RyaW5naWZ5KGNmZykpO1xyXG59XHJcbiIsICIvLyBjb3JlL3V0aWxzLnRzIFx1MjAxMyBTaGFyZWQgaGVscGVyIGZ1bmN0aW9ucyBhbmQgY29uc3RhbnRzXHJcblxyXG5pbXBvcnQgdHlwZSB7IEFwcENvbmZpZyB9IGZyb20gJy4vc3RvcmFnZSc7XHJcblxyXG5leHBvcnQgY29uc3QgTE9HX1BSRUZJWCA9ICdbQ29ydGV4VG9vbHNdJztcclxuXHJcbmV4cG9ydCBjb25zdCBEQVlTID0gWydNbycsICdEaScsICdNaScsICdEbycsICdGcicsICdTYScsICdTbyddIGFzIGNvbnN0O1xyXG5leHBvcnQgY29uc3QgQVBJX1VSTCA9ICdodHRwczovL2xvZ2lzdGljcy5hbWF6b24uZGUvc2NoZWR1bGluZy9ob21lL2FwaS92Mi9hc3NvY2lhdGUtYXR0cmlidXRlcyc7XHJcblxyXG4vLyBcdTI1MDBcdTI1MDAgTG9nZ2luZyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbmxldCBfY29uZmlnOiBBcHBDb25maWcgfCBudWxsID0gbnVsbDtcclxuXHJcbi8qKiBDYWxsIG9uY2UgYXQgc3RhcnR1cCB0byBiaW5kIGNvbmZpZyB0byBsb2cgaGVscGVycy4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGluaXRMb2dnaW5nKGNvbmZpZzogQXBwQ29uZmlnKTogdm9pZCB7XHJcbiAgX2NvbmZpZyA9IGNvbmZpZztcclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IGxvZyA9ICguLi5hcmdzOiB1bmtub3duW10pOiB2b2lkID0+IHtcclxuICBpZiAoX2NvbmZpZz8uZGV2KSBjb25zb2xlLmxvZyhMT0dfUFJFRklYLCAuLi5hcmdzKTtcclxufTtcclxuXHJcbmV4cG9ydCBjb25zdCBlcnIgPSAoLi4uYXJnczogdW5rbm93bltdKTogdm9pZCA9PiB7XHJcbiAgY29uc29sZS5lcnJvcihMT0dfUFJFRklYLCAuLi5hcmdzKTtcclxufTtcclxuXHJcbi8vIFx1MjUwMFx1MjUwMCBEaXNwb3NlIC8gQ2xlYW51cCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbmNvbnN0IF9kaXNwb3NlcnM6IEFycmF5PCgpID0+IHZvaWQ+ID0gW107XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gb25EaXNwb3NlKGZuOiAoKSA9PiB2b2lkKTogKCkgPT4gdm9pZCB7XHJcbiAgX2Rpc3Bvc2Vycy5wdXNoKGZuKTtcclxuICByZXR1cm4gZm47XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBkaXNwb3NlQWxsKCk6IHZvaWQge1xyXG4gIHdoaWxlIChfZGlzcG9zZXJzLmxlbmd0aCkge1xyXG4gICAgdHJ5IHsgX2Rpc3Bvc2Vycy5wb3AoKSEoKTsgfSBjYXRjaCB7IC8qIGlnbm9yZSAqLyB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBcdTI1MDBcdTI1MDAgRE9NIEhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4vKiogSFRNTC1lc2NhcGUgYSB2YWx1ZSBzbyBpdCBpcyBzYWZlIHRvIGludGVycG9sYXRlIGludG8gaW5uZXJIVE1MLiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gZXNjKHM6IHVua25vd24pOiBzdHJpbmcge1xyXG4gIHJldHVybiBTdHJpbmcocylcclxuICAgIC5yZXBsYWNlKC8mL2csICcmYW1wOycpXHJcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXHJcbiAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXHJcbiAgICAucmVwbGFjZSgvXCIvZywgJyZxdW90OycpXHJcbiAgICAucmVwbGFjZSgvJy9nLCAnJiMzOTsnKTtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBXYWl0Rm9yRWxlbWVudE9wdGlvbnMge1xyXG4gIHRpbWVvdXQ/OiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBXYWl0IGZvciBhIENTUyBzZWxlY3RvciB0byBhcHBlYXIgaW4gdGhlIERPTS4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHdhaXRGb3JFbGVtZW50KFxyXG4gIHNlbGVjdG9yOiBzdHJpbmcsXHJcbiAgeyB0aW1lb3V0ID0gMTUwMDAgfTogV2FpdEZvckVsZW1lbnRPcHRpb25zID0ge30sXHJcbik6IFByb21pc2U8RWxlbWVudD4ge1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xyXG4gICAgaWYgKGVsKSByZXR1cm4gcmVzb2x2ZShlbCk7XHJcbiAgICBjb25zdCBvYnMgPSBuZXcgTXV0YXRpb25PYnNlcnZlcigoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGVsMiA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xyXG4gICAgICBpZiAoZWwyKSB7IG9icy5kaXNjb25uZWN0KCk7IHJlc29sdmUoZWwyKTsgfVxyXG4gICAgfSk7XHJcbiAgICBvYnMub2JzZXJ2ZShkb2N1bWVudCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XHJcbiAgICBpZiAodGltZW91dCkge1xyXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICBvYnMuZGlzY29ubmVjdCgpO1xyXG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoYFRpbWVvdXQgd2FpdGluZyBmb3IgJHtzZWxlY3Rvcn1gKSk7XHJcbiAgICAgIH0sIHRpbWVvdXQpO1xyXG4gICAgfVxyXG4gIH0pO1xyXG59XHJcblxyXG4vKiogUHJvbWlzZS1iYXNlZCBkZWxheS4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGRlbGF5KG1zOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcclxuICByZXR1cm4gbmV3IFByb21pc2UoKHIpID0+IHNldFRpbWVvdXQociwgbXMpKTtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBSZXRyeU9wdGlvbnMge1xyXG4gIHJldHJpZXM/OiBudW1iZXI7XHJcbiAgYmFzZU1zPzogbnVtYmVyO1xyXG59XHJcblxyXG4vKiogUmV0cnkgYW4gYXN5bmMgZnVuY3Rpb24gd2l0aCBleHBvbmVudGlhbCBiYWNrb2ZmLiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd2l0aFJldHJ5PFQ+KFxyXG4gIGZuOiAoKSA9PiBQcm9taXNlPFQ+LFxyXG4gIHsgcmV0cmllcyA9IDMsIGJhc2VNcyA9IDUwMCB9OiBSZXRyeU9wdGlvbnMgPSB7fSxcclxuKTogUHJvbWlzZTxUPiB7XHJcbiAgbGV0IGF0dGVtcHQgPSAwO1xyXG4gIHdoaWxlICh0cnVlKSB7XHJcbiAgICB0cnkgeyByZXR1cm4gYXdhaXQgZm4oKTsgfVxyXG4gICAgY2F0Y2ggKGUpIHtcclxuICAgICAgaWYgKCsrYXR0ZW1wdCA+IHJldHJpZXMpIHRocm93IGU7XHJcbiAgICAgIGF3YWl0IGRlbGF5KGJhc2VNcyAqIDIgKiogKGF0dGVtcHQgLSAxKSk7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vKiogRXh0cmFjdCB0aGUgQ1NSRiB0b2tlbiBmcm9tIG1ldGEgdGFnIG9yIGNvb2tpZS4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGdldENTUkZUb2tlbigpOiBzdHJpbmcgfCBudWxsIHtcclxuICBjb25zdCBtZXRhID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcjxIVE1MTWV0YUVsZW1lbnQ+KCdtZXRhW25hbWU9XCJhbnRpLWNzcmZ0b2tlbi1hMnpcIl0nKTtcclxuICBpZiAobWV0YSkgcmV0dXJuIG1ldGEuZ2V0QXR0cmlidXRlKCdjb250ZW50Jyk7XHJcbiAgY29uc3QgY29va2llcyA9IGRvY3VtZW50LmNvb2tpZS5zcGxpdCgnOycpO1xyXG4gIGZvciAoY29uc3QgYyBvZiBjb29raWVzKSB7XHJcbiAgICBjb25zdCBbaywgdl0gPSBjLnRyaW0oKS5zcGxpdCgnPScpO1xyXG4gICAgaWYgKGsgPT09ICdhbnRpLWNzcmZ0b2tlbi1hMnonKSByZXR1cm4gdjtcclxuICB9XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbi8qKiBFeHRyYWN0IHRoZSBzZXNzaW9uIElEIGZyb20gY29va2llcy4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RTZXNzaW9uRnJvbUNvb2tpZSgpOiBzdHJpbmcgfCBudWxsIHtcclxuICBjb25zdCBtID0gZG9jdW1lbnQuY29va2llLm1hdGNoKC9zZXNzaW9uLWlkPShbXjtdKykvKTtcclxuICByZXR1cm4gbSA/IG1bMV0gOiBudWxsO1xyXG59XHJcblxyXG4vKiogUmV0dXJuIHRvZGF5J3MgZGF0ZSBhcyBZWVlZLU1NLUREIHN0cmluZyAobG9jYWwgdGltZXpvbmUpLiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gdG9kYXlTdHIoKTogc3RyaW5nIHtcclxuICByZXR1cm4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF07XHJcbn1cclxuXHJcbi8qKiBBZGQgTiBkYXlzIHRvIGEgWVlZWS1NTS1ERCBkYXRlIHN0cmluZy4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGFkZERheXMoZGF0ZVN0cjogc3RyaW5nLCBuOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShkYXRlU3RyICsgJ1QwMDowMDowMCcpO1xyXG4gIGQuc2V0RGF0ZShkLmdldERhdGUoKSArIG4pO1xyXG4gIHJldHVybiBkLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXTtcclxufVxyXG4iLCAiLy8gY29yZS9hcGkudHMgXHUyMDEzIENlbnRyYWxpc2VkIHNlcnZpY2UtYXJlYSAmIERTUCBjb25maWd1cmF0aW9uICsgQVBJIGhlbHBlcnNcclxuXHJcbmltcG9ydCB7IGxvZywgZXJyLCBnZXRDU1JGVG9rZW4sIHdpdGhSZXRyeSB9IGZyb20gJy4vdXRpbHMnO1xyXG5pbXBvcnQgeyBERUZBVUxUUyB9IGZyb20gJy4vc3RvcmFnZSc7XHJcbmltcG9ydCB0eXBlIHsgQXBwQ29uZmlnIH0gZnJvbSAnLi9zdG9yYWdlJztcclxuaW1wb3J0IHsgZXNjIH0gZnJvbSAnLi91dGlscyc7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZpY2VBcmVhIHtcclxuICBzZXJ2aWNlQXJlYUlkOiBzdHJpbmc7XHJcbiAgc3RhdGlvbkNvZGU6IHN0cmluZztcclxufVxyXG5cclxuLyoqXHJcbiAqIENlbnRyYWxpc2VkIGNvbmZpZ3VyYXRpb24gbGF5ZXIgdGhhdCBhdXRvLWRldGVjdHMgRFNQLCBzdGF0aW9uLCBhbmRcclxuICogc2VydmljZSBhcmVhcyBmcm9tIHRoZSB1c2VyJ3MgY29tcGFueSBwcm9maWxlLiBWYWx1ZXMgYXJlIGxvYWRlZCBvbmNlXHJcbiAqIGFuZCByZW1haW4gaW1tdXRhYmxlIGZvciB0aGUgc2Vzc2lvbi5cclxuICpcclxuICogU2VydmljZSBhcmVhcyBjb21lIGZyb206XHJcbiAqICAgR0VUIC9hY2NvdW50LW1hbmFnZW1lbnQvZGF0YS9nZXQtY29tcGFueS1zZXJ2aWNlLWFyZWFzXHJcbiAqICAgXHUyMTkyIHsgc3VjY2VzczogdHJ1ZSwgZGF0YTogW3sgc2VydmljZUFyZWFJZCwgc3RhdGlvbkNvZGUgfV0gfVxyXG4gKlxyXG4gKiBEU1AgY29kZSBpcyBpbmZlcnJlZCBmcm9tIHRoZSBjb21wYW55IGRldGFpbHMgcGFnZSBvciBwZXJmb3JtYW5jZSBBUEkuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgQ29tcGFueUNvbmZpZyB7XHJcbiAgcHJpdmF0ZSBfbG9hZGVkID0gZmFsc2U7XHJcbiAgcHJpdmF0ZSBfbG9hZGluZzogUHJvbWlzZTx2b2lkPiB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgX3NlcnZpY2VBcmVhczogU2VydmljZUFyZWFbXSA9IFtdO1xyXG4gIHByaXZhdGUgX2RzcENvZGU6IHN0cmluZyB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgX2RlZmF1bHRTdGF0aW9uOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIF9kZWZhdWx0U2VydmljZUFyZWFJZDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgY29uZmlnOiBBcHBDb25maWcpIHt9XHJcblxyXG4gIC8qKlxyXG4gICAqIExvYWQgc2VydmljZSBhcmVhcyBhbmQgYXV0by1kZXRlY3QgRFNQLiBTYWZlIHRvIGNhbGwgbXVsdGlwbGUgdGltZXMgXHUyMDE0XHJcbiAgICogc3Vic2VxdWVudCBjYWxscyByZXR1cm4gdGhlIHNhbWUgcHJvbWlzZS5cclxuICAgKi9cclxuICBhc3luYyBsb2FkKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKHRoaXMuX2xvYWRlZCkgcmV0dXJuO1xyXG4gICAgaWYgKHRoaXMuX2xvYWRpbmcpIHJldHVybiB0aGlzLl9sb2FkaW5nO1xyXG4gICAgdGhpcy5fbG9hZGluZyA9IHRoaXMuX2RvTG9hZCgpO1xyXG4gICAgYXdhaXQgdGhpcy5fbG9hZGluZztcclxuICAgIHRoaXMuX2xvYWRlZCA9IHRydWU7XHJcbiAgICB0aGlzLl9sb2FkaW5nID0gbnVsbDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgX2RvTG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIDEuIExvYWQgc2VydmljZSBhcmVhc1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKFxyXG4gICAgICAgICdodHRwczovL2xvZ2lzdGljcy5hbWF6b24uZGUvYWNjb3VudC1tYW5hZ2VtZW50L2RhdGEvZ2V0LWNvbXBhbnktc2VydmljZS1hcmVhcycsXHJcbiAgICAgICAgeyBjcmVkZW50aWFsczogJ2luY2x1ZGUnIH0sXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXNwLmpzb24oKTtcclxuICAgICAgaWYgKGpzb24uc3VjY2VzcyAmJiBBcnJheS5pc0FycmF5KGpzb24uZGF0YSkgJiYganNvbi5kYXRhLmxlbmd0aCA+IDApIHtcclxuICAgICAgICB0aGlzLl9zZXJ2aWNlQXJlYXMgPSBqc29uLmRhdGEgYXMgU2VydmljZUFyZWFbXTtcclxuICAgICAgICB0aGlzLl9kZWZhdWx0U2VydmljZUFyZWFJZCA9IGpzb24uZGF0YVswXS5zZXJ2aWNlQXJlYUlkO1xyXG4gICAgICAgIHRoaXMuX2RlZmF1bHRTdGF0aW9uID0ganNvbi5kYXRhWzBdLnN0YXRpb25Db2RlO1xyXG4gICAgICAgIGxvZygnTG9hZGVkJywganNvbi5kYXRhLmxlbmd0aCwgJ3NlcnZpY2UgYXJlYXMnKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBlcnIoJ0ZhaWxlZCB0byBsb2FkIHNlcnZpY2UgYXJlYXM6JywgZSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gMi4gQXV0by1kZXRlY3QgRFNQIGNvZGUgZnJvbSBjb21wYW55IGRldGFpbHNcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBmZXRjaChcclxuICAgICAgICAnaHR0cHM6Ly9sb2dpc3RpY3MuYW1hem9uLmRlL2FjY291bnQtbWFuYWdlbWVudC9kYXRhL2dldC1jb21wYW55LWRldGFpbHMnLFxyXG4gICAgICAgIHsgY3JlZGVudGlhbHM6ICdpbmNsdWRlJyB9LFxyXG4gICAgICApO1xyXG4gICAgICBjb25zdCBqc29uID0gYXdhaXQgcmVzcC5qc29uKCk7XHJcbiAgICAgIGNvbnN0IGRzcCA9XHJcbiAgICAgICAganNvbj8uZGF0YT8uZHNwU2hvcnRDb2RlIHx8XHJcbiAgICAgICAganNvbj8uZGF0YT8uY29tcGFueVNob3J0Q29kZSB8fFxyXG4gICAgICAgIGpzb24/LmRhdGE/LnNob3J0Q29kZSB8fFxyXG4gICAgICAgIGpzb24/LmRzcFNob3J0Q29kZSB8fFxyXG4gICAgICAgIG51bGw7XHJcbiAgICAgIGlmIChkc3ApIHtcclxuICAgICAgICB0aGlzLl9kc3BDb2RlID0gU3RyaW5nKGRzcCkudG9VcHBlckNhc2UoKTtcclxuICAgICAgICBsb2coJ0F1dG8tZGV0ZWN0ZWQgRFNQIGNvZGU6JywgdGhpcy5fZHNwQ29kZSk7XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICBsb2coJ0NvbXBhbnkgZGV0YWlscyBub3QgYXZhaWxhYmxlLCB3aWxsIGRldGVjdCBEU1AgZnJvbSBwZXJmb3JtYW5jZSBkYXRhJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gMy4gRmFsbGJhY2s6IHRyeSBleHRyYWN0aW5nIGZyb20gcGFnZSBjb250ZW50XHJcbiAgICBpZiAoIXRoaXMuX2RzcENvZGUpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBuYXZFbCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoXHJcbiAgICAgICAgICAnW2RhdGEtdGVzdGlkPVwiY29tcGFueS1uYW1lXCJdLCAuY29tcGFueS1uYW1lLCAuZHNwLW5hbWUnLFxyXG4gICAgICAgICk7XHJcbiAgICAgICAgaWYgKG5hdkVsKSB7XHJcbiAgICAgICAgICBjb25zdCB0ZXh0ID0gbmF2RWwudGV4dENvbnRlbnQ/LnRyaW0oKSA/PyAnJztcclxuICAgICAgICAgIGlmICh0ZXh0ICYmIHRleHQubGVuZ3RoIDw9IDEwKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2RzcENvZGUgPSB0ZXh0LnRvVXBwZXJDYXNlKCk7XHJcbiAgICAgICAgICAgIGxvZygnRFNQIGNvZGUgZnJvbSBwYWdlIGVsZW1lbnQ6JywgdGhpcy5fZHNwQ29kZSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIHsgLyogaWdub3JlICovIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyA0LiBGaW5hbCBmYWxsYmFjazogdXNlIHRoZSBzYXZlZCBjb25maWcgdmFsdWVcclxuICAgIGlmICghdGhpcy5fZHNwQ29kZSkge1xyXG4gICAgICB0aGlzLl9kc3BDb2RlID0gdGhpcy5jb25maWcuZGVsaXZlcnlQZXJmRHNwIHx8IERFRkFVTFRTLmRlbGl2ZXJ5UGVyZkRzcDtcclxuICAgICAgbG9nKCdVc2luZyBzYXZlZCBEU1AgY29kZTonLCB0aGlzLl9kc3BDb2RlKTtcclxuICAgIH1cclxuICAgIGlmICghdGhpcy5fZGVmYXVsdFN0YXRpb24pIHtcclxuICAgICAgdGhpcy5fZGVmYXVsdFN0YXRpb24gPSB0aGlzLmNvbmZpZy5kZWxpdmVyeVBlcmZTdGF0aW9uIHx8IERFRkFVTFRTLmRlbGl2ZXJ5UGVyZlN0YXRpb247XHJcbiAgICB9XHJcbiAgICBpZiAoIXRoaXMuX2RlZmF1bHRTZXJ2aWNlQXJlYUlkKSB7XHJcbiAgICAgIHRoaXMuX2RlZmF1bHRTZXJ2aWNlQXJlYUlkID0gdGhpcy5jb25maWcuc2VydmljZUFyZWFJZCB8fCBERUZBVUxUUy5zZXJ2aWNlQXJlYUlkO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgZ2V0U2VydmljZUFyZWFzKCk6IFNlcnZpY2VBcmVhW10ge1xyXG4gICAgcmV0dXJuIHRoaXMuX3NlcnZpY2VBcmVhcztcclxuICB9XHJcblxyXG4gIGdldERzcENvZGUoKTogc3RyaW5nIHtcclxuICAgIHJldHVybiB0aGlzLl9kc3BDb2RlIHx8IHRoaXMuY29uZmlnLmRlbGl2ZXJ5UGVyZkRzcCB8fCBERUZBVUxUUy5kZWxpdmVyeVBlcmZEc3A7XHJcbiAgfVxyXG5cclxuICBnZXREZWZhdWx0U3RhdGlvbigpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIHRoaXMuX2RlZmF1bHRTdGF0aW9uIHx8IHRoaXMuY29uZmlnLmRlbGl2ZXJ5UGVyZlN0YXRpb24gfHwgREVGQVVMVFMuZGVsaXZlcnlQZXJmU3RhdGlvbjtcclxuICB9XHJcblxyXG4gIGdldERlZmF1bHRTZXJ2aWNlQXJlYUlkKCk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gdGhpcy5fZGVmYXVsdFNlcnZpY2VBcmVhSWQgfHwgdGhpcy5jb25maWcuc2VydmljZUFyZWFJZCB8fCBERUZBVUxUUy5zZXJ2aWNlQXJlYUlkO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQnVpbGQgYSBzZXJ2aWNlIGFyZWEgYDxvcHRpb24+YCBsaXN0IGZvciBgPHNlbGVjdD5gIGVsZW1lbnRzLlxyXG4gICAqL1xyXG4gIGJ1aWxkU2FPcHRpb25zKHNlbGVjdGVkSWQ/OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgaWYgKHRoaXMuX3NlcnZpY2VBcmVhcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgY29uc3QgZmFsbGJhY2sgPSBzZWxlY3RlZElkIHx8IHRoaXMuZ2V0RGVmYXVsdFNlcnZpY2VBcmVhSWQoKTtcclxuICAgICAgcmV0dXJuIGA8b3B0aW9uIHZhbHVlPVwiJHtlc2MoZmFsbGJhY2spfVwiPiR7ZXNjKHRoaXMuZ2V0RGVmYXVsdFN0YXRpb24oKSl9PC9vcHRpb24+YDtcclxuICAgIH1cclxuICAgIGNvbnN0IHNlbCA9IHNlbGVjdGVkSWQgfHwgdGhpcy5nZXREZWZhdWx0U2VydmljZUFyZWFJZCgpO1xyXG4gICAgcmV0dXJuIHRoaXMuX3NlcnZpY2VBcmVhcy5tYXAoKHNhKSA9PiB7XHJcbiAgICAgIGNvbnN0IHNlbGVjdGVkID0gc2Euc2VydmljZUFyZWFJZCA9PT0gc2VsID8gJyBzZWxlY3RlZCcgOiAnJztcclxuICAgICAgcmV0dXJuIGA8b3B0aW9uIHZhbHVlPVwiJHtlc2Moc2Euc2VydmljZUFyZWFJZCl9XCIke3NlbGVjdGVkfT4ke2VzYyhzYS5zdGF0aW9uQ29kZSl9PC9vcHRpb24+YDtcclxuICAgIH0pLmpvaW4oJycpO1xyXG4gIH1cclxuXHJcbiAgcG9wdWxhdGVTYVNlbGVjdChzZWxlY3RFbDogSFRNTFNlbGVjdEVsZW1lbnQgfCBudWxsLCBzZWxlY3RlZElkPzogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBpZiAoIXNlbGVjdEVsKSByZXR1cm47XHJcbiAgICBzZWxlY3RFbC5pbm5lckhUTUwgPSB0aGlzLmJ1aWxkU2FPcHRpb25zKHNlbGVjdGVkSWQpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gXHUyNTAwXHUyNTAwIEdlbmVyaWMgZmV0Y2ggd2l0aCBDU1JGICsgcmV0cnkgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hXaXRoQXV0aChcclxuICB1cmw6IHN0cmluZyxcclxuICBvcHRpb25zOiBSZXF1ZXN0SW5pdCA9IHt9LFxyXG4pOiBQcm9taXNlPFJlc3BvbnNlPiB7XHJcbiAgY29uc3QgY3NyZiA9IGdldENTUkZUb2tlbigpO1xyXG4gIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgICBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgIC4uLihvcHRpb25zLmhlYWRlcnMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZCksXHJcbiAgfTtcclxuICBpZiAoY3NyZikgaGVhZGVyc1snYW50aS1jc3JmdG9rZW4tYTJ6J10gPSBjc3JmO1xyXG5cclxuICByZXR1cm4gd2l0aFJldHJ5KGFzeW5jICgpID0+IHtcclxuICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh1cmwsIHtcclxuICAgICAgY3JlZGVudGlhbHM6ICdpbmNsdWRlJyxcclxuICAgICAgLi4ub3B0aW9ucyxcclxuICAgICAgaGVhZGVycyxcclxuICAgIH0pO1xyXG4gICAgaWYgKCFyLm9rKSB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyLnN0YXR1c306ICR7ci5zdGF0dXNUZXh0fWApO1xyXG4gICAgcmV0dXJuIHI7XHJcbiAgfSwgeyByZXRyaWVzOiAyLCBiYXNlTXM6IDgwMCB9KTtcclxufVxyXG4iLCAiLy8gdWkvc3R5bGVzLnRzIFx1MjAxMyBBbGwgQ1NTIGRlZmluaXRpb25zLCBpbmplY3RlZCB2aWEgR01fYWRkU3R5bGVcclxuXHJcbi8qKiBCYXNlIHN0eWxlczogdmFyaWFibGVzLCBsYXlvdXQgcHJpbWl0aXZlcywgYnV0dG9ucywgdGFibGVzLCB0b2dnbGVzICovXHJcbmV4cG9ydCBjb25zdCBDU1NfQkFTRSA9IGBcclxuICAvKiBcdTI1MDBcdTI1MDAgUm9vdCBWYXJpYWJsZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXHJcbiAgOnJvb3Qge1xyXG4gICAgLS1jdC1wcmltYXJ5OiAjMjMyZjNlO1xyXG4gICAgLS1jdC1hY2NlbnQ6ICNmZjk5MDA7XHJcbiAgICAtLWN0LWFjY2VudC1ob3ZlcjogI2U4OGIwMDtcclxuICAgIC0tY3QtdGV4dC1saWdodDogI2ZmZmZmZjtcclxuICAgIC0tY3QtYmc6ICNmZmZmZmY7XHJcbiAgICAtLWN0LWJvcmRlcjogI2RkZDtcclxuICAgIC0tY3Qtc3VjY2VzczogIzBhN2QzZTtcclxuICAgIC0tY3Qtd2FybmluZzogI2U2N2UwMDtcclxuICAgIC0tY3QtZGFuZ2VyOiAjY2MwMDAwO1xyXG4gICAgLS1jdC1pbmZvOiAjMDA3MTg1O1xyXG4gICAgLS1jdC1tdXRlZDogIzZlNzc3ZjtcclxuICAgIC0tY3QtcmFkaXVzOiA0cHg7XHJcbiAgICAtLWN0LXJhZGl1cy1sZzogMTBweDtcclxuICAgIC0tY3Qtc2hhZG93OiAwIDRweCAyMHB4IHJnYmEoMCwwLDAsMC4xNSk7XHJcbiAgICAtLWN0LXNoYWRvdy1oZWF2eTogMCA0cHggMzBweCByZ2JhKDAsMCwwLDAuNCk7XHJcbiAgICAtLWN0LWZvbnQ6ICdBbWF6b24gRW1iZXInLCBBcmlhbCwgc2Fucy1zZXJpZjtcclxuICB9XHJcblxyXG4gIC8qIFx1MjUwMFx1MjUwMCBOYXZiYXIgRGl2aWRlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cclxuICAuY3QtZGl2aWRlciB7XHJcbiAgICBib3JkZXItdG9wOiAxcHggc29saWQgdmFyKC0tY3QtYm9yZGVyKTtcclxuICAgIG1hcmdpbjogNHB4IDA7XHJcbiAgICBwYWRkaW5nOiAwICFpbXBvcnRhbnQ7XHJcbiAgICBsaXN0LXN0eWxlOiBub25lO1xyXG4gIH1cclxuXHJcbiAgLyogXHUyNTAwXHUyNTAwIE92ZXJsYXlzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC1vdmVybGF5IHtcclxuICAgIHBvc2l0aW9uOiBmaXhlZDsgdG9wOiAwOyBsZWZ0OiAwOyB3aWR0aDogMTAwJTsgaGVpZ2h0OiAxMDAlO1xyXG4gICAgYmFja2dyb3VuZDogcmdiYSgwLDAsMCwwLjYpOyB6LWluZGV4OiAxMDAwMDA7IGRpc3BsYXk6IG5vbmU7XHJcbiAgICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgYWxpZ24taXRlbXM6IGZsZXgtc3RhcnQ7IHBhZGRpbmctdG9wOiA0MHB4O1xyXG4gIH1cclxuICAuY3Qtb3ZlcmxheS52aXNpYmxlIHsgZGlzcGxheTogZmxleDsgfVxyXG5cclxuICAvKiBcdTI1MDBcdTI1MDAgUGFuZWxzIC8gRGlhbG9ncyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cclxuICAuY3QtcGFuZWwge1xyXG4gICAgYmFja2dyb3VuZDogdmFyKC0tY3QtYmcpOyBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMtbGcpO1xyXG4gICAgcGFkZGluZzogMjRweDsgbWF4LXdpZHRoOiA5NXZ3OyBtYXgtaGVpZ2h0OiA5MHZoOyBvdmVyZmxvdzogYXV0bztcclxuICAgIGJveC1zaGFkb3c6IHZhcigtLWN0LXNoYWRvdy1oZWF2eSk7IG1pbi13aWR0aDogNjAwcHg7XHJcbiAgICBmb250LWZhbWlseTogdmFyKC0tY3QtZm9udCk7XHJcbiAgfVxyXG4gIC5jdC1wYW5lbCBoMiB7IG1hcmdpbjogMCAwIDE2cHg7IGNvbG9yOiB2YXIoLS1jdC1wcmltYXJ5KTsgfVxyXG5cclxuICAuY3QtZGlhbG9nIHtcclxuICAgIGJhY2tncm91bmQ6IHZhcigtLWN0LWJnKTsgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzLWxnKTtcclxuICAgIHBhZGRpbmc6IDI1cHg7IG1heC13aWR0aDogOTV2dzsgYm94LXNoYWRvdzogdmFyKC0tY3Qtc2hhZG93LWhlYXZ5KTtcclxuICAgIG1pbi13aWR0aDogMzgwcHg7IGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTtcclxuICB9XHJcbiAgLmN0LWRpYWxvZyBoMyB7IG1hcmdpbi10b3A6IDA7IGNvbG9yOiB2YXIoLS1jdC1pbmZvKTsgfVxyXG5cclxuICAvKiBcdTI1MDBcdTI1MDAgQ29udHJvbHMgUm93IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC1jb250cm9scyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4OyBnYXA6IDEwcHg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgICBmbGV4LXdyYXA6IHdyYXA7IG1hcmdpbi1ib3R0b206IDE2cHg7XHJcbiAgfVxyXG5cclxuICAvKiBcdTI1MDBcdTI1MDAgSW5wdXRzIC8gU2VsZWN0cyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cclxuICAuY3QtaW5wdXQsIC5jdC1zZWxlY3Qge1xyXG4gICAgcGFkZGluZzogOHB4IDEycHg7IGJvcmRlci1yYWRpdXM6IDVweDsgYm9yZGVyOiAxcHggc29saWQgI2NjYztcclxuICAgIGZvbnQtc2l6ZTogMTNweDsgZm9udC1mYW1pbHk6IHZhcigtLWN0LWZvbnQpO1xyXG4gIH1cclxuICAuY3QtaW5wdXQ6Zm9jdXMsIC5jdC1zZWxlY3Q6Zm9jdXMge1xyXG4gICAgb3V0bGluZTogbm9uZTsgYm9yZGVyLWNvbG9yOiB2YXIoLS1jdC1hY2NlbnQpO1xyXG4gICAgYm94LXNoYWRvdzogMCAwIDAgMnB4IHJnYmEoMjU1LDE1MywwLDAuMik7XHJcbiAgfVxyXG4gIC5jdC1pbnB1dC0tZnVsbCB7IHdpZHRoOiAxMDAlOyBib3gtc2l6aW5nOiBib3JkZXItYm94OyB9XHJcblxyXG4gIC8qIFx1MjUwMFx1MjUwMCBCdXR0b25zIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC1idG4ge1xyXG4gICAgcGFkZGluZzogOHB4IDE0cHg7IGJvcmRlci1yYWRpdXM6IHZhcigtLWN0LXJhZGl1cyk7IGJvcmRlcjogbm9uZTtcclxuICAgIGZvbnQtc2l6ZTogMTNweDsgZm9udC13ZWlnaHQ6IGJvbGQ7IGN1cnNvcjogcG9pbnRlcjtcclxuICAgIGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTsgdHJhbnNpdGlvbjogYmFja2dyb3VuZCAwLjE1cztcclxuICB9XHJcbiAgLmN0LWJ0bi0tcHJpbWFyeSB7IGJhY2tncm91bmQ6IHZhcigtLWN0LXByaW1hcnkpOyBjb2xvcjogdmFyKC0tY3QtdGV4dC1saWdodCk7IH1cclxuICAuY3QtYnRuLS1wcmltYXJ5OmhvdmVyIHsgYmFja2dyb3VuZDogIzM3NDc1YTsgfVxyXG4gIC5jdC1idG4tLWFjY2VudCB7IGJhY2tncm91bmQ6IHZhcigtLWN0LWFjY2VudCk7IGNvbG9yOiB2YXIoLS1jdC1wcmltYXJ5KTsgfVxyXG4gIC5jdC1idG4tLWFjY2VudDpob3ZlciB7IGJhY2tncm91bmQ6IHZhcigtLWN0LWFjY2VudC1ob3Zlcik7IH1cclxuICAuY3QtYnRuLS1kYW5nZXIgeyBiYWNrZ3JvdW5kOiB2YXIoLS1jdC1kYW5nZXIpOyBjb2xvcjogdmFyKC0tY3QtdGV4dC1saWdodCk7IH1cclxuICAuY3QtYnRuLS1kYW5nZXI6aG92ZXIgeyBiYWNrZ3JvdW5kOiAjYTAwOyB9XHJcbiAgLmN0LWJ0bi0tc3VjY2VzcyB7IGJhY2tncm91bmQ6IHZhcigtLWN0LXN1Y2Nlc3MpOyBjb2xvcjogdmFyKC0tY3QtdGV4dC1saWdodCk7IH1cclxuICAuY3QtYnRuLS1zdWNjZXNzOmhvdmVyIHsgYmFja2dyb3VuZDogIzA4NmIzMzsgfVxyXG4gIC5jdC1idG4tLWNsb3NlIHsgYmFja2dyb3VuZDogdmFyKC0tY3QtZGFuZ2VyKTsgY29sb3I6IHZhcigtLWN0LXRleHQtbGlnaHQpOyBtYXJnaW4tbGVmdDogYXV0bzsgfVxyXG4gIC5jdC1idG4tLWNsb3NlOmhvdmVyIHsgYmFja2dyb3VuZDogI2EwMDsgfVxyXG4gIC5jdC1idG4tLXNlY29uZGFyeSB7IGJhY2tncm91bmQ6ICM2Yzc1N2Q7IGNvbG9yOiB2YXIoLS1jdC10ZXh0LWxpZ2h0KTsgfVxyXG4gIC5jdC1idG4tLXNlY29uZGFyeTpob3ZlciB7IGJhY2tncm91bmQ6ICM1YTYyNjg7IH1cclxuICAuY3QtYnRuLS1pbmZvIHsgYmFja2dyb3VuZDogdmFyKC0tY3QtaW5mbyk7IGNvbG9yOiB2YXIoLS1jdC10ZXh0LWxpZ2h0KTsgfVxyXG4gIC5jdC1idG4tLWluZm86aG92ZXIgeyBiYWNrZ3JvdW5kOiAjMDA1ZjZiOyB9XHJcblxyXG4gIC8qIFx1MjUwMFx1MjUwMCBUYWJsZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXHJcbiAgLmN0LXRhYmxlIHtcclxuICAgIHdpZHRoOiAxMDAlOyBib3JkZXItY29sbGFwc2U6IGNvbGxhcHNlOyBmb250LXNpemU6IDEycHg7XHJcbiAgICBmb250LWZhbWlseTogdmFyKC0tY3QtZm9udCk7XHJcbiAgfVxyXG4gIC5jdC10YWJsZSB0aCwgLmN0LXRhYmxlIHRkIHtcclxuICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWN0LWJvcmRlcik7IHBhZGRpbmc6IDZweCA4cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7IHdoaXRlLXNwYWNlOiBub3dyYXA7XHJcbiAgfVxyXG4gIC5jdC10YWJsZSB0aCB7XHJcbiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jdC1wcmltYXJ5KTsgY29sb3I6IHZhcigtLWN0LWFjY2VudCk7XHJcbiAgICBwb3NpdGlvbjogc3RpY2t5OyB0b3A6IDA7IHotaW5kZXg6IDE7XHJcbiAgfVxyXG4gIC5jdC10YWJsZSB0cjpudGgtY2hpbGQoZXZlbikgeyBiYWNrZ3JvdW5kOiAjZjlmOWY5OyB9XHJcbiAgLmN0LXRhYmxlIHRyOmhvdmVyIHsgYmFja2dyb3VuZDogI2ZmZjNkNjsgfVxyXG5cclxuICAvKiBcdTI1MDBcdTI1MDAgU3RhdHVzIENsYXNzZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXHJcbiAgLmN0LW9rIHsgY29sb3I6IHZhcigtLWN0LXN1Y2Nlc3MpOyBmb250LXdlaWdodDogYm9sZDsgfVxyXG4gIC5jdC13YXJuIHsgY29sb3I6IHZhcigtLWN0LXdhcm5pbmcpOyBmb250LXdlaWdodDogYm9sZDsgfVxyXG4gIC5jdC1kYW5nZXIgeyBjb2xvcjogdmFyKC0tY3QtZGFuZ2VyKTsgZm9udC13ZWlnaHQ6IGJvbGQ7IH1cclxuICAuY3QtYnJlYWNoIHsgYmFja2dyb3VuZDogI2ZmZTBlMCAhaW1wb3J0YW50OyB9XHJcbiAgLmN0LW5vZGF0YSB7IGNvbG9yOiAjYWFhOyB9XHJcblxyXG4gIC8qIFx1MjUwMFx1MjUwMCBTdGF0dXMgQmFyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC1zdGF0dXMge1xyXG4gICAgcGFkZGluZzogOHB4OyBtYXJnaW4tYm90dG9tOiAxMHB4OyBmb250LXN0eWxlOiBpdGFsaWM7XHJcbiAgICBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpO1xyXG4gIH1cclxuXHJcbiAgLyogXHUyNTAwXHUyNTAwIFByb2dyZXNzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC1wcm9ncmVzcyB7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZjBmMGYwOyBoZWlnaHQ6IDIwcHg7IGJvcmRlci1yYWRpdXM6IDEwcHg7XHJcbiAgICBvdmVyZmxvdzogaGlkZGVuO1xyXG4gIH1cclxuICAuY3QtcHJvZ3Jlc3NfX2ZpbGwge1xyXG4gICAgYmFja2dyb3VuZDogdmFyKC0tY3QtaW5mbyk7IGhlaWdodDogMTAwJTsgd2lkdGg6IDAlO1xyXG4gICAgdHJhbnNpdGlvbjogd2lkdGggMC4zczsgYm9yZGVyLXJhZGl1czogMTBweDtcclxuICB9XHJcblxyXG4gIC8qIFx1MjUwMFx1MjUwMCBTZXR0aW5ncyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cclxuICAuY3Qtc2V0dGluZ3Mtcm93IHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICAgIHBhZGRpbmc6IDEwcHggMDsgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkICNlZWU7XHJcbiAgfVxyXG4gIC5jdC1zZXR0aW5ncy1yb3c6bGFzdC1jaGlsZCB7IGJvcmRlci1ib3R0b206IG5vbmU7IH1cclxuICAuY3Qtc2V0dGluZ3Mtcm93IGxhYmVsIHsgZm9udC1zaXplOiAxNHB4OyBjb2xvcjogIzMzMzsgfVxyXG4gIC5jdC10b2dnbGUge1xyXG4gICAgcG9zaXRpb246IHJlbGF0aXZlOyB3aWR0aDogNDRweDsgaGVpZ2h0OiAyNHB4OyBkaXNwbGF5OiBpbmxpbmUtYmxvY2s7XHJcbiAgfVxyXG4gIC5jdC10b2dnbGUgaW5wdXQgeyBvcGFjaXR5OiAwOyB3aWR0aDogMDsgaGVpZ2h0OiAwOyB9XHJcbiAgLmN0LXRvZ2dsZSAuY3Qtc2xpZGVyIHtcclxuICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTsgY3Vyc29yOiBwb2ludGVyOyBpbnNldDogMDtcclxuICAgIGJhY2tncm91bmQ6ICNjY2M7IGJvcmRlci1yYWRpdXM6IDI0cHg7IHRyYW5zaXRpb246IDAuM3M7XHJcbiAgfVxyXG4gIC5jdC10b2dnbGUgLmN0LXNsaWRlcjo6YmVmb3JlIHtcclxuICAgIGNvbnRlbnQ6ICcnOyBwb3NpdGlvbjogYWJzb2x1dGU7IGhlaWdodDogMThweDsgd2lkdGg6IDE4cHg7XHJcbiAgICBsZWZ0OiAzcHg7IGJvdHRvbTogM3B4OyBiYWNrZ3JvdW5kOiB3aGl0ZTsgYm9yZGVyLXJhZGl1czogNTAlO1xyXG4gICAgdHJhbnNpdGlvbjogMC4zcztcclxuICB9XHJcbiAgLmN0LXRvZ2dsZSBpbnB1dDpjaGVja2VkICsgLmN0LXNsaWRlciB7IGJhY2tncm91bmQ6IHZhcigtLWN0LWFjY2VudCk7IH1cclxuICAuY3QtdG9nZ2xlIGlucHV0OmNoZWNrZWQgKyAuY3Qtc2xpZGVyOjpiZWZvcmUgeyB0cmFuc2Zvcm06IHRyYW5zbGF0ZVgoMjBweCk7IH1cclxuXHJcbiAgLyogXHUyNTAwXHUyNTAwIEJhdGNoIHJlc3VsdCBpdGVtcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cclxuICAuY3QtcmVzdWx0LWl0ZW0ge1xyXG4gICAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tY3QtYm9yZGVyKTsgbWFyZ2luOiA4cHggMDtcclxuICAgIHBhZGRpbmc6IDEwcHg7IGJvcmRlci1yYWRpdXM6IDVweDtcclxuICB9XHJcbiAgLmN0LXJlc3VsdC1pdGVtIGg0IHsgbWFyZ2luOiAwIDAgNHB4OyB9XHJcbiAgLmN0LXJlc3VsdC1zdWNjZXNzIHsgY29sb3I6IHZhcigtLWN0LXN1Y2Nlc3MpOyB9XHJcbiAgLmN0LXJlc3VsdC1mYWlsdXJlIHsgY29sb3I6IHZhcigtLWN0LWRhbmdlcik7IH1cclxuICAuY3Qtc3VtbWFyeS1ib3gge1xyXG4gICAgYmFja2dyb3VuZDogI2Y4ZjlmYTsgcGFkZGluZzogMTVweDsgYm9yZGVyLXJhZGl1czogNXB4O1xyXG4gICAgbWFyZ2luLWJvdHRvbTogMjBweDtcclxuICB9XHJcbiAgLmN0LWluZm8tYm94IHtcclxuICAgIGJhY2tncm91bmQ6ICNlN2YzZmY7IHBhZGRpbmc6IDEwcHg7IGJvcmRlci1yYWRpdXM6IHZhcigtLWN0LXJhZGl1cyk7XHJcbiAgICBtYXJnaW4tdG9wOiAxMHB4OyBmb250LXNpemU6IDEycHg7XHJcbiAgfVxyXG4gIC5jdC1ub3RlLWJveCB7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZjhmOWZhOyBwYWRkaW5nOiAxMHB4OyBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMpO1xyXG4gICAgbWFyZ2luOiAxNXB4IDA7IGZvbnQtc2l6ZTogMTJweDsgY29sb3I6ICM2NjY7XHJcbiAgfVxyXG5cclxuICAvKiBcdTI1MDBcdTI1MDAgSGlzdG9yeSB0YWJsZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cclxuICAuY3QtaGlzdG9yeS10YWJsZSB7IHdpZHRoOiAxMDAlOyBib3JkZXItY29sbGFwc2U6IGNvbGxhcHNlOyB9XHJcbiAgLmN0LWhpc3RvcnktdGFibGUgdGgsIC5jdC1oaXN0b3J5LXRhYmxlIHRkIHtcclxuICAgIGJvcmRlcjogMXB4IHNvbGlkICNkZGQ7IHBhZGRpbmc6IDhweDsgdGV4dC1hbGlnbjogbGVmdDsgZm9udC1zaXplOiAxM3B4O1xyXG4gIH1cclxuICAuY3QtaGlzdG9yeS10YWJsZSB0aCB7IGJhY2tncm91bmQ6IHZhcigtLWN0LWluZm8pOyBjb2xvcjogd2hpdGU7IH1cclxuICAuY3QtaGlzdG9yeS1zdWNjZXNzIHsgY29sb3I6IHZhcigtLWN0LXN1Y2Nlc3MpOyB9XHJcbiAgLmN0LWhpc3RvcnktcGFydGlhbCB7IGNvbG9yOiB2YXIoLS1jdC13YXJuaW5nKTsgfVxyXG4gIC5jdC1oaXN0b3J5LWZhaWx1cmUgeyBjb2xvcjogdmFyKC0tY3QtZGFuZ2VyKTsgfVxyXG5cclxuICAvKiBcdTI1MDBcdTI1MDAgUmVzcG9uc2l2ZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cclxuICBAbWVkaWEgKG1heC13aWR0aDogNzY4cHgpIHtcclxuICAgIC5jdC1wYW5lbCwgLmN0LWRpYWxvZyB7IG1pbi13aWR0aDogdW5zZXQ7IHdpZHRoOiA5NXZ3OyB9XHJcbiAgfVxyXG5gO1xyXG5cclxuLyoqIERlbGl2ZXJ5IFBlcmZvcm1hbmNlIERhc2hib2FyZCBDU1MgKi9cclxuZXhwb3J0IGNvbnN0IENTU19ERUxJVkVSWV9QRVJGID0gYFxyXG4gIC8qIFx1MjUwMFx1MjUwMCBEZWxpdmVyeSBQZXJmb3JtYW5jZSBEYXNoYm9hcmQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXHJcbiAgLmN0LWRwLXBhbmVsIHtcclxuICAgIGJhY2tncm91bmQ6IHZhcigtLWN0LWJnKTsgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzLWxnKTtcclxuICAgIHBhZGRpbmc6IDI0cHg7IG1heC13aWR0aDogMTIwMHB4OyB3aWR0aDogOTV2dzsgbWF4LWhlaWdodDogOTJ2aDtcclxuICAgIG92ZXJmbG93LXk6IGF1dG87IGJveC1zaGFkb3c6IHZhcigtLWN0LXNoYWRvdy1oZWF2eSk7XHJcbiAgICBmb250LWZhbWlseTogdmFyKC0tY3QtZm9udCk7XHJcbiAgfVxyXG4gIC5jdC1kcC1wYW5lbCBoMiB7IG1hcmdpbjogMCAwIDE2cHg7IGNvbG9yOiB2YXIoLS1jdC1wcmltYXJ5KTsgfVxyXG5cclxuICAuY3QtZHAtYmFkZ2VzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGZsZXgtd3JhcDogd3JhcDsgZ2FwOiA2cHg7IG1hcmdpbi1ib3R0b206IDE2cHg7XHJcbiAgfVxyXG4gIC5jdC1kcC1iYWRnZSB7XHJcbiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jdC1wcmltYXJ5KTsgY29sb3I6IHZhcigtLWN0LWFjY2VudCk7XHJcbiAgICBib3JkZXItcmFkaXVzOiAxMnB4OyBwYWRkaW5nOiAzcHggMTBweDsgZm9udC1zaXplOiAxMXB4O1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7IHdoaXRlLXNwYWNlOiBub3dyYXA7XHJcbiAgfVxyXG4gIC5jdC1kcC1iYWRnZSBzcGFuIHsgY29sb3I6IHZhcigtLWN0LXRleHQtbGlnaHQpOyBmb250LXdlaWdodDogbm9ybWFsOyBtYXJnaW4tbGVmdDogNHB4OyB9XHJcblxyXG4gIC5jdC1kcC1yZWNvcmQge1xyXG4gICAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tY3QtYm9yZGVyKTsgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzKTtcclxuICAgIG1hcmdpbi1ib3R0b206IDIwcHg7IG92ZXJmbG93OiBoaWRkZW47XHJcbiAgfVxyXG4gIC5jdC1kcC1yZWNvcmQtaGVhZGVyIHtcclxuICAgIGJhY2tncm91bmQ6IHZhcigtLWN0LXByaW1hcnkpOyBjb2xvcjogdmFyKC0tY3QtdGV4dC1saWdodCk7XHJcbiAgICBwYWRkaW5nOiA4cHggMTRweDsgZm9udC13ZWlnaHQ6IGJvbGQ7IGZvbnQtc2l6ZTogMTNweDtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogMTBweDtcclxuICB9XHJcbiAgLmN0LWRwLXJlY29yZC1ib2R5IHtcclxuICAgIHBhZGRpbmc6IDE0cHg7IGRpc3BsYXk6IGdyaWQ7XHJcbiAgICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmciAxZnI7IGdhcDogMTRweDtcclxuICB9XHJcbiAgQG1lZGlhIChtYXgtd2lkdGg6IDkwMHB4KSB7XHJcbiAgICAuY3QtZHAtcmVjb3JkLWJvZHkgeyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDFmcjsgfVxyXG4gIH1cclxuXHJcbiAgLmN0LWRwLXNlY3Rpb24tdGl0bGUge1xyXG4gICAgZm9udC1zaXplOiAxMXB4OyB0ZXh0LXRyYW5zZm9ybTogdXBwZXJjYXNlOyBsZXR0ZXItc3BhY2luZzogMC41cHg7XHJcbiAgICBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyBtYXJnaW46IDAgMCA4cHg7IGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gIH1cclxuXHJcbiAgLmN0LWRwLWNvdW50LXRhYmxlIHtcclxuICAgIHdpZHRoOiAxMDAlOyBib3JkZXItY29sbGFwc2U6IGNvbGxhcHNlOyBmb250LXNpemU6IDEycHg7XHJcbiAgfVxyXG4gIC5jdC1kcC1jb3VudC10YWJsZSB0ZCB7XHJcbiAgICBwYWRkaW5nOiAzcHggNnB4OyBib3JkZXItYm90dG9tOiAxcHggc29saWQgI2YwZjBmMDsgdmVydGljYWwtYWxpZ246IG1pZGRsZTtcclxuICB9XHJcbiAgLmN0LWRwLWNvdW50LXRhYmxlIHRkOmZpcnN0LWNoaWxkIHsgY29sb3I6ICM1NTU7IGZvbnQtc2l6ZTogMTFweDsgd2lkdGg6IDY1JTsgfVxyXG4gIC5jdC1kcC1jb3VudC10YWJsZSB0ZDpsYXN0LWNoaWxkIHsgdGV4dC1hbGlnbjogcmlnaHQ7IGZvbnQtd2VpZ2h0OiBib2xkOyB9XHJcblxyXG4gIC5jdC1kcC1yYXRlcyB7IGRpc3BsYXk6IGZsZXg7IGZsZXgtZGlyZWN0aW9uOiBjb2x1bW47IGdhcDogNnB4OyB9XHJcbiAgLmN0LWRwLXJhdGUtcm93IHsgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiA4cHg7IH1cclxuICAuY3QtZHAtcmF0ZS1sYWJlbCB7IGZvbnQtc2l6ZTogMTFweDsgY29sb3I6ICM1NTU7IGZsZXg6IDEgMSA2MCU7IH1cclxuICAuY3QtZHAtcmF0ZS12YWx1ZSB7XHJcbiAgICBmb250LXdlaWdodDogYm9sZDsgZm9udC1zaXplOiAxMnB4OyB0ZXh0LWFsaWduOiByaWdodDtcclxuICAgIHdoaXRlLXNwYWNlOiBub3dyYXA7IG1pbi13aWR0aDogNjBweDtcclxuICB9XHJcbiAgLmN0LWRwLXJhdGUtYmFyLXdyYXAge1xyXG4gICAgZmxleDogMCAwIDYwcHg7IGhlaWdodDogNnB4OyBiYWNrZ3JvdW5kOiAjZWVlO1xyXG4gICAgYm9yZGVyLXJhZGl1czogM3B4OyBvdmVyZmxvdzogaGlkZGVuO1xyXG4gIH1cclxuICAuY3QtZHAtcmF0ZS1iYXIgeyBoZWlnaHQ6IDEwMCU7IGJvcmRlci1yYWRpdXM6IDNweDsgfVxyXG5cclxuICAuY3QtZHAtcmF0ZS0tZ3JlYXQgeyBjb2xvcjogdmFyKC0tY3Qtc3VjY2Vzcyk7IH1cclxuICAuY3QtZHAtcmF0ZS0tYmFyLS1ncmVhdCB7IGJhY2tncm91bmQ6IHZhcigtLWN0LXN1Y2Nlc3MpOyB9XHJcbiAgLmN0LWRwLXJhdGUtLW9rIHsgY29sb3I6IHZhcigtLWN0LXdhcm5pbmcpOyB9XHJcbiAgLmN0LWRwLXJhdGUtLWJhci0tb2sgeyBiYWNrZ3JvdW5kOiB2YXIoLS1jdC13YXJuaW5nKTsgfVxyXG4gIC5jdC1kcC1yYXRlLS1iYWQgeyBjb2xvcjogdmFyKC0tY3QtZGFuZ2VyKTsgfVxyXG4gIC5jdC1kcC1yYXRlLS1iYXItLWJhZCB7IGJhY2tncm91bmQ6IHZhcigtLWN0LWRhbmdlcik7IH1cclxuICAuY3QtZHAtcmF0ZS0tbmV1dHJhbCB7IGNvbG9yOiB2YXIoLS1jdC1pbmZvKTsgfVxyXG4gIC5jdC1kcC1yYXRlLS1iYXItLW5ldXRyYWwgeyBiYWNrZ3JvdW5kOiB2YXIoLS1jdC1pbmZvKTsgfVxyXG5cclxuICAuY3QtZHAtdHMtcm93IHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGdhcDogMjBweDsgZmxleC13cmFwOiB3cmFwOyBmb250LXNpemU6IDEycHg7XHJcbiAgICBwYWRkaW5nOiA4cHggMDsgYm9yZGVyLXRvcDogMXB4IHNvbGlkICNmMGYwZjA7IG1hcmdpbi10b3A6IDRweDtcclxuICB9XHJcbiAgLmN0LWRwLXRzLWl0ZW0geyBkaXNwbGF5OiBmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBnYXA6IDJweDsgfVxyXG4gIC5jdC1kcC10cy1sYWJlbCB7IGZvbnQtc2l6ZTogMTBweDsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgdGV4dC10cmFuc2Zvcm06IHVwcGVyY2FzZTsgfVxyXG4gIC5jdC1kcC10cy12YWwgeyBmb250LXdlaWdodDogYm9sZDsgfVxyXG5cclxuICAuY3QtZHAtdGlsZXMge1xyXG4gICAgZGlzcGxheTogZmxleDsgZ2FwOiAxMHB4OyBmbGV4LXdyYXA6IHdyYXA7IG1hcmdpbi1ib3R0b206IDE0cHg7XHJcbiAgfVxyXG4gIC5jdC1kcC10aWxlIHtcclxuICAgIGJhY2tncm91bmQ6ICNmN2Y4ZmE7IGJvcmRlcjogMXB4IHNvbGlkICNlMGUwZTA7XHJcbiAgICBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMpOyBwYWRkaW5nOiAxMHB4IDE2cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7IG1pbi13aWR0aDogOTBweDsgZmxleDogMSAxIDkwcHg7XHJcbiAgfVxyXG4gIC5jdC1kcC10aWxlLXZhbCB7XHJcbiAgICBmb250LXNpemU6IDIwcHg7IGZvbnQtd2VpZ2h0OiBib2xkOyBjb2xvcjogdmFyKC0tY3QtcHJpbWFyeSk7IGxpbmUtaGVpZ2h0OiAxLjI7XHJcbiAgfVxyXG4gIC5jdC1kcC10aWxlLWxibCB7IGZvbnQtc2l6ZTogMTBweDsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgbWFyZ2luLXRvcDogMnB4OyB9XHJcbiAgLmN0LWRwLXRpbGUtLXN1Y2Nlc3MgLmN0LWRwLXRpbGUtdmFsIHsgY29sb3I6IHZhcigtLWN0LXN1Y2Nlc3MpOyB9XHJcbiAgLmN0LWRwLXRpbGUtLXdhcm4gLmN0LWRwLXRpbGUtdmFsIHsgY29sb3I6IHZhcigtLWN0LXdhcm5pbmcpOyB9XHJcbiAgLmN0LWRwLXRpbGUtLWRhbmdlciAuY3QtZHAtdGlsZS12YWwgeyBjb2xvcjogdmFyKC0tY3QtZGFuZ2VyKTsgfVxyXG5cclxuICAuY3QtZHAtbG9hZGluZyB7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7IHBhZGRpbmc6IDQwcHg7IGNvbG9yOiB2YXIoLS1jdC1tdXRlZCk7IGZvbnQtc3R5bGU6IGl0YWxpYztcclxuICB9XHJcbiAgLmN0LWRwLWVycm9yIHtcclxuICAgIGJhY2tncm91bmQ6ICNmZmYwZjA7IGJvcmRlcjogMXB4IHNvbGlkICNmZmNjY2M7XHJcbiAgICBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMpOyBwYWRkaW5nOiAxNHB4O1xyXG4gICAgY29sb3I6IHZhcigtLWN0LWRhbmdlcik7IGZvbnQtc2l6ZTogMTNweDtcclxuICB9XHJcbiAgLmN0LWRwLWVtcHR5IHsgdGV4dC1hbGlnbjogY2VudGVyOyBwYWRkaW5nOiAzMHB4OyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyB9XHJcbiAgLmN0LWRwLWZ1bGwtY29sIHsgZ3JpZC1jb2x1bW46IDEgLyAtMTsgfVxyXG5gO1xyXG5cclxuLyoqIERWSUMgQ2hlY2sgQ1NTICovXHJcbmV4cG9ydCBjb25zdCBDU1NfRFZJQyA9IGBcclxuICAvKiBcdTI1MDBcdTI1MDAgRFZJQyBDaGVjayBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgKi9cclxuICAuY3QtZHZpYy1wYW5lbCB7XHJcbiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jdC1iZyk7IGJvcmRlci1yYWRpdXM6IHZhcigtLWN0LXJhZGl1cy1sZyk7XHJcbiAgICBwYWRkaW5nOiAyNHB4OyBtYXgtd2lkdGg6IDExMDBweDsgd2lkdGg6IDk1dnc7IG1heC1oZWlnaHQ6IDkydmg7XHJcbiAgICBvdmVyZmxvdy15OiBhdXRvOyBib3gtc2hhZG93OiB2YXIoLS1jdC1zaGFkb3ctaGVhdnkpO1xyXG4gICAgZm9udC1mYW1pbHk6IHZhcigtLWN0LWZvbnQpO1xyXG4gIH1cclxuICAuY3QtZHZpYy1wYW5lbCBoMiB7IG1hcmdpbjogMDsgY29sb3I6IHZhcigtLWN0LXByaW1hcnkpOyB9XHJcblxyXG4gIC5jdC1kdmljLXRhYnMge1xyXG4gICAgZGlzcGxheTogZmxleDsgZ2FwOiAwOyBtYXJnaW4tYm90dG9tOiAxNnB4O1xyXG4gICAgYm9yZGVyLWJvdHRvbTogMnB4IHNvbGlkIHZhcigtLWN0LWJvcmRlcik7XHJcbiAgfVxyXG4gIC5jdC1kdmljLXRhYiB7XHJcbiAgICBwYWRkaW5nOiA4cHggMThweDsgY3Vyc29yOiBwb2ludGVyOyBmb250LXNpemU6IDEzcHg7IGZvbnQtd2VpZ2h0OiBib2xkO1xyXG4gICAgYm9yZGVyOiBub25lOyBiYWNrZ3JvdW5kOiBub25lOyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpO1xyXG4gICAgZm9udC1mYW1pbHk6IHZhcigtLWN0LWZvbnQpOyBib3JkZXItYm90dG9tOiAzcHggc29saWQgdHJhbnNwYXJlbnQ7XHJcbiAgICBtYXJnaW4tYm90dG9tOiAtMnB4OyB0cmFuc2l0aW9uOiBjb2xvciAwLjE1cztcclxuICB9XHJcbiAgLmN0LWR2aWMtdGFiOmhvdmVyIHsgY29sb3I6IHZhcigtLWN0LXByaW1hcnkpOyB9XHJcbiAgLmN0LWR2aWMtdGFiLS1hY3RpdmUgeyBjb2xvcjogdmFyKC0tY3QtcHJpbWFyeSk7IGJvcmRlci1ib3R0b20tY29sb3I6IHZhcigtLWN0LWFjY2VudCk7IH1cclxuXHJcbiAgLmN0LWR2aWMtdGlsZXMge1xyXG4gICAgZGlzcGxheTogZmxleDsgZ2FwOiAxMnB4OyBmbGV4LXdyYXA6IHdyYXA7IG1hcmdpbi1ib3R0b206IDE2cHg7XHJcbiAgfVxyXG4gIC5jdC1kdmljLXRpbGUge1xyXG4gICAgYmFja2dyb3VuZDogI2Y3ZjhmYTsgYm9yZGVyOiAxcHggc29saWQgI2UwZTBlMDtcclxuICAgIGJvcmRlci1yYWRpdXM6IHZhcigtLWN0LXJhZGl1cyk7IHBhZGRpbmc6IDEwcHggMThweDtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjsgZmxleDogMSAxIDEwMHB4OyBtaW4td2lkdGg6IDkwcHg7XHJcbiAgfVxyXG4gIC5jdC1kdmljLXRpbGUtdmFsIHtcclxuICAgIGZvbnQtc2l6ZTogMjJweDsgZm9udC13ZWlnaHQ6IGJvbGQ7IGNvbG9yOiB2YXIoLS1jdC1wcmltYXJ5KTsgbGluZS1oZWlnaHQ6IDEuMjtcclxuICB9XHJcbiAgLmN0LWR2aWMtdGlsZS1sYmwgeyBmb250LXNpemU6IDEwcHg7IGNvbG9yOiB2YXIoLS1jdC1tdXRlZCk7IG1hcmdpbi10b3A6IDJweDsgfVxyXG4gIC5jdC1kdmljLXRpbGUtLW9rICAgLmN0LWR2aWMtdGlsZS12YWwgeyBjb2xvcjogdmFyKC0tY3Qtc3VjY2Vzcyk7IH1cclxuICAuY3QtZHZpYy10aWxlLS13YXJuIC5jdC1kdmljLXRpbGUtdmFsIHsgY29sb3I6IHZhcigtLWN0LXdhcm5pbmcpOyB9XHJcbiAgLmN0LWR2aWMtdGlsZS0tZGFuZ2VyIC5jdC1kdmljLXRpbGUtdmFsIHsgY29sb3I6IHZhcigtLWN0LWRhbmdlcik7IH1cclxuXHJcbiAgLmN0LWR2aWMtYmFkZ2UtLW9rIHtcclxuICAgIGJhY2tncm91bmQ6ICNkNGVkZGE7IGNvbG9yOiB2YXIoLS1jdC1zdWNjZXNzKTtcclxuICAgIGJvcmRlci1yYWRpdXM6IDEwcHg7IHBhZGRpbmc6IDJweCA4cHg7IGZvbnQtc2l6ZTogMTFweDsgZm9udC13ZWlnaHQ6IGJvbGQ7XHJcbiAgfVxyXG4gIC5jdC1kdmljLWJhZGdlLS1taXNzaW5nIHtcclxuICAgIGJhY2tncm91bmQ6ICNmZmUwZTA7IGNvbG9yOiB2YXIoLS1jdC1kYW5nZXIpO1xyXG4gICAgYm9yZGVyLXJhZGl1czogMTBweDsgcGFkZGluZzogMnB4IDhweDsgZm9udC1zaXplOiAxMXB4OyBmb250LXdlaWdodDogYm9sZDtcclxuICB9XHJcblxyXG4gIC5jdC1kdmljLXJvdy0tbWlzc2luZyB7IGJhY2tncm91bmQ6ICNmZmY4ZjAgIWltcG9ydGFudDsgfVxyXG4gIC5jdC1kdmljLXJvdy0tbWlzc2luZzpob3ZlciB7IGJhY2tncm91bmQ6ICNmZmYwZDYgIWltcG9ydGFudDsgfVxyXG5cclxuICAuY3QtZHZpYy1leHBhbmQtYnRuIHtcclxuICAgIGJhY2tncm91bmQ6IG5vbmU7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWN0LWJvcmRlcik7IGJvcmRlci1yYWRpdXM6IDNweDtcclxuICAgIGN1cnNvcjogcG9pbnRlcjsgZm9udC1zaXplOiAxMXB4OyBwYWRkaW5nOiAxcHggNnB4OyBjb2xvcjogdmFyKC0tY3QtaW5mbyk7XHJcbiAgICBmb250LWZhbWlseTogdmFyKC0tY3QtZm9udCk7XHJcbiAgfVxyXG4gIC5jdC1kdmljLWV4cGFuZC1idG46aG92ZXIgeyBiYWNrZ3JvdW5kOiAjZTdmM2ZmOyB9XHJcblxyXG4gIC5jdC1kdmljLWRldGFpbC1yb3cgeyBkaXNwbGF5OiBub25lOyB9XHJcbiAgLmN0LWR2aWMtZGV0YWlsLXJvdy52aXNpYmxlIHsgZGlzcGxheTogdGFibGUtcm93OyB9XHJcbiAgLmN0LWR2aWMtZGV0YWlsLWNlbGwge1xyXG4gICAgYmFja2dyb3VuZDogI2Y0ZjhmZiAhaW1wb3J0YW50OyBwYWRkaW5nOiA4cHggMTZweCAhaW1wb3J0YW50O1xyXG4gICAgZm9udC1zaXplOiAxMnB4OyB0ZXh0LWFsaWduOiBsZWZ0ICFpbXBvcnRhbnQ7XHJcbiAgfVxyXG5cclxuICAuY3QtZHZpYy1wYWdpbmF0aW9uIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogMTBweDtcclxuICAgIG1hcmdpbi10b3A6IDEycHg7IGp1c3RpZnktY29udGVudDogY2VudGVyOyBmb250LXNpemU6IDEzcHg7XHJcbiAgfVxyXG4gIC5jdC1kdmljLXBhZ2UtaW5mbyB7IGNvbG9yOiB2YXIoLS1jdC1tdXRlZCk7IH1cclxuXHJcbiAgLmN0LWR2aWMtZXJyb3Ige1xyXG4gICAgYmFja2dyb3VuZDogI2ZmZjBmMDsgYm9yZGVyOiAxcHggc29saWQgI2ZmY2NjYztcclxuICAgIGJvcmRlci1yYWRpdXM6IHZhcigtLWN0LXJhZGl1cyk7IHBhZGRpbmc6IDE0cHg7XHJcbiAgICBjb2xvcjogdmFyKC0tY3QtZGFuZ2VyKTsgZm9udC1zaXplOiAxM3B4OyBsaW5lLWhlaWdodDogMS42O1xyXG4gIH1cclxuICAuY3QtZHZpYy1lbXB0eSB7IHRleHQtYWxpZ246IGNlbnRlcjsgcGFkZGluZzogMzBweDsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgfVxyXG4gIC5jdC1kdmljLWxvYWRpbmcge1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyOyBwYWRkaW5nOiA0MHB4OyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyBmb250LXN0eWxlOiBpdGFsaWM7XHJcbiAgfVxyXG5cclxuICAvKiBcdTI1MDBcdTI1MDAgVHJhbnNwb3J0ZXIgY29sdW1uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC1kdmljLXRvb2xiYXIge1xyXG4gICAgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiA4cHg7XHJcbiAgICBtYXJnaW4tYm90dG9tOiA4cHg7IGZsZXgtd3JhcDogd3JhcDtcclxuICB9XHJcbiAgLmN0LWR2aWMtdHAtdG9nZ2xlIHtcclxuICAgIGZvbnQtc2l6ZTogMTFweDsgcGFkZGluZzogM3B4IDEwcHg7XHJcbiAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1jdC1ib3JkZXIpOyBib3JkZXItcmFkaXVzOiA0cHg7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZjdmOGZhOyBjdXJzb3I6IHBvaW50ZXI7IGNvbG9yOiB2YXIoLS1jdC1wcmltYXJ5KTtcclxuICAgIGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTtcclxuICB9XHJcbiAgLmN0LWR2aWMtdHAtdG9nZ2xlOmhvdmVyIHsgYmFja2dyb3VuZDogI2U3ZjNmZjsgfVxyXG4gIC5jdC1kdmljLXRwLXRvZ2dsZVthcmlhLXByZXNzZWQ9XCJ0cnVlXCJdIHsgYmFja2dyb3VuZDogI2U3ZjNmZjsgYm9yZGVyLWNvbG9yOiB2YXIoLS1jdC1pbmZvKTsgfVxyXG5cclxuICAuY3QtZHZpYy10cC10aCB7XHJcbiAgICBtaW4td2lkdGg6IDE0MHB4OyBtYXgtd2lkdGg6IDI2MHB4O1xyXG4gIH1cclxuICAuY3QtZHZpYy10cC1jZWxsIHtcclxuICAgIGZvbnQtc2l6ZTogMTJweDsgY29sb3I6IHZhcigtLWN0LXByaW1hcnkpO1xyXG4gICAgd2hpdGUtc3BhY2U6IG5vcm1hbDsgd29yZC1icmVhazogYnJlYWstd29yZDtcclxuICAgIG1heC13aWR0aDogMjYwcHg7IG1pbi13aWR0aDogMTIwcHg7XHJcbiAgfVxyXG4gIC5jdC1kdmljLXRwLXByaW1hcnkgeyBmb250LXdlaWdodDogNTAwOyB9XHJcbiAgLmN0LWR2aWMtdHAtc2Vjb25kYXJ5IHsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgZm9udC13ZWlnaHQ6IG5vcm1hbDsgfVxyXG4gIC5jdC1kdmljLXRwLXVua25vd24geyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyBmb250LXN0eWxlOiBpdGFsaWM7IGZvbnQtc2l6ZTogMTFweDsgfVxyXG5cclxuICBAbWVkaWEgKG1heC13aWR0aDogNjgwcHgpIHtcclxuICAgIC5jdC1kdmljLXRhYmxlIHsgZGlzcGxheTogYmxvY2s7IG92ZXJmbG93LXg6IGF1dG87IH1cclxuICAgIC5jdC1kdmljLXRwLWNlbGwgeyBkaXNwbGF5OiBibG9jazsgbWF4LXdpZHRoOiAxMDAlOyB9XHJcbiAgfVxyXG5gO1xyXG5cclxuLyoqIFdvcmtpbmcgSG91cnMgRGFzaGJvYXJkIENTUyAqL1xyXG5leHBvcnQgY29uc3QgQ1NTX1dPUktJTkdfSE9VUlMgPSBgXHJcbiAgLyogXHUyNTAwXHUyNTAwIFdvcmtpbmcgSG91cnMgRGFzaGJvYXJkIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC13aGQtcGFuZWwge1xyXG4gICAgYmFja2dyb3VuZDogdmFyKC0tY3QtYmcpOyBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMtbGcpO1xyXG4gICAgcGFkZGluZzogMjRweDsgbWF4LXdpZHRoOiAxNDAwcHg7IHdpZHRoOiA5NXZ3OyBtYXgtaGVpZ2h0OiA5MnZoO1xyXG4gICAgb3ZlcmZsb3cteTogYXV0bzsgYm94LXNoYWRvdzogdmFyKC0tY3Qtc2hhZG93LWhlYXZ5KTtcclxuICAgIGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTtcclxuICB9XHJcbiAgLmN0LXdoZC1wYW5lbCBoMiB7IG1hcmdpbjogMCAwIDE2cHg7IGNvbG9yOiB2YXIoLS1jdC1wcmltYXJ5KTsgfVxyXG5cclxuICAuY3Qtd2hkLXRhYmxlLXdyYXAgeyBvdmVyZmxvdy14OiBhdXRvOyAtd2Via2l0LW92ZXJmbG93LXNjcm9sbGluZzogdG91Y2g7IH1cclxuXHJcbiAgLmN0LXdoZC10YWJsZSB0cltkYXRhLWl0aW5lcmFyeS1pZF0geyBjdXJzb3I6IHBvaW50ZXI7IH1cclxuICAuY3Qtd2hkLXRhYmxlIHRyW2RhdGEtaXRpbmVyYXJ5LWlkXTpob3ZlciB7IGJhY2tncm91bmQ6ICNmZmYzZDYgIWltcG9ydGFudDsgfVxyXG4gIC5jdC13aGQtdGFibGUgdHJbZGF0YS1pdGluZXJhcnktaWRdOmZvY3VzIHtcclxuICAgIG91dGxpbmU6IDJweCBzb2xpZCB2YXIoLS1jdC1hY2NlbnQpOyBvdXRsaW5lLW9mZnNldDogLTJweDtcclxuICB9XHJcblxyXG4gIC5jdC13aGQtdGFibGUgdGhbZGF0YS1zb3J0XSB7XHJcbiAgICBjdXJzb3I6IHBvaW50ZXI7IHVzZXItc2VsZWN0OiBub25lOyBwb3NpdGlvbjogcmVsYXRpdmU7XHJcbiAgfVxyXG4gIC5jdC13aGQtdGFibGUgdGhbZGF0YS1zb3J0XTpob3ZlciB7IGJhY2tncm91bmQ6ICMzNzQ3NWE7IH1cclxuXHJcbiAgLmN0LXdoZC10YWJsZSB0aFtkYXRhLXNvcnQ9XCJkcml2ZXJOYW1lXCJdLFxyXG4gIC5jdC13aGQtdGFibGUgdGQuY3Qtd2hkLWRyaXZlciB7XHJcbiAgICBtaW4td2lkdGg6IDE4MHB4OyB3aWR0aDogMTgwcHg7IHRleHQtYWxpZ246IGNlbnRlcjtcclxuICB9XHJcbiAgLmN0LXdoZC1zb3J0LWljb24ge1xyXG4gICAgZm9udC1zaXplOiAxMHB4OyBtYXJnaW4tbGVmdDogM3B4OyBvcGFjaXR5OiAwLjc7XHJcbiAgfVxyXG5cclxuICAuY3Qtd2hkLWVtcHR5LCAuY3Qtd2hkLWxvYWRpbmcge1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyOyBwYWRkaW5nOiA0MHB4OyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpO1xyXG4gICAgZm9udC1zdHlsZTogaXRhbGljO1xyXG4gIH1cclxuICAuY3Qtd2hkLWVycm9yIHtcclxuICAgIGJhY2tncm91bmQ6ICNmZmYwZjA7IGJvcmRlcjogMXB4IHNvbGlkICNmZmNjY2M7XHJcbiAgICBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMpOyBwYWRkaW5nOiAxNHB4O1xyXG4gICAgY29sb3I6IHZhcigtLWN0LWRhbmdlcik7IGZvbnQtc2l6ZTogMTNweDtcclxuICB9XHJcblxyXG4gIC5jdC13aGQtZGV0YWlsLXJvdyB7XHJcbiAgICBkaXNwbGF5OiBmbGV4OyBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW47IGFsaWduLWl0ZW1zOiBjZW50ZXI7XHJcbiAgICBwYWRkaW5nOiA4cHggMDsgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkICNlZWU7XHJcbiAgfVxyXG4gIC5jdC13aGQtZGV0YWlsLXJvdzpsYXN0LWNoaWxkIHsgYm9yZGVyLWJvdHRvbTogbm9uZTsgfVxyXG4gIC5jdC13aGQtZGV0YWlsLWxhYmVsIHsgZm9udC1zaXplOiAxMnB4OyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyB9XHJcbiAgLmN0LXdoZC1kZXRhaWwtdmFsdWUgeyBmb250LXdlaWdodDogYm9sZDsgZm9udC1zaXplOiAxM3B4OyB9XHJcbiAgLmN0LXdoZC1jb3B5LWJ0biB7XHJcbiAgICBwYWRkaW5nOiAzcHggOHB4OyBmb250LXNpemU6IDExcHg7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWN0LWJvcmRlcik7XHJcbiAgICBib3JkZXItcmFkaXVzOiAzcHg7IGJhY2tncm91bmQ6ICNmN2Y4ZmE7IGN1cnNvcjogcG9pbnRlcjtcclxuICAgIGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTsgY29sb3I6IHZhcigtLWN0LWluZm8pO1xyXG4gIH1cclxuICAuY3Qtd2hkLWNvcHktYnRuOmhvdmVyIHsgYmFja2dyb3VuZDogI2U3ZjNmZjsgfVxyXG5cclxuICAuY3Qtd2hkLXBhZ2luYXRpb24ge1xyXG4gICAgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiAxMHB4O1xyXG4gICAgbWFyZ2luLXRvcDogMTJweDsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7IGZvbnQtc2l6ZTogMTNweDtcclxuICB9XHJcbiAgLmN0LXdoZC1wYWdlLWluZm8geyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyB9XHJcblxyXG4gIEBtZWRpYSAobWF4LXdpZHRoOiA3NjhweCkge1xyXG4gICAgLmN0LXdoZC1wYW5lbCB7IG1pbi13aWR0aDogdW5zZXQ7IHdpZHRoOiA5NXZ3OyBwYWRkaW5nOiAxNnB4OyB9XHJcbiAgfVxyXG5gO1xyXG5cclxuLyoqIFJldHVybnMgRGFzaGJvYXJkIENTUyAqL1xyXG5leHBvcnQgY29uc3QgQ1NTX1JFVFVSTlMgPSBgXHJcbiAgLyogXHUyNTAwXHUyNTAwIFJldHVybnMgRGFzaGJvYXJkIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC1yZXQtcGFuZWwge1xyXG4gICAgYmFja2dyb3VuZDogdmFyKC0tY3QtYmcpOyBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMtbGcpO1xyXG4gICAgcGFkZGluZzogMjRweDsgbWF4LXdpZHRoOiAxNDAwcHg7IHdpZHRoOiA5NXZ3OyBtYXgtaGVpZ2h0OiA5MnZoO1xyXG4gICAgb3ZlcmZsb3cteTogYXV0bzsgYm94LXNoYWRvdzogdmFyKC0tY3Qtc2hhZG93LWhlYXZ5KTtcclxuICAgIGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTtcclxuICB9XHJcbiAgLmN0LXJldC1wYW5lbCBoMiB7IG1hcmdpbjogMCAwIDE2cHg7IGNvbG9yOiB2YXIoLS1jdC1wcmltYXJ5KTsgfVxyXG5cclxuICAuY3QtcmV0LWNvbnRyb2xzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGdhcDogMTJweDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZmxleC13cmFwOiB3cmFwO1xyXG4gICAgbWFyZ2luLWJvdHRvbTogMTZweDsgcGFkZGluZzogMTJweDsgYmFja2dyb3VuZDogI2Y3ZjhmYTtcclxuICAgIGJvcmRlci1yYWRpdXM6IHZhcigtLWN0LXJhZGl1cyk7XHJcbiAgfVxyXG4gIC5jdC1yZXQtY29udHJvbHMgbGFiZWwgeyBmb250LXNpemU6IDEzcHg7IGZvbnQtd2VpZ2h0OiA1MDA7IGNvbG9yOiAjMzMzOyB9XHJcbiAgLmN0LXJldC1jb250cm9scyAuY3QtaW5wdXQsIC5jdC1yZXQtY29udHJvbHMgLmN0LXNlbGVjdCB7XHJcbiAgICBwYWRkaW5nOiA2cHggMTBweDsgZm9udC1zaXplOiAxM3B4O1xyXG4gIH1cclxuXHJcbiAgLmN0LXJldC1maWx0ZXJzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGdhcDogMTBweDsgZmxleC13cmFwOiB3cmFwOyBtYXJnaW4tYm90dG9tOiAxMnB4O1xyXG4gIH1cclxuICAuY3QtcmV0LXNlYXJjaCB7XHJcbiAgICBmbGV4OiAxIDEgMjAwcHg7IG1pbi13aWR0aDogMTUwcHg7XHJcbiAgfVxyXG4gIC5jdC1yZXQtZmlsdGVyLWdyb3VwIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogNnB4O1xyXG4gIH1cclxuICAuY3QtcmV0LWZpbHRlci1ncm91cCBsYWJlbCB7IGZvbnQtc2l6ZTogMTJweDsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgfVxyXG5cclxuICAuY3QtcmV0LXNvcnQtYmFyIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGdhcDogMTBweDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgbWFyZ2luLWJvdHRvbTogMTJweDtcclxuICAgIGZvbnQtc2l6ZTogMTJweDtcclxuICB9XHJcbiAgLmN0LXJldC1zb3J0LWJhciBzZWxlY3QgeyBwYWRkaW5nOiA0cHggOHB4OyBmb250LXNpemU6IDEycHg7IH1cclxuXHJcbiAgLmN0LXJldC12aWV3LXRvZ2dsZSB7XHJcbiAgICBkaXNwbGF5OiBmbGV4OyBnYXA6IDRweDsgbWFyZ2luLWxlZnQ6IGF1dG87XHJcbiAgfVxyXG4gIC5jdC1yZXQtdmlldy10b2dnbGUgYnV0dG9uIHtcclxuICAgIHBhZGRpbmc6IDRweCAxMHB4OyBmb250LXNpemU6IDExcHg7IGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWN0LWJvcmRlcik7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZjdmOGZhOyBjdXJzb3I6IHBvaW50ZXI7IGJvcmRlci1yYWRpdXM6IDNweDtcclxuICAgIGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTtcclxuICB9XHJcbiAgLmN0LXJldC12aWV3LXRvZ2dsZSBidXR0b246aG92ZXIgeyBiYWNrZ3JvdW5kOiAjZTdmM2ZmOyB9XHJcbiAgLmN0LXJldC12aWV3LXRvZ2dsZSBidXR0b24uYWN0aXZlIHsgYmFja2dyb3VuZDogdmFyKC0tY3QtaW5mbyk7IGNvbG9yOiB3aGl0ZTsgYm9yZGVyLWNvbG9yOiB2YXIoLS1jdC1pbmZvKTsgfVxyXG5cclxuICAuY3QtcmV0LXRhYmxlLXdyYXAge1xyXG4gICAgb3ZlcmZsb3cteDogYXV0bzsgLXdlYmtpdC1vdmVyZmxvdy1zY3JvbGxpbmc6IHRvdWNoO1xyXG4gIH1cclxuICAuY3QtcmV0LXRhYmxlIHtcclxuICAgIHdpZHRoOiAxMDAlOyBib3JkZXItY29sbGFwc2U6IGNvbGxhcHNlOyBmb250LXNpemU6IDEycHg7XHJcbiAgICBmb250LWZhbWlseTogdmFyKC0tY3QtZm9udCk7XHJcbiAgfVxyXG4gIC5jdC1yZXQtdGFibGUgdGgsIC5jdC1yZXQtdGFibGUgdGQge1xyXG4gICAgYm9yZGVyOiAxcHggc29saWQgdmFyKC0tY3QtYm9yZGVyKTsgcGFkZGluZzogNnB4IDhweDtcclxuICAgIHRleHQtYWxpZ246IGxlZnQ7IHdoaXRlLXNwYWNlOiBub3dyYXA7XHJcbiAgfVxyXG4gIC5jdC1yZXQtdGFibGUgdGgge1xyXG4gICAgYmFja2dyb3VuZDogdmFyKC0tY3QtaW5mbyk7IGNvbG9yOiB3aGl0ZTtcclxuICAgIHBvc2l0aW9uOiBzdGlja3k7IHRvcDogMDsgei1pbmRleDogMTtcclxuICB9XHJcbiAgLmN0LXJldC10YWJsZSB0cjpudGgtY2hpbGQoZXZlbikgeyBiYWNrZ3JvdW5kOiAjZjlmOWY5OyB9XHJcbiAgLmN0LXJldC10YWJsZSB0cjpob3ZlciB7IGJhY2tncm91bmQ6ICNmZmYzZDY7IH1cclxuICAuY3QtcmV0LXRhYmxlIHRkIHsgbWF4LXdpZHRoOiAyMDBweDsgb3ZlcmZsb3c6IGhpZGRlbjsgdGV4dC1vdmVyZmxvdzogZWxsaXBzaXM7IH1cclxuXHJcbiAgLmN0LXJldC1jYXJkcyB7XHJcbiAgICBkaXNwbGF5OiBncmlkOyBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IHJlcGVhdChhdXRvLWZpbGwsIG1pbm1heCgzMjBweCwgMWZyKSk7XHJcbiAgICBnYXA6IDEycHg7XHJcbiAgfVxyXG4gIC5jdC1yZXQtY2FyZCB7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZmZmOyBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1jdC1ib3JkZXIpO1xyXG4gICAgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzKTsgcGFkZGluZzogMTRweDtcclxuICAgIHRyYW5zaXRpb246IGJveC1zaGFkb3cgMC4xNXM7XHJcbiAgfVxyXG4gIC5jdC1yZXQtY2FyZDpob3ZlciB7IGJveC1zaGFkb3c6IHZhcigtLWN0LXNoYWRvdyk7IH1cclxuICAuY3QtcmV0LWNhcmQtaGVhZGVyIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjsgYWxpZ24taXRlbXM6IGZsZXgtc3RhcnQ7XHJcbiAgICBtYXJnaW4tYm90dG9tOiAxMHB4O1xyXG4gIH1cclxuICAuY3QtcmV0LWNhcmQtaWQge1xyXG4gICAgZm9udC13ZWlnaHQ6IGJvbGQ7IGZvbnQtc2l6ZTogMTRweDsgY29sb3I6IHZhcigtLWN0LXByaW1hcnkpO1xyXG4gICAgd29yZC1icmVhazogYnJlYWstYWxsO1xyXG4gIH1cclxuICAuY3QtcmV0LWNhcmQtcmVhc29uIHtcclxuICAgIGZvbnQtc2l6ZTogMTFweDsgcGFkZGluZzogMnB4IDhweDsgYm9yZGVyLXJhZGl1czogMTBweDtcclxuICAgIGZvbnQtd2VpZ2h0OiBib2xkOyB3aGl0ZS1zcGFjZTogbm93cmFwO1xyXG4gIH1cclxuICAuY3QtcmV0LWNhcmQtcmVhc29uLS1vayB7IGJhY2tncm91bmQ6ICNkNGVkZGE7IGNvbG9yOiB2YXIoLS1jdC1zdWNjZXNzKTsgfVxyXG4gIC5jdC1yZXQtY2FyZC1yZWFzb24tLXdhcm4geyBiYWNrZ3JvdW5kOiAjZmZmM2NkOyBjb2xvcjogdmFyKC0tY3Qtd2FybmluZyk7IH1cclxuICAuY3QtcmV0LWNhcmQtcmVhc29uLS1lcnJvciB7IGJhY2tncm91bmQ6ICNmOGQ3ZGE7IGNvbG9yOiB2YXIoLS1jdC1kYW5nZXIpOyB9XHJcblxyXG4gIC5jdC1yZXQtY2FyZC1yb3cge1xyXG4gICAgZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuOyBmb250LXNpemU6IDEycHg7XHJcbiAgICBwYWRkaW5nOiA0cHggMDsgYm9yZGVyLWJvdHRvbTogMXB4IHNvbGlkICNmMGYwZjA7XHJcbiAgfVxyXG4gIC5jdC1yZXQtY2FyZC1yb3c6bGFzdC1jaGlsZCB7IGJvcmRlci1ib3R0b206IG5vbmU7IH1cclxuICAuY3QtcmV0LWNhcmQtbGFiZWwgeyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyB9XHJcbiAgLmN0LXJldC1jYXJkLXZhbHVlIHsgZm9udC13ZWlnaHQ6IDUwMDsgY29sb3I6ICMzMzM7IHRleHQtYWxpZ246IHJpZ2h0OyB9XHJcblxyXG4gIC5jdC1yZXQtY2FyZC1hZGRyZXNzIHtcclxuICAgIGZvbnQtc2l6ZTogMTJweDsgY29sb3I6ICM1NTU7IG1hcmdpbi10b3A6IDhweDsgcGFkZGluZy10b3A6IDhweDtcclxuICAgIGJvcmRlci10b3A6IDFweCBzb2xpZCAjZWVlOyBsaW5lLWhlaWdodDogMS40O1xyXG4gIH1cclxuICAuY3QtcmV0LWNhcmQtbWFwIHtcclxuICAgIGRpc3BsYXk6IGlubGluZS1ibG9jazsgbWFyZ2luLXRvcDogOHB4OyBmb250LXNpemU6IDExcHg7XHJcbiAgICBjb2xvcjogdmFyKC0tY3QtaW5mbyk7IHRleHQtZGVjb3JhdGlvbjogbm9uZTtcclxuICB9XHJcbiAgLmN0LXJldC1jYXJkLW1hcDpob3ZlciB7IHRleHQtZGVjb3JhdGlvbjogdW5kZXJsaW5lOyB9XHJcblxyXG4gIC5jdC1yZXQtcGFnaW5hdGlvbiB7XHJcbiAgICBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgZ2FwOiAxMnB4O1xyXG4gICAgbWFyZ2luLXRvcDogMjBweDsgZm9udC1zaXplOiAxM3B4O1xyXG4gIH1cclxuICAuY3QtcmV0LXBhZ2UtaW5mbyB7IGNvbG9yOiB2YXIoLS1jdC1tdXRlZCk7IH1cclxuXHJcbiAgLmN0LXJldC1sb2FkaW5nLCAuY3QtcmV0LWVtcHR5LCAuY3QtcmV0LWVycm9yIHtcclxuICAgIHRleHQtYWxpZ246IGNlbnRlcjsgcGFkZGluZzogNDBweDsgY29sb3I6IHZhcigtLWN0LW11dGVkKTtcclxuICAgIGZvbnQtc3R5bGU6IGl0YWxpYztcclxuICB9XHJcbiAgLmN0LXJldC1lcnJvciB7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZmZmMGYwOyBib3JkZXI6IDFweCBzb2xpZCAjZmZjY2NjO1xyXG4gICAgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzKTsgcGFkZGluZzogMTRweDsgY29sb3I6IHZhcigtLWN0LWRhbmdlcik7XHJcbiAgICBmb250LXN0eWxlOiBub3JtYWw7XHJcbiAgfVxyXG5cclxuICAuY3QtcmV0LXN0YXRzIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGdhcDogMTJweDsgZmxleC13cmFwOiB3cmFwOyBtYXJnaW4tYm90dG9tOiAxNnB4O1xyXG4gIH1cclxuICAuY3QtcmV0LXN0YXQge1xyXG4gICAgYmFja2dyb3VuZDogI2Y3ZjhmYTsgYm9yZGVyOiAxcHggc29saWQgI2UwZTBlMDtcclxuICAgIGJvcmRlci1yYWRpdXM6IHZhcigtLWN0LXJhZGl1cyk7IHBhZGRpbmc6IDhweCAxNHB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyOyBmbGV4OiAxIDEgODBweDsgbWluLXdpZHRoOiA3MHB4O1xyXG4gIH1cclxuICAuY3QtcmV0LXN0YXQtdmFsIHsgZm9udC1zaXplOiAxOHB4OyBmb250LXdlaWdodDogYm9sZDsgY29sb3I6IHZhcigtLWN0LXByaW1hcnkpOyB9XHJcbiAgLmN0LXJldC1zdGF0LWxibCB7IGZvbnQtc2l6ZTogMTBweDsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgbWFyZ2luLXRvcDogMnB4OyB9XHJcbmA7XHJcblxyXG4vKiogU2NvcmVjYXJkIERhc2hib2FyZCBDU1MgKi9cclxuZXhwb3J0IGNvbnN0IENTU19TQ09SRUNBUkQgPSBgXHJcbiAgLyogXHUyNTAwXHUyNTAwIFNjb3JlY2FyZCBEYXNoYm9hcmQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwICovXHJcbiAgLmN0LXNjLXBhbmVsIHtcclxuICAgIGJhY2tncm91bmQ6IHZhcigtLWN0LWJnKTsgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzLWxnKTtcclxuICAgIHBhZGRpbmc6IDI0cHg7IG1heC13aWR0aDogMTQwMHB4OyB3aWR0aDogOTV2dzsgbWF4LWhlaWdodDogOTJ2aDtcclxuICAgIG92ZXJmbG93LXk6IGF1dG87IGJveC1zaGFkb3c6IHZhcigtLWN0LXNoYWRvdy1oZWF2eSk7XHJcbiAgICBmb250LWZhbWlseTogdmFyKC0tY3QtZm9udCk7XHJcbiAgfVxyXG4gIC5jdC1zYy1wYW5lbCBoMiB7IG1hcmdpbjogMCAwIDE2cHg7IGNvbG9yOiB2YXIoLS1jdC1wcmltYXJ5KTsgfVxyXG5cclxuICAuY3Qtc2MtdGlsZXMge1xyXG4gICAgZGlzcGxheTogZmxleDsgZ2FwOiAxMnB4OyBmbGV4LXdyYXA6IHdyYXA7IG1hcmdpbi1ib3R0b206IDE2cHg7XHJcbiAgfVxyXG4gIC5jdC1zYy10aWxlIHtcclxuICAgIGJhY2tncm91bmQ6ICNmN2Y4ZmE7IGJvcmRlcjogMXB4IHNvbGlkICNlMGUwZTA7XHJcbiAgICBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMpOyBwYWRkaW5nOiAxMHB4IDE4cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7IGZsZXg6IDEgMSAxMDBweDsgbWluLXdpZHRoOiA5MHB4O1xyXG4gIH1cclxuICAuY3Qtc2MtdGlsZS12YWwge1xyXG4gICAgZm9udC1zaXplOiAyMnB4OyBmb250LXdlaWdodDogYm9sZDsgY29sb3I6IHZhcigtLWN0LXByaW1hcnkpOyBsaW5lLWhlaWdodDogMS4yO1xyXG4gIH1cclxuICAuY3Qtc2MtdGlsZS1sYmwgeyBmb250LXNpemU6IDEwcHg7IGNvbG9yOiB2YXIoLS1jdC1tdXRlZCk7IG1hcmdpbi10b3A6IDJweDsgfVxyXG4gIC5jdC1zYy10aWxlLS1mYW50YXN0aWMgLmN0LXNjLXRpbGUtdmFsIHsgY29sb3I6IHJnYig3NywgMTE1LCAxOTApOyB9XHJcbiAgLmN0LXNjLXRpbGUtLWdyZWF0IC5jdC1zYy10aWxlLXZhbCB7IGNvbG9yOiB2YXIoLS1jdC1zdWNjZXNzKTsgfVxyXG4gIC5jdC1zYy10aWxlLS1mYWlyIC5jdC1zYy10aWxlLXZhbCB7IGNvbG9yOiB2YXIoLS1jdC13YXJuaW5nKTsgfVxyXG4gIC5jdC1zYy10aWxlLS1wb29yIC5jdC1zYy10aWxlLXZhbCB7IGNvbG9yOiB2YXIoLS1jdC1kYW5nZXIpOyB9XHJcblxyXG4gIC5jdC1zYy10YWJsZS13cmFwIHsgb3ZlcmZsb3cteDogYXV0bzsgLXdlYmtpdC1vdmVyZmxvdy1zY3JvbGxpbmc6IHRvdWNoOyB9XHJcbiAgLmN0LXNjLXRhYmxlIHtcclxuICAgIHdpZHRoOiAxMDAlOyBib3JkZXItY29sbGFwc2U6IGNvbGxhcHNlOyBmb250LXNpemU6IDEycHg7XHJcbiAgICBmb250LWZhbWlseTogdmFyKC0tY3QtZm9udCk7XHJcbiAgfVxyXG4gIC5jdC1zYy10YWJsZSB0aCwgLmN0LXNjLXRhYmxlIHRkIHtcclxuICAgIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLWN0LWJvcmRlcik7IHBhZGRpbmc6IDZweCA4cHg7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7IHdoaXRlLXNwYWNlOiBub3dyYXA7XHJcbiAgfVxyXG4gIC5jdC1zYy10YWJsZSB0aCB7XHJcbiAgICBiYWNrZ3JvdW5kOiB2YXIoLS1jdC1wcmltYXJ5KTsgY29sb3I6IHZhcigtLWN0LWFjY2VudCk7XHJcbiAgICBwb3NpdGlvbjogc3RpY2t5OyB0b3A6IDA7IHotaW5kZXg6IDE7IGN1cnNvcjogcG9pbnRlcjsgdXNlci1zZWxlY3Q6IG5vbmU7XHJcbiAgfVxyXG4gIC5jdC1zYy10YWJsZSB0aDpob3ZlciB7IGJhY2tncm91bmQ6ICMzNzQ3NWE7IH1cclxuICAuY3Qtc2MtdGFibGUgdHI6bnRoLWNoaWxkKGV2ZW4pIHsgYmFja2dyb3VuZDogI2Y5ZjlmOTsgfVxyXG4gIC5jdC1zYy10YWJsZSB0cjpob3ZlciB7IGJhY2tncm91bmQ6ICNmZmYzZDY7IH1cclxuXHJcbiAgLmN0LXNjLXN0YXR1cy0tcG9vciB7IGNvbG9yOiByZ2IoMjM1LCA1MCwgMzUpOyBmb250LXdlaWdodDogYm9sZDsgfVxyXG4gIC5jdC1zYy1zdGF0dXMtLWZhaXIgeyBjb2xvcjogcmdiKDIyMywgMTMwLCA2OCk7IGZvbnQtd2VpZ2h0OiBib2xkOyB9XHJcbiAgLmN0LXNjLXN0YXR1cy0tZ3JlYXQgeyBjb2xvcjogcmdiKDEyNiwgMTcwLCA4NSk7IGZvbnQtd2VpZ2h0OiBib2xkOyB9XHJcbiAgLmN0LXNjLXN0YXR1cy0tZmFudGFzdGljIHsgY29sb3I6IHJnYig3NywgMTE1LCAxOTApOyBmb250LXdlaWdodDogYm9sZDsgfVxyXG5cclxuICAuY3Qtc2MtY29sb3ItLXBvb3IgeyBjb2xvcjogcmdiKDIzNSwgNTAsIDM1KTsgfVxyXG4gIC5jdC1zYy1jb2xvci0tZmFpciB7IGNvbG9yOiByZ2IoMjIzLCAxMzAsIDY4KTsgfVxyXG4gIC5jdC1zYy1jb2xvci0tZ3JlYXQgeyBjb2xvcjogcmdiKDEyNiwgMTcwLCA4NSk7IH1cclxuICAuY3Qtc2MtY29sb3ItLWZhbnRhc3RpYyB7IGNvbG9yOiByZ2IoNzcsIDExNSwgMTkwKTsgfVxyXG5cclxuICAuY3Qtc2MtbG9hZGluZywgLmN0LXNjLWVtcHR5LCAuY3Qtc2MtZXJyb3Ige1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyOyBwYWRkaW5nOiA0MHB4OyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyBmb250LXN0eWxlOiBpdGFsaWM7XHJcbiAgfVxyXG4gIC5jdC1zYy1lcnJvciB7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZmZmMGYwOyBib3JkZXI6IDFweCBzb2xpZCAjZmZjY2NjO1xyXG4gICAgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzKTsgcGFkZGluZzogMTRweDsgY29sb3I6IHZhcigtLWN0LWRhbmdlcik7XHJcbiAgICBmb250LXN0eWxlOiBub3JtYWw7XHJcbiAgfVxyXG5cclxuICAuY3Qtc2MtcGFnaW5hdGlvbiB7XHJcbiAgICBkaXNwbGF5OiBmbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjsgZ2FwOiAxMnB4O1xyXG4gICAgbWFyZ2luLXRvcDogMTJweDsgZm9udC1zaXplOiAxM3B4O1xyXG4gIH1cclxuICAuY3Qtc2MtcGFnZS1pbmZvIHsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgfVxyXG5cclxuICAuY3Qtc2Mtd2Vlay1zZWxlY3RvciB7XHJcbiAgICBkaXNwbGF5OiBmbGV4OyBnYXA6IDhweDsgYWxpZ24taXRlbXM6IGNlbnRlcjtcclxuICB9XHJcbmA7XHJcblxyXG4vKiogVlNBIFFSIENvZGUgR2VuZXJhdG9yIENTUyAqL1xyXG5leHBvcnQgY29uc3QgQ1NTX1ZTQV9RUiA9IGBcclxuICAvKiBcdTI1MDBcdTI1MDAgVlNBIFFSIENvZGUgR2VuZXJhdG9yIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCAqL1xyXG4gIC5jdC12c2EtcGFuZWwge1xyXG4gICAgYmFja2dyb3VuZDogdmFyKC0tY3QtYmcpOyBib3JkZXItcmFkaXVzOiB2YXIoLS1jdC1yYWRpdXMtbGcpO1xyXG4gICAgcGFkZGluZzogMjRweDsgbWF4LXdpZHRoOiAxMjAwcHg7IHdpZHRoOiA5NXZ3OyBtYXgtaGVpZ2h0OiA5MnZoO1xyXG4gICAgb3ZlcmZsb3cteTogYXV0bzsgYm94LXNoYWRvdzogdmFyKC0tY3Qtc2hhZG93LWhlYXZ5KTtcclxuICAgIGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTtcclxuICB9XHJcbiAgLmN0LXZzYS1wYW5lbCBoMiB7IG1hcmdpbjogMDsgY29sb3I6IHZhcigtLWN0LXByaW1hcnkpOyB9XHJcblxyXG4gIC5jdC12c2EtaGVhZGVyIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGp1c3RpZnktY29udGVudDogc3BhY2UtYmV0d2VlbjtcclxuICAgIG1hcmdpbi1ib3R0b206IDE2cHg7XHJcbiAgfVxyXG5cclxuICAuY3QtdnNhLXRvb2xiYXIge1xyXG4gICAgZGlzcGxheTogZmxleDsgZ2FwOiAxMnB4OyBhbGlnbi1pdGVtczogY2VudGVyOyBmbGV4LXdyYXA6IHdyYXA7XHJcbiAgICBtYXJnaW4tYm90dG9tOiAxMnB4O1xyXG4gIH1cclxuICAuY3QtdnNhLXNlYXJjaCB7XHJcbiAgICBmbGV4OiAxIDEgMjUwcHg7IG1pbi13aWR0aDogMjAwcHg7IHBhZGRpbmc6IDhweCAxMnB4O1xyXG4gICAgYm9yZGVyLXJhZGl1czogNXB4OyBib3JkZXI6IDFweCBzb2xpZCAjY2NjOyBmb250LXNpemU6IDEzcHg7XHJcbiAgICBmb250LWZhbWlseTogdmFyKC0tY3QtZm9udCk7XHJcbiAgfVxyXG4gIC5jdC12c2Etc2VhcmNoOmZvY3VzIHtcclxuICAgIG91dGxpbmU6IG5vbmU7IGJvcmRlci1jb2xvcjogdmFyKC0tY3QtYWNjZW50KTtcclxuICAgIGJveC1zaGFkb3c6IDAgMCAwIDJweCByZ2JhKDI1NSwxNTMsMCwwLjIpO1xyXG4gIH1cclxuICAuY3QtdnNhLXNlbGVjdGlvbi1pbmZvIHtcclxuICAgIGZvbnQtc2l6ZTogMTJweDsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgd2hpdGUtc3BhY2U6IG5vd3JhcDtcclxuICB9XHJcblxyXG4gIC5jdC12c2EtdGlsZXMge1xyXG4gICAgZGlzcGxheTogZmxleDsgZ2FwOiAxMnB4OyBmbGV4LXdyYXA6IHdyYXA7IG1hcmdpbi1ib3R0b206IDE2cHg7XHJcbiAgfVxyXG4gIC5jdC12c2EtdGlsZSB7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZjdmOGZhOyBib3JkZXI6IDFweCBzb2xpZCAjZTBlMGUwO1xyXG4gICAgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzKTsgcGFkZGluZzogMTBweCAxOHB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyOyBmbGV4OiAxIDEgMTAwcHg7IG1pbi13aWR0aDogOTBweDtcclxuICB9XHJcbiAgLmN0LXZzYS10aWxlLXZhbCB7XHJcbiAgICBmb250LXNpemU6IDIycHg7IGZvbnQtd2VpZ2h0OiBib2xkOyBjb2xvcjogdmFyKC0tY3QtcHJpbWFyeSk7IGxpbmUtaGVpZ2h0OiAxLjI7XHJcbiAgfVxyXG4gIC5jdC12c2EtdGlsZS1sYmwgeyBmb250LXNpemU6IDEwcHg7IGNvbG9yOiB2YXIoLS1jdC1tdXRlZCk7IG1hcmdpbi10b3A6IDJweDsgfVxyXG4gIC5jdC12c2EtdGlsZS0tYWNjZW50IC5jdC12c2EtdGlsZS12YWwgeyBjb2xvcjogdmFyKC0tY3QtYWNjZW50KTsgfVxyXG5cclxuICAuY3QtdnNhLXRhYmxlLXdyYXAge1xyXG4gICAgb3ZlcmZsb3cteDogYXV0bzsgLXdlYmtpdC1vdmVyZmxvdy1zY3JvbGxpbmc6IHRvdWNoO1xyXG4gICAgbWF4LWhlaWdodDogNTB2aDsgb3ZlcmZsb3cteTogYXV0bztcclxuICB9XHJcblxyXG4gIC5jdC12c2EtdGFibGUge1xyXG4gICAgd2lkdGg6IDEwMCU7IGJvcmRlci1jb2xsYXBzZTogY29sbGFwc2U7IGZvbnQtc2l6ZTogMTJweDtcclxuICAgIGZvbnQtZmFtaWx5OiB2YXIoLS1jdC1mb250KTtcclxuICB9XHJcbiAgLmN0LXZzYS10YWJsZSB0aCwgLmN0LXZzYS10YWJsZSB0ZCB7XHJcbiAgICBib3JkZXI6IDFweCBzb2xpZCB2YXIoLS1jdC1ib3JkZXIpOyBwYWRkaW5nOiA2cHggOHB4O1xyXG4gICAgdGV4dC1hbGlnbjogY2VudGVyOyB3aGl0ZS1zcGFjZTogbm93cmFwO1xyXG4gIH1cclxuICAuY3QtdnNhLXRhYmxlIHRoIHtcclxuICAgIGJhY2tncm91bmQ6IHZhcigtLWN0LXByaW1hcnkpOyBjb2xvcjogdmFyKC0tY3QtYWNjZW50KTtcclxuICAgIHBvc2l0aW9uOiBzdGlja3k7IHRvcDogMDsgei1pbmRleDogMTtcclxuICB9XHJcbiAgLmN0LXZzYS10YWJsZSB0cjpudGgtY2hpbGQoZXZlbikgeyBiYWNrZ3JvdW5kOiAjZjlmOWY5OyB9XHJcbiAgLmN0LXZzYS10YWJsZSB0cjpob3ZlciB7IGJhY2tncm91bmQ6ICNmZmYzZDY7IH1cclxuICAuY3QtdnNhLXRoLWNoZWNrLCAuY3QtdnNhLXRkLWNoZWNrIHsgd2lkdGg6IDM2cHg7IHRleHQtYWxpZ246IGNlbnRlcjsgfVxyXG4gIC5jdC12c2EtdGQtdmluIHsgZm9udC1mYW1pbHk6IG1vbm9zcGFjZTsgZm9udC1zaXplOiAxMXB4OyBsZXR0ZXItc3BhY2luZzogMC41cHg7IH1cclxuXHJcbiAgLmN0LXZzYS1yb3ctLXNlbGVjdGVkIHsgYmFja2dyb3VuZDogI2ZmZjhlMSAhaW1wb3J0YW50OyB9XHJcbiAgLmN0LXZzYS1yb3ctLXNlbGVjdGVkOmhvdmVyIHsgYmFja2dyb3VuZDogI2ZmZjNjZCAhaW1wb3J0YW50OyB9XHJcblxyXG4gIC5jdC12c2Etc3RhdHVzLS1hY3RpdmUgeyBjb2xvcjogdmFyKC0tY3Qtc3VjY2Vzcyk7IGZvbnQtd2VpZ2h0OiBib2xkOyBmb250LXNpemU6IDExcHg7IH1cclxuICAuY3QtdnNhLXN0YXR1cy0tbWFpbnRlbmFuY2UgeyBjb2xvcjogdmFyKC0tY3Qtd2FybmluZyk7IGZvbnQtd2VpZ2h0OiBib2xkOyBmb250LXNpemU6IDExcHg7IH1cclxuICAuY3QtdnNhLXN0YXR1cy0tcGVuZGluZyB7IGNvbG9yOiB2YXIoLS1jdC1pbmZvKTsgZm9udC13ZWlnaHQ6IGJvbGQ7IGZvbnQtc2l6ZTogMTFweDsgfVxyXG5cclxuICAuY3QtdnNhLXBhZ2luYXRpb24ge1xyXG4gICAgZGlzcGxheTogZmxleDsgYWxpZ24taXRlbXM6IGNlbnRlcjsgZ2FwOiAxMHB4O1xyXG4gICAgbWFyZ2luLXRvcDogMTJweDsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7IGZvbnQtc2l6ZTogMTNweDtcclxuICB9XHJcbiAgLmN0LXZzYS1wYWdlLWluZm8geyBjb2xvcjogdmFyKC0tY3QtbXV0ZWQpOyB9XHJcblxyXG4gIC5jdC12c2EtZm9vdGVyIHtcclxuICAgIGRpc3BsYXk6IGZsZXg7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IGdhcDogMTJweDtcclxuICAgIG1hcmdpbi10b3A6IDE2cHg7IHBhZGRpbmctdG9wOiAxNnB4O1xyXG4gICAgYm9yZGVyLXRvcDogMXB4IHNvbGlkIHZhcigtLWN0LWJvcmRlcik7XHJcbiAgfVxyXG4gIC5jdC12c2Etc2VsZWN0aW9uLWJhZGdlIHtcclxuICAgIGZvbnQtc2l6ZTogMTJweDsgY29sb3I6IHZhcigtLWN0LW11dGVkKTsgZm9udC13ZWlnaHQ6IDUwMDtcclxuICB9XHJcblxyXG4gIC5jdC12c2EtbG9hZGluZywgLmN0LXZzYS1lbXB0eSB7XHJcbiAgICB0ZXh0LWFsaWduOiBjZW50ZXI7IHBhZGRpbmc6IDQwcHg7IGNvbG9yOiB2YXIoLS1jdC1tdXRlZCk7IGZvbnQtc3R5bGU6IGl0YWxpYztcclxuICB9XHJcbiAgLmN0LXZzYS1lcnJvciB7XHJcbiAgICBiYWNrZ3JvdW5kOiAjZmZmMGYwOyBib3JkZXI6IDFweCBzb2xpZCAjZmZjY2NjO1xyXG4gICAgYm9yZGVyLXJhZGl1czogdmFyKC0tY3QtcmFkaXVzKTsgcGFkZGluZzogMTRweDtcclxuICAgIGNvbG9yOiB2YXIoLS1jdC1kYW5nZXIpOyBmb250LXNpemU6IDEzcHg7XHJcbiAgfVxyXG5cclxuICBAbWVkaWEgKG1heC13aWR0aDogNzY4cHgpIHtcclxuICAgIC5jdC12c2EtcGFuZWwgeyBtaW4td2lkdGg6IHVuc2V0OyB3aWR0aDogOTV2dzsgcGFkZGluZzogMTZweDsgfVxyXG4gICAgLmN0LXZzYS10YWJsZS13cmFwIHsgbWF4LWhlaWdodDogNDB2aDsgfVxyXG4gIH1cclxuYDtcclxuXHJcbi8qKiBJbmplY3QgYWxsIENTUyBibG9ja3MgaW50byB0aGUgcGFnZS4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGluamVjdFN0eWxlcygpOiB2b2lkIHtcclxuICBHTV9hZGRTdHlsZShDU1NfQkFTRSk7XHJcbiAgR01fYWRkU3R5bGUoQ1NTX0RFTElWRVJZX1BFUkYpO1xyXG4gIEdNX2FkZFN0eWxlKENTU19EVklDKTtcclxuICBHTV9hZGRTdHlsZShDU1NfV09SS0lOR19IT1VSUyk7XHJcbiAgR01fYWRkU3R5bGUoQ1NTX1JFVFVSTlMpO1xyXG4gIEdNX2FkZFN0eWxlKENTU19TQ09SRUNBUkQpO1xyXG4gIEdNX2FkZFN0eWxlKENTU19WU0FfUVIpO1xyXG59XHJcbiIsICIvLyBmZWF0dXJlcy93aGMtZGFzaGJvYXJkLnRzIFx1MjAxMyBXSEMgKFdvcmtpbmcgSG91cnMgQ2hlY2spIERhc2hib2FyZFxyXG5cclxuaW1wb3J0IHsgbG9nLCBlcnIsIGVzYywgdG9kYXlTdHIsIGRlbGF5LCBnZXRDU1JGVG9rZW4gfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcclxuaW1wb3J0IHsgb25EaXNwb3NlIH0gZnJvbSAnLi4vY29yZS91dGlscyc7XHJcbmltcG9ydCB7IEFQSV9VUkwsIERBWVMgfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcclxuaW1wb3J0IHR5cGUgeyBBcHBDb25maWcgfSBmcm9tICcuLi9jb3JlL3N0b3JhZ2UnO1xyXG5pbXBvcnQgdHlwZSB7IENvbXBhbnlDb25maWcgfSBmcm9tICcuLi9jb3JlL2FwaSc7XHJcblxyXG5pbnRlcmZhY2UgRGF5RW50cnkge1xyXG4gIHNjaGVkdWxlZERheTogbnVtYmVyO1xyXG4gIGFjdHVhbERheTogbnVtYmVyO1xyXG4gIHNjaGVkdWxlZFdlZWs6IG51bWJlcjtcclxuICBhY3R1YWxXZWVrOiBudW1iZXI7XHJcbiAgbGFzdDdEYXlzOiBudW1iZXI7XHJcbiAgYnJlYWNoZWQ6IGJvb2xlYW47XHJcbn1cclxuXHJcbnR5cGUgV2Vla0RhdGEgPSBSZWNvcmQ8c3RyaW5nLCBSZWNvcmQ8c3RyaW5nLCBEYXlFbnRyeT4+O1xyXG5cclxuZXhwb3J0IGNsYXNzIFdoY0Rhc2hib2FyZCB7XHJcbiAgcHJpdmF0ZSBfYWN0aXZlID0gZmFsc2U7XHJcbiAgcHJpdmF0ZSBfb3ZlcmxheUVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgX25hbWVNYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcclxuICBwcml2YXRlIF9hc3NvY2lhdGVzOiBzdHJpbmdbXSA9IFtdO1xyXG4gIHByaXZhdGUgX2xhc3RRdWVyeVJlc3VsdDogV2Vla0RhdGEgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIF9sYXN0UXVlcnlNb2RlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogQXBwQ29uZmlnLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21wYW55Q29uZmlnOiBDb21wYW55Q29uZmlnLFxyXG4gICkge31cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIExpZmVjeWNsZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgaW5pdCgpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLl9vdmVybGF5RWwpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBvdmVybGF5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBvdmVybGF5LmlkID0gJ2N0LXdoYy1vdmVybGF5JztcclxuICAgIG92ZXJsYXkuY2xhc3NOYW1lID0gJ2N0LW92ZXJsYXknO1xyXG4gICAgb3ZlcmxheS5pbm5lckhUTUwgPSBgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1wYW5lbFwiPlxyXG4gICAgICAgIDxoMj5cdUQ4M0RcdURDQ0EgREEgV0hDLURhc2hib2FyZDwvaDI+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LWNvbnRyb2xzXCI+XHJcbiAgICAgICAgICA8bGFiZWw+RGF0dW06PC9sYWJlbD5cclxuICAgICAgICAgIDxpbnB1dCB0eXBlPVwiZGF0ZVwiIGlkPVwiY3Qtd2hjLWRhdGVcIiBjbGFzcz1cImN0LWlucHV0XCIgdmFsdWU9XCIke3RvZGF5U3RyKCl9XCI+XHJcbiAgICAgICAgICA8bGFiZWwgZm9yPVwiY3Qtd2hjLXNhXCI+U2VydmljZSBBcmVhOjwvbGFiZWw+XHJcbiAgICAgICAgICA8c2VsZWN0IGlkPVwiY3Qtd2hjLXNhXCIgY2xhc3M9XCJjdC1zZWxlY3RcIiBhcmlhLWxhYmVsPVwiU2VydmljZSBBcmVhXCI+XHJcbiAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCJcIj5XaXJkIGdlbGFkZW5cdTIwMjY8L29wdGlvbj5cclxuICAgICAgICAgIDwvc2VsZWN0PlxyXG4gICAgICAgICAgPHNlbGVjdCBpZD1cImN0LXdoYy1tb2RlXCIgY2xhc3M9XCJjdC1zZWxlY3RcIj5cclxuICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cImRheVwiPkVpbnplbG5lciBUYWc8L29wdGlvbj5cclxuICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIndlZWtcIj5HYW56ZSBXb2NoZSAoTW9cdTIwMTNTbyk8L29wdGlvbj5cclxuICAgICAgICAgIDwvc2VsZWN0PlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWFjY2VudFwiIGlkPVwiY3Qtd2hjLWdvXCI+XHVEODNEXHVERDBEIEFiZnJhZ2VuPC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tcHJpbWFyeVwiIGlkPVwiY3Qtd2hjLWV4cG9ydFwiPlx1RDgzRFx1RENDQiBDU1YgRXhwb3J0PC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tY2xvc2VcIiBpZD1cImN0LXdoYy1jbG9zZVwiPlx1MjcxNSBTY2hsaWVcdTAwREZlbjwvYnV0dG9uPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgaWQ9XCJjdC13aGMtc3RhdHVzXCIgY2xhc3M9XCJjdC1zdGF0dXNcIj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGlkPVwiY3Qtd2hjLXJlc3VsdFwiPjwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgIGA7XHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG92ZXJsYXkpO1xyXG4gICAgdGhpcy5fb3ZlcmxheUVsID0gb3ZlcmxheTtcclxuXHJcbiAgICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgaWYgKGUudGFyZ2V0ID09PSBvdmVybGF5KSB0aGlzLmhpZGUoKTsgfSk7XHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hjLWNsb3NlJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5oaWRlKCkpO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoYy1nbycpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuX3J1blF1ZXJ5KCkpO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoYy1leHBvcnQnKSEuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLl9leHBvcnRDU1YoKSk7XHJcblxyXG4gICAgdGhpcy5jb21wYW55Q29uZmlnLmxvYWQoKS50aGVuKCgpID0+IHtcclxuICAgICAgdGhpcy5jb21wYW55Q29uZmlnLnBvcHVsYXRlU2FTZWxlY3QoXHJcbiAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoYy1zYScpIGFzIEhUTUxTZWxlY3RFbGVtZW50LFxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcblxyXG4gICAgb25EaXNwb3NlKCgpID0+IHRoaXMuZGlzcG9zZSgpKTtcclxuICAgIGxvZygnV0hDIERhc2hib2FyZCBpbml0aWFsaXplZCcpO1xyXG4gIH1cclxuXHJcbiAgZGlzcG9zZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuX292ZXJsYXlFbD8ucmVtb3ZlKCk7XHJcbiAgICB0aGlzLl9vdmVybGF5RWwgPSBudWxsO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gZmFsc2U7XHJcbiAgICB0aGlzLl9uYW1lTWFwID0ge307XHJcbiAgICB0aGlzLl9hc3NvY2lhdGVzID0gW107XHJcbiAgICB0aGlzLl9sYXN0UXVlcnlSZXN1bHQgPSBudWxsO1xyXG4gICAgdGhpcy5fbGFzdFF1ZXJ5TW9kZSA9IG51bGw7XHJcbiAgfVxyXG5cclxuICB0b2dnbGUoKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuY29uZmlnLmZlYXR1cmVzLndoY0Rhc2hib2FyZCkge1xyXG4gICAgICBhbGVydCgnV0hDIERhc2hib2FyZCBpc3QgZGVha3RpdmllcnQuIEJpdHRlIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGFrdGl2aWVyZW4uJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuaW5pdCgpO1xyXG4gICAgaWYgKHRoaXMuX2FjdGl2ZSkgdGhpcy5oaWRlKCk7IGVsc2UgdGhpcy5zaG93KCk7XHJcbiAgfVxyXG5cclxuICBzaG93KCk6IHZvaWQge1xyXG4gICAgdGhpcy5pbml0KCk7XHJcbiAgICB0aGlzLl9vdmVybGF5RWwhLmNsYXNzTGlzdC5hZGQoJ3Zpc2libGUnKTtcclxuICAgIHRoaXMuX2FjdGl2ZSA9IHRydWU7XHJcbiAgfVxyXG5cclxuICBoaWRlKCk6IHZvaWQge1xyXG4gICAgdGhpcy5fb3ZlcmxheUVsPy5jbGFzc0xpc3QucmVtb3ZlKCd2aXNpYmxlJyk7XHJcbiAgICB0aGlzLl9hY3RpdmUgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBIZWxwZXJzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9yZXNvbHZlTmFtZShpZDogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgIHJldHVybiB0aGlzLl9uYW1lTWFwW2lkXSB8fCBpZDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX21pbnNUb0hNKG1pbnM6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQpOiBzdHJpbmcge1xyXG4gICAgaWYgKG1pbnMgPT09IG51bGwgfHwgbWlucyA9PT0gdW5kZWZpbmVkIHx8IG1pbnMgPT09IDApIHJldHVybiAnLSc7XHJcbiAgICBjb25zdCBoID0gTWF0aC5mbG9vcihtaW5zIC8gNjApO1xyXG4gICAgY29uc3QgbSA9IG1pbnMgJSA2MDtcclxuICAgIHJldHVybiBgJHtofWggJHttLnRvU3RyaW5nKCkucGFkU3RhcnQoMiwgJzAnKX1tYDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX21pbnNDbGFzcyhtaW5zOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkKTogc3RyaW5nIHtcclxuICAgIGlmICghbWlucyB8fCBtaW5zID09PSAwKSByZXR1cm4gJ2N0LW5vZGF0YSc7XHJcbiAgICBpZiAobWlucyA+IDYwMCkgcmV0dXJuICdjdC1kYW5nZXInO1xyXG4gICAgaWYgKG1pbnMgPiA1NDApIHJldHVybiAnY3Qtd2Fybic7XHJcbiAgICByZXR1cm4gJ2N0LW9rJztcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX2dldE1vbmRheShkYXRlU3RyOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKGRhdGVTdHIgKyAnVDAwOjAwOjAwJyk7XHJcbiAgICBjb25zdCBkYXkgPSBkLmdldERheSgpO1xyXG4gICAgY29uc3QgZGlmZiA9IGQuZ2V0RGF0ZSgpIC0gZGF5ICsgKGRheSA9PT0gMCA/IC02IDogMSk7XHJcbiAgICBkLnNldERhdGUoZGlmZik7XHJcbiAgICByZXR1cm4gZC50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9hZGREYXlzKGRhdGVTdHI6IHN0cmluZywgbjogbnVtYmVyKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGQgPSBuZXcgRGF0ZShkYXRlU3RyICsgJ1QwMDowMDowMCcpO1xyXG4gICAgZC5zZXREYXRlKGQuZ2V0RGF0ZSgpICsgbik7XHJcbiAgICByZXR1cm4gZC50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF07XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgQVBJIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9nZXRTZWxlY3RlZFNhSWQoKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC13aGMtc2EnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCB8IG51bGw7XHJcbiAgICByZXR1cm4gKHNlbCAmJiBzZWwudmFsdWUpID8gc2VsLnZhbHVlIDogdGhpcy5jb21wYW55Q29uZmlnLmdldERlZmF1bHRTZXJ2aWNlQXJlYUlkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIF9mZXRjaE5hbWVzKGZyb21EYXRlOiBzdHJpbmcsIHRvRGF0ZT86IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3Qgc2FJZCA9IHRoaXMuX2dldFNlbGVjdGVkU2FJZCgpO1xyXG4gICAgY29uc3QgdXJsID1cclxuICAgICAgYGh0dHBzOi8vbG9naXN0aWNzLmFtYXpvbi5kZS9zY2hlZHVsaW5nL2hvbWUvYXBpL3YyL3Jvc3RlcnNgICtcclxuICAgICAgYD9mcm9tRGF0ZT0ke2Zyb21EYXRlfWAgK1xyXG4gICAgICBgJnNlcnZpY2VBcmVhSWQ9JHtzYUlkfWAgK1xyXG4gICAgICBgJnRvRGF0ZT0ke3RvRGF0ZSB8fCBmcm9tRGF0ZX1gO1xyXG5cclxuICAgIGNvbnN0IGNzcmYgPSBnZXRDU1JGVG9rZW4oKTtcclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nIH07XHJcbiAgICBpZiAoY3NyZikgaGVhZGVyc1snYW50aS1jc3JmdG9rZW4tYTJ6J10gPSBjc3JmO1xyXG5cclxuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBmZXRjaCh1cmwsIHsgbWV0aG9kOiAnR0VUJywgaGVhZGVycywgY3JlZGVudGlhbHM6ICdpbmNsdWRlJyB9KTtcclxuICAgIGlmICghcmVzcC5vaykgdGhyb3cgbmV3IEVycm9yKGBSb3N0ZXIgQVBJIEZlaGxlciAke3Jlc3Auc3RhdHVzfWApO1xyXG4gICAgY29uc3QganNvbiA9IGF3YWl0IHJlc3AuanNvbigpO1xyXG5cclxuICAgIGNvbnN0IHJvc3RlciA9IEFycmF5LmlzQXJyYXkoanNvbikgPyBqc29uIDoganNvbj8uZGF0YSB8fCBqc29uPy5yb3N0ZXJzIHx8IFtdO1xyXG4gICAgY29uc3QgaWRzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcblxyXG4gICAgY29uc3QgcHJvY2Vzc0VudHJpZXMgPSAoZW50cmllczogQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+KSA9PiB7XHJcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xyXG4gICAgICAgIGlmIChlbnRyeVsnZHJpdmVyUGVyc29uSWQnXSkge1xyXG4gICAgICAgICAgaWRzLmFkZChlbnRyeVsnZHJpdmVyUGVyc29uSWQnXSBhcyBzdHJpbmcpO1xyXG4gICAgICAgICAgaWYgKGVudHJ5Wydkcml2ZXJOYW1lJ10pIHtcclxuICAgICAgICAgICAgdGhpcy5fbmFtZU1hcFtlbnRyeVsnZHJpdmVyUGVyc29uSWQnXSBhcyBzdHJpbmddID0gZW50cnlbJ2RyaXZlck5hbWUnXSBhcyBzdHJpbmc7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIGlmIChBcnJheS5pc0FycmF5KHJvc3RlcikpIHtcclxuICAgICAgcHJvY2Vzc0VudHJpZXMocm9zdGVyKTtcclxuICAgIH0gZWxzZSBpZiAodHlwZW9mIHJvc3RlciA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgZm9yIChjb25zdCB2YWwgb2YgT2JqZWN0LnZhbHVlcyhyb3N0ZXIpKSB7XHJcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkgcHJvY2Vzc0VudHJpZXModmFsKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuX2Fzc29jaWF0ZXMgPSBbLi4uaWRzXTtcclxuICAgIGxvZyhgJHt0aGlzLl9hc3NvY2lhdGVzLmxlbmd0aH0gRmFocmVyIGdlZnVuZGVuLCAke09iamVjdC5rZXlzKHRoaXMuX25hbWVNYXApLmxlbmd0aH0gTmFtZW4gZ2VsYWRlbmApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBfZmV0Y2hEYXkoZGF0ZTogc3RyaW5nKTogUHJvbWlzZTx1bmtub3duPiB7XHJcbiAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICBhc3NvY2lhdGVzTGlzdDogdGhpcy5fYXNzb2NpYXRlcyxcclxuICAgICAgZGF0ZSxcclxuICAgICAgbW9kZTogJ2RhaWx5JyxcclxuICAgICAgc2VydmljZUFyZWFJZDogdGhpcy5fZ2V0U2VsZWN0ZWRTYUlkKCksXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGNzcmYgPSBnZXRDU1JGVG9rZW4oKTtcclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgIEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgfTtcclxuICAgIGlmIChjc3JmKSBoZWFkZXJzWydhbnRpLWNzcmZ0b2tlbi1hMnonXSA9IGNzcmY7XHJcblxyXG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKEFQSV9VUkwsIHtcclxuICAgICAgbWV0aG9kOiAnUE9TVCcsIGhlYWRlcnMsIGJvZHk6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLCBjcmVkZW50aWFsczogJ2luY2x1ZGUnLFxyXG4gICAgfSk7XHJcbiAgICBpZiAoIXJlc3Aub2spIHRocm93IG5ldyBFcnJvcihgQVBJIEZlaGxlciAke3Jlc3Auc3RhdHVzfSBmXHUwMEZDciAke2RhdGV9YCk7XHJcbiAgICByZXR1cm4gcmVzcC5qc29uKCk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgRGF0YSBQcm9jZXNzaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9leHRyYWN0RGF5RGF0YShqc29uOiB1bmtub3duKTogUmVjb3JkPHN0cmluZywgRGF5RW50cnk+IHtcclxuICAgIGNvbnN0IHJlc3VsdDogUmVjb3JkPHN0cmluZywgRGF5RW50cnk+ID0ge307XHJcbiAgICBjb25zdCBkYXRhID0gKChqc29uIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KT8uWydkYXRhJ10gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQpPy5bJ2RhV29ya1N1bW1hcnlBbmRFbGlnaWJpbGl0eSddIHx8IHt9O1xyXG4gICAgZm9yIChjb25zdCBbaWQsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhkYXRhIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSkge1xyXG4gICAgICBjb25zdCB3cyA9IChlbnRyeSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik/Llsnd29ya1N1bW1hcnknXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuICAgICAgaWYgKCF3cykgY29udGludWU7XHJcbiAgICAgIHJlc3VsdFtpZF0gPSB7XHJcbiAgICAgICAgc2NoZWR1bGVkRGF5OiAod3NbJ2RhU2NoZWR1bGVkRGF5TWlucyddIGFzIG51bWJlcikgfHwgMCxcclxuICAgICAgICBhY3R1YWxEYXk6ICh3c1snZGFBY3R1YWxXb3JrRGF5TWlucyddIGFzIG51bWJlcikgfHwgMCxcclxuICAgICAgICBzY2hlZHVsZWRXZWVrOiAod3NbJ2RhU2NoZWR1bGVkV2Vla01pbnMnXSBhcyBudW1iZXIpIHx8IDAsXHJcbiAgICAgICAgYWN0dWFsV2VlazogKHdzWydkYUFjdHVhbFdvcmtXZWVrTWlucyddIGFzIG51bWJlcikgfHwgMCxcclxuICAgICAgICBsYXN0N0RheXM6ICh3c1snZGFTY2hlZHVsZWRMYXN0N0RheXNNaW5zJ10gYXMgbnVtYmVyKSB8fCAwLFxyXG4gICAgICAgIGJyZWFjaGVkOiAod3NbJ2lzRGFpbHlMZWFwVGhyZXNob2xkQnJlYWNoZWQnXSBhcyBib29sZWFuKSB8fCBmYWxzZSxcclxuICAgICAgfTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgUmVuZGVyaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9yZW5kZXJTaW5nbGVEYXkoZGF0ZTogc3RyaW5nLCBkYXlEYXRhOiBSZWNvcmQ8c3RyaW5nLCBEYXlFbnRyeT4pOiBzdHJpbmcge1xyXG4gICAgY29uc3Qgcm93cyA9IE9iamVjdC5lbnRyaWVzKGRheURhdGEpXHJcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBiWzFdLmFjdHVhbERheSAtIGFbMV0uYWN0dWFsRGF5KVxyXG4gICAgICAubWFwKChbaWQsIGRdKSA9PiB7XHJcbiAgICAgICAgY29uc3QgY2xzID0gZC5icmVhY2hlZCA/ICdjdC1icmVhY2gnIDogJyc7XHJcbiAgICAgICAgcmV0dXJuIGA8dHIgY2xhc3M9XCIke2Nsc31cIj5cclxuICAgICAgICAgIDx0ZCB0aXRsZT1cIiR7ZXNjKGlkKX1cIj4ke2VzYyh0aGlzLl9yZXNvbHZlTmFtZShpZCkpfTwvdGQ+XHJcbiAgICAgICAgICA8dGQ+JHt0aGlzLl9taW5zVG9ITShkLnNjaGVkdWxlZERheSl9PC90ZD5cclxuICAgICAgICAgIDx0ZCBjbGFzcz1cIiR7dGhpcy5fbWluc0NsYXNzKGQuYWN0dWFsRGF5KX1cIj4ke3RoaXMuX21pbnNUb0hNKGQuYWN0dWFsRGF5KX08L3RkPlxyXG4gICAgICAgICAgPHRkPiR7dGhpcy5fbWluc1RvSE0oZC5zY2hlZHVsZWRXZWVrKX08L3RkPlxyXG4gICAgICAgICAgPHRkPiR7dGhpcy5fbWluc1RvSE0oZC5hY3R1YWxXZWVrKX08L3RkPlxyXG4gICAgICAgICAgPHRkPiR7dGhpcy5fbWluc1RvSE0oZC5sYXN0N0RheXMpfTwvdGQ+XHJcbiAgICAgICAgICA8dGQ+JHtkLmJyZWFjaGVkID8gJ1x1MjZBMFx1RkUwRiBKQScgOiAnXHUyNzA1IE5laW4nfTwvdGQ+XHJcbiAgICAgICAgPC90cj5gO1xyXG4gICAgICB9KS5qb2luKCcnKTtcclxuXHJcbiAgICByZXR1cm4gYFxyXG4gICAgICA8dGFibGUgY2xhc3M9XCJjdC10YWJsZVwiPlxyXG4gICAgICAgIDx0aGVhZD48dHI+XHJcbiAgICAgICAgICA8dGg+RmFocmVyPC90aD48dGg+R2VwbGFudCAoVGFnKTwvdGg+PHRoPklzdCAoVGFnKTwvdGg+XHJcbiAgICAgICAgICA8dGg+R2VwbGFudCAoV29jaGUpPC90aD48dGg+SXN0IChXb2NoZSk8L3RoPlxyXG4gICAgICAgICAgPHRoPkxldHp0ZW4gNyBUYWdlPC90aD48dGg+VGhyZXNob2xkIEJyZWFjaDwvdGg+XHJcbiAgICAgICAgPC90cj48L3RoZWFkPlxyXG4gICAgICAgIDx0Ym9keT4ke3Jvd3N9PC90Ym9keT5cclxuICAgICAgPC90YWJsZT5cclxuICAgIGA7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9yZW5kZXJXZWVrKHdlZWtEYXRhOiBXZWVrRGF0YSk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBkYXRlcyA9IE9iamVjdC5rZXlzKHdlZWtEYXRhKS5zb3J0KCk7XHJcbiAgICBjb25zdCBhbGxJZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcclxuICAgIGZvciAoY29uc3QgZGQgb2YgT2JqZWN0LnZhbHVlcyh3ZWVrRGF0YSkpIHtcclxuICAgICAgZm9yIChjb25zdCBpZCBvZiBPYmplY3Qua2V5cyhkZCkpIGFsbElkcy5hZGQoaWQpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGRheUhlYWRlcnMgPSBkYXRlc1xyXG4gICAgICAubWFwKChkLCBpKSA9PiBgPHRoIGNvbHNwYW49XCIyXCI+JHtlc2MoREFZU1tpXSA/PyBkKX0gKCR7ZXNjKGQuc2xpY2UoNSkpfSk8L3RoPmApXHJcbiAgICAgIC5qb2luKCcnKTtcclxuICAgIGNvbnN0IHN1YkhlYWRlcnMgPSBkYXRlcy5tYXAoKCkgPT4gJzx0aD5HZXBsYW50PC90aD48dGg+SXN0PC90aD4nKS5qb2luKCcnKTtcclxuXHJcbiAgICBjb25zdCBzb3J0ZWRSb3dzID0gWy4uLmFsbElkc11cclxuICAgICAgLm1hcCgoaWQpID0+IHtcclxuICAgICAgICBsZXQgdG90YWxBY3R1YWwgPSAwO1xyXG4gICAgICAgIGxldCBhbnlCcmVhY2ggPSBmYWxzZTtcclxuICAgICAgICBsZXQgd2Vla0FjdHVhbCA9IDA7XHJcblxyXG4gICAgICAgIGNvbnN0IGNlbGxzID0gZGF0ZXMubWFwKChkYXRlKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBkID0gd2Vla0RhdGFbZGF0ZV0/LltpZF07XHJcbiAgICAgICAgICBpZiAoIWQpIHJldHVybiAnPHRkIGNsYXNzPVwiY3Qtbm9kYXRhXCI+LTwvdGQ+PHRkIGNsYXNzPVwiY3Qtbm9kYXRhXCI+LTwvdGQ+JztcclxuICAgICAgICAgIHRvdGFsQWN0dWFsICs9IGQuYWN0dWFsRGF5O1xyXG4gICAgICAgICAgaWYgKGQuYnJlYWNoZWQpIGFueUJyZWFjaCA9IHRydWU7XHJcbiAgICAgICAgICB3ZWVrQWN0dWFsID0gZC5hY3R1YWxXZWVrO1xyXG4gICAgICAgICAgcmV0dXJuIGA8dGQ+JHt0aGlzLl9taW5zVG9ITShkLnNjaGVkdWxlZERheSl9PC90ZD5cclxuICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwiJHt0aGlzLl9taW5zQ2xhc3MoZC5hY3R1YWxEYXkpfVwiPiR7dGhpcy5fbWluc1RvSE0oZC5hY3R1YWxEYXkpfTwvdGQ+YDtcclxuICAgICAgICB9KS5qb2luKCcnKTtcclxuXHJcbiAgICAgICAgY29uc3QgY2xzID0gYW55QnJlYWNoID8gJ2N0LWJyZWFjaCcgOiAnJztcclxuICAgICAgICBjb25zdCByb3cgPSBgPHRyIGNsYXNzPVwiJHtjbHN9XCI+XHJcbiAgICAgICAgICA8dGQgdGl0bGU9XCIke2VzYyhpZCl9XCI+JHtlc2ModGhpcy5fcmVzb2x2ZU5hbWUoaWQpKX08L3RkPlxyXG4gICAgICAgICAgJHtjZWxsc31cclxuICAgICAgICAgIDx0ZCBjbGFzcz1cIiR7dGhpcy5fbWluc0NsYXNzKHRvdGFsQWN0dWFsIC8gZGF0ZXMubGVuZ3RoKX1cIj4ke3RoaXMuX21pbnNUb0hNKHRvdGFsQWN0dWFsKX08L3RkPlxyXG4gICAgICAgICAgPHRkPiR7dGhpcy5fbWluc1RvSE0od2Vla0FjdHVhbCl9PC90ZD5cclxuICAgICAgICAgIDx0ZD4ke2FueUJyZWFjaCA/ICdcdTI2QTBcdUZFMEYgSkEnIDogJ1x1MjcwNSd9PC90ZD5cclxuICAgICAgICA8L3RyPmA7XHJcbiAgICAgICAgcmV0dXJuIHsgcm93LCBhbnlCcmVhY2gsIHRvdGFsQWN0dWFsIH07XHJcbiAgICAgIH0pXHJcbiAgICAgIC5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICAgICAgaWYgKGEuYW55QnJlYWNoICE9PSBiLmFueUJyZWFjaCkgcmV0dXJuIGEuYW55QnJlYWNoID8gLTEgOiAxO1xyXG4gICAgICAgIHJldHVybiBiLnRvdGFsQWN0dWFsIC0gYS50b3RhbEFjdHVhbDtcclxuICAgICAgfSlcclxuICAgICAgLm1hcCgocikgPT4gci5yb3cpXHJcbiAgICAgIC5qb2luKCcnKTtcclxuXHJcbiAgICByZXR1cm4gYFxyXG4gICAgICA8dGFibGUgY2xhc3M9XCJjdC10YWJsZVwiPlxyXG4gICAgICAgIDx0aGVhZD5cclxuICAgICAgICAgIDx0cj5cclxuICAgICAgICAgICAgPHRoIHJvd3NwYW49XCIyXCI+RmFocmVyPC90aD5cclxuICAgICAgICAgICAgJHtkYXlIZWFkZXJzfVxyXG4gICAgICAgICAgICA8dGggcm93c3Bhbj1cIjJcIj5cdTAzQTMgSXN0PC90aD48dGggcm93c3Bhbj1cIjJcIj5BUEkgV29jaGU8L3RoPjx0aCByb3dzcGFuPVwiMlwiPkJyZWFjaDwvdGg+XHJcbiAgICAgICAgICA8L3RyPlxyXG4gICAgICAgICAgPHRyPiR7c3ViSGVhZGVyc308L3RyPlxyXG4gICAgICAgIDwvdGhlYWQ+XHJcbiAgICAgICAgPHRib2R5PiR7c29ydGVkUm93c308L3Rib2R5PlxyXG4gICAgICA8L3RhYmxlPlxyXG4gICAgYDtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBRdWVyeSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBfcnVuUXVlcnkoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBkYXRlID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC13aGMtZGF0ZScpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlO1xyXG4gICAgY29uc3QgbW9kZSA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hjLW1vZGUnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWU7XHJcbiAgICBjb25zdCBzdGF0dXNFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC13aGMtc3RhdHVzJykhO1xyXG4gICAgY29uc3QgcmVzdWx0RWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hjLXJlc3VsdCcpITtcclxuXHJcbiAgICBpZiAoIWRhdGUpIHsgc3RhdHVzRWwudGV4dENvbnRlbnQgPSAnXHUyNkEwXHVGRTBGIEJpdHRlIERhdHVtIGF1c3dcdTAwRTRobGVuISc7IHJldHVybjsgfVxyXG5cclxuICAgIHJlc3VsdEVsLmlubmVySFRNTCA9ICcnO1xyXG4gICAgdGhpcy5fbGFzdFF1ZXJ5TW9kZSA9IG1vZGU7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgc3RhdHVzRWwudGV4dENvbnRlbnQgPSAnXHUyM0YzIExhZGUgRmFocmVyLUxpc3RlLi4uJztcclxuICAgICAgaWYgKG1vZGUgPT09ICd3ZWVrJykge1xyXG4gICAgICAgIGNvbnN0IG1vbmRheSA9IHRoaXMuX2dldE1vbmRheShkYXRlKTtcclxuICAgICAgICBjb25zdCBzdW5kYXkgPSB0aGlzLl9hZGREYXlzKG1vbmRheSwgNik7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5fZmV0Y2hOYW1lcyhtb25kYXksIHN1bmRheSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5fZmV0Y2hOYW1lcyhkYXRlKTtcclxuICAgICAgfVxyXG4gICAgICBzdGF0dXNFbC50ZXh0Q29udGVudCA9IGBcdTIzRjMgJHt0aGlzLl9hc3NvY2lhdGVzLmxlbmd0aH0gRmFocmVyIGdlZnVuZGVuLCBsYWRlIERhdGVuLi4uYDtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgc3RhdHVzRWwudGV4dENvbnRlbnQgPSBgXHUyNzRDIFJvc3Rlci1GZWhsZXI6ICR7KGUgYXMgRXJyb3IpLm1lc3NhZ2V9YDtcclxuICAgICAgZXJyKGUpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuX2Fzc29jaWF0ZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gJ1x1MjZBMFx1RkUwRiBLZWluZSBGYWhyZXIgaW0gUm9zdGVyIGdlZnVuZGVuIGZcdTAwRkNyIGRpZXNlcyBEYXR1bSEnO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1vZGUgPT09ICdkYXknKSB7XHJcbiAgICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gYFx1MjNGMyBMYWRlIERhdGVuIGZcdTAwRkNyICR7ZGF0ZX0uLi5gO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCB0aGlzLl9mZXRjaERheShkYXRlKTtcclxuICAgICAgICBjb25zdCBkYXlEYXRhID0gdGhpcy5fZXh0cmFjdERheURhdGEoanNvbik7XHJcbiAgICAgICAgdGhpcy5fbGFzdFF1ZXJ5UmVzdWx0ID0geyBbZGF0ZV06IGRheURhdGEgfTtcclxuICAgICAgICByZXN1bHRFbC5pbm5lckhUTUwgPSB0aGlzLl9yZW5kZXJTaW5nbGVEYXkoZGF0ZSwgZGF5RGF0YSk7XHJcbiAgICAgICAgY29uc3QgY291bnQgPSBPYmplY3Qua2V5cyhkYXlEYXRhKS5sZW5ndGg7XHJcbiAgICAgICAgY29uc3QgYnJlYWNoZXMgPSBPYmplY3QudmFsdWVzKGRheURhdGEpLmZpbHRlcigoZCkgPT4gZC5icmVhY2hlZCkubGVuZ3RoO1xyXG4gICAgICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gYFx1MjcwNSAke2NvdW50fSBGYWhyZXIgZ2VsYWRlbiB8ICR7YnJlYWNoZXN9IFRocmVzaG9sZC1CcmVhY2hlcyB8ICR7ZGF0ZX1gO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgc3RhdHVzRWwudGV4dENvbnRlbnQgPSBgXHUyNzRDIEZlaGxlcjogJHsoZSBhcyBFcnJvcikubWVzc2FnZX1gO1xyXG4gICAgICAgIGVycihlKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3QgbW9uZGF5ID0gdGhpcy5fZ2V0TW9uZGF5KGRhdGUpO1xyXG4gICAgICBjb25zdCB3ZWVrRGF0YTogV2Vla0RhdGEgPSB7fTtcclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCA3OyBpKyspIHtcclxuICAgICAgICAgIGNvbnN0IGQgPSB0aGlzLl9hZGREYXlzKG1vbmRheSwgaSk7XHJcbiAgICAgICAgICBzdGF0dXNFbC50ZXh0Q29udGVudCA9IGBcdTIzRjMgTGFkZSAke0RBWVNbaV19ICgke2R9KS4uLiAoJHtpICsgMX0vNylgO1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QganNvbiA9IGF3YWl0IHRoaXMuX2ZldGNoRGF5KGQpO1xyXG4gICAgICAgICAgICB3ZWVrRGF0YVtkXSA9IHRoaXMuX2V4dHJhY3REYXlEYXRhKGpzb24pO1xyXG4gICAgICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYEZlaGxlciBmXHUwMEZDciAke2R9OmAsIGUpO1xyXG4gICAgICAgICAgICB3ZWVrRGF0YVtkXSA9IHt9O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgaWYgKGkgPCA2KSBhd2FpdCBkZWxheSg1MDApO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9sYXN0UXVlcnlSZXN1bHQgPSB3ZWVrRGF0YTtcclxuICAgICAgICByZXN1bHRFbC5pbm5lckhUTUwgPSB0aGlzLl9yZW5kZXJXZWVrKHdlZWtEYXRhKTtcclxuXHJcbiAgICAgICAgbGV0IHRvdGFsQnJlYWNoZXMgPSAwO1xyXG4gICAgICAgIGZvciAoY29uc3QgZGQgb2YgT2JqZWN0LnZhbHVlcyh3ZWVrRGF0YSkpIHtcclxuICAgICAgICAgIGZvciAoY29uc3QgZCBvZiBPYmplY3QudmFsdWVzKGRkKSkge1xyXG4gICAgICAgICAgICBpZiAoZC5icmVhY2hlZCkgdG90YWxCcmVhY2hlcysrO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBzdGF0dXNFbC50ZXh0Q29udGVudCA9IGBcdTI3MDUgV29jaGUgJHttb25kYXl9IGdlbGFkZW4gfCAke3RvdGFsQnJlYWNoZXN9IEJyZWFjaC1FaW50clx1MDBFNGdlYDtcclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIHN0YXR1c0VsLnRleHRDb250ZW50ID0gYFx1Mjc0QyBGZWhsZXI6ICR7KGUgYXMgRXJyb3IpLm1lc3NhZ2V9YDtcclxuICAgICAgICBlcnIoZSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBDU1YgRXhwb3J0IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9leHBvcnRDU1YoKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuX2xhc3RRdWVyeVJlc3VsdCkge1xyXG4gICAgICBhbGVydCgnQml0dGUgenVlcnN0IGVpbmUgQWJmcmFnZSBzdGFydGVuIScpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IGNzdiA9ICcnO1xyXG5cclxuICAgIGlmICh0aGlzLl9sYXN0UXVlcnlNb2RlID09PSAnZGF5Jykge1xyXG4gICAgICBjb25zdCBkYXRlID0gT2JqZWN0LmtleXModGhpcy5fbGFzdFF1ZXJ5UmVzdWx0KVswXTtcclxuICAgICAgY29uc3QgZGF0YSA9IHRoaXMuX2xhc3RRdWVyeVJlc3VsdFtkYXRlXTtcclxuICAgICAgY3N2ID0gJ05hbWU7QXNzb2NpYXRlIElEO0dlcGxhbnQgKFRhZyk7SXN0IChUYWcpO0dlcGxhbnQgKFdvY2hlKTtJc3QgKFdvY2hlKTtMZXR6dGVuIDcgVGFnZTtCcmVhY2hcXG4nO1xyXG4gICAgICBmb3IgKGNvbnN0IFtpZCwgZF0gb2YgT2JqZWN0LmVudHJpZXMoZGF0YSkpIHtcclxuICAgICAgICBjc3YgKz0gYCR7dGhpcy5fcmVzb2x2ZU5hbWUoaWQpfTske2lkfTske2Quc2NoZWR1bGVkRGF5fTske2QuYWN0dWFsRGF5fTske2Quc2NoZWR1bGVkV2Vla307JHtkLmFjdHVhbFdlZWt9OyR7ZC5sYXN0N0RheXN9OyR7ZC5icmVhY2hlZH1cXG5gO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zdCBkYXRlcyA9IE9iamVjdC5rZXlzKHRoaXMuX2xhc3RRdWVyeVJlc3VsdCkuc29ydCgpO1xyXG4gICAgICBjb25zdCBhbGxJZHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcclxuICAgICAgZm9yIChjb25zdCBkZCBvZiBPYmplY3QudmFsdWVzKHRoaXMuX2xhc3RRdWVyeVJlc3VsdCkpIHtcclxuICAgICAgICBmb3IgKGNvbnN0IGlkIG9mIE9iamVjdC5rZXlzKGRkKSkgYWxsSWRzLmFkZChpZCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNzdiA9ICdOYW1lO0Fzc29jaWF0ZSBJRCc7XHJcbiAgICAgIGZvciAoY29uc3QgZCBvZiBkYXRlcykgeyBjc3YgKz0gYDske2R9IEdlcGxhbnQ7JHtkfSBJc3RgOyB9XHJcbiAgICAgIGNzdiArPSAnO0JyZWFjaFxcbic7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IGlkIG9mIGFsbElkcykge1xyXG4gICAgICAgIGNzdiArPSBgJHt0aGlzLl9yZXNvbHZlTmFtZShpZCl9OyR7aWR9YDtcclxuICAgICAgICBsZXQgYW55QnJlYWNoID0gZmFsc2U7XHJcbiAgICAgICAgZm9yIChjb25zdCBkYXRlIG9mIGRhdGVzKSB7XHJcbiAgICAgICAgICBjb25zdCBkID0gdGhpcy5fbGFzdFF1ZXJ5UmVzdWx0W2RhdGVdPy5baWRdO1xyXG4gICAgICAgICAgY3N2ICs9IGA7JHtkPy5zY2hlZHVsZWREYXkgfHwgMH07JHtkPy5hY3R1YWxEYXkgfHwgMH1gO1xyXG4gICAgICAgICAgaWYgKGQ/LmJyZWFjaGVkKSBhbnlCcmVhY2ggPSB0cnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjc3YgKz0gYDske2FueUJyZWFjaH1cXG5gO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFsnXFx1RkVGRicgKyBjc3ZdLCB7IHR5cGU6ICd0ZXh0L2NzdjtjaGFyc2V0PXV0Zi04OycgfSk7XHJcbiAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgIGEuaHJlZiA9IHVybDtcclxuICAgIGEuZG93bmxvYWQgPSBgYXJiZWl0c3plaXRlbl8ke3RoaXMuX2xhc3RRdWVyeU1vZGV9XyR7T2JqZWN0LmtleXModGhpcy5fbGFzdFF1ZXJ5UmVzdWx0KVswXX0uY3N2YDtcclxuICAgIGEuY2xpY2soKTtcclxuICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICB9XHJcbn1cclxuIiwgIi8vIGZlYXR1cmVzL2RhdGUtZXh0cmFjdG9yLnRzIFx1MjAxMyBEYXRlIFJhbmdlIEV4dHJhY3RvciAoYmF0Y2ggV0hDIGRhdGEgZXh0cmFjdGlvbilcclxuXHJcbmltcG9ydCB7IGxvZywgZXJyLCBlc2MsIHRvZGF5U3RyLCBkZWxheSwgZXh0cmFjdFNlc3Npb25Gcm9tQ29va2llIH0gZnJvbSAnLi4vY29yZS91dGlscyc7XHJcbmltcG9ydCB7IG9uRGlzcG9zZSB9IGZyb20gJy4uL2NvcmUvdXRpbHMnO1xyXG5pbXBvcnQgdHlwZSB7IEFwcENvbmZpZyB9IGZyb20gJy4uL2NvcmUvc3RvcmFnZSc7XHJcbmltcG9ydCB0eXBlIHsgQ29tcGFueUNvbmZpZyB9IGZyb20gJy4uL2NvcmUvYXBpJztcclxuXHJcbmludGVyZmFjZSBFeHRyYWN0aW9uUmVzdWx0IHtcclxuICBkYXRlOiBzdHJpbmc7XHJcbiAgc3VjY2VzczogYm9vbGVhbjtcclxuICBkYXRhPzogdW5rbm93bjtcclxuICBlcnJvcj86IHN0cmluZztcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIEJhdGNoSW5kZXhFbnRyeSB7XHJcbiAga2V5OiBzdHJpbmc7XHJcbiAgc3RhcnREYXRlOiBzdHJpbmc7XHJcbiAgZW5kRGF0ZTogc3RyaW5nO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG4gIHN1Y2Nlc3NDb3VudDogbnVtYmVyO1xyXG4gIHRvdGFsQ291bnQ6IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIFByb2dyZXNzU3RhdGUge1xyXG4gIGlzUnVubmluZzogYm9vbGVhbjtcclxuICBjdXJyZW50OiBudW1iZXI7XHJcbiAgdG90YWw6IG51bWJlcjtcclxuICBkYXRlczogc3RyaW5nW107XHJcbiAgcmVzdWx0czogRXh0cmFjdGlvblJlc3VsdFtdO1xyXG59XHJcblxyXG5leHBvcnQgY2xhc3MgRGF0ZVJhbmdlRXh0cmFjdG9yIHtcclxuICBwcml2YXRlIF9wcm9ncmVzczogUHJvZ3Jlc3NTdGF0ZSA9IHsgaXNSdW5uaW5nOiBmYWxzZSwgY3VycmVudDogMCwgdG90YWw6IDAsIGRhdGVzOiBbXSwgcmVzdWx0czogW10gfTtcclxuICBwcml2YXRlIF9kaWFsb2dFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIF9wcm9ncmVzc0VsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgX3Jlc3VsdHNFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIF9oaXN0b3J5RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb25maWc6IEFwcENvbmZpZyxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGFueUNvbmZpZzogQ29tcGFueUNvbmZpZyxcclxuICApIHt9XHJcblxyXG4gIGluaXQoKTogdm9pZCB7IC8qIG5vLW9wIFx1MjAxNCBsYXp5IGNyZWF0aW9uICovIH1cclxuXHJcbiAgZGlzcG9zZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuX3N0b3BFeHRyYWN0aW9uKCk7XHJcbiAgICB0aGlzLl9kaWFsb2dFbD8ucmVtb3ZlKCk7IHRoaXMuX2RpYWxvZ0VsID0gbnVsbDtcclxuICAgIHRoaXMuX3Byb2dyZXNzRWw/LnJlbW92ZSgpOyB0aGlzLl9wcm9ncmVzc0VsID0gbnVsbDtcclxuICAgIHRoaXMuX3Jlc3VsdHNFbD8ucmVtb3ZlKCk7IHRoaXMuX3Jlc3VsdHNFbCA9IG51bGw7XHJcbiAgICB0aGlzLl9oaXN0b3J5RWw/LnJlbW92ZSgpOyB0aGlzLl9oaXN0b3J5RWwgPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIERhdGUgUmFuZ2UgRGlhbG9nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBzaG93RGlhbG9nKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmNvbmZpZy5mZWF0dXJlcy5kYXRlRXh0cmFjdG9yKSB7XHJcbiAgICAgIGFsZXJ0KCdEYXRlIFJhbmdlIEV4dHJhY3RvciBpc3QgZGVha3RpdmllcnQuIEJpdHRlIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGFrdGl2aWVyZW4uJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLl9kaWFsb2dFbD8ucmVtb3ZlKCk7IHRoaXMuX2RpYWxvZ0VsID0gbnVsbDtcclxuXHJcbiAgICBjb25zdCB0b2RheSA9IHRvZGF5U3RyKCk7XHJcbiAgICBjb25zdCBsYXN0V2VlayA9IG5ldyBEYXRlKERhdGUubm93KCkgLSA3ICogMjQgKiA2MCAqIDYwICogMTAwMCkudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdO1xyXG4gICAgY29uc3Qgb3ZlcmxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gICAgb3ZlcmxheS5jbGFzc05hbWUgPSAnY3Qtb3ZlcmxheSB2aXNpYmxlJztcclxuICAgIG92ZXJsYXkuaW5uZXJIVE1MID0gYFxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtZGlhbG9nXCI+XHJcbiAgICAgICAgPGgzPlx1RDgzRFx1RENDNSBTZWxlY3QgRGF0ZSBSYW5nZTwvaDM+XHJcbiAgICAgICAgPGRpdiBzdHlsZT1cIm1hcmdpbjogMTVweCAwO1wiPlxyXG4gICAgICAgICAgPGxhYmVsPjxzdHJvbmc+U3RhcnQgRGF0ZTo8L3N0cm9uZz48L2xhYmVsPjxicj5cclxuICAgICAgICAgIDxpbnB1dCB0eXBlPVwiZGF0ZVwiIGNsYXNzPVwiY3QtaW5wdXQgY3QtaW5wdXQtLWZ1bGxcIiBpZD1cImN0LWRyZS1zdGFydFwiIHZhbHVlPVwiJHtsYXN0V2Vla31cIiBzdHlsZT1cIm1hcmdpbi10b3A6NXB4O1wiPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW46IDE1cHggMDtcIj5cclxuICAgICAgICAgIDxsYWJlbD48c3Ryb25nPkVuZCBEYXRlOjwvc3Ryb25nPjwvbGFiZWw+PGJyPlxyXG4gICAgICAgICAgPGlucHV0IHR5cGU9XCJkYXRlXCIgY2xhc3M9XCJjdC1pbnB1dCBjdC1pbnB1dC0tZnVsbFwiIGlkPVwiY3QtZHJlLWVuZFwiIHZhbHVlPVwiJHt0b2RheX1cIiBzdHlsZT1cIm1hcmdpbi10b3A6NXB4O1wiPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW46IDE1cHggMDtcIj5cclxuICAgICAgICAgIDxsYWJlbD48c3Ryb25nPlNlcnZpY2UgQXJlYTo8L3N0cm9uZz48L2xhYmVsPjxicj5cclxuICAgICAgICAgIDxzZWxlY3QgY2xhc3M9XCJjdC1pbnB1dCBjdC1pbnB1dC0tZnVsbFwiIGlkPVwiY3QtZHJlLXNhXCIgc3R5bGU9XCJtYXJnaW4tdG9wOjVweDtcIj5cclxuICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIlwiPldpcmQgZ2VsYWRlblx1MjAyNjwvb3B0aW9uPlxyXG4gICAgICAgICAgPC9zZWxlY3Q+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LW5vdGUtYm94XCI+XHJcbiAgICAgICAgICBcdTIxMzlcdUZFMEYgPHN0cm9uZz5Ob3RlOjwvc3Ryb25nPiBTdW5kYXlzIHdpbGwgYmUgYXV0b21hdGljYWxseSBleGNsdWRlZCBmcm9tIHRoZSByYW5nZS5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IHN0eWxlPVwidGV4dC1hbGlnbjogY2VudGVyOyBtYXJnaW4tdG9wOiAyMHB4OyBkaXNwbGF5OiBmbGV4OyBnYXA6IDhweDsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7IGZsZXgtd3JhcDogd3JhcDtcIj5cclxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1zdWNjZXNzXCIgaWQ9XCJjdC1kcmUtcHJldmlld1wiPlx1RDgzRFx1REM0MVx1RkUwRiBQcmV2aWV3IERhdGVzPC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0taW5mb1wiIGlkPVwiY3QtZHJlLXN0YXJ0LWJ0blwiPlx1RDgzRFx1REU4MCBTdGFydCBFeHRyYWN0aW9uPC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tYWNjZW50XCIgaWQ9XCJjdC1kcmUtaGlzdG9yeVwiPlx1RDgzRFx1RENDOCBCYXRjaCBIaXN0b3J5PC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tc2Vjb25kYXJ5XCIgaWQ9XCJjdC1kcmUtY2FuY2VsXCI+Q2FuY2VsPC9idXR0b24+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBpZD1cImN0LWRyZS1wcmV2aWV3LWFyZWFcIj48L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICBgO1xyXG5cclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQob3ZlcmxheSk7XHJcbiAgICB0aGlzLl9kaWFsb2dFbCA9IG92ZXJsYXk7XHJcblxyXG4gICAgdGhpcy5jb21wYW55Q29uZmlnLmxvYWQoKS50aGVuKCgpID0+IHtcclxuICAgICAgdGhpcy5jb21wYW55Q29uZmlnLnBvcHVsYXRlU2FTZWxlY3QoXHJcbiAgICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRyZS1zYScpIGFzIEhUTUxTZWxlY3RFbGVtZW50LFxyXG4gICAgICApO1xyXG4gICAgfSk7XHJcblxyXG4gICAgb3ZlcmxheS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XHJcbiAgICAgIGlmIChlLnRhcmdldCA9PT0gb3ZlcmxheSkgeyBvdmVybGF5LnJlbW92ZSgpOyB0aGlzLl9kaWFsb2dFbCA9IG51bGw7IH1cclxuICAgIH0pO1xyXG5cclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kcmUtcHJldmlldycpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgY29uc3Qgc3RhcnREYXRlID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kcmUtc3RhcnQnKSBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZTtcclxuICAgICAgY29uc3QgZW5kRGF0ZSA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHJlLWVuZCcpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlO1xyXG4gICAgICBpZiAoIXN0YXJ0RGF0ZSB8fCAhZW5kRGF0ZSkgeyBhbGVydCgnUGxlYXNlIHNlbGVjdCBib3RoIHN0YXJ0IGFuZCBlbmQgZGF0ZXMnKTsgcmV0dXJuOyB9XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgZGF0ZXMgPSB0aGlzLl9nZW5lcmF0ZURhdGVSYW5nZShzdGFydERhdGUsIGVuZERhdGUpO1xyXG4gICAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kcmUtcHJldmlldy1hcmVhJykhLmlubmVySFRNTCA9IGBcclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJjdC1pbmZvLWJveFwiPlxyXG4gICAgICAgICAgICA8c3Ryb25nPlx1RDgzRFx1RENDQiBEYXRlcyB0byBleHRyYWN0ICgke2RhdGVzLmxlbmd0aH0pOjwvc3Ryb25nPjxicj5cclxuICAgICAgICAgICAgPGRpdiBzdHlsZT1cIm1heC1oZWlnaHQ6IDE1MHB4OyBvdmVyZmxvdy15OiBhdXRvOyBtYXJnaW4tdG9wOiA1cHg7IGZvbnQtc2l6ZTogMTJweDtcIj5cclxuICAgICAgICAgICAgICAke2VzYyhkYXRlcy5qb2luKCcsICcpKX1cclxuICAgICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8L2Rpdj5gO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGFsZXJ0KCdFcnJvcjogJyArIChlcnJvciBhcyBFcnJvcikubWVzc2FnZSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kcmUtc3RhcnQtYnRuJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICBjb25zdCBzdGFydERhdGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRyZS1zdGFydCcpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlO1xyXG4gICAgICBjb25zdCBlbmREYXRlID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kcmUtZW5kJykgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWU7XHJcbiAgICAgIGNvbnN0IHNlcnZpY2VBcmVhSWQgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRyZS1zYScpIGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZTtcclxuICAgICAgaWYgKCFzdGFydERhdGUgfHwgIWVuZERhdGUpIHsgYWxlcnQoJ1BsZWFzZSBzZWxlY3QgYm90aCBzdGFydCBhbmQgZW5kIGRhdGVzJyk7IHJldHVybjsgfVxyXG4gICAgICBpZiAoIXNlcnZpY2VBcmVhSWQudHJpbSgpKSB7IGFsZXJ0KCdCaXR0ZSBTZXJ2aWNlIEFyZWEgYXVzd1x1MDBFNGhsZW4nKTsgcmV0dXJuOyB9XHJcbiAgICAgIG92ZXJsYXkucmVtb3ZlKCk7IHRoaXMuX2RpYWxvZ0VsID0gbnVsbDtcclxuICAgICAgdGhpcy5fZXh0cmFjdERhdGVSYW5nZShzdGFydERhdGUsIGVuZERhdGUsIHNlcnZpY2VBcmVhSWQudHJpbSgpKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kcmUtaGlzdG9yeScpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgb3ZlcmxheS5yZW1vdmUoKTsgdGhpcy5fZGlhbG9nRWwgPSBudWxsO1xyXG4gICAgICB0aGlzLnNob3dIaXN0b3J5KCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHJlLWNhbmNlbCcpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgb3ZlcmxheS5yZW1vdmUoKTsgdGhpcy5fZGlhbG9nRWwgPSBudWxsO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgQmF0Y2ggSGlzdG9yeSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgc2hvd0hpc3RvcnkoKTogdm9pZCB7XHJcbiAgICB0aGlzLl9oaXN0b3J5RWw/LnJlbW92ZSgpOyB0aGlzLl9oaXN0b3J5RWwgPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IGJhdGNoSW5kZXg6IEJhdGNoSW5kZXhFbnRyeVtdID0gSlNPTi5wYXJzZShcclxuICAgICAgR01fZ2V0VmFsdWUoJ2JhdGNoX2luZGV4JywgJ1tdJykgYXMgc3RyaW5nLFxyXG4gICAgKTtcclxuXHJcbiAgICBpZiAoYmF0Y2hJbmRleC5sZW5ndGggPT09IDApIHtcclxuICAgICAgYWxlcnQoJ05vIGJhdGNoIGhpc3RvcnkgZm91bmQnKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG92ZXJsYXkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICAgIG92ZXJsYXkuY2xhc3NOYW1lID0gJ2N0LW92ZXJsYXkgdmlzaWJsZSc7XHJcblxyXG4gICAgY29uc3Qgcm93cyA9IFsuLi5iYXRjaEluZGV4XS5yZXZlcnNlKCkubWFwKChiYXRjaCkgPT4ge1xyXG4gICAgICBjb25zdCBzdWNjZXNzUmF0ZSA9IE1hdGgucm91bmQoKGJhdGNoLnN1Y2Nlc3NDb3VudCAvIGJhdGNoLnRvdGFsQ291bnQpICogMTAwKTtcclxuICAgICAgY29uc3QgY2xzID0gc3VjY2Vzc1JhdGUgPT09IDEwMCA/ICdjdC1oaXN0b3J5LXN1Y2Nlc3MnIDogc3VjY2Vzc1JhdGUgPiA1MCA/ICdjdC1oaXN0b3J5LXBhcnRpYWwnIDogJ2N0LWhpc3RvcnktZmFpbHVyZSc7XHJcbiAgICAgIHJldHVybiBgXHJcbiAgICAgICAgPHRyPlxyXG4gICAgICAgICAgPHRkPiR7ZXNjKGJhdGNoLnN0YXJ0RGF0ZSl9IHRvICR7ZXNjKGJhdGNoLmVuZERhdGUpfTwvdGQ+XHJcbiAgICAgICAgICA8dGQ+JHtlc2MobmV3IERhdGUoYmF0Y2gudGltZXN0YW1wKS50b0xvY2FsZVN0cmluZygpKX08L3RkPlxyXG4gICAgICAgICAgPHRkIGNsYXNzPVwiJHtjbHN9XCI+JHtiYXRjaC5zdWNjZXNzQ291bnR9LyR7YmF0Y2gudG90YWxDb3VudH0gKCR7c3VjY2Vzc1JhdGV9JSk8L3RkPlxyXG4gICAgICAgICAgPHRkPlxyXG4gICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0taW5mb1wiIGRhdGEtY3QtYmF0Y2gtZG93bmxvYWQ9XCIke2VzYyhiYXRjaC5rZXkpfVwiPkRvd25sb2FkPC9idXR0b24+XHJcbiAgICAgICAgICA8L3RkPlxyXG4gICAgICAgIDwvdHI+YDtcclxuICAgIH0pLmpvaW4oJycpO1xyXG5cclxuICAgIG92ZXJsYXkuaW5uZXJIVE1MID0gYFxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtcGFuZWxcIiBzdHlsZT1cIm1pbi13aWR0aDo3MDBweDtcIj5cclxuICAgICAgICA8aDI+XHVEODNEXHVEQ0M4IEJhdGNoIEV4dHJhY3Rpb24gSGlzdG9yeTwvaDI+XHJcbiAgICAgICAgPHRhYmxlIGNsYXNzPVwiY3QtaGlzdG9yeS10YWJsZVwiPlxyXG4gICAgICAgICAgPHRoZWFkPlxyXG4gICAgICAgICAgICA8dHI+PHRoPkRhdGUgUmFuZ2U8L3RoPjx0aD5FeHRyYWN0ZWQ8L3RoPjx0aD5TdWNjZXNzIFJhdGU8L3RoPjx0aD5BY3Rpb25zPC90aD48L3RyPlxyXG4gICAgICAgICAgPC90aGVhZD5cclxuICAgICAgICAgIDx0Ym9keT4ke3Jvd3N9PC90Ym9keT5cclxuICAgICAgICA8L3RhYmxlPlxyXG4gICAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOiAxNnB4OyB0ZXh0LWFsaWduOiByaWdodDtcIj5cclxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1zZWNvbmRhcnlcIiBpZD1cImN0LWRyZS1oaXN0b3J5LWNsb3NlXCI+Q2xvc2U8L2J1dHRvbj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+YDtcclxuXHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG92ZXJsYXkpO1xyXG4gICAgdGhpcy5faGlzdG9yeUVsID0gb3ZlcmxheTtcclxuXHJcbiAgICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcclxuICAgICAgaWYgKGUudGFyZ2V0ID09PSBvdmVybGF5KSB7IG92ZXJsYXkucmVtb3ZlKCk7IHRoaXMuX2hpc3RvcnlFbCA9IG51bGw7IH1cclxuICAgICAgY29uc3QgZGxCdG4gPSAoZS50YXJnZXQgYXMgRWxlbWVudCkuY2xvc2VzdCgnW2RhdGEtY3QtYmF0Y2gtZG93bmxvYWRdJyk7XHJcbiAgICAgIGlmIChkbEJ0bikge1xyXG4gICAgICAgIGNvbnN0IGtleSA9IGRsQnRuLmdldEF0dHJpYnV0ZSgnZGF0YS1jdC1iYXRjaC1kb3dubG9hZCcpITtcclxuICAgICAgICB0aGlzLl9kb3dubG9hZEJhdGNoKGtleSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kcmUtaGlzdG9yeS1jbG9zZScpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgb3ZlcmxheS5yZW1vdmUoKTsgdGhpcy5faGlzdG9yeUVsID0gbnVsbDtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfZG93bmxvYWRCYXRjaChrZXk6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmF3ID0gR01fZ2V0VmFsdWUoa2V5LCBudWxsKSBhcyBzdHJpbmcgfCBudWxsO1xyXG4gICAgICBpZiAoIXJhdykgeyBhbGVydCgnQmF0Y2ggZGF0YSBub3QgZm91bmQgXHUyMDE0IGl0IG1heSBoYXZlIGJlZW4gcmVtb3ZlZC4nKTsgcmV0dXJuOyB9XHJcbiAgICAgIGNvbnN0IGRhdGEgPSB0eXBlb2YgcmF3ID09PSAnc3RyaW5nJyA/IEpTT04ucGFyc2UocmF3KSA6IHJhdztcclxuICAgICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtKU09OLnN0cmluZ2lmeShkYXRhLCBudWxsLCAyKV0sIHsgdHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nIH0pO1xyXG4gICAgICBjb25zdCB1cmwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKGJsb2IpO1xyXG4gICAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgICBhLmhyZWYgPSB1cmw7XHJcbiAgICAgIGEuZG93bmxvYWQgPSBgYmF0Y2hfJHtrZXl9Lmpzb25gO1xyXG4gICAgICBhLmNsaWNrKCk7XHJcbiAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgZXJyKCdEb3dubG9hZCBiYXRjaCBmYWlsZWQ6JywgZSk7XHJcbiAgICAgIGFsZXJ0KCdGYWlsZWQgdG8gZG93bmxvYWQgYmF0Y2ggZGF0YS4nKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBFeHRyYWN0aW9uIENvcmUgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgYXN5bmMgX2V4dHJhY3REYXRlUmFuZ2Uoc3RhcnREYXRlOiBzdHJpbmcsIGVuZERhdGU6IHN0cmluZywgc2VydmljZUFyZWFJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBkYXRlcyA9IHRoaXMuX2dlbmVyYXRlRGF0ZVJhbmdlKHN0YXJ0RGF0ZSwgZW5kRGF0ZSk7XHJcbiAgICBsb2coYEV4dHJhY3RpbmcgZGF0YSBmb3IgJHtkYXRlcy5sZW5ndGh9IGRhdGVzOmAsIGRhdGVzKTtcclxuXHJcbiAgICB0aGlzLl9wcm9ncmVzcyA9IHsgaXNSdW5uaW5nOiB0cnVlLCBjdXJyZW50OiAwLCB0b3RhbDogZGF0ZXMubGVuZ3RoLCBkYXRlcywgcmVzdWx0czogW10gfTtcclxuICAgIHRoaXMuX3VwZGF0ZVByb2dyZXNzRGlzcGxheSgpO1xyXG5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGF0ZXMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgaWYgKCF0aGlzLl9wcm9ncmVzcy5pc1J1bm5pbmcpIGJyZWFrO1xyXG4gICAgICBjb25zdCBkYXRlID0gZGF0ZXNbaV07XHJcbiAgICAgIHRoaXMuX3Byb2dyZXNzLmN1cnJlbnQgPSBpICsgMTtcclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbG9nKGBFeHRyYWN0aW5nIGRhdGEgZm9yICR7ZGF0ZX0gKCR7aSArIDF9LyR7ZGF0ZXMubGVuZ3RofSlgKTtcclxuICAgICAgICB0aGlzLl91cGRhdGVQcm9ncmVzc0Rpc3BsYXkoKTtcclxuICAgICAgICBjb25zdCBkYXRhID0gYXdhaXQgdGhpcy5fZXh0cmFjdFNpbmdsZURhdGUoZGF0ZSwgc2VydmljZUFyZWFJZCk7XHJcbiAgICAgICAgdGhpcy5fcHJvZ3Jlc3MucmVzdWx0cy5wdXNoKHsgZGF0ZSwgc3VjY2VzczogdHJ1ZSwgZGF0YSwgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSk7XHJcbiAgICAgICAgaWYgKGkgPCBkYXRlcy5sZW5ndGggLSAxKSBhd2FpdCBkZWxheSgxMDAwICsgTWF0aC5yYW5kb20oKSAqIDEwMDApO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGVycihgRmFpbGVkIGZvciAke2RhdGV9OmAsIGVycm9yKTtcclxuICAgICAgICB0aGlzLl9wcm9ncmVzcy5yZXN1bHRzLnB1c2goeyBkYXRlLCBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IChlcnJvciBhcyBFcnJvcikubWVzc2FnZSwgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSk7XHJcbiAgICAgICAgYXdhaXQgZGVsYXkoMjAwMCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB0aGlzLl9wcm9ncmVzcy5pc1J1bm5pbmcgPSBmYWxzZTtcclxuICAgIHRoaXMuX3VwZGF0ZVByb2dyZXNzRGlzcGxheSgpO1xyXG4gICAgbG9nKCdEYXRlIHJhbmdlIGV4dHJhY3Rpb24gY29tcGxldGVkJyk7XHJcbiAgICB0aGlzLl9zYXZlQmF0Y2hSZXN1bHRzKHRoaXMuX3Byb2dyZXNzLnJlc3VsdHMsIHN0YXJ0RGF0ZSwgZW5kRGF0ZSk7XHJcbiAgICB0aGlzLl9zaG93QmF0Y2hSZXN1bHRzKHRoaXMuX3Byb2dyZXNzLnJlc3VsdHMpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfZXh0cmFjdFNpbmdsZURhdGUobG9jYWxEYXRlOiBzdHJpbmcsIHNlcnZpY2VBcmVhSWQ6IHN0cmluZyk6IFByb21pc2U8dW5rbm93bj4ge1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgY29uc3QgYXBpVXJsID0gYGh0dHBzOi8vbG9naXN0aWNzLmFtYXpvbi5kZS9vcGVyYXRpb25zL2V4ZWN1dGlvbi9hcGkvc3VtbWFyaWVzP2hpc3RvcmljYWxEYXk9ZmFsc2UmbG9jYWxEYXRlPSR7bG9jYWxEYXRlfSZzZXJ2aWNlQXJlYUlkPSR7c2VydmljZUFyZWFJZH1gO1xyXG4gICAgICBmZXRjaChhcGlVcmwsIHtcclxuICAgICAgICBtZXRob2Q6ICdHRVQnLFxyXG4gICAgICAgIGNyZWRlbnRpYWxzOiAnc2FtZS1vcmlnaW4nLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgIEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24sIHRleHQvcGxhaW4sICovKicsXHJcbiAgICAgICAgICAnQWNjZXB0LUxhbmd1YWdlJzogJ2RlLGVuLVVTO3E9MC43LGVuO3E9MC4zJyxcclxuICAgICAgICAgICd1c2VyLXJlZic6ICdjb3J0ZXgtd2ViYXBwLXVzZXInLFxyXG4gICAgICAgICAgJ1gtQ29ydGV4LVRpbWVzdGFtcCc6IERhdGUubm93KCkudG9TdHJpbmcoKSxcclxuICAgICAgICAgICdYLUNvcnRleC1TZXNzaW9uJzogZXh0cmFjdFNlc3Npb25Gcm9tQ29va2llKCkgPz8gJycsXHJcbiAgICAgICAgICBSZWZlcmVyOiBsb2NhdGlvbi5ocmVmLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pXHJcbiAgICAgICAgLnRoZW4oKHJlc3BvbnNlKSA9PiB7XHJcbiAgICAgICAgICBpZiAoIXJlc3BvbnNlLm9rKSB0aHJvdyBuZXcgRXJyb3IoYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9OiAke3Jlc3BvbnNlLnN0YXR1c1RleHR9YCk7XHJcbiAgICAgICAgICByZXR1cm4gcmVzcG9uc2UuanNvbigpO1xyXG4gICAgICAgIH0pXHJcbiAgICAgICAgLnRoZW4oKGRhdGEpID0+IHsgdGhpcy5fc2F2ZUluZGl2aWR1YWxEYXRhKGRhdGEsIGxvY2FsRGF0ZSk7IHJlc29sdmUoZGF0YSk7IH0pXHJcbiAgICAgICAgLmNhdGNoKHJlamVjdCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX2dlbmVyYXRlRGF0ZVJhbmdlKHN0YXJ0RGF0ZTogc3RyaW5nLCBlbmREYXRlOiBzdHJpbmcpOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCBkYXRlczogc3RyaW5nW10gPSBbXTtcclxuICAgIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoc3RhcnREYXRlKTtcclxuICAgIGNvbnN0IGVuZCA9IG5ldyBEYXRlKGVuZERhdGUpO1xyXG4gICAgaWYgKHN0YXJ0ID4gZW5kKSB0aHJvdyBuZXcgRXJyb3IoJ1N0YXJ0IGRhdGUgbXVzdCBiZSBiZWZvcmUgZW5kIGRhdGUnKTtcclxuICAgIGNvbnN0IGN1cnJlbnQgPSBuZXcgRGF0ZShzdGFydCk7XHJcbiAgICB3aGlsZSAoY3VycmVudCA8PSBlbmQpIHtcclxuICAgICAgaWYgKGN1cnJlbnQuZ2V0RGF5KCkgIT09IDApIHtcclxuICAgICAgICBkYXRlcy5wdXNoKGN1cnJlbnQudG9JU09TdHJpbmcoKS5zcGxpdCgnVCcpWzBdKTtcclxuICAgICAgfVxyXG4gICAgICBjdXJyZW50LnNldERhdGUoY3VycmVudC5nZXREYXRlKCkgKyAxKTtcclxuICAgIH1cclxuICAgIHJldHVybiBkYXRlcztcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBTdG9yYWdlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9zYXZlSW5kaXZpZHVhbERhdGEoZGF0YTogdW5rbm93biwgZGF0ZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBjb25zdCBrZXkgPSBgbG9naXN0aWNzX2RhdGFfJHtkYXRlfWA7XHJcbiAgICBjb25zdCBwcm9jZXNzZWQgPSB7XHJcbiAgICAgIGRhdGUsXHJcbiAgICAgIGV4dHJhY3RlZEF0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHJhd0RhdGE6IGRhdGEsXHJcbiAgICAgIHN1bW1hcnk6IHRoaXMuX2V4dHJhY3REYXRhU3VtbWFyeShkYXRhKSxcclxuICAgIH07XHJcbiAgICBHTV9zZXRWYWx1ZShrZXksIEpTT04uc3RyaW5naWZ5KHByb2Nlc3NlZCkpO1xyXG4gICAgbG9nKGBTYXZlZCBkYXRhIGZvciAke2RhdGV9YCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9zYXZlQmF0Y2hSZXN1bHRzKHJlc3VsdHM6IEV4dHJhY3Rpb25SZXN1bHRbXSwgc3RhcnREYXRlOiBzdHJpbmcsIGVuZERhdGU6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgY29uc3QgYmF0Y2hLZXkgPSBgYmF0Y2hfJHtzdGFydERhdGV9XyR7ZW5kRGF0ZX1fJHtEYXRlLm5vdygpfWA7XHJcbiAgICBjb25zdCBiYXRjaERhdGEgPSB7XHJcbiAgICAgIHN0YXJ0RGF0ZSwgZW5kRGF0ZSxcclxuICAgICAgZXh0cmFjdGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgdG90YWxEYXRlczogcmVzdWx0cy5sZW5ndGgsXHJcbiAgICAgIHN1Y2Nlc3NDb3VudDogcmVzdWx0cy5maWx0ZXIoKHIpID0+IHIuc3VjY2VzcykubGVuZ3RoLFxyXG4gICAgICByZXN1bHRzLFxyXG4gICAgfTtcclxuICAgIEdNX3NldFZhbHVlKGJhdGNoS2V5LCBKU09OLnN0cmluZ2lmeShiYXRjaERhdGEpKTtcclxuXHJcbiAgICBjb25zdCBiYXRjaEluZGV4OiBCYXRjaEluZGV4RW50cnlbXSA9IEpTT04ucGFyc2UoR01fZ2V0VmFsdWUoJ2JhdGNoX2luZGV4JywgJ1tdJykgYXMgc3RyaW5nKTtcclxuICAgIGJhdGNoSW5kZXgucHVzaCh7XHJcbiAgICAgIGtleTogYmF0Y2hLZXksIHN0YXJ0RGF0ZSwgZW5kRGF0ZSxcclxuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgIHN1Y2Nlc3NDb3VudDogYmF0Y2hEYXRhLnN1Y2Nlc3NDb3VudCxcclxuICAgICAgdG90YWxDb3VudDogYmF0Y2hEYXRhLnRvdGFsRGF0ZXMsXHJcbiAgICB9KTtcclxuICAgIGlmIChiYXRjaEluZGV4Lmxlbmd0aCA+IDIwKSB7XHJcbiAgICAgIGNvbnN0IG9sZEJhdGNoID0gYmF0Y2hJbmRleC5zaGlmdCgpITtcclxuICAgICAgR01fc2V0VmFsdWUob2xkQmF0Y2gua2V5LCAnJyk7XHJcbiAgICB9XHJcbiAgICBHTV9zZXRWYWx1ZSgnYmF0Y2hfaW5kZXgnLCBKU09OLnN0cmluZ2lmeShiYXRjaEluZGV4KSk7XHJcbiAgICBsb2coYFNhdmVkIGJhdGNoOiAke2JhdGNoS2V5fWApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfZXh0cmFjdERhdGFTdW1tYXJ5KGRhdGE6IHVua25vd24pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XHJcbiAgICBjb25zdCBzdW1tYXJ5OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9O1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgZCA9IGRhdGEgYXMgUmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgdW5rbm93bj4+O1xyXG4gICAgICBpZiAoZFsnc3VtbWFyeSddKSB7XHJcbiAgICAgICAgc3VtbWFyeVsndG90YWxSb3V0ZXMnXSA9IGRbJ3N1bW1hcnknXVsndG90YWxSb3V0ZXMnXSB8fCAwO1xyXG4gICAgICAgIHN1bW1hcnlbJ2NvbXBsZXRlZFJvdXRlcyddID0gZFsnc3VtbWFyeSddWydjb21wbGV0ZWRSb3V0ZXMnXSB8fCAwO1xyXG4gICAgICAgIHN1bW1hcnlbJ3RvdGFsUGFja2FnZXMnXSA9IGRbJ3N1bW1hcnknXVsndG90YWxQYWNrYWdlcyddIHx8IDA7XHJcbiAgICAgICAgc3VtbWFyeVsnZGVsaXZlcmVkUGFja2FnZXMnXSA9IGRbJ3N1bW1hcnknXVsnZGVsaXZlcmVkUGFja2FnZXMnXSB8fCAwO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChkWydtZXRyaWNzJ10pIHN1bW1hcnlbJ21ldHJpY3MnXSA9IGRbJ21ldHJpY3MnXTtcclxuICAgIH0gY2F0Y2ggKGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdDb3VsZCBub3QgZXh0cmFjdCBzdW1tYXJ5OicsIGUpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHN1bW1hcnk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgUHJvZ3Jlc3MgRGlzcGxheSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgcHJpdmF0ZSBfdXBkYXRlUHJvZ3Jlc3NEaXNwbGF5KCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLl9wcm9ncmVzcy5pc1J1bm5pbmcpIHtcclxuICAgICAgdGhpcy5fcHJvZ3Jlc3NFbD8ucmVtb3ZlKCk7IHRoaXMuX3Byb2dyZXNzRWwgPSBudWxsO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoIXRoaXMuX3Byb2dyZXNzRWwpIHtcclxuICAgICAgY29uc3Qgb3ZlcmxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gICAgICBvdmVybGF5LmNsYXNzTmFtZSA9ICdjdC1vdmVybGF5IHZpc2libGUnO1xyXG4gICAgICBvdmVybGF5LmlubmVySFRNTCA9IGBcclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtZGlhbG9nXCIgc3R5bGU9XCJtaW4td2lkdGg6MzIwcHg7IHRleHQtYWxpZ246Y2VudGVyO1wiPlxyXG4gICAgICAgICAgPGgzPlx1RDgzRFx1RENDQSBFeHRyYWN0aW5nIERhdGE8L2gzPlxyXG4gICAgICAgICAgPGRpdiBpZD1cImN0LWRyZS1wcm9ncmVzcy1pbm5lclwiPjwvZGl2PlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWRhbmdlclwiIGlkPVwiY3QtZHJlLXN0b3BcIiBzdHlsZT1cIm1hcmdpbi10b3A6MTVweDtcIj5TdG9wPC9idXR0b24+XHJcbiAgICAgICAgPC9kaXY+YDtcclxuICAgICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChvdmVybGF5KTtcclxuICAgICAgdGhpcy5fcHJvZ3Jlc3NFbCA9IG92ZXJsYXk7XHJcbiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kcmUtc3RvcCcpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuX3N0b3BFeHRyYWN0aW9uKCkpO1xyXG4gICAgfVxyXG4gICAgY29uc3QgcGN0ID0gTWF0aC5yb3VuZCgodGhpcy5fcHJvZ3Jlc3MuY3VycmVudCAvIHRoaXMuX3Byb2dyZXNzLnRvdGFsKSAqIDEwMCk7XHJcbiAgICBjb25zdCBjdXJyZW50RGF0ZSA9IHRoaXMuX3Byb2dyZXNzLmRhdGVzW3RoaXMuX3Byb2dyZXNzLmN1cnJlbnQgLSAxXSB8fCAnU3RhcnRpbmcuLi4nO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRyZS1wcm9ncmVzcy1pbm5lcicpIS5pbm5lckhUTUwgPSBgXHJcbiAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW46IDE1cHggMDtcIj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtcHJvZ3Jlc3NcIj5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJjdC1wcm9ncmVzc19fZmlsbFwiIHN0eWxlPVwid2lkdGg6ICR7cGN0fSU7XCI+PC9kaXY+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6IDEwcHg7IGZvbnQtc2l6ZTogMTRweDtcIj5cclxuICAgICAgICAgICR7dGhpcy5fcHJvZ3Jlc3MuY3VycmVudH0gLyAke3RoaXMuX3Byb2dyZXNzLnRvdGFsfSAoJHtwY3R9JSlcclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICAgIDxkaXYgc3R5bGU9XCJjb2xvcjogIzY2NjsgZm9udC1zaXplOiAxMnB4O1wiPkN1cnJlbnQ6ICR7ZXNjKGN1cnJlbnREYXRlKX08L2Rpdj5gO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfc3RvcEV4dHJhY3Rpb24oKTogdm9pZCB7XHJcbiAgICB0aGlzLl9wcm9ncmVzcy5pc1J1bm5pbmcgPSBmYWxzZTtcclxuICAgIHRoaXMuX3Byb2dyZXNzRWw/LnJlbW92ZSgpOyB0aGlzLl9wcm9ncmVzc0VsID0gbnVsbDtcclxuICAgIGxvZygnRXh0cmFjdGlvbiBzdG9wcGVkIGJ5IHVzZXInKTtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBCYXRjaCBSZXN1bHRzIERpc3BsYXkgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX3Nob3dCYXRjaFJlc3VsdHMocmVzdWx0czogRXh0cmFjdGlvblJlc3VsdFtdKTogdm9pZCB7XHJcbiAgICB0aGlzLl9yZXN1bHRzRWw/LnJlbW92ZSgpOyB0aGlzLl9yZXN1bHRzRWwgPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IHN1Y2Nlc3NDb3VudCA9IHJlc3VsdHMuZmlsdGVyKChyKSA9PiByLnN1Y2Nlc3MpLmxlbmd0aDtcclxuICAgIGNvbnN0IGZhaWx1cmVDb3VudCA9IHJlc3VsdHMubGVuZ3RoIC0gc3VjY2Vzc0NvdW50O1xyXG4gICAgY29uc3Qgc3VjY2Vzc1JhdGUgPSByZXN1bHRzLmxlbmd0aCA+IDAgPyBNYXRoLnJvdW5kKChzdWNjZXNzQ291bnQgLyByZXN1bHRzLmxlbmd0aCkgKiAxMDApIDogMDtcclxuXHJcbiAgICBjb25zdCByZXN1bHRJdGVtcyA9IHJlc3VsdHMubWFwKChyZXN1bHQpID0+IGBcclxuICAgICAgPGRpdiBjbGFzcz1cImN0LXJlc3VsdC1pdGVtXCI+XHJcbiAgICAgICAgPGg0PiR7ZXNjKHJlc3VsdC5kYXRlKX1cclxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwiJHtyZXN1bHQuc3VjY2VzcyA/ICdjdC1yZXN1bHQtc3VjY2VzcycgOiAnY3QtcmVzdWx0LWZhaWx1cmUnfVwiPlxyXG4gICAgICAgICAgICAke3Jlc3VsdC5zdWNjZXNzID8gJ1x1MjcwNScgOiAnXHUyNzRDJ31cclxuICAgICAgICAgIDwvc3Bhbj5cclxuICAgICAgICA8L2g0PlxyXG4gICAgICAgICR7cmVzdWx0LnN1Y2Nlc3NcclxuICAgICAgICAgID8gJzxwPkRhdGEgZXh0cmFjdGVkIHN1Y2Nlc3NmdWxseTwvcD4nXHJcbiAgICAgICAgICA6ICc8cD5FcnJvcjogJyArIGVzYyhyZXN1bHQuZXJyb3IgPz8gJycpICsgJzwvcD4nXHJcbiAgICAgICAgfVxyXG4gICAgICAgIDxzbWFsbD5UaW1lOiAke2VzYyhuZXcgRGF0ZShyZXN1bHQudGltZXN0YW1wKS50b0xvY2FsZVN0cmluZygpKX08L3NtYWxsPlxyXG4gICAgICA8L2Rpdj5gKS5qb2luKCcnKTtcclxuXHJcbiAgICBjb25zdCBvdmVybGF5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBvdmVybGF5LmNsYXNzTmFtZSA9ICdjdC1vdmVybGF5IHZpc2libGUnO1xyXG4gICAgb3ZlcmxheS5pbm5lckhUTUwgPSBgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1wYW5lbFwiIHN0eWxlPVwibWluLXdpZHRoOjYwMHB4O1wiPlxyXG4gICAgICAgIDxoMj5cdUQ4M0RcdURDQ0EgQmF0Y2ggRXh0cmFjdGlvbiBSZXN1bHRzPC9oMj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3Qtc3VtbWFyeS1ib3hcIj5cclxuICAgICAgICAgIDxoMz5TdW1tYXJ5PC9oMz5cclxuICAgICAgICAgIDxwPjxzdHJvbmc+VG90YWwgRGF0ZXM6PC9zdHJvbmc+ICR7cmVzdWx0cy5sZW5ndGh9PC9wPlxyXG4gICAgICAgICAgPHA+PHN0cm9uZyBjbGFzcz1cImN0LXJlc3VsdC1zdWNjZXNzXCI+U3VjY2Vzc2Z1bDo8L3N0cm9uZz4gJHtzdWNjZXNzQ291bnR9PC9wPlxyXG4gICAgICAgICAgPHA+PHN0cm9uZyBjbGFzcz1cImN0LXJlc3VsdC1mYWlsdXJlXCI+RmFpbGVkOjwvc3Ryb25nPiAke2ZhaWx1cmVDb3VudH08L3A+XHJcbiAgICAgICAgICA8cD48c3Ryb25nPlN1Y2Nlc3MgUmF0ZTo8L3N0cm9uZz4gJHtzdWNjZXNzUmF0ZX0lPC9wPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW4tYm90dG9tOiAxNnB4OyBkaXNwbGF5OiBmbGV4OyBnYXA6IDhweDsgZmxleC13cmFwOiB3cmFwO1wiPlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXByaW1hcnlcIiBpZD1cImN0LWRyZS1kbC1hbGxcIj5cdUQ4M0RcdURDQkUgRG93bmxvYWQgQWxsIERhdGE8L2J1dHRvbj5cclxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1pbmZvXCIgaWQ9XCJjdC1kcmUtZGwtc3VtbWFyeVwiPlx1RDgzRFx1RENDQiBEb3dubG9hZCBTdW1tYXJ5PC9idXR0b24+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGgzPkluZGl2aWR1YWwgUmVzdWx0czwvaDM+XHJcbiAgICAgICAgPGRpdiBzdHlsZT1cIm1heC1oZWlnaHQ6IDQwMHB4OyBvdmVyZmxvdy15OiBhdXRvO1wiPiR7cmVzdWx0SXRlbXN9PC9kaXY+XHJcbiAgICAgICAgPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6IDE2cHg7IHRleHQtYWxpZ246IHJpZ2h0O1wiPlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXNlY29uZGFyeVwiIGlkPVwiY3QtZHJlLXJlc3VsdHMtY2xvc2VcIj5DbG9zZTwvYnV0dG9uPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5gO1xyXG5cclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQob3ZlcmxheSk7XHJcbiAgICB0aGlzLl9yZXN1bHRzRWwgPSBvdmVybGF5O1xyXG5cclxuICAgIG92ZXJsYXkuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4ge1xyXG4gICAgICBpZiAoZS50YXJnZXQgPT09IG92ZXJsYXkpIHsgb3ZlcmxheS5yZW1vdmUoKTsgdGhpcy5fcmVzdWx0c0VsID0gbnVsbDsgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRyZS1yZXN1bHRzLWNsb3NlJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICBvdmVybGF5LnJlbW92ZSgpOyB0aGlzLl9yZXN1bHRzRWwgPSBudWxsO1xyXG4gICAgfSk7XHJcblxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRyZS1kbC1hbGwnKSEuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkocmVzdWx0cywgbnVsbCwgMildLCB7IHR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcclxuICAgICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgICAgYS5ocmVmID0gdXJsO1xyXG4gICAgICBhLmRvd25sb2FkID0gYGxvZ2lzdGljc19iYXRjaF9kYXRhXyR7dG9kYXlTdHIoKX0uanNvbmA7XHJcbiAgICAgIGEuY2xpY2soKTtcclxuICAgICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRyZS1kbC1zdW1tYXJ5JykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICBjb25zdCBzdW1tYXJ5ID0geyB0b3RhbERhdGVzOiByZXN1bHRzLmxlbmd0aCwgc3VjY2Vzc0NvdW50LCBmYWlsdXJlQ291bnQsIHN1Y2Nlc3NSYXRlIH07XHJcbiAgICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbSlNPTi5zdHJpbmdpZnkoc3VtbWFyeSwgbnVsbCwgMildLCB7IHR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyB9KTtcclxuICAgICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgICAgYS5ocmVmID0gdXJsO1xyXG4gICAgICBhLmRvd25sb2FkID0gYGxvZ2lzdGljc19zdW1tYXJ5XyR7dG9kYXlTdHIoKX0uanNvbmA7XHJcbiAgICAgIGEuY2xpY2soKTtcclxuICAgICAgVVJMLnJldm9rZU9iamVjdFVSTCh1cmwpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcbiIsICIvLyBmZWF0dXJlcy9kZWxpdmVyeS1wZXJmb3JtYW5jZS50cyBcdTIwMTMgRGFpbHkgRGVsaXZlcnkgUGVyZm9ybWFuY2UgRGFzaGJvYXJkXHJcblxyXG5pbXBvcnQgeyBsb2csIGVyciwgZXNjLCB0b2RheVN0ciwgd2l0aFJldHJ5LCBnZXRDU1JGVG9rZW4gfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcclxuaW1wb3J0IHsgb25EaXNwb3NlIH0gZnJvbSAnLi4vY29yZS91dGlscyc7XHJcbmltcG9ydCB0eXBlIHsgQXBwQ29uZmlnIH0gZnJvbSAnLi4vY29yZS9zdG9yYWdlJztcclxuaW1wb3J0IHR5cGUgeyBDb21wYW55Q29uZmlnIH0gZnJvbSAnLi4vY29yZS9hcGknO1xyXG5cclxuLy8gXHUyNTAwXHUyNTAwIEZpZWxkLXR5cGUgY2xhc3NpZmljYXRpb24gbWFwcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbmV4cG9ydCBjb25zdCBEUF9TVFJJTkdfRklFTERTID0gbmV3IFNldChbXHJcbiAgJ2NvdW50cnknLCAnc3RhdGlvbl9jb2RlJywgJ3Byb2dyYW0nLFxyXG4gICdjb3VudHJ5X2RzcGlkX3N0YXRpb25jb2RlJywgJ2NvdW50cnlfcHJvZ3JhbV9zdGF0aW9uY29kZScsXHJcbiAgJ3JlZ2lvbicsICdkc3BfY29kZScsICdjb3VudHJ5X3Byb2dyYW1fZHNwaWRfc3RhdGlvbmNvZGUnLFxyXG4gICdjb3VudHJ5X3N0YXRpb25jb2RlJywgJ2NvdW50cnlfcHJvZ3JhbV9kYXRhX2RhdGUnLFxyXG5dKTtcclxuXHJcbmV4cG9ydCBjb25zdCBEUF9JTlRfRklFTERTID0gbmV3IFNldChbXHJcbiAgJ2RlbGl2ZXJlZCcsICd1bmJ1Y2tldGVkX2RlbGl2ZXJ5X21pc3NlcycsICdhZGRyZXNzX25vdF9mb3VuZCcsXHJcbiAgJ3JldHVybl90b19zdGF0aW9uX3V0bCcsICdyZXR1cm5fdG9fc3RhdGlvbl91dGEnLCAnY3VzdG9tZXJfbm90X2F2YWlsYWJsZScsXHJcbiAgJ3JldHVybl90b19zdGF0aW9uX2FsbCcsICdzdWNjZXNzZnVsX2NfcmV0dXJuX3BpY2t1cHMnLCAncnRzX290aGVyJyxcclxuICAnZGlzcGF0Y2hlZCcsICd0cmFuc2ZlcnJlZF9vdXQnLCAnZG5yJywgJ3JldHVybl90b19zdGF0aW9uX25zbCcsXHJcbiAgJ2NvbXBsZXRlZF9yb3V0ZXMnLCAnZmlyc3RfZGVsdl93aXRoX3Rlc3RfZGltJywgJ3BkZV9waG90b3NfdGFrZW4nLFxyXG4gICdwYWNrYWdlc19ub3Rfb25fdmFuJywgJ2ZpcnN0X2Rpc3Bfd2l0aF90ZXN0X2RpbScsICdkZWxpdmVyeV9hdHRlbXB0JyxcclxuICAncmV0dXJuX3RvX3N0YXRpb25fYmMnLCAncG9kX2J5cGFzcycsICdwb2Rfb3Bwb3J0dW5pdHknLCAncG9kX3N1Y2Nlc3MnLFxyXG4gICduZXh0X2RheV9yb3V0ZXMnLCAnc2NoZWR1bGVkX21mbl9waWNrdXBzJywgJ3N1Y2Nlc3NmdWxfbWZuX3BpY2t1cHMnLFxyXG4gICdyZWplY3RlZF9wYWNrYWdlcycsICdwYXltZW50X25vdF9yZWFkeScsICdzY2hlZHVsZWRfY19yZXR1cm5fcGlja3VwcycsXHJcbiAgJ3JldHVybl90b19zdGF0aW9uX2N1JywgJ3JldHVybl90b19zdGF0aW9uX29vZHQnLCAncnRzX2RwbW8nLCAnZG5yX2RwbW8nLCAndHRsJyxcclxuXSk7XHJcblxyXG5leHBvcnQgY29uc3QgRFBfUEVSQ0VOVF9GSUVMRFMgPSBuZXcgU2V0KFtcclxuICAncG9kX3N1Y2Nlc3NfcmF0ZScsICdydHNfY3VfcGVyY2VudCcsICdydHNfb3RoZXJfcGVyY2VudCcsICdydHNfb29kdF9wZXJjZW50JyxcclxuICAncnRzX3V0bF9wZXJjZW50JywgJ3J0c19iY19wZXJjZW50JywgJ2RlbGl2ZXJ5X2F0dGVtcHRfcGVyY2VudCcsXHJcbiAgJ2N1c3RvbWVyX25vdF9hdmFpbGFibGVfcGVyY2VudCcsICdmaXJzdF9kYXlfZGVsaXZlcnlfc3VjY2Vzc19wZXJjZW50JyxcclxuICAncnRzX2FsbF9wZXJjZW50JywgJ3JlamVjdGVkX3BhY2thZ2VzX3BlcmNlbnQnLCAncGF5bWVudF9ub3RfcmVhZHlfcGVyY2VudCcsXHJcbiAgJ2RlbGl2ZXJ5X3N1Y2Nlc3NfZHNwJywgJ2RlbGl2ZXJ5X3N1Y2Nlc3MnLFxyXG4gICd1bmJ1Y2tldGVkX2RlbGl2ZXJ5X21pc3Nlc19wZXJjZW50JywgJ2FkZHJlc3Nfbm90X2ZvdW5kX3BlcmNlbnQnLFxyXG5dKTtcclxuXHJcbmV4cG9ydCBjb25zdCBEUF9SQVRFX0ZJRUxEUyA9IG5ldyBTZXQoWydzaGlwbWVudF96b25lX3Blcl9ob3VyJ10pO1xyXG5leHBvcnQgY29uc3QgRFBfREFURVRJTUVfRklFTERTID0gbmV3IFNldChbJ2xhc3RfdXBkYXRlZF90aW1lJ10pO1xyXG5leHBvcnQgY29uc3QgRFBfRVBPQ0hfRklFTERTICAgPSBuZXcgU2V0KFsnbWVzc2FnZVRpbWVzdGFtcCddKTtcclxuZXhwb3J0IGNvbnN0IERQX0RBVEVfRklFTERTICAgID0gbmV3IFNldChbJ2RhdGFfZGF0ZSddKTtcclxuXHJcbmV4cG9ydCBjb25zdCBEUF9MQUJFTFM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgY291bnRyeTogJ0NvdW50cnknLCBzdGF0aW9uX2NvZGU6ICdTdGF0aW9uJywgcHJvZ3JhbTogJ1Byb2dyYW0nLFxyXG4gIGNvdW50cnlfZHNwaWRfc3RhdGlvbmNvZGU6ICdDb3VudHJ5L0RTUC9TdGF0aW9uJyxcclxuICBjb3VudHJ5X3Byb2dyYW1fc3RhdGlvbmNvZGU6ICdDb3VudHJ5L1Byb2dyYW0vU3RhdGlvbicsXHJcbiAgcmVnaW9uOiAnUmVnaW9uJywgZHNwX2NvZGU6ICdEU1AnLFxyXG4gIGNvdW50cnlfcHJvZ3JhbV9kc3BpZF9zdGF0aW9uY29kZTogJ0NvdW50cnkvUHJvZ3JhbS9EU1AvU3RhdGlvbicsXHJcbiAgY291bnRyeV9zdGF0aW9uY29kZTogJ0NvdW50cnkvU3RhdGlvbicsXHJcbiAgY291bnRyeV9wcm9ncmFtX2RhdGFfZGF0ZTogJ0NvdW50cnkvUHJvZ3JhbS9EYXRlJyxcclxuICBkZWxpdmVyZWQ6ICdEZWxpdmVyZWQnLCBkaXNwYXRjaGVkOiAnRGlzcGF0Y2hlZCcsXHJcbiAgY29tcGxldGVkX3JvdXRlczogJ0NvbXBsZXRlZCBSb3V0ZXMnLCBkZWxpdmVyeV9hdHRlbXB0OiAnRGVsaXZlcnkgQXR0ZW1wdHMnLFxyXG4gIHVuYnVja2V0ZWRfZGVsaXZlcnlfbWlzc2VzOiAnVW5idWNrZXRlZCBNaXNzZXMnLFxyXG4gIGFkZHJlc3Nfbm90X2ZvdW5kOiAnQWRkcmVzcyBOb3QgRm91bmQnLFxyXG4gIHJldHVybl90b19zdGF0aW9uX3V0bDogJ1JUUyBVVEwnLCByZXR1cm5fdG9fc3RhdGlvbl91dGE6ICdSVFMgVVRBJyxcclxuICBjdXN0b21lcl9ub3RfYXZhaWxhYmxlOiAnQ3VzdG9tZXIgTi9BJyxcclxuICByZXR1cm5fdG9fc3RhdGlvbl9hbGw6ICdSVFMgQWxsJywgcmV0dXJuX3RvX3N0YXRpb25fY3U6ICdSVFMgQ1UnLFxyXG4gIHJldHVybl90b19zdGF0aW9uX2JjOiAnUlRTIEJDJywgcmV0dXJuX3RvX3N0YXRpb25fbnNsOiAnUlRTIE5TTCcsXHJcbiAgcmV0dXJuX3RvX3N0YXRpb25fb29kdDogJ1JUUyBPT0RUJyxcclxuICBzdWNjZXNzZnVsX2NfcmV0dXJuX3BpY2t1cHM6ICdDLVJldHVybiBQaWNrdXBzJyxcclxuICBydHNfb3RoZXI6ICdSVFMgT3RoZXInLCB0cmFuc2ZlcnJlZF9vdXQ6ICdUcmFuc2ZlcnJlZCBPdXQnLCBkbnI6ICdETlInLFxyXG4gIGZpcnN0X2RlbHZfd2l0aF90ZXN0X2RpbTogJ0ZpcnN0IERlbHYgKGRpbSknLCBwZGVfcGhvdG9zX3Rha2VuOiAnUERFIFBob3RvcycsXHJcbiAgcGFja2FnZXNfbm90X29uX3ZhbjogJ1BrZ3MgTm90IG9uIFZhbicsXHJcbiAgZmlyc3RfZGlzcF93aXRoX3Rlc3RfZGltOiAnRmlyc3QgRGlzcCAoZGltKScsXHJcbiAgcG9kX2J5cGFzczogJ1BPRCBCeXBhc3MnLCBwb2Rfb3Bwb3J0dW5pdHk6ICdQT0QgT3Bwb3J0dW5pdHknLFxyXG4gIHBvZF9zdWNjZXNzOiAnUE9EIFN1Y2Nlc3MnLCBuZXh0X2RheV9yb3V0ZXM6ICdOZXh0IERheSBSb3V0ZXMnLFxyXG4gIHNjaGVkdWxlZF9tZm5fcGlja3VwczogJ1NjaGVkIE1GTiBQaWNrdXBzJyxcclxuICBzdWNjZXNzZnVsX21mbl9waWNrdXBzOiAnU3VjY2Vzc2Z1bCBNRk4gUGlja3VwcycsXHJcbiAgcmVqZWN0ZWRfcGFja2FnZXM6ICdSZWplY3RlZCBQa2dzJywgcGF5bWVudF9ub3RfcmVhZHk6ICdQYXltZW50IE4vUmVhZHknLFxyXG4gIHNjaGVkdWxlZF9jX3JldHVybl9waWNrdXBzOiAnU2NoZWQgQy1SZXR1cm4nLFxyXG4gIHJ0c19kcG1vOiAnUlRTIERQTU8nLCBkbnJfZHBtbzogJ0ROUiBEUE1PJywgdHRsOiAnVFRMJyxcclxuICBzaGlwbWVudF96b25lX3Blcl9ob3VyOiAnU2hpcG1lbnRzL1pvbmUvSG91cicsXHJcbiAgcG9kX3N1Y2Nlc3NfcmF0ZTogJ1BPRCBTdWNjZXNzIFJhdGUnLFxyXG4gIHJ0c19jdV9wZXJjZW50OiAnUlRTIENVICUnLCBydHNfb3RoZXJfcGVyY2VudDogJ1JUUyBPdGhlciAlJyxcclxuICBydHNfb29kdF9wZXJjZW50OiAnUlRTIE9PRFQgJScsIHJ0c191dGxfcGVyY2VudDogJ1JUUyBVVEwgJScsXHJcbiAgcnRzX2JjX3BlcmNlbnQ6ICdSVFMgQkMgJScsIGRlbGl2ZXJ5X2F0dGVtcHRfcGVyY2VudDogJ0RlbGl2ZXJ5IEF0dGVtcHQgJScsXHJcbiAgY3VzdG9tZXJfbm90X2F2YWlsYWJsZV9wZXJjZW50OiAnQ3VzdG9tZXIgTi9BICUnLFxyXG4gIGZpcnN0X2RheV9kZWxpdmVyeV9zdWNjZXNzX3BlcmNlbnQ6ICdGaXJzdC1EYXkgU3VjY2VzcyAlJyxcclxuICBydHNfYWxsX3BlcmNlbnQ6ICdSVFMgQWxsICUnLCByZWplY3RlZF9wYWNrYWdlc19wZXJjZW50OiAnUmVqZWN0ZWQgUGtncyAlJyxcclxuICBwYXltZW50X25vdF9yZWFkeV9wZXJjZW50OiAnUGF5bWVudCBOL1JlYWR5ICUnLFxyXG4gIGRlbGl2ZXJ5X3N1Y2Nlc3NfZHNwOiAnRGVsaXZlcnkgU3VjY2VzcyAoRFNQKScsXHJcbiAgZGVsaXZlcnlfc3VjY2VzczogJ0RlbGl2ZXJ5IFN1Y2Nlc3MnLFxyXG4gIHVuYnVja2V0ZWRfZGVsaXZlcnlfbWlzc2VzX3BlcmNlbnQ6ICdVbmJ1Y2tldGVkIE1pc3NlcyAlJyxcclxuICBhZGRyZXNzX25vdF9mb3VuZF9wZXJjZW50OiAnQWRkcmVzcyBOb3QgRm91bmQgJScsXHJcbiAgbGFzdF91cGRhdGVkX3RpbWU6ICdMYXN0IFVwZGF0ZWQnLCBtZXNzYWdlVGltZXN0YW1wOiAnTWVzc2FnZSBUaW1lc3RhbXAnLFxyXG4gIGRhdGFfZGF0ZTogJ0RhdGEgRGF0ZScsXHJcbn07XHJcblxyXG4vLyBcdTI1MDBcdTI1MDAgUHVyZSBoZWxwZXIgZnVuY3Rpb25zIChhbHNvIGV4cG9ydGVkIGZvciB0ZXN0aW5nKSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBkcFBhcnNlUm93KGpzb25TdHI6IHN0cmluZyB8IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xyXG4gIGNvbnN0IHJhdyA9IHR5cGVvZiBqc29uU3RyID09PSAnc3RyaW5nJyA/IEpTT04ucGFyc2UoanNvblN0cikgOiBqc29uU3RyO1xyXG4gIGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcclxuICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhyYXcpKSB7XHJcbiAgICBvdXRbay50cmltKCldID0gdjtcclxuICB9XHJcbiAgcmV0dXJuIG91dDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGRwQ2xhc3NpZnlGaWVsZChmaWVsZDogc3RyaW5nKTogc3RyaW5nIHtcclxuICBpZiAoRFBfU1RSSU5HX0ZJRUxEUy5oYXMoZmllbGQpKSAgIHJldHVybiAnc3RyaW5nJztcclxuICBpZiAoRFBfSU5UX0ZJRUxEUy5oYXMoZmllbGQpKSAgICAgIHJldHVybiAnaW50JztcclxuICBpZiAoRFBfUEVSQ0VOVF9GSUVMRFMuaGFzKGZpZWxkKSkgIHJldHVybiAncGVyY2VudCc7XHJcbiAgaWYgKERQX1JBVEVfRklFTERTLmhhcyhmaWVsZCkpICAgICByZXR1cm4gJ3JhdGUnO1xyXG4gIGlmIChEUF9EQVRFVElNRV9GSUVMRFMuaGFzKGZpZWxkKSkgcmV0dXJuICdkYXRldGltZSc7XHJcbiAgaWYgKERQX0VQT0NIX0ZJRUxEUy5oYXMoZmllbGQpKSAgICByZXR1cm4gJ2Vwb2NoJztcclxuICBpZiAoRFBfREFURV9GSUVMRFMuaGFzKGZpZWxkKSkgICAgIHJldHVybiAnZGF0ZSc7XHJcbiAgcmV0dXJuICd1bmtub3duJztcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGRwRm9ybWF0VmFsdWUoZmllbGQ6IHN0cmluZywgdmFsdWU6IHVua25vd24pOiBzdHJpbmcge1xyXG4gIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSAnJykgcmV0dXJuICdcdTIwMTQnO1xyXG4gIGNvbnN0IHR5cGUgPSBkcENsYXNzaWZ5RmllbGQoZmllbGQpO1xyXG4gIHN3aXRjaCAodHlwZSkge1xyXG4gICAgY2FzZSAncGVyY2VudCc6IHJldHVybiBgJHsoTnVtYmVyKHZhbHVlKSAqIDEwMCkudG9GaXhlZCgyKX0lYDtcclxuICAgIGNhc2UgJ3JhdGUnOiAgICByZXR1cm4gTnVtYmVyKHZhbHVlKS50b0ZpeGVkKDIpO1xyXG4gICAgY2FzZSAnZGF0ZXRpbWUnOlxyXG4gICAgY2FzZSAnZXBvY2gnOiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgbXMgPSB0eXBlID09PSAnZXBvY2gnID8gTnVtYmVyKHZhbHVlKSA6IG5ldyBEYXRlKHZhbHVlIGFzIHN0cmluZykuZ2V0VGltZSgpO1xyXG4gICAgICAgIHJldHVybiBuZXcgRGF0ZShtcykudG9Mb2NhbGVTdHJpbmcodW5kZWZpbmVkLCB7XHJcbiAgICAgICAgICB5ZWFyOiAnbnVtZXJpYycsIG1vbnRoOiAnc2hvcnQnLCBkYXk6ICdudW1lcmljJyxcclxuICAgICAgICAgIGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcsIHNlY29uZDogJzItZGlnaXQnLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIHsgcmV0dXJuIFN0cmluZyh2YWx1ZSk7IH1cclxuICAgIH1cclxuICAgIGNhc2UgJ2RhdGUnOiByZXR1cm4gU3RyaW5nKHZhbHVlKTtcclxuICAgIGNhc2UgJ2ludCc6ICByZXR1cm4gTnVtYmVyKHZhbHVlKS50b0xvY2FsZVN0cmluZygpO1xyXG4gICAgZGVmYXVsdDogICAgIHJldHVybiBTdHJpbmcodmFsdWUpO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGRwUmF0ZUNsYXNzKGZpZWxkOiBzdHJpbmcsIHZhbHVlOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gIGNvbnN0IHYgPSBOdW1iZXIodmFsdWUpO1xyXG4gIGlmIChmaWVsZC5zdGFydHNXaXRoKCdydHNfJykgfHwgZmllbGQuaW5jbHVkZXMoJ21pc3MnKSB8fFxyXG4gICAgICBmaWVsZCA9PT0gJ2N1c3RvbWVyX25vdF9hdmFpbGFibGVfcGVyY2VudCcgfHxcclxuICAgICAgZmllbGQgPT09ICdyZWplY3RlZF9wYWNrYWdlc19wZXJjZW50JyB8fFxyXG4gICAgICBmaWVsZCA9PT0gJ3BheW1lbnRfbm90X3JlYWR5X3BlcmNlbnQnIHx8XHJcbiAgICAgIGZpZWxkID09PSAnYWRkcmVzc19ub3RfZm91bmRfcGVyY2VudCcpIHtcclxuICAgIGlmICh2IDwgMC4wMDUpIHJldHVybiAnZ3JlYXQnO1xyXG4gICAgaWYgKHYgPCAwLjAxKSAgcmV0dXJuICdvayc7XHJcbiAgICByZXR1cm4gJ2JhZCc7XHJcbiAgfVxyXG4gIGlmICh2ID49IDAuOTkpICByZXR1cm4gJ2dyZWF0JztcclxuICBpZiAodiA+PSAwLjk3KSAgcmV0dXJuICdvayc7XHJcbiAgcmV0dXJuICdiYWQnO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZHBWYWxpZGF0ZURhdGVSYW5nZShmcm9tOiBzdHJpbmcsIHRvOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcclxuICBpZiAoIWZyb20gfHwgIXRvKSByZXR1cm4gJ0JvdGggRnJvbSBhbmQgVG8gZGF0ZXMgYXJlIHJlcXVpcmVkLic7XHJcbiAgaWYgKCEvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9JC8udGVzdChmcm9tKSkgcmV0dXJuICdGcm9tIGRhdGUgZm9ybWF0IG11c3QgYmUgWVlZWS1NTS1ERC4nO1xyXG4gIGlmICghL15cXGR7NH0tXFxkezJ9LVxcZHsyfSQvLnRlc3QodG8pKSAgIHJldHVybiAnVG8gZGF0ZSBmb3JtYXQgbXVzdCBiZSBZWVlZLU1NLURELic7XHJcbiAgaWYgKGZyb20gPiB0bykgcmV0dXJuICdGcm9tIGRhdGUgbXVzdCBub3QgYmUgYWZ0ZXIgVG8gZGF0ZS4nO1xyXG4gIHJldHVybiBudWxsO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZHBQYXJzZUFwaVJlc3BvbnNlKGpzb246IHVua25vd24pOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdIHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgdGFibGVEYXRhID0gKGpzb24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pPy5bJ3RhYmxlRGF0YSddIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xyXG4gICAgY29uc3QgZHNxRGF0YSA9IHRhYmxlRGF0YT8uWydkc3BfZGFpbHlfc3VwcGxlbWVudGFsX3F1YWxpdHknXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcclxuICAgIGNvbnN0IHJvd3MgPSBkc3FEYXRhPy5bJ3Jvd3MnXTtcclxuICAgIGlmICghQXJyYXkuaXNBcnJheShyb3dzKSB8fCByb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xyXG4gICAgcmV0dXJuIChyb3dzIGFzIChzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilbXSlcclxuICAgICAgLm1hcChkcFBhcnNlUm93KVxyXG4gICAgICAuc29ydCgoYSwgYikgPT4gKChhWydkYXRhX2RhdGUnXSBhcyBzdHJpbmcpIHx8ICcnKS5sb2NhbGVDb21wYXJlKChiWydkYXRhX2RhdGUnXSBhcyBzdHJpbmcpIHx8ICcnKSk7XHJcbiAgfSBjYXRjaCAoZSkge1xyXG4gICAgZXJyKCdkcFBhcnNlQXBpUmVzcG9uc2UgZXJyb3I6JywgZSk7XHJcbiAgICByZXR1cm4gW107XHJcbiAgfVxyXG59XHJcblxyXG4vLyBcdTI1MDBcdTI1MDAgRGFzaGJvYXJkIGNsYXNzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuZXhwb3J0IGNsYXNzIERlbGl2ZXJ5UGVyZm9ybWFuY2Uge1xyXG4gIHByaXZhdGUgX292ZXJsYXlFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIF9hY3RpdmUgPSBmYWxzZTtcclxuICBwcml2YXRlIF9jYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCB1bmtub3duPigpO1xyXG4gIHByaXZhdGUgX2RlYm91bmNlVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIC8qKiBFeHBvc2UgcHVyZSBoZWxwZXJzIGZvciB0ZXN0aW5nICovXHJcbiAgcmVhZG9ubHkgaGVscGVycyA9IHtcclxuICAgIGRwUGFyc2VSb3csXHJcbiAgICBkcENsYXNzaWZ5RmllbGQsXHJcbiAgICBkcEZvcm1hdFZhbHVlLFxyXG4gICAgZHBSYXRlQ2xhc3MsXHJcbiAgICBkcFZhbGlkYXRlRGF0ZVJhbmdlLFxyXG4gICAgZHBQYXJzZUFwaVJlc3BvbnNlLFxyXG4gIH07XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb25maWc6IEFwcENvbmZpZyxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGFueUNvbmZpZzogQ29tcGFueUNvbmZpZyxcclxuICApIHt9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBMaWZlY3ljbGUgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIGFzeW5jIGluaXQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAodGhpcy5fb3ZlcmxheUVsKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgdG9kYXkgPSB0b2RheVN0cigpO1xyXG4gICAgY29uc3Qgb3ZlcmxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gICAgb3ZlcmxheS5pZCA9ICdjdC1kcC1vdmVybGF5JztcclxuICAgIG92ZXJsYXkuY2xhc3NOYW1lID0gJ2N0LW92ZXJsYXknO1xyXG4gICAgb3ZlcmxheS5zZXRBdHRyaWJ1dGUoJ3JvbGUnLCAnZGlhbG9nJyk7XHJcbiAgICBvdmVybGF5LnNldEF0dHJpYnV0ZSgnYXJpYS1tb2RhbCcsICd0cnVlJyk7XHJcbiAgICBvdmVybGF5LnNldEF0dHJpYnV0ZSgnYXJpYS1sYWJlbCcsICdEYWlseSBEZWxpdmVyeSBQZXJmb3JtYW5jZSBEYXNoYm9hcmQnKTtcclxuICAgIG92ZXJsYXkuaW5uZXJIVE1MID0gYFxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtZHAtcGFuZWxcIj5cclxuICAgICAgICA8aDI+XHVEODNEXHVEQ0U2IERhaWx5IERlbGl2ZXJ5IFBlcmZvcm1hbmNlPC9oMj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtY29udHJvbHNcIj5cclxuICAgICAgICAgIDxsYWJlbCBmb3I9XCJjdC1kcC1kYXRlXCI+RGF0ZTo8L2xhYmVsPlxyXG4gICAgICAgICAgPGlucHV0IHR5cGU9XCJkYXRlXCIgaWQ9XCJjdC1kcC1kYXRlXCIgY2xhc3M9XCJjdC1pbnB1dFwiIHZhbHVlPVwiJHt0b2RheX1cIiBhcmlhLWxhYmVsPVwiU2VsZWN0IGRhdGVcIj5cclxuICAgICAgICAgIDxsYWJlbCBmb3I9XCJjdC1kcC1zYVwiPlNlcnZpY2UgQXJlYTo8L2xhYmVsPlxyXG4gICAgICAgICAgPHNlbGVjdCBpZD1cImN0LWRwLXNhXCIgY2xhc3M9XCJjdC1pbnB1dFwiIGFyaWEtbGFiZWw9XCJTZXJ2aWNlIEFyZWFcIj5cclxuICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cIlwiPldpcmQgZ2VsYWRlblx1MjAyNjwvb3B0aW9uPlxyXG4gICAgICAgICAgPC9zZWxlY3Q+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tYWNjZW50XCIgaWQ9XCJjdC1kcC1nb1wiPlx1RDgzRFx1REQwRCBGZXRjaDwvYnV0dG9uPlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWNsb3NlXCIgaWQ9XCJjdC1kcC1jbG9zZVwiIGFyaWEtbGFiZWw9XCJDbG9zZVwiPlx1MjcxNSBDbG9zZTwvYnV0dG9uPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgaWQ9XCJjdC1kcC1zdGF0dXNcIiBjbGFzcz1cImN0LXN0YXR1c1wiIHJvbGU9XCJzdGF0dXNcIiBhcmlhLWxpdmU9XCJwb2xpdGVcIj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGlkPVwiY3QtZHAtYm9keVwiPjwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgIGA7XHJcblxyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChvdmVybGF5KTtcclxuICAgIHRoaXMuX292ZXJsYXlFbCA9IG92ZXJsYXk7XHJcblxyXG4gICAgb3ZlcmxheS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGlmIChlLnRhcmdldCA9PT0gb3ZlcmxheSkgdGhpcy5oaWRlKCk7IH0pO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRwLWNsb3NlJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5oaWRlKCkpO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRwLWdvJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5fdHJpZ2dlckZldGNoKCkpO1xyXG5cclxuICAgIGNvbnN0IGRlYm91bmNlZCA9ICgoKSA9PiB7XHJcbiAgICAgIGxldCB0OiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PjtcclxuICAgICAgcmV0dXJuICgpID0+IHtcclxuICAgICAgICBjbGVhclRpbWVvdXQodCk7XHJcbiAgICAgICAgdCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5fdHJpZ2dlckZldGNoKCksIDYwMCk7XHJcbiAgICAgIH07XHJcbiAgICB9KSgpO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRwLWRhdGUnKSEuYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgZGVib3VuY2VkKTtcclxuXHJcbiAgICBhd2FpdCB0aGlzLmNvbXBhbnlDb25maWcubG9hZCgpO1xyXG4gICAgdGhpcy5jb21wYW55Q29uZmlnLnBvcHVsYXRlU2FTZWxlY3QoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRwLXNhJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpO1xyXG5cclxuICAgIG9uRGlzcG9zZSgoKSA9PiB0aGlzLmRpc3Bvc2UoKSk7XHJcbiAgICBsb2coJ0RlbGl2ZXJ5IFBlcmZvcm1hbmNlIERhc2hib2FyZCBpbml0aWFsaXplZCcpO1xyXG4gIH1cclxuXHJcbiAgZGlzcG9zZSgpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLl9kZWJvdW5jZVRpbWVyKSBjbGVhclRpbWVvdXQodGhpcy5fZGVib3VuY2VUaW1lcik7XHJcbiAgICB0aGlzLl9vdmVybGF5RWw/LnJlbW92ZSgpOyB0aGlzLl9vdmVybGF5RWwgPSBudWxsO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gZmFsc2U7XHJcbiAgICB0aGlzLl9jYWNoZS5jbGVhcigpO1xyXG4gIH1cclxuXHJcbiAgdG9nZ2xlKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmNvbmZpZy5mZWF0dXJlcy5kZWxpdmVyeVBlcmYpIHtcclxuICAgICAgYWxlcnQoJ0RhaWx5IERlbGl2ZXJ5IFBlcmZvcm1hbmNlIGlzdCBkZWFrdGl2aWVydC4gQml0dGUgaW4gZGVuIEVpbnN0ZWxsdW5nZW4gYWt0aXZpZXJlbi4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdGhpcy5pbml0KCk7XHJcbiAgICBpZiAodGhpcy5fYWN0aXZlKSB0aGlzLmhpZGUoKTsgZWxzZSB0aGlzLnNob3coKTtcclxuICB9XHJcblxyXG4gIHNob3coKTogdm9pZCB7XHJcbiAgICB0aGlzLmluaXQoKTtcclxuICAgIHRoaXMuX292ZXJsYXlFbCEuY2xhc3NMaXN0LmFkZCgndmlzaWJsZScpO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gdHJ1ZTtcclxuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHAtZGF0ZScpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLmZvY3VzKCk7XHJcbiAgfVxyXG5cclxuICBoaWRlKCk6IHZvaWQge1xyXG4gICAgdGhpcy5fb3ZlcmxheUVsPy5jbGFzc0xpc3QucmVtb3ZlKCd2aXNpYmxlJyk7XHJcbiAgICB0aGlzLl9hY3RpdmUgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBBUEkgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX2J1aWxkVXJsKGZyb206IHN0cmluZywgdG86IHN0cmluZywgc3RhdGlvbjogc3RyaW5nLCBkc3A6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICAnaHR0cHM6Ly9sb2dpc3RpY3MuYW1hem9uLmRlL3BlcmZvcm1hbmNlL2FwaS92MS9nZXREYXRhJyArXHJcbiAgICAgIGA/ZGF0YVNldElkPWRzcF9kYWlseV9zdXBwbGVtZW50YWxfcXVhbGl0eWAgK1xyXG4gICAgICBgJmRzcD0ke2VuY29kZVVSSUNvbXBvbmVudChkc3ApfWAgK1xyXG4gICAgICBgJmZyb209JHtlbmNvZGVVUklDb21wb25lbnQoZnJvbSl9YCArXHJcbiAgICAgIGAmc3RhdGlvbj0ke2VuY29kZVVSSUNvbXBvbmVudChzdGF0aW9uKX1gICtcclxuICAgICAgYCZ0aW1lRnJhbWU9RGFpbHlgICtcclxuICAgICAgYCZ0bz0ke2VuY29kZVVSSUNvbXBvbmVudCh0byl9YFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgX2ZldGNoRGF0YShmcm9tOiBzdHJpbmcsIHRvOiBzdHJpbmcsIHN0YXRpb246IHN0cmluZywgZHNwOiBzdHJpbmcpOiBQcm9taXNlPHVua25vd24+IHtcclxuICAgIGNvbnN0IGNhY2hlS2V5ID0gYCR7ZnJvbX18JHt0b318JHtzdGF0aW9ufXwke2RzcH1gO1xyXG4gICAgaWYgKHRoaXMuX2NhY2hlLmhhcyhjYWNoZUtleSkpIHtcclxuICAgICAgbG9nKCdEUCBjYWNoZSBoaXQ6JywgY2FjaGVLZXkpO1xyXG4gICAgICByZXR1cm4gdGhpcy5fY2FjaGUuZ2V0KGNhY2hlS2V5KTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB1cmwgPSB0aGlzLl9idWlsZFVybChmcm9tLCB0bywgc3RhdGlvbiwgZHNwKTtcclxuICAgIGNvbnN0IGNzcmYgPSBnZXRDU1JGVG9rZW4oKTtcclxuICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nIH07XHJcbiAgICBpZiAoY3NyZikgaGVhZGVyc1snYW50aS1jc3JmdG9rZW4tYTJ6J10gPSBjc3JmO1xyXG5cclxuICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB3aXRoUmV0cnkoYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCByID0gYXdhaXQgZmV0Y2godXJsLCB7IG1ldGhvZDogJ0dFVCcsIGhlYWRlcnMsIGNyZWRlbnRpYWxzOiAnaW5jbHVkZScgfSk7XHJcbiAgICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9OiAke3Iuc3RhdHVzVGV4dH1gKTtcclxuICAgICAgcmV0dXJuIHI7XHJcbiAgICB9LCB7IHJldHJpZXM6IDIsIGJhc2VNczogODAwIH0pO1xyXG5cclxuICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXNwLmpzb24oKTtcclxuICAgIHRoaXMuX2NhY2hlLnNldChjYWNoZUtleSwganNvbik7XHJcbiAgICBpZiAodGhpcy5fY2FjaGUuc2l6ZSA+IDUwKSB7XHJcbiAgICAgIGNvbnN0IG9sZGVzdCA9IHRoaXMuX2NhY2hlLmtleXMoKS5uZXh0KCkudmFsdWUgYXMgc3RyaW5nO1xyXG4gICAgICB0aGlzLl9jYWNoZS5kZWxldGUob2xkZXN0KTtcclxuICAgIH1cclxuICAgIHJldHVybiBqc29uO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIFRyaWdnZXIgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgYXN5bmMgX3RyaWdnZXJGZXRjaCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGRhdGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRwLWRhdGUnKSBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZTtcclxuICAgIGlmICghZGF0ZSkgeyB0aGlzLl9zZXRTdGF0dXMoJ1x1MjZBMFx1RkUwRiBQbGVhc2Ugc2VsZWN0IGEgZGF0ZS4nKTsgcmV0dXJuOyB9XHJcblxyXG4gICAgY29uc3Qgc2FTZWxlY3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHAtc2EnKSBhcyBIVE1MU2VsZWN0RWxlbWVudDtcclxuICAgIGNvbnN0IHN0YXRpb24gPSBzYVNlbGVjdC5vcHRpb25zW3NhU2VsZWN0LnNlbGVjdGVkSW5kZXhdPy50ZXh0Q29udGVudD8udHJpbSgpLnRvVXBwZXJDYXNlKClcclxuICAgICAgICAgICAgICAgICAgfHwgdGhpcy5jb21wYW55Q29uZmlnLmdldERlZmF1bHRTdGF0aW9uKCk7XHJcbiAgICBjb25zdCBkc3AgPSB0aGlzLmNvbXBhbnlDb25maWcuZ2V0RHNwQ29kZSgpO1xyXG5cclxuICAgIHRoaXMuX3NldFN0YXR1cygnXHUyM0YzIExvYWRpbmdcdTIwMjYnKTtcclxuICAgIHRoaXMuX3NldEJvZHkoJzxkaXYgY2xhc3M9XCJjdC1kcC1sb2FkaW5nXCIgcm9sZT1cInN0YXR1c1wiPkZldGNoaW5nIGRhdGFcdTIwMjY8L2Rpdj4nKTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBqc29uID0gYXdhaXQgdGhpcy5fZmV0Y2hEYXRhKGRhdGUsIGRhdGUsIHN0YXRpb24sIGRzcCk7XHJcbiAgICAgIGNvbnN0IHJlY29yZHMgPSBkcFBhcnNlQXBpUmVzcG9uc2UoanNvbik7XHJcbiAgICAgIGlmIChyZWNvcmRzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHRoaXMuX3NldEJvZHkoJzxkaXYgY2xhc3M9XCJjdC1kcC1lbXB0eVwiPk5vIGRhdGEgcmV0dXJuZWQgZm9yIHRoZSBzZWxlY3RlZCBkYXRlLjwvZGl2PicpO1xyXG4gICAgICAgIHRoaXMuX3NldFN0YXR1cygnXHUyNkEwXHVGRTBGIE5vIHJlY29yZHMgZm91bmQuJyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIHRoaXMuX3NldEJvZHkodGhpcy5fcmVuZGVyQWxsKHJlY29yZHMpKTtcclxuICAgICAgdGhpcy5fc2V0U3RhdHVzKGBcdTI3MDUgJHtyZWNvcmRzLmxlbmd0aH0gcmVjb3JkKHMpIGxvYWRlZCBcdTIwMTQgJHtkYXRlfWApO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBlcnIoJ0RlbGl2ZXJ5IHBlcmYgZmV0Y2ggZmFpbGVkOicsIGUpO1xyXG4gICAgICB0aGlzLl9zZXRCb2R5KGA8ZGl2IGNsYXNzPVwiY3QtZHAtZXJyb3JcIj5cdTI3NEMgJHtlc2MoKGUgYXMgRXJyb3IpLm1lc3NhZ2UpfTwvZGl2PmApO1xyXG4gICAgICB0aGlzLl9zZXRTdGF0dXMoJ1x1Mjc0QyBGYWlsZWQgdG8gbG9hZCBkYXRhLicpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIEhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX3NldFN0YXR1cyhtc2c6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHAtc3RhdHVzJyk7XHJcbiAgICBpZiAoZWwpIGVsLnRleHRDb250ZW50ID0gbXNnO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfc2V0Qm9keShodG1sOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWRwLWJvZHknKTtcclxuICAgIGlmIChlbCkgZWwuaW5uZXJIVE1MID0gaHRtbDtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBSZW5kZXJpbmcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX3JlbmRlckFsbChyZWNvcmRzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGJhZGdlc0h0bWwgPSB0aGlzLl9yZW5kZXJCYWRnZXMocmVjb3Jkc1swXSk7XHJcbiAgICBjb25zdCByZWNvcmRzSHRtbCA9IHJlY29yZHMubWFwKChyKSA9PiB0aGlzLl9yZW5kZXJSZWNvcmQocikpLmpvaW4oJycpO1xyXG4gICAgcmV0dXJuIGJhZGdlc0h0bWwgKyByZWNvcmRzSHRtbDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX3JlbmRlckJhZGdlcyhyZWNvcmQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGJhZGdlczogc3RyaW5nW10gPSBbXTtcclxuICAgIGZvciAoY29uc3QgZmllbGQgb2YgRFBfU1RSSU5HX0ZJRUxEUykge1xyXG4gICAgICBjb25zdCB2YWwgPSByZWNvcmRbZmllbGRdO1xyXG4gICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsIHx8IHZhbCA9PT0gJycpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBsYWJlbCA9IERQX0xBQkVMU1tmaWVsZF0gfHwgZmllbGQ7XHJcbiAgICAgIGJhZGdlcy5wdXNoKFxyXG4gICAgICAgIGA8c3BhbiBjbGFzcz1cImN0LWRwLWJhZGdlXCIgdGl0bGU9XCIke2VzYyhmaWVsZCl9XCI+JHtlc2MobGFiZWwpfTxzcGFuPiR7ZXNjKFN0cmluZyh2YWwpKX08L3NwYW4+PC9zcGFuPmAsXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgICBpZiAoIWJhZGdlcy5sZW5ndGgpIHJldHVybiAnJztcclxuICAgIHJldHVybiBgPGRpdiBjbGFzcz1cImN0LWRwLWJhZGdlc1wiIGFyaWEtbGFiZWw9XCJJZGVudGlmaWVyc1wiPiR7YmFkZ2VzLmpvaW4oJycpfTwvZGl2PmA7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9yZW5kZXJSZWNvcmQocmVjb3JkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHN0cmluZyB7XHJcbiAgICBjb25zdCBkYXRlTGFiZWwgPSBlc2MoU3RyaW5nKHJlY29yZFsnZGF0YV9kYXRlJ10gfHwgJ1Vua25vd24gZGF0ZScpKTtcclxuICAgIHJldHVybiBgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1kcC1yZWNvcmRcIj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtZHAtcmVjb3JkLWhlYWRlclwiPlx1RDgzRFx1RENDNSAke2RhdGVMYWJlbH08L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtZHAtcmVjb3JkLWJvZHlcIj5cclxuICAgICAgICAgICR7dGhpcy5fcmVuZGVyS2V5VGlsZXMocmVjb3JkKX1cclxuICAgICAgICAgICR7dGhpcy5fcmVuZGVyQ291bnRzKHJlY29yZCl9XHJcbiAgICAgICAgICAke3RoaXMuX3JlbmRlclJhdGVzKHJlY29yZCl9XHJcbiAgICAgICAgICAke3RoaXMuX3JlbmRlclRpbWVzdGFtcHMocmVjb3JkKX1cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgPC9kaXY+YDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX3JlbmRlcktleVRpbGVzKHJlY29yZDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmcge1xyXG4gICAgY29uc3QgS0VZX1RJTEVTID0gW1xyXG4gICAgICB7IGZpZWxkOiAnZGVsaXZlcmVkJywgICAgICAgIGxhYmVsOiAnRGVsaXZlcmVkJywgICAgICAgIHBjdDogZmFsc2UgfSxcclxuICAgICAgeyBmaWVsZDogJ2Rpc3BhdGNoZWQnLCAgICAgICBsYWJlbDogJ0Rpc3BhdGNoZWQnLCAgICAgICBwY3Q6IGZhbHNlIH0sXHJcbiAgICAgIHsgZmllbGQ6ICdjb21wbGV0ZWRfcm91dGVzJywgbGFiZWw6ICdSb3V0ZXMnLCAgICAgICAgICAgcGN0OiBmYWxzZSB9LFxyXG4gICAgICB7IGZpZWxkOiAnZGVsaXZlcnlfc3VjY2VzcycsIGxhYmVsOiAnRGVsaXZlcnkgU3VjY2VzcycsIHBjdDogdHJ1ZSAgfSxcclxuICAgICAgeyBmaWVsZDogJ3BvZF9zdWNjZXNzX3JhdGUnLCBsYWJlbDogJ1BPRCBSYXRlJywgICAgICAgICBwY3Q6IHRydWUgIH0sXHJcbiAgICBdO1xyXG4gICAgY29uc3QgdGlsZXMgPSBLRVlfVElMRVMubWFwKCh7IGZpZWxkLCBsYWJlbCwgcGN0IH0pID0+IHtcclxuICAgICAgY29uc3QgdmFsID0gcmVjb3JkW2ZpZWxkXTtcclxuICAgICAgaWYgKHZhbCA9PT0gdW5kZWZpbmVkIHx8IHZhbCA9PT0gbnVsbCkgcmV0dXJuICcnO1xyXG4gICAgICBsZXQgZGlzcGxheVZhbDogc3RyaW5nLCBjbHMgPSAnJztcclxuICAgICAgaWYgKHBjdCkge1xyXG4gICAgICAgIGNvbnN0IG4gPSBOdW1iZXIodmFsKTtcclxuICAgICAgICBkaXNwbGF5VmFsID0gYCR7KG4gKiAxMDApLnRvRml4ZWQoMSl9JWA7XHJcbiAgICAgICAgY29uc3QgcmMgPSBkcFJhdGVDbGFzcyhmaWVsZCwgbik7XHJcbiAgICAgICAgY2xzID0gcmMgPT09ICdncmVhdCcgPyAnY3QtZHAtdGlsZS0tc3VjY2VzcycgOiByYyA9PT0gJ29rJyA/ICdjdC1kcC10aWxlLS13YXJuJyA6ICdjdC1kcC10aWxlLS1kYW5nZXInO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGRpc3BsYXlWYWwgPSBOdW1iZXIodmFsKS50b0xvY2FsZVN0cmluZygpO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBgPGRpdiBjbGFzcz1cImN0LWRwLXRpbGUgJHtjbHN9XCI+PGRpdiBjbGFzcz1cImN0LWRwLXRpbGUtdmFsXCI+JHtlc2MoZGlzcGxheVZhbCl9PC9kaXY+PGRpdiBjbGFzcz1cImN0LWRwLXRpbGUtbGJsXCI+JHtlc2MobGFiZWwpfTwvZGl2PjwvZGl2PmA7XHJcbiAgICB9KS5qb2luKCcnKTtcclxuICAgIHJldHVybiBgPGRpdiBjbGFzcz1cImN0LWRwLWZ1bGwtY29sXCI+PGRpdiBjbGFzcz1cImN0LWRwLXRpbGVzXCI+JHt0aWxlc308L2Rpdj48L2Rpdj5gO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfcmVuZGVyQ291bnRzKHJlY29yZDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmcge1xyXG4gICAgY29uc3Qgcm93czogc3RyaW5nW10gPSBbXTtcclxuICAgIGZvciAoY29uc3QgZmllbGQgb2YgRFBfSU5UX0ZJRUxEUykge1xyXG4gICAgICBjb25zdCB2YWwgPSByZWNvcmRbZmllbGRdO1xyXG4gICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSBjb250aW51ZTtcclxuICAgICAgY29uc3QgbGFiZWwgPSBEUF9MQUJFTFNbZmllbGRdIHx8IGZpZWxkO1xyXG4gICAgICByb3dzLnB1c2goYDx0cj48dGQ+JHtlc2MobGFiZWwpfTwvdGQ+PHRkPiR7ZXNjKE51bWJlcih2YWwpLnRvTG9jYWxlU3RyaW5nKCkpfTwvdGQ+PC90cj5gKTtcclxuICAgIH1cclxuICAgIGlmICghcm93cy5sZW5ndGgpIHJldHVybiAnJztcclxuICAgIHJldHVybiBgPGRpdj5cclxuICAgICAgPHAgY2xhc3M9XCJjdC1kcC1zZWN0aW9uLXRpdGxlXCI+Q291bnRzPC9wPlxyXG4gICAgICA8dGFibGUgY2xhc3M9XCJjdC1kcC1jb3VudC10YWJsZVwiIGFyaWEtbGFiZWw9XCJDb3VudCBtZXRyaWNzXCI+XHJcbiAgICAgICAgPHRib2R5PiR7cm93cy5qb2luKCcnKX08L3Rib2R5PlxyXG4gICAgICA8L3RhYmxlPlxyXG4gICAgPC9kaXY+YDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX3JlbmRlclJhdGVzKHJlY29yZDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBzdHJpbmcge1xyXG4gICAgY29uc3QgcGN0Um93czogc3RyaW5nW10gPSBbXTtcclxuICAgIGZvciAoY29uc3QgZmllbGQgb2YgRFBfUEVSQ0VOVF9GSUVMRFMpIHtcclxuICAgICAgY29uc3QgdmFsID0gcmVjb3JkW2ZpZWxkXTtcclxuICAgICAgaWYgKHZhbCA9PT0gdW5kZWZpbmVkIHx8IHZhbCA9PT0gbnVsbCkgY29udGludWU7XHJcbiAgICAgIGNvbnN0IG4gPSBOdW1iZXIodmFsKTtcclxuICAgICAgY29uc3QgcmMgPSBkcFJhdGVDbGFzcyhmaWVsZCwgbik7XHJcbiAgICAgIGNvbnN0IGJhcldpZHRoID0gTWF0aC5taW4oMTAwLCBNYXRoLnJvdW5kKG4gKiAxMDApKTtcclxuICAgICAgY29uc3QgbGFiZWwgPSBEUF9MQUJFTFNbZmllbGRdIHx8IGZpZWxkO1xyXG4gICAgICBwY3RSb3dzLnB1c2goYFxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJjdC1kcC1yYXRlLXJvd1wiIHJvbGU9XCJsaXN0aXRlbVwiPlxyXG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1kcC1yYXRlLWxhYmVsXCI+JHtlc2MobGFiZWwpfTwvc3Bhbj5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJjdC1kcC1yYXRlLWJhci13cmFwXCIgYXJpYS1oaWRkZW49XCJ0cnVlXCI+XHJcbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJjdC1kcC1yYXRlLWJhciBjdC1kcC1yYXRlLS1iYXItLSR7cmN9XCIgc3R5bGU9XCJ3aWR0aDoke2JhcldpZHRofSVcIj48L2Rpdj5cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1kcC1yYXRlLXZhbHVlIGN0LWRwLXJhdGUtLSR7cmN9XCI+JHsobiAqIDEwMCkudG9GaXhlZCgyKX0lPC9zcGFuPlxyXG4gICAgICAgIDwvZGl2PmApO1xyXG4gICAgfVxyXG4gICAgZm9yIChjb25zdCBmaWVsZCBvZiBEUF9SQVRFX0ZJRUxEUykge1xyXG4gICAgICBjb25zdCB2YWwgPSByZWNvcmRbZmllbGRdO1xyXG4gICAgICBpZiAodmFsID09PSB1bmRlZmluZWQgfHwgdmFsID09PSBudWxsKSBjb250aW51ZTtcclxuICAgICAgY29uc3QgbGFiZWwgPSBEUF9MQUJFTFNbZmllbGRdIHx8IGZpZWxkO1xyXG4gICAgICBwY3RSb3dzLnB1c2goYFxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJjdC1kcC1yYXRlLXJvd1wiIHJvbGU9XCJsaXN0aXRlbVwiPlxyXG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1kcC1yYXRlLWxhYmVsXCI+JHtlc2MobGFiZWwpfTwvc3Bhbj5cclxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwiY3QtZHAtcmF0ZS12YWx1ZSBjdC1kcC1yYXRlLS1uZXV0cmFsXCI+JHtOdW1iZXIodmFsKS50b0ZpeGVkKDIpfTwvc3Bhbj5cclxuICAgICAgICA8L2Rpdj5gKTtcclxuICAgIH1cclxuICAgIGlmICghcGN0Um93cy5sZW5ndGgpIHJldHVybiAnJztcclxuICAgIHJldHVybiBgPGRpdj5cclxuICAgICAgPHAgY2xhc3M9XCJjdC1kcC1zZWN0aW9uLXRpdGxlXCI+UmF0ZXMgJmFtcDsgUGVyY2VudGFnZXM8L3A+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1kcC1yYXRlc1wiIHJvbGU9XCJsaXN0XCI+JHtwY3RSb3dzLmpvaW4oJycpfTwvZGl2PlxyXG4gICAgPC9kaXY+YDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX3JlbmRlclRpbWVzdGFtcHMocmVjb3JkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHN0cmluZyB7XHJcbiAgICBjb25zdCBpdGVtczogc3RyaW5nW10gPSBbXTtcclxuICAgIGlmIChyZWNvcmRbJ2RhdGFfZGF0ZSddKSB7XHJcbiAgICAgIGl0ZW1zLnB1c2goYDxkaXYgY2xhc3M9XCJjdC1kcC10cy1pdGVtXCI+XHJcbiAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1kcC10cy1sYWJlbFwiPkRhdGEgRGF0ZTwvc3Bhbj5cclxuICAgICAgICA8c3BhbiBjbGFzcz1cImN0LWRwLXRzLXZhbFwiPiR7ZXNjKFN0cmluZyhyZWNvcmRbJ2RhdGFfZGF0ZSddKSl9PC9zcGFuPlxyXG4gICAgICA8L2Rpdj5gKTtcclxuICAgIH1cclxuICAgIGlmIChyZWNvcmRbJ2xhc3RfdXBkYXRlZF90aW1lJ10pIHtcclxuICAgICAgaXRlbXMucHVzaChgPGRpdiBjbGFzcz1cImN0LWRwLXRzLWl0ZW1cIj5cclxuICAgICAgICA8c3BhbiBjbGFzcz1cImN0LWRwLXRzLWxhYmVsXCI+TGFzdCBVcGRhdGVkPC9zcGFuPlxyXG4gICAgICAgIDxzcGFuIGNsYXNzPVwiY3QtZHAtdHMtdmFsXCI+JHtlc2MoZHBGb3JtYXRWYWx1ZSgnbGFzdF91cGRhdGVkX3RpbWUnLCByZWNvcmRbJ2xhc3RfdXBkYXRlZF90aW1lJ10pKX08L3NwYW4+XHJcbiAgICAgIDwvZGl2PmApO1xyXG4gICAgfVxyXG4gICAgaWYgKHJlY29yZFsnbWVzc2FnZVRpbWVzdGFtcCddICE9PSB1bmRlZmluZWQgJiYgcmVjb3JkWydtZXNzYWdlVGltZXN0YW1wJ10gIT09IG51bGwpIHtcclxuICAgICAgaXRlbXMucHVzaChgPGRpdiBjbGFzcz1cImN0LWRwLXRzLWl0ZW1cIj5cclxuICAgICAgICA8c3BhbiBjbGFzcz1cImN0LWRwLXRzLWxhYmVsXCI+TWVzc2FnZSBUaW1lc3RhbXA8L3NwYW4+XHJcbiAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1kcC10cy12YWxcIj4ke2VzYyhkcEZvcm1hdFZhbHVlKCdtZXNzYWdlVGltZXN0YW1wJywgcmVjb3JkWydtZXNzYWdlVGltZXN0YW1wJ10pKX08L3NwYW4+XHJcbiAgICAgIDwvZGl2PmApO1xyXG4gICAgfVxyXG4gICAgaWYgKCFpdGVtcy5sZW5ndGgpIHJldHVybiAnJztcclxuICAgIHJldHVybiBgPGRpdiBjbGFzcz1cImN0LWRwLWZ1bGwtY29sXCI+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1kcC10cy1yb3dcIiBhcmlhLWxhYmVsPVwiVGltZXN0YW1wc1wiPiR7aXRlbXMuam9pbignJyl9PC9kaXY+XHJcbiAgICA8L2Rpdj5gO1xyXG4gIH1cclxufVxyXG4iLCAiLy8gZmVhdHVyZXMvZHZpYy1jaGVjay50cyBcdTIwMTMgRFZJQyAoRGFpbHkgVmVoaWNsZSBJbnNwZWN0aW9uIENoZWNrKSBEYXNoYm9hcmRcclxuXHJcbmltcG9ydCB7IGxvZywgZXJyLCBlc2MsIHdpdGhSZXRyeSwgZ2V0Q1NSRlRva2VuLCBhZGREYXlzIH0gZnJvbSAnLi4vY29yZS91dGlscyc7XHJcbmltcG9ydCB7IG9uRGlzcG9zZSB9IGZyb20gJy4uL2NvcmUvdXRpbHMnO1xyXG5pbXBvcnQgdHlwZSB7IEFwcENvbmZpZyB9IGZyb20gJy4uL2NvcmUvc3RvcmFnZSc7XHJcbmltcG9ydCB0eXBlIHsgQXBwQ29uZmlnIGFzIEFwcENvbmZpZ1R5cGUgfSBmcm9tICcuLi9jb3JlL3N0b3JhZ2UnO1xyXG5pbXBvcnQgeyBzZXRDb25maWcgfSBmcm9tICcuLi9jb3JlL3N0b3JhZ2UnO1xyXG5pbXBvcnQgdHlwZSB7IENvbXBhbnlDb25maWcgfSBmcm9tICcuLi9jb3JlL2FwaSc7XHJcblxyXG5pbnRlcmZhY2UgVmVoaWNsZVJlY29yZCB7XHJcbiAgdmVoaWNsZUlkZW50aWZpZXI6IHN0cmluZztcclxuICBwcmVUcmlwVG90YWw6IG51bWJlcjtcclxuICBwb3N0VHJpcFRvdGFsOiBudW1iZXI7XHJcbiAgbWlzc2luZ0NvdW50OiBudW1iZXI7XHJcbiAgc3RhdHVzOiBzdHJpbmc7XHJcbiAgaW5zcGVjdGVkQXQ6IHN0cmluZyB8IG51bGw7XHJcbiAgc2hpZnREYXRlOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlcG9ydGVySWRzOiBzdHJpbmdbXTtcclxuICByZXBvcnRlck5hbWVzOiBzdHJpbmdbXTtcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIER2aWNDaGVjayB7XHJcbiAgcHJpdmF0ZSBfb3ZlcmxheUVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgX2FjdGl2ZSA9IGZhbHNlO1xyXG4gIHByaXZhdGUgX3ZlaGljbGVzOiBWZWhpY2xlUmVjb3JkW10gPSBbXTtcclxuICBwcml2YXRlIF9uYW1lQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xyXG4gIHByaXZhdGUgX2xhc3RUaW1lc3RhbXA6IG51bWJlciB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgX2xvYWRpbmcgPSBmYWxzZTtcclxuICBwcml2YXRlIF9wYWdlU2l6ZSA9IDI1O1xyXG4gIHByaXZhdGUgX3BhZ2VDdXJyZW50ID0gMTtcclxuICBwcml2YXRlIF9wYWdlTWlzc2luZyA9IDE7XHJcbiAgcHJpdmF0ZSBfY3VycmVudFRhYjogJ2FsbCcgfCAnbWlzc2luZycgPSAnYWxsJztcclxuXHJcbiAgZ2V0IF9zaG93VHJhbnNwb3J0ZXJzKCk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmZlYXR1cmVzLmR2aWNTaG93VHJhbnNwb3J0ZXJzICE9PSBmYWxzZTtcclxuICB9XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb25maWc6IEFwcENvbmZpZyxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGFueUNvbmZpZzogQ29tcGFueUNvbmZpZyxcclxuICApIHt9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBMaWZlY3ljbGUgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIGluaXQoKTogdm9pZCB7XHJcbiAgICBpZiAodGhpcy5fb3ZlcmxheUVsKSByZXR1cm47XHJcblxyXG4gICAgY29uc3Qgb3ZlcmxheSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gICAgb3ZlcmxheS5pZCA9ICdjdC1kdmljLW92ZXJsYXknO1xyXG4gICAgb3ZlcmxheS5jbGFzc05hbWUgPSAnY3Qtb3ZlcmxheSc7XHJcbiAgICBvdmVybGF5LnNldEF0dHJpYnV0ZSgncm9sZScsICdkaWFsb2cnKTtcclxuICAgIG92ZXJsYXkuc2V0QXR0cmlidXRlKCdhcmlhLW1vZGFsJywgJ3RydWUnKTtcclxuICAgIG92ZXJsYXkuc2V0QXR0cmlidXRlKCdhcmlhLWxhYmVsJywgJ0RWSUMgQ2hlY2snKTtcclxuICAgIG92ZXJsYXkuaW5uZXJIVE1MID0gYFxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtZHZpYy1wYW5lbFwiPlxyXG4gICAgICAgIDxkaXYgc3R5bGU9XCJkaXNwbGF5OmZsZXg7YWxpZ24taXRlbXM6Y2VudGVyO2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO21hcmdpbi1ib3R0b206MTZweDtcIj5cclxuICAgICAgICAgIDxkaXY+XHJcbiAgICAgICAgICAgIDxoMj5cdUQ4M0RcdURFOUIgRFZJQyBDaGVjazwvaDI+XHJcbiAgICAgICAgICAgIDxkaXYgaWQ9XCJjdC1kdmljLWFzb2ZcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLWN0LW11dGVkKTttYXJnaW4tdG9wOjJweDtcIj48L2Rpdj5cclxuICAgICAgICAgIDwvZGl2PlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWNsb3NlXCIgaWQ9XCJjdC1kdmljLWNsb3NlXCIgYXJpYS1sYWJlbD1cIlNjaGxpZVx1MDBERmVuXCI+XHUyNzE1IFNjaGxpZVx1MDBERmVuPC9idXR0b24+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBpZD1cImN0LWR2aWMtc3RhdHVzXCIgY2xhc3M9XCJjdC1zdGF0dXNcIiByb2xlPVwic3RhdHVzXCIgYXJpYS1saXZlPVwicG9saXRlXCI+PC9kaXY+XHJcbiAgICAgICAgPGRpdiBpZD1cImN0LWR2aWMtdGlsZXNcIj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtZHZpYy10YWJzXCIgcm9sZT1cInRhYmxpc3RcIj5cclxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1kdmljLXRhYiBjdC1kdmljLXRhYi0tYWN0aXZlXCIgZGF0YS10YWI9XCJhbGxcIiByb2xlPVwidGFiXCJcclxuICAgICAgICAgICAgICAgICAgYXJpYS1zZWxlY3RlZD1cInRydWVcIiBpZD1cImN0LWR2aWMtdGFiLWFsbFwiPkFsbGUgRmFocnpldWdlPC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtZHZpYy10YWJcIiBkYXRhLXRhYj1cIm1pc3NpbmdcIiByb2xlPVwidGFiXCJcclxuICAgICAgICAgICAgICAgICAgYXJpYS1zZWxlY3RlZD1cImZhbHNlXCIgaWQ9XCJjdC1kdmljLXRhYi1taXNzaW5nXCI+XHUyNkEwXHVGRTBGIERWSUMgRmVobGVuZDwvYnV0dG9uPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgaWQ9XCJjdC1kdmljLWJvZHlcIj48L2Rpdj5cclxuICAgICAgPC9kaXY+XHJcbiAgICBgO1xyXG5cclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQob3ZlcmxheSk7XHJcbiAgICB0aGlzLl9vdmVybGF5RWwgPSBvdmVybGF5O1xyXG5cclxuICAgIG92ZXJsYXkuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4geyBpZiAoZS50YXJnZXQgPT09IG92ZXJsYXkpIHRoaXMuaGlkZSgpOyB9KTtcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kdmljLWNsb3NlJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5oaWRlKCkpO1xyXG5cclxuICAgIG92ZXJsYXkucXVlcnlTZWxlY3RvcignLmN0LWR2aWMtdGFicycpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJ0biA9IChlLnRhcmdldCBhcyBFbGVtZW50KS5jbG9zZXN0KCcuY3QtZHZpYy10YWInKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XHJcbiAgICAgIGlmICghYnRuKSByZXR1cm47XHJcbiAgICAgIHRoaXMuX3N3aXRjaFRhYihidG4uZGF0YXNldFsndGFiJ10gYXMgJ2FsbCcgfCAnbWlzc2luZycpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgb25EaXNwb3NlKCgpID0+IHRoaXMuZGlzcG9zZSgpKTtcclxuICAgIGxvZygnRFZJQyBDaGVjayBpbml0aWFsaXplZCcpO1xyXG4gIH1cclxuXHJcbiAgZGlzcG9zZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuX292ZXJsYXlFbD8ucmVtb3ZlKCk7IHRoaXMuX292ZXJsYXlFbCA9IG51bGw7XHJcbiAgICB0aGlzLl92ZWhpY2xlcyA9IFtdO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gZmFsc2U7XHJcbiAgICB0aGlzLl9sYXN0VGltZXN0YW1wID0gbnVsbDtcclxuICAgIHRoaXMuX2xvYWRpbmcgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIHRvZ2dsZSgpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5jb25maWcuZmVhdHVyZXMuZHZpY0NoZWNrKSB7XHJcbiAgICAgIGFsZXJ0KCdEVklDIENoZWNrIGlzdCBkZWFrdGl2aWVydC4gQml0dGUgaW4gZGVuIEVpbnN0ZWxsdW5nZW4gYWt0aXZpZXJlbi4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdGhpcy5pbml0KCk7XHJcbiAgICBpZiAodGhpcy5fYWN0aXZlKSB0aGlzLmhpZGUoKTsgZWxzZSB0aGlzLnNob3coKTtcclxuICB9XHJcblxyXG4gIHNob3coKTogdm9pZCB7XHJcbiAgICB0aGlzLmluaXQoKTtcclxuICAgIHRoaXMuX292ZXJsYXlFbCEuY2xhc3NMaXN0LmFkZCgndmlzaWJsZScpO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gdHJ1ZTtcclxuICAgIHRoaXMuX3BhZ2VDdXJyZW50ID0gMTtcclxuICAgIHRoaXMuX3BhZ2VNaXNzaW5nID0gMTtcclxuICAgIHRoaXMuX2N1cnJlbnRUYWIgPSAnYWxsJztcclxuICAgIHRoaXMuX3N3aXRjaFRhYignYWxsJyk7XHJcbiAgICB0aGlzLl9yZWZyZXNoKCk7XHJcbiAgfVxyXG5cclxuICBoaWRlKCk6IHZvaWQge1xyXG4gICAgdGhpcy5fb3ZlcmxheUVsPy5jbGFzc0xpc3QucmVtb3ZlKCd2aXNpYmxlJyk7XHJcbiAgICB0aGlzLl9hY3RpdmUgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBUYWIgbWFuYWdlbWVudCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgcHJpdmF0ZSBfc3dpdGNoVGFiKHRhYjogJ2FsbCcgfCAnbWlzc2luZycpOiB2b2lkIHtcclxuICAgIHRoaXMuX2N1cnJlbnRUYWIgPSB0YWI7XHJcbiAgICB0aGlzLl9vdmVybGF5RWw/LnF1ZXJ5U2VsZWN0b3JBbGwoJy5jdC1kdmljLXRhYicpLmZvckVhY2goKGJ0bikgPT4ge1xyXG4gICAgICBjb25zdCBhY3RpdmUgPSAoYnRuIGFzIEhUTUxFbGVtZW50KS5kYXRhc2V0Wyd0YWInXSA9PT0gdGFiO1xyXG4gICAgICBidG4uY2xhc3NMaXN0LnRvZ2dsZSgnY3QtZHZpYy10YWItLWFjdGl2ZScsIGFjdGl2ZSk7XHJcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoJ2FyaWEtc2VsZWN0ZWQnLCBTdHJpbmcoYWN0aXZlKSk7XHJcbiAgICB9KTtcclxuICAgIGlmICh0aGlzLl92ZWhpY2xlcy5sZW5ndGggPiAwKSB0aGlzLl9yZW5kZXJCb2R5KCk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgVGltZXN0YW1wIGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX2dldFRvZGF5QnJlbWVuVGltZXN0YW1wKCk6IG51bWJlciB7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xyXG4gICAgY29uc3QgZGF0ZVN0ciA9IG5vdy50b0xvY2FsZURhdGVTdHJpbmcoJ3N2JywgeyB0aW1lWm9uZTogJ0V1cm9wZS9CZXJsaW4nIH0pO1xyXG4gICAgY29uc3QgW3ksIG1vLCBkXSA9IGRhdGVTdHIuc3BsaXQoJy0nKS5tYXAoTnVtYmVyKTtcclxuICAgIGNvbnN0IHV0Y1JlZiA9IG5ldyBEYXRlKERhdGUuVVRDKHksIG1vIC0gMSwgZCwgNiwgMCwgMCkpO1xyXG4gICAgY29uc3QgcGFydHMgPSBuZXcgSW50bC5EYXRlVGltZUZvcm1hdCgnZW4tVVMnLCB7XHJcbiAgICAgIHRpbWVab25lOiAnRXVyb3BlL0JlcmxpbicsIGhvdXI6ICdudW1lcmljJywgbWludXRlOiAnbnVtZXJpYycsIGhvdXIxMjogZmFsc2UsXHJcbiAgICB9KS5mb3JtYXRUb1BhcnRzKHV0Y1JlZik7XHJcbiAgICBjb25zdCBiZXJsaW5IID0gcGFyc2VJbnQocGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAnaG91cicpIS52YWx1ZSwgMTApICUgMjQ7XHJcbiAgICBjb25zdCBiZXJsaW5NID0gcGFyc2VJbnQocGFydHMuZmluZCgocCkgPT4gcC50eXBlID09PSAnbWludXRlJykhLnZhbHVlLCAxMCk7XHJcbiAgICBjb25zdCBvZmZzZXRNaW51dGVzID0gKGJlcmxpbkggKiA2MCArIGJlcmxpbk0pIC0gNiAqIDYwO1xyXG4gICAgcmV0dXJuIERhdGUuVVRDKHksIG1vIC0gMSwgZCkgLSBvZmZzZXRNaW51dGVzICogNjAwMDA7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgQVBJIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIGFzeW5jIF9mZXRjaEluc3BlY3Rpb25TdGF0cyh0aW1lc3RhbXA6IG51bWJlcik6IFByb21pc2U8dW5rbm93bj4ge1xyXG4gICAgY29uc3QgdXJsID0gYGh0dHBzOi8vbG9naXN0aWNzLmFtYXpvbi5kZS9mbGVldC1tYW5hZ2VtZW50L2FwaS9pbnNwZWN0aW9uLXN0YXRzP3N0YXJ0VGltZXN0YW1wPSR7dGltZXN0YW1wfWA7XHJcbiAgICBjb25zdCBjc3JmID0gZ2V0Q1NSRlRva2VuKCk7XHJcbiAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0geyBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uJyB9O1xyXG4gICAgaWYgKGNzcmYpIGhlYWRlcnNbJ2FudGktY3NyZnRva2VuLWEyeiddID0gY3NyZjtcclxuXHJcbiAgICBjb25zdCByZXNwID0gYXdhaXQgd2l0aFJldHJ5KGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgciA9IGF3YWl0IGZldGNoKHVybCwgeyBtZXRob2Q6ICdHRVQnLCBoZWFkZXJzLCBjcmVkZW50aWFsczogJ2luY2x1ZGUnIH0pO1xyXG4gICAgICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcihgSFRUUCAke3Iuc3RhdHVzfTogJHtyLnN0YXR1c1RleHR9YCk7XHJcbiAgICAgIHJldHVybiByO1xyXG4gICAgfSwgeyByZXRyaWVzOiAyLCBiYXNlTXM6IDgwMCB9KTtcclxuXHJcbiAgICByZXR1cm4gcmVzcC5qc29uKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIF9nZXRFbXBsb3llZU5hbWVzKHJlcG9ydGVySWRzOiBzdHJpbmdbXSk6IFByb21pc2U8TWFwPHN0cmluZywgc3RyaW5nPj4ge1xyXG4gICAgY29uc3QgdW5pcXVlID0gWy4uLm5ldyBTZXQocmVwb3J0ZXJJZHMpXTtcclxuICAgIGNvbnN0IHVuY2FjaGVkID0gdW5pcXVlLmZpbHRlcigoaWQpID0+ICF0aGlzLl9uYW1lQ2FjaGUuaGFzKGlkKSk7XHJcblxyXG4gICAgaWYgKHVuY2FjaGVkLmxlbmd0aCA+IDApIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBzYUlkID0gdGhpcy5jb21wYW55Q29uZmlnLmdldERlZmF1bHRTZXJ2aWNlQXJlYUlkKCk7XHJcbiAgICAgICAgY29uc3QgdG9kYXkgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXTtcclxuICAgICAgICBjb25zdCBmcm9tRGF0ZSA9IGFkZERheXModG9kYXksIC0zMCk7XHJcbiAgICAgICAgY29uc3QgdXJsID0gYGh0dHBzOi8vbG9naXN0aWNzLmFtYXpvbi5kZS9zY2hlZHVsaW5nL2hvbWUvYXBpL3YyL3Jvc3RlcnM/ZnJvbURhdGU9JHtmcm9tRGF0ZX0mdG9EYXRlPSR7dG9kYXl9JnNlcnZpY2VBcmVhSWQ9JHtzYUlkfWA7XHJcbiAgICAgICAgY29uc3QgY3NyZiA9IGdldENTUkZUb2tlbigpO1xyXG4gICAgICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nIH07XHJcbiAgICAgICAgaWYgKGNzcmYpIGhlYWRlcnNbJ2FudGktY3NyZnRva2VuLWEyeiddID0gY3NyZjtcclxuXHJcbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKHVybCwgeyBtZXRob2Q6ICdHRVQnLCBoZWFkZXJzLCBjcmVkZW50aWFsczogJ2luY2x1ZGUnIH0pO1xyXG4gICAgICAgIGlmIChyZXNwLm9rKSB7XHJcbiAgICAgICAgICBjb25zdCBqc29uID0gYXdhaXQgcmVzcC5qc29uKCk7XHJcbiAgICAgICAgICBjb25zdCByb3N0ZXIgPSBBcnJheS5pc0FycmF5KGpzb24pID8ganNvbiA6IGpzb24/LmRhdGEgfHwganNvbj8ucm9zdGVycyB8fCBbXTtcclxuICAgICAgICAgIGNvbnN0IHByb2Nlc3NFbnRyaWVzID0gKGVudHJpZXM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PikgPT4ge1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcclxuICAgICAgICAgICAgICBpZiAoZW50cnlbJ2RyaXZlclBlcnNvbklkJ10gJiYgZW50cnlbJ2RyaXZlck5hbWUnXSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fbmFtZUNhY2hlLnNldChTdHJpbmcoZW50cnlbJ2RyaXZlclBlcnNvbklkJ10pLCBlbnRyeVsnZHJpdmVyTmFtZSddIGFzIHN0cmluZyk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkocm9zdGVyKSkgcHJvY2Vzc0VudHJpZXMocm9zdGVyKTtcclxuICAgICAgICAgIGVsc2UgaWYgKHR5cGVvZiByb3N0ZXIgPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgdmFsIG9mIE9iamVjdC52YWx1ZXMocm9zdGVyKSkge1xyXG4gICAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbCkpIHByb2Nlc3NFbnRyaWVzKHZhbCBhcyBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBsb2coJ1tEVklDXSBSb3N0ZXIgZmV0Y2g6IGFkZGVkJywgdGhpcy5fbmFtZUNhY2hlLnNpemUsICduYW1lcyB0byBjYWNoZScpO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICAgIGxvZygnW0RWSUNdIFJvc3RlciBsb29rdXAgZmFpbGVkOicsIGUpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzdWx0ID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcclxuICAgIGZvciAoY29uc3QgaWQgb2YgcmVwb3J0ZXJJZHMpIHtcclxuICAgICAgcmVzdWx0LnNldChpZCwgdGhpcy5fbmFtZUNhY2hlLmdldChpZCkgfHwgaWQpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBEYXRhIG5vcm1hbGlzYXRpb24gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX25vcm1hbGl6ZVZlaGljbGUodmVoaWNsZVN0YXQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogVmVoaWNsZVJlY29yZCB7XHJcbiAgICBjb25zdCB2ZWhpY2xlSWRlbnRpZmllciA9IFN0cmluZyh2ZWhpY2xlU3RhdD8uWyd2ZWhpY2xlSWRlbnRpZmllciddID8/ICcnKS50cmltKCkgfHwgJ1Vua25vd24nO1xyXG4gICAgY29uc3QgaW5zcFN0YXRzID0gQXJyYXkuaXNBcnJheSh2ZWhpY2xlU3RhdD8uWydpbnNwZWN0aW9uU3RhdHMnXSkgPyB2ZWhpY2xlU3RhdFsnaW5zcGVjdGlvblN0YXRzJ10gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSA6IFtdO1xyXG5cclxuICAgIGNvbnN0IHByZVN0YXQgID0gaW5zcFN0YXRzLmZpbmQoKHMpID0+IChzPy5bJ2luc3BlY3Rpb25UeXBlJ10gPz8gcz8uWyd0eXBlJ10pID09PSAnUFJFX1RSSVBfRFZJQycpICA/PyBudWxsO1xyXG4gICAgY29uc3QgcG9zdFN0YXQgPSBpbnNwU3RhdHMuZmluZCgocykgPT4gKHM/LlsnaW5zcGVjdGlvblR5cGUnXSA/PyBzPy5bJ3R5cGUnXSkgPT09ICdQT1NUX1RSSVBfRFZJQycpID8/IG51bGw7XHJcblxyXG4gICAgY29uc3QgcHJlVHJpcFRvdGFsICA9IE51bWJlcihwcmVTdGF0Py5bJ3RvdGFsSW5zcGVjdGlvbnNEb25lJ10gID8/IDApO1xyXG4gICAgY29uc3QgcG9zdFRyaXBUb3RhbCA9IE51bWJlcihwb3N0U3RhdD8uWyd0b3RhbEluc3BlY3Rpb25zRG9uZSddID8/IDApO1xyXG5cclxuICAgIGNvbnN0IG1pc3NpbmdEVklDID0gcHJlVHJpcFRvdGFsIC0gcG9zdFRyaXBUb3RhbDtcclxuICAgIGNvbnN0IHN0YXR1cyAgICAgID0gbWlzc2luZ0RWSUMgPiAwID8gJ1Bvc3QgVHJpcCBEVklDIE1pc3NpbmcnIDogJ09LJztcclxuICAgIGNvbnN0IG1pc3NpbmdDb3VudCA9IHN0YXR1cyA9PT0gJ09LJyA/IDAgOiBtaXNzaW5nRFZJQztcclxuXHJcbiAgICBjb25zdCBjYW5kaWRhdGVEYXRlcyA9IFtwcmVTdGF0LCBwb3N0U3RhdF1cclxuICAgICAgLmZpbHRlcihCb29sZWFuKVxyXG4gICAgICAubWFwKChzKSA9PiAocyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPilbJ2luc3BlY3RlZEF0J10gPz8gKHMgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pWydsYXN0SW5zcGVjdGVkQXQnXSA/PyBudWxsKVxyXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pIGFzIHN0cmluZ1tdO1xyXG4gICAgY29uc3QgaW5zcGVjdGVkQXQgPSBjYW5kaWRhdGVEYXRlcy5sZW5ndGggPiAwID8gY2FuZGlkYXRlRGF0ZXMuc29ydCgpLmF0KC0xKSA/PyBudWxsIDogbnVsbDtcclxuICAgIGNvbnN0IHNoaWZ0RGF0ZSA9IChwcmVTdGF0Py5bJ3NoaWZ0RGF0ZSddID8/IHBvc3RTdGF0Py5bJ3NoaWZ0RGF0ZSddID8/IG51bGwpIGFzIHN0cmluZyB8IG51bGw7XHJcblxyXG4gICAgY29uc3QgcmVwb3J0ZXJJZFNldCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gICAgZm9yIChjb25zdCBzdGF0IG9mIGluc3BTdGF0cykge1xyXG4gICAgICBjb25zdCBkZXRhaWxzID0gQXJyYXkuaXNBcnJheShzdGF0Py5bJ2luc3BlY3Rpb25EZXRhaWxzJ10pID8gc3RhdFsnaW5zcGVjdGlvbkRldGFpbHMnXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdIDogW107XHJcbiAgICAgIGZvciAoY29uc3QgZGV0YWlsIG9mIGRldGFpbHMpIHtcclxuICAgICAgICBjb25zdCByaWQgPSBkZXRhaWw/LlsncmVwb3J0ZXJJZCddO1xyXG4gICAgICAgIGlmIChyaWQgIT0gbnVsbCAmJiBTdHJpbmcocmlkKS50cmltKCkgIT09ICcnKSByZXBvcnRlcklkU2V0LmFkZChTdHJpbmcocmlkKS50cmltKCkpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHsgdmVoaWNsZUlkZW50aWZpZXIsIHByZVRyaXBUb3RhbCwgcG9zdFRyaXBUb3RhbCwgbWlzc2luZ0NvdW50LCBzdGF0dXMsIGluc3BlY3RlZEF0LCBzaGlmdERhdGUsIHJlcG9ydGVySWRzOiBbLi4ucmVwb3J0ZXJJZFNldF0sIHJlcG9ydGVyTmFtZXM6IFtdIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9wcm9jZXNzQXBpUmVzcG9uc2UoanNvbjogdW5rbm93bik6IFZlaGljbGVSZWNvcmRbXSB7XHJcbiAgICBpZiAoanNvbiA9PT0gbnVsbCB8fCB0eXBlb2YganNvbiAhPT0gJ29iamVjdCcpIHRocm93IG5ldyBFcnJvcignQVBJIHJlc3BvbnNlIGlzIG5vdCBhIEpTT04gb2JqZWN0Jyk7XHJcbiAgICBjb25zdCBsaXN0ID0gKGpzb24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pPy5bJ2luc3BlY3Rpb25zU3RhdExpc3QnXTtcclxuICAgIGlmIChsaXN0ID09PSB1bmRlZmluZWQgfHwgbGlzdCA9PT0gbnVsbCkgcmV0dXJuIFtdO1xyXG4gICAgaWYgKCFBcnJheS5pc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgRXJyb3IoYGluc3BlY3Rpb25zU3RhdExpc3QgaGFzIHVuZXhwZWN0ZWQgdHlwZTogJHt0eXBlb2YgbGlzdH1gKTtcclxuICAgIHJldHVybiBsaXN0Lm1hcCgodikgPT4gdGhpcy5fbm9ybWFsaXplVmVoaWNsZSh2IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgUmVmcmVzaCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBfcmVmcmVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICh0aGlzLl9sb2FkaW5nKSByZXR1cm47XHJcbiAgICB0aGlzLl9sb2FkaW5nID0gdHJ1ZTtcclxuICAgIHRoaXMuX3ZlaGljbGVzID0gW107XHJcblxyXG4gICAgY29uc3QgdHMgPSB0aGlzLl9nZXRUb2RheUJyZW1lblRpbWVzdGFtcCgpO1xyXG4gICAgdGhpcy5fbGFzdFRpbWVzdGFtcCA9IHRzO1xyXG4gICAgY29uc3QgZGF0ZUxhYmVsID0gbmV3IERhdGUodHMpLnRvTG9jYWxlRGF0ZVN0cmluZygnZGUtREUnLCB7XHJcbiAgICAgIHRpbWVab25lOiAnRXVyb3BlL0JlcmxpbicsIGRheTogJzItZGlnaXQnLCBtb250aDogJzItZGlnaXQnLCB5ZWFyOiAnbnVtZXJpYycsXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLl9zZXRTdGF0dXMoYFx1MjNGMyBMYWRlIERWSUMtRGF0ZW4gZlx1MDBGQ3IgaGV1dGUgKCR7ZGF0ZUxhYmVsfSlcdTIwMjZgKTtcclxuICAgIHRoaXMuX3NldFRpbGVzKCcnKTtcclxuICAgIHRoaXMuX3NldEJvZHkoJzxkaXYgY2xhc3M9XCJjdC1kdmljLWxvYWRpbmdcIiByb2xlPVwic3RhdHVzXCI+RGF0ZW4gd2VyZGVuIGdlbGFkZW5cdTIwMjY8L2Rpdj4nKTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBqc29uID0gYXdhaXQgdGhpcy5fZmV0Y2hJbnNwZWN0aW9uU3RhdHModHMpO1xyXG4gICAgICBsZXQgdmVoaWNsZXM6IFZlaGljbGVSZWNvcmRbXTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICB2ZWhpY2xlcyA9IHRoaXMuX3Byb2Nlc3NBcGlSZXNwb25zZShqc29uKTtcclxuICAgICAgfSBjYXRjaCAocGFyc2VFcnIpIHtcclxuICAgICAgICBlcnIoJ0RWSUMgcmVzcG9uc2UgcGFyc2UgZXJyb3I6JywgcGFyc2VFcnIpO1xyXG4gICAgICAgIHRoaXMuX3NldEJvZHkoYDxkaXYgY2xhc3M9XCJjdC1kdmljLWVycm9yXCIgcm9sZT1cImFsZXJ0XCI+XHUyNkEwXHVGRTBGIERWSUMgZGF0YSB1bmF2YWlsYWJsZSBmb3IgdGhpcyBkYXRlLjxicj48c21hbGw+JHtlc2MoKHBhcnNlRXJyIGFzIEVycm9yKS5tZXNzYWdlKX08L3NtYWxsPjwvZGl2PmApO1xyXG4gICAgICAgIHRoaXMuX3NldFN0YXR1cygnXHUyNkEwXHVGRTBGIERhdGVuIGtvbm50ZW4gbmljaHQgdmVyYXJiZWl0ZXQgd2VyZGVuLicpO1xyXG4gICAgICAgIHRoaXMuX2xvYWRpbmcgPSBmYWxzZTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGFsbElkcyA9IFsuLi5uZXcgU2V0KHZlaGljbGVzLmZsYXRNYXAoKHYpID0+IHYucmVwb3J0ZXJJZHMpKV07XHJcbiAgICAgIGlmIChhbGxJZHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHRoaXMuX3NldFN0YXR1cygnXHUyM0YzIExhZGUgTWl0YXJiZWl0ZXJuYW1lblx1MjAyNicpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCBuYW1lTWFwID0gYXdhaXQgdGhpcy5fZ2V0RW1wbG95ZWVOYW1lcyhhbGxJZHMpO1xyXG4gICAgICAgICAgZm9yIChjb25zdCB2IG9mIHZlaGljbGVzKSB7XHJcbiAgICAgICAgICAgIHYucmVwb3J0ZXJOYW1lcyA9IFsuLi5uZXcgU2V0KHYucmVwb3J0ZXJJZHMubWFwKChpZCkgPT4gbmFtZU1hcC5nZXQoaWQpIHx8IGlkKSldO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKG5hbWVFcnIpIHtcclxuICAgICAgICAgIGxvZygnTmFtZSBlbnJpY2htZW50IGZhaWxlZCwgdXNpbmcgSURzIGFzIGZhbGxiYWNrOicsIG5hbWVFcnIpO1xyXG4gICAgICAgICAgZm9yIChjb25zdCB2IG9mIHZlaGljbGVzKSB7IHYucmVwb3J0ZXJOYW1lcyA9IFsuLi52LnJlcG9ydGVySWRzXTsgfVxyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBmb3IgKGNvbnN0IHYgb2YgdmVoaWNsZXMpIHsgdi5yZXBvcnRlck5hbWVzID0gW107IH1cclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5fdmVoaWNsZXMgPSB2ZWhpY2xlcztcclxuICAgICAgY29uc3QgbWlzc2luZ1ZlaGljbGVzID0gdmVoaWNsZXMuZmlsdGVyKCh2KSA9PiB2LnN0YXR1cyAhPT0gJ09LJykubGVuZ3RoO1xyXG4gICAgICBjb25zdCB0b3RhbE1pc3NpbmcgICAgPSB2ZWhpY2xlcy5yZWR1Y2UoKHMsIHYpID0+IHMgKyB2Lm1pc3NpbmdDb3VudCwgMCk7XHJcblxyXG4gICAgICB0aGlzLl9zZXRTdGF0dXMoYFx1MjcwNSAke3ZlaGljbGVzLmxlbmd0aH0gRmFocnpldWdlIHwgJHttaXNzaW5nVmVoaWNsZXN9IG1pdCBmZWhsZW5kZW0gUG9zdC1UcmlwIERWSUMgfCAke3RvdGFsTWlzc2luZ30gZmVobGVuZGUgRFZJQ3MgZ2VzYW10YCk7XHJcblxyXG4gICAgICBjb25zdCBhc09mRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHZpYy1hc29mJyk7XHJcbiAgICAgIGlmIChhc09mRWwpIHtcclxuICAgICAgICBjb25zdCBmZXRjaGVkQXQgPSBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdkZS1ERScsIHtcclxuICAgICAgICAgIHRpbWVab25lOiAnRXVyb3BlL0JlcmxpbicsIGRheTogJzItZGlnaXQnLCBtb250aDogJzItZGlnaXQnLCB5ZWFyOiAnbnVtZXJpYycsXHJcbiAgICAgICAgICBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnLCBzZWNvbmQ6ICcyLWRpZ2l0JyxcclxuICAgICAgICB9KTtcclxuICAgICAgICBhc09mRWwudGV4dENvbnRlbnQgPSBgU3RhbmQ6ICR7ZmV0Y2hlZEF0fSAoRGF0ZW4gYWIgJHtkYXRlTGFiZWx9KWA7XHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5fcmVuZGVyVGlsZXModmVoaWNsZXMubGVuZ3RoLCBtaXNzaW5nVmVoaWNsZXMsIHRvdGFsTWlzc2luZyk7XHJcbiAgICAgIHRoaXMuX3VwZGF0ZU1pc3NpbmdUYWJCYWRnZShtaXNzaW5nVmVoaWNsZXMpO1xyXG4gICAgICB0aGlzLl9yZW5kZXJCb2R5KCk7XHJcbiAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgIGVycignRFZJQyBmZXRjaCBmYWlsZWQ6JywgZSk7XHJcbiAgICAgIHRoaXMuX3NldEJvZHkoYDxkaXYgY2xhc3M9XCJjdC1kdmljLWVycm9yXCIgcm9sZT1cImFsZXJ0XCI+XHUyNzRDIERWSUMtRGF0ZW4ga29ubnRlbiBuaWNodCBnZWxhZGVuIHdlcmRlbi48YnI+PHNtYWxsPiR7ZXNjKChlIGFzIEVycm9yKS5tZXNzYWdlKX08L3NtYWxsPjxicj48YnI+PGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWFjY2VudFwiIGlkPVwiY3QtZHZpYy1yZXRyeVwiPlx1RDgzRFx1REQwNCBFcm5ldXQgdmVyc3VjaGVuPC9idXR0b24+PC9kaXY+YCk7XHJcbiAgICAgIHRoaXMuX3NldFN0YXR1cygnXHUyNzRDIEZlaGxlciBiZWltIExhZGVuLicpO1xyXG4gICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHZpYy1yZXRyeScpPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuX3JlZnJlc2goKSk7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICB0aGlzLl9sb2FkaW5nID0gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgU3RhdHVzIGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX3NldFN0YXR1cyhtc2c6IHN0cmluZyk6IHZvaWQgeyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kdmljLXN0YXR1cycpOyBpZiAoZWwpIGVsLnRleHRDb250ZW50ID0gbXNnOyB9XHJcbiAgcHJpdmF0ZSBfc2V0Qm9keShodG1sOiBzdHJpbmcpOiB2b2lkIHsgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHZpYy1ib2R5Jyk7IGlmIChlbCkgZWwuaW5uZXJIVE1MID0gaHRtbDsgfVxyXG4gIHByaXZhdGUgX3NldFRpbGVzKGh0bWw6IHN0cmluZyk6IHZvaWQgeyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kdmljLXRpbGVzJyk7IGlmIChlbCkgZWwuaW5uZXJIVE1MID0gaHRtbDsgfVxyXG5cclxuICBwcml2YXRlIF91cGRhdGVNaXNzaW5nVGFiQmFkZ2UoY291bnQ6IG51bWJlcik6IHZvaWQge1xyXG4gICAgY29uc3QgdGFiID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LWR2aWMtdGFiLW1pc3NpbmcnKTtcclxuICAgIGlmICh0YWIpIHRhYi50ZXh0Q29udGVudCA9IGNvdW50ID4gMCA/IGBcdTI2QTBcdUZFMEYgRFZJQyBGZWhsZW5kICgke2NvdW50fSlgIDogJ1x1MjZBMFx1RkUwRiBEVklDIEZlaGxlbmQnO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIFJlbmRlcmluZyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgcHJpdmF0ZSBfcmVuZGVyVGlsZXModG90YWw6IG51bWJlciwgbWlzc2luZ1ZlaGljbGVzOiBudW1iZXIsIG1pc3NpbmdUb3RhbDogbnVtYmVyKTogdm9pZCB7XHJcbiAgICBjb25zdCBlcnJDbHMgPSBtaXNzaW5nVmVoaWNsZXMgPT09IDAgPyAnY3QtZHZpYy10aWxlLS1vaycgOiBtaXNzaW5nVmVoaWNsZXMgPCA1ID8gJ2N0LWR2aWMtdGlsZS0td2FybicgOiAnY3QtZHZpYy10aWxlLS1kYW5nZXInO1xyXG4gICAgdGhpcy5fc2V0VGlsZXMoYFxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtZHZpYy10aWxlc1wiPlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJjdC1kdmljLXRpbGVcIj48ZGl2IGNsYXNzPVwiY3QtZHZpYy10aWxlLXZhbFwiPiR7dG90YWx9PC9kaXY+PGRpdiBjbGFzcz1cImN0LWR2aWMtdGlsZS1sYmxcIj5GYWhyemV1Z2UgZ2VzYW10PC9kaXY+PC9kaXY+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LWR2aWMtdGlsZSAke2VyckNsc31cIj48ZGl2IGNsYXNzPVwiY3QtZHZpYy10aWxlLXZhbFwiPiR7bWlzc2luZ1ZlaGljbGVzfTwvZGl2PjxkaXYgY2xhc3M9XCJjdC1kdmljLXRpbGUtbGJsXCI+RmFocnpldWdlIG1pdCBGZWhsZXI8L2Rpdj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtZHZpYy10aWxlICR7bWlzc2luZ1RvdGFsID09PSAwID8gJ2N0LWR2aWMtdGlsZS0tb2snIDogJ2N0LWR2aWMtdGlsZS0tZGFuZ2VyJ31cIj48ZGl2IGNsYXNzPVwiY3QtZHZpYy10aWxlLXZhbFwiPiR7bWlzc2luZ1RvdGFsfTwvZGl2PjxkaXYgY2xhc3M9XCJjdC1kdmljLXRpbGUtbGJsXCI+RFZJQyBmZWhsZW5kIGdlc2FtdDwvZGl2PjwvZGl2PlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJjdC1kdmljLXRpbGUgJHttaXNzaW5nVmVoaWNsZXMgPT09IDAgPyAnY3QtZHZpYy10aWxlLS1vaycgOiAnJ31cIj48ZGl2IGNsYXNzPVwiY3QtZHZpYy10aWxlLXZhbFwiPiR7dG90YWwgLSBtaXNzaW5nVmVoaWNsZXN9PC9kaXY+PGRpdiBjbGFzcz1cImN0LWR2aWMtdGlsZS1sYmxcIj5GYWhyemV1Z2UgT0s8L2Rpdj48L2Rpdj5cclxuICAgICAgPC9kaXY+YCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9yZW5kZXJCb2R5KCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLl9vdmVybGF5RWwpIHJldHVybjtcclxuICAgIGlmICh0aGlzLl92ZWhpY2xlcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgdGhpcy5fc2V0Qm9keSgnPGRpdiBjbGFzcz1cImN0LWR2aWMtZW1wdHlcIj5LZWluZSBEVklDLURhdGVuIHZlcmZcdTAwRkNnYmFyIGZcdTAwRkNyIGRpZXNlcyBEYXR1bS48L2Rpdj4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKHRoaXMuX2N1cnJlbnRUYWIgPT09ICdhbGwnKSB0aGlzLl9yZW5kZXJBbGxUYWIoKTtcclxuICAgIGVsc2UgdGhpcy5fcmVuZGVyTWlzc2luZ1RhYigpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfcmVuZGVyVHJhbnNwb3J0ZXJOYW1lcyh2OiBWZWhpY2xlUmVjb3JkKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGlkcyA9ICh2LnJlcG9ydGVySWRzID8/IFtdKS5maWx0ZXIoKGlkKSA9PiBTdHJpbmcoaWQpLnRyaW0oKSAhPT0gJycpO1xyXG4gICAgaWYgKGlkcy5sZW5ndGggPT09IDApIHJldHVybiBgPGVtIGNsYXNzPVwiY3QtZHZpYy10cC11bmtub3duXCIgYXJpYS1sYWJlbD1cIlVuYmVrYW5udGVyIFRyYW5zcG9ydGVyXCI+VW5iZWthbm50ZXIgVHJhbnNwb3J0ZXI8L2VtPmA7XHJcbiAgICBjb25zdCBsYWJlbHMgPSBpZHMubWFwKChpZCkgPT4ge1xyXG4gICAgICBjb25zdCBuYW1lID0gdGhpcy5fbmFtZUNhY2hlLmdldChpZCk7XHJcbiAgICAgIHJldHVybiAobmFtZSAmJiBuYW1lICE9PSBpZCkgPyBgJHtuYW1lfSAoSUQ6ICR7aWR9KWAgOiBpZDtcclxuICAgIH0pO1xyXG4gICAgaWYgKGxhYmVscy5sZW5ndGggPT09IDApIHJldHVybiBgPGVtIGNsYXNzPVwiY3QtZHZpYy10cC11bmtub3duXCI+VW5iZWthbm50ZXIgVHJhbnNwb3J0ZXI8L2VtPmA7XHJcbiAgICBjb25zdCBbcHJpbWFyeSwgLi4ucmVzdF0gPSBsYWJlbHM7XHJcbiAgICBjb25zdCBzZWNvbmRhcnkgPSByZXN0Lmxlbmd0aCA+IDAgPyBgPHNwYW4gY2xhc3M9XCJjdC1kdmljLXRwLXNlY29uZGFyeVwiPiwgJHtlc2MocmVzdC5qb2luKCcsICcpKX08L3NwYW4+YCA6ICcnO1xyXG4gICAgcmV0dXJuIGA8c3BhbiBjbGFzcz1cImN0LWR2aWMtdHAtcHJpbWFyeVwiIGFyaWEtbGFiZWw9XCJUcmFuc3BvcnRlcjogJHtlc2MobGFiZWxzLmpvaW4oJywgJykpfVwiPiR7ZXNjKHByaW1hcnkpfSR7c2Vjb25kYXJ5fTwvc3Bhbj5gO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfcmVuZGVyQWxsVGFiKCk6IHZvaWQge1xyXG4gICAgY29uc3QgcGFnZSA9IHRoaXMuX3BhZ2VDdXJyZW50O1xyXG4gICAgY29uc3QgdG90YWwgPSB0aGlzLl92ZWhpY2xlcy5sZW5ndGg7XHJcbiAgICBjb25zdCB0b3RhbFBhZ2VzID0gTWF0aC5jZWlsKHRvdGFsIC8gdGhpcy5fcGFnZVNpemUpO1xyXG4gICAgY29uc3Qgc3RhcnQgPSAocGFnZSAtIDEpICogdGhpcy5fcGFnZVNpemU7XHJcbiAgICBjb25zdCBzbGljZSA9IHRoaXMuX3ZlaGljbGVzLnNsaWNlKHN0YXJ0LCBzdGFydCArIHRoaXMuX3BhZ2VTaXplKTtcclxuICAgIGNvbnN0IHNob3dUcCA9IHRoaXMuX3Nob3dUcmFuc3BvcnRlcnM7XHJcblxyXG4gICAgY29uc3Qgcm93cyA9IHNsaWNlLm1hcCgodikgPT4ge1xyXG4gICAgICBjb25zdCBpc01pc3NpbmcgPSB2LnN0YXR1cyAhPT0gJ09LJztcclxuICAgICAgY29uc3Qgcm93Q2xzID0gaXNNaXNzaW5nID8gJ2N0LWR2aWMtcm93LS1taXNzaW5nJyA6ICcnO1xyXG4gICAgICBjb25zdCBiYWRnZUNscyA9IGlzTWlzc2luZyA/ICdjdC1kdmljLWJhZGdlLS1taXNzaW5nJyA6ICdjdC1kdmljLWJhZGdlLS1vayc7XHJcbiAgICAgIGNvbnN0IHRwQ2VsbCA9IHNob3dUcCA/IGA8dGQgY2xhc3M9XCJjdC1kdmljLXRwLWNlbGxcIj4ke3RoaXMuX3JlbmRlclRyYW5zcG9ydGVyTmFtZXModil9PC90ZD5gIDogJyc7XHJcbiAgICAgIHJldHVybiBgPHRyIGNsYXNzPVwiJHtyb3dDbHN9XCIgcm9sZT1cInJvd1wiPlxyXG4gICAgICAgIDx0ZD4ke2VzYyh2LnZlaGljbGVJZGVudGlmaWVyKX08L3RkPlxyXG4gICAgICAgIDx0ZD4ke3YucHJlVHJpcFRvdGFsfTwvdGQ+PHRkPiR7di5wb3N0VHJpcFRvdGFsfTwvdGQ+XHJcbiAgICAgICAgPHRkPiR7di5taXNzaW5nQ291bnQgPiAwID8gYDxzdHJvbmc+JHt2Lm1pc3NpbmdDb3VudH08L3N0cm9uZz5gIDogJzAnfTwvdGQ+XHJcbiAgICAgICAgPHRkPjxzcGFuIGNsYXNzPVwiJHtiYWRnZUNsc31cIj4ke2VzYyh2LnN0YXR1cyl9PC9zcGFuPjwvdGQ+XHJcbiAgICAgICAgJHt0cENlbGx9PHRkPjwvdGQ+XHJcbiAgICAgIDwvdHI+YDtcclxuICAgIH0pLmpvaW4oJycpO1xyXG5cclxuICAgIGNvbnN0IHRwVG9nZ2xlTGFiZWwgPSBzaG93VHAgPyAnVHJhbnNwb3J0ZXIgYXVzYmxlbmRlbicgOiAnVHJhbnNwb3J0ZXIgZWluYmxlbmRlbic7XHJcbiAgICBjb25zdCB0cEhlYWRlciA9IHNob3dUcCA/IGA8dGggc2NvcGU9XCJjb2xcIiBjbGFzcz1cImN0LWR2aWMtdHAtdGhcIj5UcmFuc3BvcnRlcjwvdGg+YCA6ICcnO1xyXG5cclxuICAgIHRoaXMuX3NldEJvZHkoYFxyXG4gICAgICA8ZGl2IHJvbGU9XCJ0YWJwYW5lbFwiIGFyaWEtbGFiZWxsZWRieT1cImN0LWR2aWMtdGFiLWFsbFwiPlxyXG4gICAgICAgIDxkaXYgY2xhc3M9XCJjdC1kdmljLXRvb2xiYXJcIj5cclxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1kdmljLXRwLXRvZ2dsZSBjdC1idG5cIiBpZD1cImN0LWR2aWMtdHAtdG9nZ2xlXCIgYXJpYS1wcmVzc2VkPVwiJHtzaG93VHB9XCI+XHVEODNEXHVEQzY0ICR7dHBUb2dnbGVMYWJlbH08L2J1dHRvbj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8dGFibGUgY2xhc3M9XCJjdC10YWJsZSBjdC1kdmljLXRhYmxlXCIgcm9sZT1cImdyaWRcIj5cclxuICAgICAgICAgIDx0aGVhZD48dHI+XHJcbiAgICAgICAgICAgIDx0aCBzY29wZT1cImNvbFwiPkZhaHJ6ZXVnPC90aD5cclxuICAgICAgICAgICAgPHRoIHNjb3BlPVwiY29sXCI+UHJlLVRyaXAgXHUyNzEzPC90aD48dGggc2NvcGU9XCJjb2xcIj5Qb3N0LVRyaXAgXHUyNzEzPC90aD5cclxuICAgICAgICAgICAgPHRoIHNjb3BlPVwiY29sXCI+RmVobGVuZDwvdGg+PHRoIHNjb3BlPVwiY29sXCI+U3RhdHVzPC90aD5cclxuICAgICAgICAgICAgJHt0cEhlYWRlcn08dGggc2NvcGU9XCJjb2xcIiBzdHlsZT1cIndpZHRoOjRweDtcIj48L3RoPlxyXG4gICAgICAgICAgPC90cj48L3RoZWFkPlxyXG4gICAgICAgICAgPHRib2R5PiR7cm93c308L3Rib2R5PlxyXG4gICAgICAgIDwvdGFibGU+XHJcbiAgICAgICAgJHt0aGlzLl9yZW5kZXJQYWdpbmF0aW9uKHRvdGFsLCBwYWdlLCB0b3RhbFBhZ2VzLCAnYWxsJyl9XHJcbiAgICAgIDwvZGl2PmApO1xyXG5cclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kdmljLXRwLXRvZ2dsZScpPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgdGhpcy5jb25maWcuZmVhdHVyZXMuZHZpY1Nob3dUcmFuc3BvcnRlcnMgPSAhdGhpcy5fc2hvd1RyYW5zcG9ydGVycztcclxuICAgICAgc2V0Q29uZmlnKHRoaXMuY29uZmlnKTtcclxuICAgICAgdGhpcy5fcmVuZGVyQm9keSgpO1xyXG4gICAgfSk7XHJcbiAgICB0aGlzLl9hdHRhY2hQYWdpbmF0aW9uSGFuZGxlcnMoJ2FsbCcpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfcmVuZGVyTWlzc2luZ1RhYigpOiB2b2lkIHtcclxuICAgIGNvbnN0IG1pc3NpbmcgPSB0aGlzLl92ZWhpY2xlcy5maWx0ZXIoKHYpID0+IHYuc3RhdHVzICE9PSAnT0snKTtcclxuICAgIGlmIChtaXNzaW5nLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICB0aGlzLl9zZXRCb2R5KCc8ZGl2IGNsYXNzPVwiY3QtZHZpYy1lbXB0eVwiPlx1MjcwNSBBbGxlIEZhaHJ6ZXVnZSBoYWJlbiBQb3N0LVRyaXAgRFZJQ3MgXHUyMDE0IGtlaW4gSGFuZGx1bmdzYmVkYXJmLjwvZGl2PicpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGFnZSA9IHRoaXMuX3BhZ2VNaXNzaW5nO1xyXG4gICAgY29uc3QgdG90YWxQYWdlcyA9IE1hdGguY2VpbChtaXNzaW5nLmxlbmd0aCAvIHRoaXMuX3BhZ2VTaXplKTtcclxuICAgIGNvbnN0IHN0YXJ0ID0gKHBhZ2UgLSAxKSAqIHRoaXMuX3BhZ2VTaXplO1xyXG4gICAgY29uc3Qgc2xpY2UgPSBtaXNzaW5nLnNsaWNlKHN0YXJ0LCBzdGFydCArIHRoaXMuX3BhZ2VTaXplKTtcclxuICAgIGNvbnN0IHNob3dUcCA9IHRoaXMuX3Nob3dUcmFuc3BvcnRlcnM7XHJcblxyXG4gICAgY29uc3Qgcm93cyA9IHNsaWNlLm1hcCgodikgPT4ge1xyXG4gICAgICBjb25zdCB0cENlbGwgPSBzaG93VHAgPyBgPHRkIGNsYXNzPVwiY3QtZHZpYy10cC1jZWxsXCI+JHt0aGlzLl9yZW5kZXJUcmFuc3BvcnRlck5hbWVzKHYpfTwvdGQ+YCA6ICcnO1xyXG4gICAgICByZXR1cm4gYDx0ciBjbGFzcz1cImN0LWR2aWMtcm93LS1taXNzaW5nXCIgcm9sZT1cInJvd1wiPlxyXG4gICAgICAgIDx0ZD4ke2VzYyh2LnZlaGljbGVJZGVudGlmaWVyKX08L3RkPlxyXG4gICAgICAgIDx0ZD4ke3YucHJlVHJpcFRvdGFsfTwvdGQ+PHRkPiR7di5wb3N0VHJpcFRvdGFsfTwvdGQ+XHJcbiAgICAgICAgPHRkPjxzdHJvbmc+JHt2Lm1pc3NpbmdDb3VudH08L3N0cm9uZz48L3RkPlxyXG4gICAgICAgICR7dHBDZWxsfVxyXG4gICAgICA8L3RyPmA7XHJcbiAgICB9KS5qb2luKCcnKTtcclxuXHJcbiAgICBjb25zdCB0cFRvZ2dsZUxhYmVsID0gc2hvd1RwID8gJ1RyYW5zcG9ydGVyIGF1c2JsZW5kZW4nIDogJ1RyYW5zcG9ydGVyIGVpbmJsZW5kZW4nO1xyXG4gICAgY29uc3QgdHBIZWFkZXIgPSBzaG93VHAgPyBgPHRoIHNjb3BlPVwiY29sXCIgY2xhc3M9XCJjdC1kdmljLXRwLXRoXCI+VHJhbnNwb3J0ZXI8L3RoPmAgOiAnJztcclxuXHJcbiAgICB0aGlzLl9zZXRCb2R5KGBcclxuICAgICAgPGRpdiByb2xlPVwidGFicGFuZWxcIiBhcmlhLWxhYmVsbGVkYnk9XCJjdC1kdmljLXRhYi1taXNzaW5nXCI+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LWR2aWMtdG9vbGJhclwiPlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWR2aWMtdHAtdG9nZ2xlIGN0LWJ0blwiIGlkPVwiY3QtZHZpYy10cC10b2dnbGVcIiBhcmlhLXByZXNzZWQ9XCIke3Nob3dUcH1cIj5cdUQ4M0RcdURDNjQgJHt0cFRvZ2dsZUxhYmVsfTwvYnV0dG9uPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDx0YWJsZSBjbGFzcz1cImN0LXRhYmxlIGN0LWR2aWMtdGFibGVcIiByb2xlPVwiZ3JpZFwiPlxyXG4gICAgICAgICAgPHRoZWFkPjx0cj5cclxuICAgICAgICAgICAgPHRoIHNjb3BlPVwiY29sXCI+RmFocnpldWc8L3RoPlxyXG4gICAgICAgICAgICA8dGggc2NvcGU9XCJjb2xcIj5QcmUtVHJpcCBcdTI3MTM8L3RoPjx0aCBzY29wZT1cImNvbFwiPlBvc3QtVHJpcCBcdTI3MTM8L3RoPlxyXG4gICAgICAgICAgICA8dGggc2NvcGU9XCJjb2xcIj5GZWhsZW5kPC90aD4ke3RwSGVhZGVyfVxyXG4gICAgICAgICAgPC90cj48L3RoZWFkPlxyXG4gICAgICAgICAgPHRib2R5PiR7cm93c308L3Rib2R5PlxyXG4gICAgICAgIDwvdGFibGU+XHJcbiAgICAgICAgJHt0aGlzLl9yZW5kZXJQYWdpbmF0aW9uKG1pc3NpbmcubGVuZ3RoLCBwYWdlLCB0b3RhbFBhZ2VzLCAnbWlzc2luZycpfVxyXG4gICAgICA8L2Rpdj5gKTtcclxuXHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtZHZpYy10cC10b2dnbGUnKT8uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgIHRoaXMuY29uZmlnLmZlYXR1cmVzLmR2aWNTaG93VHJhbnNwb3J0ZXJzID0gIXRoaXMuX3Nob3dUcmFuc3BvcnRlcnM7XHJcbiAgICAgIHNldENvbmZpZyh0aGlzLmNvbmZpZyk7XHJcbiAgICAgIHRoaXMuX3JlbmRlckJvZHkoKTtcclxuICAgIH0pO1xyXG4gICAgdGhpcy5fYXR0YWNoUGFnaW5hdGlvbkhhbmRsZXJzKCdtaXNzaW5nJyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9yZW5kZXJQYWdpbmF0aW9uKHRvdGFsOiBudW1iZXIsIGN1cnJlbnQ6IG51bWJlciwgdG90YWxQYWdlczogbnVtYmVyLCB0YWJLZXk6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgICBpZiAodG90YWxQYWdlcyA8PSAxKSByZXR1cm4gJyc7XHJcbiAgICByZXR1cm4gYFxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtZHZpYy1wYWdpbmF0aW9uXCI+XHJcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXNlY29uZGFyeSBjdC1kdmljLXByZXYtcGFnZVwiIGRhdGEtdGFiPVwiJHt0YWJLZXl9XCIgJHtjdXJyZW50IDw9IDEgPyAnZGlzYWJsZWQnIDogJyd9Plx1MjAzOSBadXJcdTAwRkNjazwvYnV0dG9uPlxyXG4gICAgICAgIDxzcGFuIGNsYXNzPVwiY3QtZHZpYy1wYWdlLWluZm9cIj5TZWl0ZSAke2N1cnJlbnR9IC8gJHt0b3RhbFBhZ2VzfSAoJHt0b3RhbH0gRWludHJcdTAwRTRnZSk8L3NwYW4+XHJcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXNlY29uZGFyeSBjdC1kdmljLW5leHQtcGFnZVwiIGRhdGEtdGFiPVwiJHt0YWJLZXl9XCIgJHtjdXJyZW50ID49IHRvdGFsUGFnZXMgPyAnZGlzYWJsZWQnIDogJyd9PldlaXRlciBcdTIwM0E8L2J1dHRvbj5cclxuICAgICAgPC9kaXY+YDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX2F0dGFjaFBhZ2luYXRpb25IYW5kbGVycyh0YWJLZXk6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgY29uc3QgYm9keSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1kdmljLWJvZHknKTtcclxuICAgIGlmICghYm9keSkgcmV0dXJuO1xyXG4gICAgYm9keS5xdWVyeVNlbGVjdG9yKGAuY3QtZHZpYy1wcmV2LXBhZ2VbZGF0YS10YWI9XCIke3RhYktleX1cIl1gKT8uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgIGlmICh0YWJLZXkgPT09ICdhbGwnKSB7IGlmICh0aGlzLl9wYWdlQ3VycmVudCA+IDEpIHsgdGhpcy5fcGFnZUN1cnJlbnQtLTsgdGhpcy5fcmVuZGVyQWxsVGFiKCk7IH0gfVxyXG4gICAgICBlbHNlIHsgaWYgKHRoaXMuX3BhZ2VNaXNzaW5nID4gMSkgeyB0aGlzLl9wYWdlTWlzc2luZy0tOyB0aGlzLl9yZW5kZXJNaXNzaW5nVGFiKCk7IH0gfVxyXG4gICAgfSk7XHJcbiAgICBib2R5LnF1ZXJ5U2VsZWN0b3IoYC5jdC1kdmljLW5leHQtcGFnZVtkYXRhLXRhYj1cIiR7dGFiS2V5fVwiXWApPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgY29uc3QgdCA9IHRhYktleSA9PT0gJ2FsbCcgPyB0aGlzLl92ZWhpY2xlcy5sZW5ndGggOiB0aGlzLl92ZWhpY2xlcy5maWx0ZXIoKHYpID0+IHYuc3RhdHVzICE9PSAnT0snKS5sZW5ndGg7XHJcbiAgICAgIGNvbnN0IHRwID0gTWF0aC5jZWlsKHQgLyB0aGlzLl9wYWdlU2l6ZSk7XHJcbiAgICAgIGlmICh0YWJLZXkgPT09ICdhbGwnKSB7IGlmICh0aGlzLl9wYWdlQ3VycmVudCA8IHRwKSB7IHRoaXMuX3BhZ2VDdXJyZW50Kys7IHRoaXMuX3JlbmRlckFsbFRhYigpOyB9IH1cclxuICAgICAgZWxzZSB7IGlmICh0aGlzLl9wYWdlTWlzc2luZyA8IHRwKSB7IHRoaXMuX3BhZ2VNaXNzaW5nKys7IHRoaXMuX3JlbmRlck1pc3NpbmdUYWIoKTsgfSB9XHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuIiwgIi8vIGZlYXR1cmVzL3dvcmtpbmctaG91cnMudHMgXHUyMDEzIFdvcmtpbmcgSG91cnMgRGFzaGJvYXJkXHJcblxyXG5pbXBvcnQgeyBsb2csIGVyciwgZXNjLCB0b2RheVN0ciwgd2l0aFJldHJ5LCBnZXRDU1JGVG9rZW4sIGV4dHJhY3RTZXNzaW9uRnJvbUNvb2tpZSB9IGZyb20gJy4uL2NvcmUvdXRpbHMnO1xyXG5pbXBvcnQgeyBvbkRpc3Bvc2UgfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcclxuaW1wb3J0IHR5cGUgeyBBcHBDb25maWcgfSBmcm9tICcuLi9jb3JlL3N0b3JhZ2UnO1xyXG5pbXBvcnQgdHlwZSB7IENvbXBhbnlDb25maWcgfSBmcm9tICcuLi9jb3JlL2FwaSc7XHJcblxyXG4vLyBcdTI1MDBcdTI1MDAgUHVyZSBoZWxwZXIgZnVuY3Rpb25zIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuLyoqIE5vcm1hbGlzZSBhbiBlcG9jaCB2YWx1ZSB0byBtaWxsaXNlY29uZHMuICovXHJcbmV4cG9ydCBmdW5jdGlvbiB3aGROb3JtYWxpemVFcG9jaE1zKHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHwgbnVsbCB7XHJcbiAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IG4gPSBOdW1iZXIodmFsdWUpO1xyXG4gIGlmIChpc05hTihuKSkgcmV0dXJuIG51bGw7XHJcbiAgaWYgKG4gPiAxXzAwMF8wMDBfMDAwXzAwMF8wMDApIHJldHVybiBNYXRoLmZsb29yKG4gLyAxMDAwKTtcclxuICBpZiAobiA+IDFfMDAwXzAwMF8wMDBfMDAwKSByZXR1cm4gbjtcclxuICBpZiAobiA+IDFfMDAwXzAwMF8wMDApIHJldHVybiBuICogMTAwMDtcclxuICByZXR1cm4gbjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHdoZEZvcm1hdFRpbWUoZXBvY2hNczogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCk6IHN0cmluZyB7XHJcbiAgaWYgKGVwb2NoTXMgPT09IG51bGwgfHwgZXBvY2hNcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgdHJ5IHtcclxuICAgIHJldHVybiBuZXcgRGF0ZShlcG9jaE1zKS50b0xvY2FsZVRpbWVTdHJpbmcoJ2RlLURFJywge1xyXG4gICAgICB0aW1lWm9uZTogJ0V1cm9wZS9CZXJsaW4nLCBob3VyOiAnMi1kaWdpdCcsIG1pbnV0ZTogJzItZGlnaXQnLCBob3VyMTI6IGZhbHNlLFxyXG4gICAgfSk7XHJcbiAgfSBjYXRjaCB7IHJldHVybiAnXHUyMDE0JzsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gd2hkRm9ybWF0RHVyYXRpb24obXM6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQpOiBzdHJpbmcge1xyXG4gIGlmIChtcyA9PT0gbnVsbCB8fCBtcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgY29uc3QgbiA9IE51bWJlcihtcyk7XHJcbiAgaWYgKGlzTmFOKG4pKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgY29uc3QgdG90YWxTZWMgPSBNYXRoLmZsb29yKG4gLyAxMDAwKTtcclxuICBjb25zdCBtaW51dGVzID0gTWF0aC5mbG9vcih0b3RhbFNlYyAvIDYwKTtcclxuICBjb25zdCBzZWNvbmRzID0gdG90YWxTZWMgJSA2MDtcclxuICByZXR1cm4gYCR7bWludXRlc31tICR7U3RyaW5nKHNlY29uZHMpLnBhZFN0YXJ0KDIsICcwJyl9c2A7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgV2hkUm93IHtcclxuICBpdGluZXJhcnlJZDogc3RyaW5nIHwgbnVsbDtcclxuICB0cmFuc3BvcnRlcklkOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJvdXRlQ29kZTogc3RyaW5nIHwgbnVsbDtcclxuICBzZXJ2aWNlVHlwZU5hbWU6IHN0cmluZyB8IG51bGw7XHJcbiAgZHJpdmVyTmFtZTogc3RyaW5nIHwgbnVsbDtcclxuICBibG9ja0R1cmF0aW9uSW5NaW51dGVzOiBudW1iZXIgfCBudWxsO1xyXG4gIHdhdmVTdGFydFRpbWU6IG51bWJlciB8IG51bGw7XHJcbiAgaXRpbmVyYXJ5U3RhcnRUaW1lOiBudW1iZXIgfCBudWxsO1xyXG4gIHBsYW5uZWREZXBhcnR1cmVUaW1lOiBudW1iZXIgfCBudWxsO1xyXG4gIGFjdHVhbERlcGFydHVyZVRpbWU6IG51bWJlciB8IG51bGw7XHJcbiAgcGxhbm5lZE91dGJvdW5kU3RlbVRpbWU6IHVua25vd247XHJcbiAgYWN0dWFsT3V0Ym91bmRTdGVtVGltZTogdW5rbm93bjtcclxuICBsYXN0RHJpdmVyRXZlbnRUaW1lOiBudW1iZXIgfCBudWxsO1xyXG4gIFtrZXk6IHN0cmluZ106IHVua25vd247XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB3aGRFeHRyYWN0Um93KGl0ZW06IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogV2hkUm93IHtcclxuICBjb25zdCB0dGEgPSAoaXRlbVsndHJhbnNwb3J0ZXJUaW1lQXR0cmlidXRlcyddIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB8fCB7fTtcclxuICByZXR1cm4ge1xyXG4gICAgaXRpbmVyYXJ5SWQ6ICAgICAgICAgICAgIChpdGVtWydpdGluZXJhcnlJZCddIGFzIHN0cmluZyB8IG51bGwpID8/IG51bGwsXHJcbiAgICB0cmFuc3BvcnRlcklkOiAgICAgICAgICAgKGl0ZW1bJ3RyYW5zcG9ydGVySWQnXSBhcyBzdHJpbmcgfCBudWxsKSA/PyBudWxsLFxyXG4gICAgcm91dGVDb2RlOiAgICAgICAgICAgICAgIChpdGVtWydyb3V0ZUNvZGUnXSBhcyBzdHJpbmcgfCBudWxsKSA/PyBudWxsLFxyXG4gICAgc2VydmljZVR5cGVOYW1lOiAgICAgICAgIChpdGVtWydzZXJ2aWNlVHlwZU5hbWUnXSBhcyBzdHJpbmcgfCBudWxsKSA/PyBudWxsLFxyXG4gICAgZHJpdmVyTmFtZTogICAgICAgICAgICAgIG51bGwsXHJcbiAgICBibG9ja0R1cmF0aW9uSW5NaW51dGVzOiAgKGl0ZW1bJ2Jsb2NrRHVyYXRpb25Jbk1pbnV0ZXMnXSBhcyBudW1iZXIgfCBudWxsKSA/PyBudWxsLFxyXG4gICAgd2F2ZVN0YXJ0VGltZTogICAgICAgICAgIHdoZE5vcm1hbGl6ZUVwb2NoTXMoaXRlbVsnd2F2ZVN0YXJ0VGltZSddKSxcclxuICAgIGl0aW5lcmFyeVN0YXJ0VGltZTogICAgICB3aGROb3JtYWxpemVFcG9jaE1zKGl0ZW1bJ2l0aW5lcmFyeVN0YXJ0VGltZSddKSxcclxuICAgIHBsYW5uZWREZXBhcnR1cmVUaW1lOiAgICB3aGROb3JtYWxpemVFcG9jaE1zKGl0ZW1bJ3BsYW5uZWREZXBhcnR1cmVUaW1lJ10pLFxyXG4gICAgYWN0dWFsRGVwYXJ0dXJlVGltZTogICAgIHdoZE5vcm1hbGl6ZUVwb2NoTXModHRhWydhY3R1YWxEZXBhcnR1cmVUaW1lJ10pLFxyXG4gICAgcGxhbm5lZE91dGJvdW5kU3RlbVRpbWU6IHR0YVsncGxhbm5lZE91dGJvdW5kU3RlbVRpbWUnXSA/PyBudWxsLFxyXG4gICAgYWN0dWFsT3V0Ym91bmRTdGVtVGltZTogIHR0YVsnYWN0dWFsT3V0Ym91bmRTdGVtVGltZSddID8/IG51bGwsXHJcbiAgICBsYXN0RHJpdmVyRXZlbnRUaW1lOiAgICAgd2hkTm9ybWFsaXplRXBvY2hNcyhpdGVtWydsYXN0RHJpdmVyRXZlbnRUaW1lJ10pLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB3aGRTb3J0Um93cyhyb3dzOiBXaGRSb3dbXSwgY29sdW1uOiBzdHJpbmcsIGRpcmVjdGlvbjogJ2FzYycgfCAnZGVzYycpOiBXaGRSb3dbXSB7XHJcbiAgY29uc3QgbXVsdCA9IGRpcmVjdGlvbiA9PT0gJ2FzYycgPyAxIDogLTE7XHJcbiAgcmV0dXJuIFsuLi5yb3dzXS5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBjb25zdCB2YSA9IGFbY29sdW1uXTtcclxuICAgIGNvbnN0IHZiID0gYltjb2x1bW5dO1xyXG4gICAgaWYgKHZhID09PSBudWxsICYmIHZiID09PSBudWxsKSByZXR1cm4gMDtcclxuICAgIGlmICh2YSA9PT0gbnVsbCkgcmV0dXJuIDE7XHJcbiAgICBpZiAodmIgPT09IG51bGwpIHJldHVybiAtMTtcclxuICAgIGlmICh0eXBlb2YgdmEgPT09ICdzdHJpbmcnKSByZXR1cm4gbXVsdCAqICh2YSBhcyBzdHJpbmcpLmxvY2FsZUNvbXBhcmUodmIgYXMgc3RyaW5nKTtcclxuICAgIHJldHVybiBtdWx0ICogKCh2YSBhcyBudW1iZXIpIC0gKHZiIGFzIG51bWJlcikpO1xyXG4gIH0pO1xyXG59XHJcblxyXG5jb25zdCBXSERfQ09MVU1OUyA9IFtcclxuICB7IGtleTogJ3JvdXRlQ29kZScsICAgICAgICAgICAgICBsYWJlbDogJ1JvdXRlIENvZGUnLCAgICAgICAgdHlwZTogJ3N0cmluZycgICB9LFxyXG4gIHsga2V5OiAnc2VydmljZVR5cGVOYW1lJywgICAgICAgIGxhYmVsOiAnU2VydmljZSBUeXBlJywgICAgICB0eXBlOiAnc3RyaW5nJyAgIH0sXHJcbiAgeyBrZXk6ICdkcml2ZXJOYW1lJywgICAgICAgICAgICAgbGFiZWw6ICdEcml2ZXInLCAgICAgICAgICAgIHR5cGU6ICdzdHJpbmcnICAgfSxcclxuICB7IGtleTogJ2Jsb2NrRHVyYXRpb25Jbk1pbnV0ZXMnLCBsYWJlbDogJ0Jsb2NrIChtaW4pJywgICAgICAgdHlwZTogJ2ludGVnZXInICB9LFxyXG4gIHsga2V5OiAnd2F2ZVN0YXJ0VGltZScsICAgICAgICAgIGxhYmVsOiAnV2F2ZSBTdGFydCcsICAgICAgICB0eXBlOiAndGltZScgICAgIH0sXHJcbiAgeyBrZXk6ICdpdGluZXJhcnlTdGFydFRpbWUnLCAgICAgbGFiZWw6ICdJdGluLiBTdGFydCcsICAgICAgIHR5cGU6ICd0aW1lJyAgICAgfSxcclxuICB7IGtleTogJ3BsYW5uZWREZXBhcnR1cmVUaW1lJywgICBsYWJlbDogJ1BsYW5uZWQgRGVwLicsICAgICAgdHlwZTogJ3RpbWUnICAgICB9LFxyXG4gIHsga2V5OiAnYWN0dWFsRGVwYXJ0dXJlVGltZScsICAgIGxhYmVsOiAnQWN0dWFsIERlcC4nLCAgICAgICB0eXBlOiAndGltZScgICAgIH0sXHJcbiAgeyBrZXk6ICdwbGFubmVkT3V0Ym91bmRTdGVtVGltZScsbGFiZWw6ICdQbGFubmVkIE9CIFN0ZW0nLCAgIHR5cGU6ICdkdXJhdGlvbicgfSxcclxuICB7IGtleTogJ2FjdHVhbE91dGJvdW5kU3RlbVRpbWUnLCBsYWJlbDogJ0FjdHVhbCBPQiBTdGVtJywgICAgdHlwZTogJ2R1cmF0aW9uJyB9LFxyXG4gIHsga2V5OiAnbGFzdERyaXZlckV2ZW50VGltZScsICAgIGxhYmVsOiAnTGFzdCBEcml2ZXIgRXZlbnQnLCB0eXBlOiAndGltZScgICAgIH0sXHJcbl0gYXMgY29uc3Q7XHJcblxyXG5jb25zdCBXSERfREVUQUlMX0ZJRUxEUyA9IFtcclxuICB7IGtleTogJ2l0aW5lcmFyeUlkJywgICAgICAgICAgICBsYWJlbDogJ0l0aW5lcmFyeSBJRCcsICAgICAgZm9ybWF0OiAnc3RyaW5nJywgICBzdWZmaXg6ICcnICAgIH0sXHJcbiAgeyBrZXk6ICdyb3V0ZUNvZGUnLCAgICAgICAgICAgICAgbGFiZWw6ICdSb3V0ZSBDb2RlJywgICAgICAgIGZvcm1hdDogJ3N0cmluZycsICAgc3VmZml4OiAnJyAgICB9LFxyXG4gIHsga2V5OiAnc2VydmljZVR5cGVOYW1lJywgICAgICAgIGxhYmVsOiAnU2VydmljZSBUeXBlJywgICAgICBmb3JtYXQ6ICdzdHJpbmcnLCAgIHN1ZmZpeDogJycgICAgfSxcclxuICB7IGtleTogJ2RyaXZlck5hbWUnLCAgICAgICAgICAgICBsYWJlbDogJ0RyaXZlcicsICAgICAgICAgICAgZm9ybWF0OiAnc3RyaW5nJywgICBzdWZmaXg6ICcnICAgIH0sXHJcbiAgeyBrZXk6ICdibG9ja0R1cmF0aW9uSW5NaW51dGVzJywgbGFiZWw6ICdCbG9jayBEdXJhdGlvbicsICAgIGZvcm1hdDogJ2ludGVnZXInLCAgc3VmZml4OiAnIG1pbid9LFxyXG4gIHsga2V5OiAnd2F2ZVN0YXJ0VGltZScsICAgICAgICAgIGxhYmVsOiAnV2F2ZSBTdGFydCcsICAgICAgICBmb3JtYXQ6ICd0aW1lJywgICAgIHN1ZmZpeDogJycgICAgfSxcclxuICB7IGtleTogJ2l0aW5lcmFyeVN0YXJ0VGltZScsICAgICBsYWJlbDogJ0l0aW4uIFN0YXJ0JywgICAgICAgZm9ybWF0OiAndGltZScsICAgICBzdWZmaXg6ICcnICAgIH0sXHJcbiAgeyBrZXk6ICdwbGFubmVkRGVwYXJ0dXJlVGltZScsICAgbGFiZWw6ICdQbGFubmVkIERlcGFydHVyZScsIGZvcm1hdDogJ3RpbWUnLCAgICAgc3VmZml4OiAnJyAgICB9LFxyXG4gIHsga2V5OiAnYWN0dWFsRGVwYXJ0dXJlVGltZScsICAgIGxhYmVsOiAnQWN0dWFsIERlcGFydHVyZScsICBmb3JtYXQ6ICd0aW1lJywgICAgIHN1ZmZpeDogJycgICAgfSxcclxuICB7IGtleTogJ3BsYW5uZWRPdXRib3VuZFN0ZW1UaW1lJyxsYWJlbDogJ1BsYW5uZWQgT0IgU3RlbScsICAgZm9ybWF0OiAnZHVyYXRpb24nLCBzdWZmaXg6ICcnICAgIH0sXHJcbiAgeyBrZXk6ICdhY3R1YWxPdXRib3VuZFN0ZW1UaW1lJywgbGFiZWw6ICdBY3R1YWwgT0IgU3RlbScsICAgIGZvcm1hdDogJ2R1cmF0aW9uJywgc3VmZml4OiAnJyAgICB9LFxyXG4gIHsga2V5OiAnbGFzdERyaXZlckV2ZW50VGltZScsICAgIGxhYmVsOiAnTGFzdCBEcml2ZXIgRXZlbnQnLCBmb3JtYXQ6ICd0aW1lJywgICAgIHN1ZmZpeDogJycgICAgfSxcclxuXSBhcyBjb25zdDtcclxuXHJcbi8vIFx1MjUwMFx1MjUwMCBEYXNoYm9hcmQgY2xhc3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG5leHBvcnQgY2xhc3MgV29ya2luZ0hvdXJzRGFzaGJvYXJkIHtcclxuICBwcml2YXRlIF9vdmVybGF5RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBfZGV0YWlsRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBfYWN0aXZlID0gZmFsc2U7XHJcbiAgcHJpdmF0ZSBfZGF0YTogV2hkUm93W10gPSBbXTtcclxuICBwcml2YXRlIF9zb3J0OiB7IGNvbHVtbjogc3RyaW5nOyBkaXJlY3Rpb246ICdhc2MnIHwgJ2Rlc2MnIH0gPSB7IGNvbHVtbjogJ3JvdXRlQ29kZScsIGRpcmVjdGlvbjogJ2FzYycgfTtcclxuICBwcml2YXRlIF9wYWdlID0gMTtcclxuICBwcml2YXRlIF9wYWdlU2l6ZSA9IDUwO1xyXG4gIHByaXZhdGUgX2RyaXZlckNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogQXBwQ29uZmlnLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21wYW55Q29uZmlnOiBDb21wYW55Q29uZmlnLFxyXG4gICkge31cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIExpZmVjeWNsZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgaW5pdCgpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLl9vdmVybGF5RWwpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBvdmVybGF5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBvdmVybGF5LmlkID0gJ2N0LXdoZC1vdmVybGF5JztcclxuICAgIG92ZXJsYXkuY2xhc3NOYW1lID0gJ2N0LW92ZXJsYXknO1xyXG4gICAgb3ZlcmxheS5zZXRBdHRyaWJ1dGUoJ3JvbGUnLCAnZGlhbG9nJyk7XHJcbiAgICBvdmVybGF5LnNldEF0dHJpYnV0ZSgnYXJpYS1tb2RhbCcsICd0cnVlJyk7XHJcbiAgICBvdmVybGF5LnNldEF0dHJpYnV0ZSgnYXJpYS1sYWJlbCcsICdXb3JraW5nIEhvdXJzIERhc2hib2FyZCcpO1xyXG4gICAgb3ZlcmxheS5pbm5lckhUTUwgPSBgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC13aGQtcGFuZWxcIj5cclxuICAgICAgICA8aDI+XHUyM0YxIFdvcmtpbmcgSG91cnMgRGFzaGJvYXJkPC9oMj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtY29udHJvbHNcIj5cclxuICAgICAgICAgIDxsYWJlbCBmb3I9XCJjdC13aGQtZGF0ZVwiPkRhdHVtOjwvbGFiZWw+XHJcbiAgICAgICAgICA8aW5wdXQgdHlwZT1cImRhdGVcIiBpZD1cImN0LXdoZC1kYXRlXCIgY2xhc3M9XCJjdC1pbnB1dFwiIHZhbHVlPVwiJHt0b2RheVN0cigpfVwiIGFyaWEtbGFiZWw9XCJEYXR1bSBhdXN3XHUwMEU0aGxlblwiPlxyXG4gICAgICAgICAgPGxhYmVsIGZvcj1cImN0LXdoZC1zYVwiPlNlcnZpY2UgQXJlYTo8L2xhYmVsPlxyXG4gICAgICAgICAgPHNlbGVjdCBpZD1cImN0LXdoZC1zYVwiIGNsYXNzPVwiY3Qtc2VsZWN0XCIgYXJpYS1sYWJlbD1cIlNlcnZpY2UgQXJlYVwiPjwvc2VsZWN0PlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWFjY2VudFwiIGlkPVwiY3Qtd2hkLWdvXCI+XHVEODNEXHVERDBEIEFiZnJhZ2VuPC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tcHJpbWFyeVwiIGlkPVwiY3Qtd2hkLWV4cG9ydFwiPlx1RDgzRFx1RENDQiBDU1YgRXhwb3J0PC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tY2xvc2VcIiBpZD1cImN0LXdoZC1jbG9zZVwiPlx1MjcxNSBTY2hsaWVcdTAwREZlbjwvYnV0dG9uPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgaWQ9XCJjdC13aGQtc3RhdHVzXCIgY2xhc3M9XCJjdC1zdGF0dXNcIiByb2xlPVwic3RhdHVzXCIgYXJpYS1saXZlPVwicG9saXRlXCI+PC9kaXY+XHJcbiAgICAgICAgPGRpdiBpZD1cImN0LXdoZC1ib2R5XCI+PC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgYDtcclxuXHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG92ZXJsYXkpO1xyXG4gICAgdGhpcy5fb3ZlcmxheUVsID0gb3ZlcmxheTtcclxuXHJcbiAgICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgaWYgKGUudGFyZ2V0ID09PSBvdmVybGF5KSB0aGlzLmhpZGUoKTsgfSk7XHJcbiAgICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCAoZSkgPT4geyBpZiAoKGUgYXMgS2V5Ym9hcmRFdmVudCkua2V5ID09PSAnRXNjYXBlJykgdGhpcy5oaWRlKCk7IH0pO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoZC1jbG9zZScpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuaGlkZSgpKTtcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC13aGQtZ28nKSEuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLl9mZXRjaERhdGEoKSk7XHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hkLWV4cG9ydCcpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuX2V4cG9ydENTVigpKTtcclxuXHJcbiAgICB0aGlzLmNvbXBhbnlDb25maWcubG9hZCgpLnRoZW4oKCkgPT4ge1xyXG4gICAgICB0aGlzLmNvbXBhbnlDb25maWcucG9wdWxhdGVTYVNlbGVjdChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hkLXNhJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgb25EaXNwb3NlKCgpID0+IHRoaXMuZGlzcG9zZSgpKTtcclxuICAgIGxvZygnV29ya2luZyBIb3VycyBEYXNoYm9hcmQgaW5pdGlhbGl6ZWQnKTtcclxuICB9XHJcblxyXG4gIGRpc3Bvc2UoKTogdm9pZCB7XHJcbiAgICB0aGlzLl9vdmVybGF5RWw/LnJlbW92ZSgpOyB0aGlzLl9vdmVybGF5RWwgPSBudWxsO1xyXG4gICAgdGhpcy5fZGV0YWlsRWw/LnJlbW92ZSgpOyB0aGlzLl9kZXRhaWxFbCA9IG51bGw7XHJcbiAgICB0aGlzLl9kYXRhID0gW107XHJcbiAgICB0aGlzLl9hY3RpdmUgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIHRvZ2dsZSgpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5jb25maWcuZmVhdHVyZXMud29ya2luZ0hvdXJzKSB7XHJcbiAgICAgIGFsZXJ0KCdXb3JraW5nIEhvdXJzIERhc2hib2FyZCBpc3QgZGVha3RpdmllcnQuIEJpdHRlIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGFrdGl2aWVyZW4uJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuaW5pdCgpO1xyXG4gICAgaWYgKHRoaXMuX2FjdGl2ZSkgdGhpcy5oaWRlKCk7IGVsc2UgdGhpcy5zaG93KCk7XHJcbiAgfVxyXG5cclxuICBzaG93KCk6IHZvaWQge1xyXG4gICAgdGhpcy5pbml0KCk7XHJcbiAgICB0aGlzLl9vdmVybGF5RWwhLmNsYXNzTGlzdC5hZGQoJ3Zpc2libGUnKTtcclxuICAgIHRoaXMuX2FjdGl2ZSA9IHRydWU7XHJcbiAgICAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoZC1kYXRlJykgYXMgSFRNTElucHV0RWxlbWVudCkuZm9jdXMoKTtcclxuICB9XHJcblxyXG4gIGhpZGUoKTogdm9pZCB7XHJcbiAgICB0aGlzLl9vdmVybGF5RWw/LmNsYXNzTGlzdC5yZW1vdmUoJ3Zpc2libGUnKTtcclxuICAgIHRoaXMuX2FjdGl2ZSA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIERyaXZlciBuYW1lIHJlc29sdXRpb24gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgYXN5bmMgX3Jlc29sdmVEcml2ZXJOYW1lcyhyb3dzOiBXaGRSb3dbXSwgZGF0ZTogc3RyaW5nLCBzZXJ2aWNlQXJlYUlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGFsbElkcyA9IFsuLi5uZXcgU2V0KHJvd3MubWFwKChyKSA9PiByLnRyYW5zcG9ydGVySWQpLmZpbHRlcigoaWQpOiBpZCBpcyBzdHJpbmcgPT4gaWQgIT0gbnVsbCkpXTtcclxuICAgIGNvbnN0IHVuY2FjaGVkID0gYWxsSWRzLmZpbHRlcigoaWQpID0+ICF0aGlzLl9kcml2ZXJDYWNoZS5oYXMoaWQpKTtcclxuXHJcbiAgICBpZiAodW5jYWNoZWQubGVuZ3RoID4gMCkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHF1ZXJ5RGF0ZSA9IG5ldyBEYXRlKGRhdGUgKyAnVDAwOjAwOjAwJyk7XHJcbiAgICAgICAgY29uc3QgZnJvbURhdGUgPSBuZXcgRGF0ZShxdWVyeURhdGUpOyBmcm9tRGF0ZS5zZXREYXRlKGZyb21EYXRlLmdldERhdGUoKSAtIDcpO1xyXG4gICAgICAgIGNvbnN0IHRvRGF0ZSA9IG5ldyBEYXRlKHF1ZXJ5RGF0ZSk7IHRvRGF0ZS5zZXREYXRlKHRvRGF0ZS5nZXREYXRlKCkgKyAxKTtcclxuXHJcbiAgICAgICAgY29uc3QgdXJsID0gYGh0dHBzOi8vbG9naXN0aWNzLmFtYXpvbi5kZS9zY2hlZHVsaW5nL2hvbWUvYXBpL3YyL3Jvc3RlcnM/ZnJvbURhdGU9JHtmcm9tRGF0ZS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF19JnRvRGF0ZT0ke3RvRGF0ZS50b0lTT1N0cmluZygpLnNwbGl0KCdUJylbMF19JnNlcnZpY2VBcmVhSWQ9JHtzZXJ2aWNlQXJlYUlkfWA7XHJcbiAgICAgICAgY29uc3QgY3NyZiA9IGdldENTUkZUb2tlbigpO1xyXG4gICAgICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7IEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nIH07XHJcbiAgICAgICAgaWYgKGNzcmYpIGhlYWRlcnNbJ2FudGktY3NyZnRva2VuLWEyeiddID0gY3NyZjtcclxuXHJcbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKHVybCwgeyBtZXRob2Q6ICdHRVQnLCBoZWFkZXJzLCBjcmVkZW50aWFsczogJ2luY2x1ZGUnIH0pO1xyXG4gICAgICAgIGlmIChyZXNwLm9rKSB7XHJcbiAgICAgICAgICBjb25zdCBqc29uID0gYXdhaXQgcmVzcC5qc29uKCk7XHJcbiAgICAgICAgICBjb25zdCByb3N0ZXIgPSBBcnJheS5pc0FycmF5KGpzb24pID8ganNvbiA6IGpzb24/LmRhdGEgfHwganNvbj8ucm9zdGVycyB8fCBbXTtcclxuICAgICAgICAgIGNvbnN0IHByb2Nlc3NFbnRyaWVzID0gKGVudHJpZXM6IEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+PikgPT4ge1xyXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcclxuICAgICAgICAgICAgICBpZiAoZW50cnlbJ2RyaXZlclBlcnNvbklkJ10gJiYgZW50cnlbJ2RyaXZlck5hbWUnXSkge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5fZHJpdmVyQ2FjaGUuc2V0KFN0cmluZyhlbnRyeVsnZHJpdmVyUGVyc29uSWQnXSksIGVudHJ5Wydkcml2ZXJOYW1lJ10gYXMgc3RyaW5nKTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH07XHJcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShyb3N0ZXIpKSBwcm9jZXNzRW50cmllcyhyb3N0ZXIpO1xyXG4gICAgICAgICAgZWxzZSBpZiAodHlwZW9mIHJvc3RlciA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCB2YWwgb2YgT2JqZWN0LnZhbHVlcyhyb3N0ZXIgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XHJcbiAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkgcHJvY2Vzc0VudHJpZXModmFsIGFzIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+Pik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGxvZyhgW1dIRF0gUm9zdGVyIGxvYWRlZDogJHt0aGlzLl9kcml2ZXJDYWNoZS5zaXplfSBkcml2ZXIgbmFtZXMgY2FjaGVkYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgbG9nKCdbV0hEXSBSb3N0ZXIgbG9va3VwIGZhaWxlZCAobm9uLWZhdGFsKTonLCBlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcclxuICAgICAgaWYgKHJvdy50cmFuc3BvcnRlcklkKSB7XHJcbiAgICAgICAgcm93LmRyaXZlck5hbWUgPSB0aGlzLl9kcml2ZXJDYWNoZS5nZXQocm93LnRyYW5zcG9ydGVySWQpIHx8IG51bGw7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBEYXRhIEZldGNoaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIGFzeW5jIF9mZXRjaERhdGEoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBkYXRlID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC13aGQtZGF0ZScpIGFzIEhUTUxJbnB1dEVsZW1lbnQpPy52YWx1ZTtcclxuICAgIGNvbnN0IHNlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC13aGQtc2EnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCB8IG51bGw7XHJcbiAgICBjb25zdCBzZXJ2aWNlQXJlYUlkID0gKHNlbCAmJiBzZWwudmFsdWUpID8gc2VsLnZhbHVlIDogdGhpcy5jb21wYW55Q29uZmlnLmdldERlZmF1bHRTZXJ2aWNlQXJlYUlkKCk7XHJcblxyXG4gICAgaWYgKCFkYXRlKSB7IHRoaXMuX3NldFN0YXR1cygnXHUyNkEwXHVGRTBGIEJpdHRlIERhdHVtIGF1c3dcdTAwRTRobGVuLicpOyByZXR1cm47IH1cclxuICAgIGlmICghc2VydmljZUFyZWFJZCkgeyB0aGlzLl9zZXRTdGF0dXMoJ1x1MjZBMFx1RkUwRiBCaXR0ZSBTZXJ2aWNlIEFyZWEgYXVzd1x1MDBFNGhsZW4uJyk7IHJldHVybjsgfVxyXG5cclxuICAgIHRoaXMuX3NldFN0YXR1cyhgXHUyM0YzIExhZGUgRGF0ZW4gZlx1MDBGQ3IgJHtkYXRlfVx1MjAyNmApO1xyXG4gICAgdGhpcy5fc2V0Qm9keSgnPGRpdiBjbGFzcz1cImN0LXdoZC1sb2FkaW5nXCIgcm9sZT1cInN0YXR1c1wiPkRhdGVuIHdlcmRlbiBnZWxhZGVuXHUyMDI2PC9kaXY+Jyk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgYXBpVXJsID0gYGh0dHBzOi8vbG9naXN0aWNzLmFtYXpvbi5kZS9vcGVyYXRpb25zL2V4ZWN1dGlvbi9hcGkvc3VtbWFyaWVzP2hpc3RvcmljYWxEYXk9ZmFsc2UmbG9jYWxEYXRlPSR7ZGF0ZX0mc2VydmljZUFyZWFJZD0ke3NlcnZpY2VBcmVhSWR9YDtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB3aXRoUmV0cnkoYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaChhcGlVcmwsIHtcclxuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsIGNyZWRlbnRpYWxzOiAnc2FtZS1vcmlnaW4nLFxyXG4gICAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgICBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uLCB0ZXh0L3BsYWluLCAqLyonLFxyXG4gICAgICAgICAgICAnQWNjZXB0LUxhbmd1YWdlJzogJ2RlLGVuLVVTO3E9MC43LGVuO3E9MC4zJyxcclxuICAgICAgICAgICAgJ3VzZXItcmVmJzogJ2NvcnRleC13ZWJhcHAtdXNlcicsXHJcbiAgICAgICAgICAgICdYLUNvcnRleC1UaW1lc3RhbXAnOiBEYXRlLm5vdygpLnRvU3RyaW5nKCksXHJcbiAgICAgICAgICAgICdYLUNvcnRleC1TZXNzaW9uJzogZXh0cmFjdFNlc3Npb25Gcm9tQ29va2llKCkgPz8gJycsXHJcbiAgICAgICAgICAgIFJlZmVyZXI6IGxvY2F0aW9uLmhyZWYsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9OiAke3Iuc3RhdHVzVGV4dH1gKTtcclxuICAgICAgICByZXR1cm4gcjtcclxuICAgICAgfSwgeyByZXRyaWVzOiAyLCBiYXNlTXM6IDgwMCB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXNwLmpzb24oKTtcclxuICAgICAgY29uc3Qgc3VtbWFyaWVzID0ganNvbj8uaXRpbmVyYXJ5U3VtbWFyaWVzIHx8IGpzb24/LnN1bW1hcmllcyB8fCBqc29uPy5kYXRhPy5pdGluZXJhcnlTdW1tYXJpZXMgfHwganNvbj8uZGF0YSB8fCAoQXJyYXkuaXNBcnJheShqc29uKSA/IGpzb24gOiBbXSk7XHJcblxyXG4gICAgICBpZiAoc3VtbWFyaWVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHRoaXMuX2RhdGEgPSBbXTtcclxuICAgICAgICB0aGlzLl9zZXRCb2R5KGA8ZGl2IGNsYXNzPVwiY3Qtd2hkLWVtcHR5XCI+XHVEODNEXHVEQ0VEIEtlaW5lIEl0aW5lcmFyaWVzIGdlZnVuZGVuLjxicj48c21hbGw+Qml0dGUgRGF0dW0vU2VydmljZSBBcmVhIHByXHUwMEZDZmVuLjwvc21hbGw+PC9kaXY+YCk7XHJcbiAgICAgICAgdGhpcy5fc2V0U3RhdHVzKCdcdTI2QTBcdUZFMEYgS2VpbmUgRGF0ZW4gZlx1MDBGQ3IgZGllc2VuIFRhZy9TZXJ2aWNlIEFyZWEuJyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLl9kYXRhID0gKHN1bW1hcmllcyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdKS5tYXAod2hkRXh0cmFjdFJvdyk7XHJcbiAgICAgIHRoaXMuX3NldFN0YXR1cyhgXHUyM0YzICR7dGhpcy5fZGF0YS5sZW5ndGh9IEl0aW5lcmFyaWVzIGdlbGFkZW4sIGxhZGUgRmFocmVybmFtZW5cdTIwMjZgKTtcclxuICAgICAgYXdhaXQgdGhpcy5fcmVzb2x2ZURyaXZlck5hbWVzKHRoaXMuX2RhdGEsIGRhdGUsIHNlcnZpY2VBcmVhSWQpO1xyXG5cclxuICAgICAgdGhpcy5fcGFnZSA9IDE7XHJcbiAgICAgIHRoaXMuX3NvcnQgPSB7IGNvbHVtbjogJ3JvdXRlQ29kZScsIGRpcmVjdGlvbjogJ2FzYycgfTtcclxuICAgICAgdGhpcy5fcmVuZGVyVGFibGUoKTtcclxuXHJcbiAgICAgIGNvbnN0IHN0YXRpb25Db2RlID0gdGhpcy5jb21wYW55Q29uZmlnLmdldFNlcnZpY2VBcmVhcygpLmZpbmQoKHNhKSA9PiBzYS5zZXJ2aWNlQXJlYUlkID09PSBzZXJ2aWNlQXJlYUlkKT8uc3RhdGlvbkNvZGUgfHwgc2VydmljZUFyZWFJZDtcclxuICAgICAgY29uc3QgcmVzb2x2ZWRDb3VudCA9IHRoaXMuX2RhdGEuZmlsdGVyKChyKSA9PiByLmRyaXZlck5hbWUgIT09IG51bGwpLmxlbmd0aDtcclxuICAgICAgdGhpcy5fc2V0U3RhdHVzKGBcdTI3MDUgJHt0aGlzLl9kYXRhLmxlbmd0aH0gSXRpbmVyYXJpZXMgZ2VsYWRlbiBcdTIwMTQgJHtkYXRlfSAvICR7c3RhdGlvbkNvZGV9IHwgJHtyZXNvbHZlZENvdW50fSBGYWhyZXIgenVnZW9yZG5ldGApO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBlcnIoJ1dIRCBmZXRjaCBmYWlsZWQ6JywgZSk7XHJcbiAgICAgIHRoaXMuX2RhdGEgPSBbXTtcclxuICAgICAgdGhpcy5fc2V0Qm9keShgPGRpdiBjbGFzcz1cImN0LXdoZC1lcnJvclwiIHJvbGU9XCJhbGVydFwiPlx1Mjc0QyBEYXRlbiBrb25udGVuIG5pY2h0IGdlbGFkZW4gd2VyZGVuLjxicj48c21hbGw+JHtlc2MoKGUgYXMgRXJyb3IpLm1lc3NhZ2UpfTwvc21hbGw+PGJyPjxicj48YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tYWNjZW50XCIgaWQ9XCJjdC13aGQtcmV0cnlcIj5cdUQ4M0RcdUREMDQgRXJuZXV0IHZlcnN1Y2hlbjwvYnV0dG9uPjwvZGl2PmApO1xyXG4gICAgICB0aGlzLl9zZXRTdGF0dXMoJ1x1Mjc0QyBGZWhsZXIgYmVpbSBMYWRlbi4nKTtcclxuICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoZC1yZXRyeScpPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuX2ZldGNoRGF0YSgpKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBUYWJsZSBSZW5kZXJpbmcgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX3JlbmRlclRhYmxlKCk6IHZvaWQge1xyXG4gICAgY29uc3Qgc29ydGVkID0gd2hkU29ydFJvd3ModGhpcy5fZGF0YSwgdGhpcy5fc29ydC5jb2x1bW4sIHRoaXMuX3NvcnQuZGlyZWN0aW9uKTtcclxuICAgIGNvbnN0IHRvdGFsUGFnZXMgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwoc29ydGVkLmxlbmd0aCAvIHRoaXMuX3BhZ2VTaXplKSk7XHJcbiAgICBpZiAodGhpcy5fcGFnZSA+IHRvdGFsUGFnZXMpIHRoaXMuX3BhZ2UgPSB0b3RhbFBhZ2VzO1xyXG4gICAgY29uc3Qgc3RhcnQgPSAodGhpcy5fcGFnZSAtIDEpICogdGhpcy5fcGFnZVNpemU7XHJcbiAgICBjb25zdCBzbGljZSA9IHNvcnRlZC5zbGljZShzdGFydCwgc3RhcnQgKyB0aGlzLl9wYWdlU2l6ZSk7XHJcblxyXG4gICAgY29uc3QgdGhTb3J0SWNvbiA9IChjb2w6IHN0cmluZykgPT4ge1xyXG4gICAgICBpZiAodGhpcy5fc29ydC5jb2x1bW4gIT09IGNvbCkgcmV0dXJuICcnO1xyXG4gICAgICByZXR1cm4gYDxzcGFuIGNsYXNzPVwiY3Qtd2hkLXNvcnQtaWNvblwiPiR7dGhpcy5fc29ydC5kaXJlY3Rpb24gPT09ICdhc2MnID8gJ1x1MjVCMicgOiAnXHUyNUJDJ308L3NwYW4+YDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgYXJpYVNvcnQgPSAoY29sOiBzdHJpbmcpID0+IHtcclxuICAgICAgaWYgKHRoaXMuX3NvcnQuY29sdW1uICE9PSBjb2wpIHJldHVybiAnbm9uZSc7XHJcbiAgICAgIHJldHVybiB0aGlzLl9zb3J0LmRpcmVjdGlvbiA9PT0gJ2FzYycgPyAnYXNjZW5kaW5nJyA6ICdkZXNjZW5kaW5nJztcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgdGhIdG1sID0gV0hEX0NPTFVNTlMubWFwKChoKSA9PlxyXG4gICAgICBgPHRoIHNjb3BlPVwiY29sXCIgcm9sZT1cImNvbHVtbmhlYWRlclwiIGFyaWEtc29ydD1cIiR7YXJpYVNvcnQoaC5rZXkpfVwiIGRhdGEtc29ydD1cIiR7aC5rZXl9XCIgdGl0bGU9XCJTb3J0IGJ5ICR7ZXNjKGgubGFiZWwpfVwiPlxyXG4gICAgICAgICR7ZXNjKGgubGFiZWwpfSR7dGhTb3J0SWNvbihoLmtleSl9XHJcbiAgICAgIDwvdGg+YCxcclxuICAgICkuam9pbignJyk7XHJcblxyXG4gICAgY29uc3QgdHJIdG1sID0gc2xpY2UubWFwKChyb3cpID0+IHtcclxuICAgICAgY29uc3QgY2VsbHMgPSBXSERfQ09MVU1OUy5tYXAoKGgpID0+IHtcclxuICAgICAgICBjb25zdCB2YWwgPSByb3dbaC5rZXldO1xyXG4gICAgICAgIGlmIChoLmtleSA9PT0gJ2RyaXZlck5hbWUnKSB7XHJcbiAgICAgICAgICByZXR1cm4gdmFsID09PSBudWxsIHx8IHZhbCA9PT0gdW5kZWZpbmVkXHJcbiAgICAgICAgICAgID8gJzx0ZCBjbGFzcz1cImN0LXdoZC1kcml2ZXIgY3Qtbm9kYXRhXCI+VW5hc3NpZ25lZDwvdGQ+J1xyXG4gICAgICAgICAgICA6IGA8dGQgY2xhc3M9XCJjdC13aGQtZHJpdmVyXCI+JHtlc2MoU3RyaW5nKHZhbCkpfTwvdGQ+YDtcclxuICAgICAgICB9XHJcbiAgICAgICAgaWYgKHZhbCA9PT0gbnVsbCB8fCB2YWwgPT09IHVuZGVmaW5lZCkgcmV0dXJuICc8dGQgY2xhc3M9XCJjdC1ub2RhdGFcIj5cdTIwMTQ8L3RkPic7XHJcbiAgICAgICAgc3dpdGNoIChoLnR5cGUpIHtcclxuICAgICAgICAgIGNhc2UgJ2R1cmF0aW9uJzogcmV0dXJuIGA8dGQ+JHtlc2Mod2hkRm9ybWF0RHVyYXRpb24odmFsIGFzIG51bWJlcikpfTwvdGQ+YDtcclxuICAgICAgICAgIGNhc2UgJ3RpbWUnOiAgICAgcmV0dXJuIGA8dGQ+JHtlc2Mod2hkRm9ybWF0VGltZSh2YWwgYXMgbnVtYmVyKSl9PC90ZD5gO1xyXG4gICAgICAgICAgZGVmYXVsdDogICAgICAgICByZXR1cm4gYDx0ZD4ke2VzYyhTdHJpbmcodmFsKSl9PC90ZD5gO1xyXG4gICAgICAgIH1cclxuICAgICAgfSkuam9pbignJyk7XHJcbiAgICAgIHJldHVybiBgPHRyIGRhdGEtaXRpbmVyYXJ5LWlkPVwiJHtlc2Mocm93Lml0aW5lcmFyeUlkIHx8ICcnKX1cIiByb2xlPVwicm93XCIgdGFiaW5kZXg9XCIwXCI+JHtjZWxsc308L3RyPmA7XHJcbiAgICB9KS5qb2luKCcnKTtcclxuXHJcbiAgICBjb25zdCBwYWdpbmF0aW9uSHRtbCA9IHRoaXMuX3JlbmRlclBhZ2luYXRpb24oc29ydGVkLmxlbmd0aCwgdGhpcy5fcGFnZSwgdG90YWxQYWdlcyk7XHJcblxyXG4gICAgdGhpcy5fc2V0Qm9keShgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC13aGQtdGFibGUtd3JhcFwiPlxyXG4gICAgICAgIDx0YWJsZSBjbGFzcz1cImN0LXRhYmxlIGN0LXdoZC10YWJsZVwiIHJvbGU9XCJncmlkXCIgYXJpYS1sYWJlbD1cIldvcmtpbmcgSG91cnMgRGFzaGJvYXJkXCI+XHJcbiAgICAgICAgICA8dGhlYWQ+PHRyPiR7dGhIdG1sfTwvdHI+PC90aGVhZD5cclxuICAgICAgICAgIDx0Ym9keT4ke3RySHRtbH08L3Rib2R5PlxyXG4gICAgICAgIDwvdGFibGU+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICAke3BhZ2luYXRpb25IdG1sfWApO1xyXG5cclxuICAgIHRoaXMuX2F0dGFjaFRhYmxlSGFuZGxlcnMoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX2F0dGFjaFRhYmxlSGFuZGxlcnMoKTogdm9pZCB7XHJcbiAgICBjb25zdCBib2R5ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoZC1ib2R5Jyk7XHJcbiAgICBpZiAoIWJvZHkpIHJldHVybjtcclxuXHJcbiAgICBib2R5LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KCd0aFtkYXRhLXNvcnRdJykuZm9yRWFjaCgodGgpID0+IHtcclxuICAgICAgdGguYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgICAgY29uc3QgY29sID0gdGguZGF0YXNldFsnc29ydCddITtcclxuICAgICAgICBpZiAodGhpcy5fc29ydC5jb2x1bW4gPT09IGNvbCkge1xyXG4gICAgICAgICAgdGhpcy5fc29ydC5kaXJlY3Rpb24gPSB0aGlzLl9zb3J0LmRpcmVjdGlvbiA9PT0gJ2FzYycgPyAnZGVzYycgOiAnYXNjJztcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgdGhpcy5fc29ydC5jb2x1bW4gPSBjb2w7XHJcbiAgICAgICAgICB0aGlzLl9zb3J0LmRpcmVjdGlvbiA9ICdhc2MnO1xyXG4gICAgICAgIH1cclxuICAgICAgICB0aGlzLl9yZW5kZXJUYWJsZSgpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGJvZHkucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJ3RyW2RhdGEtaXRpbmVyYXJ5LWlkXScpLmZvckVhY2goKHRyKSA9PiB7XHJcbiAgICAgIHRyLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4geyBjb25zdCBpZCA9IHRyLmRhdGFzZXRbJ2l0aW5lcmFyeUlkJ107IGlmIChpZCkgdGhpcy5fc2hvd0RldGFpbChpZCk7IH0pO1xyXG4gICAgICB0ci5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgKGUpID0+IHtcclxuICAgICAgICBpZiAoZS5rZXkgPT09ICdFbnRlcicgfHwgZS5rZXkgPT09ICcgJykgeyBlLnByZXZlbnREZWZhdWx0KCk7IGNvbnN0IGlkID0gdHIuZGF0YXNldFsnaXRpbmVyYXJ5SWQnXTsgaWYgKGlkKSB0aGlzLl9zaG93RGV0YWlsKGlkKTsgfVxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGJvZHkucXVlcnlTZWxlY3RvcignLmN0LXdoZC1wcmV2Jyk/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICBpZiAodGhpcy5fcGFnZSA+IDEpIHsgdGhpcy5fcGFnZS0tOyB0aGlzLl9yZW5kZXJUYWJsZSgpOyB9XHJcbiAgICB9KTtcclxuICAgIGJvZHkucXVlcnlTZWxlY3RvcignLmN0LXdoZC1uZXh0Jyk/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICBjb25zdCB0b3RhbFBhZ2VzID0gTWF0aC5jZWlsKHRoaXMuX2RhdGEubGVuZ3RoIC8gdGhpcy5fcGFnZVNpemUpO1xyXG4gICAgICBpZiAodGhpcy5fcGFnZSA8IHRvdGFsUGFnZXMpIHsgdGhpcy5fcGFnZSsrOyB0aGlzLl9yZW5kZXJUYWJsZSgpOyB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX3JlbmRlclBhZ2luYXRpb24odG90YWw6IG51bWJlciwgY3VycmVudDogbnVtYmVyLCB0b3RhbFBhZ2VzOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gICAgaWYgKHRvdGFsUGFnZXMgPD0gMSkgcmV0dXJuICcnO1xyXG4gICAgcmV0dXJuIGBcclxuICAgICAgPGRpdiBjbGFzcz1cImN0LXdoZC1wYWdpbmF0aW9uXCI+XHJcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXNlY29uZGFyeSBjdC13aGQtcHJldlwiICR7Y3VycmVudCA8PSAxID8gJ2Rpc2FibGVkJyA6ICcnfSBhcmlhLWxhYmVsPVwiVm9yaGVyaWdlIFNlaXRlXCI+XHUyMDM5IFp1clx1MDBGQ2NrPC9idXR0b24+XHJcbiAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC13aGQtcGFnZS1pbmZvXCI+U2VpdGUgJHtjdXJyZW50fSAvICR7dG90YWxQYWdlc30gKCR7dG90YWx9IEVpbnRyXHUwMEU0Z2UpPC9zcGFuPlxyXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1zZWNvbmRhcnkgY3Qtd2hkLW5leHRcIiAke2N1cnJlbnQgPj0gdG90YWxQYWdlcyA/ICdkaXNhYmxlZCcgOiAnJ30gYXJpYS1sYWJlbD1cIk5cdTAwRTRjaHN0ZSBTZWl0ZVwiPldlaXRlciBcdTIwM0E8L2J1dHRvbj5cclxuICAgICAgPC9kaXY+YDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX3Nob3dEZXRhaWwoaXRpbmVyYXJ5SWQ6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgY29uc3Qgcm93ID0gdGhpcy5fZGF0YS5maW5kKChyKSA9PiByLml0aW5lcmFyeUlkID09PSBpdGluZXJhcnlJZCk7XHJcbiAgICBpZiAoIXJvdykgcmV0dXJuO1xyXG5cclxuICAgIHRoaXMuX2RldGFpbEVsPy5yZW1vdmUoKTsgdGhpcy5fZGV0YWlsRWwgPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IGZvcm1hdEZvckRpc3BsYXkgPSAoZmllbGQ6IHR5cGVvZiBXSERfREVUQUlMX0ZJRUxEU1tudW1iZXJdLCB2YWx1ZTogdW5rbm93bik6IHN0cmluZyA9PiB7XHJcbiAgICAgIGlmICh2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgICAgIHN3aXRjaCAoZmllbGQuZm9ybWF0KSB7XHJcbiAgICAgICAgY2FzZSAndGltZSc6ICAgICByZXR1cm4gd2hkRm9ybWF0VGltZSh2YWx1ZSBhcyBudW1iZXIpO1xyXG4gICAgICAgIGNhc2UgJ2R1cmF0aW9uJzogcmV0dXJuIHdoZEZvcm1hdER1cmF0aW9uKHZhbHVlIGFzIG51bWJlcik7XHJcbiAgICAgICAgY2FzZSAnaW50ZWdlcic6ICByZXR1cm4gU3RyaW5nKHZhbHVlKSArIChmaWVsZC5zdWZmaXggfHwgJycpO1xyXG4gICAgICAgIGRlZmF1bHQ6ICAgICAgICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgZmllbGRzSHRtbCA9IFdIRF9ERVRBSUxfRklFTERTLm1hcCgoZikgPT4ge1xyXG4gICAgICBjb25zdCBkaXNwbGF5VmFsdWUgPSBmb3JtYXRGb3JEaXNwbGF5KGYsIHJvd1tmLmtleV0pO1xyXG4gICAgICByZXR1cm4gYDxkaXYgY2xhc3M9XCJjdC13aGQtZGV0YWlsLXJvd1wiPlxyXG4gICAgICAgIDxkaXY+XHJcbiAgICAgICAgICA8c3BhbiBjbGFzcz1cImN0LXdoZC1kZXRhaWwtbGFiZWxcIj4ke2VzYyhmLmxhYmVsKX08L3NwYW4+PGJyPlxyXG4gICAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC13aGQtZGV0YWlsLXZhbHVlXCI+JHtlc2MoZGlzcGxheVZhbHVlKX08L3NwYW4+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LXdoZC1jb3B5LWJ0blwiIGRhdGEtY29weS12YWx1ZT1cIiR7ZXNjKGRpc3BsYXlWYWx1ZSl9XCIgYXJpYS1sYWJlbD1cIkNvcHkgJHtlc2MoZi5sYWJlbCl9XCI+XHVEODNEXHVEQ0NCIENvcHk8L2J1dHRvbj5cclxuICAgICAgPC9kaXY+YDtcclxuICAgIH0pLmpvaW4oJycpO1xyXG5cclxuICAgIGNvbnN0IGFsbFRleHQgPSBXSERfREVUQUlMX0ZJRUxEUy5tYXAoKGYpID0+IGAke2YubGFiZWx9OiAke2Zvcm1hdEZvckRpc3BsYXkoZiwgcm93W2Yua2V5XSl9YCkuam9pbignXFxuJyk7XHJcblxyXG4gICAgY29uc3QgbW9kYWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICAgIG1vZGFsLmNsYXNzTmFtZSA9ICdjdC1vdmVybGF5IHZpc2libGUnO1xyXG4gICAgbW9kYWwuc2V0QXR0cmlidXRlKCdyb2xlJywgJ2RpYWxvZycpO1xyXG4gICAgbW9kYWwuc2V0QXR0cmlidXRlKCdhcmlhLW1vZGFsJywgJ3RydWUnKTtcclxuICAgIG1vZGFsLmlubmVySFRNTCA9IGBcclxuICAgICAgPGRpdiBjbGFzcz1cImN0LWRpYWxvZ1wiIHN0eWxlPVwibWluLXdpZHRoOjQyMHB4O21heC13aWR0aDo1ODBweDtcIj5cclxuICAgICAgICA8ZGl2IHN0eWxlPVwiZGlzcGxheTpmbGV4O2p1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuO2FsaWduLWl0ZW1zOmNlbnRlcjttYXJnaW4tYm90dG9tOjE2cHg7XCI+XHJcbiAgICAgICAgICA8aDMgc3R5bGU9XCJtYXJnaW46MDtjb2xvcjp2YXIoLS1jdC1wcmltYXJ5KTtcIj5cdUQ4M0RcdURDQ0IgSXRpbmVyYXJ5IERldGFpbHM8L2gzPlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWNsb3NlXCIgaWQ9XCJjdC13aGQtZGV0YWlsLWNsb3NlXCIgYXJpYS1sYWJlbD1cIkNsb3NlXCIgc3R5bGU9XCJtYXJnaW4tbGVmdDphdXRvO1wiPlx1MjcxNTwvYnV0dG9uPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgICR7ZmllbGRzSHRtbH1cclxuICAgICAgICA8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxNnB4O3RleHQtYWxpZ246Y2VudGVyO1wiPlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXByaW1hcnlcIiBpZD1cImN0LXdoZC1jb3B5LWFsbFwiPlx1RDgzRFx1RENDQiBDb3B5IEFsbDwvYnV0dG9uPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICA8L2Rpdj5gO1xyXG5cclxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQobW9kYWwpO1xyXG4gICAgdGhpcy5fZGV0YWlsRWwgPSBtb2RhbDtcclxuXHJcbiAgICBjb25zdCBjbG9zZU1vZGFsID0gKCkgPT4geyBtb2RhbC5yZW1vdmUoKTsgdGhpcy5fZGV0YWlsRWwgPSBudWxsOyB9O1xyXG4gICAgbW9kYWwuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4geyBpZiAoZS50YXJnZXQgPT09IG1vZGFsKSBjbG9zZU1vZGFsKCk7IH0pO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoZC1kZXRhaWwtY2xvc2UnKSEuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBjbG9zZU1vZGFsKTtcclxuICAgIG1vZGFsLmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCAoZSkgPT4geyBpZiAoKGUgYXMgS2V5Ym9hcmRFdmVudCkua2V5ID09PSAnRXNjYXBlJykgY2xvc2VNb2RhbCgpOyB9KTtcclxuXHJcbiAgICBtb2RhbC5xdWVyeVNlbGVjdG9yQWxsPEhUTUxFbGVtZW50PignLmN0LXdoZC1jb3B5LWJ0bicpLmZvckVhY2goKGJ0bikgPT4ge1xyXG4gICAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4ge1xyXG4gICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgY29uc3QgdmFsID0gYnRuLmRhdGFzZXRbJ2NvcHlWYWx1ZSddITtcclxuICAgICAgICBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dCh2YWwpLnRoZW4oKCkgPT4ge1xyXG4gICAgICAgICAgY29uc3Qgb3JpZyA9IGJ0bi50ZXh0Q29udGVudDsgYnRuLnRleHRDb250ZW50ID0gJ1x1MjcwNSBDb3BpZWQhJztcclxuICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4geyBidG4udGV4dENvbnRlbnQgPSBvcmlnOyB9LCAxNTAwKTtcclxuICAgICAgICB9KS5jYXRjaCgoKSA9PiB7IGJ0bi50ZXh0Q29udGVudCA9ICdcdTI2QTBcdUZFMEYgRmFpbGVkJzsgc2V0VGltZW91dCgoKSA9PiB7IGJ0bi50ZXh0Q29udGVudCA9ICdcdUQ4M0RcdURDQ0IgQ29weSc7IH0sIDE1MDApOyB9KTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hkLWNvcHktYWxsJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hkLWNvcHktYWxsJykhO1xyXG4gICAgICBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChhbGxUZXh0KS50aGVuKCgpID0+IHtcclxuICAgICAgICBidG4udGV4dENvbnRlbnQgPSAnXHUyNzA1IEFsbCBDb3BpZWQhJzsgc2V0VGltZW91dCgoKSA9PiB7IGJ0bi50ZXh0Q29udGVudCA9ICdcdUQ4M0RcdURDQ0IgQ29weSBBbGwnOyB9LCAxNTAwKTtcclxuICAgICAgfSkuY2F0Y2goKCkgPT4geyBidG4udGV4dENvbnRlbnQgPSAnXHUyNkEwXHVGRTBGIEZhaWxlZCc7IHNldFRpbWVvdXQoKCkgPT4geyBidG4udGV4dENvbnRlbnQgPSAnXHVEODNEXHVEQ0NCIENvcHkgQWxsJzsgfSwgMTUwMCk7IH0pO1xyXG4gICAgfSk7XHJcblxyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoZC1kZXRhaWwtY2xvc2UnKSEuZm9jdXMoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX2V4cG9ydENTVigpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5fZGF0YSB8fCB0aGlzLl9kYXRhLmxlbmd0aCA9PT0gMCkgeyBhbGVydCgnQml0dGUgenVlcnN0IERhdGVuIGxhZGVuLicpOyByZXR1cm47IH1cclxuXHJcbiAgICBjb25zdCBzZXAgPSAnOyc7XHJcbiAgICBjb25zdCBjc3ZIZWFkZXJzID0gWydyb3V0ZUNvZGUnLCAnc2VydmljZVR5cGVOYW1lJywgJ2Jsb2NrRHVyYXRpb25Jbk1pbnV0ZXMnLCAnd2F2ZVN0YXJ0VGltZScsICdpdGluZXJhcnlTdGFydFRpbWUnLCAncGxhbm5lZERlcGFydHVyZVRpbWUnLCAnYWN0dWFsRGVwYXJ0dXJlVGltZScsICdwbGFubmVkT3V0Ym91bmRTdGVtVGltZScsICdhY3R1YWxPdXRib3VuZFN0ZW1UaW1lJywgJ2xhc3REcml2ZXJFdmVudFRpbWUnLCAnaXRpbmVyYXJ5SWQnXTtcclxuXHJcbiAgICBsZXQgY3N2ID0gY3N2SGVhZGVycy5qb2luKHNlcCkgKyAnXFxuJztcclxuICAgIGNvbnN0IHNvcnRlZCA9IHdoZFNvcnRSb3dzKHRoaXMuX2RhdGEsIHRoaXMuX3NvcnQuY29sdW1uLCB0aGlzLl9zb3J0LmRpcmVjdGlvbik7XHJcblxyXG4gICAgZm9yIChjb25zdCByb3cgb2Ygc29ydGVkKSB7XHJcbiAgICAgIGNvbnN0IGNlbGxzID0gY3N2SGVhZGVycy5tYXAoKGgpID0+IHtcclxuICAgICAgICBjb25zdCB2YWwgPSByb3dbaF07XHJcbiAgICAgICAgaWYgKHZhbCA9PT0gbnVsbCB8fCB2YWwgPT09IHVuZGVmaW5lZCkgcmV0dXJuICcnO1xyXG4gICAgICAgIGlmIChoID09PSAncGxhbm5lZE91dGJvdW5kU3RlbVRpbWUnIHx8IGggPT09ICdhY3R1YWxPdXRib3VuZFN0ZW1UaW1lJykgcmV0dXJuIHdoZEZvcm1hdER1cmF0aW9uKHZhbCBhcyBudW1iZXIpO1xyXG4gICAgICAgIGlmIChoID09PSAncm91dGVDb2RlJyB8fCBoID09PSAnc2VydmljZVR5cGVOYW1lJyB8fCBoID09PSAnaXRpbmVyYXJ5SWQnIHx8IGggPT09ICdibG9ja0R1cmF0aW9uSW5NaW51dGVzJykgcmV0dXJuIFN0cmluZyh2YWwpO1xyXG4gICAgICAgIHJldHVybiB3aGRGb3JtYXRUaW1lKHZhbCBhcyBudW1iZXIpO1xyXG4gICAgICB9KTtcclxuICAgICAgY3N2ICs9IGNlbGxzLmpvaW4oc2VwKSArICdcXG4nO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGRhdGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXdoZC1kYXRlJykgYXMgSFRNTElucHV0RWxlbWVudCk/LnZhbHVlIHx8IHRvZGF5U3RyKCk7XHJcbiAgICBjb25zdCBzZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hkLXNhJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQgfCBudWxsO1xyXG4gICAgY29uc3Qgc2FJZCA9IChzZWwgJiYgc2VsLnZhbHVlKSA/IHNlbC52YWx1ZSA6ICcnO1xyXG4gICAgY29uc3Qgc3RhdGlvbkNvZGUgPSB0aGlzLmNvbXBhbnlDb25maWcuZ2V0U2VydmljZUFyZWFzKCkuZmluZCgoc2EpID0+IHNhLnNlcnZpY2VBcmVhSWQgPT09IHNhSWQpPy5zdGF0aW9uQ29kZSB8fCAndW5rbm93bic7XHJcbiAgICBjb25zdCBibG9iID0gbmV3IEJsb2IoWydcXHVGRUZGJyArIGNzdl0sIHsgdHlwZTogJ3RleHQvY3N2O2NoYXJzZXQ9dXRmLTg7JyB9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsOyBhLmRvd25sb2FkID0gYHdvcmtpbmdfaG91cnNfJHtkYXRlfV8ke3N0YXRpb25Db2RlfS5jc3ZgO1xyXG4gICAgYS5jbGljaygpOyBVUkwucmV2b2tlT2JqZWN0VVJMKHVybCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9zZXRTdGF0dXMobXNnOiBzdHJpbmcpOiB2b2lkIHsgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hkLXN0YXR1cycpOyBpZiAoZWwpIGVsLnRleHRDb250ZW50ID0gbXNnOyB9XHJcbiAgcHJpdmF0ZSBfc2V0Qm9keShodG1sOiBzdHJpbmcpOiB2b2lkIHsgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtd2hkLWJvZHknKTsgaWYgKGVsKSBlbC5pbm5lckhUTUwgPSBodG1sOyB9XHJcbn1cclxuIiwgIi8vIGZlYXR1cmVzL3JldHVybnMtZGFzaGJvYXJkLnRzIFx1MjAxMyBSZXR1cm5zIERhc2hib2FyZFxyXG5cclxuaW1wb3J0IHsgbG9nLCBlcnIsIGVzYywgdG9kYXlTdHIsIHdpdGhSZXRyeSwgZ2V0Q1NSRlRva2VuIH0gZnJvbSAnLi4vY29yZS91dGlscyc7XHJcbmltcG9ydCB7IG9uRGlzcG9zZSB9IGZyb20gJy4uL2NvcmUvdXRpbHMnO1xyXG5pbXBvcnQgdHlwZSB7IEFwcENvbmZpZyB9IGZyb20gJy4uL2NvcmUvc3RvcmFnZSc7XHJcbmltcG9ydCB0eXBlIHsgQ29tcGFueUNvbmZpZyB9IGZyb20gJy4uL2NvcmUvYXBpJztcclxuXHJcbi8vIFx1MjUwMFx1MjUwMCBQdXJlIGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG5mdW5jdGlvbiByZXRGb3JtYXRUaW1lc3RhbXAoZXBvY2hNczogdW5rbm93bik6IHN0cmluZyB7XHJcbiAgaWYgKCFlcG9jaE1zKSByZXR1cm4gJ1x1MjAxNCc7XHJcbiAgdHJ5IHtcclxuICAgIHJldHVybiBuZXcgRGF0ZShOdW1iZXIoZXBvY2hNcykpLnRvTG9jYWxlU3RyaW5nKCdkZS1ERScsIHtcclxuICAgICAgeWVhcjogJ251bWVyaWMnLCBtb250aDogJzItZGlnaXQnLCBkYXk6ICcyLWRpZ2l0JywgaG91cjogJzItZGlnaXQnLCBtaW51dGU6ICcyLWRpZ2l0JyxcclxuICAgIH0pO1xyXG4gIH0gY2F0Y2ggeyByZXR1cm4gJ1x1MjAxNCc7IH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmV0R2V0Q29vcmRzKHBrZzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB7IGxhdDogbnVtYmVyOyBsb246IG51bWJlciB9IHwgbnVsbCB7XHJcbiAgY29uc3QgYWRkciA9IChwa2dbJ2FkZHJlc3MnXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgfHwge307XHJcbiAgY29uc3QgbGF0ID0gYWRkclsnZ2VvY29kZUxhdGl0dWRlJ10gPz8gKGFkZHJbJ2dlb2NvZGUnXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik/LlsnbGF0aXR1ZGUnXTtcclxuICBjb25zdCBsb24gPSBhZGRyWydnZW9jb2RlTG9uZ2l0dWRlJ10gPz8gKGFkZHJbJ2dlb2NvZGUnXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik/LlsnbG9uZ2l0dWRlJ107XHJcbiAgaWYgKGxhdCAhPSBudWxsICYmIGxvbiAhPSBudWxsKSByZXR1cm4geyBsYXQ6IE51bWJlcihsYXQpLCBsb246IE51bWJlcihsb24pIH07XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJldFJlYXNvbkNsYXNzKGNvZGU6IHVua25vd24pOiBzdHJpbmcge1xyXG4gIGlmICghY29kZSkgcmV0dXJuICdjdC1yZXQtY2FyZC1yZWFzb24tLW9rJztcclxuICBjb25zdCBjID0gU3RyaW5nKGNvZGUpLnRvVXBwZXJDYXNlKCk7XHJcbiAgaWYgKGMuaW5jbHVkZXMoJ0RBTUFHRScpIHx8IGMuaW5jbHVkZXMoJ0RFRkVDVCcpKSByZXR1cm4gJ2N0LXJldC1jYXJkLXJlYXNvbi0tZXJyb3InO1xyXG4gIGlmIChjLmluY2x1ZGVzKCdDVVNUT01FUicpIHx8IGMuaW5jbHVkZXMoJ1JFRlVTQUwnKSkgcmV0dXJuICdjdC1yZXQtY2FyZC1yZWFzb24tLXdhcm4nO1xyXG4gIHJldHVybiAnY3QtcmV0LWNhcmQtcmVhc29uLS1vayc7XHJcbn1cclxuXHJcbi8vIFx1MjUwMFx1MjUwMCBEYXNoYm9hcmQgY2xhc3MgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG5leHBvcnQgY2xhc3MgUmV0dXJuc0Rhc2hib2FyZCB7XHJcbiAgcHJpdmF0ZSBfb3ZlcmxheUVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgX2FjdGl2ZSA9IGZhbHNlO1xyXG4gIHByaXZhdGUgX2FsbFBhY2thZ2VzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdID0gW107XHJcbiAgcHJpdmF0ZSBfZmlsdGVyZWRQYWNrYWdlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSA9IFtdO1xyXG4gIHByaXZhdGUgX3BhZ2UgPSAxO1xyXG4gIHByaXZhdGUgX3BhZ2VTaXplID0gNTA7XHJcbiAgcHJpdmF0ZSBfc29ydDogeyBmaWVsZDogc3RyaW5nOyBkaXJlY3Rpb246IHN0cmluZyB9ID0geyBmaWVsZDogJ2xhc3RVcGRhdGVkVGltZScsIGRpcmVjdGlvbjogJ2Rlc2MnIH07XHJcbiAgcHJpdmF0ZSBfZmlsdGVycyA9IHsgc2VhcmNoOiAnJywgY2l0eTogJycsIHBvc3RhbENvZGU6ICcnLCByb3V0ZUNvZGU6ICcnLCByZWFzb25Db2RlOiAnJyB9O1xyXG4gIHByaXZhdGUgX3ZpZXdNb2RlOiAndGFibGUnIHwgJ2NhcmRzJyA9ICd0YWJsZSc7XHJcbiAgcHJpdmF0ZSBfY2FjaGUgPSBuZXcgTWFwPHN0cmluZywgeyBkYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPltdOyB0aW1lc3RhbXA6IG51bWJlciB9PigpO1xyXG4gIHByaXZhdGUgX2NhY2hlRXhwaXJ5ID0gNSAqIDYwICogMTAwMDtcclxuICBwcml2YXRlIF90cmFuc3BvcnRlckNhY2hlID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogQXBwQ29uZmlnLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21wYW55Q29uZmlnOiBDb21wYW55Q29uZmlnLFxyXG4gICkge31cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIExpZmVjeWNsZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgaW5pdCgpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLl9vdmVybGF5RWwpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCB0b2RheSA9IHRvZGF5U3RyKCk7XHJcbiAgICBjb25zdCBvdmVybGF5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBvdmVybGF5LmlkID0gJ2N0LXJldC1vdmVybGF5JztcclxuICAgIG92ZXJsYXkuY2xhc3NOYW1lID0gJ2N0LW92ZXJsYXknO1xyXG4gICAgb3ZlcmxheS5zZXRBdHRyaWJ1dGUoJ3JvbGUnLCAnZGlhbG9nJyk7XHJcbiAgICBvdmVybGF5LnNldEF0dHJpYnV0ZSgnYXJpYS1tb2RhbCcsICd0cnVlJyk7XHJcbiAgICBvdmVybGF5LnNldEF0dHJpYnV0ZSgnYXJpYS1sYWJlbCcsICdSZXR1cm5zIERhc2hib2FyZCcpO1xyXG4gICAgb3ZlcmxheS5pbm5lckhUTUwgPSBgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1yZXQtcGFuZWxcIj5cclxuICAgICAgICA8aDI+XHVEODNEXHVEQ0U2IFJldHVybnMgRGFzaGJvYXJkPC9oMj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtcmV0LWNvbnRyb2xzXCI+XHJcbiAgICAgICAgICA8bGFiZWwgZm9yPVwiY3QtcmV0LWRhdGVcIj5EYXR1bTo8L2xhYmVsPlxyXG4gICAgICAgICAgPGlucHV0IHR5cGU9XCJkYXRlXCIgaWQ9XCJjdC1yZXQtZGF0ZVwiIGNsYXNzPVwiY3QtaW5wdXRcIiB2YWx1ZT1cIiR7dG9kYXl9XCI+XHJcbiAgICAgICAgICA8bGFiZWwgZm9yPVwiY3QtcmV0LXNhXCI+U2VydmljZSBBcmVhOjwvbGFiZWw+XHJcbiAgICAgICAgICA8c2VsZWN0IGlkPVwiY3QtcmV0LXNhXCIgY2xhc3M9XCJjdC1zZWxlY3RcIj48L3NlbGVjdD5cclxuICAgICAgICAgIDxsYWJlbCBzdHlsZT1cImRpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7Z2FwOjRweDttYXJnaW4tbGVmdDo4cHg7XCI+XHJcbiAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImN0LXJldC1yb3V0ZXZpZXdcIiBjaGVja2VkPiBSb3V0ZVZpZXdcclxuICAgICAgICAgIDwvbGFiZWw+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tYWNjZW50XCIgaWQ9XCJjdC1yZXQtZ29cIj5cdUQ4M0RcdUREMEQgTGFkZW48L2J1dHRvbj5cclxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1wcmltYXJ5XCIgaWQ9XCJjdC1yZXQtZXhwb3J0XCI+XHVEODNEXHVEQ0NCIEV4cG9ydDwvYnV0dG9uPlxyXG4gICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWNsb3NlXCIgaWQ9XCJjdC1yZXQtY2xvc2VcIj5cdTI3MTUgU2NobGllXHUwMERGZW48L2J1dHRvbj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGlkPVwiY3QtcmV0LWZpbHRlcnNcIiBjbGFzcz1cImN0LXJldC1maWx0ZXJzXCI+XHJcbiAgICAgICAgICA8aW5wdXQgdHlwZT1cInRleHRcIiBjbGFzcz1cImN0LWlucHV0IGN0LXJldC1zZWFyY2hcIiBpZD1cImN0LXJldC1zZWFyY2hcIiBwbGFjZWhvbGRlcj1cIlNjYW5uYWJsZUlkIHN1Y2hlbi4uLlwiIGFyaWEtbGFiZWw9XCJTdWNoZVwiPlxyXG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXJldC1maWx0ZXItZ3JvdXBcIj48bGFiZWw+U3RhZHQ6PC9sYWJlbD48aW5wdXQgdHlwZT1cInRleHRcIiBjbGFzcz1cImN0LWlucHV0XCIgaWQ9XCJjdC1yZXQtY2l0eVwiIHBsYWNlaG9sZGVyPVwiRmlsdGVyIFN0YWR0XCIgc3R5bGU9XCJ3aWR0aDoxMDBweFwiPjwvZGl2PlxyXG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXJldC1maWx0ZXItZ3JvdXBcIj48bGFiZWw+UExaOjwvbGFiZWw+PGlucHV0IHR5cGU9XCJ0ZXh0XCIgY2xhc3M9XCJjdC1pbnB1dFwiIGlkPVwiY3QtcmV0LXBvc3RhbFwiIHBsYWNlaG9sZGVyPVwiUExaXCIgc3R5bGU9XCJ3aWR0aDo4MHB4XCI+PC9kaXY+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtcmV0LWZpbHRlci1ncm91cFwiPjxsYWJlbD5Sb3V0ZTo8L2xhYmVsPjxpbnB1dCB0eXBlPVwidGV4dFwiIGNsYXNzPVwiY3QtaW5wdXRcIiBpZD1cImN0LXJldC1yb3V0ZVwiIHBsYWNlaG9sZGVyPVwiUm91dGVcIiBzdHlsZT1cIndpZHRoOjgwcHhcIj48L2Rpdj5cclxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJjdC1yZXQtZmlsdGVyLWdyb3VwXCI+PGxhYmVsPlJlYXNvbjo8L2xhYmVsPjxpbnB1dCB0eXBlPVwidGV4dFwiIGNsYXNzPVwiY3QtaW5wdXRcIiBpZD1cImN0LXJldC1yZWFzb25cIiBwbGFjZWhvbGRlcj1cIlJlYXNvbiBDb2RlXCIgc3R5bGU9XCJ3aWR0aDo4MHB4XCI+PC9kaXY+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tc2Vjb25kYXJ5XCIgaWQ9XCJjdC1yZXQtY2xlYXItZmlsdGVyc1wiPlx1MjcxNSBGaWx0ZXI8L2J1dHRvbj5cclxuICAgICAgICA8L2Rpdj5cclxuICAgICAgICA8ZGl2IGlkPVwiY3QtcmV0LXNvcnQtYmFyXCIgY2xhc3M9XCJjdC1yZXQtc29ydC1iYXJcIj5cclxuICAgICAgICAgIDxsYWJlbD5Tb3J0aWVyZW46PC9sYWJlbD5cclxuICAgICAgICAgIDxzZWxlY3QgaWQ9XCJjdC1yZXQtc29ydC1maWVsZFwiIGNsYXNzPVwiY3Qtc2VsZWN0XCI+XHJcbiAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCJsYXN0VXBkYXRlZFRpbWVcIj5aZWl0IChuZXVlc3RlKTwvb3B0aW9uPlxyXG4gICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwic2Nhbm5hYmxlSWRcIj5TY2FubmFibGVJZDwvb3B0aW9uPlxyXG4gICAgICAgICAgICA8b3B0aW9uIHZhbHVlPVwiY2l0eVwiPlN0YWR0PC9vcHRpb24+XHJcbiAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCJyb3V0ZUNvZGVcIj5Sb3V0ZTwvb3B0aW9uPlxyXG4gICAgICAgICAgPC9zZWxlY3Q+XHJcbiAgICAgICAgICA8c2VsZWN0IGlkPVwiY3QtcmV0LXNvcnQtZGlyXCIgY2xhc3M9XCJjdC1zZWxlY3RcIj5cclxuICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT1cImRlc2NcIj5BYnN0ZWlnZW5kPC9vcHRpb24+XHJcbiAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9XCJhc2NcIj5BdWZzdGVpZ2VuZDwvb3B0aW9uPlxyXG4gICAgICAgICAgPC9zZWxlY3Q+XHJcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtcmV0LXZpZXctdG9nZ2xlXCI+XHJcbiAgICAgICAgICAgIDxidXR0b24gaWQ9XCJjdC1yZXQtdmlldy10YWJsZVwiIGNsYXNzPVwiYWN0aXZlXCI+XHVEODNEXHVEQ0NCIFRhYmVsbGU8L2J1dHRvbj5cclxuICAgICAgICAgICAgPGJ1dHRvbiBpZD1cImN0LXJldC12aWV3LWNhcmRzXCI+XHUyNUE2IEthcnRlbjwvYnV0dG9uPlxyXG4gICAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgICA8c3BhbiBpZD1cImN0LXJldC1jb3VudFwiIHN0eWxlPVwibWFyZ2luLWxlZnQ6YXV0bztjb2xvcjp2YXIoLS1jdC1tdXRlZCk7XCI+PC9zcGFuPlxyXG4gICAgICAgIDwvZGl2PlxyXG4gICAgICAgIDxkaXYgaWQ9XCJjdC1yZXQtc3RhdHVzXCIgY2xhc3M9XCJjdC1zdGF0dXNcIiByb2xlPVwic3RhdHVzXCIgYXJpYS1saXZlPVwicG9saXRlXCI+PC9kaXY+XHJcbiAgICAgICAgPGRpdiBpZD1cImN0LXJldC1zdGF0c1wiPjwvZGl2PlxyXG4gICAgICAgIDxkaXYgaWQ9XCJjdC1yZXQtYm9keVwiPjwvZGl2PlxyXG4gICAgICA8L2Rpdj5cclxuICAgIGA7XHJcblxyXG4gICAgZG9jdW1lbnQuYm9keS5hcHBlbmRDaGlsZChvdmVybGF5KTtcclxuICAgIHRoaXMuX292ZXJsYXlFbCA9IG92ZXJsYXk7XHJcblxyXG4gICAgb3ZlcmxheS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7IGlmIChlLnRhcmdldCA9PT0gb3ZlcmxheSkgdGhpcy5oaWRlKCk7IH0pO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXJldC1jbG9zZScpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuaGlkZSgpKTtcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtZ28nKSEuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLl9sb2FkRGF0YSgpKTtcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtZXhwb3J0JykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5fZXhwb3J0Q1NWKCkpO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXJldC1jbGVhci1maWx0ZXJzJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5fY2xlYXJGaWx0ZXJzKCkpO1xyXG5cclxuICAgIFsnY3QtcmV0LXNlYXJjaCcsICdjdC1yZXQtY2l0eScsICdjdC1yZXQtcG9zdGFsJywgJ2N0LXJldC1yb3V0ZScsICdjdC1yZXQtcmVhc29uJ10uZm9yRWFjaCgoaWQpID0+IHtcclxuICAgICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpIS5hZGRFdmVudExpc3RlbmVyKCdpbnB1dCcsICgpID0+IHRoaXMuX2FwcGx5RmlsdGVycygpKTtcclxuICAgIH0pO1xyXG4gICAgWydjdC1yZXQtc29ydC1maWVsZCcsICdjdC1yZXQtc29ydC1kaXInXS5mb3JFYWNoKChpZCkgPT4ge1xyXG4gICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkhLmFkZEV2ZW50TGlzdGVuZXIoJ2NoYW5nZScsICgpID0+IHRoaXMuX2FwcGx5RmlsdGVycygpKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtdmlldy10YWJsZScpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgdGhpcy5fdmlld01vZGUgPSAndGFibGUnOyB0aGlzLl91cGRhdGVWaWV3VG9nZ2xlKCk7IHRoaXMuX3JlbmRlckNhcmRzKCk7XHJcbiAgICB9KTtcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtdmlldy1jYXJkcycpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcclxuICAgICAgdGhpcy5fdmlld01vZGUgPSAnY2FyZHMnOyB0aGlzLl91cGRhdGVWaWV3VG9nZ2xlKCk7IHRoaXMuX3JlbmRlckNhcmRzKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLl9pbml0U2FEcm9wZG93bigpO1xyXG4gICAgb25EaXNwb3NlKCgpID0+IHRoaXMuZGlzcG9zZSgpKTtcclxuICAgIGxvZygnUmV0dXJucyBEYXNoYm9hcmQgaW5pdGlhbGl6ZWQnKTtcclxuICB9XHJcblxyXG4gIGRpc3Bvc2UoKTogdm9pZCB7XHJcbiAgICB0aGlzLl9vdmVybGF5RWw/LnJlbW92ZSgpOyB0aGlzLl9vdmVybGF5RWwgPSBudWxsO1xyXG4gICAgdGhpcy5fYWxsUGFja2FnZXMgPSBbXTsgdGhpcy5fZmlsdGVyZWRQYWNrYWdlcyA9IFtdO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICB0b2dnbGUoKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuY29uZmlnLmZlYXR1cmVzLnJldHVybnNEYXNoYm9hcmQpIHtcclxuICAgICAgYWxlcnQoJ1JldHVybnMgRGFzaGJvYXJkIGlzdCBkZWFrdGl2aWVydC4gQml0dGUgaW4gZGVuIEVpbnN0ZWxsdW5nZW4gYWt0aXZpZXJlbi4nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgdGhpcy5pbml0KCk7XHJcbiAgICBpZiAodGhpcy5fYWN0aXZlKSB0aGlzLmhpZGUoKTsgZWxzZSB0aGlzLnNob3coKTtcclxuICB9XHJcblxyXG4gIHNob3coKTogdm9pZCB7XHJcbiAgICB0aGlzLmluaXQoKTtcclxuICAgIHRoaXMuX292ZXJsYXlFbCEuY2xhc3NMaXN0LmFkZCgndmlzaWJsZScpO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gdHJ1ZTtcclxuICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtcmV0LWRhdGUnKSBhcyBIVE1MSW5wdXRFbGVtZW50KS5mb2N1cygpO1xyXG4gIH1cclxuXHJcbiAgaGlkZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuX292ZXJsYXlFbD8uY2xhc3NMaXN0LnJlbW92ZSgndmlzaWJsZScpO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgU0EgZHJvcGRvd24gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgYXN5bmMgX2luaXRTYURyb3Bkb3duKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3Qgc2VsZWN0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXJldC1zYScpIGFzIEhUTUxTZWxlY3RFbGVtZW50O1xyXG4gICAgc2VsZWN0LmlubmVySFRNTCA9ICcnO1xyXG4gICAgYXdhaXQgdGhpcy5jb21wYW55Q29uZmlnLmxvYWQoKTtcclxuICAgIGNvbnN0IGFyZWFzID0gdGhpcy5jb21wYW55Q29uZmlnLmdldFNlcnZpY2VBcmVhcygpO1xyXG4gICAgY29uc3QgbGlzdCA9IGFyZWFzLmxlbmd0aCA+IDAgPyBhcmVhcyA6IFtdO1xyXG4gICAgY29uc3QgZGVmYXVsdElkID0gdGhpcy5jb21wYW55Q29uZmlnLmdldERlZmF1bHRTZXJ2aWNlQXJlYUlkKCk7XHJcbiAgICBsaXN0LmZvckVhY2goKHNhKSA9PiB7XHJcbiAgICAgIGNvbnN0IG9wdCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ29wdGlvbicpO1xyXG4gICAgICBvcHQudmFsdWUgPSBzYS5zZXJ2aWNlQXJlYUlkO1xyXG4gICAgICBvcHQudGV4dENvbnRlbnQgPSBzYS5zdGF0aW9uQ29kZTtcclxuICAgICAgaWYgKHNhLnNlcnZpY2VBcmVhSWQgPT09IGRlZmF1bHRJZCkgb3B0LnNlbGVjdGVkID0gdHJ1ZTtcclxuICAgICAgc2VsZWN0LmFwcGVuZENoaWxkKG9wdCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBEcml2ZXIgbmFtZSByZXNvbHV0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIGFzeW5jIF9yZXNvbHZlVHJhbnNwb3J0ZXJOYW1lcyhwYWNrYWdlczogUmVjb3JkPHN0cmluZywgdW5rbm93bj5bXSwgZGF0ZTogc3RyaW5nLCBzZXJ2aWNlQXJlYUlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGlkcyA9IFsuLi5uZXcgU2V0KHBhY2thZ2VzLm1hcCgocCkgPT4gcFsndHJhbnNwb3J0ZXJJZCddIGFzIHN0cmluZyB8IG51bGwpLmZpbHRlcigoaWQpOiBpZCBpcyBzdHJpbmcgPT4gaWQgIT0gbnVsbCkpXTtcclxuICAgIGlmIChpZHMubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgdW5jYWNoZWQgPSBpZHMuZmlsdGVyKChpZCkgPT4gIXRoaXMuX3RyYW5zcG9ydGVyQ2FjaGUuaGFzKGlkKSk7XHJcbiAgICBpZiAodW5jYWNoZWQubGVuZ3RoID4gMCkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHF1ZXJ5RGF0ZSA9IG5ldyBEYXRlKGRhdGUgKyAnVDAwOjAwOjAwJyk7XHJcbiAgICAgICAgY29uc3QgZnJvbURhdGUgPSBuZXcgRGF0ZShxdWVyeURhdGUpOyBmcm9tRGF0ZS5zZXREYXRlKGZyb21EYXRlLmdldERhdGUoKSAtIDcpO1xyXG4gICAgICAgIGNvbnN0IHRvRGF0ZSA9IG5ldyBEYXRlKHF1ZXJ5RGF0ZSk7IHRvRGF0ZS5zZXREYXRlKHRvRGF0ZS5nZXREYXRlKCkgKyAxKTtcclxuICAgICAgICBjb25zdCB1cmwgPSBgaHR0cHM6Ly9sb2dpc3RpY3MuYW1hem9uLmRlL3NjaGVkdWxpbmcvaG9tZS9hcGkvdjIvcm9zdGVycz9mcm9tRGF0ZT0ke2Zyb21EYXRlLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXX0mdG9EYXRlPSR7dG9EYXRlLnRvSVNPU3RyaW5nKCkuc3BsaXQoJ1QnKVswXX0mc2VydmljZUFyZWFJZD0ke3NlcnZpY2VBcmVhSWR9YDtcclxuICAgICAgICBjb25zdCBjc3JmID0gZ2V0Q1NSRlRva2VuKCk7XHJcbiAgICAgICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHsgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicgfTtcclxuICAgICAgICBpZiAoY3NyZikgaGVhZGVyc1snYW50aS1jc3JmdG9rZW4tYTJ6J10gPSBjc3JmO1xyXG4gICAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBmZXRjaCh1cmwsIHsgbWV0aG9kOiAnR0VUJywgaGVhZGVycywgY3JlZGVudGlhbHM6ICdpbmNsdWRlJyB9KTtcclxuICAgICAgICBpZiAocmVzcC5vaykge1xyXG4gICAgICAgICAgY29uc3QganNvbiA9IGF3YWl0IHJlc3AuanNvbigpO1xyXG4gICAgICAgICAgY29uc3Qgcm9zdGVyID0gQXJyYXkuaXNBcnJheShqc29uKSA/IGpzb24gOiBqc29uPy5kYXRhIHx8IGpzb24/LnJvc3RlcnMgfHwgW107XHJcbiAgICAgICAgICBjb25zdCBwcm9jZXNzRW50cmllcyA9IChlbnRyaWVzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPj4pID0+IHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XHJcbiAgICAgICAgICAgICAgaWYgKGVudHJ5Wydkcml2ZXJQZXJzb25JZCddICYmIGVudHJ5Wydkcml2ZXJOYW1lJ10pIHtcclxuICAgICAgICAgICAgICAgIHRoaXMuX3RyYW5zcG9ydGVyQ2FjaGUuc2V0KFN0cmluZyhlbnRyeVsnZHJpdmVyUGVyc29uSWQnXSksIGVudHJ5Wydkcml2ZXJOYW1lJ10gYXMgc3RyaW5nKTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH07XHJcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShyb3N0ZXIpKSBwcm9jZXNzRW50cmllcyhyb3N0ZXIpO1xyXG4gICAgICAgICAgZWxzZSBpZiAodHlwZW9mIHJvc3RlciA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgICAgZm9yIChjb25zdCB2YWwgb2YgT2JqZWN0LnZhbHVlcyhyb3N0ZXIgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKSB7XHJcbiAgICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSkgcHJvY2Vzc0VudHJpZXModmFsIGFzIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+Pik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGxvZyhgW1JldHVybnNdIFJvc3RlciBsb2FkZWQ6ICR7dGhpcy5fdHJhbnNwb3J0ZXJDYWNoZS5zaXplfSBkcml2ZXIgbmFtZXMgY2FjaGVkYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlKSB7IGxvZygnW1JldHVybnNdIFJvc3RlciBsb29rdXAgZmFpbGVkOicsIGUpOyB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgRGF0YSBsb2FkaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIGFzeW5jIF9sb2FkRGF0YSgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGRhdGUgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXJldC1kYXRlJykgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWU7XHJcbiAgICBjb25zdCBzZXJ2aWNlQXJlYUlkID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtc2EnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCkudmFsdWU7XHJcbiAgICBjb25zdCByb3V0ZVZpZXcgPSAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXJldC1yb3V0ZXZpZXcnKSBhcyBIVE1MSW5wdXRFbGVtZW50KS5jaGVja2VkO1xyXG5cclxuICAgIGlmICghZGF0ZSkgeyB0aGlzLl9zZXRTdGF0dXMoJ1x1MjZBMFx1RkUwRiBCaXR0ZSBEYXR1bSBhdXN3XHUwMEU0aGxlbi4nKTsgcmV0dXJuOyB9XHJcbiAgICBpZiAoIXNlcnZpY2VBcmVhSWQpIHsgdGhpcy5fc2V0U3RhdHVzKCdcdTI2QTBcdUZFMEYgQml0dGUgU2VydmljZSBBcmVhIGF1c3dcdTAwRTRobGVuLicpOyByZXR1cm47IH1cclxuXHJcbiAgICBjb25zdCBjYWNoZUtleSA9IGAke2RhdGV9fCR7c2VydmljZUFyZWFJZH1gO1xyXG4gICAgY29uc3QgY2FjaGVkID0gdGhpcy5fY2FjaGUuZ2V0KGNhY2hlS2V5KTtcclxuICAgIGlmIChjYWNoZWQgJiYgKERhdGUubm93KCkgLSBjYWNoZWQudGltZXN0YW1wIDwgdGhpcy5fY2FjaGVFeHBpcnkpKSB7XHJcbiAgICAgIGxvZygnUmV0dXJuczogdXNpbmcgY2FjaGVkIGRhdGEnKTtcclxuICAgICAgdGhpcy5fYWxsUGFja2FnZXMgPSBjYWNoZWQuZGF0YTtcclxuICAgICAgdGhpcy5fYXBwbHlGaWx0ZXJzKCk7XHJcbiAgICAgIHRoaXMuX3NldFN0YXR1cyhgXHUyNzA1ICR7dGhpcy5fYWxsUGFja2FnZXMubGVuZ3RofSBQYWtldGUgYXVzIENhY2hlIGdlbGFkZW5gKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuX3NldFN0YXR1cygnXHUyM0YzIExhZGUgUmV0dXJucy1EYXRlblx1MjAyNicpO1xyXG4gICAgdGhpcy5fc2V0Qm9keSgnPGRpdiBjbGFzcz1cImN0LXJldC1sb2FkaW5nXCI+RGF0ZW4gd2VyZGVuIGdlbGFkZW5cdTIwMjY8L2Rpdj4nKTtcclxuXHJcbiAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcclxuICAgICAgaGlzdG9yaWNhbERheTogJ2ZhbHNlJywgbG9jYWxEYXRlOiBkYXRlLCBwYWNrYWdlU3RhdHVzOiAnUkVUVVJORUQnLFxyXG4gICAgICByb3V0ZVZpZXc6IFN0cmluZyhyb3V0ZVZpZXcpLCBzZXJ2aWNlQXJlYUlkLCBzdGF0c0Zyb21TdW1tYXJpZXM6ICd0cnVlJyxcclxuICAgIH0pO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCB3aXRoUmV0cnkoYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaChgaHR0cHM6Ly9sb2dpc3RpY3MuYW1hem9uLmRlL29wZXJhdGlvbnMvZXhlY3V0aW9uL2FwaS9wYWNrYWdlcy9wYWNrYWdlc0J5U3RhdHVzPyR7cGFyYW1zfWAsIHtcclxuICAgICAgICAgIG1ldGhvZDogJ0dFVCcsIGNyZWRlbnRpYWxzOiAnc2FtZS1vcmlnaW4nLFxyXG4gICAgICAgICAgaGVhZGVyczogeyBBY2NlcHQ6ICdhcHBsaWNhdGlvbi9qc29uLCB0ZXh0L3BsYWluLCAqLyonLCAnQWNjZXB0LUxhbmd1YWdlJzogJ2RlLGVuLVVTO3E9MC43LGVuO3E9MC4zJywgUmVmZXJlcjogbG9jYXRpb24uaHJlZiB9LFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9OiAke3Iuc3RhdHVzVGV4dH1gKTtcclxuICAgICAgICByZXR1cm4gcjtcclxuICAgICAgfSwgeyByZXRyaWVzOiAzLCBiYXNlTXM6IDUwMCB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXNwLmpzb24oKTtcclxuICAgICAgY29uc3QgcGFja2FnZXMgPSBBcnJheS5pc0FycmF5KGpzb24/LnBhY2thZ2VzKSA/IGpzb24ucGFja2FnZXMgOiBbXTtcclxuICAgICAgdGhpcy5fY2FjaGUuc2V0KGNhY2hlS2V5LCB7IGRhdGE6IHBhY2thZ2VzLCB0aW1lc3RhbXA6IERhdGUubm93KCkgfSk7XHJcbiAgICAgIHRoaXMuX2FsbFBhY2thZ2VzID0gcGFja2FnZXM7XHJcblxyXG4gICAgICB0aGlzLl9zZXRTdGF0dXMoYFx1MjNGMyAke3BhY2thZ2VzLmxlbmd0aH0gUGFrZXRlIGdlbGFkZW4sIGxhZGUgRmFocmVybmFtZW5cdTIwMjZgKTtcclxuICAgICAgYXdhaXQgdGhpcy5fcmVzb2x2ZVRyYW5zcG9ydGVyTmFtZXMocGFja2FnZXMsIGRhdGUsIHNlcnZpY2VBcmVhSWQpO1xyXG5cclxuICAgICAgdGhpcy5fcGFnZSA9IDE7XHJcbiAgICAgIHRoaXMuX2FwcGx5RmlsdGVycygpO1xyXG4gICAgICB0aGlzLl9zZXRTdGF0dXMoYFx1MjcwNSAke3BhY2thZ2VzLmxlbmd0aH0gUGFrZXRlIGdlbGFkZW4gZlx1MDBGQ3IgJHtkYXRlfWApO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBlcnIoJ1JldHVybnMgZmV0Y2ggZmFpbGVkOicsIGUpO1xyXG4gICAgICB0aGlzLl9zZXRCb2R5KGA8ZGl2IGNsYXNzPVwiY3QtcmV0LWVycm9yXCIgcm9sZT1cImFsZXJ0XCI+XHUyNzRDIERhdGVuIGtvbm50ZW4gbmljaHQgZ2VsYWRlbiB3ZXJkZW4uPGJyPjxzbWFsbD4ke2VzYygoZSBhcyBFcnJvcikubWVzc2FnZSl9PC9zbWFsbD48YnI+PGJyPjxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1hY2NlbnRcIiBpZD1cImN0LXJldC1yZXRyeVwiPlx1RDgzRFx1REQwNCBFcm5ldXQgdmVyc3VjaGVuPC9idXR0b24+PC9kaXY+YCk7XHJcbiAgICAgIHRoaXMuX3NldFN0YXR1cygnXHUyNzRDIEZlaGxlciBiZWltIExhZGVuLicpO1xyXG4gICAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtcmV0LXJldHJ5Jyk/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5fbG9hZERhdGEoKSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgRmlsdGVycyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgcHJpdmF0ZSBfY2xlYXJGaWx0ZXJzKCk6IHZvaWQge1xyXG4gICAgWydjdC1yZXQtc2VhcmNoJywgJ2N0LXJldC1jaXR5JywgJ2N0LXJldC1wb3N0YWwnLCAnY3QtcmV0LXJvdXRlJywgJ2N0LXJldC1yZWFzb24nXS5mb3JFYWNoKChpZCkgPT4ge1xyXG4gICAgICAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoaWQpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlID0gJyc7XHJcbiAgICB9KTtcclxuICAgIHRoaXMuX2ZpbHRlcnMgPSB7IHNlYXJjaDogJycsIGNpdHk6ICcnLCBwb3N0YWxDb2RlOiAnJywgcm91dGVDb2RlOiAnJywgcmVhc29uQ29kZTogJycgfTtcclxuICAgIHRoaXMuX2FwcGx5RmlsdGVycygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfYXBwbHlGaWx0ZXJzKCk6IHZvaWQge1xyXG4gICAgdGhpcy5fZmlsdGVycyA9IHtcclxuICAgICAgc2VhcmNoOiAgICAgKChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtcmV0LXNlYXJjaCcpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSxcclxuICAgICAgY2l0eTogICAgICAgKChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtcmV0LWNpdHknKSBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKCksXHJcbiAgICAgIHBvc3RhbENvZGU6ICgoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXJldC1wb3N0YWwnKSBhcyBIVE1MSW5wdXRFbGVtZW50KS52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKCksXHJcbiAgICAgIHJvdXRlQ29kZTogICgoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXJldC1yb3V0ZScpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSxcclxuICAgICAgcmVhc29uQ29kZTogKChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtcmV0LXJlYXNvbicpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSxcclxuICAgIH07XHJcblxyXG4gICAgY29uc3Qgc29ydEZpZWxkID0gKGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtc29ydC1maWVsZCcpIGFzIEhUTUxTZWxlY3RFbGVtZW50KS52YWx1ZTtcclxuICAgIGNvbnN0IHNvcnREaXIgICA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtcmV0LXNvcnQtZGlyJykgYXMgSFRNTFNlbGVjdEVsZW1lbnQpLnZhbHVlO1xyXG5cclxuICAgIHRoaXMuX2ZpbHRlcmVkUGFja2FnZXMgPSB0aGlzLl9hbGxQYWNrYWdlcy5maWx0ZXIoKHBrZykgPT4ge1xyXG4gICAgICBjb25zdCBhZGRyID0gKHBrZ1snYWRkcmVzcyddIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB8fCB7fTtcclxuICAgICAgaWYgKHRoaXMuX2ZpbHRlcnMuc2VhcmNoICYmICEoU3RyaW5nKHBrZ1snc2Nhbm5hYmxlSWQnXSB8fCAnJykpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXModGhpcy5fZmlsdGVycy5zZWFyY2gpKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgIGlmICh0aGlzLl9maWx0ZXJzLmNpdHkgJiYgIShTdHJpbmcoYWRkclsnY2l0eSddIHx8ICcnKSkudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyh0aGlzLl9maWx0ZXJzLmNpdHkpKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgIGlmICh0aGlzLl9maWx0ZXJzLnBvc3RhbENvZGUgJiYgIShTdHJpbmcoYWRkclsncG9zdGFsQ29kZSddIHx8ICcnKSkudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyh0aGlzLl9maWx0ZXJzLnBvc3RhbENvZGUpKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgIGlmICh0aGlzLl9maWx0ZXJzLnJvdXRlQ29kZSAmJiAhKFN0cmluZyhwa2dbJ3JvdXRlQ29kZSddIHx8ICcnKSkudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyh0aGlzLl9maWx0ZXJzLnJvdXRlQ29kZSkpIHJldHVybiBmYWxzZTtcclxuICAgICAgaWYgKHRoaXMuX2ZpbHRlcnMucmVhc29uQ29kZSAmJiAhKFN0cmluZyhwa2dbJ3JlYXNvbkNvZGUnXSB8fCAnJykpLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXModGhpcy5fZmlsdGVycy5yZWFzb25Db2RlKSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuX2ZpbHRlcmVkUGFja2FnZXMuc29ydCgoYSwgYikgPT4ge1xyXG4gICAgICBsZXQgdmE6IHVua25vd24gPSBhW3NvcnRGaWVsZF0sIHZiOiB1bmtub3duID0gYltzb3J0RmllbGRdO1xyXG4gICAgICBsZXQgdmEyOiBzdHJpbmcgfCBudW1iZXIsIHZiMjogc3RyaW5nIHwgbnVtYmVyO1xyXG4gICAgICBpZiAoc29ydEZpZWxkID09PSAnbGFzdFVwZGF0ZWRUaW1lJykgeyB2YTIgPSBOdW1iZXIodmEpIHx8IDA7IHZiMiA9IE51bWJlcih2YikgfHwgMDsgfVxyXG4gICAgICBlbHNlIGlmIChzb3J0RmllbGQgPT09ICdjaXR5JykgeyB2YTIgPSAoKGFbJ2FkZHJlc3MnXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik/LlsnY2l0eSddIHx8ICcnKS50b1N0cmluZygpLnRvTG93ZXJDYXNlKCk7IHZiMiA9ICgoYlsnYWRkcmVzcyddIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KT8uWydjaXR5J10gfHwgJycpLnRvU3RyaW5nKCkudG9Mb3dlckNhc2UoKTsgfVxyXG4gICAgICBlbHNlIGlmIChzb3J0RmllbGQgPT09ICdyb3V0ZUNvZGUnKSB7IHZhMiA9IChhWydyb3V0ZUNvZGUnXSB8fCAnJykudG9TdHJpbmcoKS50b0xvd2VyQ2FzZSgpOyB2YjIgPSAoYlsncm91dGVDb2RlJ10gfHwgJycpLnRvU3RyaW5nKCkudG9Mb3dlckNhc2UoKTsgfVxyXG4gICAgICBlbHNlIHsgdmEyID0gKHZhIHx8ICcnKS50b1N0cmluZygpLnRvTG93ZXJDYXNlKCk7IHZiMiA9ICh2YiB8fCAnJykudG9TdHJpbmcoKS50b0xvd2VyQ2FzZSgpOyB9XHJcbiAgICAgIGlmICh2YTIgPCB2YjIpIHJldHVybiBzb3J0RGlyID09PSAnYXNjJyA/IC0xIDogMTtcclxuICAgICAgaWYgKHZhMiA+IHZiMikgcmV0dXJuIHNvcnREaXIgPT09ICdhc2MnID8gMSA6IC0xO1xyXG4gICAgICByZXR1cm4gMDtcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuX3JlbmRlclN0YXRzKCk7XHJcbiAgICB0aGlzLl9yZW5kZXJDYXJkcygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfcmVuZGVyU3RhdHMoKTogdm9pZCB7XHJcbiAgICBjb25zdCB0b3RhbCA9IHRoaXMuX2FsbFBhY2thZ2VzLmxlbmd0aDtcclxuICAgIGNvbnN0IGZpbHRlcmVkID0gdGhpcy5fZmlsdGVyZWRQYWNrYWdlcy5sZW5ndGg7XHJcbiAgICBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtY291bnQnKTtcclxuICAgIGlmIChlbCkgZWwudGV4dENvbnRlbnQgPSBmaWx0ZXJlZCA9PT0gdG90YWwgPyBgJHt0b3RhbH0gUGFrZXRlYCA6IGAke2ZpbHRlcmVkfSB2b24gJHt0b3RhbH0gUGFrZXRlbmA7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF91cGRhdGVWaWV3VG9nZ2xlKCk6IHZvaWQge1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXJldC12aWV3LXRhYmxlJykhLmNsYXNzTGlzdC50b2dnbGUoJ2FjdGl2ZScsIHRoaXMuX3ZpZXdNb2RlID09PSAndGFibGUnKTtcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtdmlldy1jYXJkcycpIS5jbGFzc0xpc3QudG9nZ2xlKCdhY3RpdmUnLCB0aGlzLl92aWV3TW9kZSA9PT0gJ2NhcmRzJyk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgUmVuZGVyaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9yZW5kZXJDYXJkcygpOiB2b2lkIHtcclxuICAgIGNvbnN0IHRvdGFsUGFnZXMgPSBNYXRoLmNlaWwodGhpcy5fZmlsdGVyZWRQYWNrYWdlcy5sZW5ndGggLyB0aGlzLl9wYWdlU2l6ZSk7XHJcbiAgICBpZiAodGhpcy5fcGFnZSA+IHRvdGFsUGFnZXMpIHRoaXMuX3BhZ2UgPSBNYXRoLm1heCgxLCB0b3RhbFBhZ2VzKTtcclxuICAgIGNvbnN0IHN0YXJ0ID0gKHRoaXMuX3BhZ2UgLSAxKSAqIHRoaXMuX3BhZ2VTaXplO1xyXG4gICAgY29uc3Qgc2xpY2UgPSB0aGlzLl9maWx0ZXJlZFBhY2thZ2VzLnNsaWNlKHN0YXJ0LCBzdGFydCArIHRoaXMuX3BhZ2VTaXplKTtcclxuXHJcbiAgICBpZiAoc2xpY2UubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHRoaXMuX3NldEJvZHkoJzxkaXYgY2xhc3M9XCJjdC1yZXQtZW1wdHlcIj5LZWluZSBSZXR1cm5zIGZcdTAwRkNyIGRpZSBnZXdcdTAwRTRobHRlbiBGaWx0ZXIgZ2VmdW5kZW4uPC9kaXY+Jyk7XHJcbiAgICAgIHRoaXMuX3JlbmRlclBhZ2luYXRpb24oMCwgMSwgMSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5fdmlld01vZGUgPT09ICd0YWJsZScpIHtcclxuICAgICAgdGhpcy5fcmVuZGVyVGFibGUoc2xpY2UpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3QgY2FyZHNIdG1sID0gc2xpY2UubWFwKChwa2cpID0+IHRoaXMuX3JlbmRlckNhcmQocGtnKSkuam9pbignJyk7XHJcbiAgICAgIHRoaXMuX3NldEJvZHkoYDxkaXYgY2xhc3M9XCJjdC1yZXQtY2FyZHNcIj4ke2NhcmRzSHRtbH08L2Rpdj5gKTtcclxuICAgIH1cclxuICAgIHRoaXMuX3JlbmRlclBhZ2luYXRpb24odGhpcy5fZmlsdGVyZWRQYWNrYWdlcy5sZW5ndGgsIHRoaXMuX3BhZ2UsIHRvdGFsUGFnZXMpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfcmVuZGVyVGFibGUoc2xpY2U6IFJlY29yZDxzdHJpbmcsIHVua25vd24+W10pOiB2b2lkIHtcclxuICAgIGNvbnN0IHJvd3MgPSBzbGljZS5tYXAoKHBrZykgPT4ge1xyXG4gICAgICBjb25zdCBhZGRyID0gKHBrZ1snYWRkcmVzcyddIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB8fCB7fTtcclxuICAgICAgY29uc3QgY29vcmRzID0gcmV0R2V0Q29vcmRzKHBrZyk7XHJcbiAgICAgIGNvbnN0IHRyYW5zcG9ydGVyTmFtZSA9IHBrZ1sndHJhbnNwb3J0ZXJJZCddID8gKHRoaXMuX3RyYW5zcG9ydGVyQ2FjaGUuZ2V0KFN0cmluZyhwa2dbJ3RyYW5zcG9ydGVySWQnXSkpIHx8ICdcdTIwMTQnKSA6ICdcdTIwMTQnO1xyXG4gICAgICByZXR1cm4gYDx0cj5cclxuICAgICAgICA8dGQgdGl0bGU9XCIke2VzYyhwa2dbJ3NjYW5uYWJsZUlkJ10gfHwgJycpfVwiPiR7ZXNjKFN0cmluZyhwa2dbJ3NjYW5uYWJsZUlkJ10gfHwgJ1x1MjAxNCcpKX08L3RkPlxyXG4gICAgICAgIDx0ZD4ke2VzYyh0cmFuc3BvcnRlck5hbWUpfTwvdGQ+XHJcbiAgICAgICAgPHRkPiR7cmV0Rm9ybWF0VGltZXN0YW1wKHBrZ1snbGFzdFVwZGF0ZWRUaW1lJ10pfTwvdGQ+XHJcbiAgICAgICAgPHRkPiR7ZXNjKFN0cmluZyhwa2dbJ3JlYXNvbkNvZGUnXSB8fCAnXHUyMDE0JykpfTwvdGQ+XHJcbiAgICAgICAgPHRkPiR7ZXNjKFN0cmluZyhwa2dbJ3JvdXRlQ29kZSddIHx8ICdcdTIwMTQnKSl9PC90ZD5cclxuICAgICAgICA8dGQ+JHtlc2MoU3RyaW5nKGFkZHJbJ2FkZHJlc3MxJ10gfHwgJycpKX08L3RkPlxyXG4gICAgICAgIDx0ZD4ke2VzYyhTdHJpbmcoYWRkclsncG9zdGFsQ29kZSddIHx8ICcnKSl9PC90ZD5cclxuICAgICAgICA8dGQ+JHtlc2MoU3RyaW5nKGFkZHJbJ2NpdHknXSB8fCAnXHUyMDE0JykpfTwvdGQ+XHJcbiAgICAgICAgPHRkPiR7Y29vcmRzID8gYDxhIGhyZWY9XCJodHRwczovL3d3dy5nb29nbGUuY29tL21hcHMvc2VhcmNoLz9hcGk9MSZxdWVyeT0ke2Nvb3Jkcy5sYXR9LCR7Y29vcmRzLmxvbn1cIiB0YXJnZXQ9XCJfYmxhbmtcIiByZWw9XCJub29wZW5lclwiPlx1RDgzRFx1RENDRDwvYT5gIDogJ1x1MjAxNCd9PC90ZD5cclxuICAgICAgPC90cj5gO1xyXG4gICAgfSkuam9pbignJyk7XHJcblxyXG4gICAgdGhpcy5fc2V0Qm9keShgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1yZXQtdGFibGUtd3JhcFwiPlxyXG4gICAgICAgIDx0YWJsZSBjbGFzcz1cImN0LXRhYmxlIGN0LXJldC10YWJsZVwiPlxyXG4gICAgICAgICAgPHRoZWFkPjx0cj5cclxuICAgICAgICAgICAgPHRoPlNjYW5uYWJsZUlkPC90aD48dGg+VHJhbnNwb3J0ZXI8L3RoPjx0aD5aZWl0PC90aD48dGg+UmVhc29uPC90aD5cclxuICAgICAgICAgICAgPHRoPlJvdXRlPC90aD48dGg+QWRyZXNzZTwvdGg+PHRoPlBMWjwvdGg+PHRoPlN0YWR0PC90aD48dGg+TWFwPC90aD5cclxuICAgICAgICAgIDwvdHI+PC90aGVhZD5cclxuICAgICAgICAgIDx0Ym9keT4ke3Jvd3N9PC90Ym9keT5cclxuICAgICAgICA8L3RhYmxlPlxyXG4gICAgICA8L2Rpdj5gKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX3JlbmRlckNhcmQocGtnOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHN0cmluZyB7XHJcbiAgICBjb25zdCBhZGRyID0gKHBrZ1snYWRkcmVzcyddIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB8fCB7fTtcclxuICAgIGNvbnN0IGNvb3JkcyA9IHJldEdldENvb3Jkcyhwa2cpO1xyXG4gICAgY29uc3QgbWFwTGluayA9IGNvb3JkcyA/IGBodHRwczovL3d3dy5nb29nbGUuY29tL21hcHMvc2VhcmNoLz9hcGk9MSZxdWVyeT0ke2Nvb3Jkcy5sYXR9LCR7Y29vcmRzLmxvbn1gIDogbnVsbDtcclxuICAgIGNvbnN0IHJlYXNvbiA9IFN0cmluZyhwa2dbJ3JlYXNvbkNvZGUnXSB8fCAnVW5iZWthbm50Jyk7XHJcbiAgICBjb25zdCB0cmFuc3BvcnRlck5hbWUgPSBwa2dbJ3RyYW5zcG9ydGVySWQnXSA/ICh0aGlzLl90cmFuc3BvcnRlckNhY2hlLmdldChTdHJpbmcocGtnWyd0cmFuc3BvcnRlcklkJ10pKSB8fCAnXHUyMDE0JykgOiAnXHUyMDE0JztcclxuXHJcbiAgICByZXR1cm4gYDxkaXYgY2xhc3M9XCJjdC1yZXQtY2FyZFwiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtcmV0LWNhcmQtaGVhZGVyXCI+XHJcbiAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1yZXQtY2FyZC1pZFwiPiR7ZXNjKFN0cmluZyhwa2dbJ3NjYW5uYWJsZUlkJ10gfHwgJ1x1MjAxNCcpKX08L3NwYW4+XHJcbiAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1yZXQtY2FyZC1yZWFzb24gJHtyZXRSZWFzb25DbGFzcyhwa2dbJ3JlYXNvbkNvZGUnXSl9XCI+JHtlc2MocmVhc29uKX08L3NwYW4+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtcmV0LWNhcmQtcm93XCI+PHNwYW4gY2xhc3M9XCJjdC1yZXQtY2FyZC1sYWJlbFwiPlRyYW5zcG9ydGVyOjwvc3Bhbj48c3BhbiBjbGFzcz1cImN0LXJldC1jYXJkLXZhbHVlXCI+JHtlc2ModHJhbnNwb3J0ZXJOYW1lKX08L3NwYW4+PC9kaXY+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1yZXQtY2FyZC1yb3dcIj48c3BhbiBjbGFzcz1cImN0LXJldC1jYXJkLWxhYmVsXCI+QWt0dWFsaXNpZXJ0Ojwvc3Bhbj48c3BhbiBjbGFzcz1cImN0LXJldC1jYXJkLXZhbHVlXCI+JHtyZXRGb3JtYXRUaW1lc3RhbXAocGtnWydsYXN0VXBkYXRlZFRpbWUnXSl9PC9zcGFuPjwvZGl2PlxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtcmV0LWNhcmQtcm93XCI+PHNwYW4gY2xhc3M9XCJjdC1yZXQtY2FyZC1sYWJlbFwiPlJvdXRlOjwvc3Bhbj48c3BhbiBjbGFzcz1cImN0LXJldC1jYXJkLXZhbHVlXCI+JHtlc2MoU3RyaW5nKHBrZ1sncm91dGVDb2RlJ10gfHwgJ1x1MjAxNCcpKX08L3NwYW4+PC9kaXY+XHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1yZXQtY2FyZC1hZGRyZXNzXCI+XHJcbiAgICAgICAgJHtlc2MoU3RyaW5nKGFkZHJbJ2FkZHJlc3MxJ10gfHwgJycpKX0ke2FkZHJbJ2FkZHJlc3MyJ10gPyAnLCAnICsgZXNjKFN0cmluZyhhZGRyWydhZGRyZXNzMiddKSkgOiAnJ308YnI+XHJcbiAgICAgICAgJHtlc2MoU3RyaW5nKGFkZHJbJ3Bvc3RhbENvZGUnXSB8fCAnJykpfSAke2VzYyhTdHJpbmcoYWRkclsnY2l0eSddIHx8ICcnKSl9XHJcbiAgICAgICAgJHtjb29yZHMgPyBgPGJyPjxzbWFsbD5cdUQ4M0RcdURDQ0QgJHtjb29yZHMubGF0LnRvRml4ZWQoNSl9LCAke2Nvb3Jkcy5sb24udG9GaXhlZCg1KX08L3NtYWxsPmAgOiAnJ31cclxuICAgICAgICAke21hcExpbmsgPyBgPGEgaHJlZj1cIiR7bWFwTGlua31cIiBjbGFzcz1cImN0LXJldC1jYXJkLW1hcFwiIHRhcmdldD1cIl9ibGFua1wiIHJlbD1cIm5vb3BlbmVyXCI+XHVEODNEXHVEQ0NEIEluIEthcnRlIFx1MDBGNmZmbmVuPC9hPmAgOiAnJ31cclxuICAgICAgPC9kaXY+XHJcbiAgICA8L2Rpdj5gO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBfcmVuZGVyUGFnaW5hdGlvbih0b3RhbDogbnVtYmVyLCBjdXJyZW50OiBudW1iZXIsIHRvdGFsUGFnZXM6IG51bWJlcik6IHZvaWQge1xyXG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtcmV0LWJvZHknKTtcclxuICAgIGlmICghZWwpIHJldHVybjtcclxuICAgIGNvbnN0IGV4aXN0aW5nID0gZWwucGFyZW50Tm9kZT8ucXVlcnlTZWxlY3RvcignLmN0LXJldC1wYWdpbmF0aW9uJyk7XHJcbiAgICBpZiAoZXhpc3RpbmcpIGV4aXN0aW5nLnJlbW92ZSgpO1xyXG4gICAgaWYgKHRvdGFsUGFnZXMgPD0gMSkgcmV0dXJuO1xyXG5cclxuICAgIGVsLmluc2VydEFkamFjZW50SFRNTCgnYWZ0ZXJlbmQnLCBgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1yZXQtcGFnaW5hdGlvblwiPlxyXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1zZWNvbmRhcnkgY3QtcmV0LXByZXZcIiAke2N1cnJlbnQgPD0gMSA/ICdkaXNhYmxlZCcgOiAnJ30+XHUyMDM5IFp1clx1MDBGQ2NrPC9idXR0b24+XHJcbiAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1yZXQtcGFnZS1pbmZvXCI+U2VpdGUgJHtjdXJyZW50fSAvICR7dG90YWxQYWdlc30gKCR7dG90YWx9IEVpbnRyXHUwMEU0Z2UpPC9zcGFuPlxyXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1zZWNvbmRhcnkgY3QtcmV0LW5leHRcIiAke2N1cnJlbnQgPj0gdG90YWxQYWdlcyA/ICdkaXNhYmxlZCcgOiAnJ30+V2VpdGVyIFx1MjAzQTwvYnV0dG9uPlxyXG4gICAgICA8L2Rpdj5gKTtcclxuXHJcbiAgICBlbC5wYXJlbnROb2RlPy5xdWVyeVNlbGVjdG9yKCcuY3QtcmV0LXByZXYnKT8uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgIGlmICh0aGlzLl9wYWdlID4gMSkgeyB0aGlzLl9wYWdlLS07IHRoaXMuX3JlbmRlckNhcmRzKCk7IH1cclxuICAgIH0pO1xyXG4gICAgZWwucGFyZW50Tm9kZT8ucXVlcnlTZWxlY3RvcignLmN0LXJldC1uZXh0Jyk/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xyXG4gICAgICBpZiAodGhpcy5fcGFnZSA8IHRvdGFsUGFnZXMpIHsgdGhpcy5fcGFnZSsrOyB0aGlzLl9yZW5kZXJDYXJkcygpOyB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX2V4cG9ydENTVigpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLl9maWx0ZXJlZFBhY2thZ2VzLmxlbmd0aCA9PT0gMCkgeyBhbGVydCgnS2VpbmUgRGF0ZW4genVtIEV4cG9ydGllcmVuLicpOyByZXR1cm47IH1cclxuICAgIGNvbnN0IGhlYWRlcnMgPSBbJ3NjYW5uYWJsZUlkJywgJ3RyYW5zcG9ydGVyJywgJ2xhc3RVcGRhdGVkVGltZScsICdyZWFzb25Db2RlJywgJ3JvdXRlQ29kZScsICdhZGRyZXNzMScsICdhZGRyZXNzMicsICdjaXR5JywgJ3Bvc3RhbENvZGUnLCAnbGF0aXR1ZGUnLCAnbG9uZ2l0dWRlJ107XHJcbiAgICBsZXQgY3N2ID0gaGVhZGVycy5qb2luKCc7JykgKyAnXFxuJztcclxuXHJcbiAgICBmb3IgKGNvbnN0IHBrZyBvZiB0aGlzLl9maWx0ZXJlZFBhY2thZ2VzKSB7XHJcbiAgICAgIGNvbnN0IGFkZHIgPSAocGtnWydhZGRyZXNzJ10gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pIHx8IHt9O1xyXG4gICAgICBjb25zdCBjb29yZHMgPSByZXRHZXRDb29yZHMocGtnKTtcclxuICAgICAgY29uc3QgdHJhbnNwb3J0ZXJOYW1lID0gcGtnWyd0cmFuc3BvcnRlcklkJ10gPyAodGhpcy5fdHJhbnNwb3J0ZXJDYWNoZS5nZXQoU3RyaW5nKHBrZ1sndHJhbnNwb3J0ZXJJZCddKSkgfHwgJycpIDogJyc7XHJcbiAgICAgIGNvbnN0IHJvdyA9IFtcclxuICAgICAgICBwa2dbJ3NjYW5uYWJsZUlkJ10gfHwgJycsXHJcbiAgICAgICAgdHJhbnNwb3J0ZXJOYW1lLFxyXG4gICAgICAgIHJldEZvcm1hdFRpbWVzdGFtcChwa2dbJ2xhc3RVcGRhdGVkVGltZSddKSxcclxuICAgICAgICBwa2dbJ3JlYXNvbkNvZGUnXSB8fCAnJywgcGtnWydyb3V0ZUNvZGUnXSB8fCAnJyxcclxuICAgICAgICBhZGRyWydhZGRyZXNzMSddIHx8ICcnLCBhZGRyWydhZGRyZXNzMiddIHx8ICcnLFxyXG4gICAgICAgIGFkZHJbJ2NpdHknXSB8fCAnJywgYWRkclsncG9zdGFsQ29kZSddIHx8ICcnLFxyXG4gICAgICAgIGNvb3Jkcz8ubGF0ID8/ICcnLCBjb29yZHM/LmxvbiA/PyAnJyxcclxuICAgICAgXTtcclxuICAgICAgY3N2ICs9IHJvdy5tYXAoKHYpID0+IFN0cmluZyh2KS5yZXBsYWNlKC87L2csICcsJykpLmpvaW4oJzsnKSArICdcXG4nO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbJ1xcdUZFRkYnICsgY3N2XSwgeyB0eXBlOiAndGV4dC9jc3Y7Y2hhcnNldD11dGYtODsnIH0pO1xyXG4gICAgY29uc3QgdXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcclxuICAgIGNvbnN0IGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdhJyk7XHJcbiAgICBhLmhyZWYgPSB1cmw7IGEuZG93bmxvYWQgPSBgcmV0dXJuc18ke3RvZGF5U3RyKCl9LmNzdmA7XHJcbiAgICBhLmNsaWNrKCk7IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgX3NldFN0YXR1cyhtc2c6IHN0cmluZyk6IHZvaWQgeyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtc3RhdHVzJyk7IGlmIChlbCkgZWwudGV4dENvbnRlbnQgPSBtc2c7IH1cclxuICBwcml2YXRlIF9zZXRCb2R5KGh0bWw6IHN0cmluZyk6IHZvaWQgeyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1yZXQtYm9keScpOyBpZiAoZWwpIGVsLmlubmVySFRNTCA9IGh0bWw7IH1cclxufVxyXG4iLCAiLy8gZmVhdHVyZXMvc2NvcmVjYXJkLnRzIFx1MjAxMyBXZWVrbHkgREEgcXVhbGl0eSBTY29yZWNhcmQgRGFzaGJvYXJkXHJcblxyXG5pbXBvcnQgeyBsb2csIGVyciwgZXNjLCB3aXRoUmV0cnksIGdldENTUkZUb2tlbiB9IGZyb20gJy4uL2NvcmUvdXRpbHMnO1xyXG5pbXBvcnQgeyBvbkRpc3Bvc2UgfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcclxuaW1wb3J0IHR5cGUgeyBBcHBDb25maWcgfSBmcm9tICcuLi9jb3JlL3N0b3JhZ2UnO1xyXG5pbXBvcnQgdHlwZSB7IENvbXBhbnlDb25maWcgfSBmcm9tICcuLi9jb3JlL2FwaSc7XHJcblxyXG4vLyBcdTI1MDBcdTI1MDAgUHVyZSBoZWxwZXIgZnVuY3Rpb25zIChleHBvcnRlZCBmb3IgdGVzdGluZykgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2NDb252ZXJ0VG9EZWNpbWFsKHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHtcclxuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIE5hTjtcclxuICBjb25zdCBzID0gU3RyaW5nKHZhbHVlKS50cmltKCk7XHJcbiAgaWYgKHMgPT09ICctJyB8fCBzID09PSAnJykgcmV0dXJuIE5hTjtcclxuICBjb25zdCBudW1iZXIgPSBwYXJzZUZsb2F0KHMucmVwbGFjZSgnLCcsICcuJykpO1xyXG4gIHJldHVybiBpc05hTihudW1iZXIpID8gTmFOIDogbnVtYmVyO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFNjb3JlY2FyZFJvdyB7XHJcbiAgdHJhbnNwb3J0ZXJJZDogc3RyaW5nO1xyXG4gIGRlbGl2ZXJlZDogc3RyaW5nO1xyXG4gIGRjcjogc3RyaW5nO1xyXG4gIGRuckRwbW86IHN0cmluZztcclxuICBsb3JEcG1vOiBzdHJpbmc7XHJcbiAgcG9kOiBzdHJpbmc7XHJcbiAgY2M6IHN0cmluZztcclxuICBjZTogc3RyaW5nO1xyXG4gIGNkZkRwbW86IHN0cmluZztcclxuICBkYU5hbWU6IHN0cmluZztcclxuICB3ZWVrOiBzdHJpbmc7XHJcbiAgeWVhcjogc3RyaW5nO1xyXG4gIHN0YXRpb25Db2RlOiBzdHJpbmc7XHJcbiAgZHNwQ29kZTogc3RyaW5nO1xyXG4gIGRhdGFEYXRlOiBzdHJpbmc7XHJcbiAgY291bnRyeTogc3RyaW5nO1xyXG4gIHByb2dyYW06IHN0cmluZztcclxuICByZWdpb246IHN0cmluZztcclxuICBsYXN0VXBkYXRlZDogc3RyaW5nO1xyXG4gIF9yYXc6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2NQYXJzZVJvdyhqc29uU3RyOiBzdHJpbmcgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IFNjb3JlY2FyZFJvdyB7XHJcbiAgY29uc3QgcmF3OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHR5cGVvZiBqc29uU3RyID09PSAnc3RyaW5nJyA/IEpTT04ucGFyc2UoanNvblN0cikgOiBqc29uU3RyO1xyXG4gIGNvbnN0IG91dDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fTtcclxuICBmb3IgKGNvbnN0IFtrLCB2XSBvZiBPYmplY3QuZW50cmllcyhyYXcpKSB7IG91dFtrLnRyaW0oKV0gPSB2OyB9XHJcblxyXG4gIGNvbnN0IGRjclJhdGlvID0gb3V0WydkY3JfbWV0cmljJ10gIT09IHVuZGVmaW5lZCA/IE51bWJlcihvdXRbJ2Rjcl9tZXRyaWMnXSkgOiBOYU47XHJcbiAgY29uc3QgcG9kUmF0aW8gPSBvdXRbJ3BvZF9tZXRyaWMnXSAhPT0gdW5kZWZpbmVkID8gTnVtYmVyKG91dFsncG9kX21ldHJpYyddKSA6IE5hTjtcclxuICBjb25zdCBjY1JhdGlvICA9IG91dFsnY2NfbWV0cmljJ10gICE9PSB1bmRlZmluZWQgPyBOdW1iZXIob3V0WydjY19tZXRyaWMnXSkgIDogTmFOO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgdHJhbnNwb3J0ZXJJZDogU3RyaW5nKG91dFsnY291bnRyeV9wcm9ncmFtX3Byb3ZpZGVyaWRfc3RhdGlvbmNvZGUnXSB8fCBvdXRbJ2RzcF9jb2RlJ10gfHwgJycpLFxyXG4gICAgZGVsaXZlcmVkOiAgICAgU3RyaW5nKG91dFsnZGVsaXZlcmVkJ10gfHwgJzAnKSxcclxuICAgIGRjcjogICAgICAgICAgIGlzTmFOKGRjclJhdGlvKSA/ICctJyA6IChkY3JSYXRpbyAqIDEwMCkudG9GaXhlZCgyKSxcclxuICAgIGRuckRwbW86ICAgICAgIFN0cmluZyhvdXRbJ2Rucl9kcG1vJ10gPz8gJzAnKSxcclxuICAgIGxvckRwbW86ICAgICAgIFN0cmluZyhvdXRbJ2xvcl9kcG1vJ10gPz8gJzAnKSxcclxuICAgIHBvZDogICAgICAgICAgIGlzTmFOKHBvZFJhdGlvKSA/ICctJyA6IChwb2RSYXRpbyAqIDEwMCkudG9GaXhlZCgyKSxcclxuICAgIGNjOiAgICAgICAgICAgIGlzTmFOKGNjUmF0aW8pICA/ICctJyA6IChjY1JhdGlvICogMTAwKS50b0ZpeGVkKDIpLFxyXG4gICAgY2U6ICAgICAgICAgICAgU3RyaW5nKG91dFsnY2VfbWV0cmljJ10gPz8gJzAnKSxcclxuICAgIGNkZkRwbW86ICAgICAgIFN0cmluZyhvdXRbJ2NkZl9kcG1vJ10gPz8gJzAnKSxcclxuICAgIGRhTmFtZTogICAgICAgIFN0cmluZyhvdXRbJ2RhX25hbWUnXSB8fCAnJyksXHJcbiAgICB3ZWVrOiAgICAgICAgICBTdHJpbmcob3V0Wyd3ZWVrJ10gfHwgJycpLFxyXG4gICAgeWVhcjogICAgICAgICAgU3RyaW5nKG91dFsneWVhciddIHx8ICcnKSxcclxuICAgIHN0YXRpb25Db2RlOiAgIFN0cmluZyhvdXRbJ3N0YXRpb25fY29kZSddIHx8ICcnKSxcclxuICAgIGRzcENvZGU6ICAgICAgIFN0cmluZyhvdXRbJ2RzcF9jb2RlJ10gfHwgJycpLFxyXG4gICAgZGF0YURhdGU6ICAgICAgU3RyaW5nKG91dFsnZGF0YV9kYXRlJ10gfHwgJycpLFxyXG4gICAgY291bnRyeTogICAgICAgU3RyaW5nKG91dFsnY291bnRyeSddIHx8ICcnKSxcclxuICAgIHByb2dyYW06ICAgICAgIFN0cmluZyhvdXRbJ3Byb2dyYW0nXSB8fCAnJyksXHJcbiAgICByZWdpb246ICAgICAgICBTdHJpbmcob3V0WydyZWdpb24nXSB8fCAnJyksXHJcbiAgICBsYXN0VXBkYXRlZDogICBTdHJpbmcob3V0WydsYXN0X3VwZGF0ZWRfdGltZSddIHx8ICcnKSxcclxuICAgIF9yYXc6ICAgICAgICAgIG91dCxcclxuICB9O1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIENhbGN1bGF0ZWRSb3cge1xyXG4gIHRyYW5zcG9ydGVySWQ6IHN0cmluZztcclxuICBkZWxpdmVyZWQ6IHN0cmluZztcclxuICBkY3I6IHN0cmluZztcclxuICBkbnJEcG1vOiBzdHJpbmc7XHJcbiAgbG9yRHBtbzogc3RyaW5nO1xyXG4gIHBvZDogc3RyaW5nO1xyXG4gIGNjOiBzdHJpbmc7XHJcbiAgY2U6IHN0cmluZztcclxuICBjZGZEcG1vOiBzdHJpbmc7XHJcbiAgc3RhdHVzOiBzdHJpbmc7XHJcbiAgdG90YWxTY29yZTogbnVtYmVyO1xyXG4gIGRhTmFtZTogc3RyaW5nO1xyXG4gIHdlZWs6IHN0cmluZztcclxuICB5ZWFyOiBzdHJpbmc7XHJcbiAgc3RhdGlvbkNvZGU6IHN0cmluZztcclxuICBkc3BDb2RlOiBzdHJpbmc7XHJcbiAgZGF0YURhdGU6IHN0cmluZztcclxuICBsYXN0VXBkYXRlZDogc3RyaW5nO1xyXG4gIG9yaWdpbmFsRGF0YTogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcclxuICBba2V5OiBzdHJpbmddOiB1bmtub3duO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2NDYWxjdWxhdGVTY29yZShyb3c6IFNjb3JlY2FyZFJvdyk6IENhbGN1bGF0ZWRSb3cge1xyXG4gIGNvbnN0IGRjciA9IChzY0NvbnZlcnRUb0RlY2ltYWwocm93LmRjciA9PT0gJy0nID8gJzEwMCcgOiByb3cuZGNyKSB8fCAwKSAvIDEwMDtcclxuICBjb25zdCBkbnJEcG1vID0gcGFyc2VGbG9hdChyb3cuZG5yRHBtbykgfHwgMDtcclxuICBjb25zdCBsb3JEcG1vID0gcGFyc2VGbG9hdChyb3cubG9yRHBtbykgfHwgMDtcclxuICBjb25zdCBwb2QgPSAoc2NDb252ZXJ0VG9EZWNpbWFsKHJvdy5wb2QgPT09ICctJyA/ICcxMDAnIDogcm93LnBvZCkgfHwgMCkgLyAxMDA7XHJcbiAgY29uc3QgY2MgID0gKHNjQ29udmVydFRvRGVjaW1hbChyb3cuY2MgID09PSAnLScgPyAnMTAwJyA6IHJvdy5jYykgIHx8IDApIC8gMTAwO1xyXG4gIGNvbnN0IGNlICA9IHBhcnNlRmxvYXQocm93LmNlKSB8fCAwO1xyXG4gIGNvbnN0IGNkZkRwbW8gPSBwYXJzZUZsb2F0KHJvdy5jZGZEcG1vKSB8fCAwO1xyXG4gIGNvbnN0IGRlbGl2ZXJlZCA9IHBhcnNlRmxvYXQocm93LmRlbGl2ZXJlZCkgfHwgMDtcclxuXHJcbiAgbGV0IHRvdGFsU2NvcmUgPSBNYXRoLm1heChNYXRoLm1pbihcclxuICAgICgxMzIuODggKiBkY3IpICsgKDEwICogTWF0aC5tYXgoMCwgMSAtIChjZGZEcG1vIC8gMTAwMDApKSkgLVxyXG4gICAgKDAuMDAyNCAqIGRuckRwbW8pIC0gKDguNTQgKiBjZSkgKyAoMTAgKiBwb2QpICsgKDQgKiBjYykgK1xyXG4gICAgKDAuMDAwNDUgKiBkZWxpdmVyZWQpIC0gNjAuODgsXHJcbiAgICAxMDApLCAwKTtcclxuXHJcbiAgaWYgKGRjciA9PT0gMSAmJiBwb2QgPT09IDEgJiYgY2MgPT09IDEgJiYgY2RmRHBtbyA9PT0gMCAmJiBjZSA9PT0gMCAmJiBkbnJEcG1vID09PSAwICYmIGxvckRwbW8gPT09IDApIHtcclxuICAgIHRvdGFsU2NvcmUgPSAxMDA7XHJcbiAgfSBlbHNlIHtcclxuICAgIGxldCBwb29yQ291bnQgPSAwO1xyXG4gICAgaWYgKChkY3IgKiAxMDApIDwgOTcpIHBvb3JDb3VudCsrO1xyXG4gICAgaWYgKGRuckRwbW8gPj0gMTUwMCkgcG9vckNvdW50Kys7XHJcbiAgICBpZiAoKHBvZCAqIDEwMCkgPCA5NCkgcG9vckNvdW50Kys7XHJcbiAgICBpZiAoKGNjICogMTAwKSA8IDcwKSBwb29yQ291bnQrKztcclxuICAgIGlmIChjZSAhPT0gMCkgcG9vckNvdW50Kys7XHJcbiAgICBpZiAoY2RmRHBtbyA+PSA4MDAwKSBwb29yQ291bnQrKztcclxuXHJcbiAgICBpZiAocG9vckNvdW50ID49IDIgfHwgcG9vckNvdW50ID09PSAxKSB7XHJcbiAgICAgIGxldCBzZXZlcml0eVN1bSA9IDA7XHJcbiAgICAgIGlmICgoZGNyICogMTAwKSA8IDk3KSBzZXZlcml0eVN1bSArPSAoOTcgLSBkY3IgKiAxMDApIC8gNTtcclxuICAgICAgaWYgKGRuckRwbW8gPj0gMTUwMCkgc2V2ZXJpdHlTdW0gKz0gKGRuckRwbW8gLSAxNTAwKSAvIDEwMDA7XHJcbiAgICAgIGlmICgocG9kICogMTAwKSA8IDk0KSBzZXZlcml0eVN1bSArPSAoOTQgLSBwb2QgKiAxMDApIC8gMTA7XHJcbiAgICAgIGlmICgoY2MgKiAxMDApIDwgNzApIHNldmVyaXR5U3VtICs9ICg3MCAtIGNjICogMTAwKSAvIDUwO1xyXG4gICAgICBpZiAoY2UgIT09IDApIHNldmVyaXR5U3VtICs9IGNlICogMTtcclxuICAgICAgaWYgKGNkZkRwbW8gPj0gODAwMCkgc2V2ZXJpdHlTdW0gKz0gKGNkZkRwbW8gLSA4MDAwKSAvIDIwMDA7XHJcbiAgICAgIGNvbnN0IHBlbmFsdHkgPSBNYXRoLm1pbigzLCBzZXZlcml0eVN1bSk7XHJcbiAgICAgIHRvdGFsU2NvcmUgPSBNYXRoLm1pbih0b3RhbFNjb3JlLCAocG9vckNvdW50ID49IDIgPyA3MCA6IDg1KSAtIHBlbmFsdHkpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgY29uc3Qgcm91bmRlZFNjb3JlID0gcGFyc2VGbG9hdCh0b3RhbFNjb3JlLnRvRml4ZWQoMikpO1xyXG4gIGNvbnN0IHN0YXR1cyA9IHJvdW5kZWRTY29yZSA8IDQwID8gJ1Bvb3InIDogcm91bmRlZFNjb3JlIDwgNzAgPyAnRmFpcicgOiByb3VuZGVkU2NvcmUgPCA4NSA/ICdHcmVhdCcgOiByb3VuZGVkU2NvcmUgPCA5MyA/ICdGYW50YXN0aWMnIDogJ0ZhbnRhc3RpYyBQbHVzJztcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHRyYW5zcG9ydGVySWQ6IHJvdy50cmFuc3BvcnRlcklkLFxyXG4gICAgZGVsaXZlcmVkOiByb3cuZGVsaXZlcmVkLFxyXG4gICAgZGNyOiAoZGNyICogMTAwKS50b0ZpeGVkKDIpLCBkbnJEcG1vOiBkbnJEcG1vLnRvRml4ZWQoMiksXHJcbiAgICBsb3JEcG1vOiBsb3JEcG1vLnRvRml4ZWQoMiksIHBvZDogKHBvZCAqIDEwMCkudG9GaXhlZCgyKSxcclxuICAgIGNjOiAoY2MgKiAxMDApLnRvRml4ZWQoMiksIGNlOiBjZS50b0ZpeGVkKDIpLCBjZGZEcG1vOiBjZGZEcG1vLnRvRml4ZWQoMiksXHJcbiAgICBzdGF0dXMsIHRvdGFsU2NvcmU6IHJvdW5kZWRTY29yZSxcclxuICAgIGRhTmFtZTogcm93LmRhTmFtZSwgd2Vlazogcm93LndlZWssIHllYXI6IHJvdy55ZWFyLFxyXG4gICAgc3RhdGlvbkNvZGU6IHJvdy5zdGF0aW9uQ29kZSwgZHNwQ29kZTogcm93LmRzcENvZGUsXHJcbiAgICBkYXRhRGF0ZTogcm93LmRhdGFEYXRlLCBsYXN0VXBkYXRlZDogcm93Lmxhc3RVcGRhdGVkLFxyXG4gICAgb3JpZ2luYWxEYXRhOiB7IGRjcjogcm93LmRjciwgZG5yRHBtbzogcm93LmRuckRwbW8sIGxvckRwbW86IHJvdy5sb3JEcG1vLCBwb2Q6IHJvdy5wb2QsIGNjOiByb3cuY2MsIGNlOiByb3cuY2UsIGNkZkRwbW86IHJvdy5jZGZEcG1vIH0sXHJcbiAgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHNjS3BpQ2xhc3ModmFsdWU6IG51bWJlciwgdHlwZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICBzd2l0Y2ggKHR5cGUpIHtcclxuICAgIGNhc2UgJ0RDUic6ICAgICByZXR1cm4gdmFsdWUgPCA5NyA/ICdwb29yJyA6IHZhbHVlIDwgOTguNSA/ICdmYWlyJyA6IHZhbHVlIDwgOTkuNSA/ICdncmVhdCcgOiAnZmFudGFzdGljJztcclxuICAgIGNhc2UgJ0ROUkRQTU8nOlxyXG4gICAgY2FzZSAnTE9SRFBNTyc6IHJldHVybiB2YWx1ZSA8IDExMDAgPyAnZmFudGFzdGljJyA6IHZhbHVlIDwgMTMwMCA/ICdncmVhdCcgOiB2YWx1ZSA8IDE1MDAgPyAnZmFpcicgOiAncG9vcic7XHJcbiAgICBjYXNlICdQT0QnOiAgICAgcmV0dXJuIHZhbHVlIDwgOTQgPyAncG9vcicgOiB2YWx1ZSA8IDk1LjUgPyAnZmFpcicgOiB2YWx1ZSA8IDk3ID8gJ2dyZWF0JyA6ICdmYW50YXN0aWMnO1xyXG4gICAgY2FzZSAnQ0MnOiAgICAgIHJldHVybiB2YWx1ZSA8IDcwID8gJ3Bvb3InIDogdmFsdWUgPCA5NSA/ICdmYWlyJyA6IHZhbHVlIDwgOTguNSA/ICdncmVhdCcgOiAnZmFudGFzdGljJztcclxuICAgIGNhc2UgJ0NFJzogICAgICByZXR1cm4gdmFsdWUgPT09IDAgPyAnZmFudGFzdGljJyA6ICdwb29yJztcclxuICAgIGNhc2UgJ0NERkRQTU8nOiByZXR1cm4gdmFsdWUgPiA1NDYwID8gJ3Bvb3InIDogdmFsdWUgPiA0NDUwID8gJ2ZhaXInIDogdmFsdWUgPiAzNjgwID8gJ2dyZWF0JyA6ICdmYW50YXN0aWMnO1xyXG4gICAgZGVmYXVsdDogICAgICAgIHJldHVybiAnJztcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzY1N0YXR1c0NsYXNzKHN0YXR1czogc3RyaW5nKTogc3RyaW5nIHtcclxuICBzd2l0Y2ggKHN0YXR1cykge1xyXG4gICAgY2FzZSAnUG9vcic6IHJldHVybiAncG9vcic7IGNhc2UgJ0ZhaXInOiByZXR1cm4gJ2ZhaXInO1xyXG4gICAgY2FzZSAnR3JlYXQnOiByZXR1cm4gJ2dyZWF0JzsgY2FzZSAnRmFudGFzdGljJzogY2FzZSAnRmFudGFzdGljIFBsdXMnOiByZXR1cm4gJ2ZhbnRhc3RpYyc7XHJcbiAgICBkZWZhdWx0OiByZXR1cm4gJyc7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2NQYXJzZUFwaVJlc3BvbnNlKGpzb246IHVua25vd24pOiBTY29yZWNhcmRSb3dbXSB7XHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHRhYmxlRGF0YSA9IChqc29uIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KT8uWyd0YWJsZURhdGEnXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcclxuICAgIGNvbnN0IHNjRGF0YSA9IHRhYmxlRGF0YT8uWydkYV9kc3Bfc3RhdGlvbl93ZWVrbHlfcXVhbGl0eSddIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xyXG4gICAgY29uc3Qgcm93cyA9IHNjRGF0YT8uWydyb3dzJ107XHJcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocm93cykgfHwgcm93cy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcclxuICAgIGNvbnN0IHBhcnNlZDogU2NvcmVjYXJkUm93W10gPSBbXTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcm93cy5sZW5ndGg7IGkrKykge1xyXG4gICAgICB0cnkgeyBwYXJzZWQucHVzaChzY1BhcnNlUm93KHJvd3NbaV0gYXMgc3RyaW5nIHwgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pKTsgfVxyXG4gICAgICBjYXRjaCAoZSkgeyBlcnIoJ1Njb3JlY2FyZDogZmFpbGVkIHRvIHBhcnNlIHJvdycsIGksIGUpOyB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcGFyc2VkO1xyXG4gIH0gY2F0Y2ggKGUpIHsgZXJyKCdzY1BhcnNlQXBpUmVzcG9uc2UgZXJyb3I6JywgZSk7IHJldHVybiBbXTsgfVxyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2NWYWxpZGF0ZVdlZWsod2Vlazogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XHJcbiAgaWYgKCF3ZWVrKSByZXR1cm4gJ1dlZWsgaXMgcmVxdWlyZWQuJztcclxuICBpZiAoIS9eXFxkezR9LVdcXGR7Mn0kLy50ZXN0KHdlZWspKSByZXR1cm4gJ1dlZWsgZm9ybWF0IG11c3QgYmUgWVlZWS1Xd3cgKGUuZy4gMjAyNi1XMTIpLic7XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBzY0N1cnJlbnRXZWVrKCk6IHN0cmluZyB7XHJcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICBjb25zdCBkID0gbmV3IERhdGUoRGF0ZS5VVEMobm93LmdldEZ1bGxZZWFyKCksIG5vdy5nZXRNb250aCgpLCBub3cuZ2V0RGF0ZSgpKSk7XHJcbiAgY29uc3QgZGF5TnVtID0gZC5nZXRVVENEYXkoKSB8fCA3O1xyXG4gIGQuc2V0VVRDRGF0ZShkLmdldFVUQ0RhdGUoKSArIDQgLSBkYXlOdW0pO1xyXG4gIGNvbnN0IHllYXJTdGFydCA9IG5ldyBEYXRlKERhdGUuVVRDKGQuZ2V0VVRDRnVsbFllYXIoKSwgMCwgMSkpO1xyXG4gIGNvbnN0IHdlZWtObyA9IE1hdGguY2VpbCgoKGQuZ2V0VGltZSgpIC0geWVhclN0YXJ0LmdldFRpbWUoKSkgLyA4NjQwMDAwMCArIDEpIC8gNyk7XHJcbiAgcmV0dXJuIGAke2QuZ2V0VVRDRnVsbFllYXIoKX0tVyR7U3RyaW5nKHdlZWtObykucGFkU3RhcnQoMiwgJzAnKX1gO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gc2NXZWVrc0FnbyhuOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgbm93LnNldERhdGUobm93LmdldERhdGUoKSAtIChuICogNykpO1xyXG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShEYXRlLlVUQyhub3cuZ2V0RnVsbFllYXIoKSwgbm93LmdldE1vbnRoKCksIG5vdy5nZXREYXRlKCkpKTtcclxuICBjb25zdCBkYXlOdW0gPSBkLmdldFVUQ0RheSgpIHx8IDc7XHJcbiAgZC5zZXRVVENEYXRlKGQuZ2V0VVRDRGF0ZSgpICsgNCAtIGRheU51bSk7XHJcbiAgY29uc3QgeWVhclN0YXJ0ID0gbmV3IERhdGUoRGF0ZS5VVEMoZC5nZXRVVENGdWxsWWVhcigpLCAwLCAxKSk7XHJcbiAgY29uc3Qgd2Vla05vID0gTWF0aC5jZWlsKCgoZC5nZXRUaW1lKCkgLSB5ZWFyU3RhcnQuZ2V0VGltZSgpKSAvIDg2NDAwMDAwICsgMSkgLyA3KTtcclxuICByZXR1cm4gYCR7ZC5nZXRVVENGdWxsWWVhcigpfS1XJHtTdHJpbmcod2Vla05vKS5wYWRTdGFydCgyLCAnMCcpfWA7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIF9zY0ltZ0twaUNvbG9yKHZhbHVlOiBudW1iZXIsIHR5cGU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgc3dpdGNoICh0eXBlKSB7XHJcbiAgICBjYXNlICdEQ1InOiAgICAgcmV0dXJuIHZhbHVlIDwgOTcgPyAncmdiKDIzNSw1MCwzNSknIDogdmFsdWUgPCA5OC41ID8gJ3JnYigyMjMsMTMwLDY4KScgOiB2YWx1ZSA8IDk5LjUgPyAncmdiKDEyNiwxNzAsODUpJyA6ICdyZ2IoNzcsMTE1LDE5MCknO1xyXG4gICAgY2FzZSAnRE5SRFBNTyc6XHJcbiAgICBjYXNlICdMT1JEUE1PJzogcmV0dXJuIHZhbHVlIDwgMTEwMCA/ICdyZ2IoNzcsMTE1LDE5MCknIDogdmFsdWUgPCAxMzAwID8gJ3JnYigxMjYsMTcwLDg1KScgOiB2YWx1ZSA8IDE1MDAgPyAncmdiKDIyMywxMzAsNjgpJyA6ICdyZ2IoMjM1LDUwLDM1KSc7XHJcbiAgICBjYXNlICdQT0QnOiAgICAgcmV0dXJuIHZhbHVlIDwgOTQgPyAncmdiKDIzNSw1MCwzNSknIDogdmFsdWUgPCA5NS41ID8gJ3JnYigyMjMsMTMwLDY4KScgOiB2YWx1ZSA8IDk3ID8gJ3JnYigxMjYsMTcwLDg1KScgOiAncmdiKDc3LDExNSwxOTApJztcclxuICAgIGNhc2UgJ0NDJzogICAgICByZXR1cm4gdmFsdWUgPCA3MCA/ICdyZ2IoMjM1LDUwLDM1KScgOiB2YWx1ZSA8IDk1ID8gJ3JnYigyMjMsMTMwLDY4KScgOiB2YWx1ZSA8IDk4LjUgPyAncmdiKDEyNiwxNzAsODUpJyA6ICdyZ2IoNzcsMTE1LDE5MCknO1xyXG4gICAgY2FzZSAnQ0UnOiAgICAgIHJldHVybiB2YWx1ZSA9PT0gMCA/ICdyZ2IoNzcsMTE1LDE5MCknIDogJ3JnYigyMzUsNTAsMzUpJztcclxuICAgIGNhc2UgJ0NERkRQTU8nOiByZXR1cm4gdmFsdWUgPiA1NDYwID8gJ3JnYigyMzUsNTAsMzUpJyA6IHZhbHVlID4gNDQ1MCA/ICdyZ2IoMjIzLDEzMCw2OCknIDogdmFsdWUgPiAzNjgwID8gJ3JnYigxMjYsMTcwLDg1KScgOiAncmdiKDc3LDExNSwxOTApJztcclxuICAgIGRlZmF1bHQ6ICAgICAgICByZXR1cm4gJyMxMTExMTEnO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gX3NjSW1nU3RhdHVzQ29sb3Ioc3RhdHVzOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHN3aXRjaCAoc3RhdHVzKSB7XHJcbiAgICBjYXNlICdQb29yJzogcmV0dXJuICdyZ2IoMjM1LDUwLDM1KSc7IGNhc2UgJ0ZhaXInOiByZXR1cm4gJ3JnYigyMjMsMTMwLDY4KSc7XHJcbiAgICBjYXNlICdHcmVhdCc6IHJldHVybiAncmdiKDEyNiwxNzAsODUpJzsgY2FzZSAnRmFudGFzdGljJzogY2FzZSAnRmFudGFzdGljIFBsdXMnOiByZXR1cm4gJ3JnYig3NywxMTUsMTkwKSc7XHJcbiAgICBkZWZhdWx0OiByZXR1cm4gJyMxMTExMTEnO1xyXG4gIH1cclxufVxyXG5cclxuLy8gXHUyNTAwXHUyNTAwIERhc2hib2FyZCBjbGFzcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbmV4cG9ydCBjbGFzcyBTY29yZWNhcmREYXNoYm9hcmQge1xyXG4gIHByaXZhdGUgX292ZXJsYXlFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIF9hY3RpdmUgPSBmYWxzZTtcclxuICBwcml2YXRlIF9jYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCB1bmtub3duPigpO1xyXG4gIHByaXZhdGUgX2NhbGN1bGF0ZWREYXRhOiBDYWxjdWxhdGVkUm93W10gPSBbXTtcclxuICBwcml2YXRlIF9jdXJyZW50U29ydCA9IHsgZmllbGQ6ICd0b3RhbFNjb3JlJywgZGlyOiAnZGVzYycgfTtcclxuICBwcml2YXRlIF9jdXJyZW50UGFnZSA9IDA7XHJcbiAgcHJpdmF0ZSBfcGFnZVNpemUgPSA1MDtcclxuXHJcbiAgLyoqIEV4cG9zZSBwdXJlIGhlbHBlcnMgZm9yIHVuaXQgdGVzdGluZyAqL1xyXG4gIHJlYWRvbmx5IGhlbHBlcnMgPSB7IHNjQ29udmVydFRvRGVjaW1hbCwgc2NQYXJzZVJvdywgc2NDYWxjdWxhdGVTY29yZSwgc2NLcGlDbGFzcywgc2NTdGF0dXNDbGFzcywgc2NQYXJzZUFwaVJlc3BvbnNlLCBzY1ZhbGlkYXRlV2Vlaywgc2NDdXJyZW50V2Vlaywgc2NXZWVrc0FnbyB9O1xyXG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29uZmlnOiBBcHBDb25maWcsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbXBhbnlDb25maWc6IENvbXBhbnlDb25maWcsXHJcbiAgKSB7fVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgTGlmZWN5Y2xlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBpbml0KCk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMuX292ZXJsYXlFbCkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGN1cldlZWsgPSBzY0N1cnJlbnRXZWVrKCk7XHJcbiAgICBjb25zdCBvdmVybGF5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XHJcbiAgICBvdmVybGF5LmlkID0gJ2N0LXNjLW92ZXJsYXknO1xyXG4gICAgb3ZlcmxheS5jbGFzc05hbWUgPSAnY3Qtb3ZlcmxheSc7XHJcbiAgICBvdmVybGF5LnNldEF0dHJpYnV0ZSgncm9sZScsICdkaWFsb2cnKTtcclxuICAgIG92ZXJsYXkuc2V0QXR0cmlidXRlKCdhcmlhLW1vZGFsJywgJ3RydWUnKTtcclxuICAgIG92ZXJsYXkuc2V0QXR0cmlidXRlKCdhcmlhLWxhYmVsJywgJ1Njb3JlY2FyZCBEYXNoYm9hcmQnKTtcclxuICAgIG92ZXJsYXkuaW5uZXJIVE1MID0gYFxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3Qtc2MtcGFuZWxcIj5cclxuICAgICAgICA8aDI+XHVEODNEXHVEQ0NCIFNjb3JlY2FyZDwvaDI+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LWNvbnRyb2xzXCI+XHJcbiAgICAgICAgICA8bGFiZWwgZm9yPVwiY3Qtc2Mtd2Vla1wiPldlZWs6PC9sYWJlbD5cclxuICAgICAgICAgIDxpbnB1dCB0eXBlPVwidGV4dFwiIGlkPVwiY3Qtc2Mtd2Vla1wiIGNsYXNzPVwiY3QtaW5wdXRcIiB2YWx1ZT1cIiR7Y3VyV2Vla31cIiBwbGFjZWhvbGRlcj1cIllZWVktV3d3XCIgbWF4bGVuZ3RoPVwiOFwiIHN0eWxlPVwid2lkdGg6MTAwcHhcIj5cclxuICAgICAgICAgIDxsYWJlbCBmb3I9XCJjdC1zYy1zYVwiPlNlcnZpY2UgQXJlYTo8L2xhYmVsPlxyXG4gICAgICAgICAgPHNlbGVjdCBpZD1cImN0LXNjLXNhXCIgY2xhc3M9XCJjdC1pbnB1dFwiPjxvcHRpb24gdmFsdWU9XCJcIj5XaXJkIGdlbGFkZW5cdTIwMjY8L29wdGlvbj48L3NlbGVjdD5cclxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1hY2NlbnRcIiBpZD1cImN0LXNjLWdvXCI+XHVEODNEXHVERDBEIEZldGNoPC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tcHJpbWFyeVwiIGlkPVwiY3Qtc2MtZXhwb3J0XCI+XHVEODNEXHVEQ0NCIENTViBFeHBvcnQ8L2J1dHRvbj5cclxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1zZWNvbmRhcnlcIiBpZD1cImN0LXNjLWltZ2RsXCI+XHVEODNEXHVEREJDIERvd25sb2FkIEltYWdlPC9idXR0b24+XHJcbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tY2xvc2VcIiBpZD1cImN0LXNjLWNsb3NlXCI+XHUyNzE1IENsb3NlPC9idXR0b24+XHJcbiAgICAgICAgPC9kaXY+XHJcbiAgICAgICAgPGRpdiBpZD1cImN0LXNjLXN0YXR1c1wiIGNsYXNzPVwiY3Qtc3RhdHVzXCIgcm9sZT1cInN0YXR1c1wiIGFyaWEtbGl2ZT1cInBvbGl0ZVwiPjwvZGl2PlxyXG4gICAgICAgIDxkaXYgaWQ9XCJjdC1zYy1ib2R5XCI+PC9kaXY+XHJcbiAgICAgIDwvZGl2PlxyXG4gICAgYDtcclxuXHJcbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG92ZXJsYXkpO1xyXG4gICAgdGhpcy5fb3ZlcmxheUVsID0gb3ZlcmxheTtcclxuXHJcbiAgICB0aGlzLmNvbXBhbnlDb25maWcubG9hZCgpLnRoZW4oKCkgPT4ge1xyXG4gICAgICB0aGlzLmNvbXBhbnlDb25maWcucG9wdWxhdGVTYVNlbGVjdChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2Mtc2EnKSBhcyBIVE1MU2VsZWN0RWxlbWVudCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgaWYgKGUudGFyZ2V0ID09PSBvdmVybGF5KSB0aGlzLmhpZGUoKTsgfSk7XHJcbiAgICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCAoZSkgPT4geyBpZiAoKGUgYXMgS2V5Ym9hcmRFdmVudCkua2V5ID09PSAnRXNjYXBlJykgdGhpcy5oaWRlKCk7IH0pO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXNjLWNsb3NlJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5oaWRlKCkpO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXNjLWdvJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5fdHJpZ2dlckZldGNoKCkpO1xyXG4gICAgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXNjLWV4cG9ydCcpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuX2V4cG9ydENTVigpKTtcclxuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1zYy1pbWdkbCcpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuX2Rvd25sb2FkQXNJbWFnZSgpKTtcclxuXHJcbiAgICBvbkRpc3Bvc2UoKCkgPT4gdGhpcy5kaXNwb3NlKCkpO1xyXG4gICAgbG9nKCdTY29yZWNhcmQgRGFzaGJvYXJkIGluaXRpYWxpemVkJyk7XHJcbiAgfVxyXG5cclxuICBkaXNwb3NlKCk6IHZvaWQge1xyXG4gICAgdGhpcy5fb3ZlcmxheUVsPy5yZW1vdmUoKTsgdGhpcy5fb3ZlcmxheUVsID0gbnVsbDtcclxuICAgIHRoaXMuX2FjdGl2ZSA9IGZhbHNlOyB0aGlzLl9jYWNoZS5jbGVhcigpOyB0aGlzLl9jYWxjdWxhdGVkRGF0YSA9IFtdO1xyXG4gIH1cclxuXHJcbiAgdG9nZ2xlKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmNvbmZpZy5mZWF0dXJlcy5zY29yZWNhcmQpIHtcclxuICAgICAgYWxlcnQoJ1Njb3JlY2FyZCBpc3QgZGVha3RpdmllcnQuIEJpdHRlIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGFrdGl2aWVyZW4uJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuaW5pdCgpO1xyXG4gICAgaWYgKHRoaXMuX2FjdGl2ZSkgdGhpcy5oaWRlKCk7IGVsc2UgdGhpcy5zaG93KCk7XHJcbiAgfVxyXG5cclxuICBzaG93KCk6IHZvaWQge1xyXG4gICAgdGhpcy5pbml0KCk7XHJcbiAgICB0aGlzLl9vdmVybGF5RWwhLmNsYXNzTGlzdC5hZGQoJ3Zpc2libGUnKTtcclxuICAgIHRoaXMuX2FjdGl2ZSA9IHRydWU7XHJcbiAgICAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXNjLXdlZWsnKSBhcyBIVE1MSW5wdXRFbGVtZW50KS5mb2N1cygpO1xyXG4gIH1cclxuXHJcbiAgaGlkZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuX292ZXJsYXlFbD8uY2xhc3NMaXN0LnJlbW92ZSgndmlzaWJsZScpO1xyXG4gICAgdGhpcy5fYWN0aXZlID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgQVBJIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9idWlsZFVybCh3ZWVrOiBzdHJpbmcsIHN0YXRpb246IHN0cmluZywgZHNwOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgJ2h0dHBzOi8vbG9naXN0aWNzLmFtYXpvbi5kZS9wZXJmb3JtYW5jZS9hcGkvdjEvZ2V0RGF0YScgK1xyXG4gICAgICBgP2RhdGFTZXRJZD0ke2VuY29kZVVSSUNvbXBvbmVudCgnZGFfZHNwX3N0YXRpb25fd2Vla2x5X3F1YWxpdHknKX1gICtcclxuICAgICAgYCZkc3A9JHtlbmNvZGVVUklDb21wb25lbnQoZHNwKX0mZnJvbT0ke2VuY29kZVVSSUNvbXBvbmVudCh3ZWVrKX1gICtcclxuICAgICAgYCZzdGF0aW9uPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHN0YXRpb24pfSZ0aW1lRnJhbWU9V2Vla2x5JnRvPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHdlZWspfWBcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIF9mZXRjaERhdGEod2Vlazogc3RyaW5nLCBzdGF0aW9uOiBzdHJpbmcsIGRzcDogc3RyaW5nKTogUHJvbWlzZTx1bmtub3duPiB7XHJcbiAgICBjb25zdCBjYWNoZUtleSA9IGBzY3wke3dlZWt9fCR7c3RhdGlvbn18JHtkc3B9YDtcclxuICAgIGlmICh0aGlzLl9jYWNoZS5oYXMoY2FjaGVLZXkpKSB7IGxvZygnU2NvcmVjYXJkIGNhY2hlIGhpdDonLCBjYWNoZUtleSk7IHJldHVybiB0aGlzLl9jYWNoZS5nZXQoY2FjaGVLZXkpOyB9XHJcblxyXG4gICAgY29uc3QgY3NyZiA9IGdldENTUkZUb2tlbigpO1xyXG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHsgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicgfTtcclxuICAgIGlmIChjc3JmKSBoZWFkZXJzWydhbnRpLWNzcmZ0b2tlbi1hMnonXSA9IGNzcmY7XHJcblxyXG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHdpdGhSZXRyeShhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHIgPSBhd2FpdCBmZXRjaCh0aGlzLl9idWlsZFVybCh3ZWVrLCBzdGF0aW9uLCBkc3ApLCB7IG1ldGhvZDogJ0dFVCcsIGhlYWRlcnMsIGNyZWRlbnRpYWxzOiAnaW5jbHVkZScgfSk7XHJcbiAgICAgIGlmICghci5vaykgdGhyb3cgbmV3IEVycm9yKGBIVFRQICR7ci5zdGF0dXN9OiAke3Iuc3RhdHVzVGV4dH1gKTtcclxuICAgICAgcmV0dXJuIHI7XHJcbiAgICB9LCB7IHJldHJpZXM6IDIsIGJhc2VNczogODAwIH0pO1xyXG5cclxuICAgIGNvbnN0IGpzb24gPSBhd2FpdCByZXNwLmpzb24oKTtcclxuICAgIHRoaXMuX2NhY2hlLnNldChjYWNoZUtleSwganNvbik7XHJcbiAgICBpZiAodGhpcy5fY2FjaGUuc2l6ZSA+IDUwKSB0aGlzLl9jYWNoZS5kZWxldGUodGhpcy5fY2FjaGUua2V5cygpLm5leHQoKS52YWx1ZSBhcyBzdHJpbmcpO1xyXG4gICAgcmV0dXJuIGpzb247XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgVHJpZ2dlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBfdHJpZ2dlckZldGNoKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3Qgd2VlayA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2Mtd2VlaycpIGFzIEhUTUxJbnB1dEVsZW1lbnQpLnZhbHVlLnRyaW0oKTtcclxuICAgIGNvbnN0IHZhbGlkRXJyID0gc2NWYWxpZGF0ZVdlZWsod2Vlayk7XHJcbiAgICBpZiAodmFsaWRFcnIpIHsgdGhpcy5fc2V0U3RhdHVzKCdcdTI2QTBcdUZFMEYgJyArIHZhbGlkRXJyKTsgcmV0dXJuOyB9XHJcblxyXG4gICAgY29uc3Qgc2FTZWxlY3QgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2Mtc2EnKSBhcyBIVE1MU2VsZWN0RWxlbWVudDtcclxuICAgIGNvbnN0IHN0YXRpb24gPSBzYVNlbGVjdC5vcHRpb25zW3NhU2VsZWN0LnNlbGVjdGVkSW5kZXhdPy50ZXh0Q29udGVudD8udHJpbSgpLnRvVXBwZXJDYXNlKCkgfHwgdGhpcy5jb21wYW55Q29uZmlnLmdldERlZmF1bHRTdGF0aW9uKCk7XHJcbiAgICBjb25zdCBkc3AgPSB0aGlzLmNvbXBhbnlDb25maWcuZ2V0RHNwQ29kZSgpO1xyXG5cclxuICAgIHRoaXMuX3NldFN0YXR1cygnXHUyM0YzIExvYWRpbmdcdTIwMjYnKTtcclxuICAgIHRoaXMuX3NldEJvZHkoJzxkaXYgY2xhc3M9XCJjdC1zYy1sb2FkaW5nXCIgcm9sZT1cInN0YXR1c1wiPkZldGNoaW5nIHNjb3JlY2FyZCBkYXRhXHUyMDI2PC9kaXY+Jyk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QganNvbiA9IGF3YWl0IHRoaXMuX2ZldGNoRGF0YSh3ZWVrLCBzdGF0aW9uLCBkc3ApO1xyXG4gICAgICBjb25zdCBwYXJzZWRSb3dzID0gc2NQYXJzZUFwaVJlc3BvbnNlKGpzb24pO1xyXG5cclxuICAgICAgaWYgKHBhcnNlZFJvd3MubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgdGhpcy5fc2V0Qm9keSgnPGRpdiBjbGFzcz1cImN0LXNjLWVtcHR5XCI+Tm8gZGF0YSByZXR1cm5lZCBmb3IgdGhlIHNlbGVjdGVkIHdlZWsuPC9kaXY+Jyk7XHJcbiAgICAgICAgdGhpcy5fc2V0U3RhdHVzKCdcdTI2QTBcdUZFMEYgTm8gcmVjb3JkcyBmb3VuZC4nKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGNhbGN1bGF0ZWQgPSBwYXJzZWRSb3dzLm1hcCgocm93KSA9PiB7XHJcbiAgICAgICAgdHJ5IHsgcmV0dXJuIHNjQ2FsY3VsYXRlU2NvcmUocm93KTsgfVxyXG4gICAgICAgIGNhdGNoIChlKSB7IGVycignU2NvcmVjYXJkOiBmYWlsZWQgdG8gY2FsY3VsYXRlIHNjb3JlOicsIHJvdywgZSk7IHJldHVybiBudWxsOyB9XHJcbiAgICAgIH0pLmZpbHRlcigocik6IHIgaXMgQ2FsY3VsYXRlZFJvdyA9PiByICE9PSBudWxsKTtcclxuXHJcbiAgICAgIGlmIChjYWxjdWxhdGVkLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHRoaXMuX3NldEJvZHkoJzxkaXYgY2xhc3M9XCJjdC1zYy1lcnJvclwiPkFsbCByb3dzIGZhaWxlZCBzY29yZSBjYWxjdWxhdGlvbi48L2Rpdj4nKTtcclxuICAgICAgICB0aGlzLl9zZXRTdGF0dXMoJ1x1Mjc0QyBDYWxjdWxhdGlvbiBmYWlsZWQgZm9yIGFsbCByb3dzLicpOyByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhbGN1bGF0ZWQuc29ydCgoYSwgYikgPT4gYi50b3RhbFNjb3JlIC0gYS50b3RhbFNjb3JlKTtcclxuICAgICAgdGhpcy5fY2FsY3VsYXRlZERhdGEgPSBjYWxjdWxhdGVkO1xyXG4gICAgICB0aGlzLl9jdXJyZW50UGFnZSA9IDA7XHJcbiAgICAgIHRoaXMuX2N1cnJlbnRTb3J0ID0geyBmaWVsZDogJ3RvdGFsU2NvcmUnLCBkaXI6ICdkZXNjJyB9O1xyXG4gICAgICB0aGlzLl9yZW5kZXJBbGwoKTtcclxuICAgICAgdGhpcy5fc2V0U3RhdHVzKGBcdTI3MDUgJHtjYWxjdWxhdGVkLmxlbmd0aH0gcmVjb3JkKHMpIGxvYWRlZCBcdTIwMTQgJHt3ZWVrfWApO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBlcnIoJ1Njb3JlY2FyZCBmZXRjaCBmYWlsZWQ6JywgZSk7XHJcbiAgICAgIHRoaXMuX3NldEJvZHkoYDxkaXYgY2xhc3M9XCJjdC1zYy1lcnJvclwiPlx1Mjc0QyAke2VzYygoZSBhcyBFcnJvcikubWVzc2FnZSl9PC9kaXY+YCk7XHJcbiAgICAgIHRoaXMuX3NldFN0YXR1cygnXHUyNzRDIEZhaWxlZCB0byBsb2FkIGRhdGEuJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9zZXRTdGF0dXMobXNnOiBzdHJpbmcpOiB2b2lkIHsgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2Mtc3RhdHVzJyk7IGlmIChlbCkgZWwudGV4dENvbnRlbnQgPSBtc2c7IH1cclxuICBwcml2YXRlIF9zZXRCb2R5KGh0bWw6IHN0cmluZyk6IHZvaWQgeyBjb25zdCBlbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC1zYy1ib2R5Jyk7IGlmIChlbCkgZWwuaW5uZXJIVE1MID0gaHRtbDsgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgUmVuZGVyaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9yZW5kZXJBbGwoKTogdm9pZCB7XHJcbiAgICBjb25zdCBkYXRhID0gdGhpcy5fY2FsY3VsYXRlZERhdGE7XHJcbiAgICBpZiAoIWRhdGEubGVuZ3RoKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgYXZnU2NvcmUgPSBkYXRhLnJlZHVjZSgocywgcikgPT4gcyArIHIudG90YWxTY29yZSwgMCkgLyBkYXRhLmxlbmd0aDtcclxuICAgIGNvbnN0IGNvdW50czogUmVjb3JkPHN0cmluZywgbnVtYmVyPiA9IHt9O1xyXG4gICAgZm9yIChjb25zdCByIG9mIGRhdGEpIHsgY291bnRzW3Iuc3RhdHVzXSA9IChjb3VudHNbci5zdGF0dXNdIHx8IDApICsgMTsgfVxyXG5cclxuICAgIGNvbnN0IHRpbGVzSHRtbCA9IGBcclxuICAgICAgPGRpdiBjbGFzcz1cImN0LXNjLXRpbGVzXCI+XHJcbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LXNjLXRpbGVcIj48ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZS12YWxcIj4ke2RhdGEubGVuZ3RofTwvZGl2PjxkaXYgY2xhc3M9XCJjdC1zYy10aWxlLWxibFwiPlRvdGFsIFJlY29yZHM8L2Rpdj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZVwiPjxkaXYgY2xhc3M9XCJjdC1zYy10aWxlLXZhbFwiPiR7YXZnU2NvcmUudG9GaXhlZCgxKX08L2Rpdj48ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZS1sYmxcIj5BdmcgU2NvcmU8L2Rpdj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZSBjdC1zYy10aWxlLS1mYW50YXN0aWNcIj48ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZS12YWxcIj4keyhjb3VudHNbJ0ZhbnRhc3RpYyddIHx8IDApICsgKGNvdW50c1snRmFudGFzdGljIFBsdXMnXSB8fCAwKX08L2Rpdj48ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZS1sYmxcIj5GYW50YXN0aWMoKyk8L2Rpdj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZSBjdC1zYy10aWxlLS1ncmVhdFwiPjxkaXYgY2xhc3M9XCJjdC1zYy10aWxlLXZhbFwiPiR7Y291bnRzWydHcmVhdCddIHx8IDB9PC9kaXY+PGRpdiBjbGFzcz1cImN0LXNjLXRpbGUtbGJsXCI+R3JlYXQ8L2Rpdj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZSBjdC1zYy10aWxlLS1mYWlyXCI+PGRpdiBjbGFzcz1cImN0LXNjLXRpbGUtdmFsXCI+JHtjb3VudHNbJ0ZhaXInXSB8fCAwfTwvZGl2PjxkaXYgY2xhc3M9XCJjdC1zYy10aWxlLWxibFwiPkZhaXI8L2Rpdj48L2Rpdj5cclxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3Qtc2MtdGlsZSBjdC1zYy10aWxlLS1wb29yXCI+PGRpdiBjbGFzcz1cImN0LXNjLXRpbGUtdmFsXCI+JHtjb3VudHNbJ1Bvb3InXSB8fCAwfTwvZGl2PjxkaXYgY2xhc3M9XCJjdC1zYy10aWxlLWxibFwiPlBvb3I8L2Rpdj48L2Rpdj5cclxuICAgICAgPC9kaXY+YDtcclxuXHJcbiAgICBjb25zdCBzdGFydCA9IHRoaXMuX2N1cnJlbnRQYWdlICogdGhpcy5fcGFnZVNpemU7XHJcbiAgICBjb25zdCBwYWdlRGF0YSA9IGRhdGEuc2xpY2Uoc3RhcnQsIE1hdGgubWluKHN0YXJ0ICsgdGhpcy5fcGFnZVNpemUsIGRhdGEubGVuZ3RoKSk7XHJcbiAgICBjb25zdCB0b3RhbFBhZ2VzID0gTWF0aC5jZWlsKGRhdGEubGVuZ3RoIC8gdGhpcy5fcGFnZVNpemUpO1xyXG5cclxuICAgIGNvbnN0IHNvcnRBcnJvdyA9IChmaWVsZDogc3RyaW5nKSA9PiB0aGlzLl9jdXJyZW50U29ydC5maWVsZCAhPT0gZmllbGQgPyAnJyA6IHRoaXMuX2N1cnJlbnRTb3J0LmRpciA9PT0gJ2FzYycgPyAnIFx1MjVCMicgOiAnIFx1MjVCQyc7XHJcblxyXG4gICAgY29uc3Qgcm93c0h0bWwgPSBwYWdlRGF0YS5tYXAoKHJvdywgaSkgPT4ge1xyXG4gICAgICBjb25zdCBwbGFjZSA9IHN0YXJ0ICsgaSArIDE7XHJcbiAgICAgIGNvbnN0IHNDbGFzcyA9IHNjU3RhdHVzQ2xhc3Mocm93LnN0YXR1cyk7XHJcbiAgICAgIHJldHVybiBgPHRyPlxyXG4gICAgICAgIDx0ZD4ke3BsYWNlfTwvdGQ+XHJcbiAgICAgICAgPHRkIHRpdGxlPVwiJHtlc2Mocm93LnRyYW5zcG9ydGVySWQpfVwiPiR7ZXNjKHJvdy5kYU5hbWUgfHwgcm93LnRyYW5zcG9ydGVySWQpfTwvdGQ+XHJcbiAgICAgICAgPHRkIGNsYXNzPVwiY3Qtc2Mtc3RhdHVzLS0ke3NDbGFzc31cIj4ke2VzYyhyb3cuc3RhdHVzKX08L3RkPlxyXG4gICAgICAgIDx0ZD48c3Ryb25nPiR7cm93LnRvdGFsU2NvcmUudG9GaXhlZCgyKX08L3N0cm9uZz48L3RkPlxyXG4gICAgICAgIDx0ZD4ke2VzYyhOdW1iZXIocm93LmRlbGl2ZXJlZCkudG9Mb2NhbGVTdHJpbmcoKSl9PC90ZD5cclxuICAgICAgICA8dGQgY2xhc3M9XCJjdC1zYy1jb2xvci0tJHtzY0twaUNsYXNzKHBhcnNlRmxvYXQocm93LmRjciksICdEQ1InKX1cIj4ke3Jvdy5kY3J9JTwvdGQ+XHJcbiAgICAgICAgPHRkIGNsYXNzPVwiY3Qtc2MtY29sb3ItLSR7c2NLcGlDbGFzcyhwYXJzZUZsb2F0KHJvdy5kbnJEcG1vKSwgJ0ROUkRQTU8nKX1cIj4ke3BhcnNlSW50KHJvdy5kbnJEcG1vLCAxMCl9PC90ZD5cclxuICAgICAgICA8dGQgY2xhc3M9XCJjdC1zYy1jb2xvci0tJHtzY0twaUNsYXNzKHBhcnNlRmxvYXQocm93LmxvckRwbW8pLCAnTE9SRFBNTycpfVwiPiR7cGFyc2VJbnQocm93LmxvckRwbW8sIDEwKX08L3RkPlxyXG4gICAgICAgIDx0ZCBjbGFzcz1cImN0LXNjLWNvbG9yLS0ke3NjS3BpQ2xhc3MocGFyc2VGbG9hdChyb3cucG9kKSwgJ1BPRCcpfVwiPiR7cm93LnBvZH0lPC90ZD5cclxuICAgICAgICA8dGQgY2xhc3M9XCJjdC1zYy1jb2xvci0tJHtzY0twaUNsYXNzKHBhcnNlRmxvYXQocm93LmNjKSwgJ0NDJyl9XCI+JHtyb3cuY2N9JTwvdGQ+XHJcbiAgICAgICAgPHRkIGNsYXNzPVwiY3Qtc2MtY29sb3ItLSR7c2NLcGlDbGFzcyhwYXJzZUZsb2F0KHJvdy5jZSksICdDRScpfVwiPiR7cGFyc2VJbnQocm93LmNlLCAxMCl9PC90ZD5cclxuICAgICAgICA8dGQgY2xhc3M9XCJjdC1zYy1jb2xvci0tJHtzY0twaUNsYXNzKHBhcnNlRmxvYXQocm93LmNkZkRwbW8pLCAnQ0RGRFBNTycpfVwiPiR7cGFyc2VJbnQocm93LmNkZkRwbW8sIDEwKX08L3RkPlxyXG4gICAgICA8L3RyPmA7XHJcbiAgICB9KS5qb2luKCcnKTtcclxuXHJcbiAgICBjb25zdCB0YWJsZUh0bWwgPSBgXHJcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC1zYy10YWJsZS13cmFwXCI+XHJcbiAgICAgICAgPHRhYmxlIGNsYXNzPVwiY3Qtc2MtdGFibGVcIj5cclxuICAgICAgICAgIDx0aGVhZD48dHI+XHJcbiAgICAgICAgICAgIDx0aCBkYXRhLXNvcnQ9XCJwbGFjZVwiPiMke3NvcnRBcnJvdygncGxhY2UnKX08L3RoPlxyXG4gICAgICAgICAgICA8dGggZGF0YS1zb3J0PVwiZGFOYW1lXCI+REEke3NvcnRBcnJvdygnZGFOYW1lJyl9PC90aD5cclxuICAgICAgICAgICAgPHRoIGRhdGEtc29ydD1cInN0YXR1c1wiPlN0YXR1cyR7c29ydEFycm93KCdzdGF0dXMnKX08L3RoPlxyXG4gICAgICAgICAgICA8dGggZGF0YS1zb3J0PVwidG90YWxTY29yZVwiPlRvdGFsIFNjb3JlJHtzb3J0QXJyb3coJ3RvdGFsU2NvcmUnKX08L3RoPlxyXG4gICAgICAgICAgICA8dGggZGF0YS1zb3J0PVwiZGVsaXZlcmVkXCI+RGVsaXZlcmVkJHtzb3J0QXJyb3coJ2RlbGl2ZXJlZCcpfTwvdGg+XHJcbiAgICAgICAgICAgIDx0aCBkYXRhLXNvcnQ9XCJkY3JcIj5EQ1Ike3NvcnRBcnJvdygnZGNyJyl9PC90aD5cclxuICAgICAgICAgICAgPHRoIGRhdGEtc29ydD1cImRuckRwbW9cIj5ETlIgRFBNTyR7c29ydEFycm93KCdkbnJEcG1vJyl9PC90aD5cclxuICAgICAgICAgICAgPHRoIGRhdGEtc29ydD1cImxvckRwbW9cIj5MT1IgRFBNTyR7c29ydEFycm93KCdsb3JEcG1vJyl9PC90aD5cclxuICAgICAgICAgICAgPHRoIGRhdGEtc29ydD1cInBvZFwiPlBPRCR7c29ydEFycm93KCdwb2QnKX08L3RoPlxyXG4gICAgICAgICAgICA8dGggZGF0YS1zb3J0PVwiY2NcIj5DQyR7c29ydEFycm93KCdjYycpfTwvdGg+XHJcbiAgICAgICAgICAgIDx0aCBkYXRhLXNvcnQ9XCJjZVwiPkNFJHtzb3J0QXJyb3coJ2NlJyl9PC90aD5cclxuICAgICAgICAgICAgPHRoIGRhdGEtc29ydD1cImNkZkRwbW9cIj5DREYgRFBNTyR7c29ydEFycm93KCdjZGZEcG1vJyl9PC90aD5cclxuICAgICAgICAgIDwvdHI+PC90aGVhZD5cclxuICAgICAgICAgIDx0Ym9keT4ke3Jvd3NIdG1sfTwvdGJvZHk+XHJcbiAgICAgICAgPC90YWJsZT5cclxuICAgICAgPC9kaXY+YDtcclxuXHJcbiAgICBjb25zdCBwYWdpbmF0aW9uSHRtbCA9IHRvdGFsUGFnZXMgPiAxID8gYFxyXG4gICAgICA8ZGl2IGNsYXNzPVwiY3Qtc2MtcGFnaW5hdGlvblwiPlxyXG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1zZWNvbmRhcnkgY3Qtc2MtcGFnZS1wcmV2XCIgJHt0aGlzLl9jdXJyZW50UGFnZSA9PT0gMCA/ICdkaXNhYmxlZCcgOiAnJ30+XHUyNUMwIFByZXY8L2J1dHRvbj5cclxuICAgICAgICA8c3BhbiBjbGFzcz1cImN0LXNjLXBhZ2UtaW5mb1wiPlBhZ2UgJHt0aGlzLl9jdXJyZW50UGFnZSArIDF9IG9mICR7dG90YWxQYWdlc308L3NwYW4+XHJcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXNlY29uZGFyeSBjdC1zYy1wYWdlLW5leHRcIiAke3RoaXMuX2N1cnJlbnRQYWdlID49IHRvdGFsUGFnZXMgLSAxID8gJ2Rpc2FibGVkJyA6ICcnfT5OZXh0IFx1MjVCNjwvYnV0dG9uPlxyXG4gICAgICA8L2Rpdj5gIDogJyc7XHJcblxyXG4gICAgdGhpcy5fc2V0Qm9keSh0aWxlc0h0bWwgKyB0YWJsZUh0bWwgKyBwYWdpbmF0aW9uSHRtbCk7XHJcblxyXG4gICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oJy5jdC1zYy10YWJsZSB0aFtkYXRhLXNvcnRdJykuZm9yRWFjaCgodGgpID0+IHtcclxuICAgICAgdGguYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZmllbGQgPSB0aC5nZXRBdHRyaWJ1dGUoJ2RhdGEtc29ydCcpITtcclxuICAgICAgICBpZiAoZmllbGQgPT09ICdwbGFjZScpIHJldHVybjtcclxuICAgICAgICBpZiAodGhpcy5fY3VycmVudFNvcnQuZmllbGQgPT09IGZpZWxkKSB0aGlzLl9jdXJyZW50U29ydC5kaXIgPSB0aGlzLl9jdXJyZW50U29ydC5kaXIgPT09ICdhc2MnID8gJ2Rlc2MnIDogJ2FzYyc7XHJcbiAgICAgICAgZWxzZSB0aGlzLl9jdXJyZW50U29ydCA9IHsgZmllbGQsIGRpcjogJ2Rlc2MnIH07XHJcbiAgICAgICAgdGhpcy5fc29ydERhdGEoKTsgdGhpcy5fY3VycmVudFBhZ2UgPSAwOyB0aGlzLl9yZW5kZXJBbGwoKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcuY3Qtc2MtcGFnZS1wcmV2Jyk/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4geyB0aGlzLl9jdXJyZW50UGFnZS0tOyB0aGlzLl9yZW5kZXJBbGwoKTsgfSk7XHJcbiAgICBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcuY3Qtc2MtcGFnZS1uZXh0Jyk/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4geyB0aGlzLl9jdXJyZW50UGFnZSsrOyB0aGlzLl9yZW5kZXJBbGwoKTsgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIF9zb3J0RGF0YSgpOiB2b2lkIHtcclxuICAgIGNvbnN0IHsgZmllbGQsIGRpciB9ID0gdGhpcy5fY3VycmVudFNvcnQ7XHJcbiAgICBjb25zdCBtdWx0ID0gZGlyID09PSAnYXNjJyA/IDEgOiAtMTtcclxuICAgIHRoaXMuX2NhbGN1bGF0ZWREYXRhLnNvcnQoKGEsIGIpID0+IHtcclxuICAgICAgY29uc3QgbmEgPSBwYXJzZUZsb2F0KFN0cmluZyhhW2ZpZWxkXSkpLCBuYiA9IHBhcnNlRmxvYXQoU3RyaW5nKGJbZmllbGRdKSk7XHJcbiAgICAgIGlmICghaXNOYU4obmEpICYmICFpc05hTihuYikpIHJldHVybiAobmEgLSBuYikgKiBtdWx0O1xyXG4gICAgICByZXR1cm4gU3RyaW5nKGFbZmllbGRdIHx8ICcnKS5sb2NhbGVDb21wYXJlKFN0cmluZyhiW2ZpZWxkXSB8fCAnJykpICogbXVsdDtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIEltYWdlIERvd25sb2FkIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIF9kb3dubG9hZEFzSW1hZ2UoKTogdm9pZCB7XHJcbiAgICBjb25zdCBkYXRhID0gdGhpcy5fY2FsY3VsYXRlZERhdGE7XHJcbiAgICBpZiAoIWRhdGEubGVuZ3RoKSB7IHRoaXMuX3NldFN0YXR1cygnXHUyNkEwXHVGRTBGIE5vIGRhdGEgdG8gY2FwdHVyZS4gRmV0Y2ggZGF0YSBmaXJzdC4nKTsgcmV0dXJuOyB9XHJcbiAgICB0aGlzLl9zZXRTdGF0dXMoJ1x1MjNGMyBHZW5lcmF0aW5nIGltYWdlXHUyMDI2Jyk7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgU0NBTEUgPSAyLCBGT05UID0gJ0FyaWFsLCBzYW5zLXNlcmlmJywgRk9OVF9TWiA9IDEyLCBIRUFEX1NaID0gMTEsIFBBRF9YID0gOCwgUEFEX1kgPSA2O1xyXG4gICAgICBjb25zdCBST1dfSCA9IEZPTlRfU1ogKyBQQURfWSAqIDIsIEhFQURfSCA9IEhFQURfU1ogKyBQQURfWSAqIDIsIFRJVExFX0ggPSAzMjtcclxuICAgICAgY29uc3Qgd2VlayA9IChkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2Mtd2VlaycpIGFzIEhUTUxJbnB1dEVsZW1lbnQpPy52YWx1ZSB8fCAnJztcclxuICAgICAgY29uc3QgQ09MUyA9IFtcclxuICAgICAgICB7IGxhYmVsOiAnIycsICAgICAgICAgdzogMzYsICBnZXQ6IChfcjogQ2FsY3VsYXRlZFJvdywgaTogbnVtYmVyKSA9PiBTdHJpbmcoaSArIDEpLCBjb2xvcjogdW5kZWZpbmVkIGFzIHVuZGVmaW5lZCB8ICgocjogQ2FsY3VsYXRlZFJvdykgPT4gc3RyaW5nKSB9LFxyXG4gICAgICAgIHsgbGFiZWw6ICdEQScsICAgICAgICB3OiAxODAsIGdldDogKHI6IENhbGN1bGF0ZWRSb3cpID0+IHIuZGFOYW1lIHx8IHIudHJhbnNwb3J0ZXJJZCwgY29sb3I6IHVuZGVmaW5lZCB9LFxyXG4gICAgICAgIHsgbGFiZWw6ICdTdGF0dXMnLCAgICB3OiA5MCwgIGdldDogKHI6IENhbGN1bGF0ZWRSb3cpID0+IHIuc3RhdHVzLCBjb2xvcjogKHI6IENhbGN1bGF0ZWRSb3cpID0+IF9zY0ltZ1N0YXR1c0NvbG9yKHIuc3RhdHVzKSB9LFxyXG4gICAgICAgIHsgbGFiZWw6ICdTY29yZScsICAgICB3OiA2MCwgIGdldDogKHI6IENhbGN1bGF0ZWRSb3cpID0+IHIudG90YWxTY29yZS50b0ZpeGVkKDIpLCBjb2xvcjogdW5kZWZpbmVkIH0sXHJcbiAgICAgICAgeyBsYWJlbDogJ0RlbGl2ZXJlZCcsIHc6IDcwLCAgZ2V0OiAocjogQ2FsY3VsYXRlZFJvdykgPT4gU3RyaW5nKE51bWJlcihyLmRlbGl2ZXJlZCkudG9Mb2NhbGVTdHJpbmcoKSksIGNvbG9yOiB1bmRlZmluZWQgfSxcclxuICAgICAgICB7IGxhYmVsOiAnRENSJywgICAgICAgdzogNTgsICBnZXQ6IChyOiBDYWxjdWxhdGVkUm93KSA9PiByLmRjciArICclJywgY29sb3I6IChyOiBDYWxjdWxhdGVkUm93KSA9PiBfc2NJbWdLcGlDb2xvcihwYXJzZUZsb2F0KHIuZGNyKSwgJ0RDUicpIH0sXHJcbiAgICAgICAgeyBsYWJlbDogJ0ROUiBEUE1PJywgIHc6IDcyLCAgZ2V0OiAocjogQ2FsY3VsYXRlZFJvdykgPT4gU3RyaW5nKHBhcnNlSW50KHIuZG5yRHBtbywgMTApKSwgY29sb3I6IChyOiBDYWxjdWxhdGVkUm93KSA9PiBfc2NJbWdLcGlDb2xvcihwYXJzZUZsb2F0KHIuZG5yRHBtbyksICdETlJEUE1PJykgfSxcclxuICAgICAgICB7IGxhYmVsOiAnTE9SIERQTU8nLCAgdzogNzIsICBnZXQ6IChyOiBDYWxjdWxhdGVkUm93KSA9PiBTdHJpbmcocGFyc2VJbnQoci5sb3JEcG1vLCAxMCkpLCBjb2xvcjogKHI6IENhbGN1bGF0ZWRSb3cpID0+IF9zY0ltZ0twaUNvbG9yKHBhcnNlRmxvYXQoci5sb3JEcG1vKSwgJ0xPUkRQTU8nKSB9LFxyXG4gICAgICAgIHsgbGFiZWw6ICdQT0QnLCAgICAgICB3OiA1OCwgIGdldDogKHI6IENhbGN1bGF0ZWRSb3cpID0+IHIucG9kICsgJyUnLCBjb2xvcjogKHI6IENhbGN1bGF0ZWRSb3cpID0+IF9zY0ltZ0twaUNvbG9yKHBhcnNlRmxvYXQoci5wb2QpLCAnUE9EJykgfSxcclxuICAgICAgICB7IGxhYmVsOiAnQ0MnLCAgICAgICAgdzogNTgsICBnZXQ6IChyOiBDYWxjdWxhdGVkUm93KSA9PiByLmNjICsgJyUnLCBjb2xvcjogKHI6IENhbGN1bGF0ZWRSb3cpID0+IF9zY0ltZ0twaUNvbG9yKHBhcnNlRmxvYXQoci5jYyksICdDQycpIH0sXHJcbiAgICAgICAgeyBsYWJlbDogJ0NFJywgICAgICAgIHc6IDQ0LCAgZ2V0OiAocjogQ2FsY3VsYXRlZFJvdykgPT4gU3RyaW5nKHBhcnNlSW50KHIuY2UsIDEwKSksIGNvbG9yOiAocjogQ2FsY3VsYXRlZFJvdykgPT4gX3NjSW1nS3BpQ29sb3IocGFyc2VGbG9hdChyLmNlKSwgJ0NFJykgfSxcclxuICAgICAgICB7IGxhYmVsOiAnQ0RGIERQTU8nLCAgdzogNzIsICBnZXQ6IChyOiBDYWxjdWxhdGVkUm93KSA9PiBTdHJpbmcocGFyc2VJbnQoci5jZGZEcG1vLCAxMCkpLCBjb2xvcjogKHI6IENhbGN1bGF0ZWRSb3cpID0+IF9zY0ltZ0twaUNvbG9yKHBhcnNlRmxvYXQoci5jZGZEcG1vKSwgJ0NERkRQTU8nKSB9LFxyXG4gICAgICBdO1xyXG5cclxuICAgICAgY29uc3QgdG90YWxXID0gQ09MUy5yZWR1Y2UoKHMsIGMpID0+IHMgKyBjLncsIDApO1xyXG4gICAgICBjb25zdCB0b3RhbEggPSBUSVRMRV9IICsgSEVBRF9IICsgZGF0YS5sZW5ndGggKiBST1dfSDtcclxuXHJcbiAgICAgIGNvbnN0IGNhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xyXG4gICAgICBjYW52YXMud2lkdGggPSB0b3RhbFcgKiBTQ0FMRTsgY2FudmFzLmhlaWdodCA9IHRvdGFsSCAqIFNDQUxFO1xyXG4gICAgICBjb25zdCBjdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSE7XHJcbiAgICAgIGN0eC5zY2FsZShTQ0FMRSwgU0NBTEUpO1xyXG4gICAgICBjdHguZmlsbFN0eWxlID0gJyNmZmZmZmYnOyBjdHguZmlsbFJlY3QoMCwgMCwgdG90YWxXLCB0b3RhbEgpO1xyXG4gICAgICBjdHguZmlsbFN0eWxlID0gJyMyMzJmM2UnOyBjdHguZmlsbFJlY3QoMCwgMCwgdG90YWxXLCBUSVRMRV9IKTtcclxuICAgICAgY3R4LmZpbGxTdHlsZSA9ICcjZmY5OTAwJzsgY3R4LmZvbnQgPSBgYm9sZCAxNHB4ICR7Rk9OVH1gOyBjdHgudGV4dEJhc2VsaW5lID0gJ21pZGRsZSc7IGN0eC50ZXh0QWxpZ24gPSAnbGVmdCc7XHJcbiAgICAgIGN0eC5maWxsVGV4dChgXHVEODNEXHVEQ0NCIFNjb3JlY2FyZCR7d2VlayA/ICcgXHUyMDE0ICcgKyB3ZWVrIDogJyd9YCwgUEFEX1gsIFRJVExFX0ggLyAyKTtcclxuXHJcbiAgICAgIGxldCB4ID0gMDtcclxuICAgICAgY3R4LmZpbGxTdHlsZSA9ICcjMjMyZjNlJzsgY3R4LmZpbGxSZWN0KDAsIFRJVExFX0gsIHRvdGFsVywgSEVBRF9IKTtcclxuICAgICAgY3R4LmZvbnQgPSBgYm9sZCAke0hFQURfU1p9cHggJHtGT05UfWA7IGN0eC5maWxsU3R5bGUgPSAnI2ZmOTkwMCc7IGN0eC50ZXh0QmFzZWxpbmUgPSAnbWlkZGxlJztcclxuICAgICAgZm9yIChjb25zdCBjb2wgb2YgQ09MUykge1xyXG4gICAgICAgIGN0eC50ZXh0QWxpZ24gPSAnY2VudGVyJzsgY3R4LnNhdmUoKTsgY3R4LmJlZ2luUGF0aCgpOyBjdHgucmVjdCh4LCBUSVRMRV9ILCBjb2wudywgSEVBRF9IKTsgY3R4LmNsaXAoKTtcclxuICAgICAgICBjdHguZmlsbFRleHQoY29sLmxhYmVsLCB4ICsgY29sLncgLyAyLCBUSVRMRV9IICsgSEVBRF9IIC8gMik7IGN0eC5yZXN0b3JlKCk7XHJcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gJyMzZDRmNjAnOyBjdHgubGluZVdpZHRoID0gMC41OyBjdHguYmVnaW5QYXRoKCk7IGN0eC5tb3ZlVG8oeCwgVElUTEVfSCk7IGN0eC5saW5lVG8oeCwgVElUTEVfSCArIEhFQURfSCk7IGN0eC5zdHJva2UoKTtcclxuICAgICAgICB4ICs9IGNvbC53O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjdHguZm9udCA9IGAke0ZPTlRfU1p9cHggJHtGT05UfWA7IGN0eC5saW5lV2lkdGggPSAwLjU7XHJcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGF0YS5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgIGNvbnN0IHJvdyA9IGRhdGFbaV07XHJcbiAgICAgICAgY29uc3Qgcm93WSA9IFRJVExFX0ggKyBIRUFEX0ggKyBpICogUk9XX0g7XHJcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IGkgJSAyID09PSAwID8gJyNmZmZmZmYnIDogJyNmOWY5ZjknOyBjdHguZmlsbFJlY3QoMCwgcm93WSwgdG90YWxXLCBST1dfSCk7XHJcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gJyNkZGRkZGQnOyBjdHguYmVnaW5QYXRoKCk7IGN0eC5tb3ZlVG8oMCwgcm93WSArIFJPV19IKTsgY3R4LmxpbmVUbyh0b3RhbFcsIHJvd1kgKyBST1dfSCk7IGN0eC5zdHJva2UoKTtcclxuICAgICAgICB4ID0gMDtcclxuICAgICAgICBmb3IgKGNvbnN0IGNvbCBvZiBDT0xTKSB7XHJcbiAgICAgICAgICBjb25zdCB0ZXh0ID0gY29sLmdldChyb3csIGkpO1xyXG4gICAgICAgICAgY29uc3QgY29sb3IgPSBjb2wuY29sb3IgPyBjb2wuY29sb3Iocm93KSA6ICcjMTExMTExJztcclxuICAgICAgICAgIGN0eC5maWxsU3R5bGUgPSBjb2xvcjsgY3R4LnRleHRCYXNlbGluZSA9ICdtaWRkbGUnOyBjdHgudGV4dEFsaWduID0gJ2NlbnRlcic7XHJcbiAgICAgICAgICBjdHguc2F2ZSgpOyBjdHguYmVnaW5QYXRoKCk7IGN0eC5yZWN0KHggKyAxLCByb3dZLCBjb2wudyAtIDIsIFJPV19IKTsgY3R4LmNsaXAoKTtcclxuICAgICAgICAgIGN0eC5maWxsVGV4dCh0ZXh0LCB4ICsgY29sLncgLyAyLCByb3dZICsgUk9XX0ggLyAyKTsgY3R4LnJlc3RvcmUoKTtcclxuICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9ICcjZGRkZGRkJzsgY3R4LmJlZ2luUGF0aCgpOyBjdHgubW92ZVRvKHgsIHJvd1kpOyBjdHgubGluZVRvKHgsIHJvd1kgKyBST1dfSCk7IGN0eC5zdHJva2UoKTtcclxuICAgICAgICAgIHggKz0gY29sLnc7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjdHguc3Ryb2tlU3R5bGUgPSAnI2FhYWFhYSc7IGN0eC5saW5lV2lkdGggPSAxOyBjdHguc3Ryb2tlUmVjdCgwLCAwLCB0b3RhbFcsIHRvdGFsSCk7XHJcblxyXG4gICAgICBjYW52YXMudG9CbG9iKChibG9iKSA9PiB7XHJcbiAgICAgICAgaWYgKCFibG9iKSB7IHRoaXMuX3NldFN0YXR1cygnXHUyNzRDIEltYWdlIGdlbmVyYXRpb24gZmFpbGVkLicpOyByZXR1cm47IH1cclxuICAgICAgICBjb25zdCBkbFVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICAgICAgY29uc3QgYSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2EnKTtcclxuICAgICAgICBhLmhyZWYgPSBkbFVybDsgYS5kb3dubG9hZCA9IGBzY29yZWNhcmRfJHt3ZWVrIHx8ICdleHBvcnQnfS5wbmdgO1xyXG4gICAgICAgIGEuY2xpY2soKTsgVVJMLnJldm9rZU9iamVjdFVSTChkbFVybCk7XHJcbiAgICAgICAgdGhpcy5fc2V0U3RhdHVzKCdcdTI3MDUgSW1hZ2UgZG93bmxvYWRlZC4nKTtcclxuICAgICAgfSwgJ2ltYWdlL3BuZycpO1xyXG4gICAgfSBjYXRjaCAoZSkge1xyXG4gICAgICBlcnIoJ1Njb3JlY2FyZCBpbWFnZSBkb3dubG9hZCBmYWlsZWQ6JywgZSk7XHJcbiAgICAgIHRoaXMuX3NldFN0YXR1cygnXHUyNzRDIEltYWdlIGdlbmVyYXRpb24gZmFpbGVkOiAnICsgKGUgYXMgRXJyb3IpLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIENTViBFeHBvcnQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgX2V4cG9ydENTVigpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5fY2FsY3VsYXRlZERhdGEubGVuZ3RoKSB7IHRoaXMuX3NldFN0YXR1cygnXHUyNkEwXHVGRTBGIE5vIGRhdGEgdG8gZXhwb3J0LicpOyByZXR1cm47IH1cclxuICAgIGNvbnN0IGhlYWRlcnMgPSBbJ1BsYWNlJywgJ0RBJywgJ1N0YXR1cycsICdUb3RhbCBTY29yZScsICdEZWxpdmVyZWQnLCAnRENSJywgJ0ROUiBEUE1PJywgJ0xPUiBEUE1PJywgJ1BPRCcsICdDQycsICdDRScsICdDREYgRFBNTycsICdTdGF0aW9uJywgJ0RTUCddO1xyXG4gICAgY29uc3QgY3N2Um93cyA9IFtoZWFkZXJzLmpvaW4oJzsnKV07XHJcbiAgICB0aGlzLl9jYWxjdWxhdGVkRGF0YS5mb3JFYWNoKChyb3csIGkpID0+IHtcclxuICAgICAgY3N2Um93cy5wdXNoKFtpICsgMSwgcm93LmRhTmFtZSB8fCByb3cudHJhbnNwb3J0ZXJJZCwgcm93LnN0YXR1cywgcm93LnRvdGFsU2NvcmUudG9GaXhlZCgyKSwgcm93LmRlbGl2ZXJlZCwgcm93LmRjciwgcGFyc2VJbnQocm93LmRuckRwbW8sIDEwKSwgcGFyc2VJbnQocm93LmxvckRwbW8sIDEwKSwgcm93LnBvZCwgcm93LmNjLCBwYXJzZUludChyb3cuY2UsIDEwKSwgcGFyc2VJbnQocm93LmNkZkRwbW8sIDEwKSwgcm93LnN0YXRpb25Db2RlLCByb3cuZHNwQ29kZV0uam9pbignOycpKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbJ1xcdUZFRkYnICsgY3N2Um93cy5qb2luKCdcXG4nKV0sIHsgdHlwZTogJ3RleHQvY3N2O2NoYXJzZXQ9dXRmLTg7JyB9KTtcclxuICAgIGNvbnN0IHVybCA9IFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYik7XHJcbiAgICBjb25zdCBhID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xyXG4gICAgYS5ocmVmID0gdXJsOyBhLmRvd25sb2FkID0gYHNjb3JlY2FyZF8keyhkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2Mtd2VlaycpIGFzIEhUTUxJbnB1dEVsZW1lbnQpPy52YWx1ZSB8fCAnZGF0YSd9LmNzdmA7XHJcbiAgICBhLmNsaWNrKCk7IFVSTC5yZXZva2VPYmplY3RVUkwodXJsKTtcclxuICAgIHRoaXMuX3NldFN0YXR1cygnXHUyNzA1IENTViBleHBvcnRlZC4nKTtcclxuICB9XHJcbn1cclxuIiwgIi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vL1xuLy8gUVIgQ29kZSBHZW5lcmF0b3IgZm9yIEphdmFTY3JpcHRcbi8vXG4vLyBDb3B5cmlnaHQgKGMpIDIwMDkgS2F6dWhpa28gQXJhc2Vcbi8vXG4vLyBVUkw6IGh0dHA6Ly93d3cuZC1wcm9qZWN0LmNvbS9cbi8vXG4vLyBMaWNlbnNlZCB1bmRlciB0aGUgTUlUIGxpY2Vuc2U6XG4vLyAgaHR0cDovL3d3dy5vcGVuc291cmNlLm9yZy9saWNlbnNlcy9taXQtbGljZW5zZS5waHBcbi8vXG4vLyBUaGUgd29yZCAnUVIgQ29kZScgaXMgcmVnaXN0ZXJlZCB0cmFkZW1hcmsgb2Zcbi8vIERFTlNPIFdBVkUgSU5DT1JQT1JBVEVEXG4vLyAgaHR0cDovL3d3dy5kZW5zby13YXZlLmNvbS9xcmNvZGUvZmFxcGF0ZW50LWUuaHRtbFxuLy9cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBxcmNvZGVcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogcXJjb2RlXG4gKiBAcGFyYW0gdHlwZU51bWJlciAxIHRvIDQwXG4gKiBAcGFyYW0gZXJyb3JDb3JyZWN0aW9uTGV2ZWwgJ0wnLCdNJywnUScsJ0gnXG4gKi9cbmV4cG9ydCBjb25zdCBxcmNvZGUgPSBmdW5jdGlvbih0eXBlTnVtYmVyLCBlcnJvckNvcnJlY3Rpb25MZXZlbCkge1xuXG4gIGNvbnN0IFBBRDAgPSAweEVDO1xuICBjb25zdCBQQUQxID0gMHgxMTtcblxuICBsZXQgX3R5cGVOdW1iZXIgPSB0eXBlTnVtYmVyO1xuICBjb25zdCBfZXJyb3JDb3JyZWN0aW9uTGV2ZWwgPSBRUkVycm9yQ29ycmVjdGlvbkxldmVsW2Vycm9yQ29ycmVjdGlvbkxldmVsXTtcbiAgbGV0IF9tb2R1bGVzID0gbnVsbDtcbiAgbGV0IF9tb2R1bGVDb3VudCA9IDA7XG4gIGxldCBfZGF0YUNhY2hlID0gbnVsbDtcbiAgY29uc3QgX2RhdGFMaXN0ID0gW107XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBjb25zdCBtYWtlSW1wbCA9IGZ1bmN0aW9uKHRlc3QsIG1hc2tQYXR0ZXJuKSB7XG5cbiAgICBfbW9kdWxlQ291bnQgPSBfdHlwZU51bWJlciAqIDQgKyAxNztcbiAgICBfbW9kdWxlcyA9IGZ1bmN0aW9uKG1vZHVsZUNvdW50KSB7XG4gICAgICBjb25zdCBtb2R1bGVzID0gbmV3IEFycmF5KG1vZHVsZUNvdW50KTtcbiAgICAgIGZvciAobGV0IHJvdyA9IDA7IHJvdyA8IG1vZHVsZUNvdW50OyByb3cgKz0gMSkge1xuICAgICAgICBtb2R1bGVzW3Jvd10gPSBuZXcgQXJyYXkobW9kdWxlQ291bnQpO1xuICAgICAgICBmb3IgKGxldCBjb2wgPSAwOyBjb2wgPCBtb2R1bGVDb3VudDsgY29sICs9IDEpIHtcbiAgICAgICAgICBtb2R1bGVzW3Jvd11bY29sXSA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBtb2R1bGVzO1xuICAgIH0oX21vZHVsZUNvdW50KTtcblxuICAgIHNldHVwUG9zaXRpb25Qcm9iZVBhdHRlcm4oMCwgMCk7XG4gICAgc2V0dXBQb3NpdGlvblByb2JlUGF0dGVybihfbW9kdWxlQ291bnQgLSA3LCAwKTtcbiAgICBzZXR1cFBvc2l0aW9uUHJvYmVQYXR0ZXJuKDAsIF9tb2R1bGVDb3VudCAtIDcpO1xuICAgIHNldHVwUG9zaXRpb25BZGp1c3RQYXR0ZXJuKCk7XG4gICAgc2V0dXBUaW1pbmdQYXR0ZXJuKCk7XG4gICAgc2V0dXBUeXBlSW5mbyh0ZXN0LCBtYXNrUGF0dGVybik7XG5cbiAgICBpZiAoX3R5cGVOdW1iZXIgPj0gNykge1xuICAgICAgc2V0dXBUeXBlTnVtYmVyKHRlc3QpO1xuICAgIH1cblxuICAgIGlmIChfZGF0YUNhY2hlID09IG51bGwpIHtcbiAgICAgIF9kYXRhQ2FjaGUgPSBjcmVhdGVEYXRhKF90eXBlTnVtYmVyLCBfZXJyb3JDb3JyZWN0aW9uTGV2ZWwsIF9kYXRhTGlzdCk7XG4gICAgfVxuXG4gICAgbWFwRGF0YShfZGF0YUNhY2hlLCBtYXNrUGF0dGVybik7XG4gIH07XG5cbiAgY29uc3Qgc2V0dXBQb3NpdGlvblByb2JlUGF0dGVybiA9IGZ1bmN0aW9uKHJvdywgY29sKSB7XG5cbiAgICBmb3IgKGxldCByID0gLTE7IHIgPD0gNzsgciArPSAxKSB7XG5cbiAgICAgIGlmIChyb3cgKyByIDw9IC0xIHx8IF9tb2R1bGVDb3VudCA8PSByb3cgKyByKSBjb250aW51ZTtcblxuICAgICAgZm9yIChsZXQgYyA9IC0xOyBjIDw9IDc7IGMgKz0gMSkge1xuXG4gICAgICAgIGlmIChjb2wgKyBjIDw9IC0xIHx8IF9tb2R1bGVDb3VudCA8PSBjb2wgKyBjKSBjb250aW51ZTtcblxuICAgICAgICBpZiAoICgwIDw9IHIgJiYgciA8PSA2ICYmIChjID09IDAgfHwgYyA9PSA2KSApXG4gICAgICAgICAgICB8fCAoMCA8PSBjICYmIGMgPD0gNiAmJiAociA9PSAwIHx8IHIgPT0gNikgKVxuICAgICAgICAgICAgfHwgKDIgPD0gciAmJiByIDw9IDQgJiYgMiA8PSBjICYmIGMgPD0gNCkgKSB7XG4gICAgICAgICAgX21vZHVsZXNbcm93ICsgcl1bY29sICsgY10gPSB0cnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIF9tb2R1bGVzW3JvdyArIHJdW2NvbCArIGNdID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgY29uc3QgZ2V0QmVzdE1hc2tQYXR0ZXJuID0gZnVuY3Rpb24oKSB7XG5cbiAgICBsZXQgbWluTG9zdFBvaW50ID0gMDtcbiAgICBsZXQgcGF0dGVybiA9IDA7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDg7IGkgKz0gMSkge1xuXG4gICAgICBtYWtlSW1wbCh0cnVlLCBpKTtcblxuICAgICAgY29uc3QgbG9zdFBvaW50ID0gUVJVdGlsLmdldExvc3RQb2ludChfdGhpcyk7XG5cbiAgICAgIGlmIChpID09IDAgfHwgbWluTG9zdFBvaW50ID4gbG9zdFBvaW50KSB7XG4gICAgICAgIG1pbkxvc3RQb2ludCA9IGxvc3RQb2ludDtcbiAgICAgICAgcGF0dGVybiA9IGk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBhdHRlcm47XG4gIH07XG5cbiAgY29uc3Qgc2V0dXBUaW1pbmdQYXR0ZXJuID0gZnVuY3Rpb24oKSB7XG5cbiAgICBmb3IgKGxldCByID0gODsgciA8IF9tb2R1bGVDb3VudCAtIDg7IHIgKz0gMSkge1xuICAgICAgaWYgKF9tb2R1bGVzW3JdWzZdICE9IG51bGwpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBfbW9kdWxlc1tyXVs2XSA9IChyICUgMiA9PSAwKTtcbiAgICB9XG5cbiAgICBmb3IgKGxldCBjID0gODsgYyA8IF9tb2R1bGVDb3VudCAtIDg7IGMgKz0gMSkge1xuICAgICAgaWYgKF9tb2R1bGVzWzZdW2NdICE9IG51bGwpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBfbW9kdWxlc1s2XVtjXSA9IChjICUgMiA9PSAwKTtcbiAgICB9XG4gIH07XG5cbiAgY29uc3Qgc2V0dXBQb3NpdGlvbkFkanVzdFBhdHRlcm4gPSBmdW5jdGlvbigpIHtcblxuICAgIGNvbnN0IHBvcyA9IFFSVXRpbC5nZXRQYXR0ZXJuUG9zaXRpb24oX3R5cGVOdW1iZXIpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwb3MubGVuZ3RoOyBpICs9IDEpIHtcblxuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBwb3MubGVuZ3RoOyBqICs9IDEpIHtcblxuICAgICAgICBjb25zdCByb3cgPSBwb3NbaV07XG4gICAgICAgIGNvbnN0IGNvbCA9IHBvc1tqXTtcblxuICAgICAgICBpZiAoX21vZHVsZXNbcm93XVtjb2xdICE9IG51bGwpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAobGV0IHIgPSAtMjsgciA8PSAyOyByICs9IDEpIHtcblxuICAgICAgICAgIGZvciAobGV0IGMgPSAtMjsgYyA8PSAyOyBjICs9IDEpIHtcblxuICAgICAgICAgICAgaWYgKHIgPT0gLTIgfHwgciA9PSAyIHx8IGMgPT0gLTIgfHwgYyA9PSAyXG4gICAgICAgICAgICAgICAgfHwgKHIgPT0gMCAmJiBjID09IDApICkge1xuICAgICAgICAgICAgICBfbW9kdWxlc1tyb3cgKyByXVtjb2wgKyBjXSA9IHRydWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBfbW9kdWxlc1tyb3cgKyByXVtjb2wgKyBjXSA9IGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICBjb25zdCBzZXR1cFR5cGVOdW1iZXIgPSBmdW5jdGlvbih0ZXN0KSB7XG5cbiAgICBjb25zdCBiaXRzID0gUVJVdGlsLmdldEJDSFR5cGVOdW1iZXIoX3R5cGVOdW1iZXIpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCAxODsgaSArPSAxKSB7XG4gICAgICBjb25zdCBtb2QgPSAoIXRlc3QgJiYgKCAoYml0cyA+PiBpKSAmIDEpID09IDEpO1xuICAgICAgX21vZHVsZXNbTWF0aC5mbG9vcihpIC8gMyldW2kgJSAzICsgX21vZHVsZUNvdW50IC0gOCAtIDNdID0gbW9kO1xuICAgIH1cblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTg7IGkgKz0gMSkge1xuICAgICAgY29uc3QgbW9kID0gKCF0ZXN0ICYmICggKGJpdHMgPj4gaSkgJiAxKSA9PSAxKTtcbiAgICAgIF9tb2R1bGVzW2kgJSAzICsgX21vZHVsZUNvdW50IC0gOCAtIDNdW01hdGguZmxvb3IoaSAvIDMpXSA9IG1vZDtcbiAgICB9XG4gIH07XG5cbiAgY29uc3Qgc2V0dXBUeXBlSW5mbyA9IGZ1bmN0aW9uKHRlc3QsIG1hc2tQYXR0ZXJuKSB7XG5cbiAgICBjb25zdCBkYXRhID0gKF9lcnJvckNvcnJlY3Rpb25MZXZlbCA8PCAzKSB8IG1hc2tQYXR0ZXJuO1xuICAgIGNvbnN0IGJpdHMgPSBRUlV0aWwuZ2V0QkNIVHlwZUluZm8oZGF0YSk7XG5cbiAgICAvLyB2ZXJ0aWNhbFxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTU7IGkgKz0gMSkge1xuXG4gICAgICBjb25zdCBtb2QgPSAoIXRlc3QgJiYgKCAoYml0cyA+PiBpKSAmIDEpID09IDEpO1xuXG4gICAgICBpZiAoaSA8IDYpIHtcbiAgICAgICAgX21vZHVsZXNbaV1bOF0gPSBtb2Q7XG4gICAgICB9IGVsc2UgaWYgKGkgPCA4KSB7XG4gICAgICAgIF9tb2R1bGVzW2kgKyAxXVs4XSA9IG1vZDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIF9tb2R1bGVzW19tb2R1bGVDb3VudCAtIDE1ICsgaV1bOF0gPSBtb2Q7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gaG9yaXpvbnRhbFxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMTU7IGkgKz0gMSkge1xuXG4gICAgICBjb25zdCBtb2QgPSAoIXRlc3QgJiYgKCAoYml0cyA+PiBpKSAmIDEpID09IDEpO1xuXG4gICAgICBpZiAoaSA8IDgpIHtcbiAgICAgICAgX21vZHVsZXNbOF1bX21vZHVsZUNvdW50IC0gaSAtIDFdID0gbW9kO1xuICAgICAgfSBlbHNlIGlmIChpIDwgOSkge1xuICAgICAgICBfbW9kdWxlc1s4XVsxNSAtIGkgLSAxICsgMV0gPSBtb2Q7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBfbW9kdWxlc1s4XVsxNSAtIGkgLSAxXSA9IG1vZDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBmaXhlZCBtb2R1bGVcbiAgICBfbW9kdWxlc1tfbW9kdWxlQ291bnQgLSA4XVs4XSA9ICghdGVzdCk7XG4gIH07XG5cbiAgY29uc3QgbWFwRGF0YSA9IGZ1bmN0aW9uKGRhdGEsIG1hc2tQYXR0ZXJuKSB7XG5cbiAgICBsZXQgaW5jID0gLTE7XG4gICAgbGV0IHJvdyA9IF9tb2R1bGVDb3VudCAtIDE7XG4gICAgbGV0IGJpdEluZGV4ID0gNztcbiAgICBsZXQgYnl0ZUluZGV4ID0gMDtcbiAgICBjb25zdCBtYXNrRnVuYyA9IFFSVXRpbC5nZXRNYXNrRnVuY3Rpb24obWFza1BhdHRlcm4pO1xuXG4gICAgZm9yIChsZXQgY29sID0gX21vZHVsZUNvdW50IC0gMTsgY29sID4gMDsgY29sIC09IDIpIHtcblxuICAgICAgaWYgKGNvbCA9PSA2KSBjb2wgLT0gMTtcblxuICAgICAgd2hpbGUgKHRydWUpIHtcblxuICAgICAgICBmb3IgKGxldCBjID0gMDsgYyA8IDI7IGMgKz0gMSkge1xuXG4gICAgICAgICAgaWYgKF9tb2R1bGVzW3Jvd11bY29sIC0gY10gPT0gbnVsbCkge1xuXG4gICAgICAgICAgICBsZXQgZGFyayA9IGZhbHNlO1xuXG4gICAgICAgICAgICBpZiAoYnl0ZUluZGV4IDwgZGF0YS5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgZGFyayA9ICggKCAoZGF0YVtieXRlSW5kZXhdID4+PiBiaXRJbmRleCkgJiAxKSA9PSAxKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgbWFzayA9IG1hc2tGdW5jKHJvdywgY29sIC0gYyk7XG5cbiAgICAgICAgICAgIGlmIChtYXNrKSB7XG4gICAgICAgICAgICAgIGRhcmsgPSAhZGFyaztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgX21vZHVsZXNbcm93XVtjb2wgLSBjXSA9IGRhcms7XG4gICAgICAgICAgICBiaXRJbmRleCAtPSAxO1xuXG4gICAgICAgICAgICBpZiAoYml0SW5kZXggPT0gLTEpIHtcbiAgICAgICAgICAgICAgYnl0ZUluZGV4ICs9IDE7XG4gICAgICAgICAgICAgIGJpdEluZGV4ID0gNztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByb3cgKz0gaW5jO1xuXG4gICAgICAgIGlmIChyb3cgPCAwIHx8IF9tb2R1bGVDb3VudCA8PSByb3cpIHtcbiAgICAgICAgICByb3cgLT0gaW5jO1xuICAgICAgICAgIGluYyA9IC1pbmM7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgY29uc3QgY3JlYXRlQnl0ZXMgPSBmdW5jdGlvbihidWZmZXIsIHJzQmxvY2tzKSB7XG5cbiAgICBsZXQgb2Zmc2V0ID0gMDtcblxuICAgIGxldCBtYXhEY0NvdW50ID0gMDtcbiAgICBsZXQgbWF4RWNDb3VudCA9IDA7XG5cbiAgICBjb25zdCBkY2RhdGEgPSBuZXcgQXJyYXkocnNCbG9ja3MubGVuZ3RoKTtcbiAgICBjb25zdCBlY2RhdGEgPSBuZXcgQXJyYXkocnNCbG9ja3MubGVuZ3RoKTtcblxuICAgIGZvciAobGV0IHIgPSAwOyByIDwgcnNCbG9ja3MubGVuZ3RoOyByICs9IDEpIHtcblxuICAgICAgY29uc3QgZGNDb3VudCA9IHJzQmxvY2tzW3JdLmRhdGFDb3VudDtcbiAgICAgIGNvbnN0IGVjQ291bnQgPSByc0Jsb2Nrc1tyXS50b3RhbENvdW50IC0gZGNDb3VudDtcblxuICAgICAgbWF4RGNDb3VudCA9IE1hdGgubWF4KG1heERjQ291bnQsIGRjQ291bnQpO1xuICAgICAgbWF4RWNDb3VudCA9IE1hdGgubWF4KG1heEVjQ291bnQsIGVjQ291bnQpO1xuXG4gICAgICBkY2RhdGFbcl0gPSBuZXcgQXJyYXkoZGNDb3VudCk7XG5cbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZGNkYXRhW3JdLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGRjZGF0YVtyXVtpXSA9IDB4ZmYgJiBidWZmZXIuZ2V0QnVmZmVyKClbaSArIG9mZnNldF07XG4gICAgICB9XG4gICAgICBvZmZzZXQgKz0gZGNDb3VudDtcblxuICAgICAgY29uc3QgcnNQb2x5ID0gUVJVdGlsLmdldEVycm9yQ29ycmVjdFBvbHlub21pYWwoZWNDb3VudCk7XG4gICAgICBjb25zdCByYXdQb2x5ID0gcXJQb2x5bm9taWFsKGRjZGF0YVtyXSwgcnNQb2x5LmdldExlbmd0aCgpIC0gMSk7XG5cbiAgICAgIGNvbnN0IG1vZFBvbHkgPSByYXdQb2x5Lm1vZChyc1BvbHkpO1xuICAgICAgZWNkYXRhW3JdID0gbmV3IEFycmF5KHJzUG9seS5nZXRMZW5ndGgoKSAtIDEpO1xuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBlY2RhdGFbcl0ubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgICAgY29uc3QgbW9kSW5kZXggPSBpICsgbW9kUG9seS5nZXRMZW5ndGgoKSAtIGVjZGF0YVtyXS5sZW5ndGg7XG4gICAgICAgIGVjZGF0YVtyXVtpXSA9IChtb2RJbmRleCA+PSAwKT8gbW9kUG9seS5nZXRBdChtb2RJbmRleCkgOiAwO1xuICAgICAgfVxuICAgIH1cblxuICAgIGxldCB0b3RhbENvZGVDb3VudCA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCByc0Jsb2Nrcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgdG90YWxDb2RlQ291bnQgKz0gcnNCbG9ja3NbaV0udG90YWxDb3VudDtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gbmV3IEFycmF5KHRvdGFsQ29kZUNvdW50KTtcbiAgICBsZXQgaW5kZXggPSAwO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYXhEY0NvdW50OyBpICs9IDEpIHtcbiAgICAgIGZvciAobGV0IHIgPSAwOyByIDwgcnNCbG9ja3MubGVuZ3RoOyByICs9IDEpIHtcbiAgICAgICAgaWYgKGkgPCBkY2RhdGFbcl0ubGVuZ3RoKSB7XG4gICAgICAgICAgZGF0YVtpbmRleF0gPSBkY2RhdGFbcl1baV07XG4gICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbWF4RWNDb3VudDsgaSArPSAxKSB7XG4gICAgICBmb3IgKGxldCByID0gMDsgciA8IHJzQmxvY2tzLmxlbmd0aDsgciArPSAxKSB7XG4gICAgICAgIGlmIChpIDwgZWNkYXRhW3JdLmxlbmd0aCkge1xuICAgICAgICAgIGRhdGFbaW5kZXhdID0gZWNkYXRhW3JdW2ldO1xuICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGF0YTtcbiAgfTtcblxuICBjb25zdCBjcmVhdGVEYXRhID0gZnVuY3Rpb24odHlwZU51bWJlciwgZXJyb3JDb3JyZWN0aW9uTGV2ZWwsIGRhdGFMaXN0KSB7XG5cbiAgICBjb25zdCByc0Jsb2NrcyA9IFFSUlNCbG9jay5nZXRSU0Jsb2Nrcyh0eXBlTnVtYmVyLCBlcnJvckNvcnJlY3Rpb25MZXZlbCk7XG5cbiAgICBjb25zdCBidWZmZXIgPSBxckJpdEJ1ZmZlcigpO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkYXRhTGlzdC5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3QgZGF0YSA9IGRhdGFMaXN0W2ldO1xuICAgICAgYnVmZmVyLnB1dChkYXRhLmdldE1vZGUoKSwgNCk7XG4gICAgICBidWZmZXIucHV0KGRhdGEuZ2V0TGVuZ3RoKCksIFFSVXRpbC5nZXRMZW5ndGhJbkJpdHMoZGF0YS5nZXRNb2RlKCksIHR5cGVOdW1iZXIpICk7XG4gICAgICBkYXRhLndyaXRlKGJ1ZmZlcik7XG4gICAgfVxuXG4gICAgLy8gY2FsYyBudW0gbWF4IGRhdGEuXG4gICAgbGV0IHRvdGFsRGF0YUNvdW50ID0gMDtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJzQmxvY2tzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICB0b3RhbERhdGFDb3VudCArPSByc0Jsb2Nrc1tpXS5kYXRhQ291bnQ7XG4gICAgfVxuXG4gICAgaWYgKGJ1ZmZlci5nZXRMZW5ndGhJbkJpdHMoKSA+IHRvdGFsRGF0YUNvdW50ICogOCkge1xuICAgICAgdGhyb3cgJ2NvZGUgbGVuZ3RoIG92ZXJmbG93LiAoJ1xuICAgICAgICArIGJ1ZmZlci5nZXRMZW5ndGhJbkJpdHMoKVxuICAgICAgICArICc+J1xuICAgICAgICArIHRvdGFsRGF0YUNvdW50ICogOFxuICAgICAgICArICcpJztcbiAgICB9XG5cbiAgICAvLyBlbmQgY29kZVxuICAgIGlmIChidWZmZXIuZ2V0TGVuZ3RoSW5CaXRzKCkgKyA0IDw9IHRvdGFsRGF0YUNvdW50ICogOCkge1xuICAgICAgYnVmZmVyLnB1dCgwLCA0KTtcbiAgICB9XG5cbiAgICAvLyBwYWRkaW5nXG4gICAgd2hpbGUgKGJ1ZmZlci5nZXRMZW5ndGhJbkJpdHMoKSAlIDggIT0gMCkge1xuICAgICAgYnVmZmVyLnB1dEJpdChmYWxzZSk7XG4gICAgfVxuXG4gICAgLy8gcGFkZGluZ1xuICAgIHdoaWxlICh0cnVlKSB7XG5cbiAgICAgIGlmIChidWZmZXIuZ2V0TGVuZ3RoSW5CaXRzKCkgPj0gdG90YWxEYXRhQ291bnQgKiA4KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgYnVmZmVyLnB1dChQQUQwLCA4KTtcblxuICAgICAgaWYgKGJ1ZmZlci5nZXRMZW5ndGhJbkJpdHMoKSA+PSB0b3RhbERhdGFDb3VudCAqIDgpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBidWZmZXIucHV0KFBBRDEsIDgpO1xuICAgIH1cblxuICAgIHJldHVybiBjcmVhdGVCeXRlcyhidWZmZXIsIHJzQmxvY2tzKTtcbiAgfTtcblxuICBfdGhpcy5hZGREYXRhID0gZnVuY3Rpb24oZGF0YSwgbW9kZSkge1xuXG4gICAgbW9kZSA9IG1vZGUgfHwgJ0J5dGUnO1xuXG4gICAgbGV0IG5ld0RhdGEgPSBudWxsO1xuXG4gICAgc3dpdGNoKG1vZGUpIHtcbiAgICBjYXNlICdOdW1lcmljJyA6XG4gICAgICBuZXdEYXRhID0gcXJOdW1iZXIoZGF0YSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdBbHBoYW51bWVyaWMnIDpcbiAgICAgIG5ld0RhdGEgPSBxckFscGhhTnVtKGRhdGEpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnQnl0ZScgOlxuICAgICAgbmV3RGF0YSA9IHFyOEJpdEJ5dGUoZGF0YSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdLYW5qaScgOlxuICAgICAgbmV3RGF0YSA9IHFyS2FuamkoZGF0YSk7XG4gICAgICBicmVhaztcbiAgICBkZWZhdWx0IDpcbiAgICAgIHRocm93ICdtb2RlOicgKyBtb2RlO1xuICAgIH1cblxuICAgIF9kYXRhTGlzdC5wdXNoKG5ld0RhdGEpO1xuICAgIF9kYXRhQ2FjaGUgPSBudWxsO1xuICB9O1xuXG4gIF90aGlzLmlzRGFyayA9IGZ1bmN0aW9uKHJvdywgY29sKSB7XG4gICAgaWYgKHJvdyA8IDAgfHwgX21vZHVsZUNvdW50IDw9IHJvdyB8fCBjb2wgPCAwIHx8IF9tb2R1bGVDb3VudCA8PSBjb2wpIHtcbiAgICAgIHRocm93IHJvdyArICcsJyArIGNvbDtcbiAgICB9XG4gICAgcmV0dXJuIF9tb2R1bGVzW3Jvd11bY29sXTtcbiAgfTtcblxuICBfdGhpcy5nZXRNb2R1bGVDb3VudCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBfbW9kdWxlQ291bnQ7XG4gIH07XG5cbiAgX3RoaXMubWFrZSA9IGZ1bmN0aW9uKCkge1xuICAgIGlmIChfdHlwZU51bWJlciA8IDEpIHtcbiAgICAgIGxldCB0eXBlTnVtYmVyID0gMTtcblxuICAgICAgZm9yICg7IHR5cGVOdW1iZXIgPCA0MDsgdHlwZU51bWJlcisrKSB7XG4gICAgICAgIGNvbnN0IHJzQmxvY2tzID0gUVJSU0Jsb2NrLmdldFJTQmxvY2tzKHR5cGVOdW1iZXIsIF9lcnJvckNvcnJlY3Rpb25MZXZlbCk7XG4gICAgICAgIGNvbnN0IGJ1ZmZlciA9IHFyQml0QnVmZmVyKCk7XG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBfZGF0YUxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBjb25zdCBkYXRhID0gX2RhdGFMaXN0W2ldO1xuICAgICAgICAgIGJ1ZmZlci5wdXQoZGF0YS5nZXRNb2RlKCksIDQpO1xuICAgICAgICAgIGJ1ZmZlci5wdXQoZGF0YS5nZXRMZW5ndGgoKSwgUVJVdGlsLmdldExlbmd0aEluQml0cyhkYXRhLmdldE1vZGUoKSwgdHlwZU51bWJlcikgKTtcbiAgICAgICAgICBkYXRhLndyaXRlKGJ1ZmZlcik7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgdG90YWxEYXRhQ291bnQgPSAwO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHJzQmxvY2tzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgdG90YWxEYXRhQ291bnQgKz0gcnNCbG9ja3NbaV0uZGF0YUNvdW50O1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGJ1ZmZlci5nZXRMZW5ndGhJbkJpdHMoKSA8PSB0b3RhbERhdGFDb3VudCAqIDgpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBfdHlwZU51bWJlciA9IHR5cGVOdW1iZXI7XG4gICAgfVxuXG4gICAgbWFrZUltcGwoZmFsc2UsIGdldEJlc3RNYXNrUGF0dGVybigpICk7XG4gIH07XG5cbiAgX3RoaXMuY3JlYXRlVGFibGVUYWcgPSBmdW5jdGlvbihjZWxsU2l6ZSwgbWFyZ2luKSB7XG5cbiAgICBjZWxsU2l6ZSA9IGNlbGxTaXplIHx8IDI7XG4gICAgbWFyZ2luID0gKHR5cGVvZiBtYXJnaW4gPT0gJ3VuZGVmaW5lZCcpPyBjZWxsU2l6ZSAqIDQgOiBtYXJnaW47XG5cbiAgICBsZXQgcXJIdG1sID0gJyc7XG5cbiAgICBxckh0bWwgKz0gJzx0YWJsZSBzdHlsZT1cIic7XG4gICAgcXJIdG1sICs9ICcgYm9yZGVyLXdpZHRoOiAwcHg7IGJvcmRlci1zdHlsZTogbm9uZTsnO1xuICAgIHFySHRtbCArPSAnIGJvcmRlci1jb2xsYXBzZTogY29sbGFwc2U7JztcbiAgICBxckh0bWwgKz0gJyBwYWRkaW5nOiAwcHg7IG1hcmdpbjogJyArIG1hcmdpbiArICdweDsnO1xuICAgIHFySHRtbCArPSAnXCI+JztcbiAgICBxckh0bWwgKz0gJzx0Ym9keT4nO1xuXG4gICAgZm9yIChsZXQgciA9IDA7IHIgPCBfdGhpcy5nZXRNb2R1bGVDb3VudCgpOyByICs9IDEpIHtcblxuICAgICAgcXJIdG1sICs9ICc8dHI+JztcblxuICAgICAgZm9yIChsZXQgYyA9IDA7IGMgPCBfdGhpcy5nZXRNb2R1bGVDb3VudCgpOyBjICs9IDEpIHtcbiAgICAgICAgcXJIdG1sICs9ICc8dGQgc3R5bGU9XCInO1xuICAgICAgICBxckh0bWwgKz0gJyBib3JkZXItd2lkdGg6IDBweDsgYm9yZGVyLXN0eWxlOiBub25lOyc7XG4gICAgICAgIHFySHRtbCArPSAnIGJvcmRlci1jb2xsYXBzZTogY29sbGFwc2U7JztcbiAgICAgICAgcXJIdG1sICs9ICcgcGFkZGluZzogMHB4OyBtYXJnaW46IDBweDsnO1xuICAgICAgICBxckh0bWwgKz0gJyB3aWR0aDogJyArIGNlbGxTaXplICsgJ3B4Oyc7XG4gICAgICAgIHFySHRtbCArPSAnIGhlaWdodDogJyArIGNlbGxTaXplICsgJ3B4Oyc7XG4gICAgICAgIHFySHRtbCArPSAnIGJhY2tncm91bmQtY29sb3I6ICc7XG4gICAgICAgIHFySHRtbCArPSBfdGhpcy5pc0RhcmsociwgYyk/ICcjMDAwMDAwJyA6ICcjZmZmZmZmJztcbiAgICAgICAgcXJIdG1sICs9ICc7JztcbiAgICAgICAgcXJIdG1sICs9ICdcIi8+JztcbiAgICAgIH1cblxuICAgICAgcXJIdG1sICs9ICc8L3RyPic7XG4gICAgfVxuXG4gICAgcXJIdG1sICs9ICc8L3Rib2R5Pic7XG4gICAgcXJIdG1sICs9ICc8L3RhYmxlPic7XG5cbiAgICByZXR1cm4gcXJIdG1sO1xuICB9O1xuXG4gIF90aGlzLmNyZWF0ZVN2Z1RhZyA9IGZ1bmN0aW9uKGNlbGxTaXplLCBtYXJnaW4sIGFsdCwgdGl0bGUpIHtcblxuICAgIGxldCBvcHRzID0ge307XG4gICAgaWYgKHR5cGVvZiBhcmd1bWVudHNbMF0gPT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIENhbGxlZCBieSBvcHRpb25zLlxuICAgICAgb3B0cyA9IGFyZ3VtZW50c1swXTtcbiAgICAgIC8vIG92ZXJ3cml0ZSBjZWxsU2l6ZSBhbmQgbWFyZ2luLlxuICAgICAgY2VsbFNpemUgPSBvcHRzLmNlbGxTaXplO1xuICAgICAgbWFyZ2luID0gb3B0cy5tYXJnaW47XG4gICAgICBhbHQgPSBvcHRzLmFsdDtcbiAgICAgIHRpdGxlID0gb3B0cy50aXRsZTtcbiAgICB9XG5cbiAgICBjZWxsU2l6ZSA9IGNlbGxTaXplIHx8IDI7XG4gICAgbWFyZ2luID0gKHR5cGVvZiBtYXJnaW4gPT0gJ3VuZGVmaW5lZCcpPyBjZWxsU2l6ZSAqIDQgOiBtYXJnaW47XG5cbiAgICAvLyBDb21wb3NlIGFsdCBwcm9wZXJ0eSBzdXJyb2dhdGVcbiAgICBhbHQgPSAodHlwZW9mIGFsdCA9PT0gJ3N0cmluZycpID8ge3RleHQ6IGFsdH0gOiBhbHQgfHwge307XG4gICAgYWx0LnRleHQgPSBhbHQudGV4dCB8fCBudWxsO1xuICAgIGFsdC5pZCA9IChhbHQudGV4dCkgPyBhbHQuaWQgfHwgJ3FyY29kZS1kZXNjcmlwdGlvbicgOiBudWxsO1xuXG4gICAgLy8gQ29tcG9zZSB0aXRsZSBwcm9wZXJ0eSBzdXJyb2dhdGVcbiAgICB0aXRsZSA9ICh0eXBlb2YgdGl0bGUgPT09ICdzdHJpbmcnKSA/IHt0ZXh0OiB0aXRsZX0gOiB0aXRsZSB8fCB7fTtcbiAgICB0aXRsZS50ZXh0ID0gdGl0bGUudGV4dCB8fCBudWxsO1xuICAgIHRpdGxlLmlkID0gKHRpdGxlLnRleHQpID8gdGl0bGUuaWQgfHwgJ3FyY29kZS10aXRsZScgOiBudWxsO1xuXG4gICAgY29uc3Qgc2l6ZSA9IF90aGlzLmdldE1vZHVsZUNvdW50KCkgKiBjZWxsU2l6ZSArIG1hcmdpbiAqIDI7XG4gICAgbGV0IGMsIG1jLCByLCBtciwgcXJTdmc9JycsIHJlY3Q7XG5cbiAgICByZWN0ID0gJ2wnICsgY2VsbFNpemUgKyAnLDAgMCwnICsgY2VsbFNpemUgK1xuICAgICAgJyAtJyArIGNlbGxTaXplICsgJywwIDAsLScgKyBjZWxsU2l6ZSArICd6ICc7XG5cbiAgICBxclN2ZyArPSAnPHN2ZyB2ZXJzaW9uPVwiMS4xXCIgeG1sbnM9XCJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Z1wiJztcbiAgICBxclN2ZyArPSAhb3B0cy5zY2FsYWJsZSA/ICcgd2lkdGg9XCInICsgc2l6ZSArICdweFwiIGhlaWdodD1cIicgKyBzaXplICsgJ3B4XCInIDogJyc7XG4gICAgcXJTdmcgKz0gJyB2aWV3Qm94PVwiMCAwICcgKyBzaXplICsgJyAnICsgc2l6ZSArICdcIiAnO1xuICAgIHFyU3ZnICs9ICcgcHJlc2VydmVBc3BlY3RSYXRpbz1cInhNaW5ZTWluIG1lZXRcIic7XG4gICAgcXJTdmcgKz0gKHRpdGxlLnRleHQgfHwgYWx0LnRleHQpID8gJyByb2xlPVwiaW1nXCIgYXJpYS1sYWJlbGxlZGJ5PVwiJyArXG4gICAgICAgIGVzY2FwZVhtbChbdGl0bGUuaWQsIGFsdC5pZF0uam9pbignICcpLnRyaW0oKSApICsgJ1wiJyA6ICcnO1xuICAgIHFyU3ZnICs9ICc+JztcbiAgICBxclN2ZyArPSAodGl0bGUudGV4dCkgPyAnPHRpdGxlIGlkPVwiJyArIGVzY2FwZVhtbCh0aXRsZS5pZCkgKyAnXCI+JyArXG4gICAgICAgIGVzY2FwZVhtbCh0aXRsZS50ZXh0KSArICc8L3RpdGxlPicgOiAnJztcbiAgICBxclN2ZyArPSAoYWx0LnRleHQpID8gJzxkZXNjcmlwdGlvbiBpZD1cIicgKyBlc2NhcGVYbWwoYWx0LmlkKSArICdcIj4nICtcbiAgICAgICAgZXNjYXBlWG1sKGFsdC50ZXh0KSArICc8L2Rlc2NyaXB0aW9uPicgOiAnJztcbiAgICBxclN2ZyArPSAnPHJlY3Qgd2lkdGg9XCIxMDAlXCIgaGVpZ2h0PVwiMTAwJVwiIGZpbGw9XCJ3aGl0ZVwiIGN4PVwiMFwiIGN5PVwiMFwiLz4nO1xuICAgIHFyU3ZnICs9ICc8cGF0aCBkPVwiJztcblxuICAgIGZvciAociA9IDA7IHIgPCBfdGhpcy5nZXRNb2R1bGVDb3VudCgpOyByICs9IDEpIHtcbiAgICAgIG1yID0gciAqIGNlbGxTaXplICsgbWFyZ2luO1xuICAgICAgZm9yIChjID0gMDsgYyA8IF90aGlzLmdldE1vZHVsZUNvdW50KCk7IGMgKz0gMSkge1xuICAgICAgICBpZiAoX3RoaXMuaXNEYXJrKHIsIGMpICkge1xuICAgICAgICAgIG1jID0gYypjZWxsU2l6ZSttYXJnaW47XG4gICAgICAgICAgcXJTdmcgKz0gJ00nICsgbWMgKyAnLCcgKyBtciArIHJlY3Q7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBxclN2ZyArPSAnXCIgc3Ryb2tlPVwidHJhbnNwYXJlbnRcIiBmaWxsPVwiYmxhY2tcIi8+JztcbiAgICBxclN2ZyArPSAnPC9zdmc+JztcblxuICAgIHJldHVybiBxclN2ZztcbiAgfTtcblxuICBfdGhpcy5jcmVhdGVEYXRhVVJMID0gZnVuY3Rpb24oY2VsbFNpemUsIG1hcmdpbikge1xuXG4gICAgY2VsbFNpemUgPSBjZWxsU2l6ZSB8fCAyO1xuICAgIG1hcmdpbiA9ICh0eXBlb2YgbWFyZ2luID09ICd1bmRlZmluZWQnKT8gY2VsbFNpemUgKiA0IDogbWFyZ2luO1xuXG4gICAgY29uc3Qgc2l6ZSA9IF90aGlzLmdldE1vZHVsZUNvdW50KCkgKiBjZWxsU2l6ZSArIG1hcmdpbiAqIDI7XG4gICAgY29uc3QgbWluID0gbWFyZ2luO1xuICAgIGNvbnN0IG1heCA9IHNpemUgLSBtYXJnaW47XG5cbiAgICByZXR1cm4gY3JlYXRlRGF0YVVSTChzaXplLCBzaXplLCBmdW5jdGlvbih4LCB5KSB7XG4gICAgICBpZiAobWluIDw9IHggJiYgeCA8IG1heCAmJiBtaW4gPD0geSAmJiB5IDwgbWF4KSB7XG4gICAgICAgIGNvbnN0IGMgPSBNYXRoLmZsb29yKCAoeCAtIG1pbikgLyBjZWxsU2l6ZSk7XG4gICAgICAgIGNvbnN0IHIgPSBNYXRoLmZsb29yKCAoeSAtIG1pbikgLyBjZWxsU2l6ZSk7XG4gICAgICAgIHJldHVybiBfdGhpcy5pc0RhcmsociwgYyk/IDAgOiAxO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIDE7XG4gICAgICB9XG4gICAgfSApO1xuICB9O1xuXG4gIF90aGlzLmNyZWF0ZUltZ1RhZyA9IGZ1bmN0aW9uKGNlbGxTaXplLCBtYXJnaW4sIGFsdCkge1xuXG4gICAgY2VsbFNpemUgPSBjZWxsU2l6ZSB8fCAyO1xuICAgIG1hcmdpbiA9ICh0eXBlb2YgbWFyZ2luID09ICd1bmRlZmluZWQnKT8gY2VsbFNpemUgKiA0IDogbWFyZ2luO1xuXG4gICAgY29uc3Qgc2l6ZSA9IF90aGlzLmdldE1vZHVsZUNvdW50KCkgKiBjZWxsU2l6ZSArIG1hcmdpbiAqIDI7XG5cbiAgICBsZXQgaW1nID0gJyc7XG4gICAgaW1nICs9ICc8aW1nJztcbiAgICBpbWcgKz0gJ1xcdTAwMjBzcmM9XCInO1xuICAgIGltZyArPSBfdGhpcy5jcmVhdGVEYXRhVVJMKGNlbGxTaXplLCBtYXJnaW4pO1xuICAgIGltZyArPSAnXCInO1xuICAgIGltZyArPSAnXFx1MDAyMHdpZHRoPVwiJztcbiAgICBpbWcgKz0gc2l6ZTtcbiAgICBpbWcgKz0gJ1wiJztcbiAgICBpbWcgKz0gJ1xcdTAwMjBoZWlnaHQ9XCInO1xuICAgIGltZyArPSBzaXplO1xuICAgIGltZyArPSAnXCInO1xuICAgIGlmIChhbHQpIHtcbiAgICAgIGltZyArPSAnXFx1MDAyMGFsdD1cIic7XG4gICAgICBpbWcgKz0gZXNjYXBlWG1sKGFsdCk7XG4gICAgICBpbWcgKz0gJ1wiJztcbiAgICB9XG4gICAgaW1nICs9ICcvPic7XG5cbiAgICByZXR1cm4gaW1nO1xuICB9O1xuXG4gIGNvbnN0IGVzY2FwZVhtbCA9IGZ1bmN0aW9uKHMpIHtcbiAgICBsZXQgZXNjYXBlZCA9ICcnO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3QgYyA9IHMuY2hhckF0KGkpO1xuICAgICAgc3dpdGNoKGMpIHtcbiAgICAgIGNhc2UgJzwnOiBlc2NhcGVkICs9ICcmbHQ7JzsgYnJlYWs7XG4gICAgICBjYXNlICc+JzogZXNjYXBlZCArPSAnJmd0Oyc7IGJyZWFrO1xuICAgICAgY2FzZSAnJic6IGVzY2FwZWQgKz0gJyZhbXA7JzsgYnJlYWs7XG4gICAgICBjYXNlICdcIic6IGVzY2FwZWQgKz0gJyZxdW90Oyc7IGJyZWFrO1xuICAgICAgZGVmYXVsdCA6IGVzY2FwZWQgKz0gYzsgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBlc2NhcGVkO1xuICB9O1xuXG4gIGNvbnN0IF9jcmVhdGVIYWxmQVNDSUkgPSBmdW5jdGlvbihtYXJnaW4pIHtcbiAgICBjb25zdCBjZWxsU2l6ZSA9IDE7XG4gICAgbWFyZ2luID0gKHR5cGVvZiBtYXJnaW4gPT0gJ3VuZGVmaW5lZCcpPyBjZWxsU2l6ZSAqIDIgOiBtYXJnaW47XG5cbiAgICBjb25zdCBzaXplID0gX3RoaXMuZ2V0TW9kdWxlQ291bnQoKSAqIGNlbGxTaXplICsgbWFyZ2luICogMjtcbiAgICBjb25zdCBtaW4gPSBtYXJnaW47XG4gICAgY29uc3QgbWF4ID0gc2l6ZSAtIG1hcmdpbjtcblxuICAgIGxldCB5LCB4LCByMSwgcjIsIHA7XG5cbiAgICBjb25zdCBibG9ja3MgPSB7XG4gICAgICAnXHUyNTg4XHUyNTg4JzogJ1x1MjU4OCcsXG4gICAgICAnXHUyNTg4ICc6ICdcdTI1ODAnLFxuICAgICAgJyBcdTI1ODgnOiAnXHUyNTg0JyxcbiAgICAgICcgICc6ICcgJ1xuICAgIH07XG5cbiAgICBjb25zdCBibG9ja3NMYXN0TGluZU5vTWFyZ2luID0ge1xuICAgICAgJ1x1MjU4OFx1MjU4OCc6ICdcdTI1ODAnLFxuICAgICAgJ1x1MjU4OCAnOiAnXHUyNTgwJyxcbiAgICAgICcgXHUyNTg4JzogJyAnLFxuICAgICAgJyAgJzogJyAnXG4gICAgfTtcblxuICAgIGxldCBhc2NpaSA9ICcnO1xuICAgIGZvciAoeSA9IDA7IHkgPCBzaXplOyB5ICs9IDIpIHtcbiAgICAgIHIxID0gTWF0aC5mbG9vcigoeSAtIG1pbikgLyBjZWxsU2l6ZSk7XG4gICAgICByMiA9IE1hdGguZmxvb3IoKHkgKyAxIC0gbWluKSAvIGNlbGxTaXplKTtcbiAgICAgIGZvciAoeCA9IDA7IHggPCBzaXplOyB4ICs9IDEpIHtcbiAgICAgICAgcCA9ICdcdTI1ODgnO1xuXG4gICAgICAgIGlmIChtaW4gPD0geCAmJiB4IDwgbWF4ICYmIG1pbiA8PSB5ICYmIHkgPCBtYXggJiYgX3RoaXMuaXNEYXJrKHIxLCBNYXRoLmZsb29yKCh4IC0gbWluKSAvIGNlbGxTaXplKSkpIHtcbiAgICAgICAgICBwID0gJyAnO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1pbiA8PSB4ICYmIHggPCBtYXggJiYgbWluIDw9IHkrMSAmJiB5KzEgPCBtYXggJiYgX3RoaXMuaXNEYXJrKHIyLCBNYXRoLmZsb29yKCh4IC0gbWluKSAvIGNlbGxTaXplKSkpIHtcbiAgICAgICAgICBwICs9ICcgJztcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBwICs9ICdcdTI1ODgnO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gT3V0cHV0IDIgY2hhcmFjdGVycyBwZXIgcGl4ZWwsIHRvIGNyZWF0ZSBmdWxsIHNxdWFyZS4gMSBjaGFyYWN0ZXIgcGVyIHBpeGVscyBnaXZlcyBvbmx5IGhhbGYgd2lkdGggb2Ygc3F1YXJlLlxuICAgICAgICBhc2NpaSArPSAobWFyZ2luIDwgMSAmJiB5KzEgPj0gbWF4KSA/IGJsb2Nrc0xhc3RMaW5lTm9NYXJnaW5bcF0gOiBibG9ja3NbcF07XG4gICAgICB9XG5cbiAgICAgIGFzY2lpICs9ICdcXG4nO1xuICAgIH1cblxuICAgIGlmIChzaXplICUgMiAmJiBtYXJnaW4gPiAwKSB7XG4gICAgICByZXR1cm4gYXNjaWkuc3Vic3RyaW5nKDAsIGFzY2lpLmxlbmd0aCAtIHNpemUgLSAxKSArIEFycmF5KHNpemUrMSkuam9pbignXHUyNTgwJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFzY2lpLnN1YnN0cmluZygwLCBhc2NpaS5sZW5ndGgtMSk7XG4gIH07XG5cbiAgX3RoaXMuY3JlYXRlQVNDSUkgPSBmdW5jdGlvbihjZWxsU2l6ZSwgbWFyZ2luKSB7XG4gICAgY2VsbFNpemUgPSBjZWxsU2l6ZSB8fCAxO1xuXG4gICAgaWYgKGNlbGxTaXplIDwgMikge1xuICAgICAgcmV0dXJuIF9jcmVhdGVIYWxmQVNDSUkobWFyZ2luKTtcbiAgICB9XG5cbiAgICBjZWxsU2l6ZSAtPSAxO1xuICAgIG1hcmdpbiA9ICh0eXBlb2YgbWFyZ2luID09ICd1bmRlZmluZWQnKT8gY2VsbFNpemUgKiAyIDogbWFyZ2luO1xuXG4gICAgY29uc3Qgc2l6ZSA9IF90aGlzLmdldE1vZHVsZUNvdW50KCkgKiBjZWxsU2l6ZSArIG1hcmdpbiAqIDI7XG4gICAgY29uc3QgbWluID0gbWFyZ2luO1xuICAgIGNvbnN0IG1heCA9IHNpemUgLSBtYXJnaW47XG5cbiAgICBsZXQgeSwgeCwgciwgcDtcblxuICAgIGNvbnN0IHdoaXRlID0gQXJyYXkoY2VsbFNpemUrMSkuam9pbignXHUyNTg4XHUyNTg4Jyk7XG4gICAgY29uc3QgYmxhY2sgPSBBcnJheShjZWxsU2l6ZSsxKS5qb2luKCcgICcpO1xuXG4gICAgbGV0IGFzY2lpID0gJyc7XG4gICAgbGV0IGxpbmUgPSAnJztcbiAgICBmb3IgKHkgPSAwOyB5IDwgc2l6ZTsgeSArPSAxKSB7XG4gICAgICByID0gTWF0aC5mbG9vciggKHkgLSBtaW4pIC8gY2VsbFNpemUpO1xuICAgICAgbGluZSA9ICcnO1xuICAgICAgZm9yICh4ID0gMDsgeCA8IHNpemU7IHggKz0gMSkge1xuICAgICAgICBwID0gMTtcblxuICAgICAgICBpZiAobWluIDw9IHggJiYgeCA8IG1heCAmJiBtaW4gPD0geSAmJiB5IDwgbWF4ICYmIF90aGlzLmlzRGFyayhyLCBNYXRoLmZsb29yKCh4IC0gbWluKSAvIGNlbGxTaXplKSkpIHtcbiAgICAgICAgICBwID0gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE91dHB1dCAyIGNoYXJhY3RlcnMgcGVyIHBpeGVsLCB0byBjcmVhdGUgZnVsbCBzcXVhcmUuIDEgY2hhcmFjdGVyIHBlciBwaXhlbHMgZ2l2ZXMgb25seSBoYWxmIHdpZHRoIG9mIHNxdWFyZS5cbiAgICAgICAgbGluZSArPSBwID8gd2hpdGUgOiBibGFjaztcbiAgICAgIH1cblxuICAgICAgZm9yIChyID0gMDsgciA8IGNlbGxTaXplOyByICs9IDEpIHtcbiAgICAgICAgYXNjaWkgKz0gbGluZSArICdcXG4nO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBhc2NpaS5zdWJzdHJpbmcoMCwgYXNjaWkubGVuZ3RoLTEpO1xuICB9O1xuXG4gIF90aGlzLnJlbmRlclRvMmRDb250ZXh0ID0gZnVuY3Rpb24oY29udGV4dCwgY2VsbFNpemUpIHtcbiAgICBjZWxsU2l6ZSA9IGNlbGxTaXplIHx8IDI7XG4gICAgY29uc3QgbGVuZ3RoID0gX3RoaXMuZ2V0TW9kdWxlQ291bnQoKTtcbiAgICBmb3IgKGxldCByb3cgPSAwOyByb3cgPCBsZW5ndGg7IHJvdysrKSB7XG4gICAgICBmb3IgKGxldCBjb2wgPSAwOyBjb2wgPCBsZW5ndGg7IGNvbCsrKSB7XG4gICAgICAgIGNvbnRleHQuZmlsbFN0eWxlID0gX3RoaXMuaXNEYXJrKHJvdywgY29sKSA/ICdibGFjaycgOiAnd2hpdGUnO1xuICAgICAgICBjb250ZXh0LmZpbGxSZWN0KGNvbCAqIGNlbGxTaXplLCByb3cgKiBjZWxsU2l6ZSwgY2VsbFNpemUsIGNlbGxTaXplKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gX3RoaXM7XG59O1xuXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gcXJjb2RlLnN0cmluZ1RvQnl0ZXNcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnFyY29kZS5zdHJpbmdUb0J5dGVzID0gZnVuY3Rpb24ocykge1xuICBjb25zdCBieXRlcyA9IFtdO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IHMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICBjb25zdCBjID0gcy5jaGFyQ29kZUF0KGkpO1xuICAgIGJ5dGVzLnB1c2goYyAmIDB4ZmYpO1xuICB9XG4gIHJldHVybiBieXRlcztcbn07XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBxcmNvZGUuY3JlYXRlU3RyaW5nVG9CeXRlc1xuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBAcGFyYW0gdW5pY29kZURhdGEgYmFzZTY0IHN0cmluZyBvZiBieXRlIGFycmF5LlxuICogWzE2Yml0IFVuaWNvZGVdLFsxNmJpdCBCeXRlc10sIC4uLlxuICogQHBhcmFtIG51bUNoYXJzXG4gKi9cbnFyY29kZS5jcmVhdGVTdHJpbmdUb0J5dGVzID0gZnVuY3Rpb24odW5pY29kZURhdGEsIG51bUNoYXJzKSB7XG5cbiAgLy8gY3JlYXRlIGNvbnZlcnNpb24gbWFwLlxuXG4gIGNvbnN0IHVuaWNvZGVNYXAgPSBmdW5jdGlvbigpIHtcblxuICAgIGNvbnN0IGJpbiA9IGJhc2U2NERlY29kZUlucHV0U3RyZWFtKHVuaWNvZGVEYXRhKTtcbiAgICBjb25zdCByZWFkID0gZnVuY3Rpb24oKSB7XG4gICAgICBjb25zdCBiID0gYmluLnJlYWQoKTtcbiAgICAgIGlmIChiID09IC0xKSB0aHJvdyAnZW9mJztcbiAgICAgIHJldHVybiBiO1xuICAgIH07XG5cbiAgICBsZXQgY291bnQgPSAwO1xuICAgIGNvbnN0IHVuaWNvZGVNYXAgPSB7fTtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgYjAgPSBiaW4ucmVhZCgpO1xuICAgICAgaWYgKGIwID09IC0xKSBicmVhaztcbiAgICAgIGNvbnN0IGIxID0gcmVhZCgpO1xuICAgICAgY29uc3QgYjIgPSByZWFkKCk7XG4gICAgICBjb25zdCBiMyA9IHJlYWQoKTtcbiAgICAgIGNvbnN0IGsgPSBTdHJpbmcuZnJvbUNoYXJDb2RlKCAoYjAgPDwgOCkgfCBiMSk7XG4gICAgICBjb25zdCB2ID0gKGIyIDw8IDgpIHwgYjM7XG4gICAgICB1bmljb2RlTWFwW2tdID0gdjtcbiAgICAgIGNvdW50ICs9IDE7XG4gICAgfVxuICAgIGlmIChjb3VudCAhPSBudW1DaGFycykge1xuICAgICAgdGhyb3cgY291bnQgKyAnICE9ICcgKyBudW1DaGFycztcbiAgICB9XG5cbiAgICByZXR1cm4gdW5pY29kZU1hcDtcbiAgfSgpO1xuXG4gIGNvbnN0IHVua25vd25DaGFyID0gJz8nLmNoYXJDb2RlQXQoMCk7XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKHMpIHtcbiAgICBjb25zdCBieXRlcyA9IFtdO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3QgYyA9IHMuY2hhckNvZGVBdChpKTtcbiAgICAgIGlmIChjIDwgMTI4KSB7XG4gICAgICAgIGJ5dGVzLnB1c2goYyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBiID0gdW5pY29kZU1hcFtzLmNoYXJBdChpKV07XG4gICAgICAgIGlmICh0eXBlb2YgYiA9PSAnbnVtYmVyJykge1xuICAgICAgICAgIGlmICggKGIgJiAweGZmKSA9PSBiKSB7XG4gICAgICAgICAgICAvLyAxYnl0ZVxuICAgICAgICAgICAgYnl0ZXMucHVzaChiKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gMmJ5dGVzXG4gICAgICAgICAgICBieXRlcy5wdXNoKGIgPj4+IDgpO1xuICAgICAgICAgICAgYnl0ZXMucHVzaChiICYgMHhmZik7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJ5dGVzLnB1c2godW5rbm93bkNoYXIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBieXRlcztcbiAgfTtcbn07XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRUk1vZGVcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFFSTW9kZSA9IHtcbiAgTU9ERV9OVU1CRVIgOiAgICAxIDw8IDAsXG4gIE1PREVfQUxQSEFfTlVNIDogMSA8PCAxLFxuICBNT0RFXzhCSVRfQllURSA6IDEgPDwgMixcbiAgTU9ERV9LQU5KSSA6ICAgICAxIDw8IDNcbn07XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRUkVycm9yQ29ycmVjdGlvbkxldmVsXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBRUkVycm9yQ29ycmVjdGlvbkxldmVsID0ge1xuICBMIDogMSxcbiAgTSA6IDAsXG4gIFEgOiAzLFxuICBIIDogMlxufTtcblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFFSTWFza1BhdHRlcm5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFFSTWFza1BhdHRlcm4gPSB7XG4gIFBBVFRFUk4wMDAgOiAwLFxuICBQQVRURVJOMDAxIDogMSxcbiAgUEFUVEVSTjAxMCA6IDIsXG4gIFBBVFRFUk4wMTEgOiAzLFxuICBQQVRURVJOMTAwIDogNCxcbiAgUEFUVEVSTjEwMSA6IDUsXG4gIFBBVFRFUk4xMTAgOiA2LFxuICBQQVRURVJOMTExIDogN1xufTtcblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFFSVXRpbFxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgUVJVdGlsID0gZnVuY3Rpb24oKSB7XG5cbiAgY29uc3QgUEFUVEVSTl9QT1NJVElPTl9UQUJMRSA9IFtcbiAgICBbXSxcbiAgICBbNiwgMThdLFxuICAgIFs2LCAyMl0sXG4gICAgWzYsIDI2XSxcbiAgICBbNiwgMzBdLFxuICAgIFs2LCAzNF0sXG4gICAgWzYsIDIyLCAzOF0sXG4gICAgWzYsIDI0LCA0Ml0sXG4gICAgWzYsIDI2LCA0Nl0sXG4gICAgWzYsIDI4LCA1MF0sXG4gICAgWzYsIDMwLCA1NF0sXG4gICAgWzYsIDMyLCA1OF0sXG4gICAgWzYsIDM0LCA2Ml0sXG4gICAgWzYsIDI2LCA0NiwgNjZdLFxuICAgIFs2LCAyNiwgNDgsIDcwXSxcbiAgICBbNiwgMjYsIDUwLCA3NF0sXG4gICAgWzYsIDMwLCA1NCwgNzhdLFxuICAgIFs2LCAzMCwgNTYsIDgyXSxcbiAgICBbNiwgMzAsIDU4LCA4Nl0sXG4gICAgWzYsIDM0LCA2MiwgOTBdLFxuICAgIFs2LCAyOCwgNTAsIDcyLCA5NF0sXG4gICAgWzYsIDI2LCA1MCwgNzQsIDk4XSxcbiAgICBbNiwgMzAsIDU0LCA3OCwgMTAyXSxcbiAgICBbNiwgMjgsIDU0LCA4MCwgMTA2XSxcbiAgICBbNiwgMzIsIDU4LCA4NCwgMTEwXSxcbiAgICBbNiwgMzAsIDU4LCA4NiwgMTE0XSxcbiAgICBbNiwgMzQsIDYyLCA5MCwgMTE4XSxcbiAgICBbNiwgMjYsIDUwLCA3NCwgOTgsIDEyMl0sXG4gICAgWzYsIDMwLCA1NCwgNzgsIDEwMiwgMTI2XSxcbiAgICBbNiwgMjYsIDUyLCA3OCwgMTA0LCAxMzBdLFxuICAgIFs2LCAzMCwgNTYsIDgyLCAxMDgsIDEzNF0sXG4gICAgWzYsIDM0LCA2MCwgODYsIDExMiwgMTM4XSxcbiAgICBbNiwgMzAsIDU4LCA4NiwgMTE0LCAxNDJdLFxuICAgIFs2LCAzNCwgNjIsIDkwLCAxMTgsIDE0Nl0sXG4gICAgWzYsIDMwLCA1NCwgNzgsIDEwMiwgMTI2LCAxNTBdLFxuICAgIFs2LCAyNCwgNTAsIDc2LCAxMDIsIDEyOCwgMTU0XSxcbiAgICBbNiwgMjgsIDU0LCA4MCwgMTA2LCAxMzIsIDE1OF0sXG4gICAgWzYsIDMyLCA1OCwgODQsIDExMCwgMTM2LCAxNjJdLFxuICAgIFs2LCAyNiwgNTQsIDgyLCAxMTAsIDEzOCwgMTY2XSxcbiAgICBbNiwgMzAsIDU4LCA4NiwgMTE0LCAxNDIsIDE3MF1cbiAgXTtcbiAgY29uc3QgRzE1ID0gKDEgPDwgMTApIHwgKDEgPDwgOCkgfCAoMSA8PCA1KSB8ICgxIDw8IDQpIHwgKDEgPDwgMikgfCAoMSA8PCAxKSB8ICgxIDw8IDApO1xuICBjb25zdCBHMTggPSAoMSA8PCAxMikgfCAoMSA8PCAxMSkgfCAoMSA8PCAxMCkgfCAoMSA8PCA5KSB8ICgxIDw8IDgpIHwgKDEgPDwgNSkgfCAoMSA8PCAyKSB8ICgxIDw8IDApO1xuICBjb25zdCBHMTVfTUFTSyA9ICgxIDw8IDE0KSB8ICgxIDw8IDEyKSB8ICgxIDw8IDEwKSB8ICgxIDw8IDQpIHwgKDEgPDwgMSk7XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBjb25zdCBnZXRCQ0hEaWdpdCA9IGZ1bmN0aW9uKGRhdGEpIHtcbiAgICBsZXQgZGlnaXQgPSAwO1xuICAgIHdoaWxlIChkYXRhICE9IDApIHtcbiAgICAgIGRpZ2l0ICs9IDE7XG4gICAgICBkYXRhID4+Pj0gMTtcbiAgICB9XG4gICAgcmV0dXJuIGRpZ2l0O1xuICB9O1xuXG4gIF90aGlzLmdldEJDSFR5cGVJbmZvID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIGxldCBkID0gZGF0YSA8PCAxMDtcbiAgICB3aGlsZSAoZ2V0QkNIRGlnaXQoZCkgLSBnZXRCQ0hEaWdpdChHMTUpID49IDApIHtcbiAgICAgIGQgXj0gKEcxNSA8PCAoZ2V0QkNIRGlnaXQoZCkgLSBnZXRCQ0hEaWdpdChHMTUpICkgKTtcbiAgICB9XG4gICAgcmV0dXJuICggKGRhdGEgPDwgMTApIHwgZCkgXiBHMTVfTUFTSztcbiAgfTtcblxuICBfdGhpcy5nZXRCQ0hUeXBlTnVtYmVyID0gZnVuY3Rpb24oZGF0YSkge1xuICAgIGxldCBkID0gZGF0YSA8PCAxMjtcbiAgICB3aGlsZSAoZ2V0QkNIRGlnaXQoZCkgLSBnZXRCQ0hEaWdpdChHMTgpID49IDApIHtcbiAgICAgIGQgXj0gKEcxOCA8PCAoZ2V0QkNIRGlnaXQoZCkgLSBnZXRCQ0hEaWdpdChHMTgpICkgKTtcbiAgICB9XG4gICAgcmV0dXJuIChkYXRhIDw8IDEyKSB8IGQ7XG4gIH07XG5cbiAgX3RoaXMuZ2V0UGF0dGVyblBvc2l0aW9uID0gZnVuY3Rpb24odHlwZU51bWJlcikge1xuICAgIHJldHVybiBQQVRURVJOX1BPU0lUSU9OX1RBQkxFW3R5cGVOdW1iZXIgLSAxXTtcbiAgfTtcblxuICBfdGhpcy5nZXRNYXNrRnVuY3Rpb24gPSBmdW5jdGlvbihtYXNrUGF0dGVybikge1xuXG4gICAgc3dpdGNoIChtYXNrUGF0dGVybikge1xuXG4gICAgY2FzZSBRUk1hc2tQYXR0ZXJuLlBBVFRFUk4wMDAgOlxuICAgICAgcmV0dXJuIGZ1bmN0aW9uKGksIGopIHsgcmV0dXJuIChpICsgaikgJSAyID09IDA7IH07XG4gICAgY2FzZSBRUk1hc2tQYXR0ZXJuLlBBVFRFUk4wMDEgOlxuICAgICAgcmV0dXJuIGZ1bmN0aW9uKGksIGopIHsgcmV0dXJuIGkgJSAyID09IDA7IH07XG4gICAgY2FzZSBRUk1hc2tQYXR0ZXJuLlBBVFRFUk4wMTAgOlxuICAgICAgcmV0dXJuIGZ1bmN0aW9uKGksIGopIHsgcmV0dXJuIGogJSAzID09IDA7IH07XG4gICAgY2FzZSBRUk1hc2tQYXR0ZXJuLlBBVFRFUk4wMTEgOlxuICAgICAgcmV0dXJuIGZ1bmN0aW9uKGksIGopIHsgcmV0dXJuIChpICsgaikgJSAzID09IDA7IH07XG4gICAgY2FzZSBRUk1hc2tQYXR0ZXJuLlBBVFRFUk4xMDAgOlxuICAgICAgcmV0dXJuIGZ1bmN0aW9uKGksIGopIHsgcmV0dXJuIChNYXRoLmZsb29yKGkgLyAyKSArIE1hdGguZmxvb3IoaiAvIDMpICkgJSAyID09IDA7IH07XG4gICAgY2FzZSBRUk1hc2tQYXR0ZXJuLlBBVFRFUk4xMDEgOlxuICAgICAgcmV0dXJuIGZ1bmN0aW9uKGksIGopIHsgcmV0dXJuIChpICogaikgJSAyICsgKGkgKiBqKSAlIDMgPT0gMDsgfTtcbiAgICBjYXNlIFFSTWFza1BhdHRlcm4uUEFUVEVSTjExMCA6XG4gICAgICByZXR1cm4gZnVuY3Rpb24oaSwgaikgeyByZXR1cm4gKCAoaSAqIGopICUgMiArIChpICogaikgJSAzKSAlIDIgPT0gMDsgfTtcbiAgICBjYXNlIFFSTWFza1BhdHRlcm4uUEFUVEVSTjExMSA6XG4gICAgICByZXR1cm4gZnVuY3Rpb24oaSwgaikgeyByZXR1cm4gKCAoaSAqIGopICUgMyArIChpICsgaikgJSAyKSAlIDIgPT0gMDsgfTtcblxuICAgIGRlZmF1bHQgOlxuICAgICAgdGhyb3cgJ2JhZCBtYXNrUGF0dGVybjonICsgbWFza1BhdHRlcm47XG4gICAgfVxuICB9O1xuXG4gIF90aGlzLmdldEVycm9yQ29ycmVjdFBvbHlub21pYWwgPSBmdW5jdGlvbihlcnJvckNvcnJlY3RMZW5ndGgpIHtcbiAgICBsZXQgYSA9IHFyUG9seW5vbWlhbChbMV0sIDApO1xuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZXJyb3JDb3JyZWN0TGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGEgPSBhLm11bHRpcGx5KHFyUG9seW5vbWlhbChbMSwgUVJNYXRoLmdleHAoaSldLCAwKSApO1xuICAgIH1cbiAgICByZXR1cm4gYTtcbiAgfTtcblxuICBfdGhpcy5nZXRMZW5ndGhJbkJpdHMgPSBmdW5jdGlvbihtb2RlLCB0eXBlKSB7XG5cbiAgICBpZiAoMSA8PSB0eXBlICYmIHR5cGUgPCAxMCkge1xuXG4gICAgICAvLyAxIC0gOVxuXG4gICAgICBzd2l0Y2gobW9kZSkge1xuICAgICAgY2FzZSBRUk1vZGUuTU9ERV9OVU1CRVIgICAgOiByZXR1cm4gMTA7XG4gICAgICBjYXNlIFFSTW9kZS5NT0RFX0FMUEhBX05VTSA6IHJldHVybiA5O1xuICAgICAgY2FzZSBRUk1vZGUuTU9ERV84QklUX0JZVEUgOiByZXR1cm4gODtcbiAgICAgIGNhc2UgUVJNb2RlLk1PREVfS0FOSkkgICAgIDogcmV0dXJuIDg7XG4gICAgICBkZWZhdWx0IDpcbiAgICAgICAgdGhyb3cgJ21vZGU6JyArIG1vZGU7XG4gICAgICB9XG5cbiAgICB9IGVsc2UgaWYgKHR5cGUgPCAyNykge1xuXG4gICAgICAvLyAxMCAtIDI2XG5cbiAgICAgIHN3aXRjaChtb2RlKSB7XG4gICAgICBjYXNlIFFSTW9kZS5NT0RFX05VTUJFUiAgICA6IHJldHVybiAxMjtcbiAgICAgIGNhc2UgUVJNb2RlLk1PREVfQUxQSEFfTlVNIDogcmV0dXJuIDExO1xuICAgICAgY2FzZSBRUk1vZGUuTU9ERV84QklUX0JZVEUgOiByZXR1cm4gMTY7XG4gICAgICBjYXNlIFFSTW9kZS5NT0RFX0tBTkpJICAgICA6IHJldHVybiAxMDtcbiAgICAgIGRlZmF1bHQgOlxuICAgICAgICB0aHJvdyAnbW9kZTonICsgbW9kZTtcbiAgICAgIH1cblxuICAgIH0gZWxzZSBpZiAodHlwZSA8IDQxKSB7XG5cbiAgICAgIC8vIDI3IC0gNDBcblxuICAgICAgc3dpdGNoKG1vZGUpIHtcbiAgICAgIGNhc2UgUVJNb2RlLk1PREVfTlVNQkVSICAgIDogcmV0dXJuIDE0O1xuICAgICAgY2FzZSBRUk1vZGUuTU9ERV9BTFBIQV9OVU0gOiByZXR1cm4gMTM7XG4gICAgICBjYXNlIFFSTW9kZS5NT0RFXzhCSVRfQllURSA6IHJldHVybiAxNjtcbiAgICAgIGNhc2UgUVJNb2RlLk1PREVfS0FOSkkgICAgIDogcmV0dXJuIDEyO1xuICAgICAgZGVmYXVsdCA6XG4gICAgICAgIHRocm93ICdtb2RlOicgKyBtb2RlO1xuICAgICAgfVxuXG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93ICd0eXBlOicgKyB0eXBlO1xuICAgIH1cbiAgfTtcblxuICBfdGhpcy5nZXRMb3N0UG9pbnQgPSBmdW5jdGlvbihxcmNvZGUpIHtcblxuICAgIGNvbnN0IG1vZHVsZUNvdW50ID0gcXJjb2RlLmdldE1vZHVsZUNvdW50KCk7XG5cbiAgICBsZXQgbG9zdFBvaW50ID0gMDtcblxuICAgIC8vIExFVkVMMVxuXG4gICAgZm9yIChsZXQgcm93ID0gMDsgcm93IDwgbW9kdWxlQ291bnQ7IHJvdyArPSAxKSB7XG4gICAgICBmb3IgKGxldCBjb2wgPSAwOyBjb2wgPCBtb2R1bGVDb3VudDsgY29sICs9IDEpIHtcblxuICAgICAgICBsZXQgc2FtZUNvdW50ID0gMDtcbiAgICAgICAgY29uc3QgZGFyayA9IHFyY29kZS5pc0Rhcmsocm93LCBjb2wpO1xuXG4gICAgICAgIGZvciAobGV0IHIgPSAtMTsgciA8PSAxOyByICs9IDEpIHtcblxuICAgICAgICAgIGlmIChyb3cgKyByIDwgMCB8fCBtb2R1bGVDb3VudCA8PSByb3cgKyByKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBmb3IgKGxldCBjID0gLTE7IGMgPD0gMTsgYyArPSAxKSB7XG5cbiAgICAgICAgICAgIGlmIChjb2wgKyBjIDwgMCB8fCBtb2R1bGVDb3VudCA8PSBjb2wgKyBjKSB7XG4gICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAociA9PSAwICYmIGMgPT0gMCkge1xuICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGRhcmsgPT0gcXJjb2RlLmlzRGFyayhyb3cgKyByLCBjb2wgKyBjKSApIHtcbiAgICAgICAgICAgICAgc2FtZUNvdW50ICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHNhbWVDb3VudCA+IDUpIHtcbiAgICAgICAgICBsb3N0UG9pbnQgKz0gKDMgKyBzYW1lQ291bnQgLSA1KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBMRVZFTDJcblxuICAgIGZvciAobGV0IHJvdyA9IDA7IHJvdyA8IG1vZHVsZUNvdW50IC0gMTsgcm93ICs9IDEpIHtcbiAgICAgIGZvciAobGV0IGNvbCA9IDA7IGNvbCA8IG1vZHVsZUNvdW50IC0gMTsgY29sICs9IDEpIHtcbiAgICAgICAgbGV0IGNvdW50ID0gMDtcbiAgICAgICAgaWYgKHFyY29kZS5pc0Rhcmsocm93LCBjb2wpICkgY291bnQgKz0gMTtcbiAgICAgICAgaWYgKHFyY29kZS5pc0Rhcmsocm93ICsgMSwgY29sKSApIGNvdW50ICs9IDE7XG4gICAgICAgIGlmIChxcmNvZGUuaXNEYXJrKHJvdywgY29sICsgMSkgKSBjb3VudCArPSAxO1xuICAgICAgICBpZiAocXJjb2RlLmlzRGFyayhyb3cgKyAxLCBjb2wgKyAxKSApIGNvdW50ICs9IDE7XG4gICAgICAgIGlmIChjb3VudCA9PSAwIHx8IGNvdW50ID09IDQpIHtcbiAgICAgICAgICBsb3N0UG9pbnQgKz0gMztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIExFVkVMM1xuXG4gICAgZm9yIChsZXQgcm93ID0gMDsgcm93IDwgbW9kdWxlQ291bnQ7IHJvdyArPSAxKSB7XG4gICAgICBmb3IgKGxldCBjb2wgPSAwOyBjb2wgPCBtb2R1bGVDb3VudCAtIDY7IGNvbCArPSAxKSB7XG4gICAgICAgIGlmIChxcmNvZGUuaXNEYXJrKHJvdywgY29sKVxuICAgICAgICAgICAgJiYgIXFyY29kZS5pc0Rhcmsocm93LCBjb2wgKyAxKVxuICAgICAgICAgICAgJiYgIHFyY29kZS5pc0Rhcmsocm93LCBjb2wgKyAyKVxuICAgICAgICAgICAgJiYgIHFyY29kZS5pc0Rhcmsocm93LCBjb2wgKyAzKVxuICAgICAgICAgICAgJiYgIHFyY29kZS5pc0Rhcmsocm93LCBjb2wgKyA0KVxuICAgICAgICAgICAgJiYgIXFyY29kZS5pc0Rhcmsocm93LCBjb2wgKyA1KVxuICAgICAgICAgICAgJiYgIHFyY29kZS5pc0Rhcmsocm93LCBjb2wgKyA2KSApIHtcbiAgICAgICAgICBsb3N0UG9pbnQgKz0gNDA7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGxldCBjb2wgPSAwOyBjb2wgPCBtb2R1bGVDb3VudDsgY29sICs9IDEpIHtcbiAgICAgIGZvciAobGV0IHJvdyA9IDA7IHJvdyA8IG1vZHVsZUNvdW50IC0gNjsgcm93ICs9IDEpIHtcbiAgICAgICAgaWYgKHFyY29kZS5pc0Rhcmsocm93LCBjb2wpXG4gICAgICAgICAgICAmJiAhcXJjb2RlLmlzRGFyayhyb3cgKyAxLCBjb2wpXG4gICAgICAgICAgICAmJiAgcXJjb2RlLmlzRGFyayhyb3cgKyAyLCBjb2wpXG4gICAgICAgICAgICAmJiAgcXJjb2RlLmlzRGFyayhyb3cgKyAzLCBjb2wpXG4gICAgICAgICAgICAmJiAgcXJjb2RlLmlzRGFyayhyb3cgKyA0LCBjb2wpXG4gICAgICAgICAgICAmJiAhcXJjb2RlLmlzRGFyayhyb3cgKyA1LCBjb2wpXG4gICAgICAgICAgICAmJiAgcXJjb2RlLmlzRGFyayhyb3cgKyA2LCBjb2wpICkge1xuICAgICAgICAgIGxvc3RQb2ludCArPSA0MDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIExFVkVMNFxuXG4gICAgbGV0IGRhcmtDb3VudCA9IDA7XG5cbiAgICBmb3IgKGxldCBjb2wgPSAwOyBjb2wgPCBtb2R1bGVDb3VudDsgY29sICs9IDEpIHtcbiAgICAgIGZvciAobGV0IHJvdyA9IDA7IHJvdyA8IG1vZHVsZUNvdW50OyByb3cgKz0gMSkge1xuICAgICAgICBpZiAocXJjb2RlLmlzRGFyayhyb3csIGNvbCkgKSB7XG4gICAgICAgICAgZGFya0NvdW50ICs9IDE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByYXRpbyA9IE1hdGguYWJzKDEwMCAqIGRhcmtDb3VudCAvIG1vZHVsZUNvdW50IC8gbW9kdWxlQ291bnQgLSA1MCkgLyA1O1xuICAgIGxvc3RQb2ludCArPSByYXRpbyAqIDEwO1xuXG4gICAgcmV0dXJuIGxvc3RQb2ludDtcbiAgfTtcblxuICByZXR1cm4gX3RoaXM7XG59KCk7XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBRUk1hdGhcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IFFSTWF0aCA9IGZ1bmN0aW9uKCkge1xuXG4gIGNvbnN0IEVYUF9UQUJMRSA9IG5ldyBBcnJheSgyNTYpO1xuICBjb25zdCBMT0dfVEFCTEUgPSBuZXcgQXJyYXkoMjU2KTtcblxuICAvLyBpbml0aWFsaXplIHRhYmxlc1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDg7IGkgKz0gMSkge1xuICAgIEVYUF9UQUJMRVtpXSA9IDEgPDwgaTtcbiAgfVxuICBmb3IgKGxldCBpID0gODsgaSA8IDI1NjsgaSArPSAxKSB7XG4gICAgRVhQX1RBQkxFW2ldID0gRVhQX1RBQkxFW2kgLSA0XVxuICAgICAgXiBFWFBfVEFCTEVbaSAtIDVdXG4gICAgICBeIEVYUF9UQUJMRVtpIC0gNl1cbiAgICAgIF4gRVhQX1RBQkxFW2kgLSA4XTtcbiAgfVxuICBmb3IgKGxldCBpID0gMDsgaSA8IDI1NTsgaSArPSAxKSB7XG4gICAgTE9HX1RBQkxFW0VYUF9UQUJMRVtpXSBdID0gaTtcbiAgfVxuXG4gIGNvbnN0IF90aGlzID0ge307XG5cbiAgX3RoaXMuZ2xvZyA9IGZ1bmN0aW9uKG4pIHtcblxuICAgIGlmIChuIDwgMSkge1xuICAgICAgdGhyb3cgJ2dsb2coJyArIG4gKyAnKSc7XG4gICAgfVxuXG4gICAgcmV0dXJuIExPR19UQUJMRVtuXTtcbiAgfTtcblxuICBfdGhpcy5nZXhwID0gZnVuY3Rpb24obikge1xuXG4gICAgd2hpbGUgKG4gPCAwKSB7XG4gICAgICBuICs9IDI1NTtcbiAgICB9XG5cbiAgICB3aGlsZSAobiA+PSAyNTYpIHtcbiAgICAgIG4gLT0gMjU1O1xuICAgIH1cblxuICAgIHJldHVybiBFWFBfVEFCTEVbbl07XG4gIH07XG5cbiAgcmV0dXJuIF90aGlzO1xufSgpO1xuXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gcXJQb2x5bm9taWFsXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBxclBvbHlub21pYWwgPSBmdW5jdGlvbihudW0sIHNoaWZ0KSB7XG5cbiAgaWYgKHR5cGVvZiBudW0ubGVuZ3RoID09ICd1bmRlZmluZWQnKSB7XG4gICAgdGhyb3cgbnVtLmxlbmd0aCArICcvJyArIHNoaWZ0O1xuICB9XG5cbiAgY29uc3QgX251bSA9IGZ1bmN0aW9uKCkge1xuICAgIGxldCBvZmZzZXQgPSAwO1xuICAgIHdoaWxlIChvZmZzZXQgPCBudW0ubGVuZ3RoICYmIG51bVtvZmZzZXRdID09IDApIHtcbiAgICAgIG9mZnNldCArPSAxO1xuICAgIH1cbiAgICBjb25zdCBfbnVtID0gbmV3IEFycmF5KG51bS5sZW5ndGggLSBvZmZzZXQgKyBzaGlmdCk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBudW0ubGVuZ3RoIC0gb2Zmc2V0OyBpICs9IDEpIHtcbiAgICAgIF9udW1baV0gPSBudW1baSArIG9mZnNldF07XG4gICAgfVxuICAgIHJldHVybiBfbnVtO1xuICB9KCk7XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBfdGhpcy5nZXRBdCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgcmV0dXJuIF9udW1baW5kZXhdO1xuICB9O1xuXG4gIF90aGlzLmdldExlbmd0aCA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBfbnVtLmxlbmd0aDtcbiAgfTtcblxuICBfdGhpcy5tdWx0aXBseSA9IGZ1bmN0aW9uKGUpIHtcblxuICAgIGNvbnN0IG51bSA9IG5ldyBBcnJheShfdGhpcy5nZXRMZW5ndGgoKSArIGUuZ2V0TGVuZ3RoKCkgLSAxKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgX3RoaXMuZ2V0TGVuZ3RoKCk7IGkgKz0gMSkge1xuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBlLmdldExlbmd0aCgpOyBqICs9IDEpIHtcbiAgICAgICAgbnVtW2kgKyBqXSBePSBRUk1hdGguZ2V4cChRUk1hdGguZ2xvZyhfdGhpcy5nZXRBdChpKSApICsgUVJNYXRoLmdsb2coZS5nZXRBdChqKSApICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHFyUG9seW5vbWlhbChudW0sIDApO1xuICB9O1xuXG4gIF90aGlzLm1vZCA9IGZ1bmN0aW9uKGUpIHtcblxuICAgIGlmIChfdGhpcy5nZXRMZW5ndGgoKSAtIGUuZ2V0TGVuZ3RoKCkgPCAwKSB7XG4gICAgICByZXR1cm4gX3RoaXM7XG4gICAgfVxuXG4gICAgY29uc3QgcmF0aW8gPSBRUk1hdGguZ2xvZyhfdGhpcy5nZXRBdCgwKSApIC0gUVJNYXRoLmdsb2coZS5nZXRBdCgwKSApO1xuXG4gICAgY29uc3QgbnVtID0gbmV3IEFycmF5KF90aGlzLmdldExlbmd0aCgpICk7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBfdGhpcy5nZXRMZW5ndGgoKTsgaSArPSAxKSB7XG4gICAgICBudW1baV0gPSBfdGhpcy5nZXRBdChpKTtcbiAgICB9XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGUuZ2V0TGVuZ3RoKCk7IGkgKz0gMSkge1xuICAgICAgbnVtW2ldIF49IFFSTWF0aC5nZXhwKFFSTWF0aC5nbG9nKGUuZ2V0QXQoaSkgKSArIHJhdGlvKTtcbiAgICB9XG5cbiAgICAvLyByZWN1cnNpdmUgY2FsbFxuICAgIHJldHVybiBxclBvbHlub21pYWwobnVtLCAwKS5tb2QoZSk7XG4gIH07XG5cbiAgcmV0dXJuIF90aGlzO1xufTtcblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFFSUlNCbG9ja1xuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgUVJSU0Jsb2NrID0gZnVuY3Rpb24oKSB7XG5cbiAgY29uc3QgUlNfQkxPQ0tfVEFCTEUgPSBbXG5cbiAgICAvLyBMXG4gICAgLy8gTVxuICAgIC8vIFFcbiAgICAvLyBIXG5cbiAgICAvLyAxXG4gICAgWzEsIDI2LCAxOV0sXG4gICAgWzEsIDI2LCAxNl0sXG4gICAgWzEsIDI2LCAxM10sXG4gICAgWzEsIDI2LCA5XSxcblxuICAgIC8vIDJcbiAgICBbMSwgNDQsIDM0XSxcbiAgICBbMSwgNDQsIDI4XSxcbiAgICBbMSwgNDQsIDIyXSxcbiAgICBbMSwgNDQsIDE2XSxcblxuICAgIC8vIDNcbiAgICBbMSwgNzAsIDU1XSxcbiAgICBbMSwgNzAsIDQ0XSxcbiAgICBbMiwgMzUsIDE3XSxcbiAgICBbMiwgMzUsIDEzXSxcblxuICAgIC8vIDRcbiAgICBbMSwgMTAwLCA4MF0sXG4gICAgWzIsIDUwLCAzMl0sXG4gICAgWzIsIDUwLCAyNF0sXG4gICAgWzQsIDI1LCA5XSxcblxuICAgIC8vIDVcbiAgICBbMSwgMTM0LCAxMDhdLFxuICAgIFsyLCA2NywgNDNdLFxuICAgIFsyLCAzMywgMTUsIDIsIDM0LCAxNl0sXG4gICAgWzIsIDMzLCAxMSwgMiwgMzQsIDEyXSxcblxuICAgIC8vIDZcbiAgICBbMiwgODYsIDY4XSxcbiAgICBbNCwgNDMsIDI3XSxcbiAgICBbNCwgNDMsIDE5XSxcbiAgICBbNCwgNDMsIDE1XSxcblxuICAgIC8vIDdcbiAgICBbMiwgOTgsIDc4XSxcbiAgICBbNCwgNDksIDMxXSxcbiAgICBbMiwgMzIsIDE0LCA0LCAzMywgMTVdLFxuICAgIFs0LCAzOSwgMTMsIDEsIDQwLCAxNF0sXG5cbiAgICAvLyA4XG4gICAgWzIsIDEyMSwgOTddLFxuICAgIFsyLCA2MCwgMzgsIDIsIDYxLCAzOV0sXG4gICAgWzQsIDQwLCAxOCwgMiwgNDEsIDE5XSxcbiAgICBbNCwgNDAsIDE0LCAyLCA0MSwgMTVdLFxuXG4gICAgLy8gOVxuICAgIFsyLCAxNDYsIDExNl0sXG4gICAgWzMsIDU4LCAzNiwgMiwgNTksIDM3XSxcbiAgICBbNCwgMzYsIDE2LCA0LCAzNywgMTddLFxuICAgIFs0LCAzNiwgMTIsIDQsIDM3LCAxM10sXG5cbiAgICAvLyAxMFxuICAgIFsyLCA4NiwgNjgsIDIsIDg3LCA2OV0sXG4gICAgWzQsIDY5LCA0MywgMSwgNzAsIDQ0XSxcbiAgICBbNiwgNDMsIDE5LCAyLCA0NCwgMjBdLFxuICAgIFs2LCA0MywgMTUsIDIsIDQ0LCAxNl0sXG5cbiAgICAvLyAxMVxuICAgIFs0LCAxMDEsIDgxXSxcbiAgICBbMSwgODAsIDUwLCA0LCA4MSwgNTFdLFxuICAgIFs0LCA1MCwgMjIsIDQsIDUxLCAyM10sXG4gICAgWzMsIDM2LCAxMiwgOCwgMzcsIDEzXSxcblxuICAgIC8vIDEyXG4gICAgWzIsIDExNiwgOTIsIDIsIDExNywgOTNdLFxuICAgIFs2LCA1OCwgMzYsIDIsIDU5LCAzN10sXG4gICAgWzQsIDQ2LCAyMCwgNiwgNDcsIDIxXSxcbiAgICBbNywgNDIsIDE0LCA0LCA0MywgMTVdLFxuXG4gICAgLy8gMTNcbiAgICBbNCwgMTMzLCAxMDddLFxuICAgIFs4LCA1OSwgMzcsIDEsIDYwLCAzOF0sXG4gICAgWzgsIDQ0LCAyMCwgNCwgNDUsIDIxXSxcbiAgICBbMTIsIDMzLCAxMSwgNCwgMzQsIDEyXSxcblxuICAgIC8vIDE0XG4gICAgWzMsIDE0NSwgMTE1LCAxLCAxNDYsIDExNl0sXG4gICAgWzQsIDY0LCA0MCwgNSwgNjUsIDQxXSxcbiAgICBbMTEsIDM2LCAxNiwgNSwgMzcsIDE3XSxcbiAgICBbMTEsIDM2LCAxMiwgNSwgMzcsIDEzXSxcblxuICAgIC8vIDE1XG4gICAgWzUsIDEwOSwgODcsIDEsIDExMCwgODhdLFxuICAgIFs1LCA2NSwgNDEsIDUsIDY2LCA0Ml0sXG4gICAgWzUsIDU0LCAyNCwgNywgNTUsIDI1XSxcbiAgICBbMTEsIDM2LCAxMiwgNywgMzcsIDEzXSxcblxuICAgIC8vIDE2XG4gICAgWzUsIDEyMiwgOTgsIDEsIDEyMywgOTldLFxuICAgIFs3LCA3MywgNDUsIDMsIDc0LCA0Nl0sXG4gICAgWzE1LCA0MywgMTksIDIsIDQ0LCAyMF0sXG4gICAgWzMsIDQ1LCAxNSwgMTMsIDQ2LCAxNl0sXG5cbiAgICAvLyAxN1xuICAgIFsxLCAxMzUsIDEwNywgNSwgMTM2LCAxMDhdLFxuICAgIFsxMCwgNzQsIDQ2LCAxLCA3NSwgNDddLFxuICAgIFsxLCA1MCwgMjIsIDE1LCA1MSwgMjNdLFxuICAgIFsyLCA0MiwgMTQsIDE3LCA0MywgMTVdLFxuXG4gICAgLy8gMThcbiAgICBbNSwgMTUwLCAxMjAsIDEsIDE1MSwgMTIxXSxcbiAgICBbOSwgNjksIDQzLCA0LCA3MCwgNDRdLFxuICAgIFsxNywgNTAsIDIyLCAxLCA1MSwgMjNdLFxuICAgIFsyLCA0MiwgMTQsIDE5LCA0MywgMTVdLFxuXG4gICAgLy8gMTlcbiAgICBbMywgMTQxLCAxMTMsIDQsIDE0MiwgMTE0XSxcbiAgICBbMywgNzAsIDQ0LCAxMSwgNzEsIDQ1XSxcbiAgICBbMTcsIDQ3LCAyMSwgNCwgNDgsIDIyXSxcbiAgICBbOSwgMzksIDEzLCAxNiwgNDAsIDE0XSxcblxuICAgIC8vIDIwXG4gICAgWzMsIDEzNSwgMTA3LCA1LCAxMzYsIDEwOF0sXG4gICAgWzMsIDY3LCA0MSwgMTMsIDY4LCA0Ml0sXG4gICAgWzE1LCA1NCwgMjQsIDUsIDU1LCAyNV0sXG4gICAgWzE1LCA0MywgMTUsIDEwLCA0NCwgMTZdLFxuXG4gICAgLy8gMjFcbiAgICBbNCwgMTQ0LCAxMTYsIDQsIDE0NSwgMTE3XSxcbiAgICBbMTcsIDY4LCA0Ml0sXG4gICAgWzE3LCA1MCwgMjIsIDYsIDUxLCAyM10sXG4gICAgWzE5LCA0NiwgMTYsIDYsIDQ3LCAxN10sXG5cbiAgICAvLyAyMlxuICAgIFsyLCAxMzksIDExMSwgNywgMTQwLCAxMTJdLFxuICAgIFsxNywgNzQsIDQ2XSxcbiAgICBbNywgNTQsIDI0LCAxNiwgNTUsIDI1XSxcbiAgICBbMzQsIDM3LCAxM10sXG5cbiAgICAvLyAyM1xuICAgIFs0LCAxNTEsIDEyMSwgNSwgMTUyLCAxMjJdLFxuICAgIFs0LCA3NSwgNDcsIDE0LCA3NiwgNDhdLFxuICAgIFsxMSwgNTQsIDI0LCAxNCwgNTUsIDI1XSxcbiAgICBbMTYsIDQ1LCAxNSwgMTQsIDQ2LCAxNl0sXG5cbiAgICAvLyAyNFxuICAgIFs2LCAxNDcsIDExNywgNCwgMTQ4LCAxMThdLFxuICAgIFs2LCA3MywgNDUsIDE0LCA3NCwgNDZdLFxuICAgIFsxMSwgNTQsIDI0LCAxNiwgNTUsIDI1XSxcbiAgICBbMzAsIDQ2LCAxNiwgMiwgNDcsIDE3XSxcblxuICAgIC8vIDI1XG4gICAgWzgsIDEzMiwgMTA2LCA0LCAxMzMsIDEwN10sXG4gICAgWzgsIDc1LCA0NywgMTMsIDc2LCA0OF0sXG4gICAgWzcsIDU0LCAyNCwgMjIsIDU1LCAyNV0sXG4gICAgWzIyLCA0NSwgMTUsIDEzLCA0NiwgMTZdLFxuXG4gICAgLy8gMjZcbiAgICBbMTAsIDE0MiwgMTE0LCAyLCAxNDMsIDExNV0sXG4gICAgWzE5LCA3NCwgNDYsIDQsIDc1LCA0N10sXG4gICAgWzI4LCA1MCwgMjIsIDYsIDUxLCAyM10sXG4gICAgWzMzLCA0NiwgMTYsIDQsIDQ3LCAxN10sXG5cbiAgICAvLyAyN1xuICAgIFs4LCAxNTIsIDEyMiwgNCwgMTUzLCAxMjNdLFxuICAgIFsyMiwgNzMsIDQ1LCAzLCA3NCwgNDZdLFxuICAgIFs4LCA1MywgMjMsIDI2LCA1NCwgMjRdLFxuICAgIFsxMiwgNDUsIDE1LCAyOCwgNDYsIDE2XSxcblxuICAgIC8vIDI4XG4gICAgWzMsIDE0NywgMTE3LCAxMCwgMTQ4LCAxMThdLFxuICAgIFszLCA3MywgNDUsIDIzLCA3NCwgNDZdLFxuICAgIFs0LCA1NCwgMjQsIDMxLCA1NSwgMjVdLFxuICAgIFsxMSwgNDUsIDE1LCAzMSwgNDYsIDE2XSxcblxuICAgIC8vIDI5XG4gICAgWzcsIDE0NiwgMTE2LCA3LCAxNDcsIDExN10sXG4gICAgWzIxLCA3MywgNDUsIDcsIDc0LCA0Nl0sXG4gICAgWzEsIDUzLCAyMywgMzcsIDU0LCAyNF0sXG4gICAgWzE5LCA0NSwgMTUsIDI2LCA0NiwgMTZdLFxuXG4gICAgLy8gMzBcbiAgICBbNSwgMTQ1LCAxMTUsIDEwLCAxNDYsIDExNl0sXG4gICAgWzE5LCA3NSwgNDcsIDEwLCA3NiwgNDhdLFxuICAgIFsxNSwgNTQsIDI0LCAyNSwgNTUsIDI1XSxcbiAgICBbMjMsIDQ1LCAxNSwgMjUsIDQ2LCAxNl0sXG5cbiAgICAvLyAzMVxuICAgIFsxMywgMTQ1LCAxMTUsIDMsIDE0NiwgMTE2XSxcbiAgICBbMiwgNzQsIDQ2LCAyOSwgNzUsIDQ3XSxcbiAgICBbNDIsIDU0LCAyNCwgMSwgNTUsIDI1XSxcbiAgICBbMjMsIDQ1LCAxNSwgMjgsIDQ2LCAxNl0sXG5cbiAgICAvLyAzMlxuICAgIFsxNywgMTQ1LCAxMTVdLFxuICAgIFsxMCwgNzQsIDQ2LCAyMywgNzUsIDQ3XSxcbiAgICBbMTAsIDU0LCAyNCwgMzUsIDU1LCAyNV0sXG4gICAgWzE5LCA0NSwgMTUsIDM1LCA0NiwgMTZdLFxuXG4gICAgLy8gMzNcbiAgICBbMTcsIDE0NSwgMTE1LCAxLCAxNDYsIDExNl0sXG4gICAgWzE0LCA3NCwgNDYsIDIxLCA3NSwgNDddLFxuICAgIFsyOSwgNTQsIDI0LCAxOSwgNTUsIDI1XSxcbiAgICBbMTEsIDQ1LCAxNSwgNDYsIDQ2LCAxNl0sXG5cbiAgICAvLyAzNFxuICAgIFsxMywgMTQ1LCAxMTUsIDYsIDE0NiwgMTE2XSxcbiAgICBbMTQsIDc0LCA0NiwgMjMsIDc1LCA0N10sXG4gICAgWzQ0LCA1NCwgMjQsIDcsIDU1LCAyNV0sXG4gICAgWzU5LCA0NiwgMTYsIDEsIDQ3LCAxN10sXG5cbiAgICAvLyAzNVxuICAgIFsxMiwgMTUxLCAxMjEsIDcsIDE1MiwgMTIyXSxcbiAgICBbMTIsIDc1LCA0NywgMjYsIDc2LCA0OF0sXG4gICAgWzM5LCA1NCwgMjQsIDE0LCA1NSwgMjVdLFxuICAgIFsyMiwgNDUsIDE1LCA0MSwgNDYsIDE2XSxcblxuICAgIC8vIDM2XG4gICAgWzYsIDE1MSwgMTIxLCAxNCwgMTUyLCAxMjJdLFxuICAgIFs2LCA3NSwgNDcsIDM0LCA3NiwgNDhdLFxuICAgIFs0NiwgNTQsIDI0LCAxMCwgNTUsIDI1XSxcbiAgICBbMiwgNDUsIDE1LCA2NCwgNDYsIDE2XSxcblxuICAgIC8vIDM3XG4gICAgWzE3LCAxNTIsIDEyMiwgNCwgMTUzLCAxMjNdLFxuICAgIFsyOSwgNzQsIDQ2LCAxNCwgNzUsIDQ3XSxcbiAgICBbNDksIDU0LCAyNCwgMTAsIDU1LCAyNV0sXG4gICAgWzI0LCA0NSwgMTUsIDQ2LCA0NiwgMTZdLFxuXG4gICAgLy8gMzhcbiAgICBbNCwgMTUyLCAxMjIsIDE4LCAxNTMsIDEyM10sXG4gICAgWzEzLCA3NCwgNDYsIDMyLCA3NSwgNDddLFxuICAgIFs0OCwgNTQsIDI0LCAxNCwgNTUsIDI1XSxcbiAgICBbNDIsIDQ1LCAxNSwgMzIsIDQ2LCAxNl0sXG5cbiAgICAvLyAzOVxuICAgIFsyMCwgMTQ3LCAxMTcsIDQsIDE0OCwgMTE4XSxcbiAgICBbNDAsIDc1LCA0NywgNywgNzYsIDQ4XSxcbiAgICBbNDMsIDU0LCAyNCwgMjIsIDU1LCAyNV0sXG4gICAgWzEwLCA0NSwgMTUsIDY3LCA0NiwgMTZdLFxuXG4gICAgLy8gNDBcbiAgICBbMTksIDE0OCwgMTE4LCA2LCAxNDksIDExOV0sXG4gICAgWzE4LCA3NSwgNDcsIDMxLCA3NiwgNDhdLFxuICAgIFszNCwgNTQsIDI0LCAzNCwgNTUsIDI1XSxcbiAgICBbMjAsIDQ1LCAxNSwgNjEsIDQ2LCAxNl1cbiAgXTtcblxuICBjb25zdCBxclJTQmxvY2sgPSBmdW5jdGlvbih0b3RhbENvdW50LCBkYXRhQ291bnQpIHtcbiAgICBjb25zdCBfdGhpcyA9IHt9O1xuICAgIF90aGlzLnRvdGFsQ291bnQgPSB0b3RhbENvdW50O1xuICAgIF90aGlzLmRhdGFDb3VudCA9IGRhdGFDb3VudDtcbiAgICByZXR1cm4gX3RoaXM7XG4gIH07XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBjb25zdCBnZXRSc0Jsb2NrVGFibGUgPSBmdW5jdGlvbih0eXBlTnVtYmVyLCBlcnJvckNvcnJlY3Rpb25MZXZlbCkge1xuXG4gICAgc3dpdGNoKGVycm9yQ29ycmVjdGlvbkxldmVsKSB7XG4gICAgY2FzZSBRUkVycm9yQ29ycmVjdGlvbkxldmVsLkwgOlxuICAgICAgcmV0dXJuIFJTX0JMT0NLX1RBQkxFWyh0eXBlTnVtYmVyIC0gMSkgKiA0ICsgMF07XG4gICAgY2FzZSBRUkVycm9yQ29ycmVjdGlvbkxldmVsLk0gOlxuICAgICAgcmV0dXJuIFJTX0JMT0NLX1RBQkxFWyh0eXBlTnVtYmVyIC0gMSkgKiA0ICsgMV07XG4gICAgY2FzZSBRUkVycm9yQ29ycmVjdGlvbkxldmVsLlEgOlxuICAgICAgcmV0dXJuIFJTX0JMT0NLX1RBQkxFWyh0eXBlTnVtYmVyIC0gMSkgKiA0ICsgMl07XG4gICAgY2FzZSBRUkVycm9yQ29ycmVjdGlvbkxldmVsLkggOlxuICAgICAgcmV0dXJuIFJTX0JMT0NLX1RBQkxFWyh0eXBlTnVtYmVyIC0gMSkgKiA0ICsgM107XG4gICAgZGVmYXVsdCA6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfTtcblxuICBfdGhpcy5nZXRSU0Jsb2NrcyA9IGZ1bmN0aW9uKHR5cGVOdW1iZXIsIGVycm9yQ29ycmVjdGlvbkxldmVsKSB7XG5cbiAgICBjb25zdCByc0Jsb2NrID0gZ2V0UnNCbG9ja1RhYmxlKHR5cGVOdW1iZXIsIGVycm9yQ29ycmVjdGlvbkxldmVsKTtcblxuICAgIGlmICh0eXBlb2YgcnNCbG9jayA9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhyb3cgJ2JhZCBycyBibG9jayBAIHR5cGVOdW1iZXI6JyArIHR5cGVOdW1iZXIgK1xuICAgICAgICAgICcvZXJyb3JDb3JyZWN0aW9uTGV2ZWw6JyArIGVycm9yQ29ycmVjdGlvbkxldmVsO1xuICAgIH1cblxuICAgIGNvbnN0IGxlbmd0aCA9IHJzQmxvY2subGVuZ3RoIC8gMztcblxuICAgIGNvbnN0IGxpc3QgPSBbXTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcblxuICAgICAgY29uc3QgY291bnQgPSByc0Jsb2NrW2kgKiAzICsgMF07XG4gICAgICBjb25zdCB0b3RhbENvdW50ID0gcnNCbG9ja1tpICogMyArIDFdO1xuICAgICAgY29uc3QgZGF0YUNvdW50ID0gcnNCbG9ja1tpICogMyArIDJdO1xuXG4gICAgICBmb3IgKGxldCBqID0gMDsgaiA8IGNvdW50OyBqICs9IDEpIHtcbiAgICAgICAgbGlzdC5wdXNoKHFyUlNCbG9jayh0b3RhbENvdW50LCBkYXRhQ291bnQpICk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGxpc3Q7XG4gIH07XG5cbiAgcmV0dXJuIF90aGlzO1xufSgpO1xuXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gcXJCaXRCdWZmZXJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHFyQml0QnVmZmVyID0gZnVuY3Rpb24oKSB7XG5cbiAgY29uc3QgX2J1ZmZlciA9IFtdO1xuICBsZXQgX2xlbmd0aCA9IDA7XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBfdGhpcy5nZXRCdWZmZXIgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gX2J1ZmZlcjtcbiAgfTtcblxuICBfdGhpcy5nZXRBdCA9IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgY29uc3QgYnVmSW5kZXggPSBNYXRoLmZsb29yKGluZGV4IC8gOCk7XG4gICAgcmV0dXJuICggKF9idWZmZXJbYnVmSW5kZXhdID4+PiAoNyAtIGluZGV4ICUgOCkgKSAmIDEpID09IDE7XG4gIH07XG5cbiAgX3RoaXMucHV0ID0gZnVuY3Rpb24obnVtLCBsZW5ndGgpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBfdGhpcy5wdXRCaXQoICggKG51bSA+Pj4gKGxlbmd0aCAtIGkgLSAxKSApICYgMSkgPT0gMSk7XG4gICAgfVxuICB9O1xuXG4gIF90aGlzLmdldExlbmd0aEluQml0cyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBfbGVuZ3RoO1xuICB9O1xuXG4gIF90aGlzLnB1dEJpdCA9IGZ1bmN0aW9uKGJpdCkge1xuXG4gICAgY29uc3QgYnVmSW5kZXggPSBNYXRoLmZsb29yKF9sZW5ndGggLyA4KTtcbiAgICBpZiAoX2J1ZmZlci5sZW5ndGggPD0gYnVmSW5kZXgpIHtcbiAgICAgIF9idWZmZXIucHVzaCgwKTtcbiAgICB9XG5cbiAgICBpZiAoYml0KSB7XG4gICAgICBfYnVmZmVyW2J1ZkluZGV4XSB8PSAoMHg4MCA+Pj4gKF9sZW5ndGggJSA4KSApO1xuICAgIH1cblxuICAgIF9sZW5ndGggKz0gMTtcbiAgfTtcblxuICByZXR1cm4gX3RoaXM7XG59O1xuXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gcXJOdW1iZXJcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHFyTnVtYmVyID0gZnVuY3Rpb24oZGF0YSkge1xuXG4gIGNvbnN0IF9tb2RlID0gUVJNb2RlLk1PREVfTlVNQkVSO1xuICBjb25zdCBfZGF0YSA9IGRhdGE7XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBfdGhpcy5nZXRNb2RlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIF9tb2RlO1xuICB9O1xuXG4gIF90aGlzLmdldExlbmd0aCA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuICAgIHJldHVybiBfZGF0YS5sZW5ndGg7XG4gIH07XG5cbiAgX3RoaXMud3JpdGUgPSBmdW5jdGlvbihidWZmZXIpIHtcblxuICAgIGNvbnN0IGRhdGEgPSBfZGF0YTtcblxuICAgIGxldCBpID0gMDtcblxuICAgIHdoaWxlIChpICsgMiA8IGRhdGEubGVuZ3RoKSB7XG4gICAgICBidWZmZXIucHV0KHN0clRvTnVtKGRhdGEuc3Vic3RyaW5nKGksIGkgKyAzKSApLCAxMCk7XG4gICAgICBpICs9IDM7XG4gICAgfVxuXG4gICAgaWYgKGkgPCBkYXRhLmxlbmd0aCkge1xuICAgICAgaWYgKGRhdGEubGVuZ3RoIC0gaSA9PSAxKSB7XG4gICAgICAgIGJ1ZmZlci5wdXQoc3RyVG9OdW0oZGF0YS5zdWJzdHJpbmcoaSwgaSArIDEpICksIDQpO1xuICAgICAgfSBlbHNlIGlmIChkYXRhLmxlbmd0aCAtIGkgPT0gMikge1xuICAgICAgICBidWZmZXIucHV0KHN0clRvTnVtKGRhdGEuc3Vic3RyaW5nKGksIGkgKyAyKSApLCA3KTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgY29uc3Qgc3RyVG9OdW0gPSBmdW5jdGlvbihzKSB7XG4gICAgbGV0IG51bSA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBudW0gPSBudW0gKiAxMCArIGNoYXRUb051bShzLmNoYXJBdChpKSApO1xuICAgIH1cbiAgICByZXR1cm4gbnVtO1xuICB9O1xuXG4gIGNvbnN0IGNoYXRUb051bSA9IGZ1bmN0aW9uKGMpIHtcbiAgICBpZiAoJzAnIDw9IGMgJiYgYyA8PSAnOScpIHtcbiAgICAgIHJldHVybiBjLmNoYXJDb2RlQXQoMCkgLSAnMCcuY2hhckNvZGVBdCgwKTtcbiAgICB9XG4gICAgdGhyb3cgJ2lsbGVnYWwgY2hhciA6JyArIGM7XG4gIH07XG5cbiAgcmV0dXJuIF90aGlzO1xufTtcblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIHFyQWxwaGFOdW1cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHFyQWxwaGFOdW0gPSBmdW5jdGlvbihkYXRhKSB7XG5cbiAgY29uc3QgX21vZGUgPSBRUk1vZGUuTU9ERV9BTFBIQV9OVU07XG4gIGNvbnN0IF9kYXRhID0gZGF0YTtcblxuICBjb25zdCBfdGhpcyA9IHt9O1xuXG4gIF90aGlzLmdldE1vZGUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gX21vZGU7XG4gIH07XG5cbiAgX3RoaXMuZ2V0TGVuZ3RoID0gZnVuY3Rpb24oYnVmZmVyKSB7XG4gICAgcmV0dXJuIF9kYXRhLmxlbmd0aDtcbiAgfTtcblxuICBfdGhpcy53cml0ZSA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuXG4gICAgY29uc3QgcyA9IF9kYXRhO1xuXG4gICAgbGV0IGkgPSAwO1xuXG4gICAgd2hpbGUgKGkgKyAxIDwgcy5sZW5ndGgpIHtcbiAgICAgIGJ1ZmZlci5wdXQoXG4gICAgICAgIGdldENvZGUocy5jaGFyQXQoaSkgKSAqIDQ1ICtcbiAgICAgICAgZ2V0Q29kZShzLmNoYXJBdChpICsgMSkgKSwgMTEpO1xuICAgICAgaSArPSAyO1xuICAgIH1cblxuICAgIGlmIChpIDwgcy5sZW5ndGgpIHtcbiAgICAgIGJ1ZmZlci5wdXQoZ2V0Q29kZShzLmNoYXJBdChpKSApLCA2KTtcbiAgICB9XG4gIH07XG5cbiAgY29uc3QgZ2V0Q29kZSA9IGZ1bmN0aW9uKGMpIHtcblxuICAgIGlmICgnMCcgPD0gYyAmJiBjIDw9ICc5Jykge1xuICAgICAgcmV0dXJuIGMuY2hhckNvZGVBdCgwKSAtICcwJy5jaGFyQ29kZUF0KDApO1xuICAgIH0gZWxzZSBpZiAoJ0EnIDw9IGMgJiYgYyA8PSAnWicpIHtcbiAgICAgIHJldHVybiBjLmNoYXJDb2RlQXQoMCkgLSAnQScuY2hhckNvZGVBdCgwKSArIDEwO1xuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKGMpIHtcbiAgICAgIGNhc2UgJ1xcdTAwMjAnIDogcmV0dXJuIDM2O1xuICAgICAgY2FzZSAnJCcgOiByZXR1cm4gMzc7XG4gICAgICBjYXNlICclJyA6IHJldHVybiAzODtcbiAgICAgIGNhc2UgJyonIDogcmV0dXJuIDM5O1xuICAgICAgY2FzZSAnKycgOiByZXR1cm4gNDA7XG4gICAgICBjYXNlICctJyA6IHJldHVybiA0MTtcbiAgICAgIGNhc2UgJy4nIDogcmV0dXJuIDQyO1xuICAgICAgY2FzZSAnLycgOiByZXR1cm4gNDM7XG4gICAgICBjYXNlICc6JyA6IHJldHVybiA0NDtcbiAgICAgIGRlZmF1bHQgOlxuICAgICAgICB0aHJvdyAnaWxsZWdhbCBjaGFyIDonICsgYztcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIF90aGlzO1xufTtcblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIHFyOEJpdEJ5dGVcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHFyOEJpdEJ5dGUgPSBmdW5jdGlvbihkYXRhKSB7XG5cbiAgY29uc3QgX21vZGUgPSBRUk1vZGUuTU9ERV84QklUX0JZVEU7XG4gIGNvbnN0IF9kYXRhID0gZGF0YTtcbiAgY29uc3QgX2J5dGVzID0gcXJjb2RlLnN0cmluZ1RvQnl0ZXMoZGF0YSk7XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBfdGhpcy5nZXRNb2RlID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIF9tb2RlO1xuICB9O1xuXG4gIF90aGlzLmdldExlbmd0aCA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuICAgIHJldHVybiBfYnl0ZXMubGVuZ3RoO1xuICB9O1xuXG4gIF90aGlzLndyaXRlID0gZnVuY3Rpb24oYnVmZmVyKSB7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBfYnl0ZXMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGJ1ZmZlci5wdXQoX2J5dGVzW2ldLCA4KTtcbiAgICB9XG4gIH07XG5cbiAgcmV0dXJuIF90aGlzO1xufTtcblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIHFyS2Fuamlcbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHFyS2FuamkgPSBmdW5jdGlvbihkYXRhKSB7XG5cbiAgY29uc3QgX21vZGUgPSBRUk1vZGUuTU9ERV9LQU5KSTtcbiAgY29uc3QgX2RhdGEgPSBkYXRhO1xuXG4gIGNvbnN0IHN0cmluZ1RvQnl0ZXMgPSBxcmNvZGUuc3RyaW5nVG9CeXRlcztcbiAgIWZ1bmN0aW9uKGMsIGNvZGUpIHtcbiAgICAvLyBzZWxmIHRlc3QgZm9yIHNqaXMgc3VwcG9ydC5cbiAgICBjb25zdCB0ZXN0ID0gc3RyaW5nVG9CeXRlcyhjKTtcbiAgICBpZiAodGVzdC5sZW5ndGggIT0gMiB8fCAoICh0ZXN0WzBdIDw8IDgpIHwgdGVzdFsxXSkgIT0gY29kZSkge1xuICAgICAgdGhyb3cgJ3NqaXMgbm90IHN1cHBvcnRlZC4nO1xuICAgIH1cbiAgfSgnXFx1NTNjYicsIDB4OTc0Nik7XG5cbiAgY29uc3QgX2J5dGVzID0gc3RyaW5nVG9CeXRlcyhkYXRhKTtcblxuICBjb25zdCBfdGhpcyA9IHt9O1xuXG4gIF90aGlzLmdldE1vZGUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gX21vZGU7XG4gIH07XG5cbiAgX3RoaXMuZ2V0TGVuZ3RoID0gZnVuY3Rpb24oYnVmZmVyKSB7XG4gICAgcmV0dXJuIH5+KF9ieXRlcy5sZW5ndGggLyAyKTtcbiAgfTtcblxuICBfdGhpcy53cml0ZSA9IGZ1bmN0aW9uKGJ1ZmZlcikge1xuXG4gICAgY29uc3QgZGF0YSA9IF9ieXRlcztcblxuICAgIGxldCBpID0gMDtcblxuICAgIHdoaWxlIChpICsgMSA8IGRhdGEubGVuZ3RoKSB7XG5cbiAgICAgIGxldCBjID0gKCAoMHhmZiAmIGRhdGFbaV0pIDw8IDgpIHwgKDB4ZmYgJiBkYXRhW2kgKyAxXSk7XG5cbiAgICAgIGlmICgweDgxNDAgPD0gYyAmJiBjIDw9IDB4OUZGQykge1xuICAgICAgICBjIC09IDB4ODE0MDtcbiAgICAgIH0gZWxzZSBpZiAoMHhFMDQwIDw9IGMgJiYgYyA8PSAweEVCQkYpIHtcbiAgICAgICAgYyAtPSAweEMxNDA7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyAnaWxsZWdhbCBjaGFyIGF0ICcgKyAoaSArIDEpICsgJy8nICsgYztcbiAgICAgIH1cblxuICAgICAgYyA9ICggKGMgPj4+IDgpICYgMHhmZikgKiAweEMwICsgKGMgJiAweGZmKTtcblxuICAgICAgYnVmZmVyLnB1dChjLCAxMyk7XG5cbiAgICAgIGkgKz0gMjtcbiAgICB9XG5cbiAgICBpZiAoaSA8IGRhdGEubGVuZ3RoKSB7XG4gICAgICB0aHJvdyAnaWxsZWdhbCBjaGFyIGF0ICcgKyAoaSArIDEpO1xuICAgIH1cbiAgfTtcblxuICByZXR1cm4gX3RoaXM7XG59O1xuXG4vLz09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuLy8gR0lGIFN1cHBvcnQgZXRjLlxuLy9cblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGJ5dGVBcnJheU91dHB1dFN0cmVhbVxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgYnl0ZUFycmF5T3V0cHV0U3RyZWFtID0gZnVuY3Rpb24oKSB7XG5cbiAgY29uc3QgX2J5dGVzID0gW107XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBfdGhpcy53cml0ZUJ5dGUgPSBmdW5jdGlvbihiKSB7XG4gICAgX2J5dGVzLnB1c2goYiAmIDB4ZmYpO1xuICB9O1xuXG4gIF90aGlzLndyaXRlU2hvcnQgPSBmdW5jdGlvbihpKSB7XG4gICAgX3RoaXMud3JpdGVCeXRlKGkpO1xuICAgIF90aGlzLndyaXRlQnl0ZShpID4+PiA4KTtcbiAgfTtcblxuICBfdGhpcy53cml0ZUJ5dGVzID0gZnVuY3Rpb24oYiwgb2ZmLCBsZW4pIHtcbiAgICBvZmYgPSBvZmYgfHwgMDtcbiAgICBsZW4gPSBsZW4gfHwgYi5sZW5ndGg7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgICAgX3RoaXMud3JpdGVCeXRlKGJbaSArIG9mZl0pO1xuICAgIH1cbiAgfTtcblxuICBfdGhpcy53cml0ZVN0cmluZyA9IGZ1bmN0aW9uKHMpIHtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHMubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIF90aGlzLndyaXRlQnl0ZShzLmNoYXJDb2RlQXQoaSkgKTtcbiAgICB9XG4gIH07XG5cbiAgX3RoaXMudG9CeXRlQXJyYXkgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gX2J5dGVzO1xuICB9O1xuXG4gIF90aGlzLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gICAgbGV0IHMgPSAnJztcbiAgICBzICs9ICdbJztcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IF9ieXRlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgaWYgKGkgPiAwKSB7XG4gICAgICAgIHMgKz0gJywnO1xuICAgICAgfVxuICAgICAgcyArPSBfYnl0ZXNbaV07XG4gICAgfVxuICAgIHMgKz0gJ10nO1xuICAgIHJldHVybiBzO1xuICB9O1xuXG4gIHJldHVybiBfdGhpcztcbn07XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBiYXNlNjRFbmNvZGVPdXRwdXRTdHJlYW1cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IGJhc2U2NEVuY29kZU91dHB1dFN0cmVhbSA9IGZ1bmN0aW9uKCkge1xuXG4gIGxldCBfYnVmZmVyID0gMDtcbiAgbGV0IF9idWZsZW4gPSAwO1xuICBsZXQgX2xlbmd0aCA9IDA7XG4gIGxldCBfYmFzZTY0ID0gJyc7XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBjb25zdCB3cml0ZUVuY29kZWQgPSBmdW5jdGlvbihiKSB7XG4gICAgX2Jhc2U2NCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGVuY29kZShiICYgMHgzZikgKTtcbiAgfTtcblxuICBjb25zdCBlbmNvZGUgPSBmdW5jdGlvbihuKSB7XG4gICAgaWYgKG4gPCAwKSB7XG4gICAgICB0aHJvdyAnbjonICsgbjtcbiAgICB9IGVsc2UgaWYgKG4gPCAyNikge1xuICAgICAgcmV0dXJuIDB4NDEgKyBuO1xuICAgIH0gZWxzZSBpZiAobiA8IDUyKSB7XG4gICAgICByZXR1cm4gMHg2MSArIChuIC0gMjYpO1xuICAgIH0gZWxzZSBpZiAobiA8IDYyKSB7XG4gICAgICByZXR1cm4gMHgzMCArIChuIC0gNTIpO1xuICAgIH0gZWxzZSBpZiAobiA9PSA2Mikge1xuICAgICAgcmV0dXJuIDB4MmI7XG4gICAgfSBlbHNlIGlmIChuID09IDYzKSB7XG4gICAgICByZXR1cm4gMHgyZjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgJ246JyArIG47XG4gICAgfVxuICB9O1xuXG4gIF90aGlzLndyaXRlQnl0ZSA9IGZ1bmN0aW9uKG4pIHtcblxuICAgIF9idWZmZXIgPSAoX2J1ZmZlciA8PCA4KSB8IChuICYgMHhmZik7XG4gICAgX2J1ZmxlbiArPSA4O1xuICAgIF9sZW5ndGggKz0gMTtcblxuICAgIHdoaWxlIChfYnVmbGVuID49IDYpIHtcbiAgICAgIHdyaXRlRW5jb2RlZChfYnVmZmVyID4+PiAoX2J1ZmxlbiAtIDYpICk7XG4gICAgICBfYnVmbGVuIC09IDY7XG4gICAgfVxuICB9O1xuXG4gIF90aGlzLmZsdXNoID0gZnVuY3Rpb24oKSB7XG5cbiAgICBpZiAoX2J1ZmxlbiA+IDApIHtcbiAgICAgIHdyaXRlRW5jb2RlZChfYnVmZmVyIDw8ICg2IC0gX2J1ZmxlbikgKTtcbiAgICAgIF9idWZmZXIgPSAwO1xuICAgICAgX2J1ZmxlbiA9IDA7XG4gICAgfVxuXG4gICAgaWYgKF9sZW5ndGggJSAzICE9IDApIHtcbiAgICAgIC8vIHBhZGRpbmdcbiAgICAgIGNvbnN0IHBhZGxlbiA9IDMgLSBfbGVuZ3RoICUgMztcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGFkbGVuOyBpICs9IDEpIHtcbiAgICAgICAgX2Jhc2U2NCArPSAnPSc7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIF90aGlzLnRvU3RyaW5nID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIF9iYXNlNjQ7XG4gIH07XG5cbiAgcmV0dXJuIF90aGlzO1xufTtcblxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIGJhc2U2NERlY29kZUlucHV0U3RyZWFtXG4vLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCBiYXNlNjREZWNvZGVJbnB1dFN0cmVhbSA9IGZ1bmN0aW9uKHN0cikge1xuXG4gIGNvbnN0IF9zdHIgPSBzdHI7XG4gIGxldCBfcG9zID0gMDtcbiAgbGV0IF9idWZmZXIgPSAwO1xuICBsZXQgX2J1ZmxlbiA9IDA7XG5cbiAgY29uc3QgX3RoaXMgPSB7fTtcblxuICBfdGhpcy5yZWFkID0gZnVuY3Rpb24oKSB7XG5cbiAgICB3aGlsZSAoX2J1ZmxlbiA8IDgpIHtcblxuICAgICAgaWYgKF9wb3MgPj0gX3N0ci5sZW5ndGgpIHtcbiAgICAgICAgaWYgKF9idWZsZW4gPT0gMCkge1xuICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyAndW5leHBlY3RlZCBlbmQgb2YgZmlsZS4vJyArIF9idWZsZW47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGMgPSBfc3RyLmNoYXJBdChfcG9zKTtcbiAgICAgIF9wb3MgKz0gMTtcblxuICAgICAgaWYgKGMgPT0gJz0nKSB7XG4gICAgICAgIF9idWZsZW4gPSAwO1xuICAgICAgICByZXR1cm4gLTE7XG4gICAgICB9IGVsc2UgaWYgKGMubWF0Y2goL15cXHMkLykgKSB7XG4gICAgICAgIC8vIGlnbm9yZSBpZiB3aGl0ZXNwYWNlLlxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgX2J1ZmZlciA9IChfYnVmZmVyIDw8IDYpIHwgZGVjb2RlKGMuY2hhckNvZGVBdCgwKSApO1xuICAgICAgX2J1ZmxlbiArPSA2O1xuICAgIH1cblxuICAgIGNvbnN0IG4gPSAoX2J1ZmZlciA+Pj4gKF9idWZsZW4gLSA4KSApICYgMHhmZjtcbiAgICBfYnVmbGVuIC09IDg7XG4gICAgcmV0dXJuIG47XG4gIH07XG5cbiAgY29uc3QgZGVjb2RlID0gZnVuY3Rpb24oYykge1xuICAgIGlmICgweDQxIDw9IGMgJiYgYyA8PSAweDVhKSB7XG4gICAgICByZXR1cm4gYyAtIDB4NDE7XG4gICAgfSBlbHNlIGlmICgweDYxIDw9IGMgJiYgYyA8PSAweDdhKSB7XG4gICAgICByZXR1cm4gYyAtIDB4NjEgKyAyNjtcbiAgICB9IGVsc2UgaWYgKDB4MzAgPD0gYyAmJiBjIDw9IDB4MzkpIHtcbiAgICAgIHJldHVybiBjIC0gMHgzMCArIDUyO1xuICAgIH0gZWxzZSBpZiAoYyA9PSAweDJiKSB7XG4gICAgICByZXR1cm4gNjI7XG4gICAgfSBlbHNlIGlmIChjID09IDB4MmYpIHtcbiAgICAgIHJldHVybiA2MztcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgJ2M6JyArIGM7XG4gICAgfVxuICB9O1xuXG4gIHJldHVybiBfdGhpcztcbn07XG5cbi8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBnaWZJbWFnZSAoQi9XKVxuLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgZ2lmSW1hZ2UgPSBmdW5jdGlvbih3aWR0aCwgaGVpZ2h0KSB7XG5cbiAgY29uc3QgX3dpZHRoID0gd2lkdGg7XG4gIGNvbnN0IF9oZWlnaHQgPSBoZWlnaHQ7XG4gIGNvbnN0IF9kYXRhID0gbmV3IEFycmF5KHdpZHRoICogaGVpZ2h0KTtcblxuICBjb25zdCBfdGhpcyA9IHt9O1xuXG4gIF90aGlzLnNldFBpeGVsID0gZnVuY3Rpb24oeCwgeSwgcGl4ZWwpIHtcbiAgICBfZGF0YVt5ICogX3dpZHRoICsgeF0gPSBwaXhlbDtcbiAgfTtcblxuICBfdGhpcy53cml0ZSA9IGZ1bmN0aW9uKG91dCkge1xuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBHSUYgU2lnbmF0dXJlXG5cbiAgICBvdXQud3JpdGVTdHJpbmcoJ0dJRjg3YScpO1xuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBTY3JlZW4gRGVzY3JpcHRvclxuXG4gICAgb3V0LndyaXRlU2hvcnQoX3dpZHRoKTtcbiAgICBvdXQud3JpdGVTaG9ydChfaGVpZ2h0KTtcblxuICAgIG91dC53cml0ZUJ5dGUoMHg4MCk7IC8vIDJiaXRcbiAgICBvdXQud3JpdGVCeXRlKDApO1xuICAgIG91dC53cml0ZUJ5dGUoMCk7XG5cbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIEdsb2JhbCBDb2xvciBNYXBcblxuICAgIC8vIGJsYWNrXG4gICAgb3V0LndyaXRlQnl0ZSgweDAwKTtcbiAgICBvdXQud3JpdGVCeXRlKDB4MDApO1xuICAgIG91dC53cml0ZUJ5dGUoMHgwMCk7XG5cbiAgICAvLyB3aGl0ZVxuICAgIG91dC53cml0ZUJ5dGUoMHhmZik7XG4gICAgb3V0LndyaXRlQnl0ZSgweGZmKTtcbiAgICBvdXQud3JpdGVCeXRlKDB4ZmYpO1xuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBJbWFnZSBEZXNjcmlwdG9yXG5cbiAgICBvdXQud3JpdGVTdHJpbmcoJywnKTtcbiAgICBvdXQud3JpdGVTaG9ydCgwKTtcbiAgICBvdXQud3JpdGVTaG9ydCgwKTtcbiAgICBvdXQud3JpdGVTaG9ydChfd2lkdGgpO1xuICAgIG91dC53cml0ZVNob3J0KF9oZWlnaHQpO1xuICAgIG91dC53cml0ZUJ5dGUoMCk7XG5cbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIExvY2FsIENvbG9yIE1hcFxuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBSYXN0ZXIgRGF0YVxuXG4gICAgY29uc3QgbHp3TWluQ29kZVNpemUgPSAyO1xuICAgIGNvbnN0IHJhc3RlciA9IGdldExaV1Jhc3RlcihsendNaW5Db2RlU2l6ZSk7XG5cbiAgICBvdXQud3JpdGVCeXRlKGx6d01pbkNvZGVTaXplKTtcblxuICAgIGxldCBvZmZzZXQgPSAwO1xuXG4gICAgd2hpbGUgKHJhc3Rlci5sZW5ndGggLSBvZmZzZXQgPiAyNTUpIHtcbiAgICAgIG91dC53cml0ZUJ5dGUoMjU1KTtcbiAgICAgIG91dC53cml0ZUJ5dGVzKHJhc3Rlciwgb2Zmc2V0LCAyNTUpO1xuICAgICAgb2Zmc2V0ICs9IDI1NTtcbiAgICB9XG5cbiAgICBvdXQud3JpdGVCeXRlKHJhc3Rlci5sZW5ndGggLSBvZmZzZXQpO1xuICAgIG91dC53cml0ZUJ5dGVzKHJhc3Rlciwgb2Zmc2V0LCByYXN0ZXIubGVuZ3RoIC0gb2Zmc2V0KTtcbiAgICBvdXQud3JpdGVCeXRlKDB4MDApO1xuXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBHSUYgVGVybWluYXRvclxuICAgIG91dC53cml0ZVN0cmluZygnOycpO1xuICB9O1xuXG4gIGNvbnN0IGJpdE91dHB1dFN0cmVhbSA9IGZ1bmN0aW9uKG91dCkge1xuXG4gICAgY29uc3QgX291dCA9IG91dDtcbiAgICBsZXQgX2JpdExlbmd0aCA9IDA7XG4gICAgbGV0IF9iaXRCdWZmZXIgPSAwO1xuXG4gICAgY29uc3QgX3RoaXMgPSB7fTtcblxuICAgIF90aGlzLndyaXRlID0gZnVuY3Rpb24oZGF0YSwgbGVuZ3RoKSB7XG5cbiAgICAgIGlmICggKGRhdGEgPj4+IGxlbmd0aCkgIT0gMCkge1xuICAgICAgICB0aHJvdyAnbGVuZ3RoIG92ZXInO1xuICAgICAgfVxuXG4gICAgICB3aGlsZSAoX2JpdExlbmd0aCArIGxlbmd0aCA+PSA4KSB7XG4gICAgICAgIF9vdXQud3JpdGVCeXRlKDB4ZmYgJiAoIChkYXRhIDw8IF9iaXRMZW5ndGgpIHwgX2JpdEJ1ZmZlcikgKTtcbiAgICAgICAgbGVuZ3RoIC09ICg4IC0gX2JpdExlbmd0aCk7XG4gICAgICAgIGRhdGEgPj4+PSAoOCAtIF9iaXRMZW5ndGgpO1xuICAgICAgICBfYml0QnVmZmVyID0gMDtcbiAgICAgICAgX2JpdExlbmd0aCA9IDA7XG4gICAgICB9XG5cbiAgICAgIF9iaXRCdWZmZXIgPSAoZGF0YSA8PCBfYml0TGVuZ3RoKSB8IF9iaXRCdWZmZXI7XG4gICAgICBfYml0TGVuZ3RoID0gX2JpdExlbmd0aCArIGxlbmd0aDtcbiAgICB9O1xuXG4gICAgX3RoaXMuZmx1c2ggPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChfYml0TGVuZ3RoID4gMCkge1xuICAgICAgICBfb3V0LndyaXRlQnl0ZShfYml0QnVmZmVyKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgcmV0dXJuIF90aGlzO1xuICB9O1xuXG4gIGNvbnN0IGdldExaV1Jhc3RlciA9IGZ1bmN0aW9uKGx6d01pbkNvZGVTaXplKSB7XG5cbiAgICBjb25zdCBjbGVhckNvZGUgPSAxIDw8IGx6d01pbkNvZGVTaXplO1xuICAgIGNvbnN0IGVuZENvZGUgPSAoMSA8PCBsendNaW5Db2RlU2l6ZSkgKyAxO1xuICAgIGxldCBiaXRMZW5ndGggPSBsendNaW5Db2RlU2l6ZSArIDE7XG5cbiAgICAvLyBTZXR1cCBMWldUYWJsZVxuICAgIGNvbnN0IHRhYmxlID0gbHp3VGFibGUoKTtcblxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2xlYXJDb2RlOyBpICs9IDEpIHtcbiAgICAgIHRhYmxlLmFkZChTdHJpbmcuZnJvbUNoYXJDb2RlKGkpICk7XG4gICAgfVxuICAgIHRhYmxlLmFkZChTdHJpbmcuZnJvbUNoYXJDb2RlKGNsZWFyQ29kZSkgKTtcbiAgICB0YWJsZS5hZGQoU3RyaW5nLmZyb21DaGFyQ29kZShlbmRDb2RlKSApO1xuXG4gICAgY29uc3QgYnl0ZU91dCA9IGJ5dGVBcnJheU91dHB1dFN0cmVhbSgpO1xuICAgIGNvbnN0IGJpdE91dCA9IGJpdE91dHB1dFN0cmVhbShieXRlT3V0KTtcblxuICAgIC8vIGNsZWFyIGNvZGVcbiAgICBiaXRPdXQud3JpdGUoY2xlYXJDb2RlLCBiaXRMZW5ndGgpO1xuXG4gICAgbGV0IGRhdGFJbmRleCA9IDA7XG5cbiAgICBsZXQgcyA9IFN0cmluZy5mcm9tQ2hhckNvZGUoX2RhdGFbZGF0YUluZGV4XSk7XG4gICAgZGF0YUluZGV4ICs9IDE7XG5cbiAgICB3aGlsZSAoZGF0YUluZGV4IDwgX2RhdGEubGVuZ3RoKSB7XG5cbiAgICAgIGNvbnN0IGMgPSBTdHJpbmcuZnJvbUNoYXJDb2RlKF9kYXRhW2RhdGFJbmRleF0pO1xuICAgICAgZGF0YUluZGV4ICs9IDE7XG5cbiAgICAgIGlmICh0YWJsZS5jb250YWlucyhzICsgYykgKSB7XG5cbiAgICAgICAgcyA9IHMgKyBjO1xuXG4gICAgICB9IGVsc2Uge1xuXG4gICAgICAgIGJpdE91dC53cml0ZSh0YWJsZS5pbmRleE9mKHMpLCBiaXRMZW5ndGgpO1xuXG4gICAgICAgIGlmICh0YWJsZS5zaXplKCkgPCAweGZmZikge1xuXG4gICAgICAgICAgaWYgKHRhYmxlLnNpemUoKSA9PSAoMSA8PCBiaXRMZW5ndGgpICkge1xuICAgICAgICAgICAgYml0TGVuZ3RoICs9IDE7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGFibGUuYWRkKHMgKyBjKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHMgPSBjO1xuICAgICAgfVxuICAgIH1cblxuICAgIGJpdE91dC53cml0ZSh0YWJsZS5pbmRleE9mKHMpLCBiaXRMZW5ndGgpO1xuXG4gICAgLy8gZW5kIGNvZGVcbiAgICBiaXRPdXQud3JpdGUoZW5kQ29kZSwgYml0TGVuZ3RoKTtcblxuICAgIGJpdE91dC5mbHVzaCgpO1xuXG4gICAgcmV0dXJuIGJ5dGVPdXQudG9CeXRlQXJyYXkoKTtcbiAgfTtcblxuICBjb25zdCBsendUYWJsZSA9IGZ1bmN0aW9uKCkge1xuXG4gICAgY29uc3QgX21hcCA9IHt9O1xuICAgIGxldCBfc2l6ZSA9IDA7XG5cbiAgICBjb25zdCBfdGhpcyA9IHt9O1xuXG4gICAgX3RoaXMuYWRkID0gZnVuY3Rpb24oa2V5KSB7XG4gICAgICBpZiAoX3RoaXMuY29udGFpbnMoa2V5KSApIHtcbiAgICAgICAgdGhyb3cgJ2R1cCBrZXk6JyArIGtleTtcbiAgICAgIH1cbiAgICAgIF9tYXBba2V5XSA9IF9zaXplO1xuICAgICAgX3NpemUgKz0gMTtcbiAgICB9O1xuXG4gICAgX3RoaXMuc2l6ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIF9zaXplO1xuICAgIH07XG5cbiAgICBfdGhpcy5pbmRleE9mID0gZnVuY3Rpb24oa2V5KSB7XG4gICAgICByZXR1cm4gX21hcFtrZXldO1xuICAgIH07XG5cbiAgICBfdGhpcy5jb250YWlucyA9IGZ1bmN0aW9uKGtleSkge1xuICAgICAgcmV0dXJuIHR5cGVvZiBfbWFwW2tleV0gIT0gJ3VuZGVmaW5lZCc7XG4gICAgfTtcblxuICAgIHJldHVybiBfdGhpcztcbiAgfTtcblxuICByZXR1cm4gX3RoaXM7XG59O1xuXG5jb25zdCBjcmVhdGVEYXRhVVJMID0gZnVuY3Rpb24od2lkdGgsIGhlaWdodCwgZ2V0UGl4ZWwpIHtcbiAgY29uc3QgZ2lmID0gZ2lmSW1hZ2Uod2lkdGgsIGhlaWdodCk7XG4gIGZvciAobGV0IHkgPSAwOyB5IDwgaGVpZ2h0OyB5ICs9IDEpIHtcbiAgICBmb3IgKGxldCB4ID0gMDsgeCA8IHdpZHRoOyB4ICs9IDEpIHtcbiAgICAgIGdpZi5zZXRQaXhlbCh4LCB5LCBnZXRQaXhlbCh4LCB5KSApO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGIgPSBieXRlQXJyYXlPdXRwdXRTdHJlYW0oKTtcbiAgZ2lmLndyaXRlKGIpO1xuXG4gIGNvbnN0IGJhc2U2NCA9IGJhc2U2NEVuY29kZU91dHB1dFN0cmVhbSgpO1xuICBjb25zdCBieXRlcyA9IGIudG9CeXRlQXJyYXkoKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGJhc2U2NC53cml0ZUJ5dGUoYnl0ZXNbaV0pO1xuICB9XG4gIGJhc2U2NC5mbHVzaCgpO1xuXG4gIHJldHVybiAnZGF0YTppbWFnZS9naWY7YmFzZTY0LCcgKyBiYXNlNjQ7XG59O1xuXG5leHBvcnQgZGVmYXVsdCBxcmNvZGU7XG5cbmV4cG9ydCBjb25zdCBzdHJpbmdUb0J5dGVzID0gcXJjb2RlLnN0cmluZ1RvQnl0ZXM7XG4iLCAiLy8gZmVhdHVyZXMvdnNhLXFyLnRzIFx1MjAxMyBWU0EgUVIgQ29kZSBHZW5lcmF0b3JcblxuaW1wb3J0IHsgbG9nLCBlcnIsIGVzYywgd2l0aFJldHJ5LCBnZXRDU1JGVG9rZW4gfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcbmltcG9ydCB7IG9uRGlzcG9zZSB9IGZyb20gJy4uL2NvcmUvdXRpbHMnO1xuaW1wb3J0IHR5cGUgeyBBcHBDb25maWcgfSBmcm9tICcuLi9jb3JlL3N0b3JhZ2UnO1xuaW1wb3J0IHR5cGUgeyBDb21wYW55Q29uZmlnIH0gZnJvbSAnLi4vY29yZS9hcGknO1xuaW1wb3J0IHFyY29kZSBmcm9tICdxcmNvZGUtZ2VuZXJhdG9yJztcblxuaW50ZXJmYWNlIFZlaGljbGVEYXRhIHtcbiAgdmluOiBzdHJpbmc7XG4gIHJlZ2lzdHJhdGlvbk5vOiBzdHJpbmc7XG4gIHN0YXRpb25Db2RlOiBzdHJpbmc7XG4gIHN0YXR1czogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgVnNhUXJHZW5lcmF0b3Ige1xuICBwcml2YXRlIF9vdmVybGF5RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX2FjdGl2ZSA9IGZhbHNlO1xuICBwcml2YXRlIF92ZWhpY2xlczogVmVoaWNsZURhdGFbXSA9IFtdO1xuICBwcml2YXRlIF9zZWxlY3RlZFZpbnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSBfbG9hZGluZyA9IGZhbHNlO1xuICBwcml2YXRlIF9wYWdlU2l6ZSA9IDI1O1xuICBwcml2YXRlIF9jdXJyZW50UGFnZSA9IDE7XG4gIHByaXZhdGUgX3NlYXJjaFRlcm0gPSAnJztcbiAgcHJpdmF0ZSBfc2VhcmNoVGltZXI6IFJldHVyblR5cGU8dHlwZW9mIHNldFRpbWVvdXQ+IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX3NvcnRDb2x1bW46ICdyZWdpc3RyYXRpb25ObycgfCAndmluJyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9zb3J0QXNjID0gdHJ1ZTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogQXBwQ29uZmlnLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGFueUNvbmZpZzogQ29tcGFueUNvbmZpZyxcbiAgKSB7fVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBMaWZlY3ljbGUgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgaW5pdCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5fb3ZlcmxheUVsKSByZXR1cm47XG5cbiAgICBjb25zdCBvdmVybGF5ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgb3ZlcmxheS5pZCA9ICdjdC12c2Etb3ZlcmxheSc7XG4gICAgb3ZlcmxheS5jbGFzc05hbWUgPSAnY3Qtb3ZlcmxheSc7XG4gICAgb3ZlcmxheS5zZXRBdHRyaWJ1dGUoJ3JvbGUnLCAnZGlhbG9nJyk7XG4gICAgb3ZlcmxheS5zZXRBdHRyaWJ1dGUoJ2FyaWEtbW9kYWwnLCAndHJ1ZScpO1xuICAgIG92ZXJsYXkuc2V0QXR0cmlidXRlKCdhcmlhLWxhYmVsJywgJ1ZTQSBRUiBDb2RlIEdlbmVyYXRvcicpO1xuICAgIG92ZXJsYXkuaW5uZXJIVE1MID0gYFxuICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS1wYW5lbFwiPlxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtdnNhLWhlYWRlclwiPlxuICAgICAgICAgIDxkaXY+XG4gICAgICAgICAgICA8aDI+XHVEODNEXHVEQ0YxIFZTQSBRUiBDb2RlIEdlbmVyYXRvcjwvaDI+XG4gICAgICAgICAgICA8ZGl2IGlkPVwiY3QtdnNhLWFzb2ZcIiBzdHlsZT1cImZvbnQtc2l6ZToxMXB4O2NvbG9yOnZhcigtLWN0LW11dGVkKTttYXJnaW4tdG9wOjJweDtcIj48L2Rpdj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tY2xvc2VcIiBpZD1cImN0LXZzYS1jbG9zZVwiIGFyaWEtbGFiZWw9XCJTY2hsaWVcdTAwREZlblwiPlx1MjcxNSBTY2hsaWVcdTAwREZlbjwvYnV0dG9uPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBpZD1cImN0LXZzYS1zdGF0dXNcIiBjbGFzcz1cImN0LXN0YXR1c1wiIHJvbGU9XCJzdGF0dXNcIiBhcmlhLWxpdmU9XCJwb2xpdGVcIj48L2Rpdj5cbiAgICAgICAgPGRpdiBpZD1cImN0LXZzYS10aWxlc1wiPjwvZGl2PlxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtdnNhLXRvb2xiYXJcIj5cbiAgICAgICAgICA8aW5wdXQgdHlwZT1cInRleHRcIiBjbGFzcz1cImN0LWlucHV0IGN0LXZzYS1zZWFyY2hcIiBpZD1cImN0LXZzYS1zZWFyY2hcIlxuICAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcj1cIlN1Y2hlIG5hY2ggS2VubnplaWNoZW4sIFZJTiBvZGVyIFN0YXRpb25cdTIwMjZcIiBhcmlhLWxhYmVsPVwiRmFocnpldWdlIGZpbHRlcm5cIj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtdnNhLXNlbGVjdGlvbi1pbmZvXCIgaWQ9XCJjdC12c2Etc2VsZWN0aW9uLWluZm9cIj48L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgaWQ9XCJjdC12c2EtYm9keVwiPjwvZGl2PlxuICAgICAgICA8ZGl2IGNsYXNzPVwiY3QtdnNhLWZvb3RlclwiIGlkPVwiY3QtdnNhLWZvb3RlclwiPlxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1hY2NlbnRcIiBpZD1cImN0LXZzYS1wcmludFwiIGRpc2FibGVkPlx1RDgzRFx1RERBOCBBdXNnZXdcdTAwRTRobHRlIGRydWNrZW48L2J1dHRvbj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cImN0LXZzYS1zZWxlY3Rpb24tYmFkZ2VcIiBpZD1cImN0LXZzYS1iYWRnZVwiPjAgYXVzZ2V3XHUwMEU0aGx0PC9zcGFuPlxuICAgICAgICA8L2Rpdj5cbiAgICAgIDwvZGl2PlxuICAgIGA7XG5cbiAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG92ZXJsYXkpO1xuICAgIHRoaXMuX292ZXJsYXlFbCA9IG92ZXJsYXk7XG5cbiAgICAvLyBFdmVudCBiaW5kaW5nc1xuICAgIG92ZXJsYXkuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoZSkgPT4geyBpZiAoZS50YXJnZXQgPT09IG92ZXJsYXkpIHRoaXMuaGlkZSgpOyB9KTtcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLWNsb3NlJykhLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5oaWRlKCkpO1xuICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC12c2EtcHJpbnQnKSEuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLl9wcmludFNlbGVjdGVkKCkpO1xuXG4gICAgY29uc3Qgc2VhcmNoSW5wdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLXNlYXJjaCcpIGFzIEhUTUxJbnB1dEVsZW1lbnQ7XG4gICAgc2VhcmNoSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcignaW5wdXQnLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fc2VhcmNoVGltZXIpIGNsZWFyVGltZW91dCh0aGlzLl9zZWFyY2hUaW1lcik7XG4gICAgICB0aGlzLl9zZWFyY2hUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aGlzLl9zZWFyY2hUZXJtID0gc2VhcmNoSW5wdXQudmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRQYWdlID0gMTtcbiAgICAgICAgdGhpcy5fcmVuZGVyQm9keSgpO1xuICAgICAgfSwgMzAwKTtcbiAgICB9KTtcblxuICAgIG92ZXJsYXkuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIChlKSA9PiB7XG4gICAgICBpZiAoZS5rZXkgPT09ICdFc2NhcGUnKSB0aGlzLmhpZGUoKTtcbiAgICB9KTtcblxuICAgIG9uRGlzcG9zZSgoKSA9PiB0aGlzLmRpc3Bvc2UoKSk7XG4gICAgbG9nKCdWU0EgUVIgR2VuZXJhdG9yIGluaXRpYWxpemVkJyk7XG4gIH1cblxuICBkaXNwb3NlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLl9zZWFyY2hUaW1lcikgY2xlYXJUaW1lb3V0KHRoaXMuX3NlYXJjaFRpbWVyKTtcbiAgICB0aGlzLl9vdmVybGF5RWw/LnJlbW92ZSgpO1xuICAgIHRoaXMuX292ZXJsYXlFbCA9IG51bGw7XG4gICAgdGhpcy5fdmVoaWNsZXMgPSBbXTtcbiAgICB0aGlzLl9zZWxlY3RlZFZpbnMuY2xlYXIoKTtcbiAgICB0aGlzLl9hY3RpdmUgPSBmYWxzZTtcbiAgICB0aGlzLl9sb2FkaW5nID0gZmFsc2U7XG4gIH1cblxuICB0b2dnbGUoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmNvbmZpZy5mZWF0dXJlcy52c2FRcikge1xuICAgICAgYWxlcnQoJ1ZTQSBRUiBDb2RlIEdlbmVyYXRvciBpc3QgZGVha3RpdmllcnQuIEJpdHRlIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGFrdGl2aWVyZW4uJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuaW5pdCgpO1xuICAgIGlmICh0aGlzLl9hY3RpdmUpIHRoaXMuaGlkZSgpOyBlbHNlIHRoaXMuc2hvdygpO1xuICB9XG5cbiAgc2hvdygpOiB2b2lkIHtcbiAgICB0aGlzLmluaXQoKTtcbiAgICB0aGlzLl9vdmVybGF5RWwhLmNsYXNzTGlzdC5hZGQoJ3Zpc2libGUnKTtcbiAgICB0aGlzLl9hY3RpdmUgPSB0cnVlO1xuICAgIHRoaXMuX2N1cnJlbnRQYWdlID0gMTtcbiAgICB0aGlzLl9zZWFyY2hUZXJtID0gJyc7XG4gICAgdGhpcy5fc29ydENvbHVtbiA9IG51bGw7XG4gICAgdGhpcy5fc29ydEFzYyA9IHRydWU7XG4gICAgY29uc3Qgc2VhcmNoSW5wdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLXNlYXJjaCcpIGFzIEhUTUxJbnB1dEVsZW1lbnQgfCBudWxsO1xuICAgIGlmIChzZWFyY2hJbnB1dCkgc2VhcmNoSW5wdXQudmFsdWUgPSAnJztcbiAgICB0aGlzLl9yZWZyZXNoKCk7XG4gIH1cblxuICBoaWRlKCk6IHZvaWQge1xuICAgIHRoaXMuX292ZXJsYXlFbD8uY2xhc3NMaXN0LnJlbW92ZSgndmlzaWJsZScpO1xuICAgIHRoaXMuX2FjdGl2ZSA9IGZhbHNlO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEFQSSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIF9mZXRjaFZlaGljbGVzKCk6IFByb21pc2U8dW5rbm93bj4ge1xuICAgIGNvbnN0IHVybCA9ICdodHRwczovL2xvZ2lzdGljcy5hbWF6b24uZGUvZmxlZXQtbWFuYWdlbWVudC9hcGkvdmVoaWNsZXM/dmVoaWNsZVN0YXR1c2VzPUFDVElWRSxNQUlOVEVOQU5DRSxQRU5ESU5HJztcbiAgICBjb25zdCBjc3JmID0gZ2V0Q1NSRlRva2VuKCk7XG4gICAgY29uc3QgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHsgQWNjZXB0OiAnYXBwbGljYXRpb24vanNvbicgfTtcbiAgICBpZiAoY3NyZikgaGVhZGVyc1snYW50aS1jc3JmdG9rZW4tYTJ6J10gPSBjc3JmO1xuXG4gICAgY29uc3QgcmVzcCA9IGF3YWl0IHdpdGhSZXRyeShhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByID0gYXdhaXQgZmV0Y2godXJsLCB7IG1ldGhvZDogJ0dFVCcsIGhlYWRlcnMsIGNyZWRlbnRpYWxzOiAnaW5jbHVkZScgfSk7XG4gICAgICBpZiAoIXIub2spIHRocm93IG5ldyBFcnJvcihgSFRUUCAke3Iuc3RhdHVzfTogJHtyLnN0YXR1c1RleHR9YCk7XG4gICAgICByZXR1cm4gcjtcbiAgICB9LCB7IHJldHJpZXM6IDIsIGJhc2VNczogODAwIH0pO1xuXG4gICAgcmV0dXJuIHJlc3AuanNvbigpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIERhdGEgcHJvY2Vzc2luZyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIF9wcm9jZXNzUmVzcG9uc2UoanNvbjogdW5rbm93bik6IFZlaGljbGVEYXRhW10ge1xuICAgIGlmICghanNvbiB8fCB0eXBlb2YganNvbiAhPT0gJ29iamVjdCcpIHJldHVybiBbXTtcblxuICAgIGxldCB2ZWhpY2xlTGlzdDogdW5rbm93bltdO1xuICAgIGlmIChBcnJheS5pc0FycmF5KGpzb24pKSB7XG4gICAgICB2ZWhpY2xlTGlzdCA9IGpzb247XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG9iaiA9IGpzb24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICB2ZWhpY2xlTGlzdCA9IChvYmpbJ3ZlaGljbGVzJ10gfHwgb2JqWydkYXRhJ10gfHwgb2JqWydjb250ZW50J10gfHwgW10pIGFzIHVua25vd25bXTtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheSh2ZWhpY2xlTGlzdCkpIHtcbiAgICAgICAgZm9yIChjb25zdCB2YWwgb2YgT2JqZWN0LnZhbHVlcyhvYmopKSB7XG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsKSAmJiB2YWwubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdmVoaWNsZUxpc3QgPSB2YWw7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodmVoaWNsZUxpc3QpKSByZXR1cm4gW107XG5cbiAgICByZXR1cm4gdmVoaWNsZUxpc3RcbiAgICAgIC5tYXAoKHY6IHVua25vd24pID0+IHtcbiAgICAgICAgaWYgKCF2IHx8IHR5cGVvZiB2ICE9PSAnb2JqZWN0JykgcmV0dXJuIG51bGw7XG4gICAgICAgIGNvbnN0IHJlYyA9IHYgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICAgIGNvbnN0IHZpbiA9IFN0cmluZyhyZWNbJ3ZpbiddID8/ICcnKS50cmltKCk7XG4gICAgICAgIGNvbnN0IHJlZ2lzdHJhdGlvbk5vID0gU3RyaW5nKHJlY1sncmVnaXN0cmF0aW9uTm8nXSA/PyByZWNbJ2xpY2Vuc2VQbGF0ZSddID8/IHJlY1sncmVnaXN0cmF0aW9uX25vJ10gPz8gJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3Qgc3RhdGlvbkNvZGUgPSBTdHJpbmcocmVjWydzdGF0aW9uQ29kZSddID8/IHJlY1snc3RhdGlvbl9jb2RlJ10gPz8gcmVjWydzdGF0aW9uJ10gPz8gJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gU3RyaW5nKHJlY1sndmVoaWNsZVN0YXR1cyddID8/IHJlY1snc3RhdHVzJ10gPz8gJ0FDVElWRScpLnRyaW0oKTtcbiAgICAgICAgaWYgKCF2aW4pIHJldHVybiBudWxsO1xuICAgICAgICByZXR1cm4geyB2aW4sIHJlZ2lzdHJhdGlvbk5vLCBzdGF0aW9uQ29kZSwgc3RhdHVzIH0gYXMgVmVoaWNsZURhdGE7XG4gICAgICB9KVxuICAgICAgLmZpbHRlcigodik6IHYgaXMgVmVoaWNsZURhdGEgPT4gdiAhPT0gbnVsbCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgUmVmcmVzaCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIF9yZWZyZXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLl9sb2FkaW5nKSByZXR1cm47XG4gICAgdGhpcy5fbG9hZGluZyA9IHRydWU7XG4gICAgdGhpcy5fdmVoaWNsZXMgPSBbXTtcbiAgICB0aGlzLl9zZWxlY3RlZFZpbnMuY2xlYXIoKTtcblxuICAgIHRoaXMuX3NldFN0YXR1cygnXHUyM0YzIExhZGUgRmFocnpldWdkYXRlblx1MjAyNicpO1xuICAgIHRoaXMuX3NldFRpbGVzKCcnKTtcbiAgICB0aGlzLl9zZXRCb2R5KCc8ZGl2IGNsYXNzPVwiY3QtdnNhLWxvYWRpbmdcIiByb2xlPVwic3RhdHVzXCI+RmFocnpldWdkYXRlbiB3ZXJkZW4gZ2VsYWRlblx1MjAyNjwvZGl2PicpO1xuICAgIHRoaXMuX3VwZGF0ZUZvb3RlcigpO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGpzb24gPSBhd2FpdCB0aGlzLl9mZXRjaFZlaGljbGVzKCk7XG4gICAgICBjb25zdCB2ZWhpY2xlcyA9IHRoaXMuX3Byb2Nlc3NSZXNwb25zZShqc29uKTtcblxuICAgICAgaWYgKHZlaGljbGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aGlzLl9zZXRCb2R5KCc8ZGl2IGNsYXNzPVwiY3QtdnNhLWVtcHR5XCI+S2VpbmUgRmFocnpldWdlIGdlZnVuZGVuLjwvZGl2PicpO1xuICAgICAgICB0aGlzLl9zZXRTdGF0dXMoJ1x1MjZBMFx1RkUwRiBLZWluZSBGYWhyemV1Z2UgdmVyZlx1MDBGQ2diYXIuJyk7XG4gICAgICAgIHRoaXMuX2xvYWRpbmcgPSBmYWxzZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB0aGlzLl92ZWhpY2xlcyA9IHZlaGljbGVzO1xuXG4gICAgICAvLyBBdXRvLXNlbGVjdCBhbGwgdmVoaWNsZXNcbiAgICAgIGZvciAoY29uc3QgdiBvZiB2ZWhpY2xlcykge1xuICAgICAgICB0aGlzLl9zZWxlY3RlZFZpbnMuYWRkKHYudmluKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5fc2V0U3RhdHVzKGBcdTI3MDUgJHt2ZWhpY2xlcy5sZW5ndGh9IEZhaHJ6ZXVnZSBnZWxhZGVuYCk7XG5cbiAgICAgIGNvbnN0IGFzT2ZFbCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC12c2EtYXNvZicpO1xuICAgICAgaWYgKGFzT2ZFbCkge1xuICAgICAgICBjb25zdCBmZXRjaGVkQXQgPSBuZXcgRGF0ZSgpLnRvTG9jYWxlU3RyaW5nKCdkZS1ERScsIHtcbiAgICAgICAgICB0aW1lWm9uZTogJ0V1cm9wZS9CZXJsaW4nLCBkYXk6ICcyLWRpZ2l0JywgbW9udGg6ICcyLWRpZ2l0JywgeWVhcjogJ251bWVyaWMnLFxuICAgICAgICAgIGhvdXI6ICcyLWRpZ2l0JywgbWludXRlOiAnMi1kaWdpdCcsXG4gICAgICAgIH0pO1xuICAgICAgICBhc09mRWwudGV4dENvbnRlbnQgPSBgU3RhbmQ6ICR7ZmV0Y2hlZEF0fWA7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuX3JlbmRlclRpbGVzKCk7XG4gICAgICB0aGlzLl9yZW5kZXJCb2R5KCk7XG4gICAgICB0aGlzLl91cGRhdGVGb290ZXIoKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBlcnIoJ1ZTQSBRUiB2ZWhpY2xlIGZldGNoIGZhaWxlZDonLCBlKTtcbiAgICAgIHRoaXMuX3NldEJvZHkoYDxkaXYgY2xhc3M9XCJjdC12c2EtZXJyb3JcIiByb2xlPVwiYWxlcnRcIj5cbiAgICAgICAgXHUyNzRDIEZhaHJ6ZXVnZGF0ZW4ga29ubnRlbiBuaWNodCBnZWxhZGVuIHdlcmRlbi48YnI+XG4gICAgICAgIDxzbWFsbD4ke2VzYygoZSBhcyBFcnJvcikubWVzc2FnZSl9PC9zbWFsbD48YnI+PGJyPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tYWNjZW50XCIgaWQ9XCJjdC12c2EtcmV0cnlcIj5cdUQ4M0RcdUREMDQgRXJuZXV0IHZlcnN1Y2hlbjwvYnV0dG9uPlxuICAgICAgPC9kaXY+YCk7XG4gICAgICB0aGlzLl9zZXRTdGF0dXMoJ1x1Mjc0QyBGZWhsZXIgYmVpbSBMYWRlbi4nKTtcbiAgICAgIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC12c2EtcmV0cnknKT8uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLl9yZWZyZXNoKCkpO1xuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9sb2FkaW5nID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBfc2V0U3RhdHVzKG1zZzogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLXN0YXR1cycpO1xuICAgIGlmIChlbCkgZWwudGV4dENvbnRlbnQgPSBtc2c7XG4gIH1cblxuICBwcml2YXRlIF9zZXRCb2R5KGh0bWw6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGVsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LXZzYS1ib2R5Jyk7XG4gICAgaWYgKGVsKSBlbC5pbm5lckhUTUwgPSBodG1sO1xuICB9XG5cbiAgcHJpdmF0ZSBfc2V0VGlsZXMoaHRtbDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgZWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLXRpbGVzJyk7XG4gICAgaWYgKGVsKSBlbC5pbm5lckhUTUwgPSBodG1sO1xuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0RmlsdGVyZWRWZWhpY2xlcygpOiBWZWhpY2xlRGF0YVtdIHtcbiAgICBsZXQgbGlzdCA9IHRoaXMuX3ZlaGljbGVzO1xuXG4gICAgaWYgKHRoaXMuX3NlYXJjaFRlcm0pIHtcbiAgICAgIGNvbnN0IHRlcm0gPSB0aGlzLl9zZWFyY2hUZXJtO1xuICAgICAgbGlzdCA9IGxpc3QuZmlsdGVyKCh2KSA9PlxuICAgICAgICB2LnJlZ2lzdHJhdGlvbk5vLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXModGVybSkgfHxcbiAgICAgICAgdi52aW4udG9Mb3dlckNhc2UoKS5pbmNsdWRlcyh0ZXJtKSB8fFxuICAgICAgICB2LnN0YXRpb25Db2RlLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXModGVybSkgfHxcbiAgICAgICAgdi5zdGF0dXMudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyh0ZXJtKSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3NvcnRDb2x1bW4pIHtcbiAgICAgIGNvbnN0IGNvbCA9IHRoaXMuX3NvcnRDb2x1bW47XG4gICAgICBjb25zdCBkaXIgPSB0aGlzLl9zb3J0QXNjID8gMSA6IC0xO1xuICAgICAgbGlzdCA9IFsuLi5saXN0XS5zb3J0KChhLCBiKSA9PiBhW2NvbF0ubG9jYWxlQ29tcGFyZShiW2NvbF0pICogZGlyKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbGlzdDtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBUaWxlcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIF9yZW5kZXJUaWxlcygpOiB2b2lkIHtcbiAgICBjb25zdCB0b3RhbCA9IHRoaXMuX3ZlaGljbGVzLmxlbmd0aDtcbiAgICBjb25zdCBzZWxlY3RlZCA9IHRoaXMuX3NlbGVjdGVkVmlucy5zaXplO1xuICAgIGNvbnN0IHN0YXRpb25zID0gbmV3IFNldCh0aGlzLl92ZWhpY2xlcy5tYXAoKHYpID0+IHYuc3RhdGlvbkNvZGUpKS5zaXplO1xuICAgIHRoaXMuX3NldFRpbGVzKGBcbiAgICAgIDxkaXYgY2xhc3M9XCJjdC12c2EtdGlsZXNcIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlXCI+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlLXZhbFwiPiR7dG90YWx9PC9kaXY+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlLWxibFwiPkZhaHJ6ZXVnZSBnZXNhbXQ8L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJjdC12c2EtdGlsZSBjdC12c2EtdGlsZS0tYWNjZW50XCI+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlLXZhbFwiPiR7c2VsZWN0ZWR9PC9kaXY+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlLWxibFwiPkF1c2dld1x1MDBFNGhsdDwvZGl2PlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlXCI+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlLXZhbFwiPiR7c3RhdGlvbnN9PC9kaXY+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlLWxibFwiPlN0YXRpb25lbjwvZGl2PlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlXCI+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10aWxlLXZhbFwiPiR7ZXNjKHRoaXMuY29tcGFueUNvbmZpZy5nZXREc3BDb2RlKCkpfTwvZGl2PlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJjdC12c2EtdGlsZS1sYmxcIj5EU1AgU2hvcnRjb2RlPC9kaXY+XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9kaXY+XG4gICAgYCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgVGFibGUgUmVuZGVyaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgX3JlbmRlckJvZHkoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLl9vdmVybGF5RWwpIHJldHVybjtcbiAgICBpZiAodGhpcy5fdmVoaWNsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLl9zZXRCb2R5KCc8ZGl2IGNsYXNzPVwiY3QtdnNhLWVtcHR5XCI+S2VpbmUgRmFocnpldWdlIHZlcmZcdTAwRkNnYmFyLjwvZGl2PicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbHRlcmVkID0gdGhpcy5fZ2V0RmlsdGVyZWRWZWhpY2xlcygpO1xuICAgIGNvbnN0IHRvdGFsID0gZmlsdGVyZWQubGVuZ3RoO1xuICAgIGNvbnN0IHRvdGFsUGFnZXMgPSBNYXRoLmNlaWwodG90YWwgLyB0aGlzLl9wYWdlU2l6ZSk7XG5cbiAgICBpZiAodGhpcy5fY3VycmVudFBhZ2UgPiB0b3RhbFBhZ2VzKSB0aGlzLl9jdXJyZW50UGFnZSA9IHRvdGFsUGFnZXMgfHwgMTtcblxuICAgIGNvbnN0IHN0YXJ0ID0gKHRoaXMuX2N1cnJlbnRQYWdlIC0gMSkgKiB0aGlzLl9wYWdlU2l6ZTtcbiAgICBjb25zdCBzbGljZSA9IGZpbHRlcmVkLnNsaWNlKHN0YXJ0LCBzdGFydCArIHRoaXMuX3BhZ2VTaXplKTtcblxuICAgIGNvbnN0IGFsbFZpc2libGVTZWxlY3RlZCA9IHNsaWNlLmxlbmd0aCA+IDAgJiYgc2xpY2UuZXZlcnkoKHYpID0+IHRoaXMuX3NlbGVjdGVkVmlucy5oYXModi52aW4pKTtcblxuICAgIGNvbnN0IHNvcnRJY29uID0gKGNvbDogJ3JlZ2lzdHJhdGlvbk5vJyB8ICd2aW4nKTogc3RyaW5nID0+IHtcbiAgICAgIGlmICh0aGlzLl9zb3J0Q29sdW1uICE9PSBjb2wpIHJldHVybiAnIFx1MjE5NSc7XG4gICAgICByZXR1cm4gdGhpcy5fc29ydEFzYyA/ICcgXHUyMTkxJyA6ICcgXHUyMTkzJztcbiAgICB9O1xuXG4gICAgY29uc3Qgcm93cyA9IHNsaWNlLm1hcCgodiwgaSkgPT4ge1xuICAgICAgY29uc3QgaXNTZWxlY3RlZCA9IHRoaXMuX3NlbGVjdGVkVmlucy5oYXModi52aW4pO1xuICAgICAgY29uc3Qgcm93TnVtID0gc3RhcnQgKyBpICsgMTtcbiAgICAgIGNvbnN0IHN0YXR1c0NscyA9IHYuc3RhdHVzID09PSAnQUNUSVZFJyA/ICdjdC12c2Etc3RhdHVzLS1hY3RpdmUnIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICB2LnN0YXR1cyA9PT0gJ01BSU5URU5BTkNFJyA/ICdjdC12c2Etc3RhdHVzLS1tYWludGVuYW5jZScgOlxuICAgICAgICAgICAgICAgICAgICAgICAgICdjdC12c2Etc3RhdHVzLS1wZW5kaW5nJztcbiAgICAgIHJldHVybiBgPHRyIGNsYXNzPVwiJHtpc1NlbGVjdGVkID8gJ2N0LXZzYS1yb3ctLXNlbGVjdGVkJyA6ICcnfVwiIHJvbGU9XCJyb3dcIj5cbiAgICAgICAgPHRkIGNsYXNzPVwiY3QtdnNhLXRkLWNoZWNrXCI+XG4gICAgICAgICAgPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNsYXNzPVwiY3QtdnNhLWNoZWNrXCIgZGF0YS12aW49XCIke2VzYyh2LnZpbil9XCJcbiAgICAgICAgICAgICAgICAgJHtpc1NlbGVjdGVkID8gJ2NoZWNrZWQnIDogJyd9IGFyaWEtbGFiZWw9XCJGYWhyemV1ZyAke2VzYyh2LnJlZ2lzdHJhdGlvbk5vKX0gYXVzd1x1MDBFNGhsZW5cIj5cbiAgICAgICAgPC90ZD5cbiAgICAgICAgPHRkPiR7cm93TnVtfTwvdGQ+XG4gICAgICAgIDx0ZD4ke2VzYyh2LnN0YXRpb25Db2RlKX08L3RkPlxuICAgICAgICA8dGQ+PHN0cm9uZz4ke2VzYyh2LnJlZ2lzdHJhdGlvbk5vKX08L3N0cm9uZz48L3RkPlxuICAgICAgICA8dGQgY2xhc3M9XCJjdC12c2EtdGQtdmluXCI+JHtlc2Modi52aW4pfTwvdGQ+XG4gICAgICAgIDx0ZD48c3BhbiBjbGFzcz1cIiR7c3RhdHVzQ2xzfVwiPiR7ZXNjKHYuc3RhdHVzKX08L3NwYW4+PC90ZD5cbiAgICAgIDwvdHI+YDtcbiAgICB9KS5qb2luKCcnKTtcblxuICAgIHRoaXMuX3NldEJvZHkoYFxuICAgICAgPGRpdiBjbGFzcz1cImN0LXZzYS10YWJsZS13cmFwXCI+XG4gICAgICAgIDx0YWJsZSBjbGFzcz1cImN0LXRhYmxlIGN0LXZzYS10YWJsZVwiIHJvbGU9XCJncmlkXCI+XG4gICAgICAgICAgPHRoZWFkPjx0cj5cbiAgICAgICAgICAgIDx0aCBzY29wZT1cImNvbFwiIGNsYXNzPVwiY3QtdnNhLXRoLWNoZWNrXCI+XG4gICAgICAgICAgICAgIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cImN0LXZzYS1zZWxlY3QtYWxsXCIgJHthbGxWaXNpYmxlU2VsZWN0ZWQgPyAnY2hlY2tlZCcgOiAnJ31cbiAgICAgICAgICAgICAgICAgICAgIGFyaWEtbGFiZWw9XCJBbGxlIHNpY2h0YmFyZW4gRmFocnpldWdlIGF1c3dcdTAwRTRobGVuXCI+XG4gICAgICAgICAgICA8L3RoPlxuICAgICAgICAgICAgPHRoIHNjb3BlPVwiY29sXCI+IzwvdGg+XG4gICAgICAgICAgICA8dGggc2NvcGU9XCJjb2xcIj5TdGF0aW9uPC90aD5cbiAgICAgICAgICAgIDx0aCBzY29wZT1cImNvbFwiIGNsYXNzPVwiY3QtdnNhLXRoLXNvcnRhYmxlXCIgZGF0YS1zb3J0PVwicmVnaXN0cmF0aW9uTm9cIj5LZW5uemVpY2hlbiR7c29ydEljb24oJ3JlZ2lzdHJhdGlvbk5vJyl9PC90aD5cbiAgICAgICAgICAgIDx0aCBzY29wZT1cImNvbFwiIGNsYXNzPVwiY3QtdnNhLXRoLXNvcnRhYmxlXCIgZGF0YS1zb3J0PVwidmluXCI+VklOJHtzb3J0SWNvbigndmluJyl9PC90aD5cbiAgICAgICAgICAgIDx0aCBzY29wZT1cImNvbFwiPlN0YXR1czwvdGg+XG4gICAgICAgICAgPC90cj48L3RoZWFkPlxuICAgICAgICAgIDx0Ym9keT4ke3Jvd3MgfHwgJzx0cj48dGQgY29sc3Bhbj1cIjZcIiBjbGFzcz1cImN0LXZzYS1lbXB0eVwiPktlaW5lIFRyZWZmZXIgZlx1MDBGQ3IgZGVuIFN1Y2hiZWdyaWZmLjwvdGQ+PC90cj4nfTwvdGJvZHk+XG4gICAgICAgIDwvdGFibGU+XG4gICAgICA8L2Rpdj5cbiAgICAgICR7dGhpcy5fcmVuZGVyUGFnaW5hdGlvbih0b3RhbCwgdGhpcy5fY3VycmVudFBhZ2UsIHRvdGFsUGFnZXMpfVxuICAgIGApO1xuXG4gICAgLy8gRXZlbnQ6IHNlbGVjdCBhbGwgY2hlY2tib3hcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLXNlbGVjdC1hbGwnKT8uYWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgKGUpID0+IHtcbiAgICAgIGNvbnN0IGNoZWNrZWQgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZDtcbiAgICAgIGNvbnN0IHZpc2libGVWaW5zID0gc2xpY2UubWFwKCh2KSA9PiB2LnZpbik7XG4gICAgICBmb3IgKGNvbnN0IHZpbiBvZiB2aXNpYmxlVmlucykge1xuICAgICAgICBpZiAoY2hlY2tlZCkgdGhpcy5fc2VsZWN0ZWRWaW5zLmFkZCh2aW4pO1xuICAgICAgICBlbHNlIHRoaXMuX3NlbGVjdGVkVmlucy5kZWxldGUodmluKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3JlbmRlclRpbGVzKCk7XG4gICAgICB0aGlzLl9yZW5kZXJCb2R5KCk7XG4gICAgICB0aGlzLl91cGRhdGVGb290ZXIoKTtcbiAgICB9KTtcblxuICAgIC8vIEV2ZW50OiBpbmRpdmlkdWFsIGNoZWNrYm94ZXNcbiAgICB0aGlzLl9vdmVybGF5RWwucXVlcnlTZWxlY3RvckFsbCgnLmN0LXZzYS1jaGVjaycpLmZvckVhY2goKGNiKSA9PiB7XG4gICAgICBjYi5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoZSkgPT4ge1xuICAgICAgICBjb25zdCBpbnB1dCA9IGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQ7XG4gICAgICAgIGNvbnN0IHZpbiA9IGlucHV0LmRhdGFzZXRbJ3ZpbiddITtcbiAgICAgICAgaWYgKGlucHV0LmNoZWNrZWQpIHRoaXMuX3NlbGVjdGVkVmlucy5hZGQodmluKTtcbiAgICAgICAgZWxzZSB0aGlzLl9zZWxlY3RlZFZpbnMuZGVsZXRlKHZpbik7XG4gICAgICAgIHRoaXMuX3JlbmRlclRpbGVzKCk7XG4gICAgICAgIHRoaXMuX3VwZGF0ZUZvb3RlcigpO1xuXG4gICAgICAgIC8vIFVwZGF0ZSBcInNlbGVjdCBhbGxcIiBjaGVja2JveCBzdGF0ZVxuICAgICAgICBjb25zdCBzZWxlY3RBbGwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLXNlbGVjdC1hbGwnKSBhcyBIVE1MSW5wdXRFbGVtZW50IHwgbnVsbDtcbiAgICAgICAgaWYgKHNlbGVjdEFsbCkge1xuICAgICAgICAgIHNlbGVjdEFsbC5jaGVja2VkID0gc2xpY2UuZXZlcnkoKHYpID0+IHRoaXMuX3NlbGVjdGVkVmlucy5oYXModi52aW4pKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBFdmVudDogc29ydGFibGUgY29sdW1uIGhlYWRlcnNcbiAgICB0aGlzLl9vdmVybGF5RWwucXVlcnlTZWxlY3RvckFsbCgnLmN0LXZzYS10aC1zb3J0YWJsZScpLmZvckVhY2goKHRoKSA9PiB7XG4gICAgICB0aC5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgICAgY29uc3QgY29sID0gKHRoIGFzIEhUTUxFbGVtZW50KS5kYXRhc2V0Wydzb3J0J10gYXMgJ3JlZ2lzdHJhdGlvbk5vJyB8ICd2aW4nO1xuICAgICAgICBpZiAodGhpcy5fc29ydENvbHVtbiA9PT0gY29sKSB7XG4gICAgICAgICAgdGhpcy5fc29ydEFzYyA9ICF0aGlzLl9zb3J0QXNjO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuX3NvcnRDb2x1bW4gPSBjb2w7XG4gICAgICAgICAgdGhpcy5fc29ydEFzYyA9IHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudFBhZ2UgPSAxO1xuICAgICAgICB0aGlzLl9yZW5kZXJCb2R5KCk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHRoaXMuX2F0dGFjaFBhZ2luYXRpb25IYW5kbGVycygpO1xuICB9XG5cbiAgcHJpdmF0ZSBfcmVuZGVyUGFnaW5hdGlvbih0b3RhbDogbnVtYmVyLCBjdXJyZW50OiBudW1iZXIsIHRvdGFsUGFnZXM6IG51bWJlcik6IHN0cmluZyB7XG4gICAgaWYgKHRvdGFsUGFnZXMgPD0gMSkgcmV0dXJuICcnO1xuICAgIHJldHVybiBgXG4gICAgICA8ZGl2IGNsYXNzPVwiY3QtdnNhLXBhZ2luYXRpb25cIj5cbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXNlY29uZGFyeVwiIGlkPVwiY3QtdnNhLXByZXZcIiAke2N1cnJlbnQgPD0gMSA/ICdkaXNhYmxlZCcgOiAnJ30+XHUyMDM5IFp1clx1MDBGQ2NrPC9idXR0b24+XG4gICAgICAgIDxzcGFuIGNsYXNzPVwiY3QtdnNhLXBhZ2UtaW5mb1wiPlNlaXRlICR7Y3VycmVudH0gLyAke3RvdGFsUGFnZXN9ICgke3RvdGFsfSBGYWhyemV1Z2UpPC9zcGFuPlxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tc2Vjb25kYXJ5XCIgaWQ9XCJjdC12c2EtbmV4dFwiICR7Y3VycmVudCA+PSB0b3RhbFBhZ2VzID8gJ2Rpc2FibGVkJyA6ICcnfT5XZWl0ZXIgXHUyMDNBPC9idXR0b24+XG4gICAgICA8L2Rpdj5gO1xuICB9XG5cbiAgcHJpdmF0ZSBfYXR0YWNoUGFnaW5hdGlvbkhhbmRsZXJzKCk6IHZvaWQge1xuICAgIGNvbnN0IGJvZHkgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLWJvZHknKTtcbiAgICBpZiAoIWJvZHkpIHJldHVybjtcbiAgICBib2R5LnF1ZXJ5U2VsZWN0b3IoJyNjdC12c2EtcHJldicpPy5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9jdXJyZW50UGFnZSA+IDEpIHsgdGhpcy5fY3VycmVudFBhZ2UtLTsgdGhpcy5fcmVuZGVyQm9keSgpOyB9XG4gICAgfSk7XG4gICAgYm9keS5xdWVyeVNlbGVjdG9yKCcjY3QtdnNhLW5leHQnKT8uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XG4gICAgICBjb25zdCBmaWx0ZXJlZCA9IHRoaXMuX2dldEZpbHRlcmVkVmVoaWNsZXMoKTtcbiAgICAgIGNvbnN0IHRwID0gTWF0aC5jZWlsKGZpbHRlcmVkLmxlbmd0aCAvIHRoaXMuX3BhZ2VTaXplKTtcbiAgICAgIGlmICh0aGlzLl9jdXJyZW50UGFnZSA8IHRwKSB7IHRoaXMuX2N1cnJlbnRQYWdlKys7IHRoaXMuX3JlbmRlckJvZHkoKTsgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEZvb3RlciAvIFNlbGVjdGlvbiBVSSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIF91cGRhdGVGb290ZXIoKTogdm9pZCB7XG4gICAgY29uc3QgY291bnQgPSB0aGlzLl9zZWxlY3RlZFZpbnMuc2l6ZTtcbiAgICBjb25zdCBiYWRnZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdjdC12c2EtYmFkZ2UnKTtcbiAgICBjb25zdCBidG4gPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtdnNhLXByaW50JykgYXMgSFRNTEJ1dHRvbkVsZW1lbnQgfCBudWxsO1xuICAgIGlmIChiYWRnZSkgYmFkZ2UudGV4dENvbnRlbnQgPSBgJHtjb3VudH0gdm9uICR7dGhpcy5fdmVoaWNsZXMubGVuZ3RofSBGYWhyemV1Z2UgYXVzZ2V3XHUwMEU0aGx0YDtcbiAgICBpZiAoYnRuKSBidG4uZGlzYWJsZWQgPSBjb3VudCA9PT0gMDtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBRUiBDb2RlIEdlbmVyYXRpb24gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBfZ2VuZXJhdGVRUlN2ZyhkYXRhOiBzdHJpbmcsIGNlbGxTaXplID0gMyk6IHN0cmluZyB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHFyID0gcXJjb2RlKDAsICdIJyk7XG4gICAgICBxci5hZGREYXRhKGRhdGEpO1xuICAgICAgcXIubWFrZSgpO1xuICAgICAgY29uc3QgbW9kdWxlQ291bnQgPSBxci5nZXRNb2R1bGVDb3VudCgpO1xuICAgICAgY29uc3Qgc2l6ZSA9IG1vZHVsZUNvdW50ICogY2VsbFNpemU7XG4gICAgICBsZXQgcGF0aHMgPSAnJztcbiAgICAgIGZvciAobGV0IHJvdyA9IDA7IHJvdyA8IG1vZHVsZUNvdW50OyByb3crKykge1xuICAgICAgICBmb3IgKGxldCBjb2wgPSAwOyBjb2wgPCBtb2R1bGVDb3VudDsgY29sKyspIHtcbiAgICAgICAgICBpZiAocXIuaXNEYXJrKHJvdywgY29sKSkge1xuICAgICAgICAgICAgcGF0aHMgKz0gYE0ke2NvbCAqIGNlbGxTaXplfSwke3JvdyAqIGNlbGxTaXplfWgke2NlbGxTaXplfXYke2NlbGxTaXplfWgkey1jZWxsU2l6ZX16YDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBgPHN2ZyB4bWxucz1cImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIgdmlld0JveD1cIjAgMCAke3NpemV9ICR7c2l6ZX1cIiB3aWR0aD1cIiR7c2l6ZX1cIiBoZWlnaHQ9XCIke3NpemV9XCIgc2hhcGUtcmVuZGVyaW5nPVwiY3Jpc3BFZGdlc1wiPjxwYXRoIGQ9XCIke3BhdGhzfVwiIGZpbGw9XCIjMDAwXCIvPjwvc3ZnPmA7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgZXJyKCdRUiBnZW5lcmF0aW9uIGZhaWxlZCBmb3I6JywgZGF0YSwgZSk7XG4gICAgICByZXR1cm4gYDxkaXYgc3R5bGU9XCJ3aWR0aDoxMjBweDtoZWlnaHQ6MTIwcHg7Ym9yZGVyOjFweCBzb2xpZCAjY2NjO2Rpc3BsYXk6ZmxleDthbGlnbi1pdGVtczpjZW50ZXI7anVzdGlmeS1jb250ZW50OmNlbnRlcjtmb250LXNpemU6MTBweDtjb2xvcjojOTk5O1wiPlFSIEVycm9yPC9kaXY+YDtcbiAgICB9XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgUHJpbnQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBfcHJpbnRTZWxlY3RlZCgpOiB2b2lkIHtcbiAgICBjb25zdCBzZWxlY3RlZFZlaGljbGVzID0gdGhpcy5fdmVoaWNsZXMuZmlsdGVyKCh2KSA9PiB0aGlzLl9zZWxlY3RlZFZpbnMuaGFzKHYudmluKSk7XG4gICAgaWYgKHNlbGVjdGVkVmVoaWNsZXMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICBjb25zdCBkc3BDb2RlID0gdGhpcy5jb21wYW55Q29uZmlnLmdldERzcENvZGUoKTtcbiAgICBjb25zdCBwZXJQYWdlID0gODtcblxuICAgIC8vIEJ1aWxkIHBhZ2VzICg4IHBlciBESU4gQTQgcGFnZSBcdTIwMTQgMiBjb2x1bW5zIFx1MDBENyA0IHJvd3MpXG4gICAgY29uc3QgcGFnZXM6IHN0cmluZ1tdID0gW107XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzZWxlY3RlZFZlaGljbGVzLmxlbmd0aDsgaSArPSBwZXJQYWdlKSB7XG4gICAgICBjb25zdCBwYWdlVmVoaWNsZXMgPSBzZWxlY3RlZFZlaGljbGVzLnNsaWNlKGksIGkgKyBwZXJQYWdlKTtcbiAgICAgIGNvbnN0IHBhZ2VGcmFtZXMgPSBwYWdlVmVoaWNsZXMubWFwKCh2KSA9PiB7XG4gICAgICAgIGNvbnN0IHFyU3ZnID0gdGhpcy5fZ2VuZXJhdGVRUlN2Zyh2LnZpbiwgMyk7XG4gICAgICAgIHJldHVybiBgXG4gICAgICAgICAgPGRpdiBjbGFzcz1cInZlaGljbGUtZnJhbWVcIj5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ0aXRsZVwiPiR7ZXNjKHYuc3RhdGlvbkNvZGUpfTwvZGl2PlxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cInNob3J0Y29kZVwiPiR7ZXNjKGRzcENvZGUpfTwvZGl2PlxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImxpY2Vuc2UtcGxhdGVcIj5MaWNlbnNlIFBsYXRlOiA8c3BhbiBjbGFzcz1cImJvbGQtdGV4dFwiPiR7ZXNjKHYucmVnaXN0cmF0aW9uTm8pfTwvc3Bhbj48L2Rpdj5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ2aW5cIj5WSU46IDxzcGFuIGNsYXNzPVwiYm9sZC10ZXh0XCI+JHtlc2Modi52aW4pfTwvc3Bhbj48L2Rpdj5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJxci1jb2RlXCI+JHtxclN2Z308L2Rpdj5cbiAgICAgICAgICA8L2Rpdj5gO1xuICAgICAgfSkuam9pbignXFxuJyk7XG4gICAgICBwYWdlcy5wdXNoKGA8ZGl2IGNsYXNzPVwicHJpbnQtcGFnZVwiPiR7cGFnZUZyYW1lc308L2Rpdj5gKTtcbiAgICB9XG5cbiAgICBjb25zdCBwcmludEhUTUwgPSBgPCFET0NUWVBFIGh0bWw+XG48aHRtbCBsYW5nPVwiZGVcIj5cbjxoZWFkPlxuICA8bWV0YSBjaGFyc2V0PVwiVVRGLThcIj5cbiAgPHRpdGxlPlZTQSBRUiBDb2RlcyBcdTIwMTMgJHtlc2MoZHNwQ29kZSl9PC90aXRsZT5cbiAgPHN0eWxlPlxuICAgIEBwYWdlIHtcbiAgICAgIHNpemU6IEE0IHBvcnRyYWl0O1xuICAgICAgbWFyZ2luOiAxMG1tO1xuICAgIH1cbiAgICAqIHsgYm94LXNpemluZzogYm9yZGVyLWJveDsgbWFyZ2luOiAwOyBwYWRkaW5nOiAwOyB9XG4gICAgYm9keSB7XG4gICAgICBmb250LWZhbWlseTogJ0FtYXpvbiBFbWJlcicsIEFyaWFsLCBzYW5zLXNlcmlmO1xuICAgICAgLXdlYmtpdC1wcmludC1jb2xvci1hZGp1c3Q6IGV4YWN0O1xuICAgICAgcHJpbnQtY29sb3ItYWRqdXN0OiBleGFjdDtcbiAgICB9XG5cbiAgICAucHJpbnQtcGFnZSB7XG4gICAgICBkaXNwbGF5OiBmbGV4O1xuICAgICAgZmxleC13cmFwOiB3cmFwO1xuICAgICAganVzdGlmeS1jb250ZW50OiBjZW50ZXI7XG4gICAgICBhbGlnbi1jb250ZW50OiBmbGV4LXN0YXJ0O1xuICAgICAgZ2FwOiA0cHg7XG4gICAgICBwYWdlLWJyZWFrLWFmdGVyOiBhbHdheXM7XG4gICAgICB3aWR0aDogMTAwJTtcbiAgICAgIG1pbi1oZWlnaHQ6IGNhbGMoMjk3bW0gLSAyMG1tKTtcbiAgICB9XG4gICAgLnByaW50LXBhZ2U6bGFzdC1jaGlsZCB7XG4gICAgICBwYWdlLWJyZWFrLWFmdGVyOiBhdXRvO1xuICAgIH1cblxuICAgIC52ZWhpY2xlLWZyYW1lIHtcbiAgICAgIHdpZHRoOiAzMTBweDtcbiAgICAgIGhlaWdodDogMTg5cHg7XG4gICAgICBib3JkZXI6IDJweCBkYXNoZWQgYmxhY2s7XG4gICAgICBwb3NpdGlvbjogcmVsYXRpdmU7XG4gICAgICBib3gtc2l6aW5nOiBib3JkZXItYm94O1xuICAgICAgYmFja2dyb3VuZC1jb2xvcjogd2hpdGU7XG4gICAgICBmbGV4LXNocmluazogMDtcbiAgICB9XG5cbiAgICAudGl0bGUge1xuICAgICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgICAgdG9wOiAxM3B4O1xuICAgICAgbGVmdDogNDVweDtcbiAgICAgIGZvbnQtc2l6ZTogMTdweDtcbiAgICB9XG4gICAgLnNob3J0Y29kZSB7XG4gICAgICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gICAgICB0b3A6IDQ1cHg7XG4gICAgICBsZWZ0OiAyMHB4O1xuICAgICAgZm9udC1zaXplOiAzNHB4O1xuICAgICAgZm9udC13ZWlnaHQ6IGJvbGQ7XG4gICAgfVxuICAgIC5saWNlbnNlLXBsYXRlIHtcbiAgICAgIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgICAgIHRvcDogMTEzcHg7XG4gICAgICBsZWZ0OiA4cHg7XG4gICAgICBmb250LXNpemU6IDEycHg7XG4gICAgfVxuICAgIC52aW4ge1xuICAgICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgICAgdG9wOiAxMzZweDtcbiAgICAgIGxlZnQ6IDhweDtcbiAgICAgIGZvbnQtc2l6ZTogMTJweDtcbiAgICB9XG4gICAgLmJvbGQtdGV4dCB7XG4gICAgICBmb250LXdlaWdodDogYm9sZDtcbiAgICB9XG4gICAgLnFyLWNvZGUge1xuICAgICAgcG9zaXRpb246IGFic29sdXRlO1xuICAgICAgdG9wOiAxNXB4O1xuICAgICAgcmlnaHQ6IDE1cHg7XG4gICAgICB3aWR0aDogMTIwcHg7XG4gICAgICBoZWlnaHQ6IDEyMHB4O1xuICAgICAgb3ZlcmZsb3c6IGhpZGRlbjtcbiAgICB9XG4gICAgLnFyLWNvZGUgc3ZnIHtcbiAgICAgIHdpZHRoOiAxMDAlO1xuICAgICAgaGVpZ2h0OiAxMDAlO1xuICAgIH1cblxuICAgIEBtZWRpYSBzY3JlZW4ge1xuICAgICAgYm9keSB7IHBhZGRpbmc6IDIwcHg7IGJhY2tncm91bmQ6ICNmMGYwZjA7IH1cbiAgICAgIC5wcmludC1wYWdlIHtcbiAgICAgICAgYmFja2dyb3VuZDogd2hpdGU7XG4gICAgICAgIGJveC1zaGFkb3c6IDAgMnB4IDEwcHggcmdiYSgwLDAsMCwwLjEpO1xuICAgICAgICBwYWRkaW5nOiAxMG1tO1xuICAgICAgICBtYXJnaW4tYm90dG9tOiAyMHB4O1xuICAgICAgICBtaW4taGVpZ2h0OiBhdXRvO1xuICAgICAgfVxuICAgIH1cbiAgPC9zdHlsZT5cbjwvaGVhZD5cbjxib2R5PlxuICAke3BhZ2VzLmpvaW4oJ1xcbicpfVxuICA8c2NyaXB0PlxuICAgIHdpbmRvdy5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7IHdpbmRvdy5wcmludCgpOyB9LCAzMDApO1xuICAgIH07XG4gIDxcXC9zY3JpcHQ+XG48L2JvZHk+XG48L2h0bWw+YDtcblxuICAgIGNvbnN0IHByaW50V2luZG93ID0gd2luZG93Lm9wZW4oJycsICdfYmxhbmsnKTtcbiAgICBpZiAoIXByaW50V2luZG93KSB7XG4gICAgICBhbGVydCgnUG9wdXAtQmxvY2tlciB2ZXJoaW5kZXJ0IGRhcyBcdTAwRDZmZm5lbiBkZXMgRHJ1Y2tmZW5zdGVycy4gQml0dGUgUG9wdXBzIGVybGF1YmVuLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBwcmludFdpbmRvdy5kb2N1bWVudC5vcGVuKCk7XG4gICAgcHJpbnRXaW5kb3cuZG9jdW1lbnQud3JpdGUocHJpbnRIVE1MKTtcbiAgICBwcmludFdpbmRvdy5kb2N1bWVudC5jbG9zZSgpO1xuICB9XG59XG4iLCAiLy8gdWkvY29tcG9uZW50cy50cyBcdTIwMTMgUmV1c2FibGUgVUkgY29tcG9uZW50IGZhY3RvcnkgZnVuY3Rpb25zXHJcblxyXG5pbXBvcnQgeyBlc2MgfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcclxuXHJcbi8vIFx1MjUwMFx1MjUwMCBUb2dnbGUgLyBDaGVja2JveCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbi8qKlxyXG4gKiBSZW5kZXIgYSBsYWJlbGxlZCB0b2dnbGUtc3dpdGNoIHJvdyBmb3IgdGhlIHNldHRpbmdzIGRpYWxvZy5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiB0b2dnbGVIVE1MKGlkOiBzdHJpbmcsIGxhYmVsOiBzdHJpbmcsIGNoZWNrZWQ6IGJvb2xlYW4pOiBzdHJpbmcge1xyXG4gIHJldHVybiBgXHJcbiAgICA8ZGl2IGNsYXNzPVwiY3Qtc2V0dGluZ3Mtcm93XCI+XHJcbiAgICAgIDxsYWJlbCBmb3I9XCIke2VzYyhpZCl9XCI+JHtlc2MobGFiZWwpfTwvbGFiZWw+XHJcbiAgICAgIDxsYWJlbCBjbGFzcz1cImN0LXRvZ2dsZVwiPlxyXG4gICAgICAgIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBpZD1cIiR7ZXNjKGlkKX1cIiAke2NoZWNrZWQgPyAnY2hlY2tlZCcgOiAnJ30+XHJcbiAgICAgICAgPHNwYW4gY2xhc3M9XCJjdC1zbGlkZXJcIj48L3NwYW4+XHJcbiAgICAgIDwvbGFiZWw+XHJcbiAgICA8L2Rpdj5cclxuICBgO1xyXG59XHJcblxyXG4vLyBcdTI1MDBcdTI1MDAgUGFnaW5hdGlvbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgUGFnaW5hdGlvblN0YXRlIHtcclxuICBjdXJyZW50OiBudW1iZXI7XHJcbiAgdG90YWw6IG51bWJlcjtcclxuICBwYWdlU2l6ZTogbnVtYmVyO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFBhZ2luYXRpb25DYWxsYmFja3Mge1xyXG4gIG9uUHJldjogKCkgPT4gdm9pZDtcclxuICBvbk5leHQ6ICgpID0+IHZvaWQ7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBSZW5kZXIgYSBzaW1wbGUgcHJldi9uZXh0IHBhZ2luYXRpb24gYmFyLlxyXG4gKiBAcGFyYW0gd3JhcENsYXNzICBcdTIwMTMgQ1NTIGNsYXNzIHByZWZpeCBzdHJpbmcsIGUuZy4gJ2N0LWR2aWMnXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gcmVuZGVyUGFnaW5hdGlvbihcclxuICBjb250YWluZXI6IEhUTUxFbGVtZW50LFxyXG4gIHBhZ2luYXRpb25DbGFzczogc3RyaW5nLFxyXG4gIHN0YXRlOiBQYWdpbmF0aW9uU3RhdGUsXHJcbiAgY2FsbGJhY2tzOiBQYWdpbmF0aW9uQ2FsbGJhY2tzLFxyXG4pOiB2b2lkIHtcclxuICBjb25zdCB0b3RhbFBhZ2VzID0gTWF0aC5jZWlsKHN0YXRlLnRvdGFsIC8gc3RhdGUucGFnZVNpemUpIHx8IDE7XHJcbiAgY29uc3Qgd3JhcCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xyXG4gIHdyYXAuY2xhc3NOYW1lID0gYCR7cGFnaW5hdGlvbkNsYXNzfS1wYWdpbmF0aW9uYDtcclxuICB3cmFwLmlubmVySFRNTCA9IGBcclxuICAgIDxidXR0b24gY2xhc3M9XCJjdC1idG4gY3QtYnRuLS1zZWNvbmRhcnlcIiBpZD1cIiR7cGFnaW5hdGlvbkNsYXNzfS1wcmV2XCJcclxuICAgICAgICAgICAgJHtzdGF0ZS5jdXJyZW50IDw9IDEgPyAnZGlzYWJsZWQnIDogJyd9Plx1MjVDMCBadXJcdTAwRkNjazwvYnV0dG9uPlxyXG4gICAgPHNwYW4gY2xhc3M9XCIke3BhZ2luYXRpb25DbGFzc30tcGFnZS1pbmZvXCI+XHJcbiAgICAgIFNlaXRlICR7c3RhdGUuY3VycmVudH0gLyAke3RvdGFsUGFnZXN9ICgke3N0YXRlLnRvdGFsfSBFaW50clx1MDBFNGdlKVxyXG4gICAgPC9zcGFuPlxyXG4gICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLXNlY29uZGFyeVwiIGlkPVwiJHtwYWdpbmF0aW9uQ2xhc3N9LW5leHRcIlxyXG4gICAgICAgICAgICAke3N0YXRlLmN1cnJlbnQgPj0gdG90YWxQYWdlcyA/ICdkaXNhYmxlZCcgOiAnJ30+V2VpdGVyIFx1MjVCNjwvYnV0dG9uPlxyXG4gIGA7XHJcbiAgY29udGFpbmVyLmFwcGVuZENoaWxkKHdyYXApO1xyXG4gIHdyYXAucXVlcnlTZWxlY3RvcihgIyR7cGFnaW5hdGlvbkNsYXNzfS1wcmV2YCk/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgY2FsbGJhY2tzLm9uUHJldik7XHJcbiAgd3JhcC5xdWVyeVNlbGVjdG9yKGAjJHtwYWdpbmF0aW9uQ2xhc3N9LW5leHRgKT8uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCBjYWxsYmFja3Mub25OZXh0KTtcclxufVxyXG5cclxuLy8gXHUyNTAwXHUyNTAwIFN1bW1hcnkgdGlsZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFRpbGUge1xyXG4gIHZhbHVlOiBzdHJpbmcgfCBudW1iZXI7XHJcbiAgbGFiZWw6IHN0cmluZztcclxuICBtb2RpZmllckNsYXNzPzogc3RyaW5nO1xyXG59XHJcblxyXG4vKipcclxuICogUmVuZGVyIGEgcm93IG9mIHN0YXQgdGlsZXMuXHJcbiAqIEBwYXJhbSB0aWxlQ2xhc3MgIFx1MjAxMyBDU1MgY2xhc3MgcHJlZml4LCBlLmcuICdjdC1kdmljJ1xyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlclRpbGVzKHRpbGVDbGFzczogc3RyaW5nLCB0aWxlczogVGlsZVtdKTogc3RyaW5nIHtcclxuICBjb25zdCBpbm5lciA9IHRpbGVzLm1hcCgodCkgPT4gYFxyXG4gICAgPGRpdiBjbGFzcz1cIiR7dGlsZUNsYXNzfS10aWxlICR7dC5tb2RpZmllckNsYXNzID8/ICcnfVwiPlxyXG4gICAgICA8ZGl2IGNsYXNzPVwiJHt0aWxlQ2xhc3N9LXRpbGUtdmFsXCI+JHtlc2MoU3RyaW5nKHQudmFsdWUpKX08L2Rpdj5cclxuICAgICAgPGRpdiBjbGFzcz1cIiR7dGlsZUNsYXNzfS10aWxlLWxibFwiPiR7ZXNjKHQubGFiZWwpfTwvZGl2PlxyXG4gICAgPC9kaXY+XHJcbiAgYCkuam9pbignJyk7XHJcbiAgcmV0dXJuIGA8ZGl2IGNsYXNzPVwiJHt0aWxlQ2xhc3N9LXRpbGVzXCI+JHtpbm5lcn08L2Rpdj5gO1xyXG59XHJcblxyXG4vLyBcdTI1MDBcdTI1MDAgTG9hZGluZyAvIEVycm9yIC8gRW1wdHkgc3RhdGVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRpbmdIVE1MKGNzc0NsYXNzOiBzdHJpbmcsIG1zZyA9ICdMYWRlblx1MjAyNicpOiBzdHJpbmcge1xyXG4gIHJldHVybiBgPGRpdiBjbGFzcz1cIiR7Y3NzQ2xhc3N9LWxvYWRpbmdcIiByb2xlPVwic3RhdHVzXCI+JHtlc2MobXNnKX08L2Rpdj5gO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZXJyb3JIVE1MKGNzc0NsYXNzOiBzdHJpbmcsIG1zZzogc3RyaW5nKTogc3RyaW5nIHtcclxuICByZXR1cm4gYDxkaXYgY2xhc3M9XCIke2Nzc0NsYXNzfS1lcnJvclwiIHJvbGU9XCJhbGVydFwiPlx1Mjc0QyAke2VzYyhtc2cpfTwvZGl2PmA7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBlbXB0eUhUTUwoY3NzQ2xhc3M6IHN0cmluZywgbXNnID0gJ0tlaW5lIERhdGVuIGdlZnVuZGVuLicpOiBzdHJpbmcge1xyXG4gIHJldHVybiBgPGRpdiBjbGFzcz1cIiR7Y3NzQ2xhc3N9LWVtcHR5XCI+JHtlc2MobXNnKX08L2Rpdj5gO1xyXG59XHJcbiIsICIvLyBmZWF0dXJlcy9zZXR0aW5ncy50cyBcdTIwMTMgU2V0dGluZ3MgRGlhbG9nXHJcblxyXG5pbXBvcnQgeyBlc2MgfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcclxuaW1wb3J0IHsgc2V0Q29uZmlnIH0gZnJvbSAnLi4vY29yZS9zdG9yYWdlJztcclxuaW1wb3J0IHR5cGUgeyBBcHBDb25maWcgfSBmcm9tICcuLi9jb3JlL3N0b3JhZ2UnO1xyXG5pbXBvcnQgeyB0b2dnbGVIVE1MIH0gZnJvbSAnLi4vdWkvY29tcG9uZW50cyc7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gb3BlblNldHRpbmdzKGNvbmZpZzogQXBwQ29uZmlnKTogdm9pZCB7XHJcbiAgY29uc3QgZXhpc3RpbmcgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2V0dGluZ3Mtb3ZlcmxheScpO1xyXG4gIGlmIChleGlzdGluZykgZXhpc3RpbmcucmVtb3ZlKCk7XHJcblxyXG4gIGNvbnN0IG92ZXJsYXkgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcclxuICBvdmVybGF5LmlkID0gJ2N0LXNldHRpbmdzLW92ZXJsYXknO1xyXG4gIG92ZXJsYXkuY2xhc3NOYW1lID0gJ2N0LW92ZXJsYXkgdmlzaWJsZSc7XHJcblxyXG4gIG92ZXJsYXkuaW5uZXJIVE1MID0gYFxyXG4gICAgPGRpdiBjbGFzcz1cImN0LWRpYWxvZ1wiIHN0eWxlPVwibWluLXdpZHRoOiA0MDBweDtcIj5cclxuICAgICAgPGgzPlx1MjY5OSBFaW5zdGVsbHVuZ2VuPC9oMz5cclxuXHJcbiAgICAgICR7dG9nZ2xlSFRNTCgnY3Qtc2V0LXdoYycsICAnV0hDIERhc2hib2FyZCcsIGNvbmZpZy5mZWF0dXJlcy53aGNEYXNoYm9hcmQpfVxyXG4gICAgICAke3RvZ2dsZUhUTUwoJ2N0LXNldC1kcmUnLCAgJ0RhdGUgUmFuZ2UgRXh0cmFjdG9yJywgY29uZmlnLmZlYXR1cmVzLmRhdGVFeHRyYWN0b3IpfVxyXG4gICAgICAke3RvZ2dsZUhUTUwoJ2N0LXNldC1kcCcsICAgJ0RhaWx5IERlbGl2ZXJ5IFBlcmZvcm1hbmNlJywgY29uZmlnLmZlYXR1cmVzLmRlbGl2ZXJ5UGVyZil9XHJcbiAgICAgICR7dG9nZ2xlSFRNTCgnY3Qtc2V0LWR2aWMnLCAnRFZJQyBDaGVjaycsIGNvbmZpZy5mZWF0dXJlcy5kdmljQ2hlY2spfVxyXG4gICAgICAke3RvZ2dsZUhUTUwoJ2N0LXNldC1kdmljLXRwJywgJ0RWSUM6IFRyYW5zcG9ydGVyLVNwYWx0ZScsIGNvbmZpZy5mZWF0dXJlcy5kdmljU2hvd1RyYW5zcG9ydGVycyl9XHJcbiAgICAgICR7dG9nZ2xlSFRNTCgnY3Qtc2V0LXdoZCcsICAnV29ya2luZyBIb3VycyBEYXNoYm9hcmQnLCBjb25maWcuZmVhdHVyZXMud29ya2luZ0hvdXJzKX1cclxuICAgICAgJHt0b2dnbGVIVE1MKCdjdC1zZXQtcmV0JywgICdSZXR1cm5zIERhc2hib2FyZCcsIGNvbmZpZy5mZWF0dXJlcy5yZXR1cm5zRGFzaGJvYXJkKX1cclxuICAgICAgJHt0b2dnbGVIVE1MKCdjdC1zZXQtc2MnLCAgICdTY29yZWNhcmQnLCBjb25maWcuZmVhdHVyZXMuc2NvcmVjYXJkKX1cclxuICAgICAgJHt0b2dnbGVIVE1MKCdjdC1zZXQtdnNhJywgJ1ZTQSBRUiBDb2RlIEdlbmVyYXRvcicsIGNvbmZpZy5mZWF0dXJlcy52c2FRcil9XHJcbiAgICAgICR7dG9nZ2xlSFRNTCgnY3Qtc2V0LWRldicsICAnRGV2LU1vZGUgKGF1c2ZcdTAwRkNocmxpY2hlcyBMb2dnaW5nKScsIGNvbmZpZy5kZXYpfVxyXG5cclxuICAgICAgPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6IDIwcHg7IGRpc3BsYXk6IGZsZXg7IGdhcDogMTBweDsganVzdGlmeS1jb250ZW50OiBmbGV4LWVuZDtcIj5cclxuICAgICAgICA8YnV0dG9uIGNsYXNzPVwiY3QtYnRuIGN0LWJ0bi0tc2Vjb25kYXJ5XCIgaWQ9XCJjdC1zZXQtY2FuY2VsXCI+QWJicmVjaGVuPC9idXR0b24+XHJcbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImN0LWJ0biBjdC1idG4tLWFjY2VudFwiIGlkPVwiY3Qtc2V0LXNhdmVcIj5TcGVpY2hlcm48L2J1dHRvbj5cclxuICAgICAgPC9kaXY+XHJcbiAgICA8L2Rpdj5cclxuICBgO1xyXG5cclxuICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKG92ZXJsYXkpO1xyXG5cclxuICBvdmVybGF5LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHsgaWYgKGUudGFyZ2V0ID09PSBvdmVybGF5KSBvdmVybGF5LnJlbW92ZSgpOyB9KTtcclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2V0LWNhbmNlbCcpIS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IG92ZXJsYXkucmVtb3ZlKCkpO1xyXG5cclxuICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3Qtc2V0LXNhdmUnKSEuYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB7XHJcbiAgICBjb25zdCBib29sVmFsID0gKGlkOiBzdHJpbmcpOiBib29sZWFuID0+XHJcbiAgICAgIChkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCkgYXMgSFRNTElucHV0RWxlbWVudCkuY2hlY2tlZDtcclxuXHJcbiAgICBjb25maWcuZmVhdHVyZXMud2hjRGFzaGJvYXJkICAgICAgICA9IGJvb2xWYWwoJ2N0LXNldC13aGMnKTtcclxuICAgIGNvbmZpZy5mZWF0dXJlcy5kYXRlRXh0cmFjdG9yICAgICAgID0gYm9vbFZhbCgnY3Qtc2V0LWRyZScpO1xyXG4gICAgY29uZmlnLmZlYXR1cmVzLmRlbGl2ZXJ5UGVyZiAgICAgICAgPSBib29sVmFsKCdjdC1zZXQtZHAnKTtcclxuICAgIGNvbmZpZy5mZWF0dXJlcy5kdmljQ2hlY2sgICAgICAgICAgID0gYm9vbFZhbCgnY3Qtc2V0LWR2aWMnKTtcclxuICAgIGNvbmZpZy5mZWF0dXJlcy5kdmljU2hvd1RyYW5zcG9ydGVycyA9IGJvb2xWYWwoJ2N0LXNldC1kdmljLXRwJyk7XHJcbiAgICBjb25maWcuZmVhdHVyZXMud29ya2luZ0hvdXJzICAgICAgICA9IGJvb2xWYWwoJ2N0LXNldC13aGQnKTtcclxuICAgIGNvbmZpZy5mZWF0dXJlcy5yZXR1cm5zRGFzaGJvYXJkICAgID0gYm9vbFZhbCgnY3Qtc2V0LXJldCcpO1xyXG4gICAgY29uZmlnLmZlYXR1cmVzLnNjb3JlY2FyZCAgICAgICAgICAgPSBib29sVmFsKCdjdC1zZXQtc2MnKTtcclxuICAgIGNvbmZpZy5mZWF0dXJlcy52c2FRciAgICAgICAgICAgICAgID0gYm9vbFZhbCgnY3Qtc2V0LXZzYScpO1xyXG4gICAgY29uZmlnLmRldiAgICAgICAgICAgICAgICAgICAgICAgICAgPSBib29sVmFsKCdjdC1zZXQtZGV2Jyk7XHJcblxyXG4gICAgc2V0Q29uZmlnKGNvbmZpZyk7XHJcbiAgICBvdmVybGF5LnJlbW92ZSgpO1xyXG4gICAgYWxlcnQoJ0VpbnN0ZWxsdW5nZW4gZ2VzcGVpY2hlcnQhIFNlaXRlIG5ldSBsYWRlbiBmXHUwMEZDciB2b2xsc3RcdTAwRTRuZGlnZSBBa3RpdmllcnVuZy4nKTtcclxuICB9KTtcclxufVxyXG4iLCAiLy8gZmVhdHVyZXMvbmF2YmFyLnRzIFx1MjAxMyBOYXZiYXIgaW5qZWN0aW9uIGFuZCBTUEEgbmF2aWdhdGlvbiBoYW5kbGluZ1xyXG5cclxuaW1wb3J0IHsgbG9nLCBlcnIsIG9uRGlzcG9zZSwgd2FpdEZvckVsZW1lbnQgfSBmcm9tICcuLi9jb3JlL3V0aWxzJztcclxuaW1wb3J0IHR5cGUgeyBXaGNEYXNoYm9hcmQgfSBmcm9tICcuL3doYy1kYXNoYm9hcmQnO1xyXG5pbXBvcnQgdHlwZSB7IERhdGVSYW5nZUV4dHJhY3RvciB9IGZyb20gJy4vZGF0ZS1leHRyYWN0b3InO1xyXG5pbXBvcnQgdHlwZSB7IERlbGl2ZXJ5UGVyZm9ybWFuY2UgfSBmcm9tICcuL2RlbGl2ZXJ5LXBlcmZvcm1hbmNlJztcclxuaW1wb3J0IHR5cGUgeyBEdmljQ2hlY2sgfSBmcm9tICcuL2R2aWMtY2hlY2snO1xyXG5pbXBvcnQgdHlwZSB7IFdvcmtpbmdIb3Vyc0Rhc2hib2FyZCB9IGZyb20gJy4vd29ya2luZy1ob3Vycyc7XHJcbmltcG9ydCB0eXBlIHsgUmV0dXJuc0Rhc2hib2FyZCB9IGZyb20gJy4vcmV0dXJucy1kYXNoYm9hcmQnO1xyXG5pbXBvcnQgdHlwZSB7IFNjb3JlY2FyZERhc2hib2FyZCB9IGZyb20gJy4vc2NvcmVjYXJkJztcclxuaW1wb3J0IHR5cGUgeyBWc2FRckdlbmVyYXRvciB9IGZyb20gJy4vdnNhLXFyJztcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgVG9vbFJlZ2lzdHJ5IHtcclxuICB3aGNEYXNoYm9hcmQ6IFdoY0Rhc2hib2FyZDtcclxuICBkYXRlUmFuZ2VFeHRyYWN0b3I6IERhdGVSYW5nZUV4dHJhY3RvcjtcclxuICBkZWxpdmVyeVBlcmZvcm1hbmNlOiBEZWxpdmVyeVBlcmZvcm1hbmNlO1xyXG4gIGR2aWNDaGVjazogRHZpY0NoZWNrO1xyXG4gIHdvcmtpbmdIb3Vyc0Rhc2hib2FyZDogV29ya2luZ0hvdXJzRGFzaGJvYXJkO1xyXG4gIHJldHVybnNEYXNoYm9hcmQ6IFJldHVybnNEYXNoYm9hcmQ7XHJcbiAgc2NvcmVjYXJkRGFzaGJvYXJkOiBTY29yZWNhcmREYXNoYm9hcmQ7XHJcbiAgdnNhUXJHZW5lcmF0b3I6IFZzYVFyR2VuZXJhdG9yO1xyXG4gIG9wZW5TZXR0aW5nczogKCkgPT4gdm9pZDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGluamVjdE5hdkl0ZW0odG9vbHM6IFRvb2xSZWdpc3RyeSk6IHZvaWQge1xyXG4gIHRyeSB7XHJcbiAgICBpZiAoZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LW5hdi1pdGVtJykpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBuYXZMaXN0ID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLmZwLW5hdi1tZW51LWxpc3QnKTtcclxuICAgIGlmICghbmF2TGlzdCkgeyBsb2coJ05hdiBsaXN0IG5vdCBmb3VuZCcpOyByZXR1cm47IH1cclxuXHJcbiAgICBsZXQgc3VwcG9ydEl0ZW06IEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICAgIGNvbnN0IGl0ZW1zID0gQXJyYXkuZnJvbShuYXZMaXN0LnF1ZXJ5U2VsZWN0b3JBbGwoJzpzY29wZSA+IGxpLmZwLW5hdi1tZW51LWxpc3QtaXRlbScpKTtcclxuICAgIGZvciAoY29uc3QgbGkgb2YgaXRlbXMpIHtcclxuICAgICAgY29uc3QgYW5jaG9yID0gbGkucXVlcnlTZWxlY3RvcignOnNjb3BlID4gYScpO1xyXG4gICAgICBpZiAoYW5jaG9yICYmIGFuY2hvci50ZXh0Q29udGVudD8udHJpbSgpLnRvTG93ZXJDYXNlKCkgPT09ICdzdXBwb3J0Jykge1xyXG4gICAgICAgIHN1cHBvcnRJdGVtID0gbGk7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsaSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2xpJyk7XHJcbiAgICBsaS5pZCA9ICdjdC1uYXYtaXRlbSc7XHJcbiAgICBsaS5jbGFzc05hbWUgPSAnZnAtbmF2LW1lbnUtbGlzdC1pdGVtJztcclxuICAgIGxpLmlubmVySFRNTCA9IGBcclxuICAgICAgPGEgaHJlZj1cIiNcIj5Ub29sczwvYT5cclxuICAgICAgPGkgY2xhc3M9XCJmYSBmYS1zb3J0LWRvd24gZmEtMnggZnAtc3ViLW1lbnUtaWNvbiBzaG93XCI+PC9pPlxyXG4gICAgICA8aSBjbGFzcz1cImZhIGZhLXNvcnQtdXAgZmEtMnggZnAtc3ViLW1lbnUtaWNvblwiPjwvaT5cclxuICAgICAgPHVsIGNsYXNzPVwiZnAtc3ViLW1lbnVcIiBhcmlhLWV4cGFuZGVkPVwiZmFsc2VcIiByb2xlPVwibWVudVwiPlxyXG4gICAgICAgIDxsaSBjbGFzcz1cImZwLXN1Yi1tZW51LWxpc3QtaXRlbVwiPlxyXG4gICAgICAgICAgPGEgaHJlZj1cIiNcIiBkYXRhLWN0LXRvb2w9XCJ3aGMtZGFzaGJvYXJkXCI+XHVEODNEXHVEQ0NBIFdIQyBEYXNoYm9hcmQ8L2E+XHJcbiAgICAgICAgPC9saT5cclxuICAgICAgICA8bGkgY2xhc3M9XCJmcC1zdWItbWVudS1saXN0LWl0ZW1cIj5cclxuICAgICAgICAgIDxhIGhyZWY9XCIjXCIgZGF0YS1jdC10b29sPVwiZGVsaXZlcnktcGVyZlwiPlx1RDgzRFx1RENFNiBEYWlseSBEZWxpdmVyeSBQZXJmb3JtYW5jZTwvYT5cclxuICAgICAgICA8L2xpPlxyXG4gICAgICAgIDxsaSBjbGFzcz1cImZwLXN1Yi1tZW51LWxpc3QtaXRlbVwiPlxyXG4gICAgICAgICAgPGEgaHJlZj1cIiNcIiBkYXRhLWN0LXRvb2w9XCJkdmljLWNoZWNrXCI+XHVEODNEXHVERTlCIERWSUMgQ2hlY2s8L2E+XHJcbiAgICAgICAgPC9saT5cclxuICAgICAgICA8bGkgY2xhc3M9XCJmcC1zdWItbWVudS1saXN0LWl0ZW1cIj5cclxuICAgICAgICAgIDxhIGhyZWY9XCIjXCIgZGF0YS1jdC10b29sPVwid29ya2luZy1ob3Vyc1wiPlx1MjNGMSBXb3JraW5nIEhvdXJzPC9hPlxyXG4gICAgICAgIDwvbGk+XHJcbiAgICAgICAgPGxpIGNsYXNzPVwiZnAtc3ViLW1lbnUtbGlzdC1pdGVtXCI+XHJcbiAgICAgICAgICA8YSBocmVmPVwiI1wiIGRhdGEtY3QtdG9vbD1cInJldHVybnNcIj5cdUQ4M0RcdURDRTYgUmV0dXJuczwvYT5cclxuICAgICAgICA8L2xpPlxyXG4gICAgICAgIDxsaSBjbGFzcz1cImZwLXN1Yi1tZW51LWxpc3QtaXRlbVwiPlxyXG4gICAgICAgICAgPGEgaHJlZj1cIiNcIiBkYXRhLWN0LXRvb2w9XCJzY29yZWNhcmRcIj5cdUQ4M0RcdURDQ0IgU2NvcmVjYXJkPC9hPlxyXG4gICAgICAgIDwvbGk+XHJcbiAgICAgICAgPGxpIGNsYXNzPVwiZnAtc3ViLW1lbnUtbGlzdC1pdGVtXCI+XHJcbiAgICAgICAgICA8YSBocmVmPVwiI1wiIGRhdGEtY3QtdG9vbD1cInZzYS1xclwiPlx1RDgzRFx1RENGMSBWU0EgUVIgQ29kZXM8L2E+XHJcbiAgICAgICAgPC9saT5cclxuICAgICAgICA8bGkgY2xhc3M9XCJjdC1kaXZpZGVyXCI+PC9saT5cclxuICAgICAgICA8bGkgY2xhc3M9XCJmcC1zdWItbWVudS1saXN0LWl0ZW1cIj5cclxuICAgICAgICAgIDxhIGhyZWY9XCIjXCIgZGF0YS1jdC10b29sPVwic2V0dGluZ3NcIj5cdTI2OTkgRWluc3RlbGx1bmdlbjwvYT5cclxuICAgICAgICA8L2xpPlxyXG4gICAgICA8L3VsPlxyXG4gICAgYDtcclxuXHJcbiAgICBjb25zdCBzdWJtZW51ID0gbGkucXVlcnlTZWxlY3RvcignLmZwLXN1Yi1tZW51JykhO1xyXG4gICAgc3VibWVudS5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsIChlKSA9PiB7XHJcbiAgICAgIGNvbnN0IGFuY2hvciA9IChlLnRhcmdldCBhcyBFbGVtZW50KS5jbG9zZXN0KCdhW2RhdGEtY3QtdG9vbF0nKSBhcyBIVE1MRWxlbWVudCB8IG51bGw7XHJcbiAgICAgIGlmICghYW5jaG9yKSByZXR1cm47XHJcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgY29uc3QgdG9vbCA9IGFuY2hvci5nZXRBdHRyaWJ1dGUoJ2RhdGEtY3QtdG9vbCcpO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHN3aXRjaCAodG9vbCkge1xyXG4gICAgICAgICAgY2FzZSAnd2hjLWRhc2hib2FyZCc6ICB0b29scy53aGNEYXNoYm9hcmQudG9nZ2xlKCk7IGJyZWFrO1xyXG4gICAgICAgICAgY2FzZSAnZGF0ZS1leHRyYWN0b3InOiB0b29scy5kYXRlUmFuZ2VFeHRyYWN0b3Iuc2hvd0RpYWxvZygpOyBicmVhaztcclxuICAgICAgICAgIGNhc2UgJ2RlbGl2ZXJ5LXBlcmYnOiAgdG9vbHMuZGVsaXZlcnlQZXJmb3JtYW5jZS50b2dnbGUoKTsgYnJlYWs7XHJcbiAgICAgICAgICBjYXNlICdkdmljLWNoZWNrJzogICAgIHRvb2xzLmR2aWNDaGVjay50b2dnbGUoKTsgYnJlYWs7XHJcbiAgICAgICAgICBjYXNlICd3b3JraW5nLWhvdXJzJzogIHRvb2xzLndvcmtpbmdIb3Vyc0Rhc2hib2FyZC50b2dnbGUoKTsgYnJlYWs7XHJcbiAgICAgICAgICBjYXNlICdyZXR1cm5zJzogICAgICAgIHRvb2xzLnJldHVybnNEYXNoYm9hcmQudG9nZ2xlKCk7IGJyZWFrO1xyXG4gICAgICAgICAgY2FzZSAnc2NvcmVjYXJkJzogICAgICB0b29scy5zY29yZWNhcmREYXNoYm9hcmQudG9nZ2xlKCk7IGJyZWFrO1xyXG4gICAgICAgICAgY2FzZSAndnNhLXFyJzogICAgICB0b29scy52c2FRckdlbmVyYXRvci50b2dnbGUoKTsgYnJlYWs7XHJcbiAgICAgICAgICBjYXNlICdzZXR0aW5ncyc6ICAgICAgIHRvb2xzLm9wZW5TZXR0aW5ncygpOyBicmVhaztcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGV4KSB7XHJcbiAgICAgICAgZXJyKCdUb29sIGFjdGlvbiBmYWlsZWQ6JywgdG9vbCwgZXgpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBpZiAoc3VwcG9ydEl0ZW0pIHtcclxuICAgICAgc3VwcG9ydEl0ZW0uYWZ0ZXIobGkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgbmF2TGlzdC5hcHBlbmRDaGlsZChsaSk7XHJcbiAgICB9XHJcblxyXG4gICAgbG9nKCdOYXYgaXRlbSBpbmplY3RlZCcpO1xyXG4gIH0gY2F0Y2ggKGUpIHtcclxuICAgIGVycignRmFpbGVkIHRvIGluamVjdCBuYXYgaXRlbTonLCBlKTtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiB3YXRjaE5hdmlnYXRpb24oZ2V0VG9vbHM6ICgpID0+IFRvb2xSZWdpc3RyeSk6IHZvaWQge1xyXG4gIC8vIExpc3RlbiBmb3IgQ29ydGV4J3MgY3VzdG9tIG5hdmlnYXRpb24gcmVsb2FkIGV2ZW50XHJcbiAgY29uc3QgaGFuZGxlciA9ICgpID0+IHtcclxuICAgIGxvZygnZnAtbmF2aWdhdGlvbi1sb2FkZWQgZXZlbnQnKTtcclxuICAgIHNldFRpbWVvdXQoKCkgPT4gaW5qZWN0TmF2SXRlbShnZXRUb29scygpKSwgMTAwKTtcclxuICB9O1xyXG4gIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2ZwLW5hdmlnYXRpb24tbG9hZGVkJywgaGFuZGxlcik7XHJcbiAgb25EaXNwb3NlKCgpID0+IGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2ZwLW5hdmlnYXRpb24tbG9hZGVkJywgaGFuZGxlcikpO1xyXG5cclxuICAvLyBNdXRhdGlvbk9ic2VydmVyIGZhbGxiYWNrIFx1MjAxNCB3YXRjaCBmb3IgbmF2IGJlaW5nIHJlcGxhY2VkXHJcbiAgY29uc3Qgb2JzID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIoKCkgPT4ge1xyXG4gICAgaWYgKCFkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnY3QtbmF2LWl0ZW0nKSAmJiBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCcuZnAtbmF2LW1lbnUtbGlzdCcpKSB7XHJcbiAgICAgIGluamVjdE5hdkl0ZW0oZ2V0VG9vbHMoKSk7XHJcbiAgICB9XHJcbiAgfSk7XHJcbiAgY29uc3QgbmF2Q29udGFpbmVyID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcignLmZwLW5hdmlnYXRpb24tY29udGFpbmVyJykgfHwgZG9jdW1lbnQuYm9keTtcclxuICBvYnMub2JzZXJ2ZShuYXZDb250YWluZXIsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xyXG4gIG9uRGlzcG9zZSgoKSA9PiBvYnMuZGlzY29ubmVjdCgpKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIExpc3RlbiBmb3IgU1BBIFVSTCBjaGFuZ2VzIGJ5IHBhdGNoaW5nIGhpc3RvcnkgQVBJIGFuZCBvYnNlcnZpbmcgRE9NIG11dGF0aW9ucy5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBvblVybENoYW5nZShjYjogKHVybDogc3RyaW5nKSA9PiB2b2lkKTogdm9pZCB7XHJcbiAgbGV0IGxhc3QgPSBsb2NhdGlvbi5ocmVmO1xyXG4gIG5ldyBNdXRhdGlvbk9ic2VydmVyKCgpID0+IHtcclxuICAgIGlmIChsb2NhdGlvbi5ocmVmICE9PSBsYXN0KSB7IGxhc3QgPSBsb2NhdGlvbi5ocmVmOyBjYihsb2NhdGlvbi5ocmVmKTsgfVxyXG4gIH0pLm9ic2VydmUoZG9jdW1lbnQsIHsgc3VidHJlZTogdHJ1ZSwgY2hpbGRMaXN0OiB0cnVlIH0pO1xyXG5cclxuICBmb3IgKGNvbnN0IG1ldGhvZCBvZiBbJ3B1c2hTdGF0ZScsICdyZXBsYWNlU3RhdGUnXSBhcyBjb25zdCkge1xyXG4gICAgY29uc3Qgb3JpZyA9IGhpc3RvcnlbbWV0aG9kXTtcclxuICAgIChoaXN0b3J5IGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pW21ldGhvZF0gPSBmdW5jdGlvbiAodGhpczogSGlzdG9yeSwgLi4uYXJnczogUGFyYW1ldGVyczx0eXBlb2Ygb3JpZz4pIHtcclxuICAgICAgY29uc3QgcmV0ID0gb3JpZy5hcHBseSh0aGlzLCBhcmdzKTtcclxuICAgICAgd2luZG93LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCdsb2NhdGlvbmNoYW5nZScpKTtcclxuICAgICAgcmV0dXJuIHJldDtcclxuICAgIH07XHJcbiAgfVxyXG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdwb3BzdGF0ZScsICgpID0+IHdpbmRvdy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbG9jYXRpb25jaGFuZ2UnKSkpO1xyXG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdsb2NhdGlvbmNoYW5nZScsICgpID0+IGNiKGxvY2F0aW9uLmhyZWYpKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEluaXRpYWxpc2UgbmF2YmFyIGFuZCBsb2FkIGNvbXBhbnkgY29uZmlnLlxyXG4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGJvb3QoXHJcbiAgdG9vbHM6IFRvb2xSZWdpc3RyeSxcclxuICBjb21wYW55Q29uZmlnTG9hZDogKCkgPT4gUHJvbWlzZTx2b2lkPixcclxuICB1cmw6IHN0cmluZyA9IGxvY2F0aW9uLmhyZWYsXHJcbik6IFByb21pc2U8dm9pZD4ge1xyXG4gIGxvZygnQm9vdCBmb3InLCB1cmwpO1xyXG4gIGluamVjdE5hdkl0ZW0odG9vbHMpO1xyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBjb21wYW55Q29uZmlnTG9hZCgpO1xyXG4gICAgbG9nKCdDb21wYW55IGNvbmZpZyBsb2FkZWQnKTtcclxuICB9IGNhdGNoIChlKSB7XHJcbiAgICBlcnIoJ0NvbXBhbnkgY29uZmlnIGxvYWQgZmFpbGVkOicsIGUpO1xyXG4gIH1cclxufVxyXG4iLCAiLyoqXHJcbiAqIENvcnRleCBUb29scyBcdTIwMTMgTWFpbiBFbnRyeSBQb2ludFxyXG4gKlxyXG4gKiBCb290c3RyYXBzIGFsbCBtb2R1bGVzIGFmdGVyIHRoZSBuYXYgaXMgcmVhZHksIHJlZ2lzdGVycyBHTSBtZW51IGNvbW1hbmRzLFxyXG4gKiBhbmQgd2lyZXMgdXAgdGhlIFNQQSBuYXZpZ2F0aW9uIGxpc3RlbmVyLlxyXG4gKi9cclxuXHJcbi8vIFx1MjUwMFx1MjUwMCBDb3JlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5pbXBvcnQgeyBnZXRDb25maWcsIHNldENvbmZpZyB9IGZyb20gJy4vY29yZS9zdG9yYWdlJztcclxuaW1wb3J0IHsgaW5pdExvZ2dpbmcsIGxvZywgZXJyLCBkaXNwb3NlQWxsLCB3YWl0Rm9yRWxlbWVudCB9IGZyb20gJy4vY29yZS91dGlscyc7XHJcbmltcG9ydCB7IENvbXBhbnlDb25maWcgfSBmcm9tICcuL2NvcmUvYXBpJztcclxuXHJcbi8vIFx1MjUwMFx1MjUwMCBVSSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuaW1wb3J0IHsgaW5qZWN0U3R5bGVzIH0gZnJvbSAnLi91aS9zdHlsZXMnO1xyXG5cclxuLy8gXHUyNTAwXHUyNTAwIEZlYXR1cmVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5pbXBvcnQgeyBXaGNEYXNoYm9hcmQgfSBmcm9tICcuL2ZlYXR1cmVzL3doYy1kYXNoYm9hcmQnO1xyXG5pbXBvcnQgeyBEYXRlUmFuZ2VFeHRyYWN0b3IgfSBmcm9tICcuL2ZlYXR1cmVzL2RhdGUtZXh0cmFjdG9yJztcclxuaW1wb3J0IHsgRGVsaXZlcnlQZXJmb3JtYW5jZSB9IGZyb20gJy4vZmVhdHVyZXMvZGVsaXZlcnktcGVyZm9ybWFuY2UnO1xyXG5pbXBvcnQgeyBEdmljQ2hlY2sgfSBmcm9tICcuL2ZlYXR1cmVzL2R2aWMtY2hlY2snO1xyXG5pbXBvcnQgeyBXb3JraW5nSG91cnNEYXNoYm9hcmQgfSBmcm9tICcuL2ZlYXR1cmVzL3dvcmtpbmctaG91cnMnO1xyXG5pbXBvcnQgeyBSZXR1cm5zRGFzaGJvYXJkIH0gZnJvbSAnLi9mZWF0dXJlcy9yZXR1cm5zLWRhc2hib2FyZCc7XHJcbmltcG9ydCB7IFNjb3JlY2FyZERhc2hib2FyZCB9IGZyb20gJy4vZmVhdHVyZXMvc2NvcmVjYXJkJztcclxuaW1wb3J0IHsgVnNhUXJHZW5lcmF0b3IgfSBmcm9tICcuL2ZlYXR1cmVzL3ZzYS1xcic7XHJcbmltcG9ydCB7IG9wZW5TZXR0aW5ncyB9IGZyb20gJy4vZmVhdHVyZXMvc2V0dGluZ3MnO1xyXG5pbXBvcnQgeyBpbmplY3ROYXZJdGVtLCB3YXRjaE5hdmlnYXRpb24sIG9uVXJsQ2hhbmdlLCBib290IH0gZnJvbSAnLi9mZWF0dXJlcy9uYXZiYXInO1xyXG5cclxuLy8gXHUyNTAwXHUyNTAwIEJvb3RzdHJhcCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbihmdW5jdGlvbiAoKSB7XHJcbiAgJ3VzZSBzdHJpY3QnO1xyXG5cclxuICAvLyBSZWFkIGNvbmZpZyBcdTIwMTQgYmFpbCBvdXQgaWYgdGhlIHNjcmlwdCBpcyBkaXNhYmxlZFxyXG4gIGxldCBjb25maWcgPSBnZXRDb25maWcoKTtcclxuICBpZiAoIWNvbmZpZy5lbmFibGVkKSByZXR1cm47XHJcblxyXG4gIC8vIEluaXRpYWxpc2UgbG9nZ2luZyB3aXRoIHRoZSBsb2FkZWQgY29uZmlnXHJcbiAgaW5pdExvZ2dpbmcoY29uZmlnKTtcclxuICBsb2coJ0NvcnRleCBUb29scyBsb2FkaW5nXHUyMDI2Jyk7XHJcblxyXG4gIC8vIEluamVjdCBhbGwgQ1NTIHVwIGZyb250XHJcbiAgaW5qZWN0U3R5bGVzKCk7XHJcblxyXG4gIC8vIENyZWF0ZSB0aGUgY2VudHJhbGlzZWQgY29tcGFueSBjb25maWcgLyBEU1AgcmVzb2x2ZXIgKHNpbmdsZXRvbiBmb3Igc2Vzc2lvbilcclxuICBjb25zdCBjb21wYW55Q29uZmlnID0gbmV3IENvbXBhbnlDb25maWcoY29uZmlnKTtcclxuXHJcbiAgLy8gSW5zdGFudGlhdGUgYWxsIGZlYXR1cmUgbW9kdWxlc1xyXG4gIGNvbnN0IHdoY0Rhc2hib2FyZCAgICAgICAgICA9IG5ldyBXaGNEYXNoYm9hcmQoY29uZmlnLCBjb21wYW55Q29uZmlnKTtcclxuICBjb25zdCBkYXRlUmFuZ2VFeHRyYWN0b3IgICAgPSBuZXcgRGF0ZVJhbmdlRXh0cmFjdG9yKGNvbmZpZywgY29tcGFueUNvbmZpZyk7XHJcbiAgY29uc3QgZGVsaXZlcnlQZXJmb3JtYW5jZSAgID0gbmV3IERlbGl2ZXJ5UGVyZm9ybWFuY2UoY29uZmlnLCBjb21wYW55Q29uZmlnKTtcclxuICBjb25zdCBkdmljQ2hlY2sgICAgICAgICAgICAgPSBuZXcgRHZpY0NoZWNrKGNvbmZpZywgY29tcGFueUNvbmZpZyk7XHJcbiAgY29uc3Qgd29ya2luZ0hvdXJzRGFzaGJvYXJkID0gbmV3IFdvcmtpbmdIb3Vyc0Rhc2hib2FyZChjb25maWcsIGNvbXBhbnlDb25maWcpO1xyXG4gIGNvbnN0IHJldHVybnNEYXNoYm9hcmQgICAgICA9IG5ldyBSZXR1cm5zRGFzaGJvYXJkKGNvbmZpZywgY29tcGFueUNvbmZpZyk7XHJcbiAgY29uc3Qgc2NvcmVjYXJkRGFzaGJvYXJkICAgID0gbmV3IFNjb3JlY2FyZERhc2hib2FyZChjb25maWcsIGNvbXBhbnlDb25maWcpO1xyXG4gIGNvbnN0IHZzYVFyR2VuZXJhdG9yICAgICAgICA9IG5ldyBWc2FRckdlbmVyYXRvcihjb25maWcsIGNvbXBhbnlDb25maWcpO1xyXG5cclxuICAvLyBTZXR0aW5ncyBjYWxsYmFjayBtdXN0IHJlLXJlYWQgdGhlIG11dGF0ZWQgY29uZmlnIG9iamVjdFxyXG4gIGNvbnN0IGhhbmRsZU9wZW5TZXR0aW5ncyA9ICgpID0+IHtcclxuICAgIC8vIFJlbG9hZCBjb25maWcgZnJvbSBzdG9yYWdlIHNvIHRoZSBkaWFsb2cgcmVmbGVjdHMgdGhlIGxhdGVzdCBwZXJzaXN0ZWQgdmFsdWVzXHJcbiAgICBjb25maWcgPSBnZXRDb25maWcoKTtcclxuICAgIG9wZW5TZXR0aW5ncyhjb25maWcpO1xyXG4gIH07XHJcblxyXG4gIGNvbnN0IHRvb2xzID0ge1xyXG4gICAgd2hjRGFzaGJvYXJkLFxyXG4gICAgZGF0ZVJhbmdlRXh0cmFjdG9yLFxyXG4gICAgZGVsaXZlcnlQZXJmb3JtYW5jZSxcclxuICAgIGR2aWNDaGVjayxcclxuICAgIHdvcmtpbmdIb3Vyc0Rhc2hib2FyZCxcclxuICAgIHJldHVybnNEYXNoYm9hcmQsXHJcbiAgICBzY29yZWNhcmREYXNoYm9hcmQsXHJcbiAgICB2c2FRckdlbmVyYXRvcixcclxuICAgIG9wZW5TZXR0aW5nczogaGFuZGxlT3BlblNldHRpbmdzLFxyXG4gIH07XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBUYW1wZXJtb25rZXkgTWVudSBDb21tYW5kcyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuICBHTV9yZWdpc3Rlck1lbnVDb21tYW5kKCdcdUQ4M0RcdURDQ0EgV0hDIERhc2hib2FyZCcsICAgICAgICAgICAgICAoKSA9PiB3aGNEYXNoYm9hcmQudG9nZ2xlKCkpO1xyXG4gIEdNX3JlZ2lzdGVyTWVudUNvbW1hbmQoJ1x1RDgzRFx1RENDNSBEYXRlIFJhbmdlIEV4dHJhY3RvcicsICAgICAgICgpID0+IGRhdGVSYW5nZUV4dHJhY3Rvci5zaG93RGlhbG9nKCkpO1xyXG4gIEdNX3JlZ2lzdGVyTWVudUNvbW1hbmQoJ1x1RDgzRFx1RENFNiBEYWlseSBEZWxpdmVyeSBQZXJmb3JtYW5jZScsICgpID0+IGRlbGl2ZXJ5UGVyZm9ybWFuY2UudG9nZ2xlKCkpO1xyXG4gIEdNX3JlZ2lzdGVyTWVudUNvbW1hbmQoJ1x1RDgzRFx1REU5QiBEVklDIENoZWNrJywgICAgICAgICAgICAgICAgICgpID0+IGR2aWNDaGVjay50b2dnbGUoKSk7XHJcbiAgR01fcmVnaXN0ZXJNZW51Q29tbWFuZCgnXHUyM0YxIFdvcmtpbmcgSG91cnMnLCAgICAgICAgICAgICAgKCkgPT4gd29ya2luZ0hvdXJzRGFzaGJvYXJkLnRvZ2dsZSgpKTtcclxuICBHTV9yZWdpc3Rlck1lbnVDb21tYW5kKCdcdUQ4M0RcdURDRTYgUmV0dXJucyBEYXNoYm9hcmQnLCAgICAgICAgICAoKSA9PiByZXR1cm5zRGFzaGJvYXJkLnRvZ2dsZSgpKTtcclxuICBHTV9yZWdpc3Rlck1lbnVDb21tYW5kKCdcdUQ4M0RcdURDQ0IgU2NvcmVjYXJkJywgICAgICAgICAgICAgICAgICAoKSA9PiBzY29yZWNhcmREYXNoYm9hcmQudG9nZ2xlKCkpO1xyXG4gIEdNX3JlZ2lzdGVyTWVudUNvbW1hbmQoJ1x1RDgzRFx1RENGMSBWU0EgUVIgQ29kZXMnLCAgICAgICAgICAgICAgICAoKSA9PiB2c2FRckdlbmVyYXRvci50b2dnbGUoKSk7XHJcbiAgR01fcmVnaXN0ZXJNZW51Q29tbWFuZCgnXHUyNjk5IEVpbnN0ZWxsdW5nZW4nLCAgICAgICAgICAgICAgIGhhbmRsZU9wZW5TZXR0aW5ncyk7XHJcbiAgR01fcmVnaXN0ZXJNZW51Q29tbWFuZCgnXHUyM0Y4IFNrcmlwdCBwYXVzaWVyZW4nLCAoKSA9PiB7XHJcbiAgICBjb25maWcuZW5hYmxlZCA9IGZhbHNlO1xyXG4gICAgc2V0Q29uZmlnKGNvbmZpZyk7XHJcbiAgICBkaXNwb3NlQWxsKCk7XHJcbiAgICBjb25zdCBuYXZJdGVtID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LW5hdi1pdGVtJyk7XHJcbiAgICBpZiAobmF2SXRlbSkgbmF2SXRlbS5yZW1vdmUoKTtcclxuICAgIGFsZXJ0KCdDb3J0ZXggVG9vbHMgcGF1c2llcnQuIFNlaXRlIG5ldSBsYWRlbiB6dW0gUmVha3RpdmllcmVuLicpO1xyXG4gIH0pO1xyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgSW5pdGlhbCBib290OiB3YWl0IGZvciBuYXYsIHRoZW4gaW5qZWN0IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG4gIHdhaXRGb3JFbGVtZW50KCcuZnAtbmF2LW1lbnUtbGlzdCcpXHJcbiAgICAudGhlbigoKSA9PiB7XHJcbiAgICAgIGJvb3QodG9vbHMsICgpID0+IGNvbXBhbnlDb25maWcubG9hZCgpKTtcclxuICAgICAgd2F0Y2hOYXZpZ2F0aW9uKCgpID0+IHRvb2xzKTtcclxuICAgIH0pXHJcbiAgICAuY2F0Y2goKGUpID0+IHtcclxuICAgICAgZXJyKCdOYXYgbm90IGZvdW5kLCByZXRyeWluZy4uLicsIGUpO1xyXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICBpbmplY3ROYXZJdGVtKHRvb2xzKTtcclxuICAgICAgICB3YXRjaE5hdmlnYXRpb24oKCkgPT4gdG9vbHMpO1xyXG4gICAgICB9LCAzMDAwKTtcclxuICAgIH0pO1xyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgUmUtaW5qZWN0IG5hdiBpdGVtIG9uIFNQQSBuYXZpZ2F0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG4gIG9uVXJsQ2hhbmdlKCh1cmwpID0+IHtcclxuICAgIGxvZygnVVJMIGNoYW5nZWQ6JywgdXJsKTtcclxuICAgIGlmICghZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2N0LW5hdi1pdGVtJykpIHtcclxuICAgICAgaW5qZWN0TmF2SXRlbSh0b29scyk7XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIGxvZygnQ29ydGV4IFRvb2xzIGxvYWRlZCcpO1xyXG59KSgpO1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUF1Qk8sTUFBTSxXQUFzQjtBQUFBLElBQ2pDLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLGVBQWU7QUFBQSxJQUNmLHFCQUFxQjtBQUFBLElBQ3JCLGlCQUFpQjtBQUFBLElBQ2pCLFVBQVU7QUFBQSxNQUNSLGNBQWM7QUFBQSxNQUNkLGVBQWU7QUFBQSxNQUNmLGNBQWM7QUFBQSxNQUNkLFdBQVc7QUFBQSxNQUNYLHNCQUFzQjtBQUFBLE1BQ3RCLGNBQWM7QUFBQSxNQUNkLGtCQUFrQjtBQUFBLE1BQ2xCLFdBQVc7QUFBQSxNQUNYLE9BQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUVBLE1BQU0sYUFBYTtBQUVaLFdBQVMsWUFBdUI7QUFDckMsVUFBTSxNQUFNLFlBQVksWUFBWSxJQUFJO0FBQ3hDLFFBQUksQ0FBQztBQUFLLGFBQU8sS0FBSyxNQUFNLEtBQUssVUFBVSxRQUFRLENBQUM7QUFDcEQsUUFBSTtBQUNGLFlBQU0sUUFBNEIsT0FBTyxRQUFRLFdBQVcsS0FBSyxNQUFNLEdBQUcsSUFBSTtBQUM5RSxhQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxHQUFHO0FBQUEsUUFDSCxVQUFVLEVBQUUsR0FBRyxTQUFTLFVB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QUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQStMakIsTUFBTSxvQkFBb0I7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBOEcxQixNQUFNLFdBQVc7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFrSGpCLE1BQU0sb0JBQW9CO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFtRTFCLE1BQU0sY0FBYztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUE0SXBCLE1BQU0sZ0JBQWdCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtB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QUFJLENBQUM7QUFBQTtBQUFBLE1BR1QsQ0FBQyxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ1YsQ0FBQyxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ1YsQ0FBQyxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ1YsQ0FBQyxHQUFHLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHVixDQUFDLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDVixDQUFDLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDVixDQUFDLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDVixDQUFDLEdBQUcsSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUdWLENBQUMsR0FBRyxLQUFLLEVBQUU7QUFBQSxNQUNYLENBQUMsR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNWLENBQUMsR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNWLENBQUMsR0FBRyxJQUFJLENBQUM7QUFBQTtBQUFBLE1BR1QsQ0FBQyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ1osQ0FBQyxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ1YsQ0FBQyxHQUFHLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ3JCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQTtBQUFBLE1BR3JCLENBQUMsR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNWLENBQUMsR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNWLENBQUMsR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNWLENBQUMsR0FBRyxJQUFJLEVBQUU7QUFBQTtBQUFBLE1BR1YsQ0FBQyxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ1YsQ0FBQyxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ1YsQ0FBQyxHQUFHLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ3JCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQTtBQUFBLE1BR3JCLENBQUMsR0FBRyxLQUFLLEVBQUU7QUFBQSxNQUNYLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNyQixDQUFDLEdBQUcsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDckIsQ0FBQyxHQUFHLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHckIsQ0FBQyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ1osQ0FBQyxHQUFHLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ3JCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNyQixDQUFDLEdBQUcsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUdyQixDQUFDLEdBQUcsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDckIsQ0FBQyxHQUFHLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ3JCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNyQixDQUFDLEdBQUcsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUdyQixDQUFDLEdBQUcsS0FBSyxFQUFFO0FBQUEsTUFDWCxDQUFDLEdBQUcsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDckIsQ0FBQyxHQUFHLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ3JCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQTtBQUFBLE1BR3JCLENBQUMsR0FBRyxLQUFLLElBQUksR0FBRyxLQUFLLEVBQUU7QUFBQSxNQUN2QixDQUFDLEdBQUcsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDckIsQ0FBQyxHQUFHLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBLE1BQ3JCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQTtBQUFBLE1BR3JCLENBQUMsR0FBRyxLQUFLLEdBQUc7QUFBQSxNQUNaLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNyQixDQUFDLEdBQUcsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDckIsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNyQixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHLEtBQUssRUFBRTtBQUFBLE1BQ3ZCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNyQixDQUFDLEdBQUcsSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDckIsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssSUFBSSxHQUFHLEtBQUssRUFBRTtBQUFBLE1BQ3ZCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNyQixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsR0FBRyxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUNyQixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsR0FBRyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsR0FBRyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdkIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUNYLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUd0QixDQUFDLEdBQUcsS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHO0FBQUEsTUFDekIsQ0FBQyxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ1gsQ0FBQyxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ3RCLENBQUMsSUFBSSxJQUFJLEVBQUU7QUFBQTtBQUFBLE1BR1gsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsR0FBRyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsTUFDdkIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdkIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsR0FBRyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsTUFDdkIsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsR0FBRyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdkIsQ0FBQyxJQUFJLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQzFCLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxJQUFJLElBQUksSUFBSSxHQUFHLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdEIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdkIsQ0FBQyxHQUFHLEtBQUssS0FBSyxJQUFJLEtBQUssR0FBRztBQUFBLE1BQzFCLENBQUMsR0FBRyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdkIsQ0FBQyxHQUFHLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQ3pCLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdkIsQ0FBQyxHQUFHLEtBQUssS0FBSyxJQUFJLEtBQUssR0FBRztBQUFBLE1BQzFCLENBQUMsSUFBSSxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN2QixDQUFDLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUEsTUFDdkIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdkIsQ0FBQyxJQUFJLEtBQUssS0FBSyxHQUFHLEtBQUssR0FBRztBQUFBLE1BQzFCLENBQUMsR0FBRyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUEsTUFDdEIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBO0FBQUEsTUFHdkIsQ0FBQyxJQUFJLEtBQUssR0FBRztBQUFBLE1BQ2IsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ3ZCLENBQUMsSUFBSSxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN2QixDQUFDLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUd2QixDQUFDLElBQUksS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHO0FBQUEsTUFDMUIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ3ZCLENBQUMsSUFBSSxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN2QixDQUFDLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUd2QixDQUFDLElBQUksS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHO0FBQUEsTUFDMUIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ3ZCLENBQUMsSUFBSSxJQUFJLElBQUksR0FBRyxJQUFJLEVBQUU7QUFBQSxNQUN0QixDQUFDLElBQUksSUFBSSxJQUFJLEdBQUcsSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUd0QixDQUFDLElBQUksS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHO0FBQUEsTUFDMUIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ3ZCLENBQUMsSUFBSSxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN2QixDQUFDLElBQUksSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUd2QixDQUFDLEdBQUcsS0FBSyxLQUFLLElBQUksS0FBSyxHQUFHO0FBQUEsTUFDMUIsQ0FBQyxHQUFHLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ3RCLENBQUMsSUFBSSxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUU7QUFBQSxNQUN2QixDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFO0FBQUE7QUFBQSxNQUd0QixDQUFDLElBQUksS0FBSyxLQUFLLEdBQUcsS0FBSyxHQUFHO0FBQUEsTUFDMUIsQ0FBQyxJQUFJLElBQUksSUFBSSxJQUFJLElBQUksRUFBRTtBQUFBLE1BQ3ZCLENBQUMsSUFBSSxJQUFJLElB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Q0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxjQUFjO0FBQUEsSUFDaEI7QUFHQSwyQkFBdUIsMkJBQWlDLE1BQU0sYUFBYSxPQUFPLENBQUM7QUFDbkYsMkJBQXVCLGtDQUFpQyxNQUFNLG1CQUFtQixXQUFXLENBQUM7QUFDN0YsMkJBQXVCLHdDQUFpQyxNQUFNLG9CQUFvQixPQUFPLENBQUM7QUFDMUYsMkJBQXVCLHdCQUFpQyxNQUFNLFVBQVUsT0FBTyxDQUFDO0FBQ2hGLDJCQUF1Qix3QkFBZ0MsTUFBTSxzQkFBc0IsT0FBTyxDQUFDO0FBQzNGLDJCQUF1QiwrQkFBaUMsTUFBTSxpQkFBaUIsT0FBTyxDQUFDO0FBQ3ZGLDJCQUF1Qix1QkFBaUMsTUFBTSxtQkFBbUIsT0FBTyxDQUFDO0FBQ3pGLDJCQUF1QiwwQkFBa0MsTUFBTSxlQUFlLE9BQU8sQ0FBQztBQUN0RiwyQkFBdUIsd0JBQWlDLGtCQUFrQjtBQUMxRSwyQkFBdUIsMkJBQXNCLE1BQU07QUFDakQsYUFBTyxVQUFVO0FBQ2pCLGdCQUFVLE1BQU07QUFDaEIsaUJBQVc7QUFDWCxZQUFNLFVBQVUsU0FBUyxlQUFlLGFBQWE7QUFDckQsVUFBSTtBQUFTLGdCQUFRLE9BQU87QUFDNUIsWUFBTSwwREFBMEQ7QUFBQSxJQUNsRSxDQUFDO0FBR0QsbUJBQWUsbUJBQW1CLEVBQy9CLEtBQUssTUFBTTtBQUNWLFdBQUssT0FBTyxNQUFNLGNBQWMsS0FBSyxDQUFDO0FBQ3RDLHNCQUFnQixNQUFNLEtBQUs7QUFBQSxJQUM3QixDQUFDLEVBQ0EsTUFBTSxDQUFDLE1BQU07QUFDWixVQUFJLDhCQUE4QixDQUFDO0FBQ25DLGlCQUFXLE1BQU07QUFDZixzQkFBYyxLQUFLO0FBQ25CLHdCQUFnQixNQUFNLEtBQUs7QUFBQSxNQUM3QixHQUFHLEdBQUk7QUFBQSxJQUNULENBQUM7QUFHSCxnQkFBWSxDQUFDLFFBQVE7QUFDbkIsVUFBSSxnQkFBZ0IsR0FBRztBQUN2QixVQUFJLENBQUMsU0FBUyxlQUFlLGFBQWEsR0FBRztBQUMzQyxzQkFBYyxLQUFLO0FBQUEsTUFDckI7QUFBQSxJQUNGLENBQUM7QUFFRCxRQUFJLHFCQUFxQjtBQUFBLEVBQzNCLEdBQUc7IiwKICAibmFtZXMiOiBbInR5cGVOdW1iZXIiLCAiZXJyb3JDb3JyZWN0aW9uTGV2ZWwiLCAidW5pY29kZU1hcCIsICJxcmNvZGUiLCAiX251bSIsICJudW0iLCAiX3RoaXMiLCAiZGF0YSIsICJzdHJpbmdUb0J5dGVzIiwgImxpIl0KfQo=
