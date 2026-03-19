import { useState, useRef, useCallback, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Briefcase, Plus, Trash2, Pencil, Mic, MicOff, Loader2, Paperclip, X, ChevronDown, ChevronRight } from 'lucide-react';
import JobPasteImport from '@/components/JobPasteImport';
import JobPhotoImport from '@/components/JobPhotoImport';
import TimesheetUpload from '@/components/TimesheetUpload';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';
import { cn } from '@/lib/utils';

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
  const [hoursWorked, setHoursWorked] = useState(initial?.hoursWorked?.toString() ?? '');
  const [mealPenalties, setMealPenalties] = useState(initial?.mealPenalties?.toString() ?? '0');
  const [mealType, setMealType] = useState<Job['mealType']>(initial?.mealType ?? undefined);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [attachments, setAttachments] = useState<string[]>(initial?.attachments ?? []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > 5 * 1024 * 1024) { toast.error('File too large (max 5MB)'); return; }
      const reader = new FileReader();
      reader.onload = () => setAttachments(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (idx: number) => setAttachments(prev => prev.filter((_, i) => i !== idx));

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
      hoursWorked: hoursWorked ? parseFloat(hoursWorked) : undefined,
      mealPenalties: mealPenalties ? parseInt(mealPenalties) : 0,
      mealType: mealType || undefined,
      attachments,
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
      <div className="grid grid-cols-4 gap-4">
        <Input type="number" step="0.25" min="0" placeholder="Hours worked" value={hoursWorked} onChange={e => setHoursWorked(e.target.value)} />
        <Input type="number" step="0.01" min="0" placeholder="Hourly rate ($)" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} />
        <Input type="number" min="0" placeholder="Meal penalties" value={mealPenalties} onChange={e => setMealPenalties(e.target.value)} />
        <Select value={mealType || 'none'} onValueChange={(v) => setMealType(v === 'none' ? undefined : v as Job['mealType'])}>
          <SelectTrigger><SelectValue placeholder="Meal type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No meal break</SelectItem>
            <SelectItem value="YWA">YWA — 1hr off clock</SelectItem>
            <SelectItem value="NWA">NWA — 30min on clock</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Select value={status} onValueChange={(v) => setStatus(v as Job['status'])}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-3 gap-4">
        <Input placeholder="Payroll company" value={payrollCompany} onChange={e => setPayrollCompany(e.target.value)} />
        <Input placeholder="Steward / Contact" value={steward} onChange={e => setSteward(e.target.value)} />
        <Input type="number" step="0.5" min="0" placeholder="Min hours (e.g. 5)" value={minimumHours} onChange={e => setMinimumHours(e.target.value)} />
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
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={has6th7thDayRule} onChange={e => setHas6th7thDayRule(e.target.checked)} className="rounded border-border" />
        <span>6th/7th day rule (1.5× / 2×)</span>
      </label>
      <Textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} />

      {/* Attachments */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={14} className="mr-1" /> Attach Notes/Photos
          </Button>
          <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt" multiple className="hidden" onChange={handleFileUpload} />
          {attachments.length > 0 && <span className="text-xs text-muted-foreground">{attachments.length} file(s)</span>}
        </div>
        {attachments.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {attachments.map((att, i) => (
              <div key={i} className="relative group">
                {att.startsWith('data:image') ? (
                  <img src={att} alt={`Attachment ${i + 1}`} className="h-16 w-16 rounded border border-border object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded border border-border bg-secondary/50 flex items-center justify-center text-xs text-muted-foreground">File</div>
                )}
                <button type="button" onClick={() => removeAttachment(i)} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit">{initial ? 'Update' : 'Add Job'}</Button>
      </div>
    </form>
  );
}

function VoiceInput({ onParsed, jobs }: {
  onParsed: (entry: Partial<Job>) => void;
  jobs: { name: string; client: string }[];
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  const startRecording = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error('Speech recognition not supported'); return; }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      let t = '';
      for (let i = 0; i < event.results.length; i++) t += event.results[i][0].transcript;
      setTranscript(t);
    };
    recognition.onerror = (e: any) => { toast.error('Voice error: ' + e.error); setIsRecording(false); };
    recognition.onend = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setTranscript('');
  }, []);

  const stopRecording = useCallback(() => { recognitionRef.current?.stop(); setIsRecording(false); }, []);

  const parseTranscript = useCallback(async () => {
    if (!transcript.trim()) { toast.error('No input to parse'); return; }
    setIsProcessing(true);
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-time-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ text: transcript, jobs }),
      });
      if (!resp.ok) { const err = await resp.json().catch(() => ({ error: 'Failed' })); throw new Error(err.error); }
      const data = await resp.json();
      const e = data.entry;
      onParsed({
        name: e.description || e.jobName || 'Voice Entry',
        client: e.client || '',
        date: e.date,
        hourlyRate: e.rate || 0,
        hoursWorked: e.hours,
        venue: '',
        status: 'completed',
        notes: '',
      });
      toast.success('Parsed from voice input');
      setTranscript('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setIsProcessing(false);
    }
  }, [transcript, jobs, onParsed]);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant={isRecording ? 'destructive' : 'outline'} size="sm" onClick={isRecording ? stopRecording : startRecording} disabled={isProcessing}>
          {isRecording ? <><MicOff size={14} className="mr-1" /> Stop</> : <><Mic size={14} className="mr-1" /> Voice Input</>}
        </Button>
        {isRecording && <span className="text-xs text-destructive animate-pulse text-mono">● Recording...</span>}
      </div>
      {transcript && (
        <>
          <p className="text-sm text-muted-foreground italic">"{transcript}"</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={parseTranscript} disabled={isProcessing}>
              {isProcessing ? <><Loader2 size={14} className="mr-1 animate-spin" /> Parsing...</> : 'Parse & Fill Form'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTranscript('')}>Clear</Button>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">Try: "Worked 6 hours yesterday on lighting setup for ABC Corp at $45 an hour"</p>
    </div>
  );
}

