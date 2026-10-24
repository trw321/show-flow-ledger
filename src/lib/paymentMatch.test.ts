import { describe, it, expect } from 'vitest';
import { matchPaymentToProject, betterProject, projectOf, type MatchContext } from './paymentMatch';
import type { Job } from './store';

const shift = (id: string, date: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Gala', client: 'Odeum', payrollCompany: 'Entertainment Partners', jobNumber: 'G-1', venue: 'Hall', date,
  status: 'completed', hoursWorked: 8, hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);

const gala = [shift('a', '2026-10-08'), shift('b', '2026-10-09')];
const launch = [shift('c', '2026-10-01', { name: 'Launch', jobNumber: 'L-9' })];
const ctx = (jobs: Job[]): MatchContext => ({ allJobs: jobs, employers: [], paidJobIds: new Set() });

describe('how well a payment fits a project', () => {
  it('is certain when the stub names its days, the amount is right and the payer is the payroll company', () => {
    const m = matchPaymentToProject({ amount: 800, date: '2026-10-16', payer: 'Entertainment Partners', hoursOn: ['2026-10-08', '2026-10-09'] }, gala, ctx(gala));
    expect(m.level).toBe('high');
    expect(m.percent).toBe(100);
    expect(m.reasons.every(r => r.good)).toBe(true);
    expect(m.reasons[0].text).toMatch(/every day of this project/);
  });

  it('can be certain about a check, which lists no hours', () => {
    const m = matchPaymentToProject({ amount: 800, date: '2026-10-16', payer: 'Odeum' }, gala, ctx(gala));
    expect(m.level).toBe('high');
    expect(m.reasons.some(r => /employer/.test(r.text))).toBe(true);
  });

  it('says what does not fit', () => {
    const m = matchPaymentToProject({ amount: 300, date: '2026-10-16', payer: 'Somebody Else' }, gala, ctx(gala));
    expect(m.level).toBe('low');
    expect(m.reasons.filter(r => !r.good).map(r => r.text).join(' ')).toMatch(/less than the \$800\.00 expected.*not this project's employer/);
  });

  it('counts a payment dated before the work against it', () => {
    const m = matchPaymentToProject({ amount: 800, date: '2026-10-01', payer: 'Odeum' }, gala, ctx(gala));
    expect(m.reasons.some(r => !r.good && /before this project's first day/.test(r.text))).toBe(true);
  });

  it('expects only the days not already paid', () => {
    const m = matchPaymentToProject({ amount: 400, date: '2026-10-16' }, gala, { ...ctx(gala), paidJobIds: new Set(['a']) });
    expect(m.expected).toBe(400);
  });

  it('finds the shifts of a project by job number', () => {
    expect(projectOf(gala[0], [...gala, ...launch]).map(j => j.id)).toEqual(['a', 'b']);
  });
});

describe('a payment that belongs to another project', () => {
  it('points to it', () => {
    const all = [...gala, ...launch];
    const better = betterProject({ amount: 400, date: '2026-10-10', payer: 'Odeum', hoursOn: ['2026-10-01'] }, gala[0], ctx(all));
    expect(better?.project.map(j => j.id)).toEqual(['c']);
  });

  it('stays quiet when this project is the right one', () => {
    const all = [...gala, ...launch];
    expect(betterProject({ amount: 800, date: '2026-10-16', payer: 'Odeum', hoursOn: ['2026-10-08'] }, gala[0], ctx(all))).toBeNull();
  });
});
