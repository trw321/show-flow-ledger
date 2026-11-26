import { useState, useRef, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import { useAuth } from '@/lib/AuthContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { bestProjectFor, payPeriodIn, rankedProjectsFor, settleReadYear, type FoundPayment, type MatchContext, type MatchShift, type ProjectMatch } from '@/lib/paymentMatch';
import { pdfToImageDataUrl } from '@/lib/pdfImage';
import { localToday } from '@/lib/today';
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
import { aiFetch } from '@/lib/aiSwitch';
import { roundHours } from '@/lib/hoursFormat';

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
  /** The date as the photo was read, when its year was corrected to match your shifts. */
  readAs?: string;
  /** The pay period a stub prints, when the reader found one. */
  payPeriodStart?: string;
  payPeriodEnd?: string;
  /** What the reader saw: a pay stub, a check, a bank deposit, a statement or an invoice. */
  kind?: 'stub' | 'check' | 'deposit' | 'statement' | 'invoice' | null;
}

/** The days a stub paid for: the reader's pay period, else one written into its description. */
export function periodOf(txn: ParsedIncome): { start: string; end: string } | undefined {
  if (txn.payPeriodStart && txn.payPeriodEnd && txn.payPeriodStart <= txn.payPeriodEnd) {
    return { start: txn.payPeriodStart, end: txn.payPeriodEnd };
  }
  return payPeriodIn(txn.description);
}

function foundPayment(txn: ParsedIncome): FoundPayment {
  const hoursOn = (txn.breakdown ?? []).map(b => b.date);
  return {
    amount: Math.abs(txn.amount),
    date: txn.date,
    payer: txn.client || undefined,
    hoursOn: hoursOn.length > 0 ? hoursOn : undefined,
    period: periodOf(txn),
  };
}

/**
 * The year a payment was read with, checked against your shifts. When it's
 * corrected, the stub's per-day dates move to the same year with it.
 */
export function withSettledYear(txn: ParsedIncome, jobs: Job[], today: string): ParsedIncome {
  const { date, readAs } = settleReadYear(txn.date, jobs, today);
  if (!readAs) return txn;
  const wrongYear = readAs.slice(0, 4);
  const moved = (d?: string) => (d && d.startsWith(wrongYear) ? date.slice(0, 4) + d.slice(4) : d);
  const breakdown = txn.breakdown?.map(b => ({ ...b, date: moved(b.date)! }));
  return { ...txn, date, readAs, breakdown, payPeriodStart: moved(txn.payPeriodStart), payPeriodEnd: moved(txn.payPeriodEnd) };
}

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
 * a project worked up to 45 days before it (or, when nothing fits there, up to
 * a year before), or a week after, scored on the
 * stub's hours, the amount, the payer and the timing. The reasons are shown
 * beside the photo, so a match can be checked instead of taken on trust.
 */
export function findLinkedJob(txn: ParsedIncome, ctx: MatchContext): PaymentLink {
  const best = bestProjectFor(foundPayment(txn), ctx);
  return best ? linkTo(best.project, best.match, ctx) : { job: null, reasons: [] };
}

function linkTo(project: Job[], match: ProjectMatch, ctx: MatchContext): PaymentLink {
  // Linked to its first counted day, else the first still owed, so it shows on
  // the right part of the run.
  const counted = match.shifts.find(s => s.counted)?.job;
  const owed = project.filter(j => effectiveHoursWorked(j) > 0 && !ctx.paidJobIds.has(j.id)).sort((a, b) => a.date.localeCompare(b.date));
  return { job: counted ?? owed[0] ?? project[0], reasons: match.reasons, match };
}

/** The projects a payment could have paid, best first, to pick from. */
export function matchOptions(txn: ParsedIncome, ctx: MatchContext): PaymentLink[] {
  return rankedProjectsFor(foundPayment(txn), ctx, 3).map(r => linkTo(r.project, r.match, ctx));
}

/** Which option starts picked: the best, unless even that is a poor fit. */
const firstChoice = (options: PaymentLink[]) => (options[0]?.match && options[0].match.level !== 'low' ? 0 : -1);

