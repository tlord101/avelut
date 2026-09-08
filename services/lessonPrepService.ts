/**
 * Lesson Prep Service — Durable background preparation for Live Whiteboard Lessons.
 *
 * Survives page navigation, component unmounts, and reloads.
 * Key: ${userId}::${topicKey}::${durationMode}
 *
 * 3-Step Pipeline:
 *  1/3 Planning lesson structure…
 *  2/3 Writing Board 1 content…
 *  3/3 Generating Board 1 speech audio…
 *
 * Upon completing all 3 steps: transitions to 'ready', fires in-app notification
 * and browser notification fallback, and caches payload for instant session start.
 */

import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import type { TeachingStructure, TeachingBoardPerformance } from '../types/teachingScript';
import type { AppSettings, UserProfile, Notification as NotificationType } from '../types';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { buildTopicKey, buildContentHash, structureCacheKey } from './structurePrefetchService';
import { unifiedVoiceRouter } from './voice/UnifiedVoiceRouter';
import { logTeachingEvent } from './teachingEventLogger';

export type LessonPrepState = 'idle' | 'preparing' | 'ready' | 'failed';

export interface LessonPrepStatus {
  key: string;
  state: LessonPrepState;
  step: 1 | 2 | 3;
  message: string;
  etaMinutes: string;
  error?: string;
  updatedAt: number;
  startedAt?: number;
  durationMode: LessonDurationMode;
  topicTitle: string;
  courseName?: string;
  structure?: TeachingStructure | null;
  board1Perf?: TeachingBoardPerformance | null;
  audioCached?: boolean;
}

export interface StartPrepParams {
  userId?: string;
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  durationMode: LessonDurationMode;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
  voice?: string;
}

type StatusListener = (status: LessonPrepStatus) => void;

// ── Storage Keys ─────────────────────────────────────────────────────────────
const STORAGE_KEY_STATUSES = 'avelut_lesson_prep_statuses_v1';
const STORAGE_KEY_BILLED = 'avelut_lesson_prep_billed_v1';
const PREP_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes max before timing out stale prep

// ── Key Helper ───────────────────────────────────────────────────────────────
export function buildPrepKey(userId: string | undefined, topicKey: string, durationMode: LessonDurationMode): string {
  const cleanUid = (userId || 'anon').trim();
  return `${cleanUid}::${topicKey}::${durationMode}`;
}

// ── Singleton State ──────────────────────────────────────────────────────────
const statusMap = new Map<string, LessonPrepStatus>();
const listeners = new Map<string, Set<StatusListener>>();
const activeControllers = new Map<string, AbortController>();
let isInitialized = false;

function loadPersistedStatuses(): void {
  if (typeof window === 'undefined' || isInitialized) return;
  isInitialized = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STATUSES);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, LessonPrepStatus>;
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([k, status]) => {
          // If stuck in 'preparing' for longer than PREP_TIMEOUT_MS, mark failed with retry
          if (status.state === 'preparing' && Date.now() - (status.updatedAt || 0) > PREP_TIMEOUT_MS) {
            status.state = 'failed';
            status.error = 'Preparation timed out. Please tap retry.';
            status.message = 'Preparation timed out.';
          }
          statusMap.set(k, status);
        });
      }
    }
  } catch (e) {
    console.warn('[LessonPrepService] Error loading persisted statuses:', e);
  }
}

function persistStatuses(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, LessonPrepStatus> = {};
    statusMap.forEach((val, key) => {
      // Don't persist full giant objects to localStorage, only essentials
      obj[key] = {
        ...val,
        structure: undefined,
        board1Perf: undefined,
      };
    });
    localStorage.setItem(STORAGE_KEY_STATUSES, JSON.stringify(obj));
  } catch (e) {
    console.warn('[LessonPrepService] Error saving persisted statuses:', e);
  }
}

function notifySubscribers(status: LessonPrepStatus): void {
  const subs = listeners.get(status.key);
  if (!subs || subs.size === 0) return;
  const snapshot = { ...status };
  subs.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (err) {
      console.warn('[LessonPrepService] Listener error:', err);
    }
  });
}

