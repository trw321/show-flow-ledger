import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Briefcase, Plus, Trash2, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import type { Job } from '@/lib/store';

const statusOptions = ['upcoming', 'in-progress', 'completed', 'cancelled'] as const;

function JobForm({ onSubmit, initial, onCancel }: {
  onSubmit: (job: Omit<Job, 'id' | 'createdAt'>) => void;
  initial?: Partial<Job>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [client, setClient] = useState(initial?.client ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<Job['status']>(initial?.status ?? 'upcoming');
  const [paySchedule, setPaySchedule] = useState<Job['paySchedule']>(initial?.paySchedule ?? undefined);
  const [payPeriodStart, setPayPeriodStart] = useState(initial?.payPeriodStart ?? '');
  const [hourlyRate, setHourlyRate] = useState(initial?.hourlyRate?.toString() ?? '');
  const [minimumHours, setMinimumHours] = useState(initial?.minimumHours?.toString() ?? '');
  const [has6th7thDayRule, setHas6th7thDayRule] = useState(initial?.has6th7thDayRule ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(), client: client.trim(), venue: venue.trim(), date, status, notes: notes.trim(),
      paySchedule: paySchedule || undefined,
      payPeriodStart: payPeriodStart || undefined,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
      minimumHours: minimumHours ? parseFloat(minimumHours) : undefined,
      has6th7thDayRule,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input placeholder="Job name*" value={name} onChange={e => setName(e.target.value)} required />
        <Input placeholder="Client" value={client} onChange={e => setClient(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input placeholder="Venue" value={venue} onChange={e => setVenue(e.target.value)} />
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <Select value={status} onValueChange={(v) => setStatus(v as Job['status'])}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-3 gap-4">
        <Select value={paySchedule || 'none'} onValueChange={(v) => setPaySchedule(v === 'none' ? undefined : v as Job['paySchedule'])}>
          <SelectTrigger><SelectValue placeholder="Pay schedule" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No schedule</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
            <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="per-project">Per project</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" placeholder="Pay period start" value={payPeriodStart} onChange={e => setPayPeriodStart(e.target.value)} />
        <Input type="number" step="0.01" placeholder="Hourly rate" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
      </div>
      <Input placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <div className="flex gap-2 justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit">{initial ? 'Update' : 'Add Job'}</Button>
      </div>
    </form>
  );
}

export default function JobsPage() {
  const { data, addJob, updateJob, deleteJob } = useData();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const editingJob = editId ? data.jobs.find(j => j.id === editId) : undefined;

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Track AV gigs, clients, and venues"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus size={16} className="mr-1" /> New Job</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-mono">New Job</DialogTitle></DialogHeader>
              <JobForm onSubmit={(job) => { addJob(job); setOpen(false); }} />
            </DialogContent>
          </Dialog>
        }
      />

      {data.jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs yet" description="Add your first AV job to start tracking." />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3">Job</th>
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Venue</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map(job => (
                <tr key={job.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{job.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{job.client}</td>
                  <td className="px-4 py-3 text-muted-foreground">{job.venue}</td>
                  <td className="px-4 py-3 text-mono text-xs">{format(new Date(job.date), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs text-mono font-medium ${
                      job.status === 'completed' ? 'bg-success/20 text-success' :
                      job.status === 'in-progress' ? 'bg-primary/20 text-primary' :
                      job.status === 'cancelled' ? 'bg-destructive/20 text-destructive' :
                      'bg-accent/20 text-accent'
                    }`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditId(job.id)}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteJob(job.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent>
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
