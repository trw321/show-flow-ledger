import { useEffect, useState } from 'react';
import LampBulb from '@/components/LampBulb';

// The boot screen's bulb, looping forever instead of tracking load progress.
// Shared by both page wrappers so the filament reads as the app's mark on
// every page rather than a Dashboard-only flourish.
const BREATHE_PERIOD_MS = 7000;

/**
 * hot: something needs you. The filament runs red hot and flickers like a
 * lamp on a bad circuit instead of breathing. Held steady (still red) for
 * anyone who has asked for less motion.
 */
export default function BreathingLamp({ size = 78, hot = false }: { size?: number; hot?: boolean }) {
  const [progress, setProgress] = useState(75);

  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (hot) {
      setProgress(95);
      if (still) return;
      const interval = setInterval(() => {
        // Mostly bright, with the odd sharp dip: a flicker, not a pulse.
        const dip = Math.random() < 0.18;
        setProgress(dip ? 35 + Math.random() * 25 : 85 + Math.random() * 15);
      }, 90);
      return () => clearInterval(interval);
    }
    if (still) return;
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const wave = (Math.sin((elapsed / BREATHE_PERIOD_MS) * Math.PI * 2) + 1) / 2;
      setProgress(50 + wave * 50);
    }, 50);
    return () => clearInterval(interval);
  }, [hot]);

  return (
    <div className="shrink-0 -mt-1 pointer-events-none">
      <LampBulb progress={progress} size={size} ambient={false} hot={hot} />
    </div>
  );
}
