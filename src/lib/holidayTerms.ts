import type { Employer, Job } from './store';
import type { PayerProfile } from './payerProfile';
import { BGCA_HOLIDAY_EXTRA, BGCA_HOLIDAYS, isBgcaShift } from './bgca';
import { contractRuleFor } from './premiums';
import { shiftContract } from './contracts';
import { HOLIDAYS, holidayOn, type HolidayKey } from './holidays';

/**
 * What a shift's contract pays on a holiday: the share of the straight rate
 * added to each holiday hour, and which days are its holidays.
 *
 * The Civic Auditorium's contract comes with its terms (½ on top,
 * Thanksgiving: see bgca.ts). Any contract can have more saved on its rules
 * in your settings: holidays learned from a pay stub that paid holiday pay
 * on one, and the extra when it isn't the Civic's. Null: the contract pays
 * nothing extra on a holiday that the app knows of.
 */
export interface HolidayTerms {
  extra: number;
  keys: HolidayKey[];
  holidayOn: (date: string) => string | undefined;
}

type HolidayShift = Pick<Job, 'contract' | 'notes' | 'client'> & Partial<Pick<Job, 'venue'>>;

/** A saved extra that makes sense: a share of the straight rate, more than nothing and at most double. */
const sensibleExtra = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 2;

export function holidayTermsFor(job: HolidayShift, employer?: Pick<Employer, 'name'>, payer?: PayerProfile): HolidayTerms | null {
  const rule = contractRuleFor(job, employer, payer);
  const builtIn = isBgcaShift(job) ? { extra: BGCA_HOLIDAY_EXTRA, keys: BGCA_HOLIDAYS } : undefined;
  const extra = sensibleExtra(rule?.holidayExtra) ? rule.holidayExtra : builtIn?.extra;
  // Saved settings can hold anything: only holidays the app knows the dates of.
  const saved = Array.isArray(rule?.holidays) ? rule.holidays.filter((k): k is HolidayKey => typeof k === 'string' && k in HOLIDAYS) : [];
  const keys = [...new Set([...(builtIn?.keys ?? []), ...saved])];
  if (!extra || keys.length === 0) return null;
  return { extra, keys, holidayOn: date => holidayOn(date, keys) };
}

/** What a learned holiday is saved under: the shift's contract, or its employer when it names none (as every contract rule is). */
export function holidayRuleName(job: Pick<Job, 'contract' | 'notes' | 'client'>, employer?: Pick<Employer, 'name'>): string {
  return shiftContract(job) ?? employer?.name ?? job.client ?? '';
}

/** "Thanksgiving and Christmas": a contract's holidays in words. */
export function holidayNames(keys: HolidayKey[]): string {
  const names = keys.map(k => HOLIDAYS[k].name);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
