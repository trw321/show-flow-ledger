import { describe, it, expect } from 'vitest';
import { sameProject, projectSiblingsToRelabel } from './projectGrouping';
import type { Job } from './store';

const job = (extra: Partial<Job>): Job => ({
  id: 'x', name: 'Portola Fest', client: 'Blackpoint', venue: 'Pier 80',
  date: '2026-09-21', status: 'upcoming', notes: '',
  has6th7thDayRule: false, ...extra,
} as Job);

describe('sameProject', () => {
  it('matches on the job number when both carry one', () => {
    expect(sameProject(
      job({ id: 'a', jobNumber: '2026-2956' }),
      job({ id: 'b', jobNumber: '2026-2956', name: 'Portola — callback', date: '2026-09-23' }),
    )).toBe(true);
  });

  it('separates different job numbers even with the same name', () => {
    expect(sameProject(
      job({ id: 'a', jobNumber: '2026-2956' }),
      job({ id: 'b', jobNumber: '2026-3011' }),
    )).toBe(false);
  });

  it('falls back to show name and employer when there is no number', () => {
    expect(sameProject(job({ id: 'a' }), job({ id: 'b', date: '2026-09-22' }))).toBe(true);
  });

  it('does not join the same show name under a different employer', () => {
    expect(sameProject(job({ id: 'a' }), job({ id: 'b', client: 'GSW Arena LLC' }))).toBe(false);
  });

  it('ignores case and padding in the name', () => {
    expect(sameProject(job({ id: 'a', name: '  portola fest ' }), job({ id: 'b' }))).toBe(true);
  });

  it('will not group two shifts that have no name', () => {
    expect(sameProject(job({ id: 'a', name: '' }), job({ id: 'b', name: '' }))).toBe(false);
  });
});

describe('projectSiblingsToRelabel', () => {
  const run = [
    job({ id: 'a', jobNumber: '2026-2956', date: '2026-09-21' }),
    job({ id: 'b', jobNumber: '2026-2956', date: '2026-09-22' }),
    job({ id: 'c', jobNumber: '2026-2956', date: '2026-09-23' }),
    job({ id: 'other', jobNumber: '2026-3011', name: 'Warriors', date: '2026-09-21' }),
  ];

  it('offers the rest of the run, never the shift being edited', () => {
    const siblings = projectSiblingsToRelabel(run[0], 'Blackpoint', run);
    expect(siblings.map(j => j.id)).toEqual(['b', 'c']);
  });

  it('leaves a shift already moved to a different employer alone', () => {
    // Someone set that one deliberately — do not sweep it up.
    const mixed = [...run.slice(0, 2), job({ id: 'c', jobNumber: '2026-2956', client: 'Elliott Lewis' })];
    expect(projectSiblingsToRelabel(mixed[0], 'Blackpoint', mixed).map(j => j.id)).toEqual(['b']);
  });

  it('does not reach into a different project', () => {
    const siblings = projectSiblingsToRelabel(run[0], 'Blackpoint', run);
    expect(siblings.some(j => j.id === 'other')).toBe(false);
  });

  it('offers nothing when the shift stands alone', () => {
    expect(projectSiblingsToRelabel(run[3], 'Blackpoint', run)).toEqual([]);
  });

  it('offers nothing when there was no employer to change from', () => {
    expect(projectSiblingsToRelabel(run[0], '', run)).toEqual([]);
  });
});
