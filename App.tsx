import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { readCachedJson, writeCachedJson } from './utils/cache';
import { GoogleGenAI, Type } from '@google/genai';
import { auth as firebaseAuth, firebaseSignOut, db, onAuthStateChanged, updateProfile, type FirebaseUser } from './firebase';
import { ref as dbRef, onValue, off, set, push, update, onDisconnect, serverTimestamp, get } from 'firebase/database';
import { DEFAULT_USAGE_SETTINGS } from './utils/appSettings';
import type { UserProfile, UserProgress, DashboardData, Notification as NotificationType, ExamHistoryItem, Course, DashboardAssessment } from './types';
import { Login } from './components/Login';
import { SignUp } from './components/SignUp'; 
import { AdminLogin } from './components/AdminLogin';
import { UploadCenter } from './components/UploadCenter';
import { Onboarding } from './components/Onboarding';
import { ActivationScreen } from './components/ActivationScreen';
import { createVanTutorAI } from './utils/inference';
import { AdminPanel } from './components/AdminPanel';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MainContent } from './MainContent';
import { NotificationsPanel } from './components/NotificationsPanel';
import { BottomNavBar } from './components/BottomNavBar';
import { useToast } from './hooks/useToast';
import { useApiLimiter } from './hooks/useApiLimiter';
import { useAppSettings } from './hooks/useAppSettings';
import { navigationItems, adminNavigationItems } from './constants';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import GuidedTour, { TourStep } from './components/GuidedTour';
import { getWindowPathname } from './utils/pathname';
import ErrorBoundary from './components/ErrorBoundary';
import { LogoIcon } from './components/icons/LogoIcon';
import { MenuIcon } from './components/icons/MenuIcon';
import { ComingSoonScreen } from './components/ComingSoonScreen';

declare var __app_id: string;

const AppLoader: React.FC = () => {
  return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-off-white text-charcoal" role="status" aria-label="Loading Vantutor application">
      <div className="animate-bounce">
                <LogoIcon className="w-28 h-28 loader-logo" />
      </div>
            <h2 className="text-sm font-bold tracking-widest text-charcoal/60 mt-4 uppercase animate-pulse">Vantutor Loading</h2>
    </div>
  );
};

