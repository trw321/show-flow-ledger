import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { ArrowLeft, Copy, Download } from 'lucide-react';
import { format, parseISO, subMonths } from 'date-fns';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import DateWheels, { Wheel } from '@/components/DateWheels';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { localToday } from '@/lib/today';
import { resolveEmployer } from '@/lib/employerMatch';
import { EMPLOYER_COLOURS, employerColours, employerId } from '@/lib/employerColours';
import { WEEKDAYS, claimDay, claimMoney, claimSummary, employersAsText, isClaimDay, weekRun, weeksAsText, type WeekEnd } from '@/lib/unemployment';
import { cn } from '@/lib/utils';

/** The dates last picked, so coming back for the next form starts there. This device only. */
const RANGE_KEY = 'show-flow-claim-range';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

interface ClaimRange { from: string; through: string; weekEnd: WeekEnd }

function loadRange(today: string): ClaimRange {
  try {
    const saved = JSON.parse(localStorage.getItem(RANGE_KEY) ?? 'null');
    if (saved && isClaimDay(saved.from) && isClaimDay(saved.through)) {
      const weekEnd = Number.isInteger(saved.weekEnd) && saved.weekEnd >= 0 && saved.weekEnd <= 6 ? saved.weekEnd as WeekEnd : 6;
      return { from: saved.from, through: saved.through, weekEnd };
    }
  } catch {
    // Nothing saved, or storage is off: start from the last 18 months.
  }
  return { from: iso(subMonths(parseISO(today), 18)), through: today, weekEnd: 6 };
}

/** The days a week can end on, for its wheel. */
const WEEK_ENDS = WEEKDAYS.map((day, i) => ({ value: i, label: day.slice(0, 3).toUpperCase() }));

/**
 * Unemployment claim: pick the dates the state asks about on the wheels, and
 * your work in them is laid out the two ways the forms ask for it, week by
 * week and employer by employer, ready to copy or download.
 */
