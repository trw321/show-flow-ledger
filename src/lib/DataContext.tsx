import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from './AuthContext';
import {
  useAppData, DEVICE_LEDGER_KEY, EMPTY_LEDGER, hasLedger, ledgerKeyFor, loadLedger, prefsKeyFor, rememberedUser, saveLedger,
  type AppData,
} from './store';
import { recordCount, type LedgerChange } from './ledgerDiff';
import { PREFS_SYNCED_EVENT, requestFullPull, unionLedgers } from './sync';
import { useLedgerSync, type SyncInfo } from './useLedgerSync';
import ClaimDeviceDataDialog from '@/components/ClaimDeviceDataDialog';

type AppDataReturn = ReturnType<typeof useAppData>;
type DataContextValue = AppDataReturn & {
  /** False until the right ledger is on screen. Nothing is saved before then. */
  authReady: boolean;
  /** Records in this device's signed-out ledger that no account has. Counted only while signed in. */
  deviceLedgerCount: number;
  /** Gives the signed-in account everything in this device's signed-out ledger. */
  addDeviceDataToAccount: () => Promise<boolean>;
  /** Deletes every record. Signed in, that is from the account and every device on it. */
  deleteEverything: () => Promise<void>;
  /** The account's ledger is on screen but its sign-in has lapsed: nothing syncs until it is signed in again. */
  sessionLapsed: boolean;
};

type SyncContextValue = SyncInfo & { syncNow: () => Promise<void> };

const DataContext = createContext<DataContextValue | null>(null);
const SyncContext = createContext<SyncContextValue>({ status: 'off', pending: 0, syncNow: async () => {} });

const clearDeviceLedger = () => {
  try { localStorage.removeItem(DEVICE_LEDGER_KEY); } catch { /* left as it was */ }
};

/**
 * What follows moving the device's data into an account. Settings come too,
 * unless the account already has its own here — copied unstamped, so that if
 * the account has settings from another device the two are merged rather
 * than one overwriting the other. And the account's whole ledger is read on
 * the next sync, so everything just added that it lacks is found and sent up.
 */
function afterDeviceDataMoved(userId: string) {
  try {
    const signedOut = localStorage.getItem(prefsKeyFor(null));
    if (signedOut && !localStorage.getItem(prefsKeyFor(userId))) {
      const { modifiedAt: _stamp, ...prefs } = JSON.parse(signedOut);
      localStorage.setItem(prefsKeyFor(userId), JSON.stringify(prefs));
      window.dispatchEvent(new Event(PREFS_SYNCED_EVENT));
    }
  } catch {
    // Settings stay where they were.
  }
  requestFullPull(userId);
}

/**
 * Moves the device's data into an account whose ledger nothing on screen
 * holds yet. Storage may be too full for both copies at once; then the
 * device's copy is cleared first, and put back exactly as it was if the
 * account's still won't fit — so the data is never only in memory.
 */
