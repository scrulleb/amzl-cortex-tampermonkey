// ==UserScript==
// @name         Cortex Tools
// @namespace    https://github.com/jurib/amzl-cortex-tampermonkey
// @version      1.2.1
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
    deliveryPerfStation: 'XYZ1',
    deliveryPerfDsp: 'TEST',
    features: {
      whcDashboard: true,
      dateExtractor: true,
      deliveryPerf: true,
      dvicCheck: true,
      dvicShowTransporters: true,
      workingHours: true,
      returnsDashboard: true,
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
        deliveryPerfStation: saved.deliveryPerfStation || DEFAULTS.deliveryPerfStation,
        deliveryPerfDsp: saved.deliveryPerfDsp || DEFAULTS.deliveryPerfDsp,
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

    /* ── Delivery Performance Dashboard ───────────────────── */
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
  `);

  GM_addStyle(`
    /* ── DVIC Check ───────────────────────────────────────── */
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

    /* ── Transporter column ──────────────────────────────── */
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

    /* Responsive: stack transporter below vehicle on narrow panels */
    @media (max-width: 680px) {
      .ct-dvic-table { display: block; overflow-x: auto; }
      .ct-dvic-tp-cell { display: block; max-width: 100%; }
    }
  `);

  GM_addStyle(`
    /* ── Working Hours Dashboard ─────────────────────────── */
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

    /* Driver column: fixed width, center */
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

    /* Searchable dropdown */
    .ct-whd-sa-wrapper {
      position: relative; display: inline-block; min-width: 160px;
    }
    .ct-whd-sa-search {
      min-width: 160px; box-sizing: border-box;
    }
    .ct-whd-sa-options {
      position: absolute; top: 100%; left: 0; right: 0;
      max-height: 220px; overflow-y: auto;
      background: var(--ct-bg); border: 1px solid var(--ct-border);
      border-radius: var(--ct-radius); box-shadow: var(--ct-shadow);
      list-style: none; margin: 2px 0 0; padding: 0;
      z-index: 100001; display: none;
    }
    .ct-whd-sa-wrapper.ct-whd-sa-open .ct-whd-sa-options {
      display: block;
    }
    .ct-whd-sa-options li {
      padding: 8px 12px; cursor: pointer; font-size: 13px;
      font-family: var(--ct-font);
    }
    .ct-whd-sa-options li:hover,
    .ct-whd-sa-options li.ct-whd-sa-active {
      background: #fff3d6;
    }
    .ct-whd-sa-options li.ct-whd-sa-hidden { display: none; }

    /* Detail modal */
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
  `);

  GM_addStyle(`
    /* ── Returns Dashboard ─────────────────────────────── */
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
          <li class="fp-sub-menu-list-item">
            <a href="#" data-ct-tool="delivery-perf">📦 Daily Delivery Performance</a>
          </li>
          <li class="fp-sub-menu-list-item">
            <a href="#" data-ct-tool="dvic-check">🚛 DVIC Check</a>
          </li>
          <li class="fp-sub-menu-list-item">
            <a href="#" data-ct-tool="working-hours">⏱ Working Hours</a>
          </li>
          <li class="fp-sub-menu-list-item">
            <a href="#" data-ct-tool="returns">📦 Returns</a>
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
            case 'delivery-perf': deliveryPerformance.toggle(); break;
            case 'dvic-check': dvicCheck.toggle(); break;
            case 'working-hours': workingHoursDashboard.toggle(); break;
            case 'returns': returnsDashboard.toggle(); break;
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
    _setStatus(msg) {
      const el = document.getElementById('ct-whd-status');
      if (el) el.textContent = msg;
    },
    _setBody(html) {
      const el = document.getElementById('ct-whd-body');
      if (el) el.innerHTML = html;
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE: RETURNS DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  const RETURNS_SERVICE_AREAS = [
    { id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', name: 'XYZ1' },
    { id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', name: 'DUS1' },
    { id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', name: 'FRA1' },
  ];

  function retFormatTimestamp(epochMs) {
    if (!epochMs) return '—';
    try {
      return new Date(Number(epochMs)).toLocaleString('de-DE', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return '—'; }
  }

  function retGetCoords(pkg) {
    const addr = pkg.address || {};
    const lat = addr.geocodeLatitude || addr.geocode?.latitude;
    const lon = addr.geocodeLongitude || addr.geocode?.longitude;
    if (lat != null && lon != null) return { lat, lon };
    return null;
  }

  function retReasonClass(code) {
    if (!code) return 'ct-ret-card-reason--ok';
    const c = String(code).toUpperCase();
    if (c.includes('DAMAGE') || c.includes('DEFECT')) return 'ct-ret-card-reason--error';
    if (c.includes('CUSTOMER') || c.includes('REFUSAL')) return 'ct-ret-card-reason--warn';
    return 'ct-ret-card-reason--ok';
  }

  const returnsDashboard = {
    _overlayEl: null,
    _active: false,
    _allPackages: [],
    _filteredPackages: [],
    _page: 1,
    _pageSize: 50,
    _sort: { field: 'lastUpdatedTime', direction: 'desc' },
    _filters: { search: '', city: '', postalCode: '', routeCode: '', reasonCode: '' },
    _serviceAreas: [],
    _selectedSaId: null,
    _cache: new Map(),
    _cacheExpiry: 5 * 60 * 1000,

    init() {
      if (this._overlayEl) return;

      const today = todayStr();
      const saId = config.serviceAreaId;
      const defaultSa = RETURNS_SERVICE_AREAS.find((s) => s.id === saId) || RETURNS_SERVICE_AREAS[0];

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
            <input type="text" class="ct-input ct-ret-search" id="ct-ret-search"
                   placeholder="ScannableId suchen..." aria-label="Suche nach ScannableId">
            <div class="ct-ret-filter-group">
              <label>Stadt:</label>
              <input type="text" class="ct-input" id="ct-ret-city" placeholder="Filter Stadt"
                     style="width:100px">
            </div>
            <div class="ct-ret-filter-group">
              <label>PLZ:</label>
              <input type="text" class="ct-input" id="ct-ret-postal" placeholder="Filter PLZ"
                     style="width:80px">
            </div>
            <div class="ct-ret-filter-group">
              <label>Route:</label>
              <input type="text" class="ct-input" id="ct-ret-route" placeholder="Route"
                     style="width:80px">
            </div>
            <div class="ct-ret-filter-group">
              <label>Reason:</label>
              <input type="text" class="ct-input" id="ct-ret-reason" placeholder="Reason Code"
                     style="width:80px">
            </div>
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
      document.getElementById('ct-ret-close').addEventListener('click', () => this.hide());
      document.getElementById('ct-ret-go').addEventListener('click', () => this._loadData());
      document.getElementById('ct-ret-export').addEventListener('click', () => this._exportCSV());
      document.getElementById('ct-ret-clear-filters').addEventListener('click', () => this._clearFilters());

      document.getElementById('ct-ret-search').addEventListener('input', () => this._applyFilters());
      document.getElementById('ct-ret-city').addEventListener('input', () => this._applyFilters());
      document.getElementById('ct-ret-postal').addEventListener('input', () => this._applyFilters());
      document.getElementById('ct-ret-route').addEventListener('input', () => this._applyFilters());
      document.getElementById('ct-ret-reason').addEventListener('input', () => this._applyFilters());
      document.getElementById('ct-ret-sort-field').addEventListener('change', () => this._applyFilters());
      document.getElementById('ct-ret-sort-dir').addEventListener('change', () => this._applyFilters());

      this._initSaDropdown(defaultSa);

      onDispose(() => this.dispose());
      log('Returns Dashboard initialized');
    },

    dispose() {
      if (this._overlayEl) { this._overlayEl.remove(); this._overlayEl = null; }
      this._allPackages = [];
      this._filteredPackages = [];
      this._active = false;
    },

    toggle() {
      if (!config.features.returnsDashboard) {
        alert('Returns Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.');
        return;
      }
      this.init();
      if (this._active) this.hide(); else this.show();
    },

    show() {
      this.init();
      this._overlayEl.classList.add('visible');
      this._active = true;
      document.getElementById('ct-ret-date').focus();
    },

    hide() {
      if (this._overlayEl) this._overlayEl.classList.remove('visible');
      this._active = false;
    },

    async _initSaDropdown(defaultSa) {
      const select = document.getElementById('ct-ret-sa');
      select.innerHTML = '';

      try {
        const resp = await fetch('https://logistics.amazon.de/account-management/data/get-company-service-areas', { credentials: 'include' });
        const json = await resp.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          this._serviceAreas = json.data;
        } else {
          this._serviceAreas = RETURNS_SERVICE_AREAS;
        }
      } catch (e) {
        log('Returns: failed to load service areas, using defaults:', e);
        this._serviceAreas = RETURNS_SERVICE_AREAS;
      }

      this._serviceAreas.forEach((sa) => {
        const opt = document.createElement('option');
        opt.value = sa.serviceAreaId || sa.id;
        opt.textContent = sa.stationCode || sa.name;
        if (opt.value === defaultSa.id) opt.selected = true;
        select.appendChild(opt);
      });

      this._selectedSaId = select.value || defaultSa.id;
    },

    _getCacheKey(localDate, serviceAreaId) {
      return `${localDate}|${serviceAreaId}`;
    },

    async _loadData() {
      const date = document.getElementById('ct-ret-date').value;
      const serviceAreaId = document.getElementById('ct-ret-sa').value;
      const routeView = document.getElementById('ct-ret-routeview').checked;

      if (!date) { this._setStatus('⚠️ Bitte Datum auswählen.'); return; }
      if (!serviceAreaId) { this._setStatus('⚠️ Bitte Service Area auswählen.'); return; }

      const cacheKey = this._getCacheKey(date, serviceAreaId);
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
        historicalDay: 'false',
        localDate: date,
        packageStatus: 'RETURNED',
        routeView: String(routeView),
        serviceAreaId: serviceAreaId,
        statsFromSummaries: 'true',
      });

      const url = `https://logistics.amazon.de/operations/execution/api/packages/packagesByStatus?${params}`;

      try {
        const resp = await withRetry(async () => {
          const r = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'de,en-US;q=0.7,en;q=0.3',
              Referer: location.href,
            },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r;
        }, { retries: 3, baseMs: 500 });

        const json = await resp.json();
        const packages = Array.isArray(json?.packages) ? json.packages : [];

        this._cache.set(cacheKey, { data: packages, timestamp: Date.now() });
        this._allPackages = packages;

        this._page = 1;
        this._applyFilters();
        this._setStatus(`✅ ${packages.length} Pakete geladen für ${date}`);
      } catch (e) {
        err('Returns fetch failed:', e);
        this._setBody(`<div class="ct-ret-error" role="alert">
          ❌ Daten konnten nicht geladen werden.<br>
          <small>${esc(e.message)}</small><br><br>
          <button class="ct-btn ct-btn--accent" id="ct-ret-retry">🔄 Erneut versuchen</button>
        </div>`);
        this._setStatus('❌ Fehler beim Laden.');
        document.getElementById('ct-ret-retry')?.addEventListener('click', () => this._loadData());
      }
    },

    _clearFilters() {
      document.getElementById('ct-ret-search').value = '';
      document.getElementById('ct-ret-city').value = '';
      document.getElementById('ct-ret-postal').value = '';
      document.getElementById('ct-ret-route').value = '';
      document.getElementById('ct-ret-reason').value = '';
      this._filters = { search: '', city: '', postalCode: '', routeCode: '', reasonCode: '' };
      this._applyFilters();
    },

    _applyFilters() {
      this._filters = {
        search: (document.getElementById('ct-ret-search').value || '').toLowerCase().trim(),
        city: (document.getElementById('ct-ret-city').value || '').toLowerCase().trim(),
        postalCode: (document.getElementById('ct-ret-postal').value || '').toLowerCase().trim(),
        routeCode: (document.getElementById('ct-ret-route').value || '').toLowerCase().trim(),
        reasonCode: (document.getElementById('ct-ret-reason').value || '').toLowerCase().trim(),
      };

      const sortField = document.getElementById('ct-ret-sort-field').value;
      const sortDir = document.getElementById('ct-ret-sort-dir').value;

      this._filteredPackages = this._allPackages.filter((pkg) => {
        const addr = pkg.address || {};
        if (this._filters.search) {
          const searchStr = (pkg.scannableId || '').toLowerCase();
          if (!searchStr.includes(this._filters.search)) return false;
        }
        if (this._filters.city) {
          const city = (addr.city || '').toLowerCase();
          if (!city.includes(this._filters.city)) return false;
        }
        if (this._filters.postalCode) {
          const postal = (addr.postalCode || '').toLowerCase();
          if (!postal.includes(this._filters.postalCode)) return false;
        }
        if (this._filters.routeCode) {
          const route = (pkg.routeCode || '').toLowerCase();
          if (!route.includes(this._filters.routeCode)) return false;
        }
        if (this._filters.reasonCode) {
          const reason = (pkg.reasonCode || '').toLowerCase();
          if (!reason.includes(this._filters.reasonCode)) return false;
        }
        return true;
      });

      this._filteredPackages.sort((a, b) => {
        let va = a[sortField];
        let vb = b[sortField];

        if (sortField === 'lastUpdatedTime') {
          va = Number(va) || 0;
          vb = Number(vb) || 0;
        } else if (sortField === 'city') {
          va = (a.address?.city || '').toLowerCase();
          vb = (b.address?.city || '').toLowerCase();
        } else if (sortField === 'routeCode') {
          va = (a.routeCode || '').toLowerCase();
          vb = (b.routeCode || '').toLowerCase();
        } else {
          va = (va || '').toLowerCase();
          vb = (vb || '').toLowerCase();
        }

        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });

      this._renderStats();
      this._renderCards();
    },

    _renderStats() {
      const total = this._allPackages.length;
      const filtered = this._filteredPackages.length;
      document.getElementById('ct-ret-count').textContent =
        filtered === total ? `${total} Pakete` : `${filtered} von ${total} Paketen`;
    },

    _renderCards() {
      const totalPages = Math.ceil(this._filteredPackages.length / this._pageSize);
      if (this._page > totalPages) this._page = Math.max(1, totalPages);
      const start = (this._page - 1) * this._pageSize;
      const slice = this._filteredPackages.slice(start, start + this._pageSize);

      if (slice.length === 0) {
        this._setBody('<div class="ct-ret-empty">Keine Returns für die gewählten Filter gefunden.</div>');
        this._renderPagination(0, 1, 1);
        return;
      }

      const cardsHtml = slice.map((pkg) => this._renderCard(pkg)).join('');
      this._setBody(`<div class="ct-ret-cards">${cardsHtml}</div>`);
      this._renderPagination(this._filteredPackages.length, this._page, totalPages);
    },

    _renderCard(pkg) {
      const addr = pkg.address || {};
      const coords = retGetCoords(pkg);
      const mapLink = coords
        ? `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lon}`
        : null;

      const reason = pkg.reasonCode || 'Unbekannt';
      const reasonClass = retReasonClass(reason);

      return `
        <div class="ct-ret-card">
          <div class="ct-ret-card-header">
            <span class="ct-ret-card-id">${esc(pkg.scannableId || '—')}</span>
            <span class="ct-ret-card-reason ${reasonClass}">${esc(reason)}</span>
          </div>
          <div class="ct-ret-card-row">
            <span class="ct-ret-card-label">Aktualisiert:</span>
            <span class="ct-ret-card-value">${retFormatTimestamp(pkg.lastUpdatedTime)}</span>
          </div>
          <div class="ct-ret-card-row">
            <span class="ct-ret-card-label">Route:</span>
            <span class="ct-ret-card-value">${esc(pkg.routeCode || '—')}</span>
          </div>
          <div class="ct-ret-card-row">
            <span class="ct-ret-card-label">Transporter ID:</span>
            <span class="ct-ret-card-value">${esc(pkg.transporterId || '—')}</span>
          </div>
          <div class="ct-ret-card-row">
            <span class="ct-ret-card-label">TR ID:</span>
            <span class="ct-ret-card-value">${esc(pkg.trId || '—')}</span>
          </div>
          <div class="ct-ret-card-address">
            ${esc(addr.address1 || '')}${addr.address2 ? ', ' + esc(addr.address2) : ''}<br>
            ${esc(addr.postalCode || '')} ${esc(addr.city || '')}
            ${coords ? `<br><small>📍 ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}</small>` : ''}
            ${mapLink ? `<a href="${mapLink}" class="ct-ret-card-map" target="_blank" rel="noopener">📍 In Karte öffnen</a>` : ''}
          </div>
        </div>
      `;
    },

    _renderPagination(total, current, totalPages) {
      const el = document.getElementById('ct-ret-body');
      if (!el) return;

      if (totalPages <= 1) {
        const existing = el.parentNode?.querySelector('.ct-ret-pagination');
        if (existing) existing.remove();
        return;
      }

      let paginationHtml = `
        <div class="ct-ret-pagination">
          <button class="ct-btn ct-btn--secondary ct-ret-prev" ${current <= 1 ? 'disabled' : ''}>‹ Zurück</button>
          <span class="ct-ret-page-info">Seite ${current} / ${totalPages} (${total} Einträge)</span>
          <button class="ct-btn ct-btn--secondary ct-ret-next" ${current >= totalPages ? 'disabled' : ''}>Weiter ›</button>
        </div>
      `;

      const existing = el.parentNode?.querySelector('.ct-ret-pagination');
      if (existing) existing.remove();
      el.insertAdjacentHTML('afterend', paginationHtml);

      el.parentNode?.querySelector('.ct-ret-prev')?.addEventListener('click', () => {
        if (this._page > 1) { this._page--; this._renderCards(); }
      });
      el.parentNode?.querySelector('.ct-ret-next')?.addEventListener('click', () => {
        if (this._page < totalPages) { this._page++; this._renderCards(); }
      });
    },

    _setStatus(msg) {
      const el = document.getElementById('ct-ret-status');
      if (el) el.textContent = msg;
    },

    _setBody(html) {
      const el = document.getElementById('ct-ret-body');
      if (el) el.innerHTML = html;
    },

    _exportCSV() {
      if (this._filteredPackages.length === 0) {
        alert('Keine Daten zum Exportieren.');
        return;
      }

      const headers = ['scannableId', 'lastUpdatedTime', 'reasonCode', 'trId', 'transporterId', 'routeCode', 'address1', 'address2', 'city', 'postalCode', 'latitude', 'longitude'];
      let csv = headers.join(';') + '\n';

      for (const pkg of this._filteredPackages) {
        const addr = pkg.address || {};
        const coords = retGetCoords(pkg);
        const row = [
          pkg.scannableId || '',
          retFormatTimestamp(pkg.lastUpdatedTime),
          pkg.reasonCode || '',
          pkg.trId || '',
          pkg.transporterId || '',
          pkg.routeCode || '',
          addr.address1 || '',
          addr.address2 || '',
          addr.city || '',
          addr.postalCode || '',
          coords?.lat ?? '',
          coords?.lon ?? '',
        ];
        csv += row.map((v) => String(v).replace(/;/g, ',')).join(';') + '\n';
      }

      const date = document.getElementById('ct-ret-date').value;
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `returns_${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
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

        ${toggleHTML('ct-set-whc',  'WHC Dashboard', config.features.whcDashboard)}
        ${toggleHTML('ct-set-dre',  'Date Range Extractor', config.features.dateExtractor)}
        ${toggleHTML('ct-set-dp',   'Daily Delivery Performance', config.features.deliveryPerf)}
        ${toggleHTML('ct-set-dvic', 'DVIC Check', config.features.dvicCheck)}
        ${toggleHTML('ct-set-whd',  'Working Hours Dashboard', config.features.workingHours)}
        ${toggleHTML('ct-set-ret',  'Returns Dashboard', config.features.returnsDashboard)}
        ${toggleHTML('ct-set-dev',  'Dev-Mode (ausführliches Logging)', config.dev)}

        <div class="ct-settings-row" style="flex-direction: column; align-items: stretch; gap: 6px;">
          <label style="margin-bottom: 2px;"><strong>Delivery Perf — Default Station:</strong></label>
          <input type="text" class="ct-input ct-input--full" id="ct-set-dp-station"
                 value="${esc(config.deliveryPerfStation || 'XYZ1')}" maxlength="8">
        </div>
        <div class="ct-settings-row" style="flex-direction: column; align-items: stretch; gap: 6px;">
          <label style="margin-bottom: 2px;"><strong>Delivery Perf — Default DSP:</strong></label>
          <input type="text" class="ct-input ct-input--full" id="ct-set-dp-dsp"
                 value="${esc(config.deliveryPerfDsp || 'TEST')}" maxlength="8">
        </div>

        <div class="ct-settings-row" style="flex-direction: column; align-items: stretch;">
          <label for="ct-set-sa" style="margin-bottom: 6px;"><strong>Service Area:</strong></label>
          <select id="ct-set-sa" class="ct-input ct-input--full">
            <option value="">Wird geladen…</option>
          </select>
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
      config.features.whcDashboard  = document.getElementById('ct-set-whc').checked;
      config.features.dateExtractor = document.getElementById('ct-set-dre').checked;
      config.features.deliveryPerf  = document.getElementById('ct-set-dp').checked;
      config.features.dvicCheck     = document.getElementById('ct-set-dvic').checked;
      config.features.workingHours  = document.getElementById('ct-set-whd').checked;
      config.features.returnsDashboard = document.getElementById('ct-set-ret').checked;
      config.dev = document.getElementById('ct-set-dev').checked;
      config.deliveryPerfStation = document.getElementById('ct-set-dp-station').value.trim().toUpperCase() || 'XYZ1';
      config.deliveryPerfDsp     = document.getElementById('ct-set-dp-dsp').value.trim().toUpperCase() || 'TEST';
      const saSelect = document.getElementById('ct-set-sa');
      config.serviceAreaId = saSelect.value.trim() || DEFAULTS.serviceAreaId;
      setConfig(config);
      overlay.remove();
      log('Settings saved:', config);
    });

    // Fetch service areas and populate dropdown
    (async () => {
      const saSelect = document.getElementById('ct-set-sa');
      try {
        const resp = await fetch('https://logistics.amazon.de/account-management/data/get-company-service-areas');
        const json = await resp.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          saSelect.innerHTML = '';
          json.data.forEach((area) => {
            const opt = document.createElement('option');
            opt.value = area.serviceAreaId;
            opt.textContent = area.stationCode;
            if (area.serviceAreaId === config.serviceAreaId) opt.selected = true;
            saSelect.appendChild(opt);
          });
          // If none matched, pre-select first
          if (!saSelect.value) saSelect.options[0].selected = true;
        } else {
          saSelect.innerHTML = `<option value="${esc(config.serviceAreaId)}">${esc(config.serviceAreaId)}</option>`;
        }
      } catch (e) {
        err('Failed to load service areas:', e);
        saSelect.innerHTML = `<option value="${esc(config.serviceAreaId)}">${esc(config.serviceAreaId)}</option>`;
      }
    })();
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
  GM_registerMenuCommand('📦 Daily Delivery Performance', () => deliveryPerformance.toggle());
  GM_registerMenuCommand('🚛 DVIC Check', () => dvicCheck.toggle());
  GM_registerMenuCommand('⏱ Working Hours', () => workingHoursDashboard.toggle());
  GM_registerMenuCommand('📦 Returns Dashboard', () => returnsDashboard.toggle());
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
