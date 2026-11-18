/**
 * The arithmetic behind the live pay counter, kept out of the component so it
 * can be tested without a clock.
 */

/** A meal taken while the counter runs. No end yet means it's still going. */
export interface WorkBreak {
  start: number;
  end?: number;
  /** Paid, so it counts as worked and isn't taken off the hours. Unset: off the clock. */
  onClock?: boolean;
}

/** A break shorter than this was a mis-tap, not a meal. */
const MIN_BREAK_MS = 60_000;

/** "Work starts in 2 minutes": the reminder shows anywhere inside the hour, so it says how far inside. */
export function startsInLabel(msUntilStart: number): string {
  const minutes = Math.max(1, Math.ceil(msUntilStart / 60_000));
  if (minutes >= 55) return 'Work starts in about an hour';
  return `Work starts in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** The lunch still going, if there is one. */
export function openBreak(breaks: WorkBreak[] = []): WorkBreak | undefined {
  const last = breaks[breaks.length - 1];
  return last && last.end === undefined ? last : undefined;
}

/**
 * When the work itself stopped: now, or when the current lunch began. Ending
 * the day mid-lunch ends it where the lunch started.
 */
export function workEnd(breaks: WorkBreak[] = [], now: number): number {
  // A meal on the clock is paid, so the clock keeps running through it.
  const open = openBreak(breaks);
  return open && !open.onClock ? open.start : now;
}

/** Finished lunches, each a minute or more, inside the working span. */
function takenBreaks(breaks: WorkBreak[], from: number, to: number): Array<{ start: number; end: number; onClock: boolean }> {
  return breaks
    .filter((b): b is WorkBreak & { end: number } => b.end !== undefined)
    .map(b => ({ start: Math.max(b.start, from), end: Math.min(b.end, to), onClock: !!b.onClock }))
    .filter(b => b.end - b.start >= MIN_BREAK_MS);
}

/** Time out on meals off the clock between clocking in and the end of work. A meal on the clock is paid and isn't counted. */
export function lunchMs(from: number, to: number, breaks: WorkBreak[] = []): number {
  return takenBreaks(breaks, from, to).filter(b => !b.onClock).reduce((sum, b) => sum + (b.end - b.start), 0);
}

/** Time worked: clock-in to the end of work, minus every lunch. */
export function workedMs(from: number, now: number, breaks: WorkBreak[] = []): number {
  const to = workEnd(breaks, now);
  return Math.max(0, to - from - lunchMs(from, to, breaks));
}

function shortTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${m}${h < 12 ? 'am' : 'pm'}`;
}

/**
 * The day as calls with the lunches as the gaps between them, in the same
 * shorthand a day is typed in ("8:00am-12:03pm, 1:05pm-6:30pm"), so the pay
 * maths treats a live lunch exactly like a typed one: off the clock, taken off
 * the hours. Empty when no lunch was taken.
 */
export function liveCallsText(from: number, now: number, breaks: WorkBreak[] = []): string {
  return liveDay(from, now, breaks).text;
}

/**
 * The day as calls with the meals as the gaps, and which gaps were on the
 * clock, in the shape a typed day is saved in (callTimeline and
 * callGapsOnClock), so the pay maths treats a live meal exactly like a typed
 * one: off the clock it comes off the hours, on the clock it's paid.
 */
export function liveDay(from: number, now: number, breaks: WorkBreak[] = []): { text: string; gapsOnClock: boolean[] } {
  const to = workEnd(breaks, now);
  const taken = takenBreaks(breaks, from, to);
  if (taken.length === 0) return { text: '', gapsOnClock: [] };
  const calls: string[] = [];
  const gapsOnClock: boolean[] = [];
  let start = from;
  let gapBefore: boolean | null = null;
  const addCall = (a: number, b: number) => {
    if (calls.length > 0 && gapBefore !== null) gapsOnClock.push(gapBefore);
    calls.push(`${shortTime(a)}-${shortTime(b)}`);
  };
  for (const b of taken) {
    if (b.start > start) addCall(start, b.start);
    gapBefore = b.onClock;
    start = b.end;
  }
  if (to > start) addCall(start, to);
  return { text: calls.join(', '), gapsOnClock };
}

/** Meal lengths offered, in minutes. */
export const MEAL_LENGTHS = [30, 45, 60] as const;

/**
 * The breaks with a meal added: one that started at `start` and ran
 * `minutes`, or is still going when minutes is null. Entered after the
 * fact, so it can't be missed by not tapping on time. A meal it overlaps
 * is replaced, not doubled.
 */
export function withMeal(breaks: WorkBreak[], start: number, minutes: number | null, onClock = false): WorkBreak[] {
  const meal: WorkBreak = minutes == null ? { start } : { start, end: start + minutes * 60_000 };
  if (onClock) meal.onClock = true;
  const end = meal.end ?? Infinity;
  const kept = breaks.filter(b => (b.end ?? Infinity) <= start || b.start >= end);
  // A meal still going is the last break: openBreak looks there.
  return [...kept, meal].sort((a, b) => (a.end === undefined ? 1 : b.end === undefined ? -1 : a.start - b.start));
}

/** A time snapped to the 5 minutes at or before it. */
export function toFiveMinutes(timestamp: number): number {
  return Math.floor(timestamp / 300_000) * 300_000;
}
