import type { Employer, Job } from './store';
import type { PayerProfile } from './payerProfile';
import { effectiveHoursWorked, jobPayBreakdown } from './payCalc';
import { isLocal16Shift } from './local16';

/**
 * IATSE Local 16 Health and Welfare Trust Fund, as the local sets it out
 * (rules as of 01/10/2023). Employers pay 15.5% of the gross wages of
 * everyone working through Local 16 into the plan. Earnings in a three-month
 * work period decide coverage in a later quarter.
 */
export const LOCAL16_HW = {
  contributionRate: 0.155,
  /** To qualify: this much within a 12-month period. */
  qualifyEarnings: 50_000,
  qualifyContributions: 7_750,
  /** To stay on: this much a work period. */
  quarterEarnings: 12_500,
  quarterContributions: 1_940,
  /** Self-pay can make up a shortfall for at most this many quarters in a row. */
  selfPayMaxQuarters: 3,
  plan: [
    'A multi-employer defined-benefit plan. Contributions go into the plan and pay care providers through the third-party administrator.',
    'Anthem Blue Cross is the preferred provider (PPO).',
    'BeneSys is the third-party administrator.',
    'Dental: the plan pays the coverage and a monthly fee to get Cigna rates.',
    'Prescriptions: Optum Rx.',
    'Deductible: $300 a person a year, $900 a family at most, PPO and non-PPO covered charges.',
    'Out of pocket at most: $6,000 a participant a year, $12,000 a family.',
  ],
  selfPay: [
    'You can self-pay the difference: $1,940 minus the employer contributions is what you owe for the quarter.',
    'A free quarter is no longer available.',
    'Self-pay can make up a shortfall for no more than three (3) consecutive quarters, if no employer contributions are made on your behalf during those three quarters.',
  ],
  contacts: [
    { label: 'BeneSys (pension and H&W)', phones: ['(855) 704-5273', '(925) 398-7043'] },
    { label: 'Trust Fund Office', phones: ['(925) 398-7060', '(855) 704-7767'] },
  ],
  mail: ['IATSE Local 16 Trust Funds', 'PO Box 1607', 'San Ramon, CA 94583'],
  portal: 'https://www.ourbenefitoffice.com/IATSE16/Benefits/',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface WorkPeriod {
  /** First and last day of the three work months. */
  start: string;
  end: string;
  /** The coverage those months' earnings decide. */
  quarter: 1 | 2 | 3 | 4;
  coverageYear: number;
  coverageStart: string;
  coverageEnd: string;
  /** "Aug–Oct 2026", "Jan–Mar 2027". */
  workLabel: string;
  coverageLabel: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const span = (y1: number, m1: number, y2: number, m2: number) =>
  y1 === y2 ? `${MONTHS[m1 - 1]}–${MONTHS[m2 - 1]} ${y1}` : `${MONTHS[m1 - 1]} ${y1}–${MONTHS[m2 - 1]} ${y2}`;

/**
 * The work period a date falls in, and the quarter it earns:
 * Aug–Oct earns Q1 (the following Jan–Mar), Nov–Jan earns Q2 (the following
 * Apr–Jun), Feb–Apr earns Q3 (Jul–Sep), May–Jul earns Q4 (Oct–Dec).
 */
export function workPeriodFor(date: string): WorkPeriod {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  // [first month, its year, quarter earned, coverage year]
  const [m1, y1, quarter, coverageYear]: [number, number, 1 | 2 | 3 | 4, number] =
    m >= 8 && m <= 10 ? [8, y, 1, y + 1]
      : m >= 11 ? [11, y, 2, y + 1]
      : m === 1 ? [11, y - 1, 2, y]
      : m <= 4 ? [2, y, 3, y]
      : [5, y, 4, y];
  const m2 = ((m1 + 1) % 12) + 1;
  const y2 = m1 === 11 ? y1 + 1 : y1;
  const c1 = (quarter - 1) * 3 + 1;
  const c2 = c1 + 2;
  return {
    start: `${y1}-${pad(m1)}-01`,
    end: `${y2}-${pad(m2)}-${pad(lastDay(y2, m2))}`,
    quarter,
    coverageYear,
    coverageStart: `${coverageYear}-${pad(c1)}-01`,
    coverageEnd: `${coverageYear}-${pad(c2)}-${pad(lastDay(coverageYear, c2))}`,
    workLabel: span(y1, m1, y2, m2),
    coverageLabel: span(coverageYear, c1, coverageYear, c2),
  };
}

/** The work period before this one. */
export function previousPeriod(p: WorkPeriod): WorkPeriod {
  const d = new Date(Number(p.start.slice(0, 4)), Number(p.start.slice(5, 7)) - 2, 15);
  return workPeriodFor(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-15`);
}

/** Estimated gross from Local 16 shifts worked between two dates, inclusive. */
export function local16Earnings(from: string, to: string, jobs: Job[], employers: Employer[], payer: PayerProfile): { gross: number; shifts: number } {
  const counted = jobs.filter(j => j.date >= from && j.date <= to && j.status !== 'cancelled' && !j.pto
    && isLocal16Shift(j) && effectiveHoursWorked(j) > 0);
  return { gross: counted.reduce((sum, j) => sum + jobPayBreakdown(j, jobs, employers, payer).gross, 0), shifts: counted.length };
}

/** Employer contributions on that much gross, and the self-pay that would make up the quarter. */
export function quarterStanding(gross: number): { contributions: number; selfPay: number; covered: boolean } {
  const contributions = gross * LOCAL16_HW.contributionRate;
  const covered = gross >= LOCAL16_HW.quarterEarnings;
  return { contributions, selfPay: covered ? 0 : Math.max(0, LOCAL16_HW.quarterContributions - contributions), covered };
}
