import { addDays, differenceInCalendarDays, endOfMonth, format, isValid, parseISO } from 'date-fns';
import type { Employer, Income, Job } from './store';
import { resolveEmployer } from './employerMatch';
import { effectiveHoursWorked, jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE, withholdsNothing, type PayerProfile } from './payerProfile';
import { firstCheckDate, payDueDate, payLagDays } from './payTiming';
import { proofKindOf } from './paymentProof';
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

/**
 * Take-home is at least this share of the gross it pays for, once taxes and
 * dues are out, for an employer that withholds them.
 */
const MIN_TAKE_HOME = 0.65;

/**
 * Without pay periods, the days each payment paid, worked out from the money:
 * oldest days first, each payment taking as many days as its amount can
 * account for, and never a day after it came. A deposit is take-home, so it
 * can stand for more gross than its own amount, but only so much more. This
 * replaced "every day up to the payment's date", which turned a weekly check
 * that came the day after a run into pay for the whole run.
 */
export function allocateByAmount(
  worked: Job[],
  payments: Pick<Income, 'id' | 'amount' | 'date'>[],
  grossOf: (j: Job) => number,
  takeHome: number,
): Map<string, Job[]> {
  const days = [...worked].sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<string, Job[]>();
  // The same payment entered twice is one payment.
  const seen = new Set<string>();
  let next = 0;
  for (const p of [...payments].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = `${p.amount}|${p.date}`;
    if (seen.has(key)) { out.set(p.id, []); continue; }
    seen.add(key);
    const mine: Job[] = [];
    let gross = 0;
    while (next < days.length && days[next].date <= p.date) {
      const g = grossOf(days[next]);
      if ((gross + g) * takeHome > p.amount + 0.5) break;
      gross += g;
      mine.push(days[next]);
      next++;
    }
    out.set(p.id, mine);
  }
  return out;
}

/** A payment's own picked days, if you picked them. */
const pickedDays = (i: Pick<Income, 'matchProof'>) => (i.matchProof?.covers?.length ? i.matchProof.covers : undefined);

/**
 * How far back a check reaches for an employer's unpaid days on its other
 * projects. Its own project's days count however far back they go. Older work
 * was most likely paid outside the app, and isn't taken for what a new check
 * paid.
 */
export const EMPLOYER_REACH_DAYS = 45;

