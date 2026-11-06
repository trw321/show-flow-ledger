-- Any day an employer's pay period started on. With the schedule, it says where
-- every period falls, so a project crossing from one into the next can be seen.
alter table public.employers add column if not exists pay_period_start date;

-- Meals past the second, on a long day. Each is { duration, onClock }.
alter table public.jobs add column if not exists extra_meals jsonb;
