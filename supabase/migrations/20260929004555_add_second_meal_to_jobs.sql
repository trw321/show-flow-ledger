-- A day can carry two meals with independent terms: an hour off the clock at
-- lunch and half an hour on the clock later. meal_duration/meal_on_clock hold
-- the first; these hold the second. Both nullable, so every existing row and
-- every backup written before this stays valid.
alter table public.jobs
  add column if not exists meal2_duration smallint,
  add column if not exists meal2_on_clock boolean;
