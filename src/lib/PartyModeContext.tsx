import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface PartyModeContextValue {
  partyMode: boolean;
  togglePartyMode: () => void;
}

const PartyModeContext = createContext<PartyModeContextValue>({
  partyMode: true,
  togglePartyMode: () => {},
});

const STORAGE_KEY = 'av-party-mode';

export function PartyModeProvider({ children }: { children: ReactNode }) {
  const [partyMode, setPartyMode] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(partyMode));
  }, [partyMode]);

  const togglePartyMode = () => setPartyMode(p => !p);

  return (
    <PartyModeContext.Provider value={{ partyMode, togglePartyMode }}>
      {children}
    </PartyModeContext.Provider>
  );
}

export function usePartyMode() {
  return useContext(PartyModeContext);
}
