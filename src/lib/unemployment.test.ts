import { describe, it, expect } from 'vitest';
import type { Employer, Job } from './store';
import { EMPTY_PROFILE } from './payerProfile';
import { claimSummary, cleanClaimEmployers, cleanStubs, employersAsText, howLongText, isUnclearEmployer, readAmount, sameStub, sortEmployers, sortWeeks, stubDays, stubShifts, suggestEmployer, weekEndingFor, weekRun, weeksAsText, yearsMonths, type ClaimStub } from './unemployment';

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
    expect(weeks[0]).toBe('Week ending Sat, Oct 3, 2026 (Oct 1, 2026 to Oct 3, 2026 only): no work, 0 days, 0 hours, $0.00');
    expect(weeks[1]).toBe('Week ending Sat, Oct 10, 2026: Odeum 8 hours $400.00. Total 1 day, 8 hours, $400.00 gross');
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

describe('putting the lists in order', () => {
  const s = summary([
    job('a', '2026-03-02', 'Odeum'), job('b', '2026-03-03', 'Odeum'), job('c', '2026-03-03', 'Odeum', { name: 'TEST evening' }),
    job('d', '2026-03-10', 'PSS'),
    job('e', '2026-03-16', 'Clair'), job('f', '2026-03-17', 'Clair'), job('g', '2026-03-18', 'Clair'),
  ], '2026-03-01', '2026-03-28');

  it('counts the days worked in each week, not the shifts', () => {
    expect(s.weeks.map(w => [w.weekEnding, w.days])).toEqual([['2026-03-07', 2], ['2026-03-14', 1], ['2026-03-21', 3], ['2026-03-28', 0]]);
  });

  it('orders the weeks by time either way, and by hours either way', () => {
    const order = (sort: Parameters<typeof sortWeeks>[1]) => sortWeeks(s.weeks, sort).map(w => w.weekEnding.slice(5));
    expect(order('recent')).toEqual(['03-28', '03-21', '03-14', '03-07']);
    expect(order('oldest')).toEqual(['03-07', '03-14', '03-21', '03-28']);
    // 0, 8, then two 24-hour weeks, the later first.
    expect(order('fewHours')).toEqual(['03-28', '03-14', '03-21', '03-07']);
    expect(order('mostHours')).toEqual(['03-21', '03-07', '03-14', '03-28']);
  });

  it('orders the employers the same ways', () => {
    const order = (sort: Parameters<typeof sortEmployers>[1]) => sortEmployers(s.employers, sort).map(e => e.name);
    expect(order('recent')).toEqual(['Clair', 'PSS', 'Odeum']);
    expect(order('oldest')).toEqual(['Odeum', 'PSS', 'Clair']);
    expect(order('fewHours')).toEqual(['PSS', 'Clair', 'Odeum']);
    expect(order('mostHours')).toEqual(['Clair', 'Odeum', 'PSS']);
  });
});

