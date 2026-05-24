import React from 'react';
import type { FirebaseUser } from './firebase';
import type { UserProfile, UserProgress, DashboardData } from './types';
import { Dashboard } from './components/Dashboard';
import { StudyGuide } from './components/StudyGuide';
import { Chat } from './components/Chat';
import { VisualSolver } from './components/VisualSolver';
import { Exam } from './components/Exam';
import { Settings } from './components/Settings';
import Help from './components/Help';
import { Messenger } from './components/Messenger';
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

    if (activeItem === 'study_guide') {
        return <StudyGuide userProfile={userProfile} userProgress={userProgress} />;
    }
    if (activeItem === 'chat') {
        return <Chat userProfile={userProfile} />;
    }
    if (activeItem === 'visual_solver') {
        return <VisualSolver userProfile={userProfile} onStartChat={() => { /* No-op, handled by navigation */ }} />;
    }
    if (activeItem === 'exam') {
        return <Exam userProfile={userProfile} userProgress={userProgress} />;
    }
    if (activeItem === 'settings') {
        return <Settings user={user} userProfile={userProfile} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} onDeleteAccount={handleDeleteAccount} />;
    }
    if (activeItem === 'help') {
        return <Help onStartTour={startTour} />;
    }
    if (activeItem === 'messenger') {
        return <Messenger userProfile={userProfile} />;
    }
    if (activeItem === 'admin' && userProfile.is_admin) {
        return <AdminPanel userProfile={userProfile} />;
    }
    return <Dashboard userProfile={userProfile} dashboardData={dashboardData} />;
};
