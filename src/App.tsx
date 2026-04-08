import { useState, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { DataProvider } from "@/lib/DataContext";
import { PartyModeProvider } from "@/lib/PartyModeContext";
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
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function AuthenticatedApp() {
  const { user, loading: authLoading } = useAuth();
  const [splashDone, setSplashDone] = useState(false);
  const handleComplete = useCallback(() => setSplashDone(true), []);

  if (authLoading) return null; // waiting for session check
  if (!user) return <PatternAuthPage />;

  return (
    <>
      {!splashDone && <LoadingScreen onComplete={handleComplete} />}
      <DataProvider>
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
                <Route path="*" element={<NotFound />} />
              </Routes>
            </AppLayout>
          </BrowserRouter>
        </PartyModeProvider>
      </DataProvider>
    </>
  );
}

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
