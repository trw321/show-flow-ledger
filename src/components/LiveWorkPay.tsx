import { useEffect, useMemo, useState } from 'react';
import { CircleStop, Clock3, Utensils, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { resolveEmployer } from '@/lib/employerMatch';
import { dayInARow, dayMultiplierFor, jobPayBreakdown, parseTimeToMinutes } from '@/lib/payCalc';
import { localToday } from '@/lib/today';
import { liveDay, lunchMs, MEAL_LENGTHS, openBreak, startsInLabel, toFiveMinutes, withMeal, workEnd, workedMs, type WorkBreak } from '@/lib/liveWork';
import { cn } from '@/lib/utils';
import MoneyRain from '@/components/MoneyRain';
import type { Job } from '@/lib/store';

const SESSION_KEY = 'show-flow-live-work-session-v1';
const ONE_HOUR_MS = 60 * 60 * 1000;
/** The longest a call runs: a counter going longer was never ended. */
const MAX_CALL_MS = 24 * ONE_HOUR_MS;

interface WorkSession {
  jobId: string;
  scheduledAt: number;
  lateClockInAt?: number;
  lateClockInTime?: string;
  lateCheckPending: boolean;
  lateArrivalPending?: boolean;
  /** Meals taken so far; the counter pauses for each. */
  breaks?: WorkBreak[];
}

function savedBreaks(value: unknown): WorkBreak[] {
  if (!Array.isArray(value)) return [];
  return value.filter((b): b is WorkBreak => !!b && typeof b.start === 'number' && (b.end === undefined || typeof b.end === 'number'));
}

function readSession(): WorkSession | null {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (!saved) return null;
    const value = JSON.parse(saved) as Partial<WorkSession> & { startedAt?: number; lateMarkedAt?: number };
    const scheduledAt = value.scheduledAt ?? value.startedAt;
    return typeof value.jobId === 'string' && typeof scheduledAt === 'number'
      ? {
        jobId: value.jobId,
        scheduledAt,
        lateClockInAt: value.lateClockInAt ?? value.lateMarkedAt,
        lateClockInTime: value.lateClockInTime,
        lateCheckPending: value.lateCheckPending ?? false,
        lateArrivalPending: value.lateArrivalPending ?? false,
        breaks: savedBreaks(value.breaks),
      }
      : null;
  } catch {
    return null;
  }
}

function scheduledStart(job: Job): number | null {
  if (!job.startTime) return null;
  return timestampOnDate(job.date, job.startTime);
}

function timestampOnDate(date: string, time: string): number | null {
  const minutes = parseTimeToMinutes(time);
  if (!Number.isFinite(minutes)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60).getTime();
}

