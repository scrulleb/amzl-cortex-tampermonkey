// ui/overlay.ts – Shared overlay / modal lifecycle helpers

/**
 * Create a full-screen overlay div and append it to document.body.
 * The overlay is initially hidden; call `.classList.add('visible')` to show.
 *
 * @param id   – The element ID for the overlay root
 * @param html – Inner HTML (the panel/dialog content)
 * @param onBackdropClick – Optional callback when the backdrop is clicked
 */
export function createOverlay(
  id: string,
  html: string,
  onBackdropClick?: () => void,
): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'ct-overlay';
  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  if (onBackdropClick) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) onBackdropClick();
    });
  }

  return overlay;
}

/** Show an overlay by adding the 'visible' class. */
export function showOverlay(overlay: HTMLElement | null): void {
  overlay?.classList.add('visible');
}

/** Hide an overlay by removing the 'visible' class. */
export function hideOverlay(overlay: HTMLElement | null): void {
  overlay?.classList.remove('visible');
}

/** Remove an overlay from the DOM and null-safe cleanup. */
export function destroyOverlay(overlay: HTMLElement | null): void {
  overlay?.remove();
}

/**
 * Bind a close button (by its element ID) to hide the overlay.
 */
export function bindCloseButton(btnId: string, onClose: () => void): void {
  const btn = document.getElementById(btnId);
  btn?.addEventListener('click', onClose);
}

/**
 * Set the text content of a status element safely.
 */
export function setStatus(elementId: string, msg: string): void {
  const el = document.getElementById(elementId);
  if (el) el.textContent = msg;
}

/**
 * Set the innerHTML of a body/result container safely.
 */
export function setBody(elementId: string, html: string): void {
  const el = document.getElementById(elementId);
  if (el) el.innerHTML = html;
}

/**
 * Create a simple debounce wrapper.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
