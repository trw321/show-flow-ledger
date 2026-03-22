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
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-mono">{title}</h1>
          {description && <p className="mt-0.5 text-xs md:text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
