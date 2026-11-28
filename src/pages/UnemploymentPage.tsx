import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import ClaimExcelPicker from '@/components/ClaimExcelPicker';
import { EMPLOYER_COLUMNS, STUB_COLUMNS, WEEK_COLUMNS, shapeSheet, type ClaimExcelPicks, type ClaimRow } from '@/lib/claimExcel';
import { ArrowLeft, Check, ChevronDown, Copy, Download, Plus } from 'lucide-react';
import { format, parseISO, subMonths } from 'date-fns';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import DateWheels, { Wheel } from '@/components/DateWheels';
import CertifyPanel from '@/components/CertifyPanel';
import ClaimPayStubs from '@/components/ClaimPayStubs';
import ClaimPastePay from '@/components/ClaimPastePay';
import ClaimStubProof from '@/components/ClaimStubProof';
import ClaimEmployerCard, { type EmployerWeek } from '@/components/ClaimEmployerCard';
import ClaimCopyPicker from '@/components/ClaimCopyPicker';
import PickList from '@/components/PickList';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { localToday } from '@/lib/today';
import { resolveEmployer } from '@/lib/employerMatch';
import { EMPLOYER_COLOURS, employerColours, employerId } from '@/lib/employerColours';
import { WEEKDAYS, claimDay, claimEmployerOf, claimMoney, claimNameOf, claimSummary, howLongText, isClaimDay, sortEmployers, sortWeeks, weekRun, type ClaimLine, type ClaimSort, type ClaimWeek, type WeekEnd } from '@/lib/unemployment';
import { clearSpot, peekSpot } from '@/lib/returnSpot';
import { cn } from '@/lib/utils';

/** "1 day", "3 days". */
const daysText = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** A label in the arcade font, small, in the cyan of the calendar's lines. */
const LABEL = 'neon-label text-[hsl(188_95%_72%)]';

/** A gross figure that copies itself when tapped, with a small copy mark to say so. */
function GrossButton({ amount, onCopy, className }: { amount: number; onCopy: (n: number) => void; className?: string }) {
  return (
    <button type="button" onClick={() => onCopy(amount)} aria-label={`Copy ${claimMoney(amount)}`} data-testid="copy-amount"
      className={cn('neon-title flex shrink-0 items-center gap-1 font-bold text-mono active:opacity-70', className)}>
      {claimMoney(amount)}
      <Copy size={11} className="text-[hsl(188_90%_70%)]" aria-hidden />
    </button>
  );
}

