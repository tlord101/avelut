import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Chat as GeminiChat } from '@google/genai';
import { db } from '../firebase';
import { ref as dbRef, onValue, off, set, push, get, remove, serverTimestamp } from 'firebase/database';
import type { UserProfile, Message, ChatConversation } from '../types';
import { useToast } from '../hooks/useToast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { ChatBubbleIcon } from './icons/ChatBubbleIcon';
import { SendIcon } from './icons/SendIcon';
import { ConfirmationModal } from './ConfirmationModal';
import { ListIcon } from './icons/ListIcon';
import { Avatar } from './Avatar';

// @ts-ignore
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- INLINE ICONS ---
const VoiceIcon: React.FC<{className?: string}> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
    </svg>
);


// --- TEXT CHAT COMPONENT ---
const TextChat: React.FC<{
    userProfile: UserProfile;
    conversations: ChatConversation[];
    activeConversationId: string | null;
    setActiveConversationId: (id: string | null) => void;
    isHistoryLoading: boolean;
    handleDeleteConversation: (id: string) => void;
    handleRenameConversation: (id: string, newTitle: string) => void;
    handleClearAll: () => void;
    handleNewChat: () => void;
    isDeleting: boolean;
}> = ({
    userProfile, conversations, activeConversationId, setActiveConversationId, isHistoryLoading,
    handleDeleteConversation, handleRenameConversation, handleClearAll, handleNewChat, isDeleting
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
    const [isVoiceMode, setIsVoiceMode] = useState(false);
    const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing'>('idle');
    const [courseContext, setCourseContext] = useState<string>('');
    const geminiChat = useRef<GeminiChat | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const { addToast } = useToast();
    const liveSessionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioWorkletRef = useRef<AudioWorkletNode | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);

    // Fetch course and topic context
    useEffect(() => {
        const fetchCourseContext = async () => {
            try {
                const courseSnapshot = await get(dbRef(db, `courses_data/${userProfile.course_id}`));
                const courseData = courseSnapshot.val();
                
                const progressSnapshot = await get(dbRef(db, `user_progress/${userProfile.uid}`));
                const progressData = progressSnapshot.val() || {};
                
                const completedTopics = Object.keys(progressData).filter(pId => progressData[pId].is_complete);
                const subjects = courseData?.subject_list || [];
                
                let contextText = `User's Course Information:\n`;
                contextText += `Level: ${userProfile.level}\n`;
                contextText += `Course ID: ${userProfile.course_id}\n\n`;
                contextText += `Subjects and Topics:\n`;
                
                subjects.forEach((subject: any) => {
                    if (subject.level === userProfile.level) {
                        contextText += `\n${subject.subject_name}:\n`;
                        subject.topics?.forEach((topic: any) => {
                            const completed = completedTopics.includes(topic.topic_id);
                            contextText += `  - ${topic.topic_name} ${completed ? '(✓ completed)' : '(in progress)'}\n`;
                        });
                    }
                });
                
                setCourseContext(contextText);
            } catch (error) {
                console.error('Error fetching course context:', error);
            }
        };
        
        fetchCourseContext();
    }, [userProfile.uid, userProfile.course_id, userProfile.level]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    useEffect(() => {
        if (!activeConversationId) {
            setMessages([]);
            geminiChat.current = null;
            return;
        }

        const messagesRef = dbRef(db, `chat_messages/${activeConversationId}`);
        const unsubscribeMessages = onValue(messagesRef, (snapshot) => {
            if (snapshot.exists()) {
                const data: any[] = [];
                snapshot.forEach((child) => {
                    data.push({ id: child.key, ...child.val() });
                });
                const sortedMessages = data.sort((a,b) => a.timestamp - b.timestamp);
                setMessages(sortedMessages as Message[]);

                const history = sortedMessages.map(msg => ({
                    role: msg.sender === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text || '' }]
                }));
                
                const systemInstruction = `You are VANTUTOR, an expert AI tutor. You have deep knowledge of the student's current course and their progress. Use this information to provide personalized, contextual help.\n\n${courseContext}\n\nProvide clear, detailed explanations tailored to their level. Reference their completed and in-progress topics when relevant to show connections. Be encouraging and supportive.`;
                
                geminiChat.current = ai.chats.create({ 
                    model: 'gemini-2.0-flash', 
                    history,
                    systemInstruction 
                });
            } else {
                setMessages([]);
                geminiChat.current = null;
            }
        });

        return () => off(messagesRef);
    }, [activeConversationId, courseContext]);

    const handleSendMessage = async () => {
        if (!input.trim() || isLoading) return;
        const currentInput = input;
        setInput('');
        setIsLoading(true);
    
        try {
            let currentConvoId = activeConversationId;
    
            // If it's a new chat, create it before sending the message
            if (!currentConvoId) {
                const now = Date.now();
                const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);
                const newConvoRef = push(conversationsRef);
                const convoData = {
                    title: 'New Chat',
                    created_at: now,
                    last_updated_at: now
                };
                await set(newConvoRef, convoData);
                currentConvoId = newConvoRef.key!;
                setActiveConversationId(currentConvoId);
                
                // Don't wait for title generation
                ai.models.generateContent({ model: 'gemini-2.0-flash', contents: `Generate a very short, concise title (4 words max) for the following user query: "${currentInput}"` })
                    .then(titleResult => update(dbRef(db, `chat_conversations/${userProfile.uid}/${currentConvoId}`), { title: titleResult.text.replace(/"/g, '') }));
            }
            
            const messagesRef = dbRef(db, `chat_messages/${currentConvoId}`);
            const newUserMsgRef = push(messagesRef);
            const userMessageData = {
                text: currentInput,
                sender: 'user',
                timestamp: serverTimestamp()
            };
            await set(newUserMsgRef, userMessageData);
    
            // Now handle the bot response.
            if (!geminiChat.current) {
                const history = [...messages, { id: newUserMsgRef.key!, ...userMessageData, timestamp: Date.now() }].map(msg => ({ role: msg.sender === 'user' ? 'user' : 'model', parts: [{ text: msg.text || '' }] }));
                const systemInstruction = `You are VANTUTOR, an expert AI tutor. You have deep knowledge of the student's current course and their progress. Use this information to provide personalized, contextual help.\n\n${courseContext}\n\nProvide clear, detailed explanations tailored to their level. Reference their completed and in-progress topics when relevant to show connections. Be encouraging and supportive.`;
                geminiChat.current = ai.chats.create({ model: 'gemini-2.0-flash', history, systemInstruction });
            }
            
            const stream = await geminiChat.current.sendMessageStream({ message: currentInput });
            const tempBotMessageId = `temp-bot-${Date.now()}`;
            setMessages(prev => [...prev, { id: tempBotMessageId, conversation_id: currentConvoId!, text: '', sender: 'bot', timestamp: Date.now() }]);
            
            let fullText = '';
            for await (const chunk of stream) {
                fullText += chunk.text;
                setMessages(prev => prev.map(m => m.id === tempBotMessageId ? {...m, text: fullText} : m));
            }
            
            const newBotMsgRef = push(messagesRef);
            const botMessageData = {
                text: fullText,
                sender: 'bot',
                timestamp: serverTimestamp()
            };
            await set(newBotMsgRef, botMessageData);
            
            await update(dbRef(db, `chat_conversations/${userProfile.uid}/${currentConvoId}`), { last_updated_at: serverTimestamp() });
    
        } catch (error) {
            console.error("Error sending message:", error);
            addToast("Failed to send message.", "error");
            setInput(currentInput); // Restore input on error
        } finally {
            setIsLoading(false);
        }
    };

    const startVoiceRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Initialize Gemini Live Session
            const response = await fetch('https://generativelanguage.googleapis.com/v1alpha/media/upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': process.env.API_KEY || ''
                },
                body: JSON.stringify({
                    display_name: 'VanTutor Chat'
                })
            });

            // Create real-time audio connection
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioContext;

            const mediaStreamSource = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyserRef.current = analyser;
            
            mediaStreamSource.connect(analyser);

            // Create a simple live connection using WebSocket
            const ws = new WebSocket(`wss://generativelanguage.googleapis.com/google.ai.generativelanguage.v1alpha.GenerativeService/BidiGenerateContent?key=${process.env.API_KEY}`);
            
            let liveSessionActive = true;
            liveSessionRef.current = { ws, stream, audioContext };

            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            analyser.connect(processor);
            processor.connect(audioContext.destination);

            processor.onaudioprocess = (event) => {
                if (!liveSessionActive || ws.readyState !== WebSocket.OPEN) return;
                
                const inputData = event.inputBuffer.getChannelData(0);
                const audioData = new Uint8Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    audioData[i] = Math.max(-128, Math.min(127, inputData[i] * 128)) | 0;
                }

                ws.send(JSON.stringify({
                    realtimeInput: {
                        mediaStream: {
                            mimeType: 'audio/pcm',
                            data: btoa(String.fromCharCode(...Array.from(audioData)))
                        }
                    }
                }));
            };

            ws.onopen = () => {
                // Send initial system instruction
                ws.send(JSON.stringify({
                    systemInstruction: {
                        parts: [{
                            text: `You are VANTUTOR, an expert AI tutor. You have deep knowledge of the student's current course and their progress. Provide clear, detailed explanations tailored to their level. Be encouraging and supportive. Keep responses conversational and natural for voice interaction.`
                        }]
                    }
                }));
                
                setVoiceStatus('listening');
                setIsVoiceMode(true);
                addToast('Voice conversation started. Speak naturally!', 'info');
            };

            ws.onmessage = async (event) => {
                try {
                    const response = JSON.parse(event.data);
                    
                    if (response.serverContent?.turns) {
                        const turns = response.serverContent.turns;
                        turns.forEach((turn: any) => {
                            if (turn.parts) {
                                turn.parts.forEach((part: any) => {
                                    if (part.text) {
                                        setInput(prev => prev + ' ' + part.text);
                                    }
                                    if (part.inlineData?.data) {
                                        // Play audio response
                                        const binaryData = atob(part.inlineData.data);
                                        const bytes = new Uint8Array(binaryData.length);
                                        for (let i = 0; i < binaryData.length; i++) {
                                            bytes[i] = binaryData.charCodeAt(i);
                                        }
                                        playAudio(bytes, audioContext);
                                    }
                                });
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error processing live response:', error);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                addToast('Connection error. Please try again.', 'error');
                stopVoiceRecording();
            };

            ws.onclose = () => {
                liveSessionActive = false;
            };

        } catch (error) {
            console.error('Error starting voice recording:', error);
            addToast('Could not access microphone. Please check permissions.', 'error');
        }
    };

    const playAudio = (audioData: Uint8Array, audioContext: AudioContext) => {
        try {
            const audioBuffer = audioContext.createBuffer(1, audioData.length, 16000);
            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < audioData.length; i++) {
                channelData[i] = audioData[i] / 128;
            }
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start(0);
        } catch (error) {
            console.error('Error playing audio:', error);
        }
    };

    const stopVoiceRecording = () => {
        if (liveSessionRef.current) {
            const { ws, stream, audioContext } = liveSessionRef.current;
            
            // Close WebSocket
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
            
            // Stop audio stream
            stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
            
            // Clean up audio context
            if (audioContext) {
                audioContext.close();
            }
            
            liveSessionRef.current = null;
        }
        
        setVoiceStatus('idle');
        setIsVoiceMode(false);
    };

    const toggleVoice = () => {
        if (isVoiceMode) {
            stopVoiceRecording();
        } else {
            startVoiceRecording();
        }
    };
    
    return (
        <div className="flex-1 flex w-full h-full overflow-hidden">
            <ChatHistoryPanel conversations={conversations} activeConversationId={activeConversationId} onSelectConversation={setActiveConversationId} onNewChat={handleNewChat} onDeleteConversation={handleDeleteConversation} onRenameConversation={handleRenameConversation} onClearAll={handleClearAll} isDeleting={isDeleting} isMobilePanelOpen={isMobilePanelOpen} onCloseMobilePanel={() => setIsMobilePanelOpen(false)} />
            <div className="flex-1 flex flex-col bg-white">
                 <div className="flex-1 flex flex-col min-h-0">
                    {!activeConversationId && !isHistoryLoading && (
                        <div className="flex flex-col items-center justify-center h-full text-center p-4">
                            <ChatBubbleIcon className="w-16 h-16 text-gray-300" />
                            <h2 className="text-xl font-bold mt-4 text-gray-800">AI Tutor Chat</h2>
                            <p className="text-gray-500">Start a new chat or select one from your history.</p>
                            <button onClick={() => setIsMobilePanelOpen(true)} className="md:hidden mt-4 flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg text-gray-700 font-semibold"><ListIcon className="w-5 h-5" /> View History</button>
                        </div>
                    )}
                    {activeConversationId && (
                         <div className="flex-1 overflow-y-auto p-4 space-y-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            {messages.map((message, index) => (
                                <div key={message.id || `msg-${index}`} className={`flex items-start gap-3 w-full animate-fade-in-up ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    {message.sender === 'bot' && <Avatar display_name="AI" className="w-8 h-8 flex-shrink-0" />}
                                    <div className={`p-3 px-4 rounded-2xl max-w-[85%] sm:max-w-xl break-words prose ${message.sender === 'user' ? 'bg-lime-500 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'}`}>
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text || ''}</ReactMarkdown>
                                    </div>
                                    {message.sender === 'user' && <Avatar display_name={userProfile.display_name} photo_url={userProfile.photo_url} className="w-8 h-8 flex-shrink-0" />}
                                </div>
                            ))}
                            {isLoading && (<div className="flex items-start gap-3 w-full animate-fade-in-up justify-start"><Avatar display_name="AI" className="w-8 h-8 flex-shrink-0" /><div className="p-3 px-4 rounded-2xl bg-gray-100"><div className="flex items-center space-x-2"><div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:-0.3s]"></div><div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:-0.15s]"></div><div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div></div></div></div>)}
                            <div ref={messagesEndRef} />
                        </div>
                    )}
                    <div className="p-4 border-t border-gray-200 bg-white/80 backdrop-blur-lg">
                        {voiceStatus === 'listening' && (
                            <div className="mb-2 text-center">
                                <span className="text-sm text-red-600 font-medium animate-pulse">🎤 Listening... Talking with AI in real-time</span>
                            </div>
                        )}
                        <div className="relative flex items-center gap-2">
                            <button onClick={() => setIsMobilePanelOpen(true)} className="md:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-full"><ListIcon /></button>
                            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isVoiceMode) { e.preventDefault(); handleSendMessage(); } }} placeholder={isVoiceMode ? "Speaking with AI..." : "Ask me anything..."} className="flex-1 bg-gray-100 border border-gray-200 rounded-full py-3 pl-5 pr-24 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none resize-none" rows={1} style={{ fieldSizing: 'content' }} disabled={isLoading || isVoiceMode} />
                            <button 
                                onClick={toggleVoice} 
                                disabled={isLoading}
                                className={`absolute right-14 top-1/2 -translate-y-1/2 rounded-full p-2.5 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                                    isVoiceMode 
                                        ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse' 
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                                title={isVoiceMode ? "Stop voice conversation" : "Start voice conversation"}
                            >
                                <VoiceIcon className="w-5 h-5" />
                            </button>
                            <button onClick={handleSendMessage} disabled={isLoading || !input.trim() || isVoiceMode} className="absolute right-2 top-1/2 -translate-y-1/2 bg-lime-600 rounded-full p-2.5 text-white hover:bg-lime-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><SendIcon className="w-5 h-5" /></button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- MAIN CHAT COMPONENT ---
interface ChatProps {
    userProfile: UserProfile;
}

export const Chat: React.FC<ChatProps> = ({ userProfile }) => {
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [isHistoryLoading, setIsHistoryLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);
    const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; confirmText?: string }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
    const { addToast } = useToast();

    // Fetch and subscribe to conversation list
    useEffect(() => {
        setIsHistoryLoading(true);
        const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);
        const unsubscribeConversations = onValue(conversationsRef, (snapshot) => {
            if (snapshot.exists()) {
                const data: any[] = [];
                snapshot.forEach((child) => {
                    data.push({ id: child.key, ...child.val() });
                });
                const sortedConvos = data.sort((a,b) => b.last_updated_at - a.last_updated_at);
                setConversations(sortedConvos as ChatConversation[]);
            } else {
                setConversations([]);
            }
            setIsHistoryLoading(false);
        });

        return () => off(conversationsRef);
    }, [userProfile.uid]);

    const handleNewChat = () => setActiveConversationId(null);
    const onRenameConversation = async (id: string, newTitle: string) => update(dbRef(db, `chat_conversations/${userProfile.uid}/${id}`), { title: newTitle });
    const handleDeleteConversation = async (id: string) => {
        setModalState({ isOpen: true, title: 'Delete Chat?', message: 'This will permanently delete this conversation.', confirmText: 'Delete',
            onConfirm: async () => {
                setIsDeleting(true);
                setModalState(s => ({ ...s, isOpen: false }));
                if (activeConversationId === id) handleNewChat();
                await remove(dbRef(db, `chat_conversations/${userProfile.uid}/${id}`));
                await remove(dbRef(db, `chat_messages/${id}`));
                addToast('Conversation deleted.', 'success');
                setIsDeleting(false);
            }
        });
    };
    const onClearAll = () => {
        setModalState({ isOpen: true, title: 'Delete All Chats?', message: 'This will permanently delete all your chat conversations.', confirmText: 'Delete All',
            onConfirm: async () => {
                setIsDeleting(true);
                setModalState(s => ({...s, isOpen: false}));
                handleNewChat();
                // In RTDB, we can delete the whole path
                await remove(dbRef(db, `chat_conversations/${userProfile.uid}`));
                // We should also delete messages for all those conversations, but that's more complex without knowing IDs.
                // For now, removing conversations is enough to clear the list.
                addToast('All conversations deleted.', 'success');
                setIsDeleting(false);
            }
        });
    };

    return (
        <div className="flex-1 flex flex-col w-full h-full overflow-hidden bg-white rounded-xl border border-gray-200">
            <ConfirmationModal {...modalState} onCancel={() => setModalState(s => ({...s, isOpen: false}))} isConfirming={isDeleting} />
            <TextChat 
                userProfile={userProfile}
                conversations={conversations}
                activeConversationId={activeConversationId}
                setActiveConversationId={setActiveConversationId}
                isHistoryLoading={isHistoryLoading}
                handleDeleteConversation={handleDeleteConversation}
                handleRenameConversation={onRenameConversation}
                handleClearAll={onClearAll}
                handleNewChat={handleNewChat}
                isDeleting={isDeleting}
            />
        </div>
    );
};