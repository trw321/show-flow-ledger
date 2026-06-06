import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

type VortexPhase = 'idle' | 'pulling' | 'vortex' | 'flash' | 'settling';

interface Props {
  phase: VortexPhase;
  className?: string;
}

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
}

interface Particle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  alpha: number;
}

export default function VortexCanvas({ phase, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<VortexPhase>(phase);
  const rafRef = useRef<number>(0);
  const flashAlphaRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
    if (phase === 'flash') flashAlphaRef.current = 1;
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reduced motion: skip animation entirely, draw static ring
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowPower = (navigator.hardwareConcurrency ?? 4) <= 2;
    const starCount = lowPower ? 40 : 80;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        canvas.width = entry.contentRect.width;
        canvas.height = entry.contentRect.height;
      }
    });
    ro.observe(canvas);

    // Init stars
    const stars: Star[] = Array.from({ length: starCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      size: Math.random() * 1.2 + 0.3,
      alpha: Math.random() * 0.5 + 0.1,
    }));

    // Init spiral particles
    const particles: Particle[] = Array.from({ length: lowPower ? 24 : 48 }, (_, i) => ({
      angle: (i / 48) * Math.PI * 2,
      radius: Math.random() * 60 + 20,
      speed: Math.random() * 0.015 + 0.008,
      size: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.6 + 0.2,
    }));

    if (prefersReduced) {
      // Static leko ring only
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawLekoRing(ctx, cx, cy, 48, 0.18);
      return () => ro.disconnect();
    }

    let t = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const currentPhase = phaseRef.current;

      ctx.clearRect(0, 0, w, h);

      // Background gradient
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
      bg.addColorStop(0, 'rgba(20, 14, 8, 0.95)');
      bg.addColorStop(1, 'rgba(8, 6, 4, 0.98)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Stars
      for (const star of stars) {
        if (currentPhase === 'vortex') {
          // Pull toward center
          const dx = cx - star.x;
          const dy = cy - star.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          star.vx += (dx / dist) * 0.08;
          star.vy += (dy / dist) * 0.08;
          const speed = Math.sqrt(star.vx * star.vx + star.vy * star.vy);
          if (speed > 4) { star.vx = (star.vx / speed) * 4; star.vy = (star.vy / speed) * 4; }
          if (dist < 8) {
            star.x = Math.random() * w;
            star.y = Math.random() * h;
            star.vx = (Math.random() - 0.5) * 0.15;
            star.vy = (Math.random() - 0.5) * 0.15;
          }
        } else if (currentPhase === 'pulling') {
          const dx = cx - star.x;
          const dy = cy - star.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          star.vx += (dx / dist) * 0.015;
          star.vy += (dy / dist) * 0.015;
        } else {
          // Idle drift — dampen toward slow wander
          star.vx *= 0.98;
          star.vy *= 0.98;
          star.vx += (Math.random() - 0.5) * 0.02;
          star.vy += (Math.random() - 0.5) * 0.02;
        }

        star.x += star.vx;
        star.y += star.vy;
        if (star.x < 0) star.x = w;
        if (star.x > w) star.x = 0;
        if (star.y < 0) star.y = h;
        if (star.y > h) star.y = 0;

        const twinkle = 0.7 + 0.3 * Math.sin(t * 0.04 + star.x);
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 220, 160, ${star.alpha * twinkle})`;
        ctx.fill();
      }

      // Leko lens ring (always present)
      const ringAlpha = currentPhase === 'vortex' ? 0.35 : currentPhase === 'pulling' ? 0.25 : 0.18;
      drawLekoRing(ctx, cx, cy, 48, ringAlpha);

      // Spiral particles (vortex + settling)
      if (currentPhase === 'vortex' || currentPhase === 'settling' || currentPhase === 'flash') {
        const intensity = currentPhase === 'vortex' ? 1 : currentPhase === 'flash' ? 0.8 : 0.4;
        for (const p of particles) {
          p.angle += p.speed * (currentPhase === 'settling' ? 0.4 : 1);
          const decay = currentPhase === 'settling' ? 0.995 : 1;
          p.radius = Math.max(4, p.radius * decay);

          const px = cx + Math.cos(p.angle) * p.radius;
          const py = cy + Math.sin(p.angle) * p.radius * 0.6;

          ctx.beginPath();
          ctx.arc(px, py, p.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 180, 60, ${p.alpha * intensity})`;
          ctx.fill();
        }

        // Accretion glow
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 70);
        glow.addColorStop(0, `rgba(255, 160, 40, ${0.12 * intensity})`);
        glow.addColorStop(0.5, `rgba(255, 120, 20, ${0.06 * intensity})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
      }

      // Flash burst
      if (flashAlphaRef.current > 0) {
        const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
        flash.addColorStop(0, `rgba(255, 240, 200, ${flashAlphaRef.current * 0.9})`);
        flash.addColorStop(0.3, `rgba(255, 180, 60, ${flashAlphaRef.current * 0.4})`);
        flash.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = flash;
        ctx.fillRect(0, 0, w, h);
        flashAlphaRef.current = Math.max(0, flashAlphaRef.current - 0.06);
      }

      t++;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={cn('block', className)}
      aria-hidden="true"
    />
  );
}

function drawLekoRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  alpha: number,
) {
  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 180, 60, ${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner rings (concentric lens effect)
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1 - i * 0.18), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 200, 100, ${alpha * (1 - i * 0.25)})`;
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 220, 140, ${alpha * 1.5})`;
  ctx.fill();
}
