import React, { useState, useEffect, useRef } from 'react';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';
import ReactMarkdown from 'react-markdown';
import { Avatar } from './Avatar';
import { LogoIcon } from './icons/LogoIcon';
import { db, storage, auth, onAuthStateChanged, type FirebaseUser } from '../firebase';
import { ref as dbRef, onValue, off, set, push, update, serverTimestamp as firebaseServerTimestamp } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// ================= REPLICA ICONS =================

const DoubleCheckIcon = ({ color = "#8696a0" }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12l5 5L20 4M7 12l5 5L20 7" />
  </svg>
);

const AttachmentIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 rotate-45 text-[#8696a0]">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-[#8696a0]">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-[18px] h-[18px] text-[#111b21] translate-x-[1px]">
    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5.5 h-5.5 text-[#ea4335]">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
);

const LockIcon = ({ locked }: { locked: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-white">
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

// =======================================================
// FLOATING DYNAMIC INPUT COMPONENT
// =======================================================

interface VanTutorInputProps {
  onSend: (text: string) => void;
  startRecording: () => Promise<void>;
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
    startRecording(e as any);
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
      {/* Hidden File Input for General Documents */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={onFileSelect} 
        className="hidden" 
        multiple 
        accept="*/*"
      />

      {/* Hidden Image Input Dedicated to Camera Uploads */}
      <input 
        type="file"
        ref={imageInputRef}
        onChange={onImageSelect}
        className="hidden"
        multiple
        accept="image/*"
      />

      {/* Dynamic Slide Lock Track */}
      {isRecording && !isLocked && (
        <div 
          className="absolute right-[21px] bottom-[64px] w-[52px] h-[120px] bg-[#1f2c34] rounded-full flex flex-col items-center justify-start py-4 gap-2 border border-neutral-800/20 shadow-xl z-20"
          style={{ transform: `translateY(${Math.max(-20, swipeDeltaY * 0.15)}px)` }}
        >
          <div className="flex items-center justify-center animate-bounce" style={{ transform: `translateY(${Math.max(-50, swipeDeltaY * 0.5)}px)` }}>
            <LockIcon locked={false} />
          </div>
          <span className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider text-center leading-none mt-auto">Lock</span>
        </div>
      )}

      <div className="w-full flex items-center gap-2 relative">
        {/* NORMAL INPUT STATE */}
        {!isRecording && !isLocked && (
          <div className="flex-1 h-[52px] bg-[#1f2c34]/95 backdrop-blur-md rounded-full flex items-center pl-3.5 pr-4 shadow-[0_4px_12px_rgba(0,0,0,0.5)] border border-white/5 transition-all">
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()}
              className="hover:opacity-85 transition active:scale-90 shrink-0 flex items-center justify-center w-9 h-9 mr-1"
            >
              <AttachmentIcon />
            </button>

            <div className="flex-1 h-full flex items-center min-w-0">
              <input 
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && executeTextSend()}
                placeholder="Message"
                className="w-full h-full bg-transparent text-[17px] text-[#e9edef] placeholder-[#8696a0] outline-none border-none caret-[#a3e635] pr-2 font-sans focus:ring-0"
              />
            </div>

            <button 
              type="button" 
              onClick={() => imageInputRef.current?.click()}
              className="hover:opacity-85 transition active:scale-90 flex items-center justify-center w-9 h-9 ml-1"
            >
              <CameraIcon />
            </button>
          </div>
        )}

        {/* ACTIVE RECORDING STATE */}
        {(isRecording || isLocked) && (
          <div className="flex-1 h-[52px] bg-[#1f2c34] rounded-full flex items-center pl-4 pr-5 shadow-2xl border border-white/5 animate-fade-in relative overflow-hidden">
            <div className="flex items-center gap-2.5 shrink-0 z-10">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[17px] font-medium text-[#e9edef] tabular-nums">{formatTime(recordDuration)}</span>
            </div>

            {isLocked ? (
              <div className="flex-1 flex items-center justify-between pl-6 animate-fade-in z-10">
                <button onClick={discardVoice} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-neutral-800/40 active:scale-90 transition" type="button">
                  <TrashIcon />
                </button>
                <span className="text-xs text-[#8696a0] font-semibold tracking-wider">RECORDING LOCKED</span>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-end pr-4 z-10 transition-transform duration-75" style={{ transform: `translateX(${swipeDeltaX * 0.8}px)` }}>
                <span className="text-sm font-medium text-[#8696a0] flex items-center gap-1">
                  <span className="inline-block animate-slide-left font-bold">&lt;</span> Slide to cancel
                </span>
              </div>
            )}
            {!isLocked && <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-[#111b21]/40 to-transparent w-24 pointer-events-none" />}
          </div>
        )}

        {/* LEMON GREEN ACTION BUTTON */}
        <div style={{ transform: isSwiping ? `translate(${swipeDeltaX * 0.2}px, ${swipeDeltaY * 0.5}px)` : 'none', transition: isSwiping ? 'none' : 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}>
          {hasText ? (
            <button type="button" onClick={executeTextSend} className="w-[52px] h-[52px] bg-[#a3e635] hover:bg-[#bef264] rounded-full flex items-center justify-center shadow-lg shrink-0 transition-transform active:scale-95 duration-100">
              <SendIcon />
            </button>
          ) : isLocked ? (
            <button type="button" onClick={() => stopRecording(true)} className="w-[52px] h-[52px] bg-[#a3e635] hover:bg-[#bef264] rounded-full flex items-center justify-center shadow-lg shrink-0 transition-transform active:scale-95 duration-100 animate-pulse">
              <SendIcon />
            </button>
          ) : (
            <div className="relative">
              {isRecording && <div className="absolute -inset-2 bg-[#a3e635]/20 rounded-full animate-ping pointer-events-none" />}
              <button 
                type="button"
                onMouseDown={handleVoicePress}
                onMouseMove={handleVoiceMove}
                onMouseUp={handleVoiceRelease}
                onMouseLeave={handleVoiceRelease}
                onTouchStart={handleVoicePress}
                onTouchMove={handleVoiceMove}
                onTouchEnd={handleVoiceRelease}
                className={`w-[52px] h-[52px] bg-[#a3e635] rounded-full flex items-center justify-center shadow-lg shrink-0 transition-all select-none touch-none ${isRecording ? 'scale-125 bg-[#bef264]' : 'hover:bg-[#bef264] active:scale-95'}`}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-[22px] h-[22px] text-[#111b21]"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Discard Feedback */}
      {showTrashAnimation && (
        <div className="absolute inset-0 bg-[#1f2c34] rounded-full flex items-center justify-center animate-fade-out z-50">
          <div className="flex items-center gap-2 text-[#ea4335] text-sm font-semibold tracking-wider animate-bounce">
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
// MAIN RECONFIGURED MESSENGER CONTAINER
// ==========================================

export const Messenger: React.FC<{ userProfile: UserProfile }> = ({ userProfile }) => {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
    const [activeChat, setActiveChat] = useState<{ chatId: string, otherUser: UserProfile } | null>(null);
    const [chats, setChats] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    const [messages, setMessages] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [tab, setTab] = useState<'chats' | 'people'>('chats');

    const [isRecording, setIsRecording] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [recordDuration, setRecordDuration] = useState(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startYRef = useRef<number>(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { addToast } = useToast();

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
                photo_url: u.photoURL || u.photo_url
            })));
        });
    }, []);

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
        });
        return () => off(messagesRef);
    }, [activeChat]);

    // ================= MEDIA FILE ATTACHMENT HANDLER =================

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

    // ================= TARGETED IMAGE/CAMERA UPLOAD PIPELINE =================

    const handleImageSelection = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!activeChat || !e.target.files || e.target.files.length === 0) return;

        const selectedImages = Array.from(e.target.files);
        for (const img of selectedImages) {
            try {
                const cloudPath = `chat_files/${activeChat.chatId}/${Date.now()}_camera_${img.name}`;
                const fileBucketRef = storageRef(storage, cloudPath);
                
                const snapshot = await uploadBytes(fileBucketRef, img);
                const fileDownloadUrl = await getDownloadURL(snapshot.ref);

                // Instantly pushes formatted image markdown block
                await sendMsg(`![Captured Image](${fileDownloadUrl})`, 'image');
            } catch (err) {
                addToast({ type: 'error', message: "Failed to upload visual layout media." });
            }
        }
    };

    // ================= RECORDING CORE PIPELINE =================

    const startRecording = async (e: React.MouseEvent | React.TouchEvent) => {
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
        updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}`] = { ...meta, otherUserId: activeChat.otherUser.uid };
        updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}`] = { ...meta, otherUserId: firebaseUser.uid };
        update(dbRef(db), updates);
    };

    return (
        <div className="flex h-[calc(100dvh-73px)] w-full overflow-hidden bg-[#111b21]">
            {/* Sidebar Replica */}
            <div className={`w-full lg:w-[380px] border-r border-white/5 flex flex-col ${activeChat ? 'hidden lg:flex' : 'flex'} h-full`}>
                <div className="p-4 bg-[#111b21] border-b border-white/5">
                    <h1 className="text-xl font-bold text-[#e9edef] mb-4">Messages</h1>
                    <div className="flex gap-2 bg-[#202c33] p-1 rounded-lg">
                        <button onClick={() => setTab('chats')} className={`flex-1 py-1.5 text-sm rounded-md ${tab === 'chats' ? 'bg-[#374248] text-white' : 'text-[#8696a0]'}`}>Chats</button>
                        <button onClick={() => setTab('people')} className={`flex-1 py-1.5 text-sm rounded-md ${tab === 'people' ? 'bg-[#374248] text-white' : 'text-[#8696a0]'}`}>People</button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {tab === 'chats' ?
                    chats.map(c => (
                        <div key={c.id} onClick={() => setActiveChat({ chatId: c.id, otherUser: c.otherUser })} className={`flex items-center gap-3 p-3 hover:bg-[#202c33] cursor-pointer border-b border-white/5 ${activeChat?.chatId === c.id ? 'bg-[#2a3942]' : ''}`}>
                            <Avatar className="w-12 h-12 rounded-full" photo_url={c.otherUser?.photo_url} />
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center">
                                    <h3 className="font-medium text-[#e9edef] truncate">{c.otherUser?.display_name}</h3>
                                    <span className="text-[11px] text-[#8696a0]">10:16 AM</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <DoubleCheckIcon color="#8696a0" />
                                    <p className="text-sm text-[#8696a0] truncate">{c.last_message?.text}</p>
                                </div>
                            </div>
                        </div>
                    )) : allUsers.map(u => (
                        <div key={u.uid} onClick={() => setActiveChat({ chatId: [firebaseUser?.uid, u.uid].sort().join('_'), otherUser: u })} className="flex items-center gap-3 p-3 hover:bg-[#202c33] cursor-pointer border-b border-white/5">
                            <Avatar className="w-10 h-10 rounded-full" photo_url={u.photo_url} />
                            <h3 className="text-[#e9edef] font-medium">{u.display_name}</h3>
                        </div>
                    ))}
                </div>
            </div>

            {/* Chat Pane Replica */}
            <div className={`flex-1 flex flex-col h-full bg-[#0b141a] relative ${!activeChat ? 'hidden lg:flex items-center justify-center' : 'flex'}`}>
                {activeChat ? (
                    <div className="flex flex-col h-full relative overflow-hidden">
                        
                        {/* Header Panel */}
                        <div className="h-16 bg-[#202c33] flex items-center px-4 gap-3 z-30 shadow-md shrink-0">
                            <button onClick={() => setActiveChat(null)} className="lg:hidden text-[#aebac1]">←</button>
                            <Avatar className="w-10 h-10 rounded-full" photo_url={activeChat.otherUser.photo_url} />
                            <div className="flex-1"><h2 className="font-medium text-[#e9edef]">{activeChat.otherUser.display_name}</h2><p className="text-[11px] text-[#8696a0]">online</p></div>
                        </div>

                        {/* Message Stream Pane */}
                        <div className="flex-1 overflow-y-auto relative pb-24 z-10" style={{ backgroundImage: "url('https://w0.peakpx.com/wallpaper/818/148/HD-wallpaper-whatsapp-dark-background-dark-pattern-whatsapp-logo.jpg')", backgroundSize: '400px' }}>
                            <div className="absolute inset-0 bg-[#0b141a]/90 z-0" />
                            <div className="relative z-10 flex flex-col p-4 space-y-2">
                                {messages.map((msg) => {
                                    const isMe = msg.senderId === firebaseUser?.uid;
                                    return (
                                        <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`p-2 rounded-lg max-w-[85%] shadow-sm relative min-w-[80px] ${isMe ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'}`}>
                                                {msg.type === 'voice' ? (
                                                    <div className="flex items-center gap-2 p-1">
                                                        <Avatar className="w-10 h-10 border-none" photo_url={isMe ? userProfile.photo_url : activeChat.otherUser.photo_url} />
                                                        <div className="flex-1">
                                                            <audio src={msg.text.match(/\((.*?)\)/)?.[1]} controls className="h-8 w-40 opacity-70" />
                                                        </div>
                                                    </div>
                                                ) : msg.type === 'image' ? (
                                                    <div className="max-w-sm rounded overflow-hidden p-1">
                                                        <img src={msg.text.match(/\((.*?)\)/)?.[1]} alt="Shared payload file" className="max-h-60 object-cover rounded-md" />
                                                    </div>
                                                ) : (
                                                    <div className="prose prose-invert max-w-full text-[15px] leading-relaxed break-words">
                                                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-end gap-1 mt-1">
                                                    <span className="text-[10px] opacity-60">12:53 PM</span>
                                                    {isMe && <DoubleCheckIcon color="#53bdeb" />}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* TRUE OVERLAY FLOATING INPUT INTERFACE */}
                        <div className="absolute bottom-0 left-0 right-0 z-30 pb-4 pt-10 bg-gradient-to-t from-[#0b141a] via-[#0b141a]/80 to-transparent pointer-events-none">
                            <div className="pointer-events-auto">
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
                        </div>

                    </div>
                ) : (
                    <div className="text-center opacity-20">
                        <LogoIcon className="w-32 h-32 mx-auto" />
                        <h2 className="text-3xl font-black italic">VANTUTOR</h2>
                    </div>
                )}
            </div>
        </div>
    );
};
