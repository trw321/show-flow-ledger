import type { NavigateFunction } from 'react-router-dom';

/**
 * Where you were on a page when you opened a shift from it, so closing the
 * shift brings you back to the same place: the page, the employer box you had
 * open, and how far down you'd scrolled. Kept for this tab only, used once,
 * and forgotten after an hour so an old trip never moves a fresh visit.
 */
export interface ReturnSpot {
  path: string;
  scrollY: number;
  /** The employer whose box the shift was opened from: open again on the way back. */
  employer?: string;
}

const KEY = 'show-flow-return-spot';
const FRESH_MS = 60 * 60 * 1000;

/** The state a link to a shift carries, so the calendar knows to come back. */
export interface ReturnState { returnTo: string }

/** Say where you are, just before leaving for a shift. */
export function rememberSpot(spot: ReturnSpot): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...spot, at: Date.now() }));
  } catch { /* closing still comes back, to the top of the page */ }
}

/** The spot saved for this page, if it's recent. Doesn't use it up: see clearSpot. */
export function peekSpot(path: string): ReturnSpot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const spot = JSON.parse(raw) as ReturnSpot & { at?: number };
    if (spot?.path !== path || typeof spot.scrollY !== 'number') return null;
    if (typeof spot.at !== 'number' || Date.now() - spot.at > FRESH_MS) return null;
    return { path: spot.path, scrollY: spot.scrollY, employer: typeof spot.employer === 'string' ? spot.employer : undefined };
  } catch {
    return null;
  }
}

/** Used: the next visit starts fresh. */
export function clearSpot(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Open a shift on the calendar from a page, coming back to the same place on it when the shift is closed. */
export function openShiftAndReturn(navigate: NavigateFunction, jobId: string, spot: Omit<ReturnSpot, 'scrollY'>): void {
  openAndReturn(navigate, `/?job=${encodeURIComponent(jobId)}`, spot);
}

/** Open a whole day on the calendar (a split day's every call), coming back the same way. */
export function openDayAndReturn(navigate: NavigateFunction, date: string, spot: Omit<ReturnSpot, 'scrollY'>): void {
  openAndReturn(navigate, `/?day=${encodeURIComponent(date)}`, spot);
}

function openAndReturn(navigate: NavigateFunction, to: string, spot: Omit<ReturnSpot, 'scrollY'>): void {
  rememberSpot({ ...spot, scrollY: window.scrollY });
  const state: ReturnState = { returnTo: spot.path };
  navigate(to, { state });
}
