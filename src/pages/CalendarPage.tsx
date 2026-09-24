import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { ChevronLeft, ChevronRight, ChevronDown, Star, ArrowLeft, Copy, X, Receipt, Pencil, Trash2, Phone, Download, Plus, MapPin, Check, Loader2, Zap, Eye } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, isToday, isPast, isWithinInterval, parseISO } from 'date-fns';
import type { Job, CalendarEvent } from '@/lib/store';
import { calculateDayPay, getDayMultiplier, calculateWeeklyOvertimeBonus, getConsecutiveDayStreak, calculateNightHours, resolveConfirmedNightHours, effectiveHoursWorked, netHoursWorked, isOverdueUpcoming, jobGross } from '@/lib/payCalc';
import { resolveEmployer } from '@/lib/employerMatch';
import { useSwipe } from '@/lib/useSwipe';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { matchStubToShifts, type MatchConfidence } from '@/lib/stubMatching';
import { learnFromStubs, dismissSuggestion, type Suggestion } from '@/lib/stubLearning';
import { uploadStub, stubViewUrl, deleteStub } from '@/lib/stubStorage';
import { useAuth } from '@/lib/AuthContext';
import { compareStubToShifts, disagreements, type RowStatus } from '@/lib/stubComparison';
import { resizeImageForStorage, readFileAsDataUrl } from '@/lib/imageResize';
import { exportWeeklyToExcel } from '@/lib/exportWeekly';
import EventIntake from '@/components/EventIntake';
import ScrollWheel from '@/components/ScrollWheel';
import NewGigPage from '@/pages/NewGigPage';

const statusDot: Record<Job['status'], string> = {
  upcoming: 'bg-accent',
  'in-progress': 'bg-accent',
  completed: 'bg-primary',
  cancelled: 'bg-destructive',
};

const statusColors: Record<Job['status'], string> = {
  upcoming: 'bg-accent/20 text-accent border-accent/30',
  'in-progress': 'bg-accent/20 text-accent border-accent/30',
  completed: 'bg-primary/20 text-primary border-primary/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
};


// A job counts as "paid" once a linked income record is marked paid —
// distinct from just "completed" (worked, pay estimated but not yet received).
function jobDotClass(job: Job, paidJobIds: Set<string>): string {
  if (paidJobIds.has(job.id)) return 'bg-success';
  if (isOverdueUpcoming(job)) return 'bg-warning';
  return statusDot[job.status];
}

