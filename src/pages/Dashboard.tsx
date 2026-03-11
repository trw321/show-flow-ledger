import { useData } from '@/lib/DataContext';
import StatCard from '@/components/StatCard';
import PageHeader from '@/components/PageHeader';
import { Briefcase, Receipt, DollarSign, Speaker, TrendingUp, TrendingDown, AlertCircle, Clock } from 'lucide-react';
import { format } from 'date-fns';

export default function Dashboard() {
  const { data } = useData();

  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0);
  const totalIncome = data.income.reduce((s, i) => s + i.amount, 0);
  const pendingIncome = data.income.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0);
  const overdueIncome = data.income.filter(i => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
  const activeJobs = data.jobs.filter(j => j.status === 'upcoming' || j.status === 'in-progress').length;
  const deployedGear = data.equipment.filter(e => e.status === 'deployed').length;
  const totalHours = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
  const totalEarnings = data.jobs.reduce((s, j) => s + (j.hoursWorked ?? 0) * (j.hourlyRate ?? 0), 0);

  const recentJobs = [...data.jobs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  const recentExpenses = [...data.expenses].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  return (
    <>
      <PageHeader title="Dashboard" description="AV industry bookkeeping overview" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Jobs" value={activeJobs} icon={Briefcase} variant="primary" />
        <StatCard label="Hours Logged" value={totalHours.toFixed(1)} icon={Clock} variant="accent" />
        <StatCard label="Total Income" value={`$${totalIncome.toLocaleString()}`} icon={TrendingUp} variant="success" />
        <StatCard label="Total Expenses" value={`$${totalExpenses.toLocaleString()}`} icon={TrendingDown} variant="destructive" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Net Profit" value={`$${(totalIncome - totalExpenses).toLocaleString()}`} icon={DollarSign} variant={totalIncome - totalExpenses >= 0 ? 'success' : 'destructive'} />
        <StatCard label="Job Earnings" value={`$${totalEarnings.toLocaleString()}`} icon={DollarSign} variant="success" />
        <StatCard label="Pending Invoices" value={`$${pendingIncome.toLocaleString()}`} icon={AlertCircle} variant="accent" />
        <StatCard label="Overdue" value={`$${overdueIncome.toLocaleString()}`} icon={AlertCircle} variant="destructive" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-mono mb-3 text-muted-foreground uppercase tracking-wider">Recent Jobs</h2>
          {recentJobs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No jobs yet</p>
          ) : (
            <div className="space-y-2">
              {recentJobs.map(job => (
                <div key={job.id} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{job.name}</p>
                    <p className="text-xs text-muted-foreground">{job.client} • {job.venue}</p>
                  </div>
                  <div className="text-right">
                    {(job.hoursWorked ?? 0) > 0 && (
                      <p className="text-xs text-mono font-medium">{job.hoursWorked}h • ${((job.hoursWorked ?? 0) * (job.hourlyRate ?? 0)).toLocaleString()}</p>
                    )}
                    <span className={`inline-block rounded px-2 py-0.5 text-xs text-mono font-medium ${
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

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-mono mb-3 text-muted-foreground uppercase tracking-wider">Recent Expenses</h2>
          {recentExpenses.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No expenses yet</p>
          ) : (
            <div className="space-y-2">
              {recentExpenses.map(exp => (
                <div key={exp.id} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
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
        </div>
      </div>
    </>
  );
}
