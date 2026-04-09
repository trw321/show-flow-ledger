import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAppData } from './store';
import { supabase } from '@/integrations/supabase/client';

type AppDataReturn = ReturnType<typeof useAppData>;

const DataContext = createContext<AppDataReturn | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    // Get current session immediately — avoids race with AuthContext timing
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const appData = useAppData(userId);
  return <DataContext.Provider value={appData}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
