import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Crop, Highlighter, Undo2, Check, X, ZoomIn, ZoomOut, Move } from 'lucide-react';
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
 */

interface Rect { x: number; y: number; w: number; h: number }
type Tool = 'crop' | 'redact' | 'pan';

/** How far in you can go. Four times is enough to put a marker on one line. */
const MAX_ZOOM = 4;

interface Props {
  /** The picked file, as a data URL. */
  source: string;
  onCancel: () => void;
  /** The edited image, as a data URL, ready to upload. */
  onDone: (dataUrl: string) => void;
}

/** Normalise a drag into a rect with positive width and height. */
function normalise(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export default function StubEditor({ source, onCancel, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>('redact');
  const [redactions, setRedactions] = useState<Rect[]>([]);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  const [ready, setReady] = useState(false);
  // Drawn bigger than the frame and scrolled, rather than scaled in place:
  // the canvas keeps its own pixel size, so a mark still lands where it was
  // put, and panning is the browser's own scrolling.
  const [zoom, setZoom] = useState(1);

  // Everything is kept in the image's own pixel coordinates, so a redaction
  // lands in the same place whatever size the canvas is drawn at on screen.
  useEffect(() => {
    const img = new Image();
    img.onload = () => { imageRef.current = img; setReady(true); };
    img.src = source;
  }, [source]);

  const toImageSpace = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return {
      x: ((clientX - box.left) / box.width) * img.naturalWidth,
      y: ((clientY - box.top) / box.height) * img.naturalHeight,
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

  const startDrag = (clientX: number, clientY: number) => {
    const p = toImageSpace(clientX, clientY);
    setDrag({ from: p, to: p });
  };
  const moveDrag = (clientX: number, clientY: number) => {
    if (!drag) return;
    setDrag({ from: drag.from, to: toImageSpace(clientX, clientY) });
  };
  const endDrag = () => {
    if (!drag) return;
    const r = normalise(drag.from, drag.to);
    setDrag(null);
    // A tap rather than a drag — ignore it, nothing was selected.
    if (r.w < 6 || r.h < 6) return;
    if (tool === 'redact') setRedactions(prev => [...prev, r]);
    else setCrop(r);
  };

  const undo = () => {
    if (tool === 'crop' && crop) { setCrop(null); return; }
    if (redactions.length === 0 && crop) { setCrop(null); return; }
    setRedactions(prev => prev.slice(0, -1));
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {([
          { id: 'redact' as const, label: 'Mark', icon: Highlighter },
          { id: 'crop' as const, label: 'Crop', icon: Crop },
          { id: 'pan' as const, label: 'Move', icon: Move },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tool === id}
            onClick={() => setTool(id)}
            className={cn(
              'pixel-button flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-bold uppercase tracking-wider',
              tool === id ? 'bg-primary/20 border-primary text-primary' : 'bg-card text-muted-foreground',
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
        <button
          type="button"
          onClick={undo}
          disabled={!hasEdits}
          aria-label="Undo the last change"
          className="pixel-button px-3 py-2 bg-card text-muted-foreground disabled:opacity-30"
        >
          <Undo2 size={13} />
        </button>
      </div>

      {/* Zoom first, then mark: at phone width a whole stub is too small to
          put a marker on one line of it. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setZoom(z => Math.max(1, Math.round((z - 0.5) * 2) / 2))}
          disabled={zoom <= 1}
          aria-label="Zoom out"
          className="pixel-button h-8 w-9 bg-card text-muted-foreground disabled:opacity-30"
        >
          <ZoomOut size={14} className="mx-auto" />
        </button>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.5}
          value={zoom}
          onChange={e => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="flex-1 accent-primary"
        />
        <button
          type="button"
          onClick={() => setZoom(z => Math.min(MAX_ZOOM, Math.round((z + 0.5) * 2) / 2))}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className="pixel-button h-8 w-9 bg-card text-muted-foreground disabled:opacity-30"
        >
          <ZoomIn size={14} className="mx-auto" />
        </button>
        <span className="w-10 text-right text-[11px] text-mono text-muted-foreground">{zoom}x</span>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {tool === 'redact'
          ? 'Zoom in, then drag over anything that should not leave your phone — a member number, an address. It is painted into the image, not laid over it.'
          : tool === 'crop'
            ? 'Drag the part of the stub worth keeping.'
            : 'Drag to move around the stub. Switch back to Mark or Crop to draw.'}
      </p>

      {/* The frame scrolls; the canvas inside it is as wide as the zoom says.
          In Move mode the canvas stops swallowing touches so the frame can be
          dragged around in the ordinary way. */}
      <div className="max-h-[55vh] overflow-auto border border-border bg-secondary/20">
        <canvas
          ref={canvasRef}
          style={{ width: zoom * 100 + '%', maxWidth: 'none' }}
          className={cn(
            'h-auto block',
            tool === 'pan' ? 'touch-auto cursor-grab' : 'touch-none cursor-crosshair',
          )}
          onPointerDown={e => {
            if (tool === 'pan') return;
            (e.target as Element).setPointerCapture(e.pointerId);
            startDrag(e.clientX, e.clientY);
          }}
          onPointerMove={e => { if (tool !== 'pan') moveDrag(e.clientX, e.clientY); }}
          onPointerUp={() => { if (tool !== 'pan') endDrag(); }}
          onPointerCancel={() => { if (tool !== 'pan') endDrag(); }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5">
          <X size={13} /> Cancel
        </Button>
        <Button size="sm" onClick={apply} disabled={!ready} className="gap-1.5">
          <Check size={13} /> {hasEdits ? 'Use edited' : 'Use as is'}
        </Button>
      </div>
    </div>
  );
}
