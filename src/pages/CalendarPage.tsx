import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { isCallback, sameProject, projectKeysFor, projectOf as projectDays, splitShifts } from '@/lib/projectGrouping';
import { projectSiblingsToRelabel } from '@/lib/projectGrouping';
import StubEditor from '@/components/StubEditor';
import MoneyRain from '@/components/MoneyRain';
import NightBurst from '@/components/NightBurst';
import LiveWorkPay from '@/components/LiveWorkPay';
import PreampSheet, { PreampGroup } from '@/components/PreampSheet';
import { useNavigate } from 'react-router-dom';
import { useNeedsHours } from '@/lib/useNeedsHours';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { ReturnState } from '@/lib/returnSpot';
import { useRememberedOpen } from '@/lib/useRememberedOpen';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { callText, explicitCalls, parseDayTimeline, withGapOnClock, COMPOSITE_LUNCH_AFTER_HOURS, MEAL_PENALTY_AFTER_HOURS, type DayTimeline } from '@/lib/dayTimeline';
import { ChevronLeft, ChevronRight, ChevronDown, Star, ArrowLeft, Copy, X, Receipt, Pencil, Trash2, Phone, Download, Plus, MapPin, Check, Loader2, Zap, Eye, AlertTriangle, Flame, PenLine, Banknote, Wallet, Flag, Undo2, Rocket, Timer, Orbit, Presentation, ClipboardCheck } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, isToday, isPast, isWithinInterval, parseISO, isValid, differenceInCalendarDays } from 'date-fns';
import type { Employer, Job, CalendarEvent, Income, Invoice } from '@/lib/store';
import { matchPaymentToProject, betterProject, rankedProjectsFor, projectOf, type FoundPayment, type ProjectMatch } from '@/lib/paymentMatch';
import { payDueDate, payTimingTier, PAY_TIMING_LABELS, type PayTimingTier } from '@/lib/payTiming';
import { employerCovers, paidShiftIds, periodNet, periodPayments, projectPeriods, shiftsPaidBy, type PayPeriod, type ProjectPeriod } from '@/lib/payPeriods';
import { explainPay } from '@/lib/payExplain';
import PayEstimateCard from '@/components/PayEstimateCard';
import PaymentProof, { ProofOpen, SourceTag, WhoPaid } from '@/components/PaymentProof';
import { ProjectHoursSummary } from '@/components/ProjectHoursSummary';
import { projectHours } from '@/lib/projectHours';
import { PROOF_LABELS, proofFromMatch, proofKindOf, type ProofKind } from '@/lib/paymentProof';
import CalendarKey from '@/components/CalendarKey';
import ConferenceList from '@/components/ConferenceList';
import { CONFERENCE_COLOUR, conferenceAlerts, conferenceDays, howFar, monthConferences, monthName, nextShow, spanText, startOf, whenText, type ConferenceAlert } from '@/lib/conferences';
import EmployerEditor from '@/components/EmployerEditor';
import { ratesForShift, type PayerProfile } from '@/lib/payerProfile';
import { contractFor, contractsWorked, shiftContract } from '@/lib/contracts';
import { alreadyRecorded } from '@/lib/paymentRepeats';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { calculateDayPay, dayInARow, dayMultiplierFor, dayPremiumLabel, compositeWeekendMultiplier, calculateWeeklyOvertimeBonus, calculateNightHours, resolveConfirmedNightHours, effectiveHoursWorked, netHoursWorked, isOverdueUpcoming, jobGross, jobPayBreakdown, jobHoursBreakdown, nightLeftAtEnd, nightWindowEnd, compareCalls } from '@/lib/payCalc';
import { resolveEmployer } from '@/lib/employerMatch';
import { breakTheHourLabel, breaksTheHour, isLocal16Shift } from '@/lib/local16';
import { callMinimum, isEarlyCall, premiumEndWords, premiumStartHours, premiumWindow, shiftPremiums, splitSideMinimum } from '@/lib/premiums';
import CallPremiums from '@/components/CallPremiums';
import { useSwipe } from '@/lib/useSwipe';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { matchStubToShifts, type MatchConfidence } from '@/lib/stubMatching';
import { learnFromStubs, dismissSuggestion, type Suggestion } from '@/lib/stubLearning';
import { uploadStub, stubViewUrl, deleteStub, isStoredRef } from '@/lib/stubStorage';
import { useAuth } from '@/lib/AuthContext';
import { compareStubToShifts, disagreements, type RowStatus } from '@/lib/stubComparison';
import { resizeImageForStorage, readFileAsDataUrl } from '@/lib/imageResize';
import { exportWeeklyToExcel } from '@/lib/exportWeekly';
import EventIntake from '@/components/EventIntake';
import NewGigPage from '@/pages/NewGigPage';
import { localToday, showDay } from '@/lib/today';
import { shortCall } from '@/lib/shortCall';
import { weekSpans, type DayProject } from '@/lib/projectSpans';
import { certifyPeriod, certifyStatus, dueText, reminderOn } from '@/lib/reminders';
import { EMPLOYER_COLOURS, employerColours, employerId } from '@/lib/employerColours';
import { ptoBalance } from '@/lib/pto';
import { aiFetch } from '@/lib/aiSwitch';
import { roundHours } from '@/lib/hoursFormat';
import { sameClockTime } from '@/lib/clock';

/** The money's colours, in the order they're worked out (see moneyTone), and what the key prints. */
export const SHIFT_STATES = [
  { text: 'text-dot-overdue', sample: '8a', label: 'needs hours' },
  { text: 'text-dot-upcoming', sample: '8a', label: 'upcoming' },
  { text: 'text-dot-pending', sample: '$475', label: 'pending' },
  { text: 'text-dot-late', sample: '$475', label: 'overdue' },
  { text: 'text-dot-paid', sample: '$475', label: 'paid' },
] as const;

/** A day's pay, short enough for a calendar square: "$475", "$1.4k". */
const shortDollars = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`);

/** One row of project bars across the top of a week's days, in px: also how tall a bar is to tap. */
const SPAN_ROW = 12;
/** The 6th/7th-day banner at the very top of a square, in px. */
const BANNER_ROW = 12;

/** Money that came in: "$450", or "$300.50" when there are cents. Never "$300.5". */
const dollars = (n: number) =>
  `$${n.toLocaleString(undefined, Math.round(n * 100) % 100 === 0 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


const statusColors: Record<Job['status'], string> = {
  upcoming: 'bg-accent/20 text-accent border-accent/30',
  'in-progress': 'bg-accent/20 text-accent border-accent/30',
  completed: 'bg-primary/20 text-primary border-primary/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
};



/**
 * Money in the colour of the dots, so green means paid wherever it appears.
 * Expected pay used to be green everywhere, which read as money that had
 * arrived. Paid once every worked shift is paid; red once a worked shift's pay
 * is past the day it was due; amber if one still needs its hours; violet while
 * worked and waiting; blue while still ahead.
 */
function moneyTone(jobs: Job[], paidJobIds: Set<string>, latePayIds?: Set<string>): string {
  const worked = jobs.filter(j => effectiveHoursWorked(j) > 0);
  if (worked.length > 0 && worked.every(j => paidJobIds.has(j.id))) return 'text-dot-paid';
  if (latePayIds && worked.some(j => latePayIds.has(j.id) && !paidJobIds.has(j.id))) return 'text-dot-late';
  if (jobs.some(isOverdueUpcoming)) return 'text-dot-overdue';
  if (worked.length > 0) return 'text-dot-pending';
  return 'text-dot-upcoming';
}

/**
 * Why a shift is flagged "check this one later", so the reminder can say what
 * to check rather than just that something is wrong. You can set the flag by
 * hand; the app sets it when it had to assume something.
 */
function reviewReason(job: Job): { kind: 'payment' | 'payroll' | 'manual'; text: string } {
  if (job.notes?.startsWith('Made from a $')) {
    return { kind: 'payment', text: 'made from a payment — set the day worked, the hours and the rate' };
  }
  if (job.payrollCompany && job.payrollCompany === job.client) {
    return { kind: 'payroll', text: `payroll company taken to be ${job.client} — the offer didn't name one` };
  }
  return { kind: 'manual', text: 'flagged by you' };
}

// Card wash behind a shift — same status meaning as the dot, just readable
// from across the list instead of a 6px dot.
function cardTintClass(job: Job, paidJobIds: Set<string>, late = false): string {
  if (paidJobIds.has(job.id)) return 'from-dot-paid/25 via-dot-paid/[0.07] to-transparent';
  if (late) return 'from-dot-late/25 via-dot-late/[0.07] to-transparent';
  if (isOverdueUpcoming(job)) return 'from-dot-overdue/25 via-dot-overdue/[0.07] to-transparent';
  if (job.status === 'completed') return 'from-dot-pending/25 via-dot-pending/[0.07] to-transparent';
  if (job.status === 'cancelled') return 'from-dot-cancelled/20 via-dot-cancelled/[0.05] to-transparent';
  if (job.status === 'in-progress') return 'from-dot-pending/25 via-dot-pending/[0.07] to-transparent';
  return 'from-dot-upcoming/25 via-dot-upcoming/[0.07] to-transparent';
}

const CONFIDENCE_STYLES: Record<MatchConfidence, { box: string; pill: string }> = {
  high: { box: 'border-success/30 bg-success/5', pill: 'bg-success/20 text-success' },
  medium: { box: 'border-warning/30 bg-warning/5', pill: 'bg-warning/20 text-warning' },
  low: { box: 'border-destructive/30 bg-destructive/5', pill: 'bg-destructive/20 text-destructive' },
};

const ROW_STATUS_STYLES: Record<RowStatus, string> = {
  match: 'text-success',
  close: 'text-warning',
  off: 'text-destructive',
  missing: 'text-muted-foreground/40',
};

const statusLabel: Record<Job['status'], string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function parseTimeToMins(t: string): number {
  const m = t.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
  if (!m) return NaN;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || '0');
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return h * 60 + min;
}

const hasMeridiem = (t: string) => /[ap]\.?m?\.?\s*$/i.test(t.trim());

// "8" to "5" means 8am-5pm, not 8am-5am. A bare hour carries no AM/PM, and
// reading it literally turns an ordinary day into a 21-hour overnight. Pick
// whichever reading gives the shorter shift — that keeps real overnight calls
// (10pm -> 6) working, since there the literal reading is already the shorter.
function resolveEndMins(startMins: number, end: string): number {
  const base = parseTimeToMins(end);
  if (isNaN(base)) return NaN;
  if (hasMeridiem(end)) return base;
  const hour = parseInt(end.trim().match(/\d{1,2}/)?.[0] ?? '', 10);
  if (isNaN(hour) || hour > 12) return base; // 24-hour clock is unambiguous
  const alt = hour === 12 ? (base + 12 * 60) % (24 * 60) : base + 12 * 60;
  const span = (mins: number) => {
    const d = mins - startMins;
    return d <= 0 ? d + 24 * 60 : d;
  };
  return span(alt) < span(base) ? alt % (24 * 60) : base;
}

// Store what we actually assumed, so the rest of the app (pay calc, matching,
// dedup) reads the same time the dialog showed — and so the user can see the
// guess and correct it, instead of a bare "5" silently meaning 5am.
function normalizeTyped(t: string): string {
  if (!t.trim()) return t;
  const mins = parseTimeToMins(t);
  return isNaN(mins) ? t : minutesToTimeStr(mins);
}

/** What the hours box shows for a saved shift: its calls, or its one call, or nothing yet. */
function hoursTextOf(job: Job): string {
  if (job.callTimeline) return job.callTimeline;
  if (job.startTime && job.endTime) return callText(job.startTime, job.endTime);
  // A start saved on its own (the end comes later) shows as typed so far,
  // ready for the end after the dash, rather than an empty box that looks
  // as if it never saved.
  if (job.startTime) return callText(job.startTime, job.startTime).split('-')[0] + '-';
  return '';
}

/** Only a start time typed so far: "7a", "10pm", "8:30 -". */
const START_ONLY = /^\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?)?\s*-?\s*$/i;

/**
 * Whether the stub for a shift has been photographed yet. Lit when it has,
 * greyed out when it has not — the same read-at-a-glance treatment the pay
 * figure gets, so a row of shifts shows what is still missing without reading.
 */
/**
 * A stable colour per plan name, so the same plan is the same stripe every week
 * it appears and two different plans never read as one. Hashed rather than
 * assigned, so it survives plans being added and deleted in any order.
 */
const PLAN_HUES = [199, 158, 40, 280, 320, 95, 15, 240];
function planColor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return `hsl(${PLAN_HUES[hash % PLAN_HUES.length]} 75% 58%)`;
}

/** A conference to-do in Preamp: one starting soon, or one whose dates need looking up. */
function conferenceItem(a: ConferenceAlert) {
  const c = a.conference;
  if (a.next.kind === 'dated') {
    return { title: c.name, detail: `${spanText(a.next, true)}${c.where ? ` · ${c.where}` : ''}`, aside: howFar(a.days), line: `${c.name} starts ${howFar(a.days)} · ${spanText(a.next)}` };
  }
  const due = `usually ${monthName(a.next.month)}`;
  return { title: c.name, detail: `Look up the ${a.next.year} dates · ${due}`, aside: 'dates?', line: `${c.name}: look up the ${a.next.year} dates · ${due}` };
}

const conferenceColour = (alpha = 1) => (alpha === 1 ? `hsl(${CONFERENCE_COLOUR})` : `hsl(${CONFERENCE_COLOUR} / ${alpha})`);

/**
 * A callback: any day of a job after its first. Worth seeing at a glance: it
 * starts at its own time and it is the one the hours note is most likely to
 * disagree with.
 */
function CallbackMark({ job, allJobs, employers }: { job: Job; allJobs: Job[]; employers: Employer[] }) {
  if (!isCallback(job, allJobs, employers)) return null;
  return (
    <span role="img" aria-label="Callback" title="Callback" className="text-[11px] leading-none select-none">
      📞
    </span>
  );
}

/**
 * One of two calls on the same day for the same project — a split shift. The
 * day's two halves are stored as separate shifts, which without this reads as
 * two unrelated calls that happen to share a date. It matters because the
 * turnaround between them is unpaid and the pay engine treats the day as one.
 */
function SplitMark({ job, allJobs }: { job: Job; allJobs: Job[] }) {
  const isSplit = allJobs.some(
    other => other.id !== job.id && other.date === job.date && sameProject(other, job),
  );
  if (!isSplit) return null;
  return (
    <span role="img" aria-label="Split shift" title="Split shift — another call the same day" className="text-[11px] leading-none select-none">
      🤸
    </span>
  );
}

/**
 * Where the record of this shift's money came from, which is not the same as
 * whether there is one. A stub shows what was earned and what came out of it,
 * a cheque only shows what arrived, and a figure typed in by hand has had
 * nothing checked against a document at all — so they cannot be the same mark.
 */
const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** A day that is the 6th or later in a row, and what it pays over a normal day. */
interface PremiumDay { day: number; pays: number; who: string }
const premiumClass = (p: { day: number }) => (p.day >= 7 ? 'premium-7' : 'premium-6');

/** The headings that fold a section away under the calendar, all one look: neon pink, glowing a little. */
const FOLD_HEADING = 'flex items-center gap-1.5 text-left text-[12px] font-body font-semibold uppercase tracking-widest text-[hsl(312_95%_75%)] neon-soft';

/** The big one: the top of a 6th or 7th day. Only money that is really owed gets the money. */
function PremiumDayBanner({ day, pays, who, onSetUp }: PremiumDay & { onSetUp?: () => void }) {
  const face = pays >= 2 ? '🤑' : pays > 1 ? '💰' : '🔥';
  const body = (
    <>
      <p className="text-lg font-black leading-tight tracking-tight">{face} {ordinal(day).toUpperCase()} DAY IN A ROW {face}</p>
      <p className="mt-0.5 text-sm font-bold leading-snug">
        {pays >= 2 ? '🎉 DOUBLE TIME · 2× all day 💸'
          : pays > 1 ? '🎉 TIME AND A HALF · 1.5× all day 💵'
          : `${who} isn't set to pay extra.${onSetUp ? ` Tap to set it on ${who} 👀` : ''}`}
      </p>
    </>
  );
  // Not paying: the banner is the way to the employer's settings.
  return pays <= 1 && onSetUp ? (
    <button type="button" onClick={onSetUp} className={cn('block w-full rounded-lg px-3 py-2.5 text-center', premiumClass({ day }))} data-testid="premium-day-setup">
      {body}
    </button>
  ) : (
    <div className={cn('rounded-lg px-3 py-2.5 text-center', premiumClass({ day }))}>{body}</div>
  );
}

/**
 * Premium hours on a call: an early call (starts between midnight and 7 AM)
 * or work past midnight. Says so up top, like a 6th day, and when the
 * contract hasn't said how its early premium runs, asks.
 */
function PremiumHoursBanner({ job, allJobs, employer, payer, onTap }: { job: Job; allJobs: Job[]; employer?: Employer; payer: PayerProfile; onTap?: () => void }) {
  const early = isEarlyCall(job);
  // Night and early morning are one premium, stopping where the contract says.
  const window = premiumWindow(job, employer, payer);
  const night = !early && window.endHour !== null && (employer?.nightPremiumEnabled ?? true) && job.startTime && job.endTime
    ? resolveConfirmedNightHours(calculateNightHours(job.startTime, job.endTime, employer?.nightPremiumStartHour ?? 0, window.endHour), job.nightPremiumConfirmed, job.nightPremiumActualHours)
    : 0;
  // Night hours arrive with a pop of moons, z's and money, and again on a tap.
  const isNight = !early && night > 0;
  const [bannerEl, setBannerEl] = useState<HTMLElement | null>(null);
  const [burst, setBurst] = useState(0);
  useEffect(() => { if (isNight) setBurst(b => b + 1); }, [isNight]);
  if (!early && night <= 0) return null;
  const premium = early ? (window.endHour === null ? 0 : premiumStartHours(job, window.endHour, breaksTheHour(job, employer))) : night;
  const multiplier = employer?.nightPremiumMultiplier ?? 2;
  const title = early ? `🌅 EARLY CALL · ${job.startTime}` : `🌙 NIGHT HOURS · past midnight`;
  // Until the contract says how long premium runs, the least is counted: say so, and ask.
  const unset = window.set ? '' : ` · counted ${premiumEndWords(window.endHour)}, the least: tap to set this contract's`;
  const line = window.endHour === null ? 'No premium under this contract'
    : early
      ? !job.endTime ? `Premium at ${multiplier}× ${premiumEndWords(window.endHour)}${unset}`
        : `${Math.round(premium * 100) / 100}h at ${multiplier}× · ${premiumEndWords(window.endHour)}${unset}`
      : `${Math.round(premium * 100) / 100}h worked after midnight at ${multiplier}×${unset}`;
  const cls = cn('block w-full rounded-lg border px-3 py-2 text-center', !window.set ? 'border-warning/60 bg-warning/15' : 'border-primary/50 bg-primary/15');
  const body = (
    <>
      <p className="text-sm font-black tracking-tight">{title}</p>
      <p className="text-xs font-semibold leading-snug">{line}</p>
    </>
  );
  return (
    <>
      {onTap
        ? <button ref={setBannerEl} type="button" onClick={() => { if (isNight) setBurst(b => b + 1); onTap(); }} className={cls} data-testid="premium-hours">{body}</button>
        : <div ref={setBannerEl} className={cls} data-testid="premium-hours" onClick={isNight ? () => setBurst(b => b + 1) : undefined}>{body}</div>}
      {isNight && <NightBurst from={bannerEl} burst={burst} />}
    </>
  );
}

/** The small one: on a card, or a day in a list. */
function PremiumTag({ day, pays }: Pick<PremiumDay, 'day' | 'pays'>) {
  return (
    <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px] text-mono font-black', premiumClass({ day }))}>
      {pays >= 2 ? '🤑' : pays > 1 ? '💰' : '🔥'} {ordinal(day)} day{pays > 1 ? ` · ${pays}×` : ''}
    </span>
  );
}

/** How a payment came in, as the money icon it is shown with. */
function paymentIcon(i: Income): { Icon: typeof Wallet; label: string } {
  if (i.enteredByHand) return { Icon: PenLine, label: 'Added by hand' };
  if (i.paymentMethod === 'check' || /\b(check|cheque)\b/i.test(i.description ?? '')) return { Icon: Banknote, label: 'Check' };
  if (/stub/i.test(i.description ?? '')) return { Icon: Receipt, label: 'Pay stub' };
  return { Icon: Wallet, label: 'Payment' };
}

/**
 * Payments that are the same one recorded more than once: the same amount, on
 * the same day, the same way. Each group keeps its first; the rest are repeats.
 */
/** Days as short runs: "Nov 8–9", "Nov 8–9, 20–21", "Oct 30 – Nov 2". A date that isn't one is left out. */
function dayRuns(dates: string[]): string {
  const days = [...new Set(dates)].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(parseISO(d).getTime())).sort();
  const runs: [string, string][] = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    if (last && differenceInCalendarDays(parseISO(d), parseISO(last[1])) === 1) last[1] = d;
    else runs.push([d, d]);
  }
  let month = '';
  return runs.map(([a, b]) => {
    // The month once, until it changes: "Nov 8–9, 20–21".
    const from = format(parseISO(a), a.slice(0, 7) === month ? 'd' : 'MMM d');
    month = b.slice(0, 7);
    if (a === b) return from;
    return a.slice(0, 7) === b.slice(0, 7) ? `${from}–${format(parseISO(b), 'd')}` : `${from} – ${format(parseISO(b), 'MMM d')}`;
  }).join(', ');
}

function samePaymentGroups(payments: Income[]): { first: Income; repeats: Income[] }[] {
  const groups = new Map<string, { first: Income; repeats: Income[] }>();
  for (const i of payments) {
    const key = [i.amount.toFixed(2), i.date, i.description ?? '', i.enteredByHand ? 'hand' : '', i.paymentMethod ?? ''].join('|');
    const g = groups.get(key);
    if (g) g.repeats.push(i);
    else groups.set(key, { first: i, repeats: [] });
  }
  return [...groups.values()];
}

/** A payment's icon, drawn the same way everywhere it appears. */
function PayIcon({ income, className }: { income: Income; className?: string }) {
  const { Icon, label } = paymentIcon(income);
  return <Icon size={12} aria-label={label} className={cn('shrink-0', className)} />;
}

