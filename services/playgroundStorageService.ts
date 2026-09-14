import { getLocalAppState, saveLocalAppState } from './chatStorageService';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type {
  PastQuestionPack,
  TheorySolution,
  FlashcardDeck,
  CBTExam,
  CBTAttempt
} from '../types/playground';

/**
 * Initial seed catalog of past question packs.
 */
export const SEED_PAST_QUESTION_PACKS: PastQuestionPack[] = [
  {
    id: 'pq_mth101_2023',
    title: 'MTH 101: Elementary Mathematics I (2023)',
    courseId: 'mth101',
    courseCode: 'MTH 101',
    courseName: 'Elementary Mathematics I',
    year: 2023,
    type: 'mixed',
    questionCount: 6,
    questions: [
      {
        id: 'q1',
        type: 'mcq',
        prompt: 'Evaluate the derivative of $f(x) = x^3 - 4x^2 + 7x - 5$ at $x = 2$.',
        options: [
          { id: 'a', text: '$1$', isCorrect: true },
          { id: 'b', text: '$3$', isCorrect: false },
          { id: 'c', text: '$-1$', isCorrect: false },
          { id: 'd', text: '$5$', isCorrect: false }
        ],
        explanation: '$f\'(x) = 3x^2 - 8x + 7$. Substituting $x=2$: $3(4) - 8(2) + 7 = 12 - 16 + 7 = 1$.'
      },
      {
        id: 'q2',
        type: 'mcq',
        prompt: 'Find the limit: $\\lim_{x \\to 0} \\frac{\\sin(3x)}{x}$.',
        options: [
          { id: 'a', text: '$0$', isCorrect: false },
          { id: 'b', text: '$1$', isCorrect: false },
          { id: 'c', text: '$3$', isCorrect: true },
          { id: 'd', text: 'Does not exist', isCorrect: false }
        ],
        explanation: 'Using standard limit $\\lim_{u \\to 0} \\frac{\\sin(u)}{u} = 1$, we get $\\lim_{x \\to 0} \\frac{3\\sin(3x)}{3x} = 3(1) = 3$.'
      },
      {
        id: 'q3',
        type: 'theory',
        prompt: 'Prove using the definition of derivative that $\\frac{d}{dx}(x^2) = 2x$. Calculate the area under $y = x^2$ from $x = 0$ to $x = 3$.'
      },
      {
        id: 'q4',
        type: 'mcq',
        prompt: 'Solve the equation $2^{2x} - 5(2^x) + 4 = 0$.',
        options: [
          { id: 'a', text: '$x = 0, 2$', isCorrect: true },
          { id: 'b', text: '$x = 1, 4$', isCorrect: false },
          { id: 'c', text: '$x = -1, 2$', isCorrect: false },
          { id: 'd', text: '$x = 0, 1$', isCorrect: false }
        ],
        explanation: 'Let $y = 2^x$. Then $y^2 - 5y + 4 = 0 \\implies (y-1)(y-4) = 0 \\implies y = 1$ or $y = 4$. So $2^x = 1 \\implies x = 0$ and $2^x = 4 \\implies x = 2$.'
      },
      {
        id: 'q5',
        type: 'theory',
        prompt: 'Evaluate the definite integral $\\int_{0}^{\\pi/2} x \\cos(x) \\, dx$ using integration by parts.'
      },
      {
        id: 'q6',
        type: 'mcq',
        prompt: 'If $z = 3 + 4i$, what is the modulus $|z|$?',
        options: [
          { id: 'a', text: '$7$', isCorrect: false },
          { id: 'b', text: '$5$', isCorrect: true },
          { id: 'c', text: '$\\sqrt{7}$', isCorrect: false },
          { id: 'd', text: '$25$', isCorrect: false }
        ],
        explanation: '$|z| = \\sqrt{3^2 + 4^2} = \\sqrt{9 + 16} = 5$.'
      }
    ]
  },
  {
    id: 'pq_phy101_2023',
    title: 'PHY 101: General Physics I (2023)',
    courseId: 'phy101',
    courseCode: 'PHY 101',
    courseName: 'General Physics I',
    year: 2023,
    type: 'mixed',
    questionCount: 4,
    questions: [
      {
        id: 'q1',
        type: 'mcq',
        prompt: 'A body of mass $m = 2\\text{ kg}$ is thrown vertically upwards with initial speed $v_0 = 20\\text{ m/s}$. Taking $g = 9.8\\text{ m/s}^2$, find its maximum height $h$.',
        options: [
          { id: 'a', text: '$20.4\\text{ m}$', isCorrect: true },
          { id: 'b', text: '$40.8\\text{ m}$', isCorrect: false },
          { id: 'c', text: '$10.2\\text{ m}$', isCorrect: false },
          { id: 'd', text: '$15.0\\text{ m}$', isCorrect: false }
        ],
        explanation: '$v^2 = v_0^2 - 2gh \\implies 0 = 400 - 2(9.8)h \\implies h = \\frac{400}{19.6} \\approx 20.41\\text{ m}$.'
      },
      {
        id: 'q2',
        type: 'theory',
        prompt: 'State Newton\'s Second Law of Motion. Derive the expression for the terminal velocity $v_t$ of a spherical particle of mass $m$ and radius $r$ falling in a viscous fluid of viscosity $\\eta$.'
      },
      {
        id: 'q3',
        type: 'mcq',
        prompt: 'What is the work done when a force $\\vec{F} = 3\\hat{i} + 4\\hat{j}\\text{ N}$ displaces an object through $\\vec{d} = 2\\hat{i} - 1\\hat{j}\\text{ m}$?',
        options: [
          { id: 'a', text: '$2\\text{ J}$', isCorrect: true },
          { id: 'b', text: '$10\\text{ J}$', isCorrect: false },
          { id: 'c', text: '$6\\text{ J}$', isCorrect: false },
          { id: 'd', text: '$-2\\text{ J}$', isCorrect: false }
        ],
        explanation: '$W = \\vec{F} \\cdot \\vec{d} = (3)(2) + (4)(-1) = 6 - 4 = 2\\text{ J}$.'
      },
      {
        id: 'q4',
        type: 'theory',
        prompt: 'A uniform rod of length $L$ and mass $M$ pivots about one end. Show that its moment of inertia about this axis is $I = \\frac{1}{3} M L^2$.'
      }
    ]
  },
  {
    id: 'pq_csc101_2022',
    title: 'CSC 101: Introduction to Computer Science (2022)',
    courseId: 'csc101',
    courseCode: 'CSC 101',
    courseName: 'Intro to Computer Science',
    year: 2022,
    type: 'mixed',
    questionCount: 4,
    questions: [
      {
        id: 'q1',
        type: 'mcq',
        prompt: 'Convert the binary number $(110101)_2$ to base 10.',
        options: [
          { id: 'a', text: '$53$', isCorrect: true },
          { id: 'b', text: '$45$', isCorrect: false },
          { id: 'c', text: '$55$', isCorrect: false },
          { id: 'd', text: '$49$', isCorrect: false }
        ],
        explanation: '$32 + 16 + 0 + 4 + 0 + 1 = 53$.'
      },
      {
        id: 'q2',
        type: 'theory',
        prompt: 'Write an algorithm and draw a flowchart to find the roots of a quadratic equation $ax^2 + bx + c = 0$.'
      },
      {
        id: 'q3',
        type: 'mcq',
        prompt: 'Which data structure follows the First-In, First-Out (FIFO) principle?',
        options: [
          { id: 'a', text: 'Stack', isCorrect: false },
          { id: 'b', text: 'Queue', isCorrect: true },
          { id: 'c', text: 'Tree', isCorrect: false },
          { id: 'd', text: 'Graph', isCorrect: false }
        ],
        explanation: 'A Queue operates under FIFO (First-In, First-Out).'
      },
      {
        id: 'q4',
        type: 'theory',
        prompt: 'Explain the difference between a Compiler and an Interpreter. Give two advantages and disadvantages of each.'
      }
    ]
  }
];

// --- PAST QUESTIONS STORAGE ---

export async function getPastQuestionPacks(): Promise<PastQuestionPack[]> {
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabase
        .from('past_question_packs')
        .select('*')
        .eq('published', true);

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
  return [...SEED_PAST_QUESTION_PACKS, ...customPacks];
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
