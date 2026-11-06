import { describe, it, expect } from 'vitest';
import { findLikelyDuplicate, isDuplicateJob, jobKey } from './jobDedup';

const shift = (role?: string, extra: Record<string, string> = {}) => ({ name: 'Gala', client: 'Odeum', date: '2026-11-04', role, ...extra });

describe('one job, written two ways', () => {
  it('reads a bare code with the year of its date', () => {
    expect(jobKey('2705', '2026-08-22')).toBe('2026-2705');
    expect(jobKey('2026-2705', '2026-08-22')).toBe('2026-2705');
    expect(jobKey(' 496 ', '2026-02-21')).toBe('2026-0496');
    expect(jobKey(undefined, '2026-02-21')).toBe('');
  });

  it('catches the same shift under either form', () => {
    const shortForm = shift(undefined, { jobNumber: '2705', startTime: '1:00 PM' });
    const longForm = shift(undefined, { jobNumber: '2026-2705', startTime: '01:00 PM' });
    expect(isDuplicateJob(longForm, [shortForm])).toBe(true);
    expect(findLikelyDuplicate(longForm, [shortForm])).toBe(shortForm);
  });
});

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
