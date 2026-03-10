import React, { createContext, useContext } from 'react';
import { useAppData } from './store';

type AppDataReturn = ReturnType<typeof useAppData>;

const DataContext = createContext<AppDataReturn | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const appData = useAppData();
  return <DataContext.Provider value={appData}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
