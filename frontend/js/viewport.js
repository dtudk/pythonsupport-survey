// The on-screen keyboard shrinks the visual viewport, not the layout viewport that
// getBoundingClientRect() and scrollIntoView() use, so these compare against the visual one.

export function visualViewportBox() {
  const vv = window.visualViewport;
  if (!vv) return { top: 0, bottom: window.innerHeight, height: window.innerHeight };
  const top = vv.offsetTop || 0;
  return { top, bottom: top + vv.height, height: vv.height };
}

export function keyboardOcclusion() {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, (window.innerHeight || 0) - (vv.height || 0) - (vv.offsetTop || 0));
}

export function isKeyboardOpen() {
  return keyboardOcclusion() > 80; // heuristic: ignore URL-bar sized changes
}

export function openPanelFor(el) {
  const id = el?.getAttribute?.('aria-controls');
  const panel = id ? document.getElementById(id) : null;
  return panel && !panel.hidden ? panel : null;
}

// `el` always stays fully visible, even if `companion` (its open dropdown) doesn't fit.
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
  if (bottom + margin > vp.bottom)   delta = bottom + margin - vp.bottom;
  else if (top - margin < vp.top)    delta = top - margin - vp.top;
  if (!delta) return;

  if (delta > 0) delta = Math.min(delta, Math.max(0, r.top - margin - vp.top));
  else           delta = Math.max(delta, Math.min(0, r.bottom + margin - vp.bottom));
  if (!delta) return;

  try { window.scrollBy({ top: delta, behavior }); }
  catch { window.scrollBy(0, delta); }
}
