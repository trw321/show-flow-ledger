import { describe, it, expect } from 'vitest';
import { readStubHoliday } from './holidayLearning';
import { holidayTermsFor } from './holidayTerms';
import { jobHolidayPay, jobPayBreakdown } from './payCalc';
import { withContractRule } from './premiums';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import type { Job } from './store';

const civic = (over: Partial<Job>): Job => ({
  id: 'x', name: 'SHOW', client: 'BGCA MANAGEMENT LLC', venue: 'Civic Auditorium', contract: 'BGCA CONCERTS&COMEDY20242029',
  jobNumber: '2026-4250', date: '2026-11-25', startTime: '10:00 PM', endTime: '1:30 AM', hoursWorked: 3.5, hourlyRate: 43.72,
  status: 'completed', has6th7thDayRule: false, notes: '', createdAt: 'x', ...over,
} as Job);

const lacy = civic({ id: 'lacy', name: 'STEVE LACY' });
const christmas = civic({ id: 'xmas', name: 'XMAS SHOW', date: '2025-12-25', startTime: '6:00 PM', endTime: '11:00 PM', hoursWorked: 5 });
const pay = (j: Job, payer: PayerProfile = EMPTY_PROFILE) => Math.round(jobPayBreakdown(j, [j], [], payer).gross * 100) / 100;

describe('holiday pay, learned from pay stubs', () => {
  it('counts what the app pays on Thanksgiving as holiday pay: 1.5h × ½ × $43.72', () => {
    expect(jobHolidayPay(lacy, [lacy], [], EMPTY_PROFILE)).toBeCloseTo(32.79, 2);
  });

  it('agrees with a stub that paid the same Thanksgiving holiday pay', () => {
    const f = readStubHoliday({ holidayAmount: 32.79 }, [lacy], [lacy], [], EMPTY_PROFILE);
    expect(f).toEqual({ kind: 'agrees', stubAmount: 32.79, appAmount: 32.79 });
  });

  it('learns Christmas when a stub pays holiday on Dec 25 at the Civic, which only knew Thanksgiving', () => {
    const f = readStubHoliday({ holidayAmount: 109.3 }, [christmas], [christmas], [], EMPTY_PROFILE);
    expect(f).toMatchObject({ kind: 'learn', holiday: 'christmas', name: 'Christmas', date: '2025-12-25', ruleName: 'BGCA CONCERTS&COMEDY20242029', extraKnown: true });
    // Before: no holiday pay on Christmas. Saved on the contract: ½ on top of its 5 hours.
    expect(pay(christmas)).toBe(Math.round(5 * 43.72 * 100) / 100);
    const learned = withContractRule(EMPTY_PROFILE, 'BGCA CONCERTS&COMEDY20242029', { holidays: ['christmas'] });
    expect(pay(christmas, learned)).toBe(Math.round(5 * 1.5 * 43.72 * 100) / 100);
    expect(readStubHoliday({ holidayAmount: 109.3 }, [christmas], [christmas], [], learned)).toEqual({ kind: 'agrees', stubAmount: 109.3, appAmount: 109.3 });
  });

  it('learns a holiday on a contract with no holiday pay yet, saying it has no extra of its own', () => {
    const moscone = civic({ id: 'm', client: 'FREEMAN AUDIO VISUAL SOLUTIONS INC', venue: 'Moscone', contract: '2023-2028 BASIC BREAKOUT', date: '2026-11-26', startTime: '8:00 AM', endTime: '4:00 PM', hoursWorked: 8, hourlyRate: 57.39 });
    expect(readStubHoliday({ holidayAmount: 229.56 }, [moscone], [moscone], [], EMPTY_PROFILE))
      .toMatchObject({ kind: 'learn', holiday: 'thanksgiving', ruleName: '2023-2028 BASIC BREAKOUT', extraKnown: false });
    // Saved with the Civic's half on top, it pays it.
    const learned = withContractRule(EMPTY_PROFILE, '2023-2028 BASIC BREAKOUT', { holidays: ['thanksgiving'], holidayExtra: 0.5 });
    expect(jobHolidayPay(moscone, [moscone], [], learned)).toBeCloseTo(8 * 0.5 * 57.39, 2);
  });

  it('flags holiday pay the app counted but the stub doesn\'t show', () => {
    expect(readStubHoliday({ holidayAmount: null }, [lacy], [lacy], [], EMPTY_PROFILE)).toEqual({ kind: 'missing', appAmount: 32.79 });
  });

  it('says so when a stub pays holiday on days that aren\'t holidays the app knows', () => {
    const ordinary = civic({ id: 'o', date: '2026-11-20', startTime: '8:00 PM', endTime: '11:00 PM', hoursWorked: 3 });
    expect(readStubHoliday({ holidayAmount: 40 }, [ordinary], [ordinary], [], EMPTY_PROFILE)).toEqual({ kind: 'unplaced', stubAmount: 40 });
  });

  it('says nothing for a stub read before stubs were asked about holidays, or with no holiday on either side', () => {
    expect(readStubHoliday({ grossPay: 251.39 }, [lacy], [lacy], [], EMPTY_PROFILE)).toBeNull();
    const ordinary = civic({ id: 'o', date: '2026-11-20' });
    expect(readStubHoliday({ holidayAmount: null }, [ordinary], [ordinary], [], EMPTY_PROFILE)).toBeNull();
  });

  it('ignores junk saved on a contract\'s holidays', () => {
    const junk = withContractRule(EMPTY_PROFILE, 'BGCA CONCERTS&COMEDY20242029', { holidays: ['nonsense', 7, 'christmas'] as never, holidayExtra: -3 });
    const terms = holidayTermsFor(christmas, undefined, junk);
    expect(terms?.keys).toEqual(['thanksgiving', 'christmas']);
    expect(terms?.extra).toBe(0.5);
  });
});

describe('saving a learned holiday', () => {
  it('adds it to the contract once, keeping what was saved, and the Civic\'s half for a contract with none', async () => {
    const { learnHoliday } = await import('./holidayLearning');
    const start: PayerProfile = { locals: [], contractRules: [{ name: 'BGCA CONCERTS&COMEDY20242029', holidays: ['newYearsDay'] }] };
    const finding = { kind: 'learn' as const, holiday: 'christmas' as const, name: 'Christmas', date: '2025-12-25', ruleName: 'bgca concerts&comedy20242029', stubAmount: 1, appAmount: 0, extraKnown: true };
    const once = learnHoliday(start, finding);
    expect(once.contractRules).toEqual([{ name: 'BGCA CONCERTS&COMEDY20242029', holidays: ['newYearsDay', 'christmas'] }]);
    expect(learnHoliday(once, finding).contractRules?.[0].holidays).toEqual(['newYearsDay', 'christmas']);
    const fresh = learnHoliday(EMPTY_PROFILE, { ...finding, ruleName: '2023-2028 BASIC BREAKOUT', extraKnown: false });
    expect(fresh.contractRules).toEqual([{ name: '2023-2028 BASIC BREAKOUT', holidays: ['christmas'], holidayExtra: 0.5 }]);
  });
});
