import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Copy, Link2, Pencil, Unlink } from 'lucide-react';
import { nameSimilarity } from '@/lib/employerMatch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import DateWheels from '@/components/DateWheels';
import type { Job } from '@/lib/store';
import { useData } from '@/lib/DataContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { localToday } from '@/lib/today';
import { roundHours } from '@/lib/hoursFormat';
import { netHoursWorked } from '@/lib/payCalc';
import {
  claimDay, claimEmployerKey, claimMoney, claimNameOf, howLongText, isUnclearEmployer, suggestEmployer,
  type ClaimEmployer, type ClaimEmployerInfo,
} from '@/lib/unemployment';
import { cn } from '@/lib/utils';

const LABEL = 'font-8bit text-[7px] uppercase leading-relaxed text-[hsl(188_95%_72%)]';
const TAG = 'font-8bit shrink-0 border px-1.5 py-0.5 text-[7px] uppercase';

/** One week of work for one employer: its hours and gross, and whether a pay stub gave them. */
export interface EmployerWeek {
  weekEnding: string;
  hours: number;
  gross: number;
  fromStub: boolean;
  /** A pay stub covering its shifts says this, not counted (see ClaimLine.stubSays). */
  stubSays?: number;
}

/**
 * One employer on the claim. Its pencil opens what the claim form needs
 * that the shifts don't say, right on the box: the name the state knows it
 * by, address, phone, a note, and the first and last day you worked for them
 * when that's outside the dates picked. An employer the app couldn't name
 * ("Unknown") shows its shifts as they were saved, with a guess from what's
 * written on them, and a box to say who it was for: that puts the shifts
 * themselves right.
 *
 * Tap the box (its name or its figures) to see its weeks: each week you
 * worked for them, with the hours and gross, ready to copy.
 */
