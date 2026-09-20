import { getLocalAppState, saveLocalAppState } from './chatStorageService';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type {
  PastQuestionPack,
  TheorySolution,
  FlashcardDeck,
  CBTExam,
  CBTAttempt
} from '../types/playground';

// --- PAST QUESTIONS STORAGE (100% DATABASE-DRIVEN) ---

export async function getPastQuestionPacks(): Promise<PastQuestionPack[]> {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('past_question_packs')
        .select('*')
        .eq('published', true)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map((row: any) => ({
          id: row.id,
          title: row.title,
          courseCode: row.course_code,
          courseName: row.course_name,
          year: row.year,
          type: row.type || 'mixed',
          questionCount: row.question_count || (Array.isArray(row.questions) ? row.questions.length : 0),
          questions: row.questions || []
        }));
      }
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase past question fetch warning:', err);
    }
  }

  const customPacks = await getLocalAppState<PastQuestionPack[]>('playground_past_packs', []);
  return customPacks || [];
}

export async function getPastQuestionPackById(packId: string): Promise<PastQuestionPack | null> {
  const packs = await getPastQuestionPacks();
  return packs.find(p => p.id === packId) || null;
}

// --- THEORY SOLUTIONS CACHE ---

export function getTheorySolutionCacheKey(packId: string, questionId: string): string {
  return `theory_sol_${packId}_${questionId}`.toLowerCase().replace(/\s+/g, '_');
}

export async function getCachedTheorySolution(packId: string, questionId: string): Promise<TheorySolution | null> {
  const compositeId = `${packId}::${questionId}`;
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('theory_solutions')
        .select('*')
        .eq('id', compositeId)
        .maybeSingle();

      if (!error && data?.solution_markdown) {
        return {
          packId: data.pack_id,
          questionId: data.question_id,
          solutionMarkdown: data.solution_markdown,
          createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now()
        };
      }
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase theory solution fetch warning:', err);
    }
  }

  const key = getTheorySolutionCacheKey(packId, questionId);
  return await getLocalAppState<TheorySolution | null>(key, null);
}

export async function saveTheorySolution(packId: string, questionId: string, solutionMarkdown: string): Promise<TheorySolution> {
  const compositeId = `${packId}::${questionId}`;
  const key = getTheorySolutionCacheKey(packId, questionId);
  const solutionObj: TheorySolution = {
    packId,
    questionId,
    solutionMarkdown,
    createdAt: Date.now()
  };

  if (isSupabaseConfigured) {
    try {
      void supabase.from('theory_solutions').upsert({
        id: compositeId,
        pack_id: packId,
        question_id: questionId,
        solution_markdown: solutionMarkdown,
      });
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase theory solution save warning:', err);
    }
  }

  await saveLocalAppState(key, 'system', 'theory_solution', solutionObj);
  return solutionObj;
}

// --- FLASHCARDS STORAGE ---

export async function getSavedFlashcardDecks(userId: string): Promise<FlashcardDeck[]> {
  if (!userId) return [];
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('user_flashcard_decks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map((row: any) => ({
          id: row.id,
          title: row.title,
          topicName: row.topic_name,
          cards: row.cards || [],
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        }));
      }
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase flashcard decks fetch warning:', err);
    }
  }

  const key = `playground_flashcards_${userId}`;
  return await getLocalAppState<FlashcardDeck[]>(key, []);
}

export async function saveFlashcardDeck(userId: string, deck: FlashcardDeck): Promise<void> {
  if (!userId) return;
  if (isSupabaseConfigured) {
    try {
      void supabase.from('user_flashcard_decks').upsert({
        id: deck.id,
        user_id: userId,
        title: deck.title,
        topic_name: deck.topicName,
        cards: deck.cards,
      });
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase flashcard deck save warning:', err);
    }
  }

  const key = `playground_flashcards_${userId}`;
  const existing = await getSavedFlashcardDecks(userId);
  const updated = [deck, ...existing.filter(d => d.id !== deck.id)];
  await saveLocalAppState(key, userId, 'flashcard_decks', updated);
}

export async function getFlashcardDeckById(userId: string, deckId: string): Promise<FlashcardDeck | null> {
  const decks = await getSavedFlashcardDecks(userId);
  return decks.find(d => d.id === deckId) || null;
}

// --- CBT EXAMS STORAGE ---

export async function getSavedCBTExams(userId: string): Promise<CBTExam[]> {
  if (!userId) return [];
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('user_cbt_exams')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map((row: any) => ({
          id: row.id,
          title: row.title,
          topicName: row.topic_name,
          durationMinutes: row.duration_minutes || 15,
          questions: row.questions || [],
          createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
        }));
      }
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase CBT exams fetch warning:', err);
    }
  }

  const key = `playground_cbt_exams_${userId}`;
  return await getLocalAppState<CBTExam[]>(key, []);
}

export async function saveCBTExam(userId: string, exam: CBTExam): Promise<void> {
  if (!userId) return;
  if (isSupabaseConfigured) {
    try {
      void supabase.from('user_cbt_exams').upsert({
        id: exam.id,
        user_id: userId,
        title: exam.title,
        topic_name: exam.topicName,
        duration_minutes: exam.durationMinutes,
        questions: exam.questions,
      });
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase CBT exam save warning:', err);
    }
  }

  const key = `playground_cbt_exams_${userId}`;
  const existing = await getSavedCBTExams(userId);
  const updated = [exam, ...existing.filter(e => e.id !== exam.id)];
  await saveLocalAppState(key, userId, 'cbt_exams', updated);
}

export async function getCBTExamById(userId: string, examId: string): Promise<CBTExam | null> {
  const exams = await getSavedCBTExams(userId);
  return exams.find(e => e.id === examId) || null;
}

// --- CBT ATTEMPTS STORAGE ---

export async function saveCBTAttempt(userId: string, attempt: CBTAttempt): Promise<void> {
  if (!userId) return;
  if (isSupabaseConfigured) {
    try {
      void supabase.from('user_cbt_attempts').upsert({
        id: attempt.id,
        user_id: userId,
        exam_id: attempt.examId,
        answers: attempt.answers,
        score: attempt.score,
        total_questions: attempt.totalQuestions,
        completed_at: attempt.completedAt,
      });
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase CBT attempt save warning:', err);
    }
  }

  const key = `playground_cbt_attempts_${userId}`;
  const existing = await getLocalAppState<CBTAttempt[]>(key, []);
  const updated = [attempt, ...existing.filter(a => a.id !== attempt.id)];
  await saveLocalAppState(key, userId, 'cbt_attempts', updated);
}

export async function getCBTAttempts(userId: string, examId?: string): Promise<CBTAttempt[]> {
  if (!userId) return [];
  if (isSupabaseConfigured) {
    try {
      let query = supabase
        .from('user_cbt_attempts')
        .select('*')
        .eq('user_id', userId);

      if (examId) {
        query = query.eq('exam_id', examId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map((row: any) => ({
          id: row.id,
          examId: row.exam_id,
          answers: row.answers || {},
          score: row.score || 0,
          totalQuestions: row.total_questions || 0,
          completedAt: row.completed_at ? Number(row.completed_at) : Date.now()
        }));
      }
    } catch (err) {
      console.warn('[PlaygroundStorage] Supabase CBT attempts fetch warning:', err);
    }
  }

  const key = `playground_cbt_attempts_${userId}`;
  const attempts = await getLocalAppState<CBTAttempt[]>(key, []);
  if (examId) {
    return attempts.filter(a => a.examId === examId);
  }
  return attempts;
}
