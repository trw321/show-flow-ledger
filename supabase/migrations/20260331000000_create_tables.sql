-- ============================================================
-- AV Ledger – initial schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Jobs
create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  job_number    text,
  name          text not null,
  client        text not null default '',
  venue         text not null default '',
  date          date not null,
  start_time    text,
  end_time      text,
  status        text not null default 'upcoming'
                  check (status in ('upcoming','in-progress','completed','cancelled')),
  pay_schedule  text check (pay_schedule in ('weekly','bi-weekly','semi-monthly','monthly','per-project')),
  pay_period_start date,
  payroll_company  text,
  hourly_rate      numeric,
  minimum_hours    numeric,
  has_6th_7th_day_rule boolean not null default false,
  has_vacation_pay     boolean not null default false,
  steward        text,
  parking_cost   numeric,
  hours_worked   numeric,
  meal_penalties integer not null default 0,
  meal_type      text check (meal_type in ('YWA','NWA')),
  attachments    text[] default '{}',
  notes          text not null default '',
  created_at     timestamptz not null default now()
);

-- 2. Expenses
create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  job_id      uuid references public.jobs(id) on delete set null,
  category    text not null default 'Other',
  description text not null default '',
  amount      numeric not null default 0,
  date        date not null,
  receipt     text,
  created_at  timestamptz not null default now()
);

-- 3. Income
create table public.income (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  job_id         uuid references public.jobs(id) on delete set null,
  client         text not null default '',
  description    text not null default '',
  amount         numeric not null default 0,
  date           date not null,
  status         text not null default 'pending'
                   check (status in ('pending','paid','overdue')),
  invoice_number text,
  created_at     timestamptz not null default now()
);

-- 4. Equipment
create table public.equipment (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  category        text not null default '',
  serial_number   text,
  purchase_date   date,
  value           numeric,
  status          text not null default 'available'
                    check (status in ('available','deployed','maintenance','retired')),
  assigned_job_id uuid references public.jobs(id) on delete set null,
  notes           text not null default '',
  created_at      timestamptz not null default now()
);

-- ============================================================
-- Row Level Security – each user sees only their own data
-- ============================================================

alter table public.jobs       enable row level security;
alter table public.expenses   enable row level security;
alter table public.income     enable row level security;
alter table public.equipment  enable row level security;

-- Jobs
create policy "Users read own jobs"   on public.jobs for select using (auth.uid() = user_id);
create policy "Users insert own jobs" on public.jobs for insert with check (auth.uid() = user_id);
create policy "Users update own jobs" on public.jobs for update using (auth.uid() = user_id);
create policy "Users delete own jobs" on public.jobs for delete using (auth.uid() = user_id);

-- Expenses
create policy "Users read own expenses"   on public.expenses for select using (auth.uid() = user_id);
create policy "Users insert own expenses" on public.expenses for insert with check (auth.uid() = user_id);
create policy "Users update own expenses" on public.expenses for update using (auth.uid() = user_id);
create policy "Users delete own expenses" on public.expenses for delete using (auth.uid() = user_id);

-- Income
create policy "Users read own income"   on public.income for select using (auth.uid() = user_id);
create policy "Users insert own income" on public.income for insert with check (auth.uid() = user_id);
create policy "Users update own income" on public.income for update using (auth.uid() = user_id);
create policy "Users delete own income" on public.income for delete using (auth.uid() = user_id);

-- Equipment
create policy "Users read own equipment"   on public.equipment for select using (auth.uid() = user_id);
create policy "Users insert own equipment" on public.equipment for insert with check (auth.uid() = user_id);
create policy "Users update own equipment" on public.equipment for update using (auth.uid() = user_id);
create policy "Users delete own equipment" on public.equipment for delete using (auth.uid() = user_id);

-- Indexes for common queries
create index idx_jobs_user_date       on public.jobs(user_id, date);
create index idx_expenses_user_date   on public.expenses(user_id, date);
create index idx_income_user_date     on public.income(user_id, date);
create index idx_equipment_user       on public.equipment(user_id);
