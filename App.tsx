import { auth as firebaseAuth, db, firebaseSignOut, get, off, onAuthStateChanged, onDisconnect, onValue, push, ref as dbRef, serverTimestamp, set, type FirebaseUser, update, updateProfile, supabase } from '@/lib/backend';
import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense, lazy } from 'react';
import { readCachedJson, writeCachedJson, clearCachedKey, initCacheFromSqlite } from './utils/cache';
import { DEFAULT_USAGE_SETTINGS } from './utils/appSettings';
import type { UserProfile, UserProgress, DashboardData, Notification as NotificationType, ExamHistoryItem, Course, DashboardAssessment, HeaderConfig, ChatConversation } from './types';
import { awardDailyStreak } from './utils/streaks';
import { Login } from './components/Login';
import { SignUp } from './components/SignUp';
import { AdminLogin } from './components/AdminLogin';
import { UploadCenter } from './components/UploadCenter';
import { Onboarding } from './components/Onboarding';

import { createAvelutAI } from './utils/inference';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapacitorApp } from '@capacitor/app';
import { Filesystem, Directory } from '@capacitor/filesystem';

const SendIntent = registerPlugin<any>('SendIntent');

const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));
const LandingPage = lazy(() => import('./components/LandingPage').then(m => ({ default: m.LandingPage })));
const AboutUsPage = lazy(() => import('./components/marketing/AboutUsPage').then(m => ({ default: m.AboutUsPage })));
const ContactUsPage = lazy(() => import('./components/marketing/ContactUsPage').then(m => ({ default: m.ContactUsPage })));
const FounderPage = lazy(() => import('./components/marketing/FounderPage').then(m => ({ default: m.FounderPage })));
const DeleteAccountWeb = lazy(() => import('./components/marketing/DeleteAccountWeb').then(m => ({ default: m.DeleteAccountWeb })));
const RefillCreditsWeb = lazy(() => import('./components/marketing/RefillCreditsWeb').then(m => ({ default: m.RefillCreditsWeb })));
const PlansWeb = lazy(() => import('./components/marketing/PlansWeb').then(m => ({ default: m.PlansWeb })));
const PaymentSuccessWeb = lazy(() => import('./components/marketing/PaymentSuccessWeb').then(m => ({ default: m.PaymentSuccessWeb })));
import { Sidebar, FloatingMenuButton } from './components/Sidebar';
import { useSidebarGesture } from './hooks/useSidebarGesture';
import { Header } from './components/Header';
import { NativePullToRefresh } from './components/NativePullToRefresh';
import { MainContent } from './MainContent';
import { CalendarModal } from './components/CalendarModal';

import { BottomNavBar } from './components/BottomNavBar';
import { useToast } from './hooks/useToast';
import { useApiLimiter } from './hooks/useApiLimiter';
import { useAppSettings } from './hooks/useAppSettings';
import { useGlobalRefresh } from './hooks/useGlobalRefresh';
import { navigationItems, adminNavigationItems } from './constants';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import GuidedTour, { TourStep } from './components/GuidedTour';
import { getWindowPathname } from './utils/pathname';
import { ComingSoonScreen } from './components/ComingSoonScreen';
import { SharedChatView } from './components/SharedChatView';
import TermsAndConditions from './components/TermsAndConditions';
import PrivacyPolicy from './components/PrivacyPolicy';
import { initNativeNotifications, cleanupNativeNotifications } from './utils/nativeNotifications';

import { Skeleton, PageSkeleton } from './components/Skeleton';
import { useOTAUpdater } from './hooks/useOTAUpdater';
import { useAppUpdate } from './hooks/useAppUpdate';
import { getDatabaseConnection } from './lib/sqlite/sqliteService';
import { cleanExpiredAICache } from './services/aiCacheService';
import { cloudSyncEngine } from './services/cloudSyncService';

declare var __app_id: string;

const AppLoader: React.FC = () => {
  return (
    <div className="flex h-screen w-full bg-[#f8fafc] dark:bg-background overflow-hidden animate-pulse">
        <div className="hidden lg:flex w-64 bg-white dark:bg-black dark:bg-card border-r border-slate-200 dark:border-white/10 dark:border-border flex-col p-4">
            <div className="flex items-center gap-3 mb-8 px-2">
                <Skeleton className="w-8 h-8 rounded-lg" />
                <Skeleton className="h-6 w-24" />
            </div>
            <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}
            </div>
        </div>
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            <div className="h-16 bg-white dark:bg-black dark:bg-card border-b border-slate-200 dark:border-white/10 dark:border-border flex items-center justify-between px-4 sm:px-6">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <div className="flex-1 p-6 overflow-hidden">
                <PageSkeleton />
            </div>
        </div>
    </div>
  );
};

const usePWAInstallEngine = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isIOS, setIsIOS] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const isAppStandalone = window.matchMedia('(display-mode: standalone)').matches
            || (window.navigator as any).standalone === true;
        setIsStandalone(isAppStandalone);

        const userAgent = window.navigator.userAgent.toLowerCase();
        const isAppleDevice = /iphone|ipad|ipod/.test(userAgent);
        setIsIOS(isAppleDevice);

        const handlePromptCapture = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };

        window.addEventListener('beforeinstallprompt', handlePromptCapture);
        return () => window.removeEventListener('beforeinstallprompt', handlePromptCapture);
    }, []);

    const executeInstallationPipeline = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            setDeferredPrompt(null);
        }
    };

    return { deferredPrompt, isIOS, isStandalone, executeInstallationPipeline };
};

