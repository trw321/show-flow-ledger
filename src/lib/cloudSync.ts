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
// Only ever use this for a NULLABLE column: an explicit null overrides a
// column's DEFAULT, so sending one to a NOT NULL column fails the constraint
// even though the column has a perfectly good default. Those use orDefault.
const orNull = <T>(v: T | undefined | '') => (v === undefined || v === '' ? null : v);

/** For NOT NULL columns — supplies the value the database would have defaulted
 *  to, rather than a null that would be rejected. */
const orDefault = <T>(v: T | undefined | null, fallback: T): T => (v ?? fallback);

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
  meal_penalties: orDefault(j.mealPenalties, 0),
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
  notes: orDefault(q.notes, ''), created_at: q.createdAt,
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

// ── Restore ─────────────────────────────────────────────────────────────────
// The inverse mapping. Columns come back snake_case with nulls where the app
// expects undefined, and a null left in place would read as a real value — a
// job with hourlyRate: null calculates differently from one without it.

type Row = Record<string, unknown>;

/** null means "not set" on the way back, which is `undefined` in app types. */
const und = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

const toJob = (r: Row): Job => ({
  id: r.id as string,
  jobNumber: und(r.job_number as string),
  name: r.name as string,
  client: r.client as string,
  venue: r.venue as string,
  date: r.date as string,
  startTime: und(r.start_time as string),
  endTime: und(r.end_time as string),
  status: r.status as Job['status'],
  paySchedule: und(r.pay_schedule as Job['paySchedule']),
  payPeriodStart: und(r.pay_period_start as string),
  payrollCompany: und(r.payroll_company as string),
  hourlyRate: und(r.hourly_rate as number),
  minimumHours: und(r.minimum_hours as number),
  has6th7thDayRule: (r.has_6th_7th_day_rule as boolean) ?? false,
  hasVacationPay: (r.has_vacation_pay as boolean) ?? false,
  steward: und(r.steward as string),
  parkingCost: und(r.parking_cost as number),
  hoursWorked: und(r.hours_worked as number),
  mealPenalties: und(r.meal_penalties as number),
  mealDuration: und(r.meal_duration as Job['mealDuration']),
  mealOnClock: und(r.meal_on_clock as boolean),
  nightPremiumConfirmed: und(r.night_premium_confirmed as boolean),
  nightPremiumActualHours: und(r.night_premium_actual_hours as number),
  payStub: und(r.pay_stub as string),
  stubParsed: und(r.stub_parsed as Job['stubParsed']),
  stubCorrections: und(r.stub_corrections as Job['stubCorrections']),
  attachments: und(r.attachments as string[]),
  notes: (r.notes as string) ?? '',
  createdAt: r.created_at as string,
});

const toExpense = (r: Row): Expense => ({
  id: r.id as string, jobId: und(r.job_id as string), category: r.category as string,
  description: r.description as string, amount: r.amount as number, date: r.date as string,
  receipt: und(r.receipt as string), createdAt: r.created_at as string,
});

const toIncome = (r: Row): Income => ({
  id: r.id as string, jobId: und(r.job_id as string), client: r.client as string,
  description: r.description as string, amount: r.amount as number, date: r.date as string,
  status: r.status as Income['status'], invoiceNumber: und(r.invoice_number as string),
  createdAt: r.created_at as string,
});

const toEquipment = (r: Row): Equipment => ({
  id: r.id as string, name: r.name as string, category: r.category as string,
  serialNumber: und(r.serial_number as string), purchaseDate: und(r.purchase_date as string),
  value: und(r.value as number), status: r.status as Equipment['status'],
  assignedJobId: und(r.assigned_job_id as string), notes: (r.notes as string) ?? '',
  createdAt: r.created_at as string,
});

const toEmployer = (r: Row): Employer => ({
  id: r.id as string, name: r.name as string,
  defaultHourlyRate: und(r.default_hourly_rate as number),
  payrollCompany: und(r.payroll_company as string),
  timekeepingApp: und(r.timekeeping_app as string),
  paySchedule: und(r.pay_schedule as Employer['paySchedule']),
  overtimeRule: r.overtime_rule as Employer['overtimeRule'],
  dailyOvertimeThresholdHours: und(r.daily_overtime_threshold_hours as number),
  dailyDoubletimeThresholdHours: und(r.daily_doubletime_threshold_hours as number),
  weeklyOvertimeThresholdHours: und(r.weekly_overtime_threshold_hours as number),
  overtimeMultiplier: und(r.overtime_multiplier as number),
  doubletimeMultiplier: und(r.doubletime_multiplier as number),
  nightPremiumEnabled: und(r.night_premium_enabled as boolean),
  nightPremiumStartHour: und(r.night_premium_start_hour as number),
  nightPremiumEndHour: und(r.night_premium_end_hour as number),
  nightPremiumMultiplier: und(r.night_premium_multiplier as number),
  unionDuesPercent: und(r.union_dues_percent as number),
  unionLocal: und(r.union_local as string),
  estimatedTaxPercent: und(r.estimated_tax_percent as number),
  vacationPercent: und(r.vacation_percent as number),
  dismissedSuggestions: und(r.dismissed_suggestions as Employer['dismissedSuggestions']),
  notes: und(r.notes as string),
  createdAt: r.created_at as string,
});

const toEvent = (r: Row): CalendarEvent => ({
  id: r.id as string, title: r.title as string, date: r.date as string,
  startTime: und(r.start_time as string), endTime: und(r.end_time as string),
  location: und(r.location as string), notes: und(r.notes as string),
  createdAt: r.created_at as string,
});

export interface RestoreResult {
  ok: boolean;
  data?: AppData;
  counts?: Record<string, number>;
  error?: string;
}

/** Everything in the account, as app data. Read-only: the caller decides what
 *  to do with it, so nothing local is touched unless they say so. */
/** Database rows back into app data. Separated from the network call so the
 *  mapping can be round-tripped against buildRows in a test. */
export function fromRows(raw: Record<string, Row[]>): AppData {
  return {
    jobs: (raw.jobs ?? []).map(toJob),
    expenses: (raw.expenses ?? []).map(toExpense),
    income: (raw.income ?? []).map(toIncome),
    equipment: (raw.equipment ?? []).map(toEquipment),
    employers: (raw.employers ?? []).map(toEmployer),
    events: (raw.events ?? []).map(toEvent),
  };
}

export async function fetchFromCloud(): Promise<RestoreResult> {
  const tables = ['jobs', 'expenses', 'income', 'equipment', 'employers', 'events'] as const;
  const raw: Record<string, Row[]> = {};

  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('*');
    if (error) return { ok: false, error: `${t}: ${error.message}` };
    raw[t] = (data ?? []) as Row[];
  }

  return {
    ok: true,
    data: fromRows(raw),
    counts: Object.fromEntries(tables.map(t => [t, raw[t].length])),
  };
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
