import { useEffect, useRef, useCallback } from 'react';

interface UseSidebarGestureOptions {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  enabled?: boolean;
}

export function useSidebarGesture({
  isOpen,
  onOpen,
  onClose,
  enabled = true,
}: UseSidebarGestureOptions) {
  const mainRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const startXRef = useRef<number>(0);
  const startYRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const currentXRef = useRef<number>(0);
  const isTrackingRef = useRef<boolean>(false);
  const isHorizontalRef = useRef<boolean | null>(null);
  const isOpenRef = useRef<boolean>(isOpen);
  isOpenRef.current = isOpen;

  const rafRef = useRef<number | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingAnimation = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (animTimerRef.current !== null) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
  }, []);

  const clearInlineStyles = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.style.opacity = '';
      containerRef.current.style.pointerEvents = '';
      containerRef.current.style.visibility = '';
    }
    if (sidebarRef.current) {
      sidebarRef.current.style.transform = '';
      sidebarRef.current.style.transition = '';
    }
    if (overlayRef.current) {
      overlayRef.current.style.opacity = '';
      overlayRef.current.style.transition = '';
      overlayRef.current.style.pointerEvents = '';
    }
  }, []);

  const getDrawerWidth = useCallback(() => {
    if (typeof window === 'undefined') return 320;
    if (sidebarRef.current && sidebarRef.current.offsetWidth > 0) {
      return sidebarRef.current.offsetWidth;
    }
    return Math.min(window.innerWidth * 0.86, 340);
  }, []);

  const updatePositions = useCallback(
    (x: number, animate = false) => {
      clearPendingAnimation();

      const drawerWidth = getDrawerWidth();
      const clampedX = Math.max(0, Math.min(drawerWidth, x));
      const progress = clampedX / drawerWidth;

      if (containerRef.current) {
        containerRef.current.style.opacity = '1';
        containerRef.current.style.pointerEvents = clampedX > 0 ? 'auto' : 'none';
        containerRef.current.style.visibility = clampedX > 0 ? 'visible' : 'hidden';
      }

      if (sidebarRef.current) {
        sidebarRef.current.style.transition = animate
          ? 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)'
          : 'none';
        sidebarRef.current.style.transform = `translate3d(${clampedX - drawerWidth}px, 0, 0)`;
      }

      if (overlayRef.current) {
        overlayRef.current.style.transition = animate
          ? 'opacity 260ms cubic-bezier(0.16, 1, 0.3, 1)'
          : 'none';
        overlayRef.current.style.opacity = String(progress);
        overlayRef.current.style.pointerEvents = clampedX > 0 ? 'auto' : 'none';
      }

      if (animate) {
        animTimerRef.current = setTimeout(() => {
          clearInlineStyles();
        }, 270);
      }
    },
    [getDrawerWidth, clearPendingAnimation, clearInlineStyles]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 768) {
      clearInlineStyles();
      return;
    }
    const drawerWidth = getDrawerWidth();
    updatePositions(isOpen ? drawerWidth : 0, true);
  }, [isOpen, updatePositions, getDrawerWidth, clearInlineStyles]);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled || typeof window === 'undefined' || window.innerWidth >= 768) return;
      if (e.touches.length !== 1) return;

      const touch = e.touches[0];
      const target = e.target as HTMLElement | null;

      // When closed, ONLY trigger from the left edge (max 38px or 12% of screen)
      const edgeThreshold = Math.max(38, window.innerWidth * 0.12);
      if (!isOpenRef.current) {
        if (touch.clientX > edgeThreshold) {
          return;
        }
        // Avoid starting if user is touching an interactive element at edge
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable ||
            target.closest('button') ||
            target.closest('a'))
        ) {
          return;
        }
      }

      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      startTimeRef.current = Date.now();
      currentXRef.current = isOpenRef.current ? getDrawerWidth() : 0;
      isTrackingRef.current = true;
      isHorizontalRef.current = null;
    },
    [enabled, getDrawerWidth]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isTrackingRef.current || !enabled) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - startXRef.current;
      const deltaY = touch.clientY - startYRef.current;

      if (isHorizontalRef.current === null) {
        if (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6) {
          isHorizontalRef.current = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
          if (!isHorizontalRef.current) {
            isTrackingRef.current = false;
            return;
          }
        } else {
          return;
        }
      }

      if (!isHorizontalRef.current) return;

      if (e.cancelable) {
        e.preventDefault();
      }

      const drawerWidth = getDrawerWidth();
      const initialX = isOpenRef.current ? drawerWidth : 0;
      const nextX = Math.max(0, Math.min(drawerWidth, initialX + deltaX));
      currentXRef.current = nextX;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        updatePositions(nextX, false);
      });
    },
    [enabled, getDrawerWidth, updatePositions]
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!isTrackingRef.current) return;
      isTrackingRef.current = false;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      const touch = e.changedTouches[0];
      const drawerWidth = getDrawerWidth();
      const currentX = currentXRef.current;
      const deltaX = touch ? touch.clientX - startXRef.current : 0;
      const duration = Math.max(1, Date.now() - startTimeRef.current);
      const velocityX = deltaX / duration; // px/ms

      if (isOpenRef.current) {
        // Was open: closing gesture
        const shouldClose = currentX < drawerWidth * 0.7 || velocityX < -0.3;
        if (shouldClose) {
          updatePositions(0, true);
          onClose();
        } else {
          updatePositions(drawerWidth, true);
        }
      } else {
        // Was closed: opening gesture
        const shouldOpen = currentX > drawerWidth * 0.3 || velocityX > 0.3;
        if (shouldOpen) {
          updatePositions(drawerWidth, true);
          onOpen();
        } else {
          updatePositions(0, true);
          onClose();
        }
      }
    },
    [getDrawerWidth, updatePositions, onOpen, onClose]
  );

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const options = { passive: false };
    window.addEventListener('touchstart', handleTouchStart, options);
    window.addEventListener('touchmove', handleTouchMove, options);
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { mainRef, overlayRef, sidebarRef, containerRef };
}
