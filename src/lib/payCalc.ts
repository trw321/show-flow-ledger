import type { Job, Employer } from './store';
import { ratesForShift, withholdsNothing, EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import { parseDayTimeline, POST_MEAL_MINIMUM_HOURS } from './dayTimeline';
import { parseISO, differenceInCalendarDays, startOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { resolveEmployer } from './employerMatch';
import { contractFor } from './contracts';
import { localToday } from './today';
import { breaksTheHour, isLocal16Shift } from './local16';
import { callMinimum, shiftPremiums, splitSideMinimum, type StartPremium } from './premiums';
import { clockSpanHours, endAfterStart } from './clock';
import { roundHours } from './hoursFormat';

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
  /**
   * Union hours "break the hour": any part of an hour worked bills as a whole
   * one, so 6h06m pays 7. Applied to the billable total after the meal has come
   * out and the minimum call has been applied, which is the figure the contract
   * actually pays on.
   */
  roundUpToWholeHours?: boolean;
  /**
   * How much of the night window is left when the shift ends — zero if it
   * ends outside it. The hour a shift's last minutes broke is worked time at
   * its end, so when that end is after midnight the rounded-up part is night
   * time too: 15 minutes past midnight bills a whole hour at the night rate.
   */
  nightLeftAtEnd?: number;
  /**
   * Straight-time hours owed by the minimum calls of a split day's sides —
   * a three-hour morning against a four-hour minimum owes one. Never worked,
   * so paid flat and never overtime, like any minimum-call padding.
   */
  minimumPaddingHours?: number;
  /**
   * Straight-time hours owed because the shift ended too soon after an
   * off-the-clock meal — see postMealShortfallHours. Paid flat, on top of the
   * ladder, because they were never worked and so can never be overtime.
   */
  postMealPaddingHours?: number;
  /**
   * A flat amount for the day instead of an hourly rate. It covers
   * dayRateHours of work and is paid in full however short the day was —
   * that is what makes it a day rate. Hours past it are overtime at the
   * hourly equivalent (dayRate / dayRateHours) times the overtime multiplier.
   */
  dayRate?: number;
  /** How many hours the day rate covers before overtime starts. Default 10. */
  dayRateHours?: number;
  /** Why the whole day pays dayMultiplier, for the breakdown: "6th day", "composite Sunday". */
  dayPremiumLabel?: string;
  /**
   * Premiums that run from the start of the call — an early call, a forced
   * call (see premiums.ts). They are the day's first hours, so they still
   * count towards overtime; each of those hours pays the higher of the
   * premium and its own overtime tier, never one stacked on the other.
   */
  premiums?: StartPremium[];
  /** Union dues as a percent of this day's gross (base/OT/DT/night/meal-penalty
   *  pay) — deducted here so every caller of calculateDayPay picks it up
   *  automatically. Does NOT apply a second time to weekly-OT-bonus or
   *  vacation-pay top-ups computed separately in calculateExpectedPay. */
  unionDuesPercent?: number;
  /** Estimated tax withholding as a percent of this day's gross, deducted
   *  after union dues (same base-and-order pattern) — this is a rough
   *  estimate only, not a real withholding calculation (that depends on
   *  filing status, state, YTD earnings, etc.), but it gets "expected pay"
   *  closer to what an actual W2 deposit looks like for reconciliation.
   *  1099/self-employed workers with no withholding should leave this unset. */
  estimatedTaxPercent?: number;
}

/**
 * A day's paid hours by what they were paid at. straight + overtime + double
 * + night are the hours worked (part hours paid whole, under union rules);
 * minimum is paid but never worked: a minimum call's padding, or the hours
 * owed after a meal. premiumDay is how many of the worked ones fell on a 6th
 * or 7th day, so at that day's rate or better, whatever tier they're in.
 */
export interface TierHours {
  straight: number;
  overtime: number;
  double: number;
  night: number;
  minimum: number;
  premiumDay: number;
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
  meal?: {
    duration?: 0 | 30 | 45 | 60;
    onClock?: boolean;
    /**
     * Every off-the-clock meal minute for the whole day, when the day is made of
     * more than one shift. A single duration cannot express two meals — a 60 and
     * a 30 is 90 minutes, which is not one of the allowed durations — so callers
     * that aggregate a date supply the total and it wins over duration.
     */
    offClockMinutesTotal?: number;
  },
  overtimeOptions?: OvertimeOptions
): { billableHours: number; totalPay: number; breakdown: string[]; duesAmount: number; taxAmount: number; nightHours: number; tierHours: TierHours } {
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
  const offClockMinutes = meal?.offClockMinutesTotal ?? ((mealMinutes > 0 && !meal?.onClock) ? mealMinutes : 0);
  const mealDeduction = offClockMinutes / 60;
  const adjustedHours = Math.max(0, actualHours - mealDeduction);
  const laddered = Math.max(adjustedHours, minimumHours);
  // Round after the meal and the minimum call, because that is the number the
  // contract pays on — rounding earlier would round a figure nobody bills.
  // A hair under, so 8 hours that arithmetic made 8.0000001 stay 8.
  const rounds = !!overtimeOptions?.roundUpToWholeHours;
  const ceilHours = (h: number) => Math.ceil(h - 1e-9);
  const billableHours = rounds ? ceilHours(laddered) : laddered;
  // A premium day (6th/7th of the same employer) lifts the whole day's rate; it
  // does NOT compound with the overtime ladder. A 6th day is 1.5× straight
  // through and only the normal double time after 12 hours goes higher, so each
  // tier bills at whichever is greater — the day's premium or the tier's own
  // multiplier. Multiplying the two gave hours 8–12 of a 6th day 2.25×, which no
  // contract pays. Meal penalties do stack on top; a day premium does not.
  const tierRate = (tierMultiplier: number) => rate * Math.max(dayMultiplier, tierMultiplier);
  const effectiveRate = tierRate(1);
  const breakdown: string[] = [];

  if (billableHours !== laddered) {
    breakdown.push(`${roundHours(laddered)}h rounds up to ${roundHours(billableHours)}h (union hours)`);
  }

  if (offClockMinutes > 0) {
    breakdown.push(`${offClockMinutes}min meal off clock: ${roundHours(actualHours)}h − ${roundHours(mealDeduction)}h = ${roundHours(adjustedHours)}h`);
  } else if (mealMinutes > 0 && meal?.onClock) {
    breakdown.push(`${mealMinutes}min meal on clock (no deduction)`);
  }

  // Hours you were PAID for but did not work — the gap up to a minimum call —
  // are straight time. Overtime is for hours actually stood there: two hours
  // worked against a twelve-hour minimum is twelve hours of straight time, not
  // eight straight and four at time and a half. Only the worked hours go
  // through the ladder; the padding is added flat afterwards.
  //
  // A broken hour is not padding. Under "break the hour" the part hour IS
  // worked time, billed whole: 8h15m worked is nine hours worked, and the
  // ninth is overtime like the rest.
  const workedHours = Math.min(rounds ? ceilHours(adjustedHours) : adjustedHours, billableHours);
  const paddingHours = Math.max(0, billableHours - workedHours) + (overtimeOptions?.minimumPaddingHours ?? 0);
  // Night hours can never exceed what was actually worked — padding is never
  // night-eligible either, for the same reason. The broken hour sits at the
  // end of the shift, so it is night time when the shift ends in the night.
  const brokenHour = Math.max(0, workedHours - adjustedHours);
  const rawNight = overtimeOptions?.nightHours ?? 0;
  const nightHours = Math.max(0, Math.min(rawNight + (rawNight > 0 ? Math.min(brokenHour, overtimeOptions?.nightLeftAtEnd ?? 0) : 0), workedHours));
  const ladderHours = workedHours - nightHours;

  let pay = 0;
  // Which hours were paid at what: the same cuts the pay below is made on.
  const tierHours: TierHours = { straight: 0, overtime: 0, double: 0, night: 0, minimum: 0, premiumDay: 0 };

  const dayRate = overtimeOptions?.dayRate ?? 0;
  if (dayRate > 0) {
    // Paid by the day: the rate is the floor, and only hours actually worked
    // past what it covers go to overtime. Minimum-call padding cannot push a
    // day-rate shift into overtime any more than it can an hourly one.
    const covers = overtimeOptions?.dayRateHours && overtimeOptions.dayRateHours > 0
      ? overtimeOptions.dayRateHours
      : 10;
    const hourlyEquivalent = dayRate / covers;
    const over = Math.max(0, workedHours - covers);
    const otPay = over * hourlyEquivalent * otMultiplier * Math.max(1, dayMultiplier);
    pay = dayRate * Math.max(1, dayMultiplier) + otPay;
    tierHours.straight = workedHours - over;
    tierHours.overtime = over;
    breakdown.push(`Day rate (covers ${roundHours(covers)}h) = $${(dayRate * Math.max(1, dayMultiplier)).toFixed(2)}`);
    if (over > 0) {
      breakdown.push(`${roundHours(over)}h past the day rate × $${(hourlyEquivalent * otMultiplier).toFixed(2)} = $${otPay.toFixed(2)}`);
    }
  } else if (otRule !== 'daily') {
    pay = ladderHours * effectiveRate;
    tierHours.straight = ladderHours;
    if (ladderHours > 0) breakdown.push(`${roundHours(ladderHours)}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (ladderHours <= otThreshold) {
    pay = ladderHours * effectiveRate;
    tierHours.straight = ladderHours;
    if (ladderHours > 0) breakdown.push(`${roundHours(ladderHours)}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (ladderHours <= dtThreshold) {
    const straightPay = otThreshold * effectiveRate;
    const otHours = ladderHours - otThreshold;
    const otRate = tierRate(otMultiplier);
    const otPay = otHours * otRate;
    pay = straightPay + otPay;
    tierHours.straight = otThreshold;
    tierHours.overtime = otHours;
    breakdown.push(`${roundHours(otThreshold)}h straight × ${effectiveRate.toFixed(2)} = ${straightPay.toFixed(2)}`);
    breakdown.push(`${roundHours(otHours)}h OT × ${otRate.toFixed(2)} = ${otPay.toFixed(2)}`);
  } else {
    const straightPay = otThreshold * effectiveRate;
    const otHours = dtThreshold - otThreshold;
    const otRate = tierRate(otMultiplier);
    const otPay = otHours * otRate;
    const dtHours = ladderHours - dtThreshold;
    const dtRate = tierRate(dtMultiplier);
    const dtPay = dtHours * dtRate;
    pay = straightPay + otPay + dtPay;
    tierHours.straight = otThreshold;
    tierHours.overtime = otHours;
    tierHours.double = dtHours;
    breakdown.push(`${roundHours(otThreshold)}h straight × ${effectiveRate.toFixed(2)} = ${straightPay.toFixed(2)}`);
    breakdown.push(`${roundHours(otHours)}h OT × ${otRate.toFixed(2)} = ${otPay.toFixed(2)}`);
    breakdown.push(`${roundHours(dtHours)}h DT × ${dtRate.toFixed(2)} = ${dtPay.toFixed(2)}`);
  }

  // Premiums from the start of the call. Those hours were already paid above
  // at their place on the ladder; what's added is the difference up to the
  // premium, so an hour that was overtime anyway isn't paid twice.
  const startPremiums = (overtimeOptions?.premiums ?? []).filter(p => p.hours > 0);
  if (startPremiums.length > 0 && ladderHours > 0 && !(dayRate > 0)) {
    const dayFloor = Math.max(dayMultiplier, 1);
    const tierAt = (at: number) => {
      if (otRule !== 'daily' || at < otThreshold) return dayFloor;
      return Math.max(dayMultiplier, at < dtThreshold ? otMultiplier : dtMultiplier);
    };
    const cuts = [0, ladderHours, otThreshold, dtThreshold, ...startPremiums.map(p => p.hours)]
      .filter(x => x >= 0 && x <= ladderHours);
    const points = [...new Set(cuts)].sort((a, b) => a - b);
    const added = new Map<string, { hours: number; multiplier: number; pay: number }>();
    for (let k = 0; k + 1 < points.length; k++) {
      const from = points[k];
      const span = points[k + 1] - from;
      const covering = startPremiums.filter(p => p.hours > from);
      if (covering.length === 0 || span <= 0) continue;
      const best = covering.reduce((a, b) => (b.multiplier > a.multiplier ? b : a));
      const lift = Math.max(dayMultiplier, best.multiplier) - tierAt(from);
      if (lift <= 0) continue;
      const entry = added.get(best.label) ?? { hours: 0, multiplier: Math.max(dayMultiplier, best.multiplier), pay: 0 };
      entry.hours += span;
      entry.pay += span * rate * lift;
      added.set(best.label, entry);
    }
    for (const [label, entry] of added) {
      pay += entry.pay;
      breakdown.push(`${roundHours(entry.hours)}h ${label}: paid at ${entry.multiplier}×, +$${entry.pay.toFixed(2)}`);
    }
  }

  if (paddingHours > 0 && !(overtimeOptions?.dayRate && overtimeOptions.dayRate > 0)) {
    const padPay = paddingHours * effectiveRate;
    pay += padPay;
    tierHours.minimum += paddingHours;
    breakdown.push(`${roundHours(paddingHours)}h minimum-call padding × $${effectiveRate.toFixed(2)} = $${padPay.toFixed(2)}`);
  }

  // A day rate already pays for every hour it covers, night ones included, so
  // the night premium only applies when the day is paid by the hour —
  // otherwise those hours would be paid twice.
  if (nightHours > 0 && !(overtimeOptions?.dayRate && overtimeOptions.dayRate > 0)) {
    const nightRate = tierRate(nightMultiplier);
    const nightPay = nightHours * nightRate;
    pay += nightPay;
    tierHours.night = nightHours;
    breakdown.push(`${roundHours(nightHours)}h after midnight × ${nightRate.toFixed(2)} = ${nightPay.toFixed(2)}`);
  }

  const postMealPadding = overtimeOptions?.postMealPaddingHours ?? 0;
  if (postMealPadding > 0) {
    const padPay = postMealPadding * rate;
    pay += padPay;
    tierHours.minimum += postMealPadding;
    breakdown.push(`${roundHours(postMealPadding)}h post-meal minimum × ${rate.toFixed(2)} = ${padPay.toFixed(2)}`);
  }

  if (mealPenalties > 0) {
    const mpPay = mealPenalties * rate;
    pay += mpPay;
    breakdown.push(`${mealPenalties} meal penalty × $${rate.toFixed(2)} = $${mpPay.toFixed(2)}`);
  }

  const duesPercent = overtimeOptions?.unionDuesPercent ?? 0;
  let duesAmount = 0;
  if (duesPercent > 0 && pay > 0) {
    duesAmount = pay * (duesPercent / 100);
    pay -= duesAmount;
    breakdown.push(`Union dues (${duesPercent}%): −$${duesAmount.toFixed(2)}`);
  }

  const taxPercent = overtimeOptions?.estimatedTaxPercent ?? 0;
  let taxAmount = 0;
  if (taxPercent > 0 && pay > 0) {
    taxAmount = pay * (taxPercent / 100);
    pay -= taxAmount;
    breakdown.push(`Est. taxes (${taxPercent}%): −$${taxAmount.toFixed(2)}`);
  }

  if (minimumHours > 0 && actualHours < minimumHours) {
    breakdown.unshift(`${roundHours(actualHours)}h worked → ${roundHours(minimumHours)}h minimum applied`);
  }

  if (dayMultiplier > 1) {
    // Every hour of a 6th or 7th day is at its rate or better, straight ones included.
    tierHours.premiumDay = tierHours.straight + tierHours.overtime + tierHours.double + tierHours.night;
    breakdown.unshift(`Day multiplier: ${dayMultiplier}× (${overtimeOptions?.dayPremiumLabel ?? (dayMultiplier === 1.5 ? '6th day' : '7th day')})`);
  }

  return { billableHours: billableHours + (overtimeOptions?.minimumPaddingHours ?? 0), totalPay: pay, breakdown, duesAmount, taxAmount, nightHours, tierHours };
}

/**
 * Calls in the order they happened: by date, then by start time, with a call
 * that has no start time after those that do. A day's calls used to keep the
 * order they were saved in, and each new one is saved on top, so a split day
 * read evening first.
 */
export function compareCalls(a: Job, b: Job): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  const start = (j: Job) => {
    const m = j.startTime ? parseTimeToMinutes(j.startTime) : NaN;
    return Number.isNaN(m) ? Infinity : m;
  };
  const gap = start(a) - start(b);
  return Number.isNaN(gap) ? 0 : gap;
}

export function parseTimeToMinutes(t: string): number {
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
  // Nothing on a day that has not happened counts — the whole shift is a plan
  // until it is worked, however much of it has been filled in.
  if (job.date > localToday()) return 0;
  // Hours filled in ahead of the day stay a plan after it too, until the
  // shift is confirmed. Entering a schedule early should not quietly become
  // a timesheet when the date rolls past.
  if (job.hoursPlanned) return 0;
  if (job.hoursWorked) return job.hoursWorked;
  // Clock times on their own are a schedule, never a record of work.
  if (!job.startTime || !job.endTime) return 0;
  return Math.max(0, clockSpanHours(job.startTime, job.endTime));
}

/**
 * Every off-the-clock minute a job's meals come to. A day can hold two meals on
 * independent terms — an hour off at lunch, half an hour on later — and only the
 * off-the-clock ones reduce the hours. The single place that knows this, so the
 * second meal cannot be forgotten by one caller and not another.
 */
export function offClockMealMinutes(job: Job): number {
  // A day entered as a run of calls derives its meals from the gaps, which can be
  // any length, so the timeline wins over the two fixed-duration meal fields.
  if (job.callTimeline) {
    const timeline = parseDayTimeline(job.callTimeline, job.callGapsOnClock ?? [], undefined, job.date);
    if (timeline) return timeline.offClockMinutes;
  }
  const first = job.mealDuration && !job.mealOnClock ? job.mealDuration : 0;
  const second = job.meal2Duration && !job.meal2OnClock ? job.meal2Duration : 0;
  const more = (job.extraMeals ?? []).reduce((sum, m) => sum + (m.onClock ? 0 : m.duration), 0);
  return first + second + more;
}

/**
 * Straight-time hours owed on top of the worked ones because a call ended too
 * soon after an off-the-clock meal. Only a day entered as calls can know this —
 * a single clocked figure cannot say when the meal was or what followed it.
 */
export function postMealPaddingHours(job: Job, employer?: Employer): number {
  const guaranteed = employer?.postMealMinimumHours ?? 0;
  if (!guaranteed || !job.callTimeline) return 0;
  const timeline = parseDayTimeline(job.callTimeline, job.callGapsOnClock ?? [], undefined, job.date);
  if (!timeline) return 0;
  // The timeline works to the IATSE-standard two hours; scale if the contract
  // guarantees something else.
  return timeline.postMealShortfallHours * (guaranteed / POST_MEAL_MINIMUM_HOURS);
}

/**
 * "Hours worked" as it should read anywhere it's shown as a standalone
 * number (Dashboard totals, job badges, exports) — effectiveHoursWorked()
 * minus an off-the-clock meal break, mirroring the deduction calculateDayPay
 * already applies internally for pay math. job.hoursWorked itself stays the
 * raw clocked span (unchanged, still what calculateDayPay/jobGross take as
 * input) — this is a display-only derivative, not a second place the
 * deduction gets applied to pay.
 */
export function netHoursWorked(job: Job): number {
  const raw = effectiveHoursWorked(job);
  return Math.max(0, raw - offClockMealMinutes(job) / 60);
}

// status never auto-transitions off "upcoming"/"in-progress" as the date
// passes — it only becomes "completed" once hours are logged. This flags
// that gap wherever a job's status is displayed, without changing the
// stored status itself. Shared so every status display (calendar, exports,
// the shift dialog) agrees on what "overdue" means instead of only some of
// them catching it.
export function isOverdueUpcoming(job: Job): boolean {
  const todayStr = localToday();
  return (job.status === 'upcoming' || job.status === 'in-progress') && job.date < todayStr && effectiveHoursWorked(job) === 0;
}

/**
 * A single job's gross pay (base + OT/DT + night premium + meal penalties +
 * weekly OT bonus, before dues/tax/vacation) and net pay (after union dues
 * and estimated tax are deducted, vacation pay added on top) — the one
 * canonical version of this calculation that used to be copy-pasted
 * separately in Dashboard, CalendarPage, and the Excel export, which made
 * the union-dues feature require four separate edits to land everywhere.
 * New callers should use this instead of adding a fifth local copy.
 */
export function jobPayBreakdown(
  job: Job,
  allJobs: Job[],
  employers: Employer[] = [],
  payer: PayerProfile = EMPTY_PROFILE,
  /**
   * asWorked: only the working hours so far, to the minute: no minimum call,
   * no part hour paid whole. What the live counter ticks on while the day is
   * still going, since a rounded or minimum figure only moves once an hour.
   */
  opts: { asWorked?: boolean } = {},
): { gross: number; net: number; dues: number; tax: number; vacation: number; retirementMatch: number } {
  const hours = effectiveHoursWorked(job);
  if (!hours) return { gross: 0, net: 0, dues: 0, tax: 0, vacation: 0, retirementMatch: 0 };
  const rate = job.hourlyRate
    ?? (job.dayRate ? job.dayRate / (job.dayRateHours ?? 10) : 0);

  // Paid time off is paid, not worked: its hours at straight time, and
  // nothing a worked day earns on top. Dues and withholding come out of it
  // like any wages; vacation and a retirement match are on work.
  if (job.pto) {
    const ptoEmployer = resolveEmployer(job.client, employers);
    const ptoRates = ratesForShift(job, ptoEmployer, payer);
    const r = calculateDayPay(hours, rate, 0, 0, 1, undefined, {
      rule: 'none', unionDuesPercent: ptoRates.unionDuesPercent, estimatedTaxPercent: ptoRates.estimatedTaxPercent,
    });
    return { gross: r.totalPay + r.duesAmount + r.taxAmount, net: r.totalPay, dues: r.duesAmount, tax: r.taxAmount, vacation: 0, retirementMatch: 0 };
  }

  const { dayResult, share, employer, rates } = shiftDay(job, allJobs, employers, payer, opts, hours, rate);
  // This shift's portion of the day, by hours.
  const totalPay = dayResult.totalPay * share;
  const duesAmount = dayResult.duesAmount * share;
  const taxAmount = dayResult.taxAmount * share;
  const weeklyBonus = employer ? calculateWeeklyOvertimeBonus(job, allJobs, employer) : 0;
  // totalPay already has dues+tax deducted — add them back to get gross-before-deductions.
  const gross = totalPay + duesAmount + taxAmount + weeklyBonus;
  const netBeforeVacation = totalPay + weeklyBonus;
  const vacationPercent = rates.vacationPercent ?? 0;
  // Vacation is a percentage of GROSS — 8% of what the work earned, before
  // dues and tax come off it. Taking it off the net understated it by however
  // much had already been deducted, which for 3.5% dues plus any tax is not a
  // rounding difference.
  const vacation = vacationPercent > 0 ? gross * (vacationPercent / 100) : 0;
  const net = netBeforeVacation + vacation;
  // A retirement match is owed to the plan, not to you, so it is reported
  // beside the pay rather than inside it — a missing one should be visible
  // without ever being counted as take-home.
  const retirementMatch = employer?.retirementMatchPercent
    ? gross * (employer.retirementMatchPercent / 100)
    : 0;
  // Deductions come back out individually so a pay stub can be reconciled
  // line by line, not just on the totals.
  return { gross, net, dues: duesAmount, tax: taxAmount, vacation, retirementMatch };
}

/**
 * A shift's hours by what they were paid at: its share of its day, the same
 * share its pay is. PTO is paid, not worked, so it is counted on its own.
 * Under a weekly overtime rule, the hours past the week's threshold move from
 * straight time to overtime, as the pay does.
 */
export function jobHoursBreakdown(
  job: Job,
  allJobs: Job[],
  employers: Employer[] = [],
  payer: PayerProfile = EMPTY_PROFILE,
): TierHours & { pto: number } {
  const none = { straight: 0, overtime: 0, double: 0, night: 0, minimum: 0, premiumDay: 0, pto: 0 };
  const hours = effectiveHoursWorked(job);
  if (!hours) return none;
  if (job.pto) return { ...none, pto: netHoursWorked(job) };
  const rate = job.hourlyRate
    ?? (job.dayRate ? job.dayRate / (job.dayRateHours ?? 10) : 0);
  const { dayResult, share, employer } = shiftDay(job, allJobs, employers, payer, {}, hours, rate);
  const t = dayResult.tierHours;
  const out = {
    straight: t.straight * share,
    overtime: t.overtime * share,
    double: t.double * share,
    night: t.night * share,
    minimum: t.minimum * share,
    premiumDay: t.premiumDay * share,
    pto: 0,
  };
  const weekly = Math.min(out.straight, employer ? weeklyOvertimeHours(job, allJobs, employer) : 0);
  out.straight -= weekly;
  out.overtime += weekly;
  return out;
}

/**
 * The day a shift is part of, paid: on a split day both calls climb one
 * ladder, and this shift's share of it is by hours. jobPayBreakdown and
 * jobHoursBreakdown both start here, so a shift's hours and its pay are
 * always cut the same way.
 */
function shiftDay(
  job: Job,
  allJobs: Job[],
  employers: Employer[],
  payer: PayerProfile,
  opts: { asWorked?: boolean },
  hours: number,
  rate: number,
) {
  // A split day is ONE day. Both halves share the same overtime ladder, so the
  // evening call carries on from where the morning left off — five hours and
  // five hours is a ten-hour day with two of them at time and a half, not two
  // five-hour days at straight time. Pay is worked out for the whole day and
  // this shift takes its share by hours, which is also what keeps the parts
  // adding up to the day.
  const dayShifts = allJobs.filter(
    other =>
      other.date === job.date &&
      (other.client ?? '') === (job.client ?? '') &&
      !other.pto &&
      effectiveHoursWorked(other) > 0,
  );
  const isSplitDay = dayShifts.length > 1;
  const employer = resolveEmployer(job.client, employers);
  // Each side of a split carries its own minimum call — usually four hours a
  // side on union work, five under some contracts (see splitSideMinimum) — so
  // a short morning bills its minimum rather than the hours stood there. The
  // working hours on both sides climb one ladder; what a short side is owed
  // beyond them is minimum padding, never worked, paid flat at straight time.
  const sideMinimum = (j: Job) => (opts.asWorked ? 0 : splitSideMinimum(j, employer, payer));
  const billable = (j: Job) => Math.max(effectiveHoursWorked(j), sideMinimum(j));
  // Each side of a split is its own call, so each breaks the hour on its own:
  // 11:30 PM to 12:15 AM is an hour on that side, whatever the other side was.
  const rounds = !opts.asWorked && breaksTheHour(job, employer);
  const split = isSplitDay ? splitDayHours(dayShifts, rounds) : null;
  const dayHours = split ? split.clocked : hours;
  const billableDay = isSplitDay ? dayShifts.reduce((sum, j) => sum + billable(j), 0) : hours;
  const share = isSplitDay && billableDay > 0 ? billable(job) / billableDay : 1;
  // Dues follow the local, tax follows you, and only what is left is the
  // employer's to say. See payerProfile for why.
  const rates = ratesForShift(job, employer, payer);
  const dayMult = dayMultiplierFor(job, employer, allJobs);
  const dayMealMinutes = isSplitDay
    ? dayShifts.reduce((sum, j) => sum + offClockMealMinutes(j), 0)
    : offClockMealMinutes(job);
  const dayPenalties = isSplitDay
    ? dayShifts.reduce((sum, j) => sum + (j.mealPenalties ?? 0), 0)
    : (job.mealPenalties ?? 0);
  const sides = isSplitDay ? dayShifts : [job];
  // A broken hour falls at the end of its call: on a split, the last call's
  // part hour is already rounded per side, so its night share is added here.
  const lastNight = shiftNight(lastCall(sides), employer);
  const dayNightHours = sides.reduce((sum, j) => sum + shiftNight(j, employer).hours, 0)
    + (split && lastNight.hours > 0 ? Math.min(split.lastBroken, lastNight.leftAtEnd) : 0);
  const dayNightLeft = split ? 0 : lastNight.leftAtEnd;

  // On a split each side's minimum is settled as padding; applying the
  // shift's own minimum again here would floor the whole day at it.
  const dayMinimum = isSplitDay || opts.asWorked ? 0 : callMinimum(job, employer);
  const dayResult = calculateDayPay(dayHours, rate, dayMinimum, dayPenalties, dayMult, { duration: job.mealDuration, onClock: job.mealOnClock, offClockMinutesTotal: dayMealMinutes }, {
    rule: employer?.overtimeRule ?? 'daily',
    otThresholdHours: employer?.dailyOvertimeThresholdHours,
    dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
    otMultiplier: employer?.overtimeMultiplier,
    roundUpToWholeHours: rounds,
    postMealPaddingHours: opts.asWorked ? 0 : postMealPaddingHours(job, employer),
    // The shift's own day rate, if it has one — the employer's is only where a
    // new shift starts from. On a split day the whole day is one day rate.
    dayRate: job.dayRate,
    dayRateHours: job.dayRateHours ?? employer?.dayRateHours,
    dtMultiplier: employer?.doubletimeMultiplier,
    nightHours: dayNightHours,
    nightLeftAtEnd: dayNightLeft,
    minimumPaddingHours: isSplitDay && !opts.asWorked ? splitMinimumPadding(dayShifts, sideMinimum, rounds) : 0,
    nightMultiplier: employer?.nightPremiumMultiplier,
    dayPremiumLabel: dayPremiumLabel(job, employer, allJobs),
    // The day's first call is where an early or forced call starts.
    premiums: shiftPremiums(firstCall(sides), allJobs, employer, payer),
    unionDuesPercent: rates.unionDuesPercent,
    estimatedTaxPercent: rates.estimatedTaxPercent,
  });
  return { dayResult, share, employer, rates };
}

/** Net pay only — see jobPayBreakdown for gross+net together. */
export function jobGross(job: Job, allJobs: Job[], employers: Employer[] = [], payer?: PayerProfile): number {
  return jobPayBreakdown(job, allJobs, employers, payer).net;
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
  // Past 1440 when the shift crosses midnight; a bare "5" after an "8" is 5 PM.
  const e = endAfterStart(s, endTime);
  if (isNaN(s) || isNaN(e)) return 0;

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
 * Hours of the night window still to run when a shift ends, on the same
 * reading of the clock as calculateNightHours — zero if it ends outside the
 * window. Bounds how much of a broken hour is night time; see
 * OvertimeOptions.nightLeftAtEnd.
 */
export function nightLeftAtEnd(
  startTime: string,
  endTime: string,
  nightStartHour: number = 0,
  nightEndHour?: number
): number {
  const s = parseTimeToMinutes(startTime);
  const e = endAfterStart(s, endTime);
  if (isNaN(s) || isNaN(e)) return 0;
  let windowStart = nightStartHour * 60;
  while (windowStart <= s) windowStart += 24 * 60;
  if (windowStart >= e) return 0;
  if (nightEndHour === undefined) return Infinity;
  const windowEnd = windowStart + (((nightEndHour - nightStartHour + 24) % 24) || 24) * 60;
  return Math.max(0, (windowEnd - e) / 60);
}

/** One shift's night hours, after the worked-or-padding confirmation, and how much night is left when it ends. */
function shiftNight(job: Job, employer?: Employer): { hours: number; leftAtEnd: number } {
  if (!(employer?.nightPremiumEnabled ?? true) || !job.startTime || !job.endTime) return { hours: 0, leftAtEnd: 0 };
  const start = employer?.nightPremiumStartHour ?? 0;
  const raw = calculateNightHours(job.startTime, job.endTime, start, employer?.nightPremiumEndHour);
  const hours = resolveConfirmedNightHours(raw, job.nightPremiumConfirmed, job.nightPremiumActualHours);
  // Hours confirmed as padding rather than worked earn no broken hour either.
  return { hours, leftAtEnd: hours > 0 ? nightLeftAtEnd(job.startTime, job.endTime, start, employer?.nightPremiumEndHour) : 0 };
}

/** The day's first call: the one that starts earliest. */
function firstCall(sides: Job[]): Job {
  const start = (j: Job) => {
    const m = j.startTime ? parseTimeToMinutes(j.startTime) : NaN;
    return Number.isNaN(m) ? Infinity : m;
  };
  return sides.reduce((earliest, j) => (start(j) < start(earliest) ? j : earliest), sides[0]);
}

/** The day's last call: the one that starts latest. */
function lastCall(sides: Job[]): Job {
  const start = (j: Job) => {
    const m = j.startTime ? parseTimeToMinutes(j.startTime) : NaN;
    return Number.isNaN(m) ? -1 : m;
  };
  return sides.reduce((latest, j) => (start(j) > start(latest) ? j : latest), sides[0]);
}

/**
 * The minimum-call hours a split day's sides are owed beyond what they
 * worked. Each side carries its own minimum, but the hours that fill it were
 * never worked, so they are paid flat rather than climbing the day's ladder.
 */
function splitMinimumPadding(sides: Job[], minimumOf: (j: Job) => number, rounds = false): number {
  return sides.reduce((sum, j) => sum + Math.max(0, minimumOf(j) - sideWorkingHours(j, rounds)), 0);
}

/** One side's working hours: after its meals, and rounded up when it breaks the hour. */
function sideWorkingHours(j: Job, rounds: boolean): number {
  const net = Math.max(0, effectiveHoursWorked(j) - offClockMealMinutes(j) / 60);
  return rounds ? Math.ceil(net - 1e-9) : net;
}

/**
 * A split day's hours for calculateDayPay: each side's working hours, rounded
 * on its own when the calls break the hour, with the day's meals put back on
 * (calculateDayPay takes them off again). And how much of the last call's
 * figure is its broken part hour, for the night premium.
 */
function splitDayHours(sides: Job[], rounds: boolean): { clocked: number; lastBroken: number } {
  const working = sides.reduce((sum, j) => sum + sideWorkingHours(j, rounds), 0);
  const meals = sides.reduce((sum, j) => sum + offClockMealMinutes(j), 0) / 60;
  const last = lastCall(sides);
  const lastBroken = sideWorkingHours(last, rounds) - sideWorkingHours(last, false);
  return { clocked: working + meals, lastBroken };
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
 * for the 6th/7th day pay multiplier and for flagging the pattern to the user
 * even when it does not pay. Given a payroll company, days count across every
 * employer paid through it, which is how some contracts count them.
 */
export function getConsecutiveDayStreak(
  entryDate: string,
  client: string,
  allJobs: Job[],
  payrollCompany?: string,
): number {
  const targetDate = startOfDay(parseISO(entryDate));
  const sameRun = (j: Job) => {
    const actual = payrollCompany ? (j.payrollCompany ?? j.client) : j.client;
    const target = payrollCompany ?? client;
    return String(actual ?? '').toLowerCase() === String(target ?? '').toLowerCase();
  };

  // A day off, paid or not, breaks a run of days worked.
  const relevantJobs = allJobs.filter(
    j => sameRun(j) && !j.pto && effectiveHoursWorked(j) > 0
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

/** Which day in a row this shift is, counted the way its employer's contract counts them. */
export function dayInARow(job: Job, employer: Employer | undefined, allJobs: Job[]): number {
  // Local 16 counts the days across a payroll company, and so does any
  // contract that says so.
  const byPayroll = isLocal16Shift(job) || contractFor(employer)?.countDaysByPayrollCompany;
  return getConsecutiveDayStreak(
    job.date, job.client, allJobs,
    byPayroll ? (job.payrollCompany || job.client) : undefined,
  );
}

/** Whether a shift's 6th and 7th days in a row pay extra: every Local 16 call does, like breaking the hour. */
export function paysSixthSeventh(job: Job, employer: Employer | undefined): boolean {
  return isLocal16Shift(job) || !!job.has6th7thDayRule || !!employer?.sixthSeventhDayRule;
}

/**
 * What the 6th and 7th days in a row pay: 1.5×, then 2×. Built in for Local
 * 16; other work when its employer's terms say so. The shift can also carry
 * the rule itself, as old ones may.
 */
function streakMultiplier(job: Job, employer: Employer | undefined, allJobs: Job[]): number {
  if (!paysSixthSeventh(job, employer)) return 1;
  const days = dayInARow(job, employer, allJobs);
  if (days >= 7) return 2;
  if (days >= 6) return 1.5;
  return 1;
}

/** A composite team call pays a Saturday at time and a half all day, a Sunday at double. */
export function compositeWeekendMultiplier(job: Job): number {
  if (!job.compositeTeam) return 1;
  const day = parseISO(job.date);
  if (Number.isNaN(day.getTime())) return 1;
  return day.getDay() === 0 ? 2 : day.getDay() === 6 ? 1.5 : 1;
}

/**
 * What the whole day pays, at the least: the 6th or 7th day in a row, or a
 * composite weekend, whichever is more. The two don't multiply: a 7th day that
 * is also a composite Sunday is double time, not quadruple. Overtime past it
 * goes higher only where its own tier already does, as on any premium day.
 */
export function dayMultiplierFor(job: Job, employer: Employer | undefined, allJobs: Job[]): number {
  return Math.max(streakMultiplier(job, employer, allJobs), compositeWeekendMultiplier(job));
}

/** Why a day pays its premium, for the breakdown. */
export function dayPremiumLabel(job: Job, employer: Employer | undefined, allJobs: Job[]): string | undefined {
  const weekend = compositeWeekendMultiplier(job);
  const streak = streakMultiplier(job, employer, allJobs);
  if (weekend > 1 && weekend >= streak) return weekend === 2 ? 'composite Sunday' : 'composite Saturday';
  if (streak > 1) return streak === 2 ? '7th day' : '6th day';
  return undefined;
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
  const rate = job.hourlyRate ?? employer.defaultHourlyRate ?? 0;
  if (rate <= 0) return 0;
  const otHoursForThisJob = weeklyOvertimeHours(job, allJobs, employer);
  if (otHoursForThisJob <= 0) return 0;
  const otMultiplier = employer.overtimeMultiplier ?? 1.5;
  return otHoursForThisJob * rate * (otMultiplier - 1);
}

/** This shift's hours past a weekly overtime threshold: see calculateWeeklyOvertimeBonus. */
export function weeklyOvertimeHours(job: Job, allJobs: Job[], employer: Employer): number {
  if (employer.overtimeRule !== 'weekly') return 0;
  const hours = effectiveHoursWorked(job);
  if (hours <= 0) return 0;
  const threshold = employer.weeklyOvertimeThresholdHours ?? 40;

  const jobDate = startOfDay(parseISO(job.date));
  const weekStart = startOfWeek(jobDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(jobDate, { weekStartsOn: 0 });

  const weekJobs = allJobs
    .filter(j => (j.client ?? '').toLowerCase() === (job.client ?? '').toLowerCase() && effectiveHoursWorked(j) > 0)
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
  return Math.max(0, Math.min(hours, cumulativeAfter - threshold));
}

/**
 * Calculate expected pay for a set of jobs (with hours worked).
 */
export function calculateExpectedPay(
  jobs: Job[],
  referenceJob: Job,
  allJobs: Job[],
  employer?: Employer,
  payer?: PayerProfile,
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
    roundUpToWholeHours: breaksTheHour(referenceJob, employer),
    unionDuesPercent: employer?.unionDuesPercent,
    // A 1099 employer withholds nothing, so nothing comes off what it sends;
    // neither does one whose W-4 says exempt.
    estimatedTaxPercent: withholdsNothing(employer) ? 0 : employer?.estimatedTaxPercent,
  };

  // Group by date
  const byDate = new Map<string, { hours: number; mealPenalties: number; rate: number; offClockMealMinutes: number; postMealPadding: number; dayRate?: number; dayRateHours?: number; mealDuration?: 0 | 30 | 45 | 60; mealOnClock?: boolean; sides: Job[] }>();
  let ptoPay = 0;
  for (const job of jobs) {
    const hours = effectiveHoursWorked(job);
    if (hours <= 0) continue;
    const rate = job.hourlyRate || referenceJob.hourlyRate || 0;
    if (job.pto) {
      // Paid time off: straight time, after dues and withholding, and kept out
      // of the day groups and the vacation base — see jobPayBreakdown.
      const r = calculateDayPay(hours, rate, 0, 0, 1, undefined, { rule: 'none', unionDuesPercent: overtimeOptions.unionDuesPercent, estimatedTaxPercent: overtimeOptions.estimatedTaxPercent });
      ptoPay += r.totalPay;
      details.push({ date: job.date, hours, pay: r.totalPay, breakdown: [`PTO ${roundHours(hours)}h × $${rate.toFixed(2)}`, ...r.breakdown] });
      continue;
    }
    const existing = byDate.get(job.date) || { hours: 0, mealPenalties: 0, rate, offClockMealMinutes: 0, postMealPadding: 0, mealDuration: job.mealDuration, mealOnClock: job.mealOnClock, sides: [] };
    existing.hours += hours;
    existing.sides.push(job);
    existing.mealPenalties += job.mealPenalties || 0;
    existing.rate = rate;
    // Each shift on the date brings its own meal. This used to overwrite, so a
    // two-in/two-out day with two walk aways only ever lost one of them.
    existing.offClockMealMinutes += offClockMealMinutes(job);
    existing.postMealPadding += postMealPaddingHours(job, employer);
    // One day rate covers the whole day, however many shifts it is split into.
    if (job.dayRate && !existing.dayRate) {
      existing.dayRate = job.dayRate;
      existing.dayRateHours = job.dayRateHours ?? employer?.dayRateHours;
    }
    if (job.mealDuration !== undefined) { existing.mealDuration = job.mealDuration; existing.mealOnClock = job.mealOnClock; }
    byDate.set(job.date, existing);
  }

  for (const [date, { hours, mealPenalties, rate, offClockMealMinutes, postMealPadding, mealDuration, mealOnClock, sides }] of byDate.entries()) {
    const representative = sides[0] ?? referenceJob;
    const dayMultiplier = dayMultiplierFor({ ...representative, date }, employer, allJobs);
    // Every call's night hours count. This used to keep only the last call
    // seen, so a split day's after-midnight time could lose its premium
    // entirely depending on which call happened to be listed last.
    // A split day settles each side's minimum as padding, and breaks each
    // side's hour on its own, the same as the per-shift figure does, so the
    // two can never disagree about one day.
    const isSplit = sides.length > 1;
    const rounds = !!overtimeOptions.roundUpToWholeHours;
    const split = isSplit ? splitDayHours(sides, rounds) : null;
    const lastNight = shiftNight(lastCall(sides), employer);
    const nightHours = sides.reduce((sum, j) => sum + shiftNight(j, employer).hours, 0)
      + (split && lastNight.hours > 0 ? Math.min(split.lastBroken, lastNight.leftAtEnd) : 0);
    const nightLeft = split ? 0 : lastNight.leftAtEnd;
    const dayMinimum = isSplit ? 0 : callMinimum({ ...sides[0], minimumHours: sides[0].minimumHours ?? referenceJob.minimumHours }, employer);
    const dayEntry = byDate.get(date);
    const result = calculateDayPay(split ? split.clocked : hours, rate, dayMinimum, mealPenalties, dayMultiplier, { duration: mealDuration, onClock: mealOnClock, offClockMinutesTotal: offClockMealMinutes }, { ...overtimeOptions, nightHours, nightLeftAtEnd: nightLeft, minimumPaddingHours: isSplit ? splitMinimumPadding(sides, j => splitSideMinimum({ ...j, minimumHours: j.minimumHours ?? referenceJob.minimumHours }, employer, payer), rounds) : 0, postMealPaddingHours: postMealPadding, dayRate: dayEntry?.dayRate, dayRateHours: dayEntry?.dayRateHours, premiums: shiftPremiums({ ...firstCall(sides), date }, allJobs, employer, payer) });
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

  // Vacation pay: configurable per-employer percent of gross earnings
  const vacationPercent = employer?.vacationPercent ?? 0;
  if (vacationPercent > 0 && total > 0) {
    const vacPay = total * (vacationPercent / 100);
    total += vacPay;
    details.push({
      date: '',
      hours: 0,
      pay: vacPay,
      breakdown: [`Vacation pay (${vacationPercent}% of gross) = $${vacPay.toFixed(2)}`],
    });
  }

  // After vacation, which is earned on work and not on time off.
  total += ptoPay;

  return { total, details };
}
