import React, { useState, useEffect, useRef } from 'react';
import type { ChatConversation, UserProfile } from '../types';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { MoreVerticalIcon } from './icons/MoreVerticalIcon';
import { PencilIcon } from './icons/PencilIcon';
import { Avatar } from './Avatar';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChatBubbleIcon } from './icons/ChatBubbleIcon';
import { ChatHistorySkeleton } from './Skeleton';

const timeAgo = (timestamp: number): string => {
  const now = Date.now();
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

interface ChatHistoryPanelProps {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  onClearAll: () => void;
  isDeleting: boolean;
  isMobilePanelOpen: boolean;
  onCloseMobilePanel: () => void;
  userProfile: UserProfile;
  isLoading?: boolean;
}

export const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onRenameConversation,
  onClearAll,
  isDeleting,
  isMobilePanelOpen,
  onCloseMobilePanel,
  userProfile,
  isLoading
}) => {
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, convo: ChatConversation } | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; convo: ChatConversation | null }>({ isOpen: false, convo: null });
    const longPressTimer = useRef<NodeJS.Timeout | null>(null);

    const openContextMenu = (e: React.MouseEvent, convo: ChatConversation) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            convo,
        });
        setConfirmDelete(false);
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setContextMenu(null);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleRenameSubmit = () => {
        if (renamingId && renameValue.trim()) {
            onRenameConversation(renamingId, renameValue);
            setRenamingId(null);
        }
    };

    const startRename = (convo: ChatConversation) => {
        setRenamingId(convo.id);
        setRenameValue(convo.title);
        setContextMenu(null);
    };

    const handleTouchStart = (e: React.TouchEvent, convo: ChatConversation) => {
        const touch = e.touches[0];
        longPressTimer.current = setTimeout(() => {
            setContextMenu({ x: touch.clientX, y: touch.clientY, convo });
            setConfirmDelete(false);
        }, 500);
    };

    const handleTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };




    const handleMobileSelect = (id: string) => {
        if (renamingId !== id) {
            onSelectConversation(id);
            onCloseMobilePanel();
        }
    };

    const handleMobileNewChat = () => {
        onNewChat();
        onCloseMobilePanel();
    };

    const renderConvoItem = (convo: ChatConversation, isMobile: boolean) => (
        <li key={convo.id} className="relative group px-2">
            {renamingId === convo.id ? (
                <div className="p-2 bg-white dark:bg-black rounded-2xl ring-2 ring-lime-500 shadow-sm">
                    <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameSubmit();
                            if (e.key === 'Escape') setRenamingId(null);
                        }}
                        autoFocus
                        className="w-full text-xs font-bold  dark:text-white border-none p-1 focus:ring-0"
                    />
                </div>
            ) : (
                <div
                    onClick={() => isMobile ? handleMobileSelect(convo.id) : onSelectConversation(convo.id)}
                    onContextMenu={(e) => openContextMenu(e, convo)}
                    onTouchStart={(e) => handleTouchStart(e, convo)}
                    onTouchEnd={handleTouchEnd}
                    className={`w-full text-left p-3.5 rounded-2xl transition-all duration-200 cursor-pointer flex justify-between items-center group relative overflow-hidden ${
                      activeConversationId === convo.id
                        ? 'bg-white dark:bg-black shadow-sm ring-1 ring-lime-500/10 border border-lime-100'
                        : 'text-gray-600 hover:bg-white dark:bg-black/50 border border-transparent'
                    }`}
                  >
                  {activeConversationId === convo.id && (
                      <div className="absolute left-0 top-3 bottom-3 w-1 bg-lime-500 rounded-r-full"></div>
                  )}
                  <div className="flex-1 overflow-hidden pr-4">
                      <p className={`text-sm truncate leading-tight mb-1 ${activeConversationId === convo.id ? 'font-bold  dark:text-white' : 'font-medium text-gray-600 group-hover: dark:text-white'}`}>
                        {convo.title}
                      </p>
                      <p className={`text-[10px] font-bold uppercase tracking-wider ${activeConversationId === convo.id ? 'text-lime-600/60' : 'text-gray-400'}`}>
                          {timeAgo(convo.last_updated_at)}
                      </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); openContextMenu(e, convo); }}
                    className="p-1.5 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-all"
                    aria-label="More options"
                  >
                    <MoreVerticalIcon className="w-4 h-4" />
                  </button>
                </div>
            )}
        </li>
    );

    const content = (isMobile: boolean) => (
    <div className="h-full bg-white dark:bg-black flex flex-col p-4 animate-in fade-in duration-300">
      {/* Top User Profile & Close Action */}
      <div className="flex items-center justify-between mb-8">
          <div className="w-10 h-10 rounded-full bg-emerald flex items-center justify-center text-white font-bold text-lg">
              {userProfile.display_name?.charAt(0).toUpperCase() || 'D'}
          </div>
          <button 
            onClick={onCloseMobilePanel}
            className="p-2 text-charcoal dark:text-white hover:bg-off-white dark:hover:bg-[#111111] rounded-full transition-colors lg:hidden"
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
      </div>

      {/* "New Conversation" Button */}
      <button
        onClick={isMobile ? handleMobileNewChat : onNewChat}
        className="w-full flex items-center gap-3 px-6 h-[56px] rounded-[16px] bg-mint text-emerald hover:bg-emerald/10 transition-all font-semibold mb-8 group"
      >
        <PencilIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
        <span className="text-base">New Conversation</span>
      </button>

      {/* Conversations History List */}
      <div className="flex items-center justify-between mb-4 px-2">
          <h2 className="text-sm font-semibold text-charcoal">Conversations</h2>
          <ChevronDownIcon className="w-4 h-4 text-charcoal transform rotate-180" />
      </div>

      <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-4">
        {isLoading ? (
            <ChatHistorySkeleton />
        ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-2 text-center">
                <p className="text-sm font-medium text-gray-400">Your history will appear here.</p>
            </div>
        ) : (
            <ul className="space-y-3 mt-4">
                {conversations.map((convo) => (
                    <React.Fragment key={convo.id}>
                        {renderConvoItem(convo, isMobile)}
                    </React.Fragment>
                ))}
            </ul>
        )}
      </div>

      {/* Bottom Fixed/Sticky Area */}
      <div className="mt-auto space-y-4 pt-4 border-t border-gray-100 bg-white dark:bg-black">
        <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-4 h-[48px] bg-off-white dark:bg-black rounded-[24px] border border-gray-100 dark:border-gray-800">
                <svg className="w-5 h-5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input 
                    type="text" 
                    placeholder="Search history" 
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm placeholder-gray-500"
                />
            </div>
            <button className="p-3 text-emerald dark:text-white hover:bg-off-white dark:hover:bg-[#111111] rounded-full transition-colors">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Panel */}
      <aside className="hidden md:block w-72 flex-shrink-0 border-r border-gray-200">
        {content(false)}
      </aside>
      
      {/* Mobile Panel — Full Screen */}
      <div className={`fixed inset-0 z-[100] transform transition-transform duration-300 ease-in-out md:hidden ${isMobilePanelOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="relative w-full h-full bg-white dark:bg-black shadow-xl">
              {content(true)}
          </div>
      </div>

      {/* Floating Context Menu */}
      {contextMenu && (
        <div
            className="fixed inset-0 z-[160] bg-transparent"
            onClick={() => setContextMenu(null)}
        >
            <div className="fixed inset-0 z-[160]" onClick={() => setContextMenu(null)} aria-hidden="true" />
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    top: `${Math.max(16, Math.min(contextMenu.y - 20, window.innerHeight - 130))}px`,
                    left: `${Math.max(16, Math.min(contextMenu.x + 10, window.innerWidth - 210))}px`,
                }}
                className="z-[161] bg-white dark:bg-[#1C1C1C] border border-neutral-200 dark:border-neutral-800 shadow-2xl absolute w-52 rounded-2xl p-1.5 space-y-0.5 animate-in zoom-in-95 fade-in duration-150"
            >
                {/* Rename */}
                <button
                    type="button"
                    onClick={() => { startRename(contextMenu.convo); }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm font-semibold transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-800 dark:text-neutral-200 cursor-pointer"
                >
                    <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center shrink-0">
                        <PencilIcon className="w-4 h-4 text-indigo-500" />
                    </div>
                    <span>Rename</span>
                </button>
                {/* Delete — opens modal */}
                <button
                    type="button"
                    onClick={() => {
                        setDeleteModal({ isOpen: true, convo: contextMenu.convo });
                        setContextMenu(null);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm font-semibold transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 cursor-pointer"
                >
                    <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-500/15 flex items-center justify-center shrink-0">
                        <TrashIcon className="w-4 h-4 text-rose-500" />
                    </div>
                    <span>Delete Chat</span>
                </button>
            </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────────────────────────── */}
      {deleteModal.isOpen && deleteModal.convo && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 sm:p-6">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[3px] animate-in fade-in duration-200"
            onClick={() => setDeleteModal({ isOpen: false, convo: null })}
          />
          {/* Card */}
          <div className="relative bg-white dark:bg-[#141414] border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-5 animate-in slide-in-from-bottom-4 sm:zoom-in-95 fade-in duration-250">
            <div className="flex flex-col items-center text-center space-y-3 pt-2">
              <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
                <TrashIcon className="w-8 h-8 text-red-500" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-lg font-black text-neutral-900 dark:text-white">Delete this chat?</h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  "<span className="font-semibold text-neutral-700 dark:text-neutral-300">{deleteModal.convo.title}</span>" will be permanently deleted. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  onDeleteConversation(deleteModal.convo!.id);
                  setDeleteModal({ isOpen: false, convo: null });
                }}
                disabled={isDeleting}
                className="w-full py-4 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-black text-base tracking-wide transition-all shadow-lg shadow-red-500/20 cursor-pointer disabled:opacity-60"
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteModal({ isOpen: false, convo: null })}
                className="w-full py-3.5 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 active:scale-[0.98] text-neutral-700 dark:text-neutral-300 font-semibold text-sm transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};