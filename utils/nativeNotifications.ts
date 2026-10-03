/**
 * Notifications powered purely by OneSignal.
 * @capacitor/local-notifications has been removed.
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

const DAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

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

export async function requestLocalNotificationPermission(): Promise<boolean> {
  if (isNative()) {
     try {
         return await OneSignal.Notifications.requestPermission(true);
     } catch (e) {
         return false;
     }
  }
  return false;
}

export async function scheduleStudyReminders(
  sessions: ReminderSession[],
  options?: { enabled?: boolean }
): Promise<void> {
  // To schedule calendar events fully via OneSignal, we need to pass these to the backend.
  if (options?.enabled === false) {
    await cancelAllStudyReminders();
    return;
  }

  const toSchedule = [];
  for (const session of sessions) {
    if (!session?.id) continue;
    const startAt = nextOccurrence(session, 2);
    if (!startAt) continue;

    const subject = session.subject || 'Class';
    const topic = session.topic || session.activity || '';
    const bodyCore = topic ? `${subject} — ${topic}` : subject;

    toSchedule.push({
      time: startAt.getTime(),
      title: 'Class starting',
      body: bodyCore
    });
  }

  if (toSchedule.length === 0) return;

  try {
     const apiBase = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() 
          ? 'https://www.avelut.xyz' 
          : '';
     
     // Note: We use window.localStorage to get the user's ID
     const uid = window.localStorage?.getItem('avelut_last_uid');
     if (!uid) return;

     await fetch(`${apiBase}/api/schedule-reminders`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
             targetUserId: uid,
             reminders: toSchedule
         })
     });
  } catch (e) {
     console.warn("Failed to schedule OneSignal reminders", e);
  }
}

export async function cancelStudyRemindersForSessions(sessionIds: string[]): Promise<void> {
  // Cancellation via OneSignal requires tracking notification IDs on the backend.
}

export async function cancelAllStudyReminders(): Promise<void> {
  // Cancellation via OneSignal requires tracking notification IDs on the backend.
}

export const clearDeliveredNotifications = async (): Promise<void> => {
  if (isNative()) {
      try {
          OneSignal.Notifications.clearAll();
      } catch {}
  }
};

export async function showMessengerNotification() {
  // Deprecated. We now send remote push notifications using OneSignal from lib/supabaseRealtimeDb.ts
}

export async function sendTestNotification() {
   // Deprecated. Test from OneSignal dashboard.
}

export const initNativeNotifications = async (
  user: AuthUser | null,
  addToast: AddToastFn,
  setActiveItem: SetActiveItemFn,
  setPendingChatId: SetPendingChatIdFn
): Promise<void> => {
  navigationHandlers = { addToast, setActiveItem, setPendingChatId };

  if (!user || !isNative()) return;

  await requestLocalNotificationPermission();

  if (listenersAttached) return;
  listenersAttached = true;

  try {
      OneSignal.Notifications.addEventListener('click', (event) => {
          const extra = event.notification.additionalData;
          if (extra && extra.route) {
              if (navigationHandlers.setActiveItem) {
                  navigationHandlers.setActiveItem(extra.route as string);
              }
          }
          if (extra && extra.chatId) {
              if (navigationHandlers.setPendingChatId) {
                  navigationHandlers.setPendingChatId(extra.chatId as string);
              }
          }
      });
  } catch (e) {
    console.warn('[OneSignal] Listener error:', e);
  }
};

export const cleanupNativeNotifications = async (): Promise<void> => {
  listenersAttached = false;
  navigationHandlers = {};
};
