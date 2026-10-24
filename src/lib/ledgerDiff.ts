import type { AppData } from './store';

/**
 * The ledger's record lists, in the order a sync writes them: employers and
 * jobs before the expenses, income and equipment that point at jobs.
 */
export const LEDGER_TABLES = ['employers', 'jobs', 'expenses', 'income', 'equipment', 'events', 'payouts'] as const;
export type LedgerTable = typeof LEDGER_TABLES[number];

/** One record that changed on this device and has not reached the account yet. */
export interface LedgerChange {
  table: LedgerTable;
  id: string;
  /** When it changed. For a deletion, when it was deleted. */
  at: string;
  deleted?: boolean;
}

type Versioned = { id: string; modifiedAt?: string };

/**
 * Works out what a save changed, and stamps each changed record with the time.
 *
 * Records are always replaced, never mutated, when edited — so under the same
 * id a different object is a changed record, a missing id was deleted, and a
 * new id was added. Diffing here, at the one place every save passes through,
 * means no edit path can forget to tell the sync about itself.
 */
export function stampChanges(prev: AppData, next: AppData, now: string): { data: AppData; changes: LedgerChange[] } {
  const changes: LedgerChange[] = [];
  let data = next;
  for (const table of LEDGER_TABLES) {
    const before = (prev[table] ?? []) as Versioned[];
    const after = (next[table] ?? []) as Versioned[];
    if (before === after) continue;
    const gone = new Map(before.map(r => [r.id, r]));
    let stampedAny = false;
    const stamped = after.map(r => {
      const was = gone.get(r.id);
      gone.delete(r.id);
      if (was === r) return r;
      stampedAny = true;
      changes.push({ table, id: r.id, at: now });
      return { ...r, modifiedAt: now };
    });
    for (const id of gone.keys()) changes.push({ table, id, at: now, deleted: true });
    if (stampedAny) data = { ...data, [table]: stamped } as AppData;
  }
  return { data, changes };
}

/** Everything in a ledger, counted. Zero means there is nothing to lose. */
export function recordCount(data: AppData): number {
  return LEDGER_TABLES.reduce((n, t) => n + (data[t]?.length ?? 0), 0);
}

// ── One clock for every device ──────────────────────────────────────────────
// The newer edit wins, so edit times have to be comparable between devices.
// A device whose clock is off would otherwise win every clash, or lose every
// one — the test machine here ran three hours ahead of the server. The sync
// measures how far this device is from the server's clock and every edit is
// stamped on the server's time instead.

const OFFSET_KEY = 'showflow-clock-offset';

let clockOffsetMs = (() => {
  try {
    const saved = Number(localStorage.getItem(OFFSET_KEY));
    return Number.isFinite(saved) ? saved : 0;
  } catch {
    return 0;
  }
})();

/** Now, on the server's clock as best this device knows it. */
export function stampNow(): string {
  return new Date(Date.now() + clockOffsetMs).toISOString();
}

/** How far ahead the server's clock is of this device's. Measured by the sync. */
export function setClockOffset(ms: number): void {
  if (!Number.isFinite(ms)) return;
  clockOffsetMs = ms;
  try { localStorage.setItem(OFFSET_KEY, String(Math.round(ms))); } catch { /* used for this session only */ }
}
