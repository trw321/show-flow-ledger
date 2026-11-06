import type { Employer, Job } from './store';

/**
 * The contracts you work under, as terms an employer can take on.
 *
 * Two different things live here, and they must not be confused.
 *
 * A union contract belongs to the SHIFT. Local 16 has many, each dispatch names
 * the one it is under, and the same employer at the same venue can be under a
 * different one from one call to the next. So a contract is never tied to an
 * employer or a venue: the shift keeps the name (see shiftContract), and no
 * terms are applied from it yet, because none have been confirmed.
 *
 * A company's own terms, like Reliant AV's guidelines, do cover everything for
 * that one company, so those can be picked on the employer (perEmployer).
 *
 * The terms here are as they were saved in May 2026: what was saved, not a
 * reading of any agreement.
 */

export interface Contract {
  key: string;
  name: string;
  /** Short enough for an employer's line. */
  short: string;
  version: string;
  /** What picking it sets on an employer. */
  terms: Partial<Employer>;
  /** The terms in plain words. */
  summary: string[];
  /** In the contract, but not worked out by the app. */
  notCalculated: string[];
  /** Said wherever it is shown, when what it covers needs care. */
  caution?: string;
  /** A company's own terms, which can be picked on that employer. A union contract never is. */
  perEmployer?: boolean;
  /** The 6th and 7th days count across everyone paying through one payroll company, not one employer. */
  countDaysByPayrollCompany?: boolean;
}

export const CONTRACTS: Contract[] = [
  {
    key: 'ia16-basic',
    name: 'Local 16 Basic Entertainment',
    short: 'Basic Ent.',
    version: '2023-2028',
    caution: "One of Local 16's many contracts, with terms saved in May and not checked against the agreement. Kept here to read. The app doesn't apply it: contracts go by the shift, not the employer.",
    terms: {
      contract: 'ia16-basic',
      unionLocal: '16',
      overtimeRule: 'daily',
      dailyOvertimeThresholdHours: 8,
      dailyDoubletimeThresholdHours: 12,
      overtimeMultiplier: 1.5,
      doubletimeMultiplier: 2,
      roundUpToWholeHours: true,
      minimumCallHours: 5,
      mealPenaltyAfterHours: 5,
      nightPremiumEnabled: true,
      nightPremiumStartHour: 0,
      nightPremiumEndHour: 8,
      nightPremiumMultiplier: 2,
      sixthSeventhDayRule: true,
      vacationPercent: 8,
      paySchedule: 'bi-weekly',
      // A two-week period, paid 14 days after it closes.
      payLagDays: 28,
      firstCheckWeeks: undefined,
    },
    summary: [
      '1.5× after 8 hours, 2× after 12',
      'Breaks the hour: a part hour pays as a whole one',
      '5 hour minimum call',
      'Meal due after 5 hours; penalty by the hour at straight time',
      '2× from midnight to 8 AM',
      '6th day in a row 1.5×, 7th day 2×, counted by payroll company',
      '8% fringe, paid in the check',
      'Paid bi-weekly, 14 days after the period',
    ],
    notCalculated: [],
    countDaysByPayrollCompany: true,
  },
  {
    key: 'reliant-2026',
    name: 'Reliant AV Guidelines',
    short: 'Reliant AV',
    version: '2026',
    perEmployer: true,
    terms: {
      contract: 'reliant-2026',
      defaultHourlyRate: 35,
      roles: [{ name: 'General Tech', hourlyRate: 35 }],
      overtimeRule: 'daily',
      dailyOvertimeThresholdHours: 10,
      dailyDoubletimeThresholdHours: 14,
      overtimeMultiplier: 1.5,
      doubletimeMultiplier: 2,
      roundUpToWholeHours: false,
      minimumCallHours: 5,
      // The guidelines name a night window but no rate for it, and a rate is
      // not something to guess at.
      nightPremiumEnabled: false,
      nightPremiumEndHour: 7,
      sixthSeventhDayRule: false,
      paySchedule: 'weekly',
      payLagDays: undefined,
      firstCheckWeeks: undefined,
    },
    summary: [
      '$35/hr General Tech, non-union',
      '1.5× after 10 hours, 2× after 14',
      '5 hour minimum call',
      'Paid weekly',
    ],
    notCalculated: [
      '8 hour turnaround between calls',
      'Night work midnight to 7 AM: no rate was saved, so no premium is applied',
    ],
  },
];

/** Dress codes the parser can leave on the end of a line of notes. */
const DRESS_CODE_AT_END = /\s+(NWB|YWA|NWA|WC|BOB|ALL BLACK)$/;

/**
 * A contract name inside a shift's notes, which is where the parser put it
 * before shifts had a place of their own for it. Only finds names that lead
 * with their years, which is how the ones seen so far are written.
 */
export function contractInNotes(notes?: string): string | undefined {
  const found = notes?.match(/\b(20\d{2})\s*-\s*(20\d{2})\s+[A-Z][A-Z0-9 &'/.-]*[A-Z0-9]/);
  if (!found) return undefined;
  // A job number can look like this; a contract's years run forwards and close together.
  const span = Number(found[2]) - Number(found[1]);
  if (span < 0 || span > 10) return undefined;
  return found[0].replace(DRESS_CODE_AT_END, '').replace(/\s+/g, ' ').trim();
}

/** The contract a shift is under, as its dispatch named it. */
export function shiftContract(job: Pick<Job, 'contract' | 'notes'>): string | undefined {
  return job.contract?.trim() || contractInNotes(job.notes);
}

export interface WorkedContract {
  name: string;
  shifts: number;
  lowestRate?: number;
  highestRate?: number;
}

/** Every contract your shifts name, most worked first: the real list, built from your own dispatches. */
export function contractsWorked(jobs: Job[]): WorkedContract[] {
  const seen = new Map<string, WorkedContract>();
  for (const job of jobs) {
    const name = job.status === 'cancelled' ? undefined : shiftContract(job);
    if (!name) continue;
    const key = name.toUpperCase().replace(/\s+/g, ' ');
    const entry = seen.get(key) ?? { name, shifts: 0 };
    entry.shifts += 1;
    if (job.hourlyRate) {
      entry.lowestRate = Math.min(entry.lowestRate ?? job.hourlyRate, job.hourlyRate);
      entry.highestRate = Math.max(entry.highestRate ?? job.hourlyRate, job.hourlyRate);
    }
    seen.set(key, entry);
  }
  return [...seen.values()].sort((a, b) => b.shifts - a.shifts || a.name.localeCompare(b.name));
}

/** The contract an employer is on, if any. */
export function contractFor(employer: Pick<Employer, 'contract'> | undefined): Contract | undefined {
  return employer?.contract ? CONTRACTS.find(c => c.key === employer.contract) : undefined;
}
