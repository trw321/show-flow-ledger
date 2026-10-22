import { useState, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { isDuplicateJob } from './jobDedup';
import { localToday } from './today';
import { stampChanges, type LedgerChange } from './ledgerDiff';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  jobNumber?: string;
  name: string;
  client: string;
  venue: string;
  date: string;
  startTime?: string;
  endTime?: string;
  status: 'upcoming' | 'in-progress' | 'completed' | 'cancelled';
  paySchedule?: 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly' | 'per-project';
  payPeriodStart?: string;
  payrollCompany?: string;
  hourlyRate?: number;
  minimumHours?: number;
  has6th7thDayRule?: boolean;
  steward?: string;
  parkingCost?: number;
  hoursWorked?: number;
  /** Minutes taken for the meal break: 0 means no meal was taken (see mealPenalties). */
  mealDuration?: 0 | 30 | 45 | 60;
  /** true = paid/on the clock (no hours deduction), false = unpaid/off the clock (mealDuration is deducted). Irrelevant when mealDuration is 0. */
  mealOnClock?: boolean;
  /** Paid by the day rather than the hour: a flat amount covering dayRateHours, paid in full however short the day. Set per shift because every project is its own contract. */
  dayRate?: number;
  /** How many hours the day rate covers before overtime. Default 10. */
  dayRateHours?: number;
  /** Which kind of photo is on this shift: a pay stub (the breakdown) or the cheque itself. They prove different things — a stub says what was earned and deducted, a cheque only says what arrived — so they are marked differently. */
  payStubKind?: 'stub' | 'check';
  /** Hours filled in before the shift happened. They are a plan, not a timesheet: nothing counts them as worked or earned until the shift is confirmed on or after the day. Cleared on confirmation. Absent on anything logged after the fact. */
  hoursPlanned?: boolean;
  /** The local that dispatched the call — "ia8", "Local 16". Not the employer: an offer names the local as its "Client", but the company that pays is the employer and lives in `client`, which is what pay rates resolve from. */
  local?: string;
  /** Flagged to come back to. Set by hand from the shift form, and set automatically when the payroll company was assumed to be the employer because the offer did not name one. */
  needsReview?: boolean;
  /** A day entered as a run of calls — "8-10, 11-3, 4-7" — kept as typed, because the meals are the gaps between the calls and a gap can be any length. When set, it is what the day's off-the-clock minutes are derived from, in place of mealDuration/meal2Duration. See parseDayTimeline. */
  callTimeline?: string;
  /** Which of the timeline's gaps were kept on the clock (paid, not deducted), in order. Absent or shorter than the gap list means the rest were off the clock, which is the normal case. */
  callGapsOnClock?: boolean[];
  /** A second meal, on its own terms: an hour off the clock at lunch and half an hour on the clock later is a normal day. Undefined means the day had only one meal. Deducted independently of the first — see mealDuration. */
  meal2Duration?: 0 | 30 | 45 | 60;
  /** Whether the SECOND meal was paid. Same meaning as mealOnClock, for meal2Duration. */
  meal2OnClock?: boolean;
  /** Units of meal-penalty pay owed (each = 1hr at straight rate) — only meaningful when mealDuration is 0. */
  mealPenalties?: number;
  /** For employers with nightPremiumEnabled: were the hours past midnight actually worked (true, gets the premium) vs. just minimum-call padding that was never really worked (false, straight time)? Undefined = not asked yet / not applicable. Superseded by nightPremiumActualHours when that's set — this stays around for the simple all-or-nothing case and old saved jobs. */
  nightPremiumConfirmed?: boolean;
  /** Set only when the worked/padding split of the after-midnight hours isn't all-or-nothing — e.g. 3 calculated night hours but only 1.5 were actually worked, the rest was unworked minimum-call padding. Takes precedence over nightPremiumConfirmed when present. Undefined = not partially split (see nightPremiumConfirmed instead). */
  nightPremiumActualHours?: number;
  attachments?: string[];
  /** Data URI of the uploaded pay stub/check image for this job — lets you flag which jobs still need a stub logged, and eventually compare the stub's actual breakdown against the calculated pay. */
  payStub?: string;
  /** Structured breakdown AI-extracted from payStub (image uploads only, not PDF) — used to compare the stub's actual gross/dues/tax/vacation/net against the calculated estimate for this shift. Undefined if no stub uploaded yet, or the upload was a PDF/parsing failed (payStub attachment still saved either way). */
  stubParsed?: {
    employer?: string;
    payPeriodStart?: string;
    payPeriodEnd?: string;
    totalHours?: number;
    hoursBreakdown?: { date: string; hours: number; type: 'ST' | 'OT' | 'DT' }[];
    hourlyRate?: number;
    grossPay?: number;
    duesAmount?: number;
    taxAmount?: number;
    vacationAmount?: number;
    otherDeductions?: number;
    netPay?: number;
  };
  /** Figures the user accepted from a pay stub over what the app calculated.
   *  Kept so the change stays visible after the fact, and so the settings
   *  learner has a record of what the payroll system actually did. */
  stubCorrections?: {
    field: 'hours' | 'rate' | 'gross' | 'dues' | 'tax' | 'vacation' | 'net';
    was: number;
    now: number;
    at: string;
  }[];
  /** The role worked on this shift — "A1", "Stagehand" — when the employer pays roles differently. Picking one sets the shift's rate from it. */
  role?: string;
  /** Paid time off: the hours are paid at straight time but were not worked, so they earn nothing a worked day does — no overtime, night premium, meal penalty or minimum — and they come out of the PTO banked with this employer. */
  pto?: boolean;
  notes: string;
  createdAt: string;
  /** When this was last edited, by the editing device's clock. Copies on two
   *  devices are reconciled by it: the newer edit wins. Unset on anything not
   *  edited since syncing began. */
  modifiedAt?: string;
}

