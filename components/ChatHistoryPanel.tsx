import React, { useState, useEffect, useRef } from 'react';
import type { ChatConversation, UserProfile } from '../types';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { MoreVerticalIcon } from './icons/MoreVerticalIcon';
import { PencilIcon } from './icons/PencilIcon';
import { Avatar } from './Avatar';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { ChatBubbleIcon } from './icons/ChatBubbleIcon';

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
}) => {
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, convoId: string } | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const longPressTimer = useRef<NodeJS.Timeout | null>(null);

    const openContextMenu = (e: React.MouseEvent, convoId: string) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            convoId,
        });
    };

    useEffect(() => {
        const handleClickOutside = () => setContextMenu(null);
        if (contextMenu) {
            window.addEventListener('click', handleClickOutside);
        }
        return () => {
            window.removeEventListener('click', handleClickOutside);
        };
    }, [contextMenu]);

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

    const handleTouchStart = (e: React.TouchEvent, convoId: string) => {
        const touch = e.touches[0];
        longPressTimer.current = setTimeout(() => {
            setContextMenu({ x: touch.clientX, y: touch.clientY, convoId });
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
                <div className="p-2 bg-white rounded-2xl ring-2 ring-lime-500 shadow-sm">
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
                        className="w-full text-xs font-bold text-gray-800 border-none p-1 focus:ring-0"
                    />
                </div>
            ) : (
                <div
                    onClick={() => isMobile ? handleMobileSelect(convo.id) : onSelectConversation(convo.id)}
                    onContextMenu={(e) => openContextMenu(e, convo.id)}
                    onTouchStart={(e) => handleTouchStart(e, convo.id)}
                    onTouchEnd={handleTouchEnd}
                    className={`w-full text-left p-3.5 rounded-2xl transition-all duration-200 cursor-pointer flex justify-between items-center group relative overflow-hidden ${
                      activeConversationId === convo.id
                        ? 'bg-white shadow-sm ring-1 ring-lime-500/10 border border-lime-100'
                        : 'text-gray-600 hover:bg-white/50 border border-transparent'
                    }`}
                  >
                  {activeConversationId === convo.id && (
                      <div className="absolute left-0 top-3 bottom-3 w-1 bg-lime-500 rounded-r-full"></div>
                  )}
                  <div className="flex-1 overflow-hidden pr-4">
                      <p className={`text-sm truncate leading-tight mb-1 ${activeConversationId === convo.id ? 'font-bold text-gray-900' : 'font-medium text-gray-600 group-hover:text-gray-900'}`}>
                        {convo.title}
                      </p>
                      <p className={`text-[10px] font-bold uppercase tracking-wider ${activeConversationId === convo.id ? 'text-lime-600/60' : 'text-gray-400'}`}>
                          {timeAgo(convo.last_updated_at)}
                      </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); openContextMenu(e, convo.id); }}
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
    <div className="h-full bg-white flex flex-col p-4 animate-in fade-in duration-300">
      {/* Top User Profile & Close Action */}
      <div className="flex items-center justify-between mb-8">
          <div className="w-10 h-10 rounded-full bg-emerald flex items-center justify-center text-white font-bold text-lg">
              {userProfile.display_name?.charAt(0).toUpperCase() || 'D'}
          </div>
          <button 
            onClick={onCloseMobilePanel}
            className="p-2 text-charcoal hover:bg-off-white rounded-full transition-colors lg:hidden"
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
        {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-2 text-center">
                <p className="text-sm font-medium text-gray-400">Your history will appear here.</p>
            </div>
        ) : (
            <ul className="space-y-6 mt-4">
                {conversations.map((convo) => (
                    <li key={convo.id} className="group flex items-center justify-between px-2 cursor-pointer" onClick={() => isMobile ? handleMobileSelect(convo.id) : onSelectConversation(convo.id)}>
                        <div className="flex-1 min-w-0 mr-4">
                            <p className={`text-[15px] font-medium leading-tight truncate ${activeConversationId === convo.id ? 'text-emerald' : 'text-charcoal'}`}>
                                {convo.title}
                            </p>
                            <p className="text-[13px] text-gray-400 mt-1">
                                {timeAgo(convo.last_updated_at)}
                            </p>
                        </div>
                        <button className="text-gray-400 hover:text-charcoal opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreVerticalIcon className="w-5 h-5" />
                        </button>
                    </li>
                ))}
            </ul>
        )}
      </div>

      {/* Bottom Fixed/Sticky Area */}
      <div className="mt-auto space-y-4 pt-4 border-t border-gray-100 bg-white">
        <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-4 h-[48px] bg-off-white rounded-[24px] border border-gray-100">
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input 
                    type="text" 
                    placeholder="Search history" 
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm placeholder-gray-500"
                />
            </div>
            <button className="p-3 text-emerald hover:bg-off-white rounded-full transition-colors">
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
      
      {/* Mobile Panel */}
      <div className={`fixed inset-0 z-[100] transform transition-transform duration-300 ease-in-out md:hidden ${isMobilePanelOpen ? 'translate-x-0' : '-translate-x-full'}`} >
          <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={onCloseMobilePanel} aria-hidden="true" ></div>
          <div className="relative w-[320px] h-full border-r border-gray-100 bg-white shadow-xl">
              {content(true)}
          </div>
      </div>
    </>
  );
};