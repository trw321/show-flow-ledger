import { describe, it, expect } from 'vitest';
import { weekSpans, type DayProject } from './projectSpans';

const odeum: DayProject = { key: 'p1', name: 'Odeum' };
const pss: DayProject = { key: 'p2', name: 'PSS' };
const none: DayProject[] = [];
const week = (...days: DayProject[][]) => days;

describe('the employer over a project\'s days', () => {
  it('is one label across a run, not one a day', () => {
    const { spans, levels } = weekSpans(week(none, none, none, [odeum], [odeum], [odeum], none, none, none));
    expect(spans).toEqual([{ key: 'p1', name: 'Odeum', from: 2, to: 4, openLeft: false, openRight: false, level: 0 }]);
    expect(levels).toBe(1);
  });

  it('starts again after a day off', () => {
    const { spans } = weekSpans(week(none, [odeum], none, [odeum], none, none, none, none, none));
    expect(spans.map(s => [s.from, s.to])).toEqual([[0, 0], [2, 2]]);
  });

  it('leaves an end open when the run carries on past the week', () => {
    const { spans } = weekSpans(week([odeum], [odeum], [odeum], none, none, none, [pss], [pss], [pss]));
    expect(spans.find(s => s.key === 'p1')).toMatchObject({ from: 0, to: 1, openLeft: true, openRight: false });
    expect(spans.find(s => s.key === 'p2')).toMatchObject({ from: 5, to: 6, openLeft: false, openRight: true });
  });

  it('stacks two projects on the same day', () => {
    const { spans, levels } = weekSpans(week(none, [odeum], [odeum, pss], [pss], none, none, none, none, none));
    expect(spans.map(s => [s.name, s.level])).toEqual([['Odeum', 0], ['PSS', 1]]);
    expect(levels).toBe(2);
  });

  it('reuses the top row once it is free', () => {
    const { spans, levels } = weekSpans(week(none, [odeum], [odeum, pss], [pss], [pss], [{ key: 'p3', name: 'Roar' }], none, none, none));
    expect(spans.map(s => [s.name, s.level])).toEqual([['Odeum', 0], ['PSS', 1], ['Roar', 0]]);
    expect(levels).toBe(2);
  });

  it('is nothing on a week with no work', () => {
    expect(weekSpans(week(none, none, none, none, none, none, none, none, none))).toEqual({ spans: [], levels: 0 });
  });
});