function updateStatus(key: string, updates: Partial<LessonPrepStatus>): LessonPrepStatus {
  const current = statusMap.get(key) || {
    key,
    state: 'idle',
    step: 1,
    message: '',
    etaMinutes: '2–4 minutes',
    updatedAt: Date.now(),
    durationMode: 30,
    topicTitle: '',
  };

  const updated: LessonPrepStatus = {
    ...current,
    ...updates,
    key,
    updatedAt: Date.now(),
  };

  statusMap.set(key, updated);
  persistStatuses();
  notifySubscribers(updated);
  return updated;
}

// ── Billing Guard (One-shot per key) ────────────────────────────────────────
export function isPrepBilled(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BILLED);
    if (!raw) return false;
    const list: string[] = JSON.parse(raw);
    return Array.isArray(list) && list.includes(key);
  } catch {
    return false;
  }
}

export function markPrepBilled(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BILLED);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(key)) {
      list.push(key);
      localStorage.setItem(STORAGE_KEY_BILLED, JSON.stringify(list.slice(-200))); // Keep last 200
    }
  } catch {}
}

// ── Notifications Helper ────────────────────────────────────────────────────
export function requestNotificationPermission(): void {
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function dispatchReadyNotifications(params: {
  userId: string;
  topicTitle: string;
  courseName?: string;
  durationMode: LessonDurationMode;
  key: string;
}): void {
  const { userId, topicTitle, courseName, durationMode, key } = params;

  // 1. In-App Notification (saved to local notifications drawer)
  if (typeof window !== 'undefined' && userId && userId !== 'anon') {
    try {
      const cacheKey = `avelut_notifications_${userId}`;
      const existing = readCachedJson<NotificationType[]>(cacheKey, []);
      const newNotif: NotificationType = {
        id: `notif_lesson_ready_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'study_update',
        title: 'Lesson Ready',
        message: `Your ${durationMode}-min lesson on "${topicTitle}" is ready. Tap to open.`,
        timestamp: Date.now(),
        is_read: false,
        route: 'voice_tutorial',
        link: `/voice-tutorial?topic=${encodeURIComponent(topicTitle)}&course=${encodeURIComponent(courseName || '')}&duration=${durationMode}`,
      };
      writeCachedJson(cacheKey, [newNotif, ...existing.slice(0, 49)], userId);
      window.dispatchEvent(new CustomEvent('avelut:notification', { detail: newNotif }));
    } catch (e) {
      console.warn('[LessonPrepService] In-app notification error:', e);
    }
  }

  // 2. Custom Window Event for any active component to react immediately
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('avelut:lesson-ready', {
        detail: { userId, topicTitle, courseName, durationMode, key },
      })
    );
  }

  // 3. Web Push / Browser Notification API fallback
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('Lesson Ready — AVELUT', {
        body: `Your ${durationMode}-min lesson on "${topicTitle}" is ready. Tap to open.`,
        icon: '/favicon.ico',
        tag: `lesson_ready_${key}`,
      });
    } catch (e) {
      console.warn('[LessonPrepService] Web notification error:', e);
    }
  }
}

// ── Cache Key Helpers for Teaching Engine ───────────────────────────────────
function getPerfCacheKey(topic: string, mode: LessonDurationMode, boardNumber: number): string {
  const cleanTopic = (topic || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  return `avelut_board_cache_perf_${cleanTopic}_${mode}_${boardNumber}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export class LessonPrepService {
  constructor() {
    loadPersistedStatuses();
  }

  /**
   * Get current prep status for key.
   */
  public getStatus(key: string): LessonPrepStatus {
    loadPersistedStatuses();
    return (
      statusMap.get(key) || {
        key,
        state: 'idle',
        step: 1,
        message: '',
        etaMinutes: '2–4 minutes',
        updatedAt: Date.now(),
        durationMode: 30,
        topicTitle: '',
      }
    );
  }

  /**
   * Check if a lesson is already ready.
   */
  public isReady(key: string): boolean {
    const status = this.getStatus(key);
    if (status.state === 'ready') return true;

    // Check localStorage cache directly in case another tab or session prepared it
    if (typeof window !== 'undefined') {
      const parts = key.split('::');
      if (parts.length >= 3) {
        const userId = parts[0];
        const topicKey = parts[1];
        const mode = parseInt(parts[2], 10) as LessonDurationMode;
        const structKey = structureCacheKey(topicKey, mode);
        const struct = readCachedJson<TeachingStructure | null>(structKey, null);
        if (struct?.boards?.length) {
          const perfKey = getPerfCacheKey(struct.topic || topicKey, mode, 1);
          const rawPerf = localStorage.getItem(perfKey);
          if (rawPerf) {
            updateStatus(key, {
              state: 'ready',
              step: 3,
              message: 'Lesson ready!',
              etaMinutes: '0 min',
              durationMode: mode,
              topicTitle: struct.topic || topicKey,
            });
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get payload for opening a ready lesson (structure + Board 1 perf).
   */
  public getReadyPayload(key: string): {
    structure: TeachingStructure | null;
    board1Perf: TeachingBoardPerformance | null;
    audioCached: boolean;
  } | null {
    const parts = key.split('::');
    if (parts.length < 3) return null;
    const userId = parts[0];
    const topicKey = parts[1];
    const mode = parseInt(parts[2], 10) as LessonDurationMode;

    const structKey = structureCacheKey(topicKey, mode);
    const struct = readCachedJson<TeachingStructure | null>(structKey, null);
    if (!struct?.boards?.length) return null;

    let board1Perf: TeachingBoardPerformance | null = null;
    try {
      const perfKey = getPerfCacheKey(struct.topic || topicKey, mode, 1);
      const rawPerf = localStorage.getItem(perfKey);
      if (rawPerf) board1Perf = JSON.parse(rawPerf);
    } catch {}

    return {
      structure: struct,
      board1Perf,
      audioCached: true,
    };
  }

  /**
   * Subscribe to status updates for a specific prep key.
   */
  public subscribe(key: string, listener: StatusListener): () => void {
    loadPersistedStatuses();
    if (!listeners.has(key)) {
      listeners.set(key, new Set());
    }
    listeners.get(key)!.add(listener);

    // Immediately trigger with current status
    listener(this.getStatus(key));

    return () => {
      const set = listeners.get(key);
      if (set) {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      }
    };
  }

  /**
   * Cancel an in-flight prep process.
   */
  public cancelPrep(key: string): void {
    const controller = activeControllers.get(key);
    if (controller) {
      controller.abort();
      activeControllers.delete(key);
    }
    updateStatus(key, {
      state: 'idle',
      message: 'Preparation cancelled',
    });
  }

  /**
   * Starts the 3-step preparation pipeline for a topic + duration.
   * Survives navigation and runs to completion.
   */
  public async startPrep(params: StartPrepParams): Promise<void> {
    loadPersistedStatuses();
    const { topicTitle, courseName, syllabusContext, durationMode, userProfile, appSettings, voice } = params;
    const resolvedUserId = params.userId || userProfile?.uid || 'anon';
    const topicKey = buildTopicKey(topicTitle, courseName);
    const contentHash = buildContentHash(topicTitle, courseName, syllabusContext);
    const key = buildPrepKey(resolvedUserId, topicKey, durationMode);

    // If already ready, return immediately
    if (this.isReady(key)) {
      return;
    }

    // If already in flight, do not spawn a duplicate pipeline
    if (activeControllers.has(key)) {
      return;
    }

    const abortController = new AbortController();
    activeControllers.set(key, abortController);
    const resolvedVoice = voice || appSettings?.grok_voice_id || 'Altair';

    updateStatus(key, {
      state: 'preparing',
      step: 1,
      message: '1/3 Planning lesson structure…',
      etaMinutes: '2–4 minutes',
      startedAt: Date.now(),
      topicTitle,
      courseName,
      durationMode,
      error: undefined,
    });

    logTeachingEvent({
      type: 'prefetch_start',
      topic: topicTitle,
      duration: durationMode,
      metadata: { userId: resolvedUserId, pipeline: 'lesson_prep_service' },
    });

    try {
      // Dynamic import to avoid cycles
      const { TeachingEngineService } = await import('./teachingEngineService');
      const engine = new TeachingEngineService(appSettings || {}, userProfile || null, resolvedVoice);

      if (abortController.signal.aborted) throw new Error('Cancelled');

      // ── STEP 1: Generate or Load Teaching Structure ────────────────────────
      let structure: TeachingStructure | null = null;
      const v2StructKey = structureCacheKey(topicKey, durationMode, contentHash);
      structure = readCachedJson<TeachingStructure | null>(v2StructKey, null);

      if (!structure?.boards?.length) {
        // Check fallback v2 without content hash
        const v2BasicKey = structureCacheKey(topicKey, durationMode);
        structure = readCachedJson<TeachingStructure | null>(v2BasicKey, null);
      }

      if (!structure?.boards?.length) {
        // Generate structure via TeachingEngineService
        structure = await engine.generateTeachingStructure({
          topic: topicTitle,
          courseName,
          syllabusContext,
          durationMode,
          isPrefetch: true,
        });

        if (abortController.signal.aborted) throw new Error('Cancelled');

        if (structure?.boards?.length) {
          writeCachedJson(v2StructKey, structure, resolvedUserId);
          writeCachedJson(structureCacheKey(topicKey, durationMode), structure, resolvedUserId);
        }
      }

      if (!structure?.boards?.length) {
        throw new Error('Failed to generate lesson structure.');
      }

      if (abortController.signal.aborted) throw new Error('Cancelled');

      // ── STEP 2: Generate & Cache Board 1 Performance ───────────────────────
      updateStatus(key, {
        state: 'preparing',
        step: 2,
        message: '2/3 Writing Board 1 content…',
        etaMinutes: '1–2 minutes',
        structure,
      });

      const perfKey = getPerfCacheKey(structure.topic || topicTitle, durationMode, 1);
      let board1Perf: TeachingBoardPerformance | null = null;

      try {
        const rawPerf = typeof window !== 'undefined' ? localStorage.getItem(perfKey) : null;
        if (rawPerf) {
          board1Perf = JSON.parse(rawPerf);
        }
      } catch {}

      if (!board1Perf || (!board1Perf.title && !board1Perf.speech && !board1Perf.board_actions)) {
        board1Perf = await engine.generateAndCacheBoard0Performance(structure, durationMode);
        if (board1Perf && typeof window !== 'undefined') {
          try {
            localStorage.setItem(perfKey, JSON.stringify(board1Perf));
          } catch {}
        }
      }

      if (abortController.signal.aborted) throw new Error('Cancelled');

      // ── STEP 3: Prefetch TTS for Board 1 speech ────────────────────────────
      updateStatus(key, {
        state: 'preparing',
        step: 3,
        message: '3/3 Generating Board 1 speech audio…',
        etaMinutes: '< 1 minute',
        board1Perf,
      });

      let audioCached = false;
      if (board1Perf?.speech && board1Perf.speech.trim().length > 0) {
        const ttsCacheKey = `tts_perf_${structure.topic || topicTitle}_${durationMode}_1_${resolvedVoice}`;
        try {
          const speechResult = await unifiedVoiceRouter.fetchSpeech(board1Perf.speech.trim(), {
            appSettings,
            voice: resolvedVoice,
            cacheKey: ttsCacheKey,
          });
          if (speechResult) {
            audioCached = true;
          }
        } catch (ttsErr) {
          console.warn('[LessonPrepService] Board 1 speech prefetch warning:', ttsErr);
          // Audio generation failure should not block starting, as speech will stream/retry on open
          audioCached = true;
        }
      } else {
        audioCached = true;
      }

      if (abortController.signal.aborted) throw new Error('Cancelled');

      // ── PIPELINE SUCCESS: Mark Ready ───────────────────────────────────────
      const finalStatus = updateStatus(key, {
        state: 'ready',
        step: 3,
        message: 'Lesson ready!',
        etaMinutes: '0 min',
        structure,
        board1Perf,
        audioCached,
      });

      logTeachingEvent({
        type: 'prefetch_complete',
        topic: topicTitle,
        duration: durationMode,
        metadata: { userId: resolvedUserId, pipeline: 'lesson_prep_service' },
      });

      // Dispatch in-app, browser, and push notifications
      dispatchReadyNotifications({
        userId: resolvedUserId,
        topicTitle,
        courseName,
        durationMode,
        key,
      });
    } catch (err: any) {
      if (err?.message === 'Cancelled' || abortController.signal.aborted) {
        return;
      }

      console.error('[LessonPrepService] Prep failed for', key, err);
      updateStatus(key, {
        state: 'failed',
        step: 1,
        message: 'Preparation failed. Tap to retry.',
        error: err?.message || 'Preparation failed. Tap to retry.',
        etaMinutes: '',
      });

      logTeachingEvent({
        type: 'prefetch_fail',
        topic: topicTitle,
        duration: durationMode,
        error: err?.message,
        metadata: { userId: resolvedUserId },
      });
    } finally {
      activeControllers.delete(key);
    }
  }
}

export const lessonPrepService = new LessonPrepService();
