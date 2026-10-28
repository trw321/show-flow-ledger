import { useState, useMemo } from 'react';
import { learnFromStubs, dismissSuggestion, consumeSkip, type Suggestion } from '@/lib/stubLearning';
import { PaySummaryTable, ExportButton, type PeriodStat } from '@/components/MoneyWidgets';
import { exportWeeklyToExcel } from '@/lib/exportWeekly';
import { jobPayBreakdown } from '@/lib/payCalc';
import { Plus } from 'lucide-react';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import IncomeStatementUpload from '@/components/IncomeStatementUpload';
import BankStatementImport, { type ReconciliationRowInfo } from '@/components/BankStatementImport';
import EmployerCombobox from '@/components/EmployerCombobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DollarSign, Mic, MicOff, Trash2, Pencil, Clock, Upload } from 'lucide-react';
import { format, differenceInDays, addDays, endOfMonth, parseISO, startOfWeek, isWithinInterval, endOfWeek, startOfMonth } from 'date-fns';
import { calculateExpectedPay, effectiveHoursWorked, netHoursWorked } from '@/lib/payCalc';
import { resolveEmployer } from '@/lib/employerMatch';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { estimateYearFromEarnings } from '@/lib/taxEstimate';
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

/** What the shifts in a row were: the project names, so two projects for the same employer read apart. */
function projectLabel(row: { jobName: string; jobs: Job[] }): string {
  const names = [...new Set(row.jobs.map(j => j.name?.trim()).filter(Boolean))];
  if (names.length === 0) return row.jobName;
  const number = names.length === 1 ? row.jobs.find(j => j.jobNumber?.trim())?.jobNumber?.trim() : undefined;
  return names.join(' · ') + (number ? ` #${number}` : '');
}

interface RowCandidate {
  referenceJob: Job;
  periodJobs: Job[];
  expected: number;
  workStart: string;
  workEnd: string;
}

const lexLess = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/**
 * The one row a payment not tied to a shift most likely paid. It used to
 * count toward every row with a matching employer name, so one cheque from a
 * company you did two projects for showed as paid on both — and counted
 * twice in the totals.
 *
 * Eligible: the same employer or payroll company, arriving no earlier than
 * the work began and within three months of it ending. Then, in order: a row
 * with hours worked, one not already paid by a payment tied to it, the
 * closest expected amount, and the shortest wait.
 */
