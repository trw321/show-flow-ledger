import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

const DEFAULT_PREFS: UserPrefs = { workerType: '1099', tabs: WORKER_PRESETS['1099'] };

function prefsKey(uid?: string | null) {
  return uid ? `av-prefs-${uid}` : 'av-prefs';
}

function loadPrefs(uid?: string | null): UserPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(uid));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      workerType: parsed.workerType ?? DEFAULT_PREFS.workerType,
      tabs: { ...DEFAULT_PREFS.tabs, ...parsed.tabs },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: UserPrefs, uid?: string | null) {
  localStorage.setItem(prefsKey(uid), JSON.stringify(prefs));
}

interface UserPrefsContextValue {
  prefs: UserPrefs;
  setWorkerType: (type: WorkerType) => void;
  setTabEnabled: (tab: TabKey, enabled: boolean) => void;
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

  const update = (next: UserPrefs) => {
    setPrefsState(next);
    savePrefs(next, userId);
  };

  const setWorkerType = (type: WorkerType) => {
    const tabs = type === 'custom' ? prefs.tabs : WORKER_PRESETS[type as 'w2' | '1099' | 'boss'];
    update({ workerType: type, tabs });
  };

  const setTabEnabled = (tab: TabKey, enabled: boolean) => {
    const next = { ...prefs.tabs, [tab]: enabled };
    // Reconciliation reads income records — keep them in sync
    if (tab === 'reconciliation' && enabled) next.income = true;
    if (tab === 'income' && !enabled) next.reconciliation = false;
    update({ workerType: 'custom', tabs: next });
  };

  return (
    <UserPrefsContext.Provider value={{ prefs, setWorkerType, setTabEnabled }}>
      {children}
    </UserPrefsContext.Provider>
  );
}

export function useUserPrefs() {
  const ctx = useContext(UserPrefsContext);
  if (!ctx) throw new Error('useUserPrefs must be used within UserPrefsProvider');
  return ctx;
}
