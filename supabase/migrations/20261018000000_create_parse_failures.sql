-- Every time the parser gets it wrong, with the text that beat it.
--
-- Two kinds land here. A HARD failure is the model erroring or returning
-- nothing. A SOFT one is the user reaching for a smarter model, or correcting
-- what came back — the parse "worked" and was still wrong, which is the kind
-- that quietly costs a shift. Both are worth the same look.
create table if not exists public.parse_failures (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  source        text not null,
  kind          text not null,
  input_text    text,
  model         text,
  effort        text,
  classified_as text,
  result_count  integer,
  error_message text,
  resolved      boolean not null default false,
  notes         text
);

create index if not exists parse_failures_user_created
  on public.parse_failures (user_id, created_at desc);

alter table public.parse_failures enable row level security;

create policy "Users read own parse failures"
  on public.parse_failures for select using (auth.uid() = user_id);
create policy "Users insert own parse failures"
  on public.parse_failures for insert with check (auth.uid() = user_id);
create policy "Users update own parse failures"
  on public.parse_failures for update using (auth.uid() = user_id);
create policy "Users delete own parse failures"
  on public.parse_failures for delete using (auth.uid() = user_id);
