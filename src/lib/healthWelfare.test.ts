import { describe, it, expect } from 'vitest';
import { LOCAL16_HW, local16Earnings, previousPeriod, quarterStanding, workPeriodFor } from './healthWelfare';
import { EMPTY_PROFILE } from './payerProfile';
import type { Job } from './store';

describe('Local 16 health and welfare quarters', () => {
  it('Aug to Oct earns Q1, the following Jan to Mar', () => {
    const p = workPeriodFor('2026-09-10');
    expect(p).toMatchObject({ start: '2026-08-01', end: '2026-10-31', quarter: 1, coverageYear: 2027, coverageStart: '2027-01-01', coverageEnd: '2027-03-31' });
    expect(p.workLabel).toBe('Aug–Oct 2026');
    expect(p.coverageLabel).toBe('Jan–Mar 2027');
  });

  it('Nov to Jan earns Q2, the following Apr to Jun, from either side of new year', () => {
    expect(workPeriodFor('2026-11-18')).toMatchObject({ start: '2026-11-01', end: '2027-01-31', quarter: 2, coverageYear: 2027 });
    expect(workPeriodFor('2027-01-05')).toMatchObject({ start: '2026-11-01', end: '2027-01-31', quarter: 2, coverageYear: 2027 });
    expect(workPeriodFor('2026-11-18').workLabel).toBe('Nov 2026–Jan 2027');
  });

  it('Feb to Apr earns Q3 (Jul to Sep), May to Jul earns Q4 (Oct to Dec)', () => {
    expect(workPeriodFor('2026-03-01')).toMatchObject({ start: '2026-02-01', end: '2026-04-30', quarter: 3, coverageStart: '2026-07-01', coverageEnd: '2026-09-30' });
    expect(workPeriodFor('2026-07-31')).toMatchObject({ start: '2026-05-01', end: '2026-07-31', quarter: 4, coverageStart: '2026-10-01', coverageEnd: '2026-12-31' });
  });

  it('steps back a period', () => {
    expect(previousPeriod(workPeriodFor('2026-11-18')).start).toBe('2026-08-01');
    expect(previousPeriod(workPeriodFor('2026-03-01')).start).toBe('2025-11-01');
  });

  it('works out the contributions and what self-pay makes up', () => {
    expect(quarterStanding(12_500).covered).toBe(true);
    const short = quarterStanding(10_000);
    expect(short.contributions).toBeCloseTo(1_550);
    expect(short.selfPay).toBeCloseTo(LOCAL16_HW.quarterContributions - 1_550);
  });

  it('counts Local 16 shifts only, inside the dates', () => {
    const s = (id: string, date: string, over: Partial<Job> = {}) => ({ id, name: 'x', client: 'PSS', jobNumber: '2026-4046', venue: '', date, status: 'completed', hoursWorked: 8, hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x', ...over } as Job);
    const jobs = [s('a', '2026-08-03'), s('b', '2026-10-31'), s('c', '2026-11-01'), s('d', '2026-09-01', { jobNumber: 'ROAR', client: 'odeum' })];
    expect(local16Earnings('2026-08-01', '2026-10-31', jobs, [], EMPTY_PROFILE)).toEqual({ gross: 800, shifts: 2 });
  });
});
