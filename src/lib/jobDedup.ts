import type { Job } from './store';

type JobIdentity = Pick<Job, 'jobNumber' | 'name' | 'client' | 'date' | 'startTime'>;

const normalize = (value?: string) => value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';

export function getJobDedupKey(job: Partial<JobIdentity>) {
  return [
    normalize(job.date),
    normalize(job.client),
    normalize(job.name),
    normalize(job.jobNumber),
    normalize(job.startTime),
  ].join('|');
}

export function isDuplicateJob(job: Partial<JobIdentity>, jobs: Partial<JobIdentity>[]) {
  const key = getJobDedupKey(job);
  return jobs.some((existing) => getJobDedupKey(existing) === key);
}
