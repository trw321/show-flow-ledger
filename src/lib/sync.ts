import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { prefsKeyFor, syncMetaKeyFor, type AppData } from './store';
import { LEDGER_TABLES, type LedgerChange, type LedgerTable } from './ledgerDiff';
import { recordFromRow, rowForRecord } from './cloudSync';
import { normaliseLocal } from './payerProfile';

/**
 * Two-way sync between this device's ledger and the account.
 *
 * Each device keeps a full copy and edits it freely, offline included. A sync
 * pulls what changed in the account since last time, folds it in, then sends
 * up whatever changed here. When both sides edited the same record, the newer
 * edit wins — compared by each record's modifiedAt — and the database refuses
 * an older edit that arrives late, so a phone that was offline all day cannot
 * undo something done on the desktop since. Deletions are kept as markers so
 * other devices learn about them instead of putting the record back.
 */

type Row = Record<string, unknown>;
type Versioned = { id: string; modifiedAt?: string; createdAt?: string };

/** Changes made here that the account has not got yet, keyed `table:id`. */
export type Outbox = Record<string, LedgerChange>;

export interface SyncMeta {
  /** Server time of the newest row seen — where the next pull picks up. */
  cursor?: string;
  /** When every row was last fetched, rather than only recent ones. */
  fullPullAt?: string;
  lastSyncedAt?: string;
  outbox: Outbox;
}

export const entryKey = (c: { table: string; id: string }) => `${c.table}:${c.id}`;

