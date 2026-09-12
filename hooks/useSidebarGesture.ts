import { useState, useEffect, useRef, useCallback } from 'react';

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

  const startXRef = useRef<number>(0);
  const startYRef = useRef<number>(0);
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
    if (mainRef.current) {
      mainRef.current.style.transform = '';
      mainRef.current.style.transition = '';
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
    if (typeof window === 'undefined') return 300;
    return Math.min(window.innerWidth * 0.88, 360);
  }, []);

  const updatePositions = useCallback((x: number, animate = false) => {
    clearPendingAnimation();

    const drawerWidth = getDrawerWidth();
    const clampedX = Math.max(0, Math.min(drawerWidth, x));
    const progress = clampedX / drawerWidth;

    if (mainRef.current) {
      mainRef.current.style.transition = animate ? 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
      mainRef.current.style.transform = clampedX > 0 ? `translateX(${clampedX}px)` : '';
    }

    if (sidebarRef.current) {
      sidebarRef.current.style.transition = animate ? 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
      sidebarRef.current.style.transform = `translateX(${clampedX - drawerWidth}px)`;
    }

    if (overlayRef.current) {
      overlayRef.current.style.transition = animate ? 'opacity 250ms cubic-bezier(0.16, 1, 0.3, 1)' : 'none';
      overlayRef.current.style.opacity = String(progress);
      overlayRef.current.style.pointerEvents = clampedX > 0 ? 'auto' : 'none';
    }

    if (animate) {
      animTimerRef.current = setTimeout(() => {
        clearInlineStyles();
      }, 260);
    }
  }, [getDrawerWidth, clearPendingAnimation, clearInlineStyles]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 768) {
      clearInlineStyles();
      return;
    }
    const drawerWidth = getDrawerWidth();
    updatePositions(isOpen ? drawerWidth : 0, true);
  }, [isOpen, updatePositions, getDrawerWidth, clearInlineStyles]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled || typeof window === 'undefined' || window.innerWidth >= 768) return;
    if (e.touches.length !== 1) return;

    const touch = e.touches[0];
    const target = e.target as HTMLElement | null;

    // Ignore interactive elements unless swiping from extreme left edge
    if (
      !isOpenRef.current &&
      touch.clientX > 30 &&
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('button') ||
        target.closest('a'))
    ) {
      return;
    }

    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    currentXRef.current = isOpenRef.current ? getDrawerWidth() : 0;
    isTrackingRef.current = true;
    isHorizontalRef.current = null;
  }, [enabled, getDrawerWidth]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
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
  }, [enabled, getDrawerWidth, updatePositions]);

  const handleTouchEnd = useCallback(() => {
    if (!isTrackingRef.current) return;
    isTrackingRef.current = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const drawerWidth = getDrawerWidth();
    const currentX = currentXRef.current;
    const ratio = currentX / drawerWidth;

    if (ratio >= 0.4) {
      updatePositions(drawerWidth, true);
      onOpen();
    } else {
      updatePositions(0, true);
      onClose();
    }
  }, [getDrawerWidth, updatePositions, onOpen, onClose]);

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

  return { mainRef, overlayRef, sidebarRef };
}
