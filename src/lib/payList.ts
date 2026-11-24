import { addDays, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { readAmount, weekEndingFor, type WeekEnd } from './unemployment';

/**
 * A pay list pasted from a payroll site: a date and an amount on each line,
 * the way Gusto, ADP and the like list past paychecks, and the pay period
 * when the line has one. Read here, on the phone, with no AI: each line it
 * can't read is kept and shown, so nothing is dropped without being seen.
 */

export interface PayListRow {
  /** The line as pasted, links taken out. */
  line: string;
  /** The pay date: the line's own date, or its pay period's end when that's all it has. */
  date: string;
  amount: number;
  /** The days it paid for, when the line says ("May 24 – May 30, 2026"): the weeks it counts in. */
  period?: { start: string; end: string };
  /** The line has a pay period and no pay date of its own. */
  noPayDate?: boolean;
  /** More amounts on the same line, not counted. */
  others: number[];
  /** No year was written: the most recent one that isn't in the future. */
  yearAssumed?: boolean;
  /** The amount sits in a different column from most lines: maybe a different figure. */
  offColumn?: boolean;
  /** The same date and amount as a line before it: likely pasted twice. */
  repeat?: boolean;
}

export interface PayList {
  rows: PayListRow[];
  /** Lines with something on them that weren't a date and an amount. */
  skipped: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?`;

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const realDay = (y: number, m: number, d: number) => {
  if (!(y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return undefined;
  const day = iso(y, m, d);
  return isValid(parseISO(day)) && parseISO(day).getDate() === d ? day : undefined;
};

/** A day with no year: this year's, unless that's still to come, then last year's. */
function withYear(m: number, d: number, today: string): string | undefined {
  const year = Number(today.slice(0, 4));
  const now = realDay(year, m, d);
  if (now && now <= today) return now;
  return realDay(year - 1, m, d);
}

/** A date on a line: where it is, and its month and day, and its year when written. */
interface DateHit { at: number; text: string; y?: number; m: number; d: number }

/** Every date on a line, in any of the ways a payroll site writes one, left to right. */
function findDates(line: string): DateHit[] {
  const hits: DateHit[] = [];
  const year = (s?: string) => (s ? (s.length === 2 ? 2000 + Number(s) : Number(s)) : undefined);
  const each = (re: RegExp, make: (m: RegExpExecArray) => Omit<DateHit, 'at' | 'text'> & { lead?: number }) => {
    for (const m of line.matchAll(re)) {
      const made = make(m as RegExpExecArray);
      const lead = made.lead ?? 0;
      hits.push({ at: m.index! + lead, text: m[0].slice(lead), y: made.y, m: made.m, d: made.d });
    }
  };
  // "Jun 3, 2026", "June 3rd 2026", "Jun 3"
  each(new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:\s*(\d{4}))?`, 'gi'), m => ({ m: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, d: Number(m[2]), y: year(m[3]) }));
  // "3 Jun 2026"
  each(new RegExp(String.raw`\b(\d{1,2})\s+${MONTH}\b,?(?:\s*(\d{4}))?`, 'gi'), m => ({ m: MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, d: Number(m[1]), y: year(m[3]) }));
  // "2026-06-03"
  each(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, m => ({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }));
  // "6/3/2026", "06/03/26", "6/3"
  each(/(^|[^\d.$/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g, m => ({ lead: m[1].length, m: Number(m[2]), d: Number(m[3]), y: year(m[4]) }));
  // Left to right, none on top of another.
  const kept: DateHit[] = [];
  for (const h of hits.sort((a, b) => a.at - b.at || b.text.length - a.text.length)) {
    const last = kept[kept.length - 1];
    if (!last || h.at >= last.at + last.text.length) kept.push(h);
  }
  return kept;
}

/** Between two dates, a "to": "-", "–", "to", "thru", "through". */
const RANGE = /^\s*(?:-|–|—|to|thru|through)\s*$/i;

/** Money on a piece of a line: "$1,400.00", "$595", or a figure with cents ("595.00"). */
function amountsIn(text: string): number[] {
  const dollars = text.match(/\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\$\s?\d+(?:\.\d{1,2})?/g);
  const found = dollars ?? text.match(/(?<![\d.])\d{1,3}(?:,\d{3})+\.\d{2}(?!\d)|(?<![\d.,])\d+\.\d{2}(?!\d)/g) ?? [];
  return found.map(readAmount).filter(n => Number.isFinite(n) && n > 0);
}

/** Every line of a pasted pay list read: its date, its pay period when it has one, and its amount, or why not. */
export function readPayList(text: string, today: string): PayList {
  const rows: (PayListRow & { column: number; tabbed: boolean })[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Links keep their words, lose their addresses (which are full of numbers).
    const line = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const hits = findDates(line).filter(h => realDay(h.y ?? 2000, h.m, h.d) || withYear(h.m, h.d, today));

    // A pay period: two dates with a "to" between them. A first date with no
    // year takes the second's (the year before, when it runs over New Year).
    let period: { start: string; end: string } | undefined;
    let inPeriod = new Set<DateHit>();
    for (let i = 0; i + 1 < hits.length && !period; i++) {
      const [a, b] = [hits[i], hits[i + 1]];
      if (!RANGE.test(line.slice(a.at + a.text.length, b.at))) continue;
      const endYear = b.y ?? a.y;
      const end = endYear ? realDay(endYear, b.m, b.d) : withYear(b.m, b.d, today);
      const startYear = a.y ?? (end ? Number(end.slice(0, 4)) - (a.m > b.m ? 1 : 0) : undefined);
      const start = startYear ? realDay(startYear, a.m, a.d) : undefined;
      if (start && end && start <= end && differenceInCalendarDays(parseISO(end), parseISO(start)) < 62) {
        period = { start, end };
        inPeriod = new Set([a, b]);
      }
    }
    // The pay date: the first date that isn't the period's.
    const own = hits.find(h => !inPeriod.has(h));
    const ownDay = own ? (own.y ? realDay(own.y, own.m, own.d) : withYear(own.m, own.d, today)) : undefined;
    const date = ownDay ?? period?.end;
    if (!date) { skipped.push(line.trim()); continue; }
    const yearAssumed = own ? !own.y : false;

    // The dates' own digits aren't money.
    let rest = line;
    for (const h of hits) rest = rest.slice(0, h.at) + ' '.repeat(h.text.length) + rest.slice(h.at + h.text.length);
    const fields = rest.split('\t');
    let column = -1;
    const all: number[] = [];
    fields.forEach((f, i) => {
      const here = amountsIn(f);
      if (here.length && column < 0) column = i;
      all.push(...here);
    });
    if (all.length === 0) { skipped.push(line.trim()); continue; }
    rows.push({
      line: line.trim().replace(/\s+/g, ' '), date, amount: all[0], others: all.slice(1), column, tabbed: fields.length > 1,
      ...(period ? { period } : {}),
      ...(period && !ownDay ? { noPayDate: true } : {}),
      ...(yearAssumed ? { yearAssumed: true } : {}),
    });
  }
  // The column most lines have their amount in.
  const counts = new Map<number, number>();
  for (const r of rows) if (r.tabbed) counts.set(r.column, (counts.get(r.column) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0];
  const seen = new Set<string>();
  return {
    rows: rows.map(({ column, tabbed, ...r }) => {
      const key = `${r.date}|${r.amount}|${r.period?.start ?? ''}`;
      const repeat = seen.has(key);
      seen.add(key);
      return {
        ...r,
        ...(usual && usual[1] >= 2 && tabbed && column !== usual[0] ? { offColumn: true } : {}),
        ...(repeat ? { repeat: true } : {}),
      };
    }),
    skipped,
  };
}

export interface PayListWeek {
  start: string;
  weekEnding: string;
  total: number;
  /** The paydays in it. */
  dates: string[];
  /** Some of it is placed by a pay period on its line, not by its pay date. */
  byPeriod: boolean;
}

/**
 * The payments added up by the claim's week, oldest week first. A line with
 * a pay period counts in the weeks worked: whole in the week holding most of
 * the period's days when it's a week or less, shared by its days when
 * longer (as a pay stub is on the claim). A line without one counts in the
 * week it came, or, for a payroll that pays a week behind, the week before.
 */
export function payListWeeks(rows: Pick<PayListRow, 'date' | 'amount' | 'period'>[], weekEnd: WeekEnd, weekBefore = false): PayListWeek[] {
  const weeks = new Map<string, PayListWeek>();
  const add = (weekEnding: string, amount: number, payday: string, byPeriod: boolean) => {
    const w = weeks.get(weekEnding) ?? { start: format(addDays(parseISO(weekEnding), -6), 'yyyy-MM-dd'), weekEnding, total: 0, dates: [], byPeriod: false };
    w.total = Math.round((w.total + amount) * 100) / 100;
    if (!w.dates.includes(payday)) w.dates.push(payday);
    w.byPeriod = w.byPeriod || byPeriod;
    weeks.set(weekEnding, w);
  };
  for (const r of rows) {
    if (r.period) {
      const days = new Map<string, number>();
      for (let d = r.period.start; d <= r.period.end; d = format(addDays(parseISO(d), 1), 'yyyy-MM-dd')) {
        const k = weekEndingFor(d, weekEnd);
        days.set(k, (days.get(k) ?? 0) + 1);
      }
      const total = [...days.values()].reduce((s, n) => s + n, 0);
      if (total <= 7) {
        // Most days, and on a tie the later week: the one the period ends in.
        add([...days].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0], r.amount, r.date, true);
      } else {
        for (const [k, n] of days) add(k, Math.round(((r.amount * n) / total) * 100) / 100, r.date, true);
      }
      continue;
    }
    const day = weekBefore ? format(addDays(parseISO(r.date), -7), 'yyyy-MM-dd') : r.date;
    add(weekEndingFor(day, weekEnd), r.amount, r.date, false);
  }
  return [...weeks.values()].sort((a, b) => a.weekEnding.localeCompare(b.weekEnding));
}
