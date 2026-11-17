import type { Employer, Job } from './store';
import type { ContractRule, PayerProfile } from './payerProfile';
import { shiftContract } from './contracts';
import { isLocal16Shift } from './local16';
import { nameSimilarity, AUTO_MATCH_THRESHOLD } from './employerMatch';

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

function minutesOf(t?: string): number {
  const m = t?.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
  if (!m) return NaN;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || '0');
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return h * 60 + min;
}

/** A call's clock times, in minutes from its own date's midnight. The end can run past the next midnight. */
export function callSpan(job: Pick<Job, 'startTime' | 'endTime'>): { start: number; end: number } | null {
  const start = minutesOf(job.startTime);
  let end = minutesOf(job.endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  // An end saved bare, with no am or pm ("8" to "5"), is the next time that
  // hour comes round: 5 PM the same day, not 5 AM the next. Read as 5 AM it
  // made a 21-hour day, and a forced call out of the morning after.
  if (end <= start && !/[ap]/i.test(job.endTime ?? '') && end + 12 * 60 > start) end += 12 * 60;
  if (end <= start) end += 24 * 60;
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
  const span = callSpan(job);
  return !!span && span.start < EARLY_CALL_BEFORE_HOUR * 60;
}

/** Hours of an early call at the premium: until 8 AM, or the whole call. */
export function earlyCallHours(job: Pick<Job, 'startTime' | 'endTime'>, rule?: ContractRule['earlyCall']): number {
  const span = callSpan(job);
  if (!span || span.start >= EARLY_CALL_BEFORE_HOUR * 60) return 0;
  if (rule === 'allDay') return (span.end - span.start) / 60;
  if (rule === 'until8') return Math.max(0, Math.min(span.end, EARLY_CALL_UNTIL_HOUR * 60) - span.start) / 60;
  return 0;
}

const sameEmployer = (a: Job, b: Job) =>
  (!!a.jobNumber && a.jobNumber === b.jobNumber) || nameSimilarity(a.client ?? '', b.client ?? '') >= AUTO_MATCH_THRESHOLD;

export interface ForcedCall {
  /** Hours of this call inside the rest it was owed, at double time. */
  hours: number;
  /** Hours off between the last call and this one. */
  restHours: number;
  /** The call it came back from. */
  after: Job;
}

/**
 * Back for the same employer with less than the rest owed since the last call
 * ended: the hours until that rest would have been had are a forced call.
 * Only calls on earlier days count; calls on the same day are one split day.
 */
export function forcedCallFor(job: Job, allJobs: Job[], restHours = FORCED_CALL_REST_HOURS): ForcedCall | null {
  const span = callSpan(job);
  if (!span) return null;
  const day = dayNumber(job.date);
  const start = day * 1440 + span.start;
  const end = day * 1440 + span.end;
  let after: Job | undefined;
  let lastEnd = -Infinity;
  for (const other of allJobs) {
    if (other.id === job.id || other.date >= job.date) continue;
    const back = day - dayNumber(other.date);
    if (!(back >= 1 && back <= 2)) continue;
    if (other.status === 'cancelled' || other.pto || other.hoursPlanned || !sameEmployer(other, job)) continue;
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
  const hours = Math.max(0, Math.min(lastEnd + restHours * 60, end) - start) / 60;
  return hours > 0 ? { hours, restHours: Math.round(rest * 100) / 100, after } : null;
}

const hoursText = (h: number) => `${Math.round(h * 100) / 100}h`;

/** The premiums a call starts with, for calculateDayPay. */
export function shiftPremiums(job: Job, allJobs: Job[], employer?: Employer, payer?: PayerProfile): StartPremium[] {
  if (job.pto) return [];
  const rule = contractRuleFor(job, employer, payer);
  const out: StartPremium[] = [];
  const early = earlyCallHours(job, rule?.earlyCall);
  if (early > 0) {
    out.push({
      hours: early,
      multiplier: employer?.nightPremiumMultiplier ?? 2,
      label: rule?.earlyCall === 'allDay' ? 'early call, premium all day' : 'early call, premium until 8 AM',
    });
  }
  if (rule?.forcedCall ?? isUnionShift(job, employer)) {
    const rest = rule?.restHours ?? FORCED_CALL_REST_HOURS;
    const forced = forcedCallFor(job, allJobs, rest);
    if (forced) {
      out.push({
        hours: forced.hours,
        multiplier: employer?.doubletimeMultiplier ?? 2,
        label: `forced call, ${hoursText(forced.restHours)} off of ${rest}h`,
      });
    }
  }
  return out;
}
