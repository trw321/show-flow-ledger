import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { format, getDaysInMonth, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

/** How tall one value is in a wheel's window, in px: the window shows exactly one. */
const ITEM = 44;
/** How long after a touch, a mouse wheel or a key a scroll still counts as yours, in ms. */
const YOURS_FOR = 1500;

interface WheelItem<T> { value: T; label: string }

/**
 * One scroll wheel that shows only the value chosen: swipe it (or scroll,
 * or tap the arrows, or use the arrow keys) and the next one rolls in. The
 * window is one value tall, so the ones either side stay out of sight.
 * Given `onPick`, a tap on the window (or Enter) asks for a grid of every
 * value, to go straight to one instead of rolling through. With `loop`, it
 * goes round: up from the first is the last (SUN up is SAT).
 *
 * Only a scroll you make changes the value. A wheel set before it was on
 * screen used to sit on its first entry (JAN) while the date was really
 * something else, and any stray scroll would then have saved JAN; it now
 * puts itself back on the chosen value whenever it shows or changes size.
 */
export function Wheel<T extends string | number>({ items, value, onChange, label, testId, onPick, picking, loop }: {
  items: WheelItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  testId?: string;
  onPick?: () => void;
  /** Its grid is open: the window lights up to say which one it's for. */
  picking?: boolean;
  loop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number>();
  const lastYours = useRef(0);
  const n = items.length;
  const index = Math.max(0, items.findIndex(i => i.value === value));
  // Going round: three copies, kept on the middle one, so there's always
  // more above and below.
  const shown = loop ? [...items, ...items, ...items] : items;
  const at = useCallback((i: number) => (loop ? n + i : i) * ITEM, [loop, n]);
  const indexRef = useRef(index);
  indexRef.current = index;

  const yours = () => Date.now() - lastYours.current < YOURS_FOR;
  const markYours = () => { lastYours.current = Date.now(); };

  /** The window back on the chosen value, unless you're the one moving it. */
  const resync = useCallback(() => {
    const el = ref.current;
    if (!el || Date.now() - lastYours.current < YOURS_FOR) return;
    const want = at(indexRef.current);
    if (Math.abs(el.scrollTop - want) > 1) el.scrollTop = want;
  }, [at]);

  // After every render: an arrow, a preset, a pick from the grid, a shorter
  // month pulling the day back.
  useLayoutEffect(() => { resync(); });

  // When it shows or changes size: set while hidden, it didn't take.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => resync());
    ro.observe(el);
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) resync(); });
    io.observe(el);
    const back = () => resync();
    window.addEventListener('pageshow', back);
    document.addEventListener('visibilitychange', back);
    return () => { ro.disconnect(); io.disconnect(); window.removeEventListener('pageshow', back); document.removeEventListener('visibilitychange', back); };
  }, [resync]);

  // Once your swipe comes to rest, the value under the window is the one chosen.
  const onScroll = () => {
    window.clearTimeout(settle.current);
    if (!yours()) {
      // Not you (the page moving it): put it back, change nothing.
      settle.current = window.setTimeout(resync, 120);
      return;
    }
    markYours(); // a fling carries on after the finger lifts
    settle.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const raw = Math.round(el.scrollTop / ITEM);
      const i = loop ? ((raw % n) + n) % n : Math.min(n - 1, Math.max(0, raw));
      lastYours.current = 0;
      if (loop) el.scrollTop = at(i); // back to the middle copy: the same value
      if (items[i] && items[i].value !== value) onChange(items[i].value);
    }, 140);
  };

  const step = (by: number) => {
    const i = loop ? (index + by + n) % n : Math.min(n - 1, Math.max(0, index + by));
    if (i !== index) onChange(items[i].value);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <button type="button" onClick={() => step(-1)} aria-label={`${label}: up`}
        className="flex h-6 w-full items-center justify-center text-[hsl(188_90%_70%)] active:opacity-60">
        <ChevronUp size={16} aria-hidden />
      </button>
      <div
        ref={ref}
        onScroll={onScroll}
        onTouchStart={markYours}
        onTouchMove={markYours}
        onPointerDown={markYours}
        onWheel={markYours}
        // A swipe scrolls and doesn't click; a tap clicks.
        onClick={onPick}
        role="spinbutton"
        tabIndex={0}
        aria-label={onPick ? `${label}. Tap to pick from a list.` : label}
        aria-valuenow={index}
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuetext={items[index]?.label}
        aria-expanded={onPick ? !!picking : undefined}
        data-testid={testId}
        onKeyDown={e => {
          if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
          if ((e.key === 'Enter' || e.key === ' ') && onPick) { e.preventDefault(); onPick(); }
        }}
        className={cn(
          'neon-well scrollbar-none w-full snap-y snap-mandatory overflow-y-scroll overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-[hsl(188_90%_70%)]',
          onPick && 'cursor-pointer',
          picking && 'ring-2 ring-[hsl(188_95%_65%)]',
        )}
        style={{ height: ITEM }}
      >
        {shown.map((item, k) => (
          <div key={`${k}-${String(item.value)}`} className="neon-title flex snap-center items-center justify-center text-lg font-bold text-mono"
            style={{ height: ITEM }} aria-hidden={k !== (loop ? n + index : index)}>
            {item.label}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => step(1)} aria-label={`${label}: down`}
        className="flex h-6 w-full items-center justify-center text-[hsl(188_90%_70%)] active:opacity-60">
        <ChevronDown size={16} aria-hidden />
      </button>
    </div>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: format(new Date(2000, i, 1), 'MMM').toUpperCase() }));
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** One choice in a grid: lit when it's the one chosen. */
function Pick({ chosen, onClick, label, children, testId }: { chosen: boolean; onClick: () => void; label: string; children: React.ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={chosen} data-testid={testId}
      className={cn(
        'flex h-10 items-center justify-center text-sm font-bold text-mono transition-colors',
        chosen
          ? 'neon-title bg-[hsl(312_95%_68%/0.25)] shadow-[inset_0_0_0_1px_hsl(312_95%_68%)]'
          : 'text-foreground/85 hover:bg-[hsl(188_95%_62%/0.12)] active:bg-[hsl(188_95%_62%/0.2)]',
      )}>
      {children}
    </button>
  );
}

