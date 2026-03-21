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

/** Extract the CSRF token from meta tag or cookie. */
export function getCSRFToken(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="anti-csrftoken-a2z"]');
  if (meta) return meta.getAttribute('content');
  const cookies = document.cookie.split(';');
  for (const c of cookies) {
    const [k, v] = c.trim().split('=');
    if (k === 'anti-csrftoken-a2z') return v;
  }
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