/** How a payment read off a photo came in. */
export function kindOfRead(txn: ParsedIncome, stubOnly: boolean): ProofKind {
  if (stubOnly) return 'stub';
  // The reader says what it looked at: a stub shows earnings and deductions,
  // a check is a check, a deposit is the net amount landing in the bank.
  if (txn.kind && ['stub', 'check', 'deposit', 'statement', 'invoice'].includes(txn.kind)) return txn.kind;
  const what = (txn.description ?? '').toLowerCase();
  if (/\b(check|cheque)\b/.test(what)) return 'check';
  // "PAYROLL" is how a bank names a payroll company's deposit, not a stub.
  if (/\b(deposit|ach|transfer|payroll)\b/.test(what)) return 'deposit';
  if (/\b(stub|earnings|pay statement)\b/.test(what)) return 'stub';
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

const dollars = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDay = (iso: string) => format(parseISO(iso), 'EEE MMM d');

/** "Oct 26 – Oct 27", or one day on its own. */
function daySpan(dates: string[]): string {
  if (dates.length === 0) return '';
  const sorted = [...dates].sort();
  return sorted[0] === sorted[sorted.length - 1] ? day(sorted[0]) : `${day(sorted[0])} – ${day(sorted[sorted.length - 1])}`;
}

/** The little labels on a shift in the fold-out list. */
function shiftTags(s: MatchShift): { text: string; good?: boolean }[] {
  const tags: { text: string; good?: boolean }[] = [];
  if (s.inPeriod === true) tags.push({ text: 'in pay period', good: true });
  if (s.inPeriod === false) tags.push({ text: 'outside pay period' });
  if (s.onStub === true) tags.push({ text: 'on the stub', good: true });
  if (s.paid) tags.push({ text: 'already paid' });
  if (s.expected === 0) tags.push({ text: 'no hours yet' });
  return tags;
}

/**
 * One project the payment could have paid: the score kind by kind, the days
 * its expected amount covers, and every shift in it, folded away until asked.
 */
function ProjectOption({ link, amount, chosen, onChoose }: { link: PaymentLink; amount: number; chosen: boolean; onChoose: () => void }) {
  const [open, setOpen] = useState(false);
  const m = link.match;
  if (!m) return null;
  const lead = m.shifts[0]?.job;
  const counted = m.shifts.filter(s => s.counted);
  const gap = amount - m.expected;
  const tone = m.level === 'high' ? 'text-dot-paid' : m.level === 'medium' ? 'text-warning' : 'text-destructive';
  return (
    <div className={cn('border p-2 transition-colors', chosen ? 'border-dot-paid bg-dot-paid/10' : 'border-border')}>
      <button type="button" onClick={onChoose} aria-pressed={chosen} className="flex w-full items-start gap-2 text-left">
        <span className={cn('mt-1 h-3 w-3 shrink-0 rounded-full border-2', chosen ? 'border-dot-paid bg-dot-paid' : 'border-muted-foreground')} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold">{lead ? `${lead.name} · ${lead.client}` : 'Project'}</span>
          <span className="block text-[10px] text-mono text-muted-foreground">
            {daySpan(m.shifts.map(s => s.job.date))} · {m.shifts.length} shift{m.shifts.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className={cn('shrink-0 text-[11px] font-bold text-mono uppercase', tone)}>{m.percent}% {m.level}</span>
      </button>

      {m.farBack && (
        <p className="mt-1 text-[10px] text-warning">
          Found by looking further back: nothing fit in the 45 days before the payment, so shifts up to a year back were checked.
        </p>
      )}

      {/* What the amount is checked against, by date, since dates are what tie a payment to work. */}
      <p className="mt-1.5 text-[11px] text-mono">
        {dollars(m.expected)} expected for {counted.length ? counted.map(s => day(s.job.date)).join(', ') : 'these shifts'}
        <span className={cn('ml-1', Math.abs(gap) <= Math.max(1, m.expected * 0.02) ? 'text-dot-paid' : 'text-warning')}>
          · paid {dollars(amount)} ({gap >= 0 ? '+' : '−'}{dollars(Math.abs(gap))})
        </span>
      </p>

      <dl className="mt-1.5 space-y-1.5">
        {m.parts.map(p => (
          <div key={p.label} className="text-[10px] leading-snug">
            <div className="flex items-baseline justify-between gap-2 border-b border-border/40">
              <dt className="uppercase tracking-wider text-muted-foreground">{p.label}</dt>
              <dd className={cn('text-mono font-bold', p.of > 0 && p.points >= p.of * 0.7 ? 'text-dot-paid' : p.points > 0 ? 'text-warning' : 'text-destructive')}>
                {p.points < 0 ? '−' + Math.abs(p.points) : p.points}/{p.of}
              </dd>
            </div>
            <dd className="mt-0.5 min-w-0">
              {p.reasons.map(r => <span key={r.text} className={cn('block', r.good ? 'text-foreground/80' : 'text-warning')}>{r.good ? '✓' : '✗'} {r.text}</span>)}
            </dd>
          </div>
        ))}
      </dl>

      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-1.5 text-[10px] text-mono uppercase tracking-wider text-primary">
        {open ? '▴ Hide' : '▾ Show'} the {m.shifts.length} shift{m.shifts.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ul className="mt-1 divide-y divide-border/60 border-t border-border/60">
          {m.shifts.map(s => (
            <li key={s.job.id} className={cn('py-1 text-[10px]', s.counted ? '' : 'opacity-60')}>
              <div className="flex items-baseline gap-3">
                <span className="text-mono font-semibold">{shortDay(s.job.date)}</span>
                <span className="text-mono">{s.job.hoursWorked ? `${roundHours(s.job.hoursWorked)}h` : s.expected > 0 ? 'from clock times' : 'no hours'}</span>
                <span className="ml-auto text-mono">{s.expected > 0 ? dollars(s.expected) : ''}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {shiftTags(s).map(t => (
                  <span key={t.text} className={cn('border px-1 uppercase tracking-wide', t.good ? 'border-dot-paid/60 text-dot-paid' : 'border-border text-muted-foreground')}>{t.text}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
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
  // Up to three projects each payment could have paid, and which one is picked
  // (-1: none, saved without a shift).
  const [options, setOptions] = useState<PaymentLink[][]>([]);
  const [choice, setChoice] = useState<number[]>([]);
  const links: PaymentLink[] = useMemo(
    () => options.map((o, i) => o[choice[i]] ?? { job: null, reasons: [] }),
    [options, choice],
  );
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
    setTransactions([]); setOptions([]); setChoice([]); setSelected(new Set()); setLeftOut([]); setStubOnly(new Set());
    setPreview(null); setEditing(null); setPhotoBig(false);
  };

  // A photo goes to the editor before anything else happens, so whatever is
  // blacked out there never reaches the reader, or anywhere else.
  const pickFile = async (file: File) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf && !file.type.startsWith('image/')) { toast.error('Please upload an image or a PDF'); return; }
    if (file.size > 15 * 1024 * 1024) { toast.error('File too large (max 15MB)'); return; }
    reset();
    if (isPdf) {
      // The reader only takes pictures, so a PDF's pages become one image first.
      try {
        const { dataUrl, truncated } = await pdfToImageDataUrl(file);
        if (truncated) toast.info('Only the first pages of the PDF were read');
        setOpen(true); setEditing(dataUrl);
      } catch (err) {
        console.error(err);
        toast.error('Could not open that PDF');
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setOpen(true); setEditing(reader.result as string); };
    reader.readAsDataURL(file);
  };

  /** A correction to what was read: the matches are worked out again from it. */
  const updateTxn = (i: number, patch: Partial<ParsedIncome>) => {
    const next = transactions.map((t, j) => (j === i ? { ...t, ...patch, ...(patch.date ? { readAs: undefined } : {}) } : t));
    const fresh = matchOptions(next[i], matchCtx);
    setTransactions(next);
    setOptions(prev => prev.map((o, j) => (j === i ? fresh : o)));
    setChoice(prev => prev.map((c, j) => (j === i ? firstChoice(fresh) : c)));
  };

  const readStatement = async (edited: string) => {
    setEditing(null);
    setPreview(edited);
    setLoading(true);
    try {
      const blob = await (await fetch(edited)).blob();
      const { base64, mimeType } = await resizeImageToBase64(new File([blob], 'statement.jpg', { type: blob.type || 'image/jpeg' }));

      const resp = await aiFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-statement`, {
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
      const today = localToday();
      const txns: ParsedIncome[] = (responseData.transactions || []).map((t: ParsedIncome) => withSettledYear(t, data.jobs, today));
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
      const found = txns.map(t => matchOptions(t, matchCtx));
      setOptions(found);
      setChoice(found.map(firstChoice));
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
        accept="image/*,application/pdf"
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
          {dragging ? '' : 'check, pay stub, invoice or bank statement · photo or PDF · drag & drop or click'}
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
            <div className={cn('grid gap-3 items-start', photoBig ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]')}>
              {preview && (
                <button type="button" onClick={() => setPhotoBig(b => !b)} className="sm:sticky sm:top-0 text-left">
                  <img src={preview} alt="The statement, as it was read" className={cn("w-full border border-border object-contain object-left", photoBig ? "" : "max-h-48 sm:max-h-none")} />
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

                      <div className="mt-2 space-y-3">
                        <div className="min-w-0">
                          <p className="mb-1 neon-label text-[hsl(188_95%_72%)]">Read from the photo · fix anything it got wrong</p>
                          <dl className="space-y-1 text-[11px]">
                            <Read label="Paid by" value={txn.client} />
                            <div className="flex flex-wrap items-center gap-1.5">
                              <dt className="shrink-0 text-muted-foreground">Paid on</dt>
                              <dd>
                                <input
                                  type="date"
                                  value={txn.date}
                                  onChange={e => e.target.value && updateTxn(i, { date: e.target.value })}
                                  className="border border-border bg-background px-1.5 py-0.5 text-[11px] text-mono"
                                  aria-label="Date paid"
                                />
                              </dd>
                              <dt className="shrink-0 text-muted-foreground ml-2">Amount</dt>
                              <dd>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  defaultValue={Math.abs(txn.amount).toFixed(2)}
                                  onBlur={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0 && n !== Math.abs(txn.amount)) updateTxn(i, { amount: n }); }}
                                  className="w-24 border border-border bg-background px-1.5 py-0.5 text-[11px] text-mono"
                                  aria-label="Amount paid"
                                />
                              </dd>
                            </div>
                            {txn.readAs && (
                              <p className="text-[10px] text-warning">The photo read the year as {txn.readAs.slice(0, 4)}; changed to match your shifts.</p>
                            )}
                            {(() => {
                              const p = periodOf(txn);
                              return <Read label="Pay period" value={p ? `${format(parseISO(p.start), 'EEE MMM d')} – ${format(parseISO(p.end), 'EEE MMM d, yyyy')}` : ''} />;
                            })()}
                            <Read label="What" value={txn.description} />
                            <Read label="Invoice" value={txn.invoiceNumber} />
                            <Read label="Hours" value={txn.breakdown?.length ? txn.breakdown.map(b => `${day(b.date)} ${b.hours} ${b.type}`).join(', ') : ''} />
                          </dl>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1 neon-label text-[hsl(188_95%_72%)]">Which project it paid · tap to pick</p>
                          {(options[i] ?? []).length > 0 ? (
                            <div className="space-y-1.5">
                              {options[i].map((opt, k) => (
                                <ProjectOption
                                  key={opt.match?.shifts[0]?.job.id ?? k}
                                  link={opt}
                                  amount={Math.abs(txn.amount)}
                                  chosen={choice[i] === k}
                                  onChoose={() => setChoice(prev => prev.map((c, j) => (j === i ? k : c)))}
                                />
                              ))}
                              <button
                                type="button"
                                aria-pressed={choice[i] === -1}
                                onClick={() => setChoice(prev => prev.map((c, j) => (j === i ? -1 : c)))}
                                className={cn('w-full border px-2 py-1.5 text-left text-[11px]', choice[i] === -1 ? 'border-foreground/60 bg-foreground/5 font-semibold' : 'border-border text-muted-foreground')}
                              >
                                None of these: save it without a shift
                              </button>
                            </div>
                          ) : (
                            <p className="text-[11px] text-warning">
                              No shift was worked in the year before this date{periodOf(txn) ? ' or in its pay period' : ''}, so it is saved on its own, under Payments with no shift, where it can be made into one.
                            </p>
                          )}
                          {!link.job && (options[i] ?? []).length > 0 && (
                            <p className="mt-1 text-[10px] text-muted-foreground">Nothing picked: it will be saved without a shift.</p>
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
