import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { DataProvider } from '@/lib/DataContext';
import AppLayout from '@/components/AppLayout';
import DashboardPage from '@/pages/DashboardPage';
import NewGigPage from '@/pages/NewGigPage';
import ExpensesPage from '@/pages/ExpensesPage';
import PayPage from '@/pages/PayPage';
import SettingsPage from '@/pages/SettingsPage';

export default function App() {
  return (
    <DataProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/new" element={<NewGigPage />} />
            <Route path="/log" element={<Navigate to="/new" replace />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/pay" element={<PayPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-center" />
    </DataProvider>
  );
}
