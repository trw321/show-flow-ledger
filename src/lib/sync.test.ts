import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppData, Job, Income } from './store';

// The pushes are checked against a stand-in for the database client, so the
// rows that would be sent can be read back.
const calls: { table: string; op: string; rows?: unknown; values?: unknown; ids?: unknown }[] = [];
let failTable: string | null = null;
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (rows: unknown) => {
        calls.push({ table, op: 'upsert', rows });
        return { error: failTable === table ? { message: 'refused' } : null };
      },
      update: (values: unknown) => ({
        eq: () => ({
          in: async (_col: string, ids: unknown) => {
            calls.push({ table, op: 'update', values, ids });
            return { error: null };
          },
        }),
      }),
    }),
  },
}));

const { stampChanges, recordCount } = await import('./ledgerDiff');
const { mergeRemote, unionLedgers, pushChanges, decidePrefs, mergeUnstampedPrefs, entryKey } = await import('./sync');
const { buildRows, fromRows } = await import('./cloudSync');

const empty = (): AppData => ({ jobs: [], expenses: [], income: [], equipment: [], employers: [], events: [], payouts: [] });

const job = (id: string, extra: Partial<Job> = {}): Job => ({
  id, name: 'Show', client: 'Odeum', venue: 'Hall', date: '2026-10-01', status: 'completed',
  notes: '', createdAt: '2026-10-01T10:00:00.000Z', ...extra,
});

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: 'u1', name: 'Show', client: 'Odeum', venue: 'Hall', date: '2026-10-01', status: 'completed',
  notes: '', has_6th_7th_day_rule: false, meal_penalties: 0, attachments: [],
  created_at: '2026-10-01T10:00:00+00:00', modified_at: null, deleted_at: null, ...extra,
});

describe('telling the sync what changed', () => {
  it('stamps an edited record and reports it', () => {
    const before = { ...empty(), jobs: [job('a'), job('b')] };
    const after = { ...before, jobs: [{ ...before.jobs[0], notes: 'dock B' }, before.jobs[1]] };
    const { data, changes } = stampChanges(before, after, '2026-10-22T09:00:00.000Z');
    expect(changes).toEqual([{ table: 'jobs', id: 'a', at: '2026-10-22T09:00:00.000Z' }]);
    expect(data.jobs[0].modifiedAt).toBe('2026-10-22T09:00:00.000Z');
    // Untouched records keep their identity, so nothing else looks edited.
    expect(data.jobs[1]).toBe(before.jobs[1]);
  });

  it('reports a new record and a deleted one', () => {
    const before = { ...empty(), jobs: [job('a')] };
    const after = { ...before, jobs: [job('b')] };
    const { changes } = stampChanges(before, after, 'now');
    expect(changes).toContainEqual({ table: 'jobs', id: 'b', at: 'now' });
    expect(changes).toContainEqual({ table: 'jobs', id: 'a', at: 'now', deleted: true });
  });

  it('reports nothing for a list left alone', () => {
    const before = { ...empty(), jobs: [job('a')] };
    const after = { ...before, income: [] };
    expect(stampChanges(before, after, 'now').changes).toEqual([]);
  });

  it('counts what a ledger holds', () => {
    expect(recordCount(empty())).toBe(0);
    expect(recordCount({ ...empty(), jobs: [job('a')], employers: [{ id: 'e', name: 'E', overtimeRule: 'daily', createdAt: 'x' }] })).toBe(2);
  });
});

