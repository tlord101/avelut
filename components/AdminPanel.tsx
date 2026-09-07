import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, storage, auth, ref as dbRef, set, push, update, get, remove, query, limitToLast, storageRef, uploadBytes, getDownloadURL } from '../lib/backend';
import { Type, createAvelutAI } from '../utils/inference';
import type { UsageSettings } from '../types';
import { useToast } from '../hooks/useToast';
import { useAppSettings } from '../hooks/useAppSettings';
import { useGoogleDrivePicker } from '../hooks/useGoogleDrivePicker';
import type { UserProfile, Question, Course, Topic, EmailConfig } from '../types';
import { MenuIcon } from './icons/MenuIcon';
import { TrashIcon } from './icons/TrashIcon';
import { StackIcon } from './icons/StackIcon';
import { StudyGuideIcon } from './icons/StudyGuideIcon';
import { GraduationCapIcon } from './icons/GraduationCapIcon';
import { CheckIcon } from './icons/CheckIcon';
import { Shield } from 'lucide-react';
import { getWindowPathname } from '../utils/pathname';
import { APP_SETTINGS_PATH, DEFAULT_APP_SETTINGS, DEFAULT_USAGE_SETTINGS } from '../utils/appSettings';
import { getFeatureModel } from '../utils/usage';

import { AdminLayout } from './admin/AdminLayout';
import { DashboardView } from './admin/pages/DashboardView';
import { AcademicUnitsView } from './admin/pages/AcademicUnitsView';
import { UserControlView } from './admin/pages/UserControlView';
import { SystemSettingsView } from './admin/pages/SystemSettingsView';
import { PaymentsAndUsageView } from './admin/pages/PaymentsAndUsageView';
import { PastQuestionsView } from './admin/pages/PastQuestionsView';
import { AdminUpdates } from './admin/AdminUpdates';
import { NotificationsView } from './admin/pages/NotificationsView';
import { EmailsView } from './admin/pages/EmailsView';
import { TicketsView } from './admin/pages/TicketsView';
import { CoFoundersView } from './admin/pages/CoFoundersView';
import { SEOSettingsView } from './admin/pages/SEOSettingsView';
import { FeedbackView } from './admin/pages/FeedbackView';
import { GitHubIntegrationView } from './admin/pages/GitHubIntegrationView';
import { AppVersionUpdateView } from './admin/pages/AppVersionUpdateView';

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

type AdminTab = 'dashboard' | 'schools' | 'questions' | 'users' | 'departments' | 'app' | 'app-updates' | 'payments' | 'notifications' | 'emails' | 'email-configs' | 'usage-settings' | 'usage-analytics' | 'purchase-logs' | 'tickets' | 'cofounders' | 'seo' | 'feedback' | 'github-integration';

type CourseAdminView =
    | { mode: 'global' }
    | { mode: 'global-list'; level: string }
    | { mode: 'global-detail'; level: string; courseId: string }
    | { mode: 'manager-root' }
    | { mode: 'add'; departmentId?: string; level?: string }
    | { mode: 'manager-list'; departmentId: string; level: string }
    | { mode: 'manager-detail'; departmentId: string; level: string; courseId: string };

const DEFAULT_VISIBLE_TABS: AdminTab[] = ['dashboard', 'schools', 'departments', 'questions', 'users', 'notifications', 'feedback', 'emails', 'app', 'app-updates', 'payments', 'email-configs', 'usage-settings', 'usage-analytics', 'purchase-logs', 'tickets', 'cofounders', 'seo', 'github-integration'];

