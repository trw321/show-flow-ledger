import { useMemo } from 'react';
import { isToday, isPast, differenceInCalendarDays } from 'date-fns';
import { effectiveHoursWorked } from '@/lib/payCalc';
import type { Job } from '@/lib/store';

// A shift counts as "needs hours" once its date has arrived and no hours
// have been logged yet — it stays flagged indefinitely (not scoped to the
// current month/view) so it can't silently roll off the page once the
// calendar advances. Shared by Dashboard's hero card and Calendar's
// "Ready to log" list so they can never drift out of sync with each other.
export function needsHours(job: Job): boolean {
  const jobDate = new Date(job.date + 'T12:00:00');
  if (!(isToday(jobDate) || isPast(jobDate))) return false;
  if (job.status === 'cancelled') return false;
  // Planned hours waiting to be confirmed need a tap just as much as no hours
  // at all do, and "completed" does not excuse them.
  if (job.hoursPlanned) return true;
  return effectiveHoursWorked(job) === 0 && job.status !== 'completed';
}

export function useNeedsHours(jobs: Job[]) {
  return useMemo(() => {
    const jobsNeedingHours = jobs
      .filter(needsHours)
      .sort((a, b) => a.date.localeCompare(b.date));
    const oldestDays = jobsNeedingHours.length > 0
      ? differenceInCalendarDays(new Date(), new Date(jobsNeedingHours[0].date + 'T12:00:00'))
      : 0;
    return { jobsNeedingHours, oldestDays };
  }, [jobs]);
}
