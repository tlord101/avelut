import React from 'react';
import type { UserProfile, UserProgress, ExamHistoryItem, DashboardData } from '../types';

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
        <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-lg">
                <div className="flex items-start justify-between gap-4">
                        <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3 text-gray-500">
                                {icon}
                        </div>
                        <div className="text-right">
                                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-gray-400 leading-none mb-1">{title}</p>
                                <p className={`text-3xl font-black leading-tight ${colorClasses[color]}`}>{value}</p>
                        </div>
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-gray-500">{description}</p>
        </div>
    );
};

const RecentActivityItem: React.FC<{ exam: ExamHistoryItem }> = ({ exam }) => (
    <div className="group flex items-center gap-4 py-4 px-4 rounded-2xl hover:bg-gray-50 transition-all border border-transparent hover:border-gray-100">
        <div className="w-10 h-10 rounded-xl bg-lime-50 flex items-center justify-center text-lime-600 font-black text-xs shrink-0 group-hover:scale-110 transition-transform">
            {Math.round((exam.score / exam.total_questions) * 100)}%
        </div>
        <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 truncate uppercase tracking-tight">Exam Completed</p>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                {new Date(exam.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
        </div>
        <div className="text-right shrink-0">
            <span className="text-xs font-black text-gray-600 uppercase tracking-tighter bg-gray-100 px-2 py-1 rounded-lg">{exam.score} / {exam.total_questions}</span>
        </div>
    </div>
);

export const Dashboard: React.FC<DashboardProps> = ({ userProfile, dashboardData }) => {
  
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
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-600">User Dashboard</p>
                    <h1 className="mt-2 text-3xl font-black tracking-tighter text-gray-900 md:text-5xl">
                        Welcome back, {userProfile.display_name.split(' ')[0] || 'Learner'}.
                    </h1>
                    <p className="mt-2 text-sm font-bold uppercase tracking-[0.22em] text-gray-400">
                        Track your progress.
                    </p>
                </div>
                <div className="rounded-full border border-gray-200 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.25em] text-gray-700 shadow-sm">
                    Daily Streak: {userProfile.current_streak} days
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <StatCard
                    title="Level"
                    value={userProfile.level === 'all' ? 'MIXED' : `${userProfile.level}L`}
                    description="Active study difficulty"
                    icon={<LevelIcon className="h-6 w-6" />}
                    color="blue"
                />
                <StatCard
                    title="Current Streak"
                    value={`${userProfile.current_streak}`}
                    description="Keep the momentum going"
                    icon={<StreakIcon className="h-6 w-6" />}
                    color="purple"
                />
            </div>

            <div className="rounded-[2rem] border border-gray-200 bg-gradient-to-br from-gray-900 via-gray-800 to-slate-900 p-8 text-white shadow-xl shadow-gray-900/10">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-white/40">Course Progress</p>
                        <h2 className="mt-2 text-3xl font-black tracking-tighter">Topic Mastery</h2>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-white/40">Completed</p>
                        <p className="text-2xl font-black tracking-tight text-emerald-300">{completedTopicsCount} / {totalTopics}</p>
                    </div>
                </div>

                <div className="mt-8 h-4 w-full overflow-hidden rounded-full bg-white/10 p-1">
                    <div className="h-full rounded-full bg-emerald transition-all duration-1000 ease-out" style={{ width: `${progressPercent}%` }} />
                </div>

                <div className="mt-4 flex flex-wrap gap-3 text-xs font-black uppercase tracking-[0.22em] text-white/70">
                    <span className="rounded-full bg-white/10 px-3 py-2">{progressPercent}% complete</span>
                    <span className="rounded-full bg-white/10 px-3 py-2">{completedCoursesCount} completed courses</span>
                    <span className="rounded-full bg-white/10 px-3 py-2">{formatDuration(totalStudySeconds)} total time</span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <StatCard
                    title="Avg Topic Time"
                    value={formatDuration(averageTopicStudySeconds)}
                    description="Average time spent per topic"
                    icon={<LevelIcon className="h-6 w-6 rotate-90" />}
                    color="lime"
                />
                <StatCard
                    title="Avg Course Time"
                    value={formatDuration(averageCourseStudySeconds)}
                    description="Average time spent per course"
                    icon={<StreakIcon className="h-6 w-6" />}
                    color="amber"
                />
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-8">
                <h3 className="mb-6 text-[10px] font-black uppercase tracking-[0.28em] text-gray-500">Recent Performance</h3>
                {dashboardData && dashboardData.examHistory.length > 0 ? (
                    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-2">
                        {dashboardData.examHistory
                            .slice()
                            .sort((a, b) => b.timestamp - a.timestamp)
                            .map(exam => <RecentActivityItem key={exam.id} exam={exam} />)}
                    </div>
                ) : (
                    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-gray-200 shadow-sm">
                            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <p className="text-xs font-black uppercase tracking-[0.25em] text-gray-400">No activity yet</p>
                    </div>
                )}
            </div>
        </div>
    );
};
