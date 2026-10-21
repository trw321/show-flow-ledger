-- Crew payments: money paid to someone who worked for you. They used to live
-- only in the browser, under their own key, so no backup ever saw them and
-- they were stuck on the one device.
create table if not exists public.payouts (
  id           uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  worker_name  text not null,
  amount       numeric not null,
  date         date not null,
  job_ref      text,
  period_start date,
  period_end   date,
  method       text,
  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists payouts_user_date on public.payouts (user_id, date desc);

alter table public.payouts enable row level security;

create policy "Users read own payouts"
  on public.payouts for select using (auth.uid() = user_id);
create policy "Users insert own payouts"
  on public.payouts for insert with check (auth.uid() = user_id);
create policy "Users update own payouts"
  on public.payouts for update using (auth.uid() = user_id);
create policy "Users delete own payouts"
  on public.payouts for delete using (auth.uid() = user_id);
