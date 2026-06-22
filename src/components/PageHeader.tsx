interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-4 md:mb-6 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full funky-gradient animate-pulse-glow" />
            <h1 className="text-xl md:text-2xl font-display tracking-wide">{title}</h1>
          </div>
          {description && <p className="mt-0.5 text-xs md:text-sm text-muted-foreground font-body ml-5">{description}</p>}
        </div>
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
