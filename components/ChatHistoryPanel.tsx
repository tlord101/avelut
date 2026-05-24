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