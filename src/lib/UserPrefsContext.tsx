import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type TabKey =
  | 'calendar' | 'log' | 'expenses' | 'taxes'
  | 'income' | 'reconciliation' | 'equipment' | 'discover'
  | 'scheduling' | 'payouts';

export type WorkerType = 'w2' | '1099' | 'boss' | 'custom';

export interface UserPrefs {
  workerType: WorkerType;
  tabs: Record<TabKey, boolean>;
}

export const TAB_LABELS: Record<TabKey, { label: string; description: string }> = {
  calendar:       { label: 'Calendar',        description: 'Monthly view of your gig schedule' },
  log:            { label: 'Job Log',          description: 'Pre-load jobs and log hours on the day' },
  expenses:       { label: 'Expenses',         description: 'Track deductible business expenses (1099)' },
  taxes:          { label: 'Taxes',            description: 'Quarterly tax estimates and breakdowns' },
  income:         { label: 'Income',           description: 'Invoice tracking and payment records' },
  reconciliation: { label: 'Reconciliation',   description: 'Verify your paychecks match hours worked' },
  equipment:      { label: 'Equipment',        description: 'Track your gear, serial numbers, and values' },
  discover:       { label: 'Discover',         description: 'Crew resources and industry tools' },
  scheduling:     { label: 'Scheduling',       description: 'Manage crew schedules and timesheets' },
  payouts:        { label: 'Pay Outs',         description: 'Record and track payments made to crew' },
};

export const WORKER_PRESETS: Record<'w2' | '1099' | 'boss', Record<TabKey, boolean>> = {
  w2: {
    calendar: true, log: true, expenses: false, taxes: true,
    income: true, reconciliation: true, equipment: false, discover: true,
    scheduling: false, payouts: false,
  },
  '1099': {
    calendar: true, log: true, expenses: true, taxes: true,
    income: true, reconciliation: true, equipment: false, discover: true,
    scheduling: false, payouts: false,
  },
  boss: {
    calendar: true, log: true, expenses: true, taxes: true,
    income: true, reconciliation: true, equipment: true, discover: true,
    scheduling: true, payouts: true,
  },
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
