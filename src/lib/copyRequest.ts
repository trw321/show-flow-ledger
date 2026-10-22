import type { Job } from './store';
import { localToday } from './today';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const plusDays = (base: Date, days: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return localToday(d);
};

interface Mention {
  at: number;
  /** Every date the words could mean — a bare weekday is last week's or next week's. */
  dates: string[];
}

/** The dates a piece of text names, in the order it names them. */
function dateMentions(text: string, now: Date): Mention[] {
  const found: Mention[] = [];
  const t = text.toLowerCase();
  const add = (at: number, dates: string[]) => found.push({ at, dates });

  for (const m of t.matchAll(/\b(today|tonight|yesterday|tomorrow)\b/g)) {
    const word = m[1];
    add(m.index!, [plusDays(now, word === 'yesterday' ? -1 : word === 'tomorrow' ? 1 : 0)]);
  }
  for (const m of t.matchAll(/\b(last|next|this)?\s*(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?(?:'s)?\b/g)) {
    const prefix = m[1];
    const dow = WEEKDAYS.findIndex(w => w.startsWith(m[2]));
    if (dow < 0) continue;
    const back = (now.getDay() - dow + 7) % 7;
    const past = plusDays(now, -back);
    const future = plusDays(now, back === 0 ? 0 : 7 - back);
    add(m.index!, prefix === 'last' ? [plusDays(now, -(back || 7))] : prefix === 'next' ? [plusDays(now, (7 - back) || 7)] : [past, future]);
  }
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
    const month = String(Number(m[1])).padStart(2, '0');
    const day = String(Number(m[2])).padStart(2, '0');
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) add(m.index!, [`${year}-${month}-${day}`]);
  }
  return found.sort((a, b) => a.at - b.at);
}

/**
 * "Add to today and yesterday the same Odeum shift I logged on Monday."
 *
 * A request to copy a shift already in the ledger onto other days. The parser
 * only ever sees the text, never the ledger, so it finds nothing in a request
 * like this; it is read here instead.
 *
 * Of the days named, the one with a matching shift is the one to copy — by
 * employer when one is named — and the rest are where it goes. Every call of
 * that day comes along, so a split copies as a split. Null when the text is
 * not this kind of request, or names no shift that can be found.
 */
export function parseCopyRequest(text: string, jobs: Job[], now = new Date()): { sources: Job[]; dates: string[] } | null {
  const t = text.toLowerCase();
  if (!/\b(same|copy|duplicate|repeat|again)\b/.test(t)) return null;
  if (!/\b(shift|shifts|call|calls|job|gig|day)\b/.test(t)) return null;

  const mentions = dateMentions(text, now);
  if (mentions.length < 2) return null;

  // An employer named in the text narrows which shift is meant.
  const employers = [...new Set(jobs.map(j => j.client).filter(Boolean))];
  const named = employers.filter(c => c.toLowerCase().split(/\s+/).some(w => w.length > 2 && t.includes(w)));
  const candidates = named.length ? jobs.filter(j => named.includes(j.client)) : jobs;

  const shiftsOn = (date: string) => candidates.filter(j => j.date === date && j.status !== 'cancelled');

  // Of the days named, the source is the one with shifts on it; prefer the
  // most recent past one when more than one could be meant.
  let sourceMention: Mention | undefined;
  let sourceDate: string | undefined;
  for (const m of mentions) {
    for (const d of [...m.dates].sort().reverse()) {
      if (shiftsOn(d).length === 0) continue;
      if (!sourceDate || d > sourceDate) { sourceMention = m; sourceDate = d; }
    }
  }
  if (!sourceMention || !sourceDate) return null;
  // Several named days with shifts on them: the one after "same" is the one
  // being described, the rest are destinations.
  const anchor = t.search(/\b(same|copy|duplicate|repeat)\b/);
  const after = mentions.filter(m => m.at > anchor && m.dates.some(d => shiftsOn(d).length > 0));
  if (after.length === 1 && after[0] !== sourceMention) {
    sourceMention = after[0];
    sourceDate = [...after[0].dates].sort().reverse().find(d => shiftsOn(d).length > 0)!;
  }

  // Destinations: every other day named. A bare weekday that could be last
  // week's or next week's means the coming one.
  const dates = mentions
    .filter(m => m !== sourceMention)
    .map(m => (m.dates.length > 1 ? m.dates[m.dates.length - 1] : m.dates[0]))
    .filter(d => d !== sourceDate);
  const unique = [...new Set(dates)].sort();
  if (unique.length === 0) return null;
  return { sources: shiftsOn(sourceDate), dates: unique };
}
