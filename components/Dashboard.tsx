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

const StatCard: React.FC<{ title: string; value: string | number; description: string; icon: React.ReactNode; color: 'lime' | 'blue' | 'purple' }> = ({ title, value, description, icon, color }) => {
  const colorClasses = {
    lime: 'from-lime-500 to-emerald-500 shadow-lime-100',
    blue: 'from-blue-500 to-indigo-500 shadow-blue-100',
    purple: 'from-purple-500 to-pink-500 shadow-purple-100'
  };

  return (
    <div className="group relative bg-white p-6 rounded-[2rem] border border-gray-100 flex-1 min-w-[240px] transition-all duration-500 hover:shadow-3xl hover:-translate-y-1 overflow-hidden">
        <div className="flex items-start justify-between mb-4">
            <div className={`p-3 rounded-2xl bg-gray-50 text-gray-400 group-hover:scale-110 transition-transform duration-500`}>
                {icon}
            </div>
            <div className="text-right">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">{title}</p>
                <p className={`text-3xl font-black bg-gradient-to-br ${colorClasses[color]} text-transparent bg-clip-text leading-tight`}>{value}</p>
            </div>
        </div>
        <p className="text-xs font-bold text-gray-500 group-hover:text-gray-900 transition-colors uppercase tracking-tight">{description}</p>
        
        {/* Decorative background element */}
        <div className={`absolute -bottom-6 -right-6 w-24 h-24 bg-gradient-to-br ${colorClasses[color]} opacity-[0.03] rounded-full group-hover:scale-150 transition-transform duration-700`}></div>
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
  const progressPercent = totalTopics > 0 ? Math.round((completedTopicsCount / totalTopics) * 100) : 0;
  
  const averageScore = dashboardData?.examHistory && dashboardData.examHistory.length > 0
    ? Math.round(dashboardData.examHistory.reduce((acc, exam) => acc + (exam.score / exam.total_questions), 0) / dashboardData.examHistory.length * 100)
    : 0;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 md:p-10 space-y-10" data-tour-id="dashboard-content">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
              <h1 className="text-3xl md:text-5xl font-black text-gray-900 tracking-tighter leading-none mb-2">Welcome Back.</h1>
              <p className="text-sm md:text-base font-bold text-gray-400 uppercase tracking-widest">Learning Progress for {userProfile.display_name}</p>
          </div>
          <div className="hidden md:block">
              <div className="px-4 py-2 bg-black text-white rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-black/10">
                  Daily Streak: {userProfile.current_streak} days
              </div>
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard 
            title="Level" 
            value={userProfile.level === 'all' ? 'MIXED' : `${userProfile.level}L`} 
            description="Active study difficulty" 
            icon={<LevelIcon className="w-6 h-6"/>} 
            color="blue"
        />
        <StatCard 
            title="Avg Score" 
            value={`${averageScore}%`} 
            description="Overall performance" 
            icon={<LevelIcon className="w-6 h-6 rotate-90"/>} 
            color="lime"
        />
        <StatCard 
            title="Streak" 
            value={`${userProfile.current_streak}`} 
            description="Keep the momentum" 
            icon={<StreakIcon className="w-6 h-6"/>} 
            color="purple"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-12 xl:col-span-7 space-y-8">
          <div className="bg-white p-8 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-sm relative overflow-hidden group">
            <div className="relative z-10">
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-3">Topic Mastery</h2>
                        <p className="text-4xl font-black text-gray-900 tracking-tighter">{progressPercent}%</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Completed</p>
                        <p className="text-xl font-black text-lime-600 tracking-tighter">{completedTopicsCount} / {totalTopics}</p>
                    </div>
                </div>

                {/* Modern Progress Bar */}
                <div className="h-4 w-full bg-gray-50 rounded-full overflow-hidden mb-4 p-1">
                    <div 
                        className="h-full bg-gradient-to-r from-lime-500 to-emerald-500 rounded-full transition-all duration-1000 ease-out shadow-lg shadow-lime-500/20"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <p className="text-xs font-bold text-gray-400 leading-relaxed max-w-sm">
                    {progressPercent > 70 ? "Excellent progress! You're mastering the curriculum." : "Keep going! Each topic completed brings you closer to your goal."}
                </p>
            </div>
            
            {/* Background design */}
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform duration-700">
                <svg className="w-32 h-32 text-lime-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/></svg>
            </div>
          </div>
        </div>

        <div className="lg:col-span-12 xl:col-span-5">
          <div className="bg-[#F9FAFB] p-8 rounded-[2.5rem] h-full flex flex-col">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-8">Recent Performance</h3>
            {dashboardData && dashboardData.examHistory.length > 0 ? (
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[400px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pr-2">
                    {dashboardData.examHistory.sort((a,b) => b.timestamp - a.timestamp).map(exam => <RecentActivityItem key={exam.id} exam={exam} />)}
                </div>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-10 bg-white rounded-[2rem] border border-gray-100 shadow-sm">
                    <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">No activity yet</p>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
