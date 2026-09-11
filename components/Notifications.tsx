import { auth, db, push, ref as dbRef, serverTimestamp as firebaseServerTimestamp, set } from '@/lib/backend';
import React, { useState, useEffect } from 'react';
import type { Notification } from '../types';
import { StudyGuideIcon } from './icons/StudyGuideIcon';
import { NotificationBellIcon } from './icons/NotificationBellIcon';
import { clearDeliveredNotifications } from '../utils/nativeNotifications';
import { useToast } from '../hooks/useToast';

const Send: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export const timeAgo = (timestamp: number): string => {
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

const normalizeRouteTarget = (route: string): string => {
    const trimmed = route.trim();
    if (!trimmed) return '';
    return trimmed
        .replace(/^\//, '')
        .replace(/\?.*$/, '')
        .replace(/-/g, '_');
};

const isKnownRouteTarget = (route: string): boolean => {
    return new Set([
        'chat',
        'study_guide',
        'messenger',
        'study_partners',
        'leaderboard',
        'visual_solver',
        'settings',
        'notifications',
    ]).has(route);
};

export const NotificationTypeIcon: React.FC<{ type: Notification['type'], className?: string }> = ({ type, className = "w-6 h-6" }) => {
    switch (type) {
        case 'welcome':
        case 'app_update':
        case 'general_info':
            return <img src="/logo_icon.png" alt="AVELUT" className={`${className} object-contain`} />;
        case 'study_update':
        case 'study_reminder':
            return <StudyGuideIcon className={className} />;
        case 'messenger':
        case 'study_partner_request':
        case 'personal':
            return <NotificationBellIcon className={className} />;
        default:
            return <NotificationBellIcon className={className} />;
    }
};

export const resolveNotificationRoute = (notification: Notification): string | null => {
    const candidates = [notification.route, notification.link];

    const navigateAction = notification.action_buttons?.find(button => button.action === 'navigate');
    const buttonRoute = (navigateAction as any)?.route || navigateAction?.metadata?.route;
    if (typeof buttonRoute === 'string' && buttonRoute.trim()) {
        candidates.push(buttonRoute);
    }

    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || !candidate.trim()) continue;
        const normalized = normalizeRouteTarget(candidate);
        if (isKnownRouteTarget(normalized)) return normalized;
        if (candidate.startsWith('/')) return candidate;
        return candidate;
    }

    switch (notification.type) {
        case 'study_update':
        case 'study_reminder':
            return 'study_guide';
        case 'exam_reminder':
            return 'exam';
        case 'study_partner_request':
            return 'study_partners';
        case 'messenger':
            return 'messenger';
        case 'app_update':
        case 'welcome':
        case 'general_info':
            return 'chat';
        case 'personal':
            return 'messenger';
        default:
            return 'chat';
    }
};

interface NotificationsProps {
  notifications: Notification[];
  onMarkAllAsRead: () => void;
  onMarkAsRead: (id: string) => void;
  onNavigate: (page: string, params?: any) => void;
}

