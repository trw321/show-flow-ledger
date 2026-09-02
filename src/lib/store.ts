import { useState, useCallback, useRef } from 'react';
import { isDuplicateJob } from './jobDedup';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  jobNumber?: string;
  name: string;
  client: string;
  venue: string;
  date: string;
  startTime?: string;
  endTime?: string;
  status: 'upcoming' | 'in-progress' | 'completed' | 'cancelled';
  paySchedule?: 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly' | 'per-project';
  payPeriodStart?: string;
  payrollCompany?: string;
  hourlyRate?: number;
  minimumHours?: number;
  has6th7thDayRule?: boolean;
  hasVacationPay?: boolean;
  steward?: string;
  parkingCost?: number;
  hoursWorked?: number;
  /** Minutes taken for the meal break: 0 means no meal was taken (see mealPenalties). */
  mealDuration?: 0 | 30 | 45 | 60;
  /** true = paid/on the clock (no hours deduction), false = unpaid/off the clock (mealDuration is deducted). Irrelevant when mealDuration is 0. */
  mealOnClock?: boolean;
  /** Units of meal-penalty pay owed (each = 1hr at straight rate) — only meaningful when mealDuration is 0. */
  mealPenalties?: number;
  /** For employers with nightPremiumEnabled: were the hours past midnight actually worked (true, gets the premium) vs. just minimum-call padding that was never really worked (false, straight time)? Undefined = not asked yet / not applicable. Superseded by nightPremiumActualHours when that's set — this stays around for the simple all-or-nothing case and old saved jobs. */
  nightPremiumConfirmed?: boolean;
  /** Set only when the worked/padding split of the after-midnight hours isn't all-or-nothing — e.g. 3 calculated night hours but only 1.5 were actually worked, the rest was unworked minimum-call padding. Takes precedence over nightPremiumConfirmed when present. Undefined = not partially split (see nightPremiumConfirmed instead). */
  nightPremiumActualHours?: number;
  attachments?: string[];
  /** Data URI of the uploaded pay stub/check image for this job — lets you flag which jobs still need a stub logged, and eventually compare the stub's actual breakdown against the calculated pay. */
  payStub?: string;
  notes: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  jobId?: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  receipt?: string;
  createdAt: string;
}

export interface Income {
  id: string;
  jobId?: string;
  client: string;
  description: string;
  amount: number;
  date: string;
  status: 'pending' | 'paid' | 'overdue';
  paymentMethod?: 'direct_deposit' | 'check' | 'cash' | 'other';
  invoiceNumber?: string;
  createdAt: string;
}

export interface Equipment {
  id: string;
  name: string;
  category: string;
  serialNumber?: string;
  purchaseDate?: string;
  value?: number;
  status: 'available' | 'deployed' | 'maintenance' | 'retired';
  assignedJobId?: string;
  notes: string;
  createdAt: string;
}

export interface Employer {
  id: string;
  name: string;
  defaultHourlyRate?: number;
  payrollCompany?: string;
  timekeepingApp?: string;
  paySchedule?: Job['paySchedule'];
  overtimeRule: 'daily' | 'weekly' | 'none';
  dailyOvertimeThresholdHours?: number;
  dailyDoubletimeThresholdHours?: number;
  weeklyOvertimeThresholdHours?: number;
  overtimeMultiplier?: number;
  doubletimeMultiplier?: number;
  /** IATSE-style rule: hours actually worked after midnight (or a custom start hour) are paid at nightPremiumMultiplier. Minimum-call padding never gets this — only clock-time-derived worked hours. */
  nightPremiumEnabled?: boolean;
  nightPremiumStartHour?: number; // 0-23, default 0 (midnight)
  nightPremiumEndHour?: number;   // 0-23, optional — undefined means "until end of shift"
  nightPremiumMultiplier?: number; // default 2.0
  /** Percent of gross pay auto-deducted for this employer's union dues (e.g. 3.5 = 3.5%). Undefined/0 = no deduction. */
  unionDuesPercent?: number;
  /** IATSE local number this employer's work falls under (e.g. "16", "8"). Free text — purely informational, shown in exports. */
  unionLocal?: string;
  notes?: string;
  createdAt: string;
}

export interface AppData {
  jobs: Job[];
  expenses: Expense[];
  income: Income[];
  equipment: Equipment[];
  employers: Employer[];
}

// ── localStorage persistence ────────────────────────────────────────────────

const CACHE_KEY = 'av-bookkeeper-data';
const defaultData: AppData = { jobs: [], expenses: [], income: [], equipment: [], employers: [] };

// Old jobs may still carry the retired mealType ('YWA'/'NWA') field instead of
// mealDuration/mealOnClock. Convert on load so historical deduction behavior
// (YWA = 1hr off-clock, NWA = 30min on-clock) stays exactly the same.
function migrateJob(job: Job & { mealType?: 'YWA' | 'NWA' }): Job {
  if (job.mealDuration === undefined && job.mealType) {
    if (job.mealType === 'YWA') { job.mealDuration = 60; job.mealOnClock = false; }
    else if (job.mealType === 'NWA') { job.mealDuration = 30; job.mealOnClock = true; }
  }
  delete job.mealType;
  return job;
}

