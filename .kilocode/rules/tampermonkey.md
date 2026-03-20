# tampermonkey.md

Richtlinien für die Entwicklung robuster, sicherer und wartbarer Tampermonkey-Userscripts für das Portal logistics.amazon.de („Cortex“). Fokus: Stabilität bei DOM-Änderungen, minimale Berechtigungen, saubere Architektur, gute UX für Power-User.

## Richtlinien

- Metadata-Block korrekt und minimal
  - Nutze aussagekräftige @name, @description, @version, @author.
  - Setze präzise @match statt breitem @include.
  - Verwende nur notwendige @grant-Einträge.
  - Beispiel:
    ```js
    // ==UserScript==
    // @name         Cortex Tools
    // @namespace    https://github.com/<user>/<repo>
    // @version      0.1.0
    // @description  Produktivitäts-Tools für logistics.amazon.de (Cortex)
    // @author       <dein-name>
    // @match        https://logistics.amazon.de/*
    // @grant        GM_addStyle
    // @grant        GM_getValue
    // @grant        GM_setValue
    // @grant        GM_registerMenuCommand
    // @grant        GM_xmlhttpRequest
    // @run-at       document-idle
    // @license      MIT
    // ==/UserScript==
    ```
  - Prüfe, ob `@connect` nötig ist (nur Ziel-Domains whitelisten).

- Architektur und Modularität
  - Trenne Feature-Module (Hotkeys, UI, Export, QA) in klar umrissene Funktionen.
  - Implementiere einen zentralen `init()`-Flow mit Feature-Flags/Konfiguration.
  - Nutze Utility-Helfer für wiederkehrende Patterns (waitFor, onUrlChange, store).
  - Halte Funktionen klein und testbar.

