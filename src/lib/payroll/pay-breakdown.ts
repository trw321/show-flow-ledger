// /lib/payroll/pay-breakdown.ts
import type { ContractSnapshot } from '@/types/contracts';
import type {
  GigFacts,
  ConsecutiveDayContext,
  GigPayBreakdown,
  PaySlice,
} from './types';
import { applyRounding } from './rounding';
import { evaluateWorkedSlicesFromTimeline } from './rate-evaluation';
import { calculateMealPenalty, deriveMealPenaltyHours } from './meal-penalty';
import { calculateFringe } from './fringe';
import { buildShiftTimeline, totalWorkedHours } from './timeline';
import { derivePostMealPaddingHours } from './post-meal-minimum';

export function calculatePayBreakdown(
  facts: GigFacts,
  snapshot: ContractSnapshot,
  context: ConsecutiveDayContext
): GigPayBreakdown {
  const warnings: string[] = [];

  // 1. Resolve base rate (from offer)
  const baseRate = facts.offered_hourly_rate ?? snapshot.hourly_rate;
  if (baseRate == null) {
    throw new Error(
      'No hourly rate available — gig offer or contract must specify one'
    );
  }

  // 2. Build the per-minute shift timeline.
  const timeline = buildShiftTimeline(facts);
  const rawWorkedHours = totalWorkedHours(timeline);

  // 3. Derive meal penalty hours from the timeline.
  const rawMealPenaltyHours = deriveMealPenaltyHours(timeline, snapshot);

  // 4. Derive post-meal 2hr minimum padding (off-clock meals only).
  const postMealPaddingHours = derivePostMealPaddingHours(
    timeline,
    facts.meal_breaks
  );

  // 5. Apply contract rounding to total worked hours.
  const roundedWorked = applyRounding(rawWorkedHours, snapshot.rounding);

  // 6. Determine gig minimum-call.
  const gigMinimum = resolveMinimum(facts, snapshot);

  // 7. Effective floor for billed hours.
  //    Two floors:
  //      - Gig minimum-call (5/8/4 etc.)
  //      - Worked + post-meal padding (worker sent home < 2hrs post-meal)
  //    Whichever is higher is the billed floor. They don't double-count —
  //    same ST padding satisfies both.
  const postMealFloor = roundedWorked + postMealPaddingHours;
  const billedHours = Math.max(roundedWorked, gigMinimum, postMealFloor);

  // 8. Apportion padding between the two padding slices.
  //    Total padding hours = billedHours - roundedWorked.
  //    Post-meal padding takes priority (it's a more specific rule).
  //    Anything left over is gig minimum-call padding.
  const totalPaddingHours = billedHours - roundedWorked;
  const actualPostMealPadding = Math.min(
    postMealPaddingHours,
    totalPaddingHours
  );
  const actualGigMinPadding = totalPaddingHours - actualPostMealPadding;

  // 9. Evaluate worked slices from the timeline.
  const workedSlicesFromTimeline = evaluateWorkedSlicesFromTimeline(
    timeline,
    snapshot,
    context,
    baseRate
  );

  // 10. Hour-up rounding extra time (if rawWorked → roundedWorked added time).
  const roundingExtra = roundedWorked - rawWorkedHours;
  let workedSlices = workedSlicesFromTimeline;
  if (roundingExtra > 0.0001) {
    workedSlices = addRoundingExtraToSlices(
      workedSlicesFromTimeline,
      roundingExtra
    );
  }

  // 11. Padding slices (always at ST).
  const postMealPaddingSlice: PaySlice | null =
    actualPostMealPadding > 0.0001
      ? {
          hours: roundCents(actualPostMealPadding),
          rate: baseRate,
          multiplier: 1.0,
          applied_rules: ['post_meal_minimum'],
        }
      : null;

  const paddingSlice: PaySlice | null =
    actualGigMinPadding > 0.0001
      ? {
          hours: roundCents(actualGigMinPadding),
          rate: baseRate,
          multiplier: 1.0,
          applied_rules: ['minimum_padding'],
        }
      : null;

  // 12. Base pay
  const workedPay = workedSlices.reduce(
    (sum, s) => sum + s.hours * s.rate * s.multiplier,
    0
  );
  const paddingPay = paddingSlice
    ? paddingSlice.hours * paddingSlice.rate * paddingSlice.multiplier
    : 0;
  const postMealPaddingPay = postMealPaddingSlice
    ? postMealPaddingSlice.hours *
      postMealPaddingSlice.rate *
      postMealPaddingSlice.multiplier
    : 0;
  const basePay = round2(workedPay + paddingPay + postMealPaddingPay);

  // 13. Meal penalty
  const mealPenaltyPay = calculateMealPenalty(rawMealPenaltyHours, baseRate);

  // 14. Forced call
  const forcedCallPay = calculateForcedCall(facts, snapshot, baseRate);

  // 15. Subtotal before fringe
  const subtotal = round2(basePay + mealPenaltyPay + forcedCallPay);

  // 16. Fringe
  const { fringeAmount, fringeInCheck } = calculateFringe(subtotal, snapshot);

  // 17. Totals
  const totalExpected = fringeInCheck
    ? round2(subtotal + fringeAmount)
    : subtotal;
  const totalEarned = round2(subtotal + fringeAmount);

  // 18. Warnings
  if (rawWorkedHours > 24) {
    warnings.push('Worked hours exceed 24 — check inputs');
  }
  if (baseRate <= 0) {
    warnings.push('Base rate is zero or negative');
  }
  if (rawWorkedHours > 5 && facts.meal_breaks.length === 0) {
    warnings.push(
      'Worked >5 hours with no meal breaks recorded — meal penalty applied automatically'
    );
  }

  return {
    worked_hours: rawWorkedHours,
    billed_hours: billedHours,
    minimum_applied: gigMinimum,
    worked_slices: workedSlices,
    padding_slice: paddingSlice,
    post_meal_padding_slice: postMealPaddingSlice,
    base_pay: basePay,
    meal_penalty_pay: mealPenaltyPay,
    forced_call_pay: forcedCallPay,
    subtotal,
    fringe_amount: fringeAmount,
    fringe_in_check: fringeInCheck,
    total_expected: totalExpected,
    total_earned: totalEarned,
    warnings,
  };
}

function addRoundingExtraToSlices(
  slices: PaySlice[],
  extraHours: number
): PaySlice[] {
  if (slices.length === 0) return slices;
  const result = [...slices];
  const last = { ...result[result.length - 1] };
  last.hours = roundCents(last.hours + extraHours);
  result[result.length - 1] = last;
  return result;
}

function resolveMinimum(facts: GigFacts, snapshot: ContractSnapshot): number {
  if (facts.minimum_hours_override != null) {
    return facts.minimum_hours_override;
  }
  if (facts.is_split) return 4;
  if (facts.is_head) return 8;
  return snapshot.minimum_call_hours ?? 0;
}

function calculateForcedCall(
  facts: GigFacts,
  snapshot: ContractSnapshot,
  baseRate: number
): number {
  if (!facts.forced_call) return 0;
  if (snapshot.forced_call_premium_amount == null) return 0;

  if (snapshot.forced_call_premium_type === 'flat') {
    return snapshot.forced_call_premium_amount;
  }
  if (snapshot.forced_call_premium_type === 'hours') {
    return round2(baseRate * snapshot.forced_call_premium_amount);
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundCents(n: number): number {
  return Math.round(n * 10000) / 10000;
}
