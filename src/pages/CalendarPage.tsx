import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addDays, addMonths, subMonths, isSameMonth, isSameDay,
} from 'date-fns';
import type { Job } from '@/lib/store';
import { calculateDayPay, getDayMultiplier } from '@/lib/payCalc';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

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

const fmtPay = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n > 0 ? `$${n.toFixed(0)}` : '—';

export default function CalendarPage() {
  const { data } = useData();
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const jobsByDate = useMemo(() => {
    const map: Record<string, Job[]> = {};
    data.jobs.forEach(job => {
      if (!map[job.date]) map[job.date] = [];
      map[job.date].push(job);
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
        const mult = getDayMultiplier(date, job.client, data.jobs, job.has6th7thDayRule || false);
        const result = calculateDayPay(hours, rate, job.minimumHours || 0, job.mealPenalties || 0, mult, job.mealType);
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
    let pay = 0, hours = 0, jobCount = 0;
    week.forEach(day => {
      if (!isSameMonth(day, currentDate)) return;
      const key = format(day, 'yyyy-MM-dd');
      const jobs = jobsByDate[key] || [];
      jobCount += jobs.length;
      hours += jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
      pay += payByDate[key] || 0;
    });
    return { pay, hours, jobCount };
  }), [weeks, jobsByDate, payByDate, currentDate]);

  const monthStats = useMemo(() => {
    const prefix = format(currentDate, 'yyyy-MM');
    let totalPay = 0, totalHours = 0, totalJobs = 0;
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      if (!date.startsWith(prefix)) continue;
      totalJobs += jobs.length;
      totalHours += jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
      totalPay += payByDate[date] || 0;
    }
    return { totalPay, totalHours, totalJobs };
  }, [jobsByDate, payByDate, currentDate]);

  const today = new Date();
  const selectedJobs = selectedDate ? (jobsByDate[selectedDate] || []) : [];

  return (
    <>
      {/* Compact header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCurrentDate(prev => subMonths(prev, 1))}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-secondary transition-colors"
        >
          <ChevronLeft size={14} className="text-muted-foreground" />
        </button>
        <div className="flex items-center gap-2.5">
          <h1 className="text-mono text-sm font-bold tracking-widest">
            {format(currentDate, 'MMM yyyy').toUpperCase()}
          </h1>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="text-[9px] text-mono text-primary border border-primary/40 px-2 py-0.5 rounded-full hover:bg-primary/10 transition-colors"
          >
            TODAY
          </button>
        </div>
        <button
          onClick={() => setCurrentDate(prev => addMonths(prev, 1))}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-secondary transition-colors"
        >
          <ChevronRight size={14} className="text-muted-foreground" />
        </button>
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl border border-border overflow-hidden">

        {/* Day headers */}
        <div className="grid grid-cols-[repeat(7,1fr)_2.5rem] border-b border-border bg-secondary/40">
          {['SUN','MON','TUE','WED','THU','FRI','SAT'].map((d, i) => (
            <div key={i} className={cn(
              "py-1.5 text-center text-[8px] text-mono font-bold tracking-widest",
              i === 0 || i === 6 ? 'text-muted-foreground/50' : 'text-muted-foreground'
            )}>
              {d}
            </div>
          ))}
          <div className="py-1.5 text-center text-[8px] text-mono font-bold tracking-widest text-primary/40">WK</div>
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className={cn("grid grid-cols-[repeat(7,1fr)_2.5rem]", wi < weeks.length - 1 && "border-b border-border/40")}
          >
            {week.map((day, di) => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayJobs = jobsByDate[dateKey] || [];
              const isToday = isSameDay(day, today);
              const inMonth = isSameMonth(day, currentDate);
              const hasJobs = dayJobs.length > 0 && inMonth;
              const pay = inMonth ? payByDate[dateKey] : undefined;
              const isWeekend = di === 0 || di === 6;

              return (
                <div
                  key={di}
                  onClick={() => hasJobs && setSelectedDate(dateKey)}
                  className={cn(
                    "relative flex flex-col items-center py-2 gap-0.5",
                    "border-r border-border/30 last-of-type:border-r-0",
                    !inMonth && 'opacity-15',
                    isWeekend && inMonth && 'bg-secondary/20',
                    isToday && 'bg-primary/10',
                    hasJobs && 'cursor-pointer hover:bg-secondary/50 transition-colors'
                  )}
                >
                  {/* Date number */}
                  {isToday ? (
                    <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                      style={{ boxShadow: '0 0 10px hsl(var(--primary)/0.6)' }}>
                      <span className="text-[10px] text-mono font-bold text-white leading-none">
                        {format(day, 'd')}
                      </span>
                    </span>
                  ) : (
                    <span className={cn(
                      "text-[11px] text-mono leading-none w-5 h-5 flex items-center justify-center",
                      hasJobs ? 'text-foreground font-semibold' : 'text-muted-foreground/60'
                    )}>
                      {format(day, 'd')}
                    </span>
                  )}

                  {/* Status dots */}
                  {hasJobs && (
                    <div className="flex gap-0.5 h-1.5 items-center">
                      {dayJobs.slice(0, 3).map((job, j) => (
                        <span key={j} className={cn("w-1 h-1 rounded-full", statusDot[job.status])} />
                      ))}
                      {dayJobs.length > 3 && (
                        <span className="text-[6px] text-mono text-muted-foreground">+{dayJobs.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Pay */}
                  {pay && (
                    <span className="text-[8px] text-mono font-bold leading-none text-success">
                      {pay >= 1000 ? `${(pay / 1000).toFixed(1)}k` : pay.toFixed(0)}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Week total column */}
            <div className="flex flex-col items-center justify-center py-2 bg-secondary/30 border-l border-border/30">
              {weekStats[wi].pay > 0 ? (
                <>
                  <span className="text-[8px] text-mono font-bold text-success leading-tight">
                    {fmtPay(weekStats[wi].pay)}
                  </span>
                  {weekStats[wi].hours > 0 && (
                    <span className="text-[7px] text-mono text-muted-foreground leading-tight">
                      {weekStats[wi].hours}h
                    </span>
                  )}
                </>
              ) : weekStats[wi].jobCount > 0 ? (
                <span className="text-[8px] text-mono text-accent leading-tight">
                  {weekStats[wi].jobCount}j
                </span>
              ) : (
                <span className="text-[8px] text-muted-foreground/20">·</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Month summary */}
      <div className="mt-3 rounded-xl border border-border overflow-hidden bg-card">
        <div className="px-3 py-2 border-b border-border/50 bg-secondary/30">
          <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/70 uppercase">
            {format(currentDate, 'MMMM yyyy')} — Summary
          </p>
        </div>

        {/* 3 stat tiles */}
        <div className="grid grid-cols-3 divide-x divide-border">
          <div className="flex flex-col items-center py-3 gap-0.5">
            <span className="text-2xl font-bold text-mono text-accent tabular-nums">
              {monthStats.totalJobs}
            </span>
            <span className="text-[8px] text-mono tracking-widest text-muted-foreground uppercase">Jobs</span>
          </div>
          <div className="flex flex-col items-center py-3 gap-0.5">
            <span className="text-2xl font-bold text-mono text-primary tabular-nums">
              {monthStats.totalHours > 0 ? monthStats.totalHours.toFixed(1) : '—'}
            </span>
            <span className="text-[8px] text-mono tracking-widest text-muted-foreground uppercase">Hours</span>
          </div>
          <div className="flex flex-col items-center py-3 gap-0.5">
            <span className="text-2xl font-bold text-mono text-success tabular-nums">
              {monthStats.totalPay > 0 ? fmtPay(monthStats.totalPay) : '—'}
            </span>
            <span className="text-[8px] text-mono tracking-widest text-muted-foreground uppercase">Earned</span>
          </div>
        </div>

        {/* Week breakdown */}
        {weekStats.some(w => w.jobCount > 0) && (
          <div className="border-t border-border/50 px-3 py-2.5 space-y-1.5">
            <p className="text-[8px] text-mono tracking-widest text-muted-foreground/50 uppercase mb-2">
              By Week
            </p>
            {weeks.map((week, i) => {
              const ws = weekStats[i];
              if (ws.jobCount === 0) return null;
              return (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-[10px] text-mono text-muted-foreground tabular-nums">
                    {format(week[0], 'MMM d')}–{format(week[6], 'd')}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-mono text-muted-foreground/70">
                      {ws.jobCount} gig{ws.jobCount !== 1 ? 's' : ''}
                    </span>
                    {ws.hours > 0 && (
                      <span className="text-[10px] text-mono text-primary tabular-nums">
                        {ws.hours}h
                      </span>
                    )}
                    <span className={cn(
                      "text-[10px] text-mono font-bold tabular-nums",
                      ws.pay > 0 ? 'text-success' : 'text-muted-foreground/30'
                    )}>
                      {ws.pay > 0 ? fmtPay(ws.pay) : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Day detail dialog */}
      <Dialog open={!!selectedDate} onOpenChange={o => !o && setSelectedDate(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-mono text-sm">
              {selectedDate && format(new Date(selectedDate + 'T12:00:00'), 'EEE, MMM d')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {selectedJobs.map(job => {
              const hours = job.hoursWorked ?? 0;
              const earned = hours * (job.hourlyRate ?? 0);
              return (
                <div
                  key={job.id}
                  onClick={() => { setSelectedDate(null); navigate('/log'); }}
                  className={cn(
                    "rounded-xl border p-3 space-y-1 cursor-pointer hover:bg-secondary/30 transition-colors",
                    statusColors[job.status]
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{job.name}</p>
                      <p className="text-xs opacity-70">{job.client}</p>
                    </div>
                    <span className="text-[9px] text-mono uppercase font-bold opacity-60 tracking-wider">{job.status}</span>
                  </div>
                  {job.venue && <p className="text-xs opacity-50">{job.venue}</p>}
                  <div className="flex gap-3 text-xs text-mono">
                    {job.startTime && (
                      <span>{job.startTime}{job.endTime ? ` – ${job.endTime}` : ''}</span>
                    )}
                    {hours > 0 && <span>{hours}h</span>}
                    {earned > 0 && <span className="font-bold text-success">${earned.toLocaleString()}</span>}
                  </div>
                </div>
              );
            })}
            {selectedDate && payByDate[selectedDate] && (
              <div className="flex items-center justify-between pt-2 border-t border-border text-xs text-mono">
                <span className="text-muted-foreground uppercase tracking-wider">Est. Pay</span>
                <span className="font-bold text-success">${payByDate[selectedDate].toLocaleString()}</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