describe('pay stubs on a claim', () => {
  const stub = (id: string, employer: string, start: string, end: string, hours: number, gross: number): ClaimStub =>
    ({ id, employer, start, end, hours, gross, createdAt: 'x' });

  it('counts a stub where the calendar has nothing, spread evenly over its pay period', () => {
    // A two-week stub, Sunday Mar 1 to Saturday Mar 14: half in each week.
    const s = claimSummary([], [], EMPTY_PROFILE, '2026-03-01', '2026-03-14', 6, [stub('s1', 'Odeum', '2026-03-01', '2026-03-14', 80, 4000)]);
    expect(s.weeks.map(w => [w.weekEnding, w.hours, w.gross, w.fromStub])).toEqual([['2026-03-07', 40, 2000, true], ['2026-03-14', 40, 2000, true]]);
    expect(s.weeks[0].lines).toEqual([{ employer: 'Odeum', hours: 40, gross: 2000, fromStub: true }]);
    expect(s.employers[0]).toMatchObject({ name: 'Odeum', firstDay: '2026-03-01', lastDay: '2026-03-14', days: 0, hours: 80, gross: 4000, fromStub: true });
    expect(s.stubs).toEqual([{ stub: expect.objectContaining({ id: 's1' }), status: 'counted', used: true, shifts: 0, estimate: 0 }]);
    expect(weeksAsText(s.weeks)[0]).toBeDefined();
    expect(weeksAsText(s.weeks).split('\n')[0]).toBe('Week ending Sat, Mar 7, 2026: Odeum (from pay stub) 40 hours $2,000.00. Total 40 hours, $2,000.00 gross');
  });

  it('leaves the calendar\'s shifts as they are, the stub beside them, unless asked', () => {
    const s = claimSummary([job('a', '2026-03-03', 'Odeum')], [], EMPTY_PROFILE, '2026-03-01', '2026-03-14', 6, [stub('s1', 'Odeum', '2026-03-01', '2026-03-14', 80, 4000)]);
    expect(s.gross).toBe(400);
    // What the stub says is shown beside it, not counted.
    expect(s.weeks[0].lines).toEqual([{ employer: 'Odeum', hours: 8, gross: 400, stubSays: 4000 }]);
    expect(s.employers[0]).toMatchObject({ gross: 400, stubSays: { gross: 4000, hours: 80, estimate: 400, stubs: 1 } });
    expect(s.stubs[0]).toMatchObject({ status: 'calendar', used: false, shifts: 1, estimate: 400 });
  });

  it('shows what a stub says week by week, by its shifts, under their employer', () => {
    const s = claimSummary([job('a', '2026-03-03', 'BLACKPOINT PRODUCTION INC.'), job('b', '2026-03-10', 'BLACKPOINT PRODUCTION INC.', { hoursWorked: 24 })], [], EMPTY_PROFILE, '2026-03-01', '2026-03-14', 6,
      [stub('s1', 'Blackpoint', '2026-03-01', '2026-03-14', 30, 1200)]);
    // Counted as estimated; the stub shared over the weeks as its shifts are.
    expect(s.gross).toBe(s.weeks[0].lines[0].gross + s.weeks[1].lines[0].gross);
    const [w1, w2] = s.weeks.map(w => w.lines[0]);
    expect(w1.employer).toBe('BLACKPOINT PRODUCTION INC.');
    expect(w1.stubSays! + w2.stubSays!).toBeCloseTo(1200, 2);
    expect(w2.stubSays!).toBeGreaterThan(w1.stubSays!);
    expect(s.employers).toHaveLength(1);
    expect(s.employers[0].stubSays).toMatchObject({ gross: 1200, hours: 30, stubs: 1 });
  });

  it("puts a stub under the calendar's employer however it was typed", () => {
    const s = claimSummary([job('a', '2026-03-03', 'ISLAND CREATIVE MANAGEMENT LLC')], [], EMPTY_PROFILE, '2026-03-01', '2026-03-28', 6,
      [stub('s1', 'Island Creative', '2026-03-15', '2026-03-21', 10, 700), stub('s2', 'RockForce Operations LLC', '2026-03-22', '2026-03-28', 1, 45)]);
    expect(s.employers.map(e => e.name)).toEqual(['RockForce Operations LLC', 'ISLAND CREATIVE MANAGEMENT LLC']);
    expect(s.employers[1]).toMatchObject({ gross: 1100, hours: 18, fromStub: true });
    expect(s.weeks[2].lines).toEqual([{ employer: 'ISLAND CREATIVE MANAGEMENT LLC', hours: 10, gross: 700, fromStub: true }]);
  });

  it("says nothing beside the line once the stub's pay is used", () => {
    const s = claimSummary([job('a', '2026-03-03', 'Odeum')], [], EMPTY_PROFILE, '2026-03-01', '2026-03-07', 6, [stub('s1', 'Odeum', '2026-03-01', '2026-03-07', 10, 900)], {}, true);
    expect(s.weeks[0].lines[0].stubSays).toBeUndefined();
    expect(s.employers[0].stubSays).toBeUndefined();
  });

  it("uses a stub's actual figures for the shifts the calendar has, when asked", () => {
    // The calendar's one shift says when; the stub says what was paid.
    const s = claimSummary([job('a', '2026-03-03', 'Odeum')], [], EMPTY_PROFILE, '2026-03-01', '2026-03-14', 6, [stub('s1', 'Odeum', '2026-03-01', '2026-03-14', 80, 4000)], {}, true);
    expect(s.gross).toBe(4000);
    expect(s.hours).toBe(80);
    expect(s.weeks.map(w => w.gross)).toEqual([4000, 0]);
    expect(s.weeks[0].lines).toEqual([{ employer: 'Odeum', hours: 80, gross: 4000, perStub: true }]);
    expect(s.weeks.some(w => w.fromStub)).toBe(false);
    expect(s.stubs[0]).toMatchObject({ status: 'calendar', used: false, shifts: 1, estimate: 400 });
  });

  it("shares a stub's figures over its shifts' weeks by their estimate", () => {
    const s = claimSummary([job('a', '2026-03-03', 'Odeum'), job('b', '2026-03-10', 'Odeum')], [], EMPTY_PROFILE, '2026-03-01', '2026-03-14', 6,
      [stub('s1', 'Odeum', '2026-03-01', '2026-03-14', 20, 900)], {}, true);
    expect(s.weeks.map(w => [w.hours, w.gross])).toEqual([[10, 450], [10, 450]]);
  });

  it('still counts a stub for another employer the same weeks', () => {
    const s = claimSummary([job('a', '2026-03-03', 'PSS')], [], EMPTY_PROFILE, '2026-03-01', '2026-03-07', 6, [stub('s1', 'Odeum', '2026-03-01', '2026-03-07', 40, 2000)]);
    expect(s.weeks[0].lines.map(l => [l.employer, l.fromStub ?? false])).toEqual([['PSS', false], ['Odeum', true]]);
    expect(s.gross).toBe(2400);
  });

  it('counts only the part of a stub inside the dates', () => {
    // Ten days, four of them inside the range.
    const s = claimSummary([], [], EMPTY_PROFILE, '2026-03-07', '2026-03-10', 6, [stub('s1', 'Odeum', '2026-03-01', '2026-03-10', 50, 1000)]);
    expect(s.gross).toBe(400);
    expect(s.hours).toBe(20);
    expect(s.employers[0]).toMatchObject({ firstDay: '2026-03-07', lastDay: '2026-03-10' });
  });

  it('ignores a stub outside the dates', () => {
    const s = claimSummary([], [], EMPTY_PROFILE, '2026-03-01', '2026-03-07', 6, [stub('s1', 'Odeum', '2026-04-01', '2026-04-07', 40, 2000)]);
    expect(s.gross).toBe(0);
    expect(s.stubs).toEqual([]);
  });

  it('reads stored stubs safely', () => {
    const list = cleanStubs([
      { id: 'a', employer: ' Odeum ', start: '2026-03-14', end: '2026-03-01', hours: '80', gross: 4000.555 },
      { id: 'b', employer: '', start: '2026-03-01', end: '2026-03-07', hours: 8, gross: 400 },
      { id: 'c', employer: 'PSS', start: 'Mar 1', end: '2026-03-07', hours: 8, gross: 400 },
      { id: 'd', employer: 'PSS', start: '2026-03-01', end: '2026-03-07', hours: 0, gross: -5 },
      null, 'junk',
    ]);
    expect(list).toEqual([{ id: 'a', employer: 'Odeum', start: '2026-03-01', end: '2026-03-14', hours: 80, gross: 4000.56, createdAt: '' }]);
    expect(cleanStubs(undefined)).toEqual([]);
  });

  it('reads an amount the way it was typed', () => {
    expect([readAmount('$1,234.50'), readAmount(' 40 '), readAmount('')].map(n => (Number.isNaN(n) ? 'NaN' : n))).toEqual([1234.5, 40, 'NaN']);
  });
});