const PWAInstallBannerOverlay: React.FC = () => {
    const { deferredPrompt, isIOS, isStandalone, executeInstallationPipeline } = usePWAInstallEngine();
    const [dismissed, setDismissed] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('pwa_install_dismissed') === 'true';
        }
        return false;
    });

    const canTriggerNativeInstall = !!deferredPrompt;

    useEffect(() => {
        if (dismissed && typeof window !== 'undefined') {
            localStorage.setItem('pwa_install_dismissed', 'true');
        }
    }, [dismissed]);

    if (Capacitor.isNativePlatform() || isStandalone || dismissed) return null;

    return (
        <div className="fixed inset-0 z-[99998] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal="true" aria-label="Add AVELUT to Home Screen">
            <div className="relative w-full max-w-sm overflow-hidden rounded-[32px] border border-neutral-100 bg-white dark:bg-black shadow-2xl p-6 md:p-8 text-center animate-scale-in">
                <button
                    type="button"
                    onClick={() => setDismissed(true)}
                    className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 transition-colors"
                    aria-label="Close"
                >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>

                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-neutral-50 mb-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-neutral-100">
                    <img src="/logo_icon.png" alt="AVELUT" className="h-12 w-12 object-contain drop-shadow-sm" />
                </div>

                <h2 className="text-2xl font-black tracking-tight text-neutral-900 mb-2">
                    Add to Home Screen
                </h2>

                <p className="text-[15px] leading-relaxed text-neutral-600 mb-6 font-medium">
                    Install AVELUT directly on your mobile phone for instant access. <span className="text-brand-600 font-bold">No Google Play Store needed!</span>
                </p>

                {canTriggerNativeInstall ? (
                    <button
                        type="button"
                        onClick={() => executeInstallationPipeline()}
                        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[#009EE2] hover:bg-[#0070B8] py-4 text-[14px] font-black uppercase tracking-wider text-white shadow-lg transition active:scale-95"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"></path>
                        </svg>
                        Add to Home Screen
                    </button>
                ) : isIOS ? (
                    <div className="bg-neutral-50 rounded-2xl p-5 border border-neutral-100 text-left space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-black shadow-sm border border-neutral-200 text-[#007AFF]">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
                                </svg>
                            </div>
                            <p className="text-sm font-semibold text-neutral-700">1. Tap the <strong className="text-neutral-900">Share</strong> button at the bottom of your screen.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-black shadow-sm border border-neutral-200 text-neutral-800">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"></path>
                                </svg>
                            </div>
                            <p className="text-sm font-semibold text-neutral-700">2. Scroll down and select <strong className="text-neutral-900">Add to Home Screen</strong>.</p>
                        </div>
                    </div>
                ) : (
                    <div className="bg-neutral-50 rounded-2xl p-5 border border-neutral-100 text-left space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-black shadow-sm border border-neutral-200 text-neutral-800">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                    <circle cx="12" cy="5" r="1.5"></circle>
                                    <circle cx="12" cy="12" r="1.5"></circle>
                                    <circle cx="12" cy="19" r="1.5"></circle>
                                </svg>
                            </div>
                            <p className="text-sm font-semibold text-neutral-700">1. Tap the <strong className="text-neutral-900">Browser Menu</strong> (three dots) at the top right.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-black shadow-sm border border-neutral-200 text-neutral-800">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                                </svg>
                            </div>
                            <p className="text-sm font-semibold text-neutral-700">2. Select <strong className="text-neutral-900">Install app</strong> or <strong className="text-neutral-900">Add to Home screen</strong>.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const SharedImagePromptModal: React.FC<{
    visible: boolean;
    imagePreview: string | null;
    onScan: () => void;
    onCancel: () => void;
}> = ({ visible, imagePreview, onScan, onCancel }) => {
    if (!visible) return null;

    return (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-md animate-fade-in">
            <div className="w-full max-w-md rounded-[32px] border border-white/20 bg-white/95 dark:bg-slate-900/95 p-6 shadow-2xl backdrop-blur-xl dark:border-slate-800 transition-all">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 text-white shadow-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </div>
                        <div>
                            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-sky-600 dark:text-sky-400">Visual Solver</p>
                            <h3 className="mt-0.5 text-xl font-extrabold text-slate-900 dark:text-white">Image Detected</h3>
                        </div>
                    </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100/70 dark:border-slate-700/80 dark:bg-slate-800/80 shadow-inner">
                    {imagePreview ? (
                        <img src={imagePreview} alt="Detected problem" className="h-56 w-full object-contain p-2" />
                    ) : (
                        <div className="flex h-56 items-center justify-center text-sm font-semibold text-slate-500">Preview loading...</div>
                    )}
                </div>

                <p className="mt-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    A problem image was found in your clipboard or shared to Avelut. Scan it now to get a full step-by-step mathematical solution.
                </p>

                <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-4 py-3.5 text-sm font-bold text-slate-600 dark:text-slate-300 transition-all hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95"
                    >
                        Dismiss
                    </button>
                    <button
                        type="button"
                        onClick={onScan}
                        className="flex-[1.5] flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 px-5 py-3.5 text-sm font-black uppercase tracking-wider text-white shadow-lg transition-all hover:from-sky-500 hover:to-indigo-500 active:scale-95"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>Scan Image</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

const AppUpdateDropModal: React.FC<{
    visible: boolean;
    title: string;
    message: string;
    mandatory: boolean;
    targetVersionLabel?: string;
    onUpdate: () => void;
    onSkip: () => void;
}> = ({ visible, title, message, mandatory, targetVersionLabel, onUpdate, onSkip }) => {
    if (!visible) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-[120] flex justify-center px-4 pt-4 sm:pt-6 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-xl rounded-3xl border border-sky-100 bg-white shadow-2xl shadow-sky-500/20 overflow-hidden animate-[slideDown_280ms_ease-out]">
                <div className="h-1.5 bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600" />
                <div className="p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-11 h-11 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 16V4" />
                                <path d="m7 11 5 5 5-5" />
                                <path d="M5 20h14" />
                            </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-lg sm:text-xl font-black text-slate-900 leading-tight">{title}</h3>
                            {targetVersionLabel && (
                                <p className="text-xs font-bold uppercase tracking-widest text-sky-600 mt-1">{targetVersionLabel}</p>
                            )}
                            <p className="text-sm text-slate-600 mt-2 leading-relaxed">{message}</p>
                        </div>
                    </div>
                    <div className="mt-5 flex flex-col sm:flex-row gap-2.5 sm:justify-end">
                        {!mandatory && (
                            <button
                                onClick={onSkip}
                                className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold hover:bg-slate-200 transition"
                            >
                                Skip
                            </button>
                        )}
                        <button
                            onClick={onUpdate}
                            className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-black uppercase tracking-wide hover:bg-sky-700 transition"
                        >
                            Update App
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const normalizeRouteSegment = (segment: string): string => {
    const s = (segment || '').toLowerCase().replace(/-/g, '_');
    if (s === 'dashboard') return 'chat';
    if (s === 'studyguide') return 'study_guide';
    if (s === 'notebooks') return 'study_guide';
    return s;
};

const ALLOWED_ROUTE_ITEMS = new Set([
    'leaderboard',
    'study_guide',
    'visual_solver',
    'chat',
    'messenger',
    'history',
    'feedback',
    'settings',
    'user_profile',
    'billing',
    'help',
    'admin',
    'study_partners',
    'voice_tutorial',
    'notifications',
    'playground'
]);

const resolveActiveItemFromPath = (pathname: string): string => {
    if (pathname === '/' || pathname === '/chat' || pathname === '/avelut-ai' || pathname === '/dashboard') return 'chat';
    const rawSegment = pathname.substring(1).split('/')[0];
    if (!rawSegment) return 'chat';
    let decodedSegment = rawSegment;
    try {
        decodedSegment = decodeURIComponent(rawSegment);
    } catch (error) {
        console.warn('Invalid route segment encoding:', rawSegment, error);
        return 'chat';
    }
    const normalizedSegment = normalizeRouteSegment(decodedSegment);
    return ALLOWED_ROUTE_ITEMS.has(normalizedSegment) ? normalizedSegment : 'chat';
};

const normalizeLevelValue = (value?: string): string => {
    if (!value) return '';
    return value.toLowerCase().replace(/\s+/g, '').replace(/level/g, '').replace(/lvl/g, '');
};

const formatDurationForPrompt = (seconds: number): string => {
    if (!seconds || seconds <= 0) return '0 minutes';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes ? `${hours} hours ${remMinutes} minutes` : `${hours} hours`;
};

const playAlarmSound = () => {
    try {
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();

        const playBeep = (time: number, freq: number, duration: number) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, time);

            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.3, time + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

            osc.start(time);
            osc.stop(time + duration);
        };

        const now = ctx.currentTime;
        playBeep(now, 880, 0.4);
        playBeep(now + 0.1, 1109.73, 0.5);

        playBeep(now + 0.6, 880, 0.4);
        playBeep(now + 0.7, 1109.73, 0.5);
    } catch (e) {
        console.error("Failed to play alarm chime:", e);
    }
};

const App: React.FC = () => {
    const { updatePrompt, dismissUpdatePrompt, openUpdateInStore } = useAppUpdate();
    useOTAUpdater();
    useGlobalRefresh();
    const [currentPath, setCurrentPath] = useState(getWindowPathname());
    const [user, setUser] = useState<FirebaseUser | null>(() => firebaseAuth.currentUser);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(() => {
        if (typeof window !== 'undefined') {
            const lastUid = window.localStorage?.getItem('avelut_last_uid') || firebaseAuth.currentUser?.uid;
            if (lastUid) {
                return readCachedJson<UserProfile | null>(`avelut_profile_${lastUid}`, null);
            }
        }
        return null;
    });
    const userProfileRef = useRef<UserProfile | null>(userProfile);
    const [isReadyForBackgroundSync, setIsReadyForBackgroundSync] = useState(false);
    const [recentConversations, setRecentConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    useEffect(() => {
        if (Capacitor.isNativePlatform()) {
            SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {});
        }
    }, []);

    useEffect(() => {
        getDatabaseConnection().then(() => {
            initCacheFromSqlite().catch(() => {});
            cleanExpiredAICache().catch(() => {});
        }).catch(err => {
            console.warn('[App] SQLite initialization note:', err);
        });
    }, []);

    useEffect(() => {
        if (userProfile?.uid) {
            cloudSyncEngine.start(userProfile.uid);
        } else {
            cloudSyncEngine.stop();
        }
    }, [userProfile?.uid]);

    useEffect(() => {
        const handlePopState = () => setCurrentPath(getWindowPathname());
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const [userProgress, setUserProgress] = useState<UserProgress>(() => {
        const uid = userProfile?.uid || (typeof window !== 'undefined' ? window.localStorage?.getItem('avelut_last_uid') : null);
        return uid ? readCachedJson<UserProgress>(`avelut_progress_${uid}`, {}) : {};
    });
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(() => {
        const uid = userProfile?.uid || (typeof window !== 'undefined' ? window.localStorage?.getItem('avelut_last_uid') : null);
        return uid ? readCachedJson<DashboardData | null>(`avelut_dashboard_${uid}`, null) : null;
    });
    const [notifications, setNotifications] = useState<NotificationType[]>(() => {
        const uid = userProfile?.uid || (typeof window !== 'undefined' ? window.localStorage?.getItem('avelut_last_uid') : null);
        return uid ? readCachedJson<NotificationType[]>(`avelut_notifications_${uid}`, []) : [];
    });
    const [examHistory, setExamHistory] = useState<ExamHistoryItem[]>(() => {
        const uid = userProfile?.uid || (typeof window !== 'undefined' ? window.localStorage?.getItem('avelut_last_uid') : null);
        return uid ? readCachedJson<ExamHistoryItem[]>(`avelut_exam_history_${uid}`, []) : [];
    });
    const [departmentData, setDepartmentData] = useState<any>(() => {
        if (userProfile?.department_id) {
            return readCachedJson<any>(`avelut_dept_data_${userProfile.department_id}`, null);
        }
        return null;
    });
    const [customHeaderConfig, setCustomHeaderConfig] = useState<HeaderConfig | null>(null);

    const { addToast } = useToast();
    const lastNotifiedRef = useRef<Record<string, boolean>>({});

    useEffect(() => {
        if (!notifications || notifications.length === 0) return;
        const latest = notifications[0];
        const isRecent = Date.now() - latest.timestamp < 15000;
        if (isRecent && !lastNotifiedRef.current[latest.id]) {
            lastNotifiedRef.current[latest.id] = true;
            if (!Capacitor.isNativePlatform() && 'Notification' in window && Notification.permission === 'granted') {
                try {
                    new Notification(latest.title || 'AVELUT', { body: latest.message });
                } catch (e) { console.warn('Failed to display web notification'); }
            }
            if (latest.type === 'study_reminder') {
                playAlarmSound();
            }
            addToast(`⏰ ${latest.title}: ${latest.message}`, 'info');
        }
    }, [notifications, addToast]);

    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [authView, setAuthView] = useState<'login' | 'signup'>('login');

    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [showOnlineRestored, setShowOnlineRestored] = useState(false);
    const [showSharedImagePrompt, setShowSharedImagePrompt] = useState(false);
    const [sharedImagePreview, setSharedImagePreview] = useState<string | null>(null);
    const [pendingSharedImage, setPendingSharedImage] = useState<string | null>(null);

    useEffect(() => {
        const handleOnline = () => {
            setIsOffline(false);
            setShowOnlineRestored(true);
            setTimeout(() => setShowOnlineRestored(false), 3000);
        };
        const handleOffline = () => {
            setIsOffline(true);
            setShowOnlineRestored(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    const [activeItem, setActiveItemState] = useState<string>(() => {
        const item = resolveActiveItemFromPath(getWindowPathname());
        return item === 'admin' ? 'admin' : item;
    });

    const activeItemRef = useRef(activeItem);
    useEffect(() => {
        activeItemRef.current = activeItem;
    }, [activeItem]);

    const [navHistory, setNavHistory] = useState<string[]>([]);
    const setActiveItem = useCallback((newItem: string) => {
        setNavHistory(prev => {
            if (prev[prev.length - 1] === newItem) return prev;
            return [...prev, activeItemRef.current].slice(-15);
        });
        setActiveItemState(newItem);
        if (newItem === 'admin') {
            const pathname = getWindowPathname();
            const nextPath = pathname.startsWith('/admin') ? pathname : '/admin';
            if (pathname !== nextPath && typeof window !== 'undefined') {
                window.history.pushState(null, '', nextPath);
            }
        } else {
            const newPath = newItem === 'chat' ? '/' : `/${newItem.replace(/_/g, '-')}`;
            if (getWindowPathname() !== newPath && typeof window !== 'undefined') {
                window.history.pushState(null, '', newPath);
            }
        }
    }, []);

    const handleSharedImageScan = useCallback(() => {
        const imageToScan = pendingSharedImage;
        setShowSharedImagePrompt(false);
        setPendingSharedImage(null);
        setSharedImagePreview(null);

        if (imageToScan) {
            localStorage.setItem('shared_image_intent', imageToScan);
            localStorage.setItem('auto_scan_shared_image', 'true');
        }

        setActiveItem('visual_solver');
        window.dispatchEvent(new CustomEvent('visual_solver_trigger_scan', { detail: { image: imageToScan } }));
    }, [pendingSharedImage, setActiveItem]);

    const dismissedClipboardSigsRef = useRef<Set<string>>(new Set());
    const currentClipboardSigRef = useRef<string | null>(null);

    const handleSharedImageCancel = useCallback(() => {
        if (currentClipboardSigRef.current) {
            dismissedClipboardSigsRef.current.add(currentClipboardSigRef.current);
            try {
                sessionStorage.setItem(`dismissed_clipboard_${currentClipboardSigRef.current}`, 'true');
            } catch {}
        }
        setShowSharedImagePrompt(false);
        setPendingSharedImage(null);
        setSharedImagePreview(null);
    }, []);

    const loadSharedImagePreview = useCallback(async (imageUri: string) => {
        if (!imageUri) return;
        try {
            if (imageUri.startsWith('content://') || imageUri.startsWith('file://')) {
                if (Capacitor.isNativePlatform()) {
                    setSharedImagePreview(Capacitor.convertFileSrc(imageUri));
                } else {
                    const normalized = imageUri.replace(/^file:\/\//, '').replace(/^content:\/\//, '');
                    const fileData = await Filesystem.readFile({ path: normalized });
                    setSharedImagePreview(`data:image/jpeg;base64,${fileData.data}`);
                }
            } else if (imageUri.startsWith('data:image') || imageUri.startsWith('blob:') || imageUri.startsWith('http')) {
                setSharedImagePreview(imageUri);
            } else {
                setSharedImagePreview(null);
            }
        } catch (error) {
            console.warn('Unable to create shared image preview:', error);
            setSharedImagePreview(null);
        }
    }, []);

    useEffect(() => {
        if (Capacitor.isNativePlatform()) {
            const intentListener = SendIntent.addListener('appSendActionIntent', async (data: any) => {
                if (data && data.extras && data.extras['android.intent.extra.STREAM']) {
                    const streamUri = data.extras['android.intent.extra.STREAM'];
                    localStorage.setItem('shared_image_intent', streamUri);
                    setPendingSharedImage(streamUri);
                    await loadSharedImagePreview(streamUri);
                    setShowSharedImagePrompt(true);
                }
            });
            return () => {
                intentListener.then((handle: any) => handle.remove()).catch(() => {});
            };
        }
    }, [loadSharedImagePreview]);

    useEffect(() => {
        let mounted = true;
        const tryReadClipboardImage = async () => {
            if (!mounted) return;
            if (!navigator.clipboard || !('read' in navigator.clipboard)) return;
            try {
                const items: any = await (navigator.clipboard as any).read();
                if (!items || !items.length) return;
                for (const item of items) {
                    if (!item.types) continue;
                    const imageType = item.types.find((t: string) => t.startsWith('image/'));
                    if (imageType) {
                        const blob = await item.getType(imageType);
                        const sig = `${blob.size}_${blob.type}`;
                        if (dismissedClipboardSigsRef.current.has(sig) || sessionStorage.getItem(`dismissed_clipboard_${sig}`)) {
                            return;
                        }
                        currentClipboardSigRef.current = sig;
                        const blobUrl = URL.createObjectURL(blob);
                        setPendingSharedImage(blobUrl);
                        setSharedImagePreview(blobUrl);
                        setShowSharedImagePrompt(true);
                        return;
                    }
                }
            } catch (err) {}
        };

        void tryReadClipboardImage();
        const onFocus = () => { void tryReadClipboardImage(); };
        window.addEventListener('focus', onFocus);
        return () => { mounted = false; window.removeEventListener('focus', onFocus); };
    }, []);

    const globalTouchStartRef = useRef<{ x: number; y: number } | null>(null);

    const handleGlobalTouchStart = (e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (touch && touch.clientX < Math.max(60, window.innerWidth * 0.18)) {
            globalTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
        }
    };

    const handleGlobalTouchEnd = (e: React.TouchEvent) => {
        if (!globalTouchStartRef.current) return;
        const touch = e.changedTouches[0];
        if (touch) {
            const deltaX = touch.clientX - globalTouchStartRef.current.x;
            const deltaY = touch.clientY - globalTouchStartRef.current.y;
            if (deltaX > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
                setIsMobileSidebarOpen(true);
            }
        }
        globalTouchStartRef.current = null;
    };

    useEffect(() => {
        const handleGoBack = () => {
            setNavHistory(prev => {
                if (prev.length === 0) {
                    setActiveItemState('chat');
                    return prev;
                }
                const newHistory = [...prev];
                const lastRoute = newHistory.pop();
                setActiveItemState(lastRoute || 'chat');
                return newHistory;
            });
        };
        window.addEventListener('app-go-back', handleGoBack);
        return () => window.removeEventListener('app-go-back', handleGoBack);
    }, []);

    const [adminPath, setAdminPath] = useState<string>(() => {
        const pathname = getWindowPathname();
        return resolveActiveItemFromPath(pathname) === 'admin' ? pathname : '/admin';
    });

    const syncItemFromPath = useCallback((pathname: string) => {
        const currentPathname = pathname.split('?')[0];
        const isTermsRoute = currentPathname === '/t&c' || currentPathname === '/tc' || currentPathname === '/terms-and-conditions' || currentPathname === '/terms';
        const isPolicyRoute = currentPathname === '/policy' || currentPathname === '/privacy-policy' || currentPathname === '/privacy';
        const isDeleteRoute = currentPathname === '/delete-account' || currentPathname.startsWith('/delete-account/');
        const isRefillCreditsRoute = currentPathname === '/refill-credits' || currentPathname.startsWith('/refill-credits/');
        const isPlansRoute = currentPathname === '/plans' || currentPathname.startsWith('/plans/');
        const isPaymentSuccessRoute = currentPathname === '/payment-success';

        if (pathname.startsWith('/upload-center') || pathname.startsWith('/shared-chat') || isTermsRoute || isPolicyRoute || isDeleteRoute || isRefillCreditsRoute || isPlansRoute || isPaymentSuccessRoute) {
            return;
        }
        const item = resolveActiveItemFromPath(pathname);
        setActiveItemState(item === 'admin' ? 'admin' : item);
        if (item === 'admin') {
            setAdminPath(pathname.startsWith('/admin') ? pathname : '/admin');
            return;
        }
    }, []);

    useEffect(() => {
        const handlePopState = () => syncItemFromPath(getWindowPathname());
        handlePopState();
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [syncItemFromPath]);

    useEffect(() => {
        const handleGlobalError = (event: ErrorEvent) => {
            const msg = event.message || '';
            const err = event.error;
            const stack = err?.stack || '';
            if (
                msg.includes("reading 'body'") &&
                (stack.includes("youtube") || stack.includes("widget") || stack.includes("Pb.close") || stack.includes("shutdown_") || stack.includes("onClosed_"))
            ) {
                console.warn("Caught and silenced YouTube Player API unmount exception:", err);
                event.preventDefault();
                event.stopPropagation();
            }
        };

        window.addEventListener('error', handleGlobalError);
        return () => window.removeEventListener('error', handleGlobalError);
    }, []);

    const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem('avelut_admin_authenticated') === 'true';
    });
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const { mainRef, overlayRef, sidebarRef } = useSidebarGesture({
        isOpen: isMobileSidebarOpen,
        onOpen: () => setIsMobileSidebarOpen(true),
        onClose: () => setIsMobileSidebarOpen(false),
        enabled: true,
    });
    const [isDesktopSidebarCollapsed, setIsDesktopSidebarCollapsed] = useState<boolean>(() => {
        if (typeof window !== 'undefined') {
            return window.localStorage?.getItem('avelut_sidebar_collapsed') === 'true';
        }
        return false;
    });

    const handleToggleMenu = useCallback(() => {
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            setIsMobileSidebarOpen(prev => !prev);
        } else {
            setIsDesktopSidebarCollapsed(prev => {
                const next = !prev;
                try {
                    window.localStorage?.setItem('avelut_sidebar_collapsed', String(next));
                } catch {}
                return next;
            });
        }
    }, []);

    const handleOpenMenu = useCallback(() => {
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            setIsMobileSidebarOpen(true);
        } else {
            setIsDesktopSidebarCollapsed(false);
            try {
                window.localStorage?.setItem('avelut_sidebar_collapsed', 'false');
            } catch {}
        }
    }, []);
    const [pendingMessengerChatId, setPendingMessengerChatId] = useState<string | null>(null);

    const currentPageLabel = activeItem === 'messenger'
        ? 'Messenger'
        : activeItem === 'study_partners'
            ? 'Study Partners'
            : (navigationItems.find(item => item.id === activeItem)?.label || 'Dashboard');

    const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
    const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [isTourOpen, setIsTourOpen] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const triggerScanRef = useRef<(() => void) | null>(null);
    const { settings: appSettings, isLoading: isAppSettingsLoading } = useAppSettings();
    const ai = useMemo(() => (
        createAvelutAI(appSettings, userProfile)
    ), [
        appSettings,
        userProfile?.uid,
        userProfile?.use_personal_token,
        userProfile?.personal_api_key,
        userProfile?.subscription_status
    ]);
    const isUploadCenterRoute = getWindowPathname().startsWith('/upload-center');
    const isAdminRoute = getWindowPathname().startsWith('/admin');

    const applyMessengerTarget = useCallback((chatId: string | null | undefined) => {
        if (!chatId) return;
        setActiveItem('messenger');
        setPendingMessengerChatId(chatId);
        if (Capacitor.isNativePlatform()) {
            PushNotifications.removeAllDeliveredNotifications().catch(console.error);
        }
    }, [setActiveItem]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const url = new URL(window.location.href);
        const chatId = url.searchParams.get('openMessengerChatId');
        if (chatId) {
            applyMessengerTarget(chatId);
            url.searchParams.delete('openMessengerChatId');
            window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        }

        const handleServiceWorkerMessage = (event: MessageEvent) => {
            const data = event.data || {};
            if (data?.type === 'open-messenger-chat' && data.chatId) {
                applyMessengerTarget(String(data.chatId));
            }
        };

        navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);
        return () => navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    }, [applyMessengerTarget]);

    const { attemptApiCall } = useApiLimiter();
    const tourStatusRef = useRef<'unknown' | 'checked' | 'shown'>('unknown');

    const startTour = useCallback(() => {
        setActiveItem('chat');
        setTimeout(() => setIsTourOpen(true), 300);
    }, [setActiveItem]);


    useEffect(() => {
        const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
          setUser(currentUser);
          if (!currentUser) {
            setUserProfile(null);
            userProfileRef.current = null;
            tourStatusRef.current = 'unknown';
            cleanupNativeNotifications();
          } else {
            const uid = currentUser.uid;
            try {
              window.localStorage.setItem('avelut_last_uid', uid);
            } catch (_) {}

            const cachedProfile = readCachedJson<UserProfile | null>(`avelut_profile_${uid}`, null);
            if (cachedProfile) {
              setUserProfile(cachedProfile);
              userProfileRef.current = cachedProfile;
              setIsProfileLoading(false);
            }
            const cachedProgress = readCachedJson<UserProgress>(`avelut_progress_${uid}`, {});
            if (cachedProgress && Object.keys(cachedProgress).length > 0) {
              setUserProgress(cachedProgress);
            }
            const cachedDashboard = readCachedJson<DashboardData | null>(`avelut_dashboard_${uid}`, null);
            if (cachedDashboard) {
              setDashboardData(cachedDashboard);
            }
            const cachedNotifs = readCachedJson<NotificationType[]>(`avelut_notifications_${uid}`, []);
            if (cachedNotifs && cachedNotifs.length > 0) {
              setNotifications(cachedNotifs);
            }
            const cachedExams = readCachedJson<ExamHistoryItem[]>(`avelut_exam_history_${uid}`, []);
            if (cachedExams && cachedExams.length > 0) {
              setExamHistory(cachedExams);
            }

            initNativeNotifications(currentUser, addToast, setActiveItem, setPendingMessengerChatId);
          }
          setIsAuthChecking(false);
          setIsLoading(false);
        });
        return () => unsubscribe();
    }, [addToast, setActiveItem]);

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;
        const urlListener = CapacitorApp.addListener('appUrlOpen', async (event) => {
            const url = new URL(event.url);

            if (url.protocol.startsWith('http')) {
                if (url.pathname.startsWith('/refill-credits') || url.pathname.startsWith('/plans') || url.pathname.startsWith('/delete-account')) {
                    setCurrentPath(url.pathname + url.search);
                    return;
                }
            }

            if (url.protocol.replace(':', '') === 'avelut' && url.host === 'payment-success') {
                addToast('Payment Successful! Refreshing profile...', 'success');
                setActiveItem('chat');
                return;
            }
            if (url.protocol.replace(':', '') === 'avelut' && url.host === 'action') {
                const actionId = url.searchParams.get('id');
                const replyText = url.searchParams.get('replyText');
                const chatId = url.searchParams.get('chatId');

                if (actionId === 'reply_action' && replyText && chatId && user) {
                     try {
                         const messagesRef = dbRef(db, `messages/${chatId}`);
                         const newMsgRef = push(messagesRef);
                         await set(newMsgRef, {
                             senderId: user.uid,
                             text: replyText,
                             timestamp: Date.now(),
                             isRead: false
                         });
                         addToast('Reply sent ✓', 'success');
                     } catch (e) {
                         console.error('Failed to send inline reply:', e);
                         addToast('Failed to send reply', 'error');
                     }
                } else if (actionId === 'open_chat' && chatId) {
                     setActiveItem('messenger');
                     setPendingMessengerChatId(chatId);
                } else if (actionId === 'study_guide' || actionId === 'timetable') {
                     setActiveItem('study_guide');
                } else if (actionId === 'study_partners') {
                     setActiveItem('study_partners');
                } else if (actionId === 'messenger') {
                     setActiveItem('messenger');
                } else if (actionId === 'notifications') {
                     setActiveItem('notifications');
                } else if (actionId === 'leaderboard') {
                     setActiveItem('leaderboard');
                } else if (chatId) {
                     setActiveItem('messenger');
                     setPendingMessengerChatId(chatId);
                } else if (actionId) {
                     setActiveItem(actionId);
                }
            }
        });

        const appStateListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
                PushNotifications.removeAllDeliveredNotifications().catch(console.error);
            }
        });

        return () => {
            urlListener.then(listener => listener.remove());
            appStateListener.then(listener => listener.remove());
        };
    }, [user, addToast]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('avelut_admin_authenticated', isAdminAuthenticated ? 'true' : 'false');
    }, [isAdminAuthenticated]);

    const handleProfileUpdate = useCallback(async (updatedData: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> => {
        if (!user) return { success: false, error: 'User not authenticated.' };
        try {
            const userRef = dbRef(db, `users/${user.uid}`);
            await update(userRef, updatedData);
            if (updatedData.display_name || updatedData.photo_url) {
                const profileUpdates: any = {};
                if (updatedData.display_name) profileUpdates.displayName = updatedData.display_name;
                if (updatedData.photo_url) profileUpdates.photoURL = updatedData.photo_url;
                await updateProfile(user, profileUpdates);
            }
            setUserProfile(prevProfile => {
                if (!prevProfile) return null;
                return { ...prevProfile, ...updatedData };
            });
            return { success: true };
        } catch (err: any) {
            console.error("Error updating profile:", err.message || err);
            return { success: false, error: err.message };
        }
    }, [user]);

    const handleConsent = async (granted: boolean) => {
        setShowPrivacyModal(false);
        await handleProfileUpdate({ privacy_consent: { granted, timestamp: Date.now() } });
    };

    useEffect(() => {
        if (!userProfile) return;
        const requestPermissions = async () => {
            try {
                if (Capacitor.isNativePlatform()) {
                    let permStatus = await PushNotifications.checkPermissions();
                    if (permStatus.receive === 'prompt') {
                        permStatus = await PushNotifications.requestPermissions();
                    }
                    if (permStatus.receive === 'granted' && !userProfile.notifications_enabled) {
                        handleProfileUpdate({ notifications_enabled: true });
                    }
                } else {
                    if ('Notification' in window) {
                        const currentPerm = Notification.permission;
                        if (currentPerm === 'default') {
                            const newPerm = await Notification.requestPermission();
                            if (newPerm === 'granted' && !userProfile.notifications_enabled) {
                                handleProfileUpdate({ notifications_enabled: true });
                            }
                        } else if (currentPerm === 'granted' && !userProfile.notifications_enabled) {
                            handleProfileUpdate({ notifications_enabled: true });
                        }
                    }
                }
            } catch (err) {
                console.warn("Auto permissions skipped or failed:", err);
            }
        };
        const timer = setTimeout(requestPermissions, 2500);
        return () => clearTimeout(timer);
    }, [userProfile?.uid, handleProfileUpdate, userProfile?.notifications_enabled]);

    useEffect(() => {
        if (!user) {
            setUserProfile(null);
            setIsProfileLoading(false);
            return;
        }
        const cacheKey = `avelut_profile_${user.uid}`;
        const cachedProfile = readCachedJson<UserProfile | null>(cacheKey, null);
        if (cachedProfile) {
            setUserProfile(cachedProfile);
            userProfileRef.current = cachedProfile;
            setIsProfileLoading(false);
        } else {
            setIsProfileLoading(true);
        }

        const userRef = dbRef(db, `users/${user.uid}`);

        const unsubscribeProfile = onValue(userRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                if (data.status === 'suspended' || data.status === 'deleted') {
                    firebaseSignOut(firebaseAuth);
                    addToast(`Your account has been ${data.status}.`, "error");
                    return;
                }

                const hasOnboardingFields = !!(data.department_id && data.school_id && data.college_id);
                const isLikelyPartialOptimistic = !hasOnboardingFields && !data.created_at && !data.is_activated;
                const hasPriorCompleteProfile = !!(userProfileRef.current?.department_id);
                const isPartialUpdate = isLikelyPartialOptimistic && hasPriorCompleteProfile;

                if (!isPartialUpdate) {
                    writeCachedJson(cacheKey, data);
                    setUserProfile(data as UserProfile);
                    userProfileRef.current = data as UserProfile;

                    if (!data.department_id) {
                        setActiveItem('onboarding');
                        sessionStorage.removeItem('just_signed_up');
                    } else {
                        if (tourStatusRef.current === 'unknown') {
                            if (data.privacy_consent?.granted && !data.has_completed_tour) {
                                startTour();
                                tourStatusRef.current = 'shown';
                            } else {
                                tourStatusRef.current = 'checked';
                            }
                        }
                    }

                    if (!sessionStorage.getItem('session_notifications_sent')) {
                        sessionStorage.setItem('session_notifications_sent', 'true');
                        const today = new Date().toISOString().split('T')[0];
                        const lastLoginStr = localStorage.getItem('last_login_date');
                        const currentAppVersion = "5.1.0";
                        const lastSeenVersion = localStorage.getItem('last_seen_app_version');

                        if (lastLoginStr !== today) {
                            localStorage.setItem('last_login_date', today);
                        }

                        if (lastSeenVersion !== currentAppVersion) {
                            localStorage.setItem('last_seen_app_version', currentAppVersion);
                        }
                    }
                }
                setIsProfileLoading(false);
            } else {
                const defaultProfile: UserProfile = {
                    uid: user.uid,
                    display_name: user.displayName || 'AVELITE',
                    email: user.email || '',
                    photo_url: user.photoURL || '',
                    school_id: 'sch_1',
                    college_id: 'col_1',
                    department_id: 'dept_math',
                    level: '100',
                    current_streak: 0,
                    last_activity_date: Date.now(),
                    notifications_enabled: false,
                    is_online: true,
                    last_seen: Date.now(),
                    has_completed_tour: false,
                    is_activated: true,
                    subscription_status: 'free',
                    ai_credits_balance: 50,
                };
                setUserProfile(defaultProfile);
                userProfileRef.current = defaultProfile;
                setIsProfileLoading(false);
                if (!defaultProfile.department_id) {
                    setActiveItem('onboarding');
                }
            }
        }, (error) => {
            console.error("Error fetching user profile:", error);
        });

        return () => { off(userRef, 'value', unsubscribeProfile); };
    }, [user, addToast, startTour]);

    useEffect(() => {
        if (userProfile && !isReadyForBackgroundSync) {
            const timer = setTimeout(() => setIsReadyForBackgroundSync(true), 1500);
            return () => clearTimeout(timer);
        } else if (!userProfile) {
            setIsReadyForBackgroundSync(false);
        }
    }, [userProfile, isReadyForBackgroundSync]);

    useEffect(() => {
        if (!userProfile) return;
        const SESSION_STREAK_THRESHOLD_MS = 1000;
        const timer = window.setTimeout(async () => {
            await awardDailyStreak(userProfile.uid);
        }, SESSION_STREAK_THRESHOLD_MS);
        return () => window.clearTimeout(timer);
    }, [userProfile?.uid]);

    useEffect(() => {
        if (!user || isProfileLoading) return;
        const syncAuthIdentityToProfile = async () => {
            try {
                const userRef = dbRef(db, `users/${user.uid}`);
                const snapshot = await get(userRef);
                const existingProfile = snapshot.val() || {};

                const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
                const clientTimezoneOffset = new Date().getTimezoneOffset();

                const nextProfile: Record<string, any> = {
                    uid: user.uid,
                    display_name: user.displayName || existingProfile.display_name || 'User',
                    email: user.email || existingProfile.email || '',
                    photo_url: user.photoURL || existingProfile.photo_url || '',
                    timezone: clientTimezone,
                    timezone_offset: clientTimezoneOffset,
                };
                if (typeof existingProfile.ai_credits_balance !== 'number' && typeof existingProfile.ai_credits !== 'number') {
                    nextProfile.ai_credits_balance = 50;
                }
                const hasProfileUpdates = Object.entries(nextProfile).some(([key, value]) => existingProfile[key] !== value && value);
                if (hasProfileUpdates) {
                    await update(userRef, nextProfile);
                }
            } catch (error) {
                console.error('Failed to sync auth identity to profile:', error);
            }
        };
        const timer = setTimeout(syncAuthIdentityToProfile, 800);
        return () => clearTimeout(timer);
    }, [user, isProfileLoading]);

    useEffect(() => {
        if (!userProfile || !user) return;
        const userStatusRef = dbRef(db, `users/${user.uid}`);
        const connectedRef = dbRef(db, '.info/connected');

        const unsubscribeConnected = onValue(connectedRef, (snap) => {
            if (snap.val() === true) {
                onDisconnect(userStatusRef).update({ is_online: false, last_seen: serverTimestamp() });
                update(userStatusRef, { is_online: true, last_seen: serverTimestamp() });
            }
        });

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                update(userStatusRef, { is_online: true, last_seen: serverTimestamp() });
            } else {
                update(userStatusRef, { is_online: false, last_seen: serverTimestamp() });
            }
        };

        window.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.removeEventListener('visibilitychange', handleVisibilityChange);
            off(connectedRef, 'value', unsubscribeConnected);
        };
    }, [userProfile?.uid, user]);

    useEffect(() => {
        if (!userProfile?.uid) return;
        const cacheKey = `avelut_progress_${userProfile.uid}`;

        if (!isReadyForBackgroundSync) return;

        const progressRef = dbRef(db, `user_progress/${userProfile.uid}`);
        const unsubscribeProgress = onValue(progressRef, (snapshot) => {
            const data = snapshot.val() || {};
            setUserProgress(data);
            writeCachedJson(cacheKey, data);
        });
        return () => { off(progressRef, 'value', unsubscribeProgress); };
    }, [userProfile?.uid, isReadyForBackgroundSync]);

    useEffect(() => {
        if (!userProfile?.uid) {
            setUnreadMessagesCount(0);
            setNotifications([]);
            return;
        }

        const cacheKeyNotif = `avelut_notifications_${userProfile.uid}`;

        if (!isReadyForBackgroundSync) return;

        const notificationsRef = dbRef(db, `notifications/${userProfile.uid}`);
        const unsubscribeNotifications = onValue(notificationsRef, (snapshot) => {
            const data = snapshot.val() || {};
            const notificationList: NotificationType[] = Object.entries(data).map(([id, n]: [string, any]) => ({
                id, ...n, timestamp: n.timestamp
            })).sort((a,b) => b.timestamp - a.timestamp);
            const truncatedNotif = notificationList.slice(0, 20);
            setNotifications(truncatedNotif);
            writeCachedJson(cacheKeyNotif, truncatedNotif);
        });

        const userChatsRef = dbRef(db, `user_chats/${userProfile.uid}`);
        const unsubscribeUnreadCount = onValue(userChatsRef, (snapshot) => {
            const data = snapshot.val() || {};
            let totalUnread = 0;
            Object.values(data).forEach((chat: any) => { totalUnread += (chat.unreadCount || 0); });
            setUnreadMessagesCount(totalUnread);
        });

        return () => {
            off(notificationsRef, 'value', unsubscribeNotifications);
            off(userChatsRef, 'value', unsubscribeUnreadCount);
        };
    }, [userProfile?.uid, isReadyForBackgroundSync]);

    useEffect(() => {
        if (!userProfile?.uid) {
            setExamHistory([]);
            return;
        }

        if (!isReadyForBackgroundSync) return;

        const examHistoryRef = dbRef(db, `exam_history/${userProfile.uid}`);
        const unsubscribeExamHistory = onValue(examHistoryRef, (snapshot) => {
            const data = snapshot.val() || {};
            const sorted = Object.values(data).sort((a: any, b: any) => b.timestamp - a.timestamp).slice(0, 5) as ExamHistoryItem[];
            setExamHistory(sorted);
        });

        return () => {
            off(examHistoryRef, 'value', unsubscribeExamHistory);
        };
    }, [userProfile?.uid, isReadyForBackgroundSync]);

    useEffect(() => {
        if (!userProfile?.school_id || !userProfile?.college_id || !userProfile?.department_id) {
            setDepartmentData(null);
            return;
        }

        const deptCacheKey = `avelut_dept_data_${userProfile.department_id}`;

        if (!isReadyForBackgroundSync) return;

        const coursesRef = dbRef(db, `departments_data/${userProfile.department_id}`);
        get(coursesRef).then((coursesSnap) => {
            const coursesVal = coursesSnap.val() || {};
            const metaRef = dbRef(db, `schools_data/${userProfile.school_id}/colleges/${userProfile.college_id}/departments/${userProfile.department_id}`);
            get(metaRef).then((metaSnap) => {
                const metaVal = metaSnap.val() || {};
                const merged = { ...metaVal, ...coursesVal };
                if (Object.keys(merged).length > 0) {
                    writeCachedJson(deptCacheKey, merged);
                    setDepartmentData(merged);
                }
            }).catch(err => {
                if (coursesVal && Object.keys(coursesVal).length > 0) {
                    writeCachedJson(deptCacheKey, coursesVal);
                    setDepartmentData(coursesVal);
                }
                console.error("Error fetching department metadata:", err);
            });
        }).catch(err => {
            console.error("Error fetching department courses:", err);
        });
    }, [
        userProfile?.school_id,
        userProfile?.college_id,
        userProfile?.department_id,
        isReadyForBackgroundSync
    ]);

    useEffect(() => {
        if (!userProfile?.uid || !departmentData) return;

        const normalizedUserLevel = normalizeLevelValue(userProfile.level);
        const rawCourseList = departmentData.course_list;
        const allCourses: Course[] = Array.isArray(rawCourseList)
            ? rawCourseList
            : (rawCourseList && typeof rawCourseList === 'object' ? Object.values(rawCourseList) : []);
        const coursesForLevel = allCourses.filter((course: Course) => (
            normalizeLevelValue(course.level) === normalizedUserLevel
        ));

        const totalTopics = coursesForLevel.reduce((acc: number, course: Course) => acc + (course.topics?.length || 0), 0) || 0;
        const topicIdsForLevel = new Set<string>();

        coursesForLevel.forEach(course => {
            course.topics?.forEach(topic => { topicIdsForLevel.add(topic.topic_id); });
        });

        const completedTopicsCount = Object.keys(userProgress)
            .filter(topicId => userProgress[topicId]?.is_complete && topicIdsForLevel.has(topicId))
            .length;
        const topicDurations = Object.entries(userProgress)
            .filter(([topicId, progress]) => topicIdsForLevel.has(topicId) && typeof (progress as any).study_duration_seconds === 'number' && (progress as any).study_duration_seconds > 0)
            .map(([, progress]) => (progress as any).study_duration_seconds || 0);
        const totalStudySeconds = topicDurations.reduce((acc: number, seconds: number) => acc + seconds, 0);
        const averageTopicStudySeconds = topicDurations.length > 0 ? Math.round(totalStudySeconds / topicDurations.length) : 0;

        const completedCoursesCount = coursesForLevel.filter((course: Course) => {
            const topicIds = course.topics?.map(topic => topic.topic_id) || [];
            return topicIds.length > 0 && topicIds.every(topicId => userProgress[topicId]?.is_complete);
        }).length;
        const courseDurations = coursesForLevel
            .map((course: Course) => (course.topics || []).reduce((acc: number, topic) => acc + ((userProgress[topic.topic_id] as any)?.study_duration_seconds || 0), 0))
            .filter((seconds: number) => seconds > 0);
        const averageCourseStudySeconds = courseDurations.length > 0 ? Math.round(courseDurations.reduce((acc: number, seconds: number) => acc + seconds, 0) / courseDurations.length) : 0;

        const examAverageScore = examHistory.length > 0 ? examHistory.reduce((acc, exam) => acc + ((exam.score / exam.total_questions) * 100), 0) / examHistory.length : 0;

        const progressPercent = totalTopics > 0 ? (completedTopicsCount / totalTopics) * 100 : 0;
        const understandingScore = Math.max(0, Math.min(100, Math.round((progressPercent * 0.55) + (examAverageScore * 0.45))));
        const understandingLabel = understandingScore >= 85 ? 'Excellent' : understandingScore >= 70 ? 'Strong' : understandingScore >= 50 ? 'Growing' : 'Needs focus';

        const nextDashboardData = {
            totalTopics,
            completedTopicsCount,
            completedCoursesCount,
            totalStudySeconds,
            averageTopicStudySeconds,
            averageCourseStudySeconds,
            examAverageScore: Math.round(examAverageScore),
            understandingScore,
            understandingLabel,
            backedFacts: [
                `Completed topics: ${completedTopicsCount} of ${totalTopics}`,
                `Completed courses: ${completedCoursesCount}`,
                `Total study time: ${formatDurationForPrompt(totalStudySeconds)}`,
                `Average topic time: ${formatDurationForPrompt(averageTopicStudySeconds)}`,
                `Average course time: ${formatDurationForPrompt(averageCourseStudySeconds)}`,
                `Average exam score: ${Math.round(examAverageScore)}%`,
            ],
            examHistory
        };
        setDashboardData(nextDashboardData);
        const cacheKeyDashboard = `avelut_dashboard_${userProfile.uid}`;
        writeCachedJson(cacheKeyDashboard, nextDashboardData);
    }, [
        userProfile?.uid,
        userProfile?.level,
        userProgress,
        examHistory,
        departmentData
    ]);

    const handleLogout = async () => {
        try {
            await firebaseSignOut(firebaseAuth);
        } catch (error: any) {
            console.error("Logout failed:", error.message || error);
            addToast(error.message || "Failed to log out.", "error");
        }
    };

    const handleOnboardingComplete = async (profileData: { schoolId: string; collegeId: string; departmentId: string; level: string }) => {
        if (!user) return;
        const now = Date.now();
        const displayName = user.displayName || 'AVELITE';
        const photoURL = user.photoURL || '';
        const userProfileData: Omit<UserProfile, 'privacy_consent'> = {
            uid: user.uid,
            display_name: displayName,
            photo_url: photoURL,
            school_id: profileData.schoolId,
            college_id: profileData.collegeId,
            department_id: profileData.departmentId,
            level: profileData.level,
            current_streak: 0,
            last_activity_date: now,
            notifications_enabled: false,
            is_online: true,
            last_seen: now,
            has_completed_tour: false,
            is_activated: true,
            subscription_status: 'free',
            ai_credits_balance: typeof userProfile?.ai_credits_balance === 'number'
                ? userProfile.ai_credits_balance
                : (typeof (userProfile as any)?.ai_credits === 'number' ? (userProfile as any).ai_credits : 50),
        };
        try {
            const userRef = dbRef(db, `users/${user.uid}`);
            await update(userRef, userProfileData);

            try {
                const notificationRef = dbRef(db, `notifications/${user.uid}`);
                const newNotifRef = push(notificationRef);
                await set(newNotifRef, {
                    type: 'welcome',
                    title: 'Welcome to AVELUT!',
                    message: 'Your learning journey starts now. Explore the study guide to begin.',
                    is_read: false,
                    timestamp: serverTimestamp(),
                    route: 'study_guide',
                    audience: 'single',
                    category: 'welcome'
                });
            } catch (notifErr) {
                console.warn("Could not dispatch welcome notification (non-blocking):", notifErr);
            }

            setUserProfile(prev => ({...prev, ...userProfileData } as UserProfile));
            setActiveItem('chat');
            addToast("Profile completed successfully!", "success");
        } catch (error: any) {
            console.error("Failed to complete onboarding:", error.message || error);
            addToast(error.message || "Could not save your profile.", "error");
        }
    };

    const handleMarkNotificationRead = async (id: string) => {
        if (!user) return;
        const target = notifications.find(n => n.id === id);
        if (!target || target.is_read) return;

        const previousNotifications = notifications;
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));

        try {
            const { error } = await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('id', id)
                .eq('user_id', user.uid);

            if (error) throw error;
        } catch (err: any) {
            console.error("Error marking notification read:", err);
            setNotifications(previousNotifications);
            addToast("Could not update notification.", "error");
        }
    };

    const handleMarkAllNotificationsRead = async () => {
        if (!user) return;
        const unreadCountBefore = notifications.filter(n => !n.is_read).length;
        if (unreadCountBefore === 0) return;

        const previousNotifications = notifications;
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));

        try {
            const { data, error } = await supabase
                .from('notifications')
                .update({ is_read: true })
                .eq('user_id', user.uid)
                .eq('is_read', false)
                .select();

            if (error) throw error;

            const updatedCount = data ? data.length : unreadCountBefore;
            if (updatedCount > 0) {
                addToast('All notifications marked as read.', 'success');
            }
        } catch (error: any) {
            console.error("Error clearing notifications:", error);
            setNotifications(previousNotifications);
            addToast("Could not clear notifications.", "error");
        }
    };

    const handleAccountDeletion = async (): Promise<{ success: boolean; error?: string }> => {
        try {
            if (user) {
                await update(dbRef(db, `users/${user.uid}`), { is_deleted: true });
                await user.delete();
                addToast('Your account has been successfully deleted.', 'success');
                return { success: true };
            }
            return { success: false, error: 'User not found.' };
        } catch (error: any) {
            console.error("Error deleting account:", error.message || error);
            return { success: false, error: error.message || 'An error occurred while deleting your account.' };
        }
    };

    const handleTourClose = async (completed: boolean) => {
        if (completed && userProfile && !userProfile.has_completed_tour) {
            const result = await handleProfileUpdate({ has_completed_tour: true });
            if (!result.success) {
                addToast(result.error || 'Could not save tour completion status.', 'error');
            }
        }
        setIsTourOpen(false);
    };

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    const tourSteps: TourStep[] = [
      { target: 'body', title: '👋 Welcome to AVELUT!', content: "Let's take a quick tour of your new learning dashboard.", placement: 'center' },
      { target: '[data-tour-id="dashboard-content"]', title: '📊 Your Dashboard', content: 'View your progress, streaks, and personalized lessons.', placement: 'bottom' },
      { target: isMobile ? '[data-tour-id="bottomnav-study_guide"]' : '[data-tour-id="sidebar-study_guide"]', title: '📚 My Notebooks', content: 'Access your personal notebooks and study materials anytime.', placement: isMobile ? 'top' : 'right' },
      { target: isMobile ? '[data-tour-id="bottomnav-visual_solver"]' : '[data-tour-id="sidebar-visual_solver"]', title: '📸 Visual Solver', content: 'Scan any problem and get instant or detailed tutorials.', placement: isMobile ? 'top' : 'right' },
      { target: isMobile ? '[data-tour-id="bottomnav-messenger"]' : '[data-tour-id="header-messenger"]', title: '🤝 Messenger', content: 'Connect with other learners and chat privately.', placement: isMobile ? 'top' : 'bottom' },
      ...(isMobile ? [{ target: '[data-tour-id="mobile-menu-button"]', title: '⚙️ Main Menu', content: 'Access your settings, help, and logout options from here.', placement: 'bottom' as const }] : [{ target: '[data-tour-id="sidebar-settings"]', title: '⚙️ Settings', content: 'Update your info and view your achievements.', placement: 'top' as const }]),
      { target: 'body', title: "🎉 You're all set!", content: 'Enjoy exploring your learning journey. Tap "Finish" to start!', placement: 'center' },
    ];

    if (!userProfile && (isAuthChecking || isLoading || (isProfileLoading && user))) {
        return <div key="app-loader-state"><AppLoader /></div>;
    }

    const isSharedChatRoute = currentPath.startsWith('/shared-chat/');
    const shareId = isSharedChatRoute ? currentPath.substring('/shared-chat/'.length).split('/')[0] : '';

    if (isSharedChatRoute && shareId) {
        return (
                <SharedChatView shareId={shareId} user={user} />
        );
    }

    const currentPathname = currentPath.split('?')[0];
    const isTermsRoute = currentPathname === '/t&c' || currentPathname === '/tc' || currentPathname === '/terms-and-conditions' || currentPathname === '/terms';
    const isPolicyRoute = currentPathname === '/policy' || currentPathname === '/privacy-policy' || currentPathname === '/privacy';
    const isDeleteRoute = currentPathname === '/delete-account' || currentPathname.startsWith('/delete-account/');
    const isRefillCreditsRoute = currentPathname === '/refill-credits' || currentPathname.startsWith('/refill-credits/');
    const isPlansRoute = currentPathname === '/plans' || currentPathname.startsWith('/plans/');
    const isPaymentSuccessRoute = currentPathname === '/payment-success' || currentPathname.startsWith('/payment-success/');

    if (isRefillCreditsRoute) {
        return (
            <Suspense fallback={<AppLoader />}>
                <RefillCreditsWeb appSettings={appSettings} userProfile={userProfile || undefined} />
            </Suspense>
        );
    }

    if (isPlansRoute) {
        return (
            <Suspense fallback={<AppLoader />}>
                <PlansWeb appSettings={appSettings} userProfile={userProfile || undefined} />
            </Suspense>
        );
    }

    if (isPaymentSuccessRoute) {
        return (
            <Suspense fallback={<AppLoader />}>
                <PaymentSuccessWeb />
            </Suspense>
        );
    }

    if (isDeleteRoute) {
        return (
                <Suspense fallback={<AppLoader />}>
                    <DeleteAccountWeb />
                </Suspense>
        );
    }

    if (isTermsRoute) {
        return (
                <TermsAndConditions />
        );
    }

    if (isPolicyRoute) {
        return (
                <PrivacyPolicy />
        );
    }

    if (activeItem === 'admin') {
        if (!isAdminAuthenticated) {
            return <div key="admin-login-state"><AdminLogin onLogin={() => setIsAdminAuthenticated(true)} /></div>;
        }

        const mockAdminProfile: UserProfile = {
            uid: 'admin-hardcoded',
            display_name: 'Admin User',
            department_id: 'admin',
            level: 'admin',
            current_streak: 0,
            last_activity_date: Date.now(),
            notifications_enabled: false,
            is_admin: true
        } as UserProfile;

        return (
                <Suspense fallback={<AppLoader />}>
                    <AdminPanel
                        userProfile={mockAdminProfile}
                        pathname={adminPath}
                        onNavigate={(path) => {
                            setAdminPath(path);
                            if (typeof window !== 'undefined') { window.history.pushState(null, '', path); }
                            if (!path.startsWith('/admin')) {
                                setActiveItem(resolveActiveItemFromPath(path));
                            }
                        }}
                    />
                </Suspense>
        );
    }

    if (isUploadCenterRoute) {
        if (!appSettings.upload_center_uploads_enabled) {
            return (
                <ComingSoonScreen
                    title="Textbook uploads are paused"
                    subtitle="The upload center is temporarily locked by an administrator."
                    supportText="Please check back later or contact an admin for access."
                />
            );
        }
        return (
                <UploadCenter />
        );
    }

    if (!user) {
        if (currentPath === '/about') {
            return (
                    <Suspense fallback={<AppLoader />}>
                        <AboutUsPage />
                    </Suspense>
            );
        }

        if (currentPath === '/contact') {
            return (
                    <Suspense fallback={<AppLoader />}>
                        <ContactUsPage />
                    </Suspense>
            );
        }

        if (currentPath.startsWith('/founder/')) {
            const founderId = currentPath.substring('/founder/'.length).split('/')[0];
            if (founderId) {
                return (
                        <Suspense fallback={<AppLoader />}>
                            <FounderPage founderId={founderId} />
                        </Suspense>
                );
            }
        }

        if (currentPath === '/' || currentPath === '' || currentPath === '/home') {
            if (Capacitor.isNativePlatform()) {
                return (
                    <div key="auth-state" className="min-h-screen">
                        {authView === 'login'
                            ? <Login onSwitchToSignUp={() => setAuthView('signup')} />
                            : <SignUp onSwitchToLogin={() => setAuthView('login')} />}
                    </div>
                );
            }
            return (
                    <LandingPage
                        onLogin={() => {
                            setAuthView('login');
                            if (typeof window !== 'undefined') window.history.pushState(null, '', '/login');
                        }}
                        onSignUp={() => {
                            setAuthView('signup');
                            if (typeof window !== 'undefined') window.history.pushState(null, '', '/signup');
                        }}
                    />
            );
        }
        return (
            <div key="auth-state" className="min-h-screen">
                {authView === 'login'
                    ? <Login onSwitchToSignUp={() => setAuthView('signup')} />
                    : <SignUp onSwitchToLogin={() => setAuthView('login')} />}
            </div>
        );
    }

    if (isAppSettingsLoading) {
        return <div key="settings-loader-state"><AppLoader /></div>;
    }

    if (appSettings.coming_soon_enabled && !isAdminRoute) {
        return (
            <div key="coming-soon-state" className="min-h-screen">
                <ComingSoonScreen
                    title="AVELUT is coming soon"
                    subtitle="We are polishing the full learning experience right now. Admins can reopen the app anytime."
                    supportText="If you are an admin, open the admin panel to manage launch settings."
                />
            </div>
        );
    }

    if (!userProfile) {
        return (
            <div key="no-profile-state" className="flex items-center justify-center min-h-screen bg-gray-100">
                <p>An error occurred loading your profile. Please refresh.</p>
            </div>
        );
    }

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div
            className="flex h-screen w-full bg-off-white dark:bg-black font-sans text-charcoal dark:text-white selection:bg-brand-200 selection:text-brand-900 overflow-hidden"
            onTouchStart={handleGlobalTouchStart}
            onTouchEnd={handleGlobalTouchEnd}
        >
            <NativePullToRefresh />

            <AppUpdateDropModal
                visible={updatePrompt.visible}
                title={updatePrompt.title}
                message={updatePrompt.message}
                mandatory={updatePrompt.mandatory}
                targetVersionLabel={updatePrompt.targetVersionName ? `v${updatePrompt.targetVersionName} (code ${updatePrompt.targetVersionCode})` : `Version code ${updatePrompt.targetVersionCode}`}
                onUpdate={() => {
                    void openUpdateInStore();
                }}
                onSkip={dismissUpdatePrompt}
            />

            <PWAInstallBannerOverlay />
            <SharedImagePromptModal
                visible={showSharedImagePrompt}
                imagePreview={sharedImagePreview}
                onScan={handleSharedImageScan}
                onCancel={handleSharedImageCancel}
            />

            <FloatingMenuButton
                onClick={handleToggleMenu}
                visible={false}
            />

            <Sidebar
                activeItem={activeItem}
                onItemClick={setActiveItem}
                userProfile={userProfile}
                onLogout={handleLogout}
                isMobileSidebarOpen={isMobileSidebarOpen}
                onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
                isCollapsed={isDesktopSidebarCollapsed}
                onToggleCollapse={() => setIsDesktopSidebarCollapsed(prev => !prev)}
                unreadCount={unreadCount}
                unreadMessagesCount={unreadMessagesCount}
                recentConversations={recentConversations}
                activeConversationId={activeConversationId}
                onSelectConversation={(id) => {
                    setActiveConversationId(id);
                    setActiveItem('chat');
                }}
                onNewChat={() => {
                    setActiveConversationId(null);
                    setActiveItem('chat');
                }}
                overlayRef={overlayRef}
                sidebarRef={sidebarRef}
            />
            <main ref={mainRef as any} className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                <Header
                    activeItem={activeItem}
                    currentPageLabel={typeof customHeaderConfig?.title === 'string' ? customHeaderConfig.title : currentPageLabel}
                    title={typeof customHeaderConfig?.title !== 'string' ? customHeaderConfig?.title : undefined}
                    unreadCount={unreadCount}
                    notifications={notifications}
                    onMarkAllAsRead={handleMarkAllNotificationsRead}
                    onMarkAsRead={handleMarkNotificationRead}
                    onMenuClick={handleToggleMenu}
                    onMessengerClick={() => setActiveItem('messenger')}
                    onCalendarClick={() => setIsCalendarOpen(true)}
                    unreadMessagesCount={unreadMessagesCount}
                    userProfile={userProfile}
                    leftActions={customHeaderConfig?.leftActions}
                    rightActions={customHeaderConfig?.rightActions}
                    className={customHeaderConfig?.className}
                    hideTitle={customHeaderConfig?.hideTitle}
                    hideDefaultRightActions={customHeaderConfig?.hideDefaultRightActions}
                    hideProfileAvatar={customHeaderConfig?.hideProfileAvatar !== undefined ? customHeaderConfig.hideProfileAvatar : !!customHeaderConfig}
                    onNavigate={(route) => setActiveItem(route)}
                    onLogoutClick={handleLogout}
                    onNewChat={customHeaderConfig?.onNewChat || (() => { setActiveConversationId(null); setActiveItem('chat'); })}
                    onClearChat={customHeaderConfig?.onClearChat}
                    onDeleteChat={customHeaderConfig?.onDeleteChat}
                    hasActiveChat={customHeaderConfig?.hasActiveChat ?? Boolean(activeConversationId)}
                    hasMessages={customHeaderConfig?.hasMessages ?? false}
                />
                <div
                    id="main-scroll-container"
                    className={
                        activeItem === 'chat' || activeItem === 'messenger' || activeItem === 'voice_tutorial' || activeItem === 'study_guide'
                        ? "flex-1 min-h-0 overflow-hidden flex flex-col"
                        : "flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden content-with-bottom-nav isolate"
                    }
                >
                    {userProfile && (
                        <MainContent
                            key={activeItem}
                            activeItem={activeItem}
                            user={user}
                            userProfile={userProfile}
                            appSettings={appSettings}
                            userProgress={userProgress}
                            dashboardData={dashboardData}
                            initialMessengerChatId={pendingMessengerChatId}
                            unreadMessagesCount={unreadMessagesCount}
                            handleLogout={handleLogout}
                            handleProfileUpdate={handleProfileUpdate}
                            handleDeleteAccount={handleAccountDeletion}
                            startTour={startTour}
                            triggerScanRef={triggerScanRef}
                            onNavigate={setActiveItem}
                            setCustomHeaderConfig={setCustomHeaderConfig}
                            handleOnboardingComplete={handleOnboardingComplete}
                            notifications={notifications}
                            onMarkAsRead={handleMarkNotificationRead}
                            onMarkAllAsRead={handleMarkAllNotificationsRead}
                            onConversationsUpdate={setRecentConversations}
                            activeConversationId={activeConversationId}
                            onSelectConversation={setActiveConversationId}
                            onOpenMenu={handleOpenMenu}
                        />
                    )}
                </div>
            </main>
            {showPrivacyModal && <PrivacyConsentModal onAllow={() => handleConsent(true)} onDeny={() => handleConsent(false)} />}
            {userProfile && (
                <CalendarModal
                    isOpen={isCalendarOpen}
                    onClose={() => setIsCalendarOpen(false)}
                    userProfile={userProfile}
                />
            )}
            <BottomNavBar
              activeItem={activeItem}
              onItemClick={(id) => {
                if (id === 'mobile_menu') {
                    setIsMobileSidebarOpen(true);
                } else {
                    setActiveItem(id);
                }
              }}
              onCenterActionClick={() => {
                  if (activeItem === 'visual_solver') {
                      triggerScanRef.current?.();
                  } else {
                      setActiveItem('visual_solver');
                  }
              }}
              isVisible={activeItem !== 'chat' && activeItem !== 'voice_tutorial' && !customHeaderConfig?.hideBottomNav}
              userProfile={userProfile}
            />
            <GuidedTour
                steps={tourSteps}
                isOpen={isTourOpen}
                onClose={handleTourClose}
            />

            {(isOffline || showOnlineRestored) && (
                <div
                    className={`fixed bottom-[calc(max(env(safe-area-inset-bottom),0px)+65px)] md:bottom-0 left-0 right-0 z-[100] h-[30px] flex items-center justify-center text-[12px] font-bold text-white transition-all duration-300 shadow-md ${isOffline ? 'bg-red-500' : 'bg-green-500'}`}
                >
                    {isOffline ? 'No internet or slow network' : 'Network restored'}
                </div>
            )}
        </div>
    );
};

export default App;
