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

  it('measures an overnight call across midnight', () => {
    const entry = hourUpdateToEntry({
      ...base,
      startTime: '10:00pm',
      endTime: '6:00am',
      hoursWorked: 7.5,
      mealMinutes: 30,
      mealOnClock: false,
    });
    expect(entry.hoursWorked).toBe(8);
  });

  it('prefers the clock span even on a run that returns gross hours', () => {
    const entry = hourUpdateToEntry({
      ...base,
      startTime: '8:00am',
      endTime: '5:00pm',
      hoursWorked: 9,
      mealMinutes: 60,
      mealOnClock: false,
    });
    expect(entry.hoursWorked).toBe(9);
  });

  it('stays undefined when the note carried no hours at all', () => {
    expect(hourUpdateToEntry(base).hoursWorked).toBeUndefined();
    expect(hourUpdateToEntry({ ...base, mealMinutes: 60, mealOnClock: false }).hoursWorked).toBeUndefined();
  });
});
