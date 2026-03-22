/**
 * Cortex Tools – Main Entry Point
 *
 * Bootstraps all modules after the nav is ready, registers GM menu commands,
 * and wires up the SPA navigation listener.
 */

// ── Core ──────────────────────────────────────────────────────────────────────
import { getConfig, setConfig } from './core/storage';
import { initLogging, log, err, disposeAll, waitForElement } from './core/utils';
import { CompanyConfig } from './core/api';

// ── UI ─────────────────────────────────────────────────────────────────────────
import { injectStyles } from './ui/styles';

// ── Features ──────────────────────────────────────────────────────────────────
import { WhcDashboard } from './features/whc-dashboard';
import { DateRangeExtractor } from './features/date-extractor';
import { DeliveryPerformance } from './features/delivery-performance';
import { DvicCheck } from './features/dvic-check';
import { WorkingHoursDashboard } from './features/working-hours';
import { ReturnsDashboard } from './features/returns-dashboard';
import { ScorecardDashboard } from './features/scorecard';
import { VsaQrGenerator } from './features/vsa-qr';
import { openSettings } from './features/settings';
import { injectNavItem, watchNavigation, onUrlChange, boot } from './features/navbar';

// ── Bootstrap ────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // Read config — bail out if the script is disabled
  let config = getConfig();
  if (!config.enabled) return;

  // Initialise logging with the loaded config
  initLogging(config);
  log('Cortex Tools loading…');

  // Inject all CSS up front
  injectStyles();

  // Create the centralised company config / DSP resolver (singleton for session)
  const companyConfig = new CompanyConfig(config);

  // Instantiate all feature modules
  const whcDashboard          = new WhcDashboard(config, companyConfig);
  const dateRangeExtractor    = new DateRangeExtractor(config, companyConfig);
  const deliveryPerformance   = new DeliveryPerformance(config, companyConfig);
  const dvicCheck             = new DvicCheck(config, companyConfig);
  const workingHoursDashboard = new WorkingHoursDashboard(config, companyConfig);
  const returnsDashboard      = new ReturnsDashboard(config, companyConfig);
  const scorecardDashboard    = new ScorecardDashboard(config, companyConfig);
  const vsaQrGenerator        = new VsaQrGenerator(config, companyConfig);

  // Settings callback must re-read the mutated config object
  const handleOpenSettings = () => {
    // Reload config from storage so the dialog reflects the latest persisted values
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
    openSettings: handleOpenSettings,
  };

  // ── Tampermonkey Menu Commands ───────────────────────────────────────────────
  GM_registerMenuCommand('📊 WHC Dashboard',              () => whcDashboard.toggle());
  GM_registerMenuCommand('📅 Date Range Extractor',       () => dateRangeExtractor.showDialog());
  GM_registerMenuCommand('📦 Daily Delivery Performance', () => deliveryPerformance.toggle());
  GM_registerMenuCommand('🚛 DVIC Check',                 () => dvicCheck.toggle());
  GM_registerMenuCommand('⏱ Working Hours',              () => workingHoursDashboard.toggle());
  GM_registerMenuCommand('📦 Returns Dashboard',          () => returnsDashboard.toggle());
  GM_registerMenuCommand('📋 Scorecard',                  () => scorecardDashboard.toggle());
  GM_registerMenuCommand('📱 VSA QR Codes',                () => vsaQrGenerator.toggle());
  GM_registerMenuCommand('⚙ Einstellungen',               handleOpenSettings);
  GM_registerMenuCommand('⏸ Skript pausieren', () => {
    config.enabled = false;
    setConfig(config);
    disposeAll();
    const navItem = document.getElementById('ct-nav-item');
    if (navItem) navItem.remove();
    alert('Cortex Tools pausiert. Seite neu laden zum Reaktivieren.');
  });

  // ── Initial boot: wait for nav, then inject ──────────────────────────────────
  waitForElement('.fp-nav-menu-list')
    .then(() => {
      boot(tools, () => companyConfig.load());
      watchNavigation(() => tools);
    })
    .catch((e) => {
      err('Nav not found, retrying...', e);
      setTimeout(() => {
        injectNavItem(tools);
        watchNavigation(() => tools);
      }, 3000);
    });

  // ── Re-inject nav item on SPA navigation ────────────────────────────────────
  onUrlChange((url) => {
    log('URL changed:', url);
    if (!document.getElementById('ct-nav-item')) {
      injectNavItem(tools);
    }
  });

  log('Cortex Tools loaded');
})();
