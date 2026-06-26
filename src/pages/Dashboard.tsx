import { useState, useMemo, useRef } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { Upload, Loader2, ChevronDown } from 'lucide-react';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO, isToday } from 'date-fns';
import { motion } from 'framer-motion';
import { exportWeeklyToExcel } from '@/lib/exportWeekly';
import { hasLegacyData, getLegacyData, clearLegacyData } from '@/lib/store';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { calculateDayPay, getDayMultiplier } from '@/lib/payCalc';
import { toast } from 'sonner';
import type { Job } from '@/lib/store';

function jobGross(job: Job, allJobs: Job[]): number {
  const hours = job.hoursWorked ?? 0;
  if (!hours) return 0;
  const rate = job.hourlyRate ?? 0;
  const dayMult = getDayMultiplier(job.date, job.client, allJobs, job.has6th7thDayRule ?? false);
  const { totalPay } = calculateDayPay(hours, rate, job.minimumHours ?? 0, job.mealPenalties ?? 0, dayMult, job.mealType);
  return totalPay + (job.hasVacationPay ? totalPay * 0.08 : 0);
}

function Starburst({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ scale: 0, rotate: 0, opacity: 0 }}
      animate={{ scale: [0, 1.2, 1], rotate: [0, 180], opacity: [0, 0.8, 0.4] }}
      transition={{ duration: 2, delay, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut' }}
    >
      <div className="starburst w-full h-full funky-gradient" />
    </motion.div>
  );
}

