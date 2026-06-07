import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { ref as dbRef, update } from 'firebase/database';
import { db } from '../firebase';
import type { FirebaseUser } from '../firebase';

type AddToastFn = (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
type SetActiveItemFn = (item: string) => void;
type SetPendingChatIdFn = (chatId: string | null) => void;

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
    await update(dbRef(db, `users/${uid}`), {
      fcm_token: token,
      fcm_platform: Capacitor.getPlatform(),
    });
    console.log('[nativeNotifications] FCM token saved to Firebase:', token.substring(0, 20) + '...');
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
      
      // Handle messenger chat open
      if (data.chatId) {
        setActiveItem('messenger');
        setPendingChatId(String(data.chatId));
        return;
      }

      // Handle screen navigation
      if (data.screen) {
        const screenMap: Record<string, string> = {
          dashboard: 'dashboard',
          study_guide: 'study_guide',
          exam: 'exam',
          messenger: 'messenger',
          leaderboard: 'leaderboard',
          visual_solver: 'visual_solver',
        };
        const target = screenMap[data.screen];
        if (target) {
          setActiveItem(target);
        }
      }
    });

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
