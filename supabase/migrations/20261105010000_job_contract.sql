-- The contract a shift was dispatched under, as the dispatch names it. It
-- belongs to the shift alone: the same employer at the same venue can work
-- under a different contract from one call to the next.
alter table public.jobs add column if not exists contract text;
