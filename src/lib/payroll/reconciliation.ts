// /lib/payroll/reconciliation.ts

import { differenceInDays, startOfDay } from 'date-fns';
import type { Gig, PaymentAllocation } from '@/types/labor';

export interface GigReconciliation {
  gig_id: string;
  expected_pay: number;
  total_allocated: number;
  outstanding: number;
  status: 'unpaid' | 'partial' | 'paid' | 'overpaid';
  is_late: boolean;
  days_overdue: number;
}

export function reconcileGig(
  gig: Gig,
  allocations: PaymentAllocation[],
  today: Date = new Date()
): GigReconciliation {
  const expected = gig.expected_pay ?? 0;
  const totalAllocated = round2(
    allocations
      .filter(a => a.gig_id === gig.id)
      .reduce((sum, a) => sum + Number(a.amount_allocated), 0)
  );
  const outstanding = round2(expected - totalAllocated);
  
  let status: GigReconciliation['status'];
  if (totalAllocated === 0) status = 'unpaid';
  else if (totalAllocated < expected) status = 'partial';
  else if (totalAllocated > expected) status = 'overpaid';
  else status = 'paid';
  
  const expectedDate = gig.expected_pay_date
    ? startOfDay(new Date(gig.expected_pay_date))
    : null;
  const isLate =
    expectedDate != null &&
    totalAllocated < expected &&
    startOfDay(today) > expectedDate;
  const daysOverdue = isLate && expectedDate
    ? differenceInDays(startOfDay(today), expectedDate)
    : 0;
  
  return {
    gig_id: gig.id,
    expected_pay: expected,
    total_allocated: totalAllocated,
    outstanding,
    status,
    is_late: isLate,
    days_overdue: daysOverdue,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
