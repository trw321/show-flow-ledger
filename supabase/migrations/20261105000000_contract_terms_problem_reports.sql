-- Contract terms an employer carries that had nowhere to live.
--  - contract: which built-in contract these terms came from (see contracts.ts).
--  - minimum_call_hours: what a new shift for this employer starts with.
--  - sixth_seventh_day: the 6th and 7th days in a row pay premium for this employer.
alter table public.employers
  add column if not exists contract text,
  add column if not exists minimum_call_hours numeric,
  add column if not exists sixth_seventh_day boolean;

-- What was happening when something went wrong: sent from the app's Report a
-- problem button, or by itself when the app crashes. Text only, no photos, and
-- never the contents of a form field.
create table if not exists public.problem_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind       text not null default 'report' check (kind in ('report', 'crash')),
  note       text,
  page       text,
  on_screen  text,
  trail      jsonb not null default '[]'::jsonb,
  device     jsonb,
  build      text,
  replay_url text,
  resolved   boolean not null default false
);

create index if not exists problem_reports_user_created on public.problem_reports (user_id, created_at desc);

alter table public.problem_reports enable row level security;

create policy "Users read own problem reports"
  on public.problem_reports for select using (auth.uid() = user_id);
create policy "Users insert own problem reports"
  on public.problem_reports for insert with check (auth.uid() = user_id);