export interface Expense {
  id: string;
  jobId?: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  receipt?: string;
  createdAt: string;
  /** Last edited — see Job.modifiedAt. */
  modifiedAt?: string;
}

export interface Income {
  id: string;
  jobId?: string;
  client: string;
  description: string;
  amount: number;
  date: string;
  status: 'pending' | 'paid' | 'overdue';
  paymentMethod?: 'direct_deposit' | 'check' | 'cash' | 'other';
  /** Typed in by hand rather than read off a stub, a cheque or a statement. Worth knowing: nothing has been checked against a document. */
  enteredByHand?: boolean;
  invoiceNumber?: string;
  createdAt: string;
  /** Last edited — see Job.modifiedAt. */
  modifiedAt?: string;
}

export interface Equipment {
  id: string;
  name: string;
  category: string;
  serialNumber?: string;
  purchaseDate?: string;
  value?: number;
  status: 'available' | 'deployed' | 'maintenance' | 'retired';
  assignedJobId?: string;
  notes: string;
  createdAt: string;
  /** Last edited — see Job.modifiedAt. */
  modifiedAt?: string;
}

/** A role this employer pays at its own rate. */
export interface EmployerRole {
  name: string;
  hourlyRate?: number;
  dayRate?: number;
}

export interface Employer {
  id: string;
  name: string;
  /** How this employer pays you. 1099 withholds nothing — the tax on it is all still owed, self-employment tax included — where W2 takes it out of each check. Undefined is W2. */
  workerStatus?: 'w2' | '1099';
  /** Roles paid at different rates under the same employer. */
  roles?: EmployerRole[];
  /** Paid time off earned: this many hours… */
  ptoEarnHours?: number;
  /** …for every this many hours worked. California's sick-leave minimum is 1 per 30. */
  ptoPerHoursWorked?: number;
  /** PTO hours already banked before the shifts in this ledger. */
  ptoStartingHours?: number;
  defaultHourlyRate?: number;
  payrollCompany?: string;
  timekeepingApp?: string;
  paySchedule?: Job['paySchedule'];
  overtimeRule: 'daily' | 'weekly' | 'none';
  dailyOvertimeThresholdHours?: number;
  dailyDoubletimeThresholdHours?: number;
  weeklyOvertimeThresholdHours?: number;
  overtimeMultiplier?: number;
  doubletimeMultiplier?: number;
  /** IATSE-style rule: hours actually worked after midnight (or a custom start hour) are paid at nightPremiumMultiplier. Minimum-call padding never gets this — only clock-time-derived worked hours. */
  nightPremiumEnabled?: boolean;
  nightPremiumStartHour?: number; // 0-23, default 0 (midnight)
  nightPremiumEndHour?: number;   // 0-23, optional — undefined means "until end of shift"
  nightPremiumMultiplier?: number; // default 2.0
  /** The day rate a new shift for this employer starts from, when they pay by the day. A default only — the shift can say otherwise. */
  defaultDayRate?: number;
  /** How many hours this employer's day rate covers. Default 10. */
  dayRateHours?: number;
  /** Employers like Odeum match into a retirement plan — a percentage of gross they owe on top of the pay, to the plan rather than to you. Tracked so a missing one is visible; never part of take-home. */
  retirementMatchPercent?: number;
  /** Union hours "break the hour": any part of an hour worked bills as a whole hour, so 6h06m pays 7. Off by default — not every contract rounds. */
  roundUpToWholeHours?: boolean;
  /** Hours guaranteed after an off-the-clock meal before you can be sent home. Short of it, the difference is paid at straight time. IATSE-style 2 is typical. Undefined/0 = no such guarantee. */
  postMealMinimumHours?: number;
  /** Hours you can work before a meal must be called. Past it a penalty accrues for every hour or part of an hour, until a meal starts. Default 5. */
  mealPenaltyAfterHours?: number;
  /** Percent of gross pay auto-deducted for this employer's union dues (e.g. 3.5 = 3.5%). Undefined/0 = no deduction. */
  unionDuesPercent?: number;
  /** IATSE local number this employer's work falls under (e.g. "16", "8"). Free text — purely informational, shown in exports. */
  unionLocal?: string;
  /** Estimated tax withholding as a percent of gross pay, auto-deducted like union dues. A rough estimate, not real withholding math — leave unset for 1099/self-employed work with no withholding. */
  estimatedTaxPercent?: number;
  /** Vacation/fringe pay as a percent of gross earnings, added on top (e.g. 6 = 6%) — common IATSE benefit. Undefined/0 = not paid. */
  vacationPercent?: number;
  /** Settings suggestions the user turned down. A dismissal skips the next
   *  occurrence and then asks again, so a rejected suggestion isn't nagging
   *  but also isn't gone forever if the stubs keep disagreeing. */
  dismissedSuggestions?: { field: string; skipsRemaining: number; dismissedAt: string }[];
  notes?: string;
  createdAt: string;
  /** Last edited — see Job.modifiedAt. */
  modifiedAt?: string;
}

