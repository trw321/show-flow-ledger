import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { addDays, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { FileText, Plus, Printer, Send, Check, Undo2, Pencil, Trash2, X, ChevronRight } from 'lucide-react';
import { useData } from '@/lib/DataContext';
import { proofFromMatch } from '@/lib/paymentProof';
import { useUserPrefs, type InvoiceFrom } from '@/lib/UserPrefsContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Invoice, InvoiceLine } from '@/lib/store';
import { effectiveHoursWorked } from '@/lib/payCalc';
import { nameSimilarity } from '@/lib/employerMatch';
import { crewShiftWorked } from '@/lib/crew';
import { alreadyInvoiced, invoiceOverdue, invoiceTotal, lineForCrewShift, lineForShift, nextInvoiceNumber, paymentsForInvoice } from '@/lib/invoices';
import { localToday } from '@/lib/today';
import { cn } from '@/lib/utils';

/**
 * Invoices, for 1099 work and for billing as a boss: pick the client, tick
 * the shifts (and your crew's) to bill, print it or save it as a PDF, and
 * mark it paid — which records the payment against each project it billed,
 * so the calendar shows them paid too.
 */

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FIELD = 'h-9 text-sm';
const LABEL = 'text-[10px] text-mono uppercase tracking-wider text-muted-foreground';
const sameClient = (a: string, b: string) => nameSimilarity(a, b) >= 0.82;

type Draft = Omit<Invoice, 'id' | 'createdAt'>;

function statusOf(v: Invoice, today: string): { label: string; tone: string } {
  if (v.status === 'paid') return { label: 'Paid', tone: 'border-dot-paid/50 text-dot-paid' };
  if (invoiceOverdue(v, today)) return { label: 'Overdue', tone: 'border-dot-overdue/60 text-dot-overdue' };
  if (v.status === 'sent') return { label: 'Sent', tone: 'border-dot-pending/50 text-dot-pending' };
  return { label: 'Draft', tone: 'border-border text-muted-foreground' };
}

// ── Writing one ────────────────────────────────────────────────────────────

function InvoiceForm({ initial, onSave, onCancel }: {
  initial: Draft & { id?: string };
  onSave: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const { data } = useData();
  const { prefs } = useUserPrefs();
  const [d, setD] = useState<Draft>(initial);
  const set = (patch: Partial<Draft>) => setD(prev => ({ ...prev, ...patch }));
  const setLine = (i: number, patch: Partial<InvoiceLine>) => set({ lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  // Hours or rate changed by hand: the amount follows them.
  const setQtyRate = (i: number, patch: { quantity?: number; rate?: number }) => {
    const l = { ...d.lines[i], ...patch };
    setLine(i, { ...patch, amount: l.quantity !== undefined && l.rate !== undefined ? Math.round(l.quantity * l.rate * 100) / 100 : l.amount });
  };

  const clients = useMemo(() => [...new Set([...data.employers.map(e => e.name), ...data.jobs.map(j => j.client)].filter(Boolean))].sort(), [data.employers, data.jobs]);
  const billed = useMemo(() => alreadyInvoiced(data.invoices ?? [], initial.id), [data.invoices, initial.id]);
  const onThis = new Set(d.lines.flatMap(l => [l.jobId, l.crewShiftId]).filter(Boolean) as string[]);
  const today = localToday();

  // This client's worked shifts, not billed yet.
  const shifts = useMemo(() => !d.client.trim() ? [] : data.jobs
    .filter(j => sameClient(j.client, d.client) && j.date <= today && effectiveHoursWorked(j) > 0 && !billed.jobs.has(j.id))
    .sort((a, b) => a.date.localeCompare(b.date)), [data.jobs, d.client, billed, today]);
  // Boss: your crew's worked shifts on this client's jobs.
  const crewOn = useMemo(() => {
    if (!d.client.trim()) return [];
    const theirJobs = new Set(data.jobs.filter(j => sameClient(j.client, d.client)).map(j => j.id));
    return (data.crewShifts ?? [])
      .filter(s => s.jobId && theirJobs.has(s.jobId) && crewShiftWorked(s, today) && !billed.crewShifts.has(s.id))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data.crewShifts, data.jobs, d.client, billed, today]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (id: string) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const addPicked = () => {
    const lines: InvoiceLine[] = [];
    for (const j of shifts) if (picked.has(j.id) && !onThis.has(j.id)) lines.push(lineForShift(j, data.jobs, data.employers, prefs.payer));
    for (const s of crewOn) {
      if (!picked.has(s.id) || onThis.has(s.id)) continue;
      lines.push(lineForCrewShift(s, data.crew?.find(c => c.id === s.crewId), data.jobs.find(j => j.id === s.jobId)));
    }
    set({ lines: [...d.lines, ...lines] });
    setPicked(new Set());
  };
  const notAdded = [...shifts.map(j => j.id), ...crewOn.map(s => s.id)].filter(id => !onThis.has(id));

  const dueIn = (days: number) => set({ dueDate: format(addDays(parseISO(d.issueDate || today), days), 'yyyy-MM-dd') });
  const total = invoiceTotal(d);

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1"><span className={LABEL}>Bill to *</span>
        <Input list="invoice-clients" autoFocus={!initial.client} value={d.client} onChange={e => set({ client: e.target.value })} placeholder="Client or company" className={FIELD} />
        <datalist id="invoice-clients">{clients.map(c => <option key={c} value={c} />)}</datalist>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>Their email</span>
          <Input type="email" value={d.clientEmail ?? ''} onChange={e => set({ clientEmail: e.target.value || undefined })} className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Number</span>
          <Input value={d.number} onChange={e => set({ number: e.target.value })} className={FIELD} /></label>
      </div>
      <label className="flex flex-col gap-1"><span className={LABEL}>Their address</span>
        <Input value={d.clientAddress ?? ''} onChange={e => set({ clientAddress: e.target.value || undefined })} className={FIELD} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>Date</span>
          <Input type="date" value={d.issueDate} onChange={e => set({ issueDate: e.target.value })} className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Due</span>
          <Input type="date" value={d.dueDate ?? ''} onChange={e => set({ dueDate: e.target.value || undefined })} className={FIELD} /></label>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {([['On receipt', 0], ['Net 15', 15], ['Net 30', 30]] as const).map(([label, days]) => (
          <button key={label} type="button" onClick={() => dueIn(days)}
            className={cn('pixel-button py-1 text-[11px] font-bold', d.dueDate === format(addDays(parseISO(d.issueDate || today), days), 'yyyy-MM-dd') ? 'pick-on' : 'pick-off')}>
            {label}
          </button>
        ))}
      </div>

      {/* What to bill: the client's shifts, and your crew's on them. */}
      {d.client.trim() && (
        <div className="pixel-panel space-y-1.5 p-2.5">
          <p className="text-[10px] text-mono uppercase tracking-widest text-muted-foreground">Not billed yet · {d.client}</p>
          {notAdded.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No worked shifts for {d.client} left to bill.</p>
          ) : (
            <>
              {shifts.filter(j => !onThis.has(j.id)).map(j => (
                <label key={j.id} className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" checked={picked.has(j.id)} onChange={() => togglePick(j.id)} />
                  <span className="min-w-0 flex-1 truncate">{format(parseISO(j.date), 'EEE MMM d')} · {j.name}</span>
                  <span className="text-mono text-muted-foreground">{effectiveHoursWorked(j)}h</span>
                </label>
              ))}
              {crewOn.filter(s => !onThis.has(s.id)).map(s => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 text-xs">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => togglePick(s.id)} />
                  <span className="min-w-0 flex-1 truncate">{format(parseISO(s.date), 'EEE MMM d')} · {data.crew?.find(c => c.id === s.crewId)?.name ?? 'Crew'} (crew)</span>
                </label>
              ))}
              <div className="flex gap-1.5 pt-1">
                <button type="button" onClick={() => setPicked(new Set(notAdded))} className="pixel-button pick-off px-2 py-1 text-[11px] font-bold">All</button>
                <button type="button" disabled={picked.size === 0} onClick={addPicked} className="pixel-button pick-on flex-1 py-1 text-[11px] font-bold disabled:opacity-40">
                  Add {picked.size || ''} to the invoice
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* The lines */}
      <div className="space-y-2">
        {d.lines.map((l, i) => (
          <div key={i} className="space-y-1 border border-border p-2">
            <div className="flex items-center gap-1.5">
              <Input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="What for" className="h-8 flex-1 text-xs" />
              <button type="button" aria-label="Remove line" onClick={() => set({ lines: d.lines.filter((_, j) => j !== i) })} className="p-1 text-muted-foreground hover:text-destructive"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Input type="number" step="0.25" value={l.quantity ?? ''} placeholder="Qty"
                onChange={e => setQtyRate(i, { quantity: e.target.value ? parseFloat(e.target.value) : undefined })} className="h-8 text-xs" />
              <Input type="number" step="0.01" value={l.rate ?? ''} placeholder="Rate"
                onChange={e => setQtyRate(i, { rate: e.target.value ? parseFloat(e.target.value) : undefined })} className="h-8 text-xs" />
              <Input type="number" step="0.01" value={Number.isFinite(l.amount) ? l.amount : ''} placeholder="Amount"
                onChange={e => setLine(i, { amount: e.target.value ? parseFloat(e.target.value) : 0 })} className="h-8 text-xs font-bold" />
            </div>
          </div>
        ))}
        <button type="button" onClick={() => set({ lines: [...d.lines, { description: '', amount: 0 }] })} className="text-[11px] text-foreground/80 underline">
          + Add a line
        </button>
      </div>

      <label className="flex flex-col gap-1"><span className={LABEL}>Notes — how to pay you</span>
        <Input value={d.notes ?? ''} onChange={e => set({ notes: e.target.value || undefined })} placeholder="Zelle to 555-0100 · Check payable to…" className={FIELD} /></label>

      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">Total</span>
        <span className="text-lg font-bold text-mono">{money(total)}</span>
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={!d.client.trim() || !d.number.trim() || d.lines.length === 0} onClick={() => onSave({ ...d, client: d.client.trim(), number: d.number.trim() })}>
          Save
        </Button>
      </div>
    </div>
  );
}

// ── Your details, at the top of every invoice ─────────────────────────────

function FromForm() {
  const { prefs, setInvoiceFrom } = useUserPrefs();
  const from = prefs.invoiceFrom ?? {};
  const set = (patch: Partial<InvoiceFrom>) => setInvoiceFrom({ ...from, ...patch });
  return (
    <div className="space-y-2 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>Your name</span>
          <Input value={from.name ?? ''} onChange={e => set({ name: e.target.value || undefined })} className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Business</span>
          <Input value={from.business ?? ''} onChange={e => set({ business: e.target.value || undefined })} className={FIELD} /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>Email</span>
          <Input type="email" value={from.email ?? ''} onChange={e => set({ email: e.target.value || undefined })} className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Phone</span>
          <Input type="tel" value={from.phone ?? ''} onChange={e => set({ phone: e.target.value || undefined })} className={FIELD} /></label>
      </div>
      <label className="flex flex-col gap-1"><span className={LABEL}>Address</span>
        <Input value={from.address ?? ''} onChange={e => set({ address: e.target.value || undefined })} className={FIELD} /></label>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { data, addInvoice, updateInvoice, deleteInvoice, addIncome, deleteIncome } = useData();
  const { prefs } = useUserPrefs();
  const invoices = useMemo(() => [...(data.invoices ?? [])].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number)), [data.invoices]);
  const today = localToday();
  const [editing, setEditing] = useState<(Draft & { id?: string }) | null>(null);
  const [fromOpen, setFromOpen] = useState(!prefs.invoiceFrom?.name && !prefs.invoiceFrom?.business);

  const outstanding = invoices.filter(v => v.status === 'sent').reduce((sum, v) => sum + invoiceTotal(v), 0);
  const year = today.slice(0, 4);
  const paidThisYear = invoices.filter(v => v.status === 'paid' && v.issueDate.startsWith(year)).reduce((sum, v) => sum + invoiceTotal(v), 0);

  const startNew = () => setEditing({
    number: nextInvoiceNumber(data.invoices ?? []), client: '', issueDate: today,
    dueDate: format(addDays(parseISO(today), 30), 'yyyy-MM-dd'), lines: [], status: 'draft',
  });

  /** Back to sent: the payments Mark paid recorded come off again. */
  const unmarkPaid = async (v: Invoice) => {
    for (const id of v.paidIncomeIds ?? []) await deleteIncome(id);
    await updateInvoice(v.id, { status: 'sent', paidIncomeIds: undefined });
  };

  /** The money is in: a payment for each project it billed, so the calendar shows them paid. */
  const markPaid = async (v: Invoice) => {
    const ids: string[] = [];
    for (const p of paymentsForInvoice(v, data.jobs, data.employers)) {
      const created = await addIncome({
        jobId: p.jobId, client: v.client, description: `Invoice ${v.number}`, amount: p.amount,
        date: today, status: 'paid', invoiceNumber: v.number,
        matchProof: proofFromMatch('invoice', { percent: 100, level: 'high', expected: p.amount, reasons: [{ text: `Invoice ${v.number} billed these shifts`, good: true }] }),
      });
      ids.push(created.id);
    }
    await updateInvoice(v.id, { status: 'paid', paidIncomeIds: ids });
    toast.success(`${v.number} paid — ${money(invoiceTotal(v))}`, {
      duration: 8000,
      action: { label: 'Undo', onClick: () => void unmarkPaid({ ...v, status: 'paid', paidIncomeIds: ids }) },
    });
  };

  return (
    <SpacePageWrapper
      title={
        <div className="flex items-center gap-2.5">
          <FileText size={22} aria-hidden />
          <h1 className="text-lg font-display tracking-wide leading-none">Invoices</h1>
        </div>
      }
      description={outstanding > 0 ? `${money(outstanding)} waiting to be paid` : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
    >
      <div className="max-w-lg mx-auto">
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="pixel-panel p-3">
            <p className="text-[10px] text-muted-foreground text-mono uppercase tracking-wider">Outstanding</p>
            <p className={cn('text-2xl font-bold text-mono mt-1 leading-none', outstanding > 0 && 'text-dot-pending')}>{money(outstanding)}</p>
          </div>
          <div className="pixel-panel p-3">
            <p className="text-[10px] text-muted-foreground text-mono uppercase tracking-wider">Paid {year}</p>
            <p className="text-2xl font-bold text-mono mt-1 leading-none text-dot-paid">{money(paidThisYear)}</p>
          </div>
        </div>

        <Button onClick={startNew} className="pixel-button w-full mb-4 gap-1.5"><Plus size={15} /> New invoice</Button>

        <Collapsible open={fromOpen} onOpenChange={setFromOpen} className="pixel-panel mb-4 p-3">
          <CollapsibleTrigger className="flex w-full items-center gap-2 text-left">
            <ChevronRight size={14} className={cn('text-muted-foreground transition-transform', fromOpen && 'rotate-90')} />
            <span className="flex-1 text-[10px] text-mono uppercase tracking-widest text-muted-foreground">Your details on invoices</span>
            <span className="truncate text-[11px] text-muted-foreground">{prefs.invoiceFrom?.business ?? prefs.invoiceFrom?.name ?? 'not set'}</span>
          </CollapsibleTrigger>
          <CollapsibleContent><FromForm /></CollapsibleContent>
        </Collapsible>

        {invoices.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-secondary/10 p-8 text-center">
            <FileText size={28} className="text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No invoices yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Tap New invoice, pick the client, and tick the shifts to bill.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {invoices.map(v => {
              const st = statusOf(v, today);
              return (
                <div key={v.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{v.client}</p>
                      <p className="text-[10px] text-mono text-muted-foreground">
                        {v.number} · {format(parseISO(v.issueDate), 'MMM d')}{v.dueDate ? ` · due ${format(parseISO(v.dueDate), 'MMM d')}` : ''} · {v.lines.length} line{v.lines.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-base font-bold text-mono">{money(invoiceTotal(v))}</p>
                      <span className={cn('mt-0.5 inline-block border px-1.5 text-[9px] text-mono font-bold uppercase', st.tone)}>{st.label}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Link to={`/invoices/${v.id}/print`} className="pixel-button pick-off inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold"><Printer size={12} /> View / PDF</Link>
                    {v.status !== 'paid' && (
                      <button type="button" onClick={() => setEditing({ ...v })} className="pixel-button pick-off inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold"><Pencil size={12} /> Edit</button>
                    )}
                    {v.status === 'draft' && (
                      <button type="button" onClick={() => void updateInvoice(v.id, { status: 'sent' })} className="pixel-button pick-off inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold"><Send size={12} /> Mark sent</button>
                    )}
                    {v.status !== 'paid' ? (
                      <button type="button" onClick={() => void markPaid(v)} className="pixel-button pick-off inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold"><Check size={12} /> Mark paid</button>
                    ) : (
                      <button type="button" onClick={() => void unmarkPaid(v)} className="pixel-button pick-off inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold"><Undo2 size={12} /> Undo paid</button>
                    )}
                    <span className="flex-1" />
                    {v.status !== 'paid' && (
                      <button type="button" aria-label={`Delete ${v.number}`} onClick={() => {
                        void deleteInvoice(v.id);
                        toast.success(`${v.number} deleted`, {
                          duration: 8000,
                          action: { label: 'Undo', onClick: () => { const { id: _id, createdAt: _c, ...rest } = v; void addInvoice(rest); } },
                        });
                      }} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
          <DialogContent className="max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-mono text-sm">{editing?.id ? `Edit ${editing.number}` : 'New invoice'}</DialogTitle></DialogHeader>
            {editing && (
              <InvoiceForm
                initial={editing}
                onCancel={() => setEditing(null)}
                onSave={async draft => {
                  if (editing.id) await updateInvoice(editing.id, draft);
                  else await addInvoice(draft);
                  toast.success(`${draft.number} saved`);
                  setEditing(null);
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </SpacePageWrapper>
  );
}
