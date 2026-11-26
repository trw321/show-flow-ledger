import type { Job } from './store';
import { clockMinutes, endAfterStart } from './clock';

/**
 * Holidays a contract can pay extra on, by the date each falls on in a year.
 * A contract names which of these it pays (see bgca.ts); a holiday it doesn't
 * name pays nothing extra under it.
 */
export type HolidayKey =
  | 'newYearsDay' | 'mlkDay' | 'presidentsDay' | 'memorialDay' | 'juneteenth' | 'independenceDay'
  | 'laborDay' | 'veteransDay' | 'thanksgiving' | 'dayAfterThanksgiving' | 'christmasEve' | 'christmas' | 'newYearsEve';

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** The day of the month of the nth weekday (0 Sunday) in a month (0 January). */
function nth(y: number, m: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** The day of the month of the last such weekday. */
function last(y: number, m: number, weekday: number): number {
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lastDay = new Date(Date.UTC(y, m, days)).getUTCDay();
  return days - ((lastDay - weekday + 7) % 7);
}

export const HOLIDAYS: Record<HolidayKey, { name: string; on: (year: number) => string }> = {
  newYearsDay: { name: "New Year's Day", on: y => iso(y, 0, 1) },
  mlkDay: { name: 'Martin Luther King Jr. Day', on: y => iso(y, 0, nth(y, 0, 1, 3)) },
  presidentsDay: { name: "Presidents' Day", on: y => iso(y, 1, nth(y, 1, 1, 3)) },
  memorialDay: { name: 'Memorial Day', on: y => iso(y, 4, last(y, 4, 1)) },
  juneteenth: { name: 'Juneteenth', on: y => iso(y, 5, 19) },
  independenceDay: { name: 'Independence Day', on: y => iso(y, 6, 4) },
  laborDay: { name: 'Labor Day', on: y => iso(y, 8, nth(y, 8, 1, 1)) },
  veteransDay: { name: 'Veterans Day', on: y => iso(y, 10, 11) },
  thanksgiving: { name: 'Thanksgiving', on: y => iso(y, 10, nth(y, 10, 4, 4)) },
  dayAfterThanksgiving: { name: 'the day after Thanksgiving', on: y => iso(y, 10, nth(y, 10, 4, 4) + 1) },
  christmasEve: { name: 'Christmas Eve', on: y => iso(y, 11, 24) },
  christmas: { name: 'Christmas', on: y => iso(y, 11, 25) },
  newYearsEve: { name: "New Year's Eve", on: y => iso(y, 11, 31) },
};

/** The holiday a date is, of the ones given, or nothing. */
export function holidayOn(date: string, keys: readonly HolidayKey[]): string | undefined {
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year)) return undefined;
  const key = keys.find(k => HOLIDAYS[k].on(year) === date);
  return key && HOLIDAYS[key].name;
}

/** The date `days` after a YYYY-MM-DD date. */
function addDays(date: string, days: number): string {
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
}

/**
 * How many of a call's paid working hours fall on a holiday: midnight to
 * midnight of the day itself, so a 10 PM call the night before is on it from
 * midnight. The part of an hour (or half hour) paid whole sits at the end of
 * the call, as it does for the night premium. `paidHours` is the call's
 * working hours as paid: what this can never be more than.
 */
export function callHolidayHours(
  job: Pick<Job, 'date' | 'startTime' | 'endTime'>,
  paidHours: number,
  isHoliday: (date: string) => string | undefined,
): { hours: number; name?: string } {
  if (!(paidHours > 0)) return { hours: 0 };
  const start = clockMinutes(job.startTime);
  const end = endAfterStart(start, job.endTime);
  // No clock times: a call on the holiday is on it, all of it.
  if (Number.isNaN(start) || Number.isNaN(end)) {
    const name = isHoliday(job.date);
    return name ? { hours: paidHours, name } : { hours: 0 };
  }
  const paidEnd = Math.max(end, start + paidHours * 60);
  let minutes = 0;
  let name: string | undefined;
  for (let day = 0; day * 1440 < paidEnd; day++) {
    const found = isHoliday(addDays(job.date, day));
    if (!found) continue;
    const from = Math.max(start, day * 1440);
    const to = Math.min(paidEnd, (day + 1) * 1440);
    if (to > from) {
      minutes += to - from;
      name ??= found;
    }
  }
  return minutes > 0 ? { hours: Math.min(minutes / 60, paidHours), name } : { hours: 0 };
}
