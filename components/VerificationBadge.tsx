import React from 'react';
import type { UserProfile } from '../types';

interface VerificationBadgeProps {
  status?: UserProfile['subscription_status'] | string;
  className?: string;
}

export const VerificationBadge: React.FC<VerificationBadgeProps> = ({ status, className = '' }) => {
  if (status === 'basic' || status === 'premium' || status === 'weekly' || status === 'monthly' || status === 'semester') {
    return (
      <span className={`inline-flex items-center gap-0.5 text-blue-500 shrink-0 select-none ${className}`} title="Verified member">
        <svg className="w-4.5 h-4.5 fill-current drop-shadow-sm" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
      </span>
    );
  }

  if (status === 'pro') {
    return (
      <span className={`inline-flex items-center gap-0.5 text-[#0066FF] shrink-0 select-none ${className}`} title="Pro verified member">
        <svg className="w-4.5 h-4.5 fill-current drop-shadow-sm" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
      </span>
    );
  }

  if (status === 'free') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-white/10 rounded-full shrink-0 select-none ${className}`}>
        Free
      </span>
    );
  }

  if (status === 'personal_token') {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-blue-50 text-[#002D62] border border-blue-200 rounded-full shrink-0 select-none ${className}`} title="Using personal API key">
        Developer
      </span>
    );
  }

  return null;
};
