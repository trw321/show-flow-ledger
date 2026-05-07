import { useState, useRef, useCallback } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Upload, Loader2, Check, X } from 'lucide-react';
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

// ─── CB expansion helpers ────────────────────────────────────────────────────

function toAmPm(s: string): string {
  const u = s.toUpperCase();
  return u === 'A' ? 'AM' : u === 'P' ? 'PM' : u;
}

function normTime(t: string): string {
  t = t.replace(/[Oo]/g, '0').trim();
  let m: RegExpMatchArray | null;
  // HH:MM(AM|PM)
  m = t.match(/^@?(\d{1,2}):(\d{2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]} ${toAmPm(m[3])}`;
  // HHMM(AM|PM)
  m = t.match(/^@?(\d{1,2})(\d{2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]} ${toAmPm(m[3])}`;
  // HH(AM|PM)
  m = t.match(/^@?(\d{1,2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:00 ${toAmPm(m[2])}`;
  // 4-digit 24h e.g. 0800
  m = t.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = parseInt(m[1]);
    if (h < 24) {
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${String(h12).padStart(2, '0')}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
    }
  }
  return t;
}

function isTimeToken(tok: string): boolean {
  const c = tok.replace(/[Oo]/g, '0');
  return (
    /^@?\d{1,2}(?::\d{2})?\s*(?:A(?:M)?|P(?:M)?)$/i.test(c) ||
    /^@?\d{1,2}\d{2}\s*(?:A(?:M)?|P(?:M)?)$/i.test(c) ||
    /^\d{4}$/.test(c)
  );
}

// Deterministically expand all CB patterns into individual records so the AI
// only ever receives simple single-job records with no CB logic to handle.
//
// Handles both paste formats from the IATSE16 site:
//   Format A (multi-line): Job# / Date / blank / [LineNotes]\t[Skill]\t...
//   Format B (single-line): Job# / [Date+Time]\t[LineNotes]\t[Skill]\t...
//
// Supported CB patterns:
//   "CB 3/18, 3/20"                          → extra job per date
//   "CB 3/24, 3/25 FOR LOAD OUT"             → CB jobs + trailing note on both
//   "CB THRU 10/7"                            → range from parent+1 through 10/7
//   "CB THRU 10/7 THEN 10/17 & 10/18 note"  → range + extra dates + note
//   "CB THRU 5/30, DARK 5/27"               → range skipping DARK dates
//   "CB 3/15 @10A FOR LOAD OUT"             → explicit time on CB date
//   "SAME DAY CB, 10PM FOR LOAD OUT"        → second job same date, new time
//   "CB @ 10PM" / "CB, 10PM"               → same-day CB at that time
//   "CB FOR OUT" / bare "CB"               → same-day CB, time TBD
//   "CB LOAD OUT 5/21"                      → future-dated CB, time TBD
function expandCBRecord(record: string): string[] {
  const lines = record.split('\n');

  // Find the date line (first line with M/D/YY)
  let dateLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\d+\/\d+\/\d{2}/.test(lines[i])) { dateLineIdx = i; break; }
  }
  if (dateLineIdx === -1) return [record];

  const dateLine = lines[dateLineIdx];
  const dateHasTabs = dateLine.includes('\t');

  // Extract lineNotes and rest (\t[Skill]\t[Employer]\t...)
  let dataLineIdx: number;
  let lineNotes: string;
  let rest: string;

  if (dateHasTabs) {
    // Format B: everything on the date line
    dataLineIdx = dateLineIdx;
    const fields = dateLine.split('\t');
    lineNotes = (fields[1] ?? '').trim();
    rest = '\t' + fields.slice(2).join('\t');
  } else {
    // Format A: find the first tab-containing line after the date
    dataLineIdx = -1;
    for (let i = dateLineIdx + 1; i < lines.length; i++) {
      if (lines[i].includes('\t')) { dataLineIdx = i; break; }
    }
    if (dataLineIdx === -1) {
      // No tab columns — treat all remaining lines as lineNotes (partial paste / test input)
      lineNotes = lines.slice(dateLineIdx + 1).map(l => l.trim()).filter(Boolean).join(' ');
      rest = '';
      dataLineIdx = lines.length; // sentinel: makeRecord drops all lines after date
    } else {
      const dataLine = lines[dataLineIdx];
      const firstTab = dataLine.indexOf('\t');
      const wrapped = lines.slice(dateLineIdx + 1, dataLineIdx).map(l => l.trim()).filter(Boolean);
      lineNotes = [...wrapped, dataLine.slice(0, firstTab).trim()].join(' ');
      rest = dataLine.slice(firstTab);
    }
  }

  lineNotes = lineNotes.replace(/\r/g, '').replace(/\s+/g, ' ').trim();

  if (!/\bC\/?B\b/i.test(lineNotes)) return [record];
  // "NO CB" / "ONE DAY NO CB" — CB keyword present but negated, not a callback
  if (/\bNO\s+C\/?B\b/i.test(lineNotes)) return [record];

  // Parse parent date
  const dtMatch = dateLine.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+([^\t\n]*))/);
  if (!dtMatch) return [record];
  const parentM = parseInt(dtMatch[1]);
  const parentD = parseInt(dtMatch[2]);
  const yr = dtMatch[3];
  const fullYr = 2000 + parseInt(yr);
  const parentTime = (dtMatch[4] ?? '').trim();
  const parentDate = new Date(fullYr, parentM - 1, parentD);
  const parentDateOnly = `${parentM}/${parentD}/${yr}`;

  // Split into prefix (before CB) and cbContent (after CB keyword)
  const cbKeyMatch = lineNotes.match(/^(.*?)\s*\bC\/?B(?:'?[Ss])?\b[,\s]*/i);
  if (!cbKeyMatch) return [record];
  const prefix = cbKeyMatch[1].trim();
  let cbContent = lineNotes.slice(cbKeyMatch[0].length).trim();

  // Strip optional "SAME DAY" prefix and leading comma
  cbContent = cbContent.replace(/^SAME\s*DAY\s*,?\s*/i, '').replace(/^@\s*/, '').replace(/^,\s*/, '').trim();

  const parseMD = (md: string): Date => {
    const [m, d] = md.split('/').map(Number);
    return new Date(fullYr, m - 1, d);
  };
  const fmtDate = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}/${yr}`;

  // Rebuild a record with a new date, lineNotes prefix, and optional time override
  const makeRecord = (dateOnly: string, notePfx: string, timeOverride?: string): string => {
    const tPart = timeOverride !== undefined ? timeOverride : parentTime;
    const dateTime = tPart ? `${dateOnly} ${tPart}` : dateOnly;
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!dateHasTabs && i > dateLineIdx && i < dataLineIdx) continue;
      if (i === dateLineIdx && dateHasTabs) {
        out.push(`${dateTime}\t${notePfx}${rest}`);
      } else if (i === dateLineIdx) {
        out.push(dateTime);
      } else if (!dateHasTabs && i === dataLineIdx) {
        out.push(notePfx + rest);
      } else {
        out.push(lines[i]);
      }
    }
    // sentinel case: no tab columns — append notePfx as plain line if non-empty
    if (!dateHasTabs && dataLineIdx >= lines.length && notePfx) out.push(notePfx);
    return out.join('\n');
  };

  type CBEntry = { date: Date; time?: string; note?: string };
  const cbEntries: CBEntry[] = [];

  const hasLeadingDate = /^\d{1,2}\/\d{1,2}/.test(cbContent);
  const hasThru = /^THRU\b/i.test(cbContent);

  if (hasThru) {
    // ── THRU range ──────────────────────────────────────────────────────────
    const thruM = cbContent.match(/^THRU\s+(\d{1,2}\/\d{1,2})(.*)/i)!;
    const thruEnd = parseMD(thruM[1]);
    let rem = thruM[2].trim();

    // Extract DARK (skip) dates
    const dark = new Set<string>();
    rem = rem.replace(/,?\s*\bDARK\s+(\d{1,2}\/\d{1,2})/gi, (_: string, d: string) => {
      dark.add(d.trim()); return '';
    }).trim();

    // Expand range: day after parent through thruEnd
    const cur = new Date(parentDate);
    cur.setDate(cur.getDate() + 1);
    while (cur <= thruEnd) {
      const md = `${cur.getMonth() + 1}/${cur.getDate()}`;
      if (!dark.has(md)) cbEntries.push({ date: new Date(cur) });
      cur.setDate(cur.getDate() + 1);
    }

    // THEN / AND block: additional dates after the range
    const thenMatch = rem.match(/\b(THEN|AND)\b(.*)/i);
    if (thenMatch) {
      // Normalize "AT time" → "@time" so isTimeToken catches it
      const thenPart = thenMatch[2].trim().replace(/\bAT\s+/gi, '@');
      const parts = thenPart.split(/\s*,\s*/);
      let trailingTime: string | undefined;
      let trailingNote: string | undefined;
      const thenEntries: CBEntry[] = [];
      for (const part of parts) {
        const dm = part.match(/^(\d{1,2}\/\d{1,2})(.*)/);
        if (!dm) continue;
        let rem2 = dm[2].trim();
        let timeOverride: string | undefined;
        const atM = rem2.match(/^(@\S+)\s*(.*)/);
        if (atM && isTimeToken(atM[1])) {
          timeOverride = normTime(atM[1]);
          trailingTime = timeOverride;
          rem2 = atM[2].trim();
        }
        if (rem2) trailingNote = rem2;
        thenEntries.push({ date: parseMD(dm[1]), time: timeOverride, note: rem2 || undefined });
      }
      // Apply trailing time/note retroactively
      for (const e of thenEntries) {
        if (!e.time && trailingTime) e.time = trailingTime;
        if (!e.note && trailingNote) e.note = trailingNote;
      }
      cbEntries.push(...thenEntries);
    } else {
      // Trailing note applies to all THRU dates
      const noteM = rem.match(/\b(FOR|WITH)\b\s*(.+)/i);
      if (noteM) for (const e of cbEntries) e.note = noteM[0].trim();
    }

  } else if (hasLeadingDate) {
    // ── Comma-separated date list ────────────────────────────────────────────
    const parts = cbContent.split(/\s*,\s*/);
    let trailingNote = '';

    for (const part of parts) {
      const dm = part.match(/^(\d{1,2}\/\d{1,2})(.*)/);
      if (!dm) { if (part.trim()) trailingNote = part.trim(); continue; }

      let rem2 = dm[2].trim();
      let timeOverride: string | undefined;

      // @time immediately after the date
      const atM = rem2.match(/^(@\S+)\s*(.*)/);
      if (atM && isTimeToken(atM[1])) {
        timeOverride = normTime(atM[1]);
        rem2 = atM[2].trim();
      }
      if (rem2) trailingNote = rem2;
      cbEntries.push({ date: parseMD(dm[1]), time: timeOverride, note: rem2 || undefined });
    }

    // Trailing note applies retroactively to all entries that don't have one
    if (trailingNote) for (const e of cbEntries) if (!e.note) e.note = trailingNote;

  } else {
    // ── Same-day CB ──────────────────────────────────────────────────────────
    let timeOverride: string | undefined;
    let note: string | undefined;
    // "CB LOAD OUT 5/21" — description with trailing date → future-dated CB, time TBD
    const trailingDateM = cbContent.match(/^(.+)\s+(\d{1,2}\/\d{1,2})\s*$/);
    if (trailingDateM) {
      cbEntries.push({ date: parseMD(trailingDateM[2]), time: '', note: trailingDateM[1].trim() || undefined });
    } else {
      const tokM = cbContent.match(/^(@?\S+)\s*(.*)/);
      if (tokM && isTimeToken(tokM[1])) {
        timeOverride = normTime(tokM[1]);
        note = tokM[2].trim() || undefined;
      } else {
        note = cbContent || undefined;
      }
      cbEntries.push({ date: new Date(parentDate), time: timeOverride, note });
    }
  }

  if (cbEntries.length === 0) return [record];

  const parentRecord = makeRecord(parentDateOnly, prefix);
  const cbRecords = cbEntries.map(e => makeRecord(fmtDate(e.date), e.note ?? '', e.time));
  console.log(`[expandCB] ${record.slice(0, 9)} → ${1 + cbRecords.length} records`);
  return [parentRecord, ...cbRecords];
}

// ─── Image compression ───────────────────────────────────────────────────────

// Resize + JPEG-compress before upload to stay under Supabase's body limit (~4MB)
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
      canvas.width = w; canvas.height = h;
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

// ─── API helper ──────────────────────────────────────────────────────────────

async function callAPI(url: string, key: string, body: object): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
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
        // Image path → compress then send to smart-import with vision
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
        // Job text → expand all CB records in JS, then batch to parse-jobs (5 per call)
        type = 'jobs';
        const records = splitJobRecords(text);
        const expanded: string[] = [];
        for (const rec of records) expanded.push(...expandCBRecord(rec));

        const BATCH = 5;
        const batches: string[][] = [];
        for (let i = 0; i < expanded.length; i += BATCH) batches.push(expanded.slice(i, i + BATCH));

        for (let b = 0; b < batches.length; b++) {
          setParseProgress(`Parsing ${b + 1} of ${batches.length}...`);
          const resp = await callAPI(`${supabaseUrl}/functions/v1/parse-jobs`, supabaseKey, {
            text: batches[b].join('\n\n'),
          });
          if (!resp.ok) { console.error(`batch ${b + 1} failed:`, resp.status); continue; }
          const batchData = await resp.json();
          allJobs.push(...(batchData.jobs || []));
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

      // Warn about dates with multiple jobs (double-booked callbacks)
      if (type === 'jobs') {
        const dateCounts = new Map<string, number>();
        for (const j of allJobs) dateCounts.set(j.date, (dateCounts.get(j.date) ?? 0) + 1);
        const conflicts = [...dateCounts.entries()].filter(([, n]) => n > 1).map(([d]) => d);
        if (conflicts.length > 0)
          toast.warning(`Multiple jobs on ${conflicts.join(', ')} — review highlighted rows`);
      }

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
          const match = data.jobs.find(j => {
            if (j.date !== upd.date) return false;
            if (upd.venue) {
              const v = upd.venue.toLowerCase();
              return j.venue?.toLowerCase().includes(v) || v.includes(j.venue?.toLowerCase() ?? '');
            }
            return true;
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
                    {['Job #','Date','Start','End','Client','Event','Payroll','Venue','Rate','Steward','Parking'].map(h => (
                      <th key={h} className="px-2 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const dateCounts = new Map<string, number>();
                    jobs.forEach(j => dateCounts.set(j.date, (dateCounts.get(j.date) ?? 0) + 1));
                    const conflictDates = new Set([...dateCounts.entries()].filter(([, n]) => n > 1).map(([d]) => d));
                    return jobs.map((entry, i) => {
                      const isConflict = conflictDates.has(entry.date);
                      return (
                    <tr key={i} className={cn("border-t border-border",
                      selectedJobs.has(i) ? (isConflict ? 'bg-amber-500/10' : 'bg-primary/5') : 'opacity-50')}>
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
                      {isConflict && <td className="px-2 py-1.5 text-amber-500 font-bold text-[10px] whitespace-nowrap">⚠ same date</td>}
                    </tr>
                  );
                  });
                  })()}
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
                    const match = data.jobs.find(j => {
                      if (j.date !== upd.date) return false;
                      if (upd.venue) {
                        const v = upd.venue.toLowerCase();
                        return j.venue?.toLowerCase().includes(v) || v.includes(j.venue?.toLowerCase() ?? '');
                      }
                      return true;
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
