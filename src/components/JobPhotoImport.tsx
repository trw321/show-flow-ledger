import { useState, useRef, useCallback, useEffect } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

export default function JobPhotoImport({
  onImport,
}: {
  onImport: (job: Omit<Job, 'id' | 'createdAt'>) => Promise<void>;
}) {
  const { data: appData } = useData();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [entries, setEntries] = useState<ParsedJob[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const fileRef = useRef<HTMLInputElement>(null);

  const openFilePicker = useCallback(() => {
    if (isParsing || isImporting) return;
    fileRef.current?.click();
  }, [isImporting, isParsing]);

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

  const parseImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10MB');
      return;
    }

    setOpen(true);
    setStep('upload');
    setEntries([]);
    setSelected(new Set());

    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    setIsParsing(true);

    try {
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
    if (file) void parseImage(file);
  }, [parseImage]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void parseImage(file);
    e.currentTarget.value = '';
  };

  const updateEntry = (idx: number, field: keyof ParsedJob, value: string | number) => {
    setEntries(prev => prev.map((entry, i) => i === idx ? { ...entry, [field]: value } : entry));
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
    if (toImport.length === 0) {
      toast.error('Select at least one job');
      return;
    }

    setIsImporting(true);
    const existingKeys = new Set(appData.jobs.map(job => getJobDedupKey(job)));
    let imported = 0;

    try {
      for (const job of toImport) {
        const draft = {
          jobNumber: job.jobNumber,
          name: job.name,
          client: job.client,
          venue: job.venue,
          date: job.date,
          startTime: job.startTime,
          endTime: job.endTime,
          status: job.status,
          payrollCompany: job.payrollCompany,
          hourlyRate: job.hourlyRate,
          steward: job.steward,
          parkingCost: job.parkingCost,
          notes: job.notes || '',
          has6th7thDayRule: false,
          hasVacationPay: false,
        };
        const key = getJobDedupKey(draft);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);

        try {
          await onImport(draft);
          imported++;
        } catch (err) {
          console.error('Failed to save job:', job.name, err);
          toast.error(`Failed to save "${job.name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
    } finally {
      setIsImporting(false);
    }

    handleClose(false);

    if (imported === 0) {
      toast('Already got that one!', {
        description: 'This job is already in your log.',
        duration: 2500,
      });
    } else {
      toast.success(`${imported} job${imported !== 1 ? 's' : ''} saved!`);
    }
  };

  const handleClose = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setTimeout(() => {
        setPreview(null);
        setEntries([]);
        setSelected(new Set());
        setStep('upload');
        setIsParsing(false);
        setIsDragOver(false);
      }, 200);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={isParsing || isImporting}
        onChange={handleFileChange}
      />

      <div
        onClick={openFilePicker}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        className={`w-full flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 cursor-pointer transition-all
          ${isDragOver ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-secondary/30'}`}
      >
        <div className={`rounded-full p-4 transition-colors ${isDragOver ? 'bg-primary/20' : 'bg-secondary'}`}>
          <Camera size={32} className={isDragOver ? 'text-primary' : 'text-muted-foreground'} />
        </div>
        <div className="text-center">
          <p className="font-semibold text-sm">{isDragOver ? 'Drop to scan' : 'Import Jobs from Photo'}</p>
          <p className="text-xs text-muted-foreground mt-1">Tap or drag a dispatch email, call sheet, or schedule screenshot</p>
          <p className="text-xs text-primary font-medium mt-2">AI extracts all jobs automatically</p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-mono">Import Jobs from Photo</DialogTitle>
          </DialogHeader>

          {step === 'upload' && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => !isParsing && openFilePicker()}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && !isParsing) {
                  e.preventDefault();
                  openFilePicker();
                }
              }}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-all min-h-[220px]
                ${isParsing ? 'cursor-wait pointer-events-none' : 'cursor-pointer'}
                ${isDragOver ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-border hover:border-primary/50 hover:bg-secondary/30'}`}
            >
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
                  <p className="text-sm font-medium">Drop image or tap to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Screenshot, photo, call sheet — JPG, PNG, WEBP · max 10MB</p>
                  <p className="text-xs text-primary mt-3 font-medium">AI will extract jobs automatically</p>
                </>
              )}
            </div>
          )}

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
                <Button variant="ghost" size="sm" type="button" onClick={openFilePicker}>
                  ← Try another image
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" type="button" onClick={() => handleClose(false)}>Cancel</Button>
                  <Button type="button" onClick={handleImport} disabled={selected.size === 0 || isImporting}>
                    {isImporting
                      ? <><Loader2 size={14} className="mr-1 animate-spin" /> Saving...</>
                      : <><Check size={14} className="mr-1" /> Import {selected.size} Job{selected.size !== 1 ? 's' : ''}</>}
                  </Button>
                </div>
              </div>
            </div>
          )}

        </DialogContent>
      </Dialog>
    </>
  );
}
