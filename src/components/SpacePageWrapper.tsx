import VortexCanvas from '@/components/VortexCanvas';

interface Props {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export default function SpacePageWrapper({ title, description, action, children }: Props) {
  return (
    <div className="relative rounded-2xl border border-white/10 overflow-hidden">
      <div className="absolute inset-0">
        <VortexCanvas phase="idle" className="w-full h-full" />
      </div>
      <div className="relative z-10 p-4 md:p-5">
        <div className="mb-4 md:mb-6">
          <h1 className="text-xs text-mono uppercase tracking-widest text-white/60 font-medium">{title}</h1>
          {description && <p className="text-[11px] text-white/40 font-body mt-0.5">{description}</p>}
          {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