describe('nothing counted twice', () => {
  const stub = (id: string, employer: string, start: string, end: string, gross: number): ClaimStub =>
    ({ id, employer, start, end, hours: 10, gross, createdAt: 'x' });

  it('counts the same stub once, and says which it repeats', () => {
    const s = claimSummary([], [], EMPTY_PROFILE, '2026-03-01', '2026-03-31', 6, [
      stub('a', 'Odeum', '2026-03-01', '2026-03-07', 500), stub('b', 'odeum ', '2026-03-01', '2026-03-07', 500),
    ]);
    expect(s.gross).toBe(500);
    expect(s.stubs.map(u => [u.stub.id, u.status, u.matchedWith?.id])).toEqual([['a', 'counted', undefined], ['b', 'duplicate', 'a']]);
  });

  it('counts one of two stubs whose days overlap, until the dates are put right', () => {
    const s = claimSummary([], [], EMPTY_PROFILE, '2026-03-01', '2026-03-31', 6, [
      stub('a', 'Odeum', '2026-03-01', '2026-03-14', 1000), stub('b', 'Odeum', '2026-03-08', '2026-03-21', 1000),
      stub('c', 'PSS', '2026-03-08', '2026-03-14', 300),
    ]);
    expect(s.gross).toBe(1300);
    expect(s.stubs.map(u => [u.stub.id, u.status])).toEqual([['a', 'counted'], ['b', 'overlap'], ['c', 'counted']]);
  });

  it('finds a stub already kept for the same employer and pay period', () => {
    const list = [stub('a', 'Odeum', '2026-03-01', '2026-03-07', 500)];
    expect(sameStub(list, { employer: ' ODEUM', start: '2026-03-01', end: '2026-03-07' })?.id).toBe('a');
    expect(sameStub(list, { employer: 'Odeum', start: '2026-03-01', end: '2026-03-08' })).toBeUndefined();
    expect(sameStub(list, { employer: 'Odeum', start: '2026-03-01', end: '2026-03-07' }, 'a')).toBeUndefined();
  });
});

