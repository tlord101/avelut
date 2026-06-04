import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';
import ReactMarkdown from 'react-markdown';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';
import { LogoIcon } from './icons/LogoIcon';
import { db, storage, auth, onAuthStateChanged, type FirebaseUser } from '../firebase';
import { ref as dbRef, onValue, off, set, push, update, onDisconnect, get, remove, serverTimestamp as firebaseServerTimestamp, query, limitToLast } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

const REACTION_EMOJIS = ['🔥', '😂', '😍', '👏', '😮', '😭', '👍', '❤️'];

// ================= REPLICA ICONS =================

const DoubleCheckIcon = ({ color = "#8696a0" }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12l5 5L20 4M7 12l5 5L20 7" />
  </svg>
);

const AttachmentIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#6C757D]">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#6C757D]">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-red-500">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
);

const LockIcon = ({ locked }: { locked: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[#6C757D]">
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

const MESSENGER_CACHE_VERSION = 'v1';

const getMessengerCacheKey = (uid: string, suffix: string) => `vantutor_messenger_${MESSENGER_CACHE_VERSION}_${uid}_${suffix}`;



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
    <div className="flex items-center gap-3 w-[260px] py-1 select-none">
      <button 
        type="button" 
        onClick={togglePlay}
        disabled={isUploading}
        className={`w-9 h-9 flex items-center justify-center rounded-full transition shrink-0 ${
          isMe ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-[#F8F9FA] text-[#486380] hover:bg-[#E9ECEF]'
        } ${isUploading ? 'cursor-not-allowed' : ''}`}
      >
        {isUploading ? (
          <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : isPlaying ? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      <div className="flex-1 flex flex-col gap-1.5 justify-center pr-1">
        <div className="w-full flex items-center gap-[2px] h-6 relative">
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

        <div className={`flex justify-between items-center text-[11px] font-medium ${isMe ? 'text-white/80' : 'text-[#6C757D]'}`}>
          <span>{isUploading ? "Uploading..." : formatTime(isPlaying ? currentTime : duration)}</span>
          <button 
            type="button" 
            onClick={handleSpeedChange}
            disabled={isUploading}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition ${
              isMe ? 'border-white/30 hover:bg-white/10' : 'border-[#E9ECEF] hover:bg-neutral-100'
            } ${isUploading ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
};

// =======================================================
// FLOATING ZOLA THEME INPUT COMPONENT
// =======================================================

interface VanTutorInputProps {
  onSend: (text: string) => void;
  startRecording: (e: any) => Promise<void>;
  handleMove: (e: React.MouseEvent | React.TouchEvent) => void;
  stopRecording: (shouldSave: boolean) => void;
  isRecording: boolean;
  isLocked: boolean;
  setIsLocked: (locked: boolean) => void;
  recordDuration: number;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const VanTutorMessageInput: React.FC<VanTutorInputProps> = ({
  onSend,
  startRecording,
  handleMove,
  stopRecording,
  isRecording,
  isLocked,
  setIsLocked,
  recordDuration,
  onFileSelect,
  onImageSelect
}) => {
  const [message, setMessage] = useState("");
  const [showTrashAnimation, setShowTrashAnimation] = useState(false);

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

  const handleVoicePress = (e: React.MouseEvent | React.TouchEvent) => {
    if (isLocked) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setStartX(clientX);
    setStartY(clientY);
    setCurrentX(clientX);
    setCurrentY(clientY);
    setIsSwiping(true);
    startRecording(e);
  };

  const handleVoiceMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isRecording || isLocked) return;
    handleMove(e);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setCurrentX(clientX);
    setCurrentY(clientY);

    const deltaY = clientY - startY;
    const deltaX = clientX - startX;

    if (deltaY < -80) {
      setIsLocked(true);
      setIsSwiping(false);
    }
    if (deltaX < -110) {
      discardVoice();
    }
  };

  const handleVoiceRelease = () => {
    if (!isSwiping) return;
    setIsSwiping(false);
    if (!isLocked) {
      stopRecording(true);
    }
  };

  const executeTextSend = () => {
    if (message.trim()) {
      onSend(message);
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

  return (
    <div className="w-full max-w-[800px] mx-auto relative select-none z-40 px-4">
      <input type="file" ref={fileInputRef} onChange={onFileSelect} className="hidden" multiple accept="*/*" />
      <input type="file" ref={imageInputRef} onChange={onImageSelect} className="hidden" multiple accept="image/*" />

      {isRecording && !isLocked && (
        <div 
          className="absolute right-[21px] bottom-[64px] w-[52px] h-[120px] bg-white rounded-full flex flex-col items-center justify-start py-4 gap-2 border border-[#E9ECEF] shadow-xl z-20"
          style={{ transform: `translateY(${Math.max(-20, swipeDeltaY * 0.15)}px)` }}
        >
          <div className="flex items-center justify-center animate-bounce" style={{ transform: `translateY(${Math.max(-50, swipeDeltaY * 0.5)}px)` }}>
            <LockIcon locked={false} />
          </div>
          <span className="text-[10px] text-[#6C757D] font-bold uppercase tracking-wider text-center leading-none mt-auto">Lock</span>
        </div>
      )}

      <div className="w-full flex items-center gap-2 relative">
     
        {!isRecording && !isLocked && (
          <div className="flex-1 h-[52px] bg-white border border-[#E9ECEF] rounded-full flex items-center pl-3.5 pr-4 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-all focus-within:ring-2 focus-within:ring-[#009EE2]/20 focus-within:border-[#009EE2]">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="hover:opacity-85 transition active:scale-90 shrink-0 flex items-center justify-center w-9 h-9 mr-1">
              <AttachmentIcon />
            </button>
            <div className="flex-1 h-full flex items-center min-w-0">
              <input 
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && executeTextSend()}
                placeholder="Message"
                className="w-full h-full bg-transparent text-[16px] text-[#212529] placeholder-[#80868B] outline-none border-none focus:ring-0"
              />
            </div>
            <button type="button" onClick={() => imageInputRef.current?.click()} className="hover:opacity-85 transition active:scale-90 flex items-center justify-center w-9 h-9 ml-1">
              <CameraIcon />
            </button>
          </div>
        )}

        {(isRecording || isLocked) && (
          <div className="flex-1 h-[52px] bg-white rounded-full flex items-center pl-4 pr-5 shadow-xl border border-[#E9ECEF] animate-fade-in relative overflow-hidden">
            <div className="flex items-center gap-2.5 shrink-0 z-10">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[16px] font-medium text-[#212529] tabular-nums">{formatTime(recordDuration)}</span>
            </div>
       
            {isLocked ? (
              <div className="flex-1 flex items-center justify-between pl-6 animate-fade-in z-10">
                <button onClick={discardVoice} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-neutral-100 active:scale-90 transition" type="button">
                  <TrashIcon />
                </button>
                <span className="text-xs text-[#6C757D] font-semibold tracking-wider">RECORDING LOCKED</span>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-end pr-4 z-10 transition-transform duration-75" style={{ transform: `translateX(${swipeDeltaX * 0.8}px)` }}>
                <span className="text-sm font-medium text-[#6C757D] flex items-center gap-1">
                  <span className="inline-block animate-slide-left font-bold">&lt;</span> Slide to cancel
                </span>
              </div>
            )}
            {!isLocked && <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-white/40 to-transparent w-24 pointer-events-none" />}
          </div>
        )}

        <div style={{ transform: isSwiping ? `translate(${swipeDeltaX * 0.2}px, ${swipeDeltaY * 0.5}px)` : 'none', transition: isSwiping ? 'none' : 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
          {hasText ? (
            <button type="button" onClick={executeTextSend} className="w-[52px] h-[52px] bg-[#009EE2] hover:bg-[#0089C4] text-white rounded-full flex items-center justify-center shadow-md shrink-0 transition-transform active:scale-95 duration-100">
              <SendIcon />
            </button>
          ) : isLocked ? (
            <button type="button" onClick={() => stopRecording(true)} className="w-[52px] h-[52px] bg-[#009EE2] hover:bg-[#0089C4] text-white rounded-full flex items-center justify-center shadow-md shrink-0 transition-transform active:scale-95 duration-100 animate-pulse">
              <SendIcon />
            </button>
          ) : (
            <div className="relative">
              {isRecording && <div className="absolute -inset-2 bg-[#009EE2]/20 rounded-full animate-ping pointer-events-none" />}
              <button 
                type="button"
                onMouseDown={handleVoicePress}
                onMouseMove={handleVoiceMove}
                onMouseUp={handleVoiceRelease}
                onMouseLeave={handleVoiceRelease}
                onTouchStart={handleVoicePress}
                onTouchMove={handleVoiceMove}
                onTouchEnd={handleVoiceRelease}
                className={`w-[52px] h-[52px] bg-[#009EE2] text-white rounded-full flex items-center justify-center shadow-md shrink-0 transition-all select-none touch-none ${isRecording ? 'scale-125 bg-[#0089C4]' : 'hover:bg-[#0089C4] active:scale-95'}`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-[22px] h-[22px] text-white"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// MAIN UNIFORM LIGHT THEME MESSENGER
// ==========================================

export const Messenger: React.FC<{ userProfile: UserProfile; initialChatId?: string | null }> = ({ userProfile, initialChatId = null }) => {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [activeChat, setActiveChat] = useState<{ chatId: string, otherUser: UserProfile } | null>(null);
  const [chats, setChats] = useState<any[]>(() => readCachedJson<any[]>(getMessengerCacheKey(userProfile.uid, 'chats'), []));
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [messages, setMessages] = useState<any[]>(() => readCachedJson<any[]>(getMessengerCacheKey(userProfile.uid, 'messages_default'), []));
    const [isLoading, setIsLoading] = useState(true);
    const [tab, setTab] = useState<'chats' | 'people'>('chats');
    const [peopleSearchQuery, setPeopleSearchQuery] = useState("");
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
    } | null>(null);
    const [messageActionPosition, setMessageActionPosition] = useState<{ x: number; y: number } | null>(null);
    
    const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
    const [fetchedUserProfiles, setFetchedUserProfiles] = useState<Record<string, UserProfile>>({});

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startYRef = useRef<number>(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messageActionMenuRef = useRef<HTMLDivElement>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastTapRef = useRef<{ id: string | null; time: number }>({ id: null, time: 0 });
    const chatRowLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressNextChatOpenRef = useRef(false);
    const unreadCountsRef = useRef<Record<string, number>>({});
    const lastNotificationTimestampRef = useRef<Record<string, number>>({});
    const { addToast } = useToast();

    const closeMessageActions = () => {
      setMessageActionTarget(null);
      setMessageActionPosition(null);
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
        icon: '/logo.svg',
        badge: '/logo.svg',
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

    const filteredPeople = useMemo(() => {
        if (!peopleSearchQuery.trim()) return allUsers;
        const normalizedQuery = peopleSearchQuery.toLowerCase();
        return allUsers.filter(u => {
            const name = (u.display_name || "").toLowerCase();
            return normalizedQuery.split("").every(letter => name.includes(letter));
        });
    }, [allUsers, peopleSearchQuery]);

    const userMap = useMemo(() => new Map(allUsers.map(user => [user.uid, user])), [allUsers]);

    const selectedChatUser = activeChat?.otherUser || createFallbackChatUser(activeChat?.chatId || '');

    const getUnreadCountForUser = useCallback((otherUserId: string) => {
      if (!firebaseUser) return 0;
      const chatId = [firebaseUser.uid, otherUserId].sort().join('_');
      const chat = chats.find(item => item.id === chatId);
      return chat ? getUnreadCount(chat) : 0;
    }, [chats, firebaseUser]);

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
      setTab('chats');

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
        const usersRef = dbRef(db, 'users');
        onValue(usersRef, (snap) => {
            const data = snap.val() || {};
            setAllUsers(Object.entries(data).map(([uid, u]: any) => ({
                uid,
                display_name: u.displayName || u.display_name || 'Learner',
                photo_url: u.photoURL || u.photo_url || '',
                is_online: u.is_online || false,
                last_seen: u.last_seen || 0,
                subscription_status: u.subscription_status || 'free',
                department_id: u.department_id || '',
                level: u.level || '',
                current_streak: u.current_streak || 0,
                last_activity_date: u.last_activity_date || 0,
                notifications_enabled: u.notifications_enabled || false,
            })));
        });
    }, []);

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
            const chatList = Object.entries(snap.val() || {}).map(([chatId, details]: any) => ({
          id: chatId,
          ...details,
          otherUser: createFallbackChatUser(details.otherUserId || chatId)
            }));

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
                lastMessageTimestamp > 0 &&
                lastMessageTimestamp !== lastNotifiedTimestamp
              ) {
                lastNotificationTimestampRef.current[chat.id] = lastMessageTimestamp;
                void showIncomingMessageNotification(chat, getLastMessagePreview(chat));
              }
            });

            unreadCountsRef.current = nextUnreadCounts;
            setChats(chatList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
            setIsLoading(false);
        });
    }, [firebaseUser]);

    useEffect(() => {
      if (!firebaseUser) return;
      writeCachedJson(getMessengerCacheKey(userProfile.uid, 'chats'), chats);
    }, [chats, firebaseUser, userProfile.uid]);

    useEffect(() => {
        if (!chats.length) return;
        chats.forEach(async (chat) => {
            const otherUserId = chat.otherUserId || chat.otherUser?.uid;
            if (!otherUserId) return;
            const resolvedUser = userMap.get(otherUserId) || fetchedUserProfiles[otherUserId];
            if (!resolvedUser) {
                try {
                    const snapshot = await get(dbRef(db, `users/${otherUserId}`));
                    if (snapshot.exists()) {
                        const u = snapshot.val();
                        const profile: UserProfile = {
                            uid: otherUserId,
                            display_name: u.displayName || u.display_name || 'Unknown User',
                            photo_url: u.photoURL || u.photo_url || '',
                            is_online: !!u.is_online,
                            last_seen: u.last_seen || 0,
                            department_id: u.department_id || '',
                            level: u.level || '',
                            current_streak: u.current_streak || 0,
                            last_activity_date: u.last_activity_date || Date.now(),
                            notifications_enabled: !!u.notifications_enabled,
                            subscription_status: u.subscription_status || 'free',
                        };
                        setFetchedUserProfiles(prev => ({ ...prev, [otherUserId]: profile }));
                    }
                } catch (err) {
                    console.error("Failed to fetch profile for user:", otherUserId, err);
                }
            }
        });
    }, [chats, userMap, fetchedUserProfiles]);

    useEffect(() => {
      if (!chats.length) return;
      setChats(prevChats => prevChats.map(chat => {
        const otherUserId = chat.otherUserId || chat.otherUser?.uid;
        const resolvedUser = otherUserId ? (userMap.get(otherUserId) || fetchedUserProfiles[otherUserId]) : undefined;
        return resolvedUser ? { ...chat, otherUser: resolvedUser } : chat;
      }));
    }, [userMap, fetchedUserProfiles]);

    useEffect(() => {
      if (!initialChatId || !chats.length) return;
      const nextChat = chats.find(chat => chat.id === initialChatId);
      if (!nextChat) return;
      setActiveChat({ chatId: nextChat.id, otherUser: nextChat.otherUser });
      setTab('chats');
    }, [initialChatId, chats]);

    useEffect(() => {
      if (!activeChat) {
        setMessages([]);
        return;
      }

      setMessages(readCachedJson<any[]>(getMessengerCacheKey(userProfile.uid, `messages_${activeChat.chatId}`), []));
        setOptimisticMessages([]);
        const messagesRef = dbRef(db, `messages/${activeChat.chatId}`);
        const messagesQuery = query(messagesRef, limitToLast(50));
        onValue(messagesQuery, (snap) => {
            const cloudMsgs = Object.entries(snap.val() || {}).map(([id, msg]: any) => ({ id, ...msg })).sort((a, b) => a.timestamp - b.timestamp);
            setMessages(cloudMsgs);
            
            // Fixed removal logic to filter out only valid matches safely
            setOptimisticMessages(prev => prev.filter(opt => !cloudMsgs.some(cloud => cloud.timestamp === opt.timestamp)));
            
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
            if (firebaseUser) {
              set(dbRef(db, `user_chats/${firebaseUser.uid}/${activeChat.chatId}/unreadCount`), 0);
            }
        });
        return () => off(messagesRef);
    }, [activeChat, firebaseUser, userProfile.uid]);

    useEffect(() => {
      if (!firebaseUser || !activeChat) return;
      writeCachedJson(getMessengerCacheKey(userProfile.uid, `messages_${activeChat.chatId}`), messages);
    }, [activeChat, firebaseUser, messages, userProfile.uid]);

    const combinedMessageStream = useMemo(() => {
        return [...messages, ...optimisticMessages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
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
        reactions: msg.reactions || {}
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
        await navigator.clipboard.writeText(copiedValue);
        addToast('Message copied.', 'success');
      } catch (error) {
        addToast('Copy failed on this device.', 'error');
      }
      closeMessageActions();
    };

    const deleteSelectedMessage = async () => {
      if (!messageActionTarget || !activeChat || !firebaseUser) return;
      if (messageActionTarget.senderId !== firebaseUser.uid) {
        addToast('You can only delete your own messages.', 'info');
        closeMessageActions();
        return;
      }

      try {
        await remove(dbRef(db, `messages/${activeChat.chatId}/${messageActionTarget.id}`));
        await updateChatMetaFromLatestMessage(activeChat.chatId, activeChat.otherUser.uid);
        addToast('Message deleted.', 'success');
      } catch (error: any) {
        console.error('Failed to delete message:', error);
        addToast(error?.message || 'Failed to delete message.', 'error');
      }
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
        const existingReactions = (msg.reactions && typeof msg.reactions === 'object') ? msg.reactions as Record<string, string> : {};
        const reactionPath = dbRef(db, `messages/${activeChat.chatId}/${msg.id}/reactions/${firebaseUser.uid}`);
        if (existingReactions[firebaseUser.uid] === emoji) {
          await remove(reactionPath);
          addToast('Reaction removed.', 'info');
        } else {
          await set(reactionPath, emoji);
          addToast('Reacted with ❤️', 'success');
        }
      } catch (error: any) {
        console.error('Failed to quick react to message:', error);
        addToast(error?.message || 'Quick reaction failed.', 'error');
      }
    };

    const handleFileSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!activeChat || !e.target.files || e.target.files.length === 0 || !firebaseUser) return;
        const selectedFiles = Array.from(e.target.files);
        for (const file of selectedFiles) {
            const localTimestamp = Date.now();
            const tempId = `temp_file_${localTimestamp}`;
            const fileType = file.type.startsWith('image/') ? 'image' : 'file';
            
            const pendingMessage = {
                id: tempId,
                senderId: firebaseUser.uid,
                text: `[📄 ${file.name}]()`,
                type: fileType,
                timestamp: localTimestamp,
                isUploading: true
            };
            setOptimisticMessages(prev => [...prev, pendingMessage]);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

            try {
                const cloudPath = `chat_files/${activeChat.chatId}/${localTimestamp}_${file.name}`;
                const fileBucketRef = storageRef(storage, cloudPath);
                const snapshot = await uploadBytes(fileBucketRef, file);
                const fileDownloadUrl = await getDownloadURL(snapshot.ref);
                if (file.type.startsWith('image/')) {
                    await sendMsg(`![${file.name}](${fileDownloadUrl})`, 'image');
                } else {
                    await sendMsg(`[📄 ${file.name}](${fileDownloadUrl})`, 'file');
                }
            } catch (err) {
                // Safeguarded catch wrapper from leaking standard error object down state tracking arrays
              addToast(`Failed to upload asset: ${file.name}`, 'error');
                setOptimisticMessages(prev => prev.filter(m => m.id !== tempId));
            }
        }
    };

    const handleImageSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!activeChat || !e.target.files || e.target.files.length === 0 || !firebaseUser) return;
        const selectedImages = Array.from(e.target.files);
        for (const img of selectedImages) {
            const localTimestamp = Date.now();
            const tempId = `temp_img_${localTimestamp}`;
            
            const pendingMessage = {
                id: tempId,
                senderId: firebaseUser.uid,
                text: `![Captured Image]()`,
                type: 'image',
                timestamp: localTimestamp,
                isUploading: true
            };
            setOptimisticMessages(prev => [...prev, pendingMessage]);
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

            try {
                const cloudPath = `chat_files/${activeChat.chatId}/${localTimestamp}_camera_${img.name}`;
                const fileBucketRef = storageRef(storage, cloudPath);
                const snapshot = await uploadBytes(fileBucketRef, img);
                const fileDownloadUrl = await getDownloadURL(snapshot.ref);
                await sendMsg(`![Captured Image](${fileDownloadUrl})`, 'image');
            } catch (err) {
              addToast('Failed to upload visual layout media.', 'error');
                setOptimisticMessages(prev => prev.filter(m => m.id !== tempId));
            }
        }
    };

    const startRecording = async (e: any) => {
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

                        const pendingMessage = {
                            id: tempId,
                            senderId: firebaseUser.uid,
                            text: `[Voice Note](${blobLocalUrl})`,
                            type: 'voice',
                            timestamp: localTimestamp,
                            isUploading: true
                        };
                        
                        setOptimisticMessages(prev => [...prev, pendingMessage]);
                        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

                        try {
                            const path = `voice_notes/${activeChat?.chatId}/${localTimestamp}.webm`;
                            const url = await getDownloadURL(await uploadBytes(storageRef(storage, path), blob).then(s => s.ref));
                            await sendMsg(`[Voice Note](${url})`, 'voice');
                        } catch (uploadError) {
                            console.error("Voice Note storage syncing failure:", uploadError);
                            setOptimisticMessages(prev => prev.filter(m => m.id !== tempId));
                        }
                    }
                }
                stream.getTracks().forEach(t => t.stop());
            };

            recorder.start();
            setIsRecording(true);
            setRecordDuration(0);
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
        if (timerRef.current) clearInterval(timerRef.current);
        if (mediaRecorderRef.current) {
            (mediaRecorderRef.current as any).shouldSave = shouldSave;
            mediaRecorderRef.current.stop();
        }
    };

    const sendMsg = async (text: string, type = 'text') => {
        if ((!text.trim() && type === 'text') || !activeChat || !firebaseUser) {
          addToast('Open a chat first, then send a message.', 'info');
          return;
        }

        const msgRef = push(dbRef(db, `messages/${activeChat.chatId}`));
        const clientTimestamp = Date.now();
        const optimisticId = msgRef.key || `${clientTimestamp}`;
        const data = { senderId: firebaseUser.uid, text, type, timestamp: firebaseServerTimestamp() };
        const optimisticMessage = { id: optimisticId, ...data, timestamp: clientTimestamp };

        setMessages(prev => [...prev, optimisticMessage]);

        try {
          await set(msgRef, data);
          const updates: any = {};
          let summaryText = text;
          if (type === 'voice') summaryText = '🎵 Voice message';
          else if (type === 'image') summaryText = '📷 Image file';
          else if (type === 'file') summaryText = '📄 Document file';
          const metaTimestamp = firebaseServerTimestamp();
          const unreadSnapshot = await get(dbRef(db, `user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/unreadCount`));
          const unreadCount = Number(unreadSnapshot.val() || 0);
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
            updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/unreadCount`] = unreadCount + 1;
          }
          await update(dbRef(db), updates);
        } catch (error: any) {
          setMessages(prev => prev.filter(message => message.id !== optimisticId));
          console.error('Failed to send message:', error);
          addToast(error?.message || 'Message failed to send.', 'error');
        }
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-[#F8F9FA] font-sans antialiased text-[#212529]">
            {/* Sidebar Pane */}
            <div className={`w-full lg:w-[380px] border-r border-[#E9ECEF] flex flex-col ${activeChat ? 'hidden lg:flex' : 'flex'} h-full bg-white`}>
                <div className="p-4 bg-[#F8F9FA] border-b border-[#E9ECEF] shrink-0">
                    <h1 className="text-xl font-bold text-[#212529] mb-4">Messages</h1>
                    <div className="flex gap-2 bg-[#E9ECEF] p-1 rounded-full mb-3">
                        <button onClick={() => setTab('chats')} className={`flex-1 py-1.5 text-sm rounded-full font-medium transition-all ${tab === 'chats' ? 'bg-white text-[#212529] shadow-sm' : 'text-[#6C757D] hover:text-[#212529]'}`}>Chats</button>
                        <button onClick={() => setTab('people')} className={`flex-1 py-1.5 text-sm rounded-full font-medium transition-all ${tab === 'people' ? 'bg-white text-[#212529] shadow-sm' : 'text-[#6C757D] hover:text-[#212529]'}`}>People</button>
                    </div>

                    {/* Search Bar */}
                    {tab === 'people' && (
                        <div className="relative">
                            <input 
                                type="text"
                                placeholder="Search people..."
                                value={peopleSearchQuery}
                                onChange={(e) => setPeopleSearchQuery(e.target.value)}
                                className="w-full bg-white text-sm text-[#212529] placeholder-[#80868B] px-4 py-2 rounded-full border border-[#E9ECEF] focus:outline-none focus:ring-2 focus:ring-[#009EE2]/20 focus:border-[#009EE2] transition-all shadow-sm"
                            />
                            {peopleSearchQuery && (
                                <button onClick={() => setPeopleSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6C757D] text-xs hover:text-[#212529]">✕</button>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto bg-white">
                    {tab === 'chats' ? chats.map(c => (
                      <div
                        key={c.id}
                        onClick={() => {
                          if (suppressNextChatOpenRef.current) {
                            suppressNextChatOpenRef.current = false;
                            return;
                          }
                          setActiveChat({ chatId: c.id, otherUser: c.otherUser });
                        }}
                        onTouchStart={() => startChatRowLongPress(c)}
                        onTouchEnd={clearChatRowLongPress}
                        onTouchCancel={clearChatRowLongPress}
                        onTouchMove={clearChatRowLongPress}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          void handleDeleteChatThread(c);
                        }}
                        className={`flex items-center gap-3 p-4 hover:bg-[#F8F9FA] cursor-pointer border-b border-[#E9ECEF] transition ${activeChat?.chatId === c.id ? 'bg-[#F8F9FA]' : ''}`}
                      >
                             <Avatar className="w-11 h-11 rounded-full shrink-0 object-cover border border-[#E9ECEF]" photo_url={c.otherUser?.photo_url} display_name={c.otherUser?.display_name || 'Learner'} />
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center mb-0.5">
                                    <h3 className={`text-[15px] truncate flex items-center gap-1.5 ${getUnreadCount(c) > 0 ? 'font-bold text-[#212529]' : 'font-medium text-[#212529]'}`}>
                                      <span>{c.otherUser?.display_name}</span>
                                      <VerificationBadge status={c.otherUser?.subscription_status} />
                                    </h3>
                                    <span className="text-[12px] text-[#6C757D]">10:16 AM</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1 min-w-0">
                                        <DoubleCheckIcon color="#009EE2" />
                                      <p className={`text-[14px] truncate ${getUnreadCount(c) > 0 ? 'font-bold text-[#212529]' : 'text-[#6C757D]'}`}>{getLastMessagePreview(c)}</p>
                                    </div>
                                    {getUnreadCount(c) > 0 && (
                                      <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                                            {getUnreadCount(c) > 99 ? '99+' : getUnreadCount(c)}
                                        </span>
                                    )}
                                </div>
                                <p className="text-[11px] mt-1 text-[#6C757D] font-normal">
                                    {c.otherUser?.is_online ? <span className="text-[#28A745]">online</span> : formatLastSeen(c.otherUser?.last_seen)}
                                </p>
                            </div>
                        </div>
                    )) : filteredPeople.map(u => {
                        const unreadCount = getUnreadCountForUser(u.uid);
                        return (
                        <div key={u.uid} onClick={() => openChatWithUser(u)} className="flex items-center gap-3 p-4 hover:bg-[#F8F9FA] cursor-pointer border-b border-[#E9ECEF] transition">
                             <Avatar className="w-10 h-10 rounded-full shrink-0 object-cover border border-[#E9ECEF]" photo_url={u.photo_url} display_name={u.display_name || 'Learner'} />
                            <div className="min-w-0 flex-1">
                              <h3 className={`text-[15px] truncate flex items-center gap-1.5 ${unreadCount > 0 ? 'font-bold text-[#212529]' : 'font-medium text-[#212529]'}`}>
                                <span>{u.display_name}</span>
                                <VerificationBadge status={u.subscription_status} />
                              </h3>
                              <p className="text-[11px] text-[#6C757D] font-normal">{u.is_online ? <span className="text-[#28A745]">online</span> : formatLastSeen(u.last_seen)}</p>
                            </div>
                            {unreadCount > 0 && (
                              <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                                {unreadCount > 99 ? '99+' : unreadCount}
                              </span>
                            )}
                        </div>
                        );
                    })}
                </div>
            </div>

            {/* Main Chat Viewport */}
            <div className={`flex-1 flex flex-col h-full bg-[#F8F9FA] relative ${!activeChat ? 'hidden lg:flex items-center justify-center' : 'flex'}`}>
                {activeChat ? (
                    <div className="flex flex-col h-full w-full relative overflow-hidden">
                        
                        {/* 1. FIXED Header Bar */}
                        <div className="h-16 bg-white flex items-center px-6 gap-3 z-30 shadow-sm shrink-0 border-b border-[#E9ECEF]">
                            <button onClick={() => setActiveChat(null)} className="lg:hidden text-[#6C757D] mr-1 text-lg">←</button>
                             <Avatar className="w-9 h-9 rounded-full object-cover border border-[#E9ECEF]" photo_url={selectedChatUser.photo_url} display_name={selectedChatUser.display_name || 'Learner'} />
                            <div className="flex-1 min-w-0">
                              <h2 className="font-semibold text-[#212529] text-[16px] leading-tight truncate flex items-center gap-1.5">
                                <span>{selectedChatUser.display_name}</span>
                                <VerificationBadge status={selectedChatUser.subscription_status} />
                              </h2>
                                <p className="text-[12px] text-[#6C757D] font-normal mt-0.5 flex items-center">
                                {selectedChatUser.is_online ? (
                                        <>
                                            <span className="w-1.5 h-1.5 bg-[#28A745] rounded-full mr-1 animate-pulse"></span>
                                            <span className="text-[#28A745]">Online</span>
                                        </>
                                ) : formatLastSeen(selectedChatUser.last_seen)}
                                </p>
                            </div>
                        </div>

                        {/* 2. SCROLLABLE Message Stream Box Container */}
                        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-6 max-w-3xl mx-auto w-full">
                            {combinedMessageStream.length === 0 ? (
                              <div className="flex min-h-[48vh] flex-col items-center justify-center text-center">
                                <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-white shadow-sm border border-[#E9ECEF]">
                                  <LogoIcon className="h-11 w-11" />
                                </div>
                                <p className="mt-5 text-xs font-bold uppercase tracking-[0.24em] text-[#6C757D]">New contact</p>
                                <h2 className="mt-2 text-2xl font-black text-[#212529]">Start a chat to connect</h2>
                                <p className="mt-2 max-w-md text-sm leading-6 text-[#6C757D]">
                                  Say hello to {selectedChatUser.display_name}. Your first message will create the conversation.
                                </p>
                              </div>
                            ) : combinedMessageStream.map((msg) => {
                                const isMe = msg.senderId === firebaseUser?.uid;
                                
                                // Safe string checks on markdown regex match selectors
                                const rawText = typeof msg.text === 'string' ? msg.text : '';
                                const imageUrl = msg.type === 'image' ? (rawText.match(/\((.*?)\)/)?.[1] || rawText) : '';
                              const reactionMap = (msg.reactions && typeof msg.reactions === 'object') ? msg.reactions as Record<string, string> : {};
                              const reactionCounts = Object.values(reactionMap).reduce((acc: Record<string, number>, reactionEmoji: string) => {
                                acc[reactionEmoji] = (acc[reactionEmoji] || 0) + 1;
                                return acc;
                              }, {});
                              const sortedReactions = Object.entries(reactionCounts).sort((a, b) => b[1] - a[1]);
                                
                                return (
                                    <div key={msg.id} className="space-y-1">
                                        <div className={`flex items-end space-x-2.5 w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                                            {!isMe && (
                                                <Avatar className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-[#E9ECEF]" photo_url={selectedChatUser.photo_url} display_name={selectedChatUser.display_name || 'Learner'} />
                                            )}
                                            
                                            <div className={`px-5 py-3.5 shadow-sm max-w-[80%] text-[15px] md:text-[16px] relative select-text ${
                                                isMe 
                                                    ? 'bg-[#009EE2] text-white rounded-[24px] rounded-tr-[4px]' 
                                                    : 'bg-white text-[#212529] rounded-[24px] rounded-bl-[4px] border border-[#E9ECEF]'
                                    }`}
                                      onContextMenu={(event) => {
                                        event.preventDefault();
                                        openMessageActions(msg, event.clientX, event.clientY);
                                      }}
                                      onTouchStart={(event) => {
                                        if (!event.touches[0]) return;
                                        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                        const touch = event.touches[0];
                                        longPressTimerRef.current = setTimeout(() => {
                                          openMessageActions(msg, touch.clientX, touch.clientY);
                                        }, 450);
                                      }}
                                      onTouchEnd={() => {
                                        if (longPressTimerRef.current) {
                                          clearTimeout(longPressTimerRef.current);
                                          longPressTimerRef.current = null;
                                        }

                                        const now = Date.now();
                                        const lastTap = lastTapRef.current;
                                        const isDoubleTap = lastTap.id === msg.id && (now - lastTap.time) < 320;

                                        if (isDoubleTap) {
                                          void quickReactToMessage(msg, '❤️');
                                          lastTapRef.current = { id: null, time: 0 };
                                          return;
                                        }

                                        lastTapRef.current = { id: msg.id, time: now };
                                      }}
                                      onTouchMove={() => {
                                        if (longPressTimerRef.current) {
                                          clearTimeout(longPressTimerRef.current);
                                          longPressTimerRef.current = null;
                                        }
                                      }}
                                    >
                                                
                                                {/* Voice Note Player */}
                                                {msg.type === 'voice' ? (
                                                    <VoiceNotePlayer 
                                                        src={rawText.match(/\((.*?)\)/)?.[1] || rawText} 
                                                        isMe={isMe}
                                                        isUploading={msg.isUploading}
                                                    />
                                                ) : msg.type === 'image' ? (
                                                    <div className="rounded-[16px] overflow-hidden max-w-[280px] sm:max-w-[340px] w-full bg-neutral-100 relative">
                                                        {msg.isUploading || !imageUrl ? (
                                                            <div className="h-[200px] w-full flex flex-col items-center justify-center text-xs text-neutral-400 gap-2 font-medium">
                                                                <svg className="animate-spin h-6 w-6 text-[#009EE2]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                                </svg>
                                                                Processing Media...
                                                            </div>
                                                        ) : (
                                                            <img src={imageUrl} alt="Shared Layout Media" className="max-h-[260px] w-full object-cover hover:opacity-95 cursor-pointer transition-opacity" />
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="leading-relaxed break-words whitespace-pre-wrap tracking-wide font-sans">
                                                        <ReactMarkdown 
                                                            components={{
                                                                p: ({node, ...props}) => <p className="m-0 inline" {...props} />,
                                                                a: ({node, ...props}) => <a className={`${isMe ? 'text-white underline font-medium' : 'text-[#009EE2] underline'} break-all`} target="_blank" rel="noreferrer" {...props} />
                                                            }}
                                                        >
                                                            {rawText}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}

                                                {/* Meta Timestamp */}
                                                <div className={`flex items-center justify-end gap-1 mt-1.5 text-[10px] select-none pointer-events-none ${isMe ? 'text-white/70' : 'text-[#6C757D]'}`}>
                                                    <span className="uppercase font-normal tracking-tight">
                                                        {msg.isUploading ? 'Sending...' : '12:53 PM'}
                                                    </span>
                                                    {isMe && !msg.isUploading && <DoubleCheckIcon color="white" />}
                                                </div>

                                                {sortedReactions.length > 0 && (
                                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                                    {sortedReactions.map(([emoji, count]) => (
                                                      <span key={`${msg.id}-${emoji}`} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isMe ? 'bg-white/20 text-white' : 'bg-[#E9ECEF] text-[#212529]'}`}>
                                                        {emoji} {count}
                                                      </span>
                                                    ))}
                                                  </div>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {!isMe && (
                                            <div className="pl-[46px] text-[13px] text-[#6C757D] font-normal">
                                            {selectedChatUser.display_name}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* 3. FIXED Bottom Control Anchor Panel Bar */}
                        <div className="bg-[#F8F9FA] py-4 border-t border-[#E9ECEF] shrink-0 z-30">
                            <VanTutorMessageInput 
                              onSend={(text) => sendMsg(text, 'text')}
                              startRecording={startRecording}
                              handleMove={handleMove}
                              stopRecording={stopRecording}
                              isRecording={isRecording}
                              isLocked={isLocked}
                              setIsLocked={setIsLocked}
                              recordDuration={recordDuration}
                              onFileSelect={handleFileSelection}
                              onImageSelect={handleImageSelection}
                            />
                        </div>

                        {messageActionTarget && (
                          <div className="fixed inset-0 z-40 bg-black/20">
                            <div
                              ref={messageActionMenuRef}
                              className="absolute w-[min(92vw,320px)] rounded-2xl border border-[#E9ECEF] bg-white p-3 shadow-2xl"
                              style={{
                                left: `${Math.max(12, Math.min((messageActionPosition?.x || 24) - 140, window.innerWidth - 332))}px`,
                                top: `${Math.max(12, Math.min((messageActionPosition?.y || 24) - 80, window.innerHeight - 220))}px`
                              }}
                            >
                              <p className="px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#6C757D]">Message actions</p>
                              <div className="mb-3 flex flex-wrap gap-2">
                                {REACTION_EMOJIS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => void reactToMessage(emoji)}
                                    className="rounded-full border border-[#E9ECEF] bg-[#F8F9FA] px-2.5 py-1.5 text-base transition hover:bg-[#E9ECEF]"
                                    title={`React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                              <div className="space-y-2">
                                <button
                                  type="button"
                                  onClick={() => void copyMessageContent()}
                                  className="w-full rounded-xl border border-[#E9ECEF] bg-white px-3 py-2 text-left text-sm font-semibold text-[#212529] transition hover:bg-[#F8F9FA]"
                                >
                                  Copy message
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteSelectedMessage()}
                                  disabled={messageActionTarget.senderId !== firebaseUser?.uid}
                                  className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-left text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Delete message
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                    </div>
                ) : (
                  <div className="mx-auto max-w-md px-6 text-center select-none">
                    <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[30px] bg-white shadow-sm border border-[#E9ECEF]">
                      <LogoIcon className="w-14 h-14 text-[#6C757D]" />
                    </div>
                    <h2 className="mt-5 text-2xl font-black tracking-wide text-[#212529]">VANTUTOR</h2>
                    <p className="mt-2 text-sm leading-6 text-[#6C757D]">Pick a person to start a new chat and connect with them.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
