import { describe, it, expect } from 'vitest';
import {
  cleanConferences, conferenceAlerts, conferenceDays, howFar, monthConferences, nextShow, safeLink, spanText,
  usualMonthOf, whenText, withDates, type Conference,
} from './conferences';

const conf = (over: Partial<Conference> = {}): Conference => ({ id: 'c1', name: 'TEST Expo', dates: [], createdAt: 'x', ...over });

describe('the conference list as stored', () => {
  it('keeps what reads and drops what does not', () => {
    const list = cleanConferences([
      { id: 'a', name: '  Expo ', dates: [{ start: '2026-04-12', end: '2026-04-15' }], usualMonth: 4, remindWeeks: 6 },
      { id: 'b', name: '' },
      { name: 'No id' },
      null,
      'junk',
      { id: 'c', name: 'Messy', dates: [{ start: 'Nov 5', end: 'Nov 8' }, { start: '2026-02-30' }, { start: '2025-09-01', end: '2025-08-01' }, {}, null], usualMonth: 13, remindWeeks: 'lots' },
    ]);
    expect(list.map(c => c.id)).toEqual(['a', 'c']);
    expect(list[0]).toMatchObject({ name: 'Expo', usualMonth: 4, remindWeeks: 6, dates: [{ start: '2026-04-12', end: '2026-04-15' }] });
    // "Nov 5" and Feb 30 aren't days; an end before its start is the start alone.
    expect(list[1].dates).toEqual([{ start: '2025-09-01', end: '2025-09-01' }]);
    expect(list[1].usualMonth).toBeUndefined();
    expect(list[1].remindWeeks).toBeUndefined();
  });

  it('reads nothing at all as an empty list', () => {
    expect(cleanConferences(undefined)).toEqual([]);
    expect(cleanConferences({ id: 'a' })).toEqual([]);
  });

  it('keeps a year of dates in order, one entry a year', () => {
    let c = conf({ dates: [{ start: '2025-04-05', end: '2025-04-09' }] });
    c = withDates(c, { start: '2027-04-10', end: '2027-04-13' });
    c = withDates(c, { start: '2026-04-09', end: '2026-04-12' });
    c = withDates(c, { start: '2026-04-16', end: '2026-04-19' });
    expect(c.dates.map(d => d.start)).toEqual(['2025-04-05', '2026-04-16', '2027-04-10']);
  });
});

describe('what comes next', () => {
  const today = '2026-11-21';

  it('takes the usual month from the latest dates when none is set', () => {
    expect(usualMonthOf(conf({ dates: [{ start: '2025-03-02', end: '2025-03-05' }, { start: '2026-04-09', end: '2026-04-12' }] }))).toBe(4);
    expect(usualMonthOf(conf({ usualMonth: 9, dates: [{ start: '2026-04-09', end: '2026-04-12' }] }))).toBe(9);
    expect(usualMonthOf(conf())).toBeUndefined();
  });

  it('is next year, expected in its usual month, once this year is over', () => {
    const c = conf({ dates: [{ start: '2026-04-09', end: '2026-04-12' }] });
    expect(nextShow(c, today)).toEqual({ kind: 'expected', year: 2027, month: 4 });
  });

  it('is the dates set, when they are', () => {
    const c = conf({ dates: [{ start: '2026-04-09', end: '2026-04-12' }, { start: '2027-04-15', end: '2027-04-18' }] });
    expect(nextShow(c, today)).toEqual({ kind: 'dated', start: '2027-04-15', end: '2027-04-18' });
  });

  it('is this year when its month is still to come and no dates are in', () => {
    expect(nextShow(conf({ usualMonth: 12 }), today)).toEqual({ kind: 'expected', year: 2026, month: 12 });
    // In its month already: still this year's.
    expect(nextShow(conf({ usualMonth: 11 }), today)).toEqual({ kind: 'expected', year: 2026, month: 11 });
    expect(nextShow(conf({ usualMonth: 10 }), today)).toEqual({ kind: 'expected', year: 2027, month: 10 });
  });

  it('is on now while its days run', () => {
    const c = conf({ dates: [{ start: '2026-11-19', end: '2026-11-23' }] });
    expect(nextShow(c, today)).toEqual({ kind: 'dated', start: '2026-11-19', end: '2026-11-23' });
    expect(whenText(c, today)).toBe('Nov 19–23, 2026 · on now, through Nov 23');
  });

  it('has nothing next with no dates ahead and no usual month', () => {
    expect(nextShow(conf(), today)).toBeNull();
    expect(whenText(conf(), today)).toBe('dates not in');
  });
});

