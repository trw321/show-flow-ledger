import { useLocation, useNavigate } from 'react-router-dom';
import BreathingLamp from '@/components/BreathingLamp';
import { requestPreampOpen, usePreampCount } from '@/lib/preamp';

/**
 * The filament lamp, and the way to the to-dos. It breathes as usual while
 * there's nothing to do; with to-dos waiting it runs red hot and flickers,
 * and tapping it opens Preamp on the calendar.
 */
export default function PreampLamp({ size }: { size?: number }) {
  const count = usePreampCount();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (count === 0) return <BreathingLamp size={size} />;
  const open = () => (pathname === '/' ? requestPreampOpen() : navigate('/', { state: { preamp: true } }));
  return (
    <button type="button" onClick={open} data-testid="preamp-lamp"
      aria-label={`Preamp: ${count} thing${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} you`}
      className="relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive">
      <BreathingLamp size={size} hot />
    </button>
  );
}
