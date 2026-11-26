import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { CalendarPlus, Camera, Check, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import StubEditor from '@/components/StubEditor';
import ClaimStubForm, { type StubDraft } from '@/components/ClaimStubForm';
import { multiWeek, periodText } from '@/lib/stubPeriod';
import { aiFetch } from '@/lib/aiSwitch';
import { readFileAsDataUrl, resizeImageForStorage } from '@/lib/imageResize';
import { isPdf, pdfPageImages } from '@/lib/pdfImage';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import { useData } from '@/lib/DataContext';
import { localToday } from '@/lib/today';
import {
  claimDay, claimMoney, isClaimDay, OPEN_STUB_LIST_EVENT, readAmount, sameStub, stubDays, stubShifts, stubWeeks, weekEndingFor,
  type ClaimStub, type StubUse, type StubWeek, type WeekEnd,
} from '@/lib/unemployment';
import { cn } from '@/lib/utils';

const LABEL = 'font-8bit text-[7px] uppercase leading-relaxed text-[hsl(188_95%_72%)]';
const TAG = 'font-8bit shrink-0 border px-1.5 py-0.5 text-[7px] uppercase';
const GOLD = 'border-[hsl(46_100%_58%)] text-[hsl(46_100%_58%)]';
const CYAN = 'border-[hsl(188_95%_62%)] text-[hsl(188_95%_72%)]';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
/** A PDF's pages read, at most: each is one read. */
const MAX_PDF_PAGES = 10;
const STUB_LIST_OPEN_KEY = 'show-flow-claim-stubs-open';

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
  /** Its own weeks, when it prints them. */
  weeks?: StubWeek[];
  /** The pay date read off it. */
  paidOn?: string;
}