describe('folding in what the account has', () => {
  it('adds a record made on another device', () => {
    const { data, changed } = mergeRemote(empty(), {}, { jobs: [row('a')] });
    expect(changed).toBe(true);
    expect(data.jobs.map(j => j.id)).toEqual(['a']);
  });

  it('takes the newer edit from the account, and drops the older one waiting here', () => {
    const local = { ...empty(), jobs: [job('a', { notes: 'old', modifiedAt: '2026-10-20T10:00:00.000Z' })] };
    const outbox = { [entryKey({ table: 'jobs', id: 'a' })]: { table: 'jobs' as const, id: 'a', at: '2026-10-20T10:00:00.000Z' } };
    const { data, outbox: box } = mergeRemote(local, outbox, {
      jobs: [row('a', { notes: 'new', modified_at: '2026-10-21T10:00:00+00:00' })],
    });
    expect(data.jobs[0].notes).toBe('new');
    expect(box).toEqual({});
  });

  it('keeps a newer edit made here, still waiting to go up', () => {
    const local = { ...empty(), jobs: [job('a', { notes: 'mine', modifiedAt: '2026-10-22T10:00:00.000Z' })] };
    const pending = { table: 'jobs' as const, id: 'a', at: '2026-10-22T10:00:00.000Z' };
    const { data, outbox } = mergeRemote(local, { 'jobs:a': pending }, {
      jobs: [row('a', { notes: 'theirs', modified_at: '2026-10-21T10:00:00+00:00' })],
    });
    expect(data.jobs[0].notes).toBe('mine');
    expect(outbox['jobs:a']).toEqual(pending);
  });

  it('sends up a newer version here even when nothing said it was waiting', () => {
    const local = { ...empty(), jobs: [job('a', { modifiedAt: '2026-10-22T10:00:00.000Z' })] };
    const { outbox } = mergeRemote(local, {}, { jobs: [row('a', { modified_at: '2026-10-21T10:00:00+00:00' })] });
    expect(outbox['jobs:a']).toBeDefined();
  });

  it('clears a change once it comes back from the account', () => {
    const at = '2026-10-22T10:00:00.000Z';
    const local = { ...empty(), jobs: [job('a', { modifiedAt: at })] };
    const { outbox, changed } = mergeRemote(local, { 'jobs:a': { table: 'jobs', id: 'a', at } }, {
      // Same moment, written the way Postgres writes it.
      jobs: [row('a', { modified_at: '2026-10-22T10:00:00+00:00' })],
    });
    expect(outbox).toEqual({});
    expect(changed).toBe(false);
  });

  it('removes a record deleted on another device', () => {
    const local = { ...empty(), jobs: [job('a')] };
    const { data } = mergeRemote(local, {}, { jobs: [row('a', { deleted_at: '2026-10-22T10:00:00+00:00', modified_at: '2026-10-22T10:00:00+00:00' })] });
    expect(data.jobs).toEqual([]);
  });

  it('keeps a record edited here after another device deleted it', () => {
    const local = { ...empty(), jobs: [job('a', { modifiedAt: '2026-10-22T12:00:00.000Z' })] };
    const { data, outbox } = mergeRemote(local, {}, {
      jobs: [row('a', { deleted_at: '2026-10-22T10:00:00+00:00', modified_at: '2026-10-22T10:00:00+00:00' })],
    });
    expect(data.jobs).toHaveLength(1);
    expect(outbox['jobs:a']).toBeDefined();
  });

  it('brings back a record deleted here if another device edited it later', () => {
    const outbox = { 'jobs:a': { table: 'jobs' as const, id: 'a', at: '2026-10-22T10:00:00.000Z', deleted: true } };
    const { data, outbox: box } = mergeRemote(empty(), outbox, {
      jobs: [row('a', { modified_at: '2026-10-22T11:00:00+00:00' })],
    });
    expect(data.jobs.map(j => j.id)).toEqual(['a']);
    expect(box).toEqual({});
  });

  it('keeps a deletion made here that is newer than the last edit there', () => {
    const outbox = { 'jobs:a': { table: 'jobs' as const, id: 'a', at: '2026-10-22T12:00:00.000Z', deleted: true } };
    const { data, outbox: box } = mergeRemote(empty(), outbox, {
      jobs: [row('a', { modified_at: '2026-10-22T11:00:00+00:00' })],
    });
    expect(data.jobs).toEqual([]);
    expect(box['jobs:a']?.deleted).toBe(true);
  });

  it('on a full read, queues everything here the account does not have', () => {
    const local = { ...empty(), jobs: [job('a'), job('b')] };
    const { outbox } = mergeRemote(local, {}, { jobs: [row('a')] }, true);
    expect(Object.keys(outbox)).toEqual(['jobs:b']);
  });

  it('on a short read, does not take a missing record for a new one', () => {
    const local = { ...empty(), jobs: [job('a'), job('b')] };
    expect(mergeRemote(local, {}, { jobs: [row('a')] }, false).outbox).toEqual({});
  });

  it('leaves a record alone when neither side has edited it', () => {
    const local = { ...empty(), jobs: [job('a')] };
    const { changed, outbox } = mergeRemote(local, {}, { jobs: [row('a')] });
    expect(changed).toBe(false);
    expect(outbox).toEqual({});
  });
});

