import { describe, it, expect } from 'vitest';
import { sameProject, projectSiblingsToRelabel, projectKeys, projectOf } from './projectGrouping';
import type { Employer, Job } from './store';

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

describe('projectKeys: one answer for every screen', () => {
  const key = (jobs: Job[], employers: Employer[] = []) => {
    const keys = projectKeys(jobs, employers);
    return (id: string) => keys.get(id);
  };

  it('joins a day typed in by hand to the dispatched run it belongs to', () => {
    const of = key([
      job({ id: 'a', name: 'Palace Hotel', jobNumber: '2026-3943', date: '2026-10-24' }),
      job({ id: 'b', name: 'palace hotel ', date: '2026-10-25' }),
    ]);
    expect(of('b')).toBe(of('a'));
  });

  it('keeps two different dispatch numbers apart', () => {
    const of = key([
      job({ id: 'a', jobNumber: '2026-2956' }),
      job({ id: 'b', jobNumber: '2026-3011', date: '2026-09-22' }),
    ]);
    expect(of('a')).not.toBe(of('b'));
  });

  it('does not reach a run weeks away', () => {
    const of = key([
      job({ id: 'a', jobNumber: '2026-2956', date: '2026-09-01' }),
      job({ id: 'b', date: '2026-10-20' }),
    ]);
    expect(of('b')).not.toBe(of('a'));
  });

  it('reads the employer the way pay does, so its spellings agree', () => {
    const blackpoint = { id: 'e1', name: 'Blackpoint', overtimeRule: 'daily', createdAt: 'x' } as Employer;
    const of = key([
      job({ id: 'a', client: 'Blackpoint' }),
      job({ id: 'b', client: 'BLACKPOINT PRODUCTION INC.', date: '2026-09-22' }),
    ], [blackpoint]);
    expect(of('a')).toBe(of('b'));
  });

  it('leaves a shift with no name and no number on its own', () => {
    const of = key([job({ id: 'a', name: '' }), job({ id: 'b', name: '' })]);
    expect(of('a')).not.toBe(of('b'));
  });

  it('gives the pay matcher the same project', () => {
    const jobs = [
      job({ id: 'a', name: 'Palace Hotel', jobNumber: '2026-3943', date: '2026-10-24' }),
      job({ id: 'b', name: 'Palace Hotel', date: '2026-10-25' }),
    ];
    expect(projectOf(jobs[1], jobs).map(j => j.id).sort()).toEqual(['a', 'b']);
  });
});
