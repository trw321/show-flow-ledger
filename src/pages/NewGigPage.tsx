import { Calendar } from '@/components/ui/calendar';
import { useState, useRef, useCallback, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, Loader2, Check, Plus, X, ChevronRight, ChevronDown, AlertTriangle, Trash2, Camera, PenLine, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { getJobDedupKey, findLikelyDuplicate } from '@/lib/jobDedup';
import type { Job, CalendarEvent } from '@/lib/store';
import VortexCanvas from '@/components/VortexCanvas';
import EmployerCombobox from '@/components/EmployerCombobox';
import { useCelebration } from '@/components/Celebration';
import {
  hourUpdateToEntry, matchEntries as matchHourEntries, calcHours,
  type HoursEntry, type MatchResult as HoursMatchResult, type SmartImportHourUpdate,
} from '@/lib/hoursMatching';
import { useSwipe } from '@/lib/useSwipe';
import {
  type ParsedJob, splitJobRecords, expandCBRecord, expandThruNotesForBatch,
} from '@/lib/dispatchParsing';

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
type Step = 'input' | 'review-jobs' | 'review-hours' | 'review-events';
type ParsedEvent = Omit<CalendarEvent, 'id' | 'createdAt'>;

async function callAPI(url: string, key: string, body: object): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

function ShiftCard({
  job, index, selected, conflict, existingMatch, onToggle, onChange,
}: {
  job: ParsedJob;
  index: number;
  selected: boolean;
  conflict: boolean;
  existingMatch?: Job;
  onToggle: () => void;
  onChange: (field: keyof ParsedJob, value: string | number | undefined) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isCallback = !!job.notes?.match(/\bC\/?B\b/i) && !job.notes?.match(/\bNO[\s/-]*C\/?B\b/i);

  return (
    <div className={cn(
      'rounded-md border transition-colors overflow-hidden',
      selected
        ? existingMatch ? 'border-destructive/50 bg-destructive/5' : conflict ? 'border-warning/50 bg-warning/5' : 'border-primary/30 bg-primary/5'
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
            <p className="text-sm font-medium flex items-center gap-1.5">
              <span className="truncate">{job.date ? format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d') : '—'}</span>
              {isCallback && <Phone size={12} className="text-destructive shrink-0" aria-label="Callback" />}
              {conflict && (
                <span className="text-[10px] text-warning font-normal shrink-0">
                  <AlertTriangle size={10} className="inline mr-0.5" />same date
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {[
                isCallback ? 'Callback' : null,
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

      {existingMatch && (
        <div className="mx-3 mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            Possible duplicate — you already have <span className="font-medium">"{existingMatch.name}"</span> for job #{existingMatch.jobNumber} on this date. Uncheck this one to skip it, or leave it checked if it's really a separate call.
          </span>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-3 flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Client</label>
            <EmployerCombobox
              value={job.client}
              onChange={v => onChange('client', v)}
              onSelectEmployer={emp => {
                if (!job.hourlyRate && emp.defaultHourlyRate) onChange('hourlyRate', emp.defaultHourlyRate);
                if (!job.payrollCompany && emp.payrollCompany) onChange('payrollCompany', emp.payrollCompany);
              }}
              className="[&>input]:h-8 [&>input]:text-xs [&>input]:font-mono"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { label: 'Job #', field: 'jobNumber' as const, value: job.jobNumber ?? '', type: 'text' },
              { label: 'Date', field: 'date' as const, value: job.date, type: 'date' },
              { label: 'Call time', field: 'startTime' as const, value: job.startTime ?? '', type: 'text', placeholder: '08:00 AM' },
              { label: 'End time', field: 'endTime' as const, value: job.endTime ?? '', type: 'text', placeholder: '05:00 PM' },
              { label: 'Event', field: 'name' as const, value: job.name, type: 'text' },
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
        </div>
      )}
    </div>
  );
}

function confidenceBadge(c: HoursMatchResult['confidence']) {
  if (c === 'high') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-success/20 text-success">🟢 High</span>;
  if (c === 'medium') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-warning/20 text-warning">🟡 Medium</span>;
  if (c === 'low') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-destructive/20 text-destructive">🔴 Low</span>;
  return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">No match</span>;
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
  const { data, addJob, updateJob: updateExistingJob, addIncome, addEvent } = useData();
  const { fire: fireCelebration, Burst } = useCelebration();

  const [text, setText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [jobs, setJobs] = useState<ParsedJob[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchEdit, setBatchEdit] = useState({ client: '', payrollCompany: '', venue: '', hourlyRate: '' });
  const [isImporting, setIsImporting] = useState(false);
  const [step, setStep] = useState<Step>('input');
  const [vortexPhase, setVortexPhase] = useState<VortexPhase>('idle');
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<ManualEntry>(EMPTY_MANUAL);
  const [extraDates, setExtraDates] = useState<string[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [hoursResults, setHoursResults] = useState<HoursMatchResult[]>([]);
  const [hoursAccepted, setHoursAccepted] = useState<Set<number>>(new Set());
  const [events, setEvents] = useState<ParsedEvent[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<Set<number>>(new Set());
  const [isImportingEvents, setIsImportingEvents] = useState(false);
  const swipe = useSwipe(
    () => setCalendarMonth(m => new Date(m.getFullYear(), m.getMonth() - 1)),
    () => setCalendarMonth(m => new Date(m.getFullYear(), m.getMonth() + 1)),
  );
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
    const dates = [manual.date, ...extraDates].filter(Boolean);
    const uniqueDates = [...new Set(dates)];
    if (uniqueDates.length === 0) { toast.error('Pick at least one date'); return; }

    const makeJob = (date: string): ParsedJob => ({
      name: manual.name.trim() || manual.client.trim() || 'Untitled shift',
      client: manual.client.trim() || 'Unknown',
      venue: manual.venue.trim(),
      date,
      startTime: manual.startTime.trim() || undefined,
      status: 'upcoming',
      payrollCompany: manual.payrollCompany.trim() || undefined,
      hourlyRate: manual.hourlyRate ? parseFloat(manual.hourlyRate) : undefined,
      notes: manual.position.trim() ? `Position: ${manual.position.trim()}` : undefined,
    });

    const newJobs = uniqueDates.map(makeJob);

    setJobs(newJobs);
    setSelected(new Set(newJobs.map((_, i) => i)));
    setExtraDates([]);
    setManualOpen(false);
    setVortexPhase('flash');
    setTimeout(() => {
      setVortexPhase('settling');
      setStep('review-jobs');
      setTimeout(() => setVortexPhase('idle'), 1200);
    }, 400);
  };

  // Applies the jobs branch of a smart-import (or structured-format) result:
  // dedup-aware, THRU-expanding, shared by both the text and photo paths.
  const finishJobsParse = (allJobs: ParsedJob[]) => {
    if (allJobs.length === 0) {
      toast.error('No jobs found — check the pasted text');
      setVortexPhase('pulling');
      return;
    }

    // Deterministic backstop for any "CB THRU X..." the AI left unexpanded
    const expandedJobs = expandThruNotesForBatch(allJobs);
    expandedJobs.sort((a, b) => a.date.localeCompare(b.date));

    const dateCounts = new Map<string, number>();
    for (const j of expandedJobs) dateCounts.set(j.date, (dateCounts.get(j.date) ?? 0) + 1);
    const conflicts = [...dateCounts.entries()].filter(([, n]) => n > 1).map(([d]) => d);
    if (conflicts.length) toast.warning(`Multiple jobs on ${conflicts.join(', ')} — review highlighted cards`);

    setJobs(expandedJobs);
    setSelected(new Set(expandedJobs.map((_, i) => i)));

    setVortexPhase('flash');
    setTimeout(() => {
      setVortexPhase('settling');
      setStep('review-jobs');
      setTimeout(() => setVortexPhase('idle'), 1200);
    }, 400);

    toast.success(`Found ${expandedJobs.length} shift${expandedJobs.length === 1 ? '' : 's'}`);
  };

  // Applies the hours branch of a smart-import result: matches each parsed
  // entry against existing jobs (same scoring CatScratchButton used) and
  // drops into a review-and-apply list instead of a job-creation review.
  const finishHoursParse = (updates: SmartImportHourUpdate[]) => {
    if (updates.length === 0) {
      toast.error('No hours found — check the pasted text');
      setVortexPhase('pulling');
      return;
    }
    const entries = updates.map(hourUpdateToEntry);
    const results = matchHourEntries(entries, data.jobs);
    setHoursResults(results);
    setHoursAccepted(new Set());
    setVortexPhase('flash');
    setTimeout(() => {
      setVortexPhase('settling');
      setStep('review-hours');
      setTimeout(() => setVortexPhase('idle'), 1200);
    }, 400);
    toast.success(`Found ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
  };

  // Applies the events branch of a smart-import result: a non-work personal
  // schedule (gym classes, appointments, a printed month calendar) — drops
  // into its own review-and-select list, same shape as the jobs review but
  // creating CalendarEvent records instead of Job records.
  const finishEventsParse = (parsedEvents: ParsedEvent[]) => {
    if (parsedEvents.length === 0) {
      toast.error('No events found — check the pasted text');
      setVortexPhase('pulling');
      return;
    }
    const sorted = [...parsedEvents].sort((a, b) => a.date.localeCompare(b.date));
    setEvents(sorted);
    setSelectedEvents(new Set(sorted.map((_, i) => i)));
    setVortexPhase('flash');
    setTimeout(() => {
      setVortexPhase('settling');
      setStep('review-events');
      setTimeout(() => setVortexPhase('idle'), 1200);
    }, 400);
    toast.success(`Found ${sorted.length} event${sorted.length === 1 ? '' : 's'}`);
  };

  const handleImportEvents = async () => {
    const toImport = events.filter((_, i) => selectedEvents.has(i));
    if (toImport.length === 0) { toast.error('Select at least one event'); return; }
    setIsImportingEvents(true);
    let imported = 0;
    for (const ev of toImport) {
      try { await addEvent(ev); imported++; }
      catch { /* skip failures, report the count below */ }
    }
    setIsImportingEvents(false);
    if (imported > 0) fireCelebration();
    toast.success(`Added ${imported} event${imported !== 1 ? 's' : ''}`);
    setEvents([]); setSelectedEvents(new Set()); setText(''); setStep('input'); setVortexPhase('idle');
  };

  const handleParse = async () => {
    if (!text.trim()) { toast.error('Paste dispatch text first'); return; }
    setIsParsing(true);
    setVortexPhase('vortex');
    setParseProgress('');

    try {
      if (/^\d{4}-\d{4}/m.test(text)) {
        const records = splitJobRecords(text);
        const expanded: string[] = [];
        for (const rec of records) expanded.push(...expandCBRecord(rec));
        const BATCH = 5;
        const batches: string[][] = [];
        for (let i = 0; i < expanded.length; i += BATCH) batches.push(expanded.slice(i, i + BATCH));
        const allJobs: ParsedJob[] = [];
        for (let b = 0; b < batches.length; b++) {
          setParseProgress(`Parsing ${b + 1} of ${batches.length}…`);
          const resp = await callAPI(`${supabaseUrl}/functions/v1/parse-jobs`, supabaseKey, {
            text: batches[b].join('\n\n'),
          });
          if (!resp.ok) { console.error(`batch ${b + 1} failed`); continue; }
          const d = await resp.json();
          allJobs.push(...(d.jobs || []));
        }
        finishJobsParse(allJobs);
        return;
      }

      setParseProgress('Classifying…');
      const resp = await callAPI(`${supabaseUrl}/functions/v1/smart-import`, supabaseKey, { text });
      if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to parse');
      const result = await resp.json();

      if (result.type === 'hours') finishHoursParse(result.hourUpdates || []);
      else if (result.type === 'events') finishEventsParse(result.events || []);
      else if (result.type === 'income') {
        toast.info('That looks like a payment record, not a shift — check it under Pay instead.');
        setVortexPhase('pulling');
      } else finishJobsParse(result.jobs || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse');
      setVortexPhase('pulling');
    } finally {
      setIsParsing(false);
      setParseProgress('');
    }
  };

  const handleApplyHours = async (result: HoursMatchResult, idx: number) => {
    const { entry, matchedJob } = result;
    if (matchedJob) {
      const updates: Partial<Job> = {};
      if (entry.endTime && !matchedJob.endTime) updates.endTime = entry.endTime;
      if (entry.mealDuration !== undefined && matchedJob.mealDuration === undefined) {
        updates.mealDuration = entry.mealDuration;
        updates.mealOnClock = entry.mealOnClock;
      }
      if (entry.mealPenalties && !matchedJob.mealPenalties) updates.mealPenalties = entry.mealPenalties;
      if (entry.minimumHours && !matchedJob.minimumHours) updates.minimumHours = entry.minimumHours;
      if (entry.payrollCompany && !matchedJob.payrollCompany) updates.payrollCompany = entry.payrollCompany;
      if (entry.startTime && !matchedJob.startTime) updates.startTime = entry.startTime;
      if (entry.hourlyRate && !matchedJob.hourlyRate) updates.hourlyRate = entry.hourlyRate;
      if (entry.hoursWorked && !matchedJob.hoursWorked) {
        updates.hoursWorked = entry.hoursWorked;
        updates.status = 'completed';
      } else if (entry.endTime && entry.startTime) {
        const h = calcHours(entry.startTime, entry.endTime);
        if (h > 0 && !matchedJob.hoursWorked) { updates.hoursWorked = h; updates.status = 'completed'; }
      }
      await updateExistingJob(matchedJob.id, updates);
      if (entry.paid && entry.grossPay) {
        await addIncome({
          jobId: matchedJob.id,
          client: matchedJob.client,
          description: `Add hours — ${format(new Date(entry.date + 'T12:00:00'), 'MMM d')}`,
          amount: entry.grossPay,
          date: entry.date,
          status: 'paid',
        });
      }
    } else {
      await addJob({
        name: entry.venue || 'New shift',
        client: entry.client || entry.payrollCompany || 'Unknown',
        venue: entry.venue || '',
        date: entry.date,
        startTime: entry.startTime,
        endTime: entry.endTime,
        hoursWorked: entry.hoursWorked,
        hourlyRate: entry.hourlyRate,
        status: entry.hoursWorked ? 'completed' : 'upcoming',
        mealDuration: entry.mealDuration,
        mealOnClock: entry.mealOnClock,
        mealPenalties: entry.mealPenalties,
        minimumHours: entry.minimumHours,
        payrollCompany: entry.payrollCompany,
        notes: entry.notes || '',
        has6th7thDayRule: false,
        hasVacationPay: false,
      });
    }
    const nextAccepted = new Set(hoursAccepted).add(idx);
    setHoursAccepted(nextAccepted);
    fireCelebration();
    toast.success(matchedJob ? 'Job updated' : 'New job created');

    if (nextAccepted.size === hoursResults.length) {
      setTimeout(() => {
        setStep('input');
        setText('');
        setHoursResults([]);
        setHoursAccepted(new Set());
      }, 900);
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
    if (imported > 0) fireCelebration();
    toast.success(
      `Saved ${imported} shift${imported !== 1 ? 's' : ''}` +
      (skipped ? ` · skipped ${skipped} duplicate${skipped !== 1 ? 's' : ''}` : '') +
      (failed ? ` · ${failed} failed` : '')
    );
    setText(''); setJobs([]); setSelected(new Set()); setStep('input'); setVortexPhase('idle');
    setManual(EMPTY_MANUAL); setManualOpen(false);
  };

  const handleClear = () => {
    setText(''); setJobs([]); setSelected(new Set()); setStep('input');
    setVortexPhase('idle'); setManualOpen(false); setManual(EMPTY_MANUAL); setExtraDates([]);
    setHoursResults([]); setHoursAccepted(new Set());
    setEvents([]); setSelectedEvents(new Set());
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
      const mimeType = file.type || 'image/jpeg';

      // smart-import handles images too (classifies jobs/income/hours like the
      // text path), but it hasn't reliably been reachable from the browser in
      // the past (CORS preflight failures) — parse-job-image is the fallback
      // that's always worked, at the cost of only ever producing jobs.
      let result: { type?: string; jobs?: ParsedJob[]; hourUpdates?: SmartImportHourUpdate[] };
      try {
        const resp = await callAPI(`${supabaseUrl}/functions/v1/smart-import`, supabaseKey, {
          imageBase64: base64, imageMimeType: mimeType,
        });
        if (!resp.ok) throw new Error('smart-import unreachable');
        result = await resp.json();
      } catch {
        const resp = await callAPI(`${supabaseUrl}/functions/v1/parse-job-image`, supabaseKey, { base64, mimeType });
        if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to parse image');
        result = await resp.json();
      }

      if (result.type === 'hours') finishHoursParse(result.hourUpdates || []);
      else if (result.type === 'events') finishEventsParse(result.events || []);
      else if (result.type === 'income') {
        toast.info('That looks like a payment record, not a shift — check it under Pay instead.');
        setVortexPhase('idle');
      } else finishJobsParse(result.jobs || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse image');
      setVortexPhase('idle');
    } finally {
      setIsParsing(false);
      setParseProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateParsedJob = (idx: number, field: keyof ParsedJob, value: string | number | undefined) =>
    setJobs(prev => prev.map((j, i) => i === idx ? { ...j, [field]: value } : j));

  const batchUpdateJobs = (field: keyof ParsedJob, value: string | number | undefined) =>
    setJobs(prev => prev.map((j, i) => selected.has(i) ? { ...j, [field]: value } : j));

  const removeSelectedJobs = () => {
    setJobs(prev => prev.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
  };

  const applyBatchEdit = () => {
    if (batchEdit.client.trim()) batchUpdateJobs('client', batchEdit.client.trim());
    if (batchEdit.payrollCompany.trim()) batchUpdateJobs('payrollCompany', batchEdit.payrollCompany.trim());
    if (batchEdit.venue.trim()) batchUpdateJobs('venue', batchEdit.venue.trim());
    if (batchEdit.hourlyRate.trim()) batchUpdateJobs('hourlyRate', parseFloat(batchEdit.hourlyRate));
    toast.success(`Updated ${selected.size} shift${selected.size !== 1 ? 's' : ''}`);
    setBatchEdit({ client: '', payrollCompany: '', venue: '', hourlyRate: '' });
  };

  const conflictDates = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach(j => { counts[j.date] = (counts[j.date] ?? 0) + 1; });
    return new Set(Object.entries(counts).filter(([, n]) => n > 1).map(([d]) => d));
  }, [jobs]);

  // Catches re-parsing the same dispatch a second time (e.g. once via paste,
  // once via photo) even when the two parses came out with different
  // completeness — flagged for review, not silently skipped, since they may
  // genuinely be a distinct callback under the same job number.
  const existingMatches = useMemo(() => {
    const map = new Map<number, Job>();
    jobs.forEach((job, i) => {
      const match = findLikelyDuplicate(job, data.jobs);
      if (match) map.set(i, match);
    });
    return map;
  }, [jobs, data.jobs]);

  const hasContent = text.trim().length > 0 || step === 'review-jobs' || step === 'review-hours' || step === 'review-events';
  const manualHasContent = Object.values(manual).some(v => v.trim() !== '');

  return (
    <div className="flex flex-col gap-6 pb-8">
      <Burst />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoSelect}
      />

      <div className="relative rounded-lg overflow-hidden" style={{ minHeight: 220 }}>
        <div className="absolute inset-0 rounded-lg overflow-hidden">
          <VortexCanvas phase={vortexPhase} className="w-full h-full" />
        </div>
        <div className="relative z-10 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xs text-mono uppercase tracking-widest text-white/60 font-medium">
              Job Log
            </h1>
            {(hasContent || manualHasContent || manualOpen) && (
              <button onClick={handleClear} className="text-white/40 hover:text-white/70 transition-colors p-1" aria-label="Clear">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Manual entry — collapsed fallback, not the primary path */}
          {manualOpen && step === 'input' && (
            <div className="flex flex-col gap-3 py-2">
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="self-start text-[11px] text-white/40 hover:text-white/70 transition-colors"
              >
                ← Back to paste
              </button>

              {/* Employer — full width, up top */}
              <div className="flex flex-col gap-1">
               <label className="text-[10px] font-body uppercase tracking-wider text-white/50">Employer</label>
                <EmployerCombobox
                  value={manual.client}
                  onChange={v => handleManualChange('client', v)}
                  onSelectEmployer={emp => {
                    if (!manual.hourlyRate && emp.defaultHourlyRate) handleManualChange('hourlyRate', emp.defaultHourlyRate.toString());
                    if (!manual.payrollCompany && emp.payrollCompany) handleManualChange('payrollCompany', emp.payrollCompany);
                  }}
                  placeholder="e.g. Fillmore Philadelphia"
                />
              </div>

              {/* Calendar + right-column fields side by side on desktop */}
              <div className="flex flex-col sm:flex-row gap-3">

                {/* Left — calendar */}
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <label className="text-[10px] font-body uppercase tracking-wider text-white/50">
                    Date <span className="text-lime-400">*</span>
                  </label>
                  <div
                    className="rounded-md overflow-hidden border border-white/10 bg-black/40"
                    {...swipe}
                  >
                    <Calendar
                      mode="single"
                      month={calendarMonth}
                      onMonthChange={setCalendarMonth}
                      selected={manual.date ? new Date(manual.date + 'T12:00:00') : undefined}
                      onSelect={d => handleManualChange('date', d ? format(d, 'yyyy-MM-dd') : '')}
                      classNames={{
                        cell: "h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
                      }}
                      className="text-white/80 [&_button]:text-white/70 [&_button:hover]:bg-white/10 [&_button[aria-selected]]:!bg-transparent [&_button[aria-selected]]:text-white [&_button[aria-selected]]:outline [&_button[aria-selected]]:outline-[3px] [&_button[aria-selected]]:outline-yellow-300 [&_button[aria-selected]]:-outline-offset-2 [&_button[aria-selected]]:!rounded-full [&_button[aria-selected]:hover]:!bg-transparent [&_button[data-today]]:!bg-blue-500 [&_button[data-today]]:!text-white [&_button[data-today][aria-selected]]:!bg-transparent [&_button[data-today][aria-selected]]:outline-yellow-300"
                    />
                  </div>
                </div>

                {/* Right — fields stacked */}
                <div className="flex flex-col gap-2 flex-1 sm:pt-6">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-body uppercase tracking-wider text-white/50">Call time <span className="inline-block w-1.5 h-1.5 rounded-full bg-lime-400 mb-0.5 ml-0.5" /></label>
                    <Input
                      value={manual.startTime}
                      onChange={e => handleManualChange('startTime', e.target.value)}
                      placeholder="4:00 PM"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-primary/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-body uppercase tracking-wider text-white/50">Rate ($/hr) <span className="inline-block w-1.5 h-1.5 rounded-full bg-lime-400 mb-0.5 ml-0.5" /></label>
                    <Input
                      type="number"
                      step="0.01"
                      value={manual.hourlyRate}
                      onChange={e => handleManualChange('hourlyRate', e.target.value)}
                      placeholder="0.00"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-primary/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-body uppercase tracking-wider text-white/50">Position</label>
                    <Input
                      value={manual.position}
                      onChange={e => handleManualChange('position', e.target.value)}
                      placeholder="e.g. A1, Followspot"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-primary/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-body uppercase tracking-wider text-white/50">Event name</label>
                    <Input
                      value={manual.name}
                      onChange={e => handleManualChange('name', e.target.value)}
                      placeholder="e.g. Olivia Rodrigo"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-primary/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-body uppercase tracking-wider text-white/50">Venue</label>
                    <Input
                      value={manual.venue}
                      onChange={e => handleManualChange('venue', e.target.value)}
                      placeholder="e.g. The Met"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-primary/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-body uppercase tracking-wider text-white/50">Payroll co.</label>
                    <Input
                      value={manual.payrollCompany}
                      onChange={e => handleManualChange('payrollCompany', e.target.value)}
                      placeholder="e.g. AVTS"
                      className="h-9 text-xs font-mono bg-black/40 border-white/10 text-white/80 placeholder:text-white/20 focus:border-primary/40"
                    />
                  </div>
                </div>
              </div>

              {/* Additional dates — bulk-create the same shift across multiple days */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-body uppercase tracking-wider text-white/50">
                    Additional dates {extraDates.length > 0 && <span className="text-lime-400">({extraDates.length})</span>}
                  </label>
                  <button
                    type="button"
                    onClick={() => setExtraDates(prev => [...prev, ''])}
                    className="text-[11px] text-primary hover:text-primary/80 transition-colors"
                  >
                    + Add another date
                  </button>
                </div>
                {extraDates.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {extraDates.map((d, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={d}
                          onChange={e => setExtraDates(prev => prev.map((v, vi) => vi === i ? e.target.value : v))}
                          className="flex-1 h-9 rounded-md bg-black/40 border border-white/10 text-white/80 text-xs font-mono px-3 focus:outline-none focus:border-primary/40 [color-scheme:dark]"
                        />
                        <button
                          type="button"
                          onClick={() => setExtraDates(prev => prev.filter((_, vi) => vi !== i))}
                          className="text-white/40 hover:text-destructive transition-colors p-1.5"
                          aria-label="Remove date"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <p className="text-[10px] text-white/30">Same employer, time, rate & details on each date — you'll be able to tweak any of them before saving.</p>
                  </div>
                )}
              </div>

              <Button
                onClick={handleManualSubmit}
                disabled={!manual.date && extraDates.every(d => !d)}
                size="sm"
                className="w-full gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground border-0 font-medium mt-1"
              >
                <Check size={13} /> Add shift{[manual.date, ...extraDates].filter(Boolean).length > 1 ? 's' : ''}
              </Button>
            </div>
          )}

          {/* Unified paste-or-photo intake — one box handles offers, hours notes, and everything in between */}
          {!manualOpen && (
            <>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                disabled={isParsing}
                rows={6}
                placeholder={
                  step !== 'input'
                    ? 'Paste more to add it…'
                    : 'Paste a dispatch offer, hours note, personal schedule, or text here…'
                }
                className={cn(
                  'w-full bg-black/40 backdrop-blur-sm border border-white/10 rounded-md',
                  'px-3 py-2.5 text-xs text-mono text-white/80 placeholder:text-white/25',
                  'focus:outline-none focus:border-primary/40 focus:bg-black/50',
                  'resize-none transition-colors leading-relaxed',
                  isParsing && 'opacity-50 cursor-not-allowed',
                )}
                aria-label="Paste dispatch text or hours note"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={handleParse}
                  disabled={isParsing || !text.trim()}
                  size="sm"
                  className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground border-0 font-medium"
                >
                  {isParsing
                    ? <><Loader2 size={13} className="animate-spin" />{parseProgress || 'Parsing…'}</>
                    : <><Upload size={13} />Parse</>}
                </Button>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isParsing}
                  size="sm"
                  variant="outline"
                  className="gap-1.5 bg-black/40 border-white/10 text-white/80 hover:bg-black/60 hover:text-white"
                >
                  <Camera size={13} /> Photo
                </Button>
                {step === 'input' && (
                  <Button
                    onClick={() => setManualOpen(true)}
                    size="sm"
                    variant="outline"
                    className="gap-1.5 bg-secondary border-border text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                  >
                    <PenLine size={13} /> Manual
                  </Button>
                )}
                {step === 'review-jobs' && (
                  <span className="text-[11px] text-white/40 text-mono ml-auto">
                    {jobs.length} shift{jobs.length !== 1 ? 's' : ''} ready
                  </span>
                )}
                {step === 'review-hours' && (
                  <span className="text-[11px] text-white/40 text-mono ml-auto">
                    {hoursResults.length - hoursAccepted.size} of {hoursResults.length} left
                  </span>
                )}
                {step === 'review-events' && (
                  <span className="text-[11px] text-white/40 text-mono ml-auto">
                    {events.length} event{events.length !== 1 ? 's' : ''} ready
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {step === 'review-jobs' && jobs.length > 0 && (
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

          {selected.size >= 2 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-mono uppercase tracking-wider text-primary">
                  Batch edit {selected.size} selected
                </p>
                <button
                  onClick={removeSelectedJobs}
                  className="text-[11px] text-destructive hover:underline flex items-center gap-1"
                >
                  <Trash2 size={12} /> Remove selected
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <EmployerCombobox
                  value={batchEdit.client}
                  onChange={v => setBatchEdit(b => ({ ...b, client: v }))}
                  onSelectEmployer={emp => {
                    if (!batchEdit.hourlyRate && emp.defaultHourlyRate) setBatchEdit(b => ({ ...b, hourlyRate: emp.defaultHourlyRate!.toString() }));
                    if (!batchEdit.payrollCompany && emp.payrollCompany) setBatchEdit(b => ({ ...b, payrollCompany: emp.payrollCompany! }));
                  }}
                  placeholder="Client"
                  className="[&>input]:h-8 [&>input]:text-xs"
                />
                <Input
                  placeholder="Payroll co."
                  value={batchEdit.payrollCompany}
                  onChange={e => setBatchEdit(b => ({ ...b, payrollCompany: e.target.value }))}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="Venue"
                  value={batchEdit.venue}
                  onChange={e => setBatchEdit(b => ({ ...b, venue: e.target.value }))}
                  className="h-8 text-xs"
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Rate ($/hr)"
                  value={batchEdit.hourlyRate}
                  onChange={e => setBatchEdit(b => ({ ...b, hourlyRate: e.target.value }))}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={applyBatchEdit}
                disabled={!batchEdit.client.trim() && !batchEdit.payrollCompany.trim() && !batchEdit.venue.trim() && !batchEdit.hourlyRate.trim()}
              >
                Apply to {selected.size} shift{selected.size !== 1 ? 's' : ''}
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {jobs.map((job, i) => (
              <ShiftCard
                key={i}
                job={job}
                index={i}
                selected={selected.has(i)}
                conflict={conflictDates.has(job.date)}
                existingMatch={existingMatches.get(i)}
                onToggle={() => setSelected(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })}
                onChange={(field, value) => updateParsedJob(i, field, value)}
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

      {step === 'review-hours' && hoursResults.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xs text-mono uppercase tracking-wider text-muted-foreground">Match hours to shifts</h2>
          {hoursResults.map((result, idx) => {
            const accepted = hoursAccepted.has(idx);
            if (accepted) return null;
            return (
              <div key={idx} className="rounded-md border border-border bg-card p-3 space-y-2 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      {format(new Date(result.entry.date + 'T12:00:00'), 'MMM d')}
                    </span>
                    {result.entry.venue && <span className="text-xs font-medium truncate">{result.entry.venue}</span>}
                  </div>
                  {confidenceBadge(result.confidence)}
                </div>

                {(result.entry.startTime || result.entry.hoursWorked) && (
                  <p className="text-[11px] text-mono text-muted-foreground">
                    {result.entry.startTime && `${result.entry.startTime}${result.entry.endTime ? ` – ${result.entry.endTime}` : ''} · `}
                    {result.entry.hoursWorked ? `${result.entry.hoursWorked}h` : ''}
                    {result.entry.hourlyRate ? ` · $${result.entry.hourlyRate}/hr` : ''}
                    {result.entry.mealDuration !== undefined ? ` · ${result.entry.mealDuration === 0 ? 'no meal' : `${result.entry.mealDuration}min ${result.entry.mealOnClock ? 'on' : 'off'} clock`}` : ''}
                  </p>
                )}
                {result.entry.notes && !result.entry.startTime && (
                  <p className="text-[11px] text-muted-foreground italic">{result.entry.notes}</p>
                )}

                {result.matchedJob && (
                  <div className="rounded-lg bg-secondary/30 px-2.5 py-1.5 text-[11px]">
                    <p className="font-medium">{result.matchedJob.name}</p>
                    <p className="text-muted-foreground">{result.matchedJob.client}{result.matchedJob.venue ? ` · ${result.matchedJob.venue}` : ''}</p>
                  </div>
                )}

                {result.conflicts.length > 0 && (
                  <div className="space-y-0.5">
                    {result.conflicts.map((c, ci) => (
                      <p key={ci} className="text-[10px] text-warning flex items-center gap-1">
                        <AlertTriangle size={10} /> {c}
                      </p>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => handleApplyHours(result, idx)}
                  className={cn(
                    "w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-body transition-colors",
                    result.matchedJob
                      ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                      : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                  )}
                >
                  {result.matchedJob ? <><Check size={12} /> Apply to shift</> : <><Plus size={12} /> Create new shift</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {step === 'review-events' && events.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs text-mono uppercase tracking-wider text-muted-foreground">Review plans</h2>
            <button
              onClick={() => setSelectedEvents(selectedEvents.size === events.length ? new Set() : new Set(events.map((_, i) => i)))}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {selectedEvents.size === events.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {events.map((ev, i) => {
              const isSelected = selectedEvents.has(i);
              return (
                <div
                  key={i}
                  className={cn(
                    'rounded-md border transition-colors overflow-hidden p-3',
                    isSelected ? 'border-info/40 bg-info/5' : 'border-border bg-card opacity-50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => setSelectedEvents(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })}
                      className="rounded border-border shrink-0"
                      aria-label={`Select event on ${ev.date}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{ev.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {format(new Date(ev.date + 'T12:00:00'), 'EEE, MMM d')}
                        {ev.startTime ? ` · ${ev.startTime}${ev.endTime ? ` – ${ev.endTime}` : ''}` : ''}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <Button onClick={handleImportEvents} disabled={isImportingEvents || selectedEvents.size === 0} className="w-full gap-1.5">
            {isImportingEvents
              ? <><Loader2 size={14} className="animate-spin" />Saving…</>
              : <><Check size={14} />Save {selectedEvents.size} event{selectedEvents.size !== 1 ? 's' : ''}</>}
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
