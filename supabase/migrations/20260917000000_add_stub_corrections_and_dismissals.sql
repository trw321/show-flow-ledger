-- Phase 4/5 of the pay stub work added two fields to the app's types after the
-- sync schema was built. Without columns for them a cloud backup would silently
-- drop accepted corrections and the suggestion dismissal cadence.

alter table public.jobs
  add column if not exists stub_corrections jsonb;

alter table public.employers
  add column if not exists dismissed_suggestions jsonb;
