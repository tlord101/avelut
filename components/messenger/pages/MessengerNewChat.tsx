import React, { useMemo, useState } from 'react';
import type { UserProfile } from '../../../types';
import { Avatar } from '../../Avatar';

export interface MessengerNewChatProps {
  /** All real users (excluding current user filtering done in parent or here) */
  allUsers: UserProfile[];
  currentUser: UserProfile;
  studyPartners: Record<string, boolean>;
  partnerRequests: Record<string, any>;
  newChatSearchQuery: string;
  setNewChatSearchQuery: (query: string) => void;
  openChatWithUser: (user: UserProfile) => void;
  sendPartnerRequest: (user: UserProfile) => void;
  acceptPartnerRequest: (user: UserProfile) => void;
  declinePartnerRequest: (user: UserProfile) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  navigateToSubRoute: (path: string) => void;
  onNavigate?: (route: string) => void;
}

export const MessengerNewChat: React.FC<MessengerNewChatProps> = ({
  allUsers,
  currentUser,
  studyPartners,
  partnerRequests,
  newChatSearchQuery,
  setNewChatSearchQuery,
  openChatWithUser,
  sendPartnerRequest,
  acceptPartnerRequest,
  declinePartnerRequest,
  navigateToSubRoute,
  onNavigate,
}) => {
  const [scopeFilter, setScopeFilter] = useState<'all' | 'my_school' | 'my_college'>('all');
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');

  const uniqueSchools = useMemo(() => {
    const setOfSchools = new Set<string>();
    (allUsers || []).forEach((u) => {
      if (u?.school_id) setOfSchools.add(u.school_id);
    });
    return Array.from(setOfSchools).sort();
  }, [allUsers]);

  const filteredUsers = useMemo(() => {
    let users = (allUsers || []).filter(
      (u) => u && u.uid && u.uid !== currentUser?.uid
    );

    if (scopeFilter === 'my_school' && currentUser?.school_id) {
      users = users.filter((u) => u.school_id === currentUser.school_id);
    } else if (scopeFilter === 'my_college' && currentUser?.college_id) {
      users = users.filter((u) => u.college_id === currentUser.college_id);
    }

    if (schoolFilter !== 'all') {
      users = users.filter((u) => u.school_id === schoolFilter);
    }

    if (levelFilter !== 'all') {
      users = users.filter((u) => String(u.level) === levelFilter || String(u.level) === `${levelFilter}L`);
    }

    if (newChatSearchQuery.trim()) {
      const q = newChatSearchQuery.toLowerCase().trim();
      users = users.filter((u) => {
        const name = (u.display_name || '').toLowerCase();
        const school = (u.school_id || '').toLowerCase().replace(/_/g, ' ');
        const college = (u.college_id || '').toLowerCase().replace(/_/g, ' ');
        const dept = (u.department_id || '').toLowerCase().replace(/_/g, ' ');
        const level = String(u.level || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        return (
          name.includes(q) ||
          school.includes(q) ||
          college.includes(q) ||
          dept.includes(q) ||
          level.includes(q) ||
          email.includes(q)
        );
      });
    }

    return users;
  }, [
    allUsers,
    currentUser,
    scopeFilter,
    schoolFilter,
    levelFilter,
    newChatSearchQuery,
  ]);

  return (
    <div className="flex h-full w-full flex-col bg-[#F8F9FA] dark:bg-black text-neutral-900 dark:text-white overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center px-4 py-4 bg-white dark:bg-black border-b border-[#E9ECEF] dark:border-white/10 shrink-0 sticky top-0 z-10">
        <button
          type="button"
          onClick={() => navigateToSubRoute('/messenger')}
          className="mr-3 w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-white/10 text-[#6C757D] dark:text-gray-400 transition cursor-pointer"
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-black text-[#212529] dark:text-white">New Chat</h1>
          <p className="text-xs font-semibold text-[#6C757D] dark:text-gray-400 truncate">
            Discover and connect with students across any school and faculty
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigateToSubRoute('/messenger')}
          className="text-sm font-semibold text-[#6C757D] dark:text-gray-400 hover:text-[#212529] dark:hover:text-white transition cursor-pointer px-2"
        >
          Cancel
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search by name, university, college, department, or level..."
              value={newChatSearchQuery}
              onChange={(e) => setNewChatSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-[#0A0A0A] text-sm font-semibold text-slate-900 dark:text-white pl-10 pr-10 py-3.5 rounded-2xl border border-slate-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-[#0066FF] transition placeholder:text-slate-400"
            />
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            {newChatSearchQuery && (
              <button
                type="button"
                onClick={() => setNewChatSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                aria-label="Clear search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200/60 dark:border-white/5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setScopeFilter('all');
                  setSchoolFilter('all');
                }}
                className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                  scopeFilter === 'all' && schoolFilter === 'all'
                    ? 'bg-white dark:bg-[#0A0A0A] text-[#0066FF]'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                All Universities
              </button>
              {currentUser?.school_id && (
                <button
                  type="button"
                  onClick={() => {
                    setScopeFilter('my_school');
                    setSchoolFilter('all');
                  }}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer capitalize ${
                    scopeFilter === 'my_school'
                      ? 'bg-white dark:bg-[#0A0A0A] text-[#0066FF]'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  My Campus
                </button>
              )}
              {currentUser?.college_id && (
                <button
                  type="button"
                  onClick={() => {
                    setScopeFilter('my_college');
                    setSchoolFilter('all');
                  }}
                  className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer capitalize ${
                    scopeFilter === 'my_college'
                      ? 'bg-white dark:bg-[#0A0A0A] text-[#0066FF]'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  My Faculty
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={schoolFilter}
                onChange={(e) => {
                  setSchoolFilter(e.target.value);
                  if (e.target.value !== 'all') setScopeFilter('all');
                }}
                className="text-xs font-semibold bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0066FF] cursor-pointer"
              >
                <option value="all">Any School ({uniqueSchools.length})</option>
                {uniqueSchools.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="text-xs font-semibold bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0066FF] cursor-pointer"
              >
                <option value="all">Any Level</option>
                <option value="100">100 Level</option>
                <option value="200">200 Level</option>
                <option value="300">300 Level</option>
                <option value="400">400 Level</option>
                <option value="500">500 Level</option>
                <option value="600">600 Level</option>
                <option value="Postgraduate">Postgraduate</option>
              </select>
            </div>
          </div>
        </div>

        {/* User list — same card design as Study Partners */}
        <div className="max-w-2xl mx-auto space-y-2.5">
          {filteredUsers.map((u) => {
            const isPartner = studyPartners[u.uid] === true;
            const req = partnerRequests[u.uid];
            return (
              <div
                key={u.uid}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 bg-white dark:bg-[#0A0A0A] border border-slate-200/80 dark:border-white/10 rounded-2xl hover:border-slate-300 dark:hover:border-white/20 transition cursor-pointer"
                onClick={() => {
                  if (isPartner) {
                    openChatWithUser(u);
                    navigateToSubRoute('/messenger');
                  } else if (onNavigate) {
                    onNavigate(`public_profile_${u.uid}`);
                  }
                }}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Avatar
                    className="w-11 h-11 sm:w-12 sm:h-12 rounded-full shrink-0 object-cover border border-slate-200 dark:border-white/10"
                    photo_url={u.photo_url}
                    display_name={u.display_name || 'User'}
                  />
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                      {u.display_name || u.email || 'User'}
                    </h4>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {u.school_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/40 text-[#0066FF] dark:text-blue-300 border border-blue-100 dark:border-blue-900/30 capitalize">
                          <span>🏛️</span>
                          <span className="truncate max-w-[130px]">{u.school_id.replace(/_/g, ' ')}</span>
                        </span>
                      )}
                      {u.college_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-300 border border-violet-100 dark:border-violet-900/30 capitalize">
                          <span>🏫</span>
                          <span className="truncate max-w-[130px]">{u.college_id.replace(/_/g, ' ')}</span>
                        </span>
                      )}
                      {u.department_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/30 capitalize">
                          <span>📚</span>
                          <span className="truncate max-w-[140px]">{u.department_id.replace(/_/g, ' ')}</span>
                        </span>
                      )}
                      {u.level && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30">
                          {String(u.level).replace(/L$/i, '')}L
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div
                  className="shrink-0 flex items-center justify-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isPartner ? (
                    <button
                      type="button"
                      onClick={() => {
                        openChatWithUser(u);
                        navigateToSubRoute('/messenger');
                      }}
                      className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-xl hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition cursor-pointer"
                    >
                      ✓ Connected
                    </button>
                  ) : req?.status === 'sent' ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2.5 py-1.5 rounded-xl">
                        Pending
                      </span>
                      <button
                        type="button"
                        onClick={() => declinePartnerRequest(u)}
                        className="text-[11px] font-bold text-slate-500 hover:text-red-500 transition px-2 py-1 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : req?.status === 'received' ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => declinePartnerRequest(u)}
                        className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 px-3 py-1.5 rounded-xl transition cursor-pointer"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => acceptPartnerRequest(u)}
                        className="text-xs font-bold text-white bg-[#0066FF] hover:bg-[#0055D4] px-3 py-1.5 rounded-xl transition cursor-pointer"
                      >
                        Accept
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sendPartnerRequest(u)}
                      className="text-xs font-bold text-white bg-[#0066FF] hover:bg-[#0055D4] px-3.5 py-1.5 rounded-xl transition cursor-pointer"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {filteredUsers.length === 0 && (
            <div className="text-center py-10 bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-2xl p-6">
              <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">
                No students found matching your criteria.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Try searching by university name, college, department, or level.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
