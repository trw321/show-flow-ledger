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
  /** A summary of the Local 16 H&W and Pension presentation (updated 02/09/2025). */
  summary: [
    {
      title: 'Qualifying, staying on, self-pay',
      points: [
        'Qualify: $50,000 earned within 12 months ($7,750 in employer contributions).',
        'Stay on: $12,500 earned in each work period ($1,940 in contributions).',
        'Short? Self-pay the difference: $1,940 minus what employers paid. No free quarter any more.',
        'Self-pay must be paid on time, and can cover at most 3 quarters in a row with no employer contributions.',
        'Check it on the benefits site: My Benefits, then My Eligibility shows each month and what was credited; the contributions list shows each employer by work date.',
      ],
    },
    {
      title: 'What the plan pays',
      points: [
        'Anthem Blue Cross PPO, run by BeneSys. Prescriptions: Optum Rx. Dental at Cigna rates.',
        'Deductible $300 a person a year, $900 a family. Out of pocket at most $6,000 a person, $12,000 a family.',
        'Preventive care: 100% with a PPO provider.',
        'Medical and surgical: 80% in network, 50% out. Hospital stay: 90% PPO, 60% not. Outpatient: 80% / 50%. True emergency: 80%.',
        'Virtual visits, mental health, acupuncture, chiropractic: 80% PPO, 50% not.',
        'Vision exam: 80% up to $400 a year. Hearing aids after 3 years on the plan.',
        'LiveHealth video doctor, 24/7: you pay $11.80.',
        'Urgent care finder: anthem.com/ca, Find Care, member ID prefix BAY.',
        'Also covered: addiction treatment, home care, hospice. Active participants also get life insurance, AD&D and supplemental disability. Most care needs a doctor referral.',
      ],
    },
    {
      title: 'Prescriptions (Optum Rx)',
      points: [
        'No co-pay for preventive drugs in network (birth control, quitting smoking, statins).',
        'Maintenance drugs: have the doctor send them to Optum Rx for a 3-month supply, and ask for the generic.',
      ],
    },
    {
      title: 'Dental (after 2 years of continuous coverage)',
      points: [
        'Up to $2,500 a person a plan year. $75 deductible a year, except diagnostic and preventive.',
        'Diagnostic and preventive 90%, basic 70%, major 50%, TMJ 70%, orthodontia 50%.',
        'Cigna Dental PPO dentists: (800) 797-3381, cignadentalsaTaftHartley.com ("Cigna Dental PPO Shared Administration Plus").',
      ],
    },
    {
      title: 'Supplemental disability (active participants)',
      points: [
        '$27.35 a day (taxed) for each day on state disability, another disability payer, or workers’ comp.',
        'Apply to BeneSys within 90 days of the first payment. At most 20 weeks (140 days) in any 4 years.',
        'Workers’ comp: on the plan at least 1 year. State disability: at least 3 years in a row. Either way you must be out of work, and send BeneSys proof of each payment.',
      ],
    },
    {
      title: 'Pension',
      points: [
        'Paid for entirely by employer contributions under the contracts.',
        'Normal retirement at 65 with 5 years of credited service. Early at 55 with 10 years and 100% vested. Or postponed past 65.',
        'Vesting: under 3 years 0%, 3 years 20%, 4 years 40%, 5 years 60%, 6 years 80%, 7 or more 100%.',
        'A year of service is 1,000 covered hours (hours an employer contributed for) in a plan year, at most one a year.',
        'Accrual: 1.5% for 2022 through 2026. Early retirement pays a percentage by age, from about 39% at 55 to 99% just before 65.',
        'Keep your beneficiary form, address, marital status and dependents up to date.',
      ],
    },
    {
      title: 'Retiree HRA (from Jan 1, 2025)',
      points: [
        'Medicare-eligible retirees with 35 years of continuous service, and Medicare disability retirees: $325 a month, plus $325 for an eligible Medicare spouse.',
        'Stops adding at $12,000 ($24,000 joint). Claims within 180 days. Forfeited after 24 months with no activity.',
      ],
    },
  ],
  contacts: [
    { label: 'BeneSys (pension and H&W)', phones: ['(855) 704-5273', '(925) 398-7043'] },
    { label: 'Trust Fund Office (account setup)', phones: ['(925) 398-7060', '(855) 704-7767'] },
  ],
  mail: ['IATSE Local 16 Trust Funds', 'PO Box 1607', 'San Ramon, CA 94583'],
  claims: 'Medical, dental and vision claim forms: PO Box 240127, Apple Valley, MN 55124 · fax (925) 297-6655. Attach the itemized bill.',
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
