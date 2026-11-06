import { describe, it, expect } from 'vitest';
import { findLikelyDuplicate, isDuplicateJob } from './jobDedup';

const shift = (role?: string, extra: Record<string, string> = {}) => ({ name: 'Gala', client: 'Odeum', date: '2026-11-04', role, ...extra });

describe('two roles on one day', () => {
  it('saves both, at different pay', () => {
    expect(isDuplicateJob(shift('A2'), [shift('A1')])).toBe(false);
    expect(isDuplicateJob(shift('A2', { jobNumber: 'G-1' }), [shift('A1', { jobNumber: 'G-1' })])).toBe(false);
    expect(isDuplicateJob(shift('A2', { startTime: '8:00 AM' }), [shift('A1', { startTime: '8:00 AM' })])).toBe(false);
  });

  it('does not call them likely duplicates either', () => {
    expect(findLikelyDuplicate(shift('A2'), [shift('A1')])).toBeUndefined();
    expect(findLikelyDuplicate(shift('A2', { jobNumber: 'G-1' }), [shift('A1', { jobNumber: 'G-1' })])).toBeUndefined();
  });

  it('still catches the same role twice', () => {
    expect(isDuplicateJob(shift('A1'), [shift('a1 ')])).toBe(true);
    expect(findLikelyDuplicate(shift('A1'), [shift('A1')])).toBeDefined();
  });

  it('still catches a dispatch brought in again, with a role picked since', () => {
    const picked = shift('A1', { jobNumber: 'G-1' });
    expect(isDuplicateJob(shift(undefined, { jobNumber: 'G-1' }), [picked])).toBe(true);
    expect(findLikelyDuplicate(shift(undefined, { jobNumber: 'G-1' }), [picked])).toBe(picked);
  });
});
