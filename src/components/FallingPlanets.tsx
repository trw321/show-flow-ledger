import { useMemo } from 'react';

const PLANET_EMOJIS = ['🪐', '🌍', '🌎', '🌏'];

interface Planet {
  id: number;
  emoji: string;
  left: number;
  size: number;
  duration: number;
  delay: number;
  spin: number;
}

/** Ambient, continuously-looping planets drifting down behind page content. */
export default function FallingPlanets({ count = 7 }: { count?: number }) {
  const planets = useMemo<Planet[]>(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    emoji: PLANET_EMOJIS[i % PLANET_EMOJIS.length],
    left: Math.random() * 100,
    size: 14 + Math.random() * 20,
    duration: 22 + Math.random() * 18,
    delay: Math.random() * -30,
    spin: Math.random() > 0.5 ? 1 : -1,
  })), [count]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10" aria-hidden="true">
      {planets.map(p => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            left: `${p.left}%`,
            top: '-10%',
            fontSize: `${p.size}px`,
            opacity: 0.35,
            animation: `planetFall ${p.duration}s linear ${p.delay}s infinite`,
            // @ts-expect-error custom property read by the keyframe below
            '--spin': p.spin,
          }}
        >
          {p.emoji}
        </span>
      ))}
      <style>{`
        @keyframes planetFall {
          0%   { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(130vh) rotate(calc(var(--spin) * 240deg)); }
        }
      `}</style>
    </div>
  );
}
