// /lib/payroll/premiums.ts
import type { ContractSnapshot } from '@/types/contracts';
import type { ConsecutiveDayContext } from './types';

/**
 * Is the given wall-clock time inside the night premium window?
 * Window: [start_hour, end_hour). E.g. 0-8 = midnight to 8 AM.
 *
 * Takes a Date (not an hour integer) so fractional times work correctly —
 * a worked minute at 7:59 AM is in the window, 8:00 AM is not.
 */
export function isInNightWindow(
  wallClock: Date,
  snapshot: ContractSnapshot
): boolean {
  const start = snapshot.night_premium_start_hour;
  const end = snapshot.night_premium_end_hour;
  if (start == null || end == null) return false;

  const decimalHour = wallClock.getHours() + wallClock.getMinutes() / 60;

  // Same-day window (e.g. 0-8): decimalHour in [start, end)
  // Wrapping window (e.g. 22-8): decimalHour >= start OR decimalHour < end
  if (start < end) {
    return decimalHour >= start && decimalHour < end;
  } else {
    return decimalHour >= start || decimalHour < end;
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
