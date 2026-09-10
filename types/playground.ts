export type QuestionOption = {
  id: string;
  text: string;
  isCorrect?: boolean;
};

export type PastQuestion = {
  id: string;
  type: 'mcq' | 'theory';
  prompt: string;
  options?: QuestionOption[];
  explanation?: string;
};

export type PastQuestionPack = {
  id: string;
  title: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  year?: number;
  type: 'mcq' | 'theory' | 'mixed';
  questionCount: number;
  questions: PastQuestion[];
};

export type TheorySolution = {
  packId: string;
  questionId: string;
  solutionMarkdown: string;
  createdAt: number;
};

export type FlashcardItem = {
  id: string;
  front: string;
  back: string;
};

export type FlashcardDeck = {
  id: string;
  title: string;
  courseId?: string;
  courseName?: string;
  topicId?: string;
  topicName?: string;
  cards: FlashcardItem[];
  createdAt: number;
};

export type CBTExamQuestion = {
  id: string;
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation?: string;
};

export type CBTExam = {
  id: string;
  title: string;
  courseId?: string;
  courseName?: string;
  topicId?: string;
  topicName?: string;
  durationMinutes: number;
  questions: CBTExamQuestion[];
  createdAt: number;
};

export type CBTAttempt = {
  id: string;
  examId: string;
  answers: Record<string, string>; // questionId -> selectedOptionId
  score: number;
  totalQuestions: number;
  completedAt: number;
};
