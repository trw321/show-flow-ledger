import type { Employer, Job } from './store';

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

/**
 * Whether a shift's hours break the hour: any part of an hour is paid as a
 * whole one. Every Local 16 shift does, whatever its employer's own settings
 * say. Other work does when its employer is set to.
 *
 * Only this rule comes with the local. Rates, minimums and overtime differ from
 * one Local 16 contract to the next, so those stay with the shift and employer.
 */
export function breaksTheHour(job: Pick<Job, 'local' | 'jobNumber'>, employer?: Pick<Employer, 'roundUpToWholeHours' | 'name'>): boolean {
  return isLocal16Shift(job) || !!employer?.roundUpToWholeHours;
}

/** What to show on a shift so it's clear which rule is on and why, or null when it isn't. */
export function breakTheHourLabel(job: Pick<Job, 'local' | 'jobNumber'>, employer?: Pick<Employer, 'roundUpToWholeHours' | 'name'>): string | null {
  if (isLocal16Shift(job)) return 'Local 16 · breaks the hour';
  if (employer?.roundUpToWholeHours) return `${employer.name} · breaks the hour`;
  return null;
}
