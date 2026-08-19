import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Check, Plus, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useCelebration } from '@/components/Celebration';
import type { Job } from '@/lib/store';

// ── Time / cat scratch parsing ─────────────────────────────────────────────

function parseTimeToMins(t: string): number {
  const m = t.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
  if (!m) return NaN;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || '0');
  const ap = (m[3] || '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12;
  if (ap.startsWith('a') && h === 12) h = 0;
  return h * 60 + min;
}

function calcHours(start: string, end: string): number {
  let s = parseTimeToMins(start);
  let e = parseTimeToMins(end);
  if (isNaN(s) || isNaN(e)) return 0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

interface CatScratchEntry {
  date: string;
  venue?: string;
  startTime?: string;
  endTime?: string;
  mealDuration?: 0 | 30 | 45 | 60;
  mealOnClock?: boolean;
  mealPenalties?: number;
  paid: boolean;
  grossPay?: number;
  netPay?: number;
  payrollCompany?: string;
  position?: string;
  minimumHours?: number;
  notes?: string;
  raw: string;
  client?: string;
  hoursWorked?: number;
  hourlyRate?: number;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

interface MatchResult {
  entry: CatScratchEntry;
  matchedJob: Job | null;
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  conflicts: string[];
}

export interface EmployerHint {
  client: string;
  hourlyRate?: number;
  payrollCompany?: string;
  overtimeRule?: 'daily' | 'weekly' | 'none';
}

function parseCatScratch(text: string, year: number): { entries: CatScratchEntry[]; employerHint: EmployerHint | null } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: CatScratchEntry[] = [];

  // Shared context carried from a header line (e.g. "employer Odeum, project Hero, rate $37/hr")
  // down onto every weekly-hours entry that follows it — and, if the whole message is just
  // this header with no actual hours, doubles as a hint to quick-create the employer.
  const shared: { client?: string; project?: string; hourlyRate?: number; payrollCompany?: string; overtimeRule?: 'daily' | 'weekly' | 'none' } = {};

  for (const line of lines) {
    // Header/context line — no date of its own, just sets client/project/rate for later lines
    if (/\bemployer\b/i.test(line) || /\bproject\b/i.test(line) || /\$\s*\d+(?:\.\d+)?\s*\/\s*(?:hr|hour)\b/i.test(line)) {
      const empMatch = line.match(/employer\s+([^,]+?)(?:,|$)/i);
      const projMatch = line.match(/project\s+([^,]+?)(?:,|$)/i);
      const payrollMatch = line.match(/payroll(?:\s*co\.?|\s*company)?\s+([^,]+?)(?:,|$)/i)
        || line.match(/([^,]+?)\s+is\s+the\s+payroll(?:\s*co\.?|\s*company)?\b/i);
      const rateMatch = line.match(/\$\s*(\d+(?:\.\d+)?)\s*\/\s*(?:hr|hour)\b/i);
      if (empMatch) shared.client = empMatch[1].trim();
      if (projMatch) shared.project = projMatch[1].trim();
      if (payrollMatch) shared.payrollCompany = payrollMatch[1].trim();
      if (rateMatch) shared.hourlyRate = parseFloat(rateMatch[1]);

      if (/\bweekly OT\b|\bOT after 40\b|\bovertime after 40\b|\bPA\b|\bPennsylvania\b/i.test(line)) shared.overtimeRule = 'weekly';
      else if (/\bdaily OT\b|\bOT after 8\b|\bovertime after 8\b|\bCA\b|\bCalifornia\b/i.test(line)) shared.overtimeRule = 'daily';
      else if (/\bno (?:overtime|OT)\b/i.test(line)) shared.overtimeRule = 'none';

      if (shared.client || shared.project || shared.hourlyRate) continue;
    }

    // Weekly hours range — "june 1-6: 56 hrs" or "june 28-july 4: 35 hrs + x hrs PTO"
    const weekMatch = line.match(
      /^([a-z]+)\s+(\d{1,2})\s*[-–]\s*(?:[a-z]+\s+)?(\d{1,2})\s*:\s*(\d+(?:\.\d+)?)\s*hrs?\b(.*)$/i
    );
    if (weekMatch) {
      const [, startMonName, startDayStr, , hoursStr, rest] = weekMatch;
      const startMon = MONTH_NAMES[startMonName.toLowerCase()];
      if (startMon) {
        const startDay = parseInt(startDayStr);
        const date = `${year}-${String(startMon).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
        const hoursWorked = parseFloat(hoursStr);

        let notes = `Week of ${startMonName[0].toUpperCase()}${startMonName.slice(1).toLowerCase()} ${startDay}`;
        const ptoMatch = rest.match(/\+\s*(x|\d+(?:\.\d+)?)\s*hrs?\s*PTO/i);
        if (ptoMatch) {
          notes += /^x$/i.test(ptoMatch[1])
            ? ' + PTO (amount unspecified — verify)'
            : ` + ${ptoMatch[1]} hrs PTO`;
        }

        entries.push({
          date,
          venue: shared.project,
          client: shared.client,
          payrollCompany: shared.payrollCompany,
          hourlyRate: shared.hourlyRate,
          hoursWorked,
          paid: false,
          notes,
          raw: line,
        });
        continue;
      }
    }

    // Skip remaining header/non-date lines
    const dateMatch = line.match(/(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?/);
    if (!dateMatch) continue;

    const month = parseInt(dateMatch[1]);
    const day = parseInt(dateMatch[2]);
    const yr = dateMatch[3] ? (dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3])) : year;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const date = `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const rest = line.slice(dateMatch[0].length).trim();

    // Times
    const timeMatch = rest.match(/(\d{1,2}(?::\d{2})?(?:am|pm|a|p)?)\s*[-–to]+\s*(\d{1,2}(?::\d{2})?(?:am|pm|a|p)?)/i);
    let startTime: string | undefined;
    let endTime: string | undefined;
    if (timeMatch) {
      const fmt = (t: string) => {
        const m = t.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
        if (!m) return t;
        let h = parseInt(m[1]);
        const min = m[2] || '00';
        const ap = (m[3] || '').toLowerCase();
        if (ap.startsWith('p') && h < 12) h += 12;
        if (ap.startsWith('a') && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${min}`;
      };
      startTime = fmt(timeMatch[1]);
      endTime = fmt(timeMatch[2]);
    }

    // Meal duration + on/off clock — "YWA"/"NWA" kept for backward compatibility
    // (YWA = 1hr off clock, NWA = 30min on clock), plus explicit "30 off",
    // "45min on clock", "zero"/"no meal" for any of the four durations.
    let mealDuration: 0 | 30 | 45 | 60 | undefined;
    let mealOnClock: boolean | undefined;
    const minuteMealMatch = rest.match(/\b(\d{1,3})\s*(?:min|minute)s?\b.{0,12}?\b(on|off)\b|\b(on|off)\b.{0,12}?\b(\d{1,3})\s*(?:min|minute)s?\b/i);
    if (/\bYWA\b/i.test(rest)) { mealDuration = 60; mealOnClock = false; }
    else if (/\bNWA\b/i.test(rest)) { mealDuration = 30; mealOnClock = true; }
    else if (minuteMealMatch) {
      const mins = parseInt(minuteMealMatch[1] ?? minuteMealMatch[4]);
      const onOff = (minuteMealMatch[2] ?? minuteMealMatch[3]).toLowerCase();
      if (mins === 0 || mins === 30 || mins === 45 || mins === 60) {
        mealDuration = mins as 0 | 30 | 45 | 60;
        mealOnClock = onOff === 'on';
      }
    } else if (/\bzero\b|\bno meal\b/i.test(rest)) {
      mealDuration = 0;
    }

    // Meal penalties
    const mpMatch = rest.match(/(\d+)\s*MP/i);
    const mealPenalties = mpMatch ? parseInt(mpMatch[1]) : undefined;

    // Paid
    const paid = /💵|PAID/i.test(rest);

    // Pay amounts gross//net
    const payMatch = rest.match(/\$?([\d,]+\.?\d*)\s*\/\/\s*\$?([\d,]+\.?\d*)/);
    const singlePayMatch = rest.match(/\$\s*([\d,]+\.?\d*)/);
    let grossPay: number | undefined;
    let netPay: number | undefined;
    if (payMatch) {
      grossPay = parseFloat(payMatch[1].replace(',', ''));
      netPay = parseFloat(payMatch[2].replace(',', ''));
    } else if (singlePayMatch) {
      grossPay = parseFloat(singlePayMatch[1].replace(',', ''));
    }

    // Minimum hours
    const minMatch = rest.match(/\((\d+)h?\s*min(?:i|imum)?\)/i) || rest.match(/(\d+)hr?\s*min(?:i|imum)?/i);
    const minimumHours = minMatch ? parseInt(minMatch[1]) : undefined;

    // Position
    const posMatch = rest.match(/head\s+(\w+)/i);
    const position = posMatch ? `Head ${posMatch[1]}` : undefined;

    // Payroll company — look for known names or ALL CAPS words after time
    const companies = ['LIVE NATION', 'IATSE', 'HUGHSTON', 'AIRBNB', 'AIR BNB'];
    let payrollCompany: string | undefined;
    for (const co of companies) {
      if (rest.toUpperCase().includes(co)) { payrollCompany = co; break; }
    }

    // Venue — first capitalized phrase before time or known keyword
    const venueMatch = rest.match(/^([A-Za-z][A-Za-z\s]+?)(?:\s+\d|\s+💵|\s+PAID|$)/);
    const venue = venueMatch ? venueMatch[1].trim() : undefined;

    entries.push({
      date, venue, startTime, endTime, mealDuration, mealOnClock, mealPenalties,
      paid, grossPay, netPay, payrollCompany, position, minimumHours,
      notes: rest,
      raw: line,
    });
  }

  const employerHint: EmployerHint | null = shared.client
    ? { client: shared.client, hourlyRate: shared.hourlyRate, payrollCompany: shared.payrollCompany, overtimeRule: shared.overtimeRule }
    : null;

  return { entries, employerHint };
}

function scoreMatch(entry: CatScratchEntry, job: Job): { score: number; conflicts: string[] } {
  let score = 0;
  const conflicts: string[] = [];

  // Date match is prerequisite
  if (job.date !== entry.date) return { score: 0, conflicts: [] };
  score += 50;

  // Venue fuzzy match
  if (entry.venue && job.venue) {
    const ev = entry.venue.toLowerCase();
    const jv = job.venue.toLowerCase();
    const evWords = ev.split(/\s+/);
    const jvWords = jv.split(/\s+/);
    const shared = evWords.filter(w => w.length > 2 && jvWords.some(jw => jw.includes(w) || w.includes(jw)));
    if (shared.length > 0) score += Math.min(30, shared.length * 15);
    else if (ev.length > 2 && jv.includes(ev.slice(0, 4))) score += 10;
    else conflicts.push(`Venue: cat scratch says "${entry.venue}", job says "${job.venue}"`);
  } else if (entry.venue && job.client) {
    const ev = entry.venue.toLowerCase();
    const jc = job.client.toLowerCase();
    if (ev.includes(jc.slice(0, 4)) || jc.includes(ev.slice(0, 4))) score += 15;
  }

  // Start time match
  if (entry.startTime && job.startTime) {
    const em = parseTimeToMins(entry.startTime);
    const jm = parseTimeToMins(job.startTime);
    if (!isNaN(em) && !isNaN(jm)) {
      const diff = Math.abs(em - jm);
      if (diff === 0) score += 20;
      else if (diff <= 30) score += 10;
      else conflicts.push(`Start time: cat scratch says ${entry.startTime}, job says ${job.startTime}`);
    }
  }

  return { score, conflicts };
}

function matchEntries(entries: CatScratchEntry[], jobs: Job[]): MatchResult[] {
  return entries.map(entry => {
    const candidates = jobs.filter(j => j.date === entry.date);
    if (candidates.length === 0) {
      return { entry, matchedJob: null, score: 0, confidence: 'none', conflicts: [] };
    }

    let best: Job | null = null;
    let bestScore = 0;
    let bestConflicts: string[] = [];

    for (const job of candidates) {
      const { score, conflicts } = scoreMatch(entry, job);
      if (score > bestScore) { best = job; bestScore = score; bestConflicts = conflicts; }
    }

    const confidence: MatchResult['confidence'] =
      bestScore >= 80 ? 'high' :
      bestScore >= 50 ? 'medium' :
      bestScore > 0 ? 'low' : 'none';

    return { entry, matchedJob: best, score: bestScore, confidence, conflicts: bestConflicts };
  });
}

function confidenceBadge(c: MatchResult['confidence']) {
  if (c === 'high') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-success/20 text-success">🟢 High</span>;
  if (c === 'medium') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">🟡 Medium</span>;
  if (c === 'low') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-destructive/20 text-destructive">🔴 Low</span>;
  return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">No match</span>;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CatScratchButton({ className }: { className?: string }) {
  const { data, updateJob, addJob, addIncome, addEmployer } = useData();
  const { fire: fireCelebration, Burst } = useCelebration();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [step, setStep] = useState<'input' | 'review' | 'employer'>('input');
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [acceptedKeys, setAcceptedKeys] = useState<Set<number>>(new Set());
  const [pendingEmployer, setPendingEmployer] = useState<EmployerHint | null>(null);
  const [justSavedEmployer, setJustSavedEmployer] = useState<string | null>(null);
  const [activeJobIds, setActiveJobIds] = useState<Set<string>>(new Set());
  const [insertedPrefixes, setInsertedPrefixes] = useState<Record<string, string>>({});

  // Only jobs that still need hours logged — once hoursWorked is set (via this
  // flow or elsewhere, e.g. Calendar), the job drops out of this list.
  const recentJobs = [...data.jobs]
    .filter(j => (j.hoursWorked ?? 0) === 0)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  const toggleJobLine = (job: Job) => {
    setJustSavedEmployer(null);
    if (activeJobIds.has(job.id)) {
      const prefix = insertedPrefixes[job.id]?.trim();
      if (prefix) {
        setText(prev => prev.split('\n').filter(line => !line.trimStart().startsWith(prefix)).join('\n'));
      }
      setActiveJobIds(prev => { const next = new Set(prev); next.delete(job.id); return next; });
      setInsertedPrefixes(prev => { const next = { ...prev }; delete next[job.id]; return next; });
    } else {
      const dateStr = format(new Date(job.date + 'T12:00:00'), 'M.d.yy');
      const base = [dateStr, job.venue || job.name].filter(Boolean).join(' ');
      const label = job.startTime ? `${base} ${job.startTime} - ` : `${base} `;
      setText(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${label}` : label));
      setActiveJobIds(prev => new Set(prev).add(job.id));
      setInsertedPrefixes(prev => ({ ...prev, [job.id]: label }));
    }
  };

  const handleParse = () => {
    if (!text.trim()) return;
    const year = new Date().getFullYear();
    const { entries, employerHint } = parseCatScratch(text, year);
    if (entries.length === 0) {
      if (employerHint) {
        setPendingEmployer(employerHint);
        setStep('employer');
        return;
      }
      toast.error('No dates found — check your format');
      return;
    }
    const results = matchEntries(entries, data.jobs);
    setMatchResults(results);
    setAcceptedKeys(new Set());
    setStep('review');
  };

  const handleSaveEmployer = async () => {
    if (!pendingEmployer) return;
    await addEmployer({
      name: pendingEmployer.client,
      defaultHourlyRate: pendingEmployer.hourlyRate,
      payrollCompany: pendingEmployer.payrollCompany,
      overtimeRule: pendingEmployer.overtimeRule ?? 'daily',
      weeklyOvertimeThresholdHours: pendingEmployer.overtimeRule === 'weekly' ? 40 : undefined,
      dailyOvertimeThresholdHours: (pendingEmployer.overtimeRule ?? 'daily') === 'daily' ? 8 : undefined,
      overtimeMultiplier: 1.5,
      doubletimeMultiplier: 2.0,
    });
    toast.success(`${pendingEmployer.client} saved — now add this employer's hours below`);
    setStep('input');
    setJustSavedEmployer(pendingEmployer.client);
    setPendingEmployer(null);
    // Keep `text` as-is: the header line stays in the textarea so the employer
    // context (client/rate/OT rule) carries into the next parse once hours are added.
  };

  const handleApply = async (result: MatchResult, idx: number) => {
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
      await updateJob(matchedJob.id, updates);
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
    const nextAccepted = new Set(acceptedKeys).add(idx);
    setAcceptedKeys(nextAccepted);
    fireCelebration();
    toast.success(matchedJob ? 'Job updated' : 'New job created');

    // Once every entry in this batch has been applied, reset back to a
    // clean input — the pasted text was a one-time instruction, not
    // something that should linger as a re-submittable suggestion.
    if (nextAccepted.size === matchResults.length) {
      setTimeout(() => {
        setStep('input');
        setText('');
        setMatchResults([]);
        setAcceptedKeys(new Set());
        setActiveJobIds(new Set());
        setInsertedPrefixes({});
      }, 900);
    }
  };

  return (
    <>
      <Burst />
      <button
        onClick={() => { setOpen(true); setStep('input'); setText(''); setJustSavedEmployer(null); setActiveJobIds(new Set()); setInsertedPrefixes({}); }}
        className={cn(
          "btn-bounce flex items-center gap-3 px-4 py-3 rounded-xl bg-black/40 border border-white/10 hover:border-amber-500/40 transition-colors text-left",
          className
        )}
      >
        <span className="text-xl">⏳</span>
        <div>
          <p className="text-sm text-white/80 font-medium">Add Hours</p>
          <p className="text-[11px] text-white/40">Paste notes — match hours to logged jobs, or add a new employer</p>
        </div>
      </button>

      <Dialog open={open} onOpenChange={o => { if (!o) { setOpen(false); setStep('input'); setJustSavedEmployer(null); setActiveJobIds(new Set()); setInsertedPrefixes({}); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Add Hours</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Paste your notes and I'll match them to your logged jobs</p>
          </DialogHeader>

          {step === 'input' && (
            <div className="space-y-3 min-w-0">
              {justSavedEmployer && (
                <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
                  ✓ {justSavedEmployer} saved. Add their work dates below (e.g. "june 1-6: 56 hrs") and parse again.
                </div>
              )}
              {recentJobs.length > 0 && (
                <div className="space-y-1.5 min-w-0">
                  <p className="text-[10px] text-mono uppercase tracking-wider text-muted-foreground">Recently added — tap to insert, tap again to remove</p>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5 min-w-0">
                    {recentJobs.map(job => {
                      const active = activeJobIds.has(job.id);
                      return (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => toggleJobLine(job)}
                          className={cn(
                            'shrink-0 rounded-xl border transition-colors px-3 py-2 text-left',
                            active ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:border-primary/40 hover:bg-secondary/50'
                          )}
                        >
                          <p className="text-xs font-medium truncate max-w-[9rem]">{job.venue || job.name}</p>
                          <p className="text-[10px] text-mono text-muted-foreground">{format(new Date(job.date + 'T12:00:00'), 'MMM d')}{job.startTime && ` · ${job.startTime}`}{job.client && ` · ${job.client}`}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <textarea
                value={text}
                onChange={e => { setText(e.target.value); setJustSavedEmployer(null); }}
                rows={10}
                placeholder={`5.7.26 moscone esplanade 5pm-11:30 PAID 💵\n5.9.26 civic center 8am-1p 💵\n5.15.26 chase center 10a-3p YWA LIVE NATION`}
                className="w-full rounded-xl border border-border bg-secondary/20 px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 resize-none leading-relaxed"
              />
              <Button onClick={handleParse} disabled={!text.trim()} className="w-full">
                Parse & match
              </Button>
            </div>
          )}

          {step === 'employer' && pendingEmployer && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                No hours in that text, but it looks like you're describing an employer — save it as one?
              </p>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-1.5">
                <p className="text-sm font-medium">{pendingEmployer.client}</p>
                <p className="text-xs text-muted-foreground">
                  {pendingEmployer.hourlyRate ? `$${pendingEmployer.hourlyRate}/hr` : 'no rate detected'}
                  {pendingEmployer.payrollCompany ? ` · payroll: ${pendingEmployer.payrollCompany}` : ''}
                  {pendingEmployer.overtimeRule === 'weekly' && ' · OT after 40h/wk'}
                  {pendingEmployer.overtimeRule === 'daily' && ' · OT after 8h/day'}
                  {pendingEmployer.overtimeRule === 'none' && ' · no overtime'}
                  {!pendingEmployer.overtimeRule && ' · overtime rule not detected — defaults to daily, edit later in Settings'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => { setStep('input'); setPendingEmployer(null); }} className="flex-1">
                  ← Back
                </Button>
                <Button onClick={handleSaveEmployer} className="flex-1">
                  Save employer
                </Button>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {matchResults.length - acceptedKeys.size} of {matchResults.length} entries left
                </p>
                <button onClick={() => setStep('input')} className="text-xs text-primary hover:underline">← Back</button>
              </div>
              {matchResults.map((result, idx) => {
                const accepted = acceptedKeys.has(idx);
                if (accepted) return null;
                return (
                  <div key={idx} className="rounded-xl border border-border bg-card p-3 space-y-2 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          {format(new Date(result.entry.date + 'T12:00:00'), 'MMM d')}
                        </span>
                        {result.entry.client && <span className="text-xs font-medium truncate">{result.entry.client}</span>}
                        {result.entry.venue && <span className="text-xs text-muted-foreground truncate">· {result.entry.venue}</span>}
                        {result.entry.paid && <span className="text-sm">💵</span>}
                      </div>
                      {confidenceBadge(result.confidence)}
                    </div>

                    {(result.entry.startTime || result.entry.hoursWorked) && (
                      <p className="text-[11px] text-mono text-muted-foreground">
                        {result.entry.startTime && `${result.entry.startTime}${result.entry.endTime ? ` – ${result.entry.endTime}` : ''} · `}
                        {result.entry.hoursWorked ? `${result.entry.hoursWorked}h` : ''}
                        {result.entry.hourlyRate ? ` · $${result.entry.hourlyRate}/hr` : ''}
                        {result.entry.mealDuration !== undefined ? ` · ${result.entry.mealDuration === 0 ? 'no meal' : `${result.entry.mealDuration}min ${result.entry.mealOnClock ? 'on' : 'off'} clock`}` : ''}
                        {result.entry.mealPenalties ? ` · ${result.entry.mealPenalties}MP` : ''}
                        {result.entry.grossPay ? ` · $${result.entry.grossPay}` : ''}
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
                          <p key={ci} className="text-[10px] text-amber-400 flex items-center gap-1">
                            <AlertTriangle size={10} /> {c}
                          </p>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => handleApply(result, idx)}
                      className={cn(
                        "w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-body transition-colors",
                        result.matchedJob
                          ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                          : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                      )}
                    >
                      {result.matchedJob ? <><Check size={12} /> Apply to job</> : <><Plus size={12} /> Create new job</>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
