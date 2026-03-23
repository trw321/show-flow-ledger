import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const EMOJI_SETS = [
  ['🎬', '🎤', '🔊', '🎧', '🎵', '💰', '⚡', '🔥', '✨', '🎸'],
  ['🎪', '🎭', '🎨', '💫', '🌟', '🎯', '🚀', '💎', '🎉', '🎊'],
  ['🎹', '🥁', '🎺', '📡', '🔌', '🎚️', '🎛️', '💡', '🔧', '⭐'],
];

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  rotate: number;
}

function generateEmoji(id: number): FloatingEmoji {
  const set = EMOJI_SETS[Math.floor(Math.random() * EMOJI_SETS.length)];
  return {
    id,
    emoji: set[Math.floor(Math.random() * set.length)],
    x: Math.random() * 100,
    y: -10,
    size: 16 + Math.random() * 18,
    duration: 8 + Math.random() * 12,
    delay: Math.random() * 6,
    drift: (Math.random() - 0.5) * 60,
    rotate: (Math.random() - 0.5) * 360,
  };
}

export default function FloatingEmojis() {
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);

  useEffect(() => {
    // Generate initial batch
    const initial = Array.from({ length: 12 }, (_, i) => ({
      ...generateEmoji(i),
      delay: Math.random() * 8,
    }));
    setEmojis(initial);

    // Continuously add new emojis
    let counter = 12;
    const interval = setInterval(() => {
      setEmojis(prev => {
        const filtered = prev.length > 18 ? prev.slice(-14) : prev;
        return [...filtered, generateEmoji(counter++)];
      });
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-[1] overflow-hidden">
      <AnimatePresence>
        {emojis.map((e) => (
          <motion.div
            key={e.id}
            className="absolute select-none"
            style={{
              left: `${e.x}%`,
              fontSize: e.size,
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
            }}
            initial={{ y: '-5vh', opacity: 0, rotate: 0, x: 0 }}
            animate={{
              y: '110vh',
              opacity: [0, 0.7, 0.7, 0.5, 0],
              rotate: e.rotate,
              x: [0, e.drift, -e.drift * 0.5, e.drift * 0.3],
            }}
            transition={{
              duration: e.duration,
              delay: e.delay,
              ease: 'linear',
              opacity: { duration: e.duration, times: [0, 0.05, 0.7, 0.9, 1] },
              x: { duration: e.duration, ease: 'easeInOut' },
            }}
          >
            {e.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
