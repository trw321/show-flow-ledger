-- Idempotent: enable RLS and ensure correct policies on all tables.
-- Safe to run even if RLS was already partially configured.

-- ── Enable RLS ───────────────────────────────────────────────
ALTER TABLE public.jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

-- ── Drop all known policy name variants (from any prior migration) ──
DROP POLICY IF EXISTS "Users read own jobs"        ON public.jobs;
DROP POLICY IF EXISTS "Users insert own jobs"      ON public.jobs;
DROP POLICY IF EXISTS "Users update own jobs"      ON public.jobs;
DROP POLICY IF EXISTS "Users delete own jobs"      ON public.jobs;
DROP POLICY IF EXISTS "Users can view own jobs"    ON public.jobs;
DROP POLICY IF EXISTS "Users can insert own jobs"  ON public.jobs;
DROP POLICY IF EXISTS "Users can update own jobs"  ON public.jobs;
DROP POLICY IF EXISTS "Users can delete own jobs"  ON public.jobs;

DROP POLICY IF EXISTS "Users read own expenses"        ON public.expenses;
DROP POLICY IF EXISTS "Users insert own expenses"      ON public.expenses;
DROP POLICY IF EXISTS "Users update own expenses"      ON public.expenses;
DROP POLICY IF EXISTS "Users delete own expenses"      ON public.expenses;
DROP POLICY IF EXISTS "Users can view own expenses"    ON public.expenses;
DROP POLICY IF EXISTS "Users can insert own expenses"  ON public.expenses;
DROP POLICY IF EXISTS "Users can update own expenses"  ON public.expenses;
DROP POLICY IF EXISTS "Users can delete own expenses"  ON public.expenses;

DROP POLICY IF EXISTS "Users read own income"        ON public.income;
DROP POLICY IF EXISTS "Users insert own income"      ON public.income;
DROP POLICY IF EXISTS "Users update own income"      ON public.income;
DROP POLICY IF EXISTS "Users delete own income"      ON public.income;
DROP POLICY IF EXISTS "Users can view own income"    ON public.income;
DROP POLICY IF EXISTS "Users can insert own income"  ON public.income;
DROP POLICY IF EXISTS "Users can update own income"  ON public.income;
DROP POLICY IF EXISTS "Users can delete own income"  ON public.income;

DROP POLICY IF EXISTS "Users read own equipment"        ON public.equipment;
DROP POLICY IF EXISTS "Users insert own equipment"      ON public.equipment;
DROP POLICY IF EXISTS "Users update own equipment"      ON public.equipment;
DROP POLICY IF EXISTS "Users delete own equipment"      ON public.equipment;
DROP POLICY IF EXISTS "Users can view own equipment"    ON public.equipment;
DROP POLICY IF EXISTS "Users can insert own equipment"  ON public.equipment;
DROP POLICY IF EXISTS "Users can update own equipment"  ON public.equipment;
DROP POLICY IF EXISTS "Users can delete own equipment"  ON public.equipment;

-- ── Recreate policies (authenticated users only, own rows only) ──

-- jobs
CREATE POLICY "jobs_select" ON public.jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "jobs_insert" ON public.jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jobs_update" ON public.jobs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jobs_delete" ON public.jobs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- expenses
CREATE POLICY "expenses_select" ON public.expenses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "expenses_insert" ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "expenses_update" ON public.expenses
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "expenses_delete" ON public.expenses
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- income
CREATE POLICY "income_select" ON public.income
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "income_insert" ON public.income
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "income_update" ON public.income
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "income_delete" ON public.income
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- equipment
CREATE POLICY "equipment_select" ON public.equipment
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "equipment_insert" ON public.equipment
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "equipment_update" ON public.equipment
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "equipment_delete" ON public.equipment
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
