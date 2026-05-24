
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { db } from '../firebase';
import { ref as dbRef, onValue, off, set, update, get } from 'firebase/database';
import type { UserProfile, Message, Course, Topic, UserProgress } from '../types';
import { SendIcon } from './icons/SendIcon';
import { PaperclipIcon } from './icons/PaperclipIcon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { GraduationCapIcon } from './icons/GraduationCapIcon';
import { useToast } from '../hooks/useToast';
import { SparklesIcon } from './icons/SparklesIcon';
import { LockIcon } from './icons/LockIcon';

declare var __app_id: string;
// @ts-ignore
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- INLINE ICONS ---
const CheckCircleIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);
const ArrowLeftIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
    </svg>
);
const FileIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
);
const SearchIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
);
const CalculatorIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m-6 4h6m-6 4h6m2-8a2 2 0 012-2h2a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2h2a2 2 0 012 2v2" />
    </svg>
);
const BeakerIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547a2 2 0 00-.547 1.806l.443 2.387a6 6 0 004.126 3.86l.318.158a6 6 0 003.86.517l2.387.477a6 6 0 003.86-.517l.318-.158a6 6 0 004.126-3.86l.443-2.387a2 2 0 00-.547-1.806z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 10.25L12 3.5l-2.25 6.75" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 10.25h7.5" />
    </svg>
);
const BookIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v11.494m0 0a7.5 7.5 0 007.5-7.5H4.5a7.5 7.5 0 007.5 7.5z" />
    </svg>
);
const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);
const ChevronDownIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
);


const getSubjectVisuals = (subjectName: string) => {
    const lowerName = subjectName.toLowerCase();
    if (lowerName.includes('algebra') || lowerName.includes('math')) {
        return {
            Icon: CalculatorIcon,
            gradient: 'from-blue-100 to-indigo-100',
            borderColor: 'border-blue-500',
            textColor: 'text-blue-800',
            pathColor: 'bg-blue-300'
        };
    }
    if (lowerName.includes('biology') || lowerName.includes('science')) {
        return {
            Icon: BeakerIcon,
            gradient: 'from-purple-100 to-pink-100',
            borderColor: 'border-purple-500',
            textColor: 'text-purple-800',
            pathColor: 'bg-purple-300'
        };
    }
    return {
        Icon: BookIcon,
        gradient: 'from-yellow-100 to-orange-100',
        borderColor: 'border-yellow-500',
        textColor: 'text-yellow-800',
        pathColor: 'bg-yellow-300'
    };
};


// --- HELPER & MOCK DATA ---
const mockCourses = [
  { id: 'math_algebra_1', name: 'Math - Algebra 1' },
  { id: 'science_biology', name: 'Science - Biology' },
  { id: 'history_us', name: 'History - U.S. History' },
];
const getCourseNameById = (id: string) => mockCourses.find(c => c.id === id)?.name || 'your department';

const base64ToBlob = (base64: string, mimeType: string): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
};

// --- SKELETON LOADER ---
const StudyGuideSkeleton: React.FC = () => (
    <div className="w-full animate-pulse space-y-12 p-4">
        <div className="h-10 bg-gray-200 rounded-lg w-1/3 mx-auto"></div>
        <div className="flex justify-start"> <div className="w-24 h-24 bg-gray-300 rounded-full"></div> </div>
        <div className="flex justify-end"> <div className="w-24 h-24 bg-gray-300 rounded-full"></div> </div>
        <div className="flex justify-start"> <div className="w-24 h-24 bg-gray-300 rounded-full"></div> </div>
        <div className="h-10 bg-gray-200 rounded-lg w-1/3 mx-auto"></div>
        <div className="flex justify-end"> <div className="w-24 h-24 bg-gray-300 rounded-full"></div> </div>
    </div>
);

// --- LEARNING INTERFACE COMPONENT (UNCHANGED LOGIC, STYLED TO FIT) ---
interface LearningInterfaceProps {
    userProfile: UserProfile;
    topic: Topic & { courseName: string };
    isCompleted: boolean;
    onClose: () => void;
    onMarkComplete: (topicId: string) => Promise<void>;
}

