import React, { useState, useEffect } from 'react';
import type { ToastType } from '../types';

const SuccessIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
  </svg>
);

const ErrorIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
  </svg>
);

const InfoIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
  </svg>
);

const WarningIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
  </svg>
);

const TOAST_CONFIG = {
  success: {
    icon: <SuccessIcon className="w-4 h-4 text-emerald-400" />,
    badgeBg: 'bg-emerald-500/15',
  },
  error: {
    icon: <ErrorIcon className="w-4 h-4 text-rose-400" />,
    badgeBg: 'bg-rose-500/15',
  },
  info: {
    icon: <InfoIcon className="w-4 h-4 text-sky-400" />,
    badgeBg: 'bg-sky-500/15',
  },
  warning: {
    icon: <WarningIcon className="w-4 h-4 text-amber-400" />,
    badgeBg: 'bg-amber-500/15',
  },
};

interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  action?: { label: string; onClick: () => void };
  onDismiss: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, duration, action, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);
  const config = TOAST_CONFIG[type] || TOAST_CONFIG.info;

  useEffect(() => {
    if (duration && duration > 0) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(onDismiss, 250);
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [onDismiss, duration]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(onDismiss, 250);
  };

  return (
    <div
      className={`inline-flex items-center gap-2.5 px-3.5 py-2 rounded-full bg-[#121214]/90 dark:bg-[#1c1c1e]/90 backdrop-blur-xl border border-white/15 text-white shadow-[0_8px_32px_rgba(0,0,0,0.45)] max-w-[92vw] sm:max-w-md pointer-events-auto transition-all text-xs font-medium ${
        isExiting ? 'animate-toast-out' : 'animate-toast-in'
      }`}
      role="alert"
    >
      <div className={`flex-shrink-0 p-1 rounded-full ${config.badgeBg} flex items-center justify-center`}>
        {config.icon}
      </div>

      <span className="text-white/95 text-xs font-medium leading-snug tracking-tight truncate max-w-[260px] sm:max-w-[340px]">
        {message}
      </span>

      {action && (
        <button
          onClick={() => {
            action.onClick();
            handleDismiss();
          }}
          className="ml-1 flex-shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/20 hover:bg-white/30 active:scale-95 text-white transition-all"
        >
          {action.label}
        </button>
      )}

      <button
        onClick={handleDismiss}
        className="ml-0.5 flex-shrink-0 p-0.5 rounded-full text-white/35 hover:text-white/80 transition-colors"
        aria-label="Close"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};