// A non-work calendar entry — a personal commitment or plan you want visible
// alongside shifts, so a last-minute gig offer can be weighed against what's
// already on the calendar (including where it is), not just whether you're
// free on paper.
export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  notes?: string;
  createdAt: string;
  /** Last edited — see Job.modifiedAt. */
  modifiedAt?: string;
}

/** Money you paid someone who worked for you. */
export type PayOutMethod = 'check' | 'cash' | 'venmo' | 'zelle' | 'ach' | 'other';

export interface PayOut {
  id: string;
  workerName: string;
  amount: number;
  date: string;
  jobRef?: string;
  periodStart?: string;
  periodEnd?: string;
  method?: PayOutMethod;
  notes?: string;
  createdAt: string;
  /** Last edited — see Job.modifiedAt. */
  modifiedAt?: string;
}

export interface AppData {
  jobs: Job[];
  expenses: Expense[];
  income: Income[];
  equipment: Equipment[];
  employers: Employer[];
  events: CalendarEvent[];
  /**
   * Crew payments. They used to live in their own storage key, outside the
   * ledger, so the cloud backup never saw them and they were stuck on the one
   * device — and signed out they were never saved at all.
   */
  payouts: PayOut[];
}

// ── localStorage persistence ────────────────────────────────────────────────

/**
 * The ledger kept while signed out — and, before each account had its own,
 * the only one there was, shown to whoever signed in on this device.
 */
export const DEVICE_LEDGER_KEY = 'av-bookkeeper-data';

