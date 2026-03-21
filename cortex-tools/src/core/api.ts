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
    // 1. Load service areas
    try {
      const resp = await fetch(
        'https://logistics.amazon.de/account-management/data/get-company-service-areas',
        { credentials: 'include' },
      );
      const json = await resp.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        this._serviceAreas = json.data as ServiceArea[];
        this._defaultServiceAreaId = json.data[0].serviceAreaId;
        this._defaultStation = json.data[0].stationCode;
        log('Loaded', json.data.length, 'service areas');
      }
    } catch (e) {
      err('Failed to load service areas:', e);
    }

    // 2. Auto-detect DSP code from company details
    try {
      const resp = await fetch(
        'https://logistics.amazon.de/account-management/data/get-company-details',
        { credentials: 'include' },
      );
      const json = await resp.json();
      const dsp =
        json?.data?.dspShortCode ||
        json?.data?.companyShortCode ||
        json?.data?.shortCode ||
        json?.dspShortCode ||
        null;
      if (dsp) {
        this._dspCode = String(dsp).toUpperCase();
        log('Auto-detected DSP code:', this._dspCode);
      }
    } catch {
      log('Company details not available, will detect DSP from performance data');
    }

    // 3. Fallback: try extracting from page content
    if (!this._dspCode) {
      try {
        const navEl = document.querySelector(
          '[data-testid="company-name"], .company-name, .dsp-name',
        );
        if (navEl) {
          const text = navEl.textContent?.trim() ?? '';
          if (text && text.length <= 10) {
            this._dspCode = text.toUpperCase();
            log('DSP code from page element:', this._dspCode);
          }
        }
      } catch { /* ignore */ }
    }

    // 4. Final fallback: use the saved config value
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
