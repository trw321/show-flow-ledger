import { addDays, addMonths, differenceInCalendarDays, differenceInMonths, format, isValid, parseISO } from 'date-fns';
import type { Employer, Job } from './store';
import type { PayerProfile } from './payerProfile';
import { jobPayBreakdown, netHoursWorked } from './payCalc';
import { AUTO_MATCH_THRESHOLD, nameSimilarity, resolveEmployer } from './employerMatch';
import { roundHours } from './hoursFormat';

/**
 * What an unemployment claim asks of your work: for a stretch of dates the
 * state names, each week's employers, hours and gross pay, and each
 * employer's first and last day, hours and gross. Gross is the app's
 * estimate from your shifts, before taxes and dues, counted in the week the
 * work was done. Weeks are named by their last day: Saturday unless the
 * state counts them another way.
 */

/** The last day of a week, as Date.getDay() numbers it: 0 is Sunday, 6 Saturday. */
export type WeekEnd = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** A week's run, in words: "Sunday to Saturday". */
export const weekRun = (weekEnd: WeekEnd) => `${WEEKDAYS[(weekEnd + 1) % 7]} to ${WEEKDAYS[weekEnd]}`;

export interface ClaimLine {
  employer: string;
  hours: number;
  gross: number;
  /** It came from a pay stub, not from shifts on the calendar. */
  fromStub?: boolean;
  /** Its shifts are on the calendar, and a pay stub's figures for them stand in for the estimate. */
  perStub?: boolean;
  /**
   * A pay stub covers these shifts and says this gross for them (its share
   * of the week), shown beside the estimate. Not counted: the estimate is,
   * unless "use the stub's pay" is on.
   */
  stubSays?: number;
  /** The pay stubs behind this line, and each one's part of it: the proof, to be looked at. */
  stubs?: LineStub[];
}

/**
 * A pay stub's part in one week's line: counted (it stands in for work the
 * calendar doesn't have), pays (its pay stands in for the calendar's
 * estimate) or says (shown beside the estimate, not counted).
 */
export interface LineStub {
  id: string;
  role: 'counted' | 'pays' | 'says';
  hours: number;
  gross: number;
}

export interface ClaimWeek {
  /** The last day of the week, which names it. */
  weekEnding: string;
  /** The days of it inside the range: the whole week, unless the range cuts it. */
  start: string;
  end: string;
  /** The range starts or ends partway through it. */
  partial: boolean;
  /** One line an employer, in the order first worked that week. */
  lines: ClaimLine[];
  /** Days worked in it (paid time off isn't a day worked). */
  days: number;
  hours: number;
  gross: number;
  /** Paid time off in the week: in its gross, not its hours. */
  pto: number;
  /** Some of it came from a pay stub. */
  fromStub: boolean;
}

export interface ClaimEmployer {
  name: string;
  /** The payroll company that issued the checks, when it isn't the employer itself. */
  paidBy?: string;
  firstDay: string;
  lastDay: string;
  /** Days worked (paid time off isn't a day worked). */
  days: number;
  /** First day to last day, both counted: how long you worked for them, start to finish. */
  spanDays: number;
  hours: number;
  gross: number;
  /** Some of it came from pay stubs: its first and last day are then its stubs' pay periods. */
  fromStub?: boolean;
  /** What you've put in for the claim on its box (see ClaimEmployerInfo). */
  info?: ClaimEmployerInfo;
  /** Its first or last day is one you set, not the calendar's. */
  datesSet?: boolean;
  /** Pay stubs that cover shifts on the calendar, not counted: what they say, beside the estimate for those shifts. */
  stubSays?: { gross: number; hours: number; estimate: number; stubs: number };
  /** Other names linked to it (renamed, or typed another way): their work is counted here. */
  linked?: string[];
}

/**
 * An employer as the claim should show it, filled in on its box: the name
 * the state knows it by, its address and phone, a note, and the first and
 * last day you worked for them when that's outside the dates picked.
 * Keyed by the employer's name, ignoring case. Kept with your synced settings.
 */
export interface ClaimEmployerInfo {
  claimName?: string;
  address?: string;
  phone?: string;
  note?: string;
  firstDay?: string;
  lastDay?: string;
  /**
   * The same employer under another name (it was renamed, or typed another
   * way): everything under this name counts under that one on the claim.
   * The calendar's shifts and the stubs themselves are left as they are.
   */
  linkTo?: string;
}

/** The key an employer's claim details are kept under. */
export const claimEmployerKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The name for the claim: the one you set, or the app's. */
export const claimNameOf = (e: Pick<ClaimEmployer, 'name' | 'info'>) => e.info?.claimName || e.name;

/**
 * A pay stub, summed up: who paid, the pay period, its hours and gross.
 * For work that isn't on the calendar, the stub stands in for it on the
 * claim. Kept with your synced settings.
 */
export interface ClaimStub {
  id: string;
  employer: string;
  /** The pay period, YYYY-MM-DD, both days included. */
  start: string;
  end: string;
  hours: number;
  gross: number;
  /** The days it lists hours for, when it itemizes them: what lets it go on the calendar. */
  days?: { date: string; hours: number }[];
  /** Its straight-time rate, when printed. */
  rate?: number;
  /**
   * Not averaged over its weeks: a bulk total (a year's earnings, say) that,
   * spread evenly, would put the same made-up amount in every week. It counts
   * under its employer and in the totals, in no one week.
   */
  noWeeks?: boolean;
  /** From before stubs were believed by default: its pay counted for the calendar's shifts. Now always so, unless useEstimate. */
  usePay?: boolean;
  /**
   * The calendar's estimate for the shifts it covers counts instead of the
   * stub's pay. A stub is believed unless you say otherwise: it's what was
   * actually paid, and the calendar only places it and checks it.
   */
  useEstimate?: boolean;
  /** The pay date (check or deposit date), beside the pay period's dates worked. */
  paidOn?: string;
  /** The stub's own weeks, when it breaks its hours or pay down by week: where it counts. */
  weeks?: StubWeek[];
  /** A day in the claim week you said it counts in, whole: its pay period crosses weeks and it wasn't split by its days. */
  week?: string;
  createdAt: string;
}

