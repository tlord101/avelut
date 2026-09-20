import { MarkdownContent } from '../MarkdownContent';
import React, { useState, useEffect } from 'react';
import { createAvelutAI } from '../../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost } from '../../utils/usage';
import { useToast } from '../../hooks/useToast';
import type { UserProfile, AppSettings } from '../../types';
import type { FlashcardDeck } from '../../types/playground';
import {
  saveFlashcardDeck,
  getFlashcardDeckById,
  getSavedFlashcardDecks
} from '../../services/playgroundStorageService';

import { supabaseDataService } from '../../services/supabaseDataService';
import type { Course } from '../../types';

export interface FlashcardsNewProps {
  userProfile?: UserProfile;
  appSettings?: AppSettings;
  initialCourse?: string;
  onDeckCreated: (deckId: string) => void;
}

export const FlashcardsNew: React.FC<FlashcardsNewProps> = ({
  userProfile,
  appSettings,
  initialCourse,
  onDeckCreated
}) => {
  const { addToast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [courseTopicInput, setCourseTopicInput] = useState(initialCourse || '');
  const [flashcardCount, setFlashcardCount] = useState(15);
  const [flashcardDifficulty, setFlashcardDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    supabaseDataService.fetchCourses(userProfile?.department_id, userProfile?.level).then(dbCourses => {
      if (dbCourses) setCourses(dbCourses);
    });
  }, [userProfile?.department_id, userProfile?.level]);

  useEffect(() => {
    if (initialCourse) {
      setCourseTopicInput(initialCourse);
    }
  }, [initialCourse]);

  const handleGenerate = async () => {
    if (!courseTopicInput.trim()) {
      addToast('Please enter a course or topic name.', 'error');
      return;
    }
    if (!userProfile?.uid) {
      addToast('Please log in to generate flashcards.', 'error');
      return;
    }

    const cost = getFeatureCost('flashcard_generation', appSettings) || 2;
    const check = checkAICredits(userProfile, cost, appSettings);
    if (!check.allowed) {
      addToast(`You need at least ${cost} AI credits to generate flashcards.`, 'error');
      return;
    }

    setIsGenerating(true);
    try {
      const ai = createAvelutAI(appSettings, userProfile);
      const prompt = `Generate a high-quality study flashcard deck of ${flashcardCount} cards on the topic: "${courseTopicInput.trim()}". Difficulty: ${flashcardDifficulty}.
Return strictly valid JSON with no markdown block markers:
{
  "title": "${courseTopicInput.trim()} Flashcards",
  "cards": [
    {
      "front": "Question or term on front side (use KaTeX math $...$ if relevant)",
      "back": "Clear concise answer or explanation on back side"
    }
  ]
}`;

      const response = await ai.generateContent(prompt);
      let jsonStr = (response.text || '').trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

      const parsed = JSON.parse(jsonStr.trim());
      const newDeck: FlashcardDeck = {
        id: `fc_${Date.now()}`,
        title: parsed.title || `${courseTopicInput.trim()} Deck`,
        topicName: courseTopicInput.trim(),
        cards: (parsed.cards || []).map((c: any, i: number) => ({
          id: `card_${i}`,
          front: c.front || '',
          back: c.back || ''
        })),
        createdAt: Date.now()
      };

      await saveFlashcardDeck(userProfile.uid, newDeck);
      await deductAICredits(userProfile.uid, cost, 'Flashcards Generation', appSettings);
      addToast('Flashcard deck created!', 'success');
      onDeckCreated(newDeck.id);
    } catch (err: any) {
      console.error('Failed to generate flashcards:', err);
      addToast('Failed to generate flashcard deck. Please try again.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-2xl mx-auto w-full">
      <div className="bg-[#141414] border border-[#2A2A2A] rounded-2xl p-6 shadow-sm space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Generate Study Flashcards</h1>
          <p className="text-xs text-[#A3A3A3] mt-1">
            AI creates a complete set of front/back revision cards for your course.
          </p>
        </div>

        <div className="space-y-4">
          {courses.length > 0 && (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
                Select from Enrolled Courses
              </label>
              <select
                value={selectedCourseId}
                onChange={e => {
                  const cId = e.target.value;
                  setSelectedCourseId(cId);
                  const selected = courses.find(c => c.course_id === cId);
                  if (selected) {
                    setCourseTopicInput(`${selected.course_code}: ${selected.course_name}`);
                  }
                }}
                className="w-full px-4 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-white text-sm focus:outline-none focus:border-blue-500 mb-3"
              >
                <option value="">-- Choose an academic course --</option>
                {courses.map(c => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.course_code ? `${c.course_code} - ` : ''}{c.course_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
              Topic or Subject
            </label>
            <input
              type="text"
              placeholder="e.g. Differentiation & Integration"
              value={courseTopicInput}
              onChange={e => setCourseTopicInput(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-white placeholder-[#A3A3A3] text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
              Number of Cards: {flashcardCount}
            </label>
            <input
              type="range"
              min="5"
              max="30"
              step="5"
              value={flashcardCount}
              onChange={e => setFlashcardCount(Number(e.target.value))}
              className="w-full accent-[#2563EB]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#A3A3A3] mb-2">
              Difficulty Level
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(['easy', 'medium', 'hard'] as const).map(diff => (
                <button
                  key={diff}
                  type="button"
                  onClick={() => setFlashcardDifficulty(diff)}
                  className={`py-2.5 rounded-xl border text-xs font-bold uppercase tracking-wider capitalize transition ${
                    flashcardDifficulty === diff
                      ? 'bg-[#2563EB] border-[#2563EB] text-white'
                      : 'bg-[#1C1C1C] border-[#2A2A2A] text-[#A3A3A3] hover:bg-[#2A2A2A]'
                  }`}
                >
                  {diff}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          disabled={isGenerating}
          onClick={handleGenerate}
          className="w-full py-4 rounded-xl bg-[#2563EB] hover:bg-blue-600 disabled:opacity-50 text-white font-bold text-sm shadow-md transition active:scale-95 flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Generating Deck...</span>
            </>
          ) : (
            <span>Generate Flashcards</span>
          )}
        </button>
      </div>
    </div>
  );
};

export interface FlashcardsStudyProps {
  deckId: string;
  userProfile?: UserProfile;
}

export const FlashcardsStudy: React.FC<FlashcardsStudyProps> = ({ deckId, userProfile }) => {
  const { addToast } = useToast();
  const [activeDeck, setActiveDeck] = useState<FlashcardDeck | null>(null);
  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);

  useEffect(() => {
    if (userProfile?.uid) {
      getFlashcardDeckById(userProfile.uid, deckId).then(deck => {
        setActiveDeck(deck);
        setActiveCardIdx(0);
        setIsCardFlipped(false);
      });
    }
  }, [deckId, userProfile?.uid]);

  const renderMarkdownText = (text: string) => (
    <div className="dark min-w-0"><MarkdownContent content={text} className="[&>p]:my-0" /></div>
  );

  if (!activeDeck || !activeDeck.cards.length) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-neutral-400 dark:bg-[#0A0A0A]">
        Loading flashcard deck...
      </div>
    );
  }

  const currentCard = activeDeck.cards[activeCardIdx];

  return (
    <div className="flex-1 flex flex-col bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-white">{activeDeck.title}</h1>
          <p className="text-xs text-[#A3A3A3]">Card {activeCardIdx + 1} of {activeDeck.cards.length}</p>
        </div>
      </div>

      <div
        onClick={() => setIsCardFlipped(prev => !prev)}
        className="flex-1 min-h-[320px] bg-[#141414] border border-[#2A2A2A] rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer shadow-lg transition transform active:scale-98 select-none mb-6 relative group"
      >
        <span className="absolute top-4 right-4 text-[11px] font-bold uppercase tracking-widest text-[#A3A3A3] bg-[#1C1C1C] px-2.5 py-1 rounded-full border border-[#2A2A2A]">
          {isCardFlipped ? 'Back (Answer)' : 'Front (Question)'}
        </span>

        <div className="text-lg sm:text-xl text-white font-medium max-w-xl">
          {renderMarkdownText(isCardFlipped ? currentCard.back : currentCard.front)}
        </div>

        <span className="mt-8 text-xs text-[#A3A3A3] group-hover:text-white transition">
          Tap card to flip
        </span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <button
          disabled={activeCardIdx === 0}
          onClick={() => {
            setActiveCardIdx(prev => prev - 1);
            setIsCardFlipped(false);
          }}
          className="flex-1 py-3 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-sm font-bold text-white hover:bg-[#2A2A2A] disabled:opacity-40 transition"
        >
          Previous
        </button>
        <button
          disabled={activeCardIdx === activeDeck.cards.length - 1}
          onClick={() => {
            setActiveCardIdx(prev => prev + 1);
            setIsCardFlipped(false);
          }}
          className="flex-1 py-3 rounded-xl bg-[#2563EB] text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-40 transition shadow"
        >
          Next Card
        </button>
      </div>
    </div>
  );
};
