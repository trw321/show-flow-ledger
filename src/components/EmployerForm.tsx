import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { X } from 'lucide-react';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { CONTRACTS } from '@/lib/contracts';
import { payLagDays, payScheduleLabel } from '@/lib/payTiming';
import type { Employer, EmployerTaxProfile } from '@/lib/store';
import { FILING_STATUS_LABELS, type FilingStatus } from '@/lib/taxEstimate';
import { cn } from '@/lib/utils';

/**
 * An employer's terms: one form, wherever you reach it from. Settings, Manual
 * entry and a shift all open this, so there is one set of details to keep.
 */

export interface EmployerFormState {
  name: string;
  defaultHourlyRate: string;
  timekeepingApp: string;
  overtimeRule: Employer['overtimeRule'];
  threshold: string;
  nightPremiumEnabled: boolean;
  unionDuesPercent: string;
  unionLocal: string;
  estimatedTaxPercent: string;
  vacationPercent: string;
  retirementMatchPercent: string;
  payBy: 'hour' | 'day';
  defaultDayRate: string;
  dayRateHours: string;
  lateArrivalRule: Employer['lateArrivalRule'] | '';
  workerStatus: 'w2' | '1099';
  breakTheHour: boolean;
  roles: { name: string; rate: string; by: 'hour' | 'day' }[];
  payrollCompany: string;
  payPeriodStart: string;
  ptoEarnHours: string;
  ptoPerHoursWorked: string;
  ptoStartingHours: string;
  /** The W-4 filed with this employer says exempt. */
  w4Exempt: boolean;
  /** Filing status on the W-4 filed with this employer. */
  filingStatus: FilingStatus | '';
  taxProfiles: EmployerTaxProfile[];
  /** When they pay, as picked: weekly, bi-weekly, or anything else. */
  schedule: 'weekly' | 'bi-weekly' | 'other';
  /** The first check takes weeks to arrive, and then the schedule starts. */
  slowFirstCheck: boolean;
  firstCheckWeeks: string;
  payLagDays: string;
  /** Which contract the terms came from, or empty. */
  contract: string;
  dtThreshold: string;
  minimumCall: string;
  mealPenaltyAfter: string;
  nightEndHour: string;
  sixthSeventh: boolean;
}

export const EMPTY_EMPLOYER_FORM: EmployerFormState = { name: '', defaultHourlyRate: '', timekeepingApp: '', overtimeRule: 'daily', threshold: '', nightPremiumEnabled: true, unionDuesPercent: '', unionLocal: '', estimatedTaxPercent: '', vacationPercent: '', retirementMatchPercent: '', payBy: 'hour', defaultDayRate: '', dayRateHours: '',
  lateArrivalRule: '',
  // Breaking the hour is a union contract term. Some employers pay it and
  // some (Odeum) do not, so a new employer starts without it.
  workerStatus: 'w2', breakTheHour: false, roles: [], ptoEarnHours: '', ptoPerHoursWorked: '', ptoStartingHours: '',
  w4Exempt: false, filingStatus: '', taxProfiles: [], schedule: 'other', slowFirstCheck: false, firstCheckWeeks: '3', payLagDays: '',
  contract: '', dtThreshold: '', minimumCall: '', mealPenaltyAfter: '', nightEndHour: '', sixthSeventh: false,
  payrollCompany: '', payPeriodStart: '' };

