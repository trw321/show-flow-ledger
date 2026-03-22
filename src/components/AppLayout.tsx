import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Briefcase, Receipt, DollarSign, Speaker, Scale, CalendarDays, Sparkles, Menu, X, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clearAllData } from '@/lib/store';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { to: '/expenses', icon: Receipt, label: 'Expenses' },
  { to: '/income', icon: DollarSign, label: 'Income' },
  { to: '/discover', icon: Sparkles, label: 'Discover' },
  { to: '/reconciliation', icon: Scale, label: 'Reconciliation' },
  { to: '/equipment', icon: Speaker, label: 'Equipment' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border bg-sidebar transition-all duration-200",
          collapsed ? "w-16" : "w-56"
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <button onClick={() => setCollapsed(!collapsed)} className="text-muted-foreground hover:text-foreground transition-colors">
            {collapsed ? <Menu size={20} /> : <X size={20} />}
          </button>
          {!collapsed && (
            <span className="text-sm font-bold text-mono tracking-wider text-primary">
              AV LEDGER
            </span>
          )}
        </div>
        <nav className="flex-1 py-4 space-y-1 px-2">
          {navItems.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-primary/10 text-primary border-glow border"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon size={18} />
                {!collapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border px-2 py-3 space-y-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors w-full">
                <Trash2 size={18} />
                {!collapsed && <span>Clear All Data</span>}
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all jobs, expenses, income, and equipment data. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={clearAllData} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {!collapsed && (
            <p className="text-xs text-muted-foreground text-mono px-3">LOCAL MODE</p>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
