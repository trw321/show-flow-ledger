import { addDays, format, parseISO } from 'date-fns';
import type { CrewMember, CrewShift, PayOutMethod } from './store';
import { crewShiftHours, crewShiftOwed, crewShiftPay } from './crew';
import { calcHours, parseTimeToMins } from './hoursMatching';

/**
 * Crew work, said out loud: "book Jamie Friday 8 to 6 at the Fillmore",
 * "Sam worked 9 hours yesterday", "pay Jamie 400 cash", "Dana clocked out".
 *
 * Nothing here saves anything. Speech is misheard, and this is people's pay, so
 * what was understood becomes a plan in plain words, and the plan is what gets
 * confirmed. The same words arrive typed, or from the keyboard's own dictation.
 */

export type CrewAction = 'book' | 'worked' | 'pay' | 'clock-in' | 'clock-out';

/** A time as said: "6:30" has no half of the day until something supplies one. */
export interface SaidTime { h: number; m: number; half?: 'am' | 'pm' }

export interface CrewSpeech {
  action: CrewAction | null;
  people: CrewMember[];
  /** Names that fit more than one person. */
  unclear: string[];
  days: string[];
  start?: string;
  end?: string;
  /** The one time said with a clock in or out. */
  clock?: SaidTime;
  hours?: number;
  amount?: number;
  method?: PayOutMethod;
  place?: string;
  /** The days are what's being paid for ("pay Jamie for Friday"), not the day it was paid. */
  paysForDays: boolean;
}

// ── Words to numbers ────────────────────────────────────────────────────────

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** One spoken number starting at a token, if there is one: "three hundred fifty". */
function readNumber(tokens: string[], from: number): { value: number; next: number } | null {
  let total = 0;
  let part = 0;
  let last: 'none' | 'unit' | 'tens' | 'scale' = 'none';
  let i = from;
  for (; i < tokens.length; i++) {
    const w = tokens[i];
    if (w === 'a' && last === 'none' && /^(hundred|thousand)$/.test(tokens[i + 1] ?? '')) { part = 1; last = 'unit'; continue; }
    if (w === 'and' && last === 'scale' && (tokens[i + 1] in UNITS || tokens[i + 1] in TENS)) continue;
    if (w in UNITS) {
      if (last === 'unit' || (last === 'tens' && (UNITS[w] === 0 || UNITS[w] > 9))) break;
      part += UNITS[w];
      last = 'unit';
    } else if (w in TENS) {
      if (last === 'unit' || last === 'tens') break;
      part += TENS[w];
      last = 'tens';
    } else if (w === 'hundred' && part > 0 && part < 100) {
      part *= 100;
      last = 'scale';
    } else if (w === 'thousand' && part > 0) {
      total += part * 1000;
      part = 0;
      last = 'scale';
    } else break;
  }
  return last === 'none' ? null : { value: total + part, next: i };
}

/** Spoken numbers as digits, and "eight thirty" as 8:30, which is how it's meant. */
function spokenToDigits(text: string): string {
  const tokens = text.split(' ');
  const out: string[] = [];
  for (let i = 0; i < tokens.length;) {
    const first = readNumber(tokens, i);
    if (!first) { out.push(tokens[i++]); continue; }
    let said = String(first.value);
    let next = first.next;
    const second = first.value >= 1 && first.value <= 12 ? readNumber(tokens, next) : null;
    if (second && second.value >= 10 && second.value <= 59) {
      said = `${first.value}:${second.value}`;
      next = second.next;
    }
    if (tokens[next] === 'and' && tokens[next + 1] === 'a' && tokens[next + 2] === 'half') {
      said += '.5';
      next += 3;
    }
    out.push(said);
    i = next;
  }
  return out.join(' ');
}

