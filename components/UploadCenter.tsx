import { auth as firebaseAuth, createUserWithEmailAndPassword, db, deleteObject, firebaseSignOut, get, getDownloadURL, onAuthStateChanged, onValue, push, ref as dbRef, ref as storageRef, remove, set, signInWithEmailAndPassword, storage, update, uploadBytes } from '@/lib/backend';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createAvelutAI, getResponseText, Type } from '../utils/inference';
import { useToast } from '../hooks/useToast';
import { getFeatureModel } from '../utils/usage';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import { useGoogleDrivePicker } from '../hooks/useGoogleDrivePicker';
import type { Course, Topic } from '../types';
import { getWindowPathname } from '../utils/pathname';
import { PDFDocument } from 'pdf-lib';
import { PageSkeleton } from './Skeleton';
import { SchoolHierarchySelector } from './SchoolHierarchySelector';
import { UploadCloud, X, LayoutDashboard, BookOpen, FolderOpen, FileQuestion, List, Menu, HardDrive, ChevronRight, Plus, Trash2, Layers } from 'lucide-react';

function uint8ToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return window.btoa(binary);
}

const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'] as const;
const SEMESTERS = ['first', 'second'] as const;

type AuthMode = 'login' | 'signup';
type UploadCenterView = 'dashboard' | 'departments' | 'requests' | 'courses' | 'past_questions';

