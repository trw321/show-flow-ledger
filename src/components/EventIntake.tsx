import { useState, useRef, useMemo } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Upload, Camera, PenLine, Check, X, Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { CalendarEvent } from '@/lib/store';
import { cn } from '@/lib/utils';

type ParsedEvent = Omit<CalendarEvent, 'id' | 'createdAt'>;

const DAYS: { label: string; value: number }[] = [
  { label: 'Su', value: 0 },
  { label: 'M', value: 1 },
  { label: 'T', value: 2 },
  { label: 'W', value: 3 },
  { label: 'Th', value: 4 },
  { label: 'F', value: 5 },
  { label: 'Sa', value: 6 },
];

async function callAPI(url: string, key: string, body: object): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
}

interface Props {
  /** Anchor day this intake was opened from — seeds the manual recurrence range. */
  date: string;
  onCancel: () => void;
  onSaveMany: (events: ParsedEvent[]) => Promise<void>;
}

type Mode = 'choose' | 'manual';

// Unified "add a plan" intake — paste text or a photo (AI-classified the same
// way dispatch offers are, via smart-import's "events" branch, which already
// expands recurring text like "Spin — Mon/Wed/Fri" into one entry per date),
// or build a recurring set manually by picking days of the week + a range.
export default function EventIntake({ date, onCancel, onSaveMany }: Props) {
  const [mode, setMode] = useState<Mode>('choose');
  const [text, setText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [parsed, setParsed] = useState<ParsedEvent[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  // ── Manual/recurring form state ────────────────────────────────────────────
  const [days, setDays] = useState<Set<number>>(new Set());
  const [rangeStart, setRangeStart] = useState(date);
  const [rangeEnd, setRangeEnd] = useState(date);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const toggleDay = (d: number) => {
    setDays(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };

  const matchingDates = useMemo(() => {
    if (days.size === 0 || !rangeStart || !rangeEnd) return [];
    const start = new Date(rangeStart + 'T12:00:00');
    const end = new Date(rangeEnd + 'T12:00:00');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
    const out: string[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      if (days.has(cur.getDay())) out.push(format(cur, 'yyyy-MM-dd'));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [days, rangeStart, rangeEnd]);

  const runParse = async (payload: object) => {
    setIsParsing(true);
    try {
      const resp = await callAPI(`${supabaseUrl}/functions/v1/smart-import`, supabaseKey, payload);
      if (!resp.ok) throw new Error((await resp.json()).error || 'Failed to parse');
      const result = await resp.json();
      if (result.type && result.type !== 'events') {
        toast.error("That looks like work info, not a personal plan — use the Job Log intake for that instead.");
        return;
      }
      const events: ParsedEvent[] = result.events || [];
      if (events.length === 0) {
        toast.error('No plans found — check the text');
        return;
      }
      setParsed(events);
      setSelected(new Set(events.map((_, i) => i)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse');
    } finally {
      setIsParsing(false);
    }
  };

  const handleParseText = () => {
    if (!text.trim()) { toast.error('Paste something first'); return; }
    runParse({ text });
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await runParse({ imageBase64: base64, imageMimeType: file.type || 'image/jpeg' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveParsed = async () => {
    if (!parsed) return;
    const toSave = parsed.filter((_, i) => selected.has(i));
    if (toSave.length === 0) { toast.error('Select at least one plan'); return; }
    setIsSaving(true);
    try {
      await onSaveMany(toSave);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveManual = async () => {
    if (!title.trim()) { toast.error('Give it a name'); return; }
    if (matchingDates.length === 0) { toast.error('Pick at least one day of the week and a valid range'); return; }
    setIsSaving(true);
    try {
      await onSaveMany(matchingDates.map(d => ({
        title: title.trim(),
        date: d,
        startTime: startTime.trim() || undefined,
        endTime: endTime.trim() || undefined,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
      })));
    } finally {
      setIsSaving(false);
    }
  };

  // ── Review step, shared by paste + photo paths ─────────────────────────────
  if (parsed) {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-foreground">{parsed.length} plan{parsed.length !== 1 ? 's' : ''} found</p>
          <button
            onClick={() => setSelected(selected.size === parsed.length ? new Set() : new Set(parsed.map((_, i) => i)))}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {selected.size === parsed.length ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {parsed.map((ev, i) => (
            <label key={i} className="flex items-start gap-2 rounded-md border border-border bg-background/40 p-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(i)}
                onChange={() => setSelected(prev => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  return next;
                })}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <p className="font-medium truncate">{ev.title}</p>
                <p className="text-[10px] text-muted-foreground text-mono">
                  {format(new Date(ev.date + 'T12:00:00'), 'MMM d')}{ev.startTime ? ` · ${ev.startTime}` : ''}
                </p>
              </div>
            </label>
          ))}
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={() => { setParsed(null); setText(''); }}>Back</Button>
          <Button size="sm" disabled={isSaving} onClick={handleSaveParsed}>
            {isSaving ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Check size={13} className="mr-1" />}
            Add {selected.size || ''} plan{selected.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    );
  }

  // ── Manual recurring form ───────────────────────────────────────────────────
  if (mode === 'manual') {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
        <button
          type="button"
          onClick={() => setMode('choose')}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={11} /> Back
        </button>

        <Input placeholder="What's the plan?" value={title} onChange={e => setTitle(e.target.value)} className="h-8 text-sm" autoFocus />

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Repeats on</label>
          <div className="flex gap-1.5">
            {DAYS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={cn(
                  'w-8 h-8 rounded-full border text-[11px] font-medium flex items-center justify-center shrink-0 transition-colors',
                  days.has(d.value)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                )}
                aria-pressed={days.has(d.value)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">From</label>
            <Input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-body uppercase tracking-wider text-muted-foreground">Through</label>
            <Input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Start (opt.)" value={startTime} onChange={e => setStartTime(e.target.value)} className="h-8 text-xs" />
          <Input placeholder="End (opt.)" value={endTime} onChange={e => setEndTime(e.target.value)} className="h-8 text-xs" />
        </div>
        <Input placeholder="Location (optional)" value={location} onChange={e => setLocation(e.target.value)} className="h-8 text-xs" />
        <Input placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-xs" />

        {matchingDates.length > 0 && (
          <p className="text-[10px] text-muted-foreground">{matchingDates.length} date{matchingDates.length !== 1 ? 's' : ''} will be added</p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" disabled={isSaving || matchingDates.length === 0 || !title.trim()} onClick={handleSaveManual}>
            {isSaving ? <Loader2 size={13} className="mr-1 animate-spin" /> : <Check size={13} className="mr-1" />}
            Add {matchingDates.length || ''} plan{matchingDates.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    );
  }

  // ── Default: paste-or-photo, same shape as the Job Log intake box ──────────
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={isParsing}
        rows={3}
        placeholder="Paste a schedule, class times, or plans here…"
        className="w-full rounded-md bg-background/40 border border-border text-xs px-3 py-2 focus:outline-none focus:border-primary/40 resize-none placeholder:text-muted-foreground/50"
      />
      <div className="flex gap-2 justify-between">
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="outline" size="sm" onClick={() => setMode('manual')} className="gap-1.5">
            <PenLine size={13} /> Manual
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={isParsing} onClick={() => fileInputRef.current?.click()} className="gap-1.5">
            <Camera size={13} /> Photo
          </Button>
          <Button size="sm" disabled={isParsing} onClick={handleParseText} className="gap-1.5">
            {isParsing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            Parse
          </Button>
        </div>
      </div>
    </div>
  );
}
