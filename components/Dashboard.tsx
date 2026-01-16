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

const StatCard: React.FC<{ title: string; value: string | number; description: string; icon: React.ReactNode }> = ({ title, value, description, icon }) => (
  <div className="group relative bg-white p-6 rounded-2xl border border-gray-200 flex-1 min-w-[200px] transition-all duration-300 hover:border-lime-400 hover:shadow-2xl hover:shadow-lime-500/20 hover:-translate-y-2 overflow-hidden">
    <div className="absolute top-4 right-4 text-gray-300 group-hover:text-lime-400 transition-all duration-300 group-hover:scale-110">
        {icon}
    </div>
    <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-lime-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 group-hover:scale-150"></div>
    <div className="relative z-10">
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <p className="text-4xl font-bold mt-2 bg-gradient-to-r from-lime-500 to-teal-500 text-transparent bg-clip-text">{value}</p>
        <p className="text-xs text-gray-600 mt-2">{description}</p>
    </div>
  </div>
);

const RecentActivityItem: React.FC<{ exam: ExamHistoryItem }> = ({ exam }) => (
    <div className="flex items-center justify-between text-sm py-2 border-b border-gray-200 last:border-b-0">
        <div className="flex flex-col">
            <span className="text-gray-700">Completed an exam</span>
            <span className="text-xs text-gray-500">{new Date(exam.timestamp).toLocaleDateString()}</span>
        </div>
        <div className="font-semibold text-right">
            <span className="text-lime-600">{exam.score}/{exam.total_questions}</span>
        </div>
    </div>
);

export const Dashboard: React.FC<DashboardProps> = ({ userProfile, dashboardData }) => {
  
  const completedTopicsCount = dashboardData?.completedTopicsCount ?? 0;
  const totalTopics = dashboardData?.totalTopics || 0;
  
  const averageScore = dashboardData?.examHistory && dashboardData.examHistory.length > 0
    ? Math.round(dashboardData.examHistory.reduce((acc, exam) => acc + (exam.score / exam.total_questions), 0) / dashboardData.examHistory.length * 100)
    : 0;

  return (
    <div className="p-4 sm:p-6 md:p-8" data-tour-id="dashboard-content">
      <div className="flex flex-wrap gap-4 md:gap-6 mb-8">
        <StatCard title="Current Level" value={userProfile.level} description="Your selected difficulty" icon={<LevelIcon className="w-8 h-8"/>} />
        <StatCard title="Weekly Streak" value={`${userProfile.current_streak} Day${userProfile.current_streak !== 1 ? 's' : ''}`} description="Consecutive days of activity" icon={<StreakIcon className="w-8 h-8"/>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-gray-200">
          <h3 className="text-xl font-semibold mb-4 bg-gradient-to-r from-lime-600 to-teal-600 text-transparent bg-clip-text">Progress Overview</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gray-100 p-4 rounded-lg text-center">
                <p className="text-sm text-gray-500">Topics Completed</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                    {dashboardData ? `${completedTopicsCount} / ${totalTopics}` : '- / -'}
                </p>
            </div>
            <div className="bg-gray-100 p-4 rounded-lg text-center">
                <p className="text-sm text-gray-500">Average Exam Score</p>
                <p className="text-2xl font-bold text-gray-800 mt-1">
                    {dashboardData && dashboardData.examHistory.length > 0 ? `${averageScore}%` : '--%'}
                </p>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200">
          <h3 className="text-xl font-semibold mb-4 bg-gradient-to-r from-lime-600 to-teal-600 text-transparent bg-clip-text">Recent Activity</h3>
          {dashboardData && dashboardData.examHistory.length > 0 ? (
            <div className="space-y-1">
                {dashboardData.examHistory.map(exam => <RecentActivityItem key={exam.id} exam={exam} />)}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">A feed of your recent exam results will appear here.</div>
          )}
        </div>
      </div>
    </div>
  );
};