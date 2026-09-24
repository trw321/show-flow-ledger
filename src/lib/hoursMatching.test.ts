import { describe, it, expect } from 'vitest';
import { hourUpdateToEntry, type SmartImportHourUpdate } from './hoursMatching';
import { calculateDayPay } from './payCalc';

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
