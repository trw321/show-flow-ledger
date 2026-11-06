import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { Employer, Job } from '@/lib/store';
import { resolveEmployer } from '@/lib/employerMatch';
import { jobKey } from '@/lib/jobDedup';

/**
 * Which shifts belong to the same piece of work.
 *
 * A dispatch job number is the real identity — every call on a run carries it,
 * including the callbacks — so when one is present it decides on its own.
 * Without one, the show name and the employer together are the best available
 * stand-in: "Portola Fest" for Blackpoint is one project, and the same name
 * for a different employer is not.
 */
export function sameProject(a: Job, b: Job): boolean {
  const aNum = jobKey(a.jobNumber, a.date);
  const bNum = jobKey(b.jobNumber, b.date);
  if (aNum && bNum) return aNum === bNum;
  // A job number on one side and not the other means they were logged
  // differently; fall back to the name rather than calling them unrelated.
  const aName = (a.name ?? '').trim().toLowerCase();
  const bName = (b.name ?? '').trim().toLowerCase();
  if (!aName || !bName) return false;
  return aName === bName && (a.client ?? '') === (b.client ?? '');
}

/**
 * The other shifts on this project that still name the employer being changed
 * away from. Shifts already on a different employer are left alone — someone
 * set those deliberately.
 */
export function projectSiblingsToRelabel(job: Job, previousClient: string, all: Job[]): Job[] {
  if (!previousClient) return [];
  return all.filter(
    other =>
      other.id !== job.id &&
      (other.client ?? '') === previousClient &&
      sameProject(other, job),
  );
}

const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** A shift logged without its job number joins a numbered run of the same show this close to it. */
const NEAR_RUN_DAYS = 14;
/** With no job number to say otherwise, the same show this long after the last day is a new project. */
const NEW_RUN_GAP_DAYS = 7;

/**
 * Every shift's project, worked out once over the whole ledger, so the
 * calendar, its dots, the pay matcher and Mark paid all agree on it. They
 * used to each have their own rule — one minded the case of the name, one
 * did not, none joined a shift typed in by hand to the dispatched run it
 * belonged to — so a payment could be on one project while its days were
 * counted on another, and a run showed up as two.
 *
 *  - A job number decides on its own: the same number is the same project,
 *    with or without its year in front ("2705" is "2026-2705").
 *  - A shift without one joins the nearest numbered run of the same show for
 *    the same employer, within two weeks.
 *  - Otherwise the show name and the employer, ignoring case, and the
 *    employer's spelling ("BLACKPOINT PRODUCTION INC." is Blackpoint), for as
 *    long as the days keep coming. A week's gap starts a new project: the same
 *    show in March and in November is two jobs, paid twice.
 *  - A shift with no name and no number is a project of its own.
 */
export function projectKeys(jobs: Job[], employers: Employer[] = []): Map<string, string> {
  const keys = new Map<string, string>();
  const employerOf = (client: string) => resolveEmployer(client, employers)?.id ?? norm(client);
  const nameKey = (j: Job) => `${norm(j.name)}|${employerOf(j.client ?? '')}`;

  const numberedByName = new Map<string, Job[]>();
  for (const j of jobs) {
    const num = jobKey(j.jobNumber, j.date);
    if (!num) continue;
    keys.set(j.id, '#' + num);
    if (norm(j.name)) {
      const k = nameKey(j);
      numberedByName.set(k, [...(numberedByName.get(k) ?? []), j]);
    }
  }

  const loose = new Map<string, Job[]>();
  for (const j of jobs) {
    if (keys.has(j.id)) continue;
    if (!norm(j.name)) { keys.set(j.id, 'shift:' + j.id); continue; }
    const k = nameKey(j);
    let nearest: { job: Job; gap: number } | undefined;
    for (const n of numberedByName.get(k) ?? []) {
      const gap = Math.abs(differenceInCalendarDays(parseISO(n.date), parseISO(j.date)));
      if (gap <= NEAR_RUN_DAYS && (!nearest || gap < nearest.gap)) nearest = { job: n, gap };
    }
    if (nearest) keys.set(j.id, keys.get(nearest.job.id)!);
    else loose.set(k, [...(loose.get(k) ?? []), j]);
  }

  for (const [k, shifts] of loose) {
    const byDate = [...shifts].sort((a, b) => a.date.localeCompare(b.date));
    let runStart = byDate[0].date;
    byDate.forEach((j, i) => {
      if (i > 0 && differenceInCalendarDays(parseISO(j.date), parseISO(byDate[i - 1].date)) > NEW_RUN_GAP_DAYS) runStart = j.date;
      keys.set(j.id, `show:${k}:${runStart}`);
    });
  }
  return keys;
}

/** One empty list, so asking without employers still finds what was worked out before. */
const NO_EMPLOYERS: Employer[] = [];

const cached = new WeakMap<Job[], { employers: Employer[]; keys: Map<string, string> }>();

/** projectKeys, remembered for as long as the same list of shifts is asked about. */
export function projectKeysFor(jobs: Job[], employers: Employer[] = NO_EMPLOYERS): Map<string, string> {
  const hit = cached.get(jobs);
  if (hit && hit.employers === employers) return hit.keys;
  const keys = projectKeys(jobs, employers);
  cached.set(jobs, { employers, keys });
  return keys;
}

/** Every shift on the same project as this one. */
export function projectOf(job: Job, allJobs: Job[], employers: Employer[] = NO_EMPLOYERS): Job[] {
  const keys = projectKeysFor(allJobs, employers);
  const key = keys.get(job.id);
  return key ? allJobs.filter(j => keys.get(j.id) === key) : [job];
}

/**
 * A callback is any day of a job after its first. The start date is the call,
 * and every later date is a call back. A second call on the same day is a
 * split, not a callback, whatever the offer's notes say: "CB SAME DAY" is a
 * split. It's worked out from the dates because the notes can't be trusted
 * either way: the days expanded from "CB 11/9" don't say CB on them at all.
 */
export function isCallback(job: Job, allJobs: Job[], employers: Employer[] = NO_EMPLOYERS): boolean {
  if (job.status === 'cancelled') return false;
  const start = projectOf(job, allJobs, employers).filter(j => j.status !== 'cancelled').map(j => j.date).sort()[0];
  return !!start && job.date > start;
}
