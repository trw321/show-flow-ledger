import { useState, useRef, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import { useAuth } from '@/lib/AuthContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { bestProjectFor, type MatchContext, type ProjectMatch } from '@/lib/paymentMatch';
import { paidShiftIds } from '@/lib/payPeriods';
import { effectiveHoursWorked } from '@/lib/payCalc';
import { proofFromMatch, type ProofKind } from '@/lib/paymentProof';
import { uploadStub } from '@/lib/stubStorage';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Upload, Loader2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import type { Income, Job } from '@/lib/store';
import { resizeImageToBase64 } from '@/lib/imageResize';
import { alreadyRecorded, repeatsInUpload } from '@/lib/paymentRepeats';
import StubEditor from '@/components/StubEditor';
import { cn } from '@/lib/utils';

/** Why a payment read off the image starts out left out. */
interface LeftOut {
  /** Index of the earlier payment it repeats. */
  repeatOf?: number;
  /** The payment already in the ledger that it matches. */
  recorded?: Income;
}

export interface ParsedIncome {
  client: string;
  description: string;
  amount: number;
  date: string;
  invoiceNumber?: string;
  /** Hours the stub itemises by day, when it does — the surest sign of which shift it paid. */
  breakdown?: { date: string; hours: number; type: 'ST' | 'OT' | 'DT' }[];
}

/** The shift a payment was matched to, and every reason it was picked. */
/** A pay stub read on its own — no check, no deposit in the picture. */
export function looksLikeStubOnly(txn: ParsedIncome): boolean {
  const what = (txn.description ?? '').toLowerCase();
  return /\b(stub|earnings statement|payroll advice|pay statement)\b/.test(what)
    && !/\b(check|cheque|deposit|deposited|direct deposit|ach|transfer)\b/.test(what);
}

const day = (iso: string) => format(parseISO(iso), 'MMM d');

export interface PaymentLink {
  job: Job | null;
  /** Every reason, for and against, from the same engine as the calendar. */
  reasons: { text: string; good: boolean }[];
  match?: ProjectMatch;
}

/**
 * The shift a payment most likely paid, and why. It's the same engine as Add
 * pay on the calendar, so a payment gets the same answer wherever it's added:
 * a project worked up to 45 days before it, or a week after, scored on the
 * stub's hours, the amount, the payer and the timing. The reasons are shown
 * beside the photo, so a match can be checked instead of taken on trust.
 */
export function findLinkedJob(txn: ParsedIncome, ctx: MatchContext): PaymentLink {
  const hoursOn = (txn.breakdown ?? []).map(b => b.date);
  const best = bestProjectFor({
    amount: Math.abs(txn.amount),
    date: txn.date,
    payer: txn.client || undefined,
    hoursOn: hoursOn.length > 0 ? hoursOn : undefined,
  }, ctx);
  if (!best) return { job: null, reasons: [] };
  // Linked to its first day still owed, so it shows on the right part of the run.
  const owed = best.project.filter(j => effectiveHoursWorked(j) > 0 && !ctx.paidJobIds.has(j.id)).sort((a, b) => a.date.localeCompare(b.date));
  return { job: owed[0] ?? best.project[0], reasons: best.match.reasons, match: best.match };
}

/** How a payment read off a photo came in. */
function kindOfRead(txn: ParsedIncome, stubOnly: boolean): ProofKind {
  if (stubOnly) return 'stub';
  const what = (txn.description ?? '').toLowerCase();
  if (/\b(check|cheque)\b/.test(what)) return 'check';
  if (/\b(deposit|ach|transfer)\b/.test(what)) return 'deposit';
  if (/\b(stub|earnings|payroll)\b/.test(what)) return 'stub';
  return 'statement';
}

/** One "label — value" line in the read-from-the-photo column. */
function Read({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>
  );
}

export default function IncomeStatementUpload({ externalOpen, onExternalOpenChange }: { externalOpen?: boolean; onExternalOpenChange?: (open: boolean) => void } = {}) {
  const { addIncome, data } = useData();
  const { prefs } = useUserPrefs();
  const { user } = useAuth();
  const matchCtx = useMemo(() => ({
    allJobs: data.jobs, employers: data.employers, payer: prefs.payer,
    paidJobIds: paidShiftIds(data.jobs, data.income, data.employers, prefs.payer),
  }), [data.jobs, data.employers, data.income, prefs.payer]);
  const isControlled = externalOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? externalOpen : internalOpen;
  const setOpen = (v: boolean) => { if (isControlled) onExternalOpenChange?.(v); else setInternalOpen(v); };
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<ParsedIncome[]>([]);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [leftOut, setLeftOut] = useState<LeftOut[]>([]);
  // Rows that are a pay stub and nothing more: what is coming, not money in.
  const [stubOnly, setStubOnly] = useState<Set<number>>(new Set());
  // The photo as it was sent — after any black bars — so what is on screen is
  // exactly what the reader saw.
  const [preview, setPreview] = useState<string | null>(null);
  // The picked photo, held in the editor until it has been blacked out.
  const [editing, setEditing] = useState<string | null>(null);
  const [photoBig, setPhotoBig] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const reset = () => {
    setTransactions([]); setLinks([]); setSelected(new Set()); setLeftOut([]); setStubOnly(new Set());
    setPreview(null); setEditing(null); setPhotoBig(false);
  };

  // A photo goes to the editor before anything else happens, so whatever is
  // blacked out there never reaches the reader, or anywhere else.
  const pickFile = (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file'); return; }
    if (file.size > 15 * 1024 * 1024) { toast.error('File too large (max 15MB)'); return; }
    reset();
    const reader = new FileReader();
    reader.onload = () => { setOpen(true); setEditing(reader.result as string); };
    reader.readAsDataURL(file);
  };

  const readStatement = async (edited: string) => {
    setEditing(null);
    setPreview(edited);
    setLoading(true);
    try {
      const blob = await (await fetch(edited)).blob();
      const { base64, mimeType } = await resizeImageToBase64(new File([blob], 'statement.jpg', { type: blob.type || 'image/jpeg' }));

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-statement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ imageBase64: base64, mimeType, type: 'income' }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Failed to parse' }));
        throw new Error(err.error || 'Failed to parse statement');
      }

      const responseData = await resp.json();
      const txns: ParsedIncome[] = responseData.transactions || [];
      // The same money read twice — a stub and the check stapled to it — or
      // already in the ledger starts out unticked, so adding everything that
      // was found cannot count one paycheck twice.
      const repeats = repeatsInUpload(txns);
      const flags: LeftOut[] = txns.map((t, i) => ({
        repeatOf: repeats[i],
        recorded: repeats[i] === undefined ? alreadyRecorded(t, data.income) : undefined,
      }));
      setTransactions(txns);
      // A stub on its own says the money is coming; with its check or a
      // deposit, the money is in. Only a guess to start from — each row can
      // be switched.
      setStubOnly(new Set(txns.map((t, i) => (looksLikeStubOnly(t) ? i : -1)).filter(i => i >= 0)));
      setLeftOut(flags);
      setLinks(txns.map(t => findLinkedJob(t, matchCtx)));
      setSelected(new Set(txns.map((_, i) => i).filter(i => flags[i].repeatOf === undefined && !flags[i].recorded)));
      const skipped = flags.filter(f => f.repeatOf !== undefined || f.recorded).length;
      toast[txns.length ? 'success' : 'info'](
        !txns.length ? 'No payments found in this image'
          : skipped ? `Found ${txns.length} — left out ${skipped} that look like the same payment`
          : `Found ${txns.length} payment(s)`
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to parse statement');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const [isSaving, setIsSaving] = useState(false);

  const addSelected = async () => {
    setIsSaving(true);
    let count = 0;
    let failed = 0;
    // The photo is kept as the proof of everything read off it.
    const proofRef = user && preview ? await uploadStub(preview, user.id, 'statement') : null;
    for (let i = 0; i < transactions.length; i++) {
      if (!selected.has(i)) continue;
      const txn = transactions[i];
      try {
        await addIncome({
          client: txn.client,
          description: txn.description,
          amount: Math.abs(txn.amount),
          date: txn.date,
          status: stubOnly.has(i) ? 'pending' : 'paid',
          invoiceNumber: txn.invoiceNumber || undefined,
          jobId: links[i]?.job?.id || undefined,
          proofRef: proofRef ?? undefined,
          matchProof: proofFromMatch(kindOfRead(txn, stubOnly.has(i)), links[i]?.match, { amount: Math.abs(txn.amount), payer: txn.client, date: txn.date }),
        });
        count++;
      } catch (err) {
        console.error('Failed to save income:', txn.client, err);
        failed++;
      }
    }
    setIsSaving(false);
    if (count === 0) {
      toast.error(failed > 0 ? 'Failed to save — check your connection' : 'Nothing to add');
      return;
    }
    toast.success(`Added ${count} income entry(ies)${failed ? ` • ${failed} failed` : ''}`);
    setOpen(false);
    reset();
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
          if (f) { pickFile(f); e.currentTarget.value = ''; }
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
          if (file) pickFile(file);
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

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-mono">{editing ? 'Black out anything private' : 'Upload Statement / Invoice'}</DialogTitle>
        </DialogHeader>

        {editing && (
          <StubEditor
            source={editing}
            onCancel={() => { setOpen(false); reset(); }}
            onDone={edited => void readStatement(edited)}
          />
        )}

        {!editing && loading && (
          <div className="flex flex-col items-center py-10">
            <Loader2 size={32} className="text-primary animate-spin mb-3" />
            <p className="text-sm text-muted-foreground text-mono">Reading it...</p>
            {preview && <img src={preview} alt="Preview" className="mt-4 max-h-40 rounded-md border border-border opacity-50" />}
          </div>
        )}

        {!editing && !loading && transactions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{selected.size} of {transactions.length} selected</p>
              <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === transactions.length ? new Set() : new Set(transactions.map((_, i) => i)))}>
                {selected.size === transactions.length ? 'Deselect all' : 'Select all'}
              </Button>
            </div>

            {/* The photo beside what was taken from it: what is being saved
                and why it matches, laid against the stub they came from. */}
            <div className={cn('grid gap-3 items-start', photoBig ? 'grid-cols-1' : 'grid-cols-[minmax(0,2fr)_minmax(0,3fr)]')}>
              {preview && (
                <button type="button" onClick={() => setPhotoBig(b => !b)} className="sm:sticky sm:top-0 text-left">
                  <img src={preview} alt="The statement, as it was read" className="w-full border border-border" />
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    As it was sent{photoBig ? ' · tap to shrink' : ' · tap to enlarge'}
                  </span>
                </button>
              )}

              <div className="space-y-2 min-w-0">
                {transactions.map((txn, i) => {
                  const on = selected.has(i);
                  const link = links[i] ?? { job: null, reasons: [] };
                  return (
                    <div key={i} className={cn('border p-2.5 transition-colors', on ? 'border-foreground/60 bg-foreground/5' : 'border-border opacity-60')}>
                      <button type="button" onClick={() => toggleSelect(i)} className="flex w-full items-center gap-2 text-left">
                        {on
                          ? <Check size={14} className="text-foreground shrink-0" />
                          : <span className="w-3.5 h-3.5 border border-border inline-block shrink-0" />}
                        <span className="font-bold text-mono text-success text-sm">+${Math.abs(txn.amount).toLocaleString()}</span>
                        <span className="ml-auto text-[10px] text-mono text-muted-foreground">{on ? 'will be added' : 'left out'}</span>
                      </button>

                      {on && (
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {([
                            { stub: false, label: 'Money in' },
                            { stub: true, label: 'Stub only — not in yet' },
                          ]).map(({ stub, label }) => (
                            <button
                              key={label}
                              type="button"
                              aria-pressed={stubOnly.has(i) === stub}
                              onClick={() => setStubOnly(prev => {
                                const next = new Set(prev);
                                if (stub) next.add(i); else next.delete(i);
                                return next;
                              })}
                              className={cn('pixel-button px-1 py-1 text-[10px] font-bold', stubOnly.has(i) === stub ? 'pick-on' : 'pick-off')}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="mt-2 grid gap-x-3 gap-y-2 sm:grid-cols-2">
                        <div className="min-w-0">
                          <p className="mb-1 text-[9px] text-mono uppercase tracking-widest text-muted-foreground">Read from the photo</p>
                          <dl className="space-y-0.5 text-[11px]">
                            <Read label="Paid by" value={txn.client} />
                            <Read label="Paid on" value={txn.date ? format(parseISO(txn.date), 'MMM d, yyyy') : ''} />
                            <Read label="Amount" value={`$${Math.abs(txn.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />
                            <Read label="What" value={txn.description} />
                            <Read label="Invoice" value={txn.invoiceNumber} />
                            <Read label="Hours" value={txn.breakdown?.length ? txn.breakdown.map(b => `${day(b.date)} ${b.hours} ${b.type}`).join(', ') : ''} />
                          </dl>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1 text-[9px] text-mono uppercase tracking-widest text-muted-foreground">Why it matches</p>
                          {link.job ? (
                            <>
                              <p className="text-[11px] font-semibold text-dot-paid">
                                {link.job.name} · {day(link.job.date)}
                                {link.job.payrollCompany ? <span className="font-normal text-muted-foreground"> · {link.job.payrollCompany}</span> : null}
                              </p>
                              {link.match && <p className="text-[10px] text-mono font-bold uppercase text-muted-foreground">{link.match.percent}% {link.match.level}</p>}
                              <ul className="mt-0.5 space-y-0.5 text-[10px]">
                                {link.reasons.map(r => <li key={r.text} className={r.good ? 'text-muted-foreground' : 'text-warning'}>{r.good ? '✓' : '✗'} {r.text}</li>)}
                              </ul>
                            </>
                          ) : (
                            <p className="text-[11px] text-warning">
                              No shift matches — it is saved on its own, under Payments with no shift, where it can be made into one.
                            </p>
                          )}
                          {leftOut[i]?.repeatOf !== undefined && (
                            <p className="mt-1.5 text-[11px] text-warning">
                              Same amount as the one above — likely the stub and its check, which are one payment.
                              Left out; tap to add it anyway.
                            </p>
                          )}
                          {leftOut[i]?.recorded && (
                            <p className="mt-1.5 text-[11px] text-warning">
                              Already in your payments ({leftOut[i].recorded!.date}). Left out; tap to add it anyway.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => { setOpen(false); reset(); }}><X size={14} className="mr-1" /> Cancel</Button>
              <Button onClick={addSelected} disabled={selected.size === 0 || isSaving}>
                {isSaving ? <><Loader2 size={14} className="mr-1 animate-spin" /> Saving...</> : <>Add {selected.size} income{selected.size !== 1 ? 's' : ''}</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
      </Dialog>
    </>
  );
}
