/**
 * A day made of more than one call.
 *
 * A dispatch day is often written as a run of in/out times with the meals left
 * implicit — "8-10, 11-3, 4-7" is three calls with an hour out between each, and
 * nobody writes "60min meal" because the gap already says it. This reads that
 * shorthand into calls and gaps so the gaps can be priced as meals, each one
 * either on or off the clock.
 *
 * Hours follow the same convention as everywhere else in the app: hoursWorked is
 * the span that was clocked, and an off-the-clock meal is what comes off it. So
 * a day's worked hours are the whole spread from the first in to the last out,
 * minus every gap left off the clock — which is the same number as the calls
 * added up plus any gap that stayed on it.
 */

/**
 * A break of two hours or more is a split shift — two separate calls that happen
 * to fall on one date. Anything shorter is one shift with a meal in the middle,
 * however many meals that comes to.
 */
export const SPLIT_BREAK_MINUTES = 120;

/**
 * A meal penalty is an hour's pay, owed for working past five CONSECUTIVE hours
 * without being fed. Being fed is the whole test: whether the meal was on or off
 * the clock changes the pay, not the penalty, and its length does not matter
 * either — half an hour with food in it restarts the five hours exactly as an
 * hour does. So the only stretch that owes anything is one that ran past five
 * hours with no meal in it at all, and a long unbroken day owes another penalty
 * for every five hours it keeps going.
 *
 * Suggested, not charged: mealPenalties stays something the user confirms.
 */
export const MEAL_PENALTY_AFTER_HOURS = 5;

export interface DayCall {
  /** "08:00 AM" — the app's time format throughout. */
  start: string;
  end: string;
  /** Length of this call on the clock, in hours. */
  hours: number;
}

export interface DayGap {
  start: string;
  end: string;
  minutes: number;
  /** Two hours or more out: this gap splits the day rather than breaking it. */
  isSplitBreak: boolean;
  /**
   * A gap you stayed on the clock through is paid and does not come off the
   * day. Clocking out is the normal case, so gaps default to off the clock.
   */
  onClock: boolean;
}

export interface DayTimeline {
  calls: DayCall[];
  gaps: DayGap[];
  /** First in to last out, including every gap. */
  spreadHours: number;
  /** Spread minus the gaps left off the clock. */
  workedHours: number;
  offClockMinutes: number;
  /** True once any gap is long enough to make this two shifts instead of one. */
  isSplit: boolean;
  /**
   * The day's calls grouped into shifts: one group per stretch between split
   * breaks. A day with only short breaks is a single group, however many meals.
   */
  shifts: DayCall[][];
  /** How long each unbroken stretch of work ran, in hours. */
  workedStretches: number[];
  /** Penalties the five-hour rule implies, for the user to confirm. */
  suggestedMealPenalties: number;
}

const TIME = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|a|p)?/gi;
const RANGE_SPLIT = /(?:,|;|\band\b|&|\bthen\b|\n|\/)+/i;

