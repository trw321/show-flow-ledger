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
    // Keepalive: ping DB every 4 days to prevent Supabase free-tier auto-pause
    const keepalive = setInterval(() => supabase.from('jobs').select('id').limit(1), 4 * 24 * 60 * 60 * 1000);
    return () => { subscription.unsubscribe(); clearInterval(keepalive); };
  }, []);

  const appData = useAppData(userId);
  return <DataContext.Provider value={appData}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
