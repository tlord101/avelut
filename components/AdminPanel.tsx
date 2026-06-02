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

type AdminTab = 'questions' | 'courses' | 'users' | 'departments' | 'app';

type CourseAdminView =
    | { mode: 'global' }
    | { mode: 'manager-root' }
    | { mode: 'add'; departmentId?: string; level?: string }
    | { mode: 'manager-list'; departmentId: string; level: string }
    | { mode: 'manager-detail'; departmentId: string; level: string; courseId: string };

const DEFAULT_VISIBLE_TABS: AdminTab[] = ['departments', 'courses', 'questions', 'users', 'app'];

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
            : (visibleTabs[0] || 'departments');
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
        return <div className="p-8 text-center text-red-600 font-bold">Access Denied. Admins only.</div>;
    }

    return (
        <div className="flex flex-col p-4 sm:p-6 bg-white rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Admin Control Panel</h2>
            
            <div className="flex gap-4 mb-6 border-b border-gray-200 pb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {visibleTabs.includes('departments') && (
                    <button 
                        onClick={() => handleCourseTabNavigate('/admin')}
                        className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'departments' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                    >
                        Departments
                    </button>
                )}
                {visibleTabs.includes('courses') && (
                    <button 
                        onClick={() => handleCourseTabNavigate('/admin/courses/manager')}
                        className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'courses' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                    >
                        Courses
                    </button>
                )}
                {visibleTabs.includes('questions') && (
                    <button 
                        onClick={() => handleCourseTabNavigate('/admin/questions')}
                        className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'questions' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                    >
                        Past Questions
                    </button>
                )}
                {visibleTabs.includes('users') && (
                    <button 
                        onClick={() => handleCourseTabNavigate('/admin/users')}
                        className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'users' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                    >
                        User Management
                    </button>
                )}
                {visibleTabs.includes('app') && (
                    <button 
                        onClick={() => handleCourseTabNavigate('/admin/app')}
                        className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'app' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                    >
                        App Controls
                    </button>
                )}
            </div>

            {activeTab === 'app' && (
                <div className="space-y-6 max-w-3xl">
                    <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-5">
                        <div>
                            <h3 className="text-xl font-black text-gray-900">App Controls</h3>
                            <p className="text-sm text-gray-500">Pause uploads, switch on coming soon mode, and configure Gemini model + API key from Firebase.</p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
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

                            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
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

                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={handleSaveAppSettings}
                                disabled={isSavingAppSettings}
                                className="rounded-xl bg-lime-600 px-5 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-lime-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSavingAppSettings ? 'Saving...' : 'Save App Settings'}
                            </button>
                            <button
                                type="button"
                                onClick={handleTestGeminiSettings}
                                disabled={isTestingAppSettings}
                                className="rounded-xl border border-lime-200 bg-lime-50 px-5 py-3 text-sm font-black uppercase tracking-widest text-lime-700 hover:bg-lime-100 disabled:cursor-not-allowed disabled:opacity-60"
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
                    <div className="bg-white p-6 rounded-2xl border border-gray-200">
                        <h3 className="font-bold text-gray-800 mb-4">Add New Department</h3>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <input 
                                type="text" 
                                placeholder="Department Name (e.g., Computer Science)" 
                                value={newDeptName} 
                                onChange={e => setNewDeptName(e.target.value)}
                                className="flex-1 p-2 border rounded-lg"
                            />
                            <button 
                                onClick={handleAddDepartment}
                                className="w-full sm:w-auto px-6 py-2 bg-lime-600 text-white rounded-lg font-bold hover:bg-lime-700"
                            >
                                Add
                            </button>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-gray-200">
                        <h3 className="font-bold text-gray-800 mb-4">Existing Departments</h3>
                        <div className="space-y-2">
                            {allDepartments.map(dept => (
                                <div key={dept.id} className="p-3 border rounded-lg flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-center">
                                    <span>{dept.department_name}</span>
                                    <span className="text-xs text-gray-500">{dept.levels?.join(', ')}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'questions' && (
                <div className="space-y-8 max-w-2xl">
                    {/* Automated Upload Section */}
                    <div className="bg-lime-50 p-6 rounded-2xl border border-lime-200">
                        <h3 className="font-bold text-lime-800 mb-2 flex items-center gap-2">
                            <span>✨</span> Automated PDF Extraction
                        </h3>
                        <p className="text-sm text-lime-700 mb-4">
                            Upload a PDF of past questions to automatically populate the question bank.
                        </p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                            <select 
                                value={uploadDepartmentId} 
                                onChange={e => setUploadDepartmentId(e.target.value)}
                                className="p-2 border rounded-lg bg-white"
                            >
                                <option value="">Select Department</option>
                                {allDepartments.map(dept => (
                                    <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                                ))}
                            </select>
                            <select 
                                value={uploadLevel} 
                                onChange={e => setUploadLevel(e.target.value)}
                                className="p-2 border rounded-lg bg-white"
                            >
                                <option value="">Select Level</option>
                                {LEVELS.map(lvl => (
                                    <option key={lvl} value={lvl}>{lvl}</option>
                                ))}
                            </select>
                            <input 
                                type="text" placeholder="Course Name (e.g., Mathematics)" 
                                value={uploadCourseName} onChange={e => setUploadCourseName(e.target.value)}
                                className="p-2 border rounded-lg bg-white"
                            />
                            <input 
                                type="text" placeholder="Year (e.g., 2023)" 
                                value={year} onChange={e => setYear(e.target.value)}
                                className="p-2 border rounded-lg bg-white"
                            />
                        </div>

                        <div className="flex flex-col gap-3">
                            <input 
                                type="file" 
                                accept="application/pdf"
                                onChange={e => setPqFile(e.target.files?.[0] || null)}
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-lime-100 file:text-lime-700 hover:file:bg-lime-200"
                            />
                            {isPQProcessing && (
                                <div className="flex items-center gap-1.5 text-lime-600 text-sm font-medium">
                                    <span className="animate-spin">⏳</span>
                                    <span>{extractionProgress}</span>
                                </div>
                            )}
                            <button 
                                onClick={handlePQUpload}
                                disabled={isPQProcessing || !pqFile}
                                className={`w-full py-3 rounded-xl font-bold transition ${isPQProcessing || !pqFile ? 'bg-gray-300 cursor-not-allowed' : 'bg-lime-600 text-white hover:bg-lime-700 shadow-sm'}`}
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
                            <span className="px-3 bg-white text-sm text-gray-500 font-medium">OR MANUAL ENTRY</span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <select 
                                value={uploadDepartmentId} 
                                onChange={e => setUploadDepartmentId(e.target.value)}
                                className="p-2 border rounded-lg bg-white"
                            >
                                <option value="">Select Department</option>
                                {allDepartments.map(dept => (
                                    <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                                ))}
                            </select>
                            <select 
                                value={uploadLevel} 
                                onChange={e => setUploadLevel(e.target.value)}
                                className="p-2 border rounded-lg bg-white"
                            >
                                <option value="">Select Level</option>
                                {LEVELS.map(lvl => (
                                    <option key={lvl} value={lvl}>{lvl}</option>
                                ))}
                            </select>
                            <input 
                                type="text" placeholder="Course Name" 
                                value={uploadCourseName} onChange={e => setUploadCourseName(e.target.value)}
                                className="p-2 border rounded-lg"
                            />
                            <input 
                                type="text" placeholder="Year" 
                                value={year} onChange={e => setYear(e.target.value)}
                                className="p-2 border rounded-lg"
                            />
                        </div>
                        <textarea 
                            placeholder="Question Content" 
                            value={newQuestion.question} 
                            onChange={e => setNewQuestion({...newQuestion, question: e.target.value})}
                            className="w-full p-2 border rounded-lg h-24"
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
                                    className="p-2 border rounded-lg"
                                />
                            ))}
                        </div>
                        <input 
                            type="text" placeholder="Correct Answer (Exact string match)" 
                            value={newQuestion.correctAnswer} 
                            onChange={e => setNewQuestion({...newQuestion, correctAnswer: e.target.value})}
                            className="w-full p-2 border rounded-lg"
                        />
                        <textarea 
                            placeholder="Explanation (Optional)" 
                            value={newQuestion.explanation} 
                            onChange={e => setNewQuestion({...newQuestion, explanation: e.target.value})}
                            className="w-full p-2 border rounded-lg h-20"
                        />
                        <button 
                            onClick={handleAddQuestion}
                            className="w-full bg-gray-800 text-white py-3 rounded-xl font-bold hover:bg-gray-900 transition"
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
                            <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-5">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-xl font-black text-gray-900">All Courses</h3>
                                        <p className="text-sm text-gray-500">Search every course across departments.</p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            onClick={() => handleCourseTabNavigate('/admin/courses/manager')}
                                            className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black"
                                        >
                                            Open Course Manager
                                        </button>
                                        <button
                                            onClick={() => handleCourseTabNavigate('/admin/courses/add')}
                                            className="px-4 py-2 rounded-xl bg-lime-600 text-white text-xs font-black uppercase tracking-widest hover:bg-lime-700"
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
                                        className="flex-1 p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white outline-none"
                                    />
                                    <button
                                        onClick={handleMergeDuplicateCoursesAcrossDepartments}
                                        className="px-4 py-3 rounded-xl bg-lime-600 text-white text-xs font-black uppercase tracking-widest hover:bg-lime-700"
                                    >
                                        Merge Same-Title Courses
                                    </button>
                                </div>

                                {filteredGlobalCourses.length ? (
                                    <div className="overflow-x-auto rounded-2xl border border-gray-100">
                                        <table className="w-full min-w-[720px] text-left">
                                            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                                <tr>
                                                    <th className="px-6 py-3">Course</th>
                                                    <th className="px-6 py-3">Departments</th>
                                                    <th className="px-6 py-3">Level</th>
                                                    <th className="px-6 py-3">Semester</th>
                                                    <th className="px-6 py-3 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {filteredGlobalCourses.map(({ course, departmentIds }) => {
                                                    const departmentNames = departmentIds
                                                        .map(id => allDepartments.find(dept => dept.id === id)?.department_name || id)
                                                        .join(', ');
                                                    const firstDepartmentId = departmentIds[0] || '';
                                                    const hasMultipleDepartments = departmentIds.length > 1;
                                                    const courseRouteIdentifier = getCourseRouteKey(course);
                                                    return (
                                                        <tr key={courseRouteIdentifier} className="hover:bg-gray-50">
                                                            <td className="px-6 py-4">
                                                                <div className="font-bold text-gray-900">{course.course_name}</div>
                                                                <div className="text-xs text-gray-500">{course.course_code || course.course_id}</div>
                                                            </td>
                                                            <td className="px-6 py-4 text-sm text-gray-600">{departmentNames}</td>
                                                            <td className="px-6 py-4 text-sm text-gray-600">{course.level}</td>
                                                            <td className="px-6 py-4">
                                                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${course.semester === 'first' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                                                                    {course.semester === 'first' ? '1st Sem' : '2nd Sem'}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 text-right">
                                                                <button
                                                                    onClick={() => handleCourseTabNavigate(buildCourseManagerPath(firstDepartmentId, course.level, courseRouteIdentifier))}
                                                                    title={hasMultipleDepartments ? 'Opens the primary department view for this shared course' : 'Open this course'}
                                                                    className="text-sm font-bold text-lime-600 hover:text-lime-700"
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
                                    <div className="p-10 border border-dashed border-gray-200 rounded-2xl text-sm text-gray-500">
                                        No courses found yet.
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {courseAdminView.mode === 'manager-root' && (
                        <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-5 max-w-3xl">
                            <div>
                                <h3 className="text-xl font-black text-gray-900">Course Manager</h3>
                                <p className="text-sm text-gray-500">Choose a department and level, then drill into a course.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <select
                                    value={managerSelectionDepartmentId}
                                    onChange={e => setManagerSelectionDepartmentId(e.target.value)}
                                    className="p-3 border border-gray-200 rounded-xl bg-gray-50 outline-none"
                                >
                                    <option value="">Select Department</option>
                                    {allDepartments.map(dept => (
                                        <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                                    ))}
                                </select>
                                <select
                                    value={managerSelectionLevel}
                                    onChange={e => setManagerSelectionLevel(e.target.value)}
                                    className="p-3 border border-gray-200 rounded-xl bg-gray-50 outline-none"
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
                                className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-sm transition ${!managerSelectionDepartmentId || !managerSelectionLevel ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-lime-600 text-white hover:bg-lime-700'}`}
                            >
                                View Courses
                            </button>
                            <button
                                onClick={() => handleCourseTabNavigate(buildCourseAddPath(managerSelectionDepartmentId || undefined, managerSelectionLevel || undefined))}
                                className="w-full py-3 rounded-xl font-black uppercase tracking-widest text-xs bg-gray-900 text-white hover:bg-black transition"
                            >
                                Course Addition
                            </button>
                            <button
                                onClick={handleMergeDuplicateCoursesAcrossDepartments}
                                className="w-full py-3 rounded-xl font-black uppercase tracking-widest text-xs bg-lime-600 text-white hover:bg-lime-700 transition"
                            >
                                Merge Same-Title Courses
                            </button>
                        </div>
                    )}

                    {courseAdminView.mode === 'add' && (
                        <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-6 max-w-4xl">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-xl font-black text-gray-900">Course Addition</h3>
                                    <p className="text-sm text-gray-500">Upload course-form PDF(s), auto-extract courses with AI, then add to selected departments and level.</p>
                                </div>
                                <button
                                    onClick={() => handleCourseTabNavigate('/admin/courses/manager')}
                                    className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black"
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
                                            className="w-full p-3 border border-gray-200 rounded-xl bg-white outline-none"
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
                                            className="w-full p-3 border border-gray-200 rounded-xl bg-white outline-none"
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
                                                <label key={dept.id} className="flex items-center gap-2 p-3 border border-gray-200 rounded-xl bg-white">
                                                    <input
                                                        type="checkbox"
                                                        checked={courseImportDepartmentIds.includes(dept.id)}
                                                        onChange={() => toggleCourseImportDepartment(dept.id)}
                                                        className="rounded border-gray-300 text-lime-600 focus:ring-lime-500"
                                                    />
                                                    <span className="text-sm text-gray-700">{dept.department_name}</span>
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
                                        className="w-full p-3 border border-gray-200 rounded-xl bg-white outline-none"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-black uppercase tracking-widest text-gray-500">Course Form PDF(s)</label>
                                    <input
                                        type="file"
                                        multiple
                                        accept="application/pdf"
                                        onChange={e => setCourseRegistrationFiles(e.target.files ? Array.from(e.target.files) : [])}
                                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-lime-100 file:text-lime-700 hover:file:bg-lime-200"
                                    />
                                    <p className="text-xs text-gray-500">
                                        Duplicate courses are merged automatically, and first/second semester values are preserved for semester badges.
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={handleCourseRegistrationImport}
                                disabled={isCourseImportDisabled}
                                className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-sm transition ${isCourseImportDisabled ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-lime-600 text-white hover:bg-lime-700'}`}
                            >
                                {isCourseImporting ? 'Importing Courses...' : 'Extract & Add Courses'}
                            </button>
                            {isCourseImporting && (
                                <p className="text-sm font-medium text-lime-600">{courseImportProgress || 'Importing course registration forms...'}</p>
                            )}
                        </div>
                    )}

                    {courseAdminView.mode === 'manager-list' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div>
                                    <p className="text-xs font-black uppercase tracking-widest text-gray-400">Course Manager</p>
                                    <h3 className="text-2xl font-black text-gray-900">
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
                                        className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black"
                                    >
                                        Change Department
                                    </button>
                                    <button
                                        onClick={() => handleCourseTabNavigate(buildCourseAddPath(courseAdminView.departmentId, courseAdminView.level))}
                                        className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black"
                                    >
                                        Course Addition
                                    </button>
                                    <button
                                        onClick={handleMergeDuplicateCoursesAcrossDepartments}
                                        className="px-4 py-2 rounded-xl bg-lime-600 text-white text-xs font-black uppercase tracking-widest hover:bg-lime-700"
                                    >
                                        Merge Same-Title Courses
                                    </button>
                                </div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl border border-gray-200">
                                {managerCoursesForLevel.length ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                                                    className="group flex items-center justify-between gap-3 p-4 rounded-2xl border border-gray-100 bg-gray-50 text-left hover:border-lime-200 hover:bg-lime-50 transition cursor-pointer"
                                                >
                                                    <div>
                                                        <div className="font-bold text-gray-900">{course.course_name}</div>
                                                        <div className="text-xs text-gray-500">{course.course_code || course.course_id}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${course.semester === 'first' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                                                            {course.semester === 'first' ? '1st Sem' : '2nd Sem'}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void handleDeleteCourseFromDepartment(course);
                                                            }}
                                                            className="rounded-full p-2 text-gray-400 opacity-100 transition hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                                                            aria-label={`Delete ${course.course_name}`}
                                                        >
                                                            <TrashIcon className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="p-8 text-center text-gray-500">
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
                                    className="text-sm font-black text-gray-500 hover:text-gray-900"
                                >
                                    ← Back to Course List
                                </button>
                                <button
                                    onClick={() => handleCourseTabNavigate(buildCourseAddPath(courseAdminView.departmentId, courseAdminView.level))}
                                    className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black"
                                >
                                    Course Addition
                                </button>
                            </div>
                            <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-6 max-w-4xl">
                                {selectedManagerCourse ? (
                                    <>
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="text-xs font-black uppercase tracking-widest text-gray-400">
                                                    {selectedManagerDepartment?.department_name || courseAdminView.departmentId} • {courseAdminView.level}
                                                </p>
                                                <h3 className="text-2xl font-black text-gray-900 mt-1">{selectedManagerCourse.course_name}</h3>
                                                <p className="text-sm text-gray-500 mt-1">{selectedManagerCourse.course_code || selectedManagerCourse.course_id}</p>
                                            </div>
                                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${selectedManagerCourse.semester === 'first' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                                                {selectedManagerCourse.semester === 'first' ? '1st Sem' : '2nd Sem'}
                                            </span>
                                        </div>

                                        <div className="space-y-3">
                                            <p className="text-xs font-black uppercase tracking-widest text-gray-400">Upload Textbook PDFs</p>
                                            <input
                                                type="file"
                                                multiple
                                                accept="application/pdf"
                                                onChange={e => setCourseDetailFiles(e.target.files ? Array.from(e.target.files) : [])}
                                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-lime-100 file:text-lime-700 hover:file:bg-lime-200"
                                            />
                                            <p className="text-xs text-gray-500">You can select and upload multiple PDF textbooks at once.</p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <input
                                                    id="auto-sync-textbooks"
                                                    type="checkbox"
                                                    checked={autoSyncToOfferingDepartments}
                                                    onChange={e => setAutoSyncToOfferingDepartments(e.target.checked)}
                                                    className="h-4 w-4"
                                                />
                                                <label htmlFor="auto-sync-textbooks" className="text-sm text-gray-600">Auto-sync to departments offering this course</label>
                                            </div>
                                            <button
                                                disabled={!courseDetailFiles.length || isUploading}
                                                onClick={async () => {
                                                    if (!selectedManagerCourse) return;
                                                    await handleTextbookUpload(selectedManagerCourse.course_id || selectedManagerCourse.course_name, courseDetailFiles);
                                                    setCourseDetailFiles([]);
                                                }}
                                                className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-sm transition ${!courseDetailFiles.length || isUploading ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-lime-600 text-white hover:bg-lime-700'}`}
                                            >
                                                {isUploading ? 'Uploading...' : 'Upload Textbooks'}
                                            </button>
                                            {isUploading && (
                                                <p className="text-sm font-medium text-lime-600">{extractionProgress || 'Uploading textbooks...'}</p>
                                            )}
                                        </div>

                                        {selectedManagerCourse.textbook_urls?.length ? (
                                            <div className="space-y-2">
                                                <p className="text-xs font-black uppercase tracking-widest text-gray-400">Uploaded Textbooks</p>
                                                <div className="space-y-1">
                                                    {selectedManagerCourse.textbook_urls.map((url) => (
                                                        <a key={url} href={url} target="_blank" rel="noreferrer" className="block text-sm text-lime-700 hover:underline">
                                                            {url}
                                                        </a>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}

                                            <div className="flex justify-end items-center pt-4 border-t border-gray-50">
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDeleteCourseFromDepartment(selectedManagerCourse)}
                                                    className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-500 transition hover:border-red-200 hover:bg-red-100 hover:text-red-700"
                                                >
                                                    <TrashIcon className="w-3.5 h-3.5" /> Delete Course
                                                </button>
                                            </div>
                                        <div className="space-y-3">
                                            <p className="text-xs font-black uppercase tracking-widest text-gray-400">Course Topics</p>
                                            {isSelectedManagerCourseTopicsLoading ? (
                                                <div className="p-6 rounded-2xl border border-dashed border-gray-200 text-sm text-gray-500">
                                                    Loading course outline from uploaded textbooks...
                                                </div>
                                            ) : selectedManagerCourseTopics.length ? (
                                                <div className="space-y-3">
                                                    {selectedManagerCourseTopics.map((topic) => (
                                                        <div key={topic.topic_id} className="rounded-2xl border border-gray-100 p-4 bg-gray-50">
                                                            <div className="font-bold text-gray-900">{topic.topic_name}</div>
                                                            {topic.topic_context ? <p className="text-sm text-gray-600 mt-1">{topic.topic_context}</p> : null}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="p-6 rounded-2xl border border-dashed border-gray-200 text-sm text-gray-500">
                                                    No course outline yet. Upload textbooks to generate the course topics.
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="p-8 text-center text-gray-500">
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
                    <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
                        <h3 className="font-bold text-gray-800">Broadcast Center</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Recipient Scope</label>
                                <select
                                    value={recipientMode}
                                    onChange={(e) => setRecipientMode(e.target.value as 'all' | 'single')}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 outline-none"
                                >
                                    <option value="all">All Users</option>
                                    <option value="single">Single User</option>
                                </select>
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Target User</label>
                                <select
                                    value={selectedRecipientId}
                                    onChange={(e) => setSelectedRecipientId(e.target.value)}
                                    disabled={recipientMode === 'all'}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 outline-none disabled:bg-gray-100 disabled:text-gray-400"
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

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="border border-gray-100 rounded-2xl p-4 space-y-3">
                                <h4 className="font-semibold text-gray-800">Send Push Notification</h4>
                                <input
                                    type="text"
                                    value={announcementTitle}
                                    onChange={(e) => setAnnouncementTitle(e.target.value)}
                                    placeholder="Notification title"
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 outline-none"
                                />
                                <textarea
                                    value={announcementMessage}
                                    onChange={(e) => setAnnouncementMessage(e.target.value)}
                                    placeholder="Notification message"
                                    rows={4}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 outline-none resize-none"
                                />
                                <select
                                    value={notificationType}
                                    onChange={(e) => setNotificationType(e.target.value as 'study_update' | 'exam_reminder' | 'welcome')}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 outline-none"
                                >
                                    <option value="study_update">Study Update</option>
                                    <option value="exam_reminder">Exam Reminder</option>
                                    <option value="welcome">Welcome</option>
                                </select>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={handleSuggestAnnouncement}
                                        disabled={isSendingPush}
                                        className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-50 transition disabled:opacity-60"
                                    >
                                        Suggest Message
                                    </button>
                                    <button
                                        onClick={handleSendPushNotification}
                                        disabled={isSendingPush}
                                        className="w-full bg-gray-900 text-white py-3 rounded-xl font-semibold hover:bg-black transition disabled:opacity-60"
                                    >
                                        {isSendingPush ? 'Sending...' : 'Send Push Notification'}
                                    </button>
                                </div>
                            </div>

                            <div className="border border-gray-100 rounded-2xl p-4 space-y-3">
                                <h4 className="font-semibold text-gray-800">Send Email</h4>
                                <input
                                    type="text"
                                    value={emailSubject}
                                    onChange={(e) => setEmailSubject(e.target.value)}
                                    placeholder="Email subject"
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 outline-none"
                                />
                                <textarea
                                    value={emailBody}
                                    onChange={(e) => setEmailBody(e.target.value)}
                                    placeholder="Email body"
                                    rows={4}
                                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 outline-none resize-none"
                                />
                                <button
                                    onClick={handleSendEmail}
                                    className="w-full bg-lime-600 text-white py-3 rounded-xl font-semibold hover:bg-lime-700 transition"
                                >
                                    Open Email Draft
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-lime-50 p-6 rounded-2xl border border-lime-200">
                            <p className="text-lime-800 text-sm font-medium uppercase">Total Registered Users</p>
                            <h3 className="text-4xl font-bold text-lime-900 mt-2">{allUsersList.length}</h3>
                        </div>
                        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-200">
                            <p className="text-blue-800 text-sm font-medium uppercase">Active Today</p>
                            <h3 className="text-4xl font-bold text-blue-900 mt-2">
                                {allUsersList.filter(u => {
                                    const today = new Date().setHours(0,0,0,0);
                                    return (u.last_activity_date || 0) >= today;
                                }).length}
                            </h3>
                        </div>
                        <div className="bg-orange-50 p-6 rounded-2xl border border-orange-200">
                            <p className="text-orange-800 text-sm font-medium uppercase">Admin Accounts</p>
                            <h3 className="text-4xl font-bold text-orange-900 mt-2">
                                {allUsersList.filter(u => u.is_admin).length}
                            </h3>
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                            <h3 className="font-bold text-gray-800">Users List</h3>
                            <button 
                                onClick={fetchUsers}
                                className="text-sm text-lime-600 hover:text-lime-700 font-medium"
                            >
                                Refresh List
                            </button>
                        </div>
                        <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
                            {isUsersLoading ? (
                                <div className="p-10 text-center text-gray-500">Loading users...</div>
                            ) : (
                                <table className="w-full min-w-[820px] text-left">
                                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                                        <tr>
                                            <th className="px-6 py-3">User</th>
                                            <th className="px-6 py-3">Email</th>
                                            <th className="px-6 py-3">Dept / Level</th>
                                            <th className="px-6 py-3">Last Active</th>
                                            <th className="px-6 py-3">Role</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 text-sm">
                                        {allUsersList.map((user) => (
                                            <tr key={user.uid} className="hover:bg-gray-50 transition">
                                                <td className="px-6 py-4 flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-lime-100 flex items-center justify-center text-lime-600 font-bold overflow-hidden">
                                                        {user.photo_url ? (
                                                            <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            user.display_name?.charAt(0) || '?'
                                                        )}
                                                    </div>
                                                    <span className="font-medium text-gray-900">{user.display_name}</span>
                                                </td>
                                                <td className="px-6 py-4 text-gray-600">
                                                    {user.email || 'Not Provided'}
                                                </td>
                                                <td className="px-6 py-4 text-gray-600">
                                                    {user.department_id || 'Not Set'} / {user.level || '?' }L
                                                </td>
                                                <td className="px-6 py-4 text-gray-500 text-xs">
                                                    {user.last_activity_date ? new Date(user.last_activity_date).toLocaleString() : 'Never'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${user.is_admin ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                                                        {user.is_admin ? 'Admin' : 'Student'}
                                                    </span>
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
        </div>
    );
};
