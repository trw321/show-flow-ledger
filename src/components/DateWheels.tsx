import { useLayoutEffect, useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { format, getDaysInMonth, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

/** How tall one value is in a wheel's window, in px: the window shows exactly one. */
const ITEM = 44;

interface WheelItem<T> { value: T; label: string }

/**
 * One scroll wheel that shows only the value chosen: swipe it (or scroll,
 * or tap the arrows, or use the arrow keys) and the next one rolls in. The
 * window is one value tall, so the ones either side stay out of sight.
 */
export function Wheel<T extends string | number>({ items, value, onChange, label, testId }: {
  items: WheelItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<number>();
  const index = Math.max(0, items.findIndex(i => i.value === value));

  // Keep the window on the chosen value when it changes from outside: an
  // arrow, a preset, or a shorter month pulling the day back.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / ITEM) !== index) el.scrollTop = index * ITEM;
  }, [index, items.length]);

  // Once a swipe comes to rest, the value under the window is the one chosen.
  const onScroll = () => {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const at = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)));
      if (items[at] && items[at].value !== value) onChange(items[at].value);
    }, 120);
  };

  const step = (by: number) => {
    const at = Math.min(items.length - 1, Math.max(0, index + by));
    if (at !== index) onChange(items[at].value);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <button type="button" onClick={() => step(-1)} aria-label={`${label}: back one`}
        className="flex h-6 w-full items-center justify-center text-[hsl(188_90%_70%)] active:opacity-60">
        <ChevronUp size={16} aria-hidden />
      </button>
      <div
        ref={ref}
        onScroll={onScroll}
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={index}
        aria-valuemin={0}
        aria-valuemax={items.length - 1}
        aria-valuetext={items[index]?.label}
        data-testid={testId}
        onKeyDown={e => {
          if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
        }}
        className="neon-well scrollbar-none w-full snap-y snap-mandatory overflow-y-scroll overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-[hsl(188_90%_70%)]"
        style={{ height: ITEM }}
      >
        {items.map(item => (
          <div key={String(item.value)} className="neon-title flex snap-center items-center justify-center text-lg font-bold text-mono"
            style={{ height: ITEM }}>
            {item.label}
          </div>
        ))}
      </div>
      <button type="button" onClick={() => step(1)} aria-label={`${label}: forward one`}
        className="flex h-6 w-full items-center justify-center text-[hsl(188_90%_70%)] active:opacity-60">
        <ChevronDown size={16} aria-hidden />
      </button>
    </div>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: format(new Date(2000, i, 1), 'MMM').toUpperCase() }));

/**
 * A whole date on three wheels, month, day and year, each showing only what's
 * chosen. The value is YYYY-MM-DD. A day past the end of a shorter month
 * comes back to its last day.
 */
export default function DateWheels({ label, value, onChange, firstYear, lastYear, testId }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  firstYear: number;
  lastYear: number;
  testId?: string;
}) {
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
  return (
    <div data-testid={testId}>
      <p className="font-8bit mb-1 text-[8px] uppercase text-[hsl(312_95%_75%)]">{label}</p>
      <div className={cn('flex gap-2')}>
        <Wheel label={`${label} month`} items={MONTHS} value={month} onChange={m => set(year, m, day)} testId={testId && `${testId}-month`} />
        <Wheel label={`${label} day`} items={days} value={day} onChange={dd => set(year, month, dd)} testId={testId && `${testId}-day`} />
        <Wheel label={`${label} year`} items={years} value={year} onChange={y => set(y, month, day)} testId={testId && `${testId}-year`} />
      </div>
    </div>
  );
}
