import { useEffect, useState } from 'react';

/** Refresh time-derived tour history even when the server data is unchanged. */
export function useTourClock() {
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => refresh(value => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
}