/**
 * Where a ledger lives on this device. Each account keeps its own, so signing
 * in as someone else never shows — or syncs — another account's shifts.
 */
export function ledgerKeyFor(userId: string | null | undefined): string {
  return userId ? `${DEVICE_LEDGER_KEY}:${userId}` : DEVICE_LEDGER_KEY;
}

/** Where an account's settings live on this device. */
export function prefsKeyFor(userId: string | null | undefined): string {
  return userId ? `av-prefs-${userId}` : 'av-prefs';
}

/** Where an account's sync bookkeeping lives: how far it has read, and what it has yet to send. */
export function syncMetaKeyFor(userId: string): string {
  return `showflow-sync:${userId}`;
}

export const EMPTY_LEDGER: AppData = { jobs: [], expenses: [], income: [], equipment: [], employers: [], events: [], payouts: [] };

/** Old crew payments already folded into the ledger once. */
const ADOPTED_PAYOUTS_KEY = 'showflow-payouts-adopted';

function adoptedPayoutIds(): Set<string> {
  try {
    const ids = JSON.parse(localStorage.getItem(ADOPTED_PAYOUTS_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

/** Every id the old Pay Outs page saved, under any account's key. */
function standalonePayoutIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('av-payouts-')) continue;
      try {
        const list = JSON.parse(localStorage.getItem(key) ?? '[]');
        if (Array.isArray(list)) for (const p of list) if (p && typeof p.id === 'string') ids.add(p.id);
      } catch { /* one unreadable key does not stop the others */ }
    }
  } catch { /* storage unreadable */ }
  return ids;
}

/**
 * Crew payments saved by the old Pay Outs page, which kept them under their own
 * key per account. Folded into the ledger on load so they back up and sync with
 * everything else. The old keys are left in place rather than deleted — if
 * anything goes wrong here, the originals are still there to recover from.
 *
 * Each is folded in once. A payment deleted from the ledger afterwards stays
 * deleted, instead of coming back from the old key on the next load.
 */
function adoptStandalonePayouts(existing: PayOut[]): PayOut[] {
  const seen = new Set(existing.map(p => p.id));
  const done = adoptedPayoutIds();
  const adopted: PayOut[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('av-payouts-')) continue;
      const list = JSON.parse(localStorage.getItem(key) ?? '[]');
      if (!Array.isArray(list)) continue;
      for (const p of list) {
        if (p && typeof p.id === 'string' && !seen.has(p.id) && !done.has(p.id)) {
          seen.add(p.id);
          adopted.push(p as PayOut);
        }
      }
    }
  } catch {
    // Unreadable storage leaves the ledger exactly as it was.
  }
  return adopted.length ? [...existing, ...adopted] : existing;
}

/** Remembers which old payments the saved ledger now holds. */
function markPayoutsAdopted(ledger: PayOut[]) {
  const old = standalonePayoutIds();
  if (old.size === 0) return;
  const done = adoptedPayoutIds();
  const before = done.size;
  for (const p of ledger) if (old.has(p.id)) done.add(p.id);
  if (done.size === before) return;
  try {
    localStorage.setItem(ADOPTED_PAYOUTS_KEY, JSON.stringify([...done]));
  } catch {
    // Not remembered: the next load adopts them again, and dedupes by id.
  }
}

