import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isDuplicateJob } from './jobDedup';

// ── Interfaces (unchanged) ──────────────────────────────────────────────────

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

export interface AppData {
  jobs: Job[];
  expenses: Expense[];
  income: Income[];
  equipment: Equipment[];
}

// ── Snake ↔ Camel mappers ───────────────────────────────────────────────────

// DB row → App object
function jobFromRow(r: Record<string, unknown>): Job {
  return {
    id: r.id as string,
    jobNumber: r.job_number as string | undefined,
    name: r.name as string,
    client: r.client as string,
    venue: r.venue as string,
    date: r.date as string,
    startTime: r.start_time as string | undefined,
    endTime: r.end_time as string | undefined,
    status: r.status as Job['status'],
    paySchedule: r.pay_schedule as Job['paySchedule'],
    payPeriodStart: r.pay_period_start as string | undefined,
    payrollCompany: r.payroll_company as string | undefined,
    hourlyRate: r.hourly_rate as number | undefined,
    minimumHours: r.minimum_hours as number | undefined,
    has6th7thDayRule: r.has_6th_7th_day_rule as boolean | undefined,
    hasVacationPay: r.has_vacation_pay as boolean | undefined,
    steward: r.steward as string | undefined,
    parkingCost: r.parking_cost as number | undefined,
    hoursWorked: r.hours_worked as number | undefined,
    mealPenalties: r.meal_penalties as number | undefined,
    mealType: r.meal_type as Job['mealType'],
    attachments: r.attachments as string[] | undefined,
    notes: r.notes as string,
    createdAt: r.created_at as string,
  };
}

// App object → DB row (for insert/update)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jobToRow(j: Partial<Job> & { userId?: string }): any {
  const row: Record<string, unknown> = {};
  if (j.userId !== undefined) row.user_id = j.userId;
  if (j.jobNumber !== undefined) row.job_number = j.jobNumber;
  if (j.name !== undefined) row.name = j.name;
  if (j.client !== undefined) row.client = j.client;
  if (j.venue !== undefined) row.venue = j.venue;
  if (j.date !== undefined) row.date = j.date;
  if (j.startTime !== undefined) row.start_time = j.startTime;
  if (j.endTime !== undefined) row.end_time = j.endTime;
  if (j.status !== undefined) row.status = j.status;
  if (j.paySchedule !== undefined) row.pay_schedule = j.paySchedule;
  if (j.payPeriodStart !== undefined) row.pay_period_start = j.payPeriodStart;
  if (j.payrollCompany !== undefined) row.payroll_company = j.payrollCompany;
  if (j.hourlyRate !== undefined) row.hourly_rate = j.hourlyRate;
  if (j.minimumHours !== undefined) row.minimum_hours = j.minimumHours;
  if (j.has6th7thDayRule !== undefined) row.has_6th_7th_day_rule = j.has6th7thDayRule;
  if (j.hasVacationPay !== undefined) row.has_vacation_pay = j.hasVacationPay;
  if (j.steward !== undefined) row.steward = j.steward;
  if (j.parkingCost !== undefined) row.parking_cost = j.parkingCost;
  if (j.hoursWorked !== undefined) row.hours_worked = j.hoursWorked;
  if (j.mealPenalties !== undefined) row.meal_penalties = j.mealPenalties;
  if (j.mealType !== undefined) row.meal_type = j.mealType;
  if (j.attachments !== undefined) row.attachments = j.attachments;
  if (j.notes !== undefined) row.notes = j.notes;
  return row;
}

