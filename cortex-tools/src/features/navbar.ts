// features/navbar.ts – Navbar injection and SPA navigation handling

import { log, err, onDispose, waitForElement } from '../core/utils';
import type { WhcDashboard } from './whc-dashboard';
import type { DateRangeExtractor } from './date-extractor';
import type { DeliveryPerformance } from './delivery-performance';
import type { DvicCheck } from './dvic-check';
import type { WorkingHoursDashboard } from './working-hours';
import type { ReturnsDashboard } from './returns-dashboard';
import type { ScorecardDashboard } from './scorecard';

export interface ToolRegistry {
  whcDashboard: WhcDashboard;
  dateRangeExtractor: DateRangeExtractor;
  deliveryPerformance: DeliveryPerformance;
  dvicCheck: DvicCheck;
  workingHoursDashboard: WorkingHoursDashboard;
  returnsDashboard: ReturnsDashboard;
  scorecardDashboard: ScorecardDashboard;
  openSettings: () => void;
}

export function injectNavItem(tools: ToolRegistry): void {
  try {
    if (document.getElementById('ct-nav-item')) return;

    const navList = document.querySelector('.fp-nav-menu-list');
    if (!navList) { log('Nav list not found'); return; }

    let supportItem: Element | null = null;
    const items = Array.from(navList.querySelectorAll(':scope > li.fp-nav-menu-list-item'));
    for (const li of items) {
      const anchor = li.querySelector(':scope > a');
      if (anchor && anchor.textContent?.trim().toLowerCase() === 'support') {
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
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="scorecard">📋 Scorecard</a>
        </li>
        <li class="fp-sub-menu-list-item">
          <a href="#" data-ct-tool="settings">⚙ Einstellungen</a>
        </li>
      </ul>
    `;

    const submenu = li.querySelector('.fp-sub-menu')!;
    submenu.addEventListener('click', (e) => {
      const anchor = (e.target as Element).closest('a[data-ct-tool]') as HTMLElement | null;
      if (!anchor) return;
      e.preventDefault();
      e.stopPropagation();
      const tool = anchor.getAttribute('data-ct-tool');
      try {
        switch (tool) {
          case 'whc-dashboard':  tools.whcDashboard.toggle(); break;
          case 'date-extractor': tools.dateRangeExtractor.showDialog(); break;
          case 'delivery-perf':  tools.deliveryPerformance.toggle(); break;
          case 'dvic-check':     tools.dvicCheck.toggle(); break;
          case 'working-hours':  tools.workingHoursDashboard.toggle(); break;
          case 'returns':        tools.returnsDashboard.toggle(); break;
          case 'scorecard':      tools.scorecardDashboard.toggle(); break;
          case 'settings':       tools.openSettings(); break;
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

export function watchNavigation(getTools: () => ToolRegistry): void {
  // Listen for Cortex's custom navigation reload event
  const handler = () => {
    log('fp-navigation-loaded event');
    setTimeout(() => injectNavItem(getTools()), 100);
  };
  document.addEventListener('fp-navigation-loaded', handler);
  onDispose(() => document.removeEventListener('fp-navigation-loaded', handler));

  // MutationObserver fallback — watch for nav being replaced
  const obs = new MutationObserver(() => {
    if (!document.getElementById('ct-nav-item') && document.querySelector('.fp-nav-menu-list')) {
      injectNavItem(getTools());
    }
  });
  const navContainer = document.querySelector('.fp-navigation-container') || document.body;
  obs.observe(navContainer, { childList: true, subtree: true });
  onDispose(() => obs.disconnect());
}

/**
 * Listen for SPA URL changes by patching history API and observing DOM mutations.
 */
export function onUrlChange(cb: (url: string) => void): void {
  let last = location.href;
  new MutationObserver(() => {
    if (location.href !== last) { last = location.href; cb(location.href); }
  }).observe(document, { subtree: true, childList: true });

  for (const method of ['pushState', 'replaceState'] as const) {
    const orig = history[method];
    (history as unknown as Record<string, unknown>)[method] = function (this: History, ...args: Parameters<typeof orig>) {
      const ret = orig.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
      return ret;
    };
  }
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));
  window.addEventListener('locationchange', () => cb(location.href));
}

/**
 * Initialise navbar and load company config.
 */
export async function boot(
  tools: ToolRegistry,
  companyConfigLoad: () => Promise<void>,
  url: string = location.href,
): Promise<void> {
  log('Boot for', url);
  injectNavItem(tools);
  try {
    await companyConfigLoad();
    log('Company config loaded');
  } catch (e) {
    err('Company config load failed:', e);
  }
}
