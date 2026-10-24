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
}

export default function MoneyRain({ active }: { active: boolean }) {
  const [drops, setDrops] = useState<MoneyDrop[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const emojis = ['💰', '💵', '💴'];
    const newDrops: MoneyDrop[] = Array.from({ length: 18 }, (_, i) => ({
      id: counterRef.current++,
      emoji: emojis[i % emojis.length],
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 0.8 + Math.random() * 0.6,
      size: 16 + Math.random() * 14,
    }));
    setDrops(newDrops);
    const t = setTimeout(() => setDrops([]), 2000);
    return () => clearTimeout(t);
  }, [active]);

  if (drops.length === 0) return null;

  // Rendered into the body rather than the page: the money falls over the
  // whole screen, and a wrapper with overflow hidden cannot cut it off.
  return createPortal(
    <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
      {drops.map(d => (
        <span
          key={d.id}
          style={{
            position: 'absolute',
            left: `${d.left}%`,
            top: '-40px',
            fontSize: `${d.size}px`,
            animation: `moneyFall ${d.duration}s ease-in ${d.delay}s forwards`,
          }}
        >
          {d.emoji}
        </span>
      ))}
      <style>{`
        @keyframes moneyFall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(${Math.random() > 0.5 ? '' : '-'}${Math.floor(Math.random() * 360)}deg); opacity: 0.3; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