// Old jobs may still carry the retired mealType ('YWA'/'NWA') field instead of
// mealDuration/mealOnClock. Convert on load so historical deduction behavior
// (YWA = 1hr off-clock, NWA = 30min on-clock) stays exactly the same.
function migrateJob(job: Job & { mealType?: 'YWA' | 'NWA' }): Job {
  if (job.mealDuration === undefined && job.mealType) {
    if (job.mealType === 'YWA') { job.mealDuration = 60; job.mealOnClock = false; }
    else if (job.mealType === 'NWA') { job.mealDuration = 30; job.mealOnClock = true; }
  }
  delete job.mealType;

  // Logging hours used to mark a shift completed whatever its date, so shifts
  // booked for days that have not happened are sitting in old ledgers reading
  // as done — and done is what the dot, the card wash and the label all key
  // off, so they look finished and settled. Put them back to upcoming, and
  // mark the hours as the plan they always were.
  //
  // Only ever touches a FUTURE date. A past shift marked completed is just a
  // shift that was worked, and is left alone.
  const today = localToday();
  if (job.date > today && job.status === 'completed') {
    job.status = 'upcoming';
    if (job.hoursWorked && job.hoursPlanned === undefined) job.hoursPlanned = true;
  }

  // The other way round: a shift whose day has passed, with its call and wrap
  // times, is already counted as worked — but an offer saved before the day
  // kept saying "upcoming" for ever after, so its dot and label disagreed
  // with its pay. Hours typed in ahead as a plan are left for you to confirm.
  if (job.date < today && (job.status === 'upcoming' || job.status === 'in-progress')
      && job.startTime && job.endTime && !job.hoursPlanned) {
    job.status = 'completed';
  }

  return job;
}

export function hasLedger(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function loadLedger(key: string): AppData {
  try {
    const raw = localStorage.getItem(key);
    const parsed: AppData = { ...EMPTY_LEDGER, ...(raw ? JSON.parse(raw) : {}) };
    parsed.jobs = (parsed.jobs || []).map(migrateJob);
    // The old Pay Outs page predates accounts having ledgers of their own:
    // what it saved belongs to the device's.
    if (key !== DEVICE_LEDGER_KEY) return parsed;
    const before = parsed.payouts || [];
    parsed.payouts = adoptStandalonePayouts(before);
    // Write adopted payments straight through, so the ledger in storage is
    // the record of them — not a copy rebuilt from the old key on every load,
    // which would quietly stop working the day that key went away.
    const saved = parsed.payouts === before || saveLedger(parsed, key);
    if (saved) markPayoutsAdopted(parsed.payouts);
    return parsed;
  } catch {
    return { ...EMPTY_LEDGER };
  }
}

export function saveLedger(data: AppData, key: string, opts?: { quiet?: boolean }): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (err) {
    // This runs inside a React state updater, so throwing here aborts the
    // update and takes the entire app down through the error boundary —
    // whose only offered escape is "Reset all data". Storage being full must
    // never cost the user their whole ledger.
    console.error('[store] could not persist app data', err);
    if (!opts?.quiet) {
      queueMicrotask(() => toast.error(
        "Out of storage — that change wasn't saved. Remove a pay stub photo or receipt to free up space."
      ));
    }
    return false;
  }
}

function uid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The ledger on screen, for the one caller that cannot reach the hook. */
let activeLedgerKey: string | null = null;

/**
 * Wipes this browser's copy of the ledger on screen — the crash screen's last
 * resort. Signed in, the account still has everything and the next sync
 * brings it back down, which is the point when what broke was this copy.
 */
export async function clearAllData() {
  const key = activeLedgerKey ?? DEVICE_LEDGER_KEY;
  try {
    localStorage.removeItem(key);
    if (key !== DEVICE_LEDGER_KEY) {
      localStorage.removeItem(syncMetaKeyFor(key.slice(DEVICE_LEDGER_KEY.length + 1)));
    }
  } catch {
    // Nothing more can be done from here.
  }
  window.location.href = '/';
}

// ── Main hook ───────────────────────────────────────────────────────────────

interface LedgerState {
  /** Which ledger: the device's, an account's, or null for none yet. */
  key: string | null;
  data: AppData;
}

const ledgerAt = (key: string | null): LedgerState => ({ key, data: key ? loadLedger(key) : EMPTY_LEDGER });

/**
 * The ledger on screen, and every way to change it.
 *
 * `key` names the ledger. Null means there isn't one yet — the session is
 * still loading — and nothing is saved meanwhile. `onLocalChange` hears about
 * every edit made here, record by record: it is what fills the sync's outbox.
 */
