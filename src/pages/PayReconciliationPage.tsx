import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import BankStatementImport, { type ReconciliationRowInfo } from '@/components/BankStatementImport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Scale, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Upload } from 'lucide-react';
import { format, addDays, endOfMonth, isWithinInterval, parseISO, startOfMonth, differenceInDays } from 'date-fns';
import { calculateExpectedPay } from '@/lib/payCalc';
import type { Job, Income } from '@/lib/store';

function getPayPeriods(job: Job, rangeStart: Date, rangeEnd: Date) {
  if (!job.paySchedule || job.paySchedule === 'per-project') {
    return [{ start: rangeStart, end: rangeEnd, label: 'Full project' }];
  }

  const anchor = job.payPeriodStart ? parseISO(job.payPeriodStart) : rangeStart;
  const periods: { start: Date; end: Date; label: string }[] = [];

  let periodStart = new Date(anchor);
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

type LagStatus = 'early' | 'on-time' | 'late' | 'unusual';

function getLagStatus(lagDays: number, paySchedule: string, paymentMethod?: string): LagStatus {
  if (lagDays < 0) return 'early';
  // Checks can sit in the mail or at a wrong address — add 14-day buffer
  const checkBuffer = paymentMethod === 'check' ? 14 : 0;
  const maxNormal = (paySchedule === 'weekly' ? 10
    : paySchedule === 'bi-weekly' ? 18
    : paySchedule === 'semi-monthly' ? 18
    : paySchedule === 'monthly' ? 35
    : 30) + checkBuffer;
  if (lagDays <= maxNormal) return 'on-time';
  if (lagDays <= maxNormal * 2) return 'late';
  return 'unusual';
}

// Case-insensitive name matching: exact, one contains the other (min 3 chars)
function namesMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return true;
  if (na.length >= 3 && nb.includes(na)) return true;
  if (nb.length >= 3 && na.includes(nb)) return true;
  return false;
}

interface ReconciliationRow {
  jobId: string;
  jobName: string;
  client: string;
  payrollCompany?: string;
  paySchedule: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  totalHours: number;
  expectedPay: number;
  actualPaid: number;
  difference: number;
  timeEntryDetails: { date: string; hours: number; pay: number; breakdown: string[] }[];
  incomeDetails: {
    date: string;
    amount: number;
    description: string;
    invoiceNumber?: string;
    payorName: string;
    paymentMethod?: string;
    lagDays: number;
    lagStatus: LagStatus;
  }[];
}

