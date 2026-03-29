import { useState, useRef } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Camera, Loader2, Check, ImagePlus } from 'lucide-react';
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

export default function JobPhotoImport({ onImport, externalOpen, onExternalOpenChange }: { onImport: (job: Omit<Job, 'id' | 'createdAt'>) => void; externalOpen?: boolean; onExternalOpenChange?: (open: boolean) => void }) {
  const { data: appData } = useData();
  const isControlled = externalOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => { if (isControlled) onExternalOpenChange?.(v); else setInternalOpen(v); };
  const [preview, setPreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null);
  const [entries, setEntries] = useState<ParsedJob[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      const base64 = dataUrl.split(',')[1];
      setImageData({ base64, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const handleParse = async () => {
    if (!imageData) { toast.error('Upload an image first'); return; }
    setIsParsing(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(`${supabaseUrl}/functions/v1/parse-job-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify(imageData),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse image');
      }
      const data = await resp.json();
      const jobs: ParsedJob[] = data.jobs || [];
      if (jobs.length === 0) { toast.error('No jobs found in image'); return; }
      setEntries(jobs);
      setSelected(new Set(jobs.map((_, i) => i)));
      setStep('review');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse image');
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

    const existingKeys = new Set(appData.jobs.map(job => getJobDedupKey(job)));
    let imported = 0;
    let skipped = 0;

    toImport.forEach(j => {
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

      if (existingKeys.has(key)) {
        skipped++;
        return;
      }

      existingKeys.add(key);
      onImport(draft);
      imported++;
    });

    if (imported === 0) {
      toast.error('All selected jobs were already imported');
      return;
    }

    toast.success(`Imported ${imported} job(s)${skipped ? ` • skipped ${skipped} duplicate(s)` : ''}`);
    handleClose(false);
  };

  const handleClose = (o: boolean) => {
    setOpen(o);
    if (!o) { setPreview(null); setImageData(null); setEntries([]); setStep('upload'); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Camera size={16} className="mr-1" /> Photo Import</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-mono">Import from Photo</DialogTitle></DialogHeader>

        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a screenshot or photo of a dispatch email, schedule, or call sheet. AI will extract the job details.
            </p>

            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {preview ? (
                <img src={preview} alt="Preview" className="max-h-64 mx-auto rounded-md" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <ImagePlus size={40} />
                  <p className="text-sm">Drop an image here or click to browse</p>
                  <p className="text-xs">Supports JPG, PNG, WEBP — max 10MB</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleParse} disabled={isParsing || !imageData}>
                {isParsing ? <><Loader2 size={14} className="mr-1 animate-spin" /> Parsing...</> : 'Extract Jobs'}
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
                      <input type="checkbox" checked={selected.size === entries.length}
                        onChange={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map((_, i) => i)))}
                        className="rounded border-border" />
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
                    <tr key={i} className={`border-t border-border ${selected.has(i) ? 'bg-primary/5' : 'opacity-50'}`}>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelect(i)} className="rounded border-border" />
                      </td>
                      <td className="px-2 py-1.5"><Input value={entry.jobNumber ?? ''} onChange={e => updateEntry(i, 'jobNumber', e.target.value)} className="h-7 text-xs w-16" /></td>
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
              <Button variant="ghost" onClick={() => setStep('upload')}>← Back</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button onClick={handleImport}><Check size={14} className="mr-1" /> Import {selected.size} Job(s)</Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