describe('employers the app could not name', () => {
  it('knows one when it sees it', () => {
    expect(['Unknown', 'unknown ', 'N/A', 'TBD', '', '?', 'No employer named'].every(isUnclearEmployer)).toBe(true);
    expect(['Odeum', 'Unknown Mortal Orchestra Tour'].some(isUnclearEmployer)).toBe(false);
  });

  it('suggests who it was from what the shift says', () => {
    const known = ['ISLAND CREATIVE MANAGEMENT LLC', 'PRODUCTION SUPPORT SERVICES INC', 'odeum', 'Unknown'];
    expect(suggestEmployer({ notes: 'Worked for island creative, 7th day of pay period', name: 'moscone', venue: 'moscone' }, known)).toBe('ISLAND CREATIVE MANAGEMENT LLC');
    expect(suggestEmployer({ notes: 'odeum load out' }, known)).toBe('odeum');
    expect(suggestEmployer({ notes: 'show call', name: 'moscone' }, known)).toBeUndefined();
  });
});

describe('one employer however it was typed', () => {
  it('puts "Odeum" and "odeum" under one name, in every week', () => {
    const s = summary([job('a', '2026-10-05', 'Odeum'), job('b', '2026-10-06', 'odeum'), job('c', '2026-10-20', 'odeum')], '2026-10-04', '2026-10-24');
    expect(s.employers.map(e => e.name)).toEqual(['Odeum']);
    expect(s.weeks.map(w => w.lines.map(l => `${l.employer} ${l.hours}`))).toEqual([['Odeum 16'], [], ['Odeum 8']]);
  });
});

