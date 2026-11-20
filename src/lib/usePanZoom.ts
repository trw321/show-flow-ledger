import { useCallback, useEffect, useRef, useState } from 'react';

export interface Box { x: number; y: number; width: number; height: number }

/** The box grown on one side to match the screen's shape, so all of it fits, centred. */
export function fitBox(box: Box, aspect: number): Box {
  if (!(aspect > 0)) return box;
  if (box.width / box.height > aspect) {
    const height = box.width / aspect;
    return { x: box.x, y: box.y - (height - box.height) / 2, width: box.width, height };
  }
  const width = box.height * aspect;
  return { x: box.x - (width - box.width) / 2, y: box.y, width, height: box.height };
}

/** The view zoomed by `factor` about a point (in drawing units), within limits. */
export function zoomBox(view: Box, factor: number, cx: number, cy: number, minWidth: number, maxWidth: number): Box {
  const width = Math.min(maxWidth, Math.max(minWidth, view.width / factor));
  const f = view.width / width;
  const height = view.height / f;
  return { x: cx - (cx - view.x) / f, y: cy - (cy - view.y) / f, width, height };
}

/**
 * Drag to move and pinch (or the wheel, or the buttons) to zoom an SVG drawing,
 * starting with all of it fitted to the screen. The drawing takes the touch,
 * so dragging it never scrolls the page. A drag isn't a tap: it doesn't open
 * what it started on.
 */
export function usePanZoom(content: Box) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // The drawing may mount later than this hook (a tab opened), so keep the
  // element in state too and watch it from when it appears.
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const attach = useCallback((el: SVGSVGElement | null) => { svgRef.current = el; setSvgEl(el); }, []);
  const [view, setView] = useState<Box>(content);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);

  const aspect = () => {
    const r = svgRef.current?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r.width / r.height : 0;
  };
  // Whether the last fit was made against the drawing's real size on screen.
  const sized = useRef(false);
  const fit = useCallback(() => {
    const a = aspect();
    sized.current = a > 0;
    setView(fitBox(content, a));
  }, [content]);
  // Fit again whenever what's drawn changes.
  useEffect(() => { fit(); }, [fit]);
  // Measured while hidden (a closed tab) it has no size: fit once it shows.
  // After that a resize keeps where you were, just reshaped to the screen.
  useEffect(() => {
    const el = svgEl;
    if (!el) return;
    sized.current = false;
    if (typeof ResizeObserver === 'undefined') { fit(); return; }
    const ro = new ResizeObserver(() => {
      const a = aspect();
      if (!(a > 0)) return;
      if (!sized.current) { fit(); return; }
      setView(v => {
        const height = v.width / a;
        return Math.abs(height - v.height) < 0.5 ? v : { ...v, y: v.y + (v.height - height) / 2, height };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [svgEl, fit]);

  const toUnits = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: v.x + ((clientX - r.left) / r.width) * v.width, y: v.y + ((clientY - r.top) / r.height) * v.height };
  };
  const limits = () => [content.width / 8, content.width * 2] as const;
  const zoomAt = (factor: number, cx: number, cy: number) => {
    const [min, max] = limits();
    setView(v => zoomBox(v, factor, cx, cy, min, max));
  };
  const zoomCentre = (factor: number) => {
    const v = viewRef.current;
    zoomAt(factor, v.x + v.width / 2, v.y + v.height / 2);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = 0;
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    if (pointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      // Only once it's clearly a drag, so a shaky tap still opens a person.
      if (moved.current > 6) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setView(v => ({ ...v, x: v.x - (dx / r.width) * v.width, y: v.y - (dy / r.height) * v.height }));
      }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) {
        const mid = toUnits((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
        zoomAt(after / before, mid.x, mid.y);
      }
      moved.current += 10;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
  };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const p = toUnits(e.clientX, e.clientY);
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  };
  /** Swallows the click that ends a drag. */
  const onClickCapture = (e: React.MouseEvent) => {
    if (moved.current > 6) { e.stopPropagation(); e.preventDefault(); }
  };

  return {
    svgRef: attach,
    viewBox: `${view.x} ${view.y} ${view.width} ${view.height}`,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onPointerLeave: onPointerUp, onWheel, onClickCapture },
    zoomIn: () => zoomCentre(1.4),
    zoomOut: () => zoomCentre(1 / 1.4),
    fit,
  };
}
