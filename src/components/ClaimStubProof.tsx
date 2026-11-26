import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Check, ChevronRight, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { claimDay, claimMoney, OPEN_STUB_LIST_EVENT, weekEndingFor, type ClaimLine, type ClaimStub, type ClaimWeek, type StubUse, type WeekEnd } from '@/lib/unemployment';
import { openShiftAndReturn } from '@/lib/returnSpot';
import { cn } from '@/lib/utils';

const LABEL = 'neon-label text-[hsl(188_95%_72%)]';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** The claim weeks a stub's pay period touches, oldest first: the ones it could be put in. */
function weeksTouched(stub: ClaimStub, weekEnd: WeekEnd, claimWeeks: ClaimWeek[]): string[] {
  const out = new Set<string>();
  for (let d = stub.start; d <= stub.end && out.size < 60; d = iso(addDays(parseISO(d), 1))) out.add(weekEndingFor(d, weekEnd));
  const inClaim = new Set(claimWeeks.map(w => w.weekEnding));
  return [...out].filter(w => inClaim.has(w)).sort();
}

/**
 * The proof behind a week's line on the claim: each pay stub in it, what it
 * says, how much of it is in this week and why, and the calendar's shifts it
 * covers. A stub whose pay period crosses claim weeks can be put whole in the
 * week it was worked; it can be found in the stub list, or taken off.
 */
