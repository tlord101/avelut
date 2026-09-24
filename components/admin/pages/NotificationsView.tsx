import React, { useState } from 'react';
import { db, auth, ref as dbRef, push, update, set } from '@/lib/backend';
import { Type, createAvelutAI } from '../../../utils/inference';
import { useToast } from '../../../hooks/useToast';
import type { UserProfile } from '../../../types';

interface NotificationsViewProps {
    allUsersList: UserProfile[];
    aiApiKey?: string;
    aiModel?: string;
    refreshSentNotifications?: () => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({ 
    allUsersList, 
    aiApiKey,
    aiModel = 'qwen/qwen3.7-flash',
    refreshSentNotifications 
}) => {
    const { addToast } = useToast();
    const [notificationAudience, setNotificationAudience] = useState<'general' | 'personal'>('general');
    const [recipientMode, setRecipientMode] = useState<'all' | 'single'>('all');
    const [selectedRecipientId, setSelectedRecipientId] = useState('');
    const [announcementTitle, setAnnouncementTitle] = useState('');
    const [announcementMessage, setAnnouncementMessage] = useState('');
    const [notificationType, setNotificationType] = useState<'study_update' | 'exam_reminder' | 'welcome' | 'study_reminder' | 'study_partner_request' | 'messenger' | 'app_update' | 'general_info' | 'personal'>('general_info');
    const [notificationRoute, setNotificationRoute] = useState('dashboard');
    const [isSendingPush, setIsSendingPush] = useState(false);

    const ai = createAvelutAI({ openrouter_api_key: aiApiKey, openrouter_model: aiModel } as any);

    const notificationRoutes = [
        { value: 'dashboard', label: 'Dashboard' },
        { value: 'study_guide', label: 'Study Guide' },
        { value: 'messenger', label: 'Messenger' },
        { value: 'study_partners', label: 'Study Partners' },
        { value: 'leaderboard', label: 'Leaderboard' },
        { value: 'settings', label: 'Settings' },
    ];

    const notificationStyles = [
        { value: 'general_info', label: 'General Info' },
        { value: 'personal', label: 'Personal' },
        { value: 'study_update', label: 'Study Update' },
        { value: 'study_reminder', label: 'Study Reminder' },
        { value: 'exam_reminder', label: 'Exam Reminder' },
        { value: 'messenger', label: 'Messenger' },
        { value: 'study_partner_request', label: 'Study Partner Request' },
        { value: 'app_update', label: 'App Update' },
        { value: 'welcome', label: 'Welcome' },
    ] as const;

    const getTargetUsers = () => {
        if (notificationAudience === 'general' || recipientMode === 'all') {
            return allUsersList;
        }
        return allUsersList.filter(user => user.uid === selectedRecipientId);
    };

    const handleSendPushNotification = async () => {
        const title = announcementTitle.trim();
        const message = announcementMessage.trim();
        if (!title || !message) {
            addToast("Please enter both title and message", "error");
            return;
        }

        const targetUsers = getTargetUsers();
        if (targetUsers.length === 0) {
            addToast("Please select a valid recipient", "error");
            return;
        }

        setIsSendingPush(true);
        try {
            const updates: Record<string, any> = {};
            const skippedUsers: string[] = [];
            targetUsers.forEach(user => {
                const notificationId = push(dbRef(db, `notifications/${user.uid}`)).key;
                if (!notificationId) {
                    skippedUsers.push(user.display_name || user.uid);
                    return;
                }
                updates[`notifications/${user.uid}/${notificationId}`] = {
                    type: notificationType,
                    category: notificationType,
                    audience: notificationAudience === 'personal' ? 'single' : 'all',
                    route: notificationRoute,
                    title,
                    message,
                    is_read: false,
                    timestamp: Date.now(),
                };
            });

            if (Object.keys(updates).length === 0) {
                addToast("Could not prepare notifications", "error");
                return;
            }

            await update(dbRef(db), updates);
            setAnnouncementTitle('');
            setAnnouncementMessage('');
            
            const logId = push(dbRef(db, 'sent_notifications')).key;
            if (logId) {
                const targetLabel = recipientMode === 'all' 
                    ? 'All Users' 
                    : allUsersList.find(u => u.uid === selectedRecipientId)?.display_name || selectedRecipientId;
                await set(dbRef(db, `sent_notifications/${logId}`), {
                    title,
                    message,
                    type: notificationType,
                    category: notificationType,
                    audience: notificationAudience === 'personal' ? 'single' : 'all',
                    route: notificationRoute,
                    recipient: targetLabel,
                    timestamp: Date.now(),
                    sent_by: auth.currentUser?.email || 'admin'
                });
                if (refreshSentNotifications) refreshSentNotifications();
            }

            const successfulSends = targetUsers.length - skippedUsers.length;
            if (skippedUsers.length > 0) {
                addToast(`Push sent to ${successfulSends} user(s). Skipped some due to ID generation failures.`, "info");
            } else {
                addToast(`Push notification sent to ${successfulSends} user${successfulSends !== 1 ? 's' : ''}.`, "success");
            }
        } catch (error: any) {
            console.error("Error sending push notifications:", error);
            addToast(error?.message || "Failed to send push notification", "error");
        } finally {
            setIsSendingPush(false);
        }
    };

    const handleSuggestAnnouncement = async () => {
        if (!ai || !aiModel) {
            addToast("AI features are unavailable because the Avelut AI API key or model is not configured in App Controls.", "error");
            return;
        }
        setIsSendingPush(true);
        try {
            const prompt = `Create a short notification title (max 8 words) and a concise notification message (max 200 characters) for a ${notificationType.replace('_', ' ')} notification to students. Return only a JSON object with keys "title" and "message".`;

            const response = await ai.models.generateContent({
                model: aiModel,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            title: { type: Type.STRING },
                            message: { type: Type.STRING }
                        },
                        required: ['title', 'message']
                    }
                }
            });

