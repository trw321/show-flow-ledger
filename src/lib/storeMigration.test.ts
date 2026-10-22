import { localToday } from './today';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Job } from './store';

// migrateJob is not exported, so the repair is exercised through the same
// shape it runs on: whatever comes back out of storage on load.
import { __testables } from './store';

const { migrateJob } = __testables;

const dayOffset = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localToday(d);
};

const job = (over: Partial<Job>): Job => ({
  id: 'j1', name: 'Show', client: 'Acme', date: dayOffset(0),
  status: 'upcoming', notes: '', createdAt: '2026-01-01', ...over,
} as Job);

describe('repairing shifts that marked themselves done before the day', () => {
  it('puts a future shift back to upcoming', () => {
    const fixed = migrateJob(job({ date: dayOffset(7), status: 'completed', hoursWorked: 9 }));
    expect(fixed.status).toBe('upcoming');
  });

  it('marks its hours as the plan they always were', () => {
    const fixed = migrateJob(job({ date: dayOffset(7), status: 'completed', hoursWorked: 9 }));
    expect(fixed.hoursPlanned).toBe(true);
    // The hours themselves are kept — they are what you meant to work.
    expect(fixed.hoursWorked).toBe(9);
  });

  it('leaves a past shift that really was completed alone', () => {
    const fixed = migrateJob(job({ date: dayOffset(-3), status: 'completed', hoursWorked: 9 }));
    expect(fixed.status).toBe('completed');
    expect(fixed.hoursPlanned).toBeUndefined();
  });

  it('leaves today alone — the day has arrived', () => {
    const fixed = migrateJob(job({ date: dayOffset(0), status: 'completed', hoursWorked: 9 }));
    expect(fixed.status).toBe('completed');
  });

  it('does not flag a future shift that has no hours on it', () => {
    const fixed = migrateJob(job({ date: dayOffset(7), status: 'completed' }));
    expect(fixed.status).toBe('upcoming');
    expect(fixed.hoursPlanned).toBeUndefined();
  });

  it('does not override a shift already confirmed as planned or not', () => {
    const fixed = migrateJob(job({ date: dayOffset(7), status: 'completed', hoursWorked: 9, hoursPlanned: false }));
    expect(fixed.hoursPlanned).toBe(false);
  });

  it('marks a past shift with its times as worked, instead of upcoming for ever', () => {
    const fixed = migrateJob(job({ date: dayOffset(-2), status: 'upcoming', startTime: '06:00 PM', endTime: '12:15 AM' }));
    expect(fixed.status).toBe('completed');
  });

  it('leaves a past shift with no wrap time asking for its hours', () => {
    const fixed = migrateJob(job({ date: dayOffset(-2), status: 'upcoming', startTime: '08:00 AM' }));
    expect(fixed.status).toBe('upcoming');
  });

  it('leaves hours typed in ahead for you to confirm', () => {
    const fixed = migrateJob(job({ date: dayOffset(-2), status: 'upcoming', startTime: '08:00 AM', endTime: '05:00 PM', hoursWorked: 9, hoursPlanned: true }));
    expect(fixed.status).toBe('upcoming');
  });

  it('leaves today alone, even with times', () => {
    const fixed = migrateJob(job({ date: dayOffset(0), status: 'upcoming', startTime: '08:00 AM', endTime: '05:00 PM' }));
    expect(fixed.status).toBe('upcoming');
  });

  it('still converts the retired meal codes', () => {
    const fixed = migrateJob(job({ mealType: 'YWA' } as Partial<Job>));
    expect(fixed.mealDuration).toBe(60);
    expect(fixed.mealOnClock).toBe(false);
  });
});

describe('crew payments saved by the old Pay Outs page', () => {
  const { adoptStandalonePayouts } = __testables;
  const old = (id: string, worker = 'Sam') => ({
    id, workerName: worker, amount: 100, date: '2026-09-12', createdAt: '2026-01-01',
  });

  beforeEach(() => localStorage.clear());

  it('are folded into the ledger', () => {
    localStorage.setItem('av-payouts-user-1', JSON.stringify([old('o1'), old('o2', 'Alex')]));
    const adopted = adoptStandalonePayouts([]);
    expect(adopted.map(p => p.id).sort()).toEqual(['o1', 'o2']);
  });

  it('are not duplicated if the ledger already has them', () => {
    localStorage.setItem('av-payouts-user-1', JSON.stringify([old('o1')]));
    const adopted = adoptStandalonePayouts([old('o1') as never]);
    expect(adopted).toHaveLength(1);
  });

  it('are left where they were, as a way back if anything goes wrong', () => {
    localStorage.setItem('av-payouts-user-1', JSON.stringify([old('o1')]));
    adoptStandalonePayouts([]);
    expect(localStorage.getItem('av-payouts-user-1')).not.toBeNull();
  });

  it('come from every account that saved some on this device', () => {
    localStorage.setItem('av-payouts-user-1', JSON.stringify([old('o1')]));
    localStorage.setItem('av-payouts-user-2', JSON.stringify([old('o2')]));
    expect(adoptStandalonePayouts([])).toHaveLength(2);
  });

  it('leave the ledger alone when there is nothing to adopt', () => {
    const existing = [old('o9') as never];
    expect(adoptStandalonePayouts(existing)).toBe(existing);
  });

  it('survive a corrupt old entry without taking the ledger down', () => {
    localStorage.setItem('av-payouts-user-1', '{not json');
    expect(() => adoptStandalonePayouts([])).not.toThrow();
    expect(adoptStandalonePayouts([])).toEqual([]);
  });
});
