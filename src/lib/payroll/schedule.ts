// /lib/payroll/schedule.ts

import type { ContractSnapshot } from '@/types/contracts';
import { addDays, addWeeks, addMonths, startOfDay } from 'date-fns';

/**
 * Given when work happened, return when the payment should land
 * based on the contract's pay schedule, anchor date, and delay.
 *
 * Strategy: walk forward from anchor_date in `schedule` increments
 * until past work_date — that's the period end. Add delay_days.
 */
export function calculateExpectedPayDate(
  workDate: Date,
  snapshot: ContractSnapshot
): Date {
  const anchor = snapshot.pay_schedule_anchor_date
    ? new Date(snapshot.pay_schedule_anchor_date)
    : workDate;
  const work = startOfDay(workDate);
  
  let cursor = startOfDay(anchor);
  const step = stepForSchedule(snapshot.pay_schedule);
  
  while (cursor < work) {
    cursor = step(cursor);
  }
  
  return addDays(cursor, snapshot.pay_delay_days);
}

function stepForSchedule(schedule: ContractSnapshot['pay_schedule']) {
  switch (schedule) {
    case 'weekly':       return (d: Date) => addWeeks(d, 1);
    case 'biweekly':     return (d: Date) => addWeeks(d, 2);
    case 'semimonthly':  return (d: Date) => addDays(d, 15);
    case 'monthly':      return (d: Date) => addMonths(d, 1);
    case 'custom':       return (d: Date) => addWeeks(d, 2); // fallback
  }
}
