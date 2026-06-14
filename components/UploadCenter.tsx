import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createAvelutAI } from '../utils/inference';
import { Type } from '@google/genai';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, auth as firebaseAuth, firebaseSignOut, onAuthStateChanged, db, storage } from '../firebase';
import { ref as dbRef, get, onValue, push, set, update } from 'firebase/database';
import { ref as storageRef, getDownloadURL, uploadBytes } from 'firebase/storage';
import { useToast } from '../hooks/useToast';
import { getFeatureModel } from '../utils/usage';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import { useGoogleDrivePicker } from '../hooks/useGoogleDrivePicker';
import type { Course, Topic } from '../types';
import { getWindowPathname } from '../utils/pathname';

const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'] as const;
const SEMESTERS = ['first', 'second'] as const;

type AuthMode = 'login' | 'signup';
type UploadCenterView = 'dashboard' | 'upload' | 'requests';

type UploaderProfile = {
  uid: string;
  email: string;
  created_at: number;
  display_name?: string;
};

type CatalogEntry = {
  key: string;
  course: Course;
  departmentIds: string[];
  hasTextbook: boolean;
};

type UploadRecord = {
  course_key: string;
  course_name: string;
  level: string;
  semester: string;
  department_ids: string[];
  uploaded_urls: string[];
  uploaded_at: number;
};

type RequestRecord = {
  course_key: string;
  course_name: string;
  level: string;
  semester: string;
  note: string;
  created_at: number;
  status: 'open';
};

type RequestedCourseEntry = {
  request: RequestRecord;
  catalogEntry: CatalogEntry | null;
};

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

const normalizeSemester = (value?: string) => {
  const normalized = (value || '').toString().trim().toLowerCase();
  return SEMESTERS.includes(normalized as (typeof SEMESTERS)[number]) ? (normalized as (typeof SEMESTERS)[number]) : SEMESTERS[0];
};

const normalizeTextbookUrls = (course: Partial<Course> | undefined) => {
  const urls: string[] = Array.isArray(course?.textbook_urls) ? course!.textbook_urls!.filter(Boolean) : [];
  if (course?.textbook_url && !urls.includes(course.textbook_url)) {
    urls.push(course.textbook_url);
  }
  return Array.from(new Set(urls));
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

const getPrimaryTextbookUrl = (urls: string[]) => urls[urls.length - 1] || '';

const selectPrimaryPdfUrl = (uploadedUrls: string[], existingPdfUrl: string | undefined, mergedPdfUrls: string[]) => (
  getPrimaryTextbookUrl(uploadedUrls) || existingPdfUrl || getPrimaryTextbookUrl(mergedPdfUrls)
);

const getCourseMergeKey = (course: Partial<Course>) => {
  const primaryLabel = (course.course_code || course.course_name || course.course_id || '').toString().trim();
  const normalizedPrimaryLabel = primaryLabel.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
  if (!normalizedPrimaryLabel) return '';
  const hasLevel = Boolean((course.level || '').toString().trim());
  const normalizedLevel = hasLevel ? normalizeLevel(course.level) : 'alllvl';
  const normalizedSemester = normalizeSemester(course.semester);
  return `${normalizedPrimaryLabel}_${normalizedLevel}_${normalizedSemester}`;
};

const mergeCourseRecord = (
  existingCourse: Partial<Course> | undefined,
  sourceCourse: Partial<Course>,
  mergedTopics?: Topic[],
  appendedTextbookUrls: string[] = []
): Course => {
  const mergedUrls = Array.from(new Set([
    ...normalizeTextbookUrls(existingCourse),
    ...normalizeTextbookUrls(sourceCourse),
    ...appendedTextbookUrls,
  ]));

  return {
    ...(existingCourse as Course),
    ...(sourceCourse as Course),
    course_id: (sourceCourse.course_id || existingCourse?.course_id || '').toString(),
    course_name: (sourceCourse.course_name || existingCourse?.course_name || '').toString(),
    level: normalizeLevel(sourceCourse.level || existingCourse?.level),
    semester: normalizeSemester(sourceCourse.semester || existingCourse?.semester),
    topics: mergedTopics
      ? mergeTopics(Array.isArray(existingCourse?.topics) ? (existingCourse?.topics as Topic[]) : [], mergedTopics)
      : (Array.isArray(sourceCourse.topics)
        ? sourceCourse.topics
        : (Array.isArray(existingCourse?.topics) ? (existingCourse?.topics as Course['topics']) : [])),
    textbook_url: getPrimaryTextbookUrl(mergedUrls),
    textbook_urls: mergedUrls,
  };
};

const upsertCourseInList = (courseList: Course[], sourceCourse: Partial<Course>, mergedTopics?: Topic[], appendedTextbookUrls: string[] = []): Course[] => {
  const sourceKey = getCourseMergeKey(sourceCourse);
  if (!sourceKey) return courseList;

  const existingIndex = courseList.findIndex(course => getCourseMergeKey(course) === sourceKey || (sourceCourse.course_id && course.course_id === sourceCourse.course_id));
  const nextCourse = mergeCourseRecord(existingIndex >= 0 ? courseList[existingIndex] : undefined, {
    ...sourceCourse,
    course_id: sourceCourse.course_id || sourceKey,
  }, mergedTopics, appendedTextbookUrls);

  if (existingIndex < 0) {
    return [...courseList, nextCourse];
  }

  const nextList = [...courseList];
  nextList[existingIndex] = nextCourse;
  return nextList;
};

const normalizeCourseList = (rawCourseList: any): Course[] => {
  if (!Array.isArray(rawCourseList)) return [];
  return rawCourseList
    .map((course: Course) => ({
      ...course,
      course_name: (course?.course_name || '').toString().trim(),
      course_id: (course?.course_id || getCourseMergeKey(course) || '').toString(),
      level: normalizeLevel(course?.level),
      semester: normalizeSemester(course?.semester),
      topics: Array.isArray(course?.topics) ? course.topics : [],
      textbook_urls: normalizeTextbookUrls(course),
      textbook_url: normalizeTextbookUrls(course).slice(-1)[0] || '',
    }))
    .filter((course: Course) => Boolean(getCourseMergeKey(course)));
};

const isTextbookUploaded = (course: Course) => normalizeTextbookUrls(course).length > 0 || Boolean((course as Course & { textbook_shared_key?: string }).textbook_shared_key);

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === 'string' ? reader.result : '';
    resolve(result.includes(',') ? result.split(',')[1] : result);
  };
  reader.onerror = () => reject(new Error(`Failed to read PDF: ${reader.error?.message || 'Unknown error'}`));
  reader.readAsDataURL(file);
});

