// core/api.ts – Centralised service-area & DSP configuration + API helpers

import { log, err, getCSRFToken, withRetry } from './utils';
import { DEFAULTS } from './storage';
import type { AppConfig } from './storage';
import { esc } from './utils';

export interface ServiceArea {
  serviceAreaId: string;
  stationCode: string;
}

/**
 * Centralised configuration layer that auto-detects DSP, station, and
 * service areas from the user's company profile. Values are loaded once
 * and remain immutable for the session.
 *
 * Service areas come from:
 *   GET /account-management/data/get-company-service-areas
 *   → { success: true, data: [{ serviceAreaId, stationCode }] }
 *
 * DSP code is inferred from the company details page or performance API.
 */
export class CompanyConfig {
  private _loaded = false;
  private _loading: Promise<void> | null = null;
  private _serviceAreas: ServiceArea[] = [];
  private _dspCode: string | null = null;
  private _defaultStation: string | null = null;
  private _defaultServiceAreaId: string | null = null;

  constructor(private readonly config: AppConfig) {}

  /**
   * Load service areas and auto-detect DSP. Safe to call multiple times —
   * subsequent calls return the same promise.
   */
  async load(): Promise<void> {
    if (this._loaded) return;
    if (this._loading) return this._loading;
    this._loading = this._doLoad();
    await this._loading;
    this._loaded = true;
    this._loading = null;
  }

