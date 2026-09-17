import { describe, it, expect } from 'vitest';
import { buildRows } from './cloudSync';
import type { AppData } from './store';

const USER = 'user-1';

const empty: AppData = { jobs: [], expenses: [], income: [], equipment: [], employers: [], events: [] };

const rowsFor = (data: Partial<AppData>, table: string) => {
  const all = buildRows({ ...empty, ...data }, USER);
  return all.find(([t]) => t === table)![1];
};

describe('buildRows', () => {
  it('writes employers before the jobs and children that reference them', () => {
    const order = buildRows(empty, USER).map(([t]) => t);
    expect(order.indexOf('employers')).toBeLessThan(order.indexOf('jobs'));
    expect(order.indexOf('jobs')).toBeLessThan(order.indexOf('expenses'));
    expect(order.indexOf('jobs')).toBeLessThan(order.indexOf('income'));
  });

  it('stamps every row with the signed-in user, so row security accepts it', () => {
    const data: Partial<AppData> = {
      jobs: [{ id: 'j1', name: 'S', client: 'C', venue: 'V', date: '2026-09-10', status: 'completed', notes: '', createdAt: '2026-01-01' }],
      employers: [{ id: 'e1', name: 'C', overtimeRule: 'daily', createdAt: '2026-01-01' }],
      events: [{ id: 'v1', title: 'T', date: '2026-09-10', createdAt: '2026-01-01' }],
    };
    for (const [, rows] of buildRows({ ...empty, ...data }, USER)) {
      for (const r of rows) expect(r.user_id).toBe(USER);
    }
  });

  it('converts camelCase fields to their database columns', () => {
    const [row] = rowsFor({
      jobs: [{
        id: 'j1', name: 'S', client: 'C', venue: 'V', date: '2026-09-10', status: 'completed',
        notes: '', createdAt: '2026-01-01', jobNumber: '2026-2956', hourlyRate: 52.48,
        payrollCompany: 'BLACKPOINT', hoursWorked: 9, mealDuration: 60, mealOnClock: false,
        nightPremiumConfirmed: true, has6th7thDayRule: true,
      }],
    }, 'jobs');
    expect(row.job_number).toBe('2026-2956');
    expect(row.hourly_rate).toBe(52.48);
    expect(row.payroll_company).toBe('BLACKPOINT');
    expect(row.hours_worked).toBe(9);
    expect(row.meal_duration).toBe(60);
    expect(row.meal_on_clock).toBe(false);
    expect(row.night_premium_confirmed).toBe(true);
    expect(row.has_6th_7th_day_rule).toBe(true);
  });

  it('carries the phase 4 corrections and phase 5 dismissals', () => {
    const corrections = [{ field: 'gross' as const, was: 1200, now: 1150, at: '2026-09-16' }];
    const [job] = rowsFor({
      jobs: [{ id: 'j1', name: 'S', client: 'C', venue: 'V', date: '2026-09-10', status: 'completed', notes: '', createdAt: '2026-01-01', stubCorrections: corrections }],
    }, 'jobs');
    expect(job.stub_corrections).toEqual(corrections);

    const dismissed = [{ field: 'estimatedTaxPercent', skipsRemaining: 1, dismissedAt: '2026-09-16' }];
    const [emp] = rowsFor({
      employers: [{ id: 'e1', name: 'C', overtimeRule: 'daily', createdAt: '2026-01-01', dismissedSuggestions: dismissed }],
    }, 'employers');
    expect(emp.dismissed_suggestions).toEqual(dismissed);
  });

  it('sends null rather than undefined or empty string, which Postgres rejects', () => {
    const [row] = rowsFor({
      jobs: [{ id: 'j1', name: 'S', client: 'C', venue: 'V', date: '2026-09-10', status: 'upcoming', notes: '', createdAt: '2026-01-01', startTime: '', endTime: undefined }],
    }, 'jobs');
    expect(row.start_time).toBeNull();
    expect(row.end_time).toBeNull();
    expect(row.hourly_rate).toBeNull();
    expect(Object.values(row).every(v => v !== undefined)).toBe(true);
  });

  it('keeps a false or zero value instead of nulling it', () => {
    const [row] = rowsFor({
      jobs: [{ id: 'j1', name: 'S', client: 'C', venue: 'V', date: '2026-09-10', status: 'completed', notes: '', createdAt: '2026-01-01', mealOnClock: false, mealPenalties: 0, hourlyRate: 0 }],
    }, 'jobs');
    expect(row.meal_on_clock).toBe(false);
    expect(row.meal_penalties).toBe(0);
    expect(row.hourly_rate).toBe(0);
  });

  it('preserves the local id so a second backup updates rather than duplicates', () => {
    const data = { jobs: [{ id: 'stable-id', name: 'S', client: 'C', venue: 'V', date: '2026-09-10', status: 'completed' as const, notes: '', createdAt: '2026-01-01' }] };
    expect(rowsFor(data, 'jobs')[0].id).toBe('stable-id');
    expect(rowsFor(data, 'jobs')[0].id).toBe('stable-id');
  });
});
