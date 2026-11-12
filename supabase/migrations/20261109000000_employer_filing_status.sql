alter table public.employers
  add column if not exists filing_status text
  check (filing_status is null or filing_status in (
    'single',
    'married_jointly',
    'married_separately',
    'head_of_household'
  ));
