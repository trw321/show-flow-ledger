import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ClipboardPaste, Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';

interface ParsedJob {
  name: string;
  client: string;
  venue: string;
  date: string;
  status: Job['status'];
  hourlyRate?: number;
  notes?: string;
}

export default function JobPasteImport({ onImport }: { onImport: (job: Omit<Job, 'id' | 'createdAt'>) => void }) {
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

  const updateEntry = (idx: number, field: keyof ParsedJob, value: string | number) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleImport = () => {
    const toImport = entries.filter((_, i) => selected.has(i));
    if (toImport.length === 0) { toast.error('Select at least one job'); return; }
    toImport.forEach(j => {
      onImport({
        name: j.name,
        client: j.client,
        venue: j.venue,
        date: j.date,
        status: j.status,
        hourlyRate: j.hourlyRate,
        notes: j.notes || '',
        has6th7thDayRule: false,
      });
    });
    toast.success(`Imported ${toImport.length} job(s)`);
    setOpen(false);
    setText('');
    setEntries([]);
    setStep('paste');
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-mono">Paste Job History</DialogTitle></DialogHeader>

        {step === 'paste' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Copy & paste job history from a website, spreadsheet, email, or notes. AI will parse it into jobs.
            </p>
            <Textarea
              placeholder={"Paste job history here...\n\nExamples:\n- A table copied from a website\n- A list from an email\n- Spreadsheet rows\n- Any text with job details"}
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
              <table className="w-full text-xs">
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
                    <th className="px-2 py-2 text-left">Name</th>
                    <th className="px-2 py-2 text-left">Client</th>
                    <th className="px-2 py-2 text-left">Venue</th>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <tr key={i} className={`border-t border-border ${selected.has(i) ? 'bg-primary/5' : 'opacity-50'}`}>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggleSelect(i)}
                          className="rounded border-border"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={entry.name}
                          onChange={e => updateEntry(i, 'name', e.target.value)}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={entry.client}
                          onChange={e => updateEntry(i, 'client', e.target.value)}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={entry.venue}
                          onChange={e => updateEntry(i, 'venue', e.target.value)}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="date"
                          value={entry.date}
                          onChange={e => updateEntry(i, 'date', e.target.value)}
                          className="h-7 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          step="0.01"
                          value={entry.hourlyRate ?? ''}
                          onChange={e => updateEntry(i, 'hourlyRate', parseFloat(e.target.value) || 0)}
                          placeholder="$"
                          className="h-7 text-xs w-20"
                        />
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
                <Button onClick={handleImport}>
                  <Check size={14} className="mr-1" /> Import {selected.size} Job(s)
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
