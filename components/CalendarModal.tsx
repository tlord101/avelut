import { supabase } from '../lib/supabaseClient';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createAvelutAI, getResponseText, Type } from '../utils/inference';
import { useToast } from '../hooks/useToast';
import { getFeatureModel, checkAICredits, deductAICredits, getFeatureCost } from '../utils/usage';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import type { UserProfile } from '../types';

export interface StudySession {
    id: string;
    day: string;
    time: string;
    subject: string;
    topic: string;
    activity: string;
    location?: string;
    complete: boolean;
}

interface CalendarModalProps {
    isOpen: boolean;
    onClose: () => void;
    userProfile: UserProfile;
    onSuccess?: () => void;
}

export const CalendarModal: React.FC<CalendarModalProps> = ({
    isOpen,
    onClose,
    userProfile,
    onSuccess,
}) => {
    const { addToast } = useToast();
    const { attemptApiCall } = useApiLimiter();
    const { settings: appSettings } = useAppSettings();
    const aiModel = getFeatureModel('chat_interaction', appSettings);
    const ai = useMemo(() => createAvelutAI(appSettings, userProfile), [appSettings, userProfile]);

    const [textInput, setTextInput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [showUploadMenu, setShowUploadMenu] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [uploadedFileBase64, setUploadedFileBase64] = useState('');
    const [uploadedFilePreview, setUploadedFilePreview] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadMenuRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Dismiss upload popup on click outside
    useEffect(() => {
        if (!showUploadMenu) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
                setShowUploadMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showUploadMenu]);

    // Auto-focus textarea on open
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => {
                textareaRef.current?.focus();
            }, 150);
        } else {
            setTextInput('');
            setUploadedFile(null);
            setUploadedFileBase64('');
            setUploadedFilePreview(null);
            setShowUploadMenu(false);
        }
    }, [isOpen]);

    const fileToBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = typeof reader.result === 'string' ? reader.result : '';
                resolve(result.includes(',') ? result.split(',')[1] : result);
            };
            reader.onerror = () => reject(new Error(`Failed to read file: ${reader.error?.message || 'Unknown error'}`));
            reader.readAsDataURL(file);
        });

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        try {
            setUploadedFile(file);
            const b64 = await fileToBase64(file);
            setUploadedFileBase64(b64);
            if (file.type.startsWith('image/')) {
                setUploadedFilePreview(URL.createObjectURL(file));
            } else {
                setUploadedFilePreview(null);
            }
            addToast(`Attached: "${file.name}"`, 'success');
        } catch (err: any) {
            addToast('Failed to attach file: ' + err.message, 'error');
        }
        setShowUploadMenu(false);
    };

    const handleGenerateTimetable = async () => {
        const trimmed = textInput.trim();
        if (!trimmed && !uploadedFile) {
            addToast('Please enter your classes/schedule or attach a timetable photo.', 'info');
            return;
        }

        const cost = getFeatureCost('chat_interaction', appSettings);
        const creditCheck = checkAICredits(userProfile, cost, appSettings);
        if (!creditCheck.allowed) {
            addToast('Insufficient credits. Top up your balance to generate your timetable.', 'error');
            return;
        }

        setIsGenerating(true);
        try {
            if (!ai) throw new Error('AI client is not configured.');

            let fileDataPart: any = null;
            if (uploadedFile && uploadedFileBase64) {
                fileDataPart = {
                    inlineData: {
                        mimeType: uploadedFile.type || 'image/jpeg',
                        data: uploadedFileBase64,
                    },
                };
            }

            const prompt = `You are AVELUT AI Study Scheduler.
Analyze the user's input, class notes, syllabus, or uploaded timetable image/document.
Extract or generate realistic, structured timetable sessions for their weekly schedule.
For each class or study session, provide:
- day: Day of the week ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
- time: Standard time range (e.g. "08:30 AM - 09:15 AM", "09:30 AM - 10:15 AM", "11:15 AM - 12:00 PM", "02:00 PM - 02:45 PM")
- subject: Course or subject name (e.g. "Physics", "Chemistry Quiz", "Maths Worksheet", "English Literature")
- topic: Brief class description or specific topic (e.g. "Class 9C - Physics", "Class 10A - Physics", "Lab Session", "Worksheet Discussion")
- activity: Type of activity (e.g. "Lecture", "Lab", "Quiz", "Discussion", "Practical")
- location: Classroom or room number (e.g. "Room 204", "Room 205", "Lab 1", "Room 206", "Virtual")

User input:
${trimmed || 'Generate a standard weekly timetable based on the attached document or image.'}

Return valid JSON with key "sessions" containing an array of objects.`;

            const parts: any[] = [{ text: prompt }];
            if (fileDataPart) parts.push(fileDataPart);

            const result = await attemptApiCall(async () => {
                const response = await ai.models.generateContent({
                    model: aiModel,
                    contents: [{ role: 'user', parts }],
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                sessions: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            day: { type: Type.STRING },
                                            time: { type: Type.STRING },
                                            subject: { type: Type.STRING },
                                            topic: { type: Type.STRING },
                                            activity: { type: Type.STRING },
                                            location: { type: Type.STRING },
                                        },
                                        required: ['day', 'time', 'subject', 'topic'],
                                    },
                                },
                            },
                            required: ['sessions'],
                        },
                    },
                });

                const text = getResponseText(response);
                if (!text) throw new Error('AI returned an empty response.');
                return JSON.parse(text);
            });

            if (result.success && result.data && Array.isArray(result.data.sessions)) {
                // Fetch existing sessions from Supabase & local storage
                let existingSessions: StudySession[] = [];
                try {
                    const { data } = await supabase
                        .from('app_kv')
                        .select('value')
                        .eq('key', `timetable:${userProfile.uid}`)
                        .maybeSingle();
                    if (data && Array.isArray(data.value)) {
                        existingSessions = data.value;
                    }
                } catch (e) {
                    console.warn('[Supabase] Could not fetch existing sessions:', e);
                }

                if (existingSessions.length === 0) {
                    try {
                        const localRaw = localStorage.getItem(`avelut_timetable_${userProfile.uid}`);
                        if (localRaw) {
                            const parsed = JSON.parse(localRaw);
                            if (Array.isArray(parsed)) existingSessions = parsed;
                        }
                    } catch {}
                }

                const newSessions = result.data.sessions.map((s: any, idx: number) => ({
                    id: `session_${Date.now()}_${idx}`,
                    day: s.day || 'Monday',
                    time: s.time || '09:00 AM - 10:00 AM',
                    subject: s.subject || 'Course Session',
                    topic: s.topic || s.subject || 'Lecture',
                    activity: s.activity || 'Class',
                    location: s.location || 'Room 101',
                    complete: false,
                }));

                const mergedSessions = [...newSessions, ...existingSessions.slice(0, 30)];

                // Persist to Supabase app_kv
                try {
                    await supabase
                        .from('app_kv')
                        .upsert({
                            key: `timetable:${userProfile.uid}`,
                            value: mergedSessions,
                            updated_at: new Date().toISOString(),
                        }, { onConflict: 'key' });
                } catch (supaErr) {
                    console.warn('[Supabase] Failed to save timetable:', supaErr);
                }

                try {
                    localStorage.setItem(`avelut_timetable_${userProfile.uid}`, JSON.stringify(mergedSessions));
                } catch {}

                void deductAICredits(userProfile.uid, cost, 'AI Study Timetable Generation', appSettings);

                // Notify any listening timetable views
                window.dispatchEvent(new CustomEvent('avelut_timetable_updated', { detail: { sessions: mergedSessions } }));

                addToast('Timetable updated successfully!', 'success');
                onClose();
                onSuccess?.();
            } else {
                throw new Error(result.message || 'Could not parse timetable');
            }
        } catch (err: any) {
            console.error('Failed to generate timetable:', err);
            addToast('Timetable generation error: ' + (err.message || 'Please try again.'), 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
            {/* Hidden native file inputs */}
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt"
            />
            <input
                type="file"
                ref={imageInputRef}
                onChange={handleFileSelect}
                className="hidden"
                accept="image/*"
            />

            {/* Sleek rounded modal card */}
            <div className="w-full max-w-lg rounded-[28px] sm:rounded-[32px] bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-white/10 shadow-2xl p-5 sm:p-7 relative overflow-visible transition-all animate-scale-in">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/10 dark:bg-blue-400/10 text-[#0066FF] dark:text-blue-400 text-[11px] font-black uppercase tracking-wider mb-1.5">
                            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                            </svg>
                            <span>Timetable Assistant</span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">
                            Plan Your Timetable
                        </h2>
                        <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                            Describe your classes, or upload a photo or document of your schedule to generate it instantly.
                        </p>
                    </div>

                    {/* Close button */}
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 dark:bg-white/10 dark:hover:bg-white/15 flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition active:scale-95 cursor-pointer shrink-0"
                        aria-label="Close"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Input Bar Container */}
                <div className="relative flex flex-col bg-[#f4f4f5] dark:bg-[#212124] rounded-[24px] border border-neutral-200/70 dark:border-white/5 transition-all focus-within:ring-2 focus-within:ring-[#0066FF]/20 dark:focus-within:ring-[#0066FF]/30 shadow-xs">
                    {/* Attached file preview chip */}
                    {uploadedFile && (
                        <div className="px-3.5 pt-3 pb-1 flex items-center gap-2">
                            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 shadow-xs text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                {uploadedFilePreview ? (
                                    <img
                                        src={uploadedFilePreview}
                                        alt="Preview"
                                        className="w-4 h-4 rounded-full object-cover"
                                    />
                                ) : (
                                    <svg className="w-3.5 h-3.5 text-[#0066FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                )}
                                <span className="truncate max-w-[190px]">{uploadedFile.name}</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setUploadedFile(null);
                                        setUploadedFileBase64('');
                                        setUploadedFilePreview(null);
                                    }}
                                    className="w-4 h-4 rounded-full bg-neutral-200 dark:bg-white/10 hover:bg-neutral-300 dark:hover:bg-white/20 flex items-center justify-center text-neutral-600 dark:text-neutral-300 transition"
                                >
                                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Textarea */}
                    <div className="px-3.5 pt-3 pb-1">
                        <textarea
                            ref={textareaRef}
                            value={textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleGenerateTimetable();
                                }
                            }}
                            placeholder="Type classes (e.g. Physics Mon/Wed 9AM, Chem Quiz Fri 10:30AM) or upload file..."
                            rows={3}
                            className="w-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 text-sm sm:text-[15px] resize-none py-0 leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        />
                    </div>

                    {/* Bottom Controls Row: Plus button & Pill Send button */}
                    <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
                        {/* Plus button with popup menu */}
                        <div className="relative" ref={uploadMenuRef}>
                            <button
                                type="button"
                                onClick={() => setShowUploadMenu((prev) => !prev)}
                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                                    showUploadMenu
                                        ? 'bg-neutral-200 dark:bg-white/20 text-neutral-900 dark:text-white'
                                        : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/50 dark:hover:bg-white/10'
                                }`}
                                title="Attach photo or file"
                                aria-label="Attach photo or file"
                            >
                                <svg
                                    className={`w-5 h-5 transition-transform duration-200 ${showUploadMenu ? 'rotate-45' : ''}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                            </button>

                            {/* Small Popup Menu */}
                            {showUploadMenu && (
                                <div className="absolute bottom-full left-0 mb-2 w-44 bg-white dark:bg-[#26262a] rounded-2xl shadow-xl border border-neutral-200 dark:border-white/10 overflow-hidden py-1.5 z-50 animate-in fade-in slide-in-from-bottom-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowUploadMenu(false);
                                            imageInputRef.current?.click();
                                        }}
                                        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                                    >
                                        <svg className="w-4 h-4 text-[#0066FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                            <circle cx="8.5" cy="8.5" r="1.5" />
                                            <polyline points="21 15 16 10 5 21" />
                                        </svg>
                                        <span>Gallery</span>
                                    </button>
                                    <div className="h-px bg-neutral-100 dark:bg-white/5 my-0.5" />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setShowUploadMenu(false);
                                            fileInputRef.current?.click();
                                        }}
                                        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors text-left cursor-pointer"
                                    >
                                        <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <span>File Uploading</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Pill Shape Send Button */}
                        <button
                            type="button"
                            onClick={handleGenerateTimetable}
                            disabled={isGenerating || (!textInput.trim() && !uploadedFile)}
                            className="h-9 px-4 rounded-full bg-[#0066FF] hover:bg-[#0052cc] active:scale-95 disabled:opacity-50 disabled:pointer-events-none text-white flex items-center justify-center gap-1.5 font-semibold text-xs sm:text-sm shadow-sm transition-all cursor-pointer"
                            title="Schedule Timetable"
                            aria-label="Schedule Timetable"
                        >
                            {isGenerating ? (
                                <>
                                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    <span>Scheduling...</span>
                                </>
                            ) : (
                                <>
                                    <span>Send</span>
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                                    </svg>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
