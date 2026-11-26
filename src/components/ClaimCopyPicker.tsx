import { useEffect, useState, type ReactNode } from 'react';
import { Copy, SlidersHorizontal } from 'lucide-react';
import { claimDay, claimMoney, claimNameOf, howLongText, type ClaimEmployer, type ClaimWeek } from '@/lib/unemployment';
/** Hours to two places, as a claim form takes them. */
const roundHours = (h: number) => Math.round(h * 100) / 100;
import { cn } from '@/lib/utils';

const LABEL = 'font-8bit text-[7px] uppercase leading-relaxed text-[hsl(188_95%_72%)]';
const PICKS_KEY = 'show-flow-claim-copy';

/** One employer's weeks with work, for "week by week". */
export interface CopyWeek { weekEnding: string; gross: number }

type EmployerField = 'name' | 'address' | 'phone' | 'firstDay' | 'lastDay' | 'howLong' | 'days' | 'hours' | 'gross' | 'paidBy' | 'note' | 'weeks';
type WeekField = 'weekEnding' | 'dates' | 'days' | 'hours' | 'gross' | 'employers';

const EMPLOYER_FIELDS: { id: EmployerField; label: string; text: (e: ClaimEmployer, weeks: CopyWeek[]) => string | undefined }[] = [
  { id: 'name', label: 'Name', text: e => claimNameOf(e) },
  { id: 'address', label: 'Address', text: e => e.info?.address },
  { id: 'phone', label: 'Phone', text: e => e.info?.phone },
  { id: 'firstDay', label: 'First day', text: e => `first day ${claimDay(e.firstDay, false)}` },
  { id: 'lastDay', label: 'Last day', text: e => `last day ${claimDay(e.lastDay, false)}` },
  { id: 'howLong', label: 'How long', text: e => howLongText(e.firstDay, e.lastDay) },
  { id: 'days', label: 'Days worked', text: e => `${e.days} day${e.days === 1 ? '' : 's'}` },
  { id: 'hours', label: 'Hours', text: e => `${roundHours(e.hours)} h` },
  { id: 'gross', label: 'Gross', text: e => claimMoney(e.gross) },
  { id: 'paidBy', label: 'Paid by', text: e => (e.paidBy ? `paid by ${e.paidBy}` : undefined) },
  { id: 'note', label: 'Note', text: e => e.info?.note },
  // Its own lines, under the employer.
  { id: 'weeks', label: 'Week by week', text: () => undefined },
];

const WEEK_FIELDS: { id: WeekField; label: string; text: (w: ClaimWeek) => string | undefined }[] = [
  { id: 'weekEnding', label: 'Week ending', text: w => `Week ending ${claimDay(w.weekEnding, false)}` },
  { id: 'dates', label: 'Dates', text: w => `${claimDay(w.start, false)} to ${claimDay(w.end, false)}` },
  { id: 'days', label: 'Days worked', text: w => `${w.days} day${w.days === 1 ? '' : 's'}` },
  { id: 'hours', label: 'Hours', text: w => `${roundHours(w.hours)} h` },
  { id: 'gross', label: 'Gross', text: w => claimMoney(w.gross) },
  { id: 'employers', label: 'Employers', text: w => (w.lines.length ? w.lines.map(l => `${l.employer} ${roundHours(l.hours)} h ${claimMoney(l.gross)}`).join('; ') : 'no work') },
];

/** What's copied when nothing has been picked: what the button always copied. */
const DEFAULT_PICKS = { employers: ['name', 'gross'] as EmployerField[], weeks: ['weekEnding', 'gross'] as WeekField[] };

const loadPicks = (): typeof DEFAULT_PICKS => {
  try {
    const saved = JSON.parse(localStorage.getItem(PICKS_KEY) ?? 'null');
    return {
      employers: Array.isArray(saved?.employers) ? saved.employers.filter((f: string) => EMPLOYER_FIELDS.some(x => x.id === f)) : DEFAULT_PICKS.employers,
      weeks: Array.isArray(saved?.weeks) ? saved.weeks.filter((f: string) => WEEK_FIELDS.some(x => x.id === f)) : DEFAULT_PICKS.weeks,
    };
  } catch {
    return DEFAULT_PICKS;
  }
};

