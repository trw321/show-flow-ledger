import React, { createContext, useContext, useState, useEffect } from 'react';
import { EMPTY_PROFILE, type PayerProfile } from '@/lib/payerProfile';
import { supabase } from '@/integrations/supabase/client';
import { prefsKeyFor } from '@/lib/store';
import { PREFS_CHANGED_EVENT, PREFS_SYNCED_EVENT } from '@/lib/sync';
import { stampNow } from '@/lib/ledgerDiff';

// Calendar/log/reconciliation/equipment/taxes/discover/scheduling used to be
// keys here too, but nothing in the app ever actually read those tabs (only
// expenses/income are checked anywhere) and their pages are gone — Log &
// Calendar and Pay are core to the app now, not something to hide. Down to
// just the genuinely optional secondary features.
export type TabKey = 'expenses' | 'income' | 'payouts';

export type WorkerType = 'w2' | '1099' | 'boss' | 'custom';

export interface UserPrefs {
  workerType: WorkerType;
  tabs: Record<TabKey, boolean>;
  /** Tax, exempt status and what each local charges — see payerProfile. */
  payer: PayerProfile;
}

export const TAB_LABELS: Record<TabKey, { label: string; description: string }> = {
  expenses: { label: 'Expenses', description: 'Track deductible business expenses (1099)' },
  income:   { label: 'Income',   description: 'Invoice tracking and payment records' },
  payouts:  { label: 'Pay Outs', description: 'Record and track payments made to crew' },
};

export const WORKER_PRESETS: Record<'w2' | '1099' | 'boss', Record<TabKey, boolean>> = {
  w2:     { expenses: false, income: true, payouts: false },
  '1099': { expenses: true,  income: true, payouts: false },
  boss:   { expenses: true,  income: true, payouts: true },
};

const DEFAULT_PREFS: UserPrefs = { workerType: '1099', tabs: WORKER_PRESETS['1099'], payer: EMPTY_PROFILE };

function loadPrefs(uid?: string | null): UserPrefs {
  try {
    const raw = localStorage.getItem(prefsKeyFor(uid));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      workerType: parsed.workerType ?? DEFAULT_PREFS.workerType,
      tabs: { ...DEFAULT_PREFS.tabs, ...parsed.tabs },
      // Saved before the payer profile existed: start empty rather than
      // undefined, so every reader can assume the shape is there.
      payer: { ...EMPTY_PROFILE, ...(parsed.payer ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// Stamped with the time so that, signed in, the newest change wins on every
// device — and announced so the sync sends it up.
function savePrefs(prefs: UserPrefs, uid?: string | null) {
  try {
    localStorage.setItem(prefsKeyFor(uid), JSON.stringify({ ...prefs, modifiedAt: stampNow() }));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(PREFS_CHANGED_EVENT));
}

interface UserPrefsContextValue {
  prefs: UserPrefs;
  setWorkerType: (type: WorkerType) => void;
  setTabEnabled: (tab: TabKey, enabled: boolean) => void;
  setPayer: (payer: PayerProfile) => void;
}

const UserPrefsContext = createContext<UserPrefsContextValue | null>(null);

export function UserPrefsProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<UserPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      setPrefsState(loadPrefs(uid));
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      setPrefsState(loadPrefs(uid));
    });
    return () => subscription.unsubscribe();
  }, []);

  // Settings changed on another device, and the sync has just saved them here.
  useEffect(() => {
    const reload = () => setPrefsState(loadPrefs(userId));
    window.addEventListener(PREFS_SYNCED_EVENT, reload);
    return () => window.removeEventListener(PREFS_SYNCED_EVENT, reload);
  }, [userId]);

  const update = (next: UserPrefs) => {
    setPrefsState(next);
    savePrefs(next, userId);
  };

  const setWorkerType = (type: WorkerType) => {
    const tabs = type === 'custom' ? prefs.tabs : WORKER_PRESETS[type as 'w2' | '1099' | 'boss'];
    update({ ...prefs, workerType: type, tabs });
  };

  // Your tax rate, whether the W2 was filed exempt, and what each local
  // charges — see payerProfile for why these are not the employer's.
  const setPayer = (payer: PayerProfile) => update({ ...prefs, payer });

  const setTabEnabled = (tab: TabKey, enabled: boolean) => {
    const next = { ...prefs.tabs, [tab]: enabled };
    // Reconciliation used to be its own tab and had to be kept in step with
    // income. It is a section inside Income now, so there is nothing to sync.
    update({ ...prefs, workerType: 'custom', tabs: next });
  };

  return (
    <UserPrefsContext.Provider value={{ prefs, setWorkerType, setTabEnabled, setPayer }}>
      {children}
    </UserPrefsContext.Provider>
  );
}

export function useUserPrefs() {
  const ctx = useContext(UserPrefsContext);
  if (!ctx) throw new Error('useUserPrefs must be used within UserPrefsProvider');
  return ctx;
}
