import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { UserProfile, Topic, Course } from '../types';
import type { Notebook, NotebookChapter } from '../services/notebookStorageService';
import { getChapterContent } from '../services/notebookStorageService';
import NotebookQuiz from './NotebookQuiz';
import NotebookFlashcards from './NotebookFlashcards';
import NotebookChat from './NotebookChat';
import VoiceTutorialPage, { VoiceTutorialSessionData } from './VoiceTutorialPage';
import { useAppSettings } from '../hooks/useAppSettings';

import { readCachedJson, writeCachedJson } from '../utils/cache';
import { formatLastVisited } from './StudyGuide';
import { hasLiveTutorialAccess } from '../utils/usage';
import { LimitExceededModal } from './LimitExceededModal';

interface NotebookDetailProps {
  notebook: Notebook;
  userProfile: UserProfile;
  onBack: () => void;
  onNavigate?: (tab: string) => void;
  setCustomHeaderConfig?: (config: any) => void;
}

type StudyMode = 'none' | 'quiz' | 'flashcards' | 'chat' | 'voice';

export const NotebookDetail: React.FC<NotebookDetailProps> = ({
  notebook,
  userProfile,
  onBack,
  onNavigate,
  setCustomHeaderConfig,
}) => {
  const { settings: appSettings } = useAppSettings();

  const [selectedChapter, setSelectedChapter] = useState<NotebookChapter | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [activeMode, setActiveMode] = useState<StudyMode>('none');
  const [chapterFullContent, setChapterFullContent] = useState<string>('');
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitCost, setLimitCost] = useState(450);
  const [chapterVisits, setChapterVisits] = useState<Record<string, number>>(() => {
    if (!userProfile?.uid) return {};
    return readCachedJson<Record<string, number>>(`avelut_chapter_visits_${userProfile.uid}`, {});
  });

  const handleOpenChapterActions = async (chapter: NotebookChapter) => {
    const now = Date.now();
    const nextVisits = { ...chapterVisits, [chapter.id]: now };
    setChapterVisits(nextVisits);
    if (userProfile?.uid) {
      writeCachedJson(`avelut_chapter_visits_${userProfile.uid}`, nextVisits);
    }
    setSelectedChapter(chapter);
    setShowActionModal(true);
    setIsLoadingContent(true);
    try {
      const content = await getChapterContent(notebook.id, chapter.id);
      setChapterFullContent(content);
    } catch (err) {
      console.warn('Error loading chapter content:', err);
    } finally {
      setIsLoadingContent(false);
    }
  };

  const liveAccess = hasLiveTutorialAccess(userProfile);

  const handleSelectMode = (mode: StudyMode) => {
    if (mode === 'voice' && !liveAccess.allowed) {
      setLimitCost(450);
      setShowLimitModal(true);
      return;
    }
    setShowActionModal(false);
    setActiveMode(mode);
  };

  // ── Main App Header for Notebook Chapter List ──
  useEffect(() => {
    if (activeMode === 'none' && setCustomHeaderConfig) {
      setCustomHeaderConfig({
        hideBottomNav: false,
        leftActions: (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 max-w-[calc(100vw-110px)] sm:max-w-none">
            <button
              onClick={onBack}
              className="w-10 h-10 rounded-full bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0F172A] dark:text-white transition-all cursor-pointer shrink-0 shadow-2xs active:scale-95"
              aria-label="Back to notebooks"
              title="Back"
            >
              <i className="bi bi-arrow-left text-base font-bold text-[#0066FF] dark:text-brand-400"></i>
            </button>
            <div className="min-w-0 flex flex-col justify-center">
              <span className="text-[10px] font-bold text-[#64748B] dark:text-slate-400 uppercase tracking-wider block truncate">
                Notebook Material
              </span>
              <h2 className="text-xs sm:text-sm font-bold text-[#0F172A] dark:text-white truncate max-w-[140px] sm:max-w-[280px] md:max-w-[400px]">
                {notebook.title}
              </h2>
            </div>
          </div>
        ),
        className: 'bg-[#F6F6F3]/95 dark:bg-slate-950/95 border-b border-[#E3E9F1] dark:border-slate-800 backdrop-blur-md',
      });
    }

    return () => {
      if (activeMode === 'none' && setCustomHeaderConfig) {
        setCustomHeaderConfig(null);
      }
    };
  }, [activeMode, setCustomHeaderConfig, onBack, notebook.title]);

  // Stable voice session so duration modal is not reset on parent re-renders
  // (must stay above early returns to satisfy Rules of Hooks)
  const memoizedVoiceSession = useMemo<VoiceTutorialSessionData | null>(() => {
    if (activeMode !== 'voice' || !selectedChapter) return null;
    return {
      course: {
        course_id: notebook.id,
        course_name: notebook.title,
        level: 'General',
        topics: [],
      },
      topic: {
        topic_id: selectedChapter.id,
        topic_name: selectedChapter.title,
        topic_context: chapterFullContent.slice(0, 5000),
      },
      syllabusContext: `NOTEBOOK TEXTBOOK SOURCE: "${notebook.title}". CHAPTER: "${selectedChapter.title}".`,
      customPrompt: `Speak as a personalized tutor teaching directly from the student's notebook. Naturally reference their notes throughout (e.g. "Looking at this chapter of your note...", "From this part of your note...", "As outlined in chapter ${selectedChapter.title}...").`,
    };
  }, [activeMode, selectedChapter, notebook.id, notebook.title, chapterFullContent]);

  // 1. Render Active Mode: Quiz
  if (activeMode === 'quiz' && selectedChapter) {
    return (
      <NotebookQuiz
        notebook={notebook}
        chapter={selectedChapter}
        chapterContent={chapterFullContent}
        userProfile={userProfile}
        onBack={() => setActiveMode('none')}
        setCustomHeaderConfig={setCustomHeaderConfig}
      />
    );
  }

  // 2. Render Active Mode: Flashcards
  if (activeMode === 'flashcards' && selectedChapter) {
    return (
      <NotebookFlashcards
        notebook={notebook}
        chapter={selectedChapter}
        chapterContent={chapterFullContent}
        userProfile={userProfile}
        onBack={() => setActiveMode('none')}
        setCustomHeaderConfig={setCustomHeaderConfig}
      />
    );
  }

  // 3. Render Active Mode: Chat Tutorial
  if (activeMode === 'chat' && selectedChapter) {
    return (
      <NotebookChat
        notebook={notebook}
        chapter={selectedChapter}
        chapterContent={chapterFullContent}
        userProfile={userProfile}
        onBack={() => setActiveMode('none')}
        setCustomHeaderConfig={setCustomHeaderConfig}
      />
    );
  }

  // 4. Render Active Mode: Voice & Visual Tutorial
  if (activeMode === 'voice' && selectedChapter && memoizedVoiceSession) {
    return (
      <VoiceTutorialPage
        userProfile={userProfile}
        appSettings={appSettings}
        initialSessionData={memoizedVoiceSession}
        onBack={() => {
          setActiveMode('none');
          if (setCustomHeaderConfig) setCustomHeaderConfig(null);
        }}
        onNavigate={onNavigate}
        setCustomHeaderConfig={setCustomHeaderConfig}
      />
    );
  }

  // 5. Main Chapter Listing View
  return (
    <div className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 pb-[calc(76px+env(safe-area-inset-bottom)+20px)] overflow-y-auto space-y-4 animate-fade-in text-slate-900 dark:text-slate-100">
      {/* Top Info Banner Header */}
      <div className="bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-xs">
        <div>
          <span className="text-[11px] font-bold text-[#64748B] dark:text-slate-400 uppercase tracking-wider">
            Extracted Textbook Material
          </span>
          <h2 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-white tracking-tight mt-0.5">
            {notebook.title}
          </h2>
        </div>

        {/* Metadata Pills */}
        <div className="flex items-center gap-2.5 flex-wrap text-xs text-[#64748B] dark:text-slate-400 pt-3 mt-3 border-t border-[#E3E9F1] dark:border-slate-800">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#F6F6F3] dark:bg-slate-800 rounded-full border border-[#E3E9F1] dark:border-slate-700">
            <i className="bi bi-file-earmark-text text-[#0066FF] dark:text-brand-400"></i>
            {notebook.total_pages} {notebook.total_pages === 1 ? 'Page' : 'Pages'}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#F6F6F3] dark:bg-slate-800 rounded-full border border-[#E3E9F1] dark:border-slate-700">
            <i className="bi bi-bookmark text-[#0066FF] dark:text-brand-400"></i>
            {notebook.chapter_count} {notebook.chapter_count === 1 ? 'Chapter' : 'Chapters'}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#F6F6F3] dark:bg-slate-800 rounded-full border border-[#E3E9F1] dark:border-slate-700">
            <i className="bi bi-hdd text-[#0066FF] dark:text-brand-400"></i>
            {(notebook.file_size / (1024 * 1024)).toFixed(1)} MB
          </span>
        </div>
      </div>

      {/* Chapters Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-bold text-[#0F172A] dark:text-white uppercase tracking-wider">
            Chapters in this Material
          </h3>
          <span className="text-xs text-[#64748B] dark:text-slate-400">Select a chapter to study</span>
        </div>

        {notebook.chapters.map((ch, idx) => {
          const visitedTime = chapterVisits[ch.id];
          const visitedLabel = formatLastVisited(visitedTime);

          return (
            <div
              key={ch.id}
              onClick={() => handleOpenChapterActions(ch)}
              className="w-full flex items-center justify-between p-4 sm:p-5 bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-800 rounded-2xl hover:border-[#0066FF]/50 dark:hover:border-brand-500/50 transition-all cursor-pointer group shadow-2xs gap-3"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#F6F6F3] dark:bg-slate-800 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0F172A] dark:text-white font-bold text-sm shrink-0 group-hover:bg-[#002D62] dark:group-hover:bg-brand-600 group-hover:text-white transition-colors">
                  {idx + 1}
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-[#0F172A] dark:text-white truncate group-hover:text-[#0066FF] dark:group-hover:text-brand-400 transition-colors">
                    {ch.title}
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5 text-xs text-[#64748B] dark:text-slate-400">
                    {visitedLabel && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F1F5F9] dark:bg-slate-800 text-[#64748B] dark:text-slate-400 text-[10px] font-semibold border border-[#E3E9F1] dark:border-slate-700">
                        <i className="bi bi-clock-history text-[#0066FF] dark:text-brand-400 text-[10px]"></i>
                        <span>{visitedLabel}</span>
                      </span>
                    )}
                    <span>Pages {ch.startPage}–{ch.endPage}</span>
                    <span>•</span>
                    <span>{ch.wordCount.toLocaleString()} words</span>
                  </div>
                </div>
              </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-block text-xs font-bold text-[#0066FF] dark:text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Study Chapter
              </span>
              <div className="w-8 h-8 rounded-full bg-[#F6F6F3] dark:bg-slate-800 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0F172A] dark:text-white group-hover:bg-[#0066FF] dark:group-hover:bg-brand-600 group-hover:text-white transition-all">
                <i className="bi bi-chevron-right text-xs"></i>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* Action Modal (6 Study Options) — Rendered via createPortal to escape transformed parent bounds */}
      {showActionModal && selectedChapter && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs cursor-pointer animate-fade-in"
            onClick={() => setShowActionModal(false)}
          />

          {/* Modal Container */}
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl z-10 animate-fade-in space-y-5 max-h-[90vh] overflow-y-auto text-[#0F172A] dark:text-white">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-[#E3E9F1] dark:border-slate-800 pb-3.5">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] font-bold text-[#64748B] dark:text-slate-400 uppercase tracking-wider block">
                  Choose Study Mode
                </span>
                <h3 className="text-base sm:text-lg font-black text-[#0F172A] dark:text-white truncate mt-0.5">
                  {selectedChapter.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowActionModal(false)}
                className="w-8 h-8 rounded-full bg-[#F6F6F3] dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0F172A] dark:text-white transition-all cursor-pointer shrink-0"
              >
                <i className="bi bi-x-lg text-xs font-bold"></i>
              </button>
            </div>

            {/* 6 Study Action Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* 1. Chat Based Tutorial */}
              <button
                type="button"
                onClick={() => handleSelectMode('chat')}
                disabled={isLoadingContent}
                className="flex items-center gap-3 p-3.5 bg-[#F6F6F3] dark:bg-slate-800 hover:bg-[#F1F5F9] dark:hover:bg-slate-700 border border-[#E3E9F1] dark:border-slate-700 hover:border-[#0066FF]/50 dark:hover:border-brand-500/50 rounded-2xl text-left transition-all cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0066FF] dark:text-brand-400 shrink-0 shadow-2xs">
                  <i className="bi bi-chat-dots text-base"></i>
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-[#0F172A] dark:text-white group-hover:text-[#0066FF] dark:group-hover:text-brand-400 truncate">Chat Tutorial</h4>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5 leading-tight">Socratic 1-on-1 tutor</p>
                </div>
              </button>

              {/* 2. Flashcards */}
              <button
                type="button"
                onClick={() => handleSelectMode('flashcards')}
                disabled={isLoadingContent}
                className="flex items-center gap-3 p-3.5 bg-[#F6F6F3] dark:bg-slate-800 hover:bg-[#F1F5F9] dark:hover:bg-slate-700 border border-[#E3E9F1] dark:border-slate-700 hover:border-[#0066FF]/50 dark:hover:border-brand-500/50 rounded-2xl text-left transition-all cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0066FF] dark:text-brand-400 shrink-0 shadow-2xs">
                  <i className="bi bi-card-text text-base"></i>
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-[#0F172A] dark:text-white group-hover:text-[#0066FF] dark:group-hover:text-brand-400 truncate">Flashcards</h4>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5 leading-tight">Interactive 3D cards</p>
                </div>
              </button>

              {/* 3. Quiz Test */}
              <button
                type="button"
                onClick={() => handleSelectMode('quiz')}
                disabled={isLoadingContent}
                className="flex items-center gap-3 p-3.5 bg-[#F6F6F3] dark:bg-slate-800 hover:bg-[#F1F5F9] dark:hover:bg-slate-700 border border-[#E3E9F1] dark:border-slate-700 hover:border-[#0066FF]/50 dark:hover:border-brand-500/50 rounded-2xl text-left transition-all cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0066FF] dark:text-brand-400 shrink-0 shadow-2xs">
                  <i className="bi bi-check2-square text-base"></i>
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-[#0F172A] dark:text-white group-hover:text-[#0066FF] dark:group-hover:text-brand-400 truncate">Quiz Test</h4>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5 leading-tight">Timed test & timer</p>
                </div>
              </button>

              {/* 4. Visual & Voice Tutorial */}
              <button
                type="button"
                onClick={() => handleSelectMode('voice')}
                disabled={isLoadingContent}
                className="flex items-center gap-3 p-3.5 bg-[#F6F6F3] dark:bg-slate-800 hover:bg-[#F1F5F9] dark:hover:bg-slate-700 border border-[#E3E9F1] dark:border-slate-700 hover:border-[#0066FF]/50 dark:hover:border-brand-500/50 rounded-2xl text-left transition-all cursor-pointer group relative"
              >
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#0066FF] dark:text-brand-400 shrink-0 shadow-2xs">
                  <i className="bi bi-mic text-base"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <h4 className="text-xs font-bold text-[#0F172A] dark:text-white group-hover:text-[#0066FF] dark:group-hover:text-brand-400 truncate">Voice Tutorial</h4>
                    {!liveAccess.allowed && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#F3F3F3] dark:bg-[#1C1C1C] text-[#525252] dark:text-[#A3A3A3] text-[10px] font-extrabold border border-[#E6E6E6] dark:border-[#2A2A2A] shrink-0">
                        <i className="bi bi-lock-fill text-[9px]"></i>
                        <span>₦450</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5 leading-tight">Blackboard voice lesson</p>
                </div>
              </button>

              {/* 5. Infographics (Coming Soon) */}
              <div className="flex items-center gap-3 p-3.5 bg-[#F8FAFC] dark:bg-slate-800/50 border border-[#E2E8F0] dark:border-slate-700/50 rounded-2xl text-left opacity-80 relative">
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#64748B] dark:text-slate-400 shrink-0">
                  <i className="bi bi-graph-up text-base"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-[#0F172A] dark:text-white truncate">Infographics</h4>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-[#E2E8F0] dark:bg-slate-700 text-[#475569] dark:text-slate-300 rounded-full shrink-0">
                      Soon
                    </span>
                  </div>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5 leading-tight">Visual concept summary</p>
                </div>
              </div>

              {/* 6. Podcast (Coming Soon) */}
              <div className="flex items-center gap-3 p-3.5 bg-[#F8FAFC] dark:bg-slate-800/50 border border-[#E2E8F0] dark:border-slate-700/50 rounded-2xl text-left opacity-80 relative">
                <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-700 flex items-center justify-center text-[#64748B] dark:text-slate-400 shrink-0">
                  <i className="bi bi-headphones text-base"></i>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-[#0F172A] dark:text-white truncate">Podcast</h4>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-[#E2E8F0] dark:bg-slate-700 text-[#475569] dark:text-slate-300 rounded-full shrink-0">
                      Soon
                    </span>
                  </div>
                  <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5 leading-tight">Audio overview episode</p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Limit Exceeded Modal for Locked Live Tutorial */}
      <LimitExceededModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        userProfile={userProfile}
        appSettings={appSettings}
        cost={limitCost}
        balance={userProfile?.ai_credits_balance ?? 0}
        onNavigate={onNavigate}
      />
    </div>
  );
};

export default NotebookDetail;
