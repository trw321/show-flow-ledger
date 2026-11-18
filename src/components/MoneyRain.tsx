import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ── Money rain ───────────────────────────────────────────────────────────────

interface MoneyDrop {
  id: number;
  emoji: string;
  left: number;
  delay: number;
  duration: number;
  size: number;
  /** Sideways drift as it falls, in vw. */
  drift: number;
  spin: number;
}

/**
 * Money falling over the whole screen. `active` going true starts a shower;
 * `burst` starts one every time it changes, so the same thing opened twice
 * rains twice.
 */
export default function MoneyRain({ active, party, burst }: {
  active?: boolean;
  /** The 6th and 7th days: much more of it, everywhere, and a party. */
  party?: boolean;
  burst?: number;
}) {
  const [drops, setDrops] = useState<MoneyDrop[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    if (!active && !burst) return;
    const emojis = party ? ['💰', '💵', '🤑', '🎉', '💸', '🥳', '✨', '💲'] : ['💰', '💵', '💴'];
    const count = party ? 90 : 18;
    const newDrops: MoneyDrop[] = Array.from({ length: count }, (_, i) => ({
      id: counterRef.current++,
      emoji: emojis[i % emojis.length],
      left: Math.random() * 100,
      delay: Math.random() * (party ? 1.6 : 0.6),
      duration: party ? 1.4 + Math.random() * 1.6 : 0.8 + Math.random() * 0.6,
      size: party ? 18 + Math.random() * 26 : 16 + Math.random() * 14,
      drift: party ? (Math.random() - 0.5) * 30 : 0,
      spin: (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 540),
    }));
    setDrops(newDrops);
    const t = setTimeout(() => setDrops([]), party ? 3600 : 2000);
    return () => clearTimeout(t);
  }, [active, party, burst]);

  if (drops.length === 0) return null;

  // Rendered into the body rather than the page: the money falls over the
  // whole screen, and a wrapper with overflow hidden cannot cut it off.
  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden" aria-hidden>
      {drops.map(d => (
        <span
          key={d.id}
          style={{
            position: 'absolute',
            left: `${d.left}%`,
            top: '-48px',
            fontSize: `${d.size}px`,
            ['--drift' as string]: `${d.drift}vw`,
            ['--spin' as string]: `${d.spin}deg`,
            animation: `moneyFall ${d.duration}s ease-in ${d.delay}s forwards`,
          }}
        >
          {d.emoji}
        </span>
      ))}
      <style>{`
        @keyframes moneyFall {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--drift, 0), 110vh) rotate(var(--spin, 180deg)); opacity: 0.3; }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="moneyFall"] { animation-duration: 0.01s !important; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
