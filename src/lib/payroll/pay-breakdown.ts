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

  // 2. Build the per-minute shift timeline. This is the spine of the engine.
  const timeline = buildShiftTimeline(facts);
  const rawWorkedHours = totalWorkedHours(timeline);

  // 3. Derive meal penalty hours from the timeline.
  const rawMealPenaltyHours = deriveMealPenaltyHours(timeline, snapshot);

  // 4. Apply contract rounding to total worked hours.
  //    For Local 16 (hour_up): 8.1 worked → 9 billed worked hours.
  //    This rounded value drives the OT tier in the rate evaluator below.
  const roundedWorked = applyRounding(rawWorkedHours, snapshot.rounding);

  // 5. Determine minimum + billed hours.
  const minimum = resolveMinimum(facts, snapshot);
  const billedHours = Math.max(roundedWorked, minimum);
  const paddingHours = billedHours - roundedWorked;

  // 6. Evaluate worked slices from the timeline.
  //    Note: we pass the original timeline. If rounding bumped rawWorked from
  //    8.1 → 9, that means an extra 0.9 hours need to be added at the end at
  //    the appropriate OT tier. We handle that as a post-step (see below).
  const workedSlicesFromTimeline = evaluateWorkedSlicesFromTimeline(
    timeline,
    snapshot,
    context,
    baseRate
  );

  // 7. Hour-up adjustment: if rounding added hours beyond what the timeline
  //    physically contains, those phantom hours bill at the LAST tier the
  //    worker reached. E.g. 8.1 worked → timeline produces 8.1 hours of slices,
  //    we need 0.9 more hours at whatever rate hour 9 would be (OT 1.5x for
  //    Local 16). Compute the rate that would apply at the cumulative-worked
  //    boundary right after the last worked minute.
  const roundingExtra = roundedWorked - rawWorkedHours;
  let workedSlices = workedSlicesFromTimeline;
  if (roundingExtra > 0.0001) {
    workedSlices = addRoundingExtraToSlices(
      workedSlicesFromTimeline,
      roundingExtra
    );
  }

  // 8. Padding slice (always at ST, regardless of premiums on worked hours)
  const paddingSlice: PaySlice | null =
    paddingHours > 0.0001
      ? {
          hours: paddingHours,
          rate: baseRate,
          multiplier: 1.0,
          applied_rules: ['minimum_padding'],
        }
      : null;

  // 9. Base pay
  const workedPay = workedSlices.reduce(
    (sum, s) => sum + s.hours * s.rate * s.multiplier,
    0
  );
  const paddingPay = paddingSlice
    ? paddingSlice.hours * paddingSlice.rate * paddingSlice.multiplier
    : 0;
  const basePay = round2(workedPay + paddingPay);

  // 10. Meal penalty — derived hours are already whole numbers (hour-up at source).
  const mealPenaltyPay = calculateMealPenalty(rawMealPenaltyHours, baseRate);

  // 11. Forced call (usually null when night premium is in use)
  const forcedCallPay = calculateForcedCall(facts, snapshot, baseRate);

  // 12. Subtotal before fringe
  const subtotal = round2(basePay + mealPenaltyPay + forcedCallPay);

  // 13. Fringe
  const { fringeAmount, fringeInCheck } = calculateFringe(subtotal, snapshot);

  // 14. Totals
  const totalExpected = fringeInCheck
    ? round2(subtotal + fringeAmount)
    : subtotal;
  const totalEarned = round2(subtotal + fringeAmount);

  // 15. Warnings
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
    minimum_applied: minimum,
    worked_slices: workedSlices,
    padding_slice: paddingSlice,
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

/**
 * When hour-up rounding adds time beyond what the worker physically clocked
 * (e.g. 8.1 worked → 9 billed), the extra time bills at whatever rate would
 * apply at the next worked minute. Simplest implementation: extend the LAST
 * slice if its rate is what the next minute would be, else add a new slice
 * at the same multiplier as the last slice.
 *
 * This is a pragmatic choice. The "purest" model would re-walk a synthetic
 * extension of the timeline, but for hour-up rounding (typically <1 hour
 * of phantom time), extending the last slice is correct in all standard cases.
 */
function addRoundingExtraToSlices(
  slices: PaySlice[],
  extraHours: number
): PaySlice[] {
  if (slices.length === 0) {
    return slices;
  }
  // Extend the last slice. If the last slice was at OT 1.5x, the rounded-up
  // extra hour is also OT 1.5x (you can't physically be on hour 9 of work
  // without first being on hour 8.x).
  const result = [...slices];
  const last = { ...result[result.length - 1] };
  last.hours = Math.round((last.hours + extraHours) * 10000) / 10000;
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
