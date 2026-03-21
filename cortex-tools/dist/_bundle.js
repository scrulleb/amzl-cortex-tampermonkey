"use strict";(()=>{var E={enabled:!0,dev:!1,serviceAreaId:"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",deliveryPerfStation:"XYZ1",deliveryPerfDsp:"TEST",features:{whcDashboard:!0,dateExtractor:!0,deliveryPerf:!0,dvicCheck:!0,dvicShowTransporters:!0,workingHours:!0,returnsDashboard:!0,scorecard:!0}},it="ct_config";function J(){let i=GM_getValue(it,null);if(!i)return JSON.parse(JSON.stringify(E));try{let t=typeof i=="string"?JSON.parse(i):i;return{...E,...t,features:{...E.features,...t.features||{}},deliveryPerfStation:t.deliveryPerfStation||E.deliveryPerfStation,deliveryPerfDsp:t.deliveryPerfDsp||E.deliveryPerfDsp}}catch{return JSON.parse(JSON.stringify(E))}}function L(i){GM_setValue(it,JSON.stringify(i))}var ot="[CortexTools]",Q=["Mo","Di","Mi","Do","Fr","Sa","So"],ct="https://logistics.amazon.de/scheduling/home/api/v2/associate-attributes",N=null;function dt(i){N=i}var y=(...i)=>{N!=null&&N.dev&&console.log(ot,...i)},w=(...i)=>{console.error(ot,...i)},Z=[];function S(i){return Z.push(i),i}function lt(){for(;Z.length;)try{Z.pop()()}catch{}}function u(i){return String(i).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function pt(i,{timeout:t=15e3}={}){return new Promise((e,r)=>{let a=document.querySelector(i);if(a)return e(a);let n=new MutationObserver(()=>{let s=document.querySelector(i);s&&(n.disconnect(),e(s))});n.observe(document,{childList:!0,subtree:!0}),t&&setTimeout(()=>{n.disconnect(),r(new Error(`Timeout waiting for ${i}`))},t)})}function P(i){return new Promise(t=>setTimeout(t,i))}async function T(i,{retries:t=3,baseMs:e=500}={}){let r=0;for(;;)try{return await i()}catch(a){if(++r>t)throw a;await P(e*2**(r-1))}}function D(){let i=document.querySelector('meta[name="anti-csrftoken-a2z"]');if(i)return i.getAttribute("content");let t=document.cookie.split(";");for(let e of t){let[r,a]=e.trim().split("=");if(r==="anti-csrftoken-a2z")return a}return null}function F(){let i=document.cookie.match(/session-id=([^;]+)/);return i?i[1]:null}function k(){return new Date().toISOString().split("T")[0]}function ut(i,t){let e=new Date(i+"T00:00:00");return e.setDate(e.getDate()+t),e.toISOString().split("T")[0]}var O=class{constructor(t){this.config=t}_loaded=!1;_loading=null;_serviceAreas=[];_dspCode=null;_defaultStation=null;_defaultServiceAreaId=null;async load(){if(!this._loaded){if(this._loading)return this._loading;this._loading=this._doLoad(),await this._loading,this._loaded=!0,this._loading=null}}async _doLoad(){var t,e,r,a;try{let s=await(await fetch("https://logistics.amazon.de/account-management/data/get-company-service-areas",{credentials:"include"})).json();s.success&&Array.isArray(s.data)&&s.data.length>0&&(this._serviceAreas=s.data,this._defaultServiceAreaId=s.data[0].serviceAreaId,this._defaultStation=s.data[0].stationCode,y("Loaded",s.data.length,"service areas"))}catch(n){w("Failed to load service areas:",n)}try{let s=await(await fetch("https://logistics.amazon.de/account-management/data/get-company-details",{credentials:"include"})).json(),o=((t=s==null?void 0:s.data)==null?void 0:t.dspShortCode)||((e=s==null?void 0:s.data)==null?void 0:e.companyShortCode)||((r=s==null?void 0:s.data)==null?void 0:r.shortCode)||(s==null?void 0:s.dspShortCode)||null;o&&(this._dspCode=String(o).toUpperCase(),y("Auto-detected DSP code:",this._dspCode))}catch{y("Company details not available, will detect DSP from performance data")}if(!this._dspCode)try{let n=document.querySelector('[data-testid="company-name"], .company-name, .dsp-name');if(n){let s=((a=n.textContent)==null?void 0:a.trim())??"";s&&s.length<=10&&(this._dspCode=s.toUpperCase(),y("DSP code from page element:",this._dspCode))}}catch{}this._dspCode||(this._dspCode=this.config.deliveryPerfDsp||E.deliveryPerfDsp,y("Using saved DSP code:",this._dspCode)),this._defaultStation||(this._defaultStation=this.config.deliveryPerfStation||E.deliveryPerfStation),this._defaultServiceAreaId||(this._defaultServiceAreaId=this.config.serviceAreaId||E.serviceAreaId)}getServiceAreas(){return this._serviceAreas}getDspCode(){return this._dspCode||this.config.deliveryPerfDsp||E.deliveryPerfDsp}getDefaultStation(){return this._defaultStation||this.config.deliveryPerfStation||E.deliveryPerfStation}getDefaultServiceAreaId(){return this._defaultServiceAreaId||this.config.serviceAreaId||E.serviceAreaId}buildSaOptions(t){if(this._serviceAreas.length===0){let r=t||this.getDefaultServiceAreaId();return`<option value="${u(r)}">${u(this.getDefaultStation())}</option>`}let e=t||this.getDefaultServiceAreaId();return this._serviceAreas.map(r=>{let a=r.serviceAreaId===e?" selected":"";return`<option value="${u(r.serviceAreaId)}"${a}>${u(r.stationCode)}</option>`}).join("")}populateSaSelect(t,e){t&&(t.innerHTML=this.buildSaOptions(e))}};var Pt=`
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
`,Bt=`
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
`,Ht=`
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
`,Nt=`
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
`,Ft=`
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
`,Ot=`
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
`;function gt(){GM_addStyle(Pt),GM_addStyle(Bt),GM_addStyle(Ht),GM_addStyle(Nt),GM_addStyle(Ft),GM_addStyle(Ot)}var z=class{constructor(t,e){this.config=t;this.companyConfig=e}_active=!1;_overlayEl=null;_nameMap={};_associates=[];_lastQueryResult=null;_lastQueryMode=null;init(){if(this._overlayEl)return;let t=document.createElement("div");t.id="ct-whc-overlay",t.className="ct-overlay",t.innerHTML=`
      <div class="ct-panel">
        <h2>\u{1F4CA} DA WHC-Dashboard</h2>
        <div class="ct-controls">
          <label>Datum:</label>
          <input type="date" id="ct-whc-date" class="ct-input" value="${k()}">
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
    `,document.body.appendChild(t),this._overlayEl=t,t.addEventListener("click",e=>{e.target===t&&this.hide()}),document.getElementById("ct-whc-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-whc-go").addEventListener("click",()=>this._runQuery()),document.getElementById("ct-whc-export").addEventListener("click",()=>this._exportCSV()),this.companyConfig.load().then(()=>{this.companyConfig.populateSaSelect(document.getElementById("ct-whc-sa"))}),S(()=>this.dispose()),y("WHC Dashboard initialized")}dispose(){var t;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._active=!1,this._nameMap={},this._associates=[],this._lastQueryResult=null,this._lastQueryMode=null}toggle(){if(!this.config.features.whcDashboard){alert("WHC Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}_resolveName(t){return this._nameMap[t]||t}_minsToHM(t){if(t==null||t===0)return"-";let e=Math.floor(t/60),r=t%60;return`${e}h ${r.toString().padStart(2,"0")}m`}_minsClass(t){return!t||t===0?"ct-nodata":t>600?"ct-danger":t>540?"ct-warn":"ct-ok"}_getMonday(t){let e=new Date(t+"T00:00:00"),r=e.getDay(),a=e.getDate()-r+(r===0?-6:1);return e.setDate(a),e.toISOString().split("T")[0]}_addDays(t,e){let r=new Date(t+"T00:00:00");return r.setDate(r.getDate()+e),r.toISOString().split("T")[0]}_getSelectedSaId(){let t=document.getElementById("ct-whc-sa");return t&&t.value?t.value:this.companyConfig.getDefaultServiceAreaId()}async _fetchNames(t,e){let r=this._getSelectedSaId(),a=`https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${t}&serviceAreaId=${r}&toDate=${e||t}`,n=D(),s={Accept:"application/json"};n&&(s["anti-csrftoken-a2z"]=n);let o=await fetch(a,{method:"GET",headers:s,credentials:"include"});if(!o.ok)throw new Error(`Roster API Fehler ${o.status}`);let c=await o.json(),l=Array.isArray(c)?c:(c==null?void 0:c.data)||(c==null?void 0:c.rosters)||[],d=new Set,p=m=>{for(let f of m)f.driverPersonId&&(d.add(f.driverPersonId),f.driverName&&(this._nameMap[f.driverPersonId]=f.driverName))};if(Array.isArray(l))p(l);else if(typeof l=="object")for(let m of Object.values(l))Array.isArray(m)&&p(m);this._associates=[...d],y(`${this._associates.length} Fahrer gefunden, ${Object.keys(this._nameMap).length} Namen geladen`)}async _fetchDay(t){let e={associatesList:this._associates,date:t,mode:"daily",serviceAreaId:this._getSelectedSaId()},r=D(),a={"Content-Type":"application/json",Accept:"application/json"};r&&(a["anti-csrftoken-a2z"]=r);let n=await fetch(ct,{method:"POST",headers:a,body:JSON.stringify(e),credentials:"include"});if(!n.ok)throw new Error(`API Fehler ${n.status} f\xFCr ${t}`);return n.json()}_extractDayData(t){var a;let e={},r=((a=t==null?void 0:t.data)==null?void 0:a.daWorkSummaryAndEligibility)||{};for(let[n,s]of Object.entries(r)){let o=s==null?void 0:s.workSummary;o&&(e[n]={scheduledDay:o.daScheduledDayMins||0,actualDay:o.daActualWorkDayMins||0,scheduledWeek:o.daScheduledWeekMins||0,actualWeek:o.daActualWorkWeekMins||0,last7Days:o.daScheduledLast7DaysMins||0,breached:o.isDailyLeapThresholdBreached||!1})}return e}_renderSingleDay(t,e){return`
      <table class="ct-table">
        <thead><tr>
          <th>Fahrer</th><th>Geplant (Tag)</th><th>Ist (Tag)</th>
          <th>Geplant (Woche)</th><th>Ist (Woche)</th>
          <th>Letzten 7 Tage</th><th>Threshold Breach</th>
        </tr></thead>
        <tbody>${Object.entries(e).sort((a,n)=>n[1].actualDay-a[1].actualDay).map(([a,n])=>`<tr class="${n.breached?"ct-breach":""}">
          <td title="${u(a)}">${u(this._resolveName(a))}</td>
          <td>${this._minsToHM(n.scheduledDay)}</td>
          <td class="${this._minsClass(n.actualDay)}">${this._minsToHM(n.actualDay)}</td>
          <td>${this._minsToHM(n.scheduledWeek)}</td>
          <td>${this._minsToHM(n.actualWeek)}</td>
          <td>${this._minsToHM(n.last7Days)}</td>
          <td>${n.breached?"\u26A0\uFE0F JA":"\u2705 Nein"}</td>
        </tr>`).join("")}</tbody>
      </table>
    `}_renderWeek(t){let e=Object.keys(t).sort(),r=new Set;for(let o of Object.values(t))for(let c of Object.keys(o))r.add(c);let a=e.map((o,c)=>`<th colspan="2">${u(Q[c]??o)} (${u(o.slice(5))})</th>`).join(""),n=e.map(()=>"<th>Geplant</th><th>Ist</th>").join(""),s=[...r].map(o=>{let c=0,l=!1,d=0,p=e.map(h=>{var _;let v=(_=t[h])==null?void 0:_[o];return v?(c+=v.actualDay,v.breached&&(l=!0),d=v.actualWeek,`<td>${this._minsToHM(v.scheduledDay)}</td>
                  <td class="${this._minsClass(v.actualDay)}">${this._minsToHM(v.actualDay)}</td>`):'<td class="ct-nodata">-</td><td class="ct-nodata">-</td>'}).join("");return{row:`<tr class="${l?"ct-breach":""}">
          <td title="${u(o)}">${u(this._resolveName(o))}</td>
          ${p}
          <td class="${this._minsClass(c/e.length)}">${this._minsToHM(c)}</td>
          <td>${this._minsToHM(d)}</td>
          <td>${l?"\u26A0\uFE0F JA":"\u2705"}</td>
        </tr>`,anyBreach:l,totalActual:c}}).sort((o,c)=>o.anyBreach!==c.anyBreach?o.anyBreach?-1:1:c.totalActual-o.totalActual).map(o=>o.row).join("");return`
      <table class="ct-table">
        <thead>
          <tr>
            <th rowspan="2">Fahrer</th>
            ${a}
            <th rowspan="2">\u03A3 Ist</th><th rowspan="2">API Woche</th><th rowspan="2">Breach</th>
          </tr>
          <tr>${n}</tr>
        </thead>
        <tbody>${s}</tbody>
      </table>
    `}async _runQuery(){let t=document.getElementById("ct-whc-date").value,e=document.getElementById("ct-whc-mode").value,r=document.getElementById("ct-whc-status"),a=document.getElementById("ct-whc-result");if(!t){r.textContent="\u26A0\uFE0F Bitte Datum ausw\xE4hlen!";return}a.innerHTML="",this._lastQueryMode=e;try{if(r.textContent="\u23F3 Lade Fahrer-Liste...",e==="week"){let n=this._getMonday(t),s=this._addDays(n,6);await this._fetchNames(n,s)}else await this._fetchNames(t);r.textContent=`\u23F3 ${this._associates.length} Fahrer gefunden, lade Daten...`}catch(n){r.textContent=`\u274C Roster-Fehler: ${n.message}`,w(n);return}if(this._associates.length===0){r.textContent="\u26A0\uFE0F Keine Fahrer im Roster gefunden f\xFCr dieses Datum!";return}if(e==="day"){r.textContent=`\u23F3 Lade Daten f\xFCr ${t}...`;try{let n=await this._fetchDay(t),s=this._extractDayData(n);this._lastQueryResult={[t]:s},a.innerHTML=this._renderSingleDay(t,s);let o=Object.keys(s).length,c=Object.values(s).filter(l=>l.breached).length;r.textContent=`\u2705 ${o} Fahrer geladen | ${c} Threshold-Breaches | ${t}`}catch(n){r.textContent=`\u274C Fehler: ${n.message}`,w(n)}}else{let n=this._getMonday(t),s={};try{for(let c=0;c<7;c++){let l=this._addDays(n,c);r.textContent=`\u23F3 Lade ${Q[c]} (${l})... (${c+1}/7)`;try{let d=await this._fetchDay(l);s[l]=this._extractDayData(d)}catch(d){console.warn(`Fehler f\xFCr ${l}:`,d),s[l]={}}c<6&&await P(500)}this._lastQueryResult=s,a.innerHTML=this._renderWeek(s);let o=0;for(let c of Object.values(s))for(let l of Object.values(c))l.breached&&o++;r.textContent=`\u2705 Woche ${n} geladen | ${o} Breach-Eintr\xE4ge`}catch(o){r.textContent=`\u274C Fehler: ${o.message}`,w(o)}}}_exportCSV(){var n;if(!this._lastQueryResult){alert("Bitte zuerst eine Abfrage starten!");return}let t="";if(this._lastQueryMode==="day"){let s=Object.keys(this._lastQueryResult)[0],o=this._lastQueryResult[s];t=`Name;Associate ID;Geplant (Tag);Ist (Tag);Geplant (Woche);Ist (Woche);Letzten 7 Tage;Breach
`;for(let[c,l]of Object.entries(o))t+=`${this._resolveName(c)};${c};${l.scheduledDay};${l.actualDay};${l.scheduledWeek};${l.actualWeek};${l.last7Days};${l.breached}
`}else{let s=Object.keys(this._lastQueryResult).sort(),o=new Set;for(let c of Object.values(this._lastQueryResult))for(let l of Object.keys(c))o.add(l);t="Name;Associate ID";for(let c of s)t+=`;${c} Geplant;${c} Ist`;t+=`;Breach
`;for(let c of o){t+=`${this._resolveName(c)};${c}`;let l=!1;for(let d of s){let p=(n=this._lastQueryResult[d])==null?void 0:n[c];t+=`;${(p==null?void 0:p.scheduledDay)||0};${(p==null?void 0:p.actualDay)||0}`,p!=null&&p.breached&&(l=!0)}t+=`;${l}
`}}let e=new Blob(["\uFEFF"+t],{type:"text/csv;charset=utf-8;"}),r=URL.createObjectURL(e),a=document.createElement("a");a.href=r,a.download=`arbeitszeiten_${this._lastQueryMode}_${Object.keys(this._lastQueryResult)[0]}.csv`,a.click(),URL.revokeObjectURL(r)}};var U=class{constructor(t,e){this.config=t;this.companyConfig=e}_progress={isRunning:!1,current:0,total:0,dates:[],results:[]};_dialogEl=null;_progressEl=null;_resultsEl=null;_historyEl=null;init(){}dispose(){var t,e,r,a;this._stopExtraction(),(t=this._dialogEl)==null||t.remove(),this._dialogEl=null,(e=this._progressEl)==null||e.remove(),this._progressEl=null,(r=this._resultsEl)==null||r.remove(),this._resultsEl=null,(a=this._historyEl)==null||a.remove(),this._historyEl=null}showDialog(){var a;if(!this.config.features.dateExtractor){alert("Date Range Extractor ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}(a=this._dialogEl)==null||a.remove(),this._dialogEl=null;let t=k(),e=new Date(Date.now()-7*24*60*60*1e3).toISOString().split("T")[0],r=document.createElement("div");r.className="ct-overlay visible",r.innerHTML=`
      <div class="ct-dialog">
        <h3>\u{1F4C5} Select Date Range</h3>
        <div style="margin: 15px 0;">
          <label><strong>Start Date:</strong></label><br>
          <input type="date" class="ct-input ct-input--full" id="ct-dre-start" value="${e}" style="margin-top:5px;">
        </div>
        <div style="margin: 15px 0;">
          <label><strong>End Date:</strong></label><br>
          <input type="date" class="ct-input ct-input--full" id="ct-dre-end" value="${t}" style="margin-top:5px;">
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
    `,document.body.appendChild(r),this._dialogEl=r,this.companyConfig.load().then(()=>{this.companyConfig.populateSaSelect(document.getElementById("ct-dre-sa"))}),r.addEventListener("click",n=>{n.target===r&&(r.remove(),this._dialogEl=null)}),document.getElementById("ct-dre-preview").addEventListener("click",()=>{let n=document.getElementById("ct-dre-start").value,s=document.getElementById("ct-dre-end").value;if(!n||!s){alert("Please select both start and end dates");return}try{let o=this._generateDateRange(n,s);document.getElementById("ct-dre-preview-area").innerHTML=`
          <div class="ct-info-box">
            <strong>\u{1F4CB} Dates to extract (${o.length}):</strong><br>
            <div style="max-height: 150px; overflow-y: auto; margin-top: 5px; font-size: 12px;">
              ${u(o.join(", "))}
            </div>
          </div>`}catch(o){alert("Error: "+o.message)}}),document.getElementById("ct-dre-start-btn").addEventListener("click",()=>{let n=document.getElementById("ct-dre-start").value,s=document.getElementById("ct-dre-end").value,o=document.getElementById("ct-dre-sa").value;if(!n||!s){alert("Please select both start and end dates");return}if(!o.trim()){alert("Bitte Service Area ausw\xE4hlen");return}r.remove(),this._dialogEl=null,this._extractDateRange(n,s,o.trim())}),document.getElementById("ct-dre-history").addEventListener("click",()=>{r.remove(),this._dialogEl=null,this.showHistory()}),document.getElementById("ct-dre-cancel").addEventListener("click",()=>{r.remove(),this._dialogEl=null})}showHistory(){var a;(a=this._historyEl)==null||a.remove(),this._historyEl=null;let t=JSON.parse(GM_getValue("batch_index","[]"));if(t.length===0){alert("No batch history found");return}let e=document.createElement("div");e.className="ct-overlay visible";let r=[...t].reverse().map(n=>{let s=Math.round(n.successCount/n.totalCount*100),o=s===100?"ct-history-success":s>50?"ct-history-partial":"ct-history-failure";return`
        <tr>
          <td>${u(n.startDate)} to ${u(n.endDate)}</td>
          <td>${u(new Date(n.timestamp).toLocaleString())}</td>
          <td class="${o}">${n.successCount}/${n.totalCount} (${s}%)</td>
          <td>
            <button class="ct-btn ct-btn--info" data-ct-batch-download="${u(n.key)}">Download</button>
          </td>
        </tr>`}).join("");e.innerHTML=`
      <div class="ct-panel" style="min-width:700px;">
        <h2>\u{1F4C8} Batch Extraction History</h2>
        <table class="ct-history-table">
          <thead>
            <tr><th>Date Range</th><th>Extracted</th><th>Success Rate</th><th>Actions</th></tr>
          </thead>
          <tbody>${r}</tbody>
        </table>
        <div style="margin-top: 16px; text-align: right;">
          <button class="ct-btn ct-btn--secondary" id="ct-dre-history-close">Close</button>
        </div>
      </div>`,document.body.appendChild(e),this._historyEl=e,e.addEventListener("click",n=>{n.target===e&&(e.remove(),this._historyEl=null);let s=n.target.closest("[data-ct-batch-download]");if(s){let o=s.getAttribute("data-ct-batch-download");this._downloadBatch(o)}}),document.getElementById("ct-dre-history-close").addEventListener("click",()=>{e.remove(),this._historyEl=null})}_downloadBatch(t){try{let e=GM_getValue(t,null);if(!e){alert("Batch data not found \u2014 it may have been removed.");return}let r=typeof e=="string"?JSON.parse(e):e,a=new Blob([JSON.stringify(r,null,2)],{type:"application/json"}),n=URL.createObjectURL(a),s=document.createElement("a");s.href=n,s.download=`batch_${t}.json`,s.click(),URL.revokeObjectURL(n)}catch(e){w("Download batch failed:",e),alert("Failed to download batch data.")}}async _extractDateRange(t,e,r){let a=this._generateDateRange(t,e);y(`Extracting data for ${a.length} dates:`,a),this._progress={isRunning:!0,current:0,total:a.length,dates:a,results:[]},this._updateProgressDisplay();for(let n=0;n<a.length&&this._progress.isRunning;n++){let s=a[n];this._progress.current=n+1;try{y(`Extracting data for ${s} (${n+1}/${a.length})`),this._updateProgressDisplay();let o=await this._extractSingleDate(s,r);this._progress.results.push({date:s,success:!0,data:o,timestamp:new Date().toISOString()}),n<a.length-1&&await P(1e3+Math.random()*1e3)}catch(o){w(`Failed for ${s}:`,o),this._progress.results.push({date:s,success:!1,error:o.message,timestamp:new Date().toISOString()}),await P(2e3)}}this._progress.isRunning=!1,this._updateProgressDisplay(),y("Date range extraction completed"),this._saveBatchResults(this._progress.results,t,e),this._showBatchResults(this._progress.results)}_extractSingleDate(t,e){return new Promise((r,a)=>{let n=`https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${t}&serviceAreaId=${e}`;fetch(n,{method:"GET",credentials:"same-origin",headers:{Accept:"application/json, text/plain, */*","Accept-Language":"de,en-US;q=0.7,en;q=0.3","user-ref":"cortex-webapp-user","X-Cortex-Timestamp":Date.now().toString(),"X-Cortex-Session":F()??"",Referer:location.href}}).then(s=>{if(!s.ok)throw new Error(`HTTP ${s.status}: ${s.statusText}`);return s.json()}).then(s=>{this._saveIndividualData(s,t),r(s)}).catch(a)})}_generateDateRange(t,e){let r=[],a=new Date(t),n=new Date(e);if(a>n)throw new Error("Start date must be before end date");let s=new Date(a);for(;s<=n;)s.getDay()!==0&&r.push(s.toISOString().split("T")[0]),s.setDate(s.getDate()+1);return r}_saveIndividualData(t,e){let r=`logistics_data_${e}`,a={date:e,extractedAt:new Date().toISOString(),rawData:t,summary:this._extractDataSummary(t)};GM_setValue(r,JSON.stringify(a)),y(`Saved data for ${e}`)}_saveBatchResults(t,e,r){let a=`batch_${e}_${r}_${Date.now()}`,n={startDate:e,endDate:r,extractedAt:new Date().toISOString(),totalDates:t.length,successCount:t.filter(o=>o.success).length,results:t};GM_setValue(a,JSON.stringify(n));let s=JSON.parse(GM_getValue("batch_index","[]"));if(s.push({key:a,startDate:e,endDate:r,timestamp:new Date().toISOString(),successCount:n.successCount,totalCount:n.totalDates}),s.length>20){let o=s.shift();GM_setValue(o.key,"")}GM_setValue("batch_index",JSON.stringify(s)),y(`Saved batch: ${a}`)}_extractDataSummary(t){let e={};try{let r=t;r.summary&&(e.totalRoutes=r.summary.totalRoutes||0,e.completedRoutes=r.summary.completedRoutes||0,e.totalPackages=r.summary.totalPackages||0,e.deliveredPackages=r.summary.deliveredPackages||0),r.metrics&&(e.metrics=r.metrics)}catch(r){console.warn("Could not extract summary:",r)}return e}_updateProgressDisplay(){var r;if(!this._progress.isRunning){(r=this._progressEl)==null||r.remove(),this._progressEl=null;return}if(!this._progressEl){let a=document.createElement("div");a.className="ct-overlay visible",a.innerHTML=`
        <div class="ct-dialog" style="min-width:320px; text-align:center;">
          <h3>\u{1F4CA} Extracting Data</h3>
          <div id="ct-dre-progress-inner"></div>
          <button class="ct-btn ct-btn--danger" id="ct-dre-stop" style="margin-top:15px;">Stop</button>
        </div>`,document.body.appendChild(a),this._progressEl=a,document.getElementById("ct-dre-stop").addEventListener("click",()=>this._stopExtraction())}let t=Math.round(this._progress.current/this._progress.total*100),e=this._progress.dates[this._progress.current-1]||"Starting...";document.getElementById("ct-dre-progress-inner").innerHTML=`
      <div style="margin: 15px 0;">
        <div class="ct-progress">
          <div class="ct-progress__fill" style="width: ${t}%;"></div>
        </div>
        <div style="margin-top: 10px; font-size: 14px;">
          ${this._progress.current} / ${this._progress.total} (${t}%)
        </div>
      </div>
      <div style="color: #666; font-size: 12px;">Current: ${u(e)}</div>`}_stopExtraction(){var t;this._progress.isRunning=!1,(t=this._progressEl)==null||t.remove(),this._progressEl=null,y("Extraction stopped by user")}_showBatchResults(t){var o;(o=this._resultsEl)==null||o.remove(),this._resultsEl=null;let e=t.filter(c=>c.success).length,r=t.length-e,a=t.length>0?Math.round(e/t.length*100):0,n=t.map(c=>`
      <div class="ct-result-item">
        <h4>${u(c.date)}
          <span class="${c.success?"ct-result-success":"ct-result-failure"}">
            ${c.success?"\u2705":"\u274C"}
          </span>
        </h4>
        ${c.success?"<p>Data extracted successfully</p>":"<p>Error: "+u(c.error??"")+"</p>"}
        <small>Time: ${u(new Date(c.timestamp).toLocaleString())}</small>
      </div>`).join(""),s=document.createElement("div");s.className="ct-overlay visible",s.innerHTML=`
      <div class="ct-panel" style="min-width:600px;">
        <h2>\u{1F4CA} Batch Extraction Results</h2>
        <div class="ct-summary-box">
          <h3>Summary</h3>
          <p><strong>Total Dates:</strong> ${t.length}</p>
          <p><strong class="ct-result-success">Successful:</strong> ${e}</p>
          <p><strong class="ct-result-failure">Failed:</strong> ${r}</p>
          <p><strong>Success Rate:</strong> ${a}%</p>
        </div>
        <div style="margin-bottom: 16px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="ct-btn ct-btn--primary" id="ct-dre-dl-all">\u{1F4BE} Download All Data</button>
          <button class="ct-btn ct-btn--info" id="ct-dre-dl-summary">\u{1F4CB} Download Summary</button>
        </div>
        <h3>Individual Results</h3>
        <div style="max-height: 400px; overflow-y: auto;">${n}</div>
        <div style="margin-top: 16px; text-align: right;">
          <button class="ct-btn ct-btn--secondary" id="ct-dre-results-close">Close</button>
        </div>
      </div>`,document.body.appendChild(s),this._resultsEl=s,s.addEventListener("click",c=>{c.target===s&&(s.remove(),this._resultsEl=null)}),document.getElementById("ct-dre-results-close").addEventListener("click",()=>{s.remove(),this._resultsEl=null}),document.getElementById("ct-dre-dl-all").addEventListener("click",()=>{let c=new Blob([JSON.stringify(t,null,2)],{type:"application/json"}),l=URL.createObjectURL(c),d=document.createElement("a");d.href=l,d.download=`logistics_batch_data_${k()}.json`,d.click(),URL.revokeObjectURL(l)}),document.getElementById("ct-dre-dl-summary").addEventListener("click",()=>{let c={totalDates:t.length,successCount:e,failureCount:r,successRate:a},l=new Blob([JSON.stringify(c,null,2)],{type:"application/json"}),d=URL.createObjectURL(l),p=document.createElement("a");p.href=d,p.download=`logistics_summary_${k()}.json`,p.click(),URL.revokeObjectURL(d)})}};var mt=new Set(["country","station_code","program","country_dspid_stationcode","country_program_stationcode","region","dsp_code","country_program_dspid_stationcode","country_stationcode","country_program_data_date"]),ft=new Set(["delivered","unbucketed_delivery_misses","address_not_found","return_to_station_utl","return_to_station_uta","customer_not_available","return_to_station_all","successful_c_return_pickups","rts_other","dispatched","transferred_out","dnr","return_to_station_nsl","completed_routes","first_delv_with_test_dim","pde_photos_taken","packages_not_on_van","first_disp_with_test_dim","delivery_attempt","return_to_station_bc","pod_bypass","pod_opportunity","pod_success","next_day_routes","scheduled_mfn_pickups","successful_mfn_pickups","rejected_packages","payment_not_ready","scheduled_c_return_pickups","return_to_station_cu","return_to_station_oodt","rts_dpmo","dnr_dpmo","ttl"]),vt=new Set(["pod_success_rate","rts_cu_percent","rts_other_percent","rts_oodt_percent","rts_utl_percent","rts_bc_percent","delivery_attempt_percent","customer_not_available_percent","first_day_delivery_success_percent","rts_all_percent","rejected_packages_percent","payment_not_ready_percent","delivery_success_dsp","delivery_success","unbucketed_delivery_misses_percent","address_not_found_percent"]),bt=new Set(["shipment_zone_per_hour"]),zt=new Set(["last_updated_time"]),Ut=new Set(["messageTimestamp"]),Wt=new Set(["data_date"]),W={country:"Country",station_code:"Station",program:"Program",country_dspid_stationcode:"Country/DSP/Station",country_program_stationcode:"Country/Program/Station",region:"Region",dsp_code:"DSP",country_program_dspid_stationcode:"Country/Program/DSP/Station",country_stationcode:"Country/Station",country_program_data_date:"Country/Program/Date",delivered:"Delivered",dispatched:"Dispatched",completed_routes:"Completed Routes",delivery_attempt:"Delivery Attempts",unbucketed_delivery_misses:"Unbucketed Misses",address_not_found:"Address Not Found",return_to_station_utl:"RTS UTL",return_to_station_uta:"RTS UTA",customer_not_available:"Customer N/A",return_to_station_all:"RTS All",return_to_station_cu:"RTS CU",return_to_station_bc:"RTS BC",return_to_station_nsl:"RTS NSL",return_to_station_oodt:"RTS OODT",successful_c_return_pickups:"C-Return Pickups",rts_other:"RTS Other",transferred_out:"Transferred Out",dnr:"DNR",first_delv_with_test_dim:"First Delv (dim)",pde_photos_taken:"PDE Photos",packages_not_on_van:"Pkgs Not on Van",first_disp_with_test_dim:"First Disp (dim)",pod_bypass:"POD Bypass",pod_opportunity:"POD Opportunity",pod_success:"POD Success",next_day_routes:"Next Day Routes",scheduled_mfn_pickups:"Sched MFN Pickups",successful_mfn_pickups:"Successful MFN Pickups",rejected_packages:"Rejected Pkgs",payment_not_ready:"Payment N/Ready",scheduled_c_return_pickups:"Sched C-Return",rts_dpmo:"RTS DPMO",dnr_dpmo:"DNR DPMO",ttl:"TTL",shipment_zone_per_hour:"Shipments/Zone/Hour",pod_success_rate:"POD Success Rate",rts_cu_percent:"RTS CU %",rts_other_percent:"RTS Other %",rts_oodt_percent:"RTS OODT %",rts_utl_percent:"RTS UTL %",rts_bc_percent:"RTS BC %",delivery_attempt_percent:"Delivery Attempt %",customer_not_available_percent:"Customer N/A %",first_day_delivery_success_percent:"First-Day Success %",rts_all_percent:"RTS All %",rejected_packages_percent:"Rejected Pkgs %",payment_not_ready_percent:"Payment N/Ready %",delivery_success_dsp:"Delivery Success (DSP)",delivery_success:"Delivery Success",unbucketed_delivery_misses_percent:"Unbucketed Misses %",address_not_found_percent:"Address Not Found %",last_updated_time:"Last Updated",messageTimestamp:"Message Timestamp",data_date:"Data Date"};function yt(i){let t=typeof i=="string"?JSON.parse(i):i,e={};for(let[r,a]of Object.entries(t))e[r.trim()]=a;return e}function _t(i){return mt.has(i)?"string":ft.has(i)?"int":vt.has(i)?"percent":bt.has(i)?"rate":zt.has(i)?"datetime":Ut.has(i)?"epoch":Wt.has(i)?"date":"unknown"}function X(i,t){if(t==null||t==="")return"\u2014";let e=_t(i);switch(e){case"percent":return`${(Number(t)*100).toFixed(2)}%`;case"rate":return Number(t).toFixed(2);case"datetime":case"epoch":try{let r=e==="epoch"?Number(t):new Date(t).getTime();return new Date(r).toLocaleString(void 0,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})}catch{return String(t)}case"date":return String(t);case"int":return Number(t).toLocaleString();default:return String(t)}}function tt(i,t){let e=Number(t);return i.startsWith("rts_")||i.includes("miss")||i==="customer_not_available_percent"||i==="rejected_packages_percent"||i==="payment_not_ready_percent"||i==="address_not_found_percent"?e<.005?"great":e<.01?"ok":"bad":e>=.99?"great":e>=.97?"ok":"bad"}function jt(i,t){return!i||!t?"Both From and To dates are required.":/^\d{4}-\d{2}-\d{2}$/.test(i)?/^\d{4}-\d{2}-\d{2}$/.test(t)?i>t?"From date must not be after To date.":null:"To date format must be YYYY-MM-DD.":"From date format must be YYYY-MM-DD."}function ht(i){try{let t=i==null?void 0:i.tableData,e=t==null?void 0:t.dsp_daily_supplemental_quality,r=e==null?void 0:e.rows;return!Array.isArray(r)||r.length===0?[]:r.map(yt).sort((a,n)=>(a.data_date||"").localeCompare(n.data_date||""))}catch(t){return w("dpParseApiResponse error:",t),[]}}var j=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_cache=new Map;_debounceTimer=null;helpers={dpParseRow:yt,dpClassifyField:_t,dpFormatValue:X,dpRateClass:tt,dpValidateDateRange:jt,dpParseApiResponse:ht};async init(){if(this._overlayEl)return;let t=k(),e=document.createElement("div");e.id="ct-dp-overlay",e.className="ct-overlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-label","Daily Delivery Performance Dashboard"),e.innerHTML=`
      <div class="ct-dp-panel">
        <h2>\u{1F4E6} Daily Delivery Performance</h2>
        <div class="ct-controls">
          <label for="ct-dp-date">Date:</label>
          <input type="date" id="ct-dp-date" class="ct-input" value="${t}" aria-label="Select date">
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
    `,document.body.appendChild(e),this._overlayEl=e,e.addEventListener("click",a=>{a.target===e&&this.hide()}),document.getElementById("ct-dp-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-dp-go").addEventListener("click",()=>this._triggerFetch());let r=(()=>{let a;return()=>{clearTimeout(a),a=setTimeout(()=>this._triggerFetch(),600)}})();document.getElementById("ct-dp-date").addEventListener("change",r),await this.companyConfig.load(),this.companyConfig.populateSaSelect(document.getElementById("ct-dp-sa")),S(()=>this.dispose()),y("Delivery Performance Dashboard initialized")}dispose(){var t;this._debounceTimer&&clearTimeout(this._debounceTimer),(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._active=!1,this._cache.clear()}toggle(){if(!this.config.features.deliveryPerf){alert("Daily Delivery Performance ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,document.getElementById("ct-dp-date").focus()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}_buildUrl(t,e,r,a){return`https://logistics.amazon.de/performance/api/v1/getData?dataSetId=dsp_daily_supplemental_quality&dsp=${encodeURIComponent(a)}&from=${encodeURIComponent(t)}&station=${encodeURIComponent(r)}&timeFrame=Daily&to=${encodeURIComponent(e)}`}async _fetchData(t,e,r,a){let n=`${t}|${e}|${r}|${a}`;if(this._cache.has(n))return y("DP cache hit:",n),this._cache.get(n);let s=this._buildUrl(t,e,r,a),o=D(),c={Accept:"application/json"};o&&(c["anti-csrftoken-a2z"]=o);let d=await(await T(async()=>{let p=await fetch(s,{method:"GET",headers:c,credentials:"include"});if(!p.ok)throw new Error(`HTTP ${p.status}: ${p.statusText}`);return p},{retries:2,baseMs:800})).json();if(this._cache.set(n,d),this._cache.size>50){let p=this._cache.keys().next().value;this._cache.delete(p)}return d}async _triggerFetch(){var n,s;let t=document.getElementById("ct-dp-date").value;if(!t){this._setStatus("\u26A0\uFE0F Please select a date.");return}let e=document.getElementById("ct-dp-sa"),r=((s=(n=e.options[e.selectedIndex])==null?void 0:n.textContent)==null?void 0:s.trim().toUpperCase())||this.companyConfig.getDefaultStation(),a=this.companyConfig.getDspCode();this._setStatus("\u23F3 Loading\u2026"),this._setBody('<div class="ct-dp-loading" role="status">Fetching data\u2026</div>');try{let o=await this._fetchData(t,t,r,a),c=ht(o);if(c.length===0){this._setBody('<div class="ct-dp-empty">No data returned for the selected date.</div>'),this._setStatus("\u26A0\uFE0F No records found.");return}this._setBody(this._renderAll(c)),this._setStatus(`\u2705 ${c.length} record(s) loaded \u2014 ${t}`)}catch(o){w("Delivery perf fetch failed:",o),this._setBody(`<div class="ct-dp-error">\u274C ${u(o.message)}</div>`),this._setStatus("\u274C Failed to load data.")}}_setStatus(t){let e=document.getElementById("ct-dp-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-dp-body");e&&(e.innerHTML=t)}_renderAll(t){let e=this._renderBadges(t[0]),r=t.map(a=>this._renderRecord(a)).join("");return e+r}_renderBadges(t){let e=[];for(let r of mt){let a=t[r];if(a==null||a==="")continue;let n=W[r]||r;e.push(`<span class="ct-dp-badge" title="${u(r)}">${u(n)}<span>${u(String(a))}</span></span>`)}return e.length?`<div class="ct-dp-badges" aria-label="Identifiers">${e.join("")}</div>`:""}_renderRecord(t){return`
      <div class="ct-dp-record">
        <div class="ct-dp-record-header">\u{1F4C5} ${u(String(t.data_date||"Unknown date"))}</div>
        <div class="ct-dp-record-body">
          ${this._renderKeyTiles(t)}
          ${this._renderCounts(t)}
          ${this._renderRates(t)}
          ${this._renderTimestamps(t)}
        </div>
      </div>`}_renderKeyTiles(t){return`<div class="ct-dp-full-col"><div class="ct-dp-tiles">${[{field:"delivered",label:"Delivered",pct:!1},{field:"dispatched",label:"Dispatched",pct:!1},{field:"completed_routes",label:"Routes",pct:!1},{field:"delivery_success",label:"Delivery Success",pct:!0},{field:"pod_success_rate",label:"POD Rate",pct:!0}].map(({field:a,label:n,pct:s})=>{let o=t[a];if(o==null)return"";let c,l="";if(s){let d=Number(o);c=`${(d*100).toFixed(1)}%`;let p=tt(a,d);l=p==="great"?"ct-dp-tile--success":p==="ok"?"ct-dp-tile--warn":"ct-dp-tile--danger"}else c=Number(o).toLocaleString();return`<div class="ct-dp-tile ${l}"><div class="ct-dp-tile-val">${u(c)}</div><div class="ct-dp-tile-lbl">${u(n)}</div></div>`}).join("")}</div></div>`}_renderCounts(t){let e=[];for(let r of ft){let a=t[r];if(a==null)continue;let n=W[r]||r;e.push(`<tr><td>${u(n)}</td><td>${u(Number(a).toLocaleString())}</td></tr>`)}return e.length?`<div>
      <p class="ct-dp-section-title">Counts</p>
      <table class="ct-dp-count-table" aria-label="Count metrics">
        <tbody>${e.join("")}</tbody>
      </table>
    </div>`:""}_renderRates(t){let e=[];for(let r of vt){let a=t[r];if(a==null)continue;let n=Number(a),s=tt(r,n),o=Math.min(100,Math.round(n*100)),c=W[r]||r;e.push(`
        <div class="ct-dp-rate-row" role="listitem">
          <span class="ct-dp-rate-label">${u(c)}</span>
          <div class="ct-dp-rate-bar-wrap" aria-hidden="true">
            <div class="ct-dp-rate-bar ct-dp-rate--bar--${s}" style="width:${o}%"></div>
          </div>
          <span class="ct-dp-rate-value ct-dp-rate--${s}">${(n*100).toFixed(2)}%</span>
        </div>`)}for(let r of bt){let a=t[r];if(a==null)continue;let n=W[r]||r;e.push(`
        <div class="ct-dp-rate-row" role="listitem">
          <span class="ct-dp-rate-label">${u(n)}</span>
          <span class="ct-dp-rate-value ct-dp-rate--neutral">${Number(a).toFixed(2)}</span>
        </div>`)}return e.length?`<div>
      <p class="ct-dp-section-title">Rates &amp; Percentages</p>
      <div class="ct-dp-rates" role="list">${e.join("")}</div>
    </div>`:""}_renderTimestamps(t){let e=[];return t.data_date&&e.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Data Date</span>
        <span class="ct-dp-ts-val">${u(String(t.data_date))}</span>
      </div>`),t.last_updated_time&&e.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Last Updated</span>
        <span class="ct-dp-ts-val">${u(X("last_updated_time",t.last_updated_time))}</span>
      </div>`),t.messageTimestamp!==void 0&&t.messageTimestamp!==null&&e.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Message Timestamp</span>
        <span class="ct-dp-ts-val">${u(X("messageTimestamp",t.messageTimestamp))}</span>
      </div>`),e.length?`<div class="ct-dp-full-col">
      <div class="ct-dp-ts-row" aria-label="Timestamps">${e.join("")}</div>
    </div>`:""}};var V=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_vehicles=[];_nameCache=new Map;_lastTimestamp=null;_loading=!1;_pageSize=25;_pageCurrent=1;_pageMissing=1;_currentTab="all";get _showTransporters(){return this.config.features.dvicShowTransporters!==!1}init(){if(this._overlayEl)return;let t=document.createElement("div");t.id="ct-dvic-overlay",t.className="ct-overlay",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.setAttribute("aria-label","DVIC Check"),t.innerHTML=`
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
    `,document.body.appendChild(t),this._overlayEl=t,t.addEventListener("click",e=>{e.target===t&&this.hide()}),document.getElementById("ct-dvic-close").addEventListener("click",()=>this.hide()),t.querySelector(".ct-dvic-tabs").addEventListener("click",e=>{let r=e.target.closest(".ct-dvic-tab");r&&this._switchTab(r.dataset.tab)}),S(()=>this.dispose()),y("DVIC Check initialized")}dispose(){var t;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._vehicles=[],this._active=!1,this._lastTimestamp=null,this._loading=!1}toggle(){if(!this.config.features.dvicCheck){alert("DVIC Check ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,this._pageCurrent=1,this._pageMissing=1,this._currentTab="all",this._switchTab("all"),this._refresh()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}_switchTab(t){var e;this._currentTab=t,(e=this._overlayEl)==null||e.querySelectorAll(".ct-dvic-tab").forEach(r=>{let a=r.dataset.tab===t;r.classList.toggle("ct-dvic-tab--active",a),r.setAttribute("aria-selected",String(a))}),this._vehicles.length>0&&this._renderBody()}_getTodayBremenTimestamp(){let e=new Date().toLocaleDateString("sv",{timeZone:"Europe/Berlin"}),[r,a,n]=e.split("-").map(Number),s=new Date(Date.UTC(r,a-1,n,6,0,0)),o=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Berlin",hour:"numeric",minute:"numeric",hour12:!1}).formatToParts(s),c=parseInt(o.find(p=>p.type==="hour").value,10)%24,l=parseInt(o.find(p=>p.type==="minute").value,10),d=c*60+l-6*60;return Date.UTC(r,a-1,n)-d*6e4}async _fetchInspectionStats(t){let e=`https://logistics.amazon.de/fleet-management/api/inspection-stats?startTimestamp=${t}`,r=D(),a={Accept:"application/json"};return r&&(a["anti-csrftoken-a2z"]=r),(await T(async()=>{let s=await fetch(e,{method:"GET",headers:a,credentials:"include"});if(!s.ok)throw new Error(`HTTP ${s.status}: ${s.statusText}`);return s},{retries:2,baseMs:800})).json()}async _getEmployeeNames(t){if([...new Set(t)].filter(n=>!this._nameCache.has(n)).length>0)try{let n=this.companyConfig.getDefaultServiceAreaId(),s=new Date().toISOString().split("T")[0],c=`https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${ut(s,-30)}&toDate=${s}&serviceAreaId=${n}`,l=D(),d={Accept:"application/json"};l&&(d["anti-csrftoken-a2z"]=l);let p=await fetch(c,{method:"GET",headers:d,credentials:"include"});if(p.ok){let m=await p.json(),f=Array.isArray(m)?m:(m==null?void 0:m.data)||(m==null?void 0:m.rosters)||[],h=v=>{for(let _ of v)_.driverPersonId&&_.driverName&&this._nameCache.set(String(_.driverPersonId),_.driverName)};if(Array.isArray(f))h(f);else if(typeof f=="object")for(let v of Object.values(f))Array.isArray(v)&&h(v);y("[DVIC] Roster fetch: added",this._nameCache.size,"names to cache")}}catch(n){y("[DVIC] Roster lookup failed:",n)}let a=new Map;for(let n of t)a.set(n,this._nameCache.get(n)||n);return a}_normalizeVehicle(t){let e=String((t==null?void 0:t.vehicleIdentifier)??"").trim()||"Unknown",r=Array.isArray(t==null?void 0:t.inspectionStats)?t.inspectionStats:[],a=r.find(v=>((v==null?void 0:v.inspectionType)??(v==null?void 0:v.type))==="PRE_TRIP_DVIC")??null,n=r.find(v=>((v==null?void 0:v.inspectionType)??(v==null?void 0:v.type))==="POST_TRIP_DVIC")??null,s=Number((a==null?void 0:a.totalInspectionsDone)??0),o=Number((n==null?void 0:n.totalInspectionsDone)??0),c=s-o,l=c>0?"Post Trip DVIC Missing":"OK",d=l==="OK"?0:c,p=[a,n].filter(Boolean).map(v=>v.inspectedAt??v.lastInspectedAt??null).filter(Boolean),m=p.length>0?p.sort().at(-1)??null:null,f=(a==null?void 0:a.shiftDate)??(n==null?void 0:n.shiftDate)??null,h=new Set;for(let v of r){let _=Array.isArray(v==null?void 0:v.inspectionDetails)?v.inspectionDetails:[];for(let g of _){let x=g==null?void 0:g.reporterId;x!=null&&String(x).trim()!==""&&h.add(String(x).trim())}}return{vehicleIdentifier:e,preTripTotal:s,postTripTotal:o,missingCount:d,status:l,inspectedAt:m,shiftDate:f,reporterIds:[...h],reporterNames:[]}}_processApiResponse(t){if(t===null||typeof t!="object")throw new Error("API response is not a JSON object");let e=t==null?void 0:t.inspectionsStatList;if(e==null)return[];if(!Array.isArray(e))throw new Error(`inspectionsStatList has unexpected type: ${typeof e}`);return e.map(r=>this._normalizeVehicle(r))}async _refresh(){var r;if(this._loading)return;this._loading=!0,this._vehicles=[];let t=this._getTodayBremenTimestamp();this._lastTimestamp=t;let e=new Date(t).toLocaleDateString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric"});this._setStatus(`\u23F3 Lade DVIC-Daten f\xFCr heute (${e})\u2026`),this._setTiles(""),this._setBody('<div class="ct-dvic-loading" role="status">Daten werden geladen\u2026</div>');try{let a=await this._fetchInspectionStats(t),n;try{n=this._processApiResponse(a)}catch(d){w("DVIC response parse error:",d),this._setBody(`<div class="ct-dvic-error" role="alert">\u26A0\uFE0F DVIC data unavailable for this date.<br><small>${u(d.message)}</small></div>`),this._setStatus("\u26A0\uFE0F Daten konnten nicht verarbeitet werden."),this._loading=!1;return}let s=[...new Set(n.flatMap(d=>d.reporterIds))];if(s.length>0){this._setStatus("\u23F3 Lade Mitarbeiternamen\u2026");try{let d=await this._getEmployeeNames(s);for(let p of n)p.reporterNames=[...new Set(p.reporterIds.map(m=>d.get(m)||m))]}catch(d){y("Name enrichment failed, using IDs as fallback:",d);for(let p of n)p.reporterNames=[...p.reporterIds]}}else for(let d of n)d.reporterNames=[];this._vehicles=n;let o=n.filter(d=>d.status!=="OK").length,c=n.reduce((d,p)=>d+p.missingCount,0);this._setStatus(`\u2705 ${n.length} Fahrzeuge | ${o} mit fehlendem Post-Trip DVIC | ${c} fehlende DVICs gesamt`);let l=document.getElementById("ct-dvic-asof");if(l){let d=new Date().toLocaleString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});l.textContent=`Stand: ${d} (Daten ab ${e})`}this._renderTiles(n.length,o,c),this._updateMissingTabBadge(o),this._renderBody()}catch(a){w("DVIC fetch failed:",a),this._setBody(`<div class="ct-dvic-error" role="alert">\u274C DVIC-Daten konnten nicht geladen werden.<br><small>${u(a.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-dvic-retry">\u{1F504} Erneut versuchen</button></div>`),this._setStatus("\u274C Fehler beim Laden."),(r=document.getElementById("ct-dvic-retry"))==null||r.addEventListener("click",()=>this._refresh())}finally{this._loading=!1}}_setStatus(t){let e=document.getElementById("ct-dvic-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-dvic-body");e&&(e.innerHTML=t)}_setTiles(t){let e=document.getElementById("ct-dvic-tiles");e&&(e.innerHTML=t)}_updateMissingTabBadge(t){let e=document.getElementById("ct-dvic-tab-missing");e&&(e.textContent=t>0?`\u26A0\uFE0F DVIC Fehlend (${t})`:"\u26A0\uFE0F DVIC Fehlend")}_renderTiles(t,e,r){let a=e===0?"ct-dvic-tile--ok":e<5?"ct-dvic-tile--warn":"ct-dvic-tile--danger";this._setTiles(`
      <div class="ct-dvic-tiles">
        <div class="ct-dvic-tile"><div class="ct-dvic-tile-val">${t}</div><div class="ct-dvic-tile-lbl">Fahrzeuge gesamt</div></div>
        <div class="ct-dvic-tile ${a}"><div class="ct-dvic-tile-val">${e}</div><div class="ct-dvic-tile-lbl">Fahrzeuge mit Fehler</div></div>
        <div class="ct-dvic-tile ${r===0?"ct-dvic-tile--ok":"ct-dvic-tile--danger"}"><div class="ct-dvic-tile-val">${r}</div><div class="ct-dvic-tile-lbl">DVIC fehlend gesamt</div></div>
        <div class="ct-dvic-tile ${e===0?"ct-dvic-tile--ok":""}"><div class="ct-dvic-tile-val">${t-e}</div><div class="ct-dvic-tile-lbl">Fahrzeuge OK</div></div>
      </div>`)}_renderBody(){if(this._overlayEl){if(this._vehicles.length===0){this._setBody('<div class="ct-dvic-empty">Keine DVIC-Daten verf\xFCgbar f\xFCr dieses Datum.</div>');return}this._currentTab==="all"?this._renderAllTab():this._renderMissingTab()}}_renderTransporterNames(t){let e=(t.reporterIds??[]).filter(o=>String(o).trim()!=="");if(e.length===0)return'<em class="ct-dvic-tp-unknown" aria-label="Unbekannter Transporter">Unbekannter Transporter</em>';let r=e.map(o=>{let c=this._nameCache.get(o);return c&&c!==o?`${c} (ID: ${o})`:o});if(r.length===0)return'<em class="ct-dvic-tp-unknown">Unbekannter Transporter</em>';let[a,...n]=r,s=n.length>0?`<span class="ct-dvic-tp-secondary">, ${u(n.join(", "))}</span>`:"";return`<span class="ct-dvic-tp-primary" aria-label="Transporter: ${u(r.join(", "))}">${u(a)}${s}</span>`}_renderAllTab(){var d;let t=this._pageCurrent,e=this._vehicles.length,r=Math.ceil(e/this._pageSize),a=(t-1)*this._pageSize,n=this._vehicles.slice(a,a+this._pageSize),s=this._showTransporters,o=n.map(p=>{let m=p.status!=="OK",f=m?"ct-dvic-row--missing":"",h=m?"ct-dvic-badge--missing":"ct-dvic-badge--ok",v=s?`<td class="ct-dvic-tp-cell">${this._renderTransporterNames(p)}</td>`:"";return`<tr class="${f}" role="row">
        <td>${u(p.vehicleIdentifier)}</td>
        <td>${p.preTripTotal}</td><td>${p.postTripTotal}</td>
        <td>${p.missingCount>0?`<strong>${p.missingCount}</strong>`:"0"}</td>
        <td><span class="${h}">${u(p.status)}</span></td>
        ${v}<td></td>
      </tr>`}).join(""),c=s?"Transporter ausblenden":"Transporter einblenden",l=s?'<th scope="col" class="ct-dvic-tp-th">Transporter</th>':"";this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-all">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${s}">\u{1F464} ${c}</button>
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip \u2713</th><th scope="col">Post-Trip \u2713</th>
            <th scope="col">Fehlend</th><th scope="col">Status</th>
            ${l}<th scope="col" style="width:4px;"></th>
          </tr></thead>
          <tbody>${o}</tbody>
        </table>
        ${this._renderPagination(e,t,r,"all")}
      </div>`),(d=document.getElementById("ct-dvic-tp-toggle"))==null||d.addEventListener("click",()=>{this.config.features.dvicShowTransporters=!this._showTransporters,L(this.config),this._renderBody()}),this._attachPaginationHandlers("all")}_renderMissingTab(){var d;let t=this._vehicles.filter(p=>p.status!=="OK");if(t.length===0){this._setBody('<div class="ct-dvic-empty">\u2705 Alle Fahrzeuge haben Post-Trip DVICs \u2014 kein Handlungsbedarf.</div>');return}let e=this._pageMissing,r=Math.ceil(t.length/this._pageSize),a=(e-1)*this._pageSize,n=t.slice(a,a+this._pageSize),s=this._showTransporters,o=n.map(p=>{let m=s?`<td class="ct-dvic-tp-cell">${this._renderTransporterNames(p)}</td>`:"";return`<tr class="ct-dvic-row--missing" role="row">
        <td>${u(p.vehicleIdentifier)}</td>
        <td>${p.preTripTotal}</td><td>${p.postTripTotal}</td>
        <td><strong>${p.missingCount}</strong></td>
        ${m}
      </tr>`}).join(""),c=s?"Transporter ausblenden":"Transporter einblenden",l=s?'<th scope="col" class="ct-dvic-tp-th">Transporter</th>':"";this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-missing">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${s}">\u{1F464} ${c}</button>
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip \u2713</th><th scope="col">Post-Trip \u2713</th>
            <th scope="col">Fehlend</th>${l}
          </tr></thead>
          <tbody>${o}</tbody>
        </table>
        ${this._renderPagination(t.length,e,r,"missing")}
      </div>`),(d=document.getElementById("ct-dvic-tp-toggle"))==null||d.addEventListener("click",()=>{this.config.features.dvicShowTransporters=!this._showTransporters,L(this.config),this._renderBody()}),this._attachPaginationHandlers("missing")}_renderPagination(t,e,r,a){return r<=1?"":`
      <div class="ct-dvic-pagination">
        <button class="ct-btn ct-btn--secondary ct-dvic-prev-page" data-tab="${a}" ${e<=1?"disabled":""}>\u2039 Zur\xFCck</button>
        <span class="ct-dvic-page-info">Seite ${e} / ${r} (${t} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-dvic-next-page" data-tab="${a}" ${e>=r?"disabled":""}>Weiter \u203A</button>
      </div>`}_attachPaginationHandlers(t){var r,a;let e=document.getElementById("ct-dvic-body");e&&((r=e.querySelector(`.ct-dvic-prev-page[data-tab="${t}"]`))==null||r.addEventListener("click",()=>{t==="all"?this._pageCurrent>1&&(this._pageCurrent--,this._renderAllTab()):this._pageMissing>1&&(this._pageMissing--,this._renderMissingTab())}),(a=e.querySelector(`.ct-dvic-next-page[data-tab="${t}"]`))==null||a.addEventListener("click",()=>{let n=t==="all"?this._vehicles.length:this._vehicles.filter(o=>o.status!=="OK").length,s=Math.ceil(n/this._pageSize);t==="all"?this._pageCurrent<s&&(this._pageCurrent++,this._renderAllTab()):this._pageMissing<s&&(this._pageMissing++,this._renderMissingTab())}))}};function H(i){if(i==null)return null;let t=Number(i);return isNaN(t)?null:t>1e15?Math.floor(t/1e3):t>1e12?t:t>1e9?t*1e3:t}function et(i){if(i==null)return"\u2014";try{return new Date(i).toLocaleTimeString("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",hour12:!1})}catch{return"\u2014"}}function rt(i){if(i==null)return"\u2014";let t=Number(i);if(isNaN(t))return"\u2014";let e=Math.floor(t/1e3),r=Math.floor(e/60),a=e%60;return`${r}m ${String(a).padStart(2,"0")}s`}function Vt(i){let t=i.transporterTimeAttributes||{};return{itineraryId:i.itineraryId??null,transporterId:i.transporterId??null,routeCode:i.routeCode??null,serviceTypeName:i.serviceTypeName??null,driverName:null,blockDurationInMinutes:i.blockDurationInMinutes??null,waveStartTime:H(i.waveStartTime),itineraryStartTime:H(i.itineraryStartTime),plannedDepartureTime:H(i.plannedDepartureTime),actualDepartureTime:H(t.actualDepartureTime),plannedOutboundStemTime:t.plannedOutboundStemTime??null,actualOutboundStemTime:t.actualOutboundStemTime??null,lastDriverEventTime:H(i.lastDriverEventTime)}}function wt(i,t,e){let r=e==="asc"?1:-1;return[...i].sort((a,n)=>{let s=a[t],o=n[t];return s===null&&o===null?0:s===null?1:o===null?-1:typeof s=="string"?r*s.localeCompare(o):r*(s-o)})}var xt=[{key:"routeCode",label:"Route Code",type:"string"},{key:"serviceTypeName",label:"Service Type",type:"string"},{key:"driverName",label:"Driver",type:"string"},{key:"blockDurationInMinutes",label:"Block (min)",type:"integer"},{key:"waveStartTime",label:"Wave Start",type:"time"},{key:"itineraryStartTime",label:"Itin. Start",type:"time"},{key:"plannedDepartureTime",label:"Planned Dep.",type:"time"},{key:"actualDepartureTime",label:"Actual Dep.",type:"time"},{key:"plannedOutboundStemTime",label:"Planned OB Stem",type:"duration"},{key:"actualOutboundStemTime",label:"Actual OB Stem",type:"duration"},{key:"lastDriverEventTime",label:"Last Driver Event",type:"time"}],St=[{key:"itineraryId",label:"Itinerary ID",format:"string",suffix:""},{key:"routeCode",label:"Route Code",format:"string",suffix:""},{key:"serviceTypeName",label:"Service Type",format:"string",suffix:""},{key:"driverName",label:"Driver",format:"string",suffix:""},{key:"blockDurationInMinutes",label:"Block Duration",format:"integer",suffix:" min"},{key:"waveStartTime",label:"Wave Start",format:"time",suffix:""},{key:"itineraryStartTime",label:"Itin. Start",format:"time",suffix:""},{key:"plannedDepartureTime",label:"Planned Departure",format:"time",suffix:""},{key:"actualDepartureTime",label:"Actual Departure",format:"time",suffix:""},{key:"plannedOutboundStemTime",label:"Planned OB Stem",format:"duration",suffix:""},{key:"actualOutboundStemTime",label:"Actual OB Stem",format:"duration",suffix:""},{key:"lastDriverEventTime",label:"Last Driver Event",format:"time",suffix:""}],G=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_detailEl=null;_active=!1;_data=[];_sort={column:"routeCode",direction:"asc"};_page=1;_pageSize=50;_driverCache=new Map;init(){if(this._overlayEl)return;let t=document.createElement("div");t.id="ct-whd-overlay",t.className="ct-overlay",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.setAttribute("aria-label","Working Hours Dashboard"),t.innerHTML=`
      <div class="ct-whd-panel">
        <h2>\u23F1 Working Hours Dashboard</h2>
        <div class="ct-controls">
          <label for="ct-whd-date">Datum:</label>
          <input type="date" id="ct-whd-date" class="ct-input" value="${k()}" aria-label="Datum ausw\xE4hlen">
          <label for="ct-whd-sa">Service Area:</label>
          <select id="ct-whd-sa" class="ct-select" aria-label="Service Area"></select>
          <button class="ct-btn ct-btn--accent" id="ct-whd-go">\u{1F50D} Abfragen</button>
          <button class="ct-btn ct-btn--primary" id="ct-whd-export">\u{1F4CB} CSV Export</button>
          <button class="ct-btn ct-btn--close" id="ct-whd-close">\u2715 Schlie\xDFen</button>
        </div>
        <div id="ct-whd-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-whd-body"></div>
      </div>
    `,document.body.appendChild(t),this._overlayEl=t,t.addEventListener("click",e=>{e.target===t&&this.hide()}),t.addEventListener("keydown",e=>{e.key==="Escape"&&this.hide()}),document.getElementById("ct-whd-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-whd-go").addEventListener("click",()=>this._fetchData()),document.getElementById("ct-whd-export").addEventListener("click",()=>this._exportCSV()),this.companyConfig.load().then(()=>{this.companyConfig.populateSaSelect(document.getElementById("ct-whd-sa"))}),S(()=>this.dispose()),y("Working Hours Dashboard initialized")}dispose(){var t,e;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,(e=this._detailEl)==null||e.remove(),this._detailEl=null,this._data=[],this._active=!1}toggle(){if(!this.config.features.workingHours){alert("Working Hours Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,document.getElementById("ct-whd-date").focus()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}async _resolveDriverNames(t,e,r){if([...new Set(t.map(s=>s.transporterId).filter(s=>s!=null))].filter(s=>!this._driverCache.has(s)).length>0)try{let s=new Date(e+"T00:00:00"),o=new Date(s);o.setDate(o.getDate()-7);let c=new Date(s);c.setDate(c.getDate()+1);let l=`https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${o.toISOString().split("T")[0]}&toDate=${c.toISOString().split("T")[0]}&serviceAreaId=${r}`,d=D(),p={Accept:"application/json"};d&&(p["anti-csrftoken-a2z"]=d);let m=await fetch(l,{method:"GET",headers:p,credentials:"include"});if(m.ok){let f=await m.json(),h=Array.isArray(f)?f:(f==null?void 0:f.data)||(f==null?void 0:f.rosters)||[],v=_=>{for(let g of _)g.driverPersonId&&g.driverName&&this._driverCache.set(String(g.driverPersonId),g.driverName)};if(Array.isArray(h))v(h);else if(typeof h=="object")for(let _ of Object.values(h))Array.isArray(_)&&v(_);y(`[WHD] Roster loaded: ${this._driverCache.size} driver names cached`)}}catch(s){y("[WHD] Roster lookup failed (non-fatal):",s)}for(let s of t)s.transporterId&&(s.driverName=this._driverCache.get(s.transporterId)||null)}async _fetchData(){var a,n,s,o;let t=(a=document.getElementById("ct-whd-date"))==null?void 0:a.value,e=document.getElementById("ct-whd-sa"),r=e&&e.value?e.value:this.companyConfig.getDefaultServiceAreaId();if(!t){this._setStatus("\u26A0\uFE0F Bitte Datum ausw\xE4hlen.");return}if(!r){this._setStatus("\u26A0\uFE0F Bitte Service Area ausw\xE4hlen.");return}this._setStatus(`\u23F3 Lade Daten f\xFCr ${t}\u2026`),this._setBody('<div class="ct-whd-loading" role="status">Daten werden geladen\u2026</div>');try{let c=`https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${t}&serviceAreaId=${r}`,d=await(await T(async()=>{let h=await fetch(c,{method:"GET",credentials:"same-origin",headers:{Accept:"application/json, text/plain, */*","Accept-Language":"de,en-US;q=0.7,en;q=0.3","user-ref":"cortex-webapp-user","X-Cortex-Timestamp":Date.now().toString(),"X-Cortex-Session":F()??"",Referer:location.href}});if(!h.ok)throw new Error(`HTTP ${h.status}: ${h.statusText}`);return h},{retries:2,baseMs:800})).json(),p=(d==null?void 0:d.itinerarySummaries)||(d==null?void 0:d.summaries)||((n=d==null?void 0:d.data)==null?void 0:n.itinerarySummaries)||(d==null?void 0:d.data)||(Array.isArray(d)?d:[]);if(p.length===0){this._data=[],this._setBody('<div class="ct-whd-empty">\u{1F4ED} Keine Itineraries gefunden.<br><small>Bitte Datum/Service Area pr\xFCfen.</small></div>'),this._setStatus("\u26A0\uFE0F Keine Daten f\xFCr diesen Tag/Service Area.");return}this._data=p.map(Vt),this._setStatus(`\u23F3 ${this._data.length} Itineraries geladen, lade Fahrernamen\u2026`),await this._resolveDriverNames(this._data,t,r),this._page=1,this._sort={column:"routeCode",direction:"asc"},this._renderTable();let m=((s=this.companyConfig.getServiceAreas().find(h=>h.serviceAreaId===r))==null?void 0:s.stationCode)||r,f=this._data.filter(h=>h.driverName!==null).length;this._setStatus(`\u2705 ${this._data.length} Itineraries geladen \u2014 ${t} / ${m} | ${f} Fahrer zugeordnet`)}catch(c){w("WHD fetch failed:",c),this._data=[],this._setBody(`<div class="ct-whd-error" role="alert">\u274C Daten konnten nicht geladen werden.<br><small>${u(c.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-whd-retry">\u{1F504} Erneut versuchen</button></div>`),this._setStatus("\u274C Fehler beim Laden."),(o=document.getElementById("ct-whd-retry"))==null||o.addEventListener("click",()=>this._fetchData())}}_renderTable(){let t=wt(this._data,this._sort.column,this._sort.direction),e=Math.max(1,Math.ceil(t.length/this._pageSize));this._page>e&&(this._page=e);let r=(this._page-1)*this._pageSize,a=t.slice(r,r+this._pageSize),n=d=>this._sort.column!==d?"":`<span class="ct-whd-sort-icon">${this._sort.direction==="asc"?"\u25B2":"\u25BC"}</span>`,s=d=>this._sort.column!==d?"none":this._sort.direction==="asc"?"ascending":"descending",o=xt.map(d=>`<th scope="col" role="columnheader" aria-sort="${s(d.key)}" data-sort="${d.key}" title="Sort by ${u(d.label)}">
        ${u(d.label)}${n(d.key)}
      </th>`).join(""),c=a.map(d=>{let p=xt.map(m=>{let f=d[m.key];if(m.key==="driverName")return f==null?'<td class="ct-whd-driver ct-nodata">Unassigned</td>':`<td class="ct-whd-driver">${u(String(f))}</td>`;if(f==null)return'<td class="ct-nodata">\u2014</td>';switch(m.type){case"duration":return`<td>${u(rt(f))}</td>`;case"time":return`<td>${u(et(f))}</td>`;default:return`<td>${u(String(f))}</td>`}}).join("");return`<tr data-itinerary-id="${u(d.itineraryId||"")}" role="row" tabindex="0">${p}</tr>`}).join(""),l=this._renderPagination(t.length,this._page,e);this._setBody(`
      <div class="ct-whd-table-wrap">
        <table class="ct-table ct-whd-table" role="grid" aria-label="Working Hours Dashboard">
          <thead><tr>${o}</tr></thead>
          <tbody>${c}</tbody>
        </table>
      </div>
      ${l}`),this._attachTableHandlers()}_attachTableHandlers(){var e,r;let t=document.getElementById("ct-whd-body");t&&(t.querySelectorAll("th[data-sort]").forEach(a=>{a.addEventListener("click",()=>{let n=a.dataset.sort;this._sort.column===n?this._sort.direction=this._sort.direction==="asc"?"desc":"asc":(this._sort.column=n,this._sort.direction="asc"),this._renderTable()})}),t.querySelectorAll("tr[data-itinerary-id]").forEach(a=>{a.addEventListener("click",()=>{let n=a.dataset.itineraryId;n&&this._showDetail(n)}),a.addEventListener("keydown",n=>{if(n.key==="Enter"||n.key===" "){n.preventDefault();let s=a.dataset.itineraryId;s&&this._showDetail(s)}})}),(e=t.querySelector(".ct-whd-prev"))==null||e.addEventListener("click",()=>{this._page>1&&(this._page--,this._renderTable())}),(r=t.querySelector(".ct-whd-next"))==null||r.addEventListener("click",()=>{let a=Math.ceil(this._data.length/this._pageSize);this._page<a&&(this._page++,this._renderTable())}))}_renderPagination(t,e,r){return r<=1?"":`
      <div class="ct-whd-pagination">
        <button class="ct-btn ct-btn--secondary ct-whd-prev" ${e<=1?"disabled":""} aria-label="Vorherige Seite">\u2039 Zur\xFCck</button>
        <span class="ct-whd-page-info">Seite ${e} / ${r} (${t} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-whd-next" ${e>=r?"disabled":""} aria-label="N\xE4chste Seite">Weiter \u203A</button>
      </div>`}_showDetail(t){var c;let e=this._data.find(l=>l.itineraryId===t);if(!e)return;(c=this._detailEl)==null||c.remove(),this._detailEl=null;let r=(l,d)=>{if(d==null)return"\u2014";switch(l.format){case"time":return et(d);case"duration":return rt(d);case"integer":return String(d)+(l.suffix||"");default:return String(d)}},a=St.map(l=>{let d=r(l,e[l.key]);return`<div class="ct-whd-detail-row">
        <div>
          <span class="ct-whd-detail-label">${u(l.label)}</span><br>
          <span class="ct-whd-detail-value">${u(d)}</span>
        </div>
        <button class="ct-whd-copy-btn" data-copy-value="${u(d)}" aria-label="Copy ${u(l.label)}">\u{1F4CB} Copy</button>
      </div>`}).join(""),n=St.map(l=>`${l.label}: ${r(l,e[l.key])}`).join(`
`),s=document.createElement("div");s.className="ct-overlay visible",s.setAttribute("role","dialog"),s.setAttribute("aria-modal","true"),s.innerHTML=`
      <div class="ct-dialog" style="min-width:420px;max-width:580px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;color:var(--ct-primary);">\u{1F4CB} Itinerary Details</h3>
          <button class="ct-btn ct-btn--close" id="ct-whd-detail-close" aria-label="Close" style="margin-left:auto;">\u2715</button>
        </div>
        ${a}
        <div style="margin-top:16px;text-align:center;">
          <button class="ct-btn ct-btn--primary" id="ct-whd-copy-all">\u{1F4CB} Copy All</button>
        </div>
      </div>`,document.body.appendChild(s),this._detailEl=s;let o=()=>{s.remove(),this._detailEl=null};s.addEventListener("click",l=>{l.target===s&&o()}),document.getElementById("ct-whd-detail-close").addEventListener("click",o),s.addEventListener("keydown",l=>{l.key==="Escape"&&o()}),s.querySelectorAll(".ct-whd-copy-btn").forEach(l=>{l.addEventListener("click",d=>{d.stopPropagation();let p=l.dataset.copyValue;navigator.clipboard.writeText(p).then(()=>{let m=l.textContent;l.textContent="\u2705 Copied!",setTimeout(()=>{l.textContent=m},1500)}).catch(()=>{l.textContent="\u26A0\uFE0F Failed",setTimeout(()=>{l.textContent="\u{1F4CB} Copy"},1500)})})}),document.getElementById("ct-whd-copy-all").addEventListener("click",()=>{let l=document.getElementById("ct-whd-copy-all");navigator.clipboard.writeText(n).then(()=>{l.textContent="\u2705 All Copied!",setTimeout(()=>{l.textContent="\u{1F4CB} Copy All"},1500)}).catch(()=>{l.textContent="\u26A0\uFE0F Failed",setTimeout(()=>{l.textContent="\u{1F4CB} Copy All"},1500)})}),document.getElementById("ct-whd-detail-close").focus()}_exportCSV(){var m,f;if(!this._data||this._data.length===0){alert("Bitte zuerst Daten laden.");return}let t=";",e=["routeCode","serviceTypeName","blockDurationInMinutes","waveStartTime","itineraryStartTime","plannedDepartureTime","actualDepartureTime","plannedOutboundStemTime","actualOutboundStemTime","lastDriverEventTime","itineraryId"],r=e.join(t)+`
`,a=wt(this._data,this._sort.column,this._sort.direction);for(let h of a){let v=e.map(_=>{let g=h[_];return g==null?"":_==="plannedOutboundStemTime"||_==="actualOutboundStemTime"?rt(g):_==="routeCode"||_==="serviceTypeName"||_==="itineraryId"||_==="blockDurationInMinutes"?String(g):et(g)});r+=v.join(t)+`
`}let n=((m=document.getElementById("ct-whd-date"))==null?void 0:m.value)||k(),s=document.getElementById("ct-whd-sa"),o=s&&s.value?s.value:"",c=((f=this.companyConfig.getServiceAreas().find(h=>h.serviceAreaId===o))==null?void 0:f.stationCode)||"unknown",l=new Blob(["\uFEFF"+r],{type:"text/csv;charset=utf-8;"}),d=URL.createObjectURL(l),p=document.createElement("a");p.href=d,p.download=`working_hours_${n}_${c}.csv`,p.click(),URL.revokeObjectURL(d)}_setStatus(t){let e=document.getElementById("ct-whd-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-whd-body");e&&(e.innerHTML=t)}};function at(i){if(!i)return"\u2014";try{return new Date(Number(i)).toLocaleString("de-DE",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}catch{return"\u2014"}}function st(i){var a,n;let t=i.address||{},e=t.geocodeLatitude??((a=t.geocode)==null?void 0:a.latitude),r=t.geocodeLongitude??((n=t.geocode)==null?void 0:n.longitude);return e!=null&&r!=null?{lat:Number(e),lon:Number(r)}:null}function Gt(i){if(!i)return"ct-ret-card-reason--ok";let t=String(i).toUpperCase();return t.includes("DAMAGE")||t.includes("DEFECT")?"ct-ret-card-reason--error":t.includes("CUSTOMER")||t.includes("REFUSAL")?"ct-ret-card-reason--warn":"ct-ret-card-reason--ok"}var q=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_allPackages=[];_filteredPackages=[];_page=1;_pageSize=50;_sort={field:"lastUpdatedTime",direction:"desc"};_filters={search:"",city:"",postalCode:"",routeCode:"",reasonCode:""};_viewMode="table";_cache=new Map;_cacheExpiry=5*60*1e3;_transporterCache=new Map;init(){if(this._overlayEl)return;let t=k(),e=document.createElement("div");e.id="ct-ret-overlay",e.className="ct-overlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-label","Returns Dashboard"),e.innerHTML=`
      <div class="ct-ret-panel">
        <h2>\u{1F4E6} Returns Dashboard</h2>
        <div class="ct-ret-controls">
          <label for="ct-ret-date">Datum:</label>
          <input type="date" id="ct-ret-date" class="ct-input" value="${t}">
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
    `,document.body.appendChild(e),this._overlayEl=e,e.addEventListener("click",r=>{r.target===e&&this.hide()}),document.getElementById("ct-ret-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-ret-go").addEventListener("click",()=>this._loadData()),document.getElementById("ct-ret-export").addEventListener("click",()=>this._exportCSV()),document.getElementById("ct-ret-clear-filters").addEventListener("click",()=>this._clearFilters()),["ct-ret-search","ct-ret-city","ct-ret-postal","ct-ret-route","ct-ret-reason"].forEach(r=>{document.getElementById(r).addEventListener("input",()=>this._applyFilters())}),["ct-ret-sort-field","ct-ret-sort-dir"].forEach(r=>{document.getElementById(r).addEventListener("change",()=>this._applyFilters())}),document.getElementById("ct-ret-view-table").addEventListener("click",()=>{this._viewMode="table",this._updateViewToggle(),this._renderCards()}),document.getElementById("ct-ret-view-cards").addEventListener("click",()=>{this._viewMode="cards",this._updateViewToggle(),this._renderCards()}),this._initSaDropdown(),S(()=>this.dispose()),y("Returns Dashboard initialized")}dispose(){var t;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._allPackages=[],this._filteredPackages=[],this._active=!1}toggle(){if(!this.config.features.returnsDashboard){alert("Returns Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,document.getElementById("ct-ret-date").focus()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}async _initSaDropdown(){let t=document.getElementById("ct-ret-sa");t.innerHTML="",await this.companyConfig.load();let e=this.companyConfig.getServiceAreas(),r=e.length>0?e:[],a=this.companyConfig.getDefaultServiceAreaId();r.forEach(n=>{let s=document.createElement("option");s.value=n.serviceAreaId,s.textContent=n.stationCode,n.serviceAreaId===a&&(s.selected=!0),t.appendChild(s)})}async _resolveTransporterNames(t,e,r){let a=[...new Set(t.map(s=>s.transporterId).filter(s=>s!=null))];if(a.length===0)return;if(a.filter(s=>!this._transporterCache.has(s)).length>0)try{let s=new Date(e+"T00:00:00"),o=new Date(s);o.setDate(o.getDate()-7);let c=new Date(s);c.setDate(c.getDate()+1);let l=`https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${o.toISOString().split("T")[0]}&toDate=${c.toISOString().split("T")[0]}&serviceAreaId=${r}`,d=D(),p={Accept:"application/json"};d&&(p["anti-csrftoken-a2z"]=d);let m=await fetch(l,{method:"GET",headers:p,credentials:"include"});if(m.ok){let f=await m.json(),h=Array.isArray(f)?f:(f==null?void 0:f.data)||(f==null?void 0:f.rosters)||[],v=_=>{for(let g of _)g.driverPersonId&&g.driverName&&this._transporterCache.set(String(g.driverPersonId),g.driverName)};if(Array.isArray(h))v(h);else if(typeof h=="object")for(let _ of Object.values(h))Array.isArray(_)&&v(_);y(`[Returns] Roster loaded: ${this._transporterCache.size} driver names cached`)}}catch(s){y("[Returns] Roster lookup failed:",s)}}async _loadData(){var o;let t=document.getElementById("ct-ret-date").value,e=document.getElementById("ct-ret-sa").value,r=document.getElementById("ct-ret-routeview").checked;if(!t){this._setStatus("\u26A0\uFE0F Bitte Datum ausw\xE4hlen.");return}if(!e){this._setStatus("\u26A0\uFE0F Bitte Service Area ausw\xE4hlen.");return}let a=`${t}|${e}`,n=this._cache.get(a);if(n&&Date.now()-n.timestamp<this._cacheExpiry){y("Returns: using cached data"),this._allPackages=n.data,this._applyFilters(),this._setStatus(`\u2705 ${this._allPackages.length} Pakete aus Cache geladen`);return}this._setStatus("\u23F3 Lade Returns-Daten\u2026"),this._setBody('<div class="ct-ret-loading">Daten werden geladen\u2026</div>');let s=new URLSearchParams({historicalDay:"false",localDate:t,packageStatus:"RETURNED",routeView:String(r),serviceAreaId:e,statsFromSummaries:"true"});try{let l=await(await T(async()=>{let p=await fetch(`https://logistics.amazon.de/operations/execution/api/packages/packagesByStatus?${s}`,{method:"GET",credentials:"same-origin",headers:{Accept:"application/json, text/plain, */*","Accept-Language":"de,en-US;q=0.7,en;q=0.3",Referer:location.href}});if(!p.ok)throw new Error(`HTTP ${p.status}: ${p.statusText}`);return p},{retries:3,baseMs:500})).json(),d=Array.isArray(l==null?void 0:l.packages)?l.packages:[];this._cache.set(a,{data:d,timestamp:Date.now()}),this._allPackages=d,this._setStatus(`\u23F3 ${d.length} Pakete geladen, lade Fahrernamen\u2026`),await this._resolveTransporterNames(d,t,e),this._page=1,this._applyFilters(),this._setStatus(`\u2705 ${d.length} Pakete geladen f\xFCr ${t}`)}catch(c){w("Returns fetch failed:",c),this._setBody(`<div class="ct-ret-error" role="alert">\u274C Daten konnten nicht geladen werden.<br><small>${u(c.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-ret-retry">\u{1F504} Erneut versuchen</button></div>`),this._setStatus("\u274C Fehler beim Laden."),(o=document.getElementById("ct-ret-retry"))==null||o.addEventListener("click",()=>this._loadData())}}_clearFilters(){["ct-ret-search","ct-ret-city","ct-ret-postal","ct-ret-route","ct-ret-reason"].forEach(t=>{document.getElementById(t).value=""}),this._filters={search:"",city:"",postalCode:"",routeCode:"",reasonCode:""},this._applyFilters()}_applyFilters(){this._filters={search:(document.getElementById("ct-ret-search").value||"").toLowerCase().trim(),city:(document.getElementById("ct-ret-city").value||"").toLowerCase().trim(),postalCode:(document.getElementById("ct-ret-postal").value||"").toLowerCase().trim(),routeCode:(document.getElementById("ct-ret-route").value||"").toLowerCase().trim(),reasonCode:(document.getElementById("ct-ret-reason").value||"").toLowerCase().trim()};let t=document.getElementById("ct-ret-sort-field").value,e=document.getElementById("ct-ret-sort-dir").value;this._filteredPackages=this._allPackages.filter(r=>{let a=r.address||{};return!(this._filters.search&&!String(r.scannableId||"").toLowerCase().includes(this._filters.search)||this._filters.city&&!String(a.city||"").toLowerCase().includes(this._filters.city)||this._filters.postalCode&&!String(a.postalCode||"").toLowerCase().includes(this._filters.postalCode)||this._filters.routeCode&&!String(r.routeCode||"").toLowerCase().includes(this._filters.routeCode)||this._filters.reasonCode&&!String(r.reasonCode||"").toLowerCase().includes(this._filters.reasonCode))}),this._filteredPackages.sort((r,a)=>{var l,d;let n=r[t],s=a[t],o,c;return t==="lastUpdatedTime"?(o=Number(n)||0,c=Number(s)||0):t==="city"?(o=(((l=r.address)==null?void 0:l.city)||"").toString().toLowerCase(),c=(((d=a.address)==null?void 0:d.city)||"").toString().toLowerCase()):t==="routeCode"?(o=(r.routeCode||"").toString().toLowerCase(),c=(a.routeCode||"").toString().toLowerCase()):(o=(n||"").toString().toLowerCase(),c=(s||"").toString().toLowerCase()),o<c?e==="asc"?-1:1:o>c?e==="asc"?1:-1:0}),this._renderStats(),this._renderCards()}_renderStats(){let t=this._allPackages.length,e=this._filteredPackages.length,r=document.getElementById("ct-ret-count");r&&(r.textContent=e===t?`${t} Pakete`:`${e} von ${t} Paketen`)}_updateViewToggle(){document.getElementById("ct-ret-view-table").classList.toggle("active",this._viewMode==="table"),document.getElementById("ct-ret-view-cards").classList.toggle("active",this._viewMode==="cards")}_renderCards(){let t=Math.ceil(this._filteredPackages.length/this._pageSize);this._page>t&&(this._page=Math.max(1,t));let e=(this._page-1)*this._pageSize,r=this._filteredPackages.slice(e,e+this._pageSize);if(r.length===0){this._setBody('<div class="ct-ret-empty">Keine Returns f\xFCr die gew\xE4hlten Filter gefunden.</div>'),this._renderPagination(0,1,1);return}if(this._viewMode==="table")this._renderTable(r);else{let a=r.map(n=>this._renderCard(n)).join("");this._setBody(`<div class="ct-ret-cards">${a}</div>`)}this._renderPagination(this._filteredPackages.length,this._page,t)}_renderTable(t){let e=t.map(r=>{let a=r.address||{},n=st(r),s=r.transporterId&&this._transporterCache.get(String(r.transporterId))||"\u2014";return`<tr>
        <td title="${u(r.scannableId||"")}">${u(String(r.scannableId||"\u2014"))}</td>
        <td>${u(s)}</td>
        <td>${at(r.lastUpdatedTime)}</td>
        <td>${u(String(r.reasonCode||"\u2014"))}</td>
        <td>${u(String(r.routeCode||"\u2014"))}</td>
        <td>${u(String(a.address1||""))}</td>
        <td>${u(String(a.postalCode||""))}</td>
        <td>${u(String(a.city||"\u2014"))}</td>
        <td>${n?`<a href="https://www.google.com/maps/search/?api=1&query=${n.lat},${n.lon}" target="_blank" rel="noopener">\u{1F4CD}</a>`:"\u2014"}</td>
      </tr>`}).join("");this._setBody(`
      <div class="ct-ret-table-wrap">
        <table class="ct-table ct-ret-table">
          <thead><tr>
            <th>ScannableId</th><th>Transporter</th><th>Zeit</th><th>Reason</th>
            <th>Route</th><th>Adresse</th><th>PLZ</th><th>Stadt</th><th>Map</th>
          </tr></thead>
          <tbody>${e}</tbody>
        </table>
      </div>`)}_renderCard(t){let e=t.address||{},r=st(t),a=r?`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}`:null,n=String(t.reasonCode||"Unbekannt"),s=t.transporterId&&this._transporterCache.get(String(t.transporterId))||"\u2014";return`<div class="ct-ret-card">
      <div class="ct-ret-card-header">
        <span class="ct-ret-card-id">${u(String(t.scannableId||"\u2014"))}</span>
        <span class="ct-ret-card-reason ${Gt(t.reasonCode)}">${u(n)}</span>
      </div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Transporter:</span><span class="ct-ret-card-value">${u(s)}</span></div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Aktualisiert:</span><span class="ct-ret-card-value">${at(t.lastUpdatedTime)}</span></div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Route:</span><span class="ct-ret-card-value">${u(String(t.routeCode||"\u2014"))}</span></div>
      <div class="ct-ret-card-address">
        ${u(String(e.address1||""))}${e.address2?", "+u(String(e.address2)):""}<br>
        ${u(String(e.postalCode||""))} ${u(String(e.city||""))}
        ${r?`<br><small>\u{1F4CD} ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}</small>`:""}
        ${a?`<a href="${a}" class="ct-ret-card-map" target="_blank" rel="noopener">\u{1F4CD} In Karte \xF6ffnen</a>`:""}
      </div>
    </div>`}_renderPagination(t,e,r){var s,o,c,l,d;let a=document.getElementById("ct-ret-body");if(!a)return;let n=(s=a.parentNode)==null?void 0:s.querySelector(".ct-ret-pagination");n&&n.remove(),!(r<=1)&&(a.insertAdjacentHTML("afterend",`
      <div class="ct-ret-pagination">
        <button class="ct-btn ct-btn--secondary ct-ret-prev" ${e<=1?"disabled":""}>\u2039 Zur\xFCck</button>
        <span class="ct-ret-page-info">Seite ${e} / ${r} (${t} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-ret-next" ${e>=r?"disabled":""}>Weiter \u203A</button>
      </div>`),(c=(o=a.parentNode)==null?void 0:o.querySelector(".ct-ret-prev"))==null||c.addEventListener("click",()=>{this._page>1&&(this._page--,this._renderCards())}),(d=(l=a.parentNode)==null?void 0:l.querySelector(".ct-ret-next"))==null||d.addEventListener("click",()=>{this._page<r&&(this._page++,this._renderCards())}))}_exportCSV(){if(this._filteredPackages.length===0){alert("Keine Daten zum Exportieren.");return}let e=["scannableId","transporter","lastUpdatedTime","reasonCode","routeCode","address1","address2","city","postalCode","latitude","longitude"].join(";")+`
`;for(let s of this._filteredPackages){let o=s.address||{},c=st(s),l=s.transporterId&&this._transporterCache.get(String(s.transporterId))||"",d=[s.scannableId||"",l,at(s.lastUpdatedTime),s.reasonCode||"",s.routeCode||"",o.address1||"",o.address2||"",o.city||"",o.postalCode||"",(c==null?void 0:c.lat)??"",(c==null?void 0:c.lon)??""];e+=d.map(p=>String(p).replace(/;/g,",")).join(";")+`
`}let r=new Blob(["\uFEFF"+e],{type:"text/csv;charset=utf-8;"}),a=URL.createObjectURL(r),n=document.createElement("a");n.href=a,n.download=`returns_${k()}.csv`,n.click(),URL.revokeObjectURL(a)}_setStatus(t){let e=document.getElementById("ct-ret-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-ret-body");e&&(e.innerHTML=t)}};function Y(i){if(i==null)return NaN;let t=String(i).trim();if(t==="-"||t==="")return NaN;let e=parseFloat(t.replace(",","."));return isNaN(e)?NaN:e}function $t(i){let t=typeof i=="string"?JSON.parse(i):i,e={};for(let[s,o]of Object.entries(t))e[s.trim()]=o;let r=e.dcr_metric!==void 0?Number(e.dcr_metric):NaN,a=e.pod_metric!==void 0?Number(e.pod_metric):NaN,n=e.cc_metric!==void 0?Number(e.cc_metric):NaN;return{transporterId:String(e.country_program_providerid_stationcode||e.dsp_code||""),delivered:String(e.delivered||"0"),dcr:isNaN(r)?"-":(r*100).toFixed(2),dnrDpmo:String(e.dnr_dpmo??"0"),lorDpmo:String(e.lor_dpmo??"0"),pod:isNaN(a)?"-":(a*100).toFixed(2),cc:isNaN(n)?"-":(n*100).toFixed(2),ce:String(e.ce_metric??"0"),cdfDpmo:String(e.cdf_dpmo??"0"),daName:String(e.da_name||""),week:String(e.week||""),year:String(e.year||""),stationCode:String(e.station_code||""),dspCode:String(e.dsp_code||""),dataDate:String(e.data_date||""),country:String(e.country||""),program:String(e.program||""),region:String(e.region||""),lastUpdated:String(e.last_updated_time||""),_raw:e}}function Dt(i){let t=(Y(i.dcr==="-"?"100":i.dcr)||0)/100,e=parseFloat(i.dnrDpmo)||0,r=parseFloat(i.lorDpmo)||0,a=(Y(i.pod==="-"?"100":i.pod)||0)/100,n=(Y(i.cc==="-"?"100":i.cc)||0)/100,s=parseFloat(i.ce)||0,o=parseFloat(i.cdfDpmo)||0,c=parseFloat(i.delivered)||0,l=Math.max(Math.min(132.88*t+10*Math.max(0,1-o/1e4)-.0024*e-8.54*s+10*a+4*n+45e-5*c-60.88,100),0);if(t===1&&a===1&&n===1&&o===0&&s===0&&e===0&&r===0)l=100;else{let m=0;if(t*100<97&&m++,e>=1500&&m++,a*100<94&&m++,n*100<70&&m++,s!==0&&m++,o>=8e3&&m++,m>=2||m===1){let f=0;t*100<97&&(f+=(97-t*100)/5),e>=1500&&(f+=(e-1500)/1e3),a*100<94&&(f+=(94-a*100)/10),n*100<70&&(f+=(70-n*100)/50),s!==0&&(f+=s*1),o>=8e3&&(f+=(o-8e3)/2e3);let h=Math.min(3,f);l=Math.min(l,(m>=2?70:85)-h)}}let d=parseFloat(l.toFixed(2)),p=d<40?"Poor":d<70?"Fair":d<85?"Great":d<93?"Fantastic":"Fantastic Plus";return{transporterId:i.transporterId,delivered:i.delivered,dcr:(t*100).toFixed(2),dnrDpmo:e.toFixed(2),lorDpmo:r.toFixed(2),pod:(a*100).toFixed(2),cc:(n*100).toFixed(2),ce:s.toFixed(2),cdfDpmo:o.toFixed(2),status:p,totalScore:d,daName:i.daName,week:i.week,year:i.year,stationCode:i.stationCode,dspCode:i.dspCode,dataDate:i.dataDate,lastUpdated:i.lastUpdated,originalData:{dcr:i.dcr,dnrDpmo:i.dnrDpmo,lorDpmo:i.lorDpmo,pod:i.pod,cc:i.cc,ce:i.ce,cdfDpmo:i.cdfDpmo}}}function R(i,t){switch(t){case"DCR":return i<97?"poor":i<98.5?"fair":i<99.5?"great":"fantastic";case"DNRDPMO":case"LORDPMO":return i<1100?"fantastic":i<1300?"great":i<1500?"fair":"poor";case"POD":return i<94?"poor":i<95.5?"fair":i<97?"great":"fantastic";case"CC":return i<70?"poor":i<95?"fair":i<98.5?"great":"fantastic";case"CE":return i===0?"fantastic":"poor";case"CDFDPMO":return i>5460?"poor":i>4450?"fair":i>3680?"great":"fantastic";default:return""}}function kt(i){switch(i){case"Poor":return"poor";case"Fair":return"fair";case"Great":return"great";case"Fantastic":case"Fantastic Plus":return"fantastic";default:return""}}function Et(i){try{let t=i==null?void 0:i.tableData,e=t==null?void 0:t.da_dsp_station_weekly_quality,r=e==null?void 0:e.rows;if(!Array.isArray(r)||r.length===0)return[];let a=[];for(let n=0;n<r.length;n++)try{a.push($t(r[n]))}catch(s){w("Scorecard: failed to parse row",n,s)}return a}catch(t){return w("scParseApiResponse error:",t),[]}}function Ct(i){return i?/^\d{4}-W\d{2}$/.test(i)?null:"Week format must be YYYY-Www (e.g. 2026-W12).":"Week is required."}function Tt(){let i=new Date,t=new Date(Date.UTC(i.getFullYear(),i.getMonth(),i.getDate())),e=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-e);let r=new Date(Date.UTC(t.getUTCFullYear(),0,1)),a=Math.ceil(((t.getTime()-r.getTime())/864e5+1)/7);return`${t.getUTCFullYear()}-W${String(a).padStart(2,"0")}`}function qt(i){let t=new Date;t.setDate(t.getDate()-i*7);let e=new Date(Date.UTC(t.getFullYear(),t.getMonth(),t.getDate())),r=e.getUTCDay()||7;e.setUTCDate(e.getUTCDate()+4-r);let a=new Date(Date.UTC(e.getUTCFullYear(),0,1)),n=Math.ceil(((e.getTime()-a.getTime())/864e5+1)/7);return`${e.getUTCFullYear()}-W${String(n).padStart(2,"0")}`}function A(i,t){switch(t){case"DCR":return i<97?"rgb(235,50,35)":i<98.5?"rgb(223,130,68)":i<99.5?"rgb(126,170,85)":"rgb(77,115,190)";case"DNRDPMO":case"LORDPMO":return i<1100?"rgb(77,115,190)":i<1300?"rgb(126,170,85)":i<1500?"rgb(223,130,68)":"rgb(235,50,35)";case"POD":return i<94?"rgb(235,50,35)":i<95.5?"rgb(223,130,68)":i<97?"rgb(126,170,85)":"rgb(77,115,190)";case"CC":return i<70?"rgb(235,50,35)":i<95?"rgb(223,130,68)":i<98.5?"rgb(126,170,85)":"rgb(77,115,190)";case"CE":return i===0?"rgb(77,115,190)":"rgb(235,50,35)";case"CDFDPMO":return i>5460?"rgb(235,50,35)":i>4450?"rgb(223,130,68)":i>3680?"rgb(126,170,85)":"rgb(77,115,190)";default:return"#111111"}}function Yt(i){switch(i){case"Poor":return"rgb(235,50,35)";case"Fair":return"rgb(223,130,68)";case"Great":return"rgb(126,170,85)";case"Fantastic":case"Fantastic Plus":return"rgb(77,115,190)";default:return"#111111"}}var K=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_cache=new Map;_calculatedData=[];_currentSort={field:"totalScore",dir:"desc"};_currentPage=0;_pageSize=50;helpers={scConvertToDecimal:Y,scParseRow:$t,scCalculateScore:Dt,scKpiClass:R,scStatusClass:kt,scParseApiResponse:Et,scValidateWeek:Ct,scCurrentWeek:Tt,scWeeksAgo:qt};init(){if(this._overlayEl)return;let t=Tt(),e=document.createElement("div");e.id="ct-sc-overlay",e.className="ct-overlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-label","Scorecard Dashboard"),e.innerHTML=`
      <div class="ct-sc-panel">
        <h2>\u{1F4CB} Scorecard</h2>
        <div class="ct-controls">
          <label for="ct-sc-week">Week:</label>
          <input type="text" id="ct-sc-week" class="ct-input" value="${t}" placeholder="YYYY-Www" maxlength="8" style="width:100px">
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
    `,document.body.appendChild(e),this._overlayEl=e,this.companyConfig.load().then(()=>{this.companyConfig.populateSaSelect(document.getElementById("ct-sc-sa"))}),e.addEventListener("click",r=>{r.target===e&&this.hide()}),e.addEventListener("keydown",r=>{r.key==="Escape"&&this.hide()}),document.getElementById("ct-sc-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-sc-go").addEventListener("click",()=>this._triggerFetch()),document.getElementById("ct-sc-export").addEventListener("click",()=>this._exportCSV()),document.getElementById("ct-sc-imgdl").addEventListener("click",()=>this._downloadAsImage()),S(()=>this.dispose()),y("Scorecard Dashboard initialized")}dispose(){var t;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._active=!1,this._cache.clear(),this._calculatedData=[]}toggle(){if(!this.config.features.scorecard){alert("Scorecard ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,document.getElementById("ct-sc-week").focus()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}_buildUrl(t,e,r){return`https://logistics.amazon.de/performance/api/v1/getData?dataSetId=${encodeURIComponent("da_dsp_station_weekly_quality")}&dsp=${encodeURIComponent(r)}&from=${encodeURIComponent(t)}&station=${encodeURIComponent(e)}&timeFrame=Weekly&to=${encodeURIComponent(t)}`}async _fetchData(t,e,r){let a=`sc|${t}|${e}|${r}`;if(this._cache.has(a))return y("Scorecard cache hit:",a),this._cache.get(a);let n=D(),s={Accept:"application/json"};n&&(s["anti-csrftoken-a2z"]=n);let c=await(await T(async()=>{let l=await fetch(this._buildUrl(t,e,r),{method:"GET",headers:s,credentials:"include"});if(!l.ok)throw new Error(`HTTP ${l.status}: ${l.statusText}`);return l},{retries:2,baseMs:800})).json();return this._cache.set(a,c),this._cache.size>50&&this._cache.delete(this._cache.keys().next().value),c}async _triggerFetch(){var s,o;let t=document.getElementById("ct-sc-week").value.trim(),e=Ct(t);if(e){this._setStatus("\u26A0\uFE0F "+e);return}let r=document.getElementById("ct-sc-sa"),a=((o=(s=r.options[r.selectedIndex])==null?void 0:s.textContent)==null?void 0:o.trim().toUpperCase())||this.companyConfig.getDefaultStation(),n=this.companyConfig.getDspCode();this._setStatus("\u23F3 Loading\u2026"),this._setBody('<div class="ct-sc-loading" role="status">Fetching scorecard data\u2026</div>');try{let c=await this._fetchData(t,a,n),l=Et(c);if(l.length===0){this._setBody('<div class="ct-sc-empty">No data returned for the selected week.</div>'),this._setStatus("\u26A0\uFE0F No records found.");return}let d=l.map(p=>{try{return Dt(p)}catch(m){return w("Scorecard: failed to calculate score:",p,m),null}}).filter(p=>p!==null);if(d.length===0){this._setBody('<div class="ct-sc-error">All rows failed score calculation.</div>'),this._setStatus("\u274C Calculation failed for all rows.");return}d.sort((p,m)=>m.totalScore-p.totalScore),this._calculatedData=d,this._currentPage=0,this._currentSort={field:"totalScore",dir:"desc"},this._renderAll(),this._setStatus(`\u2705 ${d.length} record(s) loaded \u2014 ${t}`)}catch(c){w("Scorecard fetch failed:",c),this._setBody(`<div class="ct-sc-error">\u274C ${u(c.message)}</div>`),this._setStatus("\u274C Failed to load data.")}}_setStatus(t){let e=document.getElementById("ct-sc-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-sc-body");e&&(e.innerHTML=t)}_renderAll(){var m,f;let t=this._calculatedData;if(!t.length)return;let e=t.reduce((h,v)=>h+v.totalScore,0)/t.length,r={};for(let h of t)r[h.status]=(r[h.status]||0)+1;let a=`
      <div class="ct-sc-tiles">
        <div class="ct-sc-tile"><div class="ct-sc-tile-val">${t.length}</div><div class="ct-sc-tile-lbl">Total Records</div></div>
        <div class="ct-sc-tile"><div class="ct-sc-tile-val">${e.toFixed(1)}</div><div class="ct-sc-tile-lbl">Avg Score</div></div>
        <div class="ct-sc-tile ct-sc-tile--fantastic"><div class="ct-sc-tile-val">${(r.Fantastic||0)+(r["Fantastic Plus"]||0)}</div><div class="ct-sc-tile-lbl">Fantastic(+)</div></div>
        <div class="ct-sc-tile ct-sc-tile--great"><div class="ct-sc-tile-val">${r.Great||0}</div><div class="ct-sc-tile-lbl">Great</div></div>
        <div class="ct-sc-tile ct-sc-tile--fair"><div class="ct-sc-tile-val">${r.Fair||0}</div><div class="ct-sc-tile-lbl">Fair</div></div>
        <div class="ct-sc-tile ct-sc-tile--poor"><div class="ct-sc-tile-val">${r.Poor||0}</div><div class="ct-sc-tile-lbl">Poor</div></div>
      </div>`,n=this._currentPage*this._pageSize,s=t.slice(n,Math.min(n+this._pageSize,t.length)),o=Math.ceil(t.length/this._pageSize),c=h=>this._currentSort.field!==h?"":this._currentSort.dir==="asc"?" \u25B2":" \u25BC",l=s.map((h,v)=>{let _=n+v+1,g=kt(h.status);return`<tr>
        <td>${_}</td>
        <td title="${u(h.transporterId)}">${u(h.daName||h.transporterId)}</td>
        <td class="ct-sc-status--${g}">${u(h.status)}</td>
        <td><strong>${h.totalScore.toFixed(2)}</strong></td>
        <td>${u(Number(h.delivered).toLocaleString())}</td>
        <td class="ct-sc-color--${R(parseFloat(h.dcr),"DCR")}">${h.dcr}%</td>
        <td class="ct-sc-color--${R(parseFloat(h.dnrDpmo),"DNRDPMO")}">${parseInt(h.dnrDpmo,10)}</td>
        <td class="ct-sc-color--${R(parseFloat(h.lorDpmo),"LORDPMO")}">${parseInt(h.lorDpmo,10)}</td>
        <td class="ct-sc-color--${R(parseFloat(h.pod),"POD")}">${h.pod}%</td>
        <td class="ct-sc-color--${R(parseFloat(h.cc),"CC")}">${h.cc}%</td>
        <td class="ct-sc-color--${R(parseFloat(h.ce),"CE")}">${parseInt(h.ce,10)}</td>
        <td class="ct-sc-color--${R(parseFloat(h.cdfDpmo),"CDFDPMO")}">${parseInt(h.cdfDpmo,10)}</td>
      </tr>`}).join(""),d=`
      <div class="ct-sc-table-wrap">
        <table class="ct-sc-table">
          <thead><tr>
            <th data-sort="place">#${c("place")}</th>
            <th data-sort="daName">DA${c("daName")}</th>
            <th data-sort="status">Status${c("status")}</th>
            <th data-sort="totalScore">Total Score${c("totalScore")}</th>
            <th data-sort="delivered">Delivered${c("delivered")}</th>
            <th data-sort="dcr">DCR${c("dcr")}</th>
            <th data-sort="dnrDpmo">DNR DPMO${c("dnrDpmo")}</th>
            <th data-sort="lorDpmo">LOR DPMO${c("lorDpmo")}</th>
            <th data-sort="pod">POD${c("pod")}</th>
            <th data-sort="cc">CC${c("cc")}</th>
            <th data-sort="ce">CE${c("ce")}</th>
            <th data-sort="cdfDpmo">CDF DPMO${c("cdfDpmo")}</th>
          </tr></thead>
          <tbody>${l}</tbody>
        </table>
      </div>`,p=o>1?`
      <div class="ct-sc-pagination">
        <button class="ct-btn ct-btn--secondary ct-sc-page-prev" ${this._currentPage===0?"disabled":""}>\u25C0 Prev</button>
        <span class="ct-sc-page-info">Page ${this._currentPage+1} of ${o}</span>
        <button class="ct-btn ct-btn--secondary ct-sc-page-next" ${this._currentPage>=o-1?"disabled":""}>Next \u25B6</button>
      </div>`:"";this._setBody(a+d+p),document.querySelectorAll(".ct-sc-table th[data-sort]").forEach(h=>{h.addEventListener("click",()=>{let v=h.getAttribute("data-sort");v!=="place"&&(this._currentSort.field===v?this._currentSort.dir=this._currentSort.dir==="asc"?"desc":"asc":this._currentSort={field:v,dir:"desc"},this._sortData(),this._currentPage=0,this._renderAll())})}),(m=document.querySelector(".ct-sc-page-prev"))==null||m.addEventListener("click",()=>{this._currentPage--,this._renderAll()}),(f=document.querySelector(".ct-sc-page-next"))==null||f.addEventListener("click",()=>{this._currentPage++,this._renderAll()})}_sortData(){let{field:t,dir:e}=this._currentSort,r=e==="asc"?1:-1;this._calculatedData.sort((a,n)=>{let s=parseFloat(String(a[t])),o=parseFloat(String(n[t]));return!isNaN(s)&&!isNaN(o)?(s-o)*r:String(a[t]||"").localeCompare(String(n[t]||""))*r})}_downloadAsImage(){var e;let t=this._calculatedData;if(!t.length){this._setStatus("\u26A0\uFE0F No data to capture. Fetch data first.");return}this._setStatus("\u23F3 Generating image\u2026");try{let a="Arial, sans-serif",m=((e=document.getElementById("ct-sc-week"))==null?void 0:e.value)||"",f=[{label:"#",w:36,get:(b,I)=>String(I+1),color:void 0},{label:"DA",w:180,get:b=>b.daName||b.transporterId,color:void 0},{label:"Status",w:90,get:b=>b.status,color:b=>Yt(b.status)},{label:"Score",w:60,get:b=>b.totalScore.toFixed(2),color:void 0},{label:"Delivered",w:70,get:b=>String(Number(b.delivered).toLocaleString()),color:void 0},{label:"DCR",w:58,get:b=>b.dcr+"%",color:b=>A(parseFloat(b.dcr),"DCR")},{label:"DNR DPMO",w:72,get:b=>String(parseInt(b.dnrDpmo,10)),color:b=>A(parseFloat(b.dnrDpmo),"DNRDPMO")},{label:"LOR DPMO",w:72,get:b=>String(parseInt(b.lorDpmo,10)),color:b=>A(parseFloat(b.lorDpmo),"LORDPMO")},{label:"POD",w:58,get:b=>b.pod+"%",color:b=>A(parseFloat(b.pod),"POD")},{label:"CC",w:58,get:b=>b.cc+"%",color:b=>A(parseFloat(b.cc),"CC")},{label:"CE",w:44,get:b=>String(parseInt(b.ce,10)),color:b=>A(parseFloat(b.ce),"CE")},{label:"CDF DPMO",w:72,get:b=>String(parseInt(b.cdfDpmo,10)),color:b=>A(parseFloat(b.cdfDpmo),"CDFDPMO")}],h=f.reduce((b,I)=>b+I.w,0),v=55+t.length*24,_=document.createElement("canvas");_.width=h*2,_.height=v*2;let g=_.getContext("2d");g.scale(2,2),g.fillStyle="#ffffff",g.fillRect(0,0,h,v),g.fillStyle="#232f3e",g.fillRect(0,0,h,32),g.fillStyle="#ff9900",g.font=`bold 14px ${a}`,g.textBaseline="middle",g.textAlign="left",g.fillText(`\u{1F4CB} Scorecard${m?" \u2014 "+m:""}`,8,32/2);let x=0;g.fillStyle="#232f3e",g.fillRect(0,32,h,23),g.font=`bold 11px ${a}`,g.fillStyle="#ff9900",g.textBaseline="middle";for(let b of f)g.textAlign="center",g.save(),g.beginPath(),g.rect(x,32,b.w,23),g.clip(),g.fillText(b.label,x+b.w/2,32+23/2),g.restore(),g.strokeStyle="#3d4f60",g.lineWidth=.5,g.beginPath(),g.moveTo(x,32),g.lineTo(x,55),g.stroke(),x+=b.w;g.font=`12px ${a}`,g.lineWidth=.5;for(let b=0;b<t.length;b++){let I=t[b],C=55+b*24;g.fillStyle=b%2===0?"#ffffff":"#f9f9f9",g.fillRect(0,C,h,24),g.strokeStyle="#dddddd",g.beginPath(),g.moveTo(0,C+24),g.lineTo(h,C+24),g.stroke(),x=0;for(let M of f){let At=M.get(I,b),Mt=M.color?M.color(I):"#111111";g.fillStyle=Mt,g.textBaseline="middle",g.textAlign="center",g.save(),g.beginPath(),g.rect(x+1,C,M.w-2,24),g.clip(),g.fillText(At,x+M.w/2,C+24/2),g.restore(),g.strokeStyle="#dddddd",g.beginPath(),g.moveTo(x,C),g.lineTo(x,C+24),g.stroke(),x+=M.w}}g.strokeStyle="#aaaaaa",g.lineWidth=1,g.strokeRect(0,0,h,v),_.toBlob(b=>{if(!b){this._setStatus("\u274C Image generation failed.");return}let I=URL.createObjectURL(b),C=document.createElement("a");C.href=I,C.download=`scorecard_${m||"export"}.png`,C.click(),URL.revokeObjectURL(I),this._setStatus("\u2705 Image downloaded.")},"image/png")}catch(r){w("Scorecard image download failed:",r),this._setStatus("\u274C Image generation failed: "+r.message)}}_exportCSV(){var s;if(!this._calculatedData.length){this._setStatus("\u26A0\uFE0F No data to export.");return}let e=[["Place","DA","Status","Total Score","Delivered","DCR","DNR DPMO","LOR DPMO","POD","CC","CE","CDF DPMO","Station","DSP"].join(";")];this._calculatedData.forEach((o,c)=>{e.push([c+1,o.daName||o.transporterId,o.status,o.totalScore.toFixed(2),o.delivered,o.dcr,parseInt(o.dnrDpmo,10),parseInt(o.lorDpmo,10),o.pod,o.cc,parseInt(o.ce,10),parseInt(o.cdfDpmo,10),o.stationCode,o.dspCode].join(";"))});let r=new Blob(["\uFEFF"+e.join(`
`)],{type:"text/csv;charset=utf-8;"}),a=URL.createObjectURL(r),n=document.createElement("a");n.href=a,n.download=`scorecard_${((s=document.getElementById("ct-sc-week"))==null?void 0:s.value)||"data"}.csv`,n.click(),URL.revokeObjectURL(a),this._setStatus("\u2705 CSV exported.")}};function $(i,t,e){return`
    <div class="ct-settings-row">
      <label for="${u(i)}">${u(t)}</label>
      <label class="ct-toggle">
        <input type="checkbox" id="${u(i)}" ${e?"checked":""}>
        <span class="ct-slider"></span>
      </label>
    </div>
  `}function It(i){let t=document.getElementById("ct-settings-overlay");t&&t.remove();let e=document.createElement("div");e.id="ct-settings-overlay",e.className="ct-overlay visible",e.innerHTML=`
    <div class="ct-dialog" style="min-width: 400px;">
      <h3>\u2699 Einstellungen</h3>

      ${$("ct-set-whc","WHC Dashboard",i.features.whcDashboard)}
      ${$("ct-set-dre","Date Range Extractor",i.features.dateExtractor)}
      ${$("ct-set-dp","Daily Delivery Performance",i.features.deliveryPerf)}
      ${$("ct-set-dvic","DVIC Check",i.features.dvicCheck)}
      ${$("ct-set-dvic-tp","DVIC: Transporter-Spalte",i.features.dvicShowTransporters)}
      ${$("ct-set-whd","Working Hours Dashboard",i.features.workingHours)}
      ${$("ct-set-ret","Returns Dashboard",i.features.returnsDashboard)}
      ${$("ct-set-sc","Scorecard",i.features.scorecard)}
      ${$("ct-set-dev","Dev-Mode (ausf\xFChrliches Logging)",i.dev)}

      <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
        <button class="ct-btn ct-btn--secondary" id="ct-set-cancel">Abbrechen</button>
        <button class="ct-btn ct-btn--accent" id="ct-set-save">Speichern</button>
      </div>
    </div>
  `,document.body.appendChild(e),e.addEventListener("click",r=>{r.target===e&&e.remove()}),document.getElementById("ct-set-cancel").addEventListener("click",()=>e.remove()),document.getElementById("ct-set-save").addEventListener("click",()=>{let r=a=>document.getElementById(a).checked;i.features.whcDashboard=r("ct-set-whc"),i.features.dateExtractor=r("ct-set-dre"),i.features.deliveryPerf=r("ct-set-dp"),i.features.dvicCheck=r("ct-set-dvic"),i.features.dvicShowTransporters=r("ct-set-dvic-tp"),i.features.workingHours=r("ct-set-whd"),i.features.returnsDashboard=r("ct-set-ret"),i.features.scorecard=r("ct-set-sc"),i.dev=r("ct-set-dev"),L(i),e.remove(),alert("Einstellungen gespeichert! Seite neu laden f\xFCr vollst\xE4ndige Aktivierung.")})}function B(i){var t;try{if(document.getElementById("ct-nav-item"))return;let e=document.querySelector(".fp-nav-menu-list");if(!e){y("Nav list not found");return}let r=null,a=Array.from(e.querySelectorAll(":scope > li.fp-nav-menu-list-item"));for(let o of a){let c=o.querySelector(":scope > a");if(c&&((t=c.textContent)==null?void 0:t.trim().toLowerCase())==="support"){r=o;break}}let n=document.createElement("li");n.id="ct-nav-item",n.className="fp-nav-menu-list-item",n.innerHTML=`
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
          <a href="#" data-ct-tool="settings">\u2699 Einstellungen</a>
        </li>
      </ul>
    `,n.querySelector(".fp-sub-menu").addEventListener("click",o=>{let c=o.target.closest("a[data-ct-tool]");if(!c)return;o.preventDefault(),o.stopPropagation();let l=c.getAttribute("data-ct-tool");try{switch(l){case"whc-dashboard":i.whcDashboard.toggle();break;case"date-extractor":i.dateRangeExtractor.showDialog();break;case"delivery-perf":i.deliveryPerformance.toggle();break;case"dvic-check":i.dvicCheck.toggle();break;case"working-hours":i.workingHoursDashboard.toggle();break;case"returns":i.returnsDashboard.toggle();break;case"scorecard":i.scorecardDashboard.toggle();break;case"settings":i.openSettings();break}}catch(d){w("Tool action failed:",l,d)}}),r?r.after(n):e.appendChild(n),y("Nav item injected")}catch(e){w("Failed to inject nav item:",e)}}function nt(i){let t=()=>{y("fp-navigation-loaded event"),setTimeout(()=>B(i()),100)};document.addEventListener("fp-navigation-loaded",t),S(()=>document.removeEventListener("fp-navigation-loaded",t));let e=new MutationObserver(()=>{!document.getElementById("ct-nav-item")&&document.querySelector(".fp-nav-menu-list")&&B(i())}),r=document.querySelector(".fp-navigation-container")||document.body;e.observe(r,{childList:!0,subtree:!0}),S(()=>e.disconnect())}function Rt(i){let t=location.href;new MutationObserver(()=>{location.href!==t&&(t=location.href,i(location.href))}).observe(document,{subtree:!0,childList:!0});for(let e of["pushState","replaceState"]){let r=history[e];history[e]=function(...a){let n=r.apply(this,a);return window.dispatchEvent(new Event("locationchange")),n}}window.addEventListener("popstate",()=>window.dispatchEvent(new Event("locationchange"))),window.addEventListener("locationchange",()=>i(location.href))}async function Lt(i,t,e=location.href){y("Boot for",e),B(i);try{await t(),y("Company config loaded")}catch(r){w("Company config load failed:",r)}}(function(){"use strict";let i=J();if(!i.enabled)return;dt(i),y("Cortex Tools loading\u2026"),gt();let t=new O(i),e=new z(i,t),r=new U(i,t),a=new j(i,t),n=new V(i,t),s=new G(i,t),o=new q(i,t),c=new K(i,t),l=()=>{i=J(),It(i)},d={whcDashboard:e,dateRangeExtractor:r,deliveryPerformance:a,dvicCheck:n,workingHoursDashboard:s,returnsDashboard:o,scorecardDashboard:c,openSettings:l};GM_registerMenuCommand("\u{1F4CA} WHC Dashboard",()=>e.toggle()),GM_registerMenuCommand("\u{1F4C5} Date Range Extractor",()=>r.showDialog()),GM_registerMenuCommand("\u{1F4E6} Daily Delivery Performance",()=>a.toggle()),GM_registerMenuCommand("\u{1F69B} DVIC Check",()=>n.toggle()),GM_registerMenuCommand("\u23F1 Working Hours",()=>s.toggle()),GM_registerMenuCommand("\u{1F4E6} Returns Dashboard",()=>o.toggle()),GM_registerMenuCommand("\u{1F4CB} Scorecard",()=>c.toggle()),GM_registerMenuCommand("\u2699 Einstellungen",l),GM_registerMenuCommand("\u23F8 Skript pausieren",()=>{i.enabled=!1,L(i),lt();let p=document.getElementById("ct-nav-item");p&&p.remove(),alert("Cortex Tools pausiert. Seite neu laden zum Reaktivieren.")}),pt(".fp-nav-menu-list").then(()=>{Lt(d,()=>t.load()),nt(()=>d)}).catch(p=>{w("Nav not found, retrying...",p),setTimeout(()=>{B(d),nt(()=>d)},3e3)}),Rt(p=>{y("URL changed:",p),document.getElementById("ct-nav-item")||B(d)}),y("Cortex Tools loaded")})();})();
