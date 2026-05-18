// /lib/payroll/fringe.ts

import type { ContractSnapshot } from '@/types/contracts';

export function calculateFringe(
  subtotal: number,
  snapshot: ContractSnapshot
): { fringeAmount: number; fringeInCheck: boolean } {
  if (snapshot.fringe_percent == null) {
    return { fringeAmount: 0, fringeInCheck: false };
  }
  const fringeAmount = Math.round(subtotal * (snapshot.fringe_percent / 100) * 100) / 100;
  return { fringeAmount, fringeInCheck: snapshot.fringe_in_check };
}
