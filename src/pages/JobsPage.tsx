import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Briefcase, Trash2, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import JobPhotoImport from '@/components/JobPhotoImport';
import JobPasteImport from '@/components/JobPasteImport';
import JobForm from '@/components/JobForm';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';
import { cn } from '@/lib/utils';

export default function JobsPage() {
  const { data, addJob, updateJob, deleteJob } = useData();
  const [editId, setEditId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const editingJob = editId ? data.jobs.find(j => j.id === editId) : undefined;
  const totalHours = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
  const totalEarnings = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);

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
      if (!groups.has(key)) groups.set(key, { name: job.name, client: job.client, jobs: [] });
      groups.get(key)!.jobs.push(job);
    }
    return [...groups.entries()].sort((a, b) => b[1].jobs[0].date.localeCompare(a[1].jobs[0].date));
  }, [data.jobs]);

  return (
    <>
      <PageHeader title="Jobs" description="Track gigs, hours, and earnings" />

      {/* Import */}
      <div className="mb-4 flex flex-col gap-2">
        <JobPhotoImport onImport={async (job) => { await addJob(job); }} />
        <div className="flex justify-end">
          <JobPasteImport onImport={(job) => addJob(job)} />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Hours</p>
          <p className="text-xl font-bold mt-0.5">{totalHours.toFixed(1)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Earnings</p>
          <p className="text-xl font-bold text-success mt-0.5">${totalEarnings.toLocaleString()}</p>
        </div>
      </div>

      {/* Job list */}
      {data.jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs yet" description="Use Photo Import above to scan a dispatch email or schedule" />
      ) : (
        <div className="space-y-2">
          {groupedJobs.map(([key, group]) => {
            const isOpen = expandedGroups.has(key);
            const totalGroupHours = group.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
            const totalGroupEarned = group.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);
            const shiftCount = group.jobs.length;

            return (
              <div key={key} className="rounded-2xl border border-border overflow-hidden">
                <button
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-card hover:bg-accent/10 transition-colors text-left"
                >
                  {isOpen ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-sm truncate">{group.name}</span>
                      {group.client && <span className="text-xs text-muted-foreground truncate">• {group.client}</span>}
                    </div>
                    <div className="flex gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <span>{shiftCount} shift{shiftCount !== 1 ? 's' : ''}</span>
                      {totalGroupHours > 0 && <span>{totalGroupHours.toFixed(1)}h</span>}
                      {totalGroupEarned > 0 && <span className="text-success font-semibold">${totalGroupEarned.toLocaleString()}</span>}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="divide-y divide-border">
                    {group.jobs.map(job => {
                      const hours = job.hoursWorked ?? 0;
                      const earned = hours * (job.hourlyRate ?? 0);
                      return (
                        <div key={job.id} className="px-3 py-2.5 hover:bg-accent/5 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-medium">{format(new Date(job.date), 'MMM d, yyyy')}</span>
                                {job.jobNumber && <span className="text-[10px] text-muted-foreground">#{job.jobNumber}</span>}
                                <span className={cn("inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                  job.status === 'completed' ? 'bg-success/20 text-success' :
                                    job.status === 'in-progress' ? 'bg-primary/20 text-primary' :
                                      job.status === 'cancelled' ? 'bg-destructive/20 text-destructive' :
                                        'bg-accent/20 text-accent'
                                )}>
                                  {job.status}
                                </span>
                              </div>
                              {job.venue && <p className="text-xs text-muted-foreground truncate">{job.venue}</p>}
                              <div className="flex items-center gap-3 text-xs">
                                {job.startTime && <span className="text-muted-foreground">{job.startTime}{job.endTime ? ` – ${job.endTime}` : ''}</span>}
                                {hours > 0 && <span>{hours}h</span>}
                                {job.hourlyRate ? <span>${job.hourlyRate}/hr</span> : null}
                                {earned > 0 && <span className="font-bold text-success">${earned.toLocaleString()}</span>}
                              </div>
                            </div>
                            <div className="flex gap-0.5 shrink-0">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditId(job.id)}><Pencil size={14} /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { deleteJob(job.id); toast.success('Deleted'); }}><Trash2 size={14} /></Button>
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

      {/* Edit dialog */}
      <Dialog open={!!editId} onOpenChange={o => !o && setEditId(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto mx-2">
          <DialogHeader><DialogTitle>Edit Job</DialogTitle></DialogHeader>
          {editingJob && (
            <JobForm initial={editingJob} onSubmit={updates => { updateJob(editId!, updates); setEditId(null); }} onCancel={() => setEditId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
