import { addDays, format, isValid, parseISO } from 'date-fns';
import type { Employer, Job } from './store';
import type { PayerProfile } from './payerProfile';
import { jobPayBreakdown, netHoursWorked } from './payCalc';
import { resolveEmployer } from './employerMatch';
import { roundHours } from './hoursFormat';

/**
 * What an unemployment claim asks of your work: for a stretch of dates the
 * state names, each week's employers, hours and gross pay, and each
 * employer's first and last day, hours and gross. Gross is the app's
 * estimate from your shifts, before taxes and dues, counted in the week the
 * work was done. Weeks are named by their last day: Saturday unless the
 * state counts them another way.
 */

/** The last day of a week, as Date.getDay() numbers it: 0 is Sunday, 6 Saturday. */
export type WeekEnd = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** A week's run, in words: "Sunday to Saturday". */
export const weekRun = (weekEnd: WeekEnd) => `${WEEKDAYS[(weekEnd + 1) % 7]} to ${WEEKDAYS[weekEnd]}`;

export interface ClaimLine {
  employer: string;
  hours: number;
  gross: number;
}

export interface ClaimWeek {
  /** The last day of the week, which names it. */
  weekEnding: string;
  /** The days of it inside the range: the whole week, unless the range cuts it. */
  start: string;
  end: string;
  /** The range starts or ends partway through it. */
  partial: boolean;
  /** One line an employer, in the order first worked that week. */
  lines: ClaimLine[];
  hours: number;
  gross: number;
  /** Paid time off in the week: in its gross, not its hours. */
  pto: number;
}

export interface ClaimEmployer {
  name: string;
  /** The payroll company that issued the checks, when it isn't the employer itself. */
  paidBy?: string;
  firstDay: string;
  lastDay: string;
  /** Days worked (paid time off isn't a day worked). */
  days: number;
  hours: number;
  gross: number;
}

