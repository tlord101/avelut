import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { db, storage } from '../firebase';
import { ref as dbRef, set, push, update, get } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenAI, Type } from '@google/genai';
import { useToast } from '../hooks/useToast';
import type { UserProfile, Question, Course, Topic } from '../types';
import { LogoIcon } from './icons/LogoIcon';
import { MenuIcon } from './icons/MenuIcon';
import { XIcon } from './icons/XIcon';
import { StackIcon } from './icons/StackIcon';
import { StudyGuideIcon } from './icons/StudyGuideIcon';
import { ExamIcon } from './icons/ExamIcon';
import { GraduationCapIcon } from './icons/GraduationCapIcon';
import { CheckIcon } from './icons/CheckIcon';
import { getWindowPathname } from '../utils/pathname';

// @ts-ignore
const ai = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;

interface AdminPanelProps {
    userProfile: UserProfile;
    initialTab?: 'questions' | 'courses' | 'users' | 'departments';
    allowedTabs?: Array<'questions' | 'courses' | 'users' | 'departments'>;
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

type CourseAdminView =
    | { mode: 'global' }
    | { mode: 'manager-root' }
    | { mode: 'manager-list'; departmentId: string; level: string }
    | { mode: 'manager-detail'; departmentId: string; level: string; courseId: string };

const DEFAULT_VISIBLE_TABS: Array<'departments' | 'courses' | 'questions' | 'users'> = ['departments', 'courses', 'questions', 'users'];

const getCourseAdminView = (pathname: string): CourseAdminView => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] !== 'admin' || segments[1] !== 'courses') {
        return { mode: 'global' };
    }

    if (segments.length <= 2 || segments[2] === 'all') {
        return { mode: 'global' };
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
const getCourseMergeKey = (course: Partial<Course>) => (
    normalizeTopicId((course?.course_name || course?.course_id || '').toString().trim())
);

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
    const [activeTab, setActiveTab] = useState<'questions' | 'courses' | 'users' | 'departments'>(initialTab);
    const visibleTabs = useMemo(
        () => (allowedTabs && allowedTabs.length ? allowedTabs : DEFAULT_VISIBLE_TABS),
        [allowedTabs]
    );
    const resolvedPathname = pathname || internalPathname;
    const courseAdminView = useMemo(() => getCourseAdminView(resolvedPathname), [resolvedPathname]);
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
    const [courseRegistrationFile, setCourseRegistrationFile] = useState<File | null>(null);
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

    useEffect(() => {
        const pathTab = resolvedPathname.split('/').filter(Boolean)[1];
        const selectedTab = (pathTab && visibleTabs.includes(pathTab) ? pathTab : (visibleTabs[0] || 'departments')) as 'departments' | 'courses' | 'questions' | 'users';
        setActiveTab(selectedTab);
    }, [resolvedPathname, visibleTabs]);

    useEffect(() => {
        if (pathname) return;
        const handlePopState = () => setInternalPathname(getWindowPathname());
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [pathname]);

    useEffect(() => {
        if (courseAdminView.mode === 'manager-list' || courseAdminView.mode === 'manager-detail') {
            setDepartmentId(courseAdminView.departmentId);
            setTargetDepartmentIds([courseAdminView.departmentId]);
            setManagerSelectionDepartmentId(courseAdminView.departmentId);
            setManagerSelectionLevel(courseAdminView.level);
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
    }, [courseAdminView]);

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
            addToast("AI features are unavailable because API_KEY is missing.", "error");
            return;
        }

        setIsPQProcessing(true);
        setExtractionProgress('Extracting questions with Gemini 3.5 Flash...');

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
                model: "gemini-3.5-flash",
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
        if (!departmentId) {
            addToast("Please select a department first", "error");
            return;
        }
        if (!courseRegistrationFile) {
            addToast("Please select a course registration PDF", "error");
            return;
        }
        if (!ai) {
            addToast("AI features are unavailable because API_KEY is missing.", "error");
            return;
        }

        setIsCourseImporting(true);
        setCourseImportProgress("Extracting course list from PDF...");

        try {
            const reader = new FileReader();
            reader.readAsDataURL(courseRegistrationFile);
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
                model: "gemini-3.5-flash",
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
            const extractedCourses = Array.isArray(responseData?.courses) ? responseData.courses : [];
            if (!extractedCourses.length) {
                throw new Error("No courses found in the uploaded form.");
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

            if (!normalizedCourses.length) {
                throw new Error("Extracted courses were invalid after normalization.");
            }

            setCoursesList(prevCourses => {
                let mergedCourses = [...prevCourses];
                normalizedCourses.forEach(course => {
                    mergedCourses = upsertCourseInList(mergedCourses, course);
                });
                return mergedCourses;
            });

            const sessionLabel = (courseImportSessionOverride || responseData?.academic_session || '').toString().trim();
            addToast(
                `Imported ${normalizedCourses.length} course${normalizedCourses.length !== 1 ? 's' : ''}${sessionLabel ? ` for ${sessionLabel}` : ''}. Review and publish changes.`,
                "success"
            );
            setCourseRegistrationFile(null);
            setCourseImportSessionOverride(sessionLabel);
            if (!courseImportLevelOverride) {
                setCourseImportLevelOverride(normalizeLevel(responseData?.level));
            }
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
            addToast("AI features are unavailable because API_KEY is missing.", "error");
            return;
        }
        const sourceCourseList = overrideCourseList || coursesList;
        const selectedCourse = sourceCourseList.find(c => c.course_id === courseId || getCourseMergeKey(c) === courseId);
        const syncDepartmentIds = getUniqueIds(overrideDepartmentIds || [departmentId, ...targetDepartmentIds]);
        
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
                const fileRef = storageRef(storage, `textbooks/${primaryDepartmentId}/${level}/${course_name}/${file.name}`);
                const uploadResult = await uploadBytes(fileRef, file);
                const downloadURL = await getDownloadURL(uploadResult.ref);
                uploadedUrls.push(downloadURL);

                setExtractionProgress(`Extracting syllabus ${index + 1}/${pdfFiles.length} with Gemini 3.5 Flash...`);
                
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
                    model: "gemini-3.5-flash",
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

            for (const targetDepartmentId of syncDepartmentIds) {
                const textbookContextRef = dbRef(db, `textbook_contexts/${targetDepartmentId}/${level}/${course_name}`);
                const textbookContextSnapshot = await get(textbookContextRef);
                const existingContext = textbookContextSnapshot.exists() ? textbookContextSnapshot.val() : {};

                const existingPdfUrls: string[] = Array.isArray(existingContext?.pdf_urls) ? existingContext.pdf_urls.filter(Boolean) : [];
                if (existingContext?.pdf_url && !existingPdfUrls.includes(existingContext.pdf_url)) {
                    existingPdfUrls.push(existingContext.pdf_url);
                }
                const mergedPdfUrls = Array.from(new Set([...existingPdfUrls, ...uploadedUrls]));
                const mergedSyllabus = mergeTopics(
                    Array.isArray(existingContext?.syllabus) ? existingContext.syllabus : [],
                    extractedTopicGroups.flat()
                );
                const primaryPdfUrl = selectPrimaryPdfUrl(uploadedUrls, existingContext?.pdf_url, mergedPdfUrls);

                await set(textbookContextRef, {
                    pdf_url: primaryPdfUrl,
                    pdf_urls: mergedPdfUrls,
                    syllabus: mergedSyllabus,
                    uploaded_at: Date.now()
                });

                const departmentRef = dbRef(db, `departments_data/${targetDepartmentId}`);
                const departmentSnapshot = await get(departmentRef);
                const existingDepartmentCourses = normalizeCourseList(departmentSnapshot.val()?.course_list);

                const isPrimaryDepartmentTarget = targetDepartmentId === primaryDepartmentId;
                const coursesForTargetDepartment = isPrimaryDepartmentTarget ? sourceCourseList : existingDepartmentCourses;
                const updatedCourseList = upsertCourseInList(coursesForTargetDepartment, selectedCourse, mergedSyllabus, uploadedUrls);

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
        () => allDepartments.find((dept) => dept.id === courseAdminView.departmentId) || null,
        [allDepartments, courseAdminView]
    );

    const managerCoursesForLevel = useMemo(
        () => (
            courseAdminView.mode === 'manager-list' || courseAdminView.mode === 'manager-detail'
                ? coursesList.filter((course) => course.level === courseAdminView.level)
                : []
        ),
        [courseAdminView, coursesList]
    );

    const selectedManagerCourse = useMemo(
        () => (
            courseAdminView.mode === 'manager-detail'
                ? managerCoursesForLevel.find((course) => (
                    matchesCourseIdentifier(course, courseAdminView.courseId)
                )) || null
                : null
        ),
        [courseAdminView, managerCoursesForLevel]
    );

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

    const handleCourseTabNavigate = useCallback((path: string) => {
        if (onNavigate) {
            onNavigate(path);
            return;
        }
        if (typeof window !== 'undefined') {
            window.history.pushState(null, '', path);
        }
        setInternalPathname(path);
    }, [onNavigate]);

    useEffect(() => {
        if (courseAdminView.mode !== 'manager-root') return;
        if (!managerSelectionDepartmentId || !managerSelectionLevel) return;
        const managerPath = `/admin/courses/manager/${encodeURIComponent(managerSelectionDepartmentId)}/${encodeURIComponent(managerSelectionLevel)}`;
        if (resolvedPathname === managerPath) return;
        handleCourseTabNavigate(managerPath);
    }, [courseAdminView.mode, managerSelectionDepartmentId, managerSelectionLevel, handleCourseTabNavigate, resolvedPathname]);

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
                        onClick={() => handleCourseTabNavigate('/admin/courses')}
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
            </div>

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
                                    <button
                                        onClick={() => handleCourseTabNavigate('/admin/courses/manager')}
                                        className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black"
                                    >
                                        Open Course Manager
                                    </button>
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
                                                    return (
                                                        <tr key={course.course_id} className="hover:bg-gray-50">
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
                                                                    onClick={() => handleCourseTabNavigate(buildCourseManagerPath(firstDepartmentId, course.level, course.course_id))}
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
                                onClick={() => handleCourseTabNavigate('/admin/courses')}
                                className="w-full py-3 rounded-xl font-black uppercase tracking-widest text-xs border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
                            >
                                Back to All Courses
                            </button>
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
                                        onClick={() => handleCourseTabNavigate('/admin/courses')}
                                        className="px-4 py-2 rounded-xl border border-gray-200 text-xs font-black uppercase tracking-widest text-gray-700 hover:bg-gray-50"
                                    >
                                        All Courses
                                    </button>
                                    <button
                                        onClick={() => handleCourseTabNavigate('/admin/courses/manager')}
                                        className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black uppercase tracking-widest hover:bg-black"
                                    >
                                        Change Department
                                    </button>
                                </div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl border border-gray-200">
                                {managerCoursesForLevel.length ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {managerCoursesForLevel.map((course) => (
                                            <button
                                                key={course.course_id}
                                                onClick={() => handleCourseTabNavigate(buildCourseManagerPath(courseAdminView.departmentId, courseAdminView.level, course.course_id))}
                                                className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-gray-100 bg-gray-50 text-left hover:border-lime-200 hover:bg-lime-50 transition"
                                            >
                                                <div>
                                                    <div className="font-bold text-gray-900">{course.course_name}</div>
                                                    <div className="text-xs text-gray-500">{course.course_code || course.course_id}</div>
                                                </div>
                                                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase ${course.semester === 'first' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'}`}>
                                                    {course.semester === 'first' ? '1st Sem' : '2nd Sem'}
                                                </span>
                                            </button>
                                        ))}
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
                            <button
                                onClick={() => handleCourseTabNavigate(buildCourseManagerPath(courseAdminView.departmentId, courseAdminView.level))}
                                className="text-sm font-black text-gray-500 hover:text-gray-900"
                            >
                                ← Back to Course List
                            </button>
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

                                        <div className="space-y-3">
                                            <p className="text-xs font-black uppercase tracking-widest text-gray-400">Course Topics</p>
                                            {selectedManagerCourse.topics?.length ? (
                                                <div className="space-y-3">
                                                    {selectedManagerCourse.topics.map((topic) => (
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
                                <button
                                    onClick={handleSendPushNotification}
                                    disabled={isSendingPush}
                                    className="w-full bg-gray-900 text-white py-3 rounded-xl font-semibold hover:bg-black transition disabled:opacity-60"
                                >
                                    {isSendingPush ? 'Sending...' : 'Send Push Notification'}
                                </button>
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
