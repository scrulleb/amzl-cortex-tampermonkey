# Config & Network

## Feature Flags & Persistent Config

- Use `GM_getValue` / `GM_setValue` for all persistent settings
- Always merge user config over defaults — never overwrite the entire object
- Expose a settings UI via `GM_registerMenuCommand`

```js
const DEFAULTS = {
  enabled: true,
  features: { hotkeys: true, export: false },
};

function getConfig() {
  const saved = GM_getValue('config');
  return saved ? { ...DEFAULTS, ...saved, features: { ...DEFAULTS.features, ...saved.features } } : DEFAULTS;
}
function setConfig(next) { GM_setValue('config', next); }
```

### Config Migration

When adding new keys, always supply a default in `DEFAULTS` — do not assume saved configs have the new key.

## Network Requests

| Scenario | Use |
|---|---|
| Same-origin requests | `fetch()` |
| Cross-origin / CORS bypass | `GM_xmlhttpRequest` |

- Declare every external domain in `@connect` — never use `@connect *`
- Do not send sensitive page data (order IDs, user details) to external services without explicit user opt-in

## Retry with Exponential Backoff

Wrap all network calls that may encounter 429 or 5xx errors:

```js
async function withRetry(fn, { retries = 3, baseMs = 500 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (++attempt > retries) throw e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** (attempt - 1)));
    }
  }
}
```

- Log each retry attempt at debug level with attempt number and wait time
- Surface a user-facing error after all retries are exhausted — do not silently fail
