import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Receipt, DollarSign, Speaker, Scale, CalendarDays, Sparkles, Menu, X, ClipboardCheck, PartyPopper, PieChart, LogOut, Settings, Users, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePartyMode } from '@/lib/PartyModeContext';
import { useAuth } from '@/lib/AuthContext';
import { useUserPrefs } from '@/lib/UserPrefsContext';
import FloatingEmojis from '@/components/FloatingEmojis';
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
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const ALL_NAV_ITEMS = [
  { to: '/',               icon: LayoutDashboard, label: 'Dashboard',      tabKey: null },
  { to: '/calendar',       icon: CalendarDays,    label: 'Calendar',       tabKey: 'calendar' },
  { to: '/log',            icon: ClipboardCheck,  label: 'Job Log',        tabKey: 'log' },
  { to: '/expenses',       icon: Receipt,         label: 'Expenses',       tabKey: 'expenses' },
  { to: '/taxes',          icon: PieChart,        label: 'Taxes',          tabKey: 'taxes' },
  { to: '/income',         icon: DollarSign,      label: 'Income',         tabKey: 'income' },
  { to: '/reconciliation', icon: Scale,           label: 'Reconciliation', tabKey: 'reconciliation' },
  { to: '/equipment',      icon: Speaker,         label: 'Equipment',      tabKey: 'equipment' },
  { to: '/discover',       icon: Sparkles,        label: 'Discover',       tabKey: 'discover' },
  { to: '/scheduling',    icon: Users,           label: 'Scheduling',     tabKey: 'scheduling' },
  { to: '/payouts',       icon: Wallet,          label: 'Pay Outs',       tabKey: 'payouts' },
] as const;

const ALL_TAB_ITEMS = [
  { to: '/',        icon: LayoutDashboard, label: 'Home',    tabKey: null },
  { to: '/log',     icon: ClipboardCheck,  label: 'Job Log', tabKey: 'log' },
  { to: '/expenses',icon: Receipt,         label: 'Expenses',tabKey: 'expenses' },
  { to: '/income',  icon: DollarSign,      label: 'Income',  tabKey: 'income' },
] as const;

function SidebarContent({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const location = useLocation();
  const { partyMode, togglePartyMode } = usePartyMode();
  const { user, signOut } = useAuth();
  const { prefs } = useUserPrefs();

  const navItems = ALL_NAV_ITEMS.filter(
    item => item.tabKey === null || prefs.tabs[item.tabKey as keyof typeof prefs.tabs]
  );

  const iconBtn = collapsed
    ? "flex items-center justify-center rounded-md p-2.5 text-sm transition-colors w-full"
    : "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors w-full";

  return (
    <>
      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => {
          const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
          return (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
              className={cn(
                collapsed
                  ? "flex items-center justify-center rounded-md p-2.5 transition-colors"
                  : "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
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
        <Link
          to="/settings"
          onClick={onNavigate}
          title={collapsed ? 'Mode' : undefined}
          className={cn(
            iconBtn,
            location.pathname === '/settings'
              ? "bg-primary/10 text-primary border-glow border"
              : "text-muted-foreground hover:bg-secondary"
          )}
        >
          <Settings size={18} />
          {!collapsed && <span>Mode</span>}
        </Link>
        <button
          onClick={togglePartyMode}
          title={collapsed ? (partyMode ? 'Vibes ON' : 'Vibes OFF') : undefined}
          className={cn(
            iconBtn,
            partyMode ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-secondary"
          )}
        >
          <PartyPopper size={18} />
          {!collapsed && <span>{partyMode ? 'Vibes ON' : 'Vibes OFF'}</span>}
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              title={collapsed ? 'Sign Out' : undefined}
              className={cn(iconBtn, "text-muted-foreground hover:bg-secondary")}
            >
              <LogOut size={18} />
              {!collapsed && <span>Sign Out</span>}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out?</AlertDialogTitle>
              <AlertDialogDescription>
                Your data is saved to your account. You can sign back in anytime.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={signOut}>Sign Out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {user && !collapsed && <p className="text-[10px] text-muted-foreground text-mono px-3 truncate">{user.email}</p>}
      </div>
    </>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { prefs } = useUserPrefs();
  const tabItems = ALL_TAB_ITEMS.filter(
    item => item.tabKey === null || prefs.tabs[item.tabKey as keyof typeof prefs.tabs]
  );
  const { partyMode } = usePartyMode();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {partyMode && <FloatingEmojis />}
      {/* Desktop sidebar — hidden on mobile */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border bg-sidebar transition-all duration-200",
          collapsed ? "w-16" : "w-56"
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <button onClick={() => setCollapsed(!collapsed)} className="text-muted-foreground hover:text-primary transition-colors">
            {collapsed ? <Menu size={20} /> : <X size={20} />}
          </button>
          {!collapsed && (
            <span className="text-sm font-bold text-mono tracking-widest funky-gradient-text">
              AV LEDGER
            </span>
          )}
        </div>
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Mobile top bar + sheet nav */}
      <div className="flex flex-col flex-1 min-w-0">
        <header className="md:hidden flex items-center justify-between border-b border-border bg-sidebar px-4 py-3">
          <span className="text-sm font-bold text-mono tracking-widest funky-gradient-text">AV LEDGER</span>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground transition-colors p-1">
                <Menu size={22} />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 bg-sidebar p-0 flex flex-col">
              <div className="px-4 py-4 border-b border-border">
                <span className="text-sm font-bold text-mono tracking-widest funky-gradient-text">AV LEDGER</span>
              </div>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto pb-20 md:pb-0">
          <div className="p-4 md:p-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-sidebar/95 backdrop-blur-lg border-t border-border flex justify-around py-2 px-1 z-50">
          {tabItems.map(({ to, icon: Icon, label }) => {
            const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-medium tracking-wider uppercase transition-all",
                  active ? "text-primary scale-110" : "text-muted-foreground"
                )}
              >
                <div className={cn(
                  "p-1.5 rounded-xl transition-colors",
                  active && "bg-primary/15"
                )}>
                  <Icon size={20} />
                </div>
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
