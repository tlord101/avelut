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

function normalizeModeKey(mode?: LessonDurationMode | string): LessonDurationMode {
  if (mode === 15 || mode === '15' || mode === '15min') return 15;
  if (mode === 60 || mode === '60' || mode === '60min') return 60;
  return 30;
}

function structureKey(userId: string, topicKey: string, mode: LessonDurationMode | string): string {
  const norm = normalizeModeKey(mode);
  return `live_teach_structure_v1_${userId || 'anon'}_${topicKey}_${norm}min`;
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
  mode: LessonDurationMode = 30
): Promise<void> {
  const norm = normalizeModeKey(mode);
  await writeCachedJson(
    structureKey(userId, topicKey, norm),
    structure,
    userId || 'anon'
  );
}

export function getSavedTeachingStructure(
  userId: string,
  topicKey: string,
  mode?: LessonDurationMode | string
): TeachingStructure | null {
  const targetMode = mode ? normalizeModeKey(mode) : undefined;
  if (targetMode) {
    const s = readCachedJson<TeachingStructure | null>(structureKey(userId, topicKey, targetMode), null);
    if (s && s.boards && s.boards.length > 0) return s;
  }

  // Fallback to any pre-cached duration mode if exact target mode is not yet generated
  const fallbackModes: LessonDurationMode[] = [30, 15, 60];
  for (const m of fallbackModes) {
    const s = readCachedJson<TeachingStructure | null>(structureKey(userId, topicKey, m), null);
    if (s && s.boards && s.boards.length > 0) return s;
  }
  return null;
}

export function formatResumeLabel(p: LiveTeachingProgress): string {
  const part = p.chapterTitle ? `${p.chapterTitle} · ` : '';
  return `${part}Board ${p.boardIndex + 1}/${p.totalBoards} · ${p.durationMode} min mode`;
}

const activePrefetches = new Set<string>();

/**
 * Prefetch teaching structures in the background when a user selects/enters a topic.
 * Generates distinct AI structures for all duration modes (15 min, 30 min, 60 min)
 * so that whichever duration the user selects, the exact tailored AI structure is ready.
 */
export async function prefetchTopicTeachingStructure(params: {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  userId?: string;
  userProfile?: any;
  appSettings?: any;
}): Promise<void> {
  const topicTitle = params.topicTitle?.trim();
  if (!topicTitle) return;

  const resolvedUserId = params.userId || params.userProfile?.uid || 'anon';
  const topicKey = topicKeyFromTitle(topicTitle, params.courseName);
  const durationModes: LessonDurationMode[] = [15, 30, 60];

  for (const mode of durationModes) {
    const modeKey = structureKey(resolvedUserId, topicKey, mode);
    const existing = readCachedJson<TeachingStructure | null>(modeKey, null);
    if (existing && existing.boards && existing.boards.length > 0) {
      continue; // Skip if exact mode is already pre-cached
    }

    const prefetchId = `${resolvedUserId}_${topicKey}_${mode}`;
    if (activePrefetches.has(prefetchId)) continue;
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
      console.warn(`[prefetchTopicTeachingStructure] Background prefetch failed for mode ${mode}m (non-critical):`, err);
    } finally {
      activePrefetches.delete(prefetchId);
    }
    // Small delay between background prefetch calls to prevent OpenRouter RPM rate limit bursts
    await new Promise((res) => setTimeout(res, 500));
  }
}

