import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, storage } from '../firebase';
import { ref as dbRef, set, push, update, get, remove } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenAI, Type } from '@google/genai';
import { useToast } from '../hooks/useToast';
import { useAppSettings } from '../hooks/useAppSettings';
import type { UserProfile, Question, Course, Topic } from '../types';
import { LogoIcon } from './icons/LogoIcon';
import { MenuIcon } from './icons/MenuIcon';
import { TrashIcon } from './icons/TrashIcon';
import { StackIcon } from './icons/StackIcon';
import { StudyGuideIcon } from './icons/StudyGuideIcon';
import { ExamIcon } from './icons/ExamIcon';
import { GraduationCapIcon } from './icons/GraduationCapIcon';
import { CheckIcon } from './icons/CheckIcon';
import { 
    Folder, 
    BookOpen, 
    HelpCircle, 
    Users, 
    Settings as SettingsIcon, 
    LogOut, 
    ChevronDown, 
    ChevronRight,
    Moon,
    Sparkles, 
    RefreshCw, 
    Trash2,
    Shield,
    TrendingUp,
    Clock,
    UserCheck,
    CreditCard,
    Key,
    Activity,
    Plus,
    X,
    Building,
    Home,
    Bell,
    Send,
    Mail,
    CheckCircle,
    AlertCircle,
    MessageSquare,
    ArrowUpRight
} from 'lucide-react';
import { getWindowPathname } from '../utils/pathname';
import { APP_SETTINGS_PATH, DEFAULT_APP_SETTINGS } from '../utils/appSettings';

interface AdminPanelProps {
    userProfile: UserProfile;
    initialTab?: AdminTab;
    allowedTabs?: AdminTab[];
    pathname?: string;
    onNavigate?: (path: string) => void;
}

const SEMESTERS = ['first', 'second'] as const;
const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'] as const;
const MAX_SKIPPED_USERS_PREVIEW = 3;
const MAX_MAILTO_LINK_LENGTH = 1900;
const MAX_COURSE_STATUS_LENGTH = 12;
const DEFAULT_SEMESTER: (typeof SEMESTERS)[number] = 'first';
const normalizeSemester = (semester?: Course['semester']): (typeof SEMESTERS)[number] => (
    semester && SEMESTERS.includes(semester) ? semester : DEFAULT_SEMESTER
);
const normalizeLevel = (value?: string) => {
    if (!value) return LEVELS[0];
    const normalized = value.toLowerCase().replace(/\s+/g, '');
    if (LEVELS.includes(normalized as (typeof LEVELS)[number])) {
        return normalized as (typeof LEVELS)[number];
    }
    const digitsMatch = normalized.match(/\d+/);
    if (digitsMatch?.[0]) {
        const candidate = `${digitsMatch[0]}lvl` as (typeof LEVELS)[number];
        if (LEVELS.includes(candidate)) return candidate;
    }
    return LEVELS[0];
};
const normalizeTopicId = (value: string) => value.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
const normalizeCourseStatus = (value?: string) => {
    const normalized = (value || '').toString().trim().toUpperCase();
    return normalized ? normalized.slice(0, MAX_COURSE_STATUS_LENGTH) : '';
};

type AdminTab = 'dashboard' | 'questions' | 'courses' | 'users' | 'departments' | 'app' | 'analytics' | 'payments';

type CourseAdminView =
    | { mode: 'global' }
    | { mode: 'manager-root' }
    | { mode: 'add'; departmentId?: string; level?: string }
    | { mode: 'manager-list'; departmentId: string; level: string }
    | { mode: 'manager-detail'; departmentId: string; level: string; courseId: string };

const DEFAULT_VISIBLE_TABS: AdminTab[] = ['dashboard', 'departments', 'courses', 'questions', 'users', 'app', 'analytics', 'payments'];

const getCourseAdminView = (pathname: string): CourseAdminView => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'admin' || segments[1] !== 'courses') {
        return { mode: 'global' };
    }

    if (segments.length <= 2 || segments[2] === 'all') {
        return { mode: 'manager-root' };
    }

    if (segments[2] === 'add') {
        const departmentId = segments[3] ? decodeURIComponent(segments[3]) : undefined;
        const level = segments[4] ? decodeURIComponent(segments[4]) : undefined;
        return { mode: 'add', departmentId, level };
    }

    if (segments[2] !== 'manager') {
        return { mode: 'global' };
    }

    const departmentId = segments[3] ? decodeURIComponent(segments[3]) : '';
    const level = segments[4] ? decodeURIComponent(segments[4]) : '';
    const courseId = segments[5] ? decodeURIComponent(segments[5]) : '';

    if (!departmentId || !level) {
        return { mode: 'manager-root' };
    }

    if (!courseId) {
        return { mode: 'manager-list', departmentId, level };
    }

    return { mode: 'manager-detail', departmentId, level, courseId };
};

const buildCourseManagerPath = (departmentId?: string, level?: string, courseId?: string) => {
    if (!departmentId || !level) return '/admin/courses/manager';
    const encodedDepartment = encodeURIComponent(departmentId);
    const encodedLevel = encodeURIComponent(level);
    const encodedCourse = courseId ? `/${encodeURIComponent(courseId)}` : '';
    return `/admin/courses/manager/${encodedDepartment}/${encodedLevel}${encodedCourse}`;
};

const buildCourseAddPath = (departmentId?: string, level?: string) => {
    if (!departmentId) return '/admin/courses/add';
    const encodedDepartment = encodeURIComponent(departmentId);
    if (!level) return `/admin/courses/add/${encodedDepartment}`;
    return `/admin/courses/add/${encodedDepartment}/${encodeURIComponent(level)}`;
};

const matchesCourseIdentifier = (course: Partial<Course>, courseId: string) => (
    course.course_id === courseId || getCourseMergeKey(course) === courseId
);

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

const normalizeTextbookUrls = (course: Partial<Course>) => {
    const urls: string[] = Array.isArray(course?.textbook_urls) ? course.textbook_urls.filter(Boolean) : [];
    if (course?.textbook_url && !urls.includes(course.textbook_url)) {
        urls.push(course.textbook_url);
    }
    return Array.from(new Set(urls));
};

const getPrimaryTextbookUrl = (urls: string[]) => urls[urls.length - 1] || '';

const selectPrimaryPdfUrl = (uploadedUrls: string[], existingPdfUrl: string | undefined, mergedPdfUrls: string[]) => (
    getPrimaryTextbookUrl(uploadedUrls) || existingPdfUrl || getPrimaryTextbookUrl(mergedPdfUrls)
);

const mergeTopics = (existingTopics: Array<Partial<Topic>>, newTopics: Topic[]) => {
    const topicMap = new Map<string, Topic>();
    [...existingTopics, ...newTopics].forEach((topic, index) => {
        const sanitized = sanitizeTopicMetadata(topic, index);
        const topicId = sanitized.topic_id || normalizeTopicId(sanitized.topic_name);
        if (!topicMap.has(topicId)) {
            topicMap.set(topicId, { ...sanitized, topic_id: topicId });
        }
    });
    return Array.from(topicMap.values());
};

const getUniqueIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));
const getCourseMergeKey = (course: Partial<Course>) => {
    const primaryLabel = (
        course?.course_code ||
        course?.course_name ||
        course?.course_id ||
        ''
    ).toString().trim();
    const normalizedPrimaryLabel = normalizeTopicId(primaryLabel);
    if (!normalizedPrimaryLabel) return '';

    const hasLevel = Boolean((course?.level || '').toString().trim());
    const normalizedLevel = hasLevel ? normalizeLevel(course?.level) : 'alllvl';
    const normalizedSemester = normalizeSemester(course?.semester);
    return `${normalizedPrimaryLabel}_${normalizedLevel}_${normalizedSemester}`;
};

const getCourseRouteKey = (course: Partial<Course>) => {
    const mergeKey = getCourseMergeKey(course);
    if (mergeKey) return mergeKey;
    const fallbackLabel = normalizeTopicId((course?.course_id || course?.course_name || 'course').toString().trim()) || 'course';
    const hasLevel = Boolean((course?.level || '').toString().trim());
    const normalizedLevel = hasLevel ? normalizeLevel(course?.level) : 'alllvl';
    return `${fallbackLabel}_${normalizedLevel}_${normalizeSemester(course?.semester)}`;
};

const mergeCourseRecord = (
    existingCourse: Partial<Course> | undefined,
    sourceCourse: Course,
    mergedTopics?: Topic[],
    appendedTextbookUrls: string[] = []
): Course => {
    const baseCourse = existingCourse || sourceCourse;
    const sourceTopics = Array.isArray(sourceCourse.topics) ? sourceCourse.topics : [];
    const baseTopics = Array.isArray(baseCourse.topics) ? (baseCourse.topics as Topic[]) : [];
    const resolvedTopics = mergedTopics
        ? mergeTopics(baseTopics, mergedTopics)
        : (sourceTopics.length > 0 ? sourceTopics : baseTopics);

    const mergedCourseUrls = Array.from(new Set([
        ...normalizeTextbookUrls(baseCourse),
        ...normalizeTextbookUrls(sourceCourse),
        ...appendedTextbookUrls
    ]));

    const mergedCourseName = (sourceCourse.course_name || baseCourse.course_name || '').toString().trim();
    const mergedCourseId = (baseCourse.course_id || sourceCourse.course_id || getCourseMergeKey({ course_name: mergedCourseName }))?.toString();

    return {
        ...baseCourse,
        ...sourceCourse,
        course_id: mergedCourseId || '',
        course_name: mergedCourseName || sourceCourse.course_name,
        topics: resolvedTopics,
        textbook_url: getPrimaryTextbookUrl(mergedCourseUrls),
        textbook_urls: mergedCourseUrls,
        semester: normalizeSemester(sourceCourse.semester || (baseCourse as Course).semester),
    };
};

const upsertCourseInList = (
    courseList: Course[],
    sourceCourse: Course,
    mergedTopics?: Topic[],
    appendedTextbookUrls: string[] = []
): Course[] => {
    const sourceKey = getCourseMergeKey(sourceCourse);
    if (!sourceKey) return courseList;

    const normalizedCourseList = courseList.filter(course => Boolean(getCourseMergeKey(course)));
    const existingCourse = normalizedCourseList.find(course => {
        const existingKey = getCourseMergeKey(course);
        return existingKey === sourceKey || Boolean(sourceCourse.course_id && course.course_id === sourceCourse.course_id);
    });

    const nextCourse = mergeCourseRecord(
        existingCourse,
        { ...sourceCourse, course_id: sourceCourse.course_id || sourceKey },
        mergedTopics,
        appendedTextbookUrls
    );

    const filteredCourses = normalizedCourseList.filter(course => getCourseMergeKey(course) !== sourceKey);
    const courseMap = new Map(filteredCourses.map(course => [getCourseMergeKey(course), course]));
    courseMap.set(sourceKey, nextCourse);
    return Array.from(courseMap.values());
};

const normalizeCourseList = (rawCourseList: any): Course[] => {
    if (!Array.isArray(rawCourseList)) return [];
    return rawCourseList
        .map((course: Course) => ({
            ...course,
            course_name: (course?.course_name || '').toString().trim(),
            course_id: (course?.course_id || getCourseMergeKey(course) || '').toString(),
            semester: normalizeSemester(course?.semester),
            topics: Array.isArray(course?.topics) ? course.topics : [],
            textbook_urls: normalizeTextbookUrls(course),
            textbook_url: getPrimaryTextbookUrl(normalizeTextbookUrls(course)),
        }))
        .filter((course: Course) => Boolean(getCourseMergeKey(course)))
        .reduce((acc: Course[], course: Course) => upsertCourseInList(acc, course), []);
};

const mergeCourseListsIntoTarget = (existingCourses: Course[], incomingCourses: Course[]) => {
    let mergedCourses = [...existingCourses];
    for (const course of incomingCourses) {
        if (!course.course_id) continue;
        mergedCourses = upsertCourseInList(mergedCourses, course);
    }
    return mergedCourses;
};

const sanitizeCourseFromRegistrationForm = (
    course: any,
    index: number,
    extractedLevel?: string,
    extractedSession?: string,
    overrideLevel?: string,
    overrideSession?: string
): Course => {
    const courseCode = (course?.course_code || course?.code || course?.courseCode || '').toString().trim().toUpperCase();
    const courseTitle = (course?.course_title || course?.title || course?.course_name || course?.name || '').toString().trim();
    const fallbackName = courseCode || `Course ${index + 1}`;
    const courseName = courseTitle || fallbackName;
    const level = normalizeLevel(overrideLevel || course?.level || extractedLevel);
    const session = (overrideSession || course?.academic_session || course?.session || extractedSession || '').toString().trim();
    const semester = normalizeSemester((course?.semester || '').toString().trim().toLowerCase() as Course['semester']);
    const parsedUnit = Number.parseInt((course?.course_unit ?? course?.unit ?? '').toString().trim(), 10);
    const normalizedUnit = Number.isFinite(parsedUnit) ? parsedUnit : undefined;
    const status = normalizeCourseStatus(course?.course_status || course?.status);
    const idSource = courseTitle || courseCode || `${fallbackName}_${semester}_${session || level}`;
    const courseId = normalizeTopicId(idSource);

    return {
        course_id: courseId,
        course_name: courseName,
        course_code: courseCode || undefined,
        course_unit: normalizedUnit,
        course_status: status || undefined,
        academic_session: session || undefined,
        topics: [],
        level,
        semester,
    };
};

