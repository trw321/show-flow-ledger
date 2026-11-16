import { describe, it, expect } from 'vitest';
import { liveCallsText, lunchMs, startsInLabel, workEnd, workedMs } from './liveWork';
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
