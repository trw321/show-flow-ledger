import { useRef } from 'react';

// Generic horizontal swipe detector — swiping left (finger moves right-to-left)
// fires onNext, swiping right fires onPrev. 40px threshold avoids firing on
// an ordinary scroll/tap.
export function useSwipe(onPrev: () => void, onNext: () => void) {
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) diff > 0 ? onNext() : onPrev();
    touchStartX.current = null;
  };
  return { onTouchStart, onTouchEnd };
}
