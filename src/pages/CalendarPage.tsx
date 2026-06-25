import { useState, useMemo, useEffect } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronLeft, ChevronRight, Star, ArrowLeft, NotebookPen, Check, Plus, AlertTriangle } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, subMonths, isSameMonth, isSameDay, isToday, isPast } from 'date-fns';
import type { Job } from '@/lib/store';
import { calculateDayPay, getDayMultiplier } from '@/lib/payCalc';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const statusDot: Record<Job['status'], string> = {
  upcoming: 'bg-accent',
  'in-progress': 'bg-primary',
  completed: 'bg-success',
  cancelled: 'bg-destructive',
};

const statusColors: Record<Job['status'], string> = {
  upcoming: 'bg-accent/20 text-accent border-accent/30',
  'in-progress': 'bg-primary/20 text-primary border-primary/30',
  completed: 'bg-success/20 text-success border-success/30',
  cancelled: 'bg-destructive/20 text-destructive border-destructive/30',
};

const statusLabel: Record<Job['status'], string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

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

// ── Cat scratch parser ────────────────────────────────────────────────────────

interface CatScratchEntry {
  date: string;
  venue?: string;
  startTime?: string;
  endTime?: string;
  mealType?: 'YWA' | 'NWA';
  mealPenalties?: number;
  paid: boolean;
  grossPay?: number;
  netPay?: number;
  payrollCompany?: string;
  position?: string;
  minimumHours?: number;
  notes?: string;
  raw: string;
}

interface MatchResult {
  entry: CatScratchEntry;
  matchedJob: Job | null;
  score: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  conflicts: string[];
}

function parseCatScratch(text: string, year: number): CatScratchEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: CatScratchEntry[] = [];

  for (const line of lines) {
    // Skip header lines (no date pattern)
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

    // Meal type
    const mealType = /\bYWA\b/i.test(rest) ? 'YWA' : /\bNWA\b/i.test(rest) ? 'NWA' : undefined;

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
      date, venue, startTime, endTime, mealType, mealPenalties,
      paid, grossPay, netPay, payrollCompany, position, minimumHours,
      notes: rest,
      raw: line,
    });
  }

  return entries;
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

// ── Job detail view ───────────────────────────────────────────────────────────

