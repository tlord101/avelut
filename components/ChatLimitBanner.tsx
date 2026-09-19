import React from 'react';
import { Browser } from '@capacitor/browser';
import { isNative } from '../utils/capacitorUtils';

export interface ChatLimitBannerProps {
  title?: string;
  subtitle?: string;
  actionText?: string;
  cost?: number;
  balance?: number;
  onAction?: () => void;
  onNavigate?: (view: string) => void;
  className?: string;
}

export const ChatLimitBanner: React.FC<ChatLimitBannerProps> = ({
  title = 'Free tier limit reached',
  subtitle = 'Try again later or upgrade to Pro for much higher limits and premium features.',
  actionText = 'Upgrade to Pro',
  onAction,
  onNavigate,
  className = '',
}) => {
  const handleUpgrade = async () => {
    if (onAction) {
      onAction();
      return;
    }
    if (onNavigate) {
      onNavigate('billing');
      return;
    }
    const baseUrl = isNative() ? 'https://avelut.xyz' : window.location.origin;
    const plansUrl = `${baseUrl}/plans`;
    if (isNative()) {
      await Browser.open({ url: plansUrl });
    } else {
      window.location.href = plansUrl;
    }
  };

  return (
    <div
      className={`mx-auto w-full max-w-3xl rounded-2xl bg-[#18181B] text-white p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 shadow-xl border border-neutral-800 animate-in fade-in slide-in-from-bottom-2 duration-300 ${className}`}
    >
      <div className="flex items-start sm:items-center gap-3 min-w-0">
        <div className="w-6 h-6 rounded-full bg-amber-400/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[14.5px] sm:text-[15px] font-bold text-white tracking-tight leading-snug">
            {title}
          </div>
          <div className="text-xs sm:text-[13px] text-neutral-400 leading-normal mt-0.5">
            {subtitle}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleUpgrade}
        className="self-end sm:self-center bg-white hover:bg-neutral-100 active:scale-95 text-neutral-900 font-semibold text-xs sm:text-sm px-4 py-2 rounded-full shrink-0 shadow-xs transition-all cursor-pointer whitespace-nowrap"
      >
        {actionText}
      </button>
    </div>
  );
};

export default ChatLimitBanner;

