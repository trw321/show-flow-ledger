// /lib/payroll/rate-evaluation.ts

import type { ContractSnapshot } from '@/types/contracts';
import type { GigFacts, ConsecutiveDayContext, PaySlice } from './types';
import { dailyOTMultiplier } from './overtime';
import { isInNightWindow, nightPremiumMultiplier, consecutiveDayMultiplier } from './premiums';

/**
 * Slice worked hours into PaySlices grouped by effective rate.
 * Each worked hour is evaluated against all applicable rules.
 * Highest multiplier wins (no stacking).
 *
 * Returns slices grouped by (multiplier, applied_rules) for clean breakdown display.
 */
export function evaluateWorkedHours(
  facts: GigFacts,
  snapshot: ContractSnapshot,
  context: ConsecutiveDayContext,
  baseRate: number
): PaySlice[] {
  if (facts.worked_hours <= 0 || facts.start_time == null) {
    return [];
  }
  
  // Consecutive-day premium is constant across the whole gig
  const consecutiveMult = consecutiveDayMultiplier(snapshot, context);
  
  // Walk each hour of work and assign rate
  const slices: PaySlice[] = [];
  const start = facts.start_time;
  
  for (let h = 0; h < facts.worked_hours; h++) {
  const current = new Date(start);
  current.setHours(start.getHours() + h);

  const clockHour = current.getHours();
    
    // Evaluate all applicable multipliers for this hour
    const candidates: { mult: number; rule: string }[] = [
      { mult: 1.0, rule: 'straight_time' },
      { mult: dailyOTMultiplier(hourPosition, snapshot.overtime_tiers), rule: 'daily_ot' },
    ];
    
    if (isInNightWindow(clockHour, snapshot)) {
      candidates.push({
        mult: nightPremiumMultiplier(snapshot),
        rule: 'night_premium',
      });
    }
    
    if (consecutiveMult > 1.0) {
      candidates.push({
        mult: consecutiveMult,
        rule: 'consecutive_day',
      });
    }
    
    // Highest multiplier wins
    const winner = candidates.reduce((a, b) => (b.mult > a.mult ? b : a));
    
    // Collect all rules that tied at the winning multiplier
    const appliedRules = candidates
      .filter(c => c.mult === winner.mult)
      .map(c => c.rule);
    
    // Append to existing slice if same multiplier, else start new slice
    const last = slices[slices.length - 1];
    if (last && last.multiplier === winner.mult) {
      last.hours += 1;
    } else {
      slices.push({
        hours: 1,
        rate: baseRate,
        multiplier: winner.mult,
        applied_rules: appliedRules,
      });
    }
  }
  
  return slices;
}
