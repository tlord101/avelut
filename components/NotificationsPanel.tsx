import React from 'react';
import type { Notification } from '../types';
import { StudyGuideIcon } from './icons/StudyGuideIcon';
import { ExamIcon } from './icons/ExamIcon';
import { NotificationBellIcon } from './icons/NotificationBellIcon';

const timeAgo = (timestamp: number): string => {
  const now = Date.now();
  const seconds = Math.floor((now - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const NotificationTypeIcon: React.FC<{ type: Notification['type'], className?: string }> = ({ type, className = "w-6 h-6" }) => {
    switch (type) {
        case 'welcome':
            return <img src="/logo_icon.png" alt="AVELUT" className={`${className} object-contain`} />;
        case 'study_update':
            return <StudyGuideIcon className={className} />;
        case 'exam_reminder':
            return <ExamIcon className={className} />;
        default:
            return <NotificationBellIcon className={className} />;
    }
};

interface NotificationsPanelProps {
  notifications: Notification[];
  isOpen: boolean;
  onClose: () => void;
  onMarkAllAsRead: () => void;
  onMarkAsRead: (id: string) => void;
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ notifications, isOpen, onClose, onMarkAllAsRead, onMarkAsRead }) => {
    if (!isOpen) return null;

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true">
            <div className="absolute inset-0 bg-gray-900/30"></div>
            <div
                className="absolute top-20 right-4 md:right-6 lg:right-8 w-full max-w-sm bg-white/95 backdrop-blur-md rounded-2xl border border-gray-200 shadow-2xl"
                onClick={e => e.stopPropagation()} // Prevent clicks inside from closing the panel
            >
                <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                    <h3 className="font-bold text-gray-900 text-lg">Notifications</h3>
                    {unreadCount > 0 && (
                        <button onClick={onMarkAllAsRead} className="text-sm text-lime-600 hover:text-lime-500 font-semibold">
                            Clear Unread
                        </button>
                    )}
                </div>
                <div className="max-h-[60vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {notifications.length > 0 ? (
                        <ul>
                            {notifications.map(notification => (
                                <li key={notification.id} className="border-b border-gray-100 last:border-b-0">
                                    <button 
                                        onClick={() => onMarkAsRead(notification.id)}
                                        className="w-full text-left flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors"
                                    >
                                        {!notification.is_read && (
                                            <div className="w-2 h-2 rounded-full bg-lime-500 flex-shrink-0 mt-2" aria-label="Unread"></div>
                                        )}
                                        <div className={`text-gray-500 flex-shrink-0 ${notification.is_read ? 'ml-4' : ''}`}>
                                           <NotificationTypeIcon type={notification.type} />
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-semibold text-gray-800">{notification.title}</p>
                                            <p className="text-sm text-gray-600">{notification.message}</p>
                                            <p className="text-xs text-gray-500 mt-1">{timeAgo(notification.timestamp)}</p>
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="text-center p-8 text-gray-500">
                            <NotificationBellIcon className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                            <p>No notifications yet.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};