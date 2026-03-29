import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Check, X, FileImage } from 'lucide-react';
import { toast } from 'sonner';
import { differenceInDays, parseISO } from 'date-fns';
import type { Income } from '@/lib/store';

interface ParsedDeposit {
  description: string;
  amount: number;
  date: string;
  client?: string;
  invoiceNumber?: string;
}

export interface ReconciliationRowInfo {
  key: string;
  jobId: string;
  client: string;
  periodLabel: string;
  periodEnd: string; // YYYY-MM-DD
  expectedPay: number;
}

interface MatchResult {
  row: ReconciliationRowInfo;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}

interface DepositEntry {
  deposit: ParsedDeposit;
  matches: MatchResult[];
  chosenRowKey: string | null;
}

function scoreMatch(deposit: ParsedDeposit, row: ReconciliationRowInfo): MatchResult {
  let score = 0;
  const reasons: string[] = [];

  // Amount proximity (most important signal)
  if (row.expectedPay > 0) {
    const diff = Math.abs(deposit.amount - row.expectedPay) / row.expectedPay;
    if (diff < 0.01) { score += 50; reasons.push('Exact amount match'); }
    else if (diff < 0.05) { score += 35; reasons.push('Amount within 5%'); }
    else if (diff < 0.15) { score += 15; reasons.push('Amount within 15%'); }
  }

  // Client name appears in deposit description
  const descLower = deposit.description.toLowerCase();
  const clientWords = row.client.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (clientWords.some(w => descLower.includes(w))) {
    score += 30; reasons.push('Client name in description');
  }
  if (deposit.client) {
    const depClientLower = deposit.client.toLowerCase();
    if (clientWords.some(w => depClientLower.includes(w))) {
      score += 15; reasons.push('Client field match');
    }
  }

  // Date: deposit should arrive after period end (payroll lag 1–35 days is normal)
  const depDate = parseISO(deposit.date);
  const periodEnd = parseISO(row.periodEnd);
  const daysAfter = differenceInDays(depDate, periodEnd);
  if (daysAfter >= 0 && daysAfter <= 7)  { score += 20; reasons.push('Paid within 1 week of period end'); }
  else if (daysAfter >= 0 && daysAfter <= 21) { score += 14; reasons.push('Paid within 3 weeks of period end'); }
  else if (daysAfter >= 0 && daysAfter <= 42) { score += 8;  reasons.push('Paid within 6 weeks of period end'); }
  else if (daysAfter >= 0 && daysAfter <= 90) { score += 5;  reasons.push('Paid within 3 months of period end'); }
  else if (daysAfter < 0 && daysAfter >= -7) { score += 5;  reasons.push('Paid slightly before period end'); }

  const confidence: 'high' | 'medium' | 'low' =
    score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low';

  return { row, score, confidence, reasons };
}

function buildEntries(deposits: ParsedDeposit[], rows: ReconciliationRowInfo[]): DepositEntry[] {
  return deposits.map(deposit => {
    const matches = rows
      .map(row => scoreMatch(deposit, row))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score);

    const top = matches[0];
    const chosenRowKey = top?.confidence === 'high' ? top.row.key : null;
    return { deposit, matches, chosenRowKey };
  });
}

