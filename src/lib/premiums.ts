import type { Employer, Job } from './store';
import type { ContractRule, PayerProfile } from './payerProfile';
import { shiftContract } from './contracts';
import { breaksTheHour, isLocal16Shift } from './local16';
import { nameSimilarity, AUTO_MATCH_THRESHOLD } from './employerMatch';
import { clockMinutes, endAfterStart } from './clock';
import { roundHours } from './hoursFormat';

/**
 * Premiums that start a call: the early-call premium and the forced call.
 *
 * Both run from the start of the call, so they are the day's first hours. Each
 * of those hours pays the higher of the premium and whatever overtime it would
 * have been anyway, never both on top of each other (see calculateDayPay).
 */

/** A call that starts from midnight up to this hour is an early call. */
export const EARLY_CALL_BEFORE_HOUR = 7;
/** An "until 8 AM" early-call premium stops here. */
export const EARLY_CALL_UNTIL_HOUR = 8;
/** Less time off than this between calls is a forced call. */
export const FORCED_CALL_REST_HOURS = 9;

export interface StartPremium {
  /** Hours from the start of the call. */
  hours: number;
  multiplier: number;
  /** For the pay breakdown: "forced call, 6h off". */
  label: string;
}

/** A call's clock times, in minutes from its own date's midnight. The end can run past the next midnight. */
export function callSpan(job: Pick<Job, 'startTime' | 'endTime'>): { start: number; end: number } | null {
  const start = clockMinutes(job.startTime);
  // A bare "8" to "5" is 8 AM to 5 PM: see clock.ts.
  const end = endAfterStart(start, job.endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
}

const dayNumber = (date: string) => Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000);

const normalName = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

/** What a shift's terms are filed under: its contract's name, or its employer's when it names none. */
export function ruleKeyFor(job: Pick<Job, 'contract' | 'notes' | 'client'>, employer?: Pick<Employer, 'name'>): string {
  return normalName(shiftContract(job) ?? employer?.name ?? job.client ?? '');
}

export function contractRuleFor(job: Pick<Job, 'contract' | 'notes' | 'client'>, employer: Pick<Employer, 'name'> | undefined, payer?: PayerProfile): ContractRule | undefined {
  const key = ruleKeyFor(job, employer);
  return key ? payer?.contractRules?.find(r => normalName(r.name) === key) : undefined;
}

/** The profile with one contract's rule changed, ready to save. */
export function withContractRule(payer: PayerProfile, name: string, change: Partial<ContractRule>): PayerProfile {
  const key = normalName(name);
  const rules = payer.contractRules ?? [];
  const found = rules.find(r => normalName(r.name) === key);
  const next = found
    ? rules.map(r => (r === found ? { ...r, ...change } : r))
    : [...rules, { name: name.trim(), ...change }];
  return { ...payer, contractRules: next };
}

/** Union work: a Local 16 dispatch, a local named on the shift or its employer, or a contract named. */
export function isUnionShift(job: Pick<Job, 'local' | 'jobNumber' | 'contract' | 'notes'>, employer?: Pick<Employer, 'unionLocal'>): boolean {
  return isLocal16Shift(job) || !!job.local?.trim() || !!employer?.unionLocal?.trim() || !!shiftContract(job);
}

/** Whether a call starts between midnight and 7 AM. */
export function isEarlyCall(job: Pick<Job, 'startTime' | 'endTime'>): boolean {
  // Only the start matters, so a call saved before its end is known still counts.
  const start = clockMinutes(job.startTime);
  return !Number.isNaN(start) && start < EARLY_CALL_BEFORE_HOUR * 60;
}

/** When an "until" early-call premium stops, by the contract's choice. */
export const earlyCallUntilHour = (rule?: ContractRule['earlyCall']) => (rule === 'until7' ? 7 : EARLY_CALL_UNTIL_HOUR);

/** "until 8 AM", "all day": the premium in words. */
export const earlyCallWords = (rule?: ContractRule['earlyCall']) =>
  rule === 'allDay' ? 'all day' : rule === 'until7' || rule === 'until8' ? `until ${earlyCallUntilHour(rule)} AM` : 'none';

/**
 * Hours of an early call at the premium: until 7 or 8 AM, or the whole call.
 * Where the call breaks the hour, so do its premium hours: there's no such
 * thing as an hour and a half of premium, so a 6:30 start with premium until
 * 8 is two hours of it, 6:30 to 8:30.
 */
export function earlyCallHours(job: Pick<Job, 'startTime' | 'endTime'>, rule?: ContractRule['earlyCall'], breaksHour = false): number {
  const span = callSpan(job);
  if (!span || span.start >= EARLY_CALL_BEFORE_HOUR * 60) return 0;
  const length = (span.end - span.start) / 60;
  if (rule === 'allDay') return length;
  if (rule !== 'until7' && rule !== 'until8') return 0;
  const raw = Math.max(0, Math.min(span.end, earlyCallUntilHour(rule) * 60) - span.start) / 60;
  return breaksHour ? Math.min(Math.ceil(raw - 1e-9), Math.ceil(length - 1e-9)) : raw;
}

/** A split day's side with no minimum of its own gets this on union work. */
export const SPLIT_SIDE_MINIMUM_HOURS = 4;
/** A head call's minimum: the offer names the position ("T ELEC HEAD", "V1 HEAD VIDEO"). */
export const HEAD_CALL_MINIMUM_HOURS = 8;

