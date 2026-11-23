import { describe, it, expect } from 'vitest';
import { afterCertifying, certifyCalendar, certifyPeriod, certifyStatus, cleanCertify, cleanReminders, dueText, reminderOn, startCertify } from './reminders';

describe('turning reminders off', () => {
  it('has every reminder on until it is turned off', () => {
    expect(reminderOn(undefined, 'hours')).toBe(true);
    expect(reminderOn({ hours: false }, 'hours')).toBe(false);
    expect(reminderOn({ hours: false }, 'certify')).toBe(true);
  });

  it('keeps only real on and off settings', () => {
    expect(cleanReminders({ hours: false, latePay: 'no', nonsense: false, certify: true })).toEqual({ hours: false, certify: true });
    expect(cleanReminders(null)).toEqual({});
  });
});

describe('certifying', () => {
  const today = '2026-11-23'; // a Monday

  it('starts due the day after this week ends, every two weeks', () => {
    expect(startCertify(today)).toEqual({ every: 14, next: '2026-11-29' });
    expect(startCertify(today, 0)).toEqual({ every: 14, next: '2026-11-30' });
  });

  it('reminds from the day before it is due, and says when it is late', () => {
    expect(certifyStatus({ every: 14, next: '2026-11-25' }, today)).toEqual({ due: '2026-11-25', days: 2, remind: false });
    expect(certifyStatus({ every: 14, next: '2026-11-24' }, today).remind).toBe(true);
    expect(certifyStatus({ every: 14, next: '2026-11-20' }, today)).toMatchObject({ days: -3, remind: true });
    expect([2, 1, 0, -1, -3].map(dueText)).toEqual(['due in 2 days', 'due tomorrow', 'due today', '1 day late', '3 days late']);
  });

  it('moves on a cycle once done, and past today when done late', () => {
    expect(afterCertifying({ every: 14, next: '2026-11-23' }, today)).toEqual({ every: 14, next: '2026-12-07' });
    expect(afterCertifying({ every: 14, next: '2026-11-24' }, today)).toEqual({ every: 14, next: '2026-12-08' });
    // Three weeks late: the next one still to come.
    expect(afterCertifying({ every: 14, next: '2026-11-02' }, today)).toEqual({ every: 14, next: '2026-11-30' });
    expect(afterCertifying({ every: 7, next: '2026-11-23' }, today)).toEqual({ every: 7, next: '2026-11-30' });
  });

  it('covers the weeks that ended before it is due', () => {
    // Due Sunday Nov 29: the two weeks Nov 15 to Nov 28.
    expect(certifyPeriod({ every: 14, next: '2026-11-29' })).toEqual({ from: '2026-11-15', through: '2026-11-28' });
    // Due midweek: the two full weeks before it.
    expect(certifyPeriod({ every: 14, next: '2026-12-02' })).toEqual({ from: '2026-11-15', through: '2026-11-28' });
    expect(certifyPeriod({ every: 7, next: '2026-11-29' })).toEqual({ from: '2026-11-22', through: '2026-11-28' });
  });

  it('makes one calendar alert at 9 AM on each due date, repeating with the schedule', () => {
    const ics = certifyCalendar({ every: 14, next: '2026-11-24' }, new Date('2026-11-23T18:30:05.123Z'), 'https://show-flow.vercel.app/benefits/unemployment');
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('DTSTART:20261124T090000');
    expect(lines).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2');
    expect(lines).toContain('DTSTAMP:20261123T183005Z');
    expect(lines).toContain('URL:https://show-flow.vercel.app/benefits/unemployment');
    expect(lines.filter(l => l === 'BEGIN:VALARM')).toHaveLength(1);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(certifyCalendar({ every: 7, next: '2026-11-24' }, new Date(), 'x')).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1');
  });

  it('reads a stored schedule safely', () => {
    expect(cleanCertify({ every: 7, next: '2026-11-29' })).toEqual({ every: 7, next: '2026-11-29' });
    expect(cleanCertify({ every: 30, next: '2026-11-29' })).toEqual({ every: 14, next: '2026-11-29' });
    expect(cleanCertify({ next: 'Nov 29' })).toBeUndefined();
    expect(cleanCertify(undefined)).toBeUndefined();
  });
});
