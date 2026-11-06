import { addDays, differenceInCalendarDays, endOfMonth, format, isValid, parseISO } from 'date-fns';
import type { Employer, Income, Job } from './store';
import { resolveEmployer } from './employerMatch';
import { effectiveHoursWorked, jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import { firstCheckDate, payDueDate, payLagDays } from './payTiming';
import { projectKeysFor } from './projectGrouping';

/**
 * Pay periods: which check a day of work lands on.
 *
 * A project is how a job is thought about; a pay period is how it gets paid.
 * When the two disagree, one gig arrives as two checks, weeks apart, and a
 * single "paid" stops being true for all of it. So a project is split at the
 * edge of a period, and each piece is paid, or waiting, on its own.
 */

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
/**
 * A date the sums below can use. A stub's dates are read off a photo, so they
 * can be anything, and one that can't be read used to throw and take the whole
 * calendar down. An unreadable date is treated as no date.
 */
const isDay = (date?: string | null): date is string => !!date && /^\d{4}-\d{2}-\d{2}/.test(date) && isValid(parseISO(date));
/** A Sunday, for a weekly schedule nobody has said the start of. */
const A_SUNDAY = '2026-01-04';

export interface PayPeriod {
  start: string;
  end: string;
}

export interface PeriodRule {
  schedule: 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';
  /** A day a period started on, for the schedules that repeat from one. */
  anchor?: string;
  /** Nobody said where the week starts: Sunday is a guess, and says so. */
  assumed: boolean;
}

/**
 * How an employer's periods fall, from what is known: the day set on the
 * employer, else the latest stub for it. A weekly schedule with neither is
 * taken to run Sunday to Saturday. Bi-weekly has no such default — which of two
 * weeks it starts on can't be guessed — and nor does an unknown schedule.
 */
export function periodRule(employer: Employer | undefined, allJobs: Job[]): PeriodRule | null {
  const schedule = employer?.paySchedule;
  if (schedule === 'semi-monthly' || schedule === 'monthly') return { schedule, assumed: false };
  if (schedule !== 'weekly' && schedule !== 'bi-weekly') return null;
  if (isDay(employer!.payPeriodStart)) return { schedule, anchor: employer!.payPeriodStart, assumed: false };
  const fromStub = allJobs
    .filter(j => isDay(j.stubParsed?.payPeriodStart) && resolveEmployer(j.client, [employer!]))
    .map(j => j.stubParsed!.payPeriodStart!)
    .sort()
    .pop();
  if (fromStub) return { schedule, anchor: fromStub, assumed: false };
  return schedule === 'weekly' ? { schedule, anchor: A_SUNDAY, assumed: true } : null;
}

/** The pay period a day falls in. */
export function payPeriodOf(date: string, rule: PeriodRule): PayPeriod {
  const day = parseISO(date);
  if (rule.schedule === 'monthly') return { start: `${date.slice(0, 7)}-01`, end: ymd(endOfMonth(day)) };
  if (rule.schedule === 'semi-monthly') {
    return Number(date.slice(8)) <= 15
      ? { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-15` }
      : { start: `${date.slice(0, 7)}-16`, end: ymd(endOfMonth(day)) };
  }
  const length = rule.schedule === 'weekly' ? 7 : 14;
  const anchor = parseISO(rule.anchor!);
  const start = addDays(anchor, Math.floor(differenceInCalendarDays(day, anchor) / length) * length);
  return { start: ymd(start), end: ymd(addDays(start, length - 1)) };
}

export interface ProjectPeriod extends PayPeriod {
  /** The project's shifts in this period, oldest first. */
  jobs: Job[];
  /** These shifts wait for a slow first check, not a regular one. */
  firstCheck?: boolean;
}

export interface ProjectPeriods {
  periods: ProjectPeriod[];
  /** False when the schedule doesn't say where periods fall. */
  known: boolean;
  assumed: boolean;
}

/** The first day worked for an employer: where a slow first check's wait starts. */
function firstDayWorked(employer: Employer, allJobs: Job[]): string | undefined {
  return allJobs
    .filter(j => j.status !== 'cancelled' && isDay(j.date) && effectiveHoursWorked(j) > 0 && resolveEmployer(j.client, [employer]))
    .map(j => j.date)
    .sort()[0];
}

/**
 * A project cut at the edges of its employer's pay periods, oldest first. What
 * waits for a slow first check is one piece however many periods it runs over:
 * it's one check. After that the regular schedule takes over.
 */
export function projectPeriods(jobs: Job[], employer: Employer | undefined, allJobs: Job[]): ProjectPeriods {
  const rule = periodRule(employer, allJobs);
  if (!rule) return { periods: [], known: false, assumed: false };
  const firstDay = employer?.firstCheckWeeks ? firstDayWorked(employer, allJobs) : undefined;
  const firstCheck = firstCheckDate(employer, firstDay);
  const firstPiece = firstCheck && firstDay
    ? { start: firstDay, end: ymd(addDays(parseISO(firstCheck), -payLagDays(employer))), firstCheck: true }
    : undefined;
  const byStart = new Map<string, ProjectPeriod>();
  for (const job of jobs) {
    if (job.status === 'cancelled' || !isDay(job.date)) continue;
    const onFirstCheck = firstPiece && payDueDate(job.date, employer, firstDay) === firstCheck;
    const period = onFirstCheck ? firstPiece : payPeriodOf(job.date, rule);
    const entry = byStart.get(period.start) ?? { ...period, jobs: [] };
    entry.jobs.push(job);
    byStart.set(period.start, entry);
  }
  const periods = [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
  for (const p of periods) p.jobs.sort((a, b) => a.date.localeCompare(b.date));
  return { periods, known: true, assumed: rule.assumed };
}

/** Less of what is left than this is one period's check, not the whole project's. */
const WHOLE_PROJECT_SHARE = 0.9;

/** What a period's worked shifts should take home. */
export function periodNet(period: ProjectPeriod, allJobs: Job[], employers: Employer[], payer: PayerProfile = EMPTY_PROFILE): number {
  return period.jobs
    .filter(j => effectiveHoursWorked(j) > 0)
    .reduce((sum, j) => sum + jobPayBreakdown(j, allJobs, employers, payer).net, 0);
}

/**
 * Which payments paid which periods of a split project, by the period's place
 * in the list. A payment covers the period of the shift it was put on, or the
 * oldest one left if that is already paid. One big enough for everything left
 * covers everything worked by then, so it is listed under each.
 */
export function periodPayments<P extends Pick<Income, 'amount' | 'date' | 'jobId'>>(
  periods: ProjectPeriod[],
  payments: P[],
  expected: (period: ProjectPeriod) => number,
): Map<number, P[]> {
  const paid = new Map<number, P[]>();
  const owed = periods.map(expected);
  const ownPeriod = (p: P) => periods.findIndex(period => period.jobs.some(j => j.id === p.jobId));

  // The same payment entered twice is still one payment. Two checks for the
  // same amount on the same day, one for each period, are two.
  const distinct = new Map<string, P[]>();
  for (const p of payments) {
    const key = `${p.amount}|${p.date}|${ownPeriod(p)}`;
    distinct.set(key, [...(distinct.get(key) ?? []), p]);
  }

  for (const same of [...distinct.values()].sort((a, b) => a[0].date.localeCompare(b[0].date))) {
    const payment = same[0];
    const own = ownPeriod(payment);
    const left = periods.map((_, i) => i).filter(i => !paid.has(i) && owed[i] > 0);
    if (left.length === 0) {
      // Nothing left to cover: a top-up stays with the shift it was put on.
      const at = Math.max(own, 0);
      paid.set(at, [...(paid.get(at) ?? []), ...same]);
      continue;
    }
    const leftTotal = left.reduce((sum, i) => sum + owed[i], 0);
    const whole = payment.amount >= leftTotal * WHOLE_PROJECT_SHARE
      ? left.filter(i => periods[i].jobs[0].date <= payment.date)
      : [];
    for (const i of whole.length > 0 ? whole : [left.includes(own) ? own : left[0]]) paid.set(i, same);
  }
  return paid;
}

/** Which periods of a split project its payments have paid. */
export function coveredPeriods(
  periods: ProjectPeriod[],
  payments: Pick<Income, 'amount' | 'date' | 'jobId'>[],
  expected: (period: ProjectPeriod) => number,
): Set<number> {
  return new Set(periodPayments(periods, payments, expected).keys());
}

/**
 * Every shift that has been paid. A payment pays its project, not only the day
 * it was put on: one check for a two-day gig turns both days green. It covers
 * the days worked up to the day it came, and when the project is split across
 * pay periods, only the periods it paid.
 */
export function paidShiftIds(
  allJobs: Job[],
  income: Income[],
  employers: Employer[],
  payer: PayerProfile = EMPTY_PROFILE,
): Set<string> {
  const paid = new Set<string>();
  const keys = projectKeysFor(allJobs, employers);
  const jobById = new Map(allJobs.map(j => [j.id, j]));
  const paymentsOf = new Map<string, Income[]>();
  for (const i of income) {
    if (i.status !== 'paid' || !i.jobId) continue;
    const job = jobById.get(i.jobId);
    if (!job) { paid.add(i.jobId); continue; }
    const key = keys.get(job.id) ?? job.id;
    paymentsOf.set(key, [...(paymentsOf.get(key) ?? []), i]);
  }

  for (const [key, payments] of paymentsOf) {
    const project = allJobs.filter(j => (keys.get(j.id) ?? j.id) === key);
    const worked = project.filter(j => effectiveHoursWorked(j) > 0);
    const employer = resolveEmployer(project[0].client, employers);
    const { periods } = projectPeriods(project, employer, allJobs);
    if (periods.length > 1) {
      const covered = coveredPeriods(periods, payments, p => periodNet(p, allJobs, employers, payer));
      periods.forEach((p, i) => {
        if (covered.has(i)) for (const j of p.jobs) if (effectiveHoursWorked(j) > 0) paid.add(j.id);
      });
      continue;
    }
    const through = payments.map(i => i.date).sort().pop()!;
    for (const i of payments) paid.add(i.jobId!);
    for (const j of worked) if (j.date <= through) paid.add(j.id);
  }
  return paid;
}
