import { FirebaseUser, db, push, ref as dbRef, set, update } from '@/lib/backend';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

import type { ToastType } from '../types';

type AddToastFn = (message: string, type: ToastType) => void;
type SetActiveItemFn = (item: string) => void;
type SetPendingChatIdFn = (chatId: string | null) => void;

const resolveNotificationScreen = (data: Record<string, any>): string | null => {
  const route = (data.route || data.screen || data.destination || data.page || '').toString().trim();
  if (!route) return null;

  const normalized = route.replace(/^\//, '').replace(/-/g, '_');
  const allowedScreens = new Set([
    'chat',
    'study_guide',
    'messenger',
    'leaderboard',
    'visual_solver',
    'study_partners',
    'settings',
  ]);

  if (allowedScreens.has(normalized)) return normalized;
  return route;
};

let _notificationsInitialized = false;
let _registrationListenerRef: any = null;
let _registrationErrorListenerRef: any = null;
let _pushReceivedListenerRef: any = null;
let _actionPerformedListenerRef: any = null;

/**
 * Save the device FCM token to Firebase RTDB so the server can send push notifications to this device.
 */
const saveFcmToken = async (uid: string, token: string): Promise<void> => {
  try {
    await update(dbRef(db, `user_device_tokens/${uid}`), {
      fcm_token: token,
      fcm_platform: Capacitor.getPlatform(),
      updated_at: Date.now()
    });
    console.log('[nativeNotifications] FCM token saved to user_device_tokens:', token.substring(0, 20) + '...');
  } catch (err) {
    console.error('[nativeNotifications] Failed to save FCM token:', err);
  }
};

/**
 * Remove all notification listeners (call on logout / unmount).
 */
export const cleanupNativeNotifications = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await _registrationListenerRef?.remove();
    await _registrationErrorListenerRef?.remove();
    await _pushReceivedListenerRef?.remove();
    await _actionPerformedListenerRef?.remove();
    _notificationsInitialized = false;
    _registrationListenerRef = null;
    _registrationErrorListenerRef = null;
    _pushReceivedListenerRef = null;
    _actionPerformedListenerRef = null;
  } catch (err) {
    console.warn('[nativeNotifications] Cleanup error:', err);
  }
};

/**
 * Initialize native push notifications for Capacitor (Android/iOS).
 * - Requests permission
 * - Registers for push and saves FCM token to Firebase
 * - Shows in-app toasts for foreground notifications
 * - On notification tap → navigates to the correct screen
 *
 * Safe to call on web — it no-ops if not running natively.
 */
