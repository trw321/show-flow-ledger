// /lib/payroll/pay-breakdown.ts

import type { ContractSnapshot } from '@/types/contracts';
import type { GigFacts, ConsecutiveDayContext, GigPayBreakdown, PaySlice } from './types';
import { applyRounding } from './rounding';
import { evaluateWorkedHours } from './rate-evaluation';
import { calculateMealPenalty } from './meal-penalty';
import { calculateFringe } from './fringe';

export function calculatePayBreakdown(
  facts: GigFacts,
  snapshot: ContractSnapshot,
  context: ConsecutiveDayContext
): GigPayBreakdown {
  const warnings: string[] = [];
  
  // 1. Resolve base rate (from offer)
  const baseRate = facts.offered_hourly_rate ?? snapshot.hourly_rate;
  if (baseRate == null) {
    throw new Error('No hourly rate available — gig offer or contract must specify one');
  }
  
  // 2. Apply rounding to worked hours
  const roundedWorked = applyRounding(facts.worked_hours, snapshot.rounding);
  
  // 3. Determine minimum
  const minimum = resolveMinimum(facts, snapshot);
  
  // 4. Compute billed hours (worked, padded up to minimum)
  const billedHours = Math.max(roundedWorked, minimum);
  const paddingHours = billedHours - roundedWorked;
  
  // 5. Evaluate worked hours into pay slices
  const workedFacts = { ...facts, worked_hours: roundedWorked };
  const workedSlices = evaluateWorkedHours(workedFacts, snapshot, context, baseRate);
  
  // 6. Padding slice (always at ST)
  const paddingSlice: PaySlice | null = paddingHours > 0
    ? {
        hours: paddingHours,
        rate: baseRate,
        multiplier: 1.0,
        applied_rules: ['minimum_padding'],
      }
    : null;
  
  // 7. Base pay = worked slices + padding
  const workedPay = workedSlices.reduce(
    (sum, s) => sum + s.hours * s.rate * s.multiplier,
    0
  );
  const paddingPay = paddingSlice
    ? paddingSlice.hours * paddingSlice.rate * paddingSlice.multiplier
    : 0;
  const basePay = round2(workedPay + paddingPay);
  
  // 8. Meal penalty (hour-up rounded, base rate × hours, additive)
  const roundedMealHours = applyRounding(facts.meal_penalty_hours, snapshot.rounding);
  const mealPenaltyPay = calculateMealPenalty(roundedMealHours, baseRate);
  
  // 9. Forced call (legacy — usually null when night premium is in use)
  const forcedCallPay = calculateForcedCall(facts, snapshot);
  
  // 10. Subtotal before fringe
  const subtotal = round2(basePay + mealPenaltyPay + forcedCallPay);
  
  // 11. Fringe
  const { fringeAmount, fringeInCheck } = calculateFringe(subtotal, snapshot);
  
  // 12. Totals
  const totalExpected = fringeInCheck ? round2(subtotal + fringeAmount) : subtotal;
  const totalEarned = round2(subtotal + fringeAmount);
  
  // Sanity warnings
  if (facts.worked_hours > 24) warnings.push('Worked hours exceed 24 — check inputs');
  if (baseRate <= 0) warnings.push('Base rate is zero or negative');
  
  return {
    worked_hours: facts.worked_hours,
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

function resolveMinimum(facts: GigFacts, snapshot: ContractSnapshot): number {
  // Explicit gig override wins
  if (facts.minimum_hours_override != null) return facts.minimum_hours_override;
  
  // Split shifts: typically 4 hours per side (per Local 16 convention)
  if (facts.is_split) return 4;
  
  // Head/lead: 8 hours
  if (facts.is_head) return 8;
  
  // Standard from contract
  return snapshot.minimum_call_hours ?? 0;
}

function calculateForcedCall(facts: GigFacts, snapshot: ContractSnapshot): number {
  if (!facts.forced_call) return 0;
  if (snapshot.forced_call_premium_amount == null) return 0;
  
  if (snapshot.forced_call_premium_type === 'flat') {
    return snapshot.forced_call_premium_amount;
  }
  if (snapshot.forced_call_premium_type === 'hours') {
    const baseRate = facts.offered_hourly_rate ?? snapshot.hourly_rate ?? 0;
    return round2(baseRate * snapshot.forced_call_premium_amount);
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
