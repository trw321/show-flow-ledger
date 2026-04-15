import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import ExpenseReceiptUpload from '@/components/ExpenseReceiptUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Receipt, Mic, MicOff, Trash2, Pencil, ChevronRight, Filter } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import type { Expense } from '@/lib/store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useVoiceInput, parseExpenseSpeech } from '@/lib/useVoiceInput';

const categories = [
  'Travel', 'Gear Rental', 'Consumables', 'Fuel', 'Meals', 'Lodging',
  'Labor', 'Insurance', 'Software', 'Tools', 'Entertainment', 'Medical',
  'Rent', 'IATSE Union Dues', 'Other',
];

const categoryEmojis: Record<string, string> = {
  Travel: '✈️', 'Gear Rental': '🎛️', Consumables: '🛒', Fuel: '⛽', Meals: '🍔',
  Lodging: '🏨', Labor: '👷', Insurance: '🛡️', Software: '💻', Tools: '🔧',
  Entertainment: '🪩', Medical: '🩺', Rent: '🏢', 'IATSE Union Dues': '⚙️', Other: '📦',
};

type DateFilter = 'all' | 'this-week' | 'this-month' | 'custom';

// ── Edit form ──────────────────────────────────────────────────────────────

function ExpenseEditForm({ initial, jobs, onSubmit, onCancel }: {
  initial: Partial<Expense>;
  jobs: { id: string; name: string }[];
  onSubmit: (exp: Omit<Expense, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const [description, setDescription] = useState(initial.description ?? '');
  const [amount, setAmount] = useState(initial.amount?.toString() ?? '');
  const [category, setCategory] = useState(initial.category ?? categories[0]);
  const [date, setDate] = useState(initial.date ?? new Date().toISOString().split('T')[0]);
  const [jobId, setJobId] = useState(initial.jobId ?? '');

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (!description.trim() || !amount) return;
        onSubmit({ description: description.trim(), amount: parseFloat(amount), category, date, jobId: jobId || undefined });
      }}
      className="space-y-3"
    >
      <Input placeholder="description" value={description} onChange={e => setDescription(e.target.value)} required className="rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        <Input type="number" step="0.01" placeholder="amount" value={amount} onChange={e => setAmount(e.target.value)} required className="rounded-xl" />
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <select value={category} onChange={e => setCategory(e.target.value)} className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
          {categories.map(c => <option key={c} value={c}>{c.toLowerCase()}</option>)}
        </select>
        <select value={jobId || 'none'} onChange={e => setJobId(e.target.value === 'none' ? '' : e.target.value)} className="h-9 rounded-xl border border-input bg-background px-3 text-sm">
          <option value="none">no linked job</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>cancel</Button>
        <Button type="submit" size="sm">{initial.id ? 'update' : 'add expense'}</Button>
      </div>
    </form>
  );
}

// ── Inline madlib add block ────────────────────────────────────────────────