- SPA-/Navigations-Erkennung
  - Cortex verhält sich häufig wie eine SPA. Reagiere auf History-Änderungen.
  - Implementiere einen robusten URL-/Route-Listener:
    ```js
    function onUrlChange(cb) {
      let last = location.href;
      new MutationObserver(() => {
        const href = location.href;
        if (href !== last) {
          last = href;
          cb(href);
        }
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
  - Starte/stoppe Feature-Module abhängig von der aktuellen Route.

- Selektoren robust halten
  - Verzichte nach Möglichkeit auf fragile CSS-Klassen aus Build-Pipelines.
  - Bevorzuge stabile Attribute, Textinhalte, `aria-*`, `data-*`-Attribute.
  - Fallbacks und `waitForElement` nutzen:
    ```js
    function waitForElement(selector, { timeout = 15000 } = {}) {
      return new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
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
    ```

- Performance und Ressourcen
  - Verwende `document-idle` oder gezieltes Initialisieren nach DOM-Verfügbarkeit.
  - Debounce/Throttle für Scroll-/Resize-/Mutation-Observer.
  - Trenne langlebige Observer und stoppe sie, wenn ungenutzt.
  - Füge Styles via `GM_addStyle` gesammelt hinzu statt Inline-Stile zu streuen.

- UX/Interaktion
  - Biete klare Shortcuts und zeige sie in einer Hilfe/Overlay an (z. B. `?`).
  - Verändere die native UI minimal-invasiv, klar erkennbar und reversibel.
  - Nutze ARIA-Rollen und Fokus-Management für Tastaturbedienbarkeit.
  - Beispiel für Hotkeys:
    ```js
    function registerHotkeys(map) {
      window.addEventListener('keydown', (e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const fn = map[e.key.toLowerCase()];
        if (fn) {
          e.preventDefault();
          fn(e);
        }
      });
    }
    // registerHotkeys({ 'g': () => goTo('...'), 'e': exportData });
    ```

- Konfiguration und Feature-Flags
  - Nutze `GM_getValue`/`GM_setValue` für persistente Einstellungen.
  - Biete ein Konfig-Menü via `GM_registerMenuCommand`.
  - Struktur für Defaults + Migration:
    ```js
    const DEFAULTS = { enabled: true, features: { hotkeys: true, export: false } };

    function getConfig() {
      const cfg = GM_getValue('config');
      return cfg ? { ...DEFAULTS, ...cfg } : DEFAULTS;
    }
    function setConfig(next) {
      GM_setValue('config', next);
    }
    ```

- Netzwerkzugriffe und Ratenbegrenzung
  - Bevorzuge `fetch` innerhalb derselben Origin. Für CORS/andere Domains: `GM_xmlhttpRequest`.
  - Whiteliste Ziel-Domains mit `@connect`.
  - Implementiere Backoff/Retries bei 429/5xx:
    ```js
    async function withRetry(fn, { retries = 3, baseMs = 500 } = {}) {
      let attempt = 0;
      while (true) {
        try {
          return await fn();
        } catch (e) {
          if (++attempt > retries) throw e;
          const wait = baseMs * 2 ** (attempt - 1);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }
    ```

- Sicherheit und Compliance
  - Verwende minimale Grants; kein `unsafeWindow`, sofern vermeidbar.
  - Kein Sammeln oder Exfiltrieren sensibler Daten. Nur notwendige Felder verarbeiten.
  - Keine automatischen „kritischen“ Aktionen ohne explizite Nutzerbestätigung.
  - Beachte CSP: Bei Bedarf Funktionen über Userscript-APIs kapseln.
  - Sanitize/escape bei HTML-Injektion:
    ```js
    function esc(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    ```

- Fehlerbehandlung und Logging
  - Umschließe Einstiegspunkte mit Try/Catch und logge verständlich.
  - Biete ein Dev-Flag für ausführliches Logging, in Prod minimal.
  - Nutze Namenspräfix im Log:
    ```js
    const LOG_PREFIX = '[CortexTools]';
    const DEV = GM_getValue('dev', false);
    const log = (...a) => DEV && console.log(LOG_PREFIX, ...a);
    const err = (...a) => console.error(LOG_PREFIX, ...a);
    ```

- Styling und visuelle Konsistenz
  - Fasse CSS in einem Block/Datei zusammen; nutze BEM-ähnliche Klassen.
  - Respektiere Dark/Light-Mode, wenn möglich per `prefers-color-scheme`.
  - Vermeide Layout-Verschiebungen (CLS). Nutze feste Containergrößen, wenn UI ergänzt wird.

- Internationalisierung
  - Texte zentralisieren; Default auf Deutsch, fallback auf Englisch.
  - Struktur:
    ```js
    const I18N = {
      de: { settings: 'Einstellungen', enable: 'Aktivieren' },
      en: { settings: 'Settings', enable: 'Enable' },
    };
    const lang = navigator.language.startsWith('de') ? 'de' : 'en';
    const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
    ```

- Versionsmanagement und Changelog
  - Folge SemVer (MAJOR.MINOR.PATCH). Erhöhe @version bei jeder Veröffentlichung.
  - Pflege ein CHANGELOG mit „Added/Changed/Fixed/Removed“.
  - Versioniere Migrationsschritte für gespeicherte Einstellungen.

- Kompatibilität
  - Ziel-Browser: Chromium/Firefox aktuell. Vermeide experimentelle APIs.
  - Prüfe Greasemonkey/Tampermonkey-APIs; dokumentiere benötigte Manager.

- Tests und Qualitätssicherung
  - Baue ein „Trockenlauf“-Feature-Flag (nur markieren, nicht klicken).
  - Optional: E2E-Light über kleine Szenarien/Asserts im Script aktivierbar.
  - Manuelle Checkliste je Release:
    - Initialisierung bei Kaltstart
    - Navigation via SPA/Back/Forward
    - Kernfeatures (Hotkeys, UI, Exporte)
    - Fehler- und Offline-Fälle
    - Performance (Lags/CPU) und Speicher

- Repository-Struktur (Empfehlung)
  - `src/` Feature-Module und Utils
  - `styles/` CSS oder JS-CSS
  - `build/` Bundler/Meta-Header
  - `dist/` gebaute .user.js
  - `CHANGELOG.md`, `README.md` (mit Installationsanleitung), `LICENSE`
  - Beispiel-README-Inhalt: Zweck, Installation (Raw-URL), Berechtigungen, Screenshots, Shortcuts.

- Coding Style
  - Einheitlich mit Prettier (printWidth 80) und ESLint (Standard/TS-Config).
  - Nutze Konstants, keine Magic Numbers.
  - Frühzeitige Rückgaben, kleine Funktionen, reine Utilities wo möglich.
  - Optional: TypeScript + Bundling zu einer einzelnen .user.js.

- Datenschutz und Transparenz im README
  - Liste klar auf, welche Daten gelesen/verarbeitet/gespeichert werden.
  - Erkläre, warum welche Grants benötigt sind.
  - Biete einen „Kill Switch“ (Menüpunkt: „Skript pausieren“).

- Deaktivierung/Unloading
  - Implementiere sauberes Unmounting (Event-Listener, Observer, Styles entfernen).
  - Beispiel:
    ```js
    const disposers = [];
    function onDispose(fn) {
      disposers.push(fn);
      return fn;
    }
    function disposeAll() {
      while (disposers.length) {
        try {
          disposers.pop()();
        } catch (e) {}
      }
    }
    ```

- Beispiel-Init-Flow
  - Strukturvorschlag für den Startpunkt:
    ```js
    (function () {
      'use strict';

      // Config laden
      let config = getConfig();
      if (!config.enabled) return;

      // Styles
      GM_addStyle(`
        .ct-toolbar { position: fixed; top: 88px; right: 16px; z-index: 9999; }
      `);

      // Routen-Handling und Initialisierung
      function boot(url = location.href) {
        disposeAll();
        log('Init for', url);

        // Feature-Bedingungen prüfen
        if (config.features.hotkeys) initHotkeys();
        if (config.features.export) initExport();
        // weitere Features...
      }

      // Erststart
      boot();

      // SPA-Änderungen
      onUrlChange(boot);

      // Menü
      GM_registerMenuCommand('Einstellungen', () => openSettings());
      GM_registerMenuCommand('Skript pausieren', () => {
        config.enabled = false;
        setConfig(config);
        disposeAll();
        alert('Cortex Tools pausiert. Seite neu laden zum Reaktivieren.');
      });
    })();
    ```

- Do/Don't Übersicht
  - Do: minimale Grants, robuste Selektoren, SPA-awareness, Feature-Flags, saubere Logs.
  - Do: klare Shortcuts, Hilfe-Overlay, Undo/Bestätigung für Aktionen.
  - Don't: globale Styles, die Cortex brechen; blockierende Loops; harte Wartezeiten ohne Reason.
  - Don't: unnötige externe Requests oder weite @match/@connect Muster.