import { useState, useCallback } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Loader2, Check, X, FileImage } from 'lucide-react';
import { toast } from 'sonner';

const categories = [
  'Travel', 'Gear Rental', 'Consumables', 'Fuel', 'Meals', 'Lodging',
  'Labor', 'Insurance', 'Software', 'Tools', 'Entertainment', 'Medical',
  'Rent', 'IATSE Union Dues', 'Other',
];

interface ParsedExpense {
  description: string;
  amount: number;
  date: string;
  category: string;
}

export default function ExpenseReceiptUpload({ externalOpen, onExternalOpenChange }: { externalOpen?: boolean; onExternalOpenChange?: (open: boolean) => void } = {}) {
  const { addExpense } = useData();
  const isControlled = externalOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => { if (isControlled) onExternalOpenChange?.(v); else setInternalOpen(v); };

  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<ParsedExpense[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);

  // Allow overriding category per row before import
  const [overrides, setOverrides] = useState<Record<number, string>>({});

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10MB)'); return; }

    setLoading(true);
    setTransactions([]);
    setSelected(new Set());
    setOverrides({});

    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-statement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type, type: 'expense' }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse receipt');
      }

      const data = await resp.json();
      const txns: ParsedExpense[] = data.transactions || [];
      setTransactions(txns);
      setSelected(new Set(txns.map((_, i) => i)));
      toast[txns.length ? 'success' : 'info'](
        txns.length ? `Found ${txns.length} expense(s)` : 'No expenses found in this image'
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to parse receipt');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const addSelected = () => {
    let count = 0;
    transactions.forEach((txn, i) => {
      if (selected.has(i)) {
        addExpense({
          description: txn.description,
          amount: Math.abs(txn.amount),
          date: txn.date,
          category: overrides[i] ?? txn.category,
        });
        count++;
      }
    });
    toast.success(`Added ${count} expense(s)`);
    setOpen(false);
    setTransactions([]);
    setSelected(new Set());
    setOverrides({});
    setPreview(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setTransactions([]); setPreview(null); setOverrides({}); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Upload size={16} /> Upload Receipt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-mono">Upload Receipt / Statement</DialogTitle>
        </DialogHeader>

        {!loading && transactions.length === 0 && (
          <div
            onDrop={e => { e.preventDefault(); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
            onDragOver={e => e.preventDefault()}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-secondary/30 p-10 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => document.getElementById('expense-receipt-input')?.click()}
          >
            <FileImage size={32} className="text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Drop a receipt photo here or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP • Max 10MB</p>
            <input
              id="expense-receipt-input"
              type="file"
              accept="image/*"
              className="hidden"
              onClick={e => e.stopPropagation()}
              onChange={e => { const f = e.target.files?.[0]; if (f) { handleFile(f); e.currentTarget.value = ''; } }}
            />
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center py-10">
            <Loader2 size={32} className="text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground text-mono">Analyzing receipt...</p>
            {preview && <img src={preview} alt="Preview" className="mt-4 max-h-40 rounded-md border border-border opacity-50" />}
          </div>
        )}

        {!loading && transactions.length > 0 && (
          <div className="space-y-4">
            {preview && <img src={preview} alt="Receipt" className="max-h-32 rounded-md border border-border" />}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{selected.size} of {transactions.length} selected</p>
              <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === transactions.length ? new Set() : new Set(transactions.map((_, i) => i)))}>
                {selected.size === transactions.length ? 'Deselect all' : 'Select all'}
              </Button>
            </div>
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                    <th className="w-8 px-3 py-2"></th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2">Category</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn, i) => (
                    <tr key={i} onClick={() => toggleSelect(i)} className={`border-t border-border cursor-pointer transition-colors ${selected.has(i) ? 'bg-primary/5' : 'hover:bg-secondary/30'}`}>
                      <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelect(i)} className="accent-primary" />
                      </td>
                      <td className="px-3 py-2 font-medium">{txn.description}</td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        <Select value={overrides[i] ?? txn.category} onValueChange={v => setOverrides(prev => ({ ...prev, [i]: v }))}>
                          <SelectTrigger className="h-7 text-xs w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-mono text-xs">{txn.date}</td>
                      <td className="px-3 py-2 text-right text-mono font-bold text-destructive">-${Math.abs(txn.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setTransactions([]); setPreview(null); setOverrides({}); }}>
                <X size={14} className="mr-1" /> Cancel
              </Button>
              <Button onClick={addSelected} disabled={selected.size === 0}>
                Add {selected.size} expense{selected.size !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
