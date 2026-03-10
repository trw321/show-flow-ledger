import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DataProvider } from "@/lib/DataContext";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import JobsPage from "@/pages/JobsPage";
import ExpensesPage from "@/pages/ExpensesPage";
import IncomePage from "@/pages/IncomePage";
import EquipmentPage from "@/pages/EquipmentPage";
import TimeTrackingPage from "@/pages/TimeTrackingPage";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <DataProvider>
        <BrowserRouter>
          <AppLayout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/income" element={<IncomePage />} />
              <Route path="/equipment" element={<EquipmentPage />} />
              <Route path="/time" element={<TimeTrackingPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppLayout>
        </BrowserRouter>
      </DataProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
