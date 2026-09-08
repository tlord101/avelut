/**
 * Structure Prefetch Service — Centralized state machine for teaching structure generation.
 *
 * Replaces the scattered prefetch logic across liveTeachingProgressService and
 * teachingEngineService with a single service that:
 *
 * 1. Manages a proper state machine per topic+duration: idle → prefetching → ready / failed
 * 2. Uses a content-hash-based cache key factory for stable lookups
 * 3. Exposes an event emitter so React consumers subscribe instead of polling
 * 4. Supports cancellation via AbortController
 * 5. Implements a 90-second timeout on unified calls with single-mode fallback
 * 6. Maintains heartbeat on in-flight locks for multi-tab / app-kill recovery
 * 7. Always saves a minimal fallback structure on total failure
 */

import type { TeachingStructure } from '../types/teachingScript';
import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import type { AppSettings, UserProfile } from '../types';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { supabaseDataService } from './supabaseDataService';
import { logTeachingEvent } from './teachingEventLogger';

// ── Types ────────────────────────────────────────────────────────────────────

export type PrefetchState = 'idle' | 'prefetching' | 'ready' | 'failed';

export interface PrefetchStatus {
  state: PrefetchState;
  error?: string;
  startedAt?: number;
  estimatedRemainingMs?: number;
}

export interface PrefetchParams {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  userId?: string;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
}

interface PrefetchLockV2 {
  startedAt: number;
  lastHeartbeat: number;
  topicTitle: string;
  courseName?: string;
  status: 'generating' | 'completed' | 'failed';
}

type StatusCallback = (statuses: Record<LessonDurationMode, PrefetchStatus>) => void;

// ── Constants ────────────────────────────────────────────────────────────────

const UNIFIED_TIMEOUT_MS = 90_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const STALE_HEARTBEAT_MS = 45_000;
const LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DURATION_MODES: LessonDurationMode[] = [15, 30, 60];

// ── Content Hash Key Factory ─────────────────────────────────────────────────

/**
 * Generate a stable cache key using a simple content hash of topic + courseName + syllabusContext.
 * This ensures that minor text differences don't create duplicate cache entries.
 */
function simpleHash(str: string): string {
  let hash = 0;
  const input = str.toLowerCase().trim();
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

export function buildContentHash(topicTitle: string, courseName?: string, syllabusContext?: string): string {
  const parts = [
    topicTitle || '',
    courseName || '',
    (syllabusContext || '').slice(0, 200), // Truncate to keep key stable across minor edits
  ];
  return simpleHash(parts.join('||'));
}

/**
 * Canonical topic key — backward compatible with topicKeyFromTitle but augmented with content hash.
 */
export function buildTopicKey(topicTitle: string, courseName?: string): string {
  const raw = `${courseName || ''}_${topicTitle}`;
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80);
}

export function structureCacheKey(topicKey: string, mode: LessonDurationMode, contentHash?: string): string {
  const suffix = contentHash ? `_${contentHash}` : '';
  return `live_teach_structure_v2_${topicKey}_${mode}min${suffix}`;
}

function lockKey(topicKey: string): string {
  return `avelut_prefetch_lock_v2_${topicKey}`;
}

// ── Singleton State ──────────────────────────────────────────────────────────

const statusMap = new Map<string, Record<LessonDurationMode, PrefetchStatus>>();
const listeners = new Map<string, Set<StatusCallback>>();
const activeAbortControllers = new Map<string, AbortController>();
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

function getDefaultStatuses(): Record<LessonDurationMode, PrefetchStatus> {
  return {
    15: { state: 'idle' },
    30: { state: 'idle' },
    60: { state: 'idle' },
  };
}

function getStatuses(topicKey: string): Record<LessonDurationMode, PrefetchStatus> {
  if (!statusMap.has(topicKey)) {
    statusMap.set(topicKey, getDefaultStatuses());
  }
  return statusMap.get(topicKey)!;
}

function notifyListeners(topicKey: string): void {
  const subs = listeners.get(topicKey);
  if (!subs || subs.size === 0) return;
  const statuses = getStatuses(topicKey);
  const snapshot = { ...statuses };
  subs.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (e) {
      console.warn('[PrefetchService] Listener error:', e);
    }
  });
}

