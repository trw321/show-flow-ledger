import type { ProjectMatch } from './paymentMatch';
import type { Income, Job } from './store';

/**
 * What shows a payment was made, and that it paid this project.
 *
 * Proof is saved with the payment when it's matched: the photo, the score, the
 * reasons, and what the photo said. It's a record of why the match was made,
 * so it doesn't move about as the rest of the ledger changes. Payments from
 * before it was saved have none, and say so rather than borrow a guess.
 */

export type ProofKind = 'stub' | 'check' | 'statement' | 'deposit' | 'invoice' | 'manual' | 'marked' | 'unknown';

export interface MatchProof {
  kind: ProofKind;
  /** The match, as it was scored when the payment was linked. */
  percent?: number;
  level?: ProjectMatch['level'];
  reasons?: { text: string; good: boolean }[];
  /** What the photo said, to check against the payment. */
  read?: { amount?: number; payer?: string; date?: string };
  /** When it was matched. */
  at: string;
}

export const PROOF_LABELS: Record<ProofKind, string> = {
  stub: 'Pay stub',
  check: 'Check',
  statement: 'Statement',
  deposit: 'Bank deposit',
  invoice: 'Invoice',
  manual: 'Typed in',
  marked: 'Marked paid',
  unknown: 'Source not recorded',
};

/** A document someone else made says it was paid. Typed in or marked by you is your word for it. */
export const isDocumented = (kind: ProofKind) => kind !== 'manual' && kind !== 'marked' && kind !== 'unknown';

/**
 * How a payment came in: what was saved, or for an older one what its
 * description says. When nothing says, it says so: an older payment with a
 * bare description was not necessarily typed in.
 */
export function proofKindOf(i: Income): ProofKind {
  // Only a kind this version knows: one it doesn't is read like an older payment.
  if (i.matchProof?.kind && i.matchProof.kind in PROOF_LABELS && i.matchProof.kind !== 'unknown') return i.matchProof.kind;
  const what = (i.description ?? '').toLowerCase();
  if (/^invoice\b/.test(what)) return 'invoice';
  if (what === 'marked paid' || what.startsWith('payment — full project')) return 'marked';
  if (i.enteredByHand || what === 'added by hand' || what.startsWith('add hours')) return 'manual';
  // A check's number gets read as an invoice number, so the words come first.
  if (i.paymentMethod === 'check' || /\b(check|cheque)\b/.test(what)) return 'check';
  if (/\b(stub|earnings|pay statement)\b/.test(what)) return 'stub';
  // "PAYROLL" is how a bank names a payroll company's deposit ("ODEUM LABOR
  // SERV PAYROLL"), so on its own it's a deposit line, not a stub.
  if (i.paymentMethod === 'direct_deposit' || /\b(deposit|ach|transfer|payroll)\b/.test(what)) return 'deposit';
  if (i.invoiceNumber) return 'invoice';
  return 'unknown';
}

/** The match, kept as it was scored. */
export function proofFromMatch(kind: ProofKind, match?: Pick<ProjectMatch, 'percent' | 'level' | 'reasons'> & Partial<ProjectMatch> | null, read?: MatchProof['read']): MatchProof {
  return {
    kind,
    at: new Date().toISOString(),
    ...(match ? { percent: match.percent, level: match.level, reasons: match.reasons.map(r => ({ text: r.text, good: r.good })) } : {}),
    ...(read ? { read } : {}),
  };
}

/**
 * For a payment from before proof was saved: a photo on one of its project's
 * shifts that says the same amount, to the cent. Nothing looser counts: a
 * photo shown as proof has to be the payment's own.
 */
export function photoForOlderPayment(i: Income, project: Job[]): Job | undefined {
  if (i.proofRef) return undefined;
  const exact = project.filter(j => j.payStub && j.stubParsed?.netPay != null && Math.abs(j.stubParsed.netPay - i.amount) < 0.005);
  return exact.length === 1 ? exact[0] : undefined;
}

/** Whether the photo's amount agrees with the payment's. Undefined when the photo's amount isn't known. */
export function photoAgrees(i: Income): boolean | undefined {
  const said = Number(i.matchProof?.read?.amount);
  return i.matchProof?.read?.amount == null || Number.isNaN(said) ? undefined : Math.abs(said - i.amount) < 0.005;
}
