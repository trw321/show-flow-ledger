import { describe, it, expect } from 'vitest';
import { matchStubToShifts, type StubParsed } from './stubMatching';
import type { Job } from './store';

const job = (over: Partial<Job> & { id: string; date: string }): Job => ({
  name: 'Show',
  client: 'GSW Arena LLC',
  venue: 'Chase Center',
  status: 'completed',
  notes: '',
  createdAt: '2026-01-01',
  hourlyRate: 52.75,
  ...over,
});

const stub = (over: Partial<StubParsed> = {}): StubParsed => ({
  employer: 'GSW ARENA LLC',
  payPeriodStart: '2026-08-25',
  payPeriodEnd: '2026-08-31',
  totalHours: 24,
  ...over,
});

describe('matchStubToShifts', () => {
  it('matches a whole pay period, not just one shift', () => {
    const jobs = [
      job({ id: 'a', date: '2026-08-26', hoursWorked: 8 }),
      job({ id: 'b', date: '2026-08-27', hoursWorked: 8 }),
      job({ id: 'c', date: '2026-08-28', hoursWorked: 8 }),
      job({ id: 'outside', date: '2026-09-04', hoursWorked: 8 }),
    ];
    const m = matchStubToShifts(stub(), jobs)!;
    expect(m.jobs.map(j => j.id)).toEqual(['a', 'b', 'c']);
    expect(m.shiftHours).toBe(24);
    expect(m.confidence).toBe('high');
  });

  it('is high confidence only when employer, dates and hours all agree', () => {
    const jobs = [job({ id: 'a', date: '2026-08-26', hoursWorked: 24 })];
    expect(matchStubToShifts(stub(), jobs)!.confidence).toBe('high');
  });

  it('drops to medium when hours are close but not exact', () => {
    const jobs = [job({ id: 'a', date: '2026-08-26', hoursWorked: 23.5 })];
    const m = matchStubToShifts(stub(), jobs)!;
    expect(m.confidence).toBe('medium');
    expect(m.hoursDelta).toBe(-0.5);
  });

  it('drops to low when hours are well off', () => {
    const jobs = [job({ id: 'a', date: '2026-08-26', hoursWorked: 16 })];
    const m = matchStubToShifts(stub(), jobs)!;
    expect(m.confidence).toBe('low');
    expect(m.hoursDelta).toBe(-8);
  });

  it('tolerates employer spelling but not a different employer', () => {
    const jobs = [job({ id: 'a', date: '2026-08-26', client: 'GSW Arena, LLC.', hoursWorked: 24 })];
    expect(matchStubToShifts(stub(), jobs)!.confidence).toBe('high');

    const other = [job({ id: 'b', date: '2026-08-26', client: 'Moscone Center Events', hoursWorked: 24 })];
    expect(matchStubToShifts(stub(), other)).toBeNull();
  });

  it('matches on payrollCompany when the client name differs', () => {
    const jobs = [job({ id: 'a', date: '2026-08-26', client: 'Warriors Game', payrollCompany: 'GSW Arena LLC', hoursWorked: 24 })];
    expect(matchStubToShifts(stub(), jobs)!.confidence).toBe('high');
  });

  it('uses per-date rows and flags dates with no logged shift', () => {
    const s = stub({
      totalHours: 24,
      hoursBreakdown: [
        { date: '2026-08-26', hours: 8, type: 'ST' },
        { date: '2026-08-27', hours: 8, type: 'ST' },
        { date: '2026-08-28', hours: 8, type: 'ST' },
      ],
    });
    const jobs = [
      job({ id: 'a', date: '2026-08-26', hoursWorked: 8 }),
      job({ id: 'b', date: '2026-08-27', hoursWorked: 16 }),
    ];
    const m = matchStubToShifts(s, jobs)!;
    expect(m.confidence).not.toBe('high');
    expect(m.reasons.some(r => r.includes('no logged shift'))).toBe(true);
  });

  it('excludes off-the-clock meal time, since that is not paid', () => {
    const jobs = [job({ id: 'a', date: '2026-08-26', hoursWorked: 25, mealDuration: 60, mealOnClock: false })];
    const m = matchStubToShifts(stub(), jobs)!;
    expect(m.shiftHours).toBe(24);
    expect(m.confidence).toBe('high');
  });

  it('returns null when nothing falls in the period', () => {
    const jobs = [job({ id: 'a', date: '2026-07-04', hoursWorked: 8 })];
    expect(matchStubToShifts(stub(), jobs)).toBeNull();
  });

  it('ignores shifts with no hours logged yet', () => {
    const jobs = [job({ id: 'a', date: '2026-08-26', status: 'upcoming' })];
    expect(matchStubToShifts(stub(), jobs)).toBeNull();
  });

  it('will not guess from hours alone when the stub has no period or dates', () => {
    const s = stub({ payPeriodStart: undefined, payPeriodEnd: undefined });
    const jobs = [job({ id: 'a', date: '2026-08-26', hoursWorked: 24 })];
    expect(matchStubToShifts(s, jobs)).toBeNull();
  });

  it('caps at medium when the stub states no total hours', () => {
    const s = stub({ totalHours: undefined });
    const jobs = [job({ id: 'a', date: '2026-08-26', hoursWorked: 24 })];
    expect(matchStubToShifts(s, jobs)!.confidence).toBe('medium');
  });
});
