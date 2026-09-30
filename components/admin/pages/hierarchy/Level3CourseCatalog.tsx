import { db, get, ref as dbRef, update } from '@/lib/backend';
import React, { useState, useEffect } from 'react';
import { useToast } from '../../../../hooks/useToast';
import { InlineEditableText } from '../../primitives/InlineEditableText';
import { SmartDeleteModal } from '../../primitives/SmartDeleteModal';
import { HybridCourseDrawer } from '../../primitives/HybridCourseDrawer';
import { BreadcrumbNavigation } from '../../primitives/BreadcrumbNavigation';
import { Building2, GraduationCap, BookOpen, Plus, Trash2, LayoutGrid, List, ArrowRight, Layers, FileText, Archive, Share2 } from 'lucide-react';
import type { Course } from '../../../../types';

const LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'];

interface Level3CourseCatalogProps {
    schoolId: string;
    deptId: string;
    schoolsData: Record<string, any>;
    allDepartments: any[];
    onNavigate: (path: string) => void;
    refreshData: () => Promise<void>;
}

export const Level3CourseCatalog: React.FC<Level3CourseCatalogProps> = ({
    schoolId,
    deptId,
    schoolsData,
    allDepartments,
    onNavigate,
    refreshData,
}) => {
    const { addToast } = useToast();
    const school = schoolsData[schoolId] || { name: schoolId };
    const department = allDepartments.find((d) => d.id === deptId) || { department_name: deptId };
    const collegeId = department.collegeId;
    const college = collegeId ? school.colleges?.[collegeId] || { name: collegeId } : null;

    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [courses, setCourses] = useState<Course[]>([]);
    const [isLoadingCourses, setIsLoadingCourses] = useState(true);

    // Slide-over Add Course state
    const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
    const [newCourseCode, setNewCourseCode] = useState('');
    const [newCourseTitle, setNewCourseTitle] = useState('');
    const [newCreditUnits, setNewCreditUnits] = useState('3');
    const [newLevel, setNewLevel] = useState('100lvl');
    const [newSemester, setNewSemester] = useState<'first' | 'second'>('first');
    const [isCreating, setIsCreating] = useState(false);

    // Delete Course Modal state
    const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);
    const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Batch Selection state
    const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(new Set());

    const toggleCourseSelection = (courseId: string) => {
        setSelectedCourseIds((prev) => {
            const next = new Set(prev);
            if (next.has(courseId)) next.delete(courseId);
            else next.add(courseId);
            return next;
        });
    };

    const toggleSelectAllCourses = () => {
        if (selectedCourseIds.size === courses.length && courses.length > 0) {
            setSelectedCourseIds(new Set());
        } else {
            setSelectedCourseIds(new Set(courses.map((c) => c.course_id)));
        }
    };

    const handleTriggerBatchDelete = () => {
        if (selectedCourseIds.size === 0) return;
        setIsBatchDeleteModalOpen(true);
    };

    const resolveLinkedDepartments = async (courseId: string, fallbackLinked?: string[]): Promise<string[]> => {
        try {
            const globalSnap = await get(dbRef(db, `global_courses/${courseId}`));
            if (globalSnap.exists()) {
                const val = globalSnap.val();
                if (Array.isArray(val?.linked_departments) && val.linked_departments.length > 0) {
                    return val.linked_departments;
                }
            }
        } catch (e) {
            console.error('Error fetching global course info:', e);
        }

        if (fallbackLinked && fallbackLinked.length > 0) {
            return fallbackLinked;
        }

        // Deep Fallback: scan departments_data for any course_list entry matching course_id
        try {
            const allDeptsSnap = await get(dbRef(db, 'departments_data'));
            if (allDeptsSnap.exists()) {
                const allDeptsData = allDeptsSnap.val();
                const foundDeptIds: string[] = [];
                for (const dId of Object.keys(allDeptsData)) {
                    const rawList = allDeptsData[dId]?.course_list;
                    const list: Course[] = Array.isArray(rawList) ? rawList : Object.values(rawList || {});
                    if (list.some((item) => item?.course_id === courseId)) {
                        foundDeptIds.push(dId);
                    }
                }
                if (foundDeptIds.length > 0) return foundDeptIds;
            }
        } catch (e) {
            console.error('Error scanning departments_data:', e);
        }

        return [deptId];
    };

    const handleExecuteBatchSmartDeleteCourse = async ({ action }: { action: 'unlink' | 'hard_delete' }) => {
        if (selectedCourseIds.size === 0) return;

        setIsDeleting(true);
        try {
            const selectedCourses = courses.filter((c) => selectedCourseIds.has(c.course_id));
            const updates: Record<string, any> = {};

            if (action === 'unlink') {
                for (const c of selectedCourses) {
                    const linked = await resolveLinkedDepartments(c.course_id, c.linked_departments);
                    const remaining = linked.filter((id) => id !== deptId);
                    if (remaining.length === 0) {
                        updates[`global_courses/${c.course_id}`] = null;
                    } else {
                        updates[`global_courses/${c.course_id}/linked_departments`] = remaining;
                    }
                }

                const remainingDeptCourses = courses.filter((c) => !selectedCourseIds.has(c.course_id));
                updates[`departments_data/${deptId}/course_list`] = remainingDeptCourses;

                setCourses(remainingDeptCourses);
                addToast(`Unlinked ${selectedCourses.length} course(s) from ${department.department_name || deptId}.`, 'success');
            } else {
                // Global Hard Delete Batch
                const deptIdsToTouch = new Set<string>();

                for (const c of selectedCourses) {
                    const courseId = c.course_id;
                    const linked = await resolveLinkedDepartments(courseId, c.linked_departments);
                    linked.forEach((id) => deptIdsToTouch.add(id));
                    deptIdsToTouch.add(deptId);
                    updates[`global_courses/${courseId}`] = null;
                }

                for (const dId of deptIdsToTouch) {
                    const dSnap = await get(dbRef(db, `departments_data/${dId}`));
                    if (dSnap.exists()) {
                        const rawList = dSnap.val()?.course_list;
                        const list: Course[] = Array.isArray(rawList) ? rawList : Object.values(rawList || {});
                        updates[`departments_data/${dId}/course_list`] = list.filter((item) => !selectedCourseIds.has(item.course_id));
                    }
                }

                setCourses((prev) => prev.filter((c) => !selectedCourseIds.has(c.course_id)));
                addToast(`Globally hard deleted ${selectedCourses.length} course(s) across all departments.`, 'success');
            }

            await update(dbRef(db), updates);
            setSelectedCourseIds(new Set());
            setIsBatchDeleteModalOpen(false);
            await refreshData();
        } catch (error: any) {
            console.error('Error executing batch course deletion:', error);
            addToast('Failed to delete selected courses: ' + error.message, 'error');
        } finally {
            setIsDeleting(false);
        }
    };

    const loadDepartmentCourses = async () => {
        setIsLoadingCourses(true);
        try {
            const snap = await get(dbRef(db, `departments_data/${deptId}`));
            if (snap.exists()) {
                const data = snap.val();
                const rawList = data?.course_list;
                let list: Course[] = [];
                if (Array.isArray(rawList)) {
                    list = rawList;
                } else if (rawList && typeof rawList === 'object') {
                    list = Object.values(rawList);
                }
                setCourses(list.filter(Boolean));
            } else {
                setCourses([]);
            }
        } catch (error) {
            console.error('Error fetching department courses:', error);
            addToast('Failed to load course roster.', 'error');
        } finally {
            setIsLoadingCourses(false);
        }
    };

    useEffect(() => {
        void loadDepartmentCourses();
    }, [deptId]);

    const handleCreateCourse = async (e: React.FormEvent) => {
        e.preventDefault();
        const code = newCourseCode.trim().toUpperCase();
        const title = newCourseTitle.trim();
        if (!title) {
            addToast('Course title is required.', 'error');
            return;
        }

        const courseId = (code || title).toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '');
        const newCourse: Course = {
            course_id: courseId,
            course_code: code || undefined,
            course_name: title,
            course_unit: Number(newCreditUnits) || 3,
            level: newLevel,
            semester: newSemester,
            course_status: 'ACTIVE',
            topics: [],
            textbook_urls: [],
        };

        setIsCreating(true);
        try {
            const updatedCourses = [...courses.filter((c) => c.course_id !== courseId), newCourse];
            await update(dbRef(db, `departments_data/${deptId}`), {
                course_list: updatedCourses,
            });

            addToast(`Course "${code || title}" added successfully!`, 'success');
            setNewCourseCode('');
            setNewCourseTitle('');
            setNewCreditUnits('3');
            setIsAddDrawerOpen(false);
            setCourses(updatedCourses);
            await refreshData();
        } catch (error: any) {
            console.error('Error creating course:', error);
            addToast(error?.message || 'Failed to add course.', 'error');
        } finally {
            setIsCreating(false);
        }
    };

    const handleToggleCourseStatus = async (course: Course) => {
        const nextStatus = course.course_status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED';
        try {
            const updatedCourses = courses.map((c) =>
                c.course_id === course.course_id ? { ...c, course_status: nextStatus } : c
            );
            await update(dbRef(db, `departments_data/${deptId}`), {
                course_list: updatedCourses,
            });
            setCourses(updatedCourses);
            addToast(`Course status updated to ${nextStatus}`, 'success');
        } catch (error: any) {
            addToast('Failed to update status: ' + error.message, 'error');
        }
    };

    const handleRenameCourse = async (course: Course, newTitle: string) => {
        try {
            const updatedCourses = courses.map((c) =>
                c.course_id === course.course_id ? { ...c, course_name: newTitle } : c
            );
            await update(dbRef(db, `departments_data/${deptId}`), {
                course_list: updatedCourses,
            });
            setCourses(updatedCourses);
            addToast('Course title updated!', 'success');
        } catch (error: any) {
            addToast('Failed to update course title: ' + error.message, 'error');
            throw error;
        }
    };

    const handleExecuteSmartDeleteCourse = async ({ action, targetItem }: { action: 'unlink' | 'hard_delete'; targetItem: any }) => {
        if (!deleteTarget) return;

        setIsDeleting(true);
        try {
            const courseId = deleteTarget.course_id;
            const linkedDepts = await resolveLinkedDepartments(courseId, deleteTarget.linked_departments);
            const updates: Record<string, any> = {};

            if (action === 'unlink') {
                const remainingLinkedDepts = linkedDepts.filter((id) => id !== deptId);
                if (remainingLinkedDepts.length === 0) {
                    updates[`global_courses/${courseId}`] = null;
                } else {
                    updates[`global_courses/${courseId}/linked_departments`] = remainingLinkedDepts;
                }

                const nextDeptCourses = courses.filter((c) => c.course_id !== courseId);
                updates[`departments_data/${deptId}/course_list`] = nextDeptCourses;

                setCourses(nextDeptCourses);
                addToast(`Course "${deleteTarget.course_name}" unlinked from ${department.department_name || deptId}.`, 'success');
            } else {
                // Global Hard Delete
                updates[`global_courses/${courseId}`] = null;

                const deptIdsToTouch = new Set<string>(linkedDepts);
                deptIdsToTouch.add(deptId);

                for (const dId of deptIdsToTouch) {
                    const dSnap = await get(dbRef(db, `departments_data/${dId}`));
                    if (dSnap.exists()) {
                        const rawList = dSnap.val()?.course_list;
                        const list: Course[] = Array.isArray(rawList) ? rawList : Object.values(rawList || {});
                        updates[`departments_data/${dId}/course_list`] = list.filter((c) => c.course_id !== courseId);
                    }
                }

                setCourses((prev) => prev.filter((c) => c.course_id !== courseId));
                addToast(`Course "${deleteTarget.course_name}" globally hard deleted.`, 'success');
            }

            await update(dbRef(db), updates);
            setDeleteTarget(null);
            await refreshData();
        } catch (error: any) {
            console.error('Error in smart course deletion:', error);
            addToast('Failed to delete course: ' + error.message, 'error');
        } finally {
            setIsDeleting(false);
        }
    };

    const breadcrumbItems = [
        {
            label: school.name || schoolId,
            path: `/admin/schools/${encodeURIComponent(schoolId)}`,
            icon: <Building2 className="w-3.5 h-3.5 text-amber-500" />,
        },
    ];

    if (collegeId) {
        breadcrumbItems.push({
            label: college?.name || collegeId,
            path: `/admin/schools/${encodeURIComponent(schoolId)}/${encodeURIComponent(collegeId)}`,
            icon: <GraduationCap className="w-3.5 h-3.5 text-amber-500" />,
        });
    }

    const currentDeptPath = collegeId
        ? `/admin/schools/${encodeURIComponent(schoolId)}/${encodeURIComponent(collegeId)}/${encodeURIComponent(deptId)}`
        : `/admin/schools/${encodeURIComponent(schoolId)}/${encodeURIComponent(deptId)}`;

    breadcrumbItems.push({
        label: department.department_name || deptId,
        path: currentDeptPath,
        icon: <BookOpen className="w-3.5 h-3.5 text-amber-500" />,
    });

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            {/* Breadcrumb Navigation */}
            <BreadcrumbNavigation items={breadcrumbItems} onNavigate={onNavigate} />

            {/* Header & Actions Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs font-black text-amber-500 uppercase tracking-widest">
                        <BookOpen className="w-4 h-4" />
                        <span>Level 3 Course Catalog</span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                        {department.department_name || deptId}
                    </h2>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                        {courses.length} course{courses.length !== 1 ? 's' : ''} in roster. Click any course to enter Level 4 Course Studio.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {courses.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                if (selectedCourseIds.size === courses.length) {
                                    setSelectedCourseIds(new Set());
                                } else {
                                    setSelectedCourseIds(new Set(courses.map(c => c.course_id)));
                                }
                            }}
                            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                checked={selectedCourseIds.size === courses.length && courses.length > 0}
                                ref={el => { if (el) el.indeterminate = selectedCourseIds.size > 0 && selectedCourseIds.size < courses.length; }}
                                onChange={() => {}}
                                className="w-3.5 h-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-500 cursor-pointer pointer-events-none"
                            />
                            <span>{selectedCourseIds.size === courses.length && courses.length > 0 ? 'Deselect All' : `Select All (${courses.length})`}</span>
                        </button>
                    )}

                    {selectedCourseIds.size > 0 && (
                        <button
                            type="button"
                            onClick={handleTriggerBatchDelete}
                            disabled={isDeleting}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-xs hover:bg-rose-100 dark:hover:bg-rose-950/60 transition-colors border border-rose-500/30 cursor-pointer disabled:opacity-50"
                        >
                            <Trash2 className="w-4 h-4" />
                            <span>Delete Selected ({selectedCourseIds.size})</span>
                        </button>
                    )}

                    {/* View Switcher */}
                    <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded-xl transition-all ${
                                viewMode === 'grid' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-black' : 'text-slate-400 hover:text-slate-600'
                            }`}
                            title="Grid View"
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-xl transition-all ${
                                viewMode === 'list' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-black' : 'text-slate-400 hover:text-slate-600'
                            }`}
                            title="List View"
                        >
                            <List className="w-4 h-4" />
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => setIsAddDrawerOpen(true)}
                        className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg shadow-amber-500/20 active:scale-95"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Add Course</span>
                    </button>
                </div>
            </div>

            {/* Course Grid or List */}
            {isLoadingCourses ? (
                <div className="py-16 text-center text-sm font-bold text-slate-400">Loading course roster...</div>
            ) : courses.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center bg-white dark:bg-slate-900 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 p-8 space-y-4">
                    <BookOpen className="w-12 h-12 text-slate-300 dark:text-slate-700" />
                    <div className="space-y-1 max-w-sm">
                        <h3 className="font-black text-lg text-slate-900 dark:text-white">No Courses Added</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Add courses to start populating syllabus topics, textbooks, and past questions.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsAddDrawerOpen(true)}
                        className="px-6 py-3 rounded-2xl bg-amber-500 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-md"
                    >
                        Add First Course
                    </button>
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {courses.map((course) => {
                        const topicCount = course.topics?.length || 0;
                        const materialCount = course.textbook_urls?.length || (course.textbook_url ? 1 : 0);
                        const isArchived = course.course_status === 'ARCHIVED';
                        const studioPath = collegeId
                            ? `/admin/schools/${encodeURIComponent(schoolId)}/${encodeURIComponent(collegeId)}/${encodeURIComponent(deptId)}/${encodeURIComponent(course.course_id)}`
                            : `/admin/schools/${encodeURIComponent(schoolId)}/${encodeURIComponent(deptId)}/${encodeURIComponent(course.course_id)}`;

                        return (
                            <div
                                key={course.course_id}
                                onClick={() => onNavigate(studioPath)}
                                className={`group relative bg-white dark:bg-slate-900 rounded-3xl p-6 border transition-all duration-200 hover:-translate-y-1 hover:shadow-xl cursor-pointer flex flex-col justify-between gap-6 ${
                                    isArchived ? 'opacity-60 border-slate-200 dark:border-slate-800' : 'border-slate-200 dark:border-slate-800 hover:border-amber-500/50'
                                }`}
                            >
                                <div className="space-y-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                            <input
                                                type="checkbox"
                                                checked={selectedCourseIds.has(course.course_id)}
                                                onChange={() => toggleCourseSelection(course.course_id)}
                                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer mr-1"
                                            />
                                            {course.course_code && (
                                                <span className="px-3 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 font-black text-xs tracking-wider">
                                                    {course.course_code}
                                                </span>
                                            )}
                                            {course.course_unit && (
                                                <span className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold text-[10px] uppercase">
                                                    {course.course_unit} Units
                                                </span>
                                            )}
                                            {course.linked_departments && course.linked_departments.length > 1 && (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 font-black text-[10px] uppercase tracking-wider border border-sky-500/20" title={`Cross-listed across ${course.linked_departments.length} departments`}>
                                                    <Share2 className="w-3 h-3 text-sky-500" />
                                                    <span>Shared ({course.linked_departments.length})</span>
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleCourseStatus(course)}
                                                className={`p-2 rounded-xl transition-colors ${
                                                    isArchived ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                                }`}
                                                title={isArchived ? 'Unarchive Course' : 'Archive Course'}
                                            >
                                                <Archive className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDeleteTarget(course)}
                                                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors"
                                                title="Delete Course"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                                        <InlineEditableText
                                            value={course.course_name}
                                            onSave={(newName) => handleRenameCourse(course, newName)}
                                            className="text-base font-black text-slate-900 dark:text-white"
                                        />
                                    </div>

                                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
                                            {course.level || '100lvl'}
                                        </span>
                                        <span>•</span>
                                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
                                            {course.semester ? `${course.semester} sem` : '1st sem'}
                                        </span>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                                    <div className="flex items-center gap-3 text-xs font-bold text-slate-500 dark:text-slate-400">
                                        <span className="flex items-center gap-1">
                                            <Layers className="w-3.5 h-3.5 text-amber-500" />
                                            {topicCount} Topics
                                        </span>
                                        <span>•</span>
                                        <span className="flex items-center gap-1">
                                            <FileText className="w-3.5 h-3.5 text-sky-500" />
                                            {materialCount} Files
                                        </span>
                                    </div>

                                    <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 group-hover:bg-amber-500 group-hover:text-slate-950 text-slate-500 dark:text-slate-400 flex items-center justify-center transition-all">
                                        <ArrowRight className="w-4 h-4" />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    <th className="py-4 px-4 w-10">
                                        <input
                                            type="checkbox"
                                            checked={courses.length > 0 && selectedCourseIds.size === courses.length}
                                            onChange={toggleSelectAllCourses}
                                            className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
                                        />
                                    </th>
                                    <th className="py-4 px-6">Course Code</th>
                                    <th className="py-4 px-6">Title</th>
                                    <th className="py-4 px-6">Units</th>
                                    <th className="py-4 px-6">Level / Semester</th>
                                    <th className="py-4 px-6 text-center">Topics</th>
                                    <th className="py-4 px-6 text-center">Materials</th>
                                    <th className="py-4 px-6 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                                {courses.map((course) => {
                                    const topicCount = course.topics?.length || 0;
                                    const materialCount = course.textbook_urls?.length || (course.textbook_url ? 1 : 0);
                                    const studioPath = collegeId
                                        ? `/admin/schools/${encodeURIComponent(schoolId)}/${encodeURIComponent(collegeId)}/${encodeURIComponent(deptId)}/${encodeURIComponent(course.course_id)}`
                                        : `/admin/schools/${encodeURIComponent(schoolId)}/${encodeURIComponent(deptId)}/${encodeURIComponent(course.course_id)}`;

                                    return (
                                        <tr
                                            key={course.course_id}
                                            onClick={() => onNavigate(studioPath)}
                                            className="group hover:bg-amber-500/5 transition-colors cursor-pointer"
                                        >
                                            <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedCourseIds.has(course.course_id)}
                                                    onChange={() => toggleCourseSelection(course.course_id)}
                                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
                                                />
                                            </td>
                                            <td className="py-4 px-6 font-mono font-black text-amber-600 dark:text-amber-400">
                                                <div className="flex items-center gap-1.5">
                                                    <span>{course.course_code || 'N/A'}</span>
                                                    {course.linked_departments && course.linked_departments.length > 1 && (
                                                        <span className="p-1 rounded-md bg-sky-50 dark:bg-sky-950/60 text-sky-500" title={`Cross-listed across ${course.linked_departments.length} departments`}>
                                                            <Share2 className="w-3 h-3" />
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 font-bold text-slate-900 dark:text-white">
                                                <div onClick={(e) => e.stopPropagation()}>
                                                    <InlineEditableText
                                                        value={course.course_name}
                                                        onSave={(newName) => handleRenameCourse(course, newName)}
                                                    />
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 font-bold text-xs text-slate-500">
                                                {course.course_unit || 3} Units
                                            </td>
                                            <td className="py-4 px-6 font-semibold text-xs text-slate-500">
                                                {course.level || '100lvl'} ({course.semester || 'first'})
                                            </td>
                                            <td className="py-4 px-6 text-center font-bold text-xs text-amber-600">
                                                {topicCount}
                                            </td>
                                            <td className="py-4 px-6 text-center font-bold text-xs text-sky-600">
                                                {materialCount}
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setDeleteTarget(course)}
                                                        className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => onNavigate(studioPath)}
                                                        className="p-2 text-slate-400 group-hover:text-amber-500 group-hover:translate-x-1 transition-all"
                                                    >
                                                        <ArrowRight className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Hybrid Course Creation Drawer */}
            <HybridCourseDrawer
                isOpen={isAddDrawerOpen}
                onClose={() => setIsAddDrawerOpen(false)}
                currentDeptId={deptId}
                allDepartments={allDepartments}
                onCourseCreated={async () => {
                    await loadDepartmentCourses();
                    await refreshData();
                }}
            />

            {/* Smart Delete Single Course Modal */}
            {deleteTarget && (
                <SmartDeleteModal
                    isOpen={Boolean(deleteTarget)}
                    targetType="course"
                    targetItem={{
                        id: deleteTarget.course_id,
                        name: deleteTarget.course_name,
                        code: deleteTarget.course_code || deleteTarget.course_id,
                        linkedDepartments: deleteTarget.linked_departments && deleteTarget.linked_departments.length > 0
                            ? deleteTarget.linked_departments
                            : [deptId],
                    }}
                    currentDeptId={department.department_name || deptId}
                    isDeleting={isDeleting}
                    onConfirmDelete={handleExecuteSmartDeleteCourse}
                    onClose={() => setDeleteTarget(null)}
                />
            )}

            {/* Smart Delete Batch Courses Modal */}
            {isBatchDeleteModalOpen && (
                <SmartDeleteModal
                    isOpen={isBatchDeleteModalOpen}
                    targetType="course"
                    targetItem={{
                        id: 'batch_courses',
                        name: `${selectedCourseIds.size} Selected Courses`,
                        code: 'BATCH',
                        count: selectedCourseIds.size,
                    }}
                    currentDeptId={department.department_name || deptId}
                    isDeleting={isDeleting}
                    onConfirmDelete={handleExecuteBatchSmartDeleteCourse}
                    onClose={() => setIsBatchDeleteModalOpen(false)}
                />
            )}
        </div>
    );
};
