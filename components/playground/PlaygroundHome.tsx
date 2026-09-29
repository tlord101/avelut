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

// Deterministic cover image picker based on course title/code
const COVER_IMAGES = [
  'https://images.unsplash.com/photo-1664447972779-316251bd8bd9?q=80&w=800&auto=format&fit=crop', // engineering
  'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?q=80&w=800&auto=format&fit=crop', // circuits
  'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?q=80&w=800&auto=format&fit=crop', // math/physics
  'https://images.unsplash.com/photo-1568992687947-868a62a9f521?q=80&w=800&auto=format&fit=crop', // chemistry
  'https://images.unsplash.com/photo-1532094349884-543559c7b7f0?q=80&w=800&auto=format&fit=crop', // lab
  'https://images.unsplash.com/photo-1509228468518-180dd4864904?q=80&w=800&auto=format&fit=crop', // graphs
  'https://images.unsplash.com/photo-1551033406-611cf9a28f67?q=80&w=800&auto=format&fit=crop', // code
  'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?q=80&w=800&auto=format&fit=crop', // study
];

function pickCover(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return COVER_IMAGES[Math.abs(hash) % COVER_IMAGES.length];
}

// ── Premium Past-Q Card ──────────────────────────────────────────────────────
const PremiumPastQCard: React.FC<{
  pack: PastQuestionPack;
  onClick: () => void;
}> = ({ pack, onClick }) => {
  const cover = pickCover(pack.id + pack.title);
  return (
    <div
      onClick={onClick}
      className="group relative w-full rounded-3xl bg-[#111113] border border-white/5 overflow-hidden cursor-pointer transition-all duration-300 hover:border-blue-500/30 hover:shadow-[0_8px_30px_rgba(0,0,0,0.6)] active:scale-[0.98]"
    >
      {/* Image preview with gradient fade */}
      <div className="relative h-36 w-full overflow-hidden bg-zinc-900">
        <img
          src={cover}
          alt={pack.title}
          className="w-full h-full object-cover opacity-70 transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111113] via-[#111113]/50 to-transparent" />

        {/* Glassmorphism top badges */}
        <div className="absolute top-3 left-3 flex gap-2">
          <span className="px-2.5 py-1 text-[10px] uppercase font-black tracking-wider text-blue-300 bg-blue-900/50 backdrop-blur-md rounded-full border border-blue-400/20">
            {pack.courseCode || 'Past Q'}
          </span>
        </div>
        <div className="absolute top-3 right-3">
          <span className="px-2.5 py-1 text-[11px] font-semibold text-zinc-300 bg-black/50 backdrop-blur-md rounded-full border border-white/10">
            {pack.year || '2026'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 pt-2">
        <h3 className="text-sm font-bold text-white mb-1 leading-tight line-clamp-2 group-hover:text-blue-300 transition-colors">
          {pack.title}
        </h3>
        {pack.courseName && (
          <p className="text-[11px] text-zinc-500 mb-3 line-clamp-1">{pack.courseName}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider font-semibold capitalize">
              {pack.type || 'Theory'} Format
            </span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs font-semibold text-zinc-300">{pack.questionCount} Questions</span>
            </div>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="relative overflow-hidden px-4 py-2 rounded-2xl bg-blue-600 text-white font-bold text-xs transition-all duration-200 hover:bg-blue-500 hover:shadow-[0_0_18px_rgba(37,99,235,0.45)] active:scale-95 flex items-center gap-1.5"
          >
            <span>Generate CBT</span>
            <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Premium Flashcard Deck Card ───────────────────────────────────────────────
const PremiumFlashcardCard: React.FC<{
  deck: FlashcardDeck;
  onClick: () => void;
}> = ({ deck, onClick }) => {
  const cover = pickCover(deck.id + deck.title);
  return (
    <div
      onClick={onClick}
      className="group relative w-full rounded-3xl bg-[#111113] border border-white/5 overflow-hidden cursor-pointer transition-all duration-300 hover:border-purple-500/30 hover:shadow-[0_8px_30px_rgba(0,0,0,0.6)] active:scale-[0.98]"
    >
      <div className="relative h-32 w-full overflow-hidden bg-zinc-900">
        <img
          src={cover}
          alt={deck.title}
          className="w-full h-full object-cover opacity-60 transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111113] via-[#111113]/50 to-transparent" />
        <div className="absolute top-3 left-3">
          <span className="px-2.5 py-1 text-[10px] uppercase font-black tracking-wider text-purple-300 bg-purple-900/50 backdrop-blur-md rounded-full border border-purple-400/20">
            Flashcards
          </span>
        </div>
      </div>

      <div className="px-4 pb-4 pt-2">
        <h3 className="text-sm font-bold text-white mb-3 leading-tight line-clamp-2 group-hover:text-purple-300 transition-colors">
          {deck.title}
        </h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            <span className="text-xs font-semibold text-zinc-300">{deck.cards.length} Cards</span>
          </div>
          <span className="text-[10px] text-zinc-600">{new Date(deck.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
};

// ── Premium CBT Exam Card ─────────────────────────────────────────────────────
const PremiumCBTCard: React.FC<{
  exam: CBTExam;
  onClick: () => void;
}> = ({ exam, onClick }) => {
  const cover = pickCover(exam.id + exam.title);
  return (
    <div
      onClick={onClick}
      className="group relative w-full rounded-3xl bg-[#111113] border border-white/5 overflow-hidden cursor-pointer transition-all duration-300 hover:border-emerald-500/30 hover:shadow-[0_8px_30px_rgba(0,0,0,0.6)] active:scale-[0.98]"
    >
      <div className="relative h-32 w-full overflow-hidden bg-zinc-900">
        <img
          src={cover}
          alt={exam.title}
          className="w-full h-full object-cover opacity-60 transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111113] via-[#111113]/50 to-transparent" />
        <div className="absolute top-3 left-3">
          <span className="px-2.5 py-1 text-[10px] uppercase font-black tracking-wider text-emerald-300 bg-emerald-900/50 backdrop-blur-md rounded-full border border-emerald-400/20">
            CBT Exam
          </span>
        </div>
      </div>

      <div className="px-4 pb-4 pt-2">
        <h3 className="text-sm font-bold text-white mb-3 leading-tight line-clamp-2 group-hover:text-emerald-300 transition-colors">
          {exam.title}
        </h3>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-zinc-300">{exam.questions.length} Questions</span>
          </div>
          <span className="text-[10px] text-zinc-600">
            {exam.durationMinutes > 0 ? `${exam.durationMinutes} mins` : 'Untimed'}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Quick Action Cards (top section) ─────────────────────────────────────────
const QuickActionCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  meta: string;
  actionLabel: string;
  accentClass: string;
  glowClass: string;
  onClick: () => void;
}> = ({ icon, title, description, meta, actionLabel, accentClass, glowClass, onClick }) => (
  <div className={`relative rounded-3xl bg-[#111113] border border-white/5 overflow-hidden transition-all duration-300 hover:border-white/10 hover:shadow-[0_8px_30px_rgba(0,0,0,0.5)] group`}>
    {/* Subtle top accent glow */}
    <div className={`absolute top-0 left-0 right-0 h-px ${accentClass} opacity-60`} />
    <div className="p-5 sm:p-6 flex flex-col justify-between min-h-[160px]">
      <div>
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center mb-4 ${glowClass} group-hover:scale-105 transition-transform`}>
          {icon}
        </div>
        <h2 className="text-base sm:text-lg font-extrabold text-white mb-1.5">{title}</h2>
        <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed line-clamp-2">{description}</p>
      </div>
      <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/5">
        <span className="text-[11px] font-semibold text-zinc-500">{meta}</span>
        <button
          onClick={onClick}
          className={`px-4 py-2.5 rounded-2xl text-white text-xs font-bold tracking-wide uppercase transition-all duration-200 active:scale-95 shadow-md ${accentClass} hover:shadow-lg hover:opacity-90`}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────
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

  const TAB_ITEMS: { key: 'past' | 'flashcards' | 'cbt'; label: string; count?: number }[] = [
    { key: 'past', label: 'Past Questions Catalog' },
    { key: 'flashcards', label: 'Saved Flashcards', count: savedDecks.length },
    { key: 'cbt', label: 'Saved CBT Exams', count: savedExams.length },
  ];

  return (
    <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8">

      {/* ── Quick Action Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
        <QuickActionCard
          icon={
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          }
          title="Generate Flashcards"
          description="Create AI study decks for any course or topic. Save cards locally on device and study offline anytime."
          meta="Interactive Study Cards"
          actionLabel="Generate Flashcards"
          accentClass="bg-blue-600"
          glowClass="bg-blue-500/10 border border-blue-500/20"
          onClick={() => onNavigateView({ type: 'flashcards_new' })}
        />

        <QuickActionCard
          icon={
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          title="Generate CBT Exam"
          description="Practice timed multiple choice exams. Instant grading with green/red answer reviews and explanations."
          meta="Computer-Based Tests"
          actionLabel="Generate CBT"
          accentClass="bg-blue-600"
          glowClass="bg-blue-500/10 border border-blue-500/20"
          onClick={() => onNavigateView({ type: 'cbt_new' })}
        />
      </div>

      {/* ── Tab Navigation + Catalog ── */}
      <div className="space-y-5">
        {/* Tab bar + Search row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TAB_ITEMS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveHomeTab(tab.key)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 ${
                  activeHomeTab === tab.key
                    ? 'bg-[#1C1C1C] text-white border border-white/10 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                    activeHomeTab === tab.key ? 'bg-blue-600/20 text-blue-400' : 'bg-white/5 text-zinc-600'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {activeHomeTab === 'past' && (
            <div className="w-full sm:w-60 relative flex-shrink-0">
              <input
                type="text"
                placeholder="Search course code or title..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#141414] border border-white/5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50 transition"
              />
              <svg className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          )}
        </div>

        {/* ── TAB 1: PAST QUESTIONS ── */}
        {activeHomeTab === 'past' && (
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => <PlaygroundCardSkeleton key={i} />)}
              </div>
            ) : filteredPacks.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPacks.map(pack => (
                  <PremiumPastQCard
                    key={pack.id}
                    pack={pack}
                    onClick={() => onNavigateView({ type: 'past_viewer', packId: pack.id })}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl bg-[#111113] border border-white/5 p-8 text-center max-w-2xl mx-auto">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-white mb-2">Academic Courses Catalog</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Official faculty past exam papers will appear here once published. You can generate instant CBT Practice Tests or Flashcards directly from your registered courses.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: SAVED FLASHCARD DECKS ── */}
        {activeHomeTab === 'flashcards' && (
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => <PlaygroundCardSkeleton key={i} />)}
              </div>
            ) : savedDecks.length === 0 ? (
              <div className="rounded-3xl bg-[#111113] border border-white/5 p-10 text-center">
                <p className="text-sm text-zinc-500 mb-4">No saved flashcard decks found.</p>
                <button
                  onClick={() => onNavigateView({ type: 'flashcards_new' })}
                  className="px-5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition active:scale-95"
                >
                  Generate Your First Deck
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedDecks.map(deck => (
                  <PremiumFlashcardCard
                    key={deck.id}
                    deck={deck}
                    onClick={() => onNavigateView({ type: 'flashcards_study', deckId: deck.id })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: SAVED CBT EXAMS ── */}
        {activeHomeTab === 'cbt' && (
          <div>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => <PlaygroundCardSkeleton key={i} />)}
              </div>
            ) : savedExams.length === 0 ? (
              <div className="rounded-3xl bg-[#111113] border border-white/5 p-10 text-center">
                <p className="text-sm text-zinc-500 mb-4">No saved CBT practice exams found.</p>
                <button
                  onClick={() => onNavigateView({ type: 'cbt_new' })}
                  className="px-5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition active:scale-95"
                >
                  Generate CBT Exam
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedExams.map(exam => (
                  <PremiumCBTCard
                    key={exam.id}
                    exam={exam}
                    onClick={() => onNavigateView({ type: 'cbt_exam', examId: exam.id })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