export default function ClaimEmployerCard({ employer: e, colour, longest, shifts, weeks, knownEmployers, onCopy, unsplit = 0, linkChoices = [] }: {
  employer: ClaimEmployer;
  colour: string;
  /** Its badge, when it's the one worked for longest. */
  longest?: 'stretch' | 'days';
  /** Its shifts in the dates picked, to show when the app couldn't name it. */
  shifts: Job[];
  knownEmployers: string[];
  onCopy: (amount: number) => void;
  /** Its weeks with work, most recent first. */
  weeks: EmployerWeek[];
  /** Its gross from bulk stubs not averaged over weeks: in no week. */
  unsplit?: number;
  /** The employers it can be linked to: the same one under another name. */
  linkChoices?: string[];
}) {
  const [open, setOpen] = useState(false);
  const { updateJob } = useData();
  const { prefs, setClaimEmployers } = useUserPrefs();
  const key = claimEmployerKey(e.name);
  const [draft, setDraft] = useState<ClaimEmployerInfo | null>(null);
  const [who, setWho] = useState('');
  /** Picking the employer this one is the same as. */
  const [linking, setLinking] = useState(false);
  const [linkTarget, setLinkTarget] = useState('');
  // The likeliest first: the names most like this one.
  const choices = [...linkChoices].sort((a, b) => nameSimilarity(e.name, b) - nameSimilarity(e.name, a) || a.localeCompare(b));
  const unclear = isUnclearEmployer(e.name);
  const guess = unclear ? shifts.map(j => suggestEmployer(j, knownEmployers)).find(Boolean) : undefined;
  const thisYear = Number(localToday().slice(0, 4));

  const save = () => {
    if (!draft) return;
    const clean = Object.fromEntries(Object.entries(draft).filter(([, v]) => typeof v === 'string' && v.trim())) as ClaimEmployerInfo;
    const next = { ...prefs.claimEmployers };
    if (Object.keys(clean).length) next[key] = clean; else delete next[key];
    setClaimEmployers(next);
    setDraft(null);
    toast.success(`Saved ${clean.claimName || e.name}`);
  };

  // The same employer under another name: everything under this one counts
  // there on the claim. The shifts and stubs themselves aren't changed.
  const link = () => {
    const to = linkTarget.trim();
    if (!to) return;
    const before = prefs.claimEmployers;
    setClaimEmployers({ ...before, [key]: { ...(before[key] ?? {}), linkTo: to } });
    setLinking(false);
    setLinkTarget('');
    toast.success(`${e.name} now counts under ${to}`, { action: { label: 'Undo', onClick: () => setClaimEmployers(before) } });
  };
  const unlink = (name: string) => {
    const before = prefs.claimEmployers;
    const k = claimEmployerKey(name);
    const { linkTo: _, ...rest } = before[k] ?? {};
    const next = { ...before };
    if (Object.keys(rest).length) next[k] = rest; else delete next[k];
    setClaimEmployers(next);
    toast.success(`${name} is its own employer again`, { action: { label: 'Undo', onClick: () => setClaimEmployers(before) } });
  };

  // Who an unnamed employer's shifts were for: set on the shifts themselves.
  const assign = async (name: string) => {
    const to = name.trim();
    if (!to) { toast.error('Put in who it was for.'); return; }
    for (const j of shifts) await updateJob(j.id, { client: to });
    toast.success(`${shifts.length} shift${shifts.length === 1 ? '' : 's'} now for ${to}`);
    setWho('');
  };

  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied'); } catch { toast.error("Couldn't copy here."); }
  };

  return (
    <li className={cn('neon-well p-3', unclear && 'shadow-[inset_0_0_0_1px_hsl(var(--dot-overdue))]')} data-testid="claim-employer">
      <div className="flex items-baseline justify-between gap-2">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="employer-toggle"
          aria-label={`${claimNameOf(e)}: ${open ? 'hide' : 'show'} week by week`}
          className="flex min-w-0 items-center gap-1.5 text-left">
          <span className="neon-soft truncate text-base font-bold text-mono" style={{ color: colour }}>{claimNameOf(e)}</span>
          <ChevronDown size={15} className={cn('shrink-0 text-[hsl(188_90%_70%)] transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
        <button type="button" onClick={() => onCopy(e.gross)} aria-label={`Copy ${claimMoney(e.gross)}`} data-testid="copy-amount"
          className="neon-title flex shrink-0 items-center gap-1 text-base font-bold text-mono active:opacity-70">
          {claimMoney(e.gross)} <Copy size={11} className="text-[hsl(188_90%_70%)]" aria-hidden />
        </button>
      </div>
      {e.info?.claimName && <p className="text-[11px] text-mono text-muted-foreground">On the calendar as {e.name}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-1.5">
        {longest === 'stretch' && <span className={cn(TAG, 'border-[hsl(46_100%_58%)] text-[hsl(46_100%_58%)]')}>Longest</span>}
        {longest === 'days' && <span className={cn(TAG, 'border-[hsl(46_100%_58%)] text-[hsl(46_100%_58%)]')}>Most days</span>}
        {unclear && <span className={cn(TAG, 'border-dot-overdue text-dot-overdue')} data-testid="unclear-tag">Not sure who this is</span>}
        {e.datesSet && <span className={cn(TAG, 'border-border text-muted-foreground')}>Days set by you</span>}
      </p>
      {e.paidBy && <p className="text-[11px] text-mono text-muted-foreground">Paid by {e.paidBy}</p>}
      {/* Other names counted here: each can be unlinked. */}
      {e.linked && e.linked.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-mono text-muted-foreground" data-testid="employer-linked">
          <span>Also counts:</span>
          {e.linked.map(n => (
            <button key={n} type="button" onClick={() => unlink(n)} aria-label={`Unlink ${n}`}
              className="inline-flex items-center gap-1 border border-[hsl(188_95%_62%/0.5)] px-1.5 py-0.5 text-[hsl(188_90%_70%)]">
              {n} <Unlink size={11} aria-hidden />
            </button>
          ))}
        </div>
      )}
      {(e.info?.address || e.info?.phone) && (
        <p className="mt-1 text-[11px] text-mono">{[e.info.address, e.info.phone].filter(Boolean).join(' · ')}</p>
      )}
      {e.info?.note && <p className="text-[11px] text-mono text-muted-foreground">{e.info.note}</p>}

      {/* An employer the app couldn't name: what it was going on, and the fix. */}
      {unclear && shifts.length > 0 && (
        <div className="mt-2 space-y-2 border-t border-[hsl(312_95%_68%/0.3)] pt-2" data-testid="unclear-detail">
          <p className="text-[11px] text-mono text-muted-foreground">The shift{shifts.length === 1 ? '' : 's'} didn't say who paid. What was saved:</p>
          <ul className="space-y-1.5 text-[11px] text-mono">
            {shifts.map(j => (
              <li key={j.id} className="border-l-2 border-dot-overdue/60 pl-2">
                <span className="font-bold">{claimDay(j.date)}</span>
                {j.name && <> · {j.name}</>}{j.venue && j.venue !== j.name && <> · {j.venue}</>}
                {' · '}{roundHours(netHoursWorked(j))} h{j.startTime ? ` · ${j.startTime}${j.endTime ? `–${j.endTime}` : ''}` : ''}
                {j.notes && <span className="block text-muted-foreground">“{j.notes}”</span>}
              </li>
            ))}
          </ul>
          {guess && (
            <button type="button" onClick={() => void assign(guess)} data-testid="unclear-guess"
              className="pixel-button pick-on w-full px-2 py-1.5 text-left text-[11px] font-bold text-mono">
              It says it was {guess}: set that
            </button>
          )}
          <div className="flex gap-2">
            <Input value={who} onChange={ev => setWho(ev.target.value)} list="claim-known-employers" placeholder="Who was it for?"
              className="h-9 text-mono text-[13px]" data-testid="unclear-who" />
            <button type="button" onClick={() => void assign(who)} className="pixel-button pick-off shrink-0 px-2.5 text-[11px] font-bold text-mono">Set</button>
          </div>
          <datalist id="claim-known-employers">{knownEmployers.filter(n => !isUnclearEmployer(n)).map(n => <option key={n} value={n} />)}</datalist>
        </div>
      )}

      {!draft ? (
        <>
          <dl onClick={() => setOpen(o => !o)} className="mt-2 grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-[12px] text-mono">
            <dt className={LABEL}>First day</dt><dd className="text-right">{claimDay(e.firstDay, false)}</dd>
            <dt className={LABEL}>Last day</dt><dd className="text-right">{claimDay(e.lastDay, false)}</dd>
            <dt className={LABEL}>How long</dt><dd className="text-right" data-testid="how-long">{howLongText(e.firstDay, e.lastDay)}</dd>
            <dt className={LABEL}>Days worked</dt><dd className="text-right">{e.days}{e.fromStub ? ' + pay stubs' : ''}</dd>
            <dt className={LABEL}>Hours</dt><dd className="text-right">{e.hours}</dd>
            {/* Pay stubs for shifts on the calendar: what they say, beside the estimate that's counted. */}
            {e.stubSays && (
              <>
                <dt className={LABEL}>{e.stubSays.stubs === 1 ? 'Pay stub says' : 'Pay stubs say'}</dt>
                <dd className="text-right text-[hsl(46_100%_58%)]" data-testid="employer-stub-says">
                  {claimMoney(e.stubSays.gross)}{e.stubSays.hours > 0 ? ` · ${e.stubSays.hours} h` : ''}
                  <span className="block text-[11px] text-muted-foreground">calendar estimate {claimMoney(e.stubSays.estimate)} is counted</span>
                </dd>
              </>
            )}
          </dl>

          {/* Its weeks, opened by a tap on the box. */}
          {open && (
            <div className="mt-2 border-t border-[hsl(312_95%_68%/0.3)] pt-2" data-testid="employer-weeks">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className={LABEL}>Week by week · {weeks.length}</p>
                {weeks.length > 0 && (
                  <button type="button" data-testid="employer-weeks-copy"
                    onClick={() => void copyText(weeks.map(w => `Week ending ${claimDay(w.weekEnding, false)}: ${claimMoney(w.gross)}`).join('\n'))}
                    className="flex items-center gap-1 text-[11px] text-mono text-[hsl(188_90%_70%)]">
                    <Copy size={11} aria-hidden /> Week + gross
                  </button>
                )}
              </div>
              {weeks.length === 0 ? (
                <p className="text-[11px] text-mono text-muted-foreground">No weeks with work in your dates.</p>
              ) : (
                <ul className="divide-y divide-[hsl(312_95%_68%/0.15)]">
                  {weeks.map(w => (
                    <li key={w.weekEnding} className="flex flex-wrap items-baseline justify-between gap-x-2 py-1 text-[12px] text-mono">
                      <span className="min-w-0 truncate">Week ending {claimDay(w.weekEnding, false)}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {w.fromStub && <span className="font-8bit border border-[hsl(46_100%_58%)] px-1 text-[6px] uppercase leading-relaxed text-[hsl(46_100%_58%)]">Stub</span>}
                        <span className="text-muted-foreground">{w.hours} h ·</span>
                        <span className="neon-title font-bold">{claimMoney(w.gross)}</span>
                      </span>
                      {w.stubSays != null && (
                        <span className="basis-full text-right text-[11px] text-[hsl(46_100%_58%)]">pay stub says {claimMoney(w.stubSays)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {unsplit > 0 && (
                <p className="mt-1 flex justify-between gap-2 border-t border-[hsl(312_95%_68%/0.15)] pt-1 text-[12px] text-mono" data-testid="employer-unsplit">
                  <span className="text-muted-foreground">Not split by week (pay stub)</span>
                  <span className="neon-title font-bold">{claimMoney(unsplit)}</span>
                </p>
              )}
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setDraft({ ...(e.info ?? {}) })} data-testid="employer-edit"
              className="pixel-button pick-off flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono">
              <Pencil size={12} aria-hidden /> Edit
            </button>
            {linkChoices.length > 0 && (
              <button type="button" onClick={() => setLinking(l => !l)} aria-expanded={linking} data-testid="employer-link"
                className={cn('pixel-button flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono', linking ? 'pick-on' : 'pick-off')}>
                <Link2 size={12} aria-hidden /> Link to…
              </button>
            )}
            {(e.info?.address || e.info?.phone) && (
              <button type="button" onClick={() => void copyText([claimNameOf(e), e.info?.address, e.info?.phone].filter(Boolean).join('\n'))}
                className="pixel-button pick-off flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono">
                <Copy size={12} aria-hidden /> Copy details
              </button>
            )}
          </div>
          {/* The same employer under another name: picked, and this one counts there. */}
          {linking && (
            <div className="mt-2 space-y-2 border-t border-[hsl(312_95%_68%/0.3)] pt-2.5" data-testid="employer-link-form">
              <p className="text-[11px] text-mono text-muted-foreground">
                The same employer under another name (renamed, or typed another way)? Pick it, and {e.name} counts under it. Its shifts and stubs aren't changed.
              </p>
              <select value={linkTarget} onChange={ev => setLinkTarget(ev.target.value)} data-testid="employer-link-choice" aria-label={`Link ${e.name} to`}
                className="w-full border border-[hsl(188_95%_62%/0.5)] bg-background p-2 text-base text-mono text-foreground">
                <option value="">Pick the employer…</option>
                {choices.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setLinking(false); setLinkTarget(''); }} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold text-mono">Cancel</button>
                <button type="button" onClick={link} disabled={!linkTarget} data-testid="employer-link-save"
                  className="pixel-button pick-on flex-1 py-1.5 text-[11px] font-bold text-mono disabled:opacity-40">Link</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="mt-2 space-y-2.5 border-t border-[hsl(312_95%_68%/0.3)] pt-2.5" data-testid="employer-form">
          {([
            ['claimName', 'Name on the claim', e.name],
            ['address', 'Address', '123 Main St, San Francisco, CA'],
            ['phone', 'Phone', '(415) 555-0100'],
          ] as const).map(([field, label, placeholder]) => (
            <label key={field} className="block space-y-1">
              <span className={LABEL}>{label}</span>
              <Input value={draft[field] ?? ''} placeholder={placeholder} inputMode={field === 'phone' ? 'tel' : undefined}
                onChange={ev => setDraft({ ...draft, [field]: ev.target.value })} className="text-mono text-[13px]" data-testid={`employer-${field}`} />
            </label>
          ))}
          <label className="block space-y-1">
            <span className={LABEL}>Note</span>
            <Textarea value={draft.note ?? ''} rows={2} placeholder="Reason for leaving, who to ask for"
              onChange={ev => setDraft({ ...draft, note: ev.target.value })} className="text-mono text-[13px]" />
          </label>
          <div className="space-y-2">
            <p className="text-[11px] text-mono text-muted-foreground">Started or finished outside your dates? Set the real days.</p>
            <DateWheels label="First day" value={draft.firstDay ?? e.firstDay} firstYear={thisYear - 20} lastYear={thisYear}
              onChange={firstDay => setDraft({ ...draft, firstDay })} testId="employer-first" />
            <DateWheels label="Last day" value={draft.lastDay ?? e.lastDay} firstYear={thisYear - 20} lastYear={thisYear}
              onChange={lastDay => setDraft({ ...draft, lastDay })} testId="employer-last" />
            {(draft.firstDay || draft.lastDay) && (
              <button type="button" onClick={() => setDraft({ ...draft, firstDay: undefined, lastDay: undefined })}
                className="text-[11px] text-mono text-[hsl(188_90%_70%)] underline">Use the days from your shifts</button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDraft(null)} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold text-mono">Cancel</button>
            <button type="button" onClick={save} data-testid="employer-save" className="pixel-button pick-on flex-1 py-1.5 text-[11px] font-bold text-mono">Save</button>
          </div>
        </div>
      )}
    </li>
  );
}
