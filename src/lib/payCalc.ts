import type { Job } from './store';
import { parseISO, differenceInCalendarDays, startOfDay } from 'date-fns';

/**
 * Calculate the pay for a single day's work, applying:
 * - Minimum hours (e.g. 5-hour minimum)
 * - Overtime: 8-12hrs = 1.5x, 12+ = 2x
 * - Meal penalties: each = 1 hour at straight rate
 */
export function calculateDayPay(
  actualHours: number,
  rate: number,
  minimumHours: number = 0,
  mealPenalties: number = 0,
  dayMultiplier: number = 1,
  mealType?: 'YWA' | 'NWA'
): { billableHours: number; totalPay: number; breakdown: string[] } {
  // YWA = 1hr walk-away off the clock (deduct from hours)
  // NWA = 30min meal on the clock (no deduction)
  const mealDeduction = mealType === 'YWA' ? 1 : 0;
  const adjustedHours = Math.max(0, actualHours - mealDeduction);
  const billableHours = Math.max(adjustedHours, minimumHours);
  const effectiveRate = rate * dayMultiplier;
  const breakdown: string[] = [];

  if (mealType === 'YWA') {
    breakdown.push(`YWA: ${actualHours}h − 1h walk-away = ${adjustedHours}h`);
  } else if (mealType === 'NWA') {
    breakdown.push(`NWA: 30min meal on clock (no deduction)`);
  }

  let pay = 0;

  if (billableHours <= 8) {
    pay = billableHours * effectiveRate;
    breakdown.push(`${billableHours}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (billableHours <= 12) {
    const straightPay = 8 * effectiveRate;
    const otHours = billableHours - 8;
    const otPay = otHours * effectiveRate * 1.5;
    pay = straightPay + otPay;
    breakdown.push(`8h straight × $${effectiveRate.toFixed(2)} = $${straightPay.toFixed(2)}`);
    breakdown.push(`${otHours}h OT (1.5×) × $${effectiveRate.toFixed(2)} = $${otPay.toFixed(2)}`);
  } else {
    const straightPay = 8 * effectiveRate;
    const otPay = 4 * effectiveRate * 1.5;
    const dtHours = billableHours - 12;
    const dtPay = dtHours * effectiveRate * 2;
    pay = straightPay + otPay + dtPay;
    breakdown.push(`8h straight × $${effectiveRate.toFixed(2)} = $${straightPay.toFixed(2)}`);
    breakdown.push(`4h OT (1.5×) × $${effectiveRate.toFixed(2)} = $${otPay.toFixed(2)}`);
    breakdown.push(`${dtHours}h DT (2×) × $${effectiveRate.toFixed(2)} = $${dtPay.toFixed(2)}`);
  }

  if (mealPenalties > 0) {
    const mpPay = mealPenalties * rate;
    pay += mpPay;
    breakdown.push(`${mealPenalties} meal penalty × $${rate.toFixed(2)} = $${mpPay.toFixed(2)}`);
  }

  if (minimumHours > 0 && actualHours < minimumHours) {
    breakdown.unshift(`${actualHours}h worked → ${minimumHours}h minimum applied`);
  }

  if (dayMultiplier > 1) {
    breakdown.unshift(`Day multiplier: ${dayMultiplier}× (${dayMultiplier === 1.5 ? '6th day' : '7th day'})`);
  }

  return { billableHours, totalPay: pay, breakdown };
}

/**
 * Determine the day multiplier for 6th/7th consecutive day rules.
 * Looks at all jobs for the same client in the surrounding period.
 */
export function getDayMultiplier(
  entryDate: string,
  client: string,
  allJobs: Job[],
  has6th7thDayRule: boolean
): number {
  if (!has6th7thDayRule) return 1;

  const targetDate = startOfDay(parseISO(entryDate));

  const relevantJobs = allJobs.filter(
    j => j.client === client && (j.hoursWorked ?? 0) > 0
  );

  const workDates = [...new Set(relevantJobs.map(j => j.date))]
    .map(d => startOfDay(parseISO(d)))
    .sort((a, b) => a.getTime() - b.getTime());

  let consecutiveDays = 1;
  const targetIdx = workDates.findIndex(d => d.getTime() === targetDate.getTime());
  if (targetIdx < 0) return 1;

  for (let i = targetIdx - 1; i >= 0; i--) {
    const diff = differenceInCalendarDays(workDates[i + 1], workDates[i]);
    if (diff === 1) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  if (consecutiveDays >= 7) return 2;
  if (consecutiveDays >= 6) return 1.5;
  return 1;
}

/**
 * Calculate expected pay for a set of jobs (with hours worked).
 */
export function calculateExpectedPay(
  jobs: Job[],
  referenceJob: Job,
  allJobs: Job[]
): { total: number; details: { date: string; hours: number; pay: number; breakdown: string[] }[] } {
  const details: { date: string; hours: number; pay: number; breakdown: string[] }[] = [];
  let total = 0;

  // Group by date
  const byDate = new Map<string, { hours: number; mealPenalties: number; rate: number; mealType?: 'YWA' | 'NWA' }>();
  for (const job of jobs) {
    const hours = job.hoursWorked ?? 0;
    if (hours <= 0) continue;
    const rate = job.hourlyRate || referenceJob.hourlyRate || 0;
    const existing = byDate.get(job.date) || { hours: 0, mealPenalties: 0, rate, mealType: job.mealType };
    existing.hours += hours;
    existing.mealPenalties += job.mealPenalties || 0;
    existing.rate = rate;
    if (job.mealType) existing.mealType = job.mealType;
    byDate.set(job.date, existing);
  }

  for (const [date, { hours, mealPenalties, rate, mealType }] of byDate.entries()) {
    const dayMultiplier = getDayMultiplier(date, referenceJob.client, allJobs, referenceJob.has6th7thDayRule || false);
    const result = calculateDayPay(hours, rate, referenceJob.minimumHours || 0, mealPenalties, dayMultiplier, mealType);
    total += result.totalPay;
    details.push({ date, hours, pay: result.totalPay, breakdown: result.breakdown });
  }

  // Vacation pay: 8% of gross earnings (common union benefit)
  if (referenceJob.hasVacationPay && total > 0) {
    const vacPay = total * 0.08;
    total += vacPay;
    details.push({
      date: '',
      hours: 0,
      pay: vacPay,
      breakdown: [`Vacation pay (8% of gross) = $${vacPay.toFixed(2)}`],
    });
  }

  return { total, details };
}
