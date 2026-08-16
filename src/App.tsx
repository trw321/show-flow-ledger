import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { DataProvider } from '@/lib/DataContext';
import AppLayout from '@/components/AppLayout';
import Dashboard from '@/pages/Dashboard';
import LogAndCalendarPage from '@/pages/LogAndCalendarPage';
import ExpensesPage from '@/pages/ExpensesPage';
import IncomePage from '@/pages/IncomePage';
import PayOutsPage from '@/pages/PayOutsPage';
import PayReconciliationPage from '@/pages/PayReconciliationPage';
import SettingsPage from '@/pages/SettingsPage';
import AuthPage from '@/pages/AuthPage';
import PatternAuthPage from '@/pages/PatternAuthPage';
import NotFound from '@/pages/NotFound';

export default function App() {
  return (
    <DataProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/pattern-auth" element={<PatternAuthPage />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/new" element={<LogAndCalendarPage />} />
            <Route path="/log" element={<Navigate to="/new" replace />} />
            <Route path="/calendar" element={<Navigate to="/new" replace />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/income" element={<IncomePage />} />
            <Route path="/payouts" element={<PayOutsPage />} />
            <Route path="/pay" element={<PayReconciliationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-center" />
    </DataProvider>
  );
}
