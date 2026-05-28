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

// --- Animated Icons ---
const VoiceIcon = () => (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M11.999 14.942c2.001 0 3.531-1.53 3.531-3.531V5.059c0-2.001-1.53-3.531-3.531-3.531S8.469 3.058 8.469 5.059v6.353c0 2.001 1.53 3.531 3.53 3.531zm6.235-3.53c0 3.132-2.318 5.735-5.353 6.224v2.794h-1.764v-2.794c-3.036-.489-5.353-3.092-5.353-6.224H7.53c0 2.465 1.994 4.471 4.469 4.471s4.471-2.006 4.471-4.471h1.764z"/>
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
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const { addToast } = useToast();

    // WhatsApp-style Recording State
    const [isRecording, setIsRecording] = useState(false);
    const [inputText, setInputText] = useState("");

    // Auth & Basic Setup
    useEffect(() => {
        const unsub = onAuthStateChanged(auth, user => { 
            setFirebaseUser(user); 
            setIsLoading(false); 
        });
        return unsub;
    }, []);

    // Fetch All Users (to resolve names/avatars)
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

    // Fetch Chat List with resolved Names
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

    const handleStartChat = (other: UserProfile) => {
        if (!firebaseUser) return;
        const chatId = [firebaseUser.uid, other.uid].sort().join('_');
        setActiveChat({ chatId, otherUser: other });
        
        // Ensure user_chat exists in DB
        const updates: any = {};
        updates[`user_chats/${firebaseUser.uid}/${chatId}`] = { otherUserId: other.uid, timestamp: firebaseServerTimestamp() };
        updates[`user_chats/${other.uid}/${chatId}`] = { otherUserId: firebaseUser.uid, timestamp: firebaseServerTimestamp() };
        update(dbRef(db), updates);
    };

    if (isLoading) return <div className="p-10 text-center">Loading Messenger...</div>;
    if (!firebaseUser) return <div className="p-10 text-center">Please login to access chats.</div>;

    return (
        <div className="flex h-[calc(100vh-73px)] w-full overflow-hidden bg-white">
            {/* Left Column: List */}
            <div className={`w-full lg:w-[380px] border-r border-slate-200 flex flex-col ${activeChat ? 'hidden lg:flex' : 'flex'}`}>
                <div className="p-4 border-b border-slate-100 bg-white">
                    <div className="flex justify-between items-center mb-4">
                        <h1 className="text-xl font-bold text-slate-800">Messages</h1>
                        {/* Profile Menu */}
                        <div className="relative">
                            <button onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)} className="focus:outline-none">
                                <Avatar className="w-8 h-8 cursor-pointer ring-2 ring-slate-100" display_name={userProfile.display_name} photo_url={userProfile.photo_url} />
                            </button>
                            {isProfileMenuOpen && (
                                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-slate-50">
                                        <p className="text-sm font-bold text-slate-900 truncate">{userProfile.display_name}</p>
                                        <p className="text-[10px] text-slate-500 uppercase tracking-tighter">Student</p>
                                    </div>
                                    <button onClick={() => firebaseSignOut(auth)} className="w-full text-left px-4 py-3 text-sm text-rose-500 hover:bg-rose-50 font-medium transition-colors">Logout</button>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                        <button onClick={() => setTab('chats')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'chats' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>Chats</button>
                        <button onClick={() => setTab('people')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${tab === 'people' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>People</button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {tab === 'chats' ? (
                        chats.map(c => (
                            <div key={c.id} onClick={() => setActiveChat({ chatId: c.id, otherUser: c.otherUser })} className={`flex items-center gap-3 p-4 hover:bg-slate-50 cursor-pointer border-b border-slate-50 transition-colors ${activeChat?.chatId === c.id ? 'bg-slate-50' : ''}`}>
                                <Avatar className="w-12 h-12" display_name={c.otherUser?.display_name} photo_url={c.otherUser?.photo_url} />
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between">
                                        <h3 className="font-semibold text-slate-900 truncate">{c.otherUser?.display_name || "Unknown User"}</h3>
                                        <span className="text-[10px] text-slate-400">Now</span>
                                    </div>
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
                                    <p className="text-xs text-slate-500">Click to message</p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Right Column: Chat Box */}
            <div className={`flex-1 flex flex-col bg-[#efeae2] relative ${!activeChat ? 'hidden lg:flex items-center justify-center' : 'flex'}`}>
                {activeChat ? (
                    <>
                        {/* Header */}
                        <div className="h-16 bg-white border-b border-slate-200 flex items-center px-4 gap-3 z-10 shadow-sm">
                            <button onClick={() => setActiveChat(null)} className="lg:hidden p-2 text-slate-600">←</button>
                            <Avatar className="w-10 h-10" display_name={activeChat.otherUser.display_name} photo_url={activeChat.otherUser.photo_url} />
                            <div>
                                <h2 className="font-bold text-slate-800 leading-tight">{activeChat.otherUser.display_name}</h2>
                                <p className="text-[10px] text-green-500 font-bold uppercase">Online</p>
                            </div>
                        </div>

                        {/* Messages Placeholder */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                             <div className="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm max-w-[80%] text-sm">
                                Welcome to the chat![cite: 1]
                            </div>
                        </div>

                        {/* Bottom Bar */}
                        <div className="p-3 bg-[#f0f2f5] flex items-end gap-2">
                            <div className="flex-1 bg-white rounded-[24px] flex items-end p-2 px-4 shadow-sm border border-slate-200">
                                <textarea 
                                    rows={1}
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    placeholder="Type a message"
                                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-2"
                                />
                            </div>
                            <button className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-md active:scale-95 transition-transform">
                                {inputText.trim() ? <SendIcon /> : <VoiceIcon />}
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="text-center opacity-20 select-none">
                        <LogoIcon className="w-32 h-32 mx-auto mb-4" />
                        <h2 className="text-3xl font-black italic">VANTUTOR</h2>
                        <p className="font-medium">Select a classmate to chat[cite: 1]</p>
                    </div>
                )}
            </div>
        </div>
    );
};