describe('a stub onto the calendar', () => {
  it('keeps only the days a stub lists inside its pay period, a line a day', () => {
    expect(stubDays([
      { date: '2026-10-27', hours: 8, type: 'ST' }, { date: '2026-10-27', hours: 2, type: 'OT' },
      { date: '2026-11-03', hours: 12.5, type: 'ST' },
      { date: '2026-12-01', hours: 8, type: 'ST' }, { date: 'Oct 28', hours: 8 }, { date: '2026-10-29', hours: 0 }, null,
    ], '2026-10-25', '2026-11-07')).toEqual([{ date: '2026-10-27', hours: 10 }, { date: '2026-11-03', hours: 12.5 }]);
    expect(stubDays(null, '2026-10-25', '2026-11-07')).toBeUndefined();
    expect(stubDays([{ date: 'Oct 28', hours: 8 }], '2026-10-25', '2026-11-07')).toBeUndefined();
  });

  it('makes a shift a listed day, at the printed rate, and none when no days are listed', () => {
    const stub: ClaimStub = { id: 's', employer: 'TEST Co', start: '2026-10-25', end: '2026-11-07', hours: 22.5, gross: 1234.5, days: [{ date: '2026-10-27', hours: 10 }, { date: '2026-11-03', hours: 12.5 }], createdAt: 'x' };
    const shifts = stubShifts(stub, 'now');
    expect(shifts.map(j => [j.date, j.hoursWorked, j.hourlyRate, j.client, j.status])).toEqual([
      ['2026-10-27', 10, 54.87, 'TEST Co', 'completed'], ['2026-11-03', 12.5, 54.87, 'TEST Co', 'completed'],
    ]);
    expect(shifts[0].notes).toBe('From a pay stub: TEST Co, Oct 25, 2026 to Nov 7, 2026, 22.5 h, $1,234.50 gross.');
    expect(stubShifts({ ...stub, rate: 50 }, 'now')[0].hourlyRate).toBe(50);
    expect(stubShifts({ ...stub, days: undefined }, 'now')).toEqual([]);
  });

  it('keeps days and rate when reading stored stubs', () => {
    const [s] = cleanStubs([{ id: 'a', employer: 'TEST Co', start: '2026-10-25', end: '2026-11-07', hours: 22.5, gross: 1234.5, rate: 50, days: [{ date: '2026-10-27', hours: 10 }, { date: 'junk', hours: 3 }] }]);
    expect(s.days).toEqual([{ date: '2026-10-27', hours: 10 }]);
    expect(s.rate).toBe(50);
  });

  it('once on the calendar, the stub matches its shifts and isn\'t counted again', () => {
    const stub: ClaimStub = { id: 's', employer: 'TEST Co', start: '2026-10-25', end: '2026-11-07', hours: 22.5, gross: 1234.5, days: [{ date: '2026-10-27', hours: 10 }], createdAt: 'x' };
    const jobs = stubShifts(stub, 'now').map((j, i) => ({ ...j, id: 'j' + i, createdAt: 'x' }) as Job);
    const s = claimSummary(jobs, [], EMPTY_PROFILE, '2026-10-01', '2026-11-30', 6, [stub]);
    expect(s.stubs[0].status).toBe('calendar');
    expect(s.weeks.filter(w => w.fromStub)).toEqual([]);
  });
});

