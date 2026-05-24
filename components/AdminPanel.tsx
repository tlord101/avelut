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

// @ts-ignore
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

interface AdminPanelProps {
    userProfile: UserProfile;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ userProfile }) => {
    const [activeTab, setActiveTab] = useState<'questions' | 'courses' | 'users' | 'departments'>('departments');
    const [allUsersList, setAllUsersList] = useState<UserProfile[]>([]);
    const [isUsersLoading, setIsUsersLoading] = useState(false);
    const { addToast } = useToast();

    // Departments State
    const [allDepartments, setAllDepartments] = useState<any[]>([]);
    const [newDeptName, setNewDeptName] = useState('');
    const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'];

    // Textbook course selection state
    const [selectedCourseId, setSelectedCourseId] = useState('');

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
            // Reset course selection when department changes
            setSelectedCourseId('');
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
        // Find selected course details from coursesList
        const selectedCourse = coursesList.find(c => c.course_id === selectedCourseId);
        
        if (!textbookFile || !departmentId || !selectedCourse) {
            addToast("Please select a file, department, and course", "error");
            return;
        }

        const { course_name, level } = selectedCourse;

        setIsUploading(true);
        setExtractionProgress('Uploading to storage...');

        try {
            // 1. Upload to Firebase Storage
            const fileRef = storageRef(storage, `textbooks/${departmentId}/${level}/${course_name}/${textbookFile.name}`);
            const uploadResult = await uploadBytes(fileRef, textbookFile);
            const downloadURL = await getDownloadURL(uploadResult.ref);

            setExtractionProgress('Extracting syllabus with Gemini 3.5 Flash...');
            
            const reader = new FileReader();
            reader.readAsDataURL(textbookFile);
            const base64PDF = await new Promise<string>((resolve) => {
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
            });

            const prompt = `Analyze this PDF textbook for "${course_name}" at "${level}" level.
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
            const textbookContextRef = dbRef(db, `textbook_contexts/${departmentId}/${level}/${course_name}`);
            await set(textbookContextRef, {
                pdf_url: downloadURL,
                syllabus: syllabusData,
                uploaded_at: Date.now()
            });

            // 4. Update the local coursesList and then database
            const updatedCoursesList = coursesList.map(c => {
                if (c.course_id === selectedCourseId) {
                    return {
                        ...c,
                        topics: syllabusData,
                        textbook_url: downloadURL
                    };
                }
                return c;
            });

            setCoursesList(updatedCoursesList);
            
            // Save to DB
            await update(dbRef(db, `departments_data/${departmentId}`), {
                course_list: updatedCoursesList
            });

            addToast(`Textbook for ${course_name} processed successfully!`, "success");
            setTextbookFile(null);
            setSelectedCourseId('');
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
                        <h3 className="font-bold text-gray-800 mb-4">Manage Department Content</h3>
                        <select 
                            value={departmentId} 
                            onChange={e => setDepartmentId(e.target.value)}
                            className="w-full max-w-md p-3 border rounded-xl block bg-gray-50 mb-6"
                        >
                            <option value="">Select Department</option>
                            {allDepartments.map(dept => (
                                <option key={dept.id} value={dept.id}>{dept.department_name}</option>
                            ))}
                        </select>

                        {departmentId && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* Left side: Textbook Upload */}
                                <div className="space-y-6">
                                    <div className="bg-lime-50 p-6 rounded-2xl border border-lime-100">
                                        <h4 className="font-bold text-lime-800 mb-2 flex items-center gap-2">
                                            <span>📚</span> Upload Course Textbook
                                        </h4>
                                        <p className="text-sm text-lime-700 mb-4">
                                            Select a course to upload its textbook. Gemini will automatically extract topics and syllabus.
                                        </p>

                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-bold text-lime-700 uppercase mb-1 ml-1">Select Course</label>
                                                <select 
                                                    value={selectedCourseId} 
                                                    onChange={e => setSelectedCourseId(e.target.value)}
                                                    className="w-full p-3 border rounded-xl bg-white focus:ring-2 focus:ring-lime-500 transition-all outline-none"
                                                >
                                                    <option value="">Select a course from list...</option>
                                                    {coursesList.map(c => (
                                                        <option key={c.course_id} value={c.course_id}>
                                                            {c.course_name} ({c.level})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div 
                                                className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer ${textbookFile ? 'border-lime-500 bg-lime-50' : 'border-gray-300 hover:border-lime-400 bg-gray-50'}`}
                                            >
                                                <input 
                                                    type="file" 
                                                    accept="application/pdf"
                                                    onChange={e => setTextbookFile(e.target.files?.[0] || null)}
                                                    className="hidden" 
                                                    id="textbook-upload-inline"
                                                />
                                                <label htmlFor="textbook-upload-inline" className="cursor-pointer block">
                                                    {textbookFile ? (
                                                        <div className="flex flex-col items-center">
                                                            <div className="text-lime-600 font-bold mb-1 truncate max-w-full px-2">{textbookFile.name}</div>
                                                            <div className="text-xs text-lime-500">{(textbookFile.size / 1024 / 1024).toFixed(2)} MB</div>
                                                        </div>
                                                    ) : (
                                                        <div className="text-gray-400">
                                                            <div className="text-2xl mb-1">📄</div>
                                                            <span className="text-sm font-medium">Click to select PDF textbook</span>
                                                        </div>
                                                    )}
                                                </label>
                                            </div>

                                            {isUploading && (
                                                <div className="flex items-center justify-center gap-3 text-lime-600 font-bold py-2">
                                                    <span className="animate-spin text-xl">⏳</span>
                                                    <span className="text-sm animate-pulse">{extractionProgress}</span>
                                                </div>
                                            )}

                                            <button 
                                                onClick={handleTextbookUpload}
                                                disabled={isUploading || !textbookFile || !selectedCourseId}
                                                className={`w-full py-3.5 rounded-xl font-bold transition-all transform active:scale-95 ${isUploading || !textbookFile || !selectedCourseId ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-lime-600 text-white hover:bg-lime-700 shadow-md shadow-lime-200'}`}
                                            >
                                                {isUploading ? 'Processing...' : 'Upload & Digest Textbook'}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Right side: Outline Management */}
                                <div className="space-y-6">
                                    <div className="flex justify-between items-center mb-2">
                                        <h4 className="font-bold text-gray-700">Course List & Topics</h4>
                                        <button 
                                            onClick={addCourseField}
                                            className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg font-bold transition-colors text-gray-600"
                                        >
                                            + Add New Course
                                        </button>
                                    </div>

                                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 [scrollbar-width:thin] scrollbar-thumb-gray-300">
                                        {coursesList.map((s, sIdx) => (
                                            <div key={sIdx} className="p-4 border rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                                                    <input 
                                                        type="text" placeholder="Course Name"
                                                        value={s.course_name} 
                                                        onChange={e => {
                                                            const list = [...coursesList];
                                                            list[sIdx].course_name = e.target.value;
                                                            list[sIdx].course_id = e.target.value.toLowerCase().replace(/\s+/g, '_');
                                                            setCoursesList(list);
                                                        }}
                                                        className="p-2.5 border rounded-xl text-sm bg-gray-50 focus:bg-white transition-colors"
                                                    />
                                                    <select 
                                                        value={s.level} 
                                                        onChange={e => {
                                                            const list = [...coursesList];
                                                            list[sIdx].level = e.target.value;
                                                            setCoursesList(list);
                                                        }}
                                                        className="p-2.5 border rounded-xl text-sm bg-gray-50 focus:bg-white"
                                                    >
                                                        {LEVELS.map(lvl => (
                                                            <option key={lvl} value={lvl}>{lvl}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                
                                                <div className="pl-4 border-l-2 border-gray-100 space-y-2 mb-4">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Topics</span>
                                                        <span className="text-[10px] text-gray-400">{s.topics?.length || 0} topics</span>
                                                    </div>
                                                    <div className="space-y-2">
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
                                                                    className="flex-1 p-2 border border-gray-100 rounded-lg text-xs bg-gray-50 focus:bg-white"
                                                                />
                                                                <button onClick={() => {
                                                                    const list = [...coursesList];
                                                                    list[sIdx].topics = list[sIdx].topics.filter((_, i) => i !== tIdx);
                                                                    setCoursesList(list);
                                                                }} className="text-gray-300 hover:text-red-500 transition-colors">
                                                                    <XIcon className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <button 
                                                        onClick={() => {
                                                            const list = [...coursesList];
                                                            if(!list[sIdx].topics) list[sIdx].topics = [];
                                                            list[sIdx].topics.push({ topic_id: '', topic_name: '', is_complete: false });
                                                            setCoursesList(list);
                                                        }}
                                                        className="text-[10px] font-bold text-lime-600 hover:text-lime-700 mt-1 uppercase"
                                                    >
                                                        + Add Topic
                                                    </button>
                                                </div>

                                                <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                                                    {s.textbook_url ? (
                                                        <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1">
                                                            <span>✓</span> Textbook Ready
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full font-bold uppercase">No Textbook</span>
                                                    )}
                                                    <button className="text-red-400 hover:text-red-600 text-xs font-bold transition-colors" onClick={() => {
                                                        const list = coursesList.filter((_, i) => i !== sIdx);
                                                        setCoursesList(list);
                                                    }}>Delete Course</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    
                                    <button 
                                        onClick={handleUpdateCourseOutline}
                                        className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold hover:bg-black transition-all shadow-lg active:scale-95"
                                    >
                                        Save & Publish All Changes
                                    </button>
                                </div>
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