            const responseText = (response as any).text || '';
            if (!responseText) throw new Error('AI returned an empty suggestion.');
            const data = JSON.parse(responseText);
            setAnnouncementTitle((data.title || '').toString());
            setAnnouncementMessage((data.message || '').toString());
            addToast('Suggested announcement generated.', 'success');
        } catch (error: any) {
            console.error('Error generating suggestion:', error);
            addToast(error?.message || 'Failed to generate suggestion', 'error');
        } finally {
            setIsSendingPush(false);
        }
    };

    return (
        <div className="max-w-4xl bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 sm:p-8 space-y-8 text-slate-900 dark:text-slate-100">
            <div>
                <h3 className="font-black text-xl text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                    <i className="bi bi-bell-fill text-amber-500"></i>
                    <span>Push Notifications</span>
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Send direct push notifications to user devices.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">Recipient Selection</h4>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Audience</label>
                        <select
                            value={notificationAudience}
                            onChange={(e) => {
                                const nextAudience = e.target.value as 'general' | 'personal';
                                setNotificationAudience(nextAudience);
                                setRecipientMode(nextAudience === 'personal' ? 'single' : 'all');
                            }}
                            className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl outline-none focus:border-amber-500 text-sm cursor-pointer"
                        >
                            <option value="general">General info for all users</option>
                            <option value="personal">Personal notification</option>
                        </select>
                    </div>

                    {recipientMode === 'single' && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Select User</label>
                            <select
                                value={selectedRecipientId}
                                onChange={(e) => setSelectedRecipientId(e.target.value)}
                                className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl outline-none focus:border-amber-500 text-sm cursor-pointer"
                            >
                                <option value="" disabled>Select a user...</option>
                                {allUsersList.map(user => (
                                    <option key={user.uid} value={user.uid}>
                                        {user.display_name || 'Unnamed'} ({user.email || 'No email'})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                <div className="space-y-4">
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm">Notification Content</h4>
                    
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Notification Category</label>
                        <select
                            value={notificationType}
                            onChange={(e) => setNotificationType(e.target.value as any)}
                            className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl outline-none focus:border-amber-500 text-sm cursor-pointer"
                        >
                            {notificationStyles.map(style => (
                                <option key={style.value} value={style.value}>{style.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Open Page</label>
                        <select
                            value={notificationRoute}
                            onChange={(e) => setNotificationRoute(e.target.value)}
                            className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl outline-none focus:border-amber-500 text-sm cursor-pointer"
                        >
                            {notificationRoutes.map(route => (
                                <option key={route.value} value={route.value}>{route.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex justify-between">
                            <span>Title</span>
                            <button onClick={handleSuggestAnnouncement} disabled={isSendingPush || !ai} className="text-amber-500 flex items-center gap-1 hover:text-amber-400 disabled:opacity-50 cursor-pointer">
                                <i className="bi bi-stars"></i>
                                <span>Auto-suggest</span>
                            </button>
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. Server Maintenance"
                            value={announcementTitle}
                            onChange={(e) => setAnnouncementTitle(e.target.value)}
                            className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl outline-none focus:border-amber-500 text-sm"
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Message</label>
                        <textarea
                            rows={3}
                            placeholder="Enter notification content..."
                            value={announcementMessage}
                            onChange={(e) => setAnnouncementMessage(e.target.value)}
                            className="w-full p-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl outline-none focus:border-amber-500 text-sm resize-none"
                        />
                    </div>

                    <button
                        onClick={handleSendPushNotification}
                        disabled={isSendingPush || !announcementTitle.trim() || !announcementMessage.trim()}
                        className="w-full py-4 bg-slate-900 dark:bg-amber-500 hover:bg-slate-800 dark:hover:bg-amber-400 text-white dark:text-slate-950 rounded-xl font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 cursor-pointer"
                    >
                        <i className="bi bi-send-fill text-sm"></i>
                        <span>{isSendingPush ? 'Sending...' : 'Send Push Notification'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
