import React, { useState, useEffect, useRef } from 'react';
import { db, ref as dbRef, get, update } from '@/lib/backend';
import { Type, createAvelutAI } from '../../../utils/inference';
import { useToast } from '../../../hooks/useToast';
import { useAppSettings } from '../../../hooks/useAppSettings';
import { SlideOverDrawer } from './SlideOverDrawer';
import {
    Plus,
    UploadCloud,
    FileText,
    Check,
    CheckCircle2,
    Link2,
    Building2,
    Trash2,
    Sparkles,
    Search,
    ChevronDown,
    Loader2,
    Layers,
    Globe
} from 'lucide-react';
import type { Course } from '../../../types';

const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'];

export interface HybridCourseDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    currentDeptId: string;
    allDepartments: any[];
    onCourseCreated: () => Promise<void> | void;
}

interface ExtractedCourseItem {
    course_id: string;
    course_code: string;
    course_name: string;
    course_unit: number;
    level: string;
    semester: 'first' | 'second';
    isGlobalExist: boolean;
    existingLinkedDepts?: string[];
}

export const HybridCourseDrawer: React.FC<HybridCourseDrawerProps> = ({
    isOpen,
    onClose,
    currentDeptId,
    allDepartments,
    onCourseCreated,
}) => {
    const { addToast } = useToast();
    const { settings: appSettings } = useAppSettings();

    const [activeTab, setActiveTab] = useState<'single' | 'bulk'>('single');

    // Single Course Form State
    const [code, setCode] = useState('');
    const [title, setTitle] = useState('');
    const [units, setUnits] = useState('3');
    const [level, setLevel] = useState('100lvl');
    const [semester, setSemester] = useState<'first' | 'second'>('first');
    const [selectedDeptIds, setSelectedDeptIds] = useState<Set<string>>(new Set([currentDeptId]));
    const [deptSearchQuery, setDeptSearchQuery] = useState('');
    const [isDeptDropdownOpen, setIsDeptDropdownOpen] = useState(false);
    const [isSubmittingSingle, setIsSubmittingSingle] = useState(false);

    // Bulk Upload State
    const [isDragOver, setIsDragOver] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractedCourses, setExtractedCourses] = useState<ExtractedCourseItem[]>([]);
    const [isSavingBulk, setIsSavingBulk] = useState(false);
    const [bulkScope, setBulkScope] = useState<'current' | 'all'>('current');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSelectedDeptIds(new Set([currentDeptId]));
    }, [currentDeptId, isOpen]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDeptDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const aiApiKey = appSettings.openrouter_api_key?.trim() || appSettings.alibaba_api_key?.trim() || '';
    const aiClient = useRef<any>(null);
    useEffect(() => {
        aiClient.current = createAvelutAI(appSettings);
    }, [aiApiKey, appSettings]);

    const toggleDeptSelection = (deptId: string) => {
        if (deptId === currentDeptId) return; // Always keep current department selected
        setSelectedDeptIds((prev) => {
            const next = new Set(prev);
            if (next.has(deptId)) next.delete(deptId);
            else next.add(deptId);
            return next;
        });
    };

    const filteredDepartments = allDepartments.filter((d) => {
        const name = d.department_name || d.name || d.id || '';
        return name.toLowerCase().includes(deptSearchQuery.toLowerCase());
    });

    // Handle Single Course Creation & Cross-Listing
    const handleCreateSingleCourse = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedCode = code.trim().toUpperCase();
        const trimmedTitle = title.trim();

        if (!trimmedTitle) {
            addToast('Course title is required.', 'error');
            return;
        }

        const courseId = (trimmedCode || trimmedTitle).toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
        const linkedDeptsArray = Array.from(selectedDeptIds);

        setIsSubmittingSingle(true);
        try {
            const updates: Record<string, any> = {};

            const newCourseObj: Course = {
                course_id: courseId,
                course_code: trimmedCode || undefined,
                course_name: trimmedTitle,
                course_unit: Number(units) || 3,
                level,
                semester,
                course_status: 'ACTIVE',
                topics: [],
                textbook_urls: [],
                linked_departments: linkedDeptsArray,
            };

            // 1. Update master entry in global_courses
            const globalSnap = await get(dbRef(db, `global_courses/${courseId}`));
            let existingGlobalDepts: string[] = [];
            if (globalSnap.exists()) {
                const globalVal = globalSnap.val();
                existingGlobalDepts = globalVal?.linked_departments || [];
            }
            const mergedLinkedDepts = Array.from(new Set([...existingGlobalDepts, ...linkedDeptsArray]));
            updates[`global_courses/${courseId}`] = {
                ...newCourseObj,
                linked_departments: mergedLinkedDepts,
            };

            // 2. Multi-path update across all linked departments
            for (const deptId of mergedLinkedDepts) {
                const deptSnap = await get(dbRef(db, `departments_data/${deptId}`));
                let deptCourses: Course[] = [];
                if (deptSnap.exists()) {
                    const data = deptSnap.val();
                    const rawList = data?.course_list;
                    if (Array.isArray(rawList)) deptCourses = rawList;
                    else if (rawList && typeof rawList === 'object') deptCourses = Object.values(rawList);
                }

                const filtered = deptCourses.filter((c) => c.course_id !== courseId);
                const updatedCourseForDept = {
                    ...newCourseObj,
                    linked_departments: mergedLinkedDepts,
                };
                updates[`departments_data/${deptId}/course_list`] = [...filtered, updatedCourseForDept];
            }

            await update(dbRef(db), updates);

            addToast(`Course "${trimmedCode || trimmedTitle}" saved & cross-listed successfully!`, 'success');
            setCode('');
            setTitle('');
            setUnits('3');
            onClose();
            await onCourseCreated();
        } catch (error: any) {
            console.error('Error creating course:', error);
            addToast('Failed to save course: ' + error.message, 'error');
        } finally {
            setIsSubmittingSingle(false);
        }
    };

    // Bulk Upload AI Extraction
    const handleBulkFileProcess = async (file: File) => {
        if (!aiClient.current) {
            addToast('Avelut AI API key is missing in App Controls.', 'error');
            return;
        }

        setIsExtracting(true);
        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            const base64Data = await new Promise<string>((resolve) => {
                reader.onload = () => resolve((reader.result as string).split(',')[1]);
            });

            const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
            const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
            const isImage = mimeType.startsWith('image/');

            const prompt = `Analyze this course form/document and extract all courses listed.
Extract for each course:
- course_code (string, e.g. "MEE 301")
- course_name (string, e.g. "Applied Thermodynamics")
- course_unit (number, e.g. 3)
- level (string, e.g. "300lvl")
- semester (string, "first" or "second")

OUTPUT ONLY A VALID JSON OBJECT:
{
  "courses": [
    {
      "course_code": "MEE 301",
      "course_name": "Applied Thermodynamics",
      "course_unit": 3,
      "level": "300lvl",
      "semester": "first"
    }
  ]
}`;

            // Prefer qwen3.8-omni-flash (app standard). Never force qwen-vl-plus.
            const modelName =
              appSettings?.usage_settings?.feature_models?.study_guide_extraction ||
              appSettings?.alibaba_model ||
              'qwen3.8-omni-flash';

            // Build parts: images go as vision input; PDFs are text-extracted so DashScope
            // does not receive illegal application/pdf inside image_url.
            const parts: any[] = [{ text: prompt }];
            if (isImage) {
              parts.push({ inlineData: { mimeType, data: base64Data } });
            } else if (isPdf) {
              try {
                const { extractTextFromPDF } = await import('../../../utils/pdfExtraction');
                const pdfText = await extractTextFromPDF(file);
                const truncated = (pdfText || '').slice(0, 120000);
                if (truncated.trim()) {
                  parts[0] = {
                    text: `${prompt}\n\n--- DOCUMENT TEXT (extracted from PDF) ---\n${truncated}`,
                  };
                } else {
                  // Fallback: still send as document note; model cannot open raw PDF via image_url
                  parts.push({
                    inlineData: { mimeType: 'application/pdf', data: base64Data },
                  });
                }
              } catch (extractErr) {
                console.warn('PDF text extraction failed, sending as attachment note', extractErr);
                parts.push({
                  inlineData: { mimeType: 'application/pdf', data: base64Data },
                });
              }
            } else {
              // Other docs: try to send as text note / attachment
              parts.push({ inlineData: { mimeType, data: base64Data } });
            }

            const response = await aiClient.current.models.generateContent({
                model: modelName,
                contents: [
                    {
                        role: 'user',
                        parts,
                    },
                ],
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
                                        course_code: { type: Type.STRING },
                                        course_name: { type: Type.STRING },
                                        course_unit: { type: Type.NUMBER },
                                        level: { type: Type.STRING },
                                        semester: { type: Type.STRING },
                                    },
                                    required: ['course_name'],
                                },
                            },
                        },
                        required: ['courses'],
                    },
                },
            });

            // getResponseText handles both string and function .text forms from createAvelutAI
            const { getResponseText } = await import('../../../utils/inference');
            const responseText = getResponseText(response) || '';
            if (!responseText.trim()) {
              throw new Error('AI returned an empty response while extracting courses.');
            }
            const parsed = JSON.parse(responseText);
            const extractedListRaw = Array.isArray(parsed.courses) ? parsed.courses : [];

            // Query global_courses to check existing status
            const globalCoursesSnap = await get(dbRef(db, 'global_courses'));
            const globalCoursesMap = globalCoursesSnap.exists() ? globalCoursesSnap.val() : {};

            const items: ExtractedCourseItem[] = extractedListRaw.map((item: any) => {
                const courseCode = (item.course_code || '').trim().toUpperCase();
                const courseName = (item.course_name || '').trim();
                const courseId = (courseCode || courseName).toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');

                const globalEntry = globalCoursesMap[courseId];
                const isExist = Boolean(globalEntry);
                const existingDepts = globalEntry?.linked_departments || [];

                // Check level from item or code digits (e.g. 211 -> 200lvl)
                const inferLvl = (rawLvl?: string, code?: string): string => {
                    if (rawLvl) {
                        const clean = rawLvl.toLowerCase().replace(/\s+/g, '');
                        if (LEVELS.includes(clean)) return clean;
                        const match = clean.match(/\d+/);
                        if (match && LEVELS.includes(`${match[0]}lvl`)) return `${match[0]}lvl`;
                    }
                    if (code) {
                        const codeMatch = code.match(/\b([1-5])\d{2}\b/);
                        if (codeMatch && codeMatch[1]) return `${codeMatch[1]}00lvl`;
                    }
                    return '100lvl';
                };

                const resolvedLevel = inferLvl(item.level, courseCode);

                return {
                    course_id: courseId,
                    course_code: courseCode,
                    course_name: courseName || 'Untitled Course',
                    course_unit: Number(item.course_unit) || 3,
                    level: resolvedLevel,
                    semester: item.semester === 'second' ? 'second' : 'first',
                    isGlobalExist: isExist,
                    existingLinkedDepts: existingDepts,
                };
            });

            setExtractedCourses(items);
            addToast(`Extracted ${items.length} course(s) from "${file.name}"!`, 'success');
        } catch (error: any) {
            console.error('Error extracting course bulk form:', error);
            addToast('AI course extraction failed: ' + error.message, 'error');
        } finally {
            setIsExtracting(false);
        }
    };

    // Save Extracted Bulk Courses
    const handleSaveBulkCourses = async () => {
        if (extractedCourses.length === 0) return;

        setIsSavingBulk(true);
        try {
            const updates: Record<string, any> = {};

            // Determine target departments based on selected bulk scope
            const allDeptIds = allDepartments.map((d) => d.id).filter(Boolean);
            const targetDeptIdsToUpdate = new Set<string>();

            if (bulkScope === 'all') {
                allDeptIds.forEach((id) => targetDeptIdsToUpdate.add(id));
                targetDeptIdsToUpdate.add(currentDeptId);
            } else {
                targetDeptIdsToUpdate.add(currentDeptId);
            }

            // Map to hold updated course list for each target department
            const deptCourseMaps = new Map<string, Map<string, Course>>();

            // Fetch current course lists for all target departments
            for (const dId of Array.from(targetDeptIdsToUpdate)) {
                const dSnap = await get(dbRef(db, `departments_data/${dId}`));
                let dCourses: Course[] = [];
                if (dSnap.exists()) {
                    const data = dSnap.val();
                    const rawList = data?.course_list;
                    if (Array.isArray(rawList)) dCourses = rawList;
                    else if (rawList && typeof rawList === 'object') dCourses = Object.values(rawList);
                }
                const cMap = new Map<string, Course>();
                dCourses.forEach((c) => cMap.set(c.course_id, c));
                deptCourseMaps.set(dId, cMap);
            }

            for (const item of extractedCourses) {
                const linkedDepts = Array.from(
                    new Set([
                        ...(item.existingLinkedDepts || []),
                        ...(bulkScope === 'all' ? allDeptIds : [currentDeptId]),
                    ])
                );

                const courseObj: Course = {
                    course_id: item.course_id,
                    course_code: item.course_code || undefined,
                    course_name: item.course_name,
                    course_unit: item.course_unit,
                    level: item.level,
                    semester: item.semester,
                    course_status: 'ACTIVE',
                    topics: [],
                    textbook_urls: [],
                    linked_departments: linkedDepts,
                };

                // Update in all target department maps
                for (const dId of targetDeptIdsToUpdate) {
                    const cMap = deptCourseMaps.get(dId);
                    if (cMap) {
                        cMap.set(item.course_id, courseObj);
                    }
                }

                // Update global_courses master entry
                updates[`global_courses/${item.course_id}`] = courseObj;
            }

            // Add department course_list updates to database multi-location update object
            for (const dId of Array.from(targetDeptIdsToUpdate)) {
                const cMap = deptCourseMaps.get(dId);
                if (cMap) {
                    updates[`departments_data/${dId}/course_list`] = Array.from(cMap.values());
                }
            }

            await update(dbRef(db), updates);

            addToast(
                `Successfully saved ${extractedCourses.length} course(s) ${
                    bulkScope === 'all' ? 'across all departments' : 'to current department'
                }!`,
                'success'
            );
            setExtractedCourses([]);
            onClose();
            await onCourseCreated();
        } catch (error: any) {
            console.error('Error saving bulk extracted courses:', error);
            addToast('Failed to save extracted courses: ' + error.message, 'error');
        } finally {
            setIsSavingBulk(false);
        }
    };

    const handleRemoveExtractedItem = (index: number) => {
        setExtractedCourses((prev) => prev.filter((_, idx) => idx !== index));
    };

    return (
        <SlideOverDrawer
            isOpen={isOpen}
            onClose={onClose}
            title="Course Creation Studio"
            description="Register a single course with cross-listing or bulk upload course forms using Alibaba Qwen AI."
        >
            <div className="space-y-6">
                {/* Header Toggle Tabs */}
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <button
                        type="button"
                        onClick={() => setActiveTab('single')}
                        className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'single'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-md'
                                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <Plus className="w-4 h-4 text-amber-500" />
                        <span>Single Course</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('bulk')}
                        className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                            activeTab === 'bulk'
                                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-md'
                                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        <UploadCloud className="w-4 h-4 text-amber-500" />
                        <span>Bulk Upload</span>
                    </button>
                </div>

                {/* TAB 1: Single Course */}
                {activeTab === 'single' && (
                    <form onSubmit={handleCreateSingleCourse} className="space-y-5 animate-in fade-in duration-200">
                        <div className="space-y-2">
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                Course Code
                            </label>
                            <input
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                placeholder="e.g. GET 208"
                                className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 transition-all uppercase"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                Course Title *
                            </label>
                            <input
                                type="text"
                                required
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Engineering Thermodynamics"
                                className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 transition-all"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                    Credit Units
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    max={12}
                                    value={units}
                                    onChange={(e) => setUnits(e.target.value)}
                                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 transition-all"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                    Level
                                </label>
                                <select
                                    value={level}
                                    onChange={(e) => setLevel(e.target.value)}
                                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 transition-all"
                                >
                                    {LEVELS.map((lvl) => (
                                        <option key={lvl} value={lvl}>
                                            {lvl}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                                Semester
                            </label>
                            <select
                                value={semester}
                                onChange={(e) => setSemester(e.target.value as any)}
                                className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 transition-all"
                            >
                                <option value="first">First Semester</option>
                                <option value="second">Second Semester</option>
                            </select>
                        </div>

                        {/* Cross-List MultiSelectDropdown */}
                        <div className="space-y-2 relative" ref={dropdownRef}>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                <Link2 className="w-3.5 h-3.5 text-amber-500" />
                                Cross-List to Departments ({selectedDeptIds.size})
                            </label>

                            <button
                                type="button"
                                onClick={() => setIsDeptDropdownOpen(!isDeptDropdownOpen)}
                                className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-900 dark:text-white flex items-center justify-between outline-none hover:border-amber-500/50 transition-all"
                            >
                                <span className="truncate">
                                    {selectedDeptIds.size === 1
                                        ? 'Current Department Only'
                                        : `${selectedDeptIds.size} Departments Selected`}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isDeptDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isDeptDropdownOpen && (
                                <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl p-3 space-y-2 max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95">
                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                                        <input
                                            type="text"
                                            value={deptSearchQuery}
                                            onChange={(e) => setDeptSearchQuery(e.target.value)}
                                            placeholder="Search department..."
                                            className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:border-amber-500"
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        {filteredDepartments.length === 0 ? (
                                            <p className="text-xs text-slate-400 p-2">No departments found.</p>
                                        ) : (
                                            filteredDepartments.map((dept) => {
                                                const deptId = dept.id;
                                                const deptName = dept.department_name || dept.name || deptId;
                                                const isCurrent = deptId === currentDeptId;
                                                const isSelected = selectedDeptIds.has(deptId);

                                                return (
                                                    <div
                                                        key={deptId}
                                                        onClick={() => toggleDeptSelection(deptId)}
                                                        className={`flex items-center justify-between p-2.5 rounded-xl text-xs font-medium cursor-pointer transition-colors ${
                                                            isSelected
                                                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 font-bold'
                                                                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-2 truncate">
                                                            <Building2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                                            <span className="truncate">{deptName}</span>
                                                            {isCurrent && (
                                                                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-black text-[9px] uppercase">
                                                                    Current
                                                                </span>
                                                            )}
                                                        </div>

                                                        {isSelected && (
                                                            <Check className="w-4 h-4 text-amber-500 shrink-0" />
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={isSubmittingSingle}
                                className="px-5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmittingSingle || !title.trim()}
                                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/20 disabled:opacity-40"
                            >
                                {isSubmittingSingle ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Saving...</span>
                                    </>
                                ) : (
                                    <span>Save & Cross-List</span>
                                )}
                            </button>
                        </div>
                    </form>
                )}

                {/* TAB 2: Bulk Upload */}
                {activeTab === 'bulk' && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        {/* Target Department Link Scope Selector */}
                        <div className="space-y-2">
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                <Link2 className="w-3.5 h-3.5 text-amber-500" />
                                Link Bulk Courses To
                            </label>
                            <div className="grid grid-cols-2 gap-3 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setBulkScope('current')}
                                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all ${
                                        bulkScope === 'current'
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-md font-black'
                                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <Building2 className="w-4 h-4 text-amber-500 shrink-0" />
                                    <span className="truncate">Current Dept Only</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setBulkScope('all')}
                                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all ${
                                        bulkScope === 'all'
                                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-md font-black'
                                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                                    }`}
                                >
                                    <Globe className="w-4 h-4 text-amber-500 shrink-0" />
                                    <span className="truncate">All Departments ({allDepartments.length})</span>
                                </button>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                {bulkScope === 'current'
                                    ? 'Uploaded courses will be linked to this department only.'
                                    : `Uploaded courses will be cross-listed to all ${allDepartments.length} department(s) in the system.`}
                            </p>
                        </div>

                        {/* Dropzone */}
                        <div
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsDragOver(true);
                            }}
                            onDragLeave={() => setIsDragOver(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setIsDragOver(false);
                                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                    void handleBulkFileProcess(e.dataTransfer.files[0]);
                                }
                            }}
                            onClick={() => fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-3xl p-8 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-3 ${
                                isDragOver
                                    ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/30 scale-[1.01]'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-amber-500/50 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.png,.jpg,.jpeg"
                                onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) {
                                        void handleBulkFileProcess(e.target.files[0]);
                                    }
                                }}
                                className="hidden"
                            />
                            <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-500 flex items-center justify-center shadow-inner">
                                <Sparkles className="w-7 h-7" />
                            </div>
                            <div className="space-y-1">
                                <p className="font-bold text-sm text-slate-900 dark:text-white">
                                    Drop Departmental Course Form (PDF or Image)
                                </p>
                                <p className="text-xs text-slate-400">Alibaba Qwen AI will extract Code, Title, Units & Level</p>
                            </div>
                        </div>

                        {/* Extraction Loading State */}
                        {isExtracting && (
                            <div className="p-5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 flex items-center gap-3 animate-in fade-in">
                                <Loader2 className="w-5 h-5 animate-spin text-amber-500 shrink-0" />
                                <div className="space-y-0.5">
                                    <p className="text-xs font-black text-amber-900 dark:text-amber-300 uppercase tracking-wider">
                                        Analyzing Course Form with AI...
                                    </p>
                                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                        Extracting roster structure and checking global duplicates.
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Extracted Courses Preview List */}
                        {extractedCourses.length > 0 && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                        <Layers className="w-4 h-4 text-amber-500" />
                                        Extracted Courses ({extractedCourses.length})
                                    </h4>
                                    <button
                                        type="button"
                                        onClick={() => setExtractedCourses([])}
                                        className="text-xs font-bold text-rose-500 hover:text-rose-600"
                                    >
                                        Clear List
                                    </button>
                                </div>

                                <div className="space-y-3 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                                    {extractedCourses.map((item, idx) => (
                                        <div
                                            key={idx}
                                            className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2 relative"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="space-y-1 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        {item.course_code && (
                                                            <span className="px-2.5 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-mono font-black text-xs">
                                                                {item.course_code}
                                                            </span>
                                                        )}

                                                        {item.isGlobalExist ? (
                                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-bold text-[10px] uppercase border border-emerald-500/20">
                                                                <Link2 className="w-3 h-3" />
                                                                Link to Department
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 font-bold text-[10px] uppercase">
                                                                New Global Course
                                                            </span>
                                                        )}
                                                    </div>

                                                    <h5 className="font-bold text-sm text-slate-900 dark:text-white pt-1">
                                                        {item.course_name}
                                                    </h5>

                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                                                        <span>{item.course_unit} Units</span>
                                                        <span>•</span>
                                                        <span>{item.level}</span>
                                                        <span>•</span>
                                                        <span>{item.semester} semester</span>
                                                    </div>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveExtractedItem(idx)}
                                                    className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                                    title="Remove Course"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        disabled={isSavingBulk}
                                        className="px-5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 font-bold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSaveBulkCourses}
                                        disabled={isSavingBulk || extractedCourses.length === 0}
                                        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/20 disabled:opacity-40"
                                    >
                                        {isSavingBulk ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span>Saving Batch...</span>
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle2 className="w-4 h-4" />
                                                <span>Import {extractedCourses.length} Course(s)</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </SlideOverDrawer>
    );
};
