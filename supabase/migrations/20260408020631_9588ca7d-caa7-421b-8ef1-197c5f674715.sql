
-- Jobs table
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_number TEXT,
  name TEXT NOT NULL,
  client TEXT NOT NULL,
  venue TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  pay_schedule TEXT,
  pay_period_start TEXT,
  payroll_company TEXT,
  hourly_rate NUMERIC,
  minimum_hours NUMERIC,
  has_6th_7th_day_rule BOOLEAN DEFAULT false,
  has_vacation_pay BOOLEAN DEFAULT false,
  steward TEXT,
  parking_cost NUMERIC,
  hours_worked NUMERIC DEFAULT 0,
  meal_penalties NUMERIC,
  meal_type TEXT,
  attachments TEXT[],
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own jobs" ON public.jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own jobs" ON public.jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own jobs" ON public.jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own jobs" ON public.jobs FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Expenses table
CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id UUID,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  amount NUMERIC NOT NULL,
  date TEXT NOT NULL,
  receipt TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own expenses" ON public.expenses FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own expenses" ON public.expenses FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own expenses" ON public.expenses FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Income table
CREATE TABLE public.income (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_id UUID,
  client TEXT NOT NULL,
  description TEXT DEFAULT '',
  amount NUMERIC NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  invoice_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.income ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own income" ON public.income FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own income" ON public.income FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own income" ON public.income FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own income" ON public.income FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Equipment table
CREATE TABLE public.equipment (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  serial_number TEXT,
  purchase_date TEXT,
  value NUMERIC,
  status TEXT NOT NULL DEFAULT 'available',
  assigned_job_id UUID,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own equipment" ON public.equipment FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own equipment" ON public.equipment FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own equipment" ON public.equipment FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own equipment" ON public.equipment FOR DELETE TO authenticated USING (auth.uid() = user_id);
