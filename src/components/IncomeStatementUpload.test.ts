import { describe, it, expect } from 'vitest';
import { findLinkedJob, looksLikeStubOnly, type ParsedIncome } from './IncomeStatementUpload';
import type { MatchContext } from '@/lib/paymentMatch';
import type { Job } from '@/lib/store';

const shift = (id: string, date: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Gala', client: 'Odeum', payrollCompany: 'Entertainment Partners', jobNumber: 'G-1', venue: 'Hall', date,
  status: 'completed', hoursWorked: 8, hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);

const paid = (extra: Partial<ParsedIncome> = {}): ParsedIncome => ({
  client: 'Entertainment Partners', description: 'Payroll', amount: 400, date: '2026-10-16', ...extra,
});

const ctx = (jobs: Job[], paidIds: string[] = []): MatchContext => ({ allJobs: jobs, employers: [], paidJobIds: new Set(paidIds) });

describe('which shift a payment read off a photo paid, and why', () => {
  const jobs = [
    shift('early', '2026-10-01', { name: 'Launch', jobNumber: 'L-9' }),
    shift('late', '2026-10-09'),
  ];

  it('goes with the project whose days the stub lists hours for', () => {
    const link = findLinkedJob(paid({ breakdown: [{ date: '2026-10-01', hours: 8, type: 'ST' }] }), ctx(jobs));
    expect(link.job?.id).toBe('early');
    expect(link.reasons[0]).toMatchObject({ good: true });
    expect(link.reasons[0].text).toMatch(/stub lists hours on Oct 1/);
  });

  it('gives the score and every reason, for and against', () => {
    const link = findLinkedJob(paid({ amount: 250 }), ctx(jobs));
    expect(link.match?.percent).toBeGreaterThan(0);
    expect(link.reasons.some(r => r.good && /Paid by Entertainment Partners/.test(r.text))).toBe(true);
    expect(link.reasons.some(r => !r.good && /less than/.test(r.text))).toBe(true);
  });

  it('links a run to its first day still owed', () => {
    const run = [shift('d1', '2026-10-06'), shift('d2', '2026-10-07'), shift('d3', '2026-10-08')];
    const link = findLinkedJob(paid({ amount: 800 }), ctx(run, ['d1']));
    expect(link.job?.id).toBe('d2');
  });

  it('finds a check that came six weeks later', () => {
    const link = findLinkedJob(paid({ date: '2026-11-15' }), ctx([shift('late', '2026-10-09')]));
    expect(link.job?.id).toBe('late');
  });

  it('never claims a name match for a payment with no payer on it', () => {
    const link = findLinkedJob(paid({ client: '', description: '' }), ctx(jobs));
    expect(link.reasons.map(r => r.text).join(' ')).not.toMatch(/Paid by/);
  });

  it('matches nothing when nothing fits', () => {
    expect(findLinkedJob(paid({ client: 'Someone Else', amount: 5000, date: '2026-12-30' }), ctx(jobs)).job).toBeNull();
  });
});

describe('a stub is not the money', () => {
  it('reads a stub on its own as coming, not in', () => {
    expect(looksLikeStubOnly({ client: 'EP', description: 'Pay stub — Odeum', amount: 812, date: '2026-10-30' })).toBe(true);
    expect(looksLikeStubOnly({ client: 'EP', description: 'Earnings statement', amount: 812, date: '2026-10-30' })).toBe(true);
  });

  it('reads a stub with its check, or a deposit, as money in', () => {
    expect(looksLikeStubOnly({ client: 'EP', description: 'Pay stub and check', amount: 812, date: '2026-10-30' })).toBe(false);
    expect(looksLikeStubOnly({ client: 'EP', description: 'Direct deposit', amount: 812, date: '2026-10-30' })).toBe(false);
  });
});
