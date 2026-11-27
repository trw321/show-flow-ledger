import { describe, it, expect } from 'vitest';
import { knownEmployers, knownPayrolls, payrollFor, suggestWho } from './whoSuggest';
import type { Employer, Job } from './store';

const job = (over: Partial<Job>): Job => ({
  id: Math.random().toString(36).slice(2), name: 'X', client: '', venue: '', date: '2026-09-01', status: 'completed',
  has6th7thDayRule: false, notes: '', createdAt: 'x', ...over,
} as Job);

// From the real ledger: two YBCA days in September, BGCA last week, and today's typed "ybca" saved as Unknown.
const jobs: Job[] = [
  job({ client: 'YBCA YERBA BUENA CENTER FOR THE ARTS', payrollCompany: 'YBCA YERBA BUENA CENTER FOR THE ARTS', date: '2026-09-10' }),
  job({ client: 'YBCA YERBA BUENA CENTER FOR THE ARTS', payrollCompany: 'YBCA YERBA BUENA CENTER FOR THE ARTS', date: '2026-09-11' }),
  job({ client: 'BGCA MANAGEMENT LLC', payrollCompany: 'THE TALENT FUND, LLC', date: '2026-11-25' }),
  job({ client: 'Unknown', venue: 'ybca', date: '2026-11-27' }),
  job({ client: 'FREEMAN AUDIO VISUAL SOLUTIONS INC', date: '2026-11-20', status: 'cancelled', payrollCompany: 'NOPE' }),
];
const employers = [{ id: 'e', name: 'ISLAND CREATIVE MANAGEMENT LLC', createdAt: 'x' } as Employer];

describe('who a new shift was for', () => {
  it('lists everyone worked for, newest first, with the payroll last used, and never "Unknown"', () => {
    const known = knownEmployers(jobs, employers);
    expect(known.map(k => k.name)).toEqual(['BGCA MANAGEMENT LLC', 'YBCA YERBA BUENA CENTER FOR THE ARTS', 'ISLAND CREATIVE MANAGEMENT LLC']);
    expect(known[0].payrollCompany).toBe('THE TALENT FUND, LLC');
    expect(knownPayrolls(jobs, employers)).toEqual(['THE TALENT FUND, LLC', 'YBCA YERBA BUENA CENTER FOR THE ARTS']);
  });

  it('puts "ybca" under YBCA YERBA BUENA CENTER FOR THE ARTS, paid by itself', () => {
    const s = suggestWho([undefined, undefined, 'ybca'], 'i worked for ybca today from 9a-10a', jobs, employers);
    expect(s?.client).toBe('YBCA YERBA BUENA CENTER FOR THE ARTS');
    expect(s?.payrollCompany).toBe('YBCA YERBA BUENA CENTER FOR THE ARTS');
    expect(s?.lastDate).toBe('2026-09-11');
  });

  it('finds the employer from its payroll company', () => {
    const s = suggestWho(['talent fund'], undefined, jobs, employers);
    expect(s?.client).toBe('BGCA MANAGEMENT LLC');
    expect(s?.payrollCompany).toBe('THE TALENT FUND, LLC');
  });

  it('falls back to the words typed when no field names anyone', () => {
    expect(suggestWho([], 'worked for island creative 8 to 5', jobs, employers)?.client).toBe('ISLAND CREATIVE MANAGEMENT LLC');
  });

  it('offers nobody for a name it has never seen, or one it could not read', () => {
    expect(suggestWho(['Moscone'], 'load in at moscone', jobs, employers)).toBeNull();
    expect(suggestWho(['Unknown', ''], undefined, jobs, employers)).toBeNull();
    expect(suggestWho(['ybca'], undefined, [], [])).toBeNull();
  });

  it('knows the payroll an employer goes with, whatever the capitals', () => {
    expect(payrollFor('bgca management llc', jobs, employers)).toBe('THE TALENT FUND, LLC');
    expect(payrollFor('Somebody New', jobs, employers)).toBeUndefined();
  });
});
