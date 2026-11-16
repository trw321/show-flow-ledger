import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns';
import type { Employer, Job } from './store';
import { effectiveHoursWorked, jobPayBreakdown } from './payCalc';
import { EMPTY_PROFILE, type PayerProfile } from './payerProfile';
import { projectKeysFor, projectOf as projectOfShift } from './projectGrouping';

/** A payment as read off a stub or a check, or typed in. */
export interface FoundPayment {
  amount: number;
  date: string;
  payer?: string;
  /** Days the stub lists hours for, when it itemises them. */
  hoursOn?: string[];
  /** The pay period a stub prints ("10/26/2026 to 11/01/2026"): the days it paid for. */
  period?: { start: string; end: string };
}

export interface MatchReason {
  text: string;
  /** For the match (true) or against it (false). */
  good: boolean;
}

/** One kind of evidence, and how many of its points it earned. */
export interface MatchPart {
  label: 'Pay period' | 'Hours on the stub' | 'Amount' | 'Payer' | 'Timing';
  points: number;
  of: number;
  reasons: MatchReason[];
}

/** One shift of the project, as the match sees it. */
export interface MatchShift {
  job: Job;
  /** Expected take-home for this shift; 0 when it has no hours yet. */
  expected: number;
  paid: boolean;
  /** Inside the stub's pay period, when it prints one. */
  inPeriod?: boolean;
  /** Listed on the stub's per-day hours, when it has them. */
  onStub?: boolean;
  /** Counted in the amount this payment is checked against. */
  counted: boolean;
}

export interface ProjectMatch {
  /** 0–100: how much of the available evidence points to this project. */
  percent: number;
  level: 'high' | 'medium' | 'low';
  reasons: MatchReason[];
  /** Expected take-home for the project's worked days the payment would cover. */
  expected: number;
  /** The score, kind by kind, so it can be read instead of trusted. */
  parts: MatchPart[];
  /** Every shift in the project, by date. */
  shifts: MatchShift[];
  /** Found only by looking past the first 45 days, up to a year back. */
  farBack?: boolean;
}

export interface MatchContext {
  allJobs: Job[];
  employers: Employer[];
  payer?: PayerProfile;
  /** Shifts that already have a payment against them. */
  paidJobIds: Set<string>;
}

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => format(parseISO(iso), 'MMM d');
const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Loosely the same company: a shared word of four letters or more, or one name inside the other. */
function sameName(a?: string, b?: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const words = new Set(y.split(' ').filter(w => w.length > 3));
  return x.split(' ').some(w => w.length > 3 && words.has(w));
}

/** Every shift in the same project as this one — see projectGrouping. */
export function projectOf(job: Job, allJobs: Job[], employers: Employer[] = []): Job[] {
  return projectOfShift(job, allJobs, employers);
}

/**
 * How well a payment fits a project, as a percentage of the evidence there
 * is, with every reason — for and against — so the match can be checked
 * rather than trusted.
 *
 * Four things count, weighted by how much each says: the stub listing hours
 * on the project's days (the strongest — it names the work); the amount
 * against what those days were expected to pay; the payer being the
 * project's payroll company or employer; and the timing. Evidence that is
 * not there — a check lists no hours — is left out of the reckoning, not
 * counted against it, so a check can still be a certain match.
 */
