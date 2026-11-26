import type { Employer, Job } from './store';
import { BGCA_BILLING_STEP_HOURS, isBgcaShift } from './bgca';

/**
 * Local 16's dispatch numbers every job year-dash-code ("2026-3569"), and it's
 * sometimes written without the year ("2705" is 2026-2705). Work from anywhere
 * else (Odeum, panitechnics, an ia8 card) comes without one, so the number is
 * how a pasted Local 16 offer is known even when its local wasn't filled in.
 */
const LOCAL16_JOB_NUMBER = /^(?:\d{4}-)?\d{4}$/;

/** A shift dispatched by IATSE Local 16. */
export function isLocal16Shift(job: Pick<Job, 'local' | 'jobNumber'>): boolean {
  const local = job.local?.trim();
  if (local) return (local.match(/\d+/)?.[0] ?? '') === '16';
  return LOCAL16_JOB_NUMBER.test((job.jobNumber ?? '').trim());
}

/** What's needed to know how a shift's hours are counted. */
type HoursShift = Pick<Job, 'local' | 'jobNumber'> & Partial<Pick<Job, 'contract' | 'notes' | 'venue'>>;

/**
 * Whether a shift's hours break the hour: any part of an hour is paid as a
 * whole one. Every Local 16 shift does, whatever its employer's own settings
 * say, but the Civic Auditorium's, which break the half hour instead (see
 * bgca.ts). Other work does when its employer is set to.
 *
 * Only this rule comes with the local. Rates, minimums and overtime differ from
 * one Local 16 contract to the next, so those stay with the shift and employer.
 */
export function breaksTheHour(job: HoursShift, employer?: Pick<Employer, 'roundUpToWholeHours' | 'name'>): boolean {
  if (isBgcaShift(job)) return false;
  return isLocal16Shift(job) || !!employer?.roundUpToWholeHours;
}

/**
 * How a shift's paid time is counted, in hours: any part of one is paid as a
 * whole one. 1 breaks the hour, 0.5 the half hour (the Civic Auditorium), 0
 * pays to the minute.
 */
export function billingStepHours(job: HoursShift, employer?: Pick<Employer, 'roundUpToWholeHours' | 'name'>): number {
  if (isBgcaShift(job)) return BGCA_BILLING_STEP_HOURS;
  return breaksTheHour(job, employer) ? 1 : 0;
}

/** Hours as paid, by the step: a hair under, so 8 hours that arithmetic made 8.0000001 stay 8. */
export function billedHours(hours: number, step: number): number {
  return step > 0 ? Math.ceil(hours / step - 1e-9) * step : hours;
}

/** What to show on a shift so it's clear which rule is on and why, or null when it isn't. */
export function breakTheHourLabel(job: HoursShift, employer?: Pick<Employer, 'roundUpToWholeHours' | 'name'>): string | null {
  if (isBgcaShift(job)) return 'Civic Auditorium · breaks the half hour';
  if (isLocal16Shift(job)) return 'Local 16 · breaks the hour';
  if (employer?.roundUpToWholeHours) return `${employer.name} · breaks the hour`;
  return null;
}
