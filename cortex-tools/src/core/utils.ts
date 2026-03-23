// core/utils.ts – Shared helper functions and constants

import type { AppConfig } from './storage';

export const LOG_PREFIX = '[CortexTools]';

export const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export const API_URL = 'https://logistics.amazon.de/scheduling/home/api/v2/associate-attributes';

// ── Logging ────────────────────────────────────────────────────────────────

let _config: AppConfig | null = null;

/** Call once at startup to bind config to log helpers. */
export function initLogging(config: AppConfig): void {
  _config = config;
}

export const log = (...args: unknown[]): void => {
  if (_config?.dev) console.log(LOG_PREFIX, ...args);
};

export const err = (...args: unknown[]): void => {
  console.error(LOG_PREFIX, ...args);
};

// ── Dispose / Cleanup ──────────────────────────────────────────────────────

const _disposers: Array<() => void> = [];

export function onDispose(fn: () => void): () => void {
  _disposers.push(fn);
  return fn;
}

export function disposeAll(): void {
  while (_disposers.length) {
    try { _disposers.pop()!(); } catch { /* ignore */ }
  }
}

// ── DOM Helpers ────────────────────────────────────────────────────────────

/** HTML-escape a value so it is safe to interpolate into innerHTML. */
export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface WaitForElementOptions {
  timeout?: number;
}

/** Wait for a CSS selector to appear in the DOM. */
export function waitForElement(
  selector: string,
  { timeout = 15000 }: WaitForElementOptions = {},
): Promise<Element> {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const obs = new MutationObserver(() => {
      const el2 = document.querySelector(selector);
      if (el2) { obs.disconnect(); resolve(el2); }
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

/** Promise-based delay. */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
}

/** Retry an async function with exponential backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseMs = 500 }: RetryOptions = {},
): Promise<T> {
  let attempt = 0;
  while (true) {
    try { return await fn(); }
    catch (e) {
      if (++attempt > retries) throw e;
      await delay(baseMs * 2 ** (attempt - 1));
    }
  }
}

/** Extract the CSRF token from meta tag or cookie.
 *
 * Amazon Cortex has used several different token names over time.
 * We try all known variants in order of preference.
 */
export function getCSRFToken(): string | null {
  // 1. Try all known meta tag name variants
  const META_NAMES = [
    'anti-csrftoken-a2z',
    'csrf-token',
    'csrf',
    'x-csrf-token',
    '_csrf',
    'csrfToken',
  ];
  for (const name of META_NAMES) {
    const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (meta) {
      const token = meta.getAttribute('content');
      if (token) return token;
    }
  }

  // 2. Try all known cookie name variants
  const COOKIE_NAMES = [
    'anti-csrftoken-a2z',
    'csrf-token',
    'csrf',
    'x-csrf-token',
    '_csrf',
    'csrfToken',
    'session-token',
  ];
  const cookies = document.cookie.split(';');
  for (const c of cookies) {
    const eqIdx = c.indexOf('=');
    if (eqIdx === -1) continue;
    const k = c.slice(0, eqIdx).trim();
    const v = c.slice(eqIdx + 1).trim();
    if (COOKIE_NAMES.includes(k) && v) return v;
  }

  // 3. Try extracting from a hidden input field (some Amazon pages use this)
  const hiddenInput = document.querySelector<HTMLInputElement>(
    'input[name="anti-csrftoken-a2z"], input[name="csrf-token"], input[name="_csrf"]',
  );
  if (hiddenInput?.value) return hiddenInput.value;

  // 4. Try extracting from window.__csrf or similar globals via unsafeWindow
  try {
    const w = window as unknown as Record<string, unknown>;
    const candidates = ['__csrf', 'csrfToken', 'csrf_token', 'antiCsrfToken'];
    for (const key of candidates) {
      if (typeof w[key] === 'string' && (w[key] as string).length > 0) {
        return w[key] as string;
      }
    }
  } catch { /* ignore */ }

  return null;
}

/** Extract the session ID from cookies. */
export function extractSessionFromCookie(): string | null {
  const m = document.cookie.match(/session-id=([^;]+)/);
  return m ? m[1] : null;
}

/** Return today's date as YYYY-MM-DD string (local timezone). */
export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

/** Add N days to a YYYY-MM-DD date string. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
