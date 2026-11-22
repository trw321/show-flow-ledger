import VortexCanvas from '@/components/VortexCanvas';
import PreampLamp from '@/components/PreampLamp';
import { cn } from '@/lib/utils';

interface Props {
  // Omit when the page renders its own header (e.g. Settings' bespoke <h1>,
  // Income's PageHeader) — the wrapper then contributes only the background.
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  starCount?: number;
  /** On a phone, run to the screen's edges: no blue strip down either side. */
  bleed?: boolean;
}

export default function SpacePageWrapper({ title, description, action, children, starCount, bleed }: Props) {
  return (
    <div className={cn(
      'relative rounded-lg border border-border overflow-hidden bg-[#0a0806]',
      bleed && '-mx-4 rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x',
    )}>
      <div className="absolute inset-0">
        <VortexCanvas phase="idle" className="w-full h-full" starCount={starCount} />
      </div>
      <div className="absolute inset-0 haze-fog" />
      <div className={cn('relative z-10 p-4 md:p-5', bleed && 'px-3')}>
        {/* Header row always renders so the lamp has reserved space even on
            pages that supply their own <h1> (Income, Settings). */}
        <div className={cn('flex items-start justify-between gap-3', title ? 'mb-4 md:mb-6' : 'mb-2')}>
          <div className="min-w-0 flex-1">
            {typeof title === 'string'
              ? <h1 className="text-xs text-mono uppercase tracking-widest text-foreground/60 font-medium">{title}</h1>
              : title}
            {description && <p className="text-[11px] text-muted-foreground font-body mt-0.5">{description}</p>}
            {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
          </div>
          {/* On a phone the lamp is in the top header instead. */}
          <div className="hidden md:block"><PreampLamp /></div>
        </div>
        {children}
      </div>
    </div>
  );
}