type UploaderProfile = {
  uid: string;
  email: string;
  created_at: number;
  display_name?: string;
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

const isTextbookUploaded = (course: Course) => normalizeTextbookUrls(course).length > 0 || Boolean((course as Course & { textbook_shared_key?: string }).textbook_shared_key);
const isPQUploaded = (course: Course, deptId: string, pqIdx: Record<string, any>) => {
    if (!deptId || !course.level || !course.course_id || !pqIdx) return false;
    return Boolean(pqIdx[deptId]?.[course.level]?.[course.course_id]);
};

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
  const aiModel = getFeatureModel('study_guide_extraction', appSettings);
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
  
  const [schoolsData, setSchoolsData] = useState<any>({});
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [selectedCollegeId, setSelectedCollegeId] = useState<string>('');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState<(typeof LEVELS)[number]>('100lvl');
  const [selectedSemester, setSelectedSemester] = useState<(typeof SEMESTERS)[number]>('first');
  
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseCode, setNewCourseCode] = useState('');
  const [isAddingCourse, setIsAddingCourse] = useState(false);
  const [newCourseType, setNewCourseType] = useState<'private' | 'general'>('private');

  const [extractedCourses, setExtractedCourses] = useState<{ course_name: string; course_code: string; selected: boolean; type: 'private' | 'general' }[]>([]);
  const [isExtractingCourses, setIsExtractingCourses] = useState(false);

  const [courseSearchQuery, setCourseSearchQuery] = useState('');

  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [isUploadingCourseKey, setIsUploadingCourseKey] = useState('');
  const [uploadProgress, setUploadProgress] = useState<{ status: string; percent: number } | null>(null);
  const [pqIndex, setPqIndex] = useState<Record<string, Record<string, any>>>({});
  const [uploadModal, setUploadModal] = useState<{course: any, courseKey: string, deptPath: string} | null>(null);
  const [uploadType, setUploadType] = useState<'textbook'|'past_question'>('textbook');
  const [pqYear, setPqYear] = useState(new Date().getFullYear().toString());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const activeView: UploadCenterView = useMemo(() => {
    if (pathname.startsWith('/upload-center/courses')) return 'courses';
    if (pathname.startsWith('/upload-center/past-questions')) return 'past_questions';
    if (pathname.startsWith('/upload-center/requests')) return 'requests';
    if (pathname.startsWith('/upload-center/departments')) return 'departments';
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
    }, (err) => {
      console.error(err);
      setProfile(null);
      setIsProfileLoading(false);
    });

    const uploadsRef = dbRef(db, `uploaders/${user.uid}/uploads`);
    const unsubscribeUploads = onValue(uploadsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setUploads((Object.values(data) as UploadRecord[]).sort((a, b) => b.uploaded_at - a.uploaded_at));
    });

    const requestsRef = dbRef(db, `uploaders/${user.uid}/requests`);
    const unsubscribeRequests = onValue(requestsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setRequests((Object.values(data) as RequestRecord[]).sort((a, b) => b.created_at - a.created_at));
    });

    return () => {
      unsubscribeProfile();
      unsubscribeUploads();
      unsubscribeRequests();
    };
  }, [user]);

  const loadCatalog = async () => {
    setIsCatalogLoading(true);
    try {
      const [schoolsSnap, deptsSnap, pqSnap] = await Promise.all([
        get(dbRef(db, 'schools_data')),
        get(dbRef(db, 'departments_data')),
        get(dbRef(db, 'past_questions'))
      ]);
      
      if (pqSnap.exists()) {
          setPqIndex(pqSnap.val());
      } else {
          setPqIndex({});
      }
      
      const newSchoolsData = schoolsSnap.exists() ? schoolsSnap.val() : {};
      const oldDeptsData = deptsSnap.exists() ? deptsSnap.val() : {};

      // Merge old courses into schoolsData
      if (Object.keys(oldDeptsData).length > 0) {
          Object.keys(newSchoolsData).forEach(sId => {
              const school = newSchoolsData[sId];
              if (school.colleges) {
                  Object.keys(school.colleges).forEach(cId => {
                      const college = school.colleges[cId];
                      if (college.departments) {
                          Object.keys(college.departments).forEach(dId => {
                              const dept = college.departments[dId];
                              if (oldDeptsData[dId] && oldDeptsData[dId].course_list) {
                                  // old courses were a flat object. We need to group them by level.
                                  const oldCourses = Object.values(oldDeptsData[dId].course_list);
                                  oldCourses.forEach((oldC: any) => {
                                      const lvl = normalizeLevel(oldC.level);
                                      if (!dept.levels) dept.levels = {};
                                      if (!dept.levels[lvl]) dept.levels[lvl] = { courses: {} };
                                      if (!dept.levels[lvl].courses) dept.levels[lvl].courses = {};
                                      
                                      const cId = oldC.course_id || oldC.course_name;
                                      if (cId && !dept.levels[lvl].courses[cId]) {
                                          dept.levels[lvl].courses[cId] = oldC;
                                      }
                                  });
                              }
                          });
                      }
                  });
              }
          });
      }

      setSchoolsData(newSchoolsData);
    } catch (error) {
      console.error('Failed to load schools data:', error);
      addToast('Could not load the course list.', 'error');
    } finally {
      setIsCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      void loadCatalog();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    // Reset down-chain selections
    setSelectedCollegeId('');
    setSelectedDepartmentId('');
  }, [selectedSchoolId]);

  useEffect(() => {
    setSelectedDepartmentId('');
  }, [selectedCollegeId]);

  const navigate = (nextPath: string) => {
    if (typeof window === 'undefined') return;
    window.history.pushState(null, '', nextPath);
    setPathname(nextPath);
    setIsMobileMenuOpen(false);
  };

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
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
          const displayName = createUserDisplayName(credential.user.email || email.trim());
          await set(dbRef(db, `uploaders/${credential.user.uid}`), {
            uid: credential.user.uid,
            email: credential.user.email || email.trim(),
            display_name: displayName,
            created_at: Date.now(),
          });
          addToast('Account upgraded to Uploader.', 'success');
        } else {
          addToast('Signed in successfully.', 'success');
        }
      }
    } catch (error: any) {
      addToast(error?.message || 'Could not sign in.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await firebaseSignOut(firebaseAuth);
      setProfile(null);
      navigate('/upload-center');
    } catch (error: any) {
      addToast(error?.message || 'Could not sign out.', 'error');
    }
  };

  const handleGoogleDrivePick = (onFilesSelected: (files: File[]) => void) => {
    openPicker({
      clientId: appSettings.google_client_id || '',
      apiKey: appSettings.google_api_key || '',
      onFilesSelected,
      onProgress: (status, percent) => {
        setUploadProgress({ status, percent });
      }
    });
  };

  const handleFileUpload = async (course: Course, courseKey: string, deptPath: string, files: FileList | File[], type: 'textbook'|'past_question', year?: string) => {
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser || !profile) return addToast('Please sign in again.', 'error');
    if (!ai) return addToast('AI features unavailable.', 'error');
    if (!appSettings.upload_center_uploads_enabled) return addToast('Uploads are disabled.', 'error');

    const pdfFiles = Array.from(files).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!pdfFiles.length) return addToast('Please choose PDF files only.', 'error');

    setIsUploadingCourseKey(courseKey);
    setUploadProgress({ status: 'Starting upload...', percent: 5 });
    
    try {
      const uploadedUrls: string[] = [];
      const extractedTopicGroups: Topic[][] = [];
      let extractedQuestions: any[] = [];

      for (let index = 0; index < pdfFiles.length; index += 1) {
        const file = pdfFiles[index];
        setUploadProgress({ status: `Uploading PDF to storage (${index + 1}/${pdfFiles.length})...`, percent: 10 + (index * 5) });
        const uploadToken = `${Date.now()}_${index}_${file.lastModified}_${file.size}`;
        const fileRef = storageRef(storage, `textbooks/uploader/${currentUser.uid}/${courseKey}/${uploadToken}_${file.name}`);
        const result = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(result.ref);
        uploadedUrls.push(downloadURL);

        setUploadProgress({ status: `Extracting textbook contents (${index + 1}/${pdfFiles.length})...`, percent: 20 + (index * 5) });
        
        let base64Chunks: string[] = [];
        if (file.size > 15 * 1024 * 1024) {
          setUploadProgress({ status: `Splitting large PDF into chunks (${index + 1}/${pdfFiles.length})...`, percent: 25 + (index * 5) });
          try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFDocument.load(arrayBuffer);
            const totalPages = pdfDoc.getPageCount();
            const chunkCount = 3;
            const pagesPerChunk = Math.ceil(totalPages / chunkCount);
            
            for (let i = 0; i < chunkCount; i++) {
              const startPage = i * pagesPerChunk;
              if (startPage >= totalPages) break;
              const endPage = Math.min(startPage + pagesPerChunk, totalPages);
              
              const newPdfDoc = await PDFDocument.create();
              const pageIndices = Array.from({ length: endPage - startPage }, (_, k) => startPage + k);
              const copiedPages = await newPdfDoc.copyPages(pdfDoc, pageIndices);
              copiedPages.forEach((page) => newPdfDoc.addPage(page));
              
              const pdfBytes = await newPdfDoc.save();
              base64Chunks.push(uint8ToBase64(pdfBytes));
            }
          } catch (e) {
            console.warn("PDF splitting failed, using whole file", e);
            base64Chunks = [await fileToBase64(file)];
          }
        } else {
          base64Chunks = [await fileToBase64(file)];
        }
        
        setUploadProgress({ status: `AI extracting syllabus topics (${index + 1}/${pdfFiles.length})...`, percent: 35 + (index * 5) });

        
        const textbookPrompt = `Analyze this PDF textbook for "${course.course_name}" at "${course.level}" level.
First, determine if this document is ACTUALLY related to the course "${course.course_name}".
If it is completely unrelated (e.g. a cooking recipe for a Math course), set "is_related" to false and provide an "unrelated_reason" explaining why.
If it is related, set "is_related" to true and extract a comprehensive syllabus/course outline into a structured JSON array of topics with concise grounding context.
RULES:
1. Output ONLY the JSON object.
2. The root object must have "is_related" (boolean), "unrelated_reason" (string, optional), and "syllabus" (array) keys.
3. Each topic object must have: topic_name, topic_id, topic_context, start_point, end_point.
FORMAT: { "is_related": true, "unrelated_reason": "", "syllabus": [ { "topic_name": "...", "topic_id": "...", "topic_context": "...", "start_point": "...", "end_point": "..." } ] }`;

        const pqPrompt = `Analyze this PDF past question paper for "${course.course_name}".
First, determine if this document is ACTUALLY related to the course "${course.course_name}".
If it is completely unrelated, set "is_related" to false and provide an "unrelated_reason" explaining why.
If it is related, set "is_related" to true and extract all the questions and their options.
RULES:
1. Output ONLY the JSON object.
2. The root object must have "is_related" (boolean), "unrelated_reason" (string, optional), and "questions" (array) keys.
3. Each question object must have: "question" (string), "options" (array of strings), "correctAnswer" (string), "explanation" (string).
FORMAT: { "is_related": true, "unrelated_reason": "", "questions": [ { "question": "...", "options": ["..."], "correctAnswer": "...", "explanation": "..." } ] }`;

        const chunkPromises = base64Chunks.map(async (chunkBase64) => {
          return attemptApiCall(async () => {
            const aiResponse = await ai.models.generateContent({
              model: aiModel,
              contents: [{ role: 'user', parts: [{ text: type === 'textbook' ? textbookPrompt : pqPrompt }, { inlineData: { mimeType: 'application/pdf', data: chunkBase64 } }] }],
              config: {
                responseMimeType: 'application/json',
                responseSchema: type === 'textbook' ? {
                  type: Type.OBJECT,
                  properties: {
                    is_related: { type: Type.BOOLEAN },
                    unrelated_reason: { type: Type.STRING },
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
                  required: ['is_related', 'syllabus']
                } : {
                  type: Type.OBJECT,
                  properties: {
                    is_related: { type: Type.BOOLEAN },
                    unrelated_reason: { type: Type.STRING },
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
                  required: ['is_related', 'questions']
                }
              },
            });
  
            const text = getResponseText(aiResponse);
            if (!text) throw new Error(`AI returned an empty response.`);
            const parsed = JSON.parse(text);
            if (parsed.is_related === false) {
                throw new Error(`Upload Rejected: ${parsed.unrelated_reason || 'Document is not related to this course.'}`);
            }
            return parsed;
          });
        });

        const chunkResults = await Promise.all(chunkPromises);

        for (const aiResult of chunkResults) {
          if (!aiResult.success) {
            addToast(aiResult.message, 'error');
            setIsUploadingCourseKey('');
            return;
          }
          const responseData = aiResult.data as any;
          if (type === 'textbook') {
              extractedTopicGroups.push(Array.isArray(responseData?.syllabus) ? responseData.syllabus.map((t: any, i: number) => sanitizeTopicMetadata(t, i)) : []);
          } else {
              if (Array.isArray(responseData?.questions)) {
                  extractedQuestions = [...extractedQuestions, ...responseData.questions];
              }
          }
        }
      }

      if (type === 'past_question' && year) {
          // Save Past Questions
          const resolvedDeptId = deptPath.split('/').pop() || selectedDepartmentId;
          const pqPath = `past_questions/${resolvedDeptId}/${course.level}/${course.course_id}/${year}`;
          await set(dbRef(db, pqPath), extractedQuestions);
          addToast(`Past Questions for ${year} uploaded successfully.`, 'success');
          await loadCatalog();
          setIsUploadingCourseKey('');
          setUploadProgress(null);
      } else {
          // Save Textbook Logic
          const sharedSnapshot = await get(dbRef(db, `textbook_contexts/shared/${courseKey}`));
          const existingShared = sharedSnapshot.exists() ? sharedSnapshot.val() : {};
          const existingSharedPdfUrls: string[] = Array.isArray(existingShared?.pdf_urls) ? existingShared.pdf_urls.filter(Boolean) : [];
          if (existingShared?.pdf_url && !existingSharedPdfUrls.includes(existingShared.pdf_url)) existingSharedPdfUrls.push(existingShared.pdf_url);
          
          const mergedSharedPdfUrls = Array.from(new Set([...existingSharedPdfUrls, ...uploadedUrls]));
          const mergedSharedSyllabus = mergeTopics(Array.isArray(existingShared?.syllabus) ? existingShared.syllabus : [], extractedTopicGroups.flat());
          const primaryPdfUrl = selectPrimaryPdfUrl(uploadedUrls, existingShared?.pdf_url, mergedSharedPdfUrls);

          await set(dbRef(db, `textbook_contexts/shared/${courseKey}`), {
            course_key: courseKey,
            course_name: course.course_name,
            level: course.level,
            semester: course.semester || selectedSemester,
            pdf_url: primaryPdfUrl,
            pdf_urls: mergedSharedPdfUrls,
            syllabus: mergedSharedSyllabus,
            uploaded_at: Date.now(),
            uploader_uid: currentUser.uid,
          });

          const coursesRef = dbRef(db, `schools_data/${deptPath}/levels/${course.level}/courses`);
          const coursesSnapshot = await get(coursesRef);
          const existingCourse = (coursesSnapshot.val() || {})[course.course_id] || {};
          
          const mergedCourse = mergeCourseRecord({ ...existingCourse, course_id: course.course_id }, {
            ...course,
            textbook_url: primaryPdfUrl,
            textbook_urls: mergedSharedPdfUrls,
            textbook_shared_key: courseKey,
          }, mergedSharedSyllabus, mergedSharedPdfUrls);
          
          await update(dbRef(db, `schools_data/${deptPath}/levels/${course.level}/courses/${course.course_id}`), mergedCourse);

          const uploadRecordId = push(dbRef(db, `uploaders/${currentUser.uid}/uploads`)).key;
          if (uploadRecordId) {
            await set(dbRef(db, `uploaders/${currentUser.uid}/uploads/${uploadRecordId}`), {
              course_key: courseKey,
              course_name: course.course_name,
              level: course.level,
              semester: course.semester || selectedSemester,
              department_ids: [deptPath],
              uploaded_urls: mergedSharedPdfUrls,
              uploaded_at: Date.now(),
            } satisfies UploadRecord);
          }

          addToast(`${course.course_name} textbook uploaded successfully.`, 'success');
          await loadCatalog();

          try {
            setUploadProgress({ status: 'Preparing PDF text for vector indexing...', percent: 60 });
            const { extractTextFromPDF } = await import('../utils/pdfExtraction');
            const { ingestTextToPinecone } = await import('../utils/pinecone');

            addToast('Extracting textbook content...', 'info');
            setUploadProgress({ status: 'Parsing raw text from PDF for database...', percent: 65 });
            const rawText = await extractTextFromPDF(pdfFiles[0]);
            
            addToast('Syncing to Pinecone database...', 'info');
            setUploadProgress({ status: 'Connecting to Pinecone...', percent: 70 });
            const ingestResult = await ingestTextToPinecone(
              rawText, courseKey, course.course_name, course.level, course.semester || selectedSemester, appSettings,
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
                setUploadProgress({ status: progress, percent });
              }
            );

            if (!ingestResult.success) throw new Error(ingestResult.message || "Vector ingestion failed.");
            addToast('Pinecone vector indexing complete!', 'success');
          } catch (vectorErr: any) {
            console.error("Vector index error:", vectorErr);
            addToast('Warning: Textbook uploaded but vector search sync failed.', 'info');
          }
      }
      
    } catch (error: any) {
      addToast(error?.message || 'Could not upload the course.', 'error');
    } finally {
      setIsUploadingCourseKey('');
      setUploadProgress(null);
      if (fileInputRefs.current[courseKey]) fileInputRefs.current[courseKey]!.value = '';
    }
  };

  const handleAddCourse = async () => {
    if (!newCourseName.trim() || !newCourseCode.trim()) return addToast('Please enter a course name and code.', 'error');
    if (!selectedSchoolId || !selectedCollegeId || !selectedDepartmentId) return addToast('Please select a department.', 'error');
    
    setIsAddingCourse(true);
    try {
      const courseId = newCourseCode.trim().toLowerCase().replace(/\s+/g, '');
      const courseData: Partial<Course> = {
        course_id: courseId,
        course_name: newCourseName.trim(),
        course_code: newCourseCode.trim().toUpperCase(),
        level: selectedLevel,
        semester: selectedSemester,
        course_status: 'active',
      };
      
      if (newCourseType === 'general') {
         const college = schoolsData[selectedSchoolId]?.colleges?.[selectedCollegeId];
         if (!college || !college.departments) throw new Error("College data missing");
         
         const updates: any = {};
         Object.keys(college.departments).forEach(deptId => {
             updates[`schools_data/${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${deptId}/levels/${selectedLevel}/courses/${courseId}`] = courseData;
         });
         await update(dbRef(db), updates);
         addToast(`General course added to ${Object.keys(college.departments).length} departments!`, 'success');
      } else {
         const deptPath = `${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${selectedDepartmentId}`;
         const newCourseRef = dbRef(db, `schools_data/${deptPath}/levels/${selectedLevel}/courses/${courseId}`);
         await set(newCourseRef, courseData);
         addToast('Private course added successfully!', 'success');
      }
      
      setNewCourseName('');
      setNewCourseCode('');
      setIsAddingCourse(false);
      await loadCatalog();
    } catch (error: any) {
      addToast(error.message || 'Failed to add course', 'error');
    } finally {
      setIsAddingCourse(false);
    }
  };

  const handleExtractCoursesFromPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!ai || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    // Support PDFs and common image formats (photos of printed course forms / timetables)
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|bmp|gif)$/i.test(file.name);
    
    if (!isPdf && !isImage) {
      return addToast('Please upload a PDF or image of your course form.', 'error');
    }

    setIsExtractingCourses(true);
    try {
      const base64Chunk = await fileToBase64(file);
      const mimeType = isPdf ? 'application/pdf' : (file.type || 'image/jpeg');
      const prompt = `Analyze this course form, timetable, syllabus, or academic document carefully.
Extract all course names and their corresponding course codes (for example: "Elementary Mathematics I" with code "MTH101", "Introduction to Programming" with code "CSC101").
Return a JSON object with a 'courses' array, where each item has 'course_name' and 'course_code'.`;

      const aiResponse = await attemptApiCall(() => ai.models.generateContent({
        model: aiModel,
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Chunk } }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              courses: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    course_name: { type: Type.STRING },
                    course_code: { type: Type.STRING }
                  },
                  required: ['course_name', 'course_code']
                }
              }
            },
            required: ['courses']
          }
        },
      }));

      const text = getResponseText(aiResponse);
      if (!text) throw new Error("Failed to get response from AI");
      
      // Robust JSON extraction handling any markdown wrappers
      let cleanJson = text.trim();
      const codeBlockMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        cleanJson = codeBlockMatch[1].trim();
      }
      const firstBrace = cleanJson.indexOf('{');
      const lastBrace = cleanJson.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
      }

      const data = JSON.parse(cleanJson);
      if (data.courses && Array.isArray(data.courses) && data.courses.length > 0) {
        const validated = data.courses
          .filter((c: any) => c && (c.course_name || c.name) && (c.course_code || c.code))
          .map((c: any) => ({
            course_name: String(c.course_name || c.name).trim(),
            course_code: String(c.course_code || c.code).trim().toUpperCase(),
            selected: true,
            type: 'private' as const,
          }));

        if (validated.length === 0) {
          throw new Error("No valid courses could be identified in the uploaded document.");
        }

        setExtractedCourses(validated);
        addToast(`Extracted ${validated.length} courses successfully!`, 'success');
      } else {
        throw new Error("No courses found in the document. Please verify the document has clear course titles and codes.");
      }
    } catch (err: any) {
      console.error('Course form extraction error:', err);
      addToast(err.message || 'Failed to extract courses from the document.', 'error');
    } finally {
      setIsExtractingCourses(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSaveExtractedCourses = async () => {
    const coursesToSave = extractedCourses.filter(c => c.selected && c.course_name.trim() && c.course_code.trim());
    if (coursesToSave.length === 0) return addToast('No valid courses selected.', 'error');
    if (!selectedSchoolId || !selectedCollegeId || !selectedDepartmentId) {
      return addToast('Please select a school, college, and department first.', 'error');
    }

    setIsExtractingCourses(true); // Re-use loading state
    try {
      const updates: any = {};
      const college = schoolsData[selectedSchoolId]?.colleges?.[selectedCollegeId];

      coursesToSave.forEach(course => {
        const courseId = course.course_code.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        const courseData: Partial<Course> = {
          course_id: courseId,
          course_name: course.course_name.trim(),
          course_code: course.course_code.trim().toUpperCase(),
          level: selectedLevel,
          semester: selectedSemester,
          course_status: 'active',
        };

        if (course.type === 'general') {
           if (college && college.departments) {
               Object.keys(college.departments).forEach(deptId => {
                   updates[`schools_data/${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${deptId}/levels/${selectedLevel}/courses/${courseId}`] = courseData;
               });
           }
        } else {
           const deptPath = `${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${selectedDepartmentId}`;
           updates[`schools_data/${deptPath}/levels/${selectedLevel}/courses/${courseId}`] = courseData;
        }
      });

      if (Object.keys(updates).length > 0) {
         await update(dbRef(db), updates);
         addToast(`Successfully saved ${coursesToSave.length} courses!`, 'success');
      }

      setExtractedCourses([]);
      setIsAddingCourse(false);
      await loadCatalog();
    } catch (err: any) {
      addToast(err.message || 'Failed to save batch courses', 'error');
    } finally {
      setIsExtractingCourses(false);
    }
  };

  const handleDeleteCourse = async (course: any) => {
    const courseId = course.course_id;
    const courseName = course.course_name;
    const courseKey = getCourseMergeKey(course);
    const deptPath = `${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${selectedDepartmentId}`;

    if (!window.confirm(`Are you sure you want to delete ${courseName}? This action cannot be undone.`)) return;
    
    try {
      // 1. Delete from Firebase Storage
      const urlsToDelete = normalizeTextbookUrls(course);
      if (urlsToDelete.length > 0) {
        for (const url of urlsToDelete) {
          try {
            const fileRef = storageRef(storage, url);
            await deleteObject(fileRef);
          } catch (storageErr) {
            console.error("Failed to delete file from storage:", url, storageErr);
          }
        }
      }

      // 2. Delete from Pinecone
      if (courseKey) {
        try {
          const { deleteCourseFromPinecone } = await import('../utils/pinecone');
          await deleteCourseFromPinecone(courseKey, appSettings);
        } catch (pineconeErr) {
          console.error("Failed to delete from Pinecone:", pineconeErr);
        }
      }

      // 3. Delete from Firebase Database
      await remove(dbRef(db, `schools_data/${deptPath}/levels/${selectedLevel}/courses/${courseId}`));
      
      // Also remove any shared textbook contexts
      if (courseKey) {
        await remove(dbRef(db, `textbook_contexts/shared/${courseKey}`));
      }

      addToast('Course and associated files deleted successfully.', 'success');
      await loadCatalog();
    } catch (error: any) {
      addToast(error.message || 'Failed to delete course', 'error');
    }
  };

  const renderAuth = () => (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_40%),linear-gradient(180deg,_#f0f9ff_0%,_#fff_100%)] px-4 py-8  dark:text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center justify-center">
        <div className="grid w-full gap-8 rounded-[32px] border border-sky-100 bg-white p-6 shadow-xl backdrop-blur md:grid-cols-[1.1fr_0.9fr] md:p-8">
          <div className="rounded-[28px] bg-[linear-gradient(135deg,_#0f172a_0%,_#0284c7_55%,_#38bdf8_100%)] p-8 text-white">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-white/70">Uploader center</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Upload courses, track your work, and request updates.</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/80">
              Create an uploader account to manage course materials across all schools, colleges, and departments securely.
            </p>
          </div>
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 md:p-8">
            <div className="flex gap-2 rounded-full bg-slate-100 p-1 text-sm font-semibold">
              <button onClick={() => setAuthMode('login')} className={`flex-1 rounded-full px-4 py-2 transition ${authMode === 'login' ? 'bg-white  dark:text-white shadow-sm' : 'text-slate-500'}`}>Sign in</button>
              <button onClick={() => setAuthMode('signup')} className={`flex-1 rounded-full px-4 py-2 transition ${authMode === 'signup' ? 'bg-white  dark:text-white shadow-sm' : 'text-slate-500'}`}>Sign up</button>
            </div>
            <form onSubmit={handleAuth} className="mt-6 space-y-4">
              <input type="email" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" />
              <input type="password" required placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" />
              <button type="submit" disabled={isSubmitting} className="w-full rounded-2xl bg-slate-900 px-4 py-3.5 text-sm font-black uppercase tracking-[0.2em] text-white hover:bg-sky-600 transition">{isSubmitting ? 'Please wait...' : authMode === 'signup' ? 'Create uploader account' : 'Sign in'}</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );

  if (isAuthLoading || (user && isProfileLoading)) {
    return (
      <div className="flex min-h-screen bg-slate-50 p-6">
        <PageSkeleton />
      </div>
    );
  }

  if (!user || !profile) return renderAuth();

  if (isCatalogLoading && Object.keys(schoolsData || {}).length === 0) {
      return (
        <div className="flex min-h-screen bg-slate-50 p-6 flex-1 w-full lg:pl-64">
           <PageSkeleton />
        </div>
      );
  }

  
  const handleDeleteCollegeCourse = async (course: any) => {
    if (!window.confirm(`Are you sure you want to delete ${course.course_name} from ALL departments in this college?`)) return;
    try {
        const college = schoolsData[selectedSchoolId]?.colleges?.[selectedCollegeId];
        if (!college || !college.departments) return;
        
        const updates: any = {};
        Object.keys(college.departments).forEach((deptId: string) => {
            const levelData = college.departments[deptId].levels?.[selectedLevel];
            if (levelData?.courses) {
                 const courseKey = Object.keys(levelData.courses).find(k => (levelData.courses[k].course_id || levelData.courses[k].course_name) === (course.course_id || course.course_name));
                 if (courseKey) {
                     updates[`schools_data/${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${deptId}/levels/${selectedLevel}/courses/${courseKey}`] = null;
                 }
            }
        });
        if (Object.keys(updates).length > 0) {
            await update(dbRef(db), updates);
            addToast(`Deleted ${course.course_name} from ${Object.keys(updates).length} departments.`, 'success');
        }
    } catch (e) {
        addToast("Failed to delete course.", "error");
    }
  };

  const getDepartmentCourses = () => {
    if (!selectedSchoolId || !selectedCollegeId || !selectedDepartmentId) return [];
    const dept = schoolsData[selectedSchoolId]?.colleges?.[selectedCollegeId]?.departments?.[selectedDepartmentId];
    if (!dept) return [];
    const levelData = dept.levels?.[selectedLevel];
    if (!levelData?.courses) return [];
    
    return Object.values(levelData.courses)
      .filter((c: any) => normalizeSemester(c.semester) === selectedSemester)
      .map((c: any) => ({ ...c, level: selectedLevel }));
  };

  const getSchoolCourses = () => {
    if (!selectedSchoolId) return [];
    const school = schoolsData[selectedSchoolId];
    if (!school || !school.colleges) return [];
    
    const allCourses: any[] = [];
    const seenIds = new Set<string>();
    const deptCountMap = new Map<string, number>();

    Object.keys(school.colleges).forEach((collegeId: string) => {
      const college = school.colleges[collegeId];
      if (college.departments) {
        Object.keys(college.departments).forEach((deptId: string) => {
          const dept = college.departments[deptId];
          Object.keys(dept.levels || {}).forEach((levelId: string) => {
            const levelData = dept.levels[levelId];
            if (levelData?.courses) {
              Object.values(levelData.courses).forEach((c: any) => {
                if (normalizeSemester(c.semester) === selectedSemester && levelId === selectedLevel) {
                  const courseId = c.course_id || c.course_name;
                  deptCountMap.set(courseId, (deptCountMap.get(courseId) || 0) + 1);
                  if (!seenIds.has(courseId)) {
                    seenIds.add(courseId);
                    allCourses.push({ ...c, level: levelId, firstDepartmentPath: `${selectedSchoolId}/colleges/${collegeId}/departments/${deptId}` });
                  }
                }
              });
            }
          });
        });
      }
    });
    
    return allCourses.map(c => ({ ...c, department_count: deptCountMap.get(c.course_id || c.course_name) }))
      .filter(c => !courseSearchQuery || c.course_name.toLowerCase().includes(courseSearchQuery.toLowerCase()) || (c.course_code || '').toLowerCase().includes(courseSearchQuery.toLowerCase()));
  };

  const getSchoolDepartments = () => {
    if (!selectedSchoolId) return [];
    const school = schoolsData[selectedSchoolId];
    if (!school || !school.colleges) return [];

    const allDepts: any[] = [];
    Object.keys(school.colleges).forEach((collegeId: string) => {
      const college = school.colleges[collegeId];
      if (college.departments) {
        Object.keys(college.departments).forEach((deptId: string) => {
           allDepts.push({
               ...college.departments[deptId],
               id: deptId,
               collegeId,
               collegeName: college.name || collegeId
           });
        });
      }
    });
    return allDepts;
  };

  const departmentCourses = getDepartmentCourses();
  const schoolCourses = getSchoolCourses();
  const schoolDepartments = getSchoolDepartments();

  return (
    <div className="min-h-screen flex bg-slate-50  dark:text-white overflow-hidden relative">
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
           className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 md:hidden" 
           onClick={() => setIsMobileMenuOpen(false)} 
        />
      )}

      {/* Sidebar Navigation */}
      <aside className={`w-64 border-r border-slate-200 bg-white flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-6 flex items-center justify-between">
          <div>
             <h1 className="text-xl font-black tracking-tight flex items-center gap-2 text-sky-600"><UploadCloud className="w-6 h-6" /> Upload Center</h1>
             <p className="text-xs text-slate-400 mt-1 uppercase font-bold tracking-wider">{profile.display_name}</p>
          </div>
          <button className="md:hidden p-2 text-slate-400 hover:text-slate-700 bg-slate-50 rounded-xl" onClick={() => setIsMobileMenuOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
          <button onClick={() => navigate('/upload-center')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition ${activeView === 'dashboard' ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}><LayoutDashboard className="w-5 h-5" /> Dashboard</button>
          <button onClick={() => navigate('/upload-center/courses')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition ${activeView === 'courses' ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}><BookOpen className="w-5 h-5" /> Course Directory</button>
          <button onClick={() => navigate('/upload-center/departments')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition ${activeView === 'departments' ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}><FolderOpen className="w-5 h-5" /> Departments</button>
          <button onClick={() => navigate('/upload-center/past-questions')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition ${activeView === 'past_questions' ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}><FileQuestion className="w-5 h-5" /> Past Questions</button>
          <button onClick={() => navigate('/upload-center/requests')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition ${activeView === 'requests' ? 'bg-sky-50 text-sky-700' : 'text-slate-600 hover:bg-slate-50'}`}><List className="w-5 h-5" /> All Requests</button>
        </nav>
        <div className="p-4 border-t border-slate-100 mt-auto">
          <button onClick={handleLogout} className="w-full py-2 text-sm font-bold text-slate-500 hover:text-slate-800 dark:text-slate-200 transition">Sign Out</button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 md:ml-64 h-screen overflow-y-auto relative w-full">
        {/* Mobile Header */}
        <div className="md:hidden sticky top-0 z-30 bg-white backdrop-blur-xl border-b border-slate-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-xl transition">
                    <Menu className="w-6 h-6" />
                </button>
                <h1 className="text-lg font-black tracking-tight  dark:text-white capitalize">
                    {activeView.replace('_', ' ')}
                </h1>
            </div>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-sky-600 flex items-center justify-center text-white text-xs font-bold shadow-md">
                {profile.display_name?.charAt(0).toUpperCase()}
            </div>
        </div>

        <div className="p-4 sm:p-8 pt-6 sm:pt-8 w-full max-w-full">
          {activeView === 'dashboard' && (
          <div className="max-w-5xl space-y-6">
            <h2 className="text-3xl font-black tracking-tight">Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm">
                <p className="text-xs font-black uppercase text-slate-400 tracking-wider">Your Uploads</p>
                <p className="text-4xl font-black mt-2 text-sky-600">{uploads.length}</p>
              </div>
              <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm">
                <p className="text-xs font-black uppercase text-slate-400 tracking-wider">Your Requests</p>
                <p className="text-4xl font-black mt-2 text-amber-500">{requests.length}</p>
              </div>
            </div>

            <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm p-6 mt-8">
              <h3 className="font-bold text-lg mb-4">Your Recent Uploads</h3>
              {uploads.length ? (
                <div className="space-y-3">
                  {uploads.slice(0, 5).map(up => (
                    <div key={up.course_key + up.uploaded_at} className="p-4 bg-slate-50 rounded-2xl flex justify-between items-center">
                      <div>
                        <p className="font-bold">{up.course_name}</p>
                        <p className="text-sm text-slate-500">{up.level} - {up.semester}</p>
                      </div>
                      <span className="text-xs bg-blue-50 text-[#0F172A] border border-blue-200 px-3 py-1 rounded-full font-bold">Uploaded</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-slate-500 text-sm">No recent uploads.</p>}
            </div>
          </div>
        )}

        {activeView === 'courses' && (
          <div className="max-w-6xl space-y-6 animate-fade-in">
            <h2 className="text-3xl font-black tracking-tight">Unified Course Directory</h2>
            
            <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2"><BookOpen className="w-4 h-4"/> Global Search & Filter</h3>
              <div className="flex flex-col md:flex-row gap-4 mb-4">
                <input type="text" placeholder="Search for MTH101 or Computer Science..." value={courseSearchQuery} onChange={e => setCourseSearchQuery(e.target.value)} className="flex-1 p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 ring-sky-100 font-medium" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <select value={selectedSchoolId} onChange={e => setSelectedSchoolId(e.target.value)} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 ring-sky-100 font-medium">
                  <option value="">Select School</option>
                  {Object.keys(schoolsData).map(k => <option key={k} value={k}>{schoolsData[k].name || k}</option>)}
                </select>
                
                <select value={selectedLevel} onChange={e => setSelectedLevel(e.target.value as any)} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 ring-sky-100 font-medium">
                  {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>

                <select value={selectedSemester} onChange={e => setSelectedSemester(e.target.value as any)} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 ring-sky-100 font-medium">
                  {SEMESTERS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {selectedSchoolId && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black">Available Courses ({schoolCourses.length})</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {schoolCourses.map((course: any) => {
                    const isUploaded = isTextbookUploaded(course);
                    return (
                      <div key={course.course_id + course.level} className={`bg-white border rounded-[24px] p-6 shadow-sm transition-all ${isUploaded ? 'border-blue-200' : 'border-slate-200'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex flex-col items-start gap-2">
                             <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md border ${course.semester === 'first' ? 'bg-blue-50 text-[#0F172A] border-blue-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                                {course.semester === 'first' ? '1st Sem' : '2nd Sem'}
                             </span>
                             {course.department_count > 0 && (
                                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md bg-sky-50 text-sky-600 border border-sky-200">
                                   {course.department_count} Dept{course.department_count > 1 ? 's' : ''} Offering
                                </span>
                             )}
                          </div>
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-full ${isUploaded ? 'bg-blue-50 text-[#0F172A] border border-blue-200' : 'bg-slate-100 text-slate-500'}`}>{isUploaded ? 'Textbook Ready' : 'No Textbook'}</span>
                        </div>
                        <h4 className="font-black text-lg  dark:text-white leading-tight mt-3">{course.course_name}</h4>
                        <p className="text-sm font-bold text-slate-400 mt-1">{course.course_code || course.course_id}</p>

                        <div className="mt-6 flex gap-2">
                          <button onClick={() => setUploadModal({course, courseKey: getCourseMergeKey(course), deptPath: course.firstDepartmentPath})} disabled={isUploadingCourseKey === getCourseMergeKey(course)} className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition disabled:opacity-50 ${isUploaded ? 'bg-slate-800 hover:bg-slate-700' : 'bg-sky-600 hover:bg-sky-700'}`}>
                            {isUploadingCourseKey === getCourseMergeKey(course) ? 'Uploading...' : <><HardDrive className="w-4 h-4"/> Upload Material</>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!schoolCourses.length && (
                    <div className="col-span-full py-12 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-[24px]">
                      No courses found matching your criteria.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeView === 'departments' && (
          <div className="max-w-6xl space-y-6">
            <h2 className="text-3xl font-black tracking-tight">Department Directories</h2>
            
            <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 justify-between items-center">
              <div>
                 <h3 className="text-xl font-black mb-1">Browse Catalog</h3>
                 <p className="text-sm text-slate-500 font-medium">Navigate through schools, colleges, and departments.</p>
              </div>
              <div className="w-full md:w-96">
                  <SchoolHierarchySelector 
                      schoolId={selectedSchoolId}
                      setSchoolId={setSelectedSchoolId}
                      collegeId={selectedCollegeId}
                      setCollegeId={setSelectedCollegeId}
                      departmentId={selectedDepartmentId}
                      setDepartmentId={setSelectedDepartmentId}
                  />
              </div>
            </div>

            {selectedSchoolId && !selectedDepartmentId && (
              <div className="space-y-6 animate-fade-in">
                 <h3 className="text-xl font-black">All Departments</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {schoolDepartments.map(dept => (
                      <div key={dept.id} onClick={() => { setSelectedCollegeId(dept.collegeId); setSelectedDepartmentId(dept.id); }} className="bg-white border border-slate-200 rounded-[24px] p-6 shadow-sm hover:shadow-md hover:border-sky-200 cursor-pointer transition-all">
                          <div className="flex justify-between items-start mb-2">
                             <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md bg-blue-50 text-[#0F172A] border border-blue-200">
                                {dept.collegeName}
                             </span>
                          </div>
                          <h4 className="font-black text-xl  dark:text-white mt-2">{dept.name || dept.id}</h4>
                          <div className="mt-4 flex items-center text-sky-600 font-bold text-sm gap-1">
                              View Courses <ChevronRight className="w-4 h-4" />
                          </div>
                      </div>
                    ))}
                    {!schoolDepartments.length && (
                        <div className="col-span-full py-12 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-[24px]">
                           No departments found.
                        </div>
                    )}
                 </div>
              </div>
            )}

            {selectedDepartmentId && (
              <div className="space-y-6 animate-fade-in">
                <div className="flex items-center gap-4">
                    <button onClick={() => setSelectedDepartmentId('')} className="p-2 bg-white rounded-full shadow-sm hover:bg-slate-50 transition">
                        <ChevronRight className="w-5 h-5 rotate-180 text-slate-600" />
                    </button>
                    <h3 className="text-2xl font-black">
                        {schoolDepartments.find(d => d.id === selectedDepartmentId)?.name || selectedDepartmentId}
                    </h3>
                </div>
                
                <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm flex flex-wrap gap-4 items-end">
                    <div className="flex-1 min-w-[200px]">
                        <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Level</label>
                        <select value={selectedLevel} onChange={e => setSelectedLevel(e.target.value as any)} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 ring-sky-100 font-medium">
                        {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 min-w-[200px]">
                        <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Semester</label>
                        <select value={selectedSemester} onChange={e => setSelectedSemester(e.target.value as any)} className="w-full p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 ring-sky-100 font-medium">
                        {SEMESTERS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <button onClick={() => setIsAddingCourse(!isAddingCourse)} className="flex items-center justify-center h-12 gap-2 bg-slate-900 text-white px-6 rounded-xl text-sm font-bold hover:bg-sky-600 transition">
                        <Plus className="w-4 h-4"/> Add Course
                    </button>
                </div>

                {isAddingCourse && (
                  <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in">
                    <div className="w-full max-w-2xl rounded-[32px] border border-sky-100 bg-white p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                      <button onClick={() => { setIsAddingCourse(false); setExtractedCourses([]); }} className="absolute top-6 right-6 p-2 text-slate-400 hover:bg-slate-100 rounded-full transition">
                        ✕
                      </button>
                      <h3 className="text-2xl font-black  dark:text-white tracking-tight mb-2">Add Courses</h3>
                      <p className="text-sm text-slate-500 font-medium mb-6">Add courses manually or extract them from a syllabus document.</p>

                      {extractedCourses.length > 0 ? (
                        <div className="space-y-4">
                          <h4 className="font-bold text-lg text-slate-800 dark:text-slate-200">Extracted Courses</h4>
                          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
                            {extractedCourses.map((c, idx) => (
                              <div key={idx} className="flex flex-col sm:flex-row gap-3 items-center p-3 border border-slate-200 rounded-xl bg-slate-50">
                                <input type="checkbox" checked={c.selected} onChange={e => {
                                  const newCourses = [...extractedCourses];
                                  newCourses[idx].selected = e.target.checked;
                                  setExtractedCourses(newCourses);
                                }} className="w-5 h-5 rounded text-sky-600 focus:ring-sky-500 cursor-pointer" />

                                <input type="text" value={c.course_code} onChange={e => {
                                  const newCourses = [...extractedCourses];
                                  newCourses[idx].course_code = e.target.value;
                                  setExtractedCourses(newCourses);
                                }} className="w-full sm:w-28 p-2 text-sm border border-slate-200 rounded outline-none focus:border-sky-400" placeholder="Code" />

                                <input type="text" value={c.course_name} onChange={e => {
                                  const newCourses = [...extractedCourses];
                                  newCourses[idx].course_name = e.target.value;
                                  setExtractedCourses(newCourses);
                                }} className="flex-1 w-full p-2 text-sm border border-slate-200 rounded outline-none focus:border-sky-400" placeholder="Course Name" />

                                <select value={c.type} onChange={e => {
                                  const newCourses = [...extractedCourses];
                                  newCourses[idx].type = e.target.value as 'private' | 'general';
                                  setExtractedCourses(newCourses);
                                }} className="w-full sm:w-36 p-2 text-sm border border-slate-200 rounded outline-none focus:border-sky-400 bg-white">
                                  <option value="private">Private</option>
                                  <option value="general">General</option>
                                </select>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-3 pt-4 border-t border-slate-100">
                            <button onClick={() => setExtractedCourses([])} className="px-6 py-3 rounded-xl font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">Cancel</button>
                            <button onClick={handleSaveExtractedCourses} disabled={isExtractingCourses} className="flex-1 px-6 py-3 rounded-xl font-bold bg-sky-600 text-white hover:bg-sky-700 transition disabled:opacity-50">
                              {isExtractingCourses ? 'Saving...' : 'Save Selected Courses'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-8">
                          {/* File Upload Section */}
                          <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-5">
                            <h4 className="font-bold text-[#0F172A] dark:text-white mb-2 flex items-center gap-2"><UploadCloud className="w-4 h-4"/> Extract from Course Form or Syllabus</h4>
                            <p className="text-xs text-slate-600 mb-4">Upload a course registration form, syllabus, or outline (PDF or photo) to automatically extract course codes and names.</p>
                            <label className="flex items-center justify-center w-full py-3 bg-white border border-blue-200 text-[#0066FF] rounded-xl font-bold hover:bg-blue-50 transition cursor-pointer shadow-sm">
                              {isExtractingCourses ? (
                                <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Analyzing Document...</span>
                              ) : (
                                "Select Course Form (PDF or Photo)"
                              )}
                              <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleExtractCoursesFromPdf} disabled={isExtractingCourses} />
                            </label>
                          </div>

                          <div className="relative">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                            <div className="relative flex justify-center"><span className="bg-white px-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Or add manually</span></div>
                          </div>

                          {/* Manual Entry Form */}
                          <div className="space-y-4">
                            <div>
                              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Course Name</label>
                              <input type="text" placeholder="e.g. General Mathematics" value={newCourseName} onChange={e => setNewCourseName(e.target.value)} className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:ring-2 ring-sky-200 bg-slate-50" />
                            </div>
                            <div className="flex flex-col sm:flex-row gap-4">
                              <div className="flex-1">
                                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Course Code</label>
                                <input type="text" placeholder="e.g. MTH101" value={newCourseCode} onChange={e => setNewCourseCode(e.target.value)} className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:ring-2 ring-sky-200 bg-slate-50" />
                              </div>
                              <div className="flex-1">
                                <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Course Type</label>
                                <select value={newCourseType} onChange={e => setNewCourseType(e.target.value as any)} className="w-full p-3 rounded-xl border border-slate-200 outline-none focus:ring-2 ring-sky-200 bg-slate-50 text-sm">
                                    <option value="private">Private (This Dept Only)</option>
                                    <option value="general">General (Shared across Depts)</option>
                                </select>
                              </div>
                            </div>
                            <button onClick={handleAddCourse} disabled={(!newCourseCode || !newCourseName)} className="w-full bg-slate-900 text-white px-6 py-3.5 rounded-xl font-bold hover:bg-sky-600 transition disabled:opacity-50 mt-4">Save Manual Course</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {departmentCourses.map((course: any) => {
                    const courseKey = getCourseMergeKey(course);
                    const isUploaded = isTextbookUploaded(course);
                    const deptPath = `${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${selectedDepartmentId}`;
                    return (
                      <div key={course.course_id} className={`bg-white border rounded-[24px] p-6 shadow-sm transition-all ${isUploaded ? 'border-blue-200' : 'border-slate-200'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md ${isUploaded ? 'bg-blue-50 text-[#002D62] border border-blue-200' : 'bg-slate-100 text-slate-500'}`}>{isUploaded ? 'Textbook Ready' : 'No Textbook'}</span>
                          <button onClick={() => handleDeleteCourse(course)} className="text-slate-400 hover:text-red-500 transition"><Trash2 className="w-4 h-4"/></button>
                        </div>
                        <h4 className="font-black text-lg  dark:text-white leading-tight">{course.course_name}</h4>
                        <p className="text-sm font-bold text-slate-400 mt-1">{course.course_code || course.course_id}</p>

                        <div className="mt-6 flex gap-2">
                          <button onClick={() => setUploadModal({course, courseKey, deptPath})} disabled={isUploadingCourseKey === courseKey} className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition disabled:opacity-50 ${isUploaded ? 'bg-slate-800 hover:bg-slate-700' : 'bg-sky-600 hover:bg-sky-700'}`}>
                            {isUploadingCourseKey === courseKey ? 'Uploading...' : <><HardDrive className="w-4 h-4"/> Upload Material</>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!departmentCourses.length && (
                    <div className="col-span-full py-12 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-[24px]">
                      No courses found in this department for {selectedLevel} - {selectedSemester}.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeView === 'past_questions' && (
          <div className="max-w-6xl space-y-6">
            <h2 className="text-3xl font-black tracking-tight">Upload Past Questions</h2>
            
            {/* Context Selector */}
            <div className="bg-white p-6 rounded-[24px] border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2"><Layers className="w-4 h-4"/> Select Context</h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                 <div className="md:col-span-3">
                    <SchoolHierarchySelector 
                        schoolId={selectedSchoolId}
                        setSchoolId={setSelectedSchoolId}
                        collegeId={selectedCollegeId}
                        setCollegeId={setSelectedCollegeId}
                        departmentId={selectedDepartmentId}
                        setDepartmentId={setSelectedDepartmentId}
                    />
                 </div>
                
                <select value={selectedLevel} onChange={e => setSelectedLevel(e.target.value as any)} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 ring-sky-100 font-medium">
                  {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>

                <select value={selectedSemester} onChange={e => setSelectedSemester(e.target.value as any)} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 ring-sky-100 font-medium">
                  {SEMESTERS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {selectedDepartmentId && (
              <div className="space-y-6 animate-fade-in">
                {/* Course List */}
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black">Courses ({departmentCourses.length})</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {departmentCourses.map((course: any) => {
                    const courseKey = getCourseMergeKey(course);
                    const deptPath = `${selectedSchoolId}/colleges/${selectedCollegeId}/departments/${selectedDepartmentId}`;
                    return (
                      <div key={course.course_id} className="bg-white border border-slate-200 rounded-[24px] p-6 shadow-sm transition-all hover:border-amber-200 hover:shadow-md">
                        <div className="flex justify-between items-start mb-2">
                           {isPQUploaded(course, selectedDepartmentId, pqIndex) ? (
                               <span className="text-xs font-black uppercase tracking-wider px-2 py-1 rounded-md bg-blue-50 text-[#002D62] border border-blue-200">
                                  PQ Ready
                               </span>
                           ) : (
                               <span className="text-xs font-black uppercase tracking-wider px-2 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                  No Past Q&A
                               </span>
                           )}
                        </div>
                        <h4 className="font-black text-lg  dark:text-white leading-tight mt-2">{course.course_name}</h4>
                        <p className="text-sm font-bold text-slate-400 mt-1">{course.course_code || course.course_id}</p>

                        <div className="mt-6 flex gap-2">
                          <button onClick={() => {
                              setUploadType('past_question');
                              setUploadModal({course, courseKey, deptPath});
                          }} disabled={isUploadingCourseKey === courseKey} className="flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white bg-[#0F172A] hover:bg-slate-800 transition disabled:opacity-50">
                            {isUploadingCourseKey === courseKey ? 'Uploading...' : <><FileQuestion className="w-4 h-4"/> Upload Past Q&A</>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!departmentCourses.length && (
                    <div className="col-span-full py-12 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-[24px]">
                      No courses found in this department for {selectedLevel} - {selectedSemester}.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {activeView === 'requests' && (
          <div className="max-w-5xl space-y-6">
             <h2 className="text-3xl font-black tracking-tight">Global Course Requests</h2>
             <div className="bg-white rounded-[24px] border border-slate-200 shadow-sm p-6">
                {requests.length ? (
                  <div className="space-y-4">
                    {requests.map(req => (
                      <div key={req.course_key + req.created_at} className="p-5 bg-slate-50 border border-slate-100 rounded-[20px]">
                        <h4 className="font-bold text-lg">{req.course_name}</h4>
                        <p className="text-sm font-medium text-slate-500 mb-2">{req.level} - {req.semester}</p>
                        <p className="text-sm bg-white p-3 rounded-xl border border-slate-200">{req.note}</p>
                        <button onClick={() => navigate('/upload-center/courses')} className="mt-4 text-sm font-bold text-sky-600 hover:text-sky-700 underline underline-offset-2">Go to Manage Courses</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500">No requests submitted.</p>
                )}
             </div>
          </div>
        )}
        </div>
      </main>

            {/* Upload Material Modal */}
      {uploadModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-[32px] border border-sky-100 bg-white p-8 shadow-2xl space-y-6 relative">
            <h3 className="text-2xl font-black  dark:text-white tracking-tight">Upload Material</h3>
            <p className="text-sm text-slate-500 font-medium">Select what type of material you are uploading for {uploadModal.course.course_name}.</p>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">Material Type</label>
                    <select className="w-full p-3 rounded-xl border border-slate-200 text-sm font-bold bg-slate-50" value={uploadType} onChange={e => setUploadType(e.target.value as any)}>
                        <option value="textbook">Textbook / Syllabus</option>
                        <option value="past_question">Past Question</option>
                    </select>
                </div>
                {uploadType === 'past_question' && (
                    <div>
                        <label className="block text-xs font-black uppercase text-slate-400 tracking-widest mb-2">Year</label>
                        <input type="number" className="w-full p-3 rounded-xl border border-slate-200 text-sm font-bold bg-slate-50" value={pqYear} onChange={e => setPqYear(e.target.value)} />
                    </div>
                )}
            </div>

            <input ref={fileInputRef} type="file" multiple accept="application/pdf" className="hidden" onChange={e => {
                if (e.target.files?.length) {
                    handleFileUpload(uploadModal.course, uploadModal.courseKey, uploadModal.deptPath, e.target.files, uploadType, uploadType === 'past_question' ? pqYear : undefined);
                    setUploadModal(null);
                }
            }} />

            <div 
                className="mt-6 border-2 border-dashed border-sky-200 rounded-[24px] p-6 text-center transition-colors hover:bg-sky-50"
                onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('bg-sky-50', 'border-sky-400');
                }}
                onDragLeave={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('bg-sky-50', 'border-sky-400');
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('bg-sky-50', 'border-sky-400');
                    if (e.dataTransfer.files?.length) {
                        handleFileUpload(uploadModal.course, uploadModal.courseKey, uploadModal.deptPath, e.dataTransfer.files, uploadType, uploadType === 'past_question' ? pqYear : undefined);
                        setUploadModal(null);
                    }
                }}
            >
                <div className="flex flex-col gap-3">
                    <div className="text-sm font-bold text-slate-500 mb-2 pointer-events-none">
                        Drag and drop your PDFs here, or
                    </div>
                    <button onClick={() => fileInputRef.current?.click()} className="w-full py-3 bg-sky-600 text-white rounded-xl font-bold hover:bg-sky-700 transition flex items-center justify-center gap-2">
                        <UploadCloud className="w-5 h-5" /> Select Local Files
                    </button>
                <button 
                  onClick={() => {
                    setUploadModal(null); // Close modal first
                    handleGoogleDrivePick((files) => {
                      if (files.length > 0) {
                        handleFileUpload(uploadModal.course, uploadModal.courseKey, uploadModal.deptPath, files, uploadType, uploadType === 'past_question' ? pqYear : undefined);
                      }
                    });
                  }} 
                  className="w-full py-3 bg-[#4285F4] text-white rounded-xl font-bold hover:bg-[#3367D6] transition flex items-center justify-center gap-2">
                    <svg className="w-5 h-5 bg-white rounded-full p-0.5" viewBox="0 0 24 24"><path fill="#FFC107" d="M16 14.5L12 21.5H5.333L9.333 14.5H16Z"/><path fill="#1976D2" d="M9.333 14.5L5.333 21.5L1.333 14.5L5.333 7.5L9.333 14.5Z"/><path fill="#4CAF50" d="M16 14.5H9.333L5.333 7.5H12L16 14.5Z"/><path fill="#000000" fillOpacity="0.2" d="M16 14.5L12 21.5H5.333L9.333 14.5H16Z"/><path fill="#000000" fillOpacity="0.2" d="M9.333 14.5L5.333 21.5L1.333 14.5L5.333 7.5L9.333 14.5Z"/><path fill="#000000" fillOpacity="0.2" d="M16 14.5H9.333L5.333 7.5H12L16 14.5Z"/></svg>
                    Import from Google Drive
                </button>
                <button onClick={() => setUploadModal(null)} className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition mt-2">
                    Cancel
                </button>
                </div>
            </div>
          </div>
        </div>
      )}

{/* Progress Modal */}
      {uploadProgress && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-[32px] border border-sky-100 bg-white p-8 shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-sky-50 mb-4">
                <div className="absolute inset-0 rounded-full border-4 border-sky-100"></div>
                <div className="absolute inset-0 rounded-full border-4 border-sky-500 border-l-transparent border-t-transparent animate-spin"></div>
                <UploadCloud className="w-6 h-6 text-sky-500" />
              </div>
              <h3 className="text-xl font-black tracking-tight  dark:text-white">Uploading & Processing</h3>
              <p className="mt-2 text-sm font-medium text-sky-600 h-10">{uploadProgress.status}</p>
              <div className="mt-6 w-full overflow-hidden rounded-full bg-slate-100 h-2">
                <div className="h-full rounded-full bg-sky-500 transition-all duration-300 ease-out" style={{ width: `${uploadProgress.percent}%` }}></div>
              </div>
              <p className="mt-2 text-xs font-bold text-slate-400">{Math.min(uploadProgress.percent, 100)}% Complete</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