export function loadSyncMeta(userId: string): SyncMeta {
  try {
    const raw = localStorage.getItem(syncMetaKeyFor(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return { ...parsed, outbox: parsed.outbox ?? {} };
  } catch {
    return { outbox: {} };
  }
}

export function saveSyncMeta(userId: string, meta: SyncMeta): void {
  try {
    localStorage.setItem(syncMetaKeyFor(userId), JSON.stringify(meta));
  } catch {
    // Lost entries are found again by the next full pull, which queues
    // anything here that the account does not have.
  }
}

/**
 * Notes local changes for the next push. A later change to the same record
 * replaces the earlier one: only the latest version is ever sent. Returns how
 * many are waiting.
 */
export function queueChanges(userId: string, changes: LedgerChange[]): number {
  const meta = loadSyncMeta(userId);
  for (const c of changes) meta.outbox[entryKey(c)] = c;
  saveSyncMeta(userId, meta);
  return Object.keys(meta.outbox).length;
}

/** Makes the next sync read everything, not just what changed lately. */
export function requestFullPull(userId: string): void {
  const meta = loadSyncMeta(userId);
  delete meta.fullPullAt;
  saveSyncMeta(userId, meta);
}

const time = (value: unknown): number => {
  if (typeof value !== 'string' || !value) return 0;
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
};

/** A record never edited since it was made is as old as its creation. */
const versionOf = (r: Versioned) => time(r.modifiedAt ?? r.createdAt);
const rowVersion = (row: Row) => time(row.modified_at ?? row.created_at);
const versionStamp = (r: Versioned) => r.modifiedAt ?? r.createdAt ?? new Date(0).toISOString();

export type RemoteRows = Partial<Record<LedgerTable, Row[]>>;

export interface MergeResult {
  data: AppData;
  outbox: Outbox;
  changed: boolean;
}

/**
 * Folds rows from the account into the local ledger. Pure, so every rule
 * below can be tested without a network.
 *
 * Per record, the newer version wins wherever it came from:
 *  - theirs newer → take it (or delete, if theirs is a deletion), and forget
 *    any older local change still waiting to go up;
 *  - ours newer → keep it, and make sure it is queued to go up;
 *  - the same → nothing to do; a queued change is already there.
 *
 * `full` says the rows are the account's whole ledger. Then anything here the
 * account does not have at all is queued too — which is how a ledger that
 * never synced goes up the first time, and how a change whose queue entry
 * was lost still reaches the account.
 */
export function mergeRemote(local: AppData, outbox: Outbox, remote: RemoteRows, full = false): MergeResult {
  let data = local;
  const box: Outbox = { ...outbox };
  let changed = false;

  for (const table of LEDGER_TABLES) {
    const rows = remote[table] ?? [];
    if (rows.length === 0 && !full) continue;

    const list = [...((local[table] ?? []) as Versioned[])];
    const position = new Map(list.map((r, i) => [r.id, i]));
    const removed = new Set<string>();
    const added: Versioned[] = [];
    const seen = new Set<string>();
    let tableChanged = false;

    for (const row of rows) {
      const id = String(row.id);
      seen.add(id);
      const key = entryKey({ table, id });
      const pending = box[key];
      const theirs = rowVersion(row);
      const i = position.get(id);
      const mine = i === undefined ? undefined : list[i];

      if (row.deleted_at != null) {
        if (mine && versionOf(mine) > theirs) {
          // Edited here after it was deleted there: the edit wins, and goes up.
          box[key] = pending && !pending.deleted ? pending : { table, id, at: versionStamp(mine) };
        } else {
          if (mine) { removed.add(id); tableChanged = true; }
          delete box[key];
        }
        continue;
      }

      if (mine) {
        const ours = versionOf(mine);
        if (theirs > ours) {
          list[i!] = recordFromRow(table, row) as Versioned;
          tableChanged = true;
          delete box[key];
        } else if (theirs < ours) {
          if (!pending) box[key] = { table, id, at: versionStamp(mine) };
        } else if (pending && !pending.deleted) {
          // Our own change, back from the account: it has arrived.
          delete box[key];
        }
      } else if (pending?.deleted) {
        if (theirs > time(pending.at)) {
          // Edited there after it was deleted here: the edit wins.
          added.push(recordFromRow(table, row) as Versioned);
          tableChanged = true;
          delete box[key];
        }
        // Otherwise the delete is newer, and goes up.
      } else {
        added.push(recordFromRow(table, row) as Versioned);
        tableChanged = true;
      }
    }

    if (full) {
      for (const r of list) {
        const key = entryKey({ table, id: r.id });
        if (!seen.has(r.id) && !box[key]) box[key] = { table, id: r.id, at: versionStamp(r) };
      }
    }

    if (tableChanged) {
      data = { ...data, [table]: [...added, ...list.filter(r => !removed.has(r.id))] } as AppData;
      changed = true;
    }
  }

  return { data, outbox: box, changed };
}

/**
 * Two ledgers as one: every record from both, and where both have the same
 * record, the newer version. For giving an account the data a device had
 * before it signed in.
 */
export function unionLedgers(base: AppData, extra: AppData): AppData {
  const out = { ...base };
  for (const table of LEDGER_TABLES) {
    const mine = (base[table] ?? []) as Versioned[];
    const theirs = (extra[table] ?? []) as Versioned[];
    if (theirs.length === 0) continue;
    const byId = new Map(mine.map(r => [r.id, r]));
    for (const r of theirs) {
      const existing = byId.get(r.id);
      if (!existing || versionOf(r) > versionOf(existing)) byId.set(r.id, r);
    }
    (out as Record<LedgerTable, unknown[]>)[table] = [...byId.values()];
  }
  return out;
}

// ── Network ─────────────────────────────────────────────────────────────────

/** PostgREST's default page size; a pull pages past it rather than stopping short. */
const PAGE = 1000;
/** Read a little before the cursor: a row committed late can carry a server time just behind it. */
export const OVERLAP_MS = 2 * 60_000;
/** Once a day everything is read again, so anything a short pull ever missed is caught. */
export const FULL_PULL_EVERY_MS = 24 * 60 * 60_000;
/** Kept well under the request size limit; one stub photo can be a third of a megabyte. */
const MAX_BATCH_BYTES = 400_000;
const MAX_BATCH_ROWS = 200;
/** Ids per delete request — they travel in the URL. */
const MAX_IDS_PER_DELETE = 100;

// The generated types describe each table separately; the sync treats them
// all alike, and they all have the columns it touches.
const from = (table: LedgerTable) => supabase.from(table as 'jobs');

export async function pullChanges(userId: string, since?: string): Promise<{ rows: RemoteRows; newest?: string }> {
  const rows: RemoteRows = {};
  let newest: string | undefined;
  for (const table of LEDGER_TABLES) {
    const got: Row[] = [];
    for (let start = 0; ; start += PAGE) {
      let query = from(table).select('*').eq('user_id', userId);
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .range(start, start + PAGE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      const page = (data ?? []) as Row[];
      got.push(...page);
      if (page.length < PAGE) break;
    }
    for (const r of got) {
      if (time(r.updated_at) > time(newest)) newest = r.updated_at as string;
    }
    rows[table] = got;
  }
  return { rows, newest };
}

function batches(rows: Row[]): Row[][] {
  const out: Row[][] = [];
  let current: Row[] = [];
  let size = 0;
  for (const row of rows) {
    const bytes = JSON.stringify(row).length;
    if (current.length > 0 && (size + bytes > MAX_BATCH_BYTES || current.length >= MAX_BATCH_ROWS)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += bytes;
  }
  if (current.length > 0) out.push(current);
  return out;
}

const JOB_REFERENCES = ['job_id', 'assigned_job_id'];

/**
 * The database checks that a payment's or expense's shift exists, and refuses
 * the row — and with it every other row in the batch — if it does not. A
 * shift deleted before it ever synced leaves exactly that behind, so a
 * reference to a shift this ledger no longer has is sent as none. The record
 * here keeps it.
 */
function withoutDeadJobRefs(row: Row, jobIds: Set<string>): Row {
  let out = row;
  for (const column of JOB_REFERENCES) {
    const ref = row[column];
    if (typeof ref === 'string' && !jobIds.has(ref)) out = { ...out, [column]: null };
  }
  return out;
}

/**
 * Sends queued changes up. Returns the ones that landed — the caller clears
 * those from the queue only if they have not changed again meanwhile — and
 * the first error, if any stopped the rest.
 */
export async function pushChanges(
  userId: string,
  data: AppData,
  entries: LedgerChange[],
): Promise<{ pushed: LedgerChange[]; error?: string }> {
  const pushed: LedgerChange[] = [];
  const jobIds = new Set(data.jobs.map(j => j.id));

  for (const table of LEDGER_TABLES) {
    const mine = entries.filter(e => e.table === table);
    if (mine.length === 0) continue;
    const records = new Map(((data[table] ?? []) as Versioned[]).map(r => [r.id, r]));

    const edits = mine.filter(e => !e.deleted);
    // An edit whose record has since gone was overtaken by a deletion; the
    // deletion is what needs to go up, not the edit.
    pushed.push(...edits.filter(e => !records.has(e.id)));
    const live = edits.filter(e => records.has(e.id));
    const rows = live.map(e => withoutDeadJobRefs(rowForRecord(table, records.get(e.id), userId), jobIds));
    for (const batch of batches(rows)) {
      const { error } = await from(table).upsert(batch as never, { onConflict: 'id' });
      if (error) return { pushed, error: `${table}: ${error.message}` };
      const sent = new Set(batch.map(r => r.id as string));
      pushed.push(...live.filter(e => sent.has(e.id)));
    }

    // Deleted together, deleted at the same moment: one request per moment.
    const byMoment = new Map<string, LedgerChange[]>();
    for (const e of mine.filter(e => e.deleted)) byMoment.set(e.at, [...(byMoment.get(e.at) ?? []), e]);
    for (const [at, group] of byMoment) {
      for (let i = 0; i < group.length; i += MAX_IDS_PER_DELETE) {
        const slice = group.slice(i, i + MAX_IDS_PER_DELETE);
        const { error } = await from(table)
          .update({ deleted_at: at, modified_at: at } as never)
          .eq('user_id', userId)
          .in('id', slice.map(e => e.id));
        if (error) return { pushed, error: `${table}: ${error.message}` };
        pushed.push(...slice);
      }
    }
  }

  return { pushed };
}

// ── Settings ────────────────────────────────────────────────────────────────
// Tax, exempt status and what each local takes change the maths, so they
// have to match on every device or the same shift pays differently on each.

/** Fired after the sync writes settings that came from another device. */
export const PREFS_SYNCED_EVENT = 'showflow:prefs-synced';
/** Fired when settings are changed here, so the sync sends them up. */
export const PREFS_CHANGED_EVENT = 'showflow:prefs-changed';

type Fields = Record<string, unknown>;
export type StoredPrefs = Fields & {
  modifiedAt?: string;
  tabs?: Fields;
  payer?: Fields & { tax?: Fields; locals?: Fields[] };
};

const isSet = (v: unknown) => v !== undefined && v !== null && v !== '';
const setFields = (o?: Fields) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => isSet(v)));
const countSet = (o?: Fields) => Object.keys(setFields(o)).length;

/** How much of a tax and locals setup a copy of the settings holds. */
function completeness(p: StoredPrefs): number {
  const locals = p.payer?.locals ?? [];
  return countSet(p.payer?.tax) + locals.reduce((n, l) => n + countSet(l), 0);
}

/**
 * Settings saved on two devices before settings synced, with no history to
 * say which is right. Every value either one has is kept; where both set the
 * same thing differently, the fuller setup wins — real tax and locals beat a
 * half-filled test.
 */
export function mergeUnstampedPrefs(a: StoredPrefs, b: StoredPrefs): StoredPrefs {
  const [primary, secondary] = completeness(a) >= completeness(b) ? [a, b] : [b, a];
  const locals = new Map<string, Fields>();
  for (const l of [...(secondary.payer?.locals ?? []), ...(primary.payer?.locals ?? [])]) {
    const id = normaliseLocal(l.local as string | undefined);
    locals.set(id, { ...(locals.get(id) ?? {}), ...setFields(l) });
  }
  const tax = primary.payer?.tax || secondary.payer?.tax
    ? { ...setFields(secondary.payer?.tax), ...setFields(primary.payer?.tax) }
    : undefined;
  return {
    ...secondary,
    ...setFields(primary),
    tabs: { ...(secondary.tabs ?? {}), ...(primary.tabs ?? {}) },
    payer: { ...(secondary.payer ?? {}), ...(primary.payer ?? {}), tax, locals: [...locals.values()] },
  };
}

/**
 * What to do with this device's settings and the account's. Returns what to
 * save here (`write`) and what to send up (`push`), either or both.
 */
export function decidePrefs(
  local: StoredPrefs | null,
  remote: { prefs: StoredPrefs; modifiedAt?: string } | null,
  now: string,
): { write?: StoredPrefs; push?: StoredPrefs } {
  if (!remote) {
    if (!local) return {};
    if (local.modifiedAt) return { push: local };
    const stamped = { ...local, modifiedAt: now };
    return { write: stamped, push: stamped };
  }
  const theirs: StoredPrefs = { ...remote.prefs, modifiedAt: remote.modifiedAt };
  if (!local) return { write: theirs };
  if (!local.modifiedAt) {
    const merged = { ...mergeUnstampedPrefs(local, remote.prefs), modifiedAt: now };
    return { write: merged, push: merged };
  }
  const ours = time(local.modifiedAt);
  const their = time(remote.modifiedAt);
  if (their > ours) return { write: theirs };
  if (ours > their) return { push: local };
  return {};
}

export async function syncPrefs(userId: string): Promise<void> {
  const key = prefsKeyFor(userId);
  let local: StoredPrefs | null = null;
  try {
    const raw = localStorage.getItem(key);
    local = raw ? JSON.parse(raw) : null;
  } catch {
    local = null;
  }

  const { data: row, error } = await supabase
    .from('user_prefs')
    .select('prefs, modified_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`settings: ${error.message}`);

  const remote = row ? { prefs: (row.prefs ?? {}) as StoredPrefs, modifiedAt: row.modified_at ?? undefined } : null;
  const { write, push } = decidePrefs(local, remote, new Date().toISOString());

  if (write) {
    try {
      localStorage.setItem(key, JSON.stringify(write));
      window.dispatchEvent(new Event(PREFS_SYNCED_EVENT));
    } catch {
      // Not saved here; the next sync decides again.
    }
  }
  if (push) {
    const { modifiedAt, ...prefs } = push;
    const { error: pushError } = await supabase
      .from('user_prefs')
      .upsert({ user_id: userId, prefs: prefs as Json, modified_at: modifiedAt ?? null }, { onConflict: 'user_id' });
    if (pushError) throw new Error(`settings: ${pushError.message}`);
  }
}
