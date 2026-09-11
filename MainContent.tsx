import { FirebaseUser } from '@/lib/backend';
import React, { Suspense, lazy } from 'react';
import { writeCachedJson } from './utils/cache';
import type { UserProfile, UserProgress, DashboardData, AppSettings, ChatConversation } from './types';
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

const StudyGuide = lazy(() => import('./components/StudyGuide').then(module => ({ default: module.StudyGuide })));
const MyNotebooks = lazy(() => import('./components/MyNotebooks').then(module => ({ default: module.MyNotebooks })));
const Playground = lazy(() => import('./components/Playground').then(module => ({ default: module.Playground })));
const VisualSolver = lazy(() => import('./components/VisualSolver').then(module => ({ default: module.VisualSolver })));
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
const Feedback = lazy(() => import('./components/Feedback').then(module => ({ default: module.Feedback })));
const VoiceTutorialPage = lazy(() => import('./components/VoiceTutorialPage').then(module => ({ default: module.default || module.VoiceTutorialPage })));

const skeletonMap: Record<string, React.ReactNode> = {
    dashboard:      <DashboardSkeleton />,
    leaderboard:    <div className="flex-1 flex flex-col w-full bg-white p-4 sm:p-6 rounded-xl border border-neutral-200"><LeaderboardSkeleton /></div>,
    notifications:  <div className="flex-1 w-full max-w-4xl mx-auto"><NotificationsSkeleton /></div>,
    study_partners: <StudyPartnersSkeleton />,
    user_profile:   <UserProfileSkeleton />,
    settings:       <SettingsSkeleton />,
    history:        <div className="max-w-7xl mx-auto px-4 py-8"><HistorySkeleton /></div>,
    messenger:      <MessengerSkeleton />,
    feedback:       <PageSkeleton />,
    voice_tutorial: <PageSkeleton />,
    playground:     <PageSkeleton />,
    notebooks:      <PageSkeleton />,
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
    unreadMessagesCount?: number;
    handleLogout: () => void;
    handleProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string; }>;
    handleDeleteAccount: () => Promise<{ success: boolean; error?: string; }>;
    startTour: () => void;
    triggerScanRef?: React.MutableRefObject<(() => void) | null>;
    onNavigate?: (tab: string) => void;
    setCustomHeaderConfig: (config: any) => void;
    handleOnboardingComplete?: (profileData: { schoolId: string; collegeId: string; departmentId: string; level: string }) => Promise<void>;
    notifications?: any[];
    onMarkAsRead?: (id: string) => void;
    onMarkAllAsRead?: () => void;
    onConversationsUpdate?: (conversations: ChatConversation[]) => void;
    onOpenMenu?: () => void;
    activeConversationId?: string | null;
    onSelectConversation?: (id: string | null) => void;
}

