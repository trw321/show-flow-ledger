import { describe, it, expect } from 'vitest';
import { parseDayTimeline, withGapOnClock } from './dayTimeline';
import { calculateDayPay } from './payCalc';

describe('parseDayTimeline', () => {
  it('reads three calls with an hour out between each', () => {
    // The shorthand a day like this actually arrives in — no meal is written
    // down, the gaps are the meals.
    const t = parseDayTimeline('8-10, 11-3, 4-7')!;
    expect(t.calls.map(c => [c.start, c.end])).toEqual([
      ['08:00 AM', '10:00 AM'],
      ['11:00 AM', '03:00 PM'],
      ['04:00 PM', '07:00 PM'],
    ]);
    expect(t.gaps.map(g => g.minutes)).toEqual([60, 60]);
    expect(t.spreadHours).toBe(11);
    // Two hours of lunch off the clock: 11 clocked, 9 worked.
    expect(t.offClockMinutes).toBe(120);
    expect(t.workedHours).toBe(9);
  });

  it('survives the stray words people type alongside the times', () => {
    const t = parseDayTimeline('8-10, lunch, 11-3, lunch 4-7')!;
    expect(t.calls).toHaveLength(3);
    expect(t.gaps.map(g => g.minutes)).toEqual([60, 60]);
    expect(t.workedHours).toBe(9);
  });

  it('pays a gap kept on the clock', () => {
    const t = parseDayTimeline('8-10, 11-3, 4-7', [true, false])!;
    expect(t.offClockMinutes).toBe(60);
    expect(t.workedHours).toBe(10);
  });

  it('pays every hour when both gaps stay on the clock', () => {
    const t = parseDayTimeline('8-10, 11-3, 4-7', [true, true])!;
    expect(t.offClockMinutes).toBe(0);
    expect(t.workedHours).toBe(11);
    expect(t.workedHours).toBe(t.spreadHours);
  });

  it('reads a single call as a day with no gaps', () => {
    const t = parseDayTimeline('8am-5pm')!;
    expect(t.calls).toHaveLength(1);
    expect(t.gaps).toEqual([]);
    expect(t.workedHours).toBe(9);
    expect(t.spreadHours).toBe(9);
  });

  it('carries an explicit am/pm through instead of guessing', () => {
    const t = parseDayTimeline('9a-2p and 6p-11p')!;
    expect(t.calls.map(c => c.start)).toEqual(['09:00 AM', '06:00 PM']);
    expect(t.gaps[0].minutes).toBe(240);
  });

  it('handles a split day that crosses midnight', () => {
    const t = parseDayTimeline('9a-2p and 10:30p-3am')!;
    expect(t.calls.map(c => [c.start, c.end])).toEqual([
      ['09:00 AM', '02:00 PM'],
      ['10:30 PM', '03:00 AM'],
    ]);
    expect(t.calls[1].hours).toBe(4.5);
    expect(t.spreadHours).toBe(18);
  });

  it('keeps half hours', () => {
    const t = parseDayTimeline('8:30-10, 10:30-2')!;
    expect(t.calls[0].hours).toBe(1.5);
    expect(t.gaps[0].minutes).toBe(30);
    expect(t.workedHours).toBe(5);
  });

  it('reads an afternoon first call without an am/pm', () => {
    const t = parseDayTimeline('1-5')!;
    expect(t.calls[0].start).toBe('01:00 PM');
    expect(t.calls[0].hours).toBe(4);
  });

  it('treats back-to-back calls as no gap at all', () => {
    const t = parseDayTimeline('8-12, 12-4')!;
    expect(t.gaps).toEqual([]);
    expect(t.workedHours).toBe(8);
  });

  it('returns null when there is no time range to find', () => {
    expect(parseDayTimeline('lunch somewhere')).toBeNull();
    expect(parseDayTimeline('')).toBeNull();
  });
});

describe('withGapOnClock', () => {
  it('re-prices the day when a lunch is put back on the clock', () => {
    const t = parseDayTimeline('8-10, 11-3, 4-7')!;
    expect(t.workedHours).toBe(9);
    const paid = withGapOnClock(t, 0, true);
    expect(paid.workedHours).toBe(10);
    expect(paid.offClockMinutes).toBe(60);
    // The calls themselves are untouched.
    expect(paid.calls).toEqual(t.calls);
  });
});

describe('a multi-call day reaching the pay engine', () => {
  it('pays the spread minus both lunches, at the rate for those hours', () => {
    const t = parseDayTimeline('8-10, 11-3, 4-7')!;
    // The day is handed over the same way any other is: the clocked spread as
    // hours, and the day's off-the-clock minutes as the meal.
    const result = calculateDayPay(t.spreadHours, 50, 0, 0, 1, { offClockMinutesTotal: t.offClockMinutes });
    expect(result.billableHours).toBe(9);
    expect(result.totalPay).toBe(8 * 50 + 1 * 75);
  });

  it('costs an hour of pay when a lunch is off the clock rather than on', () => {
    const t = parseDayTimeline('8-10, 11-3, 4-7')!;
    const onClock = withGapOnClock(t, 0, true);
    const off = calculateDayPay(t.spreadHours, 50, 0, 0, 1, { offClockMinutesTotal: t.offClockMinutes });
    const on = calculateDayPay(onClock.spreadHours, 50, 0, 0, 1, { offClockMinutesTotal: onClock.offClockMinutes });
    expect(on.billableHours - off.billableHours).toBe(1);
    expect(on.totalPay).toBeGreaterThan(off.totalPay);
  });
});
