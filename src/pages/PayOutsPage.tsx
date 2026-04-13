import { useState, useEffect, useMemo } from 'react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Wallet, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// ── Types ──────────────────────────────────────────────────────────────────

type PaymentMethod = 'check' | 'cash' | 'venmo' | 'zelle' | 'ach' | 'other';

interface PayOut {
  id: string;
  workerName: string;
  amount: number;
  date: string;
  jobRef?: string;
  periodStart?: string;
  periodEnd?: string;
  method?: PaymentMethod;
  notes?: string;
  createdAt: string;
}

// ── Storage helpers ────────────────────────────────────────────────────────

function storageKey(uid: string) { return `av-payouts-${uid}`; }
function loadList(key: string): PayOut[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
}
function saveList(key: string, list: PayOut[]) {
  localStorage.setItem(key, JSON.stringify(list));
}

// ── Constants ──────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<PaymentMethod, string> = {
  check: 'Check', cash: 'Cash', venmo: 'Venmo',
  zelle: 'Zelle', ach: 'ACH', other: 'Other',
};

const METHOD_COLORS: Record<PaymentMethod, string> = {
  check:  'bg-blue-500/15 text-blue-400',
  cash:   'bg-success/15 text-success',
  venmo:  'bg-violet-500/15 text-violet-400',
  zelle:  'bg-purple-500/15 text-purple-400',
  ach:    'bg-primary/15 text-primary',
  other:  'bg-secondary text-muted-foreground',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function PayOutsPage() {
  const [uid, setUid] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<PayOut[]>([]);
  const [dialog, setDialog] = useState(false);

  // Form state
  const [worker, setWorker] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [jobRef, setJobRef] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('check');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const id = session?.user?.id;
      if (!id) return;
      setUid(id);
      setPayouts(loadList(storageKey(id)));
    });
  }, []);

  const persist = (next: PayOut[]) => {
    setPayouts(next);
    if (uid) saveList(storageKey(uid), next);
  };

  const addPayout = () => {
    if (!worker.trim() || !amount || !date) return;
    const payout: PayOut = {
      id: crypto.randomUUID(),
      workerName: worker.trim(),
      amount: parseFloat(amount),
      date,
      jobRef: jobRef.trim() || undefined,
      periodStart: periodStart || undefined,
      periodEnd: periodEnd || undefined,
      method,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    persist([payout, ...payouts]);
    setWorker(''); setAmount(''); setDate(format(new Date(), 'yyyy-MM-dd'));
    setJobRef(''); setPeriodStart(''); setPeriodEnd(''); setNotes('');
    setMethod('check');
    setDialog(false);
    toast.success(`$${parseFloat(amount).toLocaleString()} recorded for ${payout.workerName}`);
  };

  const remove = (id: string) => persist(payouts.filter(p => p.id !== id));

  // Summary stats
  const stats = useMemo(() => {
    const total = payouts.reduce((s, p) => s + p.amount, 0);
    const thisMonth = format(new Date(), 'yyyy-MM');
    const monthTotal = payouts
      .filter(p => p.date.startsWith(thisMonth))
      .reduce((s, p) => s + p.amount, 0);
    const workers = [...new Set(payouts.map(p => p.workerName))];
    return { total, monthTotal, workerCount: workers.length };
  }, [payouts]);

  // Group by month
  const grouped = useMemo(() => {
    const map: Record<string, PayOut[]> = {};
    for (const p of payouts) {
      const key = p.date.slice(0, 7);
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [payouts]);

  return (
    <>
      <PageHeader title="Pay Outs" description="Record and track crew payments" />

      <Button size="sm" onClick={() => setDialog(true)} className="gap-1.5 mb-6">
        <Plus size={14} /> Record Payment
      </Button>

      {/* Summary stats */}
      {payouts.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50 mb-1">This Month</p>
            <p className="text-lg font-bold text-mono text-success">${stats.monthTotal.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50 mb-1">All Time</p>
            <p className="text-lg font-bold text-mono">${stats.total.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3 text-center">
            <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50 mb-1">Workers Paid</p>
            <p className="text-lg font-bold text-mono">{stats.workerCount}</p>
          </div>
        </div>
      )}

      {/* Payout list */}
      {payouts.length === 0 ? (
        <div className="rounded-2xl border border-border/40 bg-secondary/10 p-8 text-center">
          <Wallet size={28} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No payments recorded yet</p>
          <p className="text-xs text-muted-foreground/50 mt-1">Hit "Record Payment" to log your first crew payout</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([month, items]) => {
            const monthTotal = items.reduce((s, p) => s + p.amount, 0);
            return (
              <div key={month}>
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/50">
                    {format(parseISO(month + '-01'), 'MMMM yyyy')}
                  </span>
                  <span className="text-xs text-mono font-bold text-success">${monthTotal.toLocaleString()}</span>
                </div>
                <div className="space-y-2">
                  {items.map(p => (
                    <div key={p.id} className="rounded-xl border border-border bg-card p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-sm">{p.workerName}</p>
                          {p.method && (
                            <span className={cn("text-[9px] font-semibold text-mono uppercase rounded-full px-2 py-0.5", METHOD_COLORS[p.method])}>
                              {METHOD_LABELS[p.method]}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap mt-0.5">
                          <p className="text-xs text-mono text-muted-foreground">
                            {format(parseISO(p.date + 'T12:00:00'), 'MMM d')}
                          </p>
                          {p.jobRef && <p className="text-xs text-muted-foreground">· {p.jobRef}</p>}
                          {p.periodStart && p.periodEnd && (
                            <p className="text-xs text-muted-foreground/50 text-mono">
                              {format(parseISO(p.periodStart + 'T12:00:00'), 'MMM d')}–{format(parseISO(p.periodEnd + 'T12:00:00'), 'MMM d')}
                            </p>
                          )}
                        </div>
                        {p.notes && <p className="text-xs text-muted-foreground/50 mt-0.5">{p.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-bold text-mono text-success">${p.amount.toLocaleString()}</span>
                        <button onClick={() => remove(p.id)} className="text-muted-foreground/30 hover:text-destructive transition-colors">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Record Payment dialog */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-sm rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-mono text-sm">Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Worker / Payee *</label>
              <Input value={worker} onChange={e => setWorker(e.target.value)} placeholder="e.g. Jamie Torres" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Amount *</label>
                <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="$0.00" className="h-9 text-mono" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Date *</label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Show / Job</label>
              <Input value={jobRef} onChange={e => setJobRef(e.target.value)} placeholder="Show or job name" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Period Start</label>
                <Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Period End</label>
                <Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Payment Method</label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[10px] font-semibold text-mono uppercase border transition-colors",
                      method === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notes</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" className="h-9" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setDialog(false)}>Cancel</Button>
              <Button size="sm" className="flex-1" disabled={!worker.trim() || !amount || !date} onClick={addPayout}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