export const Notifications: React.FC<NotificationsProps> = ({ notifications, onMarkAllAsRead, onMarkAsRead, onNavigate }) => {
    const { addToast } = useToast();
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyText, setReplyText] = useState('');

    useEffect(() => {
        clearDeliveredNotifications();
    }, []);

    const handleActionClick = (notification: Notification, action: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent the notification click handler from firing
        
        if (action === 'reply') {
            setReplyingTo(replyingTo === notification.id ? null : notification.id);
            setReplyText('');
            return;
        }

        const route = resolveNotificationRoute(notification);
        if (action === 'navigate' && route) {
            onMarkAsRead(notification.id);
            onNavigate(route);
        }
    };

    const handleSendReply = async (notification: Notification, e: React.MouseEvent) => {
        e.stopPropagation();
        
        if (!auth.currentUser || !notification.sender_id || !replyText.trim()) return;

        const currentUserId = auth.currentUser.uid;
        const targetUserId = notification.sender_id;
        const chatId = [currentUserId, targetUserId].sort().join('_');

        try {
            const messagesRef = dbRef(db, `messages/${chatId}`);
            const newMessageRef = push(messagesRef);
            
            await set(newMessageRef, {
                sender_id: currentUserId,
                text: replyText.trim(),
                timestamp: firebaseServerTimestamp(),
                status: 'sent'
            });

            addToast('Reply sent', 'success');
            setReplyingTo(null);
            setReplyText('');
            onMarkAsRead(notification.id);
        } catch (error) {
            console.error("Failed to send reply:", error);
            addToast('Failed to send reply', 'error');
        }
    };

    const handleNotificationClick = (notification: Notification) => {
        onMarkAsRead(notification.id);
        const route = resolveNotificationRoute(notification);
        if (route) {
            onNavigate(route);
        }
    };

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div className="flex-1 w-full max-w-4xl mx-auto h-full overflow-hidden flex flex-col bg-gray-50 dark:bg-black/50 md:rounded-2xl md:my-4 md:border border-gray-200 dark:border-gray-800 md:shadow-sm">
            {/* Header */}
            <div className="flex-none p-4 md:p-6 bg-white dark:bg-[#0A0A0A] border-b border-gray-200 dark:border-gray-800 flex justify-between items-center z-10 sticky top-0">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <NotificationBellIcon className="w-6 h-6 text-lime-600" />
                    Notifications
                </h1>
                {unreadCount > 0 && (
                    <button 
                        onClick={onMarkAllAsRead} 
                        className="px-4 py-2 text-sm font-medium text-lime-700 bg-lime-50 rounded-full hover:bg-lime-100 transition-colors"
                    >
                        Mark all as read
                    </button>
                )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {notifications.length > 0 ? (
                    notifications.map(notification => (
                        <div 
                            key={notification.id} 
                            onClick={() => handleNotificationClick(notification)}
                            className={`group relative overflow-hidden rounded-xl border p-4 transition-all duration-200 cursor-pointer
                                ${notification.is_read 
                                    ? 'bg-white dark:bg-[#0A0A0A] border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-sm' 
                                    : 'bg-lime-50/30 dark:bg-lime-900/10 border-lime-200 dark:border-lime-900 shadow-sm ring-1 ring-lime-500/10'}`}
                        >
                            {!notification.is_read && (
                                <div className="absolute top-0 left-0 w-1 h-full bg-lime-500 rounded-l-xl"></div>
                            )}
                            
                            <div className="flex items-start gap-4">
                                <div className={`flex-shrink-0 p-3 rounded-xl flex items-center justify-center 
                                    ${notification.is_read ? 'bg-gray-100 text-gray-500 dark:text-gray-400' : 'bg-lime-100 text-lime-600'}`}>
                                   <NotificationTypeIcon type={notification.type} />
                                </div>
                                
                                <div className="flex-1 min-w-0 pt-1">
                                    <div className="flex justify-between items-start gap-2 mb-1">
                                        <p className={`font-semibold text-base truncate ${notification.is_read ? 'text-gray-700 dark:text-gray-300' : 'text-gray-900 dark:text-white'}`}>
                                            {notification.title}
                                        </p>
                                        <span className="text-xs font-medium text-gray-400 whitespace-nowrap">
                                            {timeAgo(notification.timestamp)}
                                        </span>
                                    </div>
                                    <p className={`text-sm line-clamp-2 ${notification.is_read ? 'text-gray-500 dark:text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                        {notification.message}
                                    </p>

                                    {/* Inline Reply Input */}
                                    {replyingTo === notification.id && (
                                        <div 
                                            className="mt-3 flex items-center gap-2 animate-in slide-in-from-top-2 duration-200"
                                            onClick={(e) => e.stopPropagation()} // Keep clicks inside the input from triggering navigation
                                        >
                                            <input 
                                                type="text"
                                                value={replyText}
                                                onChange={(e) => setReplyText(e.target.value)}
                                                placeholder="Type your reply..."
                                                className="flex-1 bg-white dark:bg-black border border-gray-200  dark:text-white text-sm rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-lime-500 focus:border-transparent outline-none transition-all shadow-sm"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleSendReply(notification, e as any);
                                                }}
                                            />
                                            <button 
                                                onClick={(e) => handleSendReply(notification, e)}
                                                disabled={!replyText.trim()}
                                                className="p-2.5 rounded-xl bg-lime-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-lime-700 transition-colors shadow-sm"
                                            >
                                                <Send className="w-4 h-4" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-500 dark:text-gray-400">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <NotificationBellIcon className="w-10 h-10 text-gray-300" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">No notifications yet</h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-sm">When you receive new messages, partner requests, or study reminders, they will appear here.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
