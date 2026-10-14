-- Hours can be filled in before the day as a plan. They stay a plan — counting
-- toward nothing — until the shift is confirmed on or after the day it
-- happened. Null means the hours were entered after the fact and need no
-- confirming, which is every existing row.
alter table public.jobs
  add column if not exists hours_planned boolean;
