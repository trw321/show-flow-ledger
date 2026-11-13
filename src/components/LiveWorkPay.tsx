import { useEffect, useMemo, useState } from 'react';
import { CircleStop, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { jobPayBreakdown, parseTimeToMinutes } from '@/lib/payCalc';
import { localToday } from '@/lib/today';
import type { Job } from '@/lib/store';

const SESSION_KEY = 'show-flow-live-work-session-v1';
const ONE_HOUR_MS = 60 * 60 * 1000;

interface WorkSession {
  jobId: string;
  scheduledAt: number;
  lateClockInAt?: number;
  lateClockInTime?: string;
  lateCheckPending: boolean;
  lateArrivalPending?: boolean;
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
  const scheduledJobs = useMemo(() => data.jobs
    .filter(job => job.date === today && !job.pto && (job.status === 'upcoming' || job.status === 'in-progress'))
    .map(job => ({ job, startAt: scheduledStart(job) }))
    .filter((entry): entry is { job: Job; startAt: number } => entry.startAt !== null)
    .sort((a, b) => a.startAt - b.startAt),
  [data.jobs, today]);

  const startDue = scheduledJobs.find(entry => entry.startAt <= now);
  const reminder = scheduledJobs.find(entry => entry.startAt > now && entry.startAt <= now + ONE_HOUR_MS);

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
  const elapsedMs = session ? Math.max(0, counterNow - startedAt) : 0;
  const liveJob = activeJob && session
    ? {
      ...activeJob,
      status: 'in-progress' as const,
      hoursPlanned: false,
      hoursWorked: elapsedMs / 3_600_000,
      endTime: clockTime(counterNow),
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
  const pay = pricedLiveJob
    ? todayJobs.reduce((total, job) => total + jobPayBreakdown(job, estimateJobs, data.employers, prefs.payer).net, 0)
    : null;
  const hasRate = !!(pricedLiveJob?.hourlyRate || pricedLiveJob?.dayRate);

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

  const beginEndDay = () => {
    const endedAt = Date.now();
    setEndingAt(endedAt);
    setConfirmedHours(((endedAt - actualClockInAt) / 3_600_000).toFixed(2));
  };

  const confirmEndDay = async () => {
    if (!activeJob || endingAt === null) return;
    const hours = Number(confirmedHours);
    if (!Number.isFinite(hours) || hours <= 0) return;
    await updateJob(activeJob.id, {
      endTime: clockTime(endingAt),
      hoursWorked: hours,
      hoursPlanned: undefined,
      status: 'completed',
    });
    setSession(null);
    setEndingAt(null);
  };

  return (
    <>
      {session && activeJob && (
        <section className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-border bg-card/70 px-3 py-2" aria-label="Live work pay estimate">
          <div className="flex min-w-0 items-center gap-2">
            <Clock3 size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{activeJob.name} · {lateRuleMissing ? 'Late rule not set' : elapsedLabel(elapsedMs)}</p>
              <p className="text-[10px] text-muted-foreground">Started {clockTime(startedAt)} · estimated net</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <p className="font-mono text-sm font-semibold tabular-nums" aria-live="off">
              {lateRuleMissing ? 'Set late rule in Settings' : hasRate && pay !== null ? money(pay) : 'Rate needed'}
            </p>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 px-2.5" onClick={beginEndDay}>
              <CircleStop size={14} /> End work day
            </Button>
          </div>
        </section>
      )}

      <Dialog open={!!reminder && reminderDismissedFor !== reminder.job.id} onOpenChange={open => { if (!open && reminder) setReminderDismissedFor(reminder.job.id); }}>
        {reminder && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Work starts in about an hour</DialogTitle>
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

      <Dialog open={endingAt !== null} onOpenChange={open => { if (!open) setEndingAt(null); }}>
        {activeJob && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>End work day?</DialogTitle>
              <DialogDescription>
                Clocked in {clockTime(actualClockInAt)}; ending {endingAt !== null ? clockTime(endingAt) : ''}. Confirm or adjust the hours before saving them to {activeJob.name}.
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