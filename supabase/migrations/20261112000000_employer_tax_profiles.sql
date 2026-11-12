alter table public.employers
  add column if not exists tax_profiles jsonb not null default '[]'::jsonb;