function FloatingOrb({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      animate={{ y: [0, -15, 0], scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration: 4, delay, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

function DiscoBallExport({ onClick }: { onClick: () => void }) {
  const [sparkles, setSparkles] = useState<{ id: number; tx: number; ty: number; color: string; char: string }[]>([]);
  const counter = useRef(0);

  const handleClick = () => {
    const chars = ['✦','★','✧','◆','✶'];
    const colors = ['#ff0080','#00ccff','#ff6600','#00ff44','#9900ff','#ffcc00','#ff3300','#0044ff'];
    const newSparkles = Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2;
      const dist = 60 + Math.random() * 50;
      return {
        id: counter.current++,
        tx: Math.cos(angle) * dist,
        ty: Math.sin(angle) * dist - 20,
        color: colors[Math.floor(Math.random() * colors.length)],
        char: chars[Math.floor(Math.random() * chars.length)],
      };
    });
    setSparkles(newSparkles);
    setTimeout(() => setSparkles([]), 900);
    onClick();
  };

  return (
    <div className="flex flex-col items-center mb-6 mt-2">
      <div className="w-0.5 h-8 bg-border mx-auto" />
      <div className="relative" style={{ width: 120, height: 120 }}>
        <button
          onClick={handleClick}
          className="w-full h-full rounded-full border-0 bg-transparent p-0 cursor-pointer"
          style={{ animation: 'spin 4s linear infinite' }}
          aria-label="Export data to CSV"
          title="Tap to export CSV"
        >
          <svg viewBox="0 0 120 120" width="120" height="120">
            <defs>
              <radialGradient id="bg" cx="35%" cy="30%" r="65%">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.9"/>
                <stop offset="40%" stopColor="#ccc" stopOpacity="0.5"/>
                <stop offset="100%" stopColor="#666" stopOpacity="0.8"/>
              </radialGradient>
              <clipPath id="bc"><circle cx="60" cy="60" r="54"/></clipPath>
            </defs>
            <circle cx="60" cy="60" r="54" fill="#888"/>
            <circle cx="60" cy="60" r="54" fill="url(#bg)"/>
            <g clipPath="url(#bc)">
              {[16,30,44,58,72,86,100].map((y, ri) =>
                [6,24,42,60,78,96].map((x, ci) => {
                  const cs = ['#ff0080','#00ccff','#ff6600','#00ff44','#9900ff','#ffcc00'];
                  return <rect key={`${ri}-${ci}`} x={x} y={y} width="14" height="10" rx="1" fill={cs[(ri+ci)%6]} opacity="0.85"/>;
                })
              )}
            </g>
            <circle cx="60" cy="60" r="54" fill="url(#bg)" opacity="0.3"/>
            <ellipse cx="44" cy="40" rx="10" ry="6" fill="white" opacity="0.35" transform="rotate(-20 44 40)"/>
          </svg>
        </button>
        {sparkles.map(s => (
          <span
            key={s.id}
            style={{
              position: 'absolute', left: '50%', top: '50%',
              transform: 'translate(-50%,-50%)',
              color: s.color, fontSize: 18, pointerEvents: 'none',
              animation: 'sparkle-out 0.9s ease-out forwards',
              ['--tx' as string]: s.tx + 'px',
              ['--ty' as string]: s.ty + 'px',
            }}
          >
            {s.char}
          </span>
        ))}
      </div>
      <p className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 mt-2">Export CSV</p>
      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes sparkle-out { 0%{opacity:1;transform:translate(calc(-50% + 0px),calc(-50% + 0px)) scale(1)} 100%{opacity:0;transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(0)} }
      `}</style>
    </div>
  );
}

export default function Dashboard() {
  const { data, migrateLocalData } = useData();
  const { prefs } = useUserPrefs();
  const navigate = useNavigate();
  const [showMigrate, setShowMigrate] = useState(hasLegacyData);
  const [migrating, setMigrating] = useState(false);
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
  const thisMonthExpected = thisMonthJobs.reduce((s, j) => s + jobGross(j, data.jobs), 0);
  const thisMonthPaid = data.income
    .filter(i => i.status === 'paid' && (() => { try { return isWithinInterval(parseISO(i.date), { start: monthStart, end: monthEnd }); } catch { return false; } })())
    .reduce((s, i) => s + i.amount, 0);
  const thisMonthUnpaid = Math.max(0, thisMonthExpected - thisMonthPaid);

  // ── YTD ──────────────────────────────────────────────────────────────────
  const yearPrefix = format(new Date(), 'yyyy');
  const ytdJobs = data.jobs.filter(j => j.date.startsWith(yearPrefix));
  const ytdHours = ytdJobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
  const ytdExpected = ytdJobs.reduce((s, j) => s + jobGross(j, data.jobs), 0);
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
      map[key].earned += jobGross(job, data.jobs);
      map[key].jobs += 1;
    }
    return Object.entries(map)
      .map(([client, stats]) => ({ client, ...stats }))
      .sort((a, b) => b.earned - a.earned);
  }, [data.jobs]);

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

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const legacy = getLegacyData();
      const count = await migrateLocalData(legacy);
      clearLegacyData();
      setShowMigrate(false);
      toast.success(`Migrated ${count} records to your account`);
    } catch (err) {
      console.error(err);
      toast.error('Migration failed — your local data is still safe');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <>
      {showMigrate && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-4 flex items-center gap-3 flex-wrap">
          <Upload size={18} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Local data found</p>
            <p className="text-xs text-muted-foreground">Import your existing jobs, expenses, and income into your account.</p>
          </div>
          <button onClick={handleMigrate} disabled={migrating} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
            {migrating ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {migrating ? 'Migrating...' : 'Import Data'}
          </button>
          <button onClick={() => setShowMigrate(false)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {/* Disco ball export — top of page */}
      <DiscoBallExport onClick={() => exportWeeklyToExcel(data.jobs, showExpenses ? data.expenses : [], showIncome ? data.income : [])} />

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border mb-6 p-5 bg-card">
        <div className="absolute inset-0 opacity-20">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'radial-gradient(circle at 20% 50%, hsl(210 100% 55% / 0.4), transparent 50%), radial-gradient(circle at 80% 50%, hsl(265 90% 60% / 0.4), transparent 50%), radial-gradient(circle at 50% 80%, hsl(50 100% 55% / 0.3), transparent 40%)' }}
            animate={{ background: ['radial-gradient(circle at 20% 50%, hsl(210 100% 55% / 0.4), transparent 50%), radial-gradient(circle at 80% 50%, hsl(265 90% 60% / 0.4), transparent 50%), radial-gradient(circle at 50% 80%, hsl(50 100% 55% / 0.3), transparent 40%)', 'radial-gradient(circle at 50% 20%, hsl(210 100% 55% / 0.4), transparent 50%), radial-gradient(circle at 50% 80%, hsl(265 90% 60% / 0.4), transparent 50%), radial-gradient(circle at 80% 50%, hsl(50 100% 55% / 0.3), transparent 40%)', 'radial-gradient(circle at 80% 50%, hsl(210 100% 55% / 0.4), transparent 50%), radial-gradient(circle at 20% 50%, hsl(265 90% 60% / 0.4), transparent 50%), radial-gradient(circle at 50% 20%, hsl(50 100% 55% / 0.3), transparent 40%)'] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          />
        </div>
        <Starburst className="absolute top-2 right-4 w-8 h-8" delay={0} />
        <Starburst className="absolute bottom-3 left-6 w-6 h-6" delay={1.2} />
        <Starburst className="absolute top-1/2 right-1/4 w-5 h-5" delay={2.5} />
        <FloatingOrb className="absolute top-4 left-1/3 w-16 h-16 rounded-full bg-primary/10 blur-xl" delay={0.5} />
        <FloatingOrb className="absolute bottom-2 right-1/3 w-20 h-20 rounded-full bg-accent/10 blur-xl" delay={1.5} />
        <div className="relative z-10">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-body mb-1">Welcome back</p>
            <h1 className="text-2xl md:text-3xl font-display funky-gradient-text">Show Flow</h1>
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

      {/* ── This month ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
          {format(new Date(), 'MMMM yyyy')}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 shadow-[0_0_16px_2px_rgba(59,130,246,0.12)] p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Hours</p>
            <p className="text-xl font-bold text-mono mt-1">{thisMonthHours.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 shadow-[0_0_16px_2px_rgba(168,85,247,0.12)] p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Expected</p>
            <p className="text-xl font-bold text-mono mt-1">${thisMonthExpected.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
          </div>
          <div className={`rounded-xl border p-3 ${thisMonthUnpaid > 0 ? 'border-amber-500/30 bg-amber-500/5 shadow-[0_0_16px_2px_rgba(245,158,11,0.12)]' : 'border-green-500/30 bg-green-500/5 shadow-[0_0_16px_2px_rgba(34,197,94,0.12)]'}`}>
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">{thisMonthUnpaid > 0 ? 'Unpaid' : 'All paid'}</p>
            <p className={`text-xl font-bold text-mono mt-1 ${thisMonthUnpaid > 0 ? 'text-amber-400' : 'text-green-400'}`}>
              {thisMonthUnpaid > 0 ? `$${thisMonthUnpaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}` : '✓'}
            </p>
          </div>
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 shadow-[0_0_16px_2px_rgba(34,197,94,0.12)] p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Paid</p>
            <p className="text-xl font-bold text-mono text-green-400 mt-1">${thisMonthPaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
          </div>
        </div>
      </div>

      {/* ── YTD ────────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 inline-block" />
          {yearPrefix} year to date
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 shadow-[0_0_16px_2px_rgba(59,130,246,0.12)] p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Hours</p>
            <p className="text-xl font-bold text-mono mt-1">{ytdHours.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 shadow-[0_0_16px_2px_rgba(168,85,247,0.12)] p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Earned</p>
            <p className="text-xl font-bold text-mono mt-1 text-purple-300">${ytdExpected.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 shadow-[0_0_16px_2px_rgba(245,158,11,0.12)] p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Paid</p>
            <p className="text-xl font-bold text-mono text-amber-300 mt-1">${ytdPaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
          </div>
          <div className="rounded-xl border border-blue-400/30 bg-blue-400/5 shadow-[0_0_16px_2px_rgba(96,165,250,0.12)] p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Unpaid</p>
            <p className="text-xl font-bold text-mono text-blue-300 mt-1">${Math.max(0, ytdExpected - ytdPaid).toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
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
