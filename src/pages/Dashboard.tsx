import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import StatCard from '@/components/StatCard';
import PageHeader from '@/components/PageHeader';
import { Briefcase, Receipt, DollarSign, TrendingUp, TrendingDown, AlertCircle, Clock, Download, Upload, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from 'recharts';
import { exportWeeklyToExcel } from '@/lib/exportWeekly';
import { hasLegacyData, getLegacyData, clearLegacyData } from '@/lib/store';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { toast } from 'sonner';

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
      animate={{
        y: [0, -15, 0],
        scale: [1, 1.15, 1],
        opacity: [0.3, 0.6, 0.3],
      }}
      transition={{ duration: 4, delay, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GlitterActiveShape(props: any) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <g style={{ filter: `drop-shadow(0 0 12px ${fill}) drop-shadow(0 0 4px #fff4)` }}>
      {/* soft outer pulse ring */}
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 3} outerRadius={outerRadius + 10}
        startAngle={startAngle} endAngle={endAngle} fill={fill} opacity={0.25} />
      {/* main segment, popped out */}
      <Sector cx={cx} cy={cy} innerRadius={innerRadius - 2} outerRadius={outerRadius + 5}
        startAngle={startAngle} endAngle={endAngle} fill={fill} />
      {/* glitter shimmer — bright half-lens highlight */}
      <Sector cx={cx} cy={cy}
        innerRadius={innerRadius - 2}
        outerRadius={innerRadius + (outerRadius - innerRadius) * 0.52}
        startAngle={startAngle} endAngle={endAngle}
        fill="rgba(255,255,255,0.22)" />
    </g>
  );
}