function setModeStatus(topicKey: string, mode: LessonDurationMode, status: PrefetchStatus): void {
  const statuses = getStatuses(topicKey);
  statuses[mode] = status;
  notifyListeners(topicKey);
}

function setAllModesStatus(topicKey: string, status: Partial<PrefetchStatus>): void {
  const statuses = getStatuses(topicKey);
  for (const mode of DURATION_MODES) {
    statuses[mode] = { ...statuses[mode], ...status };
  }
  notifyListeners(topicKey);
}

// ── Lock Management with Heartbeat ──────────────────────────────────────────

function writeLock(topicKey: string, status: PrefetchLockV2['status'], topicTitle: string, courseName?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const lock: PrefetchLockV2 = {
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
      topicTitle,
      courseName,
      status,
    };
    localStorage.setItem(lockKey(topicKey), JSON.stringify(lock));
  } catch {}
}

function readLock(topicKey: string): PrefetchLockV2 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(lockKey(topicKey));
    if (!raw) return null;
    const lock: PrefetchLockV2 = JSON.parse(raw);
    if (!lock || typeof lock !== 'object') return null;

    // Check TTL
    if (Date.now() - lock.startedAt > LOCK_TTL_MS) {
      localStorage.removeItem(lockKey(topicKey));
      return null;
    }

    // Check stale heartbeat
    if (lock.status === 'generating' && Date.now() - (lock.lastHeartbeat || lock.startedAt) > STALE_HEARTBEAT_MS) {
      localStorage.removeItem(lockKey(topicKey));
      return null;
    }

    return lock;
  } catch {
    return null;
  }
}

function updateHeartbeat(topicKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(lockKey(topicKey));
    if (!raw) return;
    const lock: PrefetchLockV2 = JSON.parse(raw);
    lock.lastHeartbeat = Date.now();
    localStorage.setItem(lockKey(topicKey), JSON.stringify(lock));
  } catch {}
}

function clearLock(topicKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(lockKey(topicKey));
  } catch {}
}

function startHeartbeat(topicKey: string): void {
  stopHeartbeat(topicKey);
  const timer = setInterval(() => updateHeartbeat(topicKey), HEARTBEAT_INTERVAL_MS);
  heartbeatTimers.set(topicKey, timer);
}

function stopHeartbeat(topicKey: string): void {
  const timer = heartbeatTimers.get(topicKey);
  if (timer) {
    clearInterval(timer);
    heartbeatTimers.delete(topicKey);
  }
}

// ── Fallback Structure Builder ──────────────────────────────────────────────

function buildMinimalFallbackStructure(topic: string, mode: LessonDurationMode): TeachingStructure {
  const boardCount = mode === 15 ? 8 : mode === 60 ? 30 : 15;
  const boards = [];
  for (let i = 1; i <= boardCount; i++) {
    boards.push({
      board_id: `board_${i}`,
      board_number: i,
      step_type: 'core_concept',
      prerequisite_knowledge: [],
      key_concepts: [`${topic} Core Point ${i}`],
      title: i === 1 ? `Introduction to ${topic}` : i === boardCount ? `Summary & Key Takeaways` : `${topic} - Core Concept ${i - 1}`,
      teaching_objective: `Master key concept ${i} for ${topic}`,
      what_student_should_understand: `Understanding aspect ${i} of ${topic}`,
      why_this_board_exists: `Build foundational mastery of ${topic}`,
      visual_purpose: `Diagram and key formula for ${topic}`,
      recommended_board_content: [`${topic} Core Point ${i}`],
      interaction_required: false,
      question_required: false,
      question_type: null,
      estimated_duration_seconds: 120,
    });
  }
  return {
    topic,
    teaching_strategy: `Paced ~2-minute per board live lecture for ${mode}m mode`,
    learning_goal: `Master core principles and applications of ${topic}`,
    duration_minutes: mode,
    boards,
  } as TeachingStructure;
}

// ── Structure Lookup (Local + Supabase) ─────────────────────────────────────

