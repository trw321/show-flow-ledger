import { addDays, format, isValid, parseISO } from 'date-fns';
import { readAmount, weekEndingFor, type WeekEnd } from './unemployment';

/**
 * A pay list pasted from a payroll site: a date and an amount on each line,
 * the way Gusto, ADP and the like list past paychecks. Read here, on the
 * phone, with no AI: each line it can't read is kept and shown, so nothing
 * is dropped without being seen.
 */

export interface PayListRow {
  /** The line as pasted, links taken out. */
  line: string;
  date: string;
  amount: number;
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

interface DateHit { day: string; at: number; text: string; yearAssumed: boolean }

/** The first date on a line, in any of the ways a payroll site writes one. */
function findDate(line: string, today: string): DateHit | undefined {
  const hits: DateHit[] = [];
  const add = (m: RegExpExecArray | null, make: (m: RegExpExecArray) => { day?: string; yearAssumed: boolean }) => {
    if (!m) return;
    const { day, yearAssumed } = make(m);
    if (day) hits.push({ day, at: m.index, text: m[0], yearAssumed });
  };
  const year = (s?: string) => (s ? (s.length === 2 ? 2000 + Number(s) : Number(s)) : undefined);
  // "Jun 3, 2026", "June 3rd 2026", "Jun 3"
  add(new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b,?(?:\s*(\d{4}))?`, 'i').exec(line), m => {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    const y = year(m[3]);
    return y ? { day: realDay(y, mo, Number(m[2])), yearAssumed: false } : { day: withYear(mo, Number(m[2]), today), yearAssumed: true };
  });
  // "3 Jun 2026"
  add(new RegExp(String.raw`\b(\d{1,2})\s+${MONTH}\b,?(?:\s*(\d{4}))?`, 'i').exec(line), m => {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    const y = year(m[3]);
    return y ? { day: realDay(y, mo, Number(m[1])), yearAssumed: false } : { day: withYear(mo, Number(m[1]), today), yearAssumed: true };
  });
  // "2026-06-03"
  add(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(line), m => ({ day: realDay(Number(m[1]), Number(m[2]), Number(m[3])), yearAssumed: false }));
  // "6/3/2026", "06/03/26", "6/3"
  add(/(?<![\d.$])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/.exec(line), m => {
    const y = year(m[3]);
    return y ? { day: realDay(y, Number(m[1]), Number(m[2])), yearAssumed: false } : { day: withYear(Number(m[1]), Number(m[2]), today), yearAssumed: true };
  });
  return hits.sort((a, b) => a.at - b.at)[0];
}

/** Money on a piece of a line: "$1,400.00", "$595", or a figure with cents ("595.00"). */
function amountsIn(text: string): number[] {
  const dollars = text.match(/\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\$\s?\d+(?:\.\d{1,2})?/g);
  const found = dollars ?? text.match(/(?<![\d.])\d{1,3}(?:,\d{3})+\.\d{2}(?!\d)|(?<![\d.,])\d+\.\d{2}(?!\d)/g) ?? [];
  return found.map(readAmount).filter(n => Number.isFinite(n) && n > 0);
}

/** Every line of a pasted pay list read: its date and its amount, or why not. */
export function readPayList(text: string, today: string): PayList {
  const rows: (PayListRow & { column: number; tabbed: boolean })[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Links keep their words, lose their addresses (which are full of numbers).
    const line = raw.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const date = findDate(line, today);
    if (!date) { skipped.push(line.trim()); continue; }
    // The date's own digits aren't money.
    const rest = line.slice(0, date.at) + ' '.repeat(date.text.length) + line.slice(date.at + date.text.length);
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
      line: line.trim().replace(/\s+/g, ' '), date: date.day, amount: all[0], others: all.slice(1), column, tabbed: fields.length > 1,
      ...(date.yearAssumed ? { yearAssumed: true } : {}),
    });
  }
  // The column most lines have their amount in.
  const counts = new Map<number, number>();
  for (const r of rows) if (r.tabbed) counts.set(r.column, (counts.get(r.column) ?? 0) + 1);
  const usual = [...counts].sort((a, b) => b[1] - a[1])[0];
  const seen = new Set<string>();
  return {
    rows: rows.map(({ column, tabbed, ...r }) => {
      const key = `${r.date}|${r.amount}`;
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
}

/**
 * The payments added up by the claim's week. A payday is counted in the week
 * it came, or, for a payroll that pays a week behind, the week before it.
 * Oldest week first.
 */
export function payListWeeks(rows: Pick<PayListRow, 'date' | 'amount'>[], weekEnd: WeekEnd, weekBefore = false): PayListWeek[] {
  const weeks = new Map<string, PayListWeek>();
  for (const r of rows) {
    const day = weekBefore ? format(addDays(parseISO(r.date), -7), 'yyyy-MM-dd') : r.date;
    const weekEnding = weekEndingFor(day, weekEnd);
    const w = weeks.get(weekEnding) ?? { start: format(addDays(parseISO(weekEnding), -6), 'yyyy-MM-dd'), weekEnding, total: 0, dates: [] };
    w.total = Math.round((w.total + r.amount) * 100) / 100;
    w.dates.push(r.date);
    weeks.set(weekEnding, w);
  }
  return [...weeks.values()].sort((a, b) => a.weekEnding.localeCompare(b.weekEnding));
}
