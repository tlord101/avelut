/**
 * Local notifications for calendar / study / exam reminders.
 * No FCM / OneSignal / remote push — device-scheduled only via
 * @capacitor/local-notifications. In-app notifications (messenger, etc.)
 * continue to use Supabase Realtime.
 */

import { Capacitor } from '@capacitor/core';
import type { AuthUser } from '@/lib/backend';
import OneSignal from '@onesignal/capacitor-plugin';

type AddToastFn = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
type SetActiveItemFn = (item: string) => void;
type SetPendingChatIdFn = (chatId: string | null) => void;

export interface ReminderSession {
  id: string;
  day: string;
  time: string;
  subject: string;
  topic?: string;
  activity?: string;
  date?: string; // YYYY-MM-DD optional specific date
}

const CHANNEL_ID = 'avelut_study_reminders';
const PRE_REMINDER_MINUTES = 15;
/** Stable notification id range (Capacitor requires number ids). */
const ID_BASE = 100000;

let listenersAttached = false;
let navigationHandlers: {
  setActiveItem?: SetActiveItemFn;
  setPendingChatId?: SetPendingChatIdFn;
  addToast?: AddToastFn;
} = {};

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function getLocalNotifications() {
  if (!isNative()) return null;
  try {
    const mod = await import('@capacitor/local-notifications');
    return mod.LocalNotifications;
  } catch (e) {
    console.warn('[LocalNotifications] Plugin not available:', e);
    return null;
  }
}

function hashId(sessionId: string, suffix: number): number {
  let h = 0;
  const s = `${sessionId}:${suffix}`;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return ID_BASE + (Math.abs(h) % 800000000) + suffix;
}

const DAY_MAP: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/**
 * Parse start time from strings like "08:30 AM - 09:15 AM" or "14:00-15:00".
 * Returns { hours, minutes } in 24h, or null.
 */
export function parseSessionStartTime(time: string): { hours: number; minutes: number } | null {
  if (!time || typeof time !== 'string') return null;
  const start = time.split('-')[0].trim();
  const m = start.match(/(\d{1,2})\s*:\s*(\d{2})\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const ampm = m[3]?.toUpperCase();
  if (ampm === 'PM' && hours < 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Next occurrence of day+time (or specific date) at least `minMinutesFromNow` in the future.
 */
export function nextOccurrence(
  session: ReminderSession,
  minMinutesFromNow = 1
): Date | null {
  const parsed = parseSessionStartTime(session.time);
  if (!parsed) return null;

  const now = new Date();
  const minAt = new Date(now.getTime() + minMinutesFromNow * 60 * 1000);

  if (session.date && /^\d{4}-\d{2}-\d{2}$/.test(session.date)) {
    const [y, mo, d] = session.date.split('-').map(Number);
    const at = new Date(y, mo - 1, d, parsed.hours, parsed.minutes, 0, 0);
    return at > minAt ? at : null;
  }

  const dayKey = (session.day || '').toLowerCase().trim();
  const targetDow = DAY_MAP[dayKey];
  if (targetDow === undefined) return null;

  for (let add = 0; add <= 14; add++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + add);
    candidate.setHours(parsed.hours, parsed.minutes, 0, 0);
    if (candidate.getDay() === targetDow && candidate > minAt) {
      return candidate;
    }
  }
  return null;
}

async function ensureChannel(
  LocalNotifications: NonNullable<Awaited<ReturnType<typeof getLocalNotifications>>>
): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Study reminders',
      description: 'Calendar, class, and exam reminders',
      importance: 4,
      visibility: 1,
      sound: 'default',
      vibration: true,
    });
  } catch {
    // Channel may already exist or platform may not support channels
  }
}

/**
 * Request permission and create Android notification channel.
 */
