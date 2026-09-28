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

/** Normalize admin-saved question shapes into playground PastQuestion */
function normalizeQuestion(raw: any, index: number): any {
  if (!raw || typeof raw !== 'object') return null;
  const prompt = String(raw.prompt || raw.question || raw.text || '').trim();
  if (!prompt) return null;

  const rawType = String(raw.type || '').toLowerCase();
  const optionsIn = Array.isArray(raw.options) ? raw.options : [];
  const optionObjects = optionsIn.map((o: any, i: number) => {
    if (o && typeof o === 'object' && (o.text || o.label)) {
      return {
        id: String(o.id || `opt_${i}`),
        text: String(o.text || o.label || ''),
        isCorrect: !!o.isCorrect,
      };
    }
    const text = String(o ?? '');
    const correct = String(raw.correctAnswer || '');
    return {
      id: `opt_${i}`,
      text,
      isCorrect: !!correct && (text === correct || text.includes(correct) || correct.includes(text)),
    };
  }).filter((o: any) => o.text.trim().length > 0);

  const isMcq = rawType === 'mcq' || optionObjects.length >= 2;
  return {
    id: String(raw.id || `q_${index}`),
    type: isMcq ? 'mcq' : 'theory',
    prompt,
    options: isMcq ? optionObjects : undefined,
    explanation: raw.explanation ? String(raw.explanation) : undefined,
    marks: raw.marks ?? undefined,
  };
}

function rowToPack(row: any): PastQuestionPack | null {
  if (!row) return null;
  const rawQuestions = row.questions || row.questions_json || [];
  const list = Array.isArray(rawQuestions) ? rawQuestions : [];
  const questions = list.map(normalizeQuestion).filter(Boolean);
  if (questions.length === 0 && !row.title && !row.course_name) return null;

  const yearVal = row.year;
  const yearNum = yearVal === null || yearVal === undefined || yearVal === ''
    ? undefined
    : (typeof yearVal === 'number' ? yearVal : parseInt(String(yearVal).replace(/\D/g, '').slice(0, 4), 10) || undefined);

  const types = new Set(questions.map((q: any) => q.type));
  let packType: 'mcq' | 'theory' | 'mixed' = 'mixed';
  if (types.size === 1) packType = types.has('mcq') ? 'mcq' : 'theory';
  else if (types.size === 0) packType = (row.type as any) || 'mixed';

  const courseName = row.course_name || row.courseName || row.course_id || '';
  const courseCode = row.course_code || row.courseCode || '';
  const title = row.title || [courseCode, courseName, row.year].filter(Boolean).join(' — ') || row.id;

  return {
    id: String(row.id),
    title: String(title),
    courseId: row.course_id || row.courseId,
    courseCode: courseCode ? String(courseCode) : undefined,
    courseName: courseName ? String(courseName) : undefined,
    year: yearNum,
    type: packType,
    questionCount: row.question_count || questions.length,
    questions,
  };
}

export async function getPastQuestionPacks(): Promise<PastQuestionPack[]> {
  const packsById = new Map<string, PastQuestionPack>();

  if (isSupabaseConfigured) {
    // 1) Official playground catalog
    try {
      const { data, error } = await supabase
        .from('past_question_packs')
        .select('*')
        .eq('published', true)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        for (const row of data) {
          const pack = rowToPack(row);
          if (pack) packsById.set(pack.id, pack);
        }
      }
    } catch (err) {
      console.warn('[PlaygroundStorage] past_question_packs fetch warning:', err);
    }

    // 2) Admin-uploaded rows in past_questions (extraction / manual entry)
    try {
      const { data, error } = await supabase
        .from('past_questions')
        .select('*')
        .order('updated_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        for (const row of data) {
          const pack = rowToPack({
            ...row,
            title: row.title || [row.course_id, row.year].filter(Boolean).join(' — '),
            course_name: row.course_name || row.course_id,
            questions: row.questions_json || row.questions,
          });
          if (pack && !packsById.has(pack.id)) {
            packsById.set(pack.id, pack);
          }
        }
      }
    } catch (err) {
      console.warn('[PlaygroundStorage] past_questions fetch warning:', err);
    }
  }

  if (packsById.size > 0) {
    return Array.from(packsById.values());
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
