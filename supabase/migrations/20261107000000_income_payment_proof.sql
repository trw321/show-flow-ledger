-- What proves a payment, kept with the payment: its photo, and why it was
-- matched to the shift it paid, as it stood when it was matched.
alter table public.income add column if not exists proof_ref text;
alter table public.income add column if not exists match_proof jsonb;
comment on column public.income.proof_ref is 'The stub or check photo that proves this payment: a storage reference.';
comment on column public.income.match_proof is 'How the payment came in and why it matched its project, saved at the time: kind, percent, level, reasons, and what the photo said.';
