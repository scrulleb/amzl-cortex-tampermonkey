# Architecture & Init Flow

## Module Pattern

Structure the script as an IIFE with clearly separated feature modules:

```
- init() / boot(url)    — entry point, feature flag checks
- initHotkeys()         — keyboard shortcut bindings
- initExport()          — data export logic
- initUI()              — injected UI elements
- utils                 — waitForElement, onUrlChange, store helpers
```

Keep functions small and single-purpose. Avoid global mutable state outside of `config`.

## Init Flow

```js
(function () {
  'use strict';

  let config = getConfig();
  if (!config.enabled) return;

  GM_addStyle(/* all CSS in one call */);

  function boot(url = location.href) {
    disposeAll();
    log('Init for', url);
    if (config.features.hotkeys) initHotkeys();
    if (config.features.export)  initExport();
  }

  boot();
  onUrlChange(boot);

  GM_registerMenuCommand('Settings', () => openSettings());
  GM_registerMenuCommand('Pause script', () => {
    config.enabled = false;
    setConfig(config);
    disposeAll();
  });
})();
```

## SPA Navigation

Cortex is a SPA. Monitor URL changes via both MutationObserver and History API patching:

```js
function onUrlChange(cb) {
  let last = location.href;
  new MutationObserver(() => {
    if (location.href !== last) { last = location.href; cb(last); }
  }).observe(document, { subtree: true, childList: true });

  ['pushState', 'replaceState'].forEach((m) => {
    const orig = history[m];
    history[m] = function (...args) {
      const ret = orig.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
      return ret;
    };
  });
  window.addEventListener('popstate', () =>
    window.dispatchEvent(new Event('locationchange'))
  );
  window.addEventListener('locationchange', () => cb(location.href));
}
```

## Disposal

Every module must register its cleanup via `onDispose()`. Always call `disposeAll()` before `boot()` on re-navigation.

```js
const disposers = [];
const onDispose = (fn) => { disposers.push(fn); return fn; };
function disposeAll() {
  while (disposers.length) {
    try { disposers.pop()(); } catch (_) {}
  }
}
```

**Register all event listeners, observers, and injected DOM nodes through `onDispose`.**

## Waiting for DOM Elements

Never use bare `querySelector` on a DOM that may not have rendered yet.

```js
function waitForElement(selector, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const obs = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { obs.disconnect(); resolve(found); }
    });
    obs.observe(document, { childList: true, subtree: true });
    if (timeout) setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
  });
}
```

## Selector Strategy

- **Prefer:** `aria-label`, `data-*` attributes, visible text content
- **Avoid:** generated CSS class names (e.g., `_3xB9a`) — they change with builds
- **Fallback chain:** try stable selectors first; log a warning if falling back to fragile ones
