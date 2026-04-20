import { useState, useRef, useCallback } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Upload, Loader2, Check, X, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';
import { getJobDedupKey } from '@/lib/jobDedup';
import { cn } from '@/lib/utils';

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

interface ParsedIncome {
  client: string;
  description: string;
  amount: number;
  date: string;
  status: 'pending' | 'paid' | 'overdue';
}

interface ParsedHourUpdate {
  date: string;
  startTime?: string;
  endTime?: string;
  hoursWorked?: number;
  venue?: string;
  steward?: string;
  hourlyRate?: number;
  mealType?: 'YWA' | 'NWA';
  notes?: string;
}

type ImportType = 'jobs' | 'income' | 'hours';

const TYPE_LABEL: Record<ImportType, string> = {
  jobs: 'Job History',
  income: 'Income / Payments',
  hours: 'Hours Notes',
};

function splitJobRecords(raw: string): string[] {
  const parts = raw.split(/(?=^\d{4}-\d{4}[\t ]*\r?$)/m);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

// Deterministically expand "CB M/D, M/D [optional note]" into individual records.
// Handles two paste formats from the IATSE16 site:
//   Format A (multi-line): Date on own line, then later [LineNotes]\t[Skill]\t...
//   Format B (single-line): [Date+Time]\t[LineNotes]\t[Skill]\t... all on one line
// Complex CB patterns (THRU, SAME DAY, @time) are left untouched for the AI.
function expandCBRecord(record: string): string[] {
  console.log('[expandCB] record start:', JSON.stringify(record.slice(0, 200)));
  const lines = record.split('\n');

  // Find the date line (first line matching M/D/YY)
  let dateLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\d+\/\d+\/\d{2}/.test(lines[i])) { dateLineIdx = i; break; }
  }
  if (dateLineIdx === -1) return [record];

  const dateLine = lines[dateLineIdx];
  const dateHasTabs = dateLine.includes('\t');

  // Determine data line and extract lineNotes + rest (Skill\tEmployer\t...)
  let dataLineIdx: number;
  let lineNotes: string;
  let rest: string; // leading \t + Skill\tEmployer\t...

  if (dateHasTabs) {
    // Format B: [Date+Time]\t[LineNotes]\t[Skill]\t[Employer]\t...
    dataLineIdx = dateLineIdx;
    const fields = dateLine.split('\t');
    lineNotes = (fields[1] ?? '').trim();
    rest = '\t' + fields.slice(2).join('\t');
  } else {
    // Format A: date on own line, then [LineNotes]\t[Skill]\t... on a later line
    dataLineIdx = -1;
    for (let i = dateLineIdx + 1; i < lines.length; i++) {
      if (lines[i].includes('\t')) { dataLineIdx = i; break; }
    }
    if (dataLineIdx === -1) return [record];
    const dataLine = lines[dataLineIdx];
    const firstTab = dataLine.indexOf('\t');
    const wrappedLines = lines.slice(dateLineIdx + 1, dataLineIdx).map(l => l.trim()).filter(Boolean);
    lineNotes = [...wrappedLines, dataLine.slice(0, firstTab).trim()].join(' ');
    rest = dataLine.slice(firstTab);
  }

  lineNotes = lineNotes.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  console.log('[expandCB] lineNotes:', JSON.stringify(lineNotes));

  if (!/\bCB\b/i.test(lineNotes)) { console.log('[expandCB] no CB'); return [record]; }
  if (/THRU|SAME\s*DAY|@\d/i.test(lineNotes)) { console.log('[expandCB] complex CB → AI'); return [record]; }

  const cbMatch = lineNotes.match(/^(.*?)\s*\bCB\s+((?:\d{1,2}\/\d{1,2}\s*,?\s*)+?)\s*((?:FOR|WITH|AT)\s+.+)?$/i);
  console.log('[expandCB] cbMatch:', cbMatch);
  if (!cbMatch) return [record];

  const prefix = cbMatch[1].trim();
  const datesStr = cbMatch[2].trim().replace(/,\s*$/, '');
  const trailingNote = (cbMatch[3] ?? '').trim();

  const cbDates = datesStr.split(/\s*,\s*/).map(d => d.trim()).filter(d => /^\d{1,2}\/\d{1,2}$/.test(d));
  if (cbDates.length === 0) return [record];

  const dtMatch = dateLine.match(/(\d+)\/(\d+)\/(\d{2})(?:\s+([^\t]*))?/);
  if (!dtMatch) { console.log('[expandCB] no date match'); return [record]; }
  const yr = dtMatch[3];
  const time = (dtMatch[4] ?? '').trim();

  const makeRecord = (newDateStr: string, notePfx: string) => {
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > dateLineIdx && i < dataLineIdx) continue; // drop wrapped note lines (Format A)
      if (i === dateLineIdx && dateHasTabs) {
        // Format B: rebuild the single line with new date and note
        out.push(`${newDateStr}\t${notePfx}${rest}`);
      } else if (i === dateLineIdx) {
        out.push(newDateStr);
      } else if (i === dataLineIdx) {
        out.push(notePfx + rest);
      } else {
        out.push(lines[i]);
      }
    }
    return out.join('\n');
  };

  const parentDateStr = dateHasTabs ? dateLine.split('\t')[0].trim() : dateLine;
  const parentRecord = makeRecord(parentDateStr, prefix);
  const cbRecords = cbDates.map(cbDate => {
    const [m, d] = cbDate.split('/');
    return makeRecord(`${m}/${d}/${yr}${time ? ' ' + time : ''}`, trailingNote);
  });

  console.log(`[expandCB] expanded to ${1 + cbRecords.length} records, dates:`, cbDates);
  return [parentRecord, ...cbRecords];
}

