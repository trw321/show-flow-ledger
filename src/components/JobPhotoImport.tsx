import { useState, useRef, useCallback, useEffect } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Camera, Loader2, Check, ImagePlus, CheckCircle2 } from 'lucide-react';
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

export default function JobPhotoImport({
  onImport,
  externalOpen,
  onExternalOpenChange,
}: {
  onImport: (job: Omit<Job, 'id' | 'createdAt'>) => Promise<void>;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}) {
  const { data: appData } = useData();
  const isControlled = externalOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => { if (isControlled) onExternalOpenChange?.(v); else setInternalOpen(v); };

  const [preview, setPreview] = useState<string | null>(null);
  const [entries, setEntries] = useState<ParsedJob[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload');
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  // Prevent browser from navigating to dropped files anywhere on the page
  useEffect(() => {
    if (!open) return;
    const prevent = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    document.addEventListener('dragover', prevent);
    document.addEventListener('drop', prevent);
    return () => {
      document.removeEventListener('dragover', prevent);
      document.removeEventListener('drop', prevent);
    };
  }, [open]);

  // Auto-open file picker when dialog is opened externally (e.g. from EmptyState)
  useEffect(() => {
    if (open && isControlled && step === 'upload' && !isParsing && fileRef.current) {
      // Small delay to let the dialog render first
      const t = setTimeout(() => fileRef.current?.click(), 150);
      return () => clearTimeout(t);
    }
  }, [open, isControlled, step, isParsing]);

  const parseImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Image must be under 10MB'); return; }

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    setIsParsing(true);
    setEntries([]);

    try {
      // Convert to base64
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-job-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ base64, mimeType: file.type }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse image');
      }

      const data = await resp.json();
      const jobs: ParsedJob[] = data.jobs || [];

      if (jobs.length === 0) {
        toast.error('No jobs found in this image');
        setIsParsing(false);
        return;
      }

      setEntries(jobs);
      setSelected(new Set(jobs.map((_, i) => i)));
      setStep('review');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse image');
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseImage(file);
  }, [parseImage]);

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

  const handleImport = async () => {
    const toImport = entries.filter((_, i) => selected.has(i));
    if (toImport.length === 0) { toast.error('Select at least one job'); return; }

    setIsImporting(true);
    const existingKeys = new Set(appData.jobs.map(job => getJobDedupKey(job)));
    let imported = 0;
    let skipped = 0;

    try {
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
        existingKeys.add(key);
        try {
          await onImport(draft);
          imported++;
        } catch (err) {
          console.error('Failed to save job:', j.name, err);
          toast.error(`Failed to save "${j.name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
          skipped++;
        }
      }
    } finally {
      setIsImporting(false);
    }

    if (imported === 0) {
      toast.error('All selected jobs already exist or could not be saved');
      return;
    }

    setImportedCount(imported);
    setStep('done');
  };

  const handleClose = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setTimeout(() => {
        setPreview(null);
        setEntries([]);
        setStep('upload');
        setImportedCount(0);
        setIsParsing(false);
      }, 200);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Camera size={16} className="mr-1" /> Photo Import</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-mono">Import Jobs from Photo</DialogTitle>
        </DialogHeader>

        {/* ── Upload / Parsing ── */}
        {step === 'upload' && (
          <label
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-all min-h-[220px]
              ${isParsing ? 'cursor-wait pointer-events-none' : 'cursor-pointer'}
              ${isDragOver ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-secondary/30'}`}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isParsing}
              onChange={e => { const f = e.target.files?.[0]; if (f) { parseImage(f); e.currentTarget.value = ''; } }}
            />

            {isParsing ? (
              <>
                {preview && <img src={preview} alt="Preview" className="max-h-32 rounded-md mb-4 opacity-60" />}
                <Loader2 size={28} className="text-primary animate-spin mb-3" />
                <p className="text-sm font-medium text-primary">Analyzing image...</p>
                <p className="text-xs text-muted-foreground mt-1">AI is extracting job details</p>
              </>
            ) : (
              <>
                <div className={`rounded-full p-4 mb-3 transition-colors ${isDragOver ? 'bg-primary/20' : 'bg-secondary'}`}>
                  <ImagePlus size={28} className={isDragOver ? 'text-primary' : 'text-muted-foreground'} />
                </div>
                <p className="text-sm font-medium">{isDragOver ? 'Drop to scan' : 'Drop image or tap to browse'}</p>
                <p className="text-xs text-muted-foreground mt-1">Screenshot, photo, call sheet — JPG, PNG, WEBP · max 10MB</p>
                <p className="text-xs text-primary mt-3 font-medium">AI will extract jobs automatically</p>
              </>
            )}
          </label>
        )}

        {/* ── Review ── */}
        {step === 'review' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {preview && <img src={preview} alt="Source" className="h-12 w-12 rounded-md object-cover border border-border" />}
                <div>
                  <p className="text-sm font-medium">Found {entries.length} job{entries.length !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-muted-foreground">Edit any fields below, then import</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                <button
                  onClick={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map((_, i) => i)))}
                  className="text-xs text-primary hover:underline"
                >
                  {selected.size === entries.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs min-w-[900px]">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-mono">
                    <th className="px-2 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selected.size === entries.length}
                        onChange={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map((_, i) => i)))}
                        className="rounded border-border accent-primary"
                      />
                    </th>
                    <th className="px-2 py-2 text-left">Job #</th>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">Start</th>
                    <th className="px-2 py-2 text-left">End</th>
                    <th className="px-2 py-2 text-left">Client</th>
                    <th className="px-2 py-2 text-left">Event</th>
                    <th className="px-2 py-2 text-left">Venue</th>
                    <th className="px-2 py-2 text-left">Rate</th>
                    <th className="px-2 py-2 text-left">Steward</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <tr
                      key={i}
                      className={`border-t border-border transition-colors ${selected.has(i) ? 'bg-primary/5' : 'opacity-40'}`}
                    >
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelect(i)} className="rounded border-border accent-primary" />
                      </td>
                      <td className="px-2 py-1.5"><Input value={entry.jobNumber ?? ''} onChange={e => updateEntry(i, 'jobNumber', e.target.value)} className="h-7 text-xs w-20" /></td>
                      <td className="px-2 py-1.5"><Input type="date" value={entry.date} onChange={e => updateEntry(i, 'date', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.startTime ?? ''} onChange={e => updateEntry(i, 'startTime', e.target.value)} className="h-7 text-xs w-20" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.endTime ?? ''} onChange={e => updateEntry(i, 'endTime', e.target.value)} className="h-7 text-xs w-20" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.client} onChange={e => updateEntry(i, 'client', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.name} onChange={e => updateEntry(i, 'name', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.venue} onChange={e => updateEntry(i, 'venue', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input type="number" step="0.01" value={entry.hourlyRate ?? ''} onChange={e => updateEntry(i, 'hourlyRate', parseFloat(e.target.value) || 0)} className="h-7 text-xs w-20" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.steward ?? ''} onChange={e => updateEntry(i, 'steward', e.target.value)} className="h-7 text-xs" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 justify-between">
              <Button variant="ghost" size="sm" onClick={() => { setStep('upload'); setEntries([]); setPreview(null); }}>
                ← Try another image
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleClose(false)}>Cancel</Button>
                <Button onClick={handleImport} disabled={selected.size === 0 || isImporting}>
                  {isImporting
                    ? <><Loader2 size={14} className="mr-1 animate-spin" /> Saving...</>
                    : <><Check size={14} className="mr-1" /> Import {selected.size} Job{selected.size !== 1 ? 's' : ''}</>}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Done ── */}
        {step === 'done' && (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="rounded-full bg-success/15 p-4">
              <CheckCircle2 size={40} className="text-success" />
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">{importedCount} job{importedCount !== 1 ? 's' : ''} saved</p>
              <p className="text-sm text-muted-foreground mt-1">Added to your calendar and job log</p>
            </div>
            <div className="flex gap-2 mt-2">
              <Button variant="outline" onClick={() => { setStep('upload'); setEntries([]); setPreview(null); setImportedCount(0); }}>
                Import another
              </Button>
              <Button onClick={() => handleClose(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
