/**
 * Lesson Prep Service — Durable background preparation for Live Whiteboard Lessons.
 *
 * Survives page navigation, component unmounts, and reloads.
 * Key: ${userId}::${topicKey}::${durationMode}
 *
 * FULL-TOPIC pipeline (for the selected duration only):
 *  1/3 Planning lesson structure…
 *  2/3 Writing Board i/N content…      (every board, in order)
 *  3/3 Generating Board i/N audio…     (every board, in order)
 *
 * "Ready" ONLY when the structure + ALL boards + ALL board audio are persisted
 * on the device (IndexedDB via lessonPackageStore + engine caches). Opening a
 * Ready lesson performs ZERO structure/board/TTS network calls — playback is
 * served from the device package (IndexedDB → engine memory caches).
 */

import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import type { TeachingStructure, TeachingBoardPerformance } from '../types/teachingScript';
import type { AppSettings, UserProfile, Notification as NotificationType } from '../types';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { buildTopicKey, buildContentHash, structureCacheKey } from './structurePrefetchService';
import { unifiedVoiceRouter } from './voice/UnifiedVoiceRouter';
import { logTeachingEvent } from './teachingEventLogger';
import { supabase } from '../lib/supabaseClient';
import { setCachedBoardItem } from './teachingEngineService';
import {
  getLessonStructure,
  getLessonBoard,
  getLessonAudio,
  getLessonMeta,
  saveLessonStructure,
  saveLessonBoard,
  saveLessonAudio,
  saveLessonMeta,
  evictOldLessonPackages,
} from './lessonPackageStore';
import {
  getMeta as getCheckpointMeta,
} from './lessonPrepCheckpointStore';

export type LessonPrepState = 'idle' | 'preparing' | 'paused_offline' | 'ready' | 'failed';

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
  /** 1-based index of the board currently being prepared (steps 2/3) */
  boardIndex?: number;
  totalBoards?: number;
  /** 0–100 overall prep progress for progress bars */
  progressPercent?: number;
  /** Voice used for the prepared audio (TTS cache keys include it) */
  voice?: string;
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

export interface ReadyLessonPackage {
  structure: TeachingStructure;
  boards: TeachingBoardPerformance[];
  /** TTS cache key → audio payload (base64 + timestamps) */
  audio: Record<string, any>;
  voice: string;
  totalBoards: number;
}

type StatusListener = (status: LessonPrepStatus) => void;

// ── Storage Keys ─────────────────────────────────────────────────────────────
const STORAGE_KEY_STATUSES = 'avelut_lesson_prep_statuses_v1';
const STORAGE_KEY_BILLED = 'avelut_lesson_prep_billed_v1';

// ── Key Helpers ──────────────────────────────────────────────────────────────
export function buildPrepKey(userId: string | undefined, topicKey: string, durationMode: LessonDurationMode): string {
  const cleanUid = (userId || 'anon').trim();
  return `${cleanUid}::${topicKey}::${durationMode}`;
}

/** TTS cache key — must match TeachingEngineService.playBoardSpeech exactly. */
export function buildBoardTtsCacheKey(
  topic: string,
  mode: LessonDurationMode | number,
  boardNumber: number,
  voice: string
): string {
  return `tts_perf_${topic}_${mode}_${boardNumber}_${voice}`;
}

/** Engine board perf cache key — must match getLocalCacheKey('perf', …) exactly. */
function getPerfCacheKey(topic: string, mode: LessonDurationMode | number, boardNumber: number): string {
  const cleanTopic = (topic || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  return `avelut_board_cache_perf_${cleanTopic}_${mode}_${boardNumber}`;
}

function isValidPerf(perf: TeachingBoardPerformance | null | undefined): boolean {
  return !!perf && !!(perf.title || perf.speech || perf.board_actions);
}

function readEnginePerfCache(topic: string, mode: LessonDurationMode | number, boardNumber: number): TeachingBoardPerformance | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(getPerfCacheKey(topic, mode, boardNumber));
    if (raw) return JSON.parse(raw) as TeachingBoardPerformance;
  } catch {}
  return null;
}

function estimateEta(remainingBoards: number): string {
  if (remainingBoards <= 0) return 'Finishing…';
  const low = Math.max(1, Math.round(remainingBoards * 0.5));
  const high = Math.max(2, Math.round(remainingBoards * 0.9));
  return low === high ? `~${low} min` : `~${low}–${high} min`;
}

