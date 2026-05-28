import React, { useState, useEffect, useRef } from 'react';
import type { UserProfile, PrivateChat as ChatMetadata, PrivateMessage } from '../types';
import { useToast } from '../hooks/useToast';
import { SendIcon } from './icons/SendIcon';
import { PaperclipIcon } from './icons/PaperclipIcon';
import { XIcon } from './icons/XIcon';
import ReactMarkdown from 'react-markdown';
import { Avatar } from './Avatar';
import { LogoIcon } from './icons/LogoIcon';
import { GoogleIcon } from './icons/GoogleIcon';
import { db, storage, auth, onAuthStateChanged, firebaseSignOut, type FirebaseUser } from '../firebase';
import { ref as dbRef, onValue, off, set, push, update, serverTimestamp as firebaseServerTimestamp, onDisconnect, get } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

const VoiceIcon = () => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M11.999 14.942c2.001 0 3.531-1.53 3.531-3.531V5.059c0-2.001-1.53-3.531-3.531-3.531S8.469 3.058 8.469 5.059v6.353c0 2.001 1.53 3.531 3.53 3.531zm6.235-3.53c0 3.132-2.318 5.735-5.353 6.224v2.794h-1.764v-2.794c-3.036-.489-5.353-3.092-5.353-6.224H7.53c0 2.465 1.994 4.471 4.469 4.471s4.471-2.006 4.471-4.471h1.764z"/>
    </svg>
);

const LockIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="text-rose-500">
        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
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
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [inputText, setInputText] = useState("");
    
    // Voice Recorder States
    const [isRecording, setIsRecording] = useState(false);
    const [isLocked, setIsLocked] = useState(false);

    // Refs for holding active media devices
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const startYRef = useRef<number>(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const { addToast } = useToast();

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

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
            const list = Object.entries(data).map(([uid, u]: any) => ({
                uid,
                display_name: u.displayName || u.display_name,
                photo_url: u.photoURL || u.photo_url,
                department_id: u.department_id,
                level: u.level
            })) as UserProfile[];
            setAllUsers(list);
        });
    }, []);

    useEffect(() => {
        if (!firebaseUser) return;
        const userChatsRef = dbRef(db, `user_chats/${firebaseUser.uid}`);
        onValue(userChatsRef, (snap) => {
            const data = snap.val() || {};
            const chatList = Object.entries(data).map(([chatId, details]: any) => {
                const otherUser = allUsers.find(u => u.uid === details.otherUserId);
                return { id: chatId, ...details, otherUser };
            });
            setChats(chatList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)));
        });
    }, [firebaseUser, allUsers]);

    useEffect(() => {
        if (!activeChat) {
            setMessages([]);
            return;
        }

        const messagesRef = dbRef(db, `messages/${activeChat.chatId}`);
        onValue(messagesRef, (snap) => {
            const data = snap.val() || {};
            const parsedMessages = Object.entries(data).map(([id, msg]: any) => ({
                id,
                ...msg
            })).sort((a, b) => a.timestamp - b.timestamp);
            setMessages(parsedMessages);
        });

        return () => off(messagesRef);
    }, [activeChat]);

    const handleSendMessage = async () => {
        if (!inputText.trim() || !firebaseUser || !activeChat) return;
        const messageText = inputText.trim();
        setInputText("");

        try {
            const chatMessagesRef = dbRef(db, `messages/${activeChat.chatId}`);
            const newMessageRef = push(chatMessagesRef);
            
            const messageData = {
                senderId: firebaseUser.uid,
                text: messageText,
                type: 'text',
                timestamp: firebaseServerTimestamp()
            };
            await set(newMessageRef, messageData);

            const updates: any = {};
            updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}/last_message`] = { text: messageText };
            updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}/timestamp`] = firebaseServerTimestamp();
            updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/last_message`] = { text: messageText };
            updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/timestamp`] = firebaseServerTimestamp();
            await update(dbRef(db), updates);
        } catch (error) {
            addToast({ type: 'error', message: 'Failed to send message.' });
        }
    };

    // Voice Note Recorder Mechanics
    const handleVoiceStart = async (e: React.MouseEvent | React.TouchEvent) => {
        if (!firebaseUser || !activeChat) return;
        e.preventDefault();
        
        // Track the starting position for vertical slides
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        startYRef.current = clientY;
        setIsLocked(false);
        audioChunksRef.current = [];

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop()); // release mic access cleanly
                
                if (audioChunksRef.current.length === 0 || audioBlob.size < 200) {
                    return; // drop short or broken recordings
                }

                try {
                    const storagePath = `voice_notes/${activeChat.chatId}/${Date.now()}.webm`;
                    const voiceRef = storageRef(storage, storagePath);
                    const snapshot = await uploadBytes(voiceRef, audioBlob);
                    const downloadUrl = await getDownloadURL(snapshot.ref);

                    const chatMessagesRef = dbRef(db, `messages/${activeChat.chatId}`);
                    const newMessageRef = push(chatMessagesRef);
                    
                    await set(newMessageRef, {
                        senderId: firebaseUser.uid,
                        text: `[Voice Note](${downloadUrl})`,
                        type: 'voice',
                        timestamp: firebaseServerTimestamp()
                    });

                    const updates: any = {};
                    updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}/last_message`] = { text: '🎵 Voice Note' };
                    updates[`user_chats/${firebaseUser.uid}/${activeChat.chatId}/timestamp`] = firebaseServerTimestamp();
                    updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/last_message`] = { text: '🎵 Voice Note' };
                    updates[`user_chats/${activeChat.otherUser.uid}/${activeChat.chatId}/timestamp`] = firebaseServerTimestamp();
                    await update(dbRef(db), updates);
                } catch (err) {
                    console.error("Failed to upload/send voice record:", err);
                    addToast({ type: 'error', message: 'Failed to send voice note.' });
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Microphone access error:", err);
            addToast({ type: 'error', message: 'Could not access mic.' });
        }
    };

    const handleVoiceMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isRecording || isLocked) return;
        const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const deltaY = startYRef.current - currentY;

        // If user drags up more than 60 pixels, trigger recording lock state
        if (deltaY > 60) {
            setIsLocked(true);
        }
    };

    const handleVoiceStop = () => {
        if (isLocked || !isRecording) return; // ignore stop trigger if recording is locked
        setIsRecording(false);
        setIsLocked(false);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    const handleStopLockedRecording = () => {
        setIsRecording(false);
        setIsLocked(false);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    const handleStartChat = (other: UserProfile) => {
        if (!firebaseUser) return;
        const chatId = [firebaseUser.uid, other.uid].sort().join('_');
        setActiveChat({ chatId, otherUser: other });
        const updates: any = {};
        updates[`user_chats/${firebaseUser.uid}/${chatId}`] = { otherUserId: other.uid, timestamp: firebaseServerTimestamp() };
        updates[`user_chats/${other.uid}/${chatId}`] = { otherUserId: firebaseUser.uid, timestamp: firebaseServerTimestamp() };
        update(dbRef(db), updates);
    };

    if (isLoading) return <div className="p-10 text-center text-slate-500">Loading Messenger...</div>;
    if (!firebaseUser) return <div className="p-10 text-center">Please login to access chats.</div>;

    return (
        <div className="flex h-[calc(100dvh-73px)] w-full overflow-hidden bg-white">
            {/* Sidebar */}
            <div className={`w-full lg:w-[380px] border-r border-slate-200 flex flex-col ${activeChat ? 'hidden lg:flex' : 'flex'} h-full`}>
                <div className="p-4 border-b border-slate-100 bg-white">
                    <div className="flex justify-between items-center mb-4">
                        <h1 className="text-xl font-bold text-slate-800">Messages</h1>
                        <div className="relative">
                            <button onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)} className="focus:outline-none">
                                <Avatar className="w-8 h-8 cursor-pointer ring-2 ring-slate-100" display_name={userProfile.display_name} photo_url={userProfile.photo_url} />
                            </button>
                            {isProfileMenuOpen && (
                                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-slate-50">
                                        <p className="text-sm font-bold text-slate-900 truncate">{userProfile.display_name}</p>
                                    </div>
                                    <button onClick={() => firebaseSignOut(auth)} className="w-full text-left px-4 py-3 text-sm text-rose-500 hover:bg-rose-50 font-medium">Logout</button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                        <button onClick={() => setTab('chats')} className={`flex-1 py-2 text-sm font-medium rounded-lg ${tab === 'chats' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Chats</button>
                        <button onClick={() => setTab('people')} className={`flex-1 py-2 text-sm font-medium rounded-lg ${tab === 'people' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>People</button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {tab === 'chats' ? (
                        chats.map(c => (
                            <div key={c.id} onClick={() => setActiveChat({ chatId: c.id, otherUser: c.otherUser })} className={`flex items-center gap-3 p-4 hover:bg-slate-50 cursor-pointer border-b border-slate-50 ${activeChat?.chatId === c.id ? 'bg-slate-50' : ''}`}>
                                <Avatar className="w-12 h-12" display_name={c.otherUser?.display_name} photo_url={c.otherUser?.photo_url} />
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-slate-900 truncate">{c.otherUser?.display_name || "Unknown User"}</h3>
                                    <p className="text-sm text-slate-500 truncate">{c.last_message?.text || "Start a conversation"}</p>
                                </div>
                            </div>
                        ))
                    ) : (
                        allUsers.filter(u => u.uid !== firebaseUser.uid).map(u => (
                            <div key={u.uid} onClick={() => handleStartChat(u)} className="flex items-center gap-3 p-4 hover:bg-slate-50 cursor-pointer border-b border-slate-50">
                                <Avatar className="w-10 h-10" display_name={u.display_name} photo_url={u.photo_url} />
                                <div className="flex-1">
                                    <h3 className="text-sm font-semibold text-slate-900">{u.display_name}</h3>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Chat Pane */}
            <div className={`flex-1 flex flex-col h-full max-h-full bg-[#efeae2] relative ${!activeChat ? 'hidden lg:flex items-center justify-center' : 'flex'}`}>
                {activeChat ? (
                    <>
                        {/* Chat Header */}
                        <div className="h-16 bg-white border-b border-slate-200 flex items-center px-4 gap-3 z-30 shadow-sm shrink-0">
                            <button onClick={() => setActiveChat(null)} className="lg:hidden p-2 text-slate-600">←</button>
                            <Avatar className="w-10 h-10" display_name={activeChat.otherUser.display_name} photo_url={activeChat.otherUser.photo_url} />
                            <div>
                                <h2 className="font-bold text-slate-800 leading-tight">{activeChat.otherUser.display_name}</h2>
                                <p className="text-[10px] text-green-500 font-bold uppercase">Online</p>
                            </div>
                        </div>

                        {/* Scrollable Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-52">
                            {messages.length === 0 ? (
                                <div className="bg-white/80 backdrop-blur-sm p-3 rounded-2xl shadow-sm max-w-[250px] mx-auto text-center text-xs text-slate-500 font-medium">
                                    No messages yet. Say hello!
                                </div>
                            ) : (
                                messages.map((msg) => {
                                    const isMe = msg.senderId === firebaseUser.uid;
                                    const isVoice = msg.type === 'voice';
                                    return (
                                        <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`p-3 text-sm max-w-[75%] shadow-sm rounded-2xl ${isMe ? 'bg-emerald-500 text-white rounded-tr-none' : 'bg-white text-slate-800 rounded-tl-none'}`}>
                                                {isVoice ? (
                                                    <div className="flex items-center gap-2 py-1">
                                                        <span className="text-base">🎵</span>
                                                        <audio src={msg.text.match(/\((.*?)\)/)?.[1]} controls className="max-w-full h-8 compact-audio" />
                                                    </div>
                                                ) : (
                                                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Guided Animation Lock Overlay */}
                        {isRecording && (
                            <div className="absolute bottom-[165px] right-8 flex flex-col items-center gap-2 z-50 pointer-events-none select-none">
                                <div className="animate-bounce flex flex-col items-center text-rose-500">
                                    {isLocked ? (
                                        <div className="bg-white p-2 rounded-full shadow-md flex items-center justify-center border border-rose-100">
                                            <LockIcon />
                                        </div>
                                    ) : (
                                        <>
                                            <span className="text-lg font-bold">↑</span>
                                            <span className="text-[10px] uppercase font-black bg-white px-2 py-1 rounded shadow-sm">Slide up to lock</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Fixed Floating Input Bar - shifted to bottom-[100px] */}
                        <div className="absolute bottom-[100px] left-0 right-0 z-20 px-4 pointer-events-none">
                            <div className="max-w-[800px] mx-auto flex items-end gap-2 p-2 bg-transparent pointer-events-auto">
                                <div className={`flex-1 bg-white rounded-[24px] flex items-end p-2 px-4 shadow-lg border border-slate-200 transition-all ${isRecording ? 'border-rose-300 ring-2 ring-rose-50' : 'focus-within:ring-2 focus-within:ring-emerald-100'}`}>
                                    <textarea 
                                        rows={1}
                                        value={isRecording ? (isLocked ? "🔒 Recording hands-free... Click button to finish." : "Recording real voice...") : inputText}
                                        onChange={(e) => setInputText(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage();
                                            }
                                        }}
                                        readOnly={isRecording}
                                        placeholder="Type a message"
                                        className={`flex-1 bg-transparent border-none focus:ring-0 text-sm py-2 max-h-32 ${isRecording ? 'text-rose-500 italic font-medium' : ''}`}
                                    />
                                </div>
                                
                                <button 
                                    onClick={inputText.trim() ? handleSendMessage : (isLocked ? handleStopLockedRecording : undefined)}
                                    onMouseDown={inputText.trim() ? undefined : handleVoiceStart}
                                    onMouseMove={inputText.trim() ? undefined : handleVoiceMove}
                                    onMouseUp={inputText.trim() ? undefined : handleVoiceStop}
                                    onTouchStart={inputText.trim() ? undefined : handleVoiceStart}
                                    onTouchMove={inputText.trim() ? undefined : handleVoiceMove}
                                    onTouchEnd={inputText.trim() ? undefined : handleVoiceStop}
                                    className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-all duration-200 shrink-0 text-white
                                        ${inputText.trim() ? 'bg-emerald-500 hover:bg-emerald-600' : isRecording ? 'bg-rose-500 scale-110 animate-pulse' : 'bg-emerald-500'}
                                    `}
                                    aria-label="Send or record voice note"
                                >
                                    {inputText.trim() ? (
                                        <SendIcon />
                                    ) : isLocked ? (
                                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                                            <rect x="6" y="6" width="12" height="12" rx="2" />
                                        </svg>
                                    ) : (
                                        <VoiceIcon />
                                    )}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-center opacity-20 select-none">
                        <LogoIcon className="w-32 h-32 mx-auto mb-4" />
                        <h2 className="text-3xl font-black italic">VANTUTOR</h2>
                        <p className="font-medium">Select a classmate to chat</p>
                    </div>
                )}
            </div>
            
            <style>{`
                .compact-audio::-webkit-media-controls-enclosure {
                    background-color: #f1f5f9;
                    border-radius: 12px;
                }
            `}</style>
        </div>
    );
};