function JobDetailView({ job, onBack, onSave }: {
  job: Job;
  onBack: () => void;
  onSave: (updates: Partial<Job>) => void;
}) {
  const [endTime, setEndTime] = useState(job.endTime ?? '');
  const [hoursWorked, setHoursWorked] = useState(job.hoursWorked?.toString() ?? '');
  const [minimumHours, setMinimumHours] = useState(job.minimumHours?.toString() ?? '');
  const [payrollCompany, setPayrollCompany] = useState(job.payrollCompany ?? '');
  const [mealType, setMealType] = useState<Job['mealType']>(job.mealType ?? undefined);

  useEffect(() => {
    setEndTime(job.endTime ?? '');
    setHoursWorked(job.hoursWorked?.toString() ?? '');
    setMinimumHours(job.minimumHours?.toString() ?? '');
    setPayrollCompany(job.payrollCompany ?? '');
    setMealType(job.mealType ?? undefined);
  }, [job.id]);

  const handleEndTimeChange = (val: string) => {
    setEndTime(val);
    if (job.startTime && val) {
      const h = calcHours(job.startTime, val);
      if (h > 0) setHoursWorked(parseFloat(h.toFixed(2)).toString());
    }
  };

  const actualHours = parseFloat(hoursWorked) || 0;
  const minHours = parseFloat(minimumHours) || 0;
  const billableHours = Math.max(actualHours, minHours);
  const minimumApplied = minHours > 0 && actualHours < minHours && actualHours > 0;
  const rate = job.hourlyRate ?? 0;
  const payPreview = rate > 0 && billableHours > 0
    ? calculateDayPay(actualHours, rate, minHours, job.mealPenalties ?? 0, 1, mealType)
    : null;

  const handleSave = () => {
    const updates: Partial<Job> = {};
    if (endTime !== (job.endTime ?? '')) updates.endTime = endTime || undefined;
    if (actualHours > 0) { updates.hoursWorked = actualHours; updates.status = 'completed'; }
    const parsedMin = parseFloat(minimumHours);
    if (!isNaN(parsedMin) && parsedMin !== (job.minimumHours ?? 0)) updates.minimumHours = parsedMin > 0 ? parsedMin : undefined;
    if (payrollCompany !== (job.payrollCompany ?? '')) updates.payrollCompany = payrollCompany.trim() || undefined;
    if (mealType !== (job.mealType ?? undefined)) updates.mealType = mealType;
    onSave(updates);
  };

  const hasChanges =
    endTime !== (job.endTime ?? '') ||
    hoursWorked !== (job.hoursWorked?.toString() ?? '') ||
    minimumHours !== (job.minimumHours?.toString() ?? '') ||
    payrollCompany !== (job.payrollCompany ?? '') ||
    mealType !== (job.mealType ?? undefined);

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors p-1 -ml-1 rounded-lg hover:bg-secondary">
            <ArrowLeft size={16} />
          </button>
          <DialogTitle className="text-mono text-sm">{job.name}</DialogTitle>
        </div>
      </DialogHeader>
      <div className="space-y-4">
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-mono uppercase tracking-wider border", statusColors[job.status])}>
          {statusLabel[job.status]}
        </span>
        <div className="rounded-xl border border-border bg-secondary/10 p-3 space-y-2">
          {job.client && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Client</span><span className="font-medium text-xs">{job.client}</span></div>}
          {(job.payrollCompany || payrollCompany) && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Employer / Payroll</span><span className="font-medium text-xs">{payrollCompany || job.payrollCompany}</span></div>}
          {job.venue && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Venue</span><span className="font-medium text-xs">{job.venue}</span></div>}
          {job.date && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Date</span><span className="font-medium text-xs text-mono">{format(new Date(job.date + 'T12:00:00'), 'EEE, MMM d, yyyy')}</span></div>}
          {job.jobNumber && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Job #</span><span className="font-medium text-xs text-mono">{job.jobNumber}</span></div>}
          {job.startTime && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Start</span><span className="font-medium text-xs text-mono">{job.startTime}</span></div>}
          {rate > 0 && <div className="flex justify-between"><span className="text-muted-foreground text-xs">Rate</span><span className="font-medium text-xs text-mono">${rate}/hr</span></div>}
        </div>
        {payPreview && (
          <div className={cn("rounded-xl border p-3 space-y-1.5", minimumApplied ? "border-accent/40 bg-accent/5" : "border-success/30 bg-success/5")}>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{minimumApplied ? `Worked ${actualHours}h — paid for ${billableHours}h minimum` : `Worked ${actualHours}h`}</span>
              <span className="font-bold text-sm text-mono text-success">${payPreview.totalPay.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            {minimumApplied && <p className="text-[10px] text-accent font-medium">{minHours}h minimum call — contract guarantees payment for {minHours}h</p>}
          </div>
        )}
        <div className="space-y-3">
          <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/50 uppercase">Update Job</p>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Employer / Payroll Company</label>
            <Input value={payrollCompany} onChange={e => setPayrollCompany(e.target.value)} placeholder="e.g. Nolan AV, Live Nation" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">End Time</label>
            <Input value={endTime} onChange={e => handleEndTimeChange(e.target.value)} placeholder="e.g. 18:00 or 6:00 PM" className="h-9 text-sm text-mono" />
            {job.startTime && endTime && calcHours(job.startTime, endTime) > 0 && (
              <p className="text-[10px] text-mono text-muted-foreground">{job.startTime} → {endTime} = <span className="text-primary font-semibold">{calcHours(job.startTime, endTime).toFixed(1)}h</span></p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Hours Worked</label>
            <Input type="number" min="0" step="0.5" value={hoursWorked} onChange={e => setHoursWorked(e.target.value)} placeholder="e.g. 3" className="h-9 text-sm text-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Min. Call</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[{ hours: 4, label: '4h', sub: 'Split shift' }, { hours: 5, label: '5h', sub: 'Normal call' }, { hours: 8, label: '8h', sub: 'Lead role' }].map(({ hours, label, sub }) => {
                const active = minimumHours === hours.toString();
                return (
                  <button key={hours} type="button" onClick={() => setMinimumHours(active ? '' : hours.toString())} className={cn("rounded-xl border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                    <p className={cn("text-sm font-bold text-mono", active && "text-primary")}>{label}</p>
                    <p className="text-[9px] leading-tight mt-0.5 opacity-70">{sub}</p>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Meal Break</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[{ value: 'YWA' as const, label: 'YWA', sub: '1hr walk away' }, { value: 'NWA' as const, label: 'NWA', sub: '30min on clock' }, { value: undefined, label: 'None', sub: 'No meal' }].map(({ value, label, sub }) => {
                const active = mealType === value;
                return (
                  <button key={label} type="button" onClick={() => setMealType(active ? undefined : value)} className={cn("rounded-xl border py-2 px-1 text-center transition-colors", active ? "bg-primary/15 border-primary/50 text-primary" : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30")}>
                    <p className={cn("text-sm font-bold text-mono", active && "text-primary")}>{label}</p>
                    <p className="text-[9px] leading-tight mt-0.5 opacity-70">{sub}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onBack}>Cancel</Button>
          <Button size="sm" className="flex-1" disabled={!hasChanges} onClick={handleSave}>Save</Button>
        </div>
      </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { data, updateJob, addJob, addIncome } = useData();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [showCatScratch, setShowCatScratch] = useState(false);
  const [catScratchText, setCatScratchText] = useState('');
  const [catScratchStep, setCatScratchStep] = useState<'input' | 'review'>('input');
  const [matchResults, setMatchResults] = useState<MatchResult[]>([]);
  const [acceptedKeys, setAcceptedKeys] = useState<Set<number>>(new Set());

  const jobsByDate = useMemo(() => {
    const map: Record<string, Job[]> = {};
    data.jobs.forEach(job => { if (!map[job.date]) map[job.date] = []; map[job.date].push(job); });
    return map;
  }, [data.jobs]);

  const payByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      let dayPay = 0;
      for (const job of jobs) {
        const hours = job.hoursWorked ?? 0;
        if (hours <= 0) continue;
        const rate = job.hourlyRate || 0;
        const multiplier = getDayMultiplier(date, job.client, data.jobs, job.has6th7thDayRule || false);
        const result = calculateDayPay(hours, rate, job.minimumHours || 0, job.mealPenalties || 0, multiplier, job.mealType);
        dayPay += result.totalPay;
      }
      if (dayPay > 0) map[date] = dayPay;
    }
    return map;
  }, [jobsByDate, data.jobs]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });
    const days: Date[] = [];
    let d = start;
    while (d <= end) { days.push(d); d = addDays(d, 1); }
    return days;
  }, [currentDate]);

  const weeks = useMemo(() => {
    const result: Date[][] = [];
    for (let i = 0; i < monthDays.length; i += 7) result.push(monthDays.slice(i, i + 7));
    return result;
  }, [monthDays]);

  const weekStats = useMemo(() => weeks.map(week => {
    let hours = 0, pay = 0, jobCount = 0;
    week.forEach(day => {
      if (!isSameMonth(day, currentDate)) return;
      const key = format(day, 'yyyy-MM-dd');
      jobCount += (jobsByDate[key] || []).length;
      hours += (jobsByDate[key] || []).reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
      pay += payByDate[key] || 0;
    });
    return { hours, pay, jobCount, weekStart: week[0] };
  }), [weeks, jobsByDate, payByDate, currentDate]);

  const monthStats = useMemo(() => {
    const prefix = format(currentDate, 'yyyy-MM');
    let totalHours = 0, totalPay = 0, totalJobs = 0;
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      if (!date.startsWith(prefix)) continue;
      totalJobs += jobs.length;
      totalHours += jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
      totalPay += payByDate[date] || 0;
    }
    return { totalHours, totalPay, totalJobs };
  }, [jobsByDate, payByDate, currentDate]);

  const yearStats = useMemo(() => {
    const prefix = `${currentYear}-`;
    let totalJobs = 0, totalHours = 0, totalPay = 0;
    for (const [date, jobs] of Object.entries(jobsByDate)) {
      if (!date.startsWith(prefix)) continue;
      totalJobs += jobs.length;
      totalHours += jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
      totalPay += payByDate[date] || 0;
    }
    return { totalJobs, totalHours, totalPay };
  }, [jobsByDate, payByDate, currentYear]);

  const today = new Date();
  const selectedJobs = selectedDate ? (jobsByDate[selectedDate] || []) : [];
  const selectedJob = selectedJobId ? data.jobs.find(j => j.id === selectedJobId) ?? null : null;
  const closeDialog = () => { setSelectedDate(null); setSelectedJobId(null); };

  const handleParseCatScratch = () => {
    if (!catScratchText.trim()) return;
    const year = currentDate.getFullYear();
    const entries = parseCatScratch(catScratchText, year);
    if (entries.length === 0) { toast.error('No dates found — check your cat scratch format'); return; }
    const results = matchEntries(entries, data.jobs);
    setMatchResults(results);
    setAcceptedKeys(new Set());
    setCatScratchStep('review');
  };

  const handleApplyMatch = async (result: MatchResult, idx: number) => {
    const { entry, matchedJob } = result;
    if (matchedJob) {
      const updates: Partial<Job> = {};
      if (entry.endTime && !matchedJob.endTime) updates.endTime = entry.endTime;
      if (entry.mealType && !matchedJob.mealType) updates.mealType = entry.mealType;
      if (entry.mealPenalties && !matchedJob.mealPenalties) updates.mealPenalties = entry.mealPenalties;
      if (entry.minimumHours && !matchedJob.minimumHours) updates.minimumHours = entry.minimumHours;
      if (entry.payrollCompany && !matchedJob.payrollCompany) updates.payrollCompany = entry.payrollCompany;
      if (entry.startTime && !matchedJob.startTime) updates.startTime = entry.startTime;
      if (entry.endTime && entry.startTime) {
        const h = calcHours(entry.startTime, entry.endTime);
        if (h > 0 && !matchedJob.hoursWorked) { updates.hoursWorked = h; updates.status = 'completed'; }
      }
      await updateJob(matchedJob.id, updates);
      if (entry.paid && entry.grossPay) {
        await addIncome({
          jobId: matchedJob.id,
          client: matchedJob.client,
          description: `Cat scratch — ${format(new Date(entry.date + 'T12:00:00'), 'MMM d')}`,
          amount: entry.grossPay,
          date: entry.date,
          status: 'paid',
        });
      }
    } else {
      await addJob({
        name: entry.venue || 'New shift',
        client: entry.payrollCompany || 'Unknown',
        venue: entry.venue || '',
        date: entry.date,
        startTime: entry.startTime,
        endTime: entry.endTime,
        status: 'upcoming',
        mealType: entry.mealType,
        mealPenalties: entry.mealPenalties,
        minimumHours: entry.minimumHours,
        payrollCompany: entry.payrollCompany,
        notes: entry.notes || '',
        has6th7thDayRule: false,
        hasVacationPay: false,
      });
    }
    setAcceptedKeys(prev => new Set([...prev, idx]));
    toast.success(matchedJob ? 'Job updated from cat scratch' : 'New job created');
  };

  const confidenceBadge = (c: MatchResult['confidence']) => {
    if (c === 'high') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-success/20 text-success">🟢 High</span>;
    if (c === 'medium') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">🟡 Medium</span>;
    if (c === 'low') return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-destructive/20 text-destructive">🔴 Low</span>;
    return <span className="text-[10px] font-body px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">No match</span>;
  };

  return (
    <>
      <PageHeader title="Calendar" description="Your month at a glance" />

      <div className="flex items-center gap-2 mb-3">
        <div className="flex flex-1 bg-secondary/30 rounded-lg p-0.5">
          <button onClick={() => setViewMode('month')} className={cn("flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors", viewMode === 'month' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Month</button>
          <button onClick={() => setViewMode('year')} className={cn("flex-1 text-[10px] text-mono font-medium py-1 px-3 rounded-md transition-colors", viewMode === 'year' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Year</button>
        </div>
        <button
          onClick={() => { setShowCatScratch(true); setCatScratchStep('input'); setCatScratchText(''); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-400 text-[11px] font-body transition-colors hover:bg-violet-500/30"
        >
          <NotebookPen size={13} /> Cat scratch
        </button>
      </div>

      <div className="flex items-stretch justify-between mb-3 gap-2">
        <button
          onClick={() => viewMode === 'month' ? setCurrentDate(prev => subMonths(prev, 1)) : setCurrentYear(prev => prev - 1)}
          className="flex items-center justify-center w-12 min-h-[44px] rounded-xl bg-fuchsia-500/30 active:bg-fuchsia-500/50 text-fuchsia-400 transition-colors border border-fuchsia-500/40"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1 flex items-center justify-center gap-2">
          <h2 className="font-body text-base font-semibold tracking-wide">
            {viewMode === 'month' ? format(currentDate, 'MMMM yyyy') : currentYear}
          </h2>
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 rounded-full"
            onClick={() => { setCurrentDate(new Date()); setCurrentYear(new Date().getFullYear()); }}>
            Today
          </Button>
        </div>
        <button
          onClick={() => viewMode === 'month' ? setCurrentDate(prev => addMonths(prev, 1)) : setCurrentYear(prev => prev + 1)}
          className="flex items-center justify-center w-12 min-h-[44px] rounded-xl bg-fuchsia-500/30 active:bg-fuchsia-500/50 text-fuchsia-400 transition-colors border border-fuchsia-500/40"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {/* Cat scratch dialog */}
      <Dialog open={showCatScratch} onOpenChange={o => { if (!o) { setShowCatScratch(false); setCatScratchStep('input'); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Cat Scratch</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Paste your notes and I'll match them to your logged jobs</p>
          </DialogHeader>

          {catScratchStep === 'input' && (
            <div className="space-y-3">
              <textarea
                value={catScratchText}
                onChange={e => setCatScratchText(e.target.value)}
                rows={10}
                placeholder={`5.7.26 moscone esplanade 5pm-11:30 PAID 💵\n5.9.26 civic center 8am-1p 💵\n5.15.26 chase center 10a-3p YWA LIVE NATION`}
                className="w-full rounded-xl border border-border bg-secondary/20 px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 resize-none leading-relaxed"
              />
              <Button onClick={handleParseCatScratch} disabled={!catScratchText.trim()} className="w-full">
                Parse & match
              </Button>
            </div>
          )}

          {catScratchStep === 'review' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{matchResults.length} entries found</p>
                <button onClick={() => setCatScratchStep('input')} className="text-xs text-primary hover:underline">← Back</button>
              </div>
              {matchResults.map((result, idx) => {
                const accepted = acceptedKeys.has(idx);
                return (
                  <div key={idx} className={cn("rounded-xl border p-3 space-y-2 transition-colors", accepted ? "border-success/30 bg-success/5 opacity-60" : "border-border bg-card")}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-mono text-muted-foreground shrink-0">
                          {format(new Date(result.entry.date + 'T12:00:00'), 'MMM d')}
                        </span>
                        {result.entry.venue && <span className="text-xs font-medium truncate">{result.entry.venue}</span>}
                        {result.entry.paid && <span className="text-sm">💵</span>}
                      </div>
                      {confidenceBadge(result.confidence)}
                    </div>

                    {result.entry.startTime && (
                      <p className="text-[11px] text-mono text-muted-foreground">
                        {result.entry.startTime}{result.entry.endTime ? ` – ${result.entry.endTime}` : ''}
                        {result.entry.mealType ? ` · ${result.entry.mealType}` : ''}
                        {result.entry.mealPenalties ? ` · ${result.entry.mealPenalties}MP` : ''}
                        {result.entry.grossPay ? ` · $${result.entry.grossPay}` : ''}
                      </p>
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

                    {!accepted && (
                      <button
                        onClick={() => handleApplyMatch(result, idx)}
                        className={cn(
                          "w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-body transition-colors",
                          result.matchedJob
                            ? "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                            : "bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                        )}
                      >
                        {result.matchedJob ? <><Check size={12} /> Apply to job</> : <><Plus size={12} /> Create new job</>}
                      </button>
                    )}
                    {accepted && <p className="text-[10px] text-success text-center font-body">✓ Applied</p>}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {viewMode === 'month' && (
        <>
          <div className="grid grid-cols-7 mb-0.5">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <div key={i} className="text-center text-[10px] text-muted-foreground text-mono py-1 font-medium">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day, i) => {
              const dateKey = format(day, 'yyyy-MM-dd');
              const dayJobs = jobsByDate[dateKey] || [];
              const todayFlag = isSameDay(day, today);
              const isCurrentMonth = isSameMonth(day, currentDate);
              const hasJobs = dayJobs.length > 0;
              const hasPay = !!payByDate[dateKey];
              return (
                <div key={i} onClick={() => hasJobs && setSelectedDate(dateKey)} className={cn("flex flex-col items-center py-1.5 transition-colors rounded-lg mx-0.5 mb-0.5", !isCurrentMonth && 'opacity-30', todayFlag && 'bg-primary/10', hasJobs && 'cursor-pointer active:bg-secondary/60')}>
                  {todayFlag ? (
                    <span className="relative w-6 h-6 flex items-center justify-center">
                      <Star size={24} className="absolute text-primary fill-primary" />
                      <span className="relative text-[11px] text-mono leading-none text-primary-foreground font-bold">{format(day, 'd')}</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-mono leading-none w-6 h-6 flex items-center justify-center text-foreground">{format(day, 'd')}</span>
                  )}
                  {dayJobs.length > 0 && <span className="text-[7px] text-muted-foreground leading-tight text-center truncate max-w-[3rem] mt-0.5">{dayJobs[0].venue || dayJobs[0].client}</span>}
                  <div className="flex gap-0.5 mt-0.5 h-2 items-center">
                    {dayJobs.slice(0, 3).map((job, j) => <span key={j} className={cn("w-1.5 h-1.5 rounded-full", statusDot[job.status])} />)}
                    {dayJobs.length > 3 && <span className="text-[7px] text-muted-foreground text-mono">+{dayJobs.length - 3}</span>}
                  </div>
                  {hasPay && <span className="text-[8px] text-mono text-success font-semibold leading-none mt-0.5">${payByDate[dateKey] >= 1000 ? `${(payByDate[dateKey] / 1000).toFixed(1)}k` : payByDate[dateKey].toFixed(0)}</span>}
                </div>
              );
            })}
          </div>
          <div className="mt-4 space-y-1">
            <div className="flex items-center justify-between px-1 pb-1 border-b border-border/30">
              <span className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50">{format(currentDate, 'MMMM')}</span>
              <div className="flex items-center gap-3">
                {monthStats.totalHours > 0 ? <span className="text-[11px] text-mono font-semibold text-primary">{monthStats.totalHours.toFixed(1)}h</span> : <span className="text-[11px] text-mono text-muted-foreground/25">—</span>}
                {monthStats.totalPay > 0 && <span className="text-[11px] text-mono font-bold text-success">${monthStats.totalPay >= 1000 ? `${(monthStats.totalPay / 1000).toFixed(1)}k` : monthStats.totalPay.toFixed(0)}</span>}
              </div>
            </div>
            {weekStats.map((ws, i) => (
              <div key={i} className="flex items-center justify-between px-1">
                <span className="text-[9px] text-mono text-muted-foreground/40">{format(ws.weekStart, 'MMM d')}</span>
                <div className="flex items-center gap-3">
                  {ws.hours > 0 ? <span className="text-[10px] text-mono text-muted-foreground">{ws.hours.toFixed(1)}h</span> : <span className="text-[10px] text-mono text-muted-foreground/25">—</span>}
                  {ws.pay > 0 && <span className="text-[10px] text-mono text-success">${ws.pay >= 1000 ? `${(ws.pay / 1000).toFixed(1)}k` : ws.pay.toFixed(0)}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {viewMode === 'year' && (
        <>
          <div className="grid grid-cols-3 gap-x-2 gap-y-3">
            {Array.from({ length: 12 }, (_, mi) => {
              const monthStart = new Date(currentYear, mi, 1);
              const monthPrefix = format(monthStart, 'yyyy-MM');
              let monthPay = 0, monthJobs = 0;
              for (const [date, jobs] of Object.entries(jobsByDate)) {
                if (!date.startsWith(monthPrefix)) continue;
                monthJobs += jobs.length;
                monthPay += payByDate[date] || 0;
              }
              const daysInMonth = new Date(currentYear, mi + 1, 0).getDate();
              const firstDow = new Date(currentYear, mi, 1).getDay();
              const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
              while (cells.length % 7 !== 0) cells.push(null);
              return (
                <div key={mi}>
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-[9px] font-body font-medium uppercase tracking-wider text-foreground/60">{format(monthStart, 'MMM')}</p>
                    {monthPay > 0 && <span className="text-[7px] text-mono text-success font-semibold">${monthPay >= 1000 ? `${(monthPay / 1000).toFixed(1)}k` : monthPay.toFixed(0)}</span>}
                  </div>
                  <div className="grid grid-cols-7 gap-px">
                    {cells.map((day, ci) => {
                      if (!day) return <div key={ci} className="h-3" />;
                      const dateKey = `${monthPrefix}-${String(day).padStart(2, '0')}`;
                      const dayJobs = jobsByDate[dateKey] || [];
                      const todayFlag = isSameDay(new Date(currentYear, mi, day), today);
                      const hasPay = !!payByDate[dateKey];
                      const hasCompleted = dayJobs.some(j => j.status === 'completed');
                      const hasInProgress = dayJobs.some(j => j.status === 'in-progress');
                      const hasUpcoming = dayJobs.some(j => j.status === 'upcoming');
                      return (
                        <div key={ci} onClick={() => dayJobs.length > 0 && setSelectedDate(dateKey)} className={cn('h-3 flex items-center justify-center text-[6px] text-mono rounded-[2px] transition-colors select-none', dayJobs.length > 0 && 'cursor-pointer', hasPay && 'bg-success/30 text-success font-semibold', !hasPay && hasCompleted && 'bg-success/15 text-success', !hasPay && !hasCompleted && hasInProgress && 'bg-primary/25 text-primary', !hasPay && !hasCompleted && !hasInProgress && hasUpcoming && 'bg-accent/20 text-accent', !dayJobs.length && 'text-muted-foreground/25', todayFlag && 'ring-1 ring-inset ring-primary/70')}>
                          {day}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-xl border border-border/40 bg-secondary/10 p-3">
            <p className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 mb-2">{currentYear} Total</p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{yearStats.totalJobs > 0 ? `${yearStats.totalJobs} job${yearStats.totalJobs !== 1 ? 's' : ''}` : 'No jobs yet'}</span>
              <div className="flex items-center gap-3">
                {yearStats.totalHours > 0 && <span className="text-xs text-mono font-semibold text-primary">{yearStats.totalHours.toFixed(1)}h</span>}
                {yearStats.totalPay > 0 && <span className="text-xs text-mono font-bold text-success">${yearStats.totalPay >= 1000 ? `${(yearStats.totalPay / 1000).toFixed(1)}k` : yearStats.totalPay.toFixed(0)}</span>}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 px-1">
            <span className="text-[8px] text-muted-foreground/40 font-body uppercase tracking-wider">Legend</span>
            {[{ color: 'bg-accent/20', label: 'Upcoming' }, { color: 'bg-success/15', label: 'Completed' }, { color: 'bg-success/30', label: 'Paid' }].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className={cn('w-3 h-3 rounded-[2px]', color)} />
                <span className="text-[8px] text-muted-foreground/50 font-body">{label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!selectedDate} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto rounded-2xl">
          {!selectedJob ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-mono text-sm">
                  {selectedDate && format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                {selectedJobs.map(job => {
                  const hours = job.hoursWorked ?? 0;
                  const earned = hours * (job.hourlyRate ?? 0);
                  return (
                    <div key={job.id} onClick={() => setSelectedJobId(job.id)} className={cn("rounded-xl border p-3 space-y-1 cursor-pointer hover:opacity-90 transition-opacity", statusColors[job.status])}>
                      <div className="flex items-start justify-between">
                        <div><p className="font-medium text-sm">{job.name}</p><p className="text-xs opacity-70">{job.client}</p></div>
                        <span className="text-[10px] text-mono uppercase font-medium opacity-70">{job.status}</span>
                      </div>
                      {job.venue && <p className="text-xs opacity-60">{job.venue}</p>}
                      <div className="flex gap-3 text-xs text-mono">
                        {job.startTime && <span>{job.startTime}{job.endTime ? ` – ${job.endTime}` : ''}</span>}
                        {hours > 0 && <span>{hours}h</span>}
                        {earned > 0 && <span className="font-semibold">${earned.toLocaleString()}</span>}
                      </div>
                      <p className="text-[10px] opacity-40 text-mono">Tap for details →</p>
                    </div>
                  );
                })}
                {payByDate[selectedDate!] && (
                  <div className="flex items-center justify-between pt-2 border-t border-border text-sm text-mono">
                    <span className="text-muted-foreground">Estimated pay</span>
                    <span className="font-bold text-success">${payByDate[selectedDate!].toLocaleString()}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <JobDetailView job={selectedJob} onBack={() => setSelectedJobId(null)} onSave={(updates) => { updateJob(selectedJob.id, updates); setSelectedJobId(null); toast.success('Job updated'); }} />
          )}
        </DialogContent>
      </Dialog>

      {(() => {
        const monthPrefix = format(currentDate, 'yyyy-MM');
        const needsLog = data.jobs.filter(job => {
          const jobDate = new Date(job.date + 'T12:00:00');
          return (isToday(jobDate) || isPast(jobDate)) && (job.hoursWorked ?? 0) === 0 && job.status !== 'cancelled' && job.date.startsWith(monthPrefix);
        }).sort((a, b) => a.date.localeCompare(b.date));
        if (needsLog.length === 0) return null;
        const groups: Record<string, Job[]> = {};
        for (const job of needsLog) {
          const key = job.jobNumber?.trim() || `${job.name}__${job.client}`;
          if (!groups[key]) groups[key] = [];
          groups[key].push(job);
        }
        return (
          <div className="mt-6 flex flex-col gap-2">
            <h2 className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />
              Ready to log
            </h2>
            <div className="flex flex-col gap-2">
              {Object.entries(groups).map(([key, jobs]) => {
                const first = jobs[0];
                const last = jobs[jobs.length - 1];
                const dateRange = jobs.length > 1 ? `${format(new Date(first.date + 'T12:00:00'), 'MMM d')} – ${format(new Date(last.date + 'T12:00:00'), 'MMM d')}` : format(new Date(first.date + 'T12:00:00'), 'MMM d');
                return (
                  <div key={key} onClick={() => setSelectedDate(first.date)} className="rounded-xl border border-accent/20 bg-accent/5 p-3 flex items-center gap-3 cursor-pointer active:opacity-70 transition-opacity">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{first.name}</p>
                        {jobs.length > 1 && <span className="text-[10px] text-mono bg-accent/20 text-accent px-1.5 py-0.5 rounded-full shrink-0">{jobs.length}d</span>}
                      </div>
                      <p className="text-xs text-muted-foreground">{first.client} · {dateRange}</p>
                      {first.jobNumber && <p className="text-[10px] text-mono text-muted-foreground/60 mt-0.5">#{first.jobNumber}</p>}
                    </div>
                    <ChevronRight size={14} className="text-muted-foreground shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {(() => {
        const monthPrefix = format(currentDate, 'yyyy-MM');
        const recentlyLogged = data.jobs.filter(job => (job.hoursWorked ?? 0) > 0 && job.date.startsWith(monthPrefix)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
        if (recentlyLogged.length === 0) return null;
        const loggedGroups: Record<string, Job[]> = {};
        for (const job of recentlyLogged) {
          const key = job.jobNumber?.trim() || `${job.name}__${job.client}`;
          if (!loggedGroups[key]) loggedGroups[key] = [];
          loggedGroups[key].push(job);
        }
        return (
          <div className="mt-4 flex flex-col gap-2">
            <h2 className="text-[9px] font-body uppercase tracking-widest text-muted-foreground/50 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
              Recently logged
            </h2>
            <div className="flex flex-col gap-1.5">
              {Object.entries(loggedGroups).map(([key, jobs]) => {
                const first = jobs[0];
                const totalHours = jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
                const totalEarned = jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);
                const last = jobs[jobs.length - 1];
                const dateRange = jobs.length > 1 ? `${format(new Date(last.date + 'T12:00:00'), 'MMM d')} – ${format(new Date(first.date + 'T12:00:00'), 'MMM d')}` : format(new Date(first.date + 'T12:00:00'), 'MMM d');
                return (
                  <div key={key} onClick={() => setSelectedDate(first.date)} className="rounded-xl border border-border bg-card p-2.5 flex items-center gap-2 opacity-70 cursor-pointer active:opacity-50 transition-opacity">
                    <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm truncate">{first.name} <span className="text-muted-foreground">· {first.client}</span></p>
                        {jobs.length > 1 && <span className="text-[10px] text-mono bg-success/20 text-success px-1.5 py-0.5 rounded-full shrink-0">{jobs.length}d</span>}
                      </div>
                      <p className="text-[11px] text-mono text-muted-foreground">{dateRange}{totalHours > 0 && ` · ${totalHours}h`}{totalEarned > 0 && ` · $${totalEarned.toLocaleString()}`}</p>
                      {first.jobNumber && <p className="text-[10px] text-mono text-muted-foreground/50">#{first.jobNumber}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </>
  );
}
