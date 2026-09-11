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
  overlayRef?: React.RefObject<HTMLDivElement | null>;
  sidebarRef?: React.RefObject<HTMLElement | null>;
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
  const showRecents = activeItem === 'chat' && Array.isArray(recentConversations);

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

      {showRecents ? (
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
      ) : (
        <div className="flex-1 min-h-0 flex flex-col mt-4 px-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="px-3 mb-2">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">Navigation</span>
          </div>
          <div className="space-y-0.5 pb-4">
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

  return (
    <>
      <div className={`fixed inset-0 z-[130] md:hidden ${isMobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div ref={overlayRef as any} className="absolute inset-0 bg-black/40" onClick={onCloseMobileSidebar} aria-hidden="true" />
        <aside 
          ref={sidebarRef as any}
          className={`absolute top-0 left-0 h-full w-[88vw] max-w-[360px] bg-white dark:bg-[#171717] shadow-2xl ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
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