export default function UnemploymentPage() {
  const { data } = useData();
  const { prefs } = useUserPrefs();
  const today = localToday();
  const [range, setRange] = useState(() => loadRange(today));
  const [view, setView] = useState<'weeks' | 'employers'>('weeks');

  useEffect(() => {
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(range)); } catch { /* only a convenience */ }
  }, [range]);

  const backwards = range.through < range.from;
  const summary = useMemo(
    () => claimSummary(data.jobs, data.employers, prefs.payer, range.from, range.through, range.weekEnd),
    [data.jobs, data.employers, prefs.payer, range],
  );

  // The same colour each employer has on the calendar.
  const colourOf = useMemo(() => {
    const nameOf = (client: string | undefined) => {
      const c = client?.trim();
      return c ? resolveEmployer(c, data.employers)?.name ?? c : undefined;
    };
    const order = [...data.jobs].filter(j => j.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date))
      .map(j => nameOf(j.client)).filter((n): n is string => !!n);
    const colours = employerColours(order, summary.employers.map(e => e.name));
    return (name: string) => `hsl(${colours.get(employerId(name)) ?? EMPLOYER_COLOURS[0]})`;
  }, [data.jobs, data.employers, summary.employers]);

  const thisYear = Number(today.slice(0, 4));
  const firstYear = Math.min(thisYear - 6, Number(range.from.slice(0, 4)));

  const preset = (months: number) => setRange(r => ({ ...r, from: iso(subMonths(parseISO(today), months)), through: today }));

  const copy = async () => {
    const text = view === 'weeks' ? weeksAsText(summary.weeks) : employersAsText(summary.employers);
    try {
      await navigator.clipboard.writeText(text);
      toast.success(view === 'weeks' ? `Copied ${summary.weeks.length} weeks` : `Copied ${summary.employers.length} employers`);
    } catch {
      toast.error("Couldn't copy here. Try the Excel download.");
    }
  };

  const download = () => {
    const weeks = summary.weeks.flatMap(w => {
      const base = { 'Week ending': w.weekEnding, From: w.start, Through: w.end };
      return w.lines.length === 0
        ? [{ ...base, Employer: 'No work', Hours: 0, Gross: 0 }]
        : w.lines.map(l => ({ ...base, Employer: l.employer, Hours: l.hours, Gross: l.gross }));
    });
    const employers = summary.employers.map(e => ({
      Employer: e.name, 'Paid by': e.paidBy ?? '', 'First day': e.firstDay, 'Last day': e.lastDay, Days: e.days, Hours: e.hours, Gross: e.gross,
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(weeks), 'Weeks');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(employers), 'Employers');
    XLSX.writeFile(book, `unemployment-claim-${range.from}-to-${range.through}.xlsx`);
  };

  return (
    <SpacePageWrapper
      bleed
      title={
        <div className="flex items-center gap-2">
          <Link to="/benefits" aria-label="Back to Benefits" className="-ml-1 p-1 text-[hsl(188_90%_70%)]"><ArrowLeft size={20} /></Link>
          <h1 className="neon-title text-lg font-display tracking-wide leading-none">Unemployment claim</h1>
        </div>
      }
      description="Your weeks and employers for the dates the claim asks about"
    >
      <div className="mx-auto max-w-lg space-y-4" data-testid="claim-page">
        {/* The dates, on wheels. */}
        <div className="space-y-3 border border-[hsl(312_95%_68%/0.5)] bg-[#0b0614]/70 p-3">
          <DateWheels label="From" value={range.from} firstYear={firstYear} lastYear={thisYear} testId="claim-from"
            onChange={from => setRange(r => ({ ...r, from }))} />
          <DateWheels label="Through" value={range.through} firstYear={firstYear} lastYear={thisYear} testId="claim-through"
            onChange={through => setRange(r => ({ ...r, through }))} />
          {/* Most states count weeks Sunday to Saturday; some don't. */}
          <div className="flex items-center gap-3" data-testid="claim-week-end">
            <div className="min-w-0 flex-1">
              <p className="font-8bit text-[8px] uppercase text-[hsl(312_95%_75%)]">Weeks end on</p>
              <p className="mt-1 text-[11px] text-mono text-muted-foreground">{weekRun(range.weekEnd)}</p>
            </div>
            <div className="w-24 shrink-0">
              <Wheel label="Weeks end on" items={WEEK_ENDS} value={range.weekEnd} testId="claim-week-end-wheel"
                onChange={v => setRange(r => ({ ...r, weekEnd: v as WeekEnd }))} />
            </div>
          </div>
          <div className="flex gap-2">
            {[12, 18].map(m => (
              <button key={m} type="button" onClick={() => preset(m)} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold">
                Last {m} months
              </button>
            ))}
          </div>
        </div>

        {backwards ? (
          <p className="border border-dot-late/60 bg-dot-late/10 p-3 text-sm text-dot-late" role="alert">
            The through date is before the from date. Roll one of them so the dates run forward.
          </p>
        ) : (
          <>
            {/* What it comes to. */}
            <div className="grid grid-cols-2 gap-2 text-center" data-testid="claim-totals">
              <div className="border border-border p-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">Weeks · employers</p>
                <p className="text-lg font-bold text-mono">{summary.weeks.length} · {summary.employers.length}</p>
              </div>
              <div className="border border-border p-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground text-mono">{summary.hours} hours · gross</p>
                <p className="text-lg font-bold text-mono text-dot-paid">{claimMoney(summary.gross)}</p>
              </div>
            </div>

            <div className="flex gap-2" role="tablist" aria-label="Show">
              {(['weeks', 'employers'] as const).map(v => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={cn('pixel-button flex-1 py-2 text-sm font-bold', view === v ? 'pick-on' : 'pick-off')}>
                  {v === 'weeks' ? 'By week' : 'By employer'}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => void copy()} className="pixel-button pick-off flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold">
                <Copy size={13} aria-hidden /> Copy {view === 'weeks' ? 'weeks' : 'employers'}
              </button>
              <button type="button" onClick={download} className="pixel-button pick-off flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold">
                <Download size={13} aria-hidden /> Excel
              </button>
            </div>

            {view === 'weeks' ? (
              <ul className="divide-y divide-border/60 border border-border" data-testid="claim-weeks">
                {summary.weeks.map(w => (
                  <li key={w.weekEnding} className={cn('px-3 py-2.5', w.lines.length === 0 && 'opacity-60')}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">Week ending {claimDay(w.weekEnding)}</p>
                      <p className="shrink-0 text-sm font-bold text-mono">{claimMoney(w.gross)}</p>
                    </div>
                    {w.partial && (
                      <p className="text-[11px] text-mono text-warning">Only {claimDay(w.start, false)} to {claimDay(w.end, false)} is in your dates</p>
                    )}
                    {w.lines.length === 0 ? (
                      <p className="text-[11px] text-mono text-muted-foreground">No work · 0 hours</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {w.lines.map(l => (
                          <li key={l.employer} className="flex items-baseline justify-between gap-2 text-[12px] text-mono">
                            <span className="neon-soft min-w-0 truncate font-bold" style={{ color: colourOf(l.employer) }}>{l.employer}</span>
                            <span className="shrink-0 text-muted-foreground">{l.hours} h · {claimMoney(l.gross)}</span>
                          </li>
                        ))}
                        {w.pto > 0 && <li className="text-[11px] text-mono text-muted-foreground">Includes {claimMoney(w.pto)} paid time off</li>}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : summary.employers.length === 0 ? (
              <p className="border border-border p-4 text-center text-sm text-muted-foreground">No work in these dates.</p>
            ) : (
              <ul className="space-y-2" data-testid="claim-employers">
                {summary.employers.map(e => (
                  <li key={e.name} className="border border-border bg-[#0b0614]/60 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="neon-soft min-w-0 truncate text-base font-bold" style={{ color: colourOf(e.name) }}>{e.name}</p>
                      <p className="shrink-0 text-base font-bold text-mono">{claimMoney(e.gross)}</p>
                    </div>
                    {e.paidBy && <p className="text-[11px] text-muted-foreground">Paid by {e.paidBy}</p>}
                    <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] text-mono">
                      <dt className="text-muted-foreground">First day</dt><dd className="text-right">{claimDay(e.firstDay, false)}</dd>
                      <dt className="text-muted-foreground">Last day</dt><dd className="text-right">{claimDay(e.lastDay, false)}</dd>
                      <dt className="text-muted-foreground">Days worked</dt><dd className="text-right">{e.days}</dd>
                      <dt className="text-muted-foreground">Hours</dt><dd className="text-right">{e.hours}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[11px] text-muted-foreground">
              Gross is the app's estimate from your shifts, before taxes and dues, counted in the week the work was done.
              Weeks run {weekRun(range.weekEnd)}. Check it against your pay stubs before you file.
            </p>
          </>
        )}
      </div>
    </SpacePageWrapper>
  );
}