export function matchPaymentToProject(payment: FoundPayment, project: Job[], ctx: MatchContext): ProjectMatch {
  const reasons: MatchReason[] = [];
  let score = 0;
  let possible = 0;
  const parts: MatchPart[] = [];
  // Each kind of evidence is scored in its own block; this records what that
  // block earned, out of what it could have, with its reasons.
  let mark = { score: 0, possible: 0, reasons: 0 };
  const begin = () => { mark = { score, possible, reasons: reasons.length }; };
  const end = (label: MatchPart['label']) => {
    if (possible === mark.possible && score === mark.score && reasons.length === mark.reasons) return;
    parts.push({ label, points: score - mark.score, of: possible - mark.possible, reasons: reasons.slice(mark.reasons) });
  };

  const worked = project.filter(j => effectiveHoursWorked(j) > 0);
  const unpaid = worked.filter(j => !ctx.paidJobIds.has(j.id));
  const period = payment.period && payment.period.start <= payment.period.end ? payment.period : undefined;
  const inPeriod = (j: Job) => !!period && j.date >= period.start && j.date <= period.end;
  const workedInPeriod = worked.filter(inPeriod);
  // A stub's pay period says exactly which days it paid for, so those are what
  // the amount is checked against; without one, the days still owed.
  const basis = workedInPeriod.length > 0 ? workedInPeriod : unpaid.length > 0 ? unpaid : worked;
  const shiftPay = new Map(worked.map(j => [j.id, jobPayBreakdown(j, ctx.allJobs, ctx.employers, ctx.payer ?? EMPTY_PROFILE).net]));
  const expected = basis.reduce((sum, j) => sum + (shiftPay.get(j.id) ?? 0), 0);

  // 0. The pay period, against the days this project was worked.
  begin();
  if (period) {
    possible += 40;
    const span = `${day(period.start)} – ${day(period.end)}`;
    if (workedInPeriod.length > 0) {
      score += 40;
      reasons.push({ good: true, text: `Worked ${workedInPeriod.map(j => day(j.date)).join(', ')}: inside the stub's pay period, ${span}` });
    } else {
      reasons.push({ good: false, text: `No day of this project falls in the stub's pay period, ${span}` });
    }
  }
  end('Pay period');

  // 1. Hours on the stub, on this project's days.
  begin();
  const projectDays = [...new Set(project.map(j => j.date))].sort();
  if (payment.hoursOn && payment.hoursOn.length > 0) {
    possible += 40;
    const listed = [...new Set(payment.hoursOn)].filter(d => projectDays.includes(d)).sort();
    if (listed.length > 0) {
      score += 40;
      const share = listed.length === projectDays.length ? 'every day' : `${listed.length} of ${projectDays.length} days`;
      reasons.push({ good: true, text: `The stub lists hours on ${listed.map(day).join(', ')} — ${share} of this project` });
    } else {
      reasons.push({ good: false, text: `The stub lists hours on ${[...new Set(payment.hoursOn)].sort().map(day).join(', ')}, none of them this project's days` });
    }
  }
  end('Hours on the stub');

  // 2. The amount, against what the days were expected to pay.
  begin();
  if (expected > 0) {
    possible += 30;
    const off = Math.abs(payment.amount - expected) / expected;
    if (off <= 0.02) {
      score += 30;
      reasons.push({ good: true, text: `${money(payment.amount)} matches the ${money(expected)} expected` });
    } else if (off <= 0.1) {
      score += 22;
      reasons.push({ good: true, text: `${money(payment.amount)} is within ${Math.max(1, Math.round(off * 100))}% of the ${money(expected)} expected` });
    } else if (off <= 0.25) {
      score += 10;
      reasons.push({ good: true, text: `${money(payment.amount)} is within 25% of the ${money(expected)} expected` });
    } else {
      reasons.push({
        good: false,
        text: `${money(payment.amount)} is ${payment.amount > expected ? 'more' : 'less'} than the ${money(expected)} expected — it may cover other days, or only part of these`,
      });
    }
  } else {
    reasons.push({ good: false, text: 'No rate or hours on these shifts yet, so the amount can’t be checked' });
  }
  end('Amount');

  // 3. Who paid it.
  begin();
  const lead = project[0];
  if (payment.payer?.trim()) {
    possible += 20;
    if (lead?.payrollCompany && sameName(payment.payer, lead.payrollCompany)) {
      score += 20;
      reasons.push({ good: true, text: `Paid by ${payment.payer}, this project's payroll company` });
    } else if (lead && sameName(payment.payer, lead.client)) {
      score += 20;
      reasons.push({ good: true, text: `Paid by ${payment.payer}, this project's employer` });
    } else {
      reasons.push({ good: false, text: `Paid by ${payment.payer} — not this project's employer or payroll company` });
    }
  }
  end('Payer');

  // 4. When it was paid.
  begin();
  const workedDays = worked.map(j => j.date).sort();
  if (workedDays.length > 0 && payment.date && isValid(parseISO(payment.date))) {
    possible += 10;
    const first = workedDays[0];
    const last = workedDays[workedDays.length - 1];
    const sinceLast = differenceInCalendarDays(parseISO(payment.date), parseISO(last));
    if (payment.date < first) {
      score -= 20;
      reasons.push({ good: false, text: `Dated ${day(payment.date)}, before this project's first day` });
    } else if (sinceLast < 0) {
      score += 5;
      reasons.push({ good: true, text: `Paid partway through the project — it may cover only the first days` });
    } else if (sinceLast <= 21) {
      score += 10;
      reasons.push({ good: true, text: `Paid ${sinceLast} day${sinceLast === 1 ? '' : 's'} after the last day — usual payroll timing` });
    } else if (sinceLast <= 45) {
      score += 5;
      reasons.push({ good: true, text: `Paid ${sinceLast} days after the last day — later than usual` });
    } else {
      reasons.push({ good: false, text: `Paid ${sinceLast} days after the last day — a long way after` });
    }
  }
  end('Timing');

  const onStub = new Set(payment.hoursOn ?? []);
  const counted = new Set(basis.map(j => j.id));
  const shifts: MatchShift[] = [...project].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map(job => ({
    job,
    expected: shiftPay.get(job.id) ?? 0,
    paid: ctx.paidJobIds.has(job.id),
    inPeriod: period ? inPeriod(job) : undefined,
    onStub: payment.hoursOn?.length ? onStub.has(job.date) : undefined,
    counted: counted.has(job.id),
  }));

  const percent = possible > 0 ? Math.max(0, Math.min(100, Math.round((score / possible) * 100))) : 0;
  return { percent, level: percent >= 70 ? 'high' : percent >= 40 ? 'medium' : 'low', reasons, expected, parts, shifts };
}

