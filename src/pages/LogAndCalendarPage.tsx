import NewGigPage from '@/pages/NewGigPage';
import CalendarPage from '@/pages/CalendarPage';

export default function LogAndCalendarPage() {
  return (
    <div className="flex flex-col gap-8">
      <NewGigPage />
      <CalendarPage />
    </div>
  );
}
