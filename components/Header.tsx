
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
        <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 md:px-8 pt-4 sm:pt-6 md:pt-8 pb-6">
            <div className="flex items-center">
                <button
                  onClick={onMenuClick}
                  data-tour-id="mobile-menu-button"
                  className="md:hidden mr-4 w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-900 transition-colors"
                  aria-label="Open menu"
                >
                  <MenuIcon />
                </button>
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl md:text-3xl font-bold text-gray-900">
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
                            className="relative text-gray-500 hover:text-gray-900 p-2 rounded-full hover:bg-gray-100 transition-colors"
                            aria-label={`Messenger (${unreadMessagesCount} unread)`}
                        >
                            <MessengerIcon />
                            {unreadMessagesCount > 0 && (
                                <div className="absolute top-0.5 right-0.5 transform translate-x-1/4 -translate-y-1/4">
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white ring-2 ring-white">
                                        {unreadMessagesCount > 9 ? '9+' : unreadMessagesCount}
                                    </span>
                                </div>
                            )}
                        </button>
                        <button 
                            onClick={onNotificationsClick}
                            className="relative text-gray-500 hover:text-gray-900 p-2 rounded-full hover:bg-gray-100"
                            aria-label={`Notifications (${unreadCount} unread)`}
                        >
                            <NotificationBellIcon />
                            {unreadCount > 0 && (
                                <div className="absolute top-0.5 right-0.5 transform translate-x-1/4 -translate-y-1/4">
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white ring-2 ring-white">
                                        {unreadCount > 9 ? '9+' : unreadCount}
                                    </span>
                                </div>
                            )}
                        </button>
                    </>
                )}
            </div>
        </header>
    );
};