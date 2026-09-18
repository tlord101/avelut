import React from 'react';
import type { UserProfile } from '../../../types';
import { formatLastSeen, getLastMessagePreview, formatChatTimestamp, getUnreadCount } from '../messengerUtils';
import { Avatar } from '../../Avatar';
import { VerificationBadge } from '../../VerificationBadge';
import { StreakBadge } from '../../StreakBadge';

export interface MessengerChatListProps {
  userProfile: UserProfile;
  firebaseUser: any;
  activeChats: any[];
  chatSearchQuery: string;
  setChatSearchQuery: (query: string) => void;
  selectedChatIds: string[];
  setSelectedChatIds: React.Dispatch<React.SetStateAction<string[]>>;
  suppressNextChatOpenRef: React.MutableRefObject<boolean>;
  chatRowLongPressTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setActiveChat: (chat: any) => void;
  pinnedChatIds: Record<string, boolean>;
  mutedChatIds: Record<string, boolean>;
  unreadCountsRef: React.MutableRefObject<Record<string, number>>;
  showSelectedMenu: boolean;
  setShowSelectedMenu: (show: boolean) => void;
  selectedMenuRef: React.RefObject<HTMLDivElement>;
  togglePinChats: () => void;
  toggleMuteChats: () => void;
  setShowDeleteChatConfirmDialog: (show: boolean) => void;
  navigateToSubRoute: (path: string) => void;
}

