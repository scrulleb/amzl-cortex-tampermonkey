// ui/styles.ts – All CSS definitions, injected via GM_addStyle

/** Base styles: variables, layout primitives, buttons, tables, toggles */
export const CSS_BASE = `
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
`;

/** Delivery Performance Dashboard CSS */
export const CSS_DELIVERY_PERF = `
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
`;

/** DVIC Check CSS */
export const CSS_DVIC = `
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

  @media (max-width: 680px) {
    .ct-dvic-table { display: block; overflow-x: auto; }
    .ct-dvic-tp-cell { display: block; max-width: 100%; }
  }
`;

/** Working Hours Dashboard CSS */
export const CSS_WORKING_HOURS = `
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

/** Returns Dashboard CSS */
export const CSS_RETURNS = `
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

/** Scorecard Dashboard CSS */
export const CSS_SCORECARD = `
  /* ── Scorecard Dashboard ─────────────────────────────── */
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

/** VSA QR Code Generator CSS */
export const CSS_VSA_QR = `
  /* ── VSA QR Code Generator ─────────────────────────── */
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

/** Inject all CSS blocks into the page. */
export function injectStyles(): void {
  GM_addStyle(CSS_BASE);
  GM_addStyle(CSS_DELIVERY_PERF);
  GM_addStyle(CSS_DVIC);
  GM_addStyle(CSS_WORKING_HOURS);
  GM_addStyle(CSS_RETURNS);
  GM_addStyle(CSS_SCORECARD);
  GM_addStyle(CSS_VSA_QR);
}
