import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DollarSign, Plus, Trash2, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import type { Income } from '@/lib/store';

const statusOptions = ['pending', 'paid', 'overdue'] as const;

function IncomeForm({ onSubmit, initial, jobs, onCancel }: {
  onSubmit: (income: Omit<Income, 'id' | 'createdAt'>) => void;
  initial?: Partial<Income>;
  jobs: { id: string; name: string }[];
  onCancel?: () => void;
}) {
  const [client, setClient] = useState(initial?.client ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState<Income['status']>(initial?.status ?? 'pending');
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? '');
  const [jobId, setJobId] = useState(initial?.jobId ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!client.trim() || !amount) return;
    onSubmit({ client: client.trim(), description: description.trim(), amount: parseFloat(amount), date, status, invoiceNumber: invoiceNumber.trim() || undefined, jobId: jobId || undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input placeholder="Client*" value={client} onChange={e => setClient(e.target.value)} required />
        <Input placeholder="Invoice #" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
      </div>
      <Input placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} />
      <div className="grid grid-cols-2 gap-4">
        <Input type="number" step="0.01" placeholder="Amount*" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select value={status} onValueChange={(v) => setStatus(v as Income['status'])}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={jobId || 'none'} onValueChange={v => setJobId(v === 'none' ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="Link to job" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No job</SelectItem>
            {jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 justify-end">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit">{initial ? 'Update' : 'Add Income'}</Button>
      </div>
    </form>
  );
}

export default function IncomePage() {
  const { data, addIncome, updateIncome, deleteIncome } = useData();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const editingInc = editId ? data.income.find(i => i.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name }));
  const total = data.income.reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <PageHeader
        title="Income"
        description={`Total: $${total.toLocaleString()}`}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus size={16} className="mr-1" /> New Income</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-mono">New Income</DialogTitle></DialogHeader>
              <IncomeForm jobs={jobs} onSubmit={(inc) => { addIncome(inc); setOpen(false); }} />
            </DialogContent>
          </Dialog>
        }
      />

      {data.income.length === 0 ? (
        <EmptyState icon={DollarSign} title="No income recorded" description="Track payments and invoices for your AV work." />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3">Client</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3">Invoice</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.income.map(inc => (
                <tr key={inc.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{inc.client}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inc.description || '—'}</td>
                  <td className="px-4 py-3 text-mono text-xs">{inc.invoiceNumber || '—'}</td>
                  <td className="px-4 py-3 text-mono text-xs">{format(new Date(inc.date), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs text-mono font-medium ${
                      inc.status === 'paid' ? 'bg-success/20 text-success' :
                      inc.status === 'overdue' ? 'bg-destructive/20 text-destructive' :
                      'bg-accent/20 text-accent'
                    }`}>{inc.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-mono font-bold text-success">+${inc.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditId(inc.id)}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteIncome(inc.id)}><Trash2 size={14} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-mono">Edit Income</DialogTitle></DialogHeader>
          {editingInc && (
            <IncomeForm jobs={jobs} initial={editingInc} onSubmit={(updates) => { updateIncome(editId!, updates); setEditId(null); }} onCancel={() => setEditId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
