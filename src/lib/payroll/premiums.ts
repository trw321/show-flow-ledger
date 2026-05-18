// /lib/payroll/premiums.ts

import type { ContractSnapshot } from '@/types/contracts';
import type { ConsecutiveDayContext } from './types';

/**
 * Is the hour at clockHour (0-23) inside the night premium window?
 * Window: [start_hour, end_hour). E.g. 0-8 = midnight to 8 AM.
 */
export function isInNightWindow(
  clockHour: number,
  snapshot: ContractSnapshot
): boolean {
  const start = snapshot.night_premium_start_hour;
  const end = snapshot.night_premium_end_hour;
  if (start == null || end == null) return false;
  
  // Same-day window (e.g. 22-23): clockHour in [start, end)
  // Wrapping window (e.g. 22-8): clockHour >= start OR clockHour < end
  if (start < end) {
    return clockHour >= start && clockHour < end;
  } else {
    return clockHour >= start || clockHour < end;
  }
}

export function nightPremiumMultiplier(snapshot: ContractSnapshot): number {
  return snapshot.night_premium_multiplier ?? 1.0;
}

/**
 * Determine consecutive-day premium for this gig.
 * Counts distinct prior dates in the trailing window, and based on count,
 * returns the multiplier that should be applied to the entire day's worked hours.
 */
export function consecutiveDayMultiplier(
  snapshot: ContractSnapshot,
  context: ConsecutiveDayContext
): number {
  const window = snapshot.consecutive_day_window_days;
  const otThreshold = snapshot.consecutive_day_ot_threshold;
  const dtThreshold = snapshot.consecutive_day_dt_threshold;
  
  if (otThreshold == null && dtThreshold == null) return 1.0;
  
  // Worked days in trailing window (prior dates only — today is the gig being evaluated)
  const workedDays = context.prior_worked_dates.length;
  const todayCount = workedDays + 1; // +1 for today's gig
  
  if (dtThreshold != null && todayCount >= dtThreshold) {
    return snapshot.consecutive_day_dt_multiplier;
  }
  if (otThreshold != null && todayCount >= otThreshold) {
    return snapshot.consecutive_day_ot_multiplier;
  }
  return 1.0;
}
