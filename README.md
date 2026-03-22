# 🛠 Cortex Tools

> Produktivitäts-Tools für Amazon Logistics (logistics.amazon.de)

Ein Tampermonkey-Userscript, das eine integrierte **„Tools"-Dropdown-Menüleiste** in die Cortex-Navigation einfügt und mehrere Werkzeuge für den täglichen Betrieb bündelt.

---

## Inhaltsverzeichnis

- [Übersicht](#übersicht)
- [Screenshots](#screenshots)
- [Installation](#installation)
- [Verwendung](#verwendung)
- [Konfiguration](#konfiguration)
- [Architektur](#architektur)
- [Berechtigungen](#berechtigungen)
- [Datenschutz](#datenschutz)
- [Fehlerbehebung](#fehlerbehebung)
- [Entwicklung](#entwicklung)
- [Legacy-Skripte](#legacy-skripte)
- [Changelog](#changelog)
- [Lizenz](#lizenz)

---

## Übersicht

**Cortex Tools** erweitert das Amazon Logistics Portal ([logistics.amazon.de](https://logistics.amazon.de/)) um ein zusätzliches Dropdown-Menü in der Hauptnavigation. Dieses Menü bündelt mehrere Werkzeuge, die den operativen Alltag erleichtern:

| Tool | Beschreibung |
|---|---|
| **WHC Dashboard** | Arbeitszeitüberwachung (Working Hour Compliance) für Delivery Associates — Tages- und Wochenansicht mit CSV-Export |
| **Date Range Extractor** | Batch-Datenextraktion aus der Operations API über frei wählbare Datumsbereiche mit Vorschau und Historie |
| **Daily Delivery Performance** | Tagesaktuelle Lieferperformance-Übersicht für eine Station/DSP |
| **DVIC Check** | Fahrzeugprüfungs-Dashboard (Daily Vehicle Inspection Check) inkl. optionaler Transporter-Ansicht |
| **Working Hours Dashboard** | Erweiterte Arbeitszeitauswertung für Fahrer |
| **Returns Dashboard** | Übersicht über Rücksendungen und Retouren |
| **Scorecard** | Scorecard-Auswertung für Fahrer und Teams |
| **VSA QR Codes** | QR-Code-Generierung für VS-Zuweisungen (VSA) |

Das Skript integriert sich nahtlos in die bestehende Cortex-Navigation und erscheint als neuer Menüpunkt **„Tools"** rechts neben „Support".

---

## Screenshots

### Operations Dashboard
![Operations Dashboard](Screenshot%202026-03-20%20220940.png)

### Navigation mit Tools-Dropdown
![Navigation mit Dropdown](Screenshot%202026-03-20%20220948.png)

---

## Installation

### Voraussetzungen

- **Google Chrome** oder **Mozilla Firefox** (aktuelle Version)
- **Tampermonkey** Browser-Erweiterung:
  - [Chrome Web Store](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
  - [Firefox Add-ons](https://addons.mozilla.org/de/firefox/addon/tampermonkey/)

### Schritt-für-Schritt

1. **Tampermonkey installieren** — Erweiterung aus dem jeweiligen Store hinzufügen und aktivieren.

2. **Skript hinzufügen** — Eine der folgenden Methoden verwenden:

   **Option A: Auto-Install über Release**
   - Die neueste Version wird automatisch über die `@updateURL` / `@downloadURL` eingespielt, sobald das Skript einmal installiert ist.
   - Direkter Download: [cortex-tools.user.js (latest release)](https://github.com/scrulleb/amzl-cortex-tampermonkey/releases/latest/download/cortex-tools.user.js)

   **Option B: Raw-Datei öffnen**
   - Die Datei `cortex-tools/dist/cortex-tools.user.js` im Repository öffnen und auf „Raw" klicken.
   - Tampermonkey erkennt den Userscript-Header automatisch und bietet die Installation an.

   **Option C: Manuell einfügen**
   - Tampermonkey-Icon → „Neues Skript erstellen"
   - Den gesamten Inhalt von `cortex-tools/dist/cortex-tools.user.js` einfügen
   - Speichern (`Strg + S`)

3. **Installation bestätigen** — Im Tampermonkey-Installationsdialog auf „Installieren" klicken.

4. **Cortex öffnen** — Zu [https://logistics.amazon.de/](https://logistics.amazon.de/) navigieren. Das Menü **„Tools"** erscheint in der Navigationsleiste.

---

## Verwendung

### Tools-Dropdown

Nach der Installation erscheint in der Cortex-Navbar (rechts neben „Support") der Menüpunkt **„Tools"**. Ein Klick öffnet das Dropdown mit den verfügbaren Werkzeugen.

### WHC Dashboard

1. **Tools → WHC Dashboard** auswählen
2. Ein Overlay öffnet sich mit der Tagesansicht
3. **Datum wählen** — über den Datepicker den gewünschten Tag auswählen
4. **Modus wechseln** — zwischen Tages- und Wochenansicht umschalten
5. **CSV-Export** — Button „CSV exportieren" erstellt eine Datei mit allen angezeigten Daten

### Date Range Extractor

1. **Tools → Date Range Extractor** auswählen
2. **Datumsbereich festlegen** — Start- und Enddatum eingeben
3. **Vorschau** — über „Preview" die zu erwartenden Daten prüfen
4. **Extraktion starten** — auf „Start" klicken; der Fortschritt wird angezeigt
5. **Historie** — vergangene Extraktionen können über die History-Ansicht eingesehen werden

### Daily Delivery Performance

1. **Tools → Daily Delivery Performance** auswählen
2. Station und DSP sind über die Einstellungen vorkonfigurierbar
3. Tagesaktuelle Performance-Kennzahlen werden im Overlay angezeigt

### DVIC Check

1. **Tools → DVIC Check** auswählen
2. Übersicht aller fahrzeuggeprüften DAs für den aktuellen Tag
3. Optional: Transporter-Ansicht über Feature-Toggle aktivierbar

### Einstellungen

Über **Tools → Settings** (oder Tampermonkey-Kontextmenü → „Einstellungen") lassen sich konfigurieren:

- **Service Area ID** — Die ID des eigenen Service-Gebiets
- **Delivery Perf Station / DSP** — Vorauswahl für das Delivery Performance Tool
- **Feature-Toggles** — Einzelne Tools aktivieren/deaktivieren
- **Dev-Modus** — Erweitertes Logging in der Browser-Konsole

### Tampermonkey-Menübefehle

Rechtsklick auf das Tampermonkey-Icon → „Cortex Tools" zeigt:

- **📊 WHC Dashboard** — Dashboard öffnen
- **📅 Date Range Extractor** — Extractor öffnen
- **📦 Daily Delivery Performance** — Performance-Ansicht öffnen
- **🚛 DVIC Check** — DVIC-Übersicht öffnen
- **⏱ Working Hours** — Arbeitszeitauswertung öffnen
- **📦 Returns Dashboard** — Retouren-Übersicht öffnen
- **📋 Scorecard** — Scorecard öffnen
- **📱 VSA QR Codes** — QR-Generator öffnen
- **⚙ Einstellungen** — Öffnet den Settings-Dialog
- **⏸ Skript pausieren** — Deaktiviert alle Features bis zum nächsten Reload

---

## Konfiguration

Die Konfiguration wird über Tampermonkey-Storage (`GM_getValue`/`GM_setValue`) persistiert (Schlüssel: `ct_config`):

```js
{
  enabled: true,                      // Masterswitch — Skript aktiv?
  dev: false,                         // Dev-Modus — ausführliches Logging
  serviceAreaId: '',                  // UUID der Service Area für API-Abfragen
  deliveryPerfStation: '',            // Stations-ID für Delivery Performance
  deliveryPerfDsp: '',                // DSP-ID für Delivery Performance
  features: {
    whcDashboard: true,               // WHC Dashboard
    dateExtractor: true,              // Date Range Extractor
    deliveryPerf: true,               // Daily Delivery Performance
    dvicCheck: true,                  // DVIC Check
    dvicShowTransporters: true,       // Transporter-Ansicht im DVIC Check
    workingHours: true,               // Working Hours Dashboard
    returnsDashboard: true,           // Returns Dashboard
    scorecard: true,                  // Scorecard
    vsaQr: true,                      // VSA QR Codes
  }
}
```

| Feld | Typ | Beschreibung |
|---|---|---|
| `enabled` | `boolean` | Masterswitch — bei `false` wird kein Feature geladen |
| `dev` | `boolean` | Aktiviert ausführliches Logging in der Konsole (`[CortexTools] …`) |
| `serviceAreaId` | `string` | UUID der Service Area für API-Abfragen |
| `deliveryPerfStation` | `string` | Stations-ID für das Delivery Performance Tool |
| `deliveryPerfDsp` | `string` | DSP-ID für das Delivery Performance Tool |
| `features.whcDashboard` | `boolean` | WHC Dashboard ein-/ausschalten |
| `features.dateExtractor` | `boolean` | Date Range Extractor ein-/ausschalten |
| `features.deliveryPerf` | `boolean` | Daily Delivery Performance ein-/ausschalten |
| `features.dvicCheck` | `boolean` | DVIC Check ein-/ausschalten |
| `features.dvicShowTransporters` | `boolean` | Transporter-Ansicht im DVIC Check |
| `features.workingHours` | `boolean` | Working Hours Dashboard ein-/ausschalten |
| `features.returnsDashboard` | `boolean` | Returns Dashboard ein-/ausschalten |
| `features.scorecard` | `boolean` | Scorecard ein-/ausschalten |
| `features.vsaQr` | `boolean` | VSA QR Code Generator ein-/ausschalten |

---

## Architektur

### Überblick

```
amzl-cortex-tampermonkey/
├── cortex-tools/                     # TypeScript-Quellcode & Build-System
│   ├── src/
│   │   ├── index.ts                  # Entry Point — Bootstrap & GM-Menüregistrierung
│   │   ├── core/
│   │   │   ├── api.ts                # CompanyConfig / DSP-Resolver
│   │   │   ├── storage.ts            # GM_getValue/GM_setValue-Wrapper (typisiert)
│   │   │   └── utils.ts              # Logging, disposeAll, waitForElement
│   │   ├── ui/
│   │   │   ├── components.ts         # Wiederverwendbare UI-Bausteine
│   │   │   ├── overlay.ts            # Overlay-Basisklasse
│   │   │   └── styles.ts             # GM_addStyle — zentrales Stylesheet
│   │   └── features/
│   │       ├── navbar.ts             # Nav-Injection, SPA-Listener, boot()
│   │       ├── whc-dashboard.ts      # WHC Dashboard
│   │       ├── date-extractor.ts     # Date Range Extractor
│   │       ├── delivery-performance.ts
│   │       ├── dvic-check.ts
│   │       ├── working-hours.ts
│   │       ├── returns-dashboard.ts
│   │       ├── scorecard.ts
│   │       ├── vsa-qr.ts
│   │       └── settings.ts
│   ├── dist/
│   │   ├── cortex-tools.user.js      # Fertig gebuildetes Userscript
│   │   └── cortex-tools.meta.js      # Nur-Header für Auto-Update
│   ├── userscript.header.js          # Userscript-Metadaten (@name, @grant, …)
│   ├── esbuild.config.js             # Build-Konfiguration (esbuild)
│   ├── tsconfig.json
│   └── package.json
├── cortex-tools.user.js              # Legacy: alter Monolith (veraltet)
├── date_range_extractor.js           # Legacy: Standalone Date Range Extractor
├── whc_dashboard.js                  # Legacy: Standalone WHC Dashboard
└── tests/                            # Unit-Tests
```

### Design-Entscheidungen

- **Modulares TypeScript** — Quellcode in `src/` ist in Core-, UI- und Feature-Module aufgeteilt; esbuild bündelt alles zu einer einzelnen `.user.js`.
- **Navbar-Injection** — Erkennung der Navigation über `MutationObserver` und das Cortex-eigene Event `fp-navigation-loaded`. Robuster Fallback bei langsamen Seitenladungen.
- **Klassen-basierte Module** — Jedes Tool ist als eigene Klasse implementiert (`WhcDashboard`, `DvicCheck`, …) und implementiert ein gemeinsames `toggle()`-Interface.
- **Dispose-System** — Alle Event-Listener, Observer und DOM-Elemente werden in einem zentralen `disposers`-Array registriert. Bei Routenwechsel oder Deaktivierung wird `disposeAll()` aufgerufen.
- **SPA-Awareness** — History-API-Patching (`pushState`/`replaceState`) und `popstate`-Listener erkennen Navigationswechsel ohne Page-Reload.
- **CSS Custom Properties** — Theming über CSS-Variablen, kompatibel mit dem Cortex-Stylesheet.
- **Auto-Update** — `@updateURL` und `@downloadURL` zeigen auf die GitHub-Releases, sodass Tampermonkey neue Versionen automatisch erkennt.

---

## Berechtigungen

### Userscript Grants

| Grant | Zweck |
|---|---|
| `GM_addStyle` | CSS-Injektion ohne Inline-Styles — gesammeltes Stylesheet für alle Tools |
| `GM_getValue` | Persistente Einstellungen und Batch-Historie aus dem Tampermonkey-Storage laden |
| `GM_setValue` | Einstellungen, Extraktionsdaten und Historie speichern |
| `GM_registerMenuCommand` | Tampermonkey-Kontextmenü-Einträge für alle Tools |

### Netzwerkzugriff

| Direktive | Wert | Zweck |
|---|---|---|
| `@match` | `https://logistics.amazon.de/*` | Skript läuft ausschließlich auf der Cortex-Domain |
| `@connect` | `logistics.amazon.de` | Erlaubt API-Requests an die Cortex-API (Same-Origin via `fetch`) |

---

## Datenschutz

- Das Skript läuft **ausschließlich** auf `logistics.amazon.de`.
- **Keine Daten** werden an externe Server gesendet.
- Extrahierte Daten werden **lokal** im Tampermonkey-Storage gespeichert.
- Session-Cookies werden nur für Same-Origin-API-Requests verwendet.
- Es werden **keine personenbezogenen Daten** erhoben, die über die Anzeige in den API-Responses hinausgehen.
- Alle gespeicherten Daten können über die Tampermonkey-Einstellungen eingesehen und gelöscht werden.

---

## Fehlerbehebung

### „Tools"-Menü erscheint nicht

- **Navigation noch nicht geladen** — Seite neu laden (`F5`). Das Skript wartet auf die Navbar, aber bei Race-Conditions kann ein Reload helfen.
- **Tampermonkey deaktiviert** — Prüfen, ob die Erweiterung aktiv ist und das Skript auf der aktuellen Seite läuft.
- **Skript pausiert** — Über Tampermonkey-Menü prüfen; ggf. `enabled` in den Einstellungen auf `true` setzen und Seite neu laden.

### API-Fehler (401 / 403)

- **Session abgelaufen** — Cortex erneut einloggen und Seite neu laden.

### WHC Dashboard zeigt keine Fahrer

- **Service Area ID prüfen** — Unter Tools → Settings die korrekte UUID eintragen.
- **Roster existiert nicht** — Sicherstellen, dass für das gewählte Datum ein Roster vorhanden ist.

### CSV-Export fehlerhaft / leer

- **Zuerst Abfrage ausführen** — Vor dem Export muss eine erfolgreiche Abfrage durchgeführt werden. Der Export-Button bezieht sich auf die zuletzt geladenen Daten.

### Doppelte UI-Elemente

- **Legacy-Skripte deaktivieren** — Wenn `date_range_extractor.js`, `whc_dashboard.js` oder `cortex-tools.user.js` (Monolith) parallel zur aktuellen Version aktiv sind, entstehen doppelte Menüpunkte. Lösung: Veraltete Standalone-Skripte in Tampermonkey deaktivieren.

---

## Entwicklung

### Voraussetzungen

- **Node.js** ≥ 18
- Abhängigkeiten installieren: `cd cortex-tools && npm install`

### Build

```bash
# Einmaliger Build (Entwicklung)
npm run build

# Build mit Watch-Modus
npm run dev

# Produktions-Build (minifiziert)
npm run build:prod

# Nur TypeScript prüfen (kein Output)
npm run typecheck
```

Das fertige Skript liegt anschließend unter `cortex-tools/dist/cortex-tools.user.js`.

### Neues Tool hinzufügen

1. Klasse in `cortex-tools/src/features/mein-tool.ts` erstellen (`toggle()`-Methode implementieren)
2. In `src/index.ts` importieren und instanziieren
3. `GM_registerMenuCommand`-Eintrag hinzufügen
4. Menüeintrag im Navbar-Dropdown ergänzen (`features/navbar.ts`)
5. Feature-Flag in `core/storage.ts` → `FeaturesConfig` und `DEFAULTS` eintragen

### Dev-Modus aktivieren

Über die Browser-Konsole:

```js
// Tampermonkey-Storage direkt setzen (nur für Debugging)
GM_setValue('ct_config', JSON.stringify({ ...GM_getValue('ct_config', {}), dev: true }));
```

Oder über **Tools → Settings → Dev-Modus**.

Im Dev-Modus werden alle `[CortexTools]`-Logmeldungen in der Konsole ausgegeben.

### Code Style

- **Prettier** — `printWidth: 80`, Single Quotes
- **ESLint** — Standard-Config oder `eslint-config-standard`
- Keine Magic Numbers — Konstanten verwenden
- Frühe Returns bevorzugen
- Kleine, testbare Funktionen

---

## Legacy-Skripte

Die folgenden Dateien sind **veraltete Standalone-Versionen** der Tools:

| Datei | Beschreibung | Status |
|---|---|---|
| `cortex-tools.user.js` | Monolithisches All-in-One-Userscript (v1.0.0) | ⚠️ Veraltet — durch modulares Build-System ersetzt |
| `date_range_extractor.js` | Eigenständiger Date Range Extractor | ⚠️ Veraltet — in `cortex-tools/src/features/date-extractor.ts` integriert |
| `whc_dashboard.js` | Eigenständiges WHC Dashboard | ⚠️ Veraltet — in `cortex-tools/src/features/whc-dashboard.ts` integriert |

> **Wichtig:** Diese Skripte sollten in Tampermonkey **deaktiviert** werden, wenn die aktuelle Version (`cortex-tools/dist/cortex-tools.user.js`) installiert ist, um doppelte UI-Elemente zu vermeiden. Sie bleiben im Repository als Referenz erhalten.

---

## Changelog

### [1.3.1] — aktuell

#### Added
- Working Hours Dashboard
- Returns Dashboard
- Scorecard Dashboard
- VSA QR Code Generator
- Daily Delivery Performance Tool (mit Station/DSP-Konfiguration)
- DVIC Check (inkl. optionaler Transporter-Ansicht)
- Modulares TypeScript-Build-System (esbuild)
- Auto-Update via `@updateURL` / `@downloadURL` (GitHub Releases)
- Klassen-basierte Feature-Module mit einheitlichem `toggle()`-Interface

### [1.0.0] — 2026-03-20

#### Added
- Einheitliches „Tools"-Dropdown in der Cortex-Navigationsleiste
- Integriertes WHC Dashboard (aus `whc_dashboard.js` v1.2)
- Integrierter Date Range Extractor (aus `date_range_extractor.js` v0.1)
- Settings-Dialog mit Feature-Toggles und Service Area ID-Konfiguration
- In-Page-Overlays anstelle von `window.open()`-Popups
- SPA-Navigation-Awareness mit automatischer Re-Injection
- CSS-Theming über Custom Properties
- Dispose/Cleanup-System für sauberes Entladen
- MutationObserver + `fp-navigation-loaded`-Event für robuste Nav-Erkennung

---

## Lizenz

MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
