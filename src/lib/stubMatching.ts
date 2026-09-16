import type { Job } from './store';
import { nameSimilarity, AUTO_MATCH_THRESHOLD, SUGGEST_MATCH_THRESHOLD } from './employerMatch';
import { netHoursWorked } from './payCalc';

export type StubParsed = NonNullable<Job['stubParsed']>;

export type MatchConfidence = 'high' | 'medium' | 'low';

export interface StubMatch {
  /** Shifts this stub appears to pay for — one check routinely covers a whole period. */
  jobs: Job[];
  confidence: MatchConfidence;
  /** Plain-language findings, shown next to the match so the call is reviewable. */
  reasons: string[];
  /** Hours logged across the matched shifts (net of off-the-clock meals). */
  shiftHours: number;
  /** Hours the stub says it paid for, when it states a total. */
  stubHours?: number;
  /** shiftHours − stubHours. Positive means more logged than paid. */
  hoursDelta?: number;
  employerScore: number;
}

// A stub agreeing to the quarter-hour is the payroll system and the app
// arriving at the same answer; an hour out is a meal or a rounding rule.
const HOURS_EXACT = 0.25;
const HOURS_CLOSE = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;

function employerScoreFor(stubEmployer: string, job: Job): number {
  return Math.max(
    nameSimilarity(stubEmployer, job.client),
    job.payrollCompany ? nameSimilarity(stubEmployer, job.payrollCompany) : 0,
  );
}

/**
 * Which shifts does this pay stub cover? Matches on the three signals a stub
 * actually carries — employer, the dates in the pay period, and hours — and
 * reports how strong the agreement is rather than silently picking one.
 *
 * Returns null when nothing plausibly matches; callers should treat that as
 * "ask the user" rather than guessing.
 */
export function matchStubToShifts(stub: StubParsed, jobs: Job[]): StubMatch | null {
  const stubEmployer = stub.employer?.trim() ?? '';
  const { payPeriodStart: start, payPeriodEnd: end } = stub;
  const breakdownDates = new Set((stub.hoursBreakdown ?? []).map(b => b.date));

  const inWindow = (date: string): boolean => {
    if (breakdownDates.has(date)) return true;
    if (start && end) return date >= start && date <= end;
    if (start) return date >= start;
    if (end) return date <= end;
    // No period and no per-date rows: dates tell us nothing, so don't guess.
    return false;
  };

  const candidates = jobs.filter(job =>
    netHoursWorked(job) > 0 &&
    inWindow(job.date) &&
    (!stubEmployer || employerScoreFor(stubEmployer, job) >= SUGGEST_MATCH_THRESHOLD),
  );
  if (candidates.length === 0) return null;

  const employerScore = stubEmployer
    ? Math.max(...candidates.map(job => employerScoreFor(stubEmployer, job)))
    : 0;

  const shiftHours = round2(candidates.reduce((sum, job) => sum + netHoursWorked(job), 0));
  const stubHours = stub.totalHours ?? undefined;
  const hoursDelta = stubHours != null ? round2(shiftHours - stubHours) : undefined;

  const reasons: string[] = [];

  const employerStrong = !stubEmployer || employerScore >= AUTO_MATCH_THRESHOLD;
  if (stubEmployer) {
    reasons.push(employerStrong
      ? `Employer matches "${stubEmployer}"`
      : `Employer "${stubEmployer}" only loosely matches these shifts`);
  } else {
    reasons.push("Stub doesn't name an employer");
  }

  // Per-date rows are the strongest signal available, but they're only present
  // when the stub actually printed them.
  let datesComplete = true;
  if (breakdownDates.size > 0) {
    const shiftDates = new Set(candidates.map(job => job.date));
    const missing = [...breakdownDates].filter(d => !shiftDates.has(d));
    datesComplete = missing.length === 0;
    reasons.push(datesComplete
      ? `All ${breakdownDates.size} date${breakdownDates.size !== 1 ? 's' : ''} on the stub have shifts`
      : `${missing.length} of ${breakdownDates.size} stub dates have no logged shift`);
  } else if (start && end) {
    reasons.push(`${candidates.length} shift${candidates.length !== 1 ? 's' : ''} fall in ${start} – ${end}`);
  }

  const hoursExact = hoursDelta != null && Math.abs(hoursDelta) <= HOURS_EXACT;
  const hoursClose = hoursDelta != null && Math.abs(hoursDelta) <= HOURS_CLOSE;
  if (hoursDelta == null) {
    reasons.push(`Stub doesn't state total hours — ${shiftHours}h logged`);
  } else if (hoursExact) {
    reasons.push(`Hours agree (${shiftHours}h)`);
  } else {
    reasons.push(`Stub paid ${stubHours}h, ${shiftHours}h logged (${hoursDelta > 0 ? '+' : ''}${hoursDelta}h)`);
  }

  let confidence: MatchConfidence = 'low';
  if (employerStrong && hoursExact && datesComplete) confidence = 'high';
  else if (employerStrong && datesComplete && (hoursClose || hoursDelta == null)) confidence = 'medium';
  else if (employerStrong && hoursClose) confidence = 'medium';

  return {
    jobs: [...candidates].sort((a, b) => a.date.localeCompare(b.date)),
    confidence,
    reasons,
    shiftHours,
    stubHours,
    hoursDelta,
    employerScore,
  };
}
