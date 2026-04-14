import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import IncomeStatementUpload from '@/components/IncomeStatementUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DollarSign, Mic, MicOff, ChevronRight, Trash2, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import type { Income } from '@/lib/store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useVoiceInput, parseIncomeSpeech } from '@/lib/useVoiceInput';

const statusColors: Record<Income['status'], string> = {
  paid:    'bg-success/15 text-success border-success/30',
  pending: 'bg-accent/15 text-accent border-accent/30',
  overdue: 'bg-destructive/15 text-destructive border-destructive/30',
};

const payMethodConfig: Record<string, { label: string; cls: string; note?: string }> = {
  direct_deposit: { label: 'direct deposit', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  check:          { label: 'check', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', note: 'may be delayed in mail' },
  cash:           { label: 'cash', cls: 'bg-success/15 text-success border-success/30' },
  other:          { label: 'other', cls: 'bg-secondary text-muted-foreground border-border' },
};

// ── Edit form (used in dialog for existing records) ────────────────────────

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
  const { data, addIncome, updateIncome, deleteIncome } = useData(); // data used for job linking
  const [editId, setEditId] = useState<string | null>(null);

  const editingInc = editId ? data.income.find(i => i.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name }));
  const total = data.income.reduce((s, i) => s + i.amount, 0);
  const sorted = [...data.income].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <PageHeader title="Income" description={`total: $${total.toLocaleString()}`} />

      {/* Statement import */}
      <div className="mb-4">
        <IncomeStatementUpload />
      </div>

      {/* Madlib quick add */}
      <IncomeMadlib
        jobs={jobs}
        onAdd={(inc) => { addIncome(inc); toast.success('income added'); }}
      />

      {/* Income list */}
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-border/40 bg-secondary/10 p-8 text-center">
          <DollarSign size={28} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">no income recorded yet</p>
          <p className="text-xs text-muted-foreground/50 mt-1">use the quick add above or load a statement</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(inc => (
            <div
              key={inc.id}
              className="rounded-2xl border border-border bg-card p-3.5 flex items-start gap-3 hover:border-primary/20 transition-colors"
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
          ))}
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
    </>
  );
}
