-- A flat amount for the day instead of an hourly rate. It covers a set number
-- of hours and is paid in full however short the day was; hours past it are
-- overtime at the hourly equivalent.
--
-- On the employer as the default a new shift starts from, and on the shift
-- itself because every project is its own contract and can differ.
alter table public.employers
  add column if not exists default_day_rate numeric,
  add column if not exists day_rate_hours numeric;

alter table public.jobs
  add column if not exists day_rate numeric,
  add column if not exists day_rate_hours numeric;
