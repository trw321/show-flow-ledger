import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import pieImage from '@/assets/pie.png';

// ── 2025 Federal Tax Brackets ─────────────────────────────────────────────

type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh';

const BRACKETS: Record<FilingStatus, { limit: number; rate: number }[]> = {
  single: [
    { limit: 11925,  rate: 0.10 },
    { limit: 48475,  rate: 0.12 },
    { limit: 103350, rate: 0.22 },
    { limit: 197300, rate: 0.24 },
    { limit: 250525, rate: 0.32 },
    { limit: 626350, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ],
  mfj: [
    { limit: 23850,  rate: 0.10 },
    { limit: 96950,  rate: 0.12 },
    { limit: 206700, rate: 0.22 },
    { limit: 394600, rate: 0.24 },
    { limit: 501050, rate: 0.32 },
    { limit: 751600, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ],
  mfs: [
    { limit: 11925,  rate: 0.10 },
    { limit: 48475,  rate: 0.12 },
    { limit: 103350, rate: 0.22 },
    { limit: 197300, rate: 0.24 },
    { limit: 250525, rate: 0.32 },
    { limit: 375800, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ],
  hoh: [
    { limit: 17000,  rate: 0.10 },
    { limit: 64850,  rate: 0.12 },
    { limit: 103350, rate: 0.22 },
    { limit: 197300, rate: 0.24 },
    { limit: 250500, rate: 0.32 },
    { limit: 626350, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ],
};

const STANDARD_DEDUCTIONS: Record<FilingStatus, number> = {
  single: 15000,
  mfj:    30000,
  mfs:    15000,
  hoh:    22500,
};

const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: 'Single',
  mfj:    'Married Filing Jointly',
  mfs:    'Married Filing Separately',
  hoh:    'Head of Household',
};

// SS wage base 2025
const SS_WAGE_BASE = 176100;

function calcFederalTax(taxableIncome: number, status: FilingStatus): number {
  const brackets = BRACKETS[status];
  let tax = 0;
  let prev = 0;
  let remaining = Math.max(0, taxableIncome);
  for (const bracket of brackets) {
    const width = bracket.limit === Infinity
      ? remaining
      : Math.min(remaining, bracket.limit - prev);
    tax += width * bracket.rate;
    remaining -= width;
    prev = bracket.limit;
    if (remaining <= 0) break;
  }
  return tax;
}

function calcSETax(netProfit: number): {
  seTax: number;
  seDeduction: number;
  ssTax: number;
  medicareTax: number;
  additionalMedicare: number;
} {
  const base = Math.max(0, netProfit) * 0.9235; // employer-equivalent deduction
  const ssTax = Math.min(base, SS_WAGE_BASE) * 0.124;
  const medicareTax = base * 0.029;
  // Additional 0.9% Medicare on SE income > $200k (single threshold)
  const additionalMedicare = Math.max(0, base - 200000) * 0.009;
  const seTax = ssTax + medicareTax + additionalMedicare;
  const seDeduction = seTax * 0.5; // deductible half of SE tax
  return { seTax, seDeduction, ssTax, medicareTax, additionalMedicare };
}

// ── Bracket colors (low → high rate maps green → teal → blue → purple → red)
const BRACKET_COLORS = [
  'hsl(76,  92%, 48%)',   // 10% — lime/success
  'hsl(157, 70%, 45%)',   // 12% — teal-green
  'hsl(188, 80%, 50%)',   // 22% — teal/accent
  'hsl(210,100%, 55%)',   // 24% — blue/info
  'hsl(252, 78%, 60%)',   // 32% — purple/primary
  'hsl(280, 70%, 55%)',   // 35% — violet
  'hsl(0,   72%, 55%)',   // 37% — red/destructive
];

function BracketBar({ taxableIncome, status }: { taxableIncome: number; status: FilingStatus }) {
  if (taxableIncome <= 0) return null;
  const brackets = BRACKETS[status];
  let remaining = taxableIncome;
  const segments = brackets.map((b, i) => {
    const prev = i === 0 ? 0 : brackets[i - 1].limit;
    const slotWidth = b.limit === Infinity ? remaining : b.limit - prev;
    const filled = Math.min(remaining, slotWidth);
    remaining -= filled;
    return { rate: b.rate, slotWidth, filled };
  }).filter(s => s.filled > 0);

  return (
    <div className="mt-4 space-y-2 pt-3 border-t border-border">
      <p className="text-[10px] text-mono text-muted-foreground uppercase tracking-wider mb-2">Federal Tax Brackets</p>
      {segments.map((seg, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="text-[10px] text-mono font-bold w-7 shrink-0 text-right" style={{ color: BRACKET_COLORS[i] }}>
            {(seg.rate * 100).toFixed(0)}%
          </span>
          <div className="flex-1 h-2.5 rounded-full bg-secondary/50 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (seg.filled / seg.slotWidth) * 100)}%`,
                background: BRACKET_COLORS[i],
                boxShadow: `0 0 8px ${BRACKET_COLORS[i]}90`,
              }}
            />
          </div>
          <span className="text-[10px] text-mono text-muted-foreground w-20 text-right shrink-0">
            ${seg.filled.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            <span className="opacity-60"> @ {(seg.rate * 100).toFixed(0)}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Pie geometry helpers ──────────────────────────────────────────────────

function pieClipPath(startDeg: number, endDeg: number, gap = 2): string {
  const cx = 50, cy = 50, r = 50;
  const pts: string[] = [`${cx}% ${cy}%`];
  for (let a = endDeg + gap; a <= startDeg + 360 - gap; a++) {
    const rad = ((a - 90) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(rad)).toFixed(2)}% ${(cy + r * Math.sin(rad)).toFixed(2)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

function sliceClipPath(startDeg: number, endDeg: number): string {
  const cx = 50, cy = 50, r = 50;
  const pts: string[] = [`${cx}% ${cy}%`];
  for (let a = startDeg; a <= endDeg; a++) {
    const rad = ((a - 90) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(rad)).toFixed(2)}% ${(cy + r * Math.sin(rad)).toFixed(2)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Component ─────────────────────────────────────────────────────────────

export default function TaxesPage() {
  const { data } = useData();

  const [filingStatus, setFilingStatus]     = useState<FilingStatus>('single');
  const [isSelfEmployed, setIsSelfEmployed] = useState(true);
  const [stateRate, setStateRate]           = useState(0);
  const [useCustomDeduction, setUseCustomDeduction] = useState(false);
  const [customDeduction, setCustomDeduction]       = useState(0);

  const totalIncome   = data.income.reduce((s, i) => s + i.amount, 0);
  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0);
  const netProfit     = totalIncome - totalExpenses;

  const calc = useMemo(() => {
    const { seTax, seDeduction, ssTax, medicareTax, additionalMedicare } =
      isSelfEmployed ? calcSETax(netProfit) : { seTax: 0, seDeduction: 0, ssTax: 0, medicareTax: 0, additionalMedicare: 0 };

    const agi = Math.max(0, netProfit - seDeduction);
    const deduction = useCustomDeduction ? customDeduction : STANDARD_DEDUCTIONS[filingStatus];
    const taxableIncome = Math.max(0, agi - deduction);
    const federalTax = calcFederalTax(taxableIncome, filingStatus);
    const stateTax = taxableIncome * (stateRate / 100);
    const totalTax = federalTax + seTax + stateTax;
    const takeHome = netProfit - totalTax;

    return {
      seTax, seDeduction, ssTax, medicareTax, additionalMedicare,
      agi, deduction, taxableIncome, federalTax, stateTax, totalTax, takeHome,
    };
  }, [netProfit, filingStatus, isSelfEmployed, stateRate, useCustomDeduction, customDeduction]);

  // Pie segments based on totalIncome
  const taxPercent     = totalIncome > 0 ? Math.min((calc.totalTax    / totalIncome) * 100, 100) : 0;
  const expensePercent = totalIncome > 0 ? Math.min((totalExpenses     / totalIncome) * 100, 100) : 0;

  const expStart = 0;
  const expEnd   = (expensePercent / 100) * 360;
  const taxStart = expEnd;
  const taxEnd   = taxStart + (taxPercent / 100) * 360;

  const midAngle = (taxStart + taxEnd) / 2;
  const rad      = ((midAngle - 90) * Math.PI) / 180;
  const offset   = 12;
  const sliceTransform = `translate(${(offset * Math.cos(rad)).toFixed(2)}px, ${(offset * Math.sin(rad)).toFixed(2)}px)`;

  const hasData = totalIncome > 0 || totalExpenses > 0;

  const effectiveRate = totalIncome > 0 ? (calc.totalTax / totalIncome) * 100 : 0;

  return (
    <>
      <PageHeader title="Taxes" description="Your estimated tax breakdown as a real pie 🥧" />

      {/* ── Controls ── */}
      <div className="rounded-2xl border border-border bg-card p-5 mb-5 space-y-4">
        <h2 className="text-[10px] font-semibold text-mono text-muted-foreground uppercase tracking-[0.2em]">Tax Settings</h2>

        {/* Filing status */}
        <div>
          <label className="text-xs text-muted-foreground mb-1.5 block">Filing Status</label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FILING_STATUS_LABELS) as FilingStatus[]).map(s => (
              <button
                key={s}
                onClick={() => setFilingStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  filingStatus === s
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                }`}
              >
                {FILING_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Self-employed toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSelfEmployed(v => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
              isSelfEmployed ? 'bg-primary' : 'bg-secondary'
            }`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${
              isSelfEmployed ? 'translate-x-4' : 'translate-x-0.5'
            }`} />
          </button>
          <span className="text-sm">Self-employed (1099 / Schedule C)</span>
          {isSelfEmployed && (
            <span className="text-xs text-muted-foreground">+15.3% SE tax applies</span>
          )}
        </div>

        {/* State tax rate */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted-foreground w-28 shrink-0">State Tax Rate</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={20}
              step={0.1}
              value={stateRate}
              onChange={e => setStateRate(Math.max(0, Math.min(20, parseFloat(e.target.value) || 0)))}
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-mono text-center"
            />
            <span className="text-sm text-muted-foreground">%</span>
            <span className="text-xs text-muted-foreground">(0 = no state income tax)</span>
          </div>
        </div>

        {/* Deductions */}
        <div className="flex items-start gap-3">
          <label className="text-xs text-muted-foreground w-28 shrink-0 pt-1.5">Deductions</label>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setUseCustomDeduction(false)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  !useCustomDeduction ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                Standard (${STANDARD_DEDUCTIONS[filingStatus].toLocaleString()})
              </button>
              <button
                onClick={() => setUseCustomDeduction(true)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  useCustomDeduction ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                Custom
              </button>
            </div>
            {useCustomDeduction && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">$</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={customDeduction}
                  onChange={e => setCustomDeduction(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm text-mono"
                  placeholder="0"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <div className="text-6xl mb-4">🥧</div>
          <p className="text-sm text-muted-foreground">Add income & expenses to see your tax pie!</p>
        </div>
      ) : (
        <>
          {/* ── Breakdown ── */}
          <div className="rounded-2xl border border-border bg-card p-5 mb-5">
            <h2 className="text-[10px] font-semibold text-mono text-muted-foreground uppercase tracking-[0.2em] mb-4">
              Tax Breakdown
            </h2>
            <div className="space-y-1 text-sm">
              <Row label="Gross Income" value={totalIncome} />
              <Row label="Business Expenses" value={-totalExpenses} color="text-warning" />
              <Divider />
              <Row label="Net Profit (Schedule C)" value={netProfit} bold />

              {isSelfEmployed && (
                <>
                  <Row label={`SE Tax Deduction (½ of SE tax)`} value={-calc.seDeduction} color="text-muted-foreground" small />
                </>
              )}
              <Row label="Adjusted Gross Income (AGI)" value={calc.agi} bold />

              <Row
                label={useCustomDeduction ? 'Custom Deduction' : `Standard Deduction (${FILING_STATUS_LABELS[filingStatus]})`}
                value={-calc.deduction}
                color="text-muted-foreground"
                small
              />
              <Divider />
              <Row label="Federal Taxable Income" value={calc.taxableIncome} bold />

              <BracketBar taxableIncome={calc.taxableIncome} status={filingStatus} />

              <div className="h-2" />

              <Row label="Federal Income Tax" value={-calc.federalTax} color="text-primary" />
              {isSelfEmployed && (
                <>
                  <Row label={`  Social Security (12.4% on ≤$${SS_WAGE_BASE.toLocaleString()})`} value={-calc.ssTax} color="text-accent" small />
                  <Row label="  Medicare (2.9%)" value={-calc.medicareTax} color="text-accent" small />
                  {calc.additionalMedicare > 0 && (
                    <Row label="  Additional Medicare (0.9%)" value={-calc.additionalMedicare} color="text-accent" small />
                  )}
                  <Row label="Self-Employment Tax Total" value={-calc.seTax} color="text-primary" />
                </>
              )}
              {stateRate > 0 && (
                <Row label={`State Income Tax (${stateRate}%)`} value={-calc.stateTax} color="text-info" />
              )}

              <Divider />
              <Row label="Total Tax Burden" value={-calc.totalTax} color="text-destructive" bold />
              <Row label="Net Take-Home" value={calc.takeHome} color="text-success" bold large />
            </div>
          </div>

          {/* ── Pie ── */}
          <div className="rounded-2xl border border-border bg-card p-6 mb-5">
            <h2 className="text-[10px] font-semibold text-mono text-muted-foreground uppercase tracking-[0.2em] mb-4 text-center">
              Where Your Money Goes
            </h2>

            <div className="relative w-64 h-64 mx-auto mb-6">
              <div
                className="absolute inset-0 rounded-full overflow-hidden"
                style={{ clipPath: taxPercent > 0 ? pieClipPath(taxStart, taxEnd) : undefined }}
              >
                <img src={pieImage} alt="Pie" className="w-full h-full object-cover" width={512} height={512} />
              </div>

              {taxPercent > 0 && (
                <div
                  className="absolute inset-0 rounded-full overflow-hidden transition-transform duration-500"
                  style={{ clipPath: sliceClipPath(taxStart, taxEnd), transform: sliceTransform, filter: 'drop-shadow(2px 2px 6px rgba(0,0,0,0.3))' }}
                >
                  <img src={pieImage} alt="Tax slice" className="w-full h-full object-cover" width={512} height={512} />
                </div>
              )}

              {taxPercent > 0 && (
                <div
                  className="absolute text-[10px] font-bold text-mono text-destructive bg-background/80 backdrop-blur-sm rounded-md px-1.5 py-0.5 shadow-sm pointer-events-none"
                  style={{
                    left: `${50 + 42 * Math.cos(((midAngle - 90) * Math.PI) / 180)}%`,
                    top:  `${50 + 42 * Math.sin(((midAngle - 90) * Math.PI) / 180)}%`,
                    transform: `translate(-50%, -50%) ${sliceTransform}`,
                  }}
                >
                  TAX
                </div>
              )}
            </div>

            <div className="space-y-3 max-w-xs mx-auto">
              <LegendRow color="bg-success" label="Take Home" value={`$${fmt(Math.max(0, calc.takeHome))}`} />
              <LegendRow color="bg-destructive" label={`Total Tax (${effectiveRate.toFixed(1)}% effective)`} value={`$${fmt(calc.totalTax)}`} />
              <LegendRow color="bg-warning" label="Expenses" value={`$${fmt(totalExpenses)}`} />
              <div className="border-t border-border pt-2 flex justify-between text-sm">
                <span className="text-muted-foreground">Total Income</span>
                <span className="font-bold text-mono">${fmt(totalIncome)}</span>
              </div>
            </div>
          </div>

          {/* ── Quick stats ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-[10px] text-mono text-muted-foreground uppercase tracking-wider mb-1">Effective Rate</p>
              <p className="text-2xl font-bold text-mono">{effectiveRate.toFixed(1)}%</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-[10px] text-mono text-muted-foreground uppercase tracking-wider mb-1">Set Aside</p>
              <p className="text-2xl font-bold text-mono text-destructive">${fmt(calc.totalTax)}</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Small layout helpers ──────────────────────────────────────────────────

function Row({
  label, value, color = 'text-foreground', bold, large, small,
}: {
  label: string;
  value: number;
  color?: string;
  bold?: boolean;
  large?: boolean;
  small?: boolean;
}) {
  const sizeClass = large ? 'text-base' : small ? 'text-xs' : 'text-sm';
  const weightClass = bold ? 'font-bold' : 'font-normal';
  const sign = value < 0 ? '−' : '';
  return (
    <div className={`flex justify-between items-center ${sizeClass} ${weightClass} ${small ? 'opacity-70' : ''}`}>
      <span className={small ? 'text-muted-foreground' : ''}>{label}</span>
      <span className={`text-mono ${color}`}>{sign}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border my-2" />;
}

function LegendRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`w-4 h-4 rounded-full ${color}`} />
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <span className="text-sm font-bold text-mono">{value}</span>
    </div>
  );
}
