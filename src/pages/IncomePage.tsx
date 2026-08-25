import { useState, useMemo, useRef, useEffect } from 'react';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import IncomeStatementUpload from '@/components/IncomeStatementUpload';
import BankStatementImport, { type ReconciliationRowInfo } from '@/components/BankStatementImport';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DollarSign, Mic, MicOff, Trash2, Pencil, Clock, Scale, ChevronDown, ChevronUp, Upload, Check, X } from 'lucide-react';
import { format, differenceInDays, addDays, endOfMonth, parseISO } from 'date-fns';
import { calculateExpectedPay, effectiveHoursWorked } from '@/lib/payCalc';
import { resolveEmployer } from '@/lib/employerMatch';
import type { Income, Job } from '@/lib/store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useVoiceInput, parseIncomeSpeech } from '@/lib/useVoiceInput';

const statusColors: Record<Income['status'], string> = {
  paid:    'bg-success/15 text-success border-success/30',
  pending: 'bg-accent/15 text-accent border-accent/30',
  overdue: 'bg-destructive/15 text-destructive border-destructive/30',
};

const payMethodConfig: Record<string, { label: string; cls: string; note?: string }> = {
  direct_deposit: { label: 'direct deposit', cls: 'bg-info/15 text-info border-info/30' },
  check:          { label: 'check', cls: 'bg-warning/15 text-warning border-warning/30', note: 'may be delayed in mail' },
  cash:           { label: 'cash', cls: 'bg-success/15 text-success border-success/30' },
  other:          { label: 'other', cls: 'bg-secondary text-muted-foreground border-border' },
};

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

// ── Reconciliation helpers (ported from the retired Pay page) ──────────────

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
  jobs: Job[];
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

// ── Edit form (used in dialog for existing income records) ─────────────────

