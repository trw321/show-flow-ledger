import { useEffect, useState } from 'react';
import LampBulb from '@/components/LampBulb';

interface Props {
  // Omit when the page renders its own header — the wrapper then contributes
  // only the background, same convention as SpacePageWrapper.
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

// Same page shell as SpacePageWrapper, but the decorative background is the
// boot-screen's glowing lamp instead of the starfield — looping forever with
// no progress bar or brand text (those only make sense once, on boot).
const BREATHE_PERIOD_MS = 7000;

export default function LampPageWrapper({ title, description, action, children }: Props) {
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
    <div className="relative rounded-lg border border-white/10 overflow-hidden bg-[#0a0806]">
      {/* Small corner accent, not a second hero — the intake box below already
          has its own vortex animation tied to real parsing state, so the
          ambient lamp stays out of its way instead of overlapping it. */}
      <div className="absolute inset-0 flex items-start justify-end pt-2 pr-2 pointer-events-none overflow-hidden opacity-60">
        <LampBulb progress={progress} size={130} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-bl from-transparent from-15% to-[#0a0806] pointer-events-none" />
      <div className="relative z-10 p-4 md:p-5">
        {title && (
          <div className="mb-4 md:mb-6">
            <h1 className="text-xs text-mono uppercase tracking-widest text-white/60 font-medium">{title}</h1>
            {description && <p className="text-[11px] text-white/40 font-body mt-0.5">{description}</p>}
            {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
