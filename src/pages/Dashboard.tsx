import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/lib/DataContext';
import LampPageWrapper from '@/components/LampPageWrapper';
import NewGigPage from '@/pages/NewGigPage';
import { ChevronDown, Download, Zap, Eye, Flame } from 'lucide-react';
import { format, parseISO, isToday, differenceInCalendarDays } from 'date-fns';
import { exportWeeklyToExcel } from '@/lib/exportWeekly';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { effectiveHoursWorked, jobGross } from '@/lib/payCalc';
import { useNeedsHours } from '@/lib/useNeedsHours';
import { getPayTimingTier, PAY_TIMING_LABELS, type PayTimingTier } from '@/lib/payTiming';

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-bounce w-full mb-6 flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 py-3 px-4 text-sm font-semibold text-white/90 transition-colors"
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
    <LampPageWrapper title="Dashboard" description="Welcome back">
      <NewGigPage />

      {jobsNeedingHours.length > 0 && (
        <button
          onClick={() => navigate(`/calendar?job=${jobsNeedingHours[0].id}`)}
          className="relative z-10 w-full mb-4 flex items-center gap-3 rounded-md border border-accent/50 bg-accent/5 hover:border-accent/70 hover:bg-accent/10 px-4 py-4 text-left transition-colors"
        >
          <Zap size={20} className="text-accent shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-accent">
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
            'relative z-10 w-full mb-6 flex items-center gap-3 rounded-md border px-4 py-4 text-left transition-colors ' +
            (payTier === 'watching' ? 'border-primary/50 bg-primary/5 hover:border-primary/70 hover:bg-primary/10'
              : payTier === 'warm' ? 'border-warning/50 bg-warning/5 hover:border-warning/70 hover:bg-warning/10'
              : 'border-destructive/50 bg-destructive/5 hover:border-destructive/70 hover:bg-destructive/10')
          }
        >
          {payTier === 'watching' && <Eye size={18} className="text-primary shrink-0" />}
          {payTier === 'warm' && <Flame size={18} className="flame-flicker text-warning shrink-0" />}
          {payTier === 'blazing' && <span className="flame-flicker text-xl shrink-0">🔥</span>}
          <div className="min-w-0">
            <p className={
              'text-sm font-semibold ' +
              (payTier === 'watching' ? 'text-primary' : payTier === 'warm' ? 'text-warning' : 'text-destructive')
            }>
              {PAY_TIMING_LABELS[payTier]} — Check For Pay
            </p>
            <p className={'text-xs font-body mt-0.5 ' + (payTier === 'watching' ? 'text-primary/70' : payTier === 'warm' ? 'text-warning/70' : 'text-destructive/70')}>
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
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${isOnStage ? 'bg-primary' : 'bg-accent'}`} />
          {isOnStage ? '🎤 On Stage' : '🎭 On Deck'}
        </h2>
        {!nextJob ? (
          <div className="rounded-md border border-white/10 bg-black/30 p-4 flex flex-col items-center gap-1 py-6">
            <p className="text-2xl">🌅</p>
            <p className="text-xs text-muted-foreground font-body">No jobs on the horizon</p>
          </div>
        ) : (
          <button
            onClick={() => navigate(`/calendar?job=${nextJob.id}`)}
            className="w-full rounded-md border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10 active:opacity-80 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-base font-display truncate">{nextJob.name}</p>
                <p className="text-xs text-muted-foreground font-body truncate mt-0.5">{nextJob.client}{nextJob.venue ? ` · ${nextJob.venue}` : ''}</p>
              </div>
              <span className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-[10px] font-body font-medium ${isOnStage ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent'}`}>
                {isOnStage ? 'today' : format(parseISO(nextJob.date), 'MMM d')}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-mono text-muted-foreground mt-2">
              {nextJob.startTime && <span>{nextJob.startTime}</span>}
              {nextJob.hourlyRate && <span>· ${nextJob.hourlyRate}/hr</span>}
              {nextJob.minimumHours && <span>· {nextJob.minimumHours}h min</span>}
            </div>
          </button>
        )}
      </div>

      {/* ── By employer ────────────────────────────────────────────────────── */}
      {byEmployer.length > 0 && (
        <div className="mb-6 rounded-md border border-white/10 bg-white/5 overflow-hidden">
          <button
            onClick={() => setEmployerExpanded(e => !e)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
          >
            <h2 className="text-[10px] font-body uppercase tracking-widest text-white/40">By employer</h2>
            <ChevronDown size={14} className={`text-white/40 transition-transform ${employerExpanded ? 'rotate-180' : ''}`} />
          </button>
          {employerExpanded && (
            <div className="divide-y divide-white/10 border-t border-white/10">
              {byEmployer.map(({ client, hours, earned, jobs }) => (
                <div key={client} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/90 truncate">{client}</p>
                    <p className="text-[10px] font-body text-white/40">{jobs} job{jobs !== 1 ? 's' : ''} · {hours.toFixed(1)}h</p>
                  </div>
                  <p className="text-sm font-bold text-mono text-white shrink-0 ml-3">
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
        <div className="mb-6 rounded-md border border-white/10 bg-white/5 p-4">
          <h2 className="text-[10px] font-body mb-3 text-white/40 uppercase tracking-widest">Recent Expenses</h2>
          <div className="space-y-2">
            {recentExpenses.map(exp => (
              <div key={exp.id} className="flex items-center justify-between rounded-md bg-white/5 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-white/90">{exp.description}</p>
                  <p className="text-xs text-white/40 font-body">{exp.category}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-mono text-destructive">-${exp.amount.toLocaleString()}</p>
                  <p className="text-xs text-white/40 font-body">{format(new Date(exp.date), 'MMM d')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </LampPageWrapper>
  );
}