describe('giving an account a device’s data', () => {
  it('keeps everything from both', () => {
    const a = { ...empty(), jobs: [job('a')] };
    const b = { ...empty(), jobs: [job('b')], income: [{ id: 'i', client: 'C', description: '', amount: 5, date: '2026-10-01', status: 'paid', createdAt: 'x' } as Income] };
    const u = unionLedgers(a, b);
    expect(u.jobs.map(j => j.id).sort()).toEqual(['a', 'b']);
    expect(u.income).toHaveLength(1);
  });

  it('keeps the newer copy of a record both have', () => {
    const older = job('a', { notes: 'old', modifiedAt: '2026-10-01T00:00:00.000Z' });
    const newer = job('a', { notes: 'new', modifiedAt: '2026-10-02T00:00:00.000Z' });
    expect(unionLedgers({ ...empty(), jobs: [older] }, { ...empty(), jobs: [newer] }).jobs[0].notes).toBe('new');
    expect(unionLedgers({ ...empty(), jobs: [newer] }, { ...empty(), jobs: [older] }).jobs[0].notes).toBe('new');
  });
});

describe('sending changes up', () => {
  beforeEach(() => { calls.length = 0; failTable = null; });

  it('sends the current version of each changed record', async () => {
    const data = { ...empty(), jobs: [job('a', { notes: 'dock B', modifiedAt: '2026-10-22T09:00:00.000Z' })] };
    const { pushed, error } = await pushChanges('u1', data, [{ table: 'jobs', id: 'a', at: '2026-10-22T09:00:00.000Z' }]);
    expect(error).toBeUndefined();
    expect(pushed).toHaveLength(1);
    const [sent] = calls[0].rows as Record<string, unknown>[];
    expect(sent.notes).toBe('dock B');
    expect(sent.modified_at).toBe('2026-10-22T09:00:00.000Z');
    expect(sent.deleted_at).toBeNull();
    expect(sent.user_id).toBe('u1');
  });

  it('marks deletions instead of erasing rows, one request per moment', async () => {
    const at = '2026-10-22T09:00:00.000Z';
    await pushChanges('u1', empty(), [
      { table: 'jobs', id: 'a', at, deleted: true },
      { table: 'jobs', id: 'b', at, deleted: true },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ op: 'update', values: { deleted_at: at, modified_at: at }, ids: ['a', 'b'] });
  });

  it('sends no reference to a shift this ledger no longer has', async () => {
    // A payment whose shift was deleted before it ever synced: the database
    // would refuse the whole batch over it.
    const data = { ...empty(), income: [{ id: 'i', jobId: 'gone', client: 'C', description: '', amount: 5, date: '2026-10-01', status: 'paid', createdAt: 'x' } as Income] };
    await pushChanges('u1', data, [{ table: 'income', id: 'i', at: 'x' }]);
    expect((calls[0].rows as Record<string, unknown>[])[0].job_id).toBeNull();
    // The record here keeps it.
    expect(data.income[0].jobId).toBe('gone');
  });

  it('keeps a reference to a shift that is here', async () => {
    const data = { ...empty(), jobs: [job('j')], income: [{ id: 'i', jobId: 'j', client: 'C', description: '', amount: 5, date: '2026-10-01', status: 'paid', createdAt: 'x' } as Income] };
    await pushChanges('u1', data, [{ table: 'income', id: 'i', at: 'x' }]);
    expect((calls.find(c => c.table === 'income')!.rows as Record<string, unknown>[])[0].job_id).toBe('j');
  });

  it('sends shifts before the payments that point at them', async () => {
    const data = { ...empty(), jobs: [job('j')], income: [{ id: 'i', jobId: 'j', client: 'C', description: '', amount: 5, date: '2026-10-01', status: 'paid', createdAt: 'x' } as Income] };
    await pushChanges('u1', data, [{ table: 'income', id: 'i', at: 'x' }, { table: 'jobs', id: 'j', at: 'x' }]);
    expect(calls.map(c => c.table)).toEqual(['jobs', 'income']);
  });

  it('reports what landed when a later table fails, so it is not sent twice', async () => {
    failTable = 'income';
    const data = { ...empty(), jobs: [job('j')], income: [{ id: 'i', client: 'C', description: '', amount: 5, date: '2026-10-01', status: 'paid', createdAt: 'x' } as Income] };
    const { pushed, error } = await pushChanges('u1', data, [{ table: 'jobs', id: 'j', at: 'x' }, { table: 'income', id: 'i', at: 'x' }]);
    expect(error).toContain('income');
    expect(pushed.map(p => p.id)).toEqual(['j']);
  });

  it('splits a large ledger into batches', async () => {
    const jobs = Array.from({ length: 450 }, (_, i) => job(`j${i}`));
    await pushChanges('u1', { ...empty(), jobs }, jobs.map(j => ({ table: 'jobs' as const, id: j.id, at: 'x' })));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.reduce((n, c) => n + (c.rows as unknown[]).length, 0)).toBe(450);
  });
});

