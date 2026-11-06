import type { Job } from './store';

type JobIdentity = Pick<Job, 'jobNumber' | 'name' | 'client' | 'date' | 'startTime' | 'contract'>;

const normalize = (value?: string) => value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';

// Normalize "7:00 AM" / "07:00 AM" / "7:00AM" → "07:00 am"
const normalizeTime = (value?: string) => {
  if (!value?.trim()) return '';
  const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return normalize(value);
  return `${m[1].padStart(2, '0')}:${m[2]} ${m[3].toLowerCase()}`;
};

export function getJobDedupKey(job: Partial<JobIdentity>) {
  const date = normalize(job.date);
  // Include startTime so same-day callbacks (same job#, same date, different time) are distinct
  if (job.jobNumber?.trim()) {
    const time = normalizeTime(job.startTime);
    return `dispatch|${normalize(job.jobNumber)}|${date}${time ? `|${time}` : ''}`;
  }
  // With startTime: date + normalized time
  if (job.startTime?.trim()) {
    return `time|${date}|${normalizeTime(job.startTime)}`;
  }
  // The same employer and show under another contract is another call.
  const contract = normalize(job.contract);
  return `fallback|${date}|${normalize(job.client)}|${normalize(job.name)}${contract ? `|${contract}` : ''}`;
}

export function isDuplicateJob(incoming: Partial<JobIdentity>, existing: Partial<JobIdentity>[]) {
  const incomingKey = getJobDedupKey(incoming);
  return existing.some(ex => getJobDedupKey(ex) === incomingKey);
}

/**
 * Looser than isDuplicateJob — same job number + date, regardless of whether
 * startTime matches or is even present on both sides. Two parses of the same
 * dispatch record (e.g. once from pasted text, once from a photo) commonly
 * come out with different completeness, so the strict key above can miss
 * them entirely. This is for flagging a likely duplicate for the user to
 * review, not for silently skipping — the two entries may genuinely differ.
 */
export function findLikelyDuplicate<T extends Partial<JobIdentity>>(
  incoming: Partial<JobIdentity>,
  existing: T[]
): T | undefined {
  const date = normalize(incoming.date);
  if (!date) return undefined;

  const jobNumber = normalize(incoming.jobNumber);
  if (jobNumber) {
    const match = existing.find(ex => normalize(ex.jobNumber) === jobNumber && normalize(ex.date) === date);
    if (match) return match;
  }

  // Most dispatch text has no job number at all, so the check above never
  // fires for the majority of shifts. Fall back to same date + same client —
  // two parses of the same gig on the same day almost always mean the same
  // shift, even if start-time formatting drifted between extractions.
  const client = normalize(incoming.client);
  if (client) {
    const contract = normalize(incoming.contract);
    return existing.find(ex => normalize(ex.date) === date && normalize(ex.client) === client
      // Two named contracts that differ are two calls, not one parsed twice.
      && !(contract && ex.contract && normalize(ex.contract) !== contract));
  }
  return undefined;
}