/** One week of a stub, as it prints it: "Week ending 01/31 9.00 hrs $559.74". */
export interface StubWeek {
  start?: string;
  end: string;
  hours?: number;
  gross?: number;
}

/** One calendar shift a stub covers: its estimate, and its share of what the stub says. */
export interface CoveredShift {
  jobId: string;
  date: string;
  hours: number;
  rate?: number;
  estimate: number;
  /** Its part of the stub's gross, shared as the estimates are. */
  share: number;
}

/** A stub counted without being averaged over its weeks (see ClaimStub.noWeeks). */
export interface ClaimUnsplit {
  stubId: string;
  employer: string;
  /** The part of its pay period inside the claim's dates. */
  start: string;
  end: string;
  hours: number;
  gross: number;
}

/**
 * What became of a stub on a claim. Nothing is counted twice:
 * - counted: the calendar had nothing for that employer in its pay period;
 * - calendar: the calendar has those shifts, and they count: at the app's
 *   estimate, or (with "use stub pay" on) with the stub's own gross and
 *   hours shared out over their weeks;
 * - duplicate: another stub has the same employer and pay period, and that
 *   one counts;
 * - overlap: another stub for the same employer covers some of the same
 *   days, and that one counts until the dates are put right.
 */
export interface StubUse {
  stub: ClaimStub;
  status: 'counted' | 'calendar' | 'duplicate' | 'overlap';
  /** The stub it repeats or overlaps. */
  matchedWith?: ClaimStub;
  /** Counted: status is 'counted'. */
  used: boolean;
  /** Shifts the calendar has for it instead, and what the app estimates they paid. */
  shifts: number;
  estimate: number;
  /** Those shifts, one by one. */
  covered?: CoveredShift[];
  /** Its pay stands in for their estimates: believed, as stubs are unless told otherwise. */
  usesPay?: boolean;
  /**
   * How far the stub is from the calendar's shifts in its pay period: its
   * gross less their estimate, its hours less theirs (when it has hours).
   * farOff when it's more than a little: hours the calendar doesn't have, or
   * a rate that isn't right.
   */
  check?: { gross: number; hours?: number; farOff: boolean };
  /** What put it in its weeks: its own weeks, the days it lists, the week you chose, its shifts on the calendar, or its pay period. */
  placedBy?: 'weeks' | 'days' | 'chosen' | 'shifts' | 'period';
}

export interface ClaimSummary {
  weeks: ClaimWeek[];
  employers: ClaimEmployer[];
  /**
   * Who you worked for longest, which a claim can ask. Two ways, since they
   * can be different employers: the longest stretch, first day to last
   * (more days worked breaks a tie), and the most days worked (more hours
   * breaks a tie).
   */
  longest?: { byStretch: string; byDays: string };
  hours: number;
  gross: number;
  /** The pay stubs with pay periods in the range, and whether each was counted. */
  stubs: StubUse[];
  /** Stubs counted in the totals and under their employer, not in any week. */
  unsplit: ClaimUnsplit[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** A real YYYY-MM-DD day. A stored "Nov 5" isn't one and is left out. */
export const isClaimDay = (value: unknown): value is string =>
  typeof value === 'string' && ISO.test(value) && isValid(parseISO(value));

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const cents = (n: number) => Math.round(n * 100) / 100;

/** A money or hours figure as typed: "$1,234.50" is 1234.5. Not a number is NaN. */
export function readAmount(text: string): number {
  const t = text.replace(/[$,\s]/g, '');
  return t === '' ? NaN : Number(t);
}

/**
 * The stub already kept for the same employer and the same pay period, if
 * there is one: adding it again would only be a copy.
 */
export function sameStub(list: ClaimStub[], stub: Pick<ClaimStub, 'employer' | 'start' | 'end'>, except?: string): ClaimStub | undefined {
  const key = claimEmployerKey(stub.employer);
  return list.find(o => o.id !== except && claimEmployerKey(o.employer) === key && o.start === stub.start && o.end === stub.end);
}

/** Employers' claim details as stored, made safe to read: text trimmed, days only if real. */
export function cleanClaimEmployers(raw: unknown): Record<string, ClaimEmployerInfo> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, ClaimEmployerInfo> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
    const info: ClaimEmployerInfo = {
      claimName: text(v.claimName), address: text(v.address), phone: text(v.phone), note: text(v.note),
      firstDay: isClaimDay(v.firstDay) ? v.firstDay : undefined,
      lastDay: isClaimDay(v.lastDay) ? v.lastDay : undefined,
      linkTo: text(v.linkTo) && claimEmployerKey(text(v.linkTo)!) !== claimEmployerKey(key) ? text(v.linkTo) : undefined,
    };
    if (info.firstDay && info.lastDay && info.lastDay < info.firstDay) [info.firstDay, info.lastDay] = [info.lastDay, info.firstDay];
    const kept = Object.fromEntries(Object.entries(info).filter(([, x]) => x !== undefined)) as ClaimEmployerInfo;
    if (Object.keys(kept).length > 0) out[claimEmployerKey(key)] = kept;
  }
  return out;
}

/** The claim's dates as stored: both real days, and a day of the week for its end (Saturday if not). */
export function cleanClaimRange(raw: unknown): { from: string; through: string; weekEnd: WeekEnd } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!isClaimDay(r.from) || !isClaimDay(r.through)) return undefined;
  const w = Number(r.weekEnd);
  return { from: r.from, through: r.through, weekEnd: (Number.isInteger(w) && w >= 0 && w <= 6 ? w : 6) as WeekEnd };
}

