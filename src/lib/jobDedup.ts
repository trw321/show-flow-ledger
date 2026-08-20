import type { Job } from './store';

type JobIdentity = Pick<Job, 'jobNumber' | 'name' | 'client' | 'date' | 'startTime'>;

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
  return `fallback|${date}|${normalize(job.client)}|${normalize(job.name)}`;
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
  const jobNumber = normalize(incoming.jobNumber);
  const date = normalize(incoming.date);
  if (!jobNumber || !date) return undefined;
  return existing.find(ex => normalize(ex.jobNumber) === jobNumber && normalize(ex.date) === date);
}
