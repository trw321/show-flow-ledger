import { useState, useMemo, useEffect } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, Star, ArrowLeft } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay } from 'date-fns';
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
  if (e <= s) e += 24 * 60; // overnight
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

  useEffect(() => {
    setEndTime(job.endTime ?? '');
    setHoursWorked(job.hoursWorked?.toString() ?? '');
    setMinimumHours(job.minimumHours?.toString() ?? '');
    setPayrollCompany(job.payrollCompany ?? '');
  }, [job.id]);

  const handleEndTimeChange = (val: string) => {
    setEndTime(val);
    if (job.startTime && val) {
      const h = calcHours(job.startTime, val);
      if (h > 0) setHoursWorked(parseFloat(h.toFixed(2)).toString());
    }
  };

  // Live pay preview using actual payCalc logic
  const actualHours = parseFloat(hoursWorked) || 0;
  const minHours = parseFloat(minimumHours) || 0;
  const billableHours = Math.max(actualHours, minHours);
  const minimumApplied = minHours > 0 && actualHours < minHours && actualHours > 0;
  const rate = job.hourlyRate ?? 0;
  const payPreview = rate > 0 && billableHours > 0
    ? calculateDayPay(actualHours, rate, minHours, job.mealPenalties ?? 0, 1, job.mealType)
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
    onSave(updates);
  };

  const hasChanges =
    endTime !== (job.endTime ?? '') ||
    hoursWorked !== (job.hoursWorked?.toString() ?? '') ||
    minimumHours !== (job.minimumHours?.toString() ?? '') ||
    payrollCompany !== (job.payrollCompany ?? '');

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
        {/* Status badge */}
        <span className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-mono uppercase tracking-wider border",
          statusColors[job.status]
        )}>
          {statusLabel[job.status]}
        </span>

        {/* Core info */}
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

        {/* Pay preview — shown once we have enough info */}
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

        {/* Editable fields */}
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
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onBack}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1"
            disabled={!hasChanges}
            onClick={handleSave}
          >
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

  const today = new Date();
  const selectedJobs = selectedDate ? (jobsByDate[selectedDate] || []) : [];
  const selectedJob = selectedJobId ? data.jobs.find(j => j.id === selectedJobId) ?? null : null;

  const closeDialog = () => { setSelectedDate(null); setSelectedJobId(null); };

  return (
    <>
      <PageHeader title="Calendar" description="Your month at a glance" />

      {/* Nav bar */}
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(prev => subMonths(prev, 1))}>
          <ChevronLeft size={16} />
        </Button>
        <div className="flex items-center gap-2">
          <h2 className="text-mono text-sm font-semibold">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 rounded-full" onClick={() => setCurrentDate(new Date())}>
            Today
          </Button>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(prev => addMonths(prev, 1))}>
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-0.5">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] text-muted-foreground text-mono py-1 font-medium">{d}</div>
        ))}
      </div>

      {/* Compact calendar grid */}
      <div className="grid grid-cols-7">
        {monthDays.map((day, i) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayJobs = jobsByDate[dateKey] || [];
          const isToday = isSameDay(day, today);
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
                isToday && 'bg-primary/10',
                hasJobs && 'cursor-pointer active:bg-secondary/60'
              )}
            >
              {isToday ? (
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

              {/* Venue + dots */}
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

              {/* Pay indicator */}
              {hasPay && (
                <span className="text-[8px] text-mono text-success font-semibold leading-none mt-0.5">
                  ${payByDate[dateKey] >= 1000 ? `${(payByDate[dateKey] / 1000).toFixed(1)}k` : payByDate[dateKey].toFixed(0)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="mt-4 space-y-1">
        <div className="flex items-center justify-between px-1 pb-1 border-b border-border/30">
          <span className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50">
            {format(currentDate, 'MMMM')}
          </span>
          <div className="flex items-center gap-3">
            {monthStats.totalHours > 0 ? (
              <span className="text-[11px] text-mono font-semibold text-primary">
                {monthStats.totalHours.toFixed(1)}h
              </span>
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
            <span className="text-[9px] text-mono text-muted-foreground/40">
              {format(ws.weekStart, 'MMM d')}
            </span>
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

      {/* Day / Job detail dialog */}
      <Dialog open={!!selectedDate} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto rounded-2xl">
          {!selectedJob ? (
            /* ── Day view: list of jobs ── */
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
            /* ── Job detail + edit view ── */
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
    </>
  );
}
