import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Employer, Job } from './store';
import { effectiveHoursWorked, jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';

/** A payment as read off a stub or a check, or typed in. */
export interface FoundPayment {
  amount: number;
  date: string;
  payer?: string;
  /** Days the stub lists hours for, when it itemises them. */
  hoursOn?: string[];
}

export interface MatchReason {
  text: string;
  /** For the match (true) or against it (false). */
  good: boolean;
}

export interface ProjectMatch {
  /** 0–100: how much of the available evidence points to this project. */
  percent: number;
  level: 'high' | 'medium' | 'low';
  reasons: MatchReason[];
  /** Expected take-home for the project's worked days the payment would cover. */
  expected: number;
}

export interface MatchContext {
  allJobs: Job[];
  employers: Employer[];
  payer?: PayerProfile;
  /** Shifts that already have a payment against them. */
  paidJobIds: Set<string>;
}

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => format(parseISO(iso), 'MMM d');
const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Loosely the same company: a shared word of four letters or more, or one name inside the other. */
function sameName(a?: string, b?: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const words = new Set(y.split(' ').filter(w => w.length > 3));
  return x.split(' ').some(w => w.length > 3 && words.has(w));
}

/** Every shift in the same project as this one: the same job number, or the same name and employer. */
export function projectOf(job: Job, allJobs: Job[]): Job[] {
  const key = projectKey(job);
  return allJobs.filter(j => projectKey(j) === key);
}

function projectKey(j: Job): string {
  return j.jobNumber?.trim() || `${(j.name ?? '').trim().toLowerCase()}|${j.client ?? ''}`;
}

/**
 * How well a payment fits a project, as a percentage of the evidence there
 * is, with every reason — for and against — so the match can be checked
 * rather than trusted.
 *
 * Four things count, weighted by how much each says: the stub listing hours
 * on the project's days (the strongest — it names the work); the amount
 * against what those days were expected to pay; the payer being the
 * project's payroll company or employer; and the timing. Evidence that is
 * not there — a check lists no hours — is left out of the reckoning, not
 * counted against it, so a check can still be a certain match.
 */
export function matchPaymentToProject(payment: FoundPayment, project: Job[], ctx: MatchContext): ProjectMatch {
  const reasons: MatchReason[] = [];
  let score = 0;
  let possible = 0;

  const worked = project.filter(j => effectiveHoursWorked(j) > 0);
  const unpaid = worked.filter(j => !ctx.paidJobIds.has(j.id));
  const basis = unpaid.length > 0 ? unpaid : worked;
  const expected = basis.reduce((sum, j) => sum + jobPayBreakdown(j, ctx.allJobs, ctx.employers, ctx.payer ?? EMPTY_PROFILE).net, 0);

  // 1. Hours on the stub, on this project's days.
  const projectDays = [...new Set(project.map(j => j.date))].sort();
  if (payment.hoursOn && payment.hoursOn.length > 0) {
    possible += 40;
    const listed = [...new Set(payment.hoursOn)].filter(d => projectDays.includes(d)).sort();
    if (listed.length > 0) {
      score += 40;
      const share = listed.length === projectDays.length ? 'every day' : `${listed.length} of ${projectDays.length} days`;
      reasons.push({ good: true, text: `The stub lists hours on ${listed.map(day).join(', ')} — ${share} of this project` });
    } else {
      reasons.push({ good: false, text: `The stub lists hours on ${[...new Set(payment.hoursOn)].sort().map(day).join(', ')}, none of them this project's days` });
    }
  }

  // 2. The amount, against what the days were expected to pay.
  if (expected > 0) {
    possible += 30;
    const off = Math.abs(payment.amount - expected) / expected;
    if (off <= 0.02) {
      score += 30;
      reasons.push({ good: true, text: `${money(payment.amount)} matches the ${money(expected)} expected` });
    } else if (off <= 0.1) {
      score += 22;
      reasons.push({ good: true, text: `${money(payment.amount)} is within ${Math.max(1, Math.round(off * 100))}% of the ${money(expected)} expected` });
    } else if (off <= 0.25) {
      score += 10;
      reasons.push({ good: true, text: `${money(payment.amount)} is within 25% of the ${money(expected)} expected` });
    } else {
      reasons.push({
        good: false,
        text: `${money(payment.amount)} is ${payment.amount > expected ? 'more' : 'less'} than the ${money(expected)} expected — it may cover other days, or only part of these`,
      });
    }
  } else {
    reasons.push({ good: false, text: 'No rate or hours on these shifts yet, so the amount can’t be checked' });
  }

  // 3. Who paid it.
  const lead = project[0];
  if (payment.payer?.trim()) {
    possible += 20;
    if (lead?.payrollCompany && sameName(payment.payer, lead.payrollCompany)) {
      score += 20;
      reasons.push({ good: true, text: `Paid by ${payment.payer}, this project's payroll company` });
    } else if (lead && sameName(payment.payer, lead.client)) {
      score += 20;
      reasons.push({ good: true, text: `Paid by ${payment.payer}, this project's employer` });
    } else {
      reasons.push({ good: false, text: `Paid by ${payment.payer} — not this project's employer or payroll company` });
    }
  }

  // 4. When it was paid.
  const workedDays = worked.map(j => j.date).sort();
  if (workedDays.length > 0 && payment.date) {
    possible += 10;
    const first = workedDays[0];
    const last = workedDays[workedDays.length - 1];
    const sinceLast = differenceInCalendarDays(parseISO(payment.date), parseISO(last));
    if (payment.date < first) {
      score -= 20;
      reasons.push({ good: false, text: `Dated ${day(payment.date)}, before this project's first day` });
    } else if (sinceLast < 0) {
      score += 5;
      reasons.push({ good: true, text: `Paid partway through the project — it may cover only the first days` });
    } else if (sinceLast <= 21) {
      score += 10;
      reasons.push({ good: true, text: `Paid ${sinceLast} day${sinceLast === 1 ? '' : 's'} after the last day — usual payroll timing` });
    } else if (sinceLast <= 45) {
      score += 5;
      reasons.push({ good: true, text: `Paid ${sinceLast} days after the last day — later than usual` });
    } else {
      reasons.push({ good: false, text: `Paid ${sinceLast} days after the last day — a long way after` });
    }
  }

  const percent = possible > 0 ? Math.max(0, Math.min(100, Math.round((score / possible) * 100))) : 0;
  return { percent, level: percent >= 70 ? 'high' : percent >= 40 ? 'medium' : 'low', reasons, expected };
}

/**
 * Another project the payment fits clearly better, if there is one — so a
 * stub for last week's job, opened on this week's shift, says so.
 */
export function betterProject(payment: FoundPayment, current: Job, ctx: MatchContext): { project: Job[]; match: ProjectMatch } | null {
  const here = matchPaymentToProject(payment, projectOf(current, ctx.allJobs), ctx);
  const best = bestOf(payment, ctx, projectKey(current));
  return best && best.match.percent >= here.percent + 20 && best.match.level !== 'low' ? best : null;
}

/**
 * The project a payment with no shift most likely paid — worked within a week
 * after it or six weeks before it — if any fits better than poorly.
 */
export function bestProjectFor(payment: FoundPayment, ctx: MatchContext): { project: Job[]; match: ProjectMatch } | null {
  const best = bestOf(payment, ctx);
  return best && best.match.level !== 'low' ? best : null;
}

function bestOf(payment: FoundPayment, ctx: MatchContext, skipKey?: string): { project: Job[]; match: ProjectMatch } | null {
  const seen = new Set<string>(skipKey ? [skipKey] : []);
  let best: { project: Job[]; match: ProjectMatch } | null = null;
  for (const job of ctx.allJobs) {
    const key = projectKey(job);
    if (seen.has(key)) continue;
    seen.add(key);
    if (effectiveHoursWorked(job) <= 0) continue;
    const gap = differenceInCalendarDays(parseISO(payment.date), parseISO(job.date));
    if (Number.isNaN(gap) || gap < -7 || gap > 45) continue;
    const project = projectOf(job, ctx.allJobs);
    const match = matchPaymentToProject(payment, project, ctx);
    if (!best || match.percent > best.match.percent) best = { project, match };
  }
  return best;
}
