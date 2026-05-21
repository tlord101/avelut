import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { ref as dbRef, onValue, off, query, orderByChild, limitToLast } from 'firebase/database';
import type { UserProfile, LeaderboardEntry, WeeklyLeaderboardEntry } from '../types';
import { Avatar } from './Avatar';

const getWeekId = (date: Date): string => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-${weekNo}`;
};

const LoadingSpinner: React.FC = () => (
  <div className="flex justify-center items-center p-8">
    <svg className="w-12 h-12 loader-logo" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path className="loader-path-1" d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path className="loader-path-2" d="M41.5 21V29.75C41.5 30.825 40.85 32.55 39.4166 33.25L27.75 39.375C26.6666 39.9 25.3333 39.9 24.25 39.375L12.5833 33.25C11.15 32.55 10.5 30.825 10.5 29.75V21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <path className="loader-path-3" d="M47.6667 17.5V26.25" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </div>
);

const RankItem: React.FC<{rank: number, user: LeaderboardEntry, isCurrentUser: boolean}> = ({ rank, user, isCurrentUser }) => (
    <div className={`flex items-center p-3 rounded-lg transition-all duration-200 border ${isCurrentUser ? 'bg-lime-100 border-lime-300' : 'bg-gray-50 border-gray-100'}`}>
        <div className="flex-shrink-0 w-8 text-center font-bold text-lg text-gray-500">
            {rank <= 3 ? (
                <span className={rank === 1 ? 'text-yellow-500' : rank === 2 ? 'text-gray-400' : 'text-yellow-600'}>{rank}</span>
            ) : rank}
        </div>
        <Avatar displayName={user.display_name} photoURL={user.photo_url} className="w-10 h-10 ml-4" />
        <div className="flex-1 ml-4">
            <p className="font-semibold text-gray-800">{user.display_name}</p>
        </div>
        <div className="font-bold text-lime-600 text-lg">
            {user.xp.toLocaleString()} XP
        </div>
    </div>
);

interface LeaderboardProps {
  userProfile: UserProfile;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ userProfile }) => {
  const [activeTab, setActiveTab] = useState<'overall' | 'weekly'>('overall');
  const [overallData, setOverallData] = useState<LeaderboardEntry[]>([]);
  const [weeklyData, setWeeklyData] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    
    const weekId = getWeekId(new Date());
    const path = activeTab === 'overall' ? 'leaderboard_overall' : `leaderboard_weekly/${weekId}`;
    const leaderboardRef = query(dbRef(db, path), orderByChild('xp'), limitToLast(100));

    const unsubscribe = onValue(leaderboardRef, (snapshot) => {
        if (snapshot.exists()) {
            const data: any[] = [];
            snapshot.forEach((child) => {
                data.push({ user_id: child.key, ...child.val() });
            });
            // Firebase sorts ascending by child, so we reverse for descending leaderboard
            const sortedData = data.sort((a, b) => b.xp - a.xp);
            
            if (activeTab === 'overall') {
                setOverallData(sortedData as LeaderboardEntry[]);
            } else {
                setWeeklyData(sortedData as WeeklyLeaderboardEntry[]);
            }
        } else {
            if (activeTab === 'overall') setOverallData([]);
            else setWeeklyData([]);
        }
        setIsLoading(false);
    }, (err) => {
        console.error("Error fetching leaderboard: ", err);
        setError("Could not load leaderboard data. Please try again later.");
        setIsLoading(false);
    });

    return () => off(leaderboardRef);
  }, [activeTab]);

  const data = activeTab === 'overall' ? overallData : weeklyData;
  const currentUserRank = data.findIndex(u => u.user_id === userProfile.uid) + 1;
  const topUsers = data.slice(0, 10);
  const isCurrentUserInTop = currentUserRank > 0 && currentUserRank <= 10;

  const renderList = () => {
      if(isLoading) return <LoadingSpinner />;
      if(error) return <p className="text-center text-red-600">{error}</p>
      if(data.length === 0) return <p className="text-center text-gray-500">The leaderboard is empty. Be the first to set a score!</p>;

      return (
          <div className="space-y-3">
              {topUsers.map((user, index) => (
                  <RankItem key={user.user_id} rank={index + 1} user={user} isCurrentUser={user.user_id === userProfile.uid} />
              ))}
              {!isCurrentUserInTop && currentUserRank > 0 && (
                  <>
                      <div className="text-center text-gray-500">...</div>
                      <RankItem rank={currentUserRank} user={data[currentUserRank-1]} isCurrentUser={true} />
                  </>
              )}
          </div>
      )
  };

  return (
    <div className="flex-1 flex flex-col w-full bg-white p-4 sm:p-6 rounded-xl border border-gray-200">
      <div className="flex-shrink-0 mb-4 bg-gray-100 p-1 rounded-lg flex">
        <button onClick={() => setActiveTab('overall')} className={`flex-1 p-2 rounded-md font-semibold transition-colors ${activeTab === 'overall' ? 'bg-lime-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}>
          Overall
        </button>
        <button onClick={() => setActiveTab('weekly')} className={`flex-1 p-2 rounded-md font-semibold transition-colors ${activeTab === 'weekly' ? 'bg-lime-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}>
          This Week
        </button>
      </div>
      <div className="flex-1 overflow-y-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {renderList()}
      </div>
    </div>
  );
};