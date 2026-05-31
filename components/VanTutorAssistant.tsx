import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { get, onValue, push, ref as dbRef, serverTimestamp, set, update, remove } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import 'katex/dist/katex.min.css';
import { db, storage } from '../firebase';
import type { Course, UserProfile } from '../types';
import { ChatIcon } from './icons/ChatIcon';
import { XIcon } from './icons/XIcon';
import { TrashIcon } from './icons/TrashIcon';

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

interface VanTutorAssistantProps {
  userProfile: UserProfile;
}

const ai = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;
const ASSISTANT_MODEL = 'gemini-2.5-flash';
const LIVE_MODEL = 'models/gemini-3.1-flash-live-preview';
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

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    resolve(result.includes(',') ? result.split(',')[1] : result);
  };
  reader.onerror = () => reject(new Error(`Failed to read audio chunk: ${reader.error?.message || 'Unknown error'}`));
  reader.readAsDataURL(blob);
});

const uploadChatAttachment = async (userId: string, conversationId: string, file: File, index: number) => {
  const attachmentToken = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}_${index}`;
  const safeName = sanitizeFileName(file.name);
  const path = `assistant_attachments/${userId}/${conversationId}/${attachmentToken}_${safeName}`;
  const fileRef = storageRef(storage, path);
  const snapshot = await uploadBytes(fileRef, file);
  const url = await getDownloadURL(snapshot.ref);
  return {
    id: attachmentToken,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    url,
    isImage: isImageMimeType(file.type, file.name),
  } satisfies AssistantAttachment;
};

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
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

const MicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[22px] h-[22px]">
    <rect x="9" y="3" width="6" height="11" rx="3" strokeWidth="1.8" />
    <path d="M5 10c0 3.866 3.134 7 7 7s7-3.134 7-7" strokeLinecap="round" />
    <line x1="12" y1="17" x2="12" y2="21" strokeLinecap="round" />
  </svg>
);

const WaveformIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <rect x="7" y="8" width="2" height="8" rx="1" />
    <rect x="11" y="4" width="2" height="16" rx="1" />
    <rect x="15" y="8" width="2" height="8" rx="1" />
  </svg>
);

const UpArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[18px] h-[18px]">
    <rect x="7" y="7" width="10" height="10" rx="2" />
  </svg>
);

const VisionIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
    <rect x="3" y="6" width="15" height="12" rx="3.5" />
    <path d="M18 10c1.2 0 2 .8 2 2s-.8 2-2 2" />
    <circle cx="10.5" cy="12" r="3" />
  </svg>
);

const ShareUploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
    <rect x="5" y="9" width="14" height="10" rx="2" />
    <path d="M12 13V3M12 3l-3.5 3.5M12 3l3.5 3.5" />
  </svg>
);

const CloseXIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function VanTutorAssistant({ userProfile }: VanTutorAssistantProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [courseContext, setCourseContext] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [statusText, setStatusText] = useState('Ready to help with math, science, and study plans.');
  
  // Custom Input Bar States: 1 (Default), 2 (Typing), 3 (Listening), 4 (Ambient/Live Voice)
  const [inputState, setInputState] = useState<number>(1);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const inputElementRef = useRef<HTMLInputElement>(null);
  const liveSessionRef = useRef<any | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      setActiveHistoryId(current => current && nextHistory.some(item => item.id === current) ? current : null);
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
        nextMessages.push({
          id: child.key || createMessageId(),
          sender: mapSender(value.sender),
          text: value.text || '',
          timestamp: Number(value.timestamp || 0),
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
        model: ASSISTANT_MODEL,
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
      return normalizeTitle((result.text || '').split('\n')[0] || fallbackTitle);
    } catch (error) {
      console.error('Failed to generate chat title:', error);
      return fallbackTitle;
    }
  };

  const handleSend = async () => {
    const prompt = inputValue.trim();
    if ((!prompt && attachments.length === 0) || isSending) return;

    const primaryAttachment = attachments[0] || null;
    const userText = prompt || getHistoryFallbackTitle(prompt, primaryAttachment);
    const previousMessages = messages;
    const userMessage: AssistantMessage = {
      id: createMessageId(),
      sender: 'user',
      text: userText,
      timestamp: Date.now(),
    };
    const nextMessages = [...messages, userMessage];
    const isNewConversation = !activeHistoryId;
    const activeConversation = history.find(item => item.id === activeHistoryId);
    const shouldGenerateTitle = isNewConversation || !activeConversation || activeConversation.title === 'New Chat';

    setMessages(nextMessages);
    setInputValue('');
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
            text: 'Gemini is not configured yet. Add the app GEMINI_API_KEY to the .env to enable assistant replies.',
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
      }

      const messagesRef = dbRef(db, `chat_messages/${conversationId}`);
      const storedAttachments: AssistantAttachment[] = [];
      const attachmentParts: Array<{ inlineData: { data: string; mimeType: string } }> = [];

      for (let index = 0; index < attachments.length; index += 1) {
        const file = attachments[index];
        const storedAttachment = await uploadChatAttachment(userProfile.uid, conversationId, file, index);
        storedAttachments.push(storedAttachment);

        const data = await fileToBase64(file);
        attachmentParts.push({
          inlineData: {
            data,
            mimeType: file.type || 'application/octet-stream',
          },
        });
      }

      const storedUserMessage = {
        text: userText,
        sender: 'user',
        timestamp: serverTimestamp(),
        attachments: storedAttachments,
      };
      await push(messagesRef, storedUserMessage);

      const result = await ai.models.generateContent({
        model: ASSISTANT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  'You are VanTutorAssistant, a friendly study companion for university students.',
                  'Answer clearly, encourage the learner, and keep explanations concise but complete.',
                  'You have full access to the learner\'s course context and should ground answers in it when relevant.',
                  'When math is involved, use Markdown and LaTeX formatting with inline $...$ and display $$...$$ equations.',
                  'If the question needs calculations, show the steps and final formula neatly.',
                  courseContext ? `COURSE CONTEXT:\n${courseContext}` : '',
                  storedAttachments.length ? `ATTACHMENTS: ${storedAttachments.map(item => item.name).join(', ')}` : '',
                  '',
                  `Conversation so far:\n${nextMessages.map(msg => `${msg.sender.toUpperCase()}: ${msg.text}`).join('\n\n')}`,
                ].filter(Boolean).join('\n'),
              },
              ...attachmentParts,
            ],
          },
        ],
      });

      const responseText = (result.text || '').trim() || 'I could not generate a response right now. Please try again.';
      const assistantMessage: AssistantMessage = {
        id: createMessageId(),
        sender: 'assistant',
        text: responseText,
        timestamp: Date.now(),
      };
      await push(messagesRef, {
        text: responseText,
        sender: 'assistant',
        timestamp: serverTimestamp(),
      });

      const updates: { title?: string; last_updated_at: number } = {
        last_updated_at: 0,
      };
      if (shouldGenerateTitle) {
        updates.title = await generateChatTitle(userText, responseText);
      }

      updates.last_updated_at = Date.now();
      await update(dbRef(db, `chat_conversations/${userProfile.uid}/${conversationId}`), updates);

      setMessages([...messages, { ...userMessage, attachments: storedAttachments }, assistantMessage]);
      setStatusText('Response ready.');
      clearAttachment();
    } catch (error) {
      console.error('Gemini assistant error:', error);
      setMessages([
        ...previousMessages,
        {
          id: createMessageId(),
          sender: 'assistant',
          text: 'Sorry, I ran into a problem generating that reply. Please try again.',
        },
      ]);
      setStatusText('Unable to respond right now.');
    } finally {
      setIsSending(false);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (val.length > 0) {
      setInputState(2);
    } else {
      setInputState(1);
    }
  };

  const handleLiveServerMessage = async (msg: any) => {
    try {
      // Log for debugging; server message shapes vary between previews
      console.debug('Live server message:', msg);
      const serverContent = msg?.serverContent;
      if (!serverContent) return;

      // Preferred textual content locations
      const text = serverContent?.text || serverContent?.transcript || serverContent?.output_text;
      if (text) {
        const assistantMessage: AssistantMessage = {
          id: createMessageId(),
          sender: 'assistant',
          text: String(text),
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMessage]);
        setStatusText('Live response streaming');

        // Persist streamed assistant segment to Firebase so live sessions are recorded
        try {
          let conversationId = activeHistoryId;
          if (!conversationId) {
            const conversationsRef = dbRef(db, `chat_conversations/${userProfile.uid}`);
            const newConversationRef = push(conversationsRef);
            conversationId = newConversationRef.key || undefined;
            if (conversationId) {
              await set(newConversationRef, {
                title: 'Live Chat',
                created_at: Date.now(),
                last_updated_at: Date.now(),
              });
              setActiveHistoryId(conversationId);
            }
          }

          if (conversationId) {
            const messagesRef = dbRef(db, `chat_messages/${conversationId}`);
            await push(messagesRef, {
              text: String(text),
              sender: 'assistant',
              timestamp: serverTimestamp(),
            });
            await update(dbRef(db, `chat_conversations/${userProfile.uid}/${conversationId}`), { last_updated_at: Date.now() });
          }
        } catch (err) {
          console.error('Failed to persist live assistant message:', err);
        }
      }
    } catch (err) {
      console.error('Error handling live server message:', err);
    }
  };

  const startLiveSession = async () => {
    if (!ai || !ai.live) {
      setStatusText('Live API not configured');
      setInputState(1);
      return;
    }

    try {
      setStatusText('Requesting microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      setStatusText('Connecting to live session...');
      const session = await ai.live.connect({
        model: LIVE_MODEL,
        callbacks: {
          onopen: () => setStatusText('Live connected'),
          onmessage: (e: any) => handleLiveServerMessage(e),
          onerror: (e: any) => { console.error('Live error', e); setStatusText('Live error'); },
          onclose: () => { setStatusText('Live closed'); },
        },
      });

      liveSessionRef.current = session;

      // Start MediaRecorder and stream chunks to the session
      const options: any = {};
      let mime = '';
      if (MediaRecorder.isTypeSupported) {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
      }
      if (mime) options.mimeType = mime;

      const recorder = new MediaRecorder(stream as MediaStream, options);
      mediaRecorderRef.current = recorder;
      const liveAudioMimeType = recorder.mimeType || options.mimeType || 'audio/webm;codecs=opus';

      recorder.addEventListener('dataavailable', async (ev: BlobEvent) => {
        if (!ev.data || ev.data.size === 0) return;
        try {
          const audioChunk = ev.data.type
            ? ev.data
            : new Blob([ev.data], { type: liveAudioMimeType });
          const realtimeAudioMimeType = audioChunk.type || liveAudioMimeType || 'audio/webm';
          const encodedAudio = await blobToBase64(audioChunk);
          liveSessionRef.current?.sendRealtimeInput?.({
            audio: {
              data: encodedAudio,
              mimeType: realtimeAudioMimeType,
            },
          });
        } catch (err) {
          console.error('Failed to send realtime input:', err);
        }
      });

      recorder.start(250); // emit small chunks frequently
      setStatusText('Listening...');
    } catch (err) {
      console.error('Failed to start live session:', err);
      setStatusText('Could not start live session');
      setInputState(1);
    }
  };

  const stopLiveSession = async () => {
    try {
      // Stop recorder
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      // Signal end of audio stream to server
      try { liveSessionRef.current?.sendRealtimeInput?.({ audioStreamEnd: true }); } catch (e) { /* ignore */ }
      // Close session
      try { liveSessionRef.current?.close?.(); } catch (e) { /* ignore */ }
      // Stop tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
    } catch (err) {
      console.error('Error while stopping live session:', err);
    } finally {
      liveSessionRef.current = null;
      mediaRecorderRef.current = null;
      mediaStreamRef.current = null;
      setStatusText('Live stopped');
    }
  };

  useEffect(() => {
    // When entering fullscreen live mode, start the session; when leaving, stop it
    if (inputState === 4) {
      void startLiveSession();
    } else {
      void stopLiveSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputState]);

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
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500">VanTutor</p>
              <h2 className="mt-1 text-xl font-bold text-slate-100">Assistant history</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="rounded-full border border-neutral-800 p-2 text-slate-400 md:hidden"
              aria-label="Close assistant history"
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
              >
                <ChatIcon className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-500">VanTutorAssistant</p>
                <h1 className="text-lg font-bold text-slate-100 sm:text-2xl truncate max-w-[200px] sm:max-w-md">{conversationSummary}</h1>
              </div>
            </div>
            <div className="rounded-full bg-emerald-950/50 border border-emerald-800/30 px-3 py-1 text-xs font-semibold text-emerald-400">
              {statusText}
            </div>
          </header>

          {/* Messages List Container */}
          <section className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 pb-32 sm:px-6">
            {messages.length === 0 ? (
              <div className="mx-auto flex max-w-3xl flex-col items-center justify-center gap-6 py-16 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-600 text-white shadow-lg">
                  <ChatIcon className="h-10 w-10" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-100">Ask VanTutor anything</h2>
                  <p className="mt-2 max-w-xl text-slate-400">
                    Get step-by-step answers with clean LaTeX for equations, formulas, and proofs.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                {messages.map(message => (
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
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
                      )}
                    </div>
                  </div>
                ))}

                {isSending && (
                  <div className="flex justify-start">
                    <div className="rounded-3xl border border-neutral-800 bg-[#0e1227] px-4 py-3 text-sm text-slate-400 shadow-sm">
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </section>

          {/* Integrated VanTutor Input Layout Panel */}
          <footer className="absolute bottom-6 left-0 right-0 z-30 px-4">
            <div className="w-full max-w-xl mx-auto transition-all duration-300">
              
              {/* Attachment Preview (if any) displayed elegantly right above the bar layout */}
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
                <div className="relative w-full h-[64px] bg-[#1e1f20] rounded-full flex items-center justify-between pl-4 pr-2 border border-neutral-800/50 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                  
                  {/* Attachment triggered clicker hook button */}
                  <button 
                    type="button" 
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={isSending}
                    className="text-white hover:opacity-80 transition active:scale-95 shrink-0 flex items-center justify-center w-8 h-8 disabled:opacity-40"
                    aria-label="Upload attachment"
                  >
                    <PlusIcon />
                  </button>

                  <input
                    ref={attachmentInputRef}
                    type="file"
                    accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    className="hidden"
                    onChange={handleAttachmentChange}
                  />

                  {/* Input form field or ambient loading voice lines container */}
                  <div className="flex-1 h-full flex items-center px-2 min-w-0">
                    {(inputState === 1 || inputState === 2) ? (
                      <input 
                        ref={inputElementRef}
                        type="text"
                        value={inputValue}
                        onChange={handleTextChange}
                        disabled={isSending}
                        placeholder="Ask VanTutor"
                        className="w-full h-full bg-transparent text-[17px] text-white placeholder-[#98999a] outline-none border-none pr-2 disabled:cursor-not-allowed"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void handleSend();
                          }
                        }}
                      />
                    ) : (
                      /* State 3 listening ticks simulation view graphic components */
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

                  {/* Operational Action triggers buttons cluster panel */}
                  <div className="flex items-center gap-[9px] shrink-0">
                    
                    {/* Microphone interactive selection control options */}
                    {(inputState === 1 || inputState === 2) && (
                      <button 
                        type="button"
                        onClick={() => setInputState(3)}
                        className="text-white hover:opacity-85 transition active:scale-90 flex items-center justify-center w-9 h-9"
                      >
                        <MicIcon />
                      </button>
                    )}

                    {/* Quick termination stop option return hook (State 3) */}
                    {inputState === 3 && (
                      <button 
                        type="button"
                        onClick={() => setInputState(1)}
                        className="w-[42px] h-[42px] bg-[#27282b]/80 hover:bg-[#2e3034] rounded-full flex items-center justify-center text-white transition active:scale-90"
                      >
                        <StopIcon />
                      </button>
                    )}

                    {/* Submission / Waveform routing engine button handler */}
                    {inputState === 1 && !inputValue.trim() && attachments.length === 0 ? (
                      <button 
                        type="button"
                        onClick={() => setInputState(4)}
                        className="w-11 h-11 bg-[#19398a] hover:bg-[#1f47ad] text-white rounded-full flex items-center justify-center shadow-md transition active:scale-95"
                      >
                        <WaveformIcon />
                      </button>
                    ) : (
                      <button 
                        type="button"
                        onClick={() => { void handleSend(); }}
                        disabled={isSending || (!inputValue.trim() && attachments.length === 0)}
                        className="w-11 h-11 bg-[#19398a] hover:bg-[#1f47ad] text-white rounded-full flex items-center justify-center shadow-md transition active:scale-95 disabled:opacity-50"
                      >
                        <UpArrowIcon />
                      </button>
                    )}
                  </div>

                </div>
              )}

              {/* STATE 4: Fullscreen Live mode controls selection panel cluster block */}
              {inputState === 4 && (
                <div className="w-full flex items-center justify-between px-2 py-4 animate-fade-in select-none bg-[#101114] rounded-3xl border border-neutral-800/40 p-4 shadow-xl">
                  {/* Camera Button */}
                  <button type="button" className="w-[52px] h-[52px] bg-[#1e1f20] hover:bg-[#2a2b2e] rounded-full flex items-center justify-center text-white transition active:scale-90 shadow-md">
                    <VisionIcon />
                  </button>

                  {/* Share Button */}
                  <button type="button" className="w-[52px] h-[52px] bg-[#1e1f20] hover:bg-[#2a2b2e] rounded-full flex items-center justify-center text-white transition active:scale-90 shadow-md">
                    <ShareUploadIcon />
                  </button>

                  {/* Center glowing neon pulsing capsule graphic elements */}
                  <div className="relative w-[114px] h-[64px] bg-gradient-to-b from-[#08080a] to-[#0d0f14] rounded-full overflow-hidden border border-neutral-800/70 flex items-center justify-center shadow-lg">
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[86px] h-[18px] bg-[#38bdf8] rounded-full blur-[8px] opacity-80 animate-ambient-pulse" />
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[82px] h-[4px] bg-[#60a5fa] rounded-full opacity-90" />
                  </div>

                  {/* Mute/Mic Control */}
                  <button type="button" className="w-[52px] h-[52px] bg-[#1e1f20] hover:bg-[#2a2b2e] rounded-full flex items-center justify-center text-white transition active:scale-90 shadow-md">
                    <MicIcon />
                  </button>

                  {/* Close Control return to default mode */}
                  <button 
                    type="button"
                    onClick={() => setInputState(1)}
                    className="w-[52px] h-[52px] bg-[#1e1f20] hover:bg-red-950/20 rounded-full flex items-center justify-center text-white transition active:scale-90 shadow-md"
                  >
                    <CloseXIcon />
                  </button>
                </div>
              )}
            </div>
          </footer>
        </main>
      </div>

      {/* Styled animation wrappers safely mounted under main application shell layout */}
      <style>{`
        @keyframes voice-bar-pulse {
          0%, 100% { transform: scaleY(1); opacity: 0.8; }
          50% { transform: scaleY(1.6); opacity: 1; background-color: #10b981; }
        }
        .animate-voice-bar-pulse {
          animation: voice-bar-pulse 1.1s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes ambient-pulse {
          0%, 100% { opacity: 0.7; transform: translate(-50%, 0px) scale(0.95); filter: blur(8px); }
          50% { opacity: 0.95; transform: translate(-50%, -1px) scale(1.05); filter: blur(10px); }
        }
        .animate-ambient-pulse {
          animation: ambient-pulse 2s ease-in-out infinite;
        }
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
