import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Banknote, Camera, FileText, Landmark, Loader2, PenLine, Receipt, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PayEstimateCard from '@/components/PayEstimateCard';
import StubEditor from '@/components/StubEditor';
import { useAuth } from '@/lib/AuthContext';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { readFileAsDataUrl, resizeImageForStorage } from '@/lib/imageResize';
import { explainPay } from '@/lib/payExplain';
import { matchPaymentToProject } from '@/lib/paymentMatch';
import { paidShiftIds, shiftsPaidBy } from '@/lib/payPeriods';
import { isDocumented, photoAgrees, photoForOlderPayment, PROOF_LABELS, proofFromMatch, proofKindOf, type ProofKind } from '@/lib/paymentProof';
import { projectOf } from '@/lib/projectGrouping';
import type { Income } from '@/lib/store';
import { stubViewUrl, uploadStub } from '@/lib/stubStorage';
import { cn } from '@/lib/utils';

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => format(parseISO(iso), 'MMM d');

const KIND_ICON: Record<ProofKind, typeof Wallet> = {
  stub: Receipt, check: Banknote, statement: FileText, deposit: Landmark, invoice: FileText, manual: PenLine, marked: Wallet,
};

const LEVEL_TONE = { high: 'text-dot-paid', medium: 'text-dot-pending', low: 'text-warning' } as const;
const LEVEL_BAR = { high: 'bg-dot-paid', medium: 'bg-dot-pending', low: 'bg-warning' } as const;

/**
 * One payment, in a line: what it is, and how well it's known to be this
 * project's. Tapping it opens the proof.
 */
export function ProofRow({ income, onOpen }: { income: Income; onOpen: () => void }) {
  const kind = proofKindOf(income);
  const Icon = KIND_ICON[kind];
  const m = income.matchProof;
  const verdict = !isDocumented(kind)
    ? 'no proof'
    : m?.level ? `${m.percent}% ${m.level}`
    : income.proofRef ? 'photo' : 'not scored';
  return (
    <button
      type="button"
      data-testid="proof-row"
      onClick={e => { e.stopPropagation(); onOpen(); }}
      className="flex w-full items-center gap-1.5 text-left text-[11px] text-mono hover:underline"
    >
      <Icon size={12} aria-hidden className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{PROOF_LABELS[kind]} · {money(income.amount)}</span>
      <span className={cn('shrink-0 uppercase', m?.level && isDocumented(kind) ? LEVEL_TONE[m.level] : 'text-muted-foreground')}>{verdict}</span>
      <span className="shrink-0 text-muted-foreground">Proof ›</span>
    </button>
  );
}

/**
 * Everything that shows a payment was made and that it paid this project: the
 * stub or check itself, whether its amount agrees, every reason it was matched,
 * the estimate beside what came in, and the days it paid for.
 */
