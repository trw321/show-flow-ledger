import { describe, it, expect } from 'vitest';
import { breakTheHourLabel, breaksTheHour, isLocal16Shift } from './local16';
import { jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE } from './payerProfile';
import type { Job } from './store';

describe('a Local 16 shift', () => {
  it('is known by its dispatch job number, with or without the year', () => {
    expect(isLocal16Shift({ jobNumber: '2026-3569' })).toBe(true);
    expect(isLocal16Shift({ jobNumber: '2705' })).toBe(true);
  });

  it('is known by its local when that is filled in', () => {
    expect(isLocal16Shift({ local: 'ia16' })).toBe(true);
    expect(isLocal16Shift({ local: 'IATSE Local 16' })).toBe(true);
    expect(isLocal16Shift({ local: 'ia8', jobNumber: '2026-0001' })).toBe(false);
  });

  it('is not other work', () => {
    expect(isLocal16Shift({ jobNumber: 'ROAR' })).toBe(false);
    expect(isLocal16Shift({})).toBe(false);
  });

  it('always breaks the hour, even when its employer is set not to', () => {
    expect(breaksTheHour({ jobNumber: '2026-3569' }, { name: 'odeum', roundUpToWholeHours: false })).toBe(true);
    expect(breakTheHourLabel({ jobNumber: '2026-3569' })).toBe('Local 16 · breaks the hour');
  });

  it('leaves other work to its employer', () => {
    expect(breaksTheHour({ jobNumber: 'ROAR' }, { name: 'odeum', roundUpToWholeHours: false })).toBe(false);
    expect(breakTheHourLabel({}, { name: 'Acme', roundUpToWholeHours: true })).toBe('Acme · breaks the hour');
    expect(breakTheHourLabel({})).toBeNull();
  });

  it('pays 10 hours and 15 minutes as 11 with no employer saved', () => {
    const day = {
      id: 'cio', name: 'CIO SUMMIT', client: 'PRODUCTION SUPPORT SERVICES INC', venue: 'INTERCONTINENTAL',
      jobNumber: '2026-3601', date: '2026-11-13', status: 'completed', hoursWorked: 10.25, hourlyRate: 50,
      has6th7thDayRule: false, notes: '', createdAt: 'x',
    } as Job;
    // 11 paid: 8 straight, 3 at time and a half.
    expect(jobPayBreakdown(day, [day], [], EMPTY_PROFILE).gross).toBe(8 * 50 + 3 * 75);
    const notUnion = { ...day, jobNumber: undefined };
    expect(jobPayBreakdown(notUnion, [notUnion], [], EMPTY_PROFILE).gross).toBe(8 * 50 + 2.25 * 75);
  });
});

describe('6th and 7th days on Local 16', () => {
  const day = (id: string, date: string, over: Partial<Job> = {}) => ({
    id, name: 'CIO SUMMIT', client: 'PRODUCTION SUPPORT SERVICES INC', payrollCompany: 'PRODUCTION SUPPORT SERVICES INC',
    jobNumber: '2026-4046', venue: '', date, status: 'completed', hoursWorked: 8, hourlyRate: 70.4,
    has6th7thDayRule: false, notes: '', createdAt: 'x', ...over,
  } as Job);
  const run = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'].map((d, i) => day('d' + i, d));

  it('pay without any setting: the 6th 1.5× all day, the 7th 2×', async () => {
    const { dayInARow, dayMultiplierFor } = await import('./payCalc');
    expect(dayInARow(run[5], undefined, run)).toBe(6);
    expect(dayMultiplierFor(run[5], undefined, run)).toBe(1.5);
    expect(dayMultiplierFor(run[6], undefined, run)).toBe(2);
    expect(dayMultiplierFor(run[4], undefined, run)).toBe(1);
  });

  it('count across one payroll company, whoever the employer', async () => {
    const { dayInARow } = await import('./payCalc');
    const mixed = run.map((j, i) => (i === 2 ? { ...j, client: 'ANOTHER SHOW LLC' } : j));
    expect(dayInARow(mixed[5], undefined, mixed)).toBe(6);
  });

  it('leave other work to its employer', async () => {
    const { dayMultiplierFor } = await import('./payCalc');
    const odeum = run.map(j => ({ ...j, jobNumber: 'ROAR', client: 'odeum', payrollCompany: 'odeum' }));
    expect(dayMultiplierFor(odeum[5], undefined, odeum)).toBe(1);
  });
});
