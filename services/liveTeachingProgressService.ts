/**
 * Persist live teaching engine progress so long lessons (esp. 60 min) can resume.
 */
import { readCachedJson, writeCachedJson } from '../utils/cache';
import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import type { TeachingStructure, TeachingBoardPerformance } from '../types/teachingScript';
import { supabaseDataService } from './supabaseDataService';

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

function normalizeModeKey(mode?: LessonDurationMode | string | number): LessonDurationMode {
  const m = typeof mode === 'number' ? mode : parseInt(String(mode), 10);
  if (m === 15) return 15;
  if (m === 60) return 60;
  return 30;
}

function structureKey(userId: string, topicKey: string, mode: LessonDurationMode | string | number): string {
  const norm = normalizeModeKey(mode);
  return `live_teach_structure_v1_${userId || 'anon'}_${topicKey}_${norm}min`;
}

export function topicKeyFromTitle(topicTitle: string, courseName?: string): string {
  const raw = `${courseName || ''}_${topicTitle}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80);
}

const inFlightStructurePromises = new Map<string, Promise<TeachingStructure | null>>();

export function isTopicStructureFetching(userId: string, topicKey: string, mode?: LessonDurationMode | number): boolean {
  const norm = mode ? normalizeModeKey(mode) : null;
  if (norm) {
    return inFlightStructurePromises.has(`${userId || 'anon'}_${topicKey}_${norm}`);
  }
  return [15, 30, 60].some((m) => inFlightStructurePromises.has(`${userId || 'anon'}_${topicKey}_${m}`));
}

export async function saveLiveTeachingProgress(
  userId: string,
  progress: Omit<LiveTeachingProgress, 'updatedAt'>
): Promise<void> {
  const payload: LiveTeachingProgress = { ...progress, updatedAt: Date.now() };
  await writeCachedJson(progressKey(userId, progress.topicKey), payload, userId || 'anon');
  if (progress.structure) {
    await saveTeachingStructureOnly(userId, progress.topicKey, progress.structure, progress.durationMode, progress.courseName);
  }
  // Store topic last seen in Supabase
  if (userId && userId !== 'anon' && progress.topicTitle) {
    void supabaseDataService.saveTopicLastVisited(userId, progress.topicTitle, progress.courseName);
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
  mode: LessonDurationMode = 30,
  courseName?: string
): Promise<void> {
  const norm = normalizeModeKey(mode);
  await writeCachedJson(
    structureKey(userId, topicKey, norm),
    structure,
    userId || 'anon'
  );
  // Persist structure to Supabase DB so any user opening the same topic reuses it
  if (structure && structure.topic) {
    void supabaseDataService.saveTopicTeachingStructureSupabase(
      structure.topic,
      courseName,
      norm,
      structure
    );
  }
}

export function getSavedTeachingStructure(
  userId: string,
  topicKey: string,
  mode?: LessonDurationMode | string | number
): TeachingStructure | null {
  const targetMode = mode ? normalizeModeKey(mode) : undefined;
  if (targetMode) {
    const s = readCachedJson<TeachingStructure | null>(structureKey(userId, topicKey, targetMode), null);
    if (s && s.boards && s.boards.length > 0) return s;
    return null;
  }
  return null;
}

export async function getSavedTeachingStructureAsync(
  userId: string,
  topicTitle: string,
  courseName: string | undefined,
  mode: LessonDurationMode = 30
): Promise<TeachingStructure | null> {
  const topicKey = topicKeyFromTitle(topicTitle, courseName);
  const norm = normalizeModeKey(mode);

  // 1. Check local cache first (0ms)
  const local = getSavedTeachingStructure(userId, topicKey, norm);
  if (local && local.boards && local.boards.length > 0) return local;

  // 2. Check Supabase DB for pre-generated topic structure by any user
  const dbStruct = await supabaseDataService.getTopicTeachingStructureSupabase(topicTitle, courseName, norm);
  if (dbStruct && dbStruct.boards && dbStruct.boards.length > 0) {
    await saveTeachingStructureOnly(userId, topicKey, dbStruct, norm, courseName);
    return dbStruct;
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
 * Performs ONE SINGLE AI API CALL to generate distinct structures for all 3 duration modes
 * (15 min, 30 min, 60 min) simultaneously, saving them to local cache and Supabase DB.
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

  // Save topic last seen in Supabase database
  if (resolvedUserId && resolvedUserId !== 'anon') {
    void supabaseDataService.saveTopicLastVisited(resolvedUserId, topicTitle, params.courseName);
  }

  // Check which modes are missing locally or in Supabase DB
  const missingModes: LessonDurationMode[] = [];
  for (const mode of durationModes) {
    const modeKey = structureKey(resolvedUserId, topicKey, mode);
    const existing = readCachedJson<TeachingStructure | null>(modeKey, null);
    if (existing && existing.boards && existing.boards.length > 0) {
      continue;
    }
    const dbStruct = await supabaseDataService.getTopicTeachingStructureSupabase(topicTitle, params.courseName, mode);
    if (dbStruct && dbStruct.boards && dbStruct.boards.length > 0) {
      await saveTeachingStructureOnly(resolvedUserId, topicKey, dbStruct, mode, params.courseName);
      continue;
    }
    missingModes.push(mode);
  }

  if (missingModes.length === 0) return; // All 3 modes ready!

  // Register in-flight promises for missing modes under a SINGLE unified request
  const unifiedPrefetchId = `unified_${resolvedUserId}_${topicKey}`;
  if (activePrefetches.has(unifiedPrefetchId)) return;
  activePrefetches.add(unifiedPrefetchId);

  let resolvePromise: (val: any) => void;
  const singleUnifiedPromise = new Promise<any>((res) => { resolvePromise = res; });

  for (const mode of missingModes) {
    const prefetchId = `${resolvedUserId}_${topicKey}_${mode}`;
    inFlightStructurePromises.set(prefetchId, singleUnifiedPromise);
  }

  try {
    const { TeachingEngineService } = await import('./teachingEngineService');
    const engine = new TeachingEngineService(
      params.appSettings || {},
      params.userProfile || null,
      'Altair'
    );

    // Make ONE SINGLE AI API call for all 3 duration structures
    const result = await engine.generateUnifiedAllTeachingStructures({
      topic: topicTitle,
      courseName: params.courseName,
      syllabusContext: params.syllabusContext,
      studentName: params.userProfile?.display_name || 'Student',
    });

    // Save whichever duration mode structures returned
    for (const m of [15, 30, 60] as LessonDurationMode[]) {
      const struct = result[m];
      if (struct && struct.boards && struct.boards.length > 0) {
        await saveTeachingStructureOnly(resolvedUserId, topicKey, struct, m, params.courseName);
      }
    }
    resolvePromise!(result);
  } catch (err) {
    console.warn('[prefetchTopicTeachingStructure] Single-call unified prefetch failed:', err);
    resolvePromise!(null);
  } finally {
    activePrefetches.delete(unifiedPrefetchId);
    for (const mode of missingModes) {
      const prefetchId = `${resolvedUserId}_${topicKey}_${mode}`;
      inFlightStructurePromises.delete(prefetchId);
    }
  }
}

