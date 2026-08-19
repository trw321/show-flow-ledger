import type { Job, Employer } from './store';
import { parseISO, differenceInCalendarDays, startOfDay, startOfWeek, endOfWeek } from 'date-fns';

export interface OvertimeOptions {
  rule?: 'daily' | 'weekly' | 'none';
  otThresholdHours?: number;
  dtThresholdHours?: number;
  otMultiplier?: number;
  dtMultiplier?: number;
  /**
   * Hours actually worked (already net of meal deduction) that fall after the
   * employer's night-premium start time — e.g. a 10:30pm-3am call has 3 night
   * hours (midnight-3am). Never includes minimum-call padding: a minimum that
   * extends past midnight but wasn't actually worked stays at straight time.
   * These hours are pulled out of the normal OT ladder and billed flatly at
   * nightMultiplier — no stacking with daily OT/DT past that multiplier.
   */
  nightHours?: number;
  nightMultiplier?: number;
}

/**
 * Calculate the pay for a single day's work, applying:
 * - Minimum hours (e.g. 5-hour minimum)
 * - Daily overtime (default 8-12hrs = 1.5x, 12+ = 2x) — only when overtimeOptions.rule is
 *   'daily' (the default, matching every employer that hasn't set an explicit rule).
 *   'weekly'/'none' employers bill straight time here; weekly OT is a separate additive
 *   bonus from calculateWeeklyOvertimeBonus, computed across that employer's whole week.
 * - Night premium (e.g. IATSE-style hours-after-midnight double time), carved out of
 *   the ladder above and billed flat — see OvertimeOptions.nightHours.
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
  const nightMultiplier = overtimeOptions?.nightMultiplier ?? 2.0;

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

  // Night hours can never exceed what was actually worked (padding-only hours
  // beyond adjustedHours are never night-eligible), nor the billable total.
  const nightHours = Math.max(0, Math.min(overtimeOptions?.nightHours ?? 0, adjustedHours, billableHours));
  const ladderHours = billableHours - nightHours;

  let pay = 0;

  if (otRule !== 'daily') {
    pay = ladderHours * effectiveRate;
    if (ladderHours > 0) breakdown.push(`${ladderHours}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (ladderHours <= otThreshold) {
    pay = ladderHours * effectiveRate;
    if (ladderHours > 0) breakdown.push(`${ladderHours}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (ladderHours <= dtThreshold) {
    const straightPay = otThreshold * effectiveRate;
    const otHours = ladderHours - otThreshold;
    const otPay = otHours * effectiveRate * otMultiplier;
    pay = straightPay + otPay;
    breakdown.push(`${otThreshold}h straight × $${effectiveRate.toFixed(2)} = $${straightPay.toFixed(2)}`);
    breakdown.push(`${otHours}h OT (${otMultiplier}×) × $${effectiveRate.toFixed(2)} = $${otPay.toFixed(2)}`);
  } else {
    const straightPay = otThreshold * effectiveRate;
    const otHours = dtThreshold - otThreshold;
    const otPay = otHours * effectiveRate * otMultiplier;
    const dtHours = ladderHours - dtThreshold;
    const dtPay = dtHours * effectiveRate * dtMultiplier;
    pay = straightPay + otPay + dtPay;
    breakdown.push(`${otThreshold}h straight × $${effectiveRate.toFixed(2)} = $${straightPay.toFixed(2)}`);
    breakdown.push(`${otHours}h OT (${otMultiplier}×) × $${effectiveRate.toFixed(2)} = $${otPay.toFixed(2)}`);
    breakdown.push(`${dtHours}h DT (${dtMultiplier}×) × $${effectiveRate.toFixed(2)} = $${dtPay.toFixed(2)}`);
  }

  if (nightHours > 0) {
    const nightPay = nightHours * effectiveRate * nightMultiplier;
    pay += nightPay;
    breakdown.push(`${nightHours}h after midnight (${nightMultiplier}×) × $${effectiveRate.toFixed(2)} = $${nightPay.toFixed(2)}`);
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

function parseTimeToMinutes(t: string): number {
  const m = t.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
  if (!m) return NaN;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || '0');
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return h * 60 + min;
}

/**
 * A job's worked hours, falling back to the wall-clock duration between
 * startTime and endTime when hoursWorked was never explicitly set — e.g. a
 * shift imported/logged with both clock times but no separate hours entry.
 * Without this, every pay calculation (and the "needs hours" reminder) treats
 * that shift as 0 hours worked even though both times are right there.
 */
