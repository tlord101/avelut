import React, { useState, useEffect } from 'react';
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

// @ts-ignore
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

interface AdminPanelProps {
    userProfile: UserProfile;
}

const SEMESTERS = ['first', 'second'] as const;
const DEFAULT_SEMESTER: (typeof SEMESTERS)[number] = 'first';
const normalizeSemester = (semester?: Course['semester']): (typeof SEMESTERS)[number] => (
    semester && SEMESTERS.includes(semester) ? semester : DEFAULT_SEMESTER
);
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

const normalizeTextbookUrls = (course: Partial<Course>) => {
    const urls: string[] = Array.isArray(course?.textbook_urls) ? course.textbook_urls.filter(Boolean) : [];
    if (course?.textbook_url && !urls.includes(course.textbook_url)) {
        urls.unshift(course.textbook_url);
    }
    return Array.from(new Set(urls));
};

const getPrimaryTextbookUrl = (urls: string[]) => urls[urls.length - 1] || '';

const selectPrimaryPdfUrl = (uploadedUrls: string[], existingPdfUrl: string | undefined, mergedPdfUrls: string[]) => (
    getPrimaryTextbookUrl(uploadedUrls) || existingPdfUrl || getPrimaryTextbookUrl(mergedPdfUrls)
);

const mergeTopics = (existingTopics: unknown[], newTopics: Topic[]) => {
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

export const AdminPanel: React.FC<AdminPanelProps> = ({ userProfile }) => {
    const [activeTab, setActiveTab] = useState<'questions' | 'courses' | 'users' | 'departments'>('departments');
    const [allUsersList, setAllUsersList] = useState<UserProfile[]>([]);
    const [isUsersLoading, setIsUsersLoading] = useState(false);
    const { addToast } = useToast();

    // Departments State
    const [allDepartments, setAllDepartments] = useState<any[]>([]);
    const [newDeptName, setNewDeptName] = useState('');
    const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'];

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

    // Past Questions State
    const [courseSearch, setCourseSearch] = useState('');
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
    const [coursesList, setCoursesList] = useState<Course[]>([]);

    // Textbook State
    const [isUploading, setIsUploading] = useState(false);
    const [extractionProgress, setExtractionProgress] = useState('');

    const [uploadDepartmentId, setUploadDepartmentId] = useState('');
    const [uploadLevel, setUploadLevel] = useState('');
    const [uploadCourseName, setUploadCourseName] = useState('');

    useEffect(() => {
        if (departmentId) {
            const departmentRef = dbRef(db, `departments_data/${departmentId}`);
            get(departmentRef).then(snap => {
                if (snap.exists()) {
                    const rawCourseList = snap.val().course_list || [];
                    const normalizedCourseList = rawCourseList.map((course: Course) => ({
                        ...course,
                        semester: normalizeSemester(course.semester),
                    }));
                    setCoursesList(normalizedCourseList);
                } else {
                    setCoursesList([]);
                }
            });
        }
    }, [departmentId]);

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

    const handleTextbookUpload = async (courseId: string, files: File[]) => {
        // Find selecting course details from coursesList
        const selectedCourse = coursesList.find(c => c.course_id === courseId);
        
        if (!files.length || !departmentId || !selectedCourse) {
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
                const fileRef = storageRef(storage, `textbooks/${departmentId}/${level}/${course_name}/${file.name}`);
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

            // 3. Save to Textbook Contexts (for AI grounding)
            const textbookContextRef = dbRef(db, `textbook_contexts/${departmentId}/${level}/${course_name}`);
            const textbookContextSnapshot = await get(textbookContextRef);
            const existingContext = textbookContextSnapshot.exists() ? textbookContextSnapshot.val() : {};
            const existingPdfUrls: string[] = Array.isArray(existingContext?.pdf_urls) ? existingContext.pdf_urls.filter(Boolean) : [];
            if (existingContext?.pdf_url && !existingPdfUrls.includes(existingContext.pdf_url)) {
                existingPdfUrls.unshift(existingContext.pdf_url);
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

            // 4. Update the local coursesList and then database
            const updatedCoursesList = coursesList.map(c => {
                if (c.course_id === courseId) {
                    const existingCourseUrls = normalizeTextbookUrls(c);
                    const mergedCourseUrls = Array.from(new Set([...existingCourseUrls, ...uploadedUrls]));
                    return {
                        ...c,
                        topics: mergedSyllabus,
                        textbook_url: getPrimaryTextbookUrl(mergedCourseUrls),
                        textbook_urls: mergedCourseUrls
                    };
                }
                return c;
            });

            setCoursesList(updatedCoursesList);
            
            // Save to DB
            await update(dbRef(db, `departments_data/${departmentId}`), {
                course_list: updatedCoursesList
            });

            addToast(`${uploadedUrls.length} textbook${uploadedUrls.length > 1 ? 's' : ''} for ${course_name} processed successfully!`, "success");
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
            await update(dbRef(db, `departments_data/${departmentId}`), {
                course_list: coursesList
            });
            addToast("Department outline updated!", "success");
        } catch (error: any) {
            addToast(error.message, "error");
        }
    };

    const addCourseField = () => {
        setCoursesList([...coursesList, { course_id: '', course_name: '', topics: [], level: '100', semester: DEFAULT_SEMESTER }]);
    };

    if (!userProfile.is_admin) {
        return <div className="p-8 text-center text-red-600 font-bold">Access Denied. Admins only.</div>;
    }

    return (
        <div className="flex flex-col p-6 bg-white rounded-xl shadow-sm border border-gray-200">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Admin Control Panel</h2>
            
            <div className="flex gap-4 mb-6 border-b border-gray-200 pb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button 
                    onClick={() => setActiveTab('departments')}
                    className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'departments' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                >
                    Departments
                </button>
                <button 
                    onClick={() => setActiveTab('courses')}
                    className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'courses' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                >
                    Department Outlines
                </button>
                <button 
                    onClick={() => setActiveTab('questions')}
                    className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'questions' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                >
                    Past Questions
                </button>
                <button 
                    onClick={() => setActiveTab('users')}
                    className={`px-4 py-2 font-medium whitespace-nowrap ${activeTab === 'users' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                >
                    User Management
                </button>
            </div>

            {activeTab === 'departments' && (
                <div className="space-y-6 max-w-2xl">
                    <div className="bg-white p-6 rounded-2xl border border-gray-200">
                        <h3 className="font-bold text-gray-800 mb-4">Add New Department</h3>
                        <div className="flex gap-4">
                            <input 
                                type="text" 
                                placeholder="Department Name (e.g., Computer Science)" 
                                value={newDeptName} 
                                onChange={e => setNewDeptName(e.target.value)}
                                className="flex-1 p-2 border rounded-lg"
                            />
                            <button 
                                onClick={handleAddDepartment}
                                className="px-6 py-2 bg-lime-600 text-white rounded-lg font-bold hover:bg-lime-700"
                            >
                                Add
                            </button>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-2xl border border-gray-200">
                        <h3 className="font-bold text-gray-800 mb-4">Existing Departments</h3>
                        <div className="space-y-2">
                            {allDepartments.map(dept => (
                                <div key={dept.id} className="p-3 border rounded-lg flex justify-between items-center">
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
                        
                        <div className="grid grid-cols-2 gap-4 mb-4">
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
                        <div className="grid grid-cols-2 gap-4">
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
                        <div className="grid grid-cols-2 gap-2">
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
                    <div className="bg-white p-6 rounded-2xl border border-gray-200">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                            <div>
                                <h3 className="text-xl font-black text-gray-900 mb-1">Department Content Manager</h3>
                                <p className="text-sm text-gray-500 font-medium">Define course outlines and upload textbooks for grounding.</p>
                            </div>
                            <select 
                                value={departmentId} 
                                onChange={e => setDepartmentId(e.target.value)}
                                className="w-full md:w-64 p-3 border border-gray-200 rounded-xl bg-gray-50 font-bold text-gray-700 outline-none focus:bg-white focus:ring-4 focus:ring-lime-500/10 transition-all"
                            >
                                <option value="">Select Department</option>
                                {allDepartments.map(dept => (
                                    <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                                ))}
                            </select>
                        </div>

                        {departmentId ? (
                            <div className="max-w-4xl mx-auto space-y-8">
                                <div className="flex justify-between items-center bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-gray-400 shadow-sm">
                                            <StackIcon className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Active Department</p>
                                            <p className="font-bold text-gray-800">{allDepartments.find(d => d.id === departmentId)?.department_name}</p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={addCourseField}
                                        className="inline-flex items-center gap-2 bg-white hover:bg-gray-100 px-5 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all border border-gray-100 shadow-sm"
                                    >
                                        <span>+</span> New Course
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {coursesList.map((s, sIdx) => {
                                        const textbookUrls = normalizeTextbookUrls(s);
                                        const hasTextbooks = textbookUrls.length > 0;
                                        return (
                                        <div key={sIdx} className="group p-6 border border-gray-100 rounded-[2rem] bg-white shadow-sm hover:shadow-xl hover:border-lime-200 transition-all duration-300">
                                            <div className="space-y-4 mb-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex-1">
                                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Course Details</label>
                                                        <input 
                                                            type="text" placeholder="Course Name (e.g., Algebra)"
                                                            value={s.course_name} 
                                                            onChange={e => {
                                                                const list = [...coursesList];
                                                                list[sIdx].course_name = e.target.value;
                                                                list[sIdx].course_id = e.target.value.toLowerCase().replace(/\s+/g, '_');
                                                                setCoursesList(list);
                                                            }}
                                                            className="w-full p-3 border border-gray-100 rounded-xl text-sm font-bold bg-gray-50 focus:bg-white focus:border-lime-500 transition-all outline-none"
                                                        />
                                                    </div>
                                                    <div className="w-24">
                                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Level</label>
                                                        <select 
                                                            value={s.level} 
                                                            onChange={e => {
                                                                const list = [...coursesList];
                                                                list[sIdx].level = e.target.value;
                                                                setCoursesList(list);
                                                            }}
                                                            className="w-full p-3 border border-gray-100 rounded-xl text-sm font-bold bg-gray-50 focus:bg-white outline-none"
                                                        >
                                                            {LEVELS.map(lvl => (
                                                                <option key={lvl} value={lvl}>{lvl}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="w-28">
                                                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Semester</label>
                                                        <select
                                                            value={normalizeSemester(s.semester)}
                                                            onChange={e => {
                                                                const list = [...coursesList];
                                                                list[sIdx].semester = e.target.value as 'first' | 'second';
                                                                setCoursesList(list);
                                                            }}
                                                            className="w-full p-3 border border-gray-100 rounded-xl text-sm font-bold bg-gray-50 focus:bg-white outline-none"
                                                        >
                                                            {SEMESTERS.map(semester => (
                                                                <option key={semester} value={semester}>
                                                                    {semester === 'first' ? '1st Sem' : '2nd Sem'}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>

                                                {/* INLINE TEXTBOOK UPLOAD */}
                                                <div className="relative pt-2">
                                                    <div className={`p-4 rounded-2xl border ${hasTextbooks ? 'bg-lime-50 border-lime-100' : 'bg-gray-50 border-dashed border-gray-200'} transition-all`}>
                                                        {hasTextbooks ? (
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-lime-600 shadow-sm">
                                                                        <CheckIcon className="w-4 h-4" />
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-black text-lime-600 uppercase tracking-widest">
                                                                            {textbookUrls.length} Textbook{textbookUrls.length > 1 ? 's' : ''} Active
                                                                        </p>
                                                                        <div className="max-h-16 overflow-y-auto pr-1 [scrollbar-width:thin] scrollbar-thumb-lime-200">
                                                                            {textbookUrls.map((url, urlIndex) => (
                                                                                <a key={url} href={url} target="_blank" rel="noreferrer" className="block text-xs font-bold text-gray-800 hover:underline">
                                                                                    View Document {urlIndex + 1}
                                                                                </a>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <label className="cursor-pointer text-[10px] font-black text-gray-400 hover:text-gray-900 uppercase">
                                                                    Add More
                                                                    <input type="file" multiple className="hidden" accept="application/pdf" onChange={e => {
                                                                        const files = e.target.files ? Array.from(e.target.files) : [];
                                                                        if(files.length) handleTextbookUpload(s.course_id, files);
                                                                        e.currentTarget.value = '';
                                                                    }} />
                                                                </label>
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col items-center gap-2">
                                                                <label className="cursor-pointer flex flex-col items-center">
                                                                    <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-gray-300 shadow-sm mb-1 group-hover:text-lime-500 transition-colors">
                                                                        <GraduationCapIcon className="w-5 h-5" />
                                                                    </div>
                                                                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Upload Textbooks</span>
                                                                    <input type="file" multiple className="hidden" accept="application/pdf" onChange={e => {
                                                                        const files = e.target.files ? Array.from(e.target.files) : [];
                                                                        if(files.length) handleTextbookUpload(s.course_id, files);
                                                                        e.currentTarget.value = '';
                                                                    }} />
                                                                </label>
                                                            </div>
                                                        )}
                                                        {isUploading && (
                                                            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex items-center justify-center gap-2">
                                                                <div className="w-4 h-4 border-2 border-lime-500 border-t-transparent rounded-full animate-spin"></div>
                                                                <span className="text-[10px] font-black uppercase text-lime-600 animate-pulse">{extractionProgress}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="space-y-3 mb-6">
                                                <div className="flex justify-between items-center px-1">
                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Course Topics</span>
                                                    <span className="bg-gray-100 px-2 py-0.5 rounded-full text-[9px] font-black text-gray-500 uppercase">{s.topics?.length || 0} ITEMS</span>
                                                </div>
                                                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 [scrollbar-width:thin] scrollbar-thumb-gray-200">
                                                    {s.topics?.map((t, tIdx) => (
                                                        <div key={tIdx} className="space-y-2 animate-in slide-in-from-left-2 duration-300">
                                                            <div className="flex gap-2">
                                                                <input 
                                                                    type="text" 
                                                                    placeholder="Topic Name"
                                                                    value={t.topic_name}
                                                                    onChange={e => {
                                                                        const list = [...coursesList];
                                                                        list[sIdx].topics[tIdx].topic_name = e.target.value;
                                                                        if (!list[sIdx].topics[tIdx].topic_id) {
                                                                            list[sIdx].topics[tIdx].topic_id = normalizeTopicId(e.target.value);
                                                                        }
                                                                        setCoursesList(list);
                                                                    }}
                                                                    className="flex-1 p-2.5 border border-gray-100 rounded-xl text-xs font-bold bg-gray-50 focus:bg-white focus:border-gray-300 transition-all outline-none"
                                                                />
                                                                <button onClick={() => {
                                                                    const list = [...coursesList];
                                                                    list[sIdx].topics = list[sIdx].topics.filter((_, i) => i !== tIdx);
                                                                    setCoursesList(list);
                                                                }} className="w-10 h-10 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
                                                                    <XIcon className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                            <textarea
                                                                placeholder="Topic context (what this topic should cover in this course)"
                                                                value={t.topic_context || ''}
                                                                onChange={e => {
                                                                    const list = [...coursesList];
                                                                    list[sIdx].topics[tIdx].topic_context = e.target.value;
                                                                    setCoursesList(list);
                                                                }}
                                                                rows={2}
                                                                className="w-full p-2.5 border border-gray-100 rounded-xl text-xs font-medium bg-gray-50 focus:bg-white focus:border-gray-300 transition-all outline-none resize-y"
                                                            />
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                                <input
                                                                    type="text"
                                                                    placeholder="Start point"
                                                                    value={t.start_point || ''}
                                                                    onChange={e => {
                                                                        const list = [...coursesList];
                                                                        list[sIdx].topics[tIdx].start_point = e.target.value;
                                                                        setCoursesList(list);
                                                                    }}
                                                                    className="w-full p-2.5 border border-gray-100 rounded-xl text-xs font-medium bg-gray-50 focus:bg-white focus:border-gray-300 transition-all outline-none"
                                                                />
                                                                <input
                                                                    type="text"
                                                                    placeholder="End point"
                                                                    value={t.end_point || ''}
                                                                    onChange={e => {
                                                                        const list = [...coursesList];
                                                                        list[sIdx].topics[tIdx].end_point = e.target.value;
                                                                        setCoursesList(list);
                                                                    }}
                                                                    className="w-full p-2.5 border border-gray-100 rounded-xl text-xs font-medium bg-gray-50 focus:bg-white focus:border-gray-300 transition-all outline-none"
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                <button 
                                                    onClick={() => {
                                                        const list = [...coursesList];
                                                        if(!list[sIdx].topics) list[sIdx].topics = [];
                                                        list[sIdx].topics.push({ topic_id: '', topic_name: '', topic_context: '', start_point: '', end_point: '', is_complete: false });
                                                        setCoursesList(list);
                                                    }}
                                                    className="w-full py-2.5 border-2 border-dashed border-gray-100 rounded-xl text-[10px] font-black text-gray-400 uppercase tracking-widest hover:border-lime-200 hover:text-lime-600 transition-all"
                                                >
                                                    + Add Topic
                                                </button>
                                            </div>

                                            <div className="flex justify-end pt-4 border-t border-gray-50">
                                                <button className="text-red-400 hover:text-red-600 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-1.5" onClick={() => {
                                                    const list = coursesList.filter((_, i) => i !== sIdx);
                                                    setCoursesList(list);
                                                }}>
                                                    <XIcon className="w-3 h-3" /> Remove Course
                                                </button>
                                            </div>
                                        </div>
                                    )})}
                                </div>
                                
                                <button 
                                    onClick={handleUpdateCourseOutline}
                                    className="w-full bg-gray-900 text-white py-5 rounded-[2rem] font-black text-[13px] uppercase tracking-[0.2em] hover:bg-black transition-all shadow-xl shadow-gray-200 active:scale-95"
                                >
                                    Publish All Changes
                                </button>
                            </div>
                        ) : (
                            <div className="p-20 text-center flex flex-col items-center">
                                <div className="w-20 h-20 bg-gray-50 rounded-[2rem] flex items-center justify-center text-gray-300 mb-6 border border-gray-100">
                                    <StackIcon className="w-10 h-10" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">No Department Selected</h3>
                                <p className="text-gray-500 max-w-xs mx-auto">Please select a department from the menu above to manage its learning roadmap.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'users' && (
                <div className="space-y-6">
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
                        <div className="max-h-[500px] overflow-y-auto">
                            {isUsersLoading ? (
                                <div className="p-10 text-center text-gray-500">Loading users...</div>
                            ) : (
                                <table className="w-full text-left">
                                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                                        <tr>
                                            <th className="px-6 py-3">User</th>
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
