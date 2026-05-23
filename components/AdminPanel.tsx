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
    const [activeTab, setActiveTab] = useState<'questions' | 'courses' | 'users' | 'textbooks'>('questions');
    const { addToast } = useToast();

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
            // ... (rest same until RTDB save)

            // 3. Save to RTDB
            const textbookRef = dbRef(db, `textbook_contexts/${uploadDepartmentId}/${uploadLevel}/${uploadCourseName}`);
            await set(textbookRef, {
                pdf_url: downloadURL,
                syllabus: syllabusData,
                uploaded_at: Date.now()
            });

            addToast("Textbook processed and saved successfully!", "success");
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
            </div>

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
                            <input 
                                type="text" placeholder="Department ID (e.g., computer_science)" 
                                value={uploadDepartmentId} onChange={e => setUploadDepartmentId(e.target.value)}
                                className="p-2 border rounded-lg bg-white"
                            />
                            <input 
                                type="text" placeholder="Level (e.g., 100L)" 
                                value={uploadLevel} onChange={e => setUploadLevel(e.target.value)}
                                className="p-2 border rounded-lg bg-white"
                            />
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
                            <input 
                                type="text" placeholder="Dept ID" 
                                value={uploadDepartmentId} onChange={e => setUploadDepartmentId(e.target.value)}
                                className="p-2 border rounded-lg"
                            />
                            <input 
                                type="text" placeholder="Level" 
                                value={uploadLevel} onChange={e => setUploadLevel(e.target.value)}
                                className="p-2 border rounded-lg"
                            />
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
                    <input 
                        type="text" placeholder="Department ID (e.g., computer_science)" 
                        value={departmentId} onChange={e => setDepartmentId(e.target.value)}
                        className="w-full max-w-md p-2 border rounded-lg block"
                    />
                    
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
                                        <option value="100">Level 100</option>
                                        <option value="200">Level 200</option>
                                        <option value="300">Level 300</option>
                                        <option value="400">Level 400</option>
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
                            <input 
                                type="text" placeholder="Department ID" 
                                value={uploadDepartmentId} onChange={e => setUploadDepartmentId(e.target.value)}
                                className="p-2 border rounded-lg"
                            />
                            <input 
                                type="text" placeholder="Level (e.g., 100L)" 
                                value={uploadLevel} onChange={e => setUploadLevel(e.target.value)}
                                className="p-2 border rounded-lg"
                            />
                            <input 
                                type="text" placeholder="Course Name" 
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
        </div>
    );
};
