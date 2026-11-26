import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ExternalLink, MapPin, Plus, Presentation, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import {
  CONFERENCE_COLOUR, DEFAULT_REMIND_WEEKS, REMIND_WEEK_CHOICES, conferenceAlerts, howFar, monthName, nextShow,
  safeLink, spanText, startOf, usualMonthOf, whenText, withDates, type Conference, type ConferenceDates,
} from '@/lib/conferences';
import { localToday } from '@/lib/today';
import { cn } from '@/lib/utils';

interface Draft {
  name: string;
  where: string;
  /** The next dates, as they're typed. */
  start: string;
  end: string;
  /** Every other year's dates on file. */
  otherDates: ConferenceDates[];
  /** '' is "from its dates". */
  usualMonth: string;
  remindWeeks: string;
  link: string;
  notes: string;
}

const label = 'text-[10px] text-mono uppercase tracking-wider text-muted-foreground';
const gold = (alpha = 1) => (alpha === 1 ? `hsl(${CONFERENCE_COLOUR})` : `hsl(${CONFERENCE_COLOUR} / ${alpha})`);
// Drawn by the app, not the browser: Safari's own select is white, with the theme's light text on it.
const selectClass = 'h-10 w-full appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-sm text-foreground [color-scheme:dark]';
const SelectArrow = () => <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />;

function draftFor(c: Conference | undefined, today: string): Draft {
  if (!c) return { name: '', where: '', start: '', end: '', otherDates: [], usualMonth: '', remindWeeks: '', link: '', notes: '' };
  const next = nextShow(c, today);
  const editing = next?.kind === 'dated' ? next : undefined;
  return {
    name: c.name,
    where: c.where ?? '',
    start: editing?.start ?? '',
    end: editing?.end ?? '',
    otherDates: c.dates.filter(d => d.start !== editing?.start),
    usualMonth: c.usualMonth ? String(c.usualMonth) : '',
    remindWeeks: c.remindWeeks ? String(c.remindWeeks) : '',
    link: c.link ?? '',
    notes: c.notes ?? '',
  };
}

/**
 * Conferences to look out for: a running list of the shows that come round
 * every year, soonest first. Each year's dates go in once they're out; until
 * then the month it's usually in stands in. Opened from the calendar, from a
 * conference day, or from Preamp straight onto the one it's about.
 */
