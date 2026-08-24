import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

type StatCardVariant = 'default' | 'primary' | 'accent' | 'success' | 'destructive' | 'info' | 'warning';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant?: StatCardVariant;
  subtitle?: string;
}

// Flat shell matching Settings/Income's existing card pattern — variant only
// tints the icon, never the border/background/shadow. Color communicates
// real status (paid/warning/etc), not per-card decoration.
const iconVariants: Record<StatCardVariant, string> = {
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
    <div className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/20">
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
