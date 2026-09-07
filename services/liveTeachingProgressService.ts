/**
 * Persist live teaching engine progress so long lessons (esp. 60 min) can resume.
 */
import { readCachedJson, writeCachedJson } from '../utils/cache';
import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import type { TeachingStructure, TeachingBoardPerformance } from '../types/teachingScript';

export interface LiveTeachingProgress {
  topicKey: string;
  topicTitle: string;
  courseName?: string;
  durationMode: LessonDurationMode;
  boardIndex: number;
  totalBoards: number;
  chapterTitle?: string;
  structure?: TeachingStructure | null;
  lastBoardTitle?: string;
  isCompleted: boolean;
  updatedAt: number;
}

function progressKey(userId: string, topicKey: string): string {
  return `live_teach_progress_v1_${userId || 'anon'}_${topicKey}`;
}

function structureKey(userId: string, topicKey: string, mode: LessonDurationMode): string {
  return `live_teach_structure_v1_${userId || 'anon'}_${topicKey}_${mode}`;
}

export function topicKeyFromTitle(topicTitle: string, courseName?: string): string {
  const raw = `${courseName || ''}_${topicTitle}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80);
}

export async function saveLiveTeachingProgress(
  userId: string,
  progress: Omit<LiveTeachingProgress, 'updatedAt'>
): Promise<void> {
  const payload: LiveTeachingProgress = { ...progress, updatedAt: Date.now() };
  await writeCachedJson(progressKey(userId, progress.topicKey), payload, userId || 'anon');
  if (progress.structure) {
    await writeCachedJson(
      structureKey(userId, progress.topicKey, progress.durationMode),
      progress.structure,
      userId || 'anon'
    );
  }
}

export function getLiveTeachingProgress(
  userId: string,
  topicKey: string
): LiveTeachingProgress | null {
  return readCachedJson<LiveTeachingProgress | null>(progressKey(userId, topicKey), null);
}

export async function saveTeachingStructureOnly(
  userId: string,
  topicKey: string,
  structure: TeachingStructure,
  mode: LessonDurationMode = '30min'
): Promise<void> {
  const modesToSave: LessonDurationMode[] = [mode, '30min', '15min', '60min'];
  for (const m of modesToSave) {
    await writeCachedJson(
      structureKey(userId, topicKey, m),
      structure,
      userId || 'anon'
    );
  }
}

export function getSavedTeachingStructure(
  userId: string,
  topicKey: string,
  mode?: LessonDurationMode
): TeachingStructure | null {
  let found: TeachingStructure | null = null;
  if (mode) {
    found = readCachedJson<TeachingStructure | null>(structureKey(userId, topicKey, mode), null);
  }
  if (!found || !found.boards || found.boards.length === 0) {
    const modes: LessonDurationMode[] = ['30min', '15min', '60min'];
    for (const m of modes) {
      const s = readCachedJson<TeachingStructure | null>(structureKey(userId, topicKey, m), null);
      if (s && s.boards && s.boards.length > 0) {
        found = s;
        break;
      }
    }
  }
  if (!found || !found.boards || found.boards.length === 0) return null;

  // Adapt structure board count based on requested duration mode
  if (mode === '15min' && found.boards.length > 3) {
    return {
      ...found,
      totalEstimatedDurationMinutes: 15,
      boards: found.boards.slice(0, 3),
    };
  }
  return found;
}

export function formatResumeLabel(p: LiveTeachingProgress): string {
  const part = p.chapterTitle ? `${p.chapterTitle} · ` : '';
  return `${part}Board ${p.boardIndex + 1}/${p.totalBoards} · ${p.durationMode} min mode`;
}

const activePrefetches = new Set<string>();

/**
 * Prefetch teaching structure in the background when a user selects/enters a topic.
 * Saves the structure in localStorage so when the user clicks 'Live Tutorial',
 * the board starts rendering immediately without waiting for structure planning.
 */
export async function prefetchTopicTeachingStructure(params: {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  userId?: string;
  userProfile?: any;
  appSettings?: any;
  durationMode?: LessonDurationMode;
}): Promise<void> {
  const topicTitle = params.topicTitle?.trim();
  if (!topicTitle) return;

  const resolvedUserId = params.userId || params.userProfile?.uid || 'anon';
  const topicKey = topicKeyFromTitle(topicTitle, params.courseName);
  const mode = params.durationMode || '30min';

  // Check if structure is already cached
  const existing = getSavedTeachingStructure(resolvedUserId, topicKey, mode);
  if (existing && existing.boards && existing.boards.length > 0) {
    return;
  }

  const prefetchId = `${resolvedUserId}_${topicKey}_${mode}`;
  if (activePrefetches.has(prefetchId)) return;
  activePrefetches.add(prefetchId);

  try {
    const { TeachingEngineService } = await import('./teachingEngineService');
    const engine = new TeachingEngineService({
      appSettings: params.appSettings,
      userProfile: params.userProfile,
      durationMode: mode,
    });

    const structure = await engine.generateTeachingStructure({
      topic: topicTitle,
      courseName: params.courseName,
      syllabusContext: params.syllabusContext,
      durationMode: mode,
    });

    if (structure && structure.boards && structure.boards.length > 0) {
      await saveTeachingStructureOnly(resolvedUserId, topicKey, structure, mode);
    }
  } catch (err) {
    console.warn('[prefetchTopicTeachingStructure] Background prefetch failed (non-critical):', err);
  } finally {
    activePrefetches.delete(prefetchId);
  }
}

