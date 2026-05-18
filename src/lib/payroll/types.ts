// /lib/payroll/types.ts

import type { ContractSnapshot, OvertimeTier } from '@/types/contracts';

/**
 * Facts about what actually happened on a gig.
 * Pulled from the Gig row fields. Does NOT include rules.
 */
export interface GigFacts {
  work_date: Date;              // when the work happened
  worked_hours: number;          // actual hours on the clock (decimal)
  start_time: Date | null;       // for night premium evaluation
  end_time: Date | null;
  break_minutes: number;
  meals_on_clock: boolean;
  is_head: boolean;              // affects minimum
  is_split: boolean;             // affects minimum
  minimum_hours_override: number | null; // explicit per-gig minimum
  meal_penalty_hours: number;
  forced_call: boolean;
  offered_hourly_rate: number | null;
  offered_day_rate: number | null;
  offered_flat_amount: number | null;
}

/**
 * Context for evaluating consecutive-day premium:
 * the trailing gigs that count toward the rolling window.
 */
export interface ConsecutiveDayContext {
  prior_worked_dates: Date[];  // distinct dates worked in trailing N days,
                                // grouped per contract's grouping rule
}

/**
 * One slice of worked time at a specific rate.
 * Output of per-hour rate evaluation.
 */
export interface PaySlice {
  hours: number;
  rate: number;
  multiplier: number;
  applied_rules: string[];      // for human-readable breakdown
}

/**
 * Full breakdown of a gig's pay.
 */
export interface GigPayBreakdown {
  // Time accounting
  worked_hours: number;
  billed_hours: number;           // max(worked, minimum)
  minimum_applied: number;
  
  // Pay slices (by rate)
  worked_slices: PaySlice[];      // hours actually worked at each rate
  padding_slice: PaySlice | null; // minimum padding at ST
  
  // Components
  base_pay: number;               // sum of worked slices + padding
  meal_penalty_pay: number;
  forced_call_pay: number;
  
  // Subtotal before fringe
  subtotal: number;
  
  // Fringe
  fringe_amount: number;
  fringe_in_check: boolean;
  
  // Final
  total_expected: number;         // what should be on the check
  total_earned: number;           // includes fringe even if held separately
  
  // Diagnostic
  warnings: string[];             // e.g. "Worked hours exceed 24"
}
