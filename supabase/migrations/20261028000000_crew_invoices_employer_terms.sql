-- Each employer's own W-4, and when it pays.
--  - w4_exempt: the W-4 filed with this employer says exempt — it withholds
--    no federal income tax. Null falls back to the account's old setting.
--  - first_check_weeks: some employers take weeks to issue the first check
--    (three is common), then pay on their usual schedule.
--  - pay_lag_days: for a schedule that is neither weekly nor bi-weekly — how
--    many days after the work the pay usually arrives.
alter table public.employers
  add column if not exists w4_exempt boolean,
  add column if not exists first_check_weeks numeric,
  add column if not exists pay_lag_days numeric;

-- Boss mode: the people who work for you, and when they do.
create table if not exists public.crew (
  id          uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  role        text,
  pay_rate    numeric,
  bill_rate   numeric,
  phone       text,
  email       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  modified_at timestamptz,
  deleted_at  timestamptz
);

-- A crew member's scheduled shift, the hours they actually worked, and the
-- payment that settled it, once paid. The crew, project and payment
-- references are not foreign keys: a device can delete one before the other
-- side has synced, and a hard reference would refuse the whole batch over it.
create table if not exists public.crew_shifts (
  id           uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  crew_id      uuid not null,
  date         date not null,
  start_time   text,
  end_time     text,
  job_id       uuid,
  place        text,
  notes        text,
  hours_worked numeric,
  rate         numeric,
  payout_id    uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  modified_at  timestamptz,
  deleted_at   timestamptz
);

-- Invoices, for 1099 work and for billing as a boss. Marking one paid records
-- a payment for each project it billed; their ids are kept to undo it.
create table if not exists public.invoices (
  id             uuid primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  number         text not null,
  client         text not null,
  client_email   text,
  client_address text,
  issue_date     date not null,
  due_date       date,
  lines          jsonb not null default '[]'::jsonb,
  notes          text,
  status         text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  paid_income_ids jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  modified_at    timestamptz,
  deleted_at     timestamptz
);

alter table public.crew        enable row level security;
alter table public.crew_shifts enable row level security;
alter table public.invoices    enable row level security;

create policy "Users read own crew"   on public.crew for select using (auth.uid() = user_id);
create policy "Users insert own crew" on public.crew for insert with check (auth.uid() = user_id);
create policy "Users update own crew" on public.crew for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own crew" on public.crew for delete using (auth.uid() = user_id);

create policy "Users read own crew shifts"   on public.crew_shifts for select using (auth.uid() = user_id);
create policy "Users insert own crew shifts" on public.crew_shifts for insert with check (auth.uid() = user_id);
create policy "Users update own crew shifts" on public.crew_shifts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own crew shifts" on public.crew_shifts for delete using (auth.uid() = user_id);

create policy "Users read own invoices"   on public.invoices for select using (auth.uid() = user_id);
create policy "Users insert own invoices" on public.invoices for insert with check (auth.uid() = user_id);
create policy "Users update own invoices" on public.invoices for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own invoices" on public.invoices for delete using (auth.uid() = user_id);

-- The same sync machinery as every other ledger table.
create or replace trigger crew_updated_at        before update on public.crew        for each row execute function public.set_updated_at();
create or replace trigger crew_shifts_updated_at before update on public.crew_shifts for each row execute function public.set_updated_at();
create or replace trigger invoices_updated_at    before update on public.invoices    for each row execute function public.set_updated_at();
create or replace trigger crew_keep_newest        before update on public.crew        for each row execute function public.keep_newest_edit();
create or replace trigger crew_shifts_keep_newest before update on public.crew_shifts for each row execute function public.keep_newest_edit();
create or replace trigger invoices_keep_newest    before update on public.invoices    for each row execute function public.keep_newest_edit();

create index if not exists crew_user_updated        on public.crew        (user_id, updated_at);
create index if not exists crew_shifts_user_updated on public.crew_shifts (user_id, updated_at);
create index if not exists invoices_user_updated    on public.invoices    (user_id, updated_at);
