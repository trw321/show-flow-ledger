import { useState, useMemo } from 'react';
import { format, parseISO, endOfMonth } from 'date-fns';
import { ChevronDown, Download } from 'lucide-react';
import { netHoursWorked, jobPayBreakdown } from '@/lib/payCalc';
import type { Job, Employer } from '@/lib/store';
import ScrollWheel from '@/components/ScrollWheel';
import { cn } from '@/lib/utils';

/**
 * The parts of the old Dashboard worth keeping: the period table, the
 * month-by-day hours meter and the export button. They moved here when the
 * Dashboard was folded into Money, because they are all about what was earned
 * and none of them were about the day ahead.
 */


export interface PeriodStat {
  label: string;
  gross: number;
  net: number;
  hours: number;
  shifts: number;
}

function money(n: number): string {
  return n === 0 ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Excel sheet" style summary — one row per period, one column per stat.
// Kept as a plain table (not cards), all rows always visible — the browse
// row below it is the only interactive/wheel-driven part, so picking a past
// month never hides the fixed Today/Week/Month/Year rows above it.
export function PaySummaryTable({ rows, jobs, employers }: { rows: PeriodStat[]; jobs: Job[]; employers: Employer[] }) {
  const now = new Date();
  const [browseMonth, setBrowseMonth] = useState(now.getMonth());
  const [browseYear, setBrowseYear] = useState(now.getFullYear());

  const browseStat = useMemo(() => {
    let gross = 0, net = 0, hours = 0, shifts = 0;
    for (const job of jobs) {
      let d: Date;
      try { d = parseISO(job.date); } catch { continue; }
      if (d.getFullYear() !== browseYear || d.getMonth() !== browseMonth) continue;
      const h = netHoursWorked(job);
      if (h <= 0) continue;
      const { gross: g, net: n } = jobPayBreakdown(job, jobs, employers);
      gross += g; net += n; hours += h; shifts += 1;
    }
    return { gross, net, hours, shifts };
  }, [jobs, employers, browseMonth, browseYear]);

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 4 + i);

  return (
    <div className="mb-6 rounded-md border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-foreground/5 text-muted-foreground text-[10px] uppercase tracking-wider">
            <th className="text-left font-medium py-2 px-1.5">Period</th>
            <th className="text-right font-medium py-2 px-1.5">Gross</th>
            <th className="text-right font-medium py-2 px-1.5">Net</th>
            <th className="text-right font-medium py-2 px-1.5">Hours</th>
            <th className="text-right font-medium py-2 px-1.5">Shifts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map(row => (
            <tr key={row.label} className="text-mono">
              <td className="py-2 px-1.5 text-foreground/80 font-medium whitespace-nowrap">{row.label}</td>
              <td className="py-2 px-1.5 text-right text-foreground/70 whitespace-nowrap">{money(row.gross)}</td>
              <td className="py-2 px-1.5 text-right text-success font-semibold whitespace-nowrap">{money(row.net)}</td>
              <td className="py-2 px-1.5 text-right text-foreground/70 whitespace-nowrap">{row.hours > 0 ? row.hours.toFixed(1) : '—'}</td>
              <td className="py-2 px-1.5 text-right text-foreground/70 whitespace-nowrap">{row.shifts || '—'}</td>
            </tr>
          ))}
          <tr className="text-mono bg-white/[0.03]">
            <td className="py-2 px-1.5">
              <div className="flex items-center gap-1">
                <ScrollWheel values={MONTH_NAMES} value={MONTH_NAMES[browseMonth]} onChange={v => setBrowseMonth(MONTH_NAMES.indexOf(v as string))} className="w-11" />
                <ScrollWheel values={years} value={browseYear} onChange={v => setBrowseYear(v as number)} className="w-14" />
              </div>
            </td>
            <td className="py-2 px-1.5 text-right text-foreground/70 whitespace-nowrap">{money(browseStat.gross)}</td>
            <td className="py-2 px-1.5 text-right text-success font-semibold whitespace-nowrap">{money(browseStat.net)}</td>
            <td className="py-2 px-1.5 text-right text-foreground/70 whitespace-nowrap">{browseStat.hours > 0 ? browseStat.hours.toFixed(1) : '—'}</td>
            <td className="py-2 px-1.5 text-right text-foreground/70 whitespace-nowrap">{browseStat.shifts || '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// A rack meter reading the month: one column per day, lit from the bottom.
// The colour ladder is the pay ladder — straight time green, overtime amber,
// double time in the red — so a heavy week looks like a hot channel.
const METER_SEGMENTS = 7;
const OT_HOURS = 8;
const DT_HOURS = 12;

export function HoursMeter({ jobs }: { jobs: Job[] }) {
  const monthPrefix = format(new Date(), 'yyyy-MM');
  const daysInMonth = endOfMonth(new Date()).getDate();
  const today = new Date().getDate();

  const byDay = useMemo(() => {
    const out: number[] = Array(daysInMonth).fill(0);
    jobs.forEach(j => {
      if (!j.date.startsWith(monthPrefix)) return;
      const d = parseInt(j.date.slice(8, 10), 10);
      if (d >= 1 && d <= daysInMonth) out[d - 1] += netHoursWorked(j);
    });
    return out;
  }, [jobs, monthPrefix, daysInMonth]);

  const peak = Math.max(DT_HOURS, ...byDay);
  const worked = byDay.filter(h => h > 0).length;
  if (worked === 0) return null;

  return (
    <div className="mb-6 rounded-md border border-border bg-background/30 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground">
          Hours a day · {format(new Date(), 'MMMM')}
        </p>
        <p className="text-[9px] text-mono text-muted-foreground/60">{worked} day{worked !== 1 ? 's' : ''} · longest {Math.round(peak)}h</p>
      </div>
      <div className="flex items-stretch gap-[2px] h-14" role="img" aria-label={`Hours per day this month, peak ${Math.round(peak)} hours`}>
        {byDay.map((hours, i) => {
          const lit = hours > 0 ? Math.max(1, Math.round((hours / peak) * METER_SEGMENTS)) : 0;
          return (
            <div
              key={i}
              className="flex-1 h-full flex flex-col-reverse gap-[2px] min-w-0"
              title={hours > 0 ? `${format(new Date(), 'MMM')} ${i + 1} — ${Math.round(hours * 10) / 10}h` : `${format(new Date(), 'MMM')} ${i + 1} — no shift`}
            >
              {Array.from({ length: METER_SEGMENTS }, (_, s) => {
                const hoursAtSegment = ((s + 1) / METER_SEGMENTS) * peak;
                const on = s < lit;
                return (
                  <div
                    key={s}
                    className={cn(
                      'flex-1 rounded-[1px]',
                      !on ? 'bg-foreground/[0.06]'
                        : hoursAtSegment > DT_HOURS ? 'bg-destructive'
                        : hoursAtSegment > OT_HOURS ? 'bg-warning'
                        : 'bg-success',
                      on && i + 1 === today && 'ring-1 ring-foreground/50',
                    )}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex text-[8px] text-mono text-muted-foreground/50" aria-hidden="true">
        {byDay.map((_, i) => (
          <span key={i} className="flex-1 text-center min-w-0">
            {(i + 1) % 7 === 0 || i === 0 ? i + 1 : ''}
          </span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[9px] text-mono text-muted-foreground">
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-[1px] bg-success inline-block" />ST</span>
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-[1px] bg-warning inline-block" />OT 8h+</span>
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-[1px] bg-destructive inline-block" />DT 12h+</span>
        <span className="ml-auto opacity-70">from your logged hours</span>
      </div>
    </div>
  );
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-bounce w-full mb-6 flex items-center justify-center gap-2 rounded-md border border-border bg-foreground/5 hover:bg-foreground/10 py-3 px-4 text-sm font-semibold text-foreground/90 transition-colors"
    >
      <Download size={16} />
      Export to Excel
    </button>
  );
}

