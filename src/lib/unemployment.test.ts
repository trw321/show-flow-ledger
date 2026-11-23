import { describe, it, expect } from 'vitest';
import type { Employer, Job } from './store';
import { EMPTY_PROFILE } from './payerProfile';
import { claimSummary, employersAsText, howLongText, weekEndingFor, weekRun, weeksAsText, yearsMonths } from './unemployment';

const job = (id: string, date: string, client: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'TEST ' + id, client, date, startTime: '8:00 AM', endTime: '4:00 PM', hoursWorked: 8,
  status: 'completed', hourlyRate: 50, createdAt: 'x', ...extra,
} as Job);

const summary = (jobs: Job[], from: string, through: string, employers: Employer[] = []) =>
  claimSummary(jobs, employers, EMPTY_PROFILE, from, through);

describe('the weeks of a claim', () => {
  it('names each week by its Saturday', () => {
    expect(weekEndingFor('2026-10-25')).toBe('2026-10-31'); // a Sunday
    expect(weekEndingFor('2026-10-31')).toBe('2026-10-31'); // the Saturday itself
    expect(weekEndingFor('2026-11-01')).toBe('2026-11-07');
  });

  it('ends weeks on another day when the state counts them that way', () => {
    expect(weekEndingFor('2026-10-25', 0)).toBe('2026-10-25'); // a Sunday, weeks ending Sunday
    expect(weekEndingFor('2026-10-26', 0)).toBe('2026-11-01');
    expect(weekEndingFor('2026-10-30', 5)).toBe('2026-10-30'); // a Friday
    const s = claimSummary([job('a', '2026-10-25', 'Odeum')], [], EMPTY_PROFILE, '2026-10-19', '2026-11-01', 0);
    expect(s.weeks.map(w => [w.weekEnding, w.start, w.hours])).toEqual([['2026-10-25', '2026-10-19', 8], ['2026-11-01', '2026-10-26', 0]]);
    expect(weekRun(0)).toBe('Monday to Sunday');
    expect(weekRun(6)).toBe('Sunday to Saturday');
  });

  it('lists every week in the range, the ones with no work too', () => {
    const s = summary([job('a', '2026-10-06', 'Odeum')], '2026-10-01', '2026-10-31');
    expect(s.weeks.map(w => w.weekEnding)).toEqual(['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31']);
    expect(s.weeks.map(w => w.hours)).toEqual([0, 8, 0, 0, 0]);
    expect(s.weeks[1].lines).toEqual([{ employer: 'Odeum', hours: 8, gross: 400 }]);
  });

  it('says when the range cuts a week short', () => {
    const s = summary([], '2025-07-01', '2026-09-30');
    expect(s.weeks[0]).toMatchObject({ weekEnding: '2025-07-05', start: '2025-07-01', end: '2025-07-05', partial: true });
    expect(s.weeks[s.weeks.length - 1]).toMatchObject({ weekEnding: '2026-10-03', start: '2026-09-27', end: '2026-09-30', partial: true });
    expect(s.weeks[1].partial).toBe(false);
  });

  it('splits a week by employer and adds it up', () => {
    const s = summary([job('a', '2026-10-05', 'Odeum'), job('b', '2026-10-06', 'PSS'), job('c', '2026-10-07', 'Odeum')], '2026-10-04', '2026-10-10');
    expect(s.weeks[0].lines.map(l => [l.employer, l.hours])).toEqual([['Odeum', 16], ['PSS', 8]]);
    expect(s.weeks[0].hours).toBe(24);
    expect(s.weeks[0].gross).toBe(s.weeks[0].lines.reduce((t, l) => t + l.gross, 0));
  });

  it('leaves out what was not worked, and what is not a date', () => {
    const s = summary([
      job('x', '2026-10-05', 'Odeum', { status: 'cancelled' }),
      job('p', '2026-10-06', 'Odeum', { hoursWorked: undefined, endTime: undefined, status: 'upcoming' }),
      job('bad', 'Oct 7', 'Odeum'),
      job('out', '2026-09-30', 'Odeum'),
    ], '2026-10-04', '2026-10-10');
    expect(s.hours).toBe(0);
    expect(s.employers).toEqual([]);
  });

  it('counts paid time off in the pay, not the hours', () => {
    const s = summary([job('t', '2026-10-05', 'Odeum', { pto: true })], '2026-10-04', '2026-10-10');
    expect(s.weeks[0].hours).toBe(0);
    expect(s.weeks[0].pto).toBeGreaterThan(0);
    expect(s.weeks[0].gross).toBe(s.weeks[0].pto);
    expect(s.employers[0].days).toBe(0);
  });

  it('is nothing for a range backwards or not dates', () => {
    expect(summary([job('a', '2026-10-05', 'Odeum')], '2026-10-10', '2026-10-01').weeks).toEqual([]);
    expect(summary([], 'July 1', '2026-10-01').weeks).toEqual([]);
  });
});