function moveDeviceLedgerInto(userId: string): boolean {
  const accountKey = ledgerKeyFor(userId);
  const device = loadLedger(DEVICE_LEDGER_KEY);
  const account = hasLedger(accountKey) ? loadLedger(accountKey) : EMPTY_LEDGER;
  const merged = unionLedgers(account, device);
  if (!saveLedger(merged, accountKey, { quiet: true })) {
    clearDeviceLedger();
    if (!saveLedger(merged, accountKey, { quiet: true })) {
      saveLedger(device, DEVICE_LEDGER_KEY, { quiet: true });
      return false;
    }
  }
  clearDeviceLedger();
  afterDeviceDataMoved(userId);
  return true;
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  // Bumped when a ledger is created or moved in storage, to look again.
  const [storageTick, setStorageTick] = useState(0);
  const [asking, setAsking] = useState<{ userId: string; device: AppData } | null>(null);

  // Whose ledger is shown: the signed-in account's — or, when the sign-in has
  // lapsed without anyone signing out, the account this device was last
  // signed in to. An expired session must not make the shifts vanish.
  const remembered = !userId && !loading ? rememberedUser() : null;
  const ledgerUserId = userId ?? remembered;
  const accountKey = ledgerUserId ? ledgerKeyFor(ledgerUserId) : null;
  // Which ledger is on screen: none while the session loads or while asking
  // what to do with data from before signing in, then the account's own —
  // never the device's, which another account may have filled.
  const key = loading ? null
    : !accountKey ? DEVICE_LEDGER_KEY
    : hasLedger(accountKey) ? accountKey
    : userId ? null : DEVICE_LEDGER_KEY;
  const sessionLapsed = !userId && !!remembered && key === accountKey;

  // The sync needs the ledger and the ledger reports edits to the sync, so
  // one of them has to reach the other through a ref.
  const noteRef = useRef<(changes: LedgerChange[], key: string) => void>();
  const onLocalChange = useCallback((changes: LedgerChange[], k: string) => noteRef.current?.(changes, k), []);
  const appData = useAppData(key, onLocalChange);
  const { info, syncNow, noteLocalChanges } = useLedgerSync(userId, !!userId && key === ledgerKeyFor(userId), appData);
  noteRef.current = noteLocalChanges;

  // First time this account signs in here.
  useEffect(() => {
    if (loading || !userId || hasLedger(ledgerKeyFor(userId))) {
      setAsking(null);
      return;
    }
    const device = loadLedger(DEVICE_LEDGER_KEY);
    if (recordCount(device) > 0) {
      setAsking({ userId, device });
      return;
    }
    // Nothing here to ask about: the account's copy starts empty and the
    // sync fills it.
    saveLedger(EMPTY_LEDGER, ledgerKeyFor(userId));
    setStorageTick(t => t + 1);
  }, [loading, userId]);

  const [deviceLedgerCount, setDeviceLedgerCount] = useState(0);
  useEffect(() => {
    setDeviceLedgerCount(userId && key ? recordCount(loadLedger(DEVICE_LEDGER_KEY)) : 0);
  }, [userId, key, storageTick]);

  const { applyRemote, replaceAllData } = appData;

  const addDeviceDataToAccount = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const target = ledgerKeyFor(userId);
    let ok: boolean;
    if (key !== target) {
      ok = moveDeviceLedgerInto(userId);
    } else {
      // The account's ledger is on screen, so the merge has to go through it
      // — written behind its back, the next edit would save over it.
      const device = loadLedger(DEVICE_LEDGER_KEY);
      const merge = (prev: AppData) => unionLedgers(prev, device);
      ok = await applyRemote(target, merge);
      if (!ok) {
        clearDeviceLedger();
        ok = await applyRemote(target, merge);
        if (!ok) saveLedger(device, DEVICE_LEDGER_KEY, { quiet: true });
      }
      if (ok) {
        clearDeviceLedger();
        afterDeviceDataMoved(userId);
        void syncNow();
      }
    }
    if (!ok) toast.error("Couldn't add it — this device is out of storage. Nothing was lost.");
    setAsking(null);
    setStorageTick(t => t + 1);
    return ok;
  }, [userId, key, applyRemote, syncNow]);

  const keepSeparate = useCallback(() => {
    if (!userId) return;
    saveLedger(EMPTY_LEDGER, ledgerKeyFor(userId));
    setAsking(null);
    setStorageTick(t => t + 1);
  }, [userId]);

  const deleteEverything = useCallback(async () => {
    await replaceAllData({ jobs: [], expenses: [], income: [], equipment: [], employers: [], events: [], payouts: [] });
  }, [replaceAllData]);

  const value = useMemo<DataContextValue>(() => ({
    ...appData,
    authReady: key !== null,
    deviceLedgerCount,
    addDeviceDataToAccount,
    deleteEverything,
    sessionLapsed,
  }), [appData, key, deviceLedgerCount, addDeviceDataToAccount, deleteEverything, sessionLapsed]);

  const syncValue = useMemo<SyncContextValue>(() => ({ ...info, syncNow }), [info, syncNow]);

  return (
    <DataContext.Provider value={value}>
      <SyncContext.Provider value={syncValue}>
        {children}
        <ClaimDeviceDataDialog
          open={!!asking && asking.userId === userId}
          email={user?.email}
          device={asking?.device ?? null}
          onAdd={() => void addDeviceDataToAccount()}
          onKeepSeparate={keepSeparate}
        />
      </SyncContext.Provider>
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

/** How the account sync is doing. Separate from useData so its ticks don't redraw every page. */
export function useSync() {
  return useContext(SyncContext);
}