describe('a bulk pay stub, not averaged over its weeks', () => {
  const bulk = (extra: Partial<ClaimStub> = {}): ClaimStub => ({ id: 'b', employer: 'Odeum Labor Services', start: '2025-07-01', end: '2026-09-30', hours: 255.46, gross: 10287.91, createdAt: 'x', ...extra });

  it('puts the same amount in every week when averaged, as before', () => {
    const s = claimSummary([], [], EMPTY_PROFILE, '2025-07-01', '2026-09-30', 6, [bulk()]);
    expect(s.weeks.filter(w => w.lines.length > 0).length).toBe(s.weeks.length);
    expect(s.unsplit).toEqual([]);
  });

  it('counts it under its employer and in the totals, in no week, when asked', () => {
    const s = claimSummary([job('a', '2026-03-03', 'Island')], [], EMPTY_PROFILE, '2025-07-01', '2026-09-30', 6, [bulk({ noWeeks: true })]);
    expect(s.weeks.flatMap(w => w.lines).map(l => l.employer)).toEqual(['Island']);
    expect(s.unsplit).toEqual([{ stubId: 'b', employer: 'Odeum Labor Services', start: '2025-07-01', end: '2026-09-30', hours: 255.46, gross: 10287.91 }]);
    expect(s.employers.find(e => e.name === 'Odeum Labor Services')).toMatchObject({ gross: 10287.91, hours: 255.46, fromStub: true, days: 0 });
    expect(s.gross).toBe(10687.91);
    expect(s.hours).toBe(263.46);
  });

  it('counts only the part inside the dates', () => {
    const s = claimSummary([], [], EMPTY_PROFILE, '2026-01-01', '2026-01-10', 6, [bulk({ start: '2026-01-01', end: '2026-01-20', hours: 20, gross: 2000, noWeeks: true })]);
    expect(s.unsplit[0]).toMatchObject({ start: '2026-01-01', end: '2026-01-10', hours: 10, gross: 1000 });
    expect(s.gross).toBe(1000);
  });

  it('keeps the choice when stored, and nothing else odd', () => {
    expect(cleanStubs([{ ...bulk(), noWeeks: true }, { ...bulk(), id: 'c', noWeeks: 'yes' }]).map(x => !!x.noWeeks)).toEqual([true, false]);
  });
});

describe('linking one employer to another', () => {
  it('counts a misspelled or renamed employer under the one it is linked to', () => {
    const jobs = [job('a', '2026-03-03', 'Odeum'), job('b', '2026-03-04', 'Odium'), job('c', '2026-03-10', 'Odeum Live')];
    const info = cleanClaimEmployers({ Odium: { linkTo: 'Odeum' }, 'odeum live': { linkTo: 'Odeum' } });
    const s = claimSummary(jobs, [], EMPTY_PROFILE, '2026-03-01', '2026-03-14', 6, [], info);
    expect(s.employers).toHaveLength(1);
    expect(s.employers[0]).toMatchObject({ name: 'Odeum', days: 3, hours: 24, gross: 1200, linked: ['Odeum Live', 'Odium'] });
    expect(s.weeks[0].lines).toEqual([{ employer: 'Odeum', hours: 16, gross: 800 }]);
  });

  it('links a pay stub typed by hand the same way', () => {
    const stubs: ClaimStub[] = [{ id: 's', employer: 'Rock Force', start: '2026-03-08', end: '2026-03-14', hours: 5, gross: 250, createdAt: 'x' }];
    const s = claimSummary([job('a', '2026-03-03', 'RockForce Operations LLC')], [], EMPTY_PROFILE, '2026-03-01', '2026-03-14', 6, stubs,
      cleanClaimEmployers({ 'rock force': { linkTo: 'RockForce Operations LLC' } }));
    expect(s.employers.map(e => e.name)).toEqual(['RockForce Operations LLC']);
    expect(s.employers[0]).toMatchObject({ gross: 650, linked: ['Rock Force'] });
  });

  it('follows a chain of renames, and never loops', () => {
    const jobs = [job('a', '2026-03-03', 'A'), job('b', '2026-03-04', 'B'), job('c', '2026-03-05', 'C')];
    const chain = claimSummary(jobs, [], EMPTY_PROFILE, '2026-03-01', '2026-03-07', 6, [], cleanClaimEmployers({ a: { linkTo: 'B' }, b: { linkTo: 'C' } }));
    expect(chain.employers.map(e => e.name)).toEqual(['C']);
    const loop = claimSummary(jobs, [], EMPTY_PROFILE, '2026-03-01', '2026-03-07', 6, [], cleanClaimEmployers({ a: { linkTo: 'B' }, b: { linkTo: 'A' } }));
    expect(loop.gross).toBe(1200);
  });

  it('keeps a link when stored, but not one to itself', () => {
    expect(cleanClaimEmployers({ Odium: { linkTo: ' Odeum ' }, Odeum: { linkTo: 'odeum' } })).toEqual({ odium: { linkTo: 'Odeum' } });
  });
});

