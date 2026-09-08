import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { UserProfile } from '../types';
import type { Notebook } from '../services/notebookStorageService';
import { getNotebooks, saveNotebook, deleteNotebook } from '../services/notebookStorageService';
import { extractTextFromPdf } from '../services/pdfExtractorService';
import { readCachedJson } from '../utils/cache';
import { NotebookDetail } from './NotebookDetail';
import { useToast } from '../hooks/useToast';

interface MyNotebooksProps {
  userProfile: UserProfile;
  onNavigate?: (tab: string) => void;
  setCustomHeaderConfig?: (config: any) => void;
  onNestedViewChange?: (open: boolean) => void;
}

const MAX_PDF_SIZE_BYTES = 200 * 1024 * 1024; // 200MB limit

export const MyNotebooks: React.FC<MyNotebooksProps> = ({
  userProfile,
  onNavigate,
  setCustomHeaderConfig,
  onNestedViewChange,
}) => {
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [notebooks, setNotebooks] = useState<Notebook[]>(() => {
    if (!userProfile?.uid) return [];
    return readCachedJson<Notebook[]>(`avelut_notebooks_${userProfile.uid}`, []);
  });
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(null);
  const [isLoading, setIsLoading] = useState(() => {
    if (!userProfile?.uid) return false;
    const cached = readCachedJson<Notebook[]>(`avelut_notebooks_${userProfile.uid}`, []);
    return !cached || cached.length === 0;
  });
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<{ current: number; total: number; percent: number; message?: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const loadUserNotebooks = useCallback(async () => {
    if (!userProfile?.uid) return;
    const cached = readCachedJson<Notebook[]>(`avelut_notebooks_${userProfile.uid}`, []);
    if (cached && cached.length > 0) {
      setNotebooks(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    try {
      const list = await getNotebooks(userProfile.uid);
      if (list && list.length > 0) {
        setNotebooks(list);
      }
    } catch (err) {
      console.warn('Error loading notebooks:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userProfile?.uid]);

  useEffect(() => {
    void loadUserNotebooks();
  }, [loadUserNotebooks]);

  useEffect(() => {
    if (onNestedViewChange) {
      onNestedViewChange(!!selectedNotebook);
    }
    return () => {
      if (onNestedViewChange) {
        onNestedViewChange(false);
      }
    };
  }, [selectedNotebook, onNestedViewChange]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > MAX_PDF_SIZE_BYTES) {
      addToast('File too large. Maximum PDF size is 200MB.', 'error');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      addToast('Please upload a valid PDF document.', 'error');
      return;
    }

    setIsExtracting(true);
    setExtractProgress({ current: 0, total: 1, percent: 0 });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bufferForPdf = arrayBuffer.slice(0);

      const extraction = await extractTextFromPdf(bufferForPdf, file.name, (p) => {
        setExtractProgress(p);
      });

      if (extraction.isScannedImageOnly) {
        addToast(
          'Note: This document contains mostly scanned images. Extracted text may be limited.',
          'info'
        );
      }

      const saved = await saveNotebook(userProfile.uid, {
        title: extraction.title,
        fileName: file.name,
        fileSize: file.size,
        totalPages: extraction.totalPages,
        chapters: extraction.chapters,
        pages: extraction.pages,
        pdfBinary: file,
      });

      setNotebooks((prev) => [saved, ...prev]);
      addToast(`Extracted ${saved.chapter_count} chapters from ${file.name}!`, 'success');
      setSelectedNotebook(saved);
    } catch (err) {
      console.error('PDF extraction failed:', err);
      addToast('Failed to extract PDF text. Please ensure the PDF is not corrupted.', 'error');
    } finally {
      setIsExtracting(false);
      setExtractProgress(null);
    }
  };

  const handleDeleteNotebook = async (notebookId: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${title}" and all its extracted chapters from your device?`)) {
      try {
        await deleteNotebook(userProfile.uid, notebookId);
        setNotebooks((prev) => prev.filter((n) => n.id !== notebookId));
        if (selectedNotebook?.id === notebookId) {
          setSelectedNotebook(null);
        }
        addToast('Notebook removed from device.', 'info');
      } catch (err) {
        console.error('Delete error:', err);
      }
    }
  };

  if (selectedNotebook) {
    return (
      <NotebookDetail
        notebook={selectedNotebook}
        userProfile={userProfile}
        onBack={() => setSelectedNotebook(null)}
        onNavigate={onNavigate}
        setCustomHeaderConfig={setCustomHeaderConfig}
      />
    );
  }

  const filteredNotebooks = notebooks.filter(
    (n) =>
      n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.file_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-6 animate-fade-in pb-28 bg-transparent dark:bg-[#000000] text-slate-900 dark:text-white">
      <div className="bg-[#FAF9F6] dark:bg-[#0A0A0A] border border-slate-200/90 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-200/70 dark:bg-slate-800 text-black dark:text-white rounded-full text-[11px] font-bold tracking-wide uppercase border border-slate-200/80 dark:border-slate-700">
              <i className="bi bi-book"></i>
              <span>Study Notes & Textbooks</span>
            </div>
            <h3 className="text-lg sm:text-xl font-black text-black dark:text-white tracking-tight">
              My Notebooks & Offline Materials
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-200 leading-relaxed">
              Upload any textbook, handout, or lecture note PDF (up to 200MB). Extracted completely on your device with 0 AI cost.
            </p>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isExtracting}
            className="w-full sm:w-auto px-5 py-3.5 bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-black dark:text-white rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 shrink-0 shadow-2xs disabled:opacity-50"
          >
            <i className="bi bi-cloud-arrow-up text-base text-black dark:text-white"></i>
            <span>{isExtracting ? 'Extracting Text...' : 'Upload PDF Material'}</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf,application/pdf"
            className="hidden"
          />
        </div>

        {isExtracting && extractProgress && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2 animate-fade-in">
            <div className="flex items-center justify-between text-xs font-bold text-black dark:text-white">
              <span>{extractProgress.message || 'Extracting text & segmenting chapters...'}</span>
              <span>
                {extractProgress.current} / {extractProgress.total} Pages ({extractProgress.percent}%)
              </span>
            </div>
            <div className="w-full bg-slate-200/70 dark:bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-200 dark:border-slate-700">
              <div
                className="bg-black dark:bg-amber-400 h-2 rounded-full transition-all duration-300"
                style={{ width: `${extractProgress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {notebooks.length > 0 && (
        <div className="relative mb-4">
          <input
            type="text"
            placeholder="Search your uploaded materials..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#FAF9F6] dark:bg-[#0A0A0A] border border-slate-200 dark:border-slate-800 rounded-2xl py-3 pl-11 pr-4 text-xs font-medium text-black dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-slate-400 dark:focus:border-slate-600 transition-colors"
          />
          <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-[#FAF9F6] dark:bg-[#0A0A0A] border border-slate-200 dark:border-slate-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : filteredNotebooks.length > 0 ? (
          filteredNotebooks.map((nb) => (
            <div
              key={nb.id}
              onClick={() => setSelectedNotebook(nb)}
              className="w-full flex items-center justify-between p-4 sm:p-5 bg-[#FAF9F6] dark:bg-[#0A0A0A] border border-slate-200/90 dark:border-slate-800 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer group shadow-2xs gap-3"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-neutral-100 dark:bg-slate-800 border border-neutral-200 dark:border-slate-700 flex items-center justify-center text-black dark:text-slate-200 text-lg shrink-0 group-hover:bg-neutral-900 dark:group-hover:bg-slate-700 group-hover:text-white transition-colors">
                  <i className="bi bi-journal-text"></i>
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-black dark:text-white truncate group-hover:text-black dark:group-hover:text-white transition-colors">
                    {nb.title}
                  </h4>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-500 dark:text-slate-400">
                    <span>
                      {nb.chapter_count} {nb.chapter_count === 1 ? 'Chapter' : 'Chapters'}
                    </span>
                    <span>•</span>
                    <span>{nb.total_pages} Pages</span>
                    <span>•</span>
                    <span>{(nb.file_size / (1024 * 1024)).toFixed(1)} MB</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => handleDeleteNotebook(nb.id, nb.title, e)}
                  className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-slate-800 hover:bg-neutral-50 dark:hover:bg-slate-700 border border-neutral-200 dark:border-slate-700 hover:border-neutral-300 dark:hover:border-slate-600 text-neutral-500 dark:text-slate-400 hover:text-black dark:hover:text-white flex items-center justify-center transition-all cursor-pointer"
                  title="Delete Notebook"
                >
                  <i className="bi bi-trash text-xs"></i>
                </button>
                <div className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-slate-800 border border-neutral-200 dark:border-slate-700 flex items-center justify-center text-black dark:text-slate-300 group-hover:bg-neutral-900 dark:group-hover:bg-slate-700 group-hover:text-white transition-all">
                  <i className="bi bi-chevron-right text-xs"></i>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="bg-[#FAF9F6] dark:bg-[#0A0A0A] border border-slate-200/90 dark:border-slate-800 rounded-3xl p-10 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-neutral-100 dark:bg-slate-800 border border-neutral-200 dark:border-slate-700 flex items-center justify-center text-black dark:text-slate-300 text-2xl mx-auto">
              <i className="bi bi-folder2-open"></i>
            </div>
            <h4 className="text-base font-bold text-black dark:text-white">No Notebooks Added Yet</h4>
            <p className="text-xs text-neutral-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
              Upload any PDF textbook or course material to generate custom flashcards, quizzes, voice tutorials, and Socratic chats.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-2.5 bg-black hover:bg-neutral-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-black text-xs font-bold rounded-xl transition-all cursor-pointer inline-flex items-center gap-1.5 mt-2"
            >
              <i className="bi bi-cloud-arrow-up"></i>
              <span>Upload Your First PDF</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default MyNotebooks;
