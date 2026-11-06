import { format, parseISO } from 'date-fns';
import type { PayExplanation } from '@/lib/payExplain';
import { cn } from '@/lib/utils';

const dollars = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + dollars(Math.abs(n));

/** The days an estimate covers, in a few words. */
function daysCovered(shifts: { date: string }[]): string {
  const days = [...new Set(shifts.map(s => s.date))].sort().map(d => format(parseISO(d), 'MMM d'));
  return days.length > 4 ? `${days[0]} – ${days[days.length - 1]} · ${days.length} days` : days.join(', ');
}

const TONE: Record<PayExplanation['verdict'], string> = {
  none: 'text-muted-foreground',
  right: 'text-dot-paid',
  close: 'text-dot-pending',
  off: 'text-warning',
};

/** What the app guessed, what actually came in, and why they differ. */
export default function PayEstimateCard({ explanation, covers }: {
  explanation: PayExplanation;
  /** The shifts the estimate is for. */
  covers?: { date: string }[];
}) {
  return (
    <div className="space-y-1.5 border border-border p-2" data-testid="pay-estimate">
      {covers && covers.length > 0 && <p className="text-[10px] text-mono text-muted-foreground">Estimate for {daysCovered(covers)}</p>}
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-2.5 gap-y-0.5 text-[11px] text-mono">
        <span />
        <span className="text-right text-[9px] uppercase tracking-wider text-muted-foreground">Estimate</span>
        <span className="text-right text-[9px] uppercase tracking-wider text-muted-foreground">Actual</span>
        <span className="text-right text-[9px] uppercase tracking-wider text-muted-foreground">Off by</span>
        {explanation.lines.map(l => (
          <div key={l.label} className="contents">
            <span className="text-muted-foreground">{l.label}</span>
            <span className="text-right">{dollars(l.estimated)}</span>
            <span className="text-right font-bold">{l.actual == null ? '—' : dollars(l.actual)}</span>
            <span className={cn('text-right', l.status === 'match' ? 'text-dot-paid' : l.status === 'close' ? 'text-dot-pending' : l.status === 'off' ? 'text-warning' : 'text-muted-foreground')}>
              {l.delta == null ? '—' : signed(l.delta)}
            </span>
          </div>
        ))}
      </div>
      <p className={cn('text-[11px] font-semibold', TONE[explanation.verdict])}>{explanation.headline}</p>
      {explanation.reasons.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-foreground/85">
          {explanation.reasons.map(r => (
            <li key={r.text} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0">{r.text}</span>
              {r.effect != null && Math.abs(r.effect) >= 0.01 && <span className="shrink-0 text-mono text-muted-foreground">{signed(r.effect)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
