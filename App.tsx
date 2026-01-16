import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { User, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { UserProfile, UserProgress, DashboardData, Notification as NotificationType, ExamHistoryItem, PrivateChat, Subject } from './types';
import { Login } from './components/Login';
import { SignUp } from './components/SignUp';
import { Onboarding } from './components/Onboarding';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { MainContent } from './MainContent';
import { NotificationsPanel } from './components/NotificationsPanel';
import { BottomNavBar } from './components/BottomNavBar';
import { useToast } from './hooks/useToast';
import { navigationItems } from './constants';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import GuidedTour, { TourStep } from './components/GuidedTour';
import { auth as firebaseAuth, firebaseSignOut } from './firebase';

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

const App: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [userProgress, setUserProgress] = useState<UserProgress>({});
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
    const [notifications, setNotifications] = useState<NotificationType[]>([]);
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [isOnboarding, setIsOnboarding] = useState(false);
    const [authView, setAuthView] = useState<'login' | 'signup'>('login');
    
    const [activeItem, setActiveItem] = useState('dashboard');
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
    const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
    const [showPrivacyModal, setShowPrivacyModal] = useState(false);
    const [isTourOpen, setIsTourOpen] = useState(false);


    const { addToast } = useToast();
    const tourStatusRef = useRef<'unknown' | 'checked' | 'shown'>('unknown');
    const presenceChannel = useRef<RealtimeChannel | null>(null);

    const startTour = useCallback(() => {
        setActiveItem('dashboard'); // Reset to a known state for the tour
        setTimeout(() => setIsTourOpen(true), 300); // Small delay to allow UI to settle
    }, []);

    useEffect(() => {
        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
          const currentUser = session?.user ?? null;
          setUser(currentUser);
          if (event === 'SIGNED_OUT') {
            setUserProfile(null);
            setActiveItem('dashboard');
            tourStatusRef.current = 'unknown';
            // Also sign out of Firebase if a user is logged in there
            if (firebaseAuth.currentUser) {
                firebaseSignOut(firebaseAuth);
            }
          }
          setIsLoading(false);
        });
    
        return () => {
          authListener.subscription.unsubscribe();
        };
    }, []);

    const handleProfileUpdate = useCallback(async (updatedData: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> => {
        if (!user) return { success: false, error: 'User not authenticated.' };
    
        try {
            const { error } = await supabase.from('users').update(updatedData).eq('uid', user.id);
            if (error) throw error;

            const userUpdatePayload: { data?: any, password?: string } = { data: {} };
            if (updatedData.display_name) userUpdatePayload.data.display_name = updatedData.display_name;
            if (updatedData.photo_url) userUpdatePayload.data.photo_url = updatedData.photo_url;

            if (Object.keys(userUpdatePayload.data).length > 0) {
                 const { error: authUserError } = await supabase.auth.updateUser(userUpdatePayload);
                 if (authUserError) console.warn("Failed to update auth user metadata:", authUserError);
            }

            setUserProfile(prevProfile => {
                if (!prevProfile) return null;
                return { ...prevProfile, ...updatedData };
            });

            return { success: true };
        } catch (err: any) {
            console.error("Error updating profile:", err.message || err);
            if (err instanceof TypeError && err.message === 'Failed to fetch') {
                return { success: false, error: "A network error occurred. Please check your connection and try again." };
            }
            return { success: false, error: err.message };
        }
    }, [user]);
    
    const handleConsent = async (granted: boolean) => {
        setShowPrivacyModal(false);
        await handleProfileUpdate({ privacy_consent: { granted, timestamp: Date.now() } });
    };

    useEffect(() => {
        if (user && userProfile && userProfile.privacy_consent === undefined) {
            setShowPrivacyModal(true);
        }
    }, [user, userProfile]);

    useEffect(() => {
        if (!user) {
            setUserProfile(null);
            setIsProfileLoading(false);
            return;
        }

        setIsProfileLoading(true);
        const userChannel = supabase
            .channel(`public:users:uid=eq.${user.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `uid=eq.${user.id}` }, payload => {
                const profileData = payload.new as UserProfile;
                if (!profileData.course_id) {
                    setIsOnboarding(true);
                } else {
                    setUserProfile(profileData);
                    setIsOnboarding(false);
                    if (tourStatusRef.current === 'unknown') {
                        if (profileData.privacy_consent?.granted && !profileData.has_completed_tour) {
                            startTour();
                            tourStatusRef.current = 'shown';
                        } else {
                            tourStatusRef.current = 'checked';
                        }
                    }
                }
            })
            .subscribe();

        const fetchUserProfile = async () => {
            const { data, error } = await supabase.from('users').select('*').eq('uid', user.id).single();
            if (error && error.code !== 'PGRST116') { // Ignore 'exact one row' error for new users
                console.error("Error fetching user profile:", (error as Error).message || error);
                addToast("Failed to load your profile.", "error");
            } else if (data) {
                if (!data.course_id) {
                    setIsOnboarding(true);
                } else {
                    setUserProfile(data as UserProfile);
                    setIsOnboarding(false);
                }
            } else {
                setIsOnboarding(true);
            }
            setIsProfileLoading(false);
        };
        fetchUserProfile();
        
        return () => {
            supabase.removeChannel(userChannel);
        };
    }, [user, addToast, startTour]);

    // Fetch all users for messenger/presence
    useEffect(() => {
        if (!userProfile) return;
        const fetchAllUsers = async () => {
            const { data, error } = await supabase.from('users').select('*').neq('uid', userProfile.uid);
            if (error) {
                console.error("Error fetching users:", error);
            } else {
                setAllUsers(data as UserProfile[]);
            }
        };
        fetchAllUsers();
    }, [userProfile]);

    // Setup Presence
    useEffect(() => {
        if (!userProfile) return;

        const channel = supabase.channel('online-users', {
            config: {
                presence: { key: userProfile.uid },
            },
        });
        presenceChannel.current = channel;

        const updateUserStatusInState = (userId: string, isOnline: boolean) => {
            setAllUsers(prevUsers =>
                prevUsers.map(u =>
                    u.uid === userId ? { ...u, is_online: isOnline, last_seen: isOnline ? undefined : Date.now() } : u
                )
            );
        };

        channel
            .on('presence', { event: 'sync' }, () => {
                const presenceState = channel.presenceState<{ user_id: string }>();
                const onlineUserIds = Object.keys(presenceState);
                setAllUsers(prevUsers =>
                    prevUsers.map(u => ({ ...u, is_online: onlineUserIds.includes(u.uid) }))
                );
            })
            .on('presence', { event: 'join' }, ({ key }) => {
                updateUserStatusInState(key, true);
            })
            .on('presence', { event: 'leave' }, ({ key }) => {
                updateUserStatusInState(key, false);
            });
        
        const setOnline = async () => {
             // Supabase presence track
            await channel.track({ user_id: userProfile.uid });
            // Update our user table
            await supabase.from('users').update({ is_online: true, last_seen: Date.now() }).eq('uid', userProfile.uid);
        };
        
        const setOffline = () => {
            if (!presenceChannel.current) return;
            // Use fire-and-forget here because this can be called during page unload.
            supabase.from('users').update({ is_online: false, last_seen: Date.now() }).eq('uid', userProfile.uid).then(() => {});
            presenceChannel.current.untrack();
        };
        
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                setOnline();
            } else {
                setOffline();
            }
        };

        channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await setOnline();
            }
        });
        
        window.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('visibilitychange', handleVisibilityChange);
            if (presenceChannel.current) {
                setOffline();
                supabase.removeChannel(presenceChannel.current);
                presenceChannel.current = null;
            }
        };
    }, [userProfile]);
    
    useEffect(() => {
        if (!userProfile) return;

        const progressChannel = supabase
            .channel(`public:user_progress:user_id=eq.${userProfile.uid}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'user_progress', filter: `user_id=eq.${userProfile.uid}`}, payload => {
                 if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
                    const newItem = payload.new as { topic_id: string; is_complete: boolean };
                    setUserProgress(prev => ({
                        ...prev,
                        [newItem.topic_id]: { is_complete: newItem.is_complete }
                    }));
                } else if (payload.eventType === 'DELETE') {
                    const oldItem = payload.old as { topic_id: string };
                    setUserProgress(prev => {
                        const newState = { ...prev };
                        if (oldItem.topic_id) { // Ensure topic_id exists before deleting
                            delete newState[oldItem.topic_id];
                        }
                        return newState;
                    });
                }
            })
            .subscribe();

        const fetchInitialProgress = async () => {
            const { data, error } = await supabase.from('user_progress').select('*').eq('user_id', userProfile.uid);
            if (error) {
                console.error("Error fetching progress:", (error as Error).message || error);
            } else if (data) {
                const progressData: UserProgress = {};
                data.forEach(item => {
                    progressData[item.topic_id] = { is_complete: item.is_complete };
                });
                setUserProgress(progressData);
            }
        };
        fetchInitialProgress();

        return () => {
            supabase.removeChannel(progressChannel);
        };

    }, [userProfile]);

    useEffect(() => {
        if (!userProfile) {
            setUnreadMessagesCount(0);
            return;
        };
        
        const setupDashboardData = async () => {
            try {
                const { data: courseData, error: courseError } = await supabase.from('courses_data').select('subject_list').eq('id', userProfile.course_id).single();
                if(courseError) throw courseError;

                const subjectsForLevel = (courseData.subject_list || []).filter((subject: Subject) => subject.level === userProfile.level);
                
                const totalTopics = subjectsForLevel.reduce((acc: number, subject: Subject) => acc + (subject.topics?.length || 0), 0) || 0;

                const topicIdsForLevel = new Set<string>();
                subjectsForLevel.forEach(subject => {
                    subject.topics?.forEach(topic => {
                        topicIdsForLevel.add(topic.topic_id);
                    });
                });

                const completedTopicsCount = Object.keys(userProgress)
                    .filter(topicId => userProgress[topicId].is_complete && topicIdsForLevel.has(topicId))
                    .length;
                
                const { data: examHistory, error: examError } = await supabase.from('exam_history').select('*').eq('user_id', userProfile.uid).order('timestamp', { ascending: false }).limit(5);
                if(examError) throw examError;

                setDashboardData({ 
                    totalTopics, 
                    completedTopicsCount, 
                    examHistory: examHistory as ExamHistoryItem[]
                });

            } catch (error) {
                console.error("Error setting up dashboard data:", (error as Error).message || error);
            }
        };

        setupDashboardData();
        
        const notificationsChannel = supabase
            .channel(`public:notifications:user_id=eq.${userProfile.uid}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userProfile.uid}` }, payload => {
                const newNotification = {
                    ...payload.new,
                    timestamp: new Date(payload.new.timestamp as string).getTime(),
                } as NotificationType;
                setNotifications(prev => [newNotification, ...prev].sort((a,b) => b.timestamp - a.timestamp));
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userProfile.uid}` }, payload => {
                 setNotifications(prev => prev.filter(n => n.id !== (payload.old as NotificationType).id));
            })
            .subscribe();
        
        const chatsChannel = supabase
            .channel(`public:private_chats:members=cs.{"${userProfile.uid}"}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'private_chats', filter: `members=cs.{"${userProfile.uid}"}` }, async () => {
                   const { count } = await supabase.from('private_chats').select('*', { count: 'exact', head: true }).contains('members', [userProfile.uid]).not('last_message->read_by', 'cs', `{${userProfile.uid}}`);
                   setUnreadMessagesCount(count || 0);
            })
            .subscribe();

        const examHistoryChannel = supabase
            .channel(`public:exam_history:user_id=eq.${userProfile.uid}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exam_history', filter: `user_id=eq.${userProfile.uid}` }, payload => {
                const newExam = payload.new as ExamHistoryItem;
                setDashboardData(prev => {
                    if (!prev) return null;
                    const updatedHistory = [newExam, ...prev.examHistory]
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 5);
                    return { ...prev, examHistory: updatedHistory };
                });
            })
            .subscribe();

        const fetchInitialData = async () => {
            const { count } = await supabase.from('private_chats').select('*', { count: 'exact', head: true }).contains('members', [userProfile.uid]).not('last_message->read_by', 'cs', `{${userProfile.uid}}`);
            setUnreadMessagesCount(count || 0);
            
            const { data: initialNotifs, error: notifError } = await supabase.from('notifications').select('*').eq('user_id', userProfile.uid).order('timestamp', { ascending: false }).limit(20);
            if(initialNotifs) {
                const formattedNotifications = initialNotifs.map(n => ({
                    ...n,
                    timestamp: new Date(n.timestamp).getTime()
                })) as NotificationType[];
                setNotifications(formattedNotifications);
            }
        };

        fetchInitialData();
        
        return () => {
            supabase.removeChannel(notificationsChannel);
            supabase.removeChannel(chatsChannel);
            supabase.removeChannel(examHistoryChannel);
        }
    }, [userProfile, userProgress]);


    const handleLogout = async () => {
        try {
            if (firebaseAuth.currentUser) {
                await firebaseSignOut(firebaseAuth);
            }
            await supabase.auth.signOut();
        } catch (error: any) {
            console.error("Logout failed:", error.message || error);
            addToast(error.message || "Failed to log out.", "error");
        }
    };
    
    const handleOnboardingComplete = async (profileData: { courseId: string; level: string }) => {
        if (!user) return;
        const now = Date.now();
        const displayName = user.user_metadata.display_name || user.user_metadata.full_name || user.user_metadata.name || 'Learner';
        const photoURL = user.user_metadata.photo_url || user.user_metadata.avatar_url || '';
        
        const userProfileData: Omit<UserProfile, 'privacy_consent'> = {
            uid: user.id,
            display_name: displayName,
            photo_url: photoURL,
            course_id: profileData.courseId,
            level: profileData.level,
            current_streak: 0,
            last_activity_date: now,
            notifications_enabled: false,
            is_online: true,
            last_seen: now,
            has_completed_tour: false,
        };

        try {
            const { error: profileError } = await supabase.from('users').upsert(userProfileData);
            if (profileError) throw profileError;
            
            const notificationData = {
                user_id: user.id,
                type: 'welcome' as const,
                title: 'Welcome to VANTUTOR!',
                message: 'Your learning journey starts now. Explore the study guide to begin.',
                is_read: false,
            };
            const { error: notifError } = await supabase.from('notifications').insert(notificationData);
            if(notifError) throw notifError;
            
            setUserProfile(prev => ({...prev, ...userProfileData } as UserProfile));
            setIsOnboarding(false);
        } catch (error: any) {
            console.error("Failed to complete onboarding:", error.message || error);
            addToast(error.message || "Could not save your profile.", "error");
        }
    };

    const handleMarkNotificationRead = async (id: string) => {
        if (!user) return;
    
        const notificationToDelete = notifications.find(n => n.id === id);
        if (!notificationToDelete) return;
    
        setNotifications(prev => prev.filter(n => n.id !== id));
    
        const { error } = await supabase.from('notifications').delete().eq('id', id);
        if (error) {
            console.error("Error deleting notification:", (error as Error).message || error);
            addToast("Could not clear notification.", "error");
            setNotifications(prev => [...prev, notificationToDelete].sort((a, b) => b.timestamp - a.timestamp));
        }
    };

    const handleMarkAllNotificationsRead = async () => {
        if (!user) return;
        
        const unreadNotifications = notifications.filter(n => !n.is_read);
        const unreadIds = unreadNotifications.map(n => n.id);
        if (unreadIds.length === 0) return;
    
        const unreadIdsSet = new Set(unreadIds);
        setNotifications(prev => prev.filter(n => !unreadIdsSet.has(n.id)));
    
        const { error } = await supabase.from('notifications').delete().in('id', unreadIds);
        if (error) {
            console.error("Error clearing notifications:", (error as Error).message || error);
            addToast("Could not clear notifications.", "error");
            setNotifications(prev => [...prev, ...unreadNotifications].sort((a, b) => b.timestamp - a.timestamp));
        } else {
            addToast(`${unreadIds.length} notification${unreadIds.length > 1 ? 's' : ''} cleared.`, 'success');
        }
    };

    const handleAccountDeletion = async (): Promise<{ success: boolean; error?: string }> => {
        try {
            const { error } = await supabase.functions.invoke('delete-user');
            if (error) throw error;
            addToast('Your account has been successfully deleted.', 'success');
            return { success: true };
        } catch (error: any) {
            console.error("Error deleting account:", error.message || error);
            if (error.context?.msg === 'User not found' || error.message.includes('401')) {
                return { success: false, error: 'This is a sensitive operation. Please log out and log back in before trying again.' };
            }
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
    const currentPageLabel = activeItem === 'messenger' 
        ? 'Messenger' 
        : (navigationItems.find(item => item.id === activeItem)?.label || 'Dashboard');

    return (
        <div className="h-full flex flex-col md:flex-row bg-gray-100 p-2 md:p-4 gap-4">
            <Sidebar
                activeItem={activeItem}
                onItemClick={setActiveItem}
                userProfile={userProfile}
                onLogout={handleLogout}
                isMobileSidebarOpen={isMobileSidebarOpen}
                onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
            />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
                            activeItem={activeItem}
                            user={user}
                            userProfile={userProfile}
                            userProgress={userProgress}
                            dashboardData={dashboardData}
                            handleLogout={handleLogout}
                            handleProfileUpdate={handleProfileUpdate}
                            handleDeleteAccount={handleAccountDeletion}
                            startTour={startTour}
                            allUsers={allUsers}
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