async function lookupStructure(
  topicKey: string,
  topicTitle: string,
  courseName: string | undefined,
  mode: LessonDurationMode,
  userId: string,
  contentHash?: string,
): Promise<TeachingStructure | null> {
  // 1. Check v2 cache key
  const v2Key = structureCacheKey(topicKey, mode, contentHash);
  const v2 = readCachedJson<TeachingStructure | null>(v2Key, null);
  if (v2?.boards?.length) return v2;

  // 2. Check legacy v1 cache key (backward compat)
  const v1Key = `live_teach_structure_v1_${userId || 'anon'}_${topicKey}_${mode}min`;
  const v1 = readCachedJson<TeachingStructure | null>(v1Key, null);
  if (v1?.boards?.length) {
    // Migrate to v2 key
    writeCachedJson(v2Key, v1, userId || 'anon');
    return v1;
  }

  // 3. Check old board cache key
  const oldKey = `avelut_board_cache_struct_${(topicTitle || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}_${mode}`;
  const old = readCachedJson<TeachingStructure | null>(oldKey, null);
  if (old?.boards?.length) {
    writeCachedJson(v2Key, old, userId || 'anon');
    return old;
  }

  // 4. Check Supabase DB
  try {
    const dbStruct = await supabaseDataService.getTopicTeachingStructureSupabase(topicTitle, courseName, mode);
    if (dbStruct?.boards?.length) {
      writeCachedJson(v2Key, dbStruct, userId || 'anon');
      return dbStruct;
    }
  } catch (e) {
    console.warn('[PrefetchService] Supabase lookup failed:', e);
  }

  return null;
}

function saveStructure(
  topicKey: string,
  structure: TeachingStructure,
  mode: LessonDurationMode,
  userId: string,
  courseName?: string,
  contentHash?: string,
): void {
  const v2Key = structureCacheKey(topicKey, mode, contentHash);
  writeCachedJson(v2Key, structure, userId || 'anon');

  // Also save to legacy key for backward compat
  const v1Key = `live_teach_structure_v1_${userId || 'anon'}_${topicKey}_${mode}min`;
  writeCachedJson(v1Key, structure, userId || 'anon');

  // Persist to Supabase
  if (structure.topic) {
    void supabaseDataService.saveTopicTeachingStructureSupabase(
      structure.topic,
      courseName,
      mode,
      structure,
    );
  }
}

// ── Core Prefetch Logic ─────────────────────────────────────────────────────

