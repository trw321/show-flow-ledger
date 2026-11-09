import { describe, it, expect } from 'vitest';
import { calculateDayPay, dayMultiplierFor, dayPremiumLabel, jobPayBreakdown } from './payCalc';
import { parseDayTimeline, COMPOSITE_LUNCH_AFTER_HOURS } from './dayTimeline';
import { EMPTY_PROFILE } from './payerProfile';
import type { Employer, Job } from './store';

// Nov 7 2026 is a Saturday, Nov 8 a Sunday, Nov 2 a Monday.
const shift = (date: string, hours: number, extra: Partial<Job> = {}): Job => ({
  id: date, name: 'Ignite', client: 'Odeum', venue: 'Moscone', date, status: 'completed',
  hoursWorked: hours, hourlyRate: 50, has6th7thDayRule: false, notes: '', createdAt: 'x', ...extra,
} as Job);
const odeum = { id: 'e', name: 'Odeum', overtimeRule: 'daily', createdAt: 'x' } as Employer;
const gross = (job: Job, all: Job[] = [job]) => jobPayBreakdown(job, all, [odeum], EMPTY_PROFILE).gross;

describe('a composite team weekend', () => {
  it('pays a Saturday at time and a half, every hour', () => {
    expect(gross(shift('2026-11-07', 10, { compositeTeam: true }))).toBe(750);
    // Not composite: eight straight, two at time and a half.
    expect(gross(shift('2026-11-07', 10))).toBe(550);
  });

  it('keeps double time past twelve on a Saturday: the higher of the two', () => {
    // Twelve at 1.5×, one at the ladder's own 2×.
    expect(gross(shift('2026-11-07', 13, { compositeTeam: true }))).toBe(1000);
  });

  it('pays a Sunday at double time, every hour', () => {
    expect(gross(shift('2026-11-08', 10, { compositeTeam: true }))).toBe(1000);
  });

  it('changes nothing on a weekday', () => {
    expect(gross(shift('2026-11-02', 10, { compositeTeam: true }))).toBe(550);
  });

  it("doesn't multiply with a 7th day in a row", () => {
    const run = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
      .map(d => shift(d, 8, { compositeTeam: true, has6th7thDayRule: true }));
    expect(dayMultiplierFor(run[6], odeum, run)).toBe(2);
  });

  it('says why in the breakdown', () => {
    const sat = shift('2026-11-07', 8, { compositeTeam: true });
    expect(dayPremiumLabel(sat, odeum, [sat])).toBe('composite Saturday');
    const r = calculateDayPay(8, 50, 0, 0, 1.5, undefined, { dayPremiumLabel: dayPremiumLabel(sat, odeum, [sat]) });
    expect(r.breakdown[0]).toBe('Day multiplier: 1.5× (composite Saturday)');
    expect(dayPremiumLabel(shift('2026-11-09', 8, { compositeTeam: true }), odeum, [])).toBeUndefined();
  });

  it('survives a date that is not a real one', () => {
    expect(dayMultiplierFor(shift('Nov 7', 8, { compositeTeam: true }), odeum, [])).toBe(1);
  });
});

describe('a composite team lunch', () => {
  it('owes a penalty past four hours unfed, not five', () => {
    expect(parseDayTimeline('9a-2p', [], COMPOSITE_LUNCH_AFTER_HOURS)!.suggestedMealPenalties).toBe(1);
    expect(parseDayTimeline('9a-2p')!.suggestedMealPenalties).toBe(0);
  });

  it('owes nothing when lunch comes at four', () => {
    expect(parseDayTimeline('9a-1p, 1:30p-5p', [], COMPOSITE_LUNCH_AFTER_HOURS)!.suggestedMealPenalties).toBe(0);
  });
});
