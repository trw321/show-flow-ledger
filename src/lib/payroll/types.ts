// /lib/payroll/types.ts
import type { ContractSnapshot, OvertimeTier } from '@/types/contracts';

/**
 * A meal break taken during a shift.
 * - on_clock = true: paid time, counts toward worked hours for OT/DT,
 *   satisfies the meal-break contract (no penalty).
 * - on_clock = false: unpaid gap, does NOT count toward worked hours,
 *   shifts wall-clock time of post-meal hours.
 */
export interface MealBreak {
  start_time: Date;
  duration_minutes: number;
  on_clock: boolean;
}

/**
 * Facts about what actually happened on a gig.
 * Pulled from the Gig row fields. Does NOT include rules.
 *
 * Note: worked_hours and meal_penalty_hours are no longer inputs.
 * They're derived from start_time, end_time, and meal_breaks
 * by the timeline walker (see timeline.ts).
 */
export interface GigFacts {
  work_date: Date;
  start_time: Date;              // required — spine of the timeline
  end_time: Date;                // required — spine of the timeline
  meal_breaks: MealBreak[];      // empty array = no meals taken
  is_head: boolean;
  is_split: boolean;
  minimum_hours_override: number | null;
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
  prior_worked_dates: Date[];   // distinct dates worked in trailing N days,
                                 // grouped per contract's grouping rule
}

/**
 * One minute of the shift, with all the state the rate evaluator needs
 * to decide what multiplier applies.
 */
export interface ShiftMinute {
  /** Actual wall-clock time of this minute. */
  wall_clock: Date;
  /** True if this minute counts toward worked hours (working OR on-clock meal). */
  is_worked: boolean;
  /** True if currently in an on-clock meal break. */
  is_on_clock_meal: boolean;
  /** True if currently in any meal break (on-clock or off-clock). */
  in_meal: boolean;
  /** Running total of worked minutes up to and including this one. */
  cumulative_worked_minutes: number;
  /**
   * Minutes since shift start OR last meal end, whichever is more recent.
   * Drives meal penalty accrual. Resets to 0 at the end of any meal break.
   */
  minutes_since_last_meal_end_or_start: number;
}

/**
 * One slice of worked time at a specific rate.
 * Output of per-hour rate evaluation.
 */
export interface PaySlice {
  hours: number;
  rate: number;
  multiplier: number;
  applied_rules: string[];       // for human-readable breakdown
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
  padding_slice: PaySlice | null; // minimum padding at ST (gig minimum-call)
  post_meal_padding_slice: PaySlice | null; // 2hr post-off-clock-meal minimum padding at ST

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
