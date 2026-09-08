import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Toast as CapacitorToast } from '@capacitor/toast';
import type { ToastMessage, ToastType } from '../types';
import { Toast } from '../components/Toast';
import { usePortalRoot } from '../utils/portal';

interface ToastContextType {
  addToast: (message: string, type?: ToastType, duration?: number, action?: { label: string; onClick: () => void }) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = (): ToastContextType => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const triggerHapticFeedback = (type: ToastType) => {
  if ('vibrate' in navigator) {
    try {
      if (type === 'error') {
        // A double buzz for errors to grab attention
        navigator.vibrate([100, 50, 100]);
      } else {
        // A single short buzz for success or info
        navigator.vibrate(50);
      }
    } catch (e) {
      console.warn("Haptic feedback failed:", e);
    }
  }
};

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const portalRoot = usePortalRoot('avelut-toast-root');

  const addToast = useCallback(async (message: string, type: ToastType = 'info', duration?: number, action?: { label: string; onClick: () => void }) => {
    triggerHapticFeedback(type);

    const defaultDurations = {
      success: 4000,
      info: 4000,
      warning: 5000,
      error: 6000
    };
    const finalDuration = duration || defaultDurations[type];

    if (Capacitor.isNativePlatform()) {
      try {
        await CapacitorToast.show({
          text: message,
          duration: finalDuration > 4000 ? 'long' : 'short',
          position: 'bottom',
        });
      } catch (e) {
        console.warn("Toast plugin failed, falling back to React toast:", e);
        const id = Date.now().toString() + Math.random().toString(36).substring(7);
        setToasts(prev => [...prev, { id, message, type, duration: finalDuration, action }]);
      }
    } else {
      const id = Date.now().toString() + Math.random().toString(36).substring(7);
      setToasts(prev => [...prev, { id, message, type, duration: finalDuration, action }]);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prevToasts) => prevToasts.filter((toast) => toast.id !== id));
  }, []);

  return React.createElement(ToastContext.Provider, { value: { addToast } },
    children,
    portalRoot
      ? createPortal(
          React.createElement('div', { className: "fixed top-5 left-0 right-0 z-[9999] flex flex-col items-center gap-2 pointer-events-none px-4" },
            toasts.map((toast) => React.createElement(Toast, {
              key: toast.id,
              message: toast.message,
              type: toast.type,
              duration: toast.duration,
              action: toast.action,
              onDismiss: () => removeToast(toast.id)
            }))
          ),
          portalRoot
        )
      : null
  );
};