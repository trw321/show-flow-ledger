import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
        {/* Any to-do tapped goes to its shift, so the sheet gets out of the way. */}
        <div className="mt-4 [&>*:last-child]:mb-0" onClick={e => { if ((e.target as HTMLElement).closest('button')) setOpen(false); }}>
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
