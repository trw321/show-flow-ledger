import { useRef, useState, useEffect, useCallback } from 'react';

// 3x3 grid of dots, numbered 0-8
// 0 1 2
// 3 4 5
// 6 7 8

interface Dot {
  x: number;
  y: number;
  index: number;
}

interface Props {
  onComplete: (pattern: number[]) => void;
  onStart?: () => void;
  size?: number;
  disabled?: boolean;
  error?: boolean;
}

const DOT_RADIUS = 10;
const GLOW_RADIUS = 22;
const COLS = 3;
const ROWS = 3;

function getDots(size: number): Dot[] {
  const padding = size * 0.18;
  const step = (size - padding * 2) / (COLS - 1);
  const dots: Dot[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      dots.push({
        x: padding + c * step,
        y: padding + r * step,
        index: r * COLS + c,
      });
    }
  }
  return dots;
}

function getHitDot(dots: Dot[], x: number, y: number): Dot | null {
  for (const dot of dots) {
    const dx = dot.x - x;
    const dy = dot.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < GLOW_RADIUS) return dot;
  }
  return null;
}

export default function PatternLock({ onComplete, onStart, size = 280, disabled = false, error = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pattern, setPattern] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const dots = getDots(size);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    const activeColor = error ? '#ef4444' : '#a78bfa';
    const glowColor = error ? 'rgba(239,68,68,0.25)' : 'rgba(167,139,250,0.25)';
    const lineColor = error ? 'rgba(239,68,68,0.5)' : 'rgba(167,139,250,0.5)';

    // Draw lines between selected dots
    if (pattern.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      const first = dots[pattern[0]];
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pattern.length; i++) {
        const d = dots[pattern[i]];
        ctx.lineTo(d.x, d.y);
      }
      ctx.stroke();
    }

    // Draw line to current mouse position
    if (drawing && mousePos && pattern.length > 0) {
      const last = dots[pattern[pattern.length - 1]];
      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(mousePos.x, mousePos.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw dots
    for (const dot of dots) {
      const isSelected = pattern.includes(dot.index);
      const isLast = pattern[pattern.length - 1] === dot.index;

      // Glow
      if (isSelected) {
        const grad = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, GLOW_RADIUS);
        grad.addColorStop(0, glowColor);
        grad.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, GLOW_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Outer ring (always visible, dim if unselected)
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected ? activeColor : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = isLast ? 2.5 : 1.5;
      ctx.stroke();

      // Inner fill
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, isSelected ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? activeColor : 'rgba(255,255,255,0.2)';
      ctx.fill();
    }
  }, [pattern, drawing, mousePos, dots, size, error]);

  useEffect(() => { draw(); }, [draw]);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = size / rect.width;
    const scaleY = size / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    e.preventDefault();
    const pos = getPos(e);
    const hit = getHitDot(dots, pos.x, pos.y);
    if (hit) {
      setPattern([hit.index]);
      setDrawing(true);
      setMousePos(pos);
      onStart?.();
    }
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing || disabled) return;
    e.preventDefault();
    const pos = getPos(e);
    setMousePos(pos);
    const hit = getHitDot(dots, pos.x, pos.y);
    if (hit && !pattern.includes(hit.index)) {
      setPattern(prev => [...prev, hit.index]);
    }
  };

  const handleEnd = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing || disabled) return;
    e.preventDefault();
    setDrawing(false);
    setMousePos(null);
    if (pattern.length >= 4) {
      onComplete(pattern);
    }
    setPattern([]);
  };

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, touchAction: 'none', cursor: disabled ? 'default' : 'crosshair' }}
      onMouseDown={handleStart}
      onMouseMove={handleMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
    />
  );
}
