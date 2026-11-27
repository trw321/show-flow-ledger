/**
 * The Undo on a message (a toast) has to work while a pop-out is open: most
 * of them come from a shift or a day. An open pop-out turns taps off on the
 * rest of the page, toasts included, and treats a tap outside it as "close
 * me". So toasts take taps anyway (index.css, [data-sonner-toast]), and a tap
 * on one doesn't close the pop-out behind it: pass this as a pop-out's
 * onInteractOutside.
 */
export function keepOpenForToasts<E extends Event>(event: E, own?: (event: E) => void): void {
  const target = event.target as Element | null;
  if (target?.closest?.('[data-sonner-toaster]')) event.preventDefault();
  own?.(event);
}