/** `legacyExempt`: the old account-wide W-4 exempt switch, which an employer with no answer of its own still follows. */
export function employerToForm(e: Employer, legacyExempt = false): EmployerFormState {
  return {
    name: e.name,
    defaultHourlyRate: e.defaultHourlyRate?.toString() ?? '',
    timekeepingApp: e.timekeepingApp ?? '',
    overtimeRule: e.overtimeRule,
    threshold: (e.overtimeRule === 'weekly' ? e.weeklyOvertimeThresholdHours : e.dailyOvertimeThresholdHours)?.toString() ?? '',
    nightPremiumEnabled: e.nightPremiumEnabled ?? true,
    unionDuesPercent: e.unionDuesPercent?.toString() ?? '',
    unionLocal: e.unionLocal ?? '',
    estimatedTaxPercent: e.estimatedTaxPercent?.toString() ?? '',
    vacationPercent: e.vacationPercent?.toString() ?? '',
    retirementMatchPercent: e.retirementMatchPercent?.toString() ?? '',
    payBy: e.defaultDayRate ? 'day' : 'hour',
    defaultDayRate: e.defaultDayRate?.toString() ?? '',
    dayRateHours: e.dayRateHours?.toString() ?? '',
    lateArrivalRule: e.lateArrivalRule ?? '',
    workerStatus: e.workerStatus ?? 'w2',
    breakTheHour: e.roundUpToWholeHours ?? false,
    roles: (e.roles ?? []).map(r => ({ name: r.name, rate: (r.hourlyRate ?? r.dayRate)?.toString() ?? '', by: r.dayRate && !r.hourlyRate ? 'day' as const : 'hour' as const })),
    payrollCompany: e.payrollCompany ?? '',
    payPeriodStart: e.payPeriodStart ?? '',
    ptoEarnHours: e.ptoEarnHours?.toString() ?? '',
    ptoPerHoursWorked: e.ptoPerHoursWorked?.toString() ?? '',
    ptoStartingHours: e.ptoStartingHours?.toString() ?? '',
    w4Exempt: e.w4Exempt ?? legacyExempt,
    filingStatus: e.filingStatus ?? '',
    taxProfiles: e.taxProfiles ?? [],
    schedule: e.paySchedule === 'weekly' || e.paySchedule === 'bi-weekly' ? e.paySchedule : 'other',
    slowFirstCheck: !!e.firstCheckWeeks,
    firstCheckWeeks: e.firstCheckWeeks?.toString() ?? '3',
    payLagDays: e.payLagDays?.toString() ?? '',
    contract: e.contract ?? '',
    dtThreshold: e.dailyDoubletimeThresholdHours?.toString() ?? '',
    minimumCall: e.minimumCallHours?.toString() ?? '',
    mealPenaltyAfter: e.mealPenaltyAfterHours?.toString() ?? '',
    nightEndHour: e.nightPremiumEndHour?.toString() ?? '',
    sixthSeventh: e.sixthSeventhDayRule ?? false,
  };
}

/** A contract's terms, filled into the form. Whatever it says nothing about stays as it was. */
function withContract(f: EmployerFormState, key: string): EmployerFormState {
  const contract = CONTRACTS.find(c => c.key === key);
  if (!contract) return { ...f, contract: '' };
  const t = contract.terms;
  const text = (n: number | undefined, was: string) => (n === undefined ? was : String(n));
  const newRoles = (t.roles ?? []).filter(r => !f.roles.some(have => have.name === r.name));
  return {
    ...f,
    contract: key,
    overtimeRule: t.overtimeRule ?? f.overtimeRule,
    threshold: text(t.dailyOvertimeThresholdHours, f.threshold),
    dtThreshold: text(t.dailyDoubletimeThresholdHours, f.dtThreshold),
    breakTheHour: t.roundUpToWholeHours ?? f.breakTheHour,
    nightPremiumEnabled: t.nightPremiumEnabled ?? f.nightPremiumEnabled,
    nightEndHour: text(t.nightPremiumEndHour, f.nightEndHour),
    mealPenaltyAfter: text(t.mealPenaltyAfterHours, f.mealPenaltyAfter),
    minimumCall: text(t.minimumCallHours, f.minimumCall),
    sixthSeventh: t.sixthSeventhDayRule ?? f.sixthSeventh,
    vacationPercent: text(t.vacationPercent, f.vacationPercent),
    unionLocal: t.unionLocal ?? f.unionLocal,
    defaultHourlyRate: text(t.defaultHourlyRate, f.defaultHourlyRate),
    roles: [...f.roles, ...newRoles.map(r => ({ name: r.name, rate: (r.hourlyRate ?? r.dayRate)?.toString() ?? '', by: r.dayRate && !r.hourlyRate ? 'day' as const : 'hour' as const }))],
    schedule: t.paySchedule === 'weekly' || t.paySchedule === 'bi-weekly' ? t.paySchedule : f.schedule,
    payLagDays: t.payLagDays?.toString() ?? '',
  };
}

