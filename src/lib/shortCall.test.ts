import { describe, it, expect } from 'vitest';
import { shortCall } from './shortCall';

describe('a call time, short', () => {
  it('drops the minutes on the hour and keeps them otherwise', () => {
    expect(shortCall('8:00 AM')).toBe('8a');
    expect(shortCall('7:30 PM')).toBe('7:30p');
    expect(shortCall('12:00 PM')).toBe('12p');
    expect(shortCall('6 am')).toBe('6a');
    expect(shortCall('11:45p.m.')).toBe('11:45p');
  });

  it('reads a 24-hour time', () => {
    expect(shortCall('06:00')).toBe('6a');
    expect(shortCall('00:30')).toBe('12:30a');
    expect(shortCall('18:15')).toBe('6:15p');
  });

  it('leaves out what is not a time', () => {
    expect(shortCall(undefined)).toBe('');
    expect(shortCall('')).toBe('');
    expect(shortCall('TBA')).toBe('');
    expect(shortCall('Nov 5')).toBe('');
    expect(shortCall('13:00 PM')).toBe('');
    expect(shortCall('25:00')).toBe('');
  });
});