function bestRowForPayment(payment: Income, rows: RowCandidate[], alreadyPaid: Set<number>): number | undefined {
  let best: number | undefined;
  let bestKey: number[] | undefined;
  rows.forEach((r, idx) => {
    const ref = r.referenceJob;
    if (!namesMatch(payment.client, ref.client) && !namesMatch(payment.client, ref.payrollCompany)) return;
    const paid = parseISO(payment.date);
    const sinceStart = differenceInDays(paid, parseISO(r.workStart));
    const sinceEnd = differenceInDays(paid, parseISO(r.workEnd));
    if (sinceStart < -3 || sinceEnd > 90) return;
    const key = [
      r.periodJobs.length > 0 ? 0 : 1,
      alreadyPaid.has(idx) ? 1 : 0,
      r.expected > 0 ? Math.abs(r.expected - payment.amount) / Math.max(payment.amount, 1) : 1,
      Math.abs(sinceEnd),
    ];
    if (!bestKey || lexLess(key, bestKey)) { best = idx; bestKey = key; }
  });
  return best;
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
    id: string;
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
    if (parsed.date) setDate(parsed.date);
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
        <div className="flex-1 min-w-[140px]">
          <span className="text-[9px] text-muted-foreground/40 block">employer</span>
          <EmployerCombobox
            value={client}
            onChange={setClient}
            placeholder="who paid you"
            className="[&>input]:h-8 [&>input]:border-0 [&>input]:border-b [&>input]:border-border [&>input]:rounded-none [&>input]:bg-transparent [&>input]:px-1 [&>input]:text-sm [&>input]:text-mono"
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

export default function MoneyPage() {
  const { data, addIncome, updateIncome, deleteIncome, restoreIncome, updateEmployer } = useData();
  const { prefs } = useUserPrefs();
  const [editId, setEditId] = useState<string | null>(null);

  // The year's tax so far: what W2 checks withhold as they go, and what is
  // left for tax time — all of the tax on 1099 work, self-employment tax
  // included, and federal on W2 wages if the W-4 was filed exempt.
  const taxYear = useMemo(() => {
    const year = String(new Date().getFullYear());
    let w2 = 0;
    let selfEmployed = 0;
    for (const job of data.jobs) {
      if (!job.date.startsWith(year)) continue;
      const b = jobPayBreakdown(job, data.jobs, data.employers, prefs.payer);
      if (b.gross <= 0) continue;
      // Vacation is wages too.
      const earned = b.gross + b.vacation;
      if (resolveEmployer(job.client, data.employers)?.workerStatus === '1099') selfEmployed += earned;
      else w2 += earned;
    }
    return { year, w2, selfEmployed, estimate: estimateYearFromEarnings(w2, selfEmployed, prefs.payer.tax ?? {}, Number(year)) };
  }, [data.jobs, data.employers, prefs.payer]);

  const [addOpen, setAddOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const editingInc = editId ? data.income.find(i => i.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name }));
  const total = data.income.reduce((s, i) => s + i.amount, 0);
  // Every payment, newest first.
  const sorted = [...data.income].sort((a, b) => b.date.localeCompare(a.date));

  // Every shift grouped into the rows below, and which row each payment
  // belongs to. Worked out across all employers at once — the filter only
  // hides rows — so a payment never looks unclaimed because its row is
  // filtered out.
  const ledgerRows = useMemo(() => {
    const rows: ReconciliationRow[] = [];
    const productions: Record<string, Job[]> = {};

    for (const job of data.jobs) {
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

    const todayStr = format(new Date(), 'yyyy-MM-dd');

    const candidates = Object.values(productions).map(prodJobs => {
      const referenceJob = prodJobs[0];
      const period = getPayPeriods(referenceJob)[0];
      const periodJobs = prodJobs.filter(j => {
        if (effectiveHoursWorked(j) <= 0) return false;
        // A dispatch offer often already states a call time and an
        // anticipated wrap time before the shift has even happened —
        // effectiveHoursWorked derives hours from those clock times when
        // no explicit hoursWorked is set, which made an upcoming shift
        // look "worked" and show up here to be reconciled before it was
        // actually worked. An explicit hoursWorked is a real confirmation
        // (logged after the fact) and counts regardless of date; clock
        // times alone only count once the shift's date has passed, since
        // hours worked can easily differ from what was originally offered.
        if (j.hoursWorked) return true;
        return j.date < todayStr;
      });
      const employer = resolveEmployer(referenceJob.client, data.employers);
      const payResult = calculateExpectedPay(periodJobs, referenceJob, data.jobs, employer);
      const dates = (periodJobs.length > 0 ? periodJobs : prodJobs).map(j => j.date).sort();
      return { referenceJob, period, prodJobs, periodJobs, payResult, expected: payResult.total, workStart: dates[0], workEnd: dates[dates.length - 1] };
    });

    // Each payment belongs to exactly one row. Tied to a shift, it is that
    // shift's row — any shift in it, not only the first. Otherwise it goes to
    // the one row it most likely paid (see bestRowForPayment).
    const owner = new Map<string, number>();
    const rowOfJob = new Map<string, number>();
    candidates.forEach((c, idx) => c.prodJobs.forEach(j => rowOfJob.set(j.id, idx)));
    const paidByLink = new Set<number>();
    for (const i of data.income) {
      if (!i.jobId) continue;
      const idx = rowOfJob.get(i.jobId);
      if (idx === undefined) continue;
      owner.set(i.id, idx);
      if (i.status === 'paid') paidByLink.add(idx);
    }
    for (const i of data.income) {
      if (i.jobId) continue;
      const idx = bestRowForPayment(i, candidates, paidByLink);
      if (idx !== undefined) owner.set(i.id, idx);
    }

    candidates.forEach(({ referenceJob, period, periodJobs, payResult }, idx) => {
        const periodIncome = data.income.filter(i => owner.get(i.id) === idx);
        const paidIncome = periodIncome.filter(i => i.status === 'paid');
        const totalHours = periodJobs.reduce((s, j) => s + netHoursWorked(j), 0);
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
                id: i.id,
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
    });

    return { rows, owner };
  }, [data]);

  const reconciliation = ledgerRows.rows;

  const totalExpected = reconciliation.reduce((s, r) => s + r.expectedPay, 0);
  const totalActual = reconciliation.reduce((s, r) => s + r.actualPaid, 0);
  // Named rather than signed: "owed $420" reads without working out which way
  // a minus points.
  const owed = Math.max(0, totalExpected - totalActual);
  const overpaid = Math.max(0, totalActual - totalExpected);

  // Hours and days are the figures worth leading with: they are what you sold,
  // and whether a row has been settled is a cleaner fact than how much of the
  // money has landed. A row counts as paid once anything at all has come in.
  const isSettled = (r: ReconciliationRow) => r.actualPaid > 0;
  const datesIn = (rows: ReconciliationRow[]) =>
    new Set(rows.flatMap(r => r.jobs.map(j => j.date))).size;
  const hoursTotal = reconciliation.reduce((sum, r) => sum + r.totalHours, 0);
  const hoursPaid = reconciliation.filter(isSettled).reduce((sum, r) => sum + r.totalHours, 0);
  const daysTotal = datesIn(reconciliation);
  const daysPaid = datesIn(reconciliation.filter(isSettled));
  const paidFraction = totalExpected > 0 ? Math.min(1, totalActual / totalExpected) : 0;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const totalLogged = '$' + total.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' logged';

  // Rates the stubs disagree with the saved profile about, across every
  // employer. This used to surface only inside the detail of a shift that
  // happened to carry a parsed stub, which is nowhere near where payroll is
  // actually read.
  const rateSuggestions = useMemo(
    () => learnFromStubs(data.jobs, data.employers),
    [data.jobs, data.employers],
  );

  const applyRate = async (s: Suggestion) => {
    const employer = data.employers.find(e => e.id === s.employerId);
    if (!employer) return;
    await updateEmployer(s.employerId, {
      [s.field]: s.suggested,
      dismissedSuggestions: consumeSkip(employer, s.field),
    });
    toast.success(employer.name + ' — ' + s.label.toLowerCase() + ' set to ' + s.suggested + '%');
  };

  const skipRate = async (s: Suggestion) => {
    const employer = data.employers.find(e => e.id === s.employerId);
    if (!employer) return;
    await updateEmployer(s.employerId, { dismissedSuggestions: dismissSuggestion(employer, s.field) });
  };




  const paySummaryRows = useMemo(() => {
    const now = new Date();
    const ranges: { label: string; test: (j: Job) => boolean }[] = [
      { label: 'Today', test: j => j.date === format(now, 'yyyy-MM-dd') },
      { label: 'This Week', test: j => { try { return isWithinInterval(parseISO(j.date), { start: startOfWeek(now), end: endOfWeek(now) }); } catch { return false; } } },
      { label: 'This Month', test: j => { try { return isWithinInterval(parseISO(j.date), { start: startOfMonth(now), end: endOfMonth(now) }); } catch { return false; } } },
      { label: 'This Year', test: j => j.date.startsWith(format(now, 'yyyy')) },
    ];
    return ranges.map(({ label, test }): PeriodStat => {
      let gross = 0, net = 0, hours = 0, shifts = 0;
      for (const job of data.jobs.filter(test)) {
        const h = netHoursWorked(job);
        if (h <= 0) continue;
        const { gross: g, net: n } = jobPayBreakdown(job, data.jobs, data.employers);
        gross += g; net += n; hours += h; shifts += 1;
      }
      return { label, gross, net, hours, shifts };
    });
  }, [data.jobs, data.employers]);

  const importRows: ReconciliationRowInfo[] = useMemo(() =>
    reconciliation.map(r => ({
      // jobId included on purpose — periodLabel alone is "Full project" for
      // every non-scheduled shift of the same client, so three separate
      // one-day jobs collapsed onto one identical key. That made them
      // indistinguishable in the match list (React couldn't tell the rows
      // apart, and picking one silently "picked" all three at once).
      key: `${r.client}-${r.periodLabel}-${r.jobId}`,
      jobId: r.jobId,
      client: r.client,
      projectName: projectLabel(r),
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
    <SpacePageWrapper
      title={
        /* In the header row so it lines up with the lamp, the way every other
           page's title does, instead of sitting in the body under an empty
           one. */
        <div className="flex items-center gap-2.5">
          <span className="relative shrink-0 leading-none" aria-hidden="true">
            <span className="absolute -top-1 -left-1.5 text-[8px] text-accent/70">✦</span>
            <span className="absolute -bottom-1 -right-1 text-[6px] text-primary/70">✦</span>
            <span className="text-2xl font-display text-success drop-shadow-[0_0_8px_hsl(var(--success)/0.5)]">$</span>
          </span>
          <h1 className="text-lg font-display tracking-wide leading-none">Money</h1>
        </div>
      }
      description={totalLogged}
    >
      <div className="max-w-lg mx-auto">
      {/* The three figures the page exists to answer, before any of the tools
          for changing them. Still owed is the one you came for, so it is the
          one that is big. */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {/* Stacked the same way as each other: the figure, then what it is
            out of. Side by side at 3xl they wrapped differently and read as
            two different kinds of number. */}
        {([
          { label: 'Hours paid', value: String(round1(hoursPaid)), of: round1(hoursTotal) + 'h' },
          { label: 'Days paid', value: String(daysPaid), of: daysTotal + ' days' },
        ]).map(({ label, value, of }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-[10px] text-muted-foreground text-mono uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold text-mono mt-1 leading-none">{value}</p>
            <p className="text-[11px] text-mono text-muted-foreground mt-1 leading-none">of {of}</p>
          </div>
        ))}

        {/* The money underneath, as how far along it is rather than a bare
            total — the gap is the part worth seeing. */}
        <div className={cn(
          'col-span-2 rounded-lg border p-3',
          owed > 0.01 ? 'border-warning/40 bg-warning/5' : 'border-success/30 bg-success/5',
        )}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-mono">
              <span className="text-success">${totalActual.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              <span className="text-muted-foreground font-medium"> of ${totalExpected.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </p>
            <p className={cn('text-[11px] text-mono font-semibold', owed > 0.01 ? 'text-warning' : 'text-success')}>
              {owed > 0.01
                ? `${owed.toLocaleString(undefined, { maximumFractionDigits: 0 })} short`
                : overpaid > 0.01
                  ? `${overpaid.toLocaleString(undefined, { maximumFractionDigits: 0 })} over`
                  : 'All settled'}
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
            <div
              className={cn('h-full rounded-full', owed > 0.01 ? 'bg-warning' : 'bg-success')}
              style={{ width: `${Math.round(paidFraction * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <PaySummaryTable rows={paySummaryRows} jobs={data.jobs} employers={data.employers} />

      {/* Dues and tax come off, vacation goes on top — each a percentage this
          employer pays, read off the stubs rather than typed in. */}
      {rateSuggestions.length > 0 && (
        <div className="pixel-panel mb-4 p-3 space-y-3">
          <p className="text-[9px] text-mono font-bold tracking-widest uppercase text-accent">
            Learned from your stubs
          </p>
          {rateSuggestions.map(sug => (
            <div key={sug.employerId + sug.field} className="space-y-1.5">
              <p className="text-[11px]">
                <span className="font-semibold">{sug.employerName}</span> — {sug.label.toLowerCase()} looks like{' '}
                <span className="text-mono text-success font-bold">{sug.suggested}%</span>
                {sug.current != null && <>, not <span className="text-mono line-through text-destructive">{sug.current}%</span></>}
              </p>
              <p className="text-[10px] text-mono text-muted-foreground">
                {sug.sampleCount === 1
                  ? 'From 1 stub (' + sug.evidence[0] + ') — worth a look, not conclusive'
                  : sug.sampleCount + ' stubs agree (' + sug.evidence.join(', ') + ') — strong signal'}
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => applyRate(sug)}
                  className="flex-1 rounded-md border border-success/40 bg-success/10 text-success px-2 py-1 text-[10px] font-medium hover:bg-success/20 transition-colors"
                >
                  Always use {sug.suggested}%
                </button>
                <button
                  type="button"
                  onClick={() => skipRate(sug)}
                  className="rounded-md border border-border bg-secondary/20 text-muted-foreground px-2 py-1 text-[10px] hover:text-foreground transition-colors"
                >
                  Not now
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Three ways in, behind one button — both of these were sitting open and
          taking the top of the page whether or not anything was being added. */}
      {!addOpen ? (
        <Button onClick={() => setAddOpen(true)} className="pixel-button w-full mb-4 gap-1.5">
          <Plus size={15} /> Add income
        </Button>
      ) : (
        <div className="pixel-panel mb-4 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-body uppercase tracking-widest text-muted-foreground">Add income</p>
            <button type="button" onClick={() => setAddOpen(false)} className="text-[11px] text-muted-foreground hover:text-foreground">Close</button>
          </div>
          <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setShowImport(true)}>
            <Upload size={13} /> From a screenshot or statement
          </Button>
          <IncomeStatementUpload />
          <IncomeMadlib
            jobs={jobs}
            onAdd={(inc) => { addIncome(inc); toast.success('income added'); setAddOpen(false); }}
          />
        </div>
      )}

      {(taxYear.w2 > 0 || taxYear.selfEmployed > 0) && (() => {
        const owed = taxYear.estimate.stillOwed;
        const dollars = (n: number) => '$' + Math.round(n).toLocaleString();
        return (
          <div className="pixel-panel mt-6 p-3 space-y-1.5">
            <p className="text-[10px] text-mono uppercase tracking-widest text-muted-foreground">Tax · {taxYear.year} estimate</p>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs text-muted-foreground">Still to pay at tax time</span>
              <span className={cn('text-lg font-bold text-mono', owed > 1 ? 'text-dot-overdue' : 'text-dot-paid')}>
                {owed > 1 ? dollars(owed) : owed < -1 ? `refund ~${dollars(-owed)}` : 'covered'}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              W2 {dollars(taxYear.w2)}{taxYear.selfEmployed > 0 && <> · 1099 {dollars(taxYear.selfEmployed)} · self-employment tax {dollars(taxYear.estimate.selfEmployment)}</>}
            </p>
            {prefs.payer.tax?.federalExempt && (
              <p className="text-[11px] text-warning">W-4 exempt: no federal tax is withheld from your checks — it's counted above.</p>
            )}
            {!prefs.payer.tax?.federalEffectivePercent && (
              <p className="text-[11px] text-muted-foreground">Set your tax rate in Settings for a real figure.</p>
            )}
          </div>
        );
      })()}

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

      <ExportButton onClick={() => exportWeeklyToExcel(data.jobs, data.expenses, data.income, data.employers)} />

      {/* ── Every payment ──────────────────────────────────────────────────────
          Per project, pay is on the Calendar now. This is the plain record of
          every payment, linked or not, for looking back over the year. */}
      <p className="mt-6 mb-3 text-[10px] font-body uppercase tracking-widest text-muted-foreground/60">Every payment</p>
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
                <button onClick={() => { void deleteIncome(inc.id); toast.success('Payment removed', { duration: 8000, action: { label: 'Undo', onClick: () => void restoreIncome(inc) } }); }} aria-label="Remove this payment" className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
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
