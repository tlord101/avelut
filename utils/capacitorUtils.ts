import { Capacitor } from '@capacitor/core';
import { StatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

/**
 * Returns true when the app is running as a native Capacitor app (Android/iOS).
 * Returns false when running in a web browser.
 */
export const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/**
 * Returns the current native platform: 'android' | 'ios' | 'web'
 */
export const getPlatform = (): string => {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
};

/**
 * Set the status bar style. Call this when navigating between dark/light screens.
 * @param dark - true for dark content (light background), false for light content (dark background)
 */
export const setStatusBarStyle = async (dark: boolean = true): Promise<void> => {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: dark ? StatusBarStyle.Dark : StatusBarStyle.Light });
    if (getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: dark ? '#FFFFFF' : '#002D62' });
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch (err) {
    console.warn('[capacitorUtils] setStatusBarStyle error:', err);
  }
};

/**
 * Set status bar to match the app's primary navy theme (login/splash screens)
 */
export const setStatusBarNavy = async (): Promise<void> => {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: StatusBarStyle.Light });
    if (getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#002D62' });
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch (err) {
    console.warn('[capacitorUtils] setStatusBarNavy error:', err);
  }
};

/**
 * Trigger a light haptic impact — use on button presses for tactile feedback.
 */
export const triggerHaptic = async (style: ImpactStyle = ImpactStyle.Light): Promise<void> => {
  if (!isNative()) return;
  try {
    await Haptics.impact({ style });
  } catch (err) {
    // Silently ignore — haptics not critical
  }
};

/**
 * Listen to keyboard events and call the provided callbacks.
 * Returns a cleanup function to remove listeners.
 */
export const listenToKeyboard = (
  onShow: (keyboardHeight: number) => void,
  onHide: () => void
): (() => void) => {
  if (!isNative()) return () => {};

  const showHandler = Keyboard.addListener('keyboardWillShow', (info) => {
    onShow(info.keyboardHeight);
  });
  const hideHandler = Keyboard.addListener('keyboardWillHide', () => {
    onHide();
  });

  return () => {
    showHandler.then(l => l.remove()).catch(() => {});
    hideHandler.then(l => l.remove()).catch(() => {});
  };
};
