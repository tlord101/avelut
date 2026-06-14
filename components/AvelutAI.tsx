import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { awardDailyStreak } from '../utils/streaks';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { get, onValue, push, ref as dbRef, serverTimestamp, set, update, remove } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
// @ts-ignore: Allow importing third-party CSS without type declarations
import 'katex/dist/katex.min.css';
import { db, storage } from '../firebase';
import type { Course, UserProfile } from '../types';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import { LimitExceededModal } from './LimitExceededModal';
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel } from '../utils/usage';
import { ChatIcon } from './icons/ChatIcon';
import { XIcon } from './icons/XIcon';
import { TrashIcon } from './icons/TrashIcon';
import { CopyIcon } from './icons/CopyIcon';

type AssistantSender = 'user' | 'assistant';

interface AssistantAttachment {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  isImage: boolean;
}

interface AssistantMessage {
  id: string;
  sender: AssistantSender;
  text: string;
  timestamp?: number;
  attachments?: AssistantAttachment[];
}

interface HistoryItem {
  id: string;
  title: string;
  lastUpdatedAt: number;
}

interface AvelutAIProps {
  userProfile: UserProfile;
}

const createMessageId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const truncateTitle = (text: string) => {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'New Chat';
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trim()}...` : cleaned;
};

const normalizeTitle = (text: string) => {
  const cleaned = text
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncateTitle(cleaned || 'New Chat');
};

const getHistoryFallbackTitle = (prompt: string, attachment: File | null) => (
  prompt || (attachment ? `Attachment: ${attachment.name}` : 'New Chat')
);

const isImageMimeType = (mimeType?: string, fileName?: string) => (
  Boolean(mimeType?.startsWith('image/')) || Boolean(fileName?.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i))
);

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    resolve(result.includes(',') ? result.split(',')[1] : result);
  };
  reader.onerror = () => reject(new Error(`Failed to read attachment: ${reader.error?.message || 'Unknown error'}`));
  reader.readAsDataURL(file);
});

const uploadChatAttachment = (
  userId: string,
  conversationId: string,
  file: File,
  index: number,
  onProgress?: (progress: number) => void
): Promise<AssistantAttachment> => {
  return new Promise((resolve, reject) => {
    const attachmentToken = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}_${index}`;
    const safeName = sanitizeFileName(file.name);
    const path = `assistant_attachments/${userId}/${conversationId}/${attachmentToken}_${safeName}`;
    const fileRef = storageRef(storage, path);
    const uploadTask = uploadBytesResumable(fileRef, file);

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = snapshot.totalBytes > 0 ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100 : 0;
        if (onProgress) {
          onProgress(Math.round(progress));
        }
      },
      (error) => {
        reject(error);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({
            id: attachmentToken,
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            url,
            isImage: isImageMimeType(file.type, file.name),
          });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
};

const getMimeType = (file: File): string => {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'mp3': return 'audio/mp3';
    case 'wav': return 'audio/wav';
    case 'ogg': return 'audio/ogg';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'txt': return 'text/plain';
    case 'html': return 'text/html';
    case 'css': return 'text/css';
    case 'js': return 'text/javascript';
    case 'json': return 'application/json';
    default: return 'application/octet-stream';
  }
};

const isSupportedInlineMimeType = (mimeType: string, fileName: string) => {
  const lowerName = fileName.toLowerCase();
  if (mimeType.startsWith('image/') || lowerName.match(/\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i)) {
    return true;
  }
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return true;
  }
  if (mimeType.startsWith('audio/') || lowerName.match(/\.(mp3|wav|aiff|aac|ogg|flac|m4a)$/i)) {
    return true;
  }
  if (mimeType.startsWith('video/') || lowerName.match(/\.(mp4|mpeg|mov|avi|flv|webm|3gp)$/i)) {
    return true;
  }
  return false;
};

const isTextFile = (mimeType: string, fileName: string) => {
  const lowerName = fileName.toLowerCase();
  const textExtensions = ['.txt', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.html', '.css', '.json', '.xml', '.csv', '.md', '.yaml', '.yml', '.ini', '.conf'];
  return mimeType.startsWith('text/') || textExtensions.some(ext => lowerName.endsWith(ext));
};

const readTextFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
});

const readCourseText = (courses: Course[], userLevel: string) => {
  if (!courses.length) return '';

  const lines: string[] = ['COURSE ACCESS:'];
  courses.forEach((course, index) => {
    const topicLines = (course.topics || []).slice(0, 20).map(topic => {
      const parts = [topic.topic_name, topic.topic_context, topic.start_point, topic.end_point].filter(Boolean);
      return `  - ${parts.join(' | ')}`;
    });

    lines.push([
      `Course ${index + 1}: ${course.course_code || course.course_id || course.course_name}`,
      `Title: ${course.course_name}`,
      `Level: ${course.level || userLevel}`,
      `Semester: ${course.semester || 'first'}`,
      topicLines.length ? `Topics:\n${topicLines.join('\n')}` : 'Topics: none recorded yet',
    ].join('\n'));
  });

  return lines.join('\n\n');
};