function ExpenseMadlib({ jobs, onAdd }: {
  jobs: { id: string; name: string }[];
  onAdd: (exp: Omit<Expense, 'id' | 'createdAt'>) => void;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const { listening, supported, start, stop } = useVoiceInput((text) => {
    const parsed = parseExpenseSpeech(text);
    if (parsed.amount) setAmount(parsed.amount.toString());
    if (parsed.description) setDescription(parsed.description);
    if (parsed.category) setCategory(parsed.category);
    toast.success(`heard: "${text}"`);
  });

  const handleAdd = () => {
    if (!description.trim() || !amount) return;
    onAdd({ description: description.trim(), amount: parseFloat(amount), category, date });
    setAmount(''); setDescription('');
    setCategory(categories[0]);
    setDate(new Date().toISOString().split('T')[0]);
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
        <span className="text-muted-foreground">i spent</span>
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
        <span className="text-muted-foreground">on</span>
        <div className="flex-1 min-w-[120px]">
          <span className="text-[9px] text-muted-foreground/40 block">what</span>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="describe it"
            className={inputCls}
          />
        </div>
        <span className="text-muted-foreground">·</span>
        <div className="w-36">
          <span className="text-[9px] text-muted-foreground/40 block">category</span>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="h-8 w-full rounded-lg border-0 border-b border-border bg-transparent text-sm text-mono focus:outline-none"
          >
            {categories.map(c => <option key={c} value={c}>{c.toLowerCase()}</option>)}
          </select>
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

      <div className="flex justify-end pt-1">
        <Button size="sm" className="h-7 text-xs" disabled={!description.trim() || !amount} onClick={handleAdd}>
          add
        </Button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { data, addExpense, updateExpense, deleteExpense } = useData();
  const [editId, setEditId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());

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
    return data.expenses.filter(e => isWithinInterval(new Date(e.date), { start, end }));
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
      <PageHeader title="Expenses" description={`total: $${total.toLocaleString()}`} />

      {/* Receipt import */}
      <div className="mb-4">
        <ExpenseReceiptUpload />
      </div>

      {/* Madlib quick add */}
      <ExpenseMadlib
        jobs={jobs}
        onAdd={(exp) => { addExpense(exp); toast.success('expense added'); }}
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
            {f === 'all' ? 'all' : f === 'this-week' ? 'this week' : f === 'this-month' ? 'this month' : 'custom'}
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
        <div className="rounded-2xl border border-border/40 bg-secondary/10 p-8 text-center">
          <Receipt size={28} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">no expenses yet</p>
          <p className="text-xs text-muted-foreground/50 mt-1">use the quick add above or scan a receipt</p>
        </div>
      ) : grouped.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 text-sm">no expenses match this filter.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(([cat, exps]) => {
            const catTotal = exps.reduce((s, e) => s + e.amount, 0);
            return (
              <Collapsible key={cat} open={openCategories.has(cat)} onOpenChange={() => toggleCategory(cat)}>
                <CollapsibleTrigger className="flex items-center w-full gap-3 px-4 py-3 rounded-2xl bg-secondary/40 hover:bg-secondary/70 transition-colors">
                  <ChevronRight size={15} className={cn("text-muted-foreground transition-transform duration-200 shrink-0", openCategories.has(cat) && "rotate-90")} />
                  <span className="text-lg leading-none shrink-0">{categoryEmojis[cat] ?? '📦'}</span>
                  <span className="font-semibold text-sm flex-1 text-left lowercase">{cat}</span>
                  <span className="text-xs text-muted-foreground">{exps.length} item{exps.length !== 1 ? 's' : ''}</span>
                  <span className="text-sm font-bold text-destructive text-mono">-${catTotal.toLocaleString()}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1.5 space-y-1.5 pl-2">
                    {exps.map(exp => {
                      const job = data.jobs.find(j => j.id === exp.jobId);
                      return (
                        <div key={exp.id} className="rounded-xl border border-border bg-card px-3 py-2.5 flex items-center gap-3 hover:border-primary/20 transition-colors">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{exp.description}</p>
                            <p className="text-[10px] text-mono text-muted-foreground mt-0.5">
                              {format(new Date(exp.date + 'T12:00:00'), 'MMM d, yyyy')}
                              {job && <span className="ml-1.5">· {job.name}</span>}
                            </p>
                          </div>
                          <span className="text-sm font-bold text-destructive text-mono shrink-0">-${exp.amount.toLocaleString()}</span>
                          <div className="flex gap-0.5 shrink-0">
                            <button onClick={() => setEditId(exp.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => deleteExpense(exp.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                              <Trash2 size={13} />
                            </button>
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

      {/* Edit dialog */}
      <Dialog open={!!editId} onOpenChange={o => !o && setEditId(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="text-mono text-sm">edit expense</DialogTitle></DialogHeader>
          {editingExp && (
            <ExpenseEditForm
              jobs={jobs}
              initial={editingExp}
              onSubmit={updates => { updateExpense(editId!, updates); setEditId(null); toast.success('updated'); }}
              onCancel={() => setEditId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
