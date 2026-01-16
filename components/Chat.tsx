import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Chat as GeminiChat } from '@google/genai';
import { supabase } from '../supabase';
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

    // Fetch course and topic context
    useEffect(() => {
        const fetchCourseContext = async () => {
            try {
                const { data: courseData, error: courseError } = await supabase
                    .from('courses_data')
                    .select('subject_list')
                    .eq('id', userProfile.course_id)
                    .single();
                
                if (courseError) throw courseError;
                
                const { data: progressData, error: progressError } = await supabase
                    .from('user_progress')
                    .select('topic_id, is_complete')
                    .eq('user_id', userProfile.uid);
                
                if (progressError) throw progressError;
                
                const completedTopics = progressData?.filter(p => p.is_complete).map(p => p.topic_id) || [];
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

        const fetchMessages = async () => {
            const { data, error } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('conversation_id', activeConversationId)
                .order('timestamp', { ascending: true });
            
            if (error) {
                addToast('Could not load messages.', 'error');
            } else {
                setMessages(data as Message[]);
                const history = data.map(msg => ({
                    role: msg.sender === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text || '' }]
                }));
                
                const systemInstruction = `You are VANTUTOR, an expert AI tutor. You have deep knowledge of the student's current course and their progress. Use this information to provide personalized, contextual help.\n\n${courseContext}\n\nProvide clear, detailed explanations tailored to their level. Reference their completed and in-progress topics when relevant to show connections. Be encouraging and supportive.`;
                
                geminiChat.current = ai.chats.create({ 
                    model: 'gemini-2.5-flash', 
                    history,
                    systemInstruction 
                });
            }
        };
        fetchMessages();

        const channel = supabase
            .channel(`public:chat_messages:conversation_id=eq.${activeConversationId}`)
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${activeConversationId}`},
                (payload) => {
                    setMessages(prev => {
                        if (prev.some(m => m.id === payload.new.id)) return prev;
                        return [...prev, payload.new as Message]
                    });
                }
            ).subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [activeConversationId, addToast, courseContext]);

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
                const { data: convoData, error: convoError } = await supabase.from('chat_conversations').insert({ user_id: userProfile.uid, title: 'New Chat', created_at: now, last_updated_at: now }).select().single();
                if (convoError || !convoData) throw convoError;
                currentConvoId = (convoData as ChatConversation).id;
                setActiveConversationId(currentConvoId); // This will setup subscription and fetch (0 messages)
                
                // Don't wait for title generation
                ai.models.generateContent({ model: 'gemini-2.5-flash', contents: `Generate a very short, concise title (4 words max) for the following user query: "${currentInput}"` })
                    .then(titleResult => supabase.from('chat_conversations').update({ title: titleResult.text.replace(/"/g, '') }).eq('id', currentConvoId!).then());
            }
            
            // Insert user message and get it back with its real ID.
            const { data: userMessage, error: insertError } = await supabase.from('chat_messages')
                .insert({ conversation_id: currentConvoId, text: currentInput, sender: 'user' })
                .select()
                .single();
    
            if (insertError) throw insertError;
            
            // Update state with the real message. The subscription will ignore it because the ID will match.
            setMessages(prev => [...prev, userMessage as Message]);
    
            // Now handle the bot response.
            if (!geminiChat.current) {
                const history = [...messages, userMessage as Message].map(msg => ({ role: msg.sender === 'user' ? 'user' : 'model', parts: [{ text: msg.text || '' }] }));
                const systemInstruction = `You are VANTUTOR, an expert AI tutor. You have deep knowledge of the student's current course and their progress. Use this information to provide personalized, contextual help.\n\n${courseContext}\n\nProvide clear, detailed explanations tailored to their level. Reference their completed and in-progress topics when relevant to show connections. Be encouraging and supportive.`;
                geminiChat.current = ai.chats.create({ model: 'gemini-2.5-flash', history, systemInstruction });
            }
            
            const stream = await geminiChat.current.sendMessageStream({ message: currentInput });
            const tempBotMessageId = `temp-bot-${Date.now()}`;
            setMessages(prev => [...prev, { id: tempBotMessageId, conversation_id: currentConvoId!, text: '', sender: 'bot', timestamp: Date.now() }]);
            
            let fullText = '';
            for await (const chunk of stream) {
                fullText += chunk.text;
                setMessages(prev => prev.map(m => m.id === tempBotMessageId ? {...m, text: fullText} : m));
            }
            
            const { data: botMessage, error: botInsertError } = await supabase.from('chat_messages').insert({ conversation_id: currentConvoId, text: fullText, sender: 'bot' }).select().single();
            if (botInsertError) throw botInsertError;
    
            // Replace temp bot message with the real one.
            setMessages(prev => prev.map(m => m.id === tempBotMessageId ? (botMessage as Message) : m));
            
            await supabase.from('chat_conversations').update({ last_updated_at: Date.now() }).eq('id', currentConvoId);
    
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
            const mediaRecorder = new MediaRecorder(stream);
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());
                await transcribeAudio(audioBlob);
            };

            mediaRecorder.start();
            setVoiceStatus('listening');
            setIsVoiceMode(true);
        } catch (error) {
            console.error('Error starting voice recording:', error);
            addToast('Could not access microphone. Please check permissions.', 'error');
        }
    };

    const stopVoiceRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            setVoiceStatus('processing');
        }
    };

    const transcribeAudio = async (audioBlob: Blob) => {
        try {
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = async () => {
                const base64Audio = (reader.result as string).split(',')[1];
                
                const result = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [{
                        parts: [
                            { text: 'Transcribe this audio accurately:' },
                            { inlineData: { mimeType: 'audio/webm', data: base64Audio } }
                        ]
                    }]
                });

                const transcribedText = result.text.trim();
                if (transcribedText) {
                    setInput(transcribedText);
                    addToast('Voice transcribed!', 'success');
                } else {
                    addToast('Could not transcribe audio. Please try again.', 'error');
                }
            };
        } catch (error) {
            console.error('Error transcribing audio:', error);
            addToast('Failed to transcribe audio.', 'error');
        } finally {
            setVoiceStatus('idle');
            setIsVoiceMode(false);
        }
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
                        {voiceStatus === 'processing' && (
                            <div className="mb-2 text-center">
                                <span className="text-sm text-gray-500">Processing voice...</span>
                            </div>
                        )}
                        <div className="relative flex items-center gap-2">
                            <button onClick={() => setIsMobilePanelOpen(true)} className="md:hidden p-2 text-gray-500 hover:bg-gray-100 rounded-full"><ListIcon /></button>
                            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} placeholder={isVoiceMode ? "Listening..." : "Ask me anything..."} className="flex-1 bg-gray-100 border border-gray-200 rounded-full py-3 pl-5 pr-24 text-gray-900 focus:ring-2 focus:ring-lime-500 focus:outline-none resize-none" rows={1} style={{ fieldSizing: 'content' }} disabled={isLoading || isVoiceMode} />
                            <button 
                                onClick={toggleVoice} 
                                disabled={isLoading || voiceStatus === 'processing'}
                                className={`absolute right-14 top-1/2 -translate-y-1/2 rounded-full p-2.5 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                                    isVoiceMode 
                                        ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse' 
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
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
        const fetchConversations = async () => {
            const { data, error } = await supabase.from('chat_conversations').select('*').eq('user_id', userProfile.uid).order('last_updated_at', { ascending: false });
            if (error) { addToast('Could not load chat history.', 'error'); console.error(error); } 
            else { setConversations(data as ChatConversation[]); }
            setIsHistoryLoading(false);
        };
        fetchConversations();
        const channel = supabase.channel(`public:chat_conversations:user_id=eq.${userProfile.uid}`).on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations', filter: `user_id=eq.${userProfile.uid}` },
                (payload) => {
                    const sortConvos = (convos: ChatConversation[]) => convos.sort((a,b) => b.last_updated_at - a.last_updated_at);
                    if (payload.eventType === 'INSERT') { setConversations(prev => sortConvos([payload.new as ChatConversation, ...prev])); }
                    else if (payload.eventType === 'UPDATE') { setConversations(prev => sortConvos(prev.map(c => c.id === payload.new.id ? payload.new as ChatConversation : c))); }
                    else if (payload.eventType === 'DELETE') { setConversations(prev => prev.filter(c => c.id !== (payload.old as any).id)); }
                }
        ).subscribe();
        return () => { supabase.removeChannel(channel); }
    }, [userProfile.uid, addToast]);

    const handleNewChat = () => setActiveConversationId(null);
    const onRenameConversation = async (id: string, newTitle: string) => await supabase.from('chat_conversations').update({ title: newTitle }).eq('id', id);
    const handleDeleteConversation = async (id: string) => {
        setModalState({ isOpen: true, title: 'Delete Chat?', message: 'This will permanently delete this conversation.', confirmText: 'Delete',
            onConfirm: async () => {
                setIsDeleting(true);
                setModalState(s => ({ ...s, isOpen: false }));
                if (activeConversationId === id) handleNewChat();
                await supabase.from('chat_conversations').delete().eq('id', id);
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
                await supabase.from('chat_conversations').delete().eq('user_id', userProfile.uid);
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