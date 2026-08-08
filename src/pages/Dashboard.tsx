import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import FallingPlanets from '@/components/FallingPlanets';
import { ChevronDown, Download } from 'lucide-react';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO, isToday } from 'date-fns';
import { exportWeeklyToExcel } from '@/lib/exportWeekly';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { calculateDayPay, getDayMultiplier, calculateWeeklyOvertimeBonus } from '@/lib/payCalc';
import type { Job, Employer } from '@/lib/store';

function jobGross(job: Job, allJobs: Job[], employers: Employer[] = []): number {
  const hours = job.hoursWorked ?? 0;
  if (!hours) return 0;
  const rate = job.hourlyRate ?? 0;
  const employer = employers.find(e => e.name.toLowerCase() === job.client.toLowerCase());
  const dayMult = getDayMultiplier(job.date, job.client, allJobs, job.has6th7thDayRule ?? false);
  const { totalPay } = calculateDayPay(hours, rate, job.minimumHours ?? 0, job.mealPenalties ?? 0, dayMult, { duration: job.mealDuration, onClock: job.mealOnClock }, {
    rule: employer?.overtimeRule ?? 'daily',
    otThresholdHours: employer?.dailyOvertimeThresholdHours,
    dtThresholdHours: employer?.dailyDoubletimeThresholdHours,
    otMultiplier: employer?.overtimeMultiplier,
    dtMultiplier: employer?.doubletimeMultiplier,
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

  const thisMonthHours = thisMonthJobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
  const thisMonthExpected = thisMonthJobs.reduce((s, j) => s + jobGross(j, data.jobs, data.employers), 0);
  const thisMonthPaid = data.income
    .filter(i => i.status === 'paid' && (() => { try { return isWithinInterval(parseISO(i.date), { start: monthStart, end: monthEnd }); } catch { return false; } })())
    .reduce((s, i) => s + i.amount, 0);
  const thisMonthUnpaid = Math.max(0, thisMonthExpected - thisMonthPaid);

  // ── YTD ──────────────────────────────────────────────────────────────────
  const yearPrefix = format(new Date(), 'yyyy');
  const ytdJobs = data.jobs.filter(j => j.date.startsWith(yearPrefix));
  const ytdHours = ytdJobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
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
      map[key].hours += job.hoursWorked ?? 0;
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
  const totalHours = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
  const netProfit = totalIncome - totalExpenses;
  const displayTotal = showExpenses ? netProfit : totalIncome;

  return (
    <SpacePageWrapper title="Dashboard" description="Welcome back" starCount={220}>
      <FallingPlanets />
      <div className="relative z-10 mb-6 flex items-baseline gap-3">
        <span className="text-3xl md:text-4xl font-bold text-mono text-white">${displayTotal.toLocaleString()}</span>
        <span className={`text-xs font-body uppercase tracking-wider ${displayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
          {showExpenses ? 'net' : 'income'} {displayTotal >= 0 ? '↑' : '↓'}
        </span>
        <span className="text-xs text-white/40 font-body ml-auto">{totalHours.toFixed(1)}h logged</span>
      </div>

      <ExportButton onClick={() => exportWeeklyToExcel(data.jobs, showExpenses ? data.expenses : [], showIncome ? data.income : [])} />

      {/* On Deck / On Stage */}
      <div className="mb-6">
        <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isOnStage ? 'bg-fuchsia-500' : 'bg-amber-400'}`} />
          {isOnStage ? '🎤 On Stage' : '🎭 On Deck'}
        </h2>
        {!nextJob ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col items-center gap-1 py-6">
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
            <div className={`rounded-xl border p-3 ${thisMonthUnpaid > 0 ? 'border-amber-500/30 bg-amber-500/5 shadow-[0_0_16px_2px_rgba(245,158,11,0.12)]' : 'border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_16px_2px_rgba(16,185,129,0.12)]'}`}>
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Unpaid</p>
              <p className={`text-lg font-bold text-mono mt-1 ${thisMonthUnpaid > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
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
            <div className={`rounded-xl border p-3 ${ytdExpected - ytdPaid > 0 ? 'border-amber-500/30 bg-amber-500/5 shadow-[0_0_16px_2px_rgba(245,158,11,0.12)]' : 'border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_16px_2px_rgba(16,185,129,0.12)]'}`}>
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Unpaid</p>
              <p className={`text-lg font-bold text-mono mt-1 ${ytdExpected - ytdPaid > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
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
