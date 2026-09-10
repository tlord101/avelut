import React from 'react';
import type { UserProfile, DashboardData } from '../types';
import { StudyGuideIcon } from './icons/StudyGuideIcon';
import { LeaderboardIcon } from './icons/LeaderboardIcon';
import { ProgressSummarySkeleton } from './Skeleton';

// Icons for Stat Cards
const LevelIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
);

const StreakIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7.014A8.003 8.003 0 0122 12c0 3.314-2.01 6.014-4.657 7.143a8.003 8.003 0 01-1.686 .514z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
    </svg>
);

interface DashboardProps {
    userProfile: UserProfile;
    dashboardData: DashboardData | null;
    onNavigateToStudyGuide?: () => void;
    onNavigateToLeaderboard?: () => void;
}

const StatCard: React.FC<{ title: string; value: string | number; description: string; icon: React.ReactNode; color: 'lime' | 'blue' | 'purple' | 'amber' | 'rose' }> = ({ title, value, description, icon, color }) => {
    const colorClasses = {
        lime: 'text-emerald-600',
        blue: 'text-blue-600',
        purple: 'text-purple-600',
        amber: 'text-amber-600',
        rose: 'text-rose-600'
    };

    return (
        <div className="group relative overflow-hidden rounded-3xl border border-gray-200 dark:border-transparent bg-white dark:bg-[#0A0A0A] p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-gray-300 dark:hover:border-transparent hover:shadow-lg">
                <div className="flex items-start justify-between gap-4">
                        <div className="rounded-2xl border border-gray-100 dark:border-transparent bg-gray-50 dark:bg-[#0A0A0A] p-3 text-gray-500 dark:text-gray-400">
                                {icon}
                        </div>
                        <div className="text-right">
                                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-gray-400 leading-none mb-1">{title}</p>
                                <p className={`text-3xl font-black leading-tight ${colorClasses[color]}`}>{value}</p>
                        </div>
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{description}</p>
        </div>
    );
};

export const Dashboard: React.FC<DashboardProps> = ({ userProfile, dashboardData, onNavigateToStudyGuide, onNavigateToLeaderboard }) => {
  
  const completedTopicsCount = dashboardData?.completedTopicsCount ?? 0;
  const totalTopics = dashboardData?.totalTopics || 0;
    const completedCoursesCount = dashboardData?.completedCoursesCount ?? 0;
    const totalStudySeconds = dashboardData?.totalStudySeconds ?? 0;
    const averageTopicStudySeconds = dashboardData?.averageTopicStudySeconds ?? 0;
    const averageCourseStudySeconds = dashboardData?.averageCourseStudySeconds ?? 0;
        const examAverageScore = dashboardData?.examAverageScore ?? 0;
  const progressPercent = totalTopics > 0 ? Math.round((completedTopicsCount / totalTopics) * 100) : 0;
  
    const formatDuration = (seconds: number) => {
        if (!seconds || seconds <= 0) return '0m';
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        return `${hours}h ${remMins}m`;
    };

        const examAverageLabel = dashboardData?.examHistory && dashboardData.examHistory.length > 0 ? `${examAverageScore}%` : 'No exams yet';

    return (
        <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 md:p-10" data-tour-id="dashboard-content">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between font-sans">
                <div>
                    <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">User Dashboard</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900 dark:text-white md:text-5xl">
                        Welcome back, {(userProfile.display_name || 'User').split(' ')[0]}.
                    </h1>
                    <p className="mt-2 text-base font-normal text-gray-500 dark:text-gray-400">
                        Track your progress.
                    </p>
                </div>
                <div className="rounded-full border border-gray-200 dark:border-transparent bg-white dark:bg-black px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-gray-700 shadow-sm flex items-center gap-2">
                    Daily Streak: <span className="text-blue-600 dark:text-blue-400 font-bold">{userProfile.current_streak} {userProfile.current_streak === 1 ? 'day' : 'days'}</span> 🔥
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <StatCard
                    title="Level"
                    value={userProfile.level ? (userProfile.level === 'all' ? 'MIXED' : `${userProfile.level}`) : '—'}
                    description="Active study difficulty"
                    icon={<LevelIcon className="h-6 w-6" />}
                    color="blue"
                />
                <StatCard
                    title="Current Streak"
                    value={userProfile.current_streak != null ? `${userProfile.current_streak}` : '—'}
                    description="Keep the momentum going"
                    icon={<StreakIcon className="h-6 w-6" />}
                    color="purple"
                />
            </div>

            {/* Quick Actions Row */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <button 
                    onClick={onNavigateToStudyGuide}
                    className="group relative overflow-hidden rounded-3xl bg-white dark:bg-black border border-gray-200 p-8 text-left transition-all duration-200 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-[#0A0A0A] cursor-pointer"
                >
                    <div className="flex flex-col gap-4">
                        <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4 w-fit">
                            <StudyGuideIcon className="w-8 h-8 text-blue-600" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black tracking-tight mb-2">Study Guide & Notebooks</h2>
                            <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">Interactive voice lessons, textbooks, flashcards, and notebooks.</p>
                        </div>
                    </div>
                </button>

                <button 
                    onClick={onNavigateToLeaderboard}
                    className="group relative overflow-hidden rounded-3xl bg-white dark:bg-black border border-gray-200 p-8 text-left transition-all duration-200 hover:border-blue-300 hover:bg-gray-50 dark:hover:bg-[#0A0A0A] cursor-pointer"
                >
                    <div className="flex flex-col gap-4">
                        <div className="rounded-2xl bg-sky-50 border border-sky-100 p-4 w-fit">
                            <LeaderboardIcon className="w-8 h-8 text-sky-600" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black tracking-tight mb-2">Leaderboard</h2>
                            <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">See how you rank globally and across your department.</p>
                        </div>
                    </div>
                </button>
            </div>

            {/* Academic Progress Summary — per-section loading (shell stays instant) */}
            {dashboardData ? (
            <div className="rounded-3xl border border-gray-200 dark:border-transparent bg-white dark:bg-[#0A0A0A] p-6 md:p-8">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h3 className="text-[10px] font-black uppercase tracking-[0.28em] text-gray-500 dark:text-gray-400 mb-1">Academic Curriculum</h3>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Overall Learning Progress</h2>
                    </div>
                    <span className="text-2xl font-black text-blue-600">{progressPercent}%</span>
                </div>

                <div className="w-full bg-gray-100 dark:bg-slate-800 h-3.5 rounded-full overflow-hidden mb-6 border border-gray-200/50">
                    <div 
                        className="h-full bg-blue-600 rounded-full transition-all duration-500" 
                        style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }} 
                    />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-100">
                        <p className="text-[10px] font-bold uppercase text-gray-400">Completed Topics</p>
                        <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{completedTopicsCount} / {totalTopics || '—'}</p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-100">
                        <p className="text-[10px] font-bold uppercase text-gray-400">Courses Studied</p>
                        <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{completedCoursesCount}</p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-100">
                        <p className="text-[10px] font-bold uppercase text-gray-400">Total Study Time</p>
                        <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{formatDuration(totalStudySeconds)}</p>
                    </div>
                    <div className="p-4 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-gray-100">
                        <p className="text-[10px] font-bold uppercase text-gray-400">Avg Topic Time</p>
                        <p className="text-xl font-black text-gray-900 dark:text-white mt-1">{formatDuration(averageTopicStudySeconds)}</p>
                    </div>
                </div>
            </div>
            ) : (
                <ProgressSummarySkeleton />
            )}
        </div>
    );
};
