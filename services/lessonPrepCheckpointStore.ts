/**
 * Lesson Prep Checkpoint Store — IndexedDB store for resumable lesson preparation.
 *
 * Database name: avelut_lesson_prep (version 1)
 * Stores:
 *  1. prep_meta — key: prepKey
 *  2. structures — key: prepKey
 *  3. boards — key: ${prepKey}::${boardIndex}
 *  4. audio — key: ${prepKey}::${boardIndex} (or ttsCacheKey)
 */

import type { TeachingStructure, TeachingBoardPerformance } from '../types/teachingScript';

export const PREP_DB_NAME = 'avelut_lesson_prep';
export const PREP_DB_VERSION = 1;

export const STORE_PREP_META = 'prep_meta';
export const STORE_PREP_STRUCTURES = 'structures';
export const STORE_PREP_BOARDS = 'boards';
export const STORE_PREP_AUDIO = 'audio';

export type PrepMetaState = 'idle' | 'preparing' | 'paused_offline' | 'ready' | 'failed';

export interface PrepMeta {
  prepKey: string; // `${userId}::${topicKey}::${durationMode}`
  userId: string;
  topicKey: string;
  topicTitle: string;
  courseName?: string;
  durationMode: 15 | 30 | 60;
  voice: string;
  modelVersion?: string;
  state: PrepMetaState;
  totalBoards: number;
  nextIndex: number; // first board index not fully complete
  completedBoardIndexes: number[];
  structureReady: boolean;
  message?: string;
  lastError?: string;
  updatedAt: number;
  createdAt: number;
  charged?: boolean; // credits already charged for this prepKey
}

export interface PrepBoardRecord {
  prepKey: string;
  boardIndex: number;
  performance: TeachingBoardPerformance;
  isFallback: false;
  savedAt: number;
}

