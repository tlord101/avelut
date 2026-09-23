import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { NavItem, UserProfile, ChatConversation } from '../types';
import { navigationItems, adminNavigationItems } from '../constants';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';
import { useToast } from '../hooks/useToast';
import { deleteLocalConversation, getLocalMessages } from '../services/chatStorageService';
import { Capacitor } from '@capacitor/core';

export interface SidebarProps {
  activeItem: string;
  onItemClick: (id: string) => void;
  userProfile: UserProfile | null;
  onLogout: () => void;
  isMobileSidebarOpen: boolean;
  onCloseMobileSidebar: () => void;
  items?: NavItem[];
  secondaryItems?: NavItem[];
  unreadCount?: number;
  unreadMessagesCount?: number;
  recentConversations?: ChatConversation[];
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (id: string) => void;
  onPinConversation?: (id: string, isPinned: boolean) => void;
  activeConversationId?: string | null;
  quickLinks?: NavItem[];
  brandTitle?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  overlayRef?: React.RefObject<HTMLDivElement | null>;
  sidebarRef?: React.RefObject<HTMLElement | null>;
}

const PINNED_STORAGE_PREFIX = 'avelut_pinned_chats_';

const getStoredPinnedIds = (userId?: string): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(`${PINNED_STORAGE_PREFIX}${userId || 'anon'}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
};

const saveStoredPinnedIds = (pinnedIds: Set<string>, userId?: string) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      `${PINNED_STORAGE_PREFIX}${userId || 'anon'}`,
      JSON.stringify(Array.from(pinnedIds))
    );
  } catch (err) {
    console.warn('[Sidebar] Failed to save pinned chats:', err);
  }
};

const timeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Quick-access navigation button — Grok-style stacked cards
 * Full-width rounded rectangles, larger type, light/dark adaptive
 */
const LinkRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  badgeLabel?: string;
}> = ({ icon, label, active, onClick, badge, badgeLabel }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors cursor-pointer select-none group relative ${
      active
        ? 'bg-neutral-100 dark:bg-[#1C1C1C] text-neutral-900 dark:text-white font-medium'
        : 'bg-transparent text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#1a1a1a]'
    }`}
  >
    <span
      className={`flex-shrink-0 w-6 h-6 flex items-center justify-center transition-colors ${
        active
          ? 'text-neutral-900 dark:text-white'
          : 'text-neutral-600 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white'
      }`}
    >
      {icon}
    </span>
    <span className="text-[16px] sm:text-[17px] truncate flex-1 tracking-tight font-medium leading-none">
      {label}
    </span>
    {badgeLabel ? (
      <span className="flex-shrink-0 bg-[#E8F0FE] dark:bg-[#1e3a5f]/60 text-[#1a73e8] dark:text-[#8ab4f8] text-[12px] font-semibold px-2.5 py-0.5 rounded-full leading-none">
        {badgeLabel}
      </span>
    ) : badge != null && badge > 0 ? (
      <span className="bg-[#0066FF] text-white text-[11px] font-bold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center">
        {badge > 99 ? '99+' : badge}
      </span>
    ) : null}
  </button>
);

interface ActiveMenuState {
  convo: ChatConversation;
  isPinned: boolean;
  anchorY?: number;
  anchorX?: number;
}

/**
 * Responsive 3-Dot Options Context Menu:
 * Floating popover on desktop, bottom sheet on mobile (<640px).
 */
