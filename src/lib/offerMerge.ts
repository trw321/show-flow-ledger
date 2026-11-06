import type { ParsedJob } from './dispatchParsing';
import { AUTO_MATCH_THRESHOLD, nameSimilarity } from './employerMatch';
import { parseTimeToMins } from './hoursMatching';
import { differentRoles, jobKey } from './jobDedup';
import type { Job } from './store';

/**
 * The same offer, arriving twice. A photo gets the basics onto the calendar, and
 * the whole offer pasted later on a laptop fills them in, instead of being
 * skipped as a duplicate or doubling the day.
 *
 * It only ever adds to what the offer is. What happened on the day stays as it
 * was: hours, call and wrap times once set, meals, status and pay.
 */

export interface OfferMerge {
  target: Job;
  updates: Partial<Job>;
  /** What it adds or changes, a word or two each. */
  changes: string[];
}

const has = (v: unknown) => String(v ?? '').trim() !== '';
const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** One call, as far as can be told: two times can only disagree if both are there. */
const sameCall = (a?: string, b?: string) => !has(a) || !has(b) || parseTimeToMins(a!) === parseTimeToMins(b!);

/**
 * The shift an offer is another copy of. It takes a job number to say so: a
 * shift typed in by hand with none is a new shift. That number on the same day
 * is the same job, or the same employer on a shift logged with no number. Two
 * calls that day need the offer's time to say which one.
 */
export function findOfferMatch(offer: ParsedJob, jobs: Job[], taken: Set<string> = new Set()): Job | undefined {
  const key = jobKey(offer.jobNumber, offer.date);
  if (!key || !offer.date) return undefined;
  const sameDay = jobs.filter(j => j.date === offer.date && !taken.has(j.id)
    && !differentRoles(offer, j) && sameCall(offer.startTime, j.startTime));
  const numbered = sameDay.filter(j => jobKey(j.jobNumber, j.date) === key);
  const pool = numbered.length > 0
    ? numbered
    : sameDay.filter(j => !has(j.jobNumber) && nameSimilarity(j.client ?? '', offer.client ?? '') >= AUTO_MATCH_THRESHOLD);
  if (pool.length === 1) return pool[0];
  return has(offer.startTime) ? pool.find(j => has(j.startTime)) : undefined;
}

const wordsOf = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9$'/-]+/g) ?? []);
const coveredBy = (part: Set<string>, whole: Set<string>) => [...part].every(w => whole.has(w));

/**
 * Both sets of notes, without saying anything twice. Compared by their words:
 * the parser punctuates the same offer differently from one read to the next,
 * and pasting it again must not pile the notes up.
 */
function joinNotes(mine: string, theirs: string): string {
  const a = mine.trim();
  const b = theirs.trim();
  if (!a || !b) return a || b;
  if (coveredBy(wordsOf(b), wordsOf(a))) return a;
  if (coveredBy(wordsOf(a), wordsOf(b))) return b;
  return `${a}\n${b}`;
}

/**
 * What an offer brings to a shift already logged. Anything blank gets filled.
 * The whole offer as text is the dispatch's own word, so it also corrects what
 * a photo misread: the name, the venue, the rate. A photo never overwrites: it
 * is the rougher copy, and may be arriving second. The employer is only filled,
 * since it may have been matched to a saved employer by hand, and a rate a stub
 * corrected stays corrected.
 */
export function mergeOffer(target: Job, offer: ParsedJob, fullText: boolean): OfferMerge {
  const updates: Partial<Job> = {};
  const changes: string[] = [];

  const take = <K extends keyof Job>(field: K, label: string, value: Job[K], correct: boolean) => {
    if (!has(value) || same(value, target[field])) return;
    if (has(target[field]) && !correct) return;
    updates[field] = value;
    changes.push(label);
  };

  take('name', 'name', offer.name, fullText);
  take('venue', 'venue', offer.venue, fullText);
  take('client', 'employer', offer.client, false);
  take('payrollCompany', 'payroll company', offer.payrollCompany, fullText);
  take('hourlyRate', 'rate', offer.hourlyRate, fullText && !target.stubCorrections?.some(c => c.field === 'rate'));
  take('contract', 'contract', offer.contract ?? undefined, fullText);
  take('steward', 'steward', offer.steward, fullText);
  take('local', 'local', offer.local, fullText);
  take('role', 'role', offer.role, false);
  take('startTime', 'call time', offer.startTime, false);
  take('endTime', 'end time', offer.endTime, false);
  take('minimumHours', 'minimum call', offer.minimumHours, false);
  take('parkingCost', 'parking', offer.parkingCost, false);

  const notes = joinNotes(target.notes ?? '', offer.notes ?? '');
  if (notes !== (target.notes ?? '').trim()) {
    updates.notes = notes;
    changes.push('notes');
  }

  // "2705" becoming "2026-2705" is the same job, written out in full.
  const fuller = has(offer.jobNumber) && (!has(target.jobNumber) || offer.jobNumber!.trim().length > target.jobNumber!.trim().length);
  if (fuller) {
    updates.jobNumber = offer.jobNumber!.trim();
    if (!has(target.jobNumber)) changes.push('job number');
  }

  // Flagged because the payroll company was a guess, and now the offer says.
  if (target.needsReview && target.payrollCompany === target.client && has(offer.payrollCompany)) updates.needsReview = undefined;

  return { target, updates, changes };
}