export interface PrepAudioRecord {
  prepKey: string;
  boardIndex: number;
  cacheKey: string;
  payload: any; // audio payload object, Blob, or ArrayBuffer
  mimeType?: string;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openPrepDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(PREP_DB_NAME, PREP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PREP_META)) {
        db.createObjectStore(STORE_PREP_META, { keyPath: 'prepKey' });
      }
      if (!db.objectStoreNames.contains(STORE_PREP_STRUCTURES)) {
        db.createObjectStore(STORE_PREP_STRUCTURES, { keyPath: 'prepKey' });
      }
      if (!db.objectStoreNames.contains(STORE_PREP_BOARDS)) {
        db.createObjectStore(STORE_PREP_BOARDS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_PREP_AUDIO)) {
        db.createObjectStore(STORE_PREP_AUDIO, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function makeBoardKey(prepKey: string, boardIndex: number): string {
  return `${prepKey}::${boardIndex}`;
}

async function idbGet<T = any>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openPrepDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => {
        const row = request.result;
        if (!row) {
          resolve(null);
          return;
        }
        resolve(row.value !== undefined ? (row.value as T) : (row as T));
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(storeName: string, item: any): Promise<boolean> {
  try {
    const db = await openPrepDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB tx aborted'));
    });
    return true;
  } catch (e) {
    console.warn(`[LessonPrepCheckpointStore] idbPut failed (${storeName}):`, e);
    return false;
  }
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  try {
    const db = await openPrepDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

// ── Meta API ─────────────────────────────────────────────────────────────────

export async function getMeta(prepKey: string): Promise<PrepMeta | null> {
  return idbGet<PrepMeta>(STORE_PREP_META, prepKey);
}

export async function putMeta(meta: PrepMeta): Promise<boolean> {
  return idbPut(STORE_PREP_META, { prepKey: meta.prepKey, value: { ...meta, updatedAt: Date.now() } });
}

// ── Structures API ───────────────────────────────────────────────────────────

export async function getStructure(prepKey: string): Promise<TeachingStructure | null> {
  return idbGet<TeachingStructure>(STORE_PREP_STRUCTURES, prepKey);
}

export async function putStructure(prepKey: string, structure: TeachingStructure): Promise<boolean> {
  return idbPut(STORE_PREP_STRUCTURES, { prepKey, value: structure });
}

// ── Boards API ───────────────────────────────────────────────────────────────

export function isValidBoardPerformance(perf: TeachingBoardPerformance | null | undefined): boolean {
  if (!perf) return false;
  if ((perf as any).isFallback === true) return false;
  const hasSpeech = Boolean(perf.speech && perf.speech.trim().length > 0);
  const hasContent = Boolean(perf.title || (Array.isArray(perf.board_actions) && perf.board_actions.length > 0));
  return hasSpeech && hasContent;
}

export async function getBoard(prepKey: string, boardIndex: number): Promise<PrepBoardRecord | null> {
  const record = await idbGet<PrepBoardRecord>(STORE_PREP_BOARDS, makeBoardKey(prepKey, boardIndex));
  if (!record) return null;
  if (!isValidBoardPerformance(record.performance)) return null;
  return record;
}

export async function putBoard(
  prepKey: string,
  boardIndex: number,
  performance: TeachingBoardPerformance
): Promise<boolean> {
  // CRITICAL: NEVER save fallback boards
  if (!isValidBoardPerformance(performance) || (performance as any).isFallback === true) {
    console.warn(`[LessonPrepCheckpointStore] Refusing to store invalid or fallback board performance for ${prepKey} board ${boardIndex}`);
    return false;
  }

  const record: PrepBoardRecord = {
    prepKey,
    boardIndex,
    performance,
    isFallback: false,
    savedAt: Date.now(),
  };

  return idbPut(STORE_PREP_BOARDS, { key: makeBoardKey(prepKey, boardIndex), value: record });
}

export async function hasValidBoard(prepKey: string, boardIndex: number): Promise<boolean> {
  const record = await getBoard(prepKey, boardIndex);
  return !!record && isValidBoardPerformance(record.performance);
}

// ── Audio API ────────────────────────────────────────────────────────────────

export function isValidAudioPayload(payload: any): boolean {
  if (!payload) return false;
  if (payload instanceof Blob) return payload.size > 0;
  if (payload instanceof ArrayBuffer) return payload.byteLength > 0;
  if (typeof payload === 'object') {
    if (payload.audio) return true;
    if (payload.payload?.audio) return true;
  }
  return false;
}

export async function getAudio(prepKeyOrCacheKey: string, boardIndex?: number): Promise<PrepAudioRecord | null> {
  const key = typeof boardIndex === 'number' ? makeBoardKey(prepKeyOrCacheKey, boardIndex) : prepKeyOrCacheKey;
  const record = await idbGet<PrepAudioRecord>(STORE_PREP_AUDIO, key);
  if (!record || !isValidAudioPayload(record.payload)) return null;
  return record;
}

export async function putAudio(
  prepKey: string,
  boardIndex: number,
  cacheKey: string,
  payload: any,
  mimeType?: string
): Promise<boolean> {
  if (!isValidAudioPayload(payload)) {
    console.warn(`[LessonPrepCheckpointStore] Refusing to store invalid audio payload for ${prepKey} board ${boardIndex}`);
    return false;
  }

  const record: PrepAudioRecord = {
    prepKey,
    boardIndex,
    cacheKey,
    payload,
    mimeType,
    savedAt: Date.now(),
  };

  // Put by board key AND cache key for dual lookup
  const boardKey = makeBoardKey(prepKey, boardIndex);
  const p1 = idbPut(STORE_PREP_AUDIO, { key: boardKey, value: record });
  const p2 = cacheKey !== boardKey ? idbPut(STORE_PREP_AUDIO, { key: cacheKey, value: record }) : Promise.resolve(true);
  const [r1, r2] = await Promise.all([p1, p2]);
  return r1 && r2;
}

export async function hasValidAudio(prepKey: string, boardIndex: number): Promise<boolean> {
  const record = await getAudio(prepKey, boardIndex);
  return !!record && isValidAudioPayload(record.payload);
}

// ── Completion Check ────────────────────────────────────────────────────────

export async function isBoardFullyComplete(prepKey: string, boardIndex: number): Promise<boolean> {
  const boardValid = await hasValidBoard(prepKey, boardIndex);
  if (!boardValid) return false;

  const boardRec = await getBoard(prepKey, boardIndex);
  const speechText = boardRec?.performance?.speech?.trim();

  // If the board has speech, audio is required. If speech is empty, board alone is sufficient.
  if (speechText) {
    const audioValid = await hasValidAudio(prepKey, boardIndex);
    if (!audioValid) return false;
  }

  return true;
}

// ── Cleanup API ──────────────────────────────────────────────────────────────

export async function clearPrep(prepKey: string, totalBoards?: number): Promise<void> {
  await idbDelete(STORE_PREP_META, prepKey);
  await idbDelete(STORE_PREP_STRUCTURES, prepKey);
  const maxBoards = totalBoards || 60;
  for (let i = 0; i < maxBoards; i++) {
    await idbDelete(STORE_PREP_BOARDS, makeBoardKey(prepKey, i));
    await idbDelete(STORE_PREP_AUDIO, makeBoardKey(prepKey, i));
  }
}
