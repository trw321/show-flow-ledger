import type { Job, Employer } from './store';
import { jobPayBreakdown, netHoursWorked } from './payCalc';
import type { StubParsed } from './stubMatching';

export type RowStatus = 'match' | 'close' | 'off' | 'missing';

export interface ComparisonRow {
  key: 'hours' | 'rate' | 'gross' | 'dues' | 'tax' | 'vacation' | 'net';
  label: string;
  /** What the stub printed, when it printed it. */
  stub?: number;
  /** What the app's pay engine worked out for the same shifts. */
  calculated: number;
  /** stub − calculated. Positive means the stub paid more than expected. */
  delta?: number;
  status: RowStatus;
  money: boolean;
}

/** What counts as agreement, per row. Money rows allow rounding; hours allow a
 *  quarter hour, since payroll systems round to the nearest quarter. */
const TOLERANCE: Record<ComparisonRow['key'], { match: number; close: number }> = {
  hours: { match: 0.25, close: 1 },
  rate: { match: 0.01, close: 0.5 },
  gross: { match: 0.5, close: 5 },
  dues: { match: 0.5, close: 5 },
  tax: { match: 0.5, close: 10 },
  vacation: { match: 0.5, close: 5 },
  net: { match: 0.5, close: 5 },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function statusFor(key: ComparisonRow['key'], stub: number | undefined, calculated: number): RowStatus {
  if (stub == null) return 'missing';
  const diff = Math.abs(stub - calculated);
  const t = TOLERANCE[key];
  if (diff <= t.match) return 'match';
  if (diff <= t.close) return 'close';
  return 'off';
}

/**
 * Line-by-line reconciliation of a pay stub against the shifts it covers.
 * Totals only tell you *that* something is wrong; this shows which line.
 */
export function compareStubToShifts(
  stub: StubParsed,
  jobs: Job[],
  allJobs: Job[],
  employers: Employer[],
): ComparisonRow[] {
  const totals = jobs.reduce(
    (acc, job) => {
      const { gross, net, dues, tax, vacation } = jobPayBreakdown(job, allJobs, employers);
      acc.gross += gross;
      acc.net += net;
      acc.dues += dues;
      acc.tax += tax;
      acc.vacation += vacation;
      acc.hours += netHoursWorked(job);
      return acc;
    },
    { gross: 0, net: 0, dues: 0, tax: 0, vacation: 0, hours: 0 },
  );

  // Rates vary between shifts; comparing against a single figure only makes
  // sense when every matched shift is at the same rate.
  const rates = [...new Set(jobs.map(j => j.hourlyRate ?? 0).filter(r => r > 0))];
  const calculatedRate = rates.length === 1 ? rates[0] : 0;

  const rows: Array<Omit<ComparisonRow, 'status' | 'delta'>> = [
    { key: 'hours', label: 'Hours', stub: stub.totalHours, calculated: round2(totals.hours), money: false },
    { key: 'rate', label: 'Rate', stub: stub.hourlyRate, calculated: round2(calculatedRate), money: true },
    { key: 'gross', label: 'Gross', stub: stub.grossPay, calculated: round2(totals.gross), money: true },
    { key: 'dues', label: 'Dues', stub: stub.duesAmount, calculated: round2(totals.dues), money: true },
    { key: 'tax', label: 'Tax', stub: stub.taxAmount, calculated: round2(totals.tax), money: true },
    { key: 'vacation', label: 'Vacation', stub: stub.vacationAmount, calculated: round2(totals.vacation), money: true },
    { key: 'net', label: 'Net', stub: stub.netPay, calculated: round2(totals.net), money: true },
  ];

  return rows.map(row => ({
    ...row,
    status: statusFor(row.key, row.stub, row.calculated),
    delta: row.stub != null ? round2(row.stub - row.calculated) : undefined,
  }));
}

/** Rows worth the user's attention — anything the stub stated that disagrees. */
export function disagreements(rows: ComparisonRow[]): ComparisonRow[] {
  return rows.filter(r => r.status === 'close' || r.status === 'off');
}
