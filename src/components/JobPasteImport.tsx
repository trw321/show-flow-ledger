import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ClipboardPaste, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';
import { getJobDedupKey } from '@/lib/jobDedup';

interface ParsedJob {
  jobNumber?: string;
  name: string;
  client: string;
  venue: string;
  date: string;
  startTime?: string;
  endTime?: string;
  status: Job['status'];
  payrollCompany?: string;
  hourlyRate?: number;
  steward?: string;
  parkingCost?: number;
  notes?: string;
}

export default function JobPasteImport({ onImport }: { onImport: (job: Omit<Job, 'id' | 'createdAt'>) => Promise<void> | void }) {
  const { data: appData } = useData();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [entries, setEntries] = useState<ParsedJob[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [step, setStep] = useState<'paste' | 'review'>('paste');

  const handleParse = async () => {
    if (!text.trim()) { toast.error('Paste some text first'); return; }
    setIsParsing(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(`${supabaseUrl}/functions/v1/parse-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse');
      }
      const data = await resp.json();
      const jobs: ParsedJob[] = data.jobs || [];
      if (jobs.length === 0) { toast.error('No jobs found in pasted text'); return; }
      setEntries(jobs);
      setSelected(new Set(jobs.map((_, i) => i)));
      setStep('review');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setIsParsing(false);
    }
  };

  const updateEntry = (idx: number, field: keyof ParsedJob, value: string | number | undefined) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const [isImporting, setIsImporting] = useState(false);

  const handleImport = async () => {
    const toImport = entries.filter((_, i) => selected.has(i));
    if (toImport.length === 0) { toast.error('Select at least one job'); return; }

    setIsImporting(true);
    const existingKeys = new Set(appData.jobs.map(job => getJobDedupKey(job)));
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const j of toImport) {
      const draft = {
        jobNumber: j.jobNumber,
        name: j.name,
        client: j.client,
        venue: j.venue,
        date: j.date,
        startTime: j.startTime,
        endTime: j.endTime,
        status: j.status,
        payrollCompany: j.payrollCompany,
        hourlyRate: j.hourlyRate,
        steward: j.steward,
        parkingCost: j.parkingCost,
        notes: j.notes || '',
        has6th7thDayRule: false,
        hasVacationPay: false,
      };
      const key = getJobDedupKey(draft);

      if (existingKeys.has(key)) { skipped++; continue; }

      try {
        await onImport(draft);
        existingKeys.add(key);
        imported++;
      } catch (err) {
        console.error('Failed to save job:', j.name, err);
        failed++;
      }
    }

    setIsImporting(false);

    if (imported === 0 && failed > 0) {
      toast.error(`Failed to save jobs — check your connection and try again`);
      return;
    }
    if (imported === 0) {
      toast.error('All selected jobs were already imported');
      return;
    }

    toast.success(`Imported ${imported} job(s)${skipped ? ` • skipped ${skipped} duplicate(s)` : ''}${failed ? ` • ${failed} failed` : ''}`);
    handleClose(false);
  };

  const handleClose = (o: boolean) => {
    setOpen(o);
    if (!o) { setText(''); setEntries([]); setStep('paste'); }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><ClipboardPaste size={16} className="mr-1" /> Paste Import</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-mono">Paste Job History</DialogTitle></DialogHeader>

        {step === 'paste' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copy & paste job history from a website, spreadsheet, email, or notes. AI will parse it into jobs.
            </p>
            <Textarea
              placeholder={"Paste job history here...\n\nExamples:\n- A table copied from a dispatch website\n- A list from an email\n- Spreadsheet rows"}
              value={text}
              onChange={e => setText(e.target.value)}
              rows={10}
              className="font-mono text-xs"
            />
            <div className="flex justify-end">
              <Button onClick={handleParse} disabled={isParsing || !text.trim()}>
                {isParsing ? <><Loader2 size={14} className="mr-1 animate-spin" /> Parsing...</> : 'Parse Jobs'}
              </Button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Found {entries.length} job(s). Edit fields inline before importing.
            </p>
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs min-w-[900px]">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-mono">
                    <th className="px-2 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selected.size === entries.length}
                        onChange={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map((_, i) => i)))}
                        className="rounded border-border"
                      />
                    </th>
                    <th className="px-2 py-2 text-left">Job #</th>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">Start</th>
                    <th className="px-2 py-2 text-left">End</th>
                    <th className="px-2 py-2 text-left">Client</th>
                    <th className="px-2 py-2 text-left">Event</th>
                    <th className="px-2 py-2 text-left">Payroll</th>
                    <th className="px-2 py-2 text-left">Venue</th>
                    <th className="px-2 py-2 text-left">Rate</th>
                    <th className="px-2 py-2 text-left">Steward</th>
                    <th className="px-2 py-2 text-left">Parking</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <tr key={i} className={`border-t border-border ${selected.has(i) ? 'bg-primary/5' : 'opacity-50'}`}>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelect(i)} className="rounded border-border" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={entry.jobNumber ?? ''} onChange={e => updateEntry(i, 'jobNumber', e.target.value)} className="h-7 text-xs w-16" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="date" value={entry.date} onChange={e => updateEntry(i, 'date', e.target.value)} className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={entry.startTime ?? ''} onChange={e => updateEntry(i, 'startTime', e.target.value)} className="h-7 text-xs w-20" placeholder="08:00 AM" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={entry.endTime ?? ''} onChange={e => updateEntry(i, 'endTime', e.target.value)} className="h-7 text-xs w-20" placeholder="05:00 PM" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={entry.client} onChange={e => updateEntry(i, 'client', e.target.value)} className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={entry.name} onChange={e => updateEntry(i, 'name', e.target.value)} className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={entry.payrollCompany ?? ''} onChange={e => updateEntry(i, 'payrollCompany', e.target.value)} className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={entry.venue} onChange={e => updateEntry(i, 'venue', e.target.value)} className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" step="0.01" value={entry.hourlyRate ?? ''} onChange={e => updateEntry(i, 'hourlyRate', e.target.value === '' ? undefined : parseFloat(e.target.value))} placeholder="$" className="h-7 text-xs w-20" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input value={entry.steward ?? ''} onChange={e => updateEntry(i, 'steward', e.target.value)} className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" step="0.01" value={entry.parkingCost ?? ''} onChange={e => updateEntry(i, 'parkingCost', e.target.value === '' ? undefined : parseFloat(e.target.value))} placeholder="$" className="h-7 text-xs w-20" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-between">
              <Button variant="ghost" onClick={() => setStep('paste')}>← Back</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button onClick={handleImport} disabled={isImporting}>
                  {isImporting
                    ? <><Loader2 size={14} className="mr-1 animate-spin" /> Saving...</>
                    : <><Check size={14} className="mr-1" /> Import {selected.size} Job(s)</>}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
