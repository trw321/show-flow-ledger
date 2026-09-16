import { describe, it, expect } from 'vitest';
import { compareStubToShifts, disagreements } from './stubComparison';
import type { StubParsed } from './stubMatching';
import type { Job, Employer } from './store';

const employer: Employer = {
  id: 'e1',
  name: 'GSW Arena LLC',
  overtimeRule: 'daily',
  unionDuesPercent: 3.5,
  estimatedTaxPercent: 22,
  vacationPercent: 6,
  nightPremiumEnabled: false,
  createdAt: '2026-01-01',
};

const job = (over: Partial<Job> & { id: string; date: string }): Job => ({
  name: 'Warriors Game',
  client: 'GSW Arena LLC',
  venue: 'Chase Center',
  status: 'completed',
  notes: '',
  createdAt: '2026-01-01',
  hourlyRate: 50,
  hoursWorked: 8,
  ...over,
});

const row = (rows: ReturnType<typeof compareStubToShifts>, key: string) => rows.find(r => r.key === key)!;

describe('compareStubToShifts', () => {
  const jobs = [
    job({ id: 'a', date: '2026-09-08' }),
    job({ id: 'b', date: '2026-09-09' }),
    job({ id: 'c', date: '2026-09-10' }),
  ];

  it('totals hours across every shift the stub covers', () => {
    const rows = compareStubToShifts({ totalHours: 24 } as StubParsed, jobs, jobs, [employer]);
    expect(row(rows, 'hours').calculated).toBe(24);
    expect(row(rows, 'hours').status).toBe('match');
  });

  it('flags a line that disagrees and reports the direction', () => {
    // 24h at $50 = $1200 gross; stub claims $1000
    const rows = compareStubToShifts({ grossPay: 1000 } as StubParsed, jobs, jobs, [employer]);
    const gross = row(rows, 'gross');
    expect(gross.calculated).toBe(1200);
    expect(gross.delta).toBe(-200);
    expect(gross.status).toBe('off');
  });

  it('treats rounding differences as agreement', () => {
    const rows = compareStubToShifts({ grossPay: 1200.25 } as StubParsed, jobs, jobs, [employer]);
    expect(row(rows, 'gross').status).toBe('match');
  });

  it('separates a small discrepancy from a real one', () => {
    expect(row(compareStubToShifts({ grossPay: 1203 } as StubParsed, jobs, jobs, [employer]), 'gross').status).toBe('close');
    expect(row(compareStubToShifts({ grossPay: 1260 } as StubParsed, jobs, jobs, [employer]), 'gross').status).toBe('off');
  });

  it('reconciles dues and tax as their own lines', () => {
    // Dues are 3.5% of the $1200 gross; tax is 22% of what's left after dues
    // (union dues come out pre-tax), so 22% of $1158 — not of the gross.
    const rows = compareStubToShifts({ duesAmount: 42, taxAmount: 254.76 } as StubParsed, jobs, jobs, [employer]);
    expect(row(rows, 'dues').status).toBe('match');
    expect(row(rows, 'tax').status).toBe('match');
  });

  it('marks values the stub never stated as missing, not as zero', () => {
    const rows = compareStubToShifts({ totalHours: 24 } as StubParsed, jobs, jobs, [employer]);
    expect(row(rows, 'net').status).toBe('missing');
    expect(row(rows, 'net').delta).toBeUndefined();
  });

  it('will not compare a rate when the shifts are at different rates', () => {
    const mixed = [job({ id: 'a', date: '2026-09-08' }), job({ id: 'b', date: '2026-09-09', hourlyRate: 61.5 })];
    const rows = compareStubToShifts({ hourlyRate: 50 } as StubParsed, mixed, mixed, [employer]);
    expect(row(rows, 'rate').calculated).toBe(0);
  });

  it('excludes off-the-clock meal time from the hours it compares', () => {
    const withMeal = [job({ id: 'a', date: '2026-09-08', hoursWorked: 9, mealDuration: 60, mealOnClock: false })];
    const rows = compareStubToShifts({ totalHours: 8 } as StubParsed, withMeal, withMeal, [employer]);
    expect(row(rows, 'hours').calculated).toBe(8);
    expect(row(rows, 'hours').status).toBe('match');
  });

  it('surfaces only the lines that disagree', () => {
    const rows = compareStubToShifts({ totalHours: 24, grossPay: 1000 } as StubParsed, jobs, jobs, [employer]);
    const bad = disagreements(rows);
    expect(bad.map(r => r.key)).toEqual(['gross']);
  });
});
