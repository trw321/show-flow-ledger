import { describe, it, expect } from 'vitest';
import { explainPay } from './payExplain';
import type { Employer, Job } from './store';

const shift = (extra: Partial<Job> = {}): Job => ({
  id: 'a', name: 'Gala', client: 'Odeum', venue: 'Hall', date: '2026-10-05', status: 'completed', hoursWorked: 8, hourlyRate: 50,
  has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);
const odeum = (terms: Partial<Employer> = {}): Employer => ({ id: 'e', name: 'Odeum', overtimeRule: 'daily', createdAt: 'x', ...terms });
// $400 gross. 5% dues is $20, 10% tax on the rest is $38, 8% vacation is $32: $374 take-home.
const terms = odeum({ unionDuesPercent: 5, estimatedTaxPercent: 10, vacationPercent: 8 });
const explain = (stub: Parameters<typeof explainPay>[0]['stub'], employer = terms, job = shift()) =>
  explainPay({ stub, jobs: [job], allJobs: [job], employers: [employer] });
const exact = { totalHours: 8, hourlyRate: 50, grossPay: 400, duesAmount: 20, taxAmount: 38, vacationAmount: 32, netPay: 374 };

describe('the estimate beside what came in', () => {
  it('shows gross and net side by side', () => {
    const e = explain({ ...exact, netPay: 350 });
    expect(e.lines[0]).toMatchObject({ label: 'Gross', estimated: 400, actual: 400 });
    expect(e.lines[1]).toMatchObject({ label: 'Net', estimated: 374, actual: 350, delta: -24 });
  });

  it('says so when it is right', () => {
    const e = explain(exact);
    expect(e.verdict).toBe('right');
    expect(e.headline).toBe('Right on the estimate.');
    expect(e.reasons).toEqual([]);
  });

  it('calls a small gap close', () => {
    const e = explain({ ...exact, duesAmount: 23, netPay: 371 });
    expect(e.verdict).toBe('close');
    expect(e.headline).toMatch(/^Close: \$3\.00 under/);
  });
});

describe('why it was off', () => {
  it('blames tax when tax took more', () => {
    const e = explain({ ...exact, taxAmount: 68, netPay: 344 });
    expect(e.verdict).toBe('off');
    expect(e.headline).toMatch(/\$30\.00 under the estimate \(8\.02%\)\. Mostly tax\./);
    expect(e.reasons[0].text).toMatch(/Tax took \$68\.00 \(17\.89%\)\. The estimate had \$38\.00\./);
    expect(e.reasons[0].effect).toBe(-30);
  });

  it('finds hours the stub paid that the shift does not have', () => {
    const e = explain({ ...exact, totalHours: 9, grossPay: 450, duesAmount: 22.5, taxAmount: 42.75, vacationAmount: 36, netPay: 420.75 });
    expect(e.reasons.some(r => r.short === 'hours' && /paid 9h and your shifts come to 8h, 1h more/.test(r.text) && r.effect === 50)).toBe(true);
  });

  it('finds a different rate', () => {
    const e = explain({ ...exact, hourlyRate: 60, grossPay: 480, duesAmount: 24, taxAmount: 45.6, vacationAmount: 38.4, netPay: 448.8 });
    expect(e.reasons.some(r => r.short === 'rate' && r.effect === 80)).toBe(true);
  });

  it('counts the broken hour and the minimum call as paid hours', () => {
    const rounds = odeum({ ...terms, roundUpToWholeHours: true });
    const e = explain({ ...exact, totalHours: 9, grossPay: undefined, netPay: 300 }, rounds, shift({ hoursWorked: 8.25 }));
    expect(e.verdict).toBe('off');
    expect(e.reasons.some(r => r.short === 'hours')).toBe(false);
    const short = explain({ ...exact, totalHours: 5, grossPay: undefined, netPay: 100 }, terms, shift({ hoursWorked: 3, minimumHours: 5 }));
    expect(short.verdict).toBe('off');
    expect(short.reasons.some(r => r.short === 'hours')).toBe(false);
  });

  it('names overtime it can see on the stub', () => {
    const e = explain({
      ...exact, grossPay: 450, duesAmount: 22.5, taxAmount: 42.75, vacationAmount: 36, netPay: 420.75,
      hoursBreakdown: [{ date: '2026-10-05', hours: 8, type: 'ST' }, { date: '2026-10-05', hours: 2, type: 'OT' }],
    });
    expect(e.reasons.find(r => r.short === 'overtime or premiums')?.text).toMatch(/The stub paid 2h overtime\./);
  });

  it('notices deductions the app has never heard of', () => {
    const e = explain({ ...exact, otherDeductions: 25, netPay: 349 });
    expect(e.reasons[0]).toMatchObject({ short: 'other deductions', effect: -25 });
  });

  it('notices a stub with no vacation on it', () => {
    const { vacationAmount: _v, ...noVacation } = exact;
    const e = explain({ ...noVacation, netPay: 342 });
    expect(e.reasons[0]).toMatchObject({ short: 'vacation', effect: -32 });
  });

  it('compares like with like when gross includes vacation', () => {
    const e = explain({ ...exact, grossPay: 432 });
    expect(e.lines[0]).toMatchObject({ estimated: 432, actual: 432 });
    expect(e.reasons.find(r => r.short === 'overtime or premiums')).toBeUndefined();
    expect(e.reasons.some(r => /includes \$32\.00 vacation/.test(r.text))).toBe(true);
  });

  it('owns up to what it cannot explain', () => {
    const e = explain({ ...exact, netPay: 340 });
    expect(e.reasons[0]).toMatchObject({ short: 'something not on the stub', effect: -34 });
  });
});

describe('with less to go on', () => {
  it('a check shows the gap but not the reason', () => {
    const job = shift();
    const e = explainPay({ received: 300, jobs: [job], allJobs: [job], employers: [terms] });
    expect(e.lines[0].actual).toBeUndefined();
    expect(e.lines[1]).toMatchObject({ estimated: 374, actual: 300 });
    expect(e.reasons[0].text).toMatch(/A check only shows what arrived/);
  });

  it('has nothing to say about a shift with no pay on it', () => {
    const job = shift({ hourlyRate: undefined });
    const e = explainPay({ received: 300, jobs: [job], allJobs: [job], employers: [terms] });
    expect(e.verdict).toBe('none');
    expect(e.headline).toMatch(/need hours and a rate/);
  });
});
