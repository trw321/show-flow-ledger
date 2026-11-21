import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/**
 * The to-dos (hours to log, shifts to check, pay that's late), kept off the
 * top of the calendar so the month comes first. A button floats over the
 * bottom corner with how many there are; tapping it opens them as a sheet,
 * and tapping one closes the sheet and goes to it. Nothing to do, no button.
 */
export default function PreflightButton({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Preflight: ${count} thing${count === 1 ? '' : 's'} to do`}
        data-testid="preflight-button"
        className="pixel-button fixed right-4 z-30 flex h-14 w-14 items-center justify-center border-2 border-primary bg-card/95 text-[28px] leading-none shadow-[0_0_18px_hsl(var(--primary)/0.45)] backdrop-blur bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] md:bottom-6 md:right-6"
      >
        <span aria-hidden>🫡</span>
        <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center bg-warning px-1 font-mono text-[11px] font-bold text-background" aria-hidden>
          {count}
        </span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        {/* Nothing focused on opening: the first to-do would wear a focus ring. */}
        <SheetContent side="bottom" onOpenAutoFocus={e => e.preventDefault()} className="max-h-[80vh] overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2"><span aria-hidden>🫡</span> Preflight</SheetTitle>
            <SheetDescription>What needs you before the next show.</SheetDescription>
          </SheetHeader>
          {/* Any to-do tapped goes to its shift, so the sheet gets out of the way. */}
          <div className="mt-4 [&>*:last-child]:mb-0" onClick={e => { if ((e.target as HTMLElement).closest('button')) setOpen(false); }}>
            {children}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
