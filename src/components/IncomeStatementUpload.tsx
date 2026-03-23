import { useState, useCallback } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Upload, Loader2, Check, X, FileImage } from 'lucide-react';
import { toast } from 'sonner';

interface ParsedIncome {
  client: string;
  description: string;
  amount: number;
  date: string;
  invoiceNumber?: string;
}

export default function IncomeStatementUpload({ externalOpen, onExternalOpenChange }: { externalOpen?: boolean; onExternalOpenChange?: (open: boolean) => void } = {}) {
  const { addIncome } = useData();
  const isControlled = externalOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => { if (isControlled) onExternalOpenChange?.(v); else setInternalOpen(v); };
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<ParsedIncome[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10MB)'); return; }

    setLoading(true);
    setTransactions([]);
    setSelected(new Set());

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
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type, type: 'income' }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse statement');
      }

      const data = await resp.json();
      const txns: ParsedIncome[] = data.transactions || [];
      setTransactions(txns);
      setSelected(new Set(txns.map((_, i) => i)));
      toast[txns.length ? 'success' : 'info'](txns.length ? `Found ${txns.length} payment(s)` : 'No payments found in this image');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to parse statement');
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
        addIncome({
          client: txn.client,
          description: txn.description,
          amount: Math.abs(txn.amount),
          date: txn.date,
          status: 'paid',
          invoiceNumber: txn.invoiceNumber || undefined,
        });
        count++;
      }
    });
    toast.success(`Added ${count} income entry(ies)`);
    setOpen(false);
    setTransactions([]);
    setSelected(new Set());
    setPreview(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setTransactions([]); setPreview(null); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Upload size={16} /> Load Statement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-mono">Upload Statement / Invoice</DialogTitle>
        </DialogHeader>

        {!loading && transactions.length === 0 && (
          <div
            onDrop={e => { e.preventDefault(); e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]); }}
            onDragOver={e => e.preventDefault()}
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-secondary/30 p-10 cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => document.getElementById('income-statement-input')?.click()}
          >
            <FileImage size={32} className="text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Drop an image here or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP • Max 10MB</p>
            <input id="income-statement-input" type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center py-10">
            <Loader2 size={32} className="text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground text-mono">Analyzing statement...</p>
            {preview && <img src={preview} alt="Preview" className="mt-4 max-h-40 rounded-md border border-border opacity-50" />}
          </div>
        )}

        {!loading && transactions.length > 0 && (
          <div className="space-y-4">
            {preview && <img src={preview} alt="Statement" className="max-h-32 rounded-md border border-border" />}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{selected.size} of {transactions.length} selected</p>
              <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === transactions.length ? new Set() : new Set(transactions.map((_, i) => i)))}>
                {selected.size === transactions.length ? 'Deselect all' : 'Select all'}
              </Button>
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider text-mono">
                    <th className="w-8 px-3 py-2"></th>
                    <th className="text-left px-3 py-2">Client</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((txn, i) => (
                    <tr key={i} onClick={() => toggleSelect(i)} className={`border-t border-border cursor-pointer transition-colors ${selected.has(i) ? 'bg-primary/5' : 'hover:bg-secondary/30'}`}>
                      <td className="px-3 py-2 text-center">
                        {selected.has(i) ? <Check size={14} className="text-primary" /> : <span className="w-3.5 h-3.5 rounded-sm border border-border inline-block" />}
                      </td>
                      <td className="px-3 py-2 font-medium">{txn.client}</td>
                      <td className="px-3 py-2 text-muted-foreground">{txn.description}</td>
                      <td className="px-3 py-2 text-mono text-xs">{txn.date}</td>
                      <td className="px-3 py-2 text-right text-mono font-bold text-success">+${Math.abs(txn.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setTransactions([]); setPreview(null); }}><X size={14} className="mr-1" /> Cancel</Button>
              <Button onClick={addSelected} disabled={selected.size === 0}>Add {selected.size} income{selected.size !== 1 ? 's' : ''}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
