import { useState, useMemo } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import pieImage from '@/assets/pie.png';

/**
 * Builds a CSS conic-gradient clip-path polygon that carves a wedge OUT of a circle.
 * startAngle / endAngle in degrees (0 = top, clockwise).
 * Returns the polygon points for the REMAINING pie (everything except the slice).
 */
function pieClipPath(startDeg: number, endDeg: number, gap = 2): string {
  // We draw points around the circle EXCLUDING the slice region
  const cx = 50, cy = 50, r = 50;
  const pts: string[] = [];
  const step = 1;

  // Add center point
  pts.push(`${cx}% ${cy}%`);

  for (let a = endDeg + gap; a <= startDeg + 360 - gap; a += step) {
    const rad = ((a - 90) * Math.PI) / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }

  return `polygon(${pts.join(', ')})`;
}

function sliceClipPath(startDeg: number, endDeg: number): string {
  const cx = 50, cy = 50, r = 50;
  const pts: string[] = [];
  const step = 1;

  pts.push(`${cx}% ${cy}%`);

  for (let a = startDeg; a <= endDeg; a += step) {
    const rad = ((a - 90) * Math.PI) / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    pts.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }

  return `polygon(${pts.join(', ')})`;
}

export default function TaxesPage() {
  const { data } = useData();
  const [taxRate, setTaxRate] = useState(25);

  const totalIncome = data.income.reduce((s, i) => s + i.amount, 0);
  const totalExpenses = data.expenses.reduce((s, e) => s + e.amount, 0);
  const netProfit = totalIncome - totalExpenses;
  const estimatedTax = Math.max(0, netProfit * (taxRate / 100));
  const afterTax = netProfit - estimatedTax;

  const taxPercent = totalIncome > 0 ? Math.min((estimatedTax / totalIncome) * 100, 100) : 0;
  const expensePercent = totalIncome > 0 ? Math.min((totalExpenses / totalIncome) * 100, 100) : 0;

  // Slice angles: expenses first, then tax, rest is take-home
  const expStart = 0;
  const expEnd = (expensePercent / 100) * 360;
  const taxStart = expEnd;
  const taxEnd = taxStart + (taxPercent / 100) * 360;

  const sliceTransform = useMemo(() => {
    const midAngle = (taxStart + taxEnd) / 2;
    const rad = ((midAngle - 90) * Math.PI) / 180;
    const offset = 12;
    const tx = offset * Math.cos(rad);
    const ty = offset * Math.sin(rad);
    return `translate(${tx}px, ${ty}px)`;
  }, [taxStart, taxEnd]);

  const hasData = totalIncome > 0 || totalExpenses > 0;

  return (
    <>
      <PageHeader title="Taxes" subtitle="Your estimated tax breakdown as a real pie 🥧" />

      {/* Tax rate selector */}
      <div className="rounded-2xl border border-border bg-card p-4 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold text-mono text-muted-foreground uppercase tracking-[0.2em]">Tax Rate</h2>
          <div className="flex items-center gap-2">
            {[15, 20, 25, 30, 35, 40].map(r => (
              <button
                key={r}
                onClick={() => setTaxRate(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold text-mono transition-all ${
                  taxRate === r
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                }`}
              >
                {r}%
              </button>
            ))}
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
          {/* The actual pie visualization */}
          <div className="rounded-2xl border border-border bg-card p-6 mb-6">
            <h2 className="text-[10px] font-semibold text-mono text-muted-foreground uppercase tracking-[0.2em] mb-4 text-center">
              Where Your Money Goes
            </h2>

            <div className="relative w-64 h-64 mx-auto mb-6">
              {/* Main pie (remaining after tax slice) */}
              <div
                className="absolute inset-0 rounded-full overflow-hidden"
                style={{
                  clipPath: taxPercent > 0 ? pieClipPath(taxStart, taxEnd) : undefined,
                }}
              >
                <img
                  src={pieImage}
                  alt="Pie representing your finances"
                  className="w-full h-full object-cover"
                  width={512}
                  height={512}
                />
              </div>

              {/* The "cut out" tax slice — pulled away */}
              {taxPercent > 0 && (
                <div
                  className="absolute inset-0 rounded-full overflow-hidden transition-transform duration-500"
                  style={{
                    clipPath: sliceClipPath(taxStart, taxEnd),
                    transform: sliceTransform,
                    filter: 'drop-shadow(2px 2px 6px rgba(0,0,0,0.3))',
                  }}
                >
                  <img
                    src={pieImage}
                    alt="Tax slice"
                    className="w-full h-full object-cover"
                    width={512}
                    height={512}
                  />
                </div>
              )}

              {/* Labels on the pie */}
              {taxPercent > 0 && (
                <div
                  className="absolute text-[10px] font-bold text-mono text-destructive bg-background/80 backdrop-blur-sm rounded-md px-1.5 py-0.5 shadow-sm pointer-events-none"
                  style={{
                    left: `${50 + 42 * Math.cos(((((taxStart + taxEnd) / 2) - 90) * Math.PI) / 180)}%`,
                    top: `${50 + 42 * Math.sin(((((taxStart + taxEnd) / 2) - 90) * Math.PI) / 180)}%`,
                    transform: `translate(-50%, -50%) ${sliceTransform}`,
                  }}
                >
                  TAX
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="space-y-3 max-w-xs mx-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-success" />
                  <span className="text-sm text-foreground">Take Home</span>
                </div>
                <span className="text-sm font-bold text-mono text-success">
                  ${Math.max(0, afterTax).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-destructive" />
                  <span className="text-sm text-foreground">Estimated Tax</span>
                </div>
                <span className="text-sm font-bold text-mono text-destructive">
                  ${estimatedTax.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full bg-warning" />
                  <span className="text-sm text-foreground">Expenses</span>
                </div>
                <span className="text-sm font-bold text-mono text-warning">
                  ${totalExpenses.toLocaleString()}
                </span>
              </div>
              <div className="border-t border-border pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Income</span>
                  <span className="text-sm font-bold text-mono">${totalIncome.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-[10px] text-mono text-muted-foreground uppercase tracking-wider mb-1">Effective Rate</p>
              <p className="text-2xl font-bold text-mono text-foreground">
                {totalIncome > 0 ? ((estimatedTax / totalIncome) * 100).toFixed(1) : 0}%
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4 text-center">
              <p className="text-[10px] text-mono text-muted-foreground uppercase tracking-wider mb-1">Set Aside</p>
              <p className="text-2xl font-bold text-mono text-destructive">
                ${estimatedTax.toLocaleString()}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
