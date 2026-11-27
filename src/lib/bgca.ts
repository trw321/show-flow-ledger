import type { Job } from './store';
import { shiftContract } from './contracts';
import type { HolidayKey } from './holidays';

/**
 * Bill Graham Civic Auditorium, "Civic Auditorium" on a dispatch, is under its
 * own contract (BGCA CONCERTS&COMEDY 2024-2029), not one of Local 16's usual
 * ones, and two of its terms differ from the rest of Local 16's work. As the
 * owner told them on 2026-11-26, not read from the agreement:
 *
 *  - It breaks the half hour, not the hour: any part of a half hour is paid
 *    as a whole half hour. 3h10m pays 3.5, where other Local 16 work pays 4.
 *  - A holiday's hours pay half the straight rate on top of what they already
 *    pay: 2× after midnight on Thanksgiving is 2.5×, 1× is 1.5×.
 *
 * Which holidays the contract names isn't known yet beyond Thanksgiving, so
 * only Thanksgiving pays it: an estimate under the pay, never over it.
 */

/** Any part of this pays as the whole of it, at the Civic Auditorium. */
export const BGCA_BILLING_STEP_HOURS = 0.5;
/** A holiday hour gets this much of the straight rate added on top. */
export const BGCA_HOLIDAY_EXTRA = 0.5;
/** The holidays the contract is known to pay on. */
export const BGCA_HOLIDAYS: readonly HolidayKey[] = ['thanksgiving'];

const BGCA_CONTRACT = /^\s*BGCA\b/i;
const BGCA_VENUE = /\bbill\s+graham\b|\bbgca\b|^\s*(?:the\s+)?civic\s+auditorium\s*$/i;

/**
 * A shift under the Civic Auditorium's contract: its dispatch names that
 * contract, or names none and is at the venue. A shift there under another
 * named contract goes by that one.
 */
export function isBgcaShift(job: Partial<Pick<Job, 'contract' | 'notes' | 'venue'>>): boolean {
  const contract = shiftContract({ contract: job.contract, notes: job.notes });
  if (contract) return BGCA_CONTRACT.test(contract);
  return BGCA_VENUE.test(job.venue ?? '');
}

