import { describe, it, expect } from 'vitest';
import { liveCallsText, liveDay, lunchMs, startsInLabel, toFiveMinutes, withMeal, workEnd, workedMs } from './liveWork';
import { jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE } from './payerProfile';
import { localToday } from './today';
import type { Employer, Job } from './store';

const at = (h: number, m = 0) => new Date(2026, 10, 14, h, m).getTime();
const MIN = 60_000;

describe('the reminder before work', () => {
  it('says how many minutes are left, not "about an hour", when it is close', () => {
    expect(startsInLabel(2 * MIN)).toBe('Work starts in 2 minutes');
    expect(startsInLabel(30_000)).toBe('Work starts in 1 minute');
    expect(startsInLabel(25 * MIN)).toBe('Work starts in 25 minutes');
  });

  it('still says about an hour when it is about an hour', () => {
    expect(startsInLabel(58 * MIN)).toBe('Work starts in about an hour');
  });
});

describe('lunch on the live counter', () => {
  const lunch = [{ start: at(12, 3), end: at(13, 5) }];

  it('takes the lunch off the time worked', () => {
    // 8:00 to 6:30 is 10.5h on the clock; 62 minutes of it was lunch.
    expect(workedMs(at(8), at(18, 30), lunch)).toBe(10.5 * 60 * MIN - 62 * MIN);
    expect(lunchMs(at(8), at(18, 30), lunch)).toBe(62 * MIN);
  });

  it('pauses while lunch is still going', () => {
    const going = [{ start: at(12) }];
    expect(workEnd(going, at(12, 40))).toBe(at(12));
    expect(workedMs(at(8), at(12, 40), going)).toBe(4 * 60 * MIN);
  });

  it('writes the day as calls with the lunch as the gap', () => {
    expect(liveCallsText(at(8), at(18, 30), lunch)).toBe('8:00am-12:03pm, 1:05pm-6:30pm');
    expect(liveCallsText(at(8), at(18, 30), [])).toBe('');
  });

  it('ignores a lunch tapped on and off by mistake', () => {
    expect(liveCallsText(at(8), at(10), [{ start: at(9), end: at(9) + 10_000 }])).toBe('');
  });

  it('prices a live day with lunch the same as the worked hours alone', () => {
    const base = {
      id: 'live', name: 'Show', client: 'Acme', venue: 'Hall', date: localToday(), status: 'in-progress',
      hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x',
    } as Job;
    const withLunch = { ...base, hoursWorked: 10.5, callTimeline: '8:00am-12:00pm, 1:00pm-6:30pm' } as Job;
    const plain = { ...base, hoursWorked: 9.5 } as Job;
    expect(jobPayBreakdown(withLunch, [withLunch], [], EMPTY_PROFILE).gross)
      .toBeCloseTo(jobPayBreakdown(plain, [plain], [], EMPTY_PROFILE).gross, 2);
  });

  it('breaks the hour on a live estimate when the employer does', () => {
    const live = {
      id: 'live', name: 'Show', client: 'Acme', venue: 'Hall', date: localToday(), status: 'in-progress',
      hourlyRate: 50, hoursWorked: 1.1, has6th7thDayRule: false, notes: '', createdAt: 'x',
    } as Job;
    const acme = { id: 'Acme', name: 'Acme', overtimeRule: 'daily', roundUpToWholeHours: true, createdAt: 'x' } as Employer;
    expect(jobPayBreakdown(live, [live], [acme], EMPTY_PROFILE).gross).toBe(2 * 50);
  });
});