export const initNativeNotifications = async (
  user: FirebaseUser | null,
  addToast: AddToastFn,
  setActiveItem: SetActiveItemFn,
  setPendingChatId: SetPendingChatIdFn
): Promise<void> => {
  // Only run on Android/iOS
  if (!Capacitor.isNativePlatform()) return;
  if (!user) return;
  if (_notificationsInitialized) return;

  _notificationsInitialized = true;

  try {
    // Step 1: Request permission
    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.warn('[nativeNotifications] Push notification permission denied.');
      return;
    }

    // Step 2: Register with FCM / APNS
    await PushNotifications.register();

    // Step 3: Listen for registration (token received)
    _registrationListenerRef = await PushNotifications.addListener('registration', async (token) => {
      console.log('[nativeNotifications] Registration token:', token.value.substring(0, 20) + '...');
      await saveFcmToken(user.uid, token.value);
    });

    // Step 4: Handle registration errors
    _registrationErrorListenerRef = await PushNotifications.addListener('registrationError', (err) => {
      console.error('[nativeNotifications] Registration error:', err);
    });

    // Step 5: Handle foreground push notifications (show as in-app toast)
    _pushReceivedListenerRef = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      const title = notification.title || 'AVELUT';
      const body = notification.body || '';
      const message = body ? `${title}: ${body}` : title;
      addToast(`🔔 ${message}`, 'info');
    });

    // Step 6: Handle notification tap (app action)
    _actionPerformedListenerRef = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification.data || {};
      
      // Handle Action Buttons (e.g. Reply)
      if (action.actionId === 'reply_action') {
         if (action.inputValue && data.chatId && user) {
           // User replied inline from the notification shade!
           try {
             const messagesRef = dbRef(db, `messages/${data.chatId}`);
             const newMsgRef = push(messagesRef);
             set(newMsgRef, {
               senderId: user.uid,   // must match Messenger's senderId field
               text: action.inputValue,
               timestamp: Date.now(),
               isRead: false
             });
             addToast('Reply sent', 'success');
           } catch (e) {
             console.error('Failed to send inline reply:', e);
             addToast('Failed to send reply', 'error');
           }
           return;
         } else if (data.chatId) {
           // Fallback to opening the app to the chat if no input was provided
           setTimeout(() => {
             setActiveItem('messenger');
             setPendingChatId(String(data.chatId));
           }, 50);
         }
         return;
      }

      // Handle Open Chat action button (from notification drawer)
      if (action.actionId === 'open_chat') {
        if (data.chatId) {
          setTimeout(() => {
            setActiveItem('messenger');
            setPendingChatId(String(data.chatId));
          }, 50);
        }
        return;
      }

      // Handle messenger chat open
      if (data.chatId) {
        setTimeout(() => {
          setActiveItem('messenger');
          setPendingChatId(String(data.chatId));
        }, 50);
        return;
      }

      // Handle open study guide
      if (action.actionId === 'open_study_guide') {
          setTimeout(() => setActiveItem('study_guide'), 50);
          return;
      }

      // Handle mark as read
      if (action.actionId === 'mark_as_read') {
          if (data.notificationId && user) {
              try {
                  const notifRef = dbRef(db, `notifications/${user.uid}/${data.notificationId}`);
                  update(notifRef, { is_read: true });
                  // We don't really need a toast for this, but it's nice feedback
              } catch (e) {
                  console.error('Failed to mark as read:', e);
              }
          }
          return;
      }

      const explicitScreen = resolveNotificationScreen(data);
      if (explicitScreen) {
        setTimeout(() => setActiveItem(explicitScreen), 50);
        return;
      }

      // Handle screen navigation
      if (data.screen) {
        const screenMap: Record<string, string> = {
          dashboard: 'chat',
          study_guide: 'study_guide',
          exam: 'exam',
          messenger: 'messenger',
          leaderboard: 'leaderboard',
          visual_solver: 'visual_solver',
          study_partners: 'study_partners',
          settings: 'settings',
        };
        const target = screenMap[data.screen];
        if (target) {
          // Delaying state update slightly prevents race conditions with app resume rendering glitch
          setTimeout(() => setActiveItem(target), 50);
        }
      }
    });

    // Register Notification Categories for Action Buttons
    try {
        await (PushNotifications as any).registerActionTypes({
            types: [
                {
                    id: 'MESSENGER_ACTION',
                    actions: [
                        {
                            id: 'reply_action',
                            title: 'Reply',
                            foreground: false,
                            input: true
                        }
                    ]
                },
                {
                    id: 'STUDY_GUIDE_ACTION',
                    actions: [
                        {
                            id: 'open_study_guide',
                            title: 'Open Study Guide',
                            foreground: true,
                        },
                        {
                            id: 'mark_as_read',
                            title: 'Mark as Read',
                            foreground: false,
                        }
                    ]
                }
            ]
        });
    } catch (e) {
        console.warn('[nativeNotifications] Action Types not supported on this platform', e);
    }

    // Step 7: Deliver any pending (tapped) notifications from when app was closed
    const deliveredNotifications = await PushNotifications.getDeliveredNotifications();
    if (deliveredNotifications.notifications.length > 0) {
      // Clear them so badge count resets
      await PushNotifications.removeAllDeliveredNotifications();
    }

    console.log('[nativeNotifications] Native push notifications initialized successfully.');
  } catch (err) {
    console.error('[nativeNotifications] Init error:', err);
    _notificationsInitialized = false;
  }
};

/**
 * Clears all delivered notifications from the notification center and resets badge count.
 * Call when user views the notifications panel.
 */
export const clearDeliveredNotifications = async (): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch (err) {
    console.warn('[nativeNotifications] clearDeliveredNotifications error:', err);
  }
};
