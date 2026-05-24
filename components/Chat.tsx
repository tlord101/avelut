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
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
            const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(currentInput);
            const responseText = result.response.text();

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
        <div className="flex-1 flex w-full h-full overflow-hidden bg-[#0A0A0A]">
            <div className="flex w-full">
                {/* Desktop History Sidebar */}
                <div className="hidden lg:flex w-[280px] flex-col border-r border-[#1F1F1F]">
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
                    />
                </div>

                {/* Main Chat View */}
                <div className="flex-1 flex flex-col h-full bg-[#0A0A0A] relative animate-in fade-in duration-500">
                    {/* Top Navigation Bar */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-[#1F1F1F]">
                        <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded-full border border-white/5">
                            <button className="px-5 py-1.5 rounded-full bg-white text-black text-[11px] font-black uppercase tracking-wider">Ask</button>
                            <button className="px-5 py-1.5 rounded-full text-gray-500 hover:text-white text-[11px] font-black uppercase tracking-wider">Imagine</button>
                        </div>
                        <div className="flex items-center gap-4">
                            <button className="p-2 text-gray-500 hover:text-white transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                            </button>
                        </div>
                    </div>

                    {!activeConversationId && messages.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-8">
                            <div className="mb-12 relative">
                                <div className="absolute inset-0 bg-blue-500/20 blur-[100px] rounded-full"></div>
                                <div className="relative w-24 h-24 flex items-center justify-center bg-transparent">
                                    <div className="w-16 h-16 border-[3px] border-white rounded-full flex items-center justify-center animate-pulse">
                                        <div className="w-8 h-8 bg-white rotate-45"></div>
                                    </div>
                                </div>
                            </div>
                            
                            <h2 className="text-3xl font-black text-white mb-10 tracking-tight text-center">What can I help you learn today?</h2>
                            
                            <div className="w-full max-w-2xl grid grid-cols-3 gap-3">
                                <button onClick={() => handleSendMessage("Explain my current syllabus")} className="group p-4 bg-white/5 border border-white/5 hover:border-white/20 rounded-[2rem] text-center transition-all hover:bg-white/10">
                                    <div className="w-10 h-10 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-3 text-blue-400 group-hover:scale-110 transition-transform">
                                        <GraduationCapIcon className="w-5 h-5" />
                                    </div>
                                    <span className="text-[11px] font-black uppercase text-gray-400 tracking-widest group-hover:text-white transition-colors">Course Overview</span>
                                </button>
                                <button onClick={() => handleSendMessage("Solve a complex problem")} className="group p-4 bg-white/5 border border-white/5 hover:border-white/20 rounded-[2rem] text-center transition-all hover:bg-white/10">
                                    <div className="w-10 h-10 bg-purple-500/10 rounded-full flex items-center justify-center mx-auto mb-3 text-purple-400 group-hover:scale-110 transition-transform">
                                        <SparklesIcon className="w-5 h-5" />
                                    </div>
                                    <span className="text-[11px] font-black uppercase text-gray-400 tracking-widest group-hover:text-white transition-colors">AI Problem Solver</span>
                                </button>
                                <button onClick={() => toggleVoice()} className="group p-4 bg-white/5 border border-white/5 hover:border-white/20 rounded-[2rem] text-center transition-all hover:bg-white/10">
                                    <div className="w-10 h-10 bg-lime-500/10 rounded-full flex items-center justify-center mx-auto mb-3 text-lime-400 group-hover:scale-110 transition-transform">
                                        <VoiceIcon className="w-5 h-5" />
                                    </div>
                                    <span className="text-[11px] font-black uppercase text-gray-400 tracking-widest group-hover:text-white transition-colors">Voice Learning</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8 scroll-smooth">
                            {messages.map((msg, i) => (
                                <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                                    <div className={`max-w-[85%] flex gap-4 ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                        <Avatar user={msg.sender === 'user' ? userProfile : { first_name: 'Van', last_name: 'Tutor', isAdmin: true }} size="sm" isAI={msg.sender === 'ai'} />
                                        <div className={`mt-2 ${msg.sender === 'user' ? 'text-right' : 'text-left'}`}>
                                            <div className="flex items-center gap-2 mb-1.5 px-1 justify-inherit">
                                                <span className="text-[11px] font-black text-white/50 uppercase tracking-widest">{msg.sender === 'user' ? 'You' : 'Vantutor'}</span>
                                                <span className="text-[10px] text-white/20 font-bold">{timeAgo(msg.timestamp)}</span>
                                            </div>
                                            <div className={`rounded-3xl px-6 py-4 text-[15px] leading-relaxed transition-all shadow-lg ${
                                                msg.sender === 'user' 
                                                ? 'bg-[#1F1F1F] text-white rounded-tr-none shadow-white/5' 
                                                : 'text-gray-200 bg-transparent rounded-tl-none border border-[#1F1F1F]'
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
                                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white">VT</div>
                                        <div className="mt-4 flex gap-1.5">
                                            <div className="w-1.5 h-1.5 bg-white/20 rounded-full animate-bounce"></div>
                                            <div className="w-1.5 h-1.5 bg-white/20 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                            <div className="w-1.5 h-1.5 bg-white/20 rounded-full animate-bounce [animation-delay:-0.5s]"></div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} className="h-4" />
                        </div>
                    )}

                    {/* Chat Input Area */}
                    <div className="p-6">
                        <div className="max-w-4xl mx-auto space-y-4">
                            <div className="p-4 bg-[#141414] rounded-[3rem] border border-[#1F1F1F] shadow-2xl ring-1 ring-white/5">
                                <div className="flex items-center gap-3">
                                    <button className="p-3 text-gray-500 hover:text-white transition-colors bg-white/5 rounded-full border border-white/5">
                                        <PlusIcon className="w-5 h-5" />
                                    </button>
                                    
                                    <div className="flex-1 flex items-center bg-transparent px-2">
                                        <textarea
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleSendMessage(input);
                                                }
                                            }}
                                            placeholder="Ask anything"
                                            className="flex-1 bg-transparent border-none focus:ring-0 text-gray-100 placeholder:text-gray-600 text-[15px] font-medium py-3 resize-none h-[48px] box-content"
                                        />

                                        <div className="flex items-center gap-2">
                                            <button className="flex items-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 rounded-full border border-white/5 text-[10px] font-black text-gray-300 uppercase tracking-widest transition-all">
                                                <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                </svg>
                                                Fast
                                                <ChevronDownIcon className="w-3 h-3 text-gray-500" />
                                            </button>

                                            <button onClick={toggleVoice} className={`p-3 rounded-full transition-all ${isVoiceMode ? 'bg-red-500/10 text-red-500' : 'text-gray-500 hover:text-white bg-white/5 hover:bg-white/10'}`}>
                                                <VoiceIcon className="w-6 h-6" />
                                            </button>

                                            <button onClick={() => handleSendMessage(input)} disabled={isLoading || (!input.trim() && !isVoiceMode)} className="flex items-center gap-2 px-8 py-3 bg-white text-[#0A0A0A] rounded-full font-black text-[13px] uppercase tracking-wider hover:bg-gray-200 active:scale-95 disabled:opacity-50 transition-all">
                                                {isLoading ? (
                                                    <div className="w-4 h-4 border-2 border-black/10 border-t-black rounded-full animate-spin" />
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                                                        </svg>
                                                        Speak
                                                    </div>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <p className="text-center text-[9px] font-bold text-gray-700 uppercase tracking-[0.2em]">
                                VANTUTOR can make mistakes. Verify important info.
                            </p>
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
        <div className="flex-1 flex flex-col w-full h-full overflow-hidden bg-[#0A0A0A]">
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