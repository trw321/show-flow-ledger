import { describe, it, expect } from 'vitest';
import { matchPaymentToProject, betterProject, bestProjectFor, projectOf, settleReadYear, payPeriodIn, rankedProjectsFor, type MatchContext } from './paymentMatch';
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

describe('a payment with no shift', () => {
  it('finds a project worked up to 45 days before it', () => {
    const best = bestProjectFor({ amount: 800, date: '2026-11-20', payer: 'Odeum' }, ctx(gala));
    expect(best?.project.map(j => j.id)).toEqual(['a', 'b']);
  });

  it('looks no further back than that', () => {
    expect(bestProjectFor({ amount: 800, date: '2026-11-25', payer: 'Odeum' }, ctx(gala))).toBeNull();
  });

  it('finds a long run by its last days, however long ago it started', () => {
    const run = [shift('r1', '2026-09-01', { jobNumber: 'R-1' }), shift('r2', '2026-10-20', { jobNumber: 'R-1' })];
    const best = bestProjectFor({ amount: 800, date: '2026-11-05', payer: 'Odeum' }, ctx(run));
    expect(best?.project.map(j => j.id)).toEqual(['r1', 'r2']);
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

describe('a payment year the photo reader got wrong', () => {
  const shift = (date: string) => ({
    id: date, name: 'THE RUSH TRIBUTE PROJECT', client: 'PALACE OF FINE ARTS', venue: 'Palace of Fine Arts',
    date, status: 'completed', hoursWorked: 5, hourlyRate: 54.09, has6th7thDayRule: false, notes: '', createdAt: 'x',
  } as Job);
  const jobs = [shift('2026-10-16')];

  it('moves a check read as 2023 to 2026 when that is when the work was', () => {
    expect(settleReadYear('2023-10-23', jobs, '2026-11-15')).toEqual({ date: '2026-10-23', readAs: '2023-10-23' });
  });

  it('leaves a date that already fits the shifts alone', () => {
    expect(settleReadYear('2026-10-23', jobs, '2026-11-15')).toEqual({ date: '2026-10-23' });
  });

  it('leaves an old date alone when no shift fits either way', () => {
    expect(settleReadYear('2023-03-02', jobs, '2026-11-15')).toEqual({ date: '2023-03-02' });
  });

  it('never moves a date into the future', () => {
    expect(settleReadYear('2023-12-20', [shift('2025-12-15')], '2026-11-15')).toEqual({ date: '2025-12-20', readAs: '2023-12-20' });
  });
});

describe('a stub that prints its pay period', () => {
  // The real week: an Odeum stub for 10/26–11/01, paid Nov 6, $822.25.
  const odeum = { id: 'o', name: 'odeum', overtimeRule: 'weekly', weeklyOvertimeThresholdHours: 40, createdAt: 'x' } as never;
  const roar = (date: string) => shift(`roar-${date}`, date, { name: 'roar', client: 'odeum', payrollCompany: undefined, jobNumber: undefined, hoursWorked: 11, hourlyRate: 37 });
  const phl = (date: string) => shift(`phl-${date}`, date, { name: 'PHL Crew Lead - Electrician', client: 'Odeum', payrollCompany: undefined, jobNumber: 'ROAR', hoursWorked: 11, hourlyRate: 37 });
  const jobs = [phl('2026-10-19'), roar('2026-10-20'), roar('2026-10-21'), phl('2026-10-23'), roar('2026-10-26'), roar('2026-10-27')];
  const ctx: MatchContext = { allJobs: jobs, employers: [odeum], paidJobIds: new Set(['roar-2026-10-20', 'roar-2026-10-21', 'phl-2026-10-19', 'phl-2026-10-23']) };
  const payment = { amount: 822.25, date: '2026-11-06', payer: 'Odeum Labor Services 2 LLC', period: { start: '2026-10-26', end: '2026-11-01' } };

  it('reads the period out of the description', () => {
    expect(payPeriodIn('Pay stub for the period 10/26/2026 to 11/01/2026')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(payPeriodIn('period 10/26/26 - 11/1/26')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
    expect(payPeriodIn('Payroll check')).toBeUndefined();
  });

  it('picks the project worked inside the period, checked against just those days', () => {
    const [best] = rankedProjectsFor(payment, ctx);
    const inside = best.match.shifts.filter(s => s.inPeriod).map(s => s.job.date);
    expect(inside).toEqual(['2026-10-26', '2026-10-27']);
    expect(best.match.expected).toBeCloseTo(2 * 11 * 37, 2);
    expect(best.match.level).toBe('high');
  });

  it('shows the score kind by kind', () => {
    const [best] = rankedProjectsFor(payment, ctx);
    const period = best.match.parts.find(p => p.label === 'Pay period');
    expect(period).toMatchObject({ points: 40, of: 40 });
    expect(best.match.parts.map(p => p.label)).toEqual(['Pay period', 'Amount', 'Payer', 'Timing']);
    expect(best.match.parts.reduce((n, p) => n + p.of, 0)).toBe(100);
  });

  it('ranks the other project below it, with no day in the period', () => {
    const ranked = rankedProjectsFor(payment, ctx);
    const other = ranked.find(r => r.project.some(j => j.name.startsWith('PHL')));
    expect(other!.match.percent).toBeLessThan(ranked[0].match.percent);
    expect(other!.match.parts[0]).toMatchObject({ label: 'Pay period', points: 0 });
  });
});
