import { useMemo, useState } from 'react';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { toast } from 'sonner';
import { Users, Plus, ChevronLeft, ChevronRight, Pencil, Trash2, Phone, Mail, Wallet, Undo2 } from 'lucide-react';
import { useData } from '@/lib/DataContext';
import SpacePageWrapper from '@/components/SpacePageWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { CrewMember, CrewShift } from '@/lib/store';
import { crewShiftHours, crewShiftOwed, crewShiftPay, crewShiftWorked } from '@/lib/crew';
import { localToday } from '@/lib/today';
import { cn } from '@/lib/utils';

/**
 * Boss mode: the people who work for you and when — laid out like Expenses,
 * by person instead of by category, with the week at the top.
 */

const money = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDay = (iso: string) => format(parseISO(iso), 'EEE MMM d');
const FIELD = 'h-9 text-sm';
const LABEL = 'text-[10px] text-mono uppercase tracking-wider text-muted-foreground';

/** A shift's state, in the dot colours: paid, worked and owed, or still ahead. */
function shiftTone(s: CrewShift): string {
  if (s.payoutId) return 'border-dot-paid/50 bg-dot-paid/10 text-dot-paid';
  if (crewShiftWorked(s)) return 'border-dot-pending/50 bg-dot-pending/10 text-dot-pending';
  return 'border-dot-upcoming/50 bg-dot-upcoming/10 text-dot-upcoming';
}

// ── Someone on the crew ────────────────────────────────────────────────────

function PersonForm({ initial, onSave, onDelete, onCancel }: {
  initial?: CrewMember;
  onSave: (m: Omit<CrewMember, 'id' | 'createdAt'>) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [payRate, setPayRate] = useState(initial?.payRate?.toString() ?? '');
  const [billRate, setBillRate] = useState(initial?.billRate?.toString() ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const num = (v: string) => (v.trim() ? parseFloat(v) : undefined);
  return (
    <form
      className="space-y-3"
      onSubmit={e => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({
          name: name.trim(), role: role.trim() || undefined, payRate: num(payRate), billRate: num(billRate),
          phone: phone.trim() || undefined, email: email.trim() || undefined, notes: notes.trim() || undefined,
        });
      }}
    >
      <label className="flex flex-col gap-1"><span className={LABEL}>Name *</span>
        <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Jamie Torres" className={FIELD} /></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Role</span>
        <Input value={role} onChange={e => setRole(e.target.value)} placeholder="A2, stagehand, LD" className={FIELD} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>You pay $/hr</span>
          <Input type="number" step="0.01" value={payRate} onChange={e => setPayRate(e.target.value)} placeholder="40" className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>You bill $/hr</span>
          <Input type="number" step="0.01" value={billRate} onChange={e => setBillRate(e.target.value)} placeholder={payRate || '55'} className={FIELD} /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>Phone</span>
          <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Email</span>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} className={FIELD} /></label>
      </div>
      <label className="flex flex-col gap-1"><span className={LABEL}>Notes</span>
        <Input value={notes} onChange={e => setNotes(e.target.value)} className={FIELD} /></label>
      <div className="flex items-center gap-2 pt-1">
        {onDelete && (
          <Button type="button" variant="ghost" size="sm" onClick={onDelete} className="gap-1 text-destructive">
            <Trash2 size={13} /> Remove
          </Button>
        )}
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>Save</Button>
      </div>
    </form>
  );
}

// ── Booking someone, for one day or several ───────────────────────────────

