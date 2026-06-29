import React, { useState, useRef, useEffect } from 'react';
import { NotificationBellIcon } from './icons/NotificationBellIcon';
import { MenuIcon } from './icons/MenuIcon';
import { MessengerIcon } from './icons/MessengerIcon';
import { Avatar } from './Avatar';
import type { UserProfile } from '../types';

interface HeaderProps {
  currentPageLabel: string;
  onNotificationsClick?: () => void;
  unreadCount?: number;
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
}

export const Header = React.memo<HeaderProps>(({
    currentPageLabel, 
    onNotificationsClick, 
    unreadCount = 0, 
    onMenuClick, 
    onMessengerClick, 
    onCalendarClick,
    unreadMessagesCount = 0,
    rightActions,
    leftActions,
    userProfile,
    className,
    onNavigate,
    onLogoutClick
}) => {
    const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsAvatarMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleNavigation = (route: string) => {
        setIsAvatarMenuOpen(false);
        if (onNavigate) {
            onNavigate(route);
        }
    };

    return (
        <header className={`sticky top-0 z-50 flex-shrink-0 flex items-center justify-between px-4 sm:px-6 md:px-8 pt-4 sm:pt-6 md:pt-8 pb-6 ${className || 'bg-transparent'}`}>
            <div className="flex items-center">
                <div className="flex items-center gap-3">
                    {leftActions && <div className="flex items-center">{leftActions}</div>}
                    <h2 className="text-2xl md:text-3xl font-bold text-charcoal dark:text-white tracking-tighter uppercase">
                        {currentPageLabel}
                    </h2>
                    {userProfile?.use_personal_token && userProfile?.personal_api_key && (
                        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-lime-500 to-emerald-600 text-white text-[10px] font-black tracking-widest uppercase rounded-full shadow-sm shadow-lime-500/20 border border-lime-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-white dark:bg-black animate-pulse" />
                            Google AI Token Active
                        </span>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {rightActions ? rightActions : (
                    <>
                        <button 
                            onClick={onCalendarClick}
                            className="relative text-blue-500 dark:text-white hover:text-blue-600 dark:hover:text-white p-2 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
                            aria-label="Study Timetable"
                            title="Study Timetable"
                        >
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                        </button>
                        <button 
                            onClick={onMessengerClick}
                            data-tour-id="header-messenger"
                            className="relative text-charcoal dark:text-white opacity-60 hover:opacity-100 p-2 rounded-full hover:bg-white dark:bg-black dark:hover:bg-slate-800 transition-all"
                            aria-label={`Messenger (${unreadMessagesCount} unread)`}
                        >
                            <MessengerIcon />
                            {unreadMessagesCount > 0 && (
                                <div className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white shadow-sm ring-2 ring-white dark:ring-slate-800">
                                    {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                                </div>
                            )}
                        </button>
                        <button 
                            onClick={onNotificationsClick}
                            className="relative text-charcoal dark:text-white opacity-60 hover:opacity-100 p-2 rounded-full hover:bg-white dark:bg-black dark:hover:bg-slate-800 transition-all"
                            aria-label={`Notifications (${unreadCount} unread)`}
                        >
                            <NotificationBellIcon />
                            {unreadCount > 0 && (
                                <div className="absolute top-1 right-1">
                                    <span className="flex h-2 w-2 rounded-full bg-red-600 ring-2 ring-white dark:ring-slate-800 animate-pulse" />
                                </div>
                            )}
                        </button>
                    </>
                )}
                
                {/* Profile Avatar always shows */}
                <div className="relative ml-2" ref={menuRef}>
                    <button
                                onClick={() => setIsAvatarMenuOpen(!isAvatarMenuOpen)}
                                className="focus:outline-none transition-transform active:scale-95"
                            >
                                <Avatar 
                                    display_name={userProfile?.display_name || null} 
                                    photo_url={userProfile?.photo_url} 
                                    className="w-10 h-10 border-2 border-white shadow-sm ring-1 ring-slate-200" 
                                />
                            </button>

                            {isAvatarMenuOpen && (
                                <div className="absolute right-0 mt-3 w-56 bg-white dark:bg-black dark:bg-card rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-gray-800 py-2 z-50 animate-in fade-in slide-in-from-top-2">
                                    <div className="px-4 py-3 border-b border-slate-50 dark:border-gray-800 mb-2">
                                        <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{userProfile?.display_name || 'User'}</p>
                                        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 dark:text-gray-400 uppercase tracking-widest">{userProfile?.level || 'New'} Level</p>
                                    </div>
                                    <button
                                        onClick={() => handleNavigation('user_profile')}
                                        className="w-full text-left px-4 py-2 text-sm font-semibold text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:bg-black dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    >
                                        User Profile
                                    </button>
                                    <button
                                        onClick={() => handleNavigation('billing')}
                                        className="w-full text-left px-4 py-2 text-sm font-semibold text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:bg-black dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    >
                                        Billing & Subscriptions
                                    </button>
                                    <button
                                        onClick={() => handleNavigation('settings')}
                                        className="w-full text-left px-4 py-2 text-sm font-semibold text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:bg-black dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    >
                                        Account Settings
                                    </button>
                                    <button
                                        onClick={() => handleNavigation('help')}
                                        className="w-full text-left px-4 py-2 text-sm font-semibold text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:bg-black dark:hover:bg-slate-800 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    >
                                        Help & Support
                                    </button>
                                    <div className="border-t border-slate-50 my-2"></div>
                                    <button
                                        onClick={() => {
                                            setIsAvatarMenuOpen(false);
                                            if (onLogoutClick) onLogoutClick();
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-50 transition-colors"
                                    >
                                        Log Out
                                    </button>
                                </div>
                            )}
                        </div>
                {/* End of Avatar */}
            </div>
        </header>
    );
});

Header.displayName = 'Header';