const LearningInterface: React.FC<LearningInterfaceProps> = ({ userProfile, topic, isCompleted, onClose, onMarkComplete }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [fileData, setFileData] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isIllustrating, setIsIllustrating] = useState(false);
    const [textbookContext, setTextbookContext] = useState<string>('');
    const messagesEndRef = useRef<null | HTMLDivElement>(null);
    const { attemptApiCall } = useApiLimiter();
    const { addToast } = useToast();

    useEffect(() => {
        const fetchTextbook = async () => {
            const textbookRef = dbRef(db, `textbook_contexts/${userProfile.department_id}/${userProfile.level}/${topic.courseName}`);
            const snap = await get(textbookRef);
            if (snap.exists()) {
                const data = snap.val();
                setTextbookContext(`\n\nCOURSE TEXTBOOK CONTEXT:\nThis lesson must be strictly grounded in the following textbook syllabus and objectives:\n${JSON.stringify(data.syllabus)}`);
            }
        };
        fetchTextbook();
    }, [userProfile.department_id, userProfile.level, topic.courseName]);

    const systemInstruction = `You are VANTUTOR, an expert AI educator. Your primary goal is to provide a comprehensive and complete understanding of the given topic for a student at their specified level.

Your Method:
1. First, mentally outline all key concepts needed to fully master the topic.
2. Begin teaching, but do NOT present the entire outline at once.
3. Break the lesson into very small, bite-sized chunks. Each message you send must be short and focus on a single, simple idea.
4. After explaining a small concept, you MUST end your message with a simple question to check for understanding before proceeding. This is crucial.
5. NEVER deliver long lectures. Keep it interactive and conversational.

Use simple language, analogies, and Markdown for clarity. For mathematical formulas and symbols, use LaTeX syntax (e.g., $...$ for inline and $$...$$ for block). Be patient and encouraging.${textbookContext}`;

    const initiateAutoTeach = async () => {
        const prompt = `
Context:
Department: ${getCourseNameById(userProfile.department_id)}
Course: ${topic.courseName}
Topic: ${topic.topic_name}
User Level: ${userProfile.level}

Task:
Please start teaching me about "${topic.topic_name}". Give me a simple and clear introduction to the topic.
`;
        const result = await attemptApiCall(async () => {
            const model = ai.getGenerativeModel({ 
                model: 'gemini-3.5-flash',
                systemInstruction 
            });
            const response = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
            });
            const botResponseText = response.response.text();

            const messagesRef = dbRef(db, `study_guide_messages/${userProfile.uid}/${topic.topic_id}`);
            const newMsgRef = push(messagesRef);
            const msgData = {
                sender: 'bot',
                text: botResponseText,
                timestamp: serverTimestamp(),
            };
            await set(newMsgRef, msgData);

            const botMessage: Message = { 
                id: newMsgRef.key!, 
                text: botResponseText, 
                sender: 'bot', 
                timestamp: Date.now() 
            };
            setMessages([botMessage]);
        });

        if (!result.success) {
            addToast(result.message || 'Sorry, I had trouble starting the lesson.', 'error');
            onClose();
        }
    };

    useEffect(() => {
        const messagesRef = dbRef(db, `study_guide_messages/${userProfile.uid}/${topic.topic_id}`);
        
        setIsLoading(true);
        const unsubscribe = onValue(messagesRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                initiateAutoTeach();
            } else {
                const fetchedMessages: Message[] = Object.entries(data).map(([id, msg]: [string, any]) => ({
                    id,
                    text: msg.text,
                    sender: msg.sender as 'user' | 'bot',
                    timestamp: msg.timestamp,
                    image_url: msg.image_url,
                })).sort((a,b) => a.timestamp - b.timestamp);
                setMessages(fetchedMessages);
            }
            setIsLoading(false);
        }, (error) => {
            console.error("Error initializing lesson:", error);
            addToast("Could not start the lesson. Please try again.", "error");
            onClose();
            setIsLoading(false);
        });

        return () => off(messagesRef, 'value', unsubscribe);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userProfile.uid, topic.topic_id]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading, isIllustrating]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            const reader = new FileReader();
            reader.onloadend = () => setFileData(reader.result as string);
            reader.readAsDataURL(selectedFile);
        }
    };
    
    const handleSend = async (messageText?: string) => {
        const textToSend = messageText || input;
        if ((!textToSend.trim() && !file) || isLoading || isIllustrating) return;
        
        const tempInput = textToSend;
        const tempFile = file;
        const tempFileData = fileData;

        // Clear input immediately for better UX
        setInput('');
        setFile(null);
        setFileData(null);
        
        // Create optimistic user message with temporary ID
        const optimisticUserMessage: Message = {
            id: `temp-${Date.now()}`,
            text: tempInput || undefined,
            sender: 'user',
            timestamp: Date.now(),
            image_url: undefined,
        };
        
        // Show user message immediately
        setMessages(prev => [...prev, optimisticUserMessage]);
        setIsLoading(true);

        try {
            let imageUrl: string | undefined;

            if (tempFile) {
                const storageRefObj = storageRef(storage, `${userProfile.uid}/study-guide-uploads/${topic.topic_id}/${Date.now()}-${tempFile.name}`);
                const uploadResult = await uploadBytes(storageRefObj, tempFile);
                imageUrl = await getDownloadURL(uploadResult.ref);
            }

            // Save user message to DB
            const messagesRef = dbRef(db, `study_guide_messages/${userProfile.uid}/${topic.topic_id}`);
            const newUserMsgRef = push(messagesRef);
            const userMessageData = {
                sender: 'user',
                text: tempInput || '',
                image_url: imageUrl,
                timestamp: serverTimestamp(),
            };
            await set(newUserMsgRef, userMessageData);
            
            // Update the optimistic message with real data from database
            setMessages(prev => prev.map(m => 
                m.id === optimisticUserMessage.id
                    ? {
                        id: newUserMsgRef.key!,
                        text: tempInput || undefined,
                        sender: 'user' as const,
                        timestamp: Date.now(),
                        image_url: imageUrl,
                    }
                    : m
            ));
            
            // Get updated messages for API call
            const updatedMessages = [...messages, {
                id: newUserMsgRef.key!,
                text: tempInput || undefined,
                sender: 'user' as const,
                timestamp: Date.now(),
                image_url: imageUrl,
            }];

            const result = await attemptApiCall(async () => {
                const history = updatedMessages.map(m => `${m.sender === 'user' ? 'Student' : 'Tutor'}: ${m.text || ''}`).join('\n');
                
                const prompt = `
Context:
Course: ${getCourseNameById(userProfile.course_id)}
Subject: ${topic.subjectName}
Topic: ${topic.topic_name}
User Level: ${userProfile.level}

Conversation History:
${history}

Task:
Continue teaching this topic based on the student's latest message. If an image is provided, analyze it in your response.
Student: "${tempInput}"
`;
                const parts: any[] = [{ text: prompt }];
                if (tempFile && tempFileData) {
                    const base64Data = tempFileData.split(',')[1];
                    if (base64Data) {
                        parts.push({ inlineData: { data: base64Data, mimeType: tempFile.type } });
                    }
                }

                const model = ai.getGenerativeModel({ 
                    model: 'gemini-3.5-flash',
                    systemInstruction 
                });
                const response = await model.generateContent({ 
                    contents: { parts }
                });
                const botResponseText = response.response.text();
                
                const newBotMsgRef = push(messagesRef);
                const botMessageData = {
                    sender: 'bot',
                    text: botResponseText,
                    timestamp: serverTimestamp(),
                };
                await set(newBotMsgRef, botMessageData);

                const botMessage: Message = { 
                    id: newBotMsgRef.key!, 
                    text: botResponseText, 
                    sender: 'bot', 
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, botMessage]);
            });

            if (!result.success) {
                addToast(result.message, 'error');
            }
        } catch (err) {
            console.error('Error in chat:', err);
            addToast('Sorry, something went wrong. Please try again.', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateIllustration = async (promptText: string) => {
        if (!promptText) {
            addToast("Not enough context to create an image.", "info");
            return;
        }

        setIsIllustrating(true);
        addToast("Creating a visualization for you...", "info");

        const result = await attemptApiCall(async () => {
            const prompt = `Create a photorealistic and visually clear image that illustrates the following educational concept for a student. The image should be a helpful visual aid for learning. Crucially, the image must not contain any text, words, letters, numbers, or labels. Focus purely on the visual representation. Concept: "${promptText}"`;
            
            let response;
            const maxRetries = 2;
            for (let i = 0; i <= maxRetries; i++) {
                try {
                    const model = ai.getGenerativeModel({ model: 'gemini-3.5-flash' });
                    const result = await model.generateContent({
                        contents: {
                            parts: [{ text: prompt }],
                        },
                        generationConfig: {
                            responseModalities: [Modality.IMAGE, Modality.TEXT],
                        },
                    });
                    response = result.response;
                    
                    const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                    if (imagePart?.inlineData) {
                        break; 
                    } else {
                        if (i === maxRetries) {
                           throw new Error("API returned response without image data.");
                        }
                    }
                } catch (error) {
                    console.error(`Image generation attempt ${i + 1} failed:`, error);
                    if (i === maxRetries) {
                        throw error;
                    }
                    await new Promise(res => setTimeout(res, 1000 * (i + 1))); 
                }
            }

            if (!response) {
                throw new Error("API call failed to return a response after retries.");
            }
    
            const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (imagePart?.inlineData) {
                const base64ImageBytes = imagePart.inlineData.data;
                const mimeType = imagePart.inlineData.mimeType || 'image/png';
                const fileExtension = mimeType.split('/')[1] || 'png';

                const imageBlob = base64ToBlob(base64ImageBytes, mimeType);
                const storageRefObj = storageRef(storage, `${userProfile.uid}/study-guide-illustrations/${topic.topic_id}/${Date.now()}.${fileExtension}`);
                
                const uploadResult = await uploadBytes(storageRefObj, imageBlob);
                const publicUrl = await getDownloadURL(uploadResult.ref);
    
                const messagesRef = dbRef(db, `study_guide_messages/${userProfile.uid}/${topic.topic_id}`);
                const newBotMsgRef = push(messagesRef);
                const botMessageData = {
                    sender: 'bot',
                    text: 'Here is a visualization to help you understand:',
                    image_url: publicUrl,
                    timestamp: serverTimestamp(),
                };
                await set(newBotMsgRef, botMessageData);

                const botMessage: Message = {
                    id: newBotMsgRef.key!,
                    text: botMessageData.text,
                    sender: 'bot',
                    timestamp: Date.now(),
                    image_url: publicUrl
                };
                setMessages(prev => [...prev, botMessage]);
    
            } else {
                throw new Error("No image data received from the API.");
            }
        });

        if (!result.success) {
            addToast(result.message || "Failed to generate image after multiple attempts.", "error");
        }
        setIsIllustrating(false);
    };
    
    const lastBotMessageIndex = messages.map(m => m.sender).lastIndexOf('bot');

    return (
        <div className="flex flex-col h-full w-full bg-gray-50 md:rounded-xl border border-gray-200 overflow-hidden">
            {/* Sticky Header */}
            <header className="flex-shrink-0 flex items-center justify-between p-4 bg-white/80 backdrop-blur-lg border-b border-gray-200 z-10">
                <button onClick={onClose} className="text-gray-500 hover:text-gray-900 transition-colors p-1 rounded-full"><ArrowLeftIcon /></button>
                <h2 className="text-lg font-bold text-gray-800 truncate mx-4 flex-1 text-center">{topic.topic_name}</h2>
                <div className="w-8 h-8"></div> {/* Spacer for balance */}
            </header>

            {/* Scrollable Message Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {messages.map((message, index) => {
                    const showIllustrateButton = index === lastBotMessageIndex && !!message.text && !isLoading && !isIllustrating;

                    return (
                        <div key={message.id} className={`flex items-start gap-3 w-full animate-fade-in-up ${message.sender === 'user' ? 'justify-end items-end' : 'justify-start'}`}>
                            {message.sender === 'bot' && 
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-lime-400 to-teal-500 flex-shrink-0 self-start">
                                   <GraduationCapIcon className="w-full h-full p-1.5 text-white" />
                                </div>
                            }
                            
                            <div className="flex flex-col max-w-[85%] sm:max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-3xl" style={{ alignItems: message.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                                <div className={`p-3 px-4 rounded-2xl break-words ${message.sender === 'user' ? 'bg-lime-500 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none border border-gray-200'}`}>
                                    {message.image_url && (
                                        <div className="mb-2">
                                            <img src={message.image_url} alt="Generated illustration" className="rounded-lg w-full" />
                                        </div>
                                    )}
                                    {message.sender === 'user' ? (
                                        <p className="text-sm sm:text-base whitespace-pre-wrap break-words">{message.text}</p>
                                    ) : (
                                        message.text &&
                                        <div className="text-sm sm:text-base prose prose-sm max-w-none">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm, remarkMath]}
                                                rehypePlugins={[rehypeKatex]}
                                                components={{
                                                    // Headings
                                                    h1: ({node, ...props}) => <h1 className="text-xl font-bold text-gray-900 mb-3 mt-2" {...props} />,
                                                    h2: ({node, ...props}) => <h2 className="text-lg font-bold text-gray-900 mb-2 mt-3" {...props} />,
                                                    h3: ({node, ...props}) => <h3 className="text-base font-semibold text-gray-800 mb-2 mt-2" {...props} />,
                                                    // Paragraphs with better spacing
                                                    p: ({node, ...props}) => <p className="mb-3 last:mb-0 leading-relaxed text-gray-800" {...props} />,
                                                    // Bold - highlighted key concepts
                                                    strong: ({node, ...props}) => <strong className="font-bold text-gray-900 bg-yellow-100 px-1 py-0.5 rounded" {...props} />,
                                                    // Italics for emphasis
                                                    em: ({node, ...props}) => <em className="italic text-lime-700 font-medium" {...props} />,
                                                    // Lists with better styling
                                                    ul: ({node, ...props}) => <ul className="list-disc list-outside space-y-1.5 my-3 pl-5" {...props} />,
                                                    ol: ({node, ...props}) => <ol className="list-decimal list-outside space-y-1.5 my-3 pl-5" {...props} />,
                                                    li: ({node, ...props}) => <li className="text-gray-700 leading-relaxed pl-1" {...props} />,
                                                    // Links
                                                    a: ({node, ...props}) => <a className="text-lime-600 hover:text-lime-700 underline font-medium" target="_blank" rel="noopener noreferrer" {...props} />,
                                                    // Code blocks
                                                    code: ({node, inline, ...props}: any) => 
                                                        inline ? (
                                                            <code className="bg-lime-50 text-lime-800 px-1.5 py-0.5 rounded text-xs font-mono border border-lime-200" {...props} />
                                                        ) : (
                                                            <code className="block bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto my-3 text-xs font-mono" {...props} />
                                                        ),
                                                    pre: ({node, ...props}) => <pre className="bg-gray-900 rounded-lg overflow-hidden my-3" {...props} />,
                                                    // Blockquotes for notes
                                                    blockquote: ({node, ...props}) => <blockquote className="border-l-3 border-lime-500 bg-lime-50 pl-4 pr-3 py-2 my-3 rounded-r italic" {...props} />,
                                                    // Tables
                                                    table: ({node, ...props}) => <div className="overflow-x-auto my-3"><table className="min-w-full divide-y divide-gray-200 border border-gray-200 text-xs" {...props} /></div>,
                                                    th: ({node, ...props}) => <th className="px-3 py-2 bg-lime-100 text-left font-semibold text-gray-900" {...props} />,
                                                    td: ({node, ...props}) => <td className="px-3 py-2 border-t border-gray-200" {...props} />,
                                                    // Horizontal rules
                                                    hr: ({node, ...props}) => <hr className="my-4 border-gray-300" {...props} />,
                                                }}
                                            >
                                                {message.text}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                                {showIllustrateButton && (
                                    <button
                                        onClick={() => handleGenerateIllustration(message.text!)}
                                        disabled={isLoading || isIllustrating}
                                        className="mt-2 flex items-center gap-1.5 text-sm text-gray-600 hover:text-lime-700 font-medium transition-colors disabled:opacity-50"
                                    >
                                        <SparklesIcon className="w-4 h-4" />
                                        <span>Visualize</span>
                                    </button>
                                )}
                            </div>

                            {message.sender === 'user' && 
                               <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 font-bold flex-shrink-0 items-center justify-center flex self-start">
                                   {userProfile.display_name.charAt(0).toUpperCase()}
                               </div>
                            }
                        </div>
                    )
                })}
                {isLoading && 
                    <div className="flex items-start gap-3 animate-fade-in-up">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-lime-400 to-teal-500 flex-shrink-0">
                           <GraduationCapIcon className="w-full h-full p-1.5 text-white" />
                        </div>
                        <div className="max-w-lg p-3 px-4 rounded-2xl bg-white border border-gray-200 rounded-bl-none">
                            <div className="flex items-center space-x-2">
                               <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:-0.3s]"></div>
                               <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse [animation-delay:-0.15s]"></div>
                               <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"></div>
                            </div>
                        </div>
                    </div>
                }
                 {isIllustrating &&
                    <div className="flex items-start gap-3 animate-fade-in-up">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-lime-400 to-teal-500 flex-shrink-0">
                           <GraduationCapIcon className="w-full h-full p-1.5 text-white" />
                        </div>
                        <div className="max-w-lg p-3 px-4 rounded-2xl bg-white border border-gray-200 rounded-bl-none">
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                                <SparklesIcon className="w-4 h-4 text-lime-500 animate-pulse" />
                                <span>Creating visualization...</span>
                            </div>
                        </div>
                    </div>
                }
                <div ref={messagesEndRef} />
            </div>
            
            {/* Fixed Input Area */}
            <footer className="flex-shrink-0 p-4 sm:p-6 border-t border-gray-200 bg-white/80 backdrop-blur-lg">
                <div className="relative flex items-center">
                    <textarea 
                        value={input} 
                        onChange={(e) => {
                            e.preventDefault();
                            setInput(e.target.value);
                        }} 
                        onKeyDown={(e) => { 
                            if (e.key === 'Enter' && !e.shiftKey) { 
                                e.preventDefault(); 
                                handleSend(); 
                            } 
                        }} 
                        placeholder="Ask a question..." 
                        className="w-full bg-white border border-gray-300 rounded-full py-3 pl-12 pr-14 text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-lime-500 focus:border-lime-500 focus:outline-none resize-none overflow-hidden" 
                        rows={1}
                        disabled={isLoading || isIllustrating}
                        autoComplete="off"
                        spellCheck="true"
                    />
                    <label className="absolute left-4 cursor-pointer text-gray-500 hover:text-gray-900 transition-colors">
                        <PaperclipIcon className="w-5 h-5" />
                        <input type="file" className="hidden" onChange={handleFileChange} disabled={isLoading || isIllustrating} accept="image/*" />
                    </label>
                    <button 
                        onClick={(e) => {
                            e.preventDefault();
                            handleSend();
                        }} 
                        disabled={isLoading || isIllustrating || (!input.trim() && !file)} 
                        className="absolute right-3 bg-lime-600 rounded-full p-2 text-white hover:bg-lime-700 active:bg-lime-800 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-lime-600"
                    >
                        <SendIcon className="w-5 h-5" />
                    </button>
                </div>
                {file && <div className="text-xs text-gray-600 mt-2 flex items-center gap-2 bg-gray-200 p-1 px-2 rounded-md w-fit"><FileIcon /><span>{file.name}</span><button onClick={() => { setFile(null); setFileData(null); }} className="text-red-500 hover:text-red-400">&times;</button></div>}
                
                {!isCompleted && <button onClick={() => onMarkComplete(topic.topic_id)} disabled={isIllustrating || isLoading} className="mt-4 w-full bg-gray-200 text-gray-800 font-bold py-3 px-4 rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50">Mark as Complete</button>}
            </footer>
        </div>
    );
};

// --- NEW LEARNING PATH COMPONENTS ---
const TopicNode: React.FC<{ topic: Topic, isCompleted: boolean, onSelect: () => void, index: number, pathColor: string }> = ({ topic, isCompleted, onSelect, index, pathColor }) => {
    const isEven = index % 2 === 0;
    
    return (
        <div className="relative w-full py-12 flex items-center justify-center">
            {/* Vertical Connector Line */}
            <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 ${isCompleted ? 'bg-lime-500 shadow-[0_0_15px_rgba(132,204,22,0.3)]' : 'bg-gray-100'} z-0`}></div>

            <div className={`w-full max-w-2xl flex items-center ${isEven ? 'flex-row' : 'flex-row-reverse'} relative z-10`}>
                {/* Content Side */}
                <div className={`w-1/2 px-8 ${isEven ? 'text-right' : 'text-left'}`}>
                    <div className="group cursor-pointer inline-block" onClick={onSelect}>
                        <h4 className={`text-sm font-black uppercase tracking-widest ${isCompleted ? 'text-lime-600' : 'text-gray-400 group-hover:text-gray-900'} transition-colors duration-300`}>
                            {isCompleted ? 'Mastered' : 'Locked'}
                        </h4>
                        <p className={`mt-1 text-lg font-bold leading-tight ${isCompleted ? 'text-gray-900' : 'text-gray-400 group-hover:text-gray-700'} transition-colors duration-300`}>
                            {topic.topic_name}
                        </p>
                    </div>
                </div>

                {/* Node Side */}
                <div className="relative flex items-center justify-center">
                    <button 
                        onClick={onSelect}
                        className={`group relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 transform hover:scale-110 active:scale-95 shadow-xl
                            ${isCompleted 
                                ? 'bg-lime-500 text-white ring-8 ring-lime-500/20' 
                                : 'bg-white border-2 border-gray-200 text-gray-300 ring-8 ring-transparent hover:ring-gray-100'}`}
                    >
                        {isCompleted ? (
                            <CheckIcon className="w-8 h-8"/>
                        ) : (
                            <LockIcon className="w-7 h-7" />
                        )}
                        
                        {/* Status Tooltip/Indicator */}
                        {!isCompleted && (
                            <div className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1 bg-gray-900 text-white text-[10px] font-black uppercase tracking-tighter rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
                                Start Learning
                            </div>
                        )}
                    </button>
                    
                    {/* Pulsing indicator for current topic (not yet completed but first in list) */}
                    {!isCompleted && index === 0 && (
                        <div className="absolute inset-0 w-16 h-16 rounded-full bg-lime-500/20 animate-ping pointer-events-none"></div>
                    )}
                </div>

                {/* Empty Side for alignment */}
                <div className="w-1/2"></div>
            </div>
        </div>
    );
};

const CourseHeader: React.FC<{ course: Course, isExpanded: boolean, onClick: () => void }> = ({ course, isExpanded, onClick }) => {
    const { Icon, gradient, textColor } = getSubjectVisuals(course.course_name);
    return (
        <div className="relative flex justify-center py-8">
            <button
                onClick={onClick}
                className={`flex items-center justify-between w-full max-w-xl gap-3 p-4 rounded-xl bg-gradient-to-r ${gradient} border border-gray-200 shadow-md hover:shadow-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lime-500`}
                aria-expanded={isExpanded}
            >
                <div className="flex items-center gap-3">
                    <Icon className={`w-8 h-8 ${textColor}`} />
                    <h3 className={`text-xl font-bold ${textColor}`}>{course.course_name}</h3>
                </div>
                <ChevronDownIcon className={`w-6 h-6 ${textColor} transition-transform duration-300 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} />
            </button>
        </div>
    );
}