/** A payment's icon that opens its proof: the stub, check or deposit itself. */
function PayIconButton({ income, className }: { income: Income; className?: string }) {
  const [open, setOpen] = useState(false);
  const { label } = paymentIcon(income);
  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); setOpen(true); }} aria-label={`See the proof: ${label}`} data-testid="pay-icon"
        className="-m-1 shrink-0 p-1 active:opacity-70">
        <PayIcon income={income} className={className} />
      </button>
      <ProofOpen income={income} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function StubMark({ job, paidByHand, openProof = false }: { job: Job; paidByHand?: boolean; openProof?: boolean }) {
  const { data } = useData();
  const [open, setOpen] = useState(false);
  // The payment this mark is about: the one with this photo, else one paid on this shift.
  const payment = openProof
    ? (job.payStub ? data.income.find(i => i.proofRef === job.payStub) : undefined)
      ?? data.income.find(i => i.jobId === job.id && i.status === 'paid' && !!i.proofRef)
      ?? data.income.find(i => i.jobId === job.id && i.status === 'paid')
    : undefined;
  const mark = job.payStub
    ? job.payStubKind === 'check'
      ? { Icon: Banknote, label: 'Cheque photographed' }
      : { Icon: Receipt, label: 'Pay stub photographed' }
    : paidByHand
      ? { Icon: PenLine, label: 'Marked paid by hand — nothing checked against a document' }
      : null;

  // Nothing logged gets no mark at all. A greyed-out stub was the same picture
  // as a real stub, which made "nothing here" and "a stub is here" look alike
  // at six pixels — the one thing the mark exists to tell apart.
  if (!mark) return null;
  if (!payment) return <mark.Icon size={12} aria-label={mark.label} className="shrink-0 text-muted-foreground" />;
  return (
    <>
      <button type="button" onClick={e => { e.stopPropagation(); setOpen(true); }} aria-label={`${mark.label}: see the proof`} data-testid="stub-mark"
        className="-m-1 shrink-0 p-1 text-muted-foreground active:opacity-70">
        <mark.Icon size={12} aria-hidden />
      </button>
      <ProofOpen income={payment} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function calcHours(start: string, end: string): number {
  const s = parseTimeToMins(start);
  if (isNaN(s)) return 0;
  let e = resolveEndMins(s, end);
  if (isNaN(e)) return 0;
  // The end at the start's own time is a placeholder, not 24 hours: see sameClockTime.
  if (e === s) return 0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

function minutesToTimeStr(totalMins: number): string {
  const m = ((Math.round(totalMins) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min.toString().padStart(2, '0')} ${ap}`;
}

// Reverse of calcHours — given a start time and a worked-hours count, derives
// the clock end time (e.g. "9:00 AM" + 5 -> "2:00 PM").
function addHoursToTime(start: string, hours: number): string {
  const s = parseTimeToMins(start);
  if (isNaN(s) || !isFinite(hours) || hours <= 0) return '';
  return minutesToTimeStr(s + hours * 60);
}

/** A meal being filled in: how long it is isn't known until it's tapped. */
type MealEntry = { duration?: Job['mealDuration']; onClock: boolean };

const MEAL_LENGTHS = [{ value: 0, label: 'MP' }, { value: 30, label: '30m' }, { value: 45, label: '45m' }, { value: 60, label: '1hr' }] as const;

/** One meal: how long, and whether it stayed on the clock. Tapping the length again clears it. */
function MealChoice({ duration, onClock, onDuration, onOnClock }: {
  duration: Job['mealDuration'];
  onClock: boolean;
  onDuration: (value: Job['mealDuration']) => void;
  onOnClock: (value: boolean) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-4 gap-1.5">
        {MEAL_LENGTHS.map(({ value, label }) => {
          const active = duration === value;
          return (
            <button key={label} type="button" onClick={() => onDuration(active ? undefined : value)} className={cn("rounded-md border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
              <p className={cn("text-sm font-bold text-mono", active && "text-primary")}>{label}</p>
            </button>
          );
        })}
      </div>
      {duration !== undefined && duration > 0 && (
        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          {[{ value: true, label: 'On the clock', sub: 'paid, no deduction' }, { value: false, label: 'Off the clock', sub: `${duration}min deducted` }].map(({ value, label, sub }) => {
            const active = onClock === value;
            return (
              <button key={label} type="button" onClick={() => onOnClock(value)} className={cn("rounded-md border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                <p className={cn("text-xs font-bold", active && "text-primary")}>{label}</p>
                <p className="text-[9px] leading-tight mt-0.5 opacity-70">{sub}</p>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** A pay period's dates, without saying the month twice. */
function periodDates({ start, end }: PayPeriod): string {
  const from = parseISO(start);
  const to = parseISO(end);
  return `${format(from, 'MMM d')} – ${format(to, from.getMonth() === to.getMonth() ? 'd' : 'MMM d')}`;
}

// ── Job detail view ───────────────────────────────────────────────────────────

function JobDetailView({ job, onBack, onSave, onDuplicated, onDelete, openStubOnMount, onStubOpened }: {
  job: Job;
  onBack: () => void;
  onSave: (updates: Partial<Job>) => void;
  onDuplicated: (count: number) => void;
  onDelete: () => void;
  /** Opened by the stub button on a shift row — go straight to the camera. */
  openStubOnMount?: boolean;
  onStubOpened?: () => void;
}) {
  const { data, addJob, updateJob: updateJobDirect, updateIncome, updateEmployer, addIncome, deleteIncome, restoreIncome } = useData();
  const { prefs } = useUserPrefs();
  const { user } = useAuth();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [client, setClient] = useState(job.client ?? '');
  const [startTime, setStartTime] = useState(job.startTime ?? '');
  const [endTime, setEndTime] = useState(job.endTime ?? '');
  const [hoursWorked, setHoursWorked] = useState(job.hoursWorked?.toString() ?? '');
  const [hourlyRate, setHourlyRate] = useState(job.hourlyRate?.toString() ?? '');
  const [minimumHours, setMinimumHours] = useState(job.minimumHours?.toString() ?? '');
  const [payrollCompany, setPayrollCompany] = useState(job.payrollCompany ?? '');
  const [contractName, setContractName] = useState(shiftContract(job) ?? '');
  const [mealDuration, setMealDuration] = useState<Job['mealDuration']>(job.mealDuration ?? undefined);
  const [mealOnClock, setMealOnClock] = useState(job.mealOnClock ?? false);
  const [meal2Duration, setMeal2Duration] = useState<Job['meal2Duration']>(job.meal2Duration ?? undefined);
  const [meal2OnClock, setMeal2OnClock] = useState(job.meal2OnClock ?? false);
  // A second meal is opt-in: most days have one. Shown when the saved shift
  // already has one, so an existing second meal is never hidden.
  const [secondMealOpen, setSecondMealOpen] = useState(job.meal2Duration !== undefined || !!job.extraMeals?.length);
  // Past the second. A long day has them, so there's no limit to how many.
  const [extraMeals, setExtraMeals] = useState<MealEntry[]>(job.extraMeals ?? []);
  // A day of several calls, typed as it arrives: "8-10, 11-3, 4-7". The gaps
  // between the calls are the meals, so nothing about them is entered twice.
  const [callTimeline, setCallTimeline] = useState(job.callTimeline ?? '');
  const [gapsOnClock, setGapsOnClock] = useState<boolean[]>(job.callGapsOnClock ?? []);
  const [callsOpen, setCallsOpen] = useState(!!job.callTimeline);
  // The one box the hours are typed into: "8a-9p", or calls "8-12, 1-6, 7-9p".
  const [hoursText, setHoursText] = useState(() => hoursTextOf(job));
  // The start time the shift came with (from the offer) settles am or pm for a
  // bare number: on a 10pm call "10-2" is 10pm to 2am.
  const anchorMins = job.startTime ? parseTimeToMins(job.startTime) : NaN;
  const anchor = Number.isFinite(anchorMins) ? anchorMins : undefined;
  const [needsReview, setNeedsReview] = useState(job.needsReview ?? false);
  const [compositeTeam, setCompositeTeam] = useState(job.compositeTeam ?? false);
  // Changing an employer on one shift usually means it was wrong on the whole
  // run, so the rest of the project is offered rather than left behind.
  const [relabelProject, setRelabelProject] = useState(true);
  const [mealPenalties, setMealPenalties] = useState(job.mealPenalties?.toString() ?? '');
  // Opt-in like a second meal: most days have none. A shift that has one
  // always shows it, so a penalty is never hidden.
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [nightPremiumConfirmed, setNightPremiumConfirmed] = useState(job.nightPremiumConfirmed ?? true);
  const [nightPremiumActualHours, setNightPremiumActualHours] = useState(job.nightPremiumActualHours?.toString() ?? '');
  const [payStub, setPayStub] = useState(job.payStub ?? '');
  const [stubParsed, setStubParsed] = useState(job.stubParsed);
  // The picked photo, held while it is cropped and blacked out.
  const [editingStub, setEditingStub] = useState<string | null>(null);
  const [pendingStubKind, setPendingStubKind] = useState<'stub' | 'check'>('stub');
  // Add pay: how a payment for this shift gets in — typed, or read off a stub
  // or a check — and then matched against the shift's project, with the
  // reasons, before anything is saved.
  const [payOpen, setPayOpen] = useState(false);
  const [payMode, setPayMode] = useState<'manual' | null>(null);
  const [payFound, setPayFound] = useState<{ kind: 'stub' | 'check'; payment: FoundPayment } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(localToday());
  const [payMethod, setPayMethod] = useState<Income['paymentMethod']>('direct_deposit');
  const [payRain, setPayRain] = useState(false);
  // Payments taken off while this shift is open, ready to put back. Shown in
  // the panel: a toast's Undo cannot be tapped behind an open shift.
  const [removedPays, setRemovedPays] = useState<Income[][]>([]);

  const [editingEmployer, setEditingEmployer] = useState(false);
  const [proofFor, setProofFor] = useState<Income | null>(null);
  const [showProjectPays, setShowProjectPays] = useState(false);
  const [parsingStub, setParsingStub] = useState(false);
  const [viewingStub, setViewingStub] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  // Which call times the new days get: none while a run is unconfirmed, the
  // start alone when only the call is known, or both when the days repeat.
  const [dupTimes, setDupTimes] = useState<'none' | 'start' | 'both'>('none');
  const [dupDates, setDupDates] = useState<string[]>([]);
  // The days on offer: the shift's own week and the two after it, and more
  // on asking, since a conference can run longer than that.
  const [dupWeeks, setDupWeeks] = useState(3);
  const stubInputRef = useRef<HTMLInputElement>(null);
  // Arriving from a row's stub button means the camera is the only thing
  // wanted, so skip the step of finding the control in the form.
  useEffect(() => {
    if (!openStubOnMount) return;
    onStubOpened?.();
    const t = setTimeout(() => stubInputRef.current?.click(), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStubOnMount]);

  const resetFieldsFromJob = () => {
    setClient(job.client ?? '');
    setStartTime(job.startTime ?? '');
    setEndTime(job.endTime ?? '');
    // Older/imported shifts can have both times but never got hoursWorked
    // computed (only happened when someone retyped End Time by hand) — derive
    // it here too so reopening one shows the right hours instead of 0.
    const derivedHours = (!job.hoursWorked && job.startTime && job.endTime) ? calcHours(job.startTime, job.endTime) : 0;
    setHoursWorked(job.hoursWorked?.toString() ?? (derivedHours > 0 ? String(roundHours(derivedHours)) : ''));
    setHourlyRate(job.hourlyRate?.toString() ?? '');
    setMinimumHours(job.minimumHours?.toString() ?? '');
    setPayrollCompany(job.payrollCompany ?? '');
    setContractName(shiftContract(job) ?? '');
    setMealDuration(job.mealDuration ?? undefined);
    setMeal2Duration(job.meal2Duration ?? undefined);
    setMeal2OnClock(job.meal2OnClock ?? false);
    setSecondMealOpen(job.meal2Duration !== undefined || !!job.extraMeals?.length);
    setPenaltyOpen(false);
    setExtraMeals(job.extraMeals ?? []);
    setCallTimeline(job.callTimeline ?? '');
    setGapsOnClock(job.callGapsOnClock ?? []);
    setCallsOpen(!!job.callTimeline);
    setHoursText(hoursTextOf(job));
    setNeedsReview(job.needsReview ?? false);
    setCompositeTeam(job.compositeTeam ?? false);
    setMealOnClock(job.mealOnClock ?? false);
    setMealPenalties(job.mealPenalties?.toString() ?? '');
    setNightPremiumConfirmed(job.nightPremiumConfirmed ?? true);
    setNightPremiumActualHours(job.nightPremiumActualHours?.toString() ?? '');
    setPayStub(job.payStub ?? '');
    setStubParsed(job.stubParsed);
    setDuplicating(false);
    setDupDates([]);
    setDupWeeks(3);
  };

  useEffect(() => {
    resetFieldsFromJob();
    setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  const handleCancelEdit = () => {
    resetFieldsFromJob();
    setEditing(false);
  };

  const ingestStub = async (file: File) => {
    const isImage = file.type.startsWith('image/');
    // PDFs can't be downscaled here, so they go into storage at full size —
    // and storage is a single ~5MB budget shared with every other record.
    if (!isImage && file.size > 1024 * 1024) {
      toast.error('PDF too large (max 1MB) — take a photo of the stub instead, those get compressed automatically');
      return;
    }

    setParsingStub(true);
    try {
      // Phone photos are 3-8MB raw; compressing here is what keeps a stub from
      // consuming the entire localStorage budget on its own.
      let dataUrl: string;
      try {
        dataUrl = isImage ? await resizeImageForStorage(file) : await readFileAsDataUrl(file);
      } catch {
        dataUrl = await readFileAsDataUrl(file);
      }
      setPayStub(dataUrl);

      // Signed in, the image goes to object storage and the job keeps a
      // reference — a stub costs ~330KB inline, against a ~5MB budget shared
      // with the whole ledger. A failed upload falls back to inline rather
      // than losing the stub.
      const stored = user ? await uploadStub(dataUrl, user.id, job.id) : null;
      const stubValue = stored ?? dataUrl;
      if (stored) setPayStub(stored);

      // Parsing only runs for actual images (PDFs aren't something the vision
      // model can read reliably here).
      if (!isImage) {
        await updateJobDirect(job.id, { payStub: stubValue, payStubKind: pendingStubKind });
        return;
      }

      // Two readings at once: the payment itself — amount, date, payer, the
      // days it lists hours for — which is what gets matched and recorded, and
      // for a stub the full breakdown it is checked against. A check has no
      // breakdown to read.
      const read = (type: 'paystub' | 'income') => aiFetch(`${supabaseUrl}/functions/v1/parse-statement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ imageBase64: dataUrl.split(',')[1], mimeType: 'image/jpeg', type }),
      }).then(async r => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error || 'Could not read it'))));
      const kind = pendingStubKind;
      const [stubRead, paymentRead] = await Promise.allSettled([
        kind === 'stub' ? read('paystub') : Promise.resolve(null),
        read('income'),
      ]);
      const paystub = stubRead.status === 'fulfilled' ? stubRead.value?.paystub : undefined;
      if (paystub) setStubParsed(paystub);
      await updateJobDirect(job.id, { payStub: stubValue, payStubKind: kind, ...(paystub ? { stubParsed: paystub } : {}) });

      const txn = paymentRead.status === 'fulfilled' ? paymentRead.value?.transactions?.[0] : undefined;
      const amount = Math.abs(Number(txn?.amount ?? paystub?.netPay ?? 0));
      if (amount > 0) {
        setPayFound({
          kind,
          payment: {
            amount,
            date: txn?.date ?? paystub?.payPeriodEnd ?? localToday(),
            payer: txn?.client ?? paystub?.employer,
            hoursOn: (txn?.breakdown ?? paystub?.hoursBreakdown ?? []).map((b: { date: string }) => b.date),
          },
        });
        setPayAmount(amount.toFixed(2));
        setPayDate(txn?.date ?? paystub?.payPeriodEnd ?? localToday());
      } else {
        // Kept as an attachment either way; there was just no amount to record.
        toast.error(kind === 'check' ? 'Could not read an amount off the check — add it by hand' : 'Could not read the net pay — add it by hand');
        setPayMode('manual');
      }
    } finally {
      setParsingStub(false);
    }
  };

  const handleStubUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (stubInputRef.current) stubInputRef.current.value = '';
    if (!file) return;

    // A photo goes to the editor first, so anything that should not leave the
    // phone is painted out before the upload or the vision model sees it. A
    // PDF has nothing to crop, so it carries on.
    if (file.type.startsWith('image/')) {
      const raw = await readFileAsDataUrl(file);
      setEditingStub(raw);
      return;
    }
    await ingestStub(file);
  };

  const handleDelete = () => setConfirmingDelete(true);

  const paidIncomeForJob = data.income.filter(i => i.jobId === job.id && i.status === 'paid');

  // A payment usually covers the whole project, and may have been recorded
  // against any of its days, so the project is what pay is matched against
  // and what its payments are listed for.
  const project = useMemo(() => projectOf(job, data.jobs, data.employers), [job, data.jobs, data.employers]);
  // Money in, and money on its way: a pay stub says what is coming, it is
  // not the money — so it waits here, marked as such, until the money lands.
  const projectPayments = useMemo(() => {
    const ids = new Set(project.map(j => j.id));
    return data.income.filter(i => i.jobId && ids.has(i.jobId) && (i.status === 'paid' || i.status === 'pending'))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [project, data.income]);
  const paidIds = useMemo(() => paidShiftIds(data.jobs, data.income, data.employers, prefs.payer), [data.jobs, data.income, data.employers, prefs.payer]);
  const matchCtx = useMemo(() => ({
    allJobs: data.jobs,
    employers: data.employers,
    payer: prefs.payer,
    paidJobIds: paidIds,
  }), [data.jobs, data.employers, prefs.payer, paidIds]);
  // Pay lands a period at a time, so a project split across pay periods is
  // matched a piece at a time: this shift's piece, or the next one unpaid.
  const payPiece = useMemo(() => {
    const { periods } = projectPeriods(project, resolveEmployer(job.client, data.employers), data.jobs);
    if (periods.length < 2) return project;
    const unpaid = (p: ProjectPeriod) => p.jobs.some(j => effectiveHoursWorked(j) > 0 && !paidIds.has(j.id));
    const own = periods.find(p => p.jobs.some(j => j.id === job.id));
    return ((own && unpaid(own) ? own : periods.find(unpaid) ?? own)?.jobs) ?? project;
  }, [project, job.id, job.client, data.jobs, data.employers, paidIds]);
  const pendingPayment: FoundPayment | null = (payFound || payMode === 'manual') && parseFloat(payAmount) > 0
    ? { ...(payFound?.payment ?? {}), amount: parseFloat(payAmount), date: payDate }
    : null;
  const payMatch = pendingPayment ? matchPaymentToProject(pendingPayment, payPiece, matchCtx) : null;
  const payElsewhere = pendingPayment && payFound ? betterProject(pendingPayment, job, matchCtx) : null;
  const payDuplicate = pendingPayment ? alreadyRecorded({ ...pendingPayment, client: pendingPayment.payer }, data.income) : undefined;
  const showPay = payOpen || !!editingStub || parsingStub || !!payFound || payMode !== null;

  const closePay = () => { setPayOpen(false); setPayMode(null); setPayFound(null); setPayAmount(''); setEditingStub(null); };
  const startPayPhoto = (kind: 'stub' | 'check') => {
    setPendingStubKind(kind);
    setPayMode(null);
    setPayFound(null);
    stubInputRef.current?.click();
  };
  const startManualPay = () => {
    setPayFound(null);
    setPayMode('manual');
    setPayDate(localToday());
    // What the project's unpaid days were expected to pay, as a starting point.
    const expected = matchPaymentToProject({ amount: 0, date: localToday() }, payPiece, matchCtx).expected;
    setPayAmount(expected > 0 ? expected.toFixed(2) : '');
  };
  const savePayment = async (target: Job) => {
    const amount = parseFloat(payAmount);
    if (!(amount > 0)) { toast.error('Enter the amount'); return; }
    const kind = payFound?.kind;
    // The proof goes with it: the photo, what the photo said, and every
    // reason it was matched to the project it was saved on.
    const match = payElsewhere && target.id !== job.id ? payElsewhere.match : payMatch;
    const proofKind: ProofKind = kind === 'stub' ? 'stub' : kind === 'check' ? 'check' : 'manual';
    await addIncome({
      jobId: target.id,
      client: target.client,
      description: kind === 'stub' ? 'Pay stub' : kind === 'check' ? 'Check' : 'Added by hand',
      amount,
      date: payDate,
      status: kind === 'stub' ? 'pending' : 'paid',
      paymentMethod: kind === 'check' ? 'check' : kind ? undefined : payMethod,
      enteredByHand: kind ? undefined : true,
      proofRef: kind && isStoredRef(payStub) ? payStub : undefined,
      matchProof: proofFromMatch(proofKind, match, payFound ? { amount: payFound.payment.amount, payer: payFound.payment.payer, date: payFound.payment.date } : undefined),
    });
    if (kind === 'stub') {
      toast.success(`Stub in — $${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on its way for ${target.name}. Tap Money in when it lands.`);
    } else {
      toast.success(`$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} recorded for ${target.name}`);
      setPayRain(true);
      setTimeout(() => setPayRain(false), 2100);
    }
    closePay();
  };

  const employer = resolveEmployer(client, data.employers);
  const employerRoles = employer?.roles ?? [];
  const ptoHere = !!employer?.ptoEarnHours;
  const ptoBank = employer && ptoHere ? ptoBalance(employer, data.jobs) : null;

  // Picking a role sets the shift's rate from it. The form's rate box is set
  // too, or saving the form afterwards would put the old rate back.
  const pickRole = async (name: string) => {
    const role = employerRoles.find(r => r.name === name);
    const updates: Partial<Job> = { role: name || undefined };
    if (role?.hourlyRate) { updates.hourlyRate = role.hourlyRate; setHourlyRate(role.hourlyRate.toString()); }
    if (role?.dayRate) updates.dayRate = role.dayRate;
    await updateJobDirect(job.id, updates);
    if (role && (role.hourlyRate || role.dayRate)) toast.success(`${role.name} — rate set`);
  };
  // Night hours stop where this call's contract says premium hours do.
  const nightEnd = nightWindowEnd(job, employer, prefs.payer);
  const rawNightHours = ((employer?.nightPremiumEnabled ?? true) && startTime && endTime && nightEnd !== null)
    ? calculateNightHours(startTime, endTime, employer?.nightPremiumStartHour ?? 0, nightEnd)
    : 0;
  const parsedNightActualHours = nightPremiumActualHours.trim() === '' ? undefined : parseFloat(nightPremiumActualHours);
  const validNightActualHours = parsedNightActualHours !== undefined && !isNaN(parsedNightActualHours)
    ? Math.max(0, Math.min(parsedNightActualHours, rawNightHours))
    : undefined;
  const nightHours = resolveConfirmedNightHours(rawNightHours, nightPremiumConfirmed, nightPremiumConfirmed ? undefined : validNightActualHours);

  const handleDuplicate = async () => {
    const dates = [...new Set(dupDates.filter(Boolean))].filter(d => d !== job.date);
    if (dates.length === 0) { toast.error('Pick at least one date'); return; }
    for (const date of dates) {
      await addJob({
        // The job number keeps the copies in the same project — without it
        // they split off from it, and from its pay row.
        jobNumber: job.jobNumber,
        name: job.name,
        client: job.client,
        venue: job.venue,
        local: job.local,
        date,
        // No hoursWorked, and no times unless asked for. A duplicate is the
        // same booking on another day — the hours it was worked belong to the
        // day it was worked, and carrying them over means every copy arrives
        // pre-filled with hours nobody has done yet. The call times are a
        // choice: the same call on each day is common.
        startTime: dupTimes !== 'none' ? job.startTime : undefined,
        endTime: dupTimes === 'both' ? job.endTime : undefined,
        // A day already gone, with its times, is a record of work done.
        status: dupTimes === 'both' && job.startTime && job.endTime && date < localToday() ? 'completed' : 'upcoming',
        dayRate: job.dayRate,
        dayRateHours: job.dayRateHours,
        paySchedule: job.paySchedule,
        payrollCompany: job.payrollCompany,
        contract: job.contract,
        hourlyRate: job.hourlyRate,
        minimumHours: job.minimumHours,
        has6th7thDayRule: job.has6th7thDayRule,
        compositeTeam: job.compositeTeam,
        steward: job.steward,
        mealDuration: job.mealDuration,
        mealOnClock: job.mealOnClock,
        meal2Duration: job.meal2Duration,
        meal2OnClock: job.meal2OnClock,
        extraMeals: job.extraMeals,
        nightPremiumConfirmed: job.nightPremiumConfirmed,
        notes: job.notes,
      });
    }
    onDuplicated(dates.length);
  };

  /**
   * The hours box, read as it's typed. One call fills in the start, end and
   * clocked hours, as the two time boxes did. Several are a day of calls, kept
   * written out with am and pm, so they read the same later with no start time
   * to go by. Something it can't read yet leaves the last good reading alone.
   */
  const handleHoursText = (text: string) => {
    setHoursText(text);
    if (!text.trim()) {
      setEndTime(''); setCallTimeline(''); setCallsOpen(false);
      return;
    }
    const read = parseDayTimeline(text, [], undefined, job.date, anchor);
    if (!read) {
      if (START_ONLY.test(text)) {
        setStartTime(normalizeTyped(text.replace(/-\s*$/, '').trim()));
        setEndTime(''); setCallTimeline(''); setCallsOpen(false);
      }
      return;
    }
    const first = read.calls[0];
    const last = read.calls[read.calls.length - 1];
    setStartTime(first.start);
    setEndTime(last.end);
    if (read.calls.length === 1) {
      setCallTimeline(''); setCallsOpen(false);
      setHoursWorked(String(roundHours(first.hours)));
    } else {
      setCallTimeline(explicitCalls(read)); setCallsOpen(true);
    }
  };
  const hoursTextReads = !hoursText.trim() || START_ONLY.test(hoursText) || !!parseDayTimeline(hoursText, [], undefined, job.date, anchor);

  const handleHoursWorkedChange = (val: string) => {
    setHoursWorked(val);
    const h = parseFloat(val);
    if (startTime && !isNaN(h) && h > 0 && !callsOpen) {
      const end = addHoursToTime(startTime, h);
      setEndTime(end);
      setHoursText(callText(startTime, end));
    }
  };

  const handleMinimumClick = (hours: number) => {
    const isActive = minimumHours === hours.toString();
    setMinimumHours(isActive ? '' : hours.toString());
    // Only used as a convenience default when hours worked hasn't been
    // entered yet — never overwrites real logged/derived hours, since a
    // minimum call and actual hours worked are frequently different numbers.
    if (!isActive && !hoursWorked) {
      setHoursWorked(hours.toString());
      if (startTime && !endTime) {
        const end = addHoursToTime(startTime, hours);
        setEndTime(end);
        setHoursText(callText(startTime, end));
      }
    }
  };

  // Everything below reads the timeline, so it has to be built first — reading a
  // const above its own declaration is a dead zone, not a hoist, and it took the
  // whole page down with "Cannot access 'timeline' before initialization".
  const penaltyAfter = compositeTeam ? COMPOSITE_LUNCH_AFTER_HOURS : MEAL_PENALTY_AFTER_HOURS;
  const timeline: DayTimeline | null = callsOpen && callTimeline.trim()
    ? parseDayTimeline(callTimeline, gapsOnClock, penaltyAfter, job.date, anchor)
    : null;
  // What the day you typed turns out to be decides how the meals are shown:
  // nothing to show for a straight call, the boxed buttons for a single lunch
  // because four boxes beat a row, and the compact rows once there are several.
  const timelineGaps = timeline?.gaps.length ?? 0;
  const mealsFromTimeline = timelineGaps > 0;
  const oneMealFromTimeline = timelineGaps === 1 ? timeline.gaps[0] : null;
  const setOnlyGapOnClock = (on: boolean) => {
    if (timeline) setGapsOnClock(withGapOnClock(timeline, 0, on).gaps.map(g => g.onClock));
  };

  // The clocked figure for a multi-call day is the whole spread, first in to last
  // out; the gaps come off it below, exactly as a single meal does.
  const actualHours = timeline ? timeline.spreadHours : (parseFloat(hoursWorked) || 0);
  const enteredHours = parseFloat(hoursWorked);
  const clockSpanHours = startTime && endTime ? calcHours(startTime, endTime) : 0;
  const hoursDifferFromClockSpan = !timeline && clockSpanHours > 0 && Number.isFinite(enteredHours)
    && Math.abs(enteredHours - clockSpanHours) > 0.01;
  // Nothing typed: the minimum the rules give it (a split side's, or 8 for a
  // head call), the same as the rest of the app uses.
  const splitToday = data.jobs.some(o => o.id !== job.id && o.date === job.date && o.client === job.client && !o.pto && o.status !== 'cancelled');
  const minHours = minimumHours.trim() !== ''
    ? (parseFloat(minimumHours) || 0)
    : splitToday ? splitSideMinimum({ ...job, minimumHours: undefined }, employer, prefs.payer) : callMinimum({ ...job, minimumHours: undefined }, employer);
  // Mirrors calculateDayPay: an off-the-clock meal comes out of the hours
  // before the minimum-call floor applies. Without this the on/off toggle
  // changed the pay but every hours figure on screen stayed put.
  const offClockMealMins = timeline
    ? timeline.offClockMinutes
    : ((mealDuration && !mealOnClock) ? mealDuration : 0) + ((meal2Duration && !meal2OnClock) ? meal2Duration : 0)
      + extraMeals.reduce((sum, m) => sum + (m.duration && !m.onClock ? m.duration : 0), 0);
  const mealDeductionHours = offClockMealMins / 60;
  // A composite call marked no meal (MP): every hour, or part of one, past the
  // four is a penalty, as on a run of calls. A lunch taken is taken at four.
  const unfedComposite = compositeTeam && !timeline && mealDuration === 0 && actualHours > COMPOSITE_LUNCH_AFTER_HOURS
    ? Math.ceil(actualHours - COMPOSITE_LUNCH_AFTER_HOURS)
    : 0;
  const paidHours = Math.max(0, actualHours - mealDeductionHours);
  const billableHours = Math.max(paidHours, minHours);
  const minimumApplied = minHours > 0 && paidHours < minHours && paidHours > 0;
  const rate = parseFloat(hourlyRate) || 0;
  const mealPenaltyUnits = parseFloat(mealPenalties) || 0;
  // Dues, vacation and withholding from whoever owns each — the local, the
  // employer's W-4 — exactly as every other pay figure takes them.
  const previewRates = ratesForShift(job, employer, prefs.payer);
  const payPreview = rate > 0 && billableHours > 0
    ? calculateDayPay(actualHours, rate, minHours, mealPenaltyUnits, dayMultiplierFor({ ...job, compositeTeam }, employer, data.jobs), { duration: mealDuration, onClock: mealOnClock, offClockMinutesTotal: offClockMealMins }, {
      // The employer's own overtime terms, as every other pay figure uses
      // them. Left out, this preview fell back to daily OT after 8 for
      // everyone, so a weekly-overtime employer showed overtime it never pays.
      rule: employer?.overtimeRule ?? 'daily',
      otThresholdHours: employer?.dailyOvertimeThresholdHours,
      dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
      otMultiplier: employer?.overtimeMultiplier,
      dtMultiplier: employer?.doubletimeMultiplier,
      // A broken hour falls at the end of the call, so a call that ends in the
      // night pays its rounded part hour at the night rate, as jobPayBreakdown does.
      nightHours, nightLeftAtEnd: nightHours > 0 && startTime && endTime && nightEnd !== null ? nightLeftAtEnd(startTime, endTime, employer?.nightPremiumStartHour ?? 0, nightEnd) : 0,
      nightMultiplier: employer?.nightPremiumMultiplier, roundUpToWholeHours: breaksTheHour(job, employer), unionDuesPercent: previewRates.unionDuesPercent, estimatedTaxPercent: previewRates.estimatedTaxPercent, dayPremiumLabel: dayPremiumLabel({ ...job, compositeTeam }, employer, data.jobs),
      premiums: shiftPremiums({ ...job, startTime, endTime }, data.jobs, employer, prefs.payer),
    })
    : null;
  // calculateDayPay's own breakdown stops at dues/tax — vacation is applied
  // on top of that (same as jobGross/jobPayBreakdown), so it needs its own
  // line here or this "paperwork" total silently disagrees with the net
  // figure shown everywhere else in the app.
  const vacationPercent = previewRates.vacationPercent ?? 0;
  const vacationAmount = payPreview && vacationPercent > 0 ? payPreview.totalPay * (vacationPercent / 100) : 0;
  const payPreviewTotal = (payPreview?.totalPay ?? 0) + vacationAmount;
  // On a split day this call is one part of a day the calls share: priced
  // alone it would start the overtime ladder over, so it shows what the app
  // pays it everywhere else, with the times, hours and rate on the form.
  const splitCallPay = useMemo(() => {
    const live: Job = {
      ...job, startTime, endTime,
      hoursWorked: Number.isFinite(enteredHours) ? enteredHours : job.hoursWorked,
      hourlyRate: rate > 0 ? rate : job.hourlyRate,
    };
    const jobs = data.jobs.map(j => (j.id === job.id ? live : j));
    const calls = jobs.filter(o => o.date === job.date && (o.client ?? '') === (job.client ?? '') && !o.pto && effectiveHoursWorked(o) > 0);
    if (job.pto || calls.length < 2 || !calls.some(o => o.id === job.id)) return null;
    const pay = jobPayBreakdown(live, jobs, data.employers, prefs.payer);
    return pay.gross > 0 ? { gross: pay.gross, hours: jobHoursBreakdown(live, jobs, data.employers, prefs.payer) } : null;
  }, [job, startTime, endTime, enteredHours, rate, data.jobs, data.employers, prefs.payer]);

  const stubMatch = useMemo(
    () => (stubParsed ? matchStubToShifts(stubParsed, data.jobs) : null),
    [stubParsed, data.jobs],
  );

  const stubComparison = useMemo(
    () => (stubParsed && stubMatch ? compareStubToShifts(stubParsed, stubMatch.jobs, data.jobs, data.employers, prefs.payer) : null),
    [stubParsed, stubMatch, data.jobs, data.employers, prefs.payer],
  );
  const stubDisagreements = useMemo(() => (stubComparison ? disagreements(stubComparison) : []), [stubComparison]);

  const stubSuggestions = useMemo(
    () => (stubParsed ? learnFromStubs(data.jobs, data.employers) : []),
    [stubParsed, data.jobs, data.employers],
  );

  // The estimate beside what came in, and why they differ: for the payment
  // being added, for the stub on file, and for what the project has received.
  const worth = { allJobs: data.jobs, employers: data.employers, payer: prefs.payer };
  const payCovers = (() => {
    const worked = payFound?.kind === 'stub' && stubMatch?.jobs.length
      ? stubMatch.jobs
      : payPiece.filter(j => j.date <= localToday() && effectiveHoursWorked(j) > 0);
    const unpaid = worked.filter(j => !paidIds.has(j.id));
    return unpaid.length > 0 ? unpaid : worked;
  })();
  const payExplanation = pendingPayment
    ? explainPay({ ...worth, stub: payFound?.kind === 'stub' ? stubParsed : null, received: pendingPayment.amount, jobs: payCovers })
    : null;
  const stubExplanation = stubParsed && stubMatch ? explainPay({ ...worth, stub: stubParsed, jobs: stubMatch.jobs }) : null;
  // What this day is worth and whether it's been paid, and the project in a line.
  const payView: 'gross' | 'net' = prefs.calendarPay === 'gross' ? 'gross' : 'net';
  const moneyText = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dayPay = useMemo(() => {
    const worked = job.date <= localToday() && effectiveHoursWorked(job) > 0;
    const amount = worked ? jobPayBreakdown(job, data.jobs, data.employers, prefs.payer)[payView] : 0;
    const paidBy = projectPayments.find(i => i.status === 'paid'
      && shiftsPaidBy(i, data.jobs, data.income, data.employers, prefs.payer).some(j => j.id === job.id));
    return { worked, amount, paid: paidIds.has(job.id), paidBy };
  }, [job, data.jobs, data.income, data.employers, prefs.payer, payView, projectPayments, paidIds]);
  const projectEstimate = useMemo(
    () => project.reduce((sum, j) => sum + (j.date <= localToday() ? jobPayBreakdown(j, data.jobs, data.employers, prefs.payer)[payView] : 0), 0),
    [project, data.jobs, data.employers, prefs.payer, payView],
  );
  // Money that came in: a "Mark paid" tap is your word at the estimate, not money, so it's counted apart.
  const projectMoneyIn = samePaymentGroups(projectPayments.filter(i => i.status === 'paid' && proofKindOf(i) !== 'marked')).reduce((sum, g) => sum + g.first.amount, 0);
  const projectMarked = projectPayments.filter(i => proofKindOf(i) === 'marked').length;
  const wholeProjectHours = useMemo(
    () => (project.length > 1 ? projectHours(project, data.jobs, data.employers, prefs.payer, paidIds) : null),
    [project, data.jobs, data.employers, prefs.payer, paidIds],
  );
  const projectSpan = (() => {
    // Real days only: a stored "Aug 20" on one of the project's shifts used to
    // take the whole shift view down when it was opened.
    const real = project.map(j => j.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const dates = real.length > 0 ? real : [job.date];
    const first = showDay(dates[0]);
    const last = showDay(dates[dates.length - 1]);
    const days = new Set(dates).size;
    return `${first === last ? first : `${first} – ${last}`} · ${days} day${days === 1 ? '' : 's'}`;
  })();
  const moneyIn = samePaymentGroups(projectPayments.filter(i => i.status === 'paid'));
  const receivedVsEstimate = moneyIn.length > 0
    ? explainPay({ ...worth, received: moneyIn.reduce((sum, g) => sum + g.first.amount, 0), jobs: project.filter(j => paidIds.has(j.id)) })
    : null;

  // A stub is evidence of what was actually paid, so accepting a line records
  // the real figure and keeps the old one alongside it.
  const acceptStubValue = (field: NonNullable<Job['stubCorrections']>[number]['field'], was: number, now: number) => {
    const corrections = [
      ...(job.stubCorrections ?? []).filter(c => c.field !== field),
      { field, was, now, at: new Date().toISOString() },
    ];
    const updates: Partial<Job> = { stubCorrections: corrections };
    // Hours and rate are the job's own facts, so the correction is applied;
    // the deduction lines are employer settings and go through a suggestion.
    if (field === 'hours') { updates.hoursWorked = now; setHoursWorked(now.toString()); }
    if (field === 'rate') { updates.hourlyRate = now; setHourlyRate(now.toString()); }
    updateJobDirect(job.id, updates);
    toast.success(`Recorded ${field} as ${now}`);
  };

  const applySuggestion = async (s: Suggestion) => {
    await updateEmployer(s.employerId, {
      [s.field]: s.suggested,
      dismissedSuggestions: (data.employers.find(e => e.id === s.employerId)?.dismissedSuggestions ?? [])
        .filter(d => d.field !== s.field),
    });
    toast.success(`${s.label} set to ${s.suggested}% for ${s.employerName}`);
  };

  const dismissSuggestionFor = async (s: Suggestion) => {
    const employerRecord = data.employers.find(e => e.id === s.employerId);
    if (!employerRecord) return;
    await updateEmployer(s.employerId, { dismissedSuggestions: dismissSuggestion(employerRecord, s.field) });
    toast('Skipped — I\'ll ask again after the next stub');
  };

  // A meal added but never given a length isn't a meal yet.
  const extraMealsToSave = extraMeals.filter((m): m is NonNullable<Job['extraMeals']>[number] => m.duration !== undefined);
  const extraMealsChanged = JSON.stringify(extraMealsToSave) !== JSON.stringify(job.extraMeals ?? []);

  const employerChanged = client.trim() !== (job.client ?? '') && client.trim() !== '';
  const projectSiblings = employerChanged
    ? projectSiblingsToRelabel(job, job.client ?? '', data.jobs)
    : [];

  const handleSave = () => {
    const updates: Partial<Job> = {};
    // Clearing a field used to be ignored everywhere below: the guards all
    // asked "is there a value?" rather than "did it change?", so a wrong entry
    // could be deleted, saved, and come straight back.
    if (client.trim() !== (job.client ?? '')) updates.client = client.trim();
    if (startTime !== (job.startTime ?? '')) updates.startTime = startTime || undefined;
    if (endTime !== (job.endTime ?? '')) updates.endTime = endTime || undefined;
    const isFuture = job.date > localToday();
    if (hoursWorked !== (job.hoursWorked?.toString() ?? '')) {
      const entered = parseFloat(hoursWorked);
      updates.hoursWorked = entered > 0 ? entered : undefined;
      // Filling in hours ahead of the day does not make the shift completed —
      // it has not happened. It stays upcoming until the day arrives and the
      // shift is confirmed, which is what clears hoursPlanned.
      if (entered > 0 && !isFuture) updates.status = 'completed';
    }
    if (hourlyRate !== (job.hourlyRate?.toString() ?? '')) updates.hourlyRate = rate > 0 ? rate : undefined;
    if (minimumHours !== (job.minimumHours?.toString() ?? '')) {
      const parsedMin = parseFloat(minimumHours);
      updates.minimumHours = parsedMin > 0 ? parsedMin : undefined;
    }
    if (payrollCompany !== (job.payrollCompany ?? '')) updates.payrollCompany = payrollCompany.trim() || undefined;
    if (contractName !== (shiftContract(job) ?? '')) updates.contract = contractName.trim() || undefined;
    if (mealDuration !== (job.mealDuration ?? undefined)) updates.mealDuration = mealDuration;
    if (mealDuration && mealOnClock !== (job.mealOnClock ?? false)) updates.mealOnClock = mealOnClock;
    const timelineToSave = callsOpen && callTimeline.trim() ? callTimeline.trim() : undefined;
    if (timelineToSave !== (job.callTimeline ?? undefined)) updates.callTimeline = timelineToSave;
    if (timelineToSave && JSON.stringify(gapsOnClock) !== JSON.stringify(job.callGapsOnClock ?? [])) updates.callGapsOnClock = gapsOnClock;
    // The spread is what gets stored, so every reader outside this dialog sees a
    // clocked figure it already knows how to handle.
    if (timeline) {
      updates.hoursWorked = timeline.spreadHours;
      if (!isFuture) updates.status = 'completed';
    }
    if (needsReview !== (job.needsReview ?? false)) updates.needsReview = needsReview || undefined;
    if (compositeTeam !== (job.compositeTeam ?? false)) updates.compositeTeam = compositeTeam || undefined;
    // A reminder goes once what it asked for is done: hours on a shift made
    // from a payment, or the payroll company the app had assumed, changed.
    if (job.needsReview && needsReview) {
      const reason = reviewReason(job);
      if (reason.kind === 'payment' && (updates.hoursWorked ?? 0) > 0) updates.needsReview = undefined;
      if (reason.kind === 'payroll' && 'payrollCompany' in updates) updates.needsReview = undefined;
    }
    // Hours put in before the day are a plan. They stay one until the shift is
    // confirmed, so filling in a schedule early never turns itself into a
    // timesheet when the date rolls past.
    if (isFuture && (actualHours > 0 || timeline)) updates.hoursPlanned = true;
    // Saving hours on or after the day IS confirming them. Only the Confirm
    // button used to clear the flag, so editing a planned figure and pressing
    // Save — the obvious way to say "this is what I worked" — left it a plan:
    // the reminder stayed up, and the hours went on counting toward nothing.
    if (!isFuture && job.hoursPlanned && (actualHours > 0 || timeline)) updates.hoursPlanned = undefined;
    if (meal2Duration !== (job.meal2Duration ?? undefined)) updates.meal2Duration = meal2Duration;
    if (meal2Duration && meal2OnClock !== (job.meal2OnClock ?? false)) updates.meal2OnClock = meal2OnClock;
    if (extraMealsChanged) updates.extraMeals = extraMealsToSave.length > 0 ? extraMealsToSave : undefined;
    if (mealPenalties !== (job.mealPenalties?.toString() ?? '')) {
      const parsedPenalties = parseFloat(mealPenalties);
      updates.mealPenalties = parsedPenalties > 0 ? parsedPenalties : undefined;
    }
    if (rawNightHours > 0) {
      if (nightPremiumConfirmed !== (job.nightPremiumConfirmed ?? true)) updates.nightPremiumConfirmed = nightPremiumConfirmed;
      const nextActualHours = nightPremiumConfirmed ? undefined : validNightActualHours;
      if (nextActualHours !== (job.nightPremiumActualHours ?? undefined)) updates.nightPremiumActualHours = nextActualHours;
    }
    if (payStub !== (job.payStub ?? '')) updates.payStub = payStub || undefined;
    // The rest of the run, if it was offered and kept.
    if (employerChanged && relabelProject && projectSiblings.length > 0) {
      const next = client.trim();
      for (const sibling of projectSiblings) updateJobDirect(sibling.id, { client: next });
      toast.success('Employer updated on ' + (projectSiblings.length + 1) + ' shifts');
    }
    onSave(updates);
  };

  const nightActualHoursChanged = rawNightHours > 0 && !nightPremiumConfirmed &&
    validNightActualHours !== (job.nightPremiumActualHours ?? undefined);

  const hasChanges =
    client.trim() !== (job.client ?? '') ||
    startTime !== (job.startTime ?? '') ||
    endTime !== (job.endTime ?? '') ||
    hoursWorked !== (job.hoursWorked?.toString() ?? '') ||
    hourlyRate !== (job.hourlyRate?.toString() ?? '') ||
    minimumHours !== (job.minimumHours?.toString() ?? '') ||
    payrollCompany !== (job.payrollCompany ?? '') ||
    contractName !== (shiftContract(job) ?? '') ||
    mealDuration !== (job.mealDuration ?? undefined) ||
    (!!mealDuration && mealOnClock !== (job.mealOnClock ?? false)) ||
    (callsOpen && callTimeline.trim() ? callTimeline.trim() : undefined) !== (job.callTimeline ?? undefined) ||
    (!!callTimeline.trim() && JSON.stringify(gapsOnClock) !== JSON.stringify(job.callGapsOnClock ?? [])) ||
    needsReview !== (job.needsReview ?? false) ||
    compositeTeam !== (job.compositeTeam ?? false) ||
    meal2Duration !== (job.meal2Duration ?? undefined) ||
    (!!meal2Duration && meal2OnClock !== (job.meal2OnClock ?? false)) ||
    extraMealsChanged ||
    (mealPenalties !== (job.mealPenalties?.toString() ?? '')) ||
    (rawNightHours > 0 && nightPremiumConfirmed !== (job.nightPremiumConfirmed ?? true)) ||
    nightActualHoursChanged ||
    payStub !== (job.payStub ?? '');

  // What the stubs imply this employer's rates really are.
  const learnedFromStubs = stubSuggestions.length > 0 && (
    <div className="rounded-md border border-accent/30 bg-accent/5 p-3 space-y-2">
      <p className="text-[9px] text-mono font-bold tracking-widest uppercase text-accent/80">
        Learned from your stubs
      </p>
      {stubSuggestions.map(s => (
        <div key={s.field} className="space-y-1.5">
          <p className="text-[11px]">
            <span className="font-semibold">{s.label}</span> looks like{' '}
            <span className="text-mono text-success font-bold">{s.suggested}%</span>
            {s.current != null && <> , not <span className="text-mono line-through text-destructive">{s.current}%</span></>}
          </p>
          <p className="text-[10px] text-mono text-muted-foreground">
            {s.sampleCount === 1
              ? `From 1 stub (${s.evidence[0]}) — worth a look, not conclusive`
              : `${s.sampleCount} stubs agree (${s.evidence.join(', ')}) — strong signal`}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => applySuggestion(s)}
              className="flex-1 rounded-md border border-success/40 bg-success/10 text-success px-2 py-1 text-[10px] font-medium hover:bg-success/20 transition-colors"
            >
              Update to {s.suggested}%
            </button>
            <button
              type="button"
              onClick={() => dismissSuggestionFor(s)}
              className="rounded-md border border-border bg-secondary/20 text-muted-foreground px-2 py-1 text-[10px] hover:text-foreground transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <DialogHeader>
        {/* One toolbar row: back on the left, destructive and close on the
            right, all the same size on the same baseline. Previously back and
            delete sat in the title row while the close button was absolutely
            positioned 8px higher, so the three never lined up. */}
        {/* The date is what you look for first, so it's big and sits in the
            toolbar row, where there was only empty space between the buttons.
            Delete keeps a gap from close: side by side they were one slip apart. */}
        <div className="flex items-center gap-1 -mx-1.5 -mt-1.5">
          <button onClick={onBack} aria-label="Back" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-secondary">
            <ArrowLeft size={18} />
          </button>
          {/* Never cut off: the date is the one thing here that has to read
              whole. The year only shows when it isn't this year. */}
          <p className="min-w-0 flex-1 flex items-baseline gap-1.5" data-testid="shift-date">
            <span className="text-xl font-bold leading-none text-foreground whitespace-nowrap">{showDay(job.date, 'EEE, MMM d')}</span>
            {job.date.slice(0, 4) !== localToday().slice(0, 4) && (
              <span className="text-xs text-mono text-muted-foreground shrink-0">{job.date.slice(0, 4)}</span>
            )}
            {isCallback(job, data.jobs, data.employers) && <Phone size={13} className="self-center text-destructive shrink-0" aria-label="Callback" />}
          </p>
          <button onClick={handleDelete} aria-label="Delete shift" className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-2 rounded-lg hover:bg-destructive/10">
            <Trash2 size={18} />
          </button>
          <span className="w-5 shrink-0" />
          <DialogClose asChild>
            <button aria-label="Close" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-secondary">
              <X size={18} />
            </button>
          </DialogClose>
        </div>
        <div className="min-w-0 flex items-center gap-2">
          <DialogTitle className="min-w-0 flex-1 text-left text-mono text-sm leading-snug break-words">{job.name}</DialogTitle>
          <span className={cn("shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-mono uppercase tracking-wider border", isOverdueUpcoming(job) ? "bg-warning/20 text-warning border-warning/30" : statusColors[job.status])}>
            {isOverdueUpcoming(job) ? 'Needs Hours' : statusLabel[job.status]}
          </span>
        </div>
      </DialogHeader>
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              "{job.name}" on {showDay(job.date, 'MMM d, yyyy')} will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="space-y-4">
        {dayInARow(job, employer, data.jobs) >= 6 && (
          <PremiumDayBanner day={dayInARow(job, employer, data.jobs)} pays={dayMultiplierFor(job, employer, data.jobs)} who={job.client} onSetUp={() => setEditingEmployer(true)} />
        )}
        <PremiumHoursBanner job={{ ...job, startTime, endTime }} allJobs={data.jobs} employer={employer} payer={prefs.payer}
          onTap={() => document.querySelector('[data-testid=early-call]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />

        <MoneyRain active={payRain} />
        {proofFor && <PaymentProof income={proofFor} onClose={() => setProofFor(null)} />}
        {/* Pay, first thing: what has come in for this project, and the one
            way to add more — typed, or read off a stub or a check. */}
        <input ref={stubInputRef} id={`stub-input-${job.id}`} type="file" accept="image/*,.pdf" className="hidden" onChange={handleStubUpload} disabled={parsingStub} />
        {(job.date <= localToday() || projectPayments.length > 0 || removedPays.length > 0) && (
          <div className="pixel-panel p-3 space-y-2">
            {/* This day first: it's the day that was tapped. */}
            {dayPay.worked && (
              <div className="space-y-0.5" data-testid="this-day-pay">
                <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground">This day · {showDay(job.date, 'EEE, MMM d')}</p>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold text-mono">{moneyText(dayPay.amount)}</span>
                  <span className={cn('text-[11px] font-bold text-mono uppercase', dayPay.paid ? 'text-dot-paid' : 'text-dot-pending')}>
                    {dayPay.paid ? 'Paid' : 'Waiting on pay'}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Est. {prefs.calendarPay === 'gross' ? 'gross' : 'take-home'} for {Math.round(netHoursWorked(job) * 100) / 100}h working
                  {dayPay.paidBy ? (proofKindOf(dayPay.paidBy) === 'marked'
                    ? <> · marked paid by you, {showDay(dayPay.paidBy.date)}</>
                    : <> · {PROOF_LABELS[proofKindOf(dayPay.paidBy)].toLowerCase()} {moneyText(dayPay.paidBy.amount)}, {showDay(dayPay.paidBy.date)}</>) : null}
                </p>
              </div>
            )}

            {wholeProjectHours && (
              <ProjectHoursSummary hours={wholeProjectHours} title="Whole project hours" className="border-t border-border/50 pt-2" />
            )}

            {projectPayments.length > 0 && (
              <div className="space-y-1.5 border-t border-border/50 pt-2">
                {/* The project in one line; its payments fold away, so the day
                    stays the thing you're looking at. */}
                <button type="button" onClick={() => setShowProjectPays(v => !v)} className="flex w-full items-start gap-1.5 text-left" aria-expanded={showProjectPays}>
                  {showProjectPays ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] text-mono uppercase tracking-widest text-muted-foreground">
                      {project.length > 1 ? `Whole project · ${projectSpan}` : 'Payments'}
                    </span>
                    <span className="block text-xs">
                      <span className="text-dot-paid font-semibold">{moneyText(projectMoneyIn)} in</span>
                      {projectEstimate > 0 && <span className="text-muted-foreground"> of {moneyText(projectEstimate)} est.</span>}
                      <span className="text-muted-foreground"> · {projectPayments.length} payment{projectPayments.length === 1 ? '' : 's'}</span>
                      {projectMarked > 0 && <span className="text-muted-foreground"> · {projectMarked} marked paid by you</span>}
                    </span>
                  </span>
                </button>
                {showProjectPays && <WhoPaid employer={job.client} payer={[...new Set(projectPayments.map(i => i.client).filter(Boolean))].join(' / ')} />}
                {/* The same payment recorded more than once — the same amount, day
                    and way in — is shown once, with how many times, and the extras
                    can go in a tap. Old money-bag taps left runs of these behind. */}
                {showProjectPays && samePaymentGroups(projectPayments).map(({ first: i, repeats }) => {
                  return (
                    <div key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <SourceTag income={i} />
                      <span className={cn('font-bold text-mono', i.status === 'paid' ? 'text-dot-paid' : 'text-dot-pending')}>${i.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      <span className="text-muted-foreground text-mono">{showDay(i.date)}</span>
                      {i.status === 'pending' && (
                        <>
                          <span className="text-[10px] text-mono text-dot-pending">{/stub/i.test(i.description) ? 'stub · not in yet' : 'not in yet'}</span>
                          <button type="button" className="pixel-button pick-off px-1.5 py-0.5 text-[10px] font-bold"
                            onClick={() => { void updateIncome(i.id, { status: 'paid' }); for (const r of repeats) void updateIncome(r.id, { status: 'paid' }); }}>
                            Money in
                          </button>
                        </>
                      )}
                      {repeats.length > 0 && (
                        <button type="button" className="pixel-button pick-off px-1.5 py-0.5 text-[10px] font-bold text-warning"
                          title="The same payment recorded more than once"
                          onClick={() => { for (const r of repeats) void deleteIncome(r.id); setRemovedPays(prev => [repeats, ...prev]); }}>
                          ×{repeats.length + 1} · keep one
                        </button>
                      )}
                      <span className="flex-1" />
                      <button type="button" onClick={() => setProofFor(i)} className="text-[10px] text-mono text-muted-foreground underline hover:text-foreground">
                        Proof
                      </button>
                      {/* Undoable rather than confirmed: the exact payment
                          comes back, so a slip never means re-entering a check. */}
                      <button type="button" aria-label="Remove this payment" className="p-0.5 text-muted-foreground hover:text-destructive"
                        onClick={() => { void deleteIncome(i.id); setRemovedPays(prev => [[i], ...prev]); }}>
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
                {showProjectPays && receivedVsEstimate && receivedVsEstimate.verdict !== 'none' && (
                  <p className="text-[11px] text-mono text-muted-foreground" data-testid="received-vs-estimate">
                    Estimated ${receivedVsEstimate.lines[1].estimated.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {receivedVsEstimate.headline}
                  </p>
                )}
              </div>
            )}

            {removedPays.map(batch => (
              <div key={'removed-' + batch[0].id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex-1">
                  {batch.length > 1 ? `Removed ${batch.length} repeats of ` : 'Removed '}${batch[0].amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {format(new Date(batch[0].date + 'T12:00:00'), 'MMM d')}
                </span>
                <button type="button" className="pixel-button pick-off px-2 py-0.5 text-[11px] font-bold"
                  onClick={() => { for (const i of batch) void restoreIncome(i); setRemovedPays(prev => prev.filter(b => b !== batch)); }}>
                  Undo
                </button>
              </div>
            ))}

            {!showPay ? (
              job.date <= localToday() && (
                <button type="button" onClick={() => setPayOpen(true)} className="pixel-button pick-on w-full py-2 text-sm font-bold">
                  <span className="inline-flex items-center justify-center gap-1.5"><Plus size={15} /> Add pay</span>
                </button>
              )
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground">Add pay</p>
                  <button type="button" onClick={closePay} aria-label="Close add pay" className="p-1 text-muted-foreground hover:text-foreground"><X size={14} /></button>
                </div>

                {!payMode && !payFound && !editingStub && !parsingStub && (
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: 'manual', Icon: PenLine, label: 'Manual', go: startManualPay },
                      { id: 'stub', Icon: Receipt, label: 'Pay stub', go: () => startPayPhoto('stub') },
                      { id: 'check', Icon: Banknote, label: 'Check', go: () => startPayPhoto('check') },
                    ] as const).map(o => (
                      <button key={o.id} type="button" onClick={o.go} className="pixel-button pick-off flex flex-col items-center gap-1 py-2.5 text-[11px] font-bold">
                        <o.Icon size={18} aria-hidden />{o.label}
                      </button>
                    ))}
                  </div>
                )}

                {editingStub && (
                  <StubEditor
                    source={editingStub}
                    onCancel={() => setEditingStub(null)}
                    onDone={async (edited) => {
                      setEditingStub(null);
                      const res = await fetch(edited);
                      const blob = await res.blob();
                      // Named so the rest of the path can treat it as a picked photo.
                      await ingestStub(new File([blob], `stub-${job.id}.jpg`, { type: blob.type || 'image/jpeg' }));
                    }}
                  />
                )}

                {parsingStub && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Reading the {pendingStubKind === 'check' ? 'check' : 'pay stub'}…</p>
                )}

                {(payMode === 'manual' || payFound) && (
                  <div className="space-y-2">
                    {payFound && (
                      <p className="text-[11px] text-muted-foreground">
                        Read from the {payFound.kind === 'check' ? 'check' : 'stub'}
                        {payFound.payment.payer ? <> · paid by <span className="text-foreground font-medium">{payFound.payment.payer}</span></> : null}
                        {payFound.payment.hoursOn?.length ? <> · hours on {[...new Set(payFound.payment.hoursOn)].sort().map(d => format(new Date(d + 'T12:00:00'), 'MMM d')).join(', ')}</> : null}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10px] text-mono uppercase text-muted-foreground" htmlFor={`pay-amount-${job.id}`}>Amount</label>
                        <Input id={`pay-amount-${job.id}`} type="number" step="0.01" inputMode="decimal" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="h-9 text-sm text-mono" placeholder="0.00" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-mono uppercase text-muted-foreground" htmlFor={`pay-date-${job.id}`}>Paid on</label>
                        <Input id={`pay-date-${job.id}`} type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="h-9 text-xs text-mono" />
                      </div>
                    </div>
                    {payMode === 'manual' && (
                      <select value={payMethod} onChange={e => setPayMethod(e.target.value as Income['paymentMethod'])} aria-label="How it was paid"
                        className="h-9 w-full border border-border bg-background px-2 text-xs">
                        <option value="direct_deposit">Direct deposit</option>
                        <option value="check">Check</option>
                        <option value="cash">Cash</option>
                        <option value="other">Other</option>
                      </select>
                    )}

                    {payMatch && (
                      <div className="border border-border p-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground truncate">
                            Matches {job.name}{job.jobNumber ? ` #${job.jobNumber}` : ''}
                          </p>
                          <span className={cn('shrink-0 text-[10px] text-mono font-bold uppercase', payMatch.level === 'high' ? 'text-dot-paid' : payMatch.level === 'medium' ? 'text-dot-overdue' : 'text-destructive')}>
                            {payMatch.level} · {payMatch.percent}%
                          </span>
                        </div>
                        <div className="h-1.5 bg-secondary" aria-hidden>
                          <div className={cn('h-full', payMatch.level === 'high' ? 'bg-dot-paid' : payMatch.level === 'medium' ? 'bg-dot-overdue' : 'bg-destructive')} style={{ width: `${payMatch.percent}%` }} />
                        </div>
                        <ul className="space-y-0.5 text-[11px]">
                          {payMatch.reasons.map(r => (
                            <li key={r.text} className={r.good ? 'text-foreground/85' : 'text-warning'}>{r.good ? '✓' : '✗'} {r.text}</li>
                          ))}
                        </ul>
                        {payElsewhere && (
                          <p className="text-[11px] text-warning">
                            Looks more like {payElsewhere.project[0].name} · {format(new Date(payElsewhere.project[0].date + 'T12:00:00'), 'MMM d')} ({payElsewhere.match.level} · {payElsewhere.match.percent}%).
                          </p>
                        )}
                      </div>
                    )}
                    {payExplanation && <PayEstimateCard explanation={payExplanation} covers={payCovers} />}
                    {payFound && learnedFromStubs}
                    {payDuplicate && (
                      <p className="text-[11px] text-warning">Already in your payments ({payDuplicate.date}) — adding it again counts it twice.</p>
                    )}

                    <Button size="sm" className="w-full" disabled={!(parseFloat(payAmount) > 0)} onClick={() => void savePayment(job)}>
                      Add {parseFloat(payAmount) > 0 ? `$${parseFloat(payAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'payment'} to this project
                    </Button>
                    {payElsewhere && (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => void savePayment(payElsewhere.project[0])}>
                        Add it to {payElsewhere.project[0].name} instead
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Always front-and-center — no "Edit shift" tap required to log the
            one thing this dialog usually gets opened for. Flat, accent-bordered
            while hours are still missing, stays available afterward to correct them. */}
        <div className={cn(
          "rounded-md border p-3 space-y-2.5",
          actualHours === 0 ? "border-accent/50 bg-accent/5" : "border-border bg-secondary/10"
        )}>
          <p className={cn("text-[9px] text-mono font-bold tracking-widest uppercase", actualHours === 0 ? "text-accent" : "text-muted-foreground/50")}>
            {actualHours === 0 ? 'Log Hours' : 'Hours & Pay'}
          </p>
          {/* One box for the day, typed the way it arrives: "8a-9p" for one
              call, "8-12, 1-6, 7-9p" for several. A bare number is read near the
              start time the shift came with, so on a 10pm call "10-2" is 10pm to
              2am. Several calls are shown below with the meals read out of the
              gaps, so the hours and the meals cannot disagree. */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="shift-hours">Hours</label>
            <Input
              id="shift-hours"
              value={hoursText}
              onChange={e => handleHoursText(e.target.value)}
              placeholder="8a-6p, or calls: 8-12, 1-6, 7-9p"
              className="h-10 text-base text-mono"
              spellCheck={false}
              inputMode="text"
            />
            {hoursText.trim() && !hoursTextReads ? (
              <p className="text-[10px] text-warning">Can't read that yet. Try 8a-6p, or 8-12, 1-6 for calls.</p>
            ) : !timeline && startTime && endTime && calcHours(startTime, endTime) > 0 ? (
              <p className="text-[10px] text-mono text-muted-foreground">{startTime} → {endTime} = <span className="text-accent font-semibold">{roundHours(calcHours(startTime, endTime))}h</span></p>
            ) : !timeline && startTime && endTime && sameClockTime(startTime, endTime) ? (
              <p className="text-[10px] text-mono text-warning" data-testid="same-start-end">{startTime} → {endTime}: the end is the start. Put in the real end, or the hours.</p>
            ) : !timeline && startTime && !endTime ? (
              <p className="text-[10px] text-mono text-muted-foreground">Starts {startTime}. Add the end after a dash.</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">Commas between calls; the gaps become the meals.{anchor !== undefined && job.startTime ? ` Times without am/pm are read near the ${job.startTime} start.` : ''}</p>
            )}
          </div>

          {timeline && (
            <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2.5">
              <p className="text-[10px] text-mono uppercase tracking-wider text-primary">Calls</p>
              {(
                <>
                  <div className="rounded-md border border-border overflow-hidden">
                    {timeline.calls.map((call, i) => {
                      const gap = timeline.gaps[i];
                      return (
                        <div key={i}>
                          <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary/20">
                            <span className="text-[9px] text-mono uppercase tracking-wider text-muted-foreground w-11 shrink-0">Call {i + 1}</span>
                            <span className="text-xs text-mono flex-1 min-w-0">{call.start} – {call.end}</span>
                            <span className="text-[11px] text-mono text-muted-foreground">{roundHours(call.hours)}h</span>
                          </div>
                          {gap && timelineGaps > 1 && (
                            <div className="flex items-center gap-2 px-2 py-1.5 border-y border-border bg-background/40">
                              <span className="text-sm shrink-0" aria-hidden="true">🌭</span>
                              <span className="text-[11px] text-mono flex-1 min-w-0 text-warning">
                                {gap.minutes}min{gap.isSplitBreak ? ' · splits the day' : ''}
                              </span>
                              <div className="flex shrink-0 rounded-md border border-border overflow-hidden">
                                {[{ on: true, label: 'Paid' }, { on: false, label: 'Unpaid' }].map(({ on, label }) => (
                                  <button
                                    key={label}
                                    type="button"
                                    aria-pressed={gap.onClock === on}
                                    onClick={() => setGapsOnClock(withGapOnClock(timeline, i, on).gaps.map(g => g.onClock))}
                                    className={cn(
                                      'text-[9px] text-mono font-bold uppercase tracking-wider px-2 py-1 transition-colors',
                                      gap.onClock === on ? 'bg-warning text-warning-foreground' : 'bg-secondary/20 text-muted-foreground hover:text-foreground'
                                    )}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {oneMealFromTimeline && (
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">
                        🌭 One meal — {oneMealFromTimeline.minutes}min from the gap
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {[{ on: true, label: 'On the clock', sub: 'paid, no deduction' }, { on: false, label: 'Off the clock', sub: `${oneMealFromTimeline.minutes}min deducted` }].map(({ on, label, sub: subLabel }) => {
                          const active = oneMealFromTimeline.onClock === on;
                          return (
                            <button key={label} type="button" onClick={() => setOnlyGapOnClock(on)} className={cn("rounded-md border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                              <p className={cn("text-xs font-bold", active && "text-primary")}>{label}</p>
                              <p className="text-[9px] leading-tight mt-0.5 opacity-70">{subLabel}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {timelineGaps === 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      One straight call — set the meal with the buttons below.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mono">
                    <span className="text-muted-foreground line-through">{roundHours(timeline.spreadHours)}h clocked</span>
                    {timeline.offClockMinutes > 0 && <span className="text-muted-foreground">−{timeline.offClockMinutes}min</span>}
                    <span className="text-accent font-semibold">{roundHours(timeline.workedHours)}h worked</span>
                    {timeline.isSplit && <span className="text-warning">split shift</span>}
                  </div>
                  {timeline.suggestedMealPenalties > 0 && (
                    <button
                      type="button"
                      onClick={() => setMealPenalties(String(timeline.suggestedMealPenalties))}
                      className="flex items-start gap-1.5 text-left text-[10px] text-warning hover:underline"
                    >
                      <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                      <span>
                        {timeline.workedStretches.filter(h => h > penaltyAfter).map(h => `${h}h`).join(' and ')} with no food —
                        {' '}{timeline.suggestedMealPenalties} meal {timeline.suggestedMealPenalties === 1 ? 'penalty' : 'penalties'} owed. Tap to set.
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Meal break — 2nd most important question after the hours, so it
              lives right here instead of buried in Edit shift. Break duration
              and meal-penalty units are independent now: you can take a
              partial break AND still be owed a penalty for it running late,
              so picking one no longer hides the other. */}
          <div className="space-y-1.5">
            {(() => {
              const rule = breakTheHourLabel(job, employer);
              return rule && (
                <p className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-2 text-[11px] leading-tight">
                  <span className="font-medium">{rule}</span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    Any part of an hour is paid as a whole hour on this shift{isLocal16Shift(job) ? ': every Local 16 call does' : ''}.
                  </span>
                </p>
              );
            })()}
            <CallPremiums job={{ ...job, startTime, endTime }} allJobs={data.jobs} employer={employer} />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-start gap-2 cursor-pointer select-none rounded-md border border-border p-2.5">
              <input
                type="checkbox"
                checked={compositeTeam}
                onChange={e => setCompositeTeam(e.target.checked)}
                className="mt-0.5 rounded border-border shrink-0"
              />
              <span className="text-[11px] leading-tight">
                <span className="font-medium">Composite team</span>
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  Lunch after 4 hours: a penalty past 4 unfed · Saturday 1.5× all day · Sunday 2× all day
                </span>
                {compositeTeam && compositeWeekendMultiplier({ ...job, compositeTeam }) > 1 && (
                  <span className="mt-1 block text-[10px] font-bold text-dot-paid">
                    {compositeWeekendMultiplier({ ...job, compositeTeam }) === 2 ? 'A Sunday: double time all day.' : 'A Saturday: time and a half all day.'}
                  </span>
                )}
              </span>
            </label>
            {/* The meal buttons stay the default and the right control for one
                lunch, but once the calls already say where the meals are, setting
                them again here would be a second source for the same fact. A
                penalty is owed or not regardless, so that stays below. */}
            <div className={cn("space-y-1.5", mealsFromTimeline && "hidden")}>
            <label className="text-xs text-muted-foreground">{secondMealOpen ? 'First Meal' : 'Meal Break'}</label>
            <MealChoice duration={mealDuration} onClock={mealOnClock} onDuration={setMealDuration} onOnClock={setMealOnClock} />
            {/* Each further meal gets its own boxes rather than sharing the first's:
                an hour off at lunch and half an hour on later is a normal day,
                and the two have nothing to do with each other. */}
            {secondMealOpen && (
              <>
                <div className="space-y-1.5 pt-1 border-t border-border/60">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">Second Meal</label>
                    <button
                      type="button"
                      onClick={() => {
                        // The next one along moves up, so the numbers stay in a row.
                        const [next, ...rest] = extraMeals;
                        setSecondMealOpen(!!next);
                        setMeal2Duration(next?.duration);
                        setMeal2OnClock(next?.onClock ?? false);
                        setExtraMeals(rest);
                      }}
                      className="text-[11px] text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <MealChoice duration={meal2Duration} onClock={meal2OnClock} onDuration={setMeal2Duration} onOnClock={setMeal2OnClock} />
                </div>
                {extraMeals.map((meal, i) => (
                  <div key={i} className="space-y-1.5 pt-1 border-t border-border/60">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-muted-foreground">Meal {i + 3}</label>
                      <button
                        type="button"
                        onClick={() => setExtraMeals(prev => prev.filter((_, n) => n !== i))}
                        className="text-[11px] text-destructive hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                    <MealChoice
                      duration={meal.duration}
                      onClock={meal.onClock}
                      onDuration={duration => setExtraMeals(prev => prev.map((m, n) => (n === i ? { ...m, duration } : m)))}
                      onOnClock={on => setExtraMeals(prev => prev.map((m, n) => (n === i ? { ...m, onClock: on } : m)))}
                    />
                  </div>
                ))}
              </>
            )}
            </div>
            {/* The things most days don't have, as two links in one row. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5">
              {!mealsFromTimeline && (
                <button
                  type="button"
                  onClick={() => (secondMealOpen ? setExtraMeals(prev => [...prev, { onClock: false }]) : setSecondMealOpen(true))}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <Plus size={11} /> {secondMealOpen ? 'Add another meal' : 'Add a second meal'}
                </button>
              )}
              {!(penaltyOpen || (parseFloat(mealPenalties) || 0) > 0) && (
                <button
                  type="button"
                  onClick={() => setPenaltyOpen(true)}
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <Plus size={11} /> Add a meal penalty
                </button>
              )}
            </div>
            {unfedComposite > 0 && (parseFloat(mealPenalties) || 0) !== unfedComposite && (
              <button
                type="button"
                onClick={() => setMealPenalties(String(unfedComposite))}
                className="flex items-start gap-1.5 text-left text-[10px] text-warning hover:underline"
              >
                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                <span>
                  {roundHours(actualHours)}h with no lunch on a composite call — {unfedComposite} meal {unfedComposite === 1 ? 'penalty' : 'penalties'} owed past 4 hours. Tap to set.
                </span>
              </button>
            )}
            {(penaltyOpen || (parseFloat(mealPenalties) || 0) > 0) && (
            <div className="space-y-1.5 pt-1 border-t border-border/60">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Meal Penalties <span className="text-[10px]">· 1 = 1hr at straight rate</span></label>
                <button
                  type="button"
                  onClick={() => { setMealPenalties(''); setPenaltyOpen(false); }}
                  className="text-[11px] text-destructive hover:underline"
                >
                  Remove
                </button>
              </div>
              {/* A vertical wheel for a number that is almost always 0, 1 or 2
                  spent a whole column of the form on empty space. A row with
                  the count in the middle is the same control in one line. */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="One fewer meal penalty"
                  disabled={(parseFloat(mealPenalties) || 0) <= 0}
                  onClick={() => setMealPenalties(String(Math.max(0, (parseFloat(mealPenalties) || 0) - 1)))}
                  className="pixel-button h-9 w-9 shrink-0 bg-card text-lg leading-none text-muted-foreground disabled:opacity-30"
                >
                  −
                </button>
                <span className={cn(
                  'h-9 min-w-[3rem] px-3 flex items-center justify-center text-mono text-lg font-bold pixel-well',
                  (parseFloat(mealPenalties) || 0) > 0 ? 'text-warning' : 'text-muted-foreground',
                )}>
                  {parseFloat(mealPenalties) || 0}
                </span>
                <button
                  type="button"
                  aria-label="One more meal penalty"
                  onClick={() => setMealPenalties(String(Math.min(20, (parseFloat(mealPenalties) || 0) + 1)))}
                  className="pixel-button h-9 w-9 shrink-0 bg-card text-lg leading-none text-muted-foreground"
                >
                  +
                </button>
                {(parseFloat(mealPenalties) || 0) > 0 && rate > 0 && (
                  <span className="text-[11px] text-mono text-warning ml-auto">
                    +${((parseFloat(mealPenalties) || 0) * rate).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                )}
              </div>
            </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              {/* Both labels are one fixed height, so the boxes under them line
                  up whether or not this one carries a callback or split mark. */}
              <label className="h-5 text-xs text-muted-foreground flex items-center gap-1.5">
                <CallbackMark job={job} allJobs={data.jobs} employers={data.employers} />Clocked hours<SplitMark job={job} allJobs={data.jobs} />
              </label>
              <Input type="number" min="0" step="any" value={hoursWorked} onChange={e => handleHoursWorkedChange(e.target.value)} placeholder="e.g. 8" className="h-9 text-sm text-mono" />
              {/* The box holds the clocked span, because that is what gets saved and
                  what calculateDayPay expects. The number that matters when you are
                  looking at it is the hours actually worked, so it sits right here —
                  the meal toggle just above is what changes it. */}
              {hoursDifferFromClockSpan && (
                <p className="text-[10px] leading-tight text-warning">
                  Pay uses the {roundHours(enteredHours)}h entered here, not the {roundHours(clockSpanHours)}h time span. Use Calls for multiple calls, or correct the hours if this is wrong.
                </p>
              )}
              {actualHours > 0 && (offClockMealMins > 0 || (mealDuration !== undefined && mealDuration > 0)) && (
                <p className="text-[11px] text-mono leading-tight">
                  {mealDeductionHours > 0 ? (
                    <><span className="text-muted-foreground line-through">{roundHours(actualHours)}h</span>{' '}
                      <span className="text-accent font-semibold">{roundHours(paidHours)}h worked</span>{' '}
                      <span className="text-muted-foreground">({offClockMealMins}min off the clock)</span></>
                  ) : (
                    <><span className="text-accent font-semibold">{roundHours(actualHours)}h worked</span>{' '}
                      <span className="text-muted-foreground">(meal stays on the clock)</span></>
                  )}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="h-5 text-xs text-muted-foreground flex items-center">Rate ($/hr)</label>
              <Input type="number" min="0" step="0.01" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} placeholder="e.g. 45" className="h-9 text-sm text-mono" />
            </div>
          </div>
          {!rate && (
            <p className="text-[10px] text-warning">⚠ No rate set — pay won't calculate until this is filled in</p>
          )}
          {job.hoursPlanned && job.date <= new Date().toISOString().slice(0, 10) && (
            <button
              type="button"
              onClick={() => onSave({ hoursPlanned: undefined, status: 'completed' })}
              className="pixel-button w-full flex items-center gap-2.5 border-accent/60 bg-accent/10 px-3 py-2.5 text-left"
            >
              <Check size={16} className="text-accent shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-accent">Confirm {roundHours(paidHours)}h worked</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  Planned ahead of the day — nothing counts it until you say it happened.
                </span>
              </span>
            </button>
          )}

          {/* Pre-ticked when the payroll company was assumed rather than told
              to us, so an assumption is visible instead of silent. */}
          <label className="flex items-start gap-2 cursor-pointer select-none pt-0.5">
            <input
              type="checkbox"
              checked={needsReview}
              onChange={e => setNeedsReview(e.target.checked)}
              className="mt-0.5 rounded border-border shrink-0"
            />
            <span className="text-[11px] leading-tight">
              Check this one later
              {needsReview && reviewReason(job).kind !== 'manual' && (
                <span className="block text-[10px] text-warning">Why: {reviewReason(job).text}.</span>
              )}
            </span>
          </label>
          {projectSiblings.length > 0 && (
            <label className="flex items-start gap-2 cursor-pointer select-none rounded-md border border-accent/40 bg-accent/5 p-2.5">
              <input
                type="checkbox"
                checked={relabelProject}
                onChange={e => setRelabelProject(e.target.checked)}
                className="mt-0.5 rounded border-border shrink-0"
              />
              <span className="text-[11px] leading-tight">
                Change the employer on the other {projectSiblings.length} shift{projectSiblings.length !== 1 ? 's' : ''} too
                <span className="block text-[10px] text-muted-foreground mt-0.5">
                  {job.jobNumber?.trim() ? 'Job #' + job.jobNumber.trim() : job.name} — still says {job.client}.
                </span>
              </span>
            </label>
          )}
          <Button size="sm" className="w-full" disabled={!hasChanges} onClick={handleSave}>
            Save Hours
          </Button>
        </div>

        {/* Saved as soon as they are picked, like the paid toggle above —
            they change what the shift pays, not what was typed into it. */}
        {(employerRoles.length > 0 || ptoHere || job.pto) && (
          <div className="rounded-md border border-border p-3 space-y-2">
            {employerRoles.length > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Role</span>
                <select
                  value={job.role ?? ''}
                  onChange={e => void pickRole(e.target.value)}
                  className="h-8 max-w-[65%] border border-border bg-background px-2 text-xs"
                  aria-label="Role worked"
                >
                  <option value="">No role</option>
                  {employerRoles.map(r => (
                    <option key={r.name} value={r.name}>
                      {r.name}{r.hourlyRate ? ` · $${r.hourlyRate}/hr` : r.dayRate ? ` · $${r.dayRate}/day` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(ptoHere || job.pto) && (
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!job.pto}
                  onChange={e => void updateJobDirect(job.id, { pto: e.target.checked || undefined })}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-[11px] leading-tight">
                  Paid time off — paid at straight time, not worked
                  {ptoHere && ptoBank && (
                    <span className="block text-[10px] text-muted-foreground">{ptoBank.banked}h banked with {employer?.name}</span>
                  )}
                </span>
              </label>
            )}
          </div>
        )}
        <div className="rounded-md border border-border bg-secondary/10 p-3 space-y-2">
          {job.name && <div className="flex justify-between gap-3"><span className="text-muted-foreground text-xs shrink-0">Project</span><span className="font-medium text-xs text-right">{job.name}</span></div>}
          {(client || job.client) && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-xs">Employer</span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-xs">{client || job.client}</span>
                <button type="button" onClick={() => setEditingEmployer(true)} className="pixel-button pick-off shrink-0 px-1.5 py-0.5 text-[10px] font-bold">
                  {employer ? 'Edit employer' : 'Save as employer'}
                </button>
              </span>
            </div>
          )}
          {editingEmployer && (
            <EmployerEditor
              employer={employer}
              prefill={{ name: client || job.client, payrollCompany, defaultHourlyRate: hourlyRate }}
              onClose={() => setEditingEmployer(false)}
            />
          )}
          {job.local && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Client</span><span className="font-medium text-xs">{job.local}</span></div>}
          {(job.payrollCompany || payrollCompany) && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Payroll company</span><span className="font-medium text-xs">{payrollCompany || job.payrollCompany}</span></div>}
          {shiftContract(job) ? (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground text-xs shrink-0">Contract</span>
              <span className="text-right">
                <span className="block font-medium text-xs">{shiftContract(job)}</span>
                <span className="block text-[10px] text-muted-foreground">No terms saved for it yet. Pay uses {job.client}'s settings.</span>
              </span>
            </div>
          ) : contractFor(employer)?.perEmployer ? (
            <div className="flex justify-between gap-3"><span className="text-muted-foreground text-xs shrink-0">Terms</span><span className="font-medium text-xs text-right">{contractFor(employer)!.name} {contractFor(employer)!.version}</span></div>
          ) : null}
          {job.venue && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Venue</span><span className="font-medium text-xs">{job.venue}</span></div>}
          {job.jobNumber && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Job #</span><span className="font-medium text-xs text-mono">{job.jobNumber}</span></div>}
          {(startTime || job.startTime) && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Start</span><span className="font-medium text-xs text-mono">{startTime || job.startTime}{endTime ? ` – ${endTime}` : ''}</span></div>}
          {actualHours > 0 && mealDeductionHours > 0 && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Clocked</span><span className="font-medium text-xs text-mono text-muted-foreground">{roundHours(actualHours)}h</span></div>}
          {actualHours > 0 && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Hours Worked</span><span className="font-medium text-xs text-mono">{roundHours(paidHours)}h</span></div>}
          {job.dayRate
            ? <div className="flex justify-between"><span className="text-muted-foreground text-xs">Day rate</span><span className="font-medium text-xs text-mono">${job.dayRate} · covers {job.dayRateHours ?? 10}h</span></div>
            : rate > 0 && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Rate</span><span className="font-medium text-xs text-mono">${rate}/hr</span></div>}
        </div>
        {splitCallPay ? (
          <div className="rounded-md border border-success/30 bg-success/5 p-3 space-y-1.5" data-testid="split-call-pay">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Worked {roundHours(actualHours)}h · this call, gross</span>
              <span className="font-bold text-sm text-mono text-success">${splitCallPay.gross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="pt-1 space-y-0.5 border-t border-border/40 mt-1">
              {([
                [splitCallPay.hours.straight, 'straight'],
                [splitCallPay.hours.overtime, 'overtime'],
                [splitCallPay.hours.double, 'double time'],
                [splitCallPay.hours.night, 'night premium'],
                [splitCallPay.hours.premiumDay, '6th/7th day premium'],
                [splitCallPay.hours.minimum, 'minimum padding'],
              ] as const).filter(([h]) => h > 0.005).map(([h, label]) => (
                <p key={label} className="text-[10px] text-mono text-muted-foreground">{roundHours(h)}h {label}</p>
              ))}
              <p className="text-[10px] text-mono text-muted-foreground">Split day: both calls are one day, worked in order, so overtime and night pay land on the call that worked them.</p>
            </div>
          </div>
        ) : payPreview && (
          <div className={cn("rounded-md border p-3 space-y-1.5", minimumApplied ? "border-accent/40 bg-accent/5" : "border-success/30 bg-success/5")}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{minimumApplied ? `Worked ${roundHours(actualHours)}h — paid for ${roundHours(billableHours)}h minimum` : mealDeductionHours > 0 ? `Worked ${roundHours(actualHours)}h — ${offClockMealMins}min meal = ${roundHours(paidHours)}h paid` : `Worked ${roundHours(actualHours)}h`}</span>
              <span className="font-bold text-sm text-mono text-success">${payPreviewTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            {minimumApplied && <p className="text-[10px] text-accent font-medium">{minHours}h minimum call — contract guarantees payment for {minHours}h</p>}
            {(payPreview.breakdown.length > 0 || vacationAmount > 0) && (
              <div className="pt-1 space-y-0.5 border-t border-border/40 mt-1">
                {payPreview.breakdown.map((line, i) => (
                  <p key={i} className="text-[10px] text-mono text-muted-foreground">{line}</p>
                ))}
                {vacationAmount > 0 && (
                  <p className="text-[10px] text-mono text-muted-foreground">Vacation pay ({vacationPercent}%): +${vacationAmount.toFixed(2)}</p>
                )}
              </div>
            )}
          </div>
        )}

        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/20 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
          >
            <Pencil size={12} /> Edit shift
          </button>
        )}

        {payStub && (
        <label htmlFor={`stub-input-${job.id}`} className={cn(
          "flex items-center gap-2.5 rounded-md border p-3 cursor-pointer transition-colors",
          payStub ? "border-success/40 bg-success/5" : "border-dashed border-border bg-secondary/10 hover:border-primary/30"
        )}>
          <div className={cn(
            "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
            payStub ? "bg-success/20 text-success" : "bg-secondary text-muted-foreground"
          )}>
            {parsingStub ? <Loader2 size={15} className="animate-spin" /> : <Receipt size={15} />}
          </div>
          <span className="flex-1 min-w-0">
            <span className="text-xs font-medium block">
              {parsingStub ? 'Reading pay stub…' : payStub ? 'Pay stub uploaded' : 'No pay stub uploaded'}
            </span>
            <span className="text-[10px] text-muted-foreground block">
              {parsingStub ? 'Extracting hours, pay, dues, tax…' : payStub ? 'Tap to replace' : 'Attach the stub/check when it arrives to verify pay later'}
            </span>
          </span>
          {payStub && !parsingStub && (
            <button
              type="button"
              onClick={async (e) => {
                e.preventDefault(); e.stopPropagation();
                const url = await stubViewUrl(payStub);
                if (!url) { toast.error("Couldn't open that stub"); return; }
                setViewingStub(url);
              }}
              className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="View pay stub"
            >
              <Eye size={14} />
            </button>
          )}
          {payStub && !parsingStub && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault(); e.stopPropagation();
                if (!data.income.some(i => i.proofRef === payStub)) deleteStub(payStub);
                setPayStub(''); setStubParsed(undefined);
                updateJobDirect(job.id, { payStub: undefined, stubParsed: undefined });
              }}
              className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              aria-label="Remove pay stub"
            >
              <X size={14} />
            </button>
          )}
        </label>
        )}

        {/* Storing a stub nobody can look at is just a boolean with a storage
            bill — the point of keeping it is being able to check it later. */}
        <Dialog open={!!viewingStub} onOpenChange={o => !o && setViewingStub(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-mono text-sm">Pay stub</DialogTitle>
            </DialogHeader>
            {viewingStub && (
              <img src={viewingStub} alt="Pay stub" className="w-full rounded-md border border-border" />
            )}
          </DialogContent>
        </Dialog>

        {stubParsed && (
          <div className="rounded-md border border-success/30 bg-success/5 p-3 space-y-1">
            <p className="text-[9px] text-mono font-bold tracking-widest uppercase text-success/70">Pay Stub Read</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-mono">
              {stubParsed.employer && <div className="col-span-2 text-muted-foreground truncate">{stubParsed.employer}</div>}
              {(stubParsed.payPeriodStart || stubParsed.payPeriodEnd) && (
                <div className="col-span-2 text-muted-foreground">{stubParsed.payPeriodStart ?? '?'} → {stubParsed.payPeriodEnd ?? '?'}</div>
              )}
              {stubParsed.totalHours != null && <div>Hours <span className="text-foreground font-semibold">{stubParsed.totalHours}</span></div>}
              {stubParsed.grossPay != null && <div>Gross <span className="text-foreground font-semibold">${stubParsed.grossPay.toLocaleString()}</span></div>}
              {stubParsed.duesAmount != null && <div>Dues <span className="text-foreground font-semibold">${stubParsed.duesAmount.toLocaleString()}</span></div>}
              {stubParsed.taxAmount != null && <div>Tax <span className="text-foreground font-semibold">${stubParsed.taxAmount.toLocaleString()}</span></div>}
              {stubParsed.vacationAmount != null && <div>Vacation <span className="text-foreground font-semibold">${stubParsed.vacationAmount.toLocaleString()}</span></div>}
              {stubParsed.netPay != null && <div className="text-success">Net <span className="font-bold">${stubParsed.netPay.toLocaleString()}</span></div>}
            </div>
          </div>
        )}

        {/* One check usually covers a whole period, so the stub is reconciled
            against every shift it spans — not just the one it's attached to. */}
        {stubMatch && (
          <div className={cn("rounded-md border p-3 space-y-2", CONFIDENCE_STYLES[stubMatch.confidence].box)}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] text-mono font-bold tracking-widest uppercase text-muted-foreground/70">Covers</p>
              <span className={cn("text-[9px] text-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full", CONFIDENCE_STYLES[stubMatch.confidence].pill)}>
                {stubMatch.confidence} confidence
              </span>
            </div>
            <div className="space-y-1">
              {stubMatch.jobs.map(j => (
                <div key={j.id} className="flex items-center justify-between gap-2 text-[11px] text-mono">
                  <span className={cn("truncate", j.id === job.id ? "text-foreground font-semibold" : "text-muted-foreground")}>
                    {format(new Date(j.date + 'T12:00:00'), 'EEE, MMM d')}
                    {j.id === job.id && <span className="text-accent"> · this shift</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{roundHours(netHoursWorked(j))}h</span>
                </div>
              ))}
            </div>
            <div className="pt-1 border-t border-border/40 space-y-0.5">
              {stubMatch.reasons.map((r, i) => (
                <p key={i} className="text-[10px] text-mono text-muted-foreground">{r}</p>
              ))}
            </div>
          </div>
        )}

        {stubExplanation && (
          <div className="space-y-1">
            <p className="text-[9px] text-mono font-bold tracking-widest uppercase text-muted-foreground/70">Estimate vs stub</p>
            <PayEstimateCard explanation={stubExplanation} covers={stubMatch?.jobs} />
          </div>
        )}

        {/* Side by side, because a total only tells you something is wrong —
            this shows which line it is. */}
        {stubComparison && (
          <div className="rounded-md border border-border bg-secondary/10 p-3 space-y-2">
            <p className="text-[9px] text-mono font-bold tracking-widest uppercase text-muted-foreground/70">Stub vs Calculated</p>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-1 items-baseline text-[11px] text-mono">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50" />
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 text-right">Stub</span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 text-right">Calculated</span>
              {stubComparison.map(r => {
                const fixed = (job.stubCorrections ?? []).find(c => c.field === r.key);
                const fmt = (n: number) => (r.money ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${n}h`);
                return (
                  <Fragment key={r.key}>
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className={cn('text-right font-semibold', ROW_STATUS_STYLES[r.status])}>
                      {r.stub == null ? '—' : fmt(r.stub)}
                    </span>
                    <span className="text-right">
                      {/* Once accepted, what it used to say stays visible struck
                          through — a correction you can see, not a silent edit. */}
                      {fixed ? (
                        <>
                          <span className="text-destructive line-through mr-1">{fmt(fixed.was)}</span>
                          <span className="text-success font-semibold">{fmt(fixed.now)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          {r.calculated === 0 && r.key === 'rate' ? '—' : fmt(r.calculated)}
                        </span>
                      )}
                    </span>
                  </Fragment>
                );
              })}
            </div>
            {stubDisagreements.length > 0 ? (
              <div className="pt-1 border-t border-border/40 space-y-1.5">
                <p className="text-[10px] text-mono text-warning">
                  {stubDisagreements.length} line{stubDisagreements.length !== 1 ? 's' : ''} disagree: {stubDisagreements.map(r => r.label.toLowerCase()).join(', ')}
                </p>
                {/* The stub is what you were actually paid, so accepting it
                    records the real figure rather than the estimate. */}
                {stubDisagreements.filter(r => !(job.stubCorrections ?? []).some(c => c.field === r.key)).map(r => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => acceptStubValue(r.key, r.calculated, r.stub!)}
                    className="w-full flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/20 px-2 py-1.5 text-[10px] text-mono hover:border-success/40 hover:bg-success/5 transition-colors"
                  >
                    <span className="text-muted-foreground">Use stub's {r.label.toLowerCase()}</span>
                    <span className="text-success font-semibold shrink-0">
                      {r.money ? `$${r.stub!.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${r.stub}h`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-mono text-success pt-1 border-t border-border/40">
                Every stated line agrees with the calculation
              </p>
            )}
          </div>
        )}

        {!payFound && learnedFromStubs}

        {/* Always here, not only while editing — it was tucked inside the edit
            section, where nobody looking for it would find it. */}
        <div className="rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setDuplicating(d => !d)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/30 transition-colors"
          >
            <Copy size={14} className="text-muted-foreground shrink-0" />
            <span className="text-xs font-medium flex-1">Extend this job to more days</span>
            <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", duplicating && "rotate-180")} />
          </button>
          {duplicating && (
            <div className="border-t border-border p-3 space-y-2">
              <p className="text-[10px] text-muted-foreground">
                Same project, employer, venue and rate — a new shift for each day you tap.
              </p>
              {job.startTime && (
                <div className="space-y-1">
                  <p className="text-[10px] text-mono uppercase text-muted-foreground">Call times on the new days</p>
                  <div className={cn('grid gap-1.5', job.endTime ? 'grid-cols-3' : 'grid-cols-2')} role="radiogroup" aria-label="Call times on the new days">
                    {([
                      { value: 'none', label: 'None', sub: 'left blank' },
                      { value: 'start', label: 'Start', sub: job.startTime },
                      ...(job.endTime ? [{ value: 'both' as const, label: 'Start & end', sub: `${job.startTime}–${job.endTime}` }] : []),
                    ] as { value: typeof dupTimes; label: string; sub: string }[]).map(({ value, label, sub }) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={dupTimes === value}
                        onClick={() => setDupTimes(value)}
                        className={cn('rounded-md border px-1 py-1.5 text-center transition-colors', dupTimes === value ? 'border-primary/50 bg-primary/15' : 'border-border bg-secondary/20 hover:border-primary/30')}
                      >
                        <p className={cn('text-xs font-bold', dupTimes === value && 'text-primary')}>{label}</p>
                        <p className="truncate text-[9px] text-mono text-muted-foreground">{sub}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* The days as calendar blocks, tapped on and off: a run from load
                  in to load out is a row of taps, not a date box per day. */}
              {(() => {
                const anchor = parseISO(job.date);
                const from = startOfWeek(isNaN(anchor.getTime()) ? new Date() : anchor);
                const booked = new Set(projectDays(job, data.jobs, data.employers).map(j => j.date));
                const days = Array.from({ length: dupWeeks * 7 }, (_, i) => addDays(from, i));
                return (
                  <div className="grid grid-cols-7 gap-1" data-testid="extend-days">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                      <span key={i} className="text-center text-[9px] text-mono text-muted-foreground">{d}</span>
                    ))}
                    {days.map((d, i) => {
                      const iso = format(d, 'yyyy-MM-dd');
                      const isThis = iso === job.date;
                      const has = !isThis && booked.has(iso);
                      const picked = dupDates.includes(iso);
                      return (
                        <button
                          key={iso}
                          type="button"
                          disabled={isThis || has}
                          aria-pressed={picked}
                          aria-label={`${format(d, 'EEE, MMM d')}${isThis ? ', this shift' : has ? ', already booked' : ''}`}
                          onClick={() => setDupDates(prev => (prev.includes(iso) ? prev.filter(x => x !== iso) : [...prev, iso]))}
                          className={cn(
                            'flex h-10 flex-col items-center justify-center rounded-md border text-mono text-xs leading-none transition-colors',
                            picked ? 'border-primary bg-primary font-bold text-primary-foreground'
                              : isThis ? 'border-primary/70 text-primary'
                              : has ? 'border-border/30 text-muted-foreground/40'
                              : 'border-border bg-secondary/20 text-foreground hover:border-primary/40',
                          )}
                        >
                          {(i === 0 || d.getDate() === 1) && <span className="text-[8px] uppercase">{format(d, 'MMM')}</span>}
                          <span>{d.getDate()}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Outlined: this shift · faded: already on</span>
                <button type="button" onClick={() => setDupWeeks(w => w + 2)} className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                  <Plus size={11} /> 2 more weeks
                </button>
              </div>
              <Button size="sm" className="w-full" disabled={dupDates.length === 0} onClick={handleDuplicate}>
                {dupDates.length === 0 ? 'Tap the days to add' : `Add ${dupDates.length} day${dupDates.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          )}
        </div>

        {editing && (
        <>
        <div className="space-y-3">
          <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/50 uppercase">Update Job</p>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Employer</label>
            <Input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Live Nation" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Payroll company</label>
            <Input value={payrollCompany} onChange={e => setPayrollCompany(e.target.value)} placeholder="e.g. Nolan AV, Live Nation" className="h-9 text-sm" />
          </div>
          {/* This call's contract, as the dispatch names it. Never the employer's or the venue's. */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Contract</label>
            <Input list="shift-contracts" value={contractName} onChange={e => setContractName(e.target.value)} placeholder="As the dispatch names it" className="h-9 text-sm" />
            <datalist id="shift-contracts">{contractsWorked(data.jobs).map(c => <option key={c.name} value={c.name} />)}</datalist>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Min. Call</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[4, 5, 8].map(hours => {
                const active = minimumHours === hours.toString();
                return (
                  <button key={hours} type="button" onClick={() => handleMinimumClick(hours)} className={cn("rounded-md border py-2 text-center text-sm font-bold text-mono transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                    {roundHours(hours)}h
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {rawNightHours > 0 && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={nightPremiumConfirmed}
                onChange={e => setNightPremiumConfirmed(e.target.checked)}
                className="mt-0.5 rounded border-border"
              />
              <span className="text-xs">
                <span className="font-medium">{roundHours(rawNightHours)}h after midnight were actually worked</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                  Paid at {employer?.nightPremiumMultiplier ?? 2}× straight rate. Uncheck if some or all of that time was minimum-call padding you didn't really work.
                </span>
              </span>
            </label>
            {!nightPremiumConfirmed && (
              <div className="pl-6 space-y-1">
                <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">
                  Was any of it actually worked? (0 = none)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max={rawNightHours}
                    step="0.25"
                    value={nightPremiumActualHours}
                    onChange={e => setNightPremiumActualHours(e.target.value)}
                    placeholder="0"
                    className="h-8 text-sm text-mono w-24"
                  />
                  <span className="text-[11px] text-muted-foreground">of {roundHours(rawNightHours)}h — the rest bills straight time</span>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={handleCancelEdit}>Cancel</Button>
          <Button size="sm" className="flex-1" disabled={!hasChanges} onClick={() => { handleSave(); setEditing(false); }}>Save</Button>
        </div>
        </>
        )}
      </div>
    </>
  );
}

// ── Non-work event form (add or edit) ───────────────────────────────────────
// Deliberately lightweight next to JobDetailView — an event is just a
// personal commitment you want visible on the calendar, not something with
// pay/hours/employer logic attached.

function EventForm({ initial, onSave, onCancel }: {
  initial: Partial<CalendarEvent> & { date: string };
  onSave: (event: Omit<CalendarEvent, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime ?? '');
  const [endTime, setEndTime] = useState(initial.endTime ?? '');
  const [location, setLocation] = useState(initial.location ?? '');
  const [notes, setNotes] = useState(initial.notes ?? '');

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <Input
        placeholder="What's the plan?"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="h-8 text-sm"
      />
      <div className="grid grid-cols-3 gap-2">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-xs col-span-1" />
        <Input placeholder="Start (opt.)" value={startTime} onChange={e => setStartTime(e.target.value)} className="h-8 text-xs" />
        <Input placeholder="End (opt.)" value={endTime} onChange={e => setEndTime(e.target.value)} className="h-8 text-xs" />
      </div>
      <Input placeholder="Location (optional)" value={location} onChange={e => setLocation(e.target.value)} className="h-8 text-xs" />
      <Input placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-xs" />
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          disabled={!title.trim() || !date}
          onClick={() => onSave({
            title: title.trim(),
            date,
            startTime: startTime.trim() || undefined,
            endTime: endTime.trim() || undefined,
            location: location.trim() || undefined,
            notes: notes.trim() || undefined,
          })}
        >
          <Check size={13} className="mr-1" /> Save
        </Button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { data, authReady, updateJob, deleteJob, addEvent, updateEvent, deleteEvent, addJob, addIncome, updateIncome, deleteIncome } = useData();
  const { prefs, setCalendarPay } = useUserPrefs();
  const navigate = useNavigate();
  // Which estimate the calendar and the project boxes lead with.
  const payView = prefs.calendarPay ?? 'net';
  const shownPay = (job: Job) => jobPayBreakdown(job, data.jobs, data.employers, prefs.payer)[payView];
  const [currentDate, setCurrentDate] = useState(new Date());
  // Shifts whose date has passed with no hours on them. This used to be the
  // Dashboard's hero card; it is about shifts, so it belongs here.
  const { jobsNeedingHours, oldestDays } = useNeedsHours(data.jobs);
  const flaggedJobs = useMemo(
    () => data.jobs.filter(j => j.needsReview && j.status !== 'cancelled').sort(compareCalls),
    [data.jobs],
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  // Set when a row's stub button was what opened the job, so the detail view
  // can go straight to the camera instead of making you find the control.
  const [openStubFor, setOpenStubFor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // The month's projects and the payments with no shift fold away under their headings, remembered on the phone.
  const [projectsOpen, toggleProjects] = useRememberedOpen('show-flow-cal-projects-open');
  const [unlinkedOpen, toggleUnlinked] = useRememberedOpen('show-flow-cal-unlinked-open');
  const location = useLocation();
  /** The page a shift was opened from, when it was: closing the shift goes back to it. */
  const returnTo = useRef<string | null>(null);
  const [addingEventDate, setAddingEventDate] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddShiftOpen, setQuickAddShiftOpen] = useState(false);
  const [addShiftDate, setAddShiftDate] = useState<string | null>(null);
  const [quickAddHoursOpen, setQuickAddHoursOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Deep-link from Dashboard's hero cards (?job=<id>) straight into that
  // shift's detail view instead of making the user hunt for it on the grid.
  useEffect(() => {
    const jobId = searchParams.get('job');
    // ?day=YYYY-MM-DD: the whole day, every call on it, as a split day is.
    const day = searchParams.get('day');
    // Until the ledger has loaded every link looks broken, and clearing it
    // then would throw away a perfectly good one.
    if ((!jobId && !day) || !authReady) return;
    const job = jobId ? data.jobs.find(j => j.id === jobId) : undefined;
    const dayOk = !!day && /^\d{4}-\d{2}-\d{2}$/.test(day) && isValid(parseISO(day));
    if (job || dayOk) {
      setSelectedDate(job ? job.date : day);
      setSelectedJobId(job ? job.id : null);
      // Opened from another page (the unemployment claim): closing it goes back there.
      returnTo.current = (location.state as ReturnState | null)?.returnTo ?? null;
    }
    setSearchParams(prev => { prev.delete('job'); prev.delete('day'); return prev; }, { replace: true });
  }, [searchParams, data.jobs, authReady, setSearchParams, location.state]);

  // Shifts whose only evidence is somebody saying so.
  const paidByHandJobIds = useMemo(() => {
    const set = new Set<string>();
    for (const i of data.income) {
      if (i.status === 'paid' && i.enteredByHand && i.jobId) set.add(i.jobId);
    }
    return set;
  }, [data.income]);

  const jobsByDate = useMemo(() => {
    const map: Record<string, Job[]> = {};
    data.jobs.forEach(job => { if (!map[job.date]) map[job.date] = []; map[job.date].push(job); });
    // A day's calls in the order they were worked, morning first.
    for (const list of Object.values(map)) list.sort(compareCalls);
    return map;
  }, [data.jobs]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    data.events.forEach(ev => { if (!map[ev.date]) map[ev.date] = []; map[ev.date].push(ev); });
    return map;
  }, [data.events]);

  // Which project each shift is on — one answer, shared with the pay matcher.
  const projectKeyOf = useMemo(() => projectKeysFor(data.jobs, data.employers), [data.jobs, data.employers]);
  const projectGroupKey = (j: Job) => projectKeyOf.get(j.id) ?? j.id;

  // Who each project is for, by the employer's own name where the client
  // matches one: the label across its days on the month grid.
  const projectNameOf = useMemo(() => {
    const names = new Map<string, string>();
    const byDate = [...data.jobs].sort((a, b) => a.date.localeCompare(b.date));
    for (const j of byDate) {
      const key = projectKeyOf.get(j.id) ?? j.id;
      const client = j.client?.trim();
      if (names.has(key) || !client) continue;
      names.set(key, resolveEmployer(client, data.employers)?.name ?? client);
    }
    // No client anywhere on it: its own name.
    for (const j of byDate) {
      const key = projectKeyOf.get(j.id) ?? j.id;
      if (!names.has(key) && j.name?.trim()) names.set(key, j.name.trim());
    }
    return names;
  }, [data.jobs, data.employers, projectKeyOf]);

  /** The projects worked on a day, for the labels across the week. */
  const projectsOn = (day: Date): DayProject[] => {
    const seen = new Map<string, DayProject>();
    for (const j of jobsByDate[format(day, 'yyyy-MM-dd')] ?? []) {
      if (j.status === 'cancelled') continue;
      const key = projectGroupKey(j);
      const name = projectNameOf.get(key);
      if (name && !seen.has(key)) seen.set(key, { key, name });
    }
    return [...seen.values()];
  };
  const spansFor = (week: Date[]) => weekSpans([addDays(week[0], -1), ...week, addDays(week[6], 1)].map(projectsOn));

  // Paid shifts: see paidShiftIds. It says how a payment reaches past the day
  // it was put on, and how a project split across pay periods is paid by piece.
  const paidJobIds = useMemo(
    () => paidShiftIds(data.jobs, data.income, data.employers, prefs.payer),
    [data.jobs, data.income, data.employers, prefs.payer],
  );

  // ── Pay, by project ───────────────────────────────────────────────────────
  // The calendar is where jobs and their pay live together now: each project
  // of the month says what it has been paid or that it is still waiting, the
  // longest wait is called out at the top, and payments that came in with no
  // shift are here to be linked.
  const incomeByProject = useMemo(() => {
    const map = new Map<string, Income[]>();
    for (const i of data.income) {
      const k = i.jobId ? projectKeyOf.get(i.jobId) : undefined;
      if (!k) continue;
      map.set(k, [...(map.get(k) ?? []), i]);
    }
    return map;
  }, [projectKeyOf, data.income]);

  // An employer's check pays its oldest unpaid days first, whichever of its
  // projects they were on (see employerCovers): those projects list it too.
  const reachedFrom = useMemo(() => {
    const byId = new Map(data.income.map(i => [i.id, i]));
    const map = new Map<string, Income[]>();
    for (const [id, days] of employerCovers(data.jobs, data.income, data.employers, prefs.payer)) {
      const payment = byId.get(id);
      const own = payment?.jobId ? projectKeyOf.get(payment.jobId) : undefined;
      if (!payment) continue;
      for (const k of new Set(days.map(j => projectKeyOf.get(j.id) ?? j.id))) {
        if (k !== own) map.set(k, [...(map.get(k) ?? []), payment]);
      }
    }
    return map;
  }, [data.jobs, data.income, data.employers, prefs.payer, projectKeyOf]);

  // The first day worked for each employer: where a slow first check's wait
  // starts from.
  const firstDayAt = useMemo(() => {
    const first = new Map<string, string>();
    for (const j of data.jobs) {
      if (j.status === 'cancelled' || effectiveHoursWorked(j) <= 0) continue;
      const e = resolveEmployer(j.client, data.employers);
      if (e && (!first.has(e.id) || j.date < first.get(e.id)!)) first.set(e.id, j.date);
    }
    return first;
  }, [data.jobs, data.employers]);

  // Which unpaid invoice each shift is on, if any.
  const openInvoiceOf = useMemo(() => {
    const map = new Map<string, Invoice>();
    for (const v of data.invoices ?? []) {
      if (v.status === 'paid') continue;
      for (const l of v.lines) if (l.jobId) map.set(l.jobId, v);
    }
    return map;
  }, [data.invoices]);

  /** When a project's pay should be in: when its invoice is due, or by its employer's schedule. */
  const payDueFor = (jobs: Job[]) => {
    const invoiced = jobs.map(j => openInvoiceOf.get(j.id)).find(v => v?.dueDate);
    if (invoiced?.dueDate) return invoiced.dueDate;
    const lastDay = jobs.reduce((last, j) => (j.date > last ? j.date : last), jobs[0].date);
    const employer = resolveEmployer(jobs[0].client, data.employers);
    return payDueDate(lastDay, employer, employer ? firstDayAt.get(employer.id) : undefined);
  };

  // A project's pay periods, and what each should bring in.
  const splitPeriods = (jobs: Job[]) => projectPeriods(jobs, resolveEmployer(jobs[0].client, data.employers), data.jobs);
  const periodExpected = (p: ProjectPeriod) => periodNet(p, data.jobs, data.employers, prefs.payer);
  /** The pay period a shift is in, when its project is split across more than one. */
  const pieceOf = (lead: Job) => {
    const { periods } = splitPeriods(projectOf(lead, data.jobs, data.employers));
    return periods.length > 1 ? { periods, index: periods.findIndex(p => p.jobs.some(j => j.id === lead.id)) } : null;
  };

  const waitingOnPay = useMemo(() => {
    const todayKey = localToday();
    const groups = new Map<string, Job[]>();
    for (const j of data.jobs) {
      if (j.status === 'cancelled' || j.date > todayKey || effectiveHoursWorked(j) <= 0) continue;
      const k = projectGroupKey(j);
      groups.set(k, [...(groups.get(k) ?? []), j]);
    }
    const waiting: { key: string; jobs: Job[]; lastDay: string; due: string; expected: number }[] = [];
    const wait = (key: string, jobs: Job[]) => waiting.push({
      key,
      jobs,
      lastDay: jobs[jobs.length - 1].date,
      due: payDueFor(jobs),
      expected: jobs.reduce((sum, j) => sum + jobPayBreakdown(j, data.jobs, data.employers, prefs.payer).net, 0),
    });
    for (const [key, jobs] of groups) {
      const sorted = [...jobs].sort(compareCalls);
      const { periods } = splitPeriods(sorted);
      if (periods.length > 1) {
        // Two checks, each with its own due date: one paid leaves the other waiting.
        for (const p of periods) {
          const unpaid = sorted.filter(j => p.jobs.includes(j) && !paidJobIds.has(j.id));
          if (unpaid.length > 0) wait(`${key}|${p.start}`, unpaid);
        }
        continue;
      }
      // A part payment leaves the days it didn't reach still waiting.
      const unpaid = sorted.filter(j => !paidJobIds.has(j.id));
      if (unpaid.length > 0) wait(key, unpaid);
    }
    // Most overdue first: the one the alert is about.
    return waiting.sort((a, b) => a.due.localeCompare(b.due));
    // payDueFor reads firstDayAt, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.jobs, data.employers, incomeByProject, prefs.payer, firstDayAt, projectKeyOf, openInvoiceOf, paidJobIds]);
  const oldestWaiting = waitingOnPay[0];
  const daysPastDue = oldestWaiting ? differenceInCalendarDays(new Date(), parseISO(oldestWaiting.due)) : 0;
  const payTier: PayTimingTier = oldestWaiting ? payTimingTier(daysPastDue) : 'none';
  const overdueWaiting = waitingOnPay.filter(w => w.due <= localToday());
  // Worked shifts whose pay is past the day it was due, not on it: their money shows red.
  const latePayIds = useMemo(
    () => new Set(waitingOnPay.filter(w => w.due < localToday()).flatMap(w => w.jobs.map(j => j.id))),
    [waitingOnPay],
  );
  const overdueCount = overdueWaiting.length;
  /** Opens one shift from a to-do. */
  const openShift = (job: Job) => { setSelectedDate(job.date); setSelectedJobId(job.id); };
  const totalWaiting = waitingOnPay.reduce((sum, w) => sum + w.expected, 0);

  // Conferences: the days each is on, what Preamp says about them, the
  // month's, and the list they're kept in.
  const conferences = prefs.conferences;
  const conferenceOn = useMemo(() => conferenceDays(conferences), [conferences]);
  const conferenceAlertsNow = useMemo(() => conferenceAlerts(conferences, localToday()), [conferences]);
  const monthConfs = useMemo(
    () => monthConferences(conferences, currentDate.getFullYear(), currentDate.getMonth() + 1, localToday()),
    [conferences, currentDate],
  );
  const nextConference = useMemo(() => conferences
    .map(c => ({ c, next: nextShow(c, localToday()) }))
    .filter(x => x.next)
    .sort((a, b) => startOf(a.next!).localeCompare(startOf(b.next!)))[0]?.c, [conferences]);
  /** The project whose days are listed, from a tap on its bar on the month. */
  const [projectShown, setProjectShown] = useState<string | null>(null);
  const [conferencesOpen, setConferencesOpen] = useState(false);
  const [conferenceId, setConferenceId] = useState<string | null>(null);
  const openConferences = (id: string | null = null) => { setConferenceId(id); setConferencesOpen(true); };

  // Preamp's cards: each shows when it has something to say and its reminder
  // hasn't been turned off in Settings.
  const showHoursCard = reminderOn(prefs.reminders, 'hours') && jobsNeedingHours.length > 0;
  const showFlaggedCard = reminderOn(prefs.reminders, 'flagged') && flaggedJobs.length > 0;
  const showPayCard = reminderOn(prefs.reminders, 'latePay') && payTier !== 'none' && !!oldestWaiting;
  const showConferencesCard = reminderOn(prefs.reminders, 'conferences') && conferenceAlertsNow.length > 0;
  const certifyNow = prefs.certify ? certifyStatus(prefs.certify, localToday()) : null;
  const showCertifyCard = reminderOn(prefs.reminders, 'certify') && !!certifyNow?.remind;
  /** The claim page's week, so the certification's weeks match it. */
  const claimWeekEnd = (() => {
    try {
      const w = JSON.parse(localStorage.getItem('show-flow-claim-range') ?? 'null')?.weekEnd;
      return Number.isInteger(w) && w >= 0 && w <= 6 ? w : 6;
    } catch {
      return 6;
    }
  })();

  // The month's plans, for the key: each one, its colour, and its days.
  const monthPlans = useMemo(() => {
    const prefix = format(currentDate, 'yyyy-MM');
    const days = new Map<string, Set<number>>();
    for (const ev of data.events) {
      if (!ev.date?.startsWith(prefix)) continue;
      days.set(ev.title, (days.get(ev.title) ?? new Set()).add(Number(ev.date.slice(8))));
    }
    return [...days].map(([title, on]) => ({ title, color: planColor(title), days: [...on].sort((a, b) => a - b) }));
  }, [data.events, currentDate]);

  const [employerForCard, setEmployerForCard] = useState<{ client: string } | null>(null);

  const [rainActive, setRainActive] = useState(false);
  const rain = () => { setRainActive(true); setTimeout(() => setRainActive(false), 2100); };

  const undoToast = (message: string, undo: () => void) =>
    toast.success(message, { duration: 8000, action: { label: 'Undo', onClick: undo } });

  /**
   * The 💰 on a project. If it was paid once and then unmarked, that payment —
   * the real check, the real amount — is still here, set aside; it comes back
   * rather than a new guess being recorded over it. Only a project never paid
   * gets a new payment, at what its unpaid days were expected to pay. On a
   * project across pay periods, all of that is true of the shift's period.
   */
  const markProjectPaid = async (lead: Job) => {
    const project = projectOf(lead, data.jobs, data.employers);
    const piece = pieceOf(lead);
    const scope = (piece && piece.periods[piece.index]?.jobs) || project;
    const setAside = (incomeByProject.get(projectGroupKey(lead)) ?? [])
      .filter(i => i.status === 'pending' && scope.some(j => j.id === i.jobId));
    if (setAside.length > 0) {
      for (const i of setAside) await updateIncome(i.id, { status: 'paid' });
      rain();
      const back = setAside.reduce((sum, i) => sum + i.amount, 0);
      undoToast(`Money in — $${back.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, () => {
        for (const i of setAside) void updateIncome(i.id, { status: 'pending' });
      });
      return;
    }
    const workedAll = scope.filter(j => effectiveHoursWorked(j) > 0 && j.date <= localToday());
    // After a part payment, only the days it didn't reach.
    const owed = workedAll.filter(j => !paidJobIds.has(j.id));
    const worked = owed.length > 0 ? owed : workedAll;
    const amount = Math.round(worked.reduce((sum, j) => sum + jobPayBreakdown(j, data.jobs, data.employers, prefs.payer).net, 0) * 100) / 100;
    if (worked.length === 0 || amount <= 0) {
      // Nothing to estimate from: the shift itself has Add pay.
      setSelectedDate(lead.date);
      setSelectedJobId(lead.id);
      return;
    }
    const created = await addIncome({
      jobId: worked[0].id, client: worked[0].client, description: 'Marked paid', amount, matchProof: { ...proofFromMatch('marked'), covers: worked.map(j => j.id) },
      date: localToday(), status: 'paid', enteredByHand: true,
    });
    rain();
    undoToast(`Marked paid — $${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, () => void deleteIncome(created.id));
  };

  /**
   * The card's Undo for "paid". The project's payments are set aside, not
   * deleted — so Mark paid, or Undo on the toast, brings back the very same
   * ones, and a check never has to be entered twice. On a project across pay
   * periods it's the payments that paid this shift's period.
   */
  const unmarkProjectPaid = async (lead: Job) => {
    const all = (incomeByProject.get(projectGroupKey(lead)) ?? []).filter(i => i.status === 'paid');
    const piece = pieceOf(lead);
    const paid = piece ? (periodPayments(piece.periods, all, periodExpected).get(piece.index) ?? []) : all;
    for (const i of paid) await updateIncome(i.id, { status: 'pending' });
    undoToast('Set back to waiting on pay', () => { for (const i of paid) void updateIncome(i.id, { status: 'paid' }); });
  };

  // Payments that came in with no shift to their name, each with the project
  // it most likely paid.
  const unlinkedPayments = useMemo(() => {
    const ids = new Set(data.jobs.map(j => j.id));
    // An invoice's payment for something that was not a shift is meant to have none.
    const fromInvoices = new Set((data.invoices ?? []).flatMap(v => v.paidIncomeIds ?? []));
    return data.income
      .filter(i => i.status === 'paid' && (!i.jobId || !ids.has(i.jobId)) && !fromInvoices.has(i.id))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.jobs, data.income, data.invoices]);
  const linkSuggestions = useMemo(() => {
    const ctx = { allJobs: data.jobs, employers: data.employers, payer: prefs.payer, paidJobIds };
    return new Map(unlinkedPayments.map(i => [i.id, rankedProjectsFor({ amount: i.amount, date: i.date, payer: i.client }, ctx)]));
  }, [unlinkedPayments, data.jobs, data.employers, prefs.payer, paidJobIds]);

  const linkPayment = async (payment: Income, job: Job, match?: ProjectMatch) => {
    await updateIncome(payment.id, { jobId: job.id, matchProof: proofFromMatch(proofKindOf(payment), match) });
    undoToast(`Linked to ${job.name}`, () => void updateIncome(payment.id, { jobId: undefined, matchProof: payment.matchProof }));
  };

  // Per-job expected pay — the single source of truth behind the calendar's
  // day/week/month totals below AND the "Awaiting payment" list, so they can
  // never drift out of sync with each other. Delegates to jobGross (dues,
  // taxes, weekly OT bonus, vacation pay and all) instead of re-deriving the
  // same math locally — a previous local copy here left vacation pay out of
  // these totals while the per-job display included it, so the two disagreed.
  const jobPay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const job of data.jobs) {
      const pay = jobPayBreakdown(job, data.jobs, data.employers, prefs.payer)[payView];
      if (pay > 0) map[job.id] = pay;
    }
    return map;
  }, [data.jobs, data.employers, prefs.payer, payView]);

  const payByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const job of data.jobs) {
      const pay = jobPay[job.id];
      if (!pay) continue;
      map[job.date] = (map[job.date] || 0) + pay;
    }
    return map;
  }, [data.jobs, jobPay]);

  // ── This Month / YTD summary (moved here from Dashboard) ────────────────
  // "This Month" tracks whatever month you've navigated to (currentDate),
  // not literally today's real month — it lives on the calendar you're
  // actively browsing, so it should follow you when you page forward/back.
  const monthYtdStats = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const monthJobs = data.jobs.filter(j => {
      try { return isWithinInterval(parseISO(j.date), { start: monthStart, end: monthEnd }); }
      catch { return false; }
    });
    const monthHours = monthJobs.reduce((s, j) => s + netHoursWorked(j), 0);
    const monthExpected = monthJobs.reduce((s, j) => s + jobGross(j, data.jobs, data.employers, prefs.payer), 0);
    const grossOf = (jobs: Job[]) => jobs.reduce((s, j) => s + jobPayBreakdown(j, data.jobs, data.employers, prefs.payer).gross, 0);

    // A payment belongs to the month of the work it paid for, not the month
    // the cheque turned up. Dating it by arrival put September's money in
    // October, so October showed pay against no hours and September looked
    // unpaid. Income with no shift behind it has only its own date to go on.
    const workDateFor = (i: { jobId?: string; date: string }) => {
      const job = i.jobId ? data.jobs.find(j => j.id === i.jobId) : undefined;
      return job ? job.date : i.date;
    };
    const paidIn = (test: (workDate: string) => boolean) => data.income
      .filter(i => i.status === 'paid' && test(workDateFor(i)))
      .reduce((sum, i) => sum + i.amount, 0);

    const monthPaid = paidIn(d => {
      try { return isWithinInterval(parseISO(d), { start: monthStart, end: monthEnd }); }
      catch { return false; }
    });

    const yearPrefix = format(currentDate, 'yyyy');
    const ytdJobs = data.jobs.filter(j => j.date.startsWith(yearPrefix));
    const ytdHours = ytdJobs.reduce((s, j) => s + netHoursWorked(j), 0);
    const ytdExpected = ytdJobs.reduce((s, j) => s + jobGross(j, data.jobs, data.employers, prefs.payer), 0);
    const ytdPaid = paidIn(d => d.startsWith(yearPrefix));

    return {
      month: { label: format(currentDate, 'MMM'), hours: monthHours, gross: grossOf(monthJobs), expected: monthExpected, paid: monthPaid, unpaid: Math.max(0, monthExpected - monthPaid) },
      ytd: { label: yearPrefix, hours: ytdHours, gross: grossOf(ytdJobs), expected: ytdExpected, paid: ytdPaid, unpaid: Math.max(0, ytdExpected - ytdPaid) },
    };
  }, [data.jobs, data.income, data.employers, currentDate, prefs.payer]);

  // The month in view a week at a time (Sunday to Saturday, as the grid
  // runs): shifts, hours, the estimate and what's come in for each week's
  // work. Whole weeks, so one that starts in last month counts all its days.
  const weekRows = useMemo(() => {
    const today = localToday();
    const workDateFor = (i: { jobId?: string; date: string }) => (i.jobId ? data.jobs.find(j => j.id === i.jobId)?.date : undefined) ?? i.date;
    const rows: { from: string; to: string; shifts: number; hours: number; estimate: number; paid: number; isNow: boolean }[] = [];
    const last = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
    for (let w = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 }); w <= last; w = addDays(w, 7)) {
      const from = format(w, 'yyyy-MM-dd');
      const to = format(addDays(w, 6), 'yyyy-MM-dd');
      const jobs = data.jobs.filter(j => j.date >= from && j.date <= to && j.status !== 'cancelled');
      const worked = jobs.filter(j => netHoursWorked(j) > 0);
      rows.push({
        from, to,
        // A split day's calls are one shift.
        shifts: splitShifts(worked).length,
        hours: worked.reduce((s, j) => s + netHoursWorked(j), 0),
        estimate: worked.reduce((s, j) => s + jobPayBreakdown(j, data.jobs, data.employers, prefs.payer)[payView], 0),
        paid: data.income.filter(i => i.status === 'paid' && workDateFor(i) >= from && workDateFor(i) <= to).reduce((s, i) => s + i.amount, 0),
        isNow: today >= from && today <= to,
      });
    }
    return rows;
  }, [data.jobs, data.income, data.employers, prefs.payer, payView, currentDate]);

  // Dates that are the 6th+ day in a row — marked whether or not the employer
  // pays extra for it, so one that should can be caught, with what it pays.
  const sixthSeventhDayDates = useMemo(() => {
    // Today's call counts once it has started, before any hours are in: it's
    // being worked, so a 6th or 7th day lights up while you're on it.
    const today = localToday();
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const startedToday = (j: Job) => j.date === today && !j.pto && !j.hoursWorked && !!j.startTime
      && j.status !== 'cancelled' && parseTimeToMins(j.startTime) <= nowMins;
    const streakJobs = data.jobs.map(j => (startedToday(j) ? { ...j, hoursWorked: 0.01, hoursPlanned: false } : j));
    const map: Record<string, PremiumDay> = {};
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      for (const shown of jobs) {
        const job = startedToday(shown) ? { ...shown, hoursWorked: 0.01, hoursPlanned: false } : shown;
        if (effectiveHoursWorked(job) <= 0) continue;
        const employer = resolveEmployer(job.client, data.employers);
        const day = dayInARow(job, employer, streakJobs);
        if (day >= 6 && day > (map[date]?.day ?? 0)) {
          map[date] = { day, pays: dayMultiplierFor(job, employer, streakJobs), who: job.client };
        }
      }
    }
    return map;
  }, [jobsByDate, data.jobs, data.employers]);

  // Opening a premium day, or a shift on one, is worth a party, every time:
  // close it and open it again and it rains again. Saving a change doesn't.
  const [partyBurst, setPartyBurst] = useState(0);
  const premiumDatesRef = useRef(sixthSeventhDayDates);
  premiumDatesRef.current = sixthSeventhDayDates;
  const jobsRef = useRef(data.jobs);
  jobsRef.current = data.jobs;
  useEffect(() => {
    const date = selectedJobId ? jobsRef.current.find(j => j.id === selectedJobId)?.date : selectedDate;
    if (!date || !(premiumDatesRef.current[date]?.pays > 1)) return;
    setPartyBurst(b => b + 1);
  }, [selectedDate, selectedJobId]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
    const days: Date[] = [];
    let d = start;
    while (d <= end) { days.push(d); d = addDays(d, 1); }
    return days;
  }, [currentDate]);

  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < monthDays.length; i += 7) result.push(monthDays.slice(i, i + 7));
    return result;
  }, [monthDays]);

  // Each employer's own colour on the grid (see employerColours): handed out
  // in the order you first worked for them, so a regular keeps theirs.
  const employerColourOf = useMemo(() => {
    const workedFor = (j: Job) => (j.status === 'cancelled' ? undefined : projectNameOf.get(projectKeyOf.get(j.id) ?? j.id));
    const order = [...data.jobs].sort((a, b) => a.date.localeCompare(b.date)).map(workedFor).filter((n): n is string => !!n);
    const shown = weeks.flat().flatMap(d => (jobsByDate[format(d, 'yyyy-MM-dd')] ?? []).map(workedFor)).filter((n): n is string => !!n);
    return employerColours(order, shown);
  }, [data.jobs, weeks, jobsByDate, projectNameOf, projectKeyOf]);
  const employerColour = (name: string) => `hsl(${employerColourOf.get(employerId(name)) ?? EMPLOYER_COLOURS[0]})`;

  // The month's employers, for the key: each one, its colour, and its days.
  const monthEmployers = useMemo(() => {
    const prefix = format(currentDate, 'yyyy-MM');
    const days = new Map<string, { title: string; days: Set<number> }>();
    for (const j of data.jobs) {
      if (j.status === 'cancelled' || !j.date?.startsWith(prefix)) continue;
      const name = projectNameOf.get(projectKeyOf.get(j.id) ?? j.id);
      if (!name) continue;
      const id = employerId(name);
      const entry = days.get(id) ?? { title: name, days: new Set<number>() };
      entry.days.add(Number(j.date.slice(8)));
      days.set(id, entry);
    }
    return [...days.entries()]
      .map(([id, { title, days: on }]) => ({ title, color: `hsl(${employerColourOf.get(id) ?? EMPLOYER_COLOURS[0]})`, days: [...on].sort((a, b) => a - b) }))
      .sort((a, b) => a.days[0] - b.days[0] || a.title.localeCompare(b.title));
  }, [data.jobs, currentDate, projectNameOf, projectKeyOf, employerColourOf]);

  const yearStats = useMemo(() => {
    const prefix = `${currentYear}-`;
    let totalJobs = 0, totalHours = 0, totalPay = 0;
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      if (!date.startsWith(prefix)) continue;
      totalJobs += jobs.length;
      totalHours += jobs.reduce((s, j) => s + netHoursWorked(j), 0);
      totalPay += payByDate[date] || 0;
    }
    return { totalJobs, totalHours, totalPay };
  }, [jobsByDate, payByDate, currentYear]);

  // The shifts behind the year total, so it takes the colour its days would.
  const yearJobsInView = useMemo(
    () => data.jobs.filter(j => j.date.startsWith(`${currentYear}-`)),
    [data.jobs, currentYear],
  );

  const today = new Date();
  const selectedJobs = selectedDate ? (jobsByDate[selectedDate] || []) : [];
  const selectedJob = selectedJobId ? data.jobs.find(j => j.id === selectedJobId) ?? null : null;
  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];
  const selectedConferences = selectedDate ? (conferenceOn.get(selectedDate) ?? []) : [];
  const closeDialog = () => {
    setSelectedDate(null); setSelectedJobId(null); setAddingEventDate(null); setEditingEventId(null);
    // A shift opened from another page: back to that page, where it was left.
    if (returnTo.current) { returnTo.current = null; navigate(-1); }
  };

  // Swipe left = tomorrow, right = yesterday — jumps straight into that day's
  // job if there's exactly one, otherwise falls back to the day's job list.
  const navigateDay = (deltaDays: number) => {
    if (!selectedDate) return;
    const next = addDays(new Date(selectedDate + 'T12:00:00'), deltaDays);
    const nextKey = format(next, 'yyyy-MM-dd');
    const nextJobs = jobsByDate[nextKey] || [];
    setSelectedDate(nextKey);
    setSelectedJobId(nextJobs.length === 1 ? nextJobs[0].id : null);
  };
  const daySwipe = useSwipe(() => navigateDay(-1), () => navigateDay(1));

  return (
    <SpacePageWrapper
      bleed
      title="Calendar"
      description={<span className="hidden sm:inline">{viewMode === 'year' ? 'Your year at a glance' : 'Your month at a glance'}</span>}
      action={
        // Short, in the trade's words, on one row beside the lamp: Load-in
        // brings in work (an offer or a job), Timecode logs hours worked, Cue
        // sets a plan. Each says what it does in full to a screen reader.
        <div className="flex flex-wrap gap-1.5" data-testid="calendar-adds">
          <button
            onClick={() => setQuickAddShiftOpen(true)}
            aria-label="Load-in: add a job or an offer" title="Add a job or an offer"
            className="flex shrink-0 items-center gap-1 whitespace-nowrap border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary px-2 py-1.5 text-[11px] font-semibold transition-colors"
          >
            <Rocket size={13} aria-hidden /> Load-in
          </button>
          {/* Hours are a separate way in now, not something the intake box is
              asked to recognise. */}
          <button
            onClick={() => setQuickAddHoursOpen(true)}
            aria-label="Timecode: add hours worked" title="Add hours worked"
            className="flex shrink-0 items-center gap-1 whitespace-nowrap border border-accent/40 bg-accent/10 hover:bg-accent/20 text-accent px-2 py-1.5 text-[11px] font-semibold transition-colors"
          >
            <Timer size={13} aria-hidden /> Timecode
          </button>
          <button
            onClick={() => setQuickAddOpen(true)}
            aria-label="Cue: make a plan" title="Make a plan"
            className="flex shrink-0 items-center gap-1 whitespace-nowrap border border-info/40 bg-info/10 hover:bg-info/20 text-info px-2 py-1.5 text-[11px] font-semibold transition-colors"
          >
            <Orbit size={13} aria-hidden /> Cue
          </button>
        </div>
      }
    >
        <LiveWorkPay />

      {/* To-dos live in Preamp, opened from the filament lamp, which runs red
          hot while there are any, instead of stacking above the month. */}
      <PreampSheet count={[showHoursCard, showFlaggedCard, showPayCard, showConferencesCard, showCertifyCard].filter(Boolean).length}>
      {showCertifyCard && certifyNow && prefs.certify && (() => {
        const period = certifyPeriod(prefs.certify, claimWeekEnd);
        const span = `${showDay(period.from)} – ${showDay(period.through)}`;
        return (
          <PreampGroup
            testId="preamp-certify"
            icon={<ClipboardCheck size={18} className={cn('shrink-0', certifyNow.days < 0 ? 'text-dot-late' : 'text-primary')} aria-hidden />}
            title={`Certify for unemployment · ${dueText(certifyNow.days)}`}
            summary={`For ${span}: your hours and pay are ready`}
            tone={certifyNow.days < 0 ? 'border-dot-late/60 bg-dot-late/10' : 'border-primary/60 bg-primary/10'}
            titleTone={certifyNow.days < 0 ? 'text-dot-late' : 'text-primary'}
            items={[{ key: 'certify', title: 'Certify', detail: span, open: () => navigate('/benefits/unemployment', { state: { certify: true } }) }]}
          />
        );
      })()}
      {showHoursCard && (
        <PreampGroup
          testId="preamp-hours"
          icon={<Zap size={18} className="text-accent shrink-0" />}
          title={`Log hours${jobsNeedingHours.length > 1 ? ` — ${jobsNeedingHours.length} shifts` : ''}`}
          summary={`${jobsNeedingHours[0].name} · ${oldestDays === 0 ? 'today' : `${oldestDays}d ago`}`}
          tone="border-accent/60 bg-accent/10" titleTone="text-accent"
          items={jobsNeedingHours.map(job => {
            const ago = differenceInCalendarDays(new Date(), parseISO(job.date));
            return {
              key: job.id,
              title: job.name,
              detail: `${format(parseISO(job.date), 'EEE, MMM d')}${job.client ? ` · ${job.client}` : ''}`,
              aside: ago <= 0 ? 'today' : `${ago}d ago`,
              open: () => openShift(job),
            };
          })}
        />
      )}

      {/* "Check this one later" used to set a flag nothing else ever showed.
          This is where it comes back, every flagged shift a tap away, until
          the box is unticked. */}
      {showFlaggedCard && (
        <PreampGroup
          testId="preamp-flagged"
          icon={<Flag size={18} className="text-warning shrink-0" aria-hidden />}
          title={`Check later${flaggedJobs.length > 1 ? ` — ${flaggedJobs.length} shifts` : ''}`}
          summary={`${flaggedJobs[0].name} · ${format(new Date(flaggedJobs[0].date + 'T12:00:00'), 'MMM d')} — ${reviewReason(flaggedJobs[0]).text}`}
          tone="border-warning/60 bg-warning/10" titleTone="text-warning"
          items={flaggedJobs.map(job => ({
            key: job.id,
            title: job.name,
            detail: `${format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d')} — ${reviewReason(job).text}`,
            open: () => openShift(job),
          }))}
        />
      )}

      {showPayCard && oldestWaiting && (
        <PreampGroup
          testId="preamp-pay"
          icon={payTier === 'watching' ? <Eye size={18} className="text-primary shrink-0" />
            : payTier === 'warm' ? <Flame size={18} className="flame-flicker text-warning shrink-0" />
            : <span className="flame-flicker text-xl shrink-0">🔥</span>}
          title={`${PAY_TIMING_LABELS[payTier]} — pay is late${overdueCount > 1 ? ` · ${overdueCount} projects` : ''}`}
          summary={`$${Math.round(totalWaiting).toLocaleString()} out · ${oldestWaiting.jobs[0].name} was due ${format(parseISO(oldestWaiting.due), 'MMM d')}${daysPastDue > 0 ? ` · ${daysPastDue}d late` : ''}`}
          tone={payTier === 'watching' ? 'border-primary/60 bg-primary/10' : payTier === 'warm' ? 'border-warning/60 bg-warning/10' : 'border-destructive/60 bg-destructive/10'}
          titleTone={payTier === 'watching' ? 'text-primary' : payTier === 'warm' ? 'text-warning' : 'text-destructive'}
          items={(overdueWaiting.length > 0 ? overdueWaiting : [oldestWaiting]).map(w => {
            const late = differenceInCalendarDays(new Date(), parseISO(w.due));
            const first = w.jobs[0];
            const days = w.jobs.length;
            return {
              key: w.key,
              title: first.name,
              detail: `${first.client ? `${first.client} · ` : ''}${days === 1 ? format(parseISO(first.date), 'MMM d') : `${format(parseISO(first.date), 'MMM d')}–${format(parseISO(w.lastDay), 'MMM d')}, ${days} days`} · due ${format(parseISO(w.due), 'MMM d')}${late > 0 ? `, ${late}d late` : ''}`,
              aside: `$${Math.round(w.expected).toLocaleString()}`,
              open: () => openShift(first),
            };
          })}
        />
      )}

      {/* Conferences coming up, and ones whose new dates need looking up. */}
      {showConferencesCard && (
        <PreampGroup
          testId="preamp-conferences"
          icon={<Presentation size={18} className="shrink-0" style={{ color: conferenceColour() }} aria-hidden />}
          title={`Conferences${conferenceAlertsNow.length > 1 ? ` — ${conferenceAlertsNow.length}` : ''}`}
          summary={conferenceItem(conferenceAlertsNow[0]).line}
          tone="border-[hsl(46_100%_58%/0.6)] bg-[hsl(46_100%_58%/0.1)]" titleTone="text-[hsl(46_100%_58%)]"
          items={conferenceAlertsNow.map(a => ({ key: a.conference.id, ...conferenceItem(a), open: () => openConferences(a.conference.id) }))}
        />
      )}
      </PreampSheet>

      <MoneyRain active={rainActive} />
      <MoneyRain burst={partyBurst} party />

      <div className="flex items-center gap-2 mb-3">
        <div className="flex flex-1 bg-secondary/30 rounded-lg p-0.5">
          <button onClick={() => setViewMode('month')} className={cn("flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors", viewMode === 'month' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Month</button>
          <button onClick={() => setViewMode('year')} className={cn("flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors", viewMode === 'year' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Year</button>
        </div>
        <div className="flex shrink-0 bg-secondary/30 rounded-lg p-0.5" role="group" aria-label="Which estimate to show">
          {([{ id: 'net', label: 'Est. net' }, { id: 'gross', label: 'Est. gross' }] as const).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={payView === id}
              onClick={() => setCalendarPay(id)}
              className={cn("text-[10px] text-mono font-medium py-1 px-2 rounded-md transition-colors", payView === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        {viewMode === 'month' && <CalendarKey month={format(currentDate, 'MMMM')} employers={monthEmployers} plans={monthPlans} states={SHIFT_STATES} />}
      </div>

      <div className="flex items-stretch justify-between mb-3 gap-2">
        <button
          onClick={() => viewMode === 'month' ? setCurrentDate(prev => subMonths(prev, 1)) : setCurrentYear(prev => prev - 1)}
          className="flex items-center justify-center w-12 min-h-[44px] rounded-md bg-primary/30 active:bg-primary/50 text-primary transition-colors border border-primary/40"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <h2 className="neon-title font-body text-base font-semibold tracking-wide">
            {viewMode === 'month' ? format(currentDate, 'MMMM yyyy') : currentYear}
          </h2>
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 rounded-full"
            onClick={() => { setCurrentDate(new Date()); setCurrentYear(new Date().getFullYear()); }}>
            Today
          </Button>
        </div>
        <button
          onClick={() => viewMode === 'month' ? setCurrentDate(prev => addMonths(prev, 1)) : setCurrentYear(prev => prev + 1)}
          className="flex items-center justify-center w-12 min-h-[44px] rounded-md bg-primary/30 active:bg-primary/50 text-primary transition-colors border border-primary/40"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {viewMode === 'month' && (
        <>
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="grid grid-cols-7 flex-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i} className="neon-soft text-center text-[10px] text-[hsl(188_90%_72%)] text-mono py-1 font-medium">{d}</div>
              ))}
            </div>
          </div>
          <div className="neon-grid" data-testid="month-grid">
          {weeks.map((week, wi) => {
            // Each project's employer, once across its days in this row.
            const { spans, levels } = spansFor(week);
            // Top to bottom in every square: the 6th/7th-day banner (only in a
            // week that has one), the employer's name, the date, the money.
            // Every week keeps a row for names and one for money, so the
            // dates line up down the month.
            const banner = week.some(d => sixthSeventhDayDates[format(d, 'yyyy-MM-dd')]) ? BANNER_ROW : 0;
            const nameRows = Math.max(levels, 1);
            return (
            // A faint line between weeks, and between days, so each square reads as one.
            <div key={wi} className="neon-week relative grid grid-cols-7">
                {/* Each project: a bar in its employer's colour across its
                    days, no words. Tapped, it lists the project's days. */}
                {spans.map(span => {
                  const multi = span.to > span.from;
                  // A closed end stops short of the line between days; a
                  // one-day bar is a dash in the middle of its square.
                  const inset = (open: boolean) => (open ? 0 : multi ? 4 : 10);
                  const colour = employerColour(span.name);
                  return (
                    <button key={span.key + span.from} type="button" data-testid="project-span"
                      aria-label={`${span.name}: show this project's days`}
                      onClick={() => setProjectShown(span.key)}
                      className="absolute z-[5] flex items-center"
                      style={{
                        left: `calc(${(span.from / 7) * 100}% + ${inset(span.openLeft)}px)`,
                        width: `calc(${((span.to - span.from + 1) / 7) * 100}% - ${inset(span.openLeft) + inset(span.openRight)}px)`,
                        // At the top: under 6px of padding and any banner, row 0 first.
                        top: 6 + banner + span.level * SPAN_ROW,
                        height: SPAN_ROW,
                      }}>
                      <span className={cn('h-1 w-full', !span.openLeft && 'rounded-l-full', !span.openRight && 'rounded-r-full')}
                        style={{ background: colour, boxShadow: `0 0 6px ${colour}` }} />
                    </button>
                  );
                })}
                {week.map((day, i) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayJobs = jobsByDate[dateKey] || [];
                  const dayEvents = eventsByDate[dateKey] || [];
                  const dayConfs = conferenceOn.get(dateKey) ?? [];
                  const todayFlag = isSameDay(day, today);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const liveJobs = dayJobs.filter(j => j.status !== 'cancelled');
                  const hasEvents = dayEvents.length > 0;
                  const hasPay = !!payByDate[dateKey];
                  const sixthSeventhStreak = sixthSeventhDayDates[dateKey];
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedDate(dateKey)}
                      title={sixthSeventhStreak ? `${ordinal(sixthSeventhStreak.day)} day in a row` : "Tap to add a plan or view this day"}
                      className={cn(
                        "relative flex flex-col items-center py-1.5 transition-colors cursor-pointer active:bg-secondary/60 hover:bg-secondary/30",
                        i > 0 && 'neon-day',
                        !isCurrentMonth && 'opacity-30',
                        todayFlag && 'bg-primary/10',
                        // A sheen and a lit edge, not a fill: the date and money keep their colours.
                        sixthSeventhStreak && (sixthSeventhStreak.day >= 7 ? 'sheen-7' : 'sheen-6')
                      )}
                      data-premium={sixthSeventhStreak ? sixthSeventhStreak.day : undefined}
                    >
                      {/* The 6th/7th-day banner, inside the square, at its top. */}
                      {banner > 0 && (
                        <span data-premium-tag={sixthSeventhStreak ? '' : undefined}
                          className="sheen-tag flex shrink-0 items-center gap-0.5 text-[8px] font-black uppercase text-mono leading-none"
                          style={{ height: banner }}>
                          {sixthSeventhStreak && (
                            <>
                              {ordinal(sixthSeventhStreak.day)}
                              <span className="text-[9px]" aria-hidden="true">{sixthSeventhStreak.pays >= 2 ? '🤑' : sixthSeventhStreak.pays > 1 ? '💰' : '🔥'}</span>
                            </>
                          )}
                        </span>
                      )}
                      {/* Room for the project bars drawn across the top. */}
                      <span aria-hidden="true" className="block shrink-0" style={{ height: nameRows * SPAN_ROW + 1 }} />
                      {todayFlag ? (
                        <span className="relative w-6 h-6 flex items-center justify-center">
                          <Star size={24} className="absolute text-primary fill-primary drop-shadow-[0_0_5px_hsl(var(--primary))]" />
                          <span className="relative text-xs text-mono leading-none text-primary-foreground font-bold">{format(day, 'd')}</span>
                        </span>
                      ) : dayConfs.length > 0 ? (
                        // A conference day's date is gold: the mark sits on the day itself.
                        <span data-testid="conference-mark" aria-label={`${format(day, 'd')}, conference: ${dayConfs.map(c => c.name).join(', ')}`}
                          className="neon-soft text-xs text-mono font-bold leading-none w-6 h-6 flex items-center justify-center" style={{ color: conferenceColour() }}>
                          {format(day, 'd')}
                        </span>
                      ) : (
                        <span className="text-xs text-mono leading-none w-6 h-6 flex items-center justify-center text-foreground">{format(day, 'd')}</span>
                      )}
                      {/* At the bottom, the day's money, in the colour that
                          says where it stands. Before there's pay to show,
                          the call time, in the same colours. The row is kept
                          on an empty day so the dates stay in line. */}
                      {liveJobs.length > 0 ? (
                        <span data-testid="day-money" className={cn("mt-0.5 h-3 text-[10px] text-mono font-semibold leading-3", moneyTone(liveJobs, paidJobIds, latePayIds))}>
                          {hasPay ? shortDollars(payByDate[dateKey]) : shortCall(liveJobs[0].startTime) || 'call'}
                        </span>
                      ) : <span aria-hidden="true" className="mt-0.5 block h-3 shrink-0" />}
                      {/* Plans underline the cell instead of taking a dot in the
                          job row — a recurring one then reads as a stripe down
                          the month, which a dot never did. */}
                      {hasEvents && (
                        <span className="absolute inset-x-1 bottom-0 flex h-[3px] gap-px" aria-hidden="true">
                          {dayEvents.slice(0, 3).map((ev, j) => (
                            <span key={j} className="flex-1" style={{ background: planColor(ev.title) }} />
                          ))}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
            );
          })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1" data-testid="money-key">
            {SHIFT_STATES.map(({ text, label }) => (
              <span key={label} className={cn('text-[10px] text-mono font-semibold uppercase tracking-wider', text)}>{label}</span>
            ))}
          </div>

          <div className="mt-4" data-testid="month-conferences">
            <div className="flex items-center justify-between px-1 pb-1 border-b border-border/30">
              <span className="flex items-center gap-1 text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50">
                <Presentation size={10} aria-hidden /> Conferences
              </span>
              <button type="button" onClick={() => openConferences()} className="text-[10px] text-mono font-semibold" style={{ color: conferenceColour() }} data-testid="open-conferences">
                {conferences.length > 0 ? `All ${conferences.length} →` : '+ Watch one'}
              </button>
            </div>
            {monthConfs.map(({ conference: c, dates }) => (
              <button key={c.id} type="button" onClick={() => openConferences(c.id)} className="flex w-full items-center justify-between gap-2 px-1 py-1 text-left">
                <span className="truncate text-[11px]">{c.name}{c.where && <span className="text-muted-foreground"> · {c.where}</span>}</span>
                <span className={cn('shrink-0 text-[10px] text-mono', !dates && 'text-warning')} style={dates ? { color: conferenceColour() } : undefined}>
                  {dates ? spanText(dates) : 'dates not in'}
                </span>
              </button>
            ))}
            {monthConfs.length === 0 && nextConference && (
              <button type="button" onClick={() => openConferences(nextConference.id)} className="flex w-full items-center justify-between gap-2 px-1 py-1 text-left text-muted-foreground">
                <span className="truncate text-[11px]">Next: {nextConference.name}</span>
                <span className="shrink-0 truncate text-[10px] text-mono">{whenText(nextConference, localToday())}</span>
              </button>
            )}
          </div>
        </>
      )}

      {viewMode === 'year' && (
        <>
          <div className="grid grid-cols-3 gap-x-2 gap-y-3">
            {Array.from({ length: 12 }, (_, mi) => {
              const monthStart = new Date(currentYear, mi, 1);
              const monthPrefix = format(monthStart, 'yyyy-MM');
              let monthPay = 0, monthJobs = 0;
              const monthShifts: Job[] = [];
              for (const [date, jobs] of Object.entries(jobsByDate)) {
                if (!date.startsWith(monthPrefix)) continue;
                monthJobs += jobs.length;
                monthShifts.push(...jobs);
                monthPay += payByDate[date] || 0;
              }
              const daysInMonth = new Date(currentYear, mi + 1, 0).getDate();
              const firstDow = new Date(currentYear, mi, 1).getDay();
              const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
              while (cells.length % 7 !== 0) cells.push(null);
              return (
                <div
                  key={mi}
                  onClick={() => { setCurrentDate(monthStart); setViewMode('month'); }}
                  className="cursor-pointer rounded-md -m-1 p-1 transition-colors hover:bg-secondary/40"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-[9px] font-body font-medium uppercase tracking-wider text-foreground/60">{format(monthStart, 'MMM')}</p>
                    {monthPay > 0 && <span className={cn("text-[7px] text-mono font-semibold", moneyTone(monthShifts, paidJobIds, latePayIds))}>${monthPay >= 1000 ? `${(monthPay / 1000).toFixed(1)}k` : monthPay.toFixed(0)}</span>}
                  </div>
                  <div className="grid grid-cols-7 gap-px">
                    {cells.map((day, ci) => {
                      if (!day) return <div key={ci} className="h-3" />;
                      const dateKey = `${monthPrefix}-${String(day).padStart(2, '0')}`;
                      const dayJobs = jobsByDate[dateKey] || [];
                      const todayFlag = isSameDay(new Date(currentYear, mi, day), today);
                      const hasPaid = dayJobs.some(j => paidJobIds.has(j.id));
                      const hasCompleted = dayJobs.some(j => j.status === 'completed');
                      const hasUpcoming = dayJobs.some(j => j.status === 'upcoming' || j.status === 'in-progress');
                      return (
                        <div
                          key={ci}
                          onClick={(e) => { if (dayJobs.length > 0) { e.stopPropagation(); setSelectedDate(dateKey); } }}
                          className={cn('h-3 flex items-center justify-center text-[6px] text-mono rounded-[2px] transition-colors select-none', dayJobs.length > 0 && 'cursor-pointer', hasPaid && 'bg-dot-paid/30 text-dot-paid font-semibold', !hasPaid && hasCompleted && 'bg-dot-pending/25 text-dot-pending', !hasPaid && !hasCompleted && hasUpcoming && 'bg-dot-upcoming/20 text-dot-upcoming', !dayJobs.length && 'text-muted-foreground/25', todayFlag && 'ring-1 ring-inset ring-primary/70', sixthSeventhDayDates[dateKey] && cn(premiumClass(sixthSeventhDayDates[dateKey]), 'font-black'))}
                        >
                          {day}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-md border border-border/40 bg-secondary/10 p-3">
            <p className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 mb-2">{currentYear} Total</p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{yearStats.totalJobs > 0 ? `${yearStats.totalJobs} job${yearStats.totalJobs !== 1 ? 's' : ''}` : 'No jobs yet'}</span>
              <div className="flex items-center gap-3">
                {yearStats.totalHours > 0 && <span className="text-xs text-mono font-semibold text-primary">{roundHours(yearStats.totalHours)}h</span>}
                {yearStats.totalPay > 0 && <span className={cn("text-xs text-mono font-bold", moneyTone(yearJobsInView, paidJobIds, latePayIds))}>${yearStats.totalPay >= 1000 ? `${(yearStats.totalPay / 1000).toFixed(1)}k` : yearStats.totalPay.toFixed(0)}</span>}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 px-1">
            <span className="text-[8px] text-muted-foreground/40 font-body uppercase tracking-wider">Legend</span>
            {[{ color: 'bg-dot-upcoming/20', label: 'Upcoming' }, { color: 'bg-dot-pending/25', label: 'Pending' }, { color: 'bg-dot-paid/30', label: 'Paid' }].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={cn('w-3 h-3 rounded-[2px]', color)} />
                <span className="text-[8px] text-muted-foreground/50 font-body">{label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Week by week ──────────────────────────────────────────────────── */}
      {weekRows.some(w => w.shifts > 0) && (
        <div className="mt-4 rounded-md border border-border/40 bg-secondary/10 p-3" data-testid="week-by-week">
          <p className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 mb-2">
            Week by week · {format(currentDate, 'MMMM')} · est. {payView === 'gross' ? 'gross' : 'net'}
          </p>
          <div className="divide-y divide-border/30">
            {weekRows.map(w => {
              const owed = Math.max(0, w.estimate - w.paid);
              return (
                <div key={w.from} className={cn('grid grid-cols-[1fr_auto] items-baseline gap-x-3 py-1.5', w.isNow && '-mx-1.5 rounded px-1.5 bg-primary/10')}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">
                      {format(parseISO(w.from), 'MMM d')} – {format(parseISO(w.to), isSameMonth(parseISO(w.from), parseISO(w.to)) ? 'd' : 'MMM d')}
                      {w.isNow && <span className="ml-1.5 text-[10px] font-normal text-primary">this week</span>}
                    </p>
                    <p className="text-[10px] text-mono text-muted-foreground">
                      {w.shifts === 0 ? 'no shifts' : `${w.shifts} shift${w.shifts === 1 ? '' : 's'} · ${roundHours(w.hours)}h`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-mono">{w.estimate > 0 ? '$' + w.estimate.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</p>
                    {w.estimate > 0 && (
                      <p className={cn('text-[10px] text-mono', owed > 0.5 ? 'text-dot-pending' : 'text-dot-paid')}>
                        {owed > 0.5 ? (w.paid > 0 ? `$${Math.round(w.paid).toLocaleString()} paid · $${Math.round(owed).toLocaleString()} to come` : 'not paid yet') : 'paid'}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── This Month / YTD (small) + Export ────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[monthYtdStats.month, monthYtdStats.ytd].map(period => (
          <div key={period.label} className="rounded-md border border-border/40 bg-secondary/10 p-3">
            <p className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 mb-2">{period.label}</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Hours</span>
                <span className="text-mono font-semibold">{roundHours(period.hours)}h</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Est. gross</span>
                <span className="text-mono font-semibold text-foreground">${period.gross.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Est. net</span>
                <span className="text-mono font-semibold text-foreground">${period.expected.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Paid</span>
                <span className="text-mono font-semibold text-dot-paid">${period.paid.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Unpaid</span>
                {/* "All paid" used to show whenever the figure came to zero,
                    which included a month where nothing had been earned yet —
                    saying everything was settled when nothing was owed. */}
                <span className={cn("text-mono font-semibold", period.unpaid > 0 ? "text-dot-pending" : "text-muted-foreground")}>
                  {period.unpaid > 0
                    ? '$' + period.unpaid.toLocaleString(undefined, { maximumFractionDigits: 0 })
                    : period.expected > 0
                      ? 'all paid'
                      : 'nothing due'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => exportWeeklyToExcel(data.jobs, data.expenses, data.income, data.employers)}
        className="mt-2 w-full flex items-center justify-center gap-2 rounded-md border border-border/40 bg-secondary/10 hover:bg-secondary/20 py-2.5 px-4 text-xs font-semibold text-foreground transition-colors"
      >
        <Download size={14} />
        Export to Excel
      </button>

      <Dialog open={!!selectedDate} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent
          className="max-w-md max-h-[85vh] overflow-y-auto rounded-lg"
          // The shift view supplies its own aligned toolbar; the day list still
          // needs the default close button.
          hideClose={!!selectedJob}
          onTouchStart={daySwipe.onTouchStart}
          onTouchEnd={daySwipe.onTouchEnd}
          onOpenAutoFocus={e => e.preventDefault()}
        >
          {!selectedJob ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-mono text-sm">
                  {selectedDate && format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                {selectedDate && sixthSeventhDayDates[selectedDate] && (
                  <PremiumDayBanner {...sixthSeventhDayDates[selectedDate]} onSetUp={() => setEmployerForCard({ client: sixthSeventhDayDates[selectedDate].who })} />
                )}
                {selectedJobs.map(job => (
                  <PremiumHoursBanner key={'premium-' + job.id} job={job} allJobs={data.jobs} employer={resolveEmployer(job.client, data.employers)} payer={prefs.payer} onTap={() => setSelectedJobId(job.id)} />
                ))}
                {/* A split day is one shift worked in two calls: one card, its
                    calls inside it, each a tap from its own details. */}
                {splitShifts(selectedJobs).map(calls => {
                  const job = calls[0];
                  const split = calls.length > 1;
                  const hours = calls.reduce((s, c) => s + netHoursWorked(c), 0);
                  const earned = calls.reduce((s, c) => s + shownPay(c), 0);
                  const paid = calls.every(c => paidJobIds.has(c.id));
                  const overdue = calls.some(c => isOverdueUpcoming(c));
                  const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  const stubButton = (c: Job) => (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setOpenStubFor(c.id); setSelectedJobId(c.id); }}
                      className="ml-auto flex items-center gap-1 text-[10px] text-mono uppercase tracking-wider opacity-80 hover:opacity-100"
                      aria-label={c.payStub ? 'Replace the pay stub photo' : 'Add a pay stub photo'}
                    >
                      <StubMark job={c} paidByHand={paidByHandJobIds.has(c.id)} />
                      {!c.payStub && <span>+ stub</span>}
                    </button>
                  );
                  return (
                    <div key={job.id} onClick={() => setSelectedJobId(job.id)} data-testid={split ? 'split-shift' : undefined} className={cn("rounded-md border p-3 space-y-1 cursor-pointer hover:opacity-90 transition-opacity", paid ? "bg-success/20 text-success border-success/30" : overdue ? "bg-warning/20 text-warning border-warning/30" : statusColors[job.status])}>
                      <div className="flex items-start justify-between">
                        <div><p className="font-medium text-sm flex items-center gap-1.5"><CallbackMark job={job} allJobs={data.jobs} employers={data.employers} />{job.needsReview && <Flag size={12} className="text-warning shrink-0" aria-label="Flagged to check later" />}{job.name}{job.role && <span className="opacity-70 font-normal">· {job.role}</span>}{job.pto && <span className="text-[10px] text-mono font-bold border border-current px-1">PTO</span>}<SplitMark job={job} allJobs={data.jobs} /></p><p className="text-xs opacity-70">{job.client}</p></div>
                        <span className="text-[10px] text-mono uppercase font-medium opacity-70">{paid ? 'Paid' : overdue ? 'Needs Hours' : job.status}</span>
                      </div>
                      {job.venue && <p className="text-xs opacity-60">{job.venue}</p>}
                      {(() => {
                        const rule = breakTheHourLabel(job, resolveEmployer(job.client, data.employers));
                        return rule && <p><span className="inline-block border border-current px-1.5 py-0.5 text-[10px] font-bold text-mono uppercase tracking-wider">{rule}</span></p>;
                      })()}
                      {split ? (
                        <div className="space-y-1 text-xs text-mono" data-testid="split-calls">
                          <p className="text-[10px] uppercase tracking-wider font-bold">Split shift · {calls.length} calls</p>
                          {calls.map(c => (
                            <div key={c.id} role="button" tabIndex={0} data-testid="split-call"
                              onClick={e => { e.stopPropagation(); setSelectedJobId(c.id); }}
                              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setSelectedJobId(c.id); } }}
                              className="flex items-center gap-3 border-l-2 border-current/40 pl-2 py-0.5">
                              {c.startTime ? <span>{c.startTime}{c.endTime ? ` – ${c.endTime}` : ''}</span> : <span className="opacity-60">No call time</span>}
                              {netHoursWorked(c) > 0 && <span>{roundHours(netHoursWorked(c))}h</span>}
                              {shownPay(c) > 0 && <span>{money(shownPay(c))}</span>}
                              {c.hoursPlanned && <span className="text-[10px] uppercase tracking-wider text-accent">planned</span>}
                              {stubButton(c)}
                            </div>
                          ))}
                          <div className="flex items-center gap-3 border-t border-current/20 pt-1">
                            <span className="opacity-70">Day</span>
                            {hours > 0 && <span>{roundHours(hours)}h</span>}
                            {earned > 0 && <span className="font-semibold">{paid && <span className="font-normal opacity-70">exp. </span>}{money(earned)}</span>}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 text-xs text-mono">
                          {job.startTime && <span>{job.startTime}{job.endTime ? ` – ${job.endTime}` : ''}</span>}
                          {hours > 0 && <span>{roundHours(hours)}h</span>}
                          {earned > 0 && <span className="font-semibold">{paid && <span className="font-normal opacity-70">exp. </span>}{money(earned)}</span>}
                          {job.hoursPlanned && <span className="text-[10px] text-mono uppercase tracking-wider text-accent">planned</span>}
                          {stubButton(job)}
                        </div>
                      )}
                      {/* What actually came in for the project, beside what it was
                          expected to pay, and what each payment was: a check, a
                          stub, a deposit, or only marked paid. */}
                      {(() => {
                        const key = projectGroupKey(job);
                        const linked = (incomeByProject.get(key) ?? []).filter(i => i.status === 'paid');
                        const groups = samePaymentGroups([...linked, ...(reachedFrom.get(key) ?? []).filter(i => !linked.includes(i))]);
                        if (groups.length === 0) return null;
                        const actual = groups.reduce((sum, g) => sum + g.first.amount, 0);
                        const worked = data.jobs.filter(j => projectGroupKey(j) === key && effectiveHoursWorked(j) > 0);
                        // A part payment is checked against the days it reached.
                        const reached = worked.filter(j => paidJobIds.has(j.id));
                        const owed = worked.filter(j => !paidJobIds.has(j.id) && j.date <= localToday());
                        const expected = (owed.length > 0 && reached.length > 0 ? reached : worked).reduce((sum, j) => sum + shownPay(j), 0);
                        const gap = actual - expected;
                        const fmt = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                        return (
                          <div className="space-y-1 border-t border-current/20 pt-1.5 text-[11px] text-mono">
                            <p>
                              <span className="font-bold">Paid {fmt(actual)}</span>
                              <span className="opacity-70"> · expected {fmt(expected)} {payView}</span>
                              {Math.abs(gap) >= 0.01 && <span className={cn('ml-1 font-bold', gap > 0 ? 'text-dot-paid' : 'text-warning')}>({gap > 0 ? '+' : '−'}{fmt(Math.abs(gap))})</span>}
                              <span className="opacity-60"> · {owed.length > 0 && reached.length > 0 ? `for ${dayRuns(reached.map(j => j.date))}` : 'whole project'}</span>
                            </p>
                            {owed.length > 0 && <p className="font-bold" data-testid="day-owed">Still owed {dayRuns(owed.map(j => j.date))}</p>}
                            <div className="flex flex-wrap gap-1">
                              {groups.map(g => <SourceTag key={g.first.id} income={g.first} />)}
                            </div>
                          </div>
                        );
                      })()}
                      {calls.some(c => c.startTime && !c.endTime) && (
                        <p className="text-[10px] text-warning font-medium">⚠ No end time set — tap to add it</p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] opacity-40 text-mono">{split ? 'Tap a call for details →' : 'Tap for details →'}</p>
                        {/* Pay for the day's project, without opening it. */}
                        {job.date <= localToday() && calls.some(c => effectiveHoursWorked(c) > 0) && (() => {
                          const recorded = incomeByProject.get(projectGroupKey(job)) ?? [];
                          if (paid) {
                            return (
                              <button type="button" onClick={e => { e.stopPropagation(); void unmarkProjectPaid(job); }}
                                className="pixel-button pick-off flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-foreground">
                                <Undo2 size={12} /> Undo paid
                              </button>
                            );
                          }
                          const piece = pieceOf(job);
                          const here = piece?.periods[piece.index]?.jobs;
                          const coming = recorded.some(i => i.status === 'pending' && (!here || here.some(j => j.id === i.jobId)));
                          return (
                            <button type="button" onClick={e => { e.stopPropagation(); void markProjectPaid(job); }}
                              className="pixel-button pick-off flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-foreground">
                              {coming ? <><Banknote size={12} /> Money in</> : <><Wallet size={12} /> Mark paid</>}
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
                {payByDate[selectedDate!] && (
                  <div className="flex items-center justify-between pt-2 border-t border-border text-sm text-mono">
                    <span className="text-muted-foreground">Estimated {payView}</span>
                    <span className={cn("font-bold", moneyTone(jobsByDate[selectedDate!] ?? [], paidJobIds, latePayIds))}>${payByDate[selectedDate!].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}

                {selectedConferences.length > 0 && (
                  <div className="pt-2 border-t border-border space-y-2" data-testid="day-conferences">
                    <p className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Conferences</p>
                    {selectedConferences.map(c => {
                      const d = c.dates.find(x => x.start <= selectedDate! && x.end >= selectedDate!);
                      return (
                        <button key={c.id} type="button" onClick={() => openConferences(c.id)}
                          className="w-full rounded-md border p-3 text-left space-y-0.5"
                          style={{ borderColor: conferenceColour(0.4), background: conferenceColour(0.06) }}>
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            <Presentation size={13} className="shrink-0" style={{ color: conferenceColour() }} aria-hidden />{c.name}
                          </p>
                          <p className="text-xs text-mono text-muted-foreground">{d && spanText(d)}{c.where ? ` · ${c.where}` : ''}</p>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── Personal events ─────────────────────────────────────── */}
                {(selectedEvents.length > 0 || addingEventDate === selectedDate) && (
                  <div className="pt-2 border-t border-border space-y-2">
                    <p className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Plans</p>
                    {selectedEvents.map(ev => (
                      editingEventId === ev.id ? (
                        <EventForm
                          key={ev.id}
                          initial={ev}
                          onCancel={() => setEditingEventId(null)}
                          onSave={async (updates) => { await updateEvent(ev.id, updates); setEditingEventId(null); toast.success('Event updated'); }}
                        />
                      ) : (
                        <div key={ev.id} className="rounded-md border border-info/30 bg-info/5 p-3 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-medium text-sm">{ev.title}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => setEditingEventId(ev.id)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" aria-label="Edit event">
                                <Pencil size={12} />
                              </button>
                              <button onClick={async () => { await deleteEvent(ev.id); toast.success('Event removed'); }} className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" aria-label="Delete event">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                          {(ev.startTime || ev.location) && (
                            <div className="flex items-center gap-3 text-xs text-mono text-muted-foreground">
                              {ev.startTime && <span>{ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ''}</span>}
                              {ev.location && <span className="flex items-center gap-0.5"><MapPin size={10} />{ev.location}</span>}
                            </div>
                          )}
                          {ev.notes && <p className="text-xs text-muted-foreground">{ev.notes}</p>}
                        </div>
                      )
                    ))}
                    {addingEventDate === selectedDate && (
                      <EventIntake
                        date={selectedDate!}
                        onCancel={() => setAddingEventDate(null)}
                        onSaveMany={async (events) => {
                          for (const ev of events) await addEvent(ev);
                          setAddingEventDate(null);
                          toast.success(`Added ${events.length} plan${events.length !== 1 ? 's' : ''}`);
                        }}
                      />
                    )}
                  </div>
                )}
                {/* A shift on this very day, without leaving it. */}
                <button
                  onClick={() => setAddShiftDate(selectedDate)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                  data-testid="add-shift-on-day"
                >
                  <Plus size={13} /> add a shift on {selectedDate && format(new Date(selectedDate + 'T12:00:00'), 'EEE, MMM d')}
                </button>
                {addingEventDate !== selectedDate && (
                  <button
                    onClick={() => setAddingEventDate(selectedDate)}
                    className="w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                  >
                    <Plus size={13} /> make a plan for this day
                  </button>
                )}
              </div>
            </>
          ) : (
            <JobDetailView
              job={selectedJob}
              openStubOnMount={openStubFor === selectedJob.id}
              onStubOpened={() => setOpenStubFor(null)}
              // Back goes where the shift came from: the day, or the page that opened it.
              onBack={() => (returnTo.current ? closeDialog() : setSelectedJobId(null))}
              onSave={(updates) => { updateJob(selectedJob.id, updates); setSelectedJobId(null); toast.success('Job updated'); }}
              onDuplicated={(count) => { closeDialog(); toast.success(`Created ${count} shift${count !== 1 ? 's' : ''}`); }}
              onDelete={async () => { await deleteJob(selectedJob.id); closeDialog(); toast.success('Shift deleted'); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConferenceList open={conferencesOpen} onOpenChange={setConferencesOpen} editId={conferenceId} />

      {/* A project's bar tapped on the month: its days, each a tap from its shift. */}
      <Dialog open={!!projectShown} onOpenChange={open => { if (!open) setProjectShown(null); }}>
        <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto rounded-lg" data-testid="project-days">
          {projectShown && (() => {
            const days = data.jobs
              .filter(j => j.status !== 'cancelled' && projectGroupKey(j) === projectShown)
              .sort((a, b) => (a.date === b.date ? compareCalls(a, b) : a.date.localeCompare(b.date)));
            if (days.length === 0) return null;
            const name = projectNameOf.get(projectShown) ?? days[0].client;
            const colour = employerColour(name);
            const first = days[0].date;
            const last = days[days.length - 1].date;
            const dayCount = new Set(days.map(j => j.date)).size;
            const span = first === last ? showDay(first)
              : first.slice(0, 7) === last.slice(0, 7) ? `${showDay(first)}–${showDay(last, 'd')}`
              : `${showDay(first)} – ${showDay(last)}`;
            const total = days.reduce((sum, j) => sum + shownPay(j), 0);
            return (
              <>
                <DialogHeader className="text-left">
                  <DialogTitle className="flex items-center gap-2">
                    <span className="h-1 w-6 shrink-0 rounded-full" style={{ background: colour, boxShadow: `0 0 6px ${colour}` }} aria-hidden="true" />
                    <span className="truncate" style={{ color: colour }}>{name}</span>
                  </DialogTitle>
                  <DialogDescription>
                    {days[0].name ? `${days[0].name} · ` : ''}{span} · {dayCount} day{dayCount === 1 ? '' : 's'}
                    {total > 0 && <> · <span className={cn('font-semibold', moneyTone(days, paidJobIds, latePayIds))}>${Math.round(total).toLocaleString()}</span> est. {payView}</>}
                  </DialogDescription>
                </DialogHeader>
                <ul className="divide-y divide-border/60 border border-border">
                  {splitShifts(days).map(calls => {
                    const job = calls[0];
                    const split = calls.length > 1;
                    const pay = calls.reduce((sum, c) => sum + shownPay(c), 0);
                    const callTimes = (c: Job) => (c.startTime ? `${c.startTime}${c.endTime ? ` – ${c.endTime}` : ''}` : 'No call time');
                    return (
                      <li key={job.id}>
                        {/* A split day opens on the day, where both calls are. */}
                        <button type="button" data-testid="project-day" onClick={() => { setProjectShown(null); if (split) { setSelectedDate(job.date); setSelectedJobId(null); } else openShift(job); }}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-secondary/40 active:bg-secondary/60">
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium">
                              <CallbackMark job={job} allJobs={data.jobs} employers={data.employers} />
                              {showDay(job.date, 'EEE, MMM d')}
                              <SplitMark job={job} allJobs={data.jobs} />
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {split ? `Split · ${calls.map(callTimes).join(' & ')}` : callTimes(job)}{job.role ? ` · ${job.role}` : ''}
                            </span>
                          </span>
                          <span className={cn('shrink-0 text-sm text-mono font-semibold', moneyTone(calls, paidJobIds, latePayIds))}>
                            {pay > 0 ? `$${Math.round(pay).toLocaleString()}` : isOverdueUpcoming(job) ? 'needs hours' : statusLabel[job.status]}
                          </span>
                          <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Standalone quick-add — no swipe handlers, no existing-jobs list,
          just the intake box, so a stray touch can't get read as a day-swipe
          and steal the tap. */}
      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent
          className="max-w-md max-h-[85vh] overflow-y-auto rounded-lg"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-mono text-sm">Make a plan</DialogTitle>
          </DialogHeader>
          <EventIntake
            date={format(today, 'yyyy-MM-dd')}
            onCancel={() => setQuickAddOpen(false)}
            onSaveMany={async (events) => {
              for (const ev of events) await addEvent(ev);
              setQuickAddOpen(false);
              toast.success(`Added ${events.length} plan${events.length !== 1 ? 's' : ''}`);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Reuses the exact same Job Log intake (paste/photo/manual + parse
          review) that lives on the Dashboard, rather than a second copy of
          that flow — same component, just also reachable from here. */}
      <Dialog open={quickAddHoursOpen} onOpenChange={setQuickAddHoursOpen}>
        <DialogContent
          className="max-w-md max-h-[85vh] overflow-y-auto rounded-lg"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-mono text-sm">Add hours worked</DialogTitle>
          </DialogHeader>
          <NewGigPage startAs="hours" onComplete={() => setQuickAddHoursOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!addShiftDate} onOpenChange={open => { if (!open) setAddShiftDate(null); }}>
        <DialogContent
          className="max-w-md max-h-[85vh] overflow-y-auto rounded-lg"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-mono text-sm">
              Add a shift · {addShiftDate && format(new Date(addShiftDate + 'T12:00:00'), 'EEE, MMM d')}
            </DialogTitle>
          </DialogHeader>
          {addShiftDate && <NewGigPage key={addShiftDate} forDate={addShiftDate} onComplete={() => setAddShiftDate(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={quickAddShiftOpen} onOpenChange={setQuickAddShiftOpen}>
        <DialogContent
          className="max-w-md max-h-[85vh] overflow-y-auto rounded-lg"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-mono text-sm">Add an offer</DialogTitle>
          </DialogHeader>
          <NewGigPage onComplete={() => setQuickAddShiftOpen(false)} />
        </DialogContent>
      </Dialog>

      {(() => {
        const monthPrefix = format(currentDate, 'yyyy-MM');
        // Every project that touches this month, and all of it: a run over the
        // month end is one block of work, not two halves on two pages.
        const monthKeys = new Set(data.jobs.filter(job => job.date.startsWith(monthPrefix)).map(projectGroupKey));
        // Newest day first, but a day's own calls morning first.
        const monthJobs = data.jobs.filter(job => monthKeys.has(projectGroupKey(job)))
          .sort((a, b) => a.date === b.date ? compareCalls(a, b) : b.date.localeCompare(a.date));
        if (monthJobs.length === 0) return null;
        const loggedGroups: Record<string, Job[]> = {};
        for (const job of monthJobs) {
          const key = projectGroupKey(job);
          if (!loggedGroups[key]) loggedGroups[key] = [];
          loggedGroups[key].push(job);
        }
        return (
          <div className="mt-4 flex flex-col gap-2" data-testid="month-projects">
            {/* Folds under its heading; the count shows either way. */}
            <h2 className="self-start">
              <button type="button" onClick={toggleProjects} aria-expanded={projectsOpen} data-testid="month-projects-toggle" className={FOLD_HEADING}>
                Projects this month · {Object.keys(loggedGroups).length}
                <ChevronDown size={14} className={cn('shrink-0 transition-transform', projectsOpen && 'rotate-180')} aria-hidden />
              </button>
            </h2>
            {projectsOpen && <div className="flex flex-col gap-2.5">
              {Object.entries(loggedGroups).map(([key, jobs]) => {
                const first = jobs[0];
                const totalHours = jobs.reduce((s, j) => s + netHoursWorked(j), 0);
                const totals = jobs.reduce((sum, j) => {
                  const b = jobPayBreakdown(j, data.jobs, data.employers, prefs.payer);
                  return { net: sum.net + b.net, gross: sum.gross + b.gross };
                }, { net: 0, gross: 0 });
                const totalEarned = totals[payView];
                const last = jobs[jobs.length - 1];
                // A split is two calls on one day, not two days.
                const dayCount = new Set(jobs.map(j => j.date)).size;
                // "Nov 3–5", or "Oct 30 – Nov 2" over a month end. showDay keeps
                // a stored date that isn't one from taking the list down.
                const dateRange = dayCount <= 1 ? showDay(first.date)
                  : last.date.slice(0, 7) === first.date.slice(0, 7) ? `${showDay(last.date)}–${showDay(first.date, 'd')}`
                  : `${showDay(last.date)} – ${showDay(first.date)}`;
                const isGroup = jobs.length > 1;
                const expanded = expandedGroupKey === key;
                const openJob = (job: Job) => { setSelectedDate(job.date); setSelectedJobId(job.id); };
                // Across pay periods it's two checks, and every piece of this
                // card has to say so: the tape, the rows, and the day list.
                const split = splitPeriods(jobs);
                const isSplit = split.periods.length > 1;
                const paidBy = isSplit
                  ? periodPayments(split.periods, (incomeByProject.get(key) ?? []).filter(i => i.status === 'paid'), periodExpected)
                  : new Map<number, Income[]>();
                const periodIndex = new Map(split.periods.flatMap((p, i) => p.jobs.map(j => [j.id, i] as const)));
                // Its days, the earliest on top, a day's own calls morning first.
                const daysShown = [...jobs].sort((a, b) => (a.date === b.date ? compareCalls(a, b) : a.date.localeCompare(b.date)));
                const newPeriodAt = new Set<string>();
                daysShown.reduce<number | undefined>((seen, j) => {
                  const at = periodIndex.get(j.id);
                  if (at === undefined) return seen;
                  if (seen !== undefined && at !== seen) newPeriodAt.add(j.id);
                  return at;
                }, undefined);
                return (
                  <div key={key} className={cn("relative overflow-hidden rounded-xl border bg-[#0b0910] shadow-lg shadow-black/50", isSplit ? "border-[#ffe600]" : "border-border")}>
                    {/* The wash is the same colour as the shift's dot, so a row
                        says what it is from across the list without reading it.
                        There was an outlined bolt watermarked behind this; it
                        read as a stray graphic rather than as texture. */}
                    <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", cardTintClass(first, paidJobIds, jobs.some(j => latePayIds.has(j.id))))} />
                    {isSplit && <div className="hazard-tape relative"><span>⚠ Splits {split.periods.length} pay periods ⚠</span></div>}
                    <div
                      onClick={() => isGroup ? setExpandedGroupKey(expanded ? null : key) : openJob(first)}
                      className="relative p-3 cursor-pointer active:opacity-80 transition-opacity"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {/* The name leads, then the dates: a job is remembered as
                              the show it was. Long dispatch names get two lines. */}
                          <p className="text-[17px] font-bold leading-tight text-white line-clamp-2">
                            {jobs.some(j => j.needsReview) && <Flag size={13} className="inline mr-1 -mt-0.5 text-warning" aria-label="Flagged to check later" />}
                            {first.name || first.client}
                            {jobs.some(j => j.pto) && <span className="ml-1.5 align-middle text-[10px] text-mono font-bold border border-foreground/50 px-1">PTO</span>}
                          </p>
                          {/* When, how long, how many hours: one line. */}
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-mono text-foreground/85 leading-snug">
                            <span>{dateRange}</span>
                            {isGroup && <span className="text-muted-foreground">· {dayCount > 1 ? `${dayCount} days` : `${jobs.length} calls`}</span>}
                            {totalHours > 0 && <span className="text-muted-foreground">· {roundHours(totalHours)}h</span>}
                            {(() => {
                              const best = jobs.map(j => sixthSeventhDayDates[j.date]).filter(Boolean).sort((a, b) => b.day - a.day)[0];
                              return best ? <PremiumTag day={best.day} pays={best.pays} /> : null;
                            })()}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {first.client}
                            {first.role && <span> · {first.role}</span>}
                          </p>
                        </div>
                        {/* Pay is the reason this list gets opened: one figure,
                            in the key's colour, for the estimate picked above. */}
                        <div className="flex shrink-0 items-start gap-1">
                          {totalEarned > 0 ? (
                            <p className={cn("text-lg font-bold text-mono leading-none", moneyTone(jobs, paidJobIds, latePayIds))} data-testid="project-pay">
                              ${Math.round(totalEarned).toLocaleString()}
                            </p>
                          ) : (
                            <p className={cn("text-[11px] text-mono leading-none", moneyTone(jobs, paidJobIds, latePayIds))}>
                              {jobs.some(isOverdueUpcoming) ? 'Needs hours' : statusLabel[first.status]}
                            </p>
                          )}
                          {isGroup && (
                            expanded
                              ? <ChevronDown size={16} className="text-muted-foreground shrink-0" />
                              : <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                          )}
                        </div>
                      </div>
                      {isSplit && (
                        <div className="mt-2.5 space-y-1.5 border-t border-border/60 pt-2">
                          {split.periods.map((p, i) => {
                            const worked = p.jobs.filter(j => j.date <= localToday() && effectiveHoursWorked(j) > 0);
                            const days = new Set(p.jobs.map(j => j.date)).size;
                            const hours = p.jobs.reduce((s, j) => s + netHoursWorked(j), 0);
                            const amount = p.jobs.reduce((s, j) => s + shownPay(j), 0);
                            const lead = worked[0] ?? p.jobs[0];
                            const payments = paidBy.get(i) ?? [];
                            const coming = (incomeByProject.get(key) ?? []).filter(x => x.status === 'pending' && p.jobs.some(j => j.id === x.jobId));
                            const sum = (list: Income[]) => samePaymentGroups(list).reduce((total, g) => total + g.first.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            const sameCheck = payments.some(x => [...paidBy].some(([n, list]) => n !== i && list.includes(x)));
                            const due = worked.length > 0 ? payDueFor(worked) : null;
                            const late = due ? differenceInCalendarDays(new Date(), parseISO(due)) : 0;
                            const invoice = p.jobs.map(j => openInvoiceOf.get(j.id)).find(Boolean);
                            const rowButton = "pixel-button pick-off flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] font-bold";
                            return (
                              <Fragment key={p.start}>
                                {i > 0 && <p className="period-cut">✂ new pay period</p>}
                                <div data-testid="pay-period">
                                  <div className="flex items-baseline justify-between gap-2 text-[11px] text-mono">
                                    <span className="font-bold text-foreground">{p.firstCheck && 'First check · '}{periodDates(p)}</span>
                                    <span className="shrink-0 text-muted-foreground">
                                      {days} day{days === 1 ? '' : 's'}{hours > 0 ? ` · ${roundHours(hours)}h` : ''}{amount > 0 ? ` · $${Math.round(amount).toLocaleString()}` : ''}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex min-h-[1.5rem] items-center justify-between gap-2">
                                    {payments.length > 0 ? (
                                      <>
                                        <button type="button" onClick={e => { e.stopPropagation(); openJob(lead); }} className="flex min-w-0 items-center gap-1.5 text-[11px] text-mono text-dot-paid hover:underline">
                                          <Check size={12} className="shrink-0" />
                                          <span className="truncate">Paid ${sum(payments)} · {showDay(payments.map(x => x.date).sort().pop()!, 'MMM d')}{sameCheck ? ' · same check' : ''}</span>
                                        </button>
                                        <button type="button" onClick={e => { e.stopPropagation(); void unmarkProjectPaid(lead); }} className={rowButton}><Undo2 size={12} /> Undo</button>
                                      </>
                                    ) : coming.length > 0 ? (
                                      <>
                                        <button type="button" onClick={e => { e.stopPropagation(); openJob(lead); }} className="flex min-w-0 items-center gap-1.5 text-[11px] text-mono text-dot-pending hover:underline">
                                          <Receipt size={12} className="shrink-0" />
                                          <span className="truncate">{coming.some(x => /stub/i.test(x.description)) ? 'Stub in' : 'Recorded'} · ${sum(coming)} coming</span>
                                        </button>
                                        <button type="button" onClick={e => { e.stopPropagation(); void markProjectPaid(lead); }} className={rowButton}><Banknote size={12} /> Money in</button>
                                      </>
                                    ) : due ? (
                                      <>
                                        <p className={cn('min-w-0 truncate text-[11px] text-mono', late > 0 ? 'text-dot-late' : 'text-dot-pending')}>
                                          {invoice ? `${invoice.status === 'draft' ? 'Draft' : 'Invoiced'} ${invoice.number}` : p.firstCheck ? 'Waiting on first check' : 'Waiting on pay'} · {late > 0 ? `${late}d late` : `due ${format(parseISO(due), 'MMM d')}`}
                                        </p>
                                        <button type="button" onClick={e => { e.stopPropagation(); void markProjectPaid(lead); }} className={rowButton}><Wallet size={12} /> Mark paid</button>
                                      </>
                                    ) : (
                                      <p className="text-[11px] text-mono text-muted-foreground">Not worked yet</p>
                                    )}
                                  </div>
                                </div>
                              </Fragment>
                            );
                          })}
                        </div>
                      )}
                      {!isSplit && (() => {
                        const linked = (incomeByProject.get(key) ?? []).filter(i => i.status === 'paid');
                        // With the employer's checks that reached these days from another of its projects.
                        const payments = [...linked, ...(reachedFrom.get(key) ?? []).filter(i => !linked.includes(i))];
                        const workedSoFar = jobs.filter(j => j.date <= localToday() && effectiveHoursWorked(j) > 0);
                        const owed = workedSoFar.filter(j => !paidJobIds.has(j.id));
                        const paidDays = workedSoFar.filter(j => paidJobIds.has(j.id));
                        // Recorded but not in yet: a pay stub, or a payment set back.
                        const coming = (incomeByProject.get(key) ?? []).filter(i => i.status === 'pending');
                        const comingTotal = samePaymentGroups(coming).reduce((sum, g) => sum + g.first.amount, 0);
                        const comingLabel = coming.some(i => /stub/i.test(i.description)) ? 'Stub in' : 'Recorded';
                        if (payments.length > 0) {
                          // Repeats of one payment are counted once here and flagged:
                          // the same $296 saved fifteen times is one $296.
                          const groups = samePaymentGroups(payments);
                          const repeated = groups.reduce((n, g) => n + g.repeats.length, 0);
                          const total = groups.reduce((sum, g) => sum + g.first.amount, 0);
                          const last = payments.map(i => i.date).sort().pop()!;
                          // A part payment: the days it reached, and the days still owed.
                          const owedDue = owed.length > 0 ? payDueFor(owed) : null;
                          const owedLate = owedDue ? differenceInCalendarDays(new Date(), parseISO(owedDue)) : 0;
                          const owedAmount = owed.reduce((sum, j) => sum + shownPay(j), 0);
                          // What paid it, and its proof, are in the shift: a tap on this line.
                          return (
                            <div className="mt-2 space-y-1.5" data-testid="project-paid">
                              <div className="flex items-center justify-between gap-2">
                                {/* Into the project, where its payments are listed and can be changed. */}
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); openJob(first); }}
                                  className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-left text-[11px] text-mono text-dot-paid hover:underline"
                                >
                                  <Check size={12} className="shrink-0" />
                                  <span>Paid {dollars(total)} · {showDay(last)}</span>
                                  {owed.length > 0 && (
                                    <span className="shrink-0" data-testid="project-paid-days">
                                      · {paidDays.length > 0 ? `for ${dayRuns(paidDays.map(j => j.date))}` : 'went to earlier work'}
                                    </span>
                                  )}
                                  {repeated > 0 && <span className="shrink-0 text-warning">· {repeated} repeated</span>}
                                  {comingTotal > 0 && <span className="shrink-0 text-dot-pending">· ${Math.round(comingTotal).toLocaleString()} coming</span>}
                                </button>
                                {linked.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); void unmarkProjectPaid(first); }}
                                    className="pixel-button pick-off flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] font-bold"
                                  >
                                    <Undo2 size={12} /> Undo
                                  </button>
                                )}
                              </div>
                              {owedDue && (
                                <div className="flex items-center justify-between gap-2" data-testid="project-owed">
                                  <p className={cn('min-w-0 text-[11px] text-mono', owedLate > 0 ? 'text-dot-late' : 'text-dot-pending')}>
                                    Still owed {dayRuns(owed.map(j => j.date))}
                                    {owedAmount > 0 && <> · ${Math.round(owedAmount).toLocaleString()}</>}
                                    {' · '}{owedLate > 0 ? `${owedLate}d late` : `due ${format(parseISO(owedDue), 'MMM d')}`}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); void markProjectPaid(owed[0]); }}
                                    className="pixel-button pick-off shrink-0 px-2 py-1 text-[11px] font-bold"
                                  >
                                    <span className="inline-flex items-center gap-1"><Wallet size={12} /> Mark paid</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        }
                        if (coming.length > 0) {
                          // A stub says the money is coming. It is not the money:
                          // the project stays waiting until it lands.
                          return (
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); openJob(first); }}
                                className="flex min-w-0 items-center gap-1.5 text-[11px] text-mono text-dot-pending hover:underline"
                              >
                                <Receipt size={12} className="shrink-0" />
                                <span className="truncate">{comingLabel} · {dollars(comingTotal)} coming</span>
                              </button>
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); void markProjectPaid(first); }}
                                className="pixel-button pick-off px-2 py-1 text-[11px] font-bold"
                              >
                                <span className="inline-flex items-center gap-1"><Banknote size={12} /> Money in</span>
                              </button>
                            </div>
                          );
                        }
                        const worked = jobs.filter(j => j.date <= localToday() && effectiveHoursWorked(j) > 0);
                        if (worked.length === 0) return null;
                        const due = payDueFor(worked);
                        const late = differenceInCalendarDays(new Date(), parseISO(due));
                        const invoice = jobs.map(j => openInvoiceOf.get(j.id)).find(Boolean);
                        return (
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className={cn('text-[11px] text-mono', late > 0 ? 'text-dot-late' : 'text-dot-pending')}>
                              {invoice ? `${invoice.status === 'draft' ? 'Draft' : 'Invoiced'} ${invoice.number}` : split.periods[0]?.firstCheck ? 'Waiting on first check' : 'Waiting on pay'} · {late > 0 ? `${late}d late` : `due ${format(parseISO(due), 'MMM d')}`}
                            </p>
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); void markProjectPaid(first); }}
                              className="pixel-button pick-off px-2 py-1 text-[11px] font-bold"
                            >
                              <span className="inline-flex items-center gap-1"><Wallet size={12} /> Mark paid</span>
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                    {isGroup && expanded && (
                      <div className="border-t border-primary/20 divide-y divide-primary/10">
                        <ProjectHoursSummary hours={projectHours(jobs, data.jobs, data.employers, prefs.payer, paidJobIds)} className="px-3 py-2 pl-6" />
                        {/* One row a day: a split day's calls are one shift,
                            and tapping it opens the day with both calls. */}
                        {splitShifts(daysShown).map(calls => {
                          const job = calls[0];
                          const split = calls.length > 1;
                          const hours = calls.reduce((s, c) => s + netHoursWorked(c), 0);
                          return (
                          <Fragment key={job.id}>
                          {newPeriodAt.has(job.id) && <p className="period-cut px-3 py-1">✂ new pay period</p>}
                          <div
                            onClick={() => (split ? (setSelectedDate(job.date), setSelectedJobId(null)) : openJob(job))}
                            data-testid={split ? 'project-split-day' : undefined}
                            className="px-3 py-2 pl-6 flex items-center justify-between gap-2 cursor-pointer hover:bg-primary/10 active:bg-primary/15 transition-colors"
                          >
                            <span className="text-xs text-mono flex items-center gap-1.5"><CallbackMark job={job} allJobs={data.jobs} employers={data.employers} />{showDay(job.date, 'EEE, MMM d')}<SplitMark job={job} allJobs={data.jobs} />{split && <span className="text-[10px] text-muted-foreground">split · {calls.length} calls</span>}{sixthSeventhDayDates[job.date] && <PremiumTag day={sixthSeventhDayDates[job.date].day} pays={sixthSeventhDayDates[job.date].pays} />}</span>
                            <span className="flex items-center gap-1.5 text-[11px] text-mono text-muted-foreground">
                              {hours > 0 ? `${roundHours(hours)}h` : isOverdueUpcoming(job) ? 'Needs Hours' : statusLabel[job.status]}
                              {calls.some(c => c.startTime && !c.endTime) && <span className="text-warning"> · no end time</span>}
                              {calls.some(c => !c.hoursWorked && sameClockTime(c.startTime, c.endTime)) && <span className="text-warning" data-testid="row-same-start-end"> · end is the start</span>}
                              {calls.filter(c => effectiveHoursWorked(c) > 0).map(c => (
                                <StubMark key={c.id} job={c} paidByHand={paidByHandJobIds.has(c.id)} openProof />
                              ))}
                            </span>
                          </div>
                          </Fragment>
                          );
                        })}
                        {/* Why the card can or can't say where the pay periods
                            fall, and the way to fix it: with the days, not on
                            every card. */}
                        {((isSplit && split.assumed) || (!split.known && dayCount > 1)) && (
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setEmployerForCard({ client: first.client }); }}
                            className="block w-full px-3 py-2 pl-6 text-left text-[10px] text-muted-foreground underline"
                          >
                            {split.assumed
                              ? 'Sun–Sat week assumed. Set the day on the employer.'
                              : 'Pay periods unknown. Set them on the employer to see if this splits.'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>}
          </div>
        );
      })()}


      {employerForCard && (
        <EmployerEditor
          employer={resolveEmployer(employerForCard.client, data.employers)}
          prefill={{ name: employerForCard.client }}
          onClose={() => setEmployerForCard(null)}
        />
      )}

      {unlinkedPayments.length > 0 && (
        <div className="mt-4 flex flex-col gap-2" data-testid="unlinked-payments">
          {/* Folds under its heading, the same as the month's projects; the count shows either way. */}
          <h2 className="self-start">
            <button type="button" onClick={toggleUnlinked} aria-expanded={unlinkedOpen} data-testid="unlinked-payments-toggle" className={FOLD_HEADING}>
              Payments with no shift · {unlinkedPayments.length}
              <ChevronDown size={14} className={cn('shrink-0 transition-transform', unlinkedOpen && 'rotate-180')} aria-hidden />
            </button>
          </h2>
          {unlinkedOpen && <p className="text-[11px] text-muted-foreground">Money that came in but isn't tied to a shift yet. Link it to the project it paid. A payment is never a shift of its own: if the work isn't on the calendar, add the shift on the day you worked, then link this to it.</p>}
          {unlinkedOpen && unlinkedPayments.map(i => {
            const options = linkSuggestions.get(i.id) ?? [];
            const guess = options[0]?.match.level !== 'low' ? options[0] : undefined;
            // Only projects something points to: a 0% option is noise.
            const others = options.filter(o => o !== guess && o.match.percent > 0);
            return (
              <div key={i.id} className="border-t border-border pt-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <PayIconButton income={i} className="text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-xs font-medium">{i.client || i.description}</p>
                  <span className="shrink-0 text-xs text-mono font-bold text-dot-paid">${i.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="shrink-0 text-[10px] text-mono text-muted-foreground">{showDay(i.date)}</span>
                </div>
                {guess && (
                  <div className="text-[11px]">
                    <p>
                      Looks like <span className="font-semibold">{guess.project[0].name}</span> · {format(new Date(guess.project[0].date + 'T12:00:00'), 'MMM d')}{' '}
                      <span className={cn('text-mono font-bold uppercase text-[10px]', guess.match.level === 'high' ? 'text-dot-paid' : 'text-dot-overdue')}>
                        {guess.match.level} · {guess.match.percent}%
                      </span>
                    </p>
                    <ul className="text-[10px] text-muted-foreground">
                      {guess.match.reasons.filter(r => r.good).slice(0, 3).map(r => <li key={r.text}>✓ {r.text}</li>)}
                    </ul>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {guess && (
                    <Button size="sm" className="h-auto min-h-7 max-w-full whitespace-normal py-1 text-left text-[11px]" onClick={() => void linkPayment(i, guess.project[0], guess.match)}>
                      Link to {guess.project[0].name}
                    </Button>
                  )}
                  {others.map(o => (
                    <Button key={o.project[0].id} size="sm" variant="outline" className="h-auto min-h-7 max-w-full whitespace-normal py-1 text-left text-[11px]" onClick={() => void linkPayment(i, o.project[0], o.match)}>
                      {o.project[0].name} · {format(new Date(o.project[0].date + 'T12:00:00'), 'MMM d')} · {o.match.percent}%
                    </Button>
                  ))}
                  {options.length === 0 && (
                    <p className="text-[10px] text-muted-foreground">No shift from this payer in the year before it. Add the shift on the day you worked.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SpacePageWrapper>
  );
}
