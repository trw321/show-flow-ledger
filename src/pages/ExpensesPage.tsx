import { useState } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import StatementUpload from '@/components/StatementUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Receipt, Plus, Trash2, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import type { Expense } from '@/lib/store';

const categories = ['Travel', 'Gear Rental', 'Consumables', 'Fuel', 'Meals', 'Lodging', 'Labor', 'Insurance', 'Software', 'Other'];

function ExpenseForm({ onSubmit, initial, jobs, onCancel }: {
  onSubmit: (expense: Omit<Expense, 'id' | 'createdAt'>) => void;
  initial?: Partial<Expense>;
  jobs: { id: string; name: string }[];
  onCancel?: () => void;
}) {
  const [description, setDescription] = useState(initial?.description ?? '');
  const [amount, setAmount] = useState(initial?.amount?.toString() ?? '');
  const [category, setCategory] = useState(initial?.category ?? categories[0]);
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().split('T')[0]);
  const [jobId, setJobId] = useState(initial?.jobId ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim() || !amount) return;
    onSubmit({ description: description.trim(), amount: parseFloat(amount), category, date, jobId: jobId || undefined });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input placeholder="Description*" value={description} onChange={e => setDescription(e.target.value)} required />
      <div className="grid grid-cols-2 gap-4">
        <Input type="number" step="0.01" placeholder="Amount*" value={amount} onChange={e => setAmount(e.target.value)} required />
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
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
        <Button type="submit">{initial ? 'Update' : 'Add Expense'}</Button>
      </div>
    </form>
  );
}

export default function ExpensesPage() {
  const { data, addExpense, updateExpense, deleteExpense } = useData();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const editingExp = editId ? data.expenses.find(e => e.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name }));
  const total = data.expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <>
      <PageHeader
        title="Expenses"
        description={`Total: $${total.toLocaleString()}`}
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button size="sm"><Plus size={16} className="mr-1" /> New Expense</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="text-mono">New Expense</DialogTitle></DialogHeader>
              <ExpenseForm jobs={jobs} onSubmit={(exp) => { addExpense(exp); setOpen(false); }} />
            </DialogContent>
          </Dialog>
        }
      />

      {data.expenses.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses yet" description="Start logging your AV job expenses." />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Job</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map(exp => {
                const job = data.jobs.find(j => j.id === exp.jobId);
                return (
                  <tr key={exp.id} className="border-t border-border hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{exp.description}</td>
                    <td className="px-4 py-3 text-muted-foreground">{exp.category}</td>
                    <td className="px-4 py-3 text-muted-foreground">{job?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-mono text-xs">{format(new Date(exp.date), 'MMM d, yyyy')}</td>
                    <td className="px-4 py-3 text-right text-mono font-bold text-destructive">-${exp.amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditId(exp.id)}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteExpense(exp.id)}><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-mono">Edit Expense</DialogTitle></DialogHeader>
          {editingExp && (
            <ExpenseForm jobs={jobs} initial={editingExp} onSubmit={(updates) => { updateExpense(editId!, updates); setEditId(null); }} onCancel={() => setEditId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
