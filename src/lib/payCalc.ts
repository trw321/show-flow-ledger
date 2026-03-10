import type { Job, TimeEntry } from './store';
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
  dayMultiplier: number = 1 // 1 = normal, 1.5 = 6th day, 2 = 7th day
): { billableHours: number; totalPay: number; breakdown: string[] } {
  const billableHours = Math.max(actualHours, minimumHours);
  const effectiveRate = rate * dayMultiplier;
  const breakdown: string[] = [];

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
    const mpPay = mealPenalties * rate; // meal penalty at base straight rate (not multiplied)
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
 * Looks at all time entries for the same job/client in the surrounding period.
 */
export function getDayMultiplier(
  entryDate: string,
  jobId: string | undefined,
  client: string,
  allEntries: TimeEntry[],
  has6th7thDayRule: boolean
): number {
  if (!has6th7thDayRule) return 1;

  const targetDate = startOfDay(parseISO(entryDate));

  // Find all entries for same job/client
  const relevantEntries = allEntries.filter(
    e => (e.jobId && e.jobId === jobId) || e.client === client
  );

  // Get unique work dates sorted
  const workDates = [...new Set(relevantEntries.map(e => e.date))]
    .map(d => startOfDay(parseISO(d)))
    .sort((a, b) => a.getTime() - b.getTime());

  // Find the consecutive streak ending on or including targetDate
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
 * Calculate expected pay for a set of time entries for a given job.
 */
export function calculateExpectedPay(
  entries: TimeEntry[],
  job: Job,
  allEntries: TimeEntry[]
): { total: number; details: { date: string; hours: number; pay: number; breakdown: string[] }[] } {
  const rate = entries[0]?.rate || job.hourlyRate || 0;
  const details: { date: string; hours: number; pay: number; breakdown: string[] }[] = [];
  let total = 0;

  // Group entries by date
  const byDate = new Map<string, { hours: number; mealPenalties: number; rate: number }>();
  for (const entry of entries) {
    const existing = byDate.get(entry.date) || { hours: 0, mealPenalties: 0, rate: entry.rate || rate };
    existing.hours += entry.hours;
    existing.mealPenalties += entry.mealPenalties || 0;
    existing.rate = entry.rate || rate;
    byDate.set(entry.date, existing);
  }

  for (const [date, { hours, mealPenalties, rate: entryRate }] of byDate.entries()) {
    const dayMultiplier = getDayMultiplier(date, job.id, job.client, allEntries, job.has6th7thDayRule || false);
    const result = calculateDayPay(hours, entryRate, job.minimumHours || 0, mealPenalties, dayMultiplier);
    total += result.totalPay;
    details.push({ date, hours, pay: result.totalPay, breakdown: result.breakdown });
  }

  return { total, details };
}
