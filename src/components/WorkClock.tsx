import { useEffect, useMemo, useState } from 'react';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { calculateDayPay, calculateNightHours, dayMultiplierFor } from '@/lib/payCalc';
import { resolveEmployer } from '@/lib/employerMatch';
import { ratesForShift } from '@/lib/payerProfile';
import { localToday } from '@/lib/today';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Check, CircleStop, Coffee, Play, RotateCcw } from 'lucide-react';
import type { Job } from '@/lib/store';

const SESSION_KEY = 'show-flow-work-clock';
interface WorkSegment { start: number; end?: number }
interface ClockSession {
  client: string;
  name: string;
  venue: string;
  rate: string;
  date: string;
  segments: WorkSegment[];
  breakStartedAt?: number;
}

function loadSession(): ClockSession | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) as ClockSession : null;
  } catch {
    return null;
  }
}

function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function durationLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function timelineTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
}

export default function WorkClock() {
  const { data, addJob } = useData();
  const { prefs } = useUserPrefs();
  const [session, setSession] = useState<ClockSession | null>(() => loadSession());
  const [now, setNow] = useState(Date.now());
  const [client, setClient] = useState('');
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [rate, setRate] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      toast.error('The work clock could not be saved on this device.');
    }
  }, [session]);

  const employerName = session?.client ?? client;
  const employer = resolveEmployer(employerName, data.employers);
  const sessionSegments = session?.segments ?? [];
  const firstStart = sessionSegments[0]?.start;
  const currentEnd = session?.breakStartedAt ?? now;
  const clockedMs = firstStart ? Math.max(0, currentEnd - firstStart) : 0;
  const workedMs = sessionSegments.reduce((sum, segment) => {
    const end = segment.end ?? (session?.breakStartedAt ? segment.start : now);
    return sum + Math.max(0, end - segment.start);
  }, 0);
  const unpaidBreakMs = Math.max(0, clockedMs - workedMs);
  const elapsedHours = clockedMs / 3_600_000;
  const breakMinutes = unpaidBreakMs / 60_000;
  const workHours = workedMs / 3_600_000;

  const parsedRate = Number.parseFloat(session?.rate ?? rate);
  const hourlyRate = Number.isFinite(parsedRate) && parsedRate > 0
    ? parsedRate
    : employer?.defaultHourlyRate ?? (employer?.defaultDayRate ? employer.defaultDayRate / (employer.dayRateHours ?? 10) : 0);
  const tempJob = useMemo(() => ({
    id: 'active-work-clock',
    name: session?.name || name || 'Work shift',
    client: employerName || 'Unknown',
    venue: session?.venue || venue,
    date: session?.date || localToday(),
    status: 'completed',
    hoursWorked: elapsedHours,
    hourlyRate,
    has6th7thDayRule: false,
  } as Job), [session?.name, session?.venue, session?.date, name, employerName, venue, elapsedHours, hourlyRate]);
  const rates = ratesForShift(tempJob, employer, prefs.payer);
  const nightHours = sessionSegments.reduce((sum, segment) => {
    const end = segment.end ?? (session?.breakStartedAt ? segment.start : now);
    if (end <= segment.start || !employer?.nightPremiumEnabled) return sum;
    return sum + calculateNightHours(
      clockTime(segment.start), clockTime(end),
      employer?.nightPremiumStartHour ?? 0,
      employer?.nightPremiumEndHour,
    );
  }, 0);
  const pay = calculateDayPay(
    elapsedHours,
    hourlyRate,
    employer?.minimumCallHours ?? 0,
    0,
    dayMultiplierFor(tempJob, employer, data.jobs),
    { offClockMinutesTotal: breakMinutes },
    {
      rule: employer?.overtimeRule ?? 'daily',
      otThresholdHours: employer?.dailyOvertimeThresholdHours,
      dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
      otMultiplier: employer?.overtimeMultiplier,
      dtMultiplier: employer?.doubletimeMultiplier,
      roundUpToWholeHours: employer?.roundUpToWholeHours,
      nightHours,
      nightMultiplier: employer?.nightPremiumMultiplier,
      dayRate: employer?.defaultDayRate,
      dayRateHours: employer?.dayRateHours,
      unionDuesPercent: rates.unionDuesPercent,
      estimatedTaxPercent: rates.estimatedTaxPercent,
    },
  );
  const estimatedGross = pay.totalPay + pay.duesAmount + pay.taxAmount
    + (rates.vacationPercent ? (pay.totalPay + pay.duesAmount + pay.taxAmount) * rates.vacationPercent / 100 : 0);
  const active = !!session;
  const onBreak = !!session?.breakStartedAt;

  const start = () => {
    if (!client.trim()) { toast.error('Enter the employer first'); return; }
    const startAt = Date.now();
    setSession({
      client: client.trim(), name: name.trim() || client.trim(), venue: venue.trim(), rate,
      date: localToday(), segments: [{ start: startAt }],
    });
  };

  const beginBreak = () => {
    if (!session || onBreak) return;
    const end = Date.now();
    setSession({
      ...session,
      segments: session.segments.map((segment, i) => i === session.segments.length - 1 ? { ...segment, end } : segment),
      breakStartedAt: end,
    });
  };

  const resume = () => {
    if (!session || !onBreak) return;
    setSession({ ...session, segments: [...session.segments, { start: Date.now() }], breakStartedAt: undefined });
  };

  const finish = async () => {
    if (!session || session.segments.length === 0) return;
    const endedAt = session.breakStartedAt ?? Date.now();
    const segments = session.segments.map((segment, i) => i === session.segments.length - 1 && !segment.end
      ? { ...segment, end: endedAt }
      : segment);
    const completed = segments.filter((segment): segment is WorkSegment & { end: number } => segment.end !== undefined);
    if (!completed.length) { toast.error('No work time to save yet'); return; }
    const first = completed[0];
    const last = completed[completed.length - 1];
    const spanHours = (last.end - first.start) / 3_600_000;
    const timeline = completed.length > 1
      ? completed.map(segment => `${timelineTime(segment.start)}-${timelineTime(segment.end)}`).join(', ')
      : undefined;
    const created = await addJob({
      name: session.name || session.client,
      client: session.client,
      venue: session.venue,
      date: session.date,
      startTime: clockTime(first.start),
      endTime: clockTime(last.end),
      hoursWorked: spanHours,
      hourlyRate: hourlyRate || undefined,
      status: 'completed',
      callTimeline: timeline,
      callGapsOnClock: timeline ? new Array(completed.length - 1).fill(false) : undefined,
      notes: 'Logged with work clock',
      has6th7thDayRule: false,
    });
    if (!created) { toast.error('This shift may already be on your calendar. Review it there before logging again.'); return; }
    setSession(null);
    setClient(''); setName(''); setVenue(''); setRate('');
    toast.success('Shift saved to your calendar');
  };

  const discard = () => {
    setSession(null);
    toast('Work clock cleared');
  };

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-card" aria-label="Work clock">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Work clock</p>
          <p className="text-xs text-muted-foreground mt-0.5">Live time and estimated gross pay</p>
        </div>
        <span className={`h-2 w-2 rounded-full ${active ? onBreak ? 'bg-warning' : 'bg-success animate-pulse' : 'bg-muted-foreground/30'}`} />
      </div>

      {!active ? (
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          <Input list="clock-employers" value={client} onChange={event => setClient(event.target.value)} placeholder="Employer" aria-label="Employer for work clock" />
          <datalist id="clock-employers">{data.employers.map(item => <option key={item.id} value={item.name} />)}</datalist>
          <Input value={name} onChange={event => setName(event.target.value)} placeholder="Job or event" aria-label="Job or event name" />
          <Input value={venue} onChange={event => setVenue(event.target.value)} placeholder="Venue (optional)" aria-label="Venue" />
          <Input type="number" min="0" step="0.01" value={rate} onChange={event => setRate(event.target.value)} placeholder={employer?.defaultHourlyRate ? `Rate · $${employer.defaultHourlyRate}/hr default` : 'Hourly rate'} aria-label="Hourly rate" />
          <Button type="button" onClick={start} className="h-11 gap-2"><Play size={16} /> Start work</Button>
        </div>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session.name}</p>
              <p className="truncate text-xs text-muted-foreground">{session.client}{session.venue ? ` · ${session.venue}` : ''}</p>
            </div>
            <p className="font-mono text-3xl font-semibold tabular-nums" aria-live="off">{durationLabel(workedMs)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 border-y border-border/60 py-3">
            <div><p className="text-[10px] uppercase text-muted-foreground">Status</p><p className="mt-1 text-sm font-medium">{onBreak ? 'Unpaid break' : 'Working'}</p></div>
            <div className="text-right"><p className="text-[10px] uppercase text-muted-foreground">Estimated gross</p><p className="mt-1 font-mono text-xl font-bold">${estimatedGross.toFixed(2)}</p></div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {workHours.toFixed(2)}h worked{breakMinutes > 0 ? ` · ${(breakMinutes / 60).toFixed(2)}h unpaid break` : ''} · based on {hourlyRate ? `$${hourlyRate}/hr` : 'employer rate'} and saved overtime terms. Estimate only.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {onBreak
              ? <Button type="button" variant="outline" className="h-11 gap-2" onClick={resume}><RotateCcw size={15} /> Resume work</Button>
              : <Button type="button" variant="outline" className="h-11 gap-2" onClick={beginBreak}><Coffee size={15} /> Start unpaid break</Button>}
            <Button type="button" variant="default" className="h-11 gap-2" onClick={() => void finish()}><Check size={15} /> Stop & save shift</Button>
          </div>
          <button type="button" onClick={discard} className="mx-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"><CircleStop size={13} /> Discard clock</button>
        </div>
      )}
    </section>
  );
}