/** One employer however its name is typed: the saved employer it matches, else the name without case, punctuation or "Inc". */
export function employerKeyOf(client: string | undefined, employers: Employer[]): string {
  const name = client ?? '';
  return resolveEmployer(name, employers)?.id
    ?? name.toLowerCase().replace(/[.,/]/g, ' ').replace(/\b(inc|llc|co|corp|ltd)\b/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Without pay periods, the days each payment paid: the employer first, then
 * the weeks. A check pays its employer's oldest unpaid days, whichever of its
 * projects they were on, as far as its amount goes and never a day after it
 * came. So a part payment lands on the week it was for, and the days after it
 * stay owed. A "Mark paid" tap is your word that its own project was paid up
 * to that day, so it takes those days and no others, whatever the amount.
 * Days picked for a payment are left to it. Projects whose employer has a
 * pay schedule are paid by period instead (see paidShiftIds).
 */
export function employerCovers(
  allJobs: Job[],
  income: Income[],
  employers: Employer[],
  payer: PayerProfile = EMPTY_PROFILE,
): Map<string, Job[]> {
  const keys = projectKeysFor(allJobs, employers);
  const projectKey = (j: Job) => keys.get(j.id) ?? j.id;
  const jobById = new Map(allJobs.map(j => [j.id, j]));
  const projects = new Map<string, Job[]>();
  for (const j of allJobs) projects.set(projectKey(j), [...(projects.get(projectKey(j)) ?? []), j]);
  const paidIn = income.filter(i => i.status === 'paid');
  const picked = new Set(paidIn.flatMap(i => pickedDays(i) ?? []));

  // Each payment under its employer, when its project has no pay periods.
  const ruleOf = new Map<string, boolean>();
  const byEmployer = new Map<string, { client: string; payments: Income[] }>();
  for (const i of paidIn) {
    const job = i.jobId ? jobById.get(i.jobId) : undefined;
    if (!job || pickedDays(i)) continue;
    const lead = projects.get(projectKey(job))![0];
    const ek = employerKeyOf(lead.client, employers);
    if (!ruleOf.has(ek)) ruleOf.set(ek, !!periodRule(resolveEmployer(lead.client ?? '', employers), allJobs));
    if (ruleOf.get(ek)) continue;
    const group = byEmployer.get(ek) ?? { client: lead.client ?? '', payments: [] };
    group.payments.push(i);
    byEmployer.set(ek, group);
  }

  const out = new Map<string, Job[]>();
  for (const [ek, { client, payments }] of byEmployer) {
    const employer = resolveEmployer(client, employers);
    const takeHome = withholdsNothing(employer, payer) ? 0.97 : MIN_TAKE_HOME;
    // The employer's worked days, oldest first.
    const pool = allJobs
      .filter(j => j.status !== 'cancelled' && isDay(j.date) && effectiveHoursWorked(j) > 0 && !picked.has(j.id)
        && employerKeyOf(projects.get(projectKey(j))![0].client, employers) === ek)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const taken = new Set<string>();
    // The same payment saved twice on one shift is one payment. The same
    // amount on two shifts is two: a flat $240 a day, paid day by day.
    const seen = new Set<string>();
    for (const p of [...payments].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
      const own = projectKey(jobById.get(p.jobId!)!);
      const same = `${p.amount}|${p.date}|${p.jobId}`;
      if (seen.has(same)) { out.set(p.id, []); continue; }
      seen.add(same);
      const marked = proofKindOf(p) === 'marked';
      // A date that can't be read reaches no further than its own project.
      const from = isDay(p.date) ? ymd(addDays(parseISO(p.date), -EMPLOYER_REACH_DAYS)) : '9999';
      const mine: Job[] = [];
      let gross = 0;
      for (const j of pool) {
        if (taken.has(j.id)) continue;
        if (j.date > p.date) break;
        const ours = projectKey(j) === own;
        if (!ours && (marked || j.date < from)) continue;
        if (!marked) {
          const g = jobPayBreakdown(j, allJobs, employers, payer).gross;
          if ((gross + g) * takeHome > p.amount + 0.5) break;
          gross += g;
        }
        mine.push(j);
        taken.add(j.id);
      }
      out.set(p.id, mine);
    }
  }
  return out;
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
 * The shifts one payment paid for: its project's worked days up to the day it
 * came, or on a project split across pay periods, the periods it paid. The
 * same rule paidShiftIds uses for the calendar, for just this payment.
 */
export function shiftsPaidBy(
  payment: Income,
  allJobs: Job[],
  income: Income[],
  employers: Employer[],
  payer: PayerProfile = EMPTY_PROFILE,
): Job[] {
  if (!payment.jobId) return [];
  const keys = projectKeysFor(allJobs, employers);
  const key = keys.get(payment.jobId);
  if (!key) return [];
  const project = allJobs.filter(j => (keys.get(j.id) ?? j.id) === key);
  const worked = project.filter(j => effectiveHoursWorked(j) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const picked = pickedDays(payment);
  if (picked) return worked.filter(j => picked.includes(j.id));
  const employer = resolveEmployer(project[0].client, employers);
  const { periods, known } = projectPeriods(project, employer, allJobs);
  const payments = income.filter(i => i.jobId && keys.get(i.jobId) === key && (i.status === 'paid' || i.id === payment.id) && !pickedDays(i));
  // One known period: its check pays the whole period, up to the day it came.
  if (known && periods.length === 1) {
    const upTo = worked.filter(j => j.date <= payment.date);
    return upTo.length > 0 ? upTo : worked;
  }
  if (periods.length > 1) {
    const by = periodPayments(periods, payments, p => periodNet(p, allJobs, employers, payer));
    const ids = new Set([...by].filter(([, list]) => list.some(x => x.id === payment.id)).flatMap(([i]) => periods[i].jobs.map(j => j.id)));
    return worked.filter(j => ids.has(j.id));
  }
  // Employer first, then the weeks: this payment as if it has come in.
  const asIn = { ...payment, status: 'paid' as const };
  const withIt = income.some(i => i.id === payment.id) ? income.map(i => (i.id === payment.id ? asIn : i)) : [...income, asIn];
  const mine = employerCovers(allJobs, withIt, employers, payer).get(payment.id) ?? [];
  // Too little to cover a whole day: it still shows against the day it's on.
  return mine.length > 0 ? mine : worked.filter(j => j.id === payment.jobId);
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

  for (const [key, all] of paymentsOf) {
    const project = allJobs.filter(j => (keys.get(j.id) ?? j.id) === key);
    const worked = project.filter(j => effectiveHoursWorked(j) > 0);
    // Days you picked for a payment are paid, whatever else is worked out.
    for (const i of all) for (const id of pickedDays(i) ?? []) paid.add(id);
    const payments = all.filter(i => !pickedDays(i));
    if (payments.length === 0) continue;
    const employer = resolveEmployer(project[0].client, employers);
    const { periods, known } = projectPeriods(project, employer, allJobs);
    if (periods.length > 1) {
      const covered = coveredPeriods(periods, payments, p => periodNet(p, allJobs, employers, payer));
      periods.forEach((p, i) => {
        if (covered.has(i)) for (const j of p.jobs) if (effectiveHoursWorked(j) > 0) paid.add(j.id);
      });
      continue;
    }
    // One known period: its check pays the whole period, up to the day it came.
    if (known) {
      const through = payments.map(i => i.date).sort().pop()!;
      for (const j of worked) if (j.date <= through) paid.add(j.id);
      continue;
    }
    // Pay periods unknown: the employer's oldest days, below.
  }
  // Without pay periods: the employer first, then its oldest days, as far as the money goes.
  for (const days of employerCovers(allJobs, income, employers, payer).values()) for (const j of days) paid.add(j.id);
  return paid;
}
