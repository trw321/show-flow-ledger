import { useState } from 'react';
import TaxAndLocalsSettings from '@/components/TaxAndLocalsSettings';
import ThemePicker from '@/components/ThemePicker';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useUserPrefs, TAB_LABELS, WORKER_PRESETS, type TabKey, type WorkerType } from '@/lib/UserPrefsContext';
import { useData, useSync } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import PageHeader from '@/components/PageHeader';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Briefcase, FileText, Crown, SlidersHorizontal, Trash2, Plus, Pencil, X, CloudOff, Cloud, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Employer } from '@/lib/store';
import { ptoBalance } from '@/lib/pto';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const WORKER_OPTIONS: { type: 'w2' | '1099' | 'boss'; label: string; subtitle: string; icon: React.ElementType }[] = [
  {
    type: 'w2',
    label: 'W2 Employee',
    subtitle: 'Employer handles taxes & payroll',
    icon: Briefcase,
  },
  {
    type: '1099',
    label: '1099 Contractor',
    subtitle: 'Self-employed, track everything',
    icon: FileText,
  },
  {
    type: 'boss',
    label: 'Boss',
    subtitle: 'Owner/operator with crew & gear',
    icon: Crown,
  },
];

const TAB_ORDER: TabKey[] = ['expenses', 'income', 'payouts'];

interface EmployerFormState {
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
  workerStatus: 'w2' | '1099';
  breakTheHour: boolean;
  roles: { name: string; rate: string }[];
  ptoEarnHours: string;
  ptoPerHoursWorked: string;
  ptoStartingHours: string;
}

const EMPTY_EMPLOYER_FORM: EmployerFormState = { name: '', defaultHourlyRate: '', timekeepingApp: '', overtimeRule: 'daily', threshold: '', nightPremiumEnabled: true, unionDuesPercent: '', unionLocal: '', estimatedTaxPercent: '', vacationPercent: '', retirementMatchPercent: '', payBy: 'hour', defaultDayRate: '', dayRateHours: '',
  // Breaking the hour is a union contract term. Some employers pay it and
  // some (Odeum) do not, so a new employer starts without it.
  workerStatus: 'w2', breakTheHour: false, roles: [], ptoEarnHours: '', ptoPerHoursWorked: '', ptoStartingHours: '' };

function employerToForm(e: Employer): EmployerFormState {
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
    workerStatus: e.workerStatus ?? 'w2',
    breakTheHour: e.roundUpToWholeHours ?? false,
    roles: (e.roles ?? []).map(r => ({ name: r.name, rate: (r.hourlyRate ?? r.dayRate)?.toString() ?? '' })),
    ptoEarnHours: e.ptoEarnHours?.toString() ?? '',
    ptoPerHoursWorked: e.ptoPerHoursWorked?.toString() ?? '',
    ptoStartingHours: e.ptoStartingHours?.toString() ?? '',
  };
}

/** The employer's terms from the form — shared by adding and editing, so the two cannot drift. */
function formTerms(form: EmployerFormState): Partial<Employer> {
  const num = (v: string) => (v.trim() ? parseFloat(v) : undefined);
  return {
    workerStatus: form.workerStatus,
    roundUpToWholeHours: form.breakTheHour,
    roles: form.roles
      .filter(r => r.name.trim())
      .map(r => (form.payBy === 'day'
        ? { name: r.name.trim(), dayRate: num(r.rate) }
        : { name: r.name.trim(), hourlyRate: num(r.rate) })),
    ptoEarnHours: num(form.ptoEarnHours),
    ptoPerHoursWorked: num(form.ptoPerHoursWorked),
    ptoStartingHours: num(form.ptoStartingHours),
  };
}

