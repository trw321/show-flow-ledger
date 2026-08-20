import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const BUNDLE_SRC_RE = /<script[^>]*type="module"[^>]*src="([^"]*)"/i;

function currentBundleSrc(): string | null {
  const el = document.querySelector('script[type="module"][src]');
  return el?.getAttribute('src') ?? null;
}

/**
 * Detects when a newer build has been deployed while this tab is still open
 * on an old one, and prompts a reload — rather than relying on every mobile
 * browser to notice the server's cache-control headers on its own, which has
 * repeatedly left people staring at stale behavior after a fix ships.
 * Silent no-op when already current; never auto-reloads (would blow away
 * whatever the user is mid-typing).
 */
export default function UpdateChecker() {
  const notifiedRef = useRef(false);

  useEffect(() => {
    const knownSrc = currentBundleSrc();
    if (!knownSrc) return;

    const check = async () => {
      if (notifiedRef.current) return;
      try {
        const res = await fetch('/', { cache: 'no-store' });
        if (!res.ok) return;
        const html = await res.text();
        const match = html.match(BUNDLE_SRC_RE);
        const latestSrc = match?.[1];
        if (latestSrc && latestSrc !== knownSrc) {
          notifiedRef.current = true;
          toast('A new version of Show Flow is available', {
            duration: Infinity,
            action: {
              label: 'Reload',
              onClick: () => window.location.reload(),
            },
          });
        }
      } catch {
        // offline or a blip — just try again on the next check
      }
    };

    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    const interval = setInterval(check, 5 * 60 * 1000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      clearInterval(interval);
    };
  }, []);

  return null;
}