/**
 * A whole date on three wheels, month, day and year, each showing only what's
 * chosen. Tap one to see them all and go straight there: the months in a
 * grid, the days as that month's calendar, the years in a grid. The value is
 * YYYY-MM-DD. A day past the end of a shorter month comes back to its last day.
 */
export default function DateWheels({ label, value, onChange, firstYear, lastYear, testId }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  firstYear: number;
  lastYear: number;
  testId?: string;
}) {
  const [picking, setPicking] = useState<'month' | 'day' | 'year' | null>(null);
  const d = parseISO(value);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const set = (y: number, m: number, dd: number) => {
    const last = getDaysInMonth(new Date(y, m - 1, 1));
    onChange(`${y}-${String(m).padStart(2, '0')}-${String(Math.min(dd, last)).padStart(2, '0')}`);
  };
  const days = Array.from({ length: getDaysInMonth(d) }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => ({ value: firstYear + i, label: String(firstYear + i) }));
  // Numbers count up as you go up: 28, then 29 above it; 2025, then 2026.
  // Months read like a calendar page, earlier above: SEP, then AUG above it.
  const daysUp = [...days].reverse();
  const yearsUp = [...years].reverse();
  const toggle = (which: 'month' | 'day' | 'year') => setPicking(p => (p === which ? null : which));
  // Picked: set it, and fold the grid away.
  const choose = (y: number, m: number, dd: number) => { set(y, m, dd); setPicking(null); };
  const leadingBlanks = new Date(year, month - 1, 1).getDay();

  return (
    <div data-testid={testId}>
      <p className="font-8bit mb-1 text-[8px] uppercase text-[hsl(312_95%_75%)]">{label}</p>
      <div className="flex gap-2">
        <Wheel label={`${label} month`} items={MONTHS} value={month} onChange={m => set(year, m, day)} testId={testId && `${testId}-month`}
          onPick={() => toggle('month')} picking={picking === 'month'} />
        <Wheel label={`${label} day`} items={daysUp} value={day} onChange={dd => set(year, month, dd)} testId={testId && `${testId}-day`}
          onPick={() => toggle('day')} picking={picking === 'day'} />
        <Wheel label={`${label} year`} items={yearsUp} value={year} onChange={y => set(y, month, day)} testId={testId && `${testId}-year`}
          onPick={() => toggle('year')} picking={picking === 'year'} />
      </div>

      {picking && (
        <div className="neon-well mt-2 p-2" role="group" aria-label={`${label}: pick a ${picking}`} data-testid={testId && `${testId}-grid`}>
          {picking === 'month' && (
            <div className="grid grid-cols-4 gap-1">
              {MONTHS.map(m => (
                <Pick key={m.value} chosen={m.value === month} onClick={() => choose(year, m.value, day)}
                  label={format(new Date(2000, m.value - 1, 1), 'MMMM')} testId={testId && `${testId}-pick-month-${m.value}`}>
                  {m.label}
                </Pick>
              ))}
            </div>
          )}
          {picking === 'day' && (
            <>
              <p className="neon-title mb-1 text-center text-xs font-bold text-mono">{format(d, 'MMMM yyyy').toUpperCase()}</p>
              <div className="grid grid-cols-7 gap-0.5">
                {WEEKDAY_INITIALS.map((w, i) => (
                  <span key={i} className="py-1 text-center text-[10px] text-mono text-[hsl(188_90%_72%)]">{w}</span>
                ))}
                {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}
                {days.map(x => (
                  <Pick key={x.value} chosen={x.value === day} onClick={() => choose(year, month, x.value)}
                    label={format(new Date(year, month - 1, x.value), 'EEEE, MMMM d')} testId={testId && `${testId}-pick-day-${x.value}`}>
                    {x.label}
                  </Pick>
                ))}
              </div>
            </>
          )}
          {picking === 'year' && (
            <div className="grid grid-cols-4 gap-1">
              {years.map(y => (
                <Pick key={y.value} chosen={y.value === year} onClick={() => choose(y.value, month, day)}
                  label={String(y.value)} testId={testId && `${testId}-pick-year-${y.value}`}>
                  {y.label}
                </Pick>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
