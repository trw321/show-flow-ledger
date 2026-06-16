import { Calendar } from '@/components/ui/calendar';
import { useState, useRef, useCallback, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, Loader2, Check, X, ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { getJobDedupKey } from '@/lib/jobDedup';
import type { Job } from '@/lib/store';
import VortexCanvas from '@/components/VortexCanvas';

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

interface ManualEntry {
  client: string;
  name: string;
  date: string;
  startTime: string;
  position: string;
  hourlyRate: string;
  payrollCompany: string;
  venue: string;
}

type VortexPhase = 'idle' | 'pulling' | 'vortex' | 'flash' | 'settling';
type InputMode = 'choose' | 'text' | 'photo' | 'manual';

function toAmPm(s: string): string {
  const u = s.toUpperCase();
  return u === 'A' ? 'AM' : u === 'P' ? 'PM' : u;
}

function normTime(t: string): string {
  t = t.replace(/[Oo]/g, '0').trim();
  let m: RegExpMatchArray | null;
  m = t.match(/^@?(\d{1,2}):(\d{2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]} ${toAmPm(m[3])}`;
  m = t.match(/^@?(\d{1,2})(\d{2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]} ${toAmPm(m[3])}`;
  m = t.match(/^@?(\d{1,2})\s*(A(?:M)?|P(?:M)?)$/i);
  if (m) return `${m[1].padStart(2, '0')}:00 ${toAmPm(m[2])}`;
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

function splitJobRecords(raw: string): string[] {
  const parts = raw.split(/(?=^\d{4}-\d{4}[\t ]*\r?$)/m);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

function expandCBRecord(record: string): string[] {
  const lines = record.split('\n');
  let dateLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\d+\/\d+\/\d{2}/.test(lines[i])) { dateLineIdx = i; break; }
  }
  if (dateLineIdx === -1) return [record];

  const dateLine = lines[dateLineIdx];
  const dateHasTabs = dateLine.includes('\t');
  let dataLineIdx: number;
  let lineNotes: string;
  let rest: string;

  if (dateHasTabs) {
    dataLineIdx = dateLineIdx;
    const fields = dateLine.split('\t');
    lineNotes = (fields[1] ?? '').trim();
    rest = '\t' + fields.slice(2).join('\t');
  } else {
    dataLineIdx = -1;
    for (let i = dateLineIdx + 1; i < lines.length; i++) {
      if (lines[i].includes('\t')) { dataLineIdx = i; break; }
    }
    if (dataLineIdx === -1) {
      lineNotes = lines.slice(dateLineIdx + 1).map(l => l.trim()).filter(Boolean).join(' ');
      rest = '';
      dataLineIdx = lines.length;
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
  if (/\bNO\s+C\/?B\b/i.test(lineNotes)) return [record];

  const dtMatch = dateLine.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+([^\t\n]*))/);
  if (!dtMatch) return [record];
  const parentM = parseInt(dtMatch[1]);
  const parentD = parseInt(dtMatch[2]);
  const yr = dtMatch[3];
  const fullYr = 2000 + parseInt(yr);
  const parentTime = (dtMatch[4] ?? '').trim();
  const parentDate = new Date(fullYr, parentM - 1, parentD);
  const parentDateOnly = `${parentM}/${parentD}/${yr}`;

  const cbKeyMatch = lineNotes.match(/^(.*?)\s*\bC\/?B(?:'?[Ss])?\b[,\s]*/i);
  if (!cbKeyMatch) return [record];
  const prefix = cbKeyMatch[1].trim();
  let cbContent = lineNotes.slice(cbKeyMatch[0].length).trim();
  cbContent = cbContent.replace(/^SAME\s*DAY\s*,?\s*/i, '').replace(/^@\s*/, '').replace(/^,\s*/, '').trim();

  const parseMD = (md: string): Date => {
    const [m, d] = md.split('/').map(Number);
    return new Date(fullYr, m - 1, d);
  };
  const fmtDate = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}/${yr}`;

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
    if (!dateHasTabs && dataLineIdx >= lines.length && notePfx) out.push(notePfx);
    return out.join('\n');
  };

  type CBEntry = { date: Date; time?: string; note?: string };
  const cbEntries: CBEntry[] = [];
  const hasLeadingDate = /^\d{1,2}\/\d{1,2}/.test(cbContent);
  const hasThru = /^THRU\b/i.test(cbContent);

  if (hasThru) {
    const thruM = cbContent.match(/^THRU\s+(\d{1,2}\/\d{1,2})(.*)/i)!;
    const thruEnd = parseMD(thruM[1]);
    let rem = thruM[2].trim();
    const dark = new Set<string>();
    rem = rem.replace(/,?\s*\bDARK\s+(\d{1,2}\/\d{1,2})/gi, (_: string, d: string) => { dark.add(d.trim()); return ''; }).trim();
    const cur = new Date(parentDate);
    cur.setDate(cur.getDate() + 1);
    while (cur <= thruEnd) {
      const md = `${cur.getMonth() + 1}/${cur.getDate()}`;
      if (!dark.has(md)) cbEntries.push({ date: new Date(cur) });
      cur.setDate(cur.getDate() + 1);
    }
    const thenMatch = rem.match(/\b(THEN|AND)\b(.*)/i);
    if (thenMatch) {
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
        if (atM && isTimeToken(atM[1])) { timeOverride = normTime(atM[1]); trailingTime = timeOverride; rem2 = atM[2].trim(); }
        if (rem2) trailingNote = rem2;
        thenEntries.push({ date: parseMD(dm[1]), time: timeOverride, note: rem2 || undefined });
      }
      for (const e of thenEntries) {
        if (!e.time && trailingTime) e.time = trailingTime;
        if (!e.note && trailingNote) e.note = trailingNote;
      }
      cbEntries.push(...thenEntries);
    } else {
      const noteM = rem.match(/\b(FOR|WITH)\b\s*(.+)/i);
      if (noteM) for (const e of cbEntries) e.note = noteM[0].trim();
    }
  } else if (hasLeadingDate) {
    const parts = cbContent.split(/\s*,\s*/);
    let trailingNote = '';
    for (const part of parts) {
      const dm = part.match(/^(\d{1,2}\/\d{1,2})(.*)/);
      if (!dm) { if (part.trim()) trailingNote = part.trim(); continue; }
      let rem2 = dm[2].trim();
      let timeOverride: string | undefined;
      const atM = rem2.match(/^(@\S+)\s*(.*)/);
      if (atM && isTimeToken(atM[1])) { timeOverride = normTime(atM[1]); rem2 = atM[2].trim(); }
      if (rem2) trailingNote = rem2;
      cbEntries.push({ date: parseMD(dm[1]), time: timeOverride, note: rem2 || undefined });
    }
    if (trailingNote) for (const e of cbEntries) if (!e.note) e.note = trailingNote;
  } else {
    let timeOverride: string | undefined;
    let note: string | undefined;
    const trailingDateM = cbContent.match(/^(.+)\s+(\d{1,2}\/\d{1,2})\s*$/);
    if (trailingDateM) {
      cbEntries.push({ date: parseMD(trailingDateM[2]), time: '', note: trailingDateM[1].trim() || undefined });
    } else {
      const tokM = cbContent.match(/^(@?\S+)\s*(.*)/);
      if (tokM && isTimeToken(tokM[1])) { timeOverride = normTime(tokM[1]); note = tokM[2].trim() || undefined; }
      else { note = cbContent || undefined; }
      cbEntries.push({ date: new Date(parentDate), time: timeOverride, note });
    }
  }

  if (cbEntries.length === 0) return [record];
  const parentRecord = makeRecord(parentDateOnly, prefix);
  const cbRecords = cbEntries.map(e => makeRecord(fmtDate(e.date), e.note ?? '', e.time ?? ''));
  return [parentRecord, ...cbRecords];
}

async function callAPI(url: string, key: string, body: object): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

function ShiftCard({
  job, index, selected, conflict, onToggle, onChange,
}: {
  job: ParsedJob;
  index: number;
  selected: boolean;
  conflict: boolean;
  onToggle: () => void;
  onChange: (field: keyof ParsedJob, value: string | number | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      'rounded-xl border transition-colors overflow-hidden',
      selected
        ? conflict ? 'border-amber-500/50 bg-amber-500/5' : 'border-primary/30 bg-primary/5'
        : 'border-border bg-card opacity-50',
    )}>
      <div className="flex items-center gap-2 p-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="rounded border-border shrink-0"
          aria-label={`Select shift on ${job.date}`}
        />
        <button
          className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {job.date ? format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d') : '—'}
              {conflict && (
                <span className="ml-1.5 text-[10px] text-amber-500 font-normal">
                  <AlertTriangle size={10} className="inline mr-0.5" />same date
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {[
                job.notes?.match(/\bC\/?B\b/i) ? '📞 Callback' : null,
                job.name,
                job.client,
                job.venue,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {job.hourlyRate && (
              <span className="text-xs text-mono text-muted-foreground">${job.hourlyRate}/hr</span>
            )}
            {expanded
              ? <ChevronDown size={14} className="text-muted-foreground" />
              : <ChevronRight size={14} className="text-muted-foreground" />}
          </div>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-3 grid gap-2 sm:grid-cols-2">
          {[
            { label: 'Job #', field: 'jobNumber' as const, value: job.jobNumber ?? '', type: 'text' },
            { label: 'Date', field: 'date' as const, value: job.date, type: 'date' },
            { label: 'Call time', field: 'startTime' as const, value: job.startTime ?? '', type: 'text', placeholder: '08:00 AM' },
            { label: 'End time', field: 'endTime' as const, value: job.endTime ?? '', type: 'text', placeholder: '05:00 PM' },
            { label: 'Event', field: 'name' as const, value: job.name, type: 'text' },
            { label: 'Client', field: 'client' as const, value: job.client, type: 'text' },
            { label: 'Venue', field: 'venue' as const, value: job.venue, type: 'text' },
            { label: 'Payroll co.', field: 'payrollCompany' as const, value: job.payrollCompany ?? '', type: 'text' },
            { label: 'Rate ($/hr)', field: 'hourlyRate' as const, value: job.hourlyRate?.toString() ?? '', type: 'number' },
            { label: 'Steward', field: 'steward' as const, value: job.steward ?? '', type: 'text' },
          ].map(({ label, field, value, type, placeholder }) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">
                {label}
              </label>
              <Input
                type={type}
                value={value}
                placeholder={placeholder}
                step={type === 'number' ? '0.01' : undefined}
                onChange={e => {
                  const raw = e.target.value;
                  if (field === 'hourlyRate' || field === 'parkingCost') {
                    onChange(field, raw === '' ? undefined : parseFloat(raw));
                  } else {
                    onChange(field, raw);
                  }
                }}
                className="h-8 text-xs font-mono"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EMPTY_MANUAL: ManualEntry = {
  client: '',
  name: '',
  date: '',
  startTime: '',
  position: '',
  hourlyRate: '',
  payrollCompany: '',
  venue: '',
};

export default function NewGigPage() {
  const { data, addJob } = useData();

  const savedEmployers = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const job of data.jobs) {
      const c = job.client?.trim();
      if (c && !seen.has(c)) { seen.add(c); list.push(c); }
    }
    return list.sort();
  }, [data.jobs]);

  const [text, setText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [jobs, setJobs] = useState<ParsedJob[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [vortexPhase, setVortexPhase] = useState<VortexPhase>('idle');
  const [inputMode, setInputMode] = useState<InputMode>('choose');
  const [manual, setManual] = useState<ManualEntry>(EMPTY_MANUAL);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (e.target.value.trim() && vortexPhase === 'idle') setVortexPhase('pulling');
    else if (!e.target.value.trim()) setVortexPhase('idle');
  }, [vortexPhase]);

  const handleManualChange = (field: keyof ManualEntry, value: string) =>
    setManual(prev => ({ ...prev, [field]: value }));

  const handleManualSubmit = () => {
    if (!manual.date) { toast.error('Pick a date first'); return; }

    const job: ParsedJob = {
      name: manual.name.trim() || manual.client.trim() || 'Untitled shift',
      client: manual.client.trim() || 'Unknown',
      venue: manual.venue.trim(),
      date: manual.date,
      startTime: manual.startTime.trim() || undefined,
      status: 'confirmed',
      payrollCompany: manual.payrollCompany.trim() || undefined,
      hourlyRate: manual.hourlyRate ? parseFloat(manual.hourlyRate) : undefined,
      notes: manual.position.trim() ? `Position: ${manual.position.trim()}` : undefined,
    };

    setJobs([job]);
    setSelected(new Set([0]));
    setVortexPhase('flash');
    setTimeout(() => {
      setVortexPhase('settling');
      setStep('review');
      setTimeout(() => setVortexPhase('idle'), 1200);
    }, 400);
  };

  const handleParse = async () => {
    if (!text.trim()) { toast.error('Paste dispatch text first'); return; }
    setIsParsing(true);
    setVortexPhase('vortex');
    setParseProgress('');

    try {
      const allJobs: ParsedJob[] = [];

      if (/^\d{4}-\d{4}/m.test(text)) {
        const records = splitJobRecords(text);
        const expanded: string[] = [];
        for (const rec of records) expanded.push(...expandCBRecord(rec));
        const BATCH = 5;
        const batches: string[][] = [];
        for (let i = 0; i < expanded.length; i += BATCH) batches.push(expanded.slice(i, i + BATCH));
        for (let b = 0; b < batches.length; b++) {
          setParseProgress(`Parsing ${b + 1} of ${batches.length}…`);
          const resp = await callAPI(`${supabaseUrl}/functions/v1/parse-jobs`, supabaseKey, {
            text: batches[b].join('\n\n'),
          });
          if (!resp.ok) { console.error(`batch ${b + 1} failed`); continue; }
          const d = await resp.json();
          allJobs.push(...(d.jobs || []));
        }
      } else {
        setParseProgress('Classifying…');
        const resp = await callAPI(`${supabaseUrl}/functions/v1/smart-import`, supabaseKey, { text });
        if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to parse');
        const result = await resp.json();
        allJobs.push(...(result.jobs || []));
      }

      if (allJobs.length === 0) {
        toast.error('No jobs found — check the pasted text');
        setVortexPhase('pulling');
        return;
      }

      allJobs.sort((a, b) => a.date.localeCompare(b.date));

      const dateCounts = new Map<string, number>();
      for (const j of allJobs) dateCounts.set(j.date, (dateCounts.get(j.date) ?? 0) + 1);
      const conflicts = [...dateCounts.entries()].filter(([, n]) => n > 1).map(([d]) => d);
      if (conflicts.length) toast.warning(`Multiple jobs on ${conflicts.join(', ')} — review highlighted cards`);

      setJobs(allJobs);
      setSelected(new Set(allJobs.map((_, i) => i)));

      setVortexPhase('flash');
      setTimeout(() => {
        setVortexPhase('settling');
        setStep('review');
        setTimeout(() => setVortexPhase('idle'), 1200);
      }, 400);

      toast.success(`Found ${allJobs.length} shift${allJobs.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse');
      setVortexPhase('pulling');
    } finally {
      setIsParsing(false);
      setParseProgress('');
    }
  };

  const handleImport = async () => {
    const toImport = jobs.filter((_, i) => selected.has(i));
    if (toImport.length === 0) { toast.error('Select at least one shift'); return; }
    setIsImporting(true);
    const existingKeys = new Set(data.jobs.map(j => getJobDedupKey(j)));
    let imported = 0, skipped = 0, failed = 0;

    for (const j of toImport) {
      const draft = {
        jobNumber: j.jobNumber, name: j.name, client: j.client, venue: j.venue,
        date: j.date, startTime: j.startTime, endTime: j.endTime, status: j.status,
        payrollCompany: j.payrollCompany, hourlyRate: j.hourlyRate, steward: j.steward,
        parkingCost: j.parkingCost, notes: j.notes || '',
        has6th7thDayRule: false, hasVacationPay: false,
      };
      const key = getJobDedupKey(draft);
      if (existingKeys.has(key)) { skipped++; continue; }
      try { await addJob(draft); existingKeys.add(key); imported++; }
      catch { failed++; }
    }

    setIsImporting(false);
    if (imported === 0 && failed > 0) { toast.error('Save failed — check your connection'); return; }
    toast.success(
      `Saved ${imported} shift${imported !== 1 ? 's' : ''}` +
      (skipped ? ` · skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}` : '') +
      (failed ? ` · ${failed} failed` : '')
    );
    setText(''); setJobs([]); setSelected(new Set()); setStep('input'); setVortexPhase('idle');
    setManual(EMPTY_MANUAL); setInputMode('choose');
  };

  const handleClear = () => {
    setText(''); setJobs([]); setSelected(new Set()); setStep('input');
    setVortexPhase('idle'); setInputMode('choose'); setManual(EMPTY_MANUAL);
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsParsing(true);
    setVortexPhase('vortex');
    setParseProgress('Reading image…');

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setParseProgress('Parsing with AI…');
      const resp = await callAPI(`${supabaseUrl}/functions/v1/parse-job-image`, supabaseKey, {
        base64,
        mimeType: file.type || 'image/jpeg',
      });

      if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to parse image');
      const result = await resp.json();
      const allJobs: ParsedJob[] = result.jobs || [];

      if (allJobs.length === 0) {
        toast.error('No jobs found in image');
        setVortexPhase('idle');
        return;
      }

      allJobs.sort((a, b) => a.date.localeCompare(b.date));
      setJobs(allJobs);
      setSelected(new Set(allJobs.map((_, i) => i)));
      setVortexPhase('flash');
      setTimeout(() => {
        setVortexPhase('settling');
        setStep('review');
        setTimeout(() => setVortexPhase('idle'), 1200);
      }, 400);
      toast.success(`Found ${allJobs.length} shift${allJobs.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse image');
      setVortexPhase('idle');
    } finally {
      setIsParsing(false);
      setParseProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateJob = (idx: number, field: keyof ParsedJob, value: string | number | undefined) =>
    setJobs(prev => prev.map((j, i) => i === idx ? { ...j, [field]: value } : j));

  const conflictDates = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach(j => { counts[j.date] = (counts[j.date] ?? 0) + 1; });
    return new Set(Object.entries(counts).filter(([, n]) => n > 1).map(([d]) => d));
  }, [jobs]);

  const hasContent = text.trim().length > 0 || step === 'review';
  const manualHasContent = Object.values(manual).some(v => v.trim() !== '');

  return (
    <div className="flex flex-col gap-6 pb-8">

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoSelect}
      />

      <div className="relative rounded-2xl overflow-hidden" style={{ minHeight: 220 }}>
        <div className="absolute inset-0 rounded-2xl overflow-hidden">
          <VortexCanvas phase={vortexPhase} className="w-full h-full" />
        </div>
        <div className="relative z-10 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xs text-mono uppercase tracking-widest text-white/60 font-medium">
              Job Log
            </h1>
            {(hasContent || manualHasContent || inputMode !== 'choose') && (
              <button onClick={handleClear} className="text-white/40 hover:text-white/70 transition-colors p-1" aria-label="Clear">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Mode chooser */}
          {inputMode === 'choose' && step === 'input' && (
            <div className="flex flex-col gap-2 py-4">
              <button
                onClick={() => setInputMode('text')}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-black/40 border border-white/10 hover:border-amber-500/40 transition-colors text-left"
              >
                <span className="text-xl">📋</span>
                <div>
                  <p className="text-sm text-white/80 font-medium">Paste text</p>
                  <p className="text-[11px] text-white/40">Dispatch portal, email, or any offer text</p>
                </div>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isParsing}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-black/40 border border-white/10 hover:border-amber-500/40 transition-colors text-left disabled:opacity-50"
              >
                <span className="text-xl">📸</span>
                <div>
                  <p className="text-sm text-white/80 font-medium">Photo</p>
                  <p className="text-[11px] text-white/40">Screenshot, text message, calendar, Nowsta</p>
                </div>
              </button>
              <button
                onClick={() => setInputMode('manual')}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-black/40 border border-white/10 hover:border-amber-500/40 transition-colors text-left"
              >
                <span className="text-xl">✏️</span>
                <div>
                  <p className="text-sm text-white/80 font-medium">Manual entry</p>
                  <p className="text-[11px] text-white/40">Phone call, text, or verbal offer</p>
                </div>
              </button>
              {isParsing && (
                <div className="flex items-center gap-2 justify-center py-2">
                  <Loader2 size={14} className="animate-spin text-amber-500" />
                  <span className="text-xs text-white/60 text-mono">{parseProgress}</span>
                </div>
              )}
            </div>
          )}

          {/* Manual entry mode */}
          {inputMode === 'manual' && step === 'input' && (
            <div className="flex flex-col gap-3 py-2">

              {/* Employer — full width, up top */}
              <div className="flex flex-col gap-1">
               <label className="text-[10px] text-mono uppercase tracking-wider text-white/50">Employer <span className="inline-block w-1.5 h-1.5 rounded-full bg-lime-400 mb-0.5 ml-0.5" /></label>
                <Input
                  value={manual.client}
                  onChange={e => handleManualChange('client', e.target.value)}
                  placeholder="e.g. Fillmore Philadelphia"
                  className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-amber-500/40"
                  list="employer-suggestions"
                />
                <datalist id="employer-suggestions">
                  {savedEmployers
                    .filter(e => e.toLowerCase().includes(manual.client.toLowerCase()))
                    .map(e => <option key={e} value={e} />)}
                </datalist>
              </div>

              {/* Calendar + right-column fields side by side on desktop */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <label className="text-[10px] text-mono uppercase tracking-wider text-white/50">
                    Date <span className="text-lime-400">*</span>
                  </label>
                  <div className="rounded-xl overflow-hidden border border-white/10 bg-black/40">
                    <Calendar
                      mode="single"
                      selected={manual.date ? new Date(manual.date + 'T12:00:00') : undefined}
                      onSelect={d => handleManualChange('date', d ? format(d, 'yyyy-MM-dd') : '')}
className="text-white/80 [&_button]:text-white/70 [&_button:hover]:bg-white/10 [&_button[aria-selected]]:bg-transparent [&_button[aria-selected]]:text-white/80 [&_button[aria-selected]]:ring-2 [&_button[aria-selected]]:ring-purple-500 [&_button[aria-selected]]:rounded-lg [&_button[aria-selected]:hover]:bg-white/10 [&_button[data-today][aria-selected]]:bg-blue-500 [&_button[data-today][aria-selected]]:ring-0 [&_button[data-today][aria-selected]]:text-white [&_button[data-today]]:bg-blue-500 [&_button[data-today]]:text-white"                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2 flex-1 sm:pt-6">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-mono uppercase tracking-wider text-white/50">Call time <span className="inline-block w-1.5 h-1.5 rounded-full bg-lime-400 mb-0.5 ml-0.5" /></label>
                    <Input
                      value={manual.startTime}
                      onChange={e => handleManualChange('startTime', e.target.value)}
                      placeholder="4:00 PM"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-amber-500/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                   <label className="text-[10px] text-mono uppercase tracking-wider text-white/50">Rate ($/hr) <span className="inline-block w-1.5 h-1.5 rounded-full bg-lime-400 mb-0.5 ml-0.5" /></label>
                    <Input
                      type="number"
                      step="0.01"
                      value={manual.hourlyRate}
                      onChange={e => handleManualChange('hourlyRate', e.target.value)}
                      placeholder="0.00"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-amber-500/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-mono uppercase tracking-wider text-white/50">Position</label>
                    <Input
                      value={manual.position}
                      onChange={e => handleManualChange('position', e.target.value)}
                      placeholder="e.g. A1, Followspot"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-amber-500/40"
                    />
                  </div>
                </div>
              </div>

             {/* Bottom row — optional fields, mobile only; desktop these are in the right column */}
              <div className="grid grid-cols-2 gap-2 sm:hidden">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-mono uppercase tracking-wider text-white/50">Event name</label>
              <Input
                    value={manual.name}
                    onChange={e => handleManualChange('name', e.target.value)}
                    placeholder="e.g. Olivia Rodrigo"
                    className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-amber-500/40"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-mono uppercase tracking-wider text-white/50">Venue</label>
                  <Input
                    value={manual.venue}
                    onChange={e => handleManualChange('venue', e.target.value)}
                    placeholder="e.g. The Met"
                    className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-amber-500/40"
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <label className="text-[10px] text-mono uppercase tracking-wider text-white/50">Payroll co.</label>
                  <Input
                    value={manual.payrollCompany}
                    onChange={e => handleManualChange('payrollCompany', e.target.value)}
                    placeholder="e.g. AVTS"
                    className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-amber-500/40"
                  />
                </div>
              </div>

              <Button
                onClick={handleManualSubmit}
                disabled={!manual.date}
                size="sm"
                className="w-full gap-1.5 bg-amber-500/90 hover:bg-amber-500 text-black border-0 font-medium mt-1"
              >
                <Check size={13} /> Add shift
              </Button>
            </div>
          )}

          {/* Text input mode */}
          {(inputMode === 'text' || step === 'review') && (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                disabled={isParsing}
                rows={6}
                placeholder={step === 'review' ? 'Paste more shifts to add them…' : 'Paste dispatch text here…'}
                className={cn(
                  'w-full bg-black/40 backdrop-blur-sm border border-white/10 rounded-xl',
                  'px-3 py-2.5 text-xs text-mono text-white/80 placeholder:text-white/25',
                  'focus:outline-none focus:border-amber-500/40 focus:bg-black/50',
                  'resize-none transition-colors leading-relaxed',
                  isParsing && 'opacity-50 cursor-not-allowed',
                )}
                aria-label="Paste dispatch text"
              />
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleParse}
                  disabled={isParsing || !text.trim()}
                  size="sm"
                  className="gap-1.5 bg-amber-500/90 hover:bg-amber-500 text-black border-0 font-medium"
                >
                  {isParsing
                    ? <><Loader2 size={13} className="animate-spin" />{parseProgress || 'Parsing…'}</>
                    : <><Upload size={13} />Parse</>}
                </Button>
                {step === 'review' && (
                  <span className="text-[11px] text-white/40 text-mono">
                    {jobs.length} shift{jobs.length !== 1 ? 's' : ''} ready
                  </span>
                )}
                {inputMode === 'text' && step === 'input' && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-white/40 hover:text-amber-500/80 transition-colors p-1"
                    title="Switch to photo"
                  >
                    <span className="text-base">📸</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {step === 'review' && jobs.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs text-mono uppercase tracking-wider text-muted-foreground">Review shifts</h2>
            <button
              onClick={() => setSelected(selected.size === jobs.length ? new Set() : new Set(jobs.map((_, i) => i)))}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {selected.size === jobs.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {jobs.map((job, i) => (
              <ShiftCard
                key={i}
                job={job}
                index={i}
                selected={selected.has(i)}
                conflict={conflictDates.has(job.date)}
                onToggle={() => setSelected(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })}
                onChange={(field, value) => updateJob(i, field, value)}
              />
            ))}
          </div>
          <Button onClick={handleImport} disabled={isImporting || selected.size === 0} className="w-full gap-1.5">
            {isImporting
              ? <><Loader2 size={14} className="animate-spin" />Saving…</>
              : <><Check size={14} />Save {selected.size} shift{selected.size !== 1 ? 's' : ''}</>}
          </Button>
        </div>
      )}

      {data.jobs.length === 0 && step === 'input' && (
        <p className="text-center text-sm text-muted-foreground py-8">
          Paste a dispatch offer above to add your first shift.
        </p>
      )}
    </div>
  );
}
