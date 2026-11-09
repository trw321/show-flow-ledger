-- A composite team call (IATSE Local 16): lunch after four hours, a meal
-- penalty for working past four unfed, and Saturdays at time and a half,
-- Sundays at double time, all day. Ticked by hand on the shift.
alter table public.jobs add column if not exists composite_team boolean;

comment on column public.jobs.composite_team is
  'Composite team call: lunch after 4 hours, Saturday 1.5x and Sunday 2x all day.';
