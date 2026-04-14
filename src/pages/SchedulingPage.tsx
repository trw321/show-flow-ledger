import { useState, useMemo, useEffect } from 'react';
import { useData } from '@/lib/DataContext';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Clock, ChevronRight, Users, Trash2, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

// ── Types ──────────────────────────────────────────────────────────────────

interface CrewMember {
  id: string;
  name: string;
  role: string;
  phone?: string;
  rate?: number;
}

interface Shift {
  id: string;
  crewMemberId: string;
  jobRef?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  hoursWorked?: number;
  mealBreak?: 'ywa' | 'nwa_fed' | 'nwa_pass';
  notes?: string;
}

// ── Local storage helpers (keyed per user) ─────────────────────────────────

function storageKey(uid: string, type: 'crew' | 'shifts') {
  return `av-${type}-${uid}`;
}

function loadList<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
}

function saveList<T>(key: string, list: T[]) {
  localStorage.setItem(key, JSON.stringify(list));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function calcHours(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const parse = (t: string) => {
    const m = t.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|a|p)?/i);
    if (!m) return NaN;
    let h = parseInt(m[1]);
    const min = parseInt(m[2] || '0');
    const ap = (m[3] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    return h * 60 + min;
  };
  let s = parse(start), e = parse(end);
  if (isNaN(s) || isNaN(e)) return 0;
  if (e <= s) e += 24 * 60;
  return Math.max(0, (e - s) / 60);
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SchedulingPage() {
  const { data } = useData();
  const [uid, setUid] = useState<string | null>(null);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  // Dialog state
  const [crewDialog, setCrewDialog] = useState(false);
  const [shiftDialog, setShiftDialog] = useState(false);
  const [selectedMember, setSelectedMember] = useState<CrewMember | null>(null);

  // New crew form
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRate, setNewRate] = useState('');

  // New shift form
  const [shiftMemberId, setShiftMemberId] = useState('');
  const [shiftJob, setShiftJob] = useState('');
  const [shiftDate, setShiftDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const [shiftMeal, setShiftMeal] = useState<Shift['mealBreak']>(undefined);
  const [shiftNotes, setShiftNotes] = useState('');

  // Load user + data
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const id = session?.user?.id;
      if (!id) return;
      setUid(id);
      setCrew(loadList<CrewMember>(storageKey(id, 'crew')));
      setShifts(loadList<Shift>(storageKey(id, 'shifts')));
    });
  }, []);

  const persistCrew = (next: CrewMember[]) => {
    setCrew(next);
    if (uid) saveList(storageKey(uid, 'crew'), next);
  };
  const persistShifts = (next: Shift[]) => {
    setShifts(next);
    if (uid) saveList(storageKey(uid, 'shifts'), next);
  };

  const addCrewMember = () => {
    if (!newName.trim()) return;
    const member: CrewMember = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      role: newRole.trim(),
      phone: newPhone.trim() || undefined,
      rate: newRate ? parseFloat(newRate) : undefined,
    };
    persistCrew([...crew, member]);
    setNewName(''); setNewRole(''); setNewPhone(''); setNewRate('');
    setCrewDialog(false);
    toast.success(`${member.name} added to crew`);
  };

  const removeMember = (id: string) => {
    persistCrew(crew.filter(c => c.id !== id));
    persistShifts(shifts.filter(s => s.crewMemberId !== id));
  };

  const addShift = () => {
    if (!shiftMemberId || !shiftDate) return;
    let hours = calcHours(shiftStart, shiftEnd);
    if (shiftMeal === 'ywa' && hours > 0) hours = Math.max(0, hours - 1);
    const shift: Shift = {
      id: crypto.randomUUID(),
      crewMemberId: shiftMemberId,
      jobRef: shiftJob.trim() || undefined,
      date: shiftDate,
      startTime: shiftStart.trim() || undefined,
      endTime: shiftEnd.trim() || undefined,
      hoursWorked: hours > 0 ? parseFloat(hours.toFixed(2)) : undefined,
      mealBreak: shiftMeal,
      notes: shiftNotes.trim() || undefined,
    };
    persistShifts([...shifts, shift]);
    setShiftJob(''); setShiftDate(format(new Date(), 'yyyy-MM-dd'));
    setShiftStart(''); setShiftEnd(''); setShiftMeal(undefined); setShiftNotes('');
    setShiftDialog(false);
    toast.success('Shift logged');
  };

  const memberShifts = (memberId: string) =>
    shifts.filter(s => s.crewMemberId === memberId)
      .sort((a, b) => b.date.localeCompare(a.date));

  const totalHours = (memberId: string) =>
    memberShifts(memberId).reduce((s, sh) => s + (sh.hoursWorked ?? 0), 0);

  const rawShiftHours = calcHours(shiftStart, shiftEnd);
  const shiftHours = shiftMeal === 'ywa' ? Math.max(0, rawShiftHours - 1) : rawShiftHours;

  // Upcoming job names for quick-fill
  const jobNames = useMemo(() =>
    [...new Set(data.jobs.map(j => j.name).filter(Boolean))].slice(0, 8),
    [data.jobs]
  );

  return (
    <>
      <PageHeader title="Scheduling" description="Crew schedules and timesheets" />

      <div className="flex gap-2 mb-6">
        <Button size="sm" variant="outline" onClick={() => setCrewDialog(true)} className="gap-1.5">
          <Users size={14} /> Add Crew Member
        </Button>
        {crew.length > 0 && (
          <Button size="sm" onClick={() => { setShiftMemberId(crew[0].id); setShiftDialog(true); }} className="gap-1.5">
            <Plus size={14} /> Log Shift
          </Button>
        )}
      </div>

      {crew.length === 0 ? (
        <div className="rounded-2xl border border-border/40 bg-secondary/10 p-8 text-center">
          <Users size={28} className="text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No crew members yet</p>
          <p className="text-xs text-muted-foreground/50 mt-1">Add your first crew member to start scheduling</p>
        </div>
      ) : (
        <div className="space-y-4">
          {crew.map(member => {
            const recentShifts = memberShifts(member.id).slice(0, 3);
            const hrs = totalHours(member.id);
            return (
              <div key={member.id} className="rounded-2xl border border-border bg-card overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-secondary/20 transition-colors"
                  onClick={() => setSelectedMember(selectedMember?.id === member.id ? null : member)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-xs">
                      {member.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role || 'Crew'}{member.rate ? ` · $${member.rate}/hr` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {hrs > 0 && (
                      <span className="text-xs text-mono text-primary font-semibold">{hrs.toFixed(1)}h total</span>
                    )}
                    <ChevronRight size={14} className={cn("text-muted-foreground/40 transition-transform", selectedMember?.id === member.id && "rotate-90")} />
                  </div>
                </div>

                {selectedMember?.id === member.id && (
                  <div className="border-t border-border/50 p-3 space-y-3">
                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs h-7"
                        onClick={() => { setShiftMemberId(member.id); setShiftDialog(true); }}
                      >
                        <Plus size={12} /> Log Shift
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-xs h-7 text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                        onClick={() => { removeMember(member.id); setSelectedMember(null); }}
                      >
                        <Trash2 size={12} /> Remove
                      </Button>
                    </div>

                    {/* Shifts */}
                    {recentShifts.length === 0 ? (
                      <p className="text-xs text-muted-foreground/50 text-center py-2">No shifts logged yet</p>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-[9px] text-mono uppercase tracking-widest text-muted-foreground/40">Recent Shifts</p>
                        {recentShifts.map(sh => (
                          <div key={sh.id} className="flex items-center justify-between rounded-xl bg-secondary/20 px-3 py-2">
                            <div>
                              <p className="text-xs font-medium">
                                {format(parseISO(sh.date + 'T12:00:00'), 'EEE, MMM d')}
                                {sh.jobRef && <span className="text-muted-foreground ml-1.5">· {sh.jobRef}</span>}
                              </p>
                              {(sh.startTime || sh.endTime) && (
                                <p className="text-[10px] text-mono text-muted-foreground">
                                  {sh.startTime}{sh.endTime ? ` – ${sh.endTime}` : ''}
                                  {sh.mealBreak === 'ywa' && <span className="ml-1.5 text-muted-foreground/50">· 1hr walk away</span>}
                                  {sh.mealBreak === 'nwa_fed' && <span className="ml-1.5 text-muted-foreground/50">· 30min fed</span>}
                                  {sh.mealBreak === 'nwa_pass' && <span className="ml-1.5 text-amber-400">· 30min pass ⚠</span>}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {(sh.hoursWorked ?? 0) > 0 && (
                                <span className="text-xs text-mono font-semibold text-primary">{sh.hoursWorked}h</span>
                              )}
                              {member.rate && (sh.hoursWorked ?? 0) > 0 && (
                                <span className="text-xs text-mono text-success">${((sh.hoursWorked ?? 0) * member.rate).toLocaleString()}</span>
                              )}
                              <button
                                onClick={() => persistShifts(shifts.filter(s => s.id !== sh.id))}
                                className="text-muted-foreground/30 hover:text-destructive transition-colors"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                        {memberShifts(member.id).length > 3 && (
                          <p className="text-[10px] text-muted-foreground/40 text-center">
                            +{memberShifts(member.id).length - 3} more shifts
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Crew Member dialog */}
      <Dialog open={crewDialog} onOpenChange={setCrewDialog}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle className="text-mono text-sm">Add Crew Member</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Name *</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Jamie Torres" className="h-9" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Role</label>
              <Input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="e.g. A2, Stage Hand, LD" className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Phone</label>
                <Input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="555-0100" className="h-9" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Hourly Rate</label>
                <Input type="number" min="0" value={newRate} onChange={e => setNewRate(e.target.value)} placeholder="$0" className="h-9" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setCrewDialog(false)}>Cancel</Button>
              <Button size="sm" className="flex-1" disabled={!newName.trim()} onClick={addCrewMember}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Shift dialog */}
      <Dialog open={shiftDialog} onOpenChange={setShiftDialog}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader><DialogTitle className="text-mono text-sm">Log Shift</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Crew Member *</label>
              <select
                value={shiftMemberId}
                onChange={e => setShiftMemberId(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {crew.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Show / Job</label>
              <Input
                value={shiftJob}
                onChange={e => setShiftJob(e.target.value)}
                placeholder="Show name or job"
                className="h-9"
                list="job-names"
              />
              <datalist id="job-names">
                {jobNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Date *</label>
              <Input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Start</label>
                <Input value={shiftStart} onChange={e => setShiftStart(e.target.value)} placeholder="7:00 AM" className="h-9 text-mono text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">End</label>
                <Input value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} placeholder="5:00 PM" className="h-9 text-mono text-sm" />
              </div>
            </div>
            {/* Meal break */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Meal Break</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  { key: 'ywa',     label: '1hr Walk Away',        sub: 'deducted from pay' },
                  { key: 'nwa_fed', label: '30min On Clock',        sub: 'fed — no penalty' },
                  { key: 'nwa_pass',label: '30min On Clock',        sub: 'pass — penalty owed' },
                ] as const).map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setShiftMeal(shiftMeal === opt.key ? undefined : opt.key)}
                    className={cn(
                      "rounded-xl border py-2 px-1 text-center transition-colors",
                      shiftMeal === opt.key
                        ? "bg-primary/15 border-primary/50 text-primary"
                        : "border-border bg-secondary/20 text-muted-foreground hover:border-primary/30"
                    )}
                  >
                    <p className="text-[11px] font-semibold leading-tight">{opt.label}</p>
                    <p className="text-[9px] leading-tight mt-0.5 opacity-60">{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {rawShiftHours > 0 && (
              <div className="text-xs text-mono text-muted-foreground space-y-0.5">
                <p className="flex items-center gap-1">
                  <Clock size={11} /> {shiftHours.toFixed(1)} hours paid
                  {shiftMeal === 'ywa' && <span className="text-muted-foreground/50">(−1h meal)</span>}
                  {(() => {
                    const m = crew.find(c => c.id === shiftMemberId);
                    return m?.rate ? <span className="text-success ml-1">${(shiftHours * m.rate).toFixed(0)}</span> : null;
                  })()}
                </p>
                {shiftMeal === 'nwa_pass' && (
                  <p className="text-amber-400">⚠ meal penalty owed — log separately in Pay Outs</p>
                )}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Notes</label>
              <Input value={shiftNotes} onChange={e => setShiftNotes(e.target.value)} placeholder="Optional notes" className="h-9" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setShiftDialog(false)}>Cancel</Button>
              <Button size="sm" className="flex-1" disabled={!shiftMemberId || !shiftDate} onClick={addShift}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
