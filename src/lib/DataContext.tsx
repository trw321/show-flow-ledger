import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAppData } from './store';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

async function ensureSignedIn(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return null;

  const { email, pwd } = getOrCreateCredentials();

  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: pwd });
  if (!signInErr) return null;

  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({ email, password: pwd });
  if (!signUpErr && signUpData.session) return null;

  const { error: anonErr } = await supabase.auth.signInAnonymously();
  if (!anonErr) return null;

  // All methods failed — return combined error message for diagnosis
  return [
    signInErr ? `pw-login: ${signInErr.message}` : null,
    signUpErr ? `signup: ${signUpErr.message}` : (!signUpData?.session ? 'signup: email confirmation required' : null),
    anonErr ? `anon: ${anonErr.message}` : null,
  ].filter(Boolean).join(' | ');
}

type AppDataReturn = ReturnType<typeof useAppData>;
type DataContextValue = AppDataReturn & { authReady: boolean };

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
      setAuthReady(true);
    });

    ensureSignedIn().then(errMsg => {
      if (errMsg) {
        toast.error(`Server connection failed: ${errMsg}`, { duration: 20000 });
      }
      setAuthReady(true);
    });

    const keepalive = setInterval(() => supabase.from('jobs').select('id').limit(1), 4 * 24 * 60 * 60 * 1000);
    return () => { subscription.unsubscribe(); clearInterval(keepalive); };
  }, []);

  const appData = useAppData(userId);
  return <DataContext.Provider value={{ ...appData, authReady }}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}
