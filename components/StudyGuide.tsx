
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { createAvelutAI } from '../utils/inference';
import { Type } from '@google/genai';
import { db, storage } from '../firebase';
import { ref as dbRef, onValue, off, set, update, get, push, runTransaction, serverTimestamp, increment } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import type { UserProfile, Message, Course, Topic, UserProgress, AppSettings } from '../types';
import { SendIcon } from './icons/SendIcon';
import { PaperclipIcon } from './icons/PaperclipIcon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import { GraduationCapIcon } from './icons/GraduationCapIcon';
import { useToast } from '../hooks/useToast';
import { SparklesIcon } from './icons/SparklesIcon';
import { LockIcon } from './icons/LockIcon';
import { LimitExceededModal } from './LimitExceededModal';
import { checkStudyGuideCoursesLimit, checkStudyGuideCourseRequestsLimit, incrementCourseRequestsUsed } from '../utils/usage';

declare var __app_id: string;

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
            bgColor: 'bg-blue-50',
            borderColor: 'border-blue-200',
            textColor: 'text-blue-800',
            pathColor: 'bg-blue-200'
        };
    }
    if (lowerName.includes('biology') || lowerName.includes('science')) {
        return {
            Icon: BeakerIcon,
            bgColor: 'bg-purple-50',
            borderColor: 'border-purple-200',
            textColor: 'text-purple-800',
            pathColor: 'bg-purple-200'
        };
    }
    return {
        Icon: BookIcon,
        bgColor: 'bg-yellow-50',
        borderColor: 'border-yellow-200',
        textColor: 'text-yellow-800',
        pathColor: 'bg-yellow-200'
    };
};

const normalizeLevelValue = (value?: string): string => {
    if (!value) return '';
    return value.toLowerCase().replace(/\s+/g, '').replace(/level/g, '').replace(/lvl/g, '');
};

const normalizeDepartmentValue = (value?: string): string => {
    if (!value) return '';
    return value.toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^\w_]/g, '');
};

const CHAT_XP_INTERVAL_SECONDS = 30;
const CHAT_XP_REWARD = 1;

const getWeekId = (date: Date): string => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-${weekNo}`;
};

const readNumericValue = (value: unknown, fallback = 0): number => (
    typeof value === 'number' ? value : fallback
);

const normalizeCourse = (course: any, fallbackCourseId = '', fallbackLevel = ''): Course | null => {
    if (!course || typeof course !== 'object') return null;
    const course_name = (course.course_name || '').toString().trim();
    if (!course_name) return null;
    const course_id = (course.course_id || fallbackCourseId || course_name.toLowerCase().replace(/\s+/g, '_')).toString();
    return {
        ...course,
        course_id,
        course_name,
        level: (course.level || fallbackLevel || '').toString(),
        topics: Array.isArray(course.topics) ? course.topics : [],
    } as Course;
};

const sanitizeTopicMetadata = (topic: any, index: number) => {
    const topicName = (topic?.topic_name || topic?.name || '').toString().trim() || `Topic ${index + 1}`;
    const rawTopicId = (topic?.topic_id || '').toString().trim();
    return {
        topic_name: topicName,
        topic_id: rawTopicId || normalizeTopicId(topicName),
        topic_context: (topic?.topic_context || topic?.context || '').toString().trim(),
        start_point: (topic?.start_point || topic?.start || '').toString().trim(),
        end_point: (topic?.end_point || topic?.end || '').toString().trim(),
        is_complete: Boolean(topic?.is_complete),
    } as Topic;
};

const normalizeTopicId = (value: string) => value.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');

const extractCoursesFromDepartmentData = (departmentData: any): Course[] => {
    if (!departmentData || typeof departmentData !== 'object') return [];

    if (Array.isArray(departmentData.course_list)) {
        return departmentData.course_list
            .map((course: any) => normalizeCourse(course))
            .filter((course: Course | null): course is Course => course !== null);
    }

    if (departmentData.course_list && typeof departmentData.course_list === 'object') {
        return Object.entries(departmentData.course_list)
            .map(([courseId, course]) => normalizeCourse(course, courseId))
            .filter((course: Course | null): course is Course => course !== null);
    }

    if (departmentData.levels && typeof departmentData.levels === 'object') {
        return Object.entries(departmentData.levels).flatMap(([levelKey, levelValue]: [string, any]) => {
            const courseMap = levelValue?.courses;
            if (!courseMap || typeof courseMap !== 'object') return [];
            return Object.entries(courseMap)
                .map(([courseId, course]) => normalizeCourse(course, courseId, levelKey))
                .filter((course: Course | null): course is Course => course !== null);
        });
    }

    return [];
};


const base64ToBlob = (base64: string, mimeType: string): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
};

const createUniqueId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    const perfPart = typeof performance !== 'undefined' ? performance.now().toString().replace('.', '') : '0';
    return `${Date.now()}-${perfPart}`;
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
    topic: Topic & { courseName: string; courseId?: string; course_id?: string };
    onClose: () => void;
    usageStats: any;
}

const INVIDIOUS_INSTANCES = [
    'https://invidious.flokinet.to',
    'https://invidious.nerdvpn.de',
    'https://invidious.tiekoetter.com',
    'https://yewtu.be',
    'https://inv.tux.im'
];

const fetchRealYoutubeVideo = async (searchQuery: string, predictedVideoId: string, apiKey?: string): Promise<{ videoId: string; thumbnailUrl: string }> => {
    if (!apiKey) {
        throw new Error("YouTube Search API key is not configured in Admin settings.");
    }

    // 1. Try to fetch video details directly by predicted ID using /v3/videos with part=snippet
    if (predictedVideoId) {
        try {
            const url = `https://www.googleapis.com/youtube/v3/videos?id=${predictedVideoId}&key=${apiKey}&part=snippet`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                const firstVideo = data.items?.[0];
                if (firstVideo && firstVideo.id) {
                    const thumb = firstVideo.snippet?.thumbnails?.medium?.url || 
                                  firstVideo.snippet?.thumbnails?.default?.url || 
                                  `https://img.youtube.com/vi/${predictedVideoId}/mqdefault.jpg`;
                    return {
                        videoId: predictedVideoId,
                        thumbnailUrl: thumb
                    };
                }
            } else {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData?.error?.message || `HTTP error ${response.status}`;
                console.warn(`YouTube videos API returned error for predicted ID: ${errMsg}`);
            }
        } catch (err) {
            console.warn(`Failed to fetch video details for predicted ID ${predictedVideoId}:`, err);
        }
    }

    // 2. Fall back to search query using /v3/search
    try {
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&type=video&q=${encodeURIComponent(searchQuery)}&key=${apiKey}`;
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            const firstVideo = data.items?.[0];
            if (firstVideo && firstVideo.id?.videoId) {
                const thumb = firstVideo.snippet?.thumbnails?.medium?.url || 
                              firstVideo.snippet?.thumbnails?.default?.url || 
                              `https://img.youtube.com/vi/${firstVideo.id.videoId}/mqdefault.jpg`;
                return {
                    videoId: firstVideo.id.videoId,
                    thumbnailUrl: thumb
                };
            } else {
                throw new Error(`No search results found on YouTube for: "${searchQuery}"`);
            }
        } else {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData?.error?.message || `HTTP error ${response.status}`;
            throw new Error(`YouTube API Error: ${errMsg}`);
        }
    } catch (err: any) {
        console.error(`Failed to fetch from YouTube API for query "${searchQuery}":`, err);
        throw err;
    }
};

const parseMessageSuggestions = (text: string): { cleanText: string; suggestions: string[] } => {
    if (!text) return { cleanText: '', suggestions: [] };
    
    // Match suggestions pattern like [Suggestions: Option 1 | Option 2]
    const regex = /\[Suggestions:\s*(.*?)\]/i;
    const match = text.match(regex);
    
    if (match) {
        const rawOptions = match[1] || '';
        const suggestions = rawOptions
            .split('|')
            .map(opt => opt.trim())
            .filter(Boolean);
            
        // Remove suggestions from the rendered text
        const cleanText = text.replace(regex, '').trim();
        return { cleanText, suggestions };
    }
    
    // For streaming rendering, hide partial suggestions syntax to prevent flashing
    const lowerText = text.toLowerCase();
    const partialIndex = lowerText.indexOf('[suggestions:');
    if (partialIndex !== -1) {
        const cleanText = text.substring(0, partialIndex).trim();
        return { cleanText, suggestions: [] };
    }
    
    const lastBracketIndex = text.lastIndexOf('[');
    if (lastBracketIndex !== -1 && lastBracketIndex > text.length - 15) {
        const potential = text.substring(lastBracketIndex).toLowerCase();
        if ('[suggestions:'.startsWith(potential)) {
            const cleanText = text.substring(0, lastBracketIndex).trim();
            return { cleanText, suggestions: [] };
        }
    }
    
    return { cleanText: text, suggestions: [] };
};

