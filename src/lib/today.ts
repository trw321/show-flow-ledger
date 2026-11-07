import { format, isValid, parseISO } from 'date-fns';

/**
 * A stored date for showing, as `MMM d` or another pattern. A date that
 * isn't a real YYYY-MM-DD (one read off a photo, or from an old version)
 * shows as it was written, rather than taking the page down with it.
 */
export function showDay(date: string | undefined | null, pattern = 'MMM d'): string {
  if (!date) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseISO(date) : null;
  return d && isValid(d) ? format(d, pattern) : date;
}

/**
 * Today's date where you are, as YYYY-MM-DD — the form shift dates are kept in.
 *
 * Not `new Date().toISOString()`: that is the date in UTC, which in
 * California is already tomorrow from 5pm. Comparing shift dates against it
 * made the evening of a shift's own day read as the day after, and a shift
 * worked today look like yesterday's.
 */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