interface Props {
  rows: ReconciliationRowInfo[];
  onConfirm: (income: Omit<Income, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}

export default function BankStatementImport({ rows, onConfirm, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [entries, setEntries] = useState<DepositEntry[]>([]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('File too large (max 10MB)'); return; }

    setLoading(true);
    setEntries([]);

    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const jobsContext = rows.map(r => ({ name: r.periodLabel, client: r.client }));

      const resp = await fetch(`${supabaseUrl}/functions/v1/parse-statement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type, type: 'income', jobs: jobsContext }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse statement');
      }

      const data = await resp.json();
      const deposits: ParsedDeposit[] = data.transactions || [];

      if (deposits.length === 0) {
        toast.info('No deposits found in this statement');
        setLoading(false);
        return;
      }

      const matched = buildEntries(deposits, rows);
      setEntries(matched);
      const autoMatched = matched.filter(e => e.chosenRowKey !== null).length;
      toast.success(`Found ${deposits.length} deposit(s) — ${autoMatched} auto-matched`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse statement');
    } finally {
      setLoading(false);
    }
  }, [rows]);

  const setChoice = (depIdx: number, rowKey: string | null) => {
    setEntries(prev => prev.map((e, i) => i === depIdx ? { ...e, chosenRowKey: rowKey } : e));
  };

  const confirmAll = () => {
    for (const entry of entries) {
      const row = entry.chosenRowKey ? rows.find(r => r.key === entry.chosenRowKey) : undefined;
      onConfirm({
        jobId: row?.jobId,
        client: row?.client || entry.deposit.client || 'Unknown',
        description: entry.deposit.description,
        amount: entry.deposit.amount,
        date: entry.deposit.date,
        status: 'paid',
        invoiceNumber: entry.deposit.invoiceNumber,
      });
    }
    toast.success(`Added ${entries.length} payment${entries.length !== 1 ? 's' : ''}`);
    onClose();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── Results view ──────────────────────────────────────────────────────────
  if (entries.length > 0) {
    return (
      <div className="space-y-4">
        {preview && (
          <img src={preview} alt="Statement" className="max-h-28 rounded-md border border-border" />
        )}
        <p className="text-sm text-muted-foreground">
          {entries.length} deposit{entries.length !== 1 ? 's' : ''} found.
          Confirm or adjust each match before adding.
        </p>

        <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {entries.map((entry, i) => (
            <div key={i} className="rounded-lg border border-border bg-card p-3">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-medium leading-tight">{entry.deposit.description}</p>
                  <p className="text-xs text-muted-foreground text-mono mt-0.5">{entry.deposit.date}</p>
                </div>
                <p className="text-sm font-bold text-mono text-success ml-3 whitespace-nowrap">
                  +${entry.deposit.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>

              {entry.matches.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Match to pay period
                  </p>
                  {entry.matches.slice(0, 3).map(m => {
                    const isChosen = entry.chosenRowKey === m.row.key;
                    return (
                      <button
                        key={m.row.key}
                        onClick={() => setChoice(i, isChosen ? null : m.row.key)}
                        className={`w-full text-left rounded px-3 py-2 text-xs border transition-colors ${
                          isChosen
                            ? 'border-primary bg-primary/10 text-foreground'
                            : 'border-border hover:bg-secondary/50 text-muted-foreground'
                        }`}
                      >
                        <div className="flex justify-between items-center gap-2">
                          <span className="truncate">{m.row.client} · {m.row.periodLabel}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                              m.confidence === 'high'   ? 'bg-success/20 text-success' :
                              m.confidence === 'medium' ? 'bg-warning/20 text-warning' :
                                                          'bg-secondary text-muted-foreground'
                            }`}>
                              {m.confidence.toUpperCase()}
                            </span>
                            <span className="text-mono">
                              ${m.row.expectedPay.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            {isChosen && <Check size={12} className="text-primary" />}
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {m.reasons.join(' · ')}
                        </p>
                      </button>
                    );
                  })}
                  {entry.chosenRowKey && (
                    <button
                      onClick={() => setChoice(i, null)}
                      className="text-[10px] text-muted-foreground hover:text-foreground ml-1 mt-0.5"
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No matching pay periods — will be added as unmatched income
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 justify-end pt-1 border-t border-border">
          <Button variant="ghost" size="sm" onClick={() => { setEntries([]); setPreview(null); }}>
            <X size={14} className="mr-1" /> Back
          </Button>
          <Button size="sm" onClick={confirmAll}>
            <Check size={14} className="mr-1" />
            Add {entries.length} payment{entries.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    );
  }

  // ── Upload view ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex flex-col items-center py-10">
          <Loader2 size={28} className="text-primary animate-spin mb-3" />
          <p className="text-sm text-muted-foreground text-mono">Analyzing statement...</p>
          {preview && (
            <img src={preview} alt="Preview" className="mt-4 max-h-32 rounded-md border border-border opacity-50" />
          )}
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-secondary/30 p-10 cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => document.getElementById('bank-stmt-input')?.click()}
        >
          <FileImage size={32} className="text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground text-center">
            Drop a bank statement screenshot here or click to browse
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            AI extracts deposits and matches them to your pay periods
          </p>
          <input
            id="bank-stmt-input"
            type="file"
            accept="image/*"
            className="hidden"
            onClick={e => e.stopPropagation()}
            onChange={e => { const f = e.target.files?.[0]; if (f) { handleFile(f); e.currentTarget.value = ''; } }}
          />
        </div>
      )}
    </div>
  );
}
