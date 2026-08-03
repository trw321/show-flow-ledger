import { useState, useCallback, useRef } from 'react';

interface ConfettiPiece {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  shape: 'circle' | 'square';
  rotate: number;
}

const COLORS = ['#f472b6', '#facc15', '#4ade80', '#60a5fa', '#a78bfa', '#fb923c'];

/**
 * Fires a brief, full-screen confetti burst for milestone moments (shift saved,
 * payment marked paid, employer added). `fire()` triggers it; render `<Burst />`
 * once near the root of whatever's calling `fire()` (it's a fixed overlay, so
 * placement in the tree doesn't matter beyond being mounted).
 */
export function useCelebration() {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);
  const counterRef = useRef(0);

  const fire = useCallback(() => {
    const newPieces: ConfettiPiece[] = Array.from({ length: 28 }, () => ({
      id: counterRef.current++,
      left: Math.random() * 100,
      delay: Math.random() * 0.15,
      duration: 0.9 + Math.random() * 0.6,
      size: 6 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: Math.random() > 0.5 ? 'circle' : 'square',
      rotate: Math.random() * 360,
    }));
    setPieces(newPieces);
    setTimeout(() => setPieces([]), 1700);
  }, []);

  const Burst = useCallback(() => {
    if (pieces.length === 0) return null;
    return (
      <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
        {pieces.map(p => (
          <span
            key={p.id}
            style={{
              position: 'absolute',
              left: `${p.left}%`,
              top: '35%',
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: p.shape === 'circle' ? '50%' : '2px',
              animation: `celebrate-fall ${p.duration}s ease-in ${p.delay}s forwards`,
              transform: `rotate(${p.rotate}deg)`,
            }}
          />
        ))}
        <style>{`
          @keyframes celebrate-fall {
            0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
            100% { transform: translateY(70vh) rotate(720deg); opacity: 0; }
          }
        `}</style>
      </div>
    );
  }, [pieces]);

  return { fire, Burst };
}