export const MessengerChatList: React.FC<MessengerChatListProps> = ({
  userProfile, firebaseUser, activeChats, chatSearchQuery, setChatSearchQuery,
  selectedChatIds, setSelectedChatIds, suppressNextChatOpenRef, chatRowLongPressTimerRef,
  setActiveChat, pinnedChatIds, mutedChatIds, unreadCountsRef, showSelectedMenu,
  setShowSelectedMenu, selectedMenuRef, togglePinChats, toggleMuteChats,
  setShowDeleteChatConfirmDialog, navigateToSubRoute
}) => {
  return (
    <div className="flex h-full w-full bg-[#0A0A0A] text-[#FAFAFA] overflow-hidden flex-col md:flex-row relative">
      <div className="flex flex-col h-full w-full relative">
        <div className="flex items-center justify-between px-4 py-4 shrink-0 bg-[#0A0A0A]">
          <h1 className="text-xl font-bold text-[#FAFAFA]">Messages</h1>
          <button className="p-2 -mr-2 rounded-full hover:bg-[#1C1C1C] text-[#FAFAFA] transition">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none">
              <circle cx="12" cy="12" r="1"></circle>
              <circle cx="12" cy="5" r="1"></circle>
              <circle cx="12" cy="19" r="1"></circle>
            </svg>
          </button>
        </div>

        <div className="px-4 pb-2 shrink-0">
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#B0B0B0]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search conversations..."
              value={chatSearchQuery}
              onChange={(e) => setChatSearchQuery(e.target.value)}
              className="w-full bg-[#1C1C1C] text-sm text-[#FAFAFA] placeholder-[#737373] pl-10 pr-4 py-2.5 rounded-[16px] focus:outline-none transition-all border border-[#2A2A2A] focus:border-[#3A3A3A] focus:bg-[#222]"
            />
          </div>
        </div>

        {selectedChatIds.length > 0 && (
          <div className="absolute top-0 left-0 right-0 h-16 bg-[#1C1C1C] z-20 flex items-center justify-between px-4 shadow-xl border-b border-[#2A2A2A]">
            <div className="flex items-center gap-4">
              <button onClick={() => setSelectedChatIds([])} className="p-2 -ml-2 rounded-full hover:bg-[#2A2A2A] transition text-[#FAFAFA]">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              </button>
              <span className="font-bold text-[#FAFAFA]">{selectedChatIds.length}</span>
            </div>
            <div className="flex items-center gap-1 relative">
              <button onClick={togglePinChats} className="p-2 rounded-full hover:bg-[#2A2A2A] transition text-[#FAFAFA]" title="Pin/Unpin">
                <i className="bi bi-pin-angle text-lg"></i>
              </button>
              <button onClick={() => setShowDeleteChatConfirmDialog(true)} className="p-2 rounded-full hover:bg-[#2A2A2A] transition text-[#FAFAFA]" title="Delete">
                <i className="bi bi-trash3 text-lg"></i>
              </button>
              <button onClick={toggleMuteChats} className="p-2 rounded-full hover:bg-[#2A2A2A] transition text-[#FAFAFA]" title="Mute/Unmute">
                <i className="bi bi-bell-slash text-lg"></i>
              </button>
              <button onClick={() => setShowSelectedMenu(!showSelectedMenu)} className="p-2 rounded-full hover:bg-[#2A2A2A] transition text-[#FAFAFA]" title="More">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none">
                  <circle cx="12" cy="12" r="1"></circle>
                  <circle cx="12" cy="5" r="1"></circle>
                  <circle cx="12" cy="19" r="1"></circle>
                </svg>
              </button>
              {showSelectedMenu && (
                <div ref={selectedMenuRef} className="absolute top-12 right-0 bg-[#1C1C1C] border border-[#2A2A2A] rounded-xl shadow-2xl overflow-hidden py-1 w-48 z-50">
                  <button onClick={() => {
                    const allRead = selectedChatIds.every(id => unreadCountsRef.current[id] === 0);
                    // Dummy for marking read
                    setShowSelectedMenu(false);
                  }} className="w-full text-left px-4 py-3 text-sm text-[#FAFAFA] hover:bg-[#2A2A2A] transition">
                    Mark as unread
                  </button>
                  <button onClick={() => { setSelectedChatIds([]); setShowSelectedMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-[#FAFAFA] hover:bg-[#2A2A2A] transition">Select All</button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 chat-list pb-24 relative select-none">
          {activeChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center space-y-4">
              <div className="w-20 h-20 bg-[#1C1C1C] rounded-full flex items-center justify-center text-[#FAFAFA] border border-[#2A2A2A]">
                <i className="bi bi-chat-dots text-3xl"></i>
              </div>
              <div>
                <p className="text-[#FAFAFA] font-bold text-lg mb-1">No chats yet</p>
                <p className="text-[#A3A3A3] text-sm max-w-[200px] mx-auto leading-relaxed">Start a conversation with your study partners</p>
              </div>
            </div>
          ) : (
            activeChats.map(c => {
              const isSelected = selectedChatIds.includes(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    if (suppressNextChatOpenRef.current) {
                      suppressNextChatOpenRef.current = false;
                      return;
                    }
                    if (selectedChatIds.length > 0) {
                      setSelectedChatIds(prev =>
                        prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                      );
                      return;
                    }
                    setActiveChat({ chatId: c.id, otherUser: c.otherUser });
                  }}
                  onTouchStart={() => {
                    if (chatRowLongPressTimerRef.current) clearTimeout(chatRowLongPressTimerRef.current);
                    chatRowLongPressTimerRef.current = setTimeout(() => {
                      suppressNextChatOpenRef.current = true;
                      setSelectedChatIds(prev =>
                        prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                      );
                    }, 500);
                  }}
                  onTouchEnd={() => {
                    if (chatRowLongPressTimerRef.current) {
                      clearTimeout(chatRowLongPressTimerRef.current);
                      chatRowLongPressTimerRef.current = null;
                    }
                  }}
                  onTouchCancel={() => {
                    if (chatRowLongPressTimerRef.current) {
                      clearTimeout(chatRowLongPressTimerRef.current);
                      chatRowLongPressTimerRef.current = null;
                    }
                  }}
                  onTouchMove={() => {
                    if (chatRowLongPressTimerRef.current) {
                      clearTimeout(chatRowLongPressTimerRef.current);
                      chatRowLongPressTimerRef.current = null;
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedChatIds(prev =>
                      prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                    );
                  }}
                  className={`flex items-center p-3 sm:p-4 cursor-pointer hover:bg-[#1C1C1C] transition-colors relative border-b border-[#141414] ${isSelected ? '!bg-[#2A2A2A]' : ''}`}
                >
                  {isSelected && (
                    <div className="absolute left-0 inset-y-0 w-1 bg-[#FAFAFA]" />
                  )}
                  <div className="relative mr-3 sm:mr-4 shrink-0">
                    <Avatar className="w-12 h-12 sm:w-[52px] sm:h-[52px] rounded-full object-cover border border-[#2A2A2A]" photo_url={c.otherUser?.photo_url} display_name={c.otherUser?.display_name || 'User'} />
                    {c.otherUser?.is_online && (
                      <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-500 border-2 border-[#0A0A0A] rounded-full shadow-sm"></span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pr-2">
                    <div className="flex justify-between items-center mb-0.5 sm:mb-1">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 pr-2">
                        <h3 className="font-semibold text-sm sm:text-[15px] text-[#FAFAFA] truncate tracking-tight">{c.otherUser?.display_name || 'Unknown User'}</h3>
                        <VerificationBadge user={c.otherUser} size="sm" />
                        <StreakBadge userProfile={c.otherUser} streak={c.otherUser?.current_streak} size="xs" />
                      </div>
                      <span className="text-[11px] sm:text-xs text-[#737373] whitespace-nowrap ml-2 font-medium">
                        {formatChatTimestamp(c.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className={`text-[13px] sm:text-sm truncate flex-1 min-w-0 ${getUnreadCount(userProfile.uid, c) > 0 ? 'text-[#FAFAFA] font-semibold' : 'text-[#737373]'}`}>
                        {c.isTyping ? <span className="text-emerald-500 font-medium tracking-tight flex items-center gap-1"><i className="bi bi-pencil-fill text-[10px]"></i> typing...</span>
                          : c.isRecording ? <span className="text-amber-500 font-medium tracking-tight flex items-center gap-1"><i className="bi bi-mic-fill text-[10px]"></i> recording...</span>
                            : getLastMessagePreview(c)}
                      </p>
                      <div className="flex items-center gap-1.5 shrink-0 pl-2">
                        {mutedChatIds[c.id] && <i className="bi bi-bell-slash-fill text-[#737373] text-xs"></i>}
                        {pinnedChatIds[c.id] && <i className="bi bi-pin-angle-fill text-[#737373] text-xs transform rotate-45"></i>}
                        {getUnreadCount(userProfile.uid, c) > 0 && (
                          <span className="bg-[#3B82F6] text-[#FAFAFA] text-[10px] font-bold px-1.5 py-0.5 min-w-[1.25rem] text-center rounded-full">
                            {getUnreadCount(userProfile.uid, c)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button
          onClick={() => navigateToSubRoute('/messenger/new')}
          className="absolute bottom-6 right-6 w-14 h-14 bg-[#FAFAFA] hover:bg-[#E5E5E5] text-[#0A0A0A] rounded-[18px] shadow-[0_8px_30px_rgb(0,0,0,0.4)] flex items-center justify-center transition-all hover:scale-105 active:scale-95 z-10 cursor-pointer border border-white/20"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
};