const getCourseAdminView = (pathname: string): CourseAdminView => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'admin' || segments[1] !== 'courses') {
        return { mode: 'global' };
    }

    if (segments.length <= 2) {
        return { mode: 'manager-root' };
    }

    if (segments[2] === 'add') {
        const departmentId = segments[3] ? decodeURIComponent(segments[3]) : undefined;
        const level = segments[4] ? decodeURIComponent(segments[4]) : undefined;
        return { mode: 'add', departmentId, level };
    }

    if (segments[2] === 'global' || segments[2] === 'all') {
        const level = segments[3] ? decodeURIComponent(segments[3]) : '';
        const courseId = segments[4] ? decodeURIComponent(segments[4]) : '';
        if (!level) return { mode: 'global' };
        if (!courseId) return { mode: 'global-list', level };
        return { mode: 'global-detail', level, courseId };
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

const buildCourseGlobalPath = (level?: string, courseId?: string) => {
    if (!level) return '/admin/courses/global';
    const encodedLevel = encodeURIComponent(level);
    const encodedCourse = courseId ? `/${encodeURIComponent(courseId)}` : '';
    return `/admin/courses/global/${encodedLevel}${encodedCourse}`;
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

    const mergedCourse: any = {
        ...baseCourse,
        ...sourceCourse,
        course_id: mergedCourseId || '',
        course_name: mergedCourseName || sourceCourse.course_name,
        topics: resolvedTopics,
        textbook_url: getPrimaryTextbookUrl(mergedCourseUrls),
        textbook_urls: mergedCourseUrls,
        semester: normalizeSemester(sourceCourse.semester || (baseCourse as Course).semester),
    };

    const sharedKey = (sourceCourse as any).textbook_shared_key || (baseCourse as any).textbook_shared_key;
    if (sharedKey !== undefined && sharedKey !== null) {
        mergedCourse.textbook_shared_key = sharedKey;
    }

    return mergedCourse;
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
    if (!rawCourseList) return [];
    let listAsArray = rawCourseList;
    if (!Array.isArray(rawCourseList)) {
        if (typeof rawCourseList === 'object') {
            listAsArray = Object.values(rawCourseList);
        } else {
            return [];
        }
    }
    return listAsArray
        .filter(Boolean)
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
    // Intelligently determine level: check course code (e.g. CPE 211 -> 200lvl), then extracted document level, then course object, then override
    const inferLevelFromCode = (code: string): string | undefined => {
        const match = code.match(/\b([1-5])\d{2}\b/);
        if (match && match[1]) {
            return `${match[1]}00lvl`;
        }
        return undefined;
    };

    const codeInferredLevel = inferLevelFromCode(courseCode);
    const rawLevel = course?.level || extractedLevel || codeInferredLevel || overrideLevel;
    const level = normalizeLevel(rawLevel);
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
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const { settings: appSettings, isLoading: isAppSettingsLoading } = useAppSettings();
    const aiModel = appSettings.openrouter_model || 'qwen/qwen3.7-flash';
    const aiApiKey = (appSettings.openrouter_api_key || '').trim();
    const ai = useMemo(() => createAvelutAI(appSettings, null), [appSettings]);
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
    const [isInitialDataLoading, setIsInitialDataLoading] = useState(true);
    const [recipientMode, setRecipientMode] = useState<'all' | 'single'>('all');
    const [selectedRecipientId, setSelectedRecipientId] = useState('');
    const [announcementTitle, setAnnouncementTitle] = useState('');
    const [announcementMessage, setAnnouncementMessage] = useState('');
    const [notificationType, setNotificationType] = useState<'study_update' | 'exam_reminder' | 'welcome'>('study_update');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [isSendingPush, setIsSendingPush] = useState(false);
    const [sentNotifications, setSentNotifications] = useState<any[]>([]);
    const [sentEmails, setSentEmails] = useState<any[]>([]);
    const [isSentNotificationsLoading, setIsSentNotificationsLoading] = useState(false);
    const [isSentEmailsLoading, setIsSentEmailsLoading] = useState(false);
    const [emailConfig, setEmailConfig] = useState<EmailConfig>({
        host: '',
        port: 587,
        user: '',
        pass: '',
        secure: false,
        from_email: '',
        from_name: ''
    });
    const [emailConfigDraft, setEmailConfigDraft] = useState<EmailConfig>({
        host: '',
        port: 587,
        user: '',
        pass: '',
        secure: false,
        from_email: '',
        from_name: ''
    });
    const [isEmailConfigLoading, setIsEmailConfigLoading] = useState(false);
    const [isEmailConfigSaving, setIsEmailConfigSaving] = useState(false);
    const { addToast } = useToast();
    const { openPicker } = useGoogleDrivePicker();

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
        if (aiRequestLogs.length === 0) {
            setIsLogsLoading(true);
        }
        try {
            const [aiSnap, paySnap, refundSnap, complaintSnap, codesSnap] = await Promise.all([
                get(query(dbRef(db, 'usage_logs/ai_requests'), limitToLast(50000))),
                get(query(dbRef(db, 'usage_logs/payments'), limitToLast(50000))),
                get(query(dbRef(db, 'usage_logs/refunds'), limitToLast(2000))),
                get(query(dbRef(db, 'usage_logs/complaints'), limitToLast(2000))),
                get(query(dbRef(db, 'activation_codes'), limitToLast(5000)))
            ]);

            if (aiSnap.exists()) {
                const data = aiSnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.timestamp - a.timestamp);
                setAiRequestLogs(list);
            } else {
                setAiRequestLogs([]);
            }

            if (paySnap.exists()) {
                const data = paySnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.timestamp - a.timestamp);
                setPaymentLogs(list);
            } else {
                setPaymentLogs([]);
            }

            if (refundSnap.exists()) {
                const data = refundSnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.timestamp - a.timestamp);
                setRefundLogs(list);
            } else {
                setRefundLogs([]);
            }

            if (complaintSnap.exists()) {
                const data = complaintSnap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                list.sort((a: any, b: any) => b.timestamp - a.timestamp);
                setComplaintLogs(list);
            } else {
                setComplaintLogs([]);
            }

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
        if (activeTab === 'usage-analytics' || activeTab === 'payments' || activeTab === 'users' || activeTab === 'dashboard' || activeTab === 'purchase-logs') {
            void fetchUsageLogs();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            const mockUser = allUsersList.find(u => u.subscription_status === 'premium') || allUsersList[0] || userProfile;
            if (!mockUser) {
                addToast('No users registered to simulate refund', 'error');
                return;
            }
            const ref = push(dbRef(db, 'usage_logs/refunds'));
            await set(ref, {
                id: ref.key,
                user_id: mockUser.uid,
                email: mockUser.email || 'student@avelut.com',
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
            const mockUser = allUsersList[0] || userProfile;
            if (!mockUser) {
                addToast('No users registered to simulate complaint', 'error');
                return;
            }
            const ref = push(dbRef(db, 'usage_logs/complaints'));
            await set(ref, {
                id: ref.key,
                user_id: mockUser.uid,
                email: mockUser.email || 'student@avelut.com',
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
            addToast('Please enter an actual Avelut AI API key to generate a code', 'error');
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
    
    const [schoolsData, setSchoolsData] = useState<any>({});
    const [newSchoolName, setNewSchoolName] = useState('');
    const [newCollegeName, setNewCollegeName] = useState('');
    const [newDeptName, setNewDeptName] = useState('');
    const [selectedSchoolId, setSelectedSchoolId] = useState('');
    const [selectedCollegeId, setSelectedCollegeId] = useState('');

    // Migration State
    const [oldDepartments, setOldDepartments] = useState<any[]>([]);
    const [migrateTargetDeptId, setMigrateTargetDeptId] = useState<string>('all');
    const [migrateDestSchoolId, setMigrateDestSchoolId] = useState<string>('');
    const [migrateDestCollegeId, setMigrateDestCollegeId] = useState<string>('');
    const [migrateNewSchoolName, setMigrateNewSchoolName] = useState<string>('');
    const [migrateNewCollegeName, setMigrateNewCollegeName] = useState<string>('');

    const [courseSearchQuery, setCourseSearchQuery] = useState('');
    const [globalSearchQuery, setGlobalSearchQuery] = useState('');
    const [bulkDeleteLevel, setBulkDeleteLevel] = useState<string>('100lvl');
    const [managerSelectionDepartmentId, setManagerSelectionDepartmentId] = useState('');
    const [managerSelectionLevel, setManagerSelectionLevel] = useState('');
    const [courseDetailFiles, setCourseDetailFiles] = useState<File[]>([]);

    const fetchDepartments = async () => {
        try {
            const snap = await get(dbRef(db, 'schools_data'));
            if (snap.exists()) {
                const data = snap.val();
                setSchoolsData(data);
                const flatDepts: any[] = [];
                Object.keys(data).forEach(sId => {
                    const school = data[sId];
                    if (school.colleges) {
                        Object.keys(school.colleges).forEach(cId => {
                            const college = school.colleges[cId];
                            if (college.departments) {
                                Object.keys(college.departments).forEach(dId => {
                                    const dept = college.departments[dId];
                                    flatDepts.push({
                                        id: dId,
                                        schoolId: sId,
                                        schoolName: school.name || sId,
                                        collegeId: cId,
                                        collegeName: college.name || cId,
                                        department_name: dept.name,
                                        levels: Array.isArray(dept.levels) ? dept.levels : Object.keys(dept.levels || {})
                                    });
                                });
                            }
                        });
                    }
                });
                
                // Merge course_list from departments_data into flatDepts so courseCatalog works
                const oldSnap = await get(dbRef(db, 'departments_data'));
                if (oldSnap.exists()) {
                    const oldData = oldSnap.val();
                    flatDepts.forEach(dept => {
                        if (oldData[dept.id] && oldData[dept.id].course_list) {
                            dept.course_list = oldData[dept.id].course_list;
                        }
                    });
                }
                
                setAllDepartments(flatDepts);
            } else {
                setSchoolsData({});
                setAllDepartments([]);
            }

            // Fetch old departments
            const oldSnap = await get(dbRef(db, 'departments_data'));
            if (oldSnap.exists()) {
                const data = oldSnap.val();
                const oldDepts = Object.keys(data).map(id => ({ id, ...data[id] }));
                setOldDepartments(oldDepts);
            } else {
                setOldDepartments([]);
            }
        } catch (error) {
            console.error("Error fetching schools data:", error);
        }
    };

    const handleAddSchool = async () => {
        if (!newSchoolName) return;
        const id = newSchoolName.toLowerCase().replace(/\s+/g, '_');
        try {
            await set(dbRef(db, `schools_data/${id}`), { name: newSchoolName });
            setNewSchoolName('');
            fetchDepartments();
            addToast("School added successfully!", "success");
        } catch (error: any) {
            addToast(error.message, "error");
        }
    };

    const handleAddCollege = async () => {
        if (!newCollegeName || !selectedSchoolId) return;
        const id = newCollegeName.toLowerCase().replace(/\s+/g, '_');
        try {
            await set(dbRef(db, `schools_data/${selectedSchoolId}/colleges/${id}`), { name: newCollegeName });
            setNewCollegeName('');
            fetchDepartments();
            addToast("College added successfully!", "success");
        } catch (error: any) {
            addToast(error.message, "error");
        }
    };

    const handleAddDepartment = async () => {
        if (!newDeptName || !selectedSchoolId || !selectedCollegeId) return;
        const id = newDeptName.toLowerCase().replace(/\s+/g, '_');
        try {
            await set(dbRef(db, `schools_data/${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${id}`), {
                name: newDeptName,
                levels: Object.fromEntries(LEVELS.map(lvl => [lvl, { courses: {} }]))
            });
            setNewDeptName('');
            fetchDepartments();
            addToast("Department added successfully!", "success");
        } catch (error: any) {
            addToast(error.message, "error");
        }
    };

    const handleMigrateOldDepartments = async () => {
        if (!migrateDestSchoolId && !migrateNewSchoolName) {
            return addToast("Please select or create a destination school.", "error");
        }
        if (!migrateDestCollegeId && !migrateNewCollegeName) {
            return addToast("Please select or create a destination college.", "error");
        }

        const schoolId = migrateDestSchoolId === 'new' ? migrateNewSchoolName.toLowerCase().replace(/\s+/g, '_') : migrateDestSchoolId;
        const collegeId = migrateDestCollegeId === 'new' ? migrateNewCollegeName.toLowerCase().replace(/\s+/g, '_') : migrateDestCollegeId;

        if (!window.confirm(`This will migrate ${migrateTargetDeptId === 'all' ? 'all old departments' : 'the selected department'} into School '${schoolId}' > College '${collegeId}'. Proceed?`)) return;

        try {
            // Initialize new school/college if needed
            if (migrateDestSchoolId === 'new') {
                await update(dbRef(db, `schools_data/${schoolId}`), { name: migrateNewSchoolName });
            }
            if (migrateDestCollegeId === 'new') {
                await update(dbRef(db, `schools_data/${schoolId}/colleges/${collegeId}`), { name: migrateNewCollegeName });
            }

            const updates: Record<string, any> = {};
            
            const migrateDept = (deptId: string, deptData: any) => {
                const name = deptData.department_name || deptData.name || deptId;
                const levels = deptData.levels || Object.fromEntries(LEVELS.map(lvl => [lvl, { courses: {} }]));
                updates[`schools_data/${schoolId}/colleges/${collegeId}/departments/${deptId}`] = { name, levels };
            }

            if (migrateTargetDeptId === 'all') {
                oldDepartments.forEach(dept => migrateDept(dept.id, dept));
            } else {
                const dept = oldDepartments.find(d => d.id === migrateTargetDeptId);
                if (dept) migrateDept(dept.id, dept);
            }
            
            if (Object.keys(updates).length > 0) {
                await update(dbRef(db), updates);
                addToast("Migration complete!", "success");
                
                // reset migration state
                setMigrateTargetDeptId('all');
                setMigrateDestSchoolId('');
                setMigrateDestCollegeId('');
                setMigrateNewSchoolName('');
                setMigrateNewCollegeName('');
                
                fetchDepartments();
            }
        } catch (error: any) {
            addToast("Migration failed: " + error.message, "error");
        }
    };

    // Fetch Users helper
    const fetchUsers = async () => {
        if (allUsersList.length === 0) {
            setIsUsersLoading(true);
        }
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

    const handleUpdateUserSubscription = async (uid: string, nextStatus: 'none' | 'free' | 'basic' | 'premium') => {
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

    const handleAddUserCredits = async (uid: string) => {
        const credits = window.prompt("Enter the number of additional Visual Solver messages to add:");
        if (!credits || isNaN(Number(credits))) return;
        try {
            const userStatsRef = dbRef(db, `users/${uid}/usage_stats`);
            const snap = await get(userStatsRef);
            const currentPurchased = snap.val()?.additional_visual_messages_purchased || 0;
            await update(userStatsRef, { additional_visual_messages_purchased: currentPurchased + Number(credits) });
            addToast(`Successfully added ${credits} credits to user!`, "success");
        } catch (error: any) {
            addToast(error.message || "Failed to add credits", "error");
        }
    };

    const handleSuspendUser = async (uid: string, currentStatus: string | undefined) => {
        const isSuspended = currentStatus === 'suspended';
        const action = isSuspended ? 'unsuspend' : 'suspend';
        if (!window.confirm(`Are you sure you want to ${action} this user?`)) return;
        try {
            const userRef = dbRef(db, `users/${uid}`);
            await update(userRef, { status: isSuspended ? 'active' : 'suspended' });
            addToast(`User ${action}ed successfully!`, "success");
            void fetchUsers();
        } catch (error: any) {
            console.error(`Error trying to ${action} user:`, error);
            addToast(error.message || `Failed to ${action} user`, "error");
        }
    };

    const handleDeleteUser = async (uid: string) => {
        if (!window.confirm("Are you sure you want to permanently delete this user? Their data will be removed. This cannot be undone.")) return;
        try {
            const userRef = dbRef(db, `users/${uid}`);
            // Note: client-side cannot delete Firebase Auth user. We mark as deleted/remove db node.
            await update(userRef, { status: 'deleted', is_activated: false });
            addToast("User data marked as deleted.", "success");
            void fetchUsers();
        } catch (error: any) {
            console.error("Error trying to delete user:", error);
            addToast(error.message || "Failed to delete user", "error");
        }
    };

    const fetchSentNotifications = async () => {
        if (sentNotifications.length === 0) {
            setIsSentNotificationsLoading(true);
        }
        try {
            const snap = await get(query(dbRef(db, 'sent_notifications'), limitToLast(500)));
            if (snap.exists()) {
                const logs = Object.entries(snap.val()).map(([id, val]: [string, any]) => ({
                    id,
                    ...val
                })).sort((a, b) => b.timestamp - a.timestamp);
                setSentNotifications(logs);
            } else {
                setSentNotifications([]);
            }
        } catch (error) {
            console.error("Error fetching sent notifications logs:", error);
        } finally {
            setIsSentNotificationsLoading(false);
        }
    };

    const fetchSentEmails = async () => {
        if (sentEmails.length === 0) {
            setIsSentEmailsLoading(true);
        }
        try {
            const snap = await get(query(dbRef(db, 'sent_emails'), limitToLast(500)));
            if (snap.exists()) {
                const logs = Object.entries(snap.val()).map(([id, val]: [string, any]) => ({
                    id,
                    ...val
                })).sort((a, b) => b.timestamp - a.timestamp);
                setSentEmails(logs);
            } else {
                setSentEmails([]);
            }
        } catch (error) {
            console.error("Error fetching sent emails logs:", error);
        } finally {
            setIsSentEmailsLoading(false);
        }
    };

    const fetchEmailConfig = async () => {
        if (!emailConfig.host) {
            setIsEmailConfigLoading(true);
        }
        try {
            const snap = await get(dbRef(db, 'app_settings/email_config'));
            if (snap.exists()) {
                const config = snap.val() as EmailConfig;
                const normalized = {
                    host: config.host || '',
                    port: typeof config.port === 'number' ? config.port : parseInt(config.port as any, 10) || 587,
                    user: config.user || '',
                    pass: config.pass || '',
                    secure: !!config.secure,
                    from_email: config.from_email || '',
                    from_name: config.from_name || ''
                };
                setEmailConfig(normalized);
                setEmailConfigDraft(normalized);
            }
        } catch (error) {
            console.error("Error fetching SMTP config:", error);
        } finally {
            setIsEmailConfigLoading(false);
        }
    };

    const handleSaveEmailConfig = async () => {
        setIsEmailConfigSaving(true);
        try {
            const nextConfig = {
                ...emailConfigDraft,
                host: emailConfigDraft.host.trim(),
                port: Number(emailConfigDraft.port) || 587,
                user: emailConfigDraft.user.trim(),
                pass: emailConfigDraft.pass.trim(),
                secure: !!emailConfigDraft.secure,
                from_email: emailConfigDraft.from_email.trim(),
                from_name: emailConfigDraft.from_name.trim()
            };

            await set(dbRef(db, 'app_settings/email_config'), nextConfig);
            setEmailConfig(nextConfig);
            addToast("SMTP configuration saved successfully", "success");
        } catch (error: any) {
            console.error("Error saving SMTP config:", error);
            addToast(error.message || "Failed to save configuration", "error");
        } finally {
            setIsEmailConfigSaving(false);
        }
    };

    const handleTestEmailConfig = async () => {
        const adminEmail = auth.currentUser?.email;
        if (!adminEmail) {
            addToast("Could not find your administrator email address", "error");
            return;
        }

        setIsEmailConfigSaving(true);
        try {
            const nextConfig = {
                ...emailConfigDraft,
                host: emailConfigDraft.host.trim(),
                port: Number(emailConfigDraft.port) || 587,
                user: emailConfigDraft.user.trim(),
                pass: emailConfigDraft.pass.trim(),
                secure: !!emailConfigDraft.secure,
                from_email: emailConfigDraft.from_email.trim(),
                from_name: emailConfigDraft.from_name.trim()
            };

            await set(dbRef(db, 'app_settings/email_config'), nextConfig);
            setEmailConfig(nextConfig);

            const testJobRef = push(dbRef(db, 'email_queue'));
            const testJobId = testJobRef.key;

            if (!testJobId) {
                throw new Error("Failed to create email queue job ID");
            }

            await set(dbRef(db, `email_queue/${testJobId}`), {
                subject: "⚡ AVELUT SMTP Connection Test",
                body: `Hello! If you are reading this email, your SMTP settings for Host: ${nextConfig.host} are configured correctly and fully functional.`,
                recipients: [adminEmail],
                status: 'pending',
                timestamp: Date.now(),
                sent_by: adminEmail
            });

            addToast("Test email queued. Please check your inbox shortly.", "success");
        } catch (error: any) {
            console.error("Error testing SMTP config:", error);
            addToast(error.message || "Failed to queue test email", "error");
        } finally {
            setIsEmailConfigSaving(false);
        }
    };

    useEffect(() => {
        const loadAllInitialData = async () => {
            setIsInitialDataLoading(true);
            await Promise.all([
                fetchDepartments(),
                fetchUsageLogs(),
                fetchUsers(),
                fetchSentNotifications(),
                fetchSentEmails(),
                fetchEmailConfig()
            ]);
            setIsInitialDataLoading(false);
        };
        void loadAllInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (activeTab === 'users' || activeTab === 'dashboard' || activeTab === 'usage-analytics') {
            void fetchUsers();
            void fetchSentNotifications();
            void fetchSentEmails();
        } else if (activeTab === 'notifications') {
            void fetchSentNotifications();
            void fetchUsers();
        } else if (activeTab === 'emails') {
            void fetchSentEmails();
            void fetchUsers();
        } else if (activeTab === 'email-configs') {
            void fetchEmailConfig();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            
            // Log the notification broadcast
            const logId = push(dbRef(db, 'sent_notifications')).key;
            if (logId) {
                const targetLabel = recipientMode === 'all' 
                    ? 'All Users' 
                    : allUsersList.find(u => u.uid === selectedRecipientId)?.display_name || selectedRecipientId;
                await set(dbRef(db, `sent_notifications/${logId}`), {
                    title,
                    message,
                    type: notificationType,
                    recipient: targetLabel,
                    timestamp: Date.now(),
                    sent_by: auth.currentUser?.email || 'admin'
                });
                void fetchSentNotifications();
            }

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
            addToast("AI features are unavailable because the Avelut AI API key is not configured in App Controls.", "error");
            return;
        }
        setIsSendingPush(true);
        try {
            const prompt = `Create a short notification title (max 8 words) and a concise notification message (max 200 characters) for a ${notificationType.replace('_', ' ')} to students. Return only a JSON object with keys \"title\" and \"message\".`;

            const response = await ai.models.generateContent({
                model: aiModel,
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

            const responseText = (response as any).text || '';
            if (!responseText) throw new Error('AI returned an empty suggestion.');
            const data = JSON.parse(responseText);
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

    const handleSendEmail = async () => {
        const subject = emailSubject.trim();
        const body = emailBody.trim();
        if (!subject || !body) {
            addToast("Please enter both email subject and body", "error");
            return;
        }

        const getTargetUsersList = () => {
            if (recipientMode === 'all') {
                return allUsersList;
            }
            return allUsersList.filter(user => user.uid === selectedRecipientId);
        };

        const targetUsers = getTargetUsersList();
        if (targetUsers.length === 0) {
            addToast("Please select a valid recipient", "error");
            return;
        }

        const emailList = Array.from(new Set(targetUsers.map(user => user.email?.trim()).filter(Boolean) as string[]));
        if (emailList.length === 0) {
            addToast("No email address found for selected recipient(s)", "error");
            return;
        }

        try {
            const queueRef = push(dbRef(db, 'email_queue'));
            const queueId = queueRef.key;
            if (!queueId) {
                throw new Error("Failed to generate queue ID");
            }

            const adminEmail = auth.currentUser?.email || 'admin';

            await set(dbRef(db, `email_queue/${queueId}`), {
                subject,
                body,
                recipients: emailList,
                status: 'pending',
                timestamp: Date.now(),
                sent_by: adminEmail
            });

            // Log the email broadcast
            const logId = push(dbRef(db, 'sent_emails')).key;
            if (logId) {
                const targetLabel = recipientMode === 'all'
                    ? 'All Users'
                    : allUsersList.find(u => u.uid === selectedRecipientId)?.display_name || selectedRecipientId;
                await set(dbRef(db, `sent_emails/${logId}`), {
                    subject,
                    body,
                    recipient: targetLabel,
                    recipients_count: emailList.length,
                    timestamp: Date.now(),
                    sent_by: adminEmail
                });
            }

            setEmailSubject('');
            setEmailBody('');
            addToast(`Email queued for delivery to ${emailList.length} recipient${emailList.length !== 1 ? 's' : ''} via SMTP.`, "success");
            void fetchSentEmails();
        } catch (error: any) {
            console.error("Error queueing email broadcast:", error);
            addToast(error?.message || "Could not queue email broadcast.", "error");
        }
    };

    const handleSaveAppSettings = async () => {
        const nextSettings = {
            ...appSettingsDraft,
            primary_ai_provider: 'openrouter',
            openrouter_model: (appSettingsDraft.openrouter_model || 'qwen/qwen3.7-flash').trim(),
            openrouter_api_key: (appSettingsDraft.openrouter_api_key || '').trim(),
            alibaba_model: (appSettingsDraft.alibaba_model || 'qwen3.7-flash').trim(),
            alibaba_api_key: (appSettingsDraft.alibaba_api_key || '').trim(),
            paystack_public_key: (appSettingsDraft.paystack_public_key || '').trim(),
            custom_user_limit_rpm: appSettingsDraft.custom_user_limit_rpm ?? 10,
            custom_user_limit_tpm: appSettingsDraft.custom_user_limit_tpm ?? 250000,
            usage_settings: appSettingsDraft.usage_settings || DEFAULT_USAGE_SETTINGS,
            youtube_api_key: (appSettingsDraft.youtube_api_key || '').trim(),
            google_client_id: (appSettingsDraft.google_client_id || '').trim(),
            google_api_key: (appSettingsDraft.google_api_key || '').trim(),
            pinecone_api_key: (appSettingsDraft.pinecone_api_key || '').trim(),
            pinecone_index_name: (appSettingsDraft.pinecone_index_name || '').trim(),
            revenuecat_api_key_android: (appSettingsDraft.revenuecat_api_key_android || '').trim(),
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

    const handleTestAvelutSettings = async () => {
        const modelToTest = (appSettingsDraft.openrouter_model || 'qwen/qwen3.7-flash').trim();
        const apiKeyToTest = (appSettingsDraft.openrouter_api_key || '').trim();
        if (!apiKeyToTest) {
            addToast('Add an OpenRouter API key before running the hello test.', 'error');
            return;
        }

        setIsTestingAppSettings(true);
        try {
            const testClient = createAvelutAI({ openrouter_api_key: apiKeyToTest, openrouter_model: modelToTest });
            const response = await testClient.models.generateContent({
                model: modelToTest,
                contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
            });
            const responseText = (response as any).text ? (typeof (response as any).text === 'function' ? (response as any).text() : (response as any).text) : '';
            const preview = (responseText || '').trim();
            if (!preview) {
                throw new Error('The test returned an empty response.');
            }
            addToast(`Hello test successful: ${preview.slice(0, 120)}`, 'success');
        } catch (error: any) {
            console.error('Error testing Avelut settings:', error);
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
    const [adminUploadProgress, setAdminUploadProgress] = useState<{status: string, percent: number} | null>(null);
    const [isMigrating, setIsMigrating] = useState(false);
    const [migrationProgress, setMigrationProgress] = useState('');

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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


    const handleDeleteAllCourses = async () => {
        if (!window.confirm('Are you ABSOLUTELY SURE you want to delete ALL courses across ALL departments? This cannot be undone!')) return;
        try {
            const updates: any = {};
            allDepartments.forEach(dept => {
                updates[`departments_data/${dept.id}/course_list`] = null;
                updates[`textbook_contexts/${dept.id}`] = null;
            });
            await update(dbRef(db), updates);
            await fetchDepartments();
            addToast('All courses in the system have been deleted.', 'success');
        } catch (err: any) {
            console.error('Delete all courses error:', err);
            addToast(err.message || 'Failed to delete all courses', 'error');
        }
    };

    const handleDeleteCoursesByLevel = async () => {
        if (!window.confirm(`Are you sure you want to delete ALL courses for level ${bulkDeleteLevel} across all departments?`)) return;
        try {
            const updates: any = {};
            allDepartments.forEach(dept => {
                const existingList = dept.course_list ? normalizeCourseList(dept.course_list) : [];
                const filtered = existingList.filter(c => normalizeLevel(c.level) !== bulkDeleteLevel);
                updates[`departments_data/${dept.id}/course_list`] = filtered.length ? filtered : null;
                updates[`textbook_contexts/${dept.id}/${bulkDeleteLevel}`] = null;
            });
            await update(dbRef(db), updates);
            await fetchDepartments();
            addToast(`All ${bulkDeleteLevel} courses have been deleted.`, 'success');
        } catch (err: any) {
            console.error('Delete level courses error:', err);
            addToast(err.message || 'Failed to delete level courses', 'error');
        }
    };

    const handleDeleteCourseFromDepartment = useCallback(async (course: Course, deleteForOtherDepartments: boolean = false) => {
        if (!isManagerCourseView) return;

        const { departmentId: currentDepartmentId, level: currentLevel } = courseAdminView;

        const courseLabel = course.course_code || course.course_name || course.course_id;
        const departmentLabel = allDepartments.find((dept) => dept.id === currentDepartmentId)?.department_name || currentDepartmentId;
        
        let shouldDeleteGlobally = deleteForOtherDepartments;
        if (!deleteForOtherDepartments) {
             shouldDeleteGlobally = window.confirm(`Do you also want to delete ${courseLabel} globally from ALL departments? (Click OK for Global Delete, or Cancel to only delete from ${departmentLabel})`);
        }

        const confirmMsg = shouldDeleteGlobally
            ? `Final confirmation: Delete ${courseLabel} from ALL departments?`
            : `Final confirmation: Delete ${courseLabel} from ${departmentLabel} ONLY?`;
            
        const confirmed = window.confirm(confirmMsg + (shouldDeleteGlobally ? " This will ALSO permanently delete all associated textbook contents and outlines." : " Textbooks will be preserved."));
        if (!confirmed) return;

        try {
            const updates: Record<string, any> = {};
            const targetCourseKey = getCourseMergeKey(course) || course.course_id;

            if (shouldDeleteGlobally) {
                allDepartments.forEach(dept => {
                    const existingCourses = normalizeCourseList(dept?.course_list);
                    const nextCourses = existingCourses.filter((item) => {
                        const itemKey = getCourseMergeKey(item) || item.course_id;
                        return itemKey !== targetCourseKey;
                    });
                    
                    if (existingCourses.length !== nextCourses.length) {
                        updates[`departments_data/${dept.id}/course_list`] = nextCourses.length > 0 ? nextCourses : null;
                    }
                    updates[`textbook_contexts/${dept.id}_${course.level}_${targetCourseKey}`] = null;
                });
                updates[`textbook_contexts/shared/${targetCourseKey}`] = null;
            } else {
                const departmentRef = dbRef(db, `departments_data/${currentDepartmentId}`);
                const departmentSnapshot = await get(departmentRef);
                const existingCourses = normalizeCourseList(departmentSnapshot.val()?.course_list);
                const nextCourses = existingCourses.filter((item) => {
                    const itemKey = getCourseMergeKey(item) || item.course_id;
                    return itemKey !== targetCourseKey;
                });
                updates[`departments_data/${currentDepartmentId}/course_list`] = nextCourses.length > 0 ? nextCourses : null;
            }

            await update(dbRef(db), updates);

            await fetchDepartments();
            await loadDepartmentCourses(currentDepartmentId);
            handleCourseTabNavigate(buildCourseManagerPath(currentDepartmentId, currentLevel));
            addToast(`Deleted ${course.course_name} from ${deleteForOtherDepartments ? 'all applicable departments' : departmentLabel}.`, 'success');
        } catch (error: any) {
            console.error('Error deleting course:', error);
            addToast(error?.message || 'Failed to delete course', 'error');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addToast, allDepartments, courseAdminView, isManagerCourseView, loadDepartmentCourses]);

    const handleBatchDeleteCourses = useCallback(async (courses: Course[], deleteForOtherDepartments: boolean = false) => {
        if (!isManagerCourseView || courses.length === 0) return;

        const { departmentId: currentDepartmentId } = courseAdminView;
        
        let shouldDeleteGlobally = deleteForOtherDepartments;
        if (!deleteForOtherDepartments) {
             shouldDeleteGlobally = window.confirm(`Do you also want to delete these ${courses.length} courses globally from ALL departments? (Click OK for Global Delete, or Cancel to only delete from the current department)`);
        }

        const confirmMsg = shouldDeleteGlobally
            ? `Final confirmation: Delete ${courses.length} selected courses from ALL departments globally?`
            : `Final confirmation: Delete ${courses.length} selected courses from ${currentDepartmentId}?`;
            
        const confirmed = window.confirm(confirmMsg + (shouldDeleteGlobally ? " This will ALSO permanently delete all associated textbook contents and outlines." : " Textbooks will be preserved."));
        if (!confirmed) return;

        try {
            const updates: Record<string, any> = {};

            if (shouldDeleteGlobally) {
                allDepartments.forEach(dept => {
                    const existingCourses = normalizeCourseList(dept?.course_list);
                    const targetCourseKeys = new Set(courses.map(c => getCourseMergeKey(c) || c.course_id));
                    const nextCourses = existingCourses.filter(item => {
                        const itemKey = getCourseMergeKey(item) || item.course_id;
                        return !targetCourseKeys.has(itemKey);
                    });
                    
                    if (existingCourses.length !== nextCourses.length) {
                        updates[`departments_data/${dept.id}/course_list`] = nextCourses.length > 0 ? nextCourses : null;
                    }
                    courses.forEach(c => {
                        const targetKey = getCourseMergeKey(c) || c.course_id;
                        updates[`textbook_contexts/${dept.id}_${c.level}_${targetKey}`] = null;
                        updates[`textbook_contexts/shared/${targetKey}`] = null;
                    });
                });
            } else {
                const departmentRef = dbRef(db, `departments_data/${currentDepartmentId}`);
                const departmentSnapshot = await get(departmentRef);
                const existingCourses = normalizeCourseList(departmentSnapshot.val()?.course_list);
                const targetCourseKeys = new Set(courses.map(c => getCourseMergeKey(c) || c.course_id));
                const nextCourses = existingCourses.filter(item => {
                    const itemKey = getCourseMergeKey(item) || item.course_id;
                    return !targetCourseKeys.has(itemKey);
                });
                updates[`departments_data/${currentDepartmentId}/course_list`] = nextCourses.length > 0 ? nextCourses : null;
            }

            await update(dbRef(db), updates);
            
            // Clean up selections
            if (deleteForOtherDepartments) {
                // If on global search, refresh data
            } else {
                handleCourseTabNavigate(buildCourseManagerPath(currentDepartmentId, courseAdminView.level));
            }
            
            addToast(`Successfully deleted ${courses.length} courses.`, 'success');
            await fetchDepartments();
            if (!deleteForOtherDepartments) await loadDepartmentCourses(currentDepartmentId);
        } catch (error: any) {
            addToast('Failed to batch delete courses: ' + error.message, 'error');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [courseAdminView, allDepartments, isManagerCourseView, getCourseMergeKey, addToast, fetchDepartments, loadDepartmentCourses]);

    const handleDeleteCourseTopics = useCallback(async (course: Course, topicIds: string[]) => {
        if (!course || !topicIds.length) return;

        const courseKey = getCourseMergeKey(course) || course.course_id;
        if (!courseKey) {
            addToast('Unable to identify the selected course.', 'error');
            return;
        }

        const selectedTopicIds = Array.from(new Set(topicIds.filter(Boolean)));
        const confirmed = window.confirm(
            `Delete ${selectedTopicIds.length} topic${selectedTopicIds.length === 1 ? '' : 's'} from ${course.course_name}? This will update the shared syllabus for every department using this course.`
        );
        if (!confirmed) return;

        try {
            const sharedRef = dbRef(db, `textbook_contexts/shared/${courseKey}`);
            const sharedSnapshot = await get(sharedRef);
            const sharedData = sharedSnapshot.exists() ? sharedSnapshot.val() : {};
            const existingTopics = Array.isArray(sharedData?.syllabus)
                ? sharedData.syllabus
                : Array.isArray(course.topics)
                    ? course.topics
                    : [];

            const selectedTopicSet = new Set(selectedTopicIds);
            const remainingTopics = existingTopics
                .filter((topic: Partial<Topic>) => {
                    const topicKey = (topic?.topic_id || normalizeTopicId(topic?.topic_name || '')).toString();
                    return !selectedTopicSet.has(topicKey);
                })
                .map((topic: Partial<Topic>, index: number) => sanitizeTopicMetadata(topic, index));

            const updates: Record<string, any> = {
                [`textbook_contexts/shared/${courseKey}/syllabus`]: remainingTopics,
            };

            allDepartments.forEach((dept) => {
                const existingCourses = normalizeCourseList(dept?.course_list);
                let changed = false;
                const nextCourses = existingCourses.map((existingCourse) => {
                    const isTargetCourse = getCourseMergeKey(existingCourse) === courseKey || existingCourse.course_id === course.course_id;
                    if (!isTargetCourse) return existingCourse;
                    changed = true;
                    return {
                        ...existingCourse,
                        topics: remainingTopics,
                        textbook_shared_key: courseKey,
                    };
                });

                if (changed) {
                    updates[`departments_data/${dept.id}/course_list`] = nextCourses;
                }
            });

            await update(dbRef(db), updates);
            await fetchDepartments();
            addToast(`Deleted ${selectedTopicIds.length} topic${selectedTopicIds.length === 1 ? '' : 's'} from ${course.course_name}.`, 'success');
        } catch (error: any) {
            console.error('Error deleting topics:', error);
            addToast(error?.message || 'Failed to delete selected topics.', 'error');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addToast, allDepartments, fetchDepartments, getCourseMergeKey]);

    const handleGoogleDrivePick = (onFilesSelected: (files: File[]) => void) => {
        openPicker({
            clientId: appSettings.google_client_id || '',
            apiKey: appSettings.google_api_key || '',
            onFilesSelected
        });
    };

    const handleRemoveDuplicateTopicsForCourse = useCallback(async (course: Course) => {
        if (!course) return;

        const courseKey = getCourseMergeKey(course) || course.course_id;
        if (!courseKey) {
            addToast('Unable to identify the selected course.', 'error');
            return;
        }

        const sharedRef = dbRef(db, `textbook_contexts/shared/${courseKey}`);
        const sharedSnapshot = await get(sharedRef);
        const sharedData = sharedSnapshot.exists() ? sharedSnapshot.val() : {};
        const existingTopics = Array.isArray(sharedData?.syllabus)
            ? sharedData.syllabus
            : Array.isArray(course.topics)
                ? course.topics
                : [];

        const seenTopicKeys = new Set<string>();
        const dedupedTopics = existingTopics.filter((topic: Partial<Topic>) => {
            const topicKey = normalizeTopicId((topic?.topic_id || topic?.topic_name || '').toString().trim());
            if (!topicKey) return true;
            if (seenTopicKeys.has(topicKey)) return false;
            seenTopicKeys.add(topicKey);
            return true;
        }).map((topic: Partial<Topic>, index: number) => sanitizeTopicMetadata(topic, index));

        const duplicateCount = existingTopics.length - dedupedTopics.length;
        if (!duplicateCount) {
            addToast(`No duplicate topics found for ${course.course_name}.`, 'info');
            return;
        }

        const confirmed = window.confirm(`Remove ${duplicateCount} duplicate topic${duplicateCount === 1 ? '' : 's'} from ${course.course_name}?`);
        if (!confirmed) return;

        const updates: Record<string, any> = {
            [`textbook_contexts/shared/${courseKey}/syllabus`]: dedupedTopics,
        };

        allDepartments.forEach((dept) => {
            const existingCourses = normalizeCourseList(dept?.course_list);
            let changed = false;
            const nextCourses = existingCourses.map((existingCourse) => {
                const isTargetCourse = getCourseMergeKey(existingCourse) === courseKey || existingCourse.course_id === course.course_id;
                if (!isTargetCourse) return existingCourse;
                changed = true;
                return {
                    ...existingCourse,
                    topics: dedupedTopics,
                    textbook_shared_key: courseKey,
                };
            });

            if (changed) {
                updates[`departments_data/${dept.id}/course_list`] = nextCourses;
            }
        });

        await update(dbRef(db), updates);
        await fetchDepartments();
        addToast(`Removed ${duplicateCount} duplicate topic${duplicateCount === 1 ? '' : 's'} from ${course.course_name}.`, 'success');
    }, [addToast, allDepartments, fetchDepartments, getCourseMergeKey]);

    const resolvePastQuestionTarget = useCallback((providedDepartmentId: string, providedLevel: string, providedCourseName: string, inferredMetadata?: any) => {
        const normalizeText = (value: any) => (value || '').toString().trim();
        const inferredDepartment = normalizeText(inferredMetadata?.department || inferredMetadata?.dept);
        const inferredLevel = normalizeText(inferredMetadata?.level);
        const inferredCourse = normalizeText(inferredMetadata?.courseName || inferredMetadata?.course_name || inferredMetadata?.course || inferredMetadata?.courseCode || inferredMetadata?.course_code);

        const matchedDepartment = providedDepartmentId
            ? allDepartments.find((dept) => dept.id === providedDepartmentId)
            : (inferredDepartment
                ? allDepartments.find((dept) => {
                    const labels = [dept.department_name, dept.id, dept.short_name].filter(Boolean).map((label: string) => label.toString().toLowerCase());
                    return labels.some((label) => label.includes(inferredDepartment.toLowerCase()));
                })
                : undefined);

        return {
            departmentId: matchedDepartment?.id || providedDepartmentId || (inferredDepartment ? normalizeTopicId(inferredDepartment) : 'unassigned'),
            level: providedLevel || inferredLevel || 'unassigned',
            courseName: providedCourseName || inferredCourse || 'unassigned_course',
        };
    }, [allDepartments]);

    const handleAddQuestion = async () => {
        if (!year || !newQuestion.question || !newQuestion.correctAnswer) {
            addToast("Please fill the required fields including the year", "error");
            return;
        }

        try {
            const target = resolvePastQuestionTarget(uploadDepartmentId, uploadLevel, uploadCourseName);
            const pqRef = dbRef(db, `past_questions/${target.departmentId}/${target.level}/${target.courseName}/${year}`);
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
        if (!pqFile || !year) {
            addToast("Please select a PDF file and enter a year", "error");
            return;
        }
        if (!ai) {
            addToast("AI features are unavailable because the Avelut AI API key is not configured in App Controls.", "error");
            return;
        }

        setIsPQProcessing(true);
        const extractionModel = getFeatureModel('ai_quiz_generation', appSettings);
        setExtractionProgress(`Extracting questions with ${extractionModel}...`);

        try {
            const reader = new FileReader();
            reader.readAsDataURL(pqFile);
            
            const base64PDF = await new Promise<string>((resolve) => {
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
            });

            const prompt = `Analyze this PDF containing past exam questions for ${uploadCourseName ? `"${uploadCourseName}"` : 'the uploaded exam'} (${year}). If the document shows a course title, course code, department, or level, extract that information too. If the admin did not provide a course or level, infer it directly from the PDF when possible.
            Extract ALL multiple-choice questions into a structured JSON object.
            
            RULES:
            1. Output ONLY a JSON object.
            2. Include: questions (array), courseCode (string or null), courseName (string or null), level (string or null), department (string or null), sourceYear (string or null).
            3. Each question object must have: question, options (array of 4 strings), correctAnswer (the exact string of the correct option), and explanation (brief reasoning).
            4. Ensure the correctAnswer exactly matches one of the strings in the options array.

            FORMAT:
            {
                "questions": [
                    {
                        "question": "What is...?",
                        "options": ["A", "B", "C", "D"],
                        "correctAnswer": "A",
                        "explanation": "Because..."
                    }
                ],
                "courseCode": "CS101",
                "courseName": "Introduction to Programming",
                "level": "100lvl",
                "department": "Computer Science",
                "sourceYear": "2023"
            }`;

            const response = await ai.models.generateContent({
                model: extractionModel,
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
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            questions: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        question: { type: Type.STRING },
                                        options: { type: Type.ARRAY, items: { type: Type.STRING } },
                                        correctAnswer: { type: Type.STRING },
                                        explanation: { type: Type.STRING }
                                    },
                                    required: ['question', 'options', 'correctAnswer', 'explanation']
                                }
                            }
                        },
                        required: ['questions']
                    }
                }
            });

            const responseText = (response as any).text || '';
            if (!responseText) {
                throw new Error("AI returned an empty response while extracting questions.");
            }
            const responseData = JSON.parse(responseText);
            const extractedQuestions = Array.isArray(responseData.questions) ? responseData.questions : [];

            if (extractedQuestions.length === 0) throw new Error("No questions found in the PDF.");

            const target = resolvePastQuestionTarget(uploadDepartmentId, uploadLevel, uploadCourseName, responseData);
            setExtractionProgress(`Saving ${extractedQuestions.length} questions to database...`);

            const pqRef = dbRef(db, `past_questions/${target.departmentId}/${target.level}/${target.courseName}/${year}`);
            
            // Push each question individually
            for (const q of extractedQuestions) {
                const newPQRef = push(pqRef);
                await set(newPQRef, q);
            }

            addToast(`Successfully extracted and saved ${extractedQuestions.length} questions under ${target.courseName}!`, "success");
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
            addToast("AI features are unavailable because the Avelut AI API key is not configured in App Controls.", "error");
            return;
        }

        setIsCourseImporting(true);
        const extractionModel = getFeatureModel('study_guide_extraction', appSettings);
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
   - level (CRITICAL: Look at the student header or level written on the form, e.g. "100 Level", "200 Level", "300 Level", "400 Level", "500 Level". Output strictly as "100lvl", "200lvl", "300lvl", "400lvl", or "500lvl". If course codes are 200-series like CPE 211, level is "200lvl").
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
  "level": "200lvl",
  "courses": [
    {
      "code": "CPE 211",
      "title": "CIRCUIT THEORY",
      "semester": "first",
      "unit": 3,
      "status": "C"
    }
  ]
}`;

                const response = await ai.models.generateContent({
                    model: extractionModel,
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
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                academic_session: { type: Type.STRING },
                                level: { type: Type.STRING },
                                courses: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            code: { type: Type.STRING },
                                            title: { type: Type.STRING },
                                            semester: { type: Type.STRING },
                                            unit: { type: Type.INTEGER },
                                            status: { type: Type.STRING }
                                        },
                                        required: ['code', 'title', 'semester']
                                    }
                                }
                            },
                            required: ['academic_session', 'level', 'courses']
                        }
                    }
                });

                const responseText = (response as any).text || '';
                if (!responseText) {
                    throw new Error("AI returned an empty response while extracting courses.");
                }

                const responseData = JSON.parse(responseText);
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

    const handleCourseCSVImport = async (parsedCourses: Course[]) => {
        const selectedDepartmentIds = courseImportTargetMode === 'all'
            ? allDepartments.map((dept) => dept.id)
            : getUniqueIds(courseImportDepartmentIds);
        if (!selectedDepartmentIds.length) {
            addToast("Please select at least one target department", "error");
            return;
        }

        setIsCourseImporting(true);
        setCourseImportProgress("Applying imported CSV courses to selected departments...");

        try {
            let normalizedImportedCourses: Course[] = [];
            
            const normalizedCourses = parsedCourses
                .map((course: any, index: number) => sanitizeCourseFromRegistrationForm(
                    course,
                    index,
                    course.level || courseImportLevelOverride || "100lvl",
                    courseImportSessionOverride || "2024/2025",
                    courseImportLevelOverride,
                    courseImportSessionOverride
                ))
                .filter((course: Course) => Boolean(course.course_id && course.course_name));

            normalizedCourses.forEach((course: Course) => {
                normalizedImportedCourses = upsertCourseInList(normalizedImportedCourses, course);
            });

            if (!normalizedImportedCourses.length) {
                throw new Error("No valid courses found in the CSV. Please check the format.");
            }

            const updates: Record<string, Course[]> = {};

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

            addToast(
                `Successfully imported ${importedList.length} CSV course(s) to ${selectedDepartmentIds.length} department(s).`,
                "success"
            );
        } catch (error: any) {
            console.error("Error importing course CSV:", error);
            addToast(error?.message || "Failed to import course CSV.", "error");
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
            addToast("AI features are unavailable because the Avelut AI API key is not configured in App Controls.", "error");
            return;
        }
        const sourceCourseList = overrideCourseList || coursesList;
        const selectedCourse = sourceCourseList.find(c => c.course_id === courseId || getCourseMergeKey(c) === courseId);
        if (!selectedCourse) {
            addToast("Missing file or course information", "error");
            return;
        }
        let syncDepartmentIds = getUniqueIds(overrideDepartmentIds || [departmentId, ...targetDepartmentIds]);

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
        setAdminUploadProgress({ status: `Uploading 1/${pdfFiles.length} to storage...`, percent: 5 });

        try {
            const uploadedUrls: string[] = [];

            for (let index = 0; index < pdfFiles.length; index++) {
                const file = pdfFiles[index];
                setAdminUploadProgress({ status: `Uploading ${index + 1}/${pdfFiles.length} to storage...`, percent: 10 + (index * 5) });

                // 1. Upload to Firebase Storage
                const uploadToken = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                    ? crypto.randomUUID()
                    : `${Date.now()}_${typeof performance !== 'undefined' ? performance.now().toString().replace('.', '_') : '0'}_${index}_${file.lastModified}_${file.size}`;
                const fileRef = storageRef(storage, `textbooks/${primaryDepartmentId}/${level}/${course_name}/${uploadToken}_${file.name}`);
                const uploadResult = await uploadBytes(fileRef, file);
                const downloadURL = await getDownloadURL(uploadResult.ref);
                uploadedUrls.push(downloadURL);
            }

            setAdminUploadProgress({ status: 'Saving to database...', percent: 40 });

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
            const mergedSharedSyllabus: any[] = [];
            const primaryPdfUrl = selectPrimaryPdfUrl(uploadedUrls, existingShared?.pdf_url, mergedSharedPdfUrls);

            // Write canonical shared textbook data
            await set(sharedTextbookRef, {
                ...existingShared,
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
                const coursesForTargetDepartment = isPrimaryDepartmentTarget ? (overrideCourseList || existingDepartmentCourses) : existingDepartmentCourses;

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
            }

            addToast(`${uploadedUrls.length} textbook${uploadedUrls.length > 1 ? 's' : ''} for ${course_name} synced!`, "success");
            await fetchDepartments();

            // 💡 PINECONE VECTOR SYNC TRIGGER
            setAdminUploadProgress({ status: "Preparing vector extraction...", percent: 50 });
            try {
                const { extractTextFromPDF } = await import('../utils/pdfExtraction');
                const { ingestTextToPinecone } = await import('../utils/pinecone');

                let rawText = '';
                if (files && files.length > 0) {
                    setAdminUploadProgress({ status: 'Extracting textbook content locally...', percent: 60 });
                    rawText = await extractTextFromPDF(files[0]);
                } else if (primaryPdfUrl) {
                    setAdminUploadProgress({ status: 'Downloading remote textbook for extraction...', percent: 60 });
                    const response = await fetch(primaryPdfUrl);
                    if (!response.ok) throw new Error("Failed to download remote PDF");
                    const blob = await response.blob();
                    setAdminUploadProgress({ status: 'Extracting textbook content...', percent: 65 });
                    rawText = await extractTextFromPDF(blob);
                }

                if (rawText) {
                    setAdminUploadProgress({ status: 'Syncing to Pinecone database...', percent: 70 });
                    const ingestResult = await ingestTextToPinecone(
                        rawText,
                        courseKey,
                        course_name,
                        level,
                        selectedCourse.semester || '',
                        appSettings,
                        (progress) => {
                            let percent = 80;
                            if (progress.includes('Split text')) percent = 75;
                            if (progress.includes('Upserting chunks')) {
                                const match = progress.match(/Upserting chunks batch to Pinecone \((\d+)\/(\d+)\)/);
                                if (match) {
                                    const current = parseInt(match[1]);
                                    const total = parseInt(match[2]);
                                    percent = 75 + Math.round((current / total) * 25);
                                }
                            }
                            setAdminUploadProgress({ status: progress, percent });
                        }
                    );

                    if (!ingestResult.success) throw new Error(ingestResult.message || "Vector ingestion failed.");
                    addToast("Semantic chunk maps upserted to Pinecone index successfully!", "success");
                }
            } catch (vectorErr: any) {
                console.error("Vector sync failed:", vectorErr);
                addToast("Textbook stored, but vector chunk sync failed.", "info");
            }
        } catch (error: any) {
            console.error('Upload error:', error);
            addToast(`Upload failed: ${error.message}`, "error");
        } finally {
            setIsUploading(false);
            setAdminUploadProgress(null);
        }
    };

    const handleMassVectorMigration = async () => {
        if (!appSettingsDraft.pinecone_api_key) {
            addToast("Pinecone API key is required for migration.", "error");
            return;
        }

        const confirmMigration = window.confirm("This will download all existing textbook PDFs across all departments and ingest them into Pinecone. This may take a very long time and consume Pinecone read/write capacity. Are you sure?");
        if (!confirmMigration) return;

        setIsMigrating(true);
        setMigrationProgress("Starting migration...");
        try {
            const { extractTextFromPDF } = await import('../utils/pdfExtraction');
            const { ingestTextToPinecone } = await import('../utils/pinecone');

            // Find all unique courses with a textbook URL across all shared textbooks
            const sharedTextbooksSnapshot = await get(dbRef(db, 'shared_textbooks'));
            const coursesToMigrate = new Map<string, any>();
            
            if (sharedTextbooksSnapshot.exists()) {
                const sharedData = sharedTextbooksSnapshot.val();
                Object.keys(sharedData).forEach(key => {
                    const data = sharedData[key];
                    const url = data.pdf_url || (data.pdf_urls && data.pdf_urls.length > 0 ? data.pdf_urls[0] : null);
                    if (url) {
                        coursesToMigrate.set(key, { ...data, url, key });
                    }
                });
            }

            const total = coursesToMigrate.size;
            if (total === 0) {
                addToast("No textbooks found to migrate.", "info");
                setIsMigrating(false);
                return;
            }

            let current = 0;
            let successCount = 0;
            let failCount = 0;

            for (const [key, courseData] of coursesToMigrate.entries()) {
                current++;
                setMigrationProgress(`Migrating ${current}/${total}: ${courseData.course_name || key}...`);
                try {
                    const response = await fetch(courseData.url);
                    if (!response.ok) throw new Error("Failed to download PDF");
                    const blob = await response.blob();
                    
                    setMigrationProgress(`Extracting text for ${courseData.course_name || key}...`);
                    const rawText = await extractTextFromPDF(blob);
                    
                    setMigrationProgress(`Ingesting vectors for ${courseData.course_name || key}...`);
                    const ingestResult = await ingestTextToPinecone(
                        rawText,
                        key,
                        courseData.course_name || 'Unknown Course',
                        courseData.level || '100',
                        courseData.semester || 'First',
                        appSettingsDraft,
                        (progress) => setMigrationProgress(`[${current}/${total}] ${progress}`)
                    );
                    if (ingestResult.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (err: any) {
                    console.error(`Migration failed for ${courseData.course_name || key}:`, err);
                    failCount++;
                }
            }

            addToast(`Migration complete! Success: ${successCount}, Failed: ${failCount}`, successCount > 0 ? "success" : "info");
        } catch (error: any) {
            console.error("Migration error:", error);
            addToast("Migration process encountered a fatal error.", "error");
        } finally {
            setIsMigrating(false);
            setMigrationProgress('');
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



    const globalLevelCourses = useMemo(() => {
        if (courseAdminView.mode === 'global-list' || courseAdminView.mode === 'global-detail') {
            const level = courseAdminView.level;
            return courseCatalog.filter(entry => entry.course.level === level);
        }
        return [];
    }, [courseAdminView, courseCatalog]);

    const selectedGlobalCourseEntry = useMemo(() => {
        if (courseAdminView.mode === 'global-detail') {
            return globalLevelCourses.find(entry => 
                entry.course.course_id === courseAdminView.courseId || 
                getCourseMergeKey(entry.course) === courseAdminView.courseId
            ) || null;
        }
        return null;
    }, [courseAdminView, globalLevelCourses]);

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
    const handleForceGlobalRefresh = async () => {
        if (!window.confirm("WARNING: This will force ALL active users to clear their cache and reload the application. This action cannot be undone. Do you want to proceed?")) {
            return;
        }
        try {
            const refreshRef = dbRef(db, 'system_signals/force_refresh_timestamp');
            await set(refreshRef, Date.now());
            addToast("Global refresh signal sent to all devices.", "success");
        } catch (error) {
            console.error("Failed to send global refresh signal:", error);
            addToast("Failed to send refresh signal.", "error");
        }
    };

    const isCourseImportDisabled = (
        isCourseImporting ||
        !courseRegistrationFiles.length ||
        !courseImportLevelOverride ||
        (courseImportTargetMode === 'selected' && !courseImportDepartmentIds.length)
    );

    const handleCourseTabNavigate = useCallback((pathOrTab: string) => {
        setIsMobileSidebarOpen(false);
        const fullPath = pathOrTab.startsWith('/') ? pathOrTab : `/admin/${pathOrTab}`;
        if (onNavigate) {
            // Let parent know, but also keep internal pathname in sync
            try { onNavigate(fullPath); } catch (err) { /* ignore parent handler errors */ }
            setInternalPathname(fullPath);
            return;
        }
        if (typeof window !== 'undefined') {
            window.history.pushState(null, '', fullPath);
        }
        setInternalPathname(fullPath);
    }, [onNavigate]);

    const isSuperAdmin = userProfile.role === 'superadmin' || userProfile.is_admin;
    const isDeptAdmin = userProfile.role === 'deptadmin';
    const hasAdminAccess = isSuperAdmin || isDeptAdmin;

    if (!hasAdminAccess) {
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

    const scopedDepartments = isSuperAdmin 
        ? allDepartments 
        : allDepartments.filter(d => (userProfile.admin_department_ids || []).includes(d.id));

    const scopedUsersList = isSuperAdmin 
        ? allUsersList 
        : allUsersList.filter(u => u.department_id && (userProfile.admin_department_ids || []).includes(u.department_id));

    if (isAppSettingsLoading || isInitialDataLoading) {
        return <div className="flex h-screen items-center justify-center font-bold text-slate-500">Loading Admin Panel...</div>;
    }

    return (
        <AdminLayout
            userProfile={userProfile}
            activeTab={activeTab}
            onNavigate={handleCourseTabNavigate}
        >
            {activeTab === 'dashboard' && (
                <DashboardView 
                    paymentLogs={paymentLogs} 
                    aiRequestLogs={aiRequestLogs} 
                    allUsersList={scopedUsersList} 
                    onNavigate={handleCourseTabNavigate}
                />
            )}
            
            {(activeTab === 'schools' || activeTab === 'departments') && (
                <AcademicUnitsView pathname={resolvedPathname} onNavigate={handleCourseTabNavigate} />
            )}


            {activeTab === 'questions' && (
                <PastQuestionsView 
                    allDepartments={scopedDepartments}
                    LEVELS={LEVELS as any}
                    uploadDepartmentId={uploadDepartmentId}
                    setUploadDepartmentId={setUploadDepartmentId}
                    uploadLevel={uploadLevel}
                    setUploadLevel={setUploadLevel}
                    filteredGlobalCourses={filteredGlobalCourses}
                    uploadCourseName={uploadCourseName}
                    setUploadCourseName={setUploadCourseName}
                    year={year}
                    setYear={setYear}
                    pqFile={pqFile}
                    setPqFile={setPqFile as any}
                    isPQProcessing={isPQProcessing}
                    extractionProgress={extractionProgress}
                    handleGoogleDrivePick={handleGoogleDrivePick}
                    handlePQUpload={handlePQUpload}
                    newQuestion={newQuestion}
                    setNewQuestion={setNewQuestion}
                    handleAddQuestion={handleAddQuestion}
                />
            )}

            {activeTab === 'users' && (
                <UserControlView 
                    allUsersList={scopedUsersList}
                    isUsersLoading={isUsersLoading}
                    refreshUsers={fetchUsers}
                    currentUserProfile={userProfile}
                    allDepartments={allDepartments}
                />
            )}

            {(activeTab === 'payments' || activeTab === 'usage-analytics' || activeTab === 'purchase-logs') && (
                <PaymentsAndUsageView 
                    paymentLogs={paymentLogs}
                    aiRequestLogs={aiRequestLogs}
                    allUsersList={scopedUsersList}
                />
            )}

            {(activeTab === 'app' || activeTab === 'email-configs' || activeTab === 'usage-settings') && (
                <SystemSettingsView />
            )}

            {activeTab === 'app-updates' && (
                <div className="space-y-8">
                    <AppVersionUpdateView />
                    <AdminUpdates />
                </div>
            )}

            {activeTab === 'notifications' && (
                <NotificationsView
                    allUsersList={scopedUsersList}
                    aiApiKey={aiApiKey}
                    aiModel={aiModel}
                    refreshSentNotifications={fetchSentNotifications}
                />
            )}

            {activeTab === 'emails' && (
                <EmailsView
                    allUsersList={allUsersList}
                    refreshSentEmails={fetchSentEmails}
                />
            )}

            {activeTab === 'tickets' && <TicketsView />}
            {activeTab === 'cofounders' && <CoFoundersView />}
            {activeTab === 'seo' && <SEOSettingsView />}
            {activeTab === 'feedback' && <FeedbackView />}
            {activeTab === 'github-integration' && <GitHubIntegrationView />}
        </AdminLayout>
    );
};
