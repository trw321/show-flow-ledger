import { useState, useCallback } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Upload, Loader2, Check, X, FileImage } from 'lucide-react';
import { toast } from 'sonner';

interface ParsedTimeEntry {
  date: string;
  hours: number;
  client: string;
  jobName?: string;
  description: string;
  rate?: number;
  mealPenalties?: number;
}

export default function TimesheetUpload() {
  const { data, addJob, updateJob } = useData();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<ParsedTimeEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);

  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name, client: j.client }));

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10MB)'); return; }

    setLoading(true);
    setEntries([]);
    setSelected(new Set());

    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-statement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: file.type,
          type: 'timesheet',
          jobs: jobs.map(j => ({ name: j.name, client: j.client })),
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse timesheet');
      }

      const data = await resp.json();
      const parsed: ParsedTimeEntry[] = data.entries || [];
      setEntries(parsed);
      setSelected(new Set(parsed.map((_, i) => i)));
      toast[parsed.length ? 'success' : 'info'](
        parsed.length ? `Found ${parsed.length} time entry(ies)` : 'No time entries found in this image'
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to parse timesheet');
    } finally {
      setLoading(false);
    }
  }, [jobs]);

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const updateEntry = (idx: number, field: keyof ParsedTimeEntry, value: string | number) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const addSelected = () => {
    let count = 0;
    entries.forEach((entry, i) => {
      if (selected.has(i)) {
        addJob({
          name: entry.description || entry.jobName || 'Timesheet Entry',
          client: entry.client || '',
          venue: '',
          date: entry.date,
          status: 'completed',
          hourlyRate: entry.rate || 0,
          hoursWorked: entry.hours,
          mealPenalties: entry.mealPenalties || 0,
          notes: '',
        });
        count++;
      }
    });
    toast.success(`Added ${count} job(s) from timesheet`);
    setOpen(false);
    setEntries([]);
    setSelected(new Set());
    setPreview(null);
  };

  const totalHours = entries.reduce((s, e, i) => selected.has(i) ? s + e.hours : s, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEntries([]); setPreview(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Upload size={16} /> Scan Timesheet
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-mono">Scan Notes / Timesheet</DialogTitle>
        </DialogHeader>

        {!loading && entries.length === 0 && (
          <div
            onDrop={e => { e.preventDefault(); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
            onDragOver={e => e.preventDefault()}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-secondary/30 p-10 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => document.getElementById('timesheet-upload-input')?.click()}
          >
            <FileImage size={32} className="text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Drop a photo of your notes, timesheet, or call sheet</p>
            <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP • Max 10MB</p>
            <input id="timesheet-upload-input" type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center py-10">
            <Loader2 size={32} className="text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground text-mono">Analyzing timesheet...</p>
            {preview && <img src={preview} alt="Preview" className="mt-4 max-h-40 rounded-md border border-border opacity-50" />}
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="space-y-4">
            {preview && <img src={preview} alt="Timesheet" className="max-h-32 rounded-md border border-border" />}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {selected.size} of {entries.length} selected • <span className="text-mono font-medium">{totalHours.toFixed(1)}h</span>
              </p>
              <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map((_, i) => i)))}>
                {selected.size === entries.length ? 'Deselect all' : 'Select all'}
              </Button>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                    <th className="w-8 px-3 py-2"></th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Client</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Hours</th>
                    <th className="text-right px-3 py-2">Rate</th>
                    <th className="text-right px-3 py-2">MP</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <tr key={i} className={`border-t border-border transition-colors ${selected.has(i) ? 'bg-primary/5' : 'hover:bg-secondary/30'}`}>
                      <td className="px-3 py-2 text-center cursor-pointer" onClick={() => toggleSelect(i)}>
                        {selected.has(i) ? <Check size={14} className="text-primary" /> : <span className="w-3.5 h-3.5 rounded-sm border border-border inline-block" />}
                      </td>
                      <td className="px-3 py-2">
                        <input type="date" value={entry.date} onChange={e => updateEntry(i, 'date', e.target.value)} className="bg-transparent border-b border-border/50 text-xs text-mono w-28 focus:outline-none focus:border-primary" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={entry.client} onChange={e => updateEntry(i, 'client', e.target.value)} className="bg-transparent border-b border-border/50 text-sm w-full focus:outline-none focus:border-primary" />
                      </td>
                      <td className="px-3 py-2">
                        <input value={entry.description} onChange={e => updateEntry(i, 'description', e.target.value)} className="bg-transparent border-b border-border/50 text-sm text-muted-foreground w-full focus:outline-none focus:border-primary" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="0.25" min="0" value={entry.hours} onChange={e => updateEntry(i, 'hours', parseFloat(e.target.value) || 0)} className="bg-transparent border-b border-border/50 text-sm text-mono font-bold text-right w-16 focus:outline-none focus:border-primary" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" step="0.01" min="0" value={entry.rate || ''} onChange={e => updateEntry(i, 'rate', parseFloat(e.target.value) || 0)} placeholder="—" className="bg-transparent border-b border-border/50 text-sm text-mono text-right w-16 focus:outline-none focus:border-primary" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" value={entry.mealPenalties || 0} onChange={e => updateEntry(i, 'mealPenalties', parseInt(e.target.value) || 0)} className="bg-transparent border-b border-border/50 text-sm text-mono text-right w-10 focus:outline-none focus:border-primary" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setEntries([]); setPreview(null); }}><X size={14} className="mr-1" /> Cancel</Button>
              <Button onClick={addSelected} disabled={selected.size === 0}>Add {selected.size} job(s)</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
