import { describe, it, expect } from 'vitest';
import { hourUpdateToEntry, type SmartImportHourUpdate } from './hoursMatching';
import { calculateDayPay, offClockMealMinutes, netHoursWorked, jobPayBreakdown } from './payCalc';
import type { Job } from './store';

// smart-import hands back hours already net of an off-the-clock meal, while
// the rest of the app treats job.hoursWorked as the raw clocked span and lets
// calculateDayPay do the deduction. hourUpdateToEntry is where the two meet.
describe('hourUpdateToEntry — hoursWorked is the raw clocked span', () => {
  const base: SmartImportHourUpdate = { date: '2026-09-10' };

  it('restores the hour smart-import already took off for a walk-away meal', () => {
    // The confirmed case: "8am to 5pm, 1hr walk away" → hoursWorked 8, meal 60 off clock.
    const entry = hourUpdateToEntry({
      ...base,
      startTime: '8:00am',
      endTime: '5:00pm',
      hoursWorked: 8,
      mealMinutes: 60,
      mealOnClock: false,
    });
    expect(entry.hoursWorked).toBe(9);
    expect(entry.mealDuration).toBe(60);
    expect(entry.mealOnClock).toBe(false);
  });

  it('pays a walk-away shift the same whether it was imported or clocked by hand', () => {
    const imported = hourUpdateToEntry({
      ...base,
      startTime: '8:00am',
      endTime: '5:00pm',
      hoursWorked: 8,
      mealMinutes: 60,
      mealOnClock: false,
    });
    const meal = { duration: 60 as const, onClock: false };
    const byHand = calculateDayPay(9, 40, 0, 0, 1, meal);
    const viaImport = calculateDayPay(imported.hoursWorked!, 40, 0, 0, 1, meal);
    expect(viaImport.totalPay).toBe(byHand.totalPay);
    // 8 billable hours at $40, not the 7 the double deduction produced.
    expect(viaImport.totalPay).toBeGreaterThan(calculateDayPay(8, 40, 0, 0, 1, meal).totalPay);
  });

  it('adds the meal back when there are no clock times to measure', () => {
    const entry = hourUpdateToEntry({ ...base, hoursWorked: 8, mealMinutes: 30, mealOnClock: false });
    expect(entry.hoursWorked).toBe(8.5);
  });

  it('leaves an on-the-clock meal alone — nothing was deducted', () => {
    const entry = hourUpdateToEntry({ ...base, hoursWorked: 9, mealMinutes: 60, mealOnClock: true });
    expect(entry.hoursWorked).toBe(9);
  });

  it('leaves hours alone when no meal was taken', () => {
    expect(hourUpdateToEntry({ ...base, hoursWorked: 9 }).hoursWorked).toBe(9);
    expect(hourUpdateToEntry({ ...base, hoursWorked: 9, mealMinutes: 0 }).hoursWorked).toBe(9);
  });

  it('falls back to the clock span across midnight when no hours came through', () => {
    const entry = hourUpdateToEntry({
      ...base,
      startTime: '10:00pm',
      endTime: '6:00am',
    });
    expect(entry.hoursWorked).toBe(8);
  });

  // hoursWorked carries contractual adjustments the clock span cannot express,
  // so the span must never be used to second-guess it — see the smart-import
  // prompt's EXAMPLE 1 and EXAMPLE 3.
  it('keeps a minimum call that runs longer than the hours actually clocked', () => {
    // "10a-14:00 (5mini)" — 4h on the clock, 5h guaranteed.
    const entry = hourUpdateToEntry({
      ...base,
      startTime: '10:00am',
      endTime: '2:00pm',
      hoursWorked: 5,
    });
    expect(entry.hoursWorked).toBe(5);
  });

  it('keeps a minimum call on an overnight spread', () => {
    const entry = hourUpdateToEntry({ ...base, startTime: '10:00pm', endTime: '2:00am', hoursWorked: 5 });
    expect(entry.hoursWorked).toBe(5);
  });

  it('keeps an 8+2 total rather than the wider clock spread', () => {
    // "8am ... 7p / 8+2" — 11h spread, 10h contractual, 9h after the walk away.
    const entry = hourUpdateToEntry({
      ...base,
      startTime: '8:00am',
      endTime: '7:00pm',
      hoursWorked: 9,
      mealMinutes: 60,
      mealOnClock: false,
    });
    expect(entry.hoursWorked).toBe(10);
  });

  it('stays undefined when the note carried no hours at all', () => {
    expect(hourUpdateToEntry(base).hoursWorked).toBeUndefined();
    expect(hourUpdateToEntry({ ...base, mealMinutes: 60, mealOnClock: false }).hoursWorked).toBeUndefined();
  });
});

