import { describe, it, expect } from 'vitest';
import {
  estimateTaxForYear,
  SOCIAL_SECURITY_RATE,
  MEDICARE_RATE,
  SOCIAL_SECURITY_WAGE_BASE,
  type TaxProfile,
} from './taxEstimate';

const base: TaxProfile = {
  filingStatus: 'single',
  federalEffectivePercent: 12,
  stateTaxPercent: 6,
  stateDisabilityPercent: 1.1,
  socialSecurityWageBase: 176_100,
};

describe('what the year is expected to cost', () => {
  it('charges each line on gross', () => {
    const e = estimateTaxForYear(50_000, 0, base);
    expect(e.federal).toBeCloseTo(6_000, 2);
    expect(e.socialSecurity).toBeCloseTo(50_000 * SOCIAL_SECURITY_RATE, 2);
    expect(e.medicare).toBeCloseTo(50_000 * MEDICARE_RATE, 2);
    expect(e.state).toBeCloseTo(3_000, 2);
    expect(e.stateDisability).toBeCloseTo(550, 2);
  });

  it('adds up to the total', () => {
    const e = estimateTaxForYear(50_000, 0, base);
    expect(e.totalOwed).toBeCloseTo(
      e.federal + e.socialSecurity + e.medicare + e.state + e.stateDisability, 2,
    );
  });

  it('says what is still to find after what has been withheld', () => {
    const e = estimateTaxForYear(50_000, 8_000, base);
    expect(e.stillOwed).toBeCloseTo(e.totalOwed - 8_000, 2);
  });

  it('reports an overpayment as a negative', () => {
    expect(estimateTaxForYear(50_000, 99_000, base).stillOwed).toBeLessThan(0);
  });
});

describe('claiming exempt', () => {
  it('stops federal withholding, not the federal tax owed at the year end', () => {
    const e = estimateTaxForYear(50_000, 0, { ...base, federalExempt: true });
    // Exempt is about what comes out of each check. The year still owes it.
    expect(e.federal).toBeCloseTo(estimateTaxForYear(50_000, 0, base).federal, 2);
    // The part people get caught by: FICA is not optional.
    expect(e.socialSecurity).toBeCloseTo(50_000 * SOCIAL_SECURITY_RATE, 2);
    expect(e.medicare).toBeCloseTo(50_000 * MEDICARE_RATE, 2);
    expect(e.state).toBeCloseTo(3_000, 2);
  });

  it('says so in as many words', () => {
    const e = estimateTaxForYear(50_000, 0, { ...base, federalExempt: true });
    expect(e.notes.join(' ')).toMatch(/Social Security and Medicare still come out/i);
  });
});

describe('Social Security stops at the wage base', () => {
  it('charges nothing on earnings past it', () => {
    const e = estimateTaxForYear(200_000, 0, base);
    expect(e.socialSecurity).toBeCloseTo(176_100 * SOCIAL_SECURITY_RATE, 2);
  });

  it('keeps charging Medicare, which has no cap', () => {
    const e = estimateTaxForYear(200_000, 0, base);
    // Charged on the whole 200k, where Social Security stopped at 176.1k.
    expect(e.medicare).toBeCloseTo(200_000 * MEDICARE_RATE, 2);
    expect(e.medicare).toBeGreaterThan(e.socialSecurity * (MEDICARE_RATE / SOCIAL_SECURITY_RATE));
  });

  it('warns when no wage base is set rather than silently capping', () => {
    const e = estimateTaxForYear(200_000, 0, { ...base, socialSecurityWageBase: undefined });
    expect(e.socialSecurity).toBeCloseTo(200_000 * SOCIAL_SECURITY_RATE, 2);
    expect(e.notes.join(' ')).toMatch(/wage base/i);
  });

  it('uses the SSA figure for the year when none is typed', () => {
    const e = estimateTaxForYear(200_000, 0, { ...base, socialSecurityWageBase: undefined }, 0, 2026);
    expect(SOCIAL_SECURITY_WAGE_BASE[2026]).toBe(184_500);
    expect(e.socialSecurity).toBeCloseTo(184_500 * SOCIAL_SECURITY_RATE, 2);
    expect(e.notes.join(' ')).not.toMatch(/charged on everything/i);
  });

  it('lets a typed figure win over the table', () => {
    const e = estimateTaxForYear(200_000, 0, { ...base, socialSecurityWageBase: 150_000 }, 0, 2026);
    expect(e.socialSecurity).toBeCloseTo(150_000 * SOCIAL_SECURITY_RATE, 2);
  });

  it('does not guess a year it has no figure for', () => {
    const e = estimateTaxForYear(200_000, 0, { ...base, socialSecurityWageBase: undefined }, 0, 2031);
    expect(e.socialSecurity).toBeCloseTo(200_000 * SOCIAL_SECURITY_RATE, 2);
    expect(e.notes.join(' ')).toMatch(/2031/);
  });
});

describe('dependents', () => {
  it('takes their credits off the federal line', () => {
    const withKids = estimateTaxForYear(50_000, 0, { ...base, dependentsUnder17: 2, creditPerChild: 2_000 });
    expect(withKids.federal).toBeCloseTo(6_000 - 4_000, 2);
  });

  it('never drives the federal line below zero', () => {
    const e = estimateTaxForYear(10_000, 0, { ...base, dependentsUnder17: 5, creditPerChild: 2_000 });
    expect(e.federal).toBe(0);
  });

  it('does not touch Social Security or Medicare', () => {
    const e = estimateTaxForYear(50_000, 0, { ...base, dependentsUnder17: 2, creditPerChild: 2_000 });
    expect(e.socialSecurity).toBeCloseTo(50_000 * SOCIAL_SECURITY_RATE, 2);
  });
});

describe('the additional Medicare threshold follows how you file', () => {
  it('starts at 200k when single', () => {
    const e = estimateTaxForYear(210_000, 0, base);
    expect(e.medicare).toBeCloseTo(210_000 * MEDICARE_RATE + 10_000 * 0.009, 2);
  });

  it('starts at 250k when married filing jointly', () => {
    const e = estimateTaxForYear(210_000, 0, { ...base, filingStatus: 'married_jointly' });
    expect(e.medicare).toBeCloseTo(210_000 * MEDICARE_RATE, 2);
  });
});

describe('when nothing has been set up', () => {
  it('reads zero on the lines it cannot know, and says why', () => {
    const e = estimateTaxForYear(50_000, 0, {});
    expect(e.federal).toBe(0);
    expect(e.state).toBe(0);
    expect(e.notes.join(' ')).toMatch(/No federal rate set/i);
    // FICA is knowable without any setup, so it is still charged.
    expect(e.socialSecurity).toBeGreaterThan(0);
  });
});