export default function ClaimStubProof({ open, onClose, week, line, uses, claimWeeks, weekEnd }: {
  open: boolean;
  onClose: () => void;
  week: ClaimWeek | null;
  line: ClaimLine | null;
  uses: StubUse[];
  claimWeeks: ClaimWeek[];
  weekEnd: WeekEnd;
}) {
  const { prefs, setClaimStubs } = useUserPrefs();
  const navigate = useNavigate();
  const parts = line?.stubs ?? [];

  const putIn = (stub: ClaimStub, weekEnding: string | null) => {
    const before = prefs.claimStubs;
    setClaimStubs(before.map(s => (s.id === stub.id ? (weekEnding ? { ...s, week: weekEnding } : (({ week: _, ...rest }) => rest)(s)) : s)));
    // Closed, so the weeks behind it show where it went.
    onClose();
    toast.success(weekEnding ? `${stub.employer}: all in the week ending ${claimDay(weekEnding, false)}` : `${stub.employer}: placed by its days`,
      { action: { label: 'Undo', onClick: () => setClaimStubs(before) } });
  };
  const remove = (stub: ClaimStub) => {
    const before = prefs.claimStubs;
    setClaimStubs(before.filter(s => s.id !== stub.id));
    onClose();
    toast(`Removed the ${stub.employer} stub`, { action: { label: 'Undo', onClick: () => setClaimStubs(before) } });
  };
  const showInList = (stub: ClaimStub) => {
    onClose();
    // The list may be folded: open it first, so the row is there to show.
    window.dispatchEvent(new Event(OPEN_STUB_LIST_EVENT));
    // After the dialog has gone: the stub's row in the list, flashed.
    setTimeout(() => {
      const row = document.getElementById(`claim-stub-${stub.id}`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row?.classList.add('bg-[hsl(46_100%_58%/0.15)]');
      setTimeout(() => row?.classList.remove('bg-[hsl(46_100%_58%/0.15)]'), 1600);
    }, 250);
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto" data-testid="stub-proof">
        <DialogHeader>
          <DialogTitle className="text-left text-mono">{parts.length === 1 ? 'The pay stub behind this' : 'The pay stubs behind this'}</DialogTitle>
          <DialogDescription className="text-left text-[12px] text-mono">
            {line?.employer}{week ? `, week ending ${claimDay(week.weekEnding, false)}` : ''}: {line ? `${line.hours} h · ${claimMoney(line.gross)}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {parts.map(part => {
            const stub = prefs.claimStubs.find(s => s.id === part.id);
            if (!stub) return <p key={part.id} className="text-[12px] text-mono text-muted-foreground">That stub has been removed.</p>;
            const use = uses.find(u => u.stub.id === stub.id);
            const total = differenceInCalendarDays(parseISO(stub.end), parseISO(stub.start)) + 1;
            const touched = weeksTouched(stub, weekEnd, claimWeeks);
            const daysHere = week ? Math.max(0, differenceInCalendarDays(parseISO(stub.end < week.end ? stub.end : week.end), parseISO(stub.start > week.start ? stub.start : week.start)) + 1) : 0;
            const why = use?.placedBy === 'weeks'
              ? 'Its own weekly breakdown puts this here.'
              : use?.placedBy === 'days'
                ? 'The days it lists hours for put this here.'
                : part.role === 'pays'
              ? `Believed: its pay counts in place of the calendar's estimate, placed by its shifts on the calendar${use?.check?.hours && use.check.hours >= 1 ? `, and the ${use.check.hours} h not on the calendar over its pay period` : ''}.`
              : part.role === 'says'
                ? "Shown only: the calendar's estimate for these shifts is what's counted."
                : stub.week
                  ? 'You put all of it in this week.'
                  : total <= 7
                    ? `All of it: ${daysHere} of its ${total} days fall in this week, the most of any week.`
                    : `${daysHere} of its ${total} days fall in this week, so that share of it.`;
            return (
              <section key={part.id} className="space-y-2 border border-[hsl(46_100%_58%/0.5)] p-2.5" data-testid="stub-proof-item">
                <div className="flex items-baseline justify-between gap-2 text-[13px] text-mono">
                  <span className="min-w-0 truncate font-bold">{stub.employer}</span>
                  <span className="neon-title shrink-0 font-bold">{claimMoney(stub.gross)}</span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-mono">
                  <dt className={LABEL}>Worked</dt><dd className="text-right">{claimDay(stub.start, false)} to {claimDay(stub.end, false)}</dd>
                  {stub.paidOn ? <><dt className={LABEL}>Paid on</dt><dd className="text-right">{claimDay(stub.paidOn, false)}</dd></> : null}
                  {stub.weeks?.length ? <><dt className={LABEL}>Its weeks</dt><dd className="text-right">{stub.weeks.map(w => `${claimDay(w.end, false).replace(/, \d{4}$/, '')}: ${w.hours ? `${w.hours} h ` : ''}${w.gross ? claimMoney(w.gross) : ''}`).join(' · ')}</dd></> : null}
                  <dt className={LABEL}>Hours</dt><dd className="text-right">{stub.hours || 'not on it'}</dd>
                  {stub.rate ? <><dt className={LABEL}>Rate</dt><dd className="text-right">${stub.rate}/h</dd></> : null}
                  <dt className={LABEL}>In this week</dt><dd className="text-right font-bold text-[hsl(46_100%_58%)]">{part.hours ? `${part.hours} h · ` : ''}{claimMoney(part.gross)}</dd>
                </dl>
                <p className="text-[11px] text-mono text-muted-foreground" data-testid="stub-proof-why">{why}</p>

                {/* The calendar's shifts it covers, each to open. */}
                {use?.covered && use.covered.length > 0 && (
                  <ul className="divide-y divide-[hsl(188_95%_62%/0.15)] text-[12px] text-mono">
                    {use.covered.map(c => (
                      <li key={c.jobId} className="flex items-baseline justify-between gap-2 py-1">
                        <button type="button" onClick={() => { onClose(); openShiftAndReturn(navigate, c.jobId, { path: '/benefits/unemployment' }); }} className="flex min-w-0 items-center gap-0.5 text-left text-[hsl(188_90%_70%)]">
                          <span className="truncate">{claimDay(c.date)} · {c.hours} h</span><ChevronRight size={13} className="shrink-0" aria-hidden />
                        </button>
                        <span className="shrink-0 text-muted-foreground">est. {claimMoney(c.estimate)} · stub {claimMoney(c.share)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* A pay period across claim weeks: put it whole in the week it was worked. */}
                {part.role === 'counted' && touched.length > 1 && (
                  <div className="space-y-1">
                    <p className={LABEL}>Count it in</p>
                    <div className="flex flex-wrap gap-1.5">
                      {touched.map(w => {
                        // The week it's in now: the one you chose, or for a week's stub the one with most of its days.
                        const on = stub.week ? weekEndingFor(stub.week, weekEnd) === w : total <= 7 && week?.weekEnding === w;
                        return (
                          <button key={w} type="button" onClick={() => putIn(stub, w)} aria-pressed={on} data-testid="stub-proof-week"
                            className={cn('pixel-button px-2 py-1 text-[11px] font-bold text-mono', on ? 'pick-on' : 'pick-off')}>
                            {on && <Check size={12} className="mr-1 inline" aria-hidden />}Week ending {format(parseISO(w), 'MMM d')}
                          </button>
                        );
                      })}
                      {stub.week && (
                        <button type="button" onClick={() => putIn(stub, null)} className="pixel-button pick-off px-2 py-1 text-[11px] font-bold text-mono">
                          {total <= 7 ? 'The week with most of its days' : 'Split by its days'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button type="button" onClick={() => showInList(stub)} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold text-mono">
                    Show in pay stubs
                  </button>
                  <button type="button" onClick={() => remove(stub)} aria-label={`Remove the ${stub.employer} stub`} data-testid="stub-proof-remove"
                    className="pixel-button pick-off flex items-center justify-center gap-1 px-3 py-1.5 text-[11px] font-bold text-mono text-dot-late">
                    <Trash2 size={12} aria-hidden /> Remove
                  </button>
                </div>
              </section>
            );
          })}
          <p className="text-[10px] text-mono text-muted-foreground">
            The claim keeps what was read off the stub (shown here), not the photo itself.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
