import { useEffect, useState } from 'react';

/** Refresh time-derived tour history even when the server data is unchanged. */
export function useTourClock(nextBoundary?: number) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => refresh(value => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (nextBoundary === undefined) return;
    const timer = window.setTimeout(() => refresh(value => value + 1),
      Math.min(Math.max(0, nextBoundary - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [nextBoundary]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refresh(value => value + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}
