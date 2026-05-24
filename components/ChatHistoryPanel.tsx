import React, { useState, useEffect, useRef } from 'react';
import type { ChatConversation, UserProfile } from '../types';
import { PlusIcon } from './icons/PlusIcon';
import { TrashIcon } from './icons/TrashIcon';
import { MoreVerticalIcon } from './icons/MoreVerticalIcon';
import { PencilIcon } from './icons/PencilIcon';
import { Avatar } from './Avatar';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

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
  isMobilePanelOpen,
  onCloseMobilePanel,
  userProfile,
}) => {
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, convoId: string } | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [isConvosOpen, setIsConvosOpen] = useState(true);

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

    return (
        <aside className={`${isMobilePanelOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} fixed md:relative z-40 w-80 h-full bg-[#0F0F0F] text-gray-300 flex flex-col transition-transform duration-300 border-r border-white/5`}>
            {/* Header: User Profile */}
            <div className="p-4 flex items-center justify-between group">
                <div className="flex items-center gap-3">
                    <Avatar 
                        display_name={userProfile.display_name} 
                        photo_url={userProfile.photo_url} 
                        className="w-9 h-9 border border-white/10" 
                    />
                    <span className="font-bold text-sm text-white truncate max-w-[140px]">{userProfile.display_name}</span>
                </div>
                <button 
                  onClick={onCloseMobilePanel}
                  className="p-2 hover:bg-white/5 rounded-xl transition-colors opacity-0 group-hover:opacity-100 md:opacity-100"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
            </div>

            {/* Quick Actions */}
            <div className="px-3 space-y-2 mb-6">
                <button 
                    onClick={onNewChat}
                    className="w-full flex items-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-2xl transition-all group"
                >
                    <div className="p-1.5 bg-white/10 rounded-lg group-hover:bg-white/20 transition-colors">
                        <PencilIcon className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-bold text-sm text-white">New Conversation</span>
                </button>
                <button className="w-full flex items-center gap-3 p-4 hover:bg-white/5 rounded-2xl transition-all group">
                    <div className="p-1.5 bg-white/10 rounded-lg group-hover:bg-white/20 transition-colors">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <span className="font-bold text-sm text-white">Tasks</span>
                </button>
            </div>

            {/* Upgrade Banner */}
            <div className="px-3 mb-8">
                <div className="p-4 bg-gradient-to-r from-blue-600 to-blue-500 rounded-3xl flex items-center justify-between shadow-lg shadow-blue-500/20">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
                            </svg>
                        </div>
                        <div>
                            <p className="font-black text-xs text-white uppercase tracking-wider">SuperGrok</p>
                            <p className="text-[10px] text-white/70 font-bold">Premium AI Tutor</p>
                        </div>
                    </div>
                    <button className="px-4 py-2 bg-white text-blue-600 rounded-full text-xs font-black shadow-sm active:scale-95 transition-transform">
                        Upgrade
                    </button>
                </div>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto px-1 space-y-1 custom-scrollbar">
                <button 
                    onClick={() => setIsConvosOpen(!isConvosOpen)}
                    className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 hover:text-white transition-colors"
                >
                    <span>Conversations</span>
                    <ChevronDownIcon className={`w-3 h-3 transition-transform ${isConvosOpen ? '' : '-rotate-90'}`} />
                </button>

                {isConvosOpen && (
                    <div className="space-y-0.5 px-2">
                        {conversations.map((convo) => (
                            <div key={convo.id} className="relative group">
                                <button
                                    onClick={() => onSelectConversation(convo.id)}
                                    className={`w-full text-left p-4 rounded-2xl transition-all flex flex-col gap-1 ${
                                        activeConversationId === convo.id 
                                            ? 'bg-white/5 ring-1 ring-white/10' 
                                            : 'hover:bg-white/5'
                                    }`}
                                >
                                    {renamingId === convo.id ? (
                                        <input
                                            autoFocus
                                            className="bg-transparent border-none p-0 focus:ring-0 text-sm font-bold text-white w-full"
                                            value={renameValue}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onBlur={handleRenameSubmit}
                                            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
                                        />
                                    ) : (
                                        <span className={`text-sm font-bold truncate pr-6 ${
                                            activeConversationId === convo.id ? 'text-white' : 'text-gray-400 group-hover:text-white'
                                        }`}>
                                            {convo.title}
                                        </span>
                                    )}
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                        {timeAgo(convo.updatedAt)}
                                    </span>
                                </button>
                                <button 
                                    onClick={(e) => openContextMenu(e, convo.id)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white transition-opacity"
                                >
                                    <MoreVerticalIcon className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom Section: Search & Settings */}
            <div className="p-4 border-t border-white/5 flex items-center gap-2">
                <div className="flex-1 relative group">
                    <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input 
                        type="text" 
                        placeholder="Search History" 
                        className="w-full bg-white/5 border border-white/5 rounded-2xl py-3.5 pl-11 pr-4 text-sm font-bold placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-white/10 focus:bg-white/10 transition-all text-white"
                    />
                </div>
                <button className="p-4 bg-white/5 hover:bg-white/10 rounded-2xl text-gray-400 hover:text-white transition-all">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                </button>
            </div>

            {/* Mini Context Menu */}
            {contextMenu && (
                <div 
                    className="fixed z-50 bg-[#1A1A1A] border border-white/10 rounded-2xl shadow-2xl p-1 w-48 animate-in fade-in zoom-in duration-200"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <button 
                        onClick={() => {
                            const convo = conversations.find(c => c.id === contextMenu.convoId);
                            if (convo) {
                                setRenamingId(convo.id);
                                setRenameValue(convo.title);
                            }
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 rounded-xl text-sm font-bold text-gray-300 transition-colors"
                    >
                        <PencilIcon className="w-4 h-4" /> Rename
                    </button>
                    <button 
                        onClick={() => onDeleteConversation(contextMenu.convoId)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-red-500/10 rounded-xl text-sm font-bold text-red-500 transition-colors"
                    >
                        <TrashIcon className="w-4 h-4" /> Delete
                    </button>
                </div>
            )}
        </aside>
    );
};
        setRenamingId(null);
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
    <div className="h-full bg-[#F9FAFB] flex flex-col pt-6">
      <div className="px-6 flex items-center justify-between mb-8">
          <h2 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">History</h2>
          <button
            onClick={isMobile ? handleMobileNewChat : onNewChat}
            className="p-2 rounded-xl bg-white text-lime-600 shadow-sm ring-1 ring-gray-100 hover:ring-lime-100 hover:bg-lime-50 transition-all active:scale-95 group"
          >
            <PlusIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
      </div>

      <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-4">
        {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                    <ChatBubbleIcon className="w-6 h-6 text-gray-200" />
                </div>
                <p className="text-xs font-bold text-gray-400 leading-tight">Your learning history will appear here.</p>
            </div>
        ) : (
            <ul className="space-y-1">
                {conversations.map((convo) => renderConvoItem(convo, isMobile))}
            </ul>
        )}
      </div>

      <div className="p-6 border-t border-gray-100 bg-white/50">
        <button
          onClick={onClearAll}
          disabled={isDeleting || conversations.length === 0}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <TrashIcon className="w-4 h-4" />
          Clear everything
        </button>
      </div>

      {contextMenu && (
          <div
              style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
              className="fixed bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 p-2 z-[100] animate-in fade-in zoom-in duration-200"
              onClick={(e) => e.stopPropagation()}
          >
              <div className="flex flex-col min-w-[140px]">
                  <button 
                    onClick={() => startRename(conversations.find(c => c.id === contextMenu.convoId)!)}
                    className="flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50 rounded-xl transition-colors"
                  >
                    <PencilIcon className="w-4 h-4" /> Rename
                  </button>
                  <div className="h-px bg-gray-50 my-1 mx-2" />
                  <button 
                    onClick={() => { onDeleteConversation(contextMenu.convoId); setContextMenu(null); }}
                    className="flex items-center gap-3 px-4 py-2.5 text-xs font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    <TrashIcon className="w-4 h-4" /> Delete
                  </button>
              </div>
          </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Panel */}
      <aside className="hidden md:block w-72 flex-shrink-0 border-r border-gray-200">
        {content(false)}
      </aside>
      
      {/* Mobile Panel */}
      <div className={`fixed inset-0 z-40 transform transition-transform duration-300 ease-in-out md:hidden ${isMobilePanelOpen ? 'translate-x-0' : '-translate-x-full'}`} >
          <div className="absolute inset-0 bg-gray-900/30 backdrop-blur-sm" onClick={onCloseMobilePanel} aria-hidden="true" ></div>
          <div className="relative w-72 h-full border-r border-gray-200">
              {content(true)}
          </div>
      </div>
    </>
  );
};