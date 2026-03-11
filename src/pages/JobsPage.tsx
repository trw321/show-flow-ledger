import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Briefcase, Plus, Trash2, Pencil } from 'lucide-react';
import JobPasteImport from '@/components/JobPasteImport';
import JobPhotoImport from '@/components/JobPhotoImport';
import { format } from 'date-fns';
import type { Job } from '@/lib/store';

const statusOptions = ['upcoming', 'in-progress', 'completed', 'cancelled'] as const;

function JobForm({ onSubmit, initial, onCancel }: {
  onSubmit: (job: Omit<Job, 'id' | 'createdAt'>) => void;
  initial?: Partial<Job>;
  onCancel?: () => void;
}) {
  const [jobNumber, setJobNumber] = useState(initial?.jobNumber ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [client, setClient] = useState(initial?.client ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  const [status, setStatus] = useState<Job['status']>(initial?.status ?? 'upcoming');
  const [paySchedule, setPaySchedule] = useState<Job['paySchedule']>(initial?.paySchedule ?? undefined);
  const [payPeriodStart, setPayPeriodStart] = useState(initial?.payPeriodStart ?? '');
  const [payrollCompany, setPayrollCompany] = useState(initial?.payrollCompany ?? '');
  const [hourlyRate, setHourlyRate] = useState(initial?.hourlyRate?.toString() ?? '');
  const [minimumHours, setMinimumHours] = useState(initial?.minimumHours?.toString() ?? '');
  const [has6th7thDayRule, setHas6th7thDayRule] = useState(initial?.has6th7thDayRule ?? false);
  const [steward, setSteward] = useState(initial?.steward ?? '');
  const [parkingCost, setParkingCost] = useState(initial?.parkingCost?.toString() ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      jobNumber: jobNumber.trim() || undefined,
      name: name.trim(), client: client.trim(), venue: venue.trim(), date, status, notes: notes.trim(),
      startTime: startTime.trim() || undefined,
      endTime: endTime.trim() || undefined,
      paySchedule: paySchedule || undefined,
      payPeriodStart: payPeriodStart || undefined,
      payrollCompany: payrollCompany.trim() || undefined,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
      minimumHours: minimumHours ? parseFloat(minimumHours) : undefined,
      has6th7thDayRule,
      steward: steward.trim() || undefined,
      parkingCost: parkingCost ? parseFloat(parkingCost) : undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Input placeholder="Job # (last 4)" value={jobNumber} onChange={e => setJobNumber(e.target.value)} />
        <Input placeholder="Job name*" value={name} onChange={e => setName(e.target.value)} required className="col-span-2" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input placeholder="Client / Production Co." value={client} onChange={e => setClient(e.target.value)} />
        <Input placeholder="Venue" value={venue} onChange={e => setVenue(e.target.value)} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <Input placeholder="Start time (e.g. 08:00 AM)" value={startTime} onChange={e => setStartTime(e.target.value)} />
        <Input placeholder="End time (e.g. 05:00 PM)" value={endTime} onChange={e => setEndTime(e.target.value)} />
      </div>
      <Select value={status} onValueChange={(v) => setStatus(v as Job['status'])}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-3 gap-4">
        <Input placeholder="Payroll company" value={payrollCompany} onChange={e => setPayrollCompany(e.target.value)} />
        <Input type="number" step="0.01" placeholder="Hourly rate" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
        <Input placeholder="Steward / Contact" value={steward} onChange={e => setSteward(e.target.value)} />
      </div>
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
        <Input type="number" step="0.01" placeholder="Parking cost" value={parkingCost} onChange={e => setParkingCost(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input type="number" step="0.5" min="0" placeholder="Minimum hours (e.g. 5)" value={minimumHours} onChange={e => setMinimumHours(e.target.value)} />
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={has6th7thDayRule} onChange={e => setHas6th7thDayRule(e.target.checked)} className="rounded border-border" />
          <span>6th/7th day rule (1.5× / 2×)</span>
        </label>
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
          <div className="flex gap-2">
            <JobPasteImport onImport={addJob} />
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus size={16} className="mr-1" /> New Job</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="text-mono">New Job</DialogTitle></DialogHeader>
                <JobForm onSubmit={(job) => { addJob(job); setOpen(false); }} />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {data.jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs yet" description="Add your first AV job to start tracking." />
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3">Job #</th>
                <th className="text-left px-4 py-3">Event</th>
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Venue</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Rate</th>
                <th className="text-left px-4 py-3">Steward</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3 sticky right-0 bg-secondary/50"></th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map(job => (
                <tr key={job.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 text-mono text-xs text-muted-foreground">{job.jobNumber || '—'}</td>
                  <td className="px-4 py-3 font-medium">{job.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{job.client}</td>
                  <td className="px-4 py-3 text-muted-foreground">{job.venue}</td>
                  <td className="px-4 py-3 text-mono text-xs">{format(new Date(job.date), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3 text-mono text-xs text-muted-foreground">
                    {job.startTime ? `${job.startTime}${job.endTime ? ` – ${job.endTime}` : ''}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-mono text-xs">{job.hourlyRate ? `$${job.hourlyRate.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{job.steward || '—'}</td>
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
                  <td className="px-4 py-3 text-right sticky right-0 bg-background">
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
