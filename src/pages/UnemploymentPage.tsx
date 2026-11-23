import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { ArrowLeft, Copy, Download } from 'lucide-react';
import { format, parseISO, subMonths } from 'date-fns';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import DateWheels, { Wheel } from '@/components/DateWheels';
import CertifyPanel from '@/components/CertifyPanel';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { localToday } from '@/lib/today';
import { resolveEmployer } from '@/lib/employerMatch';
import { EMPLOYER_COLOURS, employerColours, employerId } from '@/lib/employerColours';
import { WEEKDAYS, claimDay, claimMoney, claimSummary, employersAsText, howLongText, isClaimDay, weekRun, weeksAsText, type WeekEnd } from '@/lib/unemployment';
import { cn } from '@/lib/utils';

/** A label in the arcade font, small, in the cyan of the calendar's lines. */
const LABEL = 'font-8bit text-[7px] uppercase leading-relaxed text-[hsl(188_95%_72%)]';

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
    const text = view === 'weeks' ? weeksAsText(summary.weeks) : employersAsText(summary.employers, summary.longest);
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
      Employer: e.name,
      'Worked for longest': [summary.longest?.byStretch === e.name && 'Longest, first day to last', summary.longest?.byDays === e.name && 'Most days worked'].filter(Boolean).join('; '),
      'Paid by': e.paidBy ?? '', 'First day': e.firstDay, 'Last day': e.lastDay, 'How long': howLongText(e.firstDay, e.lastDay),
      'Days worked': e.days, Hours: e.hours, Gross: e.gross,
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
        {/* Certifying every two weeks: when it's due, and the weeks it covers. */}
        <CertifyPanel weekEnd={range.weekEnd} />

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
              <div className="neon-well p-2.5">
                <p className={LABEL}>Weeks · employers</p>
                <p className="neon-title mt-1 text-xl font-bold text-mono">{summary.weeks.length} · {summary.employers.length}</p>
              </div>
              <div className="neon-well p-2.5">
                <p className={LABEL}>{summary.hours} hours · gross</p>
                <p className="neon-title mt-1 text-xl font-bold text-mono">{claimMoney(summary.gross)}</p>
              </div>
            </div>

            {/* Claims ask who you worked for longest. First day to last and most
                days worked can be different employers, so both are here. */}
            {summary.longest && (() => {
              const { byStretch, byDays } = summary.longest;
              const of = (name: string) => summary.employers.find(e => e.name === name)!;
              const line = (label: string, name: string, detail: string) => (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0">
                    <span className={cn(LABEL, 'block')}>{label}</span>
                    <span className="neon-soft block truncate text-base font-bold text-mono" style={{ color: colourOf(name) }}>{name}</span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-mono text-muted-foreground">{detail}</span>
                </div>
              );
              return (
                <div className="neon-well space-y-2 p-3" data-testid="claim-longest">
                  {byStretch === byDays
                    ? line('Worked for longest', byStretch, `${howLongText(of(byStretch).firstDay, of(byStretch).lastDay)} · ${of(byStretch).days} days worked`)
                    : (
                      <>
                        {line('Longest, first day to last', byStretch, `${howLongText(of(byStretch).firstDay, of(byStretch).lastDay)}`)}
                        {line('Most days worked', byDays, `${of(byDays).days} days · ${of(byDays).hours} h`)}
                      </>
                    )}
                </div>
              );
            })()}

            <div className="flex gap-2" role="tablist" aria-label="Show">
              {(['weeks', 'employers'] as const).map(v => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={cn('pixel-button font-8bit flex-1 py-2.5 text-[9px] uppercase', view === v ? 'pick-on' : 'pick-off')}>
                  {v === 'weeks' ? 'By week' : 'By employer'}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => void copy()} className="pixel-button pick-off flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono">
                <Copy size={13} aria-hidden /> Copy {view === 'weeks' ? 'weeks' : 'employers'}
              </button>
              <button type="button" onClick={download} className="pixel-button pick-off flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono">
                <Download size={13} aria-hidden /> Excel
              </button>
            </div>

            {view === 'weeks' ? (
              <ul className="neon-well divide-y divide-[hsl(312_95%_68%/0.25)]" data-testid="claim-weeks">
                {summary.weeks.map(w => (
                  <li key={w.weekEnding} className={cn('px-3 py-2.5', w.lines.length === 0 && 'opacity-60')}>
                    <p className={LABEL}>Week ending</p>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="neon-title text-[13px] font-bold text-mono">{claimDay(w.weekEnding)}</p>
                      <p className="neon-title shrink-0 text-[13px] font-bold text-mono">{claimMoney(w.gross)}</p>
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
              <p className="neon-well p-4 text-center text-sm text-mono text-muted-foreground">No work in these dates.</p>
            ) : (
              <ul className="space-y-2" data-testid="claim-employers">
                {summary.employers.map(e => (
                  <li key={e.name} className="neon-well p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="neon-soft min-w-0 truncate text-base font-bold text-mono" style={{ color: colourOf(e.name) }}>{e.name}</p>
                      <p className="neon-title shrink-0 text-base font-bold text-mono">{claimMoney(e.gross)}</p>
                    </div>
                    {(summary.longest?.byStretch === e.name || summary.longest?.byDays === e.name) && (
                      <p className="mt-1 flex flex-wrap gap-1.5">
                        {summary.longest?.byStretch === e.name && <span className="font-8bit border border-[hsl(46_100%_58%)] px-1.5 py-0.5 text-[7px] uppercase text-[hsl(46_100%_58%)]">Longest</span>}
                        {summary.longest?.byDays === e.name && summary.longest.byStretch !== e.name && <span className="font-8bit border border-[hsl(46_100%_58%)] px-1.5 py-0.5 text-[7px] uppercase text-[hsl(46_100%_58%)]">Most days</span>}
                      </p>
                    )}
                    {e.paidBy && <p className="text-[11px] text-mono text-muted-foreground">Paid by {e.paidBy}</p>}
                    <dl className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-[12px] text-mono">
                      <dt className={LABEL}>First day</dt><dd className="text-right">{claimDay(e.firstDay, false)}</dd>
                      <dt className={LABEL}>Last day</dt><dd className="text-right">{claimDay(e.lastDay, false)}</dd>
                      <dt className={LABEL}>How long</dt><dd className="text-right" data-testid="how-long">{howLongText(e.firstDay, e.lastDay)}</dd>
                      <dt className={LABEL}>Days worked</dt><dd className="text-right">{e.days}</dd>
                      <dt className={LABEL}>Hours</dt><dd className="text-right">{e.hours}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[10px] text-mono leading-relaxed text-muted-foreground">
              Gross is the app's estimate from your shifts, before taxes and dues, counted in the week the work was done.
              Weeks run {weekRun(range.weekEnd)}. Check it against your pay stubs before you file.
            </p>
          </>
        )}
      </div>
    </SpacePageWrapper>
  );
}
