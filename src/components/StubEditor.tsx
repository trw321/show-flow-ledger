import { useCallback, useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Crop, RectangleHorizontal, Undo2, Check, X, ZoomIn, ZoomOut, Move, Maximize } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Crop and black out a pay stub before it leaves the phone.
 *
 * A stub has a member number, an address, sometimes the last four of a social
 * on it, and it is about to be sent to object storage and read by a vision
 * model. Blacking out happens here, on the pixels, before any of that — the
 * redacted areas are painted into the image itself, so what gets uploaded does
 * not contain them in the first place. This is not an overlay that could be
 * peeled off later.
 *
 * It takes the whole screen: inside the pop-up it opened from, a stub was too
 * small to put a bar on one line of it, and zoomed in it could not be moved up
 * or down. Zoom and movement are its own — pinch, or the buttons; drag in Move
 * — rather than the browser's scrolling, which a drawing canvas fights with.
 */

interface Rect { x: number; y: number; w: number; h: number }
interface Point { x: number; y: number }
type Tool = 'crop' | 'redact' | 'pan';
/** What undo goes back to. */
interface Snapshot { redactions: Rect[]; crop: Rect | null }

/** How far in you can go. Six times puts a bar on one line of small print. */
const MAX_ZOOM = 6;
/** Movement under this many screen pixels is a tap, not a drag. */
const TAP_SLOP = 8;

interface Props {
  /** The picked file, as a data URL. */
  source: string;
  onCancel: () => void;
  /** The edited image, as a data URL, ready to upload. */
  onDone: (dataUrl: string) => void;
}

