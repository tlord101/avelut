import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { ref as dbRef, onValue, off, set, push, update, serverTimestamp as firebaseServerTimestamp, onDisconnect } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { supabase } from '../supabase';

const UserStatusIndicator: React.FC<{ isOnline?: boolean; lastSeen?: number }> = ({ isOnline }) => {
    return <div className={`w-3 h-3 rounded-full border-2 border-white ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></div>;
};

const formatLastSeen = (timestamp: number): string => {
    const now = Date.now();
    const seconds = Math.floor((now - timestamp) / 1000);

    if (seconds < 60) return `now`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    
    return new Date(timestamp).toLocaleDateString();
};

// --- Sub-component: PrivateChatView ---
interface PrivateChatViewProps {
  chatId: string;
  currentUser: FirebaseUser;
  currentUserProfile: UserProfile;
  otherUser: UserProfile;
  onBack: () => void;
}

const PrivateChatView: React.FC<PrivateChatViewProps> = ({ chatId, currentUser, currentUserProfile, otherUser, onBack }) => {
    const [messages, setMessages] = useState<PrivateMessage[]>([]);
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
    const { addToast } = useToast();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const typingTimeoutRef = useRef<number | null>(null);
    
    useEffect(() => {
        const messagesRef = dbRef(db, `private_messages/${chatId}`);
        const handleNewMessages = (snapshot: any) => {
            const messagesData = snapshot.val() || {};
            const loadedMessages: PrivateMessage[] = Object.entries(messagesData).map(([id, msg]: [string, any]) => ({ id, ...msg }));
            loadedMessages.sort((a, b) => a.timestamp - b.timestamp);
            setMessages(loadedMessages);
            
            const userChatRef = dbRef(db, `user_chats/${currentUser.uid}/${chatId}/unreadCount`);
            set(userChatRef, 0);
        };
        onValue(messagesRef, handleNewMessages);
        
        const typingRef = dbRef(db, `typing/${chatId}/${otherUser.uid}`);
        const handleTyping = (snapshot: any) => setIsOtherUserTyping(snapshot.val() === true);
        onValue(typingRef, handleTyping);

        return () => {
            off(messagesRef, 'value', handleNewMessages);
            off(typingRef, 'value', handleTyping);
        };
    }, [chatId, currentUser.uid, otherUser.uid]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isOtherUserTyping]);

    const updateTypingStatus = (isTyping: boolean) => {
        const typingRef = dbRef(db, `typing/${chatId}/${currentUser.uid}`);
        set(typingRef, isTyping);
    };

    useEffect(() => {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (input) {
            updateTypingStatus(true);
            typingTimeoutRef.current = window.setTimeout(() => updateTypingStatus(false), 3000);
        } else {
            updateTypingStatus(false);
        }
    }, [input, chatId, currentUser.uid]);
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) { // 5MB limit
                addToast("Image must be under 5MB.", "error");
                return;
            }
            setImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreviewUrl(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSend = async () => {
        if ((!input.trim() && !imageFile) || isSending) return;
        
        const textToSend = input.trim();
        const fileToSend = imageFile;

        setIsSending(true);
        setInput('');
        setImageFile(null);
        setImagePreviewUrl(null);
        updateTypingStatus(false);
        
        try {
            let imageUrl: string | undefined;
            if (fileToSend) {
                const imageRef = storageRef(storage, `private_chats/${chatId}/${new Date().getTime()}-${fileToSend.name}`);
                const uploadResult = await uploadBytes(imageRef, fileToSend);
                imageUrl = await getDownloadURL(uploadResult.ref);
            }

            const messageListRef = dbRef(db, `private_messages/${chatId}`);
            const newMessageRef = push(messageListRef);
            const messageData: any = {
                sender_id: currentUser.uid,
                timestamp: firebaseServerTimestamp()
            };
            
            // Only add properties if they have values (Firebase doesn't allow undefined)
            if (textToSend) {
                messageData.text = textToSend;
            }
            if (imageUrl) {
                messageData.image_url = imageUrl;
            }

            await set(newMessageRef, messageData);
            
            const updates: { [key: string]: any } = {};
            let lastMessageText = textToSend;
            if (!lastMessageText && fileToSend) {
                lastMessageText = '📷 Photo';
            }
            const lastMessagePayload = { text: lastMessageText, timestamp: firebaseServerTimestamp(), sender_id: currentUser.uid };
            updates[`user_chats/${currentUser.uid}/${chatId}/last_message`] = lastMessagePayload;
            updates[`user_chats/${currentUser.uid}/${chatId}/timestamp`] = firebaseServerTimestamp();
            updates[`user_chats/${otherUser.uid}/${chatId}/last_message`] = lastMessagePayload;
            updates[`user_chats/${otherUser.uid}/${chatId}/timestamp`] = firebaseServerTimestamp();
            
            const otherUserChatRef = dbRef(db, `user_chats/${otherUser.uid}/${chatId}/unreadCount`);
            onValue(otherUserChatRef, (snap) => {
                const currentCount = snap.val() || 0;
                updates[`user_chats/${otherUser.uid}/${chatId}/unreadCount`] = currentCount + 1;
                update(dbRef(db), updates);
            }, { onlyOnce: true });

        } catch (error) {
            console.error("Message send error:", error);
            addToast("Failed to send message.", "error");
        } finally {
            setIsSending(false);
        }
    };
    
    return (
        <div className="h-full flex flex-col bg-gray-50 chat-bg-pattern">
            <header className="flex-shrink-0 flex items-center justify-between gap-3 p-4 bg-white rounded-b-3xl shadow-lg relative z-10">
                 <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-1 text-gray-500 hover:text-gray-900 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
                     <div className="relative"><Avatar display_name={otherUser.display_name} photo_url={otherUser.photo_url} className="w-10 h-10" /><div className="absolute -bottom-1 -right-1"><UserStatusIndicator isOnline={otherUser.is_online} /></div></div>
                    <div><h3 className="font-bold text-gray-800 leading-tight">{otherUser.display_name}</h3><p className="text-xs text-gray-500 leading-tight">{isOtherUserTyping ? 'typing...' : (otherUser.is_online ? 'Online' : (otherUser.last_seen ? `Active ${formatLastSeen(otherUser.last_seen)}` : 'Offline'))}</p></div>
                </div>
            </header>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {messages.map(msg => (
                    <div key={msg.id} className={`flex gap-3 items-end ${msg.sender_id === currentUser.uid ? 'justify-end' : 'justify-start'}`}>
                       <div className={`flex flex-col max-w-[80%] p-3 rounded-2xl ${msg.sender_id === currentUser.uid ? 'bg-lime-500 text-white' : 'bg-white text-gray-800 border border-gray-200'}`}>
                           {msg.image_url && <img src={msg.image_url} alt="Sent media" className="rounded-lg max-w-xs max-h-64 mb-2" />}
                           {msg.text && <div className="text-sm whitespace-pre-wrap"><ReactMarkdown>{msg.text}</ReactMarkdown></div>}
                        </div>
                    </div>
                ))}
                {isOtherUserTyping && <div className="flex gap-3 items-end justify-start animate-fade-in-up"><div className="p-3 rounded-2xl bg-white text-gray-800 border border-gray-200"><div className="flex items-center space-x-2"><div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse [animation-delay:-0.3s]"></div><div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse [animation-delay:-0.15s]"></div><div className="w-2 h-2 bg-gray-500 rounded-full animate-pulse"></div></div></div></div>}
                <div ref={messagesEndRef} />
            </div>
            <footer className="flex-shrink-0 bg-white/80 backdrop-blur-sm p-3">
                {imagePreviewUrl && (
                    <div className="relative w-24 h-24 mb-2 p-1 border border-gray-200 rounded-lg">
                        <img src={imagePreviewUrl} alt="Preview" className="w-full h-full object-cover rounded" />
                        <button 
                            onClick={() => { setImageFile(null); setImagePreviewUrl(null); }} 
                            className="absolute -top-2 -right-2 bg-gray-700 text-white rounded-full p-0.5 hover:bg-red-500 transition-colors"
                        >
                            <XIcon className="w-4 h-4" />
                        </button>
                    </div>
                )}
                <div className="relative flex items-center">
                    <label htmlFor="file-upload" className="mr-2 cursor-pointer p-3 text-gray-500 hover:text-lime-600 transition-colors">
                        <PaperclipIcon className="w-6 h-6" />
                    </label>
                    <input id="file-upload" type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={isSending} />
                    <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {if (e.key === 'Enter') handleSend()}} placeholder="Type a message..." className="w-full bg-gray-100 border-transparent rounded-full py-2 px-4 text-gray-900 placeholder-gray-500 focus:ring-lime-500 focus:border-lime-500" />
                    <button onClick={handleSend} disabled={isSending || (!input.trim() && !imageFile)} className="ml-2 bg-lime-600 rounded-full p-3 text-white hover:bg-lime-700 transition-colors disabled:opacity-50 active:scale-95"><SendIcon className="w-6 h-6" /></button>
                </div>
            </footer>
        </div>
    );
};

// --- Sub-component: MessengerAuth ---
interface MessengerAuthProps {
  userProfile: UserProfile;
}
const MessengerAuth: React.FC<MessengerAuthProps> = ({ userProfile }) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { addToast } = useToast();

    const handleGoogleSignIn = async () => {
        setIsSubmitting(true);
        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // Create/update user record in RTDB for discovery and presence
            const userRef = dbRef(db, `users/${user.uid}`);
            await set(userRef, {
                displayName: userProfile.display_name, // Use Supabase profile name as source of truth
                photoURL: userProfile.photo_url,      // Use Supabase photo as source of truth
            });
            
            addToast("Successfully signed into Messenger!", "success");
            // The onAuthStateChanged listener in the parent Messenger component will handle the UI update.
        } catch (error: any) {
            console.error("Google Sign-in error:", error);
            // Handle common errors
            if (error.code === 'auth/popup-closed-by-user') {
                 addToast("Sign-in cancelled.", "info");
            } else {
                addToast(error.message, "error");
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex items-center justify-center h-full bg-gray-50 p-4">
          <div className="w-full max-w-sm">
            <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 shadow-xl text-center">
              <div className="flex justify-center items-center mb-4">
                  <LogoIcon className="w-10 h-10 text-lime-500" />
                  <h1 className="text-2xl font-bold bg-gradient-to-b from-lime-500 to-green-600 text-transparent bg-clip-text tracking-wider ml-3">
                      Messenger
                  </h1>
              </div>
              <p className="text-gray-600 mb-8">
                Sign in with your Google account to chat with other learners.
              </p>
              
              <button
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className="w-full bg-white border border-gray-300 text-gray-700 font-semibold py-3 px-4 rounded-lg hover:bg-gray-50 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isSubmitting ? (
                    <>
                      <svg className="w-5 h-5 mr-2 animate-spin" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span>Signing In...</span>
                    </>
                ) : (
                    <>
                        <GoogleIcon className="w-5 h-5 mr-3" />
                        Sign in with Google
                    </>
                )}
              </button>
            </div>
          </div>
        </div>
    );
};


// --- Main Component: Messenger ---
interface MessengerProps {
  userProfile: UserProfile;
  allUsers: UserProfile[]; // Supabase users, for search
}
export const Messenger: React.FC<MessengerProps> = ({ userProfile, allUsers }) => {
    const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
    const [isAuthLoading, setIsAuthLoading] = useState(true);
    const [view, setView] = useState<'list' | 'chat'>('list');
    const [selectedChatData, setSelectedChatData] = useState<{ chatId: string, otherUser: UserProfile } | null>(null);
    const [tab, setTab] = useState<'chats' | 'add_friend'>('chats');
    const [chats, setChats] = useState<(ChatMetadata & { unreadCount?: number })[]>([]);
    const [allFirebaseUsers, setAllFirebaseUsers] = useState<UserProfile[]>([]);
    const [isDataLoading, setIsDataLoading] = useState(true);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement>(null);
    const { addToast } = useToast();
    
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            setFirebaseUser(user);
            setIsAuthLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
                setIsProfileMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    useEffect(() => {
        if (!firebaseUser) {
            setIsDataLoading(false);
            setChats([]);
            setAllFirebaseUsers([]);
            return;
        };

        // Sync Supabase profile to Firebase Auth & RTDB
        const syncFirebaseProfile = async () => {
            const authUpdates: { displayName?: string; photoURL?: string | null } = {};

            if (userProfile.display_name !== firebaseUser.displayName) {
                authUpdates.displayName = userProfile.display_name;
            }
            if (userProfile.photo_url !== (firebaseUser.photoURL || undefined)) {
                authUpdates.photoURL = userProfile.photo_url || null;
            }

            if (Object.keys(authUpdates).length > 0) {
                try {
                    await updateProfile(firebaseUser, authUpdates);
                    // Reload the user to get the fresh profile data. The onAuthStateChanged will then update our state.
                    await firebaseUser.reload();
                } catch (e) {
                    console.error("Failed to update Firebase Auth profile:", e);
                    addToast("Could not sync profile changes to Messenger.", "error");
                }
            }
            
            // This is the public profile for other users to see.
            const rtdbUserRef = dbRef(db, `users/${firebaseUser.uid}`);
            update(rtdbUserRef, {
                displayName: userProfile.display_name,
                photoURL: userProfile.photo_url,
            });
        };

        syncFirebaseProfile();

        const myStatusRef = dbRef(db, `status/${firebaseUser.uid}`);
        const connectedRef = dbRef(db, '.info/connected');
        onValue(connectedRef, (snap) => {
            if (snap.val() === true) {
                set(myStatusRef, { is_online: true, last_seen: firebaseServerTimestamp() });
                onDisconnect(myStatusRef).set({ is_online: false, last_seen: firebaseServerTimestamp() });
            }
        });

        const usersRef = dbRef(db, 'users');
        const handleUsers = (snapshot: any) => {
            const usersData = snapshot.val() || {};
            const usersList = Object.entries(usersData).map(([uid, data]: [string, any]) => ({ uid, display_name: data.displayName, photo_url: data.photoURL }));
            
            const statusRef = dbRef(db, 'status');
            onValue(statusRef, (statusSnap) => {
                const statuses = statusSnap.val() || {};
                const usersWithStatus: UserProfile[] = usersList.map((u: any) => ({ ...u, ...statuses[u.uid] }));
                setAllFirebaseUsers(usersWithStatus);
            });
        };
        onValue(usersRef, handleUsers);
        
        const userChatsRef = dbRef(db, `user_chats/${firebaseUser.uid}`);
        const handleChats = (snapshot: any) => {
            const chatsData = snapshot.val() || {};
            if (!chatsData) {
                setChats([]);
                setIsDataLoading(false);
                return;
            }
            const chatIds = Object.keys(chatsData);
            const chatPromises = chatIds.map(chatId => {
                return new Promise<ChatMetadata & { unreadCount?: number }>(resolve => {
                    const otherUserId = chatsData[chatId].otherUserId;
                    const otherUserRef = dbRef(db, `users/${otherUserId}`);
                    onValue(otherUserRef, (userSnap) => {
                        const otherUserData = userSnap.val() || {};
                        resolve({
                            id: chatId, members: [firebaseUser.uid, otherUserId],
                            member_info: {
                                [firebaseUser.uid]: { display_name: firebaseUser.displayName!, photo_url: userProfile.photo_url },
                                [otherUserId]: { display_name: otherUserData.displayName, photo_url: otherUserData.photoURL }
                            },
                            last_message: chatsData[chatId].last_message,
                            last_activity_timestamp: chatsData[chatId].timestamp,
                            unreadCount: chatsData[chatId].unreadCount,
                            created_at: 0
                        });
                    }, { onlyOnce: true });
                });
            });
            Promise.all(chatPromises).then(resolvedChats => {
                resolvedChats.sort((a,b) => (b.last_activity_timestamp || 0) - (a.last_activity_timestamp || 0));
                setChats(resolvedChats);
                setIsDataLoading(false);
            });
        };
        onValue(userChatsRef, handleChats);

        return () => {
            off(usersRef);
            off(userChatsRef);
        };
    }, [firebaseUser, userProfile.display_name, userProfile.photo_url, addToast]);

    const handleStartChat = async (otherUser: UserProfile) => {
        if (!firebaseUser) return;
        const members = [firebaseUser.uid, otherUser.uid].sort();
        const chatId = members.join('_');
        
        const updates: { [key: string]: any } = {};
        updates[`user_chats/${firebaseUser.uid}/${chatId}`] = { otherUserId: otherUser.uid, unreadCount: 0, timestamp: firebaseServerTimestamp() };
        updates[`user_chats/${otherUser.uid}/${chatId}`] = { otherUserId: firebaseUser.uid, unreadCount: 0, timestamp: firebaseServerTimestamp() };
        
        await update(dbRef(db), updates);
        
        setSelectedChatData({ chatId, otherUser });
        setView('chat');
        setTab('chats');
    };
    
    const handleSelectChat = (chat: ChatMetadata) => {
        if (!firebaseUser) return;
        const otherUserId = chat.members.find(id => id !== firebaseUser.uid)!;
        const otherUser = allFirebaseUsers.find(u => u.uid === otherUserId) || { uid: otherUserId, display_name: chat.member_info[otherUserId].display_name, photo_url: chat.member_info[otherUserId].photo_url };
        setSelectedChatData({ chatId: chat.id, otherUser: otherUser as UserProfile });
        setView('chat');
    };
    
    if (isAuthLoading) {
        return <div className="flex items-center justify-center h-full"><p>Loading Messenger...</p></div>;
    }
    if (!firebaseUser) {
        return <MessengerAuth userProfile={userProfile} />;
    }

    const renderListView = () => (
         <div className="h-full flex flex-col bg-white">
            <header className="flex-shrink-0 p-4 border-b border-gray-200">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800">Messages</h2>
                    <div className="relative" ref={profileMenuRef}>
                        <button onClick={() => setIsProfileMenuOpen(prev => !prev)} className="flex items-center gap-2 text-left p-1 rounded-full hover:bg-gray-100 transition-colors">
                            <span className="font-semibold text-gray-700 text-sm hidden sm:inline">{firebaseUser!.displayName}</span>
                            <Avatar display_name={firebaseUser!.displayName} photo_url={firebaseUser!.photoURL} className="w-9 h-9" />
                        </button>
                        {isProfileMenuOpen && (
                            <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-20 animate-fade-in-up">
                                <div className="p-4 border-b border-gray-200">
                                    <p className="font-bold text-gray-800 truncate">{firebaseUser!.displayName}</p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        This is your display name for Messenger. Other users can find you by searching this name.
                                    </p>
                                </div>
                                <button 
                                    onClick={() => { firebaseSignOut(auth); setIsProfileMenuOpen(false); }} 
                                    className="w-full text-left px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                                >
                                    Logout
                                </button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="mt-4 bg-gray-100 p-1 rounded-full flex">
                    <button onClick={() => setTab('chats')} className={`flex-1 p-2 rounded-md font-semibold text-sm transition-colors ${tab === 'chats' ? 'bg-lime-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}>Chats</button>
                    <button onClick={() => setTab('add_friend')} className={`flex-1 p-2 rounded-md font-semibold text-sm transition-colors ${tab === 'add_friend' ? 'bg-lime-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}>All Users</button>
                </div>
            </header>
            <div className="flex-1 overflow-y-auto">
                {tab === 'chats' && (
                    isDataLoading ? <div className="p-4 text-center text-gray-500">Loading chats...</div> :
                    chats.length === 0 ? <div className="p-4 text-center text-gray-500">No chats yet. Find users in the "All Users" tab.</div> :
                    <ul className="divide-y divide-gray-200">{chats.map(chat => {
                        const otherUserId = chat.members.find(id => id !== firebaseUser.uid)!;
                        const otherUserInfo = allFirebaseUsers.find(u => u.uid === otherUserId);
                        const isUnread = (chat.unreadCount || 0) > 0;
                        return <li key={chat.id} onClick={() => handleSelectChat(chat)} className="p-4 hover:bg-gray-50 flex items-center gap-4 cursor-pointer">
                                <div className="relative flex-shrink-0">
                                    <Avatar display_name={chat.member_info[otherUserId]?.display_name} photo_url={chat.member_info[otherUserId]?.photo_url} className={`w-12 h-12 ${isUnread ? 'ring-2 ring-lime-500 ring-offset-2' : ''}`}/>
                                    <div className="absolute -bottom-1 -right-1"><UserStatusIndicator isOnline={otherUserInfo?.is_online} /></div>
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <div className="flex justify-between items-center"><p className={`font-semibold truncate ${isUnread ? 'text-gray-900' : 'text-gray-700'}`}>{chat.member_info[otherUserId]?.display_name}</p><p className="text-xs text-gray-400">{chat.last_message ? formatLastSeen(chat.last_message.timestamp) : ''}</p></div>
                                    <p className={`text-sm truncate ${isUnread ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>{chat.last_message?.text || '...'}</p>
                                </div>
                        </li>
                    })}</ul>
                )}
                {tab === 'add_friend' && (
                     isDataLoading ? <div className="p-4 text-center text-gray-500">Loading users...</div> :
                     <ul className="divide-y divide-gray-200">{
                        allFirebaseUsers.filter(u => u.uid !== firebaseUser?.uid).length === 0
                        ? <p className="text-center text-gray-500 p-8">No other users have signed into Messenger yet.</p>
                        : allFirebaseUsers.filter(u => u.uid !== firebaseUser?.uid).map(user => (
                            <li key={user.uid} className="p-4 hover:bg-gray-50 flex items-center gap-4 cursor-pointer">
                                <div className="relative flex-shrink-0">
                                    <Avatar display_name={user.display_name} photo_url={user.photo_url} className="w-12 h-12" />
                                    <div className="absolute -bottom-1 -right-1"><UserStatusIndicator isOnline={user.is_online} /></div>
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <p className="font-semibold truncate text-gray-800">{user.display_name}</p>
                                    <p className="text-sm truncate text-gray-500">{user.is_online ? 'Online' : (user.last_seen ? `Active ${formatLastSeen(user.last_seen)}` : 'Offline')}</p>
                                </div>
                                <button onClick={() => handleStartChat(user)} className="px-4 py-2 text-sm rounded-lg bg-lime-600 text-white font-semibold hover:bg-lime-700">
                                    Chat
                                </button>
                            </li>
                        ))
                     }</ul>
                )}
            </div>
        </div>
    );

    return (
        <div className="flex-1 flex flex-col w-full h-full overflow-hidden bg-white md:rounded-xl border border-gray-200">
            {view === 'list' && renderListView()}
            {view === 'chat' && selectedChatData && (
                <PrivateChatView 
                    chatId={selectedChatData.chatId}
                    currentUser={firebaseUser} 
                    currentUserProfile={userProfile}
                    otherUser={selectedChatData.otherUser} 
                    onBack={() => setView('list')}
                />
            )}
        </div>
    );
};