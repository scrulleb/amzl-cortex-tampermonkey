// ui/components.ts – Reusable UI component factory functions

import { esc } from '../core/utils';

// ── Toggle / Checkbox ──────────────────────────────────────────────────────

/**
 * Render a labelled toggle-switch row for the settings dialog.
 */
export function toggleHTML(id: string, label: string, checked: boolean): string {
  return `
    <div class="ct-settings-row">
      <label for="${esc(id)}">${esc(label)}</label>
      <label class="ct-toggle">
        <input type="checkbox" id="${esc(id)}" ${checked ? 'checked' : ''}>
        <span class="ct-slider"></span>
      </label>
    </div>
  `;
}

// ── Pagination ─────────────────────────────────────────────────────────────

export interface PaginationState {
  current: number;
  total: number;
  pageSize: number;
}

export interface PaginationCallbacks {
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Render a simple prev/next pagination bar.
 * @param wrapClass  – CSS class prefix string, e.g. 'ct-dvic'
 */
export function renderPagination(
  container: HTMLElement,
  paginationClass: string,
  state: PaginationState,
  callbacks: PaginationCallbacks,
): void {
  const totalPages = Math.ceil(state.total / state.pageSize) || 1;
  const wrap = document.createElement('div');
  wrap.className = `${paginationClass}-pagination`;
  wrap.innerHTML = `
    <button class="ct-btn ct-btn--secondary" id="${paginationClass}-prev"
            ${state.current <= 1 ? 'disabled' : ''}>◀ Zurück</button>
    <span class="${paginationClass}-page-info">
      Seite ${state.current} / ${totalPages} (${state.total} Einträge)
    </span>
    <button class="ct-btn ct-btn--secondary" id="${paginationClass}-next"
            ${state.current >= totalPages ? 'disabled' : ''}>Weiter ▶</button>
  `;
  container.appendChild(wrap);
  wrap.querySelector(`#${paginationClass}-prev`)?.addEventListener('click', callbacks.onPrev);
  wrap.querySelector(`#${paginationClass}-next`)?.addEventListener('click', callbacks.onNext);
}

// ── Summary tiles ──────────────────────────────────────────────────────────

export interface Tile {
  value: string | number;
  label: string;
  modifierClass?: string;
}

/**
 * Render a row of stat tiles.
 * @param tileClass  – CSS class prefix, e.g. 'ct-dvic'
 */
export function renderTiles(tileClass: string, tiles: Tile[]): string {
  const inner = tiles.map((t) => `
    <div class="${tileClass}-tile ${t.modifierClass ?? ''}">
      <div class="${tileClass}-tile-val">${esc(String(t.value))}</div>
      <div class="${tileClass}-tile-lbl">${esc(t.label)}</div>
    </div>
  `).join('');
  return `<div class="${tileClass}-tiles">${inner}</div>`;
}

// ── Loading / Error / Empty states ────────────────────────────────────────

export function loadingHTML(cssClass: string, msg = 'Laden…'): string {
  return `<div class="${cssClass}-loading" role="status">${esc(msg)}</div>`;
}

export function errorHTML(cssClass: string, msg: string): string {
  return `<div class="${cssClass}-error" role="alert">❌ ${esc(msg)}</div>`;
}

export function emptyHTML(cssClass: string, msg = 'Keine Daten gefunden.'): string {
  return `<div class="${cssClass}-empty">${esc(msg)}</div>`;
}