// Card wash behind a shift — same status meaning as the dot, just readable
// from across the list instead of a 6px dot.
function cardTintClass(job: Job, paidJobIds: Set<string>): string {
  if (paidJobIds.has(job.id)) return 'from-success/20 via-success/[0.06] to-transparent';
  if (isOverdueUpcoming(job)) return 'from-warning/20 via-warning/[0.06] to-transparent';
  if (job.status === 'completed') return 'from-primary/20 via-primary/[0.06] to-transparent';
  if (job.status === 'cancelled') return 'from-white/10 via-white/[0.03] to-transparent';
  return 'from-accent/20 via-accent/[0.06] to-transparent';
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

function resolveTypedEnd(start: string, end: string): string {
  if (!end.trim()) return end;
  const s = parseTimeToMins(start);
  if (isNaN(s)) return normalizeTyped(end);
  const e = resolveEndMins(s, end);
  return isNaN(e) ? end : minutesToTimeStr(e);
}

function calcHours(start: string, end: string): number {
  const s = parseTimeToMins(start);
  if (isNaN(s)) return 0;
  let e = resolveEndMins(s, end);
  if (isNaN(e)) return 0;
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

// ── Job detail view ───────────────────────────────────────────────────────────

function JobDetailView({ job, onBack, onSave, onDuplicated, onDelete }: {
  job: Job;
  onBack: () => void;
  onSave: (updates: Partial<Job>) => void;
  onDuplicated: (count: number) => void;
  onDelete: () => void;
}) {
  const { data, addJob, updateJob: updateJobDirect, updateIncome, updateEmployer } = useData();
  const { user } = useAuth();
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const isCallback = !!job.notes?.match(/\bC\/?B\b/i) && !job.notes?.match(/\bNO[\s/-]*C\/?B\b/i);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [client, setClient] = useState(job.client ?? '');
  const [startTime, setStartTime] = useState(job.startTime ?? '');
  const [endTime, setEndTime] = useState(job.endTime ?? '');
  const [hoursWorked, setHoursWorked] = useState(job.hoursWorked?.toString() ?? '');
  const [hourlyRate, setHourlyRate] = useState(job.hourlyRate?.toString() ?? '');
  const [minimumHours, setMinimumHours] = useState(job.minimumHours?.toString() ?? '');
  const [payrollCompany, setPayrollCompany] = useState(job.payrollCompany ?? '');
  const [mealDuration, setMealDuration] = useState<Job['mealDuration']>(job.mealDuration ?? undefined);
  const [mealOnClock, setMealOnClock] = useState(job.mealOnClock ?? false);
  const [mealPenalties, setMealPenalties] = useState(job.mealPenalties?.toString() ?? '');
  const [nightPremiumConfirmed, setNightPremiumConfirmed] = useState(job.nightPremiumConfirmed ?? true);
  const [nightPremiumActualHours, setNightPremiumActualHours] = useState(job.nightPremiumActualHours?.toString() ?? '');
  const [payStub, setPayStub] = useState(job.payStub ?? '');
  const [stubParsed, setStubParsed] = useState(job.stubParsed);
  const [parsingStub, setParsingStub] = useState(false);
  const [viewingStub, setViewingStub] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [dupDates, setDupDates] = useState<string[]>(['']);
  const stubInputRef = useRef<HTMLInputElement>(null);

  const resetFieldsFromJob = () => {
    setClient(job.client ?? '');
    setStartTime(job.startTime ?? '');
    setEndTime(job.endTime ?? '');
    // Older/imported shifts can have both times but never got hoursWorked
    // computed (only happened when someone retyped End Time by hand) — derive
    // it here too so reopening one shows the right hours instead of 0.
    const derivedHours = (!job.hoursWorked && job.startTime && job.endTime) ? calcHours(job.startTime, job.endTime) : 0;
    setHoursWorked(job.hoursWorked?.toString() ?? (derivedHours > 0 ? parseFloat(derivedHours.toFixed(2)).toString() : ''));
    setHourlyRate(job.hourlyRate?.toString() ?? '');
    setMinimumHours(job.minimumHours?.toString() ?? '');
    setPayrollCompany(job.payrollCompany ?? '');
    setMealDuration(job.mealDuration ?? undefined);
    setMealOnClock(job.mealOnClock ?? false);
    setMealPenalties(job.mealPenalties?.toString() ?? '');
    setNightPremiumConfirmed(job.nightPremiumConfirmed ?? true);
    setNightPremiumActualHours(job.nightPremiumActualHours?.toString() ?? '');
    setPayStub(job.payStub ?? '');
    setStubParsed(job.stubParsed);
    setDuplicating(false);
    setDupDates(['']);
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

  const handleStubUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (stubInputRef.current) stubInputRef.current.value = '';
    if (!file) return;

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
        await updateJobDirect(job.id, { payStub: stubValue });
        return;
      }

      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/parse-statement`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
          body: JSON.stringify({ imageBase64: dataUrl.split(',')[1], mimeType: 'image/jpeg', type: 'paystub' }),
        });
        if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to read pay stub');
        const { paystub } = await resp.json();
        setStubParsed(paystub);
        await updateJobDirect(job.id, { payStub: stubValue, stubParsed: paystub });
        toast.success('Pay stub read — net $' + (paystub.netPay ?? '?'));
      } catch (err) {
        // Attachment is still worth keeping; parsing failure isn't fatal.
        await updateJobDirect(job.id, { payStub: stubValue });
        toast.error(err instanceof Error ? err.message : 'Could not read the pay stub — saved as attachment only');
      }
    } finally {
      setParsingStub(false);
    }
  };

  const handleDelete = () => setConfirmingDelete(true);

  const paidIncomeForJob = data.income.filter(i => i.jobId === job.id && i.status === 'paid');

  const employer = resolveEmployer(client, data.employers);
  const rawNightHours = ((employer?.nightPremiumEnabled ?? true) && startTime && endTime)
    ? calculateNightHours(startTime, endTime, employer?.nightPremiumStartHour ?? 0, employer?.nightPremiumEndHour)
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
        name: job.name,
        client: job.client,
        venue: job.venue,
        date,
        startTime: job.startTime,
        endTime: job.endTime,
        status: 'upcoming',
        paySchedule: job.paySchedule,
        payrollCompany: job.payrollCompany,
        hourlyRate: job.hourlyRate,
        minimumHours: job.minimumHours,
        has6th7thDayRule: job.has6th7thDayRule,
        hasVacationPay: job.hasVacationPay,
        steward: job.steward,
        mealDuration: job.mealDuration,
        mealOnClock: job.mealOnClock,
        nightPremiumConfirmed: job.nightPremiumConfirmed,
        notes: job.notes,
      });
    }
    onDuplicated(dates.length);
  };

  const handleEndTimeChange = (val: string) => {
    setEndTime(val);
    if (startTime && val) {
      const h = calcHours(startTime, val);
      if (h > 0) setHoursWorked(parseFloat(h.toFixed(2)).toString());
    }
  };

  const handleHoursWorkedChange = (val: string) => {
    setHoursWorked(val);
    const h = parseFloat(val);
    if (startTime && !isNaN(h) && h > 0) {
      setEndTime(addHoursToTime(startTime, h));
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
      if (startTime && !endTime) setEndTime(addHoursToTime(startTime, hours));
    }
  };

  const actualHours = parseFloat(hoursWorked) || 0;
  const minHours = parseFloat(minimumHours) || 0;
  // Mirrors calculateDayPay: an off-the-clock meal comes out of the hours
  // before the minimum-call floor applies. Without this the on/off toggle
  // changed the pay but every hours figure on screen stayed put.
  const mealDeductionHours = (mealDuration && !mealOnClock) ? mealDuration / 60 : 0;
  const paidHours = Math.max(0, actualHours - mealDeductionHours);
  const billableHours = Math.max(paidHours, minHours);
  const minimumApplied = minHours > 0 && paidHours < minHours && paidHours > 0;
  const rate = parseFloat(hourlyRate) || 0;
  const mealPenaltyUnits = parseFloat(mealPenalties) || 0;
  const payPreview = rate > 0 && billableHours > 0
    ? calculateDayPay(actualHours, rate, minHours, mealPenaltyUnits, 1, { duration: mealDuration, onClock: mealOnClock }, { nightHours, nightMultiplier: employer?.nightPremiumMultiplier, unionDuesPercent: employer?.unionDuesPercent, estimatedTaxPercent: employer?.estimatedTaxPercent })
    : null;
  // calculateDayPay's own breakdown stops at dues/tax — vacation is applied
  // on top of that (same as jobGross/jobPayBreakdown), so it needs its own
  // line here or this "paperwork" total silently disagrees with the net
  // figure shown everywhere else in the app.
  const vacationPercent = employer?.vacationPercent ?? 0;
  const vacationAmount = payPreview && vacationPercent > 0 ? payPreview.totalPay * (vacationPercent / 100) : 0;
  const payPreviewTotal = (payPreview?.totalPay ?? 0) + vacationAmount;

  const stubMatch = useMemo(
    () => (stubParsed ? matchStubToShifts(stubParsed, data.jobs) : null),
    [stubParsed, data.jobs],
  );

  const stubComparison = useMemo(
    () => (stubParsed && stubMatch ? compareStubToShifts(stubParsed, stubMatch.jobs, data.jobs, data.employers) : null),
    [stubParsed, stubMatch, data.jobs, data.employers],
  );
  const stubDisagreements = useMemo(() => (stubComparison ? disagreements(stubComparison) : []), [stubComparison]);

  const stubSuggestions = useMemo(
    () => (stubParsed ? learnFromStubs(data.jobs, data.employers) : []),
    [stubParsed, data.jobs, data.employers],
  );

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

  const handleSave = () => {
    const updates: Partial<Job> = {};
    if (client.trim() !== (job.client ?? '') && client.trim()) updates.client = client.trim();
    if (startTime !== (job.startTime ?? '')) updates.startTime = startTime || undefined;
    if (endTime !== (job.endTime ?? '')) updates.endTime = endTime || undefined;
    if (actualHours > 0) { updates.hoursWorked = actualHours; updates.status = 'completed'; }
    if (hourlyRate !== (job.hourlyRate?.toString() ?? '')) updates.hourlyRate = rate > 0 ? rate : undefined;
    const parsedMin = parseFloat(minimumHours);
    if (!isNaN(parsedMin) && parsedMin !== (job.minimumHours ?? 0)) updates.minimumHours = parsedMin > 0 ? parsedMin : undefined;
    if (payrollCompany !== (job.payrollCompany ?? '')) updates.payrollCompany = payrollCompany.trim() || undefined;
    if (mealDuration !== (job.mealDuration ?? undefined)) updates.mealDuration = mealDuration;
    if (mealDuration && mealOnClock !== (job.mealOnClock ?? false)) updates.mealOnClock = mealOnClock;
    const parsedPenalties = parseFloat(mealPenalties);
    if (!isNaN(parsedPenalties) && parsedPenalties !== (job.mealPenalties ?? 0)) updates.mealPenalties = parsedPenalties > 0 ? parsedPenalties : undefined;
    if (rawNightHours > 0) {
      if (nightPremiumConfirmed !== (job.nightPremiumConfirmed ?? true)) updates.nightPremiumConfirmed = nightPremiumConfirmed;
      const nextActualHours = nightPremiumConfirmed ? undefined : validNightActualHours;
      if (nextActualHours !== (job.nightPremiumActualHours ?? undefined)) updates.nightPremiumActualHours = nextActualHours;
    }
    if (payStub !== (job.payStub ?? '')) updates.payStub = payStub || undefined;
    onSave(updates);
  };

  const nightActualHoursChanged = rawNightHours > 0 && !nightPremiumConfirmed &&
    validNightActualHours !== (job.nightPremiumActualHours ?? undefined);

  const hasChanges =
    (client.trim() !== (job.client ?? '') && client.trim() !== '') ||
    startTime !== (job.startTime ?? '') ||
    endTime !== (job.endTime ?? '') ||
    hoursWorked !== (job.hoursWorked?.toString() ?? '') ||
    hourlyRate !== (job.hourlyRate?.toString() ?? '') ||
    minimumHours !== (job.minimumHours?.toString() ?? '') ||
    payrollCompany !== (job.payrollCompany ?? '') ||
    mealDuration !== (job.mealDuration ?? undefined) ||
    (!!mealDuration && mealOnClock !== (job.mealOnClock ?? false)) ||
    (mealPenalties !== (job.mealPenalties?.toString() ?? '')) ||
    (rawNightHours > 0 && nightPremiumConfirmed !== (job.nightPremiumConfirmed ?? true)) ||
    nightActualHoursChanged ||
    payStub !== (job.payStub ?? '');

  return (
    <>
      <DialogHeader>
        {/* One toolbar row: back on the left, destructive and close on the
            right, all the same size on the same baseline. Previously back and
            delete sat in the title row while the close button was absolutely
            positioned 8px higher, so the three never lined up. */}
        <div className="flex items-center gap-1 -mx-1.5 -mt-1.5">
          <button onClick={onBack} aria-label="Back" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-secondary">
            <ArrowLeft size={18} />
          </button>
          <span className="flex-1" />
          <button onClick={handleDelete} aria-label="Delete shift" className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-2 rounded-lg hover:bg-destructive/10">
            <Trash2 size={18} />
          </button>
          <DialogClose asChild>
            <button aria-label="Close" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-secondary">
              <X size={18} />
            </button>
          </DialogClose>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-body uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <span>{format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d, yyyy')}</span>
            {isCallback && <Phone size={11} className="text-destructive shrink-0" aria-label="Callback" />}
          </p>
          <DialogTitle className="text-mono text-sm truncate">{job.name}</DialogTitle>
        </div>
      </DialogHeader>
      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this shift?</AlertDialogTitle>
            <AlertDialogDescription>
              "{job.name}" on {format(new Date(job.date + 'T12:00:00'), 'MMM d, yyyy')} will be permanently deleted. This cannot be undone.
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
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-mono uppercase tracking-wider border", isOverdueUpcoming(job) ? "bg-warning/20 text-warning border-warning/30" : statusColors[job.status])}>
          {isOverdueUpcoming(job) ? 'Needs Hours' : statusLabel[job.status]}
        </span>

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
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Start Time</label>
            <Input
              value={startTime}
              onBlur={() => setStartTime(normalizeTyped(startTime))}
              onChange={e => setStartTime(e.target.value)}
              placeholder="e.g. 08:00 AM"
              className="h-10 text-base text-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">End Time</label>
            <Input
              autoFocus={actualHours === 0}
              value={endTime}
              onBlur={() => handleEndTimeChange(resolveTypedEnd(startTime, endTime))}
              onChange={e => handleEndTimeChange(e.target.value)}
              placeholder="e.g. 18:00 or 6:00 PM"
              className="h-10 text-base text-mono"
            />
            {startTime && endTime && calcHours(startTime, endTime) > 0 && (
              <p className="text-[10px] text-mono text-muted-foreground">{startTime} → {endTime} = <span className="text-accent font-semibold">{calcHours(startTime, endTime).toFixed(1)}h</span></p>
            )}
          </div>

          {/* Meal break — 2nd most important question after End Time, so it
              lives right here instead of buried in Edit shift. Break duration
              and meal-penalty units are independent now: you can take a
              partial break AND still be owed a penalty for it running late,
              so picking one no longer hides the other. */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Meal Break</label>
            <div className="grid grid-cols-4 gap-1.5">
              {([{ value: 0 as const, label: 'MP' }, { value: 30 as const, label: '30m' }, { value: 45 as const, label: '45m' }, { value: 60 as const, label: '1hr' }]).map(({ value, label }) => {
                const active = mealDuration === value;
                return (
                  <button key={label} type="button" onClick={() => setMealDuration(active ? undefined : value)} className={cn("rounded-md border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                    <p className={cn("text-sm font-bold text-mono", active && "text-primary")}>{label}</p>
                  </button>
                );
              })}
            </div>
            {mealDuration !== undefined && mealDuration > 0 && (
              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                {[{ value: true, label: 'On the clock', sub: 'paid, no deduction' }, { value: false, label: 'Off the clock', sub: `${mealDuration}min deducted` }].map(({ value, label, sub }) => {
                  const active = mealOnClock === value;
                  return (
                    <button key={label} type="button" onClick={() => setMealOnClock(value)} className={cn("rounded-md border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                      <p className={cn("text-xs font-bold", active && "text-primary")}>{label}</p>
                      <p className="text-[9px] leading-tight mt-0.5 opacity-70">{sub}</p>
                    </button>
                  );
                })}
              </div>
            )}
            {/* The toggle's whole effect is on hours paid, so show that here
                rather than only deep in the pay breakdown. */}
            {actualHours > 0 && mealDuration !== undefined && mealDuration > 0 && (
              <p className="text-[11px] text-mono pt-0.5">
                {mealDeductionHours > 0 ? (
                  <><span className="text-muted-foreground line-through">{actualHours}h</span>{' '}
                    <span className="text-accent font-semibold">{paidHours}h paid</span>{' '}
                    <span className="text-muted-foreground">({mealDuration}min off the clock)</span></>
                ) : (
                  <><span className="text-accent font-semibold">{actualHours}h paid</span>{' '}
                    <span className="text-muted-foreground">(meal stays on the clock)</span></>
                )}
              </p>
            )}
            <div className="pt-0.5">
              <label className="text-[10px] text-mono uppercase text-muted-foreground">Meal penalty (MP) units — 1 unit = 1hr at straight rate</label>
              <ScrollWheel
                values={Array.from({ length: 10 }, (_, i) => i)}
                value={parseFloat(mealPenalties) || 0}
                onChange={v => setMealPenalties(String(v))}
                className="mt-1 w-20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Hours Worked</label>
              <Input type="number" min="0" step="0.5" value={hoursWorked} onChange={e => handleHoursWorkedChange(e.target.value)} placeholder="e.g. 8" className="h-9 text-sm text-mono" />
              {/* The box holds the clocked span, because that is what gets saved and
                  what calculateDayPay expects — but the number that matters when you
                  are looking at it is the hours you actually worked, so show that too. */}
              {mealDeductionHours > 0 && actualHours > 0 && (
                <p className="text-[10px] text-mono text-muted-foreground leading-tight">
                  clocked — <span className="text-accent font-semibold">{paidHours}h worked</span> after the {mealDuration}min meal
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Rate ($/hr)</label>
              <Input type="number" min="0" step="0.01" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} placeholder="e.g. 45" className="h-9 text-sm text-mono" />
            </div>
          </div>
          {!rate && (
            <p className="text-[10px] text-warning">⚠ No rate set — pay won't calculate until this is filled in</p>
          )}
          <Button size="sm" className="w-full" disabled={!hasChanges} onClick={handleSave}>
            Save Hours
          </Button>
        </div>

        {paidIncomeForJob.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              for (const inc of paidIncomeForJob) await updateIncome(inc.id, { status: 'pending' });
              toast.success('Marked unpaid');
            }}
            className="flex items-center gap-2.5 rounded-md border border-success/40 bg-success/10 p-3 w-full text-left"
          >
            <span className="text-lg shrink-0">💰</span>
            <span className="flex-1 text-xs">
              <span className="font-medium block">Marked paid — ${paidIncomeForJob.reduce((s, i) => s + i.amount, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-[11px] text-muted-foreground">Didn't confirm this yourself? Tap to undo.</span>
            </span>
          </button>
        )}
        <div className="rounded-md border border-border bg-secondary/10 p-3 space-y-2">
          {(client || job.client) && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Client</span><span className="font-medium text-xs">{client || job.client}</span></div>}
          {(job.payrollCompany || payrollCompany) && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Employer / Payroll</span><span className="font-medium text-xs">{payrollCompany || job.payrollCompany}</span></div>}
          {job.venue && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Venue</span><span className="font-medium text-xs">{job.venue}</span></div>}
          {job.jobNumber && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Job #</span><span className="font-medium text-xs text-mono">{job.jobNumber}</span></div>}
          {(startTime || job.startTime) && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Start</span><span className="font-medium text-xs text-mono">{startTime || job.startTime}{endTime ? ` – ${endTime}` : ''}</span></div>}
          {actualHours > 0 && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Hours Worked</span><span className="font-medium text-xs text-mono">{mealDeductionHours > 0 ? <><span className="text-muted-foreground/60 line-through">{actualHours}h</span> {paidHours}h</> : `${actualHours}h`}</span></div>}
          {rate > 0 && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Rate</span><span className="font-medium text-xs text-mono">${rate}/hr</span></div>}
        </div>
        {payPreview && (
          <div className={cn("rounded-md border p-3 space-y-1.5", minimumApplied ? "border-accent/40 bg-accent/5" : "border-success/30 bg-success/5")}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{minimumApplied ? `Worked ${actualHours}h — paid for ${billableHours}h minimum` : mealDeductionHours > 0 ? `Worked ${actualHours}h — ${mealDuration}min meal = ${paidHours}h paid` : `Worked ${actualHours}h`}</span>
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

        <label className={cn(
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
                deleteStub(payStub);
                setPayStub(''); setStubParsed(undefined);
                updateJobDirect(job.id, { payStub: undefined, stubParsed: undefined });
              }}
              className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              aria-label="Remove pay stub"
            >
              <X size={14} />
            </button>
          )}
          <input ref={stubInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleStubUpload} disabled={parsingStub} />
        </label>

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
                  <span className="shrink-0 text-muted-foreground">{netHoursWorked(j)}h</span>
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

        {/* Phase 5: what the stubs imply this employer's rates really are. */}
        {stubSuggestions.length > 0 && (
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
        )}

        {editing && (
        <>
        <div className="rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setDuplicating(d => !d)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-secondary/30 transition-colors"
          >
            <Copy size={14} className="text-muted-foreground shrink-0" />
            <span className="text-xs font-medium flex-1">Duplicate this shift to other dates</span>
            <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", duplicating && "rotate-180")} />
          </button>
          {duplicating && (
            <div className="border-t border-border p-3 space-y-2">
              <p className="text-[10px] text-muted-foreground">
                Same employer, venue, time & rate — creates a new shift per date.
              </p>
              {dupDates.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={d}
                    onChange={e => setDupDates(prev => prev.map((v, vi) => vi === i ? e.target.value : v))}
                    className="flex-1 h-9 rounded-lg bg-secondary/30 border border-border text-foreground text-xs font-mono px-3 focus:outline-none focus:border-primary/40"
                  />
                  {dupDates.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDupDates(prev => prev.filter((_, vi) => vi !== i))}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1.5"
                      aria-label="Remove date"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setDupDates(prev => [...prev, ''])}>
                  + Add date
                </Button>
                <Button size="sm" className="flex-1" onClick={handleDuplicate}>
                  Create shift{dupDates.filter(Boolean).length !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/50 uppercase">Update Job</p>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Client</label>
            <Input value={client} onChange={e => setClient(e.target.value)} placeholder="e.g. Live Nation" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Employer / Payroll Company</label>
            <Input value={payrollCompany} onChange={e => setPayrollCompany(e.target.value)} placeholder="e.g. Nolan AV, Live Nation" className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Min. Call</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[4, 5, 8].map(hours => {
                const active = minimumHours === hours.toString();
                return (
                  <button key={hours} type="button" onClick={() => handleMinimumClick(hours)} className={cn("rounded-md border py-2 text-center text-sm font-bold text-mono transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                    {hours}h
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
                <span className="font-medium">{rawNightHours}h after midnight were actually worked</span>
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
                  <span className="text-[11px] text-muted-foreground">of {rawNightHours}h — the rest bills straight time</span>
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
        autoFocus
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
  const { data, updateJob, deleteJob, addEvent, updateEvent, deleteEvent } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [addingEventDate, setAddingEventDate] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddShiftOpen, setQuickAddShiftOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Deep-link from Dashboard's hero cards (?job=<id>) straight into that
  // shift's detail view instead of making the user hunt for it on the grid.
  useEffect(() => {
    const jobId = searchParams.get('job');
    if (!jobId) return;
    const job = data.jobs.find(j => j.id === jobId);
    if (job) {
      setSelectedDate(job.date);
      setSelectedJobId(job.id);
    }
    setSearchParams(prev => { prev.delete('job'); return prev; }, { replace: true });
  }, [searchParams, data.jobs, setSearchParams]);

  const jobsByDate = useMemo(() => {
    const map: Record<string, Job[]> = {};
    data.jobs.forEach(job => { if (!map[job.date]) map[job.date] = []; map[job.date].push(job); });
    return map;
  }, [data.jobs]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    data.events.forEach(ev => { if (!map[ev.date]) map[ev.date] = []; map[ev.date].push(ev); });
    return map;
  }, [data.events]);

  const paidJobIds = useMemo(() => {
    const set = new Set<string>();
    for (const income of data.income) {
      if (income.status === 'paid' && income.jobId) set.add(income.jobId);
    }
    return set;
  }, [data.income]);

  // Per-job expected pay — the single source of truth behind the calendar's
  // day/week/month totals below AND the "Awaiting payment" list, so they can
  // never drift out of sync with each other. Delegates to jobGross (dues,
  // taxes, weekly OT bonus, vacation pay and all) instead of re-deriving the
  // same math locally — a previous local copy here left vacation pay out of
  // these totals while the per-job display included it, so the two disagreed.
  const jobPay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const job of data.jobs) {
      const pay = jobGross(job, data.jobs, data.employers);
      if (pay > 0) map[job.id] = pay;
    }
    return map;
  }, [data.jobs, data.employers]);

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
    const monthExpected = monthJobs.reduce((s, j) => s + jobGross(j, data.jobs, data.employers), 0);
    const monthPaid = data.income
      .filter(i => i.status === 'paid' && (() => { try { return isWithinInterval(parseISO(i.date), { start: monthStart, end: monthEnd }); } catch { return false; } })())
      .reduce((s, i) => s + i.amount, 0);

    const yearPrefix = format(currentDate, 'yyyy');
    const ytdJobs = data.jobs.filter(j => j.date.startsWith(yearPrefix));
    const ytdHours = ytdJobs.reduce((s, j) => s + netHoursWorked(j), 0);
    const ytdExpected = ytdJobs.reduce((s, j) => s + jobGross(j, data.jobs, data.employers), 0);
    const ytdPaid = data.income
      .filter(i => i.status === 'paid' && i.date.startsWith(yearPrefix))
      .reduce((s, i) => s + i.amount, 0);

    return {
      month: { label: format(currentDate, 'MMM'), hours: monthHours, expected: monthExpected, paid: monthPaid, unpaid: Math.max(0, monthExpected - monthPaid) },
      ytd: { label: yearPrefix, hours: ytdHours, expected: ytdExpected, paid: ytdPaid, unpaid: Math.max(0, ytdExpected - ytdPaid) },
    };
  }, [data.jobs, data.income, data.employers, currentDate]);

  // Dates that are the 6th+ consecutive day worked for the same employer —
  // flagged regardless of whether "6th/7th day rule" is checked on the job,
  // so it's a heads-up to go verify the contract, not just a confirmation.
  const sixthSeventhDayDates = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      let maxStreak = 0;
      for (const job of jobs) {
        if (effectiveHoursWorked(job) <= 0) continue;
        const streak = getConsecutiveDayStreak(date, job.client, data.jobs);
        if (streak > maxStreak) maxStreak = streak;
      }
      if (maxStreak >= 6) map[date] = maxStreak;
    }
    return map;
  }, [jobsByDate, data.jobs]);

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

  const monthStats = useMemo(() => {
    const prefix = format(currentDate, 'yyyy-MM');
    let totalHours = 0, totalPay = 0, totalJobs = 0;
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      if (!date.startsWith(prefix)) continue;
      totalJobs += jobs.length;
      totalHours += jobs.reduce((s, j) => s + netHoursWorked(j), 0);
      totalPay += payByDate[date] || 0;
    }
    return { totalHours, totalPay, totalJobs };
  }, [jobsByDate, payByDate, currentDate]);

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

  const today = new Date();
  const selectedJobs = selectedDate ? (jobsByDate[selectedDate] || []) : [];
  const selectedJob = selectedJobId ? data.jobs.find(j => j.id === selectedJobId) ?? null : null;
  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];
  const closeDialog = () => { setSelectedDate(null); setSelectedJobId(null); setAddingEventDate(null); setEditingEventId(null); };

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
      title="Calendar"
      description="Your month at a glance"
      action={
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setQuickAddShiftOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <Plus size={13} /> if you want work (add an offer)
          </button>
          <button
            onClick={() => setQuickAddOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-info/40 bg-info/10 hover:bg-info/20 text-info px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <Plus size={13} /> make a plan
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="flex flex-1 bg-secondary/30 rounded-lg p-0.5">
          <button onClick={() => setViewMode('month')} className={cn("flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors", viewMode === 'month' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Month</button>
          <button onClick={() => setViewMode('year')} className={cn("flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors", viewMode === 'year' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Year</button>
        </div>
      </div>

      <div className="flex items-stretch justify-between mb-3 gap-2">
        <button
          onClick={() => viewMode === 'month' ? setCurrentDate(prev => subMonths(prev, 1)) : setCurrentYear(prev => prev - 1)}
          className="flex items-center justify-center w-12 min-h-[44px] rounded-md bg-primary/30 active:bg-primary/50 text-primary transition-colors border border-primary/40"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <h2 className="font-body text-base font-semibold tracking-wide">
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
                <div key={i} className="text-center text-[10px] text-muted-foreground text-mono py-1 font-medium">{d}</div>
              ))}
            </div>
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
                {week.map((day, i) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayJobs = jobsByDate[dateKey] || [];
                  const dayEvents = eventsByDate[dateKey] || [];
                  const todayFlag = isSameDay(day, today);
                  const isCurrentMonth = isSameMonth(day, currentDate);
                  const hasJobs = dayJobs.length > 0;
                  const hasEvents = dayEvents.length > 0;
                  const hasPay = !!payByDate[dateKey];
                  const sixthSeventhStreak = sixthSeventhDayDates[dateKey];
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedDate(dateKey)}
                      title={sixthSeventhStreak ? `${sixthSeventhStreak}th consecutive day worked for this employer` : "Tap to add a plan or view this day"}
                      className={cn(
                        "relative flex flex-col items-center py-1.5 transition-colors rounded-lg mx-0.5 mb-0.5 cursor-pointer active:bg-secondary/60 hover:bg-secondary/30",
                        !isCurrentMonth && 'opacity-30',
                        todayFlag && 'bg-primary/10',
                        sixthSeventhStreak && 'bg-warning/20 ring-1 ring-warning/60'
                      )}
                    >
                      {sixthSeventhStreak > 0 && (
                        <span className="absolute top-0 right-0.5 w-1.5 h-1.5 rounded-full bg-warning" />
                      )}
                      {todayFlag ? (
                        <span className="relative w-6 h-6 flex items-center justify-center">
                          <Star size={24} className="absolute text-primary fill-primary" />
                          <span className="relative text-[11px] text-mono leading-none text-primary-foreground font-bold">{format(day, 'd')}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-mono leading-none w-6 h-6 flex items-center justify-center text-foreground">{format(day, 'd')}</span>
                      )}
                      {dayJobs.length > 0 && <span className="text-[7px] text-muted-foreground leading-tight text-center truncate max-w-[3rem] mt-0.5">{dayJobs[0].venue || dayJobs[0].client}</span>}
                      <div className="flex gap-0.5 mt-0.5 h-2 items-center">
                        {dayJobs.slice(0, 3).map((job, j) => <span key={j} className={cn("w-1.5 h-1.5 rounded-full", jobDotClass(job, paidJobIds))} />)}
                        {dayJobs.length > 3 && <span className="text-[7px] text-muted-foreground text-mono">+{dayJobs.length - 3}</span>}
                        {hasEvents && <span className="w-1.5 h-1.5 rounded-full bg-black border border-white" title="Personal event" />}
                      </div>
                      {hasPay && <span className="text-[8px] text-mono text-success font-semibold leading-none mt-0.5">${payByDate[dateKey] >= 1000 ? `${(payByDate[dateKey] / 1000).toFixed(1)}k` : payByDate[dateKey].toFixed(0)}</span>}
                    </div>
                  );
                })}
            </div>
          ))}
          <div className="mt-4 space-y-1">
            <div className="flex items-center justify-between px-1 pb-1 border-b border-border/30">
              <span className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50">{format(currentDate, 'MMMM')}</span>
              <div className="flex items-center gap-3">
                {monthStats.totalHours > 0 ? <span className="text-[11px] text-mono font-semibold text-primary">{monthStats.totalHours.toFixed(1)}h</span> : <span className="text-[11px] text-mono text-muted-foreground/25">—</span>}
                {monthStats.totalPay > 0 && <span className="text-[11px] text-mono font-bold text-success">${monthStats.totalPay >= 1000 ? `${(monthStats.totalPay / 1000).toFixed(1)}k` : monthStats.totalPay.toFixed(0)}</span>}
              </div>
            </div>
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
              for (const [date, jobs] of Object.entries(jobsByDate)) {
                if (!date.startsWith(monthPrefix)) continue;
                monthJobs += jobs.length;
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
                    {monthPay > 0 && <span className="text-[7px] text-mono text-success font-semibold">${monthPay >= 1000 ? `${(monthPay / 1000).toFixed(1)}k` : monthPay.toFixed(0)}</span>}
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
                          className={cn('h-3 flex items-center justify-center text-[6px] text-mono rounded-[2px] transition-colors select-none', dayJobs.length > 0 && 'cursor-pointer', hasPaid && 'bg-success/30 text-success font-semibold', !hasPaid && hasCompleted && 'bg-primary/25 text-primary', !hasPaid && !hasCompleted && hasUpcoming && 'bg-accent/20 text-accent', !dayJobs.length && 'text-muted-foreground/25', todayFlag && 'ring-1 ring-inset ring-primary/70')}
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
                {yearStats.totalHours > 0 && <span className="text-xs text-mono font-semibold text-primary">{yearStats.totalHours.toFixed(1)}h</span>}
                {yearStats.totalPay > 0 && <span className="text-xs text-mono font-bold text-success">${yearStats.totalPay >= 1000 ? `${(yearStats.totalPay / 1000).toFixed(1)}k` : yearStats.totalPay.toFixed(0)}</span>}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 px-1">
            <span className="text-[8px] text-muted-foreground/40 font-body uppercase tracking-wider">Legend</span>
            {[{ color: 'bg-accent/20', label: 'Upcoming' }, { color: 'bg-primary/25', label: 'Completed' }, { color: 'bg-success/30', label: 'Paid' }].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={cn('w-3 h-3 rounded-[2px]', color)} />
                <span className="text-[8px] text-muted-foreground/50 font-body">{label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── This Month / YTD (small) + Export ────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[monthYtdStats.month, monthYtdStats.ytd].map(period => (
          <div key={period.label} className="rounded-md border border-border/40 bg-secondary/10 p-3">
            <p className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 mb-2">{period.label}</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Hours</span>
                <span className="text-mono font-semibold">{period.hours.toFixed(1)}h</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Earned</span>
                <span className="text-mono font-semibold text-primary">${period.expected.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Paid</span>
                <span className="text-mono font-semibold text-success">${period.paid.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Unpaid</span>
                <span className={cn("text-mono font-semibold", period.unpaid > 0 ? "text-warning" : "text-muted-foreground")}>
                  {period.unpaid > 0 ? `$${period.unpaid.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '✓'}
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
                {selectedDate && sixthSeventhDayDates[selectedDate] > 0 && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                    ⚠ {sixthSeventhDayDates[selectedDate]}th consecutive day worked{' '}
                    {selectedJobs
                      .filter(job => getConsecutiveDayStreak(selectedDate, job.client, data.jobs) >= 6)
                      .map(job => job.client)
                      .filter((c, i, arr) => arr.indexOf(c) === i)
                      .join(', ') || 'for this employer'} — check contract for premium pay.
                  </div>
                )}
                {selectedJobs.map(job => {
                  const hours = netHoursWorked(job);
                  const earned = jobGross(job, data.jobs, data.employers);
                  const paid = paidJobIds.has(job.id);
                  const overdue = isOverdueUpcoming(job);
                  return (
                    <div key={job.id} onClick={() => setSelectedJobId(job.id)} className={cn("rounded-md border p-3 space-y-1 cursor-pointer hover:opacity-90 transition-opacity", paid ? "bg-success/20 text-success border-success/30" : overdue ? "bg-warning/20 text-warning border-warning/30" : statusColors[job.status])}>
                      <div className="flex items-start justify-between">
                        <div><p className="font-medium text-sm">{job.name}</p><p className="text-xs opacity-70">{job.client}</p></div>
                        <span className="text-[10px] text-mono uppercase font-medium opacity-70">{paid ? 'Paid' : overdue ? 'Needs Hours' : job.status}</span>
                      </div>
                      {job.venue && <p className="text-xs opacity-60">{job.venue}</p>}
                      <div className="flex items-center gap-3 text-xs text-mono">
                        {job.startTime && <span>{job.startTime}{job.endTime ? ` – ${job.endTime}` : ''}</span>}
                        {hours > 0 && <span>{hours}h</span>}
                        {earned > 0 && <span className="font-semibold">${earned.toLocaleString()}</span>}
                        <Receipt size={11} className={job.payStub ? 'opacity-70' : 'opacity-25'} aria-label={job.payStub ? 'Pay stub uploaded' : 'No pay stub'} />
                      </div>
                      {job.startTime && !job.endTime && (
                        <p className="text-[10px] text-warning font-medium">⚠ No end time set — tap to add it</p>
                      )}
                      <p className="text-[10px] opacity-40 text-mono">Tap for details →</p>
                    </div>
                  );
                })}
                {payByDate[selectedDate!] && (
                  <div className="flex items-center justify-between pt-2 border-t border-border text-sm text-mono">
                    <span className="text-muted-foreground">Estimated pay</span>
                    <span className="font-bold text-success">${payByDate[selectedDate!].toLocaleString()}</span>
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
              onBack={() => setSelectedJobId(null)}
              onSave={(updates) => { updateJob(selectedJob.id, updates); setSelectedJobId(null); toast.success('Job updated'); }}
              onDuplicated={(count) => { closeDialog(); toast.success(`Created ${count} shift${count !== 1 ? 's' : ''}`); }}
              onDelete={async () => { await deleteJob(selectedJob.id); closeDialog(); toast.success('Shift deleted'); }}
            />
          )}
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
        const monthJobs = data.jobs.filter(job => job.date.startsWith(monthPrefix)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
        if (monthJobs.length === 0) return null;
        const loggedGroups: Record<string, Job[]> = {};
        for (const job of monthJobs) {
          const key = job.jobNumber?.trim() || `${job.name}__${job.client}`;
          if (!loggedGroups[key]) loggedGroups[key] = [];
          loggedGroups[key].push(job);
        }
        return (
          <div className="mt-4 flex flex-col gap-2">
            <h2 className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
              This month's shifts
            </h2>
            <div className="flex flex-col gap-2.5">
              {Object.entries(loggedGroups).map(([key, jobs]) => {
                const first = jobs[0];
                const totalHours = jobs.reduce((s, j) => s + netHoursWorked(j), 0);
                const totalEarned = jobs.reduce((s, j) => s + jobGross(j, data.jobs, data.employers), 0);
                const last = jobs[jobs.length - 1];
                const dateRange = jobs.length > 1 ? `${format(new Date(last.date + 'T12:00:00'), 'MMM d')} – ${format(new Date(first.date + 'T12:00:00'), 'MMM d')}` : format(new Date(first.date + 'T12:00:00'), 'MMM d');
                const isGroup = jobs.length > 1;
                const expanded = expandedGroupKey === key;
                const openJob = (job: Job) => { setSelectedDate(job.date); setSelectedJobId(job.id); };
                return (
                  <div key={key} className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0b0910] shadow-lg shadow-black/50">
                    {/* Graphic background fill so a shift reads as its own card
                        rather than another flat row — tint carries the status,
                        the bolt is a watermark, both behind the content. */}
                    <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", cardTintClass(first, paidJobIds))} />
                    <Zap
                      aria-hidden
                      size={96}
                      className="pointer-events-none absolute -right-4 -top-5 rotate-12 text-white/[0.04]"
                      strokeWidth={1.5}
                    />
                    <div
                      onClick={() => isGroup ? setExpandedGroupKey(expanded ? null : key) : openJob(first)}
                      className="relative p-3 cursor-pointer active:opacity-80 transition-opacity"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {/* Date leads — it's how a shift gets identified,
                              and it keeps the card reading like a card. */}
                          <p className="text-[17px] font-bold text-mono tracking-tight leading-none text-white">{dateRange}</p>
                          <p className="text-[13px] text-white/75 leading-snug truncate mt-1">{first.name}</p>
                          <p className="text-[11px] text-white/40 truncate">{first.client}</p>
                        </div>
                        {/* Pay is the reason this list gets opened, so it's the
                            one thing sized to be read without stopping. */}
                        <div className="shrink-0 text-right">
                          {totalEarned > 0 ? (
                            <p className="text-lg font-bold text-mono text-success leading-none">${Math.round(totalEarned).toLocaleString()}</p>
                          ) : (
                            <p className="text-[11px] text-mono text-white/35 leading-none">{statusLabel[first.status]}</p>
                          )}
                          {totalHours > 0 && <p className="text-[10px] text-mono text-white/40 mt-1.5">{totalHours}h</p>}
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-1.5">
                        <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", jobDotClass(first, paidJobIds))} />
                        {isGroup && <span className="text-[10px] text-mono bg-white/10 text-white/70 px-1.5 py-0.5 rounded-full">{jobs.length} days</span>}
                        {first.jobNumber && <span className="text-[10px] text-mono text-white/30">#{first.jobNumber}</span>}
                        <span className="flex-1" />
                        {totalHours > 0 && (
                          <Receipt size={12} className={cn('shrink-0', first.payStub ? 'text-success' : 'text-white/20')} aria-label={first.payStub ? 'Pay stub uploaded' : 'No pay stub'} />
                        )}
                        {isGroup && (
                          expanded
                            ? <ChevronDown size={14} className="text-white/40 shrink-0" />
                            : <ChevronRight size={14} className="text-white/40 shrink-0" />
                        )}
                      </div>
                    </div>
                    {isGroup && expanded && (
                      <div className="border-t border-primary/20 divide-y divide-primary/10">
                        {jobs.map(job => (
                          <div
                            key={job.id}
                            onClick={() => openJob(job)}
                            className="px-3 py-2 pl-6 flex items-center justify-between gap-2 cursor-pointer hover:bg-primary/10 active:bg-primary/15 transition-colors"
                          >
                            <span className="text-xs text-mono">{format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d')}</span>
                            <span className="flex items-center gap-1.5 text-[11px] text-mono text-muted-foreground">
                              {netHoursWorked(job) > 0 ? `${netHoursWorked(job)}h` : isOverdueUpcoming(job) ? 'Needs Hours' : statusLabel[job.status]}
                              {job.startTime && !job.endTime && <span className="text-warning"> · no end time</span>}
                              {effectiveHoursWorked(job) > 0 && (
                                <Receipt size={10} className={job.payStub ? 'text-success opacity-80' : 'opacity-25'} aria-label={job.payStub ? 'Pay stub uploaded' : 'No pay stub'} />
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </SpacePageWrapper>
  );
}