describe('the alerts', () => {
  const today = '2026-11-21';

  it('says when one starts within its reminder', () => {
    const soon = conf({ id: 's', name: 'Soon', dates: [{ start: '2026-12-10', end: '2026-12-12' }] });
    const far = conf({ id: 'f', name: 'Far', dates: [{ start: '2027-06-01', end: '2027-06-03' }] });
    const alerts = conferenceAlerts([far, soon], today);
    expect(alerts.map(a => [a.conference.id, a.kind, a.days])).toEqual([['s', 'soon', 19]]);
  });

  it('asks for the dates when one is due and they are not in', () => {
    // Last year in mid-January: due within 8 weeks of January 1.
    const due = conf({ id: 'd', dates: [{ start: '2026-01-13', end: '2026-01-16' }] });
    const alerts = conferenceAlerts([due], today);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'dates', days: 41, next: { kind: 'expected', year: 2027, month: 1 } });
  });

  it('keeps asking into the month it is due', () => {
    expect(conferenceAlerts([conf({ usualMonth: 11 })], today)[0]).toMatchObject({ kind: 'dates', days: -20 });
  });

  it('follows each one\'s own reminder', () => {
    const c = conf({ dates: [{ start: '2027-02-01', end: '2027-02-03' }] });
    expect(conferenceAlerts([c], today)).toHaveLength(0);
    expect(conferenceAlerts([{ ...c, remindWeeks: 12 }], today)).toHaveLength(1);
  });

  it('says nothing while one is on, or with nothing to go on', () => {
    expect(conferenceAlerts([conf({ dates: [{ start: '2026-11-19', end: '2026-11-23' }] }), conf()], today)).toEqual([]);
  });
});

describe('on the calendar', () => {
  it('marks every day a show runs, across a month end', () => {
    const days = conferenceDays([conf({ dates: [{ start: '2026-04-29', end: '2026-05-02' }] })]);
    expect([...days.keys()]).toEqual(['2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02']);
  });

  it('lists a month\'s shows, and the ones only expected there', () => {
    const today = '2026-11-21';
    const set = conf({ id: 'set', name: 'Set', dates: [{ start: '2027-04-12', end: '2027-04-15' }] });
    const expected = conf({ id: 'exp', name: 'Expected', dates: [{ start: '2026-04-02', end: '2026-04-04' }] });
    const other = conf({ id: 'other', name: 'Other', usualMonth: 9 });
    expect(monthConferences([other, expected, set], 2027, 4, today).map(m => [m.conference.id, !!m.dates])).toEqual([['set', true], ['exp', false]]);
    // April 2026 is over: only what had dates.
    expect(monthConferences([expected, other], 2026, 4, today).map(m => m.conference.id)).toEqual(['exp']);
    expect(monthConferences([other], 2026, 9, today)).toEqual([]);
  });
});

describe('the words', () => {
  it('writes a show\'s days short', () => {
    expect(spanText({ start: '2027-04-12', end: '2027-04-12' })).toBe('Apr 12');
    expect(spanText({ start: '2027-04-12', end: '2027-04-15' })).toBe('Apr 12–15');
    expect(spanText({ start: '2027-04-30', end: '2027-05-03' }, true)).toBe('Apr 30 – May 3, 2027');
  });

  it('says how far off', () => {
    expect([0, 1, 5, 20, 84, 140].map(howFar)).toEqual(['today', 'tomorrow', 'in 5 days', 'in 3 weeks', 'in 12 weeks', 'in 5 months']);
  });

  it('says when next', () => {
    const today = '2026-11-21';
    expect(whenText(conf({ dates: [{ start: '2026-04-09', end: '2026-04-12' }] }), today)).toBe('usually April · 2027 dates not in');
    expect(whenText(conf({ dates: [{ start: '2027-04-15', end: '2027-04-18' }] }), today)).toBe('Apr 15–18, 2027 · in 5 months');
  });

  it('opens only web links', () => {
    expect(safeLink('nabshow.com')).toBe('https://nabshow.com/');
    expect(safeLink('https://example.org/dates')).toBe('https://example.org/dates');
    expect(safeLink('javascript:alert(1)')).toBeUndefined();
    expect(safeLink('  ')).toBeUndefined();
  });
});
