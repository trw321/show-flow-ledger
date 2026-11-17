import { describe, it, expect } from 'vitest';
import { jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import { earlyCallHours, forcedCallFor, isEarlyCall, shiftPremiums, withContractRule } from './premiums';
import type { Employer, Job } from './store';

const shift = (id: string, over: Partial<Job> = {}): Job => ({
  id, name: 'Load in', client: 'PALACE OF FINE ARTS', venue: '', date: '2026-10-02', status: 'completed',
  notes: '', has6th7thDayRule: false, createdAt: 'x', jobNumber: '2026-3569', hourlyRate: 50,
  contract: '2023-2028 BASIC ENTERTAINMENT', ...over,
} as Job);

const withEarly = (rule: 'until8' | 'allDay' | 'none'): PayerProfile =>
  withContractRule(EMPTY_PROFILE, '2023-2028 BASIC ENTERTAINMENT', { earlyCall: rule });

const gross = (job: Job, all: Job[] = [job], payer: PayerProfile = EMPTY_PROFILE, employers: Employer[] = []) =>
  jobPayBreakdown(job, all, employers, payer).gross;

describe('an early call', () => {
  it('is a call that starts between midnight and 7 AM', () => {
    expect(isEarlyCall({ startTime: '12:00 AM', endTime: '8:00 AM' })).toBe(true);
    expect(isEarlyCall({ startTime: '6:30 AM', endTime: '2:30 PM' })).toBe(true);
    expect(isEarlyCall({ startTime: '7:00 AM', endTime: '3:00 PM' })).toBe(false);
    expect(isEarlyCall({ startTime: '11:00 PM', endTime: '4:00 AM' })).toBe(false);
  });

  it('runs its premium until 8 AM, or all day, as the contract says', () => {
    const call = { startTime: '5:00 AM', endTime: '1:00 PM' };
    expect(earlyCallHours(call, 'until8')).toBe(3);
    expect(earlyCallHours(call, 'allDay')).toBe(8);
    expect(earlyCallHours(call, 'none')).toBe(0);
    expect(earlyCallHours(call, undefined)).toBe(0);
  });

  it('pays double until 8 AM', () => {
    const job = shift('a', { startTime: '5:00 AM', endTime: '1:00 PM', hoursWorked: 8 });
    // 8h straight is $400; 5 to 8 AM lifted to 2× adds 3 × $50.
    expect(gross(job, [job], withEarly('until8'))).toBeCloseTo(550);
  });

  it('pays double all day', () => {
    const job = shift('a', { startTime: '5:00 AM', endTime: '1:00 PM', hoursWorked: 8 });
    expect(gross(job, [job], withEarly('allDay'))).toBeCloseTo(800);
  });

  it('counts nothing until the contract is answered, and nothing when it has none', () => {
    const job = shift('a', { startTime: '5:00 AM', endTime: '1:00 PM', hoursWorked: 8 });
    expect(gross(job)).toBeCloseTo(400);
    expect(gross(job, [job], withEarly('none'))).toBeCloseTo(400);
  });

  it('follows the contract, not the employer', () => {
    const other = shift('b', { startTime: '5:00 AM', endTime: '1:00 PM', hoursWorked: 8, contract: '2025-2027 BASIC LTE ENTRTNMENT' });
    expect(gross(other, [other], withEarly('allDay'))).toBeCloseTo(400);
  });
});

describe('a forced call', () => {
  const lastNight = shift('night', { date: '2026-10-01', startTime: '4:00 PM', endTime: '12:00 AM', hoursWorked: 8 });

  it('is back for the same employer with under 9 hours off', () => {
    const job = shift('a', { startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    const forced = forcedCallFor(job, [lastNight, job]);
    expect(forced).toMatchObject({ hours: 3, restHours: 6 });
    expect(forced?.after.id).toBe('night');
  });

  it('pays double time until the 9 hours off are had', () => {
    const job = shift('a', { startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    // Off at midnight, back at 6: 6 to 9 AM is double time.
    expect(gross(job, [lastNight, job])).toBeCloseTo(550);
  });

  it('is the day\'s first hours, so they still count towards overtime', () => {
    const job = shift('a', { startTime: '6:00 AM', endTime: '6:00 PM', hoursWorked: 12 });
    // 3h at 2× ($300), 5h straight ($250), 4h at 1.5× ($300).
    expect(gross(job, [lastNight, job])).toBeCloseTo(850);
  });

  it('is not owed with 9 hours off', () => {
    const job = shift('a', { startTime: '9:00 AM', endTime: '5:00 PM', hoursWorked: 8 });
    expect(forcedCallFor(job, [lastNight, job])).toBeNull();
    expect(gross(job, [lastNight, job])).toBeCloseTo(400);
  });

  it('is not owed by a different employer', () => {
    const job = shift('a', { client: 'BLACKPOINT PRODUCTION INC.', jobNumber: '2026-3943', startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    expect(forcedCallFor(job, [lastNight, job])).toBeNull();
  });

  it('is union work only, unless a contract says otherwise', () => {
    const odeum = (id: string, over: Partial<Job>) => shift(id, { client: 'odeum', jobNumber: undefined, contract: undefined, ...over });
    const before = odeum('n', { date: '2026-10-01', startTime: '4:00 PM', endTime: '12:00 AM', hoursWorked: 8 });
    const job = odeum('a', { startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    expect(shiftPremiums(job, [before, job])).toEqual([]);
    const told = withContractRule(EMPTY_PROFILE, 'odeum', { forcedCall: true });
    expect(shiftPremiums(job, [before, job], undefined, told)).toHaveLength(1);
  });

  it('can be turned off for a contract that has none', () => {
    const job = shift('a', { startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    const off = withContractRule(EMPTY_PROFILE, '2023-2028 basic entertainment', { forcedCall: false });
    expect(gross(job, [lastNight, job], off)).toBeCloseTo(400);
  });

  it('isn\'t paid twice where it meets an early call', () => {
    const before = shift('n', { date: '2026-10-01', startTime: '3:00 PM', endTime: '11:00 PM', hoursWorked: 8 });
    const job = shift('a', { startTime: '5:00 AM', endTime: '1:00 PM', hoursWorked: 8 });
    // Both run 5 to 8 AM at 2×: lifted once.
    expect(gross(job, [before, job], withEarly('until8'))).toBeCloseTo(550);
  });

  it('isn\'t the second half of a split day', () => {
    const morning = shift('m', { startTime: '8:00 AM', endTime: '12:00 PM', hoursWorked: 4 });
    const evening = shift('e', { startTime: '3:00 PM', endTime: '7:00 PM', hoursWorked: 4 });
    expect(forcedCallFor(evening, [morning, evening])).toBeNull();
  });
});

describe('times saved badly', () => {
  it('read a bare "8" to "5" as a day, not a night, so the morning after is no forced call', () => {
    const day1 = shift('d1', { date: '2026-09-14', startTime: '8', endTime: '5', hoursWorked: 8 });
    const day2 = shift('d2', { date: '2026-09-15', startTime: '07:00 AM', endTime: '05:00 PM', hoursWorked: 9.5 });
    expect(forcedCallFor(day2, [day1, day2])).toBeNull();
  });

  it('read a 24-hour "18" as 6 PM', () => {
    const day1 = shift('d1', { date: '2026-09-13', startTime: '08:00 AM', endTime: '18', hoursWorked: 10 });
    const day2 = shift('d2', { date: '2026-09-14', startTime: '8', endTime: '5', hoursWorked: 8 });
    expect(forcedCallFor(day2, [day1, day2])).toBeNull();
  });

  it('skip a call with no times at all', () => {
    const day1 = shift('d1', { date: '2026-10-01', startTime: undefined, endTime: undefined, hoursWorked: 8 });
    const day2 = shift('d2', { startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    expect(forcedCallFor(day2, [day1, day2])).toBeNull();
    expect(shiftPremiums(day1, [day1, day2])).toEqual([]);
  });
});
