import { auth as auth, db, get, getDownloadURL, push, ref as dbRef, ref as storageRef, set, storage, update, uploadBytes } from '@/lib/backend';
import { useState, useMemo } from 'react';
import { PDFDocument } from 'pdf-lib';
import { createAvelutAI, getResponseText, Type } from '../utils/inference';
import { useApiLimiter } from './useApiLimiter';
import { useAppSettings } from './useAppSettings';
import { useToast } from './useToast';
import type { Course, Topic, AppSettings } from '../types';

const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'] as const;
const SEMESTERS = ['first', 'second'] as const;

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

export const normalizeSemester = (value?: string) => {
  const normalized = (value || '').toString().trim().toLowerCase();
  return SEMESTERS.includes(normalized as (typeof SEMESTERS)[number]) ? (normalized as (typeof SEMESTERS)[number]) : SEMESTERS[0];
};

export const getCourseMergeKey = (course: Partial<Course>) => {
    const primaryLabel = (course.course_code || course.course_name || course.course_id || '').toString().trim();
    const normalizedPrimaryLabel = primaryLabel.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
    if (!normalizedPrimaryLabel) return '';
    const hasLevel = Boolean((course.level || '').toString().trim());
    const normalizedLevel = hasLevel ? normalizeLevel(course.level) : 'alllvl';
    const normalizedSemester = normalizeSemester(course.semester);
    return `${normalizedPrimaryLabel}_${normalizedLevel}_${normalizedSemester}`;
};

const sanitizeTopicMetadata = (topic: any, index: number): Topic => {
    return {
        topic_name: String(topic?.topic_name || `Topic ${index + 1}`).trim(),
        topic_id: String(topic?.topic_id || `topic_${index + 1}_${Date.now()}`).trim(),
        topic_context: String(topic?.topic_context || '').trim(),
        start_point: String(topic?.start_point || '').trim(),
        end_point: String(topic?.end_point || '').trim(),
    };
};

const normalizeTopicId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '') || `topic_${Date.now()}`;

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

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error(`Failed to read PDF: ${reader.error?.message || 'Unknown error'}`));
    reader.readAsDataURL(file);
});

const uint8ToBase64 = (bytes: Uint8Array) => {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};

const getPrimaryTextbookUrl = (urls: string[]) => urls[urls.length - 1] || '';
const selectPrimaryPdfUrl = (uploadedUrls: string[], existingPdfUrl: string | undefined, mergedPdfUrls: string[]) => (
    getPrimaryTextbookUrl(uploadedUrls) || existingPdfUrl || getPrimaryTextbookUrl(mergedPdfUrls)
);

