import React, { useRef } from 'react';
import type { NavItem, UserProfile, ChatConversation } from '../types';
import { navigationItems, adminNavigationItems } from '../constants';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';

interface SidebarProps {
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
  activeConversationId?: string | null;
  quickLinks?: NavItem[];
  brandTitle?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const timeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const LinkRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
}> = ({ icon, label, active, onClick, badge }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
      active
        ? 'bg-neutral-100 dark:bg-white/10 text-neutral-900 dark:text-white font-medium'
        : 'text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-white/5'
    }`}
  >
    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-neutral-700 dark:text-neutral-300">
      {icon}
    </span>
    <span className="text-[15px] truncate flex-1">{label}</span>
    {badge != null && badge > 0 && (
      <span className="bg-neutral-900 text-white text-[10px] font-bold rounded-full h-5 min-w-5 px-1.5 flex items-center justify-center">
        {badge > 99 ? '99+' : badge}
      </span>
    )}
  </button>
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
  activeConversationId,
  unreadMessagesCount,
  brandTitle,
  onClose,
}) => {
  const links = quickLinks && quickLinks.length > 0 ? quickLinks : navItems;
  const showRecents = Array.isArray(recentConversations) && (activeItem === 'chat' || !!onSelectConversation);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#171717] text-neutral-900 dark:text-white">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{brandTitle}</h1>
        <div className="flex items-center gap-1">
          <button type="button" className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10" aria-label="Search">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 transition cursor-pointer"
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

      <nav className="px-2 flex-shrink-0 space-y-0.5">
        {links.map((item) => (
          <LinkRow
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={activeItem === item.id}
            onClick={() => onItemClick(item.id)}
            badge={item.id === 'messenger' ? unreadMessagesCount : undefined}
          />
        ))}
      </nav>

      {showRecents && (
        <div className="flex-1 min-h-0 flex flex-col mt-5 px-2">
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-[13px] font-medium text-neutral-500 dark:text-neutral-400">Recents</span>
            {onNewChat && (
              <button type="button" onClick={onNewChat} className="text-[12px] font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">New</button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden space-y-0.5 pb-4">
            {(!recentConversations || recentConversations.length === 0) ? (
              <p className="px-3 py-6 text-[13px] text-neutral-400 text-center">Your history will appear here.</p>
            ) : (
              recentConversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConversation?.(c.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                    activeConversationId === c.id
                      ? 'bg-neutral-100 dark:bg-white/10'
                      : 'hover:bg-neutral-50 dark:hover:bg-white/5'
                  }`}
                >
                  <span className="block text-[14px] text-neutral-800 dark:text-neutral-100 truncate leading-snug">{c.title || 'New Chat'}</span>
                  <span className="block text-[11px] text-neutral-400 mt-0.5">{timeAgo(c.last_updated_at)}</span>
                </button>
              ))
            )}
            {recentConversations && recentConversations.length > 8 && (
              <button type="button" onClick={() => onItemClick('history')} className="w-full text-left px-3 py-2 text-[13px] text-neutral-400 hover:text-neutral-600">See all…</button>
            )}
          </div>
        </div>
      )}

      {!showRecents && <div className="flex-1" />}

      <div className="flex-shrink-0 px-3 pb-4 pt-2 border-t border-neutral-100 dark:border-white/10 space-y-3">
        {onNewChat && activeItem === 'chat' && (
          <button type="button" onClick={onNewChat} className="w-full flex items-center justify-center gap-2 h-11 rounded-full bg-[#0066FF] text-white text-[15px] font-medium shadow-sm active:scale-[0.98] transition-transform">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Chat
          </button>
        )}
        <button type="button" onClick={() => onItemClick('settings')} className="w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors text-left">
          <Avatar display_name={userProfile?.display_name || null} photo_url={userProfile?.photo_url} className="w-9 h-9 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium truncate flex items-center gap-1">
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
  activeConversationId,
  quickLinks,
  brandTitle = 'Avelut',
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

  const sidebarTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleSidebarTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    sidebarTouchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleSidebarTouchMove = (e: React.TouchEvent) => {
    if (!sidebarTouchStartRef.current) return;
    const diffX = e.touches[0].clientX - sidebarTouchStartRef.current.x;
    const diffY = e.touches[0].clientY - sidebarTouchStartRef.current.y;
    // Sliding to the left on the drawer to close
    if (diffX < -45 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
      sidebarTouchStartRef.current = null;
      onCloseMobileSidebar();
    }
  };

  const handleSidebarTouchEnd = () => {
    sidebarTouchStartRef.current = null;
  };

  return (
    <>
      <div className={`fixed inset-0 z-[130] transition-opacity duration-300 md:hidden ${isMobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/40" onClick={onCloseMobileSidebar} aria-hidden="true" />
        <aside 
          className={`absolute top-0 left-0 h-full w-[min(300px,86vw)] bg-white dark:bg-[#171717] shadow-2xl transform transition-transform duration-300 ease-out ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
          onTouchStart={handleSidebarTouchStart}
          onTouchMove={handleSidebarTouchMove}
          onTouchEnd={handleSidebarTouchEnd}
        >
          <SidebarPanel
            activeItem={activeItem}
            onItemClick={handleMobileItemClick}
            userProfile={userProfile}
            navItems={navItems}
            quickLinks={quickLinks}
            recentConversations={recentConversations}
            onSelectConversation={(id) => { onSelectConversation?.(id); onCloseMobileSidebar(); }}
            onNewChat={() => { onNewChat?.(); onCloseMobileSidebar(); }}
            activeConversationId={activeConversationId}
            unreadMessagesCount={unreadMessagesCount}
            brandTitle={brandTitle}
            onClose={onCloseMobileSidebar}
          />
        </aside>
      </div>

      <aside className="hidden md:flex flex-shrink-0 w-[280px] h-full border-r border-neutral-200 dark:border-white/10 bg-white dark:bg-[#171717]">
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
      className={`fixed top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-[110] w-10 h-10 rounded-full bg-white/70 dark:bg-black/50 backdrop-blur-md border border-black/5 dark:border-white/10 shadow-sm flex items-center justify-center text-neutral-800 dark:text-white hover:bg-white/90 dark:hover:bg-black/70 active:scale-95 transition-all md:hidden ${className}`}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 9h16M4 15h16" />
      </svg>
    </button>
  );
};
