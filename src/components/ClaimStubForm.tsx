import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import { Input } from '@/components/ui/input';
import DateWheels from '@/components/DateWheels';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { localToday } from '@/lib/today';
import { isClaimDay, isUnclearEmployer, readAmount, sameStub, type ClaimStub } from '@/lib/unemployment';
import { multiWeek, periodText } from '@/lib/stubPeriod';
import { cn } from '@/lib/utils';

const LABEL = 'font-8bit text-[7px] uppercase leading-relaxed text-[hsl(188_95%_72%)]';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export interface StubDraft { employer: string; start: string; end: string; hours: string; gross: string; noWeeks?: boolean; paidOn?: string }

/**
 * A pay stub typed in: who paid it (picked from the list, or typed), the pay
 * period, its hours and gross, when it was paid, and for a long period
 * whether it's averaged over its weeks. Used in the Pay stubs list and on an
 * employer's box, where it starts with that employer picked. The same
 * employer and pay period twice is refused: that's a copy, not another stub.
 */
export default function ClaimStubForm({ initial, id, employerNames, onDone, className }: {
  initial: StubDraft;
  /** The stub being changed; none for a new one. */
  id?: string;
  employerNames: string[];
  onDone: () => void;
  className?: string;
}) {
  const { prefs, setClaimStubs } = useUserPrefs();
  const stubs = prefs.claimStubs;
  const [draft, setDraft] = useState<StubDraft>(initial);
  const listId = useId();
  const thisYear = Number(localToday().slice(0, 4));
  const set = (patch: Partial<StubDraft>) => setDraft(cur => ({ ...cur, ...patch }));
  /** The pay period as a week, or two, ending on the day it ends. */
  const spanWeeks = (weeks: 1 | 2) => setDraft(cur => ({ ...cur, start: iso(addDays(parseISO(cur.end), 1 - weeks * 7)) }));
  // Who a stub can be from: never "Unknown" or "No employer named".
  const names = [...new Set(employerNames.map(n => n.trim()).filter(n => n && !isUnclearEmployer(n)))].sort((a, b) => a.localeCompare(b));

  const save = () => {
    const d = draft;
    const employer = d.employer.trim();
    const hours = d.hours.trim() ? readAmount(d.hours) : 0;
    const gross = d.gross.trim() ? readAmount(d.gross) : 0;
    if (!employer) { toast.error('Who paid it? Put in the employer.'); return; }
    if (d.end < d.start) { toast.error('The pay period ends before it starts.'); return; }
    if (!Number.isFinite(hours) || hours < 0 || !Number.isFinite(gross) || gross < 0) { toast.error('Hours and gross need to be numbers.'); return; }
    if (hours === 0 && gross === 0) { toast.error('Put in the hours or the gross from the stub.'); return; }
    // The same employer and pay period again: that's a copy, not another stub.
    const copy = sameStub(stubs, { employer, start: d.start, end: d.end, paidOn: d.paidOn && isClaimDay(d.paidOn) ? d.paidOn : undefined }, id);
    if (copy) { toast.error(`You already have a ${copy.employer} stub for ${periodText(copy.start, copy.end)}. Edit that one.`); return; }
    const before = stubs.find(s => s.id === id);
    const stub: ClaimStub = {
      id: before?.id ?? crypto.randomUUID(),
      employer, start: d.start, end: d.end, hours, gross: Math.round(gross * 100) / 100,
      createdAt: before?.createdAt ?? new Date().toISOString(),
      ...(d.noWeeks && multiWeek(d.start, d.end) ? { noWeeks: true } : {}),
      ...(d.paidOn && isClaimDay(d.paidOn) ? { paidOn: d.paidOn } : {}),
      ...(before?.useEstimate ? { useEstimate: true } : {}),
      ...(before?.weeks && before.start === d.start && before.end === d.end ? { weeks: before.weeks } : {}),
      // Kept through an edit: its own pay for the calendar's shifts, its rate, and its days if the period is the same.
      ...(before?.usePay ? { usePay: true } : {}),
      ...(before?.rate ? { rate: before.rate } : {}),
      ...(before?.days && before.start === d.start && before.end === d.end ? { days: before.days } : {}),
    };
    setClaimStubs(before ? stubs.map(s => (s.id === before.id ? stub : s)) : [...stubs, stub]);
    toast.success(before ? 'Pay stub saved' : `Pay stub added for ${employer}`);
    onDone();
  };

  return (
    <div className={cn('space-y-3 border-t border-[hsl(312_95%_68%/0.3)] pt-3', className)} data-testid="stub-form">
      <label className="block space-y-1">
        <span className={LABEL}>Employer</span>
        {/* Drawn, not the phone's own: Safari draws its own as a white box. */}
        {names.length > 0 && (
          <span className="relative block">
            <select value={names.includes(draft.employer) ? draft.employer : ''} onChange={e => e.target.value && set({ employer: e.target.value })}
              aria-label="Pick the employer" data-testid="stub-employer-pick"
              className="w-full appearance-none border border-[hsl(188_95%_62%/0.5)] bg-background p-2 pr-8 text-base text-mono text-foreground [color-scheme:dark]">
              <option value="">Pick an employer, or type one below…</option>
              {names.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <ChevronDown size={16} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(188_90%_70%)]" aria-hidden />
          </span>
        )}
        <Input value={draft.employer} list={listId} placeholder="Who the stub is from"
          onChange={e => set({ employer: e.target.value })} className="text-mono" data-testid="stub-employer" />
        <datalist id={listId}>{names.map(n => <option key={n} value={n} />)}</datalist>
      </label>
      <DateWheels label="Pay period from" value={draft.start} firstYear={thisYear - 6} lastYear={thisYear}
        onChange={start => set({ start })} testId="stub-start" />
      <DateWheels label="Pay period through" value={draft.end} firstYear={thisYear - 6} lastYear={thisYear}
        onChange={end => set({ end })} testId="stub-end" />
      {/* A stub for one week, or one that spans two, ending on the through date. */}
      <div className="grid grid-cols-2 gap-2">
        {([1, 2] as const).map(w => (
          <button key={w} type="button" onClick={() => spanWeeks(w)} data-testid={`stub-span-${w}`}
            className="pixel-button pick-off py-1.5 text-[11px] font-bold text-mono">
            {w === 1 ? '1 week' : '2 weeks'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className={LABEL}>Hours</span>
          <Input value={draft.hours} inputMode="decimal" placeholder="40" onChange={e => set({ hours: e.target.value })}
            className="text-mono" data-testid="stub-hours" />
        </label>
        <label className="block space-y-1">
          <span className={LABEL}>Gross</span>
          <Input value={draft.gross} inputMode="decimal" placeholder="2000.00" onChange={e => set({ gross: e.target.value })}
            className="text-mono" data-testid="stub-gross" />
        </label>
      </div>
      {/* When it was paid: a different thing from the days worked. */}
      <label className="block space-y-1">
        <span className={LABEL}>Paid on · optional</span>
        <input type="date" value={draft.paidOn ?? ''} onChange={e => set({ paidOn: e.target.value })} data-testid="stub-paid-on"
          className="w-full border border-[hsl(188_95%_62%/0.5)] bg-background p-2 text-base text-mono text-foreground" />
      </label>
      {/* A bulk total over many weeks: averaged, or counted in no one week. */}
      {multiWeek(draft.start, draft.end) && (
        <label className="flex items-start gap-2.5 text-[12px] text-mono" data-testid="stub-no-weeks-form">
          <input type="checkbox" checked={!!draft.noWeeks} onChange={e => set({ noWeeks: e.target.checked })}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(46_100%_58%)]" />
          <span>
            <span className="block font-bold">Don't average over the weeks</span>
            <span className="block text-[11px] text-muted-foreground">For a bulk total. It counts for the employer and in the totals, not as the same amount every week.</span>
          </span>
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onDone} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold text-mono">Cancel</button>
        <button type="button" onClick={save} data-testid="stub-save" className="pixel-button pick-on flex-1 py-1.5 text-[11px] font-bold text-mono">Save stub</button>
      </div>
    </div>
  );
}
