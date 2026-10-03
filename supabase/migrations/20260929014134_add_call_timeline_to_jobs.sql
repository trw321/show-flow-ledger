-- A day entered as a run of calls ("8-10, 11-3, 4-7") keeps the shorthand
-- itself, because the meals are derived from the gaps between the calls and a
-- gap can be any length — meal_duration only holds 0, 30, 45 or 60. The
-- companion array records which of those gaps were kept on the clock.
-- Both nullable: a single-call shift stores neither and behaves as before.
alter table public.jobs
  add column if not exists call_timeline text,
  add column if not exists call_gaps_on_clock jsonb;
