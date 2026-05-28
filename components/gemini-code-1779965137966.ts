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
            
            if (textToSend) {
                messageData.text = textToSend;
            }
            if (imageUrl) {
                messageData.image_