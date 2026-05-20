// /lib/payroll/meal-penalty.ts
import type { ContractSnapshot } from '@/types/contracts';
import type { ShiftMinute } from './types';

/**
 * Meal penalty: straight time × hours late.
 * Additive on top of base pay. Hours should already be hour-up rounded.
 */
export function calculateMealPenalty(
  roundedPenaltyHours: number,
  baseRate: number
): number {
  if (roundedPenaltyHours <= 0) return 0;
  return Math.round(roundedPenaltyHours * baseRate * 100) / 100;
}

/**
 * Derives the number of meal penalty hours owed from a built timeline.
 *
 * Rule:
 *  - A meal is contractually due `meal_penalty_due_after_hours` after
 *    shift start, and again that many hours after each meal end.
 *  - If no meal is taken by then, penalty accrues in HOURLY BLOCKS
 *    until a meal starts OR the shift ends.
 *  - Partial hours past the threshold count as a full penalty hour
 *    (hour-up). E.g. 5h 15min into shift with no meal = 1 penalty hour
 *    already owed.
 *  - Penalty does not accrue while a meal is in progress.
 *  - On-clock meals satisfy the contract just like off-clock meals.
 *
 * Returns the total penalty hours owed (always a whole number).
 */
export function deriveMealPenaltyHours(
  timeline: ShiftMinute[],
  snapshot: ContractSnapshot
): number {
  if (timeline.length === 0) return 0;

  const dueAfterMinutes = (snapshot.meal_penalty_due_after_hours ?? 5) * 60;

  let totalPenaltyHours = 0;
  let currentStretchMaxMinutesPastDue = 0;
  let inStretch = false;

  for (let i = 0; i < timeline.length; i++) {
    const minute = timeline[i];

    if (minute.in_meal) {
      // Close out the stretch if we were in one.
      if (inStretch && currentStretchMaxMinutesPastDue > 0) {
        totalPenaltyHours += Math.ceil(currentStretchMaxMinutesPastDue / 60);
      }
      currentStretchMaxMinutesPastDue = 0;
      inStretch = false;
      continue;
    }

    inStretch = true;
    const minutesPastDue =
      minute.minutes_since_last_meal_end_or_start - dueAfterMinutes;

    if (minutesPastDue > currentStretchMaxMinutesPastDue) {
      currentStretchMaxMinutesPastDue = minutesPastDue;
    }
  }

  // Shift ended while in a no-meal stretch — close it out.
  if (inStretch && currentStretchMaxMinutesPastDue > 0) {
    totalPenaltyHours += Math.ceil(currentStretchMaxMinutesPastDue / 60);
  }

  return totalPenaltyHours;
}
