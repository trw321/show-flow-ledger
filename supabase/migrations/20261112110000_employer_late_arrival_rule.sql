alter table public.employers
  add column if not exists late_arrival_rule text
  check (late_arrival_rule is null or late_arrival_rule in ('actual_clock_in', 'scheduled_start'));