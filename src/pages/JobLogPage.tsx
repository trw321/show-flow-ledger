import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Clock, ChevronRight } from 'lucide-react';
import JobPhotoImport from '@/components/JobPhotoImport';
import LogHoursForm from '@/components/LogHoursForm';
import { format, isToday, isPast, isFuture } from 'date-fns';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';
import { cn } from '@/lib/utils';

export default function JobLogPage() {
  const { data, addJob, updateJob } = useData();
  const [logId, setLogId] = useState<string | null>(null);

  const loggingJob = logId ? data.jobs.find(j => j.id === logId) : undefined;

  // Split jobs into upcoming (needs logging) and logged
  const { upcoming, todayJobs, logged } = useMemo(() => {
    const upcoming: Job[] = [];
    const todayJobs: Job[] = [];
    const logged: Job[] = [];

    const sorted = [...data.jobs].sort((a, b) => a.date.localeCompare(b.date));
    for (const job of sorted) {
      const jobDate = new Date(job.date + 'T12:00:00');
      const hasHours = (job.hoursWorked ?? 0) > 0;

      if (isToday(jobDate) && !hasHours) {
        todayJobs.push(job);
      } else if (isFuture(jobDate) && !hasHours) {
        upcoming.push(job);
      } else if (hasHours) {
        logged.push(job);
      } else if (isPast(jobDate) && !hasHours) {
        todayJobs.push(job); // past unlogged — treat as needing attention
      }
    }
    return { upcoming, todayJobs, logged: logged.slice(-10).reverse() };
  }, [data.jobs]);

  return (
    <>
      <PageHeader title="Job Log" description="Pre-load jobs, then log hours on the day" />

      {/* Load upcoming jobs via photo */}
      <div className="mb-4">
        <JobPhotoImport onImport={async (job) => {
          await addJob({ ...job, status: 'upcoming', hoursWorked: 0 });
        }} />
      </div>

      {/* Today / Needs Logging */}
      {todayJobs.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs text-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
            <Clock size={12} /> Ready to Log
          </h3>
          <div className="space-y-2">
            {todayJobs.map(job => (
              <button
                key={job.id}
                onClick={() => setLogId(job.id)}
                className="w-full rounded-2xl border border-primary/30 bg-primary/5 p-3 flex items-center gap-3 text-left active:bg-primary/10 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{job.name}</p>
                  <p className="text-xs text-muted-foreground">{job.client} • {format(new Date(job.date + 'T12:00:00'), 'MMM d')}</p>
                  {job.startTime && <p className="text-xs text-mono text-muted-foreground mt-0.5">Call: {job.startTime}</p>}
                </div>
                <ChevronRight size={16} className="text-primary shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs text-mono uppercase tracking-wider text-muted-foreground mb-2">Upcoming</h3>
          <div className="space-y-1.5">
            {upcoming.map(job => (
              <div key={job.id} className="rounded-xl border border-border bg-card p-2.5 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{job.name} <span className="text-muted-foreground">• {job.client}</span></p>
                  <p className="text-[11px] text-mono text-muted-foreground">
                    {format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d')}
                    {job.startTime && ` • ${job.startTime}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recently Logged */}
      {logged.length > 0 && (
        <div className="mb-4">
          <h3 className="text-xs text-mono uppercase tracking-wider text-muted-foreground mb-2">Recently Logged</h3>
          <div className="space-y-1.5">
            {logged.map(job => (
              <div key={job.id} className="rounded-xl border border-border bg-card p-2.5 flex items-center gap-2 opacity-70">
                <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{job.name} <span className="text-muted-foreground">• {job.client}</span></p>
                  <p className="text-[11px] text-mono text-muted-foreground">
                    {format(new Date(job.date + 'T12:00:00'), 'MMM d')} • {job.hoursWorked}h
                    {job.hourlyRate ? ` • $${((job.hoursWorked ?? 0) * job.hourlyRate).toLocaleString()}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log hours dialog */}
      <Dialog open={!!logId} onOpenChange={o => !o && setLogId(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto mx-2 rounded-2xl">
          <DialogHeader><DialogTitle className="text-mono">Log Hours</DialogTitle></DialogHeader>
          {loggingJob && (
            <LogHoursForm
              initial={loggingJob}
              onSubmit={updates => {
                updateJob(logId!, { ...updates, status: 'completed' });
                setLogId(null);
                toast.success('Hours logged!');
              }}
              onCancel={() => setLogId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
