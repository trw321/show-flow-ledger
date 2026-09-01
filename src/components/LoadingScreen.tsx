import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getLampColor } from '@/lib/lampVisuals';
import LampBulb from '@/components/LampBulb';

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

  const color = getLampColor(progress);

  return (
    <AnimatePresence>
      <motion.div
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
      >
        <div className="relative flex flex-col items-center">
          <LampBulb progress={progress} />

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