export function effectiveHoursWorked(job: Job): number {
  if (job.hoursWorked) return job.hoursWorked;
  if (!job.startTime || !job.endTime) return 0;
  const s = parseTimeToMinutes(job.startTime);
  let e = parseTimeToMinutes(job.endTime);
  if (isNaN(s) || isNaN(e)) return 0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

/**
 * Hours of a shift [startTime, endTime) that fall at/after nightStartHour
 * (default midnight) — i.e. the hours actually worked past the one night-
 * premium boundary this shift runs into. Returns 0 if the shift never
 * crosses that boundary (including one that starts already past it with no
 * earlier crossing — e.g. a 1am-5am call isn't treated as "past midnight"
 * since nothing here crossed into a new day; set a custom nightStartHour if
 * that distinction matters for a given contract).
 * nightEndHour, if given, caps the window (e.g. 0-6 = midnight to 6am);
 * otherwise the window runs to the end of the shift.
 */
export function calculateNightHours(
  startTime: string,
  endTime: string,
  nightStartHour: number = 0,
  nightEndHour?: number
): number {
  const s = parseTimeToMinutes(startTime);
  const eRaw = parseTimeToMinutes(endTime);
  if (isNaN(s) || isNaN(eRaw)) return 0;
  let e = eRaw;
  if (e <= s) e += 24 * 60; // shift crosses midnight

  let windowStart = nightStartHour * 60;
  while (windowStart <= s) windowStart += 24 * 60;
  if (windowStart > e) return 0;

  const windowEnd = nightEndHour !== undefined
    ? windowStart + (((nightEndHour - nightStartHour + 24) % 24) || 24) * 60
    : e;

  const overlapEnd = Math.min(e, windowEnd);
  return Math.max(0, Math.round(((overlapEnd - windowStart) / 60) * 100) / 100);
}

/**
 * Applies the worked-vs-padding confirmation to a computed night-hours count.
 * nightPremiumActualHours (an exact split — e.g. only 1.5 of 3 calculated
 * night hours were actually worked, the rest was unworked minimum-call
 * padding) takes precedence when set. Otherwise falls back to the simpler
 * all-or-nothing nightPremiumConfirmed flag.
 */
export function resolveConfirmedNightHours(
  rawNightHours: number,
  confirmed: boolean | undefined,
  actualHours: number | undefined
): number {
  if (actualHours !== undefined) return Math.max(0, Math.min(actualHours, rawNightHours));
  return confirmed === false ? 0 : rawNightHours;
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
    j => j.client === client && effectiveHoursWorked(j) > 0
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
  const hours = effectiveHoursWorked(job);
  if (hours <= 0) return 0;
  const rate = job.hourlyRate ?? employer.defaultHourlyRate ?? 0;
  if (rate <= 0) return 0;

  const threshold = employer.weeklyOvertimeThresholdHours ?? 40;
  const otMultiplier = employer.overtimeMultiplier ?? 1.5;

  const jobDate = startOfDay(parseISO(job.date));
  const weekStart = startOfWeek(jobDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(jobDate, { weekStartsOn: 0 });

  const weekJobs = allJobs
    .filter(j => j.client.toLowerCase() === job.client.toLowerCase() && effectiveHoursWorked(j) > 0)
    .filter(j => {
      const d = startOfDay(parseISO(j.date));
      return d >= weekStart && d <= weekEnd;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  let cumulativeBefore = 0;
  for (const j of weekJobs) {
    if (j.id === job.id) break;
    cumulativeBefore += effectiveHoursWorked(j);
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
    nightMultiplier: employer?.nightPremiumMultiplier ?? 2.0,
  };

  // Group by date
  const byDate = new Map<string, { hours: number; mealPenalties: number; rate: number; mealDuration?: 0 | 30 | 45 | 60; mealOnClock?: boolean; startTime?: string; endTime?: string; nightConfirmed?: boolean; nightActualHours?: number }>();
  for (const job of jobs) {
    const hours = effectiveHoursWorked(job);
    if (hours <= 0) continue;
    const rate = job.hourlyRate || referenceJob.hourlyRate || 0;
    const existing = byDate.get(job.date) || { hours: 0, mealPenalties: 0, rate, mealDuration: job.mealDuration, mealOnClock: job.mealOnClock, startTime: job.startTime, endTime: job.endTime, nightConfirmed: job.nightPremiumConfirmed, nightActualHours: job.nightPremiumActualHours };
    existing.hours += hours;
    existing.mealPenalties += job.mealPenalties || 0;
    existing.rate = rate;
    if (job.mealDuration !== undefined) { existing.mealDuration = job.mealDuration; existing.mealOnClock = job.mealOnClock; }
    if (job.startTime) { existing.startTime = job.startTime; existing.endTime = job.endTime; existing.nightConfirmed = job.nightPremiumConfirmed; existing.nightActualHours = job.nightPremiumActualHours; }
    byDate.set(job.date, existing);
  }

  for (const [date, { hours, mealPenalties, rate, mealDuration, mealOnClock, startTime, endTime, nightConfirmed, nightActualHours }] of byDate.entries()) {
    const dayMultiplier = getDayMultiplier(date, referenceJob.client, allJobs, referenceJob.has6th7thDayRule || false);
    const rawNightHours = ((employer?.nightPremiumEnabled ?? true) && startTime && endTime)
      ? calculateNightHours(startTime, endTime, employer?.nightPremiumStartHour ?? 0, employer?.nightPremiumEndHour)
      : 0;
    const nightHours = resolveConfirmedNightHours(rawNightHours, nightConfirmed, nightActualHours);
    const result = calculateDayPay(hours, rate, referenceJob.minimumHours || 0, mealPenalties, dayMultiplier, { duration: mealDuration, onClock: mealOnClock }, { ...overtimeOptions, nightHours });
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
