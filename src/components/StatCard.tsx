import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant?: 'default' | 'primary' | 'accent' | 'success' | 'destructive';
  subtitle?: string;
}

const variantStyles = {
  default: 'border-border',
  primary: 'border-glow glow-primary',
  accent: 'border-accent/30 glow-accent',
  success: 'border-success/30 glow-success',
  destructive: 'border-destructive/30',
  info: 'border-info/30 shadow-[0_0_20px_-5px_hsl(210_100%_55%/0.3)]',
  warning: 'border-warning/30 shadow-[0_0_20px_-5px_hsl(50_100%_55%/0.3)]',
};

const iconVariants = {
  default: 'text-muted-foreground',
  primary: 'text-primary',
  accent: 'text-accent',
  success: 'text-success',
  destructive: 'text-destructive',
  info: 'text-info',
  warning: 'text-warning',
};

export default function StatCard({ label, value, icon: Icon, variant = 'default', subtitle }: StatCardProps) {
  return (
    <div className={cn(
      "rounded-2xl border bg-card p-4 transition-all hover:scale-[1.02] hover:bg-secondary/50",
      variantStyles[variant]
    )}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</p>
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center bg-secondary", iconVariants[variant])}>
          <Icon size={14} />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold text-mono text-foreground">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
