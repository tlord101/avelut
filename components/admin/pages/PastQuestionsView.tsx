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

const Badge: React.FC<{ children: React.ReactNode; color?: 'blue' | 'gray' | 'green' | 'amber' }> = ({
    children, color = 'gray'
}) => {
    const colorMap = {
        blue: 'bg-blue-50 text-blue-700 border-blue-200',
        gray: 'bg-gray-100 text-gray-600 border-gray-200',
        green: 'bg-green-50 text-green-700 border-green-200',
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
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
        try {
            // Try updating `title` first. If the column doesn't exist, fall back to updating course_id.
            let dbErr: any = null;
            const titleResult = await supabase
                .from('past_questions')
                .update({ title: renameValue.trim(), updated_at: new Date().toISOString() } as any)
                .eq('id', selectedRow.id);
            dbErr = titleResult.error;

            if (dbErr) {
                // title column may not exist — fall back to course_id rename
                const fallbackResult = await supabase
                    .from('past_questions')
                    .update({ course_id: renameValue.trim(), updated_at: new Date().toISOString() })
                    .eq('id', selectedRow.id);
                if (fallbackResult.error) throw fallbackResult.error;
                const updated = { ...selectedRow, course_id: renameValue.trim(), title: renameValue.trim() };
                setSelectedRow(updated);
                setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
            } else {
                const updated = { ...selectedRow, title: renameValue.trim() };
                setSelectedRow(updated);
                setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
            }
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
            setRows(prev => prev.filter(r => r.id !== selectedRow.id));
            handleBack();
        } catch (err: any) {
            alert('Failed to delete: ' + (err?.message || 'Unknown error'));
        } finally {
            setIsDeletingPack(false);
        }
    };

    const handleSaveQuestion = async () => {
        if (!selectedRow || !editingQuestion) return;
        const updatedQuestions = [...(selectedRow.questions_json || [])];
        updatedQuestions[editingQuestion.index] = editingQuestion.data;
        setIsSavingQuestion(true);
        try {
            const { error: dbErr } = await supabase
                .from('past_questions')
                .update({ questions_json: updatedQuestions, updated_at: new Date().toISOString() })
                .eq('id', selectedRow.id);
            if (dbErr) throw dbErr;
            const updated = { ...selectedRow, questions_json: updatedQuestions };
            setSelectedRow(updated);
            setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
            setEditingQuestion(null);
        } catch (err: any) {
            alert('Failed to save question: ' + (err?.message || 'Unknown error'));
        } finally {
            setIsSavingQuestion(false);
        }
    };

    const handleDeleteQuestion = async (index: number) => {
        if (!selectedRow || !window.confirm('Delete this question?')) return;
        const updatedQuestions = (selectedRow.questions_json || []).filter((_, i) => i !== index);
        try {
            const { error: dbErr } = await supabase
                .from('past_questions')
                .update({ questions_json: updatedQuestions, updated_at: new Date().toISOString() })
                .eq('id', selectedRow.id);
            if (dbErr) throw dbErr;
            const updated = { ...selectedRow, questions_json: updatedQuestions };
            setSelectedRow(updated);
            setRows(prev => prev.map(r => r.id === updated.id ? updated : r));
        } catch (err: any) {
            alert('Failed to delete question: ' + (err?.message || 'Unknown error'));
        }
    };

    const getPackTitle = (row: StoredPQRow) =>
        row.title || [row.course_id, row.year].filter(Boolean).join(' — ') || row.id;

    const getQuestionCount = (row: StoredPQRow) =>
        Array.isArray(row.questions_json) ? row.questions_json.length : 0;

    const formatDate = (iso: string) => {
        try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
        catch { return iso; }
    };

    // ── List View ──────────────────────────────────────────────────────────────
    if (view === 'list') {
        return (
            <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-black text-gray-900 tracking-tight">Question Library</h2>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {isLoading ? 'Loading…' : `${rows.length} pack${rows.length !== 1 ? 's' : ''} stored`}
                        </p>
                    </div>
                    <button
                        onClick={fetchRows}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-bold text-xs uppercase tracking-widest hover:bg-gray-50 transition shadow-sm cursor-pointer"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Refresh
                    </button>
                </div>

                <div className="relative">
                    <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search by course, department, year…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
                    />
                </div>

                {isLoading && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                        <Spinner size={28} />
                        <p className="text-sm font-medium">Loading past questions…</p>
                    </div>
                )}

                {error && !isLoading && (
                    <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
                        <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                            <p className="font-bold text-sm">Error loading data</p>
                            <p className="text-xs mt-0.5 opacity-80">{error}</p>
                        </div>
                    </div>
                )}

                {!isLoading && !error && rows.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">
                        <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div className="text-center">
                            <p className="font-bold text-sm text-gray-500">No past questions yet</p>
                            <p className="text-xs mt-0.5 text-gray-400">Upload your first pack using the Upload tab.</p>
                        </div>
                    </div>
                )}

                {!isLoading && !error && filteredRows.length > 0 && (
                    <div className="grid grid-cols-1 gap-3">
                        {filteredRows.map(row => {
                            const count = getQuestionCount(row);
                            const title = getPackTitle(row);
                            return (
                                <button
                                    key={row.id}
                                    onClick={() => handleOpenDetail(row)}
                                    className="group w-full text-left flex items-center gap-4 p-4 bg-white border border-gray-200 rounded-2xl hover:border-blue-300 hover:shadow-md hover:shadow-blue-500/5 transition-all duration-200 cursor-pointer"
                                >
                                    <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500/15 transition-colors">
                                        <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-sm text-gray-900 truncate">{title}</p>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                            {row.department_id && <Badge color="gray">{row.department_id}</Badge>}
                                            {row.level && <Badge color="blue">{row.level}</Badge>}
                                            {row.year && <Badge color="amber">{row.year}</Badge>}
                                            <Badge color="green">{count} Q{count !== 1 ? 's' : ''}</Badge>
                                        </div>
                                        <p className="text-[10px] text-gray-400 mt-1.5">Updated {formatDate(row.updated_at)}</p>
                                    </div>
                                    <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            );
                        })}
                    </div>
                )}

                {!isLoading && !error && rows.length > 0 && filteredRows.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                        <p className="text-sm font-medium">No results for "{searchQuery}"</p>
                        <button onClick={() => setSearchQuery('')} className="mt-2 text-xs text-blue-500 hover:underline cursor-pointer">Clear search</button>
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
                        className="inline-flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-900 transition cursor-pointer"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to Library
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setRenameValue(selectedRow.title || selectedRow.course_id || ''); setIsRenaming(true); }}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 font-bold text-xs uppercase tracking-widest hover:bg-gray-50 transition shadow-sm cursor-pointer"
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Rename
                        </button>
                        <button
                            onClick={handleDeletePack}
                            disabled={isDeletingPack}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600 font-bold text-xs uppercase tracking-widest hover:bg-red-100 transition shadow-sm cursor-pointer disabled:opacity-50"
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
                <div className="p-5 bg-white border border-gray-200 rounded-2xl shadow-sm">
                    {isRenaming ? (
                        <div className="space-y-3">
                            <label className="text-xs font-black uppercase tracking-widest text-gray-500">Rename Pack</label>
                            <input
                                type="text"
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                autoFocus
                                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
                                placeholder="Enter a new name for this pack"
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveRename(); if (e.key === 'Escape') setIsRenaming(false); }}
                            />
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleSaveRename}
                                    disabled={isSavingRename || !renameValue.trim()}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest transition shadow-sm shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
                                >
                                    {isSavingRename ? <Spinner size={12} /> : null}
                                    Save Name
                                </button>
                                <button
                                    onClick={() => setIsRenaming(false)}
                                    className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 font-bold text-xs uppercase tracking-widest hover:bg-gray-200 transition cursor-pointer"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <h3 className="font-black text-xl text-gray-900 leading-tight">{getPackTitle(selectedRow)}</h3>
                            <div className="flex flex-wrap items-center gap-2 mt-3">
                                {selectedRow.department_id && <Badge color="gray">{selectedRow.department_id}</Badge>}
                                {selectedRow.level && <Badge color="blue">{selectedRow.level}</Badge>}
                                {selectedRow.year && <Badge color="amber">Year {selectedRow.year}</Badge>}
                                <Badge color="green">{questions.length} question{questions.length !== 1 ? 's' : ''}</Badge>
                            </div>
                            <p className="text-xs text-gray-400 mt-2">Last updated {formatDate(selectedRow.updated_at)} · <span className="font-mono">{selectedRow.id}</span></p>
                        </div>
                    )}
                </div>

                {/* Questions */}
                <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3">Questions ({questions.length})</h4>

                    {questions.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
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
                                    className={`bg-white border rounded-2xl overflow-hidden transition-all duration-200 ${isEditing ? 'border-blue-400 shadow-md shadow-blue-500/10' : 'border-gray-200 hover:border-gray-300'}`}
                                >
                                    <div className="flex items-start gap-3 p-4">
                                        <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 font-black text-xs text-gray-500">
                                            {idx + 1}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {isEditing ? (
                                                <div className="space-y-3">
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Question</label>
                                                        <textarea
                                                            rows={3}
                                                            value={editingQuestion!.data?.prompt || editingQuestion!.data?.question || ''}
                                                            onChange={e => setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, prompt: e.target.value, question: e.target.value } } : null)}
                                                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition resize-none"
                                                        />
                                                    </div>
                                                    {Array.isArray(editingQuestion!.data?.options) && editingQuestion!.data.options.length > 0 && (
                                                        <div className="space-y-2">
                                                            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">Options</label>
                                                            {editingQuestion!.data.options.map((opt: any, oi: number) => {
                                                                const optText = typeof opt === 'string' ? opt : (opt?.text || '');
                                                                const isCorrect = typeof opt === 'object' ? opt?.isCorrect : false;
                                                                return (
                                                                    <div key={oi} className="flex items-center gap-2">
                                                                        <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0 ${isCorrect ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                                                            {String.fromCharCode(65 + oi)}
                                                                        </span>
                                                                        <input
                                                                            type="text"
                                                                            value={optText}
                                                                            onChange={e => {
                                                                                const newOpts = [...editingQuestion!.data.options];
                                                                                if (typeof opt === 'string') newOpts[oi] = e.target.value;
                                                                                else newOpts[oi] = { ...newOpts[oi], text: e.target.value };
                                                                                setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, options: newOpts } } : null);
                                                                            }}
                                                                            className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
                                                                        />
                                                                        <button
                                                                            onClick={() => {
                                                                                const newOpts = editingQuestion!.data.options.map((o: any, i: number) => {
                                                                                    if (typeof o === 'string') return o;
                                                                                    return { ...o, isCorrect: i === oi };
                                                                                });
                                                                                setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, options: newOpts } } : null);
                                                                            }}
                                                                            title="Mark as correct"
                                                                            className={`w-6 h-6 rounded-full flex items-center justify-center transition cursor-pointer flex-shrink-0 ${isCorrect ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-600'}`}
                                                                        >
                                                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                            </svg>
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Correct Answer</label>
                                                        <input
                                                            type="text"
                                                            value={editingQuestion!.data?.correctAnswer || editingQuestion!.data?.correct_answer || ''}
                                                            onChange={e => setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, correctAnswer: e.target.value, correct_answer: e.target.value } } : null)}
                                                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-bold text-green-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
                                                            placeholder="Correct answer string"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 block">Explanation</label>
                                                        <textarea
                                                            rows={2}
                                                            value={editingQuestion!.data?.explanation || ''}
                                                            onChange={e => setEditingQuestion(prev => prev ? { ...prev, data: { ...prev.data, explanation: e.target.value } } : null)}
                                                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition resize-none"
                                                            placeholder="Optional explanation"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-2 pt-1">
                                                        <button
                                                            onClick={handleSaveQuestion}
                                                            disabled={isSavingQuestion}
                                                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-widest transition shadow-sm shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
                                                        >
                                                            {isSavingQuestion ? <Spinner size={12} /> : null}
                                                            Save Changes
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingQuestion(null)}
                                                            className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 font-bold text-xs uppercase tracking-widest hover:bg-gray-200 transition cursor-pointer"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div>
                                                    <p className="text-sm font-semibold text-gray-900 leading-snug">{prompt || <span className="text-gray-400 italic">No question text</span>}</p>
                                                    {options.length > 0 && (
                                                        <div className="mt-2 space-y-1">
                                                            {options.map((opt, oi) => {
                                                                const isCorrectOpt = Array.isArray(q?.options) && typeof q.options[oi] === 'object' ? q.options[oi]?.isCorrect : (opt === correctAnswer);
                                                                return (
                                                                    <div key={oi} className={`flex items-center gap-2 text-xs rounded-lg px-2 py-1 ${isCorrectOpt ? 'bg-green-50 text-green-800' : 'bg-gray-50 text-gray-600'}`}>
                                                                        <span className={`font-black w-4 h-4 rounded flex items-center justify-center text-[9px] ${isCorrectOpt ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                                                            {String.fromCharCode(65 + oi)}
                                                                        </span>
                                                                        <span>{opt}</span>
                                                                        {isCorrectOpt && <span className="ml-auto text-[10px] font-black text-green-600">✓ Correct</span>}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    {q?.explanation && (
                                                        <p className="mt-2 text-xs text-gray-400 italic border-l-2 border-gray-200 pl-2">{q.explanation}</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {!isEditing && (
                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                <button
                                                    onClick={() => setEditingQuestion({ index: idx, data: { ...q } })}
                                                    className="w-8 h-8 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition cursor-pointer"
                                                    title="Edit question"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteQuestion(idx)}
                                                    className="w-8 h-8 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition cursor-pointer"
                                                    title="Delete question"
                                                >
                                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
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
                <h2 className="text-lg font-black text-gray-900 tracking-tight">Upload Questions</h2>
                <p className="text-sm text-gray-500 mt-0.5">Upload via AI extraction or add questions manually.</p>
            </div>

            <div className="p-5 bg-white border border-gray-200 rounded-2xl space-y-4">
                <p className="text-xs font-black uppercase tracking-widest text-gray-400">Target Assignment</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <select value={uploadDepartmentId} onChange={e => setUploadDepartmentId(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition cursor-pointer">
                        <option value="">Department (Optional)</option>
                        {allDepartments.map((d: any) => <option key={d.id} value={d.id}>{d.department_name}</option>)}
                    </select>
                    <select value={uploadLevel} onChange={e => setUploadLevel(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition cursor-pointer">
                        <option value="">Level (Optional)</option>
                        {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <select value={uploadCourseName} onChange={e => setUploadCourseName(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-white text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition cursor-pointer">
                        <option value="">Course (Optional)</option>
                        {availableCourses.map(({ course }: any) => (
                            <option key={course.course_id || course.course_name} value={course.course_name}>
                                {course.course_code || course.course_id} ({course.course_name})
                            </option>
                        ))}
                    </select>
                    <input type="text" placeholder="Year (e.g. 2023)" value={year} onChange={e => setYear(e.target.value)}
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition" />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* AI Extraction */}
                <div className="p-5 bg-white border border-gray-200 rounded-2xl space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                            <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="font-black text-sm text-gray-900">AI Extraction</h3>
                            <p className="text-xs text-gray-500">Upload a PDF and let AI do the work</p>
                        </div>
                    </div>

                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 flex flex-col items-center gap-3 bg-gray-50/50">
                        <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                            <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                        </div>
                        <input type="file" accept="application/pdf" onChange={e => setPqFile(e.target.files?.[0] || null)}
                            className="w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100 cursor-pointer file:cursor-pointer transition" />
                        {pqFile && (
                            <div className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-200">
                                <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span className="text-xs font-medium text-blue-700 truncate">{pqFile.name}</span>
                            </div>
                        )}
                        <button type="button" onClick={() => handleGoogleDrivePick(files => setPqFile(files[0] || null))}
                            className="w-full py-2 rounded-xl bg-white border border-gray-200 text-gray-700 text-xs font-bold uppercase tracking-widest hover:bg-gray-50 transition flex items-center justify-center gap-2 shadow-sm cursor-pointer">
                            <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="" className="w-4 h-4" />
                            Import from Drive
                        </button>
                    </div>

                    {isPQProcessing && (
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-xs font-bold">
                            <Spinner size={14} />
                            <span>{extractionProgress || 'Processing…'}</span>
                        </div>
                    )}

                    <button onClick={handlePQUpload} disabled={isPQProcessing || !pqFile}
                        className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest text-xs transition shadow-sm shadow-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer">
                        {isPQProcessing && <Spinner size={13} />}
                        {isPQProcessing ? 'Processing…' : 'Run AI Extraction'}
                    </button>
                </div>

                {/* Manual Entry */}
                <div className="p-5 bg-white border border-gray-200 rounded-2xl space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
                            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="font-black text-sm text-gray-900">Manual Entry</h3>
                            <p className="text-xs text-gray-500">Add a single question by hand</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <textarea placeholder="Question content…" value={newQuestion.question || ''}
                            onChange={e => setNewQuestion({ ...newQuestion, question: e.target.value })}
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl h-24 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition resize-none bg-gray-50 focus:bg-white" />
                        <div className="grid grid-cols-2 gap-2">
                            {[0, 1, 2, 3].map(i => (
                                <input key={i} type="text" placeholder={`Option ${String.fromCharCode(65 + i)}`}
                                    value={newQuestion.options?.[i] || ''}
                                    onChange={e => { const opts = [...(newQuestion.options || [])]; opts[i] = e.target.value; setNewQuestion({ ...newQuestion, options: opts }); }}
                                    className="px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition bg-white" />
                            ))}
                        </div>
                        <input type="text" placeholder="Correct answer (exact match)" value={newQuestion.correctAnswer || ''}
                            onChange={e => setNewQuestion({ ...newQuestion, correctAnswer: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm font-bold text-green-700 placeholder:text-gray-400 placeholder:font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition" />
                        <textarea placeholder="Explanation (optional)" value={newQuestion.explanation || ''}
                            onChange={e => setNewQuestion({ ...newQuestion, explanation: e.target.value })}
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl h-16 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition resize-none bg-gray-50 focus:bg-white" />
                        <button onClick={handleAddQuestion}
                            className="w-full py-3 rounded-xl bg-gray-900 hover:bg-black text-white font-black uppercase tracking-widest text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-sm">
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
                        <div className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center">
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                        </div>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight">Past Questions</h1>
                    </div>
                    <p className="text-sm text-gray-500">Manage, view, rename and edit stored question packs.</p>
                </div>

                {/* Tab switcher */}
                <div className="inline-flex bg-gray-100 rounded-xl p-1 gap-1 flex-shrink-0">
                    {(['library', 'upload'] as const).map(panel => (
                        <button
                            key={panel}
                            onClick={() => setActivePanel(panel)}
                            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-200 cursor-pointer ${
                                activePanel === panel
                                    ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                                    : 'text-gray-500 hover:text-gray-800'
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

            <div className="h-px bg-gray-100" />

            {activePanel === 'library' && <PQLibraryPanel />}
            {activePanel === 'upload' && <UploadFormPanel {...props} />}
        </div>
    );
};
