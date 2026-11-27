import type { Employer, Job } from './store';
import type { PayerProfile } from './payerProfile';
import type { StubParsed } from './stubMatching';
import { jobHolidayPay } from './payCalc';
import { resolveEmployer } from './employerMatch';
import { holidayRuleName, holidayTermsFor } from './holidayTerms';
import { HOLIDAYS, type HolidayKey } from './holidays';
import { clockMinutes, endAfterStart } from './clock';
import { withContractRule } from './premiums';

/**
 * What a pay stub's holiday pay says about the shifts it covers, set beside
 * what the app counted, and what to learn from it:
 *
 *  - learn: the stub paid holiday pay, and one of its shifts was on a holiday
 *    its contract doesn't count yet ("Christmas at the Civic Auditorium").
 *    One tap saves it on the contract (see ContractRule.holidays).
 *  - agrees / differs: both paid holiday pay; how close they came.
 *  - missing: the app counted holiday pay the stub doesn't show.
 *  - unplaced: the stub paid holiday pay, but none of its shifts falls on a
 *    holiday the app knows the date of.
 *
 * Null when there's nothing to say, or the stub was read before stubs were
 * asked about holidays.
 */
export type HolidayFinding =
  | { kind: 'learn'; holiday: HolidayKey; name: string; date: string; ruleName: string; stubAmount: number; appAmount: number; extraKnown: boolean }
  | { kind: 'agrees' | 'differs'; stubAmount: number; appAmount: number }
  | { kind: 'missing'; appAmount: number }
  | { kind: 'unplaced'; stubAmount: number };

/** Within this, the stub and the app agree on holiday pay. */
const AGREE_DOLLARS = 1;

const nextDay = (date: string) => {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + 1));
  return d.toISOString().slice(0, 10);
};

/** The days a shift's hours fall on: its date, and the next when it runs past midnight. */
function daysOf(job: Job): string[] {
  const start = clockMinutes(job.startTime);
  const end = endAfterStart(start, job.endTime);
  return !Number.isNaN(start) && !Number.isNaN(end) && end > 24 * 60 ? [job.date, nextDay(job.date)] : [job.date];
}

/** The holiday a date is, of every holiday the app knows. */
function anyHolidayOn(date: string): HolidayKey | undefined {
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year)) return undefined;
  return (Object.keys(HOLIDAYS) as HolidayKey[]).find(k => HOLIDAYS[k].on(year) === date);
}

export function readStubHoliday(stub: StubParsed, shifts: Job[], allJobs: Job[], employers: Employer[], payer: PayerProfile): HolidayFinding | null {
  // Read before stubs were asked about holiday pay: it says nothing either way.
  if (stub.holidayAmount === undefined) return null;
  const stubAmount = typeof stub.holidayAmount === 'number' && Number.isFinite(stub.holidayAmount) ? Math.max(0, stub.holidayAmount) : 0;
  const appAmount = Math.round(shifts.reduce((sum, j) => sum + jobHolidayPay(j, allJobs, employers, payer), 0) * 100) / 100;

  if (stubAmount > 0) {
    // A holiday among its shifts' days that their contract doesn't count yet.
    for (const job of [...shifts].sort((a, b) => a.date.localeCompare(b.date))) {
      if (job.status === 'cancelled' || job.pto) continue;
      const employer = resolveEmployer(job.client, employers);
      const terms = holidayTermsFor(job, employer, payer);
      for (const date of daysOf(job)) {
        const key = anyHolidayOn(date);
        if (key && !terms?.keys.includes(key)) {
          return { kind: 'learn', holiday: key, name: HOLIDAYS[key].name, date, ruleName: holidayRuleName(job, employer), stubAmount, appAmount, extraKnown: !!terms };
        }
      }
    }
    if (appAmount > 0) return { kind: Math.abs(stubAmount - appAmount) <= AGREE_DOLLARS ? 'agrees' : 'differs', stubAmount, appAmount };
    return { kind: 'unplaced', stubAmount };
  }
  return appAmount > AGREE_DOLLARS ? { kind: 'missing', appAmount } : null;
}

/**
 * Your settings with a learned holiday saved on its contract: added to the
 * holidays it pays, and, for a contract with no holiday rate of its own, the
 * Civic Auditorium's half time on top.
 */
export function learnHoliday(payer: PayerProfile, finding: Extract<HolidayFinding, { kind: 'learn' }>): PayerProfile {
  const key = finding.ruleName.trim().toUpperCase().replace(/\s+/g, ' ');
  const rule = payer.contractRules?.find(r => r.name.trim().toUpperCase().replace(/\s+/g, ' ') === key);
  const saved = Array.isArray(rule?.holidays) ? rule.holidays : [];
  return withContractRule(payer, finding.ruleName, {
    holidays: [...new Set([...saved, finding.holiday])],
    ...(finding.extraKnown ? {} : { holidayExtra: 0.5 }),
  });
}
