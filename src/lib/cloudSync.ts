import type { AppData, Job, Expense, Income, Equipment, Employer, CalendarEvent, PayOut } from './store';
import type { LedgerTable } from './ledgerDiff';

// The mapping between the ledger and the database, in both directions. Kept
// apart from the network so the part that silently loses data when it's
// wrong — a field left off, a null where undefined belongs — can be tested
// without a session. The sync itself is in sync.ts.

// Postgres rejects '' where it wants a date, and undefined where it wants null.
// Only ever use this for a NULLABLE column: an explicit null overrides a
// column's DEFAULT, so sending one to a NOT NULL column fails the constraint
// even though the column has a perfectly good default. Those use orDefault.
const orNull = <T>(v: T | undefined | '') => (v === undefined || v === '' ? null : v);

/** For NOT NULL columns — supplies the value the database would have defaulted
 *  to, rather than a null that would be rejected. */
const orDefault = <T>(v: T | undefined | null, fallback: T): T => (v ?? fallback);

/**
 * The two columns every synced table carries. A record never edited since it
 * was made reports its creation time, so the server can still tell which of
 * two versions is newer. A row being written is never a deletion — those are
 * a separate update — so deleted_at is cleared, which is also what lets a
 * newer edit bring back a record deleted elsewhere.
 */
const syncColumns = (r: { modifiedAt?: string; createdAt: string }) => ({
  modified_at: orNull(r.modifiedAt ?? r.createdAt),
  deleted_at: null,
});

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
  steward: orNull(j.steward),
  parking_cost: orNull(j.parkingCost),
  hours_worked: orNull(j.hoursWorked),
  meal_penalties: orDefault(j.mealPenalties, 0),
  meal_duration: orNull(j.mealDuration),
  meal_on_clock: orNull(j.mealOnClock),
  meal2_duration: orNull(j.meal2Duration),
  meal2_on_clock: orNull(j.meal2OnClock),
  hours_planned: orNull(j.hoursPlanned),
  day_rate: orNull(j.dayRate),
  day_rate_hours: orNull(j.dayRateHours),
  pay_stub_kind: orNull(j.payStubKind),
  local: orNull(j.local),
  needs_review: orNull(j.needsReview),
  call_timeline: orNull(j.callTimeline),
  call_gaps_on_clock: orNull(j.callGapsOnClock),
  night_premium_confirmed: orNull(j.nightPremiumConfirmed),
  night_premium_actual_hours: orNull(j.nightPremiumActualHours),
  pay_stub: orNull(j.payStub),
  stub_parsed: orNull(j.stubParsed),
  stub_corrections: orNull(j.stubCorrections),
  attachments: j.attachments ?? [],
  notes: j.notes ?? '',
  created_at: j.createdAt,
  ...syncColumns(j),
});

const expenseRow = (e: Expense, userId: string) => ({
  id: e.id, user_id: userId, job_id: orNull(e.jobId), category: e.category,
  description: e.description, amount: e.amount, date: e.date,
  receipt: orNull(e.receipt), created_at: e.createdAt,
  ...syncColumns(e),
});

const incomeRow = (i: Income, userId: string) => ({
  id: i.id, user_id: userId, job_id: orNull(i.jobId), client: i.client,
  description: i.description, amount: i.amount, date: i.date, status: i.status,
  invoice_number: orNull(i.invoiceNumber), entered_by_hand: orNull(i.enteredByHand),
  created_at: i.createdAt,
  ...syncColumns(i),
});

const equipmentRow = (q: Equipment, userId: string) => ({
  id: q.id, user_id: userId, name: q.name, category: q.category,
  serial_number: orNull(q.serialNumber), purchase_date: orNull(q.purchaseDate),
  value: orNull(q.value), status: q.status, assigned_job_id: orNull(q.assignedJobId),
  notes: orDefault(q.notes, ''), created_at: q.createdAt,
  ...syncColumns(q),
});

