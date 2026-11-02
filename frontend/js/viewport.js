// --- Visual viewport helpers (on-screen keyboard awareness) ---
//
// On tablets the on-screen keyboard shrinks the *visual* viewport but leaves the
// *layout* viewport untouched. getBoundingClientRect() and scrollIntoView() both
// work in layout-viewport coordinates, so the browser happily considers an
// element "in view" while it sits behind the keyboard. Everything here compares
// against the visual viewport instead.

export function visualViewportBox() {
  const vv = window.visualViewport;
  if (!vv) return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  const top = vv.offsetTop || 0;
  return { top, bottom: top + vv.height, height: vv.height };
}

// How much of the layout viewport the keyboard covers (0 when it is closed).
export function keyboardOcclusion() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, (window.innerHeight || 0) - (vv.height || 0) - (vv.offsetTop || 0));
}

export function isKeyboardOpen() {
  return keyboardOcclusion() > 80; // heuristic: ignore URL-bar sized changes
}

// The panel an ARIA combobox controls (our autocomplete dropdown), if it is open.
export function openPanelFor(el) {
  const id = el?.getAttribute?.('aria-controls');
  const panel = id ? document.getElementById(id) : null;
  return panel && !panel.hidden ? panel : null;
}

// Scroll the document so `el` — and `companion`, e.g. its open dropdown — sit
// inside the visual viewport. The field itself always wins: we never scroll so
// far that it leaves the visible area to fit its dropdown.
export function ensureVisible(el, { companion = null, margin = 12, behavior = 'auto' } = {}) {
  if (!el) return;

  const vp = visualViewportBox();
  const r  = el.getBoundingClientRect();
  let top = r.top, bottom = r.bottom;

  if (companion) {
    const c = companion.getBoundingClientRect();
    if (c.height) { top = Math.min(top, c.top); bottom = Math.max(bottom, c.bottom); }
  }

  let delta = 0;
  if (bottom + margin > vp.bottom)   delta = bottom + margin - vp.bottom; // scroll down
  else if (top - margin < vp.top)    delta = top - margin - vp.top;       // scroll up
  if (!delta) return;

  // Clamp so the field stays fully visible either way.
  if (delta > 0) delta = Math.min(delta, Math.max(0, r.top - margin - vp.top));
  else           delta = Math.max(delta, Math.min(0, r.bottom + margin - vp.bottom));
  if (!delta) return;

  try { window.scrollBy({ top: delta, behavior }); }
  catch { window.scrollBy(0, delta); }
}