async function callAPI(url: string, key: string, body: object): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

// Resize + JPEG-compress before sending to keep payload under Supabase's body limit
// Resize + compress to keep payload small (Supabase body limit ~4MB)
function compressImage(file: File, maxPx = 800): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      console.log(`[img] compressed to ${w}x${h}, ~${Math.round(dataUrl.length * 0.75 / 1024)}KB`);
      resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

export default function SmartImport() {
  const { data, addJob, addIncome, updateJob } = useData();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [detectedType, setDetectedType] = useState<ImportType | null>(null);
  const [jobs, setJobs] = useState<ParsedJob[]>([]);
  const [income, setIncome] = useState<ParsedIncome[]>([]);
  const [hourUpdates, setHourUpdates] = useState<ParsedHourUpdate[]>([]);
  const [selectedJobs, setSelectedJobs] = useState<Set<number>>(new Set());
  const [selectedIncome, setSelectedIncome] = useState<Set<number>>(new Set());
  const [selectedHours, setSelectedHours] = useState<Set<number>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Image too large — max 10MB'); return; }
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    setText('');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleParse = async () => {
    if (!text.trim() && !imageFile) { toast.error('Paste text or drop an image'); return; }
    setIsParsing(true);
    setParseProgress('');

    try {
      let allJobs: ParsedJob[] = [];
      let allIncome: ParsedIncome[] = [];
      let allHours: ParsedHourUpdate[] = [];
      let type: ImportType = 'jobs';

      if (imageFile) {
        // Image path → smart-import with vision
        setParseProgress('Reading image...');
        const { base64: imageBase64, mimeType: imageMimeType } = await compressImage(imageFile);
        const resp = await callAPI(`${supabaseUrl}/functions/v1/smart-import`, supabaseKey, {
          imageBase64,
          imageMimeType,
        });
        if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to parse image');
        const result = await resp.json();
        type = result.type;
        allJobs = result.jobs || [];
        allIncome = result.income || [];
        allHours = result.hourUpdates || [];
      } else if (/^\d{4}-\d{4}/m.test(text)) {
        // Job text → split per record, call parse-jobs one at a time
        type = 'jobs';
        // Expand all records deterministically in JS first
        const records = splitJobRecords(text);
        const expanded: string[] = [];
        for (const rec of records) {
          const sub = expandCBRecord(rec);
          console.log(`[parse] expanded ${sub.length} sub-record(s)`);
          expanded.push(...sub);
        }

        // Batch into groups of 5 → ~4 calls for 20 records instead of 20+
        const BATCH = 5;
        const batches = Array.from({ length: Math.ceil(expanded.length / BATCH) }, (_, i) =>
          expanded.slice(i * BATCH, i * BATCH + BATCH)
        );
        for (let b = 0; b < batches.length; b++) {
          setParseProgress(`Parsing batch ${b + 1} of ${batches.length}...`);
          const resp = await callAPI(`${supabaseUrl}/functions/v1/parse-jobs`, supabaseKey, {
            text: batches[b].join('\n\n'),
          });
          if (!resp.ok) {
            console.error(`batch ${b + 1} failed:`, resp.status, await resp.json().catch(() => ({})));
            continue;
          }
          const { jobs: batchJobs = [] }: { jobs: ParsedJob[] } = await resp.json();
          allJobs.push(...batchJobs);
        }
      } else {
        // Non-job text → smart-import for classification
        setParseProgress('Classifying...');
        const resp = await callAPI(`${supabaseUrl}/functions/v1/smart-import`, supabaseKey, { text });
        if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to parse');
        const result = await resp.json();
        type = result.type;
        allJobs = result.jobs || [];
        allIncome = result.income || [];
        allHours = result.hourUpdates || [];
      }

      const total = type === 'jobs' ? allJobs.length : type === 'income' ? allIncome.length : allHours.length;
      if (total === 0) { toast.error('Nothing found to import'); return; }

      allJobs.sort((a, b) => a.date.localeCompare(b.date));
      setDetectedType(type);
      setJobs(allJobs);
      setIncome(allIncome);
      setHourUpdates(allHours);
      setSelectedJobs(new Set(allJobs.map((_, i) => i)));
      setSelectedIncome(new Set(allIncome.map((_, i) => i)));
      setSelectedHours(new Set(allHours.map((_, i) => i)));
      setStep('review');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setIsParsing(false);
      setParseProgress('');
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    let imported = 0, skipped = 0;

    try {
      if (detectedType === 'jobs') {
        const existingKeys = new Set(data.jobs.map(j => getJobDedupKey(j)));
        for (const [i, j] of jobs.entries()) {
          if (!selectedJobs.has(i)) continue;
          const draft = {
            jobNumber: j.jobNumber, name: j.name, client: j.client, venue: j.venue,
            date: j.date, startTime: j.startTime, endTime: j.endTime, status: j.status,
            payrollCompany: j.payrollCompany, hourlyRate: j.hourlyRate, steward: j.steward,
            parkingCost: j.parkingCost, notes: j.notes || '', has6th7thDayRule: false, hasVacationPay: false,
          };
          const key = getJobDedupKey(draft);
          if (existingKeys.has(key)) { skipped++; continue; }
          await addJob(draft);
          existingKeys.add(key);
          imported++;
        }
      } else if (detectedType === 'income') {
        for (const [i, inc] of income.entries()) {
          if (!selectedIncome.has(i)) continue;
          await addIncome({ client: inc.client, description: inc.description, amount: inc.amount, date: inc.date, status: inc.status });
          imported++;
        }
      } else if (detectedType === 'hours') {
        for (const [i, upd] of hourUpdates.entries()) {
          if (!selectedHours.has(i)) continue;
          const venueWords = upd.venue?.toLowerCase().split(/\s+/).filter(w => w.length > 3) ?? [];
          const match = data.jobs.find(j => {
            if (j.date !== upd.date) return false;
            if (!upd.venue) return true;
            const jv = j.venue?.toLowerCase() ?? '';
            const v = upd.venue.toLowerCase();
            // substring match
            if (jv.includes(v) || v.includes(jv)) return true;
            // word overlap — any significant word in common
            return venueWords.some(w => jv.includes(w));
          });
          if (match) {
            await updateJob(match.id, {
              startTime: upd.startTime || match.startTime,
              endTime: upd.endTime || match.endTime,
              hoursWorked: upd.hoursWorked,
              mealType: upd.mealType,
              steward: upd.steward || match.steward,
              hourlyRate: upd.hourlyRate || match.hourlyRate,
              notes: upd.notes ? (match.notes ? `${match.notes}\n${upd.notes}` : upd.notes) : match.notes,
              status: 'completed',
            });
            imported++;
          } else {
            skipped++;
          }
        }
      }

      toast.success(`Imported ${imported}${skipped ? ` • skipped ${skipped}` : ''}`);
      handleClose(false);
    } catch (err) {
      toast.error('Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setText(''); setImageFile(null); setImagePreview('');
      setStep('input'); setDetectedType(null);
      setJobs([]); setIncome([]); setHourUpdates([]);
    }
  };

  const updateJob_ = (idx: number, field: keyof ParsedJob, value: string | number | undefined) =>
    setJobs(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));

  const addCBJob = (parentIdx: number) => {
    const parent = jobs[parentIdx];
    const insertAt = parentIdx + 1;
    const cbJob: ParsedJob = { ...parent, date: '', endTime: undefined, notes: '' };
    setJobs(prev => [...prev.slice(0, insertAt), cbJob, ...prev.slice(insertAt)]);
    setSelectedJobs(prev => {
      const n = new Set<number>();
      prev.forEach(i => n.add(i >= insertAt ? i + 1 : i));
      n.add(insertAt);
      return n;
    });
  };

  const selCount = detectedType === 'jobs' ? selectedJobs.size : detectedType === 'income' ? selectedIncome.size : selectedHours.size;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button className="w-full gap-2"><Upload size={16} /> Import</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-mono">
            {step === 'input' ? 'Smart Import' : (
              <span className="flex items-center gap-2">
                Detected: <span className="text-primary">{detectedType ? TYPE_LABEL[detectedType] : ''}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  ({detectedType === 'jobs' ? jobs.length : detectedType === 'income' ? income.length : hourUpdates.length} found)
                </span>
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* ── INPUT STEP ── */}
        {step === 'input' && (
          <div className="space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => !imageFile && fileInputRef.current?.click()}
              className={cn(
                "rounded-xl border-2 border-dashed transition-colors cursor-pointer",
                isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                imageFile ? "p-2" : "p-6"
              )}
            >
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              {imageFile ? (
                <div className="flex items-center gap-3">
                  <img src={imagePreview} alt="preview" className="h-16 w-16 object-cover rounded-lg" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{imageFile.name}</p>
                    <p className="text-xs text-muted-foreground">{(imageFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setImageFile(null); setImagePreview(''); setText(''); }}
                    className="text-muted-foreground hover:text-destructive p-1">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Upload size={24} />
                  <p className="text-sm font-medium">Drop a screenshot or image here</p>
                  <p className="text-xs">Dispatch emails, schedules, bank statements, notes — anything</p>
                </div>
              )}
            </div>

            {!imageFile && (
              <>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">or paste text</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <Textarea
                  placeholder={"Paste job history, bank statement, or hours notes...\n\nThe AI will figure out what it is."}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                />
              </>
            )}

            <Button onClick={handleParse} disabled={isParsing || (!text.trim() && !imageFile)} className="w-full">
              {isParsing
                ? <><Loader2 size={14} className="mr-1 animate-spin" />{parseProgress || 'Parsing...'}</>
                : 'Parse'}
            </Button>
          </div>
        )}

        {/* ── REVIEW STEP: JOBS ── */}
        {step === 'review' && detectedType === 'jobs' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs min-w-[900px]">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-mono">
                    <th className="px-2 py-2 w-8">
                      <input type="checkbox"
                        checked={selectedJobs.size === jobs.length}
                        onChange={() => setSelectedJobs(selectedJobs.size === jobs.length ? new Set() : new Set(jobs.map((_, i) => i)))}
                        className="rounded border-border" />
                    </th>
                    {['Job #','Date','Start','End','Client','Event','Payroll','Venue','Rate','Steward','Parking',''].map(h => (
                      <th key={h} className="px-2 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((entry, i) => (
                    <tr key={i} className={cn("border-t border-border", selectedJobs.has(i) ? 'bg-primary/5' : 'opacity-50')}>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={selectedJobs.has(i)}
                          onChange={() => setSelectedJobs(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                          className="rounded border-border" />
                      </td>
                      <td className="px-2 py-1.5"><Input value={entry.jobNumber ?? ''} onChange={e => updateJob_(i, 'jobNumber', e.target.value)} className="h-7 text-xs w-20" /></td>
                      <td className="px-2 py-1.5"><Input type="date" value={entry.date} onChange={e => updateJob_(i, 'date', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.startTime ?? ''} onChange={e => updateJob_(i, 'startTime', e.target.value)} className="h-7 text-xs w-24" placeholder="08:00 AM" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.endTime ?? ''} onChange={e => updateJob_(i, 'endTime', e.target.value)} className="h-7 text-xs w-24" placeholder="05:00 PM" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.client} onChange={e => updateJob_(i, 'client', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.name} onChange={e => updateJob_(i, 'name', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.payrollCompany ?? ''} onChange={e => updateJob_(i, 'payrollCompany', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.venue} onChange={e => updateJob_(i, 'venue', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input type="number" step="0.01" value={entry.hourlyRate ?? ''} onChange={e => updateJob_(i, 'hourlyRate', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="$" className="h-7 text-xs w-20" /></td>
                      <td className="px-2 py-1.5"><Input value={entry.steward ?? ''} onChange={e => updateJob_(i, 'steward', e.target.value)} className="h-7 text-xs" /></td>
                      <td className="px-2 py-1.5"><Input type="number" step="0.01" value={entry.parkingCost ?? ''} onChange={e => updateJob_(i, 'parkingCost', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="$" className="h-7 text-xs w-20" /></td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => addCBJob(i)} title="Add callback" className="text-muted-foreground hover:text-primary transition-colors p-0.5 rounded">
                          <Plus size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-between">
              <Button variant="ghost" onClick={() => setStep('input')}>← Back</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button onClick={handleImport} disabled={isImporting || selCount === 0}>
                  {isImporting ? <><Loader2 size={14} className="mr-1 animate-spin" />Saving...</> : <><Check size={14} className="mr-1" />Import {selCount}</>}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── REVIEW STEP: INCOME ── */}
        {step === 'review' && detectedType === 'income' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-mono">
                    <th className="px-2 py-2 w-8">
                      <input type="checkbox"
                        checked={selectedIncome.size === income.length}
                        onChange={() => setSelectedIncome(selectedIncome.size === income.length ? new Set() : new Set(income.map((_, i) => i)))}
                        className="rounded border-border" />
                    </th>
                    {['Date','Client','Description','Amount'].map(h => (
                      <th key={h} className="px-2 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {income.map((inc, i) => (
                    <tr key={i} className={cn("border-t border-border", selectedIncome.has(i) ? 'bg-primary/5' : 'opacity-50')}>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={selectedIncome.has(i)}
                          onChange={() => setSelectedIncome(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                          className="rounded border-border" />
                      </td>
                      <td className="px-2 py-1.5 text-mono">{inc.date}</td>
                      <td className="px-2 py-1.5 font-medium">{inc.client}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{inc.description}</td>
                      <td className="px-2 py-1.5 text-mono font-bold text-success">${inc.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-between">
              <Button variant="ghost" onClick={() => setStep('input')}>← Back</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button onClick={handleImport} disabled={isImporting || selCount === 0}>
                  {isImporting ? <><Loader2 size={14} className="mr-1 animate-spin" />Saving...</> : <><Check size={14} className="mr-1" />Import {selCount}</>}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── REVIEW STEP: HOURS ── */}
        {step === 'review' && detectedType === 'hours' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground uppercase tracking-wider text-mono">
                    <th className="px-2 py-2 w-8">
                      <input type="checkbox"
                        checked={selectedHours.size === hourUpdates.length}
                        onChange={() => setSelectedHours(selectedHours.size === hourUpdates.length ? new Set() : new Set(hourUpdates.map((_, i) => i)))}
                        className="rounded border-border" />
                    </th>
                    {['Date','Start','End','Hours','Meal','Venue','Notes','Matched Job'].map(h => (
                      <th key={h} className="px-2 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hourUpdates.map((upd, i) => {
                    const vWords = upd.venue?.toLowerCase().split(/\s+/).filter(w => w.length > 3) ?? [];
                    const match = data.jobs.find(j => {
                      if (j.date !== upd.date) return false;
                      if (!upd.venue) return true;
                      const jv = j.venue?.toLowerCase() ?? '';
                      const v = upd.venue.toLowerCase();
                      if (jv.includes(v) || v.includes(jv)) return true;
                      return vWords.some(w => jv.includes(w));
                    });
                    return (
                      <tr key={i} className={cn("border-t border-border", selectedHours.has(i) ? 'bg-primary/5' : 'opacity-50')}>
                        <td className="px-2 py-1.5 text-center">
                          <input type="checkbox" checked={selectedHours.has(i)}
                            onChange={() => setSelectedHours(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                            className="rounded border-border" />
                        </td>
                        <td className="px-2 py-1.5 text-mono">{upd.date}</td>
                        <td className="px-2 py-1.5 text-mono">{upd.startTime ?? '—'}</td>
                        <td className="px-2 py-1.5 text-mono">{upd.endTime ?? '—'}</td>
                        <td className="px-2 py-1.5 text-mono font-semibold">{upd.hoursWorked?.toFixed(1) ?? '—'}</td>
                        <td className="px-2 py-1.5">{upd.mealType ?? '—'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{upd.venue ?? '—'}</td>
                        <td className="px-2 py-1.5 text-muted-foreground max-w-[160px]">
                          {upd.notes
                            ? <span className={upd.notes.includes('verify') ? 'text-amber-500' : ''}>{upd.notes}</span>
                            : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          {match
                            ? <span className="text-success font-medium">{match.name}</span>
                            : <span className="text-destructive text-[10px]">No match</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground px-1">Hours are matched to existing jobs by date and venue. "No match" rows will be skipped.</p>
            <div className="flex gap-2 justify-between">
              <Button variant="ghost" onClick={() => setStep('input')}>← Back</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button onClick={handleImport} disabled={isImporting || selCount === 0}>
                  {isImporting ? <><Loader2 size={14} className="mr-1 animate-spin" />Saving...</> : <><Check size={14} className="mr-1" />Update {selCount}</>}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
