// Escalating "where's my money" tiers for shifts that are worked and priced
// but have no payment logged at all yet. This is deliberately a flat,
// schedule-agnostic lag (not per-employer paySchedule like getLagStatus in
// IncomePage's reconciliation section, which judges payments that already
// arrived) — the user picked a fixed default: 3 weeks is a typical wait
// before anything needs to sound the alarm, then it escalates the longer
// it goes unpaid.
export type PayTimingTier = 'none' | 'watching' | 'warm' | 'blazing';

const WATCHING_AT_DAYS = 21;
const WARM_AT_DAYS = 42;
const BLAZING_AT_DAYS = 63;

export function getPayTimingTier(daysSinceShift: number): PayTimingTier {
  if (daysSinceShift >= BLAZING_AT_DAYS) return 'blazing';
  if (daysSinceShift >= WARM_AT_DAYS) return 'warm';
  if (daysSinceShift >= WATCHING_AT_DAYS) return 'watching';
  return 'none';
}

export const PAY_TIMING_LABELS: Record<PayTimingTier, string> = {
  none: '',
  watching: 'Watching',
  warm: 'Warm',
  blazing: 'Blazing',
};
