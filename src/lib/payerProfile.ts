import type { Employer, Job } from '@/lib/store';
import type { TaxProfile } from '@/lib/taxEstimate';

/**
 * Who sets which number.
 *
 * Rates were all living on the employer, which is why learning one kept
 * overwriting another: the same employer works under different contracts, and
 * two of these numbers were never the employer's to set in the first place.
 *
 *  - The RATE and the overtime terms are the contract's, so they live on the
 *    shift. Already do.
 *  - UNION DUES and VACATION are the LOCAL's. IA16 takes 3.5%, IA8 nearer 4%,
 *    whoever you happen to be working for that week.
 *  - TAX is YOURS. It follows your bracket and your state, not any employer.
 *  - The 401k match, the night premium and the overtime rule are the
 *    employer's, and stay there.
 */

/** What a local takes, and what it pays on top. Read off your stubs. */
export interface LocalRates {
  /** "16", "8" — matched loosely, so "ia16", "IA 16" and "Local 16" agree. */
  local: string;
  unionDuesPercent?: number;
  vacationPercent?: number;
}

/** Numbers that follow you rather than any employer or local. */
export interface PayerProfile {
  /** Filing status, dependents, state, exempt — see taxEstimate. */
  tax?: TaxProfile;
  locals: LocalRates[];
}

export const EMPTY_PROFILE: PayerProfile = { locals: [] };

/** "ia16", "IA 16", "Local 16", "16" all name the same local. */
export function normaliseLocal(name?: string): string {
  if (!name) return '';
  const digits = name.match(/\d+/);
  return digits ? digits[0] : name.trim().toLowerCase();
}

export function findLocalRates(profile: PayerProfile, localName?: string): LocalRates | undefined {
  const key = normaliseLocal(localName);
  if (!key) return undefined;
  return profile.locals.find(l => normaliseLocal(l.local) === key);
}

/**
 * The percentages to apply to one shift, from whichever source owns each.
 *
 * The employer is still consulted last for dues and vacation so that ledgers
 * built before locals existed keep calculating the same way — nothing has to
 * be re-entered for old shifts to stay right.
 */
export function ratesForShift(
  job: Job,
  employer: Employer | undefined,
  profile: PayerProfile,
): { unionDuesPercent?: number; estimatedTaxPercent?: number; vacationPercent?: number } {
  const fromLocal = findLocalRates(profile, job.local ?? employer?.unionLocal);
  return {
    unionDuesPercent: fromLocal?.unionDuesPercent ?? employer?.unionDuesPercent,
    vacationPercent: fromLocal?.vacationPercent ?? employer?.vacationPercent,
    // Exempt stops federal income tax withholding. It does not stop Social
    // Security or Medicare — those are not modelled per shift, they are in
    // the year-end estimate, which says so plainly.
    // A 1099 employer withholds nothing; what is owed on it shows in the
    // year-end estimate instead. Exempt stops federal withholding too.
    estimatedTaxPercent: employer?.workerStatus === '1099' || profile.tax?.federalExempt
      ? 0
      : profile.tax?.federalEffectivePercent ?? employer?.estimatedTaxPercent,
  };
}
