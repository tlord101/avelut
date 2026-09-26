import { db, get, ref as dbRef, update } from '@/lib/backend';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { createAvelutAI, getResponseText, Type } from '../utils/inference';
import type { UserProfile, Course, Topic, UserProgress } from '../types';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import { LimitExceededModal } from './LimitExceededModal';
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel, hasLiveTutorialAccess } from '../utils/usage';
import { useSharedTextbookUpload, getCourseMergeKey } from '../hooks/useSharedTextbookUpload';
import VoiceTutorialPage, { VoiceTutorialSessionData } from './VoiceTutorialPage';
import CourseChatTutor from './CourseChatTutor';
import MyNotebooks from './MyNotebooks';
import { supabaseDataService } from '../services/supabaseDataService';
import {
    normalizeLevelValue,
    normalizeDepartmentValue,
    normalizeTopicId,
    sanitizeTopicMetadata,
    normalizeCourse,
    mergeTopics,
} from './studyguide/studyGuideUtils';

async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                const base64 = reader.result.split(',')[1];
                if (base64) return resolve(base64);
                return reject(new Error('Failed to parse base64 data'));
            }
            reject(new Error('Failed to read file'));
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

const formatDuration = (seconds: number): string => {
    if (!seconds || seconds <= 0) return '0m';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
};

export const formatLastVisited = (timestamp?: number | null): string | null => {
    if (!timestamp || typeof timestamp !== 'number' || timestamp <= 0) return null;
    const diffMs = Date.now() - timestamp;
    if (diffMs < 0) return 'Visited just now';
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return 'Visited just now';
    if (diffMinutes < 60) return `Visited ${diffMinutes}m ago`;
    if (diffHours < 24) return `Visited ${diffHours}h ago`;
    if (diffDays === 1) return 'Visited yesterday';
    if (diffDays < 7) return `Visited ${diffDays}d ago`;
    if (diffDays < 30) return `Visited ${Math.floor(diffDays / 7)}w ago`;
    return `Visited ${new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};

// --- SKELETON LOADER ---
const StudyGuideSkeleton: React.FC = () => (
    <div className="w-full max-w-4xl mx-auto space-y-4 p-4 animate-pulse">
        <div className="h-20 bg-slate-200 dark:bg-[#141414] rounded-2xl w-full" />
        <div className="h-20 bg-slate-200 dark:bg-[#141414] rounded-2xl w-full" />
        <div className="h-20 bg-slate-200 dark:bg-[#141414] rounded-2xl w-full" />
    </div>
);

// --- COURSE HEADER CARD ---
interface CourseHeaderProps {
    course: Course;
    onClick: () => void;
    userProgress?: any;
    onUpload?: (files: FileList | File[]) => void;
    isUploading?: boolean;
    uploadProgress?: { status: string; percent: number } | null;
}

const CourseHeader: React.FC<CourseHeaderProps> = ({
    course,
    onClick,
    userProgress,
    onUpload,
    isUploading,
    uploadProgress,
}) => {
    const courseLabel = course.course_code || course.course_id || course.course_name;
    const timeSpent = userProgress?.course_time_spent?.[course.course_id] || 0;
    const topicCount = Array.isArray(course.topics) ? course.topics.length : 0;

    return (
        <div className="w-full max-w-4xl mx-auto py-1.5">
            <div
                onClick={onClick}
                className="w-full flex items-center justify-between p-4 bg-[#FAF9F6] dark:bg-[#141414] border border-slate-200/90 dark:border-[#2A2A2A] rounded-2xl hover:border-slate-400 dark:hover:border-[#3A3A3A] hover:shadow-md transition-all duration-200 cursor-pointer gap-3 group"
            >
                <div className="flex-1 flex items-center gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-slate-200/60 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] flex items-center justify-center text-slate-700 dark:text-slate-200 group-hover:scale-105 transition-transform shrink-0">
                        <i className="bi bi-journal-bookmark text-lg"></i>
                    </div>
                    <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-bold text-slate-900 dark:text-white tracking-tight truncate group-hover:text-[#0A0A0A] dark:group-hover:text-[#FAFAFA] transition-colors">
                                {courseLabel}
                            </span>
                            {topicCount > 0 && (
                                <span className="text-[11px] font-semibold text-slate-600 dark:text-[#A3A3A3] bg-slate-200/50 dark:bg-[#1C1C1C] px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-[#2A2A2A]">
                                    {topicCount} {topicCount === 1 ? 'topic' : 'topics'}
                                </span>
                            )}
                        </div>
                        <span className="text-xs text-slate-500 dark:text-[#A3A3A3] truncate mt-0.5 font-normal">
                            {course.course_name}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                    {timeSpent > 0 && (
                        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-slate-100 dark:bg-[#1C1C1C] rounded-full border border-slate-200 dark:border-[#2A2A2A] text-[11px] font-medium text-slate-600 dark:text-[#A3A3A3]">
                            <i className="bi bi-clock text-slate-400 text-xs"></i>
                            <span>{formatDuration(timeSpent)}</span>
                        </div>
                    )}

                    {onUpload && (
                        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                            {isUploading ? (
                                <div className="flex flex-col gap-1 w-28">
                                    <div className="text-[10px] text-slate-600 dark:text-[#A3A3A3] font-medium truncate">
                                        {uploadProgress?.status || 'Uploading...'}
                                    </div>
                                    <div className="w-full bg-slate-200 dark:bg-[#2A2A2A] rounded-full h-1.5 overflow-hidden">
                                        <div
                                            className="bg-[#2563EB] dark:bg-[#3B82F6] h-1.5 rounded-full transition-all duration-300"
                                            style={{ width: `${uploadProgress?.percent || 0}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <label
                                    className="cursor-pointer p-2.5 rounded-xl hover:bg-slate-200/60 dark:hover:bg-[#1C1C1C] text-slate-500 hover:text-slate-900 dark:text-[#A3A3A3] dark:hover:text-white border border-slate-200 dark:border-[#2A2A2A] transition-colors"
                                    title="Upload Syllabus / Textbook"
                                >
                                    <i className="bi bi-cloud-arrow-up text-base"></i>
                                    <input
                                        type="file"
                                        accept="application/pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files.length > 0) {
                                                onUpload(e.target.files);
                                            }
                                            e.target.value = '';
                                        }}
                                    />
                                </label>
                            )}
                        </div>
                    )}

                    <div className="w-8 h-8 rounded-xl bg-slate-200/70 dark:bg-[#1C1C1C] flex items-center justify-center text-slate-500 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-all">
                        <i className="bi bi-chevron-right text-xs font-bold"></i>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- PROPS & ERROR BOUNDARY ---
export interface StudyGuideProps {
    userProfile: UserProfile;
    userProgress?: UserProgress;
    onNavigate?: (tab: string) => void;
    setCustomHeaderConfig?: (config: any) => void;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error?: any; info?: any }> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true, error };
    }

    componentDidCatch(error: any, info: any) {
        console.error('ErrorBoundary caught error:', error, info);
        this.setState({ error, info });
    }

    reset = () => this.setState({ hasError: false, error: null, info: null });

    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 text-center max-w-xl mx-auto my-12 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2A2A2A] rounded-3xl shadow-xl">
                    <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">Something went wrong</h3>
                    <p className="text-sm text-slate-500 dark:text-[#A3A3A3] mb-6">Could not load Study Guide. Please retry.</p>
                    <button onClick={this.reset} className="px-6 py-2.5 bg-[#2563EB] text-white font-bold rounded-xl shadow-md hover:bg-[#1D4ED8] transition-colors">
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

