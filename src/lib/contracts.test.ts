import { describe, it, expect } from 'vitest';
import { CONTRACTS, contractFor, contractInNotes, contractsWorked, shiftContract } from './contracts';
import { findLikelyDuplicate, isDuplicateJob } from './jobDedup';
import { jobPayBreakdown, dayInARow, dayMultiplierFor, calculateNightHours } from './payCalc';
import type { Employer, Job } from './store';

const local16 = CONTRACTS.find(c => c.key === 'ia16-basic')!;
const reliant = CONTRACTS.find(c => c.key === 'reliant-2026')!;
const employer = (terms: Partial<Employer>, name = 'Blackpoint'): Employer => ({ id: name, name, overtimeRule: 'daily', createdAt: 'x', ...terms });
const shift = (id: string, date: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Show', client: 'Blackpoint', venue: 'Pier', date, status: 'completed', hoursWorked: 8, hourlyRate: 60,
  has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);
const run = (n: number, extra: (i: number) => Partial<Job> = () => ({})) =>
  Array.from({ length: n }, (_, i) => shift('d' + i, `2026-10-${String(i + 1).padStart(2, '0')}`, extra(i)));

describe('Local 16', () => {
  const e = employer(local16.terms);

  it('is found from the employer', () => expect(contractFor(e)?.short).toBe('Basic Ent.'));

  it('pays 1.5× after 8 hours and 2× after 12', () => {
    const day = shift('a', '2026-10-05', { hoursWorked: 13 });
    expect(jobPayBreakdown(day, [day], [e]).gross).toBeCloseTo(8 * 60 + 4 * 90 + 1 * 120, 2);
  });

  it('breaks the hour', () => {
    const day = shift('a', '2026-10-05', { hoursWorked: 7.25 });
    expect(jobPayBreakdown(day, [day], [e]).gross).toBeCloseTo(8 * 60, 2);
  });

  it('stops the night premium at 8 AM', () => {
    expect(calculateNightHours('10:00 PM', '10:00 AM', e.nightPremiumStartHour, e.nightPremiumEndHour)).toBe(8);
  });

  it('pays the 6th day 1.5× and the 7th 2×', () => {
    const days = run(7);
    expect(dayMultiplierFor(days[4], e, days)).toBe(1);
    expect(dayMultiplierFor(days[5], e, days)).toBe(1.5);
    expect(dayMultiplierFor(days[6], e, days)).toBe(2);
    const plain = jobPayBreakdown(days[0], days, [e]).gross;
    expect(jobPayBreakdown(days[6], days, [e]).gross).toBeCloseTo(plain * 2, 2);
  });

  it('counts the days across a payroll company, whoever the employer was', () => {
    const days = run(6, i => ({ client: i % 2 ? 'Blackpoint' : 'GSW Arena', payrollCompany: 'EP' }));
    expect(dayInARow(days[5], e, days)).toBe(6);
    expect(dayInARow(days[5], undefined, days)).toBe(1);
  });
});

describe('Reliant AV', () => {
  const e = employer(reliant.terms, 'Reliant AV');

  it('pays 1.5× after 10 hours and 2× after 14, at $35', () => {
    const day = shift('a', '2026-10-05', { client: 'Reliant AV', hourlyRate: 35, hoursWorked: 15 });
    expect(jobPayBreakdown(day, [day], [e]).gross).toBeCloseTo(10 * 35 + 4 * 52.5 + 1 * 70, 2);
  });

  it('does not guess a night rate it was never given', () => expect(e.nightPremiumEnabled).toBe(false));
});

describe('an employer on no contract', () => {
  it('pays no 6th or 7th day premium, as before', () => {
    const days = run(7);
    expect(dayMultiplierFor(days[6], employer({}), days)).toBe(1);
    expect(dayMultiplierFor(days[6], undefined, days)).toBe(1);
  });

  it('keeps honouring a shift that carries the rule itself', () => {
    const days = run(7, () => ({ has6th7thDayRule: true }));
    expect(dayMultiplierFor(days[6], undefined, days)).toBe(2);
  });
});

describe('a contract belongs to the shift', () => {
  it('uses what the dispatch named', () => {
    expect(shiftContract({ contract: '2025-2027 BASIC LTE ENTRTNMENT', notes: '' })).toBe('2025-2027 BASIC LTE ENTRTNMENT');
  });

  it('finds it in the notes of a shift saved before it had a field', () => {
    expect(contractInNotes('T ELEC X | HARD TOED SHOES | 2025-2027 BASIC LTE ENTRTNMENT | NWB')).toBe('2025-2027 BASIC LTE ENTRTNMENT');
    expect(contractInNotes('T STAGEHAND, 2023-2028 BASIC ENTERTAINMENT NWB')).toBe('2023-2028 BASIC ENTERTAINMENT');
  });

  it('does not take a job number for one', () => {
    expect(contractInNotes('Job 2026-2056 LOAD OUT')).toBeUndefined();
    expect(contractInNotes('bring rain gear')).toBeUndefined();
  });

  it('lists what you have worked, busiest first, and ignores case', () => {
    const jobs = [
      shift('a', '2026-10-01', { contract: '2023-2028 BASIC ENTERTAINMENT', hourlyRate: 55 }),
      shift('b', '2026-10-02', { contract: '2023-2028 basic entertainment', hourlyRate: 60 }),
      shift('c', '2026-10-03', { contract: '2025-2027 BASIC LTE ENTRTNMENT' }),
      shift('d', '2026-10-04', { contract: 'CANCELLED ONE', status: 'cancelled' }),
      shift('e', '2026-10-05'),
    ];
    const list = contractsWorked(jobs);
    expect(list.map(c => c.shifts)).toEqual([2, 1]);
    expect(list[0]).toMatchObject({ lowestRate: 55, highestRate: 60 });
  });

  it('never ties a contract to the employer or the venue', () => {
    const a = shift('a', '2026-10-01', { contract: 'ONE' });
    const b = shift('b', '2026-10-02', { contract: 'TWO' });
    expect(shiftContract(a)).not.toBe(shiftContract(b));
    expect(a.client).toBe(b.client);
    expect(a.venue).toBe(b.venue);
    expect(CONTRACTS.find(c => c.key === 'ia16-basic')?.perEmployer).toBeFalsy();
  });

  it('keeps two calls apart when only the contract differs', () => {
    const first = { date: '2026-10-01', client: 'Blackpoint', name: 'Show', contract: 'ONE' };
    const second = { ...first, contract: 'TWO' };
    expect(isDuplicateJob(second, [first])).toBe(false);
    expect(findLikelyDuplicate(second, [first])).toBeUndefined();
    expect(findLikelyDuplicate({ ...first, contract: undefined }, [first])).toBe(first);
  });
});
