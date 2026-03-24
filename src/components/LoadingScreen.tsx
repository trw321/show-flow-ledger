import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setTimeout(onComplete, 400);
          return 100;
        }
        // Accelerating warmup curve
        const step = p < 30 ? 2 : p < 60 ? 3 : p < 85 ? 4 : 6;
        return Math.min(p + step, 100);
      });
    }, 50);
    return () => clearInterval(interval);
  }, [onComplete]);

  // LED color transitions from dim red → orange → warm white → bright white
  const getColor = (p: number) => {
    if (p < 20) return `hsl(0, 80%, ${10 + p}%)`;
    if (p < 40) return `hsl(${(p - 20) * 1.5}, 90%, ${20 + p * 0.5}%)`;
    if (p < 60) return `hsl(30, ${90 - (p - 40) * 2}%, ${40 + p * 0.3}%)`;
    if (p < 80) return `hsl(40, ${50 - (p - 60)}%, ${55 + p * 0.3}%)`;
    return `hsl(45, ${30 - (p - 80) * 1.5}%, ${70 + (p - 80) * 1.5}%)`;
  };

  const getGlow = (p: number) => {
    const size = 20 + p * 2;
    const opacity = 0.1 + p * 0.008;
    return `0 0 ${size}px ${size / 2}px hsla(${p < 50 ? 15 : 40}, ${80 - p * 0.3}%, ${30 + p * 0.4}%, ${opacity})`;
  };

  const color = getColor(progress);

  return (
    <AnimatePresence>
      <motion.div
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
      >
        {/* LED filament */}
        <div className="relative flex flex-col items-center">
          {/* Outer glow */}
          <motion.div
            className="absolute rounded-full"
            style={{
              width: 120 + progress,
              height: 120 + progress,
              background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
              filter: `blur(${10 + progress * 0.3}px)`,
            }}
          />

          {/* LED bulb shape */}
          <motion.div
            className="relative w-16 h-16 rounded-full border-2"
            style={{
              borderColor: `${color}66`,
              background: `radial-gradient(circle at 40% 40%, ${color}, ${color}33)`,
              boxShadow: getGlow(progress),
            }}
            animate={{
              scale: [1, 1.02, 1],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            {/* Inner filament lines */}
            <svg viewBox="0 0 64 64" className="absolute inset-0 w-full h-full">
              <path
                d="M24 44 C28 20, 32 16, 32 16 C32 16, 36 20, 40 44"
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity={0.3 + progress * 0.007}
              />
              <path
                d="M28 44 C30 28, 32 24, 32 22 C32 24, 34 28, 36 44"
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                opacity={0.4 + progress * 0.006}
              />
            </svg>
          </motion.div>

          {/* Brand */}
          <motion.p
            className="mt-8 text-xs text-mono tracking-[0.3em] uppercase"
            style={{ color }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 + progress * 0.006 }}
          >
            AV LEDGER
          </motion.p>

          {/* Subtle progress bar */}
          <div className="mt-4 w-32 h-0.5 rounded-full bg-secondary overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ width: `${progress}%`, background: color }}
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