export async function requestLocalNotificationPermission(): Promise<boolean> {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) return false;
  try {
    await ensureChannel(LocalNotifications);
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return true;
    const result = await LocalNotifications.requestPermissions();
    return result.display === 'granted';
  } catch (e) {
    console.warn('[LocalNotifications] Permission error:', e);
    return false;
  }
}

/**
 * Schedule local reminders for a list of timetable sessions.
 * Schedules: (1) at class start, (2) PRE_REMINDER_MINUTES before, when possible.
 * Cancels previous notifications for the same session ids first.
 */
export async function scheduleStudyReminders(
  sessions: ReminderSession[],
  options?: { enabled?: boolean }
): Promise<void> {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) return;

  if (options?.enabled === false) {
    await cancelAllStudyReminders();
    return;
  }

  const granted = await requestLocalNotificationPermission();
  if (!granted) {
    console.warn('[LocalNotifications] Permission not granted — skip scheduling');
    return;
  }

  await ensureChannel(LocalNotifications);

  const idsToCancel: number[] = [];
  const toSchedule: Array<{
    id: number;
    title: string;
    body: string;
    schedule: { at: Date };
    channelId: string;
    extra: Record<string, string>;
  }> = [];

  for (const session of sessions) {
    if (!session?.id) continue;
    idsToCancel.push(hashId(session.id, 0), hashId(session.id, 1));

    const startAt = nextOccurrence(session, 2);
    if (!startAt) continue;

    const subject = session.subject || 'Class';
    const topic = session.topic || session.activity || '';
    const bodyCore = topic ? `${subject} — ${topic}` : subject;

    toSchedule.push({
      id: hashId(session.id, 0),
      title: 'Class starting',
      body: bodyCore,
      schedule: { at: startAt },
      channelId: CHANNEL_ID,
      extra: {
        type: 'study_reminder',
        route: 'timetable',
        sessionId: session.id,
      },
    });

    const preAt = new Date(startAt.getTime() - PRE_REMINDER_MINUTES * 60 * 1000);
    if (preAt.getTime() > Date.now() + 60_000) {
      toSchedule.push({
        id: hashId(session.id, 1),
        title: `In ${PRE_REMINDER_MINUTES} minutes`,
        body: bodyCore,
        schedule: { at: preAt },
        channelId: CHANNEL_ID,
        extra: {
          type: 'study_reminder',
          route: 'timetable',
          sessionId: session.id,
        },
      });
    }
  }

  try {
    if (idsToCancel.length) {
      await LocalNotifications.cancel({
        notifications: idsToCancel.map((id) => ({ id })),
      });
    }
  } catch {
    // ignore cancel errors for unknown ids
  }

  if (toSchedule.length === 0) return;

  try {
    await LocalNotifications.schedule({ notifications: toSchedule });
    console.log(`[LocalNotifications] Scheduled ${toSchedule.length} reminder(s)`);
  } catch (e) {
    console.warn('[LocalNotifications] Schedule failed:', e);
  }
}

/**
 * Cancel reminders for specific session ids.
 */
export async function cancelStudyRemindersForSessions(sessionIds: string[]): Promise<void> {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications || !sessionIds.length) return;
  const ids = sessionIds.flatMap((sid) => [hashId(sid, 0), hashId(sid, 1)]);
  try {
    await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
  } catch (e) {
    console.warn('[LocalNotifications] Cancel failed:', e);
  }
}

/**
 * Cancel all pending study reminders (best-effort: cancels by listing pending).
 */
export async function cancelAllStudyReminders(): Promise<void> {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) return;
  try {
    const pending = await LocalNotifications.getPending();
    const ours = (pending.notifications || []).filter(
      (n) => typeof n.id === 'number' && n.id >= ID_BASE
    );
    if (ours.length) {
      await LocalNotifications.cancel({
        notifications: ours.map((n) => ({ id: n.id })),
      });
    }
  } catch (e) {
    console.warn('[LocalNotifications] cancelAll failed:', e);
  }
}

/**
 * Clears delivered (already shown) notifications from the tray.
 */
