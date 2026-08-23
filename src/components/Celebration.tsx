import { useState, useCallback, useRef } from 'react';

interface Glint {
  id: number;
  x: number;
  y: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
}

// The app's own violet/cyan/lime accents (--primary/--accent/--success) —
// not a generic rainbow, so the celebration reads as "this app's lights",
// not confetti.
const GLINT_COLORS = ['#7c5cf0', '#17c5dd', '#c3e619'];

/**
 * Fires a brief, full-screen disco-ball burst for milestone moments (shift
 * saved, payment marked paid, employer added). `fire()` triggers it; render
 * `<Burst />` once near the root of whatever's calling `fire()` (it's a fixed
 * overlay, so placement in the tree doesn't matter beyond being mounted).
 */
export function useCelebration() {
  const [glints, setGlints] = useState<Glint[]>([]);
  const [ballKey, setBallKey] = useState(0);
  const counterRef = useRef(0);

  const fire = useCallback(() => {
    const count = 16;
    const newGlints: Glint[] = Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.3 - 0.15);
      const distance = 50 + Math.random() * 55;
      return {
        id: counterRef.current++,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        delay: Math.random() * 0.2,
        duration: 0.7 + Math.random() * 0.4,
        size: 4 + Math.random() * 5,
        color: GLINT_COLORS[Math.floor(Math.random() * GLINT_COLORS.length)],
      };
    });
    setGlints(newGlints);
    setBallKey(k => k + 1);
    setTimeout(() => setGlints([]), 1600);
  }, []);

  const Burst = useCallback(() => {
    if (glints.length === 0) return null;
    return (
      <div className="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
        <div
          key={ballKey}
          className="absolute left-1/2 top-[30%]"
          style={{ transform: 'translate(-50%, -50%)' }}
        >
          <div className="relative" style={{ animation: 'disco-ball-pop 1.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }}>
            <span
              className="block text-5xl"
              style={{ animation: 'disco-spin 0.9s linear infinite' }}
            >
              🪩
            </span>
            {glints.map(g => (
              <span
                key={g.id}
                className="absolute top-1/2 left-1/2"
                style={{
                  width: g.size,
                  height: g.size,
                  left: `calc(50% + ${g.x}px)`,
                  top: `calc(50% + ${g.y}px)`,
                  backgroundColor: g.color,
                  boxShadow: `0 0 6px 1px ${g.color}`,
                  animation: `disco-glint ${g.duration}s ease-out ${g.delay}s forwards`,
                }}
              />
            ))}
          </div>
        </div>
        <style>{`
          @keyframes disco-ball-pop {
            0%   { transform: scale(0.4) rotate(-15deg); opacity: 0; }
            35%  { transform: scale(1.15) rotate(8deg); opacity: 1; }
            55%  { transform: scale(0.95) rotate(-4deg); opacity: 1; }
            75%  { transform: scale(1) rotate(0deg); opacity: 1; }
            100% { transform: scale(1) rotate(0deg); opacity: 0; }
          }
          @keyframes disco-spin {
            0%   { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes disco-glint {
            0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.2); }
            25%  { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
          }
        `}</style>
      </div>
    );
  }, [glints, ballKey]);

  return { fire, Burst };
}
