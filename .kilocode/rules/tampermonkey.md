# Tampermonkey Userscript Guidelines

Userscripts targeting `https://logistics.amazon.de/*` ("Cortex"). Cortex is a SPA — scripts must handle route changes.

## Metadata Essentials

- Use `@run-at document-idle` and a precise `@match` (never `@include *`)
- Declare only the `@grant` entries actually used
- Whitelist external domains with `@connect`; never use `@connect *`

## Universal Rules

- **SPA navigation:** Always call `disposeAll()` before re-initializing on route change; use `onUrlChange(boot)` — see [Architecture](tampermonkey/architecture.md)
- **DOM selectors:** Prefer `aria-*`, `data-*`, and text-content selectors over generated CSS class names
- **Waiting for elements:** Use `waitForElement()` — never raw `querySelector` on a DOM that may not be ready
- **Security:** No `unsafeWindow` unless unavoidable; always escape user-supplied or page-sourced content before HTML injection
- **Styles:** Inject all CSS in a single `GM_addStyle()` call; use BEM-style class prefixes (e.g., `.ct-`) to avoid collisions
- **Logging:** Prefix all logs with `[CortexTools]`; gate verbose logs behind a `dev` flag

## Detailed Guidelines

- [Architecture & Init Flow](tampermonkey/architecture.md) — module pattern, SPA listener, disposal
- [UI & UX](tampermonkey/ui-and-ux.md) — hotkeys, ARIA, styling, help overlay
- [Config & Network](tampermonkey/config-and-network.md) — feature flags, GM storage, retry logic
- [Code Style](tampermonkey/code-style.md) — logging, i18n, versioning, coding conventions
