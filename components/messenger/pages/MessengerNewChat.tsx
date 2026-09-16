import React from 'react';
import type { UserProfile } from '../../../types';
import { Avatar } from '../../Avatar';
import { VerificationBadge } from '../../VerificationBadge';
import { StreakBadge } from '../../StreakBadge';

export interface MessengerNewChatProps {
  studyPartnersList: UserProfile[];
  newChatSearchQuery: string;
  setNewChatSearchQuery: (query: string) => void;
  filteredStudyMates: UserProfile[];
  openChatWithUser: (user: UserProfile) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  navigateToSubRoute: (path: string) => void;
}

export const MessengerNewChat: React.FC<MessengerNewChatProps> = ({
  studyPartnersList, newChatSearchQuery, setNewChatSearchQuery, filteredStudyMates,
  openChatWithUser, addToast, navigateToSubRoute
}) => {
  return (
    <div className="flex h-full w-full bg-[#0A0A0A] text-[#FAFAFA] overflow-hidden flex-col">
      <div className="h-16 px-4 bg-[#141414] border-b border-[#2A2A2A] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateToSubRoute('/messenger')}
            className="p-2 rounded-full hover:bg-[#1C1C1C] text-[#FAFAFA] transition cursor-pointer"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="text-base font-bold text-[#FAFAFA]">New Chat</h2>
            <p className="text-xs text-[#A3A3A3]">{studyPartnersList.length} contacts</p>
          </div>
        </div>
        <button
          onClick={() => navigateToSubRoute('/messenger')}
          className="text-sm font-semibold text-[#A3A3A3] hover:text-[#FAFAFA] transition cursor-pointer"
        >
          Cancel
        </button>
      </div>

      <div className="p-3 bg-[#0A0A0A] border-b border-[#2A2A2A] shrink-0">
        <div className="relative">
          <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#B0B0B0]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search study mates..."
            value={newChatSearchQuery}
            onChange={(e) => setNewChatSearchQuery(e.target.value)}
            className="w-full bg-[#1C1C1C] text-sm text-[#FAFAFA] placeholder-[#737373] pl-10 pr-4 py-2.5 rounded-xl border border-[#2A2A2A] focus:outline-none focus:border-[#3A3A3A] transition"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-[#2A2A2A]">
        <div className="py-2">
          <div
            onClick={() => addToast('New Group functionality is coming soon!', 'info')}
            className="flex items-center gap-4 px-4 py-3 hover:bg-[#1C1C1C] transition cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-[#1C1C1C] border border-[#2A2A2A] flex items-center justify-center text-[#FAFAFA]">
              <i className="bi bi-people-fill text-xl"></i>
            </div>
            <span className="font-bold text-[#FAFAFA] text-sm">New Group</span>
          </div>
          <div
            onClick={() => navigateToSubRoute('/messenger/find-friends')}
            className="flex items-center gap-4 px-4 py-3 hover:bg-[#1C1C1C] transition cursor-pointer"
          >
            <div className="w-12 h-12 rounded-full bg-[#1C1C1C] border border-[#2A2A2A] flex items-center justify-center text-[#FAFAFA]">
              <i className="bi bi-person-plus-fill text-xl"></i>
            </div>
            <span className="font-bold text-[#FAFAFA] text-sm">Find Friends</span>
          </div>
        </div>

        <div className="pt-3 pb-2">
          <div className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-[#A3A3A3]">
            Study Mates ({filteredStudyMates.length})
          </div>
          {filteredStudyMates.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#A3A3A3]">
              {newChatSearchQuery ? 'No matching study mates found' : 'No study mates connected yet. Tap "Find Friends" above to connect!'}
            </div>
          ) : (
            filteredStudyMates.map(mate => (
              <div
                key={mate.uid}
                onClick={() => {
                  openChatWithUser(mate);
                  navigateToSubRoute('/messenger');
                }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-[#141414] transition cursor-pointer select-none"
              >
                <Avatar className="w-11 h-11 rounded-full object-cover shrink-0 border border-[#2A2A2A]" photo_url={mate.photo_url} display_name={mate.display_name || 'User'} />
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-semibold text-[#FAFAFA] truncate flex items-center gap-1.5">
                    <span>{mate.display_name}</span>
                    <VerificationBadge user={mate} size="xs" />
                    <StreakBadge streak={mate.current_streak} size="xs" />
                  </h4>
                  <p className="text-xs text-[#A3A3A3] truncate mt-0.5">{mate.department_id || 'No Department'}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
