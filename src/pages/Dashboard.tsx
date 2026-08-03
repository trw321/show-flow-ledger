import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { ChevronDown, Ghost } from 'lucide-react';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO, isToday } from 'date-fns';
import { motion } from 'framer-motion';
import { FogDrift, BatSilhouette, MoonGlow, TombstoneRow } from '@/components/CemeteryDecor';
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
  const { totalPay } = calculateDayPay(hours, rate, job.minimumHours ?? 0, job.mealPenalties ?? 0, dayMult, job.mealType, {
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

function ExportCsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-bounce group relative w-full mb-8 overflow-hidden rounded-t-[2.5rem] rounded-b-xl border-2 border-[#a3e635]/50 bg-gradient-to-b from-[#1c1a24] to-[#0e0d13] py-6 px-6 shadow-[0_0_28px_-4px_rgba(163,230,53,0.35)] hover:shadow-[0_0_36px_-2px_rgba(163,230,53,0.55)]"
    >
      <span className="absolute top-0 left-0 right-0 h-2 bj-stripes opacity-80" />
      <span className="relative z-10 flex items-center justify-center gap-3 text-lg font-bold font-spooky tracking-wide text-[#d9f99d]">
        <Ghost size={26} strokeWidth={2} className="text-[#d9f99d] group-hover:animate-bounce" />
        Export to Excel
      </span>
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
    <>
      <ExportCsvButton onClick={() => exportWeeklyToExcel(data.jobs, showExpenses ? data.expenses : [], showIncome ? data.income : [])} />

      {/* Hero — cemetery scene */}
      <div className="relative overflow-hidden rounded-2xl border border-[#3a3648]/60 mb-6 p-5 bg-gradient-to-b from-[#141220] via-[#0e0d16] to-[#0a0a12]">
        <span className="absolute top-0 left-0 right-0 h-1.5 bj-stripes opacity-70 z-20" />
        <div className="absolute inset-0 opacity-30">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(circle at 20% 30%, hsl(88 60% 50% / 0.25), transparent 50%), radial-gradient(circle at 80% 20%, hsl(280 60% 45% / 0.35), transparent 55%), radial-gradient(circle at 50% 90%, hsl(240 30% 20% / 0.6), transparent 50%)' }}
            animate={{ background: ['radial-gradient(circle at 20% 30%, hsl(88 60% 50% / 0.25), transparent 50%), radial-gradient(circle at 80% 20%, hsl(280 60% 45% / 0.35), transparent 55%), radial-gradient(circle at 50% 90%, hsl(240 30% 20% / 0.6), transparent 50%)', 'radial-gradient(circle at 50% 20%, hsl(88 60% 50% / 0.25), transparent 50%), radial-gradient(circle at 50% 60%, hsl(280 60% 45% / 0.35), transparent 55%), radial-gradient(circle at 80% 90%, hsl(240 30% 20% / 0.6), transparent 50%)', 'radial-gradient(circle at 80% 30%, hsl(88 60% 50% / 0.25), transparent 50%), radial-gradient(circle at 20% 20%, hsl(280 60% 45% / 0.35), transparent 55%), radial-gradient(circle at 50% 90%, hsl(240 30% 20% / 0.6), transparent 50%)'] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          />
        </div>
        <MoonGlow className="absolute top-3 right-4 w-12 h-12 z-0" />
        <BatSilhouette className="absolute top-6 left-8 w-9 h-5 z-0" delay={0} />
        <BatSilhouette className="absolute top-12 right-16 w-6 h-3.5 z-0" delay={2} />
        <FogDrift className="absolute bottom-0 left-1/4 w-24 h-10 rounded-full bg-[#a3e635]/10 blur-xl" delay={0.5} />
        <FogDrift className="absolute bottom-0 right-1/4 w-28 h-10 rounded-full bg-[#c4b5fd]/10 blur-xl" delay={1.5} />
        <TombstoneRow className="absolute bottom-0 left-0 right-0 flex items-end justify-center gap-3 opacity-70 z-[1]" />
        <div className="relative z-10">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-body mb-1">Welcome back</p>
            <h1 className="text-3xl md:text-4xl font-spooky tracking-wide text-[#d9f99d]" style={{ textShadow: '0 0 12px rgba(163,230,53,0.55), 0 0 28px rgba(147,51,234,0.35)' }}>Show Flow</h1>
          </motion.div>
          <motion.div className="mt-4 flex items-baseline gap-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
            <span className="text-3xl md:text-4xl font-bold text-mono text-foreground">${displayTotal.toLocaleString()}</span>
            <span className={`text-xs font-body uppercase tracking-wider ${displayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
              {showExpenses ? 'net' : 'income'} {displayTotal >= 0 ? '↑' : '↓'}
            </span>
          </motion.div>
          <motion.div className="mt-2 flex gap-4 text-xs text-muted-foreground font-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.4 }}>
            <span>{totalHours.toFixed(1)}h logged</span>
          </motion.div>
        </div>
      </div>

      {/* On Deck / On Stage */}
      <div className="mb-6">
        <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isOnStage ? 'bg-fuchsia-500' : 'bg-amber-400'}`} />
          {isOnStage ? '🎤 On Stage' : '🎭 On Deck'}
        </h2>
        {!nextJob ? (
          <div className="rounded-xl border border-border bg-card p-4 flex flex-col items-center gap-1 py-6">
            <p className="text-2xl">🌅</p>
            <p className="text-xs text-muted-foreground font-body">No jobs on the horizon</p>
          </div>
        ) : (
          <div className={`rounded-xl border p-4 ${isOnStage ? 'border-fuchsia-500/40 bg-fuchsia-500/5 shadow-[0_0_20px_2px_rgba(217,70,219,0.15)]' : 'border-amber-400/40 bg-amber-400/5 shadow-[0_0_20px_2px_rgba(251,191,36,0.12)]'}`}>
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
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
              {format(new Date(), 'MMM')}
            </h2>
            <div className="rounded-xl border border-slate-400/30 bg-slate-400/5 shadow-[0_0_16px_2px_rgba(148,163,184,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Hours</p>
              <p className="text-lg font-bold text-mono mt-1">{thisMonthHours.toFixed(1)}</p>
            </div>
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 shadow-[0_0_16px_2px_rgba(168,85,247,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Expected</p>
              <p className="text-lg font-bold text-mono mt-1">${thisMonthExpected.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl border border-green-500/30 bg-green-500/5 shadow-[0_0_16px_2px_rgba(34,197,94,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Paid</p>
              <p className="text-lg font-bold text-mono text-green-400 mt-1">${thisMonthPaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
            <div className={`rounded-xl border p-3 ${thisMonthUnpaid > 0 ? 'border-amber-500/30 bg-amber-500/5 shadow-[0_0_16px_2px_rgba(245,158,11,0.12)]' : 'border-green-500/30 bg-green-500/5 shadow-[0_0_16px_2px_rgba(34,197,94,0.12)]'}`}>
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Unpaid</p>
              <p className={`text-lg font-bold text-mono mt-1 ${thisMonthUnpaid > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                {thisMonthUnpaid > 0 ? `$${thisMonthUnpaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}` : '✓'}
              </p>
            </div>
          </div>

          {/* Right — YTD */}
          <div className="flex flex-col gap-2">
            <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
              {yearPrefix}
            </h2>
            <div className="rounded-xl border border-slate-400/30 bg-slate-400/5 shadow-[0_0_16px_2px_rgba(148,163,184,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Hours</p>
              <p className="text-lg font-bold text-mono mt-1">{ytdHours.toFixed(1)}</p>
            </div>
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 shadow-[0_0_16px_2px_rgba(168,85,247,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Earned</p>
              <p className="text-lg font-bold text-mono mt-1 text-purple-300">${ytdExpected.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 shadow-[0_0_16px_2px_rgba(245,158,11,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Paid</p>
              <p className="text-lg font-bold text-mono text-amber-300 mt-1">${ytdPaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-xl border border-slate-300/30 bg-slate-300/5 shadow-[0_0_16px_2px_rgba(203,213,225,0.12)] p-3">
              <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Unpaid</p>
              <p className="text-lg font-bold text-mono text-slate-300 mt-1">${Math.max(0, ytdExpected - ytdPaid).toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
            </div>
          </div>

        </div>
      </div>
      {/* ── By employer ────────────────────────────────────────────────────── */}
      {byEmployer.length > 0 && (
        <div className="mb-6 rounded-xl border border-purple-500/20 bg-card overflow-hidden shadow-[0_0_16px_2px_rgba(168,85,247,0.08)]">
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
                  <p className="text-sm font-bold text-mono text-purple-300 shrink-0 ml-3">
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
    </>
  );
}
