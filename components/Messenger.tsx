import React, { useState, useEffect, useRef } from 'react';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';
import { SendIcon } from './icons/SendIcon';
import { PaperclipIcon } from './icons/PaperclipIcon';
import ReactMarkdown from 'react-markdown';
import { Avatar } from './Avatar';
import { LogoIcon } from './icons/LogoIcon';
import { db, storage, auth, onAuthStateChanged, firebaseSignOut, type FirebaseUser } from '../firebase';
import { ref as dbRef, onValue, off, set, push, update, serverTimestamp as firebaseServerTimestamp } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// ================= REPLICA ICONS & UI COMPONENTS =================

const DoubleCheckIcon = ({ color = "#8696a0" }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12l5 5L20 4M7 12l5 5L20 7" />
  </svg>
);

const MicroIcon = ({ color = "#00a884" }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill={color}>
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
  </svg>
);

const VoiceIcon = () => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
    </svg>
);

export const Messenger: React.FC<{ userProfile: UserProfile }> = ({ userProfile }) => {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
    const [activeChat, setActiveChat] = useState<{ chatId: string, otherUser: UserProfile } | null>(null);
    const [chats, setChats] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    const [messages, setMessages] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [tab, setTab] = useState<'chats' | 'people'>('chats');
    const [inputText, setInputText] = useState("");
    
    // Voice Recorder State
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
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        });
        return () => off(messagesRef);
    }, [activeChat]);

    // ================= RECORDING LOGIC =================

    const startRecording = async (e: React.MouseEvent | React.TouchEvent) => {
        if (!activeChat) return;
        e.preventDefault();
        startYRef.current = 'touches' in e ? e.touches[0].clientY : e.clientY;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];
            recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
            recorder.onstop = async () => {
                const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                if (blob.size > 1000) {
                    const path = `voice_notes/${activeChat?.chatId}/${Date.now()}.webm`;
                    const url = await getDownloadURL(await uploadBytes(storageRef(storage, path), blob).then(s => s.ref));
                    sendMsg(`[Voice Note](${url})`, 'voice');
                }
                stream.getTracks().forEach(t => t.stop());
            };
            recorder.start();
            setIsRecording(true);
            setRecordDuration(0);
            timerRef.current = setInterval(() => setRecordDuration(prev => prev + 1), 1000);
        } catch (err) { addToast({ type: 'error', message: 'Mic access denied' }); }
    };

    const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isRecording || isLocked) return;
        const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        if (startYRef.current - currentY > 80) setIsLocked(true);
    };

    const stopRecording = () => {
        if (isLocked) return;
        finishRecording();
    };

    const finishRecording = () => {
        setIsRecording(false);
        setIsLocked(false);
        if (timerRef.current) clearInterval(timerRef.current);
        mediaRecorderRef.current?.stop();
    };

    const sendMsg = async (text: string, type = 'text') => {
        if ((!text.trim() && type === 'text') || !activeChat || !firebaseUser) return;
        const msgRef = push(dbRef(db, `messages/${activeChat.chatId}`));
        const data = { senderId: firebaseUser.uid, text, type, timestamp: firebaseServerTimestamp() };
        await set(msgRef, data);
        const updates: any = {};
        const meta = { last_message: { text: type === 'voice' ? '🎵 Voice message' : text }, timestamp: firebaseServerTimestamp() };
        updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}`] = { ...meta, otherUserId: activeChat.otherUser.uid };
        updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}`] = { ...meta, otherUserId: firebaseUser.uid };
        update(dbRef(db), updates);
        if (type === 'text') setInputText("");
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
                    {tab === 'chats' ? chats.map(c => (
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
                {activeChat ? <>
                    <div className="h-16 bg-[#202c33] flex items-center px-4 gap-3 z-30 shadow-md">
                        <button onClick={() => setActiveChat(null)} className="lg:hidden text-[#aebac1]">←</button>
                        <Avatar className="w-10 h-10 rounded-full" photo_url={activeChat.otherUser.photo_url} />
                        <div className="flex-1"><h2 className="font-medium text-[#e9edef]">{activeChat.otherUser.display_name}</h2><p className="text-[11px] text-[#8696a0]">online</p></div>
                    </div>

                    <div className="flex-1 overflow-y-auto relative pb-32" style={{ backgroundImage: "url('https://w0.peakpx.com/wallpaper/818/148/HD-wallpaper-whatsapp-dark-background-dark-pattern-whatsapp-logo.jpg')", backgroundSize: '400px' }}>
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
                                            ) : <ReactMarkdown>{msg.text}</ReactMarkdown>}
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

                    {/* Functional Recording Overlay */}
                    {isRecording && (
                        <div className="absolute bottom-[160px] right-8 flex flex-col items-center gap-4 z-50 pointer-events-none">
                            <div className={`bg-[#202c33] p-3 rounded-full shadow-xl border border-white/5 transition-all ${isLocked ? 'scale-110 border-rose-500' : 'animate-bounce'}`}>
                                {isLocked ? <div className="text-rose-500 font-bold">🔒 LOCKED</div> : <div className="text-white text-xs">↑ Slide to lock</div>}
                            </div>
                        </div>
                    )}

                    {/* Replica Input Bar */}
                    <div className="absolute bottom-[100px] left-0 right-0 z-20 px-4">
                        <div className="max-w-[800px] mx-auto flex items-center gap-2 relative">
                            {isRecording && !isLocked && <div className="absolute left-0 right-14 bg-[#111b21] h-full flex items-center px-4 rounded-full z-10 text-white animate-pulse">
                                <span>{Math.floor(recordDuration/60)}:{String(recordDuration%60).padStart(2,'0')}</span>
                                <span className="ml-auto text-sm opacity-50">‹ Slide to cancel</span>
                            </div>}
                            
                            <div className="flex-1 bg-[#2a3942] rounded-full flex items-center px-3 py-1.5 shadow-md">
                                <button className="p-2 text-[#8696a0] text-xl">😊</button>
                                <input value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key==='Enter' && sendMsg(inputText)} placeholder="Message" className="flex-1 bg-transparent border-none text-white text-[15px] focus:ring-0" />
                                <button className="p-2 text-[#8696a0] rotate-45"><PaperclipIcon /></button>
                                <button className="p-2 text-[#8696a0] text-xl">📷</button>
                            </div>

                            <button 
                                onClick={inputText ? () => sendMsg(inputText) : (isLocked ? finishRecording : undefined)}
                                onMouseDown={inputText ? undefined : startRecording}
                                onMouseMove={handleMove}
                                onMouseUp={stopRecording}
                                onTouchStart={inputText ? undefined : startRecording}
                                onTouchMove={handleMove}
                                onTouchEnd={stopRecording}
                                className={`w-12 h-12 rounded-full flex items-center justify-center text-black shadow-lg transition-all ${isRecording ? 'bg-rose-500 scale-125' : 'bg-[#00a884]'}`}
                            >
                                {inputText ? <SendIcon /> : (isLocked ? <span className="text-white">✔</span> : <VoiceIcon />)}
                            </button>
                        </div>
                    </div>
                </> : <div className="text-center opacity-20"><LogoIcon className="w-32 h-32 mx-auto" /><h2 className="text-3xl font-black italic">VANTUTOR</h2></div>}
            </div>
        </div>
    );
};
