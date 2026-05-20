// /lib/payroll/post-meal-minimum.ts
import type { ShiftMinute, MealBreak } from './types';

/**
 * After each off-clock meal, the worker is guaranteed 2 hours of paid time
 * before the shift ends. If the worker is sent home with less than 2 hours
 * worked after the off-clock meal ended, the shortfall is padded at ST.
 *
 * On-clock meals do NOT trigger this rule.
 *
 * Returns total padding hours owed across all off-clock meals.
 * Padding hours are always whole or half-hour increments matching actual
 * minute counts — this returns the raw decimal hours.
 */
export function derivePostMealPaddingHours(
  timeline: ShiftMinute[],
  meal_breaks: MealBreak[]
): number {
  if (timeline.length === 0) return 0;

  const offClockMeals = meal_breaks.filter((m) => !m.on_clock);
  if (offClockMeals.length === 0) return 0;

  const POST_MEAL_MINIMUM_MINUTES = 120;
  let totalShortfallMinutes = 0;

  for (const meal of offClockMeals) {
    const mealEndMs = meal.start_time.getTime() + meal.duration_minutes * 60000;

    // Count worked minutes from this meal's end onward.
    // "Worked" includes on-clock-meal minutes too (they're paid).
    let postMealWorkedMinutes = 0;
    for (const minute of timeline) {
      if (minute.wall_clock.getTime() < mealEndMs) continue;
      if (minute.is_worked) postMealWorkedMinutes++;
    }

    if (postMealWorkedMinutes < POST_MEAL_MINIMUM_MINUTES) {
      totalShortfallMinutes += POST_MEAL_MINIMUM_MINUTES - postMealWorkedMinutes;
    }
  }

  return totalShortfallMinutes / 60;
}
