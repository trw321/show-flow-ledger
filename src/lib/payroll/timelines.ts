// /lib/payroll/timeline.ts
import type { GigFacts, MealBreak, ShiftMinute } from './types';

/**
 * Builds a minute-by-minute timeline of a shift.
 *
 * Each ShiftMinute knows:
 *  - its actual wall-clock time (for premium window overlap)
 *  - whether the worker is being paid for it (worked or on-clock meal)
 *  - cumulative worked minutes so far (for OT tier determination)
 *  - minutes since last meal end / shift start (for meal penalty)
 *
 * Off-clock meals create unpaid gaps but the wall-clock keeps advancing —
 * so a post-meal worked minute can fall in a different premium window
 * than it would have if the meal hadn't happened.
 *
 * On-clock meals are paid AND count toward OT thresholds AND satisfy
 * the meal contract (no penalty).
 */
export function buildShiftTimeline(facts: GigFacts): ShiftMinute[] {
  const { start_time, end_time, meal_breaks } = facts;

  const totalMinutes = Math.round(
    (end_time.getTime() - start_time.getTime()) / 60000
  );

  if (totalMinutes <= 0) {
    return [];
  }

  // Sort meals by start time defensively — caller may not guarantee order.
  const meals = [...meal_breaks].sort(
    (a, b) => a.start_time.getTime() - b.start_time.getTime()
  );

  const timeline: ShiftMinute[] = [];
  let cumulativeWorkedMinutes = 0;
  let minutesSinceLastMealEndOrStart = 0;

  for (let i = 0; i < totalMinutes; i++) {
    const wallClock = new Date(start_time.getTime() + i * 60000);
    const wallClockMs = wallClock.getTime();

    // Is this minute inside any meal break?
    // A minute is "inside" the meal if its timestamp is >= meal start
    // and < meal end. Using strict < on the end means a meal that ends
    // at exactly 18:00 does not consume the 18:00 minute.
    const activeMeal: MealBreak | undefined = meals.find((m) => {
      const mealStartMs = m.start_time.getTime();
      const mealEndMs = mealStartMs + m.duration_minutes * 60000;
      return wallClockMs >= mealStartMs && wallClockMs < mealEndMs;
    });

    const inMeal = !!activeMeal;
    const isOnClockMeal = inMeal && activeMeal!.on_clock;

    // Worked = either actively working OR on an on-clock meal.
    // Off-clock meal minutes are NOT worked.
    const isWorked = !inMeal || isOnClockMeal;

    if (isWorked) {
      cumulativeWorkedMinutes++;
    }

    // Reset the "minutes since last meal" counter when transitioning
    // OUT of a meal (this minute is not in meal, previous minute was).
    // Both on-clock and off-clock meals satisfy the contract and reset.
    const prevMinute = timeline[i - 1];
    if (prevMinute?.in_meal && !inMeal) {
      minutesSinceLastMealEndOrStart = 1; // this minute is the 1st post-meal
    } else if (inMeal) {
      // Inside a meal: counter doesn't tick (meal penalty can't accrue
      // while you're eating). We hold it at whatever it was.
      // Leaving it unchanged from prev iteration's value.
    } else {
      minutesSinceLastMealEndOrStart++;
    }

    timeline.push({
      wall_clock: wallClock,
      is_worked: isWorked,
      is_on_clock_meal: isOnClockMeal,
      in_meal: inMeal,
      cumulative_worked_minutes: cumulativeWorkedMinutes,
      minutes_since_last_meal_end_or_start: minutesSinceLastMealEndOrStart,
    });
  }

  return timeline;
}

/**
 * Total worked hours from a built timeline.
 * Pre-rounding — this is the raw decimal hours.
 */
export function totalWorkedHours(timeline: ShiftMinute[]): number {
  const last = timeline[timeline.length - 1];
  return last ? last.cumulative_worked_minutes / 60 : 0;
}

/**
 * Total elapsed hours (wall-clock duration of shift, ignoring meal gaps).
 * Useful for warnings / sanity checks.
 */
export function totalElapsedHours(timeline: ShiftMinute[]): number {
  return timeline.length / 60;
}
