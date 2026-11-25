import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { claimDay } from './unemployment';

/** A pay period longer than a week: one that would be averaged over several. */
export const multiWeek = (start: string, end: string) => {
  const days = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
  return Number.isFinite(days) && days > 7;
};

/** "Mar 1 – Mar 14, 2026", or "Dec 28, 2025 – Jan 10, 2026" across a year. */
export function periodText(start: string, end: string) {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${format(parseISO(start), 'MMM d')} – ${claimDay(end, false)}`
    : `${claimDay(start, false)} – ${claimDay(end, false)}`;
}