const mapSender = (sender: string | undefined): AssistantSender => {
  if (sender === 'user') return 'user';
  if (sender === 'assistant' || sender === 'ai' || sender === 'bot') return 'assistant';
  if (sender) console.warn('Unexpected chat sender value:', { sender, context: 'message mapping' });
  return 'assistant';
};

// Custom SVG Icons
const MenuIcon = ({ className = "w-6 h-6" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

const UpArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const MicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
  </svg>
);

const VisionIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ShareUploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export default function AvelutAI({ userProfile }: AvelutAIProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [streamingBotText, setStreamingBotText] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`avelut_ai_active_chat_id_${userProfile.uid}`) || null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (activeHistoryId) {
        localStorage.setItem(`avelut_ai_active_chat_id_${userProfile.uid}`, activeHistoryId);
      } else {
        localStorage.removeItem(`avelut_ai_active_chat_id_${userProfile.uid}`);
      }
    } catch (e) {
      console.warn('Failed to cache active chat ID:', e);
    }
  }, [activeHistoryId, userProfile.uid]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [courseContext, setCourseContext] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [statusText, setStatusText] = useState('Ready to help with math, science, and study plans.');
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitModalData, setLimitModalData] = useState({ balance: 0, cost: 0 });

  const { attemptApiCall } = useApiLimiter();
  const { settings: appSettings } = useAppSettings();
  const { addToast } = useToast();
  const geminiModel = getFeatureModel('chat_interaction', appSettings);

  const ai = useMemo(() => createAvelutAI(appSettings, userProfile), [appSettings, userProfile]);
  
  // Custom Input Bar States: 1 (Default), 2 (Typing)
  const [inputState, setInputState] = useState<number>(1);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState<boolean>(false);

  const sectionRef = useRef<HTMLElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const inputElementRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (sectionRef.current) {
      sectionRef.current.scrollTop = sectionRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  useEffect(() => {
    setIsHistoryLoading(true);
    const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);

    const unsubscribe = onValue(conversationsRef, snapshot => {
      if (!snapshot.exists()) {
        setHistory([]);
        setActiveHistoryId(null);
        setIsHistoryLoading(false);
        return;
      }

      const nextHistory: HistoryItem[] = [];
      snapshot.forEach(child => {
        const value = child.val() || {};
        nextHistory.push({
          id: child.key || '',
          title: normalizeTitle(value.title || 'New Chat'),
          lastUpdatedAt: Number(value.last_updated_at || value.created_at || 0),
        });
      });

      nextHistory.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
      setHistory(nextHistory);
      setIsHistoryLoading(false);
    });

    return unsubscribe;
  }, [userProfile.uid]);

  useEffect(() => {
    let isMounted = true;

    const loadCourseContext = async () => {
      try {
        const departmentSnapshot = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
        const departmentData = departmentSnapshot.val();
        if (!departmentData) {
          if (isMounted) setCourseContext('');
          return;
        }

        const courses: Course[] = Array.isArray(departmentData.course_list) ? departmentData.course_list : [];
        const contextParts: string[] = [];

        contextParts.push(`STUDENT DEPARTMENT: ${userProfile.department_id}`);
        contextParts.push(`STUDENT LEVEL: ${userProfile.level}`);
        contextParts.push(readCourseText(courses, userProfile.level));

        const sharedKeys = Array.from(new Set(courses.map(course => (course as Course & { textbook_shared_key?: string }).textbook_shared_key).filter(Boolean)));
        for (const sharedKey of sharedKeys) {
          const sharedSnapshot = await get(dbRef(db, `textbook_contexts/shared/${sharedKey}`));
          if (!sharedSnapshot.exists()) continue;
          const sharedData = sharedSnapshot.val();
          contextParts.push([
            `SHARED TEXTBOOK: ${(sharedData.course_name || sharedKey).toString()}`,
            `Level: ${sharedData.level || userProfile.level}`,
            `Syllabus: ${JSON.stringify(sharedData.syllabus || [])}`,
          ].join('\n'));
        }

        if (isMounted) {
          setCourseContext(contextParts.filter(Boolean).join('\n\n'));
        }
      } catch (error) {
        console.error('Failed to load assistant course context:', error);
        if (isMounted) setCourseContext('');
      }
    };

    void loadCourseContext();
    return () => {
      isMounted = false;
    };
  }, [userProfile.department_id, userProfile.level]);

  useEffect(() => {
    if (!activeHistoryId) {
      setMessages([]);
      return;
    }

    const messagesRef = dbRef(db, `chat_messages/${activeHistoryId}`);
    const unsubscribe = onValue(messagesRef, snapshot => {
      if (!snapshot.exists()) {
        setMessages([]);
        return;
      }

      const nextMessages: AssistantMessage[] = [];
      snapshot.forEach(child => {
        const value = child.val() || {};
        const rawAttachments = value.attachments;
        let attachments: AssistantAttachment[] | undefined;

        if (rawAttachments) {
          attachments = Array.isArray(rawAttachments)
            ? rawAttachments
            : Object.values(rawAttachments) as AssistantAttachment[];
        }

        nextMessages.push({
          id: child.key || createMessageId(),
          sender: mapSender(value.sender),
          text: value.text || '',
          timestamp: Number(value.timestamp || 0),
          attachments,
        });
      });

      nextMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      setMessages(nextMessages);
    });

    return unsubscribe;
  }, [activeHistoryId]);

  const conversationSummary = useMemo(() => {
    if (activeHistoryId) {
      const active = history.find(item => item.id === activeHistoryId);
      if (active) return active.title;
    }

    return messages.length > 0 ? 'Current chat' : 'New chat';
  }, [activeHistoryId, history, messages.length]);

  const clearAttachment = () => {
    setAttachments([]);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
  };

  const startNewChat = () => {
    setActiveHistoryId(null);
    setMessages([]);
    setInputValue('');
    clearAttachment();
    setStatusText('Started a new chat.');
    setIsSidebarOpen(false);
    setInputState(1);
  };

  const generateChatTitle = async (prompt: string, responseText: string) => {
    const fallbackTitle = normalizeTitle(prompt);
    if (!ai) return fallbackTitle;

    try {
      const result = await ai.models.generateContent({
        model: getFeatureModel('title_generation', appSettings),
        contents: [{
          role: 'user',
          parts: [{
            text: [
              'Create a short, simple, readable chat title for this tutoring conversation.',
              'Rules: maximum 6 words, no markdown, no quotes, no emojis, no trailing punctuation unless needed.',
              `Student message: ${prompt}`,
              `Assistant reply: ${responseText}`,
            ].join('\n'),
          }],
        }],
      });
      const titleText = getResponseText(result);
      return normalizeTitle((titleText || '').split('\n')[0] || fallbackTitle);
    } catch (error) {
      console.error('Failed to generate chat title:', error);
      return fallbackTitle;
    }
  };

  const handleSend = async (messageText?: string) => {
    const prompt = (messageText || inputValue).trim();
    const filesToSend = messageText ? [] : [...attachments];
    if ((!prompt && filesToSend.length === 0) || isSending) return;

    // Check message limits
    const featureCost = getFeatureCost('chat_interaction', appSettings);
    const limitCheck = checkAICredits(userProfile, featureCost, appSettings);
    if (!limitCheck.allowed) {
      setLimitModalData({
        balance: limitCheck.balance,
        cost: limitCheck.cost
      });
      setShowLimitModal(true);
      return;
    }

    const primaryAttachment = filesToSend[0] || null;
    const userText = prompt || getHistoryFallbackTitle(prompt, primaryAttachment);

    // Create local optimistic attachments to render in the user's bubble immediately
    const optimisticAttachments = filesToSend.map((file, index) => ({
      id: `optimistic-${Date.now()}-${index}`,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      url: URL.createObjectURL(file),
      isImage: isImageMimeType(file.type, file.name),
    }));

    const userMessage: AssistantMessage = {
      id: createMessageId(),
      sender: 'user',
      text: userText,
      timestamp: Date.now(),
      attachments: optimisticAttachments,
    };
    const nextMessages = [...messages, userMessage];
    const isNewConversation = !activeHistoryId;
    const activeConversation = history.find(item => item.id === activeHistoryId);
    const shouldGenerateTitle = isNewConversation ||
                               !activeConversation ||
                               activeConversation.title === 'New Chat' ||
                               activeConversation.title === 'Current chat';

    setMessages(nextMessages);
    setInputValue('');
    if (inputElementRef.current) {
      inputElementRef.current.style.height = 'auto';
    }
    clearAttachment(); // Clear immediately from the composer input bar!
    setIsSending(true);
    setStatusText('Thinking...');
    setInputState(1);

    try {
      if (!ai) {
        setMessages(prev => [
          ...prev,
          {
            id: createMessageId(),
            sender: 'assistant',
            text: 'Gemini is not configured yet. Ask an admin to save the Gemini API key in App Controls.',
          },
        ]);
        setStatusText('API key missing.');
        return;
      }

      let conversationId = activeHistoryId;
      const now = Date.now();
      if (!conversationId) {
        const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);
        const newConversationRef = push(conversationsRef);
        conversationId = newConversationRef.key;

        if (!conversationId) {
          throw new Error('Failed to create conversation: Firebase push() returned no key.');
        }

        await set(newConversationRef, {
          title: 'New Chat',
          created_at: now,
          last_updated_at: now,
        });
        setActiveHistoryId(conversationId);
        // Award streak for starting a new AI chat
        void awardDailyStreak(userProfile.uid);
      }

      const messagesRef = dbRef(db, `chat_messages/${conversationId}`);
      const storedAttachments: AssistantAttachment[] = [];
      const attachmentParts: any[] = [];

      for (let index = 0; index < filesToSend.length; index += 1) {
        const file = filesToSend[index];
        const mimeType = getMimeType(file);
        
        const prefix = filesToSend.length > 1 ? `[File ${index + 1}/${filesToSend.length}] ` : '';
        setUploadProgress(`Uploading ${prefix}${file.name} (0%)...`);
        setStatusText(`Uploading ${prefix}${file.name} (0%)...`);

        const storedAttachment = await uploadChatAttachment(
          userProfile.uid,
          conversationId,
          file,
          index,
          (percent) => {
            const msg = `Uploading ${prefix}${file.name} (${percent}%)...`;
            setUploadProgress(msg);
            setStatusText(msg);
          }
        );
        storedAttachments.push(storedAttachment);

        if (isSupportedInlineMimeType(mimeType, file.name)) {
          const data = await fileToBase64(file);
          attachmentParts.push({
            inlineData: {
              data,
              mimeType,
            },
          });
        } else if (isTextFile(mimeType, file.name)) {
          setUploadProgress(`Reading ${file.name}...`);
          try {
            const textContent = await readTextFile(file);
            attachmentParts.push({
              text: `[Content of attached file: ${file.name}]\n\n${textContent}`
            });
          } catch (readErr) {
            console.error(`Failed to read text file ${file.name}:`, readErr);
            const data = await fileToBase64(file);
            attachmentParts.push({
              inlineData: { data, mimeType }
            });
          }
        } else if (file.name.toLowerCase().endsWith('.docx')) {
          setUploadProgress(`Extracting text from ${file.name}...`);
          try {
            const mammoth = await import('mammoth');
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            attachmentParts.push({
              text: `[Content of attached file: ${file.name}]\n\n${result.value}`
            });
          } catch (docxErr) {
            console.error(`Failed to parse docx file ${file.name}:`, docxErr);
            const data = await fileToBase64(file);
            attachmentParts.push({
              inlineData: { data, mimeType }
            });
          }
        } else {
          const data = await fileToBase64(file);
          attachmentParts.push({
            inlineData: {
              data,
              mimeType,
            },
          });
        }
      }

      setUploadProgress(null);

      const storedUserMessage = {
        text: userText,
        sender: 'user',
        timestamp: serverTimestamp(),
        attachments: storedAttachments,
      };
      await push(messagesRef, storedUserMessage);

      const assistantMsgId = createMessageId();
      const initialAssistantMessage: AssistantMessage = {
        id: assistantMsgId,
        sender: 'assistant',
        text: '',
        timestamp: Date.now(),
      };
      setMessages([...nextMessages, initialAssistantMessage]);

      let responseText = '';
      const aiResult = await attemptApiCall(async () => {
        setStreamingBotText('');
        // Optimize payload: preserve system instructions but only send last 5 messages for context
        const contextMessages = nextMessages.slice(-5);

        // 💡 RAG: Retrieve relevant textbook context from Pinecone
        let retrievedContext = "";
        try {
          const searchResponse = await fetch('/api/textbooks/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: prompt, limit: 3 })
          });
          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            if (searchData.success && searchData.results?.length > 0) {
              retrievedContext = "\n\nRELEVANT TEXTBOOK CONTEXT:\n" +
                searchData.results.map((r: any) => `[From ${r.course_name}]: ${r.text}`).join('\n\n');
            }
          }
        } catch (searchErr) {
          console.warn("RAG retrieval failed:", searchErr);
        }

        const responseStream = await ai.models.generateContentStream({
          model: geminiModel || 'gemini-3.1-flash-lite',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: [
                    'You are AVELUT AI, a friendly, personalized study companion for university students.',
                    'Your messages must be extremely concise, precise, and short. Do not write long paragraphs or essays. Keep explanations bite-sized and deliver them bit-by-bit (maximum 2-4 sentences per response) to help students understand without being overwhelmed.',
                    'You function as a Retrieval-Augmented Generation (RAG) system, grounded in the student\'s specific academic roadmap/syllabus (provided under COURSE CONTEXT). Use this context directly to personalize explanations and relate concepts back to their coursework, level, and semester.',
                    'You can also answer abstract, general, or non-course related questions. When the student asks general or abstract topics, answer them thoroughly but tie them back to their academic context or field of study when relevant.',
                    'Answer simple, direct, and straightforward questions instantly and clearly, without unnecessary elaboration.',
                    'If the student asks disturbing questions, feels stressed, confused, or expresses study anxiety, act as a reassuring, supportive, and empathetic guiding assistant. Help break down concepts step-by-step, suggest study plans, and offer clear guidance.',
                    'When math is involved, use Markdown and LaTeX formatting with inline $...$ and display $$...$$ equations.',
                    'If the question needs calculations, show the steps and final formula neatly.',
                    courseContext ? `COURSE CONTEXT:\n${courseContext}` : '',
                    retrievedContext,
                    storedAttachments?.length ? `ATTACHMENTS: ${storedAttachments.map(i => i.name).join(', ')}` : '',
                    '',
                    `Conversation so far:\n${contextMessages.map(msg => `${msg.sender.toUpperCase()}: ${msg.text}`).join('\n\n')}`,
                  ].filter(Boolean).join('\n'),
                },
                ...attachmentParts,
              ],
            },
          ],
        });

        try {
          for await (const chunk of responseStream) {
            const chunkText = getResponseText(chunk);
            responseText += chunkText;
            setStreamingBotText(responseText);
          }
        } catch (streamError) {
          console.error('Error during response streaming:', streamError);
          throw streamError;
        }

        if (!responseText) {
          throw new Error('Gemini returned an empty response.');
        }

        return responseText.trim();
      });

      if (!aiResult.success) {
        console.error('Gemini assistant error:', aiResult.message);
        setStatusText('Unable to respond right now.');
        setMessages(prev => [
            ...prev,
            {
              id: createMessageId(),
              sender: 'assistant',
              text: 'Sorry, I ran into a problem generating that reply. Please try again.',
              timestamp: Date.now(),
            },
          ]);
        setIsSending(false);
        setStreamingBotText(null);
        return;
      }

      const finalResponseText = aiResult.data || 'I could not generate a response right now. Please try again.';
      
      // Deduct credits
      await deductAICredits(userProfile.uid, featureCost, 'AI Assistant Chat', appSettings);

      await push(messagesRef, {
        text: finalResponseText,
        sender: 'assistant',
        timestamp: serverTimestamp(),
      });

      // Clear streaming state ONLY after the Firebase push is initiated
      // This reduces the "flicker" where the response disappears before syncing back.
      setStreamingBotText(null);
      setIsSending(false);

      const updates: { title?: string; last_updated_at: number } = {
        last_updated_at: 0,
      };
      if (shouldGenerateTitle) {
        updates.title = await generateChatTitle(userText, finalResponseText);
      }

      updates.last_updated_at = Date.now();
      await update(dbRef(db, `chat_conversations/${userProfile.uid}/${conversationId}`), updates);

      setStatusText('Response ready.');
    } catch (error) {
      console.error('Gemini assistant error:', error);
      setMessages(prev => [
        ...prev,
        {
          id: createMessageId(),
          sender: 'assistant',
          text: 'Sorry, I ran into a problem generating that reply. Please try again.',
        },
      ]);
      setStatusText('Unable to respond right now.');
    } finally {
      setIsSending(false);
      setStreamingBotText(null);
      setUploadProgress(null);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (val.length > 0) {
      setInputState(2);
    } else {
      setInputState(1);
    }

    // Auto-expand height
    const target = e.target;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
  };

  const handleAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setAttachments(prev => [...prev, ...files]);
    setStatusText(`${files.length} attachment${files.length !== 1 ? 's' : ''} ready.`);
    event.target.value = '';
  };

  return (
    <div className="h-full min-h-0 overflow-hidden bg-[#060814]">
      <div className="mx-auto flex h-full min-h-0 max-w-7xl overflow-hidden bg-[#0a0d1a]/90 backdrop-blur md:rounded-[2rem] md:border md:border-neutral-800/50 md:shadow-[0_20px_80px_rgba(0,0,0,0.6)]">
        
        {/* Sidebar */}
        <aside className={`${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 w-[88vw] max-w-sm border-r border-neutral-800/40 bg-[#0d1122] p-5 shadow-2xl transition-transform duration-300 md:static md:z-auto md:w-80 md:translate-x-0 md:shadow-none`}>
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500">AVELUT</p>
              <h2 className="mt-1 text-xl font-bold text-slate-100">Assistant history</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-full border border-neutral-800 p-2 text-slate-400 md:hidden"
              aria-label="Close assistant history"
              title="Close assistant history"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={startNewChat}
            className="mb-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            <PlusIcon />
            New chat
          </button>

          <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-220px)]">
            {isHistoryLoading ? (
              <div className="rounded-2xl border border-neutral-800 bg-[#12182e] px-4 py-3 text-sm text-slate-400">
                Loading chat history...
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-800 bg-[#12182e] px-4 py-6 text-sm text-slate-400 text-center">
                Your saved chats will appear here.
              </div>
            ) : (
              history.map(item => (
                <div key={item.id} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveHistoryId(item.id);
                      setIsSidebarOpen(false);
                      setStatusText(`Opened ${item.title}.`);
                    }}
                    className={`flex-1 text-left rounded-2xl border px-4 py-3 transition ${activeHistoryId === item.id ? 'border-emerald-500/50 bg-[#16223f]' : 'border-neutral-800 bg-[#12182e] hover:border-neutral-700 hover:bg-[#18203c]'}`}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Recent chat</p>
                    <p className="mt-1 text-sm font-medium text-slate-200 truncate">{item.title}</p>
                  </button>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`Delete "${item.title}" from assistant history?`)) return;
                      try {
                        await remove(dbRef(db, `chat_conversations/${userProfile.uid}/${item.id}`));
                        await remove(dbRef(db, `chat_messages/${item.id}`));
                        if (activeHistoryId === item.id) {
                          setActiveHistoryId(null);
                          setMessages([]);
                        }
                        setStatusText(`Deleted ${item.title}.`);
                      } catch (err) {
                        console.error('Failed to delete history item:', err);
                        setStatusText('Could not delete chat.');
                      }
                    }}
                    className="p-2 mt-2 rounded-full text-red-400 hover:bg-red-950/30"
                    aria-label={`Delete ${item.title}`}
                    title={`Delete ${item.title}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {isSidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            aria-label="Close assistant history overlay"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Main Content Area */}
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#060814]">
          <header className="flex items-center justify-between border-b border-neutral-800/40 px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="rounded-2xl border border-neutral-800 bg-[#0d1122] p-2 text-slate-300 md:hidden"
                aria-label="Open assistant history"
                title="Open assistant history"
              >
                <MenuIcon className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500">AVELUT AI</p>
                <h1 className="text-lg font-bold text-slate-100 sm:text-2xl truncate max-w-[200px] sm:max-w-md">{conversationSummary}</h1>
              </div>
            </div>
            <div className="rounded-full bg-emerald-950/50 border border-emerald-800/30 px-3 py-1 text-xs font-semibold text-emerald-400">
              {statusText}
            </div>
          </header>

          {/* Messages List Container */}
          <section ref={sectionRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-4 sm:px-6">
            {messages.length === 0 ? (
              <div className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-6 py-16 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-600 text-white shadow-lg">
                  <ChatIcon className="h-10 w-10" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-100">Ask AVELUT anything</h2>
                  <p className="mt-2 max-w-xl text-slate-400">
                    Get step-by-step answers with clean LaTeX for equations, formulas, and proofs.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                {messages.map((message, idx) => {
                  // If this is the last bot message and it's redundant with streaming, hide it temporarily
                  if (streamingBotText !== null &&
                      message.sender === 'assistant' &&
                      idx === messages.length - 1 &&
                      message.text.length >= (streamingBotText?.length || 0)) {
                    return null;
                  }

                  return (
                  <div
                    key={message.id}
                    className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`px-4 py-3 shadow-sm ${
                        message.sender === 'user'
                          ? 'max-w-[76%] rounded-3xl bg-emerald-600 text-white'
                          : 'w-[90%] max-w-[90%] rounded-3xl border border-neutral-800/60 bg-[#0e1227] text-slate-200'
                      }`}
                    >
                      {message.attachments && message.attachments.length > 0 && (
                        <div className={`mb-3 grid gap-2 ${message.attachments.some(item => item.isImage) ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                          {message.attachments.map(attachmentItem => (
                            <a
                              key={attachmentItem.id}
                              href={attachmentItem.url}
                              target="_blank"
                              rel="noreferrer"
                              className={`overflow-hidden rounded-2xl border ${message.sender === 'user' ? 'border-white/20 bg-white/10 text-white' : 'border-neutral-800 bg-[#131935] text-slate-300'}`}
                            >
                              {attachmentItem.isImage ? (
                                <img src={attachmentItem.url} alt={attachmentItem.name} className="max-h-56 w-full object-cover" />
                              ) : (
                                <div className="flex items-center gap-3 px-4 py-3">
                                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${message.sender === 'user' ? 'bg-white/15' : 'bg-[#060814]'} text-[10px] font-black uppercase`}>
                                    DOC
                                  </div>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold">{attachmentItem.name}</p>
                                    <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Open attachment</p>
                                  </div>
                                </div>
                              )}
                            </a>
                          ))}
                        </div>
                      )}
                      {message.sender === 'assistant' ? (
                        <>
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex]}
                            components={{
                              p: ({ node, ...props }) => <p className="mb-3 last:mb-0 leading-relaxed text-slate-200" {...props} />,
                              ul: ({ node, ...props }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-slate-200" {...props} />,
                              ol: ({ node, ...props }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-slate-200" {...props} />,
                              li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
                              strong: ({ node, ...props }) => <strong className="font-semibold text-emerald-400" {...props} />,
                              pre: ({ node, ...props }) => <pre className="mb-3 overflow-x-auto rounded-2xl bg-[#050711] p-4 text-sm text-slate-100 border border-neutral-800/40" {...props} />,
                            }}
                          >
                            {message.text}
                          </ReactMarkdown>
                          <div className="mt-4 flex justify-end border-t border-neutral-800/40 pt-2">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(message.text);
                                  addToast('Copied to clipboard', 'success');
                                } catch (err) {
                                  addToast('Failed to copy', 'error');
                                }
                              }}
                              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 transition hover:bg-neutral-800 hover:text-emerald-400 active:scale-95"
                              aria-label="Copy message"
                              title="Copy message"
                            >
                              <CopyIcon className="h-3.5 w-3.5" />
                              Copy
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                      )}
                    </div>
                  </div>
                ); })}

                {streamingBotText !== null && (
                  <div className="flex justify-start">
                    <div className="w-[90%] max-w-[90%] rounded-3xl border border-neutral-800/60 bg-[#0e1227] text-slate-200 px-4 py-3 shadow-sm">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          p: ({ node, ...props }) => <p className="mb-3 last:mb-0 leading-relaxed text-slate-200" {...props} />,
                          ul: ({ node, ...props }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-slate-200" {...props} />,
                          ol: ({ node, ...props }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-slate-200" {...props} />,
                          li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-semibold text-emerald-400" {...props} />,
                          pre: ({ node, ...props }) => <pre className="mb-3 overflow-x-auto rounded-2xl bg-[#050711] p-4 text-sm text-slate-100 border border-neutral-800/40" {...props} />,
                        }}
                      >
                        {streamingBotText}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {isSending && streamingBotText === null && (
                  <div className="flex justify-start">
                    <div className="rounded-3xl border border-neutral-800 bg-[#0e1227] px-4 py-3 text-sm text-slate-400 shadow-sm">
                      {uploadProgress ? (
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                          <span>{uploadProgress}</span>
                        </div>
                      ) : (
                        "Thinking..."
                      )}
                    </div>
                  </div>
                )}
                {/* Scroll anchor handled by container ref */}
              </div>
            )}
          </section>

          {/* Integrated AVELUT Input Layout Panel */}
          <footer className="w-full bg-[#060814] pb-[92px] md:pb-4 px-4 z-30 shrink-0">
            <div className="w-full max-w-xl mx-auto transition-all duration-300 mb-2.5">
              
              {/* Attachment Preview */}
              {attachments.length > 0 && (
                <div className="mb-2 mx-auto max-w-md flex items-center justify-between rounded-xl bg-[#1e1f20] border border-neutral-800/80 px-3 py-2 text-xs text-slate-300">
                  <span className="truncate flex-1 pr-2">{attachments[0].name}</span>
                  <button type="button" onClick={clearAttachment} className="text-red-400 hover:text-red-300 transition" aria-label="Remove attachment">
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* STATES 1, 2, 3: Stadium Input Box Bar */}
              {inputState !== 4 && (
                <div className="relative w-full min-h-[64px] bg-[#1e1f20] rounded-[32px] flex items-center justify-between pl-4 pr-2 border border-neutral-800/50 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                  
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                      disabled={isSending}
                      className={`text-white hover:opacity-80 transition active:scale-95 shrink-0 flex items-center justify-center w-8 h-8 disabled:opacity-40 ${showAttachmentMenu ? 'bg-neutral-800 rounded-full' : ''}`}
                      aria-label="Upload attachment"
                      title="Upload attachment"
                    >
                      <PlusIcon />
                    </button>

                    {showAttachmentMenu && (
                      <div className="absolute bottom-12 left-0 w-48 bg-[#1e1f20] border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200 z-50">
                        <button
                          type="button"
                          onClick={() => {
                            if (attachmentInputRef.current) {
                              attachmentInputRef.current.accept = "image/*";
                              attachmentInputRef.current.click();
                            }
                            setShowAttachmentMenu(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm text-white hover:bg-neutral-800 transition-colors flex items-center gap-3"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-emerald-400">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                          Upload Image
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (attachmentInputRef.current) {
                              attachmentInputRef.current.accept = "application/pdf";
                              attachmentInputRef.current.click();
                            }
                            setShowAttachmentMenu(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm text-white hover:bg-neutral-800 transition-colors flex items-center gap-3"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-red-400">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                            <polyline points="10 9 9 9 8 9" />
                          </svg>
                          Upload PDF
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 mx-2 relative flex items-center min-h-[44px]">
                    {(inputState === 1 || inputState === 2) ? (
                      <textarea
                        ref={inputElementRef}
                        rows={1}
                        value={inputValue}
                        onChange={handleTextChange}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void handleSend();
                          }
                        }}
                        placeholder="Ask AVELUT anything..."
                        className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-sm focus:outline-none resize-none py-2.5 max-h-[180px] overflow-y-auto"
                        style={{ height: 'auto' }}
                      />
                    ) : (
                      <div className="flex items-center justify-start gap-[4px] py-1 select-none overflow-hidden w-full h-full pl-1">
                        {[...Array(15)].map((_, i) => {
                          const animatedHeights = ["h-3", "h-2", "h-4", "h-3", "h-5", "h-3", "h-4", "h-2", "h-4", "h-5", "h-3", "h-2", "h-4", "h-3", "h-2"];
                          return (
                            <div 
                              key={i} 
                              style={{ animationDelay: `${i * 0.08}s` }}
                              className={`w-[2.2px] ${animatedHeights[i]} bg-neutral-300 rounded-full opacity-90 animate-voice-bar-pulse`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-[9px] shrink-0">
                    {(inputState === 1 || inputState === 2) && (
                      <button 
                        type="button"
                        onClick={() => setInputState(3)}
                        className="text-white hover:opacity-85 transition active:scale-90 flex items-center justify-center w-9 h-9"
                        aria-label="Start voice input"
                        title="Start voice input"
                      >
                        <MicIcon />
                      </button>
                    )}

                    {inputState === 3 && (
                      <button 
                        type="button"
                        onClick={() => setInputState(1)}
                        className="w-[42px] h-[42px] bg-[#27282b]/80 hover:bg-[#2e3034] rounded-full flex items-center justify-center text-white transition active:scale-90"
                        aria-label="Stop voice input"
                        title="Stop voice input"
                      >
                        <StopIcon />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (inputState === 1 && !inputValue.trim() && attachments.length === 0 && !isSending) {
                          setInputState(4);
                        } else {
                          void handleSend();
                        }
                      }}
                      disabled={isSending || (inputState !== 1 && inputState !== 2 && inputState !== 3) || (inputState === 2 && !inputValue.trim())}
                      className="w-11 h-11 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-md transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={inputState === 1 && !inputValue.trim() ? "Enter live mode" : "Send message"}
                      title={inputState === 1 && !inputValue.trim() ? "Enter live mode" : "Send message"}
                    >
                      {inputState === 1 && !inputValue.trim() ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                        </svg>
                      ) : (
                        <UpArrowIcon />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* STATE 4: Fullscreen Live mode controls selection panel */}
              {inputState === 4 && (
                <div className="w-full flex items-center justify-between px-2 py-4 animate-fade-in select-none bg-[#101114] rounded-3xl border border-neutral-800/40 p-4 shadow-xl">
                  <button
                    type="button"
                    className="w-[52px] h-[52px] bg-[#1e1f20] hover:bg-[#2a2b2e] rounded-full flex items-center justify-center text-white transition active:scale-90 shadow-md"
                    aria-label="Vision search"
                    title="Vision search"
                  >
                    <VisionIcon />
                  </button>

                  <button
                    type="button"
                    className="w-[52px] h-[52px] bg-[#1e1f20] hover:bg-[#2a2b2e] rounded-full flex items-center justify-center text-white transition active:scale-90 shadow-md"
                    aria-label="Share screen or upload"
                    title="Share screen or upload"
                  >
                    <ShareUploadIcon />
                  </button>

                  <div className="relative w-[114px] h-[64px] bg-gradient-to-b from-[#08080a] to-[#0d0f14] rounded-full overflow-hidden border border-neutral-800/70 flex items-center justify-center shadow-lg">
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[86px] h-[18px] bg-[#38bdf8] rounded-full blur-[8px] opacity-80 animate-ambient-pulse" />
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[82px] h-[4px] bg-[#60a5fa] rounded-full opacity-90" />
                  </div>

                  <button
                    type="button"
                    className="w-[52px] h-[52px] bg-[#1e1f20] hover:bg-[#2a2b2e] rounded-full flex items-center justify-center text-white transition active:scale-90 shadow-md"
                    aria-label="Toggle live microphone"
                    title="Toggle live microphone"
                  >
                    <MicIcon />
                  </button>

                  <button 
                    type="button"
                    onClick={() => setInputState(1)}
                    className="w-[52px] h-[52px] bg-[#1e1f20] hover:bg-red-950/20 rounded-full flex items-center justify-center text-white transition active:scale-90 shadow-md"
                    aria-label="Exit live mode"
                    title="Exit live mode"
                  >
                    <XIcon className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>
          </footer>
        </main>
      </div>

      <LimitExceededModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        userProfile={userProfile}
        appSettings={appSettings}
        cost={limitModalData.cost}
        balance={limitModalData.balance}
        addToast={addToast}
        onSuccessPurchase={() => {}}
      />

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}
