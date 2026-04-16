import React, { createContext, useContext, useState } from 'react';
import { useAppData } from './store';

const DEVICE_ID_KEY = 'showflow-device-id';

function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

type AppDataReturn = ReturnType<typeof useAppData>;
type DataContextValue = AppDataReturn & { authReady: boolean };

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [userId] = useState(() => getDeviceId());

  const appData = useAppData(userId);
  return (
    <DataContext.Provider value={{ ...appData, authReady: true }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
