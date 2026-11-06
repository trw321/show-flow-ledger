import { addDays, format, parseISO } from 'date-fns';
import type { Employer } from './store';

// Escalating "where's my money" tiers for work that is done and priced but
// has no payment logged yet. Each employer's schedule says when its pay is
// due; nothing sounds until then, and it escalates the longer it goes past.
// An employer whose schedule is not known waits the three weeks this always
// used, so nothing changes for one that was never set up.
export type PayTimingTier = 'none' | 'watching' | 'warm' | 'blazing';

/** How long after the work each schedule's pay lands, at the latest — a
 *  Monday's work paid on the Friday after the week, or after the fortnight. */
const LAG_DAYS: Partial<Record<NonNullable<Employer['paySchedule']>, number>> = {
  weekly: 12,
  'bi-weekly': 19,
  'semi-monthly': 20,
  monthly: 35,
};

/** When it is not known how an employer pays. */
export const DEFAULT_LAG_DAYS = 21;

/** Days after the work this employer's pay should be in by. */
export function payLagDays(employer: Employer | undefined): number {
  if (employer?.payLagDays && employer.payLagDays > 0) return employer.payLagDays;
  return (employer?.paySchedule && LAG_DAYS[employer.paySchedule]) || DEFAULT_LAG_DAYS;
}

/** The day a slow first check should land, for an employer that has one. */
export function firstCheckDate(employer: Employer | undefined, firstDayHere?: string): string | undefined {
  if (!employer?.firstCheckWeeks || employer.firstCheckWeeks <= 0 || !firstDayHere) return undefined;
  return format(addDays(parseISO(firstDayHere), Math.round(employer.firstCheckWeeks * 7)), 'yyyy-MM-dd');
}

/**
 * The day pay for work ending on `lastDay` should have arrived by. A first
 * check that takes weeks to set up covers everything worked before it, so
 * nothing worked in those first weeks is due before it.
 */
export function payDueDate(lastDay: string, employer: Employer | undefined, firstDayHere?: string): string {
  const due = format(addDays(parseISO(lastDay), payLagDays(employer)), 'yyyy-MM-dd');
  const firstCheck = firstCheckDate(employer, firstDayHere);
  return firstCheck && lastDay < firstCheck && firstCheck > due ? firstCheck : due;
}

/** How worried to be, by how many days past due the pay is. */
export function payTimingTier(daysPastDue: number): PayTimingTier {
  if (daysPastDue >= 42) return 'blazing';
  if (daysPastDue >= 21) return 'warm';
  if (daysPastDue >= 0) return 'watching';
  return 'none';
}

/** How an employer pays, in a few words. Empty when nobody has said. */
export function payScheduleLabel(employer: Employer): string {
  const regular = employer.paySchedule === 'weekly' ? 'weekly'
    : employer.paySchedule === 'bi-weekly' ? 'bi-weekly'
    : employer.paySchedule === 'semi-monthly' ? 'twice a month'
    : employer.paySchedule === 'monthly' ? 'monthly'
    : '';
  if (employer.firstCheckWeeks) return `first check in ${employer.firstCheckWeeks} wks${regular ? ', then ' + regular : ''}`;
  if (regular) return 'paid ' + regular;
  if (employer.payLagDays) return `paid ~${employer.payLagDays} days after`;
  return '';
}

export const PAY_TIMING_LABELS: Record<PayTimingTier, string> = {
  none: '',
  watching: 'Watching',
  warm: 'Warm',
  blazing: 'Blazing',
};
