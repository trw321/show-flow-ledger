/**
 * Reading a call's clock times the same way everywhere.
 *
 * Times are saved as typed, and older ones can be bare: "8" to "5". A bare end
 * is the next time that hour comes round after the start, so 8 to 5 is 8 AM to
 * 5 PM, not 5 the next morning: anything unusual gets an am or pm when it's
 * typed. The shift editor already read them this way; the pay maths didn't,
 * and turned 8 to 5 into a 21-hour day with five hours after midnight.
 */

const hasMeridiem = (t: string) => /\d\s*[ap]/i.test(t);

/** Minutes from midnight, as written: "6:30 PM", "18", "8". NaN when it isn't a time. */
export function clockMinutes(t?: string): number {
  const m = t?.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
  if (!m) return NaN;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || '0');
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return h * 60 + min;
}

/**
 * Where a call ends, in minutes from its start date's midnight, always after
 * the start: past 1440 when it runs over midnight. NaN when either isn't a time.
 */
export function endAfterStart(startMinutes: number, endTime?: string): number {
  const base = clockMinutes(endTime);
  if (Number.isNaN(startMinutes) || Number.isNaN(base)) return NaN;
  const forward = (mins: number) => {
    const d = (mins - startMinutes) % 1440;
    return d <= 0 ? d + 1440 : d;
  };
  let end = base;
  const hour = parseInt(endTime?.trim().match(/\d{1,2}/)?.[0] ?? '', 10);
  // A bare 1 to 12 could be either half of the day: the nearer one after the
  // start. Past 12 it's a 24-hour clock, which says which.
  if (!hasMeridiem(endTime ?? '') && hour >= 1 && hour <= 12) {
    const other = (base + 12 * 60) % 1440;
    if (forward(other) < forward(base)) end = other;
  }
  return startMinutes + forward(end);
}

/**
 * The end saved at the start's own time of day ("4:00 PM to 4:00 PM"): a
 * placeholder end, not a 24-hour call. Read as a span it was 24 hours, and a
 * Jun 4 shift counted a whole day's pay on the unemployment claim.
 */
export function sameClockTime(startTime?: string, endTime?: string): boolean {
  const s = clockMinutes(startTime);
  const e = endAfterStart(s, endTime);
  return !Number.isNaN(e) && e - s === 24 * 60;
}

/**
 * A call's clock span in hours. 0 when either time is missing or unreadable,
 * or when the end is the start's own time (see sameClockTime): its hours are
 * whatever is put in.
 */
export function clockSpanHours(startTime?: string, endTime?: string): number {
  const s = clockMinutes(startTime);
  const e = endAfterStart(s, endTime);
  if (Number.isNaN(e) || e - s === 24 * 60) return 0;
  return (e - s) / 60;
}
