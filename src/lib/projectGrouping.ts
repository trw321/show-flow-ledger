import type { Job } from '@/lib/store';

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
  const aNum = a.jobNumber?.trim();
  const bNum = b.jobNumber?.trim();
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