describe('the sync columns survive the trip', () => {
  it('carries an edit time up and back', () => {
    const edited = job('a', { modifiedAt: '2026-10-22T09:00:00.000Z' });
    const [, rows] = buildRows({ ...empty(), jobs: [edited] }, 'u1').find(([t]) => t === 'jobs')!;
    expect(rows[0].modified_at).toBe('2026-10-22T09:00:00.000Z');
    const back = fromRows({ jobs: [{ ...rows[0], modified_at: '2026-10-22T09:00:00+00:00' }] } as never);
    expect(back.jobs[0].modifiedAt).toBe('2026-10-22T09:00:00.000Z');
  });

  it('reports a never-edited record as old as its creation, and brings it back unedited', () => {
    const fresh = job('a');
    const [, rows] = buildRows({ ...empty(), jobs: [fresh] }, 'u1').find(([t]) => t === 'jobs')!;
    expect(rows[0].modified_at).toBe(fresh.createdAt);
    const back = fromRows({ jobs: [rows[0]] } as never);
    expect(back.jobs[0].modifiedAt).toBeUndefined();
  });
});

describe('settings on more than one device', () => {
  const now = '2026-10-22T09:00:00.000Z';

  it('sends this device’s settings up when the account has none', () => {
    const local = { workerType: 'w2', modifiedAt: '2026-10-20T00:00:00.000Z' };
    expect(decidePrefs(local, null, now)).toEqual({ push: local });
  });

  it('stamps settings saved before they synced, the first time they go up', () => {
    const { write, push } = decidePrefs({ workerType: 'w2' }, null, now);
    expect(write?.modifiedAt).toBe(now);
    expect(push?.modifiedAt).toBe(now);
  });

  it('takes the account’s settings when they are newer', () => {
    const local = { workerType: 'w2', modifiedAt: '2026-10-20T00:00:00.000Z' };
    const remote = { prefs: { workerType: 'boss' }, modifiedAt: '2026-10-21T00:00:00+00:00' };
    expect(decidePrefs(local, remote, now).write?.workerType).toBe('boss');
  });

  it('sends this device’s settings when they are newer', () => {
    const local = { workerType: 'w2', modifiedAt: '2026-10-22T00:00:00.000Z' };
    const remote = { prefs: { workerType: 'boss' }, modifiedAt: '2026-10-21T00:00:00+00:00' };
    expect(decidePrefs(local, remote, now)).toEqual({ push: local });
  });

  it('takes the account’s settings on a device that has none', () => {
    expect(decidePrefs(null, { prefs: { workerType: 'boss' }, modifiedAt: now }, now).write?.workerType).toBe('boss');
  });

  it('merges two devices’ settings from before syncing, losing nothing', () => {
    // The phone has the real setup; the desktop only ever toggled a tab.
    const phone = { workerType: 'w2', payer: { tax: { filingStatus: 'single', state: 'CA', dependents: 1 }, locals: [{ local: 'ia16', unionDuesPercent: 3.5, vacationPercent: 8 }] } };
    const desktop = { workerType: '1099', tabs: { payouts: true }, payer: { tax: { state: 'NY' }, locals: [{ local: 'IA 8', unionDuesPercent: 4 }] } };
    for (const [a, b] of [[phone, desktop], [desktop, phone]]) {
      const merged = mergeUnstampedPrefs(a, b);
      // The fuller setup wins where they disagree...
      expect(merged.payer?.tax?.state).toBe('CA');
      expect(merged.workerType).toBe('w2');
      // ...and nothing either one had is dropped.
      expect(merged.payer?.tax?.dependents).toBe(1);
      expect(merged.payer?.locals?.map(l => l.local).sort()).toEqual(['IA 8', 'ia16']);
      expect(merged.tabs?.payouts).toBe(true);
    }
  });
});
