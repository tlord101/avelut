import React from 'react';
import type { UserProfile } from '../../../types';
import { Avatar } from '../../Avatar';
import { VerificationBadge } from '../../VerificationBadge';
import { StreakBadge } from '../../StreakBadge';

export interface MessengerFindFriendsProps {
  findFriendsSearchQuery: string;
  setFindFriendsSearchQuery: (query: string) => void;
  findFriendsTab: 'incoming' | 'sent';
  setFindFriendsTab: (tab: 'incoming' | 'sent') => void;
  searchResultsUsers: UserProfile[];
  incomingUsersList: UserProfile[];
  sentUsersList: UserProfile[];
  pendingIncomingCount: number;
  pendingSentCount: number;
  studyPartners: Record<string, boolean>;
  openChatWithUser: (user: UserProfile) => void;
  sendPartnerRequest: (user: UserProfile) => void;
  acceptPartnerRequest: (user: UserProfile) => void;
  rejectPartnerRequest: (user: UserProfile) => void;
  cancelPartnerRequest: (user: UserProfile) => void;
  navigateToSubRoute: (path: string) => void;
}

export const MessengerFindFriends: React.FC<MessengerFindFriendsProps> = ({
  findFriendsSearchQuery, setFindFriendsSearchQuery, findFriendsTab, setFindFriendsTab,
  searchResultsUsers, incomingUsersList, sentUsersList, pendingIncomingCount, pendingSentCount,
  studyPartners, openChatWithUser, sendPartnerRequest, acceptPartnerRequest,
  rejectPartnerRequest, cancelPartnerRequest, navigateToSubRoute
}) => {
  return (
    <div className="flex h-full w-full bg-[#0A0A0A] text-[#FAFAFA] overflow-hidden flex-col">
      <div className="h-16 px-4 bg-[#141414] border-b border-[#2A2A2A] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigateToSubRoute('/messenger/new')}
            className="p-2 rounded-full hover:bg-[#1C1C1C] text-[#FAFAFA] transition cursor-pointer"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-base font-bold text-[#FAFAFA]">Find Friends</h2>
        </div>
        <button
          onClick={() => navigateToSubRoute('/messenger')}
          className="text-sm font-semibold text-[#A3A3A3] hover:text-[#FAFAFA] transition cursor-pointer"
        >
          Done
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
            placeholder="Search people by name or department..."
            value={findFriendsSearchQuery}
            onChange={(e) => setFindFriendsSearchQuery(e.target.value)}
            className="w-full bg-[#1C1C1C] text-sm text-[#FAFAFA] placeholder-[#737373] pl-10 pr-4 py-2.5 rounded-xl border border-[#2A2A2A] focus:outline-none focus:border-[#3A3A3A] transition"
          />
        </div>
      </div>

      {!findFriendsSearchQuery.trim() && (
        <div className="flex border-b border-[#2A2A2A] bg-[#141414] shrink-0">
          <button
            onClick={() => setFindFriendsTab('incoming')}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center justify-center gap-2 cursor-pointer ${
              findFriendsTab === 'incoming'
                ? 'border-[#FAFAFA] text-[#FAFAFA]'
                : 'border-transparent text-[#A3A3A3] hover:text-[#FAFAFA]'
            }`}
          >
            Incoming {pendingIncomingCount > 0 && <span className="bg-[#FAFAFA] text-[#0A0A0A] px-1.5 rounded-full text-[10px]">{pendingIncomingCount}</span>}
          </button>
          <button
            onClick={() => setFindFriendsTab('sent')}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition flex items-center justify-center gap-2 cursor-pointer ${
              findFriendsTab === 'sent'
                ? 'border-[#FAFAFA] text-[#FAFAFA]'
                : 'border-transparent text-[#A3A3A3] hover:text-[#FAFAFA]'
            }`}
          >
            Sent {pendingSentCount > 0 && <span className="bg-[#2A2A2A] text-[#FAFAFA] px-1.5 rounded-full text-[10px]">{pendingSentCount}</span>}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-[#2A2A2A] p-2">
        {findFriendsSearchQuery.trim() ? (
          searchResultsUsers.length === 0 ? (
            <div className="p-8 text-center text-[#737373] text-sm font-medium">
              No users found matching "{findFriendsSearchQuery}".
            </div>
          ) : (
            searchResultsUsers.map(user => (
              <div key={user.uid} className="flex items-center justify-between p-3 hover:bg-[#1C1C1C] rounded-xl transition">
                <div className="flex items-center gap-3 min-w-0 pr-4">
                  <Avatar className="w-12 h-12 rounded-full object-cover border border-[#2A2A2A]" photo_url={user.photo_url} display_name={user.display_name || 'User'} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-bold text-[#FAFAFA] text-sm truncate">{user.display_name}</h4>
                      <VerificationBadge user={user} size="xs" />
                      <StreakBadge userProfile={user} streak={user.current_streak} size="xs" />
                    </div>
                    <p className="text-xs text-[#A3A3A3] truncate mt-0.5">{user.department_id || 'Student'}</p>
                  </div>
                </div>
                <div className="shrink-0">
                  {studyPartners[user.uid] ? (
                    <button onClick={() => openChatWithUser(user)} className="px-4 py-1.5 bg-[#1C1C1C] text-[#FAFAFA] text-xs font-bold rounded-lg border border-[#2A2A2A] hover:bg-[#2A2A2A] transition cursor-pointer">
                      Message
                    </button>
                  ) : (
                    <button onClick={() => sendPartnerRequest(user)} className="px-4 py-1.5 bg-[#FAFAFA] text-[#0A0A0A] text-xs font-bold rounded-lg hover:bg-[#E5E5E5] transition cursor-pointer">
                      Add
                    </button>
                  )}
                </div>
              </div>
            ))
          )
        ) : (
          findFriendsTab === 'incoming' ? (
            incomingUsersList.length === 0 ? (
              <div className="p-8 text-center text-[#737373] text-sm font-medium">
                No incoming friend requests.
              </div>
            ) : (
              incomingUsersList.map(user => (
                <div key={user.uid} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 hover:bg-[#1C1C1C] rounded-xl transition gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="w-12 h-12 rounded-full object-cover border border-[#2A2A2A]" photo_url={user.photo_url} display_name={user.display_name || 'User'} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-bold text-[#FAFAFA] text-sm truncate">{user.display_name}</h4>
                        <VerificationBadge user={user} size="xs" />
                      </div>
                      <p className="text-xs text-[#A3A3A3] truncate mt-0.5">{user.department_id || 'Student'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 sm:ml-auto">
                    <button onClick={() => rejectPartnerRequest(user)} className="flex-1 sm:flex-none px-4 py-2 bg-[#1C1C1C] text-[#FAFAFA] text-xs font-bold rounded-lg border border-[#2A2A2A] hover:bg-[#2A2A2A] transition cursor-pointer">
                      Ignore
                    </button>
                    <button onClick={() => acceptPartnerRequest(user)} className="flex-1 sm:flex-none px-4 py-2 bg-[#FAFAFA] text-[#0A0A0A] text-xs font-bold rounded-lg hover:bg-[#E5E5E5] transition cursor-pointer">
                      Accept
                    </button>
                  </div>
                </div>
              ))
            )
          ) : (
            sentUsersList.length === 0 ? (
              <div className="p-8 text-center text-[#737373] text-sm font-medium">
                No pending sent requests.
              </div>
            ) : (
              sentUsersList.map(user => (
                <div key={user.uid} className="flex items-center justify-between p-3 hover:bg-[#1C1C1C] rounded-xl transition gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="w-12 h-12 rounded-full object-cover border border-[#2A2A2A]" photo_url={user.photo_url} display_name={user.display_name || 'User'} />
                    <div className="min-w-0">
                      <h4 className="font-bold text-[#FAFAFA] text-sm truncate">{user.display_name}</h4>
                      <p className="text-[10px] text-[#A3A3A3] uppercase tracking-wider font-semibold mt-0.5">Request Sent</p>
                    </div>
                  </div>
                  <button onClick={() => cancelPartnerRequest(user)} className="shrink-0 px-3 py-1.5 bg-[#1C1C1C] text-[#EF4444] text-xs font-bold rounded-lg border border-[#2A2A2A] hover:bg-[#EF4444]/10 transition cursor-pointer">
                    Cancel
                  </button>
                </div>
              ))
            )
          )
        )}
      </div>
    </div>
  );
};
