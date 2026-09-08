import { auth, db, get, increment, limitToLast, off, onAuthStateChanged, onDisconnect, onValue, push, query, ref as dbRef, remove, serverTimestamp as firebaseServerTimestamp, set, storage, type FirebaseUser, update } from '@/lib/backend';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';
import { MessengerSkeleton } from './Skeleton';
import ReactMarkdown from 'react-markdown';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';
import { StreakBadge } from './StreakBadge';
import { Capacitor } from '@capacitor/core';
import { playBubbleSound, playReceiveSound } from '../utils/sound';
import { sourceToBlob, uploadBlobWithRetry, type SourceBlob } from '../utils/mediaUpload';
import { uploadToR2, isR2Configured } from '../services/cloudflareR2Service';
import { useTheme } from '../contexts/ThemeContext';
import { TypingIndicator } from './TypingIndicator';
import { getMultipleUserProfiles } from '../services/userProfileService';

const REACTION_EMOJIS = ['🔥', '😂', '😍', '👏', '😮', '😭', '👍', '❤️'];

// ================= REPLICA ICONS =================

const DoubleCheckIcon = ({ color = "#8696a0" }: { color?: string }) => (
  <i className="bi bi-check2-all inline-block text-base" style={{ color }} />
);

const AttachmentIcon = () => (
  <i className="bi bi-paperclip text-lg text-slate-500 dark:text-slate-400" />
);

const CameraIcon = () => (
  <i className="bi bi-camera text-lg text-slate-500 dark:text-slate-400" />
);

const SendIcon = () => (
  <i className="bi bi-send-fill text-base" />
);

const TrashIcon = () => (
  <i className="bi bi-trash text-lg text-rose-500" />
);

const LockIcon = ({ locked }: { locked: boolean }) => (
  <i className={`bi ${locked ? 'bi-lock-fill' : 'bi-unlock-fill'} text-lg text-slate-500 dark:text-slate-400`} />
);

