import BreathingLamp from '@/components/BreathingLamp';
import { cn } from '@/lib/utils';

interface Props {
  // Omit when the page renders its own header — the wrapper then contributes
  // only the background, same convention as SpacePageWrapper.
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

// Same page shell as SpacePageWrapper, minus the starfield — the lamp is the
// whole background here.
export default function LampPageWrapper({ title, description, action, children }: Props) {
  return (
    <div className="relative rounded-lg border border-white/10 overflow-hidden bg-[#0a0806]">
      <div className="relative z-10 p-4 md:p-5">
        {/* The lamp sits in the header row rather than floating behind the
            page. Absolutely positioned, nothing reserved space for it, so the
            first child rendered straight over its lower half and left a
            bisected arc. As a flex item it always gets room to be seen whole. */}
        <div className={cn('flex items-start justify-between gap-3', title ? 'mb-4 md:mb-6' : 'mb-2')}>
          <div className="min-w-0 flex-1">
            {title && <h1 className="text-xs text-mono uppercase tracking-widest text-white/60 font-medium">{title}</h1>}
            {description && <p className="text-[11px] text-white/40 font-body mt-0.5">{description}</p>}
            {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
          </div>
          <BreathingLamp />
        </div>
        {children}
      </div>
    </div>
  );
}
