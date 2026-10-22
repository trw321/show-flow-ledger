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
  /** 1099 earnings so far — nothing withheld from them. */
  selfEmployedYearToDate: number;
  /** Self-employment tax on the 1099 earnings: both halves of Social
   *  Security and Medicare, which an employer would otherwise split with you. */
  selfEmployment: number;
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
/** Self-employment tax: the share of 1099 earnings it is charged on, and its two parts. */
export const SE_EARNINGS_SHARE = 0.9235;
export const SE_SOCIAL_SECURITY_RATE = 0.124;
export const SE_MEDICARE_RATE = 0.029;

export function estimateTaxForYear(
  grossYearToDate: number,
  withheldYearToDate: number,
  profile: TaxProfile,
  /** 1099 earnings, kept apart because nothing was withheld from them. */
  selfEmployedYearToDate = 0,
): TaxEstimate {
  const notes: string[] = [];
  const gross = Math.max(0, grossYearToDate);
  const selfEmployed = Math.max(0, selfEmployedYearToDate);
  // Income tax is on everything earned, W2 and 1099 alike.
  const taxable = gross + selfEmployed;

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

  // On 1099 work you are the employer too: both halves of Social Security
  // (12.4%) and Medicare (2.9%), on 92.35% of the earnings. Social Security
  // stops at the wage base, which W2 wages use up first.
  const seBase = selfEmployed * SE_EARNINGS_SHARE;
  const ssRoom = wageBase > 0 ? Math.max(0, wageBase - ssWages) : Infinity;
  const selfEmployment = Math.min(seBase, ssRoom) * SE_SOCIAL_SECURITY_RATE + seBase * SE_MEDICARE_RATE;
  if (selfEmployed > 0) {
    notes.push('1099 income has nothing withheld, and carries self-employment tax — both halves of Social Security and Medicare.');
  }

  const credits = (profile.dependentsUnder17 ?? 0) * (profile.creditPerChild ?? 0)
    + (profile.otherDependents ?? 0) * (profile.creditPerOtherDependent ?? 0);

  // Exempt stops federal WITHHOLDING, not the tax: whatever is owed on the
  // year is still due when you file, which is the point of an estimate made
  // for the end of the year. It used to read zero here, as if exempt meant
  // owing nothing.
  const rate = (profile.federalEffectivePercent ?? 0) / 100;
  const federal = Math.max(0, taxable * rate - credits);
  if (profile.federalExempt) {
    notes.push('W-4 filed exempt: no federal income tax is withheld, but it is still owed when you file — it is counted here. Social Security and Medicare still come out.');
  }
  if (!profile.federalEffectivePercent) {
    notes.push('No federal rate set, so the federal line reads zero — upload a stub and it can be worked out.');
  }

  const state = taxable * ((profile.stateTaxPercent ?? 0) / 100);
  const stateDisability = gross * ((profile.stateDisabilityPercent ?? 0) / 100);
  if (!profile.stateTaxPercent && profile.state) {
    notes.push(`No rate set for ${profile.state}, so the state line reads zero.`);
  }

  const totalOwed = federal + socialSecurity + medicare + selfEmployment + state + stateDisability;
  return {
    grossYearToDate: gross,
    federal,
    socialSecurity,
    medicare,
    state,
    stateDisability,
    selfEmployedYearToDate: selfEmployed,
    selfEmployment,
    totalOwed,
    withheld: withheldYearToDate,
    stillOwed: totalOwed - withheldYearToDate,
    dependentCredits: Math.min(credits, (profile.federalEffectivePercent ?? 0) / 100 * taxable),
    notes,
  };
}

/**
 * The year from earnings alone, when what was withheld is not known stub by
 * stub. A W2 employer withholds what is due on W2 wages as it goes — Social
 * Security, Medicare and state, and federal too unless the W-4 says exempt —
 * so what is still owed at the end of the year is the tax on 1099 work, plus
 * federal on W2 wages filed exempt.
 */
export function estimateYearFromEarnings(w2Gross: number, selfEmployedGross: number, profile: TaxProfile): TaxEstimate {
  const onWagesAlone = estimateTaxForYear(w2Gross, 0, profile);
  const withheldOnWages = onWagesAlone.socialSecurity + onWagesAlone.medicare
    + onWagesAlone.state + onWagesAlone.stateDisability
    + (profile.federalExempt ? 0 : onWagesAlone.federal);
  return estimateTaxForYear(w2Gross, withheldOnWages, profile, selfEmployedGross);
}
