
import React from 'react';
import { NotificationBellIcon } from './icons/NotificationBellIcon';
import { MenuIcon } from './icons/MenuIcon';
import { MessengerIcon } from './icons/MessengerIcon';
import { LogoIcon } from './icons/LogoIcon';

import type { UserProfile } from '../types';

interface HeaderProps {
  currentPageLabel: string;
  onNotificationsClick?: () => void;
  unreadCount?: number;
  onMenuClick: () => void;
  onMessengerClick?: () => void;
  onCalendarClick?: () => void;
  unreadMessagesCount?: number;
  rightActions?: React.ReactNode;
  userProfile?: UserProfile;
}

export const Header: React.FC<HeaderProps> = ({ 
    currentPageLabel, 
    onNotificationsClick, 
    unreadCount = 0, 
    onMenuClick, 
    onMessengerClick, 
    onCalendarClick,
    unreadMessagesCount = 0,
    rightActions,
    userProfile
}) => {
    const [deferredPrompt, setDeferredPrompt] = React.useState<any>(() => {
        if (typeof window !== 'undefined') {
            return (window as any).deferredPrompt || null;
        }
        return null;
    });
    const [isStandalone, setIsStandalone] = React.useState(false);
    const [isInstalling, setIsInstalling] = React.useState(false);

    React.useEffect(() => {
        if (typeof window !== 'undefined') {
            const isAppStandalone = window.matchMedia('(display-mode: standalone)').matches 
                || (window.navigator as any).standalone === true;
            setIsStandalone(isAppStandalone);
        }

        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
            (window as any).deferredPrompt = e;
        };

        const handlePromptAvailable = () => {
            if (typeof window !== 'undefined') {
                setDeferredPrompt((window as any).deferredPrompt || null);
            }
        };

        const handleAppInstalled = () => {
            setDeferredPrompt(null);
            if (typeof window !== 'undefined') {
                (window as any).deferredPrompt = null;
            }
            setIsStandalone(true);
            setIsInstalling(false);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);
        window.addEventListener('pwa-prompt-available', handlePromptAvailable);
        window.addEventListener('pwa-installed', handleAppInstalled);

        // Check if already captured in window
        if (typeof window !== 'undefined' && (window as any).deferredPrompt) {
            setDeferredPrompt((window as any).deferredPrompt);
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
            window.removeEventListener('pwa-prompt-available', handlePromptAvailable);
            window.removeEventListener('pwa-installed', handleAppInstalled);
        };
    }, []);

    React.useEffect(() => {
        let timeoutId: any;
        if (isInstalling) {
            timeoutId = setTimeout(() => {
                setIsInstalling(false);
            }, 20000); // 20s safety timeout
        }
        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [isInstalling]);

    const handleInstallClick = async () => {
        const activePrompt = deferredPrompt || (typeof window !== 'undefined' ? (window as any).deferredPrompt : null);
        if (!activePrompt) {
            const userAgent = window.navigator.userAgent.toLowerCase();
            const isIOS = /iphone|ipad|ipod/.test(userAgent);
            if (isIOS) {
                alert("To install VANTUTOR on iOS:\n\n1. Tap the Share button in Safari (at the bottom or top of your screen).\n2. Scroll down and tap 'Add to Home Screen'.");
            } else {
                alert("To install VANTUTOR:\n\n1. Tap the browser menu button (three vertical dots in Chrome).\n2. Select 'Install app' or 'Add to Home Screen'.");
            }
            return;
        }
        activePrompt.prompt();
        try {
            const { outcome } = await activePrompt.userChoice;
            console.log(`User response to install prompt: ${outcome}`);
            if (outcome === 'accepted') {
                setIsInstalling(true);
                setDeferredPrompt(null);
                if (typeof window !== 'undefined') {
                    (window as any).deferredPrompt = null;
                }
            }
        } catch (err) {
            console.error('Error during installation choice:', err);
        }
    };

    return (
        <header className="flex-shrink-0 flex items-center justify-between px-4 sm:px-6 md:px-8 pt-4 sm:pt-6 md:pt-8 pb-6 bg-transparent">
            <div className="flex items-center">
                <button
                  onClick={onMenuClick}
                  data-tour-id="mobile-menu-button"
                  className="md:hidden mr-4 w-10 h-10 bg-white border border-gray-100 rounded-xl flex items-center justify-center text-charcoal opacity-70 hover:opacity-100 transition-opacity shadow-sm"
                  aria-label="Open menu"
                >
                  <MenuIcon />
                </button>
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl md:text-3xl font-bold text-charcoal tracking-tighter uppercase">
                        {currentPageLabel}
                    </h2>
                    {userProfile?.use_personal_token && userProfile?.personal_api_key && (
                        <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-lime-500 to-emerald-600 text-white text-[10px] font-black tracking-widest uppercase rounded-full shadow-sm shadow-lime-500/20 border border-lime-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            Google AI Token Active
                        </span>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={handleInstallClick}
                    className="items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-lime-500 to-lime-600 hover:from-lime-600 hover:to-lime-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all duration-200 active:scale-95 border border-lime-400/50 mr-1"
                    title="Install App"
                    style={{ display: isStandalone ? 'none' : 'inline-flex' }}
                >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span className="hidden sm:inline">Install App</span>
                </button>
                {rightActions ? rightActions : (
                    <>
                        <button 
                            onClick={onCalendarClick}
                            className="relative text-charcoal opacity-60 hover:opacity-100 p-2 rounded-full hover:bg-white transition-all"
                            aria-label="Study Timetable"
                            title="Study Timetable"
                        >
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                        </button>
                        <button 
                            onClick={onMessengerClick}
                            data-tour-id="header-messenger"
                            className="relative text-charcoal opacity-60 hover:opacity-100 p-2 rounded-full hover:bg-white transition-all"
                            aria-label={`Messenger (${unreadMessagesCount} unread)`}
                        >
                            <MessengerIcon />
                            {unreadMessagesCount > 0 && (
                                <div className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full bg-red-600 px-1 text-[10px] font-bold leading-5 text-white shadow-sm ring-2 ring-white">
                                    {unreadMessagesCount > 99 ? '99+' : unreadMessagesCount}
                                </div>
                            )}
                        </button>
                        <button 
                            onClick={onNotificationsClick}
                            className="relative text-charcoal opacity-60 hover:opacity-100 p-2 rounded-full hover:bg-white transition-all"
                            aria-label={`Notifications (${unreadCount} unread)`}
                        >
                            <NotificationBellIcon />
                            {unreadCount > 0 && (
                                <div className="absolute top-1 right-1">
                                    <span className="flex h-2 w-2 rounded-full bg-red-600 ring-2 ring-white animate-pulse" />
                                </div>
                            )}
                        </button>
                    </>
                )}
            </div>

            {isInstalling && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[9999] animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 shadow-2xl rounded-3xl p-8 max-w-sm w-full mx-4 border border-gray-100 dark:border-slate-800 text-center flex flex-col items-center gap-6 animate-fade-in-up">
                        <div className="relative flex items-center justify-center w-24 h-24 rounded-full bg-[#EAF6FD] dark:bg-[#00467A]/50">
                            <div className="absolute inset-0 rounded-full border-4 border-t-transparent border-[#0088CC] animate-spin" />
                            <LogoIcon className="w-12 h-12 loader-logo relative z-10" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-charcoal dark:text-white">Installing VANTUTOR...</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                                Adding VANTUTOR to your device. This will only take a moment.
                            </p>
                        </div>
                        <button
                            onClick={() => setIsInstalling(false)}
                            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline transition mt-2 cursor-pointer"
                        >
                            Dismiss Overlay
                        </button>
                    </div>
                </div>
            )}
        </header>
    );
};