function IncomeEditForm({ initial, jobs, onSubmit, onCancel }: {
  initial: Partial<Income>;
  jobs: { id: string; name: string }[];
  onSubmit: (inc: Omit<Income, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [client, setClient] = useState(initial.client ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [amount, setAmount] = useState(initial.amount?.toString() ?? '');
  const [date, setDate] = useState(initial.date ?? new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<Income['status']>(initial.status ?? 'pending');
  const [paymentMethod, setPaymentMethod] = useState<Income['paymentMethod']>(initial.paymentMethod ?? 'direct_deposit');
  const [invoiceNumber, setInvoiceNumber] = useState(initial.invoiceNumber ?? '');
  const [jobId, setJobId] = useState(initial.jobId ?? '');

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (!client.trim() || !amount) return;
        onSubmit({ client: client.trim(), description: description.trim(), amount: parseFloat(amount), date, status, paymentMethod, invoiceNumber: invoiceNumber.trim() || undefined, jobId: jobId || undefined });
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <Input placeholder="employer / client" value={client} onChange={e => setClient(e.target.value)} required className="rounded-xl" />
        <Input placeholder="invoice #" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="rounded-xl" />
      </div>
      <Input placeholder="description" value={description} onChange={e => setDescription(e.target.value)} className="rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        <Input type="number" step="0.01" placeholder="amount" value={amount} onChange={e => setAmount(e.target.value)} required className="rounded-xl" />
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <select value={status} onChange={e => setStatus(e.target.value as Income['status'])} className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="pending">pending</option>
          <option value="paid">paid</option>
          <option value="overdue">overdue</option>
        </select>
        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as Income['paymentMethod'])} className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="direct_deposit">direct deposit</option>
          <option value="check">check</option>
          <option value="cash">cash</option>
          <option value="other">other</option>
        </select>
        <select value={jobId || 'none'} onChange={e => setJobId(e.target.value === 'none' ? '' : e.target.value)} className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="none">no linked job</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>cancel</Button>
        <Button type="submit" size="sm">{initial.id ? 'update' : 'add income'}</Button>
      </div>
    </form>
  );
}

// ── Inline madlib add block ────────────────────────────────────────────────

function IncomeMadlib({ jobs, onAdd }: {
  jobs: { id: string; name: string }[];
  onAdd: (inc: Omit<Income, 'id' | 'createdAt'>) => void;
}) {
  const [amount, setAmount] = useState('');
  const [client, setClient] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<Income['status']>('paid');
  const [paymentMethod, setPaymentMethod] = useState<Income['paymentMethod']>('direct_deposit');
  const [invoice, setInvoice] = useState('');

  const { listening, supported, start, stop } = useVoiceInput((text) => {
    const parsed = parseIncomeSpeech(text);
    if (parsed.amount) setAmount(parsed.amount.toString());
    if (parsed.client) setClient(parsed.client);
    toast.success(`heard: "${text}"`);
  });

  const handleAdd = () => {
    if (!client.trim() || !amount) return;
    onAdd({ client: client.trim(), description: '', amount: parseFloat(amount), date, status, paymentMethod, invoiceNumber: invoice.trim() || undefined });
    setAmount(''); setClient(''); setInvoice('');
    setDate(new Date().toISOString().split('T')[0]);
    setStatus('paid');
    setPaymentMethod('direct_deposit');
  };

  const inputCls = "h-8 rounded-lg border-0 border-b border-border bg-transparent px-1 text-sm text-mono focus:outline-none focus:border-primary transition-colors w-full";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 mb-4 space-y-3">
      <div className="flex items-center gap-2">
        {supported && (
          <button
            onClick={listening ? stop : start}
            className={cn(
              "rounded-full p-1.5 transition-colors shrink-0",
              listening ? "bg-destructive/15 text-destructive animate-pulse" : "bg-secondary text-muted-foreground hover:text-primary"
            )}
          >
            {listening ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
        )}
        <span className="text-[10px] text-mono text-muted-foreground/50 uppercase tracking-widest">
          {listening ? 'listening...' : 'quick add'}
        </span>
      </div>

      {/* Madlib sentence */}
      <div className="flex flex-wrap items-end gap-x-1.5 gap-y-2 text-sm">
        <span className="text-muted-foreground">i got paid</span>
        <div className="w-20">
          <span className="text-[9px] text-muted-foreground/40 block">amount</span>
          <div className="flex items-center">
            <span className="text-muted-foreground text-sm mr-0.5">$</span>
            <input
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              className={cn(inputCls, "w-16")}
            />
          </div>
        </div>
        <span className="text-muted-foreground">from</span>
        <div className="flex-1 min-w-[120px]">
          <span className="text-[9px] text-muted-foreground/40 block">employer</span>
          <input
            value={client}
            onChange={e => setClient(e.target.value)}
            placeholder="who paid you"
            className={inputCls}
          />
        </div>
        <span className="text-muted-foreground">on</span>
        <div className="w-32">
          <span className="text-[9px] text-muted-foreground/40 block">date</span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      {/* Secondary fields */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={status}
          onChange={e => setStatus(e.target.value as Income['status'])}
          className="h-7 rounded-lg border border-border bg-background px-2 text-xs text-mono"
        >
          <option value="paid">paid ✓</option>
          <option value="pending">pending</option>
          <option value="overdue">overdue</option>
        </select>
        <select
          value={paymentMethod}
          onChange={e => setPaymentMethod(e.target.value as Income['paymentMethod'])}
          className="h-7 rounded-lg border border-border bg-background px-2 text-xs text-mono"
        >
          <option value="direct_deposit">direct deposit</option>
          <option value="check">check 📮</option>
          <option value="cash">cash</option>
          <option value="other">other</option>
        </select>
        <input
          value={invoice}
          onChange={e => setInvoice(e.target.value)}
          placeholder="invoice # (optional)"
          className="h-7 flex-1 min-w-[100px] rounded-lg border border-border bg-background px-2 text-xs"
        />
        <Button size="sm" className="h-7 text-xs" disabled={!client.trim() || !amount} onClick={handleAdd}>
          add
        </Button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function IncomePage() {
  const { data, addIncome, updateIncome, deleteIncome, updateJob } = useData();
  const [editId, setEditId] = useState<string | null>(null);

  // Reconciliation state (ported from the retired Pay page)
  const [filterJobClient, setFilterJobClient] = useState<string>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [rainActive, setRainActive] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ client: '', payrollCompany: '', hourlyRate: '', paySchedule: '' });

  const editingInc = editId ? data.income.find(i => i.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name }));
  const total = data.income.reduce((s, i) => s + i.amount, 0);
  const sorted = [...data.income].sort((a, b) => b.date.localeCompare(a.date));

  const uniqueClients = useMemo(() => {
    const clients = new Set(data.jobs.map(j => j.client).filter(Boolean));
    return Array.from(clients).sort();
  }, [data.jobs]);

  // A job counts as paid once a linked income record is marked paid — the
  // per-job boxes below use this, distinct from row.isPaid which just means
  // "some income exists for this pay period" as a whole.
  const paidJobIds = useMemo(() => {
    const set = new Set<string>();
    for (const income of data.income) {
      if (income.status === 'paid' && income.jobId) set.add(income.jobId);
    }
    return set;
  }, [data.income]);

  const reconciliation = useMemo<ReconciliationRow[]>(() => {
    const rows: ReconciliationRow[] = [];
    const productions: Record<string, Job[]> = {};

    for (const job of data.jobs) {
      if (filterJobClient !== 'all' && job.client !== filterJobClient) continue;
      // A job on an actual recurring pay schedule (weekly/bi-weekly/etc) needs
      // every shift for that employer grouped together so the period math can
      // work. But most one-off gig work has no paySchedule set (or is
      // 'per-project'), and grouping those purely by client/payroll merged
      // EVERY unrelated dispatch for the same employer into one row — mark
      // one shift paid and it dragged every other shift for that client along
      // with it. Group those by job number (or job id if there isn't one) too,
      // so only line items that are actually the same dispatch stay together.
      const isScheduled = job.paySchedule && job.paySchedule !== 'per-project';
      const key = isScheduled
        ? `${job.client}||${job.payrollCompany || ''}`
        : `${job.client}||${job.payrollCompany || ''}||${job.jobNumber?.trim() || job.id}`;
      if (!productions[key]) productions[key] = [];
      productions[key].push(job);
    }

    for (const prodJobs of Object.values(productions)) {
      const referenceJob = prodJobs[0];
      const periods = getPayPeriods(referenceJob);

      for (const period of periods) {
        const periodJobs = prodJobs.filter(j => effectiveHoursWorked(j) > 0);
        const paymentWindow = addDays(period.end, 90);

        const periodIncome = data.income.filter(i => {
          const d = parseISO(i.date);
          if (d > paymentWindow) return false;
          // Income already linked to a specific job only ever counts toward
          // that job's own row — falling through to the name match here was
          // letting a payment tied to one shift also show as "paid" on every
          // other row for the same employer, since they legitimately share
          // the same client name. The name-match fallback is for genuinely
          // unlinked income (e.g. an imported bank statement not yet tied to
          // a specific job) only.
          if (i.jobId) return i.jobId === referenceJob.id;
          return namesMatch(i.client, referenceJob.client) || namesMatch(i.client, referenceJob.payrollCompany);
        });

        const paidIncome = periodIncome.filter(i => i.status === 'paid');
        const totalHours = periodJobs.reduce((s, j) => s + effectiveHoursWorked(j), 0);
        const employer = resolveEmployer(referenceJob.client, data.employers);
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
            jobs: periodJobs,
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
    <SpacePageWrapper>
      <MoneyRain active={rainActive} />
      <div className="max-w-lg mx-auto">
      <PageHeader title="$" description={`total: $${total.toLocaleString()}`} />

      {/* Statement import */}
      <div className="mb-4">
        <IncomeStatementUpload />
      </div>

      {/* Madlib quick add */}
      <IncomeMadlib
        jobs={jobs}
        onAdd={(inc) => { addIncome(inc); toast.success('income added'); }}
      />

      {/* ── Reconciliation (ported from the retired Pay page) ──────────────── */}
      <div className="mt-8 mb-3 flex items-center justify-between gap-2">
        <p className="text-[10px] font-body uppercase tracking-widest text-muted-foreground/60">Reconciliation</p>
        <div className="flex items-center gap-2">
          <Select value={filterJobClient} onValueChange={setFilterJobClient}>
            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {uniqueClients.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setShowImport(true)}>
            <Upload size={13} /> Import
          </Button>
        </div>
      </div>

      {/* Import dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-mono">Import Bank Statement</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Upload a screenshot or PDF of your bank statement, check, or pay stub. AI will extract the amount and suggest which job it belongs to.
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
      <div className="grid grid-cols-3 gap-2 mb-4">
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
        <div className="flex flex-col gap-3 mb-8">
          {reconciliation.map((row) => {
            const key = `${row.client}-${row.periodLabel}`;
            const isExpanded = expandedRow === key;
            const isMatch = Math.abs(row.difference) < 0.01;
            const isOver = row.difference > 0;
            const isToggling = togglingKey === key;
            const isEditing = editingKey === key;

            return (
              <div key={key} className="rounded-2xl border border-border bg-card p-3.5 hover:border-primary/20 transition-colors">

                <div className="flex items-start gap-3">
                  {/* Main info — tap to expand */}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedRow(isExpanded ? null : key)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{row.client}</p>
                      <span className={cn(
                        "text-[9px] font-bold text-mono uppercase rounded-full px-2 py-0.5 border",
                        row.isPaid ? "bg-success/15 text-success border-success/30" : "bg-secondary text-muted-foreground border-border"
                      )}>
                        {row.isPaid ? 'paid' : 'unpaid'}
                      </span>
                      {/* Money bag paid toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handlePaidToggle(row); }}
                        disabled={isToggling}
                        className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center text-sm transition-opacity",
                          isToggling ? "opacity-40" : "opacity-80 hover:opacity-100"
                        )}
                        title={row.isPaid ? 'Mark unpaid' : 'Mark paid'}
                      >
                        💰
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {row.periodLabel}
                      {row.payrollCompany ? ` · via ${row.payrollCompany}` : ''}
                    </p>
                    <p className="text-[10px] text-mono text-muted-foreground mt-1">
                      {row.totalHours.toFixed(1)}h worked
                      {row.isPaid && row.actualPaid > 0 && ` · $${row.actualPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })} received`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="text-right">
                      <p className="text-sm font-bold text-mono">${row.expectedPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      <p className={`text-[10px] text-mono font-bold ${isMatch ? 'text-success' : isOver ? 'text-primary' : 'text-destructive'}`}>
                        {isMatch ? '✓ match' : `${row.difference >= 0 ? '+' : ''}$${row.difference.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      </p>
                    </div>
                    <button
                      onClick={() => isEditing ? setEditingKey(null) : startEdit(row, key)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setExpandedRow(isExpanded ? null : key)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      title={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {/* Inline edit form */}
                {isEditing && (
                  <div className="-mx-3.5 mt-3 border-t border-border bg-muted/30 px-4 py-4">
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
                  <div className="-mx-3.5 mt-3 border-t border-border bg-muted/20 px-4 py-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-[10px] text-mono uppercase text-muted-foreground mb-2 font-semibold tracking-wider">Jobs in this period</h4>
                        {row.timeEntryDetails.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No hours logged</p>
                        ) : (
                          <div className="space-y-1.5">
                            {row.timeEntryDetails.map((t, j) => {
                              const jobForDate = row.jobs.find(job => job.date === t.date);
                              const paid = jobForDate ? paidJobIds.has(jobForDate.id) : false;
                              return (
                                <div
                                  key={j}
                                  className={cn(
                                    'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                                    paid ? 'border-success/40 bg-success/10' : 'border-border bg-background text-muted-foreground'
                                  )}
                                >
                                  <div className="flex justify-between items-center">
                                    <span className={paid ? 'text-foreground' : undefined}>{format(parseISO(t.date), 'MMM d')} — {t.hours}h</span>
                                    <span className={cn('text-mono font-medium', paid ? 'text-success' : 'text-foreground')}>${t.pay.toFixed(2)}</span>
                                  </div>
                                  {t.breakdown.length > 0 && (
                                    <div className="mt-1 space-y-0.5 pl-2 border-l border-border/60">
                                      {t.breakdown.map((line, k) => <p key={k}>{line}</p>)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
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
                                <div key={j} className={`rounded px-3 py-1.5 text-xs space-y-0.5 ${isLateCheck ? 'bg-warning/5 border border-warning/20' : 'bg-background'}`}>
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
                                        inc.paymentMethod === 'direct_deposit' ? 'bg-info/10 text-info border-info/20'
                                        : inc.paymentMethod === 'check' ? 'bg-warning/10 text-warning border-warning/20'
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

      {/* ── All income records ──────────────────────────────────────────────── */}
      <p className="mb-3 text-[10px] font-body uppercase tracking-widest text-muted-foreground/60">All Income</p>
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-border/40 bg-secondary/10 p-8 text-center">
          <DollarSign size={28} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">no income recorded yet</p>
          <p className="text-xs text-muted-foreground/50 mt-1">use the quick add above or load a statement</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(inc => {
            const daysOld = differenceInDays(new Date(), new Date(inc.date + 'T12:00:00'));
            const isWaiting = inc.status === 'pending' && daysOld > 14;
            return (
            <div
              key={inc.id}
              className={cn(
                "rounded-2xl border bg-card p-3.5 flex items-start gap-3 transition-colors",
                isWaiting
                  ? "border-warning/50 bg-warning/5 hover:border-warning/70"
                  : "border-border hover:border-primary/20"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm">{inc.client}</p>
                  <span className={cn("text-[9px] font-bold text-mono uppercase rounded-full px-2 py-0.5 border", statusColors[inc.status])}>
                    {inc.status}
                  </span>
                  {inc.paymentMethod && (
                    <span className={cn("text-[9px] font-bold text-mono rounded-full px-2 py-0.5 border", payMethodConfig[inc.paymentMethod]?.cls)}>
                      {payMethodConfig[inc.paymentMethod]?.label}
                    </span>
                  )}
                </div>
                {inc.description && <p className="text-xs text-muted-foreground mt-0.5">{inc.description}</p>}
                <p className="text-[10px] text-mono text-muted-foreground mt-1">
                  {format(new Date(inc.date + 'T12:00:00'), 'MMM d, yyyy')}
                  {inc.invoiceNumber && <span className="ml-1.5 text-muted-foreground/50">· {inc.invoiceNumber}</span>}
                </p>
                {inc.jobId && (() => {
                  const job = data.jobs.find(j => j.id === inc.jobId);
                  return job ? (
                    <p className="text-[10px] text-mono text-primary/70 mt-0.5">
                      → {job.name}{job.payrollCompany ? ` · ${job.payrollCompany}` : ''} · week of {format(new Date(job.date + 'T12:00:00'), 'MMM d')}
                    </p>
                  ) : null;
                })()}
                {isWaiting && (
                  <p className="text-[10px] text-warning font-medium mt-1 flex items-center gap-1">
                    <Clock size={10} /> {daysOld}d since logged — still waiting on payment
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="font-bold text-mono text-success text-sm">+${inc.amount.toLocaleString()}</span>
                <button onClick={() => setEditId(inc.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <Pencil size={13} />
                </button>
                <button onClick={() => deleteIncome(inc.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editId} onOpenChange={o => !o && setEditId(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="text-mono text-sm">edit income</DialogTitle></DialogHeader>
          {editingInc && (
            <IncomeEditForm
              jobs={jobs}
              initial={editingInc}
              onSubmit={updates => { updateIncome(editId!, updates); setEditId(null); toast.success('updated'); }}
              onCancel={() => setEditId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      </div>
    </SpacePageWrapper>
  );
}
