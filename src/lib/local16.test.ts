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
