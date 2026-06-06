import React from 'react';
import type { FirebaseUser } from './firebase';
import type { UserProfile, UserProgress, DashboardData, AppSettings } from './types';
import { Dashboard } from './components/Dashboard';
import { StudyGuide } from './components/StudyGuide';
import { VisualSolver } from './components/VisualSolver';
import { Exam } from './components/Exam';
import { Leaderboard } from './components/Leaderboard';
import { Settings } from './components/Settings';
import Help from './components/Help';
import { Messenger } from './components/Messenger';
import AvelutAI from './components/AvelutAI';
import { AdminPanel } from './components/AdminPanel';
import ErrorBoundary from './components/ErrorBoundary';

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
}

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
}) => {
    if (!userProfile) return null;

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
                    <VisualSolver userProfile={userProfile} onStartChat={() => { /* No-op, handled by navigation */ }} />
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
};
