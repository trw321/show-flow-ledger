import { useState } from 'react';
import { useUserPrefs, TAB_LABELS, WORKER_PRESETS, type TabKey, type WorkerType } from '@/lib/UserPrefsContext';
import { useData } from '@/lib/DataContext';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Briefcase, FileText, Crown, SlidersHorizontal, Trash2, Plus, Pencil, X } from 'lucide-react';
import { clearAllData } from '@/lib/store';
import type { Employer } from '@/lib/store';
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

const TAB_ORDER: TabKey[] = [
  'calendar', 'log', 'reconciliation', 'equipment',
  'income', 'expenses', 'taxes', 'discover',
  'scheduling', 'payouts',
];

interface EmployerFormState {
  name: string;
  defaultHourlyRate: string;
  overtimeRule: Employer['overtimeRule'];
  threshold: string;
}

const EMPTY_EMPLOYER_FORM: EmployerFormState = { name: '', defaultHourlyRate: '', overtimeRule: 'daily', threshold: '' };

function employerToForm(e: Employer): EmployerFormState {
  return {
    name: e.name,
    defaultHourlyRate: e.defaultHourlyRate?.toString() ?? '',
    overtimeRule: e.overtimeRule,
    threshold: (e.overtimeRule === 'weekly' ? e.weeklyOvertimeThresholdHours : e.dailyOvertimeThresholdHours)?.toString() ?? '',
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
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          step="0.01"
          placeholder="Rate ($/hr)"
          value={form.defaultHourlyRate}
          onChange={e => setForm(f => ({ ...f, defaultHourlyRate: e.target.value }))}
          className="h-8 text-xs"
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
      <div className="flex gap-2 justify-end pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={!form.name.trim()} onClick={() => onSave(form)}>Save</Button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { prefs, setWorkerType, setTabEnabled } = useUserPrefs();
  const { data, addEmployer, updateEmployer, deleteEmployer } = useData();
  const [addingEmployer, setAddingEmployer] = useState(false);
  const [editingEmployerId, setEditingEmployerId] = useState<string | null>(null);

  const saveNewEmployer = async (form: EmployerFormState) => {
    await addEmployer({
      name: form.name.trim(),
      defaultHourlyRate: form.defaultHourlyRate ? parseFloat(form.defaultHourlyRate) : undefined,
      overtimeRule: form.overtimeRule,
      weeklyOvertimeThresholdHours: form.overtimeRule === 'weekly' ? parseFloat(form.threshold || '40') : undefined,
      dailyOvertimeThresholdHours: form.overtimeRule === 'daily' ? parseFloat(form.threshold || '8') : undefined,
      overtimeMultiplier: 1.5,
      doubletimeMultiplier: 2.0,
    });
    setAddingEmployer(false);
  };

  const saveEditedEmployer = async (id: string, form: EmployerFormState) => {
    await updateEmployer(id, {
      name: form.name.trim(),
      defaultHourlyRate: form.defaultHourlyRate ? parseFloat(form.defaultHourlyRate) : undefined,
      overtimeRule: form.overtimeRule,
      weeklyOvertimeThresholdHours: form.overtimeRule === 'weekly' ? parseFloat(form.threshold || '40') : undefined,
      dailyOvertimeThresholdHours: form.overtimeRule === 'daily' ? parseFloat(form.threshold || '8') : undefined,
    });
    setEditingEmployerId(null);
  };

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-xl font-bold text-mono tracking-widest uppercase">Mode</h1>
        <p className="text-xs text-muted-foreground mt-1">Customize which sections appear in your app</p>
      </div>

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
                    ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                    : "border-border bg-card hover:border-primary/40 hover:bg-primary/5"
                )}
              >
                <Icon size={18} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                <p className={cn("text-sm font-semibold mt-2", isActive ? 'text-primary' : 'text-foreground')}>
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
            <p className="text-success">Income, recon, taxes, calendar</p>
            <p className="text-muted-foreground/50 mt-1">No expenses or equipment — employer pays taxes, you don't rent gear.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">1099 Contractor</p>
            <p className="text-success">Expenses, income, recon, taxes</p>
            <p className="text-muted-foreground/50 mt-1">Full financials — deductions, quarterly taxes, invoicing. No equipment tab.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">Boss</p>
            <p className="text-success">+ Everything</p>
            <p className="text-muted-foreground/50 mt-1">Owner/operator — scheduling, crew timesheets, pay outs, equipment, and full financials.</p>
          </div>
        </div>
        <p className="text-[9px] text-mono text-accent/70 pt-1 border-t border-border/30">
          Note: Reconciliation requires Income — toggling one will sync the other.
        </p>
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
            <p className="text-[10px] text-muted-foreground mt-0.5">Permanently delete all jobs, income, expenses, and equipment</p>
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
                  This will permanently delete all jobs, expenses, income, and equipment. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearAllData()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </div>
  );
}
