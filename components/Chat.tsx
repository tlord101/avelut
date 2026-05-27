import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { db } from '../firebase';
import { ref as dbRef, onValue, off, set, push, get, remove, serverTimestamp, update } from 'firebase/database';
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
import { SparklesIcon } from './icons/SparklesIcon';
import { ChevronDownIcon } from './icons/ChevronDownIcon';
import { PlusIcon } from './icons/PlusIcon';
import { GraduationCapIcon } from './icons/GraduationCapIcon';

// @ts-ignore
const ai = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;

const timeAgo = (timestamp: number): string => {
    const now = Date.now();
    const seconds = Math.floor((now - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

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
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchCourseContext = async () => {
            try {
                // Fetch student progress
                const progressRef = dbRef(db, `user_progress/${userProfile.uid}`);
                const progressSnap = await get(progressRef);
                let contextText = `STUDENT LEVEL: ${userProfile.level}\nDEPARTMENT: ${userProfile.department_id}\n\n`;
                
                if (progressSnap.exists()) {
                    contextText += 'STUDENT PROGRESS DATA (Topics Mastered):\n';
                    const progressData = progressSnap.val();
                    Object.keys(progressData).forEach(courseId => {
                        const courses = progressData[courseId];
                        contextText += `- ${courseId}: ${Object.keys(courses).filter(k => courses[k].status === 'completed').join(', ')}\n`;
                    });
                }

                // Fetch textbook contexts for grounding
                const textbooksRef = dbRef(db, `textbook_contexts/${userProfile.department_id}`);
                const textbookSnap = await get(textbooksRef);
                let textbookDataText = '';
                if (textbookSnap.exists()) {
                    textbookDataText = '\n\nTEXTBOOK KNOWLEDGE BASE:\nThe following structured knowledge from uploaded textbooks is available. Ground your answers in this material where applicable:\n';
                    const textbooks = textbookSnap.val();
                    Object.keys(textbooks).forEach(subj => {
                        textbookDataText += `Course: ${subj}\nSyllabus: ${JSON.stringify(textbooks[subj].syllabus)}\n\n`;
                    });
                }
                
                setCourseContext(contextText + textbookDataText);
            } catch (error) {
                console.error('Error fetching course context:', error);
            }
        };
        
        fetchCourseContext();
    }, [userProfile.uid, userProfile.department_id, userProfile.level]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    useEffect(() => {
        if (!activeConversationId) {
            setMessages([]);
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
            } else {
                setMessages([]);
            }
        });

        return () => off(messagesRef);
    }, [activeConversationId]);

    const handleSendMessage = async (customInput?: string) => {
        const messageToSend = customInput || input;
        if (!messageToSend.trim() || isLoading) return;
        
        const currentInput = messageToSend;
        setInput('');
        setIsLoading(true);
    
        try {
            let currentConvoId = activeConversationId;
    
            if (!currentConvoId) {
                const now = Date.now();
                const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);
                const newConvoRef = push(conversationsRef);
                await set(newConvoRef, {
                    title: 'New Chat',
                    created_at: now,
                    last_updated_at: now
                });
                currentConvoId = newConvoRef.key!;
                setActiveConversationId(currentConvoId);
            }
            
            const messagesRef = dbRef(db, `chat_messages/${currentConvoId}`);
            await push(messagesRef, {
                text: currentInput,
                sender: 'user',
                timestamp: serverTimestamp()
            });

            update(dbRef(db, `chat_conversations/${userProfile.uid}/${currentConvoId}`), { last_updated_at: Date.now() });

            // Call Gemini
            const result = await ai.models.generateContent({
                model: "gemini-3.5-flash",
                contents: [{ role: 'user', parts: [{ text: currentInput }] }]
            });
            const responseText = result.text || '';

            await push(messagesRef, {
                text: responseText,
                sender: 'ai',
                timestamp: serverTimestamp()
            });

        } catch (error) {
            console.error('Error in chat:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const toggleVoice = () => {
        setIsVoiceMode(!isVoiceMode);
        if (!isVoiceMode) {
            setVoiceStatus('listening');
            setTimeout(() => {
                setVoiceStatus('idle');
                setIsVoiceMode(false);
            }, 3000);
        } else {
            setVoiceStatus('idle');
        }
    };

    return (
        <div className="flex-1 flex w-full h-full overflow-hidden bg-white">
            <div className="flex w-full">
                {/* Desktop History Sidebar */}
                <div className="hidden md:flex w-[320px] flex-col border-r border-gray-100">
                    <ChatHistoryPanel 
                        conversations={conversations}
                        activeConversationId={activeConversationId}
                        setActiveConversationId={setActiveConversationId}
                        isHistoryLoading={isHistoryLoading}
                        handleDeleteConversation={handleDeleteConversation}
                        handleRenameConversation={handleRenameConversation}
                        handleClearAll={handleClearAll}
                        handleNewChat={handleNewChat}
                        isDeleting={isDeleting}
                        userProfile={userProfile}
                        onCloseMobilePanel={() => {}}
                        isMobilePanelOpen={false}
                        onSelectConversation={(id) => setActiveConversationId(id)}
                    />
                </div>

                {/* Main Chat View */}
                <div className="flex-1 flex flex-col h-full bg-white relative animate-in fade-in duration-500 overflow-hidden pb-20 md:pb-0">
                    {/* Top Navigation Bar */}
                    <div className="flex items-center justify-between px-4 md:px-6 py-4 bg-white border-b border-gray-100 h-[60px] sticky top-0 z-20 shrink-0">
                        <button 
                            onClick={() => setIsMobilePanelOpen(true)}
                            className="p-2 text-charcoal md:hidden"
                        >
                            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M4 8h16M4 16h16" />
                            </svg>
                        </button>
                        
                        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">
                            <span className="text-lg font-semibold text-charcoal uppercase tracking-tighter">Ask</span>
                            <div className="w-[15px] h-[2px] bg-emerald rounded-full mt-0.5" />
                        </div>

                        <div className="flex items-center">
                            <button className="p-2 text-charcoal opacity-60">
                                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08s5.97 1.09 6 3.08c-1.29 1.94-3.5 3.22-6 3.22z" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {!activeConversationId && messages.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">
                            {/* Watermark Logo - Stylized 'O' with orbit ring */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.05]">
                                <div className="relative w-64 h-64 md:w-96 md:h-96">
                                    <div className="absolute inset-0 border-[8px] md:border-[12px] border-charcoal rounded-full"></div>
                                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[110%] h-[20%] border-[8px] md:border-[12px] border-charcoal rounded-[100%] rotate-[-35deg]"></div>
                                </div>
                            </div>
                            
                            <div className="mt-auto w-full max-w-2xl px-4 space-y-6">
                                {/* Horizontal Scrollable Action Pills */}
                                <div className="flex gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-2">
                                    <button onClick={() => handleSendMessage("Explain my current syllabus")} className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-off-white border border-gray-100 rounded-full text-sm font-medium text-charcoal hover:bg-gray-100 transition-all">
                                        <GraduationCapIcon className="w-4 h-4 text-emerald" />
                                        <span>Explain syllabus</span>
                                    </button>
                                    <button onClick={() => handleSendMessage("Solve a complex problem")} className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-off-white border border-gray-100 rounded-full text-sm font-medium text-charcoal hover:bg-gray-100 transition-all">
                                        <SparklesIcon className="w-4 h-4 text-emerald" />
                                        <span>Solve problem</span>
                                    </button>
                                    <button onClick={() => toggleVoice()} className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-off-white border border-gray-100 rounded-full text-sm font-medium text-charcoal hover:bg-gray-100 transition-all">
                                        <VoiceIcon className="w-4 h-4 text-emerald" />
                                        <span>Voice tutorial</span>
                                    </button>
                                    <button onClick={() => handleSendMessage("Help me study")} className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 bg-off-white border border-gray-100 rounded-full text-sm font-medium text-charcoal hover:bg-gray-100 transition-all">
                                        <PlusIcon className="w-4 h-4 text-emerald" />
                                        <span>Study tips</span>
                                    </button>
                                </div>

                                {/* Main Input Container */}
                                <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200">
                                    <textarea
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage();
                                            }
                                        }}
                                        placeholder="Ask anything"
                                        className="w-full bg-transparent border-none focus:ring-0 text-charcoal placeholder-gray-500 resize-none min-h-[40px] text-base"
                                        rows={1}
                                    />
                                    <div className="flex items-center justify-between mt-4">
                                        <button className="p-2 bg-gray-200 rounded-full text-charcoal hover:bg-gray-300 transition-colors">
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                                        </button>
                                        <div className="flex items-center gap-3">
                                            <button 
                                                onClick={toggleVoice}
                                                className={`p-2 text-charcoal hover:text-emerald transition-colors ${voiceStatus !== 'idle' ? 'text-emerald animate-pulse' : ''}`}
                                            >
                                                <VoiceIcon className="w-6 h-6" />
                                            </button>
                                            <button 
                                                onClick={() => handleSendMessage()}
                                                disabled={!input.trim() || isLoading}
                                                className="flex items-center gap-2 px-6 py-2.5 bg-emerald hover:bg-emerald-hover text-white rounded-full font-bold transition-all disabled:opacity-50"
                                            >
                                                <SendIcon className="w-4 h-4 fill-current" />
                                                <span>Send</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0 bg-white">
                            <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8 scroll-smooth">
                                {messages.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                                        <div className={`max-w-[85%] flex gap-4 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                            <div className="flex-shrink-0">
                                                <Avatar user={msg.sender === 'user' ? userProfile : { display_name: 'VanTutor', isAdmin: true }} size="sm" isAI={msg.sender === 'ai'} />
                                            </div>
                                            <div className={`mt-1 ${msg.sender === 'user' ? 'text-right' : 'text-left'}`}>
                                                <div className="flex items-center gap-2 mb-1.5 px-1 justify-inherit">
                                                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">{msg.sender === 'user' ? 'You' : 'Vantutor'}</span>
                                                    <span className="text-[10px] text-gray-400">{timeAgo(msg.timestamp)}</span>
                                                </div>
                                                <div className={`rounded-2xl px-5 py-3 text-[15px] leading-relaxed shadow-sm ${
                                                    msg.sender === 'user' 
                                                    ? 'bg-off-white text-charcoal border border-gray-100 rounded-tr-none' 
                                                    : 'text-charcoal bg-white border border-gray-100 rounded-tl-none'
                                                }`}>
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {isLoading && (
                                    <div className="flex justify-start animate-pulse">
                                        <div className="flex gap-4">
                                            <div className="w-8 h-8 rounded-full bg-off-white border border-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-400">VT</div>
                                            <div className="mt-4 flex gap-1.5">
                                                <div className="w-1.5 h-1.5 bg-emerald/40 rounded-full animate-bounce"></div>
                                                <div className="w-1.5 h-1.5 bg-emerald/40 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                                <div className="w-1.5 h-1.5 bg-emerald/40 rounded-full animate-bounce [animation-delay:-0.5s]"></div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} className="h-4" />
                            </div>

                            {/* Chat Input Fix for active state */}
                            <div className="px-6 py-4 border-t border-gray-100 bg-white">
                                <div className="p-3 bg-off-white rounded-3xl border border-gray-100 flex items-center gap-3">
                                    <button className="p-2 text-charcoal hover:text-emerald transition-colors">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                    </button>
                                    <input
                                        type="text"
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                        placeholder="Type a message..."
                                        className="flex-1 bg-transparent border-none focus:ring-0 text-charcoal placeholder-gray-500 py-2"
                                    />
                                    <button 
                                        onClick={() => handleSendMessage()}
                                        disabled={!input.trim() || isLoading}
                                        className="p-2.5 bg-emerald text-white rounded-full hover:bg-emerald-hover transition-colors disabled:opacity-50"
                                    >
                                        <SendIcon className="w-4 h-4 fill-current" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Mobile History Drawer (Controlled by Chat component state) */}
                    <div className={`fixed inset-0 z-50 transform transition-transform duration-300 ease-in-out md:hidden ${isMobilePanelOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                        <div className="absolute inset-0 bg-charcoal/40" onClick={() => setIsMobilePanelOpen(false)}></div>
                        <div className="relative w-[320px] h-full shadow-lg">
                            <ChatHistoryPanel 
                                conversations={conversations}
                                activeConversationId={activeConversationId}
                                setActiveConversationId={(id) => {
                                    setActiveConversationId(id);
                                    setIsMobilePanelOpen(false);
                                }}
                                isHistoryLoading={isHistoryLoading}
                                handleDeleteConversation={handleDeleteConversation}
                                handleRenameConversation={handleRenameConversation}
                                handleClearAll={handleClearAll}
                                handleNewChat={() => {
                                    handleNewChat();
                                    setIsMobilePanelOpen(false);
                                }}
                                isDeleting={isDeleting}
                                isMobilePanelOpen={true}
                                onCloseMobilePanel={() => setIsMobilePanelOpen(false)}
                                userProfile={userProfile}
                                onSelectConversation={(id) => {
                                    setActiveConversationId(id);
                                    setIsMobilePanelOpen(false);
                                }}
                            />
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
                await remove(dbRef(db, `chat_conversations/${userProfile.uid}`));
                addToast('All conversations deleted.', 'success');
                setIsDeleting(false);
            }
        });
    };

    return (
        <div className="flex-1 flex flex-col w-full h-full overflow-hidden bg-white">
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