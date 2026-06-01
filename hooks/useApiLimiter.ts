import { useRef, useCallback } from 'react';
import { RateLimiter } from '../utils/rateLimiter';

const planConfigs = {
  free: { maxRequests: 5, intervalMs: 30000, delay: 5000 },
  starter: { maxRequests: 20, intervalMs: 30000, delay: 1500 },
  smart: { maxRequests: 1000, intervalMs: 30000, delay: 0 },
};

export const useApiLimiter = () => {
  const config = planConfigs.free;
  const rateLimiter = useRef<RateLimiter>(new RateLimiter(config.maxRequests, config.intervalMs));
  
  const attemptApiCall = useCallback(async <T,>(apiCallFn: () => Promise<T>) => {
    const check = rateLimiter.current.check();
    if (!check.allowed) {
      return { success: false, message: check.message } as const;
    }

    try {
      const data = await apiCallFn();
      rateLimiter.current.record();
      return { success: true, message: '', data } as const;
    } catch (e: any) {
      console.error("API call failed:", e);
      const errorMessage = e?.message || e?.toString() || 'An unexpected error occurred.';
      return { success: false, message: errorMessage } as const;
    }
  }, []);

  return { attemptApiCall };
};