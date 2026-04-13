import { useState, useCallback, useRef } from 'react';
import { useData } from '@/lib/DataContext';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Upload, Loader2, Check, X, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { Job } from '@/lib/store';

interface ParsedIncome {
  client: string;
  description: string;
  amount: number;
  date: string;
  invoiceNumber?: string;
}

/**
 * Try to match a payment to the most likely job.
 * Pay dates typically land 7–21 days after the work week (bi-weekly payroll).
 * We score on date proximity + payroll company / client name overlap.
 */
function findLinkedJob(txnDate: string, txnClient: string, txnDesc: string, jobs: Job[]): Job | null {
  const pay = new Date(txnDate + 'T12:00:00');
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const nc = norm(txnClient);
  const nd = norm(txnDesc);

  let best: Job | null = null;
  let bestScore = 0;

  for (const job of jobs) {
    const jobDate = new Date(job.date + 'T12:00:00');
    const daysDiff = (pay.getTime() - jobDate.getTime()) / (1000 * 60 * 60 * 24);

    // Job must precede the payment; allow up to 35 days back
    if (daysDiff < 0 || daysDiff > 35) continue;

    let score = 0;

    // Date proximity — sweet spot is 7–21 days (standard bi-weekly window)
    if (daysDiff >= 7 && daysDiff <= 21) score += 3;
    else if (daysDiff >= 3 && daysDiff <= 28) score += 1;

    // Payroll company name match (strongest signal)
    const np = norm(job.payrollCompany || '');
    if (np.length > 2) {
      const words = np.split(/\s+/).filter(w => w.length > 3);
      if (words.some(w => nc.includes(w) || nd.includes(w))) score += 5;
      else if (nc.includes(np) || np.includes(nc)) score += 4;
    }

    // Client name match
    const njc = norm(job.client || '');
    if (njc.length > 2) {
      const words = njc.split(/\s+/).filter(w => w.length > 3);
      if (words.some(w => nc.includes(w) || nd.includes(w))) score += 3;
      else if (nc.includes(njc) || njc.includes(nc)) score += 2;
    }

    if (score > bestScore) { bestScore = score; best = job; }
  }

  return bestScore >= 3 ? best : null;
}

export default function IncomeStatementUpload({ externalOpen, onExternalOpenChange }: { externalOpen?: boolean; onExternalOpenChange?: (open: boolean) => void } = {}) {
  const { addIncome, data } = useData();
  const isControlled = externalOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => { if (isControlled) onExternalOpenChange?.(v); else setInternalOpen(v); };
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<ParsedIncome[]>([]);
  const [linkedJobs, setLinkedJobs] = useState<(Job | null)[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10MB)'); return; }

    setLoading(true);
    setTransactions([]);
    setLinkedJobs([]);
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

      const responseData = await resp.json();
      const txns: ParsedIncome[] = responseData.transactions || [];
      setTransactions(txns);
      setLinkedJobs(txns.map(t => findLinkedJob(t.date, t.client, t.description, data.jobs)));
      setSelected(new Set(txns.map((_, i) => i)));
      toast[txns.length ? 'success' : 'info'](txns.length ? `Found ${txns.length} payment(s)` : 'No payments found in this image');
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to parse statement');
    } finally {
      setLoading(false);
    }
  }, [data.jobs]);

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
          jobId: linkedJobs[i]?.id || undefined,
        });
        count++;
      }
    });
    toast.success(`Added ${count} income entry(ies)`);
    setOpen(false);
    setTransactions([]);
    setLinkedJobs([]);
    setSelected(new Set());
    setPreview(null);
  };

  return (
    <>
      {/* Hidden file input — opened directly on click */}
      <input
        id="income-statement-input"
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) { setOpen(true); handleFile(f); e.currentTarget.value = ''; }
        }}
      />

      {/* Upload trigger — click goes straight to file picker, drag works too */}
      <button
        className={`w-full flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-5 transition-colors cursor-pointer ${
          dragging
            ? 'border-primary bg-primary/10 scale-[1.01]'
            : 'border-border bg-secondary/20 hover:border-primary/50 hover:bg-secondary/40'
        }`}
        onClick={() => document.getElementById('income-statement-input')?.click()}
        onDragEnter={e => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
        onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          dragCounter.current = 0;
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) { setOpen(true); handleFile(file); }
        }}
      >
        <Upload size={22} className={dragging ? 'text-primary' : 'text-muted-foreground'} />
        <span className={`text-sm font-medium ${dragging ? 'text-primary' : 'text-muted-foreground'}`}>
          {dragging ? 'drop to scan' : 'load screenshot'}
        </span>
        <span className="text-xs text-muted-foreground/50">
          {dragging ? '' : 'paystub, invoice, or bank statement · drag & drop or click'}
        </span>
      </button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setTransactions([]); setLinkedJobs([]); setPreview(null); } }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-mono">Upload Statement / Invoice</DialogTitle>
        </DialogHeader>

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
            <div className="space-y-2">
              {transactions.map((txn, i) => {
                const linked = linkedJobs[i];
                return (
                  <div
                    key={i}
                    onClick={() => toggleSelect(i)}
                    className={`rounded-xl border p-3 cursor-pointer transition-colors ${selected.has(i) ? 'bg-primary/5 border-primary/30' : 'border-border hover:bg-secondary/30 opacity-50'}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        {selected.has(i)
                          ? <Check size={14} className="text-primary" />
                          : <span className="w-3.5 h-3.5 rounded-sm border border-border inline-block" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="font-medium text-sm">{txn.client}</p>
                          <span className="font-bold text-mono text-success text-sm">+${Math.abs(txn.amount).toLocaleString()}</span>
                        </div>
                        {txn.description && <p className="text-xs text-muted-foreground mt-0.5">{txn.description}</p>}
                        <p className="text-[10px] text-mono text-muted-foreground mt-1">paid {txn.date}</p>

                        {/* Linked job suggestion */}
                        {linked ? (
                          <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-primary/8 border border-primary/20 px-2 py-1">
                            <Link2 size={10} className="text-primary shrink-0" />
                            <span className="text-[10px] text-primary font-medium text-mono">
                              likely from: {linked.name}
                              {linked.payrollCompany ? ` · ${linked.payrollCompany}` : ''}
                              {' · '}work week of {format(new Date(linked.date + 'T12:00:00'), 'MMM d')}
                            </span>
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/40 mt-1.5 italic">no matching job found — link manually after import</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setTransactions([]); setLinkedJobs([]); setPreview(null); }}><X size={14} className="mr-1" /> Cancel</Button>
              <Button onClick={addSelected} disabled={selected.size === 0}>Add {selected.size} income{selected.size !== 1 ? 's' : ''}</Button>
            </div>
          </div>
        )}
      </DialogContent>
      </Dialog>
    </>
  );
}
