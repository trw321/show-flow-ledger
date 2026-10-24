-- Two-way sync between devices.
--
-- Each device keeps its own copy and can edit it offline. These let the copies
-- agree afterwards without either one clobbering the other:
--  - modified_at: when the record was last edited, by the editing device's
--    clock. The newest edit wins.
--  - deleted_at: a deletion is kept as a marker, so other devices learn the
--    record is gone instead of putting it back.
-- updated_at, already kept by trigger, is the server's own clock. It is only
-- used to ask "what changed since I last looked?".

alter table public.jobs      add column if not exists modified_at timestamptz, add column if not exists deleted_at timestamptz;
alter table public.expenses  add column if not exists modified_at timestamptz, add column if not exists deleted_at timestamptz;
alter table public.income    add column if not exists modified_at timestamptz, add column if not exists deleted_at timestamptz;
alter table public.equipment add column if not exists modified_at timestamptz, add column if not exists deleted_at timestamptz;
alter table public.employers add column if not exists modified_at timestamptz, add column if not exists deleted_at timestamptz;
alter table public.events    add column if not exists modified_at timestamptz, add column if not exists deleted_at timestamptz;
alter table public.payouts   add column if not exists modified_at timestamptz, add column if not exists deleted_at timestamptz;

-- Payouts were the one table created without a server clock.
alter table public.payouts add column if not exists updated_at timestamptz not null default now();
create or replace trigger payouts_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

-- An older edit arriving late (a phone that was offline all day) must not
-- overwrite a newer one already here. Skipping the row keeps the newer edit.
create or replace function public.keep_newest_edit()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.modified_at is not null and new.modified_at is not null
     and new.modified_at < old.modified_at then
    return null;
  end if;
  return new;
end;
$$;

create or replace trigger jobs_keep_newest      before update on public.jobs      for each row execute function public.keep_newest_edit();
create or replace trigger expenses_keep_newest  before update on public.expenses  for each row execute function public.keep_newest_edit();
create or replace trigger income_keep_newest    before update on public.income    for each row execute function public.keep_newest_edit();
create or replace trigger equipment_keep_newest before update on public.equipment for each row execute function public.keep_newest_edit();
create or replace trigger employers_keep_newest before update on public.employers for each row execute function public.keep_newest_edit();
create or replace trigger events_keep_newest    before update on public.events    for each row execute function public.keep_newest_edit();
create or replace trigger payouts_keep_newest   before update on public.payouts   for each row execute function public.keep_newest_edit();

create index if not exists jobs_user_updated      on public.jobs      (user_id, updated_at);
create index if not exists expenses_user_updated  on public.expenses  (user_id, updated_at);
create index if not exists income_user_updated    on public.income    (user_id, updated_at);
create index if not exists equipment_user_updated on public.equipment (user_id, updated_at);
create index if not exists employers_user_updated on public.employers (user_id, updated_at);
create index if not exists events_user_updated    on public.events    (user_id, updated_at);
create index if not exists payouts_user_updated   on public.payouts   (user_id, updated_at);

-- Settings that change the maths (tax, what each local takes) have to match
-- on every device, or the same shift pays differently on the phone and the
-- desktop.
create table if not exists public.user_prefs (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  prefs       jsonb not null default '{}'::jsonb,
  modified_at timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

create policy "Users read own prefs"
  on public.user_prefs for select using (auth.uid() = user_id);
create policy "Users insert own prefs"
  on public.user_prefs for insert with check (auth.uid() = user_id);
create policy "Users update own prefs"
  on public.user_prefs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace trigger user_prefs_keep_newest
  before update on public.user_prefs
  for each row execute function public.keep_newest_edit();
create or replace trigger user_prefs_updated_at
  before update on public.user_prefs
  for each row execute function public.set_updated_at();

-- Fields the app keeps that had nowhere to go in the database, so syncing
-- would have quietly lost them: how a payment arrived, the employer terms
-- added since the tables were made, and a shift's role and paid time off.
alter table public.income add column if not exists payment_method text;

alter table public.jobs
  add column if not exists role text,
  add column if not exists pto boolean;

alter table public.employers
  add column if not exists worker_status text check (worker_status in ('w2', '1099')),
  add column if not exists roles jsonb,
  add column if not exists pto_earn_hours numeric,
  add column if not exists pto_per_hours_worked numeric,
  add column if not exists pto_starting_hours numeric,
  add column if not exists retirement_match_percent numeric,
  add column if not exists round_up_to_whole_hours boolean,
  add column if not exists post_meal_minimum_hours numeric,
  add column if not exists meal_penalty_after_hours numeric;
