import React, { useState, useEffect } from 'react';
import { db, storage } from '../firebase';
import { ref as dbRef, set, push, update, get } from 'firebase/database';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleGenAI, Type } from '@google/genai';
import { useToast } from '../hooks/useToast';
import type { UserProfile, Question, Course, Topic } from '../types';

// @ts-ignore
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

interface AdminPanelProps {
    userProfile: UserProfile;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ userProfile }) => {
    const [activeTab, setActiveTab] = useState<'questions' | 'courses' | 'users' | 'textbooks' | 'departments'>('departments');
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
    const [textbookFile, setTextbookFile] = useState<File | null>(null);
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
                    setCoursesList(snap.val().course_list || []);
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
                model: 'gemini-3.5-flash',
                contents: [
                    {
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

    const handleTextbookUpload = async () => {
        if (!textbookFile || !uploadDepartmentId || !uploadLevel || !uploadCourseName) {
            addToast("Please select a file and enter Department ID, Level, and Course Name", "error");
            return;
        }

        setIsUploading(true);
        setExtractionProgress('Uploading to storage...');

        try {
            // 1. Upload to Firebase Storage
            const fileRef = storageRef(storage, `textbooks/${uploadDepartmentId}/${uploadLevel}/${uploadCourseName}/${textbookFile.name}`);
            const uploadResult = await uploadBytes(fileRef, textbookFile);
            const downloadURL = await getDownloadURL(uploadResult.ref);

            setExtractionProgress('Extracting syllabus with Gemini 3.5 Flash...');
            
            const reader = new FileReader();
            reader.readAsDataURL(textbookFile);
            const base64PDF = await new Promise<string>((resolve) => {
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
            });

            const prompt = `Analyze this PDF textbook for "${uploadCourseName}" at "${uploadLevel}" level.
            Extract a comprehensive syllabus/course outline into a structured JSON array of topics.
            
            RULES:
            1. Output ONLY the JSON object.
            2. The root object must have a "syllabus" key which is an array of objects.
            3. Each topic object must have: topic_name (string) and topic_id (slugified string).

            FORMAT:
            {
                "syllabus": [
                    { "topic_name": "Introduction to...", "topic_id": "intro_to_..." },
                    ...
                ]
            }`;

            const response = await ai.models.generateContent({
                model: 'gemini-3.5-flash',
                contents: [
                    {
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

            const responseData = JSON.parse(response.text);
            const syllabusData = responseData.syllabus || [];

            setExtractionProgress('Saving to database...');

            // 3. Save to Textbook Contexts (for AI grounding)
            const textbookContextRef = dbRef(db, `textbook_contexts/${uploadDepartmentId}/${uploadLevel}/${uploadCourseName}`);
            await set(textbookContextRef, {
                pdf_url: downloadURL,
                syllabus: syllabusData,
                uploaded_at: Date.now()
            });

            // 4. Update Department Course List (for UI)
            const deptRef = dbRef(db, `departments_data/${uploadDepartmentId}`);
            const deptSnap = await get(deptRef);
            let currentCourses = [];
            if (deptSnap.exists()) {
                currentCourses = deptSnap.val().course_list || [];
            }

            const newCourse: Course = {
                course_id: uploadCourseName.toLowerCase().replace(/\s+/g, '_'),
                course_name: uploadCourseName,
                level: uploadLevel,
                topics: syllabusData,
                textbook_url: downloadURL
            };

            const existingIndex = currentCourses.findIndex((c: any) => c.course_id === newCourse.course_id);
            if (existingIndex > -1) {
                currentCourses[existingIndex] = newCourse;
            } else {
                currentCourses.push(newCourse);
            }

            await update(deptRef, { course_list: currentCourses });

            addToast("Textbook processed and course added successfully!", "success");
            setTextbookFile(null);
            setUploadCourseName('');
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
        setCoursesList([...coursesList, { course_id: '', course_name: '', topics: [], level: '100', semester: 'first' }]);
    };

    if (!userProfile.is_admin) {
        return <div className="p-8 text-center text-red-600 font-bold">Access Denied. Admins only.</div>;
    }

    return (
        <div className="flex-1 flex flex-col p-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6 text-gray-900">Admin Control Panel</h2>
            
            <div className="flex gap-4 mb-6 border-b border-gray-200 pb-2">
                <button 
                    onClick={() => setActiveTab('departments')}
                    className={`px-4 py-2 font-medium ${activeTab === 'departments' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                >
                    Departments
                </button>
                <button 
                    onClick={() => setActiveTab('questions')}
                    className={`px-4 py-2 font-medium ${activeTab === 'questions' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                >
                    Past Questions
                </button>
                <button 
                    onClick={() => setActiveTab('courses')}
                    className={`px-4 py-2 font-medium ${activeTab === 'courses' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                >
                    Department Outlines
                </button>
                <button 
                    onClick={() => setActiveTab('textbooks')}
                    className={`px-4 py-2 font-medium ${activeTab === 'textbooks' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
                >
                    Textbooks
                </button>
                <button 
                    onClick={() => setActiveTab('users')}
                    className={`px-4 py-2 font-medium ${activeTab === 'users' ? 'text-lime-600 border-b-2 border-lime-600' : 'text-gray-500'}`}
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
                    <select 
                        value={departmentId} 
                        onChange={e => setDepartmentId(e.target.value)}
                        className="w-full max-w-md p-2 border rounded-lg block bg-white"
                    >
                        <option value="">Select Department</option>
                        {allDepartments.map(dept => (
                            <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                        ))}
                    </select>
                    
                    <div className="space-y-4">
                        <h3 className="font-bold text-lg">Courses in this Department</h3>
                        {coursesList.map((s, sIdx) => (
                            <div key={sIdx} className="p-4 border rounded-xl bg-gray-50 relative">
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <input 
                                        type="text" placeholder="Course Name"
                                        value={s.course_name} 
                                        onChange={e => {
                                            const list = [...coursesList];
                                            list[sIdx].course_name = e.target.value;
                                            list[sIdx].course_id = e.target.value.toLowerCase().replace(/\s+/g, '_');
                                            setCoursesList(list);
                                        }}
                                        className="p-2 border rounded-lg"
                                    />
                                    <select 
                                        value={s.level} 
                                        onChange={e => {
                                            const list = [...coursesList];
                                            list[sIdx].level = e.target.value;
                                            setCoursesList(list);
                                        }}
                                        className="p-2 border rounded-lg"
                                    >
                                        {LEVELS.map(lvl => (
                                            <option key={lvl} value={lvl}>{lvl}</option>
                                        ))}
                                    </select>
                                </div>
                                
                                <div className="ml-6 space-y-2 mb-4">
                                    <h4 className="text-sm font-bold text-gray-700">Topics</h4>
                                    {s.topics?.map((t, tIdx) => (
                                        <div key={tIdx} className="flex gap-2">
                                            <input 
                                                type="text" 
                                                placeholder="Topic Name"
                                                value={t.topic_name}
                                                onChange={e => {
                                                    const list = [...coursesList];
                                                    list[sIdx].topics[tIdx].topic_name = e.target.value;
                                                    list[sIdx].topics[tIdx].topic_id = e.target.value.toLowerCase().replace(/\s+/g, '_');
                                                    setCoursesList(list);
                                                }}
                                                className="flex-1 p-2 border rounded-lg text-sm"
                                            />
                                            <button onClick={() => {
                                                const list = [...coursesList];
                                                list[sIdx].topics = list[sIdx].topics.filter((_, i) => i !== tIdx);
                                                setCoursesList(list);
                                            }} className="text-red-400">✕</button>
                                        </div>
                                    ))}
                                    <button 
                                        onClick={() => {
                                            const list = [...coursesList];
                                            if(!list[sIdx].topics) list[sIdx].topics = [];
                                            list[sIdx].topics.push({ topic_id: '', topic_name: '', is_complete: false });
                                            setCoursesList(list);
                                        }}
                                        className="text-xs text-lime-600 hover:underline"
                                    >
                                        + Add Topic
                                    </button>
                                </div>

                                <button className="text-red-500 text-sm mb-4" onClick={() => {
                                    const list = coursesList.filter((_, i) => i !== sIdx);
                                    setCoursesList(list);
                                }}>Remove Course</button>
                            </div>
                        ))}
                        <button 
                            onClick={addCourseField}
                            className="bg-gray-200 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition"
                        >
                            + Add Course
                        </button>
                    </div>

                    <button 
                        onClick={handleUpdateCourseOutline}
                        className="w-full max-w-md bg-teal-600 text-white py-3 rounded-xl font-bold hover:bg-teal-700 transition"
                    >
                        Publish Department Outline
                    </button>
                </div>
            )}

            {activeTab === 'textbooks' && (
                <div className="space-y-6 max-w-2xl">
                    <div className="bg-lime-50 p-4 rounded-xl border border-lime-200">
                        <h3 className="font-bold text-lime-800 mb-2">Textbook Digestion Flow</h3>
                        <p className="text-sm text-lime-700">
                            Upload a PDF textbook to automatically extract a structured syllabus and ground AI tutoring in its content.
                        </p>
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
                                type="text" placeholder="Course Name (e.g., CSC 101)" 
                                value={uploadCourseName} onChange={e => setUploadCourseName(e.target.value)}
                                className="p-2 border rounded-lg col-span-2"
                            />
                        </div>

                        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-lime-500 transition cursor-pointer">
                            <input 
                                type="file" 
                                accept="application/pdf"
                                onChange={e => setTextbookFile(e.target.files?.[0] || null)}
                                className="hidden" 
                                id="textbook-upload"
                            />
                            <label htmlFor="textbook-upload" className="cursor-pointer">
                                {textbookFile ? (
                                    <div className="text-lime-600 font-medium">{textbookFile.name}</div>
                                ) : (
                                    <div className="text-gray-500">
                                        <div className="text-3xl mb-2">📄</div>
                                        <span>Click to select PDF textbook</span>
                                    </div>
                                )}
                            </label>
                        </div>

                        {isUploading && (
                            <div className="flex items-center gap-3 text-lime-600 font-medium">
                                <span className="animate-spin text-xl">⏳</span>
                                <span>{extractionProgress}</span>
                            </div>
                        )}

                        <button 
                            onClick={handleTextbookUpload}
                            disabled={isUploading || !textbookFile}
                            className={`w-full py-4 rounded-xl font-bold transition ${isUploading || !textbookFile ? 'bg-gray-300 cursor-not-allowed' : 'bg-lime-600 text-white hover:bg-lime-700 shadow-lg shadow-lime-200'}`}
                        >
                            {isUploading ? 'Processing...' : 'Upload & Digest Textbook'}
                        </button>
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
