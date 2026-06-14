import React, { Suspense, lazy } from 'react';
import type { FirebaseUser } from './firebase';
import type { UserProfile, UserProgress, DashboardData, AppSettings } from './types';
import ErrorBoundary from './components/ErrorBoundary';

// Lazy load large components to reduce initial bundle size and improve TTI
const Dashboard = lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })));
const StudyGuide = lazy(() => import('./components/StudyGuide').then(module => ({ default: module.StudyGuide })));
const VisualSolver = lazy(() => import('./components/VisualSolver').then(module => ({ default: module.VisualSolver })));
const Exam = lazy(() => import('./components/Exam').then(module => ({ default: module.Exam })));
const Leaderboard = lazy(() => import('./components/Leaderboard').then(module => ({ default: module.Leaderboard })));
const Settings = lazy(() => import('./components/Settings').then(module => ({ default: module.Settings })));
const Help = lazy(() => import('./components/Help'));
const Messenger = lazy(() => import('./components/Messenger').then(module => ({ default: module.Messenger })));
const AvelutAI = lazy(() => import('./components/AvelutAI'));
const AdminPanel = lazy(() => import('./components/AdminPanel').then(module => ({ default: module.AdminPanel })));

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
}

const LoadingFallback = () => (
    <div className="flex items-center justify-center h-full w-full">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
);

export const MainContent: React.FC<MainContentProps> = ({
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
}) => {
    if (!userProfile) return null;

    return (
        <Suspense fallback={<LoadingFallback />}>
            {(() => {
                switch (activeItem) {
                    case 'dashboard':
                        return <Dashboard userProfile={userProfile} dashboardData={dashboardData} />;
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
                    case 'settings':
                        return <Settings user={user} userProfile={userProfile} appSettings={appSettings} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} onDeleteAccount={handleDeleteAccount} />;
                    case 'help':
                        return <Help onStartTour={startTour} />;
                    case 'messenger':
                        return (
                            <ErrorBoundary>
                                <Messenger userProfile={userProfile} initialChatId={initialMessengerChatId} />
                            </ErrorBoundary>
                        );
                    case 'chat':
                        return (
                            <ErrorBoundary>
                                <AvelutAI userProfile={userProfile} />
                            </ErrorBoundary>
                        );
                    case 'admin':
                        return userProfile.is_admin
                            ? (
                                    <ErrorBoundary>
                                        <AdminPanel userProfile={userProfile} />
                                    </ErrorBoundary>
                                )
                            : <Dashboard userProfile={userProfile} dashboardData={dashboardData} />;
                    default:
                        return <Dashboard userProfile={userProfile} dashboardData={dashboardData} />;
                }
            })()}
        </Suspense>
    );
};
