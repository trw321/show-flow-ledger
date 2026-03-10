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
};

const iconVariants = {
  default: 'text-muted-foreground',
  primary: 'text-primary',
  accent: 'text-accent',
  success: 'text-success',
  destructive: 'text-destructive',
};

export default function StatCard({ label, value, icon: Icon, variant = 'default', subtitle }: StatCardProps) {
  return (
    <div className={cn("rounded-lg border bg-card p-4 transition-all hover:bg-secondary/50", variantStyles[variant])}>
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon size={16} className={iconVariants[variant]} />
      </div>
      <p className="mt-2 text-2xl font-bold text-mono text-foreground">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