function clean(text: string): string {
  const flat = text.toLowerCase()
    .replace(/’/g, "'")
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/\b([ap])\.\s?m\b\.?/g, '$1m')
    .replace(/\bo'?\s?clock\b/g, ' ')
    .replace(/'s\b/g, '')
    .replace(/[,!?;]/g, ' ')
    .replace(/\.(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "8 and a half" works from digits as well as words.
  return spokenToDigits(flat).replace(/\b(\d+) and a half\b/g, '$1.5');
}

// ── Times ───────────────────────────────────────────────────────────────────

const TIME = String.raw`(?:noon|midnight|\d{3,4}\s?[ap]m|\d{1,2}(?::\d{2})?(?:\s?[ap]m)?)`;
const RANGE = new RegExp(String.raw`\b(?:from\s+)?(${TIME})\s*(?:to|til|till|until|thru|through|-|–)\s*(${TIME})(?![\d:/])`);
const AT = new RegExp(String.raw`\b(?:at|around|call(?:ed)?(?: time)?(?: at| is)?|start(?:s|ing|ed)?(?: at)?)\s+(${TIME})(?![\d:/])`);
const WRAP = new RegExp(String.raw`\b(?:wrap(?:s|ped|ping)?|end(?:s|ing|ed)?|finish(?:es|ed|ing)?|out)(?: at| by)?\s+(${TIME})(?![\d:/])`);

function readTime(raw: string): SaidTime | null {
  const said = raw.trim();
  if (said === 'noon') return { h: 12, m: 0, half: 'pm' };
  if (said === 'midnight') return { h: 12, m: 0, half: 'am' };
  const m = said.match(/^(\d{1,2})(?::?(\d{2}))?\s?([ap]m)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const half = m[3] as SaidTime['half'];
  if (h > 23 || min > 59) return null;
  // A 24-hour clock says its own half of the day.
  if (h > 12) return { h: h - 12, m: min, half: 'pm' };
  if (h === 0) return { h: 12, m: min, half: 'am' };
  return { h, m: min, half };
}

const minutesOf = (t: SaidTime, half: 'am' | 'pm') => (t.h % 12) * 60 + t.m + (half === 'pm' ? 720 : 0);

function clockText(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'AM' : 'PM'}`;
}

/** A call with no half of the day: mornings from 6, then afternoon. */
const callHalf = (t: SaidTime) => t.half ?? (t.h >= 6 && t.h <= 11 ? 'am' : 'pm');

/** The first time it could be, after a given time. */
function firstAfter(t: SaidTime, after: number): number {
  if (t.half) return minutesOf(t, t.half);
  const wait = (half: 'am' | 'pm') => (minutesOf(t, half) - after + 1440) % 1440 || 1440;
  return wait('am') < wait('pm') ? minutesOf(t, 'am') : minutesOf(t, 'pm');
}

/** The closest it could be to a given time. */
function nearest(t: SaidTime, to: number): number {
  if (t.half) return minutesOf(t, t.half);
  const off = (half: 'am' | 'pm') => {
    const gap = Math.abs(minutesOf(t, half) - to);
    return Math.min(gap, 1440 - gap);
  };
  return off('am') < off('pm') ? minutesOf(t, 'am') : minutesOf(t, 'pm');
}

/** Two times said together, with whichever halves of the day went unsaid worked out. */
function callTimes(from: SaidTime, to: SaidTime): { start: string; end: string } {
  // "6 to 11 pm" is an evening, but "8 to 6 pm" starts in the morning.
  const shared = !from.half && to.half && minutesOf(from, to.half) < minutesOf(to, to.half) ? to.half : undefined;
  const start = minutesOf(from, from.half ?? shared ?? callHalf(from));
  return { start: clockText(start), end: clockText(firstAfter(to, start)) };
}

// ── Days ────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT_DAYS: Record<string, string> = { mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday' };
const DAY = String.raw`(?:${[...WEEKDAYS, ...Object.keys(SHORT_DAYS)].join('|')})`;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = String.raw`(?:${MONTHS.join('|')}|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)`;

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const shifted = (iso: string, days: number) => ymd(addDays(parseISO(iso), days));
const dayIndex = (name: string) => WEEKDAYS.indexOf(SHORT_DAYS[name] ?? name);

/** Which weekday is meant: ahead for a booking, back for work done. */
function weekdayDate(name: string, today: string, look: 'ahead' | 'back', word?: string): string {
  const now = parseISO(today).getDay();
  const ahead = (dayIndex(name) - now + 7) % 7;
  if (word === 'last') return shifted(today, ahead === 0 ? -7 : ahead - 7);
  if (word === 'next') {
    // The one in next week, which is not always the next one to come.
    const inThisWeek = ahead > 0 && ((now + 6) % 7) + ahead <= 6;
    return shifted(today, ahead === 0 || inThisWeek ? ahead + 7 : ahead);
  }
  if (look === 'back' && word !== 'this') return shifted(today, ahead === 0 ? 0 : ahead - 7);
  return shifted(today, ahead);
}

/** A date with no year, or no month: the nearest one that fits the way it's being looked for. */
function nearestDate(year: number, month: number, day: number, today: string, look: 'ahead' | 'back'): string {
  const iso = (y: number, m: number) => ymd(new Date(y, m, day));
  const date = iso(year, month);
  if (look === 'ahead' && date < today) return iso(year + 1, month);
  if (look === 'back' && date > today) return iso(year - 1, month);
  return date;
}

function findDays(pull: (re: RegExp) => RegExpMatchArray | null, today: string, look: 'ahead' | 'back'): string[] {
  const days: string[] = [];
  const add = (...list: string[]) => days.push(...list);
  const now = parseISO(today);

  for (let m; (m = pull(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d:])/));) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null;
    add(year ? ymd(new Date(year, Number(m[1]) - 1, Number(m[2]))) : nearestDate(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), today, look));
  }
  const monthDay = new RegExp(String.raw`\b(${MONTH})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`);
  for (let m; (m = pull(monthDay));) {
    const month = MONTHS.findIndex(name => name.startsWith(m![1].slice(0, 3)));
    add(nearestDate(now.getFullYear(), month, Number(m[2]), today, look));
  }
  for (let m; (m = pull(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/));) {
    const day = Number(m[1]);
    const thisMonth = ymd(new Date(now.getFullYear(), now.getMonth(), day));
    const moved = (look === 'ahead' && thisMonth < today) ? 1 : (look === 'back' && thisMonth > today) ? -1 : 0;
    add(ymd(new Date(now.getFullYear(), now.getMonth() + moved, day)));
  }
  for (let m; (m = pull(/\b(today|tonight|tomorrow|yesterday)\b/));) {
    add(shifted(today, m[1] === 'tomorrow' ? 1 : m[1] === 'yesterday' ? -1 : 0));
  }
  for (let m; (m = pull(/\b(?:(next|last|this)\s+)?weekend\b/));) {
    const saturday = weekdayDate('saturday', today, look, m[1]);
    add(saturday, shifted(saturday, 1));
  }
  const range = new RegExp(String.raw`\b(?:(next|last|this)\s+)?(${DAY})\s*(?:through|thru|to|til|till|until|-|–)\s*(${DAY})\b`);
  for (let m; (m = pull(range));) {
    let from = weekdayDate(m[2], today, look, m[1]);
    const span = (dayIndex(m[3]) - dayIndex(m[2]) + 7) % 7;
    // Work that's done can't end tomorrow: it's last week's run.
    if (look === 'back' && !m[1] && shifted(from, span) > today) from = shifted(from, -7);
    add(...Array.from({ length: span + 1 }, (_, i) => shifted(from, i)));
  }
  const single = new RegExp(String.raw`\b(?:(next|last|this)\s+)?(${DAY})\b`);
  for (let m; (m = pull(single));) add(weekdayDate(m[2], today, look, m[1]));

  return [...new Set(days)].sort();
}

// ── Names ───────────────────────────────────────────────────────────────────

const wordIn = (word: string) => new RegExp(String.raw`\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`);

/** How many single-letter changes turn one word into another. Two swapped letters count as one: Jaime, Jamie. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Words the commands use, which a loose match on a name must never catch: "book" is one letter from Brook. */
const NOT_NAMES = new Set(('book booked booking schedule scheduled pay paid paying work worked working hours hour clock clocked '
  + 'punch punched cash check venmo zelle give gave send sent wrap wrapped from with the and for out').split(' '));

function findPeople(said: string, crew: CrewMember[]): { people: CrewMember[]; unclear: string[]; rest: string } {
  if (/\b(everyone|everybody|whole crew|whole team|all crew|the crew)\b/.test(said)) {
    return { people: [...crew], unclear: [], rest: said.replace(/\b(everyone|everybody|whole crew|whole team|all crew|the crew)\b/g, ' ') };
  }
  let rest = said;
  const found = new Set<CrewMember>();
  // Whole names first, so "sam lee" is never read as every Sam.
  for (const member of crew) {
    const whole = wordIn(member.name.toLowerCase());
    if (whole.test(rest)) { found.add(member); rest = rest.replace(whole, ' '); }
  }
  const byPart = new Map<string, CrewMember[]>();
  for (const member of crew) {
    for (const part of member.name.toLowerCase().split(/\s+/)) byPart.set(part, [...(byPart.get(part) ?? []), member]);
  }
  const unclear = new Set<string>();
  for (const [part, members] of byPart) {
    if (!wordIn(part).test(rest)) continue;
    rest = rest.replace(wordIn(part), ' ');
    if (members.length === 1) found.add(members[0]);
    else unclear.add(part[0].toUpperCase() + part.slice(1));
  }
  // Then what speech does to names: Jaime for Jamie.
  for (const token of rest.split(/\s+/)) {
    if (token.length < 4 || NOT_NAMES.has(token) || /\d/.test(token) || WEEKDAYS.includes(token)) continue;
    const close = [...byPart.keys()].filter(part => part.length >= 4 && part[0] === token[0] && editDistance(part, token) === 1);
    const members = [...new Set(close.flatMap(part => byPart.get(part)!))];
    if (members.length === 1) {
      found.add(members[0]);
      rest = rest.replace(wordIn(token), ' ');
    }
  }
  return { people: [...found], unclear: [...unclear], rest };
}

// ── What was said ───────────────────────────────────────────────────────────

function actionOf(said: string): CrewAction | null {
  if (/\b(clock(s|ed|ing)?|punch(es|ed|ing)?|sign(s|ed|ing)?|check(s|ed|ing)?)\s+(\S+\s+)?in\b/.test(said)) return 'clock-in';
  if (/\b(clock(s|ed|ing)?|punch(es|ed|ing)?|sign(s|ed|ing)?|check(s|ed|ing)?)\s+(\S+\s+)?out\b/.test(said)) return 'clock-out';
  if (/\b(pay|paid|paying|gave|give|send|sent|settle|settled|venmo(ed)?|zelle(d)?)\b/.test(said)) return 'pay';
  if (/\b(book|booked|booking|schedule|scheduled|scheduling|put|hire|hired|bring in|need)\b/.test(said)) return 'book';
  if (/\b(worked|work|logged|log|did)\b/.test(said)) return 'worked';
  return null;
}

const METHODS: [RegExp, PayOutMethod][] = [
  [/\b(?:in |by |with )?cash\b/, 'cash'],
  [/\b(?:by |with |via |on |over )?venmo(?:ed)?\b/, 'venmo'],
  [/\b(?:by |with |via |on |over )?zelle(?:d)?\b/, 'zelle'],
  [/\b(?:by |with |via )?(?:a )?(?:check|cheque)\b/, 'check'],
  [/\b(?:by |with |via )?(?:ach|direct deposit|bank transfer)\b/, 'ach'],
];
const MONEY = /\$\s*(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks?)\b/;
const HOURS = /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/;

/** Everything the words give up, in one pass. Returns the rest for what's left to read. */
function readSaid(text: string, today: string, look: 'ahead' | 'back') {
  let rest = text;
  const pull = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index! + m[0].length)}`.replace(/\s+/g, ' ').trim();
    return m;
  };
  const paysForDays = new RegExp(String.raw`\bfor\s+(?:(?:last|this)\s+)?(?:${DAY}|today|yesterday|the\s+\d)`).test(rest);
  const method = METHODS.find(([re]) => pull(re))?.[1];
  const days = findDays(pull, today, look);
  return { pull, method, days, paysForDays, rest: () => rest };
}

export function parseCrewSpeech(text: string, crew: CrewMember[], today: string): CrewSpeech {
  const said = clean(text);
  const spoken = actionOf(said);
  const { people, unclear, rest: afterNames } = findPeople(said, crew);
  const { pull, method, days, paysForDays } = readSaid(afterNames, today, spoken === 'book' || !spoken ? 'ahead' : 'back');

  const hoursMatch = pull(HOURS);
  let hours = hoursMatch ? Number(hoursMatch[1]) : undefined;
  const moneyMatch = pull(MONEY);
  let amount = moneyMatch ? Number(moneyMatch[1] ?? moneyMatch[2]) : undefined;

  let start: string | undefined;
  let end: string | undefined;
  let clock: SaidTime | undefined;
  if (spoken === 'pay') {
    // No times on a payment: a number here is the money. "four fifty" arrives as 4:50.
    if (amount === undefined) {
      const bare = pull(/\b(\d+)(?::(\d{2}))?(?:\.(\d{1,2}))?\b/);
      if (bare) amount = bare[2] ? Number(bare[1]) * 100 + Number(bare[2]) : Number(`${bare[1]}.${bare[3] ?? 0}`);
    }
  } else {
    const range = pull(RANGE);
    const from = range ? readTime(range[1]) : null;
    const to = range ? readTime(range[2]) : null;
    if (from && to) ({ start, end } = callTimes(from, to));
    else {
      const wrap = pull(WRAP);
      const at = pull(AT) ?? (spoken?.startsWith('clock') ? pull(new RegExp(String.raw`\b(${TIME})(?![\d:/])`)) : null);
      const atTime = at ? readTime(at[1]) : null;
      const wrapTime = wrap ? readTime(wrap[1]) : null;
      if (spoken?.startsWith('clock')) clock = (wrapTime ?? atTime) ?? undefined;
      else {
        const call = atTime ? minutesOf(atTime, callHalf(atTime)) : undefined;
        if (call !== undefined) start = clockText(call);
        if (wrapTime) end = clockText(firstAfter(wrapTime, call ?? 480));
        if (call !== undefined && !end && hours) end = clockText(call + hours * 60);
      }
    }
  }

  // "Jamie worked 9 yesterday" can only mean hours.
  if (spoken === 'worked' && hours === undefined && !start) {
    const bare = pull(/\b(\d{1,2}(?:\.\d+)?)\b/);
    if (bare && Number(bare[1]) <= 24) hours = Number(bare[1]);
  }

  const placeMatch = pull(/\bat\s+(?:the\s+)?([a-z0-9][a-z0-9 '&.-]*?)(?=\s+(?:on|for|from|to|and|by|with)\b|$)/);
  const place = placeMatch ? placeMatch[1].trim().replace(/\b[a-z]/g, c => c.toUpperCase()) : undefined;

  // With no verb the rest says it: a past day is work done, the rest is a booking.
  const action = spoken ?? (people.length > 0 && (days.length > 0 || start || hours)
    ? (days[0] && days[0] < today ? 'worked' : hours && !days.length ? 'worked' : 'book')
    : null);

  return { action, people, unclear, days, start, end, clock, hours, amount, method, place, paysForDays };
}

// ── What it would do ────────────────────────────────────────────────────────

export interface CrewPayment {
  member: CrewMember;
  /** The shifts it settles. */
  shifts: CrewShift[];
  amount: number;
  date: string;
  method?: PayOutMethod;
}

export interface CrewPlan {
  /** What will happen, one line each. */
  lines: string[];
  /** What won't, and why. */
  notes: string[];
  book: Omit<CrewShift, 'id' | 'createdAt'>[];
  update: { id: string; updates: Partial<CrewShift> }[];
  pay: CrewPayment[];
}

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayText = (iso: string) => format(parseISO(iso), 'EEE MMM d');
const hoursBetween = (start: string, end: string) => Math.round(calcHours(start, end) * 100) / 100;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function planBooking(said: CrewSpeech, shifts: CrewShift[], plan: CrewPlan) {
  if (said.days.length === 0) { plan.notes.push('Which day? Say one, like "Friday" or "the 20th".'); return; }
  const when = said.start ? ` · ${said.start}${said.end ? `–${said.end}` : ''}` : '';
  const where = said.place ? ` · ${said.place}` : '';
  for (const member of said.people) {
    for (const date of said.days) {
      const already = shifts.filter(s => s.crewId === member.id && s.date === date);
      const blank = already.find(s => !s.startTime && !s.payoutId);
      // A second call the same day is its own shift. The same one again is not.
      const same = already.find(s => said.start && s.startTime === said.start);
      if (same) {
        plan.notes.push(`${member.name} is already on ${dayText(date)} at ${same.startTime}.`);
      } else if (blank && said.start) {
        plan.update.push({ id: blank.id, updates: { startTime: said.start, endTime: said.end ?? blank.endTime, place: said.place ?? blank.place } });
        plan.lines.push(`Set ${member.name}'s ${dayText(date)}${when}${where}`);
      } else if (already.length > 0 && !said.start) {
        plan.notes.push(`${member.name} is already on ${dayText(date)}.`);
      } else {
        plan.book.push({ crewId: member.id, date, startTime: said.start, endTime: said.end, place: said.place });
        plan.lines.push(`Book ${member.name} · ${dayText(date)}${when}${where}`);
      }
    }
  }
}

function planWorked(said: CrewSpeech, shifts: CrewShift[], today: string, plan: CrewPlan) {
  const days = said.days.length > 0 ? said.days : [today];
  const times = said.start && said.end ? { startTime: said.start, endTime: said.end } : {};
  const fromTimes = said.start && said.end ? hoursBetween(said.start, said.end) : undefined;
  for (const member of said.people) {
    for (const date of days) {
      const shift = shifts.find(s => s.crewId === member.id && s.date === date);
      if (shift?.payoutId) {
        plan.notes.push(`${member.name}'s ${dayText(date)} is already paid, so it stays as it is.`);
        continue;
      }
      const worked = said.hours ?? fromTimes ?? (shift ? crewShiftHours(shift) : 0);
      if (!worked) { plan.notes.push(`How many hours did ${member.name} work on ${dayText(date)}?`); continue; }
      if (shift) plan.update.push({ id: shift.id, updates: { ...times, hoursWorked: worked } });
      else plan.book.push({ crewId: member.id, date, ...times, hoursWorked: worked, place: said.place });
      plan.lines.push(`${member.name} worked ${worked}h on ${dayText(date)}`);
    }
  }
}

function planClock(said: CrewSpeech, shifts: CrewShift[], today: string, now: string, plan: CrewPlan) {
  const nowMins = parseTimeToMins(now);
  for (const member of said.people) {
    const theirs = shifts.filter(s => s.crewId === member.id && !s.payoutId);
    if (said.action === 'clock-in') {
      const time = said.clock ? clockText(nearest(said.clock, nowMins)) : now;
      const shift = theirs.find(s => s.date === today && !s.hoursWorked);
      if (shift) plan.update.push({ id: shift.id, updates: { startTime: time, endTime: undefined } });
      else plan.book.push({ crewId: member.id, date: today, startTime: time });
      plan.lines.push(`${member.name} in at ${time}`);
      continue;
    }
    // Still on from last night counts: a call runs past midnight.
    const open = theirs.find(s => s.date === today && s.startTime && !s.hoursWorked)
      ?? theirs.find(s => s.date === shifted(today, -1) && s.startTime && !s.endTime);
    if (!open?.startTime) { plan.notes.push(`${member.name} has no clock-in to finish. Say when they started.`); continue; }
    const time = said.clock ? clockText(firstAfter(said.clock, parseTimeToMins(open.startTime))) : now;
    const hours = hoursBetween(open.startTime, time);
    plan.update.push({ id: open.id, updates: { endTime: time, hoursWorked: hours } });
    plan.lines.push(`${member.name} out at ${time} · ${hours}h`);
  }
}

function planPay(said: CrewSpeech, shifts: CrewShift[], today: string, plan: CrewPlan) {
  const date = !said.paysForDays && said.days[0] ? said.days[0] : today;
  const by = said.method ? ` · ${said.method === 'ach' ? 'ACH' : said.method}` : '';
  for (const member of said.people) {
    const owedAll = shifts
      .filter(s => s.crewId === member.id && crewShiftOwed(s, today))
      .sort((a, b) => a.date.localeCompare(b.date));
    const owed = said.paysForDays ? owedAll.filter(s => said.days.includes(s.date)) : owedAll;
    const owedTotal = owed.reduce((sum, s) => sum + crewShiftPay(s, member), 0);
    if (said.amount === undefined) {
      const fromHours = said.hours && member.payRate ? said.hours * member.payRate : 0;
      if (owed.length > 0) {
        plan.pay.push({ member, shifts: owed, amount: Math.round(owedTotal * 100) / 100, date, method: said.method });
        plan.lines.push(`Pay ${member.name} ${money(owedTotal)} for ${plural(owed.length, 'shift')}${by}`);
      } else if (fromHours) {
        plan.pay.push({ member, shifts: [], amount: fromHours, date, method: said.method });
        plan.lines.push(`Pay ${member.name} ${money(fromHours)} for ${said.hours}h${by}`);
      } else {
        plan.notes.push(`Nothing owed to ${member.name}. Say an amount to pay them anyway.`);
      }
      continue;
    }
    // Oldest first, as far as the money goes, if it lands on a shift exactly.
    let running = 0;
    const settled: CrewShift[] = [];
    for (const s of owed) {
      if (running + crewShiftPay(s, member) > said.amount + 1) break;
      running += crewShiftPay(s, member);
      settled.push(s);
    }
    const exact = settled.length > 0 && Math.abs(running - said.amount) <= 1;
    plan.pay.push({ member, shifts: exact ? settled : [], amount: said.amount, date, method: said.method });
    plan.lines.push(`Pay ${member.name} ${money(said.amount)}${exact ? ` for ${plural(settled.length, 'shift')}` : ''}${by}`);
    if (!exact && owed.length > 0) plan.notes.push(`${money(said.amount)} doesn't match ${member.name}'s shifts (${money(owedTotal)} owed), so none get marked paid.`);
  }
}

/** What was said, as what it would do to the schedule. `now` is the time, as "8:03 AM". */
export function planCrewSpeech(said: CrewSpeech, shifts: CrewShift[], today: string, now: string): CrewPlan {
  const plan: CrewPlan = { lines: [], notes: [], book: [], update: [], pay: [] };
  for (const name of said.unclear) plan.notes.push(`There's more than one ${name}. Say the last name.`);
  if (said.people.length === 0) {
    if (said.unclear.length === 0) plan.notes.push("Didn't catch a name from the crew.");
    return plan;
  }
  if (said.action === 'book') planBooking(said, shifts, plan);
  else if (said.action === 'worked') planWorked(said, shifts, today, plan);
  else if (said.action === 'pay') planPay(said, shifts, today, plan);
  else if (said.action) planClock(said, shifts, today, now, plan);
  else plan.notes.push(`Didn't catch what to do. Try "book", "worked", "pay", "clocked in" or "clocked out".`);
  return plan;
}

// ── Pay Outs ────────────────────────────────────────────────────────────────

export interface PayoutSpeech {
  worker?: string;
  amount?: number;
  date?: string;
  method?: PayOutMethod;
  jobRef?: string;
}

/**
 * A payment said out loud, for the Record a payment form: "paid Jamie 300 cash
 * for load in yesterday". A name is matched against the people already known,
 * and if it's someone new it's the word or two after "paid" or "to".
 */
export function parsePayoutSpeech(text: string, known: string[], today: string): PayoutSpeech {
  const said = clean(text);
  const crew = known.map((name, i) => ({ id: String(i), name, createdAt: '' }));
  const { people, unclear, rest: afterNames } = findPeople(said, crew);
  const { pull, method, days, rest } = readSaid(afterNames, today, 'back');

  const moneyMatch = pull(MONEY);
  let amount = moneyMatch ? Number(moneyMatch[1] ?? moneyMatch[2]) : undefined;
  if (amount === undefined) {
    const bare = pull(/\b(\d+)(?::(\d{2}))?(?:\.(\d{1,2}))?\b/);
    if (bare) amount = bare[2] ? Number(bare[1]) * 100 + Number(bare[2]) : Number(`${bare[1]}.${bare[3] ?? 0}`);
  }

  const job = pull(/\bfor\s+(?:the\s+)?([a-z0-9][a-z0-9 '&.-]*)$/);
  let worker = people[0]?.name ?? unclear[0];
  if (!worker) {
    const named = rest().match(/\b(?:paid|pay|paying|gave|give|send|sent|to)\s+(?!the\b|a\b)([a-z]+(?:\s+[a-z]+)?)/);
    const words = named?.[1].split(' ').filter(w => !NOT_NAMES.has(w) && w !== 'to' && w !== 'a');
    if (words?.length) worker = words.join(' ').replace(/\b[a-z]/g, c => c.toUpperCase());
  }
  return {
    worker,
    amount,
    date: days[0],
    method,
    jobRef: job ? job[1].trim().replace(/\b[a-z]/g, c => c.toUpperCase()) : undefined,
  };
}