export interface ClaimSummary {
  weeks: ClaimWeek[];
  employers: ClaimEmployer[];
  hours: number;
  gross: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** A real YYYY-MM-DD day. A stored "Nov 5" isn't one and is left out. */
export const isClaimDay = (value: unknown): value is string =>
  typeof value === 'string' && ISO.test(value) && isValid(parseISO(value));

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** The last day of the week a day is in: the next Saturday, or whichever day weeks end on. */
export function weekEndingFor(day: string, weekEnd: WeekEnd = 6): string {
  const d = parseISO(day);
  return iso(addDays(d, (weekEnd - d.getDay() + 7) % 7));
}

/** The employer a shift is for, by its own name where the client matches one, and who paid. */
function employerOf(job: Job, employers: Employer[]): { name: string; paidBy?: string } {
  const client = job.client?.trim();
  if (!client) return { name: 'No employer named' };
  const employer = resolveEmployer(client, employers);
  const name = employer?.name ?? client;
  const paidBy = (job.payrollCompany ?? employer?.payrollCompany)?.trim();
  return { name, paidBy: paidBy && paidBy.toLowerCase() !== name.toLowerCase() ? paidBy : undefined };
}

const EMPTY: ClaimSummary = { weeks: [], employers: [], hours: 0, gross: 0 };
/** Past this many weeks the range is a typo, not a claim. */
const MAX_WEEKS = 600;

/**
 * Everything worked from `from` through `through`, both included: every week
 * in the range (a week with no work is there with nothing in it, so none gets
 * skipped), and every employer. Shifts that were cancelled, are still a plan,
 * or have a date that isn't one are left out.
 */
export function claimSummary(
  jobs: Job[],
  employers: Employer[],
  payer: PayerProfile,
  from: string,
  through: string,
  weekEnd: WeekEnd = 6,
): ClaimSummary {
  if (!isClaimDay(from) || !isClaimDay(through) || through < from) return EMPTY;

  const weeks = new Map<string, ClaimWeek>();
  const lastEnding = weekEndingFor(through, weekEnd);
  for (let ending = weekEndingFor(from, weekEnd); ending <= lastEnding && weeks.size < MAX_WEEKS; ending = iso(addDays(parseISO(ending), 7))) {
    const first = iso(addDays(parseISO(ending), -6));
    const start = first < from ? from : first;
    const end = ending > through ? through : ending;
    weeks.set(ending, { weekEnding: ending, start, end, partial: start !== first || end !== ending, lines: [], hours: 0, gross: 0, pto: 0 });
  }

  const byEmployer = new Map<string, ClaimEmployer & { worked: Set<string> }>();
  for (const job of jobs) {
    if (job.status === 'cancelled' || !isClaimDay(job.date) || job.date < from || job.date > through) continue;
    const week = weeks.get(weekEndingFor(job.date, weekEnd));
    if (!week) continue;
    const gross = jobPayBreakdown(job, jobs, employers, payer).gross;
    const hours = job.pto ? 0 : netHoursWorked(job);
    // Nothing worked or paid: a plan, not work.
    if (gross <= 0 && hours <= 0) continue;
    const { name, paidBy } = employerOf(job, employers);

    let line = week.lines.find(l => l.employer === name);
    if (!line) week.lines.push(line = { employer: name, hours: 0, gross: 0 });
    line.hours += hours;
    line.gross += gross;
    week.hours += hours;
    week.gross += gross;
    if (job.pto) week.pto += gross;

    const id = name.toLowerCase();
    const e = byEmployer.get(id) ?? { name, paidBy, firstDay: job.date, lastDay: job.date, days: 0, hours: 0, gross: 0, worked: new Set<string>() };
    if (!e.paidBy && paidBy) e.paidBy = paidBy;
    if (job.date < e.firstDay) e.firstDay = job.date;
    if (job.date > e.lastDay) e.lastDay = job.date;
    if (!job.pto) e.worked.add(job.date);
    e.hours += hours;
    e.gross += gross;
    byEmployer.set(id, e);
  }

  const cents = (n: number) => Math.round(n * 100) / 100;
  const weekList = [...weeks.values()].map(w => ({
    ...w,
    hours: roundHours(w.hours),
    gross: cents(w.gross),
    pto: cents(w.pto),
    lines: w.lines.map(l => ({ ...l, hours: roundHours(l.hours), gross: cents(l.gross) })),
  }));
  // The most recent employer first: the order claim forms ask in.
  const employerList = [...byEmployer.values()]
    .sort((a, b) => b.lastDay.localeCompare(a.lastDay) || a.name.localeCompare(b.name))
    .map(({ worked, ...e }) => ({ ...e, days: worked.size, hours: roundHours(e.hours), gross: cents(e.gross) }));
  return {
    weeks: weekList,
    employers: employerList,
    hours: roundHours(weekList.reduce((s, w) => s + w.hours, 0)),
    gross: cents(weekList.reduce((s, w) => s + w.gross, 0)),
  };
}

/** Money as a claim form takes it: "$1,234.50". */
export const claimMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A day as a claim form shows it: "Sat, Oct 31, 2026". */
export const claimDay = (day: string, withWeekday = true) => format(parseISO(day), withWeekday ? 'EEE, MMM d, yyyy' : 'MMM d, yyyy');

/** The weeks as text to paste: one line a week, every employer in it. */
export function weeksAsText(weeks: ClaimWeek[]): string {
  return weeks.map(w => {
    const head = `Week ending ${claimDay(w.weekEnding)}${w.partial ? ` (${claimDay(w.start, false)} to ${claimDay(w.end, false)} only)` : ''}`;
    if (w.lines.length === 0) return `${head}: no work, 0 hours, $0.00`;
    const parts = w.lines.map(l => `${l.employer} ${l.hours} hours ${claimMoney(l.gross)}`);
    return `${head}: ${parts.join('; ')}. Total ${w.hours} hours, ${claimMoney(w.gross)} gross${w.pto > 0 ? ` (includes ${claimMoney(w.pto)} PTO)` : ''}`;
  }).join('\n');
}

/** The employers as text to paste: one line each. */
export function employersAsText(list: ClaimEmployer[]): string {
  return list.map(e => `${e.name}${e.paidBy ? ` (paid by ${e.paidBy})` : ''}: first day ${claimDay(e.firstDay, false)}, last day ${claimDay(e.lastDay, false)}, ${e.days} day${e.days === 1 ? '' : 's'}, ${e.hours} hours, ${claimMoney(e.gross)} gross`).join('\n');
}
