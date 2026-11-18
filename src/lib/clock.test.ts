import { describe, it, expect } from 'vitest';
import { clockSpanHours, endAfterStart, clockMinutes } from './clock';
import { calculateNightHours, effectiveHoursWorked } from './payCalc';
import type { Job } from './store';

describe('reading a call\'s times', () => {
  it('reads a bare 8 to 5 as 8 AM to 5 PM', () => {
    expect(clockSpanHours('8', '5')).toBe(9);
    expect(endAfterStart(clockMinutes('8'), '5')).toBe(17 * 60);
  });

  it('keeps what an am or pm says', () => {
    expect(clockSpanHours('10:00 PM', '2:00 AM')).toBe(4);
    expect(clockSpanHours('8:00 AM', '5a')).toBe(21);
    expect(clockSpanHours('8', '7p')).toBe(11);
  });

  it('reads a 24-hour clock as written', () => {
    expect(clockSpanHours('08:00 AM', '18')).toBe(10);
  });

  it('runs a bare end over midnight only when that is the nearer reading', () => {
    expect(clockSpanHours('11:30 PM', '2')).toBe(2.5);
    expect(clockSpanHours('1:00 PM', '12')).toBe(11);
    expect(clockSpanHours('8', '12')).toBe(4);
  });

  it('gives no night premium to a bare 8 to 5', () => {
    expect(calculateNightHours('8', '5', 0)).toBe(0);
  });

  it('gives a day with only times its clock span, read the same way', () => {
    const job = { id: 'x', name: 'x', client: 'x', venue: '', date: '2026-09-14', status: 'completed', notes: '', has6th7thDayRule: false, createdAt: 'x', startTime: '8', endTime: '5' } as Job;
    expect(effectiveHoursWorked(job)).toBe(9);
  });
});