export default function Dashboard() {
  const { data, migrateLocalData } = useData();
  const { prefs } = useUserPrefs();
  const [taxRate, setTaxRate] = useState(25);
  const [showMigrate, setShowMigrate] = useState(hasLegacyData);
  const showIncome = prefs.tabs.income;
  const showExpenses = prefs.tabs.expenses;
  const showTaxes = prefs.tabs.taxes;
  const [migrating, setMigrating] = useState(false);

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
      {/* Migration banner */}
      {showMigrate && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-4 flex items-center gap-3 flex-wrap">
          <Upload size={18} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Local data found</p>
            <p className="text-xs text-muted-foreground">Import your existing jobs, expenses, and income into your account.</p>
          </div>
          <button
            onClick={handleMigrate}
            disabled={migrating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {migrating ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {migrating ? 'Migrating...' : 'Import Data'}
          </button>
          <button onClick={() => setShowMigrate(false)} className="text-xs text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}

      {/* Hero area with funky animated background */}
      <div className="relative overflow-hidden rounded-2xl border border-border mb-6 p-5 bg-card">
        {/* Animated gradient background */}
        <div className="absolute inset-0 opacity-20">
          <motion.div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(circle at 20% 50%, hsl(210 100% 55% / 0.4), transparent 50%), radial-gradient(circle at 80% 50%, hsl(265 90% 60% / 0.4), transparent 50%), radial-gradient(circle at 50% 80%, hsl(50 100% 55% / 0.3), transparent 40%)',
            }}
            animate={{
              background: [
                'radial-gradient(circle at 20% 50%, hsl(210 100% 55% / 0.4), transparent 50%), radial-gradient(circle at 80% 50%, hsl(265 90% 60% / 0.4), transparent 50%), radial-gradient(circle at 50% 80%, hsl(50 100% 55% / 0.3), transparent 40%)',
                'radial-gradient(circle at 50% 20%, hsl(210 100% 55% / 0.4), transparent 50%), radial-gradient(circle at 50% 80%, hsl(265 90% 60% / 0.4), transparent 50%), radial-gradient(circle at 80% 50%, hsl(50 100% 55% / 0.3), transparent 40%)',
                'radial-gradient(circle at 80% 50%, hsl(210 100% 55% / 0.4), transparent 50%), radial-gradient(circle at 20% 50%, hsl(265 90% 60% / 0.4), transparent 50%), radial-gradient(circle at 50% 20%, hsl(50 100% 55% / 0.3), transparent 40%)',
              ],
            }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          />
        </div>

        {/* Starbursts */}
        <Starburst className="absolute top-2 right-4 w-8 h-8" delay={0} />
        <Starburst className="absolute bottom-3 left-6 w-6 h-6" delay={1.2} />
        <Starburst className="absolute top-1/2 right-1/4 w-5 h-5" delay={2.5} />

        {/* Floating orbs */}
        <FloatingOrb className="absolute top-4 left-1/3 w-16 h-16 rounded-full bg-primary/10 blur-xl" delay={0.5} />
        <FloatingOrb className="absolute bottom-2 right-1/3 w-20 h-20 rounded-full bg-accent/10 blur-xl" delay={1.5} />

        {/* Content */}
        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground font-medium mb-1">Welcome back</p>
            <h1 className="text-2xl md:text-3xl font-bold text-mono tracking-widest funky-gradient-text">
              AV LEDGER
            </h1>
          </motion.div>

          <motion.div
            className="mt-4 flex items-baseline gap-3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <span className="text-3xl md:text-4xl font-bold text-mono text-foreground">
              ${displayTotal.toLocaleString()}
            </span>
            <span className={`text-xs font-medium text-mono uppercase tracking-wider ${displayTotal >= 0 ? 'text-success' : 'text-destructive'}`}>
              {showExpenses ? 'net' : 'income'} {displayTotal >= 0 ? '↑' : '↓'}
            </span>
          </motion.div>

          <motion.div
            className="mt-2 flex gap-4 text-xs text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <span>{activeJobs} active job{activeJobs !== 1 ? 's' : ''}</span>
            <span>•</span>
            <span>{totalHours.toFixed(1)}h logged</span>
          </motion.div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Active Jobs" value={activeJobs} icon={Briefcase} variant="info" />
        <StatCard label="Hours Logged" value={totalHours.toFixed(1)} icon={Clock} variant="accent" />
        {showIncome && <StatCard label="Total Income" value={`$${totalIncome.toLocaleString()}`} icon={TrendingUp} variant="success" />}
        {showExpenses && <StatCard label="Total Expenses" value={`$${totalExpenses.toLocaleString()}`} icon={TrendingDown} variant="warning" />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label={showExpenses ? 'Net Profit' : 'Job Earnings'}
          value={`$${(showExpenses ? netProfit : totalEarnings).toLocaleString()}`}
          icon={DollarSign}
          variant={showExpenses && netProfit < 0 ? 'destructive' : 'success'}
        />
        {showIncome && <StatCard label="Pending" value={`$${pendingIncome.toLocaleString()}`} icon={AlertCircle} variant="warning" />}
        {showIncome && <StatCard label="Overdue" value={`$${overdueIncome.toLocaleString()}`} icon={AlertCircle} variant="destructive" />}
      </div>

      {/* Weekly Export */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => exportWeeklyToExcel(data.jobs, showExpenses ? data.expenses : [], showIncome ? data.income : [])}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
        >
          <Download size={14} />
          Export to CSV
        </button>
      </div>

      {/* Tax Breakdown Pie Chart */}
      {showTaxes && <div className="rounded-2xl border border-border bg-card p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] font-semibold text-mono text-muted-foreground uppercase tracking-[0.2em]">Tax Breakdown</h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Tax Rate</span>
            <select
              value={taxRate}
              onChange={e => setTaxRate(Number(e.target.value))}
              className="text-xs bg-secondary border border-border rounded-md px-2 py-1 text-foreground"
            >
              {[15, 20, 25, 30, 35, 40].map(r => (
                <option key={r} value={r}>{r}%</option>
              ))}
            </select>
          </div>
        </div>

        {totalIncome === 0 && totalExpenses === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">Add income & expenses to see your tax breakdown</p>
        ) : (
          <div className="flex items-center gap-4">
            <div className="w-40 h-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                    activeShape={GlitterActiveShape}
                  >
                    {pieData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.color}
                        stroke="rgba(255,255,255,0.15)"
                        strokeWidth={1.5}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name]}
                    contentStyle={{
                      background: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontFamily: 'Space Mono, monospace',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      padding: '10px 14px',
                      color: '#111111',
                    }}
                    labelStyle={{ color: '#111111', fontWeight: 700, marginBottom: 2 }}
                    itemStyle={{ color: '#333333' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 flex-1 min-w-0">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-xs text-muted-foreground flex-1">{d.name}</span>
                  <span className="text-xs font-bold text-mono">${d.value.toLocaleString()}</span>
                </div>
              ))}
              <div className="border-t border-border pt-1.5 mt-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 shrink-0" />
                  <span className="text-xs text-muted-foreground flex-1">Total Income</span>
                  <span className="text-xs font-bold text-mono">${totalIncome.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-[10px] font-semibold text-mono mb-3 text-muted-foreground uppercase tracking-[0.2em]">Recent Jobs</h2>
          {recentJobs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No jobs yet</p>
          ) : (
            <div className="space-y-2">
              {recentJobs.map(job => (
                <div key={job.id} className="flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{job.name}</p>
                    <p className="text-xs text-muted-foreground">{job.client} • {job.venue}</p>
                  </div>
                  <div className="text-right">
                    {(job.hoursWorked ?? 0) > 0 && (
                      <p className="text-xs text-mono font-medium">{job.hoursWorked}h • ${((job.hoursWorked ?? 0) * (job.hourlyRate ?? 0)).toLocaleString()}</p>
                    )}
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] text-mono font-medium ${
                      job.status === 'completed' ? 'bg-success/20 text-success' :
                      job.status === 'in-progress' ? 'bg-primary/20 text-primary' :
                      job.status === 'cancelled' ? 'bg-destructive/20 text-destructive' :
                      'bg-accent/20 text-accent'
                    }`}>
                      {job.status}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(job.date), 'MMM d')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showExpenses && <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-[10px] font-semibold text-mono mb-3 text-muted-foreground uppercase tracking-[0.2em]">Recent Expenses</h2>
          {recentExpenses.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No expenses yet</p>
          ) : (
            <div className="space-y-2">
              {recentExpenses.map(exp => (
                <div key={exp.id} className="flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{exp.description}</p>
                    <p className="text-xs text-muted-foreground">{exp.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-mono text-destructive">-${exp.amount.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(exp.date), 'MMM d')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>}
      </div>
    </>
  );
}