/** What a stub came to on the claim, in a tag and a few words. */
function StubStatus({ use }: { use?: StubUse }) {
  if (!use) return <span className={cn(TAG, 'border-border text-muted-foreground')}>Outside dates</span>;
  if (use.status === 'counted') {
    return <><span className={cn(TAG, GOLD)}>Counted</span><span className="text-muted-foreground">nothing on the calendar for it</span></>;
  }
  if (use.status === 'calendar') {
    return (
      <>
        <span className={cn(TAG, use.usesPay ? GOLD : CYAN)}>{use.usesPay ? 'Believed' : 'Estimate used'}</span>
        <span className="text-muted-foreground">
          {use.usesPay
            ? <>its {claimMoney(use.stub.gross)} counts, placed by the {use.shifts} shift{use.shifts === 1 ? '' : 's'} on the calendar (their estimate {claimMoney(use.estimate)})</>
            : <>the calendar's estimate, {claimMoney(use.estimate)}, counts; the stub says {claimMoney(use.stub.gross)}</>}
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
  const { prefs, setClaimStubs } = useUserPrefs();

  const { data, addJob, updateJob } = useData();
  const navigate = useNavigate();
  const stubs = prefs.claimStubs;
  /** A covered shift's rate, changed right here: it changes on the calendar too. */
  const setRate = async (jobId: string, text: string) => {
    const job = data.jobs.find(j => j.id === jobId);
    const rate = readAmount(text);
    if (!job || !Number.isFinite(rate) || rate <= 0 || rate === Number(job.hourlyRate)) return;
    await updateJob(jobId, { hourlyRate: Math.round(rate * 100) / 100 });
    toast.success(`${claimDay(job.date, false)}: $${rate}/h, on the calendar too`);
  };
  /** A stub is believed; this one's shifts can count at the calendar's estimate instead. */
  const setUseEstimate = (s: ClaimStub, on: boolean) => {
    setClaimStubs(stubs.map(x => (x.id === s.id ? (on ? { ...x, useEstimate: true } : (({ useEstimate: _, ...rest }) => rest)(x)) : x)));
    toast.success(on ? `${s.employer}: the calendar's estimate counts` : `${s.employer}: the stub's ${claimMoney(s.gross)} counts`);
  };
  const [editing, setEditing] = useState<{ id?: string; draft: StubDraft } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  /** Which page of a PDF is being read, when it has more than one. */
  const [readingPage, setReadingPage] = useState<string | null>(null);
  /** What the found list was read from, to say so. */
  const [readFrom, setReadFrom] = useState<'photo' | 'PDF'>('photo');
  const [found, setFound] = useState<Found[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  /** The list of stubs, folded or open: remembered on this phone. */
  const [listOpen, setListOpen] = useState(() => {
    try { return localStorage.getItem(STUB_LIST_OPEN_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(STUB_LIST_OPEN_KEY, listOpen ? '1' : '0'); } catch { /* only a convenience */ }
  }, [listOpen]);
  // Asked for from elsewhere (a stub's "show in the list"): open it.
  useEffect(() => {
    const open = () => setListOpen(true);
    window.addEventListener(OPEN_STUB_LIST_EVENT, open);
    return () => window.removeEventListener(OPEN_STUB_LIST_EVENT, open);
  }, []);

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
    setEditing({ id: s.id, draft: { employer: s.employer, start: s.start, end: s.end, hours: s.hours ? String(s.hours) : '', gross: s.gross ? s.gross.toFixed(2) : '', noWeeks: !!s.noWeeks, paidOn: s.paidOn ?? '', note: s.note ?? '' } });
  /** A bulk stub: averaged over its weeks, or counted for its employer in no one week. */
  const setNoWeeks = (s: ClaimStub, on: boolean) => {
    setClaimStubs(stubs.map(x => (x.id === s.id ? (on ? { ...x, noWeeks: true } : (({ noWeeks: _, ...rest }) => rest)(x)) : x)));
    toast.success(on ? `${s.employer}: not averaged over its weeks` : `${s.employer}: averaged over its weeks`);
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
        const paidOnRead = isClaimDay(r.checkDate) ? r.checkDate : undefined;
        const already = employer && a && b ? sameStub(stubs, { employer, start: a, end: b, paidOn: paidOnRead }) : undefined;
        const complete = !!employer && !!a && !!b && (hours > 0 || gross > 0);
        const days = a && b ? stubDays(r.hoursBreakdown, a, b) : undefined;
        const rate = Number(r.hourlyRate) > 0 ? Number(r.hourlyRate) : undefined;
        const weeks = a && b ? stubWeeks(r.weekBreakdown, a, b) : undefined;
        const paidOn = isClaimDay(r.checkDate) ? r.checkDate : undefined;
        return { key: `${i}`, employer, start: a, end: b, hours, gross, already, keep: complete && !already, days, rate, weeks, paidOn };
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
      if (!f.keep || !f.employer || !f.start || !f.end || sameStub(list, { employer: f.employer, start: f.start, end: f.end, paidOn: f.paidOn })) continue;
      list = [...list, {
        id: crypto.randomUUID(), employer: f.employer, start: f.start, end: f.end, hours: f.hours, gross: f.gross, createdAt: now,
        ...(f.days ? { days: f.days } : {}), ...(f.rate ? { rate: f.rate } : {}),
        ...(f.weeks ? { weeks: f.weeks } : {}), ...(f.paidOn ? { paidOn: f.paidOn } : {}),
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
        {/* The list folds away under its heading; the count shows either way. */}
        <button type="button" onClick={() => setListOpen(o => !o)} disabled={listed.length === 0} aria-expanded={listOpen}
          data-testid="stub-list-toggle" className="min-w-0 text-left">
          <p className={cn(LABEL, 'flex items-center gap-1')}>
            Pay stubs{stubs.length > 0 ? ` · ${stubs.length}` : ''}
            {listed.length > 0 && <ChevronDown size={13} className={cn('shrink-0 transition-transform', listOpen && 'rotate-180')} aria-hidden />}
          </p>
          <p className="mt-0.5 text-[11px] text-mono text-muted-foreground">
            {listed.length > 0 && !listOpen ? 'For work that isn\'t on the calendar. Tap to see them.' : 'For work that isn\'t on the calendar.'}
          </p>
        </button>
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
                      {f.weeks && ` · ${f.weeks.length} week${f.weeks.length === 1 ? '' : 's'} on it`}
                      {f.paidOn && ` · paid ${claimDay(f.paidOn, false)}`}
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
        <ClaimStubForm key={JSON.stringify(editing)} initial={editing.draft} id={editing.id} employerNames={employerNames} onDone={() => setEditing(null)} />
      )}

      {listed.length > 0 && listOpen && (
        <ul className="divide-y divide-[hsl(312_95%_68%/0.2)] border-t border-[hsl(312_95%_68%/0.3)]" data-testid="stub-list">
          {listed.map(s => (
            <li key={s.id} id={`claim-stub-${s.id}`} className="py-2 transition-colors">
              <div className="flex items-baseline justify-between gap-2">
                <span className="neon-soft min-w-0 truncate text-[13px] font-bold text-mono" style={{ color: colourOf(s.employer) }}>{s.employer}</span>
                <span className="neon-title shrink-0 text-[13px] font-bold text-mono">{claimMoney(s.gross)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-mono text-muted-foreground">
                <span className="min-w-0 truncate">Worked {periodText(s.start, s.end)} · {s.hours} h{s.paidOn ? ` · paid ${claimDay(s.paidOn, false)}` : ''}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => edit(s)} aria-label={`Edit the ${s.employer} stub`} className="p-1 hover:text-foreground"><Pencil size={13} /></button>
                  <button type="button" onClick={() => remove(s)} aria-label={`Remove the ${s.employer} stub`} className="p-1 hover:text-dot-late"><Trash2 size={13} /></button>
                </span>
              </div>
              {s.note && <p className="text-[11px] text-mono text-muted-foreground" data-testid="stub-note-shown">“{s.note}”</p>}
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-mono" data-testid="stub-status">
                <StubStatus use={uses.find(u => u.stub.id === s.id)} />
              </p>
              {/* Far from the calendar: worth a look, and why. */}
              {(() => {
                const c = uses.find(u => u.stub.id === s.id)?.check;
                if (!c?.farOff) return null;
                const why = c.hours !== undefined && c.hours >= 1
                  ? `${c.hours} h on the stub aren't on the calendar: a shift may be missing`
                  : c.hours !== undefined && c.hours <= -1
                    ? `the calendar has ${-c.hours} h more than the stub: a shift may be on the wrong stub, or the stub is for part of it`
                    : `${claimMoney(Math.abs(c.gross))} ${c.gross > 0 ? 'more' : 'less'} than the calendar's estimate for the same hours: a rate may be off`;
                return (
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-[11px] text-mono" data-testid="stub-far-off">
                    <span className={cn(TAG, 'border-dot-overdue text-dot-overdue')}>Check</span>
                    <span className="text-dot-overdue">{why}</span>
                  </p>
                );
              })()}
              {/* On the calendar: each shift it covers, its estimate and its part of the stub, and which counts. */}
              {(() => {
                const use = uses.find(u => u.stub.id === s.id);
                if (use?.status !== 'calendar' || !use.covered?.length) return null;
                const diff = s.gross - use.estimate;
                return (
                  <details className="group mt-1.5 border border-[hsl(188_95%_62%/0.35)]" data-testid="stub-covered">
                    {/* Folded until tapped: which figure counts shows either way. */}
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-2 [&::-webkit-details-marker]:hidden" data-testid="stub-covered-toggle">
                      <span className="min-w-0">
                        <span className={cn(LABEL, 'block')}>Shifts it covers · {use.covered.length}</span>
                        <span className="block text-[11px] text-mono text-muted-foreground">
                          Counted: {use.usesPay ? `the stub's ${claimMoney(s.gross)} (estimate ${claimMoney(use.estimate)})` : `the estimate, ${claimMoney(use.estimate)} · stub says ${claimMoney(s.gross)}`}
                        </span>
                      </span>
                      <ChevronDown size={15} className="shrink-0 text-[hsl(188_90%_70%)] transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="space-y-1.5 px-2 pb-2">
                    <ul className="divide-y divide-[hsl(188_95%_62%/0.15)]">
                      {use.covered.map(c => (
                        <li key={c.jobId} className="space-y-0.5 py-1.5 text-[12px] text-mono" data-testid="stub-covered-shift">
                          <div className="flex items-baseline justify-between gap-2">
                            <button type="button" onClick={() => navigate(`/?job=${c.jobId}`)} className="flex min-w-0 items-center gap-0.5 text-left font-bold text-[hsl(188_90%_70%)]"
                              aria-label={`Open the shift on ${claimDay(c.date, false)}`}>
                              <span className="truncate">{claimDay(c.date)} · {c.hours} h</span><ChevronRight size={13} className="shrink-0" aria-hidden />
                            </button>
                            <span className={cn('shrink-0', use.usesPay ? 'text-muted-foreground line-through' : 'neon-title font-bold')}>est. {claimMoney(c.estimate)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <label className="flex items-center gap-1 text-muted-foreground">
                              Rate $
                              <input key={`${c.jobId}-${c.rate ?? ''}`} defaultValue={c.rate ?? ''} inputMode="decimal" aria-label={`Rate for ${claimDay(c.date, false)}`}
                                onBlur={e => void setRate(c.jobId, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                data-testid="stub-covered-rate"
                                className="w-16 border border-[hsl(188_95%_62%/0.4)] bg-background px-1.5 py-0.5 text-base text-foreground" />
                              /h
                            </label>
                            <span className={cn('shrink-0', use.usesPay ? 'neon-title font-bold text-[hsl(46_100%_58%)]' : 'text-[hsl(46_100%_58%)]')}>stub {claimMoney(c.share)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="flex flex-wrap justify-between gap-x-2 border-t border-[hsl(188_95%_62%/0.25)] pt-1 text-[11px] text-mono">
                      <span>Estimate {claimMoney(use.estimate)} · stub {claimMoney(s.gross)}</span>
                      <span className={diff >= 0 ? 'text-dot-paid' : 'text-warning'}>{diff >= 0 ? '+' : '−'}{claimMoney(Math.abs(diff))}</span>
                    </p>
                    <p className="text-[11px] text-mono font-bold" data-testid="stub-covered-counts">
                      Counted: {use.usesPay ? `the stub's ${claimMoney(s.gross)}` : `the estimate, ${claimMoney(use.estimate)}`}. Never both.
                    </p>
                    <button type="button" onClick={() => setUseEstimate(s, !s.useEstimate)} aria-pressed={!!s.useEstimate} data-testid="stub-use-estimate"
                      className={cn('pixel-button flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono', s.useEstimate ? 'pick-on' : 'pick-off')}>
                      {s.useEstimate ? `Believe the stub (${claimMoney(s.gross)}) again` : `Use the calendar's estimate (${claimMoney(use.estimate)}) instead`}
                    </button>
                    </div>
                  </details>
                );
              })()}
              {/* A bulk stub over many weeks: averaged over them, or not. */}
              {uses.find(u => u.stub.id === s.id)?.status === 'counted' && multiWeek(s.start, s.end) && (
                <div className="mt-1.5 space-y-1">
                  <button type="button" onClick={() => setNoWeeks(s, !s.noWeeks)} aria-pressed={!!s.noWeeks} data-testid="stub-no-weeks"
                    className={cn('pixel-button flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-mono', s.noWeeks ? 'pick-on' : 'pick-off')}>
                    {s.noWeeks && <Check size={13} aria-hidden />} {s.noWeeks ? 'Not averaged over weeks' : "Don't average over weeks"}
                  </button>
                  <p className="text-[11px] text-mono text-muted-foreground">
                    {s.noWeeks
                      ? `Counted for ${s.employer} and in the totals, in no one week.`
                      : `Averaged: about ${claimMoney(s.gross / Math.max(1, (differenceInCalendarDays(parseISO(s.end), parseISO(s.start)) + 1) / 7))} a week.`}
                  </p>
                </div>
              )}
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
