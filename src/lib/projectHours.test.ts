import { describe, it, expect } from 'vitest';
import { projectHours } from './projectHours';
import { jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE } from './payerProfile';
import type { Employer, Job } from './store';

const shift = (id: string, date: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Show', client: 'Odeum', venue: 'Hall', date, status: 'completed',
  hoursWorked: 10, hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);

const odeum = (extra: Partial<Employer> = {}): Employer => ({ id: 'e', name: 'Odeum', overtimeRule: 'daily', createdAt: 'x', ...extra } as Employer);

const hoursOf = (jobs: Job[], employers = [odeum()], paidIds?: Set<string>) => projectHours(jobs, jobs, employers, EMPTY_PROFILE, paidIds);

describe('a project\'s hours', () => {
  it('splits ten-hour days into straight time and overtime', () => {
    const run = [shift('1', '2026-10-05'), shift('2', '2026-10-06'), shift('3', '2026-10-07')];
    const h = hoursOf(run);
    expect(h).toMatchObject({ worked: 30, paid: 30, straight: 24, overtime: 6, double: 0, minimum: 0, days: 3 });
  });

  it('puts a long day\'s last hours at double time', () => {
    const h = hoursOf([shift('1', '2026-10-05', { hoursWorked: 14 })]);
    expect(h).toMatchObject({ straight: 8, overtime: 4, double: 2, longest: { date: '2026-10-05', hours: 14 } });
  });

  it('says what the pay is worked out on, so the two agree', () => {
    const day = shift('1', '2026-10-05', { hoursWorked: 14 });
    const h = hoursOf([day]);
    const gross = jobPayBreakdown(day, [day], [odeum()], EMPTY_PROFILE).gross;
    expect(h.straight * 50 + h.overtime * 75 + h.double * 100).toBeCloseTo(gross, 2);
  });

  it('counts a minimum call as paid, not worked', () => {
    const h = hoursOf([shift('1', '2026-10-05', { hoursWorked: 2, minimumHours: 5 })]);
    expect(h).toMatchObject({ worked: 2, paid: 5, straight: 2, minimum: 3 });
  });

  it('takes an off-the-clock meal out of the hours worked', () => {
    const h = hoursOf([shift('1', '2026-10-05', { hoursWorked: 11, mealDuration: 60, mealOnClock: false })]);
    expect(h).toMatchObject({ worked: 10, straight: 8, overtime: 2 });
  });

  it('puts both calls of a split day on one ladder', () => {
    const h = hoursOf([shift('am', '2026-10-05', { hoursWorked: 5, startTime: '8:00 AM', endTime: '1:00 PM' }), shift('pm', '2026-10-05', { hoursWorked: 5, startTime: '6:00 PM', endTime: '11:00 PM' })]);
    expect(h.days).toBe(1);
    expect(h.straight).toBeCloseTo(8, 6);
    expect(h.overtime).toBeCloseTo(2, 6);
  });

  it('moves a weekly rule\'s hours past 40 into overtime', () => {
    const week = ['05', '06', '07', '08', '09'].map(d => shift(d, `2026-10-${d}`));
    const h = hoursOf(week, [odeum({ overtimeRule: 'weekly', weeklyOvertimeThresholdHours: 40 })]);
    expect(h).toMatchObject({ worked: 50, straight: 40, overtime: 10, double: 0 });
  });

  it('counts paid time off apart from work', () => {
    const h = hoursOf([shift('1', '2026-10-05'), shift('2', '2026-10-06', { pto: true, hoursWorked: 8 })]);
    expect(h).toMatchObject({ pto: 8, straight: 8, overtime: 2, paid: 18 });
  });

  it('splits the hours paid for from the hours still owed', () => {
    const run = [shift('1', '2026-10-05'), shift('2', '2026-10-06', { hoursWorked: 6 })];
    const h = hoursOf(run, [odeum()], new Set(['1']));
    expect(h).toMatchObject({ paidFor: 10, owed: 6 });
  });

  it('counts past days with no hours, but not days to come', () => {
    const run = [
      shift('1', '2026-10-05'),
      shift('2', '2026-10-06', { hoursWorked: undefined, status: 'upcoming' }),
      shift('3', '2099-10-07', { hoursWorked: undefined, status: 'upcoming' }),
    ];
    expect(hoursOf(run).needHours).toBe(1);
  });

  it('copes with bad stored values: a date like "Nov 5", no client, no rate', () => {
    const run = [
      shift('1', 'Nov 5'),
      shift('2', '2026-10-06', { client: undefined as unknown as string }),
      shift('3', '2026-10-07', { hourlyRate: undefined }),
    ];
    const h = hoursOf(run);
    // The no-rate shift still has hours; the unreadable date can't be placed, so it counts none.
    expect(h.worked).toBe(20);
    expect(h.days).toBe(2);
  });
});

describe('a project day saved with its end at its start', () => {
  it('has no hours, and is a day that still needs them', () => {
    const run = [shift('1', '2026-10-05'), shift('2', '2026-10-06', { hoursWorked: undefined, startTime: '04:00 PM', endTime: '04:00 PM' })];
    expect(hoursOf(run)).toMatchObject({ worked: 10, days: 1, needHours: 1 });
  });
});