export default function PaymentProof({ income, onClose }: { income: Income; onClose: () => void }) {
  const { data, updateIncome } = useData();
  const { prefs } = useUserPrefs();
  const { user } = useAuth();
  const live = data.income.find(i => i.id === income.id) ?? income;
  const kind = proofKindOf(live);
  const Icon = KIND_ICON[kind];
  const shift = data.jobs.find(j => j.id === live.jobId);
  const project = useMemo(() => (shift ? projectOf(shift, data.jobs, data.employers) : []), [shift, data.jobs, data.employers]);
  const covers = useMemo(() => shiftsPaidBy(live, data.jobs, data.income, data.employers, prefs.payer), [live, data.jobs, data.income, data.employers, prefs.payer]);
  const paidIds = useMemo(() => paidShiftIds(data.jobs, data.income, data.employers, prefs.payer), [data.jobs, data.income, data.employers, prefs.payer]);

  // The photo: its own, or for an older payment one on the project that says the same amount.
  const older = photoForOlderPayment(live, project);
  const photoRef = live.proofRef ?? older?.payStub;
  const [photo, setPhoto] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    let current = true;
    setPhoto(null);
    void stubViewUrl(photoRef).then(url => { if (current) setPhoto(url); });
    return () => { current = false; };
  }, [photoRef]);

  // Why it's this project: as scored when it was linked, or for an older one worked out now.
  const saved = live.matchProof?.reasons ? live.matchProof : undefined;
  const now = useMemo(() => (
    saved || kind === 'marked' || project.length === 0 ? null
      : matchPaymentToProject({ amount: live.amount, date: live.date, payer: live.client }, project, { allJobs: data.jobs, employers: data.employers, payer: prefs.payer, paidJobIds: paidIds })
  ), [saved, kind, project, live, data.jobs, data.employers, prefs.payer, paidIds]);
  const why = saved ?? (now ? { percent: now.percent, level: now.level, reasons: now.reasons } : undefined);

  const stubOnFile = older?.stubParsed ?? covers.find(j => j.stubParsed?.netPay != null && Math.abs(j.stubParsed.netPay - live.amount) < 0.005)?.stubParsed;
  const explanation = covers.length > 0
    ? explainPay({ received: live.amount, stub: stubOnFile ?? null, jobs: covers, allJobs: data.jobs, employers: data.employers, payer: prefs.payer })
    : null;
  const agrees = photoAgrees(live);

  // Adding the stub or check to a payment that has none.
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState<'stub' | 'check' | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attach = async (edited: string) => {
    setEditing(null);
    if (!user) { toast.error('Sign in to keep photos with payments'); return; }
    setBusy(true);
    try {
      const blob = await (await fetch(edited)).blob();
      const small = await resizeImageForStorage(new File([blob], 'proof.jpg', { type: blob.type || 'image/jpeg' }));
      const ref = await uploadStub(small, user.id, `proof-${live.id}`);
      if (!ref) { toast.error("Couldn't save the photo. Try again."); return; }
      // Read it, so its amount can be checked against the payment's.
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-statement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ imageBase64: small.split(',')[1], mimeType: 'image/jpeg', type: 'income' }),
      }).catch(() => null);
      const txn = resp?.ok ? (await resp.json()).transactions?.[0] : undefined;
      const read = txn ? { amount: Math.abs(Number(txn.amount)), payer: txn.client, date: txn.date } : undefined;
      const hoursOn = (txn?.breakdown ?? []).map((b: { date: string }) => b.date);
      const match = project.length > 0
        ? matchPaymentToProject({ amount: live.amount, date: live.date, payer: txn?.client ?? live.client, hoursOn: hoursOn.length ? hoursOn : undefined }, project, { allJobs: data.jobs, employers: data.employers, payer: prefs.payer, paidJobIds: paidIds })
        : null;
      await updateIncome(live.id, { proofRef: ref, matchProof: proofFromMatch(adding ?? 'stub', match, read) });
      toast.success(read?.amount != null && Math.abs(read.amount - live.amount) >= 0.005
        ? `Photo added. It says ${money(read.amount)}, not ${money(live.amount)}.`
        : 'Photo added');
    } finally {
      setBusy(false);
      setAdding(null);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-2xl" data-testid="payment-proof">
        <DialogHeader>
          <DialogTitle className="text-mono text-sm uppercase tracking-widest">Payment proof</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-2xl font-bold text-mono">{money(live.amount)}</p>
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-mono text-muted-foreground"><Icon size={12} aria-hidden /> {PROOF_LABELS[kind]}</span>
            </div>
            <p className="text-[11px] text-mono text-muted-foreground">
              {day(live.date)}{live.client ? ` · paid by ${live.client}` : ''} · {live.status === 'paid' ? 'money in' : 'coming'}
            </p>
          </div>

          {/* The document itself. */}
          {photoRef ? (
            <div className="space-y-1">
              {photo ? (
                <button type="button" onClick={() => setBig(b => !b)} className="block w-full">
                  <img src={photo} alt="The stub or check for this payment" className={cn('w-full border border-border object-contain', big ? '' : 'max-h-56')} />
                </button>
              ) : (
                <div className="flex h-24 items-center justify-center border border-border text-[11px] text-muted-foreground">Loading the photo…</div>
              )}
              <p className="text-[10px] text-muted-foreground">
                {live.proofRef ? 'The photo it was added with.' : `On the ${day(older!.date)} shift. Its amount matches this payment to the cent.`}
                {photo ? (big ? ' Tap to shrink.' : ' Tap to enlarge.') : ''}
              </p>
            </div>
          ) : (
            <div className="space-y-2 border border-dashed border-border p-3">
              <p className="text-[11px] text-muted-foreground">
                {kind === 'marked'
                  ? 'Marked paid by you, at the estimate. Nothing was checked against a stub or a check.'
                  : kind === 'manual' ? 'Typed in by you. No stub or check photo with it.'
                  : 'No photo of this one was kept.'}
              </p>
              {busy ? (
                <p className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Reading the photo…</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {(['stub', 'check'] as const).map(k => (
                    <button key={k} type="button" onClick={() => { setAdding(k); fileRef.current?.click(); }}
                      className="pixel-button pick-off flex items-center justify-center gap-1 py-1.5 text-[11px] font-bold">
                      <Camera size={12} /> Add {k === 'stub' ? 'stub' : 'check'}
                    </button>
                  ))}
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async e => {
                const file = e.target.files?.[0];
                e.currentTarget.value = '';
                if (file) setEditing(await readFileAsDataUrl(file));
              }} />
            </div>
          )}

          {agrees !== undefined && (
            <p className={cn('text-[11px] font-semibold', agrees ? 'text-dot-paid' : 'text-warning')}>
              {agrees
                ? `✓ Read off the ${PROOF_LABELS[kind].toLowerCase()}: ${money(live.matchProof!.read!.amount!)}, the same as the payment.`
                : `Read off the ${PROOF_LABELS[kind].toLowerCase()}: ${money(live.matchProof!.read!.amount!)}. The payment is ${money(live.amount)}.`}
            </p>
          )}

          {/* Why it's this project. */}
          <div className="space-y-1.5">
            <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground">Why this project</p>
            {why?.level ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 bg-secondary" aria-hidden>
                    <div className={cn('h-full', LEVEL_BAR[why.level])} style={{ width: `${why.percent ?? 0}%` }} />
                  </div>
                  <span className={cn('shrink-0 text-[11px] text-mono font-bold uppercase', LEVEL_TONE[why.level])}>{why.percent}% {why.level}</span>
                </div>
                <ul className="space-y-0.5 text-[11px]">
                  {(why.reasons ?? []).map(r => (
                    <li key={r.text} className={r.good ? 'text-foreground/85' : 'text-warning'}>{r.good ? '✓' : '✗'} {r.text}</li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted-foreground">
                  {saved ? `Scored ${day(saved.at.slice(0, 10))}, when it was matched.` : 'Worked out now. This payment is from before reasons were kept.'}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {kind === 'marked' ? 'Nothing to score: it was marked paid by hand.' : 'Not linked to a shift, so there is no project to score it against.'}
              </p>
            )}
          </div>

          {explanation && (
            <div className="space-y-1">
              <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground">Estimate against what came in</p>
              <PayEstimateCard explanation={explanation} covers={covers} />
            </div>
          )}

          {covers.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground">The days it paid</p>
              <p className="text-[11px] text-mono">{covers.map(j => day(j.date)).join(' · ')}</p>
            </div>
          )}
        </div>

        {editing && <StubEditor source={editing} onCancel={() => { setEditing(null); setAdding(null); }} onDone={edited => void attach(edited)} />}
      </DialogContent>
    </Dialog>
  );
}
