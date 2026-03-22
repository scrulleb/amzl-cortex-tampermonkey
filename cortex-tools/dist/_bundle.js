"use strict";(()=>{var z={enabled:!0,dev:!1,serviceAreaId:"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",deliveryPerfStation:"XYZ1",deliveryPerfDsp:"TEST",features:{whcDashboard:!0,dateExtractor:!0,deliveryPerf:!0,dvicCheck:!0,dvicShowTransporters:!0,workingHours:!0,returnsDashboard:!0,scorecard:!0,vsaQr:!0}},Rt="ct_config";function yt(){let o=GM_getValue(Rt,null);if(!o)return JSON.parse(JSON.stringify(z));try{let t=typeof o=="string"?JSON.parse(o):o;return{...z,...t,features:{...z.features,...t.features||{}},deliveryPerfStation:t.deliveryPerfStation||z.deliveryPerfStation,deliveryPerfDsp:t.deliveryPerfDsp||z.deliveryPerfDsp}}catch{return JSON.parse(JSON.stringify(z))}}function J(o){GM_setValue(Rt,JSON.stringify(o))}var At="[CortexTools]",wt=["Mo","Di","Mi","Do","Fr","Sa","So"],Lt="https://logistics.amazon.de/scheduling/home/api/v2/associate-attributes",st=null;function Mt(o){st=o}var C=(...o)=>{st!=null&&st.dev&&console.log(At,...o)},$=(...o)=>{console.error(At,...o)},_t=[];function B(o){return _t.push(o),o}function Pt(){for(;_t.length;)try{_t.pop()()}catch{}}function m(o){return String(o).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function Bt(o,{timeout:t=15e3}={}){return new Promise((e,r)=>{let a=document.querySelector(o);if(a)return e(a);let i=new MutationObserver(()=>{let n=document.querySelector(o);n&&(i.disconnect(),e(n))});i.observe(document,{childList:!0,subtree:!0}),t&&setTimeout(()=>{i.disconnect(),r(new Error(`Timeout waiting for ${o}`))},t)})}function X(o){return new Promise(t=>setTimeout(t,o))}async function U(o,{retries:t=3,baseMs:e=500}={}){let r=0;for(;;)try{return await o()}catch(a){if(++r>t)throw a;await X(e*2**(r-1))}}function N(){let o=document.querySelector('meta[name="anti-csrftoken-a2z"]');if(o)return o.getAttribute("content");let t=document.cookie.split(";");for(let e of t){let[r,a]=e.trim().split("=");if(r==="anti-csrftoken-a2z")return a}return null}function it(){let o=document.cookie.match(/session-id=([^;]+)/);return o?o[1]:null}function F(){return new Date().toISOString().split("T")[0]}function Nt(o,t){let e=new Date(o+"T00:00:00");return e.setDate(e.getDate()+t),e.toISOString().split("T")[0]}var ot=class{constructor(t){this.config=t}_loaded=!1;_loading=null;_serviceAreas=[];_dspCode=null;_defaultStation=null;_defaultServiceAreaId=null;async load(){if(!this._loaded){if(this._loading)return this._loading;this._loading=this._doLoad(),await this._loading,this._loaded=!0,this._loading=null}}async _doLoad(){var t,e,r,a;try{let n=await(await fetch("https://logistics.amazon.de/account-management/data/get-company-service-areas",{credentials:"include"})).json();n.success&&Array.isArray(n.data)&&n.data.length>0&&(this._serviceAreas=n.data,this._defaultServiceAreaId=n.data[0].serviceAreaId,this._defaultStation=n.data[0].stationCode,C("Loaded",n.data.length,"service areas"))}catch(i){$("Failed to load service areas:",i)}try{let n=await(await fetch("https://logistics.amazon.de/account-management/data/get-company-details",{credentials:"include"})).json(),s=((t=n==null?void 0:n.data)==null?void 0:t.dspShortCode)||((e=n==null?void 0:n.data)==null?void 0:e.companyShortCode)||((r=n==null?void 0:n.data)==null?void 0:r.shortCode)||(n==null?void 0:n.dspShortCode)||null;s&&(this._dspCode=String(s).toUpperCase(),C("Auto-detected DSP code:",this._dspCode))}catch{C("Company details not available, will detect DSP from performance data")}if(!this._dspCode)try{let i=document.querySelector('[data-testid="company-name"], .company-name, .dsp-name');if(i){let n=((a=i.textContent)==null?void 0:a.trim())??"";n&&n.length<=10&&(this._dspCode=n.toUpperCase(),C("DSP code from page element:",this._dspCode))}}catch{}this._dspCode||(this._dspCode=this.config.deliveryPerfDsp||z.deliveryPerfDsp,C("Using saved DSP code:",this._dspCode)),this._defaultStation||(this._defaultStation=this.config.deliveryPerfStation||z.deliveryPerfStation),this._defaultServiceAreaId||(this._defaultServiceAreaId=this.config.serviceAreaId||z.serviceAreaId)}getServiceAreas(){return this._serviceAreas}getDspCode(){return this._dspCode||this.config.deliveryPerfDsp||z.deliveryPerfDsp}getDefaultStation(){return this._defaultStation||this.config.deliveryPerfStation||z.deliveryPerfStation}getDefaultServiceAreaId(){return this._defaultServiceAreaId||this.config.serviceAreaId||z.serviceAreaId}buildSaOptions(t){if(this._serviceAreas.length===0){let r=t||this.getDefaultServiceAreaId();return`<option value="${m(r)}">${m(this.getDefaultStation())}</option>`}let e=t||this.getDefaultServiceAreaId();return this._serviceAreas.map(r=>{let a=r.serviceAreaId===e?" selected":"";return`<option value="${m(r.serviceAreaId)}"${a}>${m(r.stationCode)}</option>`}).join("")}populateSaSelect(t,e){t&&(t.innerHTML=this.buildSaOptions(e))}};var ce=`
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
`,le=`
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
`,de=`
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
`,ue=`
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
`,pe=`
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
`,he=`
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
`,ge=`
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
`;function Ht(){GM_addStyle(ce),GM_addStyle(le),GM_addStyle(de),GM_addStyle(ue),GM_addStyle(pe),GM_addStyle(he),GM_addStyle(ge)}var ct=class{constructor(t,e){this.config=t;this.companyConfig=e}_active=!1;_overlayEl=null;_nameMap={};_associates=[];_lastQueryResult=null;_lastQueryMode=null;init(){if(this._overlayEl)return;let t=document.createElement("div");t.id="ct-whc-overlay",t.className="ct-overlay",t.innerHTML=`
      <div class="ct-panel">
        <h2>\u{1F4CA} DA WHC-Dashboard</h2>
        <div class="ct-controls">
          <label>Datum:</label>
          <input type="date" id="ct-whc-date" class="ct-input" value="${F()}">
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
    `,document.body.appendChild(t),this._overlayEl=t,t.addEventListener("click",e=>{e.target===t&&this.hide()}),document.getElementById("ct-whc-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-whc-go").addEventListener("click",()=>this._runQuery()),document.getElementById("ct-whc-export").addEventListener("click",()=>this._exportCSV()),this.companyConfig.load().then(()=>{this.companyConfig.populateSaSelect(document.getElementById("ct-whc-sa"))}),B(()=>this.dispose()),C("WHC Dashboard initialized")}dispose(){var t;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._active=!1,this._nameMap={},this._associates=[],this._lastQueryResult=null,this._lastQueryMode=null}toggle(){if(!this.config.features.whcDashboard){alert("WHC Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}_resolveName(t){return this._nameMap[t]||t}_minsToHM(t){if(t==null||t===0)return"-";let e=Math.floor(t/60),r=t%60;return`${e}h ${r.toString().padStart(2,"0")}m`}_minsClass(t){return!t||t===0?"ct-nodata":t>600?"ct-danger":t>540?"ct-warn":"ct-ok"}_getMonday(t){let e=new Date(t+"T00:00:00"),r=e.getDay(),a=e.getDate()-r+(r===0?-6:1);return e.setDate(a),e.toISOString().split("T")[0]}_addDays(t,e){let r=new Date(t+"T00:00:00");return r.setDate(r.getDate()+e),r.toISOString().split("T")[0]}_getSelectedSaId(){let t=document.getElementById("ct-whc-sa");return t&&t.value?t.value:this.companyConfig.getDefaultServiceAreaId()}async _fetchNames(t,e){let r=this._getSelectedSaId(),a=`https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${t}&serviceAreaId=${r}&toDate=${e||t}`,i=N(),n={Accept:"application/json"};i&&(n["anti-csrftoken-a2z"]=i);let s=await fetch(a,{method:"GET",headers:n,credentials:"include"});if(!s.ok)throw new Error(`Roster API Fehler ${s.status}`);let c=await s.json(),d=Array.isArray(c)?c:(c==null?void 0:c.data)||(c==null?void 0:c.rosters)||[],l=new Set,u=p=>{for(let f of p)f.driverPersonId&&(l.add(f.driverPersonId),f.driverName&&(this._nameMap[f.driverPersonId]=f.driverName))};if(Array.isArray(d))u(d);else if(typeof d=="object")for(let p of Object.values(d))Array.isArray(p)&&u(p);this._associates=[...l],C(`${this._associates.length} Fahrer gefunden, ${Object.keys(this._nameMap).length} Namen geladen`)}async _fetchDay(t){let e={associatesList:this._associates,date:t,mode:"daily",serviceAreaId:this._getSelectedSaId()},r=N(),a={"Content-Type":"application/json",Accept:"application/json"};r&&(a["anti-csrftoken-a2z"]=r);let i=await fetch(Lt,{method:"POST",headers:a,body:JSON.stringify(e),credentials:"include"});if(!i.ok)throw new Error(`API Fehler ${i.status} f\xFCr ${t}`);return i.json()}_extractDayData(t){var a;let e={},r=((a=t==null?void 0:t.data)==null?void 0:a.daWorkSummaryAndEligibility)||{};for(let[i,n]of Object.entries(r)){let s=n==null?void 0:n.workSummary;s&&(e[i]={scheduledDay:s.daScheduledDayMins||0,actualDay:s.daActualWorkDayMins||0,scheduledWeek:s.daScheduledWeekMins||0,actualWeek:s.daActualWorkWeekMins||0,last7Days:s.daScheduledLast7DaysMins||0,breached:s.isDailyLeapThresholdBreached||!1})}return e}_renderSingleDay(t,e){return`
      <table class="ct-table">
        <thead><tr>
          <th>Fahrer</th><th>Geplant (Tag)</th><th>Ist (Tag)</th>
          <th>Geplant (Woche)</th><th>Ist (Woche)</th>
          <th>Letzten 7 Tage</th><th>Threshold Breach</th>
        </tr></thead>
        <tbody>${Object.entries(e).sort((a,i)=>i[1].actualDay-a[1].actualDay).map(([a,i])=>`<tr class="${i.breached?"ct-breach":""}">
          <td title="${m(a)}">${m(this._resolveName(a))}</td>
          <td>${this._minsToHM(i.scheduledDay)}</td>
          <td class="${this._minsClass(i.actualDay)}">${this._minsToHM(i.actualDay)}</td>
          <td>${this._minsToHM(i.scheduledWeek)}</td>
          <td>${this._minsToHM(i.actualWeek)}</td>
          <td>${this._minsToHM(i.last7Days)}</td>
          <td>${i.breached?"\u26A0\uFE0F JA":"\u2705 Nein"}</td>
        </tr>`).join("")}</tbody>
      </table>
    `}_renderWeek(t){let e=Object.keys(t).sort(),r=new Set;for(let s of Object.values(t))for(let c of Object.keys(s))r.add(c);let a=e.map((s,c)=>`<th colspan="2">${m(wt[c]??s)} (${m(s.slice(5))})</th>`).join(""),i=e.map(()=>"<th>Geplant</th><th>Ist</th>").join(""),n=[...r].map(s=>{let c=0,d=!1,l=0,u=e.map(_=>{var E;let x=(E=t[_])==null?void 0:E[s];return x?(c+=x.actualDay,x.breached&&(d=!0),l=x.actualWeek,`<td>${this._minsToHM(x.scheduledDay)}</td>
                  <td class="${this._minsClass(x.actualDay)}">${this._minsToHM(x.actualDay)}</td>`):'<td class="ct-nodata">-</td><td class="ct-nodata">-</td>'}).join("");return{row:`<tr class="${d?"ct-breach":""}">
          <td title="${m(s)}">${m(this._resolveName(s))}</td>
          ${u}
          <td class="${this._minsClass(c/e.length)}">${this._minsToHM(c)}</td>
          <td>${this._minsToHM(l)}</td>
          <td>${d?"\u26A0\uFE0F JA":"\u2705"}</td>
        </tr>`,anyBreach:d,totalActual:c}}).sort((s,c)=>s.anyBreach!==c.anyBreach?s.anyBreach?-1:1:c.totalActual-s.totalActual).map(s=>s.row).join("");return`
      <table class="ct-table">
        <thead>
          <tr>
            <th rowspan="2">Fahrer</th>
            ${a}
            <th rowspan="2">\u03A3 Ist</th><th rowspan="2">API Woche</th><th rowspan="2">Breach</th>
          </tr>
          <tr>${i}</tr>
        </thead>
        <tbody>${n}</tbody>
      </table>
    `}async _runQuery(){let t=document.getElementById("ct-whc-date").value,e=document.getElementById("ct-whc-mode").value,r=document.getElementById("ct-whc-status"),a=document.getElementById("ct-whc-result");if(!t){r.textContent="\u26A0\uFE0F Bitte Datum ausw\xE4hlen!";return}a.innerHTML="",this._lastQueryMode=e;try{if(r.textContent="\u23F3 Lade Fahrer-Liste...",e==="week"){let i=this._getMonday(t),n=this._addDays(i,6);await this._fetchNames(i,n)}else await this._fetchNames(t);r.textContent=`\u23F3 ${this._associates.length} Fahrer gefunden, lade Daten...`}catch(i){r.textContent=`\u274C Roster-Fehler: ${i.message}`,$(i);return}if(this._associates.length===0){r.textContent="\u26A0\uFE0F Keine Fahrer im Roster gefunden f\xFCr dieses Datum!";return}if(e==="day"){r.textContent=`\u23F3 Lade Daten f\xFCr ${t}...`;try{let i=await this._fetchDay(t),n=this._extractDayData(i);this._lastQueryResult={[t]:n},a.innerHTML=this._renderSingleDay(t,n);let s=Object.keys(n).length,c=Object.values(n).filter(d=>d.breached).length;r.textContent=`\u2705 ${s} Fahrer geladen | ${c} Threshold-Breaches | ${t}`}catch(i){r.textContent=`\u274C Fehler: ${i.message}`,$(i)}}else{let i=this._getMonday(t),n={};try{for(let c=0;c<7;c++){let d=this._addDays(i,c);r.textContent=`\u23F3 Lade ${wt[c]} (${d})... (${c+1}/7)`;try{let l=await this._fetchDay(d);n[d]=this._extractDayData(l)}catch(l){console.warn(`Fehler f\xFCr ${d}:`,l),n[d]={}}c<6&&await X(500)}this._lastQueryResult=n,a.innerHTML=this._renderWeek(n);let s=0;for(let c of Object.values(n))for(let d of Object.values(c))d.breached&&s++;r.textContent=`\u2705 Woche ${i} geladen | ${s} Breach-Eintr\xE4ge`}catch(s){r.textContent=`\u274C Fehler: ${s.message}`,$(s)}}}_exportCSV(){var i;if(!this._lastQueryResult){alert("Bitte zuerst eine Abfrage starten!");return}let t="";if(this._lastQueryMode==="day"){let n=Object.keys(this._lastQueryResult)[0],s=this._lastQueryResult[n];t=`Name;Associate ID;Geplant (Tag);Ist (Tag);Geplant (Woche);Ist (Woche);Letzten 7 Tage;Breach
`;for(let[c,d]of Object.entries(s))t+=`${this._resolveName(c)};${c};${d.scheduledDay};${d.actualDay};${d.scheduledWeek};${d.actualWeek};${d.last7Days};${d.breached}
`}else{let n=Object.keys(this._lastQueryResult).sort(),s=new Set;for(let c of Object.values(this._lastQueryResult))for(let d of Object.keys(c))s.add(d);t="Name;Associate ID";for(let c of n)t+=`;${c} Geplant;${c} Ist`;t+=`;Breach
`;for(let c of s){t+=`${this._resolveName(c)};${c}`;let d=!1;for(let l of n){let u=(i=this._lastQueryResult[l])==null?void 0:i[c];t+=`;${(u==null?void 0:u.scheduledDay)||0};${(u==null?void 0:u.actualDay)||0}`,u!=null&&u.breached&&(d=!0)}t+=`;${d}
`}}let e=new Blob(["\uFEFF"+t],{type:"text/csv;charset=utf-8;"}),r=URL.createObjectURL(e),a=document.createElement("a");a.href=r,a.download=`arbeitszeiten_${this._lastQueryMode}_${Object.keys(this._lastQueryResult)[0]}.csv`,a.click(),URL.revokeObjectURL(r)}};var lt=class{constructor(t,e){this.config=t;this.companyConfig=e}_progress={isRunning:!1,current:0,total:0,dates:[],results:[]};_dialogEl=null;_progressEl=null;_resultsEl=null;_historyEl=null;init(){}dispose(){var t,e,r,a;this._stopExtraction(),(t=this._dialogEl)==null||t.remove(),this._dialogEl=null,(e=this._progressEl)==null||e.remove(),this._progressEl=null,(r=this._resultsEl)==null||r.remove(),this._resultsEl=null,(a=this._historyEl)==null||a.remove(),this._historyEl=null}showDialog(){var a;if(!this.config.features.dateExtractor){alert("Date Range Extractor ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}(a=this._dialogEl)==null||a.remove(),this._dialogEl=null;let t=F(),e=new Date(Date.now()-7*24*60*60*1e3).toISOString().split("T")[0],r=document.createElement("div");r.className="ct-overlay visible",r.innerHTML=`
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
    `,document.body.appendChild(r),this._dialogEl=r,this.companyConfig.load().then(()=>{this.companyConfig.populateSaSelect(document.getElementById("ct-dre-sa"))}),r.addEventListener("click",i=>{i.target===r&&(r.remove(),this._dialogEl=null)}),document.getElementById("ct-dre-preview").addEventListener("click",()=>{let i=document.getElementById("ct-dre-start").value,n=document.getElementById("ct-dre-end").value;if(!i||!n){alert("Please select both start and end dates");return}try{let s=this._generateDateRange(i,n);document.getElementById("ct-dre-preview-area").innerHTML=`
          <div class="ct-info-box">
            <strong>\u{1F4CB} Dates to extract (${s.length}):</strong><br>
            <div style="max-height: 150px; overflow-y: auto; margin-top: 5px; font-size: 12px;">
              ${m(s.join(", "))}
            </div>
          </div>`}catch(s){alert("Error: "+s.message)}}),document.getElementById("ct-dre-start-btn").addEventListener("click",()=>{let i=document.getElementById("ct-dre-start").value,n=document.getElementById("ct-dre-end").value,s=document.getElementById("ct-dre-sa").value;if(!i||!n){alert("Please select both start and end dates");return}if(!s.trim()){alert("Bitte Service Area ausw\xE4hlen");return}r.remove(),this._dialogEl=null,this._extractDateRange(i,n,s.trim())}),document.getElementById("ct-dre-history").addEventListener("click",()=>{r.remove(),this._dialogEl=null,this.showHistory()}),document.getElementById("ct-dre-cancel").addEventListener("click",()=>{r.remove(),this._dialogEl=null})}showHistory(){var a;(a=this._historyEl)==null||a.remove(),this._historyEl=null;let t=JSON.parse(GM_getValue("batch_index","[]"));if(t.length===0){alert("No batch history found");return}let e=document.createElement("div");e.className="ct-overlay visible";let r=[...t].reverse().map(i=>{let n=Math.round(i.successCount/i.totalCount*100),s=n===100?"ct-history-success":n>50?"ct-history-partial":"ct-history-failure";return`
        <tr>
          <td>${m(i.startDate)} to ${m(i.endDate)}</td>
          <td>${m(new Date(i.timestamp).toLocaleString())}</td>
          <td class="${s}">${i.successCount}/${i.totalCount} (${n}%)</td>
          <td>
            <button class="ct-btn ct-btn--info" data-ct-batch-download="${m(i.key)}">Download</button>
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
      </div>`,document.body.appendChild(e),this._historyEl=e,e.addEventListener("click",i=>{i.target===e&&(e.remove(),this._historyEl=null);let n=i.target.closest("[data-ct-batch-download]");if(n){let s=n.getAttribute("data-ct-batch-download");this._downloadBatch(s)}}),document.getElementById("ct-dre-history-close").addEventListener("click",()=>{e.remove(),this._historyEl=null})}_downloadBatch(t){try{let e=GM_getValue(t,null);if(!e){alert("Batch data not found \u2014 it may have been removed.");return}let r=typeof e=="string"?JSON.parse(e):e,a=new Blob([JSON.stringify(r,null,2)],{type:"application/json"}),i=URL.createObjectURL(a),n=document.createElement("a");n.href=i,n.download=`batch_${t}.json`,n.click(),URL.revokeObjectURL(i)}catch(e){$("Download batch failed:",e),alert("Failed to download batch data.")}}async _extractDateRange(t,e,r){let a=this._generateDateRange(t,e);C(`Extracting data for ${a.length} dates:`,a),this._progress={isRunning:!0,current:0,total:a.length,dates:a,results:[]},this._updateProgressDisplay();for(let i=0;i<a.length&&this._progress.isRunning;i++){let n=a[i];this._progress.current=i+1;try{C(`Extracting data for ${n} (${i+1}/${a.length})`),this._updateProgressDisplay();let s=await this._extractSingleDate(n,r);this._progress.results.push({date:n,success:!0,data:s,timestamp:new Date().toISOString()}),i<a.length-1&&await X(1e3+Math.random()*1e3)}catch(s){$(`Failed for ${n}:`,s),this._progress.results.push({date:n,success:!1,error:s.message,timestamp:new Date().toISOString()}),await X(2e3)}}this._progress.isRunning=!1,this._updateProgressDisplay(),C("Date range extraction completed"),this._saveBatchResults(this._progress.results,t,e),this._showBatchResults(this._progress.results)}_extractSingleDate(t,e){return new Promise((r,a)=>{let i=`https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${t}&serviceAreaId=${e}`;fetch(i,{method:"GET",credentials:"same-origin",headers:{Accept:"application/json, text/plain, */*","Accept-Language":"de,en-US;q=0.7,en;q=0.3","user-ref":"cortex-webapp-user","X-Cortex-Timestamp":Date.now().toString(),"X-Cortex-Session":it()??"",Referer:location.href}}).then(n=>{if(!n.ok)throw new Error(`HTTP ${n.status}: ${n.statusText}`);return n.json()}).then(n=>{this._saveIndividualData(n,t),r(n)}).catch(a)})}_generateDateRange(t,e){let r=[],a=new Date(t),i=new Date(e);if(a>i)throw new Error("Start date must be before end date");let n=new Date(a);for(;n<=i;)n.getDay()!==0&&r.push(n.toISOString().split("T")[0]),n.setDate(n.getDate()+1);return r}_saveIndividualData(t,e){let r=`logistics_data_${e}`,a={date:e,extractedAt:new Date().toISOString(),rawData:t,summary:this._extractDataSummary(t)};GM_setValue(r,JSON.stringify(a)),C(`Saved data for ${e}`)}_saveBatchResults(t,e,r){let a=`batch_${e}_${r}_${Date.now()}`,i={startDate:e,endDate:r,extractedAt:new Date().toISOString(),totalDates:t.length,successCount:t.filter(s=>s.success).length,results:t};GM_setValue(a,JSON.stringify(i));let n=JSON.parse(GM_getValue("batch_index","[]"));if(n.push({key:a,startDate:e,endDate:r,timestamp:new Date().toISOString(),successCount:i.successCount,totalCount:i.totalDates}),n.length>20){let s=n.shift();GM_setValue(s.key,"")}GM_setValue("batch_index",JSON.stringify(n)),C(`Saved batch: ${a}`)}_extractDataSummary(t){let e={};try{let r=t;r.summary&&(e.totalRoutes=r.summary.totalRoutes||0,e.completedRoutes=r.summary.completedRoutes||0,e.totalPackages=r.summary.totalPackages||0,e.deliveredPackages=r.summary.deliveredPackages||0),r.metrics&&(e.metrics=r.metrics)}catch(r){console.warn("Could not extract summary:",r)}return e}_updateProgressDisplay(){var r;if(!this._progress.isRunning){(r=this._progressEl)==null||r.remove(),this._progressEl=null;return}if(!this._progressEl){let a=document.createElement("div");a.className="ct-overlay visible",a.innerHTML=`
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
      <div style="color: #666; font-size: 12px;">Current: ${m(e)}</div>`}_stopExtraction(){var t;this._progress.isRunning=!1,(t=this._progressEl)==null||t.remove(),this._progressEl=null,C("Extraction stopped by user")}_showBatchResults(t){var s;(s=this._resultsEl)==null||s.remove(),this._resultsEl=null;let e=t.filter(c=>c.success).length,r=t.length-e,a=t.length>0?Math.round(e/t.length*100):0,i=t.map(c=>`
      <div class="ct-result-item">
        <h4>${m(c.date)}
          <span class="${c.success?"ct-result-success":"ct-result-failure"}">
            ${c.success?"\u2705":"\u274C"}
          </span>
        </h4>
        ${c.success?"<p>Data extracted successfully</p>":"<p>Error: "+m(c.error??"")+"</p>"}
        <small>Time: ${m(new Date(c.timestamp).toLocaleString())}</small>
      </div>`).join(""),n=document.createElement("div");n.className="ct-overlay visible",n.innerHTML=`
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
        <div style="max-height: 400px; overflow-y: auto;">${i}</div>
        <div style="margin-top: 16px; text-align: right;">
          <button class="ct-btn ct-btn--secondary" id="ct-dre-results-close">Close</button>
        </div>
      </div>`,document.body.appendChild(n),this._resultsEl=n,n.addEventListener("click",c=>{c.target===n&&(n.remove(),this._resultsEl=null)}),document.getElementById("ct-dre-results-close").addEventListener("click",()=>{n.remove(),this._resultsEl=null}),document.getElementById("ct-dre-dl-all").addEventListener("click",()=>{let c=new Blob([JSON.stringify(t,null,2)],{type:"application/json"}),d=URL.createObjectURL(c),l=document.createElement("a");l.href=d,l.download=`logistics_batch_data_${F()}.json`,l.click(),URL.revokeObjectURL(d)}),document.getElementById("ct-dre-dl-summary").addEventListener("click",()=>{let c={totalDates:t.length,successCount:e,failureCount:r,successRate:a},d=new Blob([JSON.stringify(c,null,2)],{type:"application/json"}),l=URL.createObjectURL(d),u=document.createElement("a");u.href=l,u.download=`logistics_summary_${F()}.json`,u.click(),URL.revokeObjectURL(l)})}};var Ot=new Set(["country","station_code","program","country_dspid_stationcode","country_program_stationcode","region","dsp_code","country_program_dspid_stationcode","country_stationcode","country_program_data_date"]),zt=new Set(["delivered","unbucketed_delivery_misses","address_not_found","return_to_station_utl","return_to_station_uta","customer_not_available","return_to_station_all","successful_c_return_pickups","rts_other","dispatched","transferred_out","dnr","return_to_station_nsl","completed_routes","first_delv_with_test_dim","pde_photos_taken","packages_not_on_van","first_disp_with_test_dim","delivery_attempt","return_to_station_bc","pod_bypass","pod_opportunity","pod_success","next_day_routes","scheduled_mfn_pickups","successful_mfn_pickups","rejected_packages","payment_not_ready","scheduled_c_return_pickups","return_to_station_cu","return_to_station_oodt","rts_dpmo","dnr_dpmo","ttl"]),Ut=new Set(["pod_success_rate","rts_cu_percent","rts_other_percent","rts_oodt_percent","rts_utl_percent","rts_bc_percent","delivery_attempt_percent","customer_not_available_percent","first_day_delivery_success_percent","rts_all_percent","rejected_packages_percent","payment_not_ready_percent","delivery_success_dsp","delivery_success","unbucketed_delivery_misses_percent","address_not_found_percent"]),Vt=new Set(["shipment_zone_per_hour"]),fe=new Set(["last_updated_time"]),ve=new Set(["messageTimestamp"]),me=new Set(["data_date"]),dt={country:"Country",station_code:"Station",program:"Program",country_dspid_stationcode:"Country/DSP/Station",country_program_stationcode:"Country/Program/Station",region:"Region",dsp_code:"DSP",country_program_dspid_stationcode:"Country/Program/DSP/Station",country_stationcode:"Country/Station",country_program_data_date:"Country/Program/Date",delivered:"Delivered",dispatched:"Dispatched",completed_routes:"Completed Routes",delivery_attempt:"Delivery Attempts",unbucketed_delivery_misses:"Unbucketed Misses",address_not_found:"Address Not Found",return_to_station_utl:"RTS UTL",return_to_station_uta:"RTS UTA",customer_not_available:"Customer N/A",return_to_station_all:"RTS All",return_to_station_cu:"RTS CU",return_to_station_bc:"RTS BC",return_to_station_nsl:"RTS NSL",return_to_station_oodt:"RTS OODT",successful_c_return_pickups:"C-Return Pickups",rts_other:"RTS Other",transferred_out:"Transferred Out",dnr:"DNR",first_delv_with_test_dim:"First Delv (dim)",pde_photos_taken:"PDE Photos",packages_not_on_van:"Pkgs Not on Van",first_disp_with_test_dim:"First Disp (dim)",pod_bypass:"POD Bypass",pod_opportunity:"POD Opportunity",pod_success:"POD Success",next_day_routes:"Next Day Routes",scheduled_mfn_pickups:"Sched MFN Pickups",successful_mfn_pickups:"Successful MFN Pickups",rejected_packages:"Rejected Pkgs",payment_not_ready:"Payment N/Ready",scheduled_c_return_pickups:"Sched C-Return",rts_dpmo:"RTS DPMO",dnr_dpmo:"DNR DPMO",ttl:"TTL",shipment_zone_per_hour:"Shipments/Zone/Hour",pod_success_rate:"POD Success Rate",rts_cu_percent:"RTS CU %",rts_other_percent:"RTS Other %",rts_oodt_percent:"RTS OODT %",rts_utl_percent:"RTS UTL %",rts_bc_percent:"RTS BC %",delivery_attempt_percent:"Delivery Attempt %",customer_not_available_percent:"Customer N/A %",first_day_delivery_success_percent:"First-Day Success %",rts_all_percent:"RTS All %",rejected_packages_percent:"Rejected Pkgs %",payment_not_ready_percent:"Payment N/Ready %",delivery_success_dsp:"Delivery Success (DSP)",delivery_success:"Delivery Success",unbucketed_delivery_misses_percent:"Unbucketed Misses %",address_not_found_percent:"Address Not Found %",last_updated_time:"Last Updated",messageTimestamp:"Message Timestamp",data_date:"Data Date"};function jt(o){let t=typeof o=="string"?JSON.parse(o):o,e={};for(let[r,a]of Object.entries(t))e[r.trim()]=a;return e}function Wt(o){return Ot.has(o)?"string":zt.has(o)?"int":Ut.has(o)?"percent":Vt.has(o)?"rate":fe.has(o)?"datetime":ve.has(o)?"epoch":me.has(o)?"date":"unknown"}function xt(o,t){if(t==null||t==="")return"\u2014";let e=Wt(o);switch(e){case"percent":return`${(Number(t)*100).toFixed(2)}%`;case"rate":return Number(t).toFixed(2);case"datetime":case"epoch":try{let r=e==="epoch"?Number(t):new Date(t).getTime();return new Date(r).toLocaleString(void 0,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})}catch{return String(t)}case"date":return String(t);case"int":return Number(t).toLocaleString();default:return String(t)}}function Dt(o,t){let e=Number(t);return o.startsWith("rts_")||o.includes("miss")||o==="customer_not_available_percent"||o==="rejected_packages_percent"||o==="payment_not_ready_percent"||o==="address_not_found_percent"?e<.005?"great":e<.01?"ok":"bad":e>=.99?"great":e>=.97?"ok":"bad"}function be(o,t){return!o||!t?"Both From and To dates are required.":/^\d{4}-\d{2}-\d{2}$/.test(o)?/^\d{4}-\d{2}-\d{2}$/.test(t)?o>t?"From date must not be after To date.":null:"To date format must be YYYY-MM-DD.":"From date format must be YYYY-MM-DD."}function Ft(o){try{let t=o==null?void 0:o.tableData,e=t==null?void 0:t.dsp_daily_supplemental_quality,r=e==null?void 0:e.rows;return!Array.isArray(r)||r.length===0?[]:r.map(jt).sort((a,i)=>(a.data_date||"").localeCompare(i.data_date||""))}catch(t){return $("dpParseApiResponse error:",t),[]}}var ut=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_cache=new Map;_debounceTimer=null;helpers={dpParseRow:jt,dpClassifyField:Wt,dpFormatValue:xt,dpRateClass:Dt,dpValidateDateRange:be,dpParseApiResponse:Ft};async init(){if(this._overlayEl)return;let t=F(),e=document.createElement("div");e.id="ct-dp-overlay",e.className="ct-overlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-label","Daily Delivery Performance Dashboard"),e.innerHTML=`
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
    `,document.body.appendChild(e),this._overlayEl=e,e.addEventListener("click",a=>{a.target===e&&this.hide()}),document.getElementById("ct-dp-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-dp-go").addEventListener("click",()=>this._triggerFetch());let r=(()=>{let a;return()=>{clearTimeout(a),a=setTimeout(()=>this._triggerFetch(),600)}})();document.getElementById("ct-dp-date").addEventListener("change",r),await this.companyConfig.load(),this.companyConfig.populateSaSelect(document.getElementById("ct-dp-sa")),B(()=>this.dispose()),C("Delivery Performance Dashboard initialized")}dispose(){var t;this._debounceTimer&&clearTimeout(this._debounceTimer),(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._active=!1,this._cache.clear()}toggle(){if(!this.config.features.deliveryPerf){alert("Daily Delivery Performance ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,document.getElementById("ct-dp-date").focus()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}_buildUrl(t,e,r,a){return`https://logistics.amazon.de/performance/api/v1/getData?dataSetId=dsp_daily_supplemental_quality&dsp=${encodeURIComponent(a)}&from=${encodeURIComponent(t)}&station=${encodeURIComponent(r)}&timeFrame=Daily&to=${encodeURIComponent(e)}`}async _fetchData(t,e,r,a){let i=`${t}|${e}|${r}|${a}`;if(this._cache.has(i))return C("DP cache hit:",i),this._cache.get(i);let n=this._buildUrl(t,e,r,a),s=N(),c={Accept:"application/json"};s&&(c["anti-csrftoken-a2z"]=s);let l=await(await U(async()=>{let u=await fetch(n,{method:"GET",headers:c,credentials:"include"});if(!u.ok)throw new Error(`HTTP ${u.status}: ${u.statusText}`);return u},{retries:2,baseMs:800})).json();if(this._cache.set(i,l),this._cache.size>50){let u=this._cache.keys().next().value;this._cache.delete(u)}return l}async _triggerFetch(){var i,n;let t=document.getElementById("ct-dp-date").value;if(!t){this._setStatus("\u26A0\uFE0F Please select a date.");return}let e=document.getElementById("ct-dp-sa"),r=((n=(i=e.options[e.selectedIndex])==null?void 0:i.textContent)==null?void 0:n.trim().toUpperCase())||this.companyConfig.getDefaultStation(),a=this.companyConfig.getDspCode();this._setStatus("\u23F3 Loading\u2026"),this._setBody('<div class="ct-dp-loading" role="status">Fetching data\u2026</div>');try{let s=await this._fetchData(t,t,r,a),c=Ft(s);if(c.length===0){this._setBody('<div class="ct-dp-empty">No data returned for the selected date.</div>'),this._setStatus("\u26A0\uFE0F No records found.");return}this._setBody(this._renderAll(c)),this._setStatus(`\u2705 ${c.length} record(s) loaded \u2014 ${t}`)}catch(s){$("Delivery perf fetch failed:",s),this._setBody(`<div class="ct-dp-error">\u274C ${m(s.message)}</div>`),this._setStatus("\u274C Failed to load data.")}}_setStatus(t){let e=document.getElementById("ct-dp-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-dp-body");e&&(e.innerHTML=t)}_renderAll(t){let e=this._renderBadges(t[0]),r=t.map(a=>this._renderRecord(a)).join("");return e+r}_renderBadges(t){let e=[];for(let r of Ot){let a=t[r];if(a==null||a==="")continue;let i=dt[r]||r;e.push(`<span class="ct-dp-badge" title="${m(r)}">${m(i)}<span>${m(String(a))}</span></span>`)}return e.length?`<div class="ct-dp-badges" aria-label="Identifiers">${e.join("")}</div>`:""}_renderRecord(t){return`
      <div class="ct-dp-record">
        <div class="ct-dp-record-header">\u{1F4C5} ${m(String(t.data_date||"Unknown date"))}</div>
        <div class="ct-dp-record-body">
          ${this._renderKeyTiles(t)}
          ${this._renderCounts(t)}
          ${this._renderRates(t)}
          ${this._renderTimestamps(t)}
        </div>
      </div>`}_renderKeyTiles(t){return`<div class="ct-dp-full-col"><div class="ct-dp-tiles">${[{field:"delivered",label:"Delivered",pct:!1},{field:"dispatched",label:"Dispatched",pct:!1},{field:"completed_routes",label:"Routes",pct:!1},{field:"delivery_success",label:"Delivery Success",pct:!0},{field:"pod_success_rate",label:"POD Rate",pct:!0}].map(({field:a,label:i,pct:n})=>{let s=t[a];if(s==null)return"";let c,d="";if(n){let l=Number(s);c=`${(l*100).toFixed(1)}%`;let u=Dt(a,l);d=u==="great"?"ct-dp-tile--success":u==="ok"?"ct-dp-tile--warn":"ct-dp-tile--danger"}else c=Number(s).toLocaleString();return`<div class="ct-dp-tile ${d}"><div class="ct-dp-tile-val">${m(c)}</div><div class="ct-dp-tile-lbl">${m(i)}</div></div>`}).join("")}</div></div>`}_renderCounts(t){let e=[];for(let r of zt){let a=t[r];if(a==null)continue;let i=dt[r]||r;e.push(`<tr><td>${m(i)}</td><td>${m(Number(a).toLocaleString())}</td></tr>`)}return e.length?`<div>
      <p class="ct-dp-section-title">Counts</p>
      <table class="ct-dp-count-table" aria-label="Count metrics">
        <tbody>${e.join("")}</tbody>
      </table>
    </div>`:""}_renderRates(t){let e=[];for(let r of Ut){let a=t[r];if(a==null)continue;let i=Number(a),n=Dt(r,i),s=Math.min(100,Math.round(i*100)),c=dt[r]||r;e.push(`
        <div class="ct-dp-rate-row" role="listitem">
          <span class="ct-dp-rate-label">${m(c)}</span>
          <div class="ct-dp-rate-bar-wrap" aria-hidden="true">
            <div class="ct-dp-rate-bar ct-dp-rate--bar--${n}" style="width:${s}%"></div>
          </div>
          <span class="ct-dp-rate-value ct-dp-rate--${n}">${(i*100).toFixed(2)}%</span>
        </div>`)}for(let r of Vt){let a=t[r];if(a==null)continue;let i=dt[r]||r;e.push(`
        <div class="ct-dp-rate-row" role="listitem">
          <span class="ct-dp-rate-label">${m(i)}</span>
          <span class="ct-dp-rate-value ct-dp-rate--neutral">${Number(a).toFixed(2)}</span>
        </div>`)}return e.length?`<div>
      <p class="ct-dp-section-title">Rates &amp; Percentages</p>
      <div class="ct-dp-rates" role="list">${e.join("")}</div>
    </div>`:""}_renderTimestamps(t){let e=[];return t.data_date&&e.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Data Date</span>
        <span class="ct-dp-ts-val">${m(String(t.data_date))}</span>
      </div>`),t.last_updated_time&&e.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Last Updated</span>
        <span class="ct-dp-ts-val">${m(xt("last_updated_time",t.last_updated_time))}</span>
      </div>`),t.messageTimestamp!==void 0&&t.messageTimestamp!==null&&e.push(`<div class="ct-dp-ts-item">
        <span class="ct-dp-ts-label">Message Timestamp</span>
        <span class="ct-dp-ts-val">${m(xt("messageTimestamp",t.messageTimestamp))}</span>
      </div>`),e.length?`<div class="ct-dp-full-col">
      <div class="ct-dp-ts-row" aria-label="Timestamps">${e.join("")}</div>
    </div>`:""}};var pt=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_vehicles=[];_nameCache=new Map;_lastTimestamp=null;_loading=!1;_pageSize=25;_pageCurrent=1;_pageMissing=1;_currentTab="all";get _showTransporters(){return this.config.features.dvicShowTransporters!==!1}init(){if(this._overlayEl)return;let t=document.createElement("div");t.id="ct-dvic-overlay",t.className="ct-overlay",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.setAttribute("aria-label","DVIC Check"),t.innerHTML=`
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
    `,document.body.appendChild(t),this._overlayEl=t,t.addEventListener("click",e=>{e.target===t&&this.hide()}),document.getElementById("ct-dvic-close").addEventListener("click",()=>this.hide()),t.querySelector(".ct-dvic-tabs").addEventListener("click",e=>{let r=e.target.closest(".ct-dvic-tab");r&&this._switchTab(r.dataset.tab)}),B(()=>this.dispose()),C("DVIC Check initialized")}dispose(){var t;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._vehicles=[],this._active=!1,this._lastTimestamp=null,this._loading=!1}toggle(){if(!this.config.features.dvicCheck){alert("DVIC Check ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,this._pageCurrent=1,this._pageMissing=1,this._currentTab="all",this._switchTab("all"),this._refresh()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}_switchTab(t){var e;this._currentTab=t,(e=this._overlayEl)==null||e.querySelectorAll(".ct-dvic-tab").forEach(r=>{let a=r.dataset.tab===t;r.classList.toggle("ct-dvic-tab--active",a),r.setAttribute("aria-selected",String(a))}),this._vehicles.length>0&&this._renderBody()}_getTodayBremenTimestamp(){let e=new Date().toLocaleDateString("sv",{timeZone:"Europe/Berlin"}),[r,a,i]=e.split("-").map(Number),n=new Date(Date.UTC(r,a-1,i,6,0,0)),s=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Berlin",hour:"numeric",minute:"numeric",hour12:!1}).formatToParts(n),c=parseInt(s.find(u=>u.type==="hour").value,10)%24,d=parseInt(s.find(u=>u.type==="minute").value,10),l=c*60+d-6*60;return Date.UTC(r,a-1,i)-l*6e4}async _fetchInspectionStats(t){let e=`https://logistics.amazon.de/fleet-management/api/inspection-stats?startTimestamp=${t}`,r=N(),a={Accept:"application/json"};return r&&(a["anti-csrftoken-a2z"]=r),(await U(async()=>{let n=await fetch(e,{method:"GET",headers:a,credentials:"include"});if(!n.ok)throw new Error(`HTTP ${n.status}: ${n.statusText}`);return n},{retries:2,baseMs:800})).json()}async _getEmployeeNames(t){if([...new Set(t)].filter(i=>!this._nameCache.has(i)).length>0)try{let i=this.companyConfig.getDefaultServiceAreaId(),n=new Date().toISOString().split("T")[0],c=`https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${Nt(n,-30)}&toDate=${n}&serviceAreaId=${i}`,d=N(),l={Accept:"application/json"};d&&(l["anti-csrftoken-a2z"]=d);let u=await fetch(c,{method:"GET",headers:l,credentials:"include"});if(u.ok){let p=await u.json(),f=Array.isArray(p)?p:(p==null?void 0:p.data)||(p==null?void 0:p.rosters)||[],_=x=>{for(let E of x)E.driverPersonId&&E.driverName&&this._nameCache.set(String(E.driverPersonId),E.driverName)};if(Array.isArray(f))_(f);else if(typeof f=="object")for(let x of Object.values(f))Array.isArray(x)&&_(x);C("[DVIC] Roster fetch: added",this._nameCache.size,"names to cache")}}catch(i){C("[DVIC] Roster lookup failed:",i)}let a=new Map;for(let i of t)a.set(i,this._nameCache.get(i)||i);return a}_normalizeVehicle(t){let e=String((t==null?void 0:t.vehicleIdentifier)??"").trim()||"Unknown",r=Array.isArray(t==null?void 0:t.inspectionStats)?t.inspectionStats:[],a=r.find(x=>((x==null?void 0:x.inspectionType)??(x==null?void 0:x.type))==="PRE_TRIP_DVIC")??null,i=r.find(x=>((x==null?void 0:x.inspectionType)??(x==null?void 0:x.type))==="POST_TRIP_DVIC")??null,n=Number((a==null?void 0:a.totalInspectionsDone)??0),s=Number((i==null?void 0:i.totalInspectionsDone)??0),c=n-s,d=c>0?"Post Trip DVIC Missing":"OK",l=d==="OK"?0:c,u=[a,i].filter(Boolean).map(x=>x.inspectedAt??x.lastInspectedAt??null).filter(Boolean),p=u.length>0?u.sort().at(-1)??null:null,f=(a==null?void 0:a.shiftDate)??(i==null?void 0:i.shiftDate)??null,_=new Set;for(let x of r){let E=Array.isArray(x==null?void 0:x.inspectionDetails)?x.inspectionDetails:[];for(let w of E){let R=w==null?void 0:w.reporterId;R!=null&&String(R).trim()!==""&&_.add(String(R).trim())}}return{vehicleIdentifier:e,preTripTotal:n,postTripTotal:s,missingCount:l,status:d,inspectedAt:p,shiftDate:f,reporterIds:[..._],reporterNames:[]}}_processApiResponse(t){if(t===null||typeof t!="object")throw new Error("API response is not a JSON object");let e=t==null?void 0:t.inspectionsStatList;if(e==null)return[];if(!Array.isArray(e))throw new Error(`inspectionsStatList has unexpected type: ${typeof e}`);return e.map(r=>this._normalizeVehicle(r))}async _refresh(){var r;if(this._loading)return;this._loading=!0,this._vehicles=[];let t=this._getTodayBremenTimestamp();this._lastTimestamp=t;let e=new Date(t).toLocaleDateString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric"});this._setStatus(`\u23F3 Lade DVIC-Daten f\xFCr heute (${e})\u2026`),this._setTiles(""),this._setBody('<div class="ct-dvic-loading" role="status">Daten werden geladen\u2026</div>');try{let a=await this._fetchInspectionStats(t),i;try{i=this._processApiResponse(a)}catch(l){$("DVIC response parse error:",l),this._setBody(`<div class="ct-dvic-error" role="alert">\u26A0\uFE0F DVIC data unavailable for this date.<br><small>${m(l.message)}</small></div>`),this._setStatus("\u26A0\uFE0F Daten konnten nicht verarbeitet werden."),this._loading=!1;return}let n=[...new Set(i.flatMap(l=>l.reporterIds))];if(n.length>0){this._setStatus("\u23F3 Lade Mitarbeiternamen\u2026");try{let l=await this._getEmployeeNames(n);for(let u of i)u.reporterNames=[...new Set(u.reporterIds.map(p=>l.get(p)||p))]}catch(l){C("Name enrichment failed, using IDs as fallback:",l);for(let u of i)u.reporterNames=[...u.reporterIds]}}else for(let l of i)l.reporterNames=[];this._vehicles=i;let s=i.filter(l=>l.status!=="OK").length,c=i.reduce((l,u)=>l+u.missingCount,0);this._setStatus(`\u2705 ${i.length} Fahrzeuge | ${s} mit fehlendem Post-Trip DVIC | ${c} fehlende DVICs gesamt`);let d=document.getElementById("ct-dvic-asof");if(d){let l=new Date().toLocaleString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"});d.textContent=`Stand: ${l} (Daten ab ${e})`}this._renderTiles(i.length,s,c),this._updateMissingTabBadge(s),this._renderBody()}catch(a){$("DVIC fetch failed:",a),this._setBody(`<div class="ct-dvic-error" role="alert">\u274C DVIC-Daten konnten nicht geladen werden.<br><small>${m(a.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-dvic-retry">\u{1F504} Erneut versuchen</button></div>`),this._setStatus("\u274C Fehler beim Laden."),(r=document.getElementById("ct-dvic-retry"))==null||r.addEventListener("click",()=>this._refresh())}finally{this._loading=!1}}_setStatus(t){let e=document.getElementById("ct-dvic-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-dvic-body");e&&(e.innerHTML=t)}_setTiles(t){let e=document.getElementById("ct-dvic-tiles");e&&(e.innerHTML=t)}_updateMissingTabBadge(t){let e=document.getElementById("ct-dvic-tab-missing");e&&(e.textContent=t>0?`\u26A0\uFE0F DVIC Fehlend (${t})`:"\u26A0\uFE0F DVIC Fehlend")}_renderTiles(t,e,r){let a=e===0?"ct-dvic-tile--ok":e<5?"ct-dvic-tile--warn":"ct-dvic-tile--danger";this._setTiles(`
      <div class="ct-dvic-tiles">
        <div class="ct-dvic-tile"><div class="ct-dvic-tile-val">${t}</div><div class="ct-dvic-tile-lbl">Fahrzeuge gesamt</div></div>
        <div class="ct-dvic-tile ${a}"><div class="ct-dvic-tile-val">${e}</div><div class="ct-dvic-tile-lbl">Fahrzeuge mit Fehler</div></div>
        <div class="ct-dvic-tile ${r===0?"ct-dvic-tile--ok":"ct-dvic-tile--danger"}"><div class="ct-dvic-tile-val">${r}</div><div class="ct-dvic-tile-lbl">DVIC fehlend gesamt</div></div>
        <div class="ct-dvic-tile ${e===0?"ct-dvic-tile--ok":""}"><div class="ct-dvic-tile-val">${t-e}</div><div class="ct-dvic-tile-lbl">Fahrzeuge OK</div></div>
      </div>`)}_renderBody(){if(this._overlayEl){if(this._vehicles.length===0){this._setBody('<div class="ct-dvic-empty">Keine DVIC-Daten verf\xFCgbar f\xFCr dieses Datum.</div>');return}this._currentTab==="all"?this._renderAllTab():this._renderMissingTab()}}_renderTransporterNames(t){let e=(t.reporterIds??[]).filter(s=>String(s).trim()!=="");if(e.length===0)return'<em class="ct-dvic-tp-unknown" aria-label="Unbekannter Transporter">Unbekannter Transporter</em>';let r=e.map(s=>{let c=this._nameCache.get(s);return c&&c!==s?`${c} (ID: ${s})`:s});if(r.length===0)return'<em class="ct-dvic-tp-unknown">Unbekannter Transporter</em>';let[a,...i]=r,n=i.length>0?`<span class="ct-dvic-tp-secondary">, ${m(i.join(", "))}</span>`:"";return`<span class="ct-dvic-tp-primary" aria-label="Transporter: ${m(r.join(", "))}">${m(a)}${n}</span>`}_renderAllTab(){var l;let t=this._pageCurrent,e=this._vehicles.length,r=Math.ceil(e/this._pageSize),a=(t-1)*this._pageSize,i=this._vehicles.slice(a,a+this._pageSize),n=this._showTransporters,s=i.map(u=>{let p=u.status!=="OK",f=p?"ct-dvic-row--missing":"",_=p?"ct-dvic-badge--missing":"ct-dvic-badge--ok",x=n?`<td class="ct-dvic-tp-cell">${this._renderTransporterNames(u)}</td>`:"";return`<tr class="${f}" role="row">
        <td>${m(u.vehicleIdentifier)}</td>
        <td>${u.preTripTotal}</td><td>${u.postTripTotal}</td>
        <td>${u.missingCount>0?`<strong>${u.missingCount}</strong>`:"0"}</td>
        <td><span class="${_}">${m(u.status)}</span></td>
        ${x}<td></td>
      </tr>`}).join(""),c=n?"Transporter ausblenden":"Transporter einblenden",d=n?'<th scope="col" class="ct-dvic-tp-th">Transporter</th>':"";this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-all">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${n}">\u{1F464} ${c}</button>
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip \u2713</th><th scope="col">Post-Trip \u2713</th>
            <th scope="col">Fehlend</th><th scope="col">Status</th>
            ${d}<th scope="col" style="width:4px;"></th>
          </tr></thead>
          <tbody>${s}</tbody>
        </table>
        ${this._renderPagination(e,t,r,"all")}
      </div>`),(l=document.getElementById("ct-dvic-tp-toggle"))==null||l.addEventListener("click",()=>{this.config.features.dvicShowTransporters=!this._showTransporters,J(this.config),this._renderBody()}),this._attachPaginationHandlers("all")}_renderMissingTab(){var l;let t=this._vehicles.filter(u=>u.status!=="OK");if(t.length===0){this._setBody('<div class="ct-dvic-empty">\u2705 Alle Fahrzeuge haben Post-Trip DVICs \u2014 kein Handlungsbedarf.</div>');return}let e=this._pageMissing,r=Math.ceil(t.length/this._pageSize),a=(e-1)*this._pageSize,i=t.slice(a,a+this._pageSize),n=this._showTransporters,s=i.map(u=>{let p=n?`<td class="ct-dvic-tp-cell">${this._renderTransporterNames(u)}</td>`:"";return`<tr class="ct-dvic-row--missing" role="row">
        <td>${m(u.vehicleIdentifier)}</td>
        <td>${u.preTripTotal}</td><td>${u.postTripTotal}</td>
        <td><strong>${u.missingCount}</strong></td>
        ${p}
      </tr>`}).join(""),c=n?"Transporter ausblenden":"Transporter einblenden",d=n?'<th scope="col" class="ct-dvic-tp-th">Transporter</th>':"";this._setBody(`
      <div role="tabpanel" aria-labelledby="ct-dvic-tab-missing">
        <div class="ct-dvic-toolbar">
          <button class="ct-dvic-tp-toggle ct-btn" id="ct-dvic-tp-toggle" aria-pressed="${n}">\u{1F464} ${c}</button>
        </div>
        <table class="ct-table ct-dvic-table" role="grid">
          <thead><tr>
            <th scope="col">Fahrzeug</th>
            <th scope="col">Pre-Trip \u2713</th><th scope="col">Post-Trip \u2713</th>
            <th scope="col">Fehlend</th>${d}
          </tr></thead>
          <tbody>${s}</tbody>
        </table>
        ${this._renderPagination(t.length,e,r,"missing")}
      </div>`),(l=document.getElementById("ct-dvic-tp-toggle"))==null||l.addEventListener("click",()=>{this.config.features.dvicShowTransporters=!this._showTransporters,J(this.config),this._renderBody()}),this._attachPaginationHandlers("missing")}_renderPagination(t,e,r,a){return r<=1?"":`
      <div class="ct-dvic-pagination">
        <button class="ct-btn ct-btn--secondary ct-dvic-prev-page" data-tab="${a}" ${e<=1?"disabled":""}>\u2039 Zur\xFCck</button>
        <span class="ct-dvic-page-info">Seite ${e} / ${r} (${t} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-dvic-next-page" data-tab="${a}" ${e>=r?"disabled":""}>Weiter \u203A</button>
      </div>`}_attachPaginationHandlers(t){var r,a;let e=document.getElementById("ct-dvic-body");e&&((r=e.querySelector(`.ct-dvic-prev-page[data-tab="${t}"]`))==null||r.addEventListener("click",()=>{t==="all"?this._pageCurrent>1&&(this._pageCurrent--,this._renderAllTab()):this._pageMissing>1&&(this._pageMissing--,this._renderMissingTab())}),(a=e.querySelector(`.ct-dvic-next-page[data-tab="${t}"]`))==null||a.addEventListener("click",()=>{let i=t==="all"?this._vehicles.length:this._vehicles.filter(s=>s.status!=="OK").length,n=Math.ceil(i/this._pageSize);t==="all"?this._pageCurrent<n&&(this._pageCurrent++,this._renderAllTab()):this._pageMissing<n&&(this._pageMissing++,this._renderMissingTab())}))}};function rt(o){if(o==null)return null;let t=Number(o);return isNaN(t)?null:t>1e15?Math.floor(t/1e3):t>1e12?t:t>1e9?t*1e3:t}function St(o){if(o==null)return"\u2014";try{return new Date(o).toLocaleTimeString("de-DE",{timeZone:"Europe/Berlin",hour:"2-digit",minute:"2-digit",hour12:!1})}catch{return"\u2014"}}function kt(o){if(o==null)return"\u2014";let t=Number(o);if(isNaN(t))return"\u2014";let e=Math.floor(t/1e3),r=Math.floor(e/60),a=e%60;return`${r}m ${String(a).padStart(2,"0")}s`}function ye(o){let t=o.transporterTimeAttributes||{};return{itineraryId:o.itineraryId??null,transporterId:o.transporterId??null,routeCode:o.routeCode??null,serviceTypeName:o.serviceTypeName??null,driverName:null,blockDurationInMinutes:o.blockDurationInMinutes??null,waveStartTime:rt(o.waveStartTime),itineraryStartTime:rt(o.itineraryStartTime),plannedDepartureTime:rt(o.plannedDepartureTime),actualDepartureTime:rt(t.actualDepartureTime),plannedOutboundStemTime:t.plannedOutboundStemTime??null,actualOutboundStemTime:t.actualOutboundStemTime??null,lastDriverEventTime:rt(o.lastDriverEventTime)}}function Gt(o,t,e){let r=e==="asc"?1:-1;return[...o].sort((a,i)=>{let n=a[t],s=i[t];return n===null&&s===null?0:n===null?1:s===null?-1:typeof n=="string"?r*n.localeCompare(s):r*(n-s)})}var qt=[{key:"routeCode",label:"Route Code",type:"string"},{key:"serviceTypeName",label:"Service Type",type:"string"},{key:"driverName",label:"Driver",type:"string"},{key:"blockDurationInMinutes",label:"Block (min)",type:"integer"},{key:"waveStartTime",label:"Wave Start",type:"time"},{key:"itineraryStartTime",label:"Itin. Start",type:"time"},{key:"plannedDepartureTime",label:"Planned Dep.",type:"time"},{key:"actualDepartureTime",label:"Actual Dep.",type:"time"},{key:"plannedOutboundStemTime",label:"Planned OB Stem",type:"duration"},{key:"actualOutboundStemTime",label:"Actual OB Stem",type:"duration"},{key:"lastDriverEventTime",label:"Last Driver Event",type:"time"}],Qt=[{key:"itineraryId",label:"Itinerary ID",format:"string",suffix:""},{key:"routeCode",label:"Route Code",format:"string",suffix:""},{key:"serviceTypeName",label:"Service Type",format:"string",suffix:""},{key:"driverName",label:"Driver",format:"string",suffix:""},{key:"blockDurationInMinutes",label:"Block Duration",format:"integer",suffix:" min"},{key:"waveStartTime",label:"Wave Start",format:"time",suffix:""},{key:"itineraryStartTime",label:"Itin. Start",format:"time",suffix:""},{key:"plannedDepartureTime",label:"Planned Departure",format:"time",suffix:""},{key:"actualDepartureTime",label:"Actual Departure",format:"time",suffix:""},{key:"plannedOutboundStemTime",label:"Planned OB Stem",format:"duration",suffix:""},{key:"actualOutboundStemTime",label:"Actual OB Stem",format:"duration",suffix:""},{key:"lastDriverEventTime",label:"Last Driver Event",format:"time",suffix:""}],ht=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_detailEl=null;_active=!1;_data=[];_sort={column:"routeCode",direction:"asc"};_page=1;_pageSize=50;_driverCache=new Map;init(){if(this._overlayEl)return;let t=document.createElement("div");t.id="ct-whd-overlay",t.className="ct-overlay",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.setAttribute("aria-label","Working Hours Dashboard"),t.innerHTML=`
      <div class="ct-whd-panel">
        <h2>\u23F1 Working Hours Dashboard</h2>
        <div class="ct-controls">
          <label for="ct-whd-date">Datum:</label>
          <input type="date" id="ct-whd-date" class="ct-input" value="${F()}" aria-label="Datum ausw\xE4hlen">
          <label for="ct-whd-sa">Service Area:</label>
          <select id="ct-whd-sa" class="ct-select" aria-label="Service Area"></select>
          <button class="ct-btn ct-btn--accent" id="ct-whd-go">\u{1F50D} Abfragen</button>
          <button class="ct-btn ct-btn--primary" id="ct-whd-export">\u{1F4CB} CSV Export</button>
          <button class="ct-btn ct-btn--close" id="ct-whd-close">\u2715 Schlie\xDFen</button>
        </div>
        <div id="ct-whd-status" class="ct-status" role="status" aria-live="polite"></div>
        <div id="ct-whd-body"></div>
      </div>
    `,document.body.appendChild(t),this._overlayEl=t,t.addEventListener("click",e=>{e.target===t&&this.hide()}),t.addEventListener("keydown",e=>{e.key==="Escape"&&this.hide()}),document.getElementById("ct-whd-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-whd-go").addEventListener("click",()=>this._fetchData()),document.getElementById("ct-whd-export").addEventListener("click",()=>this._exportCSV()),this.companyConfig.load().then(()=>{this.companyConfig.populateSaSelect(document.getElementById("ct-whd-sa"))}),B(()=>this.dispose()),C("Working Hours Dashboard initialized")}dispose(){var t,e;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,(e=this._detailEl)==null||e.remove(),this._detailEl=null,this._data=[],this._active=!1}toggle(){if(!this.config.features.workingHours){alert("Working Hours Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,document.getElementById("ct-whd-date").focus()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}async _resolveDriverNames(t,e,r){if([...new Set(t.map(n=>n.transporterId).filter(n=>n!=null))].filter(n=>!this._driverCache.has(n)).length>0)try{let n=new Date(e+"T00:00:00"),s=new Date(n);s.setDate(s.getDate()-7);let c=new Date(n);c.setDate(c.getDate()+1);let d=`https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${s.toISOString().split("T")[0]}&toDate=${c.toISOString().split("T")[0]}&serviceAreaId=${r}`,l=N(),u={Accept:"application/json"};l&&(u["anti-csrftoken-a2z"]=l);let p=await fetch(d,{method:"GET",headers:u,credentials:"include"});if(p.ok){let f=await p.json(),_=Array.isArray(f)?f:(f==null?void 0:f.data)||(f==null?void 0:f.rosters)||[],x=E=>{for(let w of E)w.driverPersonId&&w.driverName&&this._driverCache.set(String(w.driverPersonId),w.driverName)};if(Array.isArray(_))x(_);else if(typeof _=="object")for(let E of Object.values(_))Array.isArray(E)&&x(E);C(`[WHD] Roster loaded: ${this._driverCache.size} driver names cached`)}}catch(n){C("[WHD] Roster lookup failed (non-fatal):",n)}for(let n of t)n.transporterId&&(n.driverName=this._driverCache.get(n.transporterId)||null)}async _fetchData(){var a,i,n,s;let t=(a=document.getElementById("ct-whd-date"))==null?void 0:a.value,e=document.getElementById("ct-whd-sa"),r=e&&e.value?e.value:this.companyConfig.getDefaultServiceAreaId();if(!t){this._setStatus("\u26A0\uFE0F Bitte Datum ausw\xE4hlen.");return}if(!r){this._setStatus("\u26A0\uFE0F Bitte Service Area ausw\xE4hlen.");return}this._setStatus(`\u23F3 Lade Daten f\xFCr ${t}\u2026`),this._setBody('<div class="ct-whd-loading" role="status">Daten werden geladen\u2026</div>');try{let c=`https://logistics.amazon.de/operations/execution/api/summaries?historicalDay=false&localDate=${t}&serviceAreaId=${r}`,l=await(await U(async()=>{let _=await fetch(c,{method:"GET",credentials:"same-origin",headers:{Accept:"application/json, text/plain, */*","Accept-Language":"de,en-US;q=0.7,en;q=0.3","user-ref":"cortex-webapp-user","X-Cortex-Timestamp":Date.now().toString(),"X-Cortex-Session":it()??"",Referer:location.href}});if(!_.ok)throw new Error(`HTTP ${_.status}: ${_.statusText}`);return _},{retries:2,baseMs:800})).json(),u=(l==null?void 0:l.itinerarySummaries)||(l==null?void 0:l.summaries)||((i=l==null?void 0:l.data)==null?void 0:i.itinerarySummaries)||(l==null?void 0:l.data)||(Array.isArray(l)?l:[]);if(u.length===0){this._data=[],this._setBody('<div class="ct-whd-empty">\u{1F4ED} Keine Itineraries gefunden.<br><small>Bitte Datum/Service Area pr\xFCfen.</small></div>'),this._setStatus("\u26A0\uFE0F Keine Daten f\xFCr diesen Tag/Service Area.");return}this._data=u.map(ye),this._setStatus(`\u23F3 ${this._data.length} Itineraries geladen, lade Fahrernamen\u2026`),await this._resolveDriverNames(this._data,t,r),this._page=1,this._sort={column:"routeCode",direction:"asc"},this._renderTable();let p=((n=this.companyConfig.getServiceAreas().find(_=>_.serviceAreaId===r))==null?void 0:n.stationCode)||r,f=this._data.filter(_=>_.driverName!==null).length;this._setStatus(`\u2705 ${this._data.length} Itineraries geladen \u2014 ${t} / ${p} | ${f} Fahrer zugeordnet`)}catch(c){$("WHD fetch failed:",c),this._data=[],this._setBody(`<div class="ct-whd-error" role="alert">\u274C Daten konnten nicht geladen werden.<br><small>${m(c.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-whd-retry">\u{1F504} Erneut versuchen</button></div>`),this._setStatus("\u274C Fehler beim Laden."),(s=document.getElementById("ct-whd-retry"))==null||s.addEventListener("click",()=>this._fetchData())}}_renderTable(){let t=Gt(this._data,this._sort.column,this._sort.direction),e=Math.max(1,Math.ceil(t.length/this._pageSize));this._page>e&&(this._page=e);let r=(this._page-1)*this._pageSize,a=t.slice(r,r+this._pageSize),i=l=>this._sort.column!==l?"":`<span class="ct-whd-sort-icon">${this._sort.direction==="asc"?"\u25B2":"\u25BC"}</span>`,n=l=>this._sort.column!==l?"none":this._sort.direction==="asc"?"ascending":"descending",s=qt.map(l=>`<th scope="col" role="columnheader" aria-sort="${n(l.key)}" data-sort="${l.key}" title="Sort by ${m(l.label)}">
        ${m(l.label)}${i(l.key)}
      </th>`).join(""),c=a.map(l=>{let u=qt.map(p=>{let f=l[p.key];if(p.key==="driverName")return f==null?'<td class="ct-whd-driver ct-nodata">Unassigned</td>':`<td class="ct-whd-driver">${m(String(f))}</td>`;if(f==null)return'<td class="ct-nodata">\u2014</td>';switch(p.type){case"duration":return`<td>${m(kt(f))}</td>`;case"time":return`<td>${m(St(f))}</td>`;default:return`<td>${m(String(f))}</td>`}}).join("");return`<tr data-itinerary-id="${m(l.itineraryId||"")}" role="row" tabindex="0">${u}</tr>`}).join(""),d=this._renderPagination(t.length,this._page,e);this._setBody(`
      <div class="ct-whd-table-wrap">
        <table class="ct-table ct-whd-table" role="grid" aria-label="Working Hours Dashboard">
          <thead><tr>${s}</tr></thead>
          <tbody>${c}</tbody>
        </table>
      </div>
      ${d}`),this._attachTableHandlers()}_attachTableHandlers(){var e,r;let t=document.getElementById("ct-whd-body");t&&(t.querySelectorAll("th[data-sort]").forEach(a=>{a.addEventListener("click",()=>{let i=a.dataset.sort;this._sort.column===i?this._sort.direction=this._sort.direction==="asc"?"desc":"asc":(this._sort.column=i,this._sort.direction="asc"),this._renderTable()})}),t.querySelectorAll("tr[data-itinerary-id]").forEach(a=>{a.addEventListener("click",()=>{let i=a.dataset.itineraryId;i&&this._showDetail(i)}),a.addEventListener("keydown",i=>{if(i.key==="Enter"||i.key===" "){i.preventDefault();let n=a.dataset.itineraryId;n&&this._showDetail(n)}})}),(e=t.querySelector(".ct-whd-prev"))==null||e.addEventListener("click",()=>{this._page>1&&(this._page--,this._renderTable())}),(r=t.querySelector(".ct-whd-next"))==null||r.addEventListener("click",()=>{let a=Math.ceil(this._data.length/this._pageSize);this._page<a&&(this._page++,this._renderTable())}))}_renderPagination(t,e,r){return r<=1?"":`
      <div class="ct-whd-pagination">
        <button class="ct-btn ct-btn--secondary ct-whd-prev" ${e<=1?"disabled":""} aria-label="Vorherige Seite">\u2039 Zur\xFCck</button>
        <span class="ct-whd-page-info">Seite ${e} / ${r} (${t} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-whd-next" ${e>=r?"disabled":""} aria-label="N\xE4chste Seite">Weiter \u203A</button>
      </div>`}_showDetail(t){var c;let e=this._data.find(d=>d.itineraryId===t);if(!e)return;(c=this._detailEl)==null||c.remove(),this._detailEl=null;let r=(d,l)=>{if(l==null)return"\u2014";switch(d.format){case"time":return St(l);case"duration":return kt(l);case"integer":return String(l)+(d.suffix||"");default:return String(l)}},a=Qt.map(d=>{let l=r(d,e[d.key]);return`<div class="ct-whd-detail-row">
        <div>
          <span class="ct-whd-detail-label">${m(d.label)}</span><br>
          <span class="ct-whd-detail-value">${m(l)}</span>
        </div>
        <button class="ct-whd-copy-btn" data-copy-value="${m(l)}" aria-label="Copy ${m(d.label)}">\u{1F4CB} Copy</button>
      </div>`}).join(""),i=Qt.map(d=>`${d.label}: ${r(d,e[d.key])}`).join(`
`),n=document.createElement("div");n.className="ct-overlay visible",n.setAttribute("role","dialog"),n.setAttribute("aria-modal","true"),n.innerHTML=`
      <div class="ct-dialog" style="min-width:420px;max-width:580px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;color:var(--ct-primary);">\u{1F4CB} Itinerary Details</h3>
          <button class="ct-btn ct-btn--close" id="ct-whd-detail-close" aria-label="Close" style="margin-left:auto;">\u2715</button>
        </div>
        ${a}
        <div style="margin-top:16px;text-align:center;">
          <button class="ct-btn ct-btn--primary" id="ct-whd-copy-all">\u{1F4CB} Copy All</button>
        </div>
      </div>`,document.body.appendChild(n),this._detailEl=n;let s=()=>{n.remove(),this._detailEl=null};n.addEventListener("click",d=>{d.target===n&&s()}),document.getElementById("ct-whd-detail-close").addEventListener("click",s),n.addEventListener("keydown",d=>{d.key==="Escape"&&s()}),n.querySelectorAll(".ct-whd-copy-btn").forEach(d=>{d.addEventListener("click",l=>{l.stopPropagation();let u=d.dataset.copyValue;navigator.clipboard.writeText(u).then(()=>{let p=d.textContent;d.textContent="\u2705 Copied!",setTimeout(()=>{d.textContent=p},1500)}).catch(()=>{d.textContent="\u26A0\uFE0F Failed",setTimeout(()=>{d.textContent="\u{1F4CB} Copy"},1500)})})}),document.getElementById("ct-whd-copy-all").addEventListener("click",()=>{let d=document.getElementById("ct-whd-copy-all");navigator.clipboard.writeText(i).then(()=>{d.textContent="\u2705 All Copied!",setTimeout(()=>{d.textContent="\u{1F4CB} Copy All"},1500)}).catch(()=>{d.textContent="\u26A0\uFE0F Failed",setTimeout(()=>{d.textContent="\u{1F4CB} Copy All"},1500)})}),document.getElementById("ct-whd-detail-close").focus()}_exportCSV(){var p,f;if(!this._data||this._data.length===0){alert("Bitte zuerst Daten laden.");return}let t=";",e=["routeCode","serviceTypeName","blockDurationInMinutes","waveStartTime","itineraryStartTime","plannedDepartureTime","actualDepartureTime","plannedOutboundStemTime","actualOutboundStemTime","lastDriverEventTime","itineraryId"],r=e.join(t)+`
`,a=Gt(this._data,this._sort.column,this._sort.direction);for(let _ of a){let x=e.map(E=>{let w=_[E];return w==null?"":E==="plannedOutboundStemTime"||E==="actualOutboundStemTime"?kt(w):E==="routeCode"||E==="serviceTypeName"||E==="itineraryId"||E==="blockDurationInMinutes"?String(w):St(w)});r+=x.join(t)+`
`}let i=((p=document.getElementById("ct-whd-date"))==null?void 0:p.value)||F(),n=document.getElementById("ct-whd-sa"),s=n&&n.value?n.value:"",c=((f=this.companyConfig.getServiceAreas().find(_=>_.serviceAreaId===s))==null?void 0:f.stationCode)||"unknown",d=new Blob(["\uFEFF"+r],{type:"text/csv;charset=utf-8;"}),l=URL.createObjectURL(d),u=document.createElement("a");u.href=l,u.download=`working_hours_${i}_${c}.csv`,u.click(),URL.revokeObjectURL(l)}_setStatus(t){let e=document.getElementById("ct-whd-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-whd-body");e&&(e.innerHTML=t)}};function Et(o){if(!o)return"\u2014";try{return new Date(Number(o)).toLocaleString("de-DE",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}catch{return"\u2014"}}function Ct(o){var a,i;let t=o.address||{},e=t.geocodeLatitude??((a=t.geocode)==null?void 0:a.latitude),r=t.geocodeLongitude??((i=t.geocode)==null?void 0:i.longitude);return e!=null&&r!=null?{lat:Number(e),lon:Number(r)}:null}function _e(o){if(!o)return"ct-ret-card-reason--ok";let t=String(o).toUpperCase();return t.includes("DAMAGE")||t.includes("DEFECT")?"ct-ret-card-reason--error":t.includes("CUSTOMER")||t.includes("REFUSAL")?"ct-ret-card-reason--warn":"ct-ret-card-reason--ok"}var gt=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_allPackages=[];_filteredPackages=[];_page=1;_pageSize=50;_sort={field:"lastUpdatedTime",direction:"desc"};_filters={search:"",city:"",postalCode:"",routeCode:"",reasonCode:""};_viewMode="table";_cache=new Map;_cacheExpiry=5*60*1e3;_transporterCache=new Map;init(){if(this._overlayEl)return;let t=F(),e=document.createElement("div");e.id="ct-ret-overlay",e.className="ct-overlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-label","Returns Dashboard"),e.innerHTML=`
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
    `,document.body.appendChild(e),this._overlayEl=e,e.addEventListener("click",r=>{r.target===e&&this.hide()}),document.getElementById("ct-ret-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-ret-go").addEventListener("click",()=>this._loadData()),document.getElementById("ct-ret-export").addEventListener("click",()=>this._exportCSV()),document.getElementById("ct-ret-clear-filters").addEventListener("click",()=>this._clearFilters()),["ct-ret-search","ct-ret-city","ct-ret-postal","ct-ret-route","ct-ret-reason"].forEach(r=>{document.getElementById(r).addEventListener("input",()=>this._applyFilters())}),["ct-ret-sort-field","ct-ret-sort-dir"].forEach(r=>{document.getElementById(r).addEventListener("change",()=>this._applyFilters())}),document.getElementById("ct-ret-view-table").addEventListener("click",()=>{this._viewMode="table",this._updateViewToggle(),this._renderCards()}),document.getElementById("ct-ret-view-cards").addEventListener("click",()=>{this._viewMode="cards",this._updateViewToggle(),this._renderCards()}),this._initSaDropdown(),B(()=>this.dispose()),C("Returns Dashboard initialized")}dispose(){var t;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._allPackages=[],this._filteredPackages=[],this._active=!1}toggle(){if(!this.config.features.returnsDashboard){alert("Returns Dashboard ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,document.getElementById("ct-ret-date").focus()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}async _initSaDropdown(){let t=document.getElementById("ct-ret-sa");t.innerHTML="",await this.companyConfig.load();let e=this.companyConfig.getServiceAreas(),r=e.length>0?e:[],a=this.companyConfig.getDefaultServiceAreaId();r.forEach(i=>{let n=document.createElement("option");n.value=i.serviceAreaId,n.textContent=i.stationCode,i.serviceAreaId===a&&(n.selected=!0),t.appendChild(n)})}async _resolveTransporterNames(t,e,r){let a=[...new Set(t.map(n=>n.transporterId).filter(n=>n!=null))];if(a.length===0)return;if(a.filter(n=>!this._transporterCache.has(n)).length>0)try{let n=new Date(e+"T00:00:00"),s=new Date(n);s.setDate(s.getDate()-7);let c=new Date(n);c.setDate(c.getDate()+1);let d=`https://logistics.amazon.de/scheduling/home/api/v2/rosters?fromDate=${s.toISOString().split("T")[0]}&toDate=${c.toISOString().split("T")[0]}&serviceAreaId=${r}`,l=N(),u={Accept:"application/json"};l&&(u["anti-csrftoken-a2z"]=l);let p=await fetch(d,{method:"GET",headers:u,credentials:"include"});if(p.ok){let f=await p.json(),_=Array.isArray(f)?f:(f==null?void 0:f.data)||(f==null?void 0:f.rosters)||[],x=E=>{for(let w of E)w.driverPersonId&&w.driverName&&this._transporterCache.set(String(w.driverPersonId),w.driverName)};if(Array.isArray(_))x(_);else if(typeof _=="object")for(let E of Object.values(_))Array.isArray(E)&&x(E);C(`[Returns] Roster loaded: ${this._transporterCache.size} driver names cached`)}}catch(n){C("[Returns] Roster lookup failed:",n)}}async _loadData(){var s;let t=document.getElementById("ct-ret-date").value,e=document.getElementById("ct-ret-sa").value,r=document.getElementById("ct-ret-routeview").checked;if(!t){this._setStatus("\u26A0\uFE0F Bitte Datum ausw\xE4hlen.");return}if(!e){this._setStatus("\u26A0\uFE0F Bitte Service Area ausw\xE4hlen.");return}let a=`${t}|${e}`,i=this._cache.get(a);if(i&&Date.now()-i.timestamp<this._cacheExpiry){C("Returns: using cached data"),this._allPackages=i.data,this._applyFilters(),this._setStatus(`\u2705 ${this._allPackages.length} Pakete aus Cache geladen`);return}this._setStatus("\u23F3 Lade Returns-Daten\u2026"),this._setBody('<div class="ct-ret-loading">Daten werden geladen\u2026</div>');let n=new URLSearchParams({historicalDay:"false",localDate:t,packageStatus:"RETURNED",routeView:String(r),serviceAreaId:e,statsFromSummaries:"true"});try{let d=await(await U(async()=>{let u=await fetch(`https://logistics.amazon.de/operations/execution/api/packages/packagesByStatus?${n}`,{method:"GET",credentials:"same-origin",headers:{Accept:"application/json, text/plain, */*","Accept-Language":"de,en-US;q=0.7,en;q=0.3",Referer:location.href}});if(!u.ok)throw new Error(`HTTP ${u.status}: ${u.statusText}`);return u},{retries:3,baseMs:500})).json(),l=Array.isArray(d==null?void 0:d.packages)?d.packages:[];this._cache.set(a,{data:l,timestamp:Date.now()}),this._allPackages=l,this._setStatus(`\u23F3 ${l.length} Pakete geladen, lade Fahrernamen\u2026`),await this._resolveTransporterNames(l,t,e),this._page=1,this._applyFilters(),this._setStatus(`\u2705 ${l.length} Pakete geladen f\xFCr ${t}`)}catch(c){$("Returns fetch failed:",c),this._setBody(`<div class="ct-ret-error" role="alert">\u274C Daten konnten nicht geladen werden.<br><small>${m(c.message)}</small><br><br><button class="ct-btn ct-btn--accent" id="ct-ret-retry">\u{1F504} Erneut versuchen</button></div>`),this._setStatus("\u274C Fehler beim Laden."),(s=document.getElementById("ct-ret-retry"))==null||s.addEventListener("click",()=>this._loadData())}}_clearFilters(){["ct-ret-search","ct-ret-city","ct-ret-postal","ct-ret-route","ct-ret-reason"].forEach(t=>{document.getElementById(t).value=""}),this._filters={search:"",city:"",postalCode:"",routeCode:"",reasonCode:""},this._applyFilters()}_applyFilters(){this._filters={search:(document.getElementById("ct-ret-search").value||"").toLowerCase().trim(),city:(document.getElementById("ct-ret-city").value||"").toLowerCase().trim(),postalCode:(document.getElementById("ct-ret-postal").value||"").toLowerCase().trim(),routeCode:(document.getElementById("ct-ret-route").value||"").toLowerCase().trim(),reasonCode:(document.getElementById("ct-ret-reason").value||"").toLowerCase().trim()};let t=document.getElementById("ct-ret-sort-field").value,e=document.getElementById("ct-ret-sort-dir").value;this._filteredPackages=this._allPackages.filter(r=>{let a=r.address||{};return!(this._filters.search&&!String(r.scannableId||"").toLowerCase().includes(this._filters.search)||this._filters.city&&!String(a.city||"").toLowerCase().includes(this._filters.city)||this._filters.postalCode&&!String(a.postalCode||"").toLowerCase().includes(this._filters.postalCode)||this._filters.routeCode&&!String(r.routeCode||"").toLowerCase().includes(this._filters.routeCode)||this._filters.reasonCode&&!String(r.reasonCode||"").toLowerCase().includes(this._filters.reasonCode))}),this._filteredPackages.sort((r,a)=>{var d,l;let i=r[t],n=a[t],s,c;return t==="lastUpdatedTime"?(s=Number(i)||0,c=Number(n)||0):t==="city"?(s=(((d=r.address)==null?void 0:d.city)||"").toString().toLowerCase(),c=(((l=a.address)==null?void 0:l.city)||"").toString().toLowerCase()):t==="routeCode"?(s=(r.routeCode||"").toString().toLowerCase(),c=(a.routeCode||"").toString().toLowerCase()):(s=(i||"").toString().toLowerCase(),c=(n||"").toString().toLowerCase()),s<c?e==="asc"?-1:1:s>c?e==="asc"?1:-1:0}),this._renderStats(),this._renderCards()}_renderStats(){let t=this._allPackages.length,e=this._filteredPackages.length,r=document.getElementById("ct-ret-count");r&&(r.textContent=e===t?`${t} Pakete`:`${e} von ${t} Paketen`)}_updateViewToggle(){document.getElementById("ct-ret-view-table").classList.toggle("active",this._viewMode==="table"),document.getElementById("ct-ret-view-cards").classList.toggle("active",this._viewMode==="cards")}_renderCards(){let t=Math.ceil(this._filteredPackages.length/this._pageSize);this._page>t&&(this._page=Math.max(1,t));let e=(this._page-1)*this._pageSize,r=this._filteredPackages.slice(e,e+this._pageSize);if(r.length===0){this._setBody('<div class="ct-ret-empty">Keine Returns f\xFCr die gew\xE4hlten Filter gefunden.</div>'),this._renderPagination(0,1,1);return}if(this._viewMode==="table")this._renderTable(r);else{let a=r.map(i=>this._renderCard(i)).join("");this._setBody(`<div class="ct-ret-cards">${a}</div>`)}this._renderPagination(this._filteredPackages.length,this._page,t)}_renderTable(t){let e=t.map(r=>{let a=r.address||{},i=Ct(r),n=r.transporterId&&this._transporterCache.get(String(r.transporterId))||"\u2014";return`<tr>
        <td title="${m(r.scannableId||"")}">${m(String(r.scannableId||"\u2014"))}</td>
        <td>${m(n)}</td>
        <td>${Et(r.lastUpdatedTime)}</td>
        <td>${m(String(r.reasonCode||"\u2014"))}</td>
        <td>${m(String(r.routeCode||"\u2014"))}</td>
        <td>${m(String(a.address1||""))}</td>
        <td>${m(String(a.postalCode||""))}</td>
        <td>${m(String(a.city||"\u2014"))}</td>
        <td>${i?`<a href="https://www.google.com/maps/search/?api=1&query=${i.lat},${i.lon}" target="_blank" rel="noopener">\u{1F4CD}</a>`:"\u2014"}</td>
      </tr>`}).join("");this._setBody(`
      <div class="ct-ret-table-wrap">
        <table class="ct-table ct-ret-table">
          <thead><tr>
            <th>ScannableId</th><th>Transporter</th><th>Zeit</th><th>Reason</th>
            <th>Route</th><th>Adresse</th><th>PLZ</th><th>Stadt</th><th>Map</th>
          </tr></thead>
          <tbody>${e}</tbody>
        </table>
      </div>`)}_renderCard(t){let e=t.address||{},r=Ct(t),a=r?`https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}`:null,i=String(t.reasonCode||"Unbekannt"),n=t.transporterId&&this._transporterCache.get(String(t.transporterId))||"\u2014";return`<div class="ct-ret-card">
      <div class="ct-ret-card-header">
        <span class="ct-ret-card-id">${m(String(t.scannableId||"\u2014"))}</span>
        <span class="ct-ret-card-reason ${_e(t.reasonCode)}">${m(i)}</span>
      </div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Transporter:</span><span class="ct-ret-card-value">${m(n)}</span></div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Aktualisiert:</span><span class="ct-ret-card-value">${Et(t.lastUpdatedTime)}</span></div>
      <div class="ct-ret-card-row"><span class="ct-ret-card-label">Route:</span><span class="ct-ret-card-value">${m(String(t.routeCode||"\u2014"))}</span></div>
      <div class="ct-ret-card-address">
        ${m(String(e.address1||""))}${e.address2?", "+m(String(e.address2)):""}<br>
        ${m(String(e.postalCode||""))} ${m(String(e.city||""))}
        ${r?`<br><small>\u{1F4CD} ${r.lat.toFixed(5)}, ${r.lon.toFixed(5)}</small>`:""}
        ${a?`<a href="${a}" class="ct-ret-card-map" target="_blank" rel="noopener">\u{1F4CD} In Karte \xF6ffnen</a>`:""}
      </div>
    </div>`}_renderPagination(t,e,r){var n,s,c,d,l;let a=document.getElementById("ct-ret-body");if(!a)return;let i=(n=a.parentNode)==null?void 0:n.querySelector(".ct-ret-pagination");i&&i.remove(),!(r<=1)&&(a.insertAdjacentHTML("afterend",`
      <div class="ct-ret-pagination">
        <button class="ct-btn ct-btn--secondary ct-ret-prev" ${e<=1?"disabled":""}>\u2039 Zur\xFCck</button>
        <span class="ct-ret-page-info">Seite ${e} / ${r} (${t} Eintr\xE4ge)</span>
        <button class="ct-btn ct-btn--secondary ct-ret-next" ${e>=r?"disabled":""}>Weiter \u203A</button>
      </div>`),(c=(s=a.parentNode)==null?void 0:s.querySelector(".ct-ret-prev"))==null||c.addEventListener("click",()=>{this._page>1&&(this._page--,this._renderCards())}),(l=(d=a.parentNode)==null?void 0:d.querySelector(".ct-ret-next"))==null||l.addEventListener("click",()=>{this._page<r&&(this._page++,this._renderCards())}))}_exportCSV(){if(this._filteredPackages.length===0){alert("Keine Daten zum Exportieren.");return}let e=["scannableId","transporter","lastUpdatedTime","reasonCode","routeCode","address1","address2","city","postalCode","latitude","longitude"].join(";")+`
`;for(let n of this._filteredPackages){let s=n.address||{},c=Ct(n),d=n.transporterId&&this._transporterCache.get(String(n.transporterId))||"",l=[n.scannableId||"",d,Et(n.lastUpdatedTime),n.reasonCode||"",n.routeCode||"",s.address1||"",s.address2||"",s.city||"",s.postalCode||"",(c==null?void 0:c.lat)??"",(c==null?void 0:c.lon)??""];e+=l.map(u=>String(u).replace(/;/g,",")).join(";")+`
`}let r=new Blob(["\uFEFF"+e],{type:"text/csv;charset=utf-8;"}),a=URL.createObjectURL(r),i=document.createElement("a");i.href=a,i.download=`returns_${F()}.csv`,i.click(),URL.revokeObjectURL(a)}_setStatus(t){let e=document.getElementById("ct-ret-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-ret-body");e&&(e.innerHTML=t)}};function ft(o){if(o==null)return NaN;let t=String(o).trim();if(t==="-"||t==="")return NaN;let e=parseFloat(t.replace(",","."));return isNaN(e)?NaN:e}function te(o){let t=typeof o=="string"?JSON.parse(o):o,e={};for(let[n,s]of Object.entries(t))e[n.trim()]=s;let r=e.dcr_metric!==void 0?Number(e.dcr_metric):NaN,a=e.pod_metric!==void 0?Number(e.pod_metric):NaN,i=e.cc_metric!==void 0?Number(e.cc_metric):NaN;return{transporterId:String(e.country_program_providerid_stationcode||e.dsp_code||""),delivered:String(e.delivered||"0"),dcr:isNaN(r)?"-":(r*100).toFixed(2),dnrDpmo:String(e.dnr_dpmo??"0"),lorDpmo:String(e.lor_dpmo??"0"),pod:isNaN(a)?"-":(a*100).toFixed(2),cc:isNaN(i)?"-":(i*100).toFixed(2),ce:String(e.ce_metric??"0"),cdfDpmo:String(e.cdf_dpmo??"0"),daName:String(e.da_name||""),week:String(e.week||""),year:String(e.year||""),stationCode:String(e.station_code||""),dspCode:String(e.dsp_code||""),dataDate:String(e.data_date||""),country:String(e.country||""),program:String(e.program||""),region:String(e.region||""),lastUpdated:String(e.last_updated_time||""),_raw:e}}function Kt(o){let t=(ft(o.dcr==="-"?"100":o.dcr)||0)/100,e=parseFloat(o.dnrDpmo)||0,r=parseFloat(o.lorDpmo)||0,a=(ft(o.pod==="-"?"100":o.pod)||0)/100,i=(ft(o.cc==="-"?"100":o.cc)||0)/100,n=parseFloat(o.ce)||0,s=parseFloat(o.cdfDpmo)||0,c=parseFloat(o.delivered)||0,d=Math.max(Math.min(132.88*t+10*Math.max(0,1-s/1e4)-.0024*e-8.54*n+10*a+4*i+45e-5*c-60.88,100),0);if(t===1&&a===1&&i===1&&s===0&&n===0&&e===0&&r===0)d=100;else{let p=0;if(t*100<97&&p++,e>=1500&&p++,a*100<94&&p++,i*100<70&&p++,n!==0&&p++,s>=8e3&&p++,p>=2||p===1){let f=0;t*100<97&&(f+=(97-t*100)/5),e>=1500&&(f+=(e-1500)/1e3),a*100<94&&(f+=(94-a*100)/10),i*100<70&&(f+=(70-i*100)/50),n!==0&&(f+=n*1),s>=8e3&&(f+=(s-8e3)/2e3);let _=Math.min(3,f);d=Math.min(d,(p>=2?70:85)-_)}}let l=parseFloat(d.toFixed(2)),u=l<40?"Poor":l<70?"Fair":l<85?"Great":l<93?"Fantastic":"Fantastic Plus";return{transporterId:o.transporterId,delivered:o.delivered,dcr:(t*100).toFixed(2),dnrDpmo:e.toFixed(2),lorDpmo:r.toFixed(2),pod:(a*100).toFixed(2),cc:(i*100).toFixed(2),ce:n.toFixed(2),cdfDpmo:s.toFixed(2),status:u,totalScore:l,daName:o.daName,week:o.week,year:o.year,stationCode:o.stationCode,dspCode:o.dspCode,dataDate:o.dataDate,lastUpdated:o.lastUpdated,originalData:{dcr:o.dcr,dnrDpmo:o.dnrDpmo,lorDpmo:o.lorDpmo,pod:o.pod,cc:o.cc,ce:o.ce,cdfDpmo:o.cdfDpmo}}}function q(o,t){switch(t){case"DCR":return o<97?"poor":o<98.5?"fair":o<99.5?"great":"fantastic";case"DNRDPMO":case"LORDPMO":return o<1100?"fantastic":o<1300?"great":o<1500?"fair":"poor";case"POD":return o<94?"poor":o<95.5?"fair":o<97?"great":"fantastic";case"CC":return o<70?"poor":o<95?"fair":o<98.5?"great":"fantastic";case"CE":return o===0?"fantastic":"poor";case"CDFDPMO":return o>5460?"poor":o>4450?"fair":o>3680?"great":"fantastic";default:return""}}function Yt(o){switch(o){case"Poor":return"poor";case"Fair":return"fair";case"Great":return"great";case"Fantastic":case"Fantastic Plus":return"fantastic";default:return""}}function Jt(o){try{let t=o==null?void 0:o.tableData,e=t==null?void 0:t.da_dsp_station_weekly_quality,r=e==null?void 0:e.rows;if(!Array.isArray(r)||r.length===0)return[];let a=[];for(let i=0;i<r.length;i++)try{a.push(te(r[i]))}catch(n){$("Scorecard: failed to parse row",i,n)}return a}catch(t){return $("scParseApiResponse error:",t),[]}}function Zt(o){return o?/^\d{4}-W\d{2}$/.test(o)?null:"Week format must be YYYY-Www (e.g. 2026-W12).":"Week is required."}function Xt(){let o=new Date,t=new Date(Date.UTC(o.getFullYear(),o.getMonth(),o.getDate())),e=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-e);let r=new Date(Date.UTC(t.getUTCFullYear(),0,1)),a=Math.ceil(((t.getTime()-r.getTime())/864e5+1)/7);return`${t.getUTCFullYear()}-W${String(a).padStart(2,"0")}`}function we(o){let t=new Date;t.setDate(t.getDate()-o*7);let e=new Date(Date.UTC(t.getFullYear(),t.getMonth(),t.getDate())),r=e.getUTCDay()||7;e.setUTCDate(e.getUTCDate()+4-r);let a=new Date(Date.UTC(e.getUTCFullYear(),0,1)),i=Math.ceil(((e.getTime()-a.getTime())/864e5+1)/7);return`${e.getUTCFullYear()}-W${String(i).padStart(2,"0")}`}function Z(o,t){switch(t){case"DCR":return o<97?"rgb(235,50,35)":o<98.5?"rgb(223,130,68)":o<99.5?"rgb(126,170,85)":"rgb(77,115,190)";case"DNRDPMO":case"LORDPMO":return o<1100?"rgb(77,115,190)":o<1300?"rgb(126,170,85)":o<1500?"rgb(223,130,68)":"rgb(235,50,35)";case"POD":return o<94?"rgb(235,50,35)":o<95.5?"rgb(223,130,68)":o<97?"rgb(126,170,85)":"rgb(77,115,190)";case"CC":return o<70?"rgb(235,50,35)":o<95?"rgb(223,130,68)":o<98.5?"rgb(126,170,85)":"rgb(77,115,190)";case"CE":return o===0?"rgb(77,115,190)":"rgb(235,50,35)";case"CDFDPMO":return o>5460?"rgb(235,50,35)":o>4450?"rgb(223,130,68)":o>3680?"rgb(126,170,85)":"rgb(77,115,190)";default:return"#111111"}}function xe(o){switch(o){case"Poor":return"rgb(235,50,35)";case"Fair":return"rgb(223,130,68)";case"Great":return"rgb(126,170,85)";case"Fantastic":case"Fantastic Plus":return"rgb(77,115,190)";default:return"#111111"}}var vt=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_cache=new Map;_calculatedData=[];_currentSort={field:"totalScore",dir:"desc"};_currentPage=0;_pageSize=50;helpers={scConvertToDecimal:ft,scParseRow:te,scCalculateScore:Kt,scKpiClass:q,scStatusClass:Yt,scParseApiResponse:Jt,scValidateWeek:Zt,scCurrentWeek:Xt,scWeeksAgo:we};init(){if(this._overlayEl)return;let t=Xt(),e=document.createElement("div");e.id="ct-sc-overlay",e.className="ct-overlay",e.setAttribute("role","dialog"),e.setAttribute("aria-modal","true"),e.setAttribute("aria-label","Scorecard Dashboard"),e.innerHTML=`
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
    `,document.body.appendChild(e),this._overlayEl=e,this.companyConfig.load().then(()=>{this.companyConfig.populateSaSelect(document.getElementById("ct-sc-sa"))}),e.addEventListener("click",r=>{r.target===e&&this.hide()}),e.addEventListener("keydown",r=>{r.key==="Escape"&&this.hide()}),document.getElementById("ct-sc-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-sc-go").addEventListener("click",()=>this._triggerFetch()),document.getElementById("ct-sc-export").addEventListener("click",()=>this._exportCSV()),document.getElementById("ct-sc-imgdl").addEventListener("click",()=>this._downloadAsImage()),B(()=>this.dispose()),C("Scorecard Dashboard initialized")}dispose(){var t;(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._active=!1,this._cache.clear(),this._calculatedData=[]}toggle(){if(!this.config.features.scorecard){alert("Scorecard ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,document.getElementById("ct-sc-week").focus()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}_buildUrl(t,e,r){return`https://logistics.amazon.de/performance/api/v1/getData?dataSetId=${encodeURIComponent("da_dsp_station_weekly_quality")}&dsp=${encodeURIComponent(r)}&from=${encodeURIComponent(t)}&station=${encodeURIComponent(e)}&timeFrame=Weekly&to=${encodeURIComponent(t)}`}async _fetchData(t,e,r){let a=`sc|${t}|${e}|${r}`;if(this._cache.has(a))return C("Scorecard cache hit:",a),this._cache.get(a);let i=N(),n={Accept:"application/json"};i&&(n["anti-csrftoken-a2z"]=i);let c=await(await U(async()=>{let d=await fetch(this._buildUrl(t,e,r),{method:"GET",headers:n,credentials:"include"});if(!d.ok)throw new Error(`HTTP ${d.status}: ${d.statusText}`);return d},{retries:2,baseMs:800})).json();return this._cache.set(a,c),this._cache.size>50&&this._cache.delete(this._cache.keys().next().value),c}async _triggerFetch(){var n,s;let t=document.getElementById("ct-sc-week").value.trim(),e=Zt(t);if(e){this._setStatus("\u26A0\uFE0F "+e);return}let r=document.getElementById("ct-sc-sa"),a=((s=(n=r.options[r.selectedIndex])==null?void 0:n.textContent)==null?void 0:s.trim().toUpperCase())||this.companyConfig.getDefaultStation(),i=this.companyConfig.getDspCode();this._setStatus("\u23F3 Loading\u2026"),this._setBody('<div class="ct-sc-loading" role="status">Fetching scorecard data\u2026</div>');try{let c=await this._fetchData(t,a,i),d=Jt(c);if(d.length===0){this._setBody('<div class="ct-sc-empty">No data returned for the selected week.</div>'),this._setStatus("\u26A0\uFE0F No records found.");return}let l=d.map(u=>{try{return Kt(u)}catch(p){return $("Scorecard: failed to calculate score:",u,p),null}}).filter(u=>u!==null);if(l.length===0){this._setBody('<div class="ct-sc-error">All rows failed score calculation.</div>'),this._setStatus("\u274C Calculation failed for all rows.");return}l.sort((u,p)=>p.totalScore-u.totalScore),this._calculatedData=l,this._currentPage=0,this._currentSort={field:"totalScore",dir:"desc"},this._renderAll(),this._setStatus(`\u2705 ${l.length} record(s) loaded \u2014 ${t}`)}catch(c){$("Scorecard fetch failed:",c),this._setBody(`<div class="ct-sc-error">\u274C ${m(c.message)}</div>`),this._setStatus("\u274C Failed to load data.")}}_setStatus(t){let e=document.getElementById("ct-sc-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-sc-body");e&&(e.innerHTML=t)}_renderAll(){var p,f;let t=this._calculatedData;if(!t.length)return;let e=t.reduce((_,x)=>_+x.totalScore,0)/t.length,r={};for(let _ of t)r[_.status]=(r[_.status]||0)+1;let a=`
      <div class="ct-sc-tiles">
        <div class="ct-sc-tile"><div class="ct-sc-tile-val">${t.length}</div><div class="ct-sc-tile-lbl">Total Records</div></div>
        <div class="ct-sc-tile"><div class="ct-sc-tile-val">${e.toFixed(1)}</div><div class="ct-sc-tile-lbl">Avg Score</div></div>
        <div class="ct-sc-tile ct-sc-tile--fantastic"><div class="ct-sc-tile-val">${(r.Fantastic||0)+(r["Fantastic Plus"]||0)}</div><div class="ct-sc-tile-lbl">Fantastic(+)</div></div>
        <div class="ct-sc-tile ct-sc-tile--great"><div class="ct-sc-tile-val">${r.Great||0}</div><div class="ct-sc-tile-lbl">Great</div></div>
        <div class="ct-sc-tile ct-sc-tile--fair"><div class="ct-sc-tile-val">${r.Fair||0}</div><div class="ct-sc-tile-lbl">Fair</div></div>
        <div class="ct-sc-tile ct-sc-tile--poor"><div class="ct-sc-tile-val">${r.Poor||0}</div><div class="ct-sc-tile-lbl">Poor</div></div>
      </div>`,i=this._currentPage*this._pageSize,n=t.slice(i,Math.min(i+this._pageSize,t.length)),s=Math.ceil(t.length/this._pageSize),c=_=>this._currentSort.field!==_?"":this._currentSort.dir==="asc"?" \u25B2":" \u25BC",d=n.map((_,x)=>{let E=i+x+1,w=Yt(_.status);return`<tr>
        <td>${E}</td>
        <td title="${m(_.transporterId)}">${m(_.daName||_.transporterId)}</td>
        <td class="ct-sc-status--${w}">${m(_.status)}</td>
        <td><strong>${_.totalScore.toFixed(2)}</strong></td>
        <td>${m(Number(_.delivered).toLocaleString())}</td>
        <td class="ct-sc-color--${q(parseFloat(_.dcr),"DCR")}">${_.dcr}%</td>
        <td class="ct-sc-color--${q(parseFloat(_.dnrDpmo),"DNRDPMO")}">${parseInt(_.dnrDpmo,10)}</td>
        <td class="ct-sc-color--${q(parseFloat(_.lorDpmo),"LORDPMO")}">${parseInt(_.lorDpmo,10)}</td>
        <td class="ct-sc-color--${q(parseFloat(_.pod),"POD")}">${_.pod}%</td>
        <td class="ct-sc-color--${q(parseFloat(_.cc),"CC")}">${_.cc}%</td>
        <td class="ct-sc-color--${q(parseFloat(_.ce),"CE")}">${parseInt(_.ce,10)}</td>
        <td class="ct-sc-color--${q(parseFloat(_.cdfDpmo),"CDFDPMO")}">${parseInt(_.cdfDpmo,10)}</td>
      </tr>`}).join(""),l=`
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
          <tbody>${d}</tbody>
        </table>
      </div>`,u=s>1?`
      <div class="ct-sc-pagination">
        <button class="ct-btn ct-btn--secondary ct-sc-page-prev" ${this._currentPage===0?"disabled":""}>\u25C0 Prev</button>
        <span class="ct-sc-page-info">Page ${this._currentPage+1} of ${s}</span>
        <button class="ct-btn ct-btn--secondary ct-sc-page-next" ${this._currentPage>=s-1?"disabled":""}>Next \u25B6</button>
      </div>`:"";this._setBody(a+l+u),document.querySelectorAll(".ct-sc-table th[data-sort]").forEach(_=>{_.addEventListener("click",()=>{let x=_.getAttribute("data-sort");x!=="place"&&(this._currentSort.field===x?this._currentSort.dir=this._currentSort.dir==="asc"?"desc":"asc":this._currentSort={field:x,dir:"desc"},this._sortData(),this._currentPage=0,this._renderAll())})}),(p=document.querySelector(".ct-sc-page-prev"))==null||p.addEventListener("click",()=>{this._currentPage--,this._renderAll()}),(f=document.querySelector(".ct-sc-page-next"))==null||f.addEventListener("click",()=>{this._currentPage++,this._renderAll()})}_sortData(){let{field:t,dir:e}=this._currentSort,r=e==="asc"?1:-1;this._calculatedData.sort((a,i)=>{let n=parseFloat(String(a[t])),s=parseFloat(String(i[t]));return!isNaN(n)&&!isNaN(s)?(n-s)*r:String(a[t]||"").localeCompare(String(i[t]||""))*r})}_downloadAsImage(){var e;let t=this._calculatedData;if(!t.length){this._setStatus("\u26A0\uFE0F No data to capture. Fetch data first.");return}this._setStatus("\u23F3 Generating image\u2026");try{let a="Arial, sans-serif",p=((e=document.getElementById("ct-sc-week"))==null?void 0:e.value)||"",f=[{label:"#",w:36,get:(S,V)=>String(V+1),color:void 0},{label:"DA",w:180,get:S=>S.daName||S.transporterId,color:void 0},{label:"Status",w:90,get:S=>S.status,color:S=>xe(S.status)},{label:"Score",w:60,get:S=>S.totalScore.toFixed(2),color:void 0},{label:"Delivered",w:70,get:S=>String(Number(S.delivered).toLocaleString()),color:void 0},{label:"DCR",w:58,get:S=>S.dcr+"%",color:S=>Z(parseFloat(S.dcr),"DCR")},{label:"DNR DPMO",w:72,get:S=>String(parseInt(S.dnrDpmo,10)),color:S=>Z(parseFloat(S.dnrDpmo),"DNRDPMO")},{label:"LOR DPMO",w:72,get:S=>String(parseInt(S.lorDpmo,10)),color:S=>Z(parseFloat(S.lorDpmo),"LORDPMO")},{label:"POD",w:58,get:S=>S.pod+"%",color:S=>Z(parseFloat(S.pod),"POD")},{label:"CC",w:58,get:S=>S.cc+"%",color:S=>Z(parseFloat(S.cc),"CC")},{label:"CE",w:44,get:S=>String(parseInt(S.ce,10)),color:S=>Z(parseFloat(S.ce),"CE")},{label:"CDF DPMO",w:72,get:S=>String(parseInt(S.cdfDpmo,10)),color:S=>Z(parseFloat(S.cdfDpmo),"CDFDPMO")}],_=f.reduce((S,V)=>S+V.w,0),x=55+t.length*24,E=document.createElement("canvas");E.width=_*2,E.height=x*2;let w=E.getContext("2d");w.scale(2,2),w.fillStyle="#ffffff",w.fillRect(0,0,_,x),w.fillStyle="#232f3e",w.fillRect(0,0,_,32),w.fillStyle="#ff9900",w.font=`bold 14px ${a}`,w.textBaseline="middle",w.textAlign="left",w.fillText(`\u{1F4CB} Scorecard${p?" \u2014 "+p:""}`,8,32/2);let R=0;w.fillStyle="#232f3e",w.fillRect(0,32,_,23),w.font=`bold 11px ${a}`,w.fillStyle="#ff9900",w.textBaseline="middle";for(let S of f)w.textAlign="center",w.save(),w.beginPath(),w.rect(R,32,S.w,23),w.clip(),w.fillText(S.label,R+S.w/2,32+23/2),w.restore(),w.strokeStyle="#3d4f60",w.lineWidth=.5,w.beginPath(),w.moveTo(R,32),w.lineTo(R,55),w.stroke(),R+=S.w;w.font=`12px ${a}`,w.lineWidth=.5;for(let S=0;S<t.length;S++){let V=t[S],P=55+S*24;w.fillStyle=S%2===0?"#ffffff":"#f9f9f9",w.fillRect(0,P,_,24),w.strokeStyle="#dddddd",w.beginPath(),w.moveTo(0,P+24),w.lineTo(_,P+24),w.stroke(),R=0;for(let G of f){let g=G.get(V,S),y=G.color?G.color(V):"#111111";w.fillStyle=y,w.textBaseline="middle",w.textAlign="center",w.save(),w.beginPath(),w.rect(R+1,P,G.w-2,24),w.clip(),w.fillText(g,R+G.w/2,P+24/2),w.restore(),w.strokeStyle="#dddddd",w.beginPath(),w.moveTo(R,P),w.lineTo(R,P+24),w.stroke(),R+=G.w}}w.strokeStyle="#aaaaaa",w.lineWidth=1,w.strokeRect(0,0,_,x),E.toBlob(S=>{if(!S){this._setStatus("\u274C Image generation failed.");return}let V=URL.createObjectURL(S),P=document.createElement("a");P.href=V,P.download=`scorecard_${p||"export"}.png`,P.click(),URL.revokeObjectURL(V),this._setStatus("\u2705 Image downloaded.")},"image/png")}catch(r){$("Scorecard image download failed:",r),this._setStatus("\u274C Image generation failed: "+r.message)}}_exportCSV(){var n;if(!this._calculatedData.length){this._setStatus("\u26A0\uFE0F No data to export.");return}let e=[["Place","DA","Status","Total Score","Delivered","DCR","DNR DPMO","LOR DPMO","POD","CC","CE","CDF DPMO","Station","DSP"].join(";")];this._calculatedData.forEach((s,c)=>{e.push([c+1,s.daName||s.transporterId,s.status,s.totalScore.toFixed(2),s.delivered,s.dcr,parseInt(s.dnrDpmo,10),parseInt(s.lorDpmo,10),s.pod,s.cc,parseInt(s.ce,10),parseInt(s.cdfDpmo,10),s.stationCode,s.dspCode].join(";"))});let r=new Blob(["\uFEFF"+e.join(`
`)],{type:"text/csv;charset=utf-8;"}),a=URL.createObjectURL(r),i=document.createElement("a");i.href=a,i.download=`scorecard_${((n=document.getElementById("ct-sc-week"))==null?void 0:n.value)||"data"}.csv`,i.click(),URL.revokeObjectURL(a),this._setStatus("\u2705 CSV exported.")}};var tt=function(o,t){let a=o,i=nt[t],n=null,s=0,c=null,d=[],l={},u=function(g,y){s=a*4+17,n=function(h){let b=new Array(h);for(let v=0;v<h;v+=1){b[v]=new Array(h);for(let D=0;D<h;D+=1)b[v][D]=null}return b}(s),p(0,0),p(s-7,0),p(0,s-7),x(),_(),w(g,y),a>=7&&E(g),c==null&&(c=V(a,i,d)),R(c,y)},p=function(g,y){for(let h=-1;h<=7;h+=1)if(!(g+h<=-1||s<=g+h))for(let b=-1;b<=7;b+=1)y+b<=-1||s<=y+b||(0<=h&&h<=6&&(b==0||b==6)||0<=b&&b<=6&&(h==0||h==6)||2<=h&&h<=4&&2<=b&&b<=4?n[g+h][y+b]=!0:n[g+h][y+b]=!1)},f=function(){let g=0,y=0;for(let h=0;h<8;h+=1){u(!0,h);let b=K.getLostPoint(l);(h==0||g>b)&&(g=b,y=h)}return y},_=function(){for(let g=8;g<s-8;g+=1)n[g][6]==null&&(n[g][6]=g%2==0);for(let g=8;g<s-8;g+=1)n[6][g]==null&&(n[6][g]=g%2==0)},x=function(){let g=K.getPatternPosition(a);for(let y=0;y<g.length;y+=1)for(let h=0;h<g.length;h+=1){let b=g[y],v=g[h];if(n[b][v]==null)for(let D=-2;D<=2;D+=1)for(let k=-2;k<=2;k+=1)D==-2||D==2||k==-2||k==2||D==0&&k==0?n[b+D][v+k]=!0:n[b+D][v+k]=!1}},E=function(g){let y=K.getBCHTypeNumber(a);for(let h=0;h<18;h+=1){let b=!g&&(y>>h&1)==1;n[Math.floor(h/3)][h%3+s-8-3]=b}for(let h=0;h<18;h+=1){let b=!g&&(y>>h&1)==1;n[h%3+s-8-3][Math.floor(h/3)]=b}},w=function(g,y){let h=i<<3|y,b=K.getBCHTypeInfo(h);for(let v=0;v<15;v+=1){let D=!g&&(b>>v&1)==1;v<6?n[v][8]=D:v<8?n[v+1][8]=D:n[s-15+v][8]=D}for(let v=0;v<15;v+=1){let D=!g&&(b>>v&1)==1;v<8?n[8][s-v-1]=D:v<9?n[8][15-v-1+1]=D:n[8][15-v-1]=D}n[s-8][8]=!g},R=function(g,y){let h=-1,b=s-1,v=7,D=0,k=K.getMaskFunction(y);for(let I=s-1;I>0;I-=2)for(I==6&&(I-=1);;){for(let A=0;A<2;A+=1)if(n[b][I-A]==null){let M=!1;D<g.length&&(M=(g[D]>>>v&1)==1),k(b,I-A)&&(M=!M),n[b][I-A]=M,v-=1,v==-1&&(D+=1,v=7)}if(b+=h,b<0||s<=b){b-=h,h=-h;break}}},S=function(g,y){let h=0,b=0,v=0,D=new Array(y.length),k=new Array(y.length);for(let T=0;T<y.length;T+=1){let L=y[T].dataCount,O=y[T].totalCount-L;b=Math.max(b,L),v=Math.max(v,O),D[T]=new Array(L);for(let W=0;W<D[T].length;W+=1)D[T][W]=255&g.getBuffer()[W+h];h+=L;let bt=K.getErrorCorrectPolynomial(O),$t=at(D[T],bt.getLength()-1).mod(bt);k[T]=new Array(bt.getLength()-1);for(let W=0;W<k[T].length;W+=1){let It=W+$t.getLength()-k[T].length;k[T][W]=It>=0?$t.getAt(It):0}}let I=0;for(let T=0;T<y.length;T+=1)I+=y[T].totalCount;let A=new Array(I),M=0;for(let T=0;T<b;T+=1)for(let L=0;L<y.length;L+=1)T<D[L].length&&(A[M]=D[L][T],M+=1);for(let T=0;T<v;T+=1)for(let L=0;L<y.length;L+=1)T<k[L].length&&(A[M]=k[L][T],M+=1);return A},V=function(g,y,h){let b=ee.getRSBlocks(g,y),v=re();for(let k=0;k<h.length;k+=1){let I=h[k];v.put(I.getMode(),4),v.put(I.getLength(),K.getLengthInBits(I.getMode(),g)),I.write(v)}let D=0;for(let k=0;k<b.length;k+=1)D+=b[k].dataCount;if(v.getLengthInBits()>D*8)throw"code length overflow. ("+v.getLengthInBits()+">"+D*8+")";for(v.getLengthInBits()+4<=D*8&&v.put(0,4);v.getLengthInBits()%8!=0;)v.putBit(!1);for(;!(v.getLengthInBits()>=D*8||(v.put(236,8),v.getLengthInBits()>=D*8));)v.put(17,8);return S(v,b)};l.addData=function(g,y){y=y||"Byte";let h=null;switch(y){case"Numeric":h=De(g);break;case"Alphanumeric":h=Se(g);break;case"Byte":h=ke(g);break;case"Kanji":h=Ee(g);break;default:throw"mode:"+y}d.push(h),c=null},l.isDark=function(g,y){if(g<0||s<=g||y<0||s<=y)throw g+","+y;return n[g][y]},l.getModuleCount=function(){return s},l.make=function(){if(a<1){let g=1;for(;g<40;g++){let y=ee.getRSBlocks(g,i),h=re();for(let v=0;v<d.length;v++){let D=d[v];h.put(D.getMode(),4),h.put(D.getLength(),K.getLengthInBits(D.getMode(),g)),D.write(h)}let b=0;for(let v=0;v<y.length;v++)b+=y[v].dataCount;if(h.getLengthInBits()<=b*8)break}a=g}u(!1,f())},l.createTableTag=function(g,y){g=g||2,y=typeof y>"u"?g*4:y;let h="";h+='<table style="',h+=" border-width: 0px; border-style: none;",h+=" border-collapse: collapse;",h+=" padding: 0px; margin: "+y+"px;",h+='">',h+="<tbody>";for(let b=0;b<l.getModuleCount();b+=1){h+="<tr>";for(let v=0;v<l.getModuleCount();v+=1)h+='<td style="',h+=" border-width: 0px; border-style: none;",h+=" border-collapse: collapse;",h+=" padding: 0px; margin: 0px;",h+=" width: "+g+"px;",h+=" height: "+g+"px;",h+=" background-color: ",h+=l.isDark(b,v)?"#000000":"#ffffff",h+=";",h+='"/>';h+="</tr>"}return h+="</tbody>",h+="</table>",h},l.createSvgTag=function(g,y,h,b){let v={};typeof arguments[0]=="object"&&(v=arguments[0],g=v.cellSize,y=v.margin,h=v.alt,b=v.title),g=g||2,y=typeof y>"u"?g*4:y,h=typeof h=="string"?{text:h}:h||{},h.text=h.text||null,h.id=h.text?h.id||"qrcode-description":null,b=typeof b=="string"?{text:b}:b||{},b.text=b.text||null,b.id=b.text?b.id||"qrcode-title":null;let D=l.getModuleCount()*g+y*2,k,I,A,M,T="",L;for(L="l"+g+",0 0,"+g+" -"+g+",0 0,-"+g+"z ",T+='<svg version="1.1" xmlns="http://www.w3.org/2000/svg"',T+=v.scalable?"":' width="'+D+'px" height="'+D+'px"',T+=' viewBox="0 0 '+D+" "+D+'" ',T+=' preserveAspectRatio="xMinYMin meet"',T+=b.text||h.text?' role="img" aria-labelledby="'+P([b.id,h.id].join(" ").trim())+'"':"",T+=">",T+=b.text?'<title id="'+P(b.id)+'">'+P(b.text)+"</title>":"",T+=h.text?'<description id="'+P(h.id)+'">'+P(h.text)+"</description>":"",T+='<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>',T+='<path d="',A=0;A<l.getModuleCount();A+=1)for(M=A*g+y,k=0;k<l.getModuleCount();k+=1)l.isDark(A,k)&&(I=k*g+y,T+="M"+I+","+M+L);return T+='" stroke="transparent" fill="black"/>',T+="</svg>",T},l.createDataURL=function(g,y){g=g||2,y=typeof y>"u"?g*4:y;let h=l.getModuleCount()*g+y*2,b=y,v=h-y;return Ie(h,h,function(D,k){if(b<=D&&D<v&&b<=k&&k<v){let I=Math.floor((D-b)/g),A=Math.floor((k-b)/g);return l.isDark(A,I)?0:1}else return 1})},l.createImgTag=function(g,y,h){g=g||2,y=typeof y>"u"?g*4:y;let b=l.getModuleCount()*g+y*2,v="";return v+="<img",v+=' src="',v+=l.createDataURL(g,y),v+='"',v+=' width="',v+=b,v+='"',v+=' height="',v+=b,v+='"',h&&(v+=' alt="',v+=P(h),v+='"'),v+="/>",v};let P=function(g){let y="";for(let h=0;h<g.length;h+=1){let b=g.charAt(h);switch(b){case"<":y+="&lt;";break;case">":y+="&gt;";break;case"&":y+="&amp;";break;case'"':y+="&quot;";break;default:y+=b;break}}return y},G=function(g){g=typeof g>"u"?1*2:g;let h=l.getModuleCount()*1+g*2,b=g,v=h-g,D,k,I,A,M,T={"\u2588\u2588":"\u2588","\u2588 ":"\u2580"," \u2588":"\u2584","  ":" "},L={"\u2588\u2588":"\u2580","\u2588 ":"\u2580"," \u2588":" ","  ":" "},O="";for(D=0;D<h;D+=2){for(I=Math.floor((D-b)/1),A=Math.floor((D+1-b)/1),k=0;k<h;k+=1)M="\u2588",b<=k&&k<v&&b<=D&&D<v&&l.isDark(I,Math.floor((k-b)/1))&&(M=" "),b<=k&&k<v&&b<=D+1&&D+1<v&&l.isDark(A,Math.floor((k-b)/1))?M+=" ":M+="\u2588",O+=g<1&&D+1>=v?L[M]:T[M];O+=`
`}return h%2&&g>0?O.substring(0,O.length-h-1)+Array(h+1).join("\u2580"):O.substring(0,O.length-1)};return l.createASCII=function(g,y){if(g=g||1,g<2)return G(y);g-=1,y=typeof y>"u"?g*2:y;let h=l.getModuleCount()*g+y*2,b=y,v=h-y,D,k,I,A,M=Array(g+1).join("\u2588\u2588"),T=Array(g+1).join("  "),L="",O="";for(D=0;D<h;D+=1){for(I=Math.floor((D-b)/g),O="",k=0;k<h;k+=1)A=1,b<=k&&k<v&&b<=D&&D<v&&l.isDark(I,Math.floor((k-b)/g))&&(A=0),O+=A?M:T;for(I=0;I<g;I+=1)L+=O+`
`}return L.substring(0,L.length-1)},l.renderTo2dContext=function(g,y){y=y||2;let h=l.getModuleCount();for(let b=0;b<h;b++)for(let v=0;v<h;v++)g.fillStyle=l.isDark(b,v)?"black":"white",g.fillRect(v*y,b*y,y,y)},l};tt.stringToBytes=function(o){let t=[];for(let e=0;e<o.length;e+=1){let r=o.charCodeAt(e);t.push(r&255)}return t};tt.createStringToBytes=function(o,t){let e=function(){let a=Te(o),i=function(){let c=a.read();if(c==-1)throw"eof";return c},n=0,s={};for(;;){let c=a.read();if(c==-1)break;let d=i(),l=i(),u=i(),p=String.fromCharCode(c<<8|d),f=l<<8|u;s[p]=f,n+=1}if(n!=t)throw n+" != "+t;return s}(),r=63;return function(a){let i=[];for(let n=0;n<a.length;n+=1){let s=a.charCodeAt(n);if(s<128)i.push(s);else{let c=e[a.charAt(n)];typeof c=="number"?(c&255)==c?i.push(c):(i.push(c>>>8),i.push(c&255)):i.push(r)}}return i}};var H={MODE_NUMBER:1,MODE_ALPHA_NUM:2,MODE_8BIT_BYTE:4,MODE_KANJI:8},nt={L:1,M:0,Q:3,H:2},Q={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7},K=function(){let o=[[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]],t=1335,e=7973,r=21522,a={},i=function(n){let s=0;for(;n!=0;)s+=1,n>>>=1;return s};return a.getBCHTypeInfo=function(n){let s=n<<10;for(;i(s)-i(t)>=0;)s^=t<<i(s)-i(t);return(n<<10|s)^r},a.getBCHTypeNumber=function(n){let s=n<<12;for(;i(s)-i(e)>=0;)s^=e<<i(s)-i(e);return n<<12|s},a.getPatternPosition=function(n){return o[n-1]},a.getMaskFunction=function(n){switch(n){case Q.PATTERN000:return function(s,c){return(s+c)%2==0};case Q.PATTERN001:return function(s,c){return s%2==0};case Q.PATTERN010:return function(s,c){return c%3==0};case Q.PATTERN011:return function(s,c){return(s+c)%3==0};case Q.PATTERN100:return function(s,c){return(Math.floor(s/2)+Math.floor(c/3))%2==0};case Q.PATTERN101:return function(s,c){return s*c%2+s*c%3==0};case Q.PATTERN110:return function(s,c){return(s*c%2+s*c%3)%2==0};case Q.PATTERN111:return function(s,c){return(s*c%3+(s+c)%2)%2==0};default:throw"bad maskPattern:"+n}},a.getErrorCorrectPolynomial=function(n){let s=at([1],0);for(let c=0;c<n;c+=1)s=s.multiply(at([1,Y.gexp(c)],0));return s},a.getLengthInBits=function(n,s){if(1<=s&&s<10)switch(n){case H.MODE_NUMBER:return 10;case H.MODE_ALPHA_NUM:return 9;case H.MODE_8BIT_BYTE:return 8;case H.MODE_KANJI:return 8;default:throw"mode:"+n}else if(s<27)switch(n){case H.MODE_NUMBER:return 12;case H.MODE_ALPHA_NUM:return 11;case H.MODE_8BIT_BYTE:return 16;case H.MODE_KANJI:return 10;default:throw"mode:"+n}else if(s<41)switch(n){case H.MODE_NUMBER:return 14;case H.MODE_ALPHA_NUM:return 13;case H.MODE_8BIT_BYTE:return 16;case H.MODE_KANJI:return 12;default:throw"mode:"+n}else throw"type:"+s},a.getLostPoint=function(n){let s=n.getModuleCount(),c=0;for(let u=0;u<s;u+=1)for(let p=0;p<s;p+=1){let f=0,_=n.isDark(u,p);for(let x=-1;x<=1;x+=1)if(!(u+x<0||s<=u+x))for(let E=-1;E<=1;E+=1)p+E<0||s<=p+E||x==0&&E==0||_==n.isDark(u+x,p+E)&&(f+=1);f>5&&(c+=3+f-5)}for(let u=0;u<s-1;u+=1)for(let p=0;p<s-1;p+=1){let f=0;n.isDark(u,p)&&(f+=1),n.isDark(u+1,p)&&(f+=1),n.isDark(u,p+1)&&(f+=1),n.isDark(u+1,p+1)&&(f+=1),(f==0||f==4)&&(c+=3)}for(let u=0;u<s;u+=1)for(let p=0;p<s-6;p+=1)n.isDark(u,p)&&!n.isDark(u,p+1)&&n.isDark(u,p+2)&&n.isDark(u,p+3)&&n.isDark(u,p+4)&&!n.isDark(u,p+5)&&n.isDark(u,p+6)&&(c+=40);for(let u=0;u<s;u+=1)for(let p=0;p<s-6;p+=1)n.isDark(p,u)&&!n.isDark(p+1,u)&&n.isDark(p+2,u)&&n.isDark(p+3,u)&&n.isDark(p+4,u)&&!n.isDark(p+5,u)&&n.isDark(p+6,u)&&(c+=40);let d=0;for(let u=0;u<s;u+=1)for(let p=0;p<s;p+=1)n.isDark(p,u)&&(d+=1);let l=Math.abs(100*d/s/s-50)/5;return c+=l*10,c},a}(),Y=function(){let o=new Array(256),t=new Array(256);for(let r=0;r<8;r+=1)o[r]=1<<r;for(let r=8;r<256;r+=1)o[r]=o[r-4]^o[r-5]^o[r-6]^o[r-8];for(let r=0;r<255;r+=1)t[o[r]]=r;let e={};return e.glog=function(r){if(r<1)throw"glog("+r+")";return t[r]},e.gexp=function(r){for(;r<0;)r+=255;for(;r>=256;)r-=255;return o[r]},e}(),at=function(o,t){if(typeof o.length>"u")throw o.length+"/"+t;let e=function(){let a=0;for(;a<o.length&&o[a]==0;)a+=1;let i=new Array(o.length-a+t);for(let n=0;n<o.length-a;n+=1)i[n]=o[n+a];return i}(),r={};return r.getAt=function(a){return e[a]},r.getLength=function(){return e.length},r.multiply=function(a){let i=new Array(r.getLength()+a.getLength()-1);for(let n=0;n<r.getLength();n+=1)for(let s=0;s<a.getLength();s+=1)i[n+s]^=Y.gexp(Y.glog(r.getAt(n))+Y.glog(a.getAt(s)));return at(i,0)},r.mod=function(a){if(r.getLength()-a.getLength()<0)return r;let i=Y.glog(r.getAt(0))-Y.glog(a.getAt(0)),n=new Array(r.getLength());for(let s=0;s<r.getLength();s+=1)n[s]=r.getAt(s);for(let s=0;s<a.getLength();s+=1)n[s]^=Y.gexp(Y.glog(a.getAt(s))+i);return at(n,0).mod(a)},r},ee=function(){let o=[[1,26,19],[1,26,16],[1,26,13],[1,26,9],[1,44,34],[1,44,28],[1,44,22],[1,44,16],[1,70,55],[1,70,44],[2,35,17],[2,35,13],[1,100,80],[2,50,32],[2,50,24],[4,25,9],[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],[2,86,68],[4,43,27],[4,43,19],[4,43,15],[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17],[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13],[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]],t=function(a,i){let n={};return n.totalCount=a,n.dataCount=i,n},e={},r=function(a,i){switch(i){case nt.L:return o[(a-1)*4+0];case nt.M:return o[(a-1)*4+1];case nt.Q:return o[(a-1)*4+2];case nt.H:return o[(a-1)*4+3];default:return}};return e.getRSBlocks=function(a,i){let n=r(a,i);if(typeof n>"u")throw"bad rs block @ typeNumber:"+a+"/errorCorrectionLevel:"+i;let s=n.length/3,c=[];for(let d=0;d<s;d+=1){let l=n[d*3+0],u=n[d*3+1],p=n[d*3+2];for(let f=0;f<l;f+=1)c.push(t(u,p))}return c},e}(),re=function(){let o=[],t=0,e={};return e.getBuffer=function(){return o},e.getAt=function(r){let a=Math.floor(r/8);return(o[a]>>>7-r%8&1)==1},e.put=function(r,a){for(let i=0;i<a;i+=1)e.putBit((r>>>a-i-1&1)==1)},e.getLengthInBits=function(){return t},e.putBit=function(r){let a=Math.floor(t/8);o.length<=a&&o.push(0),r&&(o[a]|=128>>>t%8),t+=1},e},De=function(o){let t=H.MODE_NUMBER,e=o,r={};r.getMode=function(){return t},r.getLength=function(n){return e.length},r.write=function(n){let s=e,c=0;for(;c+2<s.length;)n.put(a(s.substring(c,c+3)),10),c+=3;c<s.length&&(s.length-c==1?n.put(a(s.substring(c,c+1)),4):s.length-c==2&&n.put(a(s.substring(c,c+2)),7))};let a=function(n){let s=0;for(let c=0;c<n.length;c+=1)s=s*10+i(n.charAt(c));return s},i=function(n){if("0"<=n&&n<="9")return n.charCodeAt(0)-48;throw"illegal char :"+n};return r},Se=function(o){let t=H.MODE_ALPHA_NUM,e=o,r={};r.getMode=function(){return t},r.getLength=function(i){return e.length},r.write=function(i){let n=e,s=0;for(;s+1<n.length;)i.put(a(n.charAt(s))*45+a(n.charAt(s+1)),11),s+=2;s<n.length&&i.put(a(n.charAt(s)),6)};let a=function(i){if("0"<=i&&i<="9")return i.charCodeAt(0)-48;if("A"<=i&&i<="Z")return i.charCodeAt(0)-65+10;switch(i){case" ":return 36;case"$":return 37;case"%":return 38;case"*":return 39;case"+":return 40;case"-":return 41;case".":return 42;case"/":return 43;case":":return 44;default:throw"illegal char :"+i}};return r},ke=function(o){let t=H.MODE_8BIT_BYTE,e=o,r=tt.stringToBytes(o),a={};return a.getMode=function(){return t},a.getLength=function(i){return r.length},a.write=function(i){for(let n=0;n<r.length;n+=1)i.put(r[n],8)},a},Ee=function(o){let t=H.MODE_KANJI,e=o,r=tt.stringToBytes;(function(n,s){let c=r(n);if(c.length!=2||(c[0]<<8|c[1])!=s)throw"sjis not supported."})("\u53CB",38726);let a=r(o),i={};return i.getMode=function(){return t},i.getLength=function(n){return~~(a.length/2)},i.write=function(n){let s=a,c=0;for(;c+1<s.length;){let d=(255&s[c])<<8|255&s[c+1];if(33088<=d&&d<=40956)d-=33088;else if(57408<=d&&d<=60351)d-=49472;else throw"illegal char at "+(c+1)+"/"+d;d=(d>>>8&255)*192+(d&255),n.put(d,13),c+=2}if(c<s.length)throw"illegal char at "+(c+1)},i},ne=function(){let o=[],t={};return t.writeByte=function(e){o.push(e&255)},t.writeShort=function(e){t.writeByte(e),t.writeByte(e>>>8)},t.writeBytes=function(e,r,a){r=r||0,a=a||e.length;for(let i=0;i<a;i+=1)t.writeByte(e[i+r])},t.writeString=function(e){for(let r=0;r<e.length;r+=1)t.writeByte(e.charCodeAt(r))},t.toByteArray=function(){return o},t.toString=function(){let e="";e+="[";for(let r=0;r<o.length;r+=1)r>0&&(e+=","),e+=o[r];return e+="]",e},t},Ce=function(){let o=0,t=0,e=0,r="",a={},i=function(s){r+=String.fromCharCode(n(s&63))},n=function(s){if(s<0)throw"n:"+s;if(s<26)return 65+s;if(s<52)return 97+(s-26);if(s<62)return 48+(s-52);if(s==62)return 43;if(s==63)return 47;throw"n:"+s};return a.writeByte=function(s){for(o=o<<8|s&255,t+=8,e+=1;t>=6;)i(o>>>t-6),t-=6},a.flush=function(){if(t>0&&(i(o<<6-t),o=0,t=0),e%3!=0){let s=3-e%3;for(let c=0;c<s;c+=1)r+="="}},a.toString=function(){return r},a},Te=function(o){let t=o,e=0,r=0,a=0,i={};i.read=function(){for(;a<8;){if(e>=t.length){if(a==0)return-1;throw"unexpected end of file./"+a}let c=t.charAt(e);if(e+=1,c=="=")return a=0,-1;if(c.match(/^\s$/))continue;r=r<<6|n(c.charCodeAt(0)),a+=6}let s=r>>>a-8&255;return a-=8,s};let n=function(s){if(65<=s&&s<=90)return s-65;if(97<=s&&s<=122)return s-97+26;if(48<=s&&s<=57)return s-48+52;if(s==43)return 62;if(s==47)return 63;throw"c:"+s};return i},$e=function(o,t){let e=o,r=t,a=new Array(o*t),i={};i.setPixel=function(d,l,u){a[l*e+d]=u},i.write=function(d){d.writeString("GIF87a"),d.writeShort(e),d.writeShort(r),d.writeByte(128),d.writeByte(0),d.writeByte(0),d.writeByte(0),d.writeByte(0),d.writeByte(0),d.writeByte(255),d.writeByte(255),d.writeByte(255),d.writeString(","),d.writeShort(0),d.writeShort(0),d.writeShort(e),d.writeShort(r),d.writeByte(0);let l=2,u=s(l);d.writeByte(l);let p=0;for(;u.length-p>255;)d.writeByte(255),d.writeBytes(u,p,255),p+=255;d.writeByte(u.length-p),d.writeBytes(u,p,u.length-p),d.writeByte(0),d.writeString(";")};let n=function(d){let l=d,u=0,p=0,f={};return f.write=function(_,x){if(_>>>x)throw"length over";for(;u+x>=8;)l.writeByte(255&(_<<u|p)),x-=8-u,_>>>=8-u,p=0,u=0;p=_<<u|p,u=u+x},f.flush=function(){u>0&&l.writeByte(p)},f},s=function(d){let l=1<<d,u=(1<<d)+1,p=d+1,f=c();for(let R=0;R<l;R+=1)f.add(String.fromCharCode(R));f.add(String.fromCharCode(l)),f.add(String.fromCharCode(u));let _=ne(),x=n(_);x.write(l,p);let E=0,w=String.fromCharCode(a[E]);for(E+=1;E<a.length;){let R=String.fromCharCode(a[E]);E+=1,f.contains(w+R)?w=w+R:(x.write(f.indexOf(w),p),f.size()<4095&&(f.size()==1<<p&&(p+=1),f.add(w+R)),w=R)}return x.write(f.indexOf(w),p),x.write(u,p),x.flush(),_.toByteArray()},c=function(){let d={},l=0,u={};return u.add=function(p){if(u.contains(p))throw"dup key:"+p;d[p]=l,l+=1},u.size=function(){return l},u.indexOf=function(p){return d[p]},u.contains=function(p){return typeof d[p]<"u"},u};return i},Ie=function(o,t,e){let r=$e(o,t);for(let s=0;s<t;s+=1)for(let c=0;c<o;c+=1)r.setPixel(c,s,e(c,s));let a=ne();r.write(a);let i=Ce(),n=a.toByteArray();for(let s=0;s<n.length;s+=1)i.writeByte(n[s]);return i.flush(),"data:image/gif;base64,"+i},ae=tt,or=tt.stringToBytes;var mt=class{constructor(t,e){this.config=t;this.companyConfig=e}_overlayEl=null;_active=!1;_vehicles=[];_selectedVins=new Set;_loading=!1;_pageSize=25;_currentPage=1;_searchTerm="";_searchTimer=null;_sortColumn=null;_sortAsc=!0;init(){if(this._overlayEl)return;let t=document.createElement("div");t.id="ct-vsa-overlay",t.className="ct-overlay",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.setAttribute("aria-label","VSA QR Code Generator"),t.innerHTML=`
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
    `,document.body.appendChild(t),this._overlayEl=t,t.addEventListener("click",r=>{r.target===t&&this.hide()}),document.getElementById("ct-vsa-close").addEventListener("click",()=>this.hide()),document.getElementById("ct-vsa-print").addEventListener("click",()=>this._printSelected());let e=document.getElementById("ct-vsa-search");e.addEventListener("input",()=>{this._searchTimer&&clearTimeout(this._searchTimer),this._searchTimer=setTimeout(()=>{this._searchTerm=e.value.trim().toLowerCase(),this._currentPage=1,this._renderBody()},300)}),t.addEventListener("keydown",r=>{r.key==="Escape"&&this.hide()}),B(()=>this.dispose()),C("VSA QR Generator initialized")}dispose(){var t;this._searchTimer&&clearTimeout(this._searchTimer),(t=this._overlayEl)==null||t.remove(),this._overlayEl=null,this._vehicles=[],this._selectedVins.clear(),this._active=!1,this._loading=!1}toggle(){if(!this.config.features.vsaQr){alert("VSA QR Code Generator ist deaktiviert. Bitte in den Einstellungen aktivieren.");return}this.init(),this._active?this.hide():this.show()}show(){this.init(),this._overlayEl.classList.add("visible"),this._active=!0,this._currentPage=1,this._searchTerm="",this._sortColumn=null,this._sortAsc=!0;let t=document.getElementById("ct-vsa-search");t&&(t.value=""),this._refresh()}hide(){var t;(t=this._overlayEl)==null||t.classList.remove("visible"),this._active=!1}async _fetchVehicles(){let t="https://logistics.amazon.de/fleet-management/api/vehicles?vehicleStatuses=ACTIVE,MAINTENANCE,PENDING",e=N(),r={Accept:"application/json"};return e&&(r["anti-csrftoken-a2z"]=e),(await U(async()=>{let i=await fetch(t,{method:"GET",headers:r,credentials:"include"});if(!i.ok)throw new Error(`HTTP ${i.status}: ${i.statusText}`);return i},{retries:2,baseMs:800})).json()}_processResponse(t){if(!t||typeof t!="object")return[];let e;if(Array.isArray(t))e=t;else{let r=t,a=r.vehicles??r.data??r.content;if(Array.isArray(a)&&a.length>0)e=a;else{e=[];for(let i of Object.values(r))if(Array.isArray(i)&&i.length>0){e=i;break}}}return Array.isArray(e)?e.map(r=>{if(!r||typeof r!="object")return null;let a=r,i=String(a.vin??"").trim(),n=String(a.registrationNo??a.licensePlate??a.registration_no??"").trim(),s=a.serviceStation,c=String(a.stationCode??(s==null?void 0:s.stationCode)??a.station_code??a.station??"").trim(),d=String(a.vehicleStatus??a.status??"ACTIVE").trim();return i?{vin:i,registrationNo:n,stationCode:c,status:d}:null}).filter(r=>r!==null):[]}async _refresh(){var t;if(!this._loading){this._loading=!0,this._vehicles=[],this._selectedVins.clear(),this._setStatus("\u23F3 Lade Fahrzeugdaten\u2026"),this._setTiles(""),this._setBody('<div class="ct-vsa-loading" role="status">Fahrzeugdaten werden geladen\u2026</div>'),this._updateFooter();try{let e=await this._fetchVehicles(),r=this._processResponse(e);if(r.length===0){this._setBody('<div class="ct-vsa-empty">Keine Fahrzeuge gefunden.</div>'),this._setStatus("\u26A0\uFE0F Keine Fahrzeuge verf\xFCgbar."),this._loading=!1;return}this._vehicles=r;for(let i of r)this._selectedVins.add(i.vin);this._setStatus(`\u2705 ${r.length} Fahrzeuge geladen`);let a=document.getElementById("ct-vsa-asof");if(a){let i=new Date().toLocaleString("de-DE",{timeZone:"Europe/Berlin",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});a.textContent=`Stand: ${i}`}this._renderTiles(),this._renderBody(),this._updateFooter()}catch(e){$("VSA QR vehicle fetch failed:",e),this._setBody(`<div class="ct-vsa-error" role="alert">
        \u274C Fahrzeugdaten konnten nicht geladen werden.<br>
        <small>${m(e.message)}</small><br><br>
        <button class="ct-btn ct-btn--accent" id="ct-vsa-retry">\u{1F504} Erneut versuchen</button>
      </div>`),this._setStatus("\u274C Fehler beim Laden."),(t=document.getElementById("ct-vsa-retry"))==null||t.addEventListener("click",()=>this._refresh())}finally{this._loading=!1}}}_setStatus(t){let e=document.getElementById("ct-vsa-status");e&&(e.textContent=t)}_setBody(t){let e=document.getElementById("ct-vsa-body");e&&(e.innerHTML=t)}_setTiles(t){let e=document.getElementById("ct-vsa-tiles");e&&(e.innerHTML=t)}_getFilteredVehicles(){let t=this._vehicles;if(this._searchTerm){let e=this._searchTerm;t=t.filter(r=>r.registrationNo.toLowerCase().includes(e)||r.vin.toLowerCase().includes(e)||r.stationCode.toLowerCase().includes(e)||r.status.toLowerCase().includes(e))}if(this._sortColumn){let e=this._sortColumn,r=this._sortAsc?1:-1;t=[...t].sort((a,i)=>a[e].localeCompare(i[e])*r)}return t}_renderTiles(){let t=this._vehicles.length,e=this._selectedVins.size,r=new Set(this._vehicles.map(a=>a.stationCode)).size;this._setTiles(`
      <div class="ct-vsa-tiles">
        <div class="ct-vsa-tile">
          <div class="ct-vsa-tile-val">${t}</div>
          <div class="ct-vsa-tile-lbl">Fahrzeuge gesamt</div>
        </div>
        <div class="ct-vsa-tile ct-vsa-tile--accent">
          <div class="ct-vsa-tile-val">${e}</div>
          <div class="ct-vsa-tile-lbl">Ausgew\xE4hlt</div>
        </div>
        <div class="ct-vsa-tile">
          <div class="ct-vsa-tile-val">${r}</div>
          <div class="ct-vsa-tile-lbl">Stationen</div>
        </div>
        <div class="ct-vsa-tile">
          <div class="ct-vsa-tile-val">${m(this.companyConfig.getDspCode())}</div>
          <div class="ct-vsa-tile-lbl">DSP Shortcode</div>
        </div>
      </div>
    `)}_renderBody(){var d;if(!this._overlayEl)return;if(this._vehicles.length===0){this._setBody('<div class="ct-vsa-empty">Keine Fahrzeuge verf\xFCgbar.</div>');return}let t=this._getFilteredVehicles(),e=t.length,r=Math.ceil(e/this._pageSize);this._currentPage>r&&(this._currentPage=r||1);let a=(this._currentPage-1)*this._pageSize,i=t.slice(a,a+this._pageSize),n=i.length>0&&i.every(l=>this._selectedVins.has(l.vin)),s=l=>this._sortColumn!==l?" \u2195":this._sortAsc?" \u2191":" \u2193",c=i.map((l,u)=>{let p=this._selectedVins.has(l.vin),f=a+u+1,_=l.status==="ACTIVE"?"ct-vsa-status--active":l.status==="MAINTENANCE"?"ct-vsa-status--maintenance":"ct-vsa-status--pending";return`<tr class="${p?"ct-vsa-row--selected":""}" role="row">
        <td class="ct-vsa-td-check">
          <input type="checkbox" class="ct-vsa-check" data-vin="${m(l.vin)}"
                 ${p?"checked":""} aria-label="Fahrzeug ${m(l.registrationNo)} ausw\xE4hlen">
        </td>
        <td>${f}</td>
        <td>${m(l.stationCode)}</td>
        <td><strong>${m(l.registrationNo)}</strong></td>
        <td class="ct-vsa-td-vin">${m(l.vin)}</td>
        <td><span class="${_}">${m(l.status)}</span></td>
      </tr>`}).join("");this._setBody(`
      <div class="ct-vsa-table-wrap">
        <table class="ct-table ct-vsa-table" role="grid">
          <thead><tr>
            <th scope="col" class="ct-vsa-th-check">
              <input type="checkbox" id="ct-vsa-select-all" ${n?"checked":""}
                     aria-label="Alle sichtbaren Fahrzeuge ausw\xE4hlen">
            </th>
            <th scope="col">#</th>
            <th scope="col">Station</th>
            <th scope="col" class="ct-vsa-th-sortable" data-sort="registrationNo">Kennzeichen${s("registrationNo")}</th>
            <th scope="col" class="ct-vsa-th-sortable" data-sort="vin">VIN${s("vin")}</th>
            <th scope="col">Status</th>
          </tr></thead>
          <tbody>${c||'<tr><td colspan="6" class="ct-vsa-empty">Keine Treffer f\xFCr den Suchbegriff.</td></tr>'}</tbody>
        </table>
      </div>
      ${this._renderPagination(e,this._currentPage,r)}
    `),(d=document.getElementById("ct-vsa-select-all"))==null||d.addEventListener("change",l=>{let u=l.target.checked,p=i.map(f=>f.vin);for(let f of p)u?this._selectedVins.add(f):this._selectedVins.delete(f);this._renderTiles(),this._renderBody(),this._updateFooter()}),this._overlayEl.querySelectorAll(".ct-vsa-check").forEach(l=>{l.addEventListener("change",u=>{let p=u.target,f=p.dataset.vin;p.checked?this._selectedVins.add(f):this._selectedVins.delete(f),this._renderTiles(),this._updateFooter();let _=document.getElementById("ct-vsa-select-all");_&&(_.checked=i.every(x=>this._selectedVins.has(x.vin)))})}),this._overlayEl.querySelectorAll(".ct-vsa-th-sortable").forEach(l=>{l.addEventListener("click",()=>{let u=l.dataset.sort;this._sortColumn===u?this._sortAsc=!this._sortAsc:(this._sortColumn=u,this._sortAsc=!0),this._currentPage=1,this._renderBody()})}),this._attachPaginationHandlers()}_renderPagination(t,e,r){return r<=1?"":`
      <div class="ct-vsa-pagination">
        <button class="ct-btn ct-btn--secondary" id="ct-vsa-prev" ${e<=1?"disabled":""}>\u2039 Zur\xFCck</button>
        <span class="ct-vsa-page-info">Seite ${e} / ${r} (${t} Fahrzeuge)</span>
        <button class="ct-btn ct-btn--secondary" id="ct-vsa-next" ${e>=r?"disabled":""}>Weiter \u203A</button>
      </div>`}_attachPaginationHandlers(){var e,r;let t=document.getElementById("ct-vsa-body");t&&((e=t.querySelector("#ct-vsa-prev"))==null||e.addEventListener("click",()=>{this._currentPage>1&&(this._currentPage--,this._renderBody())}),(r=t.querySelector("#ct-vsa-next"))==null||r.addEventListener("click",()=>{let a=this._getFilteredVehicles(),i=Math.ceil(a.length/this._pageSize);this._currentPage<i&&(this._currentPage++,this._renderBody())}))}_updateFooter(){let t=this._selectedVins.size,e=document.getElementById("ct-vsa-badge"),r=document.getElementById("ct-vsa-print");e&&(e.textContent=`${t} von ${this._vehicles.length} Fahrzeuge ausgew\xE4hlt`),r&&(r.disabled=t===0)}_generateQRSvg(t,e=3){try{let r=ae(0,"H");r.addData(t),r.make();let a=r.getModuleCount(),i=a*e,n="";for(let s=0;s<a;s++)for(let c=0;c<a;c++)r.isDark(s,c)&&(n+=`M${c*e},${s*e}h${e}v${e}h${-e}z`);return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${i} ${i}" width="${i}" height="${i}" shape-rendering="crispEdges"><path d="${n}" fill="#000"/></svg>`}catch(r){return $("QR generation failed for:",t,r),'<div style="width:120px;height:120px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">QR Error</div>'}}_printSelected(){let t=this._vehicles.filter(s=>this._selectedVins.has(s.vin));if(t.length===0)return;let e=this.companyConfig.getDspCode(),r=8,a=[];for(let s=0;s<t.length;s+=r){let d=t.slice(s,s+r).map(l=>{let u=this._generateQRSvg(l.vin,3);return`
          <div class="vehicle-frame">
            <div class="title">${m(l.stationCode)}</div>
            <div class="shortcode">${m(e)}</div>
            <div class="license-plate">License Plate: <span class="bold-text">${m(l.registrationNo)}</span></div>
            <div class="vin">VIN: <span class="bold-text">${m(l.vin)}</span></div>
            <div class="qr-code">${u}</div>
          </div>`}).join(`
`);a.push(`<div class="print-page">${d}</div>`)}let i=`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>VSA QR Codes \u2013 ${m(e)}</title>
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
  ${a.join(`
`)}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 300);
    };
  <\/script>
</body>
</html>`,n=window.open("","_blank");if(!n){alert("Popup-Blocker verhindert das \xD6ffnen des Druckfensters. Bitte Popups erlauben.");return}n.document.open(),n.document.write(i),n.document.close()}};function j(o,t,e){return`
    <div class="ct-settings-row">
      <label for="${m(o)}">${m(t)}</label>
      <label class="ct-toggle">
        <input type="checkbox" id="${m(o)}" ${e?"checked":""}>
        <span class="ct-slider"></span>
      </label>
    </div>
  `}function se(o){let t=document.getElementById("ct-settings-overlay");t&&t.remove();let e=document.createElement("div");e.id="ct-settings-overlay",e.className="ct-overlay visible",e.innerHTML=`
    <div class="ct-dialog" style="min-width: 400px;">
      <h3>\u2699 Einstellungen</h3>

      ${j("ct-set-whc","WHC Dashboard",o.features.whcDashboard)}
      ${j("ct-set-dre","Date Range Extractor",o.features.dateExtractor)}
      ${j("ct-set-dp","Daily Delivery Performance",o.features.deliveryPerf)}
      ${j("ct-set-dvic","DVIC Check",o.features.dvicCheck)}
      ${j("ct-set-dvic-tp","DVIC: Transporter-Spalte",o.features.dvicShowTransporters)}
      ${j("ct-set-whd","Working Hours Dashboard",o.features.workingHours)}
      ${j("ct-set-ret","Returns Dashboard",o.features.returnsDashboard)}
      ${j("ct-set-sc","Scorecard",o.features.scorecard)}
      ${j("ct-set-vsa","VSA QR Code Generator",o.features.vsaQr)}
      ${j("ct-set-dev","Dev-Mode (ausf\xFChrliches Logging)",o.dev)}

      <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
        <button class="ct-btn ct-btn--secondary" id="ct-set-cancel">Abbrechen</button>
        <button class="ct-btn ct-btn--accent" id="ct-set-save">Speichern</button>
      </div>
    </div>
  `,document.body.appendChild(e),e.addEventListener("click",r=>{r.target===e&&e.remove()}),document.getElementById("ct-set-cancel").addEventListener("click",()=>e.remove()),document.getElementById("ct-set-save").addEventListener("click",()=>{let r=a=>document.getElementById(a).checked;o.features.whcDashboard=r("ct-set-whc"),o.features.dateExtractor=r("ct-set-dre"),o.features.deliveryPerf=r("ct-set-dp"),o.features.dvicCheck=r("ct-set-dvic"),o.features.dvicShowTransporters=r("ct-set-dvic-tp"),o.features.workingHours=r("ct-set-whd"),o.features.returnsDashboard=r("ct-set-ret"),o.features.scorecard=r("ct-set-sc"),o.features.vsaQr=r("ct-set-vsa"),o.dev=r("ct-set-dev"),J(o),e.remove(),alert("Einstellungen gespeichert! Seite neu laden f\xFCr vollst\xE4ndige Aktivierung.")})}function et(o){var t;try{if(document.getElementById("ct-nav-item"))return;let e=document.querySelector(".fp-nav-menu-list");if(!e){C("Nav list not found");return}let r=null,a=Array.from(e.querySelectorAll(":scope > li.fp-nav-menu-list-item"));for(let s of a){let c=s.querySelector(":scope > a");if(c&&((t=c.textContent)==null?void 0:t.trim().toLowerCase())==="support"){r=s;break}}let i=document.createElement("li");i.id="ct-nav-item",i.className="fp-nav-menu-list-item",i.innerHTML=`
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
    `,i.querySelector(".fp-sub-menu").addEventListener("click",s=>{let c=s.target.closest("a[data-ct-tool]");if(!c)return;s.preventDefault(),s.stopPropagation();let d=c.getAttribute("data-ct-tool");try{switch(d){case"whc-dashboard":o.whcDashboard.toggle();break;case"date-extractor":o.dateRangeExtractor.showDialog();break;case"delivery-perf":o.deliveryPerformance.toggle();break;case"dvic-check":o.dvicCheck.toggle();break;case"working-hours":o.workingHoursDashboard.toggle();break;case"returns":o.returnsDashboard.toggle();break;case"scorecard":o.scorecardDashboard.toggle();break;case"vsa-qr":o.vsaQrGenerator.toggle();break;case"settings":o.openSettings();break}}catch(l){$("Tool action failed:",d,l)}}),r?r.after(i):e.appendChild(i),C("Nav item injected")}catch(e){$("Failed to inject nav item:",e)}}function Tt(o){let t=()=>{C("fp-navigation-loaded event"),setTimeout(()=>et(o()),100)};document.addEventListener("fp-navigation-loaded",t),B(()=>document.removeEventListener("fp-navigation-loaded",t));let e=new MutationObserver(()=>{!document.getElementById("ct-nav-item")&&document.querySelector(".fp-nav-menu-list")&&et(o())}),r=document.querySelector(".fp-navigation-container")||document.body;e.observe(r,{childList:!0,subtree:!0}),B(()=>e.disconnect())}function ie(o){let t=location.href;new MutationObserver(()=>{location.href!==t&&(t=location.href,o(location.href))}).observe(document,{subtree:!0,childList:!0});for(let e of["pushState","replaceState"]){let r=history[e];history[e]=function(...a){let i=r.apply(this,a);return window.dispatchEvent(new Event("locationchange")),i}}window.addEventListener("popstate",()=>window.dispatchEvent(new Event("locationchange"))),window.addEventListener("locationchange",()=>o(location.href))}async function oe(o,t,e=location.href){C("Boot for",e),et(o);try{await t(),C("Company config loaded")}catch(r){$("Company config load failed:",r)}}(function(){"use strict";let o=yt();if(!o.enabled)return;Mt(o),C("Cortex Tools loading\u2026"),Ht();let t=new ot(o),e=new ct(o,t),r=new lt(o,t),a=new ut(o,t),i=new pt(o,t),n=new ht(o,t),s=new gt(o,t),c=new vt(o,t),d=new mt(o,t),l=()=>{o=yt(),se(o)},u={whcDashboard:e,dateRangeExtractor:r,deliveryPerformance:a,dvicCheck:i,workingHoursDashboard:n,returnsDashboard:s,scorecardDashboard:c,vsaQrGenerator:d,openSettings:l};GM_registerMenuCommand("\u{1F4CA} WHC Dashboard",()=>e.toggle()),GM_registerMenuCommand("\u{1F4C5} Date Range Extractor",()=>r.showDialog()),GM_registerMenuCommand("\u{1F4E6} Daily Delivery Performance",()=>a.toggle()),GM_registerMenuCommand("\u{1F69B} DVIC Check",()=>i.toggle()),GM_registerMenuCommand("\u23F1 Working Hours",()=>n.toggle()),GM_registerMenuCommand("\u{1F4E6} Returns Dashboard",()=>s.toggle()),GM_registerMenuCommand("\u{1F4CB} Scorecard",()=>c.toggle()),GM_registerMenuCommand("\u{1F4F1} VSA QR Codes",()=>d.toggle()),GM_registerMenuCommand("\u2699 Einstellungen",l),GM_registerMenuCommand("\u23F8 Skript pausieren",()=>{o.enabled=!1,J(o),Pt();let p=document.getElementById("ct-nav-item");p&&p.remove(),alert("Cortex Tools pausiert. Seite neu laden zum Reaktivieren.")}),Bt(".fp-nav-menu-list").then(()=>{oe(u,()=>t.load()),Tt(()=>u)}).catch(p=>{$("Nav not found, retrying...",p),setTimeout(()=>{et(u),Tt(()=>u)},3e3)}),ie(p=>{C("URL changed:",p),document.getElementById("ct-nav-item")||et(u)}),C("Cortex Tools loaded")})();})();
