import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

const ITEM_W = 116;

export interface ReelItem {
  key: string;
  label: string;
}

export interface ReelLevel {
  items: ReelItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

function Reel({ items, activeKey, onChange }: ReelLevel) {
  const n = items.length;
  const activeIndex = Math.max(0, items.findIndex(i => i.key === activeKey));

  const [pos, setPos] = useState(activeIndex);
  const [animate, setAnimate] = useState(false);
  const posRef = useRef(pos);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startPosRef = useRef(0);

  useEffect(() => { posRef.current = pos; }, [pos]);

  // Resync when the active item changes from outside (e.g. a "Today" button)
  // while this reel isn't mid-drag.
  useEffect(() => {
    if (draggingRef.current) return;
    setAnimate(true);
    setPos(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, n]);

  function shortestOffset(i: number, p: number) {
    let raw = ((i - p) % n + n) % n;
    if (raw > n / 2) raw -= n;
    return raw;
  }

  function handleDown(e: React.PointerEvent) {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startPosRef.current = posRef.current;
    setAnimate(false);
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function handleMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const dx = e.clientX - startXRef.current;
    setPos(startPosRef.current - dx / ITEM_W);
  }
  function handleUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const idx = ((Math.round(posRef.current) % n) + n) % n;
    setAnimate(true);
    setPos(Math.round(posRef.current));
    const key = items[idx].key;
    if (key !== activeKey) onChange(key);
  }

  const roundedIdx = ((Math.round(pos) % n) + n) % n;

  return (
    <div
      className="relative h-9 rounded-lg bg-secondary/40 overflow-hidden select-none cursor-grab active:cursor-grabbing touch-none"
      style={{ width: ITEM_W }}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      {items.map((item, i) => {
        const off = shortestOffset(i, pos);
        if (Math.abs(off) > 1.6) return null;
        return (
          <div
            key={item.key}
            className={cn(
              'absolute inset-y-0 left-1/2 flex items-center justify-center text-[11.5px] font-mono tracking-wide whitespace-nowrap',
              i === roundedIdx ? 'text-foreground font-semibold' : 'text-muted-foreground/60'
            )}
            style={{
              width: ITEM_W,
              marginLeft: -ITEM_W / 2,
              transform: `translateX(${off * ITEM_W}px)`,
              transition: animate ? 'transform .5s cubic-bezier(.34,1.56,.64,1)' : 'none',
            }}
          >
            {item.label}
          </div>
        );
      })}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[70%] -translate-x-1/2 border-x border-primary/40" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-secondary/70 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-secondary/70 to-transparent" />
    </div>
  );
}

/**
 * A small "cryptex" picker: N stacked reels on a shared axle, each dragged
 * left/right independently and snapping to the nearest item on release.
 * `levels[0]` is the outer/primary reel, subsequent levels are nested
 * sub-pickers (their `items` can depend on the level above's `activeKey`).
 */
export default function CryptexReel({ levels, className }: { levels: ReelLevel[]; className?: string }) {
  return (
    <div className={cn('inline-flex flex-col gap-1 rounded-xl border border-border bg-card p-1', className)}>
      {levels.map((level, i) => (
        <div key={i} className={i > 0 ? 'border-t border-border pt-1' : undefined}>
          <Reel {...level} />
        </div>
      ))}
    </div>
  );
}
