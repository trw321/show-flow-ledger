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
  mealPenalties?: number;
  mealType?: 'YWA' | 'NWA';
  attachments?: string[];
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
  paySchedule?: Job['paySchedule'];
  overtimeRule: 'daily' | 'weekly' | 'none';
  dailyOvertimeThresholdHours?: number;
  dailyDoubletimeThresholdHours?: number;
  weeklyOvertimeThresholdHours?: number;
  overtimeMultiplier?: number;
  doubletimeMultiplier?: number;
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

function loadCache(): AppData {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return defaultData;
    return { ...defaultData, ...JSON.parse(raw) };
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
