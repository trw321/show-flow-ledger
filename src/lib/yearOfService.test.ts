import { describe, it, expect } from 'vitest';
import { isLocalShift, LOCAL8_2026, trainingKey, yearEarnings } from './yearOfService';
import { EMPTY_PROFILE } from './payerProfile';
import type { Job } from './store';

const shift = (id: string, over: Partial<Job>): Job => ({
  id, name: 'Portola', client: 'ia8', venue: '', date: '2026-09-28', status: 'completed',
  hoursWorked: 4, hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x', ...over,
} as Job);

describe('Local 8 Year of Service', () => {
  it('is $30,000 of 2026 work and eleven trainings', () => {
    expect(LOCAL8_2026.earnings).toBe(30_000);
    expect(LOCAL8_2026.training.flatMap(g => g.items)).toHaveLength(11);
    expect(trainingKey(LOCAL8_2026, { key: 'osha', label: 'OSHA' })).toBe('2026:osha');
  });

  it('counts shifts Local 8 dispatched: by their local, or an employer written as the local', () => {
    expect(isLocalShift({ local: 'IATSE Local 8', client: 'Anyone' }, '8')).toBe(true);
    expect(isLocalShift({ client: 'ia8' }, '8')).toBe(true);
    expect(isLocalShift({ client: 'IATSE 8' }, '8')).toBe(true);
    expect(isLocalShift({ local: '16', client: 'ia8' }, '8')).toBe(false);
    expect(isLocalShift({ client: 'odeum' }, '8')).toBe(false);
    expect(isLocalShift({ client: 'ia80' }, '8')).toBe(false);
  });

  it('adds up the year\'s estimated gross, and only that year\'s', () => {
    const jobs = [
      shift('a', {}),
      shift('b', { date: '2026-10-02', hoursWorked: 8 }),
      shift('c', { date: '2025-12-30', hoursWorked: 8 }),
      shift('d', { client: 'odeum', hoursWorked: 8 }),
    ];
    expect(yearEarnings(LOCAL8_2026, jobs, [], EMPTY_PROFILE)).toEqual({ gross: 600, shifts: 2 });
  });
});
