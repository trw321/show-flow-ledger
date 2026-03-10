import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Scale, ChevronDown, ChevronUp, AlertTriangle, CheckCircle } from 'lucide-react';
import { format, addDays, addWeeks, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import type { Job } from '@/lib/store';

function getPayPeriods(job: Job, rangeStart: Date, rangeEnd: Date) {
  if (!job.paySchedule || job.paySchedule === 'per-project') {
    return [{ start: rangeStart, end: rangeEnd, label: 'Full project' }];
  }

  const anchor = job.payPeriodStart ? parseISO(job.payPeriodStart) : rangeStart;
  const periods: { start: Date; end: Date; label: string }[] = [];

  let periodStart = new Date(anchor);
  // Rewind to before rangeStart
  while (periodStart > rangeStart) {
    if (job.paySchedule === 'weekly') periodStart = addDays(periodStart, -7);
    else if (job.paySchedule === 'bi-weekly') periodStart = addDays(periodStart, -14);
    else if (job.paySchedule === 'semi-monthly') periodStart = addDays(periodStart, -15);
    else periodStart = new Date(periodStart.getFullYear(), periodStart.getMonth() - 1, periodStart.getDate());
  }

  while (periodStart < rangeEnd) {
    let periodEnd: Date;
    if (job.paySchedule === 'weekly') periodEnd = addDays(periodStart, 6);
    else if (job.paySchedule === 'bi-weekly') periodEnd = addDays(periodStart, 13);
    else if (job.paySchedule === 'semi-monthly') periodEnd = addDays(periodStart, 14);
    else periodEnd = endOfMonth(periodStart);

    if (periodEnd >= rangeStart) {
      periods.push({
        start: periodStart < rangeStart ? rangeStart : periodStart,
        end: periodEnd > rangeEnd ? rangeEnd : periodEnd,
        label: `${format(periodStart, 'MMM d')} – ${format(periodEnd, 'MMM d, yyyy')}`,
      });
    }
    periodStart = addDays(periodEnd, 1);
  }

  return periods;
}

interface ReconciliationRow {
  jobId: string;
  jobName: string;
  client: string;
  paySchedule: string;
  periodLabel: string;
  totalHours: number;
  expectedPay: number;
  actualPaid: number;
  difference: number;
  timeEntryDetails: { date: string; hours: number; rate: number; description: string }[];
  incomeDetails: { date: string; amount: number; description: string; invoiceNumber?: string }[];
}

export default function PayReconciliationPage() {
  const { data } = useData();

  const [startDate, setStartDate] = useState(() => {
    const d = startOfMonth(new Date());
    return format(d, 'yyyy-MM-dd');
  });
  const [endDate, setEndDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [filterJobId, setFilterJobId] = useState<string>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const reconciliation = useMemo<ReconciliationRow[]>(() => {
    const rangeStart = parseISO(startDate);
    const rangeEnd = parseISO(endDate);
    const rows: ReconciliationRow[] = [];

    const jobsToCheck = filterJobId === 'all' ? data.jobs : data.jobs.filter(j => j.id === filterJobId);

    for (const job of jobsToCheck) {
      const periods = getPayPeriods(job, rangeStart, rangeEnd);

      for (const period of periods) {
        const periodEntries = data.timeEntries.filter(t => {
          if (t.jobId !== job.id && t.client !== job.client) return false;
          const d = parseISO(t.date);
          return isWithinInterval(d, { start: period.start, end: period.end });
        });

        const periodIncome = data.income.filter(i => {
          if (i.status !== 'paid') return false;
          if (i.jobId !== job.id && i.client !== job.client) return false;
          const d = parseISO(i.date);
          return isWithinInterval(d, { start: period.start, end: period.end });
        });

        const totalHours = periodEntries.reduce((s, t) => s + t.hours, 0);
        const expectedPay = periodEntries.reduce((s, t) => s + (t.hours * (t.rate || job.hourlyRate || 0)), 0);
        const actualPaid = periodIncome.reduce((s, i) => s + i.amount, 0);

        if (totalHours > 0 || actualPaid > 0) {
          rows.push({
            jobId: job.id,
            jobName: job.name,
            client: job.client,
            paySchedule: job.paySchedule || 'none',
            periodLabel: period.label,
            totalHours,
            expectedPay,
            actualPaid,
            difference: actualPaid - expectedPay,
            timeEntryDetails: periodEntries.map(t => ({
              date: t.date, hours: t.hours, rate: t.rate, description: t.description,
            })),
            incomeDetails: periodIncome.map(i => ({
              date: i.date, amount: i.amount, description: i.description, invoiceNumber: i.invoiceNumber,
            })),
          });
        }
      }
    }

    return rows;
  }, [data, startDate, endDate, filterJobId]);

  const totalExpected = reconciliation.reduce((s, r) => s + r.expectedPay, 0);
  const totalActual = reconciliation.reduce((s, r) => s + r.actualPaid, 0);
  const totalDiff = totalActual - totalExpected;

  return (
    <>
      <PageHeader title="Pay Reconciliation" description="Cross-check hours worked vs income received" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <div>
          <label className="text-xs text-muted-foreground text-mono uppercase mb-1 block">From</label>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground text-mono uppercase mb-1 block">To</label>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground text-mono uppercase mb-1 block">Production</label>
          <Select value={filterJobId} onValueChange={setFilterJobId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All productions</SelectItem>
              {data.jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground text-mono uppercase">Expected (Hours × Rate)</p>
          <p className="text-xl font-bold text-mono mt-1">${totalExpected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground text-mono uppercase">Actually Paid</p>
          <p className="text-xl font-bold text-mono text-success mt-1">${totalActual.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        <div className={`rounded-lg border p-4 ${totalDiff >= 0 ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
          <p className="text-xs text-muted-foreground text-mono uppercase">Difference</p>
          <p className={`text-xl font-bold text-mono mt-1 ${totalDiff >= 0 ? 'text-success' : 'text-destructive'}`}>
            {totalDiff >= 0 ? '+' : ''}${totalDiff.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Reconciliation table */}
      {reconciliation.length === 0 ? (
        <EmptyState icon={Scale} title="No data to reconcile" description="Add time entries and mark income as paid to see cross-checks here." />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3">Production</th>
                <th className="text-left px-4 py-3">Pay Period</th>
                <th className="text-left px-4 py-3">Schedule</th>
                <th className="text-right px-4 py-3">Hours</th>
                <th className="text-right px-4 py-3">Expected</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">Diff</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.map((row, i) => {
                const key = `${row.jobId}-${row.periodLabel}`;
                const isExpanded = expandedRow === key;
                const isMatch = Math.abs(row.difference) < 0.01;
                const isOver = row.difference > 0;

                return (
                  <>
                    <tr
                      key={key}
                      className="border-t border-border hover:bg-secondary/30 transition-colors cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : key)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{row.jobName}</p>
                        <p className="text-xs text-muted-foreground">{row.client}</p>
                      </td>
                      <td className="px-4 py-3 text-mono text-xs">{row.periodLabel}</td>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded px-2 py-0.5 text-xs text-mono font-medium bg-secondary text-secondary-foreground">
                          {row.paySchedule}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-mono">{row.totalHours.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right text-mono">${row.expectedPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right text-mono text-success">${row.actualPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 text-mono text-xs font-bold ${isMatch ? 'text-success' : isOver ? 'text-primary' : 'text-destructive'}`}>
                          {isMatch ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                          {isMatch ? 'Match' : `${row.difference >= 0 ? '+' : ''}$${row.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${key}-detail`} className="border-t border-border bg-muted/30">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="grid lg:grid-cols-2 gap-6">
                            {/* Time entries */}
                            <div>
                              <h4 className="text-xs text-mono uppercase text-muted-foreground mb-2 font-semibold">Time Entries</h4>
                              {row.timeEntryDetails.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No time entries</p>
                              ) : (
                                <div className="space-y-1">
                                  {row.timeEntryDetails.map((t, j) => (
                                    <div key={j} className="flex justify-between items-center rounded bg-background px-3 py-1.5 text-xs">
                                      <span>{format(parseISO(t.date), 'MMM d')} — {t.description || 'No description'}</span>
                                      <span className="text-mono font-medium">{t.hours}h × ${t.rate} = ${(t.hours * t.rate).toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {/* Income entries */}
                            <div>
                              <h4 className="text-xs text-mono uppercase text-muted-foreground mb-2 font-semibold">Payments Received</h4>
                              {row.incomeDetails.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No payments recorded</p>
                              ) : (
                                <div className="space-y-1">
                                  {row.incomeDetails.map((inc, j) => (
                                    <div key={j} className="flex justify-between items-center rounded bg-background px-3 py-1.5 text-xs">
                                      <span>{format(parseISO(inc.date), 'MMM d')} — {inc.description || 'Payment'} {inc.invoiceNumber && `(#${inc.invoiceNumber})`}</span>
                                      <span className="text-mono font-medium text-success">+${inc.amount.toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
