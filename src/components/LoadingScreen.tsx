import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          setTimeout(onComplete, 500);
          return 100;
        }
        const step = p < 30 ? 1.5 : p < 60 ? 2.5 : p < 85 ? 3 : 5;
        return Math.min(p + step, 100);
      });
    }, 50);
    return () => clearInterval(interval);
  }, [onComplete]);

  // LED color: dim red → orange → warm white → cool white → blue finish
  const getColor = (p: number) => {
    if (p < 15) return `hsl(0, 85%, ${8 + p * 0.8}%)`;
    if (p < 35) return `hsl(${(p - 15) * 1.5}, 90%, ${20 + p * 0.5}%)`;
    if (p < 55) return `hsl(30, ${90 - (p - 35) * 1.5}%, ${38 + p * 0.4}%)`;
    if (p < 75) return `hsl(45, ${60 - (p - 55) * 2}%, ${58 + p * 0.3}%)`;
    if (p < 90) return `hsl(${45 + (p - 75) * 14}, ${30 + (p - 75) * 3}%, ${75 + (p - 75) * 0.5}%)`;
    return `hsl(${210 + (p - 90) * 2}, ${60 + (p - 90) * 2}%, ${70 + (p - 90) * 1.5}%)`;
  };

  const getFilamentColor = (p: number) => {
    if (p < 20) return `hsl(0, 100%, ${15 + p * 1.5}%)`;
    if (p < 50) return `hsl(${(p - 20) * 1.2}, 100%, ${45 + p * 0.4}%)`;
    if (p < 80) return `hsl(40, ${100 - (p - 50) * 1.5}%, ${65 + (p - 50) * 0.5}%)`;
    return `hsl(${200 + (p - 80) * 3}, ${70 + (p - 80) * 2}%, ${80 + (p - 80) * 1}%)`;
  };

  const color = getColor(progress);
  const filColor = getFilamentColor(progress);
  const glowSize = 60 + progress * 3;
  const glowOpacity = 0.05 + progress * 0.007;

  return (
    <AnimatePresence>
      <motion.div
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
      >
        <div className="relative flex flex-col items-center">
          {/* Ambient glow */}
          <motion.div
            className="absolute rounded-full"
            style={{
              width: glowSize * 2.5,
              height: glowSize * 2.5,
              background: `radial-gradient(circle, ${color}30 0%, ${color}10 40%, transparent 70%)`,
              filter: `blur(${20 + progress * 0.5}px)`,
            }}
          />

          {/* LED bulb — big */}
          <motion.div
            className="relative rounded-full border-2"
            style={{
              width: 140,
              height: 140,
              borderColor: `${color}44`,
              background: `radial-gradient(circle at 45% 40%, ${color}44, ${color}11 70%, transparent)`,
              boxShadow: `0 0 ${30 + progress * 1.5}px ${10 + progress * 0.8}px ${color}${Math.round(glowOpacity * 255).toString(16).padStart(2, '0')}`,
            }}
            animate={{ scale: [1, 1.015, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            {/* Glass highlight */}
            <div
              className="absolute top-3 left-6 w-10 h-6 rounded-full opacity-10"
              style={{ background: `linear-gradient(135deg, white 0%, transparent 100%)` }}
            />

            {/* Filament SVG — detailed coil */}
            <svg viewBox="0 0 140 140" className="absolute inset-0 w-full h-full">
              {/* Support wires */}
              <line x1="55" y1="120" x2="60" y2="75" stroke={filColor} strokeWidth="1.5" opacity={0.3 + progress * 0.004} />
              <line x1="85" y1="120" x2="80" y2="75" stroke={filColor} strokeWidth="1.5" opacity={0.3 + progress * 0.004} />

              {/* Main filament coil */}
              <path
                d="M60 75 C58 65, 62 58, 60 50 C58 42, 64 36, 62 30 C60 24, 66 20, 70 18 C74 20, 80 24, 78 30 C76 36, 82 42, 80 50 C78 58, 82 65, 80 75"
                fill="none"
                stroke={filColor}
                strokeWidth={2.5 + progress * 0.02}
                strokeLinecap="round"
                opacity={0.5 + progress * 0.005}
                filter={progress > 30 ? `drop-shadow(0 0 ${3 + progress * 0.1}px ${filColor})` : undefined}
              />

              {/* Inner bright coil */}
              <path
                d="M64 70 C63 62, 66 56, 64 48 C63 42, 68 38, 66 32 C65 27, 70 23, 70 22 C70 23, 75 27, 74 32 C72 38, 77 42, 76 48 C74 56, 77 62, 76 70"
                fill="none"
                stroke={filColor}
                strokeWidth={1.5 + progress * 0.015}
                strokeLinecap="round"
                opacity={0.3 + progress * 0.007}
                filter={progress > 20 ? `drop-shadow(0 0 ${5 + progress * 0.15}px ${filColor})` : undefined}
              />

              {/* Hot center glow */}
              {progress > 15 && (
                <ellipse
                  cx="70"
                  cy="46"
                  rx={8 + progress * 0.1}
                  ry={18 + progress * 0.15}
                  fill={filColor}
                  opacity={0.05 + progress * 0.003}
                  filter={`blur(${4 + progress * 0.1}px)`}
                />
              )}
            </svg>

            {/* Base / screw cap */}
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-b-lg"
              style={{
                width: 50,
                height: 20,
                background: `linear-gradient(180deg, hsl(0,0%,25%) 0%, hsl(0,0%,15%) 100%)`,
                borderTop: `2px solid ${color}33`,
              }}
            />
          </motion.div>

          {/* Brand */}
          <motion.p
            className="mt-10 text-xs text-mono tracking-[0.3em] uppercase"
            style={{ color }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 + progress * 0.006 }}
          >
            AV LEDGER
          </motion.p>

          {/* Progress bar */}
          <div className="mt-4 w-40 h-0.5 rounded-full bg-secondary overflow-hidden">
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
