// /types/labor.ts
//
// Types for the labor domain: parties, gigs, payments, allocations,
// match suggestions. Pairs with /types/contracts.ts.

import type { ContractSnapshot } from './contracts';

export type GigStatus = 'offered' | 'scheduled' | 'completed' | 'cancelled';

export type PaymentInputMode =
  | 'quick_entry'
  | 'manual'
  | 'pay_stub_photo'
  | 'imported';

export type PaymentDataCompleteness =
  | 'amount_only'
  | 'gross_net'
  | 'full';

export type MatchConfidence = 'high' | 'medium' | 'low' | 'manual';

export type AllocationType = 'normal' | 'correction' | 'partial';

export type MatchSuggestionStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'manual_override';

/**
 * Any entity you've worked with: production companies, employers,
 * payroll services, individuals. Same party can play different
 * roles on different gigs (hiring, employer, payor).
 */
export interface Party {
  id: string;
  user_id: string;
  name: string;
  payor_aliases: string[];
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  estimated_withholding_rate: number | null;
  default_contract_id: string | null;
  local_chapter: string | null;
  badge_color: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Gig {
  id: string;
  user_id: string;

  // Three party roles
  hiring_party_id: string | null;
  employer_party_id: string | null;
  payor_party_id: string | null;

  // Contract and snapshot
  contract_version_id: string | null;
  contract_snapshot: ContractSnapshot | null;

  // Dispatch metadata
  job_number: string | null;
  position_name: string | null;
  is_head: boolean;
  show_name: string | null;
  venue: string | null;
  job_site: string | null;
  dress_code: string | null;
  steward_name: string | null;
  line_notes: string | null;

  // Time facts
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  meals_on_clock: boolean;
  worked_hours: number | null;

  // Call-type facts
  is_split: boolean;
  split_related_gig_id: string | null;
  minimum_hours: number | null