/** The weeks ticked off as checked: real days only, each once. */
export function cleanChecked(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter(isClaimDay))].sort() : [];
}

/**
 * The days a stub lists hours for, made safe: real days inside its pay
 * period, hours above nothing, one entry a day (ST, OT and DT on a day added
 * together). Undefined when there are none.
 */
export function stubWeeks(raw: unknown, start: string, end: string): StubWeek[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: StubWeek[] = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const r = w as Record<string, unknown>;
    const wEnd = isClaimDay(r.end) ? r.end : isClaimDay(r.weekEnding) ? r.weekEnding : undefined;
    if (!wEnd) continue;
    // Within a week of the pay period, either side: a week printed for another stub isn't this one's.
    if (wEnd < iso(addDays(parseISO(start), -7)) || wEnd > iso(addDays(parseISO(end), 7))) continue;
    const hours = Number(r.hours);
    const gross = Number(r.gross);
    if (!(hours > 0) && !(gross > 0)) continue;
    out.push({
      end: wEnd,
      ...(isClaimDay(r.start) && r.start <= wEnd ? { start: r.start } : {}),
      ...(hours > 0 ? { hours: Math.round(hours * 1000) / 1000 } : {}),
      ...(gross > 0 ? { gross: cents(gross) } : {}),
    });
  }
  return out.length ? out.sort((a, b) => a.end.localeCompare(b.end)) : undefined;
}

export function stubDays(raw: unknown, start: string, end: string): { date: string; hours: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byDay = new Map<string, number>();
  for (const d of raw) {
    if (!d || typeof d !== 'object') continue;
    const { date, hours } = d as Record<string, unknown>;
    const h = Number(hours);
    if (!isClaimDay(date) || date < start || date > end || !(h > 0)) continue;
    byDay.set(date, (byDay.get(date) ?? 0) + h);
  }
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => ({ date, hours: Math.round(hours * 1000) / 1000 }));
  return days.length ? days : undefined;
}

/**
 * Stubs as stored, made safe to read: no employer, a pay period that isn't
 * real dates, or neither hours nor pay, and it's left out. An end before the
 * start is the same days turned round.
 */
export function cleanStubs(raw: unknown): ClaimStub[] {
  if (!Array.isArray(raw)) return [];
  const out: ClaimStub[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const employer = typeof r.employer === 'string' ? r.employer.trim() : '';
    const hours = Number(r.hours);
    const gross = Number(r.gross);
    if (typeof r.id !== 'string' || !employer || !isClaimDay(r.start) || !isClaimDay(r.end)) continue;
    const h = Number.isFinite(hours) && hours > 0 ? hours : 0;
    const g = Number.isFinite(gross) && gross > 0 ? cents(gross) : 0;
    if (h === 0 && g === 0) continue;
    const [start, end] = r.start <= r.end ? [r.start, r.end] : [r.end, r.start];
    out.push({
      id: r.id, employer, start, end, hours: h, gross: g, createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
      ...(stubDays(r.days, start, end) ? { days: stubDays(r.days, start, end) } : {}),
      ...(Number(r.rate) > 0 ? { rate: Number(r.rate) } : {}),
      ...(r.noWeeks === true ? { noWeeks: true } : {}),
      ...(r.usePay === true ? { usePay: true } : {}),
      ...(r.useEstimate === true ? { useEstimate: true } : {}),
      ...(isClaimDay(r.paidOn) ? { paidOn: r.paidOn } : {}),
      ...(stubWeeks(r.weeks, start, end) ? { weeks: stubWeeks(r.weeks, start, end) } : {}),
      ...(isClaimDay(r.week) ? { week: r.week } : {}),
    });
  }
  return out;
}

/** The last day of the week a day is in: the next Saturday, or whichever day weeks end on. */
export function weekEndingFor(day: string, weekEnd: WeekEnd = 6): string {
  const d = parseISO(day);
  return iso(addDays(d, (weekEnd - d.getDay() + 7) % 7));
}

/** The employer a shift counts under on the claim: its own name where the client matches one. */
export const claimEmployerOf = (job: Job, employers: Employer[]) => employerOf(job, employers).name;

/**
 * An employer the app couldn't name: a shift saved as "Unknown", "N/A",
 * "TBD", or with no employer at all. A claim needs who you worked for, so
 * these are shown with what the shift says, to be put right.
 */
export function isUnclearEmployer(name: string): boolean {
  return /^(unknown|no employer named|n\/?a|tbd|none|\?+|-+)$/i.test(name.trim()) || name.trim() === '';
}

/** Words a company's name ends in that say nothing about which company it is. */
const COMPANY_WORDS = /\b(llc|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|group|management|services|service|productions?|usa)\b\.?/gi;

/**
 * Who a shift the app couldn't name was most likely for, from what's written
 * on it (its notes, name and venue), among the employers you've worked for:
 * "Worked for island creative" is ISLAND CREATIVE MANAGEMENT LLC. Undefined
 * when nothing on it names one.
 */
