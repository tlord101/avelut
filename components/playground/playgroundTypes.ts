import type { UserProfile, AppSettings } from '../../types';
import type {
  PastQuestionPack,
  PastQuestion,
  TheorySolution,
  FlashcardDeck,
  CBTExam,
  CBTAttempt
} from '../../types/playground';

export interface PlaygroundProps {
  userProfile?: UserProfile;
  appSettings?: AppSettings;
  onNavigate?: (tab: string) => void;
  setCustomHeaderConfig?: (config: any) => void;
}

export type ViewState =
  | { type: 'home' }
  | { type: 'past_viewer'; packId: string }
  | { type: 'flashcards_new' }
  | { type: 'flashcards_study'; deckId: string }
  | { type: 'cbt_new' }
  | { type: 'cbt_exam'; examId: string };
