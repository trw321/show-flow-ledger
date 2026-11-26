import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ClipboardPaste, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { localToday } from '@/lib/today';
import { payListWeeks, readPayList, type PayList } from '@/lib/payList';
import { claimDay, claimMoney, readAmount, sameStub, type WeekEnd } from '@/lib/unemployment';
import { cn } from '@/lib/utils';

const LABEL = 'font-8bit text-[7px] uppercase leading-relaxed text-[hsl(188_95%_72%)]';
const TAG = 'font-8bit shrink-0 border px-1.5 py-0.5 text-[7px] uppercase';
const GOLD = 'border-[hsl(46_100%_58%)] text-[hsl(46_100%_58%)]';

/**
 * A pay list pasted from a payroll site (a date and an amount on each line),
 * read on the phone, shown line by line and week by week to confirm, then
 * kept as one pay stub a week for the employer named.
 */
export default function ClaimPastePay({ weekEnd, employerNames, colourOf, from, through }: {
  weekEnd: WeekEnd;
  employerNames: string[];
  colourOf: (name: string) => string;
  /** The claim's dates, to say when a week falls outside them. */
  from: string;
  through: string;
}) {
  const { prefs, setClaimStubs } = useUserPrefs();
  const [text, setText] = useState('');
  const [read, setRead] = useState<PayList | null>(null);
  /** The lines kept, by their place in the list. */
  const [keep, setKeep] = useState<boolean[]>([]);
  const [employer, setEmployer] = useState('');
  const [rate, setRate] = useState('');
  const [weekBefore, setWeekBefore] = useState(false);

  const readIt = () => {
    const list = readPayList(text, localToday());
    if (list.rows.length === 0) {
      toast.error('No date and amount found on any line. Each line needs both, like "Jun 3, 2026  $595.00".');
      return;
    }
    setRead(list);
    // A line pasted twice is left out until you say otherwise.
    setKeep(list.rows.map(r => !r.repeat));
  };

  const perHour = readAmount(rate);
  // Each kept line with its hours: as written on it, or worked out from the rate.
  const kept = useMemo(() => {
    const byRate = (gross: number) => (perHour > 0 ? Math.round((gross / perHour) * 100) / 100 : 0);
    return read ? read.rows.filter((_, i) => keep[i]).map(r => ({ ...r, hours: r.hours ?? byRate(r.amount) })) : [];
  }, [read, keep, perHour]);
  const weeks = useMemo(() => payListWeeks(kept, weekEnd, weekBefore), [kept, weekEnd, weekBefore]);
  const total = kept.reduce((sum, r) => sum + r.amount, 0);
  /** Some kept line has no hours of its own: the rate is what gives it some. */
  const needsRate = !!read && read.rows.some((r, i) => keep[i] && r.hours === undefined);
  const name = employer.trim();
  const already = (w: { start: string; weekEnding: string }) => (name ? sameStub(prefs.claimStubs, { employer: name, start: w.start, end: w.weekEnding }) : undefined);
  const periodKept = (r: { period?: { start: string; end: string } }) => (name && r.period ? sameStub(prefs.claimStubs, { employer: name, start: r.period.start, end: r.period.end }) : undefined);
  /** Lines without a pay period: the only ones "the week paid / the week before" moves. */
  const undated = kept.filter(r => !r.period).length;
  // What gets kept: a stub for each pay period read off the lines (two
  // payments for one period make one), and a stub a week for the lines
  // without one, as they're counted above.
  const units = useMemo(() => {
    const byPeriod = new Map<string, { start: string; end: string; gross: number; hours: number; paidOn?: string }>();
    for (const r of kept) {
      if (!r.period) continue;
      const k = `${r.period.start}|${r.period.end}`;
      const cur = byPeriod.get(k) ?? { start: r.period.start, end: r.period.end, gross: 0, hours: 0, ...(r.noPayDate ? {} : { paidOn: r.date }) };
      cur.gross = Math.round((cur.gross + r.amount) * 100) / 100;
      cur.hours = Math.round((cur.hours + r.hours) * 100) / 100;
      byPeriod.set(k, cur);
    }
    // A week's stub keeps its pay date when it has one payday.
    const weekly = payListWeeks(kept.filter(r => !r.period), weekEnd, weekBefore)
      .map(w => ({ start: w.start, end: w.weekEnding, gross: w.total, hours: w.hours ?? 0, ...(w.dates.length === 1 ? { paidOn: w.dates[0] } : {}) }));
    return [...byPeriod.values(), ...weekly];
  }, [kept, weekEnd, weekBefore]);
  const adding = units.filter(u => !(name && sameStub(prefs.claimStubs, { employer: name, start: u.start, end: u.end })));

  const cancel = () => { setRead(null); setKeep([]); };

  const confirm = () => {
    if (!name) { toast.error('Who paid it? Add the employer first.'); return; }
    const now = new Date().toISOString();
    const added = adding.map(u => ({
      id: crypto.randomUUID(), employer: name, start: u.start, end: u.end,
      hours: u.hours, gross: u.gross, createdAt: now, ...(perHour > 0 ? { rate: perHour } : {}), ...(u.paidOn ? { paidOn: u.paidOn } : {}),
    }));
    setClaimStubs([...prefs.claimStubs, ...added]);
    toast.success(added.length ? `Added ${added.length} pay stub${added.length === 1 ? '' : 's'} for ${name}, ${claimMoney(added.reduce((s, x) => s + x.gross, 0))}` : 'Those are already on the claim');
    setRead(null);
    setKeep([]);
    setText('');
  };

  return (
    <section className="neon-well space-y-2.5 p-3" data-testid="claim-paste">
      <div>
        <p className={LABEL}>Paste a pay list</p>
        <p className="mt-0.5 text-[11px] text-mono text-muted-foreground">
          From a payroll site (Gusto, ADP…): a date and an amount on each line, and its hours if you add them ("8 hrs"). You see it week by week before anything is added.
        </p>
      </div>

      {!read && (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} data-testid="paste-text"
            placeholder={'Jun 3, 2026    $595.00   8 hrs\nMay 26, 2026   $280.00'}
            className="w-full resize-y border border-[hsl(188_95%_62%/0.5)] bg-background/60 p-2 text-[12px] text-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-[hsl(188_95%_62%)]" />
          <button type="button" onClick={readIt} disabled={!text.trim()} data-testid="paste-read"
            className="pixel-button pick-off flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono disabled:opacity-40">
            <ClipboardPaste size={13} aria-hidden /> Read it
          </button>
        </>
      )}

      {read && (
        <div className="space-y-3 border-t border-[hsl(312_95%_68%/0.3)] pt-2.5" data-testid="paste-found">
          {/* What was read, line by line. */}
          <div className="space-y-1.5">
            <p className={LABEL}>Read · {read.rows.length} payment{read.rows.length === 1 ? '' : 's'} · {claimMoney(read.rows.reduce((s, r) => s + r.amount, 0))}</p>
            <p className="text-[11px] text-mono text-muted-foreground">Check each against the list. Ticked ones count.</p>
            <ul className="space-y-1">
              {read.rows.map((r, i) => (
                <li key={i} data-testid="paste-row"
                  className={cn('flex items-start gap-2.5 border px-2.5 py-1.5 text-[12px] text-mono', keep[i] ? 'border-[hsl(140_100%_52%/0.6)]' : 'border-border/60 opacity-70')}>
                  <button type="button" aria-pressed={keep[i]} aria-label={`${keep[i] ? 'Counting' : 'Not counting'} ${claimDay(r.date, false)}`}
                    onClick={() => setKeep(cur => cur.map((k, j) => (j === i ? !k : k)))}
                    className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border', keep[i]
                      ? 'border-dot-paid bg-dot-paid/20 text-dot-paid' : 'border-[hsl(188_95%_62%/0.6)] text-transparent')}>
                    <Check size={15} strokeWidth={3} aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-bold">{claimDay(r.date)}</span>
                      <span className="neon-title shrink-0 font-bold">{claimMoney(r.amount)}</span>
                    </div>
                    {r.hours !== undefined && (
                      <p className="text-[11px] text-muted-foreground" data-testid="paste-hours">{r.hours} h</p>
                    )}
                    {r.period && (
                      <p className="text-[11px] text-[hsl(188_90%_70%)]" data-testid="paste-period">
                        Worked {claimDay(r.period.start, false).replace(/, \d{4}$/, '')} – {claimDay(r.period.end, false)}
                        {r.noPayDate ? ' · no pay date on the line' : ''}
                        {periodKept(r) ? ' · already on the claim' : ''}
                      </p>
                    )}
                    {(r.yearAssumed || r.offColumn || r.repeat || r.others.length > 0) && (
                      <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                        {r.yearAssumed && <span className={cn(TAG, GOLD)}>Year assumed</span>}
                        {r.offColumn && <span className={cn(TAG, GOLD)}>Other column</span>}
                        {r.repeat && <span className={cn(TAG, GOLD)}>Same as above</span>}
                        {r.others.length > 0 && <span>also on the line: {r.others.map(claimMoney).join(', ')} (not counted)</span>}
                      </div>
                    )}
                    {r.offColumn && <p className="text-[11px] text-muted-foreground">Its amount is in a different column from the rest: check it's the same kind of figure.</p>}
                  </div>
                </li>
              ))}
            </ul>
            {read.skipped.length > 0 && (
              <div className="text-[11px] text-mono text-muted-foreground" data-testid="paste-skipped">
                <p className="font-bold text-foreground/80">Not read ({read.skipped.length}): no date and amount on the line</p>
                <ul className="mt-0.5 space-y-0.5">
                  {read.skipped.slice(0, 6).map((s, i) => <li key={i} className="truncate">· {s}</li>)}
                  {read.skipped.length > 6 && <li>· and {read.skipped.length - 6} more</li>}
                </ul>
              </div>
            )}
          </div>

          {/* Who and how. */}
          <label className="block space-y-1">
            <span className={LABEL}>Employer</span>
            <Input value={employer} list="claim-paste-employers" placeholder="Who you worked for, not the payroll site"
              onChange={e => setEmployer(e.target.value)} className="text-mono" data-testid="paste-employer" />
            <datalist id="claim-paste-employers">{employerNames.map(n => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="block space-y-1">
            <span className={LABEL}>Hourly rate · optional</span>
            <Input value={rate} inputMode="decimal" placeholder={needsRate ? '35.00 (works out hours for lines without them)' : 'Not needed: every line has its hours'} onChange={e => setRate(e.target.value)}
              className="text-mono" data-testid="paste-rate" />
          </label>
          {undated > 0 && (
          <div className="space-y-1">
            <span className={LABEL}>{undated < kept.length ? `Lines without a pay period (${undated}): count each in` : 'Count each in'}</span>
            <div className="grid grid-cols-2 gap-2">
              {([false, true] as const).map(before => (
                <button key={String(before)} type="button" onClick={() => setWeekBefore(before)} aria-pressed={weekBefore === before}
                  data-testid={before ? 'paste-week-before' : 'paste-week-paid'}
                  className={cn('pixel-button py-1.5 text-[11px] font-bold text-mono', weekBefore === before ? 'pick-on' : 'pick-off')}>
                  {before ? 'The week before' : 'The week paid'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-mono text-muted-foreground">
              The claim wants the week you worked. If this payroll pays a week behind, pick the week before.
              {undated < kept.length ? ' Lines with a pay period go in the weeks worked.' : ''}
            </p>
          </div>
          )}
          {undated === 0 && kept.length > 0 && (
            <p className="text-[11px] text-mono text-muted-foreground">Every line has its pay period, so each goes in the weeks worked.</p>
          )}

          {/* Week by week, as it would go on the claim. */}
          <div className="space-y-1.5" data-testid="paste-weeks">
            <p className={LABEL}>Week by week · {weeks.length} week{weeks.length === 1 ? '' : 's'} · {claimMoney(total)}</p>
            <ul className="divide-y divide-[hsl(188_95%_62%/0.2)] border border-[hsl(188_95%_62%/0.4)]">
              {weeks.map(w => {
                // Only a week made of lines without a period is kept as that week's stub.
                const have = !w.byPeriod && already(w);
                const outside = w.weekEnding < from || w.start > through;
                return (
                  <li key={w.weekEnding} className={cn('px-2.5 py-1.5 text-[12px] text-mono', have && 'opacity-60')} data-testid="paste-week">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-bold">Week ending {claimDay(w.weekEnding, false)}</span>
                      <span className="neon-title shrink-0 font-bold">{claimMoney(w.total)}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {w.dates.length} payment{w.dates.length === 1 ? '' : 's'} ({w.dates.map(d => claimDay(d, false).replace(/, \d{4}$/, '')).join(', ')})
                      {!!w.hours && ` · ${w.hours} h`}
                      {w.byPeriod && ' · by pay period'}
                    </p>
                    {(have || outside) && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {have && <span className={cn(TAG, 'border-border text-muted-foreground')}>Already on the claim</span>}
                        {outside && <span className={cn(TAG, GOLD)}>Outside your dates</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {name && <p className="text-[11px] text-mono" style={{ color: colourOf(name) }}>Added as pay stubs from {name}</p>}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={cancel} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold text-mono">Cancel</button>
            <button type="button" onClick={confirm} disabled={adding.length === 0 || !name} data-testid="paste-confirm"
              className="pixel-button pick-on flex-1 py-1.5 text-[11px] font-bold text-mono disabled:opacity-40">
              {name ? `Add ${adding.length} to the claim` : 'Add the employer'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