export default function PayReconciliationPage() {
  const { data, addIncome } = useData();

  const [startDate, setStartDate] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [filterJobClient, setFilterJobClient] = useState<string>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const uniqueClients = useMemo(() => {
    const clients = new Set(data.jobs.map(j => j.client).filter(Boolean));
    return Array.from(clients).sort();
  }, [data.jobs]);

  const reconciliation = useMemo<ReconciliationRow[]>(() => {
    const rangeStart = parseISO(startDate);
    const rangeEnd = parseISO(endDate);
    const rows: ReconciliationRow[] = [];

    const productions = new Map<string, Job[]>();
    for (const job of data.jobs) {
      if (filterJobClient !== 'all' && job.client !== filterJobClient) continue;
      const key = `${job.client}||${job.payrollCompany || ''}`;
      if (!productions.has(key)) productions.set(key, []);
      productions.get(key)!.push(job);
    }

    for (const [, prodJobs] of productions) {
      const referenceJob = prodJobs[0];
      const periods = getPayPeriods(referenceJob, rangeStart, rangeEnd);

      for (const period of periods) {
        const periodJobs = prodJobs.filter(j => {
          const d = parseISO(j.date);
          return isWithinInterval(d, { start: period.start, end: period.end }) && (j.hoursWorked ?? 0) > 0;
        });

        // Include payments up to 90 days after period end
        const paymentWindow = addDays(period.end, 90);
        const periodIncome = data.income.filter(i => {
          if (i.status !== 'paid') return false;
          const d = parseISO(i.date);
          if (d < period.start || d > paymentWindow) return false;
          // Match by production client OR payroll company — they are often different entities
          return namesMatch(i.client, referenceJob.client) ||
                 namesMatch(i.client, referenceJob.payrollCompany);
        });

        const totalHours = periodJobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
        const payResult = calculateExpectedPay(periodJobs, referenceJob, data.jobs);
        const expectedPay = payResult.total;
        const actualPaid = periodIncome.reduce((s, i) => s + i.amount, 0);

        if (totalHours > 0 || actualPaid > 0) {
          rows.push({
            jobId: referenceJob.id,
            jobName: referenceJob.name,
            client: referenceJob.client,
            paySchedule: referenceJob.paySchedule || 'none',
            periodLabel: period.label,
            periodStart: format(period.start, 'yyyy-MM-dd'),
            periodEnd: format(period.end, 'yyyy-MM-dd'),
            totalHours,
            expectedPay,
            actualPaid,
            difference: actualPaid - expectedPay,
            timeEntryDetails: payResult.details,
            payrollCompany: referenceJob.payrollCompany,
            incomeDetails: periodIncome.map(i => {
              const lagDays = differenceInDays(parseISO(i.date), period.end);
              return {
                date: i.date,
                amount: i.amount,
                description: i.description,
                invoiceNumber: i.invoiceNumber,
                payorName: i.client,
                paymentMethod: i.paymentMethod,
                lagDays,
                lagStatus: getLagStatus(lagDays, referenceJob.paySchedule || '', i.paymentMethod),
              };
            }),
          });
        }
      }
    }

    return rows;
  }, [data, startDate, endDate, filterJobClient]);

  const totalExpected = reconciliation.reduce((s, r) => s + r.expectedPay, 0);
  const totalActual = reconciliation.reduce((s, r) => s + r.actualPaid, 0);
  const totalDiff = totalActual - totalExpected;

  // Build rows info for BankStatementImport
  const importRows: ReconciliationRowInfo[] = useMemo(() =>
    reconciliation.map(r => ({
      key: `${r.client}-${r.periodLabel}`,
      jobId: r.jobId,
      client: r.client,
      periodLabel: r.periodLabel,
      periodEnd: r.periodEnd,
      expectedPay: r.expectedPay,
    })),
    [reconciliation]
  );

  const handleImportConfirm = (income: Omit<Income, 'id' | 'createdAt'>) => {
    addIncome(income);
  };

  return (
    <>
      <PageHeader title="Pay Reconciliation" description="Cross-check hours worked vs income received" />

      <div className="flex flex-wrap gap-3 mb-6 items-end justify-between">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground text-mono uppercase mb-1 block">From</label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground text-mono uppercase mb-1 block">To</label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground text-mono uppercase mb-1 block">Client</label>
            <Select value={filterJobClient} onValueChange={setFilterJobClient}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {uniqueClients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setShowImport(true)}
        >
          <Upload size={15} /> Import Bank Statement
        </Button>
      </div>

      {/* Bank statement import dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-mono">Import Bank Statement</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Upload a screenshot of your bank statement. AI will extract deposits
              and suggest which pay period each one belongs to.
            </p>
          </DialogHeader>
          <BankStatementImport
            rows={importRows}
            onConfirm={handleImportConfirm}
            onClose={() => setShowImport(false)}
          />
        </DialogContent>
      </Dialog>

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

      {reconciliation.length === 0 ? (
        <EmptyState icon={Scale} title="No data to reconcile" description="Add jobs with hours worked and mark income as paid to see cross-checks." />
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3.5">Client</th>
                <th className="text-left px-4 py-3.5">Pay Period</th>
                <th className="text-left px-4 py-3.5">Schedule</th>
                <th className="text-right px-4 py-3">Hours</th>
                <th className="text-right px-4 py-3">Expected</th>
                <th className="text-right px-4 py-3">Paid</th>
                <th className="text-right px-4 py-3">Diff</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.map((row) => {
                const key = `${row.client}-${row.periodLabel}`;
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
                        <p className="font-medium">{row.client}</p>
                        {row.payrollCompany && (
                          <p className="text-[10px] text-muted-foreground text-mono mt-0.5">via {row.payrollCompany}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-mono text-xs">{row.periodLabel}</td>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded px-2 py-0.5 text-xs text-mono font-medium bg-secondary text-secondary-foreground">
                          {row.paySchedule}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-mono">{row.totalHours.toFixed(1)}</td>
                      <td className="px-4 py-3.5 text-right text-mono">${row.expectedPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
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
                            <div>
                              <h4 className="text-xs text-mono uppercase text-muted-foreground mb-2 font-semibold">Jobs / Hours</h4>
                              {row.timeEntryDetails.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No hours logged</p>
                              ) : (
                                <div className="space-y-1">
                                  {row.timeEntryDetails.map((t, j) => (
                                    <div key={j} className="rounded bg-background px-3 py-1.5 text-xs">
                                      <div className="flex justify-between items-center">
                                        <span>{format(parseISO(t.date), 'MMM d')} — {t.hours}h worked</span>
                                        <span className="text-mono font-medium">${t.pay.toFixed(2)}</span>
                                      </div>
                                      {t.breakdown.length > 0 && (
                                        <div className="mt-1 text-muted-foreground space-y-0.5 pl-2 border-l border-border">
                                          {t.breakdown.map((line, k) => <p key={k}>{line}</p>)}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 className="text-xs text-mono uppercase text-muted-foreground mb-2 font-semibold">Payments Received</h4>
                              {row.incomeDetails.length === 0 ? (
                                <div className="space-y-1">
                                  <p className="text-xs text-muted-foreground">No payments recorded</p>
                                  <button
                                    onClick={e => { e.stopPropagation(); setShowImport(true); }}
                                    className="text-xs text-primary hover:underline"
                                  >
                                    + Import from bank statement
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  {row.incomeDetails.map((inc, j) => {
                                    const lagLabel = inc.lagStatus === 'early' ? 'early'
                                      : inc.lagStatus === 'on-time' ? `${inc.lagDays}d after period`
                                      : inc.lagStatus === 'late' ? `${inc.lagDays}d — late`
                                      : `${inc.lagDays}d — unusual`;
                                    const lagColor = inc.lagStatus === 'on-time' || inc.lagStatus === 'early'
                                      ? 'text-success' : inc.lagStatus === 'late' ? 'text-accent' : 'text-destructive';
                                    const payorDiffers = !namesMatch(inc.payorName, row.client);
                                    const isCheck = inc.paymentMethod === 'check';
                                    const isLateCheck = isCheck && (inc.lagStatus === 'late' || inc.lagStatus === 'unusual');
                                    return (
                                      <div key={j} className={`rounded px-3 py-1.5 text-xs space-y-0.5 ${isLateCheck ? 'bg-amber-500/5 border border-amber-500/20' : 'bg-background'}`}>
                                        <div className="flex justify-between items-center gap-2">
                                          <div className="min-w-0">
                                            <span>{format(parseISO(inc.date), 'MMM d')}</span>
                                            {inc.description && <span className="text-muted-foreground"> — {inc.description}</span>}
                                            {inc.invoiceNumber && <span className="text-muted-foreground"> (#{inc.invoiceNumber})</span>}
                                          </div>
                                          <span className="text-mono font-medium text-success shrink-0">+${inc.amount.toFixed(2)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          {inc.paymentMethod && (
                                            <span className={`text-[10px] text-mono px-1.5 py-0.5 rounded border ${
                                              inc.paymentMethod === 'direct_deposit' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                              : inc.paymentMethod === 'check' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                              : inc.paymentMethod === 'cash' ? 'bg-success/10 text-success border-success/20'
                                              : 'bg-secondary text-muted-foreground border-border'
                                            }`}>
                                              {inc.paymentMethod === 'direct_deposit' ? 'direct deposit'
                                                : inc.paymentMethod === 'check' ? '📮 check'
                                                : inc.paymentMethod}
                                            </span>
                                          )}
                                          {payorDiffers && (
                                            <span className="text-[10px] text-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">
                                              paid by {inc.payorName}
                                            </span>
                                          )}
                                          <span className={`text-[10px] text-mono ${lagColor}`}>{lagLabel}</span>
                                          {isLateCheck && (
                                            <span className="text-[10px] text-amber-400">check may have been delayed or sent to wrong address</span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
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
