import { useEffect, useState } from 'react';
import LampBulb from '@/components/LampBulb';

// The boot screen's bulb, looping forever instead of tracking load progress.
// Shared by both page wrappers so the filament reads as the app's mark on
// every page rather than a Dashboard-only flourish.
const BREATHE_PERIOD_MS = 7000;

export default function BreathingLamp({ size = 78 }: { size?: number }) {
  const [progress, setProgress] = useState(75);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const wave = (Math.sin((elapsed / BREATHE_PERIOD_MS) * Math.PI * 2) + 1) / 2;
      setProgress(50 + wave * 50);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="shrink-0 -mt-1 pointer-events-none">
      <LampBulb progress={progress} size={size} ambient={false} />
    </div>
  );
}