/** Normalise a drag into a rect with positive width and height. */
function normalise(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export default function StubEditor({ source, onCancel, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>('redact');
  const [redactions, setRedactions] = useState<Rect[]>([]);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  const [ready, setReady] = useState(false);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  // The frame the stub is shown in, and where in it the stub sits. Zoom 1 is
  // the whole stub fitted to the frame.
  const [view, setView] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  // Fingers on the frame, and what they are doing.
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; zoom: number; mid: Point; pan: Point } | null>(null);
  const panFrom = useRef<{ at: Point; pan: Point } | null>(null);
  const downAt = useRef<Point | null>(null);

  // Everything is kept in the image's own pixel coordinates, so a redaction
  // lands in the same place whatever size the canvas is drawn at on screen.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setNatural({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      setReady(true);
    };
    img.src = source;
  }, [source]);

  // The frame's size, kept up to date as the phone turns. Measured once the
  // frame is actually on screen: it lives in a portal, which puts it there a
  // moment after this component mounts.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const frameRef = useCallback((el: HTMLDivElement | null) => {
    viewportRef.current = el;
    setFrame(el);
  }, []);
  useEffect(() => {
    if (!frame) return;
    const measure = () => setView({ w: frame.clientWidth, h: frame.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);

  const fit = view.w > 0 && view.h > 0 ? Math.min(view.w / natural.w, view.h / natural.h) : 0;
  const baseW = natural.w * fit;
  const baseH = natural.h * fit;

  /** Keeps the stub on screen: centred when smaller than the frame, never pulled past its edges when bigger. */
  const clampPan = (p: Point, z: number): Point => {
    const w = baseW * z;
    const h = baseH * z;
    return {
      x: w <= view.w ? (view.w - w) / 2 : clamp(p.x, view.w - w, 0),
      y: h <= view.h ? (view.h - h) / 2 : clamp(p.y, view.h - h, 0),
    };
  };

  // Re-centre whenever the frame or the picture changes size.
  useEffect(() => {
    setPan(p => clampPan(p, zoom));
    // clampPan reads the sizes listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.w, view.h, baseW, baseH]);

  /** Zoom, keeping the point under (cx, cy) — in frame pixels — where it is. */
  const zoomAt = (next: number, cx: number, cy: number) => {
    const z = clamp(next, 1, MAX_ZOOM);
    const ix = (cx - pan.x) / zoom;
    const iy = (cy - pan.y) / zoom;
    setZoom(z);
    setPan(clampPan({ x: cx - ix * z, y: cy - iy * z }, z));
  };
  const zoomBy = (factor: number) => zoomAt(zoom * factor, view.w / 2, view.h / 2);
  const fitAll = () => { setZoom(1); setPan(clampPan({ x: 0, y: 0 }, 1)); };

  const local = (p: Point): Point => {
    const box = viewportRef.current?.getBoundingClientRect();
    return box ? { x: p.x - box.left, y: p.y - box.top } : p;
  };

  const toImageSpace = (clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return {
      x: ((clientX - box.left) / box.width) * natural.w,
      y: ((clientY - box.top) / box.height) * natural.h,
    };
  };

  // Redraw on every change: the image, the blacked-out areas, and whatever is
  // being dragged right now.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !ready) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0);

    ctx.fillStyle = '#000';
    for (const r of redactions) ctx.fillRect(r.x, r.y, r.w, r.h);

    const scale = img.naturalWidth / 800;
    const line = Math.max(2, 2 * scale);

    if (crop) {
      // Dim everything outside the keep area so the crop reads as a cut.
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, canvas.width, crop.y);
      ctx.fillRect(0, crop.y + crop.h, canvas.width, canvas.height - crop.y - crop.h);
      ctx.fillRect(0, crop.y, crop.x, crop.h);
      ctx.fillRect(crop.x + crop.w, crop.y, canvas.width - crop.x - crop.w, crop.h);
      ctx.strokeStyle = '#6BFFA8';
      ctx.lineWidth = line;
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
    }

    if (drag) {
      const r = normalise(drag.from, drag.to);
      ctx.fillStyle = tool === 'redact' ? 'rgba(0,0,0,0.75)' : 'rgba(107,255,168,0.18)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = tool === 'redact' ? '#000' : '#6BFFA8';
      ctx.lineWidth = line;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }, [ready, redactions, crop, drag, tool]);

  /** Remember how things are, so the next change can be undone. */
  const remember = () => setHistory(h => [...h, { redactions, crop }]);

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setRedactions(last.redactions);
    setCrop(last.crop);
    setHistory(history.slice(0, -1));
  };

  // ── Fingers ───────────────────────────────────────────────────────────────
  // One finger draws (or moves, in Move). Two fingers always pinch and move,
  // whatever the tool, and drop anything half-drawn.

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Keeps the finger's moves coming here even when it slides off the frame.
    try { viewportRef.current?.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.max(1, distance(a, b)), zoom, mid: local(midpoint(a, b)), pan };
      setDrag(null);
      panFrom.current = null;
      return;
    }
    if (pointers.current.size > 2) return;
    downAt.current = { x: e.clientX, y: e.clientY };
    if (tool === 'pan') {
      panFrom.current = { at: { x: e.clientX, y: e.clientY }, pan };
    } else {
      const p = toImageSpace(e.clientX, e.clientY);
      setDrag({ from: p, to: p });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current) {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const start = pinch.current;
      const z = clamp(start.zoom * (distance(a, b) / start.dist), 1, MAX_ZOOM);
      const mid = local(midpoint(a, b));
      const ix = (start.mid.x - start.pan.x) / start.zoom;
      const iy = (start.mid.y - start.pan.y) / start.zoom;
      setZoom(z);
      setPan(clampPan({ x: mid.x - ix * z, y: mid.y - iy * z }, z));
      return;
    }
    if (panFrom.current) {
      const from = panFrom.current;
      setPan(clampPan({ x: from.pan.x + (e.clientX - from.at.x), y: from.pan.y + (e.clientY - from.at.y) }, zoom));
      return;
    }
    if (drag) setDrag({ from: drag.from, to: toImageSpace(e.clientX, e.clientY) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      // The pinch is over once one finger lifts; the other one does not draw.
      if (pointers.current.size === 0) pinch.current = null;
      return;
    }
    if (panFrom.current) { panFrom.current = null; return; }
    if (!drag) return;
    const tapped = downAt.current && Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) < TAP_SLOP;
    const r = normalise(drag.from, drag.to);
    setDrag(null);
    if (tapped) {
      // A tap on a black bar takes it off again.
      if (tool === 'redact') {
        const p = toImageSpace(e.clientX, e.clientY);
        const hit = redactions.map((bar, i) => (inside(p, bar) ? i : -1)).filter(i => i >= 0).pop();
        if (hit !== undefined) {
          remember();
          setRedactions(prev => prev.filter((_, i) => i !== hit));
        }
      }
      return;
    }
    if (r.w < 4 || r.h < 4) return;
    remember();
    if (tool === 'redact') setRedactions(prev => [...prev, r]);
    else setCrop(r);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const p = local({ x: e.clientX, y: e.clientY });
    zoomAt(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y);
  };

  /**
   * Flatten to the image that gets uploaded: the blacked-out areas painted in,
   * cropped to the keep area, with no selection chrome on it.
   */
  const apply = () => {
    const img = imageRef.current;
    if (!img) return;
    const area = crop ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(area.w));
    out.height = Math.max(1, Math.round(area.h));
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, -area.x, -area.y);
    ctx.fillStyle = '#000';
    for (const r of redactions) ctx.fillRect(r.x - area.x, r.y - area.y, r.w, r.h);
    onDone(out.toDataURL('image/jpeg', 0.85));
  };

  const hasEdits = redactions.length > 0 || crop !== null;

  return (
    // Its own layer over whatever opened it, so it can have the whole screen.
    <DialogPrimitive.Root open onOpenChange={open => { if (!open) onCancel(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/90" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={e => e.preventDefault()}
          className="fixed inset-0 z-[60] flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <button type="button" onClick={onCancel} className="pixel-button pick-off flex items-center gap-1 px-3 py-1.5 text-xs font-bold">
              <X size={13} /> Cancel
            </button>
            <DialogPrimitive.Title className="text-xs text-mono uppercase tracking-widest text-muted-foreground">
              Black out &amp; crop
            </DialogPrimitive.Title>
            <button type="button" onClick={apply} disabled={!ready} className="pixel-button pick-on flex items-center gap-1 px-3 py-1.5 text-xs font-bold disabled:opacity-40">
              <Check size={13} /> {hasEdits ? 'Use edited' : 'Use as is'}
            </button>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-2">
            {([
              { id: 'redact' as const, label: 'Black bar', icon: RectangleHorizontal },
              { id: 'crop' as const, label: 'Crop', icon: Crop },
              { id: 'pan' as const, label: 'Move', icon: Move },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tool === id}
                onClick={() => setTool(id)}
                className={cn(
                  'pixel-button flex flex-1 items-center justify-center gap-1 py-2 text-[11px] font-bold uppercase tracking-wider',
                  tool === id ? 'pick-on' : 'pick-off',
                )}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
            <button
              type="button"
              onClick={undo}
              disabled={history.length === 0}
              className="pixel-button pick-off flex items-center gap-1 px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-30"
            >
              <Undo2 size={13} /> Undo
            </button>
          </div>

          {/* The stub. Every touch on it is handled here — the browser is
              told not to scroll or zoom the page underneath. */}
          <div
            ref={frameRef}
            data-testid="stub-frame"
            className={cn('relative flex-1 overflow-hidden touch-none select-none bg-black', tool === 'pan' ? 'cursor-grab' : 'cursor-crosshair')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            <div
              className="absolute left-0 top-0"
              style={{ width: baseW, height: baseH, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
            >
              <canvas ref={canvasRef} className="block h-full w-full" />
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 pt-2">
            <button type="button" onClick={() => zoomBy(1 / 1.5)} disabled={zoom <= 1} aria-label="Zoom out"
              className="pixel-button pick-off h-9 w-10 disabled:opacity-30">
              <ZoomOut size={15} className="mx-auto" />
            </button>
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.1}
              value={zoom}
              onChange={e => zoomAt(Number(e.target.value), view.w / 2, view.h / 2)}
              aria-label="Zoom"
              className="flex-1 accent-primary"
            />
            <button type="button" onClick={() => zoomBy(1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in"
              className="pixel-button pick-off h-9 w-10 disabled:opacity-30">
              <ZoomIn size={15} className="mx-auto" />
            </button>
            <button type="button" onClick={fitAll} disabled={zoom === 1} aria-label="Show the whole stub"
              className="pixel-button pick-off h-9 w-10 disabled:opacity-30">
              <Maximize size={15} className="mx-auto" />
            </button>
          </div>
          <p className="px-3 pb-2 pt-1.5 text-[11px] text-muted-foreground">
            {tool === 'redact'
              ? `Drag over anything private. Tap a bar to take it off. Pinch or + to zoom, two fingers or Move to get around.${redactions.length ? ` · ${redactions.length} bar${redactions.length === 1 ? '' : 's'}` : ''}`
              : tool === 'crop'
                ? 'Drag around the part worth keeping.'
                : 'Drag to move around the stub. Pinch to zoom.'}
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
