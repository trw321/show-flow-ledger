import type { Job, Employer } from './store';
import { parseISO, differenceInCalendarDays, startOfDay, startOfWeek, endOfWeek } from 'date-fns';

export interface OvertimeOptions {
  rule?: 'daily' | 'weekly' | 'none';
  otThresholdHours?: number;
  dtThresholdHours?: number;
  otMultiplier?: number;
  dtMultiplier?: number;
}

/**
 * Calculate the pay for a single day's work, applying:
 * - Minimum hours (e.g. 5-hour minimum)
 * - Daily overtime (default 8-12hrs = 1.5x, 12+ = 2x) — only when overtimeOptions.rule is
 *   'daily' (the default, matching every employer that hasn't set an explicit rule).
 *   'weekly'/'none' employers bill straight time here; weekly OT is a separate additive
 *   bonus from calculateWeeklyOvertimeBonus, computed across that employer's whole week.
 * - Meal penalties: each = 1 hour at straight rate
 */
export function calculateDayPay(
  actualHours: number,
  rate: number,
  minimumHours: number = 0,
  mealPenalties: number = 0,
  dayMultiplier: number = 1,
  meal?: { duration?: 0 | 30 | 45 | 60; onClock?: boolean },
  overtimeOptions?: OvertimeOptions
): { billableHours: number; totalPay: number; breakdown: string[] } {
  const otRule = overtimeOptions?.rule ?? 'daily';
  const otThreshold = overtimeOptions?.otThresholdHours ?? 8;
  const dtThreshold = overtimeOptions?.dtThresholdHours ?? 12;
  const otMultiplier = overtimeOptions?.otMultiplier ?? 1.5;
  const dtMultiplier = overtimeOptions?.dtMultiplier ?? 2.0;

  // A meal off the clock deducts its duration from billable hours; on the
  // clock (paid straight through) never deducts, regardless of duration.
  // Zero duration means no meal was taken at all — see mealPenalties instead.
  const mealMinutes = meal?.duration ?? 0;
  const mealDeduction = (mealMinutes > 0 && !meal?.onClock) ? mealMinutes / 60 : 0;
  const adjustedHours = Math.max(0, actualHours - mealDeduction);
  const billableHours = Math.max(adjustedHours, minimumHours);
  const effectiveRate = rate * dayMultiplier;
  const breakdown: string[] = [];

  if (mealMinutes > 0 && !meal?.onClock) {
    breakdown.push(`${mealMinutes}min meal off clock: ${actualHours}h − ${mealDeduction}h = ${adjustedHours}h`);
  } else if (mealMinutes > 0 && meal?.onClock) {
    breakdown.push(`${mealMinutes}min meal on clock (no deduction)`);
  }

  let pay = 0;

  if (otRule !== 'daily') {
    pay = billableHours * effectiveRate;
    breakdown.push(`${billableHours}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (billableHours <= otThreshold) {
    pay = billableHours * effectiveRate;
    breakdown.push(`${billableHours}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (billableHours <= dtThreshold) {
    const straightPay = otThreshold * effectiveRate;
    const otHours = billableHours - otThreshold;
    const otPay = otHours * effectiveRate * otMultiplier;
    pay = straightPay + otPay;
    breakdown.push(`${otThreshold}h straight × $${effectiveRate.toFixed(2)} = $${straightPay.toFixed(2)}`);
    breakdown.push(`${otHours}h OT (${otMultiplier}×) × $${effectiveRate.toFixed(2)} = $${otPay.toFixed(2)}`);
  } else {
    const straightPay = otThreshold * effectiveRate;
    const otHours = dtThreshold - otThreshold;
    const otPay = otHours * effectiveRate * otMultiplier;
    const dtHours = billableHours - dtThreshold;
    const dtPay = dtHours * effectiveRate * dtMultiplier;
    pay = straightPay + otPay + dtPay;
    breakdown.push(`${otThreshold}h straight × $${effectiveRate.toFixed(2)} = $${straightPay.toFixed(2)}`);
    breakdown.push(`${otHours}h OT (${otMultiplier}×) × $${effectiveRate.toFixed(2)} = $${otPay.toFixed(2)}`);
    breakdown.push(`${dtHours}h DT (${dtMultiplier}×) × $${effectiveRate.toFixed(2)} = $${dtPay.toFixed(2)}`);
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
 * How many consecutive calendar days (including entryDate) have been worked
 * in a row for the given client, counting backward from entryDate. Returns 0
 * if entryDate itself has no worked hours logged for that client. Used both
 * for the 6th/7th day pay multiplier (when has6th7thDayRule is set) and for
 * flagging the pattern to the user even when it isn't.
 */
export function getConsecutiveDayStreak(
  entryDate: string,
  client: string,
  allJobs: Job[]
): number {
  const targetDate = startOfDay(parseISO(entryDate));

  const relevantJobs = allJobs.filter(
    j => j.client === client && (j.hoursWorked ?? 0) > 0
  );

  const workDates = [...new Set(relevantJobs.map(j => j.date))]
    .map(d => startOfDay(parseISO(d)))
    .sort((a, b) => a.getTime() - b.getTime());

  const targetIdx = workDates.findIndex(d => d.getTime() === targetDate.getTime());
  if (targetIdx < 0) return 0;

  let consecutiveDays = 1;
  for (let i = targetIdx - 1; i >= 0; i--) {
    const diff = differenceInCalendarDays(workDates[i + 1], workDates[i]);
    if (diff === 1) {
      consecutiveDays++;
    } else {
      break;
    }
  }

  return consecutiveDays;
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
  const consecutiveDays = getConsecutiveDayStreak(entryDate, client, allJobs);
  if (consecutiveDays >= 7) return 2;
  if (consecutiveDays >= 6) return 1.5;
  return 1;
}

/**
 * Additive weekly-overtime bonus for a single job, only meaningful when its
 * Employer profile has overtimeRule === 'weekly' (e.g. a Pennsylvania-style
 * contract that pays OT after 40 total hours in a week, with no daily OT).
 * Sums that employer's hoursWorked across the same Sunday-start week (in
 * date order) and pays this job's share of hours above the threshold at
 * (overtimeMultiplier - 1) extra — on top of the straight-time total
 * calculateDayPay already returned for 'weekly'-rule jobs.
 */
export function calculateWeeklyOvertimeBonus(job: Job, allJobs: Job[], employer: Employer): number {
  if (employer.overtimeRule !== 'weekly') return 0;
  const hours = job.hoursWorked ?? 0;
  if (hours <= 0) return 0;
  const rate = job.hourlyRate ?? employer.defaultHourlyRate ?? 0;
  if (rate <= 0) return 0;

  const threshold = employer.weeklyOvertimeThresholdHours ?? 40;
  const otMultiplier = employer.overtimeMultiplier ?? 1.5;

  const jobDate = startOfDay(parseISO(job.date));
  const weekStart = startOfWeek(jobDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(jobDate, { weekStartsOn: 0 });

  const weekJobs = allJobs
    .filter(j => j.client.toLowerCase() === job.client.toLowerCase() && (j.hoursWorked ?? 0) > 0)
    .filter(j => {
      const d = startOfDay(parseISO(j.date));
      return d >= weekStart && d <= weekEnd;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  let cumulativeBefore = 0;
  for (const j of weekJobs) {
    if (j.id === job.id) break;
    cumulativeBefore += j.hoursWorked ?? 0;
  }

  const cumulativeAfter = cumulativeBefore + hours;
  const otHoursForThisJob = Math.max(0, Math.min(hours, cumulativeAfter - threshold));
  if (otHoursForThisJob <= 0) return 0;

  return otHoursForThisJob * rate * (otMultiplier - 1);
}

/**
 * Calculate expected pay for a set of jobs (with hours worked).
 */
export function calculateExpectedPay(
  jobs: Job[],
  referenceJob: Job,
  allJobs: Job[],
  employer?: Employer
): { total: number; details: { date: string; hours: number; pay: number; breakdown: string[] }[] } {
  const details: { date: string; hours: number; pay: number; breakdown: string[] }[] = [];
  let total = 0;

  const overtimeOptions: OvertimeOptions = {
    rule: employer?.overtimeRule ?? 'daily',
    otThresholdHours: employer?.dailyOvertimeThresholdHours ?? 8,
    dtThresholdHours: employer?.dailyDoubletimeThresholdHours ?? 12,
    otMultiplier: employer?.overtimeMultiplier ?? 1.5,
    dtMultiplier: employer?.doubletimeMultiplier ?? 2.0,
  };

  // Group by date
  const byDate = new Map<string, { hours: number; mealPenalties: number; rate: number; mealDuration?: 0 | 30 | 45 | 60; mealOnClock?: boolean }>();
  for (const job of jobs) {
    const hours = job.hoursWorked ?? 0;
    if (hours <= 0) continue;
    const rate = job.hourlyRate || referenceJob.hourlyRate || 0;
    const existing = byDate.get(job.date) || { hours: 0, mealPenalties: 0, rate, mealDuration: job.mealDuration, mealOnClock: job.mealOnClock };
    existing.hours += hours;
    existing.mealPenalties += job.mealPenalties || 0;
    existing.rate = rate;
    if (job.mealDuration !== undefined) { existing.mealDuration = job.mealDuration; existing.mealOnClock = job.mealOnClock; }
    byDate.set(job.date, existing);
  }

  for (const [date, { hours, mealPenalties, rate, mealDuration, mealOnClock }] of byDate.entries()) {
    const dayMultiplier = getDayMultiplier(date, referenceJob.client, allJobs, referenceJob.has6th7thDayRule || false);
    const result = calculateDayPay(hours, rate, referenceJob.minimumHours || 0, mealPenalties, dayMultiplier, { duration: mealDuration, onClock: mealOnClock }, overtimeOptions);
    total += result.totalPay;
    details.push({ date, hours, pay: result.totalPay, breakdown: result.breakdown });
  }

  if (employer?.overtimeRule === 'weekly') {
    for (const job of jobs) {
      const bonus = calculateWeeklyOvertimeBonus(job, allJobs, employer);
      if (bonus > 0) {
        total += bonus;
        details.push({ date: job.date, hours: 0, pay: bonus, breakdown: [`Weekly OT bonus (>${employer.weeklyOvertimeThresholdHours ?? 40}h/wk)`] });
      }
    }
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
