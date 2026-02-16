import { logger } from "@/lib/logger";
/**
 * Global safety net for Radix UI bug #1241
 * 
 * Radix Dialog/Sheet sets `pointer-events: none` on document.body when open.
 * Sometimes it fails to clean up on close (especially during navigation or
 * when multiple dialogs overlap), leaving the entire page unclickable.
 * 
 * This hook runs a periodic check and also listens for route changes to
 * ensure pointer-events is always restored when no Radix overlay is open.
 */
import { useEffect } from 'react';

function cleanupBodyPointerEvents() {
  // Only clean up if no Radix overlay is currently open
  // Radix portals use [data-radix-portal] and overlays use [data-state="open"]
  const openOverlays = document.querySelectorAll(
    '[data-radix-portal] [data-state="open"]'
  );
  
  if (openOverlays.length === 0 && document.body.style.pointerEvents === 'none') {
    document.body.style.pointerEvents = '';
    // Also clean up any stale scroll-lock styles Radix may leave
    document.body.style.overflow = '';
    document.body.removeAttribute('data-scroll-locked');
    logger.warn('[RadixCleanup] Removed stale pointer-events:none from body');
  }
}

export function useRadixBodyCleanup() {
  useEffect(() => {
    // Check periodically (every 2 seconds) for stale pointer-events
    const interval = setInterval(cleanupBodyPointerEvents, 2000);

    // Also check on visibility change (tab switch back)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Small delay to let any pending Radix animations complete
        setTimeout(cleanupBodyPointerEvents, 100);
      }
    };

    // Check on popstate (browser back/forward)
    const handlePopState = () => {
      setTimeout(cleanupBodyPointerEvents, 100);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('popstate', handlePopState);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);
}