function loadCache(): AppData {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return defaultData;
    const parsed: AppData = { ...defaultData, ...JSON.parse(raw) };
    parsed.jobs = (parsed.jobs || []).map(migrateJob);
    return parsed;
  } catch {
    return defaultData;
  }
}

function saveCache(data: AppData) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
}

function uid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function clearAllData() {
  localStorage.removeItem(CACHE_KEY);
  window.location.href = '/';
}

// ── Main hook ───────────────────────────────────────────────────────────────

export function useAppData(_userId: string | null) {
  const [data, setData] = useState<AppData>(loadCache);
  const dataRef = useRef(data);

  const update = (updater: (prev: AppData) => AppData) => {
    setData(prev => {
      dataRef.current = prev;
      const next = updater(prev);
      dataRef.current = next;
      saveCache(next);
      return next;
    });
  };

  // ── Jobs ──────────────────────────────────────────────────────────────────

  const addJob = useCallback(async (job: Omit<Job, 'id' | 'createdAt'>): Promise<Job | null> => {
    if (isDuplicateJob(job, dataRef.current.jobs)) return null;
    const newJob: Job = { ...job, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, jobs: [newJob, ...prev.jobs] }));
    return newJob;
  }, []);

  const updateJob = useCallback(async (id: string, updates: Partial<Job>) => {
    update(prev => ({ ...prev, jobs: prev.jobs.map(j => j.id === id ? { ...j, ...updates } : j) }));
  }, []);

  const deleteJob = useCallback(async (id: string) => {
    update(prev => ({ ...prev, jobs: prev.jobs.filter(j => j.id !== id) }));
  }, []);

  // ── Expenses ──────────────────────────────────────────────────────────────

  const addExpense = useCallback(async (expense: Omit<Expense, 'id' | 'createdAt'>) => {
    const newExp: Expense = { ...expense, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, expenses: [newExp, ...prev.expenses] }));
  }, []);

  const updateExpense = useCallback(async (id: string, updates: Partial<Expense>) => {
    update(prev => ({ ...prev, expenses: prev.expenses.map(e => e.id === id ? { ...e, ...updates } : e) }));
  }, []);

  const deleteExpense = useCallback(async (id: string) => {
    update(prev => ({ ...prev, expenses: prev.expenses.filter(e => e.id !== id) }));
  }, []);

  // ── Income ────────────────────────────────────────────────────────────────

  const addIncome = useCallback(async (income: Omit<Income, 'id' | 'createdAt'>) => {
    const newInc: Income = { ...income, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, income: [newInc, ...prev.income] }));
  }, []);

  const updateIncome = useCallback(async (id: string, updates: Partial<Income>) => {
    update(prev => ({ ...prev, income: prev.income.map(i => i.id === id ? { ...i, ...updates } : i) }));
  }, []);

  const deleteIncome = useCallback(async (id: string) => {
    update(prev => ({ ...prev, income: prev.income.filter(i => i.id !== id) }));
  }, []);

  // ── Equipment ─────────────────────────────────────────────────────────────

  const addEquipment = useCallback(async (equip: Omit<Equipment, 'id' | 'createdAt'>) => {
    const newEq: Equipment = { ...equip, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, equipment: [newEq, ...prev.equipment] }));
  }, []);

  const updateEquipment = useCallback(async (id: string, updates: Partial<Equipment>) => {
    update(prev => ({ ...prev, equipment: prev.equipment.map(e => e.id === id ? { ...e, ...updates } : e) }));
  }, []);

  const deleteEquipment = useCallback(async (id: string) => {
    update(prev => ({ ...prev, equipment: prev.equipment.filter(e => e.id !== id) }));
  }, []);

  // ── Employers ─────────────────────────────────────────────────────────────

  const addEmployer = useCallback(async (employer: Omit<Employer, 'id' | 'createdAt'>) => {
    const newEmployer: Employer = { ...employer, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, employers: [newEmployer, ...prev.employers] }));
    return newEmployer;
  }, []);

  const updateEmployer = useCallback(async (id: string, updates: Partial<Employer>) => {
    update(prev => ({ ...prev, employers: prev.employers.map(e => e.id === id ? { ...e, ...updates } : e) }));
  }, []);

  const deleteEmployer = useCallback(async (id: string) => {
    update(prev => ({ ...prev, employers: prev.employers.filter(e => e.id !== id) }));
  }, []);

  return {
    data,
    loading: false,
    addJob, updateJob, deleteJob,
    addExpense, updateExpense, deleteExpense,
    addIncome, updateIncome, deleteIncome,
    addEquipment, updateEquipment, deleteEquipment,
    addEmployer, updateEmployer, deleteEmployer,
  };
}
