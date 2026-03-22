import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Briefcase, Plus, Trash2, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import JobPasteImport from '@/components/JobPasteImport';
import JobPhotoImport from '@/components/JobPhotoImport';
import TimesheetUpload from '@/components/TimesheetUpload';
import VoiceDictation from '@/components/VoiceDictation';
import JobForm from '@/components/JobForm';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';
import { cn } from '@/lib/utils';

export default function JobsPage() {
  const { data, addJob, updateJob, deleteJob } = useData();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [voicePrefill, setVoicePrefill] = useState<Partial<Job> | undefined>();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const editingJob = editId ? data.jobs.find(j => j.id === editId) : undefined;
  const jobsList = data.jobs.map(j => ({ name: j.name, client: j.client }));

  const totalHours = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
  const totalEarnings = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);

  const handleVoiceParsed = (entry: Partial<Job>) => {
    setVoicePrefill(entry);
    setOpen(true);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const groupedJobs = useMemo(() => {
    const groups = new Map<string, { name: string; client: string; jobs: Job[] }>();
    const sorted = [...data.jobs].sort((a, b) => b.date.localeCompare(a.date) || (b.startTime ?? '').localeCompare(a.startTime ?? ''));
    for (const job of sorted) {
      const key = `${job.name.toLowerCase().trim()}|${job.client.toLowerCase().trim()}`;
      if (!groups.has(key)) {
        groups.set(key, { name: job.name, client: job.client, jobs: [] });
      }
      groups.get(key)!.jobs.push(job);
    }
    return [...groups.entries()].sort((a, b) => b[1].jobs[0].date.localeCompare(a[1].jobs[0].date));
  }, [data.jobs]);

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Track gigs, hours, and earnings"
        action={
          <>
            <TimesheetUpload />
            <JobPhotoImport onImport={addJob} />
            <JobPasteImport onImport={addJob} />
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setVoicePrefill(undefined); }}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus size={16} className="mr-1" /> New</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto mx-2">
                <DialogHeader><DialogTitle className="text-mono">New Job</DialogTitle></DialogHeader>
                <JobForm
                  initial={voicePrefill}
                  onSubmit={(job) => { addJob(job); setOpen(false); setVoicePrefill(undefined); }}
                />
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {/* Voice Dictation */}
      <div className="mb-4 rounded-lg border border-border bg-secondary/20 p-3">
        <VoiceDictation onParsed={handleVoiceParsed} jobs={jobsList} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-border bg-secondary/20 p-3">
          <p className="text-[10px] text-muted-foreground text-mono uppercase">Total Hours</p>
          <p className="text-xl font-bold text-mono mt-0.5">{totalHours.toFixed(1)}</p>
        </div>
        <div className="rounded-lg border border-border bg-secondary/20 p-3">
          <p className="text-[10px] text-muted-foreground text-mono uppercase">Total Earnings</p>
          <p className="text-xl font-bold text-mono text-success mt-0.5">${totalEarnings.toLocaleString()}</p>
        </div>
      </div>

      {data.jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs yet" description="Add your first AV job to start tracking." />
      ) : (
        <div className="space-y-2">
          {groupedJobs.map(([key, group]) => {
            const isOpen = expandedGroups.has(key);
            const totalGroupHours = group.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
            const totalGroupEarned = group.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);
            const latestDate = group.jobs[0].date;
            const shiftCount = group.jobs.length;

            return (
              <div key={key} className="rounded-lg border border-border overflow-hidden">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
                >
                  {isOpen
                    ? <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                    : <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm truncate">{group.name}</span>
                      {group.client && <span className="text-xs text-muted-foreground truncate">• {group.client}</span>}
                    </div>
                    <div className="flex gap-2 text-[11px] text-muted-foreground text-mono mt-0.5">
                      <span>{shiftCount} shift{shiftCount !== 1 ? 's' : ''}</span>
                      <span>{format(new Date(latestDate), 'MMM d')}</span>
                      {totalGroupHours > 0 && <span>{totalGroupHours.toFixed(1)}h</span>}
                      {totalGroupEarned > 0 && <span className="text-success font-semibold">${totalGroupEarned.toLocaleString()}</span>}
                    </div>
                  </div>
                </button>

                {/* Expanded: mobile card layout */}
                {isOpen && (
                  <div className="divide-y divide-border">
                    {group.jobs.map(job => {
                      const hours = job.hoursWorked ?? 0;
                      const earned = hours * (job.hourlyRate ?? 0);
                      return (
                        <div key={job.id} className="px-3 py-2.5 hover:bg-secondary/20 transition-colors">
                          {/* Mobile: stacked card layout */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-mono font-medium">
                                  {format(new Date(job.date), 'MMM d, yyyy')}
                                </span>
                                {job.jobNumber && (
                                  <span className="text-[10px] text-muted-foreground text-mono">#{job.jobNumber}</span>
                                )}
                                <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] text-mono font-medium",
                                  job.status === 'completed' ? 'bg-success/20 text-success' :
                                    job.status === 'in-progress' ? 'bg-primary/20 text-primary' :
                                      job.status === 'cancelled' ? 'bg-destructive/20 text-destructive' :
                                        'bg-accent/20 text-accent'
                                )}>
                                  {job.status}
                                </span>
                              </div>
                              {job.venue && (
                                <p className="text-xs text-muted-foreground truncate">{job.venue}</p>
                              )}
                              <div className="flex items-center gap-3 text-xs text-mono">
                                {job.startTime && (
                                  <span className="text-muted-foreground">
                                    {job.startTime}{job.endTime ? ` – ${job.endTime}` : ''}
                                  </span>
                                )}
                                {hours > 0 && <span>{hours}h</span>}
                                {job.hourlyRate ? <span>${job.hourlyRate}/hr</span> : null}
                                {earned > 0 && <span className="font-bold text-success">${earned.toLocaleString()}</span>}
                              </div>
                            </div>
                            <div className="flex gap-0.5 shrink-0">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditId(job.id)}>
                                <Pencil size={14} />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { deleteJob(job.id); toast.success('Deleted'); }}>
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto mx-2">
          <DialogHeader><DialogTitle className="text-mono">Edit Job</DialogTitle></DialogHeader>
          {editingJob && (
            <JobForm
              initial={editingJob}
              onSubmit={(updates) => { updateJob(editId!, updates); setEditId(null); }}
              onCancel={() => setEditId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
