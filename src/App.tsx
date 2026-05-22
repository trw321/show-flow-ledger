import { useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/AuthContext";
import { DataProvider } from "@/lib/DataContext";
import { PartyModeProvider } from "@/lib/PartyModeContext";
import { UserPrefsProvider } from "@/lib/UserPrefsContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import LoadingScreen from "@/components/LoadingScreen";
import PatternAuthPage from "@/pages/PatternAuthPage";

import ExpensesPage from "@/pages/ExpensesPage";
import IncomePage from "@/pages/IncomePage";
import EquipmentPage from "@/pages/EquipmentPage";
import PayReconciliationPage from "@/pages/PayReconciliationPage";
import CalendarPage from "@/pages/CalendarPage";
import JobLogPage from "@/pages/JobLogPage";
import DiscoverPage from "@/pages/DiscoverPage";
import TaxesPage from "@/pages/TaxesPage";
import SettingsPage from "@/pages/SettingsPage";
import SchedulingPage from "@/pages/SchedulingPage";
import PayOutsPage from "@/pages/PayOutsPage";
import NotFound from "./pages/NotFound.tsx";
import CalcTest from './pages/CalcTest';

const queryClient = new QueryClient();

function AuthenticatedApp() {
  const [unlocked, setUnlocked] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const handleComplete = useCallback(() => setSplashDone(true), []);

  if (!unlocked) return <PatternAuthPage onUnlocked={() => setUnlocked(true)} />;

  return (
    <>
      {!splashDone && <LoadingScreen onComplete={handleComplete} />}
      <DataProvider>
        <UserPrefsProvider>
        <PartyModeProvider>
          <BrowserRouter>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/log" element={<JobLogPage />} />
                <Route path="/expenses" element={<ExpensesPage />} />
                <Route path="/income" element={<IncomePage />} />
                <Route path="/equipment" element={<EquipmentPage />} />
                <Route path="/reconciliation" element={<PayReconciliationPage />} />
                <Route path="/taxes" element={<TaxesPage />} />
                <Route path="/discover" element={<DiscoverPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/scheduling" element={<SchedulingPage />} />
                <Route path="/payouts" element={<PayOutsPage />} />
                <Route path="/dev/calc-test" element={<CalcTest />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          </BrowserRouter>
        </PartyModeProvider>
        </UserPrefsProvider>
      </DataProvider>
    </>
  );
}

const App = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <AuthProvider>
            <AuthenticatedApp />
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
