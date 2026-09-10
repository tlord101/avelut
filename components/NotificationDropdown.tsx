import React, { useRef, useEffect } from 'react';
import type { Notification } from '../types';
import { NotificationTypeIcon, resolveNotificationRoute, timeAgo } from './Notifications';

interface NotificationDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  onMarkAllAsRead: () => void;
  onMarkAsRead: (id: string) => void;
  onNavigate: (route: string) => void;
  onViewAll: () => void;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAllAsRead,
  onMarkAsRead,
  onNavigate,
  onViewAll,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on click outside or escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const recentNotifications = notifications.slice(0, 5);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleNotificationClick = (notification: Notification) => {
    onMarkAsRead(notification.id);
    onClose();
    const route = resolveNotificationRoute(notification);
    if (route) {
      onNavigate(route);
    }
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full mt-2 w-[92vw] sm:w-96 max-w-[420px] bg-white dark:bg-[#1C1C1E] rounded-3xl shadow-2xl border border-neutral-200/80 dark:border-white/10 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 origin-top-right transition-all"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-neutral-100 dark:border-white/10 bg-neutral-50/50 dark:bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-neutral-900 dark:text-white">Notifications</span>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 text-[11px] font-extrabold bg-[#0066FF] text-white rounded-full">
              {unreadCount}
            </span>
          )}
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMarkAllAsRead();
            }}
            className="text-xs font-semibold text-[#0066FF] dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
          >
            Mark all as read
          </button>
        )}
      </div>

      {/* Notifications List (Max 5) */}
      <div className="max-h-[380px] overflow-y-auto divide-y divide-neutral-100 dark:divide-white/5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {recentNotifications.length > 0 ? (
          recentNotifications.map((notification) => (
            <div
              key={notification.id}
              onClick={() => handleNotificationClick(notification)}
              className={`flex items-start gap-3 p-3.5 transition-colors cursor-pointer ${
                notification.is_read
                  ? 'hover:bg-neutral-50 dark:hover:bg-white/5 text-neutral-700 dark:text-neutral-300'
                  : 'bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/70 dark:hover:bg-blue-950/40 text-neutral-900 dark:text-white font-medium'
              }`}
            >
              {/* Type Icon */}
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-[#2C2C2E] border border-neutral-200/60 dark:border-white/10 flex items-center justify-center shadow-xs mt-0.5">
                <NotificationTypeIcon type={notification.type} className="w-4 h-4" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-1">
                  <h4 className="text-xs sm:text-[13px] font-bold truncate text-neutral-900 dark:text-white">
                    {notification.title}
                  </h4>
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 whitespace-nowrap flex-shrink-0">
                    {timeAgo(notification.timestamp)}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2 mt-0.5 leading-snug">
                  {notification.message}
                </p>
              </div>

              {/* Unread dot */}
              {!notification.is_read && (
                <div className="w-2 h-2 rounded-full bg-[#0066FF] flex-shrink-0 mt-2" />
              )}
            </div>
          ))
        ) : (
          <div className="py-10 text-center px-4">
            <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-neutral-100 dark:bg-white/5 flex items-center justify-center text-neutral-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">No notifications yet</p>
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">You're all caught up!</p>
          </div>
        )}
      </div>

      {/* Footer: View All Notifications button */}
      <div className="p-2 border-t border-neutral-100 dark:border-white/10 bg-neutral-50/50 dark:bg-white/[0.02] text-center">
        <button
          type="button"
          onClick={() => {
            onClose();
            onViewAll();
          }}
          className="w-full py-2 px-3 text-xs font-bold text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white hover:bg-white dark:hover:bg-white/5 rounded-xl transition cursor-pointer"
        >
          View all notifications
        </button>
      </div>
    </div>
  );
};
