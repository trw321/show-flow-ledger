import type { ForwardedRef } from 'react';

/**
 * Text in a dialog or sheet can be selected with a finger again.
 *
 * Their scroll lock (react-remove-scroll, inside Radix) cancels every finger
 * drag on something that can't scroll, so the page behind stays still on an
 * iPhone. That also cancelled the drag that stretches a selection: in a
 * notes box you could put the cursor in, but not select across words, so no
 * copy or paste. A drag that starts in a text box, or while text inside the
 * panel is selected, now stops at the panel and never reaches the lock.
 * Every other drag is locked as before.
 */

const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** A box you type in. */
export function isTextField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !NOT_TEXT.has(el.type);
}

/** Text selected inside the panel. */
function selectingIn(panel: HTMLElement): boolean {
  const sel = document.getSelection();
  return !!sel && sel.rangeCount > 0 && !sel.isCollapsed && !!sel.anchorNode && panel.contains(sel.anchorNode);
}

const wired = new WeakSet<HTMLElement>();

/** Sets a panel up, once, so a drag that is selecting text isn't cancelled. */
export function letTextBeSelected(panel: HTMLElement | null): void {
  if (!panel || wired.has(panel)) return;
  wired.add(panel);
  panel.addEventListener('touchmove', e => {
    if (isTextField(e.target) || selectingIn(panel)) e.stopPropagation();
  }, { passive: true });
}

/** A ref for a dialog or sheet panel: sets it up, and passes the node on to the caller's own ref. */
export function selectableRef<T extends HTMLElement>(ref: ForwardedRef<T>) {
  return (node: T | null) => {
    letTextBeSelected(node);
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
}
