import React, { Suspense, lazy } from 'react';
import type { FirebaseUser } from './firebase';
import type { UserProfile, UserProgress, DashboardData, AppSettings } from './types';
import ErrorBoundary from './components/ErrorBoundary';
import {
    DashboardSkeleton,
    LeaderboardSkeleton,
    NotificationsSkeleton,
    StudyPartnersSkeleton,
    PublicProfileSkeleton,
    UserProfileSkeleton,
    HistorySkeleton,
    SettingsSkeleton,
    MessengerSkeleton,
    PageSkeleton,
} from './components/Skeleton';

// Lazy load large components to reduce initial bundle size and improve TTI
const Dashboard = lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })));
const StudyGuide = lazy(() => import('./components/StudyGuide').then(module => ({ default: module.StudyGuide })));
const VisualSolver = lazy(() => import('./components/VisualSolver').then(module => ({ default: module.VisualSolver })));
const Exam = lazy(() => import('./components/Exam').then(module => ({ default: module.Exam })));
const Leaderboard = lazy(() => import('./components/Leaderboard').then(module => ({ default: module.Leaderboard })));
const Settings = lazy(() => import('./components/Settings').then(module => ({ default: module.SettingsScreen })));

const UserProfilePage = lazy(() => import('./components/UserProfile').then(module => ({ default: module.UserProfileScreen })));
const BillingSettingsPage = lazy(() => import('./components/BillingSettings').then(module => ({ default: module.BillingSettingsScreen })));
const Help = lazy(() => import('./components/Help'));
const Messenger = lazy(() => import('./components/Messenger').then(module => ({ default: module.Messenger })));
const AvelutAI = lazy(() => import('./components/AvelutAI'));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(module => ({ default: module.AdminPanel })));
const Onboarding = lazy(() => import('./components/Onboarding').then(module => ({ default: module.Onboarding })));
const History = lazy(() => import('./components/History').then(module => ({ default: module.History })));
const StudyPartners = lazy(() => import('./components/StudyPartners').then(module => ({ default: module.StudyPartners })));
const PublicProfile = lazy(() => import('./components/PublicProfile').then(module => ({ default: module.PublicProfile })));
const Notifications = lazy(() => import('./components/Notifications').then(module => ({ default: module.Notifications })));

// Per-route skeleton fallbacks — each matches the shape of its real UI
const skeletonMap: Record<string, React.ReactNode> = {
    dashboard:      <DashboardSkeleton />,
    leaderboard:    <div className="flex-1 flex flex-col w-full bg-white dark:bg-black p-4 sm:p-6 rounded-xl border border-gray-200"><LeaderboardSkeleton /></div>,
    notifications:  <div className="flex-1 w-full max-w-4xl mx-auto"><NotificationsSkeleton /></div>,
    study_partners: <StudyPartnersSkeleton />,
    user_profile:   <UserProfileSkeleton />,
    settings:       <SettingsSkeleton />,
    history:        <div className="max-w-7xl mx-auto px-4 py-8"><HistorySkeleton /></div>,
    messenger:      <MessengerSkeleton />,
};

const getSkeletonFallback = (activeItem: string): React.ReactNode => {
    if (activeItem.startsWith('public_profile_')) return <PublicProfileSkeleton />;
    return skeletonMap[activeItem] ?? <PageSkeleton />;
};

interface MainContentProps {
    activeItem: string;
    user: FirebaseUser | null;
    userProfile: UserProfile;
    appSettings: AppSettings;
    userProgress: UserProgress;
    dashboardData: DashboardData | null;
    initialMessengerChatId?: string | null;
    handleLogout: () => void;
    handleProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string; }>;
    handleDeleteAccount: () => Promise<{ success: boolean; error?: string; }>;
    startTour: () => void;
    triggerScanRef?: React.MutableRefObject<(() => void) | null>;
    onNavigate?: (tab: string) => void;
    setCustomHeaderConfig: (config: any) => void;
    handleOnboardingComplete?: (profileData: { schoolId: string; collegeId: string; departmentId: string; level: string }) => Promise<void>;
    notifications?: any[]; // Passed from App.tsx
    onMarkAsRead?: (id: string) => void;
    onMarkAllAsRead?: () => void;
}



