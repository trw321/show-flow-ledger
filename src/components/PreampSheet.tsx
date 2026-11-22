import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PREAMP_OPEN_EVENT, setPreampCount } from '@/lib/preamp';

/**
 * Preamp, the list: the to-dos, kept off the top of the calendar so the month
 * comes first. The calendar renders it with the to-dos inside; it tells the
 * header lamp how many there are and opens when the lamp is tapped (or when
 * the calendar is reached from a tap on another page). Tapping a to-do closes
 * it and goes to that shift.
 */
export default function PreampSheet({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => { setPreampCount(count); }, [count]);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(PREAMP_OPEN_EVENT, show);
    return () => window.removeEventListener(PREAMP_OPEN_EVENT, show);
  }, []);

  // Sent here from another page by a tap on the lamp.
  useEffect(() => {
    if ((location.state as { preamp?: boolean } | null)?.preamp) {
      setOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  return (
    <Sheet open={open && count > 0} onOpenChange={setOpen}>
      {/* Nothing focused on opening: the first to-do would wear a focus ring. */}
      <SheetContent side="bottom" onOpenAutoFocus={e => e.preventDefault()} className="max-h-[80vh] overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))]" data-testid="preamp-sheet">
        <SheetHeader className="text-left">
          <SheetTitle>Preamp</SheetTitle>
          <SheetDescription>What needs you before the next show.</SheetDescription>
        </SheetHeader>
        {/* A to-do tapped goes to its shift, so the sheet gets out of the way.
            A card with several opens its list instead, and stays. */}
        <div className="mt-4 [&>*:last-child]:mb-0" onClick={e => { if ((e.target as HTMLElement).closest('[data-preamp-go]')) setOpen(false); }}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export interface PreampItem {
  key: string;
  title: string;
  detail: string;
  /** Extra on the right: an amount, how late. */
  aside?: string;
  open: () => void;
}

/**
 * One kind of to-do in Preamp: a card that says how many and the oldest.
 * With one, tapping it goes straight there. With several, tapping it drops
 * down the list, each one a tap from its shift.
 */
export function PreampGroup({ icon, title, summary, tone, titleTone, items, testId }: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  /** The card's border and fill. */
  tone: string;
  /** The title's colour. */
  titleTone: string;
  items: PreampItem[];
  testId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const single = items.length === 1;
  return (
    <div className="mb-3" data-testid={testId}>
      <button
        type="button"
        data-preamp-go={single ? '' : undefined}
        aria-expanded={single ? undefined : expanded}
        onClick={() => (single ? items[0].open() : setExpanded(x => !x))}
        className={cn('pixel-button w-full flex items-center gap-3 px-3 py-2.5 text-left', tone)}
      >
        {icon}
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-semibold', titleTone)}>{title}</p>
          <p className="text-xs font-body mt-0.5 text-muted-foreground truncate">{summary}</p>
        </div>
        {!single && <ChevronDown size={18} className={cn('shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')} aria-hidden />}
      </button>
      {expanded && !single && (
        <ul className="border border-t-0 border-border bg-background/60" data-testid={testId ? `${testId}-list` : undefined}>
          {items.map(item => (
            <li key={item.key} className="border-t border-border/60 first:border-t-0">
              <button type="button" data-preamp-go="" onClick={item.open}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-secondary/40 active:bg-secondary/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{item.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{item.detail}</p>
                </div>
                {item.aside && <span className="shrink-0 text-xs font-mono text-muted-foreground">{item.aside}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
