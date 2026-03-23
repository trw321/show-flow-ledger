import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import StatementUpload from '@/components/StatementUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Receipt, Plus, Trash2, Pencil, ChevronRight, Filter } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import type { Expense } from '@/lib/store';

const categories = ['Travel', 'Gear Rental', 'Consumables', 'Fuel', 'Meals', 'Lodging', 'Labor', 'Insurance', 'Software', 'Other'];

const categoryEmojis: Record<string, string> = {
  Travel: '✈️', 'Gear Rental': '🎛️', Consumables: '🔌', Fuel: '⛽', Meals: '🍔',
  Lodging: '🏨', Labor: '👷', Insurance: '🛡️', Software: '💻', Other: '📦',
};

type DateFilter = 'all' | 'this-week' | 'this-month' | 'custom';

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
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [statementOpen, setStatementOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set(categories));

  const editingExp = editId ? data.expenses.find(e => e.id === editId) : undefined;
  const jobs = data.jobs.map(j => ({ id: j.id, name: j.name }));

  const filteredExpenses = useMemo(() => {
    if (dateFilter === 'all') return data.expenses;
    const now = new Date();
    let start: Date, end: Date;
    if (dateFilter === 'this-week') {
      start = startOfWeek(now, { weekStartsOn: 1 });
      end = endOfWeek(now, { weekStartsOn: 1 });
    } else if (dateFilter === 'this-month') {
      start = startOfMonth(now);
      end = endOfMonth(now);
    } else {
      if (!customFrom || !customTo) return data.expenses;
      start = new Date(customFrom);
      end = new Date(customTo);
    }
    return data.expenses.filter(e => {
      const d = new Date(e.date);
      return isWithinInterval(d, { start, end });
    });
  }, [data.expenses, dateFilter, customFrom, customTo]);

  const grouped = useMemo(() => {
    const map: Record<string, Expense[]> = {};
    for (const cat of categories) map[cat] = [];
    for (const exp of filteredExpenses) {
      const cat = categories.includes(exp.category) ? exp.category : 'Other';
      map[cat].push(exp);
    }
    return Object.entries(map).filter(([, exps]) => exps.length > 0);
  }, [filteredExpenses]);

  const total = filteredExpenses.reduce((s, e) => s + e.amount, 0);

  const toggleCategory = (cat: string) => {
    setOpenCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title="Expenses"
        description={`Total: $${total.toLocaleString()}`}
        action={
          <div className="flex gap-2">
            <StatementUpload />
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus size={16} className="mr-1" /> New</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="text-mono">New Expense</DialogTitle></DialogHeader>
                <ExpenseForm jobs={jobs} onSubmit={(exp) => { addExpense(exp); setOpen(false); }} />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Date Filter Bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter size={14} className="text-muted-foreground" />
        {(['all', 'this-week', 'this-month', 'custom'] as DateFilter[]).map(f => (
          <Button
            key={f}
            size="sm"
            variant={dateFilter === f ? 'default' : 'outline'}
            className="text-xs h-7 px-3"
            onClick={() => setDateFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'this-week' ? 'This Week' : f === 'this-month' ? 'This Month' : 'Custom'}
          </Button>
        ))}
        {dateFilter === 'custom' && (
          <div className="flex gap-2 items-center">
            <Input type="date" className="h-7 text-xs w-auto" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-muted-foreground text-xs">to</span>
            <Input type="date" className="h-7 text-xs w-auto" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      {data.expenses.length === 0 ? (
        <>
          <EmptyState icon={Receipt} title="No expenses yet" description="Tap to upload a receipt or statement photo" onUploadPhoto={() => setStatementOpen(true)} />
          <StatementUpload externalOpen={statementOpen} onExternalOpenChange={setStatementOpen} />
        </>
      ) : grouped.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">No expenses match this filter.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([cat, exps]) => {
            const catTotal = exps.reduce((s, e) => s + e.amount, 0);
            return (
              <Collapsible key={cat} open={openCategories.has(cat)} onOpenChange={() => toggleCategory(cat)}>
                <CollapsibleTrigger className="flex items-center w-full gap-3 px-4 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/80 transition-colors group">
                  <ChevronRight size={16} className={`text-muted-foreground transition-transform duration-200 ${openCategories.has(cat) ? 'rotate-90' : ''}`} />
                  <span className="text-lg">{categoryEmojis[cat] || '📦'}</span>
                  <span className="font-semibold text-sm flex-1 text-left">{cat}</span>
                  <span className="text-xs text-muted-foreground">{exps.length} item{exps.length !== 1 ? 's' : ''}</span>
                  <span className="text-sm font-bold text-destructive text-mono">-${catTotal.toLocaleString()}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-4 border-l-2 border-border/50 mt-1">
                    {exps.map(exp => {
                      const job = data.jobs.find(j => j.id === exp.jobId);
                      return (
                        <div key={exp.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/20 transition-colors rounded-r-lg">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{exp.description}</p>
                            <p className="text-xs text-muted-foreground">
                              {format(new Date(exp.date), 'MMM d, yyyy')}
                              {job ? ` · ${job.name}` : ''}
                            </p>
                          </div>
                          <span className="text-sm font-bold text-destructive text-mono whitespace-nowrap">-${exp.amount.toLocaleString()}</span>
                          <div className="flex gap-0.5">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditId(exp.id)}><Pencil size={13} /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteExpense(exp.id)}><Trash2 size={13} /></Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
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
