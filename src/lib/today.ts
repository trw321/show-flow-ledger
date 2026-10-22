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