// ── Singleton State ──────────────────────────────────────────────────────────
const statusMap = new Map<string, LessonPrepStatus>();
const listeners = new Map<string, Set<StatusListener>>();
const activeControllers = new Map<string, AbortController>();
const readyPackageCache = new Map<string, ReadyLessonPackage>();
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
          // A persisted 'preparing' status is always orphaned after a reload —
          // the module-level pipeline died with the page. Mark failed so the
          // user can retry (retry resumes from the on-device package).
          if (status.state === 'preparing') {
            status.state = 'failed';
            status.error = 'Preparation was interrupted. Tap retry to resume where it left off.';
            status.message = 'Preparation interrupted.';
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

// ── Public API ───────────────────────────────────────────────────────────────

export class LessonPrepService {
  private isAutoResumeBound = false;

  constructor() {
    loadPersistedStatuses();
    // Reconcile persisted statuses with the on-device package store (async).
    void this.reconcileDeviceStatuses();
    this.bindAutoResumeListener();
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

  /**
   * Resumes any preparation that was paused offline or interrupted with partial progress.
   */
  public async resumePendingPreps(): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const keys = Array.from(statusMap.keys());
    for (const key of keys) {
      if (activeControllers.has(key)) continue;
      const status = statusMap.get(key);
      const checkpointMeta = await getCheckpointMeta(key);

      if (
        status?.state === 'paused_offline' ||
        status?.state === 'failed' ||
        checkpointMeta?.state === 'paused_offline' ||
        checkpointMeta?.state === 'failed' ||
        (checkpointMeta && checkpointMeta.state !== 'ready' && checkpointMeta.nextIndex > 0)
      ) {
        if (!checkpointMeta) continue;
        console.log('[LessonPrepService] Auto-resuming prep for key:', key);
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
   * Check if a lesson is fully ready on device.
   * Ready = structure + ALL boards + ALL board audio persisted (IndexedDB).
   */
  public isReady(key: string): boolean {
    const status = this.getStatus(key);
    return status.state === 'ready';
  }

  /**
   * Async device verification: returns the complete on-device package
   * (structure + every board + every board's audio) or null if incomplete.
   * Falls back to the legacy localStorage engine caches when IndexedDB is empty.
   */
  public async loadReadyPackage(key: string, preferredVoice?: string): Promise<ReadyLessonPackage | null> {
    const parts = key.split('::');
    if (parts.length < 3) return null;
    const topicKey = parts[1];
    const mode = parseInt(parts[2], 10) as LessonDurationMode;

    const meta = await getLessonMeta(key);
    const voiceCandidates = Array.from(
      new Set([meta?.voice, preferredVoice].filter((v): v is string => !!v))
    );
    if (voiceCandidates.length === 0) voiceCandidates.push('Altair');

    // Structure: IndexedDB → localStorage cache
    let structure = await getLessonStructure<TeachingStructure>(key);
    if (!structure?.boards?.length) {
      structure = readCachedJson<TeachingStructure | null>(structureCacheKey(topicKey, mode), null);
    }
    if (!structure?.boards?.length) return null;

    const total = structure.boards.length;
    const topic = structure.topic || topicKey;

    // Boards: IndexedDB → engine localStorage cache
    const boards: TeachingBoardPerformance[] = [];
    for (let i = 0; i < total; i++) {
      let perf = await getLessonBoard<TeachingBoardPerformance>(key, i);
      if (!isValidPerf(perf)) {
        perf = readEnginePerfCache(topic, mode, i + 1);
      }
      if (!isValidPerf(perf)) return null; // incomplete → not ready
      boards.push(perf!);
    }

    // Audio: IndexedDB per board (only boards that actually have speech),
    // for any candidate voice
    const audio: Record<string, any> = {};
    for (let n = 1; n <= total; n++) {
      const boardPerf = boards[n - 1];
      if (!boardPerf?.speech?.trim()) continue; // no speech → no audio needed
      let found: any = null;
      for (const v of voiceCandidates) {
        const ck = buildBoardTtsCacheKey(topic, mode, n, v);
        const payload = await getLessonAudio<any>(ck);
        if (payload?.audio) {
          audio[ck] = payload;
          found = payload;
          break;
        }
      }
      if (!found) return null; // incomplete → not ready
    }

    const pkg: ReadyLessonPackage = {
      structure,
      boards,
      audio,
      voice: voiceCandidates[0],
      totalBoards: total,
    };
    readyPackageCache.set(key, pkg);
    return pkg;
  }

  /**
   * Hydrate engine caches from a device package so opening the lesson performs
   * ZERO board/TTS network calls:
   *  - board perfs → engine localStorage perf keys (loadBoardPerformance hits)
   *  - audio payloads → voice engine memory caches (playSpeech hits)
   */
  public hydrateLessonPackageCaches(pkg: ReadyLessonPackage): void {
    if (typeof window === 'undefined') return;
    const { structure, boards, audio } = pkg;
    const mode = structure.duration_minutes || 30;
    const topic = structure.topic;

    boards.forEach((perf, idx) => {
      if (!isValidPerf(perf)) return;
      try {
        localStorage.setItem(getPerfCacheKey(topic, mode, idx + 1), JSON.stringify(perf));
      } catch {
        // Quota — the engine's offline board map still covers playback.
      }
    });

    Object.entries(audio).forEach(([cacheKey, payload]) => {
      try {
        unifiedVoiceRouter.primeSpeechCache(cacheKey, payload, { voice: pkg.voice });
      } catch {}
    });
  }

  /**
   * LEGACY sync payload (structure + Board 1 perf from local caches).
   * Prefer `loadReadyPackage` for the full on-device package.
   */
  public getReadyPayload(key: string): {
    structure: TeachingStructure | null;
    board1Perf: TeachingBoardPerformance | null;
    audioCached: boolean;
  } | null {
    // Prefer the in-memory device package (populated by loadReadyPackage)
    const cachedPkg = readyPackageCache.get(key);
    if (cachedPkg?.structure?.boards?.length) {
      return {
        structure: cachedPkg.structure,
        board1Perf: cachedPkg.boards[0] || null,
        audioCached: true,
      };
    }

    const parts = key.split('::');
    if (parts.length < 3) return null;
    const topicKey = parts[1];
    const mode = parseInt(parts[2], 10) as LessonDurationMode;

    const structKey = structureCacheKey(topicKey, mode);
    const struct = readCachedJson<TeachingStructure | null>(structKey, null);
    if (!struct?.boards?.length) return null;

    let board1Perf: TeachingBoardPerformance | null = null;
    try {
      board1Perf = readEnginePerfCache(struct.topic || topicKey, mode, 1);
    } catch {}

    return {
      structure: struct,
      board1Perf,
      audioCached: !!board1Perf,
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
   * Starts cloud preparation via Edge Function `lesson-prep-enqueue`,
   * listens for realtime updates, downloads and installs package on completion.
   */
  public async startPrep(params: StartPrepParams): Promise<void> {
    loadPersistedStatuses();
    const { topicTitle, courseName, syllabusContext, durationMode, userProfile, appSettings, voice } = params;
    const resolvedUserId = params.userId || userProfile?.uid || 'anon';
    const topicKey = buildTopicKey(topicTitle, courseName);
    const contentHash = buildContentHash(topicTitle, courseName, syllabusContext);
    const key = buildPrepKey(resolvedUserId, topicKey, durationMode);

    // If local device package is already ready, present it
    const pkg = await this.loadReadyPackage(key, voice);
    if (pkg) {
      updateStatus(key, {
        state: 'ready',
        step: 3,
        message: 'Lesson ready!',
        etaMinutes: '0 min',
        structure: pkg.structure,
        board1Perf: pkg.boards[0] || null,
        audioCached: true,
        boardIndex: pkg.totalBoards,
        totalBoards: pkg.totalBoards,
        progressPercent: 100,
      });
      return;
    }

    if (activeControllers.has(key)) return;

    const resolvedVoice = voice || appSettings?.grok_voice_id || 'Altair';
    const abortController = new AbortController();
    activeControllers.set(key, abortController);

    // Billed once per key
    if (!isPrepBilled(key)) {
      markPrepBilled(key);
    }

    updateStatus(key, {
      state: 'preparing',
      step: 1,
      message: '1/3 Enqueueing cloud preparation…',
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
      metadata: { userId: resolvedUserId, pipeline: 'cloud_lesson_prep' },
    });

    try {
      // Get current Supabase session token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        throw new Error('Please sign in to prepare live lessons.');
      }

      // Enqueue job on Supabase Edge Function
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
      const enqueueRes = await fetch(`${supabaseUrl}/functions/v1/lesson-prep-enqueue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topicTitle,
          courseName,
          syllabusContext,
          durationMode,
          voice: resolvedVoice,
          contentHash,
        }),
      });

      if (!enqueueRes.ok) {
        const errJson = await enqueueRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Enqueue failed with status ${enqueueRes.status}`);
      }

      const enqueueData = await enqueueRes.json();
      const job = enqueueData.job;
      if (!job) throw new Error('Cloud prep enqueue returned no job row.');

      // Poll/Subscribe to job status until ready or failed
      await new Promise<void>((resolve, reject) => {
        let isDone = false;

        const checkJob = async () => {
          if (isDone || abortController.signal.aborted) return;
          const { data: currentJob, error: pollErr } = await supabase
            .from('lesson_prep_jobs')
            .select('*')
            .eq('prep_key', key)
            .maybeSingle();

          if (pollErr || !currentJob) return;

          const progress = currentJob.progress_percent || 10;
          const phase = currentJob.phase || 'queued';
          const step = phase === 'structure' ? 1 : phase === 'boards' ? 2 : 3;

          updateStatus(key, {
            state: currentJob.status === 'ready' ? 'ready' : currentJob.status === 'failed' ? 'failed' : 'preparing',
            step,
            message: currentJob.message || 'Preparing cloud package…',
            boardIndex: currentJob.next_board_index ? currentJob.next_board_index + 1 : 1,
            totalBoards: currentJob.total_boards || 15,
            progressPercent: currentJob.status === 'ready' ? 95 : progress,
            error: currentJob.last_error || undefined,
          });

          if (currentJob.status === 'ready') {
            isDone = true;
            cleanup();
            resolve();
          } else if (currentJob.status === 'failed') {
            isDone = true;
            cleanup();
            reject(new Error(currentJob.last_error || 'Cloud lesson preparation failed.'));
          }
        };

        const pollTimer = setInterval(checkJob, 2000);

        const channel = supabase
          .channel(`prep_job_${key}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'lesson_prep_jobs',
              filter: `prep_key=eq.${key}`,
            },
            (payload) => {
              const updated = payload.new as any;
              if (!updated) return;
              void checkJob();
            }
          )
          .subscribe();

        const cleanup = () => {
          clearInterval(pollTimer);
          supabase.removeChannel(channel);
        };

        if (abortController.signal.onabort) {
          abortController.signal.onabort = () => {
            isDone = true;
            cleanup();
            reject(new Error('Cancelled'));
          };
        }

        void checkJob();
      });

      if (abortController.signal.aborted) throw new Error('Cancelled');

      // Job is READY in cloud -> Download files and install into IndexedDB stores
      updateStatus(key, {
        state: 'preparing',
        step: 3,
        message: 'Downloading lesson package to device…',
        progressPercent: 96,
      });

      const cleanPrefix = `${resolvedUserId}/${key}`;

      // Download structure.json
      const { data: structBlob, error: structErr } = await supabase.storage
        .from('lesson-packages')
        .download(`${cleanPrefix}/structure.json`);
      if (structErr || !structBlob) throw new Error(`Failed to download structure: ${structErr?.message}`);
      const structureJson: TeachingStructure = JSON.parse(await structBlob.text());

      // Download manifest.json
      const { data: manifestBlob, error: manifestErr } = await supabase.storage
        .from('lesson-packages')
        .download(`${cleanPrefix}/manifest.json`);
      if (manifestErr || !manifestBlob) throw new Error(`Failed to download manifest: ${manifestErr?.message}`);
      const manifest: any = JSON.parse(await manifestBlob.text());

      const total = structureJson.boards?.length || manifest.total_boards || 15;
      const topic = structureJson.topic || topicTitle;

      await saveLessonStructure(key, structureJson);

      // Download each board JSON & audio payload
      for (let i = 0; i < total; i++) {
        if (abortController.signal.aborted) throw new Error('Cancelled');
        const boardNum = i + 1;
        const pad = String(boardNum).padStart(3, '0');

        // Download board JSON
        const { data: boardBlob } = await supabase.storage
          .from('lesson-packages')
          .download(`${cleanPrefix}/boards/board_${pad}.json`);
        if (boardBlob) {
          const boardPerf: TeachingBoardPerformance = JSON.parse(await boardBlob.text());
          await saveLessonBoard(key, i, boardPerf);

          // Save to engine cache so legacy readers hit it immediately
          const perfCacheKey = getPerfCacheKey(topic, durationMode, boardNum);
          setCachedBoardItem(perfCacheKey, boardPerf);
        }

        // Download audio payload JSON
        const { data: audioJsonBlob } = await supabase.storage
          .from('lesson-packages')
          .download(`${cleanPrefix}/audio/board_${pad}.json`);
        if (audioJsonBlob) {
          const audioPayload = JSON.parse(await audioJsonBlob.text());
          const ttsCacheKey = buildBoardTtsCacheKey(topic, durationMode, boardNum, resolvedVoice);
          await saveLessonAudio(ttsCacheKey, audioPayload);
          unifiedVoiceRouter.primeSpeechCache(ttsCacheKey, audioPayload, { voice: resolvedVoice });
        }
      }

      await saveLessonMeta({
        key,
        state: 'ready',
        voice: resolvedVoice,
        topic,
        topicTitle,
        courseName,
        durationMode,
        boardCount: total,
        progress: { boardIndex: total - 1, totalBoards: total },
        audioKeys: structureJson.boards.map((_, i) => buildBoardTtsCacheKey(topic, durationMode, i + 1, resolvedVoice)),
        createdAt: Date.now(),
        readyAt: Date.now(),
      });

      const installedPkg = await this.loadReadyPackage(key, resolvedVoice);

      updateStatus(key, {
        state: 'ready',
        step: 3,
        message: 'Lesson ready!',
        etaMinutes: '0 min',
        structure: installedPkg?.structure || structureJson,
        board1Perf: installedPkg?.boards[0] || null,
        audioCached: true,
        boardIndex: total,
        totalBoards: total,
        progressPercent: 100,
      });

      logTeachingEvent({
        type: 'prefetch_complete',
        topic: topicTitle,
        duration: durationMode,
        metadata: { userId: resolvedUserId, pipeline: 'cloud_lesson_prep_download', totalBoards: total },
      });

      dispatchReadyNotifications({
        userId: resolvedUserId,
        topicTitle,
        courseName,
        durationMode,
        key,
      });

      void evictOldLessonPackages();
    } catch (err: any) {
      if (err?.message === 'Cancelled' || abortController.signal.aborted) return;
      console.error('[LessonPrepService] Cloud prep failed for', key, err);

      updateStatus(key, {
        state: 'failed',
        step: 1,
        message: 'Preparation failed. Tap Resume preparation to retry.',
        error: err?.message || 'Preparation failed.',
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

  /**
   * Reconciles persisted statuses with the on-device package store:
   *  - statuses claiming 'ready' without a ready device package → idle (re-prepare)
   *  - device packages marked 'ready' whose status was lost → ready again
   */
  private async reconcileDeviceStatuses(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const keys = Array.from(statusMap.keys());
      await Promise.all(
        keys.map(async (key) => {
          const status = statusMap.get(key);
          if (!status) return;
          const meta = await getLessonMeta(key);

          if (status.state === 'ready') {
            if (!meta || meta.state !== 'ready') {
              // Legacy (board-1-only) or evicted package — no longer fully ready
              updateStatus(key, {
                state: 'idle',
                step: 1,
                message: 'Lesson package needs preparation.',
                etaMinutes: '2–4 minutes',
                structure: undefined,
                board1Perf: undefined,
                audioCached: false,
                boardIndex: undefined,
                totalBoards: undefined,
                progressPercent: undefined,
              });
            }
          } else if (status.state !== 'preparing' && meta?.state === 'ready') {
            // Device package is ready but the status was lost (e.g. cleared localStorage)
            updateStatus(key, {
              state: 'ready',
              step: 3,
              message: 'Lesson ready!',
              etaMinutes: '0 min',
              audioCached: true,
              totalBoards: meta.boardCount,
              boardIndex: Math.max(0, (meta.boardCount || 1) - 1),
              progressPercent: 100,
              voice: meta.voice,
            });
          }
        })
      );
    } catch (e) {
      console.warn('[LessonPrepService] Device status reconciliation error:', e);
    }
  }
}

export const lessonPrepService = new LessonPrepService();