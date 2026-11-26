import { useEffect, useState } from 'react';

/**
 * A section folded or open, remembered on this phone. Open until folded, and
 * open whenever the phone can't remember (a private window, cleared data).
 */
export function useRememberedOpen(key: string, startOpen = true): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? startOpen : saved === '1';
    } catch {
      return startOpen;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* only a convenience */ }
  }, [key, open]);
  return [open, () => setOpen(o => !o)];
}
