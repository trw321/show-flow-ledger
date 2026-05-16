// /types/contracts.ts
//
// Types for the contract domain. These map 1:1 to the contracts and
// contract_versions tables created in Phase A. The ContractSnapshot type
// describes the shape that will eventually be frozen onto gigs; it isn't
// stored anywhere yet but is defined here so future code and Zod schemas
// can reference a single source of truth.

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
export type ForcedCallPremiumType = 'flat' | 'hours';
export type PaySchedule =
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'custom';

/**
 * Identity of a labor agreement. Stable across renegotiations —
 * rule changes create new versions rather than mutating this row.
 */
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
 * One overtime tier. Tiers are evaluated in order of after_hours ascending.
 * Example contract: [{after_hours: 8, multiplier: 1.5}, {after_hours: 12, multiplier: 2.0}]
 *   - Hours 0–8: regular rate
 *   - Hours 8–12: 1.5×
 *   - Hours 12+: 2.0×
 */
export interface OvertimeTier {
  after_hours: number;
  multiplier: number;
}

/**
 * A versioned snapshot of rules for a contract.
 * Once a gig snapshots from a version, the version should be treated as locked.
 */
export interface ContractVersion {
  id: string;
  contract_id: string;
  version_label: string;
  effective_date: string;           // ISO date (YYYY-MM-DD)
  expires_date: string | null;

  // Rate structure — exactly one of hourly_rate / day_rate / flat_amount
  // should be set based on rate_type
  rate_type: RateType;
  hourly_rate: number | null;
  day_rate: number | null;
  flat_amount: number | null;

  // Overtime
  overtime_tiers: OvertimeTier[];

  // Rounding
  rounding: RoundingMode;

  // Minimum call
  minimum_call_hours: number | null;

  // Meal penalty
  meal_penalty_due_after_hours: number | null;
  meal_penalty_rate_type: MealPenaltyRateType | null;

  // Turnaround
  turnaround_minimum_hours: number | null;
  turnaround_violation_multiplier: number | null;

  // Fringe
  fringe_percent: number | null;
  fringe_in_check: boolean;

  // Forced call
  forced_call_premium_amount: number | null;
  forced_call_premium_type: ForcedCallPremiumType | null;

  // Pay schedule
  pay_schedule: PaySchedule;
  pay_schedule_anchor_date: string | null;
  pay_delay_days: number;

  // Metadata
  notes: string | null;
  is_locked: boolean;

  created_at: string;
  updated_at: string;
}

/**
 * The shape that will eventually be frozen onto gigs as JSONB.
 * Includes traceability fields (which version this came from) plus
 * all the rule values needed by the calculation engine.
 *
 * Not stored anywhere yet — defined here for future use.
 *
 * snapshot_schema_version allows future migration of stored snapshots
 * without changing this type or breaking historical data.
 */
export interface ContractSnapshot {
  snapshot_schema_version: 1;

  // Traceability
  contract_version_id: string;
  contract_name: string;
  version_label: string;
  effective_date: string;

  // Rules (copied from the contract version at snapshot time)
  rate_type: RateType;
  hourly_rate: number | null;
  day_rate: number | null;
  flat_amount: number | null;

  overtime_tiers: OvertimeTier[];
  rounding: RoundingMode;
  minimum_call_hours: number | null;

  meal_penalty_due_after_hours: number | null;
  meal_penalty_rate_type: MealPenaltyRateType | null;

  turnaround_minimum_hours: number | null;
  turnaround_violation_multiplier: number | null;

  fringe_percent: number | null;
  fringe_in_check: boolean;

  forced_call_premium_amount: number | null;
  forced_call_premium_type: ForcedCallPremiumType | null;

  pay_schedule: PaySchedule;
  pay_schedule_anchor_date: string | null;
  pay_delay_days: number;
}