function EmployerForm({ initial, onSave, onCancel }: {
  initial: EmployerFormState;
  onSave: (form: EmployerFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  return (
    <div className="flex flex-col gap-2 p-3 rounded-xl border border-primary/30 bg-primary/5">
      <Input
        placeholder="Employer name"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        className="h-8 text-sm"
        autoFocus
      />
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
      {form.overtimeRule !== 'none' && (
        <Input
          type="number"
          placeholder={form.overtimeRule === 'weekly' ? 'OT after N hrs/week (default 40)' : 'OT after N hrs/day (default 8)'}
          value={form.threshold}
          onChange={e => setForm(f => ({ ...f, threshold: e.target.value }))}
          className="h-8 text-xs"
        />
      )}
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
          placeholder="Est. tax % (e.g. 20)"
          value={form.estimatedTaxPercent}
          onChange={e => setForm(f => ({ ...f, estimatedTaxPercent: e.target.value }))}
          className="h-8 text-xs"
          title="Rough estimate only — leave blank for 1099/self-employed work with no withholding"
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
      {/* Roles paid differently under the same employer — A1 at one rate,
          stagehand at another. A shift picks its role and takes its rate. */}
      <div className="space-y-1.5 pt-1">
        <p className="text-xs">Roles with their own pay</p>
        {form.roles.map((role, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              placeholder="Role (e.g. A1)"
              value={role.name}
              onChange={e => setForm(f => ({ ...f, roles: f.roles.map((r, ri) => ri === i ? { ...r, name: e.target.value } : r) }))}
              className="h-8 text-xs flex-1"
            />
            <Input
              type="number"
              step="0.01"
              placeholder={form.payBy === 'day' ? 'Day rate $' : 'Rate $/hr'}
              value={role.rate}
              onChange={e => setForm(f => ({ ...f, roles: f.roles.map((r, ri) => ri === i ? { ...r, rate: e.target.value } : r) }))}
              className="h-8 text-xs w-28"
            />
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, roles: f.roles.filter((_, ri) => ri !== i) }))}
              className="p-1.5 text-muted-foreground hover:text-destructive"
              aria-label="Remove role"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setForm(f => ({ ...f, roles: [...f.roles, { name: '', rate: '' }] }))}
          className="text-[11px] text-foreground/80 underline"
        >
          + Add a role
        </button>
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

// Signing in is optional and changes nothing about how the app works — it
// adds sync. Until then everything lives in this browser, which is worth
// saying plainly rather than leaving the user to find out.
function AccountSection() {
  const { user, loading, signOut } = useAuth();
  const { deviceLedgerCount, addDeviceDataToAccount, sessionLapsed } = useData();
  const sync = useSync();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [adding, setAdding] = useState(false);

  if (loading) return null;

  // Whatever has not gone up yet goes first. Nothing is lost if it can't —
  // unsent changes stay on this device under the account and go up the next
  // time it signs in here — but leaving with them sent is better.
  const leave = async () => {
    setSigningOut(true);
    await Promise.race([sync.syncNow(), new Promise(resolve => setTimeout(resolve, 5000))]);
    await signOut();
  };

  const addThem = async () => {
    setAdding(true);
    try {
      if (await addDeviceDataToAccount()) toast.success('Added — syncing it to your account');
    } finally {
      setAdding(false);
    }
  };

  const status =
    sync.status === 'syncing' ? { text: 'Syncing…', tone: 'text-muted-foreground', Icon: RefreshCw }
    : sync.status === 'offline' ? { text: 'Offline — changes sync when you’re back', tone: 'text-warning', Icon: CloudOff }
    : sync.status === 'error' ? { text: 'Couldn’t sync', tone: 'text-destructive', Icon: AlertTriangle }
    : {
      text: sync.lastSyncedAt
        ? `Synced ${formatDistanceToNow(new Date(sync.lastSyncedAt), { addSuffix: true })}`
        : 'Ready to sync',
      tone: 'text-success',
      Icon: Cloud,
    };

  return (
    <section>
      <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase mb-3">
        Sync
      </p>
      {user ? (
        <div className="rounded-2xl border border-success/30 bg-success/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <status.Icon size={16} className={cn('shrink-0', status.tone, sync.status === 'syncing' && 'animate-spin')} />
            <p className={cn('text-sm font-semibold', status.tone)}>{status.text}</p>
          </div>
          <p className="text-[11px] text-mono text-muted-foreground break-all">{user.email}</p>
          {sync.error && <p className="text-[11px] text-destructive break-words">{sync.error}</p>}
          {sync.pending > 0 && sync.status !== 'syncing' && (
            <p className="text-[11px] text-muted-foreground">
              {sync.pending} change{sync.pending === 1 ? '' : 's'} waiting to go up.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/70">
            Changes sync by themselves to every device signed in to this account — your phone and
            your computer both.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={sync.status === 'syncing' || signingOut}
            onClick={() => void sync.syncNow()}
          >
            Sync now
          </Button>

          {/* Data saved here before signing in sits in the device's own
              ledger, which this account can't see until it is added. */}
          {deviceLedgerCount > 0 && (
            <div className="border-t border-border pt-2 space-y-1.5">
              <p className="text-[11px] text-muted-foreground">
                This device also has {deviceLedgerCount} record{deviceLedgerCount === 1 ? '' : 's'} from
                before you signed in that aren't in your account.
              </p>
              <Button size="sm" className="w-full" disabled={adding} onClick={addThem}>
                {adding ? 'Adding…' : 'Add them to my account'}
              </Button>
            </div>
          )}

          <button
            onClick={leave}
            disabled={signingOut}
            className="text-[11px] text-mono text-muted-foreground hover:text-destructive transition-colors underline"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : sessionLapsed ? (
        // The sign-in ran out without anyone signing out — usually a phone
        // that was offline too long. The shifts stay on screen and edits wait
        // to go up; only the syncing has stopped.
        <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CloudOff size={16} className="text-warning shrink-0" />
            <p className="text-sm font-semibold">Signed out — sign in again to sync</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Your shifts are still here, and anything you change is kept to send once you sign back in.
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="w-full rounded-xl border border-primary/40 bg-primary/10 text-primary py-2 text-xs font-medium hover:bg-primary/20 transition-colors"
          >
            Sign in again
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <CloudOff size={16} className="text-muted-foreground shrink-0" />
            <p className="text-sm font-semibold">Not backed up</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Everything you've logged lives only in this browser. Clearing your browser data or
            switching phones would lose it. An account keeps it safe, and in sync across your
            phone and computer.
          </p>
          <button
            onClick={() => navigate('/auth')}
            className="w-full rounded-xl border border-primary/40 bg-primary/10 text-primary py-2 text-xs font-medium hover:bg-primary/20 transition-colors"
          >
            Create an account or sign in
          </button>
        </div>
      )}

      {/* Separate from the account on purpose: the pattern is a local lock on
          this device and never talks to the server, so it works with or
          without an account and is unaffected by any of the above. */}
      <button
        onClick={() => navigate('/pattern-auth')}
        className="mt-2 w-full flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-left hover:border-primary/40 transition-colors"
      >
        <span>
          <span className="text-xs font-medium block">Pattern lock</span>
          <span className="text-[10px] text-muted-foreground">Unlock by drawing — stays on this device, no account needed</span>
        </span>
        <ChevronRight size={14} className="text-muted-foreground shrink-0" />
      </button>
    </section>
  );
}

export default function SettingsPage() {
  const { prefs, setWorkerType, setTabEnabled } = useUserPrefs();
  const { data, addEmployer, updateEmployer, deleteEmployer, deleteEverything } = useData();
  const { user } = useAuth();
  const [addingEmployer, setAddingEmployer] = useState(false);
  const [editingEmployerId, setEditingEmployerId] = useState<string | null>(null);

  const saveNewEmployer = async (form: EmployerFormState) => {
    await addEmployer({
      name: form.name.trim(),
      defaultHourlyRate: form.defaultHourlyRate ? parseFloat(form.defaultHourlyRate) : undefined,
      timekeepingApp: form.timekeepingApp.trim() || undefined,
      overtimeRule: form.overtimeRule,
      weeklyOvertimeThresholdHours: form.overtimeRule === 'weekly' ? parseFloat(form.threshold || '40') : undefined,
      dailyOvertimeThresholdHours: form.overtimeRule === 'daily' ? parseFloat(form.threshold || '8') : undefined,
      overtimeMultiplier: 1.5,
      doubletimeMultiplier: 2.0,
      nightPremiumEnabled: form.nightPremiumEnabled,
      nightPremiumMultiplier: 2.0,
      unionDuesPercent: form.unionDuesPercent ? parseFloat(form.unionDuesPercent) : undefined,
      unionLocal: form.unionLocal.trim() || undefined,
      estimatedTaxPercent: form.estimatedTaxPercent ? parseFloat(form.estimatedTaxPercent) : undefined,
      vacationPercent: form.vacationPercent ? parseFloat(form.vacationPercent) : undefined,
      retirementMatchPercent: form.retirementMatchPercent ? parseFloat(form.retirementMatchPercent) : undefined,
      // Only one of the two is the employer's way of paying; the other is
      // cleared so a stale hourly rate cannot sit behind a day rate.
      defaultDayRate: form.payBy === 'day' && form.defaultDayRate ? parseFloat(form.defaultDayRate) : undefined,
      dayRateHours: form.payBy === 'day' && form.dayRateHours ? parseFloat(form.dayRateHours) : undefined,
      ...formTerms(form),
    });
    setAddingEmployer(false);
  };

  const saveEditedEmployer = async (id: string, form: EmployerFormState) => {
    await updateEmployer(id, {
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
      estimatedTaxPercent: form.estimatedTaxPercent ? parseFloat(form.estimatedTaxPercent) : undefined,
      vacationPercent: form.vacationPercent ? parseFloat(form.vacationPercent) : undefined,
      retirementMatchPercent: form.retirementMatchPercent ? parseFloat(form.retirementMatchPercent) : undefined,
      // Only one of the two is the employer's way of paying; the other is
      // cleared so a stale hourly rate cannot sit behind a day rate.
      defaultDayRate: form.payBy === 'day' && form.defaultDayRate ? parseFloat(form.defaultDayRate) : undefined,
      dayRateHours: form.payBy === 'day' && form.dayRateHours ? parseFloat(form.dayRateHours) : undefined,
      ...formTerms(form),
    });
    setEditingEmployerId(null);
  };

  return (
    <SpacePageWrapper>
      <div className="max-w-lg mx-auto space-y-8">
        <PageHeader title="Mode" description="Customize which sections appear in your app" showDot={false} />

      <AccountSection />

      <ThemePicker />

      <TaxAndLocalsSettings />

      {/* Worker profile */}
      <section>
        <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase mb-3">
          Worker Profile
        </p>
        <div className="grid grid-cols-3 gap-3">
          {WORKER_OPTIONS.map(({ type, label, subtitle, icon: Icon }) => {
            const isActive = prefs.workerType === type;
            return (
              <button
                key={type}
                onClick={() => setWorkerType(type as WorkerType)}
                className={cn(
                  "rounded-2xl border p-4 text-left transition-all",
                  isActive
                    ? "pick-on"
                    : "border-border bg-card hover:border-foreground/40"
                )}
              >
                <Icon size={18} className={isActive ? 'text-foreground' : 'text-muted-foreground'} />
                <p className={cn("text-sm font-semibold mt-2", 'text-foreground')}>
                  {label}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{subtitle}</p>
              </button>
            );
          })}
        </div>
        {prefs.workerType === 'custom' && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-mono text-muted-foreground/50">
            <SlidersHorizontal size={10} />
            <span>Custom — you've manually adjusted sections below</span>
          </div>
        )}
      </section>

      {/* Section toggles */}
      <section>
        <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase mb-3">
          Visible Sections
        </p>
        <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border/50">
          {TAB_ORDER.map(tab => {
            const { label, description } = TAB_LABELS[tab];
            const enabled = prefs.tabs[tab];
            const presetKey = prefs.workerType as 'w2' | '1099' | 'boss';
            const isPresetDiff =
              prefs.workerType !== 'custom' &&
              WORKER_PRESETS[presetKey][tab] !== enabled;
            return (
              <div
                key={tab}
                className={cn(
                  "flex items-center justify-between px-4 py-3 transition-colors",
                  enabled ? 'bg-card' : 'bg-secondary/20 opacity-60'
                )}
              >
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
                  {isPresetDiff && (
                    <p className="text-[9px] text-accent mt-0.5">differs from {prefs.workerType} preset</p>
                  )}
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={v => setTabEnabled(tab, v)}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* What the presets do */}
      <section className="rounded-2xl border border-border/40 bg-secondary/10 p-4 space-y-2">
        <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/50 uppercase">
          Preset Differences
        </p>
        <div className="grid grid-cols-3 gap-3 text-[10px] text-muted-foreground">
          <div>
            <p className="font-semibold text-foreground mb-1">W2 Employee</p>
            <p className="text-success">Income only</p>
            <p className="text-muted-foreground/50 mt-1">No expenses — employer handles taxes and payroll.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">1099 Contractor</p>
            <p className="text-success">Expenses, income</p>
            <p className="text-muted-foreground/50 mt-1">Full financials — deductions and invoicing.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">Boss</p>
            <p className="text-success">+ Pay Outs</p>
            <p className="text-muted-foreground/50 mt-1">Owner/operator — also tracks payments made to crew.</p>
          </div>
        </div>
      </section>

      {/* Employers */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase">
            Employers
          </p>
          {!addingEmployer && (
            <button
              onClick={() => setAddingEmployer(true)}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Plus size={12} /> Add employer
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {addingEmployer && (
            <EmployerForm
              initial={EMPTY_EMPLOYER_FORM}
              onSave={saveNewEmployer}
              onCancel={() => setAddingEmployer(false)}
            />
          )}

          {data.employers.length === 0 && !addingEmployer && (
            <p className="text-xs text-muted-foreground rounded-xl border border-border/40 bg-secondary/10 p-4 text-center">
              No saved employers yet — add one here, or quick-add from the employer field when logging a job.
            </p>
          )}

          {data.employers.map(emp => (
            editingEmployerId === emp.id ? (
              <EmployerForm
                key={emp.id}
                initial={employerToForm(emp)}
                onSave={form => saveEditedEmployer(emp.id, form)}
                onCancel={() => setEditingEmployerId(null)}
              />
            ) : (
              <div key={emp.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{emp.name}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {emp.defaultHourlyRate ? `$${emp.defaultHourlyRate}/hr` : 'no default rate'}
                    {emp.overtimeRule === 'weekly' && ` · OT after ${emp.weeklyOvertimeThresholdHours ?? 40}h/wk`}
                    {emp.overtimeRule === 'daily' && ` · OT after ${emp.dailyOvertimeThresholdHours ?? 8}h/day`}
                    {emp.overtimeRule === 'none' && ` · no overtime`}
                    {(emp.nightPremiumEnabled ?? true) && ` · night premium`}
                    {emp.timekeepingApp && ` · tracks time in ${emp.timekeepingApp}`}
                  </p>
                  <p className="text-[10px] text-mono text-foreground/75 mt-0.5">
                    {emp.workerStatus === '1099' ? '1099' : 'W2'}
                    {emp.roundUpToWholeHours && ' · breaks the hour'}
                    {(emp.roles?.length ?? 0) > 0 && ` · ${emp.roles!.map(r => r.name).join(', ')}`}
                    {(() => {
                      const pto = ptoBalance(emp, data.jobs);
                      return pto ? ` · PTO ${pto.banked}h banked` : '';
                    })()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditingEmployerId(emp.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    aria-label={`Edit ${emp.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label={`Delete ${emp.name}`}
                      >
                        <X size={14} />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {emp.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the saved rate/overtime profile. Jobs already logged for this client keep their own data — only future quick-adds lose the shortcut.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteEmployer(emp.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )
          ))}
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
        <p className="text-[9px] text-mono font-bold tracking-widest text-destructive/60 uppercase">
          Danger Zone
        </p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Clear All Data</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Permanently delete all jobs, income, expenses, and equipment{user ? ' — on every device signed in to this account' : ''}
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/40 text-destructive text-xs font-semibold hover:bg-destructive/10 transition-colors">
                <Trash2 size={13} /> Clear Data
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all data?</AlertDialogTitle>
                <AlertDialogDescription>
                  {user
                    ? 'This deletes everything from your account, and from every device signed in to it. This cannot be undone.'
                    : 'This will permanently delete all jobs, expenses, income, and equipment. This cannot be undone.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={async () => { await deleteEverything(); toast.success('Everything deleted'); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
      </div>
    </SpacePageWrapper>
  );
}
