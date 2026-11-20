import { describe, it, expect } from 'vitest';
import { byMarket, layoutNetwork, marketOf, NO_COMPANY, NO_MARKET, placeQuery, telHref, type NetworkContact } from './network';

const person = (id: string, company?: string): NetworkContact => ({ id, name: 'P' + id, company, createdAt: 'x' });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('the network map', () => {
  it('puts each company around you, and its people around it', () => {
    const l = layoutNetwork([person('1', 'Odeum'), person('2', 'Odeum'), person('3', 'PSS'), person('4')]);
    expect(l.companies.map(c => c.name)).toEqual(['Odeum', 'PSS', NO_COMPANY]);
    expect(l.companies.find(c => c.name === 'Odeum')?.people).toBe(2);
    expect(l.people).toHaveLength(4);
  });

  it('keeps people off each other, off the company labels, and away from you', () => {
    const contacts = [
      ...Array.from({ length: 9 }, (_, i) => person('o' + i, 'Odeum')),
      ...Array.from({ length: 3 }, (_, i) => person('p' + i, 'PSS')),
      person('x'), person('y', 'Freeman'),
    ];
    const l = layoutNetwork(contacts);
    for (let i = 0; i < l.people.length; i++) {
      expect(dist(l.people[i], l.you)).toBeGreaterThan(120);
      for (const co of l.companies) expect(dist(l.people[i], co)).toBeGreaterThan(90);
      for (let j = i + 1; j < l.people.length; j++) expect(dist(l.people[i], l.people[j])).toBeGreaterThan(70);
    }
    for (let i = 0; i < l.companies.length; i++)
      for (let j = i + 1; j < l.companies.length; j++) expect(dist(l.companies[i], l.companies[j])).toBeGreaterThan(160);
  });

  it('fits everything in its box', () => {
    const l = layoutNetwork([person('1', 'A'), person('2', 'B'), person('3', 'C')]);
    for (const p of [...l.people, ...l.companies, l.you]) {
      expect(p.x).toBeGreaterThan(l.box.x);
      expect(p.y).toBeGreaterThan(l.box.y);
      expect(p.x).toBeLessThan(l.box.x + l.box.width);
      expect(p.y).toBeLessThan(l.box.y + l.box.height);
    }
  });

  it('dials a number as typed', () => {
    expect(telHref('(415) 555-0101')).toBe('tel:4155550101');
    expect(telHref('+1 415 555 0101')).toBe('tel:+14155550101');
  });
});

describe('markets', () => {
  it('names a market by city and state, or what there is', () => {
    expect(marketOf({ city: 'San Francisco', region: 'CA', country: 'USA' })).toBe('San Francisco, CA');
    expect(marketOf({ city: 'London', country: 'UK' })).toBe('London, UK');
    expect(marketOf({ region: 'PA' })).toBe('PA');
    expect(marketOf({})).toBe(NO_MARKET);
    expect(placeQuery({ city: ' Philadelphia ', region: 'PA', country: '' })).toBe('Philadelphia, PA');
  });

  it('groups everyone by market, biggest first, unknown last', () => {
    const c = (id: string, city?: string, region?: string): NetworkContact => ({ id, name: id, city, region, createdAt: 'x' });
    const groups = byMarket([c('a'), c('b', 'Philadelphia', 'PA'), c('c', 'San Francisco', 'CA'), c('d', 'San Francisco', 'CA')]);
    expect(groups.map(g => [g.market, g.people.length])).toEqual([['San Francisco, CA', 2], ['Philadelphia, PA', 1], [NO_MARKET, 1]]);
  });
});