const LearningInterface: React.FC<LearningInterfaceProps> = ({ userProfile, topic, onClose, usageStats }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [streamingBotText, setStreamingBotText] = useState<string | null>(null);
    const [input, setInput] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [fileData, setFileData] = useState<string | null>(null);
    const [showLimitModal, setShowLimitModal] = useState(false);
    const [isTutorialsOpen, setIsTutorialsOpen] = useState(false);
    const [tutorials, setTutorials] = useState<Array<{ title: string; description: string; searchQuery: string; videoId?: string; thumbnailUrl?: string }>>([]);
    const [isTutorialsLoading, setIsTutorialsLoading] = useState(false);
    const [tutorialsError, setTutorialsError] = useState<string | null>(null);
    const [activeVideo, setActiveVideo] = useState<{ title: string; searchQuery: string; videoId?: string; thumbnailUrl?: string } | null>(null);
    const [brokenThumbnails, setBrokenThumbnails] = useState<Record<string, boolean>>({});
    const [limitModalFeature, setLimitModalFeature] = useState<'visual_messages' | 'courses' | 'ai_requests_per_course' | 'exams'>('ai_requests_per_course');
    const [limitModalData, setLimitModalData] = useState({ limit: 0, used: 0, price: 0, batchCount: 5, courseId: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [isIllustrating, setIsIllustrating] = useState(false);
    const [textbookContext, setTextbookContext] = useState<string>('');
    const [selectedTopicContext, setSelectedTopicContext] = useState<string>('');
    const messagesEndRef = useRef<null | HTMLDivElement>(null);
    const isAwardingTimeXpRef = useRef(false);
    const [shouldAutoTeach, setShouldAutoTeach] = useState(false);
    const { settings: appSettings, isLoading: isAppSettingsLoading } = useAppSettings();
    const geminiModel = appSettings.primary_gemini_model;
    const ai = useMemo(
        () => createAvelutAI(appSettings, userProfile),
        [appSettings, userProfile]
    );
    const profileSnapshotRef = useRef({
        display_name: userProfile.display_name || 'Learner',
        photo_url: userProfile.photo_url || '',
        level: userProfile.level,
    });
    const { attemptApiCall } = useApiLimiter();
    const { addToast } = useToast();
    const isInitialChatLoading = isLoading && messages.length === 0;

    // Sharing and forwarding states
    const [showShareDropdown, setShowShareDropdown] = useState(false);
    const [shareModalUrl, setShareModalUrl] = useState<string | null>(null);
    const [studyPartners, setStudyPartners] = useState<Record<string, boolean>>({});
    const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
    const [isForwardModalOpen, setIsForwardModalOpen] = useState(false);
    const [forwardTargetContent, setForwardTargetContent] = useState('');
    const [forwardTargetType, setForwardTargetType] = useState('text');
    const [forwardSearchQuery, setForwardSearchQuery] = useState('');
    const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);

    // Message actions context menu states
    const [messageActionTarget, setMessageActionTarget] = useState<any>(null);
    const [messageActionPosition, setMessageActionPosition] = useState<{ x: number; y: number } | null>(null);
    const messageActionMenuRef = useRef<HTMLDivElement>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!userProfile) return;
        const partnersRef = dbRef(db, `study_partners/${userProfile.uid}`);
        const unsubscribePartners = onValue(partnersRef, (snap) => {
            setStudyPartners(snap.val() || {});
        });

        const usersRef = dbRef(db, 'users');
        const unsubscribeUsers = onValue(usersRef, (snap) => {
            const data = snap.val() || {};
            const list: UserProfile[] = Object.entries(data).map(([uid, u]: any) => ({
                uid,
                display_name: u.displayName || u.display_name || 'Learner',
                photo_url: u.photoURL || u.photo_url || '',
                subscription_status: u.subscription_status || 'free',
                department_id: u.department_id || '',
                level: u.level || '',
                is_online: u.is_online || false,
                last_seen: u.last_seen || 0,
                current_streak: u.current_streak || 0,
                last_activity_date: u.last_activity_date || 0,
                notifications_enabled: u.notifications_enabled || false,
            } as UserProfile));
            setAllUsers(list);
        });

        return () => {
            off(partnersRef, 'value', unsubscribePartners);
            off(usersRef, 'value', unsubscribeUsers);
        };
    }, [userProfile]);

    useEffect(() => {
        const onPointerDown = (event: MouseEvent | TouchEvent) => {
            if (!messageActionTarget) return;
            if (!messageActionMenuRef.current) return;
            if (event.target instanceof Node && !messageActionMenuRef.current.contains(event.target)) {
                setMessageActionTarget(null);
                setMessageActionPosition(null);
            }
        };

        const onEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMessageActionTarget(null);
                setMessageActionPosition(null);
            }
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown);
        document.addEventListener('keydown', onEscape);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onEscape);
        };
    }, [messageActionTarget]);

    const handleShareTopicChat = async () => {
        if (!topic || !userProfile) return;
        try {
            const shareId = push(dbRef(db, 'shared_chats')).key;
            if (!shareId) return;

            // Save details to DB
            const chatRef = dbRef(db, `shared_chats/${shareId}`);
            await set(chatRef, {
                courseName: topic.courseName,
                courseId: topic.courseId || topic.course_id || 'unspecified',
                topicName: topic.topic_name,
                topicId: topic.topic_id,
                messages: messages,
                ownerId: userProfile.uid,
                ownerName: userProfile.display_name || 'Learner',
                timestamp: Date.now()
            });

            const shareUrl = `${window.location.origin}/shared-chat/${shareId}`;
            setShareModalUrl(shareUrl);
            await navigator.clipboard.writeText(shareUrl);
            addToast('Share link generated and copied to clipboard!', 'success');
        } catch (err: any) {
            console.error('Failed to share chat:', err);
            addToast('Failed to share chat: ' + err.message, 'error');
        }
    };

    const handleForwardMessage = async (recipientIds: string[], text: string, type: string) => {
        if (!userProfile) return;
        try {
            for (const recipientId of recipientIds) {
                const chatId = [userProfile.uid, recipientId].sort().join('_');
                const msgRef = push(dbRef(db, `messages/${chatId}`));
                const data = { senderId: userProfile.uid, text, type, timestamp: Date.now() };
                await set(msgRef, data);

                const updates: any = {};
                let summaryText = text;
                if (type === 'voice') summaryText = '🎵 Voice message';
                else if (type === 'image') summaryText = '📷 Image file';
                else if (type === 'file') summaryText = '📄 Document file';
                
                const participantIds = Array.from(new Set([userProfile.uid, recipientId]));
                participantIds.forEach((participantId) => {
                    updates[`user_chats/${participantId}/${chatId}/last_message`] = {
                        text: summaryText,
                        senderId: userProfile.uid,
                        timestamp: Date.now(),
                        type,
                    };
                    updates[`user_chats/${participantId}/${chatId}/timestamp`] = Date.now();
                    updates[`user_chats/${participantId}/${chatId}/otherUserId`] = participantId === userProfile.uid
                        ? recipientId
                        : userProfile.uid;
                });

                updates[`user_chats/${userProfile.uid}/${chatId}/unreadCount`] = 0;
                if (recipientId !== userProfile.uid) {
                    updates[`user_chats/${recipientId}/${chatId}/unreadCount`] = increment(1);
                }
                await update(dbRef(db), updates);
            }
            addToast('Message forwarded successfully!', 'success');
        } catch (err: any) {
            console.error('Failed to forward message:', err);
            addToast('Forwarding failed: ' + err.message, 'error');
        }
    };

    const fetchTutorials = async () => {
        if (tutorials.length > 0 || isTutorialsLoading) return;
        setIsTutorialsLoading(true);
        setTutorialsError(null);
        try {
            const contextToUse = selectedTopicContext || [
                topic.topic_context ? `Topic context: ${topic.topic_context}` : '',
                topic.start_point ? `Start teaching from: ${topic.start_point}` : '',
                topic.end_point ? `Stop teaching at: ${topic.end_point}` : '',
            ].filter(Boolean).join('\n');

            const prompt = `
You are an expert academic advisor. Your task is to identify 5 to 10 highly specific, relevant video tutorials or search terms for the university-level topic: '${topic.topic_name}' under the course: '${topic.courseName}' at level: '${userProfile.level || 'University'}'.

CRITICAL INSTRUCTIONS FOR RELEVANCE AND CONTEXT:
1. Every tutorial search query and title MUST be directly specific to the course ('${topic.courseName}') and topic ('${topic.topic_name}') at hand. Do NOT provide generic, out-of-context, or mismatched tutorials.
2. Ground your selections in the following context/summary of what the student is about to learn:
${contextToUse ? contextToUse : `Topic: ${topic.topic_name}\nCourse: ${topic.courseName}`}

3. For each sub-topic, provide:
   - "title": A clear, educational title indicating precisely what sub-topic is covered.
   - "description": A brief, specific summary of what the user is about to learn from this tutorial in the context of this course.
   - "searchQuery": A highly specific search query (including the course name, topic name, and sub-topic name) that will find the best, highly-rated educational tutorial on YouTube (e.g. from academic channels like CrashCourse, Khan Academy, MIT OpenCourseWare, 3Blue1Brown, FreeCodeCamp, etc.).
   - "videoId": A predicted highly popular YouTube video ID for that tutorial that matches this query.

Return valid JSON as a list of objects with keys: title, description, searchQuery, and videoId. Do not add any backticks, explanation, or HTML markdown outside of the JSON array.
`;
            const result = await attemptApiCall(async () => {
                if (!ai) throw new Error('AI client is not initialized.');
                const response = await ai.models.generateContent({
                    model: geminiModel,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    title: { type: Type.STRING },
                                    description: { type: Type.STRING },
                                    searchQuery: { type: Type.STRING },
                                    videoId: { type: Type.STRING }
                                },
                                required: ['title', 'description', 'searchQuery', 'videoId']
                            }
                        }
                    }
                });
                const text = response.text || '[]';
                return JSON.parse(text);
            });

            if (result.success && Array.isArray(result.data)) {
                const initialItems = result.data.map((item: any) => {
                    return {
                        title: item.title || '',
                        description: item.description || '',
                        searchQuery: item.searchQuery || '',
                        predictedVideoId: item.videoId || '',
                        videoId: '',
                        thumbnailUrl: ''
                    };
                });
                setTutorials(initialItems);

                // Fetch real videos asynchronously in parallel
                void (async () => {
                    try {
                        const resolved = await Promise.all(initialItems.map(async (item) => {
                            const real = await fetchRealYoutubeVideo(item.searchQuery, item.predictedVideoId, appSettings?.youtube_api_key);
                            return {
                                ...item,
                                videoId: real.videoId,
                                thumbnailUrl: real.thumbnailUrl
                            };
                        }));
                        setTutorials(resolved);
                    } catch (err: any) {
                        console.error('Failed to load video details from YouTube API:', err);
                        setTutorials([]);
                        setTutorialsError(err.message || 'Failed to fetch YouTube tutorials.');
                    }
                })();
            } else {
                throw new Error(result.message || 'Failed to parse JSON response');
            }
        } catch (err: any) {
            console.error('Failed to load video tutorials:', err);
            setTutorials([]);
            setTutorialsError(err.message || 'Failed to generate tutorial search terms.');
        } finally {
            setIsTutorialsLoading(false);
        }
    };

    useEffect(() => {
        profileSnapshotRef.current = {
            display_name: userProfile.display_name || 'Learner',
            photo_url: userProfile.photo_url || '',
            level: userProfile.level,
        };
    }, [userProfile.display_name, userProfile.photo_url, userProfile.level]);

    useEffect(() => {
        const fetchTextbook = async () => {
            const textbookRef = dbRef(db, `textbook_contexts/${userProfile.department_id}/${userProfile.level}/${topic.courseName}`);
            const snap = await get(textbookRef);
            if (snap.exists()) {
                const data = snap.val();
                const syllabusTopics = Array.isArray(data.syllabus) ? data.syllabus : [];
                const matchedTopic = syllabusTopics.find((entry: any) => (
                    (entry?.topic_id && entry.topic_id === topic.topic_id) ||
                    (entry?.topic_name && entry.topic_name === topic.topic_name)
                ));
                const topicContext = (topic.topic_context || matchedTopic?.topic_context || '').trim();
                const startPoint = (topic.start_point || matchedTopic?.start_point || '').trim();
                const endPoint = (topic.end_point || matchedTopic?.end_point || '').trim();
                const contextBlock = [
                    topicContext ? `Topic context: ${topicContext}` : '',
                    startPoint ? `Start teaching from: ${startPoint}` : '',
                    endPoint ? `Stop teaching at: ${endPoint}` : '',
                ].filter(Boolean).join('\n');
                setSelectedTopicContext(contextBlock);
                setTextbookContext(`\n\nCOURSE TEXTBOOK CONTEXT:\nThis lesson must be strictly grounded in the following textbook syllabus and objectives:\n${JSON.stringify(data.syllabus)}`);
            } else {
                const contextBlock = [
                    topic.topic_context ? `Topic context: ${topic.topic_context}` : '',
                    topic.start_point ? `Start teaching from: ${topic.start_point}` : '',
                    topic.end_point ? `Stop teaching at: ${topic.end_point}` : '',
                ].filter(Boolean).join('\n');
                setSelectedTopicContext(contextBlock);
            }
        };
        fetchTextbook();
    }, [userProfile.department_id, userProfile.level, topic.courseName, topic.topic_id, topic.topic_name, topic.topic_context, topic.start_point, topic.end_point]);

    const systemInstruction = `You are AVELUT, an expert AI educator. Your primary goal is to provide a comprehensive and complete understanding of the given topic for a student at their specified level.

Your Method:
1. First, mentally outline all key concepts needed to fully master the topic.
2. Begin teaching, but do NOT present the entire outline at once.
3. Break the lesson into very small, bite-sized chunks. Each message you send must be extremely short, concise, and focused on a single, simple idea. Avoid long lectures or long messages at all costs. Responses should be delivered bit-by-bit (maximum 2-4 sentences per concept).
4. After explaining a small concept, you MUST end your message with a simple question to check for understanding before proceeding. This is crucial.
5. NEVER deliver long lectures. Keep it interactive and conversational.
6. At the very end of your response, you MUST attach exactly 2 to 3 short, context-specific suggestion pills to continue the conversation. Format them on a single line at the very end of the response as:
[Suggestions: Option 1 | Option 2 | Option 3]
Keep these options extremely short (1-4 words each) and highly relevant to the concept you just taught (e.g. 'Yes, explain', 'Give an example', 'Next concept').

Use simple language, analogies, and Markdown for clarity. For mathematical formulas and symbols, use LaTeX syntax (e.g., $...$ for inline and $$...$$ for block). Be patient and encouraging.

Scope control (very important):
- Stay strictly within the selected topic context and boundaries.
- Do not jump to unrelated chapters unless the student explicitly asks.
- If the topic is completed within its boundaries, clearly state completion and ask if the student wants revision or the next topic.
${selectedTopicContext ? `\n\nSELECTED TOPIC BOUNDARY:\n${selectedTopicContext}` : ''}${textbookContext}`;

    useEffect(() => {
        let intervalId: any = null;

        const awardTimeBasedXp = async () => {
            if (isAwardingTimeXpRef.current) return;
            isAwardingTimeXpRef.current = true;

            try {
                const userXpRef = dbRef(db, `users/${userProfile.uid}/xp`);
                const xpTxnResult = await runTransaction(userXpRef, (currentXp) => {
                    const numericXp = typeof currentXp === 'number' ? currentXp : 0;
                    return numericXp + CHAT_XP_REWARD;
                });
                const totalXp = readNumericValue(xpTxnResult.snapshot.val());

                const weekId = getWeekId(new Date());
                const weeklyXpRef = dbRef(db, `leaderboard_weekly/${weekId}/${userProfile.department_id}/${userProfile.uid}/xp`);
                const weeklyTxnResult = await runTransaction(weeklyXpRef, (currentXp) => {
                    const numericXp = typeof currentXp === 'number' ? currentXp : 0;
                    return numericXp + CHAT_XP_REWARD;
                });
                const weeklyXp = readNumericValue(weeklyTxnResult.snapshot.val());
                const profile = profileSnapshotRef.current;

                const leaderboardEntryData = {
                    display_name: profile.display_name,
                    photo_url: profile.photo_url,
                    department_id: userProfile.department_id,
                    level: profile.level,
                    last_updated_at: serverTimestamp(),
                };

                await update(dbRef(db, `leaderboard_overall/${userProfile.department_id}/${userProfile.uid}`), {
                    ...leaderboardEntryData,
                    xp: totalXp,
                });

                await update(dbRef(db, `leaderboard_weekly/${weekId}/${userProfile.department_id}/${userProfile.uid}`), {
                    ...leaderboardEntryData,
                    xp: weeklyXp,
                });
            } catch (error) {
                console.error('Failed to award time-based XP:', error);
            } finally {
                isAwardingTimeXpRef.current = false;
            }
        };

        const stopInterval = () => {
            if (intervalId === null) return;
            window.clearInterval(intervalId);
            intervalId = null;
        };

        const startInterval = () => {
            if (intervalId !== null) return;
            intervalId = window.setInterval(() => {
                void awardTimeBasedXp();
            }, CHAT_XP_INTERVAL_SECONDS * 1000);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                startInterval();
                return;
            }
            stopInterval();
        };

        handleVisibilityChange();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            stopInterval();
        };
    }, [userProfile.uid, userProfile.department_id]);

    const initiateAutoTeach = useCallback(async () => {
        if (isAppSettingsLoading) {
            return;
        }
        if (!ai) {
            addToast('Gemini API key is not configured in App Controls.', 'error');
            return;
        }

        const courseId = topic.courseId || topic.course_id || 'unknown';
        const limitCheck = checkStudyGuideCourseRequestsLimit(courseId, userProfile, usageStats, appSettings);
        if (!limitCheck.allowed) {
            setLimitModalFeature('ai_requests_per_course');
            setLimitModalData({
                limit: limitCheck.limit,
                used: limitCheck.used,
                price: limitCheck.price,
                batchCount: limitCheck.count,
                courseId
            });
            setShowLimitModal(true);
            onClose();
            return;
        }

        setIsLoading(true);
        const prompt = `
Context:
Department: ${userProfile.department_id}
Course: ${topic.courseName}
Topic: ${topic.topic_name}
User Level: ${userProfile.level}
${selectedTopicContext ? `Topic Boundaries:\n${selectedTopicContext}` : ''}

Task:
Please start teaching me about "${topic.topic_name}". Give me a simple and clear introduction to the topic.
`;
        setStreamingBotText('');
        const result = await attemptApiCall(async () => {
            let responseText = '';
            const responseStream = await ai.models.generateContentStream({
                model: geminiModel,
                config: { systemInstruction },
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
            });

            for await (const chunk of responseStream) {
                const chunkText = chunk.text || '';
                responseText += chunkText;
                setStreamingBotText(responseText);
            }

            if (!responseText) {
                throw new Error('Gemini returned an empty response.');
            }
            
            const botResponseText = responseText.trim();

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
            await incrementCourseRequestsUsed(userProfile.uid, courseId, limitCheck.windowStart);
        });
        setStreamingBotText(null);

        if (!result.success) {
            addToast(result.message || 'Sorry, I had trouble starting the lesson.', 'error');
            setIsLoading(false);
            onClose();
        }
    }, [ai, addToast, attemptApiCall, geminiModel, isAppSettingsLoading, onClose, selectedTopicContext, systemInstruction, topic.courseName, topic.topic_id, topic.topic_name, userProfile.department_id, userProfile.level, userProfile.uid, appSettings, usageStats, topic.courseId, topic.course_id, setStreamingBotText]);

    const handleMarkTopicComplete = async () => {
        try {
            const progressRef = dbRef(db, `user_progress/${userProfile.uid}/${topic.topic_id}`);
            const currentSnapshot = await get(progressRef);
            const currentData = currentSnapshot.val() || {};

            await update(progressRef, {
                is_complete: true,
                timestamp: Date.now(),
                study_duration_seconds: currentData.study_duration_seconds || 0,
                xp_earned: currentData.xp_earned || 0,
            });
        } catch (error) {
            console.error('Failed to mark topic complete:', error);
            addToast('Could not mark topic complete right now.', 'error');
        }
    };

    useEffect(() => {
        const messagesRef = dbRef(db, `study_guide_messages/${userProfile.uid}/${topic.topic_id}`);
        
        setIsLoading(true);
        const unsubscribe = onValue(messagesRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                setShouldAutoTeach(true);
                return;
            } else {
                setShouldAutoTeach(false);
                const fetchedMessages: Message[] = Object.entries(data).map(([id, msg]: [string, any]) => ({
                    id,
                    text: msg.text,
                    sender: msg.sender as 'user' | 'bot',
                    timestamp: msg.timestamp,
                    image_url: msg.image_url,
                })).sort((a,b) => a.timestamp - b.timestamp);
                setMessages(fetchedMessages);
                setIsLoading(false);
            }
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
        if (isAppSettingsLoading || !shouldAutoTeach) return;
        setShouldAutoTeach(false);
        void initiateAutoTeach();
    }, [isAppSettingsLoading, initiateAutoTeach, shouldAutoTeach]);

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
        if (!ai) {
            addToast('Gemini API key is not configured in App Controls.', 'error');
            return;
        }

        const courseId = topic.courseId || topic.course_id || 'unknown';
        const limitCheck = checkStudyGuideCourseRequestsLimit(courseId, userProfile, usageStats, appSettings);
        if (!limitCheck.allowed) {
            setLimitModalFeature('ai_requests_per_course');
            setLimitModalData({
                limit: limitCheck.limit,
                used: limitCheck.used,
                price: limitCheck.price,
                batchCount: limitCheck.count,
                courseId
            });
            setShowLimitModal(true);
            return;
        }
        
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
            const userMessageData: {
                sender: 'user';
                text: string;
                image_url?: string;
                timestamp: object;
            } = {
                sender: 'user',
                text: tempInput || '',
                timestamp: serverTimestamp(),
            };
            if (imageUrl) {
                userMessageData.image_url = imageUrl;
            }
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

            setStreamingBotText('');
            const result = await attemptApiCall(async () => {
                const history = updatedMessages.map(m => `${m.sender === 'user' ? 'Student' : 'Tutor'}: ${m.text || ''}`).join('\n');
                
                const prompt = `
Context:
Department: ${userProfile.department_id}
Course: ${topic.courseName}
Topic: ${topic.topic_name}
User Level: ${userProfile.level}
${selectedTopicContext ? `Topic Boundaries:\n${selectedTopicContext}` : ''}

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

                let responseText = '';
                const responseStream = await ai.models.generateContentStream({
                    model: geminiModel,
                    config: { systemInstruction },
                    contents: [{ role: 'user', parts }]
                });

                for await (const chunk of responseStream) {
                    const chunkText = chunk.text || '';
                    responseText += chunkText;
                    setStreamingBotText(responseText);
                }

                if (!responseText) {
                    throw new Error('Gemini returned an empty response.');
                }

                const botResponseText = responseText.trim();
                
                const newBotMsgRef = push(messagesRef);
                const botMessageData = {
                    sender: 'bot',
                    text: botResponseText,
                    timestamp: serverTimestamp(),
                };
                await set(newBotMsgRef, botMessageData);
                await incrementCourseRequestsUsed(userProfile.uid, courseId, limitCheck.windowStart);
            });
            setStreamingBotText(null);

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
        if (!ai) {
            addToast('Gemini API key is not configured in App Controls.', 'error');
            return;
        }

        setIsIllustrating(true);
        addToast("Creating a visualization for you...", "info");

        const result = await attemptApiCall(async () => {
            const prompt = `Create an educational visualization for this study guide explanation:\n\n${promptText}`;
            const response = await ai.models.generateContent({
                model: geminiModel,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            });

            const parts = response.candidates?.[0]?.content?.parts ?? [];

            const imageUrls: string[] = [];
            for (const part of parts) {
                if (!part.inlineData?.data) continue;

                const mimeType = part.inlineData.mimeType || 'image/png';
                const fileExtension = mimeType.split('/')[1] || 'png';
                const imageBlob = base64ToBlob(part.inlineData.data, mimeType);
                const uniqueImageId = createUniqueId();
                const storageRefObj = storageRef(storage, `${userProfile.uid}/study-guide-illustrations/${topic.topic_id}/${uniqueImageId}.${fileExtension}`);
                const uploadResult = await uploadBytes(storageRefObj, imageBlob);
                const publicUrl = await getDownloadURL(uploadResult.ref);
                imageUrls.push(publicUrl);
            }

            if (imageUrls.length === 0) {
                throw new Error("No image visualization was returned by the API.");
            }

            const messagesRef = dbRef(db, `study_guide_messages/${userProfile.uid}/${topic.topic_id}`);

            for (const publicUrl of imageUrls) {
                const imageMsgRef = push(messagesRef);
                const imageMessageData = {
                    sender: 'bot',
                    image_url: publicUrl,
                    timestamp: serverTimestamp(),
                };
                await set(imageMsgRef, imageMessageData);
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
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => {
                            setIsTutorialsOpen(true);
                            void fetchTutorials();
                        }}
                        className="flex items-center px-4 py-2 bg-blue-50 border border-blue-100 hover:bg-blue-100 text-blue-700 rounded-full text-xs font-black uppercase tracking-wider transition-colors cursor-pointer select-none shadow-sm"
                    >
                        Video Tutorial
                    </button>
                    
                    <div className="relative">
                        <button 
                            onClick={() => setShowShareDropdown(!showShareDropdown)}
                            className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-full transition cursor-pointer select-none"
                            title="Share Options"
                        >
                            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="1.5"/>
                                <circle cx="12" cy="5" r="1.5"/>
                                <circle cx="12" cy="19" r="1.5"/>
                            </svg>
                        </button>
                        {showShareDropdown && (
                            <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl z-50 animate-fade-in">
                                <button
                                    onClick={() => {
                                        setShowShareDropdown(false);
                                        void handleShareTopicChat();
                                    }}
                                    className="w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition flex items-center gap-2"
                                >
                                    <span>🔗</span> Share Chat Session
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Scrollable Message Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {isInitialChatLoading ? (
                    <div className="h-full min-h-[200px] flex items-center justify-center">
                        <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                            <span className="ml-1">Loading lesson...</span>
                        </div>
                    </div>
                ) : (
                <>
                {messages.map((message) => {
                    const { cleanText, suggestions } = parseMessageSuggestions(message.text || '');

                    return (
                        <div key={message.id} className={`flex items-start gap-3 w-full animate-fade-in-up ${message.sender === 'user' ? 'justify-end items-end' : 'justify-start'}`}>
                            {message.sender === 'bot' && 
                                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-lime-400 to-teal-500 flex-shrink-0 self-start">
                                   <GraduationCapIcon className="w-full h-full p-1.5 text-white" />
                                </div>
                            }
                            
                            <div className="flex flex-col max-w-[85%] sm:max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-3xl" style={{ alignItems: message.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                                <div 
                                    className={`p-3 px-4 rounded-2xl break-words ${message.sender === 'user' ? 'bg-lime-500 text-white rounded-br-none' : 'bg-white text-gray-800 rounded-bl-none border border-gray-200 cursor-pointer select-text'}`}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setMessageActionTarget(message);
                                        setMessageActionPosition({ x: e.clientX, y: e.clientY });
                                    }}
                                    onTouchStart={(e) => {
                                        if (!e.touches[0]) return;
                                        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                        const touch = e.touches[0];
                                        longPressTimerRef.current = setTimeout(() => {
                                            setMessageActionTarget(message);
                                            setMessageActionPosition({ x: touch.clientX, y: touch.clientY });
                                        }, 800);
                                    }}
                                    onTouchEnd={() => {
                                        if (longPressTimerRef.current) {
                                            clearTimeout(longPressTimerRef.current);
                                            longPressTimerRef.current = null;
                                        }
                                    }}
                                    onTouchMove={() => {
                                        if (longPressTimerRef.current) {
                                            clearTimeout(longPressTimerRef.current);
                                            longPressTimerRef.current = null;
                                        }
                                    }}
                                    onTouchCancel={() => {
                                        if (longPressTimerRef.current) {
                                            clearTimeout(longPressTimerRef.current);
                                            longPressTimerRef.current = null;
                                        }
                                    }}
                                >
                                    {message.image_url && (
                                        <div className="mb-2">
                                            <img src={message.image_url} alt="Generated illustration" className="rounded-lg w-full" />
                                        </div>
                                    )}
                                    {message.sender === 'user' ? (
                                        <p className="text-sm sm:text-base whitespace-pre-wrap break-words">{cleanText}</p>
                                    ) : (
                                        cleanText &&
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
                                                {cleanText}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                                {message.sender === 'bot' && suggestions.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-2 max-w-full">
                                        {suggestions.map((suggestion, sIdx) => (
                                            <button
                                                key={sIdx}
                                                onClick={() => handleSend(suggestion)}
                                                disabled={isLoading || isIllustrating}
                                                className="px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 hover:border-blue-200 text-blue-700 border border-blue-100 rounded-full text-xs font-bold transition-all shadow-xs hover:scale-105 active:scale-95 cursor-pointer select-none"
                                            >
                                                {suggestion}
                                            </button>
                                        ))}
                                    </div>
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
                {streamingBotText !== null && (() => {
                    const { cleanText: cleanStreamingText } = parseMessageSuggestions(streamingBotText);
                    return (
                        <div className="flex items-start gap-3 w-full animate-fade-in-up justify-start">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-lime-400 to-teal-500 flex-shrink-0 self-start">
                               <GraduationCapIcon className="w-full h-full p-1.5 text-white" />
                            </div>
                            <div className="flex flex-col max-w-[85%] sm:max-w-lg md:max-w-xl lg:max-w-2xl xl:max-w-3xl" style={{ alignItems: 'flex-start' }}>
                                <div className="p-3 px-4 rounded-2xl break-words bg-white text-gray-800 rounded-bl-none border border-gray-200">
                                    <div className="text-sm sm:text-base prose prose-sm max-w-none">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm, remarkMath]}
                                            rehypePlugins={[rehypeKatex]}
                                            components={{
                                                h1: ({node, ...props}) => <h1 className="text-xl font-bold text-gray-900 mb-3 mt-2" {...props} />,
                                                h2: ({node, ...props}) => <h2 className="text-lg font-bold text-gray-900 mb-2 mt-3" {...props} />,
                                                h3: ({node, ...props}) => <h3 className="text-base font-semibold text-gray-800 mb-2 mt-2" {...props} />,
                                                p: ({node, ...props}) => <p className="mb-3 last:mb-0 leading-relaxed text-gray-800" {...props} />,
                                                strong: ({node, ...props}) => <strong className="font-bold text-gray-900 bg-yellow-100 px-1 py-0.5 rounded" {...props} />,
                                                em: ({node, ...props}) => <em className="italic text-lime-700 font-medium" {...props} />,
                                                ul: ({node, ...props}) => <ul className="list-disc list-outside space-y-1.5 my-3 pl-5" {...props} />,
                                                ol: ({node, ...props}) => <ol className="list-decimal list-outside space-y-1.5 my-3 pl-5" {...props} />,
                                                li: ({node, ...props}) => <li className="text-gray-700 leading-relaxed pl-1" {...props} />,
                                                a: ({node, ...props}) => <a className="text-lime-600 hover:text-lime-700 underline font-medium" target="_blank" rel="noopener noreferrer" {...props} />,
                                                code: ({node, inline, ...props}: any) => 
                                                    inline ? (
                                                        <code className="bg-lime-50 text-lime-800 px-1.5 py-0.5 rounded text-xs font-mono border border-lime-200" {...props} />
                                                    ) : (
                                                        <code className="block bg-gray-900 text-gray-100 p-3 rounded-lg overflow-x-auto my-3 text-xs font-mono" {...props} />
                                                    ),
                                                pre: ({node, ...props}) => <pre className="bg-gray-900 rounded-lg overflow-hidden my-3" {...props} />,
                                                blockquote: ({node, ...props}) => <blockquote className="border-l-3 border-lime-500 bg-lime-50 pl-4 pr-3 py-2 my-3 rounded-r italic" {...props} />,
                                                table: ({node, ...props}) => <div className="overflow-x-auto my-3"><table className="min-w-full divide-y divide-gray-200 border border-gray-200 text-xs" {...props} /></div>,
                                                th: ({node, ...props}) => <th className="px-3 py-2 bg-lime-100 text-left font-semibold text-gray-900" {...props} />,
                                                td: ({node, ...props}) => <td className="px-3 py-2 border-t border-gray-200" {...props} />,
                                                hr: ({node, ...props}) => <hr className="my-4 border-gray-300" {...props} />,
                                            }}
                                        >
                                            {cleanStreamingText}
                                        </ReactMarkdown>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}
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
                </>
                )}
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
                
            </footer>

            <LimitExceededModal
                isOpen={showLimitModal}
                onClose={() => setShowLimitModal(false)}
                userProfile={userProfile}
                appSettings={appSettings}
                featureType={limitModalFeature}
                limitValue={limitModalData.limit}
                usedValue={limitModalData.used}
                price={limitModalData.price}
                batchCount={limitModalData.batchCount}
                addToast={addToast}
                onSuccessPurchase={() => {}}
                courseId={limitModalData.courseId}
            />

            {/* Video Tutorials bottom drawer */}
            <div className={`fixed inset-x-0 bottom-0 z-40 transform transition-transform duration-500 ease-in-out bg-white rounded-t-[2.5rem] shadow-2xl border-t border-gray-100 flex flex-col max-h-[80vh] min-h-[40vh] ${isTutorialsOpen ? 'translate-y-0' : 'translate-y-full'}`}>
                {/* Drag Handle & Close */}
                <div className="flex flex-col items-center py-3 border-b border-gray-100 shrink-0 relative">
                    <div className="w-12 h-1 bg-gray-200 rounded-full mb-2"></div>
                    <h3 className="text-base font-black uppercase tracking-widest text-slate-700">Video Tutorials</h3>
                    <button 
                        onClick={() => setIsTutorialsOpen(false)}
                        className="absolute right-6 top-3 text-gray-400 hover:text-gray-600 p-1 rounded-full bg-gray-50 border border-gray-100 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Drawer Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {tutorialsError ? (
                        <div className="flex flex-col items-center justify-center text-center py-8 px-4 bg-red-50 border border-red-100 rounded-2xl">
                            <span className="text-3xl mb-2">⚠️</span>
                            <h4 className="font-extrabold text-sm text-red-700">Failed to Load Video Tutorials</h4>
                            <p className="text-xs text-red-500 mt-1 font-semibold max-w-sm">{tutorialsError}</p>
                        </div>
                    ) : isTutorialsLoading ? (
                        <div className="space-y-4 py-8">
                            {[1, 2, 3].map(n => (
                                <div key={n} className="flex gap-4 p-4 border border-gray-100 rounded-2xl animate-pulse">
                                    <div className="w-24 h-16 bg-gray-100 rounded-xl shrink-0"></div>
                                    <div className="flex-1 space-y-2 py-1">
                                        <div className="h-4 bg-gray-100 rounded w-2/3"></div>
                                        <div className="h-3 bg-gray-100 rounded w-full"></div>
                                        <div className="h-3 bg-gray-100 rounded w-5/6"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {tutorials.map((video, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setActiveVideo(video)}
                                    className="flex items-start gap-4 p-4 border border-gray-200 hover:border-blue-300 hover:bg-blue-50/20 rounded-2xl transition-all text-left group w-full"
                                >
                                    {/* Video Thumbnail */}
                                    <div className="w-28 h-16 bg-gray-100 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm relative overflow-hidden group-hover:scale-105 transition-transform">
                                        {video.thumbnailUrl && !brokenThumbnails[video.thumbnailUrl] ? (
                                            <img 
                                                src={video.thumbnailUrl} 
                                                alt={video.title} 
                                                className="absolute inset-0 w-full h-full object-cover" 
                                                onError={() => {
                                                    if (video.thumbnailUrl) {
                                                        setBrokenThumbnails(prev => ({ ...prev, [video.thumbnailUrl!]: true }));
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <div className="absolute inset-0 bg-gradient-to-br from-[#009EE2] to-[#0070B8]" />
                                        )}
                                        <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                                            <svg className="w-6 h-6 text-white drop-shadow-md z-10" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-extrabold text-sm text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-1">{video.title}</h4>
                                        <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{video.description}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Backdrop for Drawer */}
            {isTutorialsOpen && (
                <div 
                    onClick={() => setIsTutorialsOpen(false)}
                    className="fixed inset-0 bg-black/20 z-30 backdrop-blur-xs transition-opacity"
                />
            )}

            {/* Custom Video Player Overlay */}
            {activeVideo && (
                <CustomVideoPlayer 
                    video={activeVideo} 
                    onClose={() => setActiveVideo(null)} 
                />
            )}

            {/* Message Action Context Menu */}
            {messageActionTarget && messageActionPosition && (
                <div 
                    className="fixed inset-0 z-50 bg-black/10"
                    onClick={() => { setMessageActionTarget(null); setMessageActionPosition(null); }}
                >
                    <div
                        ref={messageActionMenuRef}
                        onClick={e => e.stopPropagation()}
                        className="absolute w-[min(92vw,280px)] rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl"
                        style={{
                            left: `${Math.max(12, Math.min((messageActionPosition.x) - 140, window.innerWidth - 292))}px`,
                            top: `${Math.max(12, Math.min((messageActionPosition.y) - 60, window.innerHeight - 180))}px`
                        }}
                    >
                        <p className="px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">Message Actions</p>
                        <div className="space-y-1.5">
                            <button
                                type="button"
                                onClick={async () => {
                                    if (messageActionTarget.text) {
                                        await navigator.clipboard.writeText(messageActionTarget.text);
                                        addToast('Copied!', 'success');
                                    }
                                    setMessageActionTarget(null);
                                    setMessageActionPosition(null);
                                }}
                                className="w-full rounded-xl border border-gray-100 bg-white px-3 py-2 text-left text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                            >
                                📋 Copy message
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setForwardTargetContent(messageActionTarget.text || '');
                                    setForwardTargetType('text');
                                    setIsForwardModalOpen(true);
                                    setMessageActionTarget(null);
                                    setMessageActionPosition(null);
                                }}
                                className="w-full rounded-xl border border-gray-100 bg-white px-3 py-2 text-left text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                            >
                                ➤ Forward to Study Partner
                            </button>
                            {messageActionTarget.sender === 'bot' && messageActionTarget.text && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const textToIllustrate = messageActionTarget.text;
                                        setMessageActionTarget(null);
                                        setMessageActionPosition(null);
                                        void handleGenerateIllustration(textToIllustrate);
                                    }}
                                    disabled={isLoading || isIllustrating}
                                    className="w-full rounded-xl border border-gray-100 bg-white px-3 py-2 text-left text-sm font-semibold text-gray-800 transition hover:bg-gray-50 disabled:opacity-50"
                                >
                                    🎨 Visualize
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Forward Message Modal (inline for StudyGuide) */}
            {isForwardModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-gray-200 flex flex-col max-h-[75vh]">
                        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                            <div>
                                <h2 className="text-base font-bold text-gray-900">Forward Message</h2>
                                <p className="text-[11px] text-gray-500 mt-0.5">Select study partners to forward to.</p>
                            </div>
                            <button
                                onClick={() => { setIsForwardModalOpen(false); setForwardTargetContent(''); setSelectedRecipients([]); setForwardSearchQuery(''); }}
                                className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-bold transition"
                            >✕</button>
                        </div>
                        <div className="px-5 py-3.5 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
                            <span className="font-bold uppercase tracking-wider block text-[10px] mb-1">Preview</span>
                            <p className="truncate italic text-gray-600">{forwardTargetContent}</p>
                        </div>
                        <div className="p-4 border-b border-gray-100">
                            <input
                                type="text"
                                placeholder="Search partners..."
                                value={forwardSearchQuery}
                                onChange={e => setForwardSearchQuery(e.target.value)}
                                className="w-full bg-gray-50 text-sm px-4 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-lime-400/30 focus:border-lime-400 transition"
                            />
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
                            {allUsers.filter(u => studyPartners[u.uid] === true && u.uid !== userProfile.uid)
                                .filter(u => !forwardSearchQuery.trim() || (u.display_name || '').toLowerCase().includes(forwardSearchQuery.toLowerCase()))
                                .map(u => {
                                    const isChecked = selectedRecipients.includes(u.uid);
                                    return (
                                        <div
                                            key={u.uid}
                                            onClick={() => setSelectedRecipients(prev => isChecked ? prev.filter(id => id !== u.uid) : [...prev, u.uid])}
                                            className={`flex items-center gap-3 p-3 rounded-2xl border transition cursor-pointer select-none ${isChecked ? 'bg-lime-50 border-lime-400' : 'bg-white border-gray-100 hover:bg-gray-50'}`}
                                        >
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-lime-400 to-teal-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
                                                {(u.display_name || 'L')[0].toUpperCase()}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-sm text-gray-900 truncate">{u.display_name}</p>
                                                <p className="text-[10px] text-gray-500 truncate">{u.department_id || 'No Department'}</p>
                                            </div>
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${isChecked ? 'border-lime-500 bg-lime-500' : 'border-gray-300'}`}>
                                                {isChecked && <svg viewBox="0 0 24 24" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="4"><polyline points="20 6 9 17 4 12" /></svg>}
                                            </div>
                                        </div>
                                    );
                                })}
                            {allUsers.filter(u => studyPartners[u.uid] === true && u.uid !== userProfile.uid).length === 0 && (
                                <p className="text-center text-xs text-gray-400 italic py-8">No study partners yet. Add partners in Messenger.</p>
                            )}
                        </div>
                        <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-3 shrink-0">
                            <button
                                onClick={() => { setIsForwardModalOpen(false); setForwardTargetContent(''); setSelectedRecipients([]); setForwardSearchQuery(''); }}
                                className="flex-1 bg-white hover:bg-gray-100 border border-gray-200 text-gray-600 font-bold text-xs uppercase tracking-wider py-3 rounded-xl transition cursor-pointer"
                            >Cancel</button>
                            <button
                                disabled={selectedRecipients.length === 0}
                                onClick={async () => {
                                    await handleForwardMessage(selectedRecipients, forwardTargetContent, forwardTargetType);
                                    setIsForwardModalOpen(false);
                                    setForwardTargetContent('');
                                    setSelectedRecipients([]);
                                    setForwardSearchQuery('');
                                }}
                                className="flex-1 bg-lime-500 hover:bg-lime-600 text-white font-black text-xs uppercase tracking-wider py-3 rounded-xl transition cursor-pointer disabled:opacity-40 disabled:bg-gray-300 disabled:cursor-not-allowed"
                            >
                                Send ({selectedRecipients.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Share URL Modal */}
            {shareModalUrl && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-gray-200">
                        <h2 className="text-base font-bold text-gray-900 mb-1">Chat Shared! 🎉</h2>
                        <p className="text-xs text-gray-500 mb-4">Anyone with this link can view the shared chat session.</p>
                        <div className="flex gap-2">
                            <input
                                readOnly
                                value={shareModalUrl}
                                className="flex-1 min-w-0 bg-gray-50 border border-gray-200 text-xs text-gray-700 px-3 py-2.5 rounded-xl font-mono truncate"
                            />
                            <button
                                onClick={async () => {
                                    await navigator.clipboard.writeText(shareModalUrl);
                                    addToast('Copied!', 'success');
                                }}
                                className="shrink-0 bg-lime-500 hover:bg-lime-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition"
                            >Copy</button>
                        </div>
                        <button
                            onClick={() => setShareModalUrl(null)}
                            className="w-full mt-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs uppercase tracking-wider py-3 rounded-xl transition"
                        >Done</button>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- NEW LEARNING PATH COMPONENTS ---
const TopicNode: React.FC<{ topic: Topic, isCompleted: boolean, onSelect: () => void, onMarkComplete: () => void, index: number, pathColor: string, studyDurationSeconds?: number, isSaving?: boolean }> = ({ topic, isCompleted, onSelect, onMarkComplete, index, pathColor, studyDurationSeconds = 0, isSaving = false }) => {
    const isEven = index % 2 === 0;
    
    return (
        <div className="relative w-full py-12 flex items-center justify-center">
            {/* Vertical Connector Line */}
            <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 ${isCompleted ? 'bg-emerald' : 'bg-gray-200'} z-0`}></div>

            <div className={`w-full max-w-2xl flex items-center ${isEven ? 'flex-row' : 'flex-row-reverse'} relative z-10`}>
                {/* Content Side */}
                <div className={`w-1/2 px-8 ${isEven ? 'text-right' : 'text-left'}`}>
                    <div className={`group cursor-pointer inline-block`} onClick={onSelect}>
                            <div className={`flex items-center gap-3`}> 
                                <div>
                                    <h4 className={`text-sm font-bold uppercase tracking-widest ${isCompleted ? 'text-emerald' : 'text-gray-400 group-hover:text-gray-600'} transition-colors duration-300`}>
                                        {isCompleted ? 'Mastered' : 'Topic'}
                                    </h4>
                                    <p className={`mt-1 text-lg font-semibold leading-tight ${isCompleted ? 'text-gray-900' : 'text-gray-600 group-hover:text-gray-700'} transition-colors duration-300`}>
                                        {topic.topic_name}
                                    </p>
                                </div>
                                <div className="ml-2">
                                    <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full font-medium">{formatDuration(studyDurationSeconds)}</span>
                                </div>
                            </div>
                            <div className="mt-3 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isCompleted) {
                                            onMarkComplete();
                                        }
                                    }}
                                    disabled={isCompleted || isSaving}
                                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition ${isCompleted ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'} disabled:opacity-60`}
                                    aria-label={isCompleted ? `${topic.topic_name} completed` : `Mark ${topic.topic_name} complete`}
                                >
                                    <CheckCircleIcon className="w-4 h-4" />
                                    {isCompleted ? 'Completed' : isSaving ? 'Saving' : 'Mark complete'}
                                </button>
                            </div>
                        </div>
                </div>

                {/* Node Side */}
                <div className="relative flex items-center justify-center">
                    <button 
                        onClick={onSelect}
                        className={`group relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 transform hover:scale-105 active:scale-95
                            ${isCompleted 
                                ? 'bg-emerald text-white' 
                                : 'bg-white border-2 border-gray-200 text-gray-300 hover:border-gray-300'}`}
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
                        <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-emerald pointer-events-none"></div>
                    )}
                </div>

                {/* Empty Side for alignment */}
                <div className="w-1/2"></div>
            </div>
        </div>
    );
};