describe('a meal entered on the slider', () => {
  it('comes off the hours whenever it is entered', () => {
    const breaks = withMeal([], at(12, 30), 30);
    expect(workedMs(at(8), at(17), breaks)).toBe(8.5 * 60 * MIN);
    expect(liveCallsText(at(8), at(17), breaks)).toBe('8:00am-12:30pm, 1:00pm-5:00pm');
  });

  it('can still be going, and the counter pauses until you are back', () => {
    const breaks = withMeal([], at(12, 30), null);
    expect(workedMs(at(8), at(13), breaks)).toBe(4.5 * 60 * MIN);
  });

  it('replaces a meal it overlaps, and keeps others', () => {
    const one = withMeal([], at(12), 60);
    const fixed = withMeal(one, at(12, 15), 30);
    expect(fixed).toEqual([{ start: at(12, 15), end: at(12, 45) }]);
    const two = withMeal(fixed, at(18), 30);
    expect(two).toHaveLength(2);
    expect(lunchMs(at(8), at(20), two)).toBe(60 * MIN);
  });

  it('snaps to five minutes', () => {
    expect(toFiveMinutes(at(12, 33))).toBe(at(12, 30));
  });
});

describe('in the middle of a meal entered with its length', () => {
  // 10:30 to 11:15, off the clock, and it's 11:00: halfway through.
  const breaks = withMeal([], at(10, 30), 45);
  const now = at(11);
  const base = {
    id: 'live', name: 'Show', client: 'Acme', venue: 'Hall', date: localToday(), status: 'in-progress',
    hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x',
  } as Job;
  // The live counter prices the day this way: the clocked span to the end of
  // work, with any finished meals as gaps in the calls.
  const priced = (to: number) => {
    const end = workEnd(breaks, to);
    const live = { ...base, hoursWorked: (end - at(8)) / 3_600_000, callTimeline: liveDay(at(8), to, breaks).text || undefined } as Job;
    return jobPayBreakdown(live, [live], [], EMPTY_PROFILE).gross;
  };

  it('stops the work where the meal began', () => {
    expect(workEnd(breaks, now)).toBe(at(10, 30));
    expect(workedMs(at(8), now, breaks)).toBe(2.5 * 60 * MIN);
  });

  it('pays only the work so far, not the meal', () => {
    // It paid the half hour of meal too: 3h at $50 instead of 2.5h.
    expect(priced(now)).toBeCloseTo(2.5 * 50, 2);
  });

  it('counts again once the meal is over', () => {
    expect(workEnd(breaks, at(12))).toBe(at(12));
    expect(workedMs(at(8), at(12), breaks)).toBe(3.25 * 60 * MIN);
    expect(priced(at(12))).toBeCloseTo(3.25 * 50, 2);
  });

  it('keeps counting through it when it is on the clock', () => {
    const paid = withMeal([], at(10, 30), 45, true);
    expect(workEnd(paid, now)).toBe(now);
    expect(workedMs(at(8), now, paid)).toBe(3 * 60 * MIN);
  });
});

describe('a meal on the clock', () => {
  it('is paid: nothing comes off the hours, and the counter keeps going', () => {
    const breaks = withMeal([], at(12, 30), 30, true);
    expect(workedMs(at(8), at(17), breaks)).toBe(9 * 60 * MIN);
    expect(workedMs(at(8), at(13), withMeal([], at(12, 30), null, true))).toBe(5 * 60 * MIN);
  });

  it('is saved as a gap on the clock, so the pay maths agrees', () => {
    const breaks = [...withMeal([], at(12), 60), ...withMeal([], at(18), 30, true)];
    const day = liveDay(at(8), at(21), breaks);
    expect(day.text).toBe('8:00am-12:00pm, 1:00pm-6:00pm, 6:30pm-9:00pm');
    expect(day.gapsOnClock).toEqual([false, true]);
  });

  it('pays the same as typing that day with the gap on the clock', () => {
    const breaks = withMeal([], at(12, 30), 30, true);
    const day = liveDay(at(8), at(17), breaks);
    const job = { id: 'l', name: 'x', client: 'x', venue: '', date: '2026-10-01', status: 'completed', notes: '', has6th7thDayRule: false, createdAt: 'x', hourlyRate: 50, startTime: '8:00 AM', endTime: '5:00 PM', hoursWorked: 9, callTimeline: day.text, callGapsOnClock: day.gapsOnClock } as Job;
    expect(jobPayBreakdown(job, [job], [], EMPTY_PROFILE).gross).toBeCloseTo(8 * 50 + 1 * 75);
  });
});
