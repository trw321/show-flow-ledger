import { describe, it, expect } from 'vitest';
import { parseCopyRequest } from './copyRequest';
import type { Job } from './store';

// Thursday 22 October 2026, mid-afternoon.
const now = new Date(2026, 9, 22, 15, 0);

const shift = (id: string, date: string, client = 'Odeum', start = '08:00 AM'): Job => ({
  id, name: 'Corporate', client, venue: 'Hall', date, startTime: start, endTime: '05:00 PM',
  status: 'completed', notes: '', createdAt: 'x',
} as Job);

describe('copying a shift that is already logged', () => {
  const jobs = [shift('mon', '2026-10-19'), shift('other', '2026-10-20', 'Blackpoint')];

  it('copies Monday’s Odeum shift to today and yesterday', () => {
    const r = parseCopyRequest('add to today and yesterday the same odeum shift i logged on monday', jobs, now);
    expect(r?.sources.map(j => j.id)).toEqual(['mon']);
    expect(r?.dates).toEqual(['2026-10-21', '2026-10-22']);
  });

  it('reads it the other way round too', () => {
    const r = parseCopyRequest("copy monday's odeum shift to tomorrow", jobs, now);
    expect(r?.sources.map(j => j.id)).toEqual(['mon']);
    expect(r?.dates).toEqual(['2026-10-23']);
  });

  it('uses the employer named to pick the shift', () => {
    const r = parseCopyRequest('same blackpoint shift as tuesday, today', jobs, now);
    expect(r?.sources.map(j => j.id)).toEqual(['other']);
    expect(r?.dates).toEqual(['2026-10-22']);
  });

  it('copies every call of a split day', () => {
    const split = [shift('am', '2026-10-19'), shift('pm', '2026-10-19', 'Odeum', '06:00 PM')];
    const r = parseCopyRequest('same odeum shift as monday for 10/24', split, now);
    expect(r?.sources.map(j => j.id).sort()).toEqual(['am', 'pm']);
    expect(r?.dates).toEqual(['2026-10-24']);
  });

  it('is not a dispatch offer', () => {
    expect(parseCopyRequest('Odeum 10/24 8am-5pm Hall, $52/hr', jobs, now)).toBeNull();
  });

  it('gives up when no named day has that shift', () => {
    expect(parseCopyRequest('same odeum shift as friday for today', jobs, now)).toBeNull();
  });
});