// --- MAIN STUDY GUIDE COMPONENT ---
interface StudyGuideProps {
  userProfile: UserProfile;
  userProgress: UserProgress;
}
export const StudyGuide: React.FC<StudyGuideProps> = ({ userProfile, userProgress }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTopic, setSelectedTopic] = useState<(Topic & { courseName: string }) | null>(null);
  const [filter, setFilter] = useState<{ semester: 'first' | 'second' | 'all'; searchTerm: string }>({ semester: 'all', searchTerm: '' });
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const { addToast } = useToast();

  useEffect(() => {
    const fetchCourses = async () => {
      setIsLoading(true);
      try {
        const snapshot = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
        const data = snapshot.val();
        
        if (data && data.course_list) {
            const coursesForLevel: Course[] = (data.course_list as Course[]).filter(c => c.level === userProfile.level);
            setCourses(coursesForLevel);
        }
      } catch (err) {
        console.error("Error fetching courses:", err);
        addToast("Could not load study materials.", 'error');
      } finally {
        setIsLoading(false);
      }
    };
    fetchCourses();
  }, [userProfile.department_id, userProfile.level, addToast]);
  
  const toggleCourse = (courseId: string) => {
    setExpandedCourses(prev => {
        const newSet = new Set(prev);
        if (newSet.has(courseId)) {
            newSet.delete(courseId);
        } else {
            newSet.add(courseId);
        }
        return newSet;
    });
  };

  const handleMarkComplete = async (topicId: string) => {
    if (userProgress[topicId]?.is_complete) {
        addToast("You've already completed this topic!", 'info');
        return;
    }
    
    try {
        await update(dbRef(db, `user_progress/${userProfile.uid}/${topicId}`), {
            is_complete: true,
            timestamp: serverTimestamp(),
        });
        
        addToast(`Topic complete!`, 'success');
        
        // Close the learning interface to trigger a refresh of the study guide
        setSelectedTopic(null);
    } catch (err: any) {
        console.error("Failed to mark topic as complete:", err);
        addToast("Could not save your progress. Please check your connection or try again later.", 'error');
    }
  };

  const filteredCourses = courses
    .map(course => {
        if (filter.semester !== 'all' && course.semester !== filter.semester) {
            return null;
        }

        const filteredTopics = course.topics.filter(topic => 
            topic.topic_name.toLowerCase().includes(filter.searchTerm.toLowerCase())
        );

        if (filteredTopics.length === 0 && filter.searchTerm) {
            return null;
        }

        return { ...course, topics: filteredTopics };
    })
    .filter((c): c is Course => c !== null);

  if (selectedTopic) {
    return (
      <LearningInterface
        userProfile={userProfile}
        topic={selectedTopic}
        isCompleted={userProgress[selectedTopic.topic_id]?.is_complete || false}
        onClose={() => setSelectedTopic(null)}
        onMarkComplete={handleMarkComplete}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col w-full bg-white md:rounded-[2rem] border border-gray-100 shadow-sm overflow-hidden animate-in fade-in duration-700">
        <div className="flex-shrink-0 px-8 py-10 bg-gradient-to-b from-gray-50/50 to-white border-b border-gray-100">
            <div className="max-w-4xl mx-auto flex flex-col items-center text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-lime-50 text-lime-700 text-[10px] font-black uppercase tracking-widest mb-4">
                    <div className="w-1.5 h-1.5 rounded-full bg-lime-500 animate-pulse"></div>
                    Your Learning Path
                </div>
                <h2 className="text-4xl md:text-5xl font-black text-gray-900 mb-4 tracking-tight">Knowledge Roadmap</h2>
                <p className="text-gray-500 text-lg max-w-lg">Master your curriculum topic by topic with personalized AI guidance.</p>
                
                <div className="mt-8 w-full flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 relative group">
                        <input 
                            type="text" 
                            placeholder="Find a topic..."
                            value={filter.searchTerm}
                            onChange={(e) => setFilter(f => ({ ...f, searchTerm: e.target.value }))}
                            className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-4 pl-12 pr-4 text-gray-900 placeholder:text-gray-400 focus:ring-4 focus:ring-lime-500/10 focus:border-lime-500 focus:bg-white focus:outline-none transition-all shadow-sm group-hover:shadow-md"
                        />
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-lime-500 transition-colors">
                           <SearchIcon className="w-5 h-5" />
                        </div>
                    </div>
                    <div className="bg-gray-50 p-1.5 rounded-2xl flex border border-gray-200">
                        <button onClick={() => setFilter(f => ({ ...f, semester: 'first' }))} className={`px-6 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all ${filter.semester === 'first' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>1st Sem</button>
                        <button onClick={() => setFilter(f => ({ ...f, semester: 'second' }))} className={`px-6 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all ${filter.semester === 'second' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>2nd Sem</button>
                        <button onClick={() => setFilter(f => ({ ...f, semester: 'all' }))} className={`px-6 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all ${filter.semester === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>All</button>
                    </div>
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8 md:px-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {isLoading ? (
                <StudyGuideSkeleton />
            ) : (
                filteredCourses.length > 0 ? (
                    <div className="max-w-4xl mx-auto space-y-6">
                        {filteredCourses.map(course => {
                            const isExpanded = expandedCourses.has(course.course_id);
                            return (
                                <div key={course.course_id} className="relative">
                                    <CourseHeader
                                        course={course}
                                        isExpanded={isExpanded}
                                        onClick={() => toggleCourse(course.course_id)}
                                    />
                                    <div className={`grid transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-8' : 'grid-rows-[0fr] opacity-0'}`}>
                                        <div className="overflow-hidden">
                                            <div className="relative pb-12">
                                                {course.topics.map((topic, index) => (
                                                    <TopicNode
                                                        key={topic.topic_id}
                                                        topic={topic}
                                                        isCompleted={userProgress[topic.topic_id]?.is_complete || false}
                                                        onSelect={() => setSelectedTopic({ ...topic, courseName: course.course_name })}
                                                        index={index}
                                                        pathColor="bg-gray-100"
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center p-20 text-center">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4 text-gray-300">
                            <SearchIcon className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-1">No topics found</h3>
                        <p className="text-gray-500">Try adjusting your filters or search term.</p>
                    </div>
                )
            )}
        </div>
    </div>
  );
};
