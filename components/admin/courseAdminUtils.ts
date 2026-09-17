import type { Course, Topic } from '../../types';

// Restored from the pre-refactor AdminPanel (git c8f679e~1) so the split
// AdminPanelShell keeps the original course admin routing and normalization
// behavior. Shared with pages that need the same merge keys.

export const SEMESTERS = ['first', 'second'] as const;
export const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'] as const;
export const MAX_SKIPPED_USERS_PREVIEW = 3;
export const MAX_MAILTO_LINK_LENGTH = 1900;
export const MAX_COURSE_STATUS_LENGTH = 12;
export const DEFAULT_SEMESTER: (typeof SEMESTERS)[number] = 'first';

export const normalizeSemester = (semester?: Course['semester']): (typeof SEMESTERS)[number] => (
    semester && SEMESTERS.includes(semester) ? semester : DEFAULT_SEMESTER
);

export const normalizeLevel = (value?: string) => {
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

export const normalizeTopicId = (value: string) => value.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');

export const normalizeCourseStatus = (value?: string) => {
    const normalized = (value || '').toString().trim().toUpperCase();
    return normalized ? normalized.slice(0, MAX_COURSE_STATUS_LENGTH) : '';
};

export type CourseAdminView =
    | { mode: 'global' }
    | { mode: 'global-list'; level: string }
    | { mode: 'global-detail'; level: string; courseId: string }
    | { mode: 'manager-root' }
    | { mode: 'add'; departmentId?: string; level?: string }
    | { mode: 'manager-list'; departmentId: string; level: string }
    | { mode: 'manager-detail'; departmentId: string; level: string; courseId: string };

export const getCourseAdminView = (pathname: string): CourseAdminView => {
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

export const buildCourseGlobalPath = (level?: string, courseId?: string) => {
    if (!level) return '/admin/courses/global';
    const encodedLevel = encodeURIComponent(level);
    const encodedCourse = courseId ? `/${encodeURIComponent(courseId)}` : '';
    return `/admin/courses/global/${encodedLevel}${encodedCourse}`;
};

export const buildCourseManagerPath = (departmentId?: string, level?: string, courseId?: string) => {
    if (!departmentId || !level) return '/admin/courses/manager';
    const encodedDepartment = encodeURIComponent(departmentId);
    const encodedLevel = encodeURIComponent(level);
    const encodedCourse = courseId ? `/${encodeURIComponent(courseId)}` : '';
    return `/admin/courses/manager/${encodedDepartment}/${encodedLevel}${encodedCourse}`;
};

export const buildCourseAddPath = (departmentId?: string, level?: string) => {
    if (!departmentId) return '/admin/courses/add';
    const encodedDepartment = encodeURIComponent(departmentId);
    if (!level) return `/admin/courses/add/${encodedDepartment}`;
    return `/admin/courses/add/${encodedDepartment}/${encodeURIComponent(level)}`;
};

export const matchesCourseIdentifier = (course: Partial<Course>, courseId: string) => (
    course.course_id === courseId || getCourseMergeKey(course) === courseId
);

export const sanitizeTopicMetadata = (topic: any, index: number): Topic => {
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

export const normalizeTextbookUrls = (course: Partial<Course>) => {
    const urls: string[] = Array.isArray(course?.textbook_urls) ? course.textbook_urls.filter(Boolean) : [];
    if (course?.textbook_url && !urls.includes(course.textbook_url)) {
        urls.push(course.textbook_url);
    }
    return Array.from(new Set(urls));
};

export const getPrimaryTextbookUrl = (urls: string[]) => urls[urls.length - 1] || '';

export const selectPrimaryPdfUrl = (uploadedUrls: string[], existingPdfUrl: string | undefined, mergedPdfUrls: string[]) => (
    getPrimaryTextbookUrl(uploadedUrls) || existingPdfUrl || getPrimaryTextbookUrl(mergedPdfUrls)
);

export const mergeTopics = (existingTopics: Array<Partial<Topic>>, newTopics: Topic[]) => {
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

export const getUniqueIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

export const getCourseMergeKey = (course: Partial<Course>) => {
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

export const getCourseRouteKey = (course: Partial<Course>) => {
    const mergeKey = getCourseMergeKey(course);
    if (mergeKey) return mergeKey;
    const fallbackLabel = normalizeTopicId((course?.course_id || course?.course_name || 'course').toString().trim()) || 'course';
    const hasLevel = Boolean((course?.level || '').toString().trim());
    const normalizedLevel = hasLevel ? normalizeLevel(course?.level) : 'alllvl';
    return `${fallbackLabel}_${normalizedLevel}_${normalizeSemester(course?.semester)}`;
};

export const mergeCourseRecord = (
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

export const upsertCourseInList = (
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

export const normalizeCourseList = (rawCourseList: any): Course[] => {
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

export const mergeCourseListsIntoTarget = (existingCourses: Course[], incomingCourses: Course[]) => {
    let mergedCourses = [...existingCourses];
    for (const course of incomingCourses) {
        if (!course.course_id) continue;
        mergedCourses = upsertCourseInList(mergedCourses, course);
    }
    return mergedCourses;
};

export const sanitizeCourseFromRegistrationForm = (
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



