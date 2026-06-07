import React, { useEffect, useState } from 'react';

export const NativePullToRefresh: React.FC = () => {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const MAX_PULL = 120;
  const THRESHOLD = 80;

  useEffect(() => {
    let startY = 0;
    let currentY = 0;
    let isPulling = false;

    // We check if the main scroll container is at the top
    const getScrollTop = () => {
      const mainContainer = document.getElementById('main-scroll-container');
      if (mainContainer) return mainContainer.scrollTop;
      return window.scrollY || document.documentElement.scrollTop;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (getScrollTop() > 0) return;
      startY = e.touches[0].clientY;
      currentY = e.touches[0].clientY;
      isPulling = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling || getScrollTop() > 0 || refreshing) {
        isPulling = false;
        return;
      }
      currentY = e.touches[0].clientY;
      const distance = currentY - startY;

      if (distance > 0) {
        // Slow down the pull effect (resistance)
        const resistance = distance * 0.4;
        setPullDistance(Math.min(resistance, MAX_PULL));
      }
    };

    const handleTouchEnd = () => {
      if (!isPulling) return;
      isPulling = false;

      setPullDistance(prev => {
        if (prev >= THRESHOLD && !refreshing) {
          setRefreshing(true);
          // Wait for animation to settle, then reload
          setTimeout(() => {
            window.location.reload();
          }, 400);
          return THRESHOLD;
        }
        return 0;
      });
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [refreshing]);

  if (pullDistance === 0 && !refreshing) return null;

  const rotate = Math.min(pullDistance * 3, 360);
  const opacity = Math.min(pullDistance / THRESHOLD, 1);

  return (
    <div
      className="fixed left-0 right-0 flex justify-center pointer-events-none z-[99999]"
      style={{
        top: 'calc(env(safe-area-inset-top) + 20px)',
      }}
    >
      <div
        className="bg-white rounded-full shadow-lg flex items-center justify-center overflow-hidden transition-transform duration-200 ease-out"
        style={{
          width: '40px',
          height: '40px',
          transform: `translateY(${refreshing ? 20 : pullDistance - 40}px)`,
          opacity: refreshing ? 1 : opacity,
        }}
      >
        {refreshing ? (
          <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
        ) : (
          <div
            className="text-brand-500 font-bold"
            style={{ transform: `rotate(${rotate}deg)` }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12v-1a5 5 0 10-10 0v1m10 0l-3-3m3 3l-3 3" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};