/**
 * The pay period a stub prints, read from wherever it ended up in the text:
 * "Pay stub for the period 10/26/2026 to 11/01/2026", "10/26/26 - 11/1/26",
 * "2026-10-26 through 2026-11-01".
 */
export function payPeriodIn(text?: string): { start: string; end: string } | undefined {
  if (!text) return undefined;
  const DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}/\d{1,2}/\d{2,4})`;
  const m = text.match(new RegExp(`${DATE}\\s*(?:-|–|—|to|thru|through)\\s*${DATE}`, 'i'));
  if (!m) return undefined;
  const iso = (s: string): string | undefined => {
    let y: number, mo: number, d: number;
    if (s.includes('-')) [y, mo, d] = s.split('-').map(Number);
    else { [mo, d, y] = s.split('/').map(Number); if (y < 100) y += 2000; }
    const out = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isValid(parseISO(out)) && parseISO(out).getDate() === d ? out : undefined;
  };
  const start = iso(m[1]);
  const end = iso(m[2]);
  return start && end && start <= end ? { start, end } : undefined;
}

/**
 * The first look: work up to 45 days before a payment (a first check can take
 * weeks) or a week after it (a payment dated partway through a run).
 */
export const NEAR_LOOK_BACK_DAYS = 45;
/**
 * The second look, only when nothing fits in the first: up to a year before.
 * Work gets backlogged, and a check can come months late.
 */
export const FAR_LOOK_BACK_DAYS = 366;

type Found = { project: Job[]; match: ProjectMatch };
const byPercent = (a: Found, b: Found) => b.match.percent - a.match.percent;

/**
 * Every project worked inside the window, scored. A day inside the payment's
 * pay period always counts, however far back it is. Projects in `skip` are
 * left out.
 */
function candidates(payment: FoundPayment, ctx: MatchContext, days: number, skip: Set<string>): Found[] {
  const keys = projectKeysFor(ctx.allJobs, ctx.employers);
  const seen = new Set(skip);
  const found: Found[] = [];
  for (const job of ctx.allJobs) {
    const key = keys.get(job.id) ?? job.id;
    if (seen.has(key)) continue;
    if (effectiveHoursWorked(job) <= 0) continue;
    const inPeriod = !!payment.period && job.date >= payment.period.start && job.date <= payment.period.end;
    if (!inPeriod && !withinLookBack(payment.date, job.date, days)) continue;
    // Any worked day in the window brings the whole project in: a long run's
    // first day can be well over six weeks before a check for its last.
    seen.add(key);
    const project = projectOf(job, ctx.allJobs, ctx.employers);
    found.push({ project, match: matchPaymentToProject(payment, project, ctx) });
  }
  return found;
}

/**
 * Both looks: the last 45 days, then, if nothing there fits better than
 * poorly, up to a year back. What the second look adds says so (farBack).
 */
function nearThenFar(payment: FoundPayment, ctx: MatchContext, skip: Set<string>): Found[] {
  const near = candidates(payment, ctx, NEAR_LOOK_BACK_DAYS, skip);
  if (near.some(f => f.match.level !== 'low')) return near.sort(byPercent);
  const keys = projectKeysFor(ctx.allJobs, ctx.employers);
  const looked = new Set([...skip, ...near.flatMap(f => f.project.map(j => keys.get(j.id) ?? j.id))]);
  const far = candidates(payment, ctx, FAR_LOOK_BACK_DAYS, looked).map(f => ({ ...f, match: { ...f.match, farBack: true } }));
  return [...near, ...far].sort(byPercent);
}

/** Every project the payment could have paid, best first. */
export function rankedProjectsFor(payment: FoundPayment, ctx: MatchContext, limit = 3): Found[] {
  return nearThenFar(payment, ctx, new Set()).slice(0, limit);
}

/**
 * Another project the payment fits clearly better, if there is one — so a
 * stub for last week's job, opened on this week's shift, says so.
 */
export function betterProject(payment: FoundPayment, current: Job, ctx: MatchContext): Found | null {
  const here = matchPaymentToProject(payment, projectOf(current, ctx.allJobs, ctx.employers), ctx);
  const best = bestOf(payment, ctx, projectKeysFor(ctx.allJobs, ctx.employers).get(current.id));
  return best && best.match.percent >= here.percent + 20 && best.match.level !== 'low' ? best : null;
}

/**
 * Whether a worked day is close enough to a payment to be what it paid: up to
 * `days` before it (45 unless the search has widened), or a week after.
 */
export function withinLookBack(paymentDate: string, workDate: string, days: number = NEAR_LOOK_BACK_DAYS): boolean {
  const gap = differenceInCalendarDays(parseISO(paymentDate), parseISO(workDate));
  return !Number.isNaN(gap) && gap >= -7 && gap <= days;
}

/**
 * The project a payment with no shift most likely paid, if any fits better
 * than poorly: the last 45 days first, then up to a year back.
 */
export function bestProjectFor(payment: FoundPayment, ctx: MatchContext): Found | null {
  const best = bestOf(payment, ctx);
  return best && best.match.level !== 'low' ? best : null;
}

function bestOf(payment: FoundPayment, ctx: MatchContext, skipKey?: string): Found | null {
  return nearThenFar(payment, ctx, new Set(skipKey ? [skipKey] : []))[0] ?? null;
}

/**
 * A payment date whose year the photo reader got wrong. A check dated
 * "10/23/26" came back as 2023-10-23: three years before any shift, so it
 * matched nothing. When the date as read sits near no worked shift, but the
 * same month and day this year (or last) sits near your work, that's the date,
 * and the year it was read as is kept so the screen can say what changed. A
 * date that already fits your shifts, or that fits none either way, is left
 * exactly as read.
 */
export function settleReadYear(date: string, jobs: Job[], today: string): { date: string; readAs?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { date };
  const worked = jobs.filter(j => effectiveHoursWorked(j) > 0);
  const fits = (d: string) => worked.some(j => withinLookBack(d, j.date));
  if (fits(date)) return { date };
  const thisYear = Number(today.slice(0, 4));
  for (const year of [thisYear, thisYear - 1]) {
    const candidate = `${year}${date.slice(4)}`;
    if (candidate === date || !isValid(parseISO(candidate)) || candidate.slice(5) !== date.slice(5)) continue;
    // A payment can't be dated more than a week ahead.
    if (differenceInCalendarDays(parseISO(candidate), parseISO(today)) > 7) continue;
    if (fits(candidate)) return { date: candidate, readAs: date };
  }
  return { date };
}