export async function startPrefetch(params: PrefetchParams): Promise<void> {
  const topicTitle = params.topicTitle?.trim();
  if (!topicTitle) return;

  const userId = params.userId || params.userProfile?.uid || 'anon';
  const topicKey = buildTopicKey(topicTitle, params.courseName);
  const contentHash = buildContentHash(topicTitle, params.courseName, params.syllabusContext);

  // Save topic visit
  if (userId && userId !== 'anon') {
    void supabaseDataService.saveTopicLastVisited(userId, topicTitle, params.courseName);
  }

  // Check which modes are already ready
  const missingModes: LessonDurationMode[] = [];
  for (const mode of DURATION_MODES) {
    const existing = await lookupStructure(topicKey, topicTitle, params.courseName, mode, userId, contentHash);
    if (existing) {
      setModeStatus(topicKey, mode, { state: 'ready' });
      logTeachingEvent({ type: 'cache_hit', topic: topicTitle, duration: mode, metadata: { userId } });
    } else {
      missingModes.push(mode);
    }
  }

  if (missingModes.length === 0) {
    writeLock(topicKey, 'completed', topicTitle, params.courseName);
    return;
  }

  // Check if another tab is generating (via lock)
  const existingLock = readLock(topicKey);
  if (existingLock?.status === 'generating') {
    // Another tab/session is working on it — mark as prefetching and wait
    for (const mode of missingModes) {
      setModeStatus(topicKey, mode, {
        state: 'prefetching',
        startedAt: existingLock.startedAt,
        estimatedRemainingMs: Math.max(0, UNIFIED_TIMEOUT_MS - (Date.now() - existingLock.startedAt)),
      });
    }
    return;
  }

  // Check if already in-flight from this tab
  if (activeAbortControllers.has(topicKey)) {
    return;
  }

  // Start generation
  const abortController = new AbortController();
  activeAbortControllers.set(topicKey, abortController);
  const startTime = Date.now();

  for (const mode of missingModes) {
    setModeStatus(topicKey, mode, {
      state: 'prefetching',
      startedAt: startTime,
      estimatedRemainingMs: UNIFIED_TIMEOUT_MS,
    });
    logTeachingEvent({ type: 'prefetch_start', topic: topicTitle, duration: mode, metadata: { userId } });
  }

  writeLock(topicKey, 'generating', topicTitle, params.courseName);
  startHeartbeat(topicKey);

  try {
    // Dynamic import to avoid circular dependencies
    const { TeachingEngineService } = await import('./teachingEngineService');
    const engine = new TeachingEngineService(
      (params.appSettings || {}) as AppSettings,
      params.userProfile || null,
      'Altair',
    );

    if (abortController.signal.aborted) throw new Error('Cancelled');

    // Race unified call against 90-second timeout
    const timeoutPromise = new Promise<null>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('PREFETCH_TIMEOUT')), UNIFIED_TIMEOUT_MS);
      abortController.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Cancelled'));
      });
    });

    let result: { 15: TeachingStructure | null; 30: TeachingStructure | null; 60: TeachingStructure | null };

    try {
      result = await Promise.race([
        engine.generateUnifiedAllTeachingStructures({
          topic: topicTitle,
          courseName: params.courseName,
          syllabusContext: params.syllabusContext,
          studentName: params.userProfile?.display_name || 'Student',
        }),
        timeoutPromise as any,
      ]);
    } catch (timeoutErr: any) {
      if (timeoutErr?.message === 'PREFETCH_TIMEOUT') {
        logTeachingEvent({
          type: 'prefetch_timeout',
          topic: topicTitle,
          latencyMs: Date.now() - startTime,
          metadata: { userId, missingModes },
        });

        // Fallback: generate single-mode structures for each missing mode individually
        result = { 15: null, 30: null, 60: null };
        for (const mode of missingModes) {
          if (abortController.signal.aborted) break;
          try {
            const struct = await engine.generateTeachingStructure({
              topic: topicTitle,
              courseName: params.courseName,
              syllabusContext: params.syllabusContext,
              durationMode: mode,
              isPrefetch: true,
            });
            result[mode] = struct;
          } catch (singleErr) {
            console.warn(`[PrefetchService] Single-mode fallback failed for ${mode}m:`, singleErr);
          }
        }
      } else {
        throw timeoutErr;
      }
    }

    if (abortController.signal.aborted) throw new Error('Cancelled');

    // Process results
    let savedAny = false;
    for (const mode of DURATION_MODES) {
      const struct = result[mode];
      if (struct?.boards?.length) {
        saveStructure(topicKey, struct, mode, userId, params.courseName, contentHash);
        setModeStatus(topicKey, mode, { state: 'ready' });
        savedAny = true;
        logTeachingEvent({
          type: 'prefetch_complete',
          topic: topicTitle,
          duration: mode,
          latencyMs: Date.now() - startTime,
          metadata: { userId, boardCount: struct.boards.length },
        });

        // Background: prefetch Board 0 performance + TTS
        void engine.generateAndCacheBoard0Performance(struct, mode);
      } else if (missingModes.includes(mode)) {
        // Save fallback for this mode
        const fallback = buildMinimalFallbackStructure(topicTitle, mode);
        saveStructure(topicKey, fallback, mode, userId, params.courseName, contentHash);
        setModeStatus(topicKey, mode, {
          state: 'ready',
          error: 'Using fallback structure — AI generation failed',
        });
        logTeachingEvent({
          type: 'fallback_used',
          topic: topicTitle,
          duration: mode,
          metadata: { userId },
        });
      }
    }

    writeLock(topicKey, savedAny ? 'completed' : 'failed', topicTitle, params.courseName);
  } catch (err: any) {
    if (err?.message === 'Cancelled') return;

    console.error('[PrefetchService] Prefetch failed:', err);

    // Save fallbacks for all missing modes
    for (const mode of missingModes) {
      const fallback = buildMinimalFallbackStructure(topicTitle, mode);
      saveStructure(topicKey, fallback, mode, userId, params.courseName, contentHash);
      setModeStatus(topicKey, mode, {
        state: 'failed',
        error: err?.message || 'AI generation failed',
      });
    }

    writeLock(topicKey, 'failed', topicTitle, params.courseName);
    logTeachingEvent({
      type: 'prefetch_fail',
      topic: topicTitle,
      error: err?.message,
      latencyMs: Date.now() - startTime,
      metadata: { userId },
    });
  } finally {
    stopHeartbeat(topicKey);
    activeAbortControllers.delete(topicKey);
  }
}