export function useAppData(key: string | null, onLocalChange?: (changes: LedgerChange[], key: string) => void) {
  const [state, setState] = useState<LedgerState>(() => ledgerAt(key));
  let current = state;
  if (state.key !== key) {
    // Switching accounts swaps the whole ledger. The key and the data move
    // together, so a save can never put one account's shifts under another's.
    current = ledgerAt(key);
    setState(current);
  }
  const stateRef = useRef(current);
  stateRef.current = current;
  activeLedgerKey = key;
  const onChangeRef = useRef(onLocalChange);
  onChangeRef.current = onLocalChange;

  const update = useCallback((updater: (prev: AppData) => AppData) => {
    // Taken once, outside the updater, so every record one save touches
    // carries the same time.
    const now = new Date().toISOString();
    setState(prev => {
      if (!prev.key) return prev;
      const next = updater(prev.data);
      if (next === prev.data) return prev;
      const { data, changes } = stampChanges(prev.data, next, now);
      // Keep what's on screen identical to what actually made it to disk.
      // Accepting the change in memory after a failed write is what makes
      // hours look saved, then come back blank on the next open.
      if (!saveLedger(data, prev.key)) return prev;
      if (changes.length) onChangeRef.current?.(changes, prev.key);
      const saved = { key: prev.key, data };
      stateRef.current = saved;
      return saved;
    });
  }, []);

  /**
   * Folds in what a sync brought down. Saved like any edit, but not stamped,
   * and not reported back to the sync as a local change — it came from there.
   * Resolves false when it could not be saved, or when the ledger on screen is
   * no longer the one the sync was for.
   */
  const applyRemote = useCallback((forKey: string, fn: (prev: AppData) => AppData) =>
    new Promise<boolean>(resolve => {
      setState(prev => {
        if (prev.key !== forKey) { resolve(false); return prev; }
        const next = fn(prev.data);
        if (next === prev.data) { resolve(true); return prev; }
        if (!saveLedger(next, forKey, { quiet: true })) { resolve(false); return prev; }
        const saved = { key: forKey, data: next };
        stateRef.current = saved;
        resolve(true);
        return saved;
      });
    }), []);

  /** The ledger as it stands right now, if it is still the one asked for. */
  const readLedger = useCallback((forKey: string): AppData | null =>
    stateRef.current.key === forKey ? stateRef.current.data : null, []);

  // ── Jobs ──────────────────────────────────────────────────────────────────

  const addJob = useCallback(async (job: Omit<Job, 'id' | 'createdAt'>): Promise<Job | null> => {
    if (isDuplicateJob(job, stateRef.current.data.jobs)) return null;
    const newJob: Job = { ...job, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, jobs: [newJob, ...prev.jobs] }));
    return newJob;
  }, [update]);

  const updateJob = useCallback(async (id: string, updates: Partial<Job>) => {
    update(prev => ({ ...prev, jobs: prev.jobs.map(j => j.id === id ? { ...j, ...updates } : j) }));
  }, [update]);

  const deleteJob = useCallback(async (id: string) => {
    update(prev => ({ ...prev, jobs: prev.jobs.filter(j => j.id !== id) }));
  }, [update]);

  // ── Expenses ──────────────────────────────────────────────────────────────

  const addExpense = useCallback(async (expense: Omit<Expense, 'id' | 'createdAt'>) => {
    const newExp: Expense = { ...expense, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, expenses: [newExp, ...prev.expenses] }));
  }, [update]);

  const updateExpense = useCallback(async (id: string, updates: Partial<Expense>) => {
    update(prev => ({ ...prev, expenses: prev.expenses.map(e => e.id === id ? { ...e, ...updates } : e) }));
  }, [update]);

  const deleteExpense = useCallback(async (id: string) => {
    update(prev => ({ ...prev, expenses: prev.expenses.filter(e => e.id !== id) }));
  }, [update]);

  // ── Income ────────────────────────────────────────────────────────────────

  const addIncome = useCallback(async (income: Omit<Income, 'id' | 'createdAt'>) => {
    const newInc: Income = { ...income, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, income: [newInc, ...prev.income] }));
  }, [update]);

  const updateIncome = useCallback(async (id: string, updates: Partial<Income>) => {
    update(prev => ({ ...prev, income: prev.income.map(i => i.id === id ? { ...i, ...updates } : i) }));
  }, [update]);

  const deleteIncome = useCallback(async (id: string) => {
    update(prev => ({ ...prev, income: prev.income.filter(i => i.id !== id) }));
  }, [update]);

  // ── Equipment ─────────────────────────────────────────────────────────────

  const addEquipment = useCallback(async (equip: Omit<Equipment, 'id' | 'createdAt'>) => {
    const newEq: Equipment = { ...equip, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, equipment: [newEq, ...prev.equipment] }));
  }, [update]);

  const updateEquipment = useCallback(async (id: string, updates: Partial<Equipment>) => {
    update(prev => ({ ...prev, equipment: prev.equipment.map(e => e.id === id ? { ...e, ...updates } : e) }));
  }, [update]);

  const deleteEquipment = useCallback(async (id: string) => {
    update(prev => ({ ...prev, equipment: prev.equipment.filter(e => e.id !== id) }));
  }, [update]);

  // ── Employers ─────────────────────────────────────────────────────────────

  const addEmployer = useCallback(async (employer: Omit<Employer, 'id' | 'createdAt'>) => {
    const newEmployer: Employer = { ...employer, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, employers: [newEmployer, ...prev.employers] }));
    return newEmployer;
  }, [update]);

  const updateEmployer = useCallback(async (id: string, updates: Partial<Employer>) => {
    update(prev => ({ ...prev, employers: prev.employers.map(e => e.id === id ? { ...e, ...updates } : e) }));
  }, [update]);

  const deleteEmployer = useCallback(async (id: string) => {
    update(prev => ({ ...prev, employers: prev.employers.filter(e => e.id !== id) }));
  }, [update]);

  // ── Calendar events (non-work) ───────────────────────────────────────────

  const addEvent = useCallback(async (event: Omit<CalendarEvent, 'id' | 'createdAt'>) => {
    const newEvent: CalendarEvent = { ...event, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, events: [newEvent, ...prev.events] }));
    return newEvent;
  }, [update]);

  const updateEvent = useCallback(async (id: string, updates: Partial<CalendarEvent>) => {
    update(prev => ({ ...prev, events: prev.events.map(e => e.id === id ? { ...e, ...updates } : e) }));
  }, [update]);

  const deleteEvent = useCallback(async (id: string) => {
    update(prev => ({ ...prev, events: prev.events.filter(e => e.id !== id) }));
  }, [update]);

  // ── Crew payments ─────────────────────────────────────────────────────────

  const addPayout = useCallback(async (payout: Omit<PayOut, 'id' | 'createdAt'>) => {
    const created: PayOut = { ...payout, id: uid(), createdAt: new Date().toISOString() };
    update(prev => ({ ...prev, payouts: [created, ...(prev.payouts ?? [])] }));
    return created;
  }, [update]);

  const deletePayout = useCallback(async (id: string) => {
    update(prev => ({ ...prev, payouts: (prev.payouts ?? []).filter(p => p.id !== id) }));
  }, [update]);

  // Replaces everything, through update() like any edit — so a replacement
  // that can't fit in storage fails the same visible way a save does, and
  // every record it drops reaches the sync as a deletion.
  const replaceAllData = useCallback(async (next: AppData) => {
    update(() => next);
  }, [update]);

  const data = current.data;
  return useMemo(() => ({
    data,
    loading: false,
    replaceAllData, applyRemote, readLedger,
    addJob, updateJob, deleteJob,
    addExpense, updateExpense, deleteExpense,
    addIncome, updateIncome, deleteIncome,
    addEquipment, updateEquipment, deleteEquipment,
    addEmployer, updateEmployer, deleteEmployer,
    addEvent, updateEvent, deleteEvent,
    addPayout, deletePayout,
  }), [
    data, replaceAllData, applyRemote, readLedger,
    addJob, updateJob, deleteJob,
    addExpense, updateExpense, deleteExpense,
    addIncome, updateIncome, deleteIncome,
    addEquipment, updateEquipment, deleteEquipment,
    addEmployer, updateEmployer, deleteEmployer,
    addEvent, updateEvent, deleteEvent,
    addPayout, deletePayout,
  ]);
}

/** Load-time repairs, reachable from tests without exporting them generally. */
export const __testables = { migrateJob, adoptStandalonePayouts };
