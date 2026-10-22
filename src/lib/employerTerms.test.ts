import { describe, it, expect } from 'vitest';
import { jobPayBreakdown, calculateExpectedPay, getConsecutiveDayStreak } from './payCalc';
import { ptoBalance } from './pto';
import { estimateTaxForYear } from './taxEstimate';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import type { Employer, Job } from './store';

const shift = (id: string, date: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Show', client: 'Odeum', venue: 'Hall', date, status: 'completed',
  hoursWorked: 10, hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);

const odeum = (extra: Partial<Employer> = {}): Employer => ({ id: 'e', name: 'Odeum', overtimeRule: 'daily', createdAt: 'x', ...extra } as Employer);

describe('paid time off', () => {
  it('pays its hours at straight time, with no overtime', () => {
    const day = shift('a', '2026-10-05', { pto: true });
    // Ten hours worked would be 8 straight and 2 at time and a half; ten off is ten straight.
    expect(jobPayBreakdown(day, [day], [odeum()], EMPTY_PROFILE).gross).toBe(500);
  });

  it('earns no vacation, which is on work', () => {
    const day = shift('a', '2026-10-05', { pto: true });
    expect(jobPayBreakdown(day, [day], [odeum({ vacationPercent: 8 })], EMPTY_PROFILE).vacation).toBe(0);
  });

  it('agrees with the Money page', () => {
    const day = shift('a', '2026-10-05', { pto: true, hoursWorked: 8 });
    expect(calculateExpectedPay([day], day, [day], odeum()).total).toBeCloseTo(jobPayBreakdown(day, [day], [odeum()], EMPTY_PROFILE).gross, 2);
  });

  it('is not a day worked, so it breaks a run toward the 6th day', () => {
    const run = [shift('1', '2026-10-01'), shift('2', '2026-10-02', { pto: true }), shift('3', '2026-10-03')];
    expect(getConsecutiveDayStreak('2026-10-03', 'Odeum', run)).toBe(1);
  });

  it('is earned on hours worked and spent by days off', () => {
    const jobs = [shift('1', '2026-10-01', { hoursWorked: 30 }), shift('2', '2026-10-02', { hoursWorked: 30 }), shift('3', '2026-10-03', { pto: true, hoursWorked: 1.5 })];
    const balance = ptoBalance(odeum({ ptoEarnHours: 1, ptoPerHoursWorked: 30, ptoStartingHours: 4 }), jobs);
    expect(balance).toEqual({ earned: 2, used: 1.5, banked: 4.5 });
  });

  it('is not tracked for an employer without it', () => {
    expect(ptoBalance(odeum(), [shift('1', '2026-10-01')])).toBeNull();
  });
});

describe('a 1099 employer', () => {
  const taxed: PayerProfile = { tax: { federalEffectivePercent: 20 }, locals: [] };

  it('withholds nothing from the pay', () => {
    const day = shift('a', '2026-10-05', { hoursWorked: 8 });
    expect(jobPayBreakdown(day, [day], [odeum({ workerStatus: '1099' })], taxed).tax).toBe(0);
    expect(jobPayBreakdown(day, [day], [odeum()], taxed).tax).toBeCloseTo(80, 2);
  });

  it('withholds nothing on the Money page either', () => {
    const day = shift('a', '2026-10-05', { hoursWorked: 8 });
    expect(calculateExpectedPay([day], day, [day], odeum({ workerStatus: '1099', estimatedTaxPercent: 20 })).total).toBe(400);
  });

  it('still owes income tax at the year end, and self-employment tax on top', () => {
    const e = estimateTaxForYear(0, 0, { federalEffectivePercent: 10 }, 10_000);
    expect(e.federal).toBeCloseTo(1000, 2);
    // 15.3% on 92.35% of it.
    expect(e.selfEmployment).toBeCloseTo(10_000 * 0.9235 * 0.153, 2);
    expect(e.stillOwed).toBeCloseTo(1000 + 10_000 * 0.9235 * 0.153, 2);
  });

  it('stops Social Security at the wage base, W2 wages first', () => {
    const e = estimateTaxForYear(170_000, 0, { socialSecurityWageBase: 176_100 }, 20_000);
    const seBase = 20_000 * 0.9235;
    expect(e.selfEmployment).toBeCloseTo(6_100 * 0.124 + seBase * 0.029, 2);
  });

  it('leaves a W2-only year exactly as it was', () => {
    const before = estimateTaxForYear(50_000, 4_000, { federalEffectivePercent: 12 });
    expect(before.selfEmployment).toBe(0);
    expect(before.federal).toBeCloseTo(6_000, 2);
  });
});

describe('the year from earnings alone', () => {
  it('owes nothing extra on W2 wages that are withheld from', async () => {
    const { estimateYearFromEarnings } = await import('./taxEstimate');
    expect(estimateYearFromEarnings(60_000, 0, { federalEffectivePercent: 12, stateTaxPercent: 4 }).stillOwed).toBeCloseTo(0, 2);
  });

  it('owes the 1099 work its income and self-employment tax', async () => {
    const { estimateYearFromEarnings } = await import('./taxEstimate');
    const e = estimateYearFromEarnings(60_000, 10_000, { federalEffectivePercent: 12, stateTaxPercent: 4 });
    expect(e.stillOwed).toBeCloseTo(10_000 * 0.12 + 10_000 * 0.04 + 10_000 * 0.9235 * 0.153, 2);
  });

  it('owes federal on W2 wages when the W-4 was filed exempt', async () => {
    const { estimateYearFromEarnings } = await import('./taxEstimate');
    // Nothing was withheld for it, so all of it is still to pay.
    expect(estimateYearFromEarnings(60_000, 0, { federalEffectivePercent: 12, federalExempt: true }).stillOwed).toBeCloseTo(7_200, 2);
  });
});
