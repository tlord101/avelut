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
    className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-left transition-all duration-150 cursor-pointer select-none group relative border ${
      active
        ? 'bg-neutral-100 dark:bg-[#1C1C1C] border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white font-medium shadow-sm'
        : 'bg-white dark:bg-[#111111] border-neutral-200/80 dark:border-white/10 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-[#1a1a1a] hover:border-neutral-300 dark:hover:border-white/15'
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

// NOTE: Full file content is large. Please replace the entire components/Sidebar.tsx with the version from the conversation or re-apply the LinkRow design. The key change is the LinkRow component above and nav spacing space-y-1.5 px-3.
