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
  // Most reliable: job number + date (CBs share number but differ by date)
  if (job.jobNumber?.trim()) {
    return `dispatch|${normalize(job.jobNumber)}|${date}`;
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