function fmt(totalMinutes: number): string {
  const mins = ((totalMinutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Resolve a bare hour against the time before it. Shorthand almost never spells
 * out am/pm, so each time is read as the earliest reading that still comes after
 * the previous one: in "11-3", the 3 can only be the afternoon.
 */
function resolve(hour: number, minute: number, meridiem: string | undefined, after: number | null): number {
  const ap = (meridiem || '').toLowerCase().replace(/\./g, '');
  let h = hour;
  if (ap.startsWith('p')) { if (h < 12) h += 12; }
  else if (ap.startsWith('a')) { if (h === 12) h = 0; }
  else if (after === null) {
    // The first time of the day, with nothing to anchor it: a call at 1–5 is an
    // afternoon call, 6–11 is a morning one. 12 stays noon.
    if (h >= 1 && h <= 5) h += 12;
  }
  let candidate = h * 60 + minute;
  if (after !== null) {
    while (candidate < after) candidate += ap ? 1440 : 720;
  }
  return candidate;
}

/**
 * Reads "8-10, 11-3, 4-7" (and "8a-10a and 11-3", "9a-2p then 10:30p-3am", or
 * the same with stray "lunch"/"meal" words) into calls and the gaps between
 * them. Returns null when no time range can be found at all.
 */
export function parseDayTimeline(input: string, gapsOnClock: boolean[] = []): DayTimeline | null {
  const pieces = input.split(RANGE_SPLIT).map(p => p.trim()).filter(Boolean);
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor: number | null = null;

  for (const piece of pieces) {
    TIME.lastIndex = 0;
    const found = [...piece.matchAll(TIME)].filter(m => m[0].trim() !== '');
    if (found.length < 2) continue;
    const [a, b] = found;
    const start = resolve(parseInt(a[1]), parseInt(a[2] || '0'), a[3], cursor);
    const end = resolve(parseInt(b[1]), parseInt(b[2] || '0'), b[3], start + 1);
    ranges.push({ start, end });
    cursor = end;
  }

  if (ranges.length === 0) return null;

  const calls: DayCall[] = ranges.map(r => ({
    start: fmt(r.start),
    end: fmt(r.end),
    hours: (r.end - r.start) / 60,
  }));

  const gaps: DayGap[] = [];
  for (let i = 1; i < ranges.length; i++) {
    const minutes = ranges[i].start - ranges[i - 1].end;
    if (minutes <= 0) continue;
    gaps.push({
      start: fmt(ranges[i - 1].end),
      end: fmt(ranges[i].start),
      minutes,
      isSplitBreak: minutes >= SPLIT_BREAK_MINUTES,
      onClock: gapsOnClock[gaps.length] ?? false,
    });
  }

  const spreadMinutes = ranges[ranges.length - 1].end - ranges[0].start;
  const offClockMinutes = gaps.reduce((sum, g) => sum + (g.onClock ? 0 : g.minutes), 0);

  return { calls, gaps, spreadHours: spreadMinutes / 60, workedHours: (spreadMinutes - offClockMinutes) / 60, offClockMinutes, ...derive(calls, gaps) };
}

/**
 * Everything that follows from the calls and gaps rather than from the clock:
 * where the day splits, how long it was worked without a break, and what the
 * five-hour rule implies.
 */
function derive(calls: DayCall[], gaps: DayGap[]) {
  const shifts: DayCall[][] = [];
  const workedStretches: number[] = [];
  // Whether each stretch ended in a meal. One that did owes nothing; one that ran
  // to the end of the day unfed is what the five-hour rule is about.
  const stretchClosedByMeal: boolean[] = [];
  let group: DayCall[] = [];
  let stretch = 0;

  calls.forEach((call, i) => {
    group.push(call);
    stretch += call.hours;
    const gap = gaps[i];
    if (!gap) return;
    // Two hours or more out ends the shift, not just the stretch.
    if (gap.isSplitBreak) { shifts.push(group); group = []; }
    // Any gap at all is a meal, and a meal means they fed you — so the five
    // hours start again from here whether it was paid or not.
    workedStretches.push(stretch);
    stretchClosedByMeal.push(true);
    stretch = 0;
  });
  if (group.length) shifts.push(group);
  // The last stretch runs to the end of the day, so nothing broke it.
  if (stretch > 0) { workedStretches.push(stretch); stretchClosedByMeal.push(false); }

  const suggestedMealPenalties = workedStretches.reduce(
    (n, hours, i) => n + (stretchClosedByMeal[i] ? 0 : Math.max(0, Math.ceil(hours / MEAL_PENALTY_AFTER_HOURS) - 1)),
    0
  );

  return {
    isSplit: gaps.some(g => g.isSplitBreak),
    shifts,
    workedStretches,
    suggestedMealPenalties,
  };
}

/**
 * Re-prices a timeline after a gap's on/off-the-clock choice changes, without
 * re-parsing the text.
 */
export function withGapOnClock(timeline: DayTimeline, gapIndex: number, onClock: boolean): DayTimeline {
  const gaps = timeline.gaps.map((g, i) => (i === gapIndex ? { ...g, onClock } : g));
  const offClockMinutes = gaps.reduce((sum, g) => sum + (g.onClock ? 0 : g.minutes), 0);
  return {
    ...timeline,
    gaps,
    offClockMinutes,
    workedHours: (timeline.spreadHours * 60 - offClockMinutes) / 60,
    ...derive(timeline.calls, gaps),
  };
}