export const AdminPanel: React.FC<AdminPanelProps> = ({
    userProfile,
    initialTab = 'departments',
    allowedTabs,
    pathname,
    onNavigate,
}) => {
    const [internalPathname, setInternalPathname] = useState(() => getWindowPathname());
    const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const { settings: appSettings } = useAppSettings();
    const geminiModel = appSettings.primary_gemini_model;
    const geminiApiKey = appSettings.gemini_api_key.trim();
    const ai = useMemo(() => (geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null), [geminiApiKey]);
    const [isSavingAppSettings, setIsSavingAppSettings] = useState(false);
    const [isTestingAppSettings, setIsTestingAppSettings] = useState(false);
    const [appSettingsDraft, setAppSettingsDraft] = useState(appSettings);
    const visibleTabs = useMemo(
        () => (allowedTabs && allowedTabs.length ? allowedTabs : DEFAULT_VISIBLE_TABS),
        [allowedTabs]
    );
    const resolvedPathname = pathname || internalPathname;
    const courseAdminView = useMemo(() => getCourseAdminView(resolvedPathname), [resolvedPathname]);
    const isManagerCourseView = courseAdminView.mode === 'manager-list' || courseAdminView.mode === 'manager-detail';
    const [allUsersList, setAllUsersList] = useState<UserProfile[]>([]);
    const [isUsersLoading, setIsUsersLoading] = useState(false);
    const [recipientMode, setRecipientMode] = useState<'all' | 'single'>('all');
    const [selectedRecipientId, setSelectedRecipientId] = useState('');
    const [announcementTitle, setAnnouncementTitle] = useState('');
    const [announcementMessage, setAnnouncementMessage] = useState('');
    const [notificationType, setNotificationType] = useState<'study_update' | 'exam_reminder' | 'welcome'>('study_update');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [isSendingPush, setIsSendingPush] = useState(false);
    const { addToast } = useToast();

    // Analytics and Payments Real-Time Logging State
    const [aiRequestLogs, setAiRequestLogs] = useState<any[]>([]);
    const [paymentLogs, setPaymentLogs] = useState<any[]>([]);
    const [refundLogs, setRefundLogs] = useState<any[]>([]);
    const [complaintLogs, setComplaintLogs] = useState<any[]>([]);
    const [isLogsLoading, setIsLogsLoading] = useState(false);

    const userRequestCounts = useMemo(() => {
        const now = Date.now();
        const limit5m = now - 5 * 60 * 1000;
        const limit10m = now - 10 * 60 * 1000;
        const limit30m = now - 30 * 60 * 1000;
        const limit1h = now - 60 * 60 * 1000;

        const counts: Record<string, { m5: number; m10: number; m30: number; h1: number }> = {};

        allUsersList.forEach(u => {
            counts[u.uid] = { m5: 0, m10: 0, m30: 0, h1: 0 };
        });

        aiRequestLogs.forEach(log => {
            const uid = log.user_id;
            if (!uid || !counts[uid]) return;

            const ts = log.timestamp;
            if (!ts) return;

            if (ts >= limit5m) counts[uid].m5++;
            if (ts >= limit10m) counts[uid].m10++;
            if (ts >= limit30m) counts[uid].m30++;
            if (ts >= limit1h) counts[uid].h1++;
        });

        return counts;
    }, [allUsersList, aiRequestLogs]);

    // Activation Code Management States
    const [activationCodes, setActivationCodes] = useState<any[]>([]);
    const [newCodeApiKey, setNewCodeApiKey] = useState('');
    const [isGeneratingCode, setIsGeneratingCode] = useState(false);

    const fetchUsageLogs = async () => {
        setIsLogsLoading(true);
        try {
            // Fetch AI requests
            const aiRef = dbRef(db, 'usage_logs/ai_requests');
            const aiSnap = await get(aiRef);
            if (aiSnap.exists()) {
                const data = aiSnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.timestamp - a.timestamp);
                setAiRequestLogs(list);
            } else {
                setAiRequestLogs([]);
            }

            // Fetch payments
            const payRef = dbRef(db, 'usage_logs/payments');
            const paySnap = await get(payRef);
            if (paySnap.exists()) {
                const data = paySnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.timestamp - a.timestamp);
                setPaymentLogs(list);
            } else {
                setPaymentLogs([]);
            }

            // Fetch refunds
            const refundRef = dbRef(db, 'usage_logs/refunds');
            const refundSnap = await get(refundRef);
            if (refundSnap.exists()) {
                const data = refundSnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.timestamp - a.timestamp);
                setRefundLogs(list);
            } else {
                setRefundLogs([]);
            }

            // Fetch complaints
            const complaintRef = dbRef(db, 'usage_logs/complaints');
            const complaintSnap = await get(complaintRef);
            if (complaintSnap.exists()) {
                const data = complaintSnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.timestamp - a.timestamp);
                setComplaintLogs(list);
            } else {
                setComplaintLogs([]);
            }

            // Fetch activation codes
            const codesRef = dbRef(db, 'activation_codes');
            const codesSnap = await get(codesRef);
            if (codesSnap.exists()) {
                const data = codesSnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.created_at - a.created_at);
                setActivationCodes(list);
            } else {
                setActivationCodes([]);
            }
        } catch (e) {
            console.error('Failed to load usage logs:', e);
            addToast('Error loading real-time analytics data', 'error');
        } finally {
            setIsLogsLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'analytics' || activeTab === 'payments' || activeTab === 'users') {
            void fetchUsageLogs();
        }
    }, [activeTab]);

    const handleApproveRefund = async (refund: any) => {
        try {
            await update(dbRef(db, `usage_logs/refunds/${refund.id}`), {
                status: 'approved',
                resolved_at: Date.now()
            });

            await update(dbRef(db, `users/${refund.user_id}`), {
                is_activated: false,
                subscription_status: 'none',
                paystack_reference: null
            });

            addToast('Refund approved successfully! User access revoked.', 'success');
            void fetchUsageLogs();
            void fetchUsers();
        } catch (e: any) {
            addToast('Failed to approve refund: ' + e.message, 'error');
        }
    };

    const handleResolveComplaint = async (complaint: any) => {
        try {
            await update(dbRef(db, `usage_logs/complaints/${complaint.id}`), {
                status: 'resolved',
                resolved_at: Date.now()
            });

            addToast('Complaint marked as resolved!', 'success');
            void fetchUsageLogs();
        } catch (e: any) {
            addToast('Failed to resolve complaint: ' + e.message, 'error');
        }
    };

    const handleSimulateRefund = async () => {
        try {
            const mockUser = allUsersList.find(u => u.subscription_status === 'premium') || allUsersList[0];
            if (!mockUser) {
                addToast('No users registered to simulate refund', 'error');
                return;
            }
            const ref = push(dbRef(db, 'usage_logs/refunds'));
            await set(ref, {
                id: ref.key,
                user_id: mockUser.uid,
                email: mockUser.email || 'student@vantutor.com',
                reason: 'Requested course change / accidental subscription',
                status: 'pending',
                timestamp: Date.now()
            });
            addToast('Simulated refund request created for ' + (mockUser.display_name || mockUser.email), 'success');
            void fetchUsageLogs();
        } catch (e: any) {
            addToast('Failed to simulate refund: ' + e.message, 'error');
        }
    };

    const handleSimulateComplaint = async () => {
        try {
            const mockUser = allUsersList[0];
            if (!mockUser) {
                addToast('No users registered to simulate complaint', 'error');
                return;
            }
            const ref = push(dbRef(db, 'usage_logs/complaints'));
            await set(ref, {
                id: ref.key,
                user_id: mockUser.uid,
                email: mockUser.email || 'student@vantutor.com',
                message: 'Paystack payment went through but the activation screen did not disappear immediately.',
                status: 'pending',
                timestamp: Date.now()
            });
            addToast('Simulated support complaint created!', 'success');
            void fetchUsageLogs();
        } catch (e: any) {
            addToast('Failed to simulate complaint: ' + e.message, 'error');
        }
    };

    const handleGenerateActivationCode = async () => {
        if (!newCodeApiKey.trim()) {
            addToast('Please enter an actual Gemini API key to generate a code', 'error');
            return;
        }
        setIsGeneratingCode(true);
        try {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ12345';
            let code = '';
            let isUnique = false;
            let safetyCounter = 0;
            
            while (!isUnique && safetyCounter < 100) {
                safetyCounter++;
                code = '';
                for (let i = 0; i < 5; i++) {
                    code += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                const checkRef = dbRef(db, `activation_codes/${code}`);
                const checkSnap = await get(checkRef);
                if (!checkSnap.exists()) {
                    isUnique = true;
                }
            }

            await set(dbRef(db, `activation_codes/${code}`), {
                code,
                api_key: newCodeApiKey.trim(),
                status: 'unused',
                created_at: Date.now(),
                used_by: '',
                used_at: ''
            });

            addToast(`Activation code ${code} generated successfully!`, 'success');
            setNewCodeApiKey('');
            void fetchUsageLogs();
        } catch (e: any) {
            addToast('Failed to generate activation code: ' + e.message, 'error');
        } finally {
            setIsGeneratingCode(false);
        }
    };

    const handleDeleteActivationCode = async (codeId: string) => {
        try {
            await remove(dbRef(db, `activation_codes/${codeId}`));
            addToast('Activation code deleted!', 'success');
            void fetchUsageLogs();
        } catch (e: any) {
            addToast('Failed to delete code: ' + e.message, 'error');
        }
    };

    // Departments State
    const [allDepartments, setAllDepartments] = useState<any[]>([]);
    const [newDeptName, setNewDeptName] = useState('');
    const [courseSearchQuery, setCourseSearchQuery] = useState('');
    const [managerSelectionDepartmentId, setManagerSelectionDepartmentId] = useState('');
    const [managerSelectionLevel, setManagerSelectionLevel] = useState('');
    const [courseDetailFiles, setCourseDetailFiles] = useState<File[]>([]);

    const fetchDepartments = async () => {
        try {
            const deptRef = dbRef(db, 'departments_data');
            const snapshot = await get(deptRef);
            if (snapshot.exists()) {
                const data = snapshot.val();
                const depts = Object.keys(data).map(id => ({ id, ...data[id] }));
                setAllDepartments(depts);
            }
        } catch (error) {
            console.error("Error fetching departments:", error);
        }
    };

    useEffect(() => {
        fetchDepartments();
    }, []);

    const handleAddDepartment = async () => {
        if (!newDeptName) return;
        const id = newDeptName.toLowerCase().replace(/\s+/g, '_');
        try {
            await set(dbRef(db, `departments_data/${id}`), {
                department_name: newDeptName,
                levels: LEVELS
            });
            setNewDeptName('');
            fetchDepartments();
            addToast("Department added successfully!", "success");
        } catch (error: any) {
            addToast(error.message, "error");
        }
    };

    // Fetch Users helper
    const fetchUsers = async () => {
        setIsUsersLoading(true);
        try {
            const usersRef = dbRef(db, 'users');
            const snapshot = await get(usersRef);
            if (snapshot.exists()) {
                const users = Object.values(snapshot.val()) as UserProfile[];
                setAllUsersList(users);
            }
        } catch (error) {
            console.error("Error fetching users:", error);
            addToast("Failed to load users list", "error");
        }
        setIsUsersLoading(false);
    };

    const handleUpdateUserSubscription = async (uid: string, nextStatus: 'none' | 'premium' | 'personal_token') => {
        try {
            const userRef = dbRef(db, `users/${uid}`);
            await update(userRef, { subscription_status: nextStatus });
            addToast("User subscription status migrated successfully!", "success");
            void fetchUsers();
        } catch (error: any) {
            console.error("Error migrating user status:", error);
            addToast(error.message || "Migration failed", "error");
        }
    };

    useEffect(() => {
        if (activeTab === 'users') {
            fetchUsers();
        }
    }, [activeTab]);

    useEffect(() => {
        if (recipientMode === 'single' && selectedRecipientId && !allUsersList.some(u => u.uid === selectedRecipientId)) {
            setSelectedRecipientId('');
        }
    }, [allUsersList, recipientMode, selectedRecipientId]);

    const getTargetUsers = () => {
        if (recipientMode === 'all') {
            return allUsersList;
        }
        return allUsersList.filter(user => user.uid === selectedRecipientId);
    };

    const handleSendPushNotification = async () => {
        const title = announcementTitle.trim();
        const message = announcementMessage.trim();
        if (!title || !message) {
            addToast("Please enter both title and message", "error");
            return;
        }

        const targetUsers = getTargetUsers();
        if (targetUsers.length === 0) {
            addToast("Please select a valid recipient", "error");
            return;
        }

        setIsSendingPush(true);
        try {
            const updates: Record<string, any> = {};
            const skippedUsers: string[] = [];
            targetUsers.forEach(user => {
                const notificationId = push(dbRef(db, `notifications/${user.uid}`)).key;
                if (!notificationId) {
                    skippedUsers.push(user.display_name || user.uid);
                    return;
                }
                updates[`notifications/${user.uid}/${notificationId}`] = {
                    type: notificationType,
                    title,
                    message,
                    is_read: false,
                    timestamp: Date.now(),
                };
            });

            if (Object.keys(updates).length === 0) {
                addToast("Could not prepare notifications", "error");
                return;
            }

            await update(dbRef(db), updates);
            setAnnouncementTitle('');
            setAnnouncementMessage('');
            const successfulSends = targetUsers.length - skippedUsers.length;
            if (skippedUsers.length > 0) {
                const skippedPreview = skippedUsers.slice(0, MAX_SKIPPED_USERS_PREVIEW).join(', ');
                addToast(`Push sent to ${successfulSends} user${successfulSends !== 1 ? 's' : ''}. Skipped (failed ID generation): ${skippedPreview}${skippedUsers.length > MAX_SKIPPED_USERS_PREVIEW ? ', ...' : ''}.`, "info");
            } else {
                addToast(`Push notification sent to ${successfulSends} user${successfulSends !== 1 ? 's' : ''}.`, "success");
            }
        } catch (error: any) {
            console.error("Error sending push notifications:", error);
            addToast(error?.message || "Failed to send push notification", "error");
        } finally {
            setIsSendingPush(false);
        }
    };

        const handleSuggestAnnouncement = async () => {
            if (!ai) {
                addToast("AI features are unavailable because the Gemini API key is not configured in App Controls.", "error");
                return;
            }
            setIsSendingPush(true);
            try {
                const prompt = `Create a short notification title (max 8 words) and a concise notification message (max 200 characters) for a ${notificationType.replace('_', ' ')} to students. Return only a JSON object with keys \"title\" and \"message\".`;

                const response = await ai.models.generateContent({
                    model: geminiModel,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                title: { type: Type.STRING },
                                message: { type: Type.STRING }
                            },
                            required: ['title', 'message']
                        }
                    }
                });

                if (!response.text) throw new Error('AI returned an empty suggestion.');
                const data = JSON.parse(response.text);
                setAnnouncementTitle((data.title || '').toString());
                setAnnouncementMessage((data.message || '').toString());
                addToast('Suggested announcement generated.', 'success');
            } catch (error: any) {
                console.error('Error generating suggestion:', error);
                addToast(error?.message || 'Failed to generate suggestion', 'error');
            } finally {
                setIsSendingPush(false);
            }
        };

    const handleSendEmail = () => {
        const subject = emailSubject.trim();
        const body = emailBody.trim();
        if (!subject || !body) {
            addToast("Please enter both email subject and body", "error");
            return;
        }

        const targetUsers = getTargetUsers();
        if (targetUsers.length === 0) {
            addToast("Please select a valid recipient", "error");
            return;
        }

        const emailList = Array.from(new Set(targetUsers.map(user => user.email?.trim()).filter(Boolean) as string[]));
        if (emailList.length === 0) {
            addToast("No email address found for selected recipient(s)", "error");
            return;
        }

        const encodedSubject = encodeURIComponent(subject);
        const encodedBody = encodeURIComponent(body);
        const mailtoLink = recipientMode === 'single'
            ? `mailto:${emailList[0]}?subject=${encodedSubject}&body=${encodedBody}`
            : `mailto:?bcc=${encodeURIComponent(emailList.join(','))}&subject=${encodedSubject}&body=${encodedBody}`;
        if (mailtoLink.length > MAX_MAILTO_LINK_LENGTH) {
            addToast("Too many recipients for one email draft. Please send emails in multiple single-user sends.", "error");
            return;
        }

        try {
            window.open(mailtoLink, '_blank', 'noopener,noreferrer');
            addToast(`Email draft prepared for ${emailList.length} recipient${emailList.length !== 1 ? 's' : ''}.`, "success");
        } catch (error: any) {
            console.error("Error opening email client:", error);
            addToast(error?.message || "Could not open your email client.", "error");
        }
    };

    const handleSaveAppSettings = async () => {
        const nextSettings = {
            ...appSettingsDraft,
            primary_gemini_model: appSettingsDraft.primary_gemini_model.trim() || DEFAULT_APP_SETTINGS.primary_gemini_model,
            gemini_api_key: appSettingsDraft.gemini_api_key.trim(),
            paystack_public_key: (appSettingsDraft.paystack_public_key || '').trim(),
            paystack_secret_key: (appSettingsDraft.paystack_secret_key || '').trim(),
            custom_user_limit_rpm: appSettingsDraft.custom_user_limit_rpm ?? 10,
            custom_user_limit_tpm: appSettingsDraft.custom_user_limit_tpm ?? 250000,
        };

        setIsSavingAppSettings(true);
        try {
            await set(dbRef(db, APP_SETTINGS_PATH), nextSettings);
            addToast('App settings saved successfully!', 'success');
        } catch (error: any) {
            console.error('Error saving app settings:', error);
            addToast(error?.message || 'Failed to save app settings', 'error');
        } finally {
            setIsSavingAppSettings(false);
        }
    };

    const handleTestGeminiSettings = async () => {
        const modelToTest = appSettingsDraft.primary_gemini_model.trim() || DEFAULT_APP_SETTINGS.primary_gemini_model;
        const apiKeyToTest = appSettingsDraft.gemini_api_key.trim();
        if (!apiKeyToTest) {
            addToast('Add a Gemini API key before running the hello test.', 'error');
            return;
        }

        setIsTestingAppSettings(true);
        try {
            const testClient = new GoogleGenAI({ apiKey: apiKeyToTest });
            const response = await testClient.models.generateContent({
                model: modelToTest,
                contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
            });
            const preview = (response.text || '').trim();
            if (!preview) {
                throw new Error('The test returned an empty response.');
            }
            addToast(`Hello test successful: ${preview.slice(0, 120)}`, 'success');
        } catch (error: any) {
            console.error('Error testing Gemini settings:', error);
            addToast(error?.message || 'Hello test failed.', 'error');
        } finally {
            setIsTestingAppSettings(false);
        }
    };

    // Past Questions State
    const [year, setYear] = useState('');
    const [newQuestion, setNewQuestion] = useState<Question>({
        question: '',
        options: ['', '', '', ''],
        correctAnswer: '',
        explanation: ''
    });
    const [pqFile, setPqFile] = useState<File | null>(null);
    const [isPQProcessing, setIsPQProcessing] = useState(false);

    // Course Outline State
    const [departmentId, setDepartmentId] = useState('');
    const [targetDepartmentIds, setTargetDepartmentIds] = useState<string[]>([]);
    const [coursesList, setCoursesList] = useState<Course[]>([]);
    const [selectedCatalogCourseKey, setSelectedCatalogCourseKey] = useState('');
    const [catalogDepartmentSelection, setCatalogDepartmentSelection] = useState<string[]>([]);
    const [courseRegistrationFiles, setCourseRegistrationFiles] = useState<File[]>([]);
    const [courseImportTargetMode, setCourseImportTargetMode] = useState<'selected' | 'all'>('selected');
    const [courseImportDepartmentIds, setCourseImportDepartmentIds] = useState<string[]>([]);
    const [isCourseImporting, setIsCourseImporting] = useState(false);
    const [courseImportProgress, setCourseImportProgress] = useState('');
    const [courseImportLevelOverride, setCourseImportLevelOverride] = useState('');
    const [courseImportSessionOverride, setCourseImportSessionOverride] = useState('');

    // Textbook State
    const [isUploading, setIsUploading] = useState(false);
    const [extractionProgress, setExtractionProgress] = useState('');

    const [uploadDepartmentId, setUploadDepartmentId] = useState('');
    const [uploadLevel, setUploadLevel] = useState('');
    const [uploadCourseName, setUploadCourseName] = useState('');
    const [autoSyncToOfferingDepartments, setAutoSyncToOfferingDepartments] = useState(true);

    useEffect(() => {
        setAppSettingsDraft(appSettings);
    }, [appSettings]);

    useEffect(() => {
        const pathTab = resolvedPathname.split('/').filter(Boolean)[1] as AdminTab | undefined;
        const selectedTab: AdminTab = pathTab && visibleTabs.includes(pathTab)
            ? pathTab
            : 'dashboard';
        setActiveTab(selectedTab);
    }, [resolvedPathname, visibleTabs]);

    useEffect(() => {
        if (pathname) return;
        const handlePopState = () => setInternalPathname(getWindowPathname());
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [pathname]);

    useEffect(() => {
        if (isManagerCourseView) {
            setDepartmentId(courseAdminView.departmentId);
            setTargetDepartmentIds([courseAdminView.departmentId]);
            setManagerSelectionDepartmentId(courseAdminView.departmentId);
            setManagerSelectionLevel(courseAdminView.level);
            return;
        }

        if (courseAdminView.mode === 'add') {
            const routeDepartmentId = courseAdminView.departmentId || '';
            const routeLevel = courseAdminView.level || '';
            if (routeDepartmentId) {
                setCourseImportDepartmentIds([routeDepartmentId]);
                setCourseImportTargetMode('selected');
                setDepartmentId(routeDepartmentId);
            }
            if (routeLevel) {
                setCourseImportLevelOverride(normalizeLevel(routeLevel));
            }
            return;
        }

        if (courseAdminView.mode === 'manager-root') {
            setDepartmentId('');
            setTargetDepartmentIds([]);
            setCoursesList([]);
            setCourseDetailFiles([]);
            setManagerSelectionDepartmentId('');
            setManagerSelectionLevel('');
        }
    }, [courseAdminView, isManagerCourseView]);

    const loadDepartmentCourses = async (selectedDepartmentId: string) => {
        if (!selectedDepartmentId) {
            setCoursesList([]);
            return;
        }

        const departmentRef = dbRef(db, `departments_data/${selectedDepartmentId}`);
        const snap = await get(departmentRef);
        if (snap.exists()) {
            setCoursesList(normalizeCourseList(snap.val()?.course_list));
            return;
        }
        setCoursesList([]);
    };

    useEffect(() => {
        if (departmentId) {
            loadDepartmentCourses(departmentId);
            setTargetDepartmentIds([departmentId]);
        } else {
            setTargetDepartmentIds([]);
            setCoursesList([]);
        }
    }, [departmentId]);

    const courseCatalog = useMemo(() => {
        const catalogMap = new Map<string, { course: Course; departmentIds: Set<string> }>();

        allDepartments.forEach((department: any) => {
            const departmentCourses = normalizeCourseList(department?.course_list);
            departmentCourses.forEach((course) => {
                const courseKey = getCourseMergeKey(course);
                if (!courseKey) return;

                const existingEntry = catalogMap.get(courseKey);
                if (existingEntry) {
                    existingEntry.course = mergeCourseRecord(
                        existingEntry.course,
                        { ...course, course_id: existingEntry.course.course_id || course.course_id || courseKey }
                    );
                    existingEntry.departmentIds.add(department.id);
                    return;
                }

                catalogMap.set(courseKey, {
                    course: { ...course, course_id: course.course_id || courseKey },
                    departmentIds: new Set([department.id]),
                });
            });
        });

        return Array.from(catalogMap.entries())
            .map(([key, value]) => ({
                key,
                course: value.course,
                departmentIds: Array.from(value.departmentIds),
            }))
            .sort((a, b) => a.course.course_name.localeCompare(b.course.course_name));
    }, [allDepartments]);

    const selectedCatalogCourse = courseCatalog.find(courseEntry => courseEntry.key === selectedCatalogCourseKey) || null;

    useEffect(() => {
        if (!courseCatalog.length) {
            setSelectedCatalogCourseKey('');
            setCatalogDepartmentSelection([]);
            return;
        }

        const hasSelection = courseCatalog.some(courseEntry => courseEntry.key === selectedCatalogCourseKey);
        if (!hasSelection) {
            const firstCourse = courseCatalog[0];
            setSelectedCatalogCourseKey(firstCourse.key);
            setCatalogDepartmentSelection(firstCourse.departmentIds);
        }
    }, [courseCatalog, selectedCatalogCourseKey]);

    useEffect(() => {
        if (!selectedCatalogCourse) return;
        setCatalogDepartmentSelection(selectedCatalogCourse.departmentIds);
    }, [selectedCatalogCourseKey, courseCatalog]);

    const toggleTargetDepartment = (targetId: string) => {
        // Keep a defensive guard even though primary checkbox is disabled in UI.
        if (!departmentId || targetId === departmentId) return;
        setTargetDepartmentIds(prev => (
            prev.includes(targetId)
                ? prev.filter(id => id !== targetId)
                : [...prev, targetId]
        ));
    };

    const toggleCatalogDepartment = (targetId: string) => {
        setCatalogDepartmentSelection(prev => (
            prev.includes(targetId)
                ? prev.filter(id => id !== targetId)
                : [...prev, targetId]
        ));
    };

    const toggleCourseImportDepartment = (targetId: string) => {
        setCourseImportDepartmentIds(prev => (
            prev.includes(targetId)
                ? prev.filter(id => id !== targetId)
                : [...prev, targetId]
        ));
    };

    const handleSaveCatalogCourseDepartments = async () => {
        if (!selectedCatalogCourse) {
            addToast("Select a course first", "error");
            return;
        }
        if (!catalogDepartmentSelection.length) {
            addToast("Select at least one department", "error");
            return;
        }

        try {
            const departmentSnapshot = await get(dbRef(db, 'departments_data'));
            const departmentsData = departmentSnapshot.exists() ? departmentSnapshot.val() : {};
            const updates: Record<string, Course[]> = {};
            const selectedDepartmentSet = new Set(catalogDepartmentSelection);
            const selectedCourseKey = selectedCatalogCourse.key;
            const selectedCourseRecord = {
                ...selectedCatalogCourse.course,
                course_id: selectedCatalogCourse.course.course_id || selectedCourseKey,
            };

            Object.entries(departmentsData).forEach(([deptKey, deptValue]: [string, any]) => {
                const existingCourses = normalizeCourseList(deptValue?.course_list);
                const hasSelectedCourse = existingCourses.some(course => getCourseMergeKey(course) === selectedCourseKey);
                const shouldIncludeCourse = selectedDepartmentSet.has(deptKey);
                let nextCourses = existingCourses;

                if (shouldIncludeCourse) {
                    nextCourses = upsertCourseInList(existingCourses, selectedCourseRecord);
                } else if (hasSelectedCourse) {
                    nextCourses = existingCourses.filter(course => getCourseMergeKey(course) !== selectedCourseKey);
                }

                if (JSON.stringify(existingCourses) !== JSON.stringify(nextCourses)) {
                    updates[`departments_data/${deptKey}/course_list`] = nextCourses;
                }
            });

            if (!Object.keys(updates).length) {
                addToast("No department changes to save", "info");
                return;
            }

            await update(dbRef(db), updates);
            await fetchDepartments();
            if (departmentId) {
                await loadDepartmentCourses(departmentId);
            }
            addToast("Course department access updated successfully!", "success");
        } catch (error: any) {
            console.error("Error updating course department access:", error);
            addToast(error?.message || "Failed to update course departments", "error");
        }
    };

    const handleMergeDuplicateCoursesAcrossDepartments = async () => {
        try {
            const departmentSnapshot = await get(dbRef(db, 'departments_data'));
            const departmentsData = departmentSnapshot.exists() ? departmentSnapshot.val() : {};
            const canonicalCoursesByKey = new Map<string, Course>();
            const updates: Record<string, Course[]> = {};

            Object.entries(departmentsData).forEach(([, deptValue]: [string, any]) => {
                const departmentCourses = normalizeCourseList(deptValue?.course_list);
                departmentCourses.forEach((course) => {
                    const courseKey = getCourseMergeKey(course);
                    if (!courseKey) return;
                    const existing = canonicalCoursesByKey.get(courseKey);
                    if (existing) {
                        canonicalCoursesByKey.set(courseKey, mergeCourseRecord(existing, {
                            ...course,
                            course_id: existing.course_id || course.course_id || courseKey,
                        }));
                        return;
                    }
                    canonicalCoursesByKey.set(courseKey, { ...course, course_id: course.course_id || courseKey });
                });
            });

            Object.entries(departmentsData).forEach(([deptKey, deptValue]: [string, any]) => {
                const existingCourses = normalizeCourseList(deptValue?.course_list);
                const nextCourses = normalizeCourseList(
                    existingCourses
                        .map((course) => canonicalCoursesByKey.get(getCourseMergeKey(course)))
                        .filter(Boolean) as Course[]
                );

                if (JSON.stringify(existingCourses) !== JSON.stringify(nextCourses)) {
                    updates[`departments_data/${deptKey}/course_list`] = nextCourses;
                }
            });

            if (!Object.keys(updates).length) {
                addToast("No duplicate same-title courses found to merge", "info");
                return;
            }

            await update(dbRef(db), updates);
            await fetchDepartments();
            if (departmentId) {
                await loadDepartmentCourses(departmentId);
            }
            addToast("Merged duplicate same-title courses across departments!", "success");
        } catch (error: any) {
            console.error("Error merging duplicate courses:", error);
            addToast(error?.message || "Failed to merge duplicate courses", "error");
        }
    };

    const handleDeleteCourseFromDepartment = useCallback(async (course: Course) => {
        if (!isManagerCourseView) return;

        const { departmentId: currentDepartmentId, level: currentLevel } = courseAdminView;

        const courseLabel = course.course_code || course.course_name || course.course_id;
        const departmentLabel = allDepartments.find((dept) => dept.id === currentDepartmentId)?.department_name || currentDepartmentId;
        const confirmed = window.confirm(`Delete ${courseLabel} from ${departmentLabel} (${currentLevel})? This will remove the course and its stored textbook outline for this department.`);
        if (!confirmed) return;

        try {
            const departmentRef = dbRef(db, `departments_data/${currentDepartmentId}`);
            const departmentSnapshot = await get(departmentRef);
            const existingCourses = normalizeCourseList(departmentSnapshot.val()?.course_list);
            const targetCourseKey = getCourseMergeKey(course) || course.course_id;
            const nextCourses = existingCourses.filter((item) => {
                const itemKey = getCourseMergeKey(item) || item.course_id;
                return itemKey !== targetCourseKey;
            });

            await update(departmentRef, { course_list: nextCourses });
            if (course.course_name) {
                await remove(dbRef(db, `textbook_contexts/${currentDepartmentId}/${currentLevel}/${course.course_name}`));
            }

            await fetchDepartments();
            await loadDepartmentCourses(currentDepartmentId);
            handleCourseTabNavigate(buildCourseManagerPath(currentDepartmentId, currentLevel));
            addToast(`Deleted ${course.course_name} from ${departmentLabel}.`, 'success');
        } catch (error: any) {
            console.error('Error deleting course:', error);
            addToast(error?.message || 'Failed to delete course', 'error');
        }
    }, [addToast, allDepartments, courseAdminView, isManagerCourseView, loadDepartmentCourses]);

    const handleAddQuestion = async () => {
        if (!uploadDepartmentId || !uploadLevel || !uploadCourseName || !year || !newQuestion.question || !newQuestion.correctAnswer) {
            addToast("Please fill all required fields", "error");
            return;
        }

        try {
            const pqRef = dbRef(db, `past_questions/${uploadDepartmentId}/${uploadLevel}/${uploadCourseName}/${year}`);
            const newPQRef = push(pqRef);
            await set(newPQRef, newQuestion);
            addToast("Question added successfully!", "success");
            setNewQuestion({
                question: '',
                options: ['', '', '', ''],
                correctAnswer: '',
                explanation: ''
            });
        } catch (error: any) {
            addToast(error.message, "error");
        }
    };

    const handlePQUpload = async () => {
        if (!pqFile || !uploadDepartmentId || !uploadLevel || !uploadCourseName || !year) {
            addToast("Please select a PDF file and enter Department, Level, Course Name and Year", "error");
            return;
        }
        if (!ai) {
            addToast("AI features are unavailable because the Gemini API key is not configured in App Controls.", "error");
            return;
        }

        setIsPQProcessing(true);
        setExtractionProgress(`Extracting questions with ${geminiModel}...`);

        try {
            const reader = new FileReader();
            reader.readAsDataURL(pqFile);
            
            const base64PDF = await new Promise<string>((resolve) => {
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
            });

            const prompt = `Analyze this PDF containing past exam questions for "${uploadCourseName}" (${year}) at "${uploadLevel}" level. 
            Extract ALL multiple-choice questions into a structured JSON array.
            
            RULES:
            1. Output ONLY the JSON array.
            2. Each object must have: question, options (array of 4 strings), correctAnswer (the exact string of the correct option), and explanation (brief reasoning).
            3. Ensure the correctAnswer exactly matches one of the strings in the options array.

            FORMAT:
            {
                "questions": [
                    {
                        "question": "What is...?",
                        "options": ["A", "B", "C", "D"],
                        "correctAnswer": "A",
                        "explanation": "Because..."
                    }
                ]
            }`;

            const response = await ai.models.generateContent({
                model: geminiModel,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType: 'application/pdf', data: base64PDF } }
                        ]
                    }
                ],
                config: {
                    responseMimeType: "application/json"
                }
            });

            if (!response.text) {
                throw new Error("AI returned an empty response while extracting questions.");
            }
            const responseData = JSON.parse(response.text);
            const extractedQuestions = responseData.questions || [];

            if (extractedQuestions.length === 0) throw new Error("No questions found in the PDF.");

            setExtractionProgress(`Saving ${extractedQuestions.length} questions to database...`);

            const pqRef = dbRef(db, `past_questions/${uploadDepartmentId}/${uploadLevel}/${uploadCourseName}/${year}`);
            
            // Push each question individually
            for (const q of extractedQuestions) {
                const newPQRef = push(pqRef);
                await set(newPQRef, q);
            }

            addToast(`Successfully extracted and saved ${extractedQuestions.length} questions!`, "success");
            setPqFile(null);
        } catch (error: any) {
            console.error(error);
            addToast(`Error: ${error.message}`, "error");
        } finally {
            setIsPQProcessing(false);
            setExtractionProgress('');
        }
    };

    const handleCourseRegistrationImport = async () => {
        const selectedDepartmentIds = courseImportTargetMode === 'all'
            ? allDepartments.map((dept) => dept.id)
            : getUniqueIds(courseImportDepartmentIds);
        if (!selectedDepartmentIds.length) {
            addToast("Please select at least one target department", "error");
            return;
        }
        if (!courseRegistrationFiles.length) {
            addToast("Please select at least one course registration PDF", "error");
            return;
        }
        if (!courseImportLevelOverride) {
            addToast("Please select a target level", "error");
            return;
        }
        if (!ai) {
            addToast("AI features are unavailable because the Gemini API key is not configured in App Controls.", "error");
            return;
        }

        setIsCourseImporting(true);
        setCourseImportProgress(`Extracting courses from PDF 1/${courseRegistrationFiles.length}...`);

        try {
            let normalizedImportedCourses: Course[] = [];
            let extractedSessionLabel = '';

            for (let fileIndex = 0; fileIndex < courseRegistrationFiles.length; fileIndex++) {
                const file = courseRegistrationFiles[fileIndex];
                setCourseImportProgress(`Extracting courses from PDF ${fileIndex + 1}/${courseRegistrationFiles.length}...`);

                const reader = new FileReader();
                reader.readAsDataURL(file);
                const base64PDF = await new Promise<string>((resolve) => {
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                });

                const prompt = `Analyze this university course-registration form PDF and extract all registered courses for both first and second semesters.

RULES:
1. Output ONLY valid JSON.
2. Root object must include:
   - academic_session (string, e.g. "2025/2026")
   - level (string, e.g. "100lvl")
   - courses (array)
3. Each courses item must include:
   - code (string)
   - title (string)
   - semester ("first" or "second")
   - unit (number if available)
   - status (string if available)
4. If only one semester exists in the PDF, still return available courses.
5. Normalize semester values strictly to "first" or "second".

FORMAT:
{
  "academic_session": "2025/2026",
  "level": "100lvl",
  "courses": [
    {
      "code": "GST 111",
      "title": "COMMUNICATION IN ENGLISH",
      "semester": "first",
      "unit": 2,
      "status": "C"
    }
  ]
}`;

                const response = await ai.models.generateContent({
                    model: geminiModel,
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                { text: prompt },
                                { inlineData: { mimeType: 'application/pdf', data: base64PDF } }
                            ]
                        }
                    ],
                    config: {
                        responseMimeType: "application/json"
                    }
                });

                if (!response.text) {
                    throw new Error("AI returned an empty response while extracting courses.");
                }

                const responseData = JSON.parse(response.text);
                const extractedSession = (responseData?.academic_session || '').toString().trim();
                if (!extractedSessionLabel && extractedSession) {
                    extractedSessionLabel = extractedSession;
                }
                const extractedCourses = Array.isArray(responseData?.courses) ? responseData.courses : [];
                if (!extractedCourses.length) {
                    continue;
                }

                const normalizedCourses = extractedCourses
                    .map((course: any, index: number) => sanitizeCourseFromRegistrationForm(
                        course,
                        index,
                        responseData?.level,
                        responseData?.academic_session,
                        courseImportLevelOverride,
                        courseImportSessionOverride
                    ))
                    .filter((course: Course) => Boolean(course.course_id && course.course_name));

                normalizedCourses.forEach((course: Course) => {
                    normalizedImportedCourses = upsertCourseInList(normalizedImportedCourses, course);
                });
            }

            if (!normalizedImportedCourses.length) {
                throw new Error("Extracted courses were invalid after normalization.");
            }

            const semesterDistribution = normalizedImportedCourses.reduce(
                (acc, course) => {
                    acc[course.semester === 'second' ? 'second' : 'first'] += 1;
                    return acc;
                },
                { first: 0, second: 0 }
            );
            const updates: Record<string, Course[]> = {};
            setCourseImportProgress("Applying extracted courses to selected departments...");

            for (const targetDepartmentId of selectedDepartmentIds) {
                const targetDepartmentRef = dbRef(db, `departments_data/${targetDepartmentId}`);
                const targetDepartmentSnapshot = await get(targetDepartmentRef);
                const existingCourses = normalizeCourseList(targetDepartmentSnapshot.val()?.course_list);
                const mergedCourses = mergeCourseListsIntoTarget(existingCourses, normalizedImportedCourses);
                updates[`departments_data/${targetDepartmentId}/course_list`] = mergedCourses;
            }

            await update(dbRef(db), updates);
            await fetchDepartments();

            if (selectedDepartmentIds.includes(departmentId)) {
                await loadDepartmentCourses(departmentId);
            }

            const importedList = normalizeCourseList(normalizedImportedCourses);
            setCoursesList(prevCourses => mergeCourseListsIntoTarget(prevCourses, importedList));

            const sessionLabel = (courseImportSessionOverride || extractedSessionLabel || '').toString().trim();
            addToast(
                `Added ${importedList.length} merged course${importedList.length !== 1 ? 's' : ''} (${semesterDistribution.first} first-sem, ${semesterDistribution.second} second-sem) to ${selectedDepartmentIds.length} department${selectedDepartmentIds.length !== 1 ? 's' : ''}${sessionLabel ? ` for ${sessionLabel}` : ''}.`,
                "success"
            );
            setCourseRegistrationFiles([]);
        } catch (error: any) {
            console.error("Error importing course registration form:", error);
            addToast(error?.message || "Failed to import course registration form.", "error");
        } finally {
            setIsCourseImporting(false);
            setCourseImportProgress('');
        }
    };

    const handleTextbookUpload = async (
        courseId: string,
        files: File[],
        overrideDepartmentIds?: string[],
        overrideCourseList?: Course[]
    ) => {
        if (!ai) {
            addToast("AI features are unavailable because the Gemini API key is not configured in App Controls.", "error");
            return;
        }
        const sourceCourseList = overrideCourseList || coursesList;
        const selectedCourse = sourceCourseList.find(c => c.course_id === courseId || getCourseMergeKey(c) === courseId);
        if (!selectedCourse) {
            addToast("Missing file or course information", "error");
            return;
        }
        let syncDepartmentIds = getUniqueIds(overrideDepartmentIds || [departmentId, ...targetDepartmentIds]);

        // If auto-sync is enabled and we only have the primary department selected,
        // expand the sync list to include all departments that offer the same course
        // (so an upload to one department reflects across departments offering that course).
        if (autoSyncToOfferingDepartments && syncDepartmentIds.length <= 1) {
            try {
                const courseKey = getCourseMergeKey(selectedCourse);
                const catalogEntry = courseCatalog.find(entry => entry.key === courseKey);
                if (catalogEntry && Array.isArray(catalogEntry.departmentIds) && catalogEntry.departmentIds.length) {
                    syncDepartmentIds = getUniqueIds(catalogEntry.departmentIds);
                }
            } catch (e) {
                // fallback to provided syncDepartmentIds
            }
        }

        const primaryDepartmentId = syncDepartmentIds[0] || departmentId;
        if (!files.length || !primaryDepartmentId || !selectedCourse || !syncDepartmentIds.length) {
            addToast("Missing file or course information", "error");
            return;
        }

        const pdfFiles = files.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
        if (!pdfFiles.length) {
            addToast("Please select valid PDF textbook files", "error");
            return;
        }

        const { course_name, level } = selectedCourse;

        setIsUploading(true);
        setExtractionProgress(`Uploading 1/${pdfFiles.length} to storage...`);

        try {
            const uploadedUrls: string[] = [];
            const extractedTopicGroups: Topic[][] = [];

            for (let index = 0; index < pdfFiles.length; index++) {
                const file = pdfFiles[index];
                setExtractionProgress(`Uploading ${index + 1}/${pdfFiles.length} to storage...`);

                // 1. Upload to Firebase Storage
                const uploadToken = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                    ? crypto.randomUUID()
                    : `${Date.now()}_${typeof performance !== 'undefined' ? performance.now().toString().replace('.', '_') : '0'}_${index}_${file.lastModified}_${file.size}`;
                const fileRef = storageRef(storage, `textbooks/${primaryDepartmentId}/${level}/${course_name}/${uploadToken}_${file.name}`);
                const uploadResult = await uploadBytes(fileRef, file);
                const downloadURL = await getDownloadURL(uploadResult.ref);
                uploadedUrls.push(downloadURL);

                setExtractionProgress(`Extracting syllabus ${index + 1}/${pdfFiles.length} with ${geminiModel}...`);
                
                const reader = new FileReader();
                reader.readAsDataURL(file);
                const base64PDF = await new Promise<string>((resolve) => {
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                });

                const prompt = `Analyze this PDF textbook for "${course_name}" at "${level}" level.
            Extract a comprehensive syllabus/course outline into a structured JSON array of topics with concise grounding context.
            
            RULES:
            1. Output ONLY the JSON object.
            2. The root object must have a "syllabus" key which is an array of objects.
            3. Each topic object must have:
               - topic_name (string)
               - topic_id (slugified string)
               - topic_context (string, 1-2 lines describing what this topic covers and why it matters in this course)
               - start_point (string, where teaching should begin for this topic)
               - end_point (string, where teaching should stop for this topic)
            4. Keep context concise and specific to this course level.

            FORMAT:
            {
                "syllabus": [
                    {
                        "topic_name": "Introduction to...",
                        "topic_id": "intro_to_...",
                        "topic_context": "Brief course-grounded context...",
                        "start_point": "Start from ...",
                        "end_point": "Stop after ..."
                    },
                    ...
                ]
            }`;

                const response = await ai.models.generateContent({
                    model: geminiModel,
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                { text: prompt },
                                { inlineData: { mimeType: 'application/pdf', data: base64PDF } }
                            ]
                        }
                    ],
                    config: {
                        responseMimeType: "application/json"
                    }
                });

                if (!response.text) {
                    throw new Error(`AI returned an empty response while extracting syllabus from ${file.name}.`);
                }
                const responseData = JSON.parse(response.text);
                const syllabusData = Array.isArray(responseData?.syllabus)
                    ? responseData.syllabus.map((topic: any, topicIndex: number) => sanitizeTopicMetadata(topic, topicIndex))
                    : [];
                extractedTopicGroups.push(syllabusData);
            }

            setExtractionProgress('Saving to database...');

            // 3. Save textbook context + course updates to every selected department
            let primaryDepartmentCourses: Course[] | null = null;

            // Create a canonical shared textbook entry keyed by the course merge key.
            const courseKey = getCourseMergeKey(selectedCourse) || normalizeTopicId(course_name || selectedCourse.course_id || `${Date.now()}`);
            const sharedTextbookRef = dbRef(db, `textbook_contexts/shared/${courseKey}`);

            // Merge any existing shared context with newly extracted syllabus and pdfs
            const sharedSnapshot = await get(sharedTextbookRef);
            const existingShared = sharedSnapshot.exists() ? sharedSnapshot.val() : {};
            const existingSharedPdfUrls: string[] = Array.isArray(existingShared?.pdf_urls) ? existingShared.pdf_urls.filter(Boolean) : [];
            if (existingShared?.pdf_url && !existingSharedPdfUrls.includes(existingShared.pdf_url)) {
                existingSharedPdfUrls.push(existingShared.pdf_url);
            }
            const mergedSharedPdfUrls = Array.from(new Set([...existingSharedPdfUrls, ...uploadedUrls]));
            const mergedSharedSyllabus = mergeTopics(
                Array.isArray(existingShared?.syllabus) ? existingShared.syllabus : [],
                extractedTopicGroups.flat()
            );
            const primaryPdfUrl = selectPrimaryPdfUrl(uploadedUrls, existingShared?.pdf_url, mergedSharedPdfUrls);

            // Write canonical shared textbook data
            await set(sharedTextbookRef, {
                pdf_url: primaryPdfUrl,
                pdf_urls: mergedSharedPdfUrls,
                syllabus: mergedSharedSyllabus,
                uploaded_at: Date.now(),
                course_key: courseKey,
                course_name: course_name,
                level: level,
            });

            // Update each target department to reference the shared textbook instead of copying content
            for (const targetDepartmentId of syncDepartmentIds) {
                const departmentRef = dbRef(db, `departments_data/${targetDepartmentId}`);
                const departmentSnapshot = await get(departmentRef);
                const existingDepartmentCourses = normalizeCourseList(departmentSnapshot.val()?.course_list);

                const isPrimaryDepartmentTarget = targetDepartmentId === primaryDepartmentId;
                const coursesForTargetDepartment = isPrimaryDepartmentTarget ? sourceCourseList : existingDepartmentCourses;

                // Ensure the course entry carries a reference to the shared textbook
                const courseWithSharedRef = {
                    ...selectedCourse,
                    textbook_shared_key: courseKey,
                    textbook_urls: mergedSharedPdfUrls,
                    textbook_url: primaryPdfUrl,
                };

                const updatedCourseList = upsertCourseInList(coursesForTargetDepartment, courseWithSharedRef, mergedSharedSyllabus, mergedSharedPdfUrls);

                await update(departmentRef, {
                    course_list: updatedCourseList
                });

                if (targetDepartmentId === primaryDepartmentId) {
                    primaryDepartmentCourses = updatedCourseList;
                }
            }

            if (primaryDepartmentCourses) {
                if (!overrideCourseList) {
                    setCoursesList(primaryDepartmentCourses);
                }
            }

            addToast(`${uploadedUrls.length} textbook${uploadedUrls.length > 1 ? 's' : ''} for ${course_name} synced to ${syncDepartmentIds.length} department${syncDepartmentIds.length > 1 ? 's' : ''}!`, "success");
            await fetchDepartments();
        } catch (error: any) {
            console.error(error);
            addToast(`Error: ${error.message}`, "error");
        } finally {
            setIsUploading(false);
            setExtractionProgress('');
        }
    };

    const handleUpdateCourseOutline = async () => {
        if (!departmentId) {
            addToast("Please enter a Department ID", "error");
            return;
        }

        try {
            const syncDepartmentIds = getUniqueIds([departmentId, ...targetDepartmentIds]);
            const normalizedPrimaryCourses = normalizeCourseList(coursesList);

            if (!syncDepartmentIds.length) {
                addToast("Please select at least one department", "error");
                return;
            }

            await update(dbRef(db, `departments_data/${departmentId}`), {
                course_list: normalizedPrimaryCourses
            });
            setCoursesList(normalizedPrimaryCourses);

            const additionalDepartments = syncDepartmentIds.filter(id => id !== departmentId);
            for (const targetDepartmentId of additionalDepartments) {
                const targetDepartmentRef = dbRef(db, `departments_data/${targetDepartmentId}`);
                const targetDepartmentSnapshot = await get(targetDepartmentRef);
                const existingCourses = normalizeCourseList(targetDepartmentSnapshot.val()?.course_list);

                const mergedCourses = mergeCourseListsIntoTarget(existingCourses, normalizedPrimaryCourses);

                await update(targetDepartmentRef, {
                    course_list: mergedCourses
                });
            }

            addToast(`Course outline published to ${syncDepartmentIds.length} department${syncDepartmentIds.length > 1 ? 's' : ''}!`, "success");
            await fetchDepartments();
        } catch (error: any) {
            addToast(error.message, "error");
        }
    };

    const addCourseField = () => {
        setCoursesList([...coursesList, { course_id: '', course_name: '', topics: [], level: LEVELS[0], semester: DEFAULT_SEMESTER }]);
    };

    const selectedManagerDepartment = useMemo(
        () => (isManagerCourseView ? allDepartments.find((dept) => dept.id === courseAdminView.departmentId) || null : null),
        [allDepartments, courseAdminView, isManagerCourseView]
    );

    const managerCoursesForLevel = useMemo(
        () => (isManagerCourseView ? coursesList.filter((course) => course.level === courseAdminView.level) : []),
        [courseAdminView, coursesList, isManagerCourseView]
    );

    const selectedManagerCourse = useMemo(
        () => (
            courseAdminView.mode === 'manager-detail'
                ? managerCoursesForLevel.find((course) => matchesCourseIdentifier(course, courseAdminView.courseId)) || null
                : null
        ),
        [courseAdminView, managerCoursesForLevel]
    );

    const [selectedManagerCourseTopics, setSelectedManagerCourseTopics] = useState<Topic[]>([]);
    const [isSelectedManagerCourseTopicsLoading, setIsSelectedManagerCourseTopicsLoading] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const loadSelectedManagerCourseTopics = async () => {
            if (!selectedManagerCourse) {
                setSelectedManagerCourseTopics([]);
                setIsSelectedManagerCourseTopicsLoading(false);
                return;
            }

            const directTopics = Array.isArray(selectedManagerCourse.topics)
                ? selectedManagerCourse.topics.map((topic, index) => sanitizeTopicMetadata(topic, index))
                : [];

            if (directTopics.length > 0) {
                setSelectedManagerCourseTopics(directTopics);
                setIsSelectedManagerCourseTopicsLoading(false);
                return;
            }

            const courseKey = getCourseMergeKey(selectedManagerCourse);
            if (!courseKey) {
                setSelectedManagerCourseTopics([]);
                setIsSelectedManagerCourseTopicsLoading(false);
                return;
            }

            setIsSelectedManagerCourseTopicsLoading(true);
            try {
                const sharedSnapshot = await get(dbRef(db, `textbook_contexts/shared/${courseKey}`));
                if (!isMounted || !sharedSnapshot.exists()) {
                    if (isMounted) setSelectedManagerCourseTopics([]);
                    return;
                }

                const sharedData = sharedSnapshot.val() || {};
                const sharedTopics = Array.isArray(sharedData.syllabus)
                    ? sharedData.syllabus.map((topic: any, index: number) => sanitizeTopicMetadata(topic, index))
                    : [];

                if (isMounted) {
                    setSelectedManagerCourseTopics(sharedTopics);
                }
            } catch (error) {
                console.error('Failed to load shared textbook topics for selected course:', error);
                if (isMounted) {
                    setSelectedManagerCourseTopics([]);
                }
            } finally {
                if (isMounted) {
                    setIsSelectedManagerCourseTopicsLoading(false);
                }
            }
        };

        void loadSelectedManagerCourseTopics();

        return () => {
            isMounted = false;
        };
    }, [selectedManagerCourse]);

    const filteredGlobalCourses = useMemo(() => {
        const query = courseSearchQuery.trim().toLowerCase();
        return courseCatalog.filter(({ course, departmentIds }) => {
            if (!query) return true;
            const departmentNames = departmentIds
                .map((id) => allDepartments.find((dept) => dept.id === id)?.department_name || id)
                .join(' ');
            return [
                course.course_name,
                course.course_code,
                course.course_id,
                course.level,
                course.semester,
                departmentNames,
            ].some((value) => (value || '').toString().toLowerCase().includes(query));
        });
    }, [allDepartments, courseCatalog, courseSearchQuery]);
    const isCourseImportDisabled = (
        isCourseImporting ||
        !courseRegistrationFiles.length ||
        !courseImportLevelOverride ||
        (courseImportTargetMode === 'selected' && !courseImportDepartmentIds.length)
    );

    const handleCourseTabNavigate = useCallback((path: string) => {
        if (onNavigate) {
            // Let parent know, but also keep internal pathname in sync
            try { onNavigate(path); } catch (err) { /* ignore parent handler errors */ }
            setInternalPathname(path);
            return;
        }
        if (typeof window !== 'undefined') {
            window.history.pushState(null, '', path);
        }
        setInternalPathname(path);
    }, [onNavigate]);

    if (!userProfile.is_admin) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-center">
                <div className="bg-slate-800 border border-slate-700/50 p-8 rounded-3xl max-w-md w-full shadow-2xl flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center text-red-500 border border-red-500/20">
                        <Shield className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-black text-white">Access Denied</h3>
                    <p className="text-sm text-slate-400">This area is reserved for administrators only. Please log in with authorized credentials.</p>
                    <button
                        onClick={() => handleCourseTabNavigate('/')}
                        className="mt-4 px-6 py-3 rounded-xl bg-lime-500 hover:bg-lime-600 text-slate-950 font-bold uppercase tracking-widest text-xs transition shadow-lg shadow-lime-500/20"
                    >
                        Go to Platform Home
                    </button>
                </div>
            </div>
        );
    }

    const navigationItems = [
        { id: 'dashboard', label: 'Dashboard', icon: Home, path: '/admin' },
        { id: 'departments', label: 'Departments', icon: Building, path: '/admin/departments' },
        { id: 'courses', label: 'Course Catalog', icon: BookOpen, path: '/admin/courses/manager' },
        { id: 'questions', label: 'Past Questions', icon: HelpCircle, path: '/admin/questions' },
        { id: 'users', label: 'User Control', icon: Users, path: '/admin/users' },
        { id: 'analytics', label: 'Usage Analytics', icon: Activity, path: '/admin/analytics' },
        { id: 'payments', label: 'Payments Control', icon: CreditCard, path: '/admin/payments' },
        { id: 'app', label: 'App Settings', icon: SettingsIcon, path: '/admin/app' },
    ];

    const activeNavItems = navigationItems.filter(item => visibleTabs.includes(item.id as AdminTab));

    return (
        <div className="min-h-screen bg-[#f4f6f9] flex text-slate-800 w-full overflow-hidden font-sans select-none vantutor-admin">
            {/* Sidebar - Desktop */}
            <aside className="w-64 bg-white/60 backdrop-blur-lg text-slate-700 flex-shrink-0 flex flex-col justify-between border-r border-white/40 sticky top-0 h-screen z-40 hidden md:flex">
                <div className="flex flex-col gap-4">
                    {/* Header Brand */}
                    <div className="flex items-center gap-3 border-b border-slate-200 pb-4 px-6 pt-5">
                        <div className="w-8 h-8 rounded-full bg-blue-600 border border-blue-500 flex items-center justify-center text-white text-sm font-black shadow-md shadow-blue-500/10">
                            A
                        </div>
                        <div>
                            <h2 className="text-sm font-black text-slate-800 tracking-wide leading-tight">AdminLTE 4</h2>
                            <p className="text-[9px] uppercase font-bold text-blue-600 tracking-widest -mt-0.5">VanTutor Admin</p>
                        </div>
                    </div>

                    {/* Sidebar Search */}
                    <div className="px-4 py-2">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search..."
                                className="w-full bg-white/70 text-[11px] text-slate-800 pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 outline-none focus:border-blue-500/50 transition font-semibold"
                            />
                            <svg className="w-3 h-3 text-slate-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        </div>
                    </div>

                    {/* Nav Links */}
                    <nav className="flex-1 overflow-y-auto px-2 space-y-4 py-2 max-h-[calc(100vh-170px)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {/* Category: MAIN NAVIGATION */}
                        <div className="space-y-1">
                            <p className="px-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Main Navigation</p>
                            <button
                                onClick={() => handleCourseTabNavigate('/admin')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all relative group ${
                                    activeTab === 'dashboard'
                                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-500/10'
                                        : 'text-slate-650 hover:bg-white/40 hover:text-slate-900'
                                }`}
                            >
                                <Home className="w-4 h-4" />
                                <span>Dashboard</span>
                                <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${activeTab === 'dashboard' ? 'text-slate-200 rotate-90' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            </button>
                        </div>

                        {/* Category: ACADEMIC DATA */}
                        <div className="space-y-1">
                            <p className="px-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Academic Data</p>
                            <button
                                onClick={() => handleCourseTabNavigate('/admin/departments')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all relative group ${
                                    activeTab === 'departments'
                                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-500/10'
                                        : 'text-slate-650 hover:bg-white/40 hover:text-slate-900'
                                }`}
                            >
                                <Building className="w-4 h-4" />
                                <span>Departments</span>
                                <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${activeTab === 'departments' ? 'text-slate-200 rotate-90' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            </button>
                            <button
                                onClick={() => handleCourseTabNavigate('/admin/courses/manager')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all relative group ${
                                    activeTab === 'courses'
                                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-500/10'
                                        : 'text-slate-650 hover:bg-white/40 hover:text-slate-900'
                                }`}
                            >
                                <BookOpen className="w-4 h-4" />
                                <span>Course Catalog</span>
                                <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${activeTab === 'courses' ? 'text-slate-200 rotate-90' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            </button>
                            <button
                                onClick={() => handleCourseTabNavigate('/admin/questions')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all relative group ${
                                    activeTab === 'questions'
                                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-500/10'
                                        : 'text-slate-650 hover:bg-white/40 hover:text-slate-900'
                                }`}
                            >
                                <HelpCircle className="w-4 h-4" />
                                <span>Past Questions</span>
                                <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${activeTab === 'questions' ? 'text-slate-200 rotate-90' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            </button>
                        </div>

                        {/* Category: USER MANAGEMENT */}
                        <div className="space-y-1">
                            <p className="px-4 text-[9px] font-black uppercase tracking-widest text-slate-400">User Management</p>
                            <button
                                onClick={() => handleCourseTabNavigate('/admin/users')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all relative group ${
                                    activeTab === 'users'
                                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-500/10'
                                        : 'text-slate-650 hover:bg-white/40 hover:text-slate-900'
                                }`}
                            >
                                <Users className="w-4 h-4" />
                                <span>User Control</span>
                                <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${activeTab === 'users' ? 'text-slate-200 rotate-90' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            </button>
                        </div>

                        {/* Category: FINANCIALS & TRAFFIC */}
                        <div className="space-y-1">
                            <p className="px-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Financials & Traffic</p>
                            <button
                                onClick={() => handleCourseTabNavigate('/admin/payments')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all relative group ${
                                    activeTab === 'payments'
                                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-500/10'
                                        : 'text-slate-650 hover:bg-white/40 hover:text-slate-900'
                                }`}
                            >
                                <CreditCard className="w-4 h-4" />
                                <span>Payments Control</span>
                                <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${activeTab === 'payments' ? 'text-slate-200 rotate-90' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            </button>
                            <button
                                onClick={() => handleCourseTabNavigate('/admin/analytics')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all relative group ${
                                    activeTab === 'analytics'
                                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-500/10'
                                        : 'text-slate-650 hover:bg-white/40 hover:text-slate-900'
                                }`}
                            >
                                <Activity className="w-4 h-4" />
                                <span>Usage Analytics</span>
                                <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${activeTab === 'analytics' ? 'text-slate-200 rotate-90' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            </button>
                        </div>

                        {/* Category: SYSTEM CONFIG */}
                        <div className="space-y-1">
                            <p className="px-4 text-[9px] font-black uppercase tracking-widest text-slate-400">System Configuration</p>
                            <button
                                onClick={() => handleCourseTabNavigate('/admin/app')}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-bold transition-all relative group ${
                                    activeTab === 'app'
                                        ? 'bg-blue-600 text-white font-black shadow-md shadow-blue-500/10'
                                        : 'text-slate-650 hover:bg-white/40 hover:text-slate-900'
                                }`}
                            >
                                <SettingsIcon className="w-4 h-4" />
                                <span>App Settings</span>
                                <ChevronRight className={`w-3.5 h-3.5 ml-auto transition-transform ${activeTab === 'app' ? 'text-slate-200 rotate-90' : 'text-slate-400 group-hover:text-slate-600'}`} />
                            </button>
                        </div>
                    </nav>
                </div>


            </aside>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-y-auto bg-[#f4f6f9]">
                {/* Top Header Bar */}
                <header className="h-14 bg-white/60 backdrop-blur-lg border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm flex-shrink-0 text-slate-650">
                    <div className="flex items-center gap-4">
                        <button className="text-slate-500 hover:text-blue-600 transition">
                            <MenuIcon className="w-5 h-5" />
                        </button>

                        <button
                            className="text-[10px] uppercase font-black hover:text-blue-600 transition tracking-widest text-slate-500"
                        >
                            Documentation
                        </button>
                    </div>

                    <div className="flex items-center gap-4 relative">
                        <button className="text-slate-500 hover:text-blue-600 transition">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        </button>
                        
                        <button className="text-slate-500 hover:text-blue-600 transition relative">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center text-[7px] font-black border border-white">3</span>
                        </button>

                        <button className="text-slate-500 hover:text-blue-600 transition relative">
                            <Bell className="w-4 h-4" />
                            <span className="absolute -top-1.5 -right-1.5 bg-yellow-500 text-slate-950 rounded-full w-3.5 h-3.5 flex items-center justify-center text-[7px] font-black border border-white">15</span>
                        </button>

                        <button className="text-slate-500 hover:text-blue-600 transition">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4h4m12 4V4h-4M4 16v4h4m12-4v4h-4"></path></svg>
                        </button>

                        <button className="text-slate-500 hover:text-blue-600 transition">
                            <Moon className="w-4 h-4" />
                        </button>

                        <button 
                            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                            className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-100 transition outline-none"
                        >
                            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold overflow-hidden border border-white">
                                {userProfile.photo_url ? (
                                    <img src={userProfile.photo_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    (userProfile.display_name || 'A').charAt(0).toUpperCase()
                                )}
                            </div>
                            <span className="text-xs font-bold text-slate-700 hidden md:inline">{userProfile.display_name || 'Alexander Pierce'}</span>
                        </button>
                        
                        {isProfileMenuOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setIsProfileMenuOpen(false)}></div>
                                <div className="absolute right-0 top-full mt-2 w-60 bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl rounded-xl p-2 z-50 flex flex-col gap-1 text-slate-700">
                                    <div className="px-3 py-2 border-b border-slate-100">
                                        <p className="text-[9px] text-slate-400 uppercase tracking-widest font-black leading-none">System Account</p>
                                        <p className="text-xs font-bold text-slate-650 truncate mt-1">{userProfile.email}</p>
                                    </div>

                                    <button
                                        onClick={() => {
                                            setIsProfileMenuOpen(false);
                                            handleCourseTabNavigate('/admin/app');
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold text-slate-650 hover:bg-slate-100 hover:text-blue-600 transition"
                                    >
                                        <SettingsIcon className="w-3.5 h-3.5 text-slate-450" />
                                        <span>System Configuration</span>
                                    </button>


                                </div>
                            </>
                        )}
                    </div>
                </header>

                {/* Mobile Navigation bar */}
                <div className="flex md:hidden bg-white/60 backdrop-blur-lg text-slate-500 px-4 py-2 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-slate-200 sticky top-14 z-20">
                    {activeNavItems.map((item) => {
                        const isActive = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => handleCourseTabNavigate(item.path)}
                                className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider whitespace-nowrap transition ${
                                    isActive ? 'bg-blue-600 text-white shadow-sm font-black' : 'hover:bg-white/40 text-slate-600'
                                }`}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                {/* Workspace Views */}
                <main className="p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6 flex-1 bg-[#f4f6f9] text-slate-800">
                    {/* Content Header Title and Breadcrumbs */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-gray-200 gap-3">
                        <div>
                            <h1 className="text-2xl font-black text-slate-800 tracking-wide capitalize">
                                {activeTab === 'app' ? 'App Settings' : activeTab === 'questions' ? 'Past Questions' : activeTab === 'courses' ? 'Course Catalog' : activeTab === 'users' ? 'User Control' : activeTab === 'payments' ? 'Payments Control' : activeTab === 'analytics' ? 'Usage Analytics' : activeTab}
                            </h1>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                            <span className="hover:text-slate-800 cursor-pointer transition" onClick={() => handleCourseTabNavigate('/admin')}>Home</span>
                            <span>/</span>
                            <span className="text-slate-700 capitalize font-black">{activeTab}</span>
                        </div>
                    </div>

                    {activeTab === 'dashboard' && (
                        <div className="space-y-6">
                            {/* Info Boxes */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="bg-[#007bff] text-white rounded-xl overflow-hidden shadow-lg border border-blue-600 relative group select-none flex flex-col justify-between">
                                    <div className="p-6">
                                        <h3 className="text-3xl font-black">{paymentLogs.length}</h3>
                                        <p className="text-xs uppercase font-black tracking-widest text-blue-100/90 mt-1">Total Payments</p>
                                    </div>
                                    <div className="absolute right-4 top-4 text-white/10 group-hover:scale-110 transition duration-300">
                                        <CreditCard className="w-16 h-16" />
                                    </div>
                                    <button 
                                        onClick={() => handleCourseTabNavigate('/admin/payments')}
                                        className="w-full bg-black/15 hover:bg-black/25 text-white/90 hover:text-white py-2 text-[10px] uppercase font-black tracking-widest flex items-center justify-center gap-1 transition border-t border-blue-500"
                                    >
                                        <span>More info</span>
                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                <div className="bg-[#198754] text-white rounded-xl overflow-hidden shadow-lg border border-green-600 relative group select-none flex flex-col justify-between">
                                    <div className="p-6">
                                        <h3 className="text-3xl font-black">{aiRequestLogs.length}</h3>
                                        <p className="text-xs uppercase font-black tracking-widest text-green-100/90 mt-1">AI Inference Queries</p>
                                    </div>
                                    <div className="absolute right-4 top-4 text-white/10 group-hover:scale-110 transition duration-300">
                                        <Sparkles className="w-16 h-16" />
                                    </div>
                                    <button 
                                        onClick={() => handleCourseTabNavigate('/admin/analytics')}
                                        className="w-full bg-black/15 hover:bg-black/25 text-white/90 hover:text-white py-2 text-[10px] uppercase font-black tracking-widest flex items-center justify-center gap-1 transition border-t border-green-500"
                                    >
                                        <span>More info</span>
                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                <div className="bg-[#ffc107] text-[#1f2d3d] rounded-xl overflow-hidden shadow-lg border border-yellow-500 relative group select-none flex flex-col justify-between">
                                    <div className="p-6">
                                        <h3 className="text-3xl font-black">{allUsersList.length}</h3>
                                        <p className="text-xs uppercase font-black tracking-widest text-[#1f2d3d]/80 mt-1">User Registrations</p>
                                    </div>
                                    <div className="absolute right-4 top-4 text-black/5 group-hover:scale-110 transition duration-300">
                                        <Users className="w-16 h-16" />
                                    </div>
                                    <button 
                                        onClick={() => handleCourseTabNavigate('/admin/users')}
                                        className="w-full bg-black/5 hover:bg-black/10 text-[#1f2d3d]/90 hover:text-black py-2 text-[10px] uppercase font-black tracking-widest flex items-center justify-center gap-1 transition border-t border-yellow-400"
                                    >
                                        <span>More info</span>
                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                <div className="bg-[#dc3545] text-white rounded-xl overflow-hidden shadow-lg border border-red-600 relative group select-none flex flex-col justify-between">
                                    <div className="p-6">
                                        <h3 className="text-3xl font-black">
                                            {allUsersList.filter(u => u.subscription_status === 'premium').length}
                                        </h3>
                                        <p className="text-xs uppercase font-black tracking-widest text-red-100/90 mt-1">Premium Students</p>
                                    </div>
                                    <div className="absolute right-4 top-4 text-white/10 group-hover:scale-110 transition duration-300">
                                        <Shield className="w-16 h-16" />
                                    </div>
                                    <button 
                                        onClick={() => handleCourseTabNavigate('/admin/users')}
                                        className="w-full bg-black/15 hover:bg-black/25 text-white/90 hover:text-white py-2 text-[10px] uppercase font-black tracking-widest flex items-center justify-center gap-1 transition border-t border-red-500"
                                    >
                                        <span>More info</span>
                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>

                            {/* Charts Row */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Line Chart */}
                                <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
                                    <div className="flex justify-between items-center border-b border-gray-200 pb-3">
                                        <h4 className="font-bold text-xs uppercase tracking-widest text-slate-500">AI Request Traffic Value</h4>
                                        <span className="text-[10px] text-lime-700 font-bold bg-lime-100 px-2.5 py-0.5 rounded-full">Last 7 Hours</span>
                                    </div>
                                    
                                    <div className="w-full h-48 relative">
                                        {(() => {
                                            const hours = Array.from({ length: 7 }, (_, i) => {
                                                const d = new Date();
                                                d.setHours(d.getHours() - i);
                                                return d;
                                            }).reverse();

                                            const history = hours.map(h => {
                                                const start = new Date(h).setMinutes(0, 0, 0);
                                                const end = new Date(h).setMinutes(59, 59, 999);
                                                const count = aiRequestLogs.filter(log => log.timestamp >= start && log.timestamp <= end).length;
                                                return {
                                                    label: h.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                                    count
                                                };
                                            });

                                            const maxVal = Math.max(...history.map(d => d.count), 5);
                                            const points = history.map((d, idx) => {
                                                const x = 30 + idx * 70;
                                                const y = 140 - (d.count / maxVal) * 100;
                                                return { x, y };
                                            });

                                            return (
                                                <svg className="w-full h-full" viewBox="0 0 500 170">
                                                    {/* Grid Lines */}
                                                    <line x1="30" y1="40" x2="470" y2="40" stroke="#f1f3f5" strokeWidth="1" strokeDasharray="3,3" />
                                                    <line x1="30" y1="90" x2="470" y2="90" stroke="#f1f3f5" strokeWidth="1" strokeDasharray="3,3" />
                                                    <line x1="30" y1="140" x2="470" y2="140" stroke="#e9ecef" strokeWidth="1" />
                                                    
                                                    {/* SVG Path */}
                                                    {points.length > 0 && (
                                                        <>
                                                            <path
                                                                d={`M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`}
                                                                fill="none"
                                                                stroke="#198754"
                                                                strokeWidth="3.5"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                            />
                                                            <path
                                                                d={`M 30,140 L ${points.map(p => `${p.x},${p.y}`).join(' L ')} L 450,140 Z`}
                                                                fill="url(#chartGrad)"
                                                                opacity="0.15"
                                                            />
                                                        </>
                                                    )}
                                                    
                                                    {/* Data Dots */}
                                                    {points.map((p, idx) => (
                                                        <g key={idx}>
                                                            <circle cx={p.x} cy={p.y} r="4.5" fill="#198754" stroke="#ffffff" strokeWidth="1.5" />
                                                            <text x={p.x} y={p.y - 8} textAnchor="middle" fill="#198754" className="text-[9px] font-black">{history[idx].count}</text>
                                                        </g>
                                                    ))}

                                                    {/* X Axis Labels */}
                                                    {points.map((p, idx) => (
                                                        <text key={idx} x={p.x} y="158" textAnchor="middle" fill="#525c6c" className="text-[8px] font-bold">{history[idx].label}</text>
                                                    ))}

                                                    <defs>
                                                        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="0%" stopColor="#198754" />
                                                            <stop offset="100%" stopColor="#198754" stopOpacity="0" />
                                                        </linearGradient>
                                                    </defs>
                                                </svg>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* World Map representation */}
                                <div className="bg-[#007bff] text-white rounded-xl p-5 shadow-lg border border-blue-600 flex flex-col justify-between h-full relative overflow-hidden group select-none min-h-[240px]">
                                    <div className="flex justify-between items-center border-b border-white/20 pb-3">
                                        <h4 className="font-black text-xs uppercase tracking-widest text-blue-100">User Distribution Map</h4>
                                        <div className="flex items-center gap-1 bg-black/10 px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider">
                                            <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse"></span>
                                            <span>Live Load</span>
                                        </div>
                                    </div>
                                    
                                    <div className="flex-1 flex items-center justify-center p-4 relative opacity-90 hover:opacity-100 transition duration-300">
                                        <svg className="w-full max-w-[280px] h-auto opacity-75" viewBox="0 0 100 50" fill="currentColor">
                                            <path d="M5,10 h5 v2 h-5 z M20,8 h8 v4 h-8 z M15,22 h10 v6 h-10 z M45,15 h6 v6 h-6 z M60,10 h15 v8 h-15 z M75,25 h8 v4 h-8 z M40,30 h8 v3 h-8 z M25,35 h6 v2 h-6 z M70,5 h4 v2 h-4 z M50,40 h5 v2 h-5 z" fill="rgba(255,255,255,0.45)" />
                                            <circle cx="24" cy="15" r="1.5" fill="#a3e635" className="animate-ping" />
                                            <circle cx="24" cy="15" r="1" fill="#a3e635" />
                                            <circle cx="68" cy="14" r="1.5" fill="#a3e635" className="animate-ping" />
                                            <circle cx="68" cy="14" r="1" fill="#a3e635" />
                                            <circle cx="48" cy="22" r="1.5" fill="#a3e635" className="animate-ping" />
                                            <circle cx="48" cy="22" r="1" fill="#a3e635" />
                                        </svg>

                                        <div className="absolute left-2 bottom-2 bg-black/25 rounded border border-white/10 flex flex-col font-mono text-[9px] font-black">
                                            <button className="px-1.5 py-0.5 border-b border-white/10 hover:bg-black/10">+</button>
                                            <button className="px-1.5 py-0.5 hover:bg-black/10">-</button>
                                        </div>
                                    </div>

                                    <div className="text-[10px] font-black text-blue-100 uppercase tracking-widest text-center pt-2 select-none">
                                        Vantutor Active Hubs (Global)
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'app' && (
                        <div className="space-y-6 max-w-3xl">
                            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-5">
                                <div>
                                    <h3 className="text-xl font-black text-gray-900">App Controls</h3>
                                    <p className="text-sm text-gray-500">Pause uploads, switch on coming soon mode, and configure Gemini model + API key from Firebase.</p>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 cursor-pointer hover:bg-gray-100/50 transition">
                                        <input
                                            type="checkbox"
                                            checked={appSettingsDraft.coming_soon_enabled}
                                            onChange={e => setAppSettingsDraft(prev => ({ ...prev, coming_soon_enabled: e.target.checked }))}
                                            className="mt-1 h-4 w-4 rounded border-gray-300 text-lime-600 focus:ring-lime-500"
                                        />
                                        <span>
                                            <span className="block font-bold text-gray-900">Coming soon mode</span>
                                            <span className="mt-1 block text-sm text-gray-500">Shows a polished coming soon screen to public users.</span>
                                        </span>
                                    </label>

                                    <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 cursor-pointer hover:bg-gray-100/50 transition">
                                        <input
                                            type="checkbox"
                                            checked={appSettingsDraft.upload_center_uploads_enabled}
                                            onChange={e => setAppSettingsDraft(prev => ({ ...prev, upload_center_uploads_enabled: e.target.checked }))}
                                            className="mt-1 h-4 w-4 rounded border-gray-300 text-lime-600 focus:ring-lime-500"
                                        />
                                        <span>
                                            <span className="block font-bold text-gray-900">Upload center uploads</span>
                                            <span className="mt-1 block text-sm text-gray-500">Turn textbook uploading on or off for upload center users.</span>
                                        </span>
                                    </label>
                                </div>

                                <label className="block">
                                    <span className="mb-2 block text-sm font-semibold text-gray-700">Primary Gemini model</span>
                                    <input
                                        type="text"
                                        value={appSettingsDraft.primary_gemini_model}
                                        onChange={e => setAppSettingsDraft(prev => ({ ...prev, primary_gemini_model: e.target.value }))}
                                        placeholder="gemini-2.5-flash-lite"
                                        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none focus:border-lime-500 focus:ring-4 focus:ring-lime-100"
                                    />
                                    <p className="mt-2 text-xs text-gray-500">Paste any Gemini model string here, then save to apply it across AI features.</p>
                                </label>

                                <label className="block">
                                    <span className="mb-2 block text-sm font-semibold text-gray-700">Gemini API key</span>
                                    <input
                                        type="password"
                                        value={appSettingsDraft.gemini_api_key}
                                        onChange={e => setAppSettingsDraft(prev => ({ ...prev, gemini_api_key: e.target.value }))}
                                        placeholder="AIza..."
                                        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none focus:border-lime-500 focus:ring-4 focus:ring-lime-100"
                                        autoComplete="off"
                                    />
                                    <p className="mt-2 text-xs text-gray-500">This key is saved in Firebase app settings and used across all Gemini-powered features.</p>
                                </label>

                                <hr className="border-gray-100 my-4" />

                                <div>
                                    <h4 className="text-base font-black text-gray-900">Paystack Subscriptions Config</h4>
                                    <p className="text-xs text-gray-500">Configure keys for premium subscriptions (₦5,000/semester).</p>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <label className="block">
                                        <span className="mb-2 block text-sm font-semibold text-gray-700">Paystack Public Key</span>
                                        <input
                                            type="text"
                                            value={appSettingsDraft.paystack_public_key || ''}
                                            onChange={e => setAppSettingsDraft(prev => ({ ...prev, paystack_public_key: e.target.value }))}
                                            placeholder="pk_test_..."
                                            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none focus:border-lime-500 focus:ring-4 focus:ring-lime-100"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="mb-2 block text-sm font-semibold text-gray-700">Paystack Secret Key</span>
                                        <input
                                            type="password"
                                            value={appSettingsDraft.paystack_secret_key || ''}
                                            onChange={e => setAppSettingsDraft(prev => ({ ...prev, paystack_secret_key: e.target.value }))}
                                            placeholder="sk_test_..."
                                            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none focus:border-lime-500 focus:ring-4 focus:ring-lime-100"
                                            autoComplete="off"
                                        />
                                    </label>
                                </div>

                                <hr className="border-gray-100 my-4" />

                                <div>
                                    <h4 className="text-base font-black text-gray-900">Personal API Key Usage Limits</h4>
                                    <p className="text-xs text-gray-500">Set query rate and token usage limits for custom API key users.</p>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <label className="block">
                                        <span className="mb-2 block text-sm font-semibold text-gray-700">Max RPM (Requests Per Minute)</span>
                                        <input
                                            type="number"
                                            value={appSettingsDraft.custom_user_limit_rpm ?? 10}
                                            onChange={e => setAppSettingsDraft(prev => ({ ...prev, custom_user_limit_rpm: Number(e.target.value) }))}
                                            placeholder="10"
                                            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none focus:border-lime-500 focus:ring-4 focus:ring-lime-100"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="mb-2 block text-sm font-semibold text-gray-700">Max TPM (Tokens Per Minute)</span>
                                        <input
                                            type="number"
                                            value={appSettingsDraft.custom_user_limit_tpm ?? 250000}
                                            onChange={e => setAppSettingsDraft(prev => ({ ...prev, custom_user_limit_tpm: Number(e.target.value) }))}
                                            placeholder="250000"
                                            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 outline-none focus:border-lime-500 focus:ring-4 focus:ring-lime-100"
                                        />
                                    </label>
                                </div>

                                <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
                                    <button
                                        type="button"
                                        onClick={handleSaveAppSettings}
                                        disabled={isSavingAppSettings}
                                        className="rounded-xl bg-lime-600 px-5 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-lime-700 disabled:cursor-not-allowed disabled:opacity-60 transition shadow-lg shadow-lime-600/10"
                                    >
                                        {isSavingAppSettings ? 'Saving...' : 'Save App Settings'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleTestGeminiSettings}
                                        disabled={isTestingAppSettings}
                                        className="rounded-xl border border-lime-200 bg-lime-50 px-5 py-3 text-sm font-black uppercase tracking-widest text-lime-700 hover:bg-lime-100 disabled:cursor-not-allowed disabled:opacity-60 transition"
                                    >
                                        {isTestingAppSettings ? 'Testing...' : 'Test Hello'}
                                    </button>
                                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                                        Current model: <span className="font-bold text-gray-900">{appSettings.primary_gemini_model}</span>
                                    </div>
                                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                                        API key: <span className="font-bold text-gray-900">{appSettings.gemini_api_key ? 'Configured' : 'Not configured'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'departments' && (
                        <div className="space-y-6 max-w-2xl">
                            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                                <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                                    <Plus className="w-5 h-5 text-lime-600" />
                                    <span>Add New Department</span>
                                </h3>
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <input 
                                        type="text" 
                                        placeholder="Department Name (e.g., Computer Science)" 
                                        value={newDeptName} 
                                        onChange={e => setNewDeptName(e.target.value)}
                                        className="flex-1 p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500 transition"
                                    />
                                    <button 
                                        onClick={handleAddDepartment}
                                        className="w-full sm:w-auto px-6 py-3 bg-lime-600 text-white rounded-xl font-bold hover:bg-lime-700 transition"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                                <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                                    <Building className="w-5 h-5 text-slate-500" />
                                    <span>Existing Departments</span>
                                </h3>
                                <div className="space-y-2">
                                    {allDepartments.map(dept => (
                                        <div key={dept.id} className="p-4 border border-gray-150 rounded-xl bg-gray-50/50 flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center hover:bg-gray-50 transition">
                                            <span className="font-bold text-gray-900">{dept.department_name}</span>
                                            <span className="text-xs bg-slate-200/80 text-slate-700 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider">{dept.levels?.join(', ')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'questions' && (
                        <div className="space-y-8 max-w-2xl">
                            {/* Automated Upload Section */}
                            <div className="bg-lime-50 p-6 rounded-2xl border border-lime-200 shadow-sm">
                                <h3 className="font-bold text-lime-800 mb-2 flex items-center gap-2">
                                    <Sparkles className="w-5 h-5 text-lime-600" />
                                    <span>Automated PDF Extraction</span>
                                </h3>
                                <p className="text-sm text-lime-700 mb-4">
                                    Upload a PDF of past questions to automatically populate the question bank using AI.
                                </p>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                    <select 
                                        value={uploadDepartmentId} 
                                        onChange={e => setUploadDepartmentId(e.target.value)}
                                        className="p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                    >
                                        <option value="">Select Department</option>
                                        {allDepartments.map(dept => (
                                            <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                                        ))}
                                    </select>
                                    <select 
                                        value={uploadLevel} 
                                        onChange={e => setUploadLevel(e.target.value)}
                                        className="p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                    >
                                        <option value="">Select Level</option>
                                        {LEVELS.map(lvl => (
                                            <option key={lvl} value={lvl}>{lvl}</option>
                                        ))}
                                    </select>
                                    <input 
                                        type="text" placeholder="Course Name (e.g., Mathematics)" 
                                        value={uploadCourseName} onChange={e => setUploadCourseName(e.target.value)}
                                        className="p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                    />
                                    <input 
                                        type="text" placeholder="Year (e.g., 2023)" 
                                        value={year} onChange={e => setYear(e.target.value)}
                                        className="p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                    />
                                </div>

                                <div className="flex flex-col gap-3">
                                    <input 
                                        type="file" 
                                        accept="application/pdf"
                                        onChange={e => setPqFile(e.target.files?.[0] || null)}
                                        className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-lime-100 file:text-lime-700 hover:file:bg-lime-200 cursor-pointer"
                                    />
                                    {isPQProcessing && (
                                        <div className="flex items-center gap-2 text-lime-700 text-sm font-medium animate-pulse">
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            <span>{extractionProgress}</span>
                                        </div>
                                    )}
                                    <button 
                                        onClick={handlePQUpload}
                                        disabled={isPQProcessing || !pqFile}
                                        className={`w-full py-3.5 rounded-xl font-bold uppercase tracking-widest text-xs transition shadow-md ${isPQProcessing || !pqFile ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-lime-600 text-white hover:bg-lime-700 shadow-lime-600/10'}`}
                                    >
                                        {isPQProcessing ? 'Processing Questions...' : 'Extract & Save from PDF'}
                                    </button>
                                </div>
                            </div>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                    <div className="w-full border-t border-gray-300"></div>
                                </div>
                                <div className="relative flex justify-center">
                                    <span className="px-4 bg-slate-50 text-xs text-gray-400 font-black uppercase tracking-widest">OR MANUAL ENTRY</span>
                                </div>
                            </div>

                            <div className="space-y-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <select 
                                        value={uploadDepartmentId} 
                                        onChange={e => setUploadDepartmentId(e.target.value)}
                                        className="p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                    >
                                        <option value="">Select Department</option>
                                        {allDepartments.map(dept => (
                                            <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                                        ))}
                                    </select>
                                    <select 
                                        value={uploadLevel} 
                                        onChange={e => setUploadLevel(e.target.value)}
                                        className="p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                    >
                                        <option value="">Select Level</option>
                                        {LEVELS.map(lvl => (
                                            <option key={lvl} value={lvl}>{lvl}</option>
                                        ))}
                                    </select>
                                    <input 
                                        type="text" placeholder="Course Name" 
                                        value={uploadCourseName} onChange={e => setUploadCourseName(e.target.value)}
                                        className="p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                    />
                                    <input 
                                        type="text" placeholder="Year" 
                                        value={year} onChange={e => setYear(e.target.value)}
                                        className="p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                    />
                                </div>
                                <textarea 
                                    placeholder="Question Content" 
                                    value={newQuestion.question} 
                                    onChange={e => setNewQuestion({...newQuestion, question: e.target.value})}
                                    className="w-full p-3 border border-gray-200 rounded-xl h-24 bg-gray-50 focus:bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500 transition resize-none"
                                />
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {newQuestion.options.map((opt, i) => (
                                        <input 
                                            key={i} type="text" placeholder={`Option ${String.fromCharCode(65+i)}`}
                                            value={opt} onChange={e => {
                                                const opts = [...newQuestion.options];
                                                opts[i] = e.target.value;
                                                setNewQuestion({...newQuestion, options: opts});
                                            }}
                                            className="p-3 border border-gray-200 rounded-xl outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                        />
                                    ))}
                                </div>
                                <input 
                                    type="text" placeholder="Correct Answer (Exact string match)" 
                                    value={newQuestion.correctAnswer} 
                                    onChange={e => setNewQuestion({...newQuestion, correctAnswer: e.target.value})}
                                    className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500"
                                />
                                <textarea 
                                    placeholder="Explanation (Optional)" 
                                    value={newQuestion.explanation} 
                                    onChange={e => setNewQuestion({...newQuestion, explanation: e.target.value})}
                                    className="w-full p-3 border border-gray-200 rounded-xl h-20 bg-gray-50 focus:bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500 transition resize-none"
                                />
                                <button 
                                    onClick={handleAddQuestion}
                                    className="w-full bg-slate-900 text-white py-3.5 rounded-xl font-bold hover:bg-black transition uppercase tracking-widest text-xs shadow-md"
                                >
                                    Save Question Manually
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'courses' && (
                        <div className="space-y-6">
                            {courseAdminView.mode === 'global' && (
                                <div className="space-y-6">
                                    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-5">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                            <div>
                                                <h3 className="text-xl font-black text-gray-900">All Courses</h3>
                                                <p className="text-sm text-gray-500">Search every course across departments.</p>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    onClick={() => handleCourseTabNavigate('/admin/courses/manager')}
                                                    className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black transition"
                                                >
                                                    Open Course Manager
                                                </button>
                                                <button
                                                    onClick={() => handleCourseTabNavigate('/admin/courses/add')}
                                                    className="px-4 py-2.5 rounded-xl bg-lime-600 text-white text-xs font-black uppercase tracking-widest hover:bg-lime-700 transition"
                                                >
                                                    Course Addition
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex flex-col md:flex-row gap-3">
                                            <input
                                                type="text"
                                                value={courseSearchQuery}
                                                onChange={e => setCourseSearchQuery(e.target.value)}
                                                placeholder="Search by course name, code, level, or department..."
                                                className="flex-1 p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500 transition"
                                            />
                                            <button
                                                onClick={handleMergeDuplicateCoursesAcrossDepartments}
                                                className="px-4 py-3 rounded-xl bg-lime-600 text-white text-xs font-black uppercase tracking-widest hover:bg-lime-700 transition"
                                            >
                                                Merge Same-Title Courses
                                            </button>
                                        </div>

                                        {filteredGlobalCourses.length ? (
                                            <div className="overflow-x-auto rounded-2xl border border-gray-150">
                                                <table className="w-full min-w-[720px] text-left">
                                                    <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-bold">
                                                        <tr>
                                                            <th className="px-6 py-4">Course</th>
                                                            <th className="px-6 py-4">Departments</th>
                                                            <th className="px-6 py-4">Level</th>
                                                            <th className="px-6 py-4">Semester</th>
                                                            <th className="px-6 py-4 text-right">Action</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-100 text-sm">
                                                        {filteredGlobalCourses.map(({ course, departmentIds }) => {
                                                            const departmentNames = departmentIds
                                                                .map(id => allDepartments.find(dept => dept.id === id)?.department_name || id)
                                                                .join(', ');
                                                            const firstDepartmentId = departmentIds[0] || '';
                                                            const hasMultipleDepartments = departmentIds.length > 1;
                                                            const courseRouteIdentifier = getCourseRouteKey(course);
                                                            return (
                                                                <tr key={courseRouteIdentifier} className="hover:bg-slate-50/50 transition">
                                                                    <td className="px-6 py-4">
                                                                        <div className="font-bold text-gray-900">{course.course_name}</div>
                                                                        <div className="text-xs text-gray-500">{course.course_code || course.course_id}</div>
                                                                    </td>
                                                                    <td className="px-6 py-4 text-gray-600">{departmentNames}</td>
                                                                    <td className="px-6 py-4 text-gray-600">{course.level}</td>
                                                                    <td className="px-6 py-4">
                                                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${course.semester === 'first' ? 'bg-blue-50 text-blue-700 border border-blue-150' : 'bg-orange-50 text-orange-700 border border-orange-150'}`}>
                                                                            {course.semester === 'first' ? '1st Sem' : '2nd Sem'}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-6 py-4 text-right">
                                                                        <button
                                                                            onClick={() => handleCourseTabNavigate(buildCourseManagerPath(firstDepartmentId, course.level, courseRouteIdentifier))}
                                                                            title={hasMultipleDepartments ? 'Opens the primary department view for this shared course' : 'Open this course'}
                                                                            className="text-xs font-black uppercase tracking-wider text-lime-600 hover:text-lime-700"
                                                                        >
                                                                            {hasMultipleDepartments ? 'Open Primary' : 'Open'}
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        ) : (
                                            <div className="p-10 border border-dashed border-gray-200 rounded-2xl text-center text-sm text-gray-500">
                                                No courses found yet.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {courseAdminView.mode === 'manager-root' && (
                                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-5 max-w-3xl">
                                    <div>
                                        <h3 className="text-xl font-black text-gray-900">Course Manager</h3>
                                        <p className="text-sm text-gray-500">Choose a department and level, then drill into a course.</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <select
                                            value={managerSelectionDepartmentId}
                                            onChange={e => setManagerSelectionDepartmentId(e.target.value)}
                                            className="p-3 border border-gray-200 rounded-xl bg-gray-50 outline-none focus:ring-4 focus:ring-lime-100"
                                        >
                                            <option value="">Select Department</option>
                                            {allDepartments.map(dept => (
                                                <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                                            ))}
                                        </select>
                                        <select
                                            value={managerSelectionLevel}
                                            onChange={e => setManagerSelectionLevel(e.target.value)}
                                            className="p-3 border border-gray-200 rounded-xl bg-gray-50 outline-none focus:ring-4 focus:ring-lime-100"
                                        >
                                            <option value="">Select Level</option>
                                            {LEVELS.map(level => (
                                                <option key={level} value={level}>{level}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <button
                                        disabled={!managerSelectionDepartmentId || !managerSelectionLevel}
                                        onClick={() => handleCourseTabNavigate(buildCourseManagerPath(managerSelectionDepartmentId, managerSelectionLevel))}
                                        className={`w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-xs transition shadow-md ${!managerSelectionDepartmentId || !managerSelectionLevel ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none' : 'bg-lime-600 text-white hover:bg-lime-700 shadow-lime-600/10'}`}
                                    >
                                        View Courses
                                    </button>
                                    <button
                                        onClick={() => handleCourseTabNavigate(buildCourseAddPath(managerSelectionDepartmentId || undefined, managerSelectionLevel || undefined))}
                                        className="w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-xs bg-slate-900 text-white hover:bg-black transition shadow-md"
                                    >
                                        Course Addition
                                    </button>
                                    <button
                                        onClick={handleMergeDuplicateCoursesAcrossDepartments}
                                        className="w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-xs bg-lime-600 text-white hover:bg-lime-700 transition shadow-md shadow-lime-600/10"
                                    >
                                        Merge Same-Title Courses
                                    </button>
                                </div>
                            )}

                            {courseAdminView.mode === 'add' && (
                                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6 max-w-4xl">
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
                                        <div>
                                            <h3 className="text-xl font-black text-gray-900">Course Addition</h3>
                                            <p className="text-sm text-gray-500">Upload course-form PDF(s), auto-extract courses with AI, then add to selected departments and level.</p>
                                        </div>
                                        <button
                                            onClick={() => handleCourseTabNavigate('/admin/courses/manager')}
                                            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black transition shadow-md"
                                        >
                                            Back to Manager
                                        </button>
                                    </div>

                                    <div className="space-y-4 rounded-2xl border border-gray-100 p-4 bg-gray-50">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-xs font-black uppercase tracking-widest text-gray-500">Department Scope</label>
                                                <select
                                                    value={courseImportTargetMode}
                                                    onChange={e => setCourseImportTargetMode(e.target.value as 'selected' | 'all')}
                                                    className="w-full p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-105"
                                                >
                                                    <option value="selected">Selected Department(s)</option>
                                                    <option value="all">All Departments</option>
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-black uppercase tracking-widest text-gray-500">Target Level</label>
                                                <select
                                                    value={courseImportLevelOverride}
                                                    onChange={e => setCourseImportLevelOverride(e.target.value)}
                                                    className="w-full p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-105"
                                                >
                                                    <option value="">Select Level</option>
                                                    {LEVELS.map(level => (
                                                        <option key={level} value={level}>{level}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        {courseImportTargetMode === 'selected' && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-black uppercase tracking-widest text-gray-500">Select Department(s)</p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                                    {allDepartments.map((dept) => (
                                                        <label key={dept.id} className="flex items-center gap-2 p-3 border border-gray-200 rounded-xl bg-white cursor-pointer hover:bg-slate-50 transition">
                                                            <input
                                                                type="checkbox"
                                                                checked={courseImportDepartmentIds.includes(dept.id)}
                                                                onChange={() => toggleCourseImportDepartment(dept.id)}
                                                                className="rounded border-gray-300 text-lime-600 focus:ring-lime-500"
                                                            />
                                                            <span className="text-sm font-medium text-gray-700">{dept.department_name}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            <label className="text-xs font-black uppercase tracking-widest text-gray-500">Academic Session (Optional)</label>
                                            <input
                                                type="text"
                                                value={courseImportSessionOverride}
                                                onChange={e => setCourseImportSessionOverride(e.target.value)}
                                                placeholder="e.g. 2025/2026"
                                                className="w-full p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-105"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs font-black uppercase tracking-widest text-gray-500">Course Form PDF(s)</label>
                                            <input
                                                type="file"
                                                multiple
                                                accept="application/pdf"
                                                onChange={e => setCourseRegistrationFiles(e.target.files ? Array.from(e.target.files) : [])}
                                                className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-lime-100 file:text-lime-700 hover:file:bg-lime-200 cursor-pointer"
                                            />
                                            <p className="text-xs text-gray-500 mt-1">
                                                Duplicate courses are merged automatically, and first/second semester values are preserved for semester badges.
                                            </p>
                                        </div>
                                    </div>

                                    <button
                                        onClick={handleCourseRegistrationImport}
                                        disabled={isCourseImportDisabled}
                                        className={`w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-xs transition shadow-md ${isCourseImportDisabled ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none' : 'bg-lime-600 text-white hover:bg-lime-700 shadow-lime-600/10'}`}
                                    >
                                        {isCourseImporting ? 'Importing Courses...' : 'Extract & Add Courses'}
                                    </button>
                                    {isCourseImporting && (
                                        <p className="text-sm font-semibold text-lime-600 mt-2 animate-pulse">{courseImportProgress || 'Importing course registration forms...'}</p>
                                    )}
                                </div>
                            )}

                            {courseAdminView.mode === 'manager-list' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between gap-3 flex-wrap border-b border-slate-200 pb-4">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Course Manager</p>
                                            <h3 className="text-2xl font-black text-gray-900 mt-1">
                                                {selectedManagerDepartment?.department_name || courseAdminView.departmentId} • {courseAdminView.level}
                                            </h3>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => {
                                                    setManagerSelectionDepartmentId('');
                                                    setManagerSelectionLevel('');
                                                    handleCourseTabNavigate('/admin/courses/manager');
                                                }}
                                                className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black transition shadow-md"
                                            >
                                                Change Department
                                            </button>
                                            <button
                                                onClick={() => handleCourseTabNavigate(buildCourseAddPath(courseAdminView.departmentId, courseAdminView.level))}
                                                className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black transition shadow-md"
                                            >
                                                Course Addition
                                            </button>
                                            <button
                                                onClick={handleMergeDuplicateCoursesAcrossDepartments}
                                                className="px-4 py-2.5 rounded-xl bg-lime-600 text-white text-xs font-black uppercase tracking-widest hover:bg-lime-700 transition shadow-md shadow-lime-600/10"
                                            >
                                                Merge Same-Title Courses
                                            </button>
                                        </div>
                                    </div>
                                    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                                        {managerCoursesForLevel.length ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {managerCoursesForLevel.map((course) => {
                                                    const courseRouteIdentifier = getCourseRouteKey(course);
                                                    return (
                                                        <div
                                                            key={courseRouteIdentifier}
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={() => handleCourseTabNavigate(buildCourseManagerPath(courseAdminView.departmentId, courseAdminView.level, courseRouteIdentifier))}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' || e.key === ' ') {
                                                                    e.preventDefault();
                                                                    handleCourseTabNavigate(buildCourseManagerPath(courseAdminView.departmentId, courseAdminView.level, courseRouteIdentifier));
                                                                }
                                                            }}
                                                            className="group flex items-center justify-between gap-3 p-5 rounded-2xl border border-slate-100 bg-slate-50 text-left hover:border-lime-200 hover:bg-lime-50/50 transition duration-200 cursor-pointer shadow-sm hover:shadow-md"
                                                        >
                                                            <div>
                                                                <div className="font-bold text-gray-900 leading-tight group-hover:text-lime-700 transition">{course.course_name}</div>
                                                                <div className="text-xs text-gray-500 mt-1 font-semibold">{course.course_code || course.course_id}</div>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase border ${course.semester === 'first' ? 'bg-blue-50 text-blue-700 border-blue-155' : 'bg-orange-50 text-orange-700 border-orange-155'}`}>
                                                                    {course.semester === 'first' ? '1st Sem' : '2nd Sem'}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        void handleDeleteCourseFromDepartment(course);
                                                                    }}
                                                                    className="rounded-xl p-2.5 text-gray-400 opacity-100 transition hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                                                                    aria-label={`Delete ${course.course_name}`}
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="p-12 text-center text-gray-500 font-medium border border-dashed border-gray-200 rounded-xl">
                                                No courses found for this department and level.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {courseAdminView.mode === 'manager-detail' && (
                                <div className="space-y-6">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            onClick={() => handleCourseTabNavigate(buildCourseManagerPath(courseAdminView.departmentId, courseAdminView.level))}
                                            className="text-xs uppercase tracking-widest font-black text-slate-400 hover:text-slate-900 transition"
                                        >
                                            ← Back to Course List
                                        </button>
                                        <button
                                            onClick={() => handleCourseTabNavigate(buildCourseAddPath(courseAdminView.departmentId, courseAdminView.level))}
                                            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black transition shadow-md"
                                        >
                                            Course Addition
                                        </button>
                                    </div>
                                    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6 max-w-4xl">
                                        {selectedManagerCourse ? (
                                            <>
                                                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-5">
                                                    <div>
                                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                                            {selectedManagerDepartment?.department_name || courseAdminView.departmentId} • {courseAdminView.level}
                                                        </p>
                                                        <h3 className="text-2xl font-black text-gray-900 mt-1">{selectedManagerCourse.course_name}</h3>
                                                        <p className="text-sm font-semibold text-slate-400 mt-1">{selectedManagerCourse.course_code || selectedManagerCourse.course_id}</p>
                                                    </div>
                                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase border ${selectedManagerCourse.semester === 'first' ? 'bg-blue-50 text-blue-700 border-blue-150' : 'bg-orange-50 text-orange-700 border-orange-150'}`}>
                                                        {selectedManagerCourse.semester === 'first' ? '1st Sem' : '2nd Sem'}
                                                    </span>
                                                </div>

                                                <div className="space-y-3">
                                                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Upload Textbook PDFs</p>
                                                    <input
                                                        type="file"
                                                        multiple
                                                        accept="application/pdf"
                                                        onChange={e => setCourseDetailFiles(e.target.files ? Array.from(e.target.files) : [])}
                                                        className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-lime-100 file:text-lime-700 hover:file:bg-lime-200 cursor-pointer"
                                                    />
                                                    <p className="text-xs text-gray-500">You can select and upload multiple PDF textbooks at once.</p>
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <input
                                                            id="auto-sync-textbooks"
                                                            type="checkbox"
                                                            checked={autoSyncToOfferingDepartments}
                                                            onChange={e => setAutoSyncToOfferingDepartments(e.target.checked)}
                                                            className="h-4 w-4 rounded border-gray-300 text-lime-600 focus:ring-lime-500"
                                                        />
                                                        <label htmlFor="auto-sync-textbooks" className="text-sm text-slate-600 font-medium">Auto-sync to departments offering this course</label>
                                                    </div>
                                                    <button
                                                        disabled={!courseDetailFiles.length || isUploading}
                                                        onClick={async () => {
                                                            if (!selectedManagerCourse) return;
                                                            await handleTextbookUpload(selectedManagerCourse.course_id || selectedManagerCourse.course_name, courseDetailFiles);
                                                            setCourseDetailFiles([]);
                                                        }}
                                                        className={`w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-xs transition shadow-md ${!courseDetailFiles.length || isUploading ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none' : 'bg-lime-600 text-white hover:bg-lime-700 shadow-lime-600/10'}`}
                                                    >
                                                        {isUploading ? 'Uploading...' : 'Upload Textbooks'}
                                                    </button>
                                                    {isUploading && (
                                                        <p className="text-sm font-semibold text-lime-650 mt-2 animate-pulse">{extractionProgress || 'Uploading textbooks...'}</p>
                                                    )}
                                                </div>

                                                {selectedManagerCourse.textbook_urls?.length ? (
                                                    <div className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                                        <p className="text-xs font-black uppercase tracking-widest text-slate-450">Uploaded Textbooks</p>
                                                        <div className="space-y-2">
                                                            {selectedManagerCourse.textbook_urls.map((url) => (
                                                                <a key={url} href={url} target="_blank" rel="noreferrer" className="block text-xs font-bold text-lime-700 hover:underline truncate">
                                                                    {url}
                                                                </a>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : null}

                                                <div className="space-y-3">
                                                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">Course Outline</p>
                                                    {isSelectedManagerCourseTopicsLoading ? (
                                                        <div className="p-8 rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-400 animate-pulse font-medium">
                                                            Loading course outline from uploaded textbooks...
                                                        </div>
                                                    ) : selectedManagerCourseTopics.length ? (
                                                        <div className="space-y-3">
                                                            {selectedManagerCourseTopics.map((topic) => (
                                                                <div key={topic.topic_id} className="rounded-xl border border-slate-100 p-4 bg-slate-50/50 hover:bg-slate-50 transition">
                                                                    <div className="font-bold text-slate-800">{topic.topic_name}</div>
                                                                    {topic.topic_context ? <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed">{topic.topic_context}</p> : null}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="p-8 rounded-xl border border-dashed border-slate-200 text-center text-sm text-slate-400 font-medium">
                                                            No course outline yet. Upload textbooks to generate topics.
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex justify-end items-center pt-5 border-t border-slate-100">
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleDeleteCourseFromDepartment(selectedManagerCourse)}
                                                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-red-500 transition hover:bg-red-100 hover:text-red-700"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" /> Delete Course
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="p-8 text-center text-gray-500 font-medium">
                                                Course not found.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'users' && (
                        <div className="space-y-6">
                            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    <Bell className="w-5 h-5 text-lime-600" />
                                    <span>Broadcast Center</span>
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-black uppercase tracking-wider text-slate-400">Recipient Scope</label>
                                        <select
                                            value={recipientMode}
                                            onChange={(e) => setRecipientMode(e.target.value as 'all' | 'single')}
                                            className="w-full p-3 border border-gray-200 rounded-xl focus:ring-4 focus:ring-lime-100 focus:border-lime-500 outline-none transition"
                                        >
                                            <option value="all">All Users</option>
                                            <option value="single">Single User</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <label className="text-xs font-black uppercase tracking-wider text-slate-400">Target User</label>
                                        <select
                                            value={selectedRecipientId}
                                            onChange={(e) => setSelectedRecipientId(e.target.value)}
                                            disabled={recipientMode === 'all'}
                                            className="w-full p-3 border border-gray-200 rounded-xl focus:ring-4 focus:ring-lime-100 focus:border-lime-500 outline-none disabled:bg-slate-100 disabled:text-slate-400 transition"
                                        >
                                            <option value="">Select a user</option>
                                            {allUsersList.map(user => (
                                                <option key={user.uid} value={user.uid}>
                                                    {user.display_name} ({user.email || 'no-email'})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                                    <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 space-y-4 shadow-sm">
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                            <Send className="w-4 h-4 text-slate-500" />
                                            <span>Send Push Notification</span>
                                        </h4>
                                        <input
                                            type="text"
                                            value={announcementTitle}
                                            onChange={(e) => setAnnouncementTitle(e.target.value)}
                                            placeholder="Notification title"
                                            className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-4 focus:ring-lime-100 focus:border-lime-500 outline-none transition"
                                        />
                                        <textarea
                                            value={announcementMessage}
                                            onChange={(e) => setAnnouncementMessage(e.target.value)}
                                            placeholder="Notification message"
                                            rows={3}
                                            className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-4 focus:ring-lime-100 focus:border-lime-500 outline-none resize-none transition"
                                        />
                                        <select
                                            value={notificationType}
                                            onChange={(e) => setNotificationType(e.target.value as 'study_update' | 'exam_reminder' | 'welcome')}
                                            className="w-full p-3 border border-gray-200 rounded-xl bg-white outline-none focus:ring-4 focus:ring-lime-100 focus:border-lime-500 transition"
                                        >
                                            <option value="study_update">Study Update</option>
                                            <option value="exam_reminder">Exam Reminder</option>
                                            <option value="welcome">Welcome</option>
                                        </select>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={handleSuggestAnnouncement}
                                                disabled={isSendingPush}
                                                className="w-full bg-white border border-gray-200 text-slate-700 py-3 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-gray-50 transition disabled:opacity-60 shadow-sm outline-none"
                                            >
                                                Suggest Message
                                            </button>
                                            <button
                                                onClick={handleSendPushNotification}
                                                disabled={isSendingPush}
                                                className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-black transition disabled:opacity-60 shadow-md outline-none"
                                            >
                                                {isSendingPush ? 'Sending...' : 'Send Push'}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="border border-slate-100 rounded-2xl p-5 bg-slate-50/50 space-y-4 shadow-sm">
                                        <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                            <Mail className="w-4 h-4 text-slate-500" />
                                            <span>Send Email Broadcast</span>
                                        </h4>
                                        <input
                                            type="text"
                                            value={emailSubject}
                                            onChange={(e) => setEmailSubject(e.target.value)}
                                            placeholder="Email subject"
                                            className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-4 focus:ring-lime-100 focus:border-lime-500 outline-none transition"
                                        />
                                        <textarea
                                            value={emailBody}
                                            onChange={(e) => setEmailBody(e.target.value)}
                                            placeholder="Email body"
                                            rows={3}
                                            className="w-full p-3 border border-gray-200 rounded-xl bg-white focus:ring-4 focus:ring-lime-100 focus:border-lime-500 outline-none resize-none transition"
                                        />
                                        <button
                                            onClick={handleSendEmail}
                                            className="w-full bg-lime-600 text-white py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-lime-700 transition shadow-md shadow-lime-600/10"
                                        >
                                            Open Email Draft
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Responsive Metrics Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="bg-lime-50 p-6 rounded-2xl border border-lime-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
                                    <div className="w-12 h-12 rounded-xl bg-lime-100 flex items-center justify-center text-lime-600 border border-lime-250">
                                        <Users className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-lime-800 text-[10px] font-black uppercase tracking-widest leading-none">Registered</p>
                                        <h3 className="text-3xl font-black text-lime-950 mt-1">{allUsersList.length}</h3>
                                    </div>
                                </div>
                                <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
                                    <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-650 border border-indigo-250">
                                        <CreditCard className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-indigo-800 text-[10px] font-black uppercase tracking-widest leading-none">Premium</p>
                                        <h3 className="text-3xl font-black text-indigo-950 mt-1">
                                            {allUsersList.filter(u => u.subscription_status === 'premium').length}
                                        </h3>
                                    </div>
                                </div>
                                <div className="bg-teal-50 p-6 rounded-2xl border border-teal-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
                                    <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center text-teal-650 border border-teal-250">
                                        <Key className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-teal-800 text-[10px] font-black uppercase tracking-widest leading-none">Google Tokens</p>
                                        <h3 className="text-3xl font-black text-teal-950 mt-1">
                                            {allUsersList.filter(u => u.subscription_status === 'personal_token').length}
                                        </h3>
                                    </div>
                                </div>
                                <div className="bg-blue-50 p-6 rounded-2xl border border-blue-200 shadow-sm flex items-center gap-4 hover:shadow-md transition">
                                    <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-650 border border-blue-250">
                                        <Activity className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <p className="text-blue-800 text-[10px] font-black uppercase tracking-widest leading-none">Active Today</p>
                                        <h3 className="text-3xl font-black text-blue-950 mt-1">
                                            {allUsersList.filter(u => {
                                                const today = new Date().setHours(0,0,0,0);
                                                return (u.last_activity_date || 0) >= today;
                                            }).length}
                                        </h3>
                                    </div>
                                </div>
                            </div>

                            {/* Users Table */}
                            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                    <h3 className="font-bold text-slate-800 text-sm">Users List</h3>
                                    <button 
                                        onClick={() => { void fetchUsers(); void fetchUsageLogs(); }}
                                        className="text-xs uppercase tracking-widest font-black text-lime-650 hover:text-lime-700 flex items-center gap-1.5 transition"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" />
                                        <span>Refresh List</span>
                                    </button>
                                </div>
                                <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
                                    {isUsersLoading ? (
                                        <div className="p-12 text-center text-slate-400 font-medium">Loading users...</div>
                                    ) : (
                                        <table className="w-full min-w-[1050px] text-left border-collapse">
                                            <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase tracking-widest font-black border-b border-slate-100">
                                                <tr>
                                                    <th className="px-6 py-4">User</th>
                                                    <th className="px-6 py-4">Email</th>
                                                    <th className="px-6 py-4">Dept / Level</th>
                                                    <th className="px-6 py-4">Last Active</th>
                                                    <th className="px-6 py-4">Requests (5m / 10m / 30m / 1h)</th>
                                                    <th className="px-6 py-4">Activation Status</th>
                                                    <th className="px-6 py-4">Role</th>
                                                    <th className="px-6 py-4 text-right">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-600">
                                                {allUsersList.map((user) => (
                                                    <tr key={user.uid} className="hover:bg-slate-50/50 transition duration-150">
                                                        <td className="px-6 py-4 flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-lime-100 flex items-center justify-center text-lime-750 font-bold overflow-hidden shadow-sm">
                                                                {user.photo_url ? (
                                                                    <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
                                                                ) : (
                                                                    user.display_name?.charAt(0).toUpperCase() || '?'
                                                                )}
                                                            </div>
                                                            <span className="font-bold text-slate-900">{user.display_name}</span>
                                                        </td>
                                                        <td className="px-6 py-4 text-slate-500 font-medium">
                                                            {user.email || 'Not Provided'}
                                                        </td>
                                                        <td className="px-6 py-4 text-slate-500 font-medium">
                                                            {user.department_id || 'Not Set'} / {user.level || '?' }L
                                                        </td>
                                                        <td className="px-6 py-4 text-slate-450 font-medium text-[10px]">
                                                            {user.last_activity_date ? new Date(user.last_activity_date).toLocaleString() : 'Never'}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-150/70 hover:scale-105 transition cursor-default shadow-sm shadow-purple-500/5 animate-fade-in" title="Requests in last 5 minutes">
                                                                    5m: <span className="font-black text-purple-900">{userRequestCounts[user.uid]?.m5 || 0}</span>
                                                                </span>
                                                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-150/70 hover:scale-105 transition cursor-default shadow-sm shadow-blue-500/5 animate-fade-in" title="Requests in last 10 minutes">
                                                                    10m: <span className="font-black text-blue-900">{userRequestCounts[user.uid]?.m10 || 0}</span>
                                                                </span>
                                                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-150/70 hover:scale-105 transition cursor-default shadow-sm shadow-indigo-500/5 animate-fade-in" title="Requests in last 30 minutes">
                                                                    30m: <span className="font-black text-indigo-900">{userRequestCounts[user.uid]?.m30 || 0}</span>
                                                                </span>
                                                                <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-pink-50 text-pink-700 border border-pink-150/70 hover:scale-105 transition cursor-default shadow-sm shadow-pink-500/5 animate-fade-in" title="Requests in last 1 hour">
                                                                    1h: <span className="font-black text-pink-900">{userRequestCounts[user.uid]?.h1 || 0}</span>
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            {user.subscription_status === 'premium' ? (
                                                                <span className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase bg-indigo-50 text-indigo-700 border border-indigo-150 shadow-sm shadow-indigo-500/5">
                                                                    Premium
                                                                </span>
                                                            ) : user.subscription_status === 'personal_token' ? (
                                                                <span className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase bg-teal-50 text-teal-700 border border-teal-150 shadow-sm shadow-teal-500/5">
                                                                    Google Token
                                                                </span>
                                                            ) : user.is_activated ? (
                                                                <span className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase bg-green-50 text-green-700 border border-green-150 shadow-sm shadow-green-500/5">
                                                                    Activated
                                                                </span>
                                                            ) : (
                                                                <span className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-150 shadow-sm shadow-amber-500/5">
                                                                    Pending Activation
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase border ${user.is_admin ? 'bg-purple-50 text-purple-700 border-purple-150' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                                    {user.is_admin ? 'Admin' : 'Student'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <select
                                                                value={user.subscription_status || 'none'}
                                                                onChange={(e) => handleUpdateUserSubscription(user.uid, e.target.value as 'none' | 'premium' | 'personal_token')}
                                                                className="bg-white border border-slate-200 text-[11px] rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 font-semibold text-slate-700 shadow-sm transition"
                                                            >
                                                                <option value="none">Free (None)</option>
                                                                <option value="premium">Premium</option>
                                                                <option value="personal_token">Google Token</option>
                                                            </select>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'analytics' && (
                        <div className="space-y-6">
                            {/* Real-time Traffic Matrix */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                                <div className="flex justify-between items-center">
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                        <Activity className="w-5 h-5 text-lime-600 animate-pulse" />
                                        <span>Real-Time Traffic Monitor</span>
                                    </h3>
                                    <span className="px-2.5 py-1 bg-lime-50 text-lime-700 text-[10px] font-black uppercase tracking-wider rounded-full border border-lime-150 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-lime-650 animate-ping"></span>
                                        <span>Live</span>
                                    </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    {/* 35 Mins Card */}
                                    <div className="bg-slate-50 border border-slate-100 hover:border-lime-200 hover:bg-lime-50/10 p-5 rounded-2xl shadow-sm transition duration-200 flex items-center justify-between group">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Active (Last 35 Mins)</p>
                                            <h4 className="text-3xl font-black text-slate-850 mt-1.5">
                                                {allUsersList.filter(u => u.last_activity_date && u.last_activity_date >= Date.now() - 35 * 60 * 1000).length}
                                            </h4>
                                        </div>
                                        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200/60 shadow-sm flex items-center justify-center text-slate-450 group-hover:text-lime-600 transition">
                                            <Clock className="w-5 h-5" />
                                        </div>
                                    </div>

                                    {/* 1 Hour Card */}
                                    <div className="bg-slate-50 border border-slate-100 hover:border-lime-200 hover:bg-lime-50/10 p-5 rounded-2xl shadow-sm transition duration-200 flex items-center justify-between group">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Active (Last 1 Hour)</p>
                                            <h4 className="text-3xl font-black text-slate-850 mt-1.5">
                                                {allUsersList.filter(u => u.last_activity_date && u.last_activity_date >= Date.now() - 60 * 60 * 1000).length}
                                            </h4>
                                        </div>
                                        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200/60 shadow-sm flex items-center justify-center text-slate-450 group-hover:text-lime-600 transition">
                                            <Clock className="w-5 h-5" />
                                        </div>
                                    </div>

                                    {/* 24 Hour Card */}
                                    <div className="bg-slate-50 border border-slate-100 hover:border-lime-200 hover:bg-lime-50/10 p-5 rounded-2xl shadow-sm transition duration-200 flex items-center justify-between group">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Active (Last 24 Hours)</p>
                                            <h4 className="text-3xl font-black text-slate-850 mt-1.5">
                                                {allUsersList.filter(u => u.last_activity_date && u.last_activity_date >= Date.now() - 24 * 60 * 60 * 1000).length}
                                            </h4>
                                        </div>
                                        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200/60 shadow-sm flex items-center justify-center text-slate-450 group-hover:text-lime-600 transition">
                                            <Clock className="w-5 h-5" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Real-time AI Request Volumes */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <Sparkles className="w-5 h-5 text-purple-650" />
                                    <span>Real-Time AI Request Volumes</span>
                                </h3>

                                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                                    {/* AI Requests in 35m */}
                                    <div className="bg-purple-50/30 border border-purple-100 p-5 rounded-2xl">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-purple-600">AI Requests (Last 35 Mins)</p>
                                        <h4 className="text-3xl font-black text-purple-950 mt-1.5">
                                            {aiRequestLogs.filter(r => r.timestamp && r.timestamp >= Date.now() - 35 * 60 * 1000).length}
                                        </h4>
                                        <p className="text-[10px] text-purple-500/80 font-bold mt-2 flex items-center gap-1">
                                            <Activity className="w-3.5 h-3.5" />
                                            <span>Real-time processed</span>
                                        </p>
                                    </div>

                                    {/* AI Requests in 1h */}
                                    <div className="bg-indigo-50/30 border border-indigo-100 p-5 rounded-2xl">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">AI Requests (Last 1 Hour)</p>
                                        <h4 className="text-3xl font-black text-indigo-950 mt-1.5">
                                            {aiRequestLogs.filter(r => r.timestamp && r.timestamp >= Date.now() - 60 * 60 * 1000).length}
                                        </h4>
                                        <p className="text-[10px] text-indigo-500/80 font-bold mt-2 flex items-center gap-1">
                                            <TrendingUp className="w-3.5 h-3.5" />
                                            <span>1h demand window</span>
                                        </p>
                                    </div>

                                    {/* AI Requests in 24h */}
                                    <div className="bg-teal-50/30 border border-teal-100 p-5 rounded-2xl">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-teal-600">AI Requests (Last 24 Hours)</p>
                                        <h4 className="text-3xl font-black text-teal-950 mt-1.5">
                                            {aiRequestLogs.filter(r => r.timestamp && r.timestamp >= Date.now() - 24 * 60 * 60 * 1000).length}
                                        </h4>
                                        <p className="text-[10px] text-teal-500/80 font-bold mt-2 flex items-center gap-1">
                                            <CheckCircle className="w-3.5 h-3.5" />
                                            <span>Cumulative 24h</span>
                                        </p>
                                    </div>

                                    {/* Capacity Gauge */}
                                    <div className="bg-amber-50/30 border border-amber-100 p-5 rounded-2xl flex flex-col justify-between">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-wider text-amber-700">Inference Load (Last Minute)</p>
                                            <div className="flex items-baseline gap-1 mt-1.5">
                                                <h4 className="text-3xl font-black text-amber-950">
                                                    {aiRequestLogs.filter(r => r.timestamp && r.timestamp >= Date.now() - 60 * 1000).length}
                                                </h4>
                                                <span className="text-xs text-amber-700/70 font-bold">/ {appSettings?.custom_user_limit_rpm || 10} RPM</span>
                                            </div>
                                        </div>
                                        <div className="mt-3">
                                            <div className="w-full bg-amber-100 rounded-full h-1.5 overflow-hidden">
                                                <div 
                                                    className="bg-amber-500 h-1.5 rounded-full transition-all duration-300"
                                                    style={{ 
                                                        width: `${Math.min(
                                                            100, 
                                                            (aiRequestLogs.filter(r => r.timestamp && r.timestamp >= Date.now() - 60 * 1000).length / (appSettings?.custom_user_limit_rpm || 10)) * 100
                                                        )}%` 
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Premium vs Token Breakdown */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                    <div className="flex items-center justify-between p-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                                                <CreditCard className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <h5 className="font-bold text-slate-800 text-xs">Premium AI Queries</h5>
                                                <p className="text-[10px] text-slate-450 font-medium">Processed using Vantutor's enterprise key</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-base font-black text-indigo-950">
                                                {aiRequestLogs.filter(r => !r.use_personal_token).length}
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-bold block">
                                                {aiRequestLogs.length ? ((aiRequestLogs.filter(r => !r.use_personal_token).length / aiRequestLogs.length) * 100).toFixed(0) : 0}%
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between p-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center font-bold">
                                                <Key className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <h5 className="font-bold text-slate-800 text-xs">Google Token Queries</h5>
                                                <p className="text-[10px] text-slate-450 font-medium">Processed using student's personal key</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-base font-black text-teal-950">
                                                {aiRequestLogs.filter(r => r.use_personal_token).length}
                                            </span>
                                            <span className="text-[10px] text-slate-400 font-bold block">
                                                {aiRequestLogs.length ? ((aiRequestLogs.filter(r => r.use_personal_token).length / aiRequestLogs.length) * 100).toFixed(0) : 0}%
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* "Any Companies?" Custom / Institutional Domains Analysis */}
                            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                            <Building className="w-5 h-5 text-indigo-650" />
                                            <span>Institutional & Custom Corporate Domains ("Any Companies?")</span>
                                        </h3>
                                        <p className="text-[10px] text-slate-450 font-semibold mt-0.5">Custom organizational or university signups (excluding general email providers like Gmail, Yahoo, etc.)</p>
                                    </div>
                                </div>
                                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                                    {(() => {
                                        const domains: { [domain: string]: { count: number; premiumCount: number; users: string[] } } = {};
                                        allUsersList.forEach(u => {
                                            if (!u.email) return;
                                            const parts = u.email.split('@');
                                            if (parts.length < 2) return;
                                            const domain = parts[1].toLowerCase().trim();
                                            const ignoreList = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com', 'mail.com', 'zoho.com', 'yandex.com', 'protonmail.com', 'proton.me'];
                                            if (ignoreList.includes(domain)) return;
                                            if (!domains[domain]) {
                                                domains[domain] = { count: 0, premiumCount: 0, users: [] };
                                            }
                                            domains[domain].count++;
                                            if (u.subscription_status === 'premium') {
                                                domains[domain].premiumCount++;
                                            }
                                            domains[domain].users.push(u.display_name || u.email);
                                        });

                                        const domainList = Object.keys(domains).map(d => ({
                                            domain: d,
                                            ...domains[d]
                                        })).sort((a, b) => b.count - a.count);

                                        if (!domainList.length) {
                                            return (
                                                <div className="p-8 text-center text-slate-400 font-semibold text-xs">
                                                    No corporate or institutional email domains detected yet. All users are currently on standard personal email accounts.
                                                </div>
                                            );
                                        }

                                        return (
                                            <table className="w-full text-left border-collapse">
                                                <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase tracking-widest font-black border-b border-slate-100">
                                                    <tr>
                                                        <th className="px-6 py-3.5">Organization / Domain</th>
                                                        <th className="px-6 py-3.5">Registered Users</th>
                                                        <th className="px-6 py-3.5">Premium Subscribers</th>
                                                        <th className="px-6 py-3.5">Users Preview</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-650">
                                                    {domainList.map(item => (
                                                        <tr key={item.domain} className="hover:bg-slate-50/50 transition">
                                                            <td className="px-6 py-3.5 font-bold text-slate-900 flex items-center gap-2">
                                                                <span className="w-2.5 h-2.5 rounded bg-indigo-500"></span>
                                                                <span>{item.domain}</span>
                                                            </td>
                                                            <td className="px-6 py-3.5">
                                                                <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700">
                                                                    {item.count} user{item.count !== 1 ? 's' : ''}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-3.5 text-indigo-650 font-black">
                                                                {item.premiumCount > 0 ? (
                                                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] uppercase bg-indigo-50 border border-indigo-150">
                                                                        {item.premiumCount} premium
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-slate-400 font-medium">None</span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-3.5 text-slate-500 font-medium text-[11px]">
                                                                {item.users.slice(0, 3).join(', ')}
                                                                {item.users.length > 3 && ` +${item.users.length - 3} more`}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Recent AI Requests Stream */}
                            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                        <Activity className="w-5 h-5 text-lime-650" />
                                        <span>Recent AI Query Live Stream</span>
                                    </h3>
                                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{aiRequestLogs.length} request logs cached</span>
                                </div>
                                <div className="max-h-[400px] overflow-y-auto">
                                    {isLogsLoading ? (
                                        <div className="p-12 text-center text-slate-400 font-medium">Refreshing stream...</div>
                                    ) : aiRequestLogs.length === 0 ? (
                                        <div className="p-12 text-center text-slate-400 font-medium">No recent AI query transactions found.</div>
                                    ) : (
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase tracking-widest font-black border-b border-slate-100">
                                                <tr>
                                                    <th className="px-6 py-3.5">User</th>
                                                    <th className="px-6 py-3.5">Model</th>
                                                    <th className="px-6 py-3.5">Key Type</th>
                                                    <th className="px-6 py-3.5">Time</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-650">
                                                {aiRequestLogs.map((log) => {
                                                    const u = allUsersList.find(user => user.uid === log.user_id);
                                                    const displayEmail = u?.email || log.email || 'Anonymous Student';
                                                    const displayName = u?.display_name || log.user_id?.slice(0, 8);
                                                    return (
                                                        <tr key={log.id} className="hover:bg-slate-50/50 transition">
                                                            <td className="px-6 py-3.5 flex items-center gap-2">
                                                                <div className="w-6 h-6 rounded bg-lime-100 flex items-center justify-center text-lime-750 font-black text-[10px]">
                                                                    {displayName?.charAt(0).toUpperCase() || '?'}
                                                                </div>
                                                                <div>
                                                                    <p className="font-bold text-slate-900">{displayName}</p>
                                                                    <p className="text-[9px] text-slate-450 font-medium -mt-0.5">{displayEmail}</p>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-3.5">
                                                                <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono text-slate-600">
                                                                    {log.model}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-3.5">
                                                                {log.use_personal_token ? (
                                                                    <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-150 text-[9px] font-black uppercase">
                                                                        Google Token
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-150 text-[9px] font-black uppercase">
                                                                        Premium AI
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-6 py-3.5 text-slate-450 font-bold text-[10px]">
                                                                {(() => {
                                                                    const seconds = Math.floor((Date.now() - log.timestamp) / 1000);
                                                                    if (seconds < 60) return 'just now';
                                                                    const minutes = Math.floor(seconds / 60);
                                                                    if (minutes < 60) return `${minutes}m ago`;
                                                                    const hours = Math.floor(minutes / 60);
                                                                    if (hours < 24) return `${hours}h ago`;
                                                                    return new Date(log.timestamp).toLocaleString();
                                                                })()}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'payments' && (
                        <div className="space-y-6">
                            {/* Checkout Conversion Metrics Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Total Initiated */}
                                <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center justify-between group hover:border-slate-300 transition">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Checkouts Initiated</p>
                                        <h3 className="text-3xl font-black text-slate-900 mt-1">{paymentLogs.length}</h3>
                                    </div>
                                    <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-slate-700 transition">
                                        <CreditCard className="w-5 h-5" />
                                    </div>
                                </div>

                                {/* Successful */}
                                <div className="bg-green-50 border border-green-200 p-5 rounded-2xl shadow-sm flex items-center justify-between group hover:border-green-300 transition">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-green-700">Successful Purchases</p>
                                        <h3 className="text-3xl font-black text-green-950 mt-1">
                                            {paymentLogs.filter(p => p.status === 'success').length}
                                        </h3>
                                    </div>
                                    <div className="w-11 h-11 rounded-xl bg-white border border-green-200 shadow-sm flex items-center justify-center text-green-600 group-hover:text-green-750 transition">
                                        <CheckCircle className="w-5 h-5" />
                                    </div>
                                </div>

                                {/* Cancelled/Failed */}
                                <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl shadow-sm flex items-center justify-between group hover:border-amber-300 transition">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">Cancelled / Failed</p>
                                        <h3 className="text-3xl font-black text-amber-950 mt-1">
                                            {paymentLogs.filter(p => p.status === 'cancelled' || p.status === 'failed').length}
                                        </h3>
                                    </div>
                                    <div className="w-11 h-11 rounded-xl bg-white border border-amber-200 shadow-sm flex items-center justify-center text-amber-600 group-hover:text-amber-700 transition">
                                        <X className="w-5 h-5" />
                                    </div>
                                </div>

                                {/* Conversion Rate */}
                                <div className="bg-indigo-50 border border-indigo-200 p-5 rounded-2xl shadow-sm flex items-center justify-between group hover:border-indigo-300 transition">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-indigo-750">Conversion Rate</p>
                                        <h3 className="text-3xl font-black text-indigo-950 mt-1">
                                            {paymentLogs.length 
                                                ? ((paymentLogs.filter(p => p.status === 'success').length / paymentLogs.length) * 100).toFixed(1)
                                                : '0.0'}%
                                        </h3>
                                    </div>
                                    <div className="w-11 h-11 rounded-xl bg-white border border-indigo-200 shadow-sm flex items-center justify-center text-indigo-650 group-hover:text-indigo-750 transition">
                                        <TrendingUp className="w-5 h-5" />
                                    </div>
                                </div>
                            </div>

                            {/* Pending Refund Requests Manager */}
                            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                            <AlertCircle className="w-5 h-5 text-amber-600" />
                                            <span>Student Refund & Premium Revocation Control</span>
                                        </h3>
                                        <p className="text-[10px] text-slate-450 font-semibold mt-0.5">Approve refund requests to automatically deactivate user premium membership in real time</p>
                                    </div>
                                    <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-150">
                                        {refundLogs.filter(r => r.status === 'pending').length} pending
                                    </span>
                                </div>
                                <div className="p-4">
                                    {refundLogs.length === 0 ? (
                                        <div className="p-8 text-center text-slate-400 font-semibold text-xs">
                                            No refund requests logged. Use the simulator control room below to test.
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {refundLogs.map((refund) => (
                                                <div 
                                                    key={refund.id} 
                                                    className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition duration-200 ${
                                                        refund.status === 'approved' 
                                                            ? 'bg-slate-50/70 border-slate-150 opacity-70' 
                                                            : 'bg-amber-50/10 border-amber-200 hover:border-amber-300'
                                                    }`}
                                                >
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-slate-800 text-xs">{refund.email}</span>
                                                            {refund.status === 'approved' ? (
                                                                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-slate-100 text-slate-500 border border-slate-200">
                                                                    Approved & Revoked
                                                                </span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-150">
                                                                    Pending Approval
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] font-medium text-slate-650 font-semibold">
                                                            <span className="font-semibold text-slate-450 uppercase text-[9px] tracking-wider">Reason:</span> "{refund.reason}"
                                                        </p>
                                                        <p className="text-[9px] font-bold text-slate-400">
                                                            Requested: {new Date(refund.timestamp).toLocaleString()}
                                                            {refund.resolved_at && ` • Approved: ${new Date(refund.resolved_at).toLocaleString()}`}
                                                        </p>
                                                    </div>
                                                    
                                                    {refund.status === 'pending' && (
                                                        <button
                                                            onClick={() => handleApproveRefund(refund)}
                                                            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[10px] uppercase tracking-wider transition shadow-md shadow-amber-600/10 outline-none flex items-center gap-1.5 self-start md:self-center"
                                                        >
                                                            <Shield className="w-3.5 h-3.5" />
                                                            <span>Approve & Revoke Access</span>
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Live Support Complaints / Tickets */}
                            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                                    <div>
                                        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                            <MessageSquare className="w-5 h-5 text-red-500" />
                                            <span>Support Complaints & Tickets</span>
                                        </h3>
                                        <p className="text-[10px] text-slate-450 font-semibold mt-0.5">Real-time student issues, activations failures, and feedback</p>
                                    </div>
                                    <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-red-50 text-red-700 border border-red-150">
                                        {complaintLogs.filter(c => c.status === 'pending').length} open
                                    </span>
                                </div>
                                <div className="p-4">
                                    {complaintLogs.length === 0 ? (
                                        <div className="p-8 text-center text-slate-400 font-semibold text-xs">
                                            No complaints or support tickets found. Use the simulator control room below to test.
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {complaintLogs.map((complaint) => (
                                                <div 
                                                    key={complaint.id} 
                                                    className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition duration-200 ${
                                                        complaint.status === 'resolved' 
                                                            ? 'bg-slate-50/70 border-slate-150 opacity-70' 
                                                            : 'bg-red-50/5 border-red-200 hover:border-red-300'
                                                    }`}
                                                >
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-slate-850 text-xs">{complaint.email}</span>
                                                            {complaint.status === 'resolved' ? (
                                                                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-green-50 text-green-700 border border-green-150">
                                                                    Resolved
                                                                </span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-red-50 text-red-700 border border-red-150">
                                                                    Pending Response
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] font-medium text-slate-650">
                                                            "{complaint.message}"
                                                        </p>
                                                        <p className="text-[9px] font-bold text-slate-400">
                                                            Reported: {new Date(complaint.timestamp).toLocaleString()}
                                                            {complaint.resolved_at && ` • Resolved: ${new Date(complaint.resolved_at).toLocaleString()}`}
                                                        </p>
                                                    </div>
                                                    
                                                    {complaint.status === 'pending' && (
                                                        <button
                                                            onClick={() => handleResolveComplaint(complaint)}
                                                            className="px-4 py-2 bg-slate-900 hover:bg-black text-white rounded-lg font-bold text-[10px] uppercase tracking-wider transition shadow-md outline-none flex items-center gap-1.5 self-start md:self-center"
                                                        >
                                                            <CheckCircle className="w-3.5 h-3.5 text-lime-500" />
                                                            <span>Mark Resolved</span>
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Paystack Inline Transactions table */}
                            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                        <CreditCard className="w-5 h-5 text-indigo-650" />
                                        <span>Live Paystack Checkout Transactions Audit</span>
                                    </h3>
                                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{paymentLogs.length} attempts logged</span>
                                </div>
                                <div className="max-h-[350px] overflow-y-auto">
                                    {isLogsLoading ? (
                                        <div className="p-12 text-center text-slate-400 font-medium">Refreshing transactions...</div>
                                    ) : paymentLogs.length === 0 ? (
                                        <div className="p-12 text-center text-slate-400 font-medium">No Paystack checkout logs detected.</div>
                                    ) : (
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase tracking-widest font-black border-b border-slate-100">
                                                <tr>
                                                    <th className="px-6 py-3.5">Student</th>
                                                    <th className="px-6 py-3.5">Amount</th>
                                                    <th className="px-6 py-3.5">Status</th>
                                                    <th className="px-6 py-3.5">Reference</th>
                                                    <th className="px-6 py-3.5">Time</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-650">
                                                {paymentLogs.map((pay) => (
                                                    <tr key={pay.id} className="hover:bg-slate-50/50 transition">
                                                        <td className="px-6 py-3.5 font-bold text-slate-900">
                                                            {pay.email}
                                                        </td>
                                                        <td className="px-6 py-3.5 font-mono font-bold text-slate-700">
                                                            ₦{(pay.amount || 5000).toLocaleString()}
                                                        </td>
                                                        <td className="px-6 py-3.5">
                                                            {pay.status === 'success' ? (
                                                                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-green-50 text-green-700 border border-green-150 shadow-sm shadow-green-500/5">
                                                                    Successful
                                                                </span>
                                                            ) : pay.status === 'cancelled' ? (
                                                                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-slate-150 text-slate-600 border border-slate-200">
                                                                    Cancelled
                                                                </span>
                                                            ) : pay.status === 'failed' ? (
                                                                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-red-50 text-red-700 border border-red-150 shadow-sm shadow-red-500/5">
                                                                    Failed
                                                                </span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-amber-50 text-amber-700 border border-amber-150 animate-pulse">
                                                                    Initiated
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-6 py-3.5 font-mono text-[10px] text-slate-450">
                                                            {pay.reference || (pay.error ? `Err: ${pay.error}` : 'N/A')}
                                                        </td>
                                                        <td className="px-6 py-3.5 text-slate-450 font-bold text-[10px]">
                                                            {(() => {
                                                                const seconds = Math.floor((Date.now() - pay.timestamp) / 1000);
                                                                if (seconds < 60) return 'just now';
                                                                const minutes = Math.floor(seconds / 60);
                                                                if (minutes < 60) return `${minutes}m ago`;
                                                                const hours = Math.floor(minutes / 60);
                                                                if (hours < 24) return `${hours}h ago`;
                                                                return new Date(pay.timestamp).toLocaleString();
                                                            })()}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>

                            {/* Free Premium Activation Code Generator */}
                            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                    <Key className="w-5 h-5 text-lime-600" />
                                    <span>Free Premium Activation Code Generator</span>
                                </h3>
                                <p className="text-xs text-slate-500">
                                    Input a valid Google Gemini API key to generate a unique 5-digit code. Students can input this code to activate their premium accounts.
                                </p>
                                
                                <div className="flex flex-col sm:flex-row gap-3">
                                    <input
                                        type="text"
                                        placeholder="Paste Gemini API Key here"
                                        value={newCodeApiKey}
                                        onChange={(e) => setNewCodeApiKey(e.target.value)}
                                        className="flex-1 p-3 border border-gray-200 rounded-xl text-sm focus:ring-4 focus:ring-lime-100 focus:border-lime-500 outline-none transition font-mono"
                                    />
                                    <button
                                        onClick={handleGenerateActivationCode}
                                        disabled={isGeneratingCode || !newCodeApiKey.trim()}
                                        className="bg-lime-600 hover:bg-lime-700 text-white font-bold px-6 py-3 rounded-xl text-xs uppercase tracking-wider transition disabled:opacity-50"
                                    >
                                        {isGeneratingCode ? 'Generating...' : 'Generate Code'}
                                    </button>
                                </div>

                                <div className="border-t border-slate-100 pt-4">
                                    <h4 className="font-bold text-slate-800 text-xs mb-3">Generated Activation Codes</h4>
                                    <div className="max-h-[250px] overflow-y-auto">
                                        {activationCodes.length === 0 ? (
                                            <p className="text-xs text-slate-400 italic">No activation codes generated yet.</p>
                                        ) : (
                                            <table className="w-full text-left border-collapse">
                                                <thead className="bg-slate-50 text-[10px] text-slate-400 uppercase tracking-widest font-black border-b border-slate-100">
                                                    <tr>
                                                        <th className="px-4 py-2">Code</th>
                                                        <th className="px-4 py-2">Associated API Key</th>
                                                        <th className="px-4 py-2">Status</th>
                                                        <th className="px-4 py-2">Created</th>
                                                        <th className="px-4 py-2">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-650">
                                                    {activationCodes.map((item) => (
                                                        <tr key={item.code} className="hover:bg-slate-50/50 transition">
                                                            <td className="px-4 py-2 font-mono font-black text-sm text-slate-900">
                                                                {item.code}
                                                            </td>
                                                            <td className="px-4 py-2 font-mono text-[10px] text-slate-450">
                                                                {item.api_key ? `${item.api_key.slice(0, 6)}...${item.api_key.slice(-4)}` : 'N/A'}
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                {item.status === 'unused' ? (
                                                                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-green-50 text-green-700 border border-green-150">
                                                                        Unused
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2 py-0.5 rounded text-[8px] font-black uppercase bg-slate-100 text-slate-500 border border-slate-200">
                                                                        Used
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-2 text-slate-400 text-[10px]">
                                                                {new Date(item.created_at).toLocaleDateString()}
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                <button
                                                                    onClick={() => handleDeleteActivationCode(item.code)}
                                                                    className="text-red-500 hover:text-red-700 font-bold uppercase text-[9px] tracking-wider transition"
                                                                >
                                                                    Delete
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Testing Simulator Control Room */}
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white space-y-4 shadow-xl shadow-slate-950/20">
                                <div className="flex items-center gap-2">
                                    <Shield className="w-5 h-5 text-lime-400" />
                                    <div>
                                        <h4 className="font-bold text-sm tracking-wide">Developer Sandbox Simulator Control Room</h4>
                                        <p className="text-[10px] text-slate-400 font-medium">Inject synthetic live database transactions to immediately test real-time analytics UI streams</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <button
                                        onClick={handleSimulateRefund}
                                        className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-lime-400 py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider hover:text-white transition flex items-center justify-center gap-2 shadow-md outline-none"
                                    >
                                        <AlertCircle className="w-4 h-4" />
                                        <span>Inject Synthetic Refund Request</span>
                                    </button>
                                    
                                    <button
                                        onClick={handleSimulateComplaint}
                                        className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-lime-400 py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider hover:text-white transition flex items-center justify-center gap-2 shadow-md outline-none"
                                    >
                                        <MessageSquare className="w-4 h-4" />
                                        <span>Inject Synthetic Support Ticket</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};
