import { useState, useMemo, useEffect, useRef } from 'react';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, ChevronDown, Star, ArrowLeft, Copy, X, Receipt } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, isToday, isPast } from 'date-fns';
import type { Job } from '@/lib/store';
import { calculateDayPay, getDayMultiplier, calculateWeeklyOvertimeBonus, getConsecutiveDayStreak, calculateNightHours } from '@/lib/payCalc';
import { resolveEmployer } from '@/lib/employerMatch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const statusDot: Record<Job['status'], string> = {
  upcoming: 'bg-blue-500',
  'in-progress': 'bg-blue-500',
  completed: 'bg-purple-500',
  cancelled: 'bg-destructive',
};

const statusColors: Record<Job['status'], string> = {
  upcoming: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'in-progress': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completed: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
};

// status never auto-transitions off "upcoming"/"in-progress" as the date
// passes — it only becomes "completed" once hours are logged. This flags
// that gap for display, without changing the stored status itself.
function isOverdueUpcoming(job: Job): boolean {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  return (job.status === 'upcoming' || job.status === 'in-progress') && job.date < todayStr && (job.hoursWorked ?? 0) === 0;
}

// A job counts as "paid" once a linked income record is marked paid —
// distinct from just "completed" (worked, pay estimated but not yet received).
function jobDotClass(job: Job, paidJobIds: Set<string>): string {
  if (paidJobIds.has(job.id)) return 'bg-success';
  if (isOverdueUpcoming(job)) return 'bg-amber-500';
  return statusDot[job.status];
}

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

