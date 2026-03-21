# Code Style

## Logging

- Always prefix with `[CortexTools]`
- Gate verbose/debug logs behind a `dev` flag stored in GM storage
- Use `console.error` for unrecoverable errors; `console.warn` for degraded states

```js
const LOG_PREFIX = '[CortexTools]';
const DEV = GM_getValue('dev', false);
const log  = (...a) => DEV && console.log(LOG_PREFIX, ...a);
const warn = (...a) => console.warn(LOG_PREFIX, ...a);
const err  = (...a) => console.error(LOG_PREFIX, ...a);
```

## Error Handling

- Wrap all top-level entry points (`boot`, event handlers) in `try/catch`
- Log the error with context; degrade gracefully rather than breaking Cortex

## Security

- Escape all user-supplied or page-sourced strings before HTML injection:

```js
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
```

- Never use `innerHTML` with unescaped content; prefer `textContent` or `createElement`

## Versioning

- Follow SemVer (`MAJOR.MINOR.PATCH`); bump `@version` on every release
- Maintain a `CHANGELOG.md` with `Added / Changed / Fixed / Removed` sections
- Handle config migrations in `getConfig()` when stored shape changes

## Internationalization

- Default language: German (`de`); fallback: English (`en`)
- Centralize all user-facing strings:

```js
const I18N = {
  de: { settings: 'Einstellungen', enable: 'Aktivieren' },
  en: { settings: 'Settings',      enable: 'Enable'     },
};
const lang = navigator.language.startsWith('de') ? 'de' : 'en';
const t = (k) => I18N[lang]?.[k] ?? I18N.en[k] ?? k;
```

## Formatting

- Prettier: `printWidth: 80`, single quotes, trailing commas (`es5`)
- ESLint: standard config; no magic numbers (use named constants)
- Prefer early returns over deeply nested conditionals
- TypeScript with bundling to a single `.user.js` is recommended for larger scripts

## Repository Layout

```
src/          feature modules + utilities
styles/       CSS (or JS-in-CSS)
build/        bundler config, metadata header template
dist/         built *.user.js
CHANGELOG.md
README.md     purpose, install URL, required grants, shortcuts
LICENSE
```
