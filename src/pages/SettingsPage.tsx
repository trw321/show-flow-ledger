import { useUserPrefs, TAB_LABELS, WORKER_PRESETS, type TabKey, type WorkerType } from '@/lib/UserPrefsContext';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Briefcase, FileText, SlidersHorizontal } from 'lucide-react';

const WORKER_OPTIONS: { type: 'w2' | '1099'; label: string; subtitle: string; icon: React.ElementType }[] = [
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
];

const TAB_ORDER: TabKey[] = [
  'calendar', 'log', 'reconciliation', 'equipment',
  'income', 'expenses', 'taxes', 'discover',
];

export default function SettingsPage() {
  const { prefs, setWorkerType, setTabEnabled } = useUserPrefs();

  return (
    <div className="max-w-lg space-y-8">
      <div>
        <h1 className="text-xl font-bold text-mono tracking-widest uppercase">Settings</h1>
        <p className="text-xs text-muted-foreground mt-1">Customize which sections appear in your app</p>
      </div>

      {/* Worker profile */}
      <section>
        <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase mb-3">
          Worker Profile
        </p>
        <div className="grid grid-cols-2 gap-3">
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
            const isPresetDiff =
              prefs.workerType !== 'custom' &&
              WORKER_PRESETS[prefs.workerType as 'w2' | '1099'][tab] !== enabled;
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
        <div className="grid grid-cols-2 gap-4 text-[10px] text-muted-foreground">
          <div>
            <p className="font-semibold text-foreground mb-1">W2 Employee</p>
            <p className="text-success">+ All sections except Expenses</p>
            <p className="text-muted-foreground/50 mt-1">Employer pays taxes for you, but you still need income tracking, reconciliation, and tax visibility across multiple gigs.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">1099 Contractor</p>
            <p className="text-success">+ Everything</p>
            <p className="mt-1 text-muted-foreground/50">Full suite — expense deductions, quarterly taxes, invoicing, and reconciliation.</p>
          </div>
        </div>
        <p className="text-[9px] text-mono text-accent/70 pt-1 border-t border-border/30">
          Note: Reconciliation requires Income — toggling one will sync the other.
        </p>
      </section>
    </div>
  );
}
