# Phase A: Contract Domain Foundation

## What this is

Phase A introduces the contract and contract-version concepts as
first-class database entities. This is the architectural foundation
for labor-rule modeling: later gigs and payroll calculations need a
stable, dated source of terms. Nothing else changes.

## What was added

### Database
- `contracts` table — identity of labor agreements, separate from the
   employer or venue because one employer can work under several agreements
- `contract_versions` table — versioned rules (rates, OT, meal penalty,
   fringe, rounding, minimums, turnaround, forced call, pay schedule), so
   changes over time do not rewrite the terms of past work
- `set_updated_at()` Postgres function (if not already present)
- Updated_at triggers on both new tables, so edits have reliable timestamps
- RLS policies — user-scoped via `auth.uid()`, so one account cannot read or
   alter another account's contract data
- `employers.default_contract_id` column — only if `employers` table
   already existed in the DB; this is a convenience default, not a rule that
   forces every call for that employer to use the same contract

### Codebase
- `/types/contracts.ts` — TypeScript types for `Contract`,
   `ContractVersion`, `OvertimeTier`, and `ContractSnapshot`, so app code can
   represent the persisted rules without untyped JSON or duplicated shapes

## What is intentionally NOT in this phase

- No new `employers`, `gigs`, `payments`, `allocations`, `discrepancies`,
  or `union_dues` tables
- No backfill of any kind
- No changes to `jobs`, `income`, `expenses`, or `equipment`
- No calculation engine code
- No UI

The existing bookkeeping app (jobs/income/expenses/equipment) continues
to function exactly as before. Nothing reads from the new tables yet.

## How to apply

1. Open Supabase SQL Editor
2. Paste the contents of the Phase A migration SQL
3. Run
4. Verify both `contracts` and `contract_versions` appear in Table Editor
5. Drop `/types/contracts.ts` into the repo at the indicated path

## How to validate

Through the Supabase Table Editor:

1. Insert a test contract:
   - `name`: "Test Local 8 Yellow Card"
   - `local_chapter`: "Local 8"
   - `contract_type`: `union_yellow_card`
2. Insert a test contract version pointing at that contract:
   - `version_label`: "2024-2027"
   - `effective_date`: "2024-08-01"
   - `rate_type`: "hourly"
   - `hourly_rate`: 45.00
   - `overtime_tiers`: `[{"after_hours": 8, "multiplier": 1.5}]`
   - `rounding`: "hour_up"
   - `minimum_call_hours`: 4
   - `meal_penalty_due_after_hours`: 5
   - `meal_penalty_rate_type`: "straight_time"
   - `fringe_percent`: 8
   - `fringe_in_check`: true
   - `pay_schedule`: "biweekly"
3. Confirm both rows save and that RLS prevents access from a different
   user account (if you have a way to test that)
4. Delete the test rows when satisfied

## What comes next

Phase B (next, when ready):
- Add the rest of the labor-model tables: `employers`, `gigs`,
   `payments`, `payment_allocations`, `union_dues`, `discrepancies` —
   these give each work record, incoming payment, deduction, and mismatch a
   clear home instead of overloading the bookkeeping tables
- Wire up the contract snapshot column on `gigs` — the gig must retain the
   exact terms it was created under even after a contract is edited
- Build the contract-version resolver (given a work date, find the
   applicable version) — calculations need deterministic rules for that date,
   not whichever version happens to be current today

Phase C:
- Build out `/lib/payroll/` calculation engine on top of the new schema —
   rates, overtime, meals, dues, and rounding should come from the gig's
   applicable contract rather than scattered employer defaults
- Snapshot logic on gig creation — capture the resolved version once, so
   later edits cannot silently change an existing gig's expected pay

Phase D:
- UI for managing contracts and versions — users need a safe way to maintain
   the rules the engine will rely on
- UI for logging gigs against them — users need to choose or review the
   agreement for each call, since it can vary even for the same employer

Phase E (much later):
- Migrate historical `jobs` data into `gigs` one at a time with
   inferred contracts (manual, not bulk) — old records are incomplete or
   ambiguous, so review avoids silently assigning the wrong labor rules
