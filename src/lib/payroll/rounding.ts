// /lib/payroll/rounding.ts

import type { RoundingMode } from '@/types/contracts';

/**
 * Round time up to the next whole hour for union contracts.
 * 6.0  → 6
 * 6.1  → 7
 * 8.99 → 9
 * 0    → 0
 */
export function roundUpToHour(hours: number): number {
  if (hours <= 0) return 0;
  return Math.ceil(hours);
}

export function applyRounding(hours: number, mode: RoundingMode): number {
  if (mode === 'hour_up') return roundUpToHour(hours);
  return hours;
}
