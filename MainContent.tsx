import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
    const location = useLocation();

    return (
        <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard userProfile={userProfile} dashboardData={dashboardData} />} />
            <Route path="/study_guide" element={<StudyGuide userProfile={userProfile} userProgress={userProgress} />} />
            <Route path="/chat" element={<Chat userProfile={userProfile} />} />
            <Route path="/visual_solver" element={<VisualSolver userProfile={userProfile} onStartChat={() => { /* No-op, handled by navigation */ }} />} />
            <Route path="/exam" element={<Exam userProfile={userProfile} userProgress={userProgress} />} />
            <Route path="/settings" element={<Settings user={user} userProfile={userProfile} onLogout={handleLogout} onProfileUpdate={handleProfileUpdate} onDeleteAccount={handleDeleteAccount} />} />
            <Route path="/help" element={<Help onStartTour={startTour} />} />
            <Route path="/messenger" element={<Messenger userProfile={userProfile} />} />
            <Route path="/admin" element={userProfile.is_admin ? <AdminPanel userProfile={userProfile} /> : <Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
    );
};
