import { describe, expect, it } from 'vitest';
import { roundHours } from './hoursFormat';

describe('hours as shown', () => {
  it('keeps up to three decimals and drops trailing zeros', () => {
    expect(String(roundHours(7 / 3))).toBe('2.333');
    expect(String(roundHours(7.25))).toBe('7.25');
    expect(String(roundHours(7.5))).toBe('7.5');
    expect(String(roundHours(61))).toBe('61');
    expect(String(roundHours(0.0166666))).toBe('0.017');
  });

  it('shows nothing strange for a bad stored value', () => {
    expect(roundHours(Number.NaN)).toBe(0);
    expect(roundHours(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
