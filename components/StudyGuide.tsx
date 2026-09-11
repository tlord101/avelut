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

// --- UTILITIES ---
const normalizeLevelValue = (value?: string): string => {
    if (!value) return '';
    return value.toLowerCase().replace(/\s+/g, '').replace(/level/g, '').replace(/lvl/g, '');
};

const normalizeDepartmentValue = (value?: string): string => {
    if (!value) return '';
    return value.toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^\w_]/g, '');
};

const normalizeTopicId = (value: string) => value.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');

const sanitizeTopicMetadata = (topic: any, index: number): Topic => {
    const topicName = (topic?.topic_name || topic?.name || '').toString().trim() || `Topic ${index + 1}`;
    const rawTopicId = (topic?.topic_id || '').toString().trim();
    return {
        topic_name: topicName,
        topic_id: rawTopicId || normalizeTopicId(topicName),
        topic_context: (topic?.topic_context || topic?.context || '').toString().trim(),
        start_point: (topic?.start_point || topic?.start || '').toString().trim(),
        end_point: (topic?.end_point || topic?.end || '').toString().trim(),
        is_complete: Boolean(topic?.is_complete),
    };
};

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
    const [activeExternalSession, setActiveExternalSession] = useState<VoiceTutorialSessionData | null>(() => (
        readCachedJson<VoiceTutorialSessionData | null>('avelut_active_voice_tutorial', null)
    ));
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

        // Topic selected for StudyGuide view
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
                            <span>My Notebooks</span>
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
        if (cachedSession) {
            setActiveExternalSession(cachedSession);
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
            const aiModel = getFeatureModel('study_guide_extraction', appSettings) || 'qwen/qwen3.7-flash';

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
            void deductAICredits(userProfile.uid, cost, 'Study Guide Manual Course Generation', appSettings);
            addToast(`Added ${courseData.course_code} successfully!`, 'success');
            setManualCourseCode('');
            setIsManualMode(false);
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
            const aiModel = getFeatureModel('study_guide_extraction', appSettings) || 'qwen/qwen3.7-flash';
            const base64Chunk = await fileToBase64(file);
            const prompt = `Analyze this PDF document. Extract all course names and course codes. Return a JSON object with a 'courses' array, where each item has 'course_name' and 'course_code'.`;

            const callRes = await attemptApiCall(() => ai.models.generateContent({
                model: aiModel,
                contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'application/pdf', data: base64Chunk } }] }],
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
        return {
            course: selectedCourse,
            topic: topicToOpen || (Array.isArray(selectedCourse.topics) && selectedCourse.topics.length > 0
                ? selectedCourse.topics[0]
                : {
                    topic_id: 'core_principles',
                    topic_name: 'Core Principles & Overview',
                    topic_context: `Overview and principles of ${selectedCourse.course_name || 'Course'}`,
                }),
            syllabusContext: '',
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
                    if (isVoiceTutorialActive) {
                        setIsVoiceTutorialActive(false);
                    } else {
                        setSelectedCourse(null);
                        setTopicToOpen(null);
                        setActiveExternalSession(null);
                        writeCachedJson('avelut_active_voice_tutorial', null);
                        if (setCustomHeaderConfig) {
                            setCustomHeaderConfig(null);
                        }
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
                                    Upload a textbook/syllabus PDF or start the introductory lesson directly.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2.5">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                    Course Syllabus ({topics.length} topics)
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
        </div>
    );
};

export const StudyGuide: React.FC<StudyGuideProps> = (props) => (
    <ErrorBoundary>
        <StudyGuideContent {...props} />
    </ErrorBoundary>
);

export default StudyGuide;