const ChatContextMenu: React.FC<{
  menuState: ActiveMenuState;
  onClose: () => void;
  onTogglePin: (convoId: string) => void;
  onShare: (convo: ChatConversation) => void;
  onForward: (convo: ChatConversation) => void;
  onDelete: (convoId: string) => void;
}> = ({ menuState, onClose, onTogglePin, onShare, onForward, onDelete }) => {
  const { convo, isPinned, anchorY = 200, anchorX = 200 } = menuState;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Compute desktop popover position
  const desktopStyle = useMemo<React.CSSProperties>(() => {
    const top = Math.min(anchorY - 20, window.innerHeight - 260);
    const left = Math.min(anchorX + 10, window.innerWidth - 230);
    return {
      top: `${Math.max(16, top)}px`,
      left: `${Math.max(16, left)}px`,
    };
  }, [anchorY, anchorX]);

  return (
    <div
      className="fixed inset-0 z-[160] select-none bg-transparent"
      onClick={onClose}
    >
      {/* Click-away backdrop */}
      <div className="fixed inset-0 z-[160]" onClick={onClose} aria-hidden="true" />

      <div
        ref={menuRef}
        onClick={(e) => e.stopPropagation()}
        style={desktopStyle}
        className="z-[161] absolute w-56 rounded-2xl p-1.5 space-y-0.5 bg-white dark:bg-[#1C1C1C] border border-neutral-200 dark:border-neutral-800 transition-all"
      >
        {/* Action 1: Pin / Unpin */}
        <button
          type="button"
          onClick={() => {
            onTogglePin(convo.id);
            onClose();
          }}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs sm:text-sm font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-800 dark:text-neutral-200 cursor-pointer`}
        >
          <div className="w-5 h-5 flex items-center justify-center shrink-0 text-[#0066FF] dark:text-[#38BDF8]">
            {isPinned ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.283.284-.53.5-.664.672C10.553 2.82 10.5 3 10.5 3.5V5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1.077l-1.423 7.115a.5.5 0 0 1-.49.405.5.5 0 0 1-.49-.405L6.577 7H5.5a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h1V3.5c0-.5-.053-.68-.19-.849-.134-.172-.38-.388-.664-.672C4.342 1.174 4 0.68 4 .5a.5.5 0 0 1 .146-.354z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <span className="block truncate">{isPinned ? 'Unpin Chat' : 'Pin Chat'}</span>
          </div>
        </button>

        {/* Action 2: Share Chat */}
        <button
          type="button"
          onClick={() => {
            onShare(convo);
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs sm:text-sm font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-800 dark:text-neutral-200 cursor-pointer"
        >
          <div className="w-5 h-5 flex items-center justify-center shrink-0 text-emerald-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="block truncate">Share Chat</span>
            
          </div>
        </button>

        {/* Action 3: Forward Chat */}
        <button
          type="button"
          onClick={() => {
            onForward(convo);
            onClose();
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs sm:text-sm font-medium transition-colors hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-800 dark:text-neutral-200 cursor-pointer"
        >
          <div className="w-5 h-5 flex items-center justify-center shrink-0 text-indigo-500">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="block truncate">Forward Chat</span>
            
          </div>
        </button>

        {/* Action 4: Delete Chat with Confirmation State */}
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-xs sm:text-sm font-medium transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-600/80 dark:text-rose-400 cursor-pointer"
          >
            <div className="w-5 h-5 flex items-center justify-center shrink-0 text-rose-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <span className="block truncate">Delete Chat</span>
              
            </div>
          </button>
        ) : (
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-xl space-y-2 border border-rose-200 dark:border-rose-900/50 animate-fade-in">
            <p className="text-[12px] font-semibold text-rose-700 dark:text-rose-300 leading-tight">
              Delete this chat?
            </p>
            <p className="text-[11px] text-rose-600/80 dark:text-rose-400">
              This action cannot be undone.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-1.5 px-2.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(convo.id);
                  onClose();
                }}
                className="flex-1 py-1.5 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ConversationRow: React.FC<{
  convo: ChatConversation;
  isActive: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onOptionsClick: (e: React.MouseEvent, convo: ChatConversation) => void;
}> = ({ convo, isActive, isPinned, onSelect, onOptionsClick }) => (
  <div
    onClick={onSelect}
    className={`w-full group relative flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all duration-150 cursor-pointer select-none ${
      isActive
        ? 'bg-neutral-200 dark:bg-[#1C1C1C] text-neutral-900 dark:text-white font-medium'
        : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-white/5'
    }`}
  >
    <div className="flex-1 min-w-0 pr-2">
      <div className="flex items-center gap-1.5">
        {isPinned && (
          <svg className="w-3 h-3 text-[#0066FF] dark:text-[#38BDF8] shrink-0" fill="currentColor" viewBox="0 0 16 16">
            <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.283.284-.53.5-.664.672C10.553 2.82 10.5 3 10.5 3.5V5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1.077l-1.423 7.115a.5.5 0 0 1-.49.405.5.5 0 0 1-.49-.405L6.577 7H5.5a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h1V3.5c0-.5-.053-.68-.19-.849-.134-.172-.38-.388-.664-.672C4.342 1.174 4 0.68 4 .5a.5.5 0 0 1 .146-.354z"/>
          </svg>
        )}
        <span className="block text-[13.5px] truncate leading-snug font-medium">
          {convo.title || 'New Chat'}
        </span>
      </div>
      <span className="block text-[11px] text-neutral-400 dark:text-neutral-500 mt-0.5">
        {timeAgo(convo.last_updated_at)}
      </span>
    </div>

    {/* 3-Dot Options Button: accessible on touch / hover */}
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOptionsClick(e, convo);
      }}
      className="w-7 h-7 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-white/10 transition-all opacity-100 shrink-0 cursor-pointer"
      aria-label="Chat options"
      title="More options"
    >
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
        <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
      </svg>
    </button>
  </div>
);

const SidebarPanel: React.FC<{
  activeItem: string;
  onItemClick: (id: string) => void;
  userProfile: UserProfile | null;
  navItems: NavItem[];
  quickLinks?: NavItem[];
  recentConversations?: ChatConversation[];
  onSelectConversation?: (id: string) => void;
  onNewChat?: () => void;
  onDeleteConversation?: (id: string) => void;
  onPinConversation?: (id: string, isPinned: boolean) => void;
  activeConversationId?: string | null;
  unreadMessagesCount: number;
  brandTitle: string;
  onClose?: () => void;
}> = ({
  activeItem,
  onItemClick,
  userProfile,
  navItems,
  quickLinks,
  recentConversations,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onPinConversation,
  activeConversationId,
  unreadMessagesCount,
  brandTitle,
  onClose,
}) => {
  const { addToast } = useToast();
  const links = quickLinks && quickLinks.length > 0 ? quickLinks : navItems;
  const showRecents = activeItem === 'chat' && Array.isArray(recentConversations);

  // Pinned state persistence
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() =>
    getStoredPinnedIds(userProfile?.uid)
  );
  const [isPinnedCollapsed, setIsPinnedCollapsed] = useState<boolean>(false);

  // Sync pinned ids when user profile changes
  useEffect(() => {
    setPinnedIds(getStoredPinnedIds(userProfile?.uid));
  }, [userProfile?.uid]);

  // Context menu state
  const [activeMenu, setActiveMenu] = useState<ActiveMenuState | null>(null);

  const togglePinChat = useCallback(
    (convoId: string) => {
      setPinnedIds((prev) => {
        const next = new Set<string>(prev);
        const willPin = !next.has(convoId);
        if (willPin) {
          next.add(convoId);
          addToast('Chat pinned to top', 'success');
        } else {
          next.delete(convoId);
          addToast('Chat unpinned', 'info');
        }
        saveStoredPinnedIds(next, userProfile?.uid);
        onPinConversation?.(convoId, willPin);
        return next;
      });
    },
    [userProfile?.uid, onPinConversation, addToast]
  );

  const handleShareChat = useCallback(
    async (convo: ChatConversation) => {
      try {
        const uid = userProfile?.uid || 'anon';
        const messages = await getLocalMessages(convo.id);
        const transcript = messages
          .filter((m) => m.sender !== 'system')
          .map((m) => `${m.sender === 'user' ? '👤 Student' : '🤖 Avelut'}:\n${m.text}`)
          .join('\n\n');

        const sharePayload = {
          title: convo.title || 'Avelut AI Chat',
          text: transcript ? `Chat: ${convo.title}\n\n${transcript}` : `Avelut Chat: ${convo.title}`,
          dialogTitle: 'Share Chat',
        };

        if (Capacitor.isNativePlatform()) {
          try {
            const { Share } = await import('@capacitor/share');
            await Share.share(sharePayload);
            addToast('Shared successfully!', 'success');
            return;
          } catch (capErr: any) {
            if (capErr?.message?.includes('canceled') || capErr?.message?.includes('closed')) return;
          }
        }

        if (typeof navigator !== 'undefined' && navigator.share) {
          try {
            await navigator.share(sharePayload);
            addToast('Shared successfully!', 'success');
            return;
          } catch (navErr: any) {
            if (navErr?.name === 'AbortError') return;
          }
        }

        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(sharePayload.text);
          addToast('Chat transcript copied to clipboard!', 'info');
        }
      } catch (err) {
        console.error('[Sidebar] Share chat error:', err);
        addToast('Could not share chat.', 'error');
      }
    },
    [userProfile?.uid, addToast]
  );

  const handleForwardChat = useCallback(
    async (convo: ChatConversation) => {
      try {
        const uid = userProfile?.uid || 'anon';
        const messages = await getLocalMessages(convo.id);
        const excerpt = messages
          .slice(-3)
          .map((m) => `${m.sender === 'user' ? 'Me' : 'Avelut'}: ${m.text.slice(0, 100)}`)
          .join('\n');

        const forwardPackage = {
          type: 'chat_forward',
          conversationId: convo.id,
          title: convo.title,
          excerpt,
          timestamp: Date.now(),
        };

        localStorage.setItem('pending_forward_chat', JSON.stringify(forwardPackage));
        addToast('Chat prepared. Select a partner to forward to!', 'info');
        onItemClick('messenger');
      } catch (err) {
        console.error('[Sidebar] Forward chat error:', err);
        addToast('Could not prepare chat forward.', 'error');
      }
    },
    [userProfile?.uid, onItemClick, addToast]
  );

  const handleDeleteChat = useCallback(
    async (convoId: string) => {
      try {
        const uid = userProfile?.uid || 'anon';
        await deleteLocalConversation(convoId, uid);
        if (userProfile?.uid) {
            import('../lib/backend').then(({ db, ref, remove }) => {
                remove(ref(db, `chat_conversations/${userProfile.uid}/${convoId}`)).catch(console.error);
                remove(ref(db, `chat_messages/${convoId}`)).catch(console.error);
            }).catch(console.error);
        }
        setPinnedIds((prev) => {
          if (!prev.has(convoId)) return prev;
          const next = new Set<string>(prev);
          next.delete(convoId);
          saveStoredPinnedIds(next, uid);
          return next;
        });
        if (onDeleteConversation) {
          onDeleteConversation(convoId);
        }
        addToast('Chat deleted', 'info');
      } catch (err) {
        console.error('[Sidebar] Delete conversation error:', err);
        addToast('Failed to delete chat.', 'error');
      }
    },
    [userProfile?.uid, onDeleteConversation, addToast]
  );

  const handleOpenOptions = useCallback(
    (e: React.MouseEvent, convo: ChatConversation) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setActiveMenu({
        convo,
        isPinned: pinnedIds.has(convo.id),
        anchorY: rect.bottom,
        anchorX: rect.left,
      });
    },
    [pinnedIds]
  );

  // Divide conversations into Pinned and Recents
  const { pinnedConversations, unpinnedConversations } = useMemo(() => {
    if (!recentConversations || !Array.isArray(recentConversations)) {
      return { pinnedConversations: [], unpinnedConversations: [] };
    }
    const pinned: ChatConversation[] = [];
    const unpinned: ChatConversation[] = [];
    recentConversations.forEach((c) => {
      if (pinnedIds.has(c.id)) {
        pinned.push(c);
      } else {
        unpinned.push(c);
      }
    });
    return { pinnedConversations: pinned, unpinnedConversations: unpinned };
  }, [recentConversations, pinnedIds]);

  const extraNavLinks: NavItem[] = [
    {
      id: 'leaderboard',
      label: 'Leaderboard',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 003-3V8.25a3 3 0 00-3-3h-9a3 3 0 00-3 3v7.5a3 3 0 003 3m9 0v3.375c0 .621-.504 1.125-1.125 1.125h-6.75A1.125 1.125 0 017.5 22.125V18.75m9 0a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75c0-.231-.035-.454-.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v6.75c0 .621.504 1.125 1.125 1.125H6.75" />
        </svg>
      ),
    },
    {
      id: 'study_partners',
      label: 'Study Partners',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
        </svg>
      ),
    },
    {
      id: 'history',
      label: 'Exam History',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
      ),
    },
    {
      id: 'feedback',
      label: 'Feedback',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      ),
    },
    {
      id: 'help',
      label: 'Help & Support',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18a.75.75 0 100-1.5.75.75 0 000 1.5z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black text-neutral-900 dark:text-white select-none">
      {/* Top Brand Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{brandTitle}</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors"
            aria-label="Search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Main Navigation — Quick-access cards */}
      <nav className="px-2 flex-shrink-0">
        <div className="bg-white dark:bg-[#111111] border border-neutral-200/80 dark:border-white/10 rounded-2xl overflow-hidden flex flex-col">
          {links.map((item, index) => (
            <React.Fragment key={item.id}>
              <LinkRow
                icon={item.icon}
                label={item.label}
                active={activeItem === item.id}
                onClick={() => onItemClick(item.id)}
                badge={item.id === 'messenger' ? unreadMessagesCount : undefined}
              />
              {index < links.length - 1 && (
                <div className="h-[1px] bg-neutral-200/50 dark:bg-white/5 mx-3" />
              )}
            </React.Fragment>
          ))}
        </div>
      </nav>

      {/* History & Conversations: Pinned + Recents */}
      {showRecents ? (
        <div className="flex-1 min-h-0 flex flex-col mt-4 px-2 overflow-hidden">
          {/* Scrollable conversation container */}
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-4 space-y-3">
            {/* 1. Dedicated & Collapsible Pinned Chats Section */}
            {pinnedConversations.length > 0 && (
              <div className="flex-shrink-0 px-1">
                <div className="flex items-center justify-between px-2.5 py-1 mb-1 text-neutral-500 dark:text-neutral-400">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
                    <svg className="w-3.5 h-3.5 text-[#0066FF] dark:text-[#38BDF8]" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.283.284-.53.5-.664.672C10.553 2.82 10.5 3 10.5 3.5V5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1.077l-1.423 7.115a.5.5 0 0 1-.49.405.5.5 0 0 1-.49-.405L6.577 7H5.5a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h1V3.5c0-.5-.053-.68-.19-.849-.134-.172-.38-.388-.664-.672C4.342 1.174 4 0.68 4 .5a.5.5 0 0 1 .146-.354z"/>
                    </svg>
                    <span>Pinned</span>
                    <span className="text-[10px] bg-neutral-100 dark:bg-white/10 px-1.5 py-0.2 rounded-full font-bold text-neutral-600 dark:text-neutral-300">
                      {pinnedConversations.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPinnedCollapsed((prev) => !prev)}
                    className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-white/10 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                    aria-label={isPinnedCollapsed ? 'Expand pinned chats' : 'Collapse pinned chats'}
                  >
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isPinnedCollapsed ? '-rotate-90' : 'rotate-0'
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>
                {!isPinnedCollapsed && (
                  <div className="space-y-0.5">
                    {pinnedConversations.map((convo) => (
                      <ConversationRow
                        key={convo.id}
                        convo={convo}
                        isActive={activeConversationId === convo.id}
                        isPinned={true}
                        onSelect={() => onSelectConversation?.(convo.id)}
                        onOptionsClick={handleOpenOptions}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. Recents Section */}
            <div className="flex-shrink-0 px-1">
              <div className="flex items-center justify-between px-2.5 py-1 mb-1">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <span>Recents</span>
                  {unpinnedConversations.length > 0 && (
                    <span className="text-[10px] bg-neutral-100 dark:bg-white/10 px-1.5 py-0.2 rounded-full font-bold text-neutral-600 dark:text-neutral-300">
                      {unpinnedConversations.length}
                    </span>
                  )}
                </div>
                {onNewChat && (
                  <button
                    type="button"
                    onClick={onNewChat}
                    className="text-[12px] font-semibold text-[#0066FF] dark:text-[#38BDF8] hover:underline cursor-pointer"
                  >
                    New
                  </button>
                )}
              </div>

              <div className="space-y-0.5">
                {unpinnedConversations.length === 0 && pinnedConversations.length === 0 ? (
                  <p className="px-3 py-6 text-[13px] text-neutral-400 text-center">
                    Your history will appear here.
                  </p>
                ) : (
                  unpinnedConversations.map((convo) => (
                    <ConversationRow
                      key={convo.id}
                      convo={convo}
                      isActive={activeConversationId === convo.id}
                      isPinned={false}
                      onSelect={() => onSelectConversation?.(convo.id)}
                      onOptionsClick={handleOpenOptions}
                    />
                  ))
                )}
              </div>

              {recentConversations && recentConversations.length > 8 && (
                <button
                  type="button"
                  onClick={() => onItemClick('history')}
                  className="w-full text-left px-3 py-2 text-[12px] font-medium text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
                >
                  See all history…
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Standard Navigation for non-chat views */
        <div className="flex-1 min-h-0 flex flex-col mt-4 px-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="px-1 mb-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
              Navigation
            </span>
          </div>
          <div className="space-y-1.5 pb-4">
            {extraNavLinks.map((item) => (
              <LinkRow
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeItem === item.id}
                onClick={() => onItemClick(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Floating Context Menu / Bottom Sheet */}
      {activeMenu && (
        <ChatContextMenu
          menuState={activeMenu}
          onClose={() => setActiveMenu(null)}
          onTogglePin={togglePinChat}
          onShare={handleShareChat}
          onForward={handleForwardChat}
          onDelete={handleDeleteChat}
        />
      )}

      {/* Bottom Profile Footer (Redundant Chat button removed to maximize vertical space) */}
      <div className="flex-shrink-0 px-3 pb-4 pt-2 border-t border-neutral-100 dark:border-white/10">
        <button
          type="button"
          onClick={() => onItemClick('settings')}
          className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors text-left cursor-pointer"
        >
          <Avatar
            display_name={userProfile?.display_name || null}
            photo_url={userProfile?.photo_url}
            className="w-9 h-9 flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium truncate flex items-center gap-1 text-neutral-900 dark:text-white">
              {userProfile?.display_name || 'Profile'}
              <VerificationBadge status={userProfile?.subscription_status} />
            </p>
            <p className="text-[11px] text-neutral-500">Settings</p>
          </div>
        </button>
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  activeItem,
  onItemClick,
  userProfile,
  onLogout,
  isMobileSidebarOpen,
  onCloseMobileSidebar,
  items,
  secondaryItems,
  unreadCount = 0,
  unreadMessagesCount = 0,
  recentConversations,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onPinConversation,
  activeConversationId,
  quickLinks,
  brandTitle = 'Avelut',
  overlayRef,
  sidebarRef,
}) => {
  const handleMobileItemClick = (id: string) => {
    onItemClick(id);
    onCloseMobileSidebar();
  };

  const baseItems = items || navigationItems;
  const navItems =
    userProfile?.is_admin && !items
      ? [...baseItems, ...adminNavigationItems]
      : baseItems;

  return (
    <>
      {/* Mobile Drawer */}
      <div
        className={`fixed inset-0 z-[130] md:hidden ${
          isMobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div
          ref={overlayRef as any}
          className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
          onClick={onCloseMobileSidebar}
          aria-hidden="true"
        />
        <aside
          ref={sidebarRef as any}
          className={`absolute top-0 left-0 h-full w-full bg-white dark:bg-black transition-transform duration-300 ease-out ${
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SidebarPanel
            activeItem={activeItem}
            onItemClick={handleMobileItemClick}
            userProfile={userProfile}
            navItems={navItems}
            quickLinks={quickLinks}
            recentConversations={recentConversations}
            onSelectConversation={(id) => {
              onSelectConversation?.(id);
              onCloseMobileSidebar();
            }}
            onNewChat={() => {
              onNewChat?.();
              onCloseMobileSidebar();
            }}
            onDeleteConversation={onDeleteConversation}
            onPinConversation={onPinConversation}
            activeConversationId={activeConversationId}
            unreadMessagesCount={unreadMessagesCount}
            brandTitle={brandTitle}
            onClose={onCloseMobileSidebar}
          />
        </aside>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-shrink-0 w-[280px] h-full border-r border-neutral-200 dark:border-white/5 bg-white dark:bg-black">
        <div className="w-full h-full">
          <SidebarPanel
            activeItem={activeItem}
            onItemClick={onItemClick}
            userProfile={userProfile}
            navItems={navItems}
            quickLinks={quickLinks}
            recentConversations={recentConversations}
            onSelectConversation={onSelectConversation}
            onNewChat={onNewChat}
            onDeleteConversation={onDeleteConversation}
            onPinConversation={onPinConversation}
            activeConversationId={activeConversationId}
            unreadMessagesCount={unreadMessagesCount}
            brandTitle={brandTitle}
          />
        </div>
      </aside>
    </>
  );
};

/** Floating semi-transparent two-line hamburger – shown on most pages */
export const FloatingMenuButton: React.FC<{
  onClick: () => void;
  visible?: boolean;
  className?: string;
}> = ({ onClick, visible = true, className = '' }) => {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open menu"
      className={`fixed top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-[110] w-10 h-10 rounded-full bg-white/70 dark:bg-black/50 backdrop-blur-md border border-black/5 dark:border-white/10 flex items-center justify-center text-neutral-800 dark:text-white hover:bg-white/90 dark:hover:bg-black/70 active:scale-95 transition-all md:hidden ${className}`}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 9h16M4 15h16" />
      </svg>
    </button>
  );
};

export default Sidebar;
