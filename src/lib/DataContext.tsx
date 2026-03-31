import React, { createContext, useContext } from 'react';
import { useAppData } from './store';
import { useAuth } from './AuthContext';

type AppDataReturn = ReturnType<typeof useAppData>;

const DataContext = createContext<AppDataReturn | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const appData = useAppData(user?.id ?? null);
  return <DataContext.Provider value={appData}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
