/**
 * Lesson Package Store — IndexedDB device storage for fully-prepared lessons.
 *
 * Stores the complete lesson package for a prep key (`${userId}::${topicKey}::${durationMode}`):
 *  - avelut_lesson_structure — teaching structure JSON by prep key
 *  - avelut_lesson_boards    — board performance JSON by prep key + boardIndex
 *  - avelut_lesson_audio     — TTS audio payloads (base64 + timestamps) by TTS cache key
 *  - avelut_lesson_meta      — { state, progress, voice, boardCount, createdAt, readyAt }
 *
 * Design goals:
 *  - Survives reloads; far larger quota than localStorage (audio is big).
 *  - Ready = structure + ALL boards + ALL board audio exist on device.
 *  - LRU eviction by readyAt (max lessons / max age).
 *  - Graceful degradation: if IndexedDB is unavailable, every read returns null
 *    (callers fall back to the legacy localStorage/SQLite cache) and writes no-op.
 */

export const LESSON_DB_NAME = 'avelut_lessons';
const LESSON_DB_VERSION = 1;

export const STORE_STRUCTURE = 'avelut_lesson_structure';
export const STORE_BOARDS = 'avelut_lesson_boards';
export const STORE_AUDIO = 'avelut_lesson_audio';
export const STORE_META = 'avelut_lesson_meta';

export interface LessonPackageProgress {
  boardIndex: number;
  totalBoards: number;
}

export interface LessonPackageMeta {
  key: string;
  state: 'preparing' | 'ready' | 'failed';
  voice?: string;
  topic?: string;
  topicTitle?: string;
  courseName?: string;
  durationMode?: number;
  boardCount?: number;
  progress?: LessonPackageProgress;
  audioKeys?: string[];
  createdAt?: number;
  readyAt?: number;
  updatedAt?: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openLessonDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(LESSON_DB_NAME, LESSON_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_STRUCTURE)) {
        db.createObjectStore(STORE_STRUCTURE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_BOARDS)) {
        db.createObjectStore(STORE_BOARDS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
  // If it ever fails, reset so we don't cache a rejected promise forever.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function boardKey(packageKey: string, boardIndex: number): string {
  return `${packageKey}::board_${boardIndex}`;
}

async function idbGet<T = any>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openLessonDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => {
        const row = request.result;
        resolve(row ? ((row.value !== undefined ? row.value : row) as T) : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function idbPut(storeName: string, key: string, value: any): Promise<boolean> {
  try {
    const db = await openLessonDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB tx aborted'));
    });
    return true;
  } catch (e) {
    console.warn(`[LessonPackageStore] put failed (${storeName}/${key}):`, e);
    return false;
  }
}

async function idbDelete(storeName: string, key: string): Promise<void> {
  try {
    const db = await openLessonDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

// ── Structure ────────────────────────────────────────────────────────────────

export async function saveLessonStructure(packageKey: string, structure: unknown): Promise<void> {
  await idbPut(STORE_STRUCTURE, packageKey, structure);
}

export async function getLessonStructure<T = any>(packageKey: string): Promise<T | null> {
  return idbGet<T>(STORE_STRUCTURE, packageKey);
}

// ── Boards ───────────────────────────────────────────────────────────────────

export async function saveLessonBoard(packageKey: string, boardIndex: number, performance: unknown): Promise<void> {
  await idbPut(STORE_BOARDS, boardKey(packageKey, boardIndex), performance);
}

export async function getLessonBoard<T = any>(packageKey: string, boardIndex: number): Promise<T | null> {
  return idbGet<T>(STORE_BOARDS, boardKey(packageKey, boardIndex));
}

// ── Audio ────────────────────────────────────────────────────────────────────

export async function saveLessonAudio(ttsCacheKey: string, payload: unknown): Promise<void> {
  await idbPut(STORE_AUDIO, ttsCacheKey, payload);
}

export async function getLessonAudio<T = any>(ttsCacheKey: string): Promise<T | null> {
  return idbGet<T>(STORE_AUDIO, ttsCacheKey);
}

// ── Meta ─────────────────────────────────────────────────────────────────────

export async function saveLessonMeta(meta: LessonPackageMeta): Promise<void> {
  await idbPut(STORE_META, meta.key, { ...meta, updatedAt: Date.now() });
}

export async function getLessonMeta(packageKey: string): Promise<LessonPackageMeta | null> {
  return idbGet<LessonPackageMeta>(STORE_META, packageKey);
}

/**
 * Verifies the on-device package is complete: structure + every board + every
 * board's audio (for any of the candidate voices) are present in IndexedDB.
 */
export async function isLessonPackageComplete(
  packageKey: string,
  audioKeyForBoard: (boardNumber: number) => string[]
): Promise<boolean> {
  const meta = await getLessonMeta(packageKey);
  const total = meta?.boardCount || 0;
  if (total <= 0) return false;

  const structure = await getLessonStructure(packageKey);
  if (!structure) return false;

  for (let i = 0; i < total; i++) {
    const board = await getLessonBoard(packageKey, i);
    if (!board) return false;
  }

  for (let n = 1; n <= total; n++) {
    const candidates = audioKeyForBoard(n);
    let found = false;
    for (const audioKey of candidates) {
      if (await getLessonAudio(audioKey)) {
        found = true;
        break;
      }
    }
    if (!found) return false;
  }

  return true;
}

// ── Eviction (LRU by readyAt) ────────────────────────────────────────────────

export async function evictOldLessonPackages(
  options: { maxLessons?: number; maxAgeMs?: number } = {}
): Promise<void> {
  const maxLessons = options.maxLessons ?? 8;
  const maxAgeMs = options.maxAgeMs ?? 14 * 24 * 60 * 60 * 1000;
  try {
    const db = await openLessonDb();
    const metas = await new Promise<LessonPackageMeta[]>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const request = tx.objectStore(STORE_META).getAll();
      request.onsuccess = () => resolve((request.result || []) as LessonPackageMeta[]);
      request.onerror = () => reject(request.error);
    });

    const now = Date.now();
    const deletable = metas
      .filter((m) => {
        const ts = m.readyAt || m.updatedAt || m.createdAt || 0;
        return m.state === 'ready' ? now - ts > maxAgeMs : now - ts > maxAgeMs;
      })
      .map((m) => m.key);

    const readyMetas = metas
      .filter((m) => !deletable.includes(m.key))
      .sort((a, b) => (b.readyAt || 0) - (a.readyAt || 0));

    const toDelete = [...deletable, ...readyMetas.slice(maxLessons).map((m) => m.key)];

    for (const key of toDelete) {
      const meta = metas.find((m) => m.key === key);
      const audioKeys = meta?.audioKeys || [];
      await idbDelete(STORE_STRUCTURE, key);
      await idbDelete(STORE_META, key);
      if (meta?.boardCount) {
        for (let i = 0; i < meta.boardCount; i++) {
          await idbDelete(STORE_BOARDS, boardKey(key, i));
        }
      }
      for (const audioKey of audioKeys) {
        await idbDelete(STORE_AUDIO, audioKey);
      }
    }
  } catch {
    // Eviction is best-effort.
  }
}