/** The employer's terms from the form — shared by adding and editing, so the two cannot drift. */
function formTerms(form: EmployerFormState): Partial<Employer> {
  const num = (v: string) => (v.trim() ? parseFloat(v) : undefined);
  return {
    workerStatus: form.workerStatus,
    lateArrivalRule: form.lateArrivalRule || undefined,
    roundUpToWholeHours: form.breakTheHour,
    roles: form.roles
      .filter(r => r.name.trim())
      .map(r => (r.by === 'day'
        ? { name: r.name.trim(), dayRate: num(r.rate) }
        : { name: r.name.trim(), hourlyRate: num(r.rate) })),
    payrollCompany: form.payrollCompany.trim() || undefined,
    payPeriodStart: form.payPeriodStart || undefined,
    ptoEarnHours: num(form.ptoEarnHours),
    ptoPerHoursWorked: num(form.ptoPerHoursWorked),
    ptoStartingHours: num(form.ptoStartingHours),
    // A W-4 is a W2 thing; 1099 withholds nothing either way.
    w4Exempt: form.workerStatus === 'w2' ? form.w4Exempt : undefined,
    filingStatus: form.workerStatus === 'w2' ? (form.filingStatus || undefined) : undefined,
    taxProfiles: form.workerStatus === 'w2' ? form.taxProfiles : undefined,
    // When they pay. A delay only counts while the switch is on, so a stale
    // one cannot sit behind a plain weekly schedule.
    paySchedule: form.schedule === 'other' ? undefined : form.schedule,
    firstCheckWeeks: form.slowFirstCheck ? num(form.firstCheckWeeks) ?? 3 : undefined,
    payLagDays: num(form.payLagDays),
    contract: form.contract || undefined,
    dailyDoubletimeThresholdHours: form.overtimeRule === 'daily' ? num(form.dtThreshold) : undefined,
    minimumCallHours: num(form.minimumCall),
    mealPenaltyAfterHours: num(form.mealPenaltyAfter),
    nightPremiumEndHour: form.nightPremiumEnabled ? num(form.nightEndHour) : undefined,
    sixthSeventhDayRule: form.sixthSeventh,
  };
}

