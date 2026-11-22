import { describe, it, expect } from 'vitest';
import { EMPLOYER_COLOURS, employerColours } from './employerColours';

const [teal, pink, lime, white, orange, periwinkle] = EMPLOYER_COLOURS;

describe('each employer\'s colour', () => {
  it('goes out in the order they were first worked for', () => {
    const c = employerColours(['Odeum', 'PSS', 'Roar'], ['Roar', 'PSS', 'Odeum']);
    expect([c.get('odeum'), c.get('pss'), c.get('roar')]).toEqual([teal, pink, lime]);
  });

  it('stays the same whoever else is in the month', () => {
    const order = ['Odeum', 'PSS', 'Roar', 'Clair'];
    expect(employerColours(order, ['Roar']).get('roar')).toBe(lime);
    expect(employerColours(order, ['Roar', 'Clair']).get('roar')).toBe(lime);
  });

  it('is the same however the name is typed', () => {
    const c = employerColours(['Odeum'], ['  ODEUM ']);
    expect(c.get('odeum')).toBe(teal);
  });

  it('never shares while a colour is free', () => {
    // The 1st and 7th employers would both be teal.
    const order = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const c = employerColours(order, ['G', 'A']);
    expect(c.get('a')).toBe(teal);
    expect(c.get('g')).toBe(pink);
  });

  it('reuses colours once there are more employers than colours', () => {
    const order = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const c = employerColours(order, order);
    expect(new Set(c.values()).size).toBe(EMPLOYER_COLOURS.length);
    expect([c.get('e'), c.get('f')]).toEqual([orange, periwinkle]);
    expect(c.get('d')).toBe(white);
  });

  it('gives one it has never seen a colour too', () => {
    expect(employerColours([], ['New Co']).get('new co')).toBe(teal);
  });
});
