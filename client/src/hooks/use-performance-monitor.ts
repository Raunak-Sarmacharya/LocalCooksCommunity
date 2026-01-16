import { useCallback, useRef } from 'react';

interface PerformanceMetrics {
  apiCallTime: number;
  userInteractionTime: number;
  totalFormTime: number;
}

export function usePerformanceMonitor() {
  const startTime = useRef<number>(Date.now());
  const apiCallStart = useRef<number>(0);
  const metrics = useRef<PerformanceMetrics>({
    apiCallTime: 0,
    userInteractionTime: 0,
    totalFormTime: 0
  });

  const startApiCall = useCallback(() => {
    apiCallStart.current = Date.now();
  }, []);

  const endApiCall = useCallback(() => {
    if (apiCallStart.current > 0) {
      metrics.current.apiCallTime += Date.now() - apiCallStart.current;
      apiCallStart.current = 0;
    }
  }, []);

  const recordUserInteraction = useCallback((action: string) => {
    const now = Date.now();
    metrics.current.userInteractionTime = now - startTime.current;
    
    // Log performance metrics for debugging
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 Form Performance - ${action}:`, {
        apiCallTime: metrics.current.apiCallTime,
        userInteractionTime: metrics.current.userInteractionTime,
        totalFormTime: now - startTime.current
      });
    }
  }, []);

  const getMetrics = useCallback(() => {
    const now = Date.now();
    metrics.current.totalFormTime = now - startTime.current;
    return { ...metrics.current };
  }, []);

  const resetMetrics = useCallback(() => {
    startTime.current = Date.now();
    metrics.current = {
      apiCallTime: 0,
      userInteractionTime: 0,
      totalFormTime: 0
    };
  }, []);

  return {
    startApiCall,
    endApiCall,
    recordUserInteraction,
    getMetrics,
    resetMetrics
  };
}