export function EmployerForm({ initial, onSave, onCancel }: {
  initial: EmployerFormState;
  onSave: (form: EmployerFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const { prefs } = useUserPrefs();
  const yourRate = prefs.payer.tax?.federalEffectivePercent;
  const setTaxProfile = (year: number, patch: Partial<EmployerTaxProfile>) => setForm(f => ({
    ...f,
    taxProfiles: f.taxProfiles.map(profile => profile.taxYear === year ? { ...profile, ...patch } : profile),
  }));
  const addTaxProfile = () => setForm(f => {
    const currentYear = new Date().getFullYear();
    const taxYear = f.taxProfiles.some(profile => profile.taxYear === currentYear)
      ? Math.max(currentYear, ...f.taxProfiles.map(profile => profile.taxYear)) + 1
      : currentYear;
    return { ...f, taxProfiles: [...f.taxProfiles, { taxYear }].sort((a, b) => a.taxYear - b.taxYear) };
  });
  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl border border-primary/30 bg-primary/5">
      <Input
        placeholder="Employer name"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        className="h-8 text-sm"
        autoFocus
      />
      {/* A company's own terms fill in everything below at once. Union contracts go by the shift, so they are not here. */}
      <div className="space-y-1">
        <p className="text-xs">Company terms</p>
        <Select value={form.contract || 'none'} onValueChange={v => setForm(f => withContract(f, v))}>
          <SelectTrigger className="h-8 text-xs" aria-label="Company terms"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {CONTRACTS.filter(c => c.perEmployer || c.key === form.contract).map(c => <SelectItem key={c.key} value={c.key}>{c.name} · {c.version}</SelectItem>)}
          </SelectContent>
        </Select>
        {CONTRACTS.find(c => c.key === form.contract)?.caution && (
          <p className="text-[10px] text-warning">{CONTRACTS.find(c => c.key === form.contract)!.caution}</p>
        )}
        {form.contract && (
          <p className="text-[10px] text-muted-foreground">
            Filled in below, and you can change any of it. Once saved, overtime, night and 6th/7th day pay count on
            this employer's past shifts too. The minimum call is for new shifts.
          </p>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs">Late arrival estimate</p>
        <Select value={form.lateArrivalRule || 'unset'} onValueChange={value => setForm(f => ({ ...f, lateArrivalRule: value === 'unset' ? '' : value as EmployerFormState['lateArrivalRule'] }))}>
          <SelectTrigger className="h-8 text-xs" aria-label="Late arrival estimate"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="unset">Not set</SelectItem>
            <SelectItem value="actual_clock_in">Use actual clock-in time</SelectItem>
            <SelectItem value="scheduled_start">Keep scheduled start</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">Used when you mark a shift late. The offer still supplies its rate and pay terms.</p>
      </div>
      {/* W2 takes tax out of each check; 1099 takes nothing, and it is all
          still owed at the year end, self-employment tax included. */}
      <div className="grid grid-cols-2 gap-1.5">
        {(['w2', '1099'] as const).map(status => (
          <button
            key={status}
            type="button"
            aria-pressed={form.workerStatus === status}
            onClick={() => setForm(f => ({ ...f, workerStatus: status }))}
            className={cn('pixel-button py-1.5 text-[11px] font-bold', form.workerStatus === status ? 'pick-on' : 'pick-off')}
          >
            {status === 'w2' ? 'W2 — tax withheld' : '1099 — nothing withheld'}
          </button>
        ))}
      </div>
      {/* Tax is this employer's: the W-4 you filed with it says exempt or
          not, and how much comes out. */}
      {form.workerStatus === 'w2' ? (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs">Federal tax this employer takes out</p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">Filing status on this W-4</span>
            <Select value={form.filingStatus || 'unset'} onValueChange={v => setForm(f => ({ ...f, filingStatus: v === 'unset' ? '' : v as FilingStatus }))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Not recorded</SelectItem>
                {(Object.keys(FILING_STATUS_LABELS) as FilingStatus[]).map(status => (
                  <SelectItem key={status} value={status}>{FILING_STATUS_LABELS[status]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { exempt: false, label: 'Withheld' },
              { exempt: true, label: 'W-4 exempt' },
            ]).map(({ exempt, label }) => (
              <button
                key={label}
                type="button"
                aria-pressed={form.w4Exempt === exempt}
                onClick={() => setForm(f => ({ ...f, w4Exempt: exempt }))}
                className={cn('pixel-button py-1.5 text-[11px] font-bold', form.w4Exempt === exempt ? 'pick-on' : 'pick-off')}
              >
                {label}
              </button>
            ))}
          </div>
          {form.w4Exempt ? (
            <p className="text-[10px] text-muted-foreground">
              No federal income tax comes out. Social Security and Medicare still do, and the federal
              tax is still owed when you file — Money counts it.
            </p>
          ) : (
            <Input
              type="number"
              step="0.1"
              min="0"
              placeholder={yourRate ? `Withheld % — blank uses your ${yourRate}%` : 'Withheld % (e.g. 12)'}
              value={form.estimatedTaxPercent}
              onChange={e => setForm(f => ({ ...f, estimatedTaxPercent: e.target.value }))}
              className="h-8 text-xs"
            />
          )}
          <details className="rounded-md border border-border px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <summary className="cursor-pointer text-[11px] font-medium">Tax settings by year</summary>
              <button type="button" className="text-[11px] text-primary" onClick={addTaxProfile}>Add year</button>
            </div>
            <p className="py-2 text-[10px] text-muted-foreground">Blank fields use the global tax profile above. Keep a separate row when this employer's state or W-4 changes.</p>
            <div className="space-y-2">
              {form.taxProfiles.map(profile => (
                <div key={profile.taxYear} className="space-y-1.5 rounded-md bg-secondary/20 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">{profile.taxYear}</span>
                    <button type="button" className="text-[10px] text-destructive" aria-label={`Remove ${profile.taxYear} tax profile`}
                      onClick={() => setForm(f => ({ ...f, taxProfiles: f.taxProfiles.filter(item => item.taxYear !== profile.taxYear) }))}>Remove</button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input maxLength={2} placeholder={`State · ${prefs.payer.tax?.state ?? 'global'}`} value={profile.state ?? ''}
                      onChange={event => setTaxProfile(profile.taxYear, { state: event.target.value.toUpperCase() || undefined })} className="h-8 text-xs" aria-label={`${profile.taxYear} state`} />
                    <Select value={profile.filingStatus ?? 'inherit'} onValueChange={value => setTaxProfile(profile.taxYear, { filingStatus: value === 'inherit' ? undefined : value as FilingStatus })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">Global filing status</SelectItem>
                        {(Object.keys(FILING_STATUS_LABELS) as FilingStatus[]).map(status => <SelectItem key={status} value={status}>{FILING_STATUS_LABELS[status]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Select value={profile.w4Exempt === undefined ? 'inherit' : profile.w4Exempt ? 'exempt' : 'withheld'} onValueChange={value => setTaxProfile(profile.taxYear, { w4Exempt: value === 'inherit' ? undefined : value === 'exempt' })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">Use default exempt setting</SelectItem>
                      <SelectItem value="exempt">W-4 exempt this year</SelectItem>
                      <SelectItem value="withheld">Not exempt this year</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-3 gap-1.5">
                    <Input type="number" min="0" step="0.1" placeholder={`Fed %${yourRate ? ` · ${yourRate}` : ''}`} value={profile.federalWithholdingPercent ?? ''}
                      onChange={event => setTaxProfile(profile.taxYear, { federalWithholdingPercent: event.target.value ? Number(event.target.value) : undefined })} className="h-8 text-xs" aria-label={`${profile.taxYear} federal withholding percent`} />
                    <Input type="number" min="0" step="0.1" placeholder={`State %${prefs.payer.tax?.stateTaxPercent ? ` · ${prefs.payer.tax.stateTaxPercent}` : ''}`} value={profile.stateTaxPercent ?? ''}
                      onChange={event => setTaxProfile(profile.taxYear, { stateTaxPercent: event.target.value ? Number(event.target.value) : undefined })} className="h-8 text-xs" aria-label={`${profile.taxYear} state tax percent`} />
                    <Input type="number" min="0" step="0.1" placeholder="SDI %" value={profile.stateDisabilityPercent ?? ''}
                      onChange={event => setTaxProfile(profile.taxYear, { stateDisabilityPercent: event.target.value ? Number(event.target.value) : undefined })} className="h-8 text-xs" aria-label={`${profile.taxYear} disability percent`} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">Nothing is withheld. The tax on it shows on Money as still to pay.</p>
      )}
      {/* When they pay — so "waiting on pay" only sounds once it is late. */}
      <div className="space-y-1.5 pt-1">
        <p className="text-xs">When they pay</p>
        <div className="grid grid-cols-3 gap-1.5">
          {([
            { id: 'weekly' as const, label: 'Weekly' },
            { id: 'bi-weekly' as const, label: 'Bi-weekly' },
            { id: 'other' as const, label: 'Other' },
          ]).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={form.schedule === id}
              onClick={() => setForm(f => ({ ...f, schedule: id }))}
              className={cn('pixel-button px-1 py-1.5 text-[11px] font-bold', form.schedule === id ? 'pick-on' : 'pick-off')}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Goes with a schedule, not instead of one: the first check is slow,
            and then weekly or bi-weekly takes over. */}
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-[11px]">Slow first check</span>
            <span className="block text-[10px] text-muted-foreground">It takes weeks to arrive, then the schedule kicks in.</span>
          </span>
          <Switch aria-label="Slow first check" checked={form.slowFirstCheck} onCheckedChange={on => setForm(f => ({ ...f, slowFirstCheck: on }))} />
        </div>
        {form.slowFirstCheck && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>First check</span>
            <Input type="number" step="1" min="1" aria-label="Weeks until the first check" value={form.firstCheckWeeks}
              onChange={e => setForm(f => ({ ...f, firstCheckWeeks: e.target.value }))} className="h-8 w-14 text-xs" />
            <span>weeks after your first day{form.schedule === 'other' ? '' : `, then ${form.schedule}`}</span>
          </div>
        )}
        {form.schedule !== 'other' && (
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>A pay period started on</span>
            <Input type="date" aria-label="A day a pay period started" value={form.payPeriodStart}
              onChange={e => setForm(f => ({ ...f, payPeriodStart: e.target.value }))} className="h-8 w-36 text-xs" />
            <span className="basis-full text-[10px]">Any one will do. It's how the app spots a project crossing into the next pay period.</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Paid within</span>
          <Input type="number" step="1" min="1" aria-label="Paid within this many days of the work"
            placeholder={String(payLagDays({ paySchedule: form.schedule === 'other' ? undefined : form.schedule } as Employer))}
            value={form.payLagDays}
            onChange={e => setForm(f => ({ ...f, payLagDays: e.target.value }))} className="h-8 w-14 text-xs" />
          <span>days of the work{form.schedule === 'other' ? " — blank if you don't know" : ''}</span>
        </div>
      </div>
      {/* How this employer pays. A day rate is a flat amount for the day,
          paid in full however short it was, with overtime past the hours it
          covers — common enough in corporate AV that it needs its own shape
          rather than being faked as an hourly rate. */}
      <div className="grid grid-cols-2 gap-1.5">
        {([
          { by: 'hour' as const, label: 'By the hour' },
          { by: 'day' as const, label: 'Day rate' },
        ]).map(({ by, label }) => (
          <button
            key={by}
            type="button"
            aria-pressed={form.payBy === by}
            onClick={() => setForm(f => ({ ...f, payBy: by }))}
            className={cn(
              'pixel-button py-1.5 text-[11px] font-bold',
              form.payBy === by ? 'pick-on' : 'pick-off',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {form.payBy === 'day' && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            step="0.01"
            placeholder="Day rate ($)"
            value={form.defaultDayRate}
            onChange={e => setForm(f => ({ ...f, defaultDayRate: e.target.value }))}
            className="h-8 text-xs"
          />
          <Input
            type="number"
            step="0.5"
            placeholder="Covers (hours) — 10"
            value={form.dayRateHours}
            onChange={e => setForm(f => ({ ...f, dayRateHours: e.target.value }))}
            className="h-8 text-xs"
            title="How many hours the day rate covers. Past that is overtime at 1.5× the hourly equivalent."
          />
          <p className="col-span-2 text-[10px] text-muted-foreground">
            Paid in full however short the day. Past {form.dayRateHours || '10'} hours is overtime at
            1.5× {form.defaultDayRate
              ? '$' + (parseFloat(form.defaultDayRate) / (parseFloat(form.dayRateHours) || 10)).toFixed(2) + '/hr'
              : 'the hourly equivalent'}.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          step="0.01"
          placeholder="Rate ($/hr)"
          value={form.defaultHourlyRate}
          onChange={e => setForm(f => ({ ...f, defaultHourlyRate: e.target.value }))}
          className={cn('h-8 text-xs', form.payBy === 'day' && 'hidden')}
        />
        <Select value={form.overtimeRule} onValueChange={v => setForm(f => ({ ...f, overtimeRule: v as Employer['overtimeRule'], threshold: '' }))}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily OT</SelectItem>
            <SelectItem value="weekly">Weekly OT</SelectItem>
            <SelectItem value="none">No OT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {/* Roles paid differently under the same employer: A1 at one rate,
          stagehand at another, one of them by the day if that's the deal. A
          shift picks its role and takes its pay. */}
      <div className="space-y-1.5 pt-1">
        <p className="text-xs">Roles with their own pay</p>
        {form.roles.map((role, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              placeholder="Role (e.g. A1)"
              aria-label={`Role ${i + 1}`}
              value={role.name}
              onChange={e => setForm(f => ({ ...f, roles: f.roles.map((r, ri) => ri === i ? { ...r, name: e.target.value } : r) }))}
              className="h-8 text-xs flex-1 min-w-0"
            />
            <Input
              type="number"
              step="0.01"
              placeholder="$"
              aria-label={`Role ${i + 1} pay`}
              value={role.rate}
              onChange={e => setForm(f => ({ ...f, roles: f.roles.map((r, ri) => ri === i ? { ...r, rate: e.target.value } : r) }))}
              className="h-8 text-xs w-20"
            />
            <button
              type="button"
              aria-label={`Role ${i + 1} paid by the ${role.by === 'day' ? 'day' : 'hour'}. Tap to change.`}
              onClick={() => setForm(f => ({ ...f, roles: f.roles.map((r, ri) => ri === i ? { ...r, by: r.by === 'day' ? 'hour' : 'day' } : r) }))}
              className="pixel-button pick-off h-8 w-12 shrink-0 text-[11px] font-bold"
            >
              {role.by === 'day' ? '/day' : '/hr'}
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, roles: f.roles.filter((_, ri) => ri !== i) }))}
              className="p-1 text-muted-foreground hover:text-destructive"
              aria-label="Remove role"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setForm(f => ({ ...f, roles: [...f.roles, { name: '', rate: '', by: f.payBy }] }))}
          className="pixel-button pick-off w-full py-1.5 text-[11px] font-bold"
        >
          + Add a role
        </button>
      </div>
      {form.overtimeRule !== 'none' && (
        <div className={cn('grid gap-2', form.overtimeRule === 'daily' && 'grid-cols-2')}>
          <Input
            type="number"
            placeholder={form.overtimeRule === 'weekly' ? 'OT after N hrs/week (default 40)' : 'OT after hrs/day (8)'}
            aria-label="Overtime after this many hours"
            value={form.threshold}
            onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
            className="h-8 text-xs"
          />
          {form.overtimeRule === 'daily' && (
            <Input
              type="number"
              placeholder="2× after hrs/day (12)"
              aria-label="Double time after this many hours"
              value={form.dtThreshold}
              onChange={e => setForm(f => ({ ...f, dtThreshold: e.target.value }))}
              className="h-8 text-xs"
            />
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          step="0.5"
          placeholder="Minimum call (hrs)"
          aria-label="Minimum call in hours"
          title="What a new shift for this employer starts with"
          value={form.minimumCall}
          onChange={e => setForm(f => ({ ...f, minimumCall: e.target.value }))}
          className="h-8 text-xs"
        />
        <Input
          type="number"
          step="0.5"
          placeholder="Meal due after (5)"
          aria-label="Meal due after this many hours"
          value={form.mealPenaltyAfter}
          onChange={e => setForm(f => ({ ...f, mealPenaltyAfter: e.target.value }))}
          className="h-8 text-xs"
        />
      </div>
      <Input
        placeholder="Payroll company"
        aria-label="Payroll company"
        value={form.payrollCompany}
        onChange={e => setForm(f => ({ ...f, payrollCompany: e.target.value }))}
        className="h-8 text-xs"
      />
      <Input
        placeholder="Timekeeping app (if not payroll)"
        value={form.timekeepingApp}
        onChange={e => setForm(f => ({ ...f, timekeepingApp: e.target.value }))}
        className="h-8 text-xs"
      />
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs">
          Break the hour (union contract)
          <span className="block text-[10px] text-muted-foreground">A part hour worked pays as a whole one — 8h15m pays 9. Only if this employer's contract does.</span>
        </span>
        <Switch
          checked={form.breakTheHour}
          onCheckedChange={v => setForm(f => ({ ...f, breakTheHour: v }))}
        />
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs">Night premium (midnight = 2×)</span>
        <Switch
          checked={form.nightPremiumEnabled}
          onCheckedChange={v => setForm(f => ({ ...f, nightPremiumEnabled: v }))}
        />
      </div>
      {form.nightPremiumEnabled && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Ends at</span>
          <Input type="number" min="0" max="23" aria-label="Night premium ends at this hour" value={form.nightEndHour}
            onChange={e => setForm(f => ({ ...f, nightEndHour: e.target.value }))} className="h-8 w-14 text-xs" />
          <span>:00 (8 is 8 AM) — blank runs to the end of the shift</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs">
          6th and 7th day pay
          <span className="block text-[10px] text-muted-foreground">The 6th day in a row pays 1.5×, the 7th 2×.</span>
        </span>
        <Switch
          aria-label="6th and 7th day pay"
          checked={form.sixthSeventh}
          onCheckedChange={v => setForm(f => ({ ...f, sixthSeventh: v }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          step="0.1"
          min="0"
          placeholder="Union dues % (e.g. 3.5)"
          value={form.unionDuesPercent}
          onChange={e => setForm(f => ({ ...f, unionDuesPercent: e.target.value }))}
          className="h-8 text-xs"
        />
        <Input
          placeholder="IATSE local # (e.g. 16)"
          value={form.unionLocal}
          onChange={e => setForm(f => ({ ...f, unionLocal: e.target.value }))}
          className="h-8 text-xs"
        />
        <Input
          type="number"
          step="0.1"
          min="0"
          placeholder="Vacation % (e.g. 6)"
          value={form.vacationPercent}
          onChange={e => setForm(f => ({ ...f, vacationPercent: e.target.value }))}
          className="h-8 text-xs"
          title="Vacation/fringe pay added on top of gross — leave blank if this employer doesn't pay it"
        />
        <Input
          type="number"
          step="0.1"
          min="0"
          placeholder="401k match % (e.g. 6)"
          value={form.retirementMatchPercent}
          onChange={e => setForm(f => ({ ...f, retirementMatchPercent: e.target.value }))}
          className="h-8 text-xs"
          title="A percentage of gross this employer owes into your retirement plan. Owed to the plan, not to you, so it never counts as take-home — tracked so a missing one is visible."
        />
      </div>
      {/* Paid time off earned with this employer, and what is banked. */}
      <div className="space-y-1.5 pt-1">
        <p className="text-xs">Paid time off (PTO)</p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>Earn</span>
          <Input type="number" step="0.1" min="0" placeholder="1" value={form.ptoEarnHours}
            onChange={e => setForm(f => ({ ...f, ptoEarnHours: e.target.value }))} className="h-8 text-xs w-16" />
          <span>h per</span>
          <Input type="number" step="1" min="1" placeholder="30" value={form.ptoPerHoursWorked}
            onChange={e => setForm(f => ({ ...f, ptoPerHoursWorked: e.target.value }))} className="h-8 text-xs w-16" />
          <span>h worked</span>
        </div>
        <Input type="number" step="0.1" min="0" placeholder="Already banked (hours)" value={form.ptoStartingHours}
          onChange={e => setForm(f => ({ ...f, ptoStartingHours: e.target.value }))} className="h-8 text-xs" />
      </div>
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={!form.name.trim()} onClick={() => onSave(form)}>Save</Button>
      </div>
    </div>
  );
}

/** The employer as the form has it, for adding one or saving over one. */
export function employerFromForm(form: EmployerFormState): Omit<Employer, 'id' | 'createdAt'> {
  return {
    name: form.name.trim(),
    defaultHourlyRate: form.defaultHourlyRate ? parseFloat(form.defaultHourlyRate) : undefined,
    timekeepingApp: form.timekeepingApp.trim() || undefined,
    overtimeRule: form.overtimeRule,
    weeklyOvertimeThresholdHours: form.overtimeRule === 'weekly' ? parseFloat(form.threshold || '40') : undefined,
    dailyOvertimeThresholdHours: form.overtimeRule === 'daily' ? parseFloat(form.threshold || '8') : undefined,
    nightPremiumEnabled: form.nightPremiumEnabled,
    nightPremiumMultiplier: 2.0,
    unionDuesPercent: form.unionDuesPercent ? parseFloat(form.unionDuesPercent) : undefined,
    unionLocal: form.unionLocal.trim() || undefined,
    estimatedTaxPercent: form.workerStatus === 'w2' && form.estimatedTaxPercent ? parseFloat(form.estimatedTaxPercent) : undefined,
    vacationPercent: form.vacationPercent ? parseFloat(form.vacationPercent) : undefined,
    retirementMatchPercent: form.retirementMatchPercent ? parseFloat(form.retirementMatchPercent) : undefined,
    // Only one of the two is the employer's way of paying; the other is
    // cleared so a stale hourly rate cannot sit behind a day rate.
    defaultDayRate: form.payBy === 'day' && form.defaultDayRate ? parseFloat(form.defaultDayRate) : undefined,
    dayRateHours: form.payBy === 'day' && form.dayRateHours ? parseFloat(form.dayRateHours) : undefined,
    ...formTerms(form),
  };
}

/** How an employer works, in a line. */
export function employerSummary(e: Employer): string {
  return [
    e.workerStatus === '1099' ? '1099' : 'W2',
    e.defaultDayRate ? `$${e.defaultDayRate}/day` : e.defaultHourlyRate ? `$${e.defaultHourlyRate}/hr` : null,
    payScheduleLabel(e) || null,
    e.roundUpToWholeHours ? 'breaks the hour' : null,
    e.minimumCallHours ? `${e.minimumCallHours}h minimum` : null,
  ].filter(Boolean).join(' · ');
}
