import { useSyncExternalStore } from 'react';

/**
 * Preamp: the to-dos (hours to log, shifts to check, pay that's late). The
 * calendar works them out and says how many there are; the filament lamp in
 * the header runs red hot while there are any, and tapping it asks for the
 * list. The count outlives the calendar page, so the lamp stays hot on other
 * pages until the to-dos are dealt with.
 */

// Remembered between loads, so the lamp is right on whatever page the app
// opens to, before the calendar has been shown again.
const STORE_KEY = 'show-flow-preamp-count';
function remembered(): number {
  try { return Math.max(0, Number(localStorage.getItem(STORE_KEY)) || 0); } catch { return 0; }
}

let count = remembered();
const listeners = new Set<() => void>();
export const PREAMP_OPEN_EVENT = 'show-flow:preamp-open';

export function setPreampCount(next: number): void {
  if (next === count) return;
  count = next;
  try { localStorage.setItem(STORE_KEY, String(next)); } catch { /* the lamp still works for this visit */ }
  listeners.forEach(l => l());
}

export function usePreampCount(): number {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l); },
    () => count,
    () => 0,
  );
}

/** Asks the open calendar to show the list. */
export function requestPreampOpen(): void {
  window.dispatchEvent(new Event(PREAMP_OPEN_EVENT));
}
