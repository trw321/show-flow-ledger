import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { Income } from './store';

/** Enough of a payment, as read off an image, to tell whether it is one already seen. */
interface ReadPayment {
  amount: number;
  date: string;
  client?: string;
}

const sameMoney = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;

const daysApart = (a: string, b: string) => {
  const d = differenceInCalendarDays(parseISO(a), parseISO(b));
  return Number.isNaN(d) ? Infinity : Math.abs(d);
};

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);

/** Loosely the same payer: a shared word, or no name to compare. */
const samePayer = (a?: string, b?: string) => {
  if (!a?.trim() || !b?.trim()) return true;
  const theirs = new Set(words(b));
  return words(a).some(w => theirs.has(w)) || a.trim().toLowerCase() === b.trim().toLowerCase();
};

/**
 * For each payment read from one image, the earlier one it repeats, if any.
 *
 * A pay stub photographed with its check still attached can read as two
 * payments of the same amount a few days apart — the pay date on the stub,
 * the date on the check — when it is one paycheck. Counting both doubles what
 * was paid. Flagged rather than dropped: two identical deposits in a week can
 * be real, so the person importing gets the last word.
 */
export function repeatsInUpload(list: ReadPayment[]): (number | undefined)[] {
  return list.map((p, i) => {
    for (let j = 0; j < i; j++) {
      if (sameMoney(p.amount, list[j].amount) && daysApart(p.date, list[j].date) <= 7) return j;
    }
    return undefined;
  });
}

/** A payment already in the ledger: the same amount, within ten days, from the same payer. */
export function alreadyRecorded(p: ReadPayment, income: Income[]): Income | undefined {
  return income.find(i =>
    sameMoney(i.amount, p.amount) && daysApart(i.date, p.date) <= 10 && samePayer(p.client, i.client));
}
