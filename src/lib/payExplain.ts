import type { Employer, Job } from './store';
import { resolveEmployer } from './employerMatch';
import { jobPayBreakdown, netHoursWorked } from './payCalc';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import type { RowStatus } from './stubComparison';
import type { StubParsed } from './stubMatching';

/**
 * The estimate beside what actually came in, and why they differ.
 *
 * The gap is the useful part: it is how the app's settings get corrected, and
 * how you see what payroll really does. So the difference is taken apart into
 * what caused it, in dollars of take-home, rather than left as one number.
 */

export interface PayLine {
  label: 'Gross' | 'Net';
  estimated: number;
  /** Unset when the document doesn't state it. */
  actual?: number;
  delta?: number;
  status: RowStatus;
}

export interface PayReason {
  text: string;
  /** Short name, for the headline. */
  short: string;
  /** What it did to take-home. Positive means more than estimated. */
  effect?: number;
}

export interface PayExplanation {
  lines: PayLine[];
  /** none: nothing to compare. right: within a dollar. close: within 2%. off: past that. */
  verdict: 'none' | 'right' | 'close' | 'off';
  headline: string;
  reasons: PayReason[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (part: number, whole: number) => `${round2((part / whole) * 100)}%`;

/** A dollar is rounding. 2%, or $5 on a small check, is close. */
function statusOf(delta: number, estimated: number): RowStatus {
  const off = Math.abs(delta);
  if (off <= 1) return 'match';
  return off <= Math.max(5, estimated * 0.02) ? 'close' : 'off';
}

/** Hours a shift is paid for: broken hours rounded up, and never under the minimum call. */
function paidHours(job: Job, employers: Employer[]): number {
  const worked = netHoursWorked(job);
  const rounded = resolveEmployer(job.client, employers)?.roundUpToWholeHours ? Math.ceil(worked - 1e-9) : worked;
  return Math.max(rounded, job.minimumHours ?? 0);
}

export function explainPay({ stub, received, jobs, allJobs, employers, payer = EMPTY_PROFILE }: {
  /** The stub, when there is one. */
  stub?: StubParsed | null;
  /** What came in, when it's known: a check, or typed in. Beats the stub's net. */
  received?: number;
  /** The shifts it covers. */
  jobs: Job[];
  allJobs: Job[];
  employers: Employer[];
  payer?: PayerProfile;
}): PayExplanation {
  const est = jobs.reduce((sum, j) => {
    const b = jobPayBreakdown(j, allJobs, employers, payer);
    return { gross: sum.gross + b.gross, net: sum.net + b.net, dues: sum.dues + b.dues, tax: sum.tax + b.tax, vacation: sum.vacation + b.vacation };
  }, { gross: 0, net: 0, dues: 0, tax: 0, vacation: 0 });
  const estHours = round2(jobs.reduce((sum, j) => sum + paidHours(j, employers), 0));
  const rates = [...new Set(jobs.map(j => j.hourlyRate ?? 0).filter(r => r > 0))];
  const estRate = rates.length === 1 ? rates[0] : undefined;

  const actualNet = received ?? stub?.netPay;
  const stubGross = stub?.grossPay ?? undefined;

  // Some stubs count vacation inside gross; the estimate keeps it apart. Only
  // the same thing can be compared with itself.
  const grossHasVacation = stubGross != null && stub?.vacationAmount != null && stub.vacationAmount > 0
    && Math.abs(stubGross - (est.gross + stub.vacationAmount)) < Math.abs(stubGross - est.gross);
  const estGrossShown = round2(grossHasVacation ? est.gross + est.vacation : est.gross);

  const line = (label: PayLine['label'], estimated: number, actual?: number): PayLine => ({
    label,
    estimated: round2(estimated),
    actual: actual ?? undefined,
    delta: actual != null ? round2(actual - estimated) : undefined,
    status: actual != null ? statusOf(actual - estimated, estimated) : 'missing',
  });
  const lines = [line('Gross', estGrossShown, stubGross), line('Net', est.net, actualNet)];

  if (est.net <= 0) {
    return { lines, verdict: 'none', headline: 'Nothing to compare yet: these shifts need hours and a rate.', reasons: [] };
  }
  if (actualNet == null) {
    return { lines, verdict: 'none', headline: 'The net pay could not be read, so there is nothing to compare.', reasons: [] };
  }

  const netDelta = round2(actualNet - est.net);
  const status = statusOf(netDelta, est.net);
  const reasons: PayReason[] = [];
  const add = (short: string, text: string, effect?: number) => reasons.push({ short, text, effect: effect == null ? undefined : round2(effect) });

  if (stub && (stubGross != null || stub.totalHours != null || stub.duesAmount != null || stub.taxAmount != null)) {
    // What moved the gross: hours, then rate, then whatever is left.
    let grossExplained = 0;
    const hoursDelta = stub.totalHours != null ? round2(stub.totalHours - estHours) : 0;
    if (Math.abs(hoursDelta) >= 0.25) {
      const effect = hoursDelta * (stub.hourlyRate ?? estRate ?? 0);
      grossExplained += effect;
      add('hours', `The stub paid ${stub.totalHours}h and your shifts come to ${estHours}h, ${Math.abs(hoursDelta)}h ${hoursDelta > 0 ? 'more' : 'fewer'}.`, effect);
    }
    if (stub.hourlyRate != null && estRate != null && Math.abs(stub.hourlyRate - estRate) >= 0.005) {
      const effect = (stub.hourlyRate - estRate) * (stub.totalHours ?? estHours);
      grossExplained += effect;
      add('rate', `The stub's rate is ${money(stub.hourlyRate)} an hour, and your shift has ${money(estRate)}.`, effect);
    }
    if (stubGross != null) {
      const compared = grossHasVacation ? stubGross - (stub.vacationAmount ?? 0) : stubGross;
      const left = compared - est.gross - grossExplained;
      if (Math.abs(left) >= 1) {
        const worked = (stub.hoursBreakdown ?? []).reduce((sum, b) => ({ ...sum, [b.type]: (sum[b.type] ?? 0) + b.hours }), {} as Record<string, number>);
        const premium = [worked.OT ? `${worked.OT}h overtime` : null, worked.DT ? `${worked.DT}h double time` : null].filter(Boolean).join(' and ');
        add('overtime or premiums', `${money(left)} of the gross isn't hours or rate. ${premium ? `The stub paid ${premium}. ` : ''}Usually overtime, a minimum call, a meal penalty or a premium counted differently.`, left);
      }
    }

    // What came off it.
    const base = stubGross != null && stubGross > 0 ? (grossHasVacation ? stubGross - (stub.vacationAmount ?? 0) : stubGross) : est.gross;
    if (stub.duesAmount != null) {
      const delta = stub.duesAmount - est.dues;
      if (Math.abs(delta) >= 0.5) add('dues', `Dues took ${money(stub.duesAmount)} (${percent(stub.duesAmount, base)} of gross). The estimate had ${money(est.dues)}.`, -delta);
    } else if (est.dues >= 0.5) {
      add('dues', `The estimate took ${money(est.dues)} in dues, and the stub shows none.`, est.dues);
    }
    if (stub.taxAmount != null) {
      const delta = stub.taxAmount - est.tax;
      const afterDues = base - (stub.duesAmount ?? 0);
      if (Math.abs(delta) >= 0.5) add('tax', `Tax took ${money(stub.taxAmount)} (${percent(stub.taxAmount, afterDues)}). The estimate had ${money(est.tax)}.`, -delta);
    } else if (est.tax >= 0.5) {
      add('tax', `The estimate took ${money(est.tax)} in tax, and the stub shows none.`, est.tax);
    }
    if (stub.vacationAmount != null) {
      const delta = stub.vacationAmount - est.vacation;
      if (Math.abs(delta) >= 0.5) add('vacation', `Vacation came to ${money(stub.vacationAmount)}. The estimate had ${money(est.vacation)}.`, delta);
    } else if (est.vacation >= 0.5) {
      add('vacation', `The estimate added ${money(est.vacation)} vacation, and the stub shows none.`, -est.vacation);
    }
    if (stub.otherDeductions) add('other deductions', `${money(stub.otherDeductions)} in other deductions the app doesn't know about.`, -stub.otherDeductions);
    if (grossHasVacation) add('vacation', `The stub's gross includes ${money(stub.vacationAmount ?? 0)} vacation. The estimate keeps it separate, so it's added above to compare.`);

    const known = reasons.reduce((sum, r) => sum + (r.effect ?? 0), 0);
    const unexplained = round2(netDelta - known);
    if (Math.abs(unexplained) >= 1) add('something not on the stub', `${money(unexplained)} isn't explained by anything the stub shows.`, unexplained);
  } else if (status !== 'match') {
    add('no breakdown', stub ? "The stub's lines couldn't be read, so this can't say why." : 'A check only shows what arrived, not why. Add the stub to see it line by line.');
  }

  reasons.sort((a, b) => Math.abs(b.effect ?? 0) - Math.abs(a.effect ?? 0));
  const share = `${round2((Math.abs(netDelta) / est.net) * 100)}%`;
  const direction = netDelta > 0 ? 'over' : 'under';
  const biggest = reasons.find(r => (r.effect ?? 0) !== 0);
  const headline = status === 'match'
    ? (Math.abs(netDelta) < 0.01 ? 'Right on the estimate.' : `Right on the estimate, ${money(netDelta)} ${direction}.`)
    : status === 'close'
      ? `Close: ${money(netDelta)} ${direction} the estimate (${share}).`
      : `${money(netDelta)} ${direction} the estimate (${share}).${biggest ? ` Mostly ${biggest.short}.` : ''}`;

  return { lines, verdict: status === 'match' ? 'right' : status === 'close' ? 'close' : 'off', headline, reasons };
}
