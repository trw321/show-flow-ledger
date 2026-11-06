import { useState } from 'react';
import TaxAndLocalsSettings from '@/components/TaxAndLocalsSettings';
import ThemePicker from '@/components/ThemePicker';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useUserPrefs, TAB_LABELS, WORKER_PRESETS, type TabKey, type WorkerType } from '@/lib/UserPrefsContext';
import { useData, useSync } from '@/lib/DataContext';
import { saveLedgerCopy } from '@/lib/store';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import PageHeader from '@/components/PageHeader';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Briefcase, FileText, Crown, SlidersHorizontal, Trash2, Plus, Pencil, X, CloudOff, Cloud, RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptoBalance } from '@/lib/pto';
import { payScheduleLabel } from '@/lib/payTiming';
import { EMPTY_EMPLOYER_FORM, EmployerForm, employerFromForm, employerToForm, type EmployerFormState } from '@/components/EmployerForm';
import { CONTRACTS, contractFor, contractsWorked } from '@/lib/contracts';
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

const TAB_ORDER: TabKey[] = ['income', 'expenses', 'invoices', 'crew', 'payouts'];

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
          <button onClick={() => void saveLedgerCopy()} className="w-full py-1 text-xs text-muted-foreground underline hover:text-foreground">
            Save a copy of my data
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
    await addEmployer({ ...employerFromForm(form), overtimeMultiplier: 1.5, doubletimeMultiplier: 2.0 });
    setAddingEmployer(false);
  };

  const saveEditedEmployer = async (id: string, form: EmployerFormState) => {
    await updateEmployer(id, employerFromForm(form));
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
            <p className="text-success">Expenses, income, invoices</p>
            <p className="text-muted-foreground/50 mt-1">Full financials — deductions and invoicing.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">Boss</p>
            <p className="text-success">+ Crew, Pay Outs</p>
            <p className="text-muted-foreground/50 mt-1">Owner/operator — your crew's schedules, and what you pay them.</p>
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
                initial={employerToForm(emp, !!prefs.payer.tax?.federalExempt)}
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
                    {contractFor(emp) && ` · ${contractFor(emp)!.short}`}
                    {emp.workerStatus !== '1099' && (emp.w4Exempt ? ' · W-4 exempt' : emp.estimatedTaxPercent ? ` · withholds ${emp.estimatedTaxPercent}%` : '')}
                    {payScheduleLabel(emp) && ` · ${payScheduleLabel(emp)}`}
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

      {/* The contracts, to read and to see who is on them. */}
      <section>
        <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase mb-3">
          Contracts
        </p>
        {/* Built from the dispatches themselves: each shift keeps the one it was called under. */}
        <div className="mb-3 rounded-xl border border-border bg-card px-3 py-2.5">
          <p className="text-sm font-medium">On your shifts</p>
          {contractsWorked(data.jobs).length === 0 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">None yet. Each dispatch names its contract, and they collect here.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {contractsWorked(data.jobs).map(c => (
                <li key={c.name} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="min-w-0 break-words text-foreground/85">{c.name}</span>
                  <span className="shrink-0 text-mono text-muted-foreground">
                    {c.shifts} shift{c.shifts === 1 ? '' : 's'}
                    {c.lowestRate !== undefined && ` · $${c.lowestRate}${c.highestRate !== c.lowestRate ? `–${c.highestRate}` : ''}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[10px] text-muted-foreground">Names only so far. No terms are applied from them yet.</p>
        </div>
        <div className="flex flex-col gap-2">
          {CONTRACTS.map(c => {
            const on = data.employers.filter(e => e.contract === c.key);
            return (
              <details key={c.key} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <summary className="cursor-pointer text-sm font-medium">
                  {c.name} <span className="text-[11px] font-normal text-muted-foreground">{c.version}</span>
                </summary>
                {c.caution && <p className="mt-2 text-[11px] text-warning">{c.caution}</p>}
                <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                  {c.summary.map(line => <li key={line}>• {line}</li>)}
                </ul>
                {c.notCalculated.length > 0 && (
                  <>
                    <p className="mt-2 text-[10px] text-mono uppercase tracking-wider text-warning">Not worked out by the app</p>
                    <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                      {c.notCalculated.map(line => <li key={line}>• {line}</li>)}
                    </ul>
                  </>
                )}
                {(c.perEmployer || on.length > 0) && (
                  <p className="mt-2 text-[11px] text-foreground/75">
                    {on.length > 0 ? `On: ${on.map(e => e.name).join(', ')}` : 'Not on an employer yet. Edit an employer above and pick it.'}
                  </p>
                )}
              </details>
            );
          })}
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
