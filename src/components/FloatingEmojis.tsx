import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

// Map emojis to routes
const EMOJI_ROUTES: Record<string, string> = {
  '🔧': '/log',
  '💰': '/income',
  '📅': '/calendar',
  '🎬': '/log',
  '🎤': '/log',
  '🔊': '/equipment',
  '🎧': '/equipment',
  '💵': '/income',
  '💎': '/income',
  '📡': '/equipment',
  '🔌': '/equipment',
  '🎚️': '/equipment',
  '🎛️': '/equipment',
  '💡': '/discover',
  '🚀': '/discover',
  '⭐': '/discover',
  '🌟': '/discover',
  '✨': '/discover',
};

const EMOJI_POOL = [
  '🎬', '🎤', '🔊', '🎧', '💰', '⚡', '🔥', '✨',
  '🔧', '💵', '📅', '💎', '🚀', '💡', '📡', '🔌', '⭐',
];

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  rotate: number;
}

function generateEmoji(id: number): FloatingEmoji {
  return {
    id,
    emoji: EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)],
    x: Math.random() * 100,
    size: 18 + Math.random() * 14,
    duration: 12 + Math.random() * 16,
    delay: Math.random() * 4,
    drift: (Math.random() - 0.5) * 50,
    rotate: (Math.random() - 0.5) * 360,
  };
}

export default function FloatingEmojis() {
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const initial = Array.from({ length: 5 }, (_, i) => ({
      ...generateEmoji(i),
      delay: Math.random() * 10,
    }));
    setEmojis(initial);

    let counter = 5;
    const interval = setInterval(() => {
      setEmojis(prev => {
        const filtered = prev.length > 8 ? prev.slice(-6) : prev;
        return [...filtered, generateEmoji(counter++)];
      });
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  const handleTap = (emoji: string) => {
    const route = EMOJI_ROUTES[emoji];
    if (route) navigate(route);
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-[1] overflow-hidden">
      <AnimatePresence>
        {emojis.map((e) => (
          <motion.div
            key={e.id}
            className="absolute select-none pointer-events-auto cursor-pointer"
            style={{
              left: `${e.x}%`,
              fontSize: e.size,
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
            }}
            initial={{ y: '-5vh', opacity: 0, rotate: 0, x: 0 }}
            animate={{
              y: '110vh',
              opacity: [0, 0.6, 0.6, 0.4, 0],
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
            whileTap={{ scale: 1.8, opacity: 1 }}
            onClick={() => handleTap(e.emoji)}
          >
            {e.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
