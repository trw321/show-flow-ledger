import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAppData } from './store';
import { supabase } from '@/integrations/supabase/client';

const CRED_EMAIL_KEY = 'showflow-cred-email';
const CRED_PWD_KEY   = 'showflow-cred-pwd';

function getOrCreateCredentials() {
  let email = localStorage.getItem(CRED_EMAIL_KEY);
  let pwd   = localStorage.getItem(CRED_PWD_KEY);
  if (!email || !pwd) {
    const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(12)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    email = `device-${rand()}@avledger.app`;
    pwd   = rand() + rand();
    localStorage.setItem(CRED_EMAIL_KEY, email);
    localStorage.setItem(CRED_PWD_KEY, pwd);
  }
  return { email, pwd };
}

async function ensureSignedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return;

  const { email, pwd } = getOrCreateCredentials();

  // Try sign-in with stored device credentials
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: pwd });
  if (!signInErr) return;

  // New device — create account (requires email confirmations OFF in Supabase)
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email, password: pwd });
  if (!signUpErr && signUpData.session) return;

  // Fallback: anonymous sign-in (requires anonymous auth ON in Supabase)
  await supabase.auth.signInAnonymously();
}

type AppDataReturn = ReturnType<typeof useAppData>;

const DataContext = createContext<AppDataReturn | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    ensureSignedIn();

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