// --- MAIN CONTENT ---
const StudyGuideContent: React.FC<StudyGuideProps> = ({ userProfile, userProgress, onNavigate, setCustomHeaderConfig }) => {
    const { settings: appSettings } = useAppSettings();
    const { addToast } = useToast();

    const [courses, setCourses] = useState<Course[]>(() => {
        const key = `avelut_courses_${userProfile?.uid || 'anon'}`;
        return readCachedJson<Course[]>(key, []);
    });

    const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
    const [topicPickerCourse, setTopicPickerCourse] = useState<Course | null>(null);
    const [topicToOpen, setTopicToOpen] = useState<Topic | null>(null);
    const [isVoiceTutorialActive, setIsVoiceTutorialActive] = useState(false);
    const [activeExternalSession, setActiveExternalSession] = useState<VoiceTutorialSessionData | null>(null);
    const [pinnedTopics, setPinnedTopics] = useState<Array<any>>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'courses' | 'notebooks'>('notebooks');
    const [topicVisits, setTopicVisits] = useState<Record<string, number>>(() => {
        if (!userProfile?.uid) return {};
        return readCachedJson<Record<string, number>>(`avelut_topic_visits_${userProfile.uid}`, {});
    });
    const [isNotebookNestedOpen, setIsNotebookNestedOpen] = useState(false);
    const isNestedViewOpen = isNotebookNestedOpen || !!selectedCourse || !!topicPickerCourse || !!isVoiceTutorialActive || !!activeExternalSession;

    const getTopicLastVisited = useCallback((courseId: string, topicId: string): number | null => {
        const directKey = `${courseId}::${topicId}`;
        if (topicVisits[directKey]) return topicVisits[directKey];
        if (topicVisits[topicId]) return topicVisits[topicId];
        if (userProgress?.[topicId]?.timestamp) return userProgress[topicId].timestamp!;
        return null;
    }, [topicVisits, userProgress]);

    const handleOpenTopic = useCallback((course: Course, topic: Topic) => {
        const now = Date.now();
        const directKey = `${course.course_id}::${topic.topic_id}`;
        const nextVisits = { ...topicVisits, [directKey]: now, [topic.topic_id]: now };
        setTopicVisits(nextVisits);
        if (userProfile?.uid) {
            writeCachedJson(`avelut_topic_visits_${userProfile.uid}`, nextVisits);
        }
        setSelectedCourse(course);
        setTopicToOpen(topic);
        setTopicPickerCourse(null);
    }, [topicVisits, userProfile, appSettings]);

    const touchStartX = useRef<number | null>(null);
    const touchEndX = useRef<number | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        if (isNestedViewOpen) return;
        touchStartX.current = e.targetTouches[0].clientX;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (isNestedViewOpen) return;
        touchEndX.current = e.targetTouches[0].clientX;
    };

    const handleTouchEnd = () => {
        if (isNestedViewOpen) {
            touchStartX.current = null;
            touchEndX.current = null;
            return;
        }
        if (touchStartX.current === null || touchEndX.current === null) return;
        const distance = touchStartX.current - touchEndX.current;
        const isLeftSwipe = distance > 45;
        const isRightSwipe = distance < -45;

        if (isLeftSwipe && activeTab === 'courses') {
            setActiveTab('notebooks');
        }
        if (isRightSwipe && activeTab === 'notebooks') {
            setActiveTab('courses');
        }

        touchStartX.current = null;
        touchEndX.current = null;
    };

    // Configure Main App Header with Centered Tabs Switcher and Back Button
    useEffect(() => {
        if (!selectedCourse && !isVoiceTutorialActive && !activeExternalSession && setCustomHeaderConfig) {
            setCustomHeaderConfig({
                leftActions: (
                    <button
                        type="button"
                        onClick={() => {
                            if (onNavigate) {
                                onNavigate('chat');
                            } else {
                                window.dispatchEvent(new CustomEvent('app-go-back'));
                            }
                        }}
                        className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-xl border border-[#E3E9F1] dark:border-[#2A2A2A] bg-white dark:bg-[#141414] hover:bg-slate-50 dark:hover:bg-[#1C1C1C] text-[#0F172A] dark:text-white text-sm font-bold active:scale-95 cursor-pointer transition-all shrink-0 shadow-2xs"
                        aria-label="Back"
                        title="Back"
                    >
                        <i className="bi bi-arrow-left text-sm font-bold text-[#2563EB] dark:text-[#3B82F6]"></i>
                    </button>
                ),
                title: (
                    <div className="inline-flex items-center p-1 bg-[#F1F5F9] dark:bg-[#1C1C1C] rounded-2xl border border-[#E3E9F1] dark:border-[#2A2A2A] shadow-2xs">
                        <button
                            type="button"
                            onClick={() => setActiveTab('courses')}
                            className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                                activeTab === 'courses'
                                    ? 'bg-white dark:bg-[#141414] text-[#2563EB] dark:text-[#3B82F6] shadow-xs'
                                    : 'text-[#64748B] dark:text-[#A3A3A3] hover:text-[#0F172A] dark:hover:text-white'
                            }`}
                        >
                            <i className="bi bi-mortarboard text-sm"></i>
                            <span>Study Guide</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('notebooks')}
                            className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                                activeTab === 'notebooks'
                                    ? 'bg-white dark:bg-[#141414] text-[#2563EB] dark:text-[#3B82F6] shadow-xs'
                                    : 'text-[#64748B] dark:text-[#A3A3A3] hover:text-[#0F172A] dark:hover:text-white'
                            }`}
                        >
                            <i className="bi bi-journal-bookmark text-sm"></i>
                            <span>Notebooks</span>
                        </button>
                    </div>
                ),
                hideTitle: false,
                hideDefaultRightActions: false,
                hideBottomNav: false,
                className: 'bg-[#F6F6F3]/95 dark:bg-[#141414]/95 border-b border-[#E3E9F1] dark:border-[#2A2A2A] backdrop-blur-md',
            });
        }
    }, [selectedCourse, isVoiceTutorialActive, activeExternalSession, activeTab, setCustomHeaderConfig, onNavigate]);

    // Reset the custom header IMMEDIATELY when leaving this view (e.g. pressing the
    // back arrow to Dashboard) so the default heading text and right-side icons
    // (calendar, messenger, notification bell) are restored without delay.
    useEffect(() => {
        return () => {
            if (setCustomHeaderConfig) {
                setCustomHeaderConfig(null);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Check for incoming voice tutorial session (e.g. from Visual Scanner Detailed Tutorial)
    useEffect(() => {
        const cachedSession = readCachedJson<VoiceTutorialSessionData | null>('avelut_active_voice_tutorial', null);
        if (cachedSession && (cachedSession as any).source === 'visual_solver') {
            setActiveExternalSession(cachedSession);
            // Immediately clear so refreshing doesn't keep opening it
            writeCachedJson('avelut_active_voice_tutorial', null);
        } else if (cachedSession) {
            // Clean up any stale session from localStorage so it doesn't linger across refreshes
            writeCachedJson('avelut_active_voice_tutorial', null);
        }
    }, []);

    const [filter, setFilter] = useState(() => ({
        searchTerm: '',
        semester: (userProfile?.default_semester_tab || 'second') as 'all' | 'first' | 'second',
    }));

    const { uploadTextbook, uploadProgress, isUploadingCourseKey } = useSharedTextbookUpload();

    const [showLimitModal, setShowLimitModal] = useState(false);
    const [limitModalData, setLimitModalData] = useState({ balance: 0, cost: 0 });
    const { attemptApiCall } = useApiLimiter();

    const [isExtractingCourses, setIsExtractingCourses] = useState(false);
    const [manualCourseCode, setManualCourseCode] = useState('');
    const [isSavingManual, setIsSavingManual] = useState(false);
    const [isManualMode, setIsManualMode] = useState(false);

    // Add Course Modal State
    const [showAddCourseModal, setShowAddCourseModal] = useState(false);
    const [addCourseTab, setAddCourseTab] = useState<'pdf' | 'manual'>('manual');
    const [manualCourseForm, setManualCourseForm] = useState({
        code: '',
        name: '',
        level: userProfile?.level || '100lvl',
        semester: 'first' as 'first' | 'second',
        description: '',
    });
    const [isSavingCourseForm, setIsSavingCourseForm] = useState(false);

    // Add Topic Modal State
    const [showAddTopicModal, setShowAddTopicModal] = useState(false);
    const [targetCourseForTopic, setTargetCourseForTopic] = useState<Course | null>(null);
    const [addTopicTab, setAddTopicTab] = useState<'doc' | 'manual'>('doc');
    const [docUploadFile, setDocUploadFile] = useState<File | null>(null);
    const [isExtractingTopics, setIsExtractingTopics] = useState(false);
    const [extractedTopics, setExtractedTopics] = useState<Array<Topic & { selected: boolean }>>([]);
    const [isSavingExtractedTopics, setIsSavingExtractedTopics] = useState(false);
    const [manualTopicForm, setManualTopicForm] = useState({
        topic_name: '',
        topic_context: '',
        start_point: '',
        end_point: '',
    });
    const [isGeneratingContext, setIsGeneratingContext] = useState(false);
    const [isSavingManualTopic, setIsSavingManualTopic] = useState(false);

    // Load pinned topics
    useEffect(() => {
        if (!userProfile) return;
        const loaded = readCachedJson<Array<any>>(`pinned_topics_${userProfile.uid}`, []);
        setPinnedTopics(loaded);
    }, [userProfile]);

    const savePinnedTopics = (next: Array<any>) => {
        if (!userProfile) return;
        setPinnedTopics(next);
        writeCachedJson(`pinned_topics_${userProfile.uid}`, next);
    };

    const togglePinTopic = (course: Course, topic: any) => {
        const topicId = topic.topic_id || topic.id || topic.title;
        const isPinned = pinnedTopics.some(p => p.topic.topic_id === topicId || p.topic.id === topicId);
        let next: any[];
        if (isPinned) {
            next = pinnedTopics.filter(p => (p.topic.topic_id || p.topic.id || p.topic.title) !== topicId);
            addToast('Topic unpinned', 'info');
        } else {
            next = [{ topic, course, pinnedAt: Date.now() }, ...pinnedTopics];
            addToast('Topic pinned to top!', 'success');
        }
        savePinnedTopics(next.slice(0, 20));
    };

    const handleSaveManualCourse = async () => {
        if (!manualCourseCode.trim()) {
            addToast('Please enter a course code/name', 'error');
            return;
        }
        if (!userProfile.school_id || !userProfile.college_id || !userProfile.department_id || !userProfile.level) {
            return addToast('Please complete your profile (School, College, Department, Level) first.', 'error');
        }

        const cost = getFeatureCost('study_guide_extraction', appSettings) || 0;
        const creditCheck = checkAICredits(userProfile, cost, appSettings);
        if (!creditCheck.allowed) {
            setLimitModalData({ balance: creditCheck.balance, cost: creditCheck.cost });
            setShowLimitModal(true);
            return;
        }

        setIsSavingManual(true);
        try {
            const ai = createAvelutAI(appSettings, userProfile);
            if (!ai) throw new Error('Avelut AI is not configured in App Controls.');
            const aiModel = getFeatureModel('study_guide_extraction', appSettings) || appSettings?.alibaba_model || 'qwen3.8-omni-flash';

            const prompt = `Based on this course code/name: "${manualCourseCode}", generate a short, one-line professional course description. Return a JSON object with 'course_name' (guessed full name if possible, else the code), 'course_code' (standardized uppercase code), and 'description'.`;

            const callRes = await attemptApiCall(() => ai.models.generateContent({
                model: aiModel,
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            course_name: { type: Type.STRING },
                            course_code: { type: Type.STRING },
                            description: { type: Type.STRING }
                        },
                        required: ['course_name', 'course_code', 'description']
                    }
                }
            }));

            if (!callRes.success || !callRes.data) throw new Error(callRes.message || "Failed to generate course info");
            const text = getResponseText(callRes.data);
            if (!text) throw new Error("Failed to get response");
            const data = JSON.parse(text) as Partial<{ course_name: unknown; course_code: unknown; description: unknown }>;

            const courseName = typeof data.course_name === 'string' ? data.course_name.trim() : '';
            const courseCode = typeof data.course_code === 'string' ? data.course_code.trim() : '';
            const description = typeof data.description === 'string' ? data.description.trim() : '';

            if (!courseName || !courseCode || !description) {
                throw new Error('AI returned invalid course data. Please try again.');
            }

            const courseId = courseCode.toLowerCase().replace(/\s+/g, '');
            const courseData = {
                course_id: courseId,
                course_name: courseName,
                course_code: courseCode.toUpperCase(),
                description,
                level: userProfile.level,
                semester: filter.semester === 'all' ? 'first' : filter.semester,
                course_status: 'active'
            };

            const updates: any = {};
            const deptPath = `${userProfile.school_id}/colleges/${userProfile.college_id}/departments/${userProfile.department_id}`;
            updates[`schools_data/${deptPath}/levels/${userProfile.level}/courses/${courseId}`] = courseData;
            updates[`departments_data/${userProfile.department_id}/course_list/${courseId}`] = courseData;

            await update(dbRef(db), updates);
            await supabaseDataService.upsertCourse({
                course_id: courseId,
                course_code: courseCode.toUpperCase(),
                course_name: courseName,
                title: courseName,
                code: courseCode.toUpperCase(),
                level: userProfile.level,
                semester: filter.semester === 'all' ? 1 : (filter.semester === 'second' ? 2 : 1),
                description,
                department_id: userProfile.department_id,
                school_id: userProfile.school_id,
            });
            setCourses(prev => {
                const next = [courseData as Course, ...prev.filter(c => c.course_id !== courseId)];
                writeCachedJson(`avelut_courses_${userProfile.uid}`, next);
                return next;
            });
            void deductAICredits(userProfile.uid, cost, 'Study Guide Manual Course Generation', appSettings);
            addToast(`Added ${courseData.course_code} successfully!`, 'success');
            setManualCourseCode('');
            setIsManualMode(false);
            setShowAddCourseModal(false);
        } catch (err: any) {
            console.error("Error saving manual course:", err);
            addToast(err.message || "Failed to save course", "error");
        } finally {
            setIsSavingManual(false);
        }
    };

    const handleExtractCourses = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return addToast('Please upload a PDF file.', 'error');
        if (!userProfile.school_id || !userProfile.college_id || !userProfile.department_id || !userProfile.level) {
            return addToast('Please complete your profile (School, College, Department, Level) first.', 'error');
        }

        const cost = getFeatureCost('study_guide_extraction', appSettings) || 0;
        const creditCheck = checkAICredits(userProfile, cost, appSettings);
        if (!creditCheck.allowed) {
            setLimitModalData({ balance: creditCheck.balance, cost: creditCheck.cost });
            setShowLimitModal(true);
            return;
        }

        setIsExtractingCourses(true);
        try {
            const ai = createAvelutAI(appSettings, userProfile);
            // Prefer Alibaba Omni model (qwen3.8-omni-flash). Do not force VL-only models.
            const aiModel = getFeatureModel('study_guide_extraction', appSettings) || appSettings?.alibaba_model || 'qwen3.8-omni-flash';

            // DashScope Chat Completions cannot open PDF via image_url.
            // Extract text client-side so the model actually reads the document.
            const { extractTextFromPDF } = await import('../utils/pdfExtraction');
            const pdfText = await extractTextFromPDF(file);
            const truncated = (pdfText || '').slice(0, 120000).trim();
            if (!truncated) {
                throw new Error('Could not read any text from this PDF. Try a text-based PDF (not a scanned image-only file), or convert pages to images.');
            }

            const prompt = `Analyze this course form / curriculum document and extract all courses listed.

DOCUMENT TEXT:
---
${truncated}
---

Extract every course with:
- course_name (string)
- course_code (string, e.g. "MEE 301")

Return ONLY a JSON object with a "courses" array.`;

            const callRes = await attemptApiCall(() => ai.models.generateContent({
                model: aiModel,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            courses: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: { course_name: { type: Type.STRING }, course_code: { type: Type.STRING } },
                                    required: ['course_name', 'course_code']
                                }
                            }
                        },
                        required: ['courses']
                    }
                },
            }));

            if (!callRes.success || !callRes.data) throw new Error(callRes.message || "Failed to get response from AI");
            const text = getResponseText(callRes.data);
            if (!text) throw new Error("Failed to get response from AI");
            const data = JSON.parse(text);

            if (data.courses && Array.isArray(data.courses) && data.courses.length > 0) {
                const updates: any = {};
                const deptPath = `${userProfile.school_id}/colleges/${userProfile.college_id}/departments/${userProfile.department_id}`;
                data.courses.forEach((c: any) => {
                    const courseId = c.course_code.trim().toLowerCase().replace(/\s+/g, '');
                    const courseData = {
                        course_id: courseId,
                        course_name: c.course_name.trim(),
                        course_code: c.course_code.trim().toUpperCase(),
                        level: userProfile.level,
                        semester: filter.semester === 'all' ? 'first' : filter.semester,
                        course_status: 'active'
                    };
                    updates[`schools_data/${deptPath}/levels/${userProfile.level}/courses/${courseId}`] = courseData;
                    updates[`departments_data/${userProfile.department_id}/course_list/${courseId}`] = courseData;
                });
                await update(dbRef(db), updates);
                await Promise.all(
                    data.courses.map((c: any) => {
                        const courseId = c.course_code.trim().toLowerCase().replace(/\s+/g, '');
                        return supabaseDataService.upsertCourse({
                            course_id: courseId,
                            course_code: c.course_code.trim().toUpperCase(),
                            course_name: c.course_name.trim(),
                            title: c.course_name.trim(),
                            code: c.course_code.trim().toUpperCase(),
                            level: userProfile.level,
                            semester: filter.semester === 'all' ? 1 : (filter.semester === 'second' ? 2 : 1),
                            description: `Extracted course for ${userProfile.department_id}`,
                            department_id: userProfile.department_id,
                            school_id: userProfile.school_id,
                        });
                    })
                );

                const newExtractedCourses: Course[] = data.courses.map((c: any) => {
                    const courseId = c.course_code.trim().toLowerCase().replace(/\s+/g, '');
                    return {
                        course_id: courseId,
                        course_name: c.course_name.trim(),
                        course_code: c.course_code.trim().toUpperCase(),
                        level: userProfile.level,
                        semester: filter.semester === 'all' ? 'first' : filter.semester,
                        topics: [],
                    };
                });
                setCourses(prev => {
                    const merged = [...prev];
                    newExtractedCourses.forEach(nc => {
                        const idx = merged.findIndex(x => x.course_id === nc.course_id);
                        if (idx >= 0) {
                            merged[idx] = { ...merged[idx], ...nc };
                        } else {
                            merged.unshift(nc);
                        }
                    });
                    writeCachedJson(`avelut_courses_${userProfile.uid}`, merged);
                    return merged;
                });
                setShowAddCourseModal(false);

                void deductAICredits(userProfile.uid, cost, 'Study Guide PDF Extraction', appSettings);
                addToast(`Successfully extracted and saved ${data.courses.length} courses!`, 'success');
            } else {
                throw new Error("No courses found in the document");
            }

        } catch (err: any) {
            console.error(err);
            addToast(err.message || 'Failed to extract courses', 'error');
        } finally {
            setIsExtractingCourses(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleSaveManualCourseForm = async () => {
        const code = manualCourseForm.code.trim().toUpperCase();
        if (!code) {
            addToast('Please enter a course code (e.g., MTH101)', 'error');
            return;
        }
        if (!userProfile.school_id || !userProfile.college_id || !userProfile.department_id || !userProfile.level) {
            addToast('Please complete your profile (School, College, Department, Level) first.', 'error');
            return;
        }

        setIsSavingCourseForm(true);
        try {
            let courseName = manualCourseForm.name.trim();
            let description = manualCourseForm.description.trim();

            if (!courseName) {
                try {
                    const ai = createAvelutAI(appSettings, userProfile);
                    if (ai) {
                        const aiModel = getFeatureModel('study_guide_extraction', appSettings) || appSettings?.alibaba_model || 'qwen3.8-omni-flash';
                        const prompt = `Based on this course code: "${code}", generate a standard course name and 1-line description. Return JSON with 'course_name' and 'description'.`;
                        const res = await attemptApiCall(() => ai.models.generateContent({
                            model: aiModel,
                            contents: prompt,
                            config: {
                                responseMimeType: 'application/json',
                                responseSchema: {
                                    type: Type.OBJECT,
                                    properties: {
                                        course_name: { type: Type.STRING },
                                        description: { type: Type.STRING }
                                    },
                                    required: ['course_name', 'description']
                                }
                            }
                        }));
                        if (res.success && res.data) {
                            const txt = getResponseText(res.data);
                            if (txt) {
                                const parsed = JSON.parse(txt);
                                if (parsed.course_name) courseName = parsed.course_name.trim();
                                if (parsed.description) description = parsed.description.trim();
                            }
                        }
                    }
                } catch (e) {
                    console.warn('AI course name generation skipped:', e);
                }
            }

            if (!courseName) courseName = code;
            if (!description) description = `${code} course syllabus for ${userProfile.department_id}`;

            const courseId = code.toLowerCase().replace(/\s+/g, '');
            const courseLevel = manualCourseForm.level || userProfile.level || '100lvl';
            const courseSemester = manualCourseForm.semester;

            const courseData = {
                course_id: courseId,
                course_name: courseName,
                course_code: code,
                description,
                level: courseLevel,
                semester: courseSemester,
                course_status: 'active',
                topics: [],
            };

            const updates: any = {};
            const deptPath = `${userProfile.school_id}/colleges/${userProfile.college_id}/departments/${userProfile.department_id}`;
            updates[`schools_data/${deptPath}/levels/${courseLevel}/courses/${courseId}`] = courseData;
            updates[`departments_data/${userProfile.department_id}/course_list/${courseId}`] = courseData;
            await update(dbRef(db), updates);

            await supabaseDataService.upsertCourse({
                course_id: courseId,
                course_code: code,
                course_name: courseName,
                title: courseName,
                code: code,
                level: courseLevel,
                semester: courseSemester === 'second' ? 2 : 1,
                description,
                department_id: userProfile.department_id,
                school_id: userProfile.school_id,
            });

            setCourses(prev => {
                const next = [courseData as Course, ...prev.filter(c => c.course_id !== courseId)];
                writeCachedJson(`avelut_courses_${userProfile.uid}`, next);
                return next;
            });

            addToast(`Course ${code} added successfully!`, 'success');
            setShowAddCourseModal(false);
            setManualCourseForm({
                code: '',
                name: '',
                level: userProfile?.level || '100lvl',
                semester: 'first',
                description: '',
            });
        } catch (err: any) {
            console.error('Error saving course form:', err);
            addToast(err.message || 'Failed to save course', 'error');
        } finally {
            setIsSavingCourseForm(false);
        }
    };

    const handleExtractTopicsFromDoc = async () => {
        if (!docUploadFile) {
            addToast('Please select a document or textbook file first.', 'error');
            return;
        }
        const target = targetCourseForTopic || topicPickerCourse;
        if (!target) {
            addToast('No course selected.', 'error');
            return;
        }

        const cost = getFeatureCost('study_guide_extraction', appSettings) || 0;
        const creditCheck = checkAICredits(userProfile, cost, appSettings);
        if (!creditCheck.allowed) {
            setLimitModalData({ balance: creditCheck.balance, cost: creditCheck.cost });
            setShowLimitModal(true);
            return;
        }

        setIsExtractingTopics(true);
        try {
            const ai = createAvelutAI(appSettings, userProfile);
            if (!ai) throw new Error('AI service is not configured in App Controls.');
            const aiModel = getFeatureModel('study_guide_extraction', appSettings) || appSettings?.alibaba_model || 'qwen3.8-omni-flash';

            const fileName = docUploadFile.name.toLowerCase();
            const isPdf = fileName.endsWith('.pdf') || docUploadFile.type === 'application/pdf';

            const prompt = `You are an academic curriculum and syllabus specialist. 
Analyze the provided document for the course "${target.course_name} (${target.course_code || target.course_id})".
Extract all distinct curriculum syllabus topics, chapters, modules, or lecture topics.
For each topic:
- topic_name: clear, standardized, professional topic title
- topic_context: 1 to 3 sentences summarizing the foundational principles, core equations/concepts, and examination scope
- start_point: (optional) starting section, chapter, or page number
- end_point: (optional) ending section, chapter, or page number

Ensure topics are returned in logical sequential curriculum order.
Return a JSON object containing a "topics" array.`;

            let contents: any;
            if (isPdf) {
                // Extract text so the model can read the syllabus (PDF cannot be sent as image_url on DashScope)
                const { extractTextFromPDF } = await import('../utils/pdfExtraction');
                const pdfText = await extractTextFromPDF(docUploadFile);
                const truncated = (pdfText || '').slice(0, 120000).trim();
                if (!truncated) {
                    throw new Error('Could not read text from this PDF. Use a text-based PDF or convert scanned pages to images.');
                }
                contents = [
                    {
                        role: 'user',
                        parts: [
                            { text: `${prompt}\n\n=== DOCUMENT TEXT ===\n${truncated}` }
                        ]
                    }
                ];
            } else {
                const fileText = await docUploadFile.text();
                const truncated = fileText.slice(0, 50000);
                contents = [
                    {
                        role: 'user',
                        parts: [
                            { text: `${prompt}\n\n=== DOCUMENT TEXT ===\n${truncated}` }
                        ]
                    }
                ];
            }

            const callRes = await attemptApiCall(() => ai.models.generateContent({
                model: aiModel,
                contents,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            topics: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        topic_name: { type: Type.STRING },
                                        topic_context: { type: Type.STRING },
                                        start_point: { type: Type.STRING },
                                        end_point: { type: Type.STRING },
                                    },
                                    required: ['topic_name']
                                }
                            }
                        },
                        required: ['topics']
                    }
                }
            }));

            if (!callRes.success || !callRes.data) {
                throw new Error(callRes.message || 'Failed to extract topics from document.');
            }

            const responseText = getResponseText(callRes.data);
            if (!responseText) throw new Error('Empty response received from AI.');
            const parsed = JSON.parse(responseText);

            if (!parsed.topics || !Array.isArray(parsed.topics) || parsed.topics.length === 0) {
                throw new Error('No topics could be identified in the document.');
            }

            const mapped = parsed.topics.map((t: any, idx: number) => {
                const name = (t.topic_name || '').trim();
                const id = `${target.course_id}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}_${idx}`;
                return {
                    topic_id: id,
                    topic_name: name,
                    topic_context: (t.topic_context || '').trim() || `Core concepts and curriculum for ${name}.`,
                    start_point: (t.start_point || '').trim(),
                    end_point: (t.end_point || '').trim(),
                    is_complete: false,
                    selected: true,
                };
            }).filter((t: any) => Boolean(t.topic_name));

            setExtractedTopics(mapped);
            addToast(`Found ${mapped.length} topics! Review and confirm below.`, 'success');
        } catch (err: any) {
            console.error('Error extracting topics:', err);
            addToast(err.message || 'Failed to extract topics', 'error');
        } finally {
            setIsExtractingTopics(false);
        }
    };

    const handleSaveExtractedTopics = async () => {
        const selected = extractedTopics.filter(t => t.selected);
        if (selected.length === 0) {
            addToast('Please select at least one topic to add.', 'error');
            return;
        }
        const target = targetCourseForTopic || topicPickerCourse;
        if (!target) return;

        setIsSavingExtractedTopics(true);
        try {
            const existingTopics = Array.isArray(target.topics) ? target.topics : [];
            const cost = getFeatureCost('study_guide_extraction', appSettings) || 0;

            await Promise.all(
                selected.map((t, idx) => supabaseDataService.upsertTopic({
                    topic_id: t.topic_id,
                    course_id: target.course_id,
                    topic_name: t.topic_name,
                    topic_context: t.topic_context,
                    start_point: t.start_point,
                    end_point: t.end_point,
                    topic_order: existingTopics.length + idx + 1,
                }))
            );

            const cleanSelected = selected.map(({ selected: _, ...rest }) => rest);
            const updatedTopics = mergeTopics(existingTopics, cleanSelected);

            const deptId = userProfile.department_id;
            const courseId = target.course_id;
            const updates: any = {};
            if (deptId && courseId) {
                updates[`departments_data/${deptId}/course_list/${courseId}/topics`] = updatedTopics;
            }
            if (userProfile.school_id && userProfile.college_id && deptId && target.level) {
                const deptPath = `${userProfile.school_id}/colleges/${userProfile.college_id}/departments/${deptId}`;
                updates[`schools_data/${deptPath}/levels/${target.level}/courses/${courseId}/topics`] = updatedTopics;
            }
            if (target.textbook_shared_key) {
                updates[`textbook_contexts/shared/${target.textbook_shared_key}/syllabus`] = updatedTopics;
            }
            await update(dbRef(db), updates);

            const updatedCourse: Course = { ...target, topics: updatedTopics };
            setCourses(prev => {
                const next = prev.map(c => c.course_id === target.course_id ? updatedCourse : c);
                writeCachedJson(`avelut_courses_${userProfile.uid}`, next);
                return next;
            });

            if (topicPickerCourse && topicPickerCourse.course_id === target.course_id) {
                setTopicPickerCourse(updatedCourse);
            }

            void deductAICredits(userProfile.uid, cost, 'Study Guide Topic Extraction', appSettings);
            addToast(`Successfully added ${selected.length} topics to ${target.course_code || target.course_name}!`, 'success');

            setShowAddTopicModal(false);
            setExtractedTopics([]);
            setDocUploadFile(null);
        } catch (err: any) {
            console.error('Error saving extracted topics:', err);
            addToast(err.message || 'Failed to save topics', 'error');
        } finally {
            setIsSavingExtractedTopics(false);
        }
    };

    const handleSaveManualTopic = async () => {
        if (!manualTopicForm.topic_name.trim()) {
            addToast('Please enter a topic title.', 'error');
            return;
        }
        const target = targetCourseForTopic || topicPickerCourse;
        if (!target) return;

        setIsSavingManualTopic(true);
        try {
            const topicName = manualTopicForm.topic_name.trim();
            const topicId = `${target.course_id}_${topicName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
            const existingTopics = Array.isArray(target.topics) ? target.topics : [];

            let context = manualTopicForm.topic_context.trim();
            if (!context) {
                context = `Core study module for ${topicName} in ${target.course_name || target.course_code}.`;
            }

            const newTopic: Topic = {
                topic_id: topicId,
                topic_name: topicName,
                topic_context: context,
                start_point: manualTopicForm.start_point.trim() || undefined,
                end_point: manualTopicForm.end_point.trim() || undefined,
                is_complete: false,
            };

            await supabaseDataService.upsertTopic({
                topic_id: newTopic.topic_id,
                course_id: target.course_id,
                topic_name: newTopic.topic_name,
                topic_context: newTopic.topic_context,
                start_point: newTopic.start_point,
                end_point: newTopic.end_point,
                topic_order: existingTopics.length + 1,
            });

            const updatedTopics = [...existingTopics, newTopic];

            const deptId = userProfile.department_id;
            const courseId = target.course_id;
            const updates: any = {};
            if (deptId && courseId) {
                updates[`departments_data/${deptId}/course_list/${courseId}/topics`] = updatedTopics;
            }
            if (userProfile.school_id && userProfile.college_id && deptId && target.level) {
                const deptPath = `${userProfile.school_id}/colleges/${userProfile.college_id}/departments/${deptId}`;
                updates[`schools_data/${deptPath}/levels/${target.level}/courses/${courseId}/topics`] = updatedTopics;
            }
            if (target.textbook_shared_key) {
                updates[`textbook_contexts/shared/${target.textbook_shared_key}/syllabus`] = updatedTopics;
            }
            await update(dbRef(db), updates);

            const updatedCourse: Course = { ...target, topics: updatedTopics };
            setCourses(prev => {
                const next = prev.map(c => c.course_id === target.course_id ? updatedCourse : c);
                writeCachedJson(`avelut_courses_${userProfile.uid}`, next);
                return next;
            });

            if (topicPickerCourse && topicPickerCourse.course_id === target.course_id) {
                setTopicPickerCourse(updatedCourse);
            }

            addToast(`Topic "${newTopic.topic_name}" added successfully!`, 'success');
            setManualTopicForm({ topic_name: '', topic_context: '', start_point: '', end_point: '' });
            setShowAddTopicModal(false);
        } catch (err: any) {
            console.error('Error adding topic manually:', err);
            addToast(err.message || 'Failed to add topic', 'error');
        } finally {
            setIsSavingManualTopic(false);
        }
    };

    const handleAutoGenerateTopicContext = async () => {
        if (!manualTopicForm.topic_name.trim()) {
            addToast('Please enter a topic title first.', 'error');
            return;
        }
        const target = targetCourseForTopic || topicPickerCourse;
        setIsGeneratingContext(true);
        try {
            const ai = createAvelutAI(appSettings, userProfile);
            if (!ai) throw new Error('AI service not available.');
            const aiModel = getFeatureModel('study_guide_extraction', appSettings) || appSettings?.alibaba_model || 'qwen3.8-omni-flash';
            const prompt = `Write a concise 2-sentence academic overview/scope for the topic "${manualTopicForm.topic_name}" in the course "${target?.course_name || 'Academic Studies'}". Return only the text.`;
            const res = await attemptApiCall(() => ai.models.generateContent({
                model: aiModel,
                contents: prompt
            }));
            if (res.success && res.data) {
                const text = getResponseText(res.data);
                if (text) {
                    setManualTopicForm(prev => ({ ...prev, topic_context: text.trim() }));
                    addToast('Topic overview generated!', 'info');
                }
            }
        } catch (err: any) {
            console.warn('AI context generation failed:', err);
        } finally {
            setIsGeneratingContext(false);
        }
    };

    useEffect(() => {
        const fetchCourses = async () => {
            const cached = readCachedJson<Course[]>(`avelut_courses_${userProfile.uid}`, []);
            if (cached && cached.length > 0) {
                setCourses(cached);
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

                // 1. Fetch courses directly from Supabase courses table (filtered by department & level)
                const supabaseCourses = await supabaseDataService.fetchCourses(
                    userProfile.department_id,
                    userProfile.level
                );

                // 2. Also query department data via RTDB shim (which bridges to Supabase)
                let resolvedDepartmentData: any = null;
                const deptCoursesSnap = await get(dbRef(db, `departments_data/${userProfile.department_id}`));
                if (deptCoursesSnap.exists()) {
                    resolvedDepartmentData = deptCoursesSnap.val();
                }

                const allDepartmentCourses: any[] = resolvedDepartmentData?.course_list
                    ? (Array.isArray(resolvedDepartmentData.course_list)
                        ? resolvedDepartmentData.course_list
                        : Object.values(resolvedDepartmentData.course_list))
                    : [];
                const coursesForLevel = allDepartmentCourses.filter((course) => (
                    normalizeLevelValue(course.level) === normalizedUserLevel
                ));

                // 3. Merge Supabase courses + department courses
                const mergedCoursesMap = new Map<string, Course>();

                // Add Supabase courses first
                supabaseCourses.forEach((c) => {
                    if (c && c.course_id) {
                        mergedCoursesMap.set(c.course_id.toLowerCase(), c);
                    }
                });

                // Merge in any courses from course_list
                coursesForLevel.forEach((c: any) => {
                    const normId = (c.course_id || c.course_code || '').toLowerCase().trim();
                    if (!normId) return;
                    if (!mergedCoursesMap.has(normId)) {
                        mergedCoursesMap.set(normId, {
                            ...c,
                            course_id: normId,
                            course_name: c.course_name || c.title || normId.toUpperCase(),
                            course_code: c.course_code || c.code || normId.toUpperCase(),
                            level: c.level || userProfile.level || '100lvl',
                            semester: c.semester === 'second' || c.semester === 2 ? 'second' : 'first',
                            topics: Array.isArray(c.topics) ? c.topics : [],
                        });
                    }
                });

                const rawCourseList = Array.from(mergedCoursesMap.values());

                // 4. Enrich syllabus topics (from textbook_contexts if topics are empty)
                const enrichedCourses: Course[] = await Promise.all(
                    rawCourseList.map(async (course) => {
                        try {
                            if (Array.isArray(course.topics) && course.topics.length > 0) {
                                return course;
                            }

                            if (course.textbook_shared_key) {
                                const sharedRef = dbRef(db, `textbook_contexts/shared/${course.textbook_shared_key}`);
                                const sharedSnap = await get(sharedRef);
                                if (sharedSnap.exists()) {
                                    const sharedVal = sharedSnap.val();
                                    const syllabus = Array.isArray(sharedVal.syllabus) ? sharedVal.syllabus.map((t: any, i: number) => sanitizeTopicMetadata(t, i)) : [];
                                    if (syllabus.length > 0) return { ...course, topics: syllabus };
                                }
                            }

                            const perDeptRef = dbRef(db, `textbook_contexts/${userProfile.department_id}/${course.level}/${course.course_name}`);
                            const perDeptSnap = await get(perDeptRef);
                            if (perDeptSnap.exists()) {
                                const val = perDeptSnap.val();
                                const syllabus = Array.isArray(val.syllabus) ? val.syllabus.map((t: any, i: number) => sanitizeTopicMetadata(t, i)) : [];
                                if (syllabus.length > 0) return { ...course, topics: syllabus };
                            }

                            // Provide foundational default topic if course has no topics
                            return {
                                ...course,
                                topics: [
                                    {
                                        topic_id: `${course.course_id}_core`,
                                        topic_name: 'Core Principles & Syllabus Overview',
                                        topic_context: `Overview, foundational principles, and core examination scope for ${course.course_name} (${course.course_code || course.course_id.toUpperCase()}).`,
                                        start_point: 'Introduction',
                                        end_point: 'Summary',
                                        is_complete: false,
                                    },
                                ],
                            };
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

    const filteredCourses = courses.filter(course => {
        if (filter.semester !== 'all' && course.semester !== filter.semester) {
            return false;
        }

        const searchTerm = filter.searchTerm.trim().toLowerCase();
        if (!searchTerm) {
            return true;
        }

        return [course.course_name, course.course_code, course.course_id]
            .filter(Boolean)
            .some(value => value!.toLowerCase().includes(searchTerm));
    });

    // Stable session object so VoiceTutorialPage is not reset on every parent re-render
    const memoizedVoiceSessionData = useMemo<VoiceTutorialSessionData | null>(() => {
        if (activeExternalSession) return activeExternalSession;
        if (!isVoiceTutorialActive || !selectedCourse) return null;
        const targetTopic = topicToOpen || (Array.isArray(selectedCourse.topics) && selectedCourse.topics.length > 0
            ? selectedCourse.topics[0]
            : {
                topic_id: 'core_principles',
                topic_name: 'Core Principles & Overview',
                topic_context: `Overview and principles of ${selectedCourse.course_name || 'Course'}`,
            });
        return {
            course: selectedCourse,
            topic: targetTopic,
            syllabusContext: targetTopic.topic_context || `Course: ${selectedCourse.course_name}`,
        };
    }, [activeExternalSession, isVoiceTutorialActive, selectedCourse, topicToOpen]);

    // ── 1. ACTIVE REALTIME VOICE & BLACKBOARD TUTORIAL VIEW ──
    if ((activeExternalSession || isVoiceTutorialActive) && memoizedVoiceSessionData) {
        return (
            <VoiceTutorialPage
                userProfile={userProfile}
                appSettings={appSettings}
                initialSessionData={memoizedVoiceSessionData}
                onBack={() => {
                    setIsVoiceTutorialActive(false);
                    setActiveExternalSession(null);
                    writeCachedJson('avelut_active_voice_tutorial', null);
                    if (setCustomHeaderConfig) {
                        setCustomHeaderConfig(null);
                    }
                }}
                onNavigate={onNavigate}
                setCustomHeaderConfig={setCustomHeaderConfig}
            />
        );
    }

    // ── 2. DEFAULT COURSE CHAT TUTOR (SOCRATIC BIT-BY-BIT TEACHING) ──
    if (selectedCourse) {
        const resolvedTopic: Topic = topicToOpen || (Array.isArray(selectedCourse.topics) && selectedCourse.topics.length > 0 ? selectedCourse.topics[0] : {
            topic_id: 'core_principles',
            topic_name: 'Core Principles & Overview',
            topic_context: `Overview and principles of ${selectedCourse.course_name}`,
        });

        return (
            <CourseChatTutor
                course={selectedCourse}
                topic={resolvedTopic}
                userProfile={userProfile}
                onBack={() => {
                    setSelectedCourse(null);
                    setTopicToOpen(null);
                    if (setCustomHeaderConfig) {
                        setCustomHeaderConfig(null);
                    }
                }}
                onOpenVoiceTutorial={() => setIsVoiceTutorialActive(true)}
                setCustomHeaderConfig={setCustomHeaderConfig}
            />
        );
    }

    // ── TOPIC PICKER MODAL ──
    const renderTopicPicker = () => {
        if (!topicPickerCourse) return null;
        const topics = Array.isArray(topicPickerCourse.topics) ? topicPickerCourse.topics : [];
        const coursePinned = pinnedTopics.filter(p => p.course_id === topicPickerCourse.course_id);

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <div 
                    className="absolute inset-0 bg-black/60 backdrop-blur-xs cursor-pointer" 
                    onClick={(e) => {
                        e.stopPropagation();
                        setTopicPickerCourse(null);
                    }} 
                />
                
                <div 
                    className="relative bg-white dark:bg-[#141414] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-[#2A2A2A] z-50 flex flex-col max-h-[85vh] animate-scale-in"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="p-5 border-b border-slate-100 dark:border-[#2A2A2A] flex items-center justify-between bg-slate-50/70 dark:bg-[#1C1C1C]">
                        <div className="pr-3">
                            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                                {topicPickerCourse.course_code || topicPickerCourse.course_name}
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Select a topic to start interactive tutorial
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={() => {
                                    setTargetCourseForTopic(topicPickerCourse);
                                    setShowAddTopicModal(true);
                                    setExtractedTopics([]);
                                    setDocUploadFile(null);
                                    setManualTopicForm({ topic_name: '', topic_context: '', start_point: '', end_point: '' });
                                }}
                                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
                                title="Add topics to this course"
                            >
                                <i className="bi bi-plus-lg font-black text-xs"></i>
                                <span>Add Topics</span>
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setTopicPickerCourse(null);
                                }}
                                className="w-9 h-9 rounded-full bg-slate-100 dark:bg-[#1C1C1C] text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#2A2A2A] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                                aria-label="Close modal"
                                title="Close"
                            >
                                <i className="bi bi-x-lg text-sm"></i>
                            </button>
                        </div>
                    </div>

                    <div className="p-4 overflow-y-auto space-y-3 flex-1 [scrollbar-width:thin]">
                        {coursePinned.length > 0 && (
                            <div className="space-y-2 mb-4">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-[#525252] dark:text-[#A3A3A3] flex items-center gap-1.5">
                                    <i className="bi bi-pin-angle-fill text-xs"></i>
                                    <span>Pinned Topics</span>
                                </div>
                                {coursePinned.map((p) => {
                                    const visitedTime = getTopicLastVisited(topicPickerCourse.course_id, p.topic_id);
                                    const visitedLabel = formatLastVisited(visitedTime || p.pinnedAt);

                                    return (
                                        <div
                                            key={p.key || p.topic_id}
                                            onClick={() => handleOpenTopic(topicPickerCourse, {
                                                topic_id: p.topic_id,
                                                topic_name: p.topic_name,
                                                topic_context: p.topic_context,
                                            })}
                                            className="flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-[#E6E6E6] dark:border-[#2A2A2A] bg-[#F3F3F3]/40 dark:bg-[#1C1C1C]/20 hover:bg-[#F3F3F3] dark:hover:bg-[#1C1C1C] transition-colors cursor-pointer group"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-sm text-slate-900 dark:text-white truncate group-hover:text-[#0A0A0A] dark:group-hover:text-[#FAFAFA] transition-colors">
                                                    {p.topic_name}
                                                </div>
                                                <div className="flex items-center gap-2 flex-wrap mt-1">
                                                    {visitedLabel && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-[#141414] text-slate-600 dark:text-[#A3A3A3] text-[10px] font-bold border border-emerald-200 dark:border-emerald-800 shadow-2xs">
                                                            <i className="bi bi-clock-history text-[#2563EB] dark:text-[#3B82F6] text-[10px]"></i>
                                                            <span>{visitedLabel}</span>
                                                        </span>
                                                    )}
                                                    {p.topic_context && (
                                                        <span className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                                                            {p.topic_context}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenTopic(topicPickerCourse, {
                                                            topic_id: p.topic_id,
                                                            topic_name: p.topic_name,
                                                            topic_context: p.topic_context,
                                                        });
                                                    }}
                                                    className="w-8 h-8 flex items-center justify-center bg-amber-500 text-slate-950 rounded-full hover:bg-amber-400 active:scale-95 transition-all cursor-pointer"
                                                    title="Start Topic Tutorial"
                                                >
                                                    <i className="bi bi-chevron-right text-xs font-bold"></i>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        togglePinTopic(topicPickerCourse, {
                                                            topic_id: p.topic_id,
                                                            topic_name: p.topic_name,
                                                            topic_context: p.topic_context,
                                                        });
                                                    }}
                                                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                                    title="Unpin topic"
                                                >
                                                    <i className="bi bi-x-lg text-xs"></i>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {topics.length === 0 ? (
                            <div className="p-8 text-center flex flex-col items-center justify-center">
                                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-[#1C1C1C] flex items-center justify-center text-slate-400 mb-3">
                                    <i className="bi bi-journal-x text-2xl"></i>
                                </div>
                                <p className="text-sm font-bold text-slate-900 dark:text-white">
                                    No syllabus extracted yet
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                                    Add topics to start learning, or upload a textbook / syllabus document.
                                </p>
                                <div className="flex flex-col sm:flex-row items-center gap-2 mt-4">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTargetCourseForTopic(topicPickerCourse);
                                            setAddTopicTab('doc');
                                            setShowAddTopicModal(true);
                                            setExtractedTopics([]);
                                            setDocUploadFile(null);
                                        }}
                                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                                    >
                                        <i className="bi bi-file-earmark-arrow-up"></i>
                                        <span>Upload Document / PDF</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTargetCourseForTopic(topicPickerCourse);
                                            setAddTopicTab('manual');
                                            setShowAddTopicModal(true);
                                            setManualTopicForm({ topic_name: '', topic_context: '', start_point: '', end_point: '' });
                                        }}
                                        className="px-4 py-2 bg-slate-100 dark:bg-[#1C1C1C] hover:bg-slate-200 dark:hover:bg-[#2A2A2A] text-slate-800 dark:text-slate-200 font-bold text-xs rounded-xl border border-slate-200 dark:border-[#2A2A2A] transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                                    >
                                        <i className="bi bi-pencil-square"></i>
                                        <span>Manually Add Topic</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                        Course Syllabus ({topics.length} topics)
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTargetCourseForTopic(topicPickerCourse);
                                            setShowAddTopicModal(true);
                                            setExtractedTopics([]);
                                            setDocUploadFile(null);
                                            setManualTopicForm({ topic_name: '', topic_context: '', start_point: '', end_point: '' });
                                        }}
                                        className="text-xs text-amber-600 dark:text-amber-400 hover:underline font-bold flex items-center gap-1 cursor-pointer"
                                    >
                                        <i className="bi bi-plus-circle text-xs"></i>
                                        <span>Add Topic</span>
                                    </button>
                                </div>
                                {topics.map((t: Topic, idx: number) => {
                                    const isPinned = pinnedTopics.some(p => p.key === `${topicPickerCourse.course_id}::${t.topic_id}`);
                                    const visitedTime = getTopicLastVisited(topicPickerCourse.course_id, t.topic_id);
                                    const visitedLabel = formatLastVisited(visitedTime);

                                    return (
                                        <div
                                            key={t.topic_id || idx}
                                            onClick={() => handleOpenTopic(topicPickerCourse, t)}
                                            className="flex items-center justify-between gap-3 p-3.5 rounded-2xl border border-slate-200/80 dark:border-[#2A2A2A] bg-[#FAF9F6] dark:bg-[#0A0A0A] hover:border-slate-400 dark:hover:border-[#3A3A3A] transition-all cursor-pointer group shadow-2xs"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-bold text-sm text-slate-900 dark:text-white truncate group-hover:text-[#0066FF] transition-colors">
                                                        {t.topic_name}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            togglePinTopic(topicPickerCourse, t);
                                                        }}
                                                        className={`text-xs p-1 rounded-md transition-colors cursor-pointer ${
                                                            isPinned
                                                                ? 'text-amber-500 font-bold'
                                                                : 'text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400'
                                                        }`}
                                                        title={isPinned ? 'Unpin' : 'Pin topic'}
                                                    >
                                                        <i className={`bi ${isPinned ? 'bi-pin-angle-fill' : 'bi-pin-angle'}`}></i>
                                                    </button>
                                                </div>
                                                <div className="flex items-center gap-2 flex-wrap mt-1">
                                                    {visitedLabel && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200/50 dark:bg-[#1C1C1C] text-[#64748B] dark:text-[#A3A3A3] text-[10px] font-semibold border border-slate-200 dark:border-[#2A2A2A]">
                                                            <i className="bi bi-clock-history text-[#0066FF] text-[10px]"></i>
                                                            <span>{visitedLabel}</span>
                                                        </span>
                                                    )}
                                                    {t.topic_context && (
                                                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">
                                                            {t.topic_context}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleOpenTopic(topicPickerCourse, t);
                                                }}
                                                className="w-8 h-8 flex items-center justify-center bg-slate-200/70 dark:bg-[#1C1C1C] group-hover:bg-[#2563EB] dark:group-hover:bg-[#3B82F6] text-[#0F172A] group-hover:text-white dark:text-slate-200 rounded-full transition-all shrink-0 active:scale-95 cursor-pointer shadow-2xs"
                                                title="Start Topic Tutorial"
                                            >
                                                <i className="bi bi-chevron-right text-xs font-bold"></i>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-slate-100 dark:border-[#2A2A2A] bg-slate-50 dark:bg-[#141414] flex gap-3">
                        <button
                            type="button"
                            onClick={() => {
                                setSelectedCourse(topicPickerCourse);
                                setTopicToOpen(null);
                                setTopicPickerCourse(null);
                            }}
                            className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-2xl py-3 text-sm font-bold active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                        >
                            <span>Start Full Course</span>
                            <i className="bi bi-chevron-right text-xs font-bold"></i>
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setTopicPickerCourse(null);
                            }}
                            className="px-5 bg-white dark:bg-[#1C1C1C] hover:bg-slate-100 dark:hover:bg-[#2A2A2A] border border-slate-200 dark:border-[#2A2A2A] text-slate-700 dark:text-slate-200 rounded-2xl py-3 text-sm font-bold transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // ── ADD COURSE MODAL ──
    const renderAddCourseModal = () => {
        if (!showAddCourseModal) return null;

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
                    onClick={() => setShowAddCourseModal(false)}
                />
                <div
                    className="relative bg-white dark:bg-[#141414] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-[#2A2A2A] z-50 flex flex-col max-h-[85vh] animate-scale-in"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="p-5 border-b border-slate-100 dark:border-[#2A2A2A] flex items-center justify-between bg-slate-50/70 dark:bg-[#1C1C1C]">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                                <i className="bi bi-journal-plus text-lg"></i>
                            </div>
                            <div>
                                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                                    Add New Course
                                </h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    Add a course to your curriculum
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowAddCourseModal(false)}
                            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-[#1C1C1C] text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#2A2A2A] flex items-center justify-center transition-colors cursor-pointer"
                            title="Close"
                        >
                            <i className="bi bi-x-lg text-sm"></i>
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="p-4 border-b border-slate-100 dark:border-[#2A2A2A] bg-slate-50/40 dark:bg-[#181818]">
                        <div className="grid grid-cols-2 p-1 bg-slate-200/60 dark:bg-[#141414] rounded-2xl border border-slate-200/80 dark:border-[#2A2A2A]">
                            <button
                                type="button"
                                onClick={() => setAddCourseTab('manual')}
                                className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                    addCourseTab === 'manual'
                                        ? 'bg-white dark:bg-[#222] text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <i className="bi bi-pencil-square"></i>
                                <span>Manual Entry</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setAddCourseTab('pdf')}
                                className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                    addCourseTab === 'pdf'
                                        ? 'bg-white dark:bg-[#222] text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <i className="bi bi-cloud-arrow-up"></i>
                                <span>Upload Course PDF</span>
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="p-5 overflow-y-auto flex-1 space-y-4 [scrollbar-width:thin]">
                        {addCourseTab === 'manual' ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                        Course Code <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={manualCourseForm.code}
                                        onChange={(e) => setManualCourseForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                                        placeholder="e.g. MTH101, CSC201, PHY102"
                                        className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-4 py-3 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                        Course Title (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={manualCourseForm.name}
                                        onChange={(e) => setManualCourseForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder="e.g. Elementary Mathematics I"
                                        className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all"
                                    />
                                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                                        Leave blank to let AI automatically generate the title from the course code.
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                            Level
                                        </label>
                                        <select
                                            value={manualCourseForm.level}
                                            onChange={(e) => setManualCourseForm(f => ({ ...f, level: e.target.value }))}
                                            className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-3 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all"
                                        >
                                            <option value="100lvl">100 Level</option>
                                            <option value="200lvl">200 Level</option>
                                            <option value="300lvl">300 Level</option>
                                            <option value="400lvl">400 Level</option>
                                            <option value="500lvl">500 Level</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                            Semester
                                        </label>
                                        <select
                                            value={manualCourseForm.semester}
                                            onChange={(e) => setManualCourseForm(f => ({ ...f, semester: e.target.value as 'first' | 'second' }))}
                                            className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-3 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all"
                                        >
                                            <option value="first">1st Semester</option>
                                            <option value="second">2nd Semester</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                        Description (Optional)
                                    </label>
                                    <textarea
                                        rows={2}
                                        value={manualCourseForm.description}
                                        onChange={(e) => setManualCourseForm(f => ({ ...f, description: e.target.value }))}
                                        placeholder="Brief course overview..."
                                        className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all resize-none"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="p-6 border-2 border-dashed border-slate-300 dark:border-[#333] rounded-3xl bg-slate-50/50 dark:bg-[#181818]/50 flex flex-col items-center justify-center text-center">
                                    <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
                                        <i className="bi bi-file-earmark-pdf text-3xl"></i>
                                    </div>
                                    <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                                        Upload Course Registration Form
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mb-4">
                                        Upload your course form PDF or curriculum document. AI will detect and register all courses automatically.
                                    </p>
                                    <label className={`px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer active:scale-95 ${isExtractingCourses ? 'opacity-60 pointer-events-none' : ''}`}>
                                        <i className="bi bi-cloud-arrow-up text-sm font-black"></i>
                                        <span>{isExtractingCourses ? 'Extracting Courses...' : 'Select PDF Document'}</span>
                                        <input
                                            type="file"
                                            accept=".pdf,application/pdf"
                                            className="hidden"
                                            onChange={handleExtractCourses}
                                            disabled={isExtractingCourses}
                                        />
                                    </label>
                                </div>
                                {isExtractingCourses && (
                                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3">
                                        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                                            Analyzing document and importing courses...
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {addCourseTab === 'manual' && (
                        <div className="p-4 border-t border-slate-100 dark:border-[#2A2A2A] bg-slate-50 dark:bg-[#141414] flex gap-3">
                            <button
                                type="button"
                                onClick={handleSaveManualCourseForm}
                                disabled={isSavingCourseForm || !manualCourseForm.code.trim()}
                                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-2xl py-3 text-sm font-bold active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                            >
                                {isSavingCourseForm ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                                        <span>Saving Course...</span>
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-check-lg text-base font-bold"></i>
                                        <span>Save Course</span>
                                    </>
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowAddCourseModal(false)}
                                className="px-5 bg-white dark:bg-[#1C1C1C] hover:bg-slate-100 dark:hover:bg-[#2A2A2A] border border-slate-200 dark:border-[#2A2A2A] text-slate-700 dark:text-slate-200 rounded-2xl py-3 text-sm font-bold transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ── ADD TOPIC MODAL (UPLOAD DOCUMENT / TEXTBOOK / TOPIC LIST OR MANUAL) ──
    const renderAddTopicModal = () => {
        if (!showAddTopicModal) return null;
        const targetCourse = targetCourseForTopic || topicPickerCourse;
        if (!targetCourse) return null;

        const courseLabel = targetCourse.course_code || targetCourse.course_name;

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-xs cursor-pointer"
                    onClick={() => setShowAddTopicModal(false)}
                />
                <div
                    className="relative bg-white dark:bg-[#141414] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden border border-slate-200 dark:border-[#2A2A2A] z-50 flex flex-col max-h-[85vh] animate-scale-in"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="p-5 border-b border-slate-100 dark:border-[#2A2A2A] flex items-center justify-between bg-slate-50/70 dark:bg-[#1C1C1C]">
                        <div className="pr-3 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono text-[11px] font-extrabold border border-amber-500/20 shrink-0">
                                    {courseLabel}
                                </span>
                                <h3 className="text-base font-extrabold text-slate-900 dark:text-white truncate">
                                    Add Topics
                                </h3>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Upload a document/textbook or enter topics manually
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowAddTopicModal(false)}
                            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-[#1C1C1C] text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#2A2A2A] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                            title="Close"
                        >
                            <i className="bi bi-x-lg text-sm"></i>
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="p-4 border-b border-slate-100 dark:border-[#2A2A2A] bg-slate-50/40 dark:bg-[#181818]">
                        <div className="grid grid-cols-2 p-1 bg-slate-200/60 dark:bg-[#141414] rounded-2xl border border-slate-200/80 dark:border-[#2A2A2A]">
                            <button
                                type="button"
                                onClick={() => setAddTopicTab('doc')}
                                className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                    addTopicTab === 'doc'
                                        ? 'bg-white dark:bg-[#222] text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <i className="bi bi-file-earmark-arrow-up"></i>
                                <span>Upload Document / PDF</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setAddTopicTab('manual')}
                                className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                                    addTopicTab === 'manual'
                                        ? 'bg-white dark:bg-[#222] text-slate-900 dark:text-white shadow-xs'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <i className="bi bi-pencil-square"></i>
                                <span>Manual Topic Entry</span>
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-5 overflow-y-auto flex-1 space-y-4 [scrollbar-width:thin]">
                        {addTopicTab === 'doc' ? (
                            <div className="space-y-4">
                                {extractedTopics.length === 0 ? (
                                    <>
                                        <div className="p-6 border-2 border-dashed border-slate-300 dark:border-[#333] rounded-3xl bg-slate-50/50 dark:bg-[#181818]/50 flex flex-col items-center justify-center text-center">
                                            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
                                                <i className="bi bi-journal-text text-3xl"></i>
                                            </div>
                                            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                                                Upload Textbook or Topic Lists
                                            </h4>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mb-4">
                                                Accepts PDF textbooks, syllabus documents, TXT topic outlines, or Markdown files.
                                            </p>
                                            <label className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#1C1C1C] dark:hover:bg-[#2A2A2A] text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer active:scale-95 border border-slate-800 dark:border-[#2A2A2A]">
                                                <i className="bi bi-paperclip text-sm font-black"></i>
                                                <span>{docUploadFile ? 'Change Document' : 'Choose Document (.pdf, .txt, .md, .doc)'}</span>
                                                <input
                                                    type="file"
                                                    accept=".pdf,.txt,.md,.doc,.docx,application/pdf,text/plain,text/markdown"
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        if (e.target.files && e.target.files.length > 0) {
                                                            setDocUploadFile(e.target.files[0]);
                                                        }
                                                    }}
                                                />
                                            </label>
                                        </div>

                                        {docUploadFile && (
                                            <div className="p-3.5 rounded-2xl bg-slate-100/80 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <i className="bi bi-file-earmark-check-fill text-amber-500 text-lg shrink-0"></i>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                                            {docUploadFile.name}
                                                        </p>
                                                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                                            {(docUploadFile.size / 1024).toFixed(1)} KB
                                                        </p>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleExtractTopicsFromDoc}
                                                    disabled={isExtractingTopics}
                                                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 active:scale-95 disabled:opacity-50"
                                                >
                                                    {isExtractingTopics ? (
                                                        <>
                                                            <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                                                            <span>Extracting...</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <i className="bi bi-magic text-xs"></i>
                                                            <span>Extract Topics</span>
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        )}

                                        {isExtractingTopics && (
                                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3">
                                                <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
                                                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                                                    AI is reading the document and extracting syllabus topics...
                                                </span>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="text-xs font-bold text-slate-900 dark:text-white">
                                                Extracted {extractedTopics.length} Topics
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const allSelected = extractedTopics.every(t => t.selected);
                                                        setExtractedTopics(prev => prev.map(t => ({ ...t, selected: !allSelected })));
                                                    }}
                                                    className="text-[11px] font-bold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                                                >
                                                    {extractedTopics.every(t => t.selected) ? 'Deselect All' : 'Select All'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setExtractedTopics([])}
                                                    className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 cursor-pointer"
                                                >
                                                    Re-upload
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1 [scrollbar-width:thin]">
                                            {extractedTopics.map((topic, idx) => (
                                                <div
                                                    key={topic.topic_id || idx}
                                                    onClick={() => {
                                                        setExtractedTopics(prev => prev.map((t, i) => i === idx ? { ...t, selected: !t.selected } : t));
                                                    }}
                                                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                                                        topic.selected
                                                            ? 'bg-amber-500/10 border-amber-500/40 dark:bg-amber-500/15 dark:border-amber-500/50'
                                                            : 'bg-slate-50 dark:bg-[#1C1C1C] border-slate-200 dark:border-[#2A2A2A] opacity-60'
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={topic.selected}
                                                        onChange={() => {}}
                                                        className="mt-1 rounded text-amber-500 focus:ring-amber-500 cursor-pointer"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                                            {topic.topic_name}
                                                        </p>
                                                        {topic.topic_context && (
                                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">
                                                                {topic.topic_context}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                        Topic Title <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={manualTopicForm.topic_name}
                                        onChange={(e) => setManualTopicForm(f => ({ ...f, topic_name: e.target.value }))}
                                        placeholder="e.g. Eigenvalues and Eigenvectors"
                                        className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-4 py-3 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all"
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                            Topic Overview / Context
                                        </label>
                                        <button
                                            type="button"
                                            onClick={handleAutoGenerateTopicContext}
                                            disabled={isGeneratingContext || !manualTopicForm.topic_name.trim()}
                                            className="text-[11px] text-amber-600 dark:text-amber-400 font-bold hover:underline flex items-center gap-1 disabled:opacity-40 cursor-pointer"
                                        >
                                            <i className="bi bi-sparkles text-xs"></i>
                                            <span>{isGeneratingContext ? 'Generating...' : 'Auto-Generate Context'}</span>
                                        </button>
                                    </div>
                                    <textarea
                                        rows={3}
                                        value={manualTopicForm.topic_context}
                                        onChange={(e) => setManualTopicForm(f => ({ ...f, topic_context: e.target.value }))}
                                        placeholder="Brief description of key concepts, formulas, exam focus..."
                                        className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-4 py-2.5 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all resize-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                            Start Point (Optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={manualTopicForm.start_point}
                                            onChange={(e) => setManualTopicForm(f => ({ ...f, start_point: e.target.value }))}
                                            placeholder="e.g. Chapter 1 or Intro"
                                            className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                                            End Point (Optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={manualTopicForm.end_point}
                                            onChange={(e) => setManualTopicForm(f => ({ ...f, end_point: e.target.value }))}
                                            placeholder="e.g. Chapter 2 or Exercises"
                                            className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl px-3 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-slate-100 dark:border-[#2A2A2A] bg-slate-50 dark:bg-[#141414] flex gap-3">
                        {addTopicTab === 'doc' && extractedTopics.length > 0 ? (
                            <button
                                type="button"
                                onClick={handleSaveExtractedTopics}
                                disabled={isSavingExtractedTopics || !extractedTopics.some(t => t.selected)}
                                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-2xl py-3 text-sm font-bold active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                            >
                                {isSavingExtractedTopics ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                                        <span>Saving Topics...</span>
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-check-lg text-base font-bold"></i>
                                        <span>Save {extractedTopics.filter(t => t.selected).length} Selected Topics</span>
                                    </>
                                )}
                            </button>
                        ) : addTopicTab === 'manual' ? (
                            <button
                                type="button"
                                onClick={handleSaveManualTopic}
                                disabled={isSavingManualTopic || !manualTopicForm.topic_name.trim()}
                                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-2xl py-3 text-sm font-bold active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                            >
                                {isSavingManualTopic ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                                        <span>Adding Topic...</span>
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-plus-lg text-base font-bold"></i>
                                        <span>Add Topic</span>
                                    </>
                                )}
                            </button>
                        ) : null}

                        <button
                            type="button"
                            onClick={() => setShowAddTopicModal(false)}
                            className="px-5 bg-white dark:bg-[#1C1C1C] hover:bg-slate-100 dark:hover:bg-[#2A2A2A] border border-slate-200 dark:border-[#2A2A2A] text-slate-700 dark:text-slate-200 rounded-2xl py-3 text-sm font-bold transition-colors cursor-pointer"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex-1 flex flex-col w-full h-full min-h-0 bg-slate-50/50 dark:bg-[#000000] overflow-hidden text-slate-900 dark:text-slate-100">
            {/* Dual-Pane Tab Container with Smooth Horizontal Slide Transition */}
            <div
                className="flex-1 min-h-0 w-full overflow-hidden relative"
                onTouchStart={!isNestedViewOpen ? handleTouchStart : undefined}
                onTouchMove={!isNestedViewOpen ? handleTouchMove : undefined}
                onTouchEnd={!isNestedViewOpen ? handleTouchEnd : undefined}
            >
                {/* Pane 1: Academic Courses */}
                <div className={`absolute inset-0 w-full h-full flex flex-col overflow-hidden transition-all duration-300 ease-out will-change-transform ${
                    activeTab === 'courses' ? 'translate-x-0 opacity-100 z-10' : '-translate-x-full opacity-0 pointer-events-none z-0'
                }`}>
                    {/* Top Roadmap Header */}
                    <div className="flex-shrink-0 px-6 sm:px-10 py-6 sm:py-8 bg-[#FAF9F6] dark:bg-[#0A0A0A] border-b border-slate-200/80 dark:border-[#2A2A2A] shadow-xs">
                        <div className="max-w-4xl mx-auto flex flex-col items-center text-center">
                            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                                Academic Study Guide
                            </h2>
                            <p className="text-slate-600 dark:text-slate-200 text-xs sm:text-sm max-w-md mt-1 font-medium">
                                Select any topic to start a step-by-step interactive lesson with voice and blackboard diagrams.
                            </p>

                            {/* Search and Filter */}
                            <div className="mt-6 w-full flex flex-col sm:flex-row gap-3">
                                <div className="flex-1 relative group">
                                    <input
                                        type="text"
                                        placeholder="Search courses or topics..."
                                        value={filter.searchTerm}
                                        onChange={(e) => setFilter(f => ({ ...f, searchTerm: e.target.value }))}
                                        className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl py-3 pl-11 pr-4 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#737373] focus:border-[#3A3A3A] focus:outline-none text-sm transition-all"
                                    />
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-amber-500 transition-colors">
                                        <i className="bi bi-search text-sm"></i>
                                    </div>
                                </div>
                                <div className="bg-slate-100 dark:bg-[#1C1C1C] p-1 rounded-2xl flex border border-slate-200/80 dark:border-[#2A2A2A] shrink-0">
                                    <button
                                        onClick={() => setFilter(f => ({ ...f, semester: 'first' }))}
                                        className={`px-4 sm:px-5 py-2 rounded-xl font-extrabold text-xs uppercase tracking-wider transition-all ${
                                            filter.semester === 'first'
                                                ? 'bg-white dark:bg-[#141414] text-slate-900 dark:text-white shadow-xs'
                                                : 'text-slate-500 hover:text-slate-800 dark:text-[#A3A3A3] dark:hover:text-slate-200'
                                        }`}
                                    >
                                        1st Sem
                                    </button>
                                    <button
                                        onClick={() => setFilter(f => ({ ...f, semester: 'second' }))}
                                        className={`px-4 sm:px-5 py-2 rounded-xl font-extrabold text-xs uppercase tracking-wider transition-all ${
                                            filter.semester === 'second'
                                                ? 'bg-white dark:bg-[#141414] text-slate-900 dark:text-white shadow-xs'
                                                : 'text-slate-500 hover:text-slate-800 dark:text-[#A3A3A3] dark:hover:text-slate-200'
                                        }`}
                                    >
                                        2nd Sem
                                    </button>
                                    <button
                                        onClick={() => setFilter(f => ({ ...f, semester: 'all' }))}
                                        className={`px-4 sm:px-5 py-2 rounded-xl font-extrabold text-xs uppercase tracking-wider transition-all ${
                                            filter.semester === 'all'
                                                ? 'bg-white dark:bg-[#141414] text-slate-900 dark:text-white shadow-xs'
                                                : 'text-slate-500 hover:text-slate-800 dark:text-[#A3A3A3] dark:hover:text-slate-200'
                                        }`}
                                    >
                                        All
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setManualCourseForm({
                                            code: '',
                                            name: '',
                                            level: userProfile?.level || '100lvl',
                                            semester: filter.semester === 'second' ? 'second' : 'first',
                                            description: ''
                                        });
                                        setAddCourseTab('manual');
                                        setShowAddCourseModal(true);
                                    }}
                                    className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs sm:text-sm rounded-2xl shadow-xs hover:shadow-md transition-all active:scale-95 flex items-center justify-center gap-2 cursor-pointer shrink-0"
                                    title="Add a new course"
                                >
                                    <i className="bi bi-plus-circle-fill text-sm"></i>
                                    <span>Add Course</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Courses List */}
                    <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 sm:py-8 pb-[calc(76px+env(safe-area-inset-bottom)+16px)]">
                        {isLoading ? (
                            <StudyGuideSkeleton />
                        ) : filteredCourses.length > 0 ? (
                            <div className="max-w-4xl mx-auto space-y-3">
                                {filteredCourses.map(course => (
                                    <CourseHeader
                                        key={course.course_id}
                                        course={course}
                                        onClick={() => setTopicPickerCourse(course)}
                                        userProgress={userProgress}
                                        onUpload={(files) => uploadTextbook(course, getCourseMergeKey(course) || course.course_name, files, false, userProfile.department_id)}
                                        isUploading={isUploadingCourseKey === (getCourseMergeKey(course) || course.course_name)}
                                        uploadProgress={uploadProgress}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-6 px-2 sm:px-0 text-center max-w-4xl mx-auto w-full">
                                <div className="w-16 h-16 bg-slate-100 dark:bg-[#1C1C1C] rounded-3xl flex items-center justify-center mb-4 text-slate-400 shadow-inner">
                                    <i className="bi bi-search text-2xl"></i>
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">No courses found</h3>
                                <p className="text-xs text-slate-500 dark:text-[#A3A3A3] mb-6">
                                    {filter.searchTerm ? 'Try adjusting your search query.' : 'Upload your course registration PDF or add your course codes.'}
                                </p>

                                {!filter.searchTerm && (
                                    <div className="w-full bg-white dark:bg-[#141414] p-5 sm:p-7 rounded-3xl border border-slate-200 dark:border-[#2A2A2A] shadow-sm text-left">
                                        <div className="flex justify-between items-center mb-4">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                                                    <i className="bi bi-plus-circle-fill text-base"></i>
                                                </div>
                                                <div>
                                                    <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">Add Courses</h4>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">Import course registration PDF or enter individual course codes</p>
                                                </div>
                                            </div>
                                            {isManualMode && (
                                                <button
                                                    type="button"
                                                    onClick={() => setIsManualMode(false)}
                                                    className="text-xs text-amber-600 dark:text-amber-400 font-bold hover:underline px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/50 cursor-pointer transition-all"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                        </div>

                                        {isManualMode ? (
                                            <div className="flex flex-col gap-3">
                                                <div className="relative flex items-center">
                                                    <input
                                                        type="text"
                                                        value={manualCourseCode}
                                                        onChange={(e) => setManualCourseCode(e.target.value.toUpperCase())}
                                                        placeholder="e.g. MTH101, PHY201"
                                                        className="w-full bg-slate-50 dark:bg-[#1C1C1C] border border-slate-200 dark:border-[#2A2A2A] rounded-2xl pl-4 pr-28 py-3.5 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:border-[#3A3A3A] transition-all"
                                                        disabled={isSavingManual}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={handleSaveManualCourse}
                                                        disabled={isSavingManual || !manualCourseCode.trim()}
                                                        className="absolute right-2 px-4 py-2 bg-[#2563EB] hover:bg-[#1D4ED8] dark:bg-[#3B82F6] dark:hover:bg-[#60A5FA] text-white rounded-xl text-xs font-extrabold disabled:opacity-50 active:scale-95 transition-all shadow-xs cursor-pointer"
                                                    >
                                                        {isSavingManual ? 'Saving...' : 'Save Course'}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                                <label className={`flex items-center justify-center gap-2.5 px-5 py-3.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#1C1C1C] dark:hover:bg-[#2A2A2A] text-white rounded-2xl text-xs sm:text-sm font-bold cursor-pointer transition-all shadow-sm border border-slate-800 dark:border-[#2A2A2A] active:scale-95 ${isExtractingCourses ? 'opacity-70 pointer-events-none' : ''}`}>
                                                    <i className="bi bi-cloud-arrow-up text-base"></i>
                                                    <span>{isExtractingCourses ? 'Extracting courses...' : 'Upload Course Form PDF'}</span>
                                                    <input type="file" accept=".pdf" className="hidden" onChange={handleExtractCourses} disabled={isExtractingCourses} />
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => setIsManualMode(true)}
                                                    className="w-full flex items-center justify-center gap-2.5 px-5 py-3.5 bg-slate-50 dark:bg-[#1C1C1C] hover:bg-slate-100 dark:hover:bg-[#2A2A2A] border border-slate-200/80 dark:border-[#2A2A2A] text-slate-800 dark:text-slate-200 rounded-2xl text-xs sm:text-sm font-bold active:scale-95 transition-all cursor-pointer"
                                                >
                                                    <i className="bi bi-pencil-square text-base text-[#2563EB] dark:text-[#3B82F6]"></i>
                                                    <span>Manually Enter Course Code</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Pane 2: My Personal Notebooks */}
                <div className={`absolute inset-0 w-full h-full flex flex-col overflow-hidden transition-all duration-300 ease-out will-change-transform ${
                    activeTab === 'notebooks' ? 'translate-x-0 opacity-100 z-10' : 'translate-x-full opacity-0 pointer-events-none z-0'
                }`}>
                    <MyNotebooks
                        userProfile={userProfile}
                        onNavigate={onNavigate}
                        setCustomHeaderConfig={setCustomHeaderConfig}
                        onNestedViewChange={setIsNotebookNestedOpen}
                    />
                </div>
            </div>

            <LimitExceededModal
                isOpen={showLimitModal}
                onClose={() => setShowLimitModal(false)}
                userProfile={userProfile}
                appSettings={appSettings}
                cost={limitModalData.cost}
                balance={limitModalData.balance}
                addToast={addToast}
                onSuccessPurchase={() => { }}
            />

            {renderTopicPicker()}
            {renderAddCourseModal()}
            {renderAddTopicModal()}
        </div>
    );
};

export const StudyGuide: React.FC<StudyGuideProps> = (props) => (
    <ErrorBoundary>
        <StudyGuideContent {...props} />
    </ErrorBoundary>
);

export default StudyGuide;
