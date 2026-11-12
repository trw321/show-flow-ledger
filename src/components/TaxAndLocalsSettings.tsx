import { useUserPrefs } from '@/lib/UserPrefsContext';
import { useData } from '@/lib/DataContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { estimateYearFromEarnings, FILING_STATUS_LABELS, SOCIAL_SECURITY_WAGE_BASE, type FilingStatus } from '@/lib/taxEstimate';
import type { LocalRates } from '@/lib/payerProfile';

/**
 * The numbers that are yours rather than any employer's, and the ones that
 * belong to your local.
 *
 * Nothing here is guessed on your behalf. The dependent credits change every
 * year, so they are fields with the figure visible. The Social Security wage
 * base is published by the SSA for each year, so a blank field uses that
 * year's figure — and says which — rather than charging on everything.
 */

const FIELD = 'h-9 text-sm text-mono';
const LABEL = 'text-[10px] text-mono uppercase tracking-wider text-muted-foreground';

export default function TaxAndLocalsSettings() {
  const { prefs, setPayer } = useUserPrefs();
  const { data, updateEmployer } = useData();
  const payer = prefs.payer;
  const tax = payer.tax ?? {};

  const setTax = (patch: Record<string, unknown>) =>
    setPayer({ ...payer, tax: { ...tax, ...patch } });

  // Exempt was one switch for every employer. It is each employer's now —
  // the W-4 is filed with each — so the old switch is handed to every W2
  // employer that has not said otherwise, and then cleared.
  const w2Employers = data.employers.filter(e => e.workerStatus !== '1099');
  const moveExemptToEmployers = () => {
    for (const e of w2Employers) if (e.w4Exempt === undefined) void updateEmployer(e.id, { w4Exempt: true });
    setTax({ federalExempt: undefined });
  };

  const num = (v: string): number | undefined => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const thisYear = new Date().getFullYear();
  const ssaBase = SOCIAL_SECURITY_WAGE_BASE[thisYear];
  const budgetYear = tax.budgetYear ?? thisYear;
  const hasAnnualBudget = (tax.expectedAnnualW2Income ?? 0) > 0 || (tax.expectedAnnual1099Income ?? 0) > 0;
  const budgetEstimate = estimateYearFromEarnings(
    tax.expectedAnnualW2Income ?? 0,
    tax.expectedAnnual1099Income ?? 0,
    tax,
    budgetYear,
    tax.expectedAnnualFederalWithholding,
  );

  const setLocal = (index: number, patch: Partial<LocalRates>) =>
    setPayer({ ...payer, locals: payer.locals.map((l, i) => (i === index ? { ...l, ...patch } : l)) });

  return (
    <div className="space-y-6">
      {/* ── Your tax ──────────────────────────────────────────────────── */}
      <details className="group rounded-xl border border-border bg-card px-3 py-2.5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[9px] text-mono font-bold tracking-widest text-muted-foreground/60 uppercase">
          Tax & year-end budget
          <span className="text-[10px] font-normal normal-case tracking-normal">{budgetYear} estimate</span>
        </summary>
        <div className="space-y-4 pt-3">
          <section className="space-y-3">
            <p className="text-xs font-semibold">Your tax profile</p>
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
            Your <em>effective</em> rate across the year, not your top bracket — what the tax
            estimate uses. What each employer withholds, or W-4 exempt, is set on the employer.
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
              <Input type="number" className={FIELD} placeholder={ssaBase ? String(ssaBase) : ''}
                value={tax.socialSecurityWageBase ?? ''}
                onChange={e => setTax({ socialSecurityWageBase: num(e.target.value) })} />
            </label>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Social Security only comes out of the first {ssaBase ? <>${ssaBase.toLocaleString()}</> : 'part'} you earn in {thisYear} —
            past that it stops until January. Medicare never stops. Leave it blank to use the
            SSA's figure for each year.
          </p>

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
            The credits change every year — they are fields rather than built in, so they
            can be kept right.
          </p>

          {/* Exempt used to live here, for every employer at once. */}
          {tax.federalExempt && (
            <div className="flex items-start gap-2 border border-warning/50 bg-warning/5 p-2.5 text-[11px]">
              <AlertTriangle size={12} className="shrink-0 mt-0.5 text-warning" />
              <div className="space-y-1.5">
                <p>
                  W-4 exempt is switched on here, for every employer at once. It's set on each
                  employer now{w2Employers.length ? '' : ' — add your employers below first'}.
                </p>
                {w2Employers.length > 0 && (
                  <button type="button" onClick={moveExemptToEmployers} className="pixel-button pick-off px-2 py-1 text-[11px] font-bold">
                    Move it to {w2Employers.length === 1 ? w2Employers[0].name : `all ${w2Employers.length} W2 employers`}
                  </button>
                )}
              </div>
            </div>
          )}
          </section>

          <section className="space-y-2 border-t border-border/60 pt-3">
            <div>
              <p className="text-xs font-semibold">Year-end tax budget</p>
              <p className="text-[10px] text-muted-foreground">Enter your expected full-year income and federal withholding. This is a planning estimate, not a filed return.</p>
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Budget year</span>
              <Input type="number" min="2020" max="2100" step="1" className={FIELD}
                value={budgetYear}
                onChange={e => setTax({ budgetYear: num(e.target.value) ?? thisYear })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Expected annual W-2 wages</span>
                <Input type="number" min="0" step="1000" className={FIELD} placeholder="0"
                  value={tax.expectedAnnualW2Income ?? ''}
                  onChange={e => setTax({ expectedAnnualW2Income: num(e.target.value) })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Expected annual 1099 income</span>
                <Input type="number" min="0" step="1000" className={FIELD} placeholder="0"
                  value={tax.expectedAnnual1099Income ?? ''}
                  onChange={e => setTax({ expectedAnnual1099Income: num(e.target.value) })} />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Expected federal withholding across W-2 jobs</span>
              <Input type="number" min="0" step="100" className={FIELD} placeholder="Uses your effective rate if blank"
                value={tax.expectedAnnualFederalWithholding ?? ''}
                onChange={e => setTax({ expectedAnnualFederalWithholding: num(e.target.value) })} />
            </label>
            {hasAnnualBudget && (
              <div className="rounded-md border border-primary/25 bg-primary/5 p-3 space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Estimated total tax for {budgetYear}</span>
                  <span className="text-sm font-bold text-mono">${Math.round(budgetEstimate.totalOwed).toLocaleString()}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Expected amount to reserve after withholding</span>
                  <span className="text-sm font-bold text-mono">${Math.round(Math.max(0, budgetEstimate.stillOwed)).toLocaleString()}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Includes federal, Social Security, Medicare, state and self-employment tax where configured. W-4 filing status is recorded per employer; withholding is estimated from your rate or the annual amount above.
                </p>
              </div>
            )}
          </section>
        </div>
      </details>

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