/**
 * Cancel an in-flight prefetch for a topic.
 */
export function cancelPrefetch(topicKey: string): void {
  const controller = activeAbortControllers.get(topicKey);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(topicKey);
  }
  stopHeartbeat(topicKey);
  clearLock(topicKey);
}

/**
 * Retry prefetch for a specific topic and mode.
 * Clears failed state and re-triggers the prefetch.
 */
export function retryPrefetch(params: PrefetchParams, mode?: LessonDurationMode): void {
  const topicKey = buildTopicKey(params.topicTitle, params.courseName);

  // Clear failed states
  if (mode) {
    setModeStatus(topicKey, mode, { state: 'idle' });
  } else {
    setAllModesStatus(topicKey, { state: 'idle', error: undefined });
  }

  clearLock(topicKey);
  void startPrefetch(params);
}

// ── Public Query API ─────────────────────────────────────────────────────────

/**
 * Get current prefetch status for a topic+mode.
 */
export function getPrefetchStatus(topicKey: string, mode: LessonDurationMode): PrefetchStatus {
  return getStatuses(topicKey)[mode];
}

/**
 * Get statuses for all modes of a topic.
 */
export function getAllPrefetchStatuses(topicKey: string): Record<LessonDurationMode, PrefetchStatus> {
  return { ...getStatuses(topicKey) };
}

/**
 * Check if a specific mode is ready to start (structure exists in cache, even if fallback).
 */
export function isReadyToStart(
  topicKey: string,
  mode: LessonDurationMode,
  userId: string,
  contentHash?: string,
): boolean {
  const status = getPrefetchStatus(topicKey, mode);
  if (status.state === 'ready') return true;

  // Also check cache directly (another tab might have populated it)
  const v2Key = structureCacheKey(topicKey, mode, contentHash);
  const cached = readCachedJson<TeachingStructure | null>(v2Key, null);
  if (cached?.boards?.length) {
    setModeStatus(topicKey, mode, { state: 'ready' });
    return true;
  }

  // Check legacy key
  const v1Key = `live_teach_structure_v1_${userId || 'anon'}_${topicKey}_${mode}min`;
  const v1 = readCachedJson<TeachingStructure | null>(v1Key, null);
  if (v1?.boards?.length) {
    setModeStatus(topicKey, mode, { state: 'ready' });
    return true;
  }

  return false;
}

// ── Subscription API ─────────────────────────────────────────────────────────

/**
 * Subscribe to status changes for a topic. Returns an unsubscribe function.
 */
export function subscribeToStatus(topicKey: string, cb: StatusCallback): () => void {
  if (!listeners.has(topicKey)) {
    listeners.set(topicKey, new Set());
  }
  listeners.get(topicKey)!.add(cb);

  // Immediately fire with current state
  try {
    cb({ ...getStatuses(topicKey) });
  } catch {}

  return () => {
    const subs = listeners.get(topicKey);
    if (subs) {
      subs.delete(cb);
      if (subs.size === 0) listeners.delete(topicKey);
    }
  };
}

/**
 * Get a structure from cache for the given topic+mode (for SessionView to consume).
 */
export function getCachedStructure(
  topicKey: string,
  mode: LessonDurationMode,
  userId: string,
  contentHash?: string,
): TeachingStructure | null {
  const v2Key = structureCacheKey(topicKey, mode, contentHash);
  const v2 = readCachedJson<TeachingStructure | null>(v2Key, null);
  if (v2?.boards?.length) return v2;

  const v1Key = `live_teach_structure_v1_${userId || 'anon'}_${topicKey}_${mode}min`;
  const v1 = readCachedJson<TeachingStructure | null>(v1Key, null);
  if (v1?.boards?.length) return v1;

  // Old key format
  return null;
}
