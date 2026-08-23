import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import FallingPlanets from '@/components/FallingPlanets';
import { ChevronDown, Download, Zap, Eye, Flame } from 'lucide-react';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO, isToday, differenceInCalendarDays } from 'date-fns';
import { exportWeeklyToExcel } from '@/lib/exportWeekly';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { calculateDayPay, getDayMultiplier, calculateWeeklyOvertimeBonus, calculateNightHours, resolveConfirmedNightHours, effectiveHoursWorked } from '@/lib/payCalc';
import { resolveEmployer } from '@/lib/employerMatch';
import { useNeedsHours } from '@/lib/useNeedsHours';
import { getPayTimingTier, PAY_TIMING_LABELS, type PayTimingTier } from '@/lib/payTiming';
import type { Job, Employer } from '@/lib/store';

function jobGross(job: Job, allJobs: Job[], employers: Employer[] = []): number {
  const hours = effectiveHoursWorked(job);
  if (!hours) return 0;
  const rate = job.hourlyRate ?? 0;
  const employer = resolveEmployer(job.client, employers);
  const dayMult = getDayMultiplier(job.date, job.client, allJobs, job.has6th7thDayRule ?? false);
  const rawNightHours = ((employer?.nightPremiumEnabled ?? true) && job.startTime && job.endTime)
    ? calculateNightHours(job.startTime, job.endTime, employer?.nightPremiumStartHour ?? 0, employer?.nightPremiumEndHour)
    : 0;
  const nightHours = resolveConfirmedNightHours(rawNightHours, job.nightPremiumConfirmed, job.nightPremiumActualHours);
  const { totalPay } = calculateDayPay(hours, rate, job.minimumHours ?? 0, job.mealPenalties ?? 0, dayMult, { duration: job.mealDuration, onClock: job.mealOnClock }, {
    rule: employer?.overtimeRule ?? 'daily',
    otThresholdHours: employer?.dailyOvertimeThresholdHours,
    dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
    otMultiplier: employer?.overtimeMultiplier,
    dtMultiplier: employer?.doubletimeMultiplier,
    nightHours,
    nightMultiplier: employer?.nightPremiumMultiplier,
  });
  const weeklyBonus = employer ? calculateWeeklyOvertimeBonus(job, allJobs, employer) : 0;
  const gross = totalPay + weeklyBonus;
  return gross + (job.hasVacationPay ? gross * 0.08 : 0);
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-bounce w-full mb-6 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 py-3 px-4 text-sm font-semibold text-white/90 transition-colors"
    >
      <Download size={16} />
      Export to Excel
    </button>
  );
}