/**
 * The claim copied as text, with you picking what goes in it: for each
 * employer its name, address, phone, days, hours, gross and so on, or for each
 * week its dates, hours and gross. One line each, the picks in the order
 * shown; "week by week" adds an employer's weeks under it. The picks are
 * remembered on this phone. `extra` lines (bulk stubs in no week) follow.
 */
export default function ClaimCopyPicker({ view, employers, weeks, weeksOf, extra = [], onCopy, className, trailing }: {
  className?: string;
  /** Another button for the same row (Excel), so the picks below get the full width. */
  trailing?: ReactNode;
  view: 'weeks' | 'employers';
  employers: ClaimEmployer[];
  weeks: ClaimWeek[];
  weeksOf: (name: string) => CopyWeek[];
  extra?: string[];
  onCopy: (text: string, count: number) => void;
}) {
  const [picks, setPicks] = useState(loadPicks);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* only a convenience */ }
  }, [picks]);

  const fields = view === 'employers' ? EMPLOYER_FIELDS : WEEK_FIELDS;
  const picked = view === 'employers' ? picks.employers : picks.weeks;
  const toggle = (id: string) => setPicks(cur => {
    const list: string[] = view === 'employers' ? cur.employers : cur.weeks;
    const next = list.includes(id) ? list.filter(f => f !== id) : fields.map(f => f.id).filter(f => f === id || list.includes(f));
    return view === 'employers' ? { ...cur, employers: next as EmployerField[] } : { ...cur, weeks: next as WeekField[] };
  });

  const lines: string[] = view === 'employers'
    ? employers.flatMap(e => {
      const own = EMPLOYER_FIELDS.filter(f => picks.employers.includes(f.id)).map(f => f.text(e, [])).filter((t): t is string => !!t?.trim());
      const byWeek = picks.employers.includes('weeks')
        ? weeksOf(e.name).map(w => `  Week ending ${claimDay(w.weekEnding, false)}: ${claimMoney(w.gross)}`)
        : [];
      return [...(own.length ? [own.join(' · ')] : []), ...byWeek];
    })
    : [...weeks.map(w => WEEK_FIELDS.filter(f => picks.weeks.includes(f.id)).map(f => f.text(w)).filter((t): t is string => !!t?.trim()).join(' · ')).filter(Boolean), ...extra];
  const count = view === 'employers' ? employers.length : weeks.length;
  const pickedLabels = fields.filter(f => picked.includes(f.id as never)).map(f => f.label);

  return (
    <div className={cn('space-y-2', className)} data-testid="claim-copy">
      <div className="flex gap-2">
        <button type="button" onClick={() => onCopy(lines.join('\n'), count)} disabled={lines.length === 0} data-testid="copy-both"
          className="pixel-button pick-off flex min-w-0 flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono disabled:opacity-40">
          <Copy size={13} aria-hidden /> <span className="truncate">{pickedLabels.length ? pickedLabels.join(' + ') : 'Pick what to copy'}</span>
        </button>
        <button type="button" onClick={() => setChoosing(c => !c)} aria-expanded={choosing} aria-label="Pick what to copy" data-testid="copy-pick"
          className={cn('pixel-button flex shrink-0 items-center px-2.5 py-1.5', choosing ? 'pick-on' : 'pick-off')}>
          <SlidersHorizontal size={14} aria-hidden />
        </button>
        {trailing}
      </div>
      {choosing && (
        <div className="neon-well space-y-2 p-2.5" data-testid="copy-fields">
          <p className={LABEL}>Copy for each {view === 'employers' ? 'employer' : 'week'}</p>
          <div className="flex flex-wrap gap-1.5">
            {fields.map(f => (
              <button key={f.id} type="button" onClick={() => toggle(f.id)} aria-pressed={picked.includes(f.id as never)} data-testid="copy-field"
                className={cn('pixel-button px-2 py-1 text-[11px] font-bold text-mono', picked.includes(f.id as never) ? 'pick-on' : 'pick-off')}>
                {f.label}
              </button>
            ))}
          </div>
          {lines.length > 0 && (
            <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words border border-border/60 p-2 text-[11px] text-mono text-muted-foreground" data-testid="copy-preview">
              {lines.slice(0, 4).join('\n')}{lines.length > 4 ? `\n… ${lines.length - 4} more` : ''}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
