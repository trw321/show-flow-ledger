import { useUserPrefs } from '@/lib/UserPrefsContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { FILING_STATUS_LABELS, type FilingStatus } from '@/lib/taxEstimate';
import type { LocalRates } from '@/lib/payerProfile';
import { cn } from '@/lib/utils';

/**
 * The numbers that are yours rather than any employer's, and the ones that
 * belong to your local.
 *
 * Nothing here is guessed on your behalf. Rates that change every year — the
 * Social Security wage base, the dependent credits — are fields with the
 * figure visible, because a value baked into the app would go stale in
 * January and quietly keep being used.
 */

const FIELD = 'h-9 text-sm text-mono';
const LABEL = 'text-[10px] text-mono uppercase tracking-wider text-muted-foreground';

export default function TaxAndLocalsSettings() {
  const { prefs, setPayer } = useUserPrefs();
  const payer = prefs.payer;
  const tax = payer.tax ?? {};

  const setTax = (patch: Record<string, unknown>) =>
    setPayer({ ...payer, tax: { ...tax, ...patch } });

  const num = (v: string): number | undefined => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const setLocal = (index: number, patch: Partial<LocalRates>) =>
    setPayer({ ...payer, locals: payer.locals.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  return (
    <div className="space-y-6">
      {/* ── Your tax ──────────────────────────────────────────────────── */}
      <section>
        <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase mb-3">
          Your tax
        </p>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Filing status</span>
              <Select
                value={tax.filingStatus ?? 'single'}
                onValueChange={v => setTax({ filingStatus: v as FilingStatus })}
              >
                <SelectTrigger className={FIELD}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(FILING_STATUS_LABELS) as FilingStatus[]).map(k => (
                    <SelectItem key={k} value={k}>{FILING_STATUS_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>State</span>
              <Input
                className={FIELD}
                maxLength={2}
                placeholder="CA"
                value={tax.state ?? ''}
                onChange={e => setTax({ state: e.target.value.toUpperCase() })}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Children under 17</span>
              <Input type="number" min="0" className={FIELD} value={tax.dependentsUnder17 ?? ''}
                onChange={e => setTax({ dependentsUnder17: num(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Other dependents</span>
              <Input type="number" min="0" className={FIELD} value={tax.otherDependents ?? ''}
                onChange={e => setTax({ otherDependents: num(e.target.value) })} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Federal rate %</span>
              <Input type="number" step="0.1" className={FIELD} placeholder="12"
                value={tax.federalEffectivePercent ?? ''}
                onChange={e => setTax({ federalEffectivePercent: num(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>State rate %</span>
              <Input type="number" step="0.1" className={FIELD} placeholder="6"
                value={tax.stateTaxPercent ?? ''}
                onChange={e => setTax({ stateTaxPercent: num(e.target.value) })} />
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Your <em>effective</em> rate across the year, not your top bracket. Upload a stub and
            it can be worked out for you.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>State disability %</span>
              <Input type="number" step="0.1" className={FIELD} placeholder="1.1"
                value={tax.stateDisabilityPercent ?? ''}
                onChange={e => setTax({ stateDisabilityPercent: num(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Soc. Sec. wage base</span>
              <Input type="number" className={FIELD} placeholder="176100"
                value={tax.socialSecurityWageBase ?? ''}
                onChange={e => setTax({ socialSecurityWageBase: num(e.target.value) })} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Credit per child</span>
              <Input type="number" className={FIELD} placeholder="2000"
                value={tax.creditPerChild ?? ''}
                onChange={e => setTax({ creditPerChild: num(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Credit per other</span>
              <Input type="number" className={FIELD} placeholder="500"
                value={tax.creditPerOtherDependent ?? ''}
                onChange={e => setTax({ creditPerOtherDependent: num(e.target.value) })} />
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground">
            The wage base and the credits change every year — they are fields rather than
            built in, so they can be kept right.
          </p>

          {/* Exempt, and what it does not cover. */}
          <label className={cn(
            'flex items-start gap-2.5 cursor-pointer select-none p-2.5 border',
            tax.federalExempt ? 'border-warning/50 bg-warning/5' : 'border-border bg-card',
          )}>
            <input
              type="checkbox"
              checked={!!tax.federalExempt}
              onChange={e => setTax({ federalExempt: e.target.checked })}
              className="mt-0.5 rounded border-border shrink-0"
            />
            <span className="text-[11px] leading-tight">
              <span className="font-semibold">W-4 filed EXEMPT</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">
                No federal income tax withheld.
              </span>
            </span>
          </label>
          {tax.federalExempt && (
            <p className="text-[10px] text-warning flex items-start gap-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span>
                Exempt stops federal income tax and nothing else. Social Security, Medicare and
                state disability still come out of every cheque, and whatever federal tax you
                actually owe is still owed at the end of the year.
              </span>
            </p>
          )}
        </div>
      </section>

      {/* ── Your locals ───────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase">
            Your locals
          </p>
          <button
            type="button"
            onClick={() => setPayer({ ...payer, locals: [...payer.locals, { local: '' }] })}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <Plus size={11} /> Add a local
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground mb-2">
          Dues and vacation are the local's, not the employer's — IA16 takes 3.5% and pays 8%
          vacation whoever you worked for that week.
        </p>

        {payer.locals.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/70 italic">
            None yet. Without one, dues and vacation fall back to whatever each employer has.
          </p>
        ) : (
          <div className="space-y-2">
            {payer.locals.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Local</span>
                  <Input className={FIELD} placeholder="ia16" value={l.local}
                    onChange={e => setLocal(i, { local: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Dues %</span>
                  <Input type="number" step="0.1" className={FIELD} placeholder="3.5"
                    value={l.unionDuesPercent ?? ''}
                    onChange={e => setLocal(i, { unionDuesPercent: num(e.target.value) })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Vacation %</span>
                  <Input type="number" step="0.1" className={FIELD} placeholder="8"
                    value={l.vacationPercent ?? ''}
                    onChange={e => setLocal(i, { vacationPercent: num(e.target.value) })} />
                </label>
                <Button
                  size="sm" variant="ghost"
                  aria-label={'Remove ' + (l.local || 'this local')}
                  onClick={() => setPayer({ ...payer, locals: payer.locals.filter((_, j) => j !== i) })}
                  className="h-9 w-9 p-0 text-destructive"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