function expenseFromRow(r: Record<string, unknown>): Expense {
  return {
    id: r.id as string,
    jobId: r.job_id as string | undefined,
    category: r.category as string,
    description: r.description as string,
    amount: Number(r.amount),
    date: r.date as string,
    receipt: r.receipt as string | undefined,
    createdAt: r.created_at as string,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expenseToRow(e: Partial<Expense> & { userId?: string }): any {
  const row: Record<string, unknown> = {};
  if (e.userId !== undefined) row.user_id = e.userId;
  if (e.jobId !== undefined) row.job_id = e.jobId;
  if (e.category !== undefined) row.category = e.category;
  if (e.description !== undefined) row.description = e.description;
  if (e.amount !== undefined) row.amount = e.amount;
  if (e.date !== undefined) row.date = e.date;
  if (e.receipt !== undefined) row.receipt = e.receipt;
  return row;
}

function incomeFromRow(r: Record<string, unknown>): Income {
  return {
    id: r.id as string,
    jobId: r.job_id as string | undefined,
    client: r.client as string,
    description: r.description as string,
    amount: Number(r.amount),
    date: r.date as string,
    status: r.status as Income['status'],
    invoiceNumber: r.invoice_number as string | undefined,
    createdAt: r.created_at as string,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function incomeToRow(i: Partial<Income> & { userId?: string }): any {
  const row: Record<string, unknown> = {};
  if (i.userId !== undefined) row.user_id = i.userId;
  if (i.jobId !== undefined) row.job_id = i.jobId;
  if (i.client !== undefined) row.client = i.client;
  if (i.description !== undefined) row.description = i.description;
  if (i.amount !== undefined) row.amount = i.amount;
  if (i.date !== undefined) row.date = i.date;
  if (i.status !== undefined) row.status = i.status;
  if (i.invoiceNumber !== undefined) row.invoice_number = i.invoiceNumber;
  return row;
}

function equipmentFromRow(r: Record<string, unknown>): Equipment {
  return {
    id: r.id as string,
    name: r.name as string,
    category: r.category as string,
    serialNumber: r.serial_number as string | undefined,
    purchaseDate: r.purchase_date as string | undefined,
    value: r.value as number | undefined,
    status: r.status as Equipment['status'],
    assignedJobId: r.assigned_job_id as string | undefined,
    notes: r.notes as string,
    createdAt: r.created_at as string,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function equipmentToRow(e: Partial<Equipment> & { userId?: string }): any {
  const row: Record<string, unknown> = {};
  if (e.userId !== undefined) row.user_id = e.userId;
  if (e.name !== undefined) row.name = e.name;
  if (e.category !== undefined) row.category = e.category;
  if (e.serialNumber !== undefined) row.serial_number = e.serialNumber;
  if (e.purchaseDate !== undefined) row.purchase_date = e.purchaseDate;
  if (e.value !== undefined) row.value = e.value;
  if (e.status !== undefined) row.status = e.status;
  if (e.assignedJobId !== undefined) row.assigned_job_id = e.assignedJobId;
  if (e.notes !== undefined) row.notes = e.notes;
  return row;
}

// ── Local cache (offline fallback) ──────────────────────────────────────────

const CACHE_KEY = 'av-bookkeeper-data';

const defaultData: AppData = { jobs: [], expenses: [], income: [], equipment: [] };

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

// ── Legacy localStorage data (pre-Supabase) for migration ────────────────

export function hasLegacyData(): boolean {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    return (d.jobs?.length > 0 || d.expenses?.length > 0 || d.income?.length > 0 || d.equipment?.length > 0);
  } catch {
    return false;
  }
}

export function getLegacyData(): AppData {
  return loadCache();
}

export function clearLegacyData() {
  localStorage.removeItem(CACHE_KEY);
}

export async function clearAllData() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (uid) {
      await Promise.all([
        supabase.from('jobs').delete().eq('user_id', uid),
        supabase.from('expenses').delete().eq('user_id', uid),
        supabase.from('income').delete().eq('user_id', uid),
        supabase.from('equipment').delete().eq('user_id', uid),
      ]);
    }
  } catch {
    // Ignore Supabase errors — still clear local data
  }
  localStorage.removeItem(CACHE_KEY);
  window.location.href = '/';
}

// ── Main hook ───────────────────────────────────────────────────────────────

export function useAppData(userId: string | null) {
  const [data, setData] = useState<AppData>(loadCache);
  const [loading, setLoading] = useState(true);
  const dataRef = useRef(data);

  // Keep ref in sync with state so callbacks always see latest data
  useEffect(() => { dataRef.current = data; }, [data]);

  // Fetch all data from Supabase on mount / user change
  useEffect(() => {
    // Always clear stale data immediately when userId changes (sign in/out/switch)
    // Prevents previous user's cached data from leaking into a new session
    setData(defaultData);
    localStorage.removeItem(CACHE_KEY);

    if (!userId) { setLoading(false); return; }

    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      const [jobsRes, expRes, incRes, eqRes] = await Promise.all([
        supabase.from('jobs').select('*').order('date', { ascending: false }),
        supabase.from('expenses').select('*').order('date', { ascending: false }),
        supabase.from('income').select('*').order('date', { ascending: false }),
        supabase.from('equipment').select('*').order('created_at', { ascending: false }),
      ]);

      if (cancelled) return;

      const newData: AppData = {
        jobs: (jobsRes.data || []).map(r => jobFromRow(r as Record<string, unknown>)),
        expenses: (expRes.data || []).map(r => expenseFromRow(r as Record<string, unknown>)),
        income: (incRes.data || []).map(r => incomeFromRow(r as Record<string, unknown>)),
        equipment: (eqRes.data || []).map(r => equipmentFromRow(r as Record<string, unknown>)),
      };

      setData(newData);
      saveCache(newData);
      setLoading(false);
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [userId]);

  // ── Jobs ──────────────────────────────────────────────────────────────────

  const addJob = useCallback(async (job: Omit<Job, 'id' | 'createdAt'>): Promise<Job | null> => {
    if (!userId) throw new Error('Not signed in — please refresh and try again');

    // Check dedup against current data via ref (never stale, never hangs)
    if (isDuplicateJob(job, dataRef.current.jobs)) return null;

    const { data: rows, error } = await supabase
      .from('jobs')
      .insert(jobToRow({ ...job, userId }))
      .select();

    if (error) {
      console.error('addJob error:', error);
      throw new Error(error.message);
    }
    if (!rows?.length) return null;

    const newJob = jobFromRow(rows[0] as Record<string, unknown>);
    // Update ref immediately so back-to-back addJob calls see the new job
    // before React has a chance to re-render and run the useEffect sync
    dataRef.current = { ...dataRef.current, jobs: [...dataRef.current.jobs, newJob] };
    setData(prev => {
      const updated = { ...prev, jobs: [...prev.jobs, newJob] };
      saveCache(updated);
      return updated;
    });
    return newJob;
  }, [userId]);

  const updateJob = useCallback(async (id: string, updates: Partial<Job>) => {
    // Optimistic update
    setData(prev => {
      const updated = { ...prev, jobs: prev.jobs.map(j => j.id === id ? { ...j, ...updates } : j) };
      saveCache(updated);
      return updated;
    });

    const { error } = await supabase
      .from('jobs')
      .update(jobToRow(updates))
      .eq('id', id);

    if (error) console.error('updateJob:', error);
  }, []);

  const deleteJob = useCallback(async (id: string) => {
    setData(prev => {
      const updated = { ...prev, jobs: prev.jobs.filter(j => j.id !== id) };
      saveCache(updated);
      return updated;
    });

    const { error } = await supabase.from('jobs').delete().eq('id', id);
    if (error) console.error('deleteJob:', error);
  }, []);

  // ── Expenses ──────────────────────────────────────────────────────────────

  const addExpense = useCallback(async (expense: Omit<Expense, 'id' | 'createdAt'>) => {
    if (!userId) return;

    const { data: rows, error } = await supabase
      .from('expenses')
      .insert(expenseToRow({ ...expense, userId }))
      .select();

    if (error) { console.error('addExpense:', error); return; }
    if (!rows?.length) return;

    const newExp = expenseFromRow(rows[0] as Record<string, unknown>);
    setData(prev => {
      const updated = { ...prev, expenses: [...prev.expenses, newExp] };
      saveCache(updated);
      return updated;
    });
  }, [userId]);

  const updateExpense = useCallback(async (id: string, updates: Partial<Expense>) => {
    setData(prev => {
      const updated = { ...prev, expenses: prev.expenses.map(e => e.id === id ? { ...e, ...updates } : e) };
      saveCache(updated);
      return updated;
    });

    const { error } = await supabase.from('expenses').update(expenseToRow(updates)).eq('id', id);
    if (error) console.error('updateExpense:', error);
  }, []);

  const deleteExpense = useCallback(async (id: string) => {
    setData(prev => {
      const updated = { ...prev, expenses: prev.expenses.filter(e => e.id !== id) };
      saveCache(updated);
      return updated;
    });

    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) console.error('deleteExpense:', error);
  }, []);

  // ── Income ────────────────────────────────────────────────────────────────

  const addIncome = useCallback(async (income: Omit<Income, 'id' | 'createdAt'>) => {
    if (!userId) return;

    const { data: rows, error } = await supabase
      .from('income')
      .insert(incomeToRow({ ...income, userId }))
      .select();

    if (error) { console.error('addIncome:', error); return; }
    if (!rows?.length) return;

    const newInc = incomeFromRow(rows[0] as Record<string, unknown>);
    setData(prev => {
      const updated = { ...prev, income: [...prev.income, newInc] };
      saveCache(updated);
      return updated;
    });
  }, [userId]);

  const updateIncome = useCallback(async (id: string, updates: Partial<Income>) => {
    setData(prev => {
      const updated = { ...prev, income: prev.income.map(i => i.id === id ? { ...i, ...updates } : i) };
      saveCache(updated);
      return updated;
    });

    const { error } = await supabase.from('income').update(incomeToRow(updates)).eq('id', id);
    if (error) console.error('updateIncome:', error);
  }, []);

  const deleteIncome = useCallback(async (id: string) => {
    setData(prev => {
      const updated = { ...prev, income: prev.income.filter(i => i.id !== id) };
      saveCache(updated);
      return updated;
    });

    const { error } = await supabase.from('income').delete().eq('id', id);
    if (error) console.error('deleteIncome:', error);
  }, []);

  // ── Equipment ─────────────────────────────────────────────────────────────

  const addEquipment = useCallback(async (equip: Omit<Equipment, 'id' | 'createdAt'>) => {
    if (!userId) return;

    const { data: rows, error } = await supabase
      .from('equipment')
      .insert(equipmentToRow({ ...equip, userId }))
      .select();

    if (error) { console.error('addEquipment:', error); return; }
    if (!rows?.length) return;

    const newEq = equipmentFromRow(rows[0] as Record<string, unknown>);
    setData(prev => {
      const updated = { ...prev, equipment: [...prev.equipment, newEq] };
      saveCache(updated);
      return updated;
    });
  }, [userId]);

  const updateEquipment = useCallback(async (id: string, updates: Partial<Equipment>) => {
    setData(prev => {
      const updated = { ...prev, equipment: prev.equipment.map(e => e.id === id ? { ...e, ...updates } : e) };
      saveCache(updated);
      return updated;
    });

    const { error } = await supabase.from('equipment').update(equipmentToRow(updates)).eq('id', id);
    if (error) console.error('updateEquipment:', error);
  }, []);

  const deleteEquipment = useCallback(async (id: string) => {
    setData(prev => {
      const updated = { ...prev, equipment: prev.equipment.filter(e => e.id !== id) };
      saveCache(updated);
      return updated;
    });

    const { error } = await supabase.from('equipment').delete().eq('id', id);
    if (error) console.error('deleteEquipment:', error);
  }, []);

  // ── Migrate local data to Supabase ────────────────────────────────────────

  const migrateLocalData = useCallback(async (localData: AppData) => {
    if (!userId) return 0;
    let count = 0;

    // Insert jobs (map old IDs to new ones for FK references)
    const idMap = new Map<string, string>();
    for (const job of localData.jobs) {
      const { data: rows } = await supabase
        .from('jobs')
        .insert(jobToRow({ ...job, userId }))
        .select('id');
      if (rows?.[0]) {
        idMap.set(job.id, rows[0].id as string);
        count++;
      }
    }

    // Insert expenses
    for (const exp of localData.expenses) {
      const mapped = { ...exp, userId, jobId: exp.jobId ? idMap.get(exp.jobId) : undefined };
      await supabase.from('expenses').insert(expenseToRow(mapped));
      count++;
    }

    // Insert income
    for (const inc of localData.income) {
      const mapped = { ...inc, userId, jobId: inc.jobId ? idMap.get(inc.jobId) : undefined };
      await supabase.from('income').insert(incomeToRow(mapped));
      count++;
    }

    // Insert equipment
    for (const eq of localData.equipment) {
      const mapped = { ...eq, userId, assignedJobId: eq.assignedJobId ? idMap.get(eq.assignedJobId) : undefined };
      await supabase.from('equipment').insert(equipmentToRow(mapped));
      count++;
    }

    // Refresh data from Supabase
    const [jobsRes, expRes, incRes, eqRes] = await Promise.all([
      supabase.from('jobs').select('*').order('date', { ascending: false }),
      supabase.from('expenses').select('*').order('date', { ascending: false }),
      supabase.from('income').select('*').order('date', { ascending: false }),
      supabase.from('equipment').select('*').order('created_at', { ascending: false }),
    ]);

    const refreshed: AppData = {
      jobs: (jobsRes.data || []).map(r => jobFromRow(r as Record<string, unknown>)),
      expenses: (expRes.data || []).map(r => expenseFromRow(r as Record<string, unknown>)),
      income: (incRes.data || []).map(r => incomeFromRow(r as Record<string, unknown>)),
      equipment: (eqRes.data || []).map(r => equipmentFromRow(r as Record<string, unknown>)),
    };

    setData(refreshed);
    saveCache(refreshed);
    return count;
  }, [userId]);

  return {
    data,
    loading,
    addJob, updateJob, deleteJob,
    addExpense, updateExpense, deleteExpense,
    addIncome, updateIncome, deleteIncome,
    addEquipment, updateEquipment, deleteEquipment,
    migrateLocalData,
  };
}