describe('the employers of a claim', () => {
  it('gives each one its first and last day, days, hours and pay, most recent first', () => {
    const s = summary([
      job('a', '2025-07-08', 'Odeum'), job('b', '2026-03-02', 'Odeum'), job('c', '2026-03-02', 'Odeum', { name: 'TEST evening' }),
      job('d', '2026-09-29', 'PSS'),
    ], '2025-07-01', '2026-09-30');
    expect(s.employers.map(e => [e.name, e.firstDay, e.lastDay, e.days, e.hours])).toEqual([
      ['PSS', '2026-09-29', '2026-09-29', 1, 8],
      ['Odeum', '2025-07-08', '2026-03-02', 2, 24],
    ]);
  });

  it('goes by the employer\'s own name, and says who paid', () => {
    const employers = [{ id: 'e1', name: 'Odeum Events', payrollCompany: 'Cast & Crew', overtimeRule: 'daily', createdAt: 'x' } as Employer];
    const s = summary([job('a', '2026-10-05', 'Odeum Events'), job('b', '2026-10-06', 'odeum events')], '2026-10-04', '2026-10-10', employers);
    expect(s.employers).toHaveLength(1);
    expect(s.employers[0]).toMatchObject({ name: 'Odeum Events', paidBy: 'Cast & Crew', days: 2 });
  });
});

describe('copying it out', () => {
  it('writes a line a week, and a line an employer', () => {
    const s = summary([job('a', '2026-10-05', 'Odeum')], '2026-10-01', '2026-10-10');
    const weeks = weeksAsText(s.weeks).split('\n');
    expect(weeks[0]).toBe('Week ending Sat, Oct 3, 2026 (Oct 1, 2026 to Oct 3, 2026 only): no work, 0 hours, $0.00');
    expect(weeks[1]).toBe('Week ending Sat, Oct 10, 2026: Odeum 8 hours $400.00. Total 8 hours, $400.00 gross');
    expect(employersAsText(s.employers, s.longest)).toBe('Worked for longest: Odeum\n\nOdeum: first day Oct 5, 2026, last day Oct 5, 2026 (0 years, 0 months (1 day)), 1 day worked, 8 hours, $400.00 gross');
  });
});

describe('who you worked for longest', () => {
  it('can be one employer by stretch and another by days worked', () => {
    // Odeum: two days, a year apart. PSS: five days in one week.
    const s = summary([
      job('o1', '2025-07-08', 'Odeum'), job('o2', '2026-07-08', 'Odeum'),
      ...['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'].map((d, i) => job('p' + i, d, 'PSS')),
    ], '2025-07-01', '2026-09-30');
    expect(s.longest).toEqual({ byStretch: 'Odeum', byDays: 'PSS' });
    expect(s.employers.find(e => e.name === 'Odeum')?.spanDays).toBe(366);
    expect(s.employers.find(e => e.name === 'PSS')?.spanDays).toBe(5);
    const text = employersAsText(s.employers, s.longest).split('\n');
    expect(text.slice(0, 2)).toEqual(['Worked for longest, first day to last: Odeum', 'Most days worked: PSS']);
  });

  it('breaks a tie on stretch by days worked', () => {
    const s = summary([
      job('a1', '2026-03-02', 'Odeum'), job('a2', '2026-03-09', 'Odeum'),
      job('b1', '2026-03-02', 'PSS'), job('b2', '2026-03-05', 'PSS'), job('b3', '2026-03-09', 'PSS'),
    ], '2026-03-01', '2026-03-31');
    expect(s.longest).toEqual({ byStretch: 'PSS', byDays: 'PSS' });
  });

  it('says how long in years and months', () => {
    expect(yearsMonths('2025-07-01', '2026-06-30')).toEqual({ years: 1, months: 0, days: 0 });
    expect(howLongText('2025-07-01', '2026-09-30')).toBe('1 year, 3 months');
    expect(howLongText('2026-03-02', '2026-07-01')).toBe('0 years, 4 months');
    expect(howLongText('2023-01-15', '2026-02-14')).toBe('3 years, 1 month');
    expect(howLongText('2026-03-02', '2026-03-13')).toBe('0 years, 0 months (12 days)');
  });

  it('is nobody with no work', () => {
    expect(summary([], '2026-03-01', '2026-03-31').longest).toBeUndefined();
  });
});
