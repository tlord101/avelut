export type SavedItemType = 'flashcards' | 'exam' | 'past_questions';

export interface SavedItem {
  id?: string;
  type: SavedItemType;
  title: string;
  data: any;
  createdAt: number | object;
}
