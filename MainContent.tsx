import React from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile, UserProgress, DashboardData } from './types';
import { Dashboard } from './components/Dashboard';
import { StudyGuide } from './components/StudyGuide';
import { Chat } from './components/Chat';
import { VisualSolver } from './components/VisualSolver';
import { Exam } from './components/Exam';
import { Settings } from './components/Settings';
import Help from './components/Help';
import { Messenger } from './components/Messenger';

interface MainContentProps {
    activeItem: string;
    user: User | null;
    userProfile: UserProfile;
    userProgress: UserProgress;
    dashboardData: DashboardData | null;
    handleLogout: () => void;
    handleProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string; }>;
    handleDeleteAccount: () => Promise<{ success: boolean; error?: string; }>;
    startTour: () => void;
    allUsers: UserProfile[];
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
    allUsers,
}) => {
    if (!userProfile) return null;

    switch (activeItem) {
        case 'dashboard':
            return <Dashboard userProfile={userProfile} dashboardData={dashboardData} />;
        case 'study_guide':
            return <StudyGuide userProfile={userProfile} userProgress={userProgress} />;
        case 'chat':
            return <Chat userProfile={userProfile} />;
        case 'visual_solver':
            return <VisualSolver userProfile={userProfile} onStartChat={() => { /* No-op, handled by parent */ }} />;
        case 'exam':
            return <Exam userProfile={userProfile} userProgress={userProgress} />;
        case 'settings':
            return <Settings user={user} userProfile={userProfile} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} onDeleteAccount={handleDeleteAccount} />;
        case 'help':
            return <Help onStartTour={startTour} />;
        case 'messenger':
            return <Messenger userProfile={userProfile} allUsers={allUsers} />;
        default:
            return <Dashboard userProfile={userProfile} dashboardData={dashboardData} />;
    }
};