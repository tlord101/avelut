import React, { useState, useRef, useEffect } from 'react';
import { AppUpdateBadge } from './AppUpdateBadge';
import { NotificationDropdown } from './NotificationDropdown';
import type { UserProfile, Notification as NotificationType } from '../types';
import { isNative } from '../utils/capacitorUtils';

export interface HeaderProps {
  activeItem?: string;
  currentPageLabel?: string | React.ReactNode;
  title?: React.ReactNode;
  onNotificationsClick?: () => void;
  unreadCount?: number;
  notifications?: NotificationType[];
  onMarkAllAsRead?: () => void;
  onMarkAsRead?: (id: string) => void;
  onMenuClick: () => void;
  onMessengerClick?: () => void;
  onCalendarClick?: () => void;
  unreadMessagesCount?: number;
  rightActions?: React.ReactNode;
  leftActions?: React.ReactNode;
  userProfile?: UserProfile;
  className?: string;
  onNavigate?: (route: string) => void;
  onLogoutClick?: () => void;
  hideTitle?: boolean;
  hideDefaultRightActions?: boolean;
  hideProfileAvatar?: boolean;
  onNewChat?: () => void;
  onClearChat?: () => void;
  onDeleteChat?: () => void;
  hasActiveChat?: boolean;
  hasMessages?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ 
  activeItem,
  currentPageLabel, 
  title,
  onNotificationsClick, 
  unreadCount = 0, 
  notifications = [],
  onMarkAllAsRead,
  onMarkAsRead,
  onMenuClick, 
  onMessengerClick, 
  onCalendarClick,
  unreadMessagesCount = 0,
  rightActions,
  leftActions,
  userProfile,
  className,
  onNavigate,
  onLogoutClick,
  hideTitle,
  hideDefaultRightActions,
  onNewChat,
  onClearChat,
  onDeleteChat,
  hasActiveChat = false,
  hasMessages = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAiPage = activeItem === 'chat' || activeItem === 'dashboard';
  const isFloating = className?.includes('absolute') || className?.includes('fixed');

