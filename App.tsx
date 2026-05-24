import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth as firebaseAuth, firebaseSignOut, db, onAuthStateChanged, updateProfile, type FirebaseUser } from './firebase';
import { ref as dbRef, onValue, off, set, push, update, onDisconnect, serverTimestamp, get } from 'firebase/database';
import type { UserProfile, UserProgress, DashboardData, Notification as NotificationType, ExamHistoryItem, Course } from './types';
import { Login } from './components/Login';
import { SignUp } from './components/SignUp';
import { AdminLogin } from './components/AdminLogin';
import { Onboarding } from './components/Onboarding';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MainContent } from './MainContent';
import { NotificationsPanel } from './components/NotificationsPanel';
import { BottomNavBar } from './components/BottomNavBar';
import { useToast } from './hooks/useToast';
import { navigationItems, adminNavigationItems } from './constants';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import GuidedTour, { TourStep } from './components/GuidedTour';

declare var __app_id: string;

const AppLoader: React.FC = () => {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100" role="status" aria-label="Loading application">
      <svg className="w-24 h-24 loader-logo" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path className="loader-path-1" d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path className="loader-path-2" d="M41.5 21V29.75C41.5 30.825 40.85 32.55 39.4166 33.25L27.75 39.375C26.6666 39.9 25.3333 39.9 24.25 39.375L12.5833 33.25C11.15 32.55 10.5 30.825 10.5 29.75V21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path className="loader-path-3" d="M47.6667 17.5V26.25" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
};

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
    if (!rawSegment) return 'dashboard';
    let decodedSegment = rawSegment;
    try {
        decodedSegment = decodeURIComponent(rawSegment);
    } catch (error) {
        console.warn('Invalid route segment encoding:', rawSegment, error);
        return 'dashboard';
    }
    const normalizedSegment = normalizeRouteSegment(decodedSegment);
    return ALLOWED_ROUTE_ITEMS.has(normalizedSegment) ? normalizedSegment : 'dashboard';
};

