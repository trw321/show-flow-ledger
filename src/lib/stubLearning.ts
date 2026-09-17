import type { Job, Employer } from './store';
import { resolveEmployer } from './employerMatch';

export type LearnableField = 'unionDuesPercent' | 'estimatedTaxPercent' | 'vacationPercent';

export interface Suggestion {
  employerId: string;
  employerName: string;
  field: LearnableField;
  label: string;
  /** What the employer profile says today (undefined when never set). */
  current?: number;
  /** What the stubs say it actually is. */
  suggested: number;
  /** How many stubs agree. One flags it; two or more is a strong signal. */
  sampleCount: number;
  strength: 'flag' | 'strong';
  evidence: string[];
}

const FIELD_LABELS: Record<LearnableField, string> = {
  unionDuesPercent: 'Union dues',
  estimatedTaxPercent: 'Estimated tax',
  vacationPercent: 'Vacation pay',
};

/** Below this the profile and the stub are effectively saying the same thing,
 *  and re-suggesting would just be noise from rounding. */
const PERCENT_TOLERANCE = 0.25;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Percentages implied by one stub. Mirrors the deduction order the pay engine
 * uses — dues come off the gross, then tax is charged on what's left — so a
 * derived rate is directly comparable to the configured one.
 */
function impliedPercents(stub: NonNullable<Job['stubParsed']>): Partial<Record<LearnableField, number>> {
  const out: Partial<Record<LearnableField, number>> = {};
  const gross = stub.grossPay;
  if (!gross || gross <= 0) return out;

  if (stub.duesAmount != null) out.unionDuesPercent = round2((stub.duesAmount / gross) * 100);

  const afterDues = gross - (stub.duesAmount ?? 0);
  if (stub.taxAmount != null && afterDues > 0) {
    out.estimatedTaxPercent = round2((stub.taxAmount / afterDues) * 100);
  }

  // Vacation is added on top of net, so it's a percentage of what's left after
  // both deductions — the same base jobPayBreakdown applies it to.
  const net = afterDues - (stub.taxAmount ?? 0);
  if (stub.vacationAmount != null && net > 0) {
    out.vacationPercent = round2((stub.vacationAmount / net) * 100);
  }
  return out;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2);
};

/**
 * What the pay stubs say this employer's rates actually are, where that
 * disagrees with the saved profile. Never applies anything — a suggestion is
 * something the user confirms.
 */
export function learnFromStubs(jobs: Job[], employers: Employer[]): Suggestion[] {
  const byEmployer = new Map<string, { employer: Employer; samples: Map<LearnableField, number[]> }>();

  for (const job of jobs) {
    if (!job.stubParsed) continue;
    const employer = resolveEmployer(job.stubParsed.employer ?? job.client, employers);
    if (!employer) continue;

    const implied = impliedPercents(job.stubParsed);
    if (Object.keys(implied).length === 0) continue;

    let entry = byEmployer.get(employer.id);
    if (!entry) { entry = { employer, samples: new Map() }; byEmployer.set(employer.id, entry); }
    for (const [field, value] of Object.entries(implied) as [LearnableField, number][]) {
      if (!entry.samples.has(field)) entry.samples.set(field, []);
      entry.samples.get(field)!.push(value);
    }
  }

  const suggestions: Suggestion[] = [];
  for (const { employer, samples } of byEmployer.values()) {
    for (const [field, values] of samples) {
      if (values.length === 0) continue;
      // Median rather than mean: one oddly-prorated stub shouldn't drag the rate.
      const suggested = round2(median(values));
      const current = employer[field];

      if (current != null && Math.abs(current - suggested) <= PERCENT_TOLERANCE) continue;
      if (current == null && suggested === 0) continue;

      const skips = employer.dismissedSuggestions?.find(d => d.field === field)?.skipsRemaining ?? 0;
      if (skips > 0) continue;

      suggestions.push({
        employerId: employer.id,
        employerName: employer.name,
        field,
        label: FIELD_LABELS[field],
        current: current ?? undefined,
        suggested,
        sampleCount: values.length,
        strength: values.length >= 2 ? 'strong' : 'flag',
        evidence: values.map(v => `${v}%`),
      });
    }
  }

  return suggestions.sort((a, b) =>
    (b.strength === 'strong' ? 1 : 0) - (a.strength === 'strong' ? 1 : 0) || b.sampleCount - a.sampleCount);
}

/**
 * Turning a suggestion down skips the next occurrence and then lets it ask
 * again — "don't ask next time, but ask the time after that".
 */
export function dismissSuggestion(employer: Employer, field: LearnableField): Employer['dismissedSuggestions'] {
  const rest = (employer.dismissedSuggestions ?? []).filter(d => d.field !== field);
  return [...rest, { field, skipsRemaining: 1, dismissedAt: new Date().toISOString() }];
}

/** Call when a stub is reconciled: burns down one skip per employer field, so
 *  a dismissal lapses after the next stub rather than lasting forever. */
export function consumeSkip(employer: Employer, field: LearnableField): Employer['dismissedSuggestions'] {
  return (employer.dismissedSuggestions ?? []).map(d =>
    d.field === field && d.skipsRemaining > 0 ? { ...d, skipsRemaining: d.skipsRemaining - 1 } : d);
}