const createUserDisplayName = (email: string) => {
  const prefix = email.split('@')[0] || 'uploader';
  return prefix.replace(/[._-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
};

const previewTopics = (topics?: Topic[], maxItems = 3) => (Array.isArray(topics) ? topics.slice(0, maxItems) : []);

export const UploadCenter: React.FC = () => {
  const { addToast } = useToast();
  const { attemptApiCall } = useApiLimiter();
  const { settings: appSettings } = useAppSettings();
  const { openPicker } = useGoogleDrivePicker();
  const geminiModel = getFeatureModel('study_guide_extraction', appSettings);
  const ai = useMemo(() => createAvelutAI(appSettings, null), [appSettings]);
  const [pathname, setPathname] = useState(() => getWindowPathname());
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [user, setUser] = useState(firebaseAuth.currentUser);
  const [profile, setProfile] = useState<UploaderProfile | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<(typeof LEVELS)[number]>('100lvl');
  const [selectedSemester, setSelectedSemester] = useState<(typeof SEMESTERS)[number]>('first');
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [isUploadingCourseKey, setIsUploadingCourseKey] = useState('');
  const [requestCourseKey, setRequestCourseKey] = useState('');
  const [requestNote, setRequestNote] = useState('');
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const activeView: UploadCenterView = useMemo(() => {
    if (pathname.startsWith('/upload-center/requests')) return 'requests';
    if (pathname.startsWith('/upload-center/upload')) return 'upload';
    return 'dashboard';
  }, [pathname]);

  useEffect(() => {
    const handlePopState = () => setPathname(getWindowPathname());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      if (!currentUser) {
        setProfile(null);
        setIsProfileLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    setIsProfileLoading(true);
    const profileRef = dbRef(db, `uploaders/${user.uid}`);
    const handleProfileError = (error: Error) => {
      console.error('Failed to load uploader profile:', error);
      addToast('Could not load your uploader profile. Please sign in again.', 'error');
      setProfile(null);
      setIsProfileLoading(false);
    };

    const unsubscribeProfile = onValue(profileRef, (snapshot) => {
      const value = snapshot.val();
      if (value) {
        setProfile({
          uid: value.uid || user.uid,
          email: value.email || user.email || '',
          created_at: value.created_at || Date.now(),
          display_name: value.display_name || createUserDisplayName(value.email || user.email || ''),
        });
      } else {
        setProfile(null);
      }
      setIsProfileLoading(false);
    }, handleProfileError);

    const uploadsRef = dbRef(db, `uploaders/${user.uid}/uploads`);
    const unsubscribeUploads = onValue(uploadsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const nextUploads = Object.values(data) as UploadRecord[];
      setUploads(nextUploads.sort((a, b) => b.uploaded_at - a.uploaded_at));
    }, (error) => {
      console.error('Failed to load uploader uploads:', error);
      setUploads([]);
    });

    const requestsRef = dbRef(db, `uploaders/${user.uid}/requests`);
    const unsubscribeRequests = onValue(requestsRef, (snapshot) => {
      const data = snapshot.val() || {};
      const nextRequests = Object.values(data) as RequestRecord[];
      setRequests(nextRequests.sort((a, b) => b.created_at - a.created_at));
    }, (error) => {
      console.error('Failed to load uploader requests:', error);
      setRequests([]);
    });

    return () => {
      unsubscribeProfile();
      unsubscribeUploads();
      unsubscribeRequests();
    };
  }, [user]);

  useEffect(() => {
    const loadCatalog = async () => {
      setIsCatalogLoading(true);
      try {
        const snapshot = await get(dbRef(db, 'departments_data'));
        const departments = snapshot.exists() ? snapshot.val() : {};
        const courseMap = new Map<string, CatalogEntry>();

        Object.entries(departments).forEach(([departmentId, departmentValue]: [string, any]) => {
          const departmentCourses = normalizeCourseList(departmentValue?.course_list);
          departmentCourses.forEach((course) => {
            const courseKey = getCourseMergeKey(course);
            if (!courseKey) return;

            const existing = courseMap.get(courseKey);
            if (existing) {
              existing.departmentIds = Array.from(new Set([...existing.departmentIds, departmentId]));
              existing.course = mergeCourseRecord(existing.course, course);
              existing.hasTextbook = existing.hasTextbook || isTextbookUploaded(course);
              return;
            }

            courseMap.set(courseKey, {
              key: courseKey,
              course: {
                ...course,
                course_id: course.course_id || courseKey,
              },
              departmentIds: [departmentId],
              hasTextbook: isTextbookUploaded(course),
            });
          });
        });

        setCatalog(Array.from(courseMap.values()).sort((a, b) => a.course.course_name.localeCompare(b.course.course_name)));
      } catch (error) {
        console.error('Failed to load course catalog:', error);
        addToast('Could not load the course list.', 'error');
      } finally {
        setIsCatalogLoading(false);
      }
    };

    if (user) {
      void loadCatalog();
    }
  }, [addToast, user]);

  useEffect(() => {
    const uploadRoute = getWindowPathname();
    setPathname(uploadRoute);
  }, []);

  useEffect(() => {
    const availableCourses = catalog.filter(entry => normalizeLevel(entry.course.level) === selectedLevel && normalizeSemester(entry.course.semester) === selectedSemester && !entry.hasTextbook);
    if (!availableCourses.length) return;
    if (!availableCourses.some(entry => entry.key === requestCourseKey) && requestCourseKey) return;
    if (!requestCourseKey) {
      setRequestCourseKey(availableCourses[0].key);
    }
  }, [catalog, requestCourseKey, selectedLevel, selectedSemester]);

  const availableCourses = useMemo(() => (
    catalog.filter(entry => normalizeLevel(entry.course.level) === selectedLevel && normalizeSemester(entry.course.semester) === selectedSemester && !entry.hasTextbook)
  ), [catalog, selectedLevel, selectedSemester]);

  const requestableCourses = useMemo(() => (
    catalog.filter(entry => normalizeLevel(entry.course.level) === selectedLevel && normalizeSemester(entry.course.semester) === selectedSemester && entry.hasTextbook)
  ), [catalog, selectedLevel, selectedSemester]);

  const requestedCourseEntries = useMemo<RequestedCourseEntry[]>(() => {
    const uniqueRequests = Array.from(
      new Map(requests.map(request => [request.course_key, request])).values()
    );

    return uniqueRequests.map((request) => ({
      request,
      catalogEntry: catalog.find(entry => entry.key === request.course_key) || null,
    }));
  }, [catalog, requests]);

  const recentUploads = useMemo(() => (
    uploads.slice(0, 4).map((upload) => ({
      upload,
      catalogEntry: catalog.find(entry => entry.key === upload.course_key) || null,
    }))
  ), [catalog, uploads]);

  const totalUploadedCourses = uploads.length;
  const totalRequestedCourses = requests.length;

  const navigate = (nextPath: string) => {
    if (typeof window === 'undefined') return;
    window.history.pushState(null, '', nextPath);
    setPathname(nextPath);
  };

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      addToast('Enter your email and password.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      if (authMode === 'signup') {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        const displayName = createUserDisplayName(email.trim());
        await set(dbRef(db, `uploaders/${credential.user.uid}`), {
          uid: credential.user.uid,
          email: credential.user.email || email.trim(),
          display_name: displayName,
          created_at: Date.now(),
        });
        addToast('Uploader account created.', 'success');
        navigate('/upload-center');
      } else {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
        const profileSnapshot = await get(dbRef(db, `uploaders/${credential.user.uid}`));
        if (!profileSnapshot.exists()) {
          await firebaseSignOut(firebaseAuth);
          throw new Error('This account is not registered as an uploader. Please sign up first.');
        }
        addToast('Signed in successfully.', 'success');
      }
    } catch (error: any) {
      console.error('Uploader auth failed:', error);
      addToast(error?.message || 'Could not sign in.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await firebaseSignOut(firebaseAuth);
      setProfile(null);
      setUploads([]);
      setRequests([]);
      navigate('/upload-center');
    } catch (error: any) {
      addToast(error?.message || 'Could not sign out.', 'error');
    }
  };

  const refreshCatalog = async () => {
    const snapshot = await get(dbRef(db, 'departments_data'));
    const departments = snapshot.exists() ? snapshot.val() : {};
    const courseMap = new Map<string, CatalogEntry>();

    Object.entries(departments).forEach(([departmentId, departmentValue]: [string, any]) => {
      const departmentCourses = normalizeCourseList(departmentValue?.course_list);
      departmentCourses.forEach((course) => {
        const courseKey = getCourseMergeKey(course);
        if (!courseKey) return;
        const existing = courseMap.get(courseKey);
        if (existing) {
          existing.departmentIds = Array.from(new Set([...existing.departmentIds, departmentId]));
          existing.course = mergeCourseRecord(existing.course, course);
          existing.hasTextbook = existing.hasTextbook || isTextbookUploaded(course);
          return;
        }
        courseMap.set(courseKey, {
          key: courseKey,
          course: {
            ...course,
            course_id: course.course_id || courseKey,
          },
          departmentIds: [departmentId],
          hasTextbook: isTextbookUploaded(course),
        });
      });
    });

    setCatalog(Array.from(courseMap.values()).sort((a, b) => a.course.course_name.localeCompare(b.course.course_name)));
  };

  const handleGoogleDrivePick = (onFilesSelected: (files: File[]) => void) => {
    openPicker({
      clientId: appSettings.google_client_id || '',
      apiKey: appSettings.google_api_key || '',
      onFilesSelected
    });
  };

  const handleFileUpload = async (courseEntry: CatalogEntry, files: FileList | File[]) => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser || !profile) {
      addToast('Please sign in again.', 'error');
      return;
    }

    if (!ai) {
      addToast('AI features are unavailable because the Gemini API key is not configured in App Controls.', 'error');
      return;
    }

    if (!appSettings.upload_center_uploads_enabled) {
      addToast('Textbook uploads are currently disabled by an administrator.', 'error');
      return;
    }

    const pdfFiles = Array.from(files).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!pdfFiles.length) {
      addToast('Please choose PDF files only.', 'error');
      return;
    }

    setIsUploadingCourseKey(courseEntry.key);
    try {
      const uploadedUrls: string[] = [];
      const extractedTopicGroups: Topic[][] = [];

      for (let index = 0; index < pdfFiles.length; index += 1) {
        const file = pdfFiles[index];
        const uploadToken = `${Date.now()}_${index}_${file.lastModified}_${file.size}`;
        const fileRef = storageRef(storage, `textbooks/uploader/${currentUser.uid}/${courseEntry.key}/${uploadToken}_${file.name}`);
        const result = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(result.ref);
        uploadedUrls.push(downloadURL);

        const base64PDF = await fileToBase64(file);
        const prompt = `Analyze this PDF textbook for "${courseEntry.course.course_name}" at "${courseEntry.course.level}" level.
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
    }
  ]
}`;

        const aiResult = await attemptApiCall(async () => {
          const aiResponse = await ai.models.generateContent({
            model: geminiModel,
            contents: [
              {
                role: 'user',
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType: 'application/pdf', data: base64PDF } },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  syllabus: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        topic_name: { type: Type.STRING },
                        topic_id: { type: Type.STRING },
                        topic_context: { type: Type.STRING },
                        start_point: { type: Type.STRING },
                        end_point: { type: Type.STRING }
                      },
                      required: ['topic_name', 'topic_id', 'topic_context', 'start_point', 'end_point']
                    }
                  }
                },
                required: ['syllabus']
              }
            },
          });

          const text = aiResponse.response.text();
          if (!text) {
            throw new Error(`AI returned an empty response while extracting syllabus from ${file.name}.`);
          }

          const responseData = JSON.parse(text);
          const syllabusData = Array.isArray(responseData?.syllabus)
            ? responseData.syllabus.map((topic: any, topicIndex: number) => sanitizeTopicMetadata(topic, topicIndex))
            : [];
          extractedTopicGroups.push(syllabusData);
        });

        if (!aiResult.success) {
          addToast(aiResult.message, 'error');
          setIsUploadingCourseKey('');
          return;
        }
      }

      const mergedUrls = Array.from(new Set([
        ...normalizeTextbookUrls(courseEntry.course),
        ...uploadedUrls,
      ]));

      const sharedSnapshot = await get(dbRef(db, `textbook_contexts/shared/${courseEntry.key}`));
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

      await set(dbRef(db, `textbook_contexts/shared/${courseEntry.key}`), {
        course_key: courseEntry.key,
        course_name: courseEntry.course.course_name,
        level: courseEntry.course.level,
        semester: courseEntry.course.semester || selectedSemester,
        pdf_url: primaryPdfUrl,
        pdf_urls: mergedSharedPdfUrls,
        syllabus: mergedSharedSyllabus,
        uploaded_at: Date.now(),
        uploader_uid: currentUser.uid,
      });

      for (const departmentId of courseEntry.departmentIds) {
        const departmentRef = dbRef(db, `departments_data/${departmentId}`);
        const departmentSnapshot = await get(departmentRef);
        const existingCourses = normalizeCourseList(departmentSnapshot.val()?.course_list);
        const updatedCourses = upsertCourseInList(existingCourses, {
          ...courseEntry.course,
          course_id: courseEntry.course.course_id || courseEntry.key,
          textbook_url: primaryPdfUrl,
          textbook_urls: mergedSharedPdfUrls,
          textbook_shared_key: courseEntry.key,
        }, mergedSharedSyllabus, mergedSharedPdfUrls);
        await update(departmentRef, {
          course_list: updatedCourses,
        });
      }

      const uploadRecordId = push(dbRef(db, `uploaders/${currentUser.uid}/uploads`)).key;
      if (uploadRecordId) {
        await set(dbRef(db, `uploaders/${currentUser.uid}/uploads/${uploadRecordId}`), {
          course_key: courseEntry.key,
          course_name: courseEntry.course.course_name,
          level: courseEntry.course.level,
          semester: courseEntry.course.semester || selectedSemester,
          department_ids: courseEntry.departmentIds,
          uploaded_urls: mergedSharedPdfUrls,
          uploaded_at: Date.now(),
        } satisfies UploadRecord);
      }

      addToast(`${courseEntry.course.course_name} uploaded successfully.`, 'success');
      await refreshCatalog();

      // 💡 PINECONE VECTOR SYNC TRIGGER FOR UPLOAD CENTER
      try {
        const vectorSyncResponse = await fetch('/api/textbooks/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pdfUrl: primaryPdfUrl,
            courseKey: courseEntry.key,
            courseName: courseEntry.course.course_name,
            level: courseEntry.course.level,
            semester: courseEntry.course.semester || selectedSemester
          })
        });

        if (!vectorSyncResponse.ok) throw new Error("Vector ingestion endpoint dropped packet payload.");
      } catch (vectorErr: any) {
        console.error("Upload Center Vector indexing sync fallback caught:", vectorErr);
      }
    } catch (error: any) {
      console.error('Upload failed:', error);
      addToast(error?.message || 'Could not upload the course.', 'error');
    } finally {
      setIsUploadingCourseKey('');
      if (fileInputRefs.current[courseEntry.key]) {
        fileInputRefs.current[courseEntry.key]!.value = '';
      }
    }
  };

  const handleRequestUpdate = async () => {
    if (!profile) return;
    if (!requestCourseKey) {
      addToast('Select a course first.', 'error');
      return;
    }

    const selectedCourse = requestableCourses.find(entry => entry.key === requestCourseKey);
    if (!selectedCourse) {
      addToast('Choose a course with an existing textbook.', 'error');
      return;
    }

    const note = requestNote.trim();
    if (!note) {
      addToast('Add a short note for the request.', 'error');
      return;
    }

    try {
      const requestId = push(dbRef(db, `uploaders/${profile.uid}/requests`)).key;
      if (!requestId) throw new Error('Could not generate a request id.');
      await set(dbRef(db, `uploaders/${profile.uid}/requests/${requestId}`), {
        course_key: selectedCourse.key,
        course_name: selectedCourse.course.course_name,
        level: selectedCourse.course.level,
        semester: selectedCourse.course.semester || selectedSemester,
        note,
        created_at: Date.now(),
        status: 'open',
      } satisfies RequestRecord);
      setRequestNote('');
      addToast('Update request sent.', 'success');
    } catch (error: any) {
      console.error('Could not submit request:', error);
      addToast(error?.message || 'Could not submit the request.', 'error');
    }
  };

  if (isAuthLoading || (user && isProfileLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#fff7ed,_#fff)] text-slate-900">
        <div className="rounded-[28px] border border-orange-100 bg-white px-6 py-5 shadow-[0_18px_60px_rgba(234,88,12,0.14)]">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-orange-500">Upload Center</p>
          <p className="mt-2 text-lg font-bold">Loading your workspace...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.18),_transparent_40%),linear-gradient(180deg,_#fffaf5_0%,_#fff_100%)] px-4 py-8 text-slate-900">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center justify-center">
          <div className="grid w-full gap-8 rounded-[32px] border border-orange-100 bg-white/90 p-6 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur md:grid-cols-[1.1fr_0.9fr] md:p-8">
            <div className="rounded-[28px] bg-[linear-gradient(135deg,_#1f2937_0%,_#ea580c_55%,_#fdba74_100%)] p-8 text-white">
              <p className="text-xs font-black uppercase tracking-[0.3em] text-white/70">Uploader center</p>
              <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Upload courses, track your work, and request updates.</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/82 md:text-base">
                Create an uploader account with email and password, manage course uploads, and send update requests for courses that already have textbooks.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  ['Simple auth', 'Email sign up and sign in'],
                  ['Quick upload', 'Send PDFs to the right course'],
                  ['Update requests', 'Ask for extra textbooks'],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur">
                    <p className="text-sm font-bold">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-white/72">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
              <div className="flex gap-2 rounded-full bg-slate-100 p-1 text-sm font-semibold">
                <button
                  type="button"
                  onClick={() => setAuthMode('login')}
                  className={`flex-1 rounded-full px-4 py-2 transition ${authMode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('signup')}
                  className={`flex-1 rounded-full px-4 py-2 transition ${authMode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  Sign up
                </button>
              </div>

              <form onSubmit={handleAuth} className="mt-6 space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="uploader-email">Email</label>
                  <input
                    id="uploader-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="uploader-password">Password</label>
                  <input
                    id="uploader-password"
                    type="password"
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center rounded-2xl bg-slate-900 px-4 py-3.5 text-sm font-black uppercase tracking-[0.2em] text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Please wait...' : authMode === 'signup' ? 'Create uploader account' : 'Sign in'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const dashboardCards = [
    { label: 'Total uploaded', value: totalUploadedCourses.toString(), note: 'Courses you have submitted.' },
    { label: 'Update requests', value: totalRequestedCourses.toString(), note: 'Requests sent for existing courses.' },
    { label: 'Ready to upload', value: availableCourses.length.toString(), note: 'Courses with no textbook yet.' },
  ];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#fffaf5_0%,_#fff_38%,_#fff7ed_100%)] text-slate-900">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-[28px] border border-orange-100 bg-white/90 p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-orange-500">Uploader center</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight md:text-3xl">Welcome{profile.display_name ? `, ${profile.display_name}` : ''}</h1>
            <p className="mt-1 text-sm text-slate-500">Manage uploads for courses that still need textbooks, and request updates for existing ones.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/upload-center/upload')}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-orange-600"
            >
              Upload textbook
            </button>
            <button
              type="button"
              onClick={() => navigate('/upload-center/requests')}
              className="text-sm text-slate-600 underline-offset-2 hover:underline"
            >
              Requests
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-slate-600 hover:text-slate-800"
            >
              Sign out
            </button>
          </div>
        </header>

        {activeView === 'dashboard' && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="grid gap-4 sm:grid-cols-3">
              {dashboardCards.map((card) => (
                <div key={card.label} className="rounded-[24px] border border-orange-100 bg-white p-5 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{card.label}</p>
                  <p className="mt-3 text-4xl font-black tracking-tight text-slate-900">{card.value}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{card.note}</p>
                </div>
              ))}
            </section>

            <div className="space-y-4">
              <section className="rounded-[24px] border border-orange-100 bg-[linear-gradient(135deg,_#1f2937_0%,_#ea580c_100%)] p-6 text-white shadow-[0_24px_70px_rgba(234,88,12,0.2)]">
                <p className="text-xs font-black uppercase tracking-[0.28em] text-white/70">Quick action</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight">Upload a new course textbook</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-white/80">
                  Go straight to the upload page, choose a level and semester, and only the courses that still need textbooks will appear.
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/upload-center/upload')}
                  className="mt-6 rounded-full bg-white px-5 py-3 text-sm font-black uppercase tracking-[0.2em] text-slate-900 transition hover:bg-orange-50"
                >
                  Go to upload page
                </button>
              </section>

              <section className="rounded-[24px] border border-orange-100 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-500">Recent uploads</p>
                    <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Extracted topics from uploaded textbooks</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/upload-center/upload')}
                    className="text-sm text-slate-600 underline-offset-2 hover:underline"
                  >
                    Upload more
                  </button>
                </div>

                {recentUploads.length ? (
                  <div className="mt-4 space-y-3">
                    {recentUploads.map(({ upload, catalogEntry }) => {
                      const topics = previewTopics(catalogEntry?.course.topics);
                      return (
                        <div key={`${upload.course_key}-${upload.uploaded_at}`} onClick={() => navigate('/upload-center/upload')} role="button" tabIndex={0} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 cursor-pointer">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h4 className="text-base font-bold text-slate-900">{upload.course_name}</h4>
                              <p className="text-sm text-slate-500">{upload.level} {upload.semester}</p>
                              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-orange-500">
                                {catalogEntry?.hasTextbook ? 'Topics extracted from textbook' : 'Awaiting syllabus sync'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => navigate('/upload-center/upload')}
                              className="text-sm text-slate-600 underline-offset-2 hover:underline"
                            >
                              Open
                            </button>
                          </div>

                          {topics.length ? (
                            <div className="mt-4 grid gap-2 sm:grid-cols-2">
                              {topics.map((topic) => (
                                <div key={topic.topic_id} className="rounded-2xl border border-white bg-white px-3 py-3 shadow-sm">
                                  <p className="text-sm font-bold text-slate-900">{topic.topic_name}</p>
                                  {topic.topic_context ? <p className="mt-1 text-xs leading-5 text-slate-500">{topic.topic_context}</p> : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-3 text-sm leading-6 text-slate-500">No extracted topics are available for this upload yet.</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-slate-500">Uploaded textbook topics will appear here after Gemini extracts them.</p>
                )}
              </section>

              <section className="rounded-[24px] border border-orange-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-500">Requested courses</p>
                    <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Upload extra books for these courses</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/upload-center/requests')}
                    className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-orange-200 hover:text-orange-600"
                  >
                    Manage requests
                  </button>
                </div>

                {requestedCourseEntries.length ? (
                  <div className="mt-4 space-y-3">
                    {requestedCourseEntries.slice(0, 4).map(({ request, catalogEntry }) => (
                      <div key={request.course_key} onClick={() => navigate('/upload-center/upload')} role="button" tabIndex={0} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 cursor-pointer">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <h4 className="text-base font-bold text-slate-900">{request.course_name}</h4>
                            <p className="text-sm text-slate-500">{request.level} {request.semester}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{request.note}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => navigate('/upload-center/upload')}
                            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-orange-600"
                          >
                            Upload additional books
                          </button>
                        </div>
                        {!catalogEntry && (
                          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-orange-500">Waiting for course sync</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-slate-500">
                    Requested courses will appear here after you ask for a course that already has textbooks.
                  </p>
                )}
              </section>
            </div>
          </div>
        )}

        {activeView === 'upload' && !appSettings.upload_center_uploads_enabled && (
          <div className="mt-6 rounded-[28px] border border-orange-100 bg-white p-6 shadow-sm md:p-8">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-500">Uploads paused</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Textbook uploads are temporarily disabled.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              An admin has paused textbook uploads from the upload center. You can still browse requests and return here when uploads reopen.
            </p>
            <button
              type="button"
              onClick={() => navigate('/upload-center')}
              className="mt-6 rounded-full bg-slate-900 px-5 py-3 text-sm font-black uppercase tracking-[0.2em] text-white transition hover:bg-orange-600"
            >
              Back to dashboard
            </button>
          </div>
        )}

        {activeView === 'upload' && appSettings.upload_center_uploads_enabled && (
          <div className="mt-6 space-y-6">
            <section className="rounded-[28px] border border-orange-100 bg-white p-5 shadow-sm md:p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-500">Course upload</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight">Select level and semester</h2>
                  <p className="mt-1 text-sm text-slate-500">Only courses without a textbook are shown below.</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/upload-center')}
                  className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  Back to dashboard
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Level</span>
                  <select
                    value={selectedLevel}
                    onChange={(event) => setSelectedLevel(event.target.value as (typeof LEVELS)[number])}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  >
                    {LEVELS.map((level) => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Semester</span>
                  <select
                    value={selectedSemester}
                    onChange={(event) => setSelectedSemester(event.target.value as (typeof SEMESTERS)[number])}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  >
                    {SEMESTERS.map((semester) => (
                      <option key={semester} value={semester}>{semester}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            {requestedCourseEntries.length > 0 && (
              <section className="rounded-[28px] border border-orange-100 bg-white p-5 shadow-sm md:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-500">Requested courses</p>
                    <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Upload additional books here too</h3>
                    <p className="mt-1 text-sm text-slate-500">These are courses you requested for extra textbooks.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/upload-center')}
                    className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
                  >
                    Back to dashboard
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {requestedCourseEntries.map(({ request, catalogEntry }) => {
                    const requestKey = request.course_key;
                    return (
                      <div key={requestKey} className="rounded-[24px] border border-orange-100 bg-slate-50 p-5 shadow-sm">
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-500">Requested course</p>
                        <h4 className="mt-2 text-lg font-black tracking-tight text-slate-900">{request.course_name}</h4>
                        <p className="mt-1 text-sm text-slate-500">{request.level} {request.semester}</p>
                        <p className="mt-3 text-sm leading-6 text-slate-600">{request.note}</p>
                        <div className="mt-4">
                          <input
                            ref={(node) => { fileInputRefs.current[requestKey] = node; }}
                            type="file"
                            accept="application/pdf"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                              if (event.target.files?.length && catalogEntry) {
                                void handleFileUpload(catalogEntry, event.target.files);
                              }
                            }}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (catalogEntry) {
                                  fileInputRefs.current[requestKey]?.click();
                                } else {
                                  addToast('This course is still syncing. Try again in a moment.', 'info');
                                }
                              }}
                              disabled={!catalogEntry || isUploadingCourseKey === requestKey}
                              className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isUploadingCourseKey === requestKey ? 'Uploading...' : 'Upload'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (catalogEntry) {
                                  handleGoogleDrivePick((files) => handleFileUpload(catalogEntry, files));
                                } else {
                                  addToast('This course is still syncing. Try again in a moment.', 'info');
                                }
                              }}
                              disabled={!catalogEntry || isUploadingCourseKey === requestKey}
                              className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center hover:bg-blue-100 transition disabled:opacity-50"
                            >
                              <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {isCatalogLoading ? (
                <div className="rounded-[24px] border border-dashed border-orange-200 bg-white p-6 text-sm text-slate-500 md:col-span-2 xl:col-span-3">Loading courses...</div>
              ) : availableCourses.length ? (
                availableCourses.map((entry) => (
                  <div key={entry.key} className="rounded-[24px] border border-orange-100 bg-white p-5 shadow-sm">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-500">No textbook uploaded</p>
                    <h3 className="mt-2 text-xl font-black tracking-tight text-slate-900">{entry.course.course_name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{entry.course.course_code || entry.course.course_id}</p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                      <span className="rounded-full bg-slate-100 px-3 py-1">{entry.course.level}</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1">{entry.course.semester || selectedSemester}</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1">{entry.departmentIds.length} department{entry.departmentIds.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="mt-5 flex gap-2">
                      <input
                        ref={(node) => { fileInputRefs.current[entry.key] = node; }}
                        type="file"
                        accept="application/pdf"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          if (event.target.files?.length) {
                            void handleFileUpload(entry, event.target.files);
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRefs.current[entry.key]?.click()}
                        disabled={isUploadingCourseKey === entry.key}
                        className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isUploadingCourseKey === entry.key ? 'Uploading...' : 'Upload textbook PDF'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleGoogleDrivePick((files) => handleFileUpload(entry, files))}
                        disabled={isUploadingCourseKey === entry.key}
                        className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center hover:bg-blue-100 transition disabled:opacity-50"
                      >
                        <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-orange-200 bg-white p-6 text-sm text-slate-500 md:col-span-2 xl:col-span-3">
                  No open courses match this level and semester.
                </div>
              )}
            </section>
          </div>
        )}

        {activeView === 'requests' && (
          <div className="mt-6 space-y-6">
            <section className="rounded-[28px] border border-orange-100 bg-white p-5 shadow-sm md:p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-500">Update request</p>
                  <h2 className="mt-1 text-2xl font-black tracking-tight">Request an extra textbook</h2>
                  <p className="mt-1 text-sm text-slate-500">Use this when a course already has textbooks but needs more material added.</p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/upload-center/upload')}
                  className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  Go to upload page
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-[0.9fr_1.1fr]">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Course with textbook</span>
                  <select
                    value={requestCourseKey}
                    onChange={(event) => setRequestCourseKey(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  >
                    {requestableCourses.length ? (
                      requestableCourses.map((entry) => (
                        <option key={entry.key} value={entry.key}>{entry.course.course_name} - {entry.course.level} {entry.course.semester || selectedSemester}</option>
                      ))
                    ) : (
                      <option value="">No existing-textbook courses for this selection</option>
                    )}
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-700">Request note</span>
                  <textarea
                    value={requestNote}
                    onChange={(event) => setRequestNote(event.target.value)}
                    placeholder="Explain the extra textbook or update needed"
                    rows={4}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => void handleRequestUpdate()}
                className="mt-4 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:bg-orange-600"
              >
                Send request
              </button>
            </section>

            <section className="rounded-[28px] border border-orange-100 bg-white p-5 shadow-sm md:p-6">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-500">Your requested courses</p>
              <h3 className="mt-1 text-xl font-black tracking-tight text-slate-900">Ready when you are</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {requestedCourseEntries.map(({ request, catalogEntry }) => (
                  <div key={`request-${request.course_key}-${request.created_at}`} className="rounded-[24px] border border-orange-100 bg-slate-50 p-5 shadow-sm">
                    <h4 className="text-lg font-black tracking-tight text-slate-900">{request.course_name}</h4>
                    <p className="mt-1 text-sm text-slate-500">{request.level} {request.semester}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{request.note}</p>
                    <button
                      type="button"
                      onClick={() => navigate('/upload-center/upload')}
                      className="mt-4 text-sm text-slate-600 underline-offset-2 hover:underline"
                    >
                      Upload
                    </button>
                    {!catalogEntry && (
                      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-orange-500">Waiting for course sync</p>
                    )}
                  </div>
                ))}
                {!requestedCourseEntries.length && (
                  <div className="rounded-[24px] border border-dashed border-orange-200 bg-white p-6 text-sm text-slate-500 md:col-span-2 xl:col-span-3">
                    No requested courses yet.
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {requests.slice(0, 6).map((request) => (
                <div key={`${request.course_key}-${request.created_at}`} className="rounded-[24px] border border-orange-100 bg-white p-5 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-500">Open request</p>
                  <h3 className="mt-2 text-lg font-black tracking-tight text-slate-900">{request.course_name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{request.level} {request.semester}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{request.note}</p>
                </div>
              ))}
              {!requests.length && (
                <div className="rounded-[24px] border border-dashed border-orange-200 bg-white p-6 text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                  No update requests yet.
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
