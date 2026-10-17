/**
 * What the year is likely to cost in tax, and what has already been withheld.
 *
 * This is an estimate and says so everywhere. Rates that are set by statute
 * and barely move (the FICA percentages) are constants; rates that change
 * every year or depend on where you live (the Social Security wage base, your
 * federal effective rate, your state) are inputs you can see and correct,
 * because a number baked in here would quietly go stale and nobody would know.
 */

export type FilingStatus = 'single' | 'married_jointly' | 'married_separately' | 'head_of_household';

export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  married_jointly: 'Married, filing jointly',
  married_separately: 'Married, filing separately',
  head_of_household: 'Head of household',
};

/**
 * Social Security and Medicare, the employee halves. Statutory and unchanged
 * for decades, which is why they are constants rather than settings.
 *
 * These are NOT covered by claiming exempt on a W-4. Exempt stops federal
 * income tax withholding and nothing else — FICA still comes out of every
 * cheque, and so does state disability where a state has it.
 */
export const SOCIAL_SECURITY_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
/** Medicare takes another 0.9% above this, and no employer matches it. */
export const ADDITIONAL_MEDICARE_RATE = 0.009;

export interface TaxProfile {
  filingStatus?: FilingStatus;
  /** Children claimed under 17 — each one is worth a credit against the bill. */
  dependentsUnder17?: number;
  /** Other dependents, worth a smaller credit. */
  otherDependents?: number;
  /** Two-letter state, for the state line of the estimate. */
  state?: string;
  /** Your state's effective rate on this income. Entered, not guessed. */
  stateTaxPercent?: number;
  /** State disability or paid-leave withholding — CA SDI, NY PFL and the like. */
  stateDisabilityPercent?: number;
  /**
   * Your federal effective rate — what actually comes out across the year once
   * the standard deduction and your bracket are accounted for, not your top
   * bracket. Learned from stubs if you upload them.
   */
  federalEffectivePercent?: number;
  /** W-4 filed exempt: no federal income tax withheld. FICA still is. */
  federalExempt?: boolean;
  /** Social Security stops at this much wage. A yearly figure — keep it current. */
  socialSecurityWageBase?: number;
  /** Credit per child under 17, and per other dependent. Yearly figures. */
  creditPerChild?: number;
  creditPerOtherDependent?: number;
}

export interface TaxEstimate {
  grossYearToDate: number;
  federal: number;
  socialSecurity: number;
  medicare: number;
  state: number;
  stateDisability: number;
  /** Everything above, which is what the year is expected to cost. */
  totalOwed: number;
  /** What the stubs say has actually been withheld, where they are known. */
  withheld: number;
  /** Positive means still to find; negative means overpaid. */
  stillOwed: number;
  /** Credits already taken off the federal line. */
  dependentCredits: number;
  notes: string[];
}

/**
 * The year's estimated tax on gross earnings so far.
 *
 * Deliberately simple arithmetic on an effective rate rather than a bracket
 * table: a bracket table would need replacing every January and would be
 * wrong the moment it was not, whereas an effective rate can be read off a
 * stub and corrected in a second.
 */
export function estimateTaxForYear(
  grossYearToDate: number,
  withheldYearToDate: number,
  profile: TaxProfile,
): TaxEstimate {
  const notes: string[] = [];
  const gross = Math.max(0, grossYearToDate);

  const wageBase = profile.socialSecurityWageBase ?? 0;
  const ssWages = wageBase > 0 ? Math.min(gross, wageBase) : gross;
  if (wageBase > 0 && gross > wageBase) {
    notes.push('Past the Social Security wage base — nothing more is taken for it this year.');
  }
  if (wageBase <= 0) {
    notes.push('No Social Security wage base set, so it is being charged on everything.');
  }
  const socialSecurity = ssWages * SOCIAL_SECURITY_RATE;

  // Medicare has no cap, and takes more above a threshold that depends on how
  // you file. The extra is only ever on the part above it.
  const additionalThreshold = profile.filingStatus === 'married_jointly' ? 250_000 : 200_000;
  const medicare = gross * MEDICARE_RATE
    + Math.max(0, gross - additionalThreshold) * ADDITIONAL_MEDICARE_RATE;
  if (gross > additionalThreshold) {
    notes.push('Over the additional Medicare threshold — an extra 0.9% applies above it.');
  }

  const credits = (profile.dependentsUnder17 ?? 0) * (profile.creditPerChild ?? 0)
    + (profile.otherDependents ?? 0) * (profile.creditPerOtherDependent ?? 0);

  let federal = 0;
  if (profile.federalExempt) {
    notes.push('W-4 filed exempt: no federal income tax withheld. Social Security and Medicare still come out.');
  } else {
    const rate = (profile.federalEffectivePercent ?? 0) / 100;
    federal = Math.max(0, gross * rate - credits);
    if (!profile.federalEffectivePercent) {
      notes.push('No federal rate set, so the federal line reads zero — upload a stub and it can be worked out.');
    }
  }

  const state = gross * ((profile.stateTaxPercent ?? 0) / 100);
  const stateDisability = gross * ((profile.stateDisabilityPercent ?? 0) / 100);
  if (!profile.stateTaxPercent && profile.state) {
    notes.push(`No rate set for ${profile.state}, so the state line reads zero.`);
  }

  const totalOwed = federal + socialSecurity + medicare + state + stateDisability;
  return {
    grossYearToDate: gross,
    federal,
    socialSecurity,
    medicare,
    state,
    stateDisability,
    totalOwed,
    withheld: withheldYearToDate,
    stillOwed: totalOwed - withheldYearToDate,
    dependentCredits: Math.min(credits, (profile.federalEffectivePercent ?? 0) / 100 * gross),
    notes,
  };
}
