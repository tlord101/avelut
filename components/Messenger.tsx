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
import { ref as dbRef, onValue, off, set, push, update, serverTimestamp as firebaseServerTimestamp, onDisconnect, get } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

const VoiceIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
    </svg>
);

const MicrophoneOffIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.5a5.5 5.5 0 005.5-5.5V8.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 10v3a5 5 0 001.5 3.5M12 18.5V22m0 0H9m3 0h3" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5.5A3 3 0 0112 2.5h0a3 3 0 013 3V12a3 3 0 01-.3 1.3M4 4l16 16" />
    </svg>
);

const BackIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
);

const MessageIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 8.5h10M7 12h7m-9.5 8.5 2.1-3.2A8 8 0 0 1 12 18.5h2a8 8 0 0 0 8-8v-.5a8 8 0 0 0-8-8H10a8 8 0 0 0-8 8v.5a8 8 0 0 0 3.5 6.5Z" />
    </svg>
);

const formatAudioDuration = (seconds?: number): string => {
    if (!seconds || Number.isNaN(seconds)) return '0:00';
    const wholeSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const formatTimestamp = (timestamp?: number): string => {
    if (!timestamp) return 'now';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

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
    const [isRecordingVoice, setIsRecordingVoice] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const { addToast } = useToast();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const typingTimeoutRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<number | null>(null);
    const recordingStartedAtRef = useRef<number | null>(null);
    
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

    const clearRecordingTimer = () => {
        if (recordingTimerRef.current) {
            window.clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
    };

    const uploadVoiceNote = async (audioBlob: Blob, durationSeconds: number) => {
        const audioName = `${Date.now()}-voice-note.webm`;
        const audioRef = storageRef(storage, `private_chats/${chatId}/${audioName}`);
        const uploadResult = await uploadBytes(audioRef, audioBlob, { contentType: 'audio/webm' });
        const audioUrl = await getDownloadURL(uploadResult.ref);

        const messageListRef = dbRef(db, `private_messages/${chatId}`);
        const newMessageRef = push(messageListRef);
        const messageData: any = {
            sender_id: currentUser.uid,
            timestamp: firebaseServerTimestamp(),
            audio_url: audioUrl,
            audio_duration: durationSeconds,
        };

        await set(newMessageRef, messageData);

        const lastMessagePayload = {
            text: 'Voice note',
            timestamp: firebaseServerTimestamp(),
            sender_id: currentUser.uid,
            read_by: [currentUser.uid],
        };

        const updates: { [key: string]: any } = {};
        updates[`user_chats/${currentUser.uid}/${chatId}/last_message`] = lastMessagePayload;
        updates[`user_chats/${currentUser.uid}/${chatId}/timestamp`] = firebaseServerTimestamp();
        updates[`user_chats/${otherUser.uid}/${chatId}/last_message`] = lastMessagePayload;
        updates[`user_chats/${otherUser.uid}/${chatId}/timestamp`] = firebaseServerTimestamp();

        const unreadSnapshot = await get(dbRef(db, `user_chats/${otherUser.uid}/${chatId}/unreadCount`));
        const currentCount = unreadSnapshot.val() || 0;
        updates[`user_chats/${otherUser.uid}/${chatId}/unreadCount`] = currentCount + 1;
        await update(dbRef(db), updates);
    };

    const startVoiceRecording = async () => {
        try {
            if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
                addToast('Voice notes are not supported in this browser.', 'error');
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];
            recordingStartedAtRef.current = Date.now();
            setRecordingSeconds(0);
            setIsRecordingVoice(true);
            clearRecordingTimer();
            recordingTimerRef.current = window.setInterval(() => {
                if (recordingStartedAtRef.current) {
                    setRecordingSeconds(Math.max(1, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)));
                }
            }, 1000);

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());
                clearRecordingTimer();
                const durationSeconds = recordingStartedAtRef.current
                    ? Math.max(1, Math.ceil((Date.now() - recordingStartedAtRef.current) / 1000))
                    : Math.max(1, recordingSeconds);
                recordingStartedAtRef.current = null;
                setRecordingSeconds(durationSeconds);
                try {
                    setIsSending(true);
                    await uploadVoiceNote(audioBlob, durationSeconds);
                    addToast('Voice note sent.', 'success');
                } catch (error) {
                    console.error('Error sending voice note:', error);
                    addToast('Failed to send voice note.', 'error');
                } finally {
                    setIsSending(false);
                    setIsRecordingVoice(false);
                    setRecordingSeconds(0);
                }
            };

            mediaRecorder.start();
            addToast('Recording voice note. Tap again to send.', 'info');
        } catch (error) {
            console.error('Error starting voice recording:', error);
            addToast('Could not access microphone. Please check permissions.', 'error');
        }
    };

    const stopVoiceRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    const toggleVoiceRecording = () => {
        if (isRecordingVoice) {
            stopVoiceRecording();
        } else {
            void startVoiceRecording();
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
            const lastMessagePayload = { text: lastMessageText, timestamp: firebaseServerTimestamp(), sender_id: currentUser.uid, read_by: [currentUser.uid] };
            updates[`user_chats/${currentUser.uid}/${chatId}/last_message`] = lastMessagePayload;
            updates[`user_chats/${currentUser.uid}/${chatId}/timestamp`] = firebaseServerTimestamp();
            updates[`user_chats/${otherUser.uid}/${chatId}/last_message`] = lastMessagePayload;
            updates[`user_chats/${otherUser.uid}/${chatId}/timestamp`] = firebaseServerTimestamp();
            
            const unreadSnapshot = await get(dbRef(db, `user_chats/${otherUser.uid}/${chatId}/unreadCount`));
            const currentCount = unreadSnapshot.val() || 0;
            updates[`user_chats/${otherUser.uid}/${chatId}/unreadCount`] = currentCount + 1;
            await update(dbRef(db), updates);

        } catch (error) {
            console.error("Message send error:", error);
            addToast("Failed to send message.", "error");
        } finally {
            setIsSending(false);
        }
    };
    
    return (
        <div className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.82)_0%,_rgba(236,244,250,0.9)_36%,_rgba(226,232,240,0.95)_100%)] text-slate-900">
            <header className="shrink-0 border-b border-white/60 bg-white/45 px-4 py-4 backdrop-blur-2xl lg:px-6">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <button onClick={onBack} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-white/55 text-slate-600 transition hover:bg-white/75 lg:hidden" aria-label="Back to conversations">
                            <BackIcon />
                        </button>
                        <div className="relative shrink-0">
                            <Avatar display_name={otherUser.display_name} photo_url={otherUser.photo_url} className="h-12 w-12 ring-1 ring-slate-200" />
                            <div className="absolute -bottom-1 -right-1">
                                <UserStatusIndicator isOnline={otherUser.is_online} />
                            </div>
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h3 className="truncate text-base font-semibold text-slate-900">{otherUser.display_name}</h3>
                                {otherUser.is_online && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700">Online</span>}
                            </div>
                            <p className="truncate text-xs text-slate-500">
                                {isOtherUserTyping ? 'typing...' : (otherUser.is_online ? 'Available right now' : (otherUser.last_seen ? `Active ${formatLastSeen(otherUser.last_seen)}` : 'Offline'))}
                            </p>
                        </div>
                    </div>
                    <div className="hidden items-center gap-2 lg:flex">
                        <div className="rounded-full border border-white/60 bg-white/45 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 shadow-[0_8px_24px_rgba(15,23,42,0.04)] backdrop-blur-xl">
                            Secure direct chat
                        </div>
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-6">
                <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
                    {messages.length === 0 && (
                        <div className="rounded-[32px] border border-white/60 bg-white/55 p-8 text-center shadow-[0_18px_40px_rgba(15,23,42,0.06)] backdrop-blur-2xl">
                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-950/90 text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]">
                                <MessageIcon className="h-6 w-6" />
                            </div>
                            <h4 className="text-lg font-semibold text-slate-900">Start the conversation</h4>
                            <p className="mt-2 text-sm leading-6 text-slate-500">Send text, share an image, or record a voice note. Messages appear as clean, production-grade chat bubbles.</p>
                        </div>
                    )}

                    {messages.map(msg => {
                        const isOwnMessage = msg.sender_id === currentUser.uid;
                        return (
                            <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                                <div className={`flex max-w-[82%] gap-3 xl:max-w-[72%] ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                                    <div className="shrink-0 pt-1">
                                        <Avatar display_name={isOwnMessage ? currentUser.displayName || currentUserProfile.display_name : otherUser.display_name} photo_url={isOwnMessage ? currentUser.photoURL || currentUserProfile.photo_url : otherUser.photo_url} className="h-9 w-9" />
                                    </div>
                                    <div className={`flex flex-col gap-2 ${isOwnMessage ? 'items-end text-right' : 'items-start text-left'}`}>
                                        <div className="flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                                            <span>{isOwnMessage ? 'You' : otherUser.display_name}</span>
                                            <span>{formatTimestamp(msg.timestamp)}</span>
                                        </div>
                                        <div className={`rounded-[28px] border px-4 py-3.5 backdrop-blur-xl ${isOwnMessage ? 'border-slate-900/20 bg-slate-900/90 text-white shadow-[0_18px_40px_rgba(15,23,42,0.12)]' : 'border-white/70 bg-white/72 text-slate-900 shadow-[0_14px_30px_rgba(15,23,42,0.06)]'}`}>
                                            {msg.text && (
                                                <div className={`text-[15px] leading-6 ${msg.text.length > 240 ? 'max-w-none' : ''}`}>
                                                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                                                </div>
                                            )}
                                            {msg.image_url && (
                                                <div className="mt-3 overflow-hidden rounded-[22px] border border-black/5 bg-slate-50">
                                                    <img src={msg.image_url} alt="Sent media" className="max-h-96 w-full object-cover" />
                                                </div>
                                            )}
                                            {msg.audio_url && (
                                                <div className={`mt-3 rounded-[22px] border p-4 backdrop-blur-xl ${isOwnMessage ? 'border-white/10 bg-white/10' : 'border-white/60 bg-white/60'}`}>
                                                    <div className="flex items-center gap-3">
                                                        <div className={`flex h-11 w-11 items-center justify-center rounded-full ${isOwnMessage ? 'bg-white/10 text-white' : 'bg-slate-900 text-white'}`}>
                                                            <VoiceIcon className="h-5 w-5" />
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <p className={`text-sm font-semibold ${isOwnMessage ? 'text-white' : 'text-slate-900'}`}>Voice note</p>
                                                            <p className={`text-xs ${isOwnMessage ? 'text-white/70' : 'text-slate-500'}`}>{formatAudioDuration(msg.audio_duration)}</p>
                                                        </div>
                                                    </div>
                                                    <audio controls controlsList="nodownload" src={msg.audio_url} className="mt-4 w-full rounded-xl" />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {isOtherUserTyping && (
                        <div className="flex justify-start">
                            <div className="rounded-[22px] border border-white/60 bg-white/55 px-4 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.05)] backdrop-blur-xl">
                                <div className="flex items-center gap-2">
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400 [animation-delay:-0.4s]" />
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            <footer className="shrink-0 border-t border-white/60 bg-white/45 px-4 py-4 backdrop-blur-2xl lg:px-6">
                <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3">
                    {(isRecordingVoice || recordingSeconds > 0) && (
                        <div className="flex items-center justify-between rounded-[22px] border border-rose-200/50 bg-rose-50/70 px-4 py-3 text-rose-900 backdrop-blur-xl">
                            <div className="flex items-center gap-3">
                                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-600 text-white shadow-sm">
                                    <VoiceIcon className="h-5 w-5" />
                                </span>
                                <div>
                                    <p className="text-sm font-semibold">Recording voice note</p>
                                    <p className="text-xs text-rose-700">Tap the microphone again to send the audio note.</p>
                                </div>
                            </div>
                            <div className="text-sm font-semibold tabular-nums">{formatAudioDuration(recordingSeconds)}</div>
                        </div>
                    )}

                    {imagePreviewUrl && (
                        <div className="flex items-center gap-3 rounded-[22px] border border-white/60 bg-white/55 p-3 backdrop-blur-xl">
                            <img src={imagePreviewUrl} alt="Preview" className="h-16 w-16 rounded-2xl object-cover" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-slate-900">Image ready to send</p>
                                <p className="text-xs text-slate-500">It will be attached to the next message.</p>
                            </div>
                            <button
                                onClick={() => { setImageFile(null); setImagePreviewUrl(null); }}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-white hover:text-slate-900"
                                aria-label="Remove image"
                            >
                                <XIcon className="h-4 w-4" />
                            </button>
                        </div>
                    )}

                    <div className="rounded-[30px] border border-white/60 bg-white/45 p-3 shadow-[0_16px_40px_rgba(15,23,42,0.06)] backdrop-blur-2xl">
                        <div className="flex items-end gap-3">
                            <label htmlFor="file-upload" className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/60 bg-white/55 text-slate-600 transition hover:bg-white/75 hover:text-slate-900" aria-label="Attach image">
                                <PaperclipIcon className="h-5 w-5" />
                            </label>
                            <input id="file-upload" type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={isSending || isRecordingVoice} />

                            <div className="flex-1 rounded-[24px] border border-white/60 bg-white/50 px-4 py-3 transition focus-within:bg-white/80">
                                <textarea
                                    value={input}
                                    onChange={e => setInput(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            void handleSend();
                                        }
                                    }}
                                    placeholder="Write a message..."
                                    className="min-h-[48px] w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-6 text-slate-900 placeholder:text-slate-400 focus:ring-0"
                                    rows={1}
                                    disabled={isSending}
                                />
                                <div className="mt-2 flex items-center justify-between gap-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Secure direct message</p>
                                    <button
                                        type="button"
                                        onClick={toggleVoiceRecording}
                                        disabled={isSending}
                                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${isRecordingVoice ? 'border-rose-200/70 bg-rose-500/90 text-white shadow-[0_12px_28px_rgba(251,113,133,0.18)]' : 'border-white/60 bg-white/60 text-slate-600 hover:bg-white/80'}`}
                                    >
                                        {isRecordingVoice ? <MicrophoneOffIcon className="h-4 w-4" /> : <VoiceIcon className="h-4 w-4" />}
                                        {isRecordingVoice ? 'Stop & send voice note' : 'Record voice note'}
                                    </button>
                                </div>
                            </div>

                            <button
                                onClick={() => { void handleSend(); }}
                                disabled={isSending || (!input.trim() && !imageFile)}
                                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900/90 text-white shadow-[0_16px_30px_rgba(15,23,42,0.16)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Send message"
                            >
                                <SendIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
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
                displayName: userProfile.display_name, // Use RTDB profile name as source of truth
                photoURL: userProfile.photo_url,      // Use RTDB photo as source of truth
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
        <div className="flex min-h-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.88)_0%,_rgba(240,246,252,0.92)_42%,_rgba(226,232,240,0.98)_100%)] px-4 py-10">
            <div className="w-full max-w-2xl overflow-hidden rounded-[32px] border border-white/60 bg-white/55 shadow-[0_22px_60px_rgba(15,23,42,0.08)] backdrop-blur-2xl">
                <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="flex flex-col justify-between bg-slate-950/92 px-8 py-10 text-white sm:px-10">
                        <div>
                            <div className="flex items-center gap-3">
                                <LogoIcon className="h-10 w-10 text-emerald-400" />
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/50">Messenger</p>
                                    <h1 className="text-3xl font-semibold tracking-tight">Direct learning chat</h1>
                                </div>
                            </div>
                            <p className="mt-6 max-w-md text-sm leading-6 text-white/70">
                                Sign in to message other learners with image sharing, voice notes, and a clean, professional chat layout.
                            </p>
                        </div>
                        <div className="mt-8 grid grid-cols-3 gap-3 text-xs text-white/65">
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Real-time presence</div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Voice notes</div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 p-3">Image sharing</div>
                        </div>
                    </div>

                    <div className="px-8 py-10 sm:px-10">
                        <div className="mb-6">
                            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Secure sign-in</p>
                            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Continue with Google</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-500">Use your account to access your messenger inbox and connect with classmates.</p>
                        </div>

                        <button
                            onClick={handleGoogleSignIn}
                            disabled={isSubmitting}
                            className="flex w-full items-center justify-center rounded-2xl border border-white/60 bg-white/70 px-4 py-3.5 font-semibold text-slate-700 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isSubmitting ? (
                                <>
                                    <svg className="mr-2 h-5 w-5 animate-spin" viewBox="0 0 52 42" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4.33331 17.5L26 4.375L47.6666 17.5L26 30.625L4.33331 17.5Z" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    Signing In...
                                </>
                            ) : (
                                <>
                                    <GoogleIcon className="mr-3 h-5 w-5" />
                                    Sign in with Google
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- Main Component: Messenger ---
interface MessengerProps {
  userProfile: UserProfile;
}
export const Messenger: React.FC<MessengerProps> = ({ userProfile }) => {
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

        // Sync profile to Firebase Auth & RTDB
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
                department_id: userProfile.department_id,
                level: userProfile.level
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
            const usersList = Object.entries(usersData).map(([uid, data]: [string, any]) => ({ 
                uid, 
                display_name: data.displayName, 
                photo_url: data.photoURL,
                department_id: data.department_id,
                level: data.level
            }));
            
            const statusRef = dbRef(db, 'status');
            onValue(statusRef, (statusSnap) => {
                const statuses = statusSnap.val() || {};
                const usersWithStatus: UserProfile[] = usersList.map((u: any) => ({ ...u, ...statuses[u.uid] }));
                
                // Filter to show users in the same department and level
                const filteredUsers = usersWithStatus.filter(u => 
                    u.uid !== firebaseUser.uid && 
                    u.department_id === userProfile.department_id && 
                    u.level === userProfile.level
                );
                
                setAllFirebaseUsers(filteredUsers);
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

    const chatPane = selectedChatData && firebaseUser ? (
        <PrivateChatView
            chatId={selectedChatData.chatId}
            currentUser={firebaseUser}
            currentUserProfile={userProfile}
            otherUser={selectedChatData.otherUser}
            onBack={() => setSelectedChatData(null)}
        />
    ) : (
        <div className="flex h-full min-h-[28rem] items-center justify-center px-6 py-10">
            <div className="max-w-xl rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-sm lg:p-10">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
                    <MessageIcon className="h-7 w-7" />
                </div>
                <h3 className="mt-5 text-2xl font-semibold tracking-tight text-slate-900">Select a conversation</h3>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                    Open a direct chat from the left panel to start messaging, sending images, or recording voice notes.
                </p>
                <div className="mt-6 grid gap-3 text-left text-sm text-slate-600 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Clean bubble layout</div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Playable voice notes</div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Full-width experience</div>
                </div>
            </div>
        </div>
    );

    const sidebar = (
        <div className="flex h-full min-h-0 flex-col bg-white/35 backdrop-blur-2xl">
            <div className="border-b border-white/50 px-4 py-4 lg:px-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Messenger</p>
                        <h2 className="mt-1 text-xl font-semibold text-slate-900">Messages</h2>
                        <p className="mt-1 text-sm text-slate-500">Your direct conversations and people nearby.</p>
                    </div>
                    <div className="relative" ref={profileMenuRef}>
                        <button onClick={() => setIsProfileMenuOpen(prev => !prev)} className="flex items-center gap-3 rounded-full border border-white/60 bg-white/55 px-2 py-2 text-left shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition hover:bg-white/80">
                            <Avatar display_name={firebaseUser!.displayName} photo_url={firebaseUser!.photoURL} className="h-9 w-9" />
                            <div className="hidden min-w-0 sm:block">
                                <p className="max-w-[140px] truncate text-sm font-semibold text-slate-900">{firebaseUser!.displayName}</p>
                                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Profile</p>
                            </div>
                        </button>
                        {isProfileMenuOpen && (
                            <div className="absolute right-0 top-full z-20 mt-2 w-64 overflow-hidden rounded-2xl border border-white/60 bg-white/75 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur-2xl">
                                <div className="border-b border-white/50 p-4">
                                    <p className="font-semibold text-slate-900 truncate">{firebaseUser!.displayName}</p>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">This is the public name other learners will see in Messenger.</p>
                                </div>
                                <button
                                    onClick={() => { firebaseSignOut(auth); setIsProfileMenuOpen(false); }}
                                    className="w-full px-4 py-3 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                                >
                                    Log out
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-4 inline-flex w-full rounded-full border border-white/60 bg-white/45 p-1 backdrop-blur-xl">
                    <button onClick={() => setTab('chats')} className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition ${tab === 'chats' ? 'bg-slate-900/90 text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]' : 'text-slate-600 hover:bg-white/70'}`}>
                        Chats
                    </button>
                    <button onClick={() => setTab('add_friend')} className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition ${tab === 'add_friend' ? 'bg-slate-900/90 text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]' : 'text-slate-600 hover:bg-white/70'}`}>
                        People
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-3 lg:px-3">
                {tab === 'chats' && (
                    isDataLoading ? (
                        <div className="rounded-3xl border border-white/60 bg-white/45 p-6 text-center text-sm text-slate-500 backdrop-blur-xl">Loading chats...</div>
                    ) : chats.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-white/60 bg-white/40 p-6 text-center text-sm leading-6 text-slate-500 backdrop-blur-xl">
                            No conversations yet. Switch to People to start a new chat.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {chats.map(chat => {
                                const otherUserId = chat.members.find(id => id !== firebaseUser!.uid)!;
                                const otherUserInfo = allFirebaseUsers.find(u => u.uid === otherUserId);
                                const isUnread = (chat.unreadCount || 0) > 0;
                                return (
                                    <button
                                        key={chat.id}
                                        onClick={() => handleSelectChat(chat)}
                                        className={`w-full rounded-2xl border p-3 text-left transition backdrop-blur-xl ${selectedChatData?.chatId === chat.id ? 'border-slate-900/20 bg-white/80 shadow-[0_12px_28px_rgba(15,23,42,0.08)]' : 'border-white/60 bg-white/45 hover:bg-white/72'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="relative shrink-0">
                                                <Avatar display_name={chat.member_info[otherUserId]?.display_name} photo_url={chat.member_info[otherUserId]?.photo_url} className={`h-12 w-12 ${isUnread ? 'ring-2 ring-slate-900 ring-offset-2' : ''}`} />
                                                <div className="absolute -bottom-1 -right-1"><UserStatusIndicator isOnline={otherUserInfo?.is_online} /></div>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <p className={`truncate text-sm font-semibold ${isUnread ? 'text-slate-900' : 'text-slate-700'}`}>{chat.member_info[otherUserId]?.display_name}</p>
                                                    <p className="shrink-0 text-[11px] text-slate-400">{chat.last_message ? formatLastSeen(chat.last_message.timestamp) : ''}</p>
                                                </div>
                                                <p className={`mt-1 truncate text-sm ${isUnread ? 'font-medium text-slate-800' : 'text-slate-500'}`}>{chat.last_message?.text || 'No messages yet'}</p>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )
                )}

                {tab === 'add_friend' && (
                    isDataLoading ? (
                        <div className="rounded-3xl border border-white/60 bg-white/45 p-6 text-center text-sm text-slate-500 backdrop-blur-xl">Loading users...</div>
                    ) : (
                        <div className="space-y-2">
                            {allFirebaseUsers.filter(u => u.uid !== firebaseUser?.uid).length === 0 ? (
                                <div className="rounded-3xl border border-dashed border-white/60 bg-white/40 p-6 text-center text-sm text-slate-500 backdrop-blur-xl">No other users have signed in yet.</div>
                            ) : allFirebaseUsers.filter(u => u.uid !== firebaseUser?.uid).map(user => (
                                <div key={user.uid} className="rounded-2xl border border-white/60 bg-white/45 p-3 transition hover:bg-white/72 backdrop-blur-xl">
                                    <div className="flex items-center gap-3">
                                        <div className="relative shrink-0">
                                            <Avatar display_name={user.display_name} photo_url={user.photo_url} className="h-12 w-12" />
                                            <div className="absolute -bottom-1 -right-1"><UserStatusIndicator isOnline={user.is_online} /></div>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold text-slate-900">{user.display_name}</p>
                                            <p className="truncate text-xs text-slate-500">{user.is_online ? 'Online' : (user.last_seen ? `Active ${formatLastSeen(user.last_seen)}` : 'Offline')}</p>
                                        </div>
                                        <button onClick={() => handleStartChat(user)} className="rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800">
                                            Chat
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );
    
    if (isAuthLoading) {
        return <div className="flex h-full items-center justify-center bg-slate-50"><p className="text-sm text-slate-500">Loading Messenger...</p></div>;
    }
    if (!firebaseUser) {
        return <MessengerAuth userProfile={userProfile} />;
    }

    return (
        <div className="flex h-full min-h-0 w-full flex-col bg-[linear-gradient(180deg,#eef3f9_0%,#f8fafc_100%)] text-slate-900">
            <header className="shrink-0 border-b border-slate-200/80 bg-white/72 px-4 py-4 backdrop-blur-xl lg:px-6">
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-400">VanTutor</p>
                        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Messenger</h1>
                        <p className="mt-1 text-sm text-slate-500">A full-width direct messaging space for learners.</p>
                    </div>
                    <div className="hidden items-center gap-3 sm:flex">
                        <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">{chats.length} chats</div>
                        <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">{allFirebaseUsers.length} people</div>
                    </div>
                </div>
            </header>

            <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
                <aside className="min-h-0 border-b border-slate-200/80 bg-white/60 lg:border-b-0 lg:border-r">
                    {sidebar}
                </aside>
                <main className="min-h-0">
                    {chatPane}
                </main>
            </div>
        </div>
    );
};