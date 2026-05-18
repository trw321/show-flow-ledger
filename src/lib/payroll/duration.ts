// /lib/payroll/duration.ts

/**
 * Calculate worked hours from start/end timestamps minus break.
 * Handles overnight shifts (end < start = crossed midnight).
 */
export function calculateDuration(
  start: Date,
  end: Date,
  breakMinutes: number,
  mealsOnClock: boolean
): number {
  let ms = end.getTime() - start.getTime();
  if (ms < 0) ms += 24 * 60 * 60 * 1000; // overnight
  
  const hours = ms / (1000 * 60 * 60);
  
  if (mealsOnClock) {
    return round2(hours); // break time still paid
  }
  
  return Math.max(0, round2(hours - breakMinutes / 60));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
