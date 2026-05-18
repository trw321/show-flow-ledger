// /lib/payroll/matching.ts

import type { Party, Gig, Payment, MatchCandidate } from '@/types/labor';
import { differenceInDays } from 'date-fns';

export interface MatchingInput {
  payment: Payment;
  parties: Party[];
  candidate_gigs: Gig[];           // unpaid/partial gigs to consider
  date_window_days?: number;       // default 21
  amount_tolerance?: number;       // default $5
}

/**
 * Produce ranked match candidates for a payment against candidate gigs.
 * Returns 0-N candidates, each with a confidence score and reasoning.
 */
export function generateMatchCandidates(input: MatchingInput): MatchCandidate[] {
  const { payment, parties, candidate_gigs } = input;
  const dateWindow = input.date_window_days ?? 21;
  const amountTolerance = input.amount_tolerance ?? 5;
  
  // 1. Filter to gigs with matching payor (via aliases) and date proximity
  const payorMatched = filterByPayor(payment, candidate_gigs, parties);
  const dateMatched = filterByDateWindow(
    payorMatched,
    new Date(payment.received_date),
    dateWindow
  );
  
  if (dateMatched.length === 0) return [];
  
  // 2. Search for single-gig matches
  const singleMatches = findSingleGigMatches(
    payment.amount_received,
    dateMatched,
    amountTolerance,
    parties
  );
  
  // 3. Search for multi-gig combinations (cap at 4 for tractability)
  const multiMatches = findCombinationMatches(
    payment.amount_received,
    dateMatched,
    amountTolerance,
    4
  );
  
  // 4. Score and rank all candidates
  const all = [...singleMatches, ...multiMatches];
  return all.sort((a, b) => b.confidence_score - a.confidence_score).slice(0, 3);
}

function filterByPayor(payment: Payment, gigs: Gig[], parties: Party[]): Gig[] {
  const payorString = payment.payor_raw_string?.toLowerCase() ?? '';
  const directMatch = payment.payor_party_id;
  
  // Direct FK match first
  if (directMatch) {
    return gigs.filter(g => g.payor_party_id === directMatch);
  }
  
  // Alias match: find parties whose aliases match the raw string
  const matchingParties = parties.filter(p =>
    p.payor_aliases.some(alias => alias.toLowerCase() === payorString) ||
    p.name.toLowerCase() === payorString
  );
  const matchingPartyIds = new Set(matchingParties.map(p => p.id));
  
  return gigs.filter(g =>
    g.payor_party_id != null && matchingPartyIds.has(g.payor_party_id)
  );
}

function filterByDateWindow(gigs: Gig[], paymentDate: Date, windowDays: number): Gig[] {
  return gigs.filter(g => {
    if (!g.expected_pay_date) return true; // include if we don't know
    const diff = Math.abs(differenceInDays(paymentDate, new Date(g.expected_pay_date)));
    return diff <= windowDays;
  });
}

function findSingleGigMatches(
  amount: number,
  gigs: Gig[],
  tolerance: number,
  parties: Party[]
): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (const gig of gigs) {
    const expected = gig.expected_pay ?? 0;
    if (expected <= 0) continue;
    
    const diff = Math.abs(amount - expected);
    if (diff <= tolerance) {
      const confidence = diff < 0.01 ? 0.95 : 0.75;
      candidates.push({
        gig_ids: [gig.id],
        amounts: [amount],
        confidence_score: confidence,
        confidence_label: diff < 0.01 ? 'high' : 'medium',
        reasoning: diff < 0.01
          ? `Exact match for gig ${formatGig(gig)}`
          : `Approximate match for gig ${formatGig(gig)} (off by $${diff.toFixed(2)})`,
      });
    }
    
    // Check net-of-withholding match (rough)
    // Skipped here for brevity; production version would use party's
    // estimated_withholding_rate to check if amount ≈ expected × (1 - rate)
  }
  return candidates;
}

function findCombinationMatches(
  amount: number,
  gigs: Gig[],
  tolerance: number,
  maxCombo: number
): MatchCandidate[] {
  // Subset-sum search up to maxCombo
  const results: MatchCandidate[] = [];
  
  function search(start: number, combo: Gig[], sum: number) {
    if (combo.length > maxCombo) return;
    if (combo.length >= 2 && Math.abs(sum - amount) <= tolerance) {
      results.push({
        gig_ids: combo.map(g => g.id),
        amounts: combo.map(g => g.expected_pay ?? 0),
        confidence_score: 0.6,
        confidence_label: 'medium',
        reasoning: `Combination of ${combo.length} gigs summing to $${sum.toFixed(2)}`,
      });
    }
    for (let i = start; i < gigs.length; i++) {
      const expected = gigs[i].expected_pay ?? 0;
      if (expected <= 0) continue;
      search(i + 1, [...combo, gigs[i]], sum + expected);
    }
  }
  
  search(0, [], 0);
  return results.slice(0, 5); // cap results
}

function formatGig(gig: Gig): string {
  return `${gig.work_date} ${gig.show_name ?? gig.position_name ?? '(unnamed)'}`;
}
