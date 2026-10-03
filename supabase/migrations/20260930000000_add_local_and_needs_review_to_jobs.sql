-- An IA8 offer names three different parties: the local that dispatched you
-- ("ia8"), the employer who pays ("Elliott Lewis"), and sometimes a separate
-- payroll agency. The employer lives in `client` because that is what the pay
-- engine resolves rates from; this holds the local.
-- needs_review flags a shift to come back to — set by hand, and set for you
-- when the payroll company was assumed to be the employer rather than stated.
alter table public.jobs
  add column if not exists local text,
  add column if not exists needs_review boolean;
