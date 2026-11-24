'use client';

import * as React from 'react';

const FOCUSABLE = 'button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour every dialog shares: focus moves inside when it opens
 * (to `[data-autofocus]`, else the first control), Tab stays inside, Escape
 * closes (unless `escape` is false, e.g. a panel holding unsaved rows), and
 * focus goes back to whatever opened it.
 * @param {React.RefObject<HTMLElement | null>} ref the dialog element
 * @param {() => void} onClose
 * @param {{ escape?: boolean }} [opts]
 */
export function useDialogFocus(ref, onClose, { escape = true } = {}) {
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    const back = /** @type {HTMLElement | null} */ (document.activeElement);
    const el = ref.current;
    if (el) {
      const first = /** @type {HTMLElement | null} */ (el.querySelector('[data-autofocus]') || el.querySelector(FOCUSABLE));
      (first || el).focus({ preventScroll: true });
    }
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      const node = ref.current;
      if (!node) return;
      if (e.key === 'Escape' && escape) { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const f = /** @type {HTMLElement[]} */ ([...node.querySelectorAll(FOCUSABLE)]).filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!f.length) { e.preventDefault(); return; }
      const a = f[0], z = f[f.length - 1];
      const inside = node.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === a || !inside)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && (document.activeElement === z || !inside)) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      try { if (back && document.contains(back)) back.focus({ preventScroll: true }); } catch { /* the opener is gone */ }
    };
  }, [ref, escape]);
}
