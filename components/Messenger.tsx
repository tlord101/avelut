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
import { db, storage, auth, onAuthStateChanged, firebaseSignOut, type FirebaseUser, GoogleAuthProvider, signInWithPopup, updateProfile } from '../firebase';
import { ref as dbRef, onValue, off, set, push, update, serverTimestamp as firebaseServerTimestamp, onDisconnect, get } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// --- Animated Icons ---
const VoiceIcon = () => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M11.999 14.942c2.001 0 3.531-1.53 3.531-3.531V5.059c0-2.001-1.53-3.531-3.531-3.531S8.469 3.058 8.469 5.059v6.353c0 2.001 1.53 3.531 3.53 3.531zm6.235-3.53c0 3.132-2.318 5.735-5.353 6.224v2.794h-1.764v-2.794c-3.036-.489-5.353-3.092-5.353-6.224H7.53c0 2.465 1.994 4.471 4.469 4.471s4.471-2.006 4.471-4.471h1.764z"/>
    </svg>
);

const LockIcon = () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" className="animate-bounce">
        <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm3 8H9V7a3 3 0 0 1 6 0v3z"/>
    </svg>
);

// --- Messenger Component ---
export const Messenger: React.FC<{ userProfile: UserProfile }> = ({ userProfile }) => {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
    const [activeChat, setActiveChat] = useState<{ chatId: string, otherUser: UserProfile } | null>(null);
    const [chats, setChats] = useState<any[]>([]);
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [tab, setTab] = useState<'chats' | 'people'>('chats');
    const { addToast } = useToast();

    // WhatsApp-style Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [dragY, setDragY] = useState(0);
    const [inputText, setInputText] = useState("");

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, user => { setFirebaseUser(user); setIsLoading(false); });
        return unsub;
    }, []);

    // Fetch Chats & Users
    useEffect(() => {
        if (!firebaseUser) return;
        const userChatsRef = dbRef(db, `user_chats/${firebaseUser.uid}`);
        onValue(userChatsRef, (snap) => {
            const data = snap.val() || {};
            const list = Object.entries(data).map(([id, details]: any) => ({ id, ...details }));
            setChats(list.sort((a, b) => b.timestamp - a.timestamp));
        });
    }, [firebaseUser]);

    const handleStartChat = (other: UserProfile) => {
        const chatId = [firebaseUser!.uid, other.uid].sort().join('_');
        setActiveChat({ chatId, otherUser: other });
    };

    if (!firebaseUser) return <div className="p-10 text-center">Please login to Messenger</div>;

    return (
        <div className="flex h-[calc(100vh-64px)] w-full overflow-hidden bg-slate-50 font-sans">
            {/* Left Column: List (Hidden on mobile if chat is open) */}
            <div className={`w-full lg:w-[380px] border-r border-slate-200 bg-white flex flex-col ${activeChat ? 'hidden lg:flex' : 'flex'}`}>
                <div className="p-4 border-b border-slate-100">
                    <h1 className="text-xl font-bold text-slate-800">Messages</h1>
                    <div className="flex gap-2 mt-3 bg-slate-100 p-1 rounded-xl">
                        <button onClick={() => setTab('chats')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'chats' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Chats</button>
                        <button onClick={() => setTab('people')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'people' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>People</button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {tab === 'chats' ? (
                        chats.map(c => (
                            <div key={c.id} onClick={() => handleStartChat(c.otherUser)} className="flex items-center gap-3 p-4 hover:bg-slate-50 cursor-pointer border-b border-slate-50 transition-colors">
                                <Avatar className="w-12 h-12" display_name={c.otherUser?.display_name} photo_url={c.otherUser?.photo_url} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between">
                                        <h3 className="font-semibold text-slate-900 truncate">{c.otherUser?.display_name}</h3>
                                        <span className="text-xs text-slate-400">12:45</span>
                                    </div>
                                    <p className="text-sm text-slate-500 truncate">{c.last_message?.text || "Voice note"}</p>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="p-4 text-slate-400 text-center">Search for classmates...</div>
                    )}
                </div>
            </div>

            {/* Right Column: Chat Box */}
            <div className={`flex-1 flex flex-col bg-[#efeae2] relative ${!activeChat ? 'hidden lg:flex items-center justify-center' : 'flex'}`}>
                {activeChat ? (
                    <>
                        {/* Compact Chat Header */}
                        <div className="h-16 bg-white border-b border-slate-200 flex items-center px-4 gap-3 z-10">
                            <button onClick={() => setActiveChat(null)} className="lg:hidden p-2 -ml-2 text-slate-600">←</button>
                            <Avatar className="w-10 h-10" display_name={activeChat.otherUser.display_name} photo_url={activeChat.otherUser.photo_url} />
                            <div>
                                <h2 className="font-bold text-slate-800 leading-tight">{activeChat.otherUser.display_name}</h2>
                                <p className="text-xs text-green-500 font-medium">online</p>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 pattern-bg">
                            <div className="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm max-w-[80%] text-sm self-start">
                                Hey! How is the project going?
                            </div>
                            <div className="bg-[#dcf8c6] p-3 rounded-2xl rounded-tr-none shadow-sm max-w-[80%] text-sm self-end ml-auto">
                                Almost done! Just fixing the UI animations.
                            </div>
                        </div>

                        {/* WhatsApp Style Bottom Bar */}
                        <div className="p-2 pb-4 bg-[#f0f2f5] flex items-end gap-2 px-3 relative min-h-[60px]">
                            {/* Input Container */}
                            <div className="flex-1 bg-white rounded-[24px] flex items-end p-2 px-4 shadow-sm border border-slate-200">
                                <button className="p-2 text-slate-500 hover:text-slate-700">😊</button>
                                <textarea 
                                    rows={1}
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    placeholder="Type a message"
                                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm max-h-32 py-2"
                                />
                                <button className="p-2 text-slate-500 hover:text-slate-700">📎</button>
                            </div>

                            {/* Dynamic Action Button */}
                            <div className="relative flex items-center justify-center">
                                {isRecording && !isLocked && (
                                    <div className="absolute bottom-20 flex flex-col items-center gap-2 transition-all duration-300">
                                        <div className={`p-3 bg-white rounded-full shadow-lg text-slate-400 ${dragY < -50 ? 'text-blue-500 scale-125' : ''}`}>
                                            <LockIcon />
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest animate-pulse">Slide up to lock</span>
                                    </div>
                                )}

                                {inputText.trim() ? (
                                    <button className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-md active:scale-90 transition-transform">
                                        <SendIcon />
                                    </button>
                                ) : (
                                    <button 
                                        onMouseDown={() => { setIsRecording(true); setDragY(0); }}
                                        onMouseUp={() => { if (!isLocked) setIsRecording(false); }}
                                        onMouseMove={(e) => { if(isRecording && !isLocked) setDragY(prev => Math.min(0, prev + e.movementY)); }}
                                        className={`w-12 h-12 flex items-center justify-center rounded-full shadow-md transition-all duration-300 ${isRecording ? 'bg-rose-500 text-white scale-150 -translate-y-2' : 'bg-emerald-500 text-white'}`}
                                    >
                                        <VoiceIcon />
                                    </button>
                                )}
                            </div>

                            {/* Recording Overlay UI */}
                            {isRecording && (
                                <div className="absolute inset-0 bg-[#f0f2f5] flex items-center px-6 animate-in slide-in-from-right duration-300 rounded-xl">
                                    <div className="flex items-center gap-3 flex-1">
                                        <span className="w-3 h-3 bg-rose-500 rounded-full animate-ping"></span>
                                        <span className="font-mono text-lg text-slate-700">0:01</span>
                                        <span className="text-slate-400 text-sm ml-4">Slide to cancel</span>
                                    </div>
                                    {isLocked && <button onClick={() => setIsRecording(false)} className="text-rose-500 font-bold px-4">CANCEL</button>}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="text-center opacity-40">
                        <LogoIcon className="w-24 h-24 mx-auto mb-4" />
                        <h2 className="text-2xl font-bold">VanTutor Messenger</h2>
                        <p>Select a classmate to start learning together.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
