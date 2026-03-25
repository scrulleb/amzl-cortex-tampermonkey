# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.1] - 2026-03-25

### Fixed
- **DVIC Post-Trip Auto-Submit – vehicle asset ID resolution**: Replaced the broken 3-endpoint fallback chain (which used speculative URLs that don't exist) and the `window.prompt` last-resort with a reliable batch-fetch approach. The fix calls `GET /fleet-management/api/vehicles?vehicleStatuses=ACTIVE,MAINTENANCE,PENDING` — the same proven endpoint used by the VSA QR Code feature — which returns the `assetId` per vehicle. The asset ID cache is now pre-populated during `_refresh()` so submit buttons can resolve IDs without any network round-trips on the critical path. If a vehicle is unexpectedly not in the cache, a single on-demand re-fetch is attempted; if still not found, a descriptive inline error is surfaced instead of a manual prompt.

## [1.4.0] - 2026-03-25

### Added
- **DVIC Post-Trip Auto-Submit**: New menu option "🚛 DVIC Post-Trip einreichen" to manually submit post-trip DVIC inspection reports directly from the DVIC Check dashboard
- Per-vehicle "▶ Einreichen" submit buttons in the Missing DVICs tab
- "🔄 Alle fehlenden einreichen" bulk submit button for submitting all missing post-trip DVICs at once
- Automatic pre-population of reporterId from the corresponding pre-trip DVIC submission
- Fallback prompt for manual reporterId entry when no pre-trip reporter is found
- Vehicle asset ID auto-resolution with multi-endpoint fallback and caching (replaced in v1.4.1 fix)
- `dvicAutoSubmit` feature flag in settings to enable/disable the auto-submit functionality
- 4-step API pipeline: upload template → dummy PNG upload → document metadata → inspection submission

### Changed
- DVIC Check Missing tab now includes an Action column with submit controls (when auto-submit is enabled)

## [1.3.3] - 2026-03-25

### Added

- **Scorecard – Week selector**: Replaced the free-text week input with a dynamic `<select>` dropdown populated by the new `scGenerateWeekOptions()` helper. The dropdown lists all 53 ISO weeks from exactly one year ago up to the current week (formatted as "Week N YYYY"), accounts for year boundaries, and defaults to the current week on load.
- **Scorecard – Row delete interaction**: Data rows are now clickable. Clicking a row expands an inline action submenu directly below it (only one open at a time). The submenu shows the DA name, a red **🗑 Delete** button that removes the row from the current view, and a **Cancel** button to collapse without action. The selected row receives a `.ct-sc-row--selected` highlight (amber tint + accent outline) to clearly indicate which entry is targeted.

### Changed

- **Scorecard – CSS** (`styles.ts`): Added `.ct-sc-row--selected`, `.ct-sc-data-row`, `.ct-sc-action-row`, `.ct-sc-action-inner`, `.ct-sc-btn-delete`, and a `@keyframes ct-sc-slide-down` animation (0.18 s ease-out) for the expand/collapse transition. The action cell uses a left red border as a destructive-action visual cue.

## [1.3.2] - 2026-03-23

### Fixed

- **API – DSP code detection**: Added multiple fallback strategies to reliably detect the DSP short code across all user types. Now queries several known company-details endpoint variants, falls back to route-summaries `companies` array (accessible to external/DA users), then tries DOM selectors and URL parameters before using the saved config value.
- **API – Service areas parsing**: Improved response handling to support different JSON shapes (`{ success, data }`, `{ data }`, or bare array) returned by the service-areas endpoint, preventing silent failures on some account types.
- **Utils – CSRF token extraction**: Extended token lookup to cover all known meta tag name variants (`anti-csrftoken-a2z`, `csrf-token`, `csrf`, `x-csrf-token`, `_csrf`, `csrfToken`), matching cookie names, hidden form inputs, and common `window.*` globals — resolving 403 errors on certain Cortex pages.
- **VSA QR – Vehicle list parsing**: Fixed vehicle data extraction when the API returns a nested `data` object instead of a top-level array. Now correctly drills into `data.vehicles`, `data.content`, `data.items`, `data.results`, or scans all values of the `data` object before falling back to a top-level scan.
