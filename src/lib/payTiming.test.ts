import { describe, it, expect } from 'vitest';
import { payDueDate, payTimingTier, payLagDays, DEFAULT_LAG_DAYS } from './payTiming';
import type { Employer } from './store';

const employer = (over: Partial<Employer> = {}): Employer => ({ id: 'e', name: 'Odeum', overtimeRule: 'daily', createdAt: 'x', ...over });

describe('when pay is due', () => {
  it('waits three weeks when nobody has said how they pay', () => {
    expect(payLagDays(undefined)).toBe(DEFAULT_LAG_DAYS);
    expect(payDueDate('2026-10-01', employer())).toBe('2026-10-22');
  });

  it('expects a weekly check within the next week', () => {
    expect(payDueDate('2026-10-05', employer({ paySchedule: 'weekly' }))).toBe('2026-10-17');
  });

  it('gives bi-weekly the fortnight', () => {
    expect(payDueDate('2026-10-05', employer({ paySchedule: 'bi-weekly' }))).toBe('2026-10-24');
  });

  it('takes the days typed for any other schedule', () => {
    expect(payDueDate('2026-10-05', employer({ payLagDays: 30 }))).toBe('2026-11-04');
  });

  it('holds the first weeks to the first check', () => {
    const odeum = employer({ paySchedule: 'weekly', firstCheckWeeks: 3 });
    // Started Oct 1: the first check is Oct 22, and covers the first week's work.
    expect(payDueDate('2026-10-03', odeum, '2026-10-01')).toBe('2026-10-22');
    // Work after that is on the weekly schedule.
    expect(payDueDate('2026-10-26', odeum, '2026-10-01')).toBe('2026-11-07');
  });
});

describe('how worried to be', () => {
  it('says nothing before it is due', () => expect(payTimingTier(-1)).toBe('none'));
  it('watches from the day it is due', () => expect(payTimingTier(0)).toBe('watching'));
  it('warms after three weeks late', () => expect(payTimingTier(21)).toBe('warm'));
  it('blazes after six', () => expect(payTimingTier(42)).toBe('blazing'));
});
