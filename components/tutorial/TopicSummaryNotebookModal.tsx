import { db, push, ref as dbRef, serverTimestamp } from '@/lib/backend';
import React, { useState } from 'react';
import { useToast } from '../../hooks/useToast';

export interface FlashcardItem {
  front: string;
  back: string;
}

export interface ExamQuestionItem {
  question: string;
  markingScheme: string;
  highYieldTip: string;
}

export interface TopicSummaryData {
  topicTitle: string;
  topicId: string;
  studentId: string;
  summaryPoints: string[];
  keyTerms: Array<{ term: string; definition: string }>;
  flashcards: FlashcardItem[];
  examQuestions: ExamQuestionItem[];
}

export interface TopicSummaryNotebookModalProps {
  data: TopicSummaryData;
  isOpen: boolean;
  onClose: () => void;
}

export const TopicSummaryNotebookModal: React.FC<TopicSummaryNotebookModalProps> = ({
  data,
  isOpen,
  onClose,
}) => {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<'summary' | 'flashcards' | 'exam'>('summary');
  const [flippedCardIndex, setFlippedCardIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  if (!isOpen) return null;

  const handleSaveToNotebook = async () => {
    setIsSaving(true);
    try {
      // Build clean structured markdown note for student's notebook
      const markdownContent = [
        `# ${data.topicTitle} — Master Study Summary`,
        `*Generated during AI Live Tutorial Session*\n`,
        `## 📌 Core Takeaways`,
        ...data.summaryPoints.map((p) => `- ${p}`),
        `\n## 📖 Key Terminology Glossary`,
        ...data.keyTerms.map((t) => `- **${t.term}**: ${t.definition}`),
        `\n## ⚡ High-Yield Exam Questions & Marking Scheme`,
        ...data.examQuestions.map((q, idx) => `### Question ${idx + 1}: ${q.question}\n- **Marking Scheme**: ${q.markingScheme}\n- 💡 *Tip*: ${q.highYieldTip}`),
      ].join('\n');

      const notebookRef = dbRef(db, `user_notebooks/${data.studentId}`);
      await push(notebookRef, {
        title: `${data.topicTitle} — Live Tutorial Summary`,
        content: markdownContent,
        topicId: data.topicId,
        createdAt: serverTimestamp(),
        type: 'live_tutorial_export',
      });

      setIsSaved(true);
      addToast('Saved to My Notebooks successfully!', 'success');
    } catch (err) {
      console.error('Failed to save to notebook:', err);
      addToast('Failed to save note to Notebook.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in select-none">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-[32px] max-w-2xl w-full max-h-[90vh] flex flex-col border border-[#E3E9F1] dark:border-slate-800 shadow-2xl overflow-hidden animate-scale-in"
      >
        {/* Modal Header */}
        <header className="px-6 py-5 border-b border-[#E3E9F1] dark:border-slate-800 flex items-center justify-between shrink-0 bg-[#F6F6F3]/60 dark:bg-slate-900/60">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-black uppercase tracking-wider text-[#0066FF]">Topic Mastered</span>
            </div>
            <h2 className="text-xl font-extrabold text-[#0F172A] dark:text-white tracking-tight">
              {data.topicTitle}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition cursor-pointer"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </header>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 pt-3 border-b border-[#E3E9F1] dark:border-slate-800 gap-6 shrink-0 bg-white dark:bg-slate-900 text-sm font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`pb-3 border-b-2 transition cursor-pointer ${
              activeTab === 'summary'
                ? 'border-[#0066FF] text-[#0066FF]'
                : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            📋 Master Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('flashcards')}
            className={`pb-3 border-b-2 transition cursor-pointer ${
              activeTab === 'flashcards'
                ? 'border-[#0066FF] text-[#0066FF]'
                : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            🃏 Flashcards ({data.flashcards.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('exam')}
            className={`pb-3 border-b-2 transition cursor-pointer ${
              activeTab === 'exam'
                ? 'border-[#0066FF] text-[#0066FF]'
                : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            🎯 High-Yield Exam Questions
          </button>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* TAB 1: SUMMARY & TERMINOLOGY */}
          {activeTab === 'summary' && (
            <div className="space-y-6 animate-fade-in">
              {/* Summary Points Card */}
              <div className="p-5 rounded-2xl bg-[#F6F6F3] dark:bg-slate-800/60 border border-[#E3E9F1] dark:border-slate-700">
                <h4 className="text-sm font-black uppercase tracking-wider text-[#002D62] dark:text-[#60A5FA] mb-3">
                  Core Topic Takeaways
                </h4>
                <ul className="space-y-2.5 text-sm text-[#0F172A] dark:text-slate-200 leading-relaxed list-disc pl-5">
                  {data.summaryPoints.map((point, idx) => (
                    <li key={idx}>{point}</li>
                  ))}
                </ul>
              </div>

              {/* Key Terminology Glossary */}
              <div>
                <h4 className="text-sm font-black uppercase tracking-wider text-[#002D62] dark:text-[#60A5FA] mb-3">
                  Key Terminology Glossary
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {data.keyTerms.map((term, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-[#E3E9F1] dark:border-slate-700 shadow-xs"
                    >
                      <h5 className="font-bold text-[#0066FF] text-sm mb-1">{term.term}</h5>
                      <p className="text-xs text-[#64748B] dark:text-slate-300 leading-relaxed">{term.definition}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE FLASHCARDS */}
          {activeTab === 'flashcards' && (
            <div className="space-y-4 animate-fade-in">
              <p className="text-xs text-[#64748B] font-semibold text-center">Tap any card to flip and test memory</p>
              <div className="grid grid-cols-1 gap-3.5">
                {data.flashcards.map((card, idx) => {
                  const isFlipped = flippedCardIndex === idx;
                  return (
                    <div
                      key={idx}
                      onClick={() => setFlippedCardIndex(isFlipped ? null : idx)}
                      className={`p-6 rounded-2xl border transition-all cursor-pointer shadow-xs min-h-[110px] flex flex-col justify-center ${
                        isFlipped
                          ? 'bg-[#002D62] text-white border-[#002D62]'
                          : 'bg-[#F6F6F3] dark:bg-slate-800 border-[#E3E9F1] dark:border-slate-700 hover:border-[#0066FF]'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-bold mb-2 opacity-70">
                        <span>Card {idx + 1} of {data.flashcards.length}</span>
                        <span>{isFlipped ? 'Answer / Rule' : 'Tap to Reveal'}</span>
                      </div>
                      <p className="text-base font-semibold leading-snug">
                        {isFlipped ? card.back : card.front}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: HIGH-YIELD EXAM QUESTIONS */}
          {activeTab === 'exam' && (
            <div className="space-y-4 animate-fade-in">
              {data.examQuestions.map((eq, idx) => (
                <div
                  key={idx}
                  className="p-5 rounded-2xl bg-white dark:bg-slate-800 border border-[#E3E9F1] dark:border-slate-700 shadow-xs space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-black flex items-center justify-center">
                      Q{idx + 1}
                    </span>
                    <h5 className="font-bold text-sm sm:text-base text-[#0F172A] dark:text-white">{eq.question}</h5>
                  </div>
                  <div className="p-3 rounded-xl bg-brand-50/60 dark:bg-brand-950/30 text-xs text-[#002D62] dark:text-brand-200 border border-brand-100 dark:border-brand-900/40">
                    <span className="font-bold">Marking Scheme: </span>
                    {eq.markingScheme}
                  </div>
                  <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5 font-medium">
                    <span>💡 <strong>Exam Tip:</strong></span>
                    <span>{eq.highYieldTip}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Footer: Save to Notebook CTA */}
        <footer className="p-5 border-t border-[#E3E9F1] dark:border-slate-800 bg-[#F6F6F3]/80 dark:bg-slate-900/80 flex items-center justify-between shrink-0">
          <span className="text-xs text-[#64748B] font-medium hidden sm:inline">
            Exported as rich markdown notebook
          </span>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#E3E9F1] dark:border-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 transition cursor-pointer"
            >
              Close
            </button>

            <button
              type="button"
              onClick={handleSaveToNotebook}
              disabled={isSaving || isSaved}
              className={`px-5 py-2.5 rounded-xl text-sm font-black text-white shadow-md transition-all flex items-center gap-2 cursor-pointer ${
                isSaved
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-[#002D62] hover:bg-[#001D42]'
              }`}
            >
              <i className={`bi ${isSaved ? 'bi-check-circle-fill' : isSaving ? 'bi-hourglass-split animate-spin' : 'bi-journal-bookmark-fill'}`}></i>
              <span>{isSaved ? 'Saved in My Notebooks' : isSaving ? 'Saving...' : 'Save to My Notebooks'}</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
