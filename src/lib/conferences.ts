import { addDays, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { showDay } from './today';

/**
 * Conferences to look out for: the big shows that come round every year, on
 * different days each time. Kept with your synced settings, like your
 * network. A year's dates go in once they're announced; until then the month
 * it usually falls in stands in, and Preamp asks you to look the dates up.
 */

export interface ConferenceDates {
  /** First day, YYYY-MM-DD. */
  start: string;
  /** Last day, YYYY-MM-DD. The same as start for a one-day show. */
  end: string;
}

export interface Conference {
  id: string;
  name: string;
  /** City or venue. */
  where?: string;
  /** The month it usually falls in, 1 to 12. Unset: the month of its latest dates. */
  usualMonth?: number;
  /** Its dates, one entry a year, as they're announced. Kept oldest first. */
  dates: ConferenceDates[];
  /** How many weeks ahead to be told. Unset: DEFAULT_REMIND_WEEKS. */
  remindWeeks?: number;
  /** Where the dates get posted. */
  link?: string;
  notes?: string;
  createdAt: string;
}

export const DEFAULT_REMIND_WEEKS = 8;
export const REMIND_WEEK_CHOICES = [2, 4, 6, 8, 12, 16] as const;
/** The calendar's mark for a conference day: gold, apart from every job colour. */
export const CONFERENCE_COLOUR = '46 100% 58%';
/** The longest a show's dates can run. Past this the end is a typo. */
const MAX_DAYS = 31;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real YYYY-MM-DD day. */
export function isDay(value: unknown): value is string {
  return typeof value === 'string' && ISO_DAY.test(value) && isValid(parseISO(value));
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const yearOf = (day: string) => Number(day.slice(0, 4));
const pad = (n: number) => String(n).padStart(2, '0');

/** One year's dates, read from storage: an end before the start, or a month past it, is the start alone. */
function cleanDates(raw: unknown): ConferenceDates | null {
  if (!raw || typeof raw !== 'object') return null;
  const { start, end } = raw as Record<string, unknown>;
  if (!isDay(start)) return null;
  const fits = isDay(end) && end >= start && differenceInCalendarDays(parseISO(end), parseISO(start)) < MAX_DAYS;
  return { start, end: fits ? (end as string) : start };
}

/**
 * The list as stored, made safe to read. Settings come from other devices and
 * older versions, so anything without a name and id is dropped, dates that
 * aren't real days are dropped, and the rest is kept.
 */
export function cleanConferences(raw: unknown): Conference[] {
  if (!Array.isArray(raw)) return [];
  const out: Conference[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const name = text(c.name);
    if (typeof c.id !== 'string' || !name) continue;
    const month = Number(c.usualMonth);
    const weeks = Number(c.remindWeeks);
    out.push({
      id: c.id,
      name,
      where: text(c.where),
      usualMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : undefined,
      dates: (Array.isArray(c.dates) ? c.dates : [])
        .map(cleanDates)
        .filter((d): d is ConferenceDates => !!d)
        .sort((a, b) => a.start.localeCompare(b.start)),
      remindWeeks: Number.isFinite(weeks) && weeks >= 1 && weeks <= 52 ? Math.round(weeks) : undefined,
      link: text(c.link),
      notes: text(c.notes),
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
    });
  }
  return out;
}

/** The month it usually falls in: the one set, or else the month of its latest dates. */
export function usualMonthOf(c: Conference): number | undefined {
  if (c.usualMonth) return c.usualMonth;
  const latest = c.dates[c.dates.length - 1];
  return latest ? Number(latest.start.slice(5, 7)) : undefined;
}

export const monthName = (month: number) => format(new Date(2000, month - 1, 1), 'MMMM');

/** Puts in a year's dates, replacing any already there for that year. */
export function withDates(c: Conference, dates: ConferenceDates): Conference {
  const year = yearOf(dates.start);
  return {
    ...c,
    dates: [...c.dates.filter(d => yearOf(d.start) !== year), dates].sort((a, b) => a.start.localeCompare(b.start)),
  };
}

/** What's next for a conference: dates that are set, or the month it's expected in. */
export type NextShow =
  | { kind: 'dated'; start: string; end: string }
  | { kind: 'expected'; year: number; month: number };

/** When a next show starts, as a day to sort and count by. An expected one counts from the 1st of its month. */
export const startOf = (next: NextShow) => (next.kind === 'dated' ? next.start : `${next.year}-${pad(next.month)}-01`);

/**
 * The next time it's on. Dates that are set and not over yet, or, for a year
 * with no dates in, the month it usually falls in, if that month isn't over.
 * Whichever comes first.
 */
export function nextShow(c: Conference, today: string): NextShow | null {
  const options: NextShow[] = [];
  const dated = c.dates.find(d => d.end >= today);
  if (dated) options.push({ kind: 'dated', start: dated.start, end: dated.end });
  const month = usualMonthOf(c);
  if (month) {
    const thisYear = yearOf(today);
    for (const year of [thisYear, thisYear + 1]) {
      if (c.dates.some(d => yearOf(d.start) === year)) continue;
      const monthOver = format(addDays(new Date(year, month, 1), -1), 'yyyy-MM-dd') < today;
      if (!monthOver) { options.push({ kind: 'expected', year, month }); break; }
    }
  }
  if (options.length === 0) return null;
  return options.sort((a, b) => startOf(a).localeCompare(startOf(b)))[0];
}

export interface ConferenceAlert {
  conference: Conference;
  next: NextShow;
  /** 'soon': its dates are set and it's within the reminder. 'dates': it's coming up and its dates aren't in. */
  kind: 'soon' | 'dates';
  /** Days until it starts, or until the 1st of the month it's expected in (below 0 once that month has begun). */
  days: number;
}

/**
 * What Preamp tells you about: each conference starting within its reminder,
 * and each one due within its reminder whose dates aren't in yet. Soonest first.
 */
export function conferenceAlerts(list: Conference[], today: string): ConferenceAlert[] {
  const alerts: ConferenceAlert[] = [];
  for (const conference of list) {
    const next = nextShow(conference, today);
    if (!next) continue;
    const days = differenceInCalendarDays(parseISO(startOf(next)), parseISO(today));
    const lead = (conference.remindWeeks ?? DEFAULT_REMIND_WEEKS) * 7;
    if (days > lead) continue;
    if (next.kind === 'dated') {
      // Once it's on, there's nothing to get ready for.
      if (days >= 0) alerts.push({ conference, next, kind: 'soon', days });
    } else {
      alerts.push({ conference, next, kind: 'dates', days });
    }
  }
  return alerts.sort((a, b) => a.days - b.days || a.conference.name.localeCompare(b.conference.name));
}

/** Every day a conference is on, and which, for the calendar. */
export function conferenceDays(list: Conference[]): Map<string, Conference[]> {
  const days = new Map<string, Conference[]>();
  for (const c of list) {
    for (const d of c.dates) {
      const first = parseISO(d.start);
      const count = differenceInCalendarDays(parseISO(d.end), first);
      for (let i = 0; i <= count && i < MAX_DAYS; i++) {
        const key = format(addDays(first, i), 'yyyy-MM-dd');
        days.set(key, [...(days.get(key) ?? []), c]);
      }
    }
  }
  return days;
}

/** A conference in a month on the calendar: on given dates, or only expected that month. */
export interface MonthConference {
  conference: Conference;
  dates?: ConferenceDates;
}

/**
 * The conferences in a month: those with dates in it, and those usually in it
 * whose dates for that year aren't in. A month that's over doesn't list what
 * was only expected.
 */
export function monthConferences(list: Conference[], year: number, month: number, today: string): MonthConference[] {
  const prefix = `${year}-${pad(month)}`;
  const first = `${prefix}-01`;
  const last = format(addDays(new Date(year, month, 1), -1), 'yyyy-MM-dd');
  const out: MonthConference[] = [];
  for (const conference of list) {
    const dates = conference.dates.find(d => d.start <= last && d.end >= first);
    if (dates) { out.push({ conference, dates }); continue; }
    const setThatYear = conference.dates.some(d => yearOf(d.start) === year);
    if (!setThatYear && usualMonthOf(conference) === month && last >= today) out.push({ conference });
  }
  return out.sort((a, b) =>
    (a.dates?.start ?? '9').localeCompare(b.dates?.start ?? '9') || a.conference.name.localeCompare(b.conference.name));
}

/** A show's days: "Apr 12", "Apr 12–15", or "Apr 30 – May 3". With the year when asked. */
export function spanText(dates: ConferenceDates, withYear = false): string {
  const year = withYear ? `, ${dates.start.slice(0, 4)}` : '';
  if (dates.end === dates.start) return `${showDay(dates.start)}${year}`;
  if (dates.start.slice(0, 7) === dates.end.slice(0, 7)) return `${showDay(dates.start)}–${showDay(dates.end, 'd')}${year}`;
  return `${showDay(dates.start)} – ${showDay(dates.end)}${year}`;
}

/** How far off: "today", "tomorrow", "in 5 days", "in 3 weeks", "in 4 months". */
export function howFar(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days <= 12 * 7) return `in ${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30.4);
  return months <= 1 ? 'in a month' : `in ${months} months`;
}

/** The list's line for when it's next: "Apr 12–15, 2027 · in 20 weeks", "usually April · 2027 dates not in". */
export function whenText(c: Conference, today: string): string {
  const next = nextShow(c, today);
  if (!next) {
    const last = c.dates[c.dates.length - 1];
    return last ? `last ${spanText(last, true)} · next dates not in` : 'dates not in';
  }
  if (next.kind === 'expected') return `usually ${monthName(next.month)} · ${next.year} dates not in`;
  const days = differenceInCalendarDays(parseISO(next.start), parseISO(today));
  return `${spanText(next, true)} · ${days < 0 ? `on now, through ${showDay(next.end)}` : howFar(days)}`;
}

/** A link to open: what was typed, with https:// when it was left off. Anything but a web address isn't a link. */
export function safeLink(link: string | undefined): string | undefined {
  const value = link?.trim();
  if (!value) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
