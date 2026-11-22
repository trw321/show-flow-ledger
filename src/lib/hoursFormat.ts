/**
 * Hours as shown: to at most three decimal places, with no trailing zeros
 * (2.333, 7.5, 61). Never cut to one or two places, which hid minutes
 * (7.25 showing as 7.3), and never the long tail of a division
 * (2.3333333333). The pay maths keeps the full number; this is for showing
 * it, and for filling an hours box.
 */
export function roundHours(hours: number): number {
  if (!Number.isFinite(hours)) return 0;
  return Math.round(hours * 1000) / 1000;
}
