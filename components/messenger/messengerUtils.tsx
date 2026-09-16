import React from 'react';
import type { UserProfile } from '../../types';

export const REACTION_EMOJIS = ['🔥', '😂', '😍', '👏', '😮', '😭', '👍', '❤️'];

export const DoubleCheckIcon: React.FC<{ color?: string }> = ({ color = "#8696a0" }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="shrink-0 transition-colors duration-200">
    <path d="M12.83 5.33L7.33 10.83L5.17 8.67" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15.83 5.33L10.33 10.83L9.5 10" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const AttachmentIcon: React.FC = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 018.49 8.49l-9.19 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
  </svg>
);

export const CameraIcon: React.FC = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const SendIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

export const TrashIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const LockIcon: React.FC<{ locked: boolean }> = ({ locked }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {locked ? (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ) : (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      </>
    )}
  </svg>
);

export const formatLastSeen = (value?: number): string => {
  if (!value) return 'Offline';
  const diff = Date.now() - value;
  if (diff < 60000) return 'Online';
  if (diff < 3600000) return `Last seen ${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `Last seen ${Math.floor(diff / 3600000)}h ago`;
  return `Last seen ${new Date(value).toLocaleDateString()}`;
};

export const formatChatTimestamp = (ts?: number): string => {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export const getUnreadCount = (chat: any): number => Number(chat?.unreadCount || 0);

export const getLastMessagePreview = (chat: any): string => {
  if (!chat?.last_message) return 'Tap to send a message';
  const msg = chat.last_message;
  if (msg.text) return msg.text;
  if (msg.mediaUrl || msg.imageUrl) return '📷 Photo';
  if (msg.audioUrl || msg.voiceUrl) return '🎤 Voice message';
  return 'Tap to open chat';
};

export const getLastMessageSenderId = (chat: any): string =>
  chat?.last_message?.senderId || chat?.last_message?.sender_id || '';

export const createFallbackChatUser = (uid = ''): UserProfile => ({
  uid,
  display_name: 'Chat Mates',
  email: '',
  photo_url: '',
  xp: 0,
  level: 1,
  streak: 0,
  created_at: Date.now(),
  use_personal_token: false,
  subscription_status: 'free',
});

export const ensureArray = <T = any>(val: any): T[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
};

export const MESSENGER_CACHE_VERSION = 'v1';
export const getMessengerCacheKey = (uid: string, suffix: string) =>
  `avelut_messenger_${MESSENGER_CACHE_VERSION}_${uid}_${suffix}`;

export const resolveDisplayImageUrl = (url: string): string => {
  if (!url) return '';
  if (url.startsWith('file://') || url.startsWith('content://')) {
    try {
      const cap = (window as any).Capacitor;
      if (cap?.convertFileSrc) {
        return cap.convertFileSrc(url);
      }
    } catch {}
  }
  return url;
};

export const resolveImageDisplayUrl = (msg: any): string => {
  if (!msg) return '';

  const candidates = [
    msg.mediaUrl,
    msg.media_url,
    msg.imageUrl,
    msg.image_url,
    msg.localPreviewUrl,
    msg.local_preview_url,
  ];

  for (const cand of candidates) {
    if (cand && typeof cand === 'string' && cand.trim().length > 0) {
      if (cand.startsWith('http://') || cand.startsWith('https://')) {
        return cand;
      }
    }
  }

  for (const cand of candidates) {
    if (cand && typeof cand === 'string' && cand.trim().length > 0) {
      return resolveDisplayImageUrl(cand);
    }
  }

  if (typeof msg.text === 'string' && msg.text.includes('![')) {
    const match = msg.text.match(/!\[.*?\]\((.*?)\)/);
    if (match && match[1]) {
      return resolveDisplayImageUrl(match[1]);
    }
  }

  return '';
};

export const extractImageCaption = (rawText: string): string => {
  if (!rawText) return '';
  const cleaned = rawText.replace(/!\[.*?\]\(.*?\)/g, '').trim();
  return cleaned;
};

export const generateMicroThumbnail = (blob: Blob): Promise<string> => {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 24, 24);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.2);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
          return;
        }
        URL.revokeObjectURL(url);
        resolve('');
      };
      img.onerror = () => resolve('');
      img.src = url;
    } catch {
      resolve('');
    }
  });
};
