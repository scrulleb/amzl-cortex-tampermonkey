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

   **Option A: Raw-Datei öffnen**
   - Die Datei `cortex-tools.user.js` im Repository öffnen und auf „Raw" klicken.
   - Tampermonkey erkennt den Userscript-Header automatisch und bietet die Installation an.

   **Option B: Manuell einfügen**
   - Tampermonkey-Icon → „Neues Skript erstellen"
   - Den gesamten Inhalt von `cortex-tools.user.js` einfügen
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

### Einstellungen

Über **Tools → Settings** (oder Tampermonkey-Kontextmenü → „Einstellungen") lassen sich konfigurieren:

- **Service Area ID** — Die ID des eigenen Service-Gebiets
- **Feature-Toggles** — Einzelne Tools aktivieren/deaktivieren
- **Dev-Modus** — Erweitertes Logging in der Browser-Konsole

### Tampermonkey-Menübefehle

Rechtsklick auf das Tampermonkey-Icon → „Cortex Tools" zeigt:

- **Einstellungen** — Öffnet den Settings-Dialog
- **Skript pausieren** — Deaktiviert alle Features bis zum nächsten Reload

---

## Konfiguration

Die Konfiguration wird über Tampermonkey-Storage (`GM_getValue`/`GM_setValue`) persistiert:

```js
{
  enabled: true,                    // Masterswitch — Skript aktiv?
  dev: false,                       // Dev-Modus — ausführliches Logging
  serviceAreaId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',  // Service Area ID
  features: {
    whcDashboard: true,             // WHC Dashboard aktiviert
    dateRangeExtractor: true        // Date Range Extractor aktiviert
  }
}
```

| Feld | Typ | Beschreibung |
|---|---|---|
| `enabled` | `boolean` | Masterswitch — bei `false` wird kein Feature geladen |
| `dev` | `boolean` | Aktiviert ausführliches Logging in der Konsole (`[CortexTools] …`) |
| `serviceAreaId` | `string` | UUID der Service Area für API-Abfragen (WHC, Operations) |
| `features.whcDashboard` | `boolean` | WHC Dashboard ein-/ausschalten |
| `features.dateRangeExtractor` | `boolean` | Date Range Extractor ein-/ausschalten |

---

## Architektur

### Überblick

```
cortex-tools.user.js
├── Config / Storage Layer
├── Navbar Injection (MutationObserver + fp-navigation-loaded)
├── Tools Dropdown (DOM-Erzeugung)
├── Module: WHC Dashboard
├── Module: Date Range Extractor
├── Module: Settings
├── Dispose / Cleanup System
└── SPA Navigation Listener
```

### Design-Entscheidungen

- **Einzelnes Skript** — Alle Tools in einer `.user.js`-Datei, kein Build-Schritt nötig.
- **Navbar-Injection** — Erkennung der Navigation über `MutationObserver` und das Cortex-eigene Event `fp-navigation-loaded`. Robuster Fallback bei langsamen Seitenladungen.
- **Modul-Pattern** — Jedes Tool ist als eigenständiges Modul implementiert (`initWhcDashboard()`, `initDateRangeExtractor()`), das über Feature-Flags gesteuert wird.
- **Dispose-System** — Alle Event-Listener, Observer und DOM-Elemente werden in einem zentralen `disposers`-Array registriert. Bei Routenwechsel oder Deaktivierung wird `disposeAll()` aufgerufen.
- **SPA-Awareness** — History-API-Patching (`pushState`/`replaceState`) und `popstate`-Listener erkennen Navigationswechsel ohne Page-Reload.
- **CSS Custom Properties** — Theming über CSS-Variablen, kompatibel mit dem Cortex-Stylesheet.

---

## Berechtigungen

### Userscript Grants

| Grant | Zweck |
|---|---|
| `GM_addStyle` | CSS-Injektion ohne Inline-Styles — gesammeltes Stylesheet für alle Tools |
| `GM_getValue` | Persistente Einstellungen und Batch-Historie aus dem Tampermonkey-Storage laden |
| `GM_setValue` | Einstellungen, Extraktionsdaten und Historie speichern |
| `GM_registerMenuCommand` | Tampermonkey-Kontextmenü-Einträge (Einstellungen, Pausieren) |

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

- **Legacy-Skripte deaktivieren** — Wenn `date_range_extractor.js` oder `whc_dashboard.js` parallel zu `cortex-tools.user.js` aktiv sind, entstehen doppelte Menüpunkte. Lösung: Die Standalone-Skripte in Tampermonkey deaktivieren.

---

## Entwicklung

### Dateistruktur

```
amzl-cortex-tampermonkey/
├── cortex-tools.user.js          # Haupt-Userscript (alle Tools integriert)
├── date_range_extractor.js       # Legacy: Standalone Date Range Extractor
├── whc_dashboard.js              # Legacy: Standalone WHC Dashboard
├── example.css                   # Referenz: HTML-Struktur der Cortex-Navbar
├── Screenshot 2026-03-20 *.png   # Screenshots
├── README.md                     # Diese Datei
└── CHANGELOG.md                  # (empfohlen)
```

### Neues Tool hinzufügen

1. Init-Funktion erstellen: `function initMeinTool() { … }`
2. Dispose-Logik registrieren: `onDispose(() => cleanup())`
3. Menüeintrag im Dropdown ergänzen (in der Dropdown-Erzeugung)
4. Feature-Flag hinzufügen: `features.meinTool: true`
5. Im `boot()`-Flow einbinden:
   ```js
   if (config.features.meinTool) initMeinTool();
   ```

### Dev-Modus aktivieren

Über die Browser-Konsole:

```js
// Tampermonkey-Storage direkt setzen (nur für Debugging)
GM_setValue('dev', true);
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

Die folgenden Dateien sind die **ursprünglichen Standalone-Versionen** der Tools:

| Datei | Beschreibung | Status |
|---|---|---|
| `date_range_extractor.js` | Eigenständiger Date Range Extractor | ⚠️ Veraltet — in `cortex-tools.user.js` integriert |
| `whc_dashboard.js` | Eigenständiges WHC Dashboard | ⚠️ Veraltet — in `cortex-tools.user.js` integriert |

> **Wichtig:** Diese Skripte sollten in Tampermonkey **deaktiviert** werden, wenn `cortex-tools.user.js` installiert ist, um doppelte UI-Elemente zu vermeiden. Sie bleiben im Repository als Referenz erhalten.

---

## Changelog

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
