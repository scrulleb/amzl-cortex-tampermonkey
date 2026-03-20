// ==UserScript==
// @name         Cortex Tools
// @namespace    https://github.com/jurib/amzl-cortex-tampermonkey
// @version      1.2.0
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
  // MODULE: DAILY DELIVERY PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Pure helper functions – also exported via deliveryPerformance._helpers
   * so that the test suite can import them without a DOM/GM environment.
   */

  // Field-type classification maps
  const DP_STRING_FIELDS = new Set([
    'country', 'station_code', 'program',
    'country_dspid_stationcode', 'country_program_stationcode',
    'region', 'dsp_code', 'country_program_dspid_stationcode',
    'country_stationcode', 'country_program_data_date',
  ]);

  const DP_INT_FIELDS = new Set([
    'delivered', 'unbucketed_delivery_misses', 'address_not_found',
    'return_to_station_utl', 'return_to_station_uta', 'customer_not_available',
    'return_to_station_all', 'successful_c_return_pickups', 'rts_other',
    'dispatched', 'transferred_out', 'dnr', 'return_to_station_nsl',
    'completed_routes', 'first_delv_with_test_dim', 'pde_photos_taken',
    'packages_not_on_van', 'first_disp_with_test_dim', 'delivery_attempt',
    'return_to_station_bc', 'pod_bypass', 'pod_opportunity', 'pod_success',
    'next_day_routes', 'scheduled_mfn_pickups', 'successful_mfn_pickups',
    'rejected_packages', 'payment_not_ready', 'scheduled_c_return_pickups',
    'return_to_station_cu', 'return_to_station_oodt', 'rts_dpmo', 'dnr_dpmo',
    'ttl',
  ]);

  // Rates that are 0–1 ratios displayed as percentage
  const DP_PERCENT_FIELDS = new Set([
    'pod_success_rate', 'rts_cu_percent', 'rts_other_percent', 'rts_oodt_percent',
    'rts_utl_percent', 'rts_bc_percent', 'delivery_attempt_percent',
    'customer_not_available_percent', 'first_day_delivery_success_percent',
    'rts_all_percent', 'rejected_packages_percent', 'payment_not_ready_percent',
    'delivery_success_dsp', 'delivery_success',
    'unbucketed_delivery_misses_percent', 'address_not_found_percent',
  ]);

  // Rates displayed as plain decimal (not %)
  const DP_RATE_FIELDS = new Set(['shipment_zone_per_hour']);

  const DP_DATETIME_FIELDS = new Set(['last_updated_time']);
  const DP_EPOCH_FIELDS   = new Set(['messageTimestamp']);
  const DP_DATE_FIELDS    = new Set(['data_date']);

  // friendly labels for display
  const DP_LABELS = {
    country: 'Country', station_code: 'Station', program: 'Program',
    country_dspid_stationcode: 'Country/DSP/Station',
    country_program_stationcode: 'Country/Program/Station',
    region: 'Region', dsp_code: 'DSP',
    country_program_dspid_stationcode: 'Country/Program/DSP/Station',
    country_stationcode: 'Country/Station',
    country_program_data_date: 'Country/Program/Date',
    delivered: 'Delivered', dispatched: 'Dispatched',
    completed_routes: 'Completed Routes', delivery_attempt: 'Delivery Attempts',
    unbucketed_delivery_misses: 'Unbucketed Misses',
    address_not_found: 'Address Not Found',
    return_to_station_utl: 'RTS UTL', return_to_station_uta: 'RTS UTA',
    customer_not_available: 'Customer N/A',
    return_to_station_all: 'RTS All', return_to_station_cu: 'RTS CU',
    return_to_station_bc: 'RTS BC', return_to_station_nsl: 'RTS NSL',
    return_to_station_oodt: 'RTS OODT',
    successful_c_return_pickups: 'C-Return Pickups',
    rts_other: 'RTS Other', transferred_out: 'Transferred Out', dnr: 'DNR',
    first_delv_with_test_dim: 'First Delv (dim)', pde_photos_taken: 'PDE Photos',
    packages_not_on_van: 'Pkgs Not on Van',
    first_disp_with_test_dim: 'First Disp (dim)',
    pod_bypass: 'POD Bypass', pod_opportunity: 'POD Opportunity',
    pod_success: 'POD Success', next_day_routes: 'Next Day Routes',
    scheduled_mfn_pickups: 'Sched MFN Pickups',
    successful_mfn_pickups: 'Successful MFN Pickups',
    rejected_packages: 'Rejected Pkgs', payment_not_ready: 'Payment N/Ready',
    scheduled_c_return_pickups: 'Sched C-Return',
    rts_dpmo: 'RTS DPMO', dnr_dpmo: 'DNR DPMO', ttl: 'TTL',
    shipment_zone_per_hour: 'Shipments/Zone/Hour',
    pod_success_rate: 'POD Success Rate',
    rts_cu_percent: 'RTS CU %', rts_other_percent: 'RTS Other %',
    rts_oodt_percent: 'RTS OODT %', rts_utl_percent: 'RTS UTL %',
    rts_bc_percent: 'RTS BC %', delivery_attempt_percent: 'Delivery Attempt %',
    customer_not_available_percent: 'Customer N/A %',
    first_day_delivery_success_percent: 'First-Day Success %',
    rts_all_percent: 'RTS All %', rejected_packages_percent: 'Rejected Pkgs %',
    payment_not_ready_percent: 'Payment N/Ready %',
    delivery_success_dsp: 'Delivery Success (DSP)',
    delivery_success: 'Delivery Success',
    unbucketed_delivery_misses_percent: 'Unbucketed Misses %',
    address_not_found_percent: 'Address Not Found %',
    last_updated_time: 'Last Updated', messageTimestamp: 'Message Timestamp',
    data_date: 'Data Date',
  };

  /**
   * Parse a raw API row string into a normalised record object.
   * Trims leading/trailing spaces from all keys.
   * @param {string} jsonStr  – raw JSON string from the API rows array
   * @returns {Object}
   */
  function dpParseRow(jsonStr) {
    const raw = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k.trim()] = v;
    }
    return out;
  }

  /**
   * Classify a field name into its data type category.
   * @param {string} field
   * @returns {'string'|'int'|'percent'|'rate'|'datetime'|'epoch'|'date'|'unknown'}
   */
  function dpClassifyField(field) {
    if (DP_STRING_FIELDS.has(field))   return 'string';
    if (DP_INT_FIELDS.has(field))      return 'int';
    if (DP_PERCENT_FIELDS.has(field))  return 'percent';
    if (DP_RATE_FIELDS.has(field))     return 'rate';
    if (DP_DATETIME_FIELDS.has(field)) return 'datetime';
    if (DP_EPOCH_FIELDS.has(field))    return 'epoch';
    if (DP_DATE_FIELDS.has(field))     return 'date';
    return 'unknown';
  }

  /**
   * Format a value for display based on its classified type.
   * @param {string} field
   * @param {*}      value
   * @returns {string}
   */
  function dpFormatValue(field, value) {
    if (value === null || value === undefined || value === '') return '—';
    const type = dpClassifyField(field);
    switch (type) {
      case 'percent': {
        const pct = (Number(value) * 100).toFixed(2);
        return `${pct}%`;
      }
      case 'rate':
        return Number(value).toFixed(2);
      case 'datetime': {
        try {
          return new Date(value).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
        } catch { return String(value); }
      }
      case 'epoch': {
        try {
          return new Date(Number(value)).toLocaleString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
        } catch { return String(value); }
      }
      case 'date':
        return String(value);
      case 'int':
        return Number(value).toLocaleString();
      default:
        return String(value);
    }
  }

  /**
   * Return the CSS colour class for a percentage/ratio value.
   * Higher = better for delivery/success fields.
   * Lower = better for RTS/miss fields.
   */
  function dpRateClass(field, value) {
    const v = Number(value);
    // RTS & miss fields: lower is better
    if (field.startsWith('rts_') || field.includes('miss') ||
        field === 'customer_not_available_percent' ||
        field === 'rejected_packages_percent' ||
        field === 'payment_not_ready_percent' ||
        field === 'address_not_found_percent') {
      if (v < 0.005) return 'great';
      if (v < 0.01)  return 'ok';
      return 'bad';
    }
    // Success/delivery/pod fields: higher is better
    if (v >= 0.99)  return 'great';
    if (v >= 0.97)  return 'ok';
    return 'bad';
  }

  /**
   * Validate a date-range pair. Returns null if valid, error string otherwise.
   */
  function dpValidateDateRange(from, to) {
    if (!from || !to) return 'Both From and To dates are required.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return 'From date format must be YYYY-MM-DD.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to))   return 'To date format must be YYYY-MM-DD.';
    if (from > to) return 'From date must not be after To date.';
    return null;
  }

  /**
   * Extract and sort records from the raw API response JSON.
   * Returns an empty array if the payload has no rows.
   */
  function dpParseApiResponse(json) {
    try {
      const rows = json?.tableData?.dsp_daily_supplemental_quality?.rows;
      if (!Array.isArray(rows) || rows.length === 0) return [];
      return rows
        .map(dpParseRow)
        .sort((a, b) => (a.data_date || '').localeCompare(b.data_date || ''));
    } catch (e) {
      err('dpParseApiResponse error:', e);
      return [];
    }
  }

  const deliveryPerformance = {
    _overlayEl: null,
    _active: false,
    _cache: new Map(),
    _debounceTimer: null,

    // Expose pure helpers for testing
    _helpers: {
      dpParseRow,
      dpClassifyField,
      dpFormatValue,
      dpRateClass,
      dpValidateDateRange,
      dpParseApiResponse,
    },

    // ── Lifecycle ────────────────────────────────────────────
    init() {
      if (this._overlayEl) return;

      const today    = todayStr();
      const weekAgo  = (() => {
        const d = new Date(today);
        d.setDate(d.getDate() - 6);
        return d.toISOString().split('T')[0];
      })();
      const station  = esc(config.deliveryPerfStation || 'XYZ1');
      const dsp      = esc(config.deliveryPerfDsp      || 'TEST');

      const overlay = document.createElement('div');
      overlay.id = 'ct-dp-overlay';
      overlay.className = 'ct-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Daily Delivery Performance Dashboard');
      overlay.innerHTML = `
        <div class="ct-dp-panel">
          <h2>📦 Daily Delivery Performance</h2>
          <div class="ct-controls">
            <label for="ct-dp-from">From:</label>
            <input type="date" id="ct-dp-from" class="ct-input" value="${weekAgo}"
                   aria-label="From date">
            <label for="ct-dp-to">To:</label>
            <input type="date" id="ct-dp-to" class="ct-input" value="${today}"
                   aria-label="To date">
            <label for="ct-dp-station">Station:</label>
            <input type="text" id="ct-dp-station" class="ct-input"
                   value="${station}" maxlength="8" style="width:80px"
                   aria-label="Station code">
            <label for="ct-dp-dsp">DSP:</label>
            <input type="text" id="ct-dp-dsp" class="ct-input"
                   value="${dsp}" maxlength="8" style="width:70px"
                   aria-label="DSP code">
            <button class="ct-btn ct-btn--accent" id="ct-dp-go">🔍 Fetch</button>
            <button class="ct-btn ct-btn--close" id="ct-dp-close" aria-label="Close">✕ Close</button>
          </div>
          <div id="ct-dp-status" class="ct-status" role="status" aria-live="polite"></div>
          <div id="ct-dp-body"></div>
        </div>
      `;

      document.body.appendChild(overlay);
      this._overlayEl = overlay;

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.hide();
      });
      document.getElementById('ct-dp-close').addEventListener('click', () => this.hide());
      document.getElementById('ct-dp-go').addEventListener('click', () => this._triggerFetch());

      // Debounced date-change auto-fetch
      const debounce = (fn, ms) => {
        return (...args) => {
          clearTimeout(this._debounceTimer);
          this._debounceTimer = setTimeout(() => fn.apply(this, args), ms);
        };
      };
      const debouncedFetch = debounce(this._triggerFetch, 600);
      document.getElementById('ct-dp-from').addEventListener('change', debouncedFetch.bind(this));
      document.getElementById('ct-dp-to').addEventListener('change', debouncedFetch.bind(this));

      onDispose(() => this.dispose());
      log('Delivery Performance Dashboard initialized');
    },

    dispose() {
      clearTimeout(this._debounceTimer);
      if (this._overlayEl) { this._overlayEl.remove(); this._overlayEl = null; }
      this._active = false;
      this._cache.clear();
    },

    toggle() {
      if (!config.features.deliveryPerf) {
        alert('Daily Delivery Performance ist deaktiviert. Bitte in den Einstellungen aktivieren.');
        return;
      }
      this.init();
      if (this._active) this.hide(); else this.show();
    },

    show() {
      this.init();
      this._overlayEl.classList.add('visible');
      this._active = true;
      document.getElementById('ct-dp-from').focus();
    },

    hide() {
      if (this._overlayEl) this._overlayEl.classList.remove('visible');
      this._active = false;
    },

    // ── API ──────────────────────────────────────────────────
    _buildUrl(from, to, station, dsp) {
      return (
        'https://logistics.amazon.de/performance/api/v1/getData' +
        `?dataSetId=dsp_daily_supplemental_quality` +
        `&dsp=${encodeURIComponent(dsp)}` +
        `&from=${encodeURIComponent(from)}` +
        `&station=${encodeURIComponent(station)}` +
        `&timeFrame=Daily` +
        `&to=${encodeURIComponent(to)}`
      );
    },

    async _fetchData(from, to, station, dsp) {
      const cacheKey = `${from}|${to}|${station}|${dsp}`;
      if (this._cache.has(cacheKey)) {
        log('DP cache hit:', cacheKey);
        return this._cache.get(cacheKey);
      }

      const url = this._buildUrl(from, to, station, dsp);
      const csrf = getCSRFToken();
      const headers = { Accept: 'application/json' };
      if (csrf) headers['anti-csrftoken-a2z'] = csrf;

      const resp = await withRetry(async () => {
        const r = await fetch(url, { method: 'GET', headers, credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r;
      }, { retries: 2, baseMs: 800 });

      const json = await resp.json();
      this._cache.set(cacheKey, json);
      // Evict oldest entry if cache grows large
      if (this._cache.size > 50) {
        const oldest = this._cache.keys().next().value;
        this._cache.delete(oldest);
      }
      return json;
    },

    // ── Trigger ──────────────────────────────────────────────
    async _triggerFetch() {
      const from    = document.getElementById('ct-dp-from').value;
      const to      = document.getElementById('ct-dp-to').value;
      const station = document.getElementById('ct-dp-station').value.trim().toUpperCase();
      const dsp     = document.getElementById('ct-dp-dsp').value.trim().toUpperCase();

      const validErr = dpValidateDateRange(from, to);
      if (validErr) {
        this._setStatus('⚠️ ' + validErr, 'warn');
        return;
      }
      if (!station) { this._setStatus('⚠️ Station code required.', 'warn'); return; }
      if (!dsp)     { this._setStatus('⚠️ DSP code required.', 'warn'); return; }

      this._setStatus('⏳ Loading…');
      this._setBody('<div class="ct-dp-loading" role="status">Fetching data…</div>');

      try {
        const json = await this._fetchData(from, to, station, dsp);
        const records = dpParseApiResponse(json);
        if (records.length === 0) {
          this._setBody('<div class="ct-dp-empty">No data returned for the selected range.</div>');
          this._setStatus('⚠️ No records found.');
          return;
        }
        this._setBody(this._renderAll(records));
        this._setStatus(`✅ ${records.length} record(s) loaded — ${from} to ${to}`);
      } catch (e) {
        err('Delivery perf fetch failed:', e);
        this._setBody(`<div class="ct-dp-error">❌ ${esc(e.message)}</div>`);
        this._setStatus('❌ Failed to load data.');
      }
    },

    // ── Status / body helpers ────────────────────────────────
    _setStatus(msg) {
      const el = document.getElementById('ct-dp-status');
      if (el) el.textContent = msg;
    },

    _setBody(html) {
      const el = document.getElementById('ct-dp-body');
      if (el) el.innerHTML = html;
    },

    // ── Rendering ────────────────────────────────────────────
    _renderAll(records) {
      // Render shared string-field badges from the first record
      const badgesHtml = this._renderBadges(records[0]);
      const recordsHtml = records.map((r) => this._renderRecord(r)).join('');
      return badgesHtml + recordsHtml;
    },

    _renderBadges(record) {
      const badges = [];
      for (const field of DP_STRING_FIELDS) {
        const val = record[field];
        if (val === undefined || val === null || val === '') continue;
        const label = DP_LABELS[field] || field;
        badges.push(
          `<span class="ct-dp-badge" title="${esc(field)}">${esc(label)}<span>${esc(String(val))}</span></span>`
        );
      }
      if (!badges.length) return '';
      return `<div class="ct-dp-badges" aria-label="Identifiers">${badges.join('')}</div>`;
    },

    _renderRecord(record) {
      const dateLabel = esc(record.data_date || 'Unknown date');
      return `
        <div class="ct-dp-record">
          <div class="ct-dp-record-header">📅 ${dateLabel}</div>
          <div class="ct-dp-record-body">
            ${this._renderKeyTiles(record)}
            ${this._renderCounts(record)}
            ${this._renderRates(record)}
            ${this._renderTimestamps(record)}
          </div>
        </div>
      `;
    },

    _renderKeyTiles(record) {
      const KEY_TILES = [
        { field: 'delivered',        label: 'Delivered' },
        { field: 'dispatched',       label: 'Dispatched' },
        { field: 'completed_routes', label: 'Routes' },
        { field: 'delivery_success', label: 'Delivery Success', pct: true },
        { field: 'pod_success_rate', label: 'POD Rate', pct: true },
      ];
      const tiles = KEY_TILES.map(({ field, label, pct }) => {
        const val = record[field];
        if (val === undefined || val === null) return '';
        let displayVal, cls = '';
        if (pct) {
          const n = Number(val);
          displayVal = `${(n * 100).toFixed(1)}%`;
          const rc = dpRateClass(field, n);
          cls = rc === 'great' ? 'ct-dp-tile--success' : rc === 'ok' ? 'ct-dp-tile--warn' : 'ct-dp-tile--danger';
        } else {
          displayVal = Number(val).toLocaleString();
        }
        return `<div class="ct-dp-tile ${cls}"><div class="ct-dp-tile-val">${esc(displayVal)}</div><div class="ct-dp-tile-lbl">${esc(label)}</div></div>`;
      }).join('');
      return `<div class="ct-dp-full-col"><div class="ct-dp-tiles">${tiles}</div></div>`;
    },

    _renderCounts(record) {
      const rows = [];
      for (const field of DP_INT_FIELDS) {
        const val = record[field];
        if (val === undefined || val === null) continue;
        const label = DP_LABELS[field] || field;
        rows.push(`<tr>
          <td>${esc(label)}</td>
          <td>${esc(Number(val).toLocaleString())}</td>
        </tr>`);
      }
      if (!rows.length) return '';
      return `<div>
        <p class="ct-dp-section-title">Counts</p>
        <table class="ct-dp-count-table" aria-label="Count metrics">
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>`;
    },

    _renderRates(record) {
      const sections = [];

      // Percentages
      const pctRows = [];
      for (const field of DP_PERCENT_FIELDS) {
        const val = record[field];
        if (val === undefined || val === null) continue;
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

      // Plain rates
      for (const field of DP_RATE_FIELDS) {
        const val = record[field];
        if (val === undefined || val === null) continue;
        const label = DP_LABELS[field] || field;
        pctRows.push(`
          <div class="ct-dp-rate-row" role="listitem">
            <span class="ct-dp-rate-label">${esc(label)}</span>
            <span class="ct-dp-rate-value ct-dp-rate--neutral">${Number(val).toFixed(2)}</span>
          </div>`);
      }

      if (!pctRows.length) return '';
      return `<div>
        <p class="ct-dp-section-title">Rates &amp; Percentages</p>
        <div class="ct-dp-rates" role="list">${pctRows.join('')}</div>
      </div>`;
    },

    _renderTimestamps(record) {
      const items = [];

      // data_date
      if (record.data_date) {
        items.push(`<div class="ct-dp-ts-item">
          <span class="ct-dp-ts-label">Data Date</span>
          <span class="ct-dp-ts-val">${esc(String(record.data_date))}</span>
        </div>`);
      }

      // last_updated_time
      if (record.last_updated_time) {
        items.push(`<div class="ct-dp-ts-item">
          <span class="ct-dp-ts-label">Last Updated</span>
          <span class="ct-dp-ts-val">${esc(dpFormatValue('last_updated_time', record.last_updated_time))}</span>
        </div>`);
      }

      // messageTimestamp
      if (record.messageTimestamp !== undefined && record.messageTimestamp !== null) {
        items.push(`<div class="ct-dp-ts-item">
          <span class="ct-dp-ts-label">Message Timestamp</span>
          <span class="ct-dp-ts-val">${esc(dpFormatValue('messageTimestamp', record.messageTimestamp))}</span>
        </div>`);
      }

      if (!items.length) return '';
      return `<div class="ct-dp-full-col">
        <div class="ct-dp-ts-row" aria-label="Timestamps">${items.join('')}</div>
      </div>`;
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE: DVIC CHECK
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Normalised per-vehicle model:
   *   vehicleIdentifier : string
   *   preTripTotal      : number   – totalInspectionsDone for PRE_TRIP_DVIC
   *   postTripTotal     : number   – totalInspectionsDone for POST_TRIP_DVIC
   *   missingCount      : number   – preTripTotal - postTripTotal (0 if OK)
   *   status            : "OK" | "Post Trip DVIC Missing"
   *   reporterIds       : string[] – unique reporter IDs across both trip types
   *   reporterNames     : string[] – resolved employee names (fallback to ID)
   *
   * Employee name batch API contract (adapt endpoint as needed):
   *   Request : GET /fleet-management/api/employees?employeeIds=A&employeeIds=B
   *   Response: Array<{ employeeId: string, name: string }> or
   *             { employees: Array<{ employeeId, name }> }
   *   Fallback: display reporterId when endpoint fails or ID is unknown.
   *
   * Sample payloads (UI-ready):
   *
   *  OK vehicle:
   *  { vehicleIdentifier:"VAN-001", preTripTotal:3, postTripTotal:3,
   *    missingCount:0, status:"OK",
   *    reporterIds:["E123","E456"], reporterNames:["Anna Müller","Ben Berg"] }
   *
   *  Missing vehicle:
   *  { vehicleIdentifier:"VAN-042", preTripTotal:4, postTripTotal:2,
   *    missingCount:2, status:"Post Trip DVIC Missing",
   *    reporterIds:["E789"], reporterNames:["E789"] }   // ID used as fallback
   *
   *  Aggregated view example:
   *  | VAN-042 | 2 | E789                |
   *  | VAN-017 | 1 | Clara Kohl, Dirk Wu |
   */

  const dvicCheck = {
    _overlayEl: null,
    _active: false,
    _vehicles: [],         // normalized vehicle records after enrichment
    _nameCache: new Map(), // reporterId → displayName, persists across opens
    _lastTimestamp: null,
    _loading: false,

    // Pagination state (separate per tab)
    _pageSize: 25,
    _pageCurrent: 1,
    _pageMissing: 1,
    _currentTab: 'all', // 'all' | 'missing'

    // ── Lifecycle ─────────────────────────────────────────
    init() {
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

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.hide();
      });
      document.getElementById('ct-dvic-close').addEventListener('click', () => this.hide());

      // Tab switching via event delegation
      overlay.querySelector('.ct-dvic-tabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.ct-dvic-tab');
        if (!btn) return;
        this._switchTab(btn.dataset.tab);
      });

      onDispose(() => this.dispose());
      log('DVIC Check initialized');
    },

    dispose() {
      if (this._overlayEl) { this._overlayEl.remove(); this._overlayEl = null; }
      this._vehicles = [];
      this._active = false;
      this._lastTimestamp = null;
      this._loading = false;
      // intentionally keep _nameCache alive across dispose/re-init cycles
    },

    toggle() {
      if (!config.features.dvicCheck) {
        alert('DVIC Check ist deaktiviert. Bitte in den Einstellungen aktivieren.');
        return;
      }
      this.init();
      if (this._active) this.hide(); else this.show();
    },

    show() {
      this.init();
      this._overlayEl.classList.add('visible');
      this._active = true;
      // Reset to first page and "all" tab on each open, then re-fetch
      this._pageCurrent = 1;
      this._pageMissing = 1;
      this._currentTab = 'all';
      this._switchTab('all');
      this._refresh();
    },

    hide() {
      if (this._overlayEl) this._overlayEl.classList.remove('visible');
      this._active = false;
    },

    // ── Tab management ───────────────────────────────────
    _switchTab(tab) {
      this._currentTab = tab;
      this._overlayEl.querySelectorAll('.ct-dvic-tab').forEach((btn) => {
        const active = btn.dataset.tab === tab;
        btn.classList.toggle('ct-dvic-tab--active', active);
        btn.setAttribute('aria-selected', String(active));
      });
      if (this._vehicles.length > 0) this._renderBody();
    },

    // ── Timestamp: today's midnight in Europe/Berlin ─────
    _getTodayBremenTimestamp() {
      const now = new Date();
      // 'sv' locale always outputs "YYYY-MM-DD"
      const dateStr = now.toLocaleDateString('sv', { timeZone: 'Europe/Berlin' });
      const [y, mo, d] = dateStr.split('-').map(Number);

      // Determine UTC offset by inspecting what Berlin time is at 06:00 UTC on that day
      const utcRef = new Date(Date.UTC(y, mo - 1, d, 6, 0, 0));
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Berlin',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      }).formatToParts(utcRef);
      const berlinH = parseInt(parts.find((p) => p.type === 'hour').value, 10) % 24;
      const berlinM = parseInt(parts.find((p) => p.type === 'minute').value, 10);
      const offsetMinutes = (berlinH * 60 + berlinM) - 6 * 60; // offset relative to UTC+0

      // Berlin midnight = UTC midnight minus offset
      return Date.UTC(y, mo - 1, d) - offsetMinutes * 60000;
    },

    // ── API ──────────────────────────────────────────────
    async _fetchInspectionStats(timestamp) {
      const url =
        `https://logistics.amazon.de/fleet-management/api/inspection-stats` +
        `?startTimestamp=${timestamp}`;
      const csrf = getCSRFToken();
      const headers = { Accept: 'application/json' };
      if (csrf) headers['anti-csrftoken-a2z'] = csrf;

      const resp = await withRetry(async () => {
        const r = await fetch(url, { method: 'GET', headers, credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
        return r;
      }, { retries: 2, baseMs: 800 });

      return resp.json();
    },

    // ── Employee name batch lookup ────────────────────────
    /**
     * Batch fetch employee names for an array of reporterIds.
     * Returns a Map<id, resolvedDisplayName>.
     *
     * Batch API contract (adjust endpoint as needed):
     *   GET /fleet-management/api/employees?employeeIds=A&employeeIds=B…
     *   Response: Array<{employeeId, name}> or {employees:[…]} or {data:[…]}
     *
     * Falls back to the reporterId as the display name when:
     *   – the request fails, or
     *   – the ID is not present in the response.
     *
     * @param {string[]} reporterIds
     * @returns {Promise<Map<string, string>>}
     */
    async _getEmployeeNames(reporterIds) {
      const unique = [...new Set(reporterIds)];
      const uncached = unique.filter((id) => !this._nameCache.has(id));

      if (uncached.length > 0) {
        try {
          const csrf = getCSRFToken();
          const headers = { Accept: 'application/json' };
          if (csrf) headers['anti-csrftoken-a2z'] = csrf;

          // Build query string: ?employeeIds=A&employeeIds=B…
          const qs = uncached
            .map((id) => `employeeIds=${encodeURIComponent(id)}`)
            .join('&');

          const resp = await fetch(
            `https://logistics.amazon.de/fleet-management/api/employees?${qs}`,
            { method: 'GET', headers, credentials: 'include' }
          );

          if (resp.ok) {
            const json = await resp.json();
            // Tolerate Array or wrapped shapes
            const list = Array.isArray(json)
              ? json
              : (json?.employees || json?.data || json?.results || []);

            if (Array.isArray(list)) {
              for (const emp of list) {
                const id = String(
                  emp.employeeId ?? emp.id ?? emp.reporterId ?? ''
                );
                const name =
                  emp.name ?? emp.employeeName ?? emp.fullName ?? emp.displayName ?? '';
                if (id && name) this._nameCache.set(id, name);
              }
            }
          }
        } catch (e) {
          log('Employee batch lookup failed (non-fatal, IDs used as fallback):', e);
        }
      }

      // Build result map — fall back to ID string for unresolved entries
      const result = new Map();
      for (const id of reporterIds) {
        result.set(id, this._nameCache.get(id) || id);
      }
      return result;
    },

    // ── Data normalisation ────────────────────────────────
    /**
     * Normalise one element from inspectionsStatList into the output model.
     * Guards against nulls/undefined/missing arrays.
     *
     * Output model (all fields guaranteed present):
     *   vehicleIdentifier : string
     *   preTripTotal      : number  – totalInspectionsDone for PRE_TRIP_DVIC  (0 when absent)
     *   postTripTotal     : number  – totalInspectionsDone for POST_TRIP_DVIC (0 when absent)
     *   missingCount      : number  – preTripTotal − postTripTotal (≥ 0; 0 when status=OK)
     *   status            : "OK" | "Post Trip DVIC Missing"
     *   inspectedAt       : string|null  – most recent inspectedAt across both trip types (ISO-8601 if present)
     *   shiftDate         : string|null  – shiftDate from the stat entry (date string if present)
     *   reporterIds       : string[]
     *   reporterNames     : string[]  – filled after batch name lookup
     */
    _normalizeVehicle(vehicleStat) {
      const vehicleIdentifier = String(vehicleStat?.vehicleIdentifier ?? '').trim() || 'Unknown';
      const inspStats = Array.isArray(vehicleStat?.inspectionStats)
        ? vehicleStat.inspectionStats
        : [];

      // Always resolve both trip-type entries explicitly; normalise VIN whitespace on lookup
      const preStat  = inspStats.find((s) => s?.type === 'PRE_TRIP_DVIC')  ?? null;
      const postStat = inspStats.find((s) => s?.type === 'POST_TRIP_DVIC') ?? null;

      const preTripTotal  = Number(preStat?.totalInspectionsDone  ?? 0);
      const postTripTotal = Number(postStat?.totalInspectionsDone ?? 0);

      // status=OK whenever pre ≤ post (including both-zero = no inspection day)
      const missingDVIC = preTripTotal - postTripTotal;
      const status      = missingDVIC > 0 ? 'Post Trip DVIC Missing' : 'OK';
      const missingCount = status === 'OK' ? 0 : missingDVIC;

      // Extract timestamps if the API returns them (forward-compatible)
      const candidateDates = [preStat, postStat]
        .filter(Boolean)
        .map((s) => s.inspectedAt ?? s.lastInspectedAt ?? null)
        .filter(Boolean);
      const inspectedAt = candidateDates.length > 0
        ? candidateDates.sort().at(-1)   // most recent
        : null;
      const shiftDate = preStat?.shiftDate ?? postStat?.shiftDate ?? null;

      // Collect unique reporter IDs across both trip types
      const reporterIdSet = new Set();
      for (const stat of inspStats) {
        const details = Array.isArray(stat?.inspectionDetails) ? stat.inspectionDetails : [];
        for (const detail of details) {
          const rid = detail?.reporterId;
          if (rid != null && String(rid).trim() !== '') reporterIdSet.add(String(rid).trim());
        }
      }

      return {
        vehicleIdentifier,
        preTripTotal,
        postTripTotal,
        missingCount,
        status,
        inspectedAt,
        shiftDate,
        reporterIds: [...reporterIdSet],
        reporterNames: [], // filled after batch name lookup
      };
    },

    /**
     * Parse the full API JSON into an array of normalised vehicle records.
     * Returns [] for an empty day; throws on truly unexpected shapes.
     */
    _processApiResponse(json) {
      if (json === null || typeof json !== 'object') {
        throw new Error('API response is not a JSON object');
      }
      const list = json?.inspectionsStatList;
      if (list === undefined || list === null) return []; // valid empty response
      if (!Array.isArray(list)) {
        throw new Error(
          `inspectionsStatList has unexpected type: ${typeof list}`
        );
      }
      return list.map((v) => this._normalizeVehicle(v));
    },

    // ── Refresh (main data-fetch flow) ────────────────────
    async _refresh() {
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
      this._setBody(
        '<div class="ct-dvic-loading" role="status">Daten werden geladen…</div>'
      );

      try {
        const json = await this._fetchInspectionStats(ts);

        let vehicles;
        try {
          vehicles = this._processApiResponse(json);
        } catch (parseErr) {
          err('DVIC response parse error:', parseErr);
          this._setBody(`
            <div class="ct-dvic-error" role="alert">
              ⚠️ DVIC data unavailable for this date.<br>
              <small>${esc(parseErr.message)}</small>
            </div>`);
          this._setStatus('⚠️ Daten konnten nicht verarbeitet werden.');
          this._loading = false;
          return;
        }

        // --- Batch employee-name lookup ---
        const allIds = [...new Set(vehicles.flatMap((v) => v.reporterIds))];
        if (allIds.length > 0) {
          this._setStatus('⏳ Lade Mitarbeiternamen…');
          try {
            const nameMap = await this._getEmployeeNames(allIds);
            for (const v of vehicles) {
              v.reporterNames = [
                ...new Set(v.reporterIds.map((id) => nameMap.get(id) || id)),
              ];
            }
          } catch (nameErr) {
            log('Name enrichment failed, using IDs as fallback:', nameErr);
            for (const v of vehicles) {
              v.reporterNames = [...v.reporterIds];
            }
          }
        } else {
          for (const v of vehicles) { v.reporterNames = []; }
        }

        this._vehicles = vehicles;

        const missingVehicles = vehicles.filter((v) => v.status !== 'OK').length;
        const totalMissing    = vehicles.reduce((s, v) => s + v.missingCount, 0);

        this._setStatus(
          `✅ ${vehicles.length} Fahrzeuge | ` +
          `${missingVehicles} mit fehlendem Post-Trip DVIC | ` +
          `${totalMissing} fehlende DVICs gesamt`
        );
        // Update "as of" freshness timestamp
        const asOfEl = document.getElementById('ct-dvic-asof');
        if (asOfEl) {
          const fetchedAt = new Date().toLocaleString('de-DE', {
            timeZone: 'Europe/Berlin',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
          asOfEl.textContent = `Stand: ${fetchedAt} (Daten ab ${dateLabel})`;
        }
        this._renderTiles(vehicles.length, missingVehicles, totalMissing);
        this._updateMissingTabBadge(missingVehicles);
        this._renderBody();

      } catch (e) {
        err('DVIC fetch failed:', e);
        this._setBody(`
          <div class="ct-dvic-error" role="alert">
            ❌ DVIC-Daten konnten nicht geladen werden.<br>
            <small>${esc(e.message)}</small><br><br>
            <button class="ct-btn ct-btn--accent" id="ct-dvic-retry">🔄 Erneut versuchen</button>
          </div>`);
        this._setStatus('❌ Fehler beim Laden.');
        document.getElementById('ct-dvic-retry')?.addEventListener(
          'click', () => this._refresh()
        );
      } finally {
        this._loading = false;
      }
    },

    // ── Status / body helper setters ─────────────────────
    _setStatus(msg) {
      const el = document.getElementById('ct-dvic-status');
      if (el) el.textContent = msg;
    },
    _setBody(html) {
      const el = document.getElementById('ct-dvic-body');
      if (el) el.innerHTML = html;
    },
    _setTiles(html) {
      const el = document.getElementById('ct-dvic-tiles');
      if (el) el.innerHTML = html;
    },
    _updateMissingTabBadge(count) {
      const tab = document.getElementById('ct-dvic-tab-missing');
      if (tab) {
        tab.textContent = count > 0 ? `⚠️ DVIC Fehlend (${count})` : '⚠️ DVIC Fehlend';
      }
    },

    // ── Rendering: summary tiles ──────────────────────────
    _renderTiles(total, missingVehicles, missingTotal) {
      const errCls =
        missingVehicles === 0 ? 'ct-dvic-tile--ok' :
        missingVehicles < 5  ? 'ct-dvic-tile--warn' :
        'ct-dvic-tile--danger';

      this._setTiles(`
        <div class="ct-dvic-tiles">
          <div class="ct-dvic-tile">
            <div class="ct-dvic-tile-val">${total}</div>
            <div class="ct-dvic-tile-lbl">Fahrzeuge gesamt</div>
          </div>
          <div class="ct-dvic-tile ${errCls}">
            <div class="ct-dvic-tile-val">${missingVehicles}</div>
            <div class="ct-dvic-tile-lbl">Fahrzeuge mit Fehler</div>
          </div>
          <div class="ct-dvic-tile ${missingTotal === 0 ? 'ct-dvic-tile--ok' : 'ct-dvic-tile--danger'}">
            <div class="ct-dvic-tile-val">${missingTotal}</div>
            <div class="ct-dvic-tile-lbl">DVIC fehlend gesamt</div>
          </div>
          <div class="ct-dvic-tile ${missingVehicles === 0 ? 'ct-dvic-tile--ok' : ''}">
            <div class="ct-dvic-tile-val">${total - missingVehicles}</div>
            <div class="ct-dvic-tile-lbl">Fahrzeuge OK</div>
          </div>
        </div>
      `);
    },

    // ── Rendering: body dispatcher ────────────────────────
    _renderBody() {
      if (!this._overlayEl) return;
      if (this._vehicles.length === 0) {
        this._setBody(
          '<div class="ct-dvic-empty">Keine DVIC-Daten verfügbar für dieses Datum.</div>'
        );
        return;
      }
      if (this._currentTab === 'all') {
        this._renderAllTab();
      } else {
        this._renderMissingTab();
      }
    },

    // ── Rendering: "All Vehicles" tab ─────────────────────
    _renderAllTab() {
      const page   = this._pageCurrent;
      const total  = this._vehicles.length;
      const totalPages = Math.ceil(total / this._pageSize);
      const start  = (page - 1) * this._pageSize;
      const slice  = this._vehicles.slice(start, start + this._pageSize);

      const rows = slice.map((v, i) => {
        const idx       = start + i;
        const isMissing = v.status !== 'OK';
        const rowCls    = isMissing ? 'ct-dvic-row--missing' : '';
        const badgeCls  = isMissing ? 'ct-dvic-badge--missing' : 'ct-dvic-badge--ok';
        const expandBtn = isMissing
          ? `<button class="ct-dvic-expand-btn" data-expand="${idx}"
                     aria-expanded="false" aria-controls="ct-dvic-detail-${idx}">▶ Details</button>`
          : '';

        return `
          <tr class="${rowCls}" role="row">
            <td>${esc(v.vehicleIdentifier)}</td>
            <td>${v.preTripTotal}</td>
            <td>${v.postTripTotal}</td>
            <td>${v.missingCount > 0 ? `<strong>${v.missingCount}</strong>` : '0'}</td>
            <td><span class="${badgeCls}">${esc(v.status)}</span></td>
            <td>${expandBtn}</td>
          </tr>
          ${isMissing ? `
          <tr id="ct-dvic-detail-${idx}" class="ct-dvic-detail-row" aria-hidden="true">
            <td class="ct-dvic-detail-cell" colspan="6">
              <strong>Transporter:</strong>
              ${v.reporterNames.length > 0
                ? esc(v.reporterNames.join(', '))
                : '<em>Keine Daten</em>'}
              ${v.reporterIds.length > 0
                ? `<span style="color:#999;font-size:10px;margin-left:8px;">[IDs: ${esc(v.reporterIds.join(', '))}]</span>`
                : ''}
            </td>
          </tr>` : ''}`;
      }).join('');

      this._setBody(`
        <div role="tabpanel" aria-labelledby="ct-dvic-tab-all">
          <table class="ct-table" role="grid">
            <thead>
              <tr>
                <th scope="col">Fahrzeug</th>
                <th scope="col" title="Anzahl abgeschlossener PRE_TRIP_DVIC-Inspektionen (totalInspectionsDone)">Pre-Trip ✓</th>
                <th scope="col" title="Anzahl abgeschlossener POST_TRIP_DVIC-Inspektionen (totalInspectionsDone)">Post-Trip ✓</th>
                <th scope="col" title="Pre-Trip − Post-Trip (fehlende Post-Trip DVICs)">Fehlend</th>
                <th scope="col">Status</th>
                <th scope="col" style="width:80px;"></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${this._renderPagination(total, page, totalPages, 'all')}
        </div>
      `);

      this._attachExpandHandlers();
      this._attachPaginationHandlers('all');
    },

    // ── Rendering: "Missing DVIC" aggregated tab ──────────
    _renderMissingTab() {
      const missing = this._vehicles.filter((v) => v.status !== 'OK');

      if (missing.length === 0) {
        this._setBody(
          '<div class="ct-dvic-empty">✅ Alle Fahrzeuge haben Post-Trip DVICs — kein Handlungsbedarf.</div>'
        );
        return;
      }

      const page       = this._pageMissing;
      const totalPages = Math.ceil(missing.length / this._pageSize);
      const start      = (page - 1) * this._pageSize;
      const slice      = missing.slice(start, start + this._pageSize);

      const rows = slice.map((v) => `
        <tr class="ct-dvic-row--missing" role="row">
          <td>${esc(v.vehicleIdentifier)}</td>
          <td>${v.preTripTotal}</td>
          <td>${v.postTripTotal}</td>
          <td><strong>${v.missingCount}</strong></td>
          <td>${v.reporterNames.length > 0
            ? esc(v.reporterNames.join(', '))
            : '<em>—</em>'}</td>
        </tr>`).join('');

      this._setBody(`
        <div role="tabpanel" aria-labelledby="ct-dvic-tab-missing">
          <table class="ct-table" role="grid">
            <thead>
              <tr>
                <th scope="col">Fahrzeug</th>
                <th scope="col" title="Anzahl abgeschlossener PRE_TRIP_DVIC-Inspektionen (totalInspectionsDone)">Pre-Trip ✓</th>
                <th scope="col" title="Anzahl abgeschlossener POST_TRIP_DVIC-Inspektionen (totalInspectionsDone)">Post-Trip ✓</th>
                <th scope="col" title="Pre-Trip − Post-Trip (fehlende Post-Trip DVICs)">Fehlend</th>
                <th scope="col">Transporter</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          ${this._renderPagination(missing.length, page, totalPages, 'missing')}
        </div>
      `);

      this._attachPaginationHandlers('missing');
    },

    // ── Rendering: pagination controls ───────────────────
    _renderPagination(total, current, totalPages, tabKey) {
      if (totalPages <= 1) return '';
      return `
        <div class="ct-dvic-pagination">
          <button class="ct-btn ct-btn--secondary ct-dvic-prev-page" data-tab="${tabKey}"
                  aria-label="Vorherige Seite" ${current <= 1 ? 'disabled' : ''}>&#8249; Zurück</button>
          <span class="ct-dvic-page-info">Seite ${current} / ${totalPages} (${total} Einträge)</span>
          <button class="ct-btn ct-btn--secondary ct-dvic-next-page" data-tab="${tabKey}"
                  aria-label="Nächste Seite" ${current >= totalPages ? 'disabled' : ''}>Weiter &#8250;</button>
        </div>`;
    },

    // ── Event binding ─────────────────────────────────────
    _attachExpandHandlers() {
      const body = document.getElementById('ct-dvic-body');
      if (!body) return;
      body.querySelectorAll('.ct-dvic-expand-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx       = btn.dataset.expand;
          const detailRow = document.getElementById(`ct-dvic-detail-${idx}`);
          if (!detailRow) return;
          const isNowVisible = !detailRow.classList.contains('visible');
          detailRow.classList.toggle('visible', isNowVisible);
          detailRow.setAttribute('aria-hidden', String(!isNowVisible));
          btn.setAttribute('aria-expanded', String(isNowVisible));
          btn.textContent = isNowVisible ? '▼ Details' : '▶ Details';
        });
      });
    },

    _attachPaginationHandlers(tabKey) {
      const body = document.getElementById('ct-dvic-body');
      if (!body) return;

      body.querySelector(`.ct-dvic-prev-page[data-tab="${tabKey}"]`)
        ?.addEventListener('click', () => {
          if (tabKey === 'all') {
            if (this._pageCurrent > 1) { this._pageCurrent--; this._renderAllTab(); }
          } else {
            if (this._pageMissing > 1) { this._pageMissing--; this._renderMissingTab(); }
          }
        });

      body.querySelector(`.ct-dvic-next-page[data-tab="${tabKey}"]`)
        ?.addEventListener('click', () => {
          const total = tabKey === 'all'
            ? this._vehicles.length
            : this._vehicles.filter((v) => v.status !== 'OK').length;
          const totalPages = Math.ceil(total / this._pageSize);
          if (tabKey === 'all') {
            if (this._pageCurrent < totalPages) { this._pageCurrent++; this._renderAllTab(); }
          } else {
            if (this._pageMissing < totalPages) { this._pageMissing++; this._renderMissingTab(); }
          }
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

        ${toggleHTML('ct-set-whc',  'WHC Dashboard', config.features.whcDashboard)}
        ${toggleHTML('ct-set-dre',  'Date Range Extractor', config.features.dateExtractor)}
        ${toggleHTML('ct-set-dp',   'Daily Delivery Performance', config.features.deliveryPerf)}
        ${toggleHTML('ct-set-dvic', 'DVIC Check', config.features.dvicCheck)}
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
