import type { Employer, Job } from './store';
import { effectiveHoursWorked, netHoursWorked } from './payCalc';
import { resolveEmployer } from './employerMatch';

export interface PtoBalance {
  /** Earned so far from hours worked for this employer. */
  earned: number;
  /** Taken as paid time off. */
  used: number;
  /** What is left: anything banked before, plus earned, less used. */
  banked: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Paid time off with one employer: earned at its rate on the hours actually
 * worked — not on PTO itself, and not on minimum-call padding — and spent by
 * shifts marked as PTO. Null when the employer has no PTO set up.
 */
export function ptoBalance(employer: Employer, jobs: Job[]): PtoBalance | null {
  if (!employer.ptoEarnHours || employer.ptoEarnHours <= 0) return null;
  const per = employer.ptoPerHoursWorked && employer.ptoPerHoursWorked > 0 ? employer.ptoPerHoursWorked : 30;
  const mine = jobs.filter(j => resolveEmployer(j.client, [employer])?.id === employer.id);
  const worked = mine.filter(j => !j.pto).reduce((sum, j) => sum + netHoursWorked(j), 0);
  const used = mine.filter(j => j.pto).reduce((sum, j) => sum + effectiveHoursWorked(j), 0);
  const earned = (worked / per) * employer.ptoEarnHours;
  return { earned: round1(earned), used: round1(used), banked: round1((employer.ptoStartingHours ?? 0) + earned - used) };
}
