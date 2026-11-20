import { describe, it, expect } from 'vitest';
import { jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import { callMinimum, earlyCallHours, forcedCallFor, headCallIn, isEarlyCall, shiftPremiums, withContractRule } from './premiums';
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
    expect(forced).toMatchObject({ restHours: 6 });
    expect(forced?.after.id).toBe('night');
  });

  it('pays double time for the whole day, until you are done', () => {
    const job = shift('a', { startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    // Off at midnight, back at 6: every hour of the day is double.
    expect(gross(job, [lastNight, job])).toBeCloseTo(800);
    const long = shift('a', { startTime: '6:00 AM', endTime: '6:00 PM', hoursWorked: 12 });
    expect(gross(long, [lastNight, long])).toBeCloseTo(1200);
  });

  it('covers both sides of a split day', () => {
    const morning = shift('m', { startTime: '6:00 AM', endTime: '10:00 AM', hoursWorked: 4 });
    const evening = shift('e', { startTime: '2:00 PM', endTime: '6:00 PM', hoursWorked: 4 });
    const all = [lastNight, morning, evening];
    expect(gross(morning, all) + gross(evening, all)).toBeCloseTo(800);
  });

  it('starts over from when a forced day ends', () => {
    const day2 = shift('d2', { startTime: '6:00 AM', endTime: '11:00 PM', hoursWorked: 17 });
    const day3 = shift('d3', { date: '2026-10-03', startTime: '7:00 AM', endTime: '3:00 PM', hoursWorked: 8 });
    // Off at 11 PM, back at 7 AM: 8 hours off, forced again.
    const forced = forcedCallFor(day3, [lastNight, day2, day3]);
    expect(forced).toMatchObject({ restHours: 8 });
    expect(forced?.after.id).toBe('d2');
  });

  it('is not owed with 9 hours off', () => {
    const job = shift('a', { startTime: '9:00 AM', endTime: '5:00 PM', hoursWorked: 8 });
    expect(forcedCallFor(job, [lastNight, job])).toBeNull();
    expect(gross(job, [lastNight, job])).toBeCloseTo(400);
  });

  it('spans employers booked by the same local', () => {
    const job = shift('a', { client: 'BLACKPOINT PRODUCTION INC.', jobNumber: '2026-3943', startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    expect(forcedCallFor(job, [lastNight, job])).toMatchObject({ restHours: 6 });
  });

  it('is not owed by someone who didn\'t book the last call', () => {
    const job = shift('a', { client: 'odeum', jobNumber: undefined, contract: undefined, startTime: '6:00 AM', endTime: '2:00 PM', hoursWorked: 8 });
    const told = withContractRule(EMPTY_PROFILE, 'odeum', { forcedCall: true });
    expect(forcedCallFor(job, [lastNight, job])).toBeNull();
    expect(shiftPremiums(job, [lastNight, job], undefined, told)).toEqual([]);
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
    // The forced call already makes the whole day 2×: nothing on top.
    expect(gross(job, [before, job], withEarly('until8'))).toBeCloseTo(800);
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

describe('a split day\'s minimums', () => {
  const pal = (id: string, over: Partial<Job>) => shift(id, { date: '2026-10-16', contract: 'PALACE OF FINE ARTS 2025-2027', hourlyRate: 54.09, ...over });
  const front = pal('f', { startTime: '1:00 PM', endTime: '3:00 PM', hoursWorked: 2 });
  const back = pal('b', { startTime: '10:00 PM', endTime: '11:00 PM', hoursWorked: 1 });
  const day = (payer: PayerProfile = EMPTY_PROFILE, a = front, b = back) => gross(a, [a, b], payer) + gross(b, [a, b], payer);

  it('are 4 hours on the front and 4 on the back on union work, by default', () => {
    // 3 working hours, 5 of padding at straight time.
    expect(day()).toBeCloseTo(8 * 54.09);
  });

  it('follow the contract when it says otherwise', () => {
    const palace = withContractRule(EMPTY_PROFILE, 'PALACE OF FINE ARTS 2025-2027', { splitMinimumHours: 5 });
    expect(day(palace)).toBeCloseTo(10 * 54.09);
  });

  it('give way to a minimum set on the shift', () => {
    expect(day(EMPTY_PROFILE, { ...front, minimumHours: 5 }, { ...back, minimumHours: 5 })).toBeCloseTo(10 * 54.09);
  });

  it('pay padding past midnight at straight time, and working hours past midnight at double', () => {
    // Cut at 11 PM: the back side's 3 hours of padding run past midnight but
    // were never worked, so they're straight time.
    expect(day()).toBeCloseTo(8 * 54.09);
    // Working until 1 AM: the hour after midnight is double.
    const late = pal('b', { startTime: '10:00 PM', endTime: '1:00 AM', hoursWorked: 3 });
    // 5 working hours, 1 of them after midnight (+1 at straight), 3 padding.
    expect(day(EMPTY_PROFILE, front, late)).toBeCloseTo((5 + 1 + 3) * 54.09);
  });
});

describe('the live counter', () => {
  it('pays the working minutes as they go: no part hour paid whole, no minimum yet', async () => {
    const { jobPayBreakdown } = await import('./payCalc');
    const live = shift('l', { date: '2026-10-02', startTime: '1:00 PM', endTime: '4:50 PM', hoursWorked: 3 + 50 / 60, minimumHours: 5 });
    expect(jobPayBreakdown(live, [live], [], EMPTY_PROFILE, { asWorked: true }).gross).toBeCloseTo((3 + 50 / 60) * 50);
    expect(jobPayBreakdown(live, [live], [], EMPTY_PROFILE).gross).toBeCloseTo(5 * 50);
  });
});

describe('a head call', () => {
  it('is known by the position the offer names', () => {
    expect(headCallIn({ notes: 'SETUP; T ELEC HEAD; GRAND BALLROOM' })).toBe('T ELEC HEAD');
    expect(headCallIn({ notes: 'Skill: V1 HEAD VIDEO\nJob Notes: BRING ID' })).toBe('V1 HEAD VIDEO');
    expect(headCallIn({ notes: 'HEAD TO THE LOADING DOCK; T ELEC X' })).toBeUndefined();
    expect(headCallIn({ notes: 'BRING A HEADLAMP' })).toBeUndefined();
  });

  it('has an 8 hour minimum on union work, unless the shift says otherwise', () => {
    const head = shift('h', { notes: 'T ELEC HEAD; LOADING DOCK', startTime: '9:00 AM', endTime: '3:00 PM', hoursWorked: 6 });
    expect(callMinimum(head)).toBe(8);
    expect(gross(head)).toBeCloseTo(8 * 50);
    expect(callMinimum({ ...head, minimumHours: 5 })).toBe(5);
    expect(callMinimum({ ...head, jobNumber: undefined, contract: undefined, client: 'odeum' })).toBe(0);
  });

  it('is never 8 hours a side on a split', () => {
    const front = shift('f', { notes: 'T ELEC HEAD', startTime: '8:00 AM', endTime: '10:00 AM', hoursWorked: 2 });
    const back = shift('b', { notes: 'T ELEC HEAD', startTime: '6:00 PM', endTime: '8:00 PM', hoursWorked: 2 });
    expect(gross(front, [front, back]) + gross(back, [front, back])).toBeCloseTo(8 * 50);
  });
});

describe('a split day breaks the hour', () => {
  it('on each side, so 11:30 PM to 12:15 AM is an hour on its side', () => {
    const pal = (id: string, over: Partial<Job>) => shift(id, { date: '2026-10-16', contract: 'PALACE OF FINE ARTS 2025-2027', hourlyRate: 54.09, minimumHours: 5, ...over });
    const front = pal('f', { startTime: '1:00 PM', endTime: '3:00 PM', hoursWorked: 2 });
    const back = pal('b', { startTime: '11:30 PM', endTime: '12:15 AM', hoursWorked: 0.75 });
    // Front: 2 working + 3 padding. Back: 1 working (half of it after
    // midnight, at double) + 4 padding.
    const total = gross(front, [front, back]) + gross(back, [front, back]);
    expect(total).toBeCloseTo((2 + 3 + 0.5 + 0.5 * 2 + 4) * 54.09);
  });

  it('rounds each side up on its own when both run past their minimum', () => {
    const a = shift('a', { startTime: '8:00 AM', endTime: '1:15 PM', hoursWorked: 5.25, minimumHours: 4 });
    const b = shift('b', { startTime: '6:00 PM', endTime: '11:15 PM', hoursWorked: 5.25, minimumHours: 4 });
    // 6 + 6 = 12 working hours: 8 straight and 4 at time and a half.
    expect(gross(a, [a, b]) + gross(b, [a, b])).toBeCloseTo(8 * 50 + 4 * 75);
  });
});

describe('an early call saved before its end', () => {
  it('is still an early call', () => {
    expect(isEarlyCall({ startTime: '6:30 AM' })).toBe(true);
    expect(isEarlyCall({ startTime: '8:00 AM' })).toBe(false);
    expect(earlyCallHours({ startTime: '6:30 AM' }, 'until8')).toBe(0);
  });
});

describe('early-call premium hours break the hour', () => {
  const call = (over: Partial<Job> = {}) => shift('e', { startTime: '6:30 AM', endTime: '2:30 PM', hoursWorked: 8, ...over });
  const under = (rule: 'until7' | 'until8') => withContractRule(EMPTY_PROFILE, '2023-2028 BASIC ENTERTAINMENT', { earlyCall: rule });

  it('a 6:30 start with premium until 8 is two hours of it, 6:30 to 8:30', () => {
    expect(earlyCallHours(call(), 'until8', true)).toBe(2);
    // 8h straight ($400), and 2h of it lifted to double (+$100).
    expect(gross(call(), [call()], under('until8'))).toBeCloseTo(500);
  });

  it('until 7 is one hour, 6:30 to 7:30', () => {
    expect(earlyCallHours(call(), 'until7', true)).toBe(1);
    expect(gross(call(), [call()], under('until7'))).toBeCloseTo(450);
  });

  it('stays as worked where the call doesn\'t break the hour', () => {
    expect(earlyCallHours(call(), 'until8', false)).toBe(1.5);
    const odeum = call({ jobNumber: undefined, contract: undefined, client: 'odeum' });
    const told = withContractRule(EMPTY_PROFILE, 'odeum', { earlyCall: 'until8' });
    expect(gross(odeum, [odeum], told)).toBeCloseTo(475);
  });

  it('never runs past the end of a short call', () => {
    const short = call({ startTime: '6:30 AM', endTime: '7:00 AM', hoursWorked: 0.5 });
    expect(earlyCallHours(short, 'until8', true)).toBe(1);
  });
});
