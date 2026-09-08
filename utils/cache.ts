import { runQuery, runStatement } from '../lib/sqlite/sqliteService';

/**
 * In-memory fast layer to guarantee synchronous reads across the entire React application.
 */
const memoryCache = new Map<string, any>();
let isSqliteHydrated = false;

// Preload any available items into memoryCache on startup
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key) {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          try {
            memoryCache.set(key, JSON.parse(raw));
          } catch {
            memoryCache.set(key, raw);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Cache] Preload error from localStorage:', e);
  }
}

/**
 * Initialize and hydrate cache directly from SQLite app_state table.
 */
export async function initCacheFromSqlite(): Promise<void> {
  try {
    const rows = await runQuery<{ key: string; payload_json: string }>(
      `SELECT key, payload_json FROM app_state`
    );
    for (const row of rows) {
      if (row.key && row.payload_json) {
        try {
          memoryCache.set(row.key, JSON.parse(row.payload_json));
        } catch {
          memoryCache.set(row.key, row.payload_json);
        }
      }
    }
    isSqliteHydrated = true;
    console.log(`[Cache] Hydrated ${rows.length} entries from SQLite app_state.`);
    
    // Automatically migrate any unmigrated localStorage entries into SQLite
    await migrateLocalStorageToSqlite();
  } catch (error) {
    console.warn('[Cache] Error hydrating cache from SQLite:', error);
  }
}

/**
 * Migrates existing data from localStorage into SQLite app_state.
 */
export async function migrateLocalStorageToSqlite(): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keys = Object.keys(window.localStorage);
    let migratedCount = 0;
    const now = Date.now();

    for (const key of keys) {
      // Avoid circular migration marker
      if (key === 'avelut_migrated_to_sqlite') continue;

      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      // Extract user_id if key contains uid pattern, otherwise 'global'
      let userId = 'global';
      const uidMatch = key.match(/([a-zA-Z0-9_-]{20,})/);
      if (uidMatch) {
        userId = uidMatch[1];
      }

      await runStatement(
        `INSERT OR REPLACE INTO app_state (key, user_id, category, payload_json, updated_at, sync_status)
         VALUES (?, ?, 'cache', ?, ?, 'synced')`,
        [key, userId, raw, now]
      );
      migratedCount++;
    }

    if (migratedCount > 0) {
      console.log(`[Cache] Migrated ${migratedCount} items from localStorage to SQLite.`);
    }
  } catch (err) {
    console.warn('[Cache] Migration from localStorage to SQLite notice:', err);
  }
}

/**
 * Sanitize cached value against expected fallback type to prevent type mismatches
 * (e.g. object maps or primitives returned when an array is expected).
 */
function sanitizeCachedValue<T>(val: any, fallback: T): T {
  if (val === undefined || val === null) {
    return fallback;
  }
  if (Array.isArray(fallback)) {
    if (Array.isArray(val)) {
      return val as unknown as T;
    }
    if (val && typeof val === 'object') {
      return Object.values(val) as unknown as T;
    }
    return fallback;
  }
  if (typeof fallback === 'object' && fallback !== null) {
    if (typeof val === 'object' && !Array.isArray(val)) {
      return val as T;
    }
    return fallback;
  }
  return val as T;
}

/**
 * Synchronous JSON read helper from in-memory cache backed by SQLite.
 */
export function readCachedJson<T = any>(key: string, fallback: T = null as unknown as T): T {
  if (memoryCache.has(key)) {
    const rawVal = memoryCache.get(key);
    const sanitized = sanitizeCachedValue(rawVal, fallback);
    if (sanitized !== rawVal) {
      memoryCache.set(key, sanitized);
    }
    return sanitized;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        const sanitized = sanitizeCachedValue(parsed, fallback);
        memoryCache.set(key, sanitized);
        return sanitized;
      }
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Automatically prunes heavy cached audio and board items when localStorage quota is exceeded.
 */
export function pruneLocalStorageQuota(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (
        k &&
        (k.startsWith('avelut_grok_tts_') ||
          k.startsWith('avelut_board_cache_') ||
          k === 'avelut_sqlite_memory_fallback')
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => {
      try {
        window.localStorage.removeItem(k);
      } catch {}
    });
  } catch {}
}

/**
 * Write cached value into in-memory cache and persist to SQLite asynchronously.
 */
export function writeCachedJson(key: string, value: unknown, userId: string = 'global'): void {
  memoryCache.set(key, value);

  // Asynchronously persist to SQLite
  const now = Date.now();
  const payloadJson = JSON.stringify(value);
  void runStatement(
    `INSERT OR REPLACE INTO app_state (key, user_id, category, payload_json, updated_at, sync_status)
     VALUES (?, ?, 'cache', ?, ?, 'synced')`,
    [key, userId, payloadJson, now]
  ).catch(err => {
    console.warn(`[Cache] SQLite persist failed for key ${key}:`, err);
  });

  // Mirror to localStorage for instant web fallback
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(key, payloadJson);
    } catch {
      pruneLocalStorageQuota();
      try {
        window.localStorage.setItem(key, payloadJson);
      } catch {}
    }
  }
}

/**
 * Remove cached key from memory cache and SQLite.
 */
export function clearCachedKey(key: string): void {
  memoryCache.delete(key);

  void runStatement(`DELETE FROM app_state WHERE key = ?`, [key]).catch(err => {
    console.warn(`[Cache] SQLite delete failed for key ${key}:`, err);
  });

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore errors
    }
  }
}

// Global exposure to prevent TDZ bundling anomalies
if (typeof window !== 'undefined') {
  (window as any).readCachedJson = readCachedJson;
  (window as any).writeCachedJson = writeCachedJson;
  (window as any).clearCachedKey = clearCachedKey;
}

/**
 * Async read from SQLite directly.
 */
export async function readCachedJsonAsync<T>(key: string, fallback: T): Promise<T> {
  if (memoryCache.has(key)) {
    const rawVal = memoryCache.get(key);
    const sanitized = sanitizeCachedValue(rawVal, fallback);
    if (sanitized !== rawVal) {
      memoryCache.set(key, sanitized);
    }
    return sanitized;
  }
  try {
    const rows = await runQuery<{ payload_json: string }>(
      `SELECT payload_json FROM app_state WHERE key = ? LIMIT 1`,
      [key]
    );
    if (rows.length > 0 && rows[0].payload_json) {
      const parsed = JSON.parse(rows[0].payload_json);
      const sanitized = sanitizeCachedValue(parsed, fallback);
      memoryCache.set(key, sanitized);
      return sanitized;
    }
  } catch (err) {
    console.warn(`[Cache] Async read error for key ${key}:`, err);
  }
  return fallback;
}

/**
 * Async write directly with await.
 */
export async function writeCachedJsonAsync(key: string, value: unknown, userId: string = 'global'): Promise<void> {
  memoryCache.set(key, value);
  const now = Date.now();
  const payloadJson = JSON.stringify(value);
  await runStatement(
    `INSERT OR REPLACE INTO app_state (key, user_id, category, payload_json, updated_at, sync_status)
     VALUES (?, ?, 'cache', ?, ?, 'synced')`,
    [key, userId, payloadJson, now]
  );
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(key, payloadJson);
    } catch {
      // Ignore
    }
  }
}
