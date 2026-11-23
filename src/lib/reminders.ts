import { addDays, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import { weekEndingFor, type WeekEnd } from './unemployment';

/**
 * The things Preamp reminds you of, each of which can be turned off in
 * Settings. Unset is on: a reminder is only quiet once you've said so.
 */
export type ReminderKind = 'hours' | 'flagged' | 'latePay' | 'conferences' | 'certify';
export type Reminders = Partial<Record<ReminderKind, boolean>>;

export const REMINDER_LABELS: Record<ReminderKind, { label: string; description: string }> = {
  hours: { label: 'Log hours', description: 'A shift that has passed with no hours on it' },
  flagged: { label: 'Check later', description: 'Shifts you flagged to look at again' },
  latePay: { label: 'Late pay', description: 'Work whose pay is due or past due' },
  conferences: { label: 'Conferences', description: 'Coming up, or their new dates to look up' },
  certify: { label: 'Unemployment certification', description: 'When your next certification is due' },
};
export const REMINDER_ORDER: ReminderKind[] = ['hours', 'flagged', 'latePay', 'conferences', 'certify'];

export const reminderOn = (reminders: Reminders | undefined, kind: ReminderKind) => reminders?.[kind] !== false;

/** Settings as stored: only true or false kept, for the kinds there are. */
export function cleanReminders(raw: unknown): Reminders {
  if (!raw || typeof raw !== 'object') return {};
  const out: Reminders = {};
  for (const kind of REMINDER_ORDER) {
    const v = (raw as Record<string, unknown>)[kind];
    if (typeof v === 'boolean') out[kind] = v;
  }
  return out;
}

/**
 * Certifying for unemployment: the state wants an update on a schedule,
 * every two weeks in most places. Kept with your synced settings: how often,
 * and when the next one is due.
 */
export interface CertifySchedule {
  /** Days between certifications: 14 for every two weeks, 7 for every week. */
  every: 7 | 14;
  /** When the next one is due, YYYY-MM-DD. */
  next: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && ISO.test(v) && isValid(parseISO(v));
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export function cleanCertify(raw: unknown): CertifySchedule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { every, next } = raw as Record<string, unknown>;
  if (!isDay(next)) return undefined;
  return { every: every === 7 ? 7 : 14, next };
}

/** A first schedule: due the day after this week ends, every two weeks. */
export function startCertify(today: string, weekEnd: WeekEnd = 6): CertifySchedule {
  return { every: 14, next: iso(addDays(parseISO(weekEndingFor(today, weekEnd)), 1)) };
}

/**
 * Where the next certification stands: days until it's due (below 0 once
 * it's late), and whether Preamp says so yet. It does from the day before.
 */
export function certifyStatus(schedule: CertifySchedule, today: string): { due: string; days: number; remind: boolean } {
  const days = differenceInCalendarDays(parseISO(schedule.next), parseISO(today));
  return { due: schedule.next, days, remind: days <= 1 };
}

/**
 * Certified: the next one is a cycle on. Done late, it's the first one of the
 * cycle still to come, so a missed fortnight doesn't leave it in the past.
 */
export function afterCertifying(schedule: CertifySchedule, today: string): CertifySchedule {
  let next = addDays(parseISO(schedule.next), schedule.every);
  while (iso(next) <= today) next = addDays(next, schedule.every);
  return { ...schedule, next: iso(next) };
}

/**
 * The weeks a certification due on a day covers: the `every` days ending on
 * the last full week before it. Shown, with their work, so you can check
 * them against what the state asks for.
 */
export function certifyPeriod(schedule: CertifySchedule, weekEnd: WeekEnd = 6): { from: string; through: string } {
  const dayBefore = iso(addDays(parseISO(schedule.next), -1));
  const ending = weekEndingFor(dayBefore, weekEnd);
  const through = ending === dayBefore ? ending : iso(addDays(parseISO(ending), -7));
  return { from: iso(addDays(parseISO(through), 1 - schedule.every)), through };
}

/** "today", "tomorrow", "in 5 days", "1 day late", "3 days late". */
export function dueText(days: number): string {
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days > 1) return `due in ${days} days`;
  return `${-days} day${days === -1 ? '' : 's'} late`;
}