export default function JobsPage() {
  const { data, addJob, updateJob, deleteJob } = useData();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [voicePrefill, setVoicePrefill] = useState<Partial<Job> | undefined>();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const editingJob = editId ? data.jobs.find(j => j.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ name: j.name, client: j.client }));

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

  // Group jobs by name+client, sorted by most recent date
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
    // Sort groups by most recent job date
    return [...groups.entries()].sort((a, b) => b[1].jobs[0].date.localeCompare(a[1].jobs[0].date));
  }, [data.jobs]);
        title="Jobs"
        description="Track gigs, hours worked, and earnings"
        action={
          <div className="flex gap-2 flex-wrap">
            <TimesheetUpload />
            <JobPhotoImport onImport={addJob} />
            <JobPasteImport onImport={addJob} />
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setVoicePrefill(undefined); }}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus size={16} className="mr-1" /> New Job</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="text-mono">New Job</DialogTitle></DialogHeader>
                <VoiceInput onParsed={handleVoiceParsed} jobs={jobs} />
                <JobForm
                  initial={voicePrefill}
                  onSubmit={(job) => { addJob(job); setOpen(false); setVoicePrefill(undefined); }}
                />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-lg border border-border bg-secondary/20 p-4">
          <p className="text-xs text-muted-foreground text-mono uppercase">Total Hours</p>
          <p className="text-2xl font-bold text-mono mt-1">{totalHours.toFixed(1)}</p>
        </div>
        <div className="rounded-lg border border-border bg-secondary/20 p-4">
          <p className="text-xs text-muted-foreground text-mono uppercase">Total Earnings</p>
          <p className="text-2xl font-bold text-mono text-success mt-1">${totalEarnings.toLocaleString()}</p>
        </div>
      </div>

      {data.jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="No jobs yet" description="Add your first AV job to start tracking." />
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3">Job #</th>
                <th className="text-left px-4 py-3">Event</th>
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-right px-4 py-3">Hours</th>
                <th className="text-right px-4 py-3">Rate</th>
                <th className="text-right px-4 py-3">Earned</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3 sticky right-0 bg-secondary/50"></th>
              </tr>
            </thead>
            <tbody>
              {[...data.jobs].sort((a, b) => b.date.localeCompare(a.date) || (b.startTime ?? '').localeCompare(a.startTime ?? '')).map(job => {
                const hours = job.hoursWorked ?? 0;
                const earned = hours * (job.hourlyRate ?? 0);
                return (
                  <tr key={job.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 text-mono text-xs text-muted-foreground">{job.jobNumber || '—'}</td>
                    <td className="px-4 py-3 font-medium">
                      {job.name}
                      {(job.attachments?.length ?? 0) > 0 && <Paperclip size={12} className="inline ml-1 text-muted-foreground" />}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{job.client}</td>
                    <td className="px-4 py-3 text-mono text-xs">{format(new Date(job.date), 'MMM d, yyyy')}</td>
                    <td className="px-4 py-3 text-mono text-xs text-muted-foreground">
                      {job.startTime ? `${job.startTime}${job.endTime ? ` – ${job.endTime}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-mono">{hours > 0 ? hours : '—'}</td>
                    <td className="px-4 py-3 text-right text-mono">{job.hourlyRate ? `$${job.hourlyRate.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-mono font-bold text-success">{earned > 0 ? `$${earned.toLocaleString()}` : '—'}</td>
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => { deleteJob(job.id); toast.success('Job deleted'); }}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
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
