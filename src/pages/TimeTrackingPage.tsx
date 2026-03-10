import { useState, useRef, useCallback } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Clock, Plus, Trash2, Pencil, Mic, MicOff, Loader2, Paperclip, X } from 'lucide-react';
import TimesheetUpload from '@/components/TimesheetUpload';
import { format } from 'date-fns';
import { toast } from 'sonner';
import type { TimeEntry } from '@/lib/store';

function TimeEntryForm({ onSubmit, initial, onCancel, jobs }: {
  onSubmit: (entry: Omit<TimeEntry, 'id' | 'createdAt'>) => void;
  initial?: Partial<TimeEntry>;
  onCancel?: () => void;
  jobs: { id: string; name: string; client: string }[];
}) {
  const [hours, setHours] = useState(String(initial?.hours ?? ''));
  const [rate, setRate] = useState(String(initial?.rate ?? ''));
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().split('T')[0]);
  const [client, setClient] = useState(initial?.client ?? '');
  const [jobId, setJobId] = useState(initial?.jobId ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [attachments, setAttachments] = useState<string[]>(initial?.attachments ?? []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('File too large (max 5MB)');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments(prev => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseFloat(hours);
    if (!h || h <= 0) { toast.error('Enter valid hours'); return; }
    onSubmit({
      hours: h,
      rate: parseFloat(rate) || 0,
      date,
      client: client.trim(),
      jobId: jobId || undefined,
      description: description.trim(),
      notes: notes.trim(),
      attachments,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input type="number" step="0.25" min="0" placeholder="Hours worked*" value={hours} onChange={e => setHours(e.target.value)} required />
        <Input type="number" step="0.01" min="0" placeholder="Hourly rate ($)" value={rate} onChange={e => setRate(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <Input placeholder="Client" value={client} onChange={e => setClient(e.target.value)} />
      </div>
      <Select value={jobId} onValueChange={setJobId}>
        <SelectTrigger><SelectValue placeholder="Link to job (optional)" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No job</SelectItem>
          {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.name} — {j.client}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
      <Textarea placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
      
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
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit">{initial ? 'Update' : 'Add Entry'}</Button>
      </div>
    </form>
  );
}

function VoiceInput({ onParsed, jobs }: {
  onParsed: (entry: Partial<TimeEntry>) => void;
  jobs: { id: string; name: string; client: string }[];
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  const startRecording = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Speech recognition not supported in this browser');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let t = '';
      for (let i = 0; i < event.results.length; i++) {
        t += event.results[i][0].transcript;
      }
      setTranscript(t);
    };
    recognition.onerror = (e: any) => {
      console.error('Speech recognition error:', e.error);
      toast.error('Voice input error: ' + e.error);
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setTranscript('');
  }, []);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  const parseTranscript = useCallback(async () => {
    if (!transcript.trim()) { toast.error('No input to parse'); return; }
    setIsProcessing(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(`${supabaseUrl}/functions/v1/parse-time-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ text: transcript, jobs: jobs.map(j => ({ name: j.name, client: j.client })) }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse');
      }
      const data = await resp.json();
      const e = data.entry;
      const matchedJob = jobs.find(j => j.name.toLowerCase() === e.jobName?.toLowerCase());
      onParsed({
        hours: e.hours,
        rate: e.rate || 0,
        date: e.date,
        client: e.client || matchedJob?.client || '',
        jobId: matchedJob?.id,
        description: e.description,
        notes: '',
        attachments: [],
      });
      toast.success('Parsed time entry from voice input');
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
        <Button
          type="button"
          variant={isRecording ? 'destructive' : 'outline'}
          size="sm"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
        >
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
      <p className="text-xs text-muted-foreground">
        Try: "Worked 6 hours yesterday on lighting setup for ABC Corp at $45 an hour"
      </p>
    </div>
  );
}

export default function TimeTrackingPage() {
  const { data, addTimeEntry, updateTimeEntry, deleteTimeEntry } = useData();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [voicePrefill, setVoicePrefill] = useState<Partial<TimeEntry> | undefined>();

  const editingEntry = editId ? data.timeEntries.find(t => t.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name, client: j.client }));

  const totalHours = data.timeEntries.reduce((s, t) => s + t.hours, 0);
  const totalEarnings = data.timeEntries.reduce((s, t) => s + t.hours * t.rate, 0);

  const handleVoiceParsed = (entry: Partial<TimeEntry>) => {
    setVoicePrefill(entry);
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Time Tracking"
        description="Log hours worked, link to jobs, and track earnings"
        action={
          <div className="flex gap-2">
            <TimesheetUpload />
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setVoicePrefill(undefined); }}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus size={16} className="mr-1" /> New Entry</Button>
              </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="text-mono">New Time Entry</DialogTitle></DialogHeader>
              <VoiceInput onParsed={handleVoiceParsed} jobs={jobs} />
              <TimeEntryForm
                initial={voicePrefill}
                jobs={jobs}
                onSubmit={(entry) => { addTimeEntry(entry); setOpen(false); setVoicePrefill(undefined); }}
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

      {data.timeEntries.length === 0 ? (
        <EmptyState icon={Clock} title="No time entries yet" description="Log your first hours worked to start tracking." />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Job</th>
                <th className="text-right px-4 py-3">Hours</th>
                <th className="text-right px-4 py-3">Rate</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.timeEntries.map(entry => {
                const job = data.jobs.find(j => j.id === entry.jobId);
                return (
                  <tr key={entry.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 text-mono text-xs">{format(new Date(entry.date), 'MMM d, yyyy')}</td>
                    <td className="px-4 py-3 font-medium">
                      {entry.description}
                      {entry.attachments?.length > 0 && (
                        <Paperclip size={12} className="inline ml-1 text-muted-foreground" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.client}</td>
                    <td className="px-4 py-3 text-muted-foreground">{job?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-mono">{entry.hours}</td>
                    <td className="px-4 py-3 text-right text-mono">${entry.rate}</td>
                    <td className="px-4 py-3 text-right text-mono font-bold text-success">${(entry.hours * entry.rate).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditId(entry.id)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteTimeEntry(entry.id)}>
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
          <DialogHeader><DialogTitle className="text-mono">Edit Time Entry</DialogTitle></DialogHeader>
          {editingEntry && (
            <TimeEntryForm
              initial={editingEntry}
              jobs={jobs}
              onSubmit={(updates) => { updateTimeEntry(editId!, updates); setEditId(null); }}
              onCancel={() => setEditId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