export default function ConferenceList({ open, onOpenChange, editId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open straight onto this one; 'new' to add one. */
  editId?: string | null;
}) {
  const { prefs, setConferences } = useUserPrefs();
  const conferences = prefs.conferences;
  const today = localToday();
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editId === 'new') setEditing({ draft: draftFor(undefined, today) });
    else if (editId) {
      const c = conferences.find(x => x.id === editId);
      setEditing(c ? { id: c.id, draft: draftFor(c, today) } : null);
    } else setEditing(null);
    // Only on opening: later edits to the list mustn't throw away a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editId]);

  const alerts = useMemo(() => new Map(conferenceAlerts(conferences, today).map(a => [a.conference.id, a])), [conferences, today]);
  const sorted = useMemo(() => conferences
    .map(c => ({ c, next: nextShow(c, today) }))
    .sort((a, b) => (a.next ? startOf(a.next) : '9').localeCompare(b.next ? startOf(b.next) : '9') || a.c.name.localeCompare(b.c.name)),
  [conferences, today]);

  const set = (patch: Partial<Draft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...patch } });

  // Back to the list, or closed when it was opened onto this one.
  const leaveEditor = () => (editId ? onOpenChange(false) : setEditing(null));

  const save = () => {
    if (!editing) return;
    const d = editing.draft;
    const name = d.name.trim();
    if (!name) { toast.error('Give it a name.'); return; }
    if (d.end && !d.start) { toast.error('Put in the first day too.'); return; }
    if (d.start && d.end && d.end < d.start) { toast.error('The last day is before the first.'); return; }
    const before = conferences.find(c => c.id === editing.id);
    let next: Conference = {
      id: before?.id ?? crypto.randomUUID(),
      name,
      where: d.where.trim() || undefined,
      usualMonth: d.usualMonth ? Number(d.usualMonth) : undefined,
      remindWeeks: d.remindWeeks ? Number(d.remindWeeks) : undefined,
      link: d.link.trim() || undefined,
      notes: d.notes.trim() || undefined,
      dates: [...d.otherDates].sort((a, b) => a.start.localeCompare(b.start)),
      createdAt: before?.createdAt ?? new Date().toISOString(),
    };
    if (d.start) next = withDates(next, { start: d.start, end: d.end || d.start });
    setConferences(before ? conferences.map(c => (c.id === before.id ? next : c)) : [...conferences, next]);
    toast.success(before ? `Saved ${name}` : `Watching for ${name}`);
    leaveEditor();
  };

  const remove = () => {
    const c = conferences.find(x => x.id === editing?.id);
    if (!c) return;
    const before = conferences;
    setConferences(conferences.filter(x => x.id !== c.id));
    toast(`Removed ${c.name}`, { action: { label: 'Undo', onClick: () => setConferences(before) } });
    leaveEditor();
  };

  const draft = editing?.draft;
  const editingConf = editing?.id ? conferences.find(c => c.id === editing.id) : undefined;
  const derivedMonth = editingConf && !editingConf.usualMonth ? usualMonthOf({ ...editingConf, usualMonth: undefined }) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-lg" data-testid="conference-list">
        {!editing || !draft ? (
          <>
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2">
                <Presentation size={16} style={{ color: gold() }} aria-hidden /> Conferences
              </DialogTitle>
              <DialogDescription>
                Shows that come round every year. Put in each year's dates when they're out. Until then the month it's usually in stands in, and Preamp reminds you to look the dates up.
              </DialogDescription>
            </DialogHeader>
            <button type="button" onClick={() => setEditing({ draft: draftFor(undefined, today) })} data-testid="conference-add"
              className="w-full flex items-center justify-center gap-1.5 rounded-md border py-2 text-xs font-semibold transition-colors"
              style={{ color: gold(), borderColor: gold(0.5), backgroundColor: gold(0.1) }}>
              <Plus size={13} /> Watch a conference
            </button>
            {sorted.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">None yet. Add the ones you work every year.</p>
            ) : (
              <ul className="space-y-2" data-testid="conference-rows">
                {sorted.map(({ c }) => {
                  const alert = alerts.get(c.id);
                  const link = safeLink(c.link);
                  return (
                    <li key={c.id} className="flex items-stretch rounded-md border" style={{ borderColor: gold(0.4), backgroundColor: gold(0.06) }}>
                      <button type="button" onClick={() => setEditing({ id: c.id, draft: draftFor(c, today) })}
                        className="min-w-0 flex-1 px-3 py-2.5 text-left space-y-1 hover:opacity-90 active:opacity-80">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="truncate uppercase tracking-wide">{c.name}</span>
                          {alert && (
                            <span className={cn('shrink-0 border px-1 text-[9px] font-bold uppercase text-mono',
                              alert.kind === 'dates' ? 'border-warning/60 text-warning' : 'border-current')}
                              style={alert.kind === 'soon' ? { color: `hsl(${CONFERENCE_COLOUR})` } : undefined}>
                              {alert.kind === 'dates' ? 'look up dates' : howFar(alert.days)}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-mono">
                          {c.where && <span className="text-muted-foreground"><MapPin size={10} className="mr-0.5 inline" aria-hidden />{c.where} · </span>}
                          <span style={{ color: gold() }}>{whenText(c, today)}</span>
                        </p>
                      </button>
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${c.name}'s site`}
                          className="flex w-11 shrink-0 items-center justify-center border-l text-muted-foreground hover:text-foreground" style={{ borderColor: gold(0.25) }}>
                          <ExternalLink size={15} />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            <DialogHeader className="text-left">
              <DialogTitle>{editing.id ? draft.name || 'Conference' : 'Watch a conference'}</DialogTitle>
              <DialogDescription>Dates change year to year: put in the next ones when they're announced. Past years stay on file.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3" data-testid="conference-editor">
              <label className="block space-y-1">
                <span className={label}>Name</span>
                <Input value={draft.name} placeholder="Dreamforce" onChange={e => set({ name: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className={label}>Where</span>
                <Input value={draft.where} placeholder="Moscone Center" onChange={e => set({ where: e.target.value })} />
              </label>
              <div className="space-y-1">
                <span className={label}>Next dates</span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">First day</span>
                    <Input type="date" value={draft.start} aria-label="First day" data-testid="conference-start"
                      onChange={e => set({ start: e.target.value, end: draft.end && draft.end >= e.target.value ? draft.end : e.target.value })} />
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">Last day</span>
                    <Input type="date" value={draft.end} min={draft.start || undefined} aria-label="Last day" data-testid="conference-end"
                      onChange={e => set({ end: e.target.value })} />
                  </label>
                </div>
                {!draft.start && <p className="text-[11px] text-muted-foreground">Not out yet? Leave these empty: the usual month stands in.</p>}
              </div>
              {draft.otherDates.length > 0 && (
                <div className="space-y-1">
                  <span className={label}>Dates on file</span>
                  <ul className="space-y-1">
                    {[...draft.otherDates].reverse().map(d => (
                      <li key={d.start} className="flex items-center justify-between gap-2 border border-border/60 px-2 py-1 text-xs text-mono">
                        <span>{spanText(d, true)}</span>
                        <button type="button" aria-label={`Remove ${spanText(d, true)}`} className="p-1 text-muted-foreground hover:text-destructive"
                          onClick={() => set({ otherDates: draft.otherDates.filter(x => x.start !== d.start) })}>
                          <X size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className={label}>Usually in</span>
                  <span className="relative block">
                    <select value={draft.usualMonth} onChange={e => set({ usualMonth: e.target.value })} className={selectClass} aria-label="Usually in">
                      <option value="">{derivedMonth ? `${monthName(derivedMonth)} (its dates)` : 'From its dates'}</option>
                      {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1)}</option>)}
                    </select>
                    <SelectArrow />
                  </span>
                </label>
                <label className="block space-y-1">
                  <span className={label}>Heads-up</span>
                  <span className="relative block">
                    <select value={draft.remindWeeks || String(DEFAULT_REMIND_WEEKS)} onChange={e => set({ remindWeeks: e.target.value })} className={selectClass} aria-label="Heads-up, weeks before">
                      {REMIND_WEEK_CHOICES.map(w => <option key={w} value={w}>{w} weeks</option>)}
                    </select>
                    <SelectArrow />
                  </span>
                </label>
              </div>
              <label className="block space-y-1">
                <span className={label}>Where the dates get posted</span>
                <Input type="url" inputMode="url" value={draft.link} placeholder="dreamforce.com" onChange={e => set({ link: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className={label}>Notes</span>
                <Textarea value={draft.notes} rows={2} placeholder="Who calls it, which halls, load-in days" onChange={e => set({ notes: e.target.value })} />
              </label>
              <div className="flex gap-2">
                {editing.id && (
                  <Button variant="outline" size="icon" className="shrink-0 text-destructive" aria-label={`Remove ${draft.name}`} onClick={remove}>
                    <Trash2 size={14} />
                  </Button>
                )}
                <Button variant="outline" className="flex-1" onClick={leaveEditor}>Cancel</Button>
                <Button className="flex-1" onClick={save} data-testid="conference-save">Save</Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
