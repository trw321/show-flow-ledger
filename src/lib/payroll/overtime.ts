// /lib/payroll/overtime.ts

import type { OvertimeTier } from '@/types/contracts';

/**
 * Given the hour position within a shift (1-indexed: hour 1 is the first hour),
 * return the OT multiplier that applies. Walks tiers in descending order.
 *
 * Example tiers: [{after_hours: 8, multiplier: 1.5}, {after_hours: 12, multiplier: 2.0}]
 *   Hour 1-8:  multiplier 1.0 (ST)
 *   Hour 9-12: multiplier 1.5
 *   Hour 13+:  multiplier 2.0
 */
export function dailyOTMultiplier(
  hourPosition: number,
  tiers: OvertimeTier[]
): number {
  // Sort tiers ascending by after_hours, find the highest applicable
  const sorted = [...tiers].sort((a, b) => a.after_hours - b.after_hours);
  let multiplier = 1.0;
  for (const tier of sorted) {
    if (hourPosition > tier.after_hours) {
      multiplier = tier.multiplier;
    }
  }
  return multiplier;
}