describe('hourUpdateToEntry — a walk away with no stated length', () => {
  const base: SmartImportHourUpdate = { date: '2026-09-10' };

  it('keeps the full span and adds nothing back, since nothing was deducted', () => {
    // "8a-6p WA" — a walk away happened, its length was never written down.
    const entry = hourUpdateToEntry({
      ...base,
      startTime: '8:00am',
      endTime: '6:00pm',
      hoursWorked: 10,
      mealMinutes: null,
      mealOnClock: false,
      mealDurationUnknown: true,
    });
    expect(entry.hoursWorked).toBe(10);
    expect(entry.mealDuration).toBeUndefined();
    expect(entry.mealDurationUnknown).toBe(true);
  });

  it('does not flag a meal whose length was stated', () => {
    const entry = hourUpdateToEntry({
      ...base,
      hoursWorked: 8,
      mealMinutes: 60,
      mealOnClock: false,
      mealDurationUnknown: false,
    });
    expect(entry.mealDurationUnknown).toBeUndefined();
    expect(entry.hoursWorked).toBe(9);
  });

  it('treats an absent meal as absent, not unknown', () => {
    const entry = hourUpdateToEntry({ ...base, hoursWorked: 9, mealMinutes: null, mealOnClock: null, mealDurationUnknown: false });
    expect(entry.mealDuration).toBeUndefined();
    expect(entry.mealDurationUnknown).toBeUndefined();
    expect(entry.hoursWorked).toBe(9);
  });
});

describe('calculateDayPay — a day built from more than one shift', () => {
  it('deducts both walk aways on a two-in/two-out day, not just one', () => {
    // 6h + 5h clocked across two calls, an hour off each. 11h − 2h = 9h paid.
    const twoMeals = calculateDayPay(11, 50, 0, 0, 1, { duration: 60, onClock: false, offClockMinutesTotal: 120 });
    expect(twoMeals.billableHours).toBe(9);
    // What the old overwrite produced: only one meal ever came off.
    const oneMeal = calculateDayPay(11, 50, 0, 0, 1, { duration: 60, onClock: false });
    expect(oneMeal.billableHours).toBe(10);
    expect(twoMeals.totalPay).toBeLessThan(oneMeal.totalPay);
  });

  it('handles two meals of different lengths', () => {
    const result = calculateDayPay(11, 50, 0, 0, 1, { duration: 60, onClock: false, offClockMinutesTotal: 90 });
    expect(result.billableHours).toBe(9.5);
  });

  it('is unchanged for a single shift, where the total equals the one duration', () => {
    const viaTotal = calculateDayPay(9, 50, 0, 0, 1, { duration: 60, onClock: false, offClockMinutesTotal: 60 });
    const viaDuration = calculateDayPay(9, 50, 0, 0, 1, { duration: 60, onClock: false });
    expect(viaTotal.totalPay).toBe(viaDuration.totalPay);
    expect(viaTotal.billableHours).toBe(8);
  });

  it('deducts nothing when the day has meals but all of them are on the clock', () => {
    const result = calculateDayPay(11, 50, 0, 0, 1, { duration: 30, onClock: true, offClockMinutesTotal: 0 });
    expect(result.billableHours).toBe(11);
  });
});