export const MainContent: React.FC<MainContentProps> = ({
    activeItem,
    user,
    userProfile,
    appSettings,
    userProgress,
    dashboardData,
    initialMessengerChatId,
    unreadMessagesCount = 0,
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
    onConversationsUpdate,
    onOpenMenu,
    activeConversationId,
    onSelectConversation,
}) => {
    if (!userProfile) return null;

    return (
        <Suspense fallback={getSkeletonFallback(activeItem)}>
            {(() => {
                switch (activeItem) {
                    case 'onboarding':
                        return (
                            <div className="p-4 sm:p-6 md:p-10 max-w-7xl mx-auto min-h-[calc(100vh-140px)] flex items-center justify-center">
                                <Onboarding user={user!} onOnboardingComplete={handleOnboardingComplete!} />
                            </div>
                        );
                    case 'dashboard':
                        // Fallthrough redirect
                    case 'chat':
                        return (
                            <AvelutAI
                                userProfile={userProfile}
                                onNavigate={onNavigate}
                                setCustomHeaderConfig={setCustomHeaderConfig}
                                unreadMessagesCount={unreadMessagesCount}
                                onConversationsUpdate={onConversationsUpdate}
                                onOpenMenu={onOpenMenu}
                                activeConversationId={activeConversationId}
                                onSelectConversation={onSelectConversation}
                            />
                        );
                    case 'notebooks':
                        return (
                            <MyNotebooks
                                userProfile={userProfile}
                                onNavigate={onNavigate}
                                setCustomHeaderConfig={setCustomHeaderConfig}
                            />
                        );
                    case 'study_guide':
                        return <StudyGuide userProfile={userProfile} userProgress={userProgress} onNavigate={onNavigate} setCustomHeaderConfig={setCustomHeaderConfig} />;
                    case 'playground':
                        return (
                            <Playground
                                userProfile={userProfile}
                                appSettings={appSettings}
                                onNavigate={onNavigate}
                                setCustomHeaderConfig={setCustomHeaderConfig}
                            />
                        );
                    case 'voice_tutorial':
                        return <VoiceTutorialPage userProfile={userProfile} appSettings={appSettings} onNavigate={onNavigate} setCustomHeaderConfig={setCustomHeaderConfig} />;
                    case 'leaderboard':
                        return <Leaderboard userProfile={userProfile} />;
                    case 'visual_solver':
                        return (
                            <VisualSolver
                                userProfile={userProfile}
                                onStartChat={(payload) => {
                                    if (typeof payload === 'object' && payload !== null) {
                                        writeCachedJson('avelut_active_voice_tutorial', payload);
                                    }
                                    onNavigate?.('study_guide');
                                }}
                                triggerScanRef={triggerScanRef}
                            />
                        );
                    case 'history':
                        return <History userProfile={userProfile} />;
                    case 'user_profile':
                        return <UserProfilePage user={user} userProfile={userProfile} onProfileUpdate={handleProfileUpdate} />;
                    case 'billing':
                        return <BillingSettingsPage userProfile={userProfile} appSettings={appSettings} onProfileUpdate={handleProfileUpdate} />;
                    case 'settings':
                        return (
                            <Settings
                                user={user}
                                userProfile={userProfile}
                                onLogout={handleLogout}
                                onProfileUpdate={handleProfileUpdate}
                                onDeleteAccount={handleDeleteAccount}
                                onNavigate={onNavigate!}
                            />
                        );
                    case 'help':
                        return <Help onStartTour={startTour} />;
                    case 'feedback':
                        return <Feedback userProfile={userProfile} />;
                    case 'messenger':
                        return (
                            <Messenger
                                userProfile={userProfile}
                                initialChatId={initialMessengerChatId}
                                onNavigate={onNavigate}
                                setCustomHeaderConfig={setCustomHeaderConfig}
                            />
                        );
                    case 'admin':
                        return userProfile.is_admin
                            ? <AdminPanel userProfile={userProfile} />
                            : <AvelutAI
                                userProfile={userProfile}
                                onNavigate={onNavigate}
                                setCustomHeaderConfig={setCustomHeaderConfig}
                                unreadMessagesCount={unreadMessagesCount}
                                onConversationsUpdate={onConversationsUpdate}
                                onOpenMenu={onOpenMenu}
                            />;
                    case 'notifications':
                        return (
                            <Notifications
                                notifications={notifications}
                                onMarkAsRead={onMarkAsRead || (() => {})}
                                onMarkAllAsRead={onMarkAllAsRead || (() => {})}
                                onNavigate={onNavigate!}
                            />
                        );
                    case 'study_partners':
                        return <StudyPartners userProfile={userProfile} onNavigate={onNavigate!} />;
                    default:
                        if (activeItem.startsWith('public_profile_')) {
                            const targetUid = activeItem.replace('public_profile_', '');
                            return <PublicProfile targetUid={targetUid} onNavigate={onNavigate!} />;
                        }
                        return <AvelutAI
                            userProfile={userProfile}
                            onNavigate={onNavigate}
                            setCustomHeaderConfig={setCustomHeaderConfig}
                            unreadMessagesCount={unreadMessagesCount}
                            onConversationsUpdate={onConversationsUpdate}
                            onOpenMenu={onOpenMenu}
                            activeConversationId={activeConversationId}
                            onSelectConversation={onSelectConversation}
                        />;
                }
            })()}
        </Suspense>
    );
};