describe("one stub's pay for the calendar shifts it covers", () => {
  // Panotechnics, as on the calendar: four shifts at $30 for 8 hours, $240 each.
  const pano = (id: string, date: string) => job(id, date, 'Panotechnics', { hourlyRate: 30 });
  const shifts = [pano('a', '2026-08-16'), pano('b', '2026-08-17'), pano('c', '2026-08-18'), pano('d', '2026-08-29')];
  const stubs = (usePay: boolean): ClaimStub[] => [
    { id: 's1', employer: 'Panotechnics LLC', start: '2026-08-15', end: '2026-08-21', hours: 0, gross: 1050, createdAt: 'x', ...(usePay ? { usePay: true } : {}) },
    { id: 's2', employer: 'Panotechnics LLC', start: '2026-08-22', end: '2026-08-29', hours: 0, gross: 290, createdAt: 'x', ...(usePay ? { usePay: true } : {}) },
  ];

  it('counts the estimate, and shows each shift beside its part of the stub, until asked', () => {
    const s = claimSummary(shifts, [], EMPTY_PROFILE, '2026-08-01', '2026-08-31', 6, stubs(false));
    expect(s.employers[0]).toMatchObject({ name: 'Panotechnics', gross: 960, hours: 32 });
    expect(s.stubs[0].covered).toEqual([
      { jobId: 'a', date: '2026-08-16', hours: 8, rate: 30, estimate: 240, share: 350 },
      { jobId: 'b', date: '2026-08-17', hours: 8, rate: 30, estimate: 240, share: 350 },
      { jobId: 'c', date: '2026-08-18', hours: 8, rate: 30, estimate: 240, share: 350 },
    ]);
    expect(s.stubs[0].usesPay).toBeUndefined();
  });

  it("counts the stubs' pay instead, once, when each is asked to", () => {
    const s = claimSummary(shifts, [], EMPTY_PROFILE, '2026-08-01', '2026-08-31', 6, stubs(true));
    expect(s.employers[0]).toMatchObject({ name: 'Panotechnics', gross: 1340, hours: 32 });
    expect(s.gross).toBe(1340);
    expect(s.weeks.find(w => w.weekEnding === '2026-08-22')!.lines).toEqual([{ employer: 'Panotechnics', hours: 24, gross: 1050, perStub: true }]);
    expect(s.weeks.find(w => w.weekEnding === '2026-08-29')!.lines).toEqual([{ employer: 'Panotechnics', hours: 8, gross: 290, perStub: true }]);
    expect(s.stubs.map(u => u.usesPay)).toEqual([true, true]);
  });

  it("shares a stub by each shift's own estimate: a $40 rigging call more than a $30 one", () => {
    const mixed = [pano('a', '2026-08-16'), job('b', '2026-08-17', 'Panotechnics', { hourlyRate: 40 })];
    const s = claimSummary(mixed, [], EMPTY_PROFILE, '2026-08-01', '2026-08-31', 6, [{ ...stubs(true)[0], gross: 700 }]);
    expect(s.stubs[0].covered!.map(c => c.share)).toEqual([300, 400]);
    expect(s.gross).toBe(700);
  });

  it('never pays a shift twice from two stubs', () => {
    const twice: ClaimStub[] = [{ ...stubs(true)[0] }, { ...stubs(true)[0], id: 's3', start: '2026-08-16', end: '2026-08-18', gross: 999 }];
    const s = claimSummary(shifts.slice(0, 3), [], EMPTY_PROFILE, '2026-08-01', '2026-08-31', 6, twice);
    expect(s.gross).toBe(1050);
    expect(s.stubs.map(u => u.status)).toEqual(['calendar', 'overlap']);
    expect(s.stubs[1].matchedWith!.id).toBe('s1');
  });

  it('keeps the choice when stored', () => {
    expect(cleanStubs([{ ...stubs(true)[0] }, { ...stubs(false)[0], id: 'z', usePay: 1 }]).map(x => !!x.usePay)).toEqual([true, false]);
  });
});
