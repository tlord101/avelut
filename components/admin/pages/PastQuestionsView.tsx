import React, { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../../../lib/supabaseClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoredPQRow {
    id: string;
    department_id: string;
    level: string;
    course_id: string;
    course_name?: string;
    title?: string;
    year: string;
    questions_json: any[];
    updated_at: string;
}

interface EditingQuestion {
    index: number;
    data: any;
}

interface PastQuestionsViewProps {
    allDepartments: any[];
    LEVELS: string[];
    uploadDepartmentId: string;
    setUploadDepartmentId: (val: string) => void;
    uploadLevel: string;
    setUploadLevel: (val: string) => void;
    uploadCourseName: string;
    setUploadCourseName: (val: string) => void;
    year: string;
    setYear: (val: string) => void;
    pqFile: File | null;
    setPqFile: (val: File | null) => void;
    isPQProcessing: boolean;
    extractionProgress: string;
    handleGoogleDrivePick: (callback: (files: File[]) => void) => void;
    handlePQUpload: () => void;
    newQuestion: any;
    setNewQuestion: (val: any) => void;
    handleAddQuestion: () => void;
    filteredGlobalCourses?: any[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const Badge: React.FC<{ children: React.ReactNode; color?: 'blue' | 'gray' | 'green' | 'amber' | 'red' }> = ({
    children, color = 'gray'
}) => {
    const colorMap = {
        blue: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
        gray: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
        amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
        red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    };
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest border ${colorMap[color]}`}>
            {children}
        </span>
    );
};

const Spinner: React.FC<{ size?: number }> = ({ size = 16 }) => (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
);

// ─── Library Panel ────────────────────────────────────────────────────────────

const PQLibraryPanel: React.FC = () => {
    const [rows, setRows] = useState<StoredPQRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRow, setSelectedRow] = useState<StoredPQRow | null>(null);
    const [view, setView] = useState<'list' | 'detail'>('list');

    // Multi-select / Bulk Delete State
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isBatchDeleting, setIsBatchDeleting] = useState(false);
    const [showBatchDeleteModal, setShowBatchDeleteModal] = useState(false);

    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [isSavingRename, setIsSavingRename] = useState(false);

    const [editingQuestion, setEditingQuestion] = useState<EditingQuestion | null>(null);
    const [isSavingQuestion, setIsSavingQuestion] = useState(false);
    const [isDeletingPack, setIsDeletingPack] = useState(false);

    const fetchRows = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            if (!isSupabaseConfigured) {
                setError('Supabase is not configured. Please set up your database connection.');
                return;
            }
            const { data, error: dbErr } = await supabase
                .from('past_questions')
                .select('*')
                .order('updated_at', { ascending: false });

            if (dbErr) throw dbErr;
            setRows((data as StoredPQRow[]) || []);
        } catch (err: any) {
            setError(err?.message || 'Failed to load past questions.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { void fetchRows(); }, [fetchRows]);

    const filteredRows = rows.filter(row => {
        const q = searchQuery.toLowerCase();
        if (!q) return true;
        return (
            (row.course_id || '').toLowerCase().includes(q) ||
            (row.course_name || '').toLowerCase().includes(q) ||
            (row.title || '').toLowerCase().includes(q) ||
            (row.department_id || '').toLowerCase().includes(q) ||
            (row.year || '').toLowerCase().includes(q)
        );
    });

    const isAllSelected = filteredRows.length > 0 && selectedIds.size === filteredRows.length;
    const isSomeSelected = selectedIds.size > 0 && selectedIds.size < filteredRows.length;

    const handleToggleSelect = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleToggleSelectAll = () => {
        if (isAllSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredRows.map(r => r.id)));
        }
    };

    const handleBatchDelete = async () => {
        if (selectedIds.size === 0) return;
        setIsBatchDeleting(true);
        try {
            const idsToDelete = Array.from(selectedIds);
            const { error: dbErr } = await supabase.from('past_questions').delete().in('id', idsToDelete);
            if (dbErr) throw dbErr;
            try {
                await supabase.from('past_question_packs').delete().in('id', idsToDelete);
            } catch (packErr) {
                console.warn('[PQLibraryPanel] past_question_packs batch delete warning:', packErr);
            }
            setRows(prev => prev.filter(r => !selectedIds.has(r.id)));
            setSelectedIds(new Set());
            setShowBatchDeleteModal(false);
        } catch (err: any) {
            alert('Failed to delete selected past questions: ' + (err?.message || 'Unknown error'));
        } finally {
            setIsBatchDeleting(false);
        }
    };

    const handleOpenDetail = (row: StoredPQRow) => {
        setSelectedRow({ ...row, questions_json: Array.isArray(row.questions_json) ? row.questions_json : [] });
        setView('detail');
        setIsRenaming(false);
        setEditingQuestion(null);
    };

    const handleBack = () => {
        setView('list');
        setSelectedRow(null);
        setEditingQuestion(null);
        setIsRenaming(false);
    };

    const handleSaveRename = async () => {
        if (!selectedRow || !renameValue.trim()) return;
        setIsSavingRename(true);
        const cleanName = renameValue.trim().toUpperCase().replace(/_/g, ' ');
        try {
            let dbErr: any = null;
            const titleResult = await supabase
                .from('past_questions')
                .update({ title: cleanName, course_name: cleanName, updated_at: new Date().toISOString() } as any)
                .eq('id', selectedRow.id);
            dbErr = titleResult.error;

            if (dbErr) {
                const fallbackResult = await supabase
                    .from('past_questions')
                    .update({ course_id: cleanName, updated_at: new Date().toISOString() })
                    .eq('id', selectedRow.id);
                if (fallbackResult.error) throw fallbackResult.error;
                const updated = { ...selectedRow, course_id: cleanName, title: cleanName, course_name: cleanName };
                setSelectedRow(updated);
                setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
            } else {
                const updated = { ...selectedRow, title: cleanName, course_name: cleanName };
                setSelectedRow(updated);
                setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
            }
            try {
                await supabase.from('past_question_packs').update({ title: cleanName, course_name: cleanName }).eq('id', selectedRow.id);
            } catch {}
            setIsRenaming(false);
        } catch (err: any) {
            alert('Failed to rename: ' + (err?.message || 'Unknown error'));
        } finally {
            setIsSavingRename(false);
        }
    };

    const handleDeletePack = async () => {
        if (!selectedRow) return;
        const confirmed = window.confirm(`Delete "${selectedRow.title || selectedRow.course_id}"? This cannot be undone.`);
        if (!confirmed) return;
        setIsDeletingPack(true);
        try {
            const { error: dbErr } = await supabase.from('past_questions').delete().eq('id', selectedRow.id);
            if (dbErr) throw dbErr;
            try {
                await supabase.from('past_question_packs').delete().eq('id', selectedRow.id);
            } catch {}
            setRows(prev => prev.filter(r => r.id !== selectedRow.id));
            handleBack();
        } catch (err: any) {
            alert('Failed to delete pack: ' + (err?.message || 'Unknown error'));
        } finally {
            setIsDeletingPack(false);
        }
    };

    const handleSaveQuestion = async () => {
        if (!selectedRow || !editingQuestion) return;
        setIsSavingQuestion(true);
        try {
            const updatedList = [...(Array.isArray(selectedRow.questions_json) ? selectedRow.questions_json : [])];
            updatedList[editingQuestion.index] = editingQuestion.data;

            const { error: dbErr } = await supabase
                .from('past_questions')
                .update({ questions_json: updatedList, updated_at: new Date().toISOString() } as any)
                .eq('id', selectedRow.id);

            if (dbErr) throw dbErr;
            const updated = { ...selectedRow, questions_json: updatedList };
            setSelectedRow(updated);
            setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
            try {
                await supabase.from('past_question_packs').update({ questions: updatedList, question_count: updatedList.length }).eq('id', selectedRow.id);
            } catch {}
            setEditingQuestion(null);
        } catch (err: any) {
            alert('Failed to save question: ' + (err?.message || 'Unknown error'));
        } finally {
            setIsSavingQuestion(false);
        }
    };

    const handleDeleteQuestion = async (index: number) => {
        if (!selectedRow) return;
        const confirmed = window.confirm(`Delete question #${index + 1}?`);
        if (!confirmed) return;

        try {
            const updatedList = (Array.isArray(selectedRow.questions_json) ? selectedRow.questions_json : []).filter((_, i) => i !== index);
            const { error: dbErr } = await supabase
                .from('past_questions')
                .update({ questions_json: updatedList, updated_at: new Date().toISOString() } as any)
                .eq('id', selectedRow.id);

            if (dbErr) throw dbErr;
            const updated = { ...selectedRow, questions_json: updatedList };
            setSelectedRow(updated);
            setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
            try {
                await supabase.from('past_question_packs').update({ questions: updatedList, question_count: updatedList.length }).eq('id', selectedRow.id);
            } catch {}
            if (editingQuestion?.index === index) setEditingQuestion(null);
        } catch (err: any) {
            alert('Failed to delete question: ' + (err?.message || 'Unknown error'));
        }
    };

    const getPackTitle = (row: StoredPQRow) => {
        if (row.title) return row.title.toUpperCase();
        if (row.course_name) return `${row.course_name.toUpperCase()}${row.year ? ` (${row.year})` : ''}`;
        return `${row.course_id.toUpperCase()}${row.year ? ` (${row.year})` : ''}`;
    };

    const getQuestionCount = (row: StoredPQRow) => {
        return Array.isArray(row.questions_json) ? row.questions_json.length : 0;
    };

    const formatDate = (iso: string) => {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return iso;
        }
    };

    // ── List View ──────────────────────────────────────────────────────────────
    if (view === 'list') {
        return (
            <div className="space-y-4">
                {/* Header & Controls */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h2 className="text-base font-black text-gray-900 dark:text-white tracking-tight">Stored Question Packs</h2>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                            {filteredRows.length} pack{filteredRows.length !== 1 ? 's' : ''} available for all college departments
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleToggleSelectAll}
                            disabled={filteredRows.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 font-bold text-xs uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-slate-700 transition shadow-sm cursor-pointer disabled:opacity-40"
                        >
                            <input
                                type="checkbox"
                                checked={isAllSelected}
                                ref={el => { if (el) el.indeterminate = isSomeSelected; }}
                                onChange={() => {}}
                                className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                            />
                            <span>{isAllSelected ? 'Deselect All' : 'Select All'}</span>
                        </button>
                        <button
                            onClick={fetchRows}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 font-bold text-xs uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-slate-700 transition shadow-sm cursor-pointer"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="relative">
                    <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search by course code, title, year or department…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
                    />
                </div>

                {/* Sticky Universal Batch Action Bar */}
                {selectedIds.size > 0 && (
                    <div className="sticky top-24 z-20 flex items-center justify-between p-3.5 px-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-blue-500/30 dark:border-blue-500/40 rounded-2xl shadow-lg shadow-blue-500/10 transition-all duration-200 animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-center gap-3">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                            <span className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white">
                                <span className="text-blue-600 dark:text-blue-400 font-black">{selectedIds.size}</span> pack{selectedIds.size !== 1 ? 's' : ''} selected
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setSelectedIds(new Set())}
                                className="px-3 py-1.5 rounded-xl text-xs font-bold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition cursor-pointer"
                            >
                                Clear
                            </button>
                            <button
                                onClick={() => setShowBatchDeleteModal(true)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-red-500/10 dark:bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400 font-black text-xs uppercase tracking-wider hover:bg-red-500/20 active:scale-95 transition shadow-sm cursor-pointer"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Delete Selected ({selectedIds.size})</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {isLoading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 dark:text-slate-500">
                        <Spinner size={28} />
                        <p className="text-sm font-medium">Loading past questions…</p>
                    </div>
                )}

                {/* Error State */}
                {error && !isLoading && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
                        <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <p className="font-bold text-sm">Error loading data</p>
                            <p className="text-xs mt-0.5 opacity-80">{error}</p>
                        </div>
                    </div>
                )}

                {/* Empty State */}
                {!isLoading && !error && rows.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 dark:text-slate-500 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl bg-white/50 dark:bg-slate-900/50">
                        <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div className="text-center">
                            <p className="font-bold text-sm text-gray-500 dark:text-slate-400">No past questions yet</p>
                            <p className="text-xs mt-0.5 text-gray-400 dark:text-slate-500">Upload your first pack using the Upload tab.</p>
                        </div>
                    </div>
                )}

                {/* Cards List */}
                {!isLoading && !error && filteredRows.length > 0 && (
                    <div className="grid grid-cols-1 gap-3">
                        {filteredRows.map(row => {
                            const count = getQuestionCount(row);
                            const title = getPackTitle(row);
                            const isSelected = selectedIds.has(row.id);

                            return (
                                <div
                                    key={row.id}
                                    onClick={() => handleOpenDetail(row)}
                                    className={`group w-full text-left flex items-center gap-3 sm:gap-4 p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${
                                        isSelected
                                            ? 'bg-blue-50/80 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600 shadow-sm'
                                            : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-500/40 hover:shadow-md'
                                    }`}
                                >
                                    {/* Universal Select Checkbox */}
                                    <div
                                        onClick={(e) => handleToggleSelect(row.id, e)}
                                        className="p-1 -ml-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => {}}
                                            className="w-4 h-4 rounded border-gray-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                        />
                                    </div>

                                    {/* Icon */}
                                    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500/20 transition-colors">
                                        <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                    </div>

                                    {/* Text Info */}
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm text-gray-900 dark:text-white truncate uppercase tracking-tight">{title}</p>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                            {row.department_id && <Badge color="gray">{row.department_id}</Badge>}
                                            {row.level && <Badge color="blue">{row.level}</Badge>}
                                            {row.year && <Badge color="amber">{row.year}</Badge>}
                                            <Badge color="green">{count} Q{count !== 1 ? 's' : ''}</Badge>
                                        </div>
                                        <p className="text-[10px] text-gray-400 dark:text-slate-500 mt-1.5">Updated {formatDate(row.updated_at)}</p>
                                    </div>

                                    {/* Chevron */}
                                    <svg className="w-4 h-4 text-gray-300 dark:text-slate-600 group-hover:text-blue-500 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Batch Delete Confirmation Modal */}
                {showBatchDeleteModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl space-y-4">
                            <div className="w-12 h-12 rounded-2xl bg-red-500/10 dark:bg-red-500/20 text-red-500 flex items-center justify-center">
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-gray-900 dark:text-white">Delete Selected Question Packs?</h3>
                                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 mt-1 leading-relaxed">
                                    You are about to permanently delete <strong className="text-gray-900 dark:text-white font-bold">{selectedIds.size}</strong> past question pack(s). This action cannot be reversed.
                                </p>
                            </div>
                            <div className="flex items-center justify-end gap-2.5 pt-2">
                                <button
                                    onClick={() => setShowBatchDeleteModal(false)}
                                    disabled={isBatchDeleting}
                                    className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 font-bold text-xs uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-slate-700 transition cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleBatchDelete}
                                    disabled={isBatchDeleting}
                                    className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider transition shadow-sm active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                >
                                    {isBatchDeleting && <Spinner size={12} />}
                                    <span>{isBatchDeleting ? 'Deleting…' : `Confirm Delete (${selectedIds.size})`}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Detail View ────────────────────────────────────────────────────────────
    if (view === 'detail' && selectedRow) {
        const questions = Array.isArray(selectedRow.questions_json) ? selectedRow.questions_json : [];

        return (
            <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <button
                        onClick={handleBack}
                        className="inline-flex items-center gap-2 text-sm font-bold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition cursor-pointer"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to Library
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setRenameValue(selectedRow.title || selectedRow.course_id || ''); setIsRenaming(true); }}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-slate-700 transition shadow-sm cursor-pointer"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Rename
                        </button>
                        <button
                            onClick={handleDeletePack}
                            disabled={isDeletingPack}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 dark:bg-red-500/15 border border-red-500/30 text-red-600 dark:text-red-400 font-bold text-xs uppercase tracking-widest hover:bg-red-500/20 transition shadow-sm cursor-pointer disabled:opacity-50"
                        >
                            {isDeletingPack ? <Spinner size={12} /> : (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            )}
                            Delete Pack
                        </button>
                    </div>
                </div>

                {/* Pack Header */}
                <div className="p-5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl shadow-sm">
                    {isRenaming ? (
                        <div className="space-y-3">
                            <label className="text-xs font-black uppercase tracking-widest text-gray-500 dark:text-slate-400">Rename Pack (Capital Letters, No Snake Lines)</label>
                            <input
                                type="text"
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                autoFocus
                                className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-sm font-bold text-gray-900 dark:text-white uppercase outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
                                placeholder="Enter a new name for this pack"
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') setIsRenaming(false); }}
                            />
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleSaveRename}
                                    disabled={isSavingRename || !renameValue.trim()}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest transition shadow-sm disabled:opacity-50 cursor-pointer"
                                >
                                    {isSavingRename ? <Spinner size={12} /> : null}
                                    Save Name
                                </button>
                                <button
                                    onClick={() => setIsRenaming(false)}
                                    className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-slate-700 transition cursor-pointer"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <h3 className="font-black text-xl text-gray-900 dark:text-white leading-tight uppercase">{getPackTitle(selectedRow)}</h3>
                            <div className="flex flex-wrap items-center gap-2 mt-3">
                                {selectedRow.department_id && <Badge color="gray">{selectedRow.department_id}</Badge>}
                                {selectedRow.level && <Badge color="blue">{selectedRow.level}</Badge>}
                                {selectedRow.year && <Badge color="amber">Year {selectedRow.year}</Badge>}
                                <Badge color="green">{questions.length} question{questions.length !== 1 ? 's' : ''}</Badge>
                            </div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 mt-2">Last updated {formatDate(selectedRow.updated_at)} · <span className="font-mono">{selectedRow.id}</span></p>
                        </div>
                    )}
                </div>

                {/* Questions List */}
                <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-3">Questions ({questions.length})</h4>

                    {questions.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl text-gray-400 dark:text-slate-500 bg-white/50 dark:bg-slate-900/50">
                            <p className="text-sm font-medium">No questions in this pack</p>
                        </div>
                    )}

                    <div className="space-y-3">
                        {questions.map((q: any, idx: number) => {
                            const isEditing = editingQuestion?.index === idx;
                            const prompt = q?.prompt || q?.question || q?.text || '';
                            const options: string[] = Array.isArray(q?.options) ? q.options.map((o: any) => typeof o === 'string' ? o : (o?.text || '')) : [];
                            const correctAnswer = q?.correctAnswer || q?.correct_answer || (Array.isArray(q?.options) ? q.options.find((o: any) => o?.isCorrect)?.text : '');

                            return (
                                <div
                                    key={idx}
                                    className={`bg-white dark:bg-slate-900 border rounded-2xl overflow-hidden transition-all duration-200 ${
                                        isEditing ? 'border-blue-400 dark:border-blue-500 shadow-md shadow-blue-500/10' : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700'
                                    }`}
                                >
                                    <div className="p-4 sm:p-5">
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <span className="text-xs font-black text-gray-400 dark:text-slate-500 uppercase tracking-widest">Question {idx + 1}</span>
                                            <div className="flex items-center gap-1.5">
                                                <Badge color={q.type === 'mcq' ? 'blue' : 'gray'}>{q.type || 'theory'}</Badge>
                                                {!isEditing && (
                                                    <div className="flex items-center gap-1 ml-2">
                                                        <button
                                                            onClick={() => setEditingQuestion({ index: idx, data: { ...q } })}
                                                            className="p-1 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition cursor-pointer"
                                                            title="Edit question"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteQuestion(idx)}
                                                            className="p-1 text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition cursor-pointer"
                                                            title="Delete question"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {isEditing ? (
                                            <div className="space-y-3 mt-3">
                                                <textarea
                                                    value={editingQuestion.data.question || editingQuestion.data.prompt || ''}
                                                    onChange={e => setEditingQuestion({
                                                        ...editingQuestion,
                                                        data: { ...editingQuestion.data, question: e.target.value, prompt: e.target.value }
                                                    })}
                                                    className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-sm text-gray-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition resize-none h-24"
                                                    placeholder="Question text"
                                                />

                                                {/* Options for MCQ */}
                                                {editingQuestion.data.type === 'mcq' && (
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-slate-500">Options</label>
                                                        {(editingQuestion.data.options || ['', '', '', '']).map((opt: any, optIdx: number) => {
                                                            const optText = typeof opt === 'string' ? opt : (opt?.text || '');
                                                            return (
                                                                <div key={optIdx} className="flex items-center gap-2">
                                                                    <span className="w-5 text-center text-xs font-bold text-gray-400 dark:text-slate-500">{String.fromCharCode(65 + optIdx)}</span>
                                                                    <input
                                                                        type="text"
                                                                        value={optText}
                                                                        onChange={e => {
                                                                            const nextOpts = [...(editingQuestion.data.options || ['', '', '', ''])];
                                                                            nextOpts[optIdx] = e.target.value;
                                                                            setEditingQuestion({
                                                                                ...editingQuestion,
                                                                                data: { ...editingQuestion.data, options: nextOpts }
                                                                            });
                                                                        }}
                                                                        className="flex-1 px-3 py-1.5 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-xs text-gray-900 dark:text-white outline-none focus:border-blue-500 transition"
                                                                    />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                <div className="flex items-center gap-2 pt-2">
                                                    <button
                                                        onClick={handleSaveQuestion}
                                                        disabled={isSavingQuestion}
                                                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest transition shadow-sm cursor-pointer disabled:opacity-50"
                                                    >
                                                        {isSavingQuestion ? <Spinner size={12} /> : null}
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingQuestion(null)}
                                                        className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 font-bold text-xs uppercase tracking-widest hover:bg-gray-200 dark:hover:bg-slate-700 transition cursor-pointer"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <p className="text-sm text-gray-900 dark:text-white font-medium whitespace-pre-wrap">{prompt}</p>

                                                {options.length > 0 && (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-slate-800">
                                                        {options.map((opt, optIdx) => {
                                                            const isCorrect = correctAnswer && opt === correctAnswer;
                                                            return (
                                                                <div
                                                                    key={optIdx}
                                                                    className={`px-3 py-2 rounded-xl text-xs font-medium border ${
                                                                        isCorrect
                                                                            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 font-bold'
                                                                            : 'bg-gray-50 dark:bg-slate-800/60 border-gray-100 dark:border-slate-700 text-gray-700 dark:text-slate-300'
                                                                    }`}
                                                                >
                                                                    <span className="font-bold mr-1.5 opacity-60">{String.fromCharCode(65 + optIdx)}.</span>
                                                                    {opt}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {q.explanation && (
                                                    <div className="mt-3 p-3 rounded-xl bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 text-xs text-blue-900 dark:text-blue-300">
                                                        <span className="font-bold">Explanation: </span>{q.explanation}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    }

    return null;
};

// ─── Upload Panel ─────────────────────────────────────────────────────────────

const UploadFormPanel: React.FC<PastQuestionsViewProps> = ({
    allDepartments, LEVELS, uploadDepartmentId, setUploadDepartmentId, uploadLevel, setUploadLevel,
    uploadCourseName, setUploadCourseName, year, setYear, pqFile, setPqFile, isPQProcessing,
    extractionProgress, handleGoogleDrivePick, handlePQUpload, newQuestion, setNewQuestion,
    handleAddQuestion, filteredGlobalCourses
}) => {
    const availableCourses = (filteredGlobalCourses || []).filter((c: any) =>
        (!uploadDepartmentId || c.deptId === uploadDepartmentId) && (!uploadLevel || c.level === uploadLevel)
    );

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-black text-gray-900 dark:text-white tracking-tight">Upload Questions</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Upload via AI extraction or add questions manually.</p>
            </div>

            <div className="p-5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl space-y-4">
                <p className="text-xs font-black uppercase tracking-widest text-gray-400 dark:text-slate-500">Target Assignment (College-Wide Catalog)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select
                        value={uploadDepartmentId}
                        onChange={e => setUploadDepartmentId(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition cursor-pointer"
                    >
                        <option value="">Department (Optional / General Access)</option>
                        {allDepartments.map((d: any) => <option key={d.id} value={d.id}>{d.department_name}</option>)}
                    </select>
                    <select
                        value={uploadLevel}
                        onChange={e => setUploadLevel(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition cursor-pointer"
                    >
                        <option value="">Level (Optional)</option>
                        {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <select
                        value={uploadCourseName}
                        onChange={e => setUploadCourseName(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition cursor-pointer"
                    >
                        <option value="">Course (Optional)</option>
                        {availableCourses.map(({ course }: any) => (
                            <option key={course.course_id || course.course_name} value={course.course_name}>
                                {course.course_code || course.course_id} ({course.course_name})
                            </option>
                        ))}
                    </select>
                    <input
                        type="text"
                        placeholder="Year (e.g. 2023)"
                        value={year}
                        onChange={e => setYear(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* AI Extraction */}
                <div className="p-5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="font-black text-sm text-gray-900 dark:text-white">AI Extraction</h3>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Extracts course titles in CAPITAL LETTERS for general college access</p>
                        </div>
                    </div>

                    <div className="border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-xl p-5 flex flex-col items-center gap-3 bg-gray-50/50 dark:bg-slate-800/40">
                        <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 flex items-center justify-center">
                            <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                        </div>
                        <input
                            type="file"
                            accept="application/pdf"
                            onChange={e => setPqFile(e.target.files?.[0] || null)}
                            className="w-full text-xs text-gray-500 dark:text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-600 dark:file:text-blue-400 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50 cursor-pointer transition"
                        />
                        {pqFile && (
                            <div className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 rounded-xl border border-blue-200 dark:border-blue-800">
                                <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span className="text-xs font-medium text-blue-700 dark:text-blue-300 truncate">{pqFile.name}</span>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => handleGoogleDrivePick(files => setPqFile(files[0] || null))}
                            className="w-full py-2 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-xs font-bold uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-slate-700 transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                        >
                            <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="" className="w-4 h-4" />
                            Import from Drive
                        </button>
                    </div>

                    {isPQProcessing && (
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-xl text-blue-700 dark:text-blue-300 text-xs font-bold">
                            <Spinner size={14} />
                            <span>{extractionProgress || 'Processing…'}</span>
                        </div>
                    )}

                    <button
                        onClick={handlePQUpload}
                        disabled={isPQProcessing || !pqFile}
                        className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-xs transition shadow-sm shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                    >
                        {isPQProcessing && <Spinner size={13} />}
                        {isPQProcessing ? 'Processing…' : 'Run AI Extraction'}
                    </button>
                </div>

                {/* Manual Entry */}
                <div className="p-5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center">
                            <svg className="w-4 h-4 text-gray-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="font-black text-sm text-gray-900 dark:text-white">Manual Entry</h3>
                            <p className="text-xs text-gray-500 dark:text-slate-400">Add a single question by hand</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <textarea
                            placeholder="Question content…"
                            value={newQuestion.question || ''}
                            onChange={e => setNewQuestion({ ...newQuestion, question: e.target.value })}
                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl h-24 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition resize-none bg-gray-50 dark:bg-slate-800/60 focus:bg-white dark:focus:bg-slate-800"
                        />
                        <div className="grid grid-cols-2 gap-2">
                            {[0, 1, 2, 3].map(i => (
                                <input
                                    key={i}
                                    type="text"
                                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                                    value={newQuestion.options?.[i] || ''}
                                    onChange={e => { const opts = [...(newQuestion.options || [])]; opts[i] = e.target.value; setNewQuestion({ ...newQuestion, options: opts }); }}
                                    className="px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition bg-white dark:bg-slate-800"
                                />
                            ))}
                        </div>
                        <input
                            type="text"
                            placeholder="Correct answer (exact match)"
                            value={newQuestion.correctAnswer || ''}
                            onChange={e => setNewQuestion({ ...newQuestion, correctAnswer: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-bold text-green-700 dark:text-green-400 placeholder:text-gray-400 dark:placeholder:text-slate-500 placeholder:font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition bg-white dark:bg-slate-800"
                        />
                        <textarea
                            placeholder="Explanation (optional)"
                            value={newQuestion.explanation || ''}
                            onChange={e => setNewQuestion({ ...newQuestion, explanation: e.target.value })}
                            className="w-full px-3 py-2.5 border border-gray-200 dark:border-slate-700 rounded-xl h-16 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition resize-none bg-gray-50 dark:bg-slate-800/60 focus:bg-white dark:focus:bg-slate-800"
                        />
                        <button
                            onClick={handleAddQuestion}
                            className="w-full py-3 rounded-xl bg-gray-900 hover:bg-black dark:bg-slate-800 dark:hover:bg-slate-750 text-white font-black uppercase tracking-widest text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            Add Question
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Main Export ──────────────────────────────────────────────────────────────

export const PastQuestionsView: React.FC<PastQuestionsViewProps> = (props) => {
    const [activePanel, setActivePanel] = useState<'library' | 'upload'>('library');

    return (
        <div className="space-y-6 max-w-5xl">
            {/* Page Header */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
                <div>
                    <div className="flex items-center gap-2.5 mb-1">
                        <div className="w-9 h-9 rounded-xl bg-gray-900 dark:bg-slate-800 flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                        </div>
                        <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Past Questions</h1>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-slate-400">Manage, view, rename, edit and bulk delete stored question packs.</p>
                </div>

                {/* Tab switcher */}
                <div className="inline-flex bg-gray-100 dark:bg-slate-800 rounded-xl p-1 gap-1 flex-shrink-0 border border-gray-200 dark:border-slate-700">
                    {(['library', 'upload'] as const).map(panel => (
                        <button
                            key={panel}
                            onClick={() => setActivePanel(panel)}
                            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-200 cursor-pointer ${
                                activePanel === panel
                                    ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-slate-700'
                                    : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white'
                            }`}
                        >
                            {panel === 'library' ? (
                                <span className="flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                    </svg>
                                    Library
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                    Upload
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="h-px bg-gray-100 dark:bg-slate-800" />

            {activePanel === 'library' && <PQLibraryPanel />}
            {activePanel === 'upload' && <UploadFormPanel {...props} />}
        </div>
    );
};