const formatLastSeen = (value?: number) => {
  if (!value) return 'Last seen recently';
  const diffMs = Date.now() - value;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Last seen just now';
  if (diffMinutes < 60) return `Last seen ${diffMinutes}m ago`;
  if (diffHours < 24) return `Last seen ${diffHours}h ago`;
  if (diffDays < 7) return `Last seen ${diffDays}d ago`;
  return `Last seen ${new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};

const formatChatTimestamp = (ts?: number) => {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const getUnreadCount = (chat: any) => Number(chat?.unreadCount || 0);

const getLastMessagePreview = (chat: any) => {
  const text = chat?.last_message?.text;
  if (typeof text === 'string' && text.trim()) return text.trim();
  return 'New message';
};

const getLastMessageSenderId = (chat: any) => chat?.last_message?.senderId || chat?.last_message?.sender_id || '';

const createFallbackChatUser = (uid = ''): UserProfile => ({
  uid,
  display_name: 'Unknown user',
  photo_url: '',
  department_id: '',
  level: '',
  current_streak: 0,
  last_activity_date: Date.now(),
  notifications_enabled: false,
});

const ensureArray = <T = any>(val: any): T[] => {
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object') return Object.values(val) as T[];
  return [];
};

const MESSENGER_CACHE_VERSION = 'v1';

const getMessengerCacheKey = (uid: string, suffix: string) => `avelut_messenger_${MESSENGER_CACHE_VERSION}_${uid}_${suffix}`;

const resolveDisplayImageUrl = (url: string): string => {
  if (!url) return '';
  if (/^(content|file):\/\//i.test(url) && Capacitor.isNativePlatform()) {
    return Capacitor.convertFileSrc(url);
  }
  return url;
};

const resolveImageDisplayUrl = (msg: any): string => {
  if (!msg) return '';
  const rawText = typeof msg.text === 'string' ? msg.text : '';

  // 1. Valid http(s) URL from markdown: ![alt](https?://...)
  const httpMarkdownMatch = rawText.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/i);
  if (httpMarkdownMatch && httpMarkdownMatch[1]) {
    const matchedUrl = httpMarkdownMatch[1].trim();
    if (matchedUrl) return resolveDisplayImageUrl(matchedUrl);
  }

  // 2. Local preview URL on the optimistic message object
  if (msg.localPreviewUrl) {
    return resolveDisplayImageUrl(msg.localPreviewUrl);
  }

  // 3. Any blob / data / local URI from markdown: ![alt](blob:... or data:...)
  const anyMarkdownMatch = rawText.match(/!\[.*?\]\(([^)]+)\)/i);
  if (anyMarkdownMatch && anyMarkdownMatch[1]) {
    const matchedUrl = anyMarkdownMatch[1].trim();
    if (matchedUrl) return resolveDisplayImageUrl(matchedUrl);
  }

  // 4. Standalone URL fallback
  const urlMatch = rawText.match(/(https?:\/\/[^\s)]+|blob:[^\s)]+|data:image\/[^\s)]+|file:\/\/[^\s)]+|content:\/\/[^\s)]+)/i);
  if (urlMatch && urlMatch[1]) {
    return resolveDisplayImageUrl(urlMatch[1]);
  }

  return '';
};

const extractImageCaption = (rawText: string): string => {
  if (!rawText) return '';
  return rawText.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
};

/**
 * WhatsApp-style Micro Thumbnail generator (< 400 bytes, 32px JPEG)
 * Embeds instantly inside chat signal payload for 0ms blur placeholder rendering.
 */
const generateMicroThumbnail = (blob: Blob): Promise<string> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      resolve('');
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxDim = 32;
        let w = img.width || 32;
        let h = img.height || 32;
        if (w > h) {
          h = Math.max(1, Math.round((h * maxDim) / w));
          w = maxDim;
        } else {
          w = Math.max(1, Math.round((w * maxDim) / h));
          h = maxDim;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.35));
        } else {
          resolve('');
        }
      } catch (e) {
        resolve('');
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };
    img.src = url;
  });
};

/**
 * WhatsApp-style Progressive Image Bubble:
 * Displays microThumbnail instantly with blur, then smoothly fades in the full CDN image.
 */
const ProgressiveImageBubble: React.FC<{
  src: string;
  microThumbnail?: string;
  isUploading?: boolean;
  onPreview: (url: string) => void;
}> = ({ src, microThumbnail, isUploading = false, onPreview }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div
      className="relative overflow-hidden rounded-[20px] max-w-[340px] sm:max-w-[440px] md:max-w-[500px] w-full min-h-[200px] max-h-[380px] sm:max-h-[460px] bg-black/5 dark:bg-white/5 cursor-pointer select-none flex items-center justify-center shadow-xs"
      onClick={() => onPreview(src || microThumbnail || '')}
    >
      {/* 1. Micro Thumbnail (Instant 0ms blur placeholder from chat payload) */}
      {microThumbnail && !isLoaded && (
        <img
          src={microThumbnail}
          alt=""
          className="absolute inset-0 w-full h-full object-cover filter blur-md scale-110 pointer-events-none transition-opacity duration-300"
        />
      )}

      {/* 2. Full High-Res CDN image */}
      {src ? (
        <img
          src={src}
          alt=""
          onLoad={() => setIsLoaded(true)}
          className={`w-full h-auto max-h-[380px] sm:max-h-[460px] object-cover transition-opacity duration-300 ${
            isLoaded ? 'opacity-100' : microThumbnail ? 'opacity-0' : 'opacity-100'
          }`}
        />
      ) : !microThumbnail ? (
        <div className="h-[200px] w-full flex flex-col items-center justify-center text-xs text-neutral-400 gap-2 font-medium">
          <svg className="animate-spin h-6 w-6 text-[#009EE2]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Loading image...</span>
        </div>
      ) : null}

      {/* 3. WhatsApp-style sending badge */}
      {isUploading && (
        <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px] flex items-center justify-center z-10">
          <div className="flex items-center gap-2.5 bg-black/75 text-white text-xs font-semibold px-4 py-2 rounded-full backdrop-blur-md shadow-lg">
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Sending image...</span>
          </div>
        </div>
      )}
    </div>
  );
};

// =======================================================
// FUNCTIONAL VOICE NOTE PLAYER COMPONENT
// =======================================================

const VoiceNotePlayer: React.FC<{ src: string; isMe: boolean; isUploading?: boolean }> = ({ src, isMe, isUploading = false }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    if (isUploading || !src || typeof src !== 'string') return;
    const audio = new Audio(src);
    audioRef.current = audio;

    const setAudioData = () => setDuration(audio.duration || 0);
    const setAudioTime = () => setCurrentTime(audio.currentTime);
    const setAudioEnded = () => setIsPlaying(false);

    audio.addEventListener('loadedmetadata', setAudioData);
    audio.addEventListener('timeupdate', setAudioTime);
    audio.addEventListener('ended', setAudioEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', setAudioData);
      audio.removeEventListener('timeupdate', setAudioTime);
      audio.removeEventListener('ended', setAudioEnded);
    };
  }, [src, isUploading]);

  const togglePlay = () => {
    if (isUploading || !audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.error("Audio playback failed:", err));
    }
    setIsPlaying(!isPlaying);
  };

  const handleSpeedChange = () => {
    if (isUploading || !audioRef.current) return;
    let nextRate = 1;
    if (playbackRate === 1) nextRate = 1.5;
    else if (playbackRate === 1.5) nextRate = 2;
    audioRef.current.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || time === 0) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2 w-full min-w-[200px] sm:min-w-[240px] max-w-full py-0.5 select-none">
      <button
        type="button"
        onClick={togglePlay}
        disabled={isUploading}
        className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full transition shrink-0 ${isMe ? 'bg-black/20 text-white hover:bg-black/30' : 'bg-[#F8F9FA] dark:bg-[#000000] text-[#009EE2] dark:text-white hover:bg-[#E9ECEF] dark:hover:bg-white/10'
          } ${isUploading ? 'cursor-not-allowed' : ''}`}
      >
        {isUploading ? (
          <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : isPlaying ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1 justify-center pr-1 min-w-0">
        <div className="w-full flex items-center gap-[2px] h-[18px] relative">
          {[35, 60, 45, 75, 30, 55, 70, 40, 65, 50, 80, 35, 60, 45, 70, 40, 55, 30].map((barHeight, idx, arr) => {
            const barProgress = (idx / arr.length) * 100;
            const isPlayed = progressPercent >= barProgress;
            return (
              <div
                key={idx}
                className="flex-1 rounded-full transition-colors duration-150"
                style={{
                  height: `${barHeight}%`,
                  backgroundColor: isUploading
                    ? (isMe ? 'rgba(255,255,255,0.2)' : '#E9ECEF')
                    : isPlayed
                      ? (isMe ? '#FFFFFF' : '#009EE2')
                      : (isMe ? 'rgba(255,255,255,0.3)' : '#E9ECEF')
                }}
              />
            );
          })}
        </div>

        <div className={`flex justify-between items-center text-[10px] font-medium ${isMe ? 'text-white/80' : 'text-[#6C757D] dark:text-gray-400'}`}>
          <span>{isUploading ? "Uploading..." : formatTime(isPlaying ? currentTime : duration)}</span>
          <button
            type="button"
            onClick={handleSpeedChange}
            disabled={isUploading}
            className={`px-1 py-0 rounded text-[9px] font-bold border transition ${isMe ? 'border-white/30 hover:bg-white dark:bg-black/10' : 'border-[#E9ECEF] dark:border-transparent hover:bg-neutral-100'
              } ${isUploading ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
};

// Standalone Partner Management Modal Component
interface PartnerManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: 'mates' | 'find_requests';
  setActiveTab: (tab: 'mates' | 'find_requests') => void;
  subView: 'all' | 'incoming' | 'sent';
  setSubView: (subView: 'all' | 'incoming' | 'sent') => void;
  allUsers: UserProfile[];
  studyPartners: Record<string, boolean>;
  partnerRequests: Record<string, any>;
  onOpenChat: (user: UserProfile) => void;
  sendPartnerRequest: (user: UserProfile) => Promise<void>;
  acceptPartnerRequest: (user: UserProfile) => Promise<void>;
  declinePartnerRequest: (user: UserProfile) => Promise<void>;
  cancelPartnerRequest: (user: UserProfile) => Promise<void>;
  onNavigate?: (route: string) => void;
}

const PartnerManagementModal: React.FC<PartnerManagementModalProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  subView,
  setSubView,
  allUsers,
  studyPartners,
  partnerRequests,
  onOpenChat,
  sendPartnerRequest,
  acceptPartnerRequest,
  declinePartnerRequest,
  cancelPartnerRequest,
  onNavigate,
}) => {
  const [matesSearch, setMatesSearch] = useState('');
  const [discoverySearch, setDiscoverySearch] = useState('');

  const currentUserId = auth.currentUser?.uid || '';
  const safeAllUsers = useMemo(() => ensureArray<UserProfile>(allUsers), [allUsers]);
  const safeStudyPartners = useMemo(() => (studyPartners && typeof studyPartners === 'object' && !Array.isArray(studyPartners)) ? studyPartners : {}, [studyPartners]);
  const safePartnerRequests = useMemo(() => (partnerRequests && typeof partnerRequests === 'object' && !Array.isArray(partnerRequests)) ? partnerRequests : {}, [partnerRequests]);

  const studyMatesList = useMemo(() => {
    const list = safeAllUsers.filter(u => u && safeStudyPartners[u.uid] === true);
    if (!matesSearch.trim()) return list;
    const q = matesSearch.toLowerCase();
    return list.filter(u =>
      (u?.display_name || '').toLowerCase().includes(q) ||
      (u?.department_id || '').toLowerCase().includes(q)
    );
  }, [safeAllUsers, safeStudyPartners, matesSearch]);

  const receivedRequests = useMemo(() => {
    return Object.values(safePartnerRequests).filter((req: any) => req?.status === 'received');
  }, [safePartnerRequests]);

  const sentRequests = useMemo(() => {
    return Object.values(safePartnerRequests).filter((req: any) => req?.status === 'sent');
  }, [safePartnerRequests]);

  const discoveryUsers = useMemo(() => {
    let list = safeAllUsers.filter(u => u && u.uid !== currentUserId);
    if (discoverySearch.trim()) {
      const q = discoverySearch.toLowerCase();
      list = list.filter(u =>
        (u?.display_name || '').toLowerCase().includes(q) ||
        (u?.department_id || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [safeAllUsers, currentUserId, discoverySearch]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-3 sm:p-6 animate-fade-in select-none">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col h-[85vh] max-h-[720px] animate-scale-in">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 shrink-0">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white">Study Partner Hub</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mt-0.5">Manage your network and connections</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300 text-sm font-bold transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Main Tab Switcher */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 shrink-0 gap-2">
          <button
            onClick={() => setActiveTab('mates')}
            className={`flex-1 py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
              activeTab === 'mates'
                ? 'bg-white dark:bg-slate-800 text-[#009EE2] dark:text-white shadow-sm border border-slate-200/60 dark:border-slate-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <i className="bi bi-people-fill text-base"></i>
            <span>Study Mates</span>
            <span className="ml-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 font-semibold">
              {Object.keys(safeStudyPartners).filter(k => safeStudyPartners[k] === true).length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('find_requests')}
            className={`flex-1 py-2.5 px-4 rounded-2xl text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer relative ${
              activeTab === 'find_requests'
                ? 'bg-white dark:bg-slate-800 text-[#009EE2] dark:text-white shadow-sm border border-slate-200/60 dark:border-slate-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <i className="bi bi-[#009EE2] bi-person-plus-fill text-base"></i>
            <span>Find & Requests</span>
            {receivedRequests.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black animate-pulse">
                {receivedRequests.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-white dark:bg-slate-900 min-h-0">
          {activeTab === 'mates' ? (
            <div className="flex flex-col h-full gap-4">
              {/* Quick Search Bar for Mates */}
              <div className="relative shrink-0">
                <input
                  type="text"
                  placeholder="Filter study mates by name or department..."
                  value={matesSearch}
                  onChange={(e) => setMatesSearch(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 pl-10 pr-9 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-[#009EE2]/30 focus:border-[#009EE2] transition shadow-sm"
                />
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </div>
                {matesSearch && (
                  <button
                    onClick={() => setMatesSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs w-5 h-5 flex items-center justify-center rounded-full"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Study Mates List */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {studyMatesList.length === 0 ? (
                  <div className="text-center py-12 px-4 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                    <span className="text-3xl block mb-2">🎓</span>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {matesSearch ? 'No study mates match your search' : 'No study mates added yet'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {matesSearch ? 'Try adjusting your search terms.' : 'Switch to "Find & Requests" tab to search and connect with peers!'}
                    </p>
                  </div>
                ) : (
                  studyMatesList.map(u => (
                    <div
                      key={u.uid}
                      onClick={() => onOpenChat(u)}
                      className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-slate-950/60 hover:bg-[#009EE2]/5 dark:hover:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl transition cursor-pointer group"
                    >
                      <Avatar
                        className="w-11 h-11 rounded-full shrink-0 object-cover border border-slate-200 dark:border-slate-700"
                        photo_url={u.photo_url}
                        display_name={u.display_name || 'User'}
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                          <span>{u.display_name}</span>
                          <VerificationBadge status={u.subscription_status} />
                          <StreakBadge userProfile={u} size="sm" />
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">
                          {u.department_id ? u.department_id.replace(/_/g, ' ') : 'Student'}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-xs font-bold text-[#009EE2] dark:text-[#F8F9FA] bg-[#009EE2]/10 dark:bg-[#009EE2]/20 px-3 py-1.5 rounded-xl flex items-center gap-1.5 group-hover:bg-[#009EE2] group-hover:text-white transition-colors">
                          <span>Message</span>
                          <i className="bi bi-chat-fill text-xs"></i>
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full gap-5">
              {/* Top Action Pills / Badges */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  onClick={() => setSubView(subView === 'incoming' ? 'all' : 'incoming')}
                  className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
                    subView === 'incoming'
                      ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>Incoming Requests</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${subView === 'incoming' ? 'bg-white text-rose-600' : 'bg-rose-500 text-white'}`}>
                    {receivedRequests.length}
                  </span>
                </button>

                <button
                  onClick={() => setSubView(subView === 'sent' ? 'all' : 'sent')}
                  className={`px-3.5 py-2 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 border cursor-pointer ${
                    subView === 'sent'
                      ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>Sent Requests</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${subView === 'sent' ? 'bg-white text-amber-600' : 'bg-amber-500 text-white'}`}>
                    {sentRequests.length}
                  </span>
                </button>

                {subView !== 'all' && (
                  <button
                    onClick={() => setSubView('all')}
                    className="px-3 py-2 rounded-2xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline cursor-pointer"
                  >
                    Show All
                  </button>
                )}
              </div>

              {/* Sub-view Lists or Discovery Section */}
              {subView === 'incoming' ? (
                <div className="flex-1 overflow-y-auto space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Incoming Partner Requests ({receivedRequests.length})
                  </h3>
                  {receivedRequests.length === 0 ? (
                    <div className="text-center py-10 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                      <p className="text-xs font-bold text-slate-500 dark:text-slate-400">No incoming partner requests right now.</p>
                    </div>
                  ) : (
                    receivedRequests.map((req: any) => {
                      const sender = discoveryUsers.find(u => u.uid === req.senderId) || createFallbackChatUser(req.senderId);
                      return (
                        <div key={req.senderId} className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-2xl">
                          <Avatar className="w-11 h-11 rounded-full shrink-0 object-cover" photo_url={sender.photo_url} display_name={req.senderName || sender.display_name || 'User'} />
                          <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">{req.senderName || sender.display_name || 'User'}</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">Wants to be study partners with you</p>
                          </div>
                          <div className="shrink-0 flex gap-2">
                            <button
                              onClick={() => void acceptPartnerRequest(sender)}
                              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition shadow-sm cursor-pointer"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => void declinePartnerRequest(sender)}
                              className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-xl transition cursor-pointer"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : subView === 'sent' ? (
                <div className="flex-1 overflow-y-auto space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Sent Requests ({sentRequests.length})
                  </h3>
                  {sentRequests.length === 0 ? (
                    <div className="text-center py-10 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                      <p className="text-xs font-bold text-slate-500 dark:text-slate-400">No pending sent requests.</p>
                    </div>
                  ) : (
                    sentRequests.map((req: any) => {
                      const receiver = discoveryUsers.find(u => u.uid === req.receiverId) || createFallbackChatUser(req.receiverId);
                      return (
                        <div key={req.receiverId} className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-2xl">
                          <Avatar className="w-11 h-11 rounded-full shrink-0 object-cover" photo_url={receiver.photo_url} display_name={receiver.display_name || 'User'} />
                          <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate">{receiver.display_name || 'User'}</h4>
                            <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold truncate mt-0.5">Pending approval...</p>
                          </div>
                          <div className="shrink-0">
                            <button
                              onClick={() => void cancelPartnerRequest(receiver)}
                              className="px-3.5 py-1.5 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 hover:bg-amber-100 border border-amber-200 dark:border-amber-800/50 text-xs font-bold rounded-xl transition cursor-pointer"
                            >
                              Cancel Request
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                /* Search & Discovery Section */
                <div className="flex flex-col flex-1 min-h-0 gap-4">
                  <div className="relative shrink-0">
                    <input
                      type="text"
                      placeholder="Search users by name or department..."
                      value={discoverySearch}
                      onChange={(e) => setDiscoverySearch(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-950 text-sm font-medium text-slate-900 dark:text-white placeholder-slate-400 pl-10 pr-9 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-[#009EE2]/30 focus:border-[#009EE2] transition shadow-sm"
                    />
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                    </div>
                    {discoverySearch && (
                      <button
                        onClick={() => setDiscoverySearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs w-5 h-5 flex items-center justify-center rounded-full"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {discoveryUsers.length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">No users found matching "{discoverySearch}".</p>
                      </div>
                    ) : (
                      discoveryUsers.map((u) => {
                        const isPartner = studyPartners[u.uid] === true;
                        const req = partnerRequests[u.uid];

                        return (
                          <div
                            key={u.uid}
                            className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800/40 transition"
                          >
                            <Avatar
                              className="w-11 h-11 rounded-full shrink-0 object-cover border border-slate-200 dark:border-slate-700"
                              photo_url={u.photo_url}
                              display_name={u.display_name || 'User'}
                            />
                            <div className="min-w-0 flex-1">
                              <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate flex items-center gap-1.5">
                                <span>{u.display_name}</span>
                                <VerificationBadge status={u.subscription_status} />
                              </h4>
                              {u.department_id && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate mt-0.5">
                                  {u.department_id.replace(/_/g, ' ')}
                                </p>
                              )}
                            </div>

                            <div className="shrink-0 flex items-center gap-2">
                              {isPartner ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenChat(u)}
                                  className="px-3.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50 text-xs font-bold rounded-xl transition hover:bg-emerald-100 cursor-pointer"
                                >
                                  Connected (Message)
                                </button>
                              ) : req?.status === 'sent' ? (
                                <button
                                  type="button"
                                  onClick={() => void cancelPartnerRequest(u)}
                                  className="px-3.5 py-1.5 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 text-xs font-bold rounded-xl transition hover:bg-amber-100 cursor-pointer"
                                >
                                  Pending (Cancel)
                                </button>
                              ) : req?.status === 'received' ? (
                                <div className="flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void acceptPartnerRequest(u)}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void declinePartnerRequest(u)}
                                    className="px-2.5 py-1.5 bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl transition cursor-pointer"
                                  >
                                    Decline
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void sendPartnerRequest(u)}
                                  className="px-3.5 py-1.5 bg-[#009EE2] hover:bg-[#0070B8] text-white text-xs font-black uppercase tracking-wider rounded-xl transition shadow-sm cursor-pointer"
                                >
                                  Add Study Mate
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// =======================================================
// FLOATING ZOLA THEME INPUT COMPONENT
// =======================================================

interface AvelutInputProps {
  onSend: (text: string) => void;
  startRecording: (e: any) => Promise<void>;
  handleMove: (e: any) => void;
  stopRecording: (shouldSave: boolean) => void;
  isRecording: boolean;
  isLocked: boolean;
  setIsLocked: (locked: boolean) => void;
  recordDuration: number;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImageSendWithCaption?: (source: any, caption: string, mimeType?: string) => void;
  disabled?: boolean;
  onTyping?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

const AvelutMessageInput: React.FC<AvelutInputProps> = ({
  onSend,
  startRecording,
  handleMove,
  stopRecording,
  isRecording,
  isLocked,
  setIsLocked,
  recordDuration,
  onFileSelect,
  onImageSendWithCaption,
  disabled = false,
  onTyping,
  inputRef
}) => {
  const themeColor = '#0A101F'; // navy blue

  const [attachedImages, setAttachedImages] = useState<Array<{ source: any; previewUrl: string; mimeType: string }>>([]);

  const [message, setMessage] = useState("");
  const [showTrashAnimation, setShowTrashAnimation] = useState(false);
  const [showStickerPopup, setShowStickerPopup] = useState(false);

  const handleStickerClick = () => {
    setShowStickerPopup(true);
    setTimeout(() => setShowStickerPopup(false), 3000);
  };

  const [startY, setStartY] = useState(0);
  const [startX, setStartX] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleVoicePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (isLocked || disabled) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setStartX(e.clientX);
    setStartY(e.clientY);
    setCurrentX(e.clientX);
    setCurrentY(e.clientY);
    setIsSwiping(true);
    void startRecording(e);
  };

  const handleVoicePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isRecording || isLocked || disabled || !isSwiping) return;
    handleMove(e);

    setCurrentX(e.clientX);
    setCurrentY(e.clientY);

    const deltaY = e.clientY - startY;
    const deltaX = e.clientX - startX;
    if (deltaY < -80) {
      setIsLocked(true);
      setIsSwiping(false);
    } else if (deltaX < -110) {
      discardVoice();
    }
  };

  const handleVoicePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}
    if (!isSwiping) return;
    setIsSwiping(false);
    if (!isLocked) stopRecording(true);
  };

  const executeTextSend = () => {
    if ((message.trim() || attachedImages.length > 0) && !disabled) {
      if (attachedImages.length > 0 && onImageSendWithCaption) {
        attachedImages.forEach((img, idx) => {
          const caption = idx === 0 ? message.trim() : '';
          onImageSendWithCaption(img.source, caption, img.mimeType);
        });
        setAttachedImages([]);
      } else if (message.trim()) {
        onSend(message);
      }
      setMessage("");
    }
  };

  const discardVoice = () => {
    setShowTrashAnimation(true);
    setIsSwiping(false);
    stopRecording(false);
    setTimeout(() => setShowTrashAnimation(false), 1000);
  };

  const hasText = message.trim().length > 0;
  const swipeDeltaY = isSwiping ? Math.min(0, Math.max(-100, currentY - startY)) : 0;
  const swipeDeltaX = isSwiping ? Math.min(0, Math.max(-110, currentX - startX)) : 0;

  const handleInternalImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setAttachedImages(prev => [
              ...prev,
              {
                source: file,
                previewUrl: event.target!.result as string,
                mimeType: file.type || `image/${(file.name || '').split('.').pop() === 'png' ? 'png' : 'jpeg'}`
              }
            ]);
          }
        };
        reader.readAsDataURL(file);
      });
    }
    e.target.value = '';
  };

  return (
    <div className={`w-full relative select-none z-40 bg-transparent pb-2 pt-2 md:w-full md:mx-auto ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <input type="file" ref={fileInputRef} onChange={onFileSelect} className="hidden" multiple accept="*/*" />
      <input type="file" ref={imageInputRef} onChange={handleInternalImageSelect} className="hidden" accept="image/*" multiple />

      {isRecording && !isLocked && (
        <div
          className="absolute right-[19px] bottom-[70px] w-[46px] h-[130px] bg-white dark:bg-black rounded-full flex flex-col items-center justify-start py-4 gap-3 shadow-md z-20"
          style={{ transform: `translateY(${Math.max(-40, swipeDeltaY * 0.15)}px)` }}
        >
          <div className="flex items-center justify-center text-slate-500 dark:text-gray-400" style={{ transform: `translateY(${Math.max(-40, swipeDeltaY * 0.5)}px)` }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18 10v-3.5a6.5 6.5 0 0 0-13 0V10H4v11h16V10h-2zm-10-3.5a4.5 4.5 0 0 1 9 0V10H8V6.5z" /></svg>
          </div>
          <div className="text-slate-400 mt-2 animate-bounce">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
          </div>
        </div>
      )}

      <div className="w-full flex flex-col gap-2 relative">
        {attachedImages.length > 0 && (
          <div className="mx-2 mb-1 bg-white dark:bg-[#111111] rounded-2xl p-2 flex items-center gap-2 overflow-x-auto shadow-sm border border-slate-100 dark:border-white/5 relative [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {attachedImages.map((img, idx) => (
              <div key={idx} className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-black/5 relative shrink-0">
                <img src={img.previewUrl} alt={`Attachment ${idx + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute top-1 right-1 w-6 h-6 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center shadow-md z-10 transition cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="w-full flex items-end gap-2 relative">
          {!isRecording && !isLocked && (
            <div className="flex-1 min-h-[50px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl flex items-center px-1 shadow-sm transition-all focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500/50">
              <div className="relative flex items-center h-full">
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={handleStickerClick} className="hover:opacity-85 transition active:scale-90 flex items-center justify-center w-11 h-full text-slate-400">
                  <i className="bi bi-emoji-smile text-xl"></i>
                </button>
                {showStickerPopup && (
                  <div className="absolute -top-10 left-2 bg-slate-900 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap animate-fade-in z-50">
                    Coming soon
                    <div className="absolute -bottom-1 left-4 w-2 h-2 bg-slate-900 rotate-45"></div>
                  </div>
                )}
              </div>
              <div className="flex-1 h-full flex items-center min-w-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={message}
                  onChange={(e) => { setMessage(e.target.value); onTyping?.(); }}
                  onKeyDown={(e) => e.key === 'Enter' && executeTextSend()}
                  placeholder="Message"
                  className="w-full h-full bg-transparent text-[17px] text-slate-900 dark:text-white placeholder-slate-400 outline-none border-none focus:ring-0 pl-1 pr-2"
                />
              </div>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => fileInputRef.current?.click()} className="hover:opacity-85 transition active:scale-90 flex items-center justify-center w-10 h-full text-slate-400">
                <i className="bi bi-paperclip text-xl"></i>
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => imageInputRef.current?.click()} className="hover:opacity-85 transition active:scale-90 flex items-center justify-center w-11 h-full pr-1 text-slate-400">
                <i className="bi bi-image text-xl"></i>
              </button>
            </div>
          )}

          {isRecording && !isLocked && (
            <div className="flex-1 h-[50px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl flex items-center shadow-sm relative overflow-hidden">
              <div className="flex items-center h-full w-full">
                <div className="pl-5 w-20 text-[18px] text-slate-900 dark:text-white tabular-nums font-normal">
                  {formatTime(recordDuration)}
                </div>
                <div className="flex-1 flex items-center justify-end pr-14 z-10 transition-transform duration-75" style={{ transform: `translateX(${swipeDeltaX * 0.8}px)` }}>
                  <span className="text-[15px] font-normal text-slate-400 flex items-center gap-1.5">
                    <span className="inline-block font-bold text-lg text-slate-400">&lt;</span> Slide to cancel
                  </span>
                </div>
              </div>
              <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-slate-900/40 to-transparent w-24 pointer-events-none" />
            </div>
          )}

          {isLocked && (
            <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden flex flex-col justify-center py-2 px-2 h-[86px] shadow-sm relative">
              <div className="flex items-center justify-between mb-4 px-3 w-full">
                <span className="text-[17px] text-slate-900 dark:text-white tabular-nums font-normal">{formatTime(recordDuration)}</span>
                <div className="flex-1 mx-3 flex items-center gap-[3px]">
                  {[...Array(24)].map((_, i) => (
                    <div key={i} className="w-[3px] rounded-full bg-amber-500 animate-pulse" style={{ height: `${Math.max(4, Math.random() * 16)}px`, animationDelay: `${i * 0.05}s` }} />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between px-3 w-full">
                <button onClick={discardVoice} className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-500 active:scale-90 transition-transform cursor-pointer">
                  <i className="bi bi-trash text-lg"></i>
                </button>
                <button onClick={() => stopRecording(true)} className="w-8 h-8 rounded-full bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 flex items-center justify-center hover:scale-105 transition-transform cursor-pointer">
                  <i className="bi bi-send-fill text-xs"></i>
                </button>
              </div>
            </div>
          )}

          <div className={`shrink-0 ${isLocked ? 'hidden' : ''}`} style={{ transform: isSwiping ? `translate(${swipeDeltaX * 0.2}px, ${swipeDeltaY * 0.5}px)` : 'none', transition: isSwiping ? 'none' : 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
            {hasText || attachedImages.length > 0 ? (
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); executeTextSend(); }} className="w-[50px] h-[50px] text-white dark:text-slate-950 rounded-full flex items-center justify-center shadow-md transition-all hover:brightness-95 active:scale-95 duration-100 bg-slate-900 dark:bg-amber-500 cursor-pointer">
                <i className="bi bi-send-fill text-lg"></i>
              </button>
            ) : (
              <button
                type="button"
                onPointerDown={handleVoicePointerDown}
                onPointerMove={handleVoicePointerMove}
                onPointerUp={handleVoicePointerUp}
                onPointerCancel={handleVoicePointerUp}
                style={{ touchAction: 'none' }}
                className={`w-[50px] h-[50px] rounded-full flex items-center justify-center shadow-md transition-all duration-100 outline-none select-none touch-none cursor-pointer ${isRecording ? 'bg-rose-600 text-white scale-110' : 'bg-slate-900 dark:bg-amber-500 text-white dark:text-slate-950 hover:brightness-95 active:scale-95'}`}
              >
                <i className="bi bi-mic-fill text-xl"></i>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// MAIN UNIFORM LIGHT THEME MESSENGER
// ==========================================

export const Messenger: React.FC<{ userProfile: UserProfile; initialChatId?: string | null; onNavigate?: (tab: string) => void; setCustomHeaderConfig?: (config: any) => void }> = ({ userProfile, initialChatId = null, onNavigate, setCustomHeaderConfig }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [activeChat, setActiveChat] = useState<{ chatId: string, otherUser: UserProfile } | null>(null);
  const [chats, setChats] = useState<any[]>(() => ensureArray(readCachedJson<any[]>(getMessengerCacheKey(userProfile.uid, 'chats'), [])));
  const [allUsers, setAllUsers] = useState<UserProfile[]>(() => ensureArray<UserProfile>(readCachedJson<UserProfile[]>(getMessengerCacheKey(userProfile.uid, 'all_users'), [])));
  const [messages, setMessages] = useState<any[]>(() => ensureArray(readCachedJson<any[]>(getMessengerCacheKey(userProfile.uid, 'messages_default'), [])));
  const [isLoading, setIsLoading] = useState(() => (Array.isArray(chats) ? chats.length : 0) === 0 && (Array.isArray(allUsers) ? allUsers.length : 0) === 0);
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const [showDeleteChatConfirmDialog, setShowDeleteChatConfirmDialog] = useState(false);
  const [pinnedChatIds, setPinnedChatIds] = useState<Record<string, boolean>>(() => readCachedJson<Record<string, boolean>>(`avelut_pinned_chats_${userProfile.uid}`, {}));
  const [mutedChatIds, setMutedChatIds] = useState<Record<string, boolean>>(() => readCachedJson<Record<string, boolean>>(`avelut_muted_chats_${userProfile.uid}`, {}));
  const [showSelectedMenu, setShowSelectedMenu] = useState(false);
  const selectedMenuRef = useRef<HTMLDivElement>(null);
  const [isPartnerModalOpen, setIsPartnerModalOpen] = useState(false);
  const [partnerModalTab, setPartnerModalTab] = useState<'mates' | 'find_requests'>('mates');
  const [partnerModalSubView, setPartnerModalSubView] = useState<'all' | 'incoming' | 'sent'>('all');
  const [partnerMatesSearchQuery, setPartnerMatesSearchQuery] = useState("");
  const [discoverySearchQuery, setDiscoverySearchQuery] = useState("");
  const [isAppActive, setIsAppActive] = useState(() => typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  const [isRecording, setIsRecording] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [messageActionTarget, setMessageActionTarget] = useState<{
    id: string;
    senderId?: string;
    text?: string;
    type?: string;
    isUploading?: boolean;
    reactions?: Record<string, string>;
    replyTo?: any;
    is_forwarded?: boolean;
    timestamp?: number;
    isRead?: boolean;
  } | null>(null);
  const [messageActionPosition, setMessageActionPosition] = useState<{ x: number; y: number } | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
  const [fetchedUserProfiles, setFetchedUserProfiles] = useState<Record<string, UserProfile>>(() =>
    readCachedJson<Record<string, UserProfile>>(`avelut_resolved_profiles_${userProfile.uid}`, {})
  );
  const [showUserOptions, setShowUserOptions] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('spam');
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    id: string;
    senderId?: string;
  } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startYRef = useRef<number>(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior,
      });
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  }, []);

  // Listen to typing status for active chat
  useEffect(() => {
    if (!activeChat || !firebaseUser) return;
    const typingRef = dbRef(db, `chat_meta_data/${activeChat.chatId}/typing`);
    const unsub = onValue(typingRef, (snap) => {
      if (snap.exists()) {
        setChatStatuses(prev => ({ ...prev, [activeChat.chatId]: snap.val() }));
      } else {
        setChatStatuses(prev => {
          const newStatuses = { ...prev };
          delete newStatuses[activeChat.chatId];
          return newStatuses;
        });
      }
    });
    return () => unsub();
  }, [activeChat, firebaseUser]);

  const updateTypingStatus = (status: 'typing' | 'recording' | null) => {
    if (!activeChat || !firebaseUser) return;
    const typingRef = dbRef(db, `chat_meta_data/${activeChat.chatId}/typing/${firebaseUser.uid}`);
    if (status) {
      set(typingRef, status).catch(console.error);
    } else {
      remove(typingRef).catch(console.error);
    }
  };

  const textInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (replyingTo) {
      setTimeout(() => {
        textInputRef.current?.focus();
      }, 50);
    }
  }, [replyingTo]);

  const messageActionMenuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ id: string | null; time: number }>({ id: null, time: 0 });

  // Study Partners contact system states
  const [studyPartners, setStudyPartners] = useState<Record<string, boolean>>(() => readCachedJson<Record<string, boolean>>(getMessengerCacheKey(userProfile.uid, 'study_partners'), {}));
  const [partnerRequests, setPartnerRequests] = useState<Record<string, any>>(() => readCachedJson<Record<string, any>>(getMessengerCacheKey(userProfile.uid, 'partner_requests'), {}));

  // Forwarding states
  const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
  const [forwardTargetContent, setForwardTargetContent] = useState('');
  const [forwardTargetType, setForwardTargetType] = useState('text');

  // Image preview state
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Realtime active chats statuses (typing, recording)
  const [chatStatuses, setChatStatuses] = useState<Record<string, { isTyping?: boolean; isRecording?: boolean }>>({});

  // Ref for my typing timeout
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTypingStatus = (status: 'typing' | 'recording' | 'idle') => {
    if (!firebaseUser || !activeChat) return;
    const myId = firebaseUser.uid;
    const otherId = activeChat.otherUser.uid;
    const refPath = `user_chats/${otherId}/${activeChat.chatId}`;
    if (status === 'typing') {
      update(dbRef(db, refPath), { isTyping: true, isRecording: false });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => handleTypingStatus('idle'), 3000);
    } else if (status === 'recording') {
      update(dbRef(db, refPath), { isTyping: false, isRecording: true });
    } else {
      update(dbRef(db, refPath), { isTyping: false, isRecording: false });
    }
  };


  const chatRowLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeToReplyRef = useRef<{ id: string | null; startX: number; startY: number; currentX: number; currentY: number; moved: boolean }>({ id: null, startX: 0, startY: 0, currentX: 0, currentY: 0, moved: false });
  const suppressNextChatOpenRef = useRef(false);
  const unreadCountsRef = useRef<Record<string, number>>({});
  const lastNotificationTimestampRef = useRef<Record<string, number>>({});
  const { addToast } = useToast();

  const isBlocked = activeChat && userProfile?.blocked_users?.[activeChat.otherUser.uid];
  const isBlockingMe = activeChat && activeChat.otherUser.blocked_users?.[userProfile.uid];

  const closeMessageActions = () => {
    setTimeout(() => {
      setMessageActionTarget(null);
      setMessageActionPosition(null);
    }, 350); // Delay to prevent ghost clicks falling through to underlying elements on mobile
  };

  const handleBlockUser = async () => {
    if (!firebaseUser || !activeChat) return;
    try {
      const dbRefPath = `users/${firebaseUser.uid}/blocked_users/${activeChat.otherUser.uid}`;
      await set(dbRef(db, dbRefPath), true);
      addToast("User has been blocked.", "success");
      setShowUserOptions(false);
    } catch (err) {
      console.error("Failed to block user:", err);
      addToast("Failed to block user.", "error");
    }
  };

  const handleReportSubmit = async () => {
    if (!firebaseUser || !activeChat) return;
    try {
      const reportId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
      const reportRef = dbRef(db, `reports/${reportId}`);
      await set(reportRef, {
        id: reportId,
        reporter_uid: firebaseUser.uid,
        reported_uid: activeChat.otherUser.uid,
        chat_id: activeChat.chatId,
        reason: reportReason,
        timestamp: Date.now()
      });
      addToast("Report submitted successfully. Our team will review it.", "success");
      setShowReportModal(false);
      setShowUserOptions(false);
    } catch (err) {
      console.error("Failed to report user:", err);
      addToast("Failed to submit report.", "error");
    }
  };

  const showIncomingMessageNotification = async (chat: any, summaryText: string) => {
    if (typeof window === 'undefined') return;
    if (!userProfile.notifications_enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const title = chat?.otherUser?.display_name
      ? `New message from ${chat.otherUser.display_name}`
      : 'New message received';
    const options: any = {
      body: summaryText,
      icon: '/logo_icon.png',
      badge: '/badge.png',
      tag: `messenger-${chat?.id || 'chat'}`,
      renotify: true,
      data: {
        chatId: chat?.id || '',
      },
    };
    try {
      if ('serviceWorker' in navigator) {
        let registration = await navigator.serviceWorker.getRegistration();
        if (!registration) {
          registration = await navigator.serviceWorker.register('/service-worker.js');
        }
        if (registration?.showNotification) {
          await registration.showNotification(title, options);
          return;
        }
      }

      new Notification(title, options);
    } catch (error) {
      console.error('Failed to show messenger notification:', error);
    }
  };

  useEffect(() => {
    if (!messageActionTarget) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!messageActionMenuRef.current) return;
      if (event.target instanceof Node && !messageActionMenuRef.current.contains(event.target)) {
        closeMessageActions();
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMessageActions();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [messageActionTarget]);

  // Fetch all users for discovery search
  useEffect(() => {
    if (!firebaseUser) return;
    const usersRef = dbRef(db, 'users');
    const unsub = onValue(usersRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const list = Object.keys(data).map(uid => ({
          uid,
          display_name: data[uid].displayName || data[uid].display_name || 'User',
          photo_url: data[uid].photoURL || data[uid].photo_url || '',
          is_online: !!data[uid].is_online,
          last_seen: data[uid].last_seen || 0,
          department_id: data[uid].department_id || '',
          level: data[uid].level || '',
          current_streak: data[uid].current_streak || 0,
          last_activity_date: data[uid].last_activity_date || Date.now(),
          notifications_enabled: !!data[uid].notifications_enabled,
          subscription_status: data[uid].subscription_status || 'free',
          blocked_users: data[uid].blocked_users || {}
        })) as UserProfile[];
        setAllUsers(list);
      }
    });
    return () => unsub();
  }, [firebaseUser]);

  const safeChats = useMemo(() => ensureArray(chats), [chats]);
  const safeAllUsers = useMemo(() => ensureArray<UserProfile>(allUsers), [allUsers]);
  const safeStudyPartners = useMemo(() => (studyPartners && typeof studyPartners === 'object' && !Array.isArray(studyPartners)) ? studyPartners : {}, [studyPartners]);
  const safePartnerRequests = useMemo(() => (partnerRequests && typeof partnerRequests === 'object' && !Array.isArray(partnerRequests)) ? partnerRequests : {}, [partnerRequests]);

  const activeChats = useMemo(() => {
    let list = safeChats.filter(c => {
      if (!c) return false;
      const partnerId = c.otherUserId || c.otherUser?.uid;
      return safeStudyPartners[partnerId] === true;
    });
    if (chatSearchQuery.trim()) {
      const queryLower = chatSearchQuery.toLowerCase();
      list = list.filter(c => {
        if (!c) return false;
        const name = (c.otherUser?.display_name || '').toLowerCase();
        const dept = (c.otherUser?.department_id || '').toLowerCase();
        const lastMsg = (getLastMessagePreview(c)).toLowerCase();
        return name.includes(queryLower) || dept.includes(queryLower) || lastMsg.includes(queryLower);
      });
    }
    return list.sort((a, b) => {
      const aPinned = pinnedChatIds[a?.id] ? 1 : 0;
      const bPinned = pinnedChatIds[b?.id] ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return (Number(b?.timestamp) || 0) - (Number(a?.timestamp) || 0);
    });
  }, [safeChats, safeStudyPartners, chatSearchQuery, pinnedChatIds]);

  const confirmedStudyPartnersList = useMemo(() => {
    const list = safeAllUsers.filter(u => u && safeStudyPartners[u.uid] === true);
    if (!partnerMatesSearchQuery.trim()) return list;
    const q = partnerMatesSearchQuery.toLowerCase();
    return list.filter(u =>
      (u?.display_name || '').toLowerCase().includes(q) ||
      (u?.department_id || '').toLowerCase().includes(q)
    );
  }, [safeAllUsers, safeStudyPartners, partnerMatesSearchQuery]);

  const receivedRequestsList = useMemo(() => {
    return Object.values(safePartnerRequests).filter((req: any) => req?.status === 'received');
  }, [safePartnerRequests]);

  const sentRequestsList = useMemo(() => {
    return Object.values(safePartnerRequests).filter((req: any) => req?.status === 'sent');
  }, [safePartnerRequests]);

  const pendingIncomingCount = receivedRequestsList.length;

  const discoveryUsersList = useMemo(() => {
    let list = safeAllUsers.filter(u => u && u.uid !== firebaseUser?.uid);
    if (discoverySearchQuery.trim()) {
      const q = discoverySearchQuery.toLowerCase();
      list = list.filter(u =>
        (u?.display_name || '').toLowerCase().includes(q) ||
        (u?.department_id || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [safeAllUsers, discoverySearchQuery, firebaseUser]);

  const userMap = useMemo(() => new Map(safeAllUsers.filter(user => user && user.uid).map(user => [user.uid, user])), [safeAllUsers]);

  const userMapRef = useRef(userMap);
  const fetchedUserProfilesRef = useRef(fetchedUserProfiles);

  useEffect(() => {
    userMapRef.current = userMap;
  }, [userMap]);

  useEffect(() => {
    fetchedUserProfilesRef.current = fetchedUserProfiles;
  }, [fetchedUserProfiles]);

  const selectedChatUser = activeChat?.otherUser || createFallbackChatUser(activeChat?.chatId || '');

  const getUnreadCountForUser = useCallback((otherUserId: string) => {
    if (!firebaseUser) return 0;
    const chatId = [firebaseUser.uid, otherUserId].sort().join('_');
    const chat = safeChats.find(item => item?.id === chatId);
    return chat ? getUnreadCount(chat) : 0;
  }, [safeChats, firebaseUser]);

  const ensureChatThreadRecord = useCallback(async (otherUser: UserProfile) => {
    if (!firebaseUser) return null;
    const chatId = [firebaseUser.uid, otherUser.uid].sort().join('_');
    const currentThreadRef = dbRef(db, `user_chats/${firebaseUser.uid}/${chatId}`);
    const recipientThreadRef = dbRef(db, `user_chats/${otherUser.uid}/${chatId}`);
    const snapshot = await get(currentThreadRef);
    const recipientSnapshot = await get(recipientThreadRef);
    const now = Date.now();

    if (!snapshot.exists()) {
      await set(currentThreadRef, {
        otherUserId: otherUser.uid,
        timestamp: now,
        unreadCount: 0,
        last_message: {
          text: 'Start a conversation',
          senderId: firebaseUser.uid,
          timestamp: now,
          type: 'text',
        },
      });
    }

    if (!recipientSnapshot.exists()) {
      await set(recipientThreadRef, {
        otherUserId: firebaseUser.uid,
        timestamp: now,
        unreadCount: 0,
        last_message: {
          text: 'Start a conversation',
          senderId: firebaseUser.uid,
          timestamp: now,
          type: 'text',
        },
      });
    }

    return chatId;
  }, [firebaseUser]);

  const openChatWithUser = useCallback((otherUser: UserProfile) => {
    if (!firebaseUser) return;

    const chatId = [firebaseUser.uid, otherUser.uid].sort().join('_');
    setActiveChat({ chatId, otherUser });

    void ensureChatThreadRecord(otherUser);
  }, [ensureChatThreadRecord, firebaseUser]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      setFirebaseUser(user);
      setIsLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    const partnersRef = dbRef(db, `study_partners/${firebaseUser.uid}`);
    const unsubscribePartners = onValue(partnersRef, async (snap) => {
      const data = snap.val() || {};
      setStudyPartners(data);
      const partnerUids = Object.keys(data).filter(key => data[key] === true);
      if (partnerUids.length > 0) {
        const partnerProfiles = await getMultipleUserProfiles(partnerUids);
        setAllUsers(partnerProfiles);
      } else {
        setAllUsers([]);
      }
    });

    const requestsRef = dbRef(db, `partner_requests/${firebaseUser.uid}`);
    const unsubscribeRequests = onValue(requestsRef, (snap) => {
      setPartnerRequests(snap.val() || {});
    });

    return () => {
      off(partnersRef, 'value', unsubscribePartners);
      off(requestsRef, 'value', unsubscribeRequests);
    };
  }, [firebaseUser]);

  useEffect(() => {
    const handleVisibilityChange = () => setIsAppActive(document.visibilityState === 'visible');
    const handleFocus = () => setIsAppActive(true);
    const handleBlur = () => setIsAppActive(false);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;

    const presenceRef = dbRef(db, `users/${firebaseUser.uid}`);
    const connectedRef = dbRef(db, '.info/connected');
    let activeConnection = false;

    const syncPresence = async (online: boolean) => {
      await update(presenceRef, {
        is_online: online,
        last_seen: firebaseServerTimestamp()
      });
    };

    const unsubscribeConnected = onValue(connectedRef, async (snapshot) => {
      const connected = snapshot.val() === true;
      activeConnection = connected;

      if (connected && isAppActive) {
        const presenceDisconnect = onDisconnect(presenceRef);
        await presenceDisconnect.update({
          is_online: false,
          last_seen: firebaseServerTimestamp()
        });
        await syncPresence(true);
      }
    });

    if (isAppActive && activeConnection) {
      syncPresence(true);
    } else if (!isAppActive) {
      syncPresence(false);
    }

    return () => {
      off(connectedRef, 'value', unsubscribeConnected);
      syncPresence(false);
    };
  }, [firebaseUser, isAppActive]);

  useEffect(() => {
    if (!firebaseUser) return;
    const userChatsRef = dbRef(db, `user_chats/${firebaseUser.uid}`);
    onValue(userChatsRef, (snap) => {
      const rawVal = snap.val() || {};
      setChats(prevChats => {
        const safePrev = ensureArray(prevChats);
        const chatList = Object.entries(rawVal).map(([chatId, details]: any) => {
          const otherUserId = details.otherUserId || chatId;
          const existingChat = safePrev.find((c: any) => c && c.id === chatId);
          let otherUser = existingChat?.otherUser;
          if (!otherUser || otherUser.display_name === 'Unknown user') {
            otherUser = userMapRef.current.get(otherUserId) || fetchedUserProfilesRef.current[otherUserId] || createFallbackChatUser(otherUserId);
          }
          return {
            id: chatId,
            ...details,
            otherUser,
            isTyping: !!details.isTyping,
            isRecording: !!details.isRecording
          };
        });

        const nextUnreadCounts: Record<string, number> = {};
        chatList.forEach((chat) => {
          const unreadCount = getUnreadCount(chat);
          nextUnreadCounts[chat.id] = unreadCount;

          const previousUnread = unreadCountsRef.current[chat.id] || 0;
          const lastMessageTimestamp = Number(chat?.last_message?.timestamp || chat?.timestamp || 0);
          const lastNotifiedTimestamp = lastNotificationTimestampRef.current[chat.id] || 0;
          const lastSenderId = getLastMessageSenderId(chat);
          const hasIncomingUnread = unreadCount > previousUnread && unreadCount > 0;

          if (
            hasIncomingUnread &&
            lastSenderId &&
            lastSenderId !== firebaseUser.uid &&
            lastMessageTimestamp > lastNotifiedTimestamp
          ) {
            lastNotificationTimestampRef.current[chat.id] = lastMessageTimestamp;
            playReceiveSound();
            void showIncomingMessageNotification(chat, getLastMessagePreview(chat));
          }
        });
        unreadCountsRef.current = nextUnreadCounts;

        return chatList;
      });
      setIsLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser) return;
    writeCachedJson(getMessengerCacheKey(userProfile.uid, 'chats'), safeChats);
  }, [safeChats, firebaseUser, userProfile.uid]);

  useEffect(() => {
    if (!firebaseUser || !safeAllUsers.length) return;
    writeCachedJson(getMessengerCacheKey(userProfile.uid, 'all_users'), safeAllUsers);
  }, [safeAllUsers, firebaseUser, userProfile.uid]);

  useEffect(() => {
    if (!firebaseUser) return;
    writeCachedJson(getMessengerCacheKey(userProfile.uid, 'study_partners'), safeStudyPartners);
  }, [safeStudyPartners, firebaseUser, userProfile.uid]);

  useEffect(() => {
    if (!firebaseUser) return;
    writeCachedJson(getMessengerCacheKey(userProfile.uid, 'partner_requests'), safePartnerRequests);
  }, [safePartnerRequests, firebaseUser, userProfile.uid]);

  const pendingFetches = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!safeChats.length) return;
    safeChats.forEach(async (chat) => {
      const otherUserId = chat?.otherUserId || chat?.otherUser?.uid;
      if (!otherUserId) return;
      const resolvedUser = userMap.get(otherUserId) || fetchedUserProfiles[otherUserId];
      if (!resolvedUser && !pendingFetches.current.has(otherUserId)) {
        pendingFetches.current.add(otherUserId);
        try {
          const snapshot = await get(dbRef(db, `users/${otherUserId}`));
          if (snapshot.exists()) {
            const u = snapshot.val();
            const profile: UserProfile = {
              uid: otherUserId,
              display_name: u?.displayName || u?.display_name || 'Unknown User',
              photo_url: u?.photoURL || u?.photo_url || '',
              is_online: !!u?.is_online,
              last_seen: u?.last_seen || 0,
              department_id: u?.department_id || '',
              level: u?.level || '',
              current_streak: u?.current_streak || 0,
              last_activity_date: u?.last_activity_date || Date.now(),
              notifications_enabled: !!u?.notifications_enabled,
              subscription_status: u?.subscription_status || 'free',
              blocked_users: u?.blocked_users || {}
            };
            setFetchedUserProfiles(prev => {
              const next = { ...prev, [otherUserId]: profile };
              writeCachedJson(`avelut_resolved_profiles_${userProfile.uid}`, next);
              return next;
            });
          }
        } catch (err) {
          console.error("Failed to fetch profile for user:", otherUserId, err);
        } finally {
          pendingFetches.current.delete(otherUserId);
        }
      }
    });
  }, [safeChats, userMap, fetchedUserProfiles, userProfile.uid]);

  useEffect(() => {
    if (!initialChatId || !safeChats.length) return;
    const nextChat = safeChats.find(chat => chat?.id === initialChatId);
    if (!nextChat) return;
    const resolvedUser = userMap.get(nextChat.otherUserId) || fetchedUserProfiles[nextChat.otherUserId] || nextChat.otherUser;
    if (activeChat?.chatId !== nextChat.id || activeChat.otherUser?.uid !== resolvedUser?.uid) {
      setActiveChat({ chatId: nextChat.id, otherUser: resolvedUser });
    }
  }, [initialChatId, safeChats, activeChat, userMap, fetchedUserProfiles]);

  useEffect(() => {
    if (!activeChat) {
      setMessages([]);
      return;
    }

    const cached = readCachedJson<any[]>(getMessengerCacheKey(userProfile.uid, `messages_${activeChat.chatId}`), []);
    setMessages(ensureArray(cached));
    setOptimisticMessages([]);
    if (cached.length > 0) {
      setTimeout(() => scrollToBottom('instant' as ScrollBehavior), 30);
    }
    const messagesRef = dbRef(db, `messages/${activeChat.chatId}`);
    const messagesQuery = query(messagesRef, limitToLast(50));
    onValue(messagesQuery, (snap) => {
      const cloudMsgs = Object.entries(snap.val() || {}).map(([id, msg]: any) => ({ id, ...msg })).sort((a, b) => a.timestamp - b.timestamp);
      setMessages(prev => {
        const safePrev = ensureArray(prev);
        if (safePrev.length > 0) {
          const lastPrev = safePrev[safePrev.length - 1];
          const lastNew = cloudMsgs[cloudMsgs.length - 1];
          if (lastNew && lastNew.id !== lastPrev.id && lastNew.senderId !== firebaseUser?.uid && lastNew.timestamp > lastPrev.timestamp) {
            playReceiveSound();
          }
        }
        return cloudMsgs;
      });

      setOptimisticMessages(prev => ensureArray(prev).filter(opt => !cloudMsgs.some(cloud => cloud.timestamp === opt.timestamp)));

      setTimeout(() => scrollToBottom(cached.length === 0 ? ('instant' as ScrollBehavior) : 'smooth'), 40);
      if (firebaseUser) {
        set(dbRef(db, `user_chats/${firebaseUser.uid}/${activeChat.chatId}/unreadCount`), 0);

        const updates: any = {};
        let needsUpdate = false;
        let lastMsgRead = false;
        cloudMsgs.forEach((msg: any, index: number) => {
          if (msg.senderId !== firebaseUser.uid && !msg.isRead) {
            updates[`messages/${activeChat.chatId}/${msg.id}/isRead`] = true;
            needsUpdate = true;
            if (index === cloudMsgs.length - 1) lastMsgRead = true;
          }
        });
        if (lastMsgRead) {
          updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/last_message/isRead`] = true;
          updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}/last_message/isRead`] = true;
        }
        if (needsUpdate) {
          update(dbRef(db, '/'), updates).catch(console.error);
        }
      }
    });
    return () => off(messagesRef);
  }, [activeChat, firebaseUser, userProfile.uid, scrollToBottom]);

  useEffect(() => {
    if (!firebaseUser || !activeChat) return;
    writeCachedJson(getMessengerCacheKey(userProfile.uid, `messages_${activeChat.chatId}`), ensureArray(messages));
  }, [activeChat, firebaseUser, messages, userProfile.uid]);

  const combinedMessageStream = useMemo(() => {
    const msgs = ensureArray(messages);
    const optMsgs = ensureArray(optimisticMessages);
    return [...msgs, ...optMsgs].sort((a, b) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0));
  }, [messages, optimisticMessages]);

  const updateChatMetaFromLatestMessage = async (chatId: string, otherUserId: string) => {
    if (!firebaseUser) return;
    const latestSnapshot = await get(dbRef(db, `messages/${chatId}`));
    let summaryText = 'No messages yet';
    let latestTimestamp = Date.now();
    if (latestSnapshot.exists()) {
      const cloudMsgs = Object.entries(latestSnapshot.val() || {}).map(([, msg]: any) => msg);
      cloudMsgs.sort((a: any, b: any) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
      const lastMessage: any = cloudMsgs[cloudMsgs.length - 1] || {};
      latestTimestamp = Number(lastMessage?.timestamp || Date.now());
      if (lastMessage?.type === 'voice') summaryText = '🎵 Voice message';
      else if (lastMessage?.type === 'image') summaryText = '📷 Image file';
      else if (lastMessage?.type === 'file') summaryText = '📄 Document file';
      else summaryText = (lastMessage?.text || 'No messages yet').toString();
    }

    const updates: any = {};
    const participantIds = Array.from(new Set([firebaseUser.uid, otherUserId]));

    participantIds.forEach((participantId) => {
      updates[`user_chats/${participantId}/${chatId}/last_message`] = { text: summaryText };
      updates[`user_chats/${participantId}/${chatId}/timestamp`] = latestTimestamp;
    });
    await update(dbRef(db), updates);
  };

  const handleDeleteChatThread = async (chat: any) => {
    if (!firebaseUser || !chat?.id || !chat?.otherUserId) return;
    const confirmed = window.confirm(`Delete this chat with ${chat.otherUser?.display_name || 'this user'}?`);
    if (!confirmed) return;
    try {
      const updates: any = {};
      updates[`user_chats/${firebaseUser.uid}/${chat.id}`] = null;
      updates[`user_chats/${chat.otherUserId}/${chat.id}`] = null;
      updates[`messages/${chat.id}`] = null;
      await update(dbRef(db), updates);
      if (activeChat?.chatId === chat.id) {
        setActiveChat(null);
        setMessages([]);
        setOptimisticMessages([]);
      }
      addToast('Chat deleted successfully.', 'success');
    } catch (error: any) {
      console.error('Failed to delete chat thread:', error);
      addToast(error?.message || 'Failed to delete chat.', 'error');
    }
  };

  const startChatRowLongPress = (chat: any) => {
    if (chatRowLongPressTimerRef.current) {
      clearTimeout(chatRowLongPressTimerRef.current);
    }
    chatRowLongPressTimerRef.current = setTimeout(() => {
      suppressNextChatOpenRef.current = true;
      void handleDeleteChatThread(chat);
    }, 520);
  };

  const clearChatRowLongPress = () => {
    if (chatRowLongPressTimerRef.current) {
      clearTimeout(chatRowLongPressTimerRef.current);
      chatRowLongPressTimerRef.current = null;
    }
  };

  const openMessageActions = (msg: any, x: number, y: number) => {
    if (msg?.isUploading) return;
    setMessageActionTarget({
      id: msg.id,
      senderId: msg.senderId,
      text: msg.text,
      type: msg.type,
      isUploading: msg.isUploading,
      reactions: msg.reactions || {},
      replyTo: msg.replyTo,
      is_forwarded: msg.is_forwarded,
      timestamp: msg.timestamp,
      isRead: msg.isRead
    });
    setMessageActionPosition({ x, y });
  };

  const copyMessageContent = async () => {
    if (!messageActionTarget) return;
    const rawText = typeof messageActionTarget.text === 'string' ? messageActionTarget.text : '';
    const copiedValue = messageActionTarget.type === 'image'
      ? (rawText.match(/\((.*?)\)/)?.[1] || rawText)
      : rawText;
    if (!copiedValue) {
      addToast('Nothing to copy.', 'info');
      closeMessageActions();
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(copiedValue);
        addToast('Message copied.', 'success');
      } else {
        addToast('Message copied.', 'success');
      }
    } catch (error) {
      addToast('Message copied.', 'success');
    }
    closeMessageActions();
  };

  const handleDeleteMessageAction = (forEveryone = true) => {
    const target = deleteConfirmTarget || messageActionTarget;
    if (!target || !activeChat || !firebaseUser) return;

    setDeleteConfirmTarget(null);
    closeMessageActions();

    // Instant deletion call
    (async () => {
      try {
        await remove(dbRef(db, `messages/${activeChat.chatId}/${target.id}`));
        await updateChatMetaFromLatestMessage(activeChat.chatId, activeChat.otherUser.uid);
        addToast('Message deleted.', 'success');
      } catch (error: any) {
        console.error('Failed to delete message:', error);
        addToast(error?.message || 'Failed to delete message.', 'error');
      }
    })();
  };

  const promptDeleteMessageModal = () => {
    if (!messageActionTarget) return;
    setDeleteConfirmTarget({
      id: messageActionTarget.id,
      senderId: messageActionTarget.senderId
    });
    closeMessageActions();
  };

  const reactToMessage = async (emoji: string) => {
    if (!messageActionTarget || !activeChat || !firebaseUser) return;
    try {
      const reactionPath = dbRef(db, `messages/${activeChat.chatId}/${messageActionTarget.id}/reactions/${firebaseUser.uid}`);
      const currentReaction = messageActionTarget.reactions?.[firebaseUser.uid];
      if (currentReaction === emoji) {
        await remove(reactionPath);
      } else {
        await set(reactionPath, emoji);
        playBubbleSound();
      }
    } catch (error: any) {
      console.error('Failed to react to message:', error);
      addToast(error?.message || 'Failed to add reaction.', 'error');
    }
    closeMessageActions();
  };

  const quickReactToMessage = async (msg: any, emoji: string) => {
    if (!activeChat || !firebaseUser || !msg?.id || msg?.isUploading) return;
    try {
      const existingReactions = (msg.reactions && typeof msg.reactions === 'object') ?
        msg.reactions as Record<string, string> : {};
      const reactionPath = dbRef(db, `messages/${activeChat.chatId}/${msg.id}/reactions/${firebaseUser.uid}`);
      if (existingReactions[firebaseUser.uid] === emoji) {
        await remove(reactionPath);
        addToast('Reaction removed.', 'info');
      } else {
        await set(reactionPath, emoji);
        playBubbleSound();
        addToast('Reacted with ❤️', 'success');
      }
    } catch (error: any) {
      console.error('Failed to quick react to message:', error);
      addToast(error?.message || 'Quick reaction failed.', 'error');
    }
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read media preview.'));
        reader.readAsDataURL(blob);
      });

  /**
   * Unified media-send pipeline:
   *   1. Convert ANY source (File / Blob / data: / blob: / http(s): / Capacitor content:// or file://)
   *      into a real Blob BEFORE anything else - a raw content:// or file:// URI is never
   *      handed to Firebase Storage.
   *   2. Show a local "Sending..." bubble (Blob is retained on the bubble for retry).
   *   3. Upload with retries + hard timeout, then require a permanent http(s) download URL.
   *   4. For images, verify the returned URL actually loads before marking the message sent.
   *   5. ONLY after the URL is validated and loads do we create/send the chat message via sendMsg.
   *      On failure the bubble stays with an explicit error state + retry - it never hangs on "Sending...".
   */
  const uploadAndSendMedia = async (
    source: unknown,
    caption: string,
    opts: { preConfigureType?: 'image' | 'file'; fileName?: string } = {}
  ) => {
    if (!activeChat || !firebaseUser) return;

    let sourceBlob: SourceBlob;
    try {
      sourceBlob = await sourceToBlob(source);
    } catch (readErr) {
      console.error('[Messenger] Could not read selected media:', readErr);
      addToast((readErr as Error)?.message || 'Could not read the selected media.', 'error');
      return;
    }

    const fileName = (typeof File !== 'undefined' && source instanceof File && source.name)
      ? source.name
      : (opts.fileName || '');
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const rawMime = sourceBlob.mimeType || '';
    const isImg = opts.preConfigureType === 'image'
      || rawMime.startsWith('image/')
      || /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp)$/i.test(fileName);
    const isVoice = rawMime.startsWith('audio/');
    const fileType = isImg ? 'image' : isVoice ? 'voice' : 'file';

    const localTimestamp = Date.now();
    const tempId = `temp_${fileType}_${localTimestamp}_${Math.round(Math.random() * 1e6)}`;
    const displayName = fileName || (fileType === 'voice' ? 'Voice Note' : 'Media');

    // WhatsApp-style: Instant micro-thumbnail + local preview URL for 0ms rendering
    let localPreviewUrl = '';
    let microThumbnail = '';
    try {
      localPreviewUrl = URL.createObjectURL(sourceBlob.blob);
      if (isImg) {
        microThumbnail = await generateMicroThumbnail(sourceBlob.blob);
      }
    } catch (e) {
      try {
        localPreviewUrl = await blobToDataUrl(sourceBlob.blob);
      } catch (e2) {
        console.warn('[Messenger] Could not build local preview:', e2);
      }
    }

    let pendingText = '';
    if (fileType === 'image') {
      const imgMarkdown = localPreviewUrl ? `![Image](${localPreviewUrl})` : '';
      if (caption) {
        pendingText = imgMarkdown ? `${imgMarkdown}\n\n${caption}` : caption;
      } else {
        pendingText = imgMarkdown || (displayName ? `[${displayName}]` : 'Photo');
      }
    } else if (fileType === 'voice') {
      pendingText = `[Voice Note](${localPreviewUrl})`;
    } else {
      pendingText = `[📄 ${displayName}](${localPreviewUrl})`;
    }

    const cloudPath = fileType === 'voice'
      ? `voice_notes/${activeChat.chatId}/${localTimestamp}.webm`
      : `chat_files/${activeChat.chatId}/${localTimestamp}_${Math.round(Math.random() * 1e9)}.${ext || (rawMime.split('/')[1] || 'bin')}`;

    const pendingMessage: any = {
      id: tempId,
      senderId: firebaseUser.uid,
      text: pendingText,
      type: fileType,
      timestamp: localTimestamp,
      isUploading: true,
      localPreviewUrl,
      microThumbnail,
      blob: sourceBlob.blob,
      mimeType: rawMime,
      fileName,
      cloudPath,
    };
    if (caption && fileType === 'image') pendingMessage.caption = caption;

    // Instant UI Render & audio feedback
    setOptimisticMessages(prev => [...prev, pendingMessage]);
    playBubbleSound();
    setTimeout(() => scrollToBottom('smooth'), 40);

    const cleanupPreview = () => {
      if (localPreviewUrl && localPreviewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(localPreviewUrl); } catch (e) {}
      }
    };

    try {
      let permanentUrl = '';

      // 1. High-speed zero-egress Cloudflare R2 upload with auto burn-after-download
      if (isR2Configured()) {
        try {
          const r2Res = await uploadToR2(sourceBlob.blob, {
            burnAfterDownload: true,
            fileName,
            contentType: rawMime || undefined,
            userId: firebaseUser.uid,
          });
          if (r2Res.success && r2Res.url) {
            permanentUrl = r2Res.url;
          }
        } catch (r2Err) {
          console.warn('[Messenger] Cloudflare R2 upload error, falling back to standard storage:', r2Err);
        }
      }

      // 2. Resilient fallback to Firebase / Supabase Storage
      if (!permanentUrl) {
        permanentUrl = await uploadBlobWithRetry(
          storage,
          sourceBlob.blob,
          cloudPath,
          { contentType: rawMime || undefined, attempts: 2, timeoutMs: 30000 }
        );
      }

      // Clean up optimistic state and broadcast real message to chat thread
      setOptimisticMessages(prev => prev.filter((m: any) => m.id !== tempId));
      cleanupPreview();

      if (fileType === 'image') {
        const verifiedText = caption
          ? `![Image](${permanentUrl})\n\n${caption}`
          : `![Image](${permanentUrl})`;
        await sendMsg(verifiedText, 'image', { microThumbnail });
      } else if (fileType === 'voice') {
        await sendMsg(`[Voice Note](${permanentUrl})`, 'voice');
      } else {
        await sendMsg(`[📄 ${displayName}](${permanentUrl})`, 'file');
      }
    } catch (uploadErr) {
      console.error('[Messenger] Fast direct upload failed:', uploadErr);
      const errMsg = (uploadErr as Error)?.message || 'Upload failed';
      setOptimisticMessages(prev => prev.map((m: any) => m.id === tempId ? { ...m, isUploading: false, isFailed: true } : m));
      addToast(`${errMsg}. Tap the message to retry.`, 'error');
    }
  };

  const handleFileSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeChat || !e.target.files || e.target.files.length === 0 || !firebaseUser) return;
    const selectedFiles = Array.from(e.target.files);
    for (const file of selectedFiles) {
      await uploadAndSendMedia(file as File, '');
    }
    e.target.value = '';
  };

  const handleImageSendWithCaption = async (source: any, caption: string = '', mimeType?: string) => {
    if (!activeChat || !firebaseUser) return;
    void mimeType;
    await uploadAndSendMedia(source, caption || '', { preConfigureType: 'image' });
  };

  const retryFailedUpload = async (msg: any) => {
    if (!activeChat || !firebaseUser || !msg?.blob || msg?.type === undefined) return;
    const tempId = msg.id;
    let localPreviewUrl = msg.localPreviewUrl;
    if (!localPreviewUrl && msg.blob) {
      try {
        localPreviewUrl = URL.createObjectURL(msg.blob);
      } catch (e) {}
    }
    setOptimisticMessages(prev => prev.map((m: any) => m.id === tempId ? { ...m, isUploading: true, isFailed: false, localPreviewUrl } : m));

    const cleanupPreview = () => {
      if (localPreviewUrl && localPreviewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(localPreviewUrl); } catch (e) {}
      }
    };

    try {
      const rawMime = msg.mimeType || undefined;
      const cloudPath = msg.cloudPath || (msg.type === 'voice'
        ? `voice_notes/${activeChat.chatId}/${Date.now()}.webm`
        : `chat_files/${activeChat.chatId}/${Date.now()}_${Math.round(Math.random() * 1e9)}.${String(msg.fileName || 'file').split('.').pop() || 'bin'}`);

      const permanentUrl = await uploadBlobWithRetry(
        storage,
        msg.blob,
        cloudPath,
        { contentType: rawMime, attempts: 2, timeoutMs: 30000 }
      );

      setOptimisticMessages(prev => prev.filter((m: any) => m.id !== tempId));
      cleanupPreview();

      if (msg.type === 'image') {
        const finalText = msg.caption
          ? `![Image](${permanentUrl})\n\n${msg.caption}`
          : `![Image](${permanentUrl})`;
        await sendMsg(finalText, 'image');
      } else if (msg.type === 'voice') {
        await sendMsg(`[Voice Note](${permanentUrl})`, 'voice');
      } else {
        const displayName = msg.fileName || 'Media';
        await sendMsg(`[📄 ${displayName}](${permanentUrl})`, 'file');
      }
    } catch (err) {
      console.error('[Messenger] Retry upload failed:', err);
      setOptimisticMessages(prev => prev.map((m: any) => m.id === tempId ? { ...m, isUploading: false, isFailed: true } : m));
      addToast('Upload still failed. Please try again.', 'error');
    }
  };

  const startRecording = async (e: any) => {
    updateTypingStatus('recording');
    if (!activeChat) return;
    if (e && 'preventDefault' in e) e.preventDefault();
    startYRef.current = 'touches' in e ? e.touches[0].clientY : e.clientY;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      (recorder as any).shouldSave = true;

      recorder.onstop = async () => {
        if ((recorder as any).shouldSave && firebaseUser) {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          if (blob.size > 1000) {
            const localTimestamp = Date.now();
            const tempId = `temp_vn_${localTimestamp}`;
            const blobLocalUrl = URL.createObjectURL(blob);

            const pendingMessage: any = {
              id: tempId,
              senderId: firebaseUser.uid,
              text: `[Voice Note](${blobLocalUrl})`,
              type: 'voice',
              timestamp: localTimestamp,
              isUploading: true,
              localPreviewUrl: blobLocalUrl,
              blob,
              mimeType: 'audio/webm',
              fileName: 'Voice Note.webm',
              cloudPath: `voice_notes/${activeChat?.chatId}/${localTimestamp}.webm`,
            };

            setOptimisticMessages(prev => [...prev, pendingMessage]);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

            try {
              const permanentUrl = await uploadBlobWithRetry(
                storage,
                blob,
                pendingMessage.cloudPath,
                { contentType: 'audio/webm', attempts: 2, timeoutMs: 30000 }
              );
              setOptimisticMessages(prev => prev.filter(m => m.id !== tempId));
              if (blobLocalUrl && blobLocalUrl.startsWith('blob:')) {
                try { URL.revokeObjectURL(blobLocalUrl); } catch (e) {}
              }
              await sendMsg(`[Voice Note](${permanentUrl})`, 'voice');
            } catch (uploadError) {
              console.error("Voice Note storage syncing failure:", uploadError);
              setOptimisticMessages(prev => prev.map(m => m.id === tempId ? { ...m, isUploading: false, isFailed: true } : m));
              addToast('Voice note upload failed. Tap the message to retry.', 'error');
            }
          }
        }
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start();
      setIsRecording(true);
      setRecordDuration(0);
      handleTypingStatus('recording');
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setRecordDuration(prev => prev + 1), 1000);
    } catch (err) {
      addToast('Mic entry parameters rejected.', 'error');
    }
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isRecording || isLocked) return;
    const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    if (startYRef.current - currentY > 80) setIsLocked(true);
  };

  const stopRecording = (shouldSave: boolean) => {
    setIsRecording(false);
    setIsLocked(false);
    handleTypingStatus('idle');
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current) {
      (mediaRecorderRef.current as any).shouldSave = shouldSave;
      mediaRecorderRef.current.stop();
    }
  };

  const sendMsg = async (text: string, type = 'text', extraData: Record<string, any> = {}) => {
    if ((!text.trim() && type === 'text') || !activeChat || !firebaseUser) {
      addToast('Open a chat first, then send a message.', 'info');
      return;
    }

    const msgRef = push(dbRef(db, `messages/${activeChat.chatId}`));
    const clientTimestamp = Date.now();
    const optimisticId = msgRef.key || `${clientTimestamp}`;
    const data: any = { senderId: firebaseUser.uid, text, type, timestamp: firebaseServerTimestamp(), ...extraData };

    if (replyingTo) {
      data.replyTo = {
        id: replyingTo.id,
        text: replyingTo.type === 'text' ? replyingTo.text : `[${replyingTo.type}]`,
        senderId: replyingTo.senderId,
        senderName: replyingTo.senderId === firebaseUser.uid ? 'You' : activeChat.otherUser.display_name
      };
      setReplyingTo(null);
    }

    const optimisticMessage = { id: optimisticId, ...data, timestamp: clientTimestamp };

    setMessages(prev => [...prev, optimisticMessage]);
    playBubbleSound();
    try {
      await set(msgRef, data);
      const updates: any = {};
      let summaryText = text;
      if (type === 'voice') summaryText = '🎵 Voice message';
      else if (type === 'image') summaryText = '📷 Image file';
      else if (type === 'file') summaryText = '📄 Document file';
      const metaTimestamp = firebaseServerTimestamp();

      const participantIds = Array.from(new Set([firebaseUser.uid, activeChat.otherUser.uid]));
      participantIds.forEach((participantId) => {
        updates[`user_chats/${participantId}/${activeChat.chatId}/last_message`] = {
          text: summaryText,
          senderId: firebaseUser.uid,
          timestamp: metaTimestamp,
          type,
        };
        updates[`user_chats/${participantId}/${activeChat.chatId}/timestamp`] = metaTimestamp;
        updates[`user_chats/${participantId}/${activeChat.chatId}/otherUserId`] = participantId === firebaseUser.uid
          ? activeChat.otherUser.uid
          : firebaseUser.uid;
      });
      updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}/unreadCount`] = 0;
      if (activeChat.otherUser.uid !== firebaseUser.uid) {
        updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/unreadCount`] = increment(1);
      }
      await update(dbRef(db), updates);
    } catch (error: any) {
      setMessages(prev => prev.filter(message => message.id !== optimisticId));
      console.error('Failed to send message:', error);
      addToast(error?.message || 'Message failed to send.', 'error');
    }
  };

  const sendPartnerRequest = async (targetUser: UserProfile) => {
    if (!firebaseUser || !userProfile) return;
    try {
      const myRequestRef = dbRef(db, `partner_requests/${firebaseUser.uid}/${targetUser.uid}`);
      const theirRequestRef = dbRef(db, `partner_requests/${targetUser.uid}/${firebaseUser.uid}`);

      const now = Date.now();
      await set(myRequestRef, {
        status: 'sent',
        senderName: userProfile.display_name || 'User',
        senderId: firebaseUser.uid,
        receiverId: targetUser.uid,
        timestamp: now
      });
      await set(theirRequestRef, {
        status: 'received',
        senderName: userProfile.display_name || 'User',
        senderId: firebaseUser.uid,
        receiverId: targetUser.uid,
        timestamp: now
      });

      const notifRef = push(dbRef(db, `notifications/${targetUser.uid}`));
      await set(notifRef, {
        id: notifRef.key,
        title: 'New Study Partner Request',
        message: `${userProfile.display_name || 'A user'} sent you a study partner request!`,
        type: 'study_partner_request',
        is_read: false,
        timestamp: now
      });
      addToast(`Study partner request sent to ${targetUser.display_name}!`, 'success');
    } catch (err: any) {
      console.error('Failed to send partner request:', err);
      addToast('Failed to send request: ' + err.message, 'error');
    }
  };

  const acceptPartnerRequest = async (targetUser: UserProfile) => {
    if (!firebaseUser || !userProfile) return;
    try {
      const myRequestRef = dbRef(db, `partner_requests/${firebaseUser.uid}/${targetUser.uid}`);
      const theirRequestRef = dbRef(db, `partner_requests/${targetUser.uid}/${firebaseUser.uid}`);
      await remove(myRequestRef);
      await remove(theirRequestRef);

      const myPartnerRef = dbRef(db, `study_partners/${firebaseUser.uid}/${targetUser.uid}`);
      const theirPartnerRef = dbRef(db, `study_partners/${targetUser.uid}/${firebaseUser.uid}`);
      await set(myPartnerRef, true);
      await set(theirPartnerRef, true);

      const notifRef = push(dbRef(db, `notifications/${targetUser.uid}`));
      await set(notifRef, {
        id: notifRef.key,
        title: 'Study Partner Request Accepted',
        message: `${userProfile.display_name || 'A user'} accepted your study partner request!`,
        type: 'study_partner_accepted',
        is_read: false,
        timestamp: Date.now()
      });
      addToast(`You are now study partners with ${targetUser.display_name}!`, 'success');
    } catch (err: any) {
      console.error('Failed to accept request:', err);
      addToast('Failed to accept request: ' + err.message, 'error');
    }
  };

  const declinePartnerRequest = async (targetUser: UserProfile) => {
    if (!firebaseUser) return;
    try {
      const myRequestRef = dbRef(db, `partner_requests/${firebaseUser.uid}/${targetUser.uid}`);
      const theirRequestRef = dbRef(db, `partner_requests/${targetUser.uid}/${firebaseUser.uid}`);
      await remove(myRequestRef);
      await remove(theirRequestRef);
      addToast(`Declined request from ${targetUser.display_name}`, 'info');
    } catch (err: any) {
      console.error('Failed to decline request:', err);
    }
  };

  const cancelPartnerRequest = async (targetUser: UserProfile) => {
    if (!firebaseUser) return;
    try {
      const myRequestRef = dbRef(db, `partner_requests/${firebaseUser.uid}/${targetUser.uid}`);
      const theirRequestRef = dbRef(db, `partner_requests/${targetUser.uid}/${firebaseUser.uid}`);
      await remove(myRequestRef);
      await remove(theirRequestRef);
      addToast(`Cancelled request to ${targetUser.display_name}`, 'info');
    } catch (err: any) {
      console.error('Failed to cancel request:', err);
    }
  };

  const forwardMessageToUsers = async (text: string, type = 'text', recipientUserIds: string[]) => {
    if (!firebaseUser) return;
    try {
      for (const recipientId of recipientUserIds) {
        const chatId = [firebaseUser.uid, recipientId].sort().join('_');
        const msgRef = push(dbRef(db, `messages/${chatId}`));
        const data = { senderId: firebaseUser.uid, text, type, timestamp: Date.now(), is_forwarded: true };
        await set(msgRef, data);
        const updates: any = {};
        let summaryText = text;
        if (type === 'voice') summaryText = '🎵 Voice message';
        else if (type === 'image') summaryText = '📷 Image file';
        else if (type === 'file') summaryText = '📄 Document file';
        const participantIds = Array.from(new Set([firebaseUser.uid, recipientId]));
        participantIds.forEach((participantId) => {
          updates[`user_chats/${participantId}/${chatId}/last_message`] = {
            text: summaryText,
            senderId: firebaseUser.uid,
            timestamp: Date.now(),
            type,
          };
          updates[`user_chats/${participantId}/${chatId}/timestamp`] = Date.now();
          updates[`user_chats/${participantId}/${chatId}/otherUserId`] = participantId === firebaseUser.uid
            ? recipientId
            : firebaseUser.uid;
        });
        updates[`user_chats/${firebaseUser.uid}/${chatId}/unreadCount`] = 0;
        if (recipientId !== firebaseUser.uid) {
          updates[`user_chats/${recipientId}/${chatId}/unreadCount`] = increment(1);
        }
        await update(dbRef(db), updates);
      }
      addToast('Message forwarded successfully!', 'success');
    } catch (err: any) {
      console.error('Failed to forward:', err);
      addToast('Failed to forward message: ' + err.message, 'error');
    }
  };

  const userOptionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showUserOptions) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (userOptionsRef.current && !userOptionsRef.current.contains(e.target as Node)) {
        setShowUserOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showUserOptions]);

  useEffect(() => {
    if (!setCustomHeaderConfig) return;

    if (selectedChatIds.length > 0) {
      const isAllMuted = selectedChatIds.every(id => mutedChatIds[id]);
      const isAllPinned = selectedChatIds.every(id => pinnedChatIds[id]);

      setCustomHeaderConfig({
        title: (
          <div className="flex items-center gap-3 w-full">
            <button
              type="button"
              onClick={() => {
                setSelectedChatIds([]);
                setShowSelectedMenu(false);
              }}
              className="w-9 h-9 flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors cursor-pointer"
              aria-label="Cancel selection"
            >
              <i className="bi bi-arrow-left text-xl"></i>
            </button>
            <span className="text-lg font-bold text-slate-900 dark:text-white">
              {selectedChatIds.length}
            </span>
          </div>
        ),
        leftActions: null,
        rightActions: (
          <div className="flex items-center gap-1 relative">
            <button
              type="button"
              onClick={() => {
                setPinnedChatIds(prev => {
                  const next = { ...prev };
                  const targetState = !isAllPinned;
                  selectedChatIds.forEach(id => { next[id] = targetState; });
                  writeCachedJson(`avelut_pinned_chats_${userProfile.uid}`, next, userProfile.uid);
                  addToast(targetState ? 'Chat pinned.' : 'Chat unpinned.', 'info');
                  return next;
                });
                setSelectedChatIds([]);
              }}
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors cursor-pointer"
              title={isAllPinned ? "Unpin chat" : "Pin chat"}
            >
              <i className={`bi ${isAllPinned ? 'bi-pin-angle-fill text-[#0066FF]' : 'bi-pin-angle'} text-lg`}></i>
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteChatConfirmDialog(true)}
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600 rounded-full transition-colors cursor-pointer"
              title="Delete chat"
            >
              <i className="bi bi-trash text-lg"></i>
            </button>
            <button
              type="button"
              onClick={() => {
                setMutedChatIds(prev => {
                  const next = { ...prev };
                  const targetState = !isAllMuted;
                  selectedChatIds.forEach(id => { next[id] = targetState; });
                  writeCachedJson(`avelut_muted_chats_${userProfile.uid}`, next, userProfile.uid);
                  addToast(targetState ? 'Notifications muted.' : 'Notifications unmuted.', 'info');
                  return next;
                });
                setSelectedChatIds([]);
              }}
              className="p-2 text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors cursor-pointer"
              title={isAllMuted ? "Unmute notifications" : "Mute notifications"}
            >
              <i className={`bi ${isAllMuted ? 'bi-volume-up' : 'bi-volume-mute'} text-lg`}></i>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSelectedMenu(prev => !prev)}
                className="p-2 text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors cursor-pointer"
                title="More options"
              >
                <i className="bi bi-three-dots-vertical text-lg"></i>
              </button>
              {showSelectedMenu && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 py-1 origin-top-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (firebaseUser) {
                        const updates: Record<string, any> = {};
                        selectedChatIds.forEach(id => {
                          updates[`user_chats/${firebaseUser.uid}/${id}/unreadCount`] = 1;
                        });
                        update(dbRef(db), updates).catch(console.error);
                      }
                      addToast('Marked as unread.', 'info');
                      setSelectedChatIds([]);
                      setShowSelectedMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Mark as unread
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (firebaseUser) {
                        for (const chatId of selectedChatIds) {
                          const chat = chats.find(c => c.id === chatId);
                          if (chat?.otherUser?.uid) {
                            await set(dbRef(db, `users/${firebaseUser.uid}/blocked_users/${chat.otherUser.uid}`), true);
                          }
                        }
                        addToast('User blocked.', 'success');
                      }
                      setSelectedChatIds([]);
                      setShowSelectedMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                  >
                    Block User
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReportModal(true);
                      setShowSelectedMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    Report User
                  </button>
                </div>
              )}
            </div>
          </div>
        ),
        className: 'bg-white dark:bg-[#111111] shadow-md h-16 border-b border-slate-200 dark:border-slate-800',
        hideDefaultRightActions: true,
        hideProfileAvatar: true,
        hideBottomNav: false
      });
      return;
    }

    if (activeChat?.otherUser) {
      setCustomHeaderConfig({
        title: (
          <div
            onClick={() => onNavigate?.(`public_profile_${activeChat.otherUser.uid}`)}
            className="flex flex-col justify-center min-w-0 flex-1 cursor-pointer pl-1"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-slate-900 dark:text-white text-[15px] sm:text-[16px] leading-tight truncate">
                {activeChat.otherUser.display_name || 'User'}
              </span>
              <VerificationBadge status={activeChat.otherUser.subscription_status} />
              <StreakBadge userProfile={activeChat.otherUser} size="sm" />
            </div>
            <span className="text-[11px] sm:text-[12px] text-slate-500 dark:text-slate-400 font-normal leading-tight truncate mt-0.5 flex items-center">
              {activeChat.otherUser.is_online ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 shrink-0 animate-pulse" />
                  <span className="text-emerald-600 font-medium">Online</span>
                </>
              ) : (
                formatLastSeen(activeChat.otherUser.last_seen)
              )}
            </span>
          </div>
        ),
        leftActions: (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveChat(null)}
              className="w-9 h-9 flex items-center justify-center text-slate-600 dark:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors"
              aria-label="Go back"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div
              onClick={() => onNavigate?.(`public_profile_${activeChat.otherUser.uid}`)}
              className="cursor-pointer shrink-0"
            >
              <Avatar
                className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-transparent"
                photo_url={activeChat.otherUser.photo_url}
                display_name={activeChat.otherUser.display_name || 'User'}
              />
            </div>
          </div>
        ),
        rightActions: (
          <div ref={userOptionsRef} className="relative shrink-0 flex items-center">
            <button
              type="button"
              onClick={() => setShowUserOptions(prev => !prev)}
              className="w-9 h-9 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
            >
              <i className="bi bi-three-dots-vertical text-lg" />
            </button>
            {showUserOptions && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 py-1 origin-top-right">
                <button
                  onClick={handleBlockUser}
                  className="w-full text-left px-4 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  Block User
                </button>
                <button
                  onClick={() => { setShowReportModal(true); setShowUserOptions(false); }}
                  className="w-full text-left px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Report User
                </button>
              </div>
            )}
          </div>
        ),
        hideDefaultRightActions: true,
        hideProfileAvatar: true,
        hideBottomNav: true
      });
    } else {
      setCustomHeaderConfig(null);
    }

    return () => {
      setCustomHeaderConfig(null);
    };
  }, [setCustomHeaderConfig, activeChat, showUserOptions, onNavigate]);


  return (
    <div className="flex h-full w-full overflow-hidden bg-[#F8F9FA] dark:bg-black font-sans antialiased text-[#212529] dark:text-white">
      {/* Sidebar Pane */}
      <div className={`w-full lg:w-[380px] border-r border-[#E9ECEF] dark:border-slate-800 flex flex-col ${activeChat ? 'hidden lg:flex' : 'flex'} h-full bg-white dark:bg-black relative`}>
        {/* Sidebar Header with clean search */}
        <div className="p-4 bg-[#F8F9FA] dark:bg-black border-b border-[#E9ECEF] dark:border-slate-800 shrink-0">
          <div className="relative">
            <input
              type="text"
              placeholder="Search chats..."
              value={chatSearchQuery}
              onChange={(e) => setChatSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 text-sm text-[#212529] dark:text-white placeholder-slate-400 pl-10 pr-9 py-2.5 rounded-2xl border border-[#E9ECEF] dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-[#009EE2]/30 focus:border-[#009EE2] transition-all shadow-sm"
            />
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            {chatSearchQuery && (
              <button
                onClick={() => setChatSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs w-5 h-5 flex items-center justify-center rounded-full"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-white dark:bg-black">
          {isLoading ? (
            <div className="p-4"><MessengerSkeleton /></div>
          ) : activeChats.length === 0 ? (
            <div className="text-center py-12 px-6 bg-[#F8F9FA] dark:bg-slate-900/40 m-4 rounded-2xl border border-dashed border-[#E9ECEF] dark:border-slate-800">
              <span className="text-3xl block mb-2">💬</span>
              <p className="text-sm font-bold text-[#212529] dark:text-white">
                {chatSearchQuery ? "No matching chats found" : "No active chats"}
              </p>
              <p className="text-xs text-[#6C757D] dark:text-gray-400 mt-1">
                {chatSearchQuery
                  ? "Try searching for a different name or message."
                  : "Tap the + button below to find study mates and start chatting!"}
              </p>
            </div>
          ) : (
            activeChats.map(c => {
              const isSelected = selectedChatIds.includes(c.id);
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    if (suppressNextChatOpenRef.current) {
                      suppressNextChatOpenRef.current = false;
                      return;
                    }
                    if (selectedChatIds.length > 0) {
                      setSelectedChatIds(prev =>
                        prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                      );
                      return;
                    }
                    setActiveChat({ chatId: c.id, otherUser: c.otherUser });
                  }}
                  onTouchStart={() => {
                    if (chatRowLongPressTimerRef.current) clearTimeout(chatRowLongPressTimerRef.current);
                    chatRowLongPressTimerRef.current = setTimeout(() => {
                      suppressNextChatOpenRef.current = true;
                      setSelectedChatIds(prev =>
                        prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                      );
                    }, 500);
                  }}
                  onTouchEnd={() => {
                    if (chatRowLongPressTimerRef.current) {
                      clearTimeout(chatRowLongPressTimerRef.current);
                      chatRowLongPressTimerRef.current = null;
                    }
                  }}
                  onTouchCancel={() => {
                    if (chatRowLongPressTimerRef.current) {
                      clearTimeout(chatRowLongPressTimerRef.current);
                      chatRowLongPressTimerRef.current = null;
                    }
                  }}
                  onTouchMove={() => {
                    if (chatRowLongPressTimerRef.current) {
                      clearTimeout(chatRowLongPressTimerRef.current);
                      chatRowLongPressTimerRef.current = null;
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedChatIds(prev =>
                      prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                    );
                  }}
                  className={`flex items-center gap-3 p-4 cursor-pointer border-b border-[#E9ECEF] dark:border-slate-800/60 transition ${
                    isSelected
                      ? 'bg-[#00a884]/15 dark:bg-[#103629]/70'
                      : activeChat?.chatId === c.id
                        ? 'bg-[#F8F9FA] dark:bg-slate-900/80'
                        : 'hover:bg-[#F8F9FA] dark:hover:bg-slate-900/60'
                  }`}
                >
                <Avatar className="w-11 h-11 rounded-full shrink-0 object-cover border border-[#E9ECEF] dark:border-slate-800" photo_url={c.otherUser?.photo_url} display_name={c.otherUser?.display_name || 'User'} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-0.5">
                    <h3 className={`text-[15px] truncate flex items-center gap-1.5 ${getUnreadCount(c) > 0 ? 'font-bold text-[#212529] dark:text-white' : 'font-medium text-[#212529] dark:text-white'}`}>
                      <span>{c.otherUser?.display_name}</span>
                      <VerificationBadge status={c.otherUser?.subscription_status} />
                      {c.otherUser && <StreakBadge userProfile={c.otherUser} size="sm" />}
                    </h3>
                    <span className="text-[12px] text-[#6C757D] dark:text-gray-400">{formatChatTimestamp(c.timestamp)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 min-w-0">
                      {c.last_message?.senderId === firebaseUser?.uid && (
                        <DoubleCheckIcon color={c.last_message?.isRead ? "#009EE2" : "#8696a0"} />
                      )}

                      {c.isTyping ? (
                        <span className="text-[#009EE2] dark:text-[#F8F9FA] font-semibold flex items-center gap-1 italic"><div className="flex gap-0.5"><div className="w-1 h-1 rounded-full bg-[#009EE2] animate-bounce" style={{ animationDelay: '0ms' }}></div><div className="w-1 h-1 rounded-full bg-[#009EE2] animate-bounce" style={{ animationDelay: '150ms' }}></div><div className="w-1 h-1 rounded-full bg-[#009EE2] animate-bounce" style={{ animationDelay: '300ms' }}></div></div> typing...</span>
                      ) : c.isRecording ? (
                        <span className="text-[#009EE2] dark:text-[#F8F9FA] font-semibold flex items-center gap-1 italic">🎵 recording...</span>
                      ) : (
                        <p className={`text-[14px] truncate ${getUnreadCount(c) > 0 ? 'font-bold text-[#212529] dark:text-white' : 'text-[#6C757D] dark:text-gray-400'}`}>{getLastMessagePreview(c)}</p>
                      )}

                    </div>
                    {getUnreadCount(c) > 0 && (
                      <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                        {getUnreadCount(c) > 99 ? '99+' : getUnreadCount(c)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] mt-1 text-[#6C757D] dark:text-gray-400 font-normal">
                    {c.otherUser?.is_online ? <span className="text-[#28A745]">online</span> : formatLastSeen(c.otherUser?.last_seen)}
                  </p>
                </div>
                </div>
              );
            })
          )}
        </div>

        {/* FAB: Partner Management Modal Trigger with Pending Incoming Requests Badge */}
        <button
          onClick={() => {
            setPartnerModalTab('mates');
            setPartnerModalSubView('all');
            setIsPartnerModalOpen(true);
          }}
          className="fixed md:absolute bottom-24 md:bottom-6 right-6 flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-tr from-[#009EE2] to-[#0070B8] text-white shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 active:scale-95 border border-white/20 z-40 cursor-pointer"
          title="Partner Management"
        >
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {pendingIncomingCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-rose-600 text-white font-black text-[11px] min-w-[22px] h-[22px] px-1 rounded-full border-2 border-white dark:border-black flex items-center justify-center shadow-md animate-pulse">
              {pendingIncomingCount > 99 ? '99+' : pendingIncomingCount}
            </span>
          )}
        </button>
      </div>

      {/* Main Chat Viewport */}
      <div className={`flex-1 flex flex-col h-full bg-[#EFEAE2] dark:bg-[#000000] relative ${!activeChat ? 'hidden lg:flex items-center justify-center' : 'flex'}`}>
        {activeChat ? (
          <div className="flex flex-col h-full w-full relative overflow-hidden">
            {/* 2. Messages List */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto min-h-0 px-2 sm:px-3 pt-3 pb-3 md:py-6 bg-[#EFEAE2] dark:bg-[#000000] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden scroll-smooth">
              <div className="min-h-full flex flex-col justify-end">
              {combinedMessageStream.length === 0 ? (
                <div className="my-auto flex flex-col items-center justify-center px-4 py-8">
                  <div className="w-20 h-20 bg-[#009EE2]/10 rounded-full flex items-center justify-center mb-6 animate-pulse">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 text-[#009EE2] dark:text-[#F8F9FA]">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-[#212529] dark:text-white mb-2 text-center">Start a Conversation</h3>
                  <p className="text-[#6C757D] dark:text-gray-400 text-center max-w-sm text-sm">
                    Say hello to {selectedChatUser.display_name}. Your first message will create the conversation.
                  </p>
                </div>
              ) : combinedMessageStream.map((msg) => {
                const isMe = msg.senderId === firebaseUser?.uid;
                const rawText = typeof msg.text === 'string' ? msg.text : '';
                let imageUrl = '';
                if (msg.type === 'image') {
                  imageUrl = resolveImageDisplayUrl(msg);
                }
                const reactionMap = (msg.reactions && typeof msg.reactions === 'object') ? msg.reactions as Record<string, string> : {};
                const reactionCounts = Object.values(reactionMap).reduce((acc: Record<string, number>, reactionEmoji: string) => {
                  acc[reactionEmoji] = (acc[reactionEmoji] || 0) + 1;
                  return acc;
                }, {});
                const sortedReactions = Object.entries(reactionCounts).sort((a, b) => b[1] - a[1]);

                return (
                  <div key={msg.id} className={`message-bubble-wrapper ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex items-end space-x-2 max-w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                      {!isMe && (
                        <Avatar className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-[#E9ECEF] dark:border-transparent mb-0.5" photo_url={selectedChatUser.photo_url} display_name={selectedChatUser.display_name || 'User'} />
                      )}

                      <div className={`message-bubble ${isMe ? 'outgoing' : 'incoming'} relative select-none ${messageActionTarget?.id === msg.id ? 'ring-4 ring-[#25D366]/60 z-[60] !bg-[#25D366]/10' : ''}`.trim()}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openMessageActions(msg, event.clientX, event.clientY);
                        }}
                        onTouchStart={(event) => {
                          if (!event.touches[0]) return;
                          if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                          const touch = event.touches[0];
                          swipeToReplyRef.current = {
                            id: msg.id,
                            startX: touch.clientX,
                            startY: touch.clientY,
                            currentX: touch.clientX,
                            currentY: touch.clientY,
                            moved: false
                          };
                          longPressTimerRef.current = setTimeout(() => {
                            if (swipeToReplyRef.current.id === msg.id && !swipeToReplyRef.current.moved) {
                              openMessageActions(msg, touch.clientX, touch.clientY);
                            }
                            swipeToReplyRef.current = { id: null, startX: 0, startY: 0, currentX: 0, currentY: 0, moved: false };
                          }, 1000);
                        }}
                        onTouchEnd={(e) => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }

                          if (swipeToReplyRef.current.id === msg.id) {
                            const diffX = swipeToReplyRef.current.currentX - swipeToReplyRef.current.startX;
                            if (diffX > 60) {
                              setReplyingTo(msg);
                              e.currentTarget.style.transform = 'translateX(0px)';
                              swipeToReplyRef.current = { id: null, startX: 0, startY: 0, currentX: 0, currentY: 0, moved: false };
                              setTimeout(() => {
                                textInputRef.current?.focus();
                              }, 50);
                              return;
                            }
                            e.currentTarget.style.transform = 'translateX(0px)';
                          }
                          const wasMoved = swipeToReplyRef.current.moved;
                          swipeToReplyRef.current = { id: null, startX: 0, startY: 0, currentX: 0, currentY: 0, moved: false };

                          if (!wasMoved) {
                            const now = Date.now();
                            const lastTap = lastTapRef.current;
                            const isDoubleTap = lastTap.id === msg.id && (now - lastTap.time) < 320;
                            if (isDoubleTap) {
                              void quickReactToMessage(msg, '❤️');
                              lastTapRef.current = { id: null, time: 0 };
                              return;
                            }

                            lastTapRef.current = { id: msg.id, time: now };
                          }
                        }}
                        onTouchMove={(e) => {
                          if (swipeToReplyRef.current.id === msg.id && e.touches[0]) {
                            const touch = e.touches[0];
                            swipeToReplyRef.current.currentX = touch.clientX;
                            swipeToReplyRef.current.currentY = touch.clientY;
                            const diffX = touch.clientX - swipeToReplyRef.current.startX;
                            const diffY = touch.clientY - swipeToReplyRef.current.startY;

                            // If touch moved more than 10px in any direction, consider it a move and cancel long press timer
                            if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
                              swipeToReplyRef.current.moved = true;
                              if (longPressTimerRef.current) {
                                clearTimeout(longPressTimerRef.current);
                                longPressTimerRef.current = null;
                              }
                            }

                            if (diffX > 0 && diffX < 100) {
                              e.currentTarget.style.transform = `translateX(${diffX}px)`;
                            }
                          }
                        }}
                        onTouchCancel={(e) => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                          if (swipeToReplyRef.current.id === msg.id) {
                            e.currentTarget.style.transform = 'translateX(0px)';
                          }
                          swipeToReplyRef.current = { id: null, startX: 0, startY: 0, currentX: 0, currentY: 0, moved: false };
                        }}
                        style={{ transition: 'transform 0.1s ease-out' }}
                      >
                        <div className="flex flex-col w-full">
                          {/* Reply Snippet */}
                          {msg.is_forwarded && (
                            <div className="flex items-center gap-1 mb-1 text-[10px] opacity-70 italic">
                              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 21l9-9-9-9v6H3v6h9z" /></svg>
                              Forwarded
                            </div>
                          )}
                          {msg.replyTo && (
                            <div className={`mb-1.5 p-2 rounded bg-black/10 dark:bg-white/10 text-[12px] border-l-2 ${isMe ? 'border-white/50 text-white/90' : 'border-[#009EE2]/50 text-[#111B21]/80 dark:text-gray-200/90'}`}>
                              <div className="font-bold">{msg.replyTo.senderName}</div>
                              <div className="truncate max-w-[200px] sm:max-w-[280px] opacity-80">{msg.replyTo.text}</div>
                            </div>
                          )}
                          <div className="message-content">
                            {/* Voice Note Player */}
                            {msg.type === 'voice' ? (
                              <VoiceNotePlayer
                                src={rawText.match(/\((.*?)\)/)?.[1] || rawText}
                                isMe={isMe}
                                isUploading={msg.isUploading}
                              />
                            ) : (msg.type === 'image' || Boolean(imageUrl) || /!\[.*?\]\(.*?\)/.test(rawText)) ? (
                              <div className="rounded-[20px] overflow-hidden max-w-[340px] sm:max-w-[440px] md:max-w-[500px] w-full bg-transparent relative flex flex-col">
                                <ProgressiveImageBubble
                                  src={imageUrl || resolveImageDisplayUrl(msg)}
                                  microThumbnail={msg.microThumbnail}
                                  isUploading={msg.isUploading}
                                  onPreview={(url) => setPreviewImageUrl(url)}
                                />
                                {(() => {
                                  const extractedCaption = extractImageCaption(rawText);
                                  if (!extractedCaption) return null;
                                  return (
                                    <div className="message-text mt-1.5 px-1">
                                      <ReactMarkdown
                                        components={{
                                          p: ({ node, ...props }: any) => <p className="m-0 inline text-sm sm:text-base leading-relaxed" {...props} />,
                                          a: ({ node, ...props }: any) => <a className="text-[#009EE2] underline break-all" target="_blank" rel="noreferrer" {...props} />
                                        }}
                                      >
                                        {extractedCaption}
                                      </ReactMarkdown>
                                    </div>
                                  );
                                })()}
                              </div>
                            ) : (
                              <div className="message-text">
                                <ReactMarkdown
                                  components={{
                                    p: ({ node, ...props }: any) => <p className="m-0 inline" {...props} />,
                                    a: ({ node, ...props }: any) => <a className="text-[#009EE2] underline break-all" target="_blank" rel="noreferrer" {...props} />
                                  }}
                                >
                                  {rawText}
                                </ReactMarkdown>
                              </div>
                            )}

                            {msg.isFailed && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void retryFailedUpload(msg); }}
                                className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-rose-500 hover:text-rose-400 bg-black/10 dark:bg-white/10 rounded-full px-2 py-0.5"
                              >
                                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M16 3h5l-1.8 3.7 1.8 3.3H16"></path>
                                  <path d="M3 12l3.5 7V18h4V3h-1.5"></path>
                                </svg>
                                Upload failed — tap to retry
                              </button>
                            )}

                            {/* Meta Timestamp */}
                            <div className="message-time">
                              <span>
                                {msg.isUploading ? 'Sending...' : msg.isFailed ? 'Failed · tap to retry' : formatChatTimestamp(msg.timestamp)}
                              </span>
                              {isMe && !msg.isUploading && !msg.isFailed && <DoubleCheckIcon color={msg.isRead ? '#009EE2' : '#667'} />}
                            </div>
                          </div>

                          {sortedReactions.length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {sortedReactions.map(([emoji, count]) => (
                                <span key={`${msg.id}-${emoji}`} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isMe ? 'bg-white/20 text-white' : 'bg-black/10 dark:bg-white/10 text-[#212529] dark:text-white'}`}>
                                  {emoji} {count}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {activeChat && chats.find(c => c.chatId === activeChat.chatId)?.isTyping && (
                <div className="flex justify-start mb-6 w-full max-w-[85%] pr-14 group transition-all duration-300 transform animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex items-end gap-2">
                    <div className="w-[38px] h-[38px] shrink-0 rounded-full overflow-hidden border border-neutral-100 dark:border-transparent shadow-sm select-none pointer-events-none">
                      {activeChat.otherUser.photo_url ? (
                        <img src={activeChat.otherUser.photo_url} alt={activeChat.otherUser.display_name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 font-bold uppercase text-sm">
                          {activeChat.otherUser.display_name?.charAt(0) || '?'}
                        </div>
                      )}
                    </div>
                    <div>
                      <TypingIndicator />
                    </div>
                  </div>
                </div>
              )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* 3. Bottom Control Anchor Panel Bar */}
            <div className="p-3 bg-[#EFEAE2] dark:bg-[#000000] z-10 shrink-0">
              {replyingTo && (
                <div className="flex items-center justify-between mb-2 p-2 bg-neutral-100 dark:bg-[#111111] rounded-lg border-l-4 border-[#009EE2]">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#009EE2] dark:text-white">Replying to {replyingTo.senderId === firebaseUser?.uid ? 'You' : activeChat.otherUser.display_name}</p>
                    <p className="text-xs text-neutral-600 dark:text-gray-400 truncate max-w-[200px] sm:max-w-[300px]">
                      {replyingTo.type === 'text' ? replyingTo.text : `[${replyingTo.type}]`}
                    </p>
                  </div>
                  <button onClick={() => setReplyingTo(null)} className="p-1 text-neutral-400 hover:text-neutral-600 transition">
                    ✕
                  </button>
                </div>
              )}
              {isBlocked || isBlockingMe ? (
                <div className="p-3 text-center text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl">
                  {isBlocked ? "You have blocked this user." : "This user is unavailable."}
                </div>
              ) : studyPartners[selectedChatUser.uid] === true || selectedChatUser.uid === firebaseUser?.uid ? (
                <AvelutMessageInput
                  inputRef={textInputRef}
                  onSend={(text) => sendMsg(text, 'text')}
                  startRecording={startRecording}
                  handleMove={handleMove}
                  stopRecording={stopRecording}
                  isRecording={isRecording}
                  isLocked={isLocked}
                  setIsLocked={setIsLocked}
                  recordDuration={recordDuration}
                  onFileSelect={handleFileSelection}
                  onImageSendWithCaption={handleImageSendWithCaption}
                  onTyping={() => handleTypingStatus('typing')}
                />
              ) : (
                <div className="w-[95%] mx-auto px-6 py-4 bg-amber-50/95 backdrop-blur-md border border-amber-200 rounded-2xl text-center flex flex-col items-center justify-center gap-3 shadow-lg">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#856404]">
                    <span>🔒</span>
                    <span>You can only message active Study Mates.</span>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {partnerRequests[selectedChatUser.uid]?.status === 'sent' ? (
                      <button
                        type="button"
                        onClick={() => cancelPartnerRequest(selectedChatUser)}
                        className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold rounded-xl border border-amber-200 transition-all select-none shadow-sm cursor-pointer"
                        title="Cancel Request"
                      >
                        Pending Approval (Cancel)
                      </button>
                    ) : partnerRequests[selectedChatUser.uid]?.status === 'received' ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => acceptPartnerRequest(selectedChatUser)}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all select-none shadow-sm cursor-pointer"
                        >
                          Accept Request
                        </button>
                        <button
                          type="button"
                          onClick={() => declinePartnerRequest(selectedChatUser)}
                          className="px-4 py-2 bg-white dark:bg-black hover:bg-red-50 text-red-600 border border-red-200 text-xs font-bold rounded-xl transition-all select-none shadow-sm cursor-pointer"
                        >
                          Decline
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => sendPartnerRequest(selectedChatUser)}
                        className="px-5 py-2.5 bg-[#009EE2] hover:bg-[#0070B8] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all select-none shadow-sm cursor-pointer"
                      >
                        Add Study Mate
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {messageActionTarget && (
              <div
                className="fixed inset-0 z-[80] animate-fade-in flex items-center justify-center p-4 select-none"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)'
                }}
                onClick={closeMessageActions}
              >
                <div
                  ref={messageActionMenuRef}
                  className="flex flex-col gap-3 items-center animate-scale-in max-w-sm w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Floating Emoji Reaction Bar */}
                  <div className="bg-[#F1F5F9] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-full px-3 py-1.5 shadow-2xl flex items-center gap-1 sm:gap-2">
                    {REACTION_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => void reactToMessage(emoji)}
                        className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center text-xl sm:text-2xl hover:scale-125 hover:-translate-y-1 transition-transform duration-200"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>

                  {/* Targeted Message Highlight Preview */}
                  {(() => {
                    const isMe = messageActionTarget.senderId === firebaseUser?.uid;
                    const rawText = typeof messageActionTarget.text === 'string' ? messageActionTarget.text : '';
                    let imageUrl = '';
                    if (messageActionTarget.type === 'image') {
                      imageUrl = resolveImageDisplayUrl(messageActionTarget);
                    }

                    return (
                      <div className={`w-full flex ${isMe ? 'justify-end' : 'justify-start'} px-2 max-w-[340px] sm:max-w-[380px]`}>
                        <div className={`message-bubble ${isMe ? 'outgoing' : 'incoming'} shadow-2xl border border-white/10`}>
                          <div className="flex flex-col w-full">
                            {messageActionTarget.is_forwarded && (
                              <div className="flex items-center gap-1 mb-1 text-[10px] opacity-70 italic">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 21l9-9-9-9v6H3v6h9z" /></svg>
                                Forwarded
                              </div>
                            )}
                            {messageActionTarget.replyTo && (
                              <div className={`mb-1.5 p-2 rounded bg-black/10 dark:bg-white/10 text-[12px] border-l-2 ${isMe ? 'border-white/50 text-white/90' : 'border-[#009EE2]/50 text-[#111B21]/80 dark:text-gray-200/90'}`}>
                                <div className="font-bold">{messageActionTarget.replyTo.senderName}</div>
                                <div className="truncate max-w-[200px] sm:max-w-[280px] opacity-80">{messageActionTarget.replyTo.text}</div>
                              </div>
                            )}
                            <div className="message-content">
                              {messageActionTarget.type === 'voice' ? (
                                <VoiceNotePlayer
                                  src={rawText.match(/\((.*?)\)/)?.[1] || rawText}
                                  isMe={isMe}
                                  isUploading={messageActionTarget.isUploading}
                                />
                              ) : messageActionTarget.type === 'image' ? (
                                <div className="rounded-[16px] overflow-hidden max-w-[280px] sm:max-w-[340px] w-full bg-transparent relative flex flex-col">
                                  {imageUrl && (
                                    <img src={imageUrl} alt="" className="max-h-[220px] w-full object-cover" />
                                  )}
                                  {(() => {
                                    const extractedCaption = extractImageCaption(rawText);
                                    if (!extractedCaption) return null;
                                    return (
                                      <div className="message-text">
                                        <ReactMarkdown
                                          components={{
                                            p: ({ node, ...props }: any) => <p className="m-0 inline" {...props} />,
                                            a: ({ node, ...props }: any) => <a className="text-[#009EE2] underline break-all" target="_blank" rel="noreferrer" {...props} />
                                          }}
                                        >
                                          {extractedCaption}
                                        </ReactMarkdown>
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <div className="message-text">
                                  <ReactMarkdown
                                    components={{
                                      p: ({ node, ...props }: any) => <p className="m-0 inline" {...props} />,
                                      a: ({ node, ...props }: any) => <a className="text-[#009EE2] underline break-all" target="_blank" rel="noreferrer" {...props} />
                                    }}
                                  >
                                    {rawText}
                                  </ReactMarkdown>
                                </div>
                              )}
                              <div className="message-time">
                                <span>{formatChatTimestamp(messageActionTarget.timestamp)}</span>
                                {isMe && <DoubleCheckIcon color={messageActionTarget.isRead ? '#009EE2' : '#667'} />}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Floating Context Action Menu */}
                  <div className="bg-[#F1F5F9] dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl shadow-2xl w-60 p-1.5 flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReplyingTo(messageActionTarget);
                        closeMessageActions();
                      }}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/80 transition-colors"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <span>Reply</span>
                      <i className="bi bi-reply-fill text-lg text-[#009EE2]"></i>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copyMessageContent();
                      }}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/80 transition-colors"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <span>Copy</span>
                      <i className="bi bi-copy text-base text-slate-500 dark:text-slate-400"></i>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setForwardTargetContent(messageActionTarget.text || '');
                        setForwardTargetType(messageActionTarget.type || 'text');
                        setIsForwardModalOpen(true);
                        closeMessageActions();
                      }}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/80 transition-colors"
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <span>Forward</span>
                      <i className="bi bi-share-fill text-base text-slate-500 dark:text-slate-400"></i>
                    </button>

                    {messageActionTarget.senderId === firebaseUser?.uid && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          promptDeleteMessageModal();
                        }}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                      >
                        <span>Delete</span>
                        <i className="bi bi-trash-fill text-base text-rose-500"></i>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        ) : (
          <div className="mx-auto max-w-md px-6 text-center select-none">
            <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[30px] bg-white dark:bg-black shadow-sm border border-[#E9ECEF] dark:border-transparent">
              <img src="/logo_icon.png" alt="AVELUT" className="w-14 h-14 object-contain" />
            </div>
            <h2 className="mt-5 text-2xl font-black tracking-wide text-[#212529] dark:text-white">AVELUT</h2>
            <p className="mt-2 text-sm leading-6 text-[#6C757D] dark:text-gray-400">Pick a person to start a new chat and connect with them.</p>
          </div>
        )}
      </div>


      {/* Delete Chat Confirmation Dialog */}
      {showDeleteChatConfirmDialog && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in select-none"
          onClick={() => setShowDeleteChatConfirmDialog(false)}
        >
          <div
            className="bg-white dark:bg-[#111111] rounded-[28px] shadow-2xl max-w-sm w-full p-6 border border-slate-100 dark:border-slate-800 animate-scale-in flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-normal text-[#111B21] dark:text-gray-100">
              Delete {selectedChatIds.length > 1 ? `these ${selectedChatIds.length} chats?` : 'this chat?'}
            </h3>

            <div className="flex items-center justify-end gap-6 pt-6">
              <button
                type="button"
                onClick={() => setShowDeleteChatConfirmDialog(false)}
                className="text-[#008069] dark:text-[#25D366] font-medium text-sm hover:opacity-80 transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={async () => {
                  if (!firebaseUser) return;
                  try {
                    const updates: any = {};
                    for (const chatId of selectedChatIds) {
                      const chat = chats.find(c => c.id === chatId);
                      const otherUserId = chat?.otherUserId || chat?.otherUser?.uid;
                      updates[`user_chats/${firebaseUser.uid}/${chatId}`] = null;
                      if (otherUserId) {
                        updates[`user_chats/${otherUserId}/${chatId}`] = null;
                      }
                      updates[`messages/${chatId}`] = null;
                    }
                    await update(dbRef(db), updates);
                    if (activeChat && selectedChatIds.includes(activeChat.chatId)) {
                      setActiveChat(null);
                      setMessages([]);
                      setOptimisticMessages([]);
                    }
                    addToast(`${selectedChatIds.length} ${selectedChatIds.length > 1 ? 'chats' : 'chat'} deleted.`, 'success');
                  } catch (err: any) {
                    console.error('Failed to delete selected chats:', err);
                    addToast('Failed to delete chats.', 'error');
                  } finally {
                    setSelectedChatIds([]);
                    setShowDeleteChatConfirmDialog(false);
                  }
                }}
                className="text-[#008069] dark:text-[#25D366] font-medium text-sm hover:opacity-80 transition cursor-pointer"
              >
                Delete chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Message Confirmation Modal */}
      {deleteConfirmTarget && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none"
          onClick={() => setDeleteConfirmTarget(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-[28px] shadow-2xl max-w-xs sm:max-w-sm w-full p-6 border border-slate-100 dark:border-slate-800 animate-scale-in flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-slate-700 dark:text-slate-200">
              Delete message?
            </h3>

            <div className="flex flex-col items-end gap-3.5 mt-2">
              {deleteConfirmTarget.senderId === firebaseUser?.uid && (
                <button
                  type="button"
                  onClick={() => handleDeleteMessageAction(true)}
                  className="text-[15px] font-bold text-emerald-800 dark:text-emerald-400 hover:opacity-80 transition active:scale-95 text-right"
                >
                  Delete for everyone
                </button>
              )}

              <button
                type="button"
                onClick={() => handleDeleteMessageAction(false)}
                className="text-[15px] font-bold text-emerald-800 dark:text-emerald-400 hover:opacity-80 transition active:scale-95 text-right"
              >
                Delete for me
              </button>

              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                className="text-[15px] font-bold text-emerald-800 dark:text-emerald-400 hover:opacity-80 transition active:scale-95 text-right mt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report User Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-black rounded-2xl shadow-2xl max-w-sm w-full p-6 border border-slate-100 animate-slide-up">
            <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">Report User</h3>
            <p className="text-sm text-slate-500 dark:text-gray-400 mb-4 font-semibold">Why are you reporting this user?</p>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full mb-4 p-3 border border-slate-200 dark:border-transparent rounded-xl text-sm font-bold text-slate-700 bg-slate-50 dark:bg-black outline-none"
            >
              <option value="spam">Spam / Unsolicited Messages</option>
              <option value="harassment">Harassment / Bullying</option>
              <option value="inappropriate">Inappropriate Content</option>
              <option value="scam">Scam / Fraud</option>
              <option value="other">Other</option>
            </select>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowReportModal(false)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
              <button onClick={handleReportSubmit} className="px-4 py-2 text-sm font-black text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors">Submit Report</button>
            </div>
          </div>
        </div>
      )}

      {/* Forward Message Modal */}
      {isForwardModalOpen && (
        <ForwardModal
          isOpen={isForwardModalOpen}
          onClose={() => {
            setIsForwardModalOpen(false);
            setForwardTargetContent('');
          }}
          messageText={forwardTargetContent}
          messageType={forwardTargetType}
          studyPartners={studyPartners}
          allUsers={allUsers}
          onForward={async (recipientIds) => {
            await forwardMessageToUsers(forwardTargetContent, forwardTargetType, recipientIds);
            setIsForwardModalOpen(false);
            setForwardTargetContent('');
          }}
        />
      )}

      {/* Fullscreen Image Preview Modal */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewImageUrl(null)}>
          <div className="relative max-w-5xl w-full h-full flex flex-col items-center justify-center">
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewImageUrl(null); }}
              className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 text-white rounded-full w-10 h-10 flex items-center justify-center backdrop-blur-md transition-colors"
            >
              ✕
            </button>
            <img
              src={previewImageUrl}
              alt="Preview"
              className="max-w-full max-h-full object-contain select-none"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Dedicated Partner Management Modal */}
      {isPartnerModalOpen && (
        <PartnerManagementModal
          isOpen={isPartnerModalOpen}
          onClose={() => setIsPartnerModalOpen(false)}
          activeTab={partnerModalTab}
          setActiveTab={setPartnerModalTab}
          subView={partnerModalSubView}
          setSubView={setPartnerModalSubView}
          allUsers={safeAllUsers}
          studyPartners={safeStudyPartners}
          partnerRequests={safePartnerRequests}
          onOpenChat={(user) => {
            openChatWithUser(user);
            setIsPartnerModalOpen(false);
          }}
          sendPartnerRequest={sendPartnerRequest}
          acceptPartnerRequest={acceptPartnerRequest}
          declinePartnerRequest={declinePartnerRequest}
          cancelPartnerRequest={cancelPartnerRequest}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
};

// Standalone Forward Modal component for reuse and clean scope
interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  messageText: string;
  messageType: string;
  studyPartners: Record<string, boolean>;
  allUsers: UserProfile[];
  onForward: (recipientIds: string[]) => Promise<void>;
}

const ForwardModal: React.FC<ForwardModalProps> = ({
  isOpen,
  onClose,
  messageText,
  messageType,
  studyPartners,
  allUsers,
  onForward
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const safeAllUsers = useMemo(() => ensureArray<UserProfile>(allUsers), [allUsers]);
  const safeStudyPartners = useMemo(() => (studyPartners && typeof studyPartners === 'object' && !Array.isArray(studyPartners)) ? studyPartners : {}, [studyPartners]);
  const partnersList = useMemo(() => {
    const list = safeAllUsers.filter(u => u && safeStudyPartners[u.uid] === true);
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(u => (u?.display_name || '').toLowerCase().includes(q) || (u?.department_id || '').toLowerCase().includes(q));
  }, [safeAllUsers, safeStudyPartners, searchQuery]);
  const handleToggleSelect = (uid: string) => {
    setSelectedIds(prev =>
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const handleForwardAction = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      await onForward(selectedIds);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-black w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-[#E9ECEF] dark:border-transparent flex flex-col max-h-[75vh] animate-scale-in">
        {/* Header */}
        <div className="p-5 border-b border-[#E9ECEF] dark:border-transparent flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#212529] dark:text-white">Forward Message</h2>
            <p className="text-[11px] text-[#6C757D] dark:text-gray-400 font-medium mt-0.5">Select one or more study partners to send this message to.</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="w-7 h-7 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center text-[#6C757D] dark:text-gray-400 text-xs font-bold transition"
          >
            ✕
          </button>
        </div>

        {/* Content preview */}
        <div className="px-5 py-3.5 bg-neutral-50 border-b border-[#E9ECEF] dark:border-transparent text-xs font-medium text-[#6C757D] dark:text-gray-400">
          <span className="font-bold uppercase tracking-wider block text-[10px] text-[#6C757D] dark:text-gray-400 mb-1">Message Preview</span>
          <p className="truncate max-w-full italic text-neutral-600">
            {messageType === 'voice' ? '🎵 Voice message' : messageType === 'image' ? '📷 Image file' : messageText}
          </p>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-[#E9ECEF] dark:border-transparent">
          <input
            type="text"
            placeholder="Search partners..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#F8F9FA] dark:bg-black text-sm text-[#212529] dark:text-white px-4 py-2 rounded-xl border border-[#E9ECEF] dark:border-transparent focus:outline-none focus:ring-2 focus:ring-[#009EE2]/20 focus:border-[#009EE2] transition shadow-inner"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {partnersList.length === 0 ? (
            <p className="text-center text-xs font-medium text-[#6C757D] dark:text-gray-400 py-8 italic">No study partners found</p>
          ) : (
            partnersList.map(u => {
              const isChecked = selectedIds.includes(u.uid);
              return (
                <div
                  key={u.uid}
                  onClick={() => handleToggleSelect(u.uid)}
                  className={`flex items-center justify-between p-3 rounded-2xl border transition cursor-pointer select-none ${isChecked ? 'bg-[#009EE2]/5 border-[#009EE2]' : 'bg-white dark:bg-black border-[#E9ECEF] dark:border-transparent hover:bg-neutral-50'}`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar className="w-9 h-9 rounded-full shrink-0 object-cover" photo_url={u.photo_url} display_name={u.display_name || 'User'} />
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-sm text-[#212529] dark:text-white truncate">{u.display_name}</h4>
                      <p className="text-[10px] text-[#6C757D] dark:text-gray-400 font-medium truncate mt-0.5">{u.department_id || 'No Department'}</p>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full border-2 transition ml-3" style={{
                    borderColor: isChecked ? '#009EE2' : '#CED4DA',
                    backgroundColor: isChecked ? '#009EE2' : 'transparent'
                  }}>
                    {isChecked && (
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[#E9ECEF] dark:border-transparent bg-[#F8F9FA] dark:bg-black flex gap-3 shrink-0">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 bg-white dark:bg-black hover:bg-neutral-100 border border-[#E9ECEF] dark:border-transparent text-[#6C757D] dark:text-gray-400 font-bold text-xs uppercase tracking-wider py-3.5 rounded-xl transition cursor-pointer select-none disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleForwardAction}
            disabled={selectedIds.length === 0 || submitting}
            className="flex-1 bg-[#009EE2] hover:bg-[#0070B8] text-white font-black text-xs uppercase tracking-wider py-3.5 rounded-xl transition cursor-pointer select-none disabled:opacity-50 disabled:bg-neutral-300"
          >
            {submitting ? 'Forwarding...' : `Send (${selectedIds.length})`}
          </button>
        </div>
      </div>
    </div>
  );
};
