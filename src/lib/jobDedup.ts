import type { Job } from './store';

type JobIdentity = Pick<Job, 'jobNumber' | 'name' | 'client' | 'date' | 'startTime'>;

const normalize = (value?: string) => value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';

const hasStartTime = (job: Partial<JobIdentity>) => !!job.startTime?.trim();

export function getJobDedupKey(job: Partial<JobIdentity>) {
  if (hasStartTime(job)) {
    return `time|${normalize(job.date)}|${normalize(job.startTime)}`;
  }
  return `fallback|${normalize(job.date)}|${normalize(job.client)}|${normalize(job.name)}`;
}

export function isDuplicateJob(incoming: Partial<JobIdentity>, existing: Partial<JobIdentity>[]) {
  const incomingHasTime = hasStartTime(incoming);

  return existing.some((ex) => {
    const exHasTime = hasStartTime(ex);

    // Both have startTime → match on date + startTime only
    if (incomingHasTime && exHasTime) {
      return normalize(incoming.date) === normalize(ex.date) &&
             normalize(incoming.startTime) === normalize(ex.startTime);
    }

    // Either missing startTime → fall back to date + client + name
    return normalize(incoming.date) === normalize(ex.date) &&
           normalize(incoming.client) === normalize(ex.client) &&
           normalize(incoming.name) === normalize(ex.name);
  });
}
