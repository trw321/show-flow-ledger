import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ── Night burst ──────────────────────────────────────────────────────────────
//
// Night premium: moons, z's, stars and money pop out of the night banner and
// fall away down the screen. The money rain's cousin, for the hours that pay
// double after midnight.

const NIGHT_EMOJIS = ['🌙', '💤', '💰', '⭐', '😴', '💵', '🌛', '✨', '🦉', '💸', '🌜', '🌟', '🛌', '🤑', '🌃', '💤'];

interface Bit {
  id: number;
  emoji: string;
  /** Sideways, in px, from where it popped to where it lands. */
  dx: number;
  /** How high it flies before it falls, in px. */
  up: number;
  size: number;
  delay: number;
  duration: number;
  spin: number;
}

/**
 * One pop each time `burst` goes up, centred on `from`. Nothing for anyone
 * who has asked their phone for less motion.
 */
export default function NightBurst({ from, burst }: { from: HTMLElement | null; burst: number }) {
  const [bits, setBits] = useState<Bit[]>([]);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const counter = useRef(0);

  useEffect(() => {
    if (!burst || !from) return;
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    } catch { /* no matchMedia: animate */ }
    const r = from.getBoundingClientRect();
    setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setBits(Array.from({ length: 34 }, (_, i) => {
      const angle = Math.random() * Math.PI; // the upper half: out and up
      const speed = 0.4 + Math.random() * 0.6;
      return {
        id: counter.current++,
        emoji: NIGHT_EMOJIS[i % NIGHT_EMOJIS.length],
        dx: Math.cos(angle) * speed * 220,
        up: 60 + Math.sin(angle) * speed * 180,
        size: 16 + Math.random() * 18,
        delay: Math.random() * 0.25,
        duration: 1.6 + Math.random() * 0.9,
        spin: (Math.random() > 0.5 ? 1 : -1) * Math.floor(90 + Math.random() * 360),
      };
    }));
    const t = setTimeout(() => setBits([]), 3000);
    return () => clearTimeout(t);
  }, [burst, from]);

  if (bits.length === 0) return null;

  // Into the body, so a dialog's own overflow can't cut it off.
  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden" aria-hidden data-testid="night-burst">
      {bits.map(b => (
        <span
          key={b.id}
          style={{
            position: 'absolute',
            left: `${origin.x}px`,
            top: `${origin.y}px`,
            fontSize: `${b.size}px`,
            lineHeight: 1,
            marginLeft: `${-b.size / 2}px`,
            marginTop: `${-b.size / 2}px`,
            ['--dx' as string]: `${b.dx}px`,
            ['--up' as string]: `${-b.up}px`,
            ['--spin' as string]: `${b.spin}deg`,
            animation: `nightBurst ${b.duration}s linear ${b.delay}s both`,
          }}
        >
          {b.emoji}
        </span>
      ))}
      <style>{`
        @keyframes nightBurst {
          0%   { transform: translate(0, 0) scale(0.3) rotate(0deg); opacity: 0; animation-timing-function: cubic-bezier(0.2, 0.8, 0.4, 1); }
          8%   { opacity: 1; }
          30%  { transform: translate(calc(var(--dx) * 0.55), var(--up)) scale(1) rotate(calc(var(--spin) * 0.3)); animation-timing-function: cubic-bezier(0.5, 0, 0.9, 0.6); }
          100% { transform: translate(var(--dx), 110vh) scale(0.9) rotate(var(--spin)); opacity: 0.5; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
