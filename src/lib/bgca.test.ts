import { describe, it, expect } from 'vitest';
import { holidayTermsFor, isBgcaShift } from './bgca';
import { HOLIDAYS, holidayOn } from './holidays';
import { billedHours, billingStepHours, breakTheHourLabel, breaksTheHour } from './local16';
import { calculateDayPay, jobHoursBreakdown, jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE } from './payerProfile';
import { premiumStartHours } from './premiums';
import type { Job } from './store';

// Steve Lacy at the Civic Auditorium, the night before Thanksgiving 2026, as it was saved.
const lacy = {
  id: 'lacy', name: 'STEVE LACY', role: 'A BACKLINE', client: 'BGCA MANAGEMENT LLC', venue: 'Civic Auditorium',
  contract: 'BGCA CONCERTS&COMEDY20242029', jobNumber: '2026-4250', date: '2026-11-25',
  startTime: '10:00 PM', endTime: '1:30 AM', hoursWorked: 3.5, hourlyRate: 43.72, status: 'completed',
  payrollCompany: 'THE TALENT FUND, LLC', has6th7thDayRule: false, mealPenalties: 0, notes: '', createdAt: 'x',
} as Job;
const pay = (job: Job, all: Job[] = [job]) => jobPayBreakdown(job, all, [], EMPTY_PROFILE);
const cents = (n: number) => Math.round(n * 100) / 100;