export const useSharedTextbookUpload = () => {
    const { addToast } = useToast();
    const { attemptApiCall } = useApiLimiter();
    const { settings: appSettings } = useAppSettings();
    const aiModel = appSettings?.usage_settings?.feature_models?.study_guide_extraction || appSettings?.openrouter_model || 'qwen/qwen3.7-flash';
    const ai = useMemo(() => createAvelutAI(appSettings, null), [appSettings]);

    const [uploadProgress, setUploadProgress] = useState<{ status: string; percent: number } | null>(null);
    const [isUploadingCourseKey, setIsUploadingCourseKey] = useState<string>('');

    const uploadTextbook = async (course: Course, courseKey: string, files: FileList | File[], isUploader: boolean = false, deptPath?: string) => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            addToast('Please sign in again.', 'error');
            return false;
        }
        if (!ai) {
            addToast('AI features unavailable.', 'error');
            return false;
        }
        if (!appSettings.upload_center_uploads_enabled) {
            addToast('Uploads are disabled by admin.', 'error');
            return false;
        }

        const pdfFiles = Array.from(files).filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
        if (!pdfFiles.length) {
            addToast('Please choose PDF files only.', 'error');
            return false;
        }

        setIsUploadingCourseKey(courseKey);
        setUploadProgress({ status: 'Starting upload...', percent: 5 });

        try {
            const uploadedUrls: string[] = [];
            const extractedTopicGroups: Topic[][] = [];

            for (let index = 0; index < pdfFiles.length; index += 1) {
                const file = pdfFiles[index];
                setUploadProgress({ status: `Uploading PDF to storage (${index + 1}/${pdfFiles.length})...`, percent: 10 + (index * 5) });
                
                const { supabaseStorageService } = await import('../services/supabaseStorageService');
                const uploadRes = await supabaseStorageService.uploadMaterial(currentUser.uid, file, file.name);
                
                const downloadURL = uploadRes.url || '';
                if (!downloadURL) {
                    throw new Error(uploadRes.error || 'Failed to upload textbook to storage');
                }
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
Extract a comprehensive syllabus/course outline into a structured JSON array of topics with concise grounding context.
RULES:
1. Output ONLY the JSON object.
2. The root object must have a "syllabus" key which is an array of objects.
3. Each topic object must have: topic_name, topic_id, topic_context, start_point, end_point.
FORMAT: { "syllabus": [ { "topic_name": "...", "topic_id": "...", "topic_context": "...", "start_point": "...", "end_point": "..." } ] }`;

                const chunkPromises = base64Chunks.map(async (chunkBase64) => {
                    return attemptApiCall(async () => {
                        const aiResponse = await ai.models.generateContent({
                            model: aiModel,
                            contents: [{ role: 'user', parts: [{ text: textbookPrompt }, { inlineData: { mimeType: 'application/pdf', data: chunkBase64 } }] }],
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

                        const text = getResponseText(aiResponse);
                        if (!text) throw new Error(`AI returned an empty response.`);
                        return JSON.parse(text);
                    });
                });

                const chunkResults = await Promise.all(chunkPromises);

                for (const aiResult of chunkResults) {
                    if (!aiResult.success) {
                        addToast(aiResult.message, 'error');
                        setIsUploadingCourseKey('');
                        setUploadProgress(null);
                        return false;
                    }
                    const responseData = aiResult.data as any;
                    extractedTopicGroups.push(Array.isArray(responseData?.syllabus) ? responseData.syllabus.map((t: any, i: number) => sanitizeTopicMetadata(t, i)) : []);
                }
            }

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
                semester: course.semester,
                pdf_url: primaryPdfUrl,
                pdf_urls: mergedSharedPdfUrls,
                syllabus: mergedSharedSyllabus,
                uploaded_at: Date.now(),
                uploader_uid: currentUser.uid,
            });

            if (isUploader && deptPath) {
                // Update Course in School Data
                const coursesRef = dbRef(db, `schools_data/${deptPath}/levels/${course.level}/courses`);
                const coursesSnapshot = await get(coursesRef);
                const existingCourse = (coursesSnapshot.val() || {})[course.course_id] || {};
                
                const normalizeTextbookUrls = (c: any) => {
                    const u = Array.isArray(c?.textbook_urls) ? c.textbook_urls : [];
                    if (c?.textbook_url && !u.includes(c.textbook_url)) u.push(c.textbook_url);
                    return u;
                };

                const newMergedUrls = Array.from(new Set([
                    ...normalizeTextbookUrls(existingCourse),
                    ...normalizeTextbookUrls(course),
                    ...mergedSharedPdfUrls,
                ]));

                const mergedCourse = {
                    ...existingCourse,
                    ...course,
                    course_id: course.course_id,
                    topics: mergedSharedSyllabus,
                    textbook_url: getPrimaryTextbookUrl(newMergedUrls),
                    textbook_urls: newMergedUrls,
                    textbook_shared_key: courseKey,
                };

                await update(dbRef(db, `schools_data/${deptPath}/levels/${course.level}/courses/${course.course_id}`), mergedCourse);

                const uploadRecordId = push(dbRef(db, `uploaders/${currentUser.uid}/uploads`)).key;
                if (uploadRecordId) {
                    await set(dbRef(db, `uploaders/${currentUser.uid}/uploads/${uploadRecordId}`), {
                        course_key: courseKey,
                        course_name: course.course_name,
                        level: course.level,
                        semester: course.semester,
                        department_ids: [deptPath],
                        uploaded_urls: mergedSharedPdfUrls,
                        uploaded_at: Date.now(),
                    });
                }
            }

            addToast(`${course.course_name} textbook uploaded successfully.`, 'success');

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
                    rawText, courseKey, course.course_name, course.level, course.semester, appSettings,
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
                console.error("Vector Indexing Error:", vectorErr);
                addToast(`Textbook uploaded, but AI search indexing failed: ${vectorErr.message}`, 'error');
            }

            setIsUploadingCourseKey('');
            setUploadProgress(null);
            return true;
        } catch (error: any) {
            console.error("Upload error:", error);
            addToast(`Upload failed: ${error.message}`, 'error');
            setIsUploadingCourseKey('');
            setUploadProgress(null);
            return false;
        }
    };

    return { uploadProgress, isUploadingCourseKey, uploadTextbook, setIsUploadingCourseKey, setUploadProgress };
};