const DEPARTMENT = '(?:ELEC(?:TRICS?|TRICIAN)?|AUDIO|VIDEO|LIGHT(?:ING)?|LX|PROPS?|CARP(?:ENTER)?|RIGG(?:ER|ING)?|SOUND|A\\/?V|WARDROBE|CAMERA|FLY(?:MAN)?|STAGE)';
const HEAD_POSITION = new RegExp(`\\b(?:[A-Z]\\d?\\s+)?${DEPARTMENT}\\s+HEAD\\b|\\b(?:[A-Z]\\d\\s+)?HEAD\\s+${DEPARTMENT}\\b`, 'i');

/** The head position an offer names, as written ("T ELEC HEAD"), or nothing. */
export function headCallIn(job: Pick<Job, 'role' | 'notes'>): string | undefined {
  for (const text of [job.role, job.notes]) {
    const found = text?.match(HEAD_POSITION)?.[0];
    if (found) return found.trim().toUpperCase();
  }
  return undefined;
}

/**
 * The minimum call on a day that isn't split: the shift's own, else 8 hours
 * when a union offer says it's a head call. Splits have their own (see
 * splitSideMinimum); a split is never 8 hours a side.
 */
export function callMinimum(job: Job, employer?: Employer): number {
  if (job.minimumHours != null) return job.minimumHours;
  return isUnionShift(job, employer) && headCallIn(job) ? HEAD_CALL_MINIMUM_HOURS : 0;
}

/**
 * The minimum call a side of a split day is owed: its own, else its
 * contract's split minimum (Palace of Fine Arts is 5 a side), else the usual
 * 4 on the front and 4 on the back for union work. Non-union work has none
 * unless the shift says.
 */
export function splitSideMinimum(job: Job, employer?: Employer, payer?: PayerProfile): number {
  if (job.minimumHours != null) return job.minimumHours;
  const rule = contractRuleFor(job, employer, payer);
  if (rule?.splitMinimumHours != null) return rule.splitMinimumHours;
  return isUnionShift(job, employer) ? SPLIT_SIDE_MINIMUM_HOURS : 0;
}

/** Who booked the work: the local for union calls ("16"), else the employer. */
function bookedBy(job: Job): string | null {
  if (isLocal16Shift(job)) return '16';
  const local = job.local?.match(/\d+/)?.[0] ?? job.local?.trim().toLowerCase();
  return local || null;
}

/**
 * The same booking agent offered both calls: the same local (every Local 16
 * dispatch counts, whichever employer it's for), or the same employer.
 */
const sameBooker = (a: Job, b: Job) => {
  const booker = bookedBy(a);
  if (booker && booker === bookedBy(b)) return true;
  return (!!a.jobNumber && a.jobNumber === b.jobNumber) || nameSimilarity(a.client ?? '', b.client ?? '') >= AUTO_MATCH_THRESHOLD;
};

export interface ForcedCall {
  /** Hours off between the last call and this one. */
  restHours: number;
  /** The call it came back from. */
  after: Job;
}

/**
 * Back for the same booking agent (the same local, or the same employer) with less than the rest owed since the last call
 * ended is a forced call. It pays double time until you've had the rest off
 * work: the whole day, however long it runs, since you're still working. The
 * next day's rest is counted from when this one ends, so it starts over.
 * Only calls on earlier days count; calls on the same day are one split day.
 */
export function forcedCallFor(job: Job, allJobs: Job[], restHours = FORCED_CALL_REST_HOURS): ForcedCall | null {
  const span = callSpan(job);
  if (!span) return null;
  const day = dayNumber(job.date);
  const start = day * 1440 + span.start;
  let after: Job | undefined;
  let lastEnd = -Infinity;
  for (const other of allJobs) {
    if (other.id === job.id || other.date >= job.date) continue;
    const back = day - dayNumber(other.date);
    if (!(back >= 1 && back <= 2)) continue;
    if (other.status === 'cancelled' || other.pto || other.hoursPlanned || !sameBooker(other, job)) continue;
    const o = callSpan(other);
    if (!o) continue;
    const otherEnd = dayNumber(other.date) * 1440 + o.end;
    if (otherEnd > start || otherEnd <= lastEnd) continue;
    lastEnd = otherEnd;
    after = other;
  }
  if (!after) return null;
  const rest = (start - lastEnd) / 60;
  if (rest >= restHours) return null;
  return { restHours: roundHours(rest), after };
}

const hoursText = (h: number) => `${roundHours(h)}h`;

/** The premiums a call starts with, for calculateDayPay. */
export function shiftPremiums(job: Job, allJobs: Job[], employer?: Employer, payer?: PayerProfile): StartPremium[] {
  if (job.pto) return [];
  const rule = contractRuleFor(job, employer, payer);
  const out: StartPremium[] = [];
  const early = earlyCallHours(job, rule?.earlyCall, breaksTheHour(job, employer));
  if (early > 0) {
    out.push({
      hours: early,
      multiplier: employer?.nightPremiumMultiplier ?? 2,
      label: `early call, premium ${earlyCallWords(rule?.earlyCall)}`,
    });
  }
  if (rule?.forcedCall ?? isUnionShift(job, employer)) {
    const rest = rule?.restHours ?? FORCED_CALL_REST_HOURS;
    const forced = forcedCallFor(job, allJobs, rest);
    if (forced) {
      out.push({
        // Every hour of the day, until you're done.
        hours: Infinity,
        multiplier: employer?.doubletimeMultiplier ?? 2,
        label: `forced call (${hoursText(forced.restHours)} off, under ${rest}h)`,
      });
    }
  }
  return out;
}
