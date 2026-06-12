import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { ref as dbRef, get, set } from 'firebase/database';
import { createAvelutAI } from '../utils/inference';
import { Type } from '@google/genai';
import { useToast } from '../hooks/useToast';
import { getFeatureModel } from '../utils/usage';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import type { UserProfile } from '../types';

interface CalendarModalProps {
    isOpen: boolean;
    onClose: () => void;
    userProfile: UserProfile;
}

interface StudySession {
    id: string;
    day: string;
    time: string;
    subject: string;
    topic: string;
    activity: string;
    complete: boolean;
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const CalendarModal: React.FC<CalendarModalProps> = ({ isOpen, onClose, userProfile }) => {
    const { addToast } = useToast();
    const { attemptApiCall } = useApiLimiter();
    const { settings: appSettings } = useAppSettings();
    const geminiModel = getFeatureModel('chat_interaction', appSettings);
    const ai = useMemo(() => createAvelutAI(appSettings, userProfile), [appSettings, userProfile]);

    const [timetable, setTimetable] = useState<StudySession[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [textInput, setTextInput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    
    // Upload options menu popover
    const [showUploadMenu, setShowUploadMenu] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [uploadedFileBase64, setUploadedFileBase64] = useState('');
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;
        const fetchTimetable = async () => {
            setIsLoading(true);
            try {
                const timetableRef = dbRef(db, `users/${userProfile.uid}/timetable`);
                const snap = await get(timetableRef);
                if (snap.exists()) {
                    setTimetable(snap.val() || []);
                } else {
                    setTimetable([]);
                }
            } catch (err) {
                console.error("Failed to fetch study timetable:", err);
            } finally {
                setIsLoading(false);
            }
        };
        void fetchTimetable();
    }, [isOpen, userProfile.uid]);

    // Handle clicks outside upload popup to dismiss
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

    const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
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
            addToast(`File "${file.name}" attached.`, 'success');
        } catch (err: any) {
            addToast('Failed to load file: ' + err.message, 'error');
        }
        setShowUploadMenu(false);
    };

    const handleGenerateTimetable = async () => {
        if (!textInput.trim() && !uploadedFile) {
            addToast('Please enter some study goals or upload a syllabus first.', 'info');
            return;
        }

        setIsGenerating(true);
        try {
            if (!ai) throw new Error('AI client is not configured.');
            
            let fileDataPart: any = null;
            if (uploadedFile && uploadedFileBase64) {
                fileDataPart = {
                    inlineData: {
                        mimeType: uploadedFile.type,
                        data: uploadedFileBase64
                    }
                };
            }

            const prompt = `You are AVELUT AI Study Scheduler.
Analyze the user's study goals, text context, and/or uploaded syllabus/timetable file to generate a highly efficient, balanced weekly study timetable.
Generate exactly 5 to 10 study sessions distributed across the week.
For each session, provide:
- day: The day of the week (e.g. "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
- time: A specific time range (e.g. "09:00 AM - 11:00 AM" or "04:00 PM - 06:00 PM")
- subject: The course or subject name (e.g. "PHILOSOPHY LOGIC")
- topic: The specific topic to study (e.g. "Deductive Logic and Class Relations")
- activity: The specific learning activity (e.g. "Read study guide, solve 10 quiz questions, and write a summary")

User's study goals:
${textInput}

Return valid JSON as an object with key "sessions" which is an array of objects. Do not write any markdown or text explanations.`;

            const parts: any[] = [{ text: prompt }];
            if (fileDataPart) parts.push(fileDataPart);

            const result = await attemptApiCall(async () => {
                const response = await ai.models.generateContent({
                    model: geminiModel,
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
                                            activity: { type: Type.STRING }
                                        },
                                        required: ['day', 'time', 'subject', 'topic', 'activity']
                                    }
                                }
                            },
                            required: ['sessions']
                        }
                    }
                });

                if (!response.text) throw new Error('AI returned an empty timetable.');
                return JSON.parse(response.text);
            });

            if (result.success && result.data && Array.isArray(result.data.sessions)) {
                const sessionsWithMeta = result.data.sessions.map((s: any, idx: number) => ({
                    id: `session_${Date.now()}_${idx}`,
                    ...s,
                    complete: false
                }));

                await set(dbRef(db, `users/${userProfile.uid}/timetable`), sessionsWithMeta);
                setTimetable(sessionsWithMeta);
                setTextInput('');
                setUploadedFile(null);
                setUploadedFileBase64('');
                addToast('Study timetable generated successfully!', 'success');
            } else {
                throw new Error(result.message || 'Generation failed');
            }
        } catch (err: any) {
            console.error('Failed to generate study schedule:', err);
            addToast('Timetable generation failed: ' + err.message, 'error');
        } finally {
            setIsGenerating(false);
        }
    };

    const toggleSessionComplete = async (sessionId: string) => {
        const updated = timetable.map(s => {
            if (s.id === sessionId) {
                const nextStatus = !s.complete;
                if (nextStatus) {
                    addToast('Great job! Keep up the studying!', 'success');
                }
                return { ...s, complete: nextStatus };
            }
            return s;
        });
        setTimetable(updated);
        try {
            await set(dbRef(db, `users/${userProfile.uid}/timetable`), updated);
        } catch (err) {
            console.error("Failed to update session complete status:", err);
        }
    };

    const handleDeleteTimetable = async () => {
        const confirmed = window.confirm("Are you sure you want to delete your current study timetable?");
        if (!confirmed) return;
        try {
            await set(dbRef(db, `users/${userProfile.uid}/timetable`), null);
            setTimetable([]);
            addToast('Study timetable deleted.', 'info');
        } catch (err) {
            console.error("Failed to delete timetable:", err);
        }
    };

    if (!isOpen) return null;

    const groupedSessions = DAYS_OF_WEEK.map(day => ({
        day,
        sessions: timetable.filter(s => s.day.toLowerCase() === day.toLowerCase())
    })).filter(group => group.sessions.length > 0);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
            {/* Hidden Inputs */}
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept=".pdf,.doc,.docx,.txt" />
            <input type="file" ref={imageInputRef} onChange={handleFileSelect} className="hidden" accept="image/*" />

            <div className="bg-white w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl border border-gray-100 flex flex-col max-h-[90vh] animate-scale-in">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-[#009EE2]/5 to-[#0070B8]/5">
                    <div>
                        <h2 className="text-xl font-bold text-charcoal flex items-center gap-2">
                            <span>📅</span> Study Timetable
                        </h2>
                        <p className="text-xs text-[#6C757D] font-medium mt-0.5">Organize your syllabus and build an interactive AI-powered study schedule.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full bg-white hover:bg-neutral-100 flex items-center justify-center text-charcoal shadow-sm border border-gray-100 font-bold transition"
                    >
                        ✕
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto p-6 flex flex-col lg:flex-row gap-6 min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {/* Left: AI Generator Panel */}
                    <div className="w-full lg:w-[350px] shrink-0 space-y-4">
                        <div className="bg-[#F8F9FA] p-5 rounded-2xl border border-gray-100">
                            <h3 className="text-sm font-bold text-charcoal mb-2.5">Generate Study Timetable</h3>
                            
                            {/* Premium Input Text Area with Attachment button inside */}
                            <div className="relative border border-gray-200 bg-white rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-[#009EE2]/20 focus-within:border-[#009EE2] transition-all">
                                <textarea
                                    value={textInput}
                                    onChange={(e) => setTextInput(e.target.value)}
                                    placeholder="Describe your learning goals, target exam dates, or describe your schedule..."
                                    className="w-full min-h-[120px] bg-transparent text-sm text-[#212529] placeholder-[#80868B] p-4 outline-none border-none resize-none focus:ring-0"
                                />

                                {/* Selected File Indicator */}
                                {uploadedFile && (
                                    <div className="mx-4 mb-2 px-3 py-1.5 bg-neutral-50 rounded-xl border border-gray-100 flex items-center justify-between text-xs text-charcoal font-medium animate-fade-in">
                                        <span className="truncate max-w-[200px]">📄 {uploadedFile.name}</span>
                                        <button onClick={() => { setUploadedFile(null); setUploadedFileBase64(''); }} className="text-red-500 font-bold hover:text-red-700 ml-2">✕</button>
                                    </div>
                                )}

                                {/* Attachments button inside the textbox container */}
                                <div className="flex justify-between items-center p-3 border-t border-gray-100 bg-neutral-50/50 rounded-b-2xl">
                                    <div className="relative" ref={uploadMenuRef}>
                                        <button
                                            type="button"
                                            onClick={() => setShowUploadMenu(!showUploadMenu)}
                                            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white border border-gray-100 text-charcoal/60 hover:text-charcoal hover:bg-neutral-50 active:scale-95 shadow-sm transition"
                                            title="Attach Course File or Syllabus"
                                        >
                                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                            </svg>
                                        </button>

                                        {/* Upload Options Menu */}
                                        {showUploadMenu && (
                                            <div className="absolute left-0 bottom-11 w-44 bg-white border border-gray-100 rounded-2xl shadow-xl p-2 z-50 animate-scale-in">
                                                <button
                                                    type="button"
                                                    onClick={() => { imageInputRef.current?.click(); }}
                                                    className="w-full text-left px-3.5 py-2 text-xs font-bold text-charcoal hover:bg-[#009EE2]/5 hover:text-[#009EE2] rounded-lg transition"
                                                >
                                                    📷 Upload Image
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => { fileInputRef.current?.click(); }}
                                                    className="w-full text-left px-3.5 py-2 text-xs font-bold text-charcoal hover:bg-[#009EE2]/5 hover:text-[#009EE2] rounded-lg transition"
                                                >
                                                    📄 Upload PDF / Document
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <button
                                        onClick={handleGenerateTimetable}
                                        disabled={isGenerating}
                                        className="flex items-center gap-1.5 bg-[#009EE2] hover:bg-[#0070B8] text-white px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition shadow-md disabled:bg-neutral-300 disabled:shadow-none cursor-pointer"
                                    >
                                        {isGenerating ? (
                                            <>
                                                <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                Scheduler...
                                            </>
                                        ) : (
                                            <>
                                                <span>🪄</span> Generate
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {timetable.length > 0 && (
                            <button
                                onClick={handleDeleteTimetable}
                                className="w-full border border-red-200 hover:bg-red-50 text-red-600 font-bold text-xs uppercase tracking-wider py-3.5 rounded-2xl transition shadow-sm text-center"
                            >
                                Clear Current Schedule
                            </button>
                        )}
                    </div>

                    {/* Right: Timetable Schedule Grid Viewer */}
                    <div className="flex-1 min-w-0 bg-[#F8F9FA] rounded-2xl p-5 border border-gray-100 flex flex-col max-h-full">
                        <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-2">
                            <h3 className="text-sm font-bold text-charcoal">Weekly Study Calendar</h3>
                            <span className="text-[10px] font-black text-[#6C757D] uppercase tracking-wider bg-white border border-gray-100 px-2.5 py-1 rounded-full shadow-sm">
                                {timetable.length} Sessions scheduled
                            </span>
                        </div>

                        {isLoading ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                                <svg className="animate-spin h-8 w-8 text-[#009EE2] mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <p className="text-xs font-black text-[#6C757D] uppercase tracking-widest animate-pulse">Loading Weekly timetable...</p>
                            </div>
                        ) : timetable.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 text-center">
                                <span className="text-4xl mb-3 block">📆</span>
                                <h4 className="text-sm font-bold text-[#212529]">No Study Timetable Found</h4>
                                <p className="text-xs text-[#6C757D] mt-1 max-w-sm">
                                    Describe your target topics or upload a course syllabus outline inside the scheduler to create a neat weekly schedule.
                                </p>
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto space-y-5 pr-1 min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                {groupedSessions.map(group => (
                                    <div key={group.day} className="space-y-2">
                                        <h4 className="text-xs font-black text-[#009EE2] uppercase tracking-wider">{group.day}</h4>
                                        <div className="grid gap-2.5">
                                            {group.sessions.map(session => (
                                                <div
                                                    key={session.id}
                                                    onClick={() => void toggleSessionComplete(session.id)}
                                                    className={`flex items-start justify-between p-4 bg-white border rounded-2xl shadow-sm transition cursor-pointer select-none ${
                                                        session.complete ? 'border-emerald-200 bg-emerald-50/20 opacity-70' : 'border-gray-100 hover:border-[#009EE2]'
                                                    }`}
                                                >
                                                    <div className="min-w-0 flex-1 pr-3">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-[10px] font-bold text-[#6C757D] tabular-nums">🕒 {session.time}</span>
                                                            <span className="text-[10px] font-black uppercase text-[#009EE2] bg-[#009EE2]/5 px-2 py-0.5 rounded">
                                                                {session.subject}
                                                            </span>
                                                        </div>
                                                        <h5 className={`font-bold text-xs text-[#212529] ${session.complete ? 'line-through text-neutral-500' : ''}`}>
                                                            {session.topic}
                                                        </h5>
                                                        <p className="text-[11px] text-[#6C757D] font-medium leading-relaxed mt-1">
                                                            {session.activity}
                                                        </p>
                                                    </div>

                                                    <div className="shrink-0 flex items-center justify-center mt-1">
                                                        <div className={`w-5 h-5 rounded-full border-2 transition flex items-center justify-center`} style={{
                                                            borderColor: session.complete ? '#10B981' : '#CED4DA',
                                                            backgroundColor: session.complete ? '#10B981' : 'transparent'
                                                        }}>
                                                            {session.complete && (
                                                                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                                                    <polyline points="20 6 9 17 4 12" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
