import { writeCachedJson } from '../utils/cache';
import { supabaseDataService } from './supabaseDataService';
import type { TeachingStructure } from '../types/teachingScript';
import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';

export function normalizeModeKey(mode?: LessonDurationMode | string | number): LessonDurationMode {
  const m = typeof mode === 'number' ? mode : parseInt(String(mode), 10);
  if (m === 15) return 15;
  if (m === 60) return 60;
  return 30;
}

export function topicKeyFromTitle(topicTitle: string, courseName?: string): string {
  const raw = `${courseName || ''}_${topicTitle}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80);
}

export function structureKey(userId: string, topicKey: string, mode: LessonDurationMode | string | number): string {
  const norm = normalizeModeKey(mode);
  return `live_teach_structure_v1_${userId || 'anon'}_${topicKey}_${norm}min`;
}

export async function saveTeachingStructureOnly(
  userId: string,
  topicKey: string,
  structure: TeachingStructure,
  mode: LessonDurationMode = 30,
  courseName?: string
): Promise<void> {
  const norm = normalizeModeKey(mode);
  await writeCachedJson(
    structureKey(userId, topicKey, norm),
    structure,
    userId || 'anon'
  );
  if (structure && structure.topic) {
    void supabaseDataService.saveTopicTeachingStructureSupabase(
      structure.topic,
      courseName,
      norm,
      structure
    );
  }
}

export function isValidStructureForDuration(struct: TeachingStructure | null, mode?: any): boolean {
  if (!struct || !Array.isArray(struct.boards) || struct.boards.length === 0) return false;
  const duration = typeof mode === 'number' ? mode : (parseInt(String(mode), 10) || 30);
  const minRequired = duration === 15 ? 6 : duration === 60 ? 20 : 10;
  return struct.boards.length >= minRequired;
}

export function ensureTargetBoardCount(struct: TeachingStructure, mode?: any): TeachingStructure {
  const duration = typeof mode === 'number' ? mode : (parseInt(String(mode), 10) || 30);
  const targetCount = duration === 15 ? 8 : duration === 60 ? 30 : 15;
  if (!struct.boards) struct.boards = [];

  struct.duration_minutes = duration as any;

  if (struct.boards.length >= targetCount) {
    struct.boards = struct.boards.slice(0, targetCount);
    struct.boards.forEach((b, idx) => {
      b.board_number = idx + 1;
      b.board_id = `board_${idx + 1}`;
    });
    return struct;
  }

  const existingCount = struct.boards.length;
  const missing = targetCount - existingCount;

  for (let i = 1; i <= missing; i++) {
    const boardNum = existingCount + i;
    const isLast = boardNum === targetCount;
    const isMid = boardNum % 3 === 0;

    struct.boards.push({
      board_id: `board_${boardNum}`,
      board_number: boardNum,
      title: isLast
        ? `Summary & Key Takeaways`
        : isMid
        ? `${struct.topic || 'Lesson'} - Concept Check & Review ${i}`
        : `${struct.topic || 'Lesson'} - Core Application ${i}`,
      chapter: struct.boards[existingCount - 1]?.chapter || undefined,
      step_type: isLast ? 'summary' : isMid ? 'question' : 'concept',
      teaching_objective: `Master concept step ${boardNum} for ${struct.topic || 'topic'}`,
      what_student_should_understand: `Deepen mastery of aspect ${boardNum}`,
      why_this_board_exists: `Ensure complete coverage for ${duration}-minute lesson`,
      prerequisite_knowledge: [],
      key_concepts: [`${struct.topic || 'Core'} Point ${boardNum}`],
      visual_purpose: `Diagram and step-by-step visual breakdown`,
      recommended_board_content: [`${struct.topic || 'Core'} Point ${boardNum}`],
      interaction_required: isMid,
      question_required: isMid,
      question_type: isMid ? 'understanding' : null,
      estimated_duration_seconds: 120,
    });
  }

  struct.boards.forEach((b, idx) => {
    b.board_number = idx + 1;
    b.board_id = `board_${idx + 1}`;
  });

  return struct;
}
