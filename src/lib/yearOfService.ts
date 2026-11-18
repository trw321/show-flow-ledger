import type { Employer, Job } from './store';
import { normaliseLocal, type PayerProfile } from './payerProfile';
import { effectiveHoursWorked, jobPayBreakdown } from './payCalc';

/**
 * A local's Year of Service: what a year's work has to come to for
 * advancement. Local 8's 2026 rules are as the local sent them to members:
 * the Local 8 Hiring Hall Policy for 2026, applied to work done in 2026 and
 * counted in 2027.
 */

export interface TrainingItem {
  key: string;
  label: string;
}

export interface YearOfServiceRule {
  local: string;
  /** The year of work it counts. */
  year: number;
  /** Earnings the year has to reach. */
  earnings: number;
  /** What it's for. */
  forWhat: string[];
  note: string;
  /** Each group needs its items done. */
  training: { title: string; items: TrainingItem[]; link?: { label: string; url: string } }[];
  links: { label: string; url: string }[];
}

export const LOCAL8_2026: YearOfServiceRule = {
  local: '8',
  year: 2026,
  earnings: 30_000,
  forWhat: ['Advancing into membership', 'D List to B List', 'B List to A List'],
  note: 'Already on the A List: the training is suggested, not required, and your status is unchanged.',
  training: [
    {
      title: 'OSHA 10 or 30 (Construction or General Industry)',
      items: [{ key: 'osha', label: 'OSHA 10 or 30' }],
      link: { label: 'Pick an OSHA 10 class (space is limited)', url: 'http://www.iatse8.com/index.cfm?zone=/unionactive/form_page.cfm&formID=105265' },
    },
    {
      title: 'IATSE Training Trust Fund: Safety First online courses',
      items: [
        { key: 'ttf-intro', label: 'Introduction to Basic Entertainment Safety' },
        { key: 'ttf-electrical', label: 'Electrical Safety' },
        { key: 'ttf-fall', label: 'Fall Prevention & Protection' },
        { key: 'ttf-mewp', label: 'Mobile Elevating Work Platforms' },
        { key: 'ttf-scaffold', label: 'Scaffold Safety' },
        { key: 'ttf-noise', label: 'Noise Exposure' },
        { key: 'ttf-rigging', label: 'Rigging Safety' },
        { key: 'ttf-customer', label: 'Customer Service for the Live Events Industry' },
        { key: 'ttf-etiquette', label: 'Professional Etiquette' },
        { key: 'ttf-stepup', label: 'STEP UP: Respect in the Workplace' },
      ],
      link: { label: 'Open the TTF Safety First courses', url: 'https://www.iatsetrainingtrust.org/safetyfirst' },
    },
  ],
  links: [
    { label: 'No TTF account yet? Apply for one', url: 'https://app.smartsheet.com/b/form/da8a8024dab940c3b3aa3324063579fe' },
    { label: 'Not sure you have one? Email onlinecourses@iatsetrainingtrust.org', url: 'mailto:onlinecourses@iatsetrainingtrust.org' },
  ],
};

/** A shift Local 8 dispatched: its local says 8, or its employer is written as the local ("ia8"). */
export function isLocalShift(job: Pick<Job, 'local' | 'client'>, local: string): boolean {
  if (job.local?.trim()) return normaliseLocal(job.local) === local;
  return new RegExp(`^(?:ia|iatse|local)\\s*${local}$`, 'i').test((job.client ?? '').trim());
}

/** Estimated gross from the local's shifts worked in the year. */
export function yearEarnings(rule: Pick<YearOfServiceRule, 'local' | 'year'>, jobs: Job[], employers: Employer[], payer: PayerProfile): { gross: number; shifts: number } {
  const counted = jobs.filter(j => j.date.startsWith(String(rule.year)) && j.status !== 'cancelled' && !j.pto
    && isLocalShift(j, rule.local) && effectiveHoursWorked(j) > 0);
  const gross = counted.reduce((sum, j) => sum + jobPayBreakdown(j, jobs, employers, payer).gross, 0);
  return { gross, shifts: counted.length };
}

/** The key a finished course is saved under for this rule's year. */
export const trainingKey = (rule: Pick<YearOfServiceRule, 'year'>, item: TrainingItem) => `${rule.year}:${item.key}`;
