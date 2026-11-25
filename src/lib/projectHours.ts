import type { Job, Employer } from './store';
import type { PayerProfile } from './payerProfile';
import { jobHoursBreakdown, netHoursWorked } from './payCalc';
import { needsHours } from './useNeedsHours';

/**
 * A project's hours in one place: how many were worked, what they were paid
 * at, which have been paid for, and what's missing. The tiers come from the
 * same day maths the pay does (jobHoursBreakdown), so a stub's ST / OT / DT
 * lines can be read against them.
 */
export interface ProjectHours {
  /** Hours stood there, off-the-clock meals out: the figure on the project card. */
  worked: number;
  /** What the pay is worked out on: worked, plus minimum calls and part hours paid whole. */
  paid: number;
  straight: number;
  overtime: number;
  double: number;
  /** After midnight, at the night rate. */
  night: number;
  /** Paid, never worked: a minimum call's padding, or hours owed after a meal. */
  minimum: number;
  /** Worked hours that fell on a 6th or 7th day. */
  premiumDay: number;
  pto: number;
  /** Part hours paid as whole ones, under union rules. */
  roundedUp: number;
  /** Days with hours on them. */
  days: number;
  longest: { date: string; hours: number } | null;
  /** Hours on days a payment has reached, and on days still waiting for one. */
  paidFor: number;
  owed: number;
  /** Days gone by with no hours on them: the totals are short by these. */
  needHours: number;
}

export function projectHours(
  jobs: Job[],
  allJobs: Job[],
  employers: Employer[],
  payer?: PayerProfile,
  paidIds?: Set<string>,
): ProjectHours {
  const out: ProjectHours = {
    worked: 0, paid: 0, straight: 0, overtime: 0, double: 0, night: 0, minimum: 0, premiumDay: 0, pto: 0,
    roundedUp: 0, days: 0, longest: null, paidFor: 0, owed: 0, needHours: 0,
  };
  const byDay = new Map<string, number>();
  const needDays = new Set<string>();
  for (const job of jobs) {
    // The same test as Log hours: an end saved at the start time needs them too.
    if (needsHours(job)) needDays.add(job.date);
    const worked = netHoursWorked(job);
    if (worked <= 0) continue;
    const t = jobHoursBreakdown(job, allJobs, employers, payer);
    out.worked += worked;
    out.straight += t.straight;
    out.overtime += t.overtime;
    out.double += t.double;
    out.night += t.night;
    out.minimum += t.minimum;
    out.premiumDay += t.premiumDay;
    out.pto += t.pto;
    byDay.set(job.date, (byDay.get(job.date) ?? 0) + worked);
    if (paidIds) {
      if (paidIds.has(job.id)) out.paidFor += worked;
      else out.owed += worked;
    }
  }
  out.paid = out.straight + out.overtime + out.double + out.night + out.minimum + out.pto;
  // Whatever was paid past the hours worked and the minimums is part hours made whole.
  out.roundedUp = Math.max(0, out.paid - out.minimum - out.worked);
  out.days = byDay.size;
  for (const [date, hours] of byDay) {
    if (!out.longest || hours > out.longest.hours) out.longest = { date, hours };
  }
  // A day that has hours on another call isn't missing any.
  out.needHours = [...needDays].filter(d => !byDay.has(d)).length;
  return out;
}
