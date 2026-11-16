/**
 * The arithmetic behind the live pay counter, kept out of the component so it
 * can be tested without a clock.
 */

/** A lunch taken while the counter runs. No end yet means it's still going. */
export interface WorkBreak {
  start: number;
  end?: number;
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
  return openBreak(breaks)?.start ?? now;
}

/** Finished lunches, each a minute or more, inside the working span. */
function takenBreaks(breaks: WorkBreak[], from: number, to: number): Array<{ start: number; end: number }> {
  return breaks
    .filter((b): b is { start: number; end: number } => b.end !== undefined)
    .map(b => ({ start: Math.max(b.start, from), end: Math.min(b.end, to) }))
    .filter(b => b.end - b.start >= MIN_BREAK_MS);
}

/** Time out on lunch between clocking in and the end of work. */
export function lunchMs(from: number, to: number, breaks: WorkBreak[] = []): number {
  return takenBreaks(breaks, from, to).reduce((sum, b) => sum + (b.end - b.start), 0);
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
  const to = workEnd(breaks, now);
  const taken = takenBreaks(breaks, from, to);
  if (taken.length === 0) return '';
  const calls: string[] = [];
  let start = from;
  for (const b of taken) {
    if (b.start > start) calls.push(`${shortTime(start)}-${shortTime(b.start)}`);
    start = b.end;
  }
  if (to > start) calls.push(`${shortTime(start)}-${shortTime(to)}`);
  return calls.join(', ');
}