describe('the Civic Auditorium (Bill Graham)', () => {
  it('is known by its contract, or by the venue when the dispatch names none', () => {
    expect(isBgcaShift(lacy)).toBe(true);
    expect(isBgcaShift({ venue: 'Civic Auditorium' })).toBe(true);
    expect(isBgcaShift({ venue: 'Bill Graham Civic Auditorium' })).toBe(true);
    expect(isBgcaShift({ venue: 'BGCA' })).toBe(true);
  });

  it('is not other work, or another city\'s civic auditorium', () => {
    expect(isBgcaShift({ venue: 'Moscone North/South', contract: '2023-2028 BASIC BREAKOUT' })).toBe(false);
    expect(isBgcaShift({ venue: 'Pasadena Civic Auditorium' })).toBe(false);
    // A shift there under another named contract goes by that contract.
    expect(isBgcaShift({ venue: 'Civic Auditorium', contract: '2023-2028 BASIC ENTERTAINMENT' })).toBe(false);
  });

  it('breaks the half hour, not the hour, though it is a Local 16 dispatch', () => {
    expect(billingStepHours(lacy)).toBe(0.5);
    expect(breaksTheHour(lacy)).toBe(false);
    expect(breakTheHourLabel(lacy)).toBe('Civic Auditorium · breaks the half hour');
    // The rest of Local 16 still breaks the hour.
    expect(billingStepHours({ jobNumber: '2026-3926' })).toBe(1);
    expect(billedHours(3 + 10 / 60, 0.5)).toBe(3.5);
    expect(billedHours(3 + 40 / 60, 0.5)).toBe(4);
    expect(billedHours(3.5, 0.5)).toBe(3.5);
    expect(billedHours(3 + 10 / 60, 1)).toBe(4);
  });

  it('pays a part half hour as a whole one: 3h10m is 3.5, where other Local 16 work pays 4', () => {
    const short = { ...lacy, id: 'short', date: '2026-11-20', startTime: '8:00 PM', endTime: '11:10 PM', hoursWorked: 3 + 10 / 60 };
    expect(cents(pay(short).gross)).toBe(cents(3.5 * 43.72));
    const elsewhere = { ...short, venue: 'Moscone North/South', contract: '2023-2028 BASIC BREAKOUT' };
    expect(cents(pay(elsewhere).gross)).toBe(cents(4 * 43.72));
  });

  it('knows Thanksgiving, and only Thanksgiving so far', () => {
    expect(HOLIDAYS.thanksgiving.on(2026)).toBe('2026-11-26');
    expect(HOLIDAYS.thanksgiving.on(2027)).toBe('2027-11-25');
    expect(holidayTermsFor(lacy)?.holidayOn('2026-11-26')).toBe('Thanksgiving');
    expect(holidayTermsFor(lacy)?.holidayOn('2026-12-25')).toBeUndefined();
    expect(holidayTermsFor({ venue: 'Moscone North/South', contract: '2023-2028 BASIC BREAKOUT' })).toBeNull();
  });

  it('works out the other holidays\' dates right, for when the contract names them', () => {
    expect(HOLIDAYS.mlkDay.on(2026)).toBe('2026-01-19');
    expect(HOLIDAYS.presidentsDay.on(2026)).toBe('2026-02-16');
    expect(HOLIDAYS.memorialDay.on(2026)).toBe('2026-05-25');
    expect(HOLIDAYS.laborDay.on(2026)).toBe('2026-09-07');
    expect(HOLIDAYS.dayAfterThanksgiving.on(2026)).toBe('2026-11-27');
    expect(holidayOn('2026-12-25', ['christmas'])).toBe('Christmas');
    expect(holidayOn('Nov 5', ['thanksgiving'])).toBeUndefined();
  });

  it('pays last night after midnight at 2× plus ½ for Thanksgiving: 2.5×', () => {
    // 10 PM to midnight is Wednesday, straight time. Midnight to 1:30 AM is
    // Thanksgiving and night premium: 2× + ½ = 2.5×.
    const hours = jobHoursBreakdown(lacy, [lacy], [], EMPTY_PROFILE);
    expect(hours.straight).toBe(2);
    expect(hours.night).toBe(1.5);
    expect(hours.holiday).toBe(1.5);
    expect(hours.minimum).toBe(0);
    expect(cents(pay(lacy).gross)).toBe(cents(2 * 43.72 + 1.5 * 2.5 * 43.72));
    expect(cents(pay(lacy).gross)).toBe(251.39);
  });

  it('pays a whole day on the holiday ½ on top of every hour, overtime included', () => {
    const day = { ...lacy, id: 'day', date: '2026-11-26', startTime: '10:00 AM', endTime: '8:00 PM', hoursWorked: 10 };
    // 8 straight at 1.5×, 2 overtime at 2×.
    expect(cents(pay(day).gross)).toBe(cents(8 * 1.5 * 43.72 + 2 * 2 * 43.72));
    const notHoliday = { ...day, date: '2026-11-19' };
    expect(cents(pay(notHoliday).gross)).toBe(cents(8 * 43.72 + 2 * 1.5 * 43.72));
  });

  it('adds nothing on a holiday at other venues, whose holidays aren\'t known', () => {
    const moscone = { ...lacy, id: 'm', venue: 'Moscone North/South', contract: '2023-2028 BASIC BREAKOUT', date: '2026-11-26', startTime: '10:00 AM', endTime: '2:00 PM', hoursWorked: 4 };
    expect(jobHoursBreakdown(moscone, [moscone], [], EMPTY_PROFILE).holiday).toBe(0);
    expect(cents(pay(moscone).gross)).toBe(cents(4 * 43.72));
  });

  it('gives padding no holiday pay: only hours worked get it', () => {
    const short = { ...lacy, id: 'p', date: '2026-11-26', startTime: '10:00 AM', endTime: '12:00 PM', hoursWorked: 2, minimumHours: 4 };
    // 2 worked at 1.5×, 2 padding at straight time.
    expect(cents(pay(short).gross)).toBe(cents(2 * 1.5 * 43.72 + 2 * 43.72));
  });

  it('counts early premium hours by the half hour too', () => {
    const call = { startTime: '6:40 AM', endTime: '11:00 AM' };
    expect(premiumStartHours(call, 7, 0.5)).toBe(0.5);
    expect(premiumStartHours(call, 7, 1)).toBe(1);
    expect(premiumStartHours(call, 7, 0)).toBeCloseTo(1 / 3);
  });

  it('lets a half-hour step win over breaking the hour in the day pay', () => {
    const r = calculateDayPay(3.25, 40, 0, 0, 1, undefined, { roundUpToWholeHours: true, billingStepHours: 0.5 });
    expect(r.billableHours).toBe(3.5);
    expect(calculateDayPay(3.25, 40, 0, 0, 1, undefined, { roundUpToWholeHours: true }).billableHours).toBe(4);
  });
});
