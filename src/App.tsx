import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { DataProvider } from '@/lib/DataContext';
import LoadingScreen from '@/components/LoadingScreen';
import AppLayout from '@/components/AppLayout';
import Dashboard from '@/pages/Dashboard';
import NewGigPage from '@/pages/NewGigPage';
import CalendarPage from '@/pages/CalendarPage';
import ExpensesPage from '@/pages/ExpensesPage';
import IncomePage from '@/pages/IncomePage';
import PayOutsPage from '@/pages/PayOutsPage';
import SettingsPage from '@/pages/SettingsPage';
import AuthPage from '@/pages/AuthPage';
import PatternAuthPage from '@/pages/PatternAuthPage';
import NotFound from '@/pages/NotFound';

export default function App() {
  const [booting, setBooting] = useState(true);

  return (
    <DataProvider>
      {booting && <LoadingScreen onComplete={() => setBooting(false)} />}
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/pattern-auth" element={<PatternAuthPage />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/new" element={<NewGigPage />} />
            <Route path="/log" element={<Navigate to="/new" replace />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/income" element={<IncomePage />} />
            <Route path="/payouts" element={<PayOutsPage />} />
            <Route path="/pay" element={<Navigate to="/income" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-center" />
    </DataProvider>
  );
}