export default function Dashboard() {
  const { data } = useData();
  const { prefs } = useUserPrefs();
  const [employerExpanded, setEmployerExpanded] = useState(false);
  const navigate = useNavigate();

  if (!data) return null;

  const showIncome = prefs.tabs.income;
  const showExpenses = prefs.tabs.expenses;

  // ── This month ────────────────────────────────────────────────────────────
  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());

  const thisMonthJobs = data.jobs.filter(j => {
    try { return isWithinInterval(parseISO(j.date), { start: monthStart, end: monthEnd }); }
    catch { return false; }
  });

  const thisMonthHours = thisMonthJobs.reduce((s, j) => s + effectiveHoursWorked(j), 0);
  const thisMonthExpected = thisMonthJobs.reduce((s, j) => s + jobGross(j, data.jobs, data.employers), 0);
  const thisMonthPaid = data.income
    .filter(i => i.status === 'paid' && (() => { try { return isWithinInterval(parseISO(i.date), { start: monthStart, end: monthEnd }); } catch { return false; } })())
    .reduce((s, i) => s + i.amount, 0);
  const thisMonthUnpaid = Math.max(0, thisMonthExpected - thisMonthPaid);

  // ── YTD ──────────────────────────────────────────────────────────────────
  const yearPrefix = format(new Date(), 'yyyy');
  const ytdJobs = data.jobs.filter(j => j.date.startsWith(yearPrefix));
  const ytdHours = ytdJobs.reduce((s, j) => s + effectiveHoursWorked(j), 0);
  const ytdExpected = ytdJobs.reduce((s, j) => s + jobGross(j, data.jobs, data.employers), 0);
  const ytdPaid = data.income
    .filter(i => i.status === 'paid' && i.date.startsWith(yearPrefix))
    .reduce((s, i) => s + i.amount, 0);

  // ── By employer ───────────────────────────────────────────────────────────
  const byEmployer = useMemo(() => {
    const map: Record<string, { hours: number; earned: number; jobs: number }> = {};
    for (const job of data.jobs) {
      const key = job.client || 'Unknown';
      if (!map[key]) map[key] = { hours: 0, earned: 0, jobs: 0 };
      map[key].hours += effectiveHoursWorked(job);
      map[key].earned += jobGross(job, data.jobs, data.employers);
      map[key].jobs += 1;
    }
    return Object.entries(map)
      .map(([client, stats]) => ({ client, ...stats }))
      .sort((a, b) => b.earned - a.earned);
  }, [data.jobs, data.employers]);

  // ── Next job ─────────────────────────────────────────────────────────────
  const today = format(new Date(), 'yyyy-MM-dd');
  const nextJob = [...data.jobs]
    .filter(j => j.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date))
    .find(j => j.date >= today);

  const isOnStage = nextJob ? isToday(parseISO(nextJob.date)) : false;

  // ── Expenses ─────────────────────────────────────────────────────────────
  const recentExpenses = [...data.expenses]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const totalIncome = data.income.reduce((s, i) => s + i.amount, 0);
  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0);
  const totalHours = data.jobs.reduce((s, j) => s + effectiveHoursWorked(j), 0);
  const netProfit = totalIncome - totalExpenses;
  const displayTotal = showExpenses ? netProfit : totalIncome;

  // ── Needs hours ──────────────────────────────────────────────────────────
  // Surfaced here (not just at the bottom of Log & Calendar) so a shift from
  // weeks ago can't quietly roll off the page unnoticed once the month turns over.
  const { jobsNeedingHours, oldestDays: oldestNeedsHoursDays } = useNeedsHours(data.jobs);

  // ── Pay check due ────────────────────────────────────────────────────────
  // Worked, priced, but nothing received yet — escalates the longer it waits.
  const paidJobIds = useMemo(() => {
    const set = new Set<string>();
    for (const income of data.income) {
      if (income.status === 'paid' && income.jobId) set.add(income.jobId);
    }
    return set;
  }, [data.income]);

  const awaitingPayment = useMemo(() => {
    return data.jobs
      .map(job => ({ job, pay: jobGross(job, data.jobs, data.employers) }))
      .filter(({ job, pay }) => pay > 0 && !paidJobIds.has(job.id))
      .sort((a, b) => a.job.date.localeCompare(b.job.date));
  }, [data.jobs, data.employers, paidJobIds]);

  const oldestUnpaid = awaitingPayment[0];
  const daysSinceOldestUnpaid = oldestUnpaid ? differenceInCalendarDays(new Date(), parseISO(oldestUnpaid.job.date)) : 0;
  const payTier: PayTimingTier = oldestUnpaid ? getPayTimingTier(daysSinceOldestUnpaid) : 'none';
  const totalUnpaidDue = awaitingPayment.reduce((s, { pay }) => s + pay, 0);

  return (
    <SpacePageWrapper title="Dashboard" description="Welcome back" starCount={220}>
      <FallingPlanets />

      {jobsNeedingHours.length > 0 && (
        <button
          onClick={() => navigate(`/new?job=${jobsNeedingHours[0].id}`)}
          className="pulse-shift-end relative z-10 w-full mb-4 flex items-center gap-3 rounded-lg border-2 border-accent bg-accent/10 px-4 py-4 text-left hover:bg-accent/15 transition-colors"
        >
          <Zap size={24} className="text-accent shrink-0" fill="currentColor" />
          <div className="min-w-0">
            <p className="text-base font-display font-bold uppercase tracking-wide text-accent">
              Log Hours{jobsNeedingHours.length > 1 ? ` — ${jobsNeedingHours.length} Shifts` : ''}
            </p>
            <p className="text-xs text-accent/70 font-body mt-0.5">
              {jobsNeedingHours[0].name} · {oldestNeedsHoursDays === 0 ? 'today' : `${oldestNeedsHoursDays}d ago`} — tap to close it out
            </p>
          </div>
        </button>
      )}

      {payTier !== 'none' && oldestUnpaid && (
        <button
          onClick={() => navigate('/pay')}
          className={
            'relative z-10 w-full mb-6 flex items-center gap-3 rounded-lg border-2 px-4 py-4 text-left transition-colors ' +
            (payTier === 'watching' ? 'pulse-pay-watching border-primary bg-primary/10 hover:bg-primary/15'
              : payTier === 'warm' ? 'pulse-pay-warm border-amber-500 bg-amber-500/10 hover:bg-amber-500/15'
              : 'pulse-pay-blazing border-red-500 bg-gradient-to-br from-red-500/15 to-orange-500/10 hover:from-red-500/20')
          }
        >
          {payTier === 'watching' && <Eye size={22} className="text-primary shrink-0" />}
          {payTier === 'warm' && <Flame size={22} className="flame-flicker text-amber-400 shrink-0" />}
          {payTier === 'blazing' && <span className="flame-flicker text-2xl shrink-0">🔥</span>}
          <div className="min-w-0">
            <p className={
              'text-base font-display font-bold uppercase tracking-wide ' +
              (payTier === 'watching' ? 'text-primary' : payTier === 'warm' ? 'text-amber-400' : 'text-red-400')
            }>
              {PAY_TIMING_LABELS[payTier]} — Check For Pay
            </p>
            <p className={'text-xs font-body mt-0.5 ' + (payTier === 'watching' ? 'text-primary/70' : payTier === 'warm' ? 'text-amber-400/70' : 'text-red-400/70')}>
              ${totalUnpaidDue.toLocaleString(undefined, { maximumFractionDigits: 0 })} unpaid · {daysSinceOldestUnpaid}d since {oldestUnpaid.job.name}
            </p>
          </div>
        </button>
      )}

      <div className="relative z-10 mb-6 flex items-baseline gap-3">
        <span className="text-3xl md:text-4xl font-bold text-mono text-white">${displayTotal.toLocaleString()}</span>
        <span className={`text-xs font-body uppercase tracking-wider ${displayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
          {showExpenses ? 'net' : 'income'} {displayTotal >= 0 ? '↑' : '↓'}
        </span>
        <span className="text-xs text-white/40 font-body ml-auto">{totalHours.toFixed(1)}h logged</span>
      </div>

      <ExportButton onClick={() => exportWeeklyToExcel(data.jobs, showExpenses ? data.expenses : [], showIncome ? data.income : [], data.employers)} />

      {/* On Deck / On Stage */}
      <div className="mb-6">
        <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isOnStage ? 'bg-fuchsia-500' : 'bg-amber-400'}`} />
          {isOnStage ? '🎤 On Stage' : '🎭 On Deck'}
        </h2>
        {!nextJob ? (
          <div className="rounded-xl border border-white/10 bg-black/30 p-4 flex flex-col items-center gap-1 py-6">
            <p className="text-2xl">🌅</p>
            <p className="text-xs text-muted-foreground font-body">No jobs on the horizon</p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-base font-display truncate">{nextJob.name}</p>
                <p className="text-xs text-muted-foreground font-body truncate mt-0.5">{nextJob.client}{nextJob.venue ? ` · ${nextJob.venue}` : ''}</p>
              </div>
              <span className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-[10px] font-body font-medium ${isOnStage ? 'bg-fuchsia-500/20 text-fuchsia-300' : 'bg-amber-400/20 text-amber-300'}`}>
                {isOnStage ? 'today' : format(parseISO(nextJob.date), 'MMM d')}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-mono text-muted-foreground mt-2">
              {nextJob.startTime && <span>{nextJob.startTime}</span>}
              {nextJob.hourlyRate && <span>· ${nextJob.hourlyRate}/hr</span>}
              {nextJob.minimumHours && <span>· {nextJob.minimumHours}h min</span>}
            </div>
          </div>
        )}
      </div>

    {/* ── Month + YTD side by side ──────────────────────────────────────── */}
      <div className="mb-6">
        <div className="grid grid-cols-2 gap-3">

          {/* Left — This month */}
          <div className="flex flex-col gap-2">
            <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
              {format(new Date(), 'MMM')}
            </h2>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Hours</p>
              <p className="text-lg font-bold text-mono mt-1">{thisMonthHours.toFixed(1)}</p>
            </div>
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 shadow-[0_0_16px_2px_rgba(139,92,246,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Earned</p>
              <p className="text-lg font-bold text-mono mt-1 text-violet-300">${thisMonthExpected.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_16px_2px_rgba(16,185,129,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Paid</p>
              <p className="text-lg font-bold text-mono text-emerald-400 mt-1">${thisMonthPaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl border border-yellow-400/30 bg-yellow-400/5 shadow-[0_0_16px_2px_rgba(250,204,21,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Unpaid</p>
              <p className="text-lg font-bold text-mono mt-1 text-yellow-400">
                {thisMonthUnpaid > 0 ? `$${thisMonthUnpaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}` : '✓'}
              </p>
            </div>
          </div>

          {/* Right — YTD */}
          <div className="flex flex-col gap-2">
            <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
              {yearPrefix}
            </h2>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Hours</p>
              <p className="text-lg font-bold text-mono mt-1">{ytdHours.toFixed(1)}</p>
            </div>
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 shadow-[0_0_16px_2px_rgba(139,92,246,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Earned</p>
              <p className="text-lg font-bold text-mono mt-1 text-violet-300">${ytdExpected.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_16px_2px_rgba(16,185,129,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Paid</p>
              <p className="text-lg font-bold text-mono text-emerald-400 mt-1">${ytdPaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl border border-yellow-400/30 bg-yellow-400/5 shadow-[0_0_16px_2px_rgba(250,204,21,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Unpaid</p>
              <p className="text-lg font-bold text-mono mt-1 text-yellow-400">
                {ytdExpected - ytdPaid > 0 ? `$${Math.max(0, ytdExpected - ytdPaid).toLocaleString(undefined, { minimumFractionDigits: 0 })}` : '✓'}
              </p>
            </div>
          </div>

        </div>
      </div>
      {/* ── By employer ────────────────────────────────────────────────────── */}
      {byEmployer.length > 0 && (
        <div className="mb-6 rounded-xl border border-violet-500/20 bg-card overflow-hidden shadow-[0_0_16px_2px_rgba(139,92,246,0.08)]">
          <button
            onClick={() => setEmployerExpanded(e => !e)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/30 transition-colors"
          >
            <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60">By employer</h2>
            <ChevronDown size={14} className={`text-muted-foreground transition-transform ${employerExpanded ? 'rotate-180' : ''}`} />
          </button>
          {employerExpanded && (
            <div className="divide-y divide-border/40 border-t border-border/50">
              {byEmployer.map(({ client, hours, earned, jobs }) => (
                <div key={client} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{client}</p>
                    <p className="text-[10px] font-body text-muted-foreground">{jobs} job{jobs !== 1 ? 's' : ''} · {hours.toFixed(1)}h</p>
                  </div>
                  <p className="text-sm font-bold text-mono text-violet-300 shrink-0 ml-3">
                    ${earned.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent expenses — only if there are any */}
      {showExpenses && recentExpenses.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-500/20 bg-card p-4 shadow-[0_0_16px_2px_rgba(245,158,11,0.08)]">
          <h2 className="text-[10px] font-body mb-3 text-muted-foreground uppercase tracking-widest">Recent Expenses</h2>
          <div className="space-y-2">
            {recentExpenses.map(exp => (
              <div key={exp.id} className="flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{exp.description}</p>
                  <p className="text-xs text-muted-foreground font-body">{exp.category}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-mono text-destructive">-${exp.amount.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground font-body">{format(new Date(exp.date), 'MMM d')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </SpacePageWrapper>
  );
}
