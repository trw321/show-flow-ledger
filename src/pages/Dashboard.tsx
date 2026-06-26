import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import StatCard from '@/components/StatCard';
import PageHeader from '@/components/PageHeader';
import { Briefcase, DollarSign, TrendingUp, TrendingDown, AlertCircle, Clock, Download, Upload, Loader2, ChevronDown } from 'lucide-react';
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from 'recharts';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GlitterActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g style={{ filter: `drop-shadow(0 0 12px ${fill}) drop-shadow(0 0 4px #fff4)` }}>
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 3} outerRadius={outerRadius + 10} startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.25} />
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 2} outerRadius={outerRadius + 5} startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 2} outerRadius={innerRadius + (outerRadius - innerRadius) * 0.52} startAngle={startAngle} endAngle={endAngle} fill="rgba(255,255,255,0.22)" />
    </g>
  );
}

const FALLING_ITEMS = ['💰','💴','💰','🪙','💵','💰','🪙','💴','💰','💵','🪙','💰','💵','💴','💰','🪙'];
function DiscoBallExport({ onClick }: { onClick: () => void }) {
  const [sparkles, setSparkles] = useState<{ id: number; tx: number; ty: number; color: string; char: string }[]>([]);
  const counter = useRef(0);

  const handleClick = () => {
    const chars = ['✦','★','✧','◆','✶'];
    const colors = ['#ff6ec7','#00eeff','#ffe566','#7bff6e','#ff9966','#cc88ff'];
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
                  const cs = ['#ff6ec7','#00eeff','#ffe566','#7bff6e'];
                  return <rect key={`${ri}-${ci}`} x={x} y={y} width="14" height="10" rx="1" fill={cs[(ri+ci)%4]} opacity="0.85"/>;
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
              animation: `sparkle-out 0.9s ease-out forwards`,
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
  const [taxRate, setTaxRate] = useState(25);
  const [showMigrate, setShowMigrate] = useState(hasLegacyData);
  const [migrating, setMigrating] = useState(false);
  const [employerExpanded, setEmployerExpanded] = useState(false);

  if (!data) return null;

  const showIncome = prefs.tabs.income;
  const showExpenses = prefs.tabs.expenses;
  const showTaxes = prefs.tabs.taxes;

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

  // ── Existing totals ───────────────────────────────────────────────────────
  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0);
  const totalIncome = data.income.reduce((s, i) => s + i.amount, 0);
  const pendingIncome = data.income.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0);
  const overdueIncome = data.income.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
  const activeJobs = data.jobs.filter(j => j.status === 'upcoming' || j.status === 'in-progress').length;
  const totalHours = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
  const totalEarnings = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);
  const netProfit = totalIncome - totalExpenses;
  const displayTotal = showExpenses ? netProfit : totalIncome;
  const estimatedTax = Math.max(0, displayTotal * (taxRate / 100));
  const afterTax = displayTotal - estimatedTax;

  const pieData = [
    { name: 'Take Home', value: Math.max(0, afterTax), color: 'hsl(76, 92%, 48%)' },
    { name: 'Estimated Tax', value: estimatedTax, color: 'hsl(50, 100%, 55%)' },
    ...(showExpenses ? [{ name: 'Expenses', value: totalExpenses, color: 'hsl(0, 72%, 55%)' }] : []),
  ].filter(d => d.value > 0);

  const recentJobs = [...data.jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  const recentExpenses = [...data.expenses].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  const recentExpenses = [...data.expenses].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  const nextJob = [...data.jobs]
    .filter(j => j.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date))
    .find(j => j.date >= format(new Date(), 'yyyy-MM-dd'));

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
            <span>{activeJobs} active job{activeJobs !== 1 ? 's' : ''}</span>
            <span>•</span>
            <span>{totalHours.toFixed(1)}h logged</span>
          </motion.div>
        </div>
      </div>

      {/* Falling money */}
      <div className="relative h-28 overflow-hidden rounded-2xl mb-6 cursor-pointer border border-border bg-card/50" onClick={() => navigate('/pay')}>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/40">tap to reconcile pay</p>
        </div>
        {FALLING_ITEMS.map((emoji, i) => (
          <motion.div key={i} className="absolute select-none" style={{ left: `${(i * 6.5) % 96}%`, fontSize: emoji === '🪙' ? '1.1rem' : '1.5rem', filter: emoji === '🪙' ? 'sepia(1) saturate(4) hue-rotate(5deg) brightness(1.3)' : 'none' }}
            initial={{ y: -40, opacity: 0, rotate: 0 }}
            animate={{ y: 130, opacity: [0, 1, 1, 0], rotate: emoji === '🪙' ? [0, 360] : [0, -8, 8, -4] }}
            transition={{ duration: emoji === '🪙' ? 1.4 + (i % 3) * 0.2 : 2.4 + (i % 5) * 0.3, delay: (i * 0.22) % 3.2, repeat: Infinity, ease: emoji === '🪙' ? 'linear' : 'easeIn' }}
          >
            {emoji}
          </motion.div>
        ))}
      </div>

      {/* ── This month ─────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
          {format(new Date(), 'MMMM yyyy')}
        </h2>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Hours</p>
            <p className="text-lg font-bold text-mono mt-1">{thisMonthHours.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Expected</p>
            <p className="text-lg font-bold text-mono mt-1 break-all">${thisMonthExpected.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
          </div>
          <div className={`rounded-xl border p-3 ${thisMonthUnpaid > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-success/30 bg-success/5'}`}>
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">{thisMonthUnpaid > 0 ? 'Unpaid' : 'All paid'}</p>
            <p className={`text-lg font-bold text-mono mt-1 break-all ${thisMonthUnpaid > 0 ? 'text-amber-400' : 'text-success'}`}>
              {thisMonthUnpaid > 0 ? `$${thisMonthUnpaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}` : '✓'}
            </p>
          </div>
        </div>
      </div>

      {/* ── YTD ────────────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h2 className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
          {yearPrefix} year to date
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Hours</p>
            <p className="text-lg font-bold text-mono mt-1">{ytdHours.toFixed(1)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Earned</p>
            <p className="text-lg font-bold text-mono mt-1 break-all text-success">${ytdExpected.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
          </div>
          <div className="rounded-xl border border-success/30 bg-success/5 p-3">
            <p className="text-[10px] font-body uppercase text-muted-foreground leading-tight">Paid</p>
            <p className="text-lg font-bold text-mono text-success mt-1 break-all">${ytdPaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
          </div>
        </div>
      </div>

      {/* ── By employer ────────────────────────────────────────────────────── */}
     {byEmployer.length > 0 && (
        <div className="mb-6 rounded-xl border border-border bg-card overflow-hidden">
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
                  <p className="text-sm font-bold text-mono text-success shrink-0 ml-3">
                    ${earned.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active Jobs" value={activeJobs} icon={Briefcase} variant="info" />
        <StatCard label="Hours Logged" value={totalHours.toFixed(1)} icon={Clock} variant="accent" />
        {showIncome && <StatCard label="Total Income" value={`$${totalIncome.toLocaleString()}`} icon={TrendingUp} variant="success" />}
        {showExpenses && <StatCard label="Total Expenses" value={`$${totalExpenses.toLocaleString()}`} icon={TrendingDown} variant="warning" />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label={showExpenses ? 'Net Profit' : 'Job Earnings'} value={`$${(showExpenses ? netProfit : totalEarnings).toLocaleString()}`} icon={DollarSign} variant={showExpenses && netProfit < 0 ? 'destructive' : 'success'} />
        {showIncome && <StatCard label="Pending" value={`$${pendingIncome.toLocaleString()}`} icon={AlertCircle} variant="warning" />}
        {showIncome && <StatCard label="Overdue" value={`$${overdueIncome.toLocaleString()}`} icon={AlertCircle} variant="destructive" />}
      </div>

      {/* Tax breakdown */}
      {showTaxes && (
        <div className="rounded-2xl border border-border bg-card p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[10px] font-body text-muted-foreground uppercase tracking-widest">Tax Breakdown</h2>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground font-body">Tax Rate</span>
              <select value={taxRate} onChange={e => setTaxRate(Number(e.target.value))} className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground">
                {[15, 20, 25, 30, 35, 40].map(r => <option key={r} value={r}>{r}%</option>)}
              </select>
            </div>
          </div>
          {totalIncome === 0 && totalExpenses === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center font-body">Add income & expenses to see your tax breakdown</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-40 h-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={65} paddingAngle={3} dataKey="value" strokeWidth={0} activeShape={GlitterActiveShape}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} />)}
                    </Pie>
                    <Tooltip formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name]} contentStyle={{ background: '#ffffff', border: 'none', borderRadius: '12px', fontSize: '12px', fontFamily: 'Space Mono, monospace', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', padding: '10px 14px', color: '#111111' }} labelStyle={{ color: '#111111', fontWeight: 700, marginBottom: 2 }} itemStyle={{ color: '#333333' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 flex-1 min-w-0">
                {pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-xs text-muted-foreground font-body flex-1">{d.name}</span>
                    <span className="text-xs font-bold text-mono">${d.value.toLocaleString()}</span>
                  </div>
                ))}
                <div className="border-t border-border pt-1.5 mt-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 shrink-0" />
                    <span className="text-xs text-muted-foreground font-body flex-1">Total Income</span>
                    <span className="text-xs font-bold text-mono">${totalIncome.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

   {/* Recent jobs + expenses */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-[10px] font-body mb-3 text-muted-foreground uppercase tracking-widest">Next on the calendar</h2>
          {!nextJob ? (
            <div className="py-6 flex flex-col items-center gap-1">
              <p className="text-2xl">🌅</p>
              <p className="text-xs text-muted-foreground font-body text-center">No jobs on the horizon</p>
            </div>
          ) : (
            <div className="rounded-xl bg-secondary/50 px-3 py-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{nextJob.name}</p>
                  <p className="text-xs text-muted-foreground font-body truncate">{nextJob.client}{nextJob.venue ? ` · ${nextJob.venue}` : ''}</p>
                </div>
                <span className={`shrink-0 inline-block rounded-full px-2 py-0.5 text-[10px] text-mono font-medium ${nextJob.status === 'completed' ? 'bg-success/20 text-success' : nextJob.status === 'in-progress' ? 'bg-primary/20 text-primary' : 'bg-accent/20 text-accent'}`}>
                  {nextJob.status}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-mono text-muted-foreground">
                <span>{format(new Date(nextJob.date + 'T12:00:00'), 'EEE, MMM d')}</span>
                {nextJob.startTime && <span>· {nextJob.startTime}</span>}
                {nextJob.hourlyRate && <span>· ${nextJob.hourlyRate}/hr</span>}
              </div>
            </div>
          )}
        </div>

        {showExpenses && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="text-[10px] font-body mb-3 text-muted-foreground uppercase tracking-widest">Recent Expenses</h2>
            {recentExpenses.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center font-body">No expenses yet</p>
            ) : (
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
            )}
          </div>
        )}
      </div>

      {/* Full width export */}
      <button
        onClick={() => exportWeeklyToExcel(data.jobs, showExpenses ? data.expenses : [], showIncome ? data.income : [])}
        className="mt-6 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary/10 border border-primary/30 text-primary font-body text-sm tracking-wide hover:bg-primary/20 transition-colors"
      >
        <Download size={15} /> Export all data to CSV
      </button>
    </>
  );
}
