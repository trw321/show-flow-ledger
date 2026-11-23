import { useEffect, useState } from 'react';
import LampBulb from '@/components/LampBulb';

// The boot screen's bulb, looping forever instead of tracking load progress.
// Shared by both page wrappers so the filament reads as the app's mark on
// every page rather than a Dashboard-only flourish.
const BREATHE_PERIOD_MS = 7000;
/** Running hot, it breathes a little quicker than at rest, still slow. */
const HOT_BREATHE_MS = 4500;
/** A soft stutter, one step every 60ms (about a third of a second): how far each step dips. */
const STUTTER = [12, 3, 18, 5, 10, 0];
/** How long between stutters: a few seconds, never on a beat. */
const nextStutterIn = () => 3500 + Math.random() * 4500;

/**
 * hot: something needs you. The filament runs red hot and breathes slowly,
 * with a soft stutter every few seconds, like a warm lamp on a tired circuit:
 * noticeable without pulling at the eye. It used to jump every 90ms with
 * sharp dips, which was distracting. Held steady (still red) for anyone who
 * has asked for less motion.
 */
export default function BreathingLamp({ size = 78, hot = false }: { size?: number; hot?: boolean }) {
  const [progress, setProgress] = useState(75);

  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (hot) {
      setProgress(95);
      if (still) return;
      const start = Date.now();
      let nextStutter = start + 2000 + Math.random() * 3000;
      let stutterFrom = -1;
      const interval = setInterval(() => {
        const now = Date.now();
        const wave = (Math.sin(((now - start) / HOT_BREATHE_MS) * Math.PI * 2) + 1) / 2;
        let level = 72 + wave * 28;
        if (stutterFrom < 0 && now >= nextStutter) stutterFrom = now;
        if (stutterFrom >= 0) {
          const step = Math.floor((now - stutterFrom) / 60);
          if (step < STUTTER.length) level -= STUTTER[step];
          else {
            stutterFrom = -1;
            nextStutter = now + nextStutterIn();
          }
        }
        setProgress(level);
      }, 50);
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
