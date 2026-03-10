import { useState, useEffect, useCallback } from 'react';

export interface Job {
  id: string;
  name: string;
  client: string;
  venue: string;
  date: string;
  status: 'upcoming' | 'in-progress' | 'completed' | 'cancelled';
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

const STORAGE_KEY = 'av-bookkeeper-data';

const defaultData: AppData = {
  jobs: [],
  expenses: [],
  income: [],
  equipment: [],
};

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultData, ...JSON.parse(raw) } : defaultData;
  } catch {
    return defaultData;
  }
}

function saveData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function useAppData() {
  const [data, setData] = useState<AppData>(loadData);

  useEffect(() => {
    saveData(data);
  }, [data]);

  const addJob = useCallback((job: Omit<Job, 'id' | 'createdAt'>) => {
    setData(prev => ({
      ...prev,
      jobs: [...prev.jobs, { ...job, id: crypto.randomUUID(), createdAt: new Date().toISOString() }],
    }));
  }, []);

  const updateJob = useCallback((id: string, updates: Partial<Job>) => {
    setData(prev => ({
      ...prev,
      jobs: prev.jobs.map(j => j.id === id ? { ...j, ...updates } : j),
    }));
  }, []);

  const deleteJob = useCallback((id: string) => {
    setData(prev => ({ ...prev, jobs: prev.jobs.filter(j => j.id !== id) }));
  }, []);

  const addExpense = useCallback((expense: Omit<Expense, 'id' | 'createdAt'>) => {
    setData(prev => ({
      ...prev,
      expenses: [...prev.expenses, { ...expense, id: crypto.randomUUID(), createdAt: new Date().toISOString() }],
    }));
  }, []);

  const updateExpense = useCallback((id: string, updates: Partial<Expense>) => {
    setData(prev => ({
      ...prev,
      expenses: prev.expenses.map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  }, []);

  const deleteExpense = useCallback((id: string) => {
    setData(prev => ({ ...prev, expenses: prev.expenses.filter(e => e.id !== id) }));
  }, []);

  const addIncome = useCallback((income: Omit<Income, 'id' | 'createdAt'>) => {
    setData(prev => ({
      ...prev,
      income: [...prev.income, { ...income, id: crypto.randomUUID(), createdAt: new Date().toISOString() }],
    }));
  }, []);

  const updateIncome = useCallback((id: string, updates: Partial<Income>) => {
    setData(prev => ({
      ...prev,
      income: prev.income.map(i => i.id === id ? { ...i, ...updates } : i),
    }));
  }, []);

  const deleteIncome = useCallback((id: string) => {
    setData(prev => ({ ...prev, income: prev.income.filter(i => i.id !== id) }));
  }, []);

  const addEquipment = useCallback((equip: Omit<Equipment, 'id' | 'createdAt'>) => {
    setData(prev => ({
      ...prev,
      equipment: [...prev.equipment, { ...equip, id: crypto.randomUUID(), createdAt: new Date().toISOString() }],
    }));
  }, []);

  const updateEquipment = useCallback((id: string, updates: Partial<Equipment>) => {
    setData(prev => ({
      ...prev,
      equipment: prev.equipment.map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  }, []);

  const deleteEquipment = useCallback((id: string) => {
    setData(prev => ({ ...prev, equipment: prev.equipment.filter(e => e.id !== id) }));
  }, []);

  return {
    data,
    addJob, updateJob, deleteJob,
    addExpense, updateExpense, deleteExpense,
    addIncome, updateIncome, deleteIncome,
    addEquipment, updateEquipment, deleteEquipment,
  };
}
