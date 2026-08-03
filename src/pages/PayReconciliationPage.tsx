import { useState, useMemo, useRef, useEffect } from 'react';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import EmptyState from '@/components/EmptyState';
import BankStatementImport, { type ReconciliationRowInfo } from '@/components/BankStatementImport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Scale, ChevronDown, ChevronUp, AlertTriangle, Upload, Pencil, Check, X } from 'lucide-react';
import { format, addDays, endOfMonth, parseISO, differenceInDays } from 'date-fns';
import { calculateExpectedPay } from '@/lib/payCalc';
import type { Job, Income } from '@/lib/store';

// ── Money rain ───────────────────────────────────────────────────────────────

interface MoneyDrop {
  id: number;
  emoji: string;
  left: number;
  delay: number;
  duration: number;
  size: number;
}

function MoneyRain({ active }: { active: boolean }) {
  const [drops, setDrops] = useState<MoneyDrop[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const emojis = ['💰', '💵', '💴'];
    const newDrops: MoneyDrop[] = Array.from({ length: 18 }, (_, i) => ({
      id: counterRef.current++,
      emoji: emojis[i % emojis.length],
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 0.8 + Math.random() * 0.6,
      size: 16 + Math.random() * 14,
    }));
    setDrops(newDrops);
    const t = setTimeout(() => setDrops([]), 2000);
    return () => clearTimeout(t);
  }, [active]);

  if (drops.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {drops.map(d => (
        <span
          key={d.id}
          style={{
            position: 'absolute',
            left: `${d.left}%`,
            top: '-40px',
            fontSize: `${d.size}px`,
            animation: `moneyFall ${d.duration}s ease-in ${d.delay}s forwards`,
          }}
        >
          {d.emoji}
        </span>
      ))}
      <style>{`
        @keyframes moneyFall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(${Math.random() > 0.5 ? '' : '-'}${Math.floor(Math.random() * 360)}deg); opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getPayPeriods(job: Job) {
  const jobDate = parseISO(job.date);
  if (!job.paySchedule || job.paySchedule === 'per-project') {
    return [{ start: jobDate, end: jobDate, label: 'Full project' }];
  }
  const anchor = job.payPeriodStart ? parseISO(job.payPeriodStart) : jobDate;
  const periodStart = new Date(anchor);
  let periodEnd: Date;
  if (job.paySchedule === 'weekly') periodEnd = addDays(periodStart, 6);
  else if (job.paySchedule === 'bi-weekly') periodEnd = addDays(periodStart, 13);
  else if (job.paySchedule === 'semi-monthly') periodEnd = addDays(periodStart, 14);
  else periodEnd = endOfMonth(periodStart);
  return [{ start: periodStart, end: periodEnd, label: `${format(periodStart, 'MMM d')} – ${format(periodEnd, 'MMM d, yyyy')}` }];
}

type LagStatus = 'early' | 'on-time' | 'late' | 'unusual';

function getLagStatus(lagDays: number, paySchedule: string, paymentMethod?: string): LagStatus {
  if (lagDays < 0) return 'early';
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
  isPaid: boolean;
  relatedIncomeIds: string[];
  hourlyRate?: number;
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

interface EditState {
  client: string;
  payrollCompany: string;
  hourlyRate: string;
  paySchedule: string;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function PayReconciliationPage() {
  const { data, addIncome, updateIncome, updateJob } = useData();

  const [filterJobClient, setFilterJobClient] = useState<string>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [rainActive, setRainActive] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ client: '', payrollCompany: '', hourlyRate: '', paySchedule: '' });

  const uniqueClients = useMemo(() => {
    const clients = new Set(data.jobs.map(j => j.client).filter(Boolean));
    return Array.from(clients).sort();
  }, [data.jobs]);

  const reconciliation = useMemo<ReconciliationRow[]>(() => {
    const rows: ReconciliationRow[] = [];
    const productions: Record<string, Job[]> = {};

    for (const job of data.jobs) {
      if (filterJobClient !== 'all' && job.client !== filterJobClient) continue;
      const key = `${job.client}||${job.payrollCompany || ''}`;
      if (!productions[key]) productions[key] = [];
      productions[key].push(job);
    }

    for (const prodJobs of Object.values(productions)) {
      const referenceJob = prodJobs[0];
      const periods = getPayPeriods(referenceJob);

      for (const period of periods) {
        const periodJobs = prodJobs.filter(j => (j.hoursWorked ?? 0) > 0);
        const paymentWindow = addDays(period.end, 90);

        const periodIncome = data.income.filter(i => {
          const d = parseISO(i.date);
          if (d > paymentWindow) return false;
          return i.jobId === referenceJob.id ||
                 namesMatch(i.client, referenceJob.client) ||
                 namesMatch(i.client, referenceJob.payrollCompany);
        });

        const paidIncome = periodIncome.filter(i => i.status === 'paid');
        const totalHours = periodJobs.reduce((s, j) => s + (j.hoursWorked ?? 0), 0);
        const employer = data.employers.find(e => e.name.toLowerCase() === referenceJob.client.toLowerCase());
        const payResult = calculateExpectedPay(periodJobs, referenceJob, data.jobs, employer);
        const expectedPay = payResult.total;
        const actualPaid = paidIncome.reduce((s, i) => s + i.amount, 0);
        const isPaid = paidIncome.length > 0;

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
            isPaid,
            relatedIncomeIds: periodIncome.map(i => i.id),
            hourlyRate: referenceJob.hourlyRate,
            timeEntryDetails: payResult.details,
            payrollCompany: referenceJob.payrollCompany,
            incomeDetails: paidIncome.map(i => {
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
  }, [data, filterJobClient]);

  const totalExpected = reconciliation.reduce((s, r) => s + r.expectedPay, 0);
  const totalActual = reconciliation.reduce((s, r) => s + r.actualPaid, 0);
  const totalDiff = totalActual - totalExpected;

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

  const handlePaidToggle = async (row: ReconciliationRow) => {
    const key = `${row.client}-${row.periodLabel}`;
    setTogglingKey(key);
    try {
      if (row.isPaid && row.relatedIncomeIds.length > 0) {
        for (const id of row.relatedIncomeIds) {
          await updateIncome(id, { status: 'pending' });
        }
      } else if (!row.isPaid) {
        await addIncome({
          jobId: row.jobId,
          client: row.client,
          description: `Payment — ${row.periodLabel}`,
          amount: row.expectedPay,
          date: format(new Date(), 'yyyy-MM-dd'),
          status: 'paid' as const,
        });
        setRainActive(true);
        setTimeout(() => setRainActive(false), 2100);
      }
    } finally {
      setTogglingKey(null);
    }
  };

  const startEdit = (row: ReconciliationRow, key: string) => {
    setEditingKey(key);
    setEditState({
      client: row.client,
      payrollCompany: row.payrollCompany ?? '',
      hourlyRate: row.hourlyRate?.toString() ?? '',
      paySchedule: row.paySchedule,
    });
    setExpandedRow(key);
  };

  const saveEdit = async (row: ReconciliationRow) => {
    await updateJob(row.jobId, {
      client: editState.client.trim() || row.client,
      payrollCompany: editState.payrollCompany.trim() || undefined,
      hourlyRate: editState.hourlyRate ? parseFloat(editState.hourlyRate) : undefined,
      paySchedule: editState.paySchedule as Job['paySchedule'],
    });
    setEditingKey(null);
  };

  return (
    <>
      <MoneyRain active={rainActive} />
      <SpacePageWrapper title="Pay" description="Hours worked vs income received">
      {/* Filters + import */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <label className="text-xs text-muted-foreground text-mono uppercase mb-1 block">Client</label>
          <Select value={filterJobClient} onValueChange={setFilterJobClient}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {uniqueClients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 self-end" onClick={() => setShowImport(true)}>
          <Upload size={15} /> Import
        </Button>
      </div>

      {/* Import dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-mono">Import Bank Statement</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Upload a screenshot of your bank statement, check, or pay stub. AI will extract the amount and suggest which job it belongs to.
            </p>
          </DialogHeader>
          <BankStatementImport
            rows={importRows}
            onConfirm={handleImportConfirm}
            onClose={() => setShowImport(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] text-muted-foreground text-mono uppercase leading-tight">Expected</p>
          <p className="text-sm font-bold text-mono mt-1 break-all">${totalExpected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="text-[10px] text-muted-foreground text-mono uppercase leading-tight">Paid</p>
          <p className="text-sm font-bold text-mono text-success mt-1 break-all">${totalActual.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
        <div className={`rounded-lg border p-3 ${totalDiff >= 0 ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
          <p className="text-[10px] text-muted-foreground text-mono uppercase leading-tight">Diff</p>
          <p className={`text-sm font-bold text-mono mt-1 break-all ${totalDiff >= 0 ? 'text-success' : 'text-destructive'}`}>
            {totalDiff >= 0 ? '+' : ''}${totalDiff.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {reconciliation.length === 0 ? (
        <EmptyState icon={Scale} title="No data to reconcile" description="Add jobs with hours worked to see pay tracking." />
      ) : (
        <div className="flex flex-col gap-3">
          {reconciliation.map((row) => {
            const key = `${row.client}-${row.periodLabel}`;
            const isExpanded = expandedRow === key;
            const isMatch = Math.abs(row.difference) < 0.01;
            const isOver = row.difference > 0;
            const isToggling = togglingKey === key;
            const isEditing = editingKey === key;

            return (
              <div key={key} className="rounded-xl border border-border bg-card overflow-hidden">

                {/* Snapshot row */}
                <div className="flex items-center gap-3 px-4 py-3">

                  {/* Money bag paid toggle */}
                  <button
                    onClick={() => handlePaidToggle(row)}
                    disabled={isToggling}
                    className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-lg transition-all duration-200 ${
                      isToggling ? 'opacity-50' : ''
                    } ${
                      row.isPaid
                        ? 'bg-success/20 ring-2 ring-success shadow-[0_0_0_4px_rgba(74,222,128,0.3),0_0_16px_6px_rgba(255,255,255,0.2)]'
                        : 'bg-secondary ring-1 ring-border opacity-40 hover:opacity-70 hover:ring-border/80'
                    }`}
                    title={row.isPaid ? 'Mark unpaid' : 'Mark paid'}
                  >
                    💰
                  </button>

                  {/* Main info */}
                  <button
                    className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
                    onClick={() => setExpandedRow(isExpanded ? null : key)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{row.client}</p>
                      <p className="text-[11px] text-muted-foreground text-mono truncate">
                        {row.periodLabel}
                        {row.payrollCompany ? ` · via ${row.payrollCompany}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-xs text-mono font-medium">${row.expectedPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        <p className={`text-[10px] text-mono font-bold ${isMatch ? 'text-success' : isOver ? 'text-primary' : 'text-destructive'}`}>
                          {isMatch ? '✓ match' : `${row.difference >= 0 ? '+' : ''}$${row.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                        </p>
                      </div>
                      {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                    </div>
                  </button>

                  {/* Edit pencil */}
                  <button
                    onClick={() => isEditing ? setEditingKey(null) : startEdit(row, key)}
                    className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    title="Edit"
                  >
                    <Pencil size={13} />
                  </button>
                </div>

                {/* Quick stats bar */}
                <div className="flex items-center gap-4 px-4 pb-3 border-t border-border/50 pt-2">
                  <span className="text-[10px] text-mono text-muted-foreground">{row.totalHours.toFixed(1)}h worked</span>
                  {row.isPaid && row.actualPaid > 0 && (
                    <span className="text-[10px] text-mono text-success">${row.actualPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })} received</span>
                  )}
                  <span className={`text-[10px] text-mono px-1.5 py-0.5 rounded ${
                    row.isPaid ? 'bg-success/10 text-success' : 'bg-secondary text-muted-foreground'
                  }`}>
                    {row.isPaid ? 'paid' : 'unpaid'}
                  </span>
                </div>

                {/* Inline edit form */}
                {isEditing && (
                  <div className="border-t border-border bg-muted/30 px-4 py-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-[10px] text-mono uppercase text-muted-foreground font-semibold tracking-wider">Edit details</h4>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingKey(null)} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
                          <X size={11} /> Cancel
                        </button>
                        <button onClick={() => saveEdit(row)} className="text-[11px] text-success hover:text-success/80 flex items-center gap-1 font-medium">
                          <Check size={11} /> Save
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-mono uppercase text-muted-foreground">Client</label>
                        <Input value={editState.client} onChange={e => setEditState(p => ({ ...p, client: e.target.value }))} className="h-8 text-xs font-mono" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-mono uppercase text-muted-foreground">Payroll co.</label>
                        <Input value={editState.payrollCompany} onChange={e => setEditState(p => ({ ...p, payrollCompany: e.target.value }))} className="h-8 text-xs font-mono" placeholder="optional" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-mono uppercase text-muted-foreground">Rate ($/hr)</label>
                        <Input type="number" step="0.01" value={editState.hourlyRate} onChange={e => setEditState(p => ({ ...p, hourlyRate: e.target.value }))} className="h-8 text-xs font-mono" placeholder="0.00" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-mono uppercase text-muted-foreground">Pay schedule</label>
                        <Select value={editState.paySchedule} onValueChange={v => setEditState(p => ({ ...p, paySchedule: v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                            <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                            <SelectItem value="per-project">Per project</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 px-4 py-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-[10px] text-mono uppercase text-muted-foreground mb-2 font-semibold tracking-wider">Hours breakdown</h4>
                        {row.timeEntryDetails.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No hours logged</p>
                        ) : (
                          <div className="space-y-1">
                            {row.timeEntryDetails.map((t, j) => (
                              <div key={j} className="rounded bg-background px-3 py-1.5 text-xs">
                                <div className="flex justify-between items-center">
                                  <span>{format(parseISO(t.date), 'MMM d')} — {t.hours}h</span>
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
                        <h4 className="text-[10px] text-mono uppercase text-muted-foreground mb-2 font-semibold tracking-wider">Payments received</h4>
                        {row.incomeDetails.length === 0 ? (
                          <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">No payments recorded</p>
                            <button onClick={() => setShowImport(true)} className="text-xs text-primary hover:underline">
                              + Import bank statement / pay stub
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
                              const isLateCheck = inc.paymentMethod === 'check' && (inc.lagStatus === 'late' || inc.lagStatus === 'unusual');
                              return (
                                <div key={j} className={`rounded px-3 py-1.5 text-xs space-y-0.5 ${isLateCheck ? 'bg-amber-500/5 border border-amber-500/20' : 'bg-background'}`}>
                                  <div className="flex justify-between items-center gap-2">
                                    <div className="min-w-0 truncate">
                                      <span>{format(parseISO(inc.date), 'MMM d')}</span>
                                      {inc.description && <span className="text-muted-foreground"> — {inc.description}</span>}
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
                                        {inc.paymentMethod === 'direct_deposit' ? 'direct deposit' : inc.paymentMethod === 'check' ? '📮 check' : inc.paymentMethod}
                                      </span>
                                    )}
                                    {payorDiffers && (
                                      <span className="text-[10px] text-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">paid by {inc.payorName}</span>
                                    )}
                                    <span className={`text-[10px] text-mono ${lagColor}`}>{lagLabel}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </SpacePageWrapper>
    </>
  );
}
