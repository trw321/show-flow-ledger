import type { Job, Employer } from './store';
import { ratesForShift, EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import { parseDayTimeline, POST_MEAL_MINIMUM_HOURS } from './dayTimeline';
import { parseISO, differenceInCalendarDays, startOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { resolveEmployer } from './employerMatch';
import { localToday } from './today';

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
): { billableHours: number; totalPay: number; breakdown: string[]; duesAmount: number; taxAmount: number; nightHours: number } {
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
    breakdown.push(`${laddered}h rounds up to ${billableHours}h (union hours)`);
  }

  if (offClockMinutes > 0) {
    breakdown.push(`${offClockMinutes}min meal off clock: ${actualHours}h − ${mealDeduction}h = ${adjustedHours}h`);
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
    breakdown.push(`Day rate (covers ${covers}h) = $${(dayRate * Math.max(1, dayMultiplier)).toFixed(2)}`);
    if (over > 0) {
      breakdown.push(`${over}h past the day rate × $${(hourlyEquivalent * otMultiplier).toFixed(2)} = $${otPay.toFixed(2)}`);
    }
  } else if (otRule !== 'daily') {
    pay = ladderHours * effectiveRate;
    if (ladderHours > 0) breakdown.push(`${ladderHours}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (ladderHours <= otThreshold) {
    pay = ladderHours * effectiveRate;
    if (ladderHours > 0) breakdown.push(`${ladderHours}h × $${effectiveRate.toFixed(2)} = $${pay.toFixed(2)}`);
  } else if (ladderHours <= dtThreshold) {
    const straightPay = otThreshold * effectiveRate;
    const otHours = ladderHours - otThreshold;
    const otRate = tierRate(otMultiplier);
    const otPay = otHours * otRate;
    pay = straightPay + otPay;
    breakdown.push(`${otThreshold}h straight × ${effectiveRate.toFixed(2)} = ${straightPay.toFixed(2)}`);
    breakdown.push(`${otHours}h OT × ${otRate.toFixed(2)} = ${otPay.toFixed(2)}`);
  } else {
    const straightPay = otThreshold * effectiveRate;
    const otHours = dtThreshold - otThreshold;
    const otRate = tierRate(otMultiplier);
    const otPay = otHours * otRate;
    const dtHours = ladderHours - dtThreshold;
    const dtRate = tierRate(dtMultiplier);
    const dtPay = dtHours * dtRate;
    pay = straightPay + otPay + dtPay;
    breakdown.push(`${otThreshold}h straight × ${effectiveRate.toFixed(2)} = ${straightPay.toFixed(2)}`);
    breakdown.push(`${otHours}h OT × ${otRate.toFixed(2)} = ${otPay.toFixed(2)}`);
    breakdown.push(`${dtHours}h DT × ${dtRate.toFixed(2)} = ${dtPay.toFixed(2)}`);
  }

  if (paddingHours > 0 && !(overtimeOptions?.dayRate && overtimeOptions.dayRate > 0)) {
    const padPay = paddingHours * effectiveRate;
    pay += padPay;
    breakdown.push(`${paddingHours}h minimum-call padding × $${effectiveRate.toFixed(2)} = $${padPay.toFixed(2)}`);
  }

  // A day rate already pays for every hour it covers, night ones included, so
  // the night premium only applies when the day is paid by the hour —
  // otherwise those hours would be paid twice.
  if (nightHours > 0 && !(overtimeOptions?.dayRate && overtimeOptions.dayRate > 0)) {
    const nightRate = tierRate(nightMultiplier);
    const nightPay = nightHours * nightRate;
    pay += nightPay;
    breakdown.push(`${nightHours}h after midnight × ${nightRate.toFixed(2)} = ${nightPay.toFixed(2)}`);
  }

  const postMealPadding = overtimeOptions?.postMealPaddingHours ?? 0;
  if (postMealPadding > 0) {
    const padPay = postMealPadding * rate;
    pay += padPay;
    breakdown.push(`${postMealPadding}h post-meal minimum × ${rate.toFixed(2)} = ${padPay.toFixed(2)}`);
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
    breakdown.unshift(`${actualHours}h worked → ${minimumHours}h minimum applied`);
  }

  if (dayMultiplier > 1) {
    breakdown.unshift(`Day multiplier: ${dayMultiplier}× (${dayMultiplier === 1.5 ? '6th day' : '7th day'})`);
  }

  return { billableHours: billableHours + (overtimeOptions?.minimumPaddingHours ?? 0), totalPay: pay, breakdown, duesAmount, taxAmount, nightHours };
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
  const s = parseTimeToMinutes(job.startTime);
  let e = parseTimeToMinutes(job.endTime);
  if (isNaN(s) || isNaN(e)) return 0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
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
    const timeline = parseDayTimeline(job.callTimeline, job.callGapsOnClock ?? []);
    if (timeline) return timeline.offClockMinutes;
  }
  const first = job.mealDuration && !job.mealOnClock ? job.mealDuration : 0;
  const second = job.meal2Duration && !job.meal2OnClock ? job.meal2Duration : 0;
  return first + second;
}

/**
 * Straight-time hours owed on top of the worked ones because a call ended too
 * soon after an off-the-clock meal. Only a day entered as calls can know this —
 * a single clocked figure cannot say when the meal was or what followed it.
 */
export function postMealPaddingHours(job: Job, employer?: Employer): number {
  const guaranteed = employer?.postMealMinimumHours ?? 0;
  if (!guaranteed || !job.callTimeline) return 0;
  const timeline = parseDayTimeline(job.callTimeline, job.callGapsOnClock ?? []);
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
  // Each side of a split carries its own minimum call — four or five hours a
  // half — so a short morning bills its minimum rather than the hours stood
  // there. The hours worked on both sides climb one ladder; what a short side
  // is owed beyond its hours is minimum-call padding, paid flat at straight
  // time like any other.
  const billable = (j: Job) => Math.max(effectiveHoursWorked(j), j.minimumHours ?? 0);
  const dayHours = isSplitDay
    ? dayShifts.reduce((sum, j) => sum + effectiveHoursWorked(j), 0)
    : hours;
  const billableDay = isSplitDay ? dayShifts.reduce((sum, j) => sum + billable(j), 0) : hours;
  const share = isSplitDay && billableDay > 0 ? billable(job) / billableDay : 1;
  const employer = resolveEmployer(job.client, employers);
  // Dues follow the local, tax follows you, and only what is left is the
  // employer's to say. See payerProfile for why.
  const rates = ratesForShift(job, employer, payer);
  const dayMult = getDayMultiplier(job.date, job.client, allJobs, job.has6th7thDayRule ?? false);
  const dayMealMinutes = isSplitDay
    ? dayShifts.reduce((sum, j) => sum + offClockMealMinutes(j), 0)
    : offClockMealMinutes(job);
  const dayPenalties = isSplitDay
    ? dayShifts.reduce((sum, j) => sum + (j.mealPenalties ?? 0), 0)
    : (job.mealPenalties ?? 0);
  const sides = isSplitDay ? dayShifts : [job];
  const dayNightHours = sides.reduce((sum, j) => sum + shiftNight(j, employer).hours, 0);
  // A broken hour falls at the end of the day's last call.
  const dayNightLeft = shiftNight(lastCall(sides), employer).leftAtEnd;

  // On a split each side's minimum is settled as padding; applying the
  // shift's own minimum again here would floor the whole day at it.
  const dayMinimum = isSplitDay ? 0 : (job.minimumHours ?? 0);
  const dayResult = calculateDayPay(dayHours, rate, dayMinimum, dayPenalties, dayMult, { duration: job.mealDuration, onClock: job.mealOnClock, offClockMinutesTotal: dayMealMinutes }, {
    rule: employer?.overtimeRule ?? 'daily',
    otThresholdHours: employer?.dailyOvertimeThresholdHours,
    dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
    otMultiplier: employer?.overtimeMultiplier,
    roundUpToWholeHours: employer?.roundUpToWholeHours,
    postMealPaddingHours: postMealPaddingHours(job, employer),
    // The shift's own day rate, if it has one — the employer's is only where a
    // new shift starts from. On a split day the whole day is one day rate.
    dayRate: job.dayRate,
    dayRateHours: job.dayRateHours ?? employer?.dayRateHours,
    dtMultiplier: employer?.doubletimeMultiplier,
    nightHours: dayNightHours,
    nightLeftAtEnd: dayNightLeft,
    minimumPaddingHours: isSplitDay ? splitMinimumPadding(dayShifts) : 0,
    nightMultiplier: employer?.nightPremiumMultiplier,
    unionDuesPercent: rates.unionDuesPercent,
    estimatedTaxPercent: rates.estimatedTaxPercent,
  });
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
  const eRaw = parseTimeToMinutes(endTime);
  if (isNaN(s) || isNaN(eRaw)) return 0;
  let e = eRaw;
  if (e <= s) e += 24 * 60;
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
function splitMinimumPadding(sides: Job[], fallbackMinimum = 0): number {
  return sides.reduce((sum, j) => {
    const net = effectiveHoursWorked(j) - offClockMealMinutes(j) / 60;
    return sum + Math.max(0, (j.minimumHours ?? fallbackMinimum) - net);
  }, 0);
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

  // A day off, paid or not, breaks a run of days worked.
  const relevantJobs = allJobs.filter(
    j => j.client === client && !j.pto && effectiveHoursWorked(j) > 0
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
    roundUpToWholeHours: employer?.roundUpToWholeHours,
    unionDuesPercent: employer?.unionDuesPercent,
    // A 1099 employer withholds nothing, so nothing comes off what it sends.
    estimatedTaxPercent: employer?.workerStatus === '1099' ? 0 : employer?.estimatedTaxPercent,
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
      details.push({ date: job.date, hours, pay: r.totalPay, breakdown: [`PTO ${hours}h × $${rate.toFixed(2)}`, ...r.breakdown] });
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
    const dayMultiplier = getDayMultiplier(date, referenceJob.client, allJobs, referenceJob.has6th7thDayRule || false);
    // Every call's night hours count. This used to keep only the last call
    // seen, so a split day's after-midnight time could lose its premium
    // entirely depending on which call happened to be listed last.
    const nightHours = sides.reduce((sum, j) => sum + shiftNight(j, employer).hours, 0);
    const nightLeft = shiftNight(lastCall(sides), employer).leftAtEnd;
    // A split day settles each side's minimum as padding, the same as the
    // per-shift figure does, so the two can never disagree about one day.
    const isSplit = sides.length > 1;
    const fallbackMinimum = referenceJob.minimumHours ?? 0;
    const dayMinimum = isSplit ? 0 : (sides[0].minimumHours ?? fallbackMinimum);
    const dayEntry = byDate.get(date);
    const result = calculateDayPay(hours, rate, dayMinimum, mealPenalties, dayMultiplier, { duration: mealDuration, onClock: mealOnClock, offClockMinutesTotal: offClockMealMinutes }, { ...overtimeOptions, nightHours, nightLeftAtEnd: nightLeft, minimumPaddingHours: isSplit ? splitMinimumPadding(sides, fallbackMinimum) : 0, postMealPaddingHours: postMealPadding, dayRate: dayEntry?.dayRate, dayRateHours: dayEntry?.dayRateHours });
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