function calcHours(start: string, end: string): number {
  let s = parseTimeToMins(start);
  let e = parseTimeToMins(end);
  if (isNaN(s) || isNaN(e)) return 0;
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

function JobDetailView({ job, onBack, onSave, onDuplicated }: {
  job: Job;
  onBack: () => void;
  onSave: (updates: Partial<Job>) => void;
  onDuplicated: (count: number) => void;
}) {
  const { data, addJob } = useData();
  const [endTime, setEndTime] = useState(job.endTime ?? '');
  const [hoursWorked, setHoursWorked] = useState(job.hoursWorked?.toString() ?? '');
  const [hourlyRate, setHourlyRate] = useState(job.hourlyRate?.toString() ?? '');
  const [minimumHours, setMinimumHours] = useState(job.minimumHours?.toString() ?? '');
  const [payrollCompany, setPayrollCompany] = useState(job.payrollCompany ?? '');
  const [mealDuration, setMealDuration] = useState<Job['mealDuration']>(job.mealDuration ?? undefined);
  const [mealOnClock, setMealOnClock] = useState(job.mealOnClock ?? false);
  const [mealPenalties, setMealPenalties] = useState(job.mealPenalties?.toString() ?? '');
  const [nightPremiumConfirmed, setNightPremiumConfirmed] = useState(job.nightPremiumConfirmed ?? true);
  const [payStub, setPayStub] = useState(job.payStub ?? '');
  const [duplicating, setDuplicating] = useState(false);
  const [dupDates, setDupDates] = useState<string[]>(['']);
  const stubInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEndTime(job.endTime ?? '');
    setHoursWorked(job.hoursWorked?.toString() ?? '');
    setHourlyRate(job.hourlyRate?.toString() ?? '');
    setMinimumHours(job.minimumHours?.toString() ?? '');
    setPayrollCompany(job.payrollCompany ?? '');
    setMealDuration(job.mealDuration ?? undefined);
    setMealOnClock(job.mealOnClock ?? false);
    setMealPenalties(job.mealPenalties?.toString() ?? '');
    setNightPremiumConfirmed(job.nightPremiumConfirmed ?? true);
    setPayStub(job.payStub ?? '');
    setDuplicating(false);
    setDupDates(['']);
  }, [job.id]);

  const handleStubUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('File too large (max 5MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => setPayStub(reader.result as string);
    reader.readAsDataURL(file);
    if (stubInputRef.current) stubInputRef.current.value = '';
  };

  const employer = resolveEmployer(job.client, data.employers);
  const rawNightHours = ((employer?.nightPremiumEnabled ?? true) && job.startTime && endTime)
    ? calculateNightHours(job.startTime, endTime, employer?.nightPremiumStartHour ?? 0, employer?.nightPremiumEndHour)
    : 0;
  const nightHours = nightPremiumConfirmed ? rawNightHours : 0;

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
    if (job.startTime && val) {
      const h = calcHours(job.startTime, val);
      if (h > 0) setHoursWorked(parseFloat(h.toFixed(2)).toString());
    }
  };

  const handleHoursWorkedChange = (val: string) => {
    setHoursWorked(val);
    const h = parseFloat(val);
    if (job.startTime && !isNaN(h) && h > 0) {
      setEndTime(addHoursToTime(job.startTime, h));
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
      if (job.startTime && !endTime) setEndTime(addHoursToTime(job.startTime, hours));
    }
  };

  const actualHours = parseFloat(hoursWorked) || 0;
  const minHours = parseFloat(minimumHours) || 0;
  const billableHours = Math.max(actualHours, minHours);
  const minimumApplied = minHours > 0 && actualHours < minHours && actualHours > 0;
  const rate = parseFloat(hourlyRate) || 0;
  const mealPenaltyUnits = parseFloat(mealPenalties) || 0;
  const payPreview = rate > 0 && billableHours > 0
    ? calculateDayPay(actualHours, rate, minHours, mealDuration === 0 ? mealPenaltyUnits : (job.mealPenalties ?? 0), 1, { duration: mealDuration, onClock: mealOnClock }, { nightHours, nightMultiplier: employer?.nightPremiumMultiplier })
    : null;

  const handleSave = () => {
    const updates: Partial<Job> = {};
    if (endTime !== (job.endTime ?? '')) updates.endTime = endTime || undefined;
    if (actualHours > 0) { updates.hoursWorked = actualHours; updates.status = 'completed'; }
    if (hourlyRate !== (job.hourlyRate?.toString() ?? '')) updates.hourlyRate = rate > 0 ? rate : undefined;
    const parsedMin = parseFloat(minimumHours);
    if (!isNaN(parsedMin) && parsedMin !== (job.minimumHours ?? 0)) updates.minimumHours = parsedMin > 0 ? parsedMin : undefined;
    if (payrollCompany !== (job.payrollCompany ?? '')) updates.payrollCompany = payrollCompany.trim() || undefined;
    if (mealDuration !== (job.mealDuration ?? undefined)) updates.mealDuration = mealDuration;
    if (mealDuration && mealOnClock !== (job.mealOnClock ?? false)) updates.mealOnClock = mealOnClock;
    const parsedPenalties = parseFloat(mealPenalties);
    if (mealDuration === 0 && !isNaN(parsedPenalties) && parsedPenalties !== (job.mealPenalties ?? 0)) updates.mealPenalties = parsedPenalties > 0 ? parsedPenalties : undefined;
    if (rawNightHours > 0 && nightPremiumConfirmed !== (job.nightPremiumConfirmed ?? true)) updates.nightPremiumConfirmed = nightPremiumConfirmed;
    if (payStub !== (job.payStub ?? '')) updates.payStub = payStub || undefined;
    onSave(updates);
  };

  const hasChanges =
    endTime !== (job.endTime ?? '') ||
    hoursWorked !== (job.hoursWorked?.toString() ?? '') ||
    hourlyRate !== (job.hourlyRate?.toString() ?? '') ||
    minimumHours !== (job.minimumHours?.toString() ?? '') ||
    payrollCompany !== (job.payrollCompany ?? '') ||
    mealDuration !== (job.mealDuration ?? undefined) ||
    (!!mealDuration && mealOnClock !== (job.mealOnClock ?? false)) ||
    (mealDuration === 0 && mealPenalties !== (job.mealPenalties?.toString() ?? '')) ||
    (rawNightHours > 0 && nightPremiumConfirmed !== (job.nightPremiumConfirmed ?? true)) ||
    payStub !== (job.payStub ?? '');

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1 rounded-lg hover:bg-secondary">
            <ArrowLeft size={16} />
          </button>
          <DialogTitle className="text-mono text-sm">{job.name}</DialogTitle>
        </div>
      </DialogHeader>
      <div className="space-y-4">
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-mono uppercase tracking-wider border", isOverdueUpcoming(job) ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : statusColors[job.status])}>
          {isOverdueUpcoming(job) ? 'Needs Hours' : statusLabel[job.status]}
        </span>
        <div className="rounded-xl border border-border bg-secondary/10 p-3 space-y-2">
          {job.client && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Client</span><span className="font-medium text-xs">{job.client}</span></div>}
          {(job.payrollCompany || payrollCompany) && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Employer / Payroll</span><span className="font-medium text-xs">{payrollCompany || job.payrollCompany}</span></div>}
          {job.venue && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Venue</span><span className="font-medium text-xs">{job.venue}</span></div>}
          {job.date && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Date</span><span className="font-medium text-xs text-mono">{format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d, yyyy')}</span></div>}
          {job.jobNumber && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Job #</span><span className="font-medium text-xs text-mono">{job.jobNumber}</span></div>}
          {job.startTime && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Start</span><span className="font-medium text-xs text-mono">{job.startTime}</span></div>}
          {rate > 0 && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Rate</span><span className="font-medium text-xs text-mono">${rate}/hr</span></div>}
        </div>
        {payPreview && (
          <div className={cn("rounded-xl border p-3 space-y-1.5", minimumApplied ? "border-accent/40 bg-accent/5" : "border-success/30 bg-success/5")}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{minimumApplied ? `Worked ${actualHours}h — paid for ${billableHours}h minimum` : `Worked ${actualHours}h`}</span>
              <span className="font-bold text-sm text-mono text-success">${payPreview.totalPay.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            {minimumApplied && <p className="text-[10px] text-accent font-medium">{minHours}h minimum call — contract guarantees payment for {minHours}h</p>}
          </div>
        )}

        <label className={cn(
          "flex items-center gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors",
          payStub ? "border-success/40 bg-success/5" : "border-dashed border-border bg-secondary/10 hover:border-primary/30"
        )}>
          <div className={cn(
            "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
            payStub ? "bg-success/20 text-success" : "bg-secondary text-muted-foreground"
          )}>
            <Receipt size={15} />
          </div>
          <span className="flex-1 min-w-0">
            <span className="text-xs font-medium block">{payStub ? 'Pay stub uploaded' : 'No pay stub uploaded'}</span>
            <span className="text-[10px] text-muted-foreground block">
              {payStub ? 'Tap to replace' : 'Attach the stub/check when it arrives to verify pay later'}
            </span>
          </span>
          {payStub && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPayStub(''); }}
              className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              aria-label="Remove pay stub"
            >
              <X size={14} />
            </button>
          )}
          <input ref={stubInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleStubUpload} />
        </label>

        <div className="rounded-xl border border-border overflow-hidden">
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
            <label className="text-xs text-muted-foreground">Employer / Payroll Company</label>
            <Input value={payrollCompany} onChange={e => setPayrollCompany(e.target.value)} placeholder="e.g. Nolan AV, Live Nation" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">End Time</label>
            <Input value={endTime} onChange={e => handleEndTimeChange(e.target.value)} placeholder="e.g. 18:00 or 6:00 PM" className="h-9 text-sm text-mono" />
            {job.startTime && endTime && calcHours(job.startTime, endTime) > 0 && (
              <p className="text-[10px] text-mono text-muted-foreground">{job.startTime} → {endTime} = <span className="text-primary font-semibold">{calcHours(job.startTime, endTime).toFixed(1)}h</span></p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Hours Worked</label>
              <Input type="number" min="0" step="0.5" value={hoursWorked} onChange={e => handleHoursWorkedChange(e.target.value)} placeholder="e.g. 3" className="h-9 text-sm text-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Rate ($/hr)</label>
              <Input type="number" min="0" step="0.01" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} placeholder="e.g. 45" className="h-9 text-sm text-mono" />
            </div>
          </div>
          {!rate && (
            <p className="text-[10px] text-amber-400 -mt-1">⚠ No rate set — pay won't calculate until this is filled in</p>
          )}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Min. Call</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[{ hours: 4, label: '4h', sub: 'Split shift' }, { hours: 5, label: '5h', sub: 'Normal call' }, { hours: 8, label: '8h', sub: 'Lead role' }].map(({ hours, label, sub }) => {
                const active = minimumHours === hours.toString();
                return (
                  <button key={hours} type="button" onClick={() => handleMinimumClick(hours)} className={cn("rounded-xl border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                    <p className={cn("text-sm font-bold text-mono", active && "text-primary")}>{label}</p>
                    <p className="text-[9px] leading-tight mt-0.5 opacity-70">{sub}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Meal Break</label>
            <div className="grid grid-cols-4 gap-1.5">
              {([{ value: 0 as const, label: 'Zero' }, { value: 30 as const, label: '30m' }, { value: 45 as const, label: '45m' }, { value: 60 as const, label: '1hr' }]).map(({ value, label }) => {
                const active = mealDuration === value;
                return (
                  <button key={label} type="button" onClick={() => setMealDuration(active ? undefined : value)} className={cn("rounded-xl border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
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
                    <button key={label} type="button" onClick={() => setMealOnClock(value)} className={cn("rounded-xl border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                      <p className={cn("text-xs font-bold", active && "text-primary")}>{label}</p>
                      <p className="text-[9px] leading-tight mt-0.5 opacity-70">{sub}</p>
                    </button>
                  );
                })}
              </div>
            )}
            {mealDuration === 0 && (
              <div className="pt-0.5">
                <label className="text-[10px] text-mono uppercase text-muted-foreground">Meal penalty units (1 unit = 1hr at straight rate)</label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="0"
                  value={mealPenalties}
                  onChange={e => setMealPenalties(e.target.value)}
                  className="h-9 text-sm text-mono mt-1"
                />
              </div>
            )}
          </div>
        </div>

        {rawNightHours > 0 && (
          <label className="flex items-start gap-2.5 rounded-xl border border-primary/30 bg-primary/5 p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={nightPremiumConfirmed}
              onChange={e => setNightPremiumConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-border"
            />
            <span className="text-xs">
              <span className="font-medium">{rawNightHours}h after midnight were actually worked</span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">
                Paid at {employer?.nightPremiumMultiplier ?? 2}× straight rate. Uncheck if that time was minimum-call padding you didn't really work — it'll bill at straight time instead.
              </span>
            </span>
          </label>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onBack}>Cancel</Button>
          <Button size="sm" className="flex-1" disabled={!hasChanges} onClick={handleSave}>Save</Button>
        </div>
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { data, updateJob, addIncome } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  const jobsByDate = useMemo(() => {
    const map: Record<string, Job[]> = {};
    data.jobs.forEach(job => { if (!map[job.date]) map[job.date] = []; map[job.date].push(job); });
    return map;
  }, [data.jobs]);

  const paidJobIds = useMemo(() => {
    const set = new Set<string>();
    for (const income of data.income) {
      if (income.status === 'paid' && income.jobId) set.add(income.jobId);
    }
    return set;
  }, [data.income]);

  // Per-job expected pay — the single source of truth behind the calendar's
  // day/week/month totals below AND the "Awaiting payment" list, so they can
  // never drift out of sync with each other.
  const jobPay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const job of data.jobs) {
      const hours = job.hoursWorked ?? 0;
      if (hours <= 0) continue;
      const rate = job.hourlyRate || 0;
      const employer = resolveEmployer(job.client, data.employers);
      const multiplier = getDayMultiplier(job.date, job.client, data.jobs, job.has6th7thDayRule || false);
      const nightHours = ((employer?.nightPremiumEnabled ?? true) && job.nightPremiumConfirmed !== false && job.startTime && job.endTime)
        ? calculateNightHours(job.startTime, job.endTime, employer?.nightPremiumStartHour ?? 0, employer?.nightPremiumEndHour)
        : 0;
      const result = calculateDayPay(hours, rate, job.minimumHours || 0, job.mealPenalties || 0, multiplier, { duration: job.mealDuration, onClock: job.mealOnClock }, {
        rule: employer?.overtimeRule ?? 'daily',
        otThresholdHours: employer?.dailyOvertimeThresholdHours,
        dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
        otMultiplier: employer?.overtimeMultiplier,
        dtMultiplier: employer?.doubletimeMultiplier,
        nightHours,
        nightMultiplier: employer?.nightPremiumMultiplier,
      });
      let pay = result.totalPay;
      if (employer) pay += calculateWeeklyOvertimeBonus(job, data.jobs, employer);
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

  // Completed shifts with calculated pay that haven't been matched to a
  // received payment yet — tap one to confirm the money came in.
  const awaitingPayment = useMemo(() =>
    data.jobs
      .filter(j => (jobPay[j.id] ?? 0) > 0 && !paidJobIds.has(j.id))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [data.jobs, jobPay, paidJobIds]
  );

  const handleMarkPaid = async (job: Job) => {
    const amount = jobPay[job.id] ?? 0;
    if (amount <= 0) return;
    await addIncome({
      jobId: job.id,
      client: job.client,
      description: job.name,
      amount,
      date: format(new Date(), 'yyyy-MM-dd'),
      status: 'paid',
    });
    toast.success(`Marked ${job.name} paid — $${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  };

  // Dates that are the 6th+ consecutive day worked for the same employer —
  // flagged regardless of whether "6th/7th day rule" is checked on the job,
  // so it's a heads-up to go verify the contract, not just a confirmation.
  const sixthSeventhDayDates = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      let maxStreak = 0;
      for (const job of jobs) {
        if ((job.hoursWorked ?? 0) <= 0) continue;
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

  const weekStats = useMemo(() => weeks.map(week => {
    let hours = 0, pay = 0, jobCount = 0;
    week.forEach(day => {
      if (!isSameMonth(day, currentDate)) return;
      const key = format(day, 'yyyy-MM-dd');
      jobCount += (jobsByDate[key] || []).length;
      hours += (jobsByDate[key] || []).reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
      pay += payByDate[key] || 0;
    });
    return { hours, pay, jobCount, weekStart: week[0] };
  }), [weeks, jobsByDate, payByDate, currentDate]);

  const monthStats = useMemo(() => {
    const prefix = format(currentDate, 'yyyy-MM');
    let totalHours = 0, totalPay = 0, totalJobs = 0;
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      if (!date.startsWith(prefix)) continue;
      totalJobs += jobs.length;
      totalHours += jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
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
      totalHours += jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
      totalPay += payByDate[date] || 0;
    }
    return { totalJobs, totalHours, totalPay };
  }, [jobsByDate, payByDate, currentYear]);

  const today = new Date();
  const selectedJobs = selectedDate ? (jobsByDate[selectedDate] || []) : [];
  const selectedJob = selectedJobId ? data.jobs.find(j => j.id === selectedJobId) ?? null : null;
  const closeDialog = () => { setSelectedDate(null); setSelectedJobId(null); };

  return (
    <SpacePageWrapper title="Calendar" description="Your month at a glance">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex flex-1 bg-secondary/30 rounded-lg p-0.5">
          <button onClick={() => setViewMode('month')} className={cn("flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors", viewMode === 'month' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Month</button>
          <button onClick={() => setViewMode('year')} className={cn("flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors", viewMode === 'year' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Year</button>
        </div>
      </div>

      <div className="flex items-stretch justify-between mb-3 gap-2">
        <button
          onClick={() => viewMode === 'month' ? setCurrentDate(prev => subMonths(prev, 1)) : setCurrentYear(prev => prev - 1)}
          className="flex items-center justify-center w-12 min-h-[44px] rounded-xl bg-fuchsia-500/30 active:bg-fuchsia-500/50 text-fuchsia-400 transition-colors border border-fuchsia-500/40"
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
          className="flex items-center justify-center w-12 min-h-[44px] rounded-xl bg-fuchsia-500/30 active:bg-fuchsia-500/50 text-fuchsia-400 transition-colors border border-fuchsia-500/40"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {viewMode === 'month' && (
        <>
          <div className="grid grid-cols-7 mb-0.5">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className="text-center text-[10px] text-muted-foreground text-mono py-1 font-medium">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day, i) => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayJobs = jobsByDate[dateKey] || [];
              const todayFlag = isSameDay(day, today);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const hasJobs = dayJobs.length > 0;
              const hasPay = !!payByDate[dateKey];
              const sixthSeventhStreak = sixthSeventhDayDates[dateKey];
              return (
                <div
                  key={i}
                  onClick={() => hasJobs && setSelectedDate(dateKey)}
                  title={sixthSeventhStreak ? `${sixthSeventhStreak}th consecutive day worked for this employer` : undefined}
                  className={cn(
                    "relative flex flex-col items-center py-1.5 transition-colors rounded-lg mx-0.5 mb-0.5",
                    !isCurrentMonth && 'opacity-30',
                    todayFlag && 'bg-primary/10',
                    hasJobs && 'cursor-pointer active:bg-secondary/60',
                    sixthSeventhStreak && 'bg-pink-500/20 ring-1 ring-pink-500/60'
                  )}
                >
                  {sixthSeventhStreak > 0 && (
                    <span className="absolute top-0 right-0.5 w-1.5 h-1.5 rounded-full bg-pink-500" />
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
                  </div>
                  {hasPay && <span className="text-[8px] text-mono text-success font-semibold leading-none mt-0.5">${payByDate[dateKey] >= 1000 ? `${(payByDate[dateKey] / 1000).toFixed(1)}k` : payByDate[dateKey].toFixed(0)}</span>}
                </div>
              );
            })}
          </div>
          <div className="mt-4 space-y-1">
            <div className="flex items-center justify-between px-1 pb-1 border-b border-border/30">
              <span className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50">{format(currentDate, 'MMMM')}</span>
              <div className="flex items-center gap-3">
                {monthStats.totalHours > 0 ? <span className="text-[11px] text-mono font-semibold text-primary">{monthStats.totalHours.toFixed(1)}h</span> : <span className="text-[11px] text-mono text-muted-foreground/25">—</span>}
                {monthStats.totalPay > 0 && <span className="text-[11px] text-mono font-bold text-success">${monthStats.totalPay >= 1000 ? `${(monthStats.totalPay / 1000).toFixed(1)}k` : monthStats.totalPay.toFixed(0)}</span>}
              </div>
            </div>
            {weekStats.map((ws, i) => (
              <div key={i} className="flex items-center justify-between px-1">
                <span className="text-[9px] text-mono text-muted-foreground/40">{format(ws.weekStart, 'MMM d')}</span>
                <div className="flex items-center gap-3">
                  {ws.hours > 0 ? <span className="text-[10px] text-mono text-muted-foreground">{ws.hours.toFixed(1)}h</span> : <span className="text-[10px] text-mono text-muted-foreground/25">—</span>}
                  {ws.pay > 0 && <span className="text-[10px] text-mono text-success">${ws.pay >= 1000 ? `${(ws.pay / 1000).toFixed(1)}k` : ws.pay.toFixed(0)}</span>}
                </div>
              </div>
            ))}
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
                <div key={mi}>
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
                        <div key={ci} onClick={() => dayJobs.length > 0 && setSelectedDate(dateKey)} className={cn('h-3 flex items-center justify-center text-[6px] text-mono rounded-[2px] transition-colors select-none', dayJobs.length > 0 && 'cursor-pointer', hasPaid && 'bg-success/30 text-success font-semibold', !hasPaid && hasCompleted && 'bg-purple-500/25 text-purple-400', !hasPaid && !hasCompleted && hasUpcoming && 'bg-blue-500/20 text-blue-400', !dayJobs.length && 'text-muted-foreground/25', todayFlag && 'ring-1 ring-inset ring-primary/70')}>
                          {day}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-border/40 bg-secondary/10 p-3">
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
            {[{ color: 'bg-accent/20', label: 'Upcoming' }, { color: 'bg-success/15', label: 'Completed' }, { color: 'bg-success/30', label: 'Paid' }].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={cn('w-3 h-3 rounded-[2px]', color)} />
                <span className="text-[8px] text-muted-foreground/50 font-body">{label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!selectedDate} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto rounded-2xl">
          {!selectedJob ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-mono text-sm">
                  {selectedDate && format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                {selectedDate && sixthSeventhDayDates[selectedDate] > 0 && (
                  <div className="rounded-xl border border-pink-500/40 bg-pink-500/10 px-3 py-2 text-xs text-pink-400">
                    ⚠ {sixthSeventhDayDates[selectedDate]}th consecutive day worked{' '}
                    {selectedJobs
                      .filter(job => getConsecutiveDayStreak(selectedDate, job.client, data.jobs) >= 6)
                      .map(job => job.client)
                      .filter((c, i, arr) => arr.indexOf(c) === i)
                      .join(', ') || 'for this employer'} — check contract for premium pay.
                  </div>
                )}
                {selectedJobs.map(job => {
                  const hours = job.hoursWorked ?? 0;
                  const earned = hours * (job.hourlyRate ?? 0);
                  const paid = paidJobIds.has(job.id);
                  const overdue = isOverdueUpcoming(job);
                  return (
                    <div key={job.id} onClick={() => setSelectedJobId(job.id)} className={cn("rounded-xl border p-3 space-y-1 cursor-pointer hover:opacity-90 transition-opacity", paid ? "bg-success/20 text-success border-success/30" : overdue ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : statusColors[job.status])}>
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
                        <p className="text-[10px] text-amber-400 font-medium">⚠ No end time set — tap to add it</p>
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
              </div>
            </>
          ) : (
            <JobDetailView
              job={selectedJob}
              onBack={() => setSelectedJobId(null)}
              onSave={(updates) => { updateJob(selectedJob.id, updates); setSelectedJobId(null); toast.success('Job updated'); }}
              onDuplicated={(count) => { closeDialog(); toast.success(`Created ${count} shift${count !== 1 ? 's' : ''}`); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {(() => {
        const monthPrefix = format(currentDate, 'yyyy-MM');
        const needsLog = data.jobs.filter(job => {
          const jobDate = new Date(job.date + 'T12:00:00');
          return (isToday(jobDate) || isPast(jobDate)) && (job.hoursWorked ?? 0) === 0 && job.status !== 'cancelled' && job.status !== 'completed' && job.date.startsWith(monthPrefix);
        }).sort((a, b) => a.date.localeCompare(b.date));
        if (needsLog.length === 0) return null;
        const groups: Record<string, Job[]> = {};
        for (const job of needsLog) {
          const key = job.jobNumber?.trim() || `${job.name}__${job.client}`;
          if (!groups[key]) groups[key] = [];
          groups[key].push(job);
        }
        return (
          <div className="mt-6 flex flex-col gap-2">
            <h2 className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
              Ready to log
            </h2>
            <div className="flex flex-col gap-2">
              {Object.entries(groups).map(([key, jobs]) => {
                const first = jobs[0];
                const last = jobs[jobs.length - 1];
                const dateRange = jobs.length > 1 ? `${format(new Date(first.date + 'T12:00:00'), 'MMM d')} – ${format(new Date(last.date + 'T12:00:00'), 'MMM d')}` : format(new Date(first.date + 'T12:00:00'), 'MMM d');
                return (
                  <div key={key} onClick={() => setSelectedDate(first.date)} className="rounded-xl border border-accent/20 bg-accent/5 p-3 flex items-center gap-3 cursor-pointer active:opacity-70 transition-opacity">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{first.name}</p>
                        {jobs.length > 1 && <span className="text-[10px] text-mono bg-accent/20 text-accent px-1.5 py-0.5 rounded-full shrink-0">{jobs.length}d</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">{first.client} · {dateRange}</p>
                      {first.jobNumber && <p className="text-[10px] text-mono text-muted-foreground/60 mt-0.5">#{first.jobNumber}</p>}
                    </div>
                    <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {awaitingPayment.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <h2 className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
            Awaiting Payment
          </h2>
          <div className="flex flex-col gap-2">
            {awaitingPayment.map(job => {
              const amount = jobPay[job.id] ?? 0;
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => handleMarkPaid(job)}
                  className="rounded-xl border border-success/25 bg-success/5 p-3 flex items-center gap-3 text-left cursor-pointer active:opacity-70 transition-opacity"
                >
                  <span className="shrink-0 w-9 h-9 rounded-full bg-success/15 flex items-center justify-center text-lg">💰</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{job.name}</p>
                    <p className="text-xs text-muted-foreground">{job.client} · {format(new Date(job.date + 'T12:00:00'), 'MMM d')}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-mono text-success">${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                    <p className="text-[9px] text-muted-foreground/60">tap to confirm</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
              <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 inline-block" />
              This month's shifts
            </h2>
            <div className="flex flex-col gap-1.5">
              {Object.entries(loggedGroups).map(([key, jobs]) => {
                const first = jobs[0];
                const totalHours = jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
                const totalEarned = jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);
                const last = jobs[jobs.length - 1];
                const dateRange = jobs.length > 1 ? `${format(new Date(last.date + 'T12:00:00'), 'MMM d')} – ${format(new Date(first.date + 'T12:00:00'), 'MMM d')}` : format(new Date(first.date + 'T12:00:00'), 'MMM d');
                const isGroup = jobs.length > 1;
                const expanded = expandedGroupKey === key;
                const openJob = (job: Job) => { setSelectedDate(job.date); setSelectedJobId(job.id); };
                const subtitle = totalHours > 0
                  ? `${dateRange} · ${totalHours}h${totalEarned > 0 ? ` · $${totalEarned.toLocaleString()}` : ''}`
                  : `${dateRange} · ${statusLabel[first.status]}${first.startTime ? ` · ${first.startTime}` : ''}`;
                return (
                  <div key={key} className="rounded-xl border border-fuchsia-400/25 bg-fuchsia-400/5 overflow-hidden">
                    <div
                      onClick={() => isGroup ? setExpandedGroupKey(expanded ? null : key) : openJob(first)}
                      className="p-2.5 flex items-center gap-2 opacity-70 cursor-pointer active:opacity-50 transition-opacity"
                    >
                      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", jobDotClass(first, paidJobIds))} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm truncate">{first.name} <span className="text-muted-foreground">· {first.client}</span></p>
                          {isGroup && <span className="text-[10px] text-mono bg-success/20 text-success px-1.5 py-0.5 rounded-full shrink-0">{jobs.length}d</span>}
                          {!isGroup && totalHours > 0 && (
                            <Receipt size={11} className={cn('shrink-0', first.payStub ? 'text-success opacity-80' : 'opacity-25')} aria-label={first.payStub ? 'Pay stub uploaded' : 'No pay stub'} />
                          )}
                        </div>
                        <p className="text-[11px] text-mono text-muted-foreground">{subtitle}</p>
                        {first.jobNumber && <p className="text-[10px] text-mono text-muted-foreground/50">#{first.jobNumber}</p>}
                      </div>
                      {isGroup && (
                        expanded
                          ? <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                          : <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                      )}
                    </div>
                    {isGroup && expanded && (
                      <div className="border-t border-fuchsia-400/20 divide-y divide-fuchsia-400/10">
                        {jobs.map(job => (
                          <div
                            key={job.id}
                            onClick={() => openJob(job)}
                            className="px-3 py-2 pl-6 flex items-center justify-between gap-2 cursor-pointer hover:bg-fuchsia-400/10 active:bg-fuchsia-400/15 transition-colors"
                          >
                            <span className="text-xs text-mono">{format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d')}</span>
                            <span className="flex items-center gap-1.5 text-[11px] text-mono text-muted-foreground">
                              {(job.hoursWorked ?? 0) > 0 ? `${job.hoursWorked}h` : isOverdueUpcoming(job) ? 'Needs Hours' : statusLabel[job.status]}
                              {job.startTime && !job.endTime && <span className="text-amber-400"> · no end time</span>}
                              {(job.hoursWorked ?? 0) > 0 && (
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
