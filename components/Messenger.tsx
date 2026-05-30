import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';
import ReactMarkdown from 'react-markdown';
import { Avatar } from './Avatar';
import { LogoIcon } from './icons/LogoIcon';
import { db, storage, auth, onAuthStateChanged, type FirebaseUser } from '../firebase';
import { ref as dbRef, onValue, off, set, push, update, onDisconnect, get, serverTimestamp as firebaseServerTimestamp } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

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

// =======================================================
// FUNCTIONAL VOICE NOTE PLAYER COMPONENT
// =======================================================

const VoiceNotePlayer: React.FC<{ src: string; isMe: boolean }> = ({ src, isMe }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
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
  }, [src]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.error("Audio playback failed:", err));
    }
    setIsPlaying(!isPlaying);
  };

  const handleSpeedChange = () => {
    if (!audioRef.current) return;
    let nextRate = 1;
    if (playbackRate === 1) nextRate = 1.5;
    else if (playbackRate === 1.5) nextRate = 2;
    
    audioRef.current.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
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
        className={`w-9 h-9 flex items-center justify-center rounded-full transition shrink-0 ${
          isMe ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-[#F8F9FA] text-[#486380] hover:bg-[#E9ECEF]'
        }`}
      >
        {isPlaying ? (
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
                  backgroundColor: isPlayed 
                    ? (isMe ? '#FFFFFF' : '#009EE2') 
                    : (isMe ? 'rgba(255,255,255,0.3)' : '#E9ECEF')
                }}
              />
            );
          })}
        </div>

        <div className={`flex justify-between items-center text-[11px] font-medium ${isMe ? 'text-white/80' : 'text-[#6C757D]'}`}>
          <span>{formatTime(isPlaying ? currentTime : duration)}</span>
          <button 
            type="button" 
            onClick={handleSpeedChange}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition ${
              isMe ? 'border-white/30 hover:bg-white/10' : 'border-[#E9ECEF] hover:bg-neutral-100'
            }`}
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

      {showTrashAnimation && (
        <div className="absolute inset-0 bg-white rounded-full flex items-center justify-center animate-fade-out z-50 border border-[#E9ECEF]">
          <div className="flex items-center gap-2 text-red-500 text-sm font-semibold tracking-wider animate-bounce">
            <TrashIcon /> Recording discarded
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-left-loop { 0%, 100% { transform: translateX(0px); opacity: 1; } 50% { transform: translateX(-4px); opacity: 0.5; } }
        .animate-slide-left { animation: slide-left-loop 1.2s ease-in-out infinite; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        @keyframes fade-out { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0.95); } }
        .animate-fade-out { animation: fade-out 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      `}</style>
    </div>
  );
};

// ==========================================
// MAIN UNIFORM LIGHT THEME MESSENGER
// ==========================================

