import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { auth as firebaseAuth, firebaseSignOut, db, onAuthStateChanged, updateProfile, type FirebaseUser } from './firebase';
import { ref as dbRef, onValue, off, set, push, update, onDisconnect, serverTimestamp, get } from 'firebase/database';
import type { UserProfile, UserProgress, DashboardData, Notification as NotificationType, ExamHistoryItem, Course, DashboardAssessment } from './types';
import { Login } from './components/Login';
import { SignUp } from './components/SignUp';
import { AdminLogin } from './components/AdminLogin';
import { Onboarding } from './components/Onboarding';
import { AdminPanel } from './components/AdminPanel';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MainContent } from './MainContent';
import { NotificationsPanel } from './components/NotificationsPanel';
import { BottomNavBar } from './components/BottomNavBar';
import { useToast } from './hooks/useToast';
import { navigationItems, adminNavigationItems } from './constants';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import GuidedTour, { TourStep } from './components/GuidedTour';
import { getWindowPathname } from './utils/pathname';
import ErrorBoundary from './components/ErrorBoundary';

declare var __app_id: string;

// @ts-ignore
const ai = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;

// =========================================================================
// CUSTOM VANTUTOR PWA LOGO (FLAT OUTLINE VECTOR DESIGN STYLE)
// =========================================================================
const VanTutorLogoIcon: React.FC<{ className?: string }> = ({ className = "w-24 h-24" }) => (
  <svg className={className} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Interconnected Knowledge Network Base */}
    <path d="M12 44C20 48 44 48 52 44" stroke="#25d366" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M22 47V53C22 55.5 25 57 32 57C39 57 42 55.5 42 53V47" stroke="#25d366" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    {/* Hanging Graduation Tassel */}
    <path d="M50 24V36M50 36L47 39M50 36L53 39" stroke="#111b21" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    {/* Main Geometric Vector Cap Diamond */}
    <path d="M32 9L58 22L32 35L6 22L32 9Z" fill="white" stroke="#111b21" strokeWidth="3" strokeLinejoin="round"/>
    {/* Core Tech Node Star Intersection */}
    <circle cx="32" cy="22" r="3" fill="#25d366" stroke="#111b21" strokeWidth="2"/>
    <path d="M32 15V19M32 25V29M25 22H29M35 22H39" stroke="#111b21" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const AppLoader: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50" role="status" aria-label="Loading Vantutor application">
      <div className="animate-bounce">
        <VanTutorLogoIcon className="w-28 h-28" />
      </div>
      <h2 className="text-sm font-bold tracking-widest text-neutral-400 mt-4 uppercase animate-pulse">Vantutor Loading</h2>
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

    if (isStandalone || dismissed) return null;

    // Standard Android / Chromium automatic engine trigger prompt screen
    if (deferredPrompt) {
        return (
            <div className="fixed inset-0 z-[99999] bg-white flex flex-col items-center justify-center p-6 text-center animate-fade-in">
                <div className="mb-6 p-4 bg-neutral-50 rounded-full shadow-inner border border-neutral-100">
                    <VanTutorLogoIcon className="w-24 h-24" />
                </div>
                <h2 className="text-2xl font-black text-[#111b21] mb-2 tracking-tight">Install VANTUTOR Application</h2>
                <p className="text-sm text-neutral-500 max-w-sm mb-8 leading-relaxed">
                    Install Vantutor directly onto your device to unlock lightning-fast private message sync, persistence tracking, and fluid dashboard interactions.
                </p>
                <div className="w-full max-w-xs flex flex-col gap-3">
                    <button 
                        onClick={executeInstallationPipeline}
                        className="w-full bg-[#25d366] text-white py-3.5 rounded-xl font-bold text-base shadow-md hover:bg-[#20ba5a] active:scale-98 transition-all"
                    >
                        Install App Now
                    </button>
                    <button 
                        onClick={() => setDismissed(true)}
                        className="w-full bg-neutral-100 text-neutral-500 py-3 rounded-xl font-semibold text-sm hover:bg-neutral-200 transition-colors"
                    >
                        Continue via Web Browser
                    </button>
                </div>
            </div>
        );
    }

    // Manual custom onboarding modal for iOS / Mobile Safari environments
    if (isIOS) {
        return (
            <div className="fixed bottom-4 left-4 right-4 z-[99999] bg-white p-5 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.15)] border border-neutral-100 flex flex-col items-center text-center animate-fade-in">
                <div className="flex items-center gap-3 w-full border-b border-neutral-100 pb-3 mb-3">
                    <VanTutorLogoIcon className="w-10 h-10 shrink-0" />
                    <div className="text-left">
                        <h3 className="font-bold text-[#111b21] text-sm">Add Vantutor to Home Screen</h3>
                        <p className="text-xs text-neutral-400">Run natively on your iPhone or iPad</p>
                    </div>
                    <button onClick={() => setDismissed(true)} className="ml-auto text-neutral-400 text-sm p-1">✕</button>
                </div>
                <p className="text-xs text-neutral-500 text-left w-full leading-relaxed">
                    Tap the native share icon <span className="font-bold text-blue-500">“Share”</span> button below in your Safari panel, then scroll downwards and select <span className="font-bold text-[#111b21]">“Add to Home Screen”</span> to complete setup.
                </p>
            </div>
        );
    }

    return null;
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
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    
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

    const currentPageLabel = activeItem === 'messenger' 
        ? 'Messenger' 
        : (navigationItems.find(item => item.id === activeItem)?.label || 'Dashboard');

    const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
    const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [isTourOpen, setIsTourOpen] = useState(false);
    const dashboardAssessmentKeyRef = useRef('');

    const { addToast } = useToast();
    const tourStatusRef = useRef<'unknown' | 'checked' | 'shown'>('unknown');

    const startTour = useCallback(() => {
        setActiveItem('dashboard');
        setTimeout(() => setIsTourOpen(true), 300);
    }, [setActiveItem]);

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
        setIsProfileLoading(true);
        const userRef = dbRef(db, `users/${user.uid}`);
        
        const unsubscribeProfile = onValue(userRef, (snapshot) => {
            const data = snapshot.val();
            if (data) {
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
            addToast("Failed to load your profile.", "error");
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
        if (!userProfile) return;
        const usersRef = dbRef(db, 'users');
        const unsubscribeAllUsers = onValue(usersRef, (snapshot) => {
            const data = snapshot.val() || {};
            const userList: UserProfile[] = Object.values(data);
            setAllUsers(userList.filter(u => u.uid !== userProfile.uid));
        });
        return () => off(usersRef, 'value', unsubscribeAllUsers);
    }, [userProfile]);

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
        const progressRef = dbRef(db, `user_progress/${userProfile.uid}`);
        const unsubscribeProgress = onValue(progressRef, (snapshot) => {
            setUserProgress(snapshot.val() || {});
        });
        return () => { off(progressRef, 'value', unsubscribeProgress); };
    }, [userProfile]);

    useEffect(() => {
        if (!userProfile) {
            setUnreadMessagesCount(0);
            return;
        }
        
        const setupDashboardData = async () => {
            try {
                const departmentSnapshot = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
                const departmentData = departmentSnapshot.val();
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

                setDashboardData({ 
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
                });
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
            setNotifications(notificationList.slice(0, 20));
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
            setDashboardData(prev => prev ? { ...prev, examHistory } : null);
        });

        return () => {
            off(notificationsRef, 'value', unsubscribeNotifications);
            off(userChatsRef, 'value', unsubscribeUnreadCount);
            off(examHistoryRef, 'value', unsubscribeExamHistory);
        };
    }, [userProfile, userProgress]);

    useEffect(() => {
        if (!userProfile || !dashboardData) return;

        const assessmentKey = [
            dashboardData.totalTopics,
            dashboardData.completedTopicsCount,
            dashboardData.completedCoursesCount,
            dashboardData.totalStudySeconds,
            dashboardData.averageTopicStudySeconds,
            dashboardData.averageCourseStudySeconds,
            dashboardData.examAverageScore,
            dashboardData.understandingScore,
            dashboardData.examHistory.length,
        ].join('|');

        if (dashboardAssessmentKeyRef.current === assessmentKey) return;
        dashboardAssessmentKeyRef.current = assessmentKey;

        const generateAssessment = async () => {
            const prompt = `You are assessing a university student's learning progress using only backend-backed facts.
Student: ${userProfile.display_name}
Department: ${userProfile.department_id}
Level: ${userProfile.level}

Facts:
${dashboardData.backedFacts.join('\n')}

Recent exam performance: ${dashboardData.examHistory.length > 0 ? dashboardData.examHistory.map((exam) => `${Math.round((exam.score / exam.total_questions) * 100)}%`).join(', ') : 'No exam history yet'}

Write a concise but specific assessment based only on the facts above. Do not invent details. Return valid JSON with keys: summary, strengths, concerns, next_steps, confidence, evidence. Keep summary to 2 sentences max.`;

            if (!ai) {
                const fallbackAssessment: DashboardAssessment = {
                    summary: `AI is unavailable right now, but the dashboard shows ${dashboardData.completedTopicsCount}/${dashboardData.totalTopics} topics completed and ${dashboardData.examAverageScore}% average exam performance.`,
                    strengths: [
                        `Completed ${dashboardData.completedTopicsCount} topics`,
                        `Tracked ${formatDurationForPrompt(dashboardData.totalStudySeconds)} of study time`,
                    ],
                    concerns: ['Enable API_KEY to generate a Gemini assessment.'],
                    next_steps: ['Continue completing topics in the Study Guide.', 'Use exams to improve weak areas.'],
                    confidence: 0,
                    evidence: dashboardData.backedFacts,
                    generated_at: Date.now(),
                };
                setDashboardData(prev => prev ? { ...prev, geminiAssessment: fallbackAssessment } : prev);
                return;
            }

            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-3.5-flash',
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                summary: { type: Type.STRING },
                                strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                                concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
                                next_steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                                confidence: { type: Type.NUMBER },
                                evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
                            },
                            required: ['summary', 'strengths', 'concerns', 'next_steps', 'confidence', 'evidence'],
                        },
                    },
                });
                if (!response.text) throw new Error('Gemini returned an empty assessment.');

                const parsed = JSON.parse(response.text);
                const assessment: DashboardAssessment = {
                    summary: (parsed.summary || '').toString().trim(),
                    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map((item: any) => String(item)) : [],
                    concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map((item: any) => String(item)) : [],
                    next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.map((item: any) => String(item)) : [],
                    confidence: Math.max(0, Math.min(100, Number(parsed.confidence || 0))),
                    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map((item: any) => String(item)) : dashboardData.backedFacts,
                    generated_at: Date.now(),
                };
                setDashboardData(prev => prev ? { ...prev, geminiAssessment: assessment } : prev);
            } catch (error) {
                console.error('Failed to generate dashboard assessment:', error);
            }
        };

        void generateAssessment();
    }, [userProfile, dashboardData]);

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
            <div className="min-h-screen md:h-screen flex flex-col md:flex-row bg-gray-50 overflow-x-hidden md:overflow-hidden">
                <Sidebar
                    activeItem="admin"
                    onItemClick={setActiveItem}
                    userProfile={mockAdminProfile}
                    onLogout={() => {
                        setIsAdminAuthenticated(false);
                        setActiveItem('dashboard');
                    }}
                    isMobileSidebarOpen={isMobileSidebarOpen}
                    onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
                    items={adminNavigationItems}
                    secondaryItems={[]}
                />
                
                <main className="flex-1 flex flex-col min-w-0">
                    <Header 
                        currentPageLabel="Admin Control Panel"
                        onMenuClick={() => setIsMobileSidebarOpen(true)}
                        rightActions={
                            <div className="flex items-center gap-4">
                                <span className="text-xs font-semibold px-2 py-1 bg-lime-100 text-lime-700 rounded-full uppercase">Admin Workspace</span>
                                <button 
                                    onClick={() => {
                                        setIsAdminAuthenticated(false);
                                        setActiveItem('dashboard');
                                    }}
                                    className="text-sm font-medium text-gray-500 hover:text-gray-900"
                                >
                                    Exit Admin
                                </button>
                            </div>
                        }
                    />
                    <div className="flex-1 min-h-0 px-4 pb-20 md:pb-8 md:overflow-y-auto">
                        <ErrorBoundary>
                            <AdminPanel
                                userProfile={mockAdminProfile}
                                pathname={adminPath}
                                onNavigate={(path) => {
                                    setAdminPath(path);
                                    if (typeof window !== 'undefined') { window.history.pushState(null, '', path); }
                                }}
                            />
                        </ErrorBoundary>
                    </div>
                </main>

                <BottomNavBar
                    activeItem="admin"
                    onItemClick={setActiveItem}
                    isVisible={!isMobileSidebarOpen}
                    userProfile={mockAdminProfile}
                    items={adminNavigationItems}
                />
            </div>
        );
    }
    
    if (isLoading || isProfileLoading) {
        return <AppLoader />;
    }

    if (!user) {
        return authView === 'login' 
            ? <Login onSwitchToSignUp={() => setAuthView('signup')} /> 
            : <SignUp onSwitchToLogin={() => setAuthView('login')} />;
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
            />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                <Header 
                    currentPageLabel={currentPageLabel}
                    unreadCount={unreadCount}
                    onNotificationsClick={() => setIsNotificationsPanelOpen(true)}
                    onMenuClick={() => setIsMobileSidebarOpen(true)}
                    onMessengerClick={() => setActiveItem('messenger')}
                    unreadMessagesCount={unreadMessagesCount}
                />
                <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden content-with-bottom-nav">
                    {userProfile && (
                        <MainContent
                            key={activeItem}
                            activeItem={activeItem}
                            user={user}
                            userProfile={userProfile}
                            userProgress={userProgress}
                            dashboardData={dashboardData}
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