describe('calculateDayPay — a 6th or 7th day does not compound with overtime', () => {
  const rate = 50;

  it('bills a 6th day at 1.5x straight through, then normal double time after 12', () => {
    // 14h on a 6th day: 12h at 1.5x, then 2h at 2x. Not 8h at 1.5 + 4h at 2.25.
    const result = calculateDayPay(14, rate, 0, 0, 1.5);
    const expected = 8 * 75 + 4 * 75 + 2 * 100;
    expect(result.totalPay).toBe(expected);
    expect(result.totalPay).toBe(1100);
  });

  it('bills a 10h 6th day flat at 1.5x, with no 2.25x tier', () => {
    const result = calculateDayPay(10, rate, 0, 0, 1.5);
    expect(result.totalPay).toBe(10 * 75);
    // The old compounding charged 2.25x for hours 8-10.
    expect(result.totalPay).toBeLessThan(8 * 75 + 2 * 112.5);
  });

  it('bills a 7th day flat at 2x, overtime included', () => {
    const result = calculateDayPay(14, rate, 0, 0, 2);
    expect(result.totalPay).toBe(14 * 100);
  });

  it('leaves an ordinary day alone — straight, then 1.5x, then 2x', () => {
    const result = calculateDayPay(14, rate, 0, 0, 1);
    expect(result.totalPay).toBe(8 * 50 + 4 * 75 + 2 * 100);
  });

  it('still stacks meal penalties on top of a premium day', () => {
    const withMp = calculateDayPay(10, rate, 0, 2, 1.5);
    const withoutMp = calculateDayPay(10, rate, 0, 0, 1.5);
    expect(withMp.totalPay - withoutMp.totalPay).toBe(2 * rate);
  });

  it('does not push night hours past double time on a 6th day', () => {
    // Night is 2x; a 1.5x day must not make it 3x.
    const result = calculateDayPay(4, rate, 0, 0, 1.5, undefined, { rule: 'daily', nightHours: 4, nightMultiplier: 2 });
    expect(result.totalPay).toBe(4 * 100);
  });
});

describe('two meals on one shift, each on its own terms', () => {
  const shift = (extra: Partial<Job>): Job => ({
    id: 'j1', name: 'load in', client: 'Acme', date: '2026-10-06',
    status: 'completed', hoursWorked: 11, hourlyRate: 50,
    has6th7thDayRule: false, hasVacationPay: false, ...extra,
  } as Job);

  it('deducts an hour off the clock and leaves half an hour on it alone', () => {
    // The real case: first lunch 1h off, second 30min on. Only the hour comes off.
    const job = shift({ mealDuration: 60, mealOnClock: false, meal2Duration: 30, meal2OnClock: true });
    expect(offClockMealMinutes(job)).toBe(60);
    expect(netHoursWorked(job)).toBe(10);
  });

  it('deducts both when both are off the clock', () => {
    const job = shift({ mealDuration: 60, mealOnClock: false, meal2Duration: 30, meal2OnClock: false });
    expect(offClockMealMinutes(job)).toBe(90);
    expect(netHoursWorked(job)).toBe(9.5);
  });

  it('deducts neither when both are on the clock', () => {
    const job = shift({ mealDuration: 60, mealOnClock: true, meal2Duration: 30, meal2OnClock: true });
    expect(offClockMealMinutes(job)).toBe(0);
    expect(netHoursWorked(job)).toBe(11);
  });

  it('is unchanged for a shift with only one meal', () => {
    const job = shift({ mealDuration: 60, mealOnClock: false });
    expect(offClockMealMinutes(job)).toBe(60);
    expect(netHoursWorked(job)).toBe(10);
  });

  it('pays the second meal through to gross, not just the hours display', () => {
    const oneMeal = shift({ mealDuration: 60, mealOnClock: false });
    const twoMeals = shift({ mealDuration: 60, mealOnClock: false, meal2Duration: 30, meal2OnClock: false });
    const a = jobPayBreakdown(oneMeal, [oneMeal]);
    const b = jobPayBreakdown(twoMeals, [twoMeals]);
    // Half an hour less worked, billed in the overtime tier.
    expect(a.gross - b.gross).toBe(0.5 * 75);
  });
});
