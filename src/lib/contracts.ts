import type { Employer } from './store';

/**
 * The contracts you work under, as terms an employer can take on.
 *
 * Built in rather than stored on an account: a contract is the same on every
 * device and for anyone under it, and picking one has to work before anyone
 * has signed in. Picking one copies its terms onto the employer, where every
 * pay figure already reads them — and where any of them can still be changed.
 *
 * These are the terms as they were saved in May 2026. What is here is what
 * was saved, not a reading of the agreement itself.
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
  /** The 6th and 7th days count across everyone paying through one payroll company, not one employer. */
  countDaysByPayrollCompany?: boolean;
}

export const CONTRACTS: Contract[] = [
  {
    key: 'ia16-basic',
    name: 'IATSE Local 16 Basic Agreement',
    short: 'Local 16',
    version: '2023–2028',
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

/** The contract an employer is on, if any. */
export function contractFor(employer: Pick<Employer, 'contract'> | undefined): Contract | undefined {
  return employer?.contract ? CONTRACTS.find(c => c.key === employer.contract) : undefined;
}
