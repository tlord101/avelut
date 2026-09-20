import React, { useState, useEffect, useMemo } from 'react';
import type { UserProfile, Course } from '../../types';
import type { PastQuestionPack, FlashcardDeck, CBTExam } from '../../types/playground';
import {
  getPastQuestionPacks,
  getSavedFlashcardDecks,
  getSavedCBTExams
} from '../../services/playgroundStorageService';
import { supabaseDataService } from '../../services/supabaseDataService';
import { PlaygroundCardSkeleton } from '../Skeleton';

export interface PlaygroundHomeProps {
  userProfile?: UserProfile;
  onNavigateView: (view: any) => void;
}

export const PlaygroundHome: React.FC<PlaygroundHomeProps> = ({ userProfile, onNavigateView }) => {
  const [pastPacks, setPastPacks] = useState<PastQuestionPack[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeHomeTab, setActiveHomeTab] = useState<'past' | 'flashcards' | 'cbt'>('past');
  const [savedDecks, setSavedDecks] = useState<FlashcardDeck[]>([]);
  const [savedExams, setSavedExams] = useState<CBTExam[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      try {
        const [packs, decks, exams, dbCourses] = await Promise.all([
          getPastQuestionPacks(),
          userProfile?.uid ? getSavedFlashcardDecks(userProfile.uid) : Promise.resolve([]),
          userProfile?.uid ? getSavedCBTExams(userProfile.uid) : Promise.resolve([]),
          supabaseDataService.fetchCourses(userProfile?.department_id, userProfile?.level)
        ]);
        setPastPacks(packs);
        setSavedDecks(decks);
        setSavedExams(exams);
        setCourses(dbCourses || []);
      } catch (err) {
        console.error('PlaygroundHome error fetching data:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAllData();
  }, [userProfile?.uid, userProfile?.department_id, userProfile?.level]);

  const filteredPacks = useMemo(() => {
    if (!searchQuery.trim()) return pastPacks;
    const q = searchQuery.toLowerCase();
    return pastPacks.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.courseCode && p.courseCode.toLowerCase().includes(q)) ||
      (p.courseName && p.courseName.toLowerCase().includes(q))
    );
  }, [pastPacks, searchQuery]);

  return (
    <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8">
      {/* Top Half: Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Flashcards Generator Card */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 sm:p-7 flex flex-col justify-between hover:border-[#3A3A3A] transition shadow-md group">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-[#1C1C1C] border border-[#2A2A2A] flex items-center justify-center text-white mb-4 group-hover:scale-105 transition">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white">Generate Flashcards</h2>
            <p className="text-xs sm:text-sm text-[#A3A3A3] mt-2 leading-relaxed">
              Create AI study decks for any course or topic. Save cards locally on device and study offline anytime.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#1C1C1C] flex items-center justify-between">
            <span className="text-xs font-medium text-[#A3A3A3]">Interactive Study Cards</span>
            <button
              onClick={() => onNavigateView({ type: 'flashcards_new' })}
              className="px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white text-xs font-bold tracking-wide uppercase transition shadow active:scale-95"
            >
              Generate Flashcards
            </button>
          </div>
        </div>

        {/* CBT Generator Card */}
        <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 sm:p-7 flex flex-col justify-between hover:border-[#3A3A3A] transition shadow-md group">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-[#1C1C1C] border border-[#2A2A2A] flex items-center justify-center text-white mb-4 group-hover:scale-105 transition">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-white">Generate CBT Exam</h2>
            <p className="text-xs sm:text-sm text-[#A3A3A3] mt-2 leading-relaxed">
              Practice timed multiple choice exams. Instant grading with green/red answer reviews and explanations.
            </p>
          </div>
          <div className="mt-6 pt-4 border-t border-[#1C1C1C] flex items-center justify-between">
            <span className="text-xs font-medium text-[#A3A3A3]">Computer-Based Tests</span>
            <button
              onClick={() => onNavigateView({ type: 'cbt_new' })}
              className="px-4 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white text-xs font-bold tracking-wide uppercase transition shadow active:scale-95"
            >
              Generate CBT
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Half: Past Questions & Saved Material Navigation */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#2A2A2A] pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveHomeTab('past')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeHomeTab === 'past'
                  ? 'bg-[#1C1C1C] text-white border border-[#2A2A2A]'
                  : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              Past Questions Catalog
            </button>
            <button
              onClick={() => setActiveHomeTab('flashcards')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeHomeTab === 'flashcards'
                  ? 'bg-[#1C1C1C] text-white border border-[#2A2A2A]'
                  : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              Saved Flashcards ({savedDecks.length})
            </button>
            <button
              onClick={() => setActiveHomeTab('cbt')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${
                activeHomeTab === 'cbt'
                  ? 'bg-[#1C1C1C] text-white border border-[#2A2A2A]'
                  : 'text-[#A3A3A3] hover:text-white'
              }`}
            >
              Saved CBT Exams ({savedExams.length})
            </button>
          </div>

          {activeHomeTab === 'past' && (
            <div className="w-full sm:w-64 relative">
              <input
                type="text"
                placeholder="Search course code or title..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#141414] border border-[#2A2A2A] text-xs text-white placeholder-[#A3A3A3] focus:outline-none focus:border-blue-500"
              />
              <svg className="w-4 h-4 text-[#A3A3A3] absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          )}
        </div>

        {/* TAB 1: PAST QUESTIONS / DATABASE COURSES */}
        {activeHomeTab === 'past' && (
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => <PlaygroundCardSkeleton key={i} />)}
              </div>
            ) : filteredPacks.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPacks.map(pack => (
                  <div
                    key={pack.id}
                    onClick={() => onNavigateView({ type: 'past_viewer', packId: pack.id })}
                    className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 hover:border-[#3A3A3A] transition cursor-pointer flex flex-col justify-between group shadow-sm active:scale-95"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#1C1C1C] border border-[#2A2A2A] text-blue-400">
                          {pack.courseCode || 'PAST Q'}
                        </span>
                        <span className="text-xs text-[#A3A3A3] font-medium">Year {pack.year || '2023'}</span>
                      </div>
                      <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition leading-snug">
                        {pack.title}
                      </h3>
                    </div>

                    <div className="mt-5 pt-3 border-t border-[#1C1C1C] flex items-center justify-between text-xs text-[#A3A3A3]">
                      <span className="capitalize">{pack.type} Format</span>
                      <span className="font-semibold text-white">{pack.questionCount} Questions</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 sm:p-8 text-center max-w-2xl mx-auto">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">Academic Courses Catalog</h3>
                  <p className="text-xs sm:text-sm text-[#A3A3A3] mb-4 leading-relaxed">
                    Official faculty past exam papers will appear here once published. You can generate instant CBT Practice Tests or Flashcards directly from your registered courses below.
                  </p>
                </div>

                {courses.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-3">
                      Enrolled Department Courses ({courses.length})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {courses.map(c => (
                        <div key={c.course_id} className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 hover:border-[#3A3A3A] transition flex flex-col justify-between group shadow-sm">
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-3">
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#1C1C1C] border border-[#2A2A2A] text-blue-400">
                                {c.course_code || 'COURSE'}
                              </span>
                              <span className="text-xs text-[#A3A3A3] font-medium">{c.level}</span>
                            </div>
                            <h3 className="text-base font-bold text-white group-hover:text-blue-400 transition leading-snug">
                              {c.course_name}
                            </h3>
                            <p className="text-xs text-[#A3A3A3] mt-2 line-clamp-2">
                              {c.description || `${c.topics?.length || 0} syllabus topics`}
                            </p>
                          </div>
                          <div className="mt-5 pt-3 border-t border-[#1C1C1C] flex items-center gap-2">
                            <button
                              onClick={() => onNavigateView({ type: 'cbt_new', initialCourse: c.course_name })}
                              className="flex-1 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 active:scale-95 text-white text-xs font-bold transition text-center shadow"
                            >
                              Practice CBT
                            </button>
                            <button
                              onClick={() => onNavigateView({ type: 'flashcards_new', initialCourse: c.course_name })}
                              className="flex-1 py-2.5 rounded-xl bg-[#1C1C1C] hover:bg-[#252525] border border-[#2A2A2A] active:scale-95 text-white text-xs font-bold transition text-center"
                            >
                              Flashcards
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SAVED FLASHCARDS DECKS */}
        {activeHomeTab === 'flashcards' && (
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => <PlaygroundCardSkeleton key={i} />)}
              </div>
            ) : savedDecks.length === 0 ? (
              <div className="py-12 text-center bg-[#141414] border border-[#2A2A2A] rounded-2xl">
                <p className="text-sm text-[#A3A3A3] mb-3">No saved flashcard decks found.</p>
                <button
                  onClick={() => onNavigateView({ type: 'flashcards_new' })}
                  className="px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-bold"
                >
                  Generate Your First Deck
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedDecks.map(deck => (
                  <div
                    key={deck.id}
                    onClick={() => onNavigateView({ type: 'flashcards_study', deckId: deck.id })}
                    className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 hover:border-[#3A3A3A] transition cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase text-blue-400 bg-[#1C1C1C] px-2.5 py-1 rounded-full border border-[#2A2A2A]">
                        Flashcards
                      </span>
                      <h3 className="text-base font-bold text-white mt-3 group-hover:text-blue-400 transition">
                        {deck.title}
                      </h3>
                    </div>
                    <div className="mt-4 pt-3 border-t border-[#1C1C1C] text-xs text-[#A3A3A3] flex justify-between">
                      <span>{deck.cards.length} Cards</span>
                      <span>{new Date(deck.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SAVED CBT EXAMS */}
        {activeHomeTab === 'cbt' && (
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => <PlaygroundCardSkeleton key={i} />)}
              </div>
            ) : savedExams.length === 0 ? (
              <div className="py-12 text-center bg-[#141414] border border-[#2A2A2A] rounded-2xl">
                <p className="text-sm text-[#A3A3A3] mb-3">No saved CBT practice exams found.</p>
                <button
                  onClick={() => onNavigateView({ type: 'cbt_new' })}
                  className="px-4 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-bold"
                >
                  Generate CBT Exam
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedExams.map(exam => (
                  <div
                    key={exam.id}
                    onClick={() => onNavigateView({ type: 'cbt_exam', examId: exam.id })}
                    className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-5 hover:border-[#3A3A3A] transition cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase text-blue-400 bg-[#1C1C1C] px-2.5 py-1 rounded-full border border-[#2A2A2A]">
                        CBT Exam
                      </span>
                      <h3 className="text-base font-bold text-white mt-3 group-hover:text-blue-400 transition">
                        {exam.title}
                      </h3>
                    </div>
                    <div className="mt-4 pt-3 border-t border-[#1C1C1C] text-xs text-[#A3A3A3] flex justify-between">
                      <span>{exam.questions.length} Questions</span>
                      <span>{exam.durationMinutes > 0 ? `${exam.durationMinutes} Mins` : 'Untimed'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
