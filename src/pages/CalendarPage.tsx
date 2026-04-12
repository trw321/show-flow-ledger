import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, DollarSign, Star } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay } from 'date-fns';
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

export default function CalendarPage() {
  const { data } = useData();
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
      {monthStats.totalJobs > 0 && (
        <div className="mt-4 space-y-1">
          <div className="flex items-center justify-between px-1 pb-1 border-b border-border/30">
            <span className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50">
              {format(currentDate, 'MMMM')}
            </span>
            <div className="flex items-center gap-3">
              {monthStats.totalHours > 0 && (
                <span className="text-[11px] text-mono font-semibold text-primary">
                  {monthStats.totalHours.toFixed(1)}h
                </span>
              )}
              {monthStats.totalPay > 0 && (
                <span className="text-[11px] text-mono font-bold text-success">
                  ${monthStats.totalPay >= 1000 ? `${(monthStats.totalPay / 1000).toFixed(1)}k` : monthStats.totalPay.toFixed(0)}
                </span>
              )}
            </div>
          </div>
          {weekStats.filter(w => w.jobCount > 0).map((ws, i) => (
            <div key={i} className="flex items-center justify-between px-1">
              <span className="text-[9px] text-mono text-muted-foreground/40">
                {format(ws.weekStart, 'MMM d')}
              </span>
              <div className="flex items-center gap-3">
                {ws.hours > 0 && (
                  <span className="text-[10px] text-mono text-muted-foreground">{ws.hours.toFixed(1)}h</span>
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
      )}

      {/* Day detail dialog */}
      <Dialog open={!!selectedDate} onOpenChange={(o) => !o && setSelectedDate(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto rounded-2xl">
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
                  onClick={() => { setSelectedDate(null); navigate('/log'); }}
                  className={cn(
                    "rounded-xl border p-3 space-y-1 cursor-pointer hover:bg-secondary/30 transition-colors",
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
        </DialogContent>
      </Dialog>
    </>
  );
}
