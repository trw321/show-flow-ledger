import { useCallback, useEffect, useRef, useState } from 'react';
import { ledgerKeyFor, type AppData } from './store';
import type { LedgerChange } from './ledgerDiff';
import {
  entryKey, FULL_PULL_EVERY_MS, loadSyncMeta, mergeRemote, OVERLAP_MS, PREFS_CHANGED_EVENT,
  pullChanges, pushChanges, queueChanges, saveSyncMeta, syncPrefs,
} from './sync';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncInfo {
  status: SyncStatus;
  lastSyncedAt?: string;
  /** Changes made here still waiting to go up. */
  pending: number;
  error?: string;
}

interface Ledger {
  readLedger: (key: string) => AppData | null;
  applyRemote: (key: string, fn: (prev: AppData) => AppData) => Promise<boolean>;
}

/** Long enough to gather a burst of taps into one sync. */
const AFTER_EDIT_MS = 2000;
/** While the app is open, so another device's changes show up without a reload. */
const EVERY_MS = 60_000;
/** Coming back to the app syncs, but not more often than this. */
const MIN_GAP_MS = 5000;

const newer = (a?: string, b?: string) => (!a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a);

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Keeps the signed-in account's ledger in step with the account: pulls on
 * open, on coming back to the app, once a minute, and shortly after an edit.
 * Off while signed out, or while `active` is false.
 */
export function useLedgerSync(userId: string | null, active: boolean, ledger: Ledger) {
  const [info, setInfo] = useState<SyncInfo>({ status: 'off', pending: 0 });
  const running = useRef(false);
  const again = useRef(false);
  const waiting = useRef<Array<() => void>>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastStart = useRef(0);
  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;
  // Who the sync is for right now. A sync started for someone who has since
  // signed out stops instead of writing into whoever is signed in now.
  const currentUser = useRef(userId);
  currentUser.current = active ? userId : null;

  const run = useCallback(async (): Promise<void> => {
    if (!userId || !active) return;
    if (running.current) {
      again.current = true;
      return new Promise<void>(resolve => waiting.current.push(resolve));
    }
    running.current = true;
    lastStart.current = Date.now();
    const key = ledgerKeyFor(userId);
    const stillMine = () => currentUser.current === userId;
    setInfo(s => ({ ...s, status: 'syncing' }));

    try {
      // 1. Pull, and fold in whatever is newer than what is here.
      const meta = loadSyncMeta(userId);
      const full = !meta.cursor || !meta.fullPullAt || Date.now() - Date.parse(meta.fullPullAt) > FULL_PULL_EVERY_MS;
      const since = full || !meta.cursor ? undefined : new Date(Date.parse(meta.cursor) - OVERLAP_MS).toISOString();
      const pulled = await pullChanges(userId, since);
      if (!stillMine()) return;

      const saved = await ledgerRef.current.applyRemote(key, prev => {
        const latest = loadSyncMeta(userId);
        const merged = mergeRemote(prev, latest.outbox, pulled.rows, full);
        saveSyncMeta(userId, { ...latest, outbox: merged.outbox });
        return merged.changed ? merged.data : prev;
      });
      if (!stillMine()) return;
      if (!saved) throw new Error("Couldn't save what came from your other devices — this one may be out of storage");

      const afterPull = loadSyncMeta(userId);
      saveSyncMeta(userId, {
        ...afterPull,
        cursor: newer(afterPull.cursor, pulled.newest),
        fullPullAt: full ? new Date().toISOString() : afterPull.fullPullAt,
      });

      // 2. Push what changed here.
      const queued = Object.values(loadSyncMeta(userId).outbox);
      if (queued.length > 0) {
        const data = ledgerRef.current.readLedger(key);
        if (!data) throw new Error('The ledger changed while syncing — trying again shortly');
        const result = await pushChanges(userId, data, queued);
        const latest = loadSyncMeta(userId);
        for (const sent of result.pushed) {
          const k = entryKey(sent);
          const now = latest.outbox[k];
          // Cleared only if it has not changed again since it was sent.
          if (now && now.at === sent.at && !!now.deleted === !!sent.deleted) delete latest.outbox[k];
        }
        saveSyncMeta(userId, latest);
        if (result.error) throw new Error(result.error);
      }

      // 3. Settings.
      await syncPrefs(userId);
      if (!stillMine()) return;

      const done = loadSyncMeta(userId);
      done.lastSyncedAt = new Date().toISOString();
      saveSyncMeta(userId, done);
      setInfo({ status: 'idle', lastSyncedAt: done.lastSyncedAt, pending: Object.keys(done.outbox).length });
    } catch (err) {
      if (!stillMine()) return;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const meta = loadSyncMeta(userId);
      setInfo({
        status: offline ? 'offline' : 'error',
        error: offline ? undefined : errorText(err),
        lastSyncedAt: meta.lastSyncedAt,
        pending: Object.keys(meta.outbox).length,
      });
    } finally {
      running.current = false;
      if (again.current && stillMine()) {
        again.current = false;
        void run();
      } else {
        again.current = false;
        const resolve = waiting.current;
        waiting.current = [];
        resolve.forEach(r => r());
      }
    }
  }, [userId, active]);

  const schedule = useCallback((delay = AFTER_EDIT_MS) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delay);
  }, [run]);

  /**
   * Hears every edit made here. Runs inside a save, so it only queues and
   * schedules — the count on screen is updated just after.
   */
  const noteLocalChanges = useCallback((changes: LedgerChange[], key: string) => {
    if (!userId || !active || key !== ledgerKeyFor(userId)) return;
    const pending = queueChanges(userId, changes);
    queueMicrotask(() => setInfo(s => ({ ...s, pending })));
    schedule();
  }, [userId, active, schedule]);

  useEffect(() => {
    if (!userId || !active) {
      setInfo({ status: 'off', pending: 0 });
      return;
    }
    const meta = loadSyncMeta(userId);
    setInfo({ status: 'idle', pending: Object.keys(meta.outbox).length, lastSyncedAt: meta.lastSyncedAt });
    void run();

    const soon = () => {
      if (Date.now() - lastStart.current > MIN_GAP_MS) void run();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') soon();
    };
    const onPrefsChanged = () => schedule();
    const every = setInterval(() => {
      if (document.visibilityState === 'visible') void run();
    }, EVERY_MS);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', soon);
    window.addEventListener(PREFS_CHANGED_EVENT, onPrefsChanged);
    return () => {
      clearInterval(every);
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', soon);
      window.removeEventListener(PREFS_CHANGED_EVENT, onPrefsChanged);
    };
  }, [userId, active, run, schedule]);

  return { info, syncNow: run, noteLocalChanges };
}
