import type { Employer } from './store';

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[.,/]/g, ' ')
    .replace(/\b(inc|llc|co|corp|productions?|prod)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

/** 0..1 similarity score between two employer/client names — tolerant of case, punctuation, common suffixes ("Productions", "LLC"), and typos. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return 0.93;
  const dist = levenshtein(x, y);
  const maxLen = Math.max(x.length, y.length);
  return Math.max(0, 1 - dist / maxLen);
}

export interface EmployerMatch {
  employer: Employer;
  score: number;
}

/** Best-scoring saved employer for a typed client/employer name, or null if there are none to compare against. */
export function bestEmployerMatch(name: string, employers: Employer[]): EmployerMatch | null {
  if (!name.trim() || employers.length === 0) return null;
  let best: EmployerMatch | null = null;
  for (const employer of employers) {
    const score = nameSimilarity(name, employer.name);
    if (!best || score > best.score) best = { employer, score };
  }
  return best;
}

/** Confidence above which a match is trusted automatically in calculations (no exact string match required). */
export const AUTO_MATCH_THRESHOLD = 0.82;

/** Confidence above which a near-miss is worth surfacing as a "Did you mean…" suggestion during data entry. */
export const SUGGEST_MATCH_THRESHOLD = 0.55;

/** Resolves a job's employer profile by name, tolerating typos/case/punctuation — used everywhere pay is calculated so a near-match still applies the employer's rules instead of silently falling back to defaults. */
export function resolveEmployer(clientName: string, employers: Employer[]): Employer | undefined {
  const match = bestEmployerMatch(clientName, employers);
  return match && match.score >= AUTO_MATCH_THRESHOLD ? match.employer : undefined;
}
