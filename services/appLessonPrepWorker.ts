/**
 * App Lesson Prep Worker — In-App background preparation engine for Live Whiteboard Lessons.
 *
 * Runs as a singleton background worker. Survives view navigation and resumes from
 * IndexedDB board checkpoints on reload or network reconnection.
 *
 * Key: ${userId}::${topicKey}::${durationMode}
 *
 * Pipeline:
 *  0. Server-authoritative billing (minutes pool or AI credits)
 *  1. Planning lesson structure (save to IndexedDB + Supabase)
 *  2. Writing Board i/N content (per board checkpoint)
 *  3. Generating Board i/N audio (per board TTS checkpoint)
 *  4. Finalize package & dispatch ready notification
 */

import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import type { TeachingStructure, TeachingBoardPerformance } from '../types/teachingScript';
import type { AppSettings, UserProfile, Notification as NotificationType } from '../types';
import { supabase } from '../lib/supabaseClient';
import { buildTopicKey, buildContentHash } from './structurePrefetchService';
import { unifiedVoiceRouter } from './voice/UnifiedVoiceRouter';
import { logTeachingEvent } from './teachingEventLogger';
import { TeachingEngineService, setCachedBoardItem } from './teachingEngineService';
import {
  saveLessonStructure,
  saveLessonBoard,
  saveLessonAudio,
  saveLessonMeta,
} from './lessonPackageStore';
import {
  getMeta as getCheckpointMeta,
  putMeta as putCheckpointMeta,
  getStructure as getCheckpointStructure,
  putStructure as putCheckpointStructure,
  getBoard as getCheckpointBoard,
  putBoard as putCheckpointBoard,
  getAudio as getCheckpointAudio,
  putAudio as putCheckpointAudio,
} from './lessonPrepCheckpointStore';
import { evaluateLiveTutorialStart, commitLiveTutorialStart } from '../utils/liveTutorialQuota';
import { deductAICredits } from '../utils/usage';
import { readCachedJson, writeCachedJson } from '../utils/cache';

export type WorkerPrepState = 'idle' | 'preparing' | 'paused_offline' | 'ready' | 'failed';

export interface WorkerPrepStatus {
  key: string;
  state: WorkerPrepState;
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
  boardIndex?: number;
  totalBoards?: number;
  progressPercent?: number;
  voice?: string;
}

export interface WorkerStartPrepParams {
  userId?: string;
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  durationMode: LessonDurationMode;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
  voice?: string;
}

type StatusListener = (status: WorkerPrepStatus) => void;

const STORAGE_KEY_STATUSES = 'avelut_lesson_prep_statuses_v1';
const STORAGE_KEY_BILLED = 'avelut_lesson_prep_billed_v1';

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
      localStorage.setItem(STORAGE_KEY_BILLED, JSON.stringify(list.slice(-200)));
    }
  } catch {}
}

export class AppLessonPrepWorker {
  private statusMap = new Map<string, WorkerPrepStatus>();
  private listeners = new Map<string, Set<StatusListener>>();
  private activeControllers = new Map<string, AbortController>();
  private isAutoResumeBound = false;

  constructor() {
    this.loadPersistedStatuses();
    this.bindAutoResumeListener();
  }

