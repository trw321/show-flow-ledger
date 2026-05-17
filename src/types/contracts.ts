// /types/contracts.ts
//
// Types for the contract domain. Maps 1:1 to the contracts and
// contract_versions tables. Updated for Phase A-revised: classifications,
// night premium, consecutive-day premium, meal penalty unit.

export type ContractType =
  | 'union_collective_bargaining'
  | 'union_pink_contract'
  | 'union_yellow_card'
  | 'non_union_standard'
  | 'non_union_one_off'
  | 'other';

export type RateType = 'hourly' | 'day_rate' | 'flat';
export type RoundingMode = 'none' | 'hour_up';
export type MealPenaltyRateType = 'straight_time';
export type MealPenaltyUnit = 'hour' | 'half_hour' | 'quarter_hour';
export type ForcedCallPremiumType = 'flat' | 'hours';
export type PaySchedule =
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'custom';
export type ConsecutiveDayGrouping =
  | 'employer'
  | 'payroll_company'
  | 'production_company'
  | 'any';

export interface Contract {
  id: string;
  user_id: string;
  name: string;
  local_chapter: string | null;
  contract_type: ContractType | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Overtime tier under a contract version's daily OT rules.
 * Tiers evaluated in order of after_hours ascending.
 */
export interface OvertimeTier {
  after_hours: number;
  multiplier: number;
}

/**
 * One classification (position) under a contract version.
 * Each classification has its own rate and minimum call.
 * Example: V UTILITY at $55.72/hr with 4-hr minimum.
 */
export interface Classification {
  name: string;
  hourly_rate: number;
  minimum_hours: number;
  notes: string | null;
}

export interface ContractVersion {
  id: string;
  contract_id: string;
  version_label: string;
  effective_date: string;
  expires_date: string | null;

  rate_type: RateType;
  hourly_rate: number | null;
  day_rate: number | null;
  flat_amount: number | null;

  classifications: Classification[];

  overtime_tiers: OvertimeTier[];

  rounding: RoundingMode;

  minimum_call_hours: number | null;

  meal_penalty_due_after_hours: number | null;
  meal_penalty_rate_type: MealPenaltyRateType | null;
  meal_penalty_unit: MealPenaltyUnit;

  turnaround_minimum_hours: number | null;
  turnaround_violation_multiplier: number | null;

  fringe_percent: number | null;
  fringe_in_check: boolean;

  forced_call_premium_amount: number | null;
  forced_call_premium_type: ForcedCallPremiumType | null;

  night_premium_start_hour: number | null;
  night_premium_end_hour: number | null;
  night_premium_multiplier: number | null;

  consecutive_day_window_days: number;
  consecutive_day_ot_threshold: number | null;
  consecutive_day_ot_multiplier: number;
  consecutive_day_dt_threshold: number | null;
  consecutive_day_dt_multiplier: number;
  consecutive_day_grouping: ConsecutiveDayGrouping | null;

  pay_schedule: PaySchedule;
  pay_schedule_anchor_date: string | null;
  pay_delay_days: number;

  notes: string | null;
  is_locked: boolean;

  created_at: string;
  updated_at: string;
}

/**
 * Frozen onto gigs as JSONB. Includes traceability + all rule values
 * needed by the calc engine. snapshot_schema_version allows future
 * evolution without breaking historical reconciliations.
 */
export interface ContractSnapshot {
  snapshot_schema_version: 2;

  contract_version_id: string;
  contract_name: string;
  version_label: string;
  effective_date: string;

  classification_name: string | null;
  classification_hourly_rate: number | null;
  classification_minimum_hours: number | null;

  rate_type: RateType;
  hourly_rate: number | null;
  day_rate: number | null;
  flat_amount: number | null;

  overtime_tiers: OvertimeTier[];
  rounding: RoundingMode;
  minimum_call_hours: number | null;

  meal_penalty_due_after_hours: number | null;
  meal_penalty_rate_type: MealPenaltyRateType | null;
  meal_penalty_unit: MealPenaltyUnit;

  turnaround_minimum_hours: number | null;
  turnaround_violation_multiplier: number | null;

  fringe_percent: number | null;
  fringe_in_check: boolean;

  forced_call_premium_amount: number | null;
  forced_call_premium_type: ForcedCallPremiumType | null;

  night_premium_start_hour: number | null;
  night_premium_end_hour: number | null;
  night_premium_multiplier: number | null;

  consecutive_day_window_days: number;
  consecutive_day_ot_threshold: number | null;
  consecutive_day_ot_multiplier: number;
  consecutive_day_dt_threshold: number | null;
  consecutive_day_dt_multiplier: number;
  consecutive_day_grouping: ConsecutiveDayGrouping | null;

  pay_schedule: PaySchedule;
  pay_schedule_anchor_date: string | null;
  pay_delay_days: number;
}
