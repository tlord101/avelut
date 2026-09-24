import { AuthUser } from '@/lib/backend';

type AddToastFn = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
type SetActiveItemFn = (item: string) => void;
type SetPendingChatIdFn = (chatId: string | null) => void;

/**
 * Remove all notification listeners (call on logout / unmount).
 */
export const cleanupNativeNotifications = async (): Promise<void> => {
  // No-op without push plugin
};

/**
 * Initialize notifications (safe no-op without push plugin).
 */
export const initNativeNotifications = async (
  _user: AuthUser | null,
  _addToast: AddToastFn,
  _setActiveItem: SetActiveItemFn,
  _setPendingChatId: SetPendingChatIdFn
): Promise<void> => {
  // Push notifications previously required remote push service.
  // Notifications are handled in-app via Supabase Realtime.
};

/**
 * Clears delivered notifications.
 */
export const clearDeliveredNotifications = async (): Promise<void> => {
  // No-op
};
