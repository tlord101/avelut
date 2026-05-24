
import React from 'react';
import { NotificationBellIcon } from './icons/NotificationBellIcon';
import { MenuIcon } from './icons/MenuIcon';
import { MessengerIcon } from './icons/MessengerIcon';

interface HeaderProps {
  currentPageLabel: string;
  onNotificationsClick?: () => void;
  unreadCount?: number;
  onMenuClick: () => void;
  onMessengerClick?: () => void;
  unreadMessagesCount?: number;
  rightActions?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ 
    currentPageLabel, 
    onNotificationsClick, 
    unreadCount = 0, 
    onMenuClick, 
    onMessengerClick, 
    unreadMessagesCount = 0,
    rightActions
}) => {
    return (
        <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 md:px-8 pt-4 sm:pt-6 md:pt-8 pb-6 bg-transparent">
            <div className="flex items-center">
                <button
                  onClick={onMenuClick}
                  data-tour-id="mobile-menu-button"
                  className="md:hidden mr-4 w-10 h-10 bg-white border border-gray-100 rounded-xl flex items-center justify-center text-charcoal opacity-70 hover:opacity-100 transition-opacity shadow-sm"
                  aria-label="Open menu"
                >
                  <MenuIcon />
                </button>
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl md:text-3xl font-bold text-charcoal tracking-tighter uppercase">
                        {currentPageLabel}
                    </h2>
                </div>
            </div>

            <div className="flex items-center gap-2">
                {rightActions ? rightActions : (
                    <>
                        <button 
                            onClick={onMessengerClick}
                            data-tour-id="header-messenger"
                            className="relative text-charcoal opacity-60 hover:opacity-100 p-2 rounded-full hover:bg-white transition-all"
                            aria-label={`Messenger (${unreadMessagesCount} unread)`}
                        >
                            <MessengerIcon />
                            {unreadMessagesCount > 0 && (
                                <div className="absolute top-1 right-1">
                                    <span className="flex h-2 w-2 rounded-full bg-emerald ring-2 ring-white" />
                                </div>
                            )}
                        </button>
                        <button 
                            onClick={onNotificationsClick}
                            className="relative text-charcoal opacity-60 hover:opacity-100 p-2 rounded-full hover:bg-white transition-all"
                            aria-label={`Notifications (${unreadCount} unread)`}
                        >
                            <NotificationBellIcon />
                            {unreadCount > 0 && (
                                <div className="absolute top-1 right-1">
                                    <span className="flex h-2 w-2 rounded-full bg-emerald ring-2 ring-white" />
                                </div>
                            )}
                        </button>
                    </>
                )}
            </div>
        </header>
    );
};