import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { addDays, format, parseISO } from 'date-fns';
import { CalendarPlus, Camera, Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import DateWheels from '@/components/DateWheels';
import StubEditor from '@/components/StubEditor';
import { aiFetch } from '@/lib/aiSwitch';
import { readFileAsDataUrl, resizeImageForStorage } from '@/lib/imageResize';
import { isPdf, pdfPageImages } from '@/lib/pdfImage';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { useData } from '@/lib/DataContext';
import { localToday } from '@/lib/today';
import {
  claimDay, claimMoney, isClaimDay, readAmount, sameStub, stubDays, stubShifts, weekEndingFor,
  type ClaimStub, type StubUse, type WeekEnd,
} from '@/lib/unemployment';
import { cn } from '@/lib/utils';

const LABEL = 'font-8bit text-[7px] uppercase leading-relaxed text-[hsl(188_95%_72%)]';
const TAG = 'font-8bit shrink-0 border px-1.5 py-0.5 text-[7px] uppercase';
const GOLD = 'border-[hsl(46_100%_58%)] text-[hsl(46_100%_58%)]';
const CYAN = 'border-[hsl(188_95%_62%)] text-[hsl(188_95%_72%)]';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
/** A PDF's pages read, at most: each is one read. */
const MAX_PDF_PAGES = 10;

interface Draft { employer: string; start: string; end: string; hours: string; gross: string }

/** One paycheck the reader found in a photo, before you've confirmed it. */
interface Found {
  key: string;
  employer: string;
  start?: string;
  end?: string;
  hours: number;
  gross: number;
  /** Kept when you confirm: on unless it's incomplete or already kept. */
  keep: boolean;
  /** The stub already kept for the same employer and pay period. */
  already?: ClaimStub;
  /** The days it lists hours for, and its rate: what lets it go on the calendar. */
  days?: { date: string; hours: number }[];
  rate?: number;
}

/** "Mar 1 – Mar 14, 2026", or "Dec 28, 2025 – Jan 10, 2026" across a year. */
function periodText(start: string, end: string) {
  return start.slice(0, 4) === end.slice(0, 4)
    ? `${format(parseISO(start), 'MMM d')} – ${claimDay(end, false)}`
    : `${claimDay(start, false)} – ${claimDay(end, false)}`;
}

/** What a stub came to on the claim, in a tag and a few words. */
function StubStatus({ use, stubPay }: { use?: StubUse; stubPay: boolean }) {
  if (!use) return <span className={cn(TAG, 'border-border text-muted-foreground')}>Outside dates</span>;
  if (use.status === 'counted') {
    return <><span className={cn(TAG, GOLD)}>Counted</span><span className="text-muted-foreground">nothing on the calendar for it</span></>;
  }
  if (use.status === 'calendar') {
    return (
      <>
        <span className={cn(TAG, CYAN)}>On calendar</span>
        <span className="text-muted-foreground">
          {stubPay
            ? <>{use.shifts} shift{use.shifts === 1 ? '' : 's'} there say which weeks; its {claimMoney(use.stub.gross)} is used for them (the app's estimate was {claimMoney(use.estimate)})</>
            : <>{use.shifts} shift{use.shifts === 1 ? '' : 's'} there count as they are, est. {claimMoney(use.estimate)}; the stub says {claimMoney(use.stub.gross)}</>}
        </span>
      </>
    );
  }
  const other = use.matchedWith;
  const sameMoney = other && other.gross === use.stub.gross && other.hours === use.stub.hours;
  return use.status === 'duplicate' ? (
    <>
      <span className={cn(TAG, 'border-border text-muted-foreground')}>Duplicate</span>
      <span className="text-muted-foreground">
        same employer and pay period as another stub: counted once{other && !sameMoney ? `, and the amounts differ (${claimMoney(other.gross)} there): keep the right one` : ''}
      </span>
    </>
  ) : (
    <>
      <span className={cn(TAG, 'border-dot-overdue text-dot-overdue')}>Overlaps</span>
      <span className="text-muted-foreground">
        some of its days are on another {use.stub.employer} stub{other ? ` (${periodText(other.start, other.end)})` : ''}: not counted until the dates are right
      </span>
    </>
  );
}

/**
 * Pay stubs on the claim: for work that isn't on the calendar. Each is the
 * employer, the pay period, its hours and its gross. Nothing counts twice:
 * where the calendar has that work, its shifts count and the stub is matched
 * against them; the same stub twice counts once; stubs whose days overlap
 * count one until the dates are put right.
 *
 * A photo can hold many paychecks (a payroll site's list, several stubs):
 * you paint out anything private first, the reader lists every paycheck it
 * finds, and you see them all, with any you already have marked, and confirm
 * which to keep. Only the summaries are kept, never the photo. With AI-free
 * mode on, nothing is sent and stubs are typed in.
 */
export default function ClaimPayStubs({ uses, employerNames, weekEnd, colourOf, request }: {
  /** The stubs with pay periods in the claim's dates, and what became of each. */
  uses: StubUse[];
  employerNames: string[];
  weekEnd: WeekEnd;
  colourOf: (name: string) => string;
  /** A week's "+": open the form set to that week. */
  request?: { start: string; end: string; nonce: number } | null;
}) {
  const { prefs, setClaimStubs, setClaimUseStubPay } = useUserPrefs();
  const stubPay = !!prefs.claimUseStubPay;
  const anyOnCalendar = uses.some(u => u.status === 'calendar');
  const { addJob } = useData();
  const stubs = prefs.claimStubs;
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  /** Which page of a PDF is being read, when it has more than one. */
  const [readingPage, setReadingPage] = useState<string | null>(null);
  /** What the found list was read from, to say so. */
  const [readFrom, setReadFrom] = useState<'photo' | 'PDF'>('photo');
  const [found, setFound] = useState<Found[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const thisYear = Number(localToday().slice(0, 4));

  // A week's "+": the form, set to that week, in view.
  useEffect(() => {
    if (!request) return;
    setFound(null);
    setEditing({ draft: { employer: '', start: request.start, end: request.end, hours: '', gross: '' } });
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => {
    // The last full week, to roll from.
    const lastWeek = iso(addDays(parseISO(weekEndingFor(localToday(), weekEnd)), -7));
    setFound(null);
    setEditing({ draft: { employer: '', start: iso(addDays(parseISO(lastWeek), -6)), end: lastWeek, hours: '', gross: '' } });
  };
  const edit = (s: ClaimStub) =>
    setEditing({ id: s.id, draft: { employer: s.employer, start: s.start, end: s.end, hours: s.hours ? String(s.hours) : '', gross: s.gross ? s.gross.toFixed(2) : '' } });
  const set = (patch: Partial<Draft>) => setEditing(cur => cur && { ...cur, draft: { ...cur.draft, ...patch } });
  /** The pay period as a week, or two, ending on the day it ends. */
  const spanWeeks = (weeks: 1 | 2) =>
    setEditing(cur => cur && { ...cur, draft: { ...cur.draft, start: iso(addDays(parseISO(cur.draft.end), 1 - weeks * 7)) } });

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
    // The same employer and pay period again: that's a copy, not another stub.
    const copy = sameStub(stubs, { employer, start: d.start, end: d.end }, editing.id);
    if (copy) { toast.error(`You already have a ${copy.employer} stub for ${periodText(copy.start, copy.end)}. Edit that one.`); return; }
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

  /** What the reader finds on one picture. */
  const readOne = async (image: string): Promise<Record<string, unknown>[]> => {
    const blob = await (await fetch(image)).blob();
    const small = await resizeImageForStorage(new File([blob], 'stubs.jpg', { type: blob.type || 'image/jpeg' }));
    const resp = await aiFetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-statement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
      body: JSON.stringify({ imageBase64: small.split(',')[1], mimeType: 'image/jpeg', type: 'paystubs' }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || 'Could not read the stubs');
    return Array.isArray(body.paystubs) ? body.paystubs : [];
  };

  /** Every paycheck in a photo, or on every page of a PDF, listed to confirm. */
  const readImages = async (images: string[]) => {
    setPhoto(null);
    setEditing(null);
    setReading(true);
    try {
      const raw: Record<string, unknown>[] = [];
      // One page that can't be read doesn't lose the others.
      let failed: unknown = null;
      for (const [n, image] of images.entries()) {
        setReadingPage(images.length > 1 ? `page ${n + 1} of ${images.length}` : null);
        try {
          raw.push(...await readOne(image));
        } catch (err) {
          failed = err;
        }
      }
      if (raw.length === 0 && failed) throw failed;
      const list: Found[] = raw.map((r, i) => {
        const start = isClaimDay(r.payPeriodStart) ? r.payPeriodStart : undefined;
        const end = isClaimDay(r.payPeriodEnd) ? r.payPeriodEnd : undefined;
        const [a, b] = start && end && end < start ? [end, start] : [start, end];
        const employer = typeof r.employer === 'string' ? r.employer.trim() : '';
        const hours = Number(r.totalHours) > 0 ? Math.round(Number(r.totalHours) * 1000) / 1000 : 0;
        const gross = Number(r.grossPay) > 0 ? Math.round(Number(r.grossPay) * 100) / 100 : 0;
        const already = employer && a && b ? sameStub(stubs, { employer, start: a, end: b }) : undefined;
        const complete = !!employer && !!a && !!b && (hours > 0 || gross > 0);
        const days = a && b ? stubDays(r.hoursBreakdown, a, b) : undefined;
        const rate = Number(r.hourlyRate) > 0 ? Number(r.hourlyRate) : undefined;
        return { key: `${i}`, employer, start: a, end: b, hours, gross, already, keep: complete && !already, days, rate };
      });
      // The same paycheck read twice off one image is one.
      const seen = new Set<string>();
      const unique = list.filter(f => {
        const k = `${f.employer.toLowerCase()}|${f.start}|${f.end}|${f.gross}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (unique.length === 0) { toast.error("Couldn't find a paycheck in it. Add it by hand."); return; }
      setFound(unique);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the stubs');
    } finally {
      setReading(false);
      setReadingPage(null);
    }
  };

  // Painted over: read every paycheck in it, and list them to confirm.
  const readPhoto = (edited: string) => readImages([edited]);

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    // A PDF: every page read, one at a time. A PDF has nothing to paint
    // out on the phone, so it goes straight to the reader, as on a shift.
    setReadFrom(isPdf(file) ? 'PDF' : 'photo');
    if (isPdf(file)) {
      setReading(true);
      setReadingPage('opening the PDF');
      try {
        const { pages, total } = await pdfPageImages(file, MAX_PDF_PAGES);
        if (pages.length === 0) throw new Error('empty');
        if (total > pages.length) toast.info(`Reading the first ${pages.length} of its ${total} pages`);
        await readImages(pages);
      } catch (err) {
        console.error(err);
        toast.error('Could not open that PDF. A screenshot of it works too.');
        setReading(false);
        setReadingPage(null);
      }
      return;
    }
    if (!file.type.startsWith('image/')) { toast.error('A photo, screenshot or PDF of the stubs, please.'); return; }
    setPhoto(await readFileAsDataUrl(file));
  };

  const confirmFound = () => {
    if (!found) return;
    const now = new Date().toISOString();
    let list = stubs;
    let added = 0;
    for (const f of found) {
      if (!f.keep || !f.employer || !f.start || !f.end || sameStub(list, { employer: f.employer, start: f.start, end: f.end })) continue;
      list = [...list, {
        id: crypto.randomUUID(), employer: f.employer, start: f.start, end: f.end, hours: f.hours, gross: f.gross, createdAt: now,
        ...(f.days ? { days: f.days } : {}), ...(f.rate ? { rate: f.rate } : {}),
      }];
      added++;
    }
    setClaimStubs(list);
    setFound(null);
    toast.success(added ? `Added ${added} pay stub${added === 1 ? '' : 's'}` : 'Nothing new to add');
  };

  // One the reader couldn't finish: into the form, to fill in the rest.
  const fixFound = (f: Found) => {
    setEditing({ draft: { employer: f.employer, start: f.start ?? f.end ?? localToday(), end: f.end ?? f.start ?? localToday(), hours: f.hours ? String(f.hours) : '', gross: f.gross ? f.gross.toFixed(2) : '' } });
    setFound(cur => cur && cur.filter(x => x.key !== f.key));
  };

  /**
   * A counted stub onto the calendar: a past shift on each day it lists, so
   * its work is on the calendar too. It then matches them, so nothing counts
   * twice. A day that already has that shift isn't added again.
   */
  const toCalendar = async (stub: ClaimStub) => {
    const shifts = stubShifts(stub, new Date().toISOString());
    let added = 0;
    for (const job of shifts) if (await addJob(job)) added++;
    toast.success(added ? `Added ${added} shift${added === 1 ? '' : 's'} to the calendar, marked as from the pay stub` : 'Those days are already on the calendar');
  };

  const listed = [...stubs].sort((a, b) => b.end.localeCompare(a.end));
  const keeping = found?.filter(f => f.keep).length ?? 0;

  return (
    <section ref={sectionRef} className="neon-well space-y-2.5 p-3" data-testid="claim-stubs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={LABEL}>Pay stubs{stubs.length > 0 ? ` · ${stubs.length}` : ''}</p>
          <p className="mt-0.5 text-[11px] text-mono text-muted-foreground">For work that isn't on the calendar.</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => fileRef.current?.click()} data-testid="stub-photo" disabled={reading}
            className="pixel-button pick-off flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-mono">
            {reading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Camera size={13} aria-hidden />} Photo/PDF
          </button>
          {!editing && (
            <button type="button" onClick={startNew} data-testid="stub-add"
              className="pixel-button pick-off flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-mono">
              <Plus size={13} aria-hidden /> Add
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={e => void pickPhoto(e)} data-testid="stub-file" />
      </div>

      {/* Paint out anything private before it's read. */}
      {photo && <StubEditor source={photo} onCancel={() => setPhoto(null)} onDone={edited => void readPhoto(edited)} />}
      {reading && <p className="text-[11px] text-mono text-muted-foreground" data-testid="stub-reading">Reading every paycheck in it…{readingPage ? ` (${readingPage})` : ''}</p>}

      {/* What the reader found: every paycheck, to confirm before it's kept. */}
      {found && (
        <div className="space-y-2 border-t border-[hsl(312_95%_68%/0.3)] pt-2.5" data-testid="stub-found">
          <p className={LABEL}>Read from the {readFrom} · {found.length} paycheck{found.length === 1 ? '' : 's'}</p>
          <p className="text-[11px] text-mono text-muted-foreground">Check each against the {readFrom}. Ticked ones are added.</p>
          <ul className="space-y-1.5">
            {found.map(f => {
              const complete = !!f.employer && !!f.start && !!f.end && (f.hours > 0 || f.gross > 0);
              return (
                <li key={f.key} className={cn('flex items-start gap-2.5 border px-2.5 py-2 text-[12px] text-mono', f.keep ? 'border-[hsl(140_100%_52%/0.6)]' : 'border-border/60 opacity-80')}
                  data-testid="stub-found-row">
                  <button type="button" disabled={!complete || !!f.already} aria-pressed={f.keep}
                    aria-label={`${f.keep ? 'Keeping' : 'Not keeping'} ${f.employer || 'this paycheck'}`}
                    onClick={() => setFound(cur => cur && cur.map(x => (x.key === f.key ? { ...x, keep: !x.keep } : x)))}
                    className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border', f.keep
                      ? 'border-dot-paid bg-dot-paid/20 text-dot-paid' : 'border-[hsl(188_95%_62%/0.6)] text-transparent', (!complete || f.already) && 'opacity-40')}>
                    <Check size={15} strokeWidth={3} aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-bold" style={{ color: f.employer ? colourOf(f.employer) : undefined }}>{f.employer || 'No employer read'}</span>
                      <span className="neon-title shrink-0 font-bold">{f.gross ? claimMoney(f.gross) : 'no gross'}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {f.start && f.end ? periodText(f.start, f.end) : f.end ? `period ending ${claimDay(f.end, false)}` : 'no pay period read'}
                      {' · '}{f.hours ? `${f.hours} h` : 'no hours'}
                      {f.days && ` · lists ${f.days.length} day${f.days.length === 1 ? '' : 's'}`}
                    </p>
                    {f.already && <p className="text-[11px] text-muted-foreground"><span className={cn(TAG, 'border-border text-muted-foreground')}>Already have it</span> not added twice</p>}
                    {!complete && !f.already && (
                      <button type="button" onClick={() => fixFound(f)} className="mt-0.5 text-[11px] text-[hsl(188_90%_70%)] underline">
                        Missing {[!f.employer && 'employer', !(f.start && f.end) && 'pay period', !(f.hours || f.gross) && 'hours or gross'].filter(Boolean).join(', ')}: fill in
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <button type="button" onClick={() => setFound(null)} className="pixel-button pick-off flex-1 py-1.5 text-[11px] font-bold text-mono">Cancel</button>
            <button type="button" onClick={confirmFound} disabled={keeping === 0} data-testid="stub-found-confirm"
              className="pixel-button pick-on flex-1 py-1.5 text-[11px] font-bold text-mono disabled:opacity-40">
              Add {keeping} stub{keeping === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

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

      {/* For shifts the calendar has: their own estimates (the default), or the stub's pay shared over them. */}
      {anyOnCalendar && (
        <label className="flex items-start justify-between gap-3 border-t border-[hsl(312_95%_68%/0.3)] pt-2.5" data-testid="stub-pay-option">
          <span className="min-w-0">
            <span className="block text-[12px] font-bold text-mono">Use the stub's pay for shifts on the calendar</span>
            <span className="block text-[11px] text-mono text-muted-foreground">
              Off: each shift counts at its own estimate. On: the stub's gross and hours are shared over its shifts' weeks.
            </span>
          </span>
          <Switch checked={stubPay} onCheckedChange={setClaimUseStubPay} aria-label="Use the stub's pay for shifts on the calendar" data-testid="stub-pay-switch" />
        </label>
      )}

      {listed.length > 0 && (
        <ul className="divide-y divide-[hsl(312_95%_68%/0.2)] border-t border-[hsl(312_95%_68%/0.3)]" data-testid="stub-list">
          {listed.map(s => (
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
                <StubStatus use={uses.find(u => u.stub.id === s.id)} stubPay={stubPay} />
              </p>
              {/* Counted, so its work isn't on the calendar: put it there, from the days it lists. */}
              {uses.find(u => u.stub.id === s.id)?.status === 'counted' && (
                s.days?.length ? (
                  <button type="button" onClick={() => void toCalendar(s)} data-testid="stub-to-calendar"
                    className="pixel-button pick-off mt-1.5 flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono">
                    <CalendarPlus size={13} aria-hidden /> Add {s.days.length} day{s.days.length === 1 ? '' : 's'} to the calendar
                  </button>
                ) : (
                  <p className="mt-1 text-[11px] text-mono text-muted-foreground">
                    It doesn't list which days, so it isn't put on the calendar. Add those shifts on the days you worked and it'll match them.
                  </p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
