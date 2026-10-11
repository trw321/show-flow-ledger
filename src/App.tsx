import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { DataProvider } from '@/lib/DataContext';
import { AuthProvider } from '@/lib/AuthContext';
import LoadingScreen from '@/components/LoadingScreen';
import AppLayout from '@/components/AppLayout';
import CalendarPage from '@/pages/CalendarPage';
import ExpensesPage from '@/pages/ExpensesPage';
import MoneyPage from '@/pages/MoneyPage';
import PayOutsPage from '@/pages/PayOutsPage';
import SettingsPage from '@/pages/SettingsPage';
import AuthPage from '@/pages/AuthPage';
import PatternAuthPage from '@/pages/PatternAuthPage';
import NotFound from '@/pages/NotFound';

export default function App() {
  const [booting, setBooting] = useState(true);

  return (
    // Auth wraps the app but gates nothing: signing in is optional and only
    // turns on backup. AuthProvider renders children immediately, so an
    // unauthenticated session behaves exactly as before.
    <AuthProvider>
    <DataProvider>
      {booting && <LoadingScreen onComplete={() => setBooting(false)} />}
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/pattern-auth" element={<PatternAuthPage />} />
          <Route element={<AppLayout />}>
            {/* The calendar is where the work actually happens, so it is home. */}
            <Route path="/" element={<CalendarPage />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/new" element={<Navigate to="/" replace />} />
            <Route path="/log" element={<Navigate to="/" replace />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/money" element={<MoneyPage />} />
            <Route path="/income" element={<Navigate to="/money" replace />} />
            <Route path="/payouts" element={<PayOutsPage />} />
            <Route path="/pay" element={<Navigate to="/money" replace />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-center" />
    </DataProvider>
    </AuthProvider>
  );
}
