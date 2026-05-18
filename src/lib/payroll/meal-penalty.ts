// /lib/payroll/meal-penalty.ts

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