  private loadPersistedStatuses(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATUSES);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, WorkerPrepStatus>;
        if (parsed && typeof parsed === 'object') {
          Object.entries(parsed).forEach(([k, status]) => {
            if (status.state === 'preparing') {
              status.state = 'failed';
              status.error = 'Preparation interrupted. Tap retry to resume.';
              status.message = 'Preparation interrupted.';
            }
            this.statusMap.set(k, status);
          });
        }
      }
    } catch (e) {
      console.warn('[AppLessonPrepWorker] Error loading persisted statuses:', e);
    }
  }

  private persistStatuses(): void {
    if (typeof window === 'undefined') return;
    try {
      const obj: Record<string, WorkerPrepStatus> = {};
      this.statusMap.forEach((val, key) => {
        obj[key] = {
          ...val,
          structure: undefined,
          board1Perf: undefined,
        };
      });
      localStorage.setItem(STORAGE_KEY_STATUSES, JSON.stringify(obj));
    } catch (e) {
      console.warn('[AppLessonPrepWorker] Error saving statuses:', e);
    }
  }

  private notifySubscribers(status: WorkerPrepStatus): void {
    const subs = this.listeners.get(status.key);
    if (!subs || subs.size === 0) return;
    const snapshot = { ...status };
    subs.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (err) {
        console.warn('[AppLessonPrepWorker] Listener error:', err);
      }
    });
  }

  public updateStatus(key: string, updates: Partial<WorkerPrepStatus>): WorkerPrepStatus {
    const current = this.statusMap.get(key) || {
      key,
      state: 'idle',
      step: 1,
      message: '',
      etaMinutes: '2–4 minutes',
      updatedAt: Date.now(),
      durationMode: 30,
      topicTitle: '',
    };

    const updated: WorkerPrepStatus = {
      ...current,
      ...updates,
      key,
      updatedAt: Date.now(),
    };

    this.statusMap.set(key, updated);
    this.persistStatuses();
    this.notifySubscribers(updated);
    return updated;
  }

  public getStatus(key: string): WorkerPrepStatus {
    return (
      this.statusMap.get(key) || {
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

  public isReady(key: string): boolean {
    return this.getStatus(key).state === 'ready';
  }

  public subscribe(key: string, listener: StatusListener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);
    listener(this.getStatus(key));

    return () => {
      const set = this.listeners.get(key);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(key);
      }
    };
  }

  public cancelPrep(key: string): void {
    const controller = this.activeControllers.get(key);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(key);
    }
    this.updateStatus(key, {
      state: 'idle',
      message: 'Preparation cancelled',
    });
  }

  private bindAutoResumeListener(): void {
    if (typeof window === 'undefined' || this.isAutoResumeBound) return;
    this.isAutoResumeBound = true;

    let resumeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('online', () => {
      if (resumeDebounceTimer) clearTimeout(resumeDebounceTimer);
      resumeDebounceTimer = setTimeout(() => {
        void this.resumePendingPreps();
      }, 1000);
    });
  }

  public async resumePendingPreps(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const keys = Array.from(this.statusMap.keys());
    for (const key of keys) {
      if (this.activeControllers.has(key)) continue;
      const status = this.statusMap.get(key);
      const checkpointMeta = await getCheckpointMeta(key);

      if (
        status?.state === 'paused_offline' ||
        status?.state === 'failed' ||
        checkpointMeta?.state === 'paused_offline' ||
        checkpointMeta?.state === 'failed' ||
        (checkpointMeta && checkpointMeta.state !== 'ready' && checkpointMeta.nextIndex > 0)
      ) {
        if (!checkpointMeta) continue;
        console.log('[AppLessonPrepWorker] Resuming incomplete prep for key:', key);
        void this.startPrep({
          userId: checkpointMeta.userId,
          topicTitle: checkpointMeta.topicTitle,
          courseName: checkpointMeta.courseName,
          durationMode: checkpointMeta.durationMode,
          voice: checkpointMeta.voice,
        });
      }
    }
  }

  private async syncJobRowToSupabase(params: {
    prepKey: string;
    userId: string;
    topicTitle: string;
    courseName?: string;
    durationMode: LessonDurationMode;
    voice: string;
    contentHash?: string;
    status: string;
    phase: string;
    totalBoards: number;
    nextBoardIndex: number;
    completedBoards: number;
    progressPercent: number;
    message: string;
    charged: boolean;
    lastError?: string;
  }): Promise<void> {
    try {
      const row = {
        prep_key: params.prepKey,
        user_id: params.userId,
        topic_title: params.topicTitle,
        course_name: params.courseName || null,
        duration_mode: params.durationMode,
        voice: params.voice,
        content_hash: params.contentHash || null,
        status: params.status,
        phase: params.phase,
        total_boards: params.totalBoards,
        next_board_index: params.nextBoardIndex,
        completed_boards: params.completedBoards,
        progress_percent: params.progressPercent,
        message: params.message,
        charged: params.charged,
        last_error: params.lastError || null,
        updated_at: new Date().toISOString(),
        ...(params.status === 'ready' ? { ready_at: new Date().toISOString() } : {}),
      };

      await supabase.from('lesson_prep_jobs').upsert(row, { onConflict: 'prep_key' });
    } catch (e) {
      console.warn('[AppLessonPrepWorker] Failed to sync job row to Supabase:', e);
    }
  }

  private dispatchReadyNotifications(params: {
    userId: string;
    topicTitle: string;
    courseName?: string;
    durationMode: LessonDurationMode;
    key: string;
  }): void {
    const { userId, topicTitle, courseName, durationMode, key } = params;

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
        console.warn('[AppLessonPrepWorker] In-app notification error:', e);
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('avelut:lesson-ready', {
          detail: { userId, topicTitle, courseName, durationMode, key },
        })
      );
    }

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Lesson Ready — AVELUT', {
          body: `Your ${durationMode}-min lesson on "${topicTitle}" is ready. Tap to open.`,
          icon: '/favicon.ico',
          tag: `lesson_ready_${key}`,
        });
      } catch (e) {
        console.warn('[AppLessonPrepWorker] Web notification error:', e);
      }
    }
  }

  public async startPrep(params: WorkerStartPrepParams): Promise<void> {
    const { topicTitle, courseName, syllabusContext, durationMode, userProfile, appSettings, voice } = params;
    const resolvedUserId = params.userId || userProfile?.uid || 'anon';
    const topicKey = buildTopicKey(topicTitle, courseName);
    const contentHash = buildContentHash(topicTitle, courseName, syllabusContext);
    const prepKey = `${resolvedUserId}::${topicKey}::${durationMode}`;
    const resolvedVoice = voice || appSettings?.grok_voice_id || 'Altair';

    if (this.activeControllers.has(prepKey)) return;

    const abortController = new AbortController();
    this.activeControllers.set(prepKey, abortController);

    let billed = isPrepBilled(prepKey);

    try {
      if (!billed && resolvedUserId !== 'anon') {
        const decision = evaluateLiveTutorialStart(userProfile, durationMode, appSettings);
        if (!decision.allowed) {
          throw new Error(decision.message || 'Insufficient minute allowance or credits balance.');
        }

        if (decision.payment === 'included') {
          const commitRes = await commitLiveTutorialStart(userProfile!, decision, appSettings);
          if (!commitRes.success) {
            throw new Error(commitRes.error || 'Failed to consume live tutorial minutes from pool.');
          }
        } else if (decision.payment === 'credits') {
          const debitRes = await deductAICredits(
            resolvedUserId,
            decision.creditCost,
            `live_tutorial_${durationMode}`,
            appSettings || undefined
          );
          if (!debitRes.success) {
            throw new Error(debitRes.error || `Failed to charge ${decision.creditCost} credits for ${durationMode}-min lesson.`);
          }
        }

        markPrepBilled(prepKey);
        billed = true;
      }

      this.updateStatus(prepKey, {
        state: 'preparing',
        step: 1,
        message: '1/3 Planning lesson structure…',
        etaMinutes: '2–4 minutes',
        startedAt: Date.now(),
        topicTitle,
        courseName,
        durationMode,
        voice: resolvedVoice,
        error: undefined,
        progressPercent: 5,
      });

      logTeachingEvent({
        type: 'prefetch_start',
        topic: topicTitle,
        duration: durationMode,
        metadata: { userId: resolvedUserId, pipeline: 'in_app_prep_worker' },
      });

      let checkpointMeta = await getCheckpointMeta(prepKey);
      if (!checkpointMeta) {
        checkpointMeta = {
          prepKey,
          userId: resolvedUserId,
          topicKey,
          topicTitle,
          courseName,
          durationMode,
          voice: resolvedVoice,
          state: 'preparing',
          totalBoards: durationMode === 15 ? 8 : durationMode === 60 ? 30 : 15,
          nextIndex: 0,
          completedBoardIndexes: [],
          structureReady: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          charged: billed,
        };
        await putCheckpointMeta(checkpointMeta);
      }

      await this.syncJobRowToSupabase({
        prepKey,
        userId: resolvedUserId,
        topicTitle,
        courseName,
        durationMode,
        voice: resolvedVoice,
        contentHash,
        status: 'running',
        phase: 'structure',
        totalBoards: checkpointMeta.totalBoards,
        nextBoardIndex: checkpointMeta.nextIndex,
        completedBoards: checkpointMeta.completedBoardIndexes.length,
        progressPercent: 10,
        message: '1/3 Planning lesson structure…',
        charged: billed,
      });

      let structure = await getCheckpointStructure(prepKey);
      if (!structure?.boards?.length) {
        const engine = new TeachingEngineService(
          (appSettings || {}) as AppSettings,
          userProfile || null,
          resolvedVoice
        );

        structure = await engine.generateTeachingStructure({
          topic: topicTitle,
          courseName,
          syllabusContext,
          durationMode,
          isPrefetch: true,
        });

        if (!structure?.boards?.length) {
          throw new Error('Failed to generate lesson structure');
        }

        await putCheckpointStructure(prepKey, structure);
        await saveLessonStructure(prepKey, structure);
      }

      const totalBoards = structure.boards.length;
      checkpointMeta.totalBoards = totalBoards;
      checkpointMeta.structureReady = true;
      await putCheckpointMeta(checkpointMeta);

      const engine = new TeachingEngineService(
        (appSettings || {}) as AppSettings,
        userProfile || null,
        resolvedVoice
      );
      engine.hydrateStructure(structure);

      const completedSummaries: string[] = [];

      for (let i = 0; i < totalBoards; i++) {
        if (abortController.signal.aborted) throw new Error('Cancelled');

        const boardPlan = structure.boards[i];
        let boardRecord = await getCheckpointBoard(prepKey, i);

        if (!boardRecord?.performance) {
          this.updateStatus(prepKey, {
            state: 'preparing',
            step: 2,
            message: `2/3 Writing Board ${i + 1}/${totalBoards} content…`,
            boardIndex: i + 1,
            totalBoards,
            progressPercent: 10 + Math.round(((i + 1) / totalBoards) * 40),
          });

          await this.syncJobRowToSupabase({
            prepKey,
            userId: resolvedUserId,
            topicTitle,
            courseName,
            durationMode,
            voice: resolvedVoice,
            contentHash,
            status: 'running',
            phase: 'boards',
            totalBoards,
            nextBoardIndex: i,
            completedBoards: checkpointMeta.completedBoardIndexes.length,
            progressPercent: 10 + Math.round(((i + 1) / totalBoards) * 40),
            message: `Writing Board ${i + 1}/${totalBoards} content…`,
            charged: billed,
          });

          const perf = await engine.fetchSingleBoardFromAI(
            boardPlan,
            userProfile?.display_name || 'Student',
            completedSummaries,
            { mode: 'prep' }
          );

          await putCheckpointBoard(prepKey, i, perf);
          await saveLessonBoard(prepKey, i, perf);

          const perfCacheKey = `avelut_board_cache_perf_${(structure.topic || topicKey).toLowerCase().trim().replace(/[^a-z0-9]/g, '_')}_${durationMode}_${i + 1}`;
          setCachedBoardItem(perfCacheKey, perf);

          if (perf.title) completedSummaries.push(perf.title);
        } else {
          if (boardRecord.performance.title) completedSummaries.push(boardRecord.performance.title);
        }

        if (!checkpointMeta.completedBoardIndexes.includes(i)) {
          checkpointMeta.completedBoardIndexes.push(i);
          checkpointMeta.nextIndex = Math.max(checkpointMeta.nextIndex, i + 1);
          await putCheckpointMeta(checkpointMeta);
        }
      }

      for (let i = 0; i < totalBoards; i++) {
        if (abortController.signal.aborted) throw new Error('Cancelled');

        const boardRecord = await getCheckpointBoard(prepKey, i);
        const perf = boardRecord?.performance;
        if (!perf?.speech?.trim()) continue;

        const ttsCacheKey = `tts_perf_${structure.topic}_${durationMode}_${i + 1}_${resolvedVoice}`;
        let audioRecord = await getCheckpointAudio(prepKey, i);

        if (!audioRecord?.payload) {
          this.updateStatus(prepKey, {
            state: 'preparing',
            step: 3,
            message: `3/3 Generating Board ${i + 1}/${totalBoards} audio…`,
            boardIndex: i + 1,
            totalBoards,
            progressPercent: 50 + Math.round(((i + 1) / totalBoards) * 45),
          });

          await this.syncJobRowToSupabase({
            prepKey,
            userId: resolvedUserId,
            topicTitle,
            courseName,
            durationMode,
            voice: resolvedVoice,
            contentHash,
            status: 'running',
            phase: 'tts',
            totalBoards,
            nextBoardIndex: i,
            completedBoards: totalBoards,
            progressPercent: 50 + Math.round(((i + 1) / totalBoards) * 45),
            message: `Generating Board ${i + 1}/${totalBoards} audio…`,
            charged: billed,
          });

          const audioPayload = await unifiedVoiceRouter.synthesizeSpeech(perf.speech, {
            voice: resolvedVoice,
            mode: durationMode,
            cacheKey: ttsCacheKey,
          });

          if (audioPayload) {
            await putCheckpointAudio(prepKey, i, ttsCacheKey, audioPayload);
            await saveLessonAudio(ttsCacheKey, audioPayload);
            unifiedVoiceRouter.primeSpeechCache(ttsCacheKey, audioPayload, { voice: resolvedVoice });
          }
        } else {
          unifiedVoiceRouter.primeSpeechCache(ttsCacheKey, audioRecord.payload, { voice: resolvedVoice });
        }
      }

      checkpointMeta.state = 'ready';
      checkpointMeta.updatedAt = Date.now();
      await putCheckpointMeta(checkpointMeta);

      await saveLessonMeta({
        key: prepKey,
        state: 'ready',
        voice: resolvedVoice,
        topic: structure.topic,
        topicTitle,
        courseName,
        durationMode,
        boardCount: totalBoards,
        progress: { boardIndex: totalBoards - 1, totalBoards },
        audioKeys: structure.boards.map((_, idx) => `tts_perf_${structure.topic}_${durationMode}_${idx + 1}_${resolvedVoice}`),
        createdAt: checkpointMeta.createdAt,
        readyAt: Date.now(),
      });

      this.updateStatus(prepKey, {
        state: 'ready',
        step: 3,
        message: 'Lesson ready!',
        etaMinutes: '0 min',
        structure,
        board1Perf: (await getCheckpointBoard(prepKey, 0))?.performance || null,
        audioCached: true,
        boardIndex: totalBoards,
        totalBoards,
        progressPercent: 100,
      });

      await this.syncJobRowToSupabase({
        prepKey,
        userId: resolvedUserId,
        topicTitle,
        courseName,
        durationMode,
        voice: resolvedVoice,
        contentHash,
        status: 'ready',
        phase: 'ready',
        totalBoards,
        nextBoardIndex: totalBoards,
        completedBoards: totalBoards,
        progressPercent: 100,
        message: 'Lesson ready!',
        charged: billed,
      });

      logTeachingEvent({
        type: 'prefetch_complete',
        topic: topicTitle,
        duration: durationMode,
        metadata: { userId: resolvedUserId, pipeline: 'in_app_prep_worker', totalBoards },
      });

      this.dispatchReadyNotifications({
        userId: resolvedUserId,
        topicTitle,
        courseName,
        durationMode,
        key: prepKey,
      });
    } catch (err: any) {
      if (err?.message === 'Cancelled' || abortController.signal.aborted) return;
      console.error('[AppLessonPrepWorker] Lesson prep failed:', err);

      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const nextState: WorkerPrepState = isOffline ? 'paused_offline' : 'failed';
      const errMsg = err?.message || 'Preparation failed.';

      this.updateStatus(prepKey, {
        state: nextState,
        step: 1,
        message: isOffline ? 'Paused offline. Will resume when online.' : 'Preparation failed. Tap retry to resume.',
        error: errMsg,
        etaMinutes: '',
      });

      await this.syncJobRowToSupabase({
        prepKey,
        userId: resolvedUserId,
        topicTitle,
        courseName,
        durationMode,
        voice: resolvedVoice,
        contentHash,
        status: nextState,
        phase: 'failed',
        totalBoards: 15,
        nextBoardIndex: 0,
        completedBoards: 0,
        progressPercent: 0,
        message: errMsg,
        charged: billed,
        lastError: errMsg,
      });

      logTeachingEvent({
        type: 'prefetch_fail',
        topic: topicTitle,
        duration: durationMode,
        error: errMsg,
        metadata: { userId: resolvedUserId },
      });
    } finally {
      this.activeControllers.delete(prepKey);
    }
  }
}

export const appLessonPrepWorker = new AppLessonPrepWorker();
