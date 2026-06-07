import React, { useState, useEffect, useRef } from 'react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  className?: string;
  children: React.ReactNode;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, className = '', children }) => {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  
  const MAX_PULL = 100;
  const THRESHOLD = 60;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only allow pull-to-refresh if we are at the very top of the scroll container
      if (container.scrollTop > 0) return;
      startYRef.current = e.touches[0].clientY;
      currentYRef.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (container.scrollTop > 0 || refreshing) return;
      currentYRef.current = e.touches[0].clientY;
      const distance = currentYRef.current - startYRef.current;
      
      if (distance > 0) {
        // Prevent default scrolling when pulling down
        if (e.cancelable) e.preventDefault();
        
        const resistanceDistance = distance * 0.4;
        setPullDistance(Math.min(resistanceDistance, MAX_PULL));
        setPulling(true);
      }
    };

    const handleTouchEnd = async () => {
      if (!pulling) return;
      
      setPulling(false);
      
      if (pullDistance >= THRESHOLD && !refreshing) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    // Use passive: false for touchmove to allow preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, pulling, refreshing, onRefresh]);

  return (
    <div 
      ref={containerRef} 
      className={`relative w-full ${className}`}
      style={{
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorY: 'contain'
      }}
    >
      <div 
        className="w-full flex justify-center items-center overflow-hidden transition-all duration-200 ease-out"
        style={{ 
          height: refreshing ? `${THRESHOLD}px` : `${pullDistance}px`,
          opacity: pullDistance > 0 || refreshing ? 1 : 0
        }}
      >
        {refreshing ? (
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
        ) : (
          <div 
            className="text-brand-500 font-bold text-sm"
            style={{ transform: `rotate(${pullDistance * 2}deg)` }}
          >
            ↓
          </div>
        )}
      </div>
      <div 
        className="transition-transform duration-200 ease-out"
        style={{ transform: `translateY(${refreshing ? 0 : 0}px)` }}
      >
        {children}
      </div>
    </div>
  );
};