const App: React.FC = () => {
    const [user, setUser] = useState<FirebaseUser | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [userProgress, setUserProgress] = useState<UserProgress>({});
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
    const [notifications, setNotifications] = useState<NotificationType[]>([]);
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    
    const location = useLocation();
    const navigate = useNavigate();

    const [isLoading, setIsLoading] = useState(true);
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [isOnboarding, setIsOnboarding] = useState(false);
    const [authView, setAuthView] = useState<'login' | 'signup'>('login');
    
    // Derived state from URL or internal state for PWA feel
    const [activeItem, setActiveItemState] = useState<string>(() => {
        const item = resolveActiveItemFromPath(location.pathname);
        return item === 'admin' ? 'admin' : item;
    });
    
    const setActiveItem = (item: string) => {
        setActiveItemState(item);
        if (item === 'admin') {
            navigate('/admin');
        } else if (location.pathname === '/admin') {
            navigate('/');
        }
    };

    // Sync state with URL only for admin or to reset to root
    useEffect(() => {
        const item = resolveActiveItemFromPath(location.pathname);
        if (item === 'admin') {
            setActiveItemState('admin');
        } else if (location.pathname !== '/' && location.pathname !== '/dashboard') {
            // For PWA feel, we redirect any non-admin paths back to root but keep the item state
            navigate('/', { replace: true });
            setActiveItemState(item);
        }
    }, [location.pathname]);

    const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

    // Breadcrumbs logic based on activeItem
    const currentPageLabel = activeItem === 'messenger' 
        ? 'Messenger' 
        : (navigationItems.find(item => item.id === activeItem)?.label || 'Dashboard');

    const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
    const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [isTourOpen, setIsTourOpen] = useState(false);


    const { addToast } = useToast();
    const tourStatusRef = useRef<'unknown' | 'checked' | 'shown'>('unknown');
    const presenceRef = useRef<any>(null);

    const startTour = useCallback(() => {
        setActiveItem('dashboard'); // Reset to a known state for the tour
        setTimeout(() => setIsTourOpen(true), 300); // Small delay to allow UI to settle
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
        
        return () => {
            off(userRef, 'value', unsubscribeProfile);
        };
    }, [user, addToast, startTour]);

    // Fetch all users for messenger/presence
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

    // Setup Presence
    useEffect(() => {
        if (!userProfile || !user) return;

        const userStatusRef = dbRef(db, `users/${user.uid}`);
        const connectedRef = dbRef(db, '.info/connected');

        const unsubscribeConnected = onValue(connectedRef, (snap) => {
            if (snap.val() === true) {
                // When I disconnect, update the last seen time
                onDisconnect(userStatusRef).update({
                    is_online: false,
                    last_seen: serverTimestamp()
                });

                // Set online status
                update(userStatusRef, {
                    is_online: true,
                    last_seen: serverTimestamp()
                });
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

        return () => {
            off(progressRef, 'value', unsubscribeProgress);
        };

    }, [userProfile]);

    useEffect(() => {
        if (!userProfile) {
            setUnreadMessagesCount(0);
            return;
        };
        
        const setupDashboardData = async () => {
            try {
                const departmentSnapshot = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
                const departmentData = departmentSnapshot.val();
                if (!departmentData) return;

                const coursesForLevel = (departmentData.course_list || []).filter((course: Course) => course.level === userProfile.level);
                
                const totalTopics = coursesForLevel.reduce((acc: number, course: Course) => acc + (course.topics?.length || 0), 0) || 0;

                const topicIdsForLevel = new Set<string>();
                coursesForLevel.forEach(course => {
                    course.topics?.forEach(topic => {
                        topicIdsForLevel.add(topic.topic_id);
                    });
                });

                const completedTopicsCount = Object.keys(userProgress)
                    .filter(topicId => userProgress[topicId].is_complete && topicIdsForLevel.has(topicId))
                    .length;
                
                const examHistoryRef = dbRef(db, `exam_history/${userProfile.uid}`);
                const examSnapshot = await get(examHistoryRef);
                const examData = examSnapshot.val() || {};
                const examHistory = Object.values(examData).sort((a: any, b: any) => b.timestamp - a.timestamp).slice(0, 5) as ExamHistoryItem[];

                setDashboardData({ 
                    totalTopics, 
                    completedTopicsCount, 
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
                id,
                ...n,
                timestamp: n.timestamp
            })).sort((a,b) => b.timestamp - a.timestamp);
            setNotifications(notificationList.slice(0, 20));
        });
        
        const userChatsRef = dbRef(db, `user_chats/${userProfile.uid}`);
        const unsubscribeUnreadCount = onValue(userChatsRef, (snapshot) => {
            const data = snapshot.val() || {};
            let totalUnread = 0;
            Object.values(data).forEach((chat: any) => {
                totalUnread += (chat.unreadCount || 0);
            });
            setUnreadMessagesCount(totalUnread);
        });

        const examHistoryRef = dbRef(db, `exam_history/${userProfile.uid}`);
        const unsubscribeExamHistory = onValue(examHistoryRef, (snapshot) => {
            const data = snapshot.val() || {};
            const examHistory = Object.values(data).sort((a: any, b: any) => b.timestamp - a.timestamp).slice(0, 5) as ExamHistoryItem[];
            setDashboardData(prev => {
                if (!prev) return null;
                return { ...prev, examHistory };
            });
        });

        return () => {
            off(notificationsRef, 'value', unsubscribeNotifications);
            off(userChatsRef, 'value', unsubscribeUnreadCount);
            off(examHistoryRef, 'value', unsubscribeExamHistory);
        }
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
                if (!data[id].is_read) {
                    updates[`${id}/is_read`] = true;
                }
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
        // Firebase account deletion is complex on client side (requires recent login)
        // For simplicity in this migration, we'll just sign out and mark profile as deleted
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
            return { success: false, error: error.message || 'An error occurred while deleting your account. This may require a recent login.' };
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
    
    const isMobile = window.innerWidth < 768;

    const tourSteps: TourStep[] = [
      {
        target: 'body',
        title: '👋 Welcome to VANTUTOR!',
        content: "Let's take a quick tour of your new learning dashboard.",
        placement: 'center',
      },
      {
        target: '[data-tour-id="dashboard-content"]',
        title: '📊 Your Dashboard',
        content: 'View your progress, streaks, and personalized lessons.',
        placement: 'bottom',
      },
      {
        target: isMobile ? '[data-tour-id="bottomnav-study_guide"]' : '[data-tour-id="sidebar-study_guide"]',
        title: '📚 Study Guide',
        content: 'Explore tutorials and start new lessons anytime.',
        placement: isMobile ? 'top' : 'right',
      },
      {
        target: isMobile ? '[data-tour-id="bottomnav-chat"]' : '[data-tour-id="sidebar-chat"]',
        title: '💬 AI Tutor Chat',
        content: 'Chat with your AI tutor and ask any questions.',
        placement: isMobile ? 'top' : 'right',
      },
      {
        target: isMobile ? '[data-tour-id="bottomnav-visual_solver"]' : '[data-tour-id="sidebar-visual_solver"]',
        title: '📸 Visual Solver',
        content: 'Scan any problem and get instant or detailed tutorials.',
        placement: isMobile ? 'top' : 'right',
      },
      {
        target: isMobile ? '[data-tour-id="bottomnav-messenger"]' : '[data-tour-id="header-messenger"]',
        title: '🤝 Messenger',
        content: 'Connect with other learners and chat privately.',
        placement: isMobile ? 'top' : 'bottom',
      },
      ...(isMobile ? [{
        target: '[data-tour-id="mobile-menu-button"]',
        title: '⚙️ Main Menu',
        content: 'Access your settings, help, and logout options from here.',
        placement: 'bottom' as const,
      }] : [{
        target: '[data-tour-id="sidebar-settings"]',
        title: '⚙️ Settings',
        content: 'Update your info and view your achievements.',
        placement: 'top' as const,
      }]),
      {
        target: 'body',
        title: "🎉 You're all set!",
        content: 'Enjoy exploring your learning journey. Tap "Finish" to start!',
        placement: 'center',
      },
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
            <div className="h-full flex flex-col md:flex-row bg-gray-50 overflow-hidden">
                {/* Admin-specific Sidebar */}
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
                    secondaryItems={[]} // Less secondary items for admin
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
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-20 md:pb-8">
                        <AdminPanel userProfile={mockAdminProfile} />
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
    
    if (!userProfile) { // Should be covered by loading, but as a fallback
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <p>An error occurred loading your profile. Please refresh.</p>
            </div>
        );
    }

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <div className="h-screen flex flex-col md:flex-row bg-off-white text-charcoal font-sans overflow-hidden">
            <Sidebar
                activeItem={activeItem}
                onItemClick={setActiveItem}
                userProfile={userProfile}
                onLogout={handleLogout}
                isMobileSidebarOpen={isMobileSidebarOpen}
                onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
            />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {activeItem !== 'chat' && (
                    <Header 
                        currentPageLabel={currentPageLabel}
                        unreadCount={unreadCount}
                        onNotificationsClick={() => setIsNotificationsPanelOpen(true)}
                        onMenuClick={() => setIsMobileSidebarOpen(true)}
                        onMessengerClick={() => setActiveItem('messenger')}
                        unreadMessagesCount={unreadMessagesCount}
                    />
                )}
                <div className={`flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${activeItem !== 'chat' ? 'content-with-bottom-nav' : ''}`}>
                    {userProfile && (
                        <MainContent
                            key={location.pathname}
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