export const clearDeliveredNotifications = async (): Promise<void> => {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) return;
  try {
    await LocalNotifications.removeAllDeliveredNotifications();
  } catch {
    // no-op
  }
};

export async function showMessengerNotification(
  chatId: string,
  senderName: string,
  message: string,
  messageHistory: string = ''
) {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) return;

  await ensureChannel(LocalNotifications);

  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'MESSENGER_REPLY',
          actions: [
            {
              id: 'reply',
              title: 'Reply',
              input: true
            }
          ]
        }
      ]
    });
  } catch (e) {
    console.warn('[LocalNotifications] Failed to register action type', e);
  }

  let fullBody = messageHistory;
  if (senderName && message) {
      fullBody = fullBody ? `${fullBody}\n${senderName}: ${message}` : `${senderName}: ${message}`;
  } else if (!fullBody) {
      fullBody = 'New message';
  }

  const notificationId = hashId(chatId, 999);

  await LocalNotifications.schedule({
    notifications: [{
      id: notificationId,
      title: 'New Message',
      body: fullBody,
      channelId: CHANNEL_ID,
      actionTypeId: 'MESSENGER_REPLY',
      extra: {
        type: 'messenger',
        route: 'messenger',
        chatId: chatId,
        history: fullBody
      }
    }]
  });
}

export async function sendTestNotification() {
  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) return;
  await ensureChannel(LocalNotifications);
  
  await LocalNotifications.schedule({
    notifications: [{
      id: Math.floor(Math.random() * 100000) + 200000,
      title: 'Test Notification',
      body: 'Notifications are working perfectly! 🎉',
      channelId: CHANNEL_ID,
      schedule: { at: new Date(Date.now() + 2000) } // 2 seconds from now
    }]
  });
}

/**
 * Attach tap listener once and store navigation callbacks.
 */
export const initNativeNotifications = async (
  user: AuthUser | null,
  addToast: AddToastFn,
  setActiveItem: SetActiveItemFn,
  setPendingChatId: SetPendingChatIdFn
): Promise<void> => {
  navigationHandlers = { addToast, setActiveItem, setPendingChatId };

  if (!user || !isNative()) return;

  const LocalNotifications = await getLocalNotifications();
  if (!LocalNotifications) return;

  await requestLocalNotificationPermission();

  if (listenersAttached) return;
  listenersAttached = true;

  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const extra = (action.notification?.extra || {}) as Record<string, string>;
      const route = extra.route || 'timetable';
      
      if (action.actionId === 'reply' && action.inputValue) {
         const chatId = extra.chatId;
         const history = extra.history || '';
         const newHistory = history ? `${history}\nYou: ${action.inputValue}` : `You: ${action.inputValue}`;
         
         window.dispatchEvent(new CustomEvent('avelut_messenger_reply', { 
            detail: { chatId, text: action.inputValue } 
         }));
         
         if (chatId) {
             void showMessengerNotification(chatId, '', '', newHistory);
         }
         
         if (Capacitor.isNativePlatform()) {
             OneSignal.Session.addOutcome('messenger_reply_inline').catch(() => {});
         }
         
         return;
      }

      if (navigationHandlers.setActiveItem) {
        navigationHandlers.setActiveItem(route);
      }
      if (extra.chatId && navigationHandlers.setPendingChatId) {
        navigationHandlers.setPendingChatId(extra.chatId);
      }
    });
  } catch (e) {
    console.warn('[LocalNotifications] Listener error:', e);
  }
};

/**
 * Remove listeners on logout / unmount.
 */
export const cleanupNativeNotifications = async (): Promise<void> => {
  const LocalNotifications = await getLocalNotifications();
  if (LocalNotifications) {
    try {
      await LocalNotifications.removeAllListeners();
    } catch {
      // ignore
    }
  }
  listenersAttached = false;
  navigationHandlers = {};
};