const employerRow = (e: Employer, userId: string) => ({
  id: e.id, user_id: userId, name: e.name,
  default_hourly_rate: orNull(e.defaultHourlyRate),
  default_day_rate: orNull(e.defaultDayRate),
  day_rate_hours: orNull(e.dayRateHours),
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
  ...syncColumns(e),
});

const eventRow = (v: CalendarEvent, userId: string) => ({
  id: v.id, user_id: userId, title: v.title, date: v.date,
  start_time: orNull(v.startTime), end_time: orNull(v.endTime),
  location: orNull(v.location), notes: orNull(v.notes), created_at: v.createdAt,
  ...syncColumns(v),
});

const payoutRow = (o: PayOut, userId: string) => ({
  id: o.id, user_id: userId, worker_name: o.workerName, amount: o.amount, date: o.date,
  job_ref: orNull(o.jobRef), period_start: orNull(o.periodStart), period_end: orNull(o.periodEnd),
  method: orNull(o.method), notes: orNull(o.notes), created_at: o.createdAt,
  ...syncColumns(o),
});

/** The whole local ledger as database rows, in insert order. */
export function buildRows(data: AppData, userId: string): [LedgerTable, Record<string, unknown>[]][] {
  return [
    // Employers and jobs first: expenses, income and equipment reference jobs.
    ['employers', data.employers.map(e => employerRow(e, userId))],
    ['jobs', data.jobs.map(j => jobRow(j, userId))],
    ['expenses', data.expenses.map(e => expenseRow(e, userId))],
    ['income', data.income.map(i => incomeRow(i, userId))],
    ['equipment', data.equipment.map(q => equipmentRow(q, userId))],
    ['events', (data.events ?? []).map(v => eventRow(v, userId))],
    // Crew payments ride along with everything else now, rather than sitting
    // in their own storage the backup never looked at.
    ['payouts', (data.payouts ?? []).map(o => payoutRow(o, userId))],
  ];
}

// ── Restore ─────────────────────────────────────────────────────────────────
// The inverse mapping. Columns come back snake_case with nulls where the app
// expects undefined, and a null left in place would read as a real value — a
// job with hourlyRate: null calculates differently from one without it.

type Row = Record<string, unknown>;

/** null means "not set" on the way back, which is `undefined` in app types. */
const und = <T>(v: T | null | undefined): T | undefined => (v == null ? undefined : v);

/**
 * When the record was last edited. A row whose edit time is its creation time
 * was never edited, so it comes back without one — exactly as it went up.
 */
const editedAt = (r: Row): string | undefined => {
  const at = Date.parse(r.modified_at as string);
  if (Number.isNaN(at) || at === Date.parse(r.created_at as string)) return undefined;
  return new Date(at).toISOString();
};

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
  steward: und(r.steward as string),
  parkingCost: und(r.parking_cost as number),
  hoursWorked: und(r.hours_worked as number),
  mealPenalties: und(r.meal_penalties as number),
  mealDuration: und(r.meal_duration as Job['mealDuration']),
  mealOnClock: und(r.meal_on_clock as boolean),
  meal2Duration: und(r.meal2_duration as Job['meal2Duration']),
  meal2OnClock: und(r.meal2_on_clock as boolean),
  hoursPlanned: und(r.hours_planned as boolean),
  dayRate: und(r.day_rate as number),
  dayRateHours: und(r.day_rate_hours as number),
  payStubKind: und(r.pay_stub_kind as Job['payStubKind']),
  local: und(r.local as string),
  needsReview: und(r.needs_review as boolean),
  callTimeline: und(r.call_timeline as string),
  callGapsOnClock: und(r.call_gaps_on_clock as boolean[]),
  nightPremiumConfirmed: und(r.night_premium_confirmed as boolean),
  nightPremiumActualHours: und(r.night_premium_actual_hours as number),
  payStub: und(r.pay_stub as string),
  stubParsed: und(r.stub_parsed as Job['stubParsed']),
  stubCorrections: und(r.stub_corrections as Job['stubCorrections']),
  attachments: und(r.attachments as string[]),
  notes: (r.notes as string) ?? '',
  createdAt: r.created_at as string,
  modifiedAt: editedAt(r),
});

