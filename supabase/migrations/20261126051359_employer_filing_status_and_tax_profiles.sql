-- Applied to the live project on 2026-11-26. Replaces 20261109000000 and
-- 20261112000000, which were written but never applied: from Nov 12 the app
-- sent both fields on every employer save, so the first employer change after
-- that (2026-11-25 19:19 UTC) was refused with PGRST204 and, employers going
-- first, stopped every save after it.
--
-- tax_profiles may be null: the app writes it with orNull (an employer with no
-- profiles sends null), so a NOT NULL here refuses those saves instead.
alter table public.employers
  add column if not exists filing_status text
  check (filing_status is null or filing_status in ('single','married_jointly','married_separately','head_of_household'));
alter table public.employers
  add column if not exists tax_profiles jsonb;
notify pgrst, 'reload schema';