  private async _doLoad(): Promise<void> {
    // 1. Load service areas (also extracts DSP from stationCode prefix if possible)
    try {
      const resp = await fetch(
        'https://logistics.amazon.de/account-management/data/get-company-service-areas',
        { credentials: 'include' },
      );
      if (resp.ok) {
        const json = await resp.json();
        // Response may be { success, data: [...] } or { data: [...] } or just [...]
        const areas: unknown[] = json?.data ?? (Array.isArray(json) ? json : []);
        if (Array.isArray(areas) && areas.length > 0) {
          this._serviceAreas = areas as ServiceArea[];
          this._defaultServiceAreaId = (areas[0] as ServiceArea).serviceAreaId;
          this._defaultStation = (areas[0] as ServiceArea).stationCode;
          log('Loaded', areas.length, 'service areas');
        }
      }
    } catch (e) {
      err('Failed to load service areas:', e);
    }

    // 2. Auto-detect DSP code — try multiple known endpoint patterns
    const COMPANY_ENDPOINTS = [
      'https://logistics.amazon.de/account-management/data/get-company-details',
      'https://logistics.amazon.de/account-management/api/company',
      'https://logistics.amazon.de/account-management/api/v1/company',
    ];
    for (const endpoint of COMPANY_ENDPOINTS) {
      if (this._dspCode) break;
      try {
        const resp = await fetch(endpoint, { credentials: 'include' });
        if (!resp.ok) continue;
        const json = await resp.json();
        const dsp =
          json?.data?.dspShortCode ||
          json?.data?.companyShortCode ||
          json?.data?.shortCode ||
          json?.data?.dspCode ||
          json?.dspShortCode ||
          json?.dspCode ||
          json?.shortCode ||
          null;
        if (dsp) {
          this._dspCode = String(dsp).toUpperCase();
          log('Auto-detected DSP code from', endpoint, ':', this._dspCode);
        }
      } catch { /* try next endpoint */ }
    }

    // 2b. Fallback for external users: extract companyShortCode from route-summaries API.
    //     This API is accessible to all user types and carries a `companies` array with
    //     the DSP's short code — e.g. { companyShortCode: "FOUR", companyType: "DSP" }.
    if (!this._dspCode && this._defaultServiceAreaId) {
      try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const saId = encodeURIComponent(this._defaultServiceAreaId);
        const resp = await fetch(
          `https://logistics.amazon.de/operations/execution/api/route-summaries` +
          `?historicalDay=false&localDate=${today}&serviceAreaId=${saId}&statsFromSummaries=true`,
          { credentials: 'include' },
        );
        if (resp.ok) {
          const json = await resp.json() as Record<string, unknown>;
          const companies = json?.companies as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(companies) && companies.length > 0) {
            const dspCompany = companies.find(
              (c) => String(c['companyType']).toUpperCase() === 'DSP',
            ) ?? companies[0];
            const shortCode = dspCompany?.['companyShortCode'];
            if (shortCode && typeof shortCode === 'string' && shortCode.trim()) {
              this._dspCode = shortCode.trim().toUpperCase();
              log('DSP code from route-summaries companies:', this._dspCode);
            }
          }
        }
      } catch (e) {
        log('route-summaries DSP fallback failed:', e);
      }
    }

    // 3. Fallback: try extracting from page DOM elements
    if (!this._dspCode) {
      try {
        const selectors = [
          '[data-testid="company-name"]',
          '[data-testid="dsp-name"]',
          '.company-name',
          '.dsp-name',
          '[aria-label*="DSP"]',
          // Cortex nav often shows the DSP code in a breadcrumb or header
          'header [class*="company"]',
          'nav [class*="company"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = el.textContent?.trim() ?? '';
            // DSP codes are typically 3-8 uppercase alphanumeric characters
            if (text && /^[A-Z0-9]{2,10}$/.test(text)) {
              this._dspCode = text;
              log('DSP code from page element:', this._dspCode);
              break;
            }
          }
        }
      } catch { /* ignore */ }
    }

    // 4. Fallback: try extracting DSP from the current URL
    if (!this._dspCode) {
      try {
        const urlMatch = location.href.match(/[?&]dsp=([A-Z0-9]{2,10})/i);
        if (urlMatch) {
          this._dspCode = urlMatch[1].toUpperCase();
          log('DSP code from URL:', this._dspCode);
        }
      } catch { /* ignore */ }
    }

    // 5. Final fallback: use the saved config value
    if (!this._dspCode) {
      this._dspCode = this.config.deliveryPerfDsp || DEFAULTS.deliveryPerfDsp;
      log('Using saved DSP code:', this._dspCode);
    }
    if (!this._defaultStation) {
      this._defaultStation = this.config.deliveryPerfStation || DEFAULTS.deliveryPerfStation;
    }
    if (!this._defaultServiceAreaId) {
      this._defaultServiceAreaId = this.config.serviceAreaId || DEFAULTS.serviceAreaId;
    }
  }

  getServiceAreas(): ServiceArea[] {
    return this._serviceAreas;
  }

  getDspCode(): string {
    return this._dspCode || this.config.deliveryPerfDsp || DEFAULTS.deliveryPerfDsp;
  }

  getDefaultStation(): string {
    return this._defaultStation || this.config.deliveryPerfStation || DEFAULTS.deliveryPerfStation;
  }

  getDefaultServiceAreaId(): string {
    return this._defaultServiceAreaId || this.config.serviceAreaId || DEFAULTS.serviceAreaId;
  }

  /**
   * Build a service area `<option>` list for `<select>` elements.
   */
  buildSaOptions(selectedId?: string): string {
    if (this._serviceAreas.length === 0) {
      const fallback = selectedId || this.getDefaultServiceAreaId();
      return `<option value="${esc(fallback)}">${esc(this.getDefaultStation())}</option>`;
    }
    const sel = selectedId || this.getDefaultServiceAreaId();
    return this._serviceAreas.map((sa) => {
      const selected = sa.serviceAreaId === sel ? ' selected' : '';
      return `<option value="${esc(sa.serviceAreaId)}"${selected}>${esc(sa.stationCode)}</option>`;
    }).join('');
  }

  populateSaSelect(selectEl: HTMLSelectElement | null, selectedId?: string): void {
    if (!selectEl) return;
    selectEl.innerHTML = this.buildSaOptions(selectedId);
  }
}

// ── Generic fetch with CSRF + retry ──────────────────────────────────────────

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const csrf = getCSRFToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (csrf) headers['anti-csrftoken-a2z'] = csrf;

  return withRetry(async () => {
    const r = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    return r;
  }, { retries: 2, baseMs: 800 });
}
