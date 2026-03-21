# UI & UX Guidelines

## Hotkeys

- Register all hotkeys through a single `registerHotkeys(map)` utility — do not scatter `addEventListener('keydown', ...)` calls
- Skip if modifier keys are held (`altKey`, `ctrlKey`, `metaKey`) unless explicitly intended
- Always call `e.preventDefault()` when consuming a key
- Register cleanup via `onDispose`

```js
function registerHotkeys(map) {
  const handler = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const fn = map[e.key.toLowerCase()];
    if (fn) { e.preventDefault(); fn(e); }
  };
  window.addEventListener('keydown', handler);
  onDispose(() => window.removeEventListener('keydown', handler));
}
```

## Help Overlay

- Provide a `?` key (or GM menu entry) that shows available shortcuts
- The overlay must be dismissible via `Escape` and clicking outside
- List keys and their actions clearly; keep it minimal

## Styling Rules

- Inject **all CSS in a single `GM_addStyle()` call** at init time
- Use `.ct-` prefix for all classes to avoid collisions with Cortex styles
- Support `prefers-color-scheme: dark` where possible
- Avoid layout shift (CLS): use fixed dimensions for injected containers, avoid unsized images
- Do not use inline styles on dynamically created elements — add CSS classes instead

```js
GM_addStyle(`
  .ct-toolbar { position: fixed; top: 88px; right: 16px; z-index: 9999; }
  .ct-overlay  { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 10000; }
  @media (prefers-color-scheme: dark) {
    .ct-toolbar { background: #1e1e1e; color: #fff; }
  }
`);
```

## ARIA & Accessibility

- Add `role`, `aria-label`, and `aria-live` to injected UI elements
- Trap focus inside modal overlays; restore focus on close
- Keyboard navigation must be fully functional without a mouse

## Invasiveness

- Keep UI changes minimal and clearly distinguishable from native Cortex UI
- Actions with irreversible effects (bulk actions, deletions) require explicit confirmation
- Provide a "Pause script" menu command that cleanly undoes all changes