function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function elapsedLabel(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function money(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function LiveWorkPay() {
  const { data, updateJob } = useData();
  const { prefs } = useUserPrefs();
  const [now, setNow] = useState(Date.now());
  const [session, setSession] = useState<WorkSession | null>(() => readSession());
  const [reminderDismissedFor, setReminderDismissedFor] = useState<string | null>(null);
  const [endingAt, setEndingAt] = useState<number | null>(null);
  const [confirmedHours, setConfirmedHours] = useState('');
  // The meal being entered: when it started and how long (null: still going).
  const [mealStart, setMealStart] = useState<number | null>(null);
  const [mealLength, setMealLength] = useState<number | null>(30);
  const [mealOnClock, setMealOnClock] = useState(false);
  // Tapping the counter (anywhere but its buttons) makes it rain.
  const [rain, setRain] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // The visible counter still works if browser storage is unavailable.
    }
  }, [session]);

  const today = localToday();
  // Today's calls the counter can run for: not done yet, or marked done with
  // hours typed in but no end time, which is a day still being worked.
  const scheduledJobs = useMemo(() => data.jobs
    .filter(job => job.date === today && !job.pto && (job.status === 'upcoming' || job.status === 'in-progress' || (job.status === 'completed' && !job.endTime)))
    .map(job => ({ job, startAt: scheduledStart(job) }))
    .filter((entry): entry is { job: Job; startAt: number } => entry.startAt !== null)
    .sort((a, b) => a.startAt - b.startAt),
  [data.jobs, today]);

  const startDue = scheduledJobs.find(entry => entry.startAt <= now);
  const reminder = scheduledJobs.find(entry => entry.startAt > now && entry.startAt <= now + ONE_HOUR_MS);

  // No call runs past 24 hours, so a counter that has (End work day never
  // tapped) goes. One from an earlier day also goes as soon as another of
  // today's calls comes due, so it can't block today's from starting. An
  // overnight call still runs on past midnight.
  useEffect(() => {
    if (!session || data.jobs.length === 0) return;
    const job = data.jobs.find(j => j.id === session.jobId);
    const tooLong = now - session.scheduledAt > MAX_CALL_MS;
    const replaced = !!job && job.date < today && !!startDue && startDue.job.id !== job.id;
    const gone = !job || job.status === 'cancelled' || (job.status === 'completed' && !!job.endTime);
    if (tooLong || replaced || gone) setSession(null);
  }, [session, data.jobs, today, now, startDue]);

  useEffect(() => {
    if (session || !startDue) return;
    setSession({ jobId: startDue.job.id, scheduledAt: startDue.startAt, lateCheckPending: true });
  }, [session, startDue]);

  const activeJob = session ? data.jobs.find(job => job.id === session.jobId) ?? null : null;
  const activeEmployer = activeJob ? resolveEmployer(activeJob.client, data.employers) : undefined;
  const lateRuleMissing = !!session?.lateClockInAt && !activeEmployer?.lateArrivalRule;
  const actualClockInAt = session?.lateClockInAt ?? session?.scheduledAt ?? now;
  const startedAt = session
    ? session.lateClockInAt && activeEmployer?.lateArrivalRule === 'actual_clock_in'
      ? session.lateClockInAt
      : session.scheduledAt
    : now;
  const counterNow = endingAt ?? now;
  const breaks = session?.breaks ?? [];
  const lunch = openBreak(breaks);
  const elapsedMs = session ? workedMs(startedAt, counterNow, breaks) : 0;
  const liveEnd = workEnd(breaks, counterNow);
  // Priced on what has actually happened: the clocked span with the lunches
  // tapped so far as gaps. A meal or calls planned on the shift ahead of time
  // would come off hours not yet worked, so they're left out here.
  const live = session ? liveDay(startedAt, counterNow, breaks) : { text: '', gapsOnClock: [] };
  const liveCalls = live.text;
  const liveJob = activeJob && session
    ? {
      ...activeJob,
      status: 'in-progress' as const,
      hoursPlanned: false,
      hoursWorked: Math.max(0, liveEnd - startedAt) / 3_600_000,
      endTime: clockTime(liveEnd),
      callTimeline: liveCalls || undefined,
      callGapsOnClock: liveCalls ? live.gapsOnClock : undefined,
      mealDuration: undefined,
      mealOnClock: undefined,
      meal2Duration: undefined,
      meal2OnClock: undefined,
      extraMeals: undefined,
    }
    : null;
  const pricedLiveJob = liveJob
    ? {
      ...liveJob,
      hourlyRate: liveJob.hourlyRate,
      dayRate: liveJob.dayRate,
      dayRateHours: liveJob.dayRateHours,
      minimumHours: liveJob.minimumHours,
    }
    : null;
  const estimateJobs = pricedLiveJob
    ? data.jobs.map(job => job.id === pricedLiveJob.id ? pricedLiveJob : job)
    : data.jobs;
  const todayJobs = pricedLiveJob
    ? estimateJobs.filter(job => job.date === today && job.status !== 'cancelled')
    : [];
  // One figure: the gross for the working minutes so far, ticking as they
  // go. Rounded up to whole hours (Local 16 breaks the hour) or held at a
  // minimum call it only moved once an hour, and a second figure for that
  // read as two different answers. The saved shift pays it all properly.
  const pay = pricedLiveJob
    ? todayJobs.reduce((total, job) => total + jobPayBreakdown(job, estimateJobs, data.employers, prefs.payer, { asWorked: true }).gross, 0)
    : null;
  const hasRate = !!(pricedLiveJob?.hourlyRate || pricedLiveJob?.dayRate);
  // A 6th or 7th day in a row lights up like it does on the calendar.
  const streak = pricedLiveJob ? dayInARow(pricedLiveJob, activeEmployer, estimateJobs) : 0;
  const streakPays = pricedLiveJob && streak >= 6 ? dayMultiplierFor(pricedLiveJob, activeEmployer, estimateJobs) : 1;
  const premium = streak >= 7 ? 'premium-7' : streak >= 6 ? 'premium-6' : '';

  const confirmOnTime = () => setSession(current => current ? { ...current, lateCheckPending: false } : null);
  const markLate = () => setSession(current => current
    ? {
      ...current,
      lateCheckPending: false,
      lateArrivalPending: true,
      lateClockInTime: '',
    }
    : null);
  const confirmLateClockIn = () => setSession(current => {
    if (!current || !activeJob || !current.lateClockInTime) return current;
    const lateClockInAt = timestampOnDate(activeJob.date, current.lateClockInTime);
    return lateClockInAt === null
      ? current
      : { ...current, lateClockInAt, lateArrivalPending: false };
  });

  // A meal is entered on a slider, after the fact or as it starts, so it
  // doesn't depend on tapping a button at the right moment.
  const openMeal = () => {
    setMealStart(Math.max(toFiveMinutes(startedAt), toFiveMinutes(Date.now() - 30 * 60_000)));
    setMealLength(30);
    setMealOnClock(false);
  };
  const saveMeal = () => {
    if (mealStart === null) return;
    setSession(current => current ? { ...current, breaks: withMeal(current.breaks ?? [], mealStart, mealLength, mealOnClock) } : null);
    setMealStart(null);
  };
  const removeMeal = (index: number) => setSession(current => current
    ? { ...current, breaks: (current.breaks ?? []).filter((_, i) => i !== index) }
    : null);
  const endLunch = () => setSession(current => {
    if (!current?.breaks?.length) return current;
    const done = current.breaks.map((b, i) => (i === current.breaks!.length - 1 && b.end === undefined ? { ...b, end: Date.now() } : b));
    return { ...current, breaks: done };
  });

  const beginEndDay = () => {
    const endedAt = Date.now();
    setEndingAt(endedAt);
    setConfirmedHours((workedMs(actualClockInAt, endedAt, breaks) / 3_600_000).toFixed(2));
  };

  const endedAtWork = endingAt !== null ? workEnd(breaks, endingAt) : null;
  const lunchTakenMs = endedAtWork !== null ? lunchMs(actualClockInAt, endedAtWork, breaks) : 0;

  const confirmEndDay = async () => {
    if (!activeJob || endingAt === null || endedAtWork === null) return;
    const hours = Number(confirmedHours);
    if (!Number.isFinite(hours) || hours <= 0) return;
    const day = liveDay(actualClockInAt, endingAt, breaks);
    const calls = day.text;
    await updateJob(activeJob.id, {
      endTime: clockTime(endedAtWork),
      // The app keeps hoursWorked as the clocked span and takes off-the-clock
      // lunches off it from the calls, so the lunch goes back on here.
      hoursWorked: calls ? hours + lunchTakenMs / 3_600_000 : hours,
      ...(calls ? { callTimeline: calls, callGapsOnClock: day.gapsOnClock } : {}),
      hoursPlanned: undefined,
      status: 'completed',
    });
    setSession(null);
    setEndingAt(null);
  };

  return (
    <>
      {session && activeJob && (
        <section
          className={cn('mb-3 flex cursor-pointer select-none flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border px-3 py-2', premium || 'border-border bg-card/70')}
          aria-label="Live work pay estimate"
          data-premium={premium || undefined}
          onClick={e => { if (!(e.target as HTMLElement).closest('button')) setRain(n => n + 1); }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Clock3 size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              {premium && (
                <p className="text-xs font-black tracking-tight" data-testid="live-premium">
                  {streakPays >= 2 ? '🤑' : streakPays > 1 ? '💰' : '🔥'} {streak >= 7 ? '7TH' : '6TH'} DAY IN A ROW{streakPays > 1 ? ` · ${streakPays}× ALL DAY` : ''}
                </p>
              )}
              <p className="truncate text-xs font-medium">{activeJob.name} · {lateRuleMissing ? 'Late rule not set' : elapsedLabel(elapsedMs)}</p>
              <p className="text-[10px] text-muted-foreground">
                {lunch
                  ? lunch.onClock
                    ? `On a meal since ${clockTime(lunch.start)} · on the clock, still paid`
                    : `On a meal since ${clockTime(lunch.start)} · paused, off the clock`
                  : `Started ${clockTime(startedAt)}${lunchMs(startedAt, liveEnd, breaks) > 0 ? ` · ${elapsedLabel(lunchMs(startedAt, liveEnd, breaks))} meal off the clock` : ''}${breaks.some(x => x.onClock) ? ' · meal on the clock, paid' : ''} · estimated gross`}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="font-mono text-sm font-semibold tabular-nums" aria-live="off" data-testid="live-pay">
                {lateRuleMissing ? 'Set late rule in Settings' : hasRate && pay !== null ? money(pay) : 'Rate needed'}
              </p>
            </div>
            <Button type="button" size="sm" variant={lunch ? 'default' : 'outline'} className={cn("h-8 gap-1.5 px-2.5", premium && "border-[#14061f]/40 bg-white/75 hover:bg-white/90")} onClick={lunch ? endLunch : openMeal}>
              <Utensils size={14} /> {lunch ? 'Back from meal' : 'Meal'}
            </Button>
            <Button type="button" size="sm" variant="outline" className={cn("h-8 gap-1.5 px-2.5", premium && "border-[#14061f]/40 bg-white/75 hover:bg-white/90")} onClick={beginEndDay}>
              <CircleStop size={14} /> End work day
            </Button>
          </div>
        </section>
      )}

      <MoneyRain burst={rain} party />

      <Dialog open={!!reminder && reminderDismissedFor !== reminder.job.id} onOpenChange={open => { if (!open && reminder) setReminderDismissedFor(reminder.job.id); }}>
        {reminder && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{startsInLabel(reminder.startAt - now)}</DialogTitle>
              <DialogDescription>
                {reminder.job.name} is scheduled to start at {clockTime(reminder.startAt)}. The live estimate will start automatically at that time.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => setReminderDismissedFor(reminder.job.id)}>Got it</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!session?.lateCheckPending} onOpenChange={() => {}}>
        {activeJob && (
          <DialogContent hideClose>
            <DialogHeader>
              <DialogTitle>Were you on time?</DialogTitle>
              <DialogDescription>
                The live estimate started at {clockTime(session?.scheduledAt ?? now)} for {activeJob.name}. Mark late to apply {activeEmployer?.name ? `${activeEmployer.name}'s` : 'this employer’s'} saved late-arrival rule.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={markLate}>I was late</Button>
              <Button type="button" onClick={confirmOnTime}>I was on time</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!session?.lateArrivalPending} onOpenChange={() => {}}>
        {activeJob && (
          <DialogContent hideClose>
            <DialogHeader>
              <DialogTitle>What time did you clock in?</DialogTitle>
              <DialogDescription>This time is used for saved hours. The live pay estimate follows {activeEmployer?.name ?? 'this employer'}’s late-arrival setting.</DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-sm" htmlFor="actual-clock-in-time">
              Clock-in time
              <Input
                id="actual-clock-in-time"
                type="time"
                value={session?.lateClockInTime ?? ''}
                onChange={event => setSession(current => current ? { ...current, lateClockInTime: event.target.value } : null)}
              />
            </label>
            <DialogFooter>
              <Button type="button" onClick={confirmLateClockIn} disabled={!session?.lateClockInTime}>Use this time</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={mealStart !== null} onOpenChange={open => { if (!open) setMealStart(null); }}>
        {activeJob && mealStart !== null && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Meal</DialogTitle>
              <DialogDescription>Slide to when it started, then pick how long, and whether it was paid.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-center font-mono text-3xl font-bold tabular-nums" data-testid="meal-start">{clockTime(mealStart)}</p>
                <Slider
                  aria-label="When the meal started"
                  className="py-3"
                  min={toFiveMinutes(startedAt)}
                  max={Math.max(toFiveMinutes(startedAt), toFiveMinutes(now))}
                  step={5 * 60_000}
                  value={[mealStart]}
                  onValueChange={([v]) => setMealStart(v)}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                  <span>{clockTime(startedAt)} start</span>
                  <span>now</span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[...MEAL_LENGTHS, null].map(m => (
                  <button key={m ?? 'going'} type="button" onClick={() => setMealLength(m)} aria-pressed={mealLength === m}
                    className={cn('pixel-button py-2 text-xs font-bold', mealLength === m ? 'pick-on' : 'pick-off')}>
                    {m === null ? 'Still on it' : m === 60 ? '1 hr' : `${m} min`}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-2 gap-2">
                  {([false, true] as const).map(on => (
                    <button key={String(on)} type="button" onClick={() => setMealOnClock(on)} aria-pressed={mealOnClock === on}
                      className={cn('pixel-button py-2 text-xs font-bold', mealOnClock === on ? 'pick-on' : 'pick-off')}>
                      {on ? 'On the clock' : 'Off the clock'}
                    </button>
                  ))}
                </div>
                <p className="text-center text-[11px] text-muted-foreground">
                  {mealOnClock ? 'Paid: counts as worked, nothing comes off.' : 'Not paid: it comes off your hours.'}
                </p>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {mealLength === null
                  ? mealOnClock
                    ? `From ${clockTime(mealStart)}, on the clock: the counter keeps going.`
                    : `From ${clockTime(mealStart)}: the counter pauses until you tap Back from meal.`
                  : `${clockTime(mealStart)} to ${clockTime(mealStart + mealLength * 60_000)}`}
              </p>
              {breaks.length > 0 && (
                <div className="space-y-1 border-t border-border pt-2">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Meals so far</p>
                  {breaks.map((b, i) => (
                    <div key={b.start} className="flex items-center justify-between text-xs font-mono">
                      <span>{clockTime(b.start)} – {b.end ? clockTime(b.end) : 'still on it'} · {b.onClock ? 'on the clock' : 'off the clock'}</span>
                      <button type="button" aria-label="Remove this meal" onClick={() => removeMeal(i)} className="p-1 text-muted-foreground hover:text-destructive"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMealStart(null)}>Cancel</Button>
              <Button type="button" onClick={saveMeal}>Save meal</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={endingAt !== null} onOpenChange={open => { if (!open) setEndingAt(null); }}>
        {activeJob && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>End work day?</DialogTitle>
              <DialogDescription>
                Clocked in {clockTime(actualClockInAt)}; ending {endedAtWork !== null ? clockTime(endedAtWork) : ''}
                {lunch && endedAtWork !== null ? ', when your meal started' : ''}.
                {lunchTakenMs > 0 ? ` ${elapsedLabel(lunchTakenMs)} of meals is off the clock and not counted.` : ''} Confirm or adjust the hours before saving them to {activeJob.name}.
              </DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-sm" htmlFor="confirmed-work-hours">
              Hours worked
              <Input
                id="confirmed-work-hours"
                type="number"
                min="0.01"
                step="0.01"
                value={confirmedHours}
                onChange={event => setConfirmedHours(event.target.value)}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEndingAt(null)}>Keep working</Button>
              <Button type="button" onClick={() => void confirmEndDay()} disabled={!Number.isFinite(Number(confirmedHours)) || Number(confirmedHours) <= 0}>
                Confirm hours
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}