const CourseHeader: React.FC<{ 
    course: Course, 
    isExpanded: boolean, 
    onClick: () => void,
    isUnlocked: boolean,
    isExempt: boolean,
    onUnlock: () => void
}> = ({ course, isExpanded, onClick, isUnlocked, isExempt, onUnlock }) => {
    const courseLabel = course.course_code || course.course_id || course.course_name;

    return (
        <div className="w-full max-w-4xl mx-auto py-2">
            <div className={`w-full flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition`}>
                <div className="flex-1 flex items-center gap-3 cursor-pointer" onClick={() => {
                    if (isExempt || isUnlocked) {
                        onClick();
                    } else {
                        onUnlock();
                    }
                }}>
                    <div className="flex items-center gap-3">
                        <div className="text-sm font-black text-gray-700">{courseLabel}</div>
                        <div className="text-xs text-gray-500">{course.course_name}</div>
                    </div>
                </div>

                <div className="mt-2 sm:mt-0 flex items-center gap-3 justify-between">
                    {!isExempt && (
                        <>
                            {isUnlocked ? (
                                <span className="px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full font-black text-[9px] uppercase tracking-wider whitespace-nowrap">
                                    Unlocked Course
                                </span>
                            ) : (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onUnlock();
                                    }}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] uppercase tracking-wider transition shadow-sm active:scale-95 whitespace-nowrap"
                                >
                                    Unlock Course
                                </button>
                            )}
                        </>
                    )}
                    
                    {(isExempt || isUnlocked) && (
                        <button onClick={onClick} className="p-1.5 text-gray-400 hover:text-gray-600 transition">
                            <ChevronDownIcon className={`w-5 h-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// utility to format seconds into H:MM or M:SS
const formatDuration = (seconds: number): string => {
    if (!seconds || seconds <= 0) return '0m';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
}

// --- MAIN STUDY GUIDE COMPONENT ---
interface StudyGuideProps {
  userProfile: UserProfile;
  userProgress: UserProgress;
}
export const StudyGuide: React.FC<StudyGuideProps> = ({ userProfile, userProgress }) => {
  const [courses, setCourses] = useState<Course[]>(() => {
    return readCachedJson<Course[]>(`avelut_courses_${userProfile.uid}`, []);
  });
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const [selectedTopic, setSelectedTopic] = useState<(Topic & { courseName: string; courseId?: string; course_id?: string }) | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingTopicId, setIsMarkingTopicId] = useState<string | null>(null);
  const [filter, setFilter] = useState(() => ({
    searchTerm: '',
    semester: (userProfile.default_semester_tab || 'all') as 'all' | 'first' | 'second'
  }));
  const { addToast } = useToast();

  const [usageStats, setUsageStats] = useState<any>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitModalFeature, setLimitModalFeature] = useState<'visual_messages' | 'courses' | 'ai_requests_per_course' | 'exams'>('courses');
  const [limitModalData, setLimitModalData] = useState({ limit: 0, used: 0, price: 0, batchCount: 1 });
  const { settings: appSettings } = useAppSettings();

  useEffect(() => {
    const usageRef = dbRef(db, `users/${userProfile.uid}/usage_stats`);
    const unsubscribe = onValue(usageRef, (snapshot) => {
      setUsageStats(snapshot.val() || {});
    });
    return () => unsubscribe();
  }, [userProfile.uid]);

  const isUserExempt = !!(userProfile.is_admin || userProfile.use_personal_token || userProfile.subscription_status === 'personal_token');
  const isFreeUser = !isUserExempt && (userProfile?.subscription_status === 'free' || !userProfile?.subscription_status);

  useEffect(() => {
    const fetchCourses = async () => {
      const cached = readCachedJson<Course[]>(`avelut_courses_${userProfile.uid}`, []);
      if (cached && cached.length > 0) {
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }
      try {
        const normalizedUserDepartment = normalizeDepartmentValue(userProfile.department_id);
        const normalizedUserLevel = normalizeLevelValue(userProfile.level);

        if (!normalizedUserDepartment) {
            setCourses([]);
            setIsLoading(false);
            return;
        }

        let resolvedDepartmentData: any = null;

        const directDepartmentSnapshot = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
        const directDepartmentData = directDepartmentSnapshot.val();
        if (directDepartmentData) {
            resolvedDepartmentData = directDepartmentData;
        }

        if (!resolvedDepartmentData) {
            const snapshot = await get(dbRef(db, 'departments_data'));
            const departmentsData = snapshot.val();
            if (!departmentsData) {
                setCourses([]);
                setIsLoading(false);
                return;
            }

            resolvedDepartmentData = Object.entries(departmentsData).find(([departmentId, departmentData]: [string, any]) => (
                normalizeDepartmentValue(departmentId) === normalizedUserDepartment ||
                normalizeDepartmentValue(departmentData?.department_name) === normalizedUserDepartment
            ))?.[1];
        }

        const allDepartmentCourses = extractCoursesFromDepartmentData(resolvedDepartmentData);
        const coursesForLevel = allDepartmentCourses.filter((course) => (
            normalizeLevelValue(course.level) === normalizedUserLevel
        ));

        // Enrich each course with syllabus/topics from shared canonical path if available
        const enrichedCourses: Course[] = await Promise.all(
            coursesForLevel.map(async (course) => {
                try {
                    if (course.textbook_shared_key) {
                        const sharedRef = dbRef(db, `textbook_contexts/shared/${course.textbook_shared_key}`);
                        const sharedSnap = await get(sharedRef);
                        if (sharedSnap.exists()) {
                            const sharedVal = sharedSnap.val();
                            const syllabus = Array.isArray(sharedVal.syllabus) ? sharedVal.syllabus.map((t, i) => sanitizeTopicMetadata(t, i)) : [];
                            return { ...course, topics: syllabus };
                        }
                    }

                    // Fallback: per-department textbook context
                    const perDeptRef = dbRef(db, `textbook_contexts/${userProfile.department_id}/${course.level}/${course.course_name}`);
                    const perDeptSnap = await get(perDeptRef);
                    if (perDeptSnap.exists()) {
                        const val = perDeptSnap.val();
                        const syllabus = Array.isArray(val.syllabus) ? val.syllabus.map((t, i) => sanitizeTopicMetadata(t, i)) : [];
                        return { ...course, topics: syllabus };
                    }

                    return course;
                } catch (e) {
                    console.error('Error enriching course with textbook syllabus:', e);
                    return course;
                }
            })
        );

        setCourses(enrichedCourses);
        writeCachedJson(`avelut_courses_${userProfile.uid}`, enrichedCourses);
      } catch (err) {
        console.error("Error fetching courses:", err);
        addToast("Could not load study materials.", 'error');
      } finally {
        setIsLoading(false);
      }
    };
    fetchCourses();
  }, [userProfile.department_id, userProfile.level, addToast, userProfile.uid]);
  
  const toggleCourse = async (courseId: string) => {
    if (expandedCourses.has(courseId)) {
        setExpandedCourses(prev => {
            const newSet = new Set(prev);
            newSet.delete(courseId);
            return newSet;
        });
        return;
    }

    const isUnlockedInDb = usageStats?.unlocked_courses?.[courseId];
    if (isUserExempt || isUnlockedInDb) {
        setExpandedCourses(prev => {
            const newSet = new Set(prev);
            newSet.add(courseId);
            return newSet;
        });
        return;
    }

    // Limit course outline expansion by checking checkStudyGuideCoursesLimit
    const limitCheck = checkStudyGuideCoursesLimit(userProfile, usageStats, appSettings);
    if (!limitCheck.allowed) {
        setLimitModalFeature('courses');
        setLimitModalData({
            limit: limitCheck.limit,
            used: limitCheck.used,
            price: limitCheck.price,
            batchCount: 1
        });
        setShowLimitModal(true);
        return;
    }

    // Lock course in database
    try {
        const path = `users/${userProfile.uid}/usage_stats/unlocked_courses/${courseId}`;
        await update(dbRef(db), { [path]: true });
        addToast('New course outline unlocked successfully!', 'success');
        
        setExpandedCourses(prev => {
            const newSet = new Set(prev);
            newSet.add(courseId);
            return newSet;
        });
    } catch (e: any) {
        console.error(e);
        addToast('Failed to unlock course: ' + e.message, 'error');
    }
  };

  const handleMarkTopicComplete = async (course: Course, topic: Topic) => {
    if (userProgress[topic.topic_id]?.is_complete) return;
    setIsMarkingTopicId(topic.topic_id);
    try {
        const progressRef = dbRef(db, `user_progress/${userProfile.uid}/${topic.topic_id}`);
        const currentSnapshot = await get(progressRef);
        const currentData = currentSnapshot.val() || {};
        await update(progressRef, {
            is_complete: true,
            timestamp: Date.now(),
            study_duration_seconds: currentData.study_duration_seconds || 0,
            xp_earned: currentData.xp_earned || 0,
            course_id: course.course_id,
            course_name: course.course_name,
            department_id: userProfile.department_id,
            level: course.level,
        });
        addToast(`${topic.topic_name} marked complete.`, 'success');
    } catch (error) {
        console.error('Failed to mark topic complete:', error);
        addToast('Could not mark the topic as complete.', 'error');
    } finally {
        setIsMarkingTopicId(null);
    }
  };

  const filteredCourses = courses
    .map(course => {
        if (filter.semester !== 'all' && course.semester !== filter.semester) {
            return null;
        }

        const searchTerm = filter.searchTerm.trim().toLowerCase();
        if (!searchTerm) {
            return course;
        }

        const matchesCourse = [course.course_name, course.course_code, course.course_id]
            .filter(Boolean)
            .some(value => value!.toLowerCase().includes(searchTerm));

        const filteredTopics = course.topics.filter(topic => 
            [topic.topic_name, topic.topic_id, topic.topic_context]
                .filter(Boolean)
                .some(value => value!.toLowerCase().includes(searchTerm))
        );

        if (!matchesCourse && filteredTopics.length === 0) {
            return null;
        }

        return matchesCourse ? course : { ...course, topics: filteredTopics };
    })
    .filter((c): c is Course => c !== null);

  if (selectedTopic) {
    return (
      <LearningInterface
        userProfile={userProfile}
        topic={selectedTopic}
        onClose={() => setSelectedTopic(null)}
        usageStats={usageStats}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col w-full bg-white border border-gray-200 overflow-hidden rounded-2xl">
        <div className="flex-shrink-0 px-8 py-10 bg-gray-50 border-b border-gray-200">
            <div className="max-w-4xl mx-auto flex flex-col items-center text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald/10 text-emerald text-[10px] font-bold uppercase tracking-widest mb-4">
                    Your Learning Path
                </div>
                <h2 className="text-3xl md:text-4xl font-black text-gray-900 mb-4 tracking-tight">Knowledge Roadmap</h2>
                <p className="text-gray-500 text-lg max-w-lg">Master your curriculum topic by topic with personalized AI guidance.</p>
                
                <div className="mt-8 w-full flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 relative group">
                        <input 
                            type="text" 
                            placeholder="Find a topic..."
                            value={filter.searchTerm}
                            onChange={(e) => setFilter(f => ({ ...f, searchTerm: e.target.value }))}
                            className="w-full bg-white border border-gray-200 rounded-xl py-3 pl-12 pr-4 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-emerald focus:border-emerald focus:outline-none transition-all"
                        />
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-emerald transition-colors">
                           <SearchIcon className="w-5 h-5" />
                        </div>
                    </div>
                    <div className="bg-white p-1 rounded-xl flex border border-gray-200">
                        <button onClick={() => setFilter(f => ({ ...f, semester: 'first' }))} className={`px-6 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${filter.semester === 'first' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>1st Sem</button>
                        <button onClick={() => setFilter(f => ({ ...f, semester: 'second' }))} className={`px-6 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${filter.semester === 'second' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>2nd Sem</button>
                        <button onClick={() => setFilter(f => ({ ...f, semester: 'all' }))} className={`px-6 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all ${filter.semester === 'all' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>All</button>
                    </div>
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8 md:px-12">
            {isFreeUser && (
                <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl mb-6 text-sm text-slate-800 font-semibold max-w-4xl mx-auto flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 shrink-0 mt-0.5">⚠️</div>
                    <div>
                        <h4 className="font-bold text-amber-900 mb-0.5">Free / Custom Token Limit 🎓</h4>
                        {userProfile.selected_free_course_id ? (
                            <p className="text-[11px] text-amber-800 leading-relaxed font-semibold">
                                You are currently on the free/custom token tier. You have unlocked one course as your single active course. Upgrade to Premium to unlock all courses!
                            </p>
                        ) : (
                            <p className="text-[11px] text-amber-800 leading-relaxed font-semibold">
                                You can unlock and study <strong>exactly one course</strong> from your department curriculum to minimize API token costs. Please select the course you'd like to unlock from the list below.
                            </p>
                        )}
                    </div>
                </div>
            )}
            {isLoading ? (
                <StudyGuideSkeleton />
            ) : (
                filteredCourses.length > 0 ? (
                    <div className="max-w-4xl mx-auto space-y-6">
                        {filteredCourses.map(course => {
                            const isExpanded = expandedCourses.has(course.course_id);
                            const isUnlocked = isUserExempt || !!(usageStats?.unlocked_courses?.[course.course_id]);
                            return (
                                <div key={course.course_id} className="relative">
                                    <CourseHeader
                                        course={course}
                                        isExpanded={isExpanded}
                                        onClick={() => toggleCourse(course.course_id)}
                                        isUnlocked={isUnlocked}
                                        isExempt={isUserExempt}
                                        onUnlock={() => toggleCourse(course.course_id)}
                                    />
                                    <div className={`grid transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-8' : 'grid-rows-[0fr] opacity-0'}`}>
                                        <div className="overflow-hidden">
                                            <div className="relative pb-12">
                                                {course.topics.map((topic, index) => (
                                                    <TopicNode
                                                        key={topic.topic_id}
                                                        topic={topic}
                                                        isCompleted={userProgress[topic.topic_id]?.is_complete || false}
                                                        studyDurationSeconds={userProgress[topic.topic_id]?.study_duration_seconds || 0}
                                                        onSelect={() => setSelectedTopic({ ...topic, courseName: course.course_name, courseId: course.course_id, course_id: course.course_id })}
                                                        onMarkComplete={() => void handleMarkTopicComplete(course, topic)}
                                                        index={index}
                                                        pathColor="bg-gray-100"
                                                        isSaving={isMarkingTopicId === topic.topic_id}
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

        <LimitExceededModal
            isOpen={showLimitModal}
            onClose={() => setShowLimitModal(false)}
            userProfile={userProfile}
            appSettings={appSettings}
            featureType={limitModalFeature}
            limitValue={limitModalData.limit}
            usedValue={limitModalData.used}
            price={limitModalData.price}
            batchCount={limitModalData.batchCount}
            addToast={addToast}
            onSuccessPurchase={() => {}}
        />
    </div>
  );
};

// --- VIDEO TUTORIALS ICONS & CUSTOM PLAYER ---
const VideoIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const PlayIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
    </svg>
);

const PauseIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
);

const MuteIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
    </svg>
);

const VolumeHighIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M12 18.75V5.25L7.75 9.5H4.5v5h3.25L12 18.75z" />
    </svg>
);

const FullscreenExitIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 14h6v6m0-6L4 20M20 10h-6V4m0 6l6-6" />
    </svg>
);

const FullscreenEnterIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M4 4l6 6M20 8V4h-4m4 4l-6 6M4 16v4h4m-4 0l6-6M20 16v4h-4m4 0l-6-6" />
    </svg>
);

interface CustomVideoPlayerProps {
    video: { title: string; searchQuery: string; videoId?: string; thumbnailUrl?: string };
    onClose: () => void;
}

const CustomVideoPlayer: React.FC<CustomVideoPlayerProps> = ({ video, onClose }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(50);
    const [isReady, setIsReady] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    
    const playerRef = useRef<any>(null);
    const playerContainerRef = useRef<HTMLDivElement>(null);
    const playerId = useMemo(() => `yt-player-${Math.random().toString(36).substr(2, 9)}`, []);

    useEffect(() => {
        // Load YouTube API
        if (!(window as any).YT) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
            
            (window as any).onYouTubeIframeAPIReady = () => {
                initializePlayer();
            };
        } else {
            initializePlayer();
        }

        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            if (playerRef.current) {
                try {
                    if (typeof playerRef.current.destroy === 'function') {
                        playerRef.current.destroy();
                    }
                } catch (e) {
                    console.warn("Failed to destroy YouTube player during unmount:", e);
                }
                playerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const initializePlayer = () => {
        if (!(window as any).YT || !(window as any).YT.Player) {
            setTimeout(initializePlayer, 100);
            return;
        }

        const playerConfig: any = {
            height: '100%',
            width: '100%',
            playerVars: {
                controls: 0,
                disablekb: 1,
                fs: 0,
                modestbranding: 1,
                rel: 0,
                enablejsapi: 1,
                origin: window.location.origin,
                autoplay: 1
            },
            events: {
                onReady: (event: any) => {
                    setDuration(event.target.getDuration() || 0);
                    setVolume(event.target.getVolume() || 50);
                    setIsMuted(event.target.isMuted() || false);
                    setIsReady(true);
                    event.target.playVideo();
                    setIsPlaying(true);
                },
                onStateChange: (event: any) => {
                    const state = event.data;
                    if (state === 1) { // playing
                        setIsPlaying(true);
                    } else if (state === 2) { // paused
                        setIsPlaying(false);
                    } else if (state === 0) { // ended
                        setIsPlaying(false);
                    }
                    if (event.target.getDuration) {
                        setDuration(event.target.getDuration() || 0);
                    }
                }
            }
        };

        if (video.videoId) {
            playerConfig.videoId = video.videoId;
        } else {
            playerConfig.playerVars.listType = 'search';
            playerConfig.playerVars.list = video.searchQuery;
        }

        playerRef.current = new (window as any).YT.Player(playerId, playerConfig);
    };

    useEffect(() => {
        let interval: any;
        if (isPlaying && playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
            interval = setInterval(() => {
                if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
                    setCurrentTime(playerRef.current.getCurrentTime() || 0);
                }
            }, 250);
        }
        return () => clearInterval(interval);
    }, [isPlaying]);

    const formatTime = (seconds: number) => {
        if (isNaN(seconds) || seconds === undefined) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const togglePlay = () => {
        if (!playerRef.current) return;
        if (isPlaying) {
            playerRef.current.pauseVideo();
            setIsPlaying(false);
        } else {
            playerRef.current.playVideo();
            setIsPlaying(true);
        }
    };

    const toggleMute = () => {
        if (!playerRef.current) return;
        if (isMuted) {
            playerRef.current.unmute();
            setIsMuted(false);
        } else {
            playerRef.current.mute();
            setIsMuted(true);
        }
    };

    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTime = parseFloat(e.target.value);
        setCurrentTime(newTime);
        if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
            playerRef.current.seekTo(newTime, true);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVol = parseInt(e.target.value, 10);
        setVolume(newVol);
        if (playerRef.current && typeof playerRef.current.setVolume === 'function') {
            playerRef.current.setVolume(newVol);
            if (newVol > 0 && isMuted) {
                playerRef.current.unmute();
                setIsMuted(false);
            }
        }
    };

    const toggleFullscreen = () => {
        if (!playerContainerRef.current) return;
        if (!document.fullscreenElement) {
            playerContainerRef.current.requestFullscreen().catch(err => {
                console.error("Error entering fullscreen:", err);
            });
        } else {
            document.exitFullscreen();
        }
    };

    const handleClose = () => {
        if (playerRef.current) {
            try {
                if (typeof playerRef.current.destroy === 'function') {
                    playerRef.current.destroy();
                }
            } catch (e) {
                console.warn("Failed to destroy YouTube player on user close:", e);
            }
            playerRef.current = null;
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center z-50 p-4 md:p-8 animate-fade-in">
            <div 
                ref={playerContainerRef} 
                className="relative w-full max-w-4xl bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col group/player aspect-video"
            >
                {/* Header Overlay */}
                <div className="flex justify-between items-center p-4 bg-gradient-to-b from-black/80 to-transparent absolute top-0 inset-x-0 z-20 opacity-0 group-hover/player:opacity-100 transition-opacity duration-300">
                    <span className="text-white text-sm font-black tracking-wide truncate pr-4">{video.title}</span>
                    <button 
                        onClick={handleClose}
                        className="text-white/80 hover:text-white bg-black/40 hover:bg-black/60 p-2 rounded-full backdrop-blur-sm transition-all"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Video Frame Area */}
                <div className="w-full h-full bg-black flex items-center justify-center relative select-none">
                    <div id={playerId} className="w-full h-full pointer-events-none absolute inset-0 z-0"></div>
                    
                    {/* Cover div to completely block iframe interaction */}
                    <div className="absolute inset-0 bg-transparent z-10 pointer-events-auto" onClick={togglePlay} />

                    {/* Buffer/Loading Spinner */}
                    {!isReady && (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/80 gap-3">
                            <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                            <span className="text-xs text-slate-400 font-bold uppercase tracking-widest">Loading Tutorial...</span>
                        </div>
                    )}
                </div>

                {/* Custom Controls Panel */}
                <div className="absolute bottom-0 inset-x-0 p-4 md:p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col gap-3 z-20 opacity-0 group-hover/player:opacity-100 transition-opacity duration-300 select-none">
                    {/* Time Progress Line & Seek Slider */}
                    <div className="flex items-center gap-3 w-full">
                        <span className="text-xs font-mono text-slate-300">{formatTime(currentTime)}</span>
                        <input 
                            type="range"
                            min={0}
                            max={duration || 100}
                            value={currentTime}
                            onChange={handleSeekChange}
                            className="flex-1 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 focus:outline-none"
                        />
                        <span className="text-xs font-mono text-slate-300">{formatTime(duration)}</span>
                    </div>

                    {/* Action buttons bar */}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            {/* Play/Pause */}
                            <button 
                                onClick={togglePlay}
                                className="text-white hover:text-blue-400 transition-colors p-1"
                            >
                                {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
                            </button>

                            {/* Volume & Mute */}
                            <div className="flex items-center gap-2 group/volume">
                                <button 
                                    onClick={toggleMute}
                                    className="text-white hover:text-blue-400 transition-colors p-1"
                                >
                                    {isMuted || volume === 0 ? <MuteIcon className="w-5 h-5" /> : <VolumeHighIcon className="w-5 h-5" />}
                                </button>
                                <input 
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={isMuted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    className="w-16 md:w-24 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white hover:accent-blue-400 focus:outline-none"
                                />
                            </div>
                        </div>

                        {/* Fullscreen */}
                        <button 
                            onClick={toggleFullscreen}
                            className="text-white hover:text-blue-400 transition-colors p-1"
                        >
                            {isFullscreen ? <FullscreenExitIcon className="w-5 h-5" /> : <FullscreenEnterIcon className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

