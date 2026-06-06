import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardCheck,
  Receipt,
  Settings,
  Menu,
  X,
  DollarSign,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

interface NavItem {
  label: string;
  to: string;
  icon: React.ReactNode;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={18} /> },
  { label: 'Job Log', to: '/new', icon: <ClipboardCheck size={18} /> },
  { label: 'Expenses', to: '/expenses', icon: <Receipt size={18} /> },
  { label: 'Pay', to: '/pay', icon: <DollarSign size={18} /> },
  { label: 'Settings', to: '/settings', icon: <Settings size={18} /> },
];

const ALL_TAB_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <LayoutDashboard size={20} /> },
  { label: 'Job Log', to: '/new', icon: <ClipboardCheck size={20} /> },
  { label: 'Expenses', to: '/expenses', icon: <Receipt size={20} /> },
  { label: 'Pay', to: '/pay', icon: <DollarSign size={20} /> },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {ALL_NAV_ITEMS.map(item => {
        const active =
          item.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.to);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors',
              active
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            {item.icon}
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function BottomTabBar() {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
      {ALL_TAB_ITEMS.map(item => {
        const active =
          item.to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.to);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {item.icon}
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

export default function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-card">
        <div className="px-4 py-5 border-b border-border">
          <span className="text-sm font-semibold tracking-tight text-foreground">Show Flow</span>
        </div>
        <SidebarNav />
      </aside>

      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
        <span className="text-sm font-semibold tracking-tight">Show Flow</span>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="px-4 py-5 border-b border-border">
              <span className="text-sm font-semibold tracking-tight">Show Flow</span>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 px-4 py-6 md:px-8 md:py-8 mt-14 md:mt-0 mb-16 md:mb-0 max-w-2xl w-full mx-auto">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <BottomTabBar />
    </div>
  );
}