/** The orders the lists can be put in, as the chips say them. */
const SORTS: { value: ClaimSort; label: string; says: string }[] = [
  { value: 'recent', label: 'Now → 🦖', says: 'Most recent first' },
  { value: 'oldest', label: '🦖 → now', says: 'Oldest first' },
  { value: 'fewHours', label: 'Hours: low → high', says: 'Fewest hours first' },
  { value: 'mostHours', label: 'Hours: high → low', says: 'Most hours first' },
];
const SORT_KEY = 'show-flow-claim-sort';
const loadSort = (): ClaimSort => {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return SORTS.some(o => o.value === saved) ? saved as ClaimSort : 'recent';
  } catch {
    return 'recent';
  }
};

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
  const { prefs, setClaimChecked, setClaimRange } = useUserPrefs();
  const today = localToday();
  // The dates come from your synced settings, so every device opens on them;
  // this device's last ones stand in until those have loaded.
  const [range, setRange] = useState<ClaimRange>(() => (prefs.claimRange as ClaimRange | undefined) ?? loadRange(today));
  const touched = useRef(false);
  const synced = prefs.claimRange;
  useEffect(() => {
    if (!touched.current && synced) setRange(synced as ClaimRange);
  }, [synced?.from, synced?.through, synced?.weekEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  // Saved by itself a moment after the last change, and saved now with Save.
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const saveRange = useRef(setClaimRange);
  saveRange.current = setClaimRange;
  const changeRange = (next: (r: ClaimRange) => ClaimRange) => {
    touched.current = true;
    setSaveState('saving');
    setRange(next);
  };
  // The wheels fold away once the dates are saved and not being changed:
  // shut when the page opens on saved dates, open the first time.
  const [datesOpen, setDatesOpen] = useState(() => !prefs.claimRange);
  const openedByHand = useRef(false);
  // Saved dates arrive a moment after the page: shut then, unless you opened them or are changing them.
  useEffect(() => {
    if (synced && !touched.current && !openedByHand.current) setDatesOpen(false);
  }, [!!synced]); // eslint-disable-line react-hooks/exhaustive-deps
  const openDates = () => { openedByHand.current = true; setDatesOpen(true); };
  const saveNow = () => {
    saveRange.current(range);
    setSaveState('saved');
    setDatesOpen(false);
    toast.success('Dates saved');
  };
  // By employer first: that's what the claim form asks for.
  const [view, setView] = useState<'weeks' | 'employers'>('employers');
  /** The "go to an employer" box, and the employer last picked in it. */
  const [jump, setJump] = useState('');
  const [focus, setFocus] = useState<{ name: string; n: number } | null>(null);
  // Back from a shift opened here: the same place on the page, its employer's box open again.
  const [backFrom] = useState(() => peekSpot('/benefits/unemployment'));
  useEffect(() => {
    if (!backFrom) return;
    clearSpot();
    const t = window.setTimeout(() => window.scrollTo(0, backFrom.scrollY), 80);
    return () => window.clearTimeout(t);
  }, [backFrom]);
  /** A week's line whose pay stubs are being looked at. */
  const [proof, setProof] = useState<{ week: ClaimWeek; line: ClaimLine } | null>(null);
  const [sort, setSort] = useState<ClaimSort>(loadSort);
  useEffect(() => {
    try { localStorage.setItem(SORT_KEY, sort); } catch { /* only a convenience */ }
  }, [sort]);

  useEffect(() => {
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(range)); } catch { /* the synced copy is the one that matters */ }
    if (!touched.current) return;
    const t = window.setTimeout(() => { saveRange.current(range); setSaveState('saved'); }, 600);
    return () => window.clearTimeout(t);
  }, [range]);

  const backwards = range.through < range.from;
  const summary = useMemo(
    () => claimSummary(data.jobs, data.employers, prefs.payer, range.from, range.through, range.weekEnd, prefs.claimStubs, prefs.claimEmployers, !!prefs.claimUseStubPay),
    [data.jobs, data.employers, prefs.payer, range, prefs.claimStubs, prefs.claimEmployers, prefs.claimUseStubPay],
  );

  const weeks = useMemo(() => sortWeeks(summary.weeks, sort), [summary.weeks, sort]);

  // Weeks ticked off as checked (entered on the state's site, say), and a
  // week's "+": the pay stub form, set to that week.
  const checked = useMemo(() => new Set(prefs.claimChecked), [prefs.claimChecked]);
  const checkedHere = summary.weeks.filter(w => checked.has(w.weekEnding)).length;
  const toggleChecked = (weekEnding: string) =>
    setClaimChecked(checked.has(weekEnding) ? prefs.claimChecked.filter(d => d !== weekEnding) : [...prefs.claimChecked, weekEnding]);
  const [stubRequest, setStubRequest] = useState<{ start: string; end: string; nonce: number } | null>(null);

  // Each employer's weeks with work, most recent first: shown when its box is tapped.
  const weeksOf = useMemo(() => {
    const by = new Map<string, Map<string, EmployerWeek>>();
    for (const w of summary.weeks) {
      for (const l of w.lines) {
        const weeksFor = by.get(l.employer) ?? new Map<string, EmployerWeek>();
        const cur = weeksFor.get(w.weekEnding) ?? { weekEnding: w.weekEnding, hours: 0, gross: 0, fromStub: false };
        weeksFor.set(w.weekEnding, {
          ...cur,
          hours: Math.round((cur.hours + l.hours) * 1000) / 1000,
          gross: Math.round((cur.gross + l.gross) * 100) / 100,
          fromStub: cur.fromStub || !!l.fromStub || !!l.perStub,
          ...(l.stubSays != null ? { stubSays: Math.round(((cur.stubSays ?? 0) + l.stubSays) * 100) / 100 } : {}),
        });
        by.set(l.employer, weeksFor);
      }
    }
    return (name: string) => [...(by.get(name)?.values() ?? [])].sort((a, b) => b.weekEnding.localeCompare(a.weekEnding));
  }, [summary.weeks]);

  // Every employer you've worked for, to pick from.
  const knownEmployers = useMemo(() => [...new Set([
    ...data.employers.map(e => e.name),
    ...data.jobs.map(j => j.client?.trim()).filter((n): n is string => !!n),
  ])].sort((a, b) => a.localeCompare(b)), [data.jobs, data.employers]);
  const employers = useMemo(() => sortEmployers(summary.employers, sort), [summary.employers, sort]);

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

  const preset = (months: number) => changeRange(r => ({ ...r, from: iso(subMonths(parseISO(today), months)), through: today }));

  /** Gross as a form's number box takes it: no dollar sign, no commas, cents. */
  const plain = (n: number) => n.toFixed(2);

  const copyText = async (text: string, said: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(said);
    } catch {
      toast.error("Couldn't copy here. Try the Excel download.");
    }
  };
  // Bulk stubs in no week, after the weeks when the weeks are copied.
  const unsplitLines = summary.unsplit.map(u => `Not split by week, ${u.employer} ${claimDay(u.start, false)} to ${claimDay(u.end, false)}: ${claimMoney(u.gross)}`);
  // One gross, tapped.
  const copyAmount = (n: number) => void copyText(plain(n), `Copied ${claimMoney(n)}`);

  // The Excel download, cut to the sheets, columns and employers picked (see ClaimExcelPicker).
  const [excelOpen, setExcelOpen] = useState(false);
  const download = (picks: ClaimExcelPicks) => {
    const weekRows: ClaimRow[] = weeks.flatMap((w): ClaimRow[] => {
      const base = { 'Week ending': w.weekEnding, From: w.start, Through: w.end, 'Days worked': w.days };
      return w.lines.length === 0
        ? [{ ...base, Employer: 'No work', Hours: 0, Gross: 0 }]
        : w.lines.map(l => ({ ...base, Employer: l.fromStub ? `${l.employer} (from pay stub)` : l.perStub ? `${l.employer} (per pay stub)` : l.employer, Hours: l.hours, Gross: l.gross, __employer: l.employer }));
    }).concat(summary.unsplit.map(u => ({
      'Week ending': 'Not split by week', From: u.start, Through: u.end, 'Days worked': 0, Employer: `${u.employer} (pay stub, not averaged)`, Hours: u.hours, Gross: u.gross, __employer: u.employer,
    })));
    const employerRows: ClaimRow[] = employers.map(e => ({
      __employer: e.name,
      Employer: claimNameOf(e),
      'On the calendar as': e.info?.claimName ? e.name : '',
      Address: e.info?.address ?? '', Phone: e.info?.phone ?? '', Note: e.info?.note ?? '',
      'Worked for longest': [summary.longest?.byStretch === e.name && 'Longest, first day to last', summary.longest?.byDays === e.name && 'Most days worked'].filter(Boolean).join('; '),
      'Paid by': e.paidBy ?? '', 'First day': e.firstDay, 'Last day': e.lastDay, 'How long': howLongText(e.firstDay, e.lastDay),
      'Days worked': e.days, Hours: e.hours, Gross: e.gross, 'From pay stubs': e.fromStub ? 'Yes' : '',
    }));
    const stubRows: ClaimRow[] = prefs.claimStubs.map(st => {
      const use = summary.stubs.find(u => u.stub.id === st.id);
      return {
        __employer: st.employer,
        Employer: st.employer, From: st.start, Through: st.end, Hours: st.hours, Gross: st.gross,
        Counted: !use ? 'No: outside your dates' : use.used ? 'Yes: nothing on the calendar for it' : use.usesPay ? `Yes: believed, placed by the calendar's ${use.shifts} shift(s)${use.check?.farOff ? ' (far from the calendar: check it)' : ''}` : use.status === 'calendar' ? `No: the calendar's ${use.shifts} shift(s) count instead` : 'No: another stub covers the same days',
      };
    });
    const book = XLSX.utils.book_new();
    const add = (rows: Record<string, string | number>[], name: string) => {
      if (rows.length > 0) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), name);
    };
    if (picks.sheets.includes('weeks')) add(shapeSheet(weekRows, WEEK_COLUMNS, picks.weekColumns, picks.leaveOut), 'Weeks');
    if (picks.sheets.includes('employers')) add(shapeSheet(employerRows, EMPLOYER_COLUMNS, picks.employerColumns, picks.leaveOut), 'Employers');
    if (picks.sheets.includes('stubs')) add(shapeSheet(stubRows, STUB_COLUMNS, [...STUB_COLUMNS], picks.leaveOut), 'Pay stubs');
    if (book.SheetNames.length === 0) { toast.error('Nothing to put in it: pick a sheet, a column and an employer.'); return; }
    XLSX.writeFile(book, `unemployment-claim-${range.from}-to-${range.through}.xlsx`);
    toast.success(`Saved the Excel: ${book.SheetNames.join(', ')}`);
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

        {/* The dates: one line once saved, the wheels when tapped (or when they run backwards). */}
        {!(datesOpen || backwards) ? (
          <button type="button" onClick={openDates} aria-expanded={false} data-testid="claim-dates-summary"
            className="flex w-full items-center justify-between gap-3 border border-[hsl(312_95%_68%/0.5)] bg-[#0b0614]/70 p-3 text-left">
            <span className="min-w-0">
              <span className="block neon-heading text-[hsl(312_95%_75%)]">Claim dates</span>
              <span className="mt-1 block text-[13px] font-bold text-mono text-foreground">{claimDay(range.from, false)} to {claimDay(range.through, false)}</span>
              <span className="block text-[11px] text-mono text-muted-foreground">
                Weeks run {weekRun(range.weekEnd)} · <span className={saveState === 'saved' ? 'text-dot-paid' : ''}>{saveState === 'saved' ? '✓ Saved' : 'Saving…'}</span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-mono text-[hsl(188_90%_70%)]">
              Change <ChevronDown size={14} aria-hidden />
            </span>
          </button>
        ) : (
        <div className="space-y-3 border border-[hsl(312_95%_68%/0.5)] bg-[#0b0614]/70 p-3" data-testid="claim-dates">
          {/* Fold it back without changing anything. */}
          {!backwards && prefs.claimRange && (
            <button type="button" onClick={() => setDatesOpen(false)} aria-expanded data-testid="claim-dates-fold"
              className="flex w-full items-center justify-between gap-2 text-left">
              <span className="neon-heading text-[hsl(312_95%_75%)]">Claim dates</span>
              <ChevronDown size={14} className="rotate-180 text-[hsl(188_90%_70%)]" aria-hidden />
            </button>
          )}
          <DateWheels label="From" value={range.from} firstYear={firstYear} lastYear={thisYear} testId="claim-from"
            onChange={from => changeRange(r => ({ ...r, from }))} />
          <DateWheels label="Through" value={range.through} firstYear={firstYear} lastYear={thisYear} testId="claim-through"
            onChange={through => changeRange(r => ({ ...r, through }))} />
          {/* Most states count weeks Sunday to Saturday; some don't. */}
          <div className="flex items-center gap-3" data-testid="claim-week-end">
            <div className="min-w-0 flex-1">
              <p className="neon-heading text-[hsl(312_95%_75%)]">Weeks end on</p>
              <p className="mt-1 text-[11px] text-mono text-muted-foreground">{weekRun(range.weekEnd)}</p>
            </div>
            <div className="w-24 shrink-0">
              <Wheel loop label="Weeks end on" items={WEEK_ENDS} value={range.weekEnd} testId="claim-week-end-wheel"
                onChange={v => changeRange(r => ({ ...r, weekEnd: v as WeekEnd }))} />
            </div>
          </div>
          <div className="flex gap-2">
            {[12, 18].map(m => (
              <button key={m} type="button" onClick={() => preset(m)} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold">
                Last {m} months
              </button>
            ))}
          </div>
          {/* Saves by itself; says so, and can be saved on the spot. */}
          <div className="flex items-center justify-between gap-2" data-testid="claim-saved">
            <span className={cn('text-[11px] font-bold text-mono', saveState === 'saved' ? 'text-dot-paid' : 'text-muted-foreground')}>
              {saveState === 'saved' ? '✓ Saved' : 'Saving…'}
            </span>
            <button type="button" onClick={saveNow} data-testid="claim-save" className="pixel-button pick-off px-3 py-1 text-[11px] font-bold text-mono">
              Save
            </button>
          </div>
        </div>
        )}

        {/* Pay stubs, for work that isn't on the calendar. */}
        <ClaimPayStubs uses={summary.stubs} weekEnd={range.weekEnd} colourOf={colourOf} employerNames={[...knownEmployers, ...summary.employers.map(e => e.name)]} request={stubRequest} />

        {/* The proof behind a week's line: its pay stubs, tapped. */}
        <ClaimStubProof open={!!proof} onClose={() => setProof(null)} week={proof?.week ?? null} line={proof?.line ?? null}
          uses={summary.stubs} claimWeeks={summary.weeks} weekEnd={range.weekEnd} />

        {/* A pay list pasted from a payroll site, week by week. */}
        <ClaimPastePay weekEnd={range.weekEnd} colourOf={colourOf} employerNames={knownEmployers} from={range.from} through={range.through} />

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
                    ? line('Worked for longest', byStretch, `${howLongText(of(byStretch).firstDay, of(byStretch).lastDay)} · ${daysText(of(byStretch).days)} worked`)
                    : (
                      <>
                        {line('Longest, first day to last', byStretch, `${howLongText(of(byStretch).firstDay, of(byStretch).lastDay)}`)}
                        {line('Most days worked', byDays, `${daysText(of(byDays).days)} · ${of(byDays).hours} h`)}
                      </>
                    )}
                </div>
              );
            })()}

            <div className="flex gap-2" role="tablist" aria-label="Show">
              {(['weeks', 'employers'] as const).map(v => (
                <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                  className={cn('pixel-button flex-1 py-2.5 font-mono text-xs font-bold uppercase tracking-widest', view === v ? 'pick-on' : 'pick-off')}>
                  {v === 'weeks' ? 'By week' : 'By employer'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Order" data-testid="claim-sort">
              {SORTS.map(o => (
                <button key={o.value} type="button" role="radio" aria-checked={sort === o.value} aria-label={o.says} onClick={() => setSort(o.value)}
                  className={cn('pixel-button py-1.5 text-[12px] font-bold text-mono', sort === o.value ? 'pick-on' : 'pick-off')}>
                  {o.label}
                </button>
              ))}
            </div>

            {/* Copy each employer (or week), one a line, with what you pick in it; or all of it as Excel. */}
            <ClaimCopyPicker view={view} employers={employers} weeks={weeks} weeksOf={weeksOf} extra={unsplitLines}
              onCopy={(text, n) => void copyText(text, `Copied ${n} ${view === 'weeks' ? 'week' : 'employer'}${n === 1 ? '' : 's'}`)}
              trailing={(
                <button type="button" onClick={() => setExcelOpen(o => !o)} aria-expanded={excelOpen} data-testid="excel-open"
                  className={cn('pixel-button flex shrink-0 items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-mono', excelOpen ? 'pick-on' : 'pick-off')}>
                  <Download size={13} aria-hidden /> Excel
                </button>
              )} />
            {/* Excel, with the sheets, columns and employers picked first. */}
            {excelOpen && (
              <ClaimExcelPicker
                employers={summary.employers.map(e => ({ name: e.name, shown: claimNameOf(e) }))}
                hasStubs={prefs.claimStubs.length > 0}
                onDownload={download} />
            )}

            {/* Straight to one employer: its box opens and comes into view. */}
            {view === 'employers' && employers.length > 1 && (
              <PickList value={jump} onChange={setJump} options={employers.map(e => claimNameOf(e))} placeholder="Go to an employer…" testId="employer-jump"
                onPick={name => {
                  const e = employers.find(x => claimNameOf(x) === name || x.name === name);
                  if (e) setFocus({ name: e.name, n: Date.now() });
                  setJump('');
                }} />
            )}

            {view === 'weeks' ? (
              <>
              <p className="flex items-center justify-between text-[11px] text-mono text-muted-foreground" data-testid="checked-count">
                <span>Checked {checkedHere} of {summary.weeks.length} weeks</span>
                {checkedHere > 0 && (
                  <button type="button" onClick={() => setClaimChecked(prefs.claimChecked.filter(d => !summary.weeks.some(w => w.weekEnding === d)))}
                    className="text-[hsl(188_90%_70%)] underline">Clear ticks</button>
                )}
              </p>
              <ul className="neon-well divide-y divide-[hsl(312_95%_68%/0.25)]" data-testid="claim-weeks">
                {weeks.map(w => (
                  <li key={w.weekEnding} className={cn('flex gap-2.5 px-3 py-2.5', checked.has(w.weekEnding) && 'bg-[hsl(140_100%_52%/0.06)]')}>
                    <div className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
                      <button type="button" onClick={() => toggleChecked(w.weekEnding)} aria-pressed={checked.has(w.weekEnding)}
                        aria-label={`${checked.has(w.weekEnding) ? 'Checked' : 'Check'}: week ending ${claimDay(w.weekEnding, false)}`} data-testid="week-check"
                        className={cn('flex h-6 w-6 items-center justify-center border', checked.has(w.weekEnding)
                          ? 'border-dot-paid bg-dot-paid/20 text-dot-paid shadow-[0_0_6px_hsl(var(--dot-paid)/0.6)]'
                          : 'border-[hsl(188_95%_62%/0.6)] text-transparent')}>
                        <Check size={15} strokeWidth={3} aria-hidden />
                      </button>
                      <button type="button" onClick={() => setStubRequest({ start: w.start, end: w.end, nonce: Date.now() })}
                        aria-label={`Add a pay stub for the week ending ${claimDay(w.weekEnding, false)}`} data-testid="week-add"
                        className="flex h-6 w-6 items-center justify-center border border-[hsl(312_95%_68%/0.6)] text-[hsl(312_95%_75%)]">
                        <Plus size={14} aria-hidden />
                      </button>
                    </div>
                    <div className={cn('min-w-0 flex-1', w.lines.length === 0 && 'opacity-60')}>
                    <p className={cn(LABEL, 'flex justify-between gap-2')}>
                      <span>Week ending</span>
                      <span>{w.fromStub && w.days === 0 ? 'Pay stub' : `${w.days} day${w.days === 1 ? '' : 's'}`}</span>
                    </p>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="neon-title text-[13px] font-bold text-mono">{claimDay(w.weekEnding)}</p>
                      <GrossButton amount={w.gross} onCopy={copyAmount} className="text-[13px]" />
                    </div>
                    {w.partial && (
                      <p className="text-[11px] text-mono text-warning">Only {claimDay(w.start, false)} to {claimDay(w.end, false)} is in your dates</p>
                    )}
                    {w.lines.length === 0 ? (
                      <p className="text-[11px] text-mono text-muted-foreground">No work · 0 hours</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {w.lines.map(l => (
                          <li key={l.employer + (l.fromStub ? ' stub' : '')} className="flex flex-wrap items-baseline justify-between gap-x-2 text-[12px] text-mono">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="neon-soft truncate font-bold" style={{ color: colourOf(l.employer) }}>{l.employer}</span>
                              {(l.fromStub || l.perStub) && (
                                <button type="button" onClick={() => setProof({ week: w, line: l })} disabled={!l.stubs?.length} data-testid="stub-tag"
                                  aria-label={`See the pay stub behind ${l.employer}, week ending ${claimDay(w.weekEnding, false)}`}
                                  className="shrink-0 border border-[hsl(46_100%_58%)] px-1 py-0.5 font-mono text-[9px] font-bold uppercase leading-tight tracking-wider text-[hsl(46_100%_58%)] underline-offset-2 active:opacity-70">
                                  Stub ›
                                </button>
                              )}
                            </span>
                            <span className="shrink-0 text-muted-foreground">{l.hours} h · {claimMoney(l.gross)}</span>
                            {/* A pay stub for these shifts, beside the estimate that's counted. */}
                            {l.stubSays != null && (
                              <button type="button" onClick={() => setProof({ week: w, line: l })} data-testid="stub-says"
                                className="basis-full text-right text-[11px] text-[hsl(46_100%_58%)] underline underline-offset-2">
                                pay stub says {claimMoney(l.stubSays)} · estimate counted ›
                              </button>
                            )}
                          </li>
                        ))}
                        {w.pto > 0 && <li className="text-[11px] text-mono text-muted-foreground">Includes {claimMoney(w.pto)} paid time off</li>}
                      </ul>
                    )}
                    </div>
                  </li>
                ))}
              </ul>
              {/* Bulk stubs not averaged: in the totals and under their employer, in no week. */}
              {summary.unsplit.length > 0 && (
                <div className="neon-well space-y-1.5 p-3" data-testid="claim-unsplit">
                  <p className={LABEL}>Not split by week</p>
                  <ul className="space-y-1">
                    {summary.unsplit.map(u => (
                      <li key={u.stubId} className="flex items-baseline justify-between gap-2 text-[12px] text-mono">
                        <span className="min-w-0">
                          <span className="neon-soft block truncate font-bold" style={{ color: colourOf(u.employer) }}>{u.employer}</span>
                          <span className="block text-[11px] text-muted-foreground">{claimDay(u.start, false)} to {claimDay(u.end, false)} · {u.hours} h</span>
                        </span>
                        <span className="neon-title shrink-0 font-bold">{claimMoney(u.gross)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-mono text-muted-foreground">In the totals and under the employer, but in no one week.</p>
                </div>
              )}
              </>
            ) : summary.employers.length === 0 ? (
              <p className="neon-well p-4 text-center text-sm text-mono text-muted-foreground">No work in these dates.</p>
            ) : (
              <ul className="space-y-2" data-testid="claim-employers">
                {employers.map(e => (
                  <ClaimEmployerCard key={e.name} employer={e} colour={colourOf(e.name)} onCopy={copyAmount} knownEmployers={knownEmployers} weeks={weeksOf(e.name)} weekEnd={range.weekEnd}
                    focus={focus?.name === e.name ? focus.n : 0} startOpen={backFrom?.employer === e.name}
                    unsplit={summary.unsplit.filter(u => u.employer === e.name).reduce((sum, u) => sum + u.gross, 0)}
                    linkChoices={[...new Set([...summary.employers.map(x => x.name), ...knownEmployers])].filter(n => n.toLowerCase() !== e.name.toLowerCase() && !(e.linked ?? []).some(l => l.toLowerCase() === n.toLowerCase()))}
                    longest={summary.longest?.byStretch === e.name ? 'stretch' : summary.longest?.byDays === e.name ? 'days' : undefined}
                    stubFits={summary.stubs
                      .filter(u => u.fits?.length && u.covered?.length && [e.name, ...(e.linked ?? [])].some(n => n.toLowerCase() === u.stub.employer.trim().toLowerCase()))
                      .map(u => ({ stub: u.stub, fits: u.fits!, days: new Set(u.covered!.map(c => c.date)).size }))}
                    shifts={data.jobs.filter(j => j.status !== 'cancelled' && isClaimDay(j.date) && j.date >= range.from && j.date <= range.through
                      && claimEmployerOf(j, data.employers) === e.name)} />
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
