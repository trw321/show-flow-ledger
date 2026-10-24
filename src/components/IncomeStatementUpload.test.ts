import { describe, it, expect } from 'vitest';
import { findLinkedJob, type ParsedIncome } from './IncomeStatementUpload';
import type { Job } from '@/lib/store';

const shift = (id: string, date: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Gala', client: 'Odeum', venue: 'Hall', date, status: 'completed',
  notes: '', createdAt: 'x', ...extra,
} as Job);

const paid = (extra: Partial<ParsedIncome> = {}): ParsedIncome => ({
  client: 'Entertainment Partners', description: 'Payroll', amount: 612.4, date: '2026-10-16', ...extra,
});

describe('which shift a payment paid, and why', () => {
  const jobs = [
    shift('early', '2026-10-01', { payrollCompany: 'Entertainment Partners' }),
    shift('late', '2026-10-09', { payrollCompany: 'Entertainment Partners' }),
  ];

  it('prefers the shift whose day the stub lists hours for', () => {
    const link = findLinkedJob(paid({ breakdown: [{ date: '2026-10-01', hours: 8, type: 'ST' }] }), jobs);
    expect(link.job?.id).toBe('early');
    expect(link.reasons[0]).toMatch(/stub lists hours on Oct 1/);
  });

  it('says why it matched', () => {
    const link = findLinkedJob(paid(), jobs);
    expect(link.job).not.toBeNull();
    expect(link.reasons.join(' ')).toMatch(/Paid by Entertainment Partners/);
    expect(link.reasons.join(' ')).toMatch(/days after the shift/);
  });

  it('never matches a shift after the payment', () => {
    const link = findLinkedJob(paid({ date: '2026-09-25' }), jobs);
    expect(link.job).toBeNull();
  });

  it('never claims a name match for a payment with no payer on it', () => {
    // An empty payer was "inside" every name, so it scored as the employer's
    // own payment — and would have said so.
    const link = findLinkedJob(paid({ client: '', description: '' }), jobs);
    expect(link.reasons.join(' ')).not.toMatch(/Paid by|Names/);
  });
});
