import React, { useState, useEffect } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { db } from '../firebase';
import { ref as dbRef, onValue, off, query, orderByChild, limitToLast } from 'firebase/database';
import type { UserProfile, LeaderboardEntry } from '../types';
import { Avatar } from './Avatar';
import { LogoIcon } from './icons/LogoIcon';

const getWeekId = (date: Date): string => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-${weekNo}`;
};

const LoadingSpinner: React.FC = () => (
  <div className="flex justify-center items-center p-8">
    <LogoIcon className="w-12 h-12 loader-logo" />
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
            {(user.xp || 0).toLocaleString()} XP
        </div>
    </div>
);

interface LeaderboardProps {
  userProfile: UserProfile;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ userProfile }) => {
  const [activeTab, setActiveTab] = useState<'overall' | 'weekly'>('overall');
  const [overallData, setOverallData] = useState<LeaderboardEntry[]>(() => {
    return readCachedJson<LeaderboardEntry[]>(`vantutor_leaderboard_overall_${userProfile.department_id}`, []);
  });
  const [weeklyData, setWeeklyData] = useState<LeaderboardEntry[]>(() => {
    const weekId = getWeekId(new Date());
    return readCachedJson<LeaderboardEntry[]>(`vantutor_leaderboard_weekly_${weekId}_${userProfile.department_id}`, []);
  });
  const [isLoading, setIsLoading] = useState(() => {
    const cached = readCachedJson<LeaderboardEntry[]>(
      `vantutor_leaderboard_${activeTab}_${userProfile.department_id}`,
      []
    );
    return cached.length === 0;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const weekId = getWeekId(new Date());
    const path = activeTab === 'overall' 
        ? `leaderboard_overall/${userProfile.department_id}` 
        : `leaderboard_weekly/${weekId}/${userProfile.department_id}`;
    const cacheKey = activeTab === 'overall'
        ? `vantutor_leaderboard_overall_${userProfile.department_id}`
        : `vantutor_leaderboard_weekly_${weekId}_${userProfile.department_id}`;

    const cached = readCachedJson<LeaderboardEntry[]>(cacheKey, []);
    if (cached.length === 0) {
      setIsLoading(true);
    }
    setError(null);
    
    const leaderboardRef = query(dbRef(db, path), orderByChild('xp'), limitToLast(100));

    const unsubscribe = onValue(leaderboardRef, (snapshot) => {
        if (snapshot.exists()) {
            const data: any[] = [];
            snapshot.forEach((child) => {
                data.push({ user_id: child.key, ...child.val() });
            });
            // Firebase sorts ascending by child, so we reverse for descending leaderboard
            const sortedData = data.sort((a, b) => (b.xp || 0) - (a.xp || 0));
            
            writeCachedJson(cacheKey, sortedData);
            if (activeTab === 'overall') {
                setOverallData(sortedData as LeaderboardEntry[]);
            } else {
                setWeeklyData(sortedData as LeaderboardEntry[]);
            }
        } else {
            writeCachedJson(cacheKey, []);
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
  }, [activeTab, userProfile.department_id]);

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