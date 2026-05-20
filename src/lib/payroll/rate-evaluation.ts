// /lib/payroll/rate-evaluation.ts
import type { ContractSnapshot } from '@/types/contracts';
import type { ConsecutiveDayContext, PaySlice, ShiftMinute } from './types';
import { dailyOTMultiplier } from './overtime';
import {
  isInNightWindow,
  nightPremiumMultiplier,
  consecutiveDayMultiplier,
} from './premiums';

/**
 * Slice worked time into PaySlices grouped by effective rate.
 *
 * Walks the per-minute timeline. For each WORKED minute (worked = actually
 * working OR on-clock meal), evaluates all applicable multipliers and picks
 * the winner (highest, no stacking). Aggregates contiguous same-rate minutes
 * into slices.
 *
 * The OT tier for a given minute is determined by its cumulative_worked_minutes,
 * NOT by its position in the shift. This matters when off-clock meals create
 * gaps — minute #481 of cumulative work is the 9th hour for OT purposes,
 * even if it falls in shift hour 10 because of a meal gap.
 *
 * Output slices have `hours` as a decimal (e.g. 0.5 for 30 minutes). The
 * caller (pay-breakdown.ts) is responsible for any further rounding.
 */
export function evaluateWorkedSlicesFromTimeline(
  timeline: ShiftMinute[],
  snapshot: ContractSnapshot,
  context: ConsecutiveDayContext,
  baseRate: number
): PaySlice[] {
  if (timeline.length === 0) return [];

  // Consecutive-day premium is constant across the whole gig
  const consecutiveMult = consecutiveDayMultiplier(snapshot, context);

  // Build per-minute rate entries, then aggregate.
  type MinuteRate = { mult: number; rules: string[] };
  const minuteRates: MinuteRate[] = [];

  for (const minute of timeline) {
    if (!minute.is_worked) continue;

    // OT tier from cumulative WORKED hours so far.
    // cumulative_worked_minutes is 1-indexed (the minute itself counts),
    // so divide by 60 to get hours-elapsed-so-far for OT threshold lookup.
    // We want: at minute 481 (8h 1min worked), we're in the 9th hour,
    // so OT should fire if the contract triggers at "after 8 hours."
    const cumulativeWorkedHours = minute.cumulative_worked_minutes / 60;

    const candidates: { mult: number; rule: string }[] = [
      { mult: 1.0, rule: 'straight_time' },
      {
        mult: dailyOTMultiplier(cumulativeWorkedHours, snapshot.overtime_tiers),
        rule: 'daily_ot',
      },
    ];

    if (isInNightWindow(minute.wall_clock, snapshot)) {
      candidates.push({
        mult: nightPremiumMultiplier(snapshot),
        rule: 'night_premium',
      });
    }

    if (consecutiveMult > 1.0) {
      candidates.push({ mult: consecutiveMult, rule: 'consecutive_day' });
    }

    const winner = candidates.reduce((a, b) => (b.mult > a.mult ? b : a));
    const rules = candidates
      .filter((c) => c.mult === winner.mult)
      .map((c) => c.rule);

    minuteRates.push({ mult: winner.mult, rules });
  }

  // Aggregate contiguous minutes with same multiplier + same rule set into slices.
  const slices: PaySlice[] = [];
  for (const mr of minuteRates) {
    const last = slices[slices.length - 1];
    if (
      last &&
      last.multiplier === mr.mult &&
      arraysEqual(last.applied_rules, mr.rules)
    ) {
      last.hours += 1 / 60;
    } else {
      slices.push({
        hours: 1 / 60,
        rate: baseRate,
        multiplier: mr.mult,
        applied_rules: mr.rules,
      });
    }
  }

  // Floating-point cleanup: round each slice's hours to 4 decimals
  // (cents-precision in pay × rate × multiplier).
  for (const s of slices) {
    s.hours = Math.round(s.hours * 10000) / 10000;
  }

  return slices;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
