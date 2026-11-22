/**
 * For a dialog, sheet or popover opening: focus the panel itself, not its
 * first box. Focusing a text box on a phone brings the keyboard up over the
 * very thing that just opened; you tap into the box you want to change.
 * Focus still lands inside the panel, so the keyboard and screen readers
 * start there. A caller's own handler runs first and can take over.
 */
export function focusPanel(event: Event, own?: (event: Event) => void): void {
  own?.(event);
  if (event.defaultPrevented) return;
  event.preventDefault();
  // The event is fired on the panel itself. Focused a frame later: at the
  // moment it opens the panel isn't ready to hold focus, and nothing took it.
  const panel = (event.target ?? event.currentTarget) as HTMLElement | null;
  if (!panel) return;
  requestAnimationFrame(() => {
    if (panel.isConnected && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  });
}
