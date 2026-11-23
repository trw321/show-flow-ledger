import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { addDays, format, parseISO } from 'date-fns';
import { Camera, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import DateWheels from '@/components/DateWheels';
import StubEditor from '@/components/StubEditor';
import { aiFetch } from '@/lib/aiSwitch';
import { readFileAsDataUrl, resizeImageForStorage } from '@/lib/imageResize';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { localToday } from '@/lib/today';
import { claimDay, claimMoney, readAmount, weekEndingFor, type ClaimStub, type StubUse, type WeekEnd } from '@/lib/unemployment';
import { cn } from '@/lib/utils';

const LABEL = 'font-8bit text-[7px] uppercase leading-relaxed text-[hsl(188_95%_72%)]';
const TAG = 'font-8bit shrink-0 border px-1.5 py-0.5 text-[7px] uppercase';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

interface Draft { employer: string; start: string; end: string; hours: string; gross: string }

/** "Mar 1 – Mar 14, 2026", or "Dec 28, 2025 – Jan 10, 2026" across a year. */
function periodText(start: string, end: string) {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${format(parseISO(start), 'MMM d')} – ${claimDay(end, false)}`
    : `${claimDay(start, false)} – ${claimDay(end, false)}`;
}

/**
 * Pay stubs on the claim: for work that isn't on the calendar. Each is the
 * employer, the pay period, its hours and its gross. Where the calendar has
 * nothing for that employer in the period, the stub counts, marked as a stub
 * everywhere it shows; where it has shifts, they count and the stub is here
 * to check them against.
 *
 * A photo of the stub can fill the form in: you paint out anything private
 * first, the app's stub reader reads the employer, pay period, hours and
 * gross, and you check them before saving. Only the summary is kept, never
 * the photo. With AI-free mode on, nothing is sent and it's typed in.
 */
export default function ClaimPayStubs({ uses, employerNames, weekEnd, colourOf }: {
  /** The stubs with pay periods in the claim's dates, and whether each counted. */
  uses: StubUse[];
  employerNames: string[];
  weekEnd: WeekEnd;
  colourOf: (name: string) => string;
}) {
  const { prefs, setClaimStubs } = useUserPrefs();
  const stubs = prefs.claimStubs;
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  /** A stub photo being painted over before it's read. */
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const thisYear = Number(localToday().slice(0, 4));

  const startNew = () => {
    // The last full week, to roll from.
    const lastWeek = iso(addDays(parseISO(weekEndingFor(localToday(), weekEnd)), -7));
    setEditing({ draft: { employer: '', start: iso(addDays(parseISO(lastWeek), -6)), end: lastWeek, hours: '', gross: '' } });
  };

  /** A new stub from a photo: the form opens, then the camera or photos. */
  const fromPhoto = () => {
    if (!editing) startNew();
    fileRef.current?.click();
  };

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('A photo of the stub, please: a PDF can\'t be read here.'); return; }
    setPhoto(await readFileAsDataUrl(file));
  };

  // Painted over: read it, and fill the form in for checking.
  const readPhoto = async (edited: string) => {
    setPhoto(null);
    setReading(true);
    try {
      const blob = await (await fetch(edited)).blob();
      const small = await resizeImageForStorage(new File([blob], 'stub.jpg', { type: blob.type || 'image/jpeg' }));
      const resp = await aiFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-statement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({ imageBase64: small.split(',')[1], mimeType: 'image/jpeg', type: 'paystub' }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || 'Could not read the stub');
      const stub = body.paystub ?? {};
      const breakdown: { hours?: number }[] = Array.isArray(stub.hoursBreakdown) ? stub.hoursBreakdown : [];
      const hours = Number(stub.totalHours) || breakdown.reduce((t, b) => t + (Number(b.hours) || 0), 0);
      const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
      setEditing(cur => {
        const d = cur?.draft ?? { employer: '', start: localToday(), end: localToday(), hours: '', gross: '' };
        return {
          id: cur?.id,
          draft: {
            employer: typeof stub.employer === 'string' && stub.employer.trim() ? stub.employer.trim() : d.employer,
            start: day(stub.payPeriodStart) ?? d.start,
            end: day(stub.payPeriodEnd) ?? d.end,
            hours: hours > 0 ? String(Math.round(hours * 1000) / 1000) : d.hours,
            gross: Number(stub.grossPay) > 0 ? Number(stub.grossPay).toFixed(2) : d.gross,
          },
        };
      });
      toast.success(day(stub.payPeriodStart) ? 'Read it: check it before saving' : 'Read it, but no pay period was printed: set the dates');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the stub');
    } finally {
      setReading(false);
    }
  };

  /** The pay period as a week, or two, ending on the day it ends. */
  const spanWeeks = (weeks: 1 | 2) =>
    setEditing(cur => cur && { ...cur, draft: { ...cur.draft, start: iso(addDays(parseISO(cur.draft.end), 1 - weeks * 7)) } });
  const edit = (s: ClaimStub) =>
    setEditing({ id: s.id, draft: { employer: s.employer, start: s.start, end: s.end, hours: s.hours ? String(s.hours) : '', gross: s.gross ? s.gross.toFixed(2) : '' } });
  const set = (patch: Partial<Draft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...patch } });

  const save = () => {
    if (!editing) return;
    const d = editing.draft;
    const employer = d.employer.trim();
    const hours = d.hours.trim() ? readAmount(d.hours) : 0;
    const gross = d.gross.trim() ? readAmount(d.gross) : 0;
    if (!employer) { toast.error('Who paid it? Put in the employer.'); return; }
    if (d.end < d.start) { toast.error('The pay period ends before it starts.'); return; }
    if (!Number.isFinite(hours) || hours < 0 || !Number.isFinite(gross) || gross < 0) { toast.error('Hours and gross need to be numbers.'); return; }
    if (hours === 0 && gross === 0) { toast.error('Put in the hours or the gross from the stub.'); return; }
    const before = stubs.find(s => s.id === editing.id);
    const stub: ClaimStub = {
      id: before?.id ?? crypto.randomUUID(),
      employer, start: d.start, end: d.end, hours, gross: Math.round(gross * 100) / 100,
      createdAt: before?.createdAt ?? new Date().toISOString(),
    };
    setClaimStubs(before ? stubs.map(s => (s.id === before.id ? stub : s)) : [...stubs, stub]);
    toast.success(before ? 'Pay stub saved' : 'Pay stub added');
    setEditing(null);
  };

  const remove = (s: ClaimStub) => {
    const before = stubs;
    setClaimStubs(stubs.filter(x => x.id !== s.id));
    toast(`Removed the ${s.employer} stub`, { action: { label: 'Undo', onClick: () => setClaimStubs(before) } });
  };

  const listed = [...stubs].sort((a, b) => b.end.localeCompare(a.end));

  return (
    <section className="neon-well space-y-2.5 p-3" data-testid="claim-stubs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={LABEL}>Pay stubs{stubs.length > 0 ? ` · ${stubs.length}` : ''}</p>
          <p className="mt-0.5 text-[11px] text-mono text-muted-foreground">For work that isn't on the calendar.</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={fromPhoto} data-testid="stub-photo" disabled={reading}
            className="pixel-button pick-off flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-mono">
            {reading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Camera size={13} aria-hidden />} Photo
          </button>
          {!editing && (
            <button type="button" onClick={startNew} data-testid="stub-add"
              className="pixel-button pick-off flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-mono">
              <Plus size={13} aria-hidden /> Add
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => void pickPhoto(e)} data-testid="stub-file" />
      </div>

      {/* Paint out anything private before it's read. */}
      {photo && <StubEditor source={photo} onCancel={() => setPhoto(null)} onDone={edited => void readPhoto(edited)} />}
      {reading && <p className="text-[11px] text-mono text-muted-foreground">Reading the stub…</p>}

      {editing && (
        <div className="space-y-3 border-t border-[hsl(312_95%_68%/0.3)] pt-3" data-testid="stub-form">
          <label className="block space-y-1">
            <span className={LABEL}>Employer</span>
            <Input value={editing.draft.employer} list="claim-stub-employers" placeholder="Who the stub is from"
              onChange={e => set({ employer: e.target.value })} className="text-mono" data-testid="stub-employer" />
            <datalist id="claim-stub-employers">{employerNames.map(n => <option key={n} value={n} />)}</datalist>
          </label>
          <DateWheels label="Pay period from" value={editing.draft.start} firstYear={thisYear - 6} lastYear={thisYear}
            onChange={start => set({ start })} testId="stub-start" />
          <DateWheels label="Pay period through" value={editing.draft.end} firstYear={thisYear - 6} lastYear={thisYear}
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
              <Input value={editing.draft.hours} inputMode="decimal" placeholder="40" onChange={e => set({ hours: e.target.value })}
                className="text-mono" data-testid="stub-hours" />
            </label>
            <label className="block space-y-1">
              <span className={LABEL}>Gross</span>
              <Input value={editing.draft.gross} inputMode="decimal" placeholder="2000.00" onChange={e => set({ gross: e.target.value })}
                className="text-mono" data-testid="stub-gross" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(null)} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold text-mono">Cancel</button>
            <button type="button" onClick={save} data-testid="stub-save" className="pixel-button pick-on flex-1 py-1.5 text-[11px] font-bold text-mono">Save stub</button>
          </div>
        </div>
      )}

      {listed.length > 0 && (
        <ul className="divide-y divide-[hsl(312_95%_68%/0.2)] border-t border-[hsl(312_95%_68%/0.3)]" data-testid="stub-list">
          {listed.map(s => {
            const use = uses.find(u => u.stub.id === s.id);
            return (
              <li key={s.id} className="py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="neon-soft min-w-0 truncate text-[13px] font-bold text-mono" style={{ color: colourOf(s.employer) }}>{s.employer}</span>
                  <span className="neon-title shrink-0 text-[13px] font-bold text-mono">{claimMoney(s.gross)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-mono text-muted-foreground">
                  <span className="min-w-0 truncate">{periodText(s.start, s.end)} · {s.hours} h</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => edit(s)} aria-label={`Edit the ${s.employer} stub`} className="p-1 hover:text-foreground"><Pencil size={13} /></button>
                    <button type="button" onClick={() => remove(s)} aria-label={`Remove the ${s.employer} stub`} className="p-1 hover:text-dot-late"><Trash2 size={13} /></button>
                  </span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-mono" data-testid="stub-status">
                  {!use ? (
                    <span className={cn(TAG, 'border-border text-muted-foreground')}>Outside dates</span>
                  ) : use.used ? (
                    <>
                      <span className={cn(TAG, 'border-[hsl(46_100%_58%)] text-[hsl(46_100%_58%)]')}>Counted</span>
                      <span className="text-muted-foreground">nothing on the calendar for it</span>
                    </>
                  ) : (
                    <>
                      <span className={cn(TAG, 'border-[hsl(188_95%_62%)] text-[hsl(188_95%_72%)]')}>On calendar</span>
                      <span className="text-muted-foreground">
                        {use.shifts} shift{use.shifts === 1 ? '' : 's'} counted instead, est. {claimMoney(use.estimate)}
                      </span>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