const toExpense = (r: Row): Expense => ({
  id: r.id as string, jobId: und(r.job_id as string), category: r.category as string,
  description: r.description as string, amount: r.amount as number, date: r.date as string,
  receipt: und(r.receipt as string), createdAt: r.created_at as string,
  modifiedAt: editedAt(r),
});

const toIncome = (r: Row): Income => ({
  id: r.id as string, jobId: und(r.job_id as string), client: r.client as string,
  description: r.description as string, amount: r.amount as number, date: r.date as string,
  status: r.status as Income['status'], invoiceNumber: und(r.invoice_number as string),
  enteredByHand: und(r.entered_by_hand as boolean),
  createdAt: r.created_at as string,
  modifiedAt: editedAt(r),
});

const toEquipment = (r: Row): Equipment => ({
  id: r.id as string, name: r.name as string, category: r.category as string,
  serialNumber: und(r.serial_number as string), purchaseDate: und(r.purchase_date as string),
  value: und(r.value as number), status: r.status as Equipment['status'],
  assignedJobId: und(r.assigned_job_id as string), notes: (r.notes as string) ?? '',
  createdAt: r.created_at as string,
  modifiedAt: editedAt(r),
});

const toEmployer = (r: Row): Employer => ({
  id: r.id as string, name: r.name as string,
  defaultHourlyRate: und(r.default_hourly_rate as number),
  defaultDayRate: und(r.default_day_rate as number),
  dayRateHours: und(r.day_rate_hours as number),
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
  modifiedAt: editedAt(r),
});

const toEvent = (r: Row): CalendarEvent => ({
  id: r.id as string, title: r.title as string, date: r.date as string,
  startTime: und(r.start_time as string), endTime: und(r.end_time as string),
  location: und(r.location as string), notes: und(r.notes as string),
  createdAt: r.created_at as string,
  modifiedAt: editedAt(r),
});

const toPayout = (r: Row): PayOut => ({
  id: r.id as string, workerName: r.worker_name as string, amount: Number(r.amount),
  date: r.date as string, jobRef: und(r.job_ref as string),
  periodStart: und(r.period_start as string), periodEnd: und(r.period_end as string),
  method: und(r.method as PayOut['method']), notes: und(r.notes as string),
  createdAt: r.created_at as string,
  modifiedAt: editedAt(r),
});

/** Database rows back into app data. */
export function fromRows(raw: Record<string, Row[]>): AppData {
  return {
    payouts: (raw.payouts ?? []).map(toPayout),
    jobs: (raw.jobs ?? []).map(toJob),
    expenses: (raw.expenses ?? []).map(toExpense),
    income: (raw.income ?? []).map(toIncome),
    equipment: (raw.equipment ?? []).map(toEquipment),
    employers: (raw.employers ?? []).map(toEmployer),
    events: (raw.events ?? []).map(toEvent),
  };
}

const BUILDERS: { [T in LedgerTable]: (record: never, userId: string) => Record<string, unknown> } = {
  jobs: jobRow, expenses: expenseRow, income: incomeRow, equipment: equipmentRow,
  employers: employerRow, events: eventRow, payouts: payoutRow,
};

const READERS: { [T in LedgerTable]: (row: Row) => unknown } = {
  jobs: toJob, expenses: toExpense, income: toIncome, equipment: toEquipment,
  employers: toEmployer, events: toEvent, payouts: toPayout,
};

/** One ledger record as the row that stores it. */
export function rowForRecord(table: LedgerTable, record: unknown, userId: string): Record<string, unknown> {
  return BUILDERS[table](record as never, userId);
}

/** One stored row back as the ledger record it came from. */
export function recordFromRow(table: LedgerTable, row: Row): unknown {
  return READERS[table](row);
}