  // Handle click outside and Escape key to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  return (
    <header 
      className={`z-40 flex items-center justify-between w-full ${
        isFloating
          ? className
          : `sticky top-0 flex-shrink-0 px-3 sm:px-6 md:px-8 py-2.5 ${
              className || 'bg-white/70 dark:bg-black/60 backdrop-blur-xl border-b border-black/5 dark:border-white/8'
            }`
      }`}
    >
      {/* Left Slot: Menu Hamburger Circular Button */}
      <div className="flex items-center gap-2 min-w-[40px] shrink-0">
        {leftActions ? (
          leftActions
        ) : (
          <button 
            type="button"
            onClick={onMenuClick}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white dark:bg-[#212124] shadow-md hover:shadow-lg border border-black/5 dark:border-white/10 flex items-center justify-center text-neutral-800 dark:text-white transition-all active:scale-95 cursor-pointer relative shrink-0 pointer-events-auto"
            aria-label="Toggle menu"
            title="Menu"
          >
            {/* 3 horizontal black lines of equal length & thickness with uniform vertical spacing */}
            <svg className="w-5 h-5 text-neutral-800 dark:text-neutral-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
            {(unreadCount > 0 || unreadMessagesCount > 0) && (
              <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
              </span>
            )}
          </button>
        )}
        {!leftActions && !hideTitle && !isAiPage && userProfile?.use_personal_token && userProfile?.personal_api_key && (
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-500 text-[10px] font-black tracking-widest uppercase rounded-full border border-amber-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            AI Token Active
          </span>
        )}
      </div>

      {/* Center Slot: Centered Title or Empty for AI Chat */}
      <div className="flex-1 flex items-center justify-center min-w-0 px-2 pointer-events-none [&>*]:pointer-events-auto">
        {isAiPage ? null : title ? (
          title
        ) : hideTitle ? null : React.isValidElement(currentPageLabel) ? (
          currentPageLabel
        ) : typeof currentPageLabel === 'string' ? (
          <h1 className="text-base sm:text-[17px] font-semibold text-neutral-900 dark:text-white tracking-tight truncate max-w-[200px] sm:max-w-md text-center">
            {currentPageLabel}
          </h1>
        ) : null}
      </div>

      {/* Right Slot: Combined Pill Control + Optional Update Badge */}
      <div className="flex items-center gap-2 min-w-[40px] justify-end shrink-0">
        {!hideDefaultRightActions && !isAiPage && <AppUpdateBadge />}

        {rightActions ? (
          rightActions
        ) : (
          <div className="relative pointer-events-auto" ref={dropdownRef}>
            {/* Combined Pill Container */}
            <div className="h-10 sm:h-11 rounded-full bg-white dark:bg-[#212124] shadow-md hover:shadow-lg border border-black/5 dark:border-white/10 px-1.5 flex items-center gap-1 shrink-0">
              {/* Primary Action Button: Pencil for AI Chat, Bell for Other Pages */}
              {isAiPage ? (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer"
                  aria-label="New chat"
                  title="New chat"
                >
                  {/* Outlined square with diagonal pencil glyph (black stroke) */}
                  <svg className="w-4 h-4 text-neutral-900 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsNotificationOpen((prev) => !prev);
                      onNotificationsClick?.();
                    }}
                    className={`relative w-8 h-8 rounded-full flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer ${
                      isNotificationOpen ? 'bg-neutral-100 dark:bg-white/10' : ''
                    }`}
                    aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
                    title="Notifications"
                  >
                    {/* Notification Bell Icon */}
                    <svg className="w-4 h-4 text-neutral-900 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    {unreadCount > 0 && (
                      <span className="absolute top-1 right-1 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0066FF] opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0066FF]" />
                      </span>
                    )}
                  </button>

                  {/* Notification Dropdown Popup */}
                  <NotificationDropdown
                    isOpen={isNotificationOpen}
                    onClose={() => setIsNotificationOpen(false)}
                    notifications={notifications}
                    onMarkAllAsRead={() => onMarkAllAsRead?.()}
                    onMarkAsRead={(id) => onMarkAsRead?.(id)}
                    onNavigate={(route) => {
                      setIsNotificationOpen(false);
                      onNavigate?.(route);
                    }}
                    onViewAll={() => {
                      setIsNotificationOpen(false);
                      onNavigate?.('notifications');
                    }}
                  />
                </div>
              )}

              {/* Vertical Hairline Divider */}
              <div className="w-px h-5 bg-neutral-200 dark:bg-white/10 mx-0.5" />

              {/* Three Dot Kebab Menu Button */}
              <button
                type="button"
                onClick={() => setIsMenuOpen((prev) => !prev)}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer ${
                  isMenuOpen ? 'bg-neutral-100 dark:bg-white/10' : ''
                }`}
                aria-label="More options"
                title="More options"
                aria-expanded={isMenuOpen}
              >
                <svg className="w-4 h-4 fill-current text-neutral-900 dark:text-white" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.75" />
                  <circle cx="12" cy="12" r="1.75" />
                  <circle cx="12" cy="19" r="1.75" />
                </svg>
              </button>
            </div>

            {/* Three Dot Dropdown Popover */}
            {isMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 sm:w-60 bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl border border-neutral-200/80 dark:border-white/10 py-1.5 z-50 animate-in fade-in slide-in-from-top-2">
                {userProfile && (
                  <div className="px-3.5 py-2 border-b border-neutral-100 dark:border-white/10 mb-1">
                    <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                      {userProfile.display_name || 'Student'}
                    </p>
                    <p className="text-[10px] font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
                      {userProfile.level || 'Academic'} Level
                    </p>
                  </div>
                )}

                {/* Settings page plus icon */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onNavigate?.('settings');
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-white transition cursor-pointer text-left"
                >
                  <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>User Settings</span>
                </button>

                {/* Upgrade to Pro */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    const baseUrl = isNative() ? 'https://avelut.xyz' : window.location.origin;
                    const plansUrl = `${baseUrl}/plans?uid=${userProfile?.uid || ''}&plan=premium`;
                    if (isNative()) {
                      window.open(plansUrl, '_system');
                    } else {
                      window.open(plansUrl, '_blank');
                    }
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2 text-xs sm:text-sm font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span>Upgrade to Pro</span>
                  </div>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-[#1C1C1C] text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    Pro
                  </span>
                </button>

                {/* Calendar link plus icon */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (onCalendarClick) {
                      onCalendarClick();
                    } else if (onNavigate) {
                      onNavigate('timetable');
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-white transition cursor-pointer text-left"
                >
                  <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <span>Study Timetable</span>
                </button>

                {/* Messenger plus icon */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (onMessengerClick) {
                      onMessengerClick();
                    } else if (onNavigate) {
                      onNavigate('messenger');
                    }
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-white transition cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span>Messenger</span>
                  </div>
                  {unreadMessagesCount > 0 && (
                    <span className="min-w-4 h-4 rounded-full bg-[#0066FF] px-1 text-[9px] font-bold leading-4 text-white flex items-center justify-center">
                      {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                    </span>
                  )}
                </button>

                {/* User profile plus icon */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onNavigate?.('user_profile');
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-white transition cursor-pointer text-left"
                >
                  <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span>My Profile</span>
                </button>

                {/* Help & Support */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onNavigate?.('help');
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-white transition cursor-pointer text-left"
                >
                  <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Help & Support</span>
                </button>

                {isAiPage && (hasMessages || hasActiveChat) && (
                  <>
                    <div className="border-t border-neutral-100 dark:border-white/10 my-1" />
                    {hasMessages && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onClearChat?.();
                        }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 hover:text-neutral-900 dark:hover:text-white transition cursor-pointer text-left"
                      >
                        <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Clear messages</span>
                      </button>
                    )}
                    {hasActiveChat && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onDeleteChat?.();
                        }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs sm:text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer text-left"
                      >
                        <svg className="w-4 h-4 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Delete conversation</span>
                      </button>
                    )}
                  </>
                )}

                <div className="border-t border-neutral-100 dark:border-white/10 my-1" />

                {/* Log Out */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onLogoutClick?.();
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition cursor-pointer text-left"
                >
                  <svg className="w-4 h-4 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};