export const Messenger: React.FC<{ userProfile: UserProfile }> = ({ userProfile }) => {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
    const [activeChat, setActiveChat] = useState<{ chatId: string, otherUser: UserProfile } | null>(null);
    const [chats, setChats] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    const [messages, setMessages] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [tab, setTab] = useState<'chats' | 'people'>('chats');
    const [peopleSearchQuery, setPeopleSearchQuery] = useState("");
    const [isAppActive, setIsAppActive] = useState(() => typeof document === 'undefined' ? true : document.visibilityState === 'visible');
    const [isRecording, setIsRecording] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [recordDuration, setRecordDuration] = useState(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startYRef = useRef<number>(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { addToast } = useToast();

    const filteredPeople = useMemo(() => {
        if (!peopleSearchQuery.trim()) return allUsers;
        const normalizedQuery = peopleSearchQuery.toLowerCase();
        return allUsers.filter(u => {
            const name = (u.display_name || "").toLowerCase();
            return normalizedQuery.split("").every(letter => name.includes(letter));
        });
    }, [allUsers, peopleSearchQuery]);

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
                display_name: u.displayName || u.display_name,
                photo_url: u.photoURL || u.photo_url,
                is_online: u.is_online,
                last_seen: u.last_seen
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
                id: chatId, ...details, otherUser: allUsers.find(u => u.uid === details.otherUserId)
            }));
            setChats(chatList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
        });
    }, [firebaseUser, allUsers]);

    useEffect(() => {
        if (!activeChat) return;
        const messagesRef = dbRef(db, `messages/${activeChat.chatId}`);
        onValue(messagesRef, (snap) => {
            setMessages(Object.entries(snap.val() || {}).map(([id, msg]: any) => ({ id, ...msg })).sort((a, b) => a.timestamp - b.timestamp));
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        if (firebaseUser) {
          set(dbRef(db, `user_chats/${firebaseUser.uid}/${activeChat.chatId}/unreadCount`), 0);
        }
        });
        return () => off(messagesRef);
    }, [activeChat, firebaseUser]);

    const handleFileSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!activeChat || !e.target.files || e.target.files.length === 0) return;
        const selectedFiles = Array.from(e.target.files);
        for (const file of selectedFiles) {
            try {
                const cloudPath = `chat_files/${activeChat.chatId}/${Date.now()}_${file.name}`;
                const fileBucketRef = storageRef(storage, cloudPath);
                const snapshot = await uploadBytes(fileBucketRef, file);
                const fileDownloadUrl = await getDownloadURL(snapshot.ref);
                if (file.type.startsWith('image/')) {
                    await sendMsg(`![${file.name}](${fileDownloadUrl})`, 'image');
                } else {
                    await sendMsg(`[📄 ${file.name}](${fileDownloadUrl})`, 'file');
                }
            } catch (err) {
                addToast({ type: 'error', message: `Failed to upload asset: ${file.name}` });
            }
        }
    };

    const handleImageSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!activeChat || !e.target.files || e.target.files.length === 0) return;
        const selectedImages = Array.from(e.target.files);
        for (const img of selectedImages) {
            try {
                const cloudPath = `chat_files/${activeChat.chatId}/${Date.now()}_camera_${img.name}`;
                const fileBucketRef = storageRef(storage, cloudPath);
                const snapshot = await uploadBytes(fileBucketRef, img);
                const fileDownloadUrl = await getDownloadURL(snapshot.ref);
                await sendMsg(`![Captured Image](${fileDownloadUrl})`, 'image');
            } catch (err) {
                addToast({ type: 'error', message: "Failed to upload visual layout media." });
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
                if ((recorder as any).shouldSave) {
                    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    if (blob.size > 1000) {
                        const path = `voice_notes/${activeChat?.chatId}/${Date.now()}.webm`;
                        const url = await getDownloadURL(await uploadBytes(storageRef(storage, path), blob).then(s => s.ref));
                        sendMsg(`[Voice Note](${url})`, 'voice');
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
            addToast({ type: 'error', message: 'Mic entry parameters rejected.' });
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
        if ((!text.trim() && type === 'text') || !activeChat || !firebaseUser) return;
        const msgRef = push(dbRef(db, `messages/${activeChat.chatId}`));
        const data = { senderId: firebaseUser.uid, text, type, timestamp: firebaseServerTimestamp() };
        await set(msgRef, data);
        const updates: any = {};
        let summaryText = text;
        if (type === 'voice') summaryText = '🎵 Voice message';
        else if (type === 'image') summaryText = '📷 Image file';
        else if (type === 'file') summaryText = '📄 Document file';
        const meta = { last_message: { text: summaryText }, timestamp: firebaseServerTimestamp() };
        const unreadSnapshot = await get(dbRef(db, `user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/unreadCount`));
        const unreadCount = Number(unreadSnapshot.val() || 0);
      updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}`] = {
        ...meta,
        otherUserId: activeChat.otherUser.uid,
        unreadCount: 0
      };
      updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}`] = {
        ...meta,
        otherUserId: firebaseUser.uid
      };
      updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/unreadCount`] = unreadCount + 1;
        update(dbRef(db), updates);
    };

    return (
        <div className="flex h-screen w-full overflow-hidden bg-[#F8F9FA] font-sans antialiased text-[#212529]">
            {/* Sidebar Pane */}
            <div className={`w-full lg:w-[380px] border-r border-[#E9ECEF] flex flex-col ${activeChat ? 'hidden lg:flex' : 'flex'} h-full bg-white`}>
                <div className="p-4 bg-[#F8F9FA] border-b border-[#E9ECEF]">
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
                        <div key={c.id} onClick={() => setActiveChat({ chatId: c.id, otherUser: c.otherUser })} className={`flex items-center gap-3 p-4 hover:bg-[#F8F9FA] cursor-pointer border-b border-[#E9ECEF] transition ${activeChat?.chatId === c.id ? 'bg-[#F8F9FA]' : ''}`}>
                            <Avatar className="w-11 h-11 rounded-full shrink-0 object-cover border border-[#E9ECEF]" photo_url={c.otherUser?.photo_url} />
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center mb-0.5">
                                    <h3 className={`text-[15px] truncate ${getUnreadCount(c) > 0 ? 'font-bold text-[#212529]' : 'font-medium text-[#212529]'}`}>{c.otherUser?.display_name}</h3>
                                    <span className="text-[12px] text-[#6C757D]">10:16 AM</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1 min-w-0">
                                        <DoubleCheckIcon color="#009EE2" />
                                        <p className={`text-[14px] truncate ${getUnreadCount(c) > 0 ? 'font-semibold text-[#212529]' : 'text-[#6C757D]'}`}>{c.last_message?.text}</p>
                                    </div>
                                    {getUnreadCount(c) > 0 && (
                                        <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-[#009EE2] text-white text-[10px] font-bold flex items-center justify-center">
                                            {getUnreadCount(c) > 99 ? '99+' : getUnreadCount(c)}
                                        </span>
                                    )}
                                </div>
                                <p className="text-[11px] mt-1 text-[#6C757D] font-normal">
                                    {c.otherUser?.is_online ? <span className="text-[#28A745]">online</span> : formatLastSeen(c.otherUser?.last_seen)}
                                </p>
                            </div>
                        </div>
                    )) : filteredPeople.map(u => (
                        <div key={u.uid} onClick={() => setActiveChat({ chatId: [firebaseUser?.uid, u.uid].sort().join('_'), otherUser: u })} className="flex items-center gap-3 p-4 hover:bg-[#F8F9FA] cursor-pointer border-b border-[#E9ECEF] transition">
                            <Avatar className="w-10 h-10 rounded-full shrink-0 object-cover border border-[#E9ECEF]" photo_url={u.photo_url} />
                            <h3 className="text-[#212529] font-medium text-[15px]">{u.display_name}</h3>
                            <span className="ml-auto text-[11px] text-[#6C757D] font-normal">{u.is_online ? <span className="text-[#28A745]">online</span> : formatLastSeen(u.last_seen)}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Chat Viewport */}
            <div className={`flex-1 flex flex-col h-full bg-[#F8F9FA] relative ${!activeChat ? 'hidden lg:flex items-center justify-center' : 'flex'}`}>
                {activeChat ? (
                    <div className="flex flex-col h-full w-full relative overflow-hidden">
                        
                        {/* Header Bar */}
                        <div className="h-16 bg-white flex items-center px-6 gap-3 z-30 shadow-sm shrink-0 border-b border-[#E9ECEF]">
                            <button onClick={() => setActiveChat(null)} className="lg:hidden text-[#6C757D] mr-1 text-lg">←</button>
                            <Avatar className="w-9 h-9 rounded-full object-cover border border-[#E9ECEF]" photo_url={activeChat.otherUser.photo_url} />
                            <div className="flex-1 min-w-0">
                                <h2 className="font-semibold text-[#212529] text-[16px] leading-tight truncate">{activeChat.otherUser.display_name}</h2>
                                <p className="text-[12px] text-[#6C757D] font-normal mt-0.5 flex items-center">
                                    {activeChat.otherUser.is_online ? (
                                        <>
                                            <span className="w-1.5 h-1.5 bg-[#28A745] rounded-full mr-1 animate-pulse"></span>
                                            <span className="text-[#28A745]">Online</span>
                                        </>
                                    ) : formatLastSeen(activeChat.otherUser.last_seen)}
                                </p>
                            </div>
                        </div>

                        {/* Message Stream */}
                        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 space-y-6 max-w-3xl mx-auto w-full pb-28">
                            {messages.map((msg) => {
                                const isMe = msg.senderId === firebaseUser?.uid;
                                return (
                                    <div key={msg.id} className="space-y-1">
                                        <div className={`flex items-end space-x-2.5 w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                                            {!isMe && (
                                                <Avatar className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-[#E9ECEF]" photo_url={activeChat.otherUser.photo_url} />
                                            )}
                                            
                                            <div className={`px-5 py-3.5 shadow-sm max-w-[80%] text-[15px] md:text-[16px] relative select-text ${
                                                isMe 
                                                    ? 'bg-[#009EE2] text-white rounded-[24px] rounded-tr-[4px]' 
                                                    : 'bg-white text-
