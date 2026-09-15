import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

const ROW_HEIGHT = 32;
const VISIBLE_ROWS = 3;

interface Props {
  values: (string | number)[];
  value: string | number;
  onChange: (value: string | number) => void;
  className?: string;
}

// A real scrolling picker — not a stepper. Center row is the selected value;
// rows fade out with distance the way an iOS-style wheel does. Driven by
// native scroll + CSS snap (not custom pointer/drag math) so it behaves
// correctly with touch, trackpad, and mouse wheel alike.
export default function ScrollWheel({ values, value, onChange, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const settling = useRef(false);

  const indexOf = useCallback((v: string | number) => {
    const i = values.findIndex(x => x === v);
    return i === -1 ? 0 : i;
  }, [values]);

  // Keep scroll position in sync when the value changes from outside (e.g.
  // switching which job/field this wheel is bound to).
  useEffect(() => {
    const el = ref.current;
    if (!el || settling.current) return;
    el.scrollTop = indexOf(value) * ROW_HEIGHT;
  }, [value, indexOf]);

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    settling.current = true;
    const idx = Math.round(el.scrollTop / ROW_HEIGHT);
    const clamped = Math.max(0, Math.min(values.length - 1, idx));
    const v = values[clamped];
    if (v !== value) onChange(v);
  };

  const handleScrollEnd = () => { settling.current = false; };

  return (
    <div className={cn('relative', className)} style={{ height: ROW_HEIGHT * VISIBLE_ROWS }}>
      {/* Center-row highlight band */}
      <div
        className="pointer-events-none absolute left-0 right-0 border-y border-primary/40 bg-primary/10 z-10"
        style={{ top: ROW_HEIGHT, height: ROW_HEIGHT }}
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        onTouchEnd={handleScrollEnd}
        onMouseUp={handleScrollEnd}
        className="h-full overflow-y-auto snap-y snap-mandatory scrollbar-none"
        style={{ scrollbarWidth: 'none' }}
      >
        <div style={{ height: ROW_HEIGHT }} />
        {values.map(v => {
          const dist = Math.abs(indexOf(v) - indexOf(value));
          const opacity = dist === 0 ? 1 : dist === 1 ? 0.5 : 0.25;
          return (
            <div
              key={v}
              onClick={() => onChange(v)}
              className="snap-center flex items-center justify-center text-mono cursor-pointer select-none"
              style={{ height: ROW_HEIGHT, opacity }}
            >
              <span className={cn('font-bold', dist === 0 ? 'text-primary text-lg' : 'text-muted-foreground text-sm')}>{v}</span>
            </div>
          );
        })}
        <div style={{ height: ROW_HEIGHT }} />
      </div>
    </div>
  );
}
