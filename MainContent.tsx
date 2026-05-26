import React from 'react';
import type { FirebaseUser } from './firebase';
import type { UserProfile, UserProgress, DashboardData } from './types';
import { Dashboard } from './components/Dashboard';
import { StudyGuide } from './components/StudyGuide';
import { VisualSolver } from './components/VisualSolver';
import { Exam } from './components/Exam';
import { Leaderboard } from './components/Leaderboard';
import { Settings } from './components/Settings';
import Help from './components/Help';
import { Messenger } from './components/Messenger';
import VanTutorAssistant from './components/VanTutorAssistant';
import { AdminPanel } from './components/AdminPanel';

interface MainContentProps {
    activeItem: string;
    user: FirebaseUser | null;
    userProfile: UserProfile;
    userProgress: UserProgress;
    dashboardData: DashboardData | null;
    handleLogout: () => void;
    handleProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string; }>;
    handleDeleteAccount: () => Promise<{ success: boolean; error?: string; }>;
    startTour: () => void;
}

export const MainContent: React.FC<MainContentProps> = ({
    activeItem,
    user,
    userProfile,
    userProgress,
    dashboardData,
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
            return <VisualSolver userProfile={userProfile} onStartChat={() => { /* No-op, handled by navigation */ }} />;
        case 'exam':
            return <Exam userProfile={userProfile} userProgress={userProgress} />;
        case 'settings':
            return <Settings user={user} userProfile={userProfile} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} onDeleteAccount={handleDeleteAccount} />;
        case 'help':
            return <Help onStartTour={startTour} />;
        case 'messenger':
            return <Messenger userProfile={userProfile} />;
        case 'chat':
            return <VanTutorAssistant />;
        case 'admin':
            return userProfile.is_admin
                ? <AdminPanel userProfile={userProfile} />
                : <Dashboard userProfile={userProfile} dashboardData={dashboardData} />;
        default:
            return <Dashboard userProfile={userProfile} dashboardData={dashboardData} />;
    }
};
