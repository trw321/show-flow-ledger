import { describe, it, expect } from 'vitest';
import { parseDayTimeline, withGapOnClock } from './dayTimeline';
import { calculateDayPay, offClockMealMinutes, netHoursWorked } from './payCalc';

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

describe('split shift vs one shift with meals', () => {
  it('calls a day of short breaks one shift with two meals', () => {
    const t = parseDayTimeline('8-10, 11-3, 4-7')!;
    expect(t.isSplit).toBe(false);
    expect(t.shifts).toHaveLength(1);
    expect(t.gaps.map(g => g.isSplitBreak)).toEqual([false, false]);
    expect(t.gaps).toHaveLength(2);
  });

  it('calls two hours out a split, and groups the calls either side of it', () => {
    const t = parseDayTimeline('9a-2p and 4p-9p')!;
    expect(t.gaps[0].minutes).toBe(120);
    expect(t.isSplit).toBe(true);
    expect(t.shifts).toHaveLength(2);
    expect(t.shifts[0][0].start).toBe('09:00 AM');
    expect(t.shifts[1][0].start).toBe('04:00 PM');
  });

  it('keeps 1h55m on the near side of the split line', () => {
    const t = parseDayTimeline('9a-2p and 3:55p-9p')!;
    expect(t.gaps[0].minutes).toBe(115);
    expect(t.isSplit).toBe(false);
    expect(t.shifts).toHaveLength(1);
  });

  it('splits on the long break and keeps a short one as a meal', () => {
    // Out 1h after the first call, then 3h out: one split, one meal.
    const t = parseDayTimeline('8-10, 11-3, 6p-10p')!;
    expect(t.gaps.map(g => g.isSplitBreak)).toEqual([false, true]);
    expect(t.isSplit).toBe(true);
    expect(t.shifts.map(g => g.length)).toEqual([2, 1]);
  });
});

describe('the five-hour meal penalty rule', () => {
  it('suggests none when every stretch is broken within five hours', () => {
    const t = parseDayTimeline('8-10, 11-3, 4-7')!;
    expect(t.workedStretches).toEqual([2, 4, 3]);
    expect(t.suggestedMealPenalties).toBe(0);
  });

  it('suggests none at exactly five hours', () => {
    const t = parseDayTimeline('9a-2p')!;
    expect(t.workedStretches).toEqual([5]);
    expect(t.suggestedMealPenalties).toBe(0);
  });

  it('suggests one for a six-hour stretch with no break', () => {
    const t = parseDayTimeline('8a-2p')!;
    expect(t.suggestedMealPenalties).toBe(1);
  });

  it('suggests two once a stretch runs past ten hours', () => {
    const t = parseDayTimeline('8a-7p')!;
    expect(t.workedStretches).toEqual([11]);
    expect(t.suggestedMealPenalties).toBe(2);
  });

  it('counts a meal on the clock as being fed, because it is', () => {
    // Paid through the meal still means food arrived, so the five hours restart.
    const t = parseDayTimeline('8-10, 11-3', [true])!;
    expect(t.workedStretches).toEqual([2, 4]);
    expect(t.suggestedMealPenalties).toBe(0);
  });

  it('suggests the same whether the meal was paid or not', () => {
    const off = parseDayTimeline('8-10, 11-3')!;
    const on = withGapOnClock(off, 0, true);
    expect(off.suggestedMealPenalties).toBe(0);
    expect(on.suggestedMealPenalties).toBe(0);
    // The pay differs; the penalty does not.
    expect(on.workedHours).toBeGreaterThan(off.workedHours);
  });
});

describe('a break taken is a break — no penalty, whatever its length', () => {
  it('owes nothing after a 30-minute break, even on a long stretch', () => {
    // Seven hours before the break, half an hour off, then more. No MP.
    const t = parseDayTimeline('8a-3p, 3:30p-7p')!;
    expect(t.gaps[0].minutes).toBe(30);
    expect(t.gaps[0].onClock).toBe(false);
    expect(t.workedStretches).toEqual([7, 3.5]);
    expect(t.suggestedMealPenalties).toBe(0);
  });

  it('owes nothing after an hour off, on the same long stretch', () => {
    const t = parseDayTimeline('8a-3p, 4p-7p')!;
    expect(t.gaps[0].minutes).toBe(60);
    expect(t.suggestedMealPenalties).toBe(0);
  });

  it('treats a 30-minute break the same as an hour', () => {
    const half = parseDayTimeline('8a-3p, 3:30p-7p')!;
    const hour = parseDayTimeline('8a-3p, 4p-7p')!;
    expect(half.suggestedMealPenalties).toBe(hour.suggestedMealPenalties);
  });

  it('still owes on a long day worked straight through with no break at all', () => {
    const t = parseDayTimeline('8a-7p')!;
    expect(t.workedStretches).toEqual([11]);
    expect(t.suggestedMealPenalties).toBe(2);
  });

  it('owes nothing on a short day with no break — it is only about long ones', () => {
    expect(parseDayTimeline('9a-2p')!.suggestedMealPenalties).toBe(0);
    expect(parseDayTimeline('8a-1p')!.suggestedMealPenalties).toBe(0);
  });

  it('owes nothing when the only meal was paid — food still arrived', () => {
    const t = parseDayTimeline('8a-3p, 3:30p-7p', [true])!;
    expect(t.workedStretches).toEqual([7, 3.5]);
    expect(t.suggestedMealPenalties).toBe(0);
  });

  it('owes for the stretch after the meal when that one runs past five hours', () => {
    // Fed at 2pm, then six consecutive hours with nothing: one penalty.
    const t = parseDayTimeline('8a-2p, 3p-9p')!;
    expect(t.workedStretches).toEqual([6, 6]);
    expect(t.suggestedMealPenalties).toBe(1);
  });
});

describe('the timeline drives a job through the pay engine', () => {
  const job = (extra: Record<string, unknown>) => ({
    id: 'j1', name: 'load in', client: 'Acme', date: '2026-10-06', status: 'completed',
    has6th7thDayRule: false, hasVacationPay: false, ...extra,
  }) as never;

  it('takes the day off-clock minutes from the calls, not the meal fields', () => {
    const j = job({ hoursWorked: 11, hourlyRate: 50, callTimeline: '8-10, 11-3, 4-7' });
    expect(offClockMealMinutes(j)).toBe(120);
    expect(netHoursWorked(j)).toBe(9);
  });

  it('honours a gap put back on the clock', () => {
    const j = job({ hoursWorked: 11, hourlyRate: 50, callTimeline: '8-10, 11-3, 4-7', callGapsOnClock: [true, false] });
    expect(offClockMealMinutes(j)).toBe(60);
    expect(netHoursWorked(j)).toBe(10);
  });

  it('expresses a gap length the fixed meal durations cannot', () => {
    // 90 minutes out is not 30, 45 or 60 — the timeline is why it still works.
    const j = job({ hoursWorked: 10.5, hourlyRate: 50, callTimeline: '8-12, 1:30p-6p' });
    expect(offClockMealMinutes(j)).toBe(90);
    expect(netHoursWorked(j)).toBe(9);
  });

  it('ignores the meal fields entirely once a timeline is set', () => {
    const j = job({ hoursWorked: 11, callTimeline: '8-10, 11-3, 4-7', mealDuration: 30, mealOnClock: false });
    expect(offClockMealMinutes(j)).toBe(120);
  });

  it('falls back to the meal fields when the timeline cannot be read', () => {
    const j = job({ hoursWorked: 9, callTimeline: 'nonsense', mealDuration: 60, mealOnClock: false });
    expect(offClockMealMinutes(j)).toBe(60);
  });
});