function ScheduleForm({ crew, jobs, firstDay, personId, onSave, onCancel }: {
  crew: CrewMember[];
  jobs: { id: string; date: string; name: string; venue?: string; startTime?: string }[];
  firstDay?: string;
  personId?: string;
  onSave: (shifts: Omit<CrewShift, 'id' | 'createdAt'>[]) => void;
  onCancel: () => void;
}) {
  const [crewId, setCrewId] = useState(personId ?? crew[0]?.id ?? '');
  const [days, setDays] = useState<string[]>(firstDay ? [firstDay] : []);
  const [month, setMonth] = useState<Date>(firstDay ? parseISO(firstDay) : new Date());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [jobId, setJobId] = useState('');
  const [place, setPlace] = useState('');
  const [notes, setNotes] = useState('');

  // Your shifts near the days picked: the one they are crewing, if any.
  const nearby = useMemo(() => {
    const around = days[0] ?? localToday();
    const lo = format(addDays(parseISO(around), -14), 'yyyy-MM-dd');
    const hi = format(addDays(parseISO(around), 30), 'yyyy-MM-dd');
    return jobs.filter(j => j.date >= lo && j.date <= hi).sort((a, b) => a.date.localeCompare(b.date));
  }, [jobs, days]);

  const pickJob = (id: string) => {
    setJobId(id);
    const job = jobs.find(j => j.id === id);
    if (job && !place) setPlace(job.venue ?? '');
    if (job && !startTime && job.startTime) setStartTime(job.startTime);
  };

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1"><span className={LABEL}>Who</span>
        <select value={crewId} onChange={e => setCrewId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          {crew.map(c => <option key={c.id} value={c.id}>{c.name}{c.role ? ` · ${c.role}` : ''}</option>)}
        </select>
      </label>
      <div className="flex flex-col gap-1">
        <span className={LABEL}>Days — tap one or more</span>
        <div className="self-center rounded-md border border-border">
          <Calendar
            mode="multiple"
            month={month}
            onMonthChange={setMonth}
            selected={days.map(d => parseISO(d))}
            onSelect={picked => setDays([...new Set((picked ?? []).map(d => format(d, 'yyyy-MM-dd')))].sort())}
          />
        </div>
        {days.length > 1 && <p className="text-[10px] text-muted-foreground">{days.length} days: {days.map(d => format(parseISO(d), 'MMM d')).join(', ')}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>Call</span>
          <Input value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="8:00 AM" className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Wrap</span>
          <Input value={endTime} onChange={e => setEndTime(e.target.value)} placeholder="6:00 PM" className={FIELD} /></label>
      </div>
      {nearby.length > 0 && (
        <label className="flex flex-col gap-1"><span className={LABEL}>On your shift</span>
          <select value={jobId} onChange={e => pickJob(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">— not one of your shifts —</option>
            {nearby.map(j => <option key={j.id} value={j.id}>{shortDay(j.date)} · {j.name}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1"><span className={LABEL}>Where</span>
        <Input value={place} onChange={e => setPlace(e.target.value)} placeholder="Venue" className={FIELD} /></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Notes</span>
        <Input value={notes} onChange={e => setNotes(e.target.value)} className={FIELD} /></label>
      <div className="flex gap-2 justify-end pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          disabled={!crewId || days.length === 0}
          onClick={() => onSave(days.map(date => ({
            crewId, date, startTime: startTime.trim() || undefined, endTime: endTime.trim() || undefined,
            jobId: jobId || undefined, place: place.trim() || undefined, notes: notes.trim() || undefined,
          })))}
        >
          Book {days.length > 1 ? `${days.length} days` : ''}
        </Button>
      </div>
    </div>
  );
}

// ── One booking, after the fact ────────────────────────────────────────────

function ShiftForm({ shift, member, jobs, onSave, onDelete, onPay, onUnpay, onCancel }: {
  shift: CrewShift;
  member?: CrewMember;
  jobs: { id: string; date: string; name: string }[];
  onSave: (updates: Partial<CrewShift>) => void;
  onDelete: () => void;
  /** Saves what is in the form, then pays the shift as saved. */
  onPay: (updates: Partial<CrewShift>) => void;
  onUnpay: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(shift.date);
  const [startTime, setStartTime] = useState(shift.startTime ?? '');
  const [endTime, setEndTime] = useState(shift.endTime ?? '');
  const [hours, setHours] = useState(shift.hoursWorked?.toString() ?? '');
  const [rate, setRate] = useState(shift.rate?.toString() ?? '');
  const [jobId, setJobId] = useState(shift.jobId ?? '');
  const [place, setPlace] = useState(shift.place ?? '');
  const [notes, setNotes] = useState(shift.notes ?? '');
  const num = (v: string) => (v.trim() ? parseFloat(v) : undefined);
  const draft: CrewShift = { ...shift, date, startTime: startTime || undefined, endTime: endTime || undefined, hoursWorked: num(hours), rate: num(rate) };
  const pay = crewShiftPay(draft, member);
  const nearby = jobs.filter(j => Math.abs(parseISO(j.date).getTime() - parseISO(date).getTime()) <= 21 * 864e5);
  const updates = (): Partial<CrewShift> => ({
    date, startTime: startTime.trim() || undefined, endTime: endTime.trim() || undefined, hoursWorked: num(hours),
    rate: num(rate), jobId: jobId || undefined, place: place.trim() || undefined, notes: notes.trim() || undefined,
  });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>Day</span>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Hours worked</span>
          <Input type="number" step="0.25" value={hours} onChange={e => setHours(e.target.value)} placeholder={crewShiftHours({ ...draft, hoursWorked: undefined }) ? String(crewShiftHours({ ...draft, hoursWorked: undefined })) : ''} className={FIELD} /></label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1"><span className={LABEL}>Call</span>
          <Input value={startTime} onChange={e => setStartTime(e.target.value)} placeholder="8:00 AM" className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Wrap</span>
          <Input value={endTime} onChange={e => setEndTime(e.target.value)} placeholder="6:00 PM" className={FIELD} /></label>
        <label className="flex flex-col gap-1"><span className={LABEL}>Rate $/hr</span>
          <Input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} placeholder={member?.payRate?.toString() ?? ''} className={FIELD} /></label>
      </div>
      {nearby.length > 0 && (
        <label className="flex flex-col gap-1"><span className={LABEL}>On your shift</span>
          <select value={jobId} onChange={e => setJobId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">— not one of your shifts —</option>
            {nearby.map(j => <option key={j.id} value={j.id}>{shortDay(j.date)} · {j.name}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1"><span className={LABEL}>Where</span>
        <Input value={place} onChange={e => setPlace(e.target.value)} className={FIELD} /></label>
      <label className="flex flex-col gap-1"><span className={LABEL}>Notes</span>
        <Input value={notes} onChange={e => setNotes(e.target.value)} className={FIELD} /></label>

      {/* What it comes to, and paying it. */}
      <div className="pixel-panel flex items-center gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-mono">{money(pay)}</p>
          <p className="text-[10px] text-muted-foreground">{crewShiftHours(draft)}h × ${draft.rate ?? member?.payRate ?? 0}/hr</p>
        </div>
        {shift.payoutId ? (
          <Button type="button" variant="ghost" size="sm" onClick={onUnpay} className="gap-1"><Undo2 size={13} /> Paid · undo</Button>
        ) : (
          <Button type="button" size="sm" disabled={pay <= 0} onClick={() => onPay(updates())} className="gap-1">
            <Wallet size={13} /> Pay {money(pay)}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} className="gap-1 text-destructive"><Trash2 size={13} /> Delete</Button>
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" onClick={() => onSave(updates())}>Save</Button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function CrewPage() {
  const {
    data, addCrewMember, updateCrewMember, deleteCrewMember, addCrewShifts, updateCrewShift, deleteCrewShift,
    addPayout, deletePayout,
  } = useData();
  const crew = useMemo(() => [...(data.crew ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [data.crew]);
  const shifts = data.crewShifts ?? [];
  const today = localToday();
  const byId = useMemo(() => new Map(crew.map(c => [c.id, c])), [crew]);
  const jobsLite = useMemo(() => data.jobs.map(j => ({ id: j.id, date: j.date, name: j.name, venue: j.venue, startTime: j.startTime })), [data.jobs]);

  const [weekOf, setWeekOf] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const week = Array.from({ length: 7 }, (_, i) => format(addDays(weekOf, i), 'yyyy-MM-dd'));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editingPerson, setEditingPerson] = useState<CrewMember | 'new' | null>(null);
  const [scheduling, setScheduling] = useState<{ day?: string; personId?: string } | null>(null);
  const [editingShift, setEditingShift] = useState<CrewShift | null>(null);

  const weekShifts = shifts.filter(s => s.date >= week[0] && s.date <= week[6]);
  const weekHours = weekShifts.reduce((sum, s) => sum + crewShiftHours(s), 0);
  const owed = shifts.filter(s => crewShiftOwed(s, today));
  const owedTotal = owed.reduce((sum, s) => sum + crewShiftPay(s, byId.get(s.crewId)), 0);

  /** Pays shifts with one payment on Pay Outs, and marks them paid. */
  const payShifts = async (member: CrewMember, list: CrewShift[]) => {
    if (list.length === 0) return;
    const amount = Math.round(list.reduce((sum, s) => sum + crewShiftPay(s, member), 0) * 100) / 100;
    const dates = list.map(s => s.date).sort();
    const jobNames = [...new Set(list.map(s => data.jobs.find(j => j.id === s.jobId)?.name ?? s.place).filter(Boolean))];
    const payout = await addPayout({
      workerName: member.name, amount, date: today,
      jobRef: jobNames.join(', ') || undefined,
      periodStart: dates[0], periodEnd: dates[dates.length - 1],
      notes: `${list.length} shift${list.length === 1 ? '' : 's'} on the crew schedule`,
    });
    for (const s of list) await updateCrewShift(s.id, { payoutId: payout.id });
    toast.success(`${money(amount)} paid to ${member.name} — on Pay Outs`, {
      duration: 8000,
      action: { label: 'Undo', onClick: () => { void deletePayout(payout.id); for (const s of list) void updateCrewShift(s.id, { payoutId: undefined }); } },
    });
  };

  /** Takes a payment off again: every shift it paid goes back to owed. */
  const unpay = async (payoutId: string) => {
    await deletePayout(payoutId);
    for (const s of shifts.filter(x => x.payoutId === payoutId)) await updateCrewShift(s.id, { payoutId: undefined });
  };

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <SpacePageWrapper
      title={
        <div className="flex items-center gap-2.5">
          <Users size={22} aria-hidden />
          <h1 className="text-lg font-display tracking-wide leading-none">Crew</h1>
        </div>
      }
      description={`${crew.length} ${crew.length === 1 ? 'person' : 'people'} · ${weekShifts.length} shift${weekShifts.length === 1 ? '' : 's'} this week`}
    >
      <div className="max-w-lg mx-auto">
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="pixel-panel p-3">
            <p className="text-[10px] text-muted-foreground text-mono uppercase tracking-wider">This week</p>
            <p className="text-2xl font-bold text-mono mt-1 leading-none">{weekShifts.length}</p>
            <p className="text-[10px] text-mono text-muted-foreground mt-1">shifts · {Math.round(weekHours * 10) / 10}h</p>
          </div>
          <div className="pixel-panel p-3">
            <p className="text-[10px] text-muted-foreground text-mono uppercase tracking-wider">You owe</p>
            <p className={cn('text-2xl font-bold text-mono mt-1 leading-none', owedTotal > 0 && 'text-dot-pending')}>{money(owedTotal)}</p>
            <p className="text-[10px] text-mono text-muted-foreground mt-1">{owed.length} worked, not paid</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <Button onClick={() => (crew.length ? setScheduling({}) : setEditingPerson('new'))} className="pixel-button gap-1.5">
            <Plus size={15} /> Schedule
          </Button>
          <Button variant="outline" onClick={() => setEditingPerson('new')} className="pixel-button gap-1.5">
            <Plus size={15} /> Person
          </Button>
        </div>

        {/* The week: who is on, when. */}
        <div className="pixel-panel mb-4 p-3">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Last week" onClick={() => setWeekOf(w => addDays(w, -7))} className="p-1 text-muted-foreground hover:text-foreground"><ChevronLeft size={16} /></button>
            <p className="text-xs text-mono font-bold">{format(parseISO(week[0]), 'MMM d')} – {format(parseISO(week[6]), 'MMM d')}</p>
            <button type="button" aria-label="Next week" onClick={() => setWeekOf(w => addDays(w, 7))} className="p-1 text-muted-foreground hover:text-foreground"><ChevronRight size={16} /></button>
          </div>
          <div className="divide-y divide-border/50">
            {week.map(day => {
              const onDay = weekShifts.filter(s => s.date === day);
              return (
                <div key={day} className="flex items-start gap-2 py-1.5">
                  <p className={cn('w-14 shrink-0 pt-0.5 text-[11px] text-mono', day === today ? 'font-bold text-primary' : 'text-muted-foreground')}>{format(parseISO(day), 'EEE d')}</p>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {onDay.map(s => {
                      const who = byId.get(s.crewId);
                      return (
                        <button key={s.id} type="button" onClick={() => setEditingShift(s)}
                          className={cn('max-w-full truncate border px-1.5 py-0.5 text-[11px] text-mono', shiftTone(s))}>
                          {who?.name ?? '—'}{s.startTime ? ` ${s.startTime}` : ''}{s.endTime ? `–${s.endTime}` : ''}
                        </button>
                      );
                    })}
                    {crew.length > 0 && (
                      <button type="button" aria-label={`Book someone on ${day}`} onClick={() => setScheduling({ day })}
                        className="border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground">
                        +
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Everyone, with their shifts — like Expenses, by person. */}
        {crew.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-secondary/10 p-8 text-center">
            <Users size={28} className="text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No crew yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Add the people who work for you, then book their days.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {crew.map(member => {
              const theirs = shifts.filter(s => s.crewId === member.id).sort((a, b) => a.date.localeCompare(b.date));
              const upcoming = theirs.filter(s => s.date >= today);
              const past = theirs.filter(s => s.date < today).reverse();
              const theyAreOwed = theirs.filter(s => crewShiftOwed(s, today));
              const owedToThem = theyAreOwed.reduce((sum, s) => sum + crewShiftPay(s, member), 0);
              return (
                <Collapsible key={member.id} open={open.has(member.id)} onOpenChange={() => toggle(member.id)}>
                  <CollapsibleTrigger className="flex w-full items-center gap-3 rounded-2xl bg-secondary/40 px-4 py-3 text-left transition-colors hover:bg-secondary/70">
                    <ChevronRight size={15} className={cn('shrink-0 text-muted-foreground transition-transform duration-200', open.has(member.id) && 'rotate-90')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{member.name}</span>
                      <span className="block truncate text-[10px] text-mono text-muted-foreground">
                        {member.role ?? 'crew'}{member.payRate ? ` · $${member.payRate}/hr` : ''} · {upcoming.length} booked
                      </span>
                    </span>
                    {owedToThem > 0 && <span className="shrink-0 text-sm font-bold text-mono text-dot-pending">{money(owedToThem)}</span>}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1.5 space-y-1.5 pl-2">
                      <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px]">
                        {member.phone && <a href={`tel:${member.phone}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Phone size={11} />{member.phone}</a>}
                        {member.email && <a href={`mailto:${member.email}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Mail size={11} />{member.email}</a>}
                        <span className="flex-1" />
                        <button type="button" onClick={() => setEditingPerson(member)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Pencil size={11} /> Edit</button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button type="button" onClick={() => setScheduling({ personId: member.id })} className="pixel-button pick-off py-1.5 text-[11px] font-bold">
                          <span className="inline-flex items-center gap-1"><Plus size={12} /> Book {member.name.split(' ')[0]}</span>
                        </button>
                        <button type="button" disabled={theyAreOwed.length === 0} onClick={() => void payShifts(member, theyAreOwed)}
                          className="pixel-button pick-off py-1.5 text-[11px] font-bold disabled:opacity-40">
                          <span className="inline-flex items-center gap-1"><Wallet size={12} /> Pay {owedToThem > 0 ? money(owedToThem) : 'owed'}</span>
                        </button>
                      </div>
                      {[...upcoming, ...past].map(s => {
                        const job = s.jobId ? data.jobs.find(j => j.id === s.jobId) : undefined;
                        return (
                          <button key={s.id} type="button" onClick={() => setEditingShift(s)}
                            className={cn('flex w-full items-center gap-2 border px-3 py-2 text-left', shiftTone(s))}>
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs text-mono font-semibold">{shortDay(s.date)}{s.startTime ? ` · ${s.startTime}` : ''}{s.endTime ? `–${s.endTime}` : ''}</span>
                              <span className="block truncate text-[10px] text-muted-foreground">{job?.name ?? s.place ?? '—'}{s.notes ? ` · ${s.notes}` : ''}</span>
                            </span>
                            <span className="shrink-0 text-right text-[11px] text-mono">
                              {crewShiftHours(s) > 0 && <span className="block">{crewShiftHours(s)}h</span>}
                              <span className="block text-[10px]">{s.payoutId ? 'paid' : crewShiftWorked(s) ? money(crewShiftPay(s, member)) : 'booked'}</span>
                            </span>
                          </button>
                        );
                      })}
                      {theirs.length === 0 && <p className="px-1 text-[11px] text-muted-foreground">Nothing booked yet.</p>}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        )}

        {/* Someone, added or changed */}
        <Dialog open={!!editingPerson} onOpenChange={o => !o && setEditingPerson(null)}>
          <DialogContent className="max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-mono text-sm">{editingPerson === 'new' ? 'Add someone' : 'Edit'}</DialogTitle></DialogHeader>
            {editingPerson && (
              <PersonForm
                initial={editingPerson === 'new' ? undefined : editingPerson}
                onCancel={() => setEditingPerson(null)}
                onDelete={editingPerson === 'new' ? undefined : () => {
                  const who = editingPerson;
                  const theirShifts = shifts.filter(s => s.crewId === who.id);
                  void deleteCrewMember(who.id);
                  setEditingPerson(null);
                  toast.success(`${who.name} removed${theirShifts.length ? ` with ${theirShifts.length} booking${theirShifts.length === 1 ? '' : 's'}` : ''}`, {
                    duration: 8000,
                    action: {
                      label: 'Undo',
                      onClick: () => {
                        void addCrewMember({ ...who }).then(back => addCrewShifts(theirShifts.map(({ id: _id, createdAt: _c, ...s }) => ({ ...s, crewId: back.id }))));
                      },
                    },
                  });
                }}
                onSave={async m => {
                  if (editingPerson === 'new') {
                    await addCrewMember(m);
                    toast.success(`${m.name} added`);
                  } else {
                    await updateCrewMember(editingPerson.id, m);
                  }
                  setEditingPerson(null);
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Booking */}
        <Dialog open={!!scheduling} onOpenChange={o => !o && setScheduling(null)}>
          <DialogContent className="max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-mono text-sm">Book crew</DialogTitle></DialogHeader>
            {scheduling && (
              <ScheduleForm
                crew={crew}
                jobs={jobsLite}
                firstDay={scheduling.day}
                personId={scheduling.personId}
                onCancel={() => setScheduling(null)}
                onSave={async list => {
                  await addCrewShifts(list);
                  const who = byId.get(list[0].crewId)?.name ?? 'Crew';
                  toast.success(`${who} booked for ${list.length} day${list.length === 1 ? '' : 's'}`);
                  setScheduling(null);
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* One booking */}
        <Dialog open={!!editingShift} onOpenChange={o => !o && setEditingShift(null)}>
          <DialogContent className="max-w-md rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-mono text-sm">
                {editingShift && (byId.get(editingShift.crewId)?.name ?? 'Shift')} · {editingShift && shortDay(editingShift.date)}
              </DialogTitle>
            </DialogHeader>
            {editingShift && (
              <ShiftForm
                key={editingShift.id}
                shift={shifts.find(s => s.id === editingShift.id) ?? editingShift}
                member={byId.get(editingShift.crewId)}
                jobs={jobsLite}
                onCancel={() => setEditingShift(null)}
                onSave={async u => { await updateCrewShift(editingShift.id, u); setEditingShift(null); }}
                onDelete={() => {
                  const gone = editingShift;
                  void deleteCrewShift(gone.id);
                  setEditingShift(null);
                  toast.success('Booking deleted', {
                    duration: 8000,
                    action: { label: 'Undo', onClick: () => { const { id: _id, createdAt: _c, ...rest } = gone; void addCrewShifts([rest]); } },
                  });
                }}
                onPay={async u => {
                  const member = byId.get(editingShift.crewId);
                  const current = shifts.find(s => s.id === editingShift.id) ?? editingShift;
                  await updateCrewShift(current.id, u);
                  if (member) await payShifts(member, [{ ...current, ...u }]);
                  setEditingShift(null);
                }}
                onUnpay={() => {
                  const current = shifts.find(s => s.id === editingShift.id) ?? editingShift;
                  if (current.payoutId) void unpay(current.payoutId);
                  setEditingShift(null);
                }}
              />
            )}
          </DialogContent>
        </Dialog>

        {editingShift === null && scheduling === null && editingPerson === null && shifts.length > 0 && (
          <p className="mt-4 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="inline-block h-2 w-2 bg-dot-upcoming" /> booked
            <span className="ml-2 inline-block h-2 w-2 bg-dot-pending" /> worked, owed
            <span className="ml-2 inline-block h-2 w-2 bg-dot-paid" /> paid
          </p>
        )}
      </div>
    </SpacePageWrapper>
  );
}
