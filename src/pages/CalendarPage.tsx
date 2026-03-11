import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, addWeeks, subWeeks, isSameMonth, isSameDay, parseISO } from 'date-fns';
import type { Job } from '@/lib/store';
import { cn } from '@/lib/utils';

type ViewMode = 'month' | 'week';

const statusColors: Record<Job['status'], string> = {
  upcoming: 'bg-accent/20 text-accent border-accent/30',
  'in-progress': 'bg-primary/20 text-primary border-primary/30',
  completed: 'bg-success/20 text-success border-success/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
};

export default function CalendarPage() {
  const { data } = useData();
  const [view, setView] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());

  const jobsByDate = useMemo(() => {
    const map: Record<string, Job[]> = {};
    data.jobs.forEach(job => {
      const key = job.date;
      if (!map[key]) map[key] = [];
      map[key].push(job);
    });
    return map;
  }, [data.jobs]);

  const navigate = (dir: 1 | -1) => {
    setCurrentDate(prev =>
      view === 'month'
        ? dir === 1 ? addMonths(prev, 1) : subMonths(prev, 1)
        : dir === 1 ? addWeeks(prev, 1) : subWeeks(prev, 1)
    );
  };

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
    const days: Date[] = [];
    let d = start;
    while (d <= end) { days.push(d); d = addDays(d, 1); }
    return days;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  const days = view === 'month' ? monthDays : weekDays;
  const today = new Date();

  return (
    <>
      <PageHeader title="Calendar" description="View your jobs on a calendar" />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ChevronLeft size={18} /></Button>
          <h2 className="text-mono text-lg font-semibold min-w-[200px] text-center">
            {view === 'month' ? format(currentDate, 'MMMM yyyy') : `Week of ${format(startOfWeek(currentDate), 'MMM d, yyyy')}`}
          </h2>
          <Button variant="ghost" size="icon" onClick={() => navigate(1)}><ChevronRight size={18} /></Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>Today</Button>
        </div>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            className={cn("px-3 py-1.5 text-xs text-mono transition-colors", view === 'month' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80')}
            onClick={() => setView('month')}
          >Month</button>
          <button
            className={cn("px-3 py-1.5 text-xs text-mono transition-colors", view === 'week' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80')}
            onClick={() => setView('week')}
          >Week</button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border mb-px">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-center text-xs text-muted-foreground text-mono py-2 uppercase tracking-wider">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className={cn("grid grid-cols-7 border-l border-border", view === 'week' ? 'min-h-[400px]' : '')}>
        {days.map((day, i) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayJobs = jobsByDate[dateKey] || [];
          const isToday = isSameDay(day, today);
          const isCurrentMonth = isSameMonth(day, currentDate);

          return (
            <div
              key={i}
              className={cn(
                "border-r border-b border-border p-1.5 transition-colors",
                view === 'month' ? 'min-h-[100px]' : 'min-h-[400px]',
                !isCurrentMonth && view === 'month' && 'opacity-40',
                isToday && 'bg-primary/5'
              )}
            >
              <div className={cn(
                "text-xs text-mono mb-1 w-6 h-6 flex items-center justify-center rounded-full",
                isToday ? 'bg-primary text-primary-foreground font-bold' : 'text-muted-foreground'
              )}>
                {format(day, 'd')}
              </div>
              <div className="space-y-0.5">
                {dayJobs.slice(0, view === 'month' ? 3 : 20).map(job => (
                  <div
                    key={job.id}
                    className={cn("rounded px-1.5 py-0.5 text-[10px] leading-tight border truncate", statusColors[job.status])}
                    title={`${job.name} — ${job.client}\n${job.startTime || ''} ${job.endTime ? `– ${job.endTime}` : ''}\n${job.venue}`}
                  >
                    {job.startTime && <span className="text-mono opacity-70 mr-1">{job.startTime.replace(/\s?(AM|PM)/i, (_, p) => p.toLowerCase().charAt(0))}</span>}
                    {job.name}
                  </div>
                ))}
                {view === 'month' && dayJobs.length > 3 && (
                  <div className="text-[10px] text-muted-foreground text-mono pl-1">+{dayJobs.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
