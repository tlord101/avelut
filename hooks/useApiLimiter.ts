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
  
  const attemptApiCall = useCallback((apiCallFn: () => Promise<void>)=> {
    return new Promise<{ success: boolean; message: string }>((resolve) => {
        const check = rateLimiter.current.check();
        if (!check.allowed) {
            resolve({ success: false, message: check.message });
            return;
        }

        rateLimiter.current.record();
        apiCallFn().then(() => {
            resolve({ success: true, message: '' });
        }).catch((e: any) => {
            console.error("API call failed:", e);
            const errorMessage = e?.message || e?.toString() || 'An unexpected error occurred.';
            resolve({ success: false, message: errorMessage });
        });
    });
  }, []);

  return { attemptApiCall };
};