import React from 'react';
import type { Notification } from '../types';
import { StudyGuideIcon } from '../components/icons/StudyGuideIcon';
import { NotificationBellIcon } from '../components/icons/NotificationBellIcon';

export const timeAgo = (timestamp: number): string => {
  const now = Date.now();
  const seconds = Math.floor((now - timestamp) / 1000);

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const normalizeRouteTarget = (route: string): string => {
  const trimmed = route.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^\//, '')
    .replace(/\?.*$/, '')
    .replace(/-/g, '_');
};

const isKnownRouteTarget = (route: string): boolean => {
  return new Set([
    'chat',
    'study_guide',
    'messenger',
    'study_partners',
    'leaderboard',
    'visual_solver',
    'settings',
    'notifications',
  ]).has(route);
};

export const NotificationTypeIcon: React.FC<{ type: Notification['type']; className?: string }> = ({ type, className = "w-6 h-6" }) => {
  switch (type) {
    case 'welcome':
    case 'app_update':
    case 'general_info':
      return <img src="/logo_icon.png" alt="AVELUT" className={`${className} object-contain`} />;
    case 'study_update':
    case 'study_reminder':
      return <StudyGuideIcon className={className} />;
    case 'messenger':
    case 'study_partner_request':
    case 'personal':
      return <NotificationBellIcon className={className} />;
    default:
      return <NotificationBellIcon className={className} />;
  }
};

export const resolveNotificationRoute = (notification: Notification): string | null => {
  const candidates = [notification.route, notification.link];

  const navigateAction = notification.action_buttons?.find(button => button.action === 'navigate');
  const buttonRoute = (navigateAction as any)?.route || navigateAction?.metadata?.route;
  if (typeof buttonRoute === 'string' && buttonRoute.trim()) {
    candidates.push(buttonRoute);
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    const normalized = normalizeRouteTarget(candidate);
    if (isKnownRouteTarget(normalized)) return normalized;
    if (candidate.startsWith('/')) return candidate;
    return candidate;
  }

  switch (notification.type) {
    case 'study_update':
    case 'study_reminder':
      return 'study_guide';
    case 'exam_reminder':
      return 'exam';
    case 'study_partner_request':
      return 'study_partners';
    case 'messenger':
      return 'messenger';
    case 'app_update':
    case 'welcome':
    case 'general_info':
      return 'chat';
    case 'personal':
      return 'messenger';
    default:
      return 'chat';
  }
};