export function suggestEmployer(job: Partial<Pick<Job, 'notes' | 'name' | 'venue'>>, known: string[]): string | undefined {
  const text = ` ${[job.notes, job.name, job.venue].filter(Boolean).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  let best: { name: string; length: number } | undefined;
  for (const name of known) {
    if (isUnclearEmployer(name)) continue;
    const core = name.toLowerCase().replace(COMPANY_WORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
    if (core.length < 3) continue;
    // Its first two words, or its one: enough to know it, short of the legal tail.
    const words = core.split(' ').slice(0, 2).join(' ');
    if (text.includes(` ${words} `) && (!best || words.length > best.length)) best = { name, length: words.length };
  }
  return best?.name;
}

/** The employer a shift is for, by its own name where the client matches one, and who paid. */
function employerOf(job: Job, employers: Employer[]): { name: string; paidBy?: string } {
  const client = job.client?.trim();
  if (!client) return { name: 'No employer named' };
  const employer = resolveEmployer(client, employers);
  const name = employer?.name ?? client;
  const paidBy = (job.payrollCompany ?? employer?.payrollCompany)?.trim();
  return { name, paidBy: paidBy && paidBy.toLowerCase() !== name.toLowerCase() ? paidBy : undefined };
}

const EMPTY: ClaimSummary = { weeks: [], employers: [], hours: 0, gross: 0, stubs: [], unsplit: [] };

/**
 * How long you worked for an employer, first day to last, both counted, in
 * the years and months a claim asks for, and the days left over.
 */
export function yearsMonths(firstDay: string, lastDay: string): { years: number; months: number; days: number } {
  const start = parseISO(firstDay);
  const after = addDays(parseISO(lastDay), 1);
  const total = differenceInMonths(after, start);
  return { years: Math.floor(total / 12), months: total % 12, days: differenceInCalendarDays(after, addMonths(start, total)) };
}

/** "1 year, 3 months", "0 years, 4 months", or "0 years, 0 months (12 days)" under a month. */
export function howLongText(firstDay: string, lastDay: string): string {
  const { years, months, days } = yearsMonths(firstDay, lastDay);
  const ym = `${years} year${years === 1 ? '' : 's'}, ${months} month${months === 1 ? '' : 's'}`;
  return years === 0 && months === 0 ? `${ym} (${days} day${days === 1 ? '' : 's'})` : ym;
}
/** Past this many weeks the range is a typo, not a claim. */
const MAX_WEEKS = 600;

/**
 * Everything worked from `from` through `through`, both included: every week
 * in the range (a week with no work is there with nothing in it, so none gets
 * skipped), and every employer. Shifts that were cancelled, are still a plan,
 * or have a date that isn't one are left out.
 *
 * A pay stub counts where the calendar has nothing for its employer in its
 * pay period: its hours and gross are spread evenly over the period's days,
 * so a two-week stub puts half in each week. Where the calendar does have
 * those shifts, they count as they are, and the stub sits beside them to
 * check. With useStubPay on, the stub's own gross and hours (what was
 * actually paid) take the place of the app's estimate for them instead,
 * shared out as the shifts are: an option, since it evens the stub's pay
 * over the shifts rather than keeping each shift's own figure. Either way
 * nothing is counted twice.
 */
export function claimSummary(
  jobs: Job[],
  employers: Employer[],
  payer: PayerProfile,
  from: string,
  through: string,
  weekEnd: WeekEnd = 6,
  stubs: ClaimStub[] = [],
  info: Record<string, ClaimEmployerInfo> = {},
  useStubPay = false,
): ClaimSummary {
  if (!isClaimDay(from) || !isClaimDay(through) || through < from) return EMPTY;

  const weeks = new Map<string, ClaimWeek>();
  const lastEnding = weekEndingFor(through, weekEnd);
  for (let ending = weekEndingFor(from, weekEnd); ending <= lastEnding && weeks.size < MAX_WEEKS; ending = iso(addDays(parseISO(ending), 7))) {
    const first = iso(addDays(parseISO(ending), -6));
    const start = first < from ? from : first;
    const end = ending > through ? through : ending;
    weeks.set(ending, { weekEnding: ending, start, end, partial: start !== first || end !== ending, lines: [], days: 0, hours: 0, gross: 0, pto: 0, fromStub: false });
  }

  const byEmployer = new Map<string, Omit<ClaimEmployer, 'spanDays'> & { worked: Set<string> }>();
  const weekDays = new Map<string, Set<string>>();
  // A name linked to another (renamed, or typed another way) counts as that
  // one. Followed a few steps, so a chain of renames ends up in one place.
  const linkedInto = new Map<string, Set<string>>();
  const linkedName = (own: string): string => {
    let name = own;
    for (let i = 0; i < 5; i++) {
      const to = info[claimEmployerKey(name)]?.linkTo;
      if (!to || claimEmployerKey(to) === claimEmployerKey(name)) break;
      name = to;
    }
    if (name !== own) {
      const k = name.toLowerCase();
      linkedInto.set(k, (linkedInto.get(k) ?? new Set<string>()).add(own));
    }
    return name;
  };
  for (const job of jobs) {
    if (job.status === 'cancelled' || !isClaimDay(job.date) || job.date < from || job.date > through) continue;
    const week = weeks.get(weekEndingFor(job.date, weekEnd));
    if (!week) continue;
    const gross = jobPayBreakdown(job, jobs, employers, payer).gross;
    const hours = job.pto ? 0 : netHoursWorked(job);
    // Nothing worked or paid: a plan, not work.
    if (gross <= 0 && hours <= 0) continue;
    const own = employerOf(job, employers);
    const name = linkedName(own.name);
    const paidBy = own.paidBy && own.paidBy.toLowerCase() !== name.toLowerCase() ? own.paidBy : undefined;

    // One line an employer a week, however its name was typed ("Odeum", "odeum").
    let line = week.lines.find(l => !l.fromStub && l.employer.toLowerCase() === name.toLowerCase());
    if (!line) week.lines.push(line = { employer: name, hours: 0, gross: 0 });
    line.hours += hours;
    line.gross += gross;
    week.hours += hours;
    week.gross += gross;
    if (job.pto) week.pto += gross;
    else weekDays.set(week.weekEnding, (weekDays.get(week.weekEnding) ?? new Set<string>()).add(job.date));

    const id = name.toLowerCase();
    const e = byEmployer.get(id) ?? { name, paidBy, firstDay: job.date, lastDay: job.date, days: 0, hours: 0, gross: 0, worked: new Set<string>() };
    if (!e.paidBy && paidBy) e.paidBy = paidBy;
    if (job.date < e.firstDay) e.firstDay = job.date;
    if (job.date > e.lastDay) e.lastDay = job.date;
    if (!job.pto) e.worked.add(job.date);
    e.hours += hours;
    e.gross += gross;
    byEmployer.set(id, e);
  }

  // The employers the calendar knows, as it spells them: a stub typed another
  // way ("Blackpoint" for "BLACKPOINT PRODUCTION INC.") goes under theirs.
  const calendarNames = [...new Set(jobs.filter(j => j.status !== 'cancelled' && j.client?.trim()).map(j => employerOf(j, employers).name))];
  const stubEmployer = (typed: string): string => {
    const { name } = employerOf({ client: typed } as Job, employers);
    if (calendarNames.some(n => n.toLowerCase() === name.toLowerCase())) return linkedName(name);
    let best: { name: string; score: number } | undefined;
    for (const n of calendarNames) {
      const score = nameSimilarity(name, n);
      if (score >= AUTO_MATCH_THRESHOLD && (!best || score > best.score)) best = { name: n, score };
    }
    return linkedName(best?.name ?? name);
  };
  const unsplit: ClaimUnsplit[] = [];

  const stubUses: StubUse[] = [];
  /** Shifts a stub's pay already stands for, and that stub: another stub can't pay them again. */
  const paidByStub = new Map<string, ClaimStub>();
  /** Stubs already counted, by employer: a later one on the same days isn't. */
  const countedStubs = new Map<string, ClaimStub[]>();

  /** The claim week a stretch of days counts in: the one holding most of them, and on a tie the later. */
  const weekOfStretch = (start: string, end: string): string => {
    const days = new Map<string, number>();
    for (let d = start; d <= end && days.size < 60; d = iso(addDays(parseISO(d), 1))) {
      const k = weekEndingFor(d, weekEnd);
      days.set(k, (days.get(k) ?? 0) + 1);
    }
    return [...days].sort((x, y) => y[1] - x[1] || y[0].localeCompare(x[0]))[0]?.[0] ?? weekEndingFor(end, weekEnd);
  };

  /**
   * Where a stub's pay goes, week by week (only the weeks in the claim), and
   * what put it there. In order:
   * - its own weeks, when it prints them;
   * - the days it lists hours for;
   * - the week you put it in;
   * - the calendar's shifts it covers (as much of it as their hours
   *   account for), and the rest of it over its pay period;
   * - its pay period: whole in the week with most of its days when it's a
   *   week or less (an hour worked once isn't 0.857 h and 0.143 h), shared
   *   by its days in the dates when it's longer.
   */
  const placeStub = (stub: ClaimStub, covered: { date: string; hours: number; gross: number }[] = []) => {
    const out = new Map<string, { gross: number; hours: number }>();
    const put = (ending: string, gross: number, hours: number) => {
      if (!weeks.has(ending)) return;
      const cur = out.get(ending) ?? { gross: 0, hours: 0 };
      out.set(ending, { gross: cur.gross + gross, hours: cur.hours + hours });
    };
    if (stub.weeks?.length) {
      const allGross = stub.weeks.every(w => (w.gross ?? 0) > 0);
      const sumGross = allGross ? stub.weeks.reduce((t, w) => t + (w.gross ?? 0), 0) : 0;
      const sumHours = stub.weeks.reduce((t, w) => t + (w.hours ?? 0), 0);
      for (const w of stub.weeks) {
        const share = sumGross > 0 ? (w.gross ?? 0) / sumGross : sumHours > 0 ? (w.hours ?? 0) / sumHours : 1 / stub.weeks.length;
        const hShare = sumHours > 0 ? (w.hours ?? 0) / sumHours : share;
        put(weekOfStretch(w.start ?? iso(addDays(parseISO(w.end), -6)), w.end), stub.gross * share, stub.hours > 0 ? stub.hours * hShare : (w.hours ?? 0));
      }
      return { out, by: 'weeks' as const };
    }
    const dayHours = (stub.days ?? []).reduce((t, d) => t + d.hours, 0);
    if (dayHours > 0) {
      for (const d of stub.days!) put(weekEndingFor(d.date, weekEnd), (stub.gross * d.hours) / dayHours, stub.hours > 0 ? (stub.hours * d.hours) / dayHours : d.hours);
      return { out, by: 'days' as const };
    }
    const chosen = stub.week ? weekEndingFor(stub.week, weekEnd) : undefined;
    if (chosen && weeks.has(chosen)) {
      put(chosen, stub.gross, stub.hours);
      return { out, by: 'chosen' as const };
    }
    let rest = 1;
    if (covered.length > 0) {
      const calHours = covered.reduce((t, x) => t + x.hours, 0);
      const estimate = covered.reduce((t, x) => t + x.gross, 0);
      // The part of the stub its shifts on the calendar account for, by hours.
      const part = stub.hours > 0 && calHours > 0 ? Math.min(1, calHours / stub.hours) : 1;
      for (const x of covered) {
        if (x.date < from || x.date > through) continue;
        const share = estimate > 0 ? x.gross / estimate : calHours > 0 ? x.hours / calHours : 1 / covered.length;
        const hShare = calHours > 0 ? x.hours / calHours : share;
        put(weekEndingFor(x.date, weekEnd), stub.gross * part * share, stub.hours > 0 ? stub.hours * part * hShare : x.hours);
      }
      rest = 1 - part;
      if (rest < 0.0001) return { out, by: 'shifts' as const };
    }
    const total = differenceInCalendarDays(parseISO(stub.end), parseISO(stub.start)) + 1;
    if (total <= 7) {
      put(weekOfStretch(stub.start, stub.end), stub.gross * rest, stub.hours * rest);
    } else {
      const first = stub.start < from ? from : stub.start;
      const last = stub.end > through ? through : stub.end;
      for (let d = first; d <= last; d = iso(addDays(parseISO(d), 1))) {
        put(weekEndingFor(d, weekEnd), (stub.gross * rest) / total, (stub.hours * rest) / total);
      }
    }
    return { out, by: covered.length > 0 ? 'shifts' as const : 'period' as const };
  };

  /** A stub's part of a week: on the employer's calendar line when its pay stands in for those shifts, else a line of its own. */
  const addToWeek = (stub: ClaimStub, name: string, ending: string, gross: number, hours: number, role: 'counted' | 'pays') => {
    const week = weeks.get(ending);
    if (!week) return;
    const id = name.toLowerCase();
    let line = role === 'pays' ? week.lines.find(l => !l.fromStub && l.employer.toLowerCase() === id) : undefined;
    if (line) line.perStub = true;
    else {
      line = week.lines.find(l => l.fromStub && l.employer.toLowerCase() === id);
      if (!line) week.lines.push(line = { employer: name, hours: 0, gross: 0, fromStub: true });
    }
    line.hours += hours;
    line.gross += gross;
    (line.stubs ??= []).push({ id: stub.id, role, hours, gross });
    week.hours += hours;
    week.gross += gross;
  };

  for (const stub of stubs) {
    if (!isClaimDay(stub.start) || !isClaimDay(stub.end) || stub.end < from || stub.start > through) continue;
    const name = stubEmployer(stub.employer);
    const id = name.toLowerCase();
    // The calendar first: its shifts for this employer in the stub's pay period.
    const shifts = jobs.filter(j => j.status !== 'cancelled' && isClaimDay(j.date) && j.date >= stub.start && j.date <= stub.end
      && employerOf(j, employers).name.toLowerCase() === id);
    const workedAll = shifts.map(j => ({ job: j, date: j.date, hours: j.pto ? 0 : netHoursWorked(j), gross: jobPayBreakdown(j, jobs, employers, payer).gross }))
      .filter(x => x.hours > 0 || x.gross > 0)
      .sort((x, y) => x.date.localeCompare(y.date));
    // A shift another stub's pay already stands for isn't paid twice.
    const worked = workedAll.filter(x => !paidByStub.has(x.job.id));
    if (workedAll.length > 0 && worked.length === 0) {
      stubUses.push({ stub, status: 'overlap', matchedWith: paidByStub.get(workedAll[0].job.id), used: false, shifts: 0, estimate: 0 });
      continue;
    }
    if (worked.length > 0) {
      const estimate = worked.reduce((t, x) => t + x.gross, 0);
      const workedHours = worked.reduce((t, x) => t + x.hours, 0);
      // Believed, unless you've said the calendar's estimate is right instead.
      const usesPay = useStubPay || !stub.useEstimate;
      // Each shift's part of the stub: as their estimates are, else their hours, else evenly.
      const part = (x: { gross: number; hours: number }) =>
        estimate > 0 ? x.gross / estimate : workedHours > 0 ? x.hours / workedHours : 1 / worked.length;
      const covered: CoveredShift[] = worked.map(x => ({
        jobId: x.job.id, date: x.date, hours: roundHours(x.hours), estimate: cents(x.gross), share: cents(stub.gross * part(x)),
        ...(Number(x.job.hourlyRate) > 0 ? { rate: Number(x.job.hourlyRate) } : {}),
      }));
      // How far the stub is from the calendar: more than a little is worth a look.
      const grossOff = stub.gross - estimate;
      const hoursOff = stub.hours > 0 ? stub.hours - workedHours : undefined;
      const farOff = Math.abs(grossOff) > Math.max(25, 0.15 * Math.max(stub.gross, estimate))
        || (hoursOff !== undefined && Math.abs(hoursOff) >= 1 && Math.abs(hoursOff) > 0.15 * stub.hours);
      const check = { gross: cents(grossOff), ...(hoursOff !== undefined ? { hours: roundHours(hoursOff) } : {}), farOff };

      if (!usesPay) {
        stubUses.push({ stub, status: 'calendar', used: false, shifts: worked.length, estimate: cents(estimate), covered, check });
        // Not counted, but shown under its employer: what the stub says for
        // each week, by the week's share of its shifts, beside the estimate.
        const perWeek = new Map<string, { gross: number; hours: number; n: number }>();
        for (const x of worked) {
          if (x.date < from || x.date > through) continue;
          const k = weekEndingFor(x.date, weekEnd);
          const cur = perWeek.get(k) ?? { gross: 0, hours: 0, n: 0 };
          perWeek.set(k, { gross: cur.gross + x.gross, hours: cur.hours + x.hours, n: cur.n + 1 });
        }
        const share = (w: { gross: number; hours: number; n: number }) =>
          estimate > 0 ? w.gross / estimate : workedHours > 0 ? w.hours / workedHours : w.n / worked.length;
        const said = { gross: 0, hours: 0, estimate: 0 };
        for (const [ending, w] of perWeek) {
          const line = weeks.get(ending)?.lines.find(l => !l.fromStub && l.employer.toLowerCase() === id);
          if (!line) continue;
          line.stubSays = (line.stubSays ?? 0) + stub.gross * share(w);
          (line.stubs ??= []).push({ id: stub.id, role: 'says', hours: stub.hours * share(w), gross: stub.gross * share(w) });
          said.gross += stub.gross * share(w);
          said.hours += stub.hours * share(w);
          said.estimate += w.gross;
        }
        const e = byEmployer.get(id);
        if (e && perWeek.size > 0) {
          const cur = e.stubSays ?? { gross: 0, hours: 0, estimate: 0, stubs: 0 };
          e.stubSays = { gross: cur.gross + said.gross, hours: cur.hours + said.hours, estimate: cur.estimate + said.estimate, stubs: cur.stubs + 1 };
        }
        continue;
      }

      // Believed: the estimates of the shifts it covers come out, and the
      // stub's own pay goes where it says it was earned.
      for (const x of worked) paidByStub.set(x.job.id, stub);
      const e = byEmployer.get(id) ?? { name, firstDay: worked[0].date, lastDay: worked[worked.length - 1].date, days: 0, hours: 0, gross: 0, worked: new Set<string>() };
      for (const x of worked) {
        if (x.date < from || x.date > through) continue;
        const week = weeks.get(weekEndingFor(x.date, weekEnd));
        const line = week?.lines.find(l => !l.fromStub && l.employer.toLowerCase() === id);
        if (!week || !line) continue;
        line.gross -= x.gross;
        line.hours -= x.hours;
        line.perStub = true;
        week.gross -= x.gross;
        week.hours -= x.hours;
        e.gross -= x.gross;
        e.hours -= x.hours;
      }
      const { out, by } = placeStub(stub, worked);
      for (const [ending, v] of out) {
        addToWeek(stub, name, ending, v.gross, v.hours, 'pays');
        e.gross += v.gross;
        e.hours += v.hours;
      }
      byEmployer.set(id, e);
      stubUses.push({ stub, status: 'calendar', used: false, shifts: worked.length, estimate: cents(estimate), covered, usesPay: true, check, placedBy: by });
      continue;
    }
    // Already counted: the same pay period again, or some of its days.
    const before = countedStubs.get(id) ?? [];
    const same = before.find(o => o.start === stub.start && o.end === stub.end);
    const overlapping = same ?? before.find(o => o.start <= stub.end && stub.start <= o.end);
    if (overlapping) {
      stubUses.push({ stub, status: same ? 'duplicate' : 'overlap', matchedWith: overlapping, used: false, shifts: 0, estimate: 0 });
      continue;
    }
    countedStubs.set(id, [...before, stub]);
    // Nothing on the calendar: the stub stands in for the work.
    const total = differenceInCalendarDays(parseISO(stub.end), parseISO(stub.start)) + 1;
    const first = stub.start < from ? from : stub.start;
    const last = stub.end > through ? through : stub.end;
    if (stub.noWeeks) {
      stubUses.push({ stub, status: 'counted', used: true, shifts: 0, estimate: 0 });
      // Not averaged: the part of it inside the dates, under its employer and in no week.
      const share = (differenceInCalendarDays(parseISO(last), parseISO(first)) + 1) / total;
      const piece = { stubId: stub.id, employer: name, start: first, end: last, hours: stub.hours * share, gross: stub.gross * share };
      unsplit.push(piece);
      const e = byEmployer.get(id) ?? { name, firstDay: first, lastDay: last, days: 0, hours: 0, gross: 0, worked: new Set<string>() };
      if (first < e.firstDay) e.firstDay = first;
      if (last > e.lastDay) e.lastDay = last;
      e.hours += piece.hours;
      e.gross += piece.gross;
      e.fromStub = true;
      byEmployer.set(id, e);
      continue;
    }
    const { out, by } = placeStub(stub);
    stubUses.push({ stub, status: 'counted', used: true, shifts: 0, estimate: 0, placedBy: by });
    let inHours = 0;
    let inGross = 0;
    for (const [ending, v] of out) {
      addToWeek(stub, name, ending, v.gross, v.hours, 'counted');
      inHours += v.hours;
      inGross += v.gross;
    }
    const e = byEmployer.get(id) ?? { name, firstDay: first, lastDay: last, days: 0, hours: 0, gross: 0, worked: new Set<string>() };
    if (first < e.firstDay) e.firstDay = first;
    if (last > e.lastDay) e.lastDay = last;
    e.hours += inHours;
    e.gross += inGross;
    e.fromStub = true;
    byEmployer.set(id, e);
  }

  // Every line under the employer's one spelling, the one its box shows.
  const spelling = (n: string) => byEmployer.get(n.toLowerCase())?.name ?? n;
  const weekList = [...weeks.values()].map(w => ({
    ...w,
    days: weekDays.get(w.weekEnding)?.size ?? 0,
    hours: roundHours(w.hours),
    gross: cents(w.gross),
    pto: cents(w.pto),
    fromStub: w.lines.some(l => l.fromStub),
    lines: w.lines.map(l => ({
      ...l, employer: spelling(l.employer), hours: roundHours(l.hours), gross: cents(l.gross),
      ...(l.stubSays != null ? { stubSays: cents(l.stubSays) } : {}),
      ...(l.stubs ? { stubs: l.stubs.map(x => ({ ...x, hours: roundHours(x.hours), gross: cents(x.gross) })) } : {}),
    })),
  }));
  // The most recent employer first: the order claim forms ask in.
  const employerList = [...byEmployer.values()]
    .map(({ worked, ...e }) => {
      // A first or last day you set on its box stands: your time with them
      // can start or end outside the dates picked.
      const set = info[claimEmployerKey(e.name)];
      const firstDay = set?.firstDay ?? e.firstDay;
      const lastDay = set?.lastDay && set.lastDay >= firstDay ? set.lastDay : e.lastDay;
      return {
        ...e,
        firstDay,
        lastDay,
        ...(set ? { info: set } : {}),
        ...(set?.firstDay || set?.lastDay ? { datesSet: true } : {}),
        days: worked.size,
        spanDays: differenceInCalendarDays(parseISO(lastDay), parseISO(firstDay)) + 1,
        hours: roundHours(e.hours),
        gross: cents(e.gross),
        ...(e.stubSays ? { stubSays: { gross: cents(e.stubSays.gross), hours: roundHours(e.stubSays.hours), estimate: cents(e.stubSays.estimate), stubs: e.stubSays.stubs } } : {}),
        ...(linkedInto.has(e.name.toLowerCase()) ? { linked: [...linkedInto.get(e.name.toLowerCase())!].sort() } : {}),
      };
    })
    .sort((a, b) => b.lastDay.localeCompare(a.lastDay) || a.name.localeCompare(b.name));
  const best = (score: (e: ClaimEmployer) => number[]) => [...employerList].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return a.name.localeCompare(b.name);
  })[0]?.name;
  const longest = employerList.length > 0
    ? { byStretch: best(e => [e.spanDays, e.days, e.hours])!, byDays: best(e => [e.days, e.hours, e.spanDays])! }
    : undefined;
  const unsplitList = unsplit.map(u => ({ ...u, employer: spelling(u.employer), hours: roundHours(u.hours), gross: cents(u.gross) }));
  return {
    weeks: weekList,
    employers: employerList,
    longest,
    // Every week, and what isn't in any one week.
    hours: roundHours(weekList.reduce((s, w) => s + w.hours, 0) + unsplitList.reduce((s, u) => s + u.hours, 0)),
    gross: cents(weekList.reduce((s, w) => s + w.gross, 0) + unsplitList.reduce((s, u) => s + u.gross, 0)),
    stubs: stubUses,
    unsplit: unsplitList,
  };
}

/**
 * The orders the lists can be put in: by hours, low to high or high to low,
 * or by time, oldest first ("🦖 to now") or most recent first.
 */
export type ClaimSort = 'recent' | 'oldest' | 'fewHours' | 'mostHours';

/** Weeks in an order. Weeks with the same hours go most recent first. */
export function sortWeeks(weeks: ClaimWeek[], sort: ClaimSort): ClaimWeek[] {
  const recent = (a: ClaimWeek, b: ClaimWeek) => b.weekEnding.localeCompare(a.weekEnding);
  return [...weeks].sort((a, b) =>
    sort === 'oldest' ? a.weekEnding.localeCompare(b.weekEnding)
    : sort === 'fewHours' ? a.hours - b.hours || recent(a, b)
    : sort === 'mostHours' ? b.hours - a.hours || recent(a, b)
    : recent(a, b));
}

/**
 * Employers in an order: most recent by their last day, oldest by their
 * first. Employers with the same hours go most recent first.
 */
export function sortEmployers(list: ClaimEmployer[], sort: ClaimSort): ClaimEmployer[] {
  const recent = (a: ClaimEmployer, b: ClaimEmployer) => b.lastDay.localeCompare(a.lastDay) || a.name.localeCompare(b.name);
  return [...list].sort((a, b) =>
    sort === 'oldest' ? a.firstDay.localeCompare(b.firstDay) || a.name.localeCompare(b.name)
    : sort === 'fewHours' ? a.hours - b.hours || recent(a, b)
    : sort === 'mostHours' ? b.hours - a.hours || recent(a, b)
    : recent(a, b));
}

/** Money as a claim form takes it: "$1,234.50". */
export const claimMoney = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A day as a claim form shows it: "Sat, Oct 31, 2026". */
export const claimDay = (day: string, withWeekday = true) => format(parseISO(day), withWeekday ? 'EEE, MMM d, yyyy' : 'MMM d, yyyy');

/** The weeks as text to paste: one line a week, every employer in it. */
export function weeksAsText(weeks: ClaimWeek[]): string {
  return weeks.map(w => {
    const head = `Week ending ${claimDay(w.weekEnding)}${w.partial ? ` (${claimDay(w.start, false)} to ${claimDay(w.end, false)} only)` : ''}`;
    if (w.lines.length === 0) return `${head}: no work, 0 days, 0 hours, $0.00`;
    const parts = w.lines.map(l => `${l.employer}${l.fromStub ? ' (from pay stub)' : l.perStub ? ' (per pay stub)' : ''} ${l.hours} hours ${claimMoney(l.gross)}`);
    return `${head}: ${parts.join('; ')}. Total ${w.fromStub ? '' : `${w.days} day${w.days === 1 ? '' : 's'}, `}${w.hours} hours, ${claimMoney(w.gross)} gross${w.pto > 0 ? ` (includes ${claimMoney(w.pto)} PTO)` : ''}`;
  }).join('\n');
}

/** The employers as text to paste: who you worked for longest first, then one line each. */
export function employersAsText(list: ClaimEmployer[], longest?: ClaimSummary['longest']): string {
  const head = !longest ? []
    : longest.byStretch === longest.byDays ? [`Worked for longest: ${longest.byStretch}`]
    : [`Worked for longest, first day to last: ${longest.byStretch}`, `Most days worked: ${longest.byDays}`];
  const lines = list.map(e => `${e.name}${e.paidBy ? ` (paid by ${e.paidBy})` : ''}: first day ${claimDay(e.firstDay, false)}, last day ${claimDay(e.lastDay, false)} (${howLongText(e.firstDay, e.lastDay)}), ${e.days} day${e.days === 1 ? '' : 's'} worked, ${e.hours} hours, ${claimMoney(e.gross)} gross`);
  return [...head, ...(head.length ? [''] : []), ...lines].join('\n');
}

/**
 * A stub's days as shifts for the calendar: one a day, with that day's
 * hours, at its printed rate (or its gross over its hours). Only from days
 * the stub itself lists, never spread or guessed. Each is marked as from the
 * pay stub, and once on the calendar the stub matches them, so nothing
 * counts twice.
 */
export function stubShifts(stub: ClaimStub, now: string): Omit<Job, 'id' | 'createdAt'>[] {
  if (!stub.days?.length) return [];
  const rate = stub.rate && stub.rate > 0 ? stub.rate : stub.hours > 0 ? Math.round((stub.gross / stub.hours) * 100) / 100 : 0;
  const note = `From a pay stub: ${stub.employer}, ${claimDay(stub.start, false)} to ${claimDay(stub.end, false)}, ${stub.hours} h, ${claimMoney(stub.gross)} gross.`;
  return stub.days.map(d => ({
    name: `${stub.employer} (pay stub)`,
    client: stub.employer,
    venue: '',
    date: d.date,
    status: 'completed' as const,
    hoursWorked: d.hours,
    hourlyRate: rate,
    notes: note,
    modifiedAt: now,
  }));
}