export const MainContent = React.memo<MainContentProps>(({
    activeItem,
    user,
    userProfile,
    appSettings,
    userProgress,
    dashboardData,
    initialMessengerChatId,
    handleLogout,
    handleProfileUpdate,
    handleDeleteAccount,
    startTour,
    triggerScanRef,
    onNavigate,
    setCustomHeaderConfig,
    handleOnboardingComplete,
    notifications = [],
    onMarkAsRead,
    onMarkAllAsRead,
}) => {
    if (!userProfile) return null;

    return (
        <Suspense fallback={getSkeletonFallback(activeItem)}>
            {(() => {
                switch (activeItem) {
                    case 'onboarding':
                        return (
                            <ErrorBoundary>
                                <div className="p-4 sm:p-6 md:p-10 max-w-7xl mx-auto min-h-[calc(100vh-140px)] flex items-center justify-center">
                                    <Onboarding user={user!} onOnboardingComplete={handleOnboardingComplete!} />
                                </div>
                            </ErrorBoundary>
                        );
                    case 'dashboard':
                        return <Dashboard userProfile={userProfile} dashboardData={dashboardData} onNavigateToExams={() => onNavigate?.('exam')} onNavigateToLeaderboard={() => onNavigate?.('leaderboard')} />;
                    case 'study_guide':
                        return <StudyGuide userProfile={userProfile} userProgress={userProgress} />;
                    case 'leaderboard':
                        return <Leaderboard userProfile={userProfile} />;
                    case 'visual_solver':
                        return (
                            <ErrorBoundary>
                                <VisualSolver userProfile={userProfile} onStartChat={() => { /* No-op, handled by navigation */ }} triggerScanRef={triggerScanRef} />
                            </ErrorBoundary>
                        );
                    case 'exam':
                        return <Exam userProfile={userProfile} userProgress={userProgress} />;
                    case 'history':
                        return <History userProfile={userProfile} />;
                    case 'user_profile':
                        return <UserProfilePage user={user} userProfile={userProfile} onProfileUpdate={handleProfileUpdate} />;
                    case 'billing':
                        return <BillingSettingsPage userProfile={userProfile} appSettings={appSettings} onProfileUpdate={handleProfileUpdate} />;
                    case 'settings':
                        return <Settings user={user} userProfile={userProfile} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} onDeleteAccount={handleDeleteAccount} onNavigate={onNavigate!} />;

                    case 'help':
                        return <Help onStartTour={startTour} />;
                    case 'messenger':
                        return (
                            <ErrorBoundary>
                                <Messenger userProfile={userProfile} initialChatId={initialMessengerChatId} onNavigate={onNavigate} setCustomHeaderConfig={setCustomHeaderConfig} />
                            </ErrorBoundary>
                        );
                    case 'chat':
                        return (
                            <ErrorBoundary>
                                <AvelutAI userProfile={userProfile} onNavigate={onNavigate} setCustomHeaderConfig={setCustomHeaderConfig} />
                            </ErrorBoundary>
                        );
                    case 'admin':
                        return userProfile.is_admin
                            ? (
                                    <ErrorBoundary>
                                        <AdminPanel userProfile={userProfile} />
                                    </ErrorBoundary>
                                )
                            : <Dashboard userProfile={userProfile} dashboardData={dashboardData} onNavigateToExams={() => onNavigate?.('exam')} onNavigateToLeaderboard={() => onNavigate?.('leaderboard')} />;
                    case 'notifications':
                        return (
                            <ErrorBoundary>
                                <Notifications 
                                    notifications={notifications} 
                                    onMarkAsRead={onMarkAsRead || (() => {})} 
                                    onMarkAllAsRead={onMarkAllAsRead || (() => {})} 
                                    onNavigate={onNavigate!} 
                                />
                            </ErrorBoundary>
                        );
                    case 'study_partners':
                        return (
                            <ErrorBoundary>
                                <StudyPartners userProfile={userProfile} onNavigate={onNavigate!} />
                            </ErrorBoundary>
                        );
                    default:
                        if (activeItem.startsWith('public_profile_')) {
                            const targetUid = activeItem.replace('public_profile_', '');
                            return (
                                <ErrorBoundary>
                                    <PublicProfile targetUid={targetUid} onNavigate={onNavigate!} />
                                </ErrorBoundary>
                            );
                        }
                        return <Dashboard userProfile={userProfile} dashboardData={dashboardData} onNavigateToExams={() => onNavigate?.('exam')} onNavigateToLeaderboard={() => onNavigate?.('leaderboard')} />;
                }
            })()}
        </Suspense>
    );
});

MainContent.displayName = 'MainContent';
