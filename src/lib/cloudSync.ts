import { supabase } from '@/integrations/supabase/client';
import type { AppData, Job, Expense, Income, Equipment, Employer, CalendarEvent } from './store';

// One-way backup: local is the source of truth and the cloud is a copy of it.
// Nothing is read back or merged here — that's a later step — so this can never
// overwrite something on the device with something older from the server.

export interface BackupResult {
  ok: boolean;
  counts: Record<string, number>;
  error?: string;
}

const LAST_BACKUP_KEY = 'showflow-last-backup';

export const lastBackupAt = (): string | null => {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
};

const setLastBackupAt = (iso: string) => {
  try { localStorage.setItem(LAST_BACKUP_KEY, iso); } catch { /* nothing to do */ }
};

// Postgres rejects '' where it wants a date, and undefined where it wants null.
const orNull = <T>(v: T | undefined | '') => (v === undefined || v === '' ? null : v);

const jobRow = (j: Job, userId: string) => ({
  id: j.id,
  user_id: userId,
  job_number: orNull(j.jobNumber),
  name: j.name,
  client: j.client,
  venue: j.venue,
  date: j.date,
  start_time: orNull(j.startTime),
  end_time: orNull(j.endTime),
  status: j.status,
  pay_schedule: orNull(j.paySchedule),
  pay_period_start: orNull(j.payPeriodStart),
  payroll_company: orNull(j.payrollCompany),
  hourly_rate: orNull(j.hourlyRate),
  minimum_hours: orNull(j.minimumHours),
  has_6th_7th_day_rule: j.has6th7thDayRule ?? false,
  has_vacation_pay: j.hasVacationPay ?? false,
  steward: orNull(j.steward),
  parking_cost: orNull(j.parkingCost),
  hours_worked: orNull(j.hoursWorked),
  meal_penalties: orNull(j.mealPenalties),
  meal_duration: orNull(j.mealDuration),
  meal_on_clock: orNull(j.mealOnClock),
  night_premium_confirmed: orNull(j.nightPremiumConfirmed),
  night_premium_actual_hours: orNull(j.nightPremiumActualHours),
  pay_stub: orNull(j.payStub),
  stub_parsed: orNull(j.stubParsed),
  stub_corrections: orNull(j.stubCorrections),
  attachments: j.attachments ?? [],
  notes: j.notes ?? '',
  created_at: j.createdAt,
});

const expenseRow = (e: Expense, userId: string) => ({
  id: e.id, user_id: userId, job_id: orNull(e.jobId), category: e.category,
  description: e.description, amount: e.amount, date: e.date,
  receipt: orNull(e.receipt), created_at: e.createdAt,
});

const incomeRow = (i: Income, userId: string) => ({
  id: i.id, user_id: userId, job_id: orNull(i.jobId), client: i.client,
  description: i.description, amount: i.amount, date: i.date, status: i.status,
  invoice_number: orNull(i.invoiceNumber), created_at: i.createdAt,
});

const equipmentRow = (q: Equipment, userId: string) => ({
  id: q.id, user_id: userId, name: q.name, category: q.category,
  serial_number: orNull(q.serialNumber), purchase_date: orNull(q.purchaseDate),
  value: orNull(q.value), status: q.status, assigned_job_id: orNull(q.assignedJobId),
  notes: orNull(q.notes), created_at: q.createdAt,
});

const employerRow = (e: Employer, userId: string) => ({
  id: e.id, user_id: userId, name: e.name,
  default_hourly_rate: orNull(e.defaultHourlyRate),
  payroll_company: orNull(e.payrollCompany),
  timekeeping_app: orNull(e.timekeepingApp),
  pay_schedule: orNull(e.paySchedule),
  overtime_rule: e.overtimeRule,
  daily_overtime_threshold_hours: orNull(e.dailyOvertimeThresholdHours),
  daily_doubletime_threshold_hours: orNull(e.dailyDoubletimeThresholdHours),
  weekly_overtime_threshold_hours: orNull(e.weeklyOvertimeThresholdHours),
  overtime_multiplier: orNull(e.overtimeMultiplier),
  doubletime_multiplier: orNull(e.doubletimeMultiplier),
  night_premium_enabled: orNull(e.nightPremiumEnabled),
  night_premium_start_hour: orNull(e.nightPremiumStartHour),
  night_premium_end_hour: orNull(e.nightPremiumEndHour),
  night_premium_multiplier: orNull(e.nightPremiumMultiplier),
  union_dues_percent: orNull(e.unionDuesPercent),
  union_local: orNull(e.unionLocal),
  estimated_tax_percent: orNull(e.estimatedTaxPercent),
  vacation_percent: orNull(e.vacationPercent),
  dismissed_suggestions: orNull(e.dismissedSuggestions),
  notes: orNull(e.notes),
  created_at: e.createdAt,
});

const eventRow = (v: CalendarEvent, userId: string) => ({
  id: v.id, user_id: userId, title: v.title, date: v.date,
  start_time: orNull(v.startTime), end_time: orNull(v.endTime),
  location: orNull(v.location), notes: orNull(v.notes), created_at: v.createdAt,
});

/** The whole local ledger as database rows, in insert order. Separated from the
 *  network call so the field mapping — the part that silently loses data when
 *  it's wrong — can be tested without a session. */
export function buildRows(data: AppData, userId: string): [string, Record<string, unknown>[]][] {
  return [
    // Employers and jobs first: expenses, income and equipment reference jobs.
    ['employers', data.employers.map(e => employerRow(e, userId))],
    ['jobs', data.jobs.map(j => jobRow(j, userId))],
    ['expenses', data.expenses.map(e => expenseRow(e, userId))],
    ['income', data.income.map(i => incomeRow(i, userId))],
    ['equipment', data.equipment.map(q => equipmentRow(q, userId))],
    ['events', (data.events ?? []).map(v => eventRow(v, userId))],
  ];
}

/**
 * Copies everything on this device up to the user's account. Upserts by id, so
 * running it twice is the same as running it once, and a partial failure can be
 * retried without creating duplicates.
 */
export async function backupToCloud(data: AppData, userId: string): Promise<BackupResult> {
  const counts: Record<string, number> = {};
  const tables = buildRows(data, userId);

  for (const [table, rows] of tables) {
    counts[table] = rows.length;
    if (rows.length === 0) continue;
    // Chunked so a large ledger doesn't hit the request size limit.
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'id' });
      if (error) return { ok: false, counts, error: `${table}: ${error.message}` };
    }
  }

  const now = new Date().toISOString();
  setLastBackupAt(now);
  return { ok: true, counts };
}
