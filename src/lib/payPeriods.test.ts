import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { coveredPeriods, paidShiftIds, payPeriodOf, periodPayments, periodRule, projectPeriods } from './payPeriods';
import type { Employer, Income, Job } from './store';

const employer = (over: Partial<Employer> = {}): Employer => ({ id: 'e', name: 'Odeum', overtimeRule: 'daily', createdAt: 'x', ...over });
const shift = (id: string, date: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Gala', client: 'Odeum', venue: 'Hall', date, status: 'completed', hoursWorked: 8, hourlyRate: 50,
  jobNumber: 'G-1', has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);
const paid = (jobId: string, amount: number, date: string): Income => ({ id: 'i' + jobId + amount, jobId, client: 'Odeum', description: 'Check', amount, date, status: 'paid', createdAt: 'x' });

// Hours only count on days that have happened.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-01T12:00:00')); });
afterAll(() => { vi.useRealTimers(); });

describe('where a pay period falls', () => {
  it('repeats weekly from the day given', () => {
    const rule = periodRule(employer({ paySchedule: 'weekly', payPeriodStart: '2026-11-02' }), [])!;
    expect(payPeriodOf('2026-11-08', rule)).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(payPeriodOf('2026-11-09', rule)).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(payPeriodOf('2026-10-30', rule)).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });

  it('repeats every two weeks for bi-weekly', () => {
    const rule = periodRule(employer({ paySchedule: 'bi-weekly', payPeriodStart: '2026-11-01' }), [])!;
    expect(payPeriodOf('2026-11-14', rule).end).toBe('2026-11-14');
    expect(payPeriodOf('2026-11-15', rule).start).toBe('2026-11-15');
  });

  it('splits semi-monthly at the 15th and monthly at the end of the month', () => {
    expect(payPeriodOf('2026-11-15', periodRule(employer({ paySchedule: 'semi-monthly' }), [])!).end).toBe('2026-11-15');
    expect(payPeriodOf('2026-11-16', periodRule(employer({ paySchedule: 'semi-monthly' }), [])!)).toEqual({ start: '2026-11-16', end: '2026-11-30' });
    expect(payPeriodOf('2026-02-10', periodRule(employer({ paySchedule: 'monthly' }), [])!)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('learns the start from a stub when nobody set one', () => {
    const job = shift('a', '2026-10-05', { stubParsed: { payPeriodStart: '2026-10-05' } });
    const rule = periodRule(employer({ paySchedule: 'bi-weekly' }), [job])!;
    expect(rule).toMatchObject({ anchor: '2026-10-05', assumed: false });
  });

  it('takes a week as Sunday to Saturday when it has to, and says it did', () => {
    const rule = periodRule(employer({ paySchedule: 'weekly' }), [])!;
    expect(rule.assumed).toBe(true);
    expect(payPeriodOf('2026-11-07', rule)).toEqual({ start: '2026-11-01', end: '2026-11-07' });
  });

  it('treats a date it cannot read as no date, and never throws', () => {
    const stub = (payPeriodStart: string) => [shift('a', '2026-11-02', { stubParsed: { employer: 'Odeum', payPeriodStart } as Job['stubParsed'] })];
    const weekly = employer({ paySchedule: 'weekly' });
    for (const bad of ['10/25/2026', 'Oct 25, 2026', 'soon', '2026-13-45']) {
      expect(periodRule(weekly, stub(bad))).toMatchObject({ anchor: '2026-01-04', assumed: true });
      expect(periodRule(employer({ paySchedule: 'bi-weekly' }), stub(bad))).toBeNull();
      expect(periodRule(employer({ paySchedule: 'weekly', payPeriodStart: bad }), [])).toMatchObject({ assumed: true });
    }
    expect(projectPeriods([shift('a', 'someday')], weekly, []).periods).toEqual([]);
  });

  it('will not guess a bi-weekly start, or an unknown schedule', () => {
    expect(periodRule(employer({ paySchedule: 'bi-weekly' }), [])).toBeNull();
    expect(periodRule(employer(), [])).toBeNull();
    expect(periodRule(undefined, [])).toBeNull();
  });
});

describe('a project across pay periods', () => {
  const e = employer({ paySchedule: 'weekly', payPeriodStart: '2026-11-01' });
  const run = [shift('a', '2026-11-06'), shift('b', '2026-11-07'), shift('c', '2026-11-08'), shift('d', '2026-11-09')];

  it('is cut at the edge', () => {
    const { periods } = projectPeriods(run, e, run);
    expect(periods.map(p => p.jobs.map(j => j.id))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('stays whole inside one period', () => {
    expect(projectPeriods(run.slice(0, 2), e, run).periods).toHaveLength(1);
  });

  it('leaves out a cancelled day', () => {
    const list = [...run.slice(0, 2), shift('c', '2026-11-08', { status: 'cancelled' })];
    expect(projectPeriods(list, e, list).periods).toHaveLength(1);
  });

  it('says when it cannot tell', () => {
    expect(projectPeriods(run, employer(), run)).toMatchObject({ known: false, periods: [] });
  });
});

describe('what a payment pays', () => {
  const e = employer({ paySchedule: 'weekly', payPeriodStart: '2026-11-01' });
  const run = [shift('a', '2026-11-06'), shift('b', '2026-11-07'), shift('c', '2026-11-08'), shift('d', '2026-11-09')];
  // 8h at $50.
  const day = 400;

  it('pays only its own period when it is one period\'s check', () => {
    const ids = paidShiftIds(run, [paid('a', day * 2, '2026-11-13')], [e]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('pays the next period with the next check', () => {
    const ids = paidShiftIds(run, [paid('a', day * 2, '2026-11-13'), paid('a', day * 2, '2026-11-20')], [e]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('pays the period of the shift it was put on', () => {
    const ids = paidShiftIds(run, [paid('c', day * 2, '2026-11-20')], [e]);
    expect([...ids].sort()).toEqual(['c', 'd']);
  });

  it('pays everything when one check covers everything', () => {
    const ids = paidShiftIds(run, [paid('a', day * 4, '2026-11-20')], [e]);
    expect(ids.size).toBe(4);
  });

  it('counts a payment entered twice once', () => {
    const covered = coveredPeriods(
      projectPeriods(run, e, run).periods,
      [paid('a', 800, '2026-11-13'), { ...paid('a', 800, '2026-11-13'), id: 'again' }],
      () => day * 2,
    );
    expect(covered.size).toBe(1);
  });

  it('keeps two checks apart when they are the same amount on the same day', () => {
    const ids = paidShiftIds(run, [paid('a', 800, '2026-11-20'), paid('c', 800, '2026-11-20')], [e]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('says which check paid which period, and keeps a top-up on its own shift', () => {
    const { periods } = projectPeriods(run, e, run);
    const one = paid('a', 800, '2026-11-13');
    const two = paid('c', 800, '2026-11-20');
    const topUp = paid('a', 20, '2026-11-25');
    const by = periodPayments(periods, [one, two, topUp], () => 800);
    expect(by.get(0)).toEqual([one, topUp]);
    expect(by.get(1)).toEqual([two]);
  });

  it('counts a payment dated before the work rather than losing it', () => {
    const { periods } = projectPeriods(run, e, run);
    const early = paid('c', 1600, '2026-11-01');
    expect(periodPayments(periods, [early], () => 800).get(1)).toEqual([early]);
  });

  it('keeps the old rule inside one period: the whole project, up to the day it came', () => {
    const quiet = employer();
    const ids = paidShiftIds(run, [paid('a', 500, '2026-11-08')], [quiet]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores money that has not arrived', () => {
    expect(paidShiftIds(run, [{ ...paid('a', 800, '2026-11-13'), status: 'pending' }], [e]).size).toBe(0);
  });
});
