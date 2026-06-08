import { useState, useMemo, useEffect } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, Star, ArrowLeft } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, isToday, isPast } from 'date-fns';
import type { Job } from '@/lib/store';
import { calculateDayPay, getDayMultiplier } from '@/lib/payCalc';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const statusDot: Record<Job['status'], string> = {
  upcoming: 'bg-accent',
  'in-progress': 'bg-primary',
  completed: 'bg-success',
  cancelled: 'bg-destructive',
};

const statusColors: Record<Job['status'], string> = {
  upcoming: 'bg-accent/20 text-accent border-accent/30',
  'in-progress': 'bg-primary/20 text-primary border-primary/30',
  completed: 'bg-success/20 text-success border-success/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
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

function calcHours(start: string, end: string): number {
  let s = parseTimeToMins(start);
  let e = parseTimeToMins(end);
  if (isNaN(s) || isNaN(e)) return 0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

function JobDetailView({ job, onBack, onSave }: {
  job: Job;
  onBack: () => void;
  onSave: (updates: Partial<Job>) => void;
}) {
  const [endTime, setEndTime] = useState(job.endTime ?? '');
  const [hoursWorked, setHoursWorked] = useState(job.hoursWorked?.toString() ?? '');
  const [minimumHours, setMinimumHours] = useState(job.minimumHours?.toString() ?? '');
  const [payrollCompany, setPayrollCompany] = useState(job.payrollCompany ?? '');
  const [mealType, setMealType] = useState<Job['mealType']>(job.mealType ?? undefined);

  useEffect(() => {
    setEndTime(job.endTime ?? '');
    setHoursWorked(job.hoursWorked?.toString() ?? '');
    setMinimumHours(job.minimumHours?.toString() ?? '');
    setPayrollCompany(job.payrollCompany ?? '');
    setMealType(job.mealType ?? undefined);
  }, [job.id]);

  const handleEndTimeChange = (val: string) => {
    setEndTime(val);
    if (job.startTime && val) {
      const h = calcHours(job.startTime, val);
      if (h > 0) setHoursWorked(parseFloat(h.toFixed(2)).toString());
    }
  };

  const actualHours = parseFloat(hoursWorked) || 0;
  const minHours = parseFloat(minimumHours) || 0;
  const billableHours = Math.max(actualHours, minHours);
  const minimumApplied = minHours > 0 && actualHours < minHours && actualHours > 0;
  const rate = job.hourlyRate ?? 0;
  const payPreview = rate > 0 && billableHours > 0
    ? calculateDayPay(actualHours, rate, minHours, job.mealPenalties ?? 0, 1, mealType)
    : null;

  const handleSave = () => {
    const updates: Partial<Job> = {};
    if (endTime !== (job.endTime ?? '')) updates.endTime = endTime || undefined;
    if (actualHours > 0) {
      updates.hoursWorked = actualHours;
      updates.status = 'completed';
    }
    const parsedMin = parseFloat(minimumHours);
    if (!isNaN(parsedMin) && parsedMin !== (job.minimumHours ?? 0)) {
      updates.minimumHours = parsedMin > 0 ? parsedMin : undefined;
    }
    if (payrollCompany !== (job.payrollCompany ?? '')) {
      updates.payrollCompany = payrollCompany.trim() || undefined;
    }
    if (mealType !== (job.mealType ?? undefined)) {
      updates.mealType = mealType;
    }
    onSave(updates);
  };

  const hasChanges =
    endTime !== (job.endTime ?? '') ||
    hoursWorked !== (job.hoursWorked?.toString() ?? '') ||
    minimumHours !== (job.minimumHours?.toString() ?? '') ||
    payrollCompany !== (job.payrollCompany ?? '') ||
    mealType !== (job.mealType ?? undefined);

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1 rounded-lg hover:bg-secondary"
          >
            <ArrowLeft size={16} />
          </button>
          <DialogTitle className="text-mono text-sm">{job.name}</DialogTitle>
        </div>
      </DialogHeader>

      <div className="space-y-4">
        <span className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-mono uppercase tracking-wider border",
          statusColors[job.status]
        )}>
          {statusLabel[job.status]}
        </span>

        <div className="rounded-xl border border-border bg-secondary/10 p-3 space-y-2">
          {job.client && (
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Client</span>
              <span className="font-medium text-xs">{job.client}</span>
            </div>
          )}
          {(job.payrollCompany || payrollCompany) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Employer / Payroll</span>
              <span className="font-medium text-xs">{payrollCompany || job.payrollCompany}</span>
            </div>
          )}
          {job.venue && (
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Venue</span>
              <span className="font-medium text-xs">{job.venue}</span>
            </div>
          )}
          {job.date && (
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Date</span>
              <span className="font-medium text-xs text-mono">
                {format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d, yyyy')}
              </span>
            </div>
          )}
          {job.jobNumber && (
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Job #</span>
              <span className="font-medium text-xs text-mono">{job.jobNumber}</span>
            </div>
          )}
          {job.startTime && (
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Start</span>
              <span className="font-medium text-xs text-mono">{job.startTime}</span>
            </div>
          )}
          {rate > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground text-xs">Rate</span>
              <span className="font-medium text-xs text-mono">${rate}/hr</span>
            </div>
          )}
        </div>

        {payPreview && (
          <div className={cn(
            "rounded-xl border p-3 space-y-1.5",
            minimumApplied ? "border-accent/40 bg-accent/5" : "border-success/30 bg-success/5"
          )}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {minimumApplied
                  ? `Worked ${actualHours}h — paid for ${billableHours}h minimum`
                  : `Worked ${actualHours}h`}
              </span>
              <span className="font-bold text-sm text-mono text-success">
                ${payPreview.totalPay.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            {minimumApplied && (
              <p className="text-[10px] text-accent font-medium">
                {minHours}h minimum call — contract guarantees payment for {minHours}h
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/50 uppercase">
            Update Job
          </p>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Employer / Payroll Company</label>
            <Input
              value={payrollCompany}
              onChange={e => setPayrollCompany(e.target.value)}
              placeholder="e.g. Nolan AV, Live Nation"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">End Time</label>
            <Input
              value={endTime}
              onChange={e => handleEndTimeChange(e.target.value)}
              placeholder="e.g. 18:00 or 6:00 PM"
              className="h-9 text-sm text-mono"
            />
            {job.startTime && endTime && calcHours(job.startTime, endTime) > 0 && (
              <p className="text-[10px] text-mono text-muted-foreground">
                {job.startTime} → {endTime} = <span className="text-primary font-semibold">{calcHours(job.startTime, endTime).toFixed(1)}h</span>
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Hours Worked</label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={hoursWorked}
              onChange={e => setHoursWorked(e.target.value)}
              placeholder="e.g. 3"
              className="h-9 text-sm text-mono"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Min. Call</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { hours: 4, label: '4h', sub: 'Split shift' },
                { hours: 5, label: '5h', sub: 'Normal call' },
                { hours: 8, label: '8h', sub: 'Lead role' },
              ].map(({ hours, label, sub }) => {
                const active = minimumHours === hours.toString();
                return (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => setMinimumHours(active ? '' : hours.toString())}
                    className={cn(
                      "rounded-xl border py-2 px-1 text-center transition-colors",
                      active
                        ? "bg-primary/15 border-primary/50 text-primary"
                        : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30"
                    )}
                  >
                    <p className={cn("text-sm font-bold text-mono", active && "text-primary")}>{label}</p>
                    <p className="text-[9px] leading-tight mt-0.5 opacity-70">{sub}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Meal Break</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { value: 'YWA' as const, label: 'YWA', sub: '1hr walk away' },
                { value: 'NWA' as const, label: 'NWA', sub: '30min on clock' },
                { value: undefined, label: 'None', sub: 'No meal' },
              ].map(({ value, label, sub }) => {
                const active = mealType === value;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setMealType(active ? undefined : value)}
                    className={cn(
                      "rounded-xl border py-2 px-1 text-center transition-colors",
                      active
                        ? "bg-primary/15 border-primary/50 text-primary"
                        : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30"
                    )}
                  >
                    <p className={cn("text-sm font-bold text-mono", active && "text-primary")}>{label}</p>
                    <p className="text-[9px] leading-tight mt-0.5 opacity-70">{sub}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onBack}>
            Cancel
          </Button>
          <Button size="sm" className="flex-1" disabled={!hasChanges} onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </>
  );
}

export default function CalendarPage() {
  const { data, updateJob } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());

  const jobsByDate = useMemo(() => {
    const map: Record<string, Job[]> = {};
    data.jobs.forEach(job => {
      const key = job.date;
      if (!map[key]) map[key] = [];
      map[key].push(job);
    });
    return map;
  }, [data.jobs]);

  const payByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      let dayPay = 0;
      for (const job of jobs) {
        const hours = job.hoursWorked ?? 0;
        if (hours <= 0) continue;
        const rate = job.hourlyRate || 0;
        const multiplier = getDayMultiplier(date, job.client, data.jobs, job.has6th7thDayRule || false);
        const result = calculateDayPay(hours, rate, job.minimumHours || 0, job.mealPenalties || 0, multiplier, job.mealType);
        dayPay += result.totalPay;
      }
      if (dayPay > 0) map[date] = dayPay;
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
    <>
      <PageHeader title="Calendar" description="Your month at a glance" />

      <div className="flex bg-secondary/30 rounded-lg p-0.5 mb-3">
        <button
          onClick={() => setViewMode('month')}
          className={cn(
            "flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors",
            viewMode === 'month' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Month
        </button>
        <button
          onClick={() => setViewMode('year')}
          className={cn(
            "flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors",
            viewMode === 'year' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Year
        </button>
      </div>

      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => viewMode === 'month'
            ? setCurrentDate(prev => subMonths(prev, 1))
            : setCurrentYear(prev => prev - 1)
          }>
          <ChevronLeft size={16} />
        </Button>
        <div className="flex items-center gap-2">
          <h2 className="text-mono text-sm font-semibold">
            {viewMode === 'month' ? format(currentDate, 'MMMM yyyy') : currentYear}
          </h2>
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 rounded-full"
            onClick={() => { setCurrentDate(new Date()); setCurrentYear(new Date().getFullYear()); }}>
            Today
          </Button>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => viewMode === 'month'
            ? setCurrentDate(prev => addMonths(prev, 1))
            : setCurrentYear(prev => prev + 1)
          }>
          <ChevronRight size={16} />
        </Button>
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

              return (
                <div
                  key={i}
                  onClick={() => hasJobs && setSelectedDate(dateKey)}
                  className={cn(
                    "flex flex-col items-center py-1.5 transition-colors rounded-lg mx-0.5 mb-0.5",
                    !isCurrentMonth && 'opacity-30',
                    todayFlag && 'bg-primary/10',
                    hasJobs && 'cursor-pointer active:bg-secondary/60'
                  )}
                >
                  {todayFlag ? (
                    <span className="relative w-6 h-6 flex items-center justify-center">
                      <Star size={24} className="absolute text-primary fill-primary" />
                      <span className="relative text-[11px] text-mono leading-none text-primary-foreground font-bold">
                        {format(day, 'd')}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-mono leading-none w-6 h-6 flex items-center justify-center text-foreground">
                      {format(day, 'd')}
                    </span>
                  )}
                  {dayJobs.length > 0 && (
                    <span className="text-[7px] text-muted-foreground leading-tight text-center truncate max-w-[3rem] mt-0.5">
                      {dayJobs[0].venue || dayJobs[0].client}
                    </span>
                  )}
                  <div className="flex gap-0.5 mt-0.5 h-2 items-center">
                    {dayJobs.slice(0, 3).map((job, j) => (
                      <span key={j} className={cn("w-1.5 h-1.5 rounded-full", statusDot[job.status])} />
                    ))}
                    {dayJobs.length > 3 && (
                      <span className="text-[7px] text-muted-foreground text-mono">+{dayJobs.length - 3}</span>
                    )}
                  </div>
                  {hasPay && (
                    <span className="text-[8px] text-mono text-success font-semibold leading-none mt-0.5">
                      ${payByDate[dateKey] >= 1000 ? `${(payByDate[dateKey] / 1000).toFixed(1)}k` : payByDate[dateKey].toFixed(0)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 space-y-1">
            <div className="flex items-center justify-between px-1 pb-1 border-b border-border/30">
              <span className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50">
                {format(currentDate, 'MMMM')}
              </span>
              <div className="flex items-center gap-3">
                {monthStats.totalHours > 0 ? (
                  <span className="text-[11px] text-mono font-semibold text-primary">{monthStats.totalHours.toFixed(1)}h</span>
                ) : (
                  <span className="text-[11px] text-mono text-muted-foreground/25">—</span>
                )}
                {monthStats.totalPay > 0 && (
                  <span className="text-[11px] text-mono font-bold text-success">
                    ${monthStats.totalPay >= 1000 ? `${(monthStats.totalPay / 1000).toFixed(1)}k` : monthStats.totalPay.toFixed(0)}
                  </span>
                )}
              </div>
            </div>
            {weekStats.map((ws, i) => (
              <div key={i} className="flex items-center justify-between px-1">
                <span className="text-[9px] text-mono text-muted-foreground/40">{format(ws.weekStart, 'MMM d')}</span>
                <div className="flex items-center gap-3">
                  {ws.hours > 0 ? (
                    <span className="text-[10px] text-mono text-muted-foreground">{ws.hours.toFixed(1)}h</span>
                  ) : (
                    <span className="text-[10px] text-mono text-muted-foreground/25">—</span>
                  )}
                  {ws.pay > 0 && (
                    <span className="text-[10px] text-mono text-success">
                      ${ws.pay >= 1000 ? `${(ws.pay / 1000).toFixed(1)}k` : ws.pay.toFixed(0)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {viewMode === 'year' && (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            {Array.from({ length: 12 }, (_, mi) => {
              const monthStart = new Date(currentYear, mi, 1);
              const start = startOfWeek(startOfMonth(monthStart), { weekStartsOn: 0 });
              const end = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 0 });
              const days: Date[] = [];
              let d = start;
              while (d <= end) { days.push(d); d = addDays(d, 1); }
              const monthPrefix = format(monthStart, 'yyyy-MM');
              let monthPay = 0, monthJobs = 0;
              for (const [date, jobs] of Object.entries(jobsByDate)) {
                if (!date.startsWith(monthPrefix)) continue;
                monthJobs += jobs.length;
                monthPay += payByDate[date] || 0;
              }
              return (
                <div key={mi}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-mono font-bold uppercase tracking-wider text-foreground/70">
                      {format(monthStart, 'MMM')}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {monthJobs > 0 && (
                        <span className="text-[8px] text-mono text-muted-foreground/50">{monthJobs}j</span>
                      )}
                      {monthPay > 0 && (
                        <span className="text-[8px] text-mono text-success font-semibold">
                          ${monthPay >= 1000 ? `${(monthPay / 1000).toFixed(1)}k` : monthPay.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-7 gap-px">
                    {['S','M','T','W','T','F','S'].map((lbl, i) => (
                      <div key={i} className="h-3 flex items-center justify-center text-[6px] text-muted-foreground/30 font-medium">{lbl}</div>
                    ))}
                    {days.map((day, di) => {
                      const dateKey = format(day, 'yyyy-MM-dd');
                      const dayJobs = jobsByDate[dateKey] || [];
                      const isCurrentMonth = isSameMonth(day, monthStart);
                      const todayFlag = isSameDay(day, today);
                      const hasPay = !!payByDate[dateKey];
                      const hasCompleted = dayJobs.some(j => j.status === 'completed');
                      const hasInProgress = dayJobs.some(j => j.status === 'in-progress');
                      const hasUpcoming = dayJobs.some(j => j.status === 'upcoming');
                      if (!isCurrentMonth) return <div key={di} className="h-5" />;
                      return (
                        <div
                          key={di}
                          onClick={() => dayJobs.length > 0 && setSelectedDate(dateKey)}
                          className={cn(
                            "h-5 flex items-center justify-center text-[8px] text-mono rounded-[3px] transition-colors select-none",
                            dayJobs.length > 0 && 'cursor-pointer',
                            hasPay && 'bg-success/30 text-success font-semibold',
                            !hasPay && hasCompleted && 'bg-success/15 text-success',
                            !hasPay && !hasCompleted && hasInProgress && 'bg-primary/25 text-primary font-semibold',
                            !hasPay && !hasCompleted && !hasInProgress && hasUpcoming && 'bg-accent/20 text-accent',
                            !dayJobs.length && 'text-muted-foreground/40',
                            todayFlag && 'ring-1 ring-inset ring-primary/70',
                          )}
                        >
                          {format(day, 'd')}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-xl border border-border/40 bg-secondary/10 p-3">
            <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50 mb-2">{currentYear} Total</p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {yearStats.totalJobs > 0 ? `${yearStats.totalJobs} job${yearStats.totalJobs !== 1 ? 's' : ''}` : 'No jobs yet'}
              </span>
              <div className="flex items-center gap-3">
                {yearStats.totalHours > 0 && (
                  <span className="text-xs text-mono font-semibold text-primary">{yearStats.totalHours.toFixed(1)}h</span>
                )}
                {yearStats.totalPay > 0 && (
                  <span className="text-xs text-mono font-bold text-success">
                    ${yearStats.totalPay >= 1000 ? `${(yearStats.totalPay / 1000).toFixed(1)}k` : yearStats.totalPay.toFixed(0)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-3 px-1">
            <span className="text-[8px] text-muted-foreground/40 text-mono uppercase tracking-wider">Legend</span>
            {[
              { color: 'bg-accent/20', label: 'Upcoming' },
              { color: 'bg-success/15', label: 'Completed' },
              { color: 'bg-success/30', label: 'Paid' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={cn("w-3 h-3 rounded-[2px]", color)} />
                <span className="text-[8px] text-muted-foreground/50 text-mono">{label}</span>
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
                {selectedJobs.map(job => {
                  const hours = job.hoursWorked ?? 0;
                  const earned = hours * (job.hourlyRate ?? 0);
                  return (
                    <div
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={cn(
                        "rounded-xl border p-3 space-y-1 cursor-pointer hover:opacity-90 transition-opacity",
                        statusColors[job.status]
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm">{job.name}</p>
                          <p className="text-xs opacity-70">{job.client}</p>
                        </div>
                        <span className="text-[10px] text-mono uppercase font-medium opacity-70">{job.status}</span>
                      </div>
                      {job.venue && <p className="text-xs opacity-60">{job.venue}</p>}
                      <div className="flex gap-3 text-xs text-mono">
                        {job.startTime && <span>{job.startTime}{job.endTime ? ` – ${job.endTime}` : ''}</span>}
                        {hours > 0 && <span>{hours}h</span>}
                        {earned > 0 && <span className="font-semibold">${earned.toLocaleString()}</span>}
                      </div>
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
              onSave={(updates) => {
                updateJob(selectedJob.id, updates);
                setSelectedJobId(null);
                toast.success('Job updated');
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Ready to log ─────────────────────────────────────────────── */}
      {(() => {
        const needsLog = data.jobs.filter(job => {
          const jobDate = new Date(job.date + 'T12:00:00');
          return (isToday(jobDate) || isPast(jobDate)) && (job.hoursWorked ?? 0) === 0 && job.status !== 'cancelled';
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
            <h2 className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
              Ready to log
            </h2>
            <div className="flex flex-col gap-2">
              {Object.entries(groups).map(([key, jobs]) => {
                const first = jobs[0];
                const last = jobs[jobs.length - 1];
                const dateRange = jobs.length > 1
                  ? `${format(new Date(first.date + 'T12:00:00'), 'MMM d')} – ${format(new Date(last.date + 'T12:00:00'), 'MMM d')}`
                  : format(new Date(first.date + 'T12:00:00'), 'MMM d');
                return (
                  <div
                    key={key}
                    onClick={() => setSelectedDate(first.date)}
                    className="rounded-xl border border-accent/20 bg-accent/5 p-3 flex items-center gap-3 cursor-pointer active:opacity-70 transition-opacity"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{first.name}</p>
                        {jobs.length > 1 && (
                          <span className="text-[10px] text-mono bg-accent/20 text-accent px-1.5 py-0.5 rounded-full shrink-0">
                            {jobs.length}d
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {first.client} · {dateRange}
                      </p>
                      {first.jobNumber && (
                        <p className="text-[10px] text-mono text-muted-foreground/60 mt-0.5">#{first.jobNumber}</p>
                      )}
                    </div>
                    <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Recently logged ──────────────────────────────────────────── */}
      {(() => {
        const recentlyLogged = data.jobs
          .filter(job => (job.hoursWorked ?? 0) > 0)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 10);
        if (recentlyLogged.length === 0) return null;

        const loggedGroups: Record<string, Job[]> = {};
        for (const job of recentlyLogged) {
          const key = job.jobNumber?.trim() || `${job.name}__${job.client}`;
          if (!loggedGroups[key]) loggedGroups[key] = [];
          loggedGroups[key].push(job);
        }

        return (
          <div className="mt-4 flex flex-col gap-2">
            <h2 className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
              Recently logged
            </h2>
            <div className="flex flex-col gap-1.5">
              {Object.entries(loggedGroups).map(([key, jobs]) => {
                const first = jobs[0];
                const totalHours = jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
                const totalEarned = jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);
                const last = jobs[jobs.length - 1];
                const dateRange = jobs.length > 1
                  ? `${format(new Date(last.date + 'T12:00:00'), 'MMM d')} – ${format(new Date(first.date + 'T12:00:00'), 'MMM d')}`
                  : format(new Date(first.date + 'T12:00:00'), 'MMM d');
                return (
                  <div
                    key={key}
                    onClick={() => setSelectedDate(first.date)}
                    className="rounded-xl border border-border bg-card p-2.5 flex items-center gap-2 opacity-70 cursor-pointer active:opacity-50 transition-opacity"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm truncate">
                          {first.name} <span className="text-muted-foreground">· {first.client}</span>
                        </p>
                        {jobs.length > 1 && (
                          <span className="text-[10px] text-mono bg-success/20 text-success px-1.5 py-0.5 rounded-full shrink-0">
                            {jobs.length}d
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-mono text-muted-foreground">
                        {dateRange}
                        {totalHours > 0 && ` · ${totalHours}h`}
                        {totalEarned > 0 && ` · $${totalEarned.toLocaleString()}`}
                      </p>
                      {first.jobNumber && (
                        <p className="text-[10px] text-mono text-muted-foreground/50">#{first.jobNumber}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </>
  );
}
