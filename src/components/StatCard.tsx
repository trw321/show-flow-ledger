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

// Only used on Dashboard, which sits on LampPageWrapper's warm near-black
// background — the neutral-grey bg-card/border-border tokens read as a
// mismatched box on top of that, so this uses the same white/opacity
// language as the rest of the page (On Deck card, pay banners) instead.
// Variant only tints the icon, never the border/background/shadow — color
// communicates real status (paid/warning/etc), not per-card decoration.
const iconVariants: Record<StatCardVariant, string> = {
  default: 'text-white/50',
  primary: 'text-primary',
  accent: 'text-accent',
  success: 'text-success',
  destructive: 'text-destructive',
  info: 'text-info',
  warning: 'text-warning',
};

export default function StatCard({ label, value, icon: Icon, variant = 'default', subtitle }: StatCardProps) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-4 transition-colors hover:border-white/20">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">{label}</p>
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center bg-white/10", iconVariants[variant])}>
          <Icon size={14} />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold text-mono text-white">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-white/40">{subtitle}</p>}
    </div>
  );
}
