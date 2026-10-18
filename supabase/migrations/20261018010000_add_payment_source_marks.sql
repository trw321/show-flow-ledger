-- A pay stub and a cheque prove different things. A stub says what was earned
-- and what came out of it; a cheque only says what arrived. The app held one
-- image field for both and could not tell them apart.
alter table public.jobs
  add column if not exists pay_stub_kind text;

-- And a payment typed in by hand has had nothing checked against a document,
-- which is worth knowing when the figures disagree.
alter table public.income
  add column if not exists entered_by_hand boolean;