// =========================================================================
// HIGH ACCURACY PWA AUTO-INSTALL HOOK & INTERFACE COMPONENT
// =========================================================================
const usePWAInstallEngine = () => {
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [isIOS, setIsIOS] = useState(false);
    const [isStandalone, setIsStandalone] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        // Check if application environment is running standalone already
        const isAppStandalone = window.matchMedia('(display-mode: standalone)').matches 
            || (window.navigator as any).standalone === true;
        setIsStandalone(isAppStandalone);

        // Track Apple hardware environment profiles
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
    const [dismissed, setDismissed] = useState(false);
    const canTriggerNativeInstall = !!deferredPrompt;

    if (isStandalone || dismissed) return null;

    return (
        <div className="fixed bottom-5 right-5 z-[99998] w-[min(92vw,380px)] overflow-hidden rounded-[28px] border border-brand-100 bg-off-white shadow-[0_24px_80px_rgba(0,45,98,0.22)] animate-fade-in" role="dialog" aria-modal="false" aria-label="Install VANTUTOR">
            <div className="relative p-4">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-ice-blue via-brand-500 to-brand-900" />

                <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-white p-3 border border-brand-100 shadow-sm">
                        <LogoIcon className="h-11 w-11 loader-logo" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-black tracking-tight text-charcoal">
                                {canTriggerNativeInstall ? 'Install VANTUTOR' : isIOS ? 'Add VANTUTOR to iPhone' : 'Install VANTUTOR'}
                            </h2>
                            <span className="rounded-full bg-ice-blue px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-brand-900">
                                {isIOS ? 'iOS' : 'Android'}
                            </span>
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-charcoal/65">
                            {canTriggerNativeInstall
                                ? 'Install VANTUTOR from your browser for quick access any time.'
                                : isIOS
                                    ? 'Open Safari’s share menu, then choose Add to Home Screen.'
                                    : 'Open the browser menu and choose Install app.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setDismissed(true)}
                        className="rounded-full p-1 text-charcoal/45 transition hover:bg-white hover:text-charcoal"
                        aria-label="Dismiss install tip"
                    >
                        ✕
                    </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white p-3 border border-brand-100 shadow-sm">
                        <div className="flex items-center gap-2 text-brand-900">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                                {canTriggerNativeInstall ? (
                                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 3v12" />
                                        <path d="M7 8l5-5 5 5" />
                                        <rect x="4" y="15" width="16" height="6" rx="2" />
                                    </svg>
                                ) : (
                                    <MenuIcon className="h-5 w-5" />
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-brand-700">Step 1</p>
                                <p className="text-sm font-bold">{canTriggerNativeInstall ? 'Tap Install' : 'Tap Menu'}</p>
                            </div>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-charcoal/60">
                            {canTriggerNativeInstall
                                ? 'Confirm installation in the browser prompt.'
                                : isIOS
                                    ? 'Open Safari’s share menu.'
                                    : 'Open Chrome’s menu in the top-right corner.'}
                        </p>
                    </div>

                    <div className="rounded-2xl bg-white p-3 border border-brand-100 shadow-sm">
                        <div className="flex items-center gap-2 text-brand-900">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 3v12" />
                                    <path d="M7 8l5-5 5 5" />
                                    <rect x="4" y="15" width="16" height="6" rx="2" />
                                </svg>
                            </div>
                            <div className="min-w-0">
                                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-brand-700">Step 2</p>
                                <p className="text-sm font-bold">Add to Home</p>
                            </div>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-charcoal/60">
                            {canTriggerNativeInstall
                                ? 'The browser will add VANTUTOR to your device.'
                                : 'Choose Add to Home Screen to finish setup.'}
                        </p>
                    </div>
                </div>

                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-brand-500 px-4 py-3 text-off-white">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
                        <LogoIcon className="h-6 w-6 loader-logo" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-bold leading-tight">Install from Chrome for quick access</p>
                        <p className="text-[11px] text-white/80">No app store required, just a browser install.</p>
                    </div>
                    {canTriggerNativeInstall && (
                        <button
                            type="button"
                            onClick={() => executeInstallationPipeline()}
                            className="ml-auto rounded-full bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-brand-900 transition hover:bg-ice-blue"
                        >
                            Install
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// ==========================================
// UTILITY ROUTING PROTOCOLS
// ==========================================
const normalizeRouteSegment = (segment: string): string => segment.toLowerCase().replace(/-/g, '_');

const ALLOWED_ROUTE_ITEMS = new Set([
    'dashboard',
    ...navigationItems.map(item => item.id),
    'messenger',
    'settings',
    'help',
    'admin'
].map(normalizeRouteSegment));

const resolveActiveItemFromPath = (pathname: string): string => {
    if (pathname === '/' || pathname === '/dashboard') return 'dashboard';
    const rawSegment = pathname.substring(1).split('/')[0];
    if (!rawSegment) return 'visual_solver';
    let decodedSegment = rawSegment;
    try {
        decodedSegment = decodeURIComponent(rawSegment);
    } catch (error) {
        console.warn('Invalid route segment encoding:', rawSegment, error);
        return 'visual_solver';
    }
    const normalizedSegment = normalizeRouteSegment(decodedSegment);
    return ALLOWED_ROUTE_ITEMS.has(normalizedSegment) ? normalizedSegment : 'visual_solver';
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

// ==========================================
// CORE APP CONTEXT ENGINE INITIALIZATION
// ==========================================
const App: React.FC = () => {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [userProgress, setUserProgress] = useState<UserProgress>({});
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
    const [notifications, setNotifications] = useState<NotificationType[]>([]);

    
    const [isLoading, setIsLoading] = useState(true);
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [isOnboarding, setIsOnboarding] = useState(false);
    const [authView, setAuthView] = useState<'login' | 'signup'>('login');

    const [activeItem, setActiveItemState] = useState<string>(() => {
        const item = resolveActiveItemFromPath(getWindowPathname());
        return item === 'admin' ? 'admin' : item;
    });
    const [adminPath, setAdminPath] = useState<string>(() => {
        const pathname = getWindowPathname();
        return resolveActiveItemFromPath(pathname) === 'admin' ? pathname : '/admin';
    });

    const syncItemFromPath = useCallback((pathname: string) => {
            if (pathname.startsWith('/upload-center')) {
                return;
            }
        const item = resolveActiveItemFromPath(pathname);
        setActiveItemState(item === 'admin' ? 'admin' : item);
        if (item === 'admin') {
            setAdminPath(pathname.startsWith('/admin') ? pathname : '/admin');
            return;
        }
        if (pathname !== '/' && pathname !== '/dashboard' && typeof window !== 'undefined') {
            window.history.replaceState(null, '', '/');
        }
    }, []);

    const setActiveItem = useCallback((item: string) => {
        setActiveItemState(item);
        if (item === 'admin') {
            const pathname = getWindowPathname();
            const nextPath = pathname.startsWith('/admin') ? pathname : '/admin';
            if (pathname !== nextPath && typeof window !== 'undefined') {
                window.history.pushState(null, '', nextPath);
            }
            setAdminPath(nextPath);
            return;
        }
        const pathname = getWindowPathname();
        if (pathname === '/admin' && typeof window !== 'undefined') {
            window.history.pushState(null, '', '/');
        } else if (pathname.startsWith('/admin') && typeof window !== 'undefined') {
            window.history.replaceState(null, '', '/');
        }
    }, []);

    useEffect(() => {
        const handlePopState = () => syncItemFromPath(getWindowPathname());
        handlePopState();
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [syncItemFromPath]);

    const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem('vantutor_admin_authenticated') === 'true';
    });
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [pendingMessengerChatId, setPendingMessengerChatId] = useState<string | null>(null);

    const currentPageLabel = activeItem === 'messenger' 
        ? 'Messenger' 
        : (navigationItems.find(item => item.id === activeItem)?.label || 'Dashboard');

    const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
    const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [isTourOpen, setIsTourOpen] = useState(false);
    const { settings: appSettings, isLoading: isAppSettingsLoading } = useAppSettings();
    const ai = useMemo(() => (
        createVanTutorAI(appSettings, userProfile)
    ), [appSettings, userProfile]);
    const isUploadCenterRoute = getWindowPathname().startsWith('/upload-center');
    const isAdminRoute = getWindowPathname().startsWith('/admin');

        const applyMessengerTarget = useCallback((chatId: string | null | undefined) => {
                if (!chatId) return;
                setActiveItem('messenger');
                setPendingMessengerChatId(chatId);
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

    const { addToast } = useToast();
    const { attemptApiCall } = useApiLimiter();
    const tourStatusRef = useRef<'unknown' | 'checked' | 'shown'>('unknown');

    const startTour = useCallback(() => {
        setActiveItem('dashboard');
        setTimeout(() => setIsTourOpen(true), 300);
    }, [setActiveItem]);

    useEffect(() => {
        const checkAndSeedUsageSettings = async () => {
            try {
                const usageSettingsRef = dbRef(db, 'app_settings/global/usage_settings');
                const snapshot = await get(usageSettingsRef);
                if (!snapshot.exists()) {
                    await set(usageSettingsRef, DEFAULT_USAGE_SETTINGS);
                    console.log('Seeded default usage settings to Firebase successfully.');
                }
            } catch (err) {
                console.error('Failed to seed usage settings:', err);
            }
        };
        checkAndSeedUsageSettings();
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
          setUser(currentUser);
          if (!currentUser) {
            setUserProfile(null);
            tourStatusRef.current = 'unknown';
          }
          setIsLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem('vantutor_admin_authenticated', isAdminAuthenticated ? 'true' : 'false');
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
        if (!user) {
            setUserProfile(null);
            setIsProfileLoading(false);
            return;
        }
        const cacheKey = `vantutor_profile_${user.uid}`;
        const cachedProfile = readCachedJson<UserProfile | null>(cacheKey, null);
        if (cachedProfile) {
            setUserProfile(cachedProfile);
            setIsProfileLoading(false);
            if (!cachedProfile.department_id) {
                setIsOnboarding(true);
            } else {
                setIsOnboarding(false);
            }
        } else {
            setIsProfileLoading(true);
        }

        const userRef = dbRef(db, `users/${user.uid}`);
        
        const unsubscribeProfile = onValue(userRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
                writeCachedJson(cacheKey, data);
                if (!data.department_id) {
                    setIsOnboarding(true);
                } else {
                    setUserProfile(data as UserProfile);
                    setIsOnboarding(false);
                    if (tourStatusRef.current === 'unknown') {
                        if (data.privacy_consent?.granted && !data.has_completed_tour) {
                            startTour();
                            tourStatusRef.current = 'shown';
                        } else {
                            tourStatusRef.current = 'checked';
                        }
                    }
                }
            } else {
                setIsOnboarding(true);
            }
            setIsProfileLoading(false);
        }, (error) => {
            console.error("Error fetching user profile:", error);
            if (!cachedProfile) {
                addToast("Failed to load your profile.", "error");
            }
            setIsProfileLoading(false);
        });
        
        return () => { off(userRef, 'value', unsubscribeProfile); };
    }, [user, addToast, startTour]);

    useEffect(() => {
        if (!user) return;
        const syncAuthIdentityToProfile = async () => {
            try {
                const userRef = dbRef(db, `users/${user.uid}`);
                const snapshot = await get(userRef);
                const existingProfile = snapshot.val() || {};
                const nextProfile = {
                    uid: user.uid,
                    display_name: user.displayName || existingProfile.display_name || 'Learner',
                    email: user.email || existingProfile.email || '',
                    photo_url: user.photoURL || existingProfile.photo_url || '',
                };
                const hasProfileUpdates = Object.entries(nextProfile).some(([key, value]) => existingProfile[key] !== value && value);
                if (hasProfileUpdates) {
                    await update(userRef, nextProfile);
                }
            } catch (error) {
                console.error('Failed to sync auth identity to profile:', error);
            }
        };
        syncAuthIdentityToProfile();
    }, [user]);



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
    }, [userProfile, user]);
    
    useEffect(() => {
        if (!userProfile) return;
        const cacheKey = `vantutor_progress_${userProfile.uid}`;
        const cachedProgress = readCachedJson<UserProgress>(cacheKey, {});
        setUserProgress(cachedProgress);

        const progressRef = dbRef(db, `user_progress/${userProfile.uid}`);
        const unsubscribeProgress = onValue(progressRef, (snapshot) => {
            const data = snapshot.val() || {};
            setUserProgress(data);
            writeCachedJson(cacheKey, data);
        });
        return () => { off(progressRef, 'value', unsubscribeProgress); };
    }, [userProfile]);

    useEffect(() => {
        if (!userProfile) {
            setUnreadMessagesCount(0);
            return;
        }

        const cacheKeyDashboard = `vantutor_dashboard_${userProfile.uid}`;
        const cachedDashboard = readCachedJson<DashboardData | null>(cacheKeyDashboard, null);
        if (cachedDashboard) {
            setDashboardData(cachedDashboard);
        }

        const cacheKeyNotif = `vantutor_notifications_${userProfile.uid}`;
        const cachedNotif = readCachedJson<NotificationType[]>(cacheKeyNotif, []);
        setNotifications(cachedNotif);
        
        const setupDashboardData = async () => {
            try {
                const deptCacheKey = `vantutor_dept_data_${userProfile.department_id}`;
                let departmentData = readCachedJson<any>(deptCacheKey, null);
                if (!departmentData) {
                    const departmentSnapshot = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
                    departmentData = departmentSnapshot.val();
                    if (departmentData) {
                        writeCachedJson(deptCacheKey, departmentData);
                    }
                }
                if (!departmentData) return;

                const normalizedUserLevel = normalizeLevelValue(userProfile.level);
                const coursesForLevel = (departmentData.course_list || []).filter((course: Course) => (
                    normalizeLevelValue(course.level) === normalizedUserLevel
                ));
                
                const totalTopics = coursesForLevel.reduce((acc: number, course: Course) => acc + (course.topics?.length || 0), 0) || 0;
                const topicIdsForLevel = new Set<string>();
            
                coursesForLevel.forEach(course => {
                    course.topics?.forEach(topic => { topicIdsForLevel.add(topic.topic_id); });
                });

                const completedTopicsCount = Object.keys(userProgress)
                    .filter(topicId => userProgress[topicId].is_complete && topicIdsForLevel.has(topicId))
                    .length;
                const topicDurations = Object.entries(userProgress)
                    .filter(([topicId, progress]) => topicIdsForLevel.has(topicId) && typeof progress.study_duration_seconds === 'number' && progress.study_duration_seconds > 0)
                    .map(([, progress]) => progress.study_duration_seconds || 0);
                const totalStudySeconds = topicDurations.reduce((acc: number, seconds: number) => acc + seconds, 0);
                const averageTopicStudySeconds = topicDurations.length > 0 ? Math.round(totalStudySeconds / topicDurations.length) : 0;

                const completedCoursesCount = coursesForLevel.filter((course: Course) => {
                    const topicIds = course.topics?.map(topic => topic.topic_id) || [];
                    return topicIds.length > 0 && topicIds.every(topicId => userProgress[topicId]?.is_complete);
                }).length;
                const courseDurations = coursesForLevel
                    .map((course: Course) => (course.topics || []).reduce((acc: number, topic) => acc + (userProgress[topic.topic_id]?.study_duration_seconds || 0), 0))
                    .filter((seconds: number) => seconds > 0);
                const averageCourseStudySeconds = courseDurations.length > 0 ? Math.round(courseDurations.reduce((acc: number, seconds: number) => acc + seconds, 0) / courseDurations.length) : 0;

                const examHistoryRef = dbRef(db, `exam_history/${userProfile.uid}`);
                const examSnapshot = await get(examHistoryRef);
                const examData = examSnapshot.val() || {};
                const examHistory = Object.values(examData).sort((a: any, b: any) => b.timestamp - a.timestamp).slice(0, 5) as ExamHistoryItem[];
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
                    examHistory: examHistory
                };
                setDashboardData(nextDashboardData);
                writeCachedJson(cacheKeyDashboard, nextDashboardData);
            } catch (error) {
                console.error("Error setting up dashboard data:", (error as Error).message || error);
            }
        };

        setupDashboardData();
        
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

        const examHistoryRef = dbRef(db, `exam_history/${userProfile.uid}`);
        const unsubscribeExamHistory = onValue(examHistoryRef, (snapshot) => {
            const data = snapshot.val() || {};
            const examHistory = Object.values(data).sort((a: any, b: any) => b.timestamp - a.timestamp).slice(0, 5) as ExamHistoryItem[];
            setDashboardData(prev => {
                const next = prev ? { ...prev, examHistory } : null;
                if (next) writeCachedJson(cacheKeyDashboard, next);
                return next;
            });
        });

        return () => {
            off(notificationsRef, 'value', unsubscribeNotifications);
            off(userChatsRef, 'value', unsubscribeUnreadCount);
            off(examHistoryRef, 'value', unsubscribeExamHistory);
        };
    }, [userProfile, userProgress]);



    const handleLogout = async () => {
        try {
            await firebaseSignOut(firebaseAuth);
        } catch (error: any) {
            console.error("Logout failed:", error.message || error);
            addToast(error.message || "Failed to log out.", "error");
        }
    };

    const handleOnboardingComplete = async (profileData: { departmentId: string; level: string }) => {
        if (!user) return;
        const now = Date.now();
        const displayName = user.displayName || 'Learner';
        const photoURL = user.photoURL || '';
        const userProfileData: Omit<UserProfile, 'privacy_consent'> = {
            uid: user.uid,
            display_name: displayName,
            photo_url: photoURL,
            department_id: profileData.departmentId,
            level: profileData.level,
            current_streak: 0,
            last_activity_date: now,
            notifications_enabled: false,
            is_online: true,
            last_seen: now,
            has_completed_tour: false,
        };
        try {
            const userRef = dbRef(db, `users/${user.uid}`);
            await update(userRef, userProfileData);
            
            const notificationRef = dbRef(db, `notifications/${user.uid}`);
            const newNotifRef = push(notificationRef);
            await set(newNotifRef, {
                type: 'welcome',
                title: 'Welcome to VANTUTOR!',
                message: 'Your learning journey starts now. Explore the study guide to begin.',
                is_read: false,
                timestamp: serverTimestamp()
            });
            
            setUserProfile(prev => ({...prev, ...userProfileData } as UserProfile));
            setIsOnboarding(false);
        } catch (error: any) {
            console.error("Failed to complete onboarding:", error.message || error);
            addToast(error.message || "Could not save your profile.", "error");
        }
    };

    const handleMarkNotificationRead = async (id: string) => {
        if (!user) return;
        const notificationRef = dbRef(db, `notifications/${user.uid}/${id}`);
        try {
            await update(notificationRef, { is_read: true });
        } catch (err: any) {
            console.error("Error marking notification read:", err);
            addToast("Could not update notification.", "error");
        }
    };

    const handleMarkAllNotificationsRead = async () => {
        if (!user) return;
        const notificationsRef = dbRef(db, `notifications/${user.uid}`);
        try {
            const snapshot = await get(notificationsRef);
            const data = snapshot.val() || {};
            const updates: any = {};
            Object.keys(data).forEach(id => {
                if (!data[id].is_read) { updates[`${id}/is_read`] = true; }
            });
            if (Object.keys(updates).length > 0) {
                await update(notificationsRef, updates);
                addToast('All notifications marked as read.', 'success');
            }
        } catch (error: any) {
            console.error("Error clearing notifications:", error);
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
      { target: 'body', title: '👋 Welcome to VANTUTOR!', content: "Let's take a quick tour of your new learning dashboard.", placement: 'center' },
      { target: '[data-tour-id="dashboard-content"]', title: '📊 Your Dashboard', content: 'View your progress, streaks, and personalized lessons.', placement: 'bottom' },
      { target: isMobile ? '[data-tour-id="bottomnav-study_guide"]' : '[data-tour-id="sidebar-study_guide"]', title: '📚 Study Guide', content: 'Explore tutorials and start new lessons anytime.', placement: isMobile ? 'top' : 'right' },
      { target: isMobile ? '[data-tour-id="bottomnav-visual_solver"]' : '[data-tour-id="sidebar-visual_solver"]', title: '📸 Visual Solver', content: 'Scan any problem and get instant or detailed tutorials.', placement: isMobile ? 'top' : 'right' },
      { target: isMobile ? '[data-tour-id="bottomnav-messenger"]' : '[data-tour-id="header-messenger"]', title: '🤝 Messenger', content: 'Connect with other learners and chat privately.', placement: isMobile ? 'top' : 'bottom' },
      ...(isMobile ? [{ target: '[data-tour-id="mobile-menu-button"]', title: '⚙️ Main Menu', content: 'Access your settings, help, and logout options from here.', placement: 'bottom' as const }] : [{ target: '[data-tour-id="sidebar-settings"]', title: '⚙️ Settings', content: 'Update your info and view your achievements.', placement: 'top' as const }]),
      { target: 'body', title: "🎉 You're all set!", content: 'Enjoy exploring your learning journey. Tap "Finish" to start!', placement: 'center' },
    ];

    if (isLoading || isProfileLoading) {
        return <AppLoader />;
    }

    if (activeItem === 'admin') {
        if (!isAdminAuthenticated) {
            return <AdminLogin onLogin={() => setIsAdminAuthenticated(true)} />;
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
            <ErrorBoundary>
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
            </ErrorBoundary>
        );
    }
    
    if (!user) {
        return authView === 'login' 
            ? <Login onSwitchToSignUp={() => setAuthView('signup')} /> 
            : <SignUp onSwitchToLogin={() => setAuthView('login')} />;
    }

    if (isAppSettingsLoading) {
        return <AppLoader />;
    }

    if (appSettings.coming_soon_enabled && !isAdminRoute) {
        return (
            <ComingSoonScreen
                title="VANTUTOR is coming soon"
                subtitle="We are polishing the full learning experience right now. Admins can reopen the app anytime."
                supportText="If you are an admin, open the admin panel to manage launch settings."
            />
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
            <ErrorBoundary>
                <UploadCenter />
            </ErrorBoundary>
        );
    }

    if (isOnboarding) {
        return <Onboarding user={user} onOnboardingComplete={handleOnboardingComplete} />;
    }
    
    if (!userProfile) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <p>An error occurred loading your profile. Please refresh.</p>
            </div>
        );
    }

    if (userProfile && !userProfile.is_activated && !userProfile.is_admin && !isAdminRoute) {
        return (
            <ActivationScreen
                user={user}
                userProfile={userProfile}
                appSettings={appSettings}
                handleProfileUpdate={handleProfileUpdate}
                handleLogout={handleLogout}
                addToast={addToast}
            />
        );
    }

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div className="h-screen flex flex-col md:flex-row bg-off-white text-charcoal font-sans overflow-hidden relative">
            {/* Automatic PWA App Intercept Modal Overlay */}
            <PWAInstallBannerOverlay />

            <Sidebar
                activeItem={activeItem}
                onItemClick={setActiveItem}
                userProfile={userProfile}
                onLogout={handleLogout}
                isMobileSidebarOpen={isMobileSidebarOpen}
                onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
                unreadCount={unreadCount}
                unreadMessagesCount={unreadMessagesCount}
            />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                <Header 
                    currentPageLabel={currentPageLabel}
                    unreadCount={unreadCount}
                    onNotificationsClick={() => setIsNotificationsPanelOpen(true)}
                    onMenuClick={() => setIsMobileSidebarOpen(true)}
                    onMessengerClick={() => setActiveItem('messenger')}
                    unreadMessagesCount={unreadMessagesCount}
                    userProfile={userProfile}
                />
                <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden content-with-bottom-nav">
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
                            handleLogout={handleLogout}
                            handleProfileUpdate={handleProfileUpdate}
                            handleDeleteAccount={handleAccountDeletion}
                            startTour={startTour}
                        />
                    )}
                </div>
            </main>
            {showPrivacyModal && <PrivacyConsentModal onAllow={() => handleConsent(true)} onDeny={() => handleConsent(false)} />}
            <NotificationsPanel
                notifications={notifications}
                isOpen={isNotificationsPanelOpen}
                onClose={() => setIsNotificationsPanelOpen(false)}
                onMarkAsRead={handleMarkNotificationRead}
                onMarkAllAsRead={handleMarkAllNotificationsRead}
            />
            <BottomNavBar
              activeItem={activeItem}
              onItemClick={setActiveItem}
              isVisible={!isMobileSidebarOpen}
              userProfile={userProfile}
            />
            <GuidedTour 
                steps={tourSteps}
                isOpen={isTourOpen}
                onClose={handleTourClose}
            />
        </div>
    );
};

export default App;
