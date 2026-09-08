import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

const DB_NAME = 'avelut_local';
const DB_VERSION = 1;

let sqliteConnection: SQLiteConnection | null = null;
let dbConnection: SQLiteDBConnection | null = null;
let isInitializing = false;
let initPromise: Promise<SQLiteDBConnection | null> | null = null;

/**
 * Initialize jeep-sqlite web component for web / dev preview environments.
 */
async function setupWebJeepSqlite(): Promise<void> {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return;

  try {
    const { defineCustomElements } = await import('jeep-sqlite/loader');
    await defineCustomElements(window);

    // Wait until jeep-sqlite custom element is present in DOM
    let jeepSqliteEl = document.querySelector('jeep-sqlite');
    if (!jeepSqliteEl) {
      jeepSqliteEl = document.createElement('jeep-sqlite');
      jeepSqliteEl.setAttribute('wasmPath', '/assets');
      document.body.appendChild(jeepSqliteEl);
      await customElements.whenDefined('jeep-sqlite');
    }
  } catch (err) {
    console.warn('[SQLite] jeep-sqlite initialization warning (may be running in test or web fallback):', err);
  }
}

/**
 * Database schema initialization scripts.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_updated_at INTEGER NOT NULL,
  sync_status TEXT DEFAULT 'pending',
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, last_updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  attachments_json TEXT,
  image_url TEXT,
  timestamp INTEGER NOT NULL,
  sync_status TEXT DEFAULT 'pending',
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, timestamp ASC);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_status TEXT DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_app_state_user ON app_state(user_id);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  department_id TEXT,
  exam_type TEXT,
  score INTEGER,
  total_questions INTEGER,
  questions_json TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  sync_status TEXT DEFAULT 'pending',
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_exams_user ON exams(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  course_id TEXT,
  department_id TEXT,
  level TEXT,
  cards_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sync_status TEXT DEFAULT 'pending',
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_flashcards_user ON flashcards(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS past_questions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  department_id TEXT NOT NULL,
  level TEXT NOT NULL,
  course_id TEXT NOT NULL,
  year TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pq_dept_level ON past_questions(department_id, level, course_id, year);

CREATE TABLE IF NOT EXISTS user_materials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sync_status TEXT DEFAULT 'pending',
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_materials_user ON user_materials(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS voice_tutorials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  concept_idx INTEGER NOT NULL,
  sub_step TEXT NOT NULL,
  is_completed INTEGER DEFAULT 0,
  blueprint_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  sync_status TEXT DEFAULT 'synced'
);

CREATE INDEX IF NOT EXISTS idx_vt_user_topic ON voice_tutorials(user_id, course_id, topic_id);

CREATE TABLE IF NOT EXISTS ai_semantic_cache (
  query_hash TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  course_key TEXT,
  context_type TEXT NOT NULL,
  result_json TEXT NOT NULL,
  hit_count INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_semantic_cache(expires_at);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at ASC);

CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  total_pages INTEGER NOT NULL,
  chapter_count INTEGER NOT NULL,
  chapters_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notebook_chunks (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  chapter_title TEXT NOT NULL,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notebook_chunks_nb ON notebook_chunks(notebook_id, page_number ASC);

CREATE TABLE IF NOT EXISTS notebook_generations (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nb_gen ON notebook_generations(notebook_id, chapter_id, type);
CREATE INDEX IF NOT EXISTS idx_nb_gen_user ON notebook_generations(user_id, updated_at DESC);
`;

/**
 * Initialize SQLite database connection and run schema creation.
 */
export async function getDatabaseConnection(): Promise<SQLiteDBConnection | null> {
  if (dbConnection) {
    return dbConnection;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      isInitializing = true;
      const isNative = Capacitor.isNativePlatform();

      if (!isNative) {
        // In web browser environments, use the built-in fast fallback storage layer to prevent WebAssembly LinkErrors
        return null;
      }

      sqliteConnection = new SQLiteConnection(CapacitorSQLite);

      if (!isNative) {
        await sqliteConnection.initWebStore();
      }

      const retCC = (await sqliteConnection.checkConnectionsConsistency()).result;
      const isConn = (await sqliteConnection.isConnection(DB_NAME, false)).result;

      if (retCC && isConn) {
        dbConnection = await sqliteConnection.retrieveConnection(DB_NAME, false);
      } else {
        dbConnection = await sqliteConnection.createConnection(
          DB_NAME,
          false,
          'no-encryption',
          DB_VERSION,
          false
        );
      }

      await dbConnection.open();

      // Execute schema creation
      await dbConnection.execute(SCHEMA_SQL);

      if (!isNative) {
        await sqliteConnection.saveToStore(DB_NAME);
      }

      console.log('[SQLite] Local database initialized successfully.');
      return dbConnection;
    } catch (error) {
      console.warn('[SQLite] SQLite unavailable or failed on web, activating fallback storage:', error);
      dbConnection = null;
      sqliteConnection = null;
      return null;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

/**
 * Save store on Web (IndexedDB backing) after write operations.
 */
export async function persistWebStore(): Promise<void> {
  if (!Capacitor.isNativePlatform() && sqliteConnection) {
    try {
      await sqliteConnection.saveToStore(DB_NAME);
    } catch (e) {
      // Non-critical, ignore silent save errors
    }
  }
}

/**
 * Safe query execution helper that returns rows as an array of objects.
 */
export async function runQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  try {
    const db = await getDatabaseConnection();
    if (!db) {
      return runFallbackQuery<T>(sql, params);
    }
    const isConn = (await db.isDBOpen())?.result;
    if (!isConn) {
      return runFallbackQuery<T>(sql, params);
    }
    const res = await db.query(sql, params);
    return (res.values as T[]) || [];
  } catch (error) {
    return runFallbackQuery<T>(sql, params);
  }
}

/**
 * Safe run statement helper for INSERT, UPDATE, DELETE.
 */
export async function runStatement(sql: string, params: any[] = []): Promise<{ changes?: number; lastId?: number }> {
  try {
    const db = await getDatabaseConnection();
    if (!db) {
      return runFallbackStatement(sql, params);
    }
    const isConn = (await db.isDBOpen())?.result;
    if (!isConn) {
      return runFallbackStatement(sql, params);
    }
    const res = await db.run(sql, params);
    await persistWebStore();
    return {
      changes: res.changes?.changes || 0,
      lastId: res.changes?.lastId || 0,
    };
  } catch (error) {
    return runFallbackStatement(sql, params);
  }
}


/**
 * Execute batch statements in transaction.
 */
export async function runBatch(statements: string): Promise<void> {
  try {
    const db = await getDatabaseConnection();
    if (!db) return;
    await db.execute(statements);
    await persistWebStore();
  } catch (error) {
    console.error('[SQLite] Batch execution error:', error);
  }
}

// =========================================================================
// IN-MEMORY / LOCAL STORAGE HYBRID FALLBACK FOR ZERO-CRASH TOLERANCE
// =========================================================================
function getSavedFallbackStore(): Record<string, any[]> {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem('avelut_sqlite_memory_fallback');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
          messages: Array.isArray(parsed.messages) ? parsed.messages : [],
          app_state: Array.isArray(parsed.app_state) ? parsed.app_state : [],
          exams: Array.isArray(parsed.exams) ? parsed.exams : [],
          flashcards: Array.isArray(parsed.flashcards) ? parsed.flashcards : [],
          past_questions: Array.isArray(parsed.past_questions) ? parsed.past_questions : [],
          user_materials: Array.isArray(parsed.user_materials) ? parsed.user_materials : [],
          voice_tutorials: Array.isArray(parsed.voice_tutorials) ? parsed.voice_tutorials : [],
          ai_semantic_cache: Array.isArray(parsed.ai_semantic_cache) ? parsed.ai_semantic_cache : [],
          sync_queue: Array.isArray(parsed.sync_queue) ? parsed.sync_queue : [],
        };
      }
    } catch {}
  }
  return {
    conversations: [],
    messages: [],
    app_state: [],
    exams: [],
    flashcards: [],
    past_questions: [],
    user_materials: [],
    voice_tutorials: [],
    ai_semantic_cache: [],
    sync_queue: []
  };
}

const memoryFallbackStore: Record<string, any[]> = getSavedFallbackStore();

function persistFallbackStore() {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (memoryFallbackStore.app_state.length > 80) {
        memoryFallbackStore.app_state = memoryFallbackStore.app_state.slice(-40);
      }
      if (memoryFallbackStore.ai_semantic_cache.length > 15) {
        memoryFallbackStore.ai_semantic_cache = memoryFallbackStore.ai_semantic_cache.slice(-10);
      }
      window.localStorage.setItem('avelut_sqlite_memory_fallback', JSON.stringify(memoryFallbackStore));
    } catch (e) {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && (k.startsWith('avelut_grok_tts_') || k.startsWith('avelut_board_cache_'))) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => window.localStorage.removeItem(k));
        window.localStorage.setItem('avelut_sqlite_memory_fallback', JSON.stringify(memoryFallbackStore));
      } catch (_) {}
    }
  }
}

function runFallbackQuery<T>(sql: string, params: any[]): T[] {
  const lower = sql.toLowerCase();
  if (lower.includes('from conversations')) {
    const userId = params[0];
    let items = (memoryFallbackStore.conversations || []).filter(c => !c.is_deleted);
    if (userId) items = items.filter(c => c.user_id === userId);
    return items.sort((a, b) => (b.last_updated_at || 0) - (a.last_updated_at || 0)) as unknown as T[];
  }
  if (lower.includes('from messages')) {
    const convoId = params[0];
    let items = (memoryFallbackStore.messages || []).filter(m => !m.is_deleted);
    if (convoId) items = items.filter(m => m.conversation_id === convoId);
    return items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)) as unknown as T[];
  }
  if (lower.includes('from exams')) {
    const userId = params[0];
    let items = (memoryFallbackStore.exams || []).filter(e => !e.is_deleted);
    if (userId) items = items.filter(e => e.user_id === userId);
    return items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)) as unknown as T[];
  }
  if (lower.includes('from flashcards')) {
    const userId = params[0];
    let items = (memoryFallbackStore.flashcards || []).filter(f => !f.is_deleted);
    if (userId) items = items.filter(f => f.user_id === userId);
    return items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)) as unknown as T[];
  }
  if (lower.includes('from past_questions')) {
    let items = memoryFallbackStore.past_questions || [];
    if (params.length >= 4) {
      const [dept, lvl, course, yr] = params;
      items = items.filter(pq => pq.department_id === dept && pq.level === lvl && pq.course_id === course && pq.year === yr);
    } else if (params.length >= 2) {
      const [dept, lvl] = params;
      items = items.filter(pq => pq.department_id === dept && pq.level === lvl);
    }
    return items as unknown as T[];
  }
  if (lower.includes('from user_materials')) {
    const userId = params[0];
    let items = (memoryFallbackStore.user_materials || []).filter(m => !m.is_deleted);
    if (userId) items = items.filter(m => m.user_id === userId);
    return items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)) as unknown as T[];
  }
  if (lower.includes('from voice_tutorials')) {
    if (lower.includes('where user_id = ? and course_id = ? and topic_id = ?')) {
      const [userId, courseId, topicId] = params;
      const hit = (memoryFallbackStore.voice_tutorials || []).find(
        v => v.user_id === userId && v.course_id === courseId && v.topic_id === topicId
      );
      return (hit ? [hit] : []) as unknown as T[];
    }
    if (lower.includes('where user_id = ?')) {
      const userId = params[0];
      const hits = (memoryFallbackStore.voice_tutorials || []).filter(v => v.user_id === userId);
      return hits as unknown as T[];
    }
    return (memoryFallbackStore.voice_tutorials || []) as unknown as T[];
  }
  if (lower.includes('from app_state')) {
    if (lower.includes('where key = ?')) {
      const key = params[0];
      const hit = (memoryFallbackStore.app_state || []).find(s => s.key === key);
      return (hit ? [hit] : []) as unknown as T[];
    }
    if (lower.includes('where user_id = ?')) {
      const userId = params[0];
      const hits = (memoryFallbackStore.app_state || []).filter(s => s.user_id === userId);
      return hits as unknown as T[];
    }
    return (memoryFallbackStore.app_state || []) as unknown as T[];
  }
  if (lower.includes('from ai_semantic_cache')) {
    const hash = params[0];
    const now = Date.now();
    const hit = (memoryFallbackStore.ai_semantic_cache || []).find(
      c => c.query_hash === hash && c.expires_at > now
    );
    return (hit ? [hit] : []) as unknown as T[];
  }
  if (lower.includes('from sync_queue')) {
    return (memoryFallbackStore.sync_queue || []) as unknown as T[];
  }
  return [];
}

function runFallbackStatement(sql: string, params: any[]): { changes: number } {
  const lower = sql.toLowerCase();
  if (lower.includes('update conversations set last_updated_at = ? where id = ?')) {
    const [timestamp, id] = params;
    const convo = memoryFallbackStore.conversations.find(c => c.id === id);
    if (convo) {
      convo.last_updated_at = timestamp;
      persistFallbackStore();
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  if (lower.includes('update conversations set title = ?')) {
    const [newTitle, now, id] = params;
    const convo = memoryFallbackStore.conversations.find(c => c.id === id);
    if (convo) {
      convo.title = newTitle;
      convo.last_updated_at = now;
      persistFallbackStore();
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  if (lower.includes('update conversations set is_deleted = 1')) {
    const id = params[0];
    const convo = memoryFallbackStore.conversations.find(c => c.id === id);
    if (convo) {
      convo.is_deleted = 1;
      persistFallbackStore();
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  if (lower.includes('update messages set is_deleted = 1')) {
    const convoId = params[0];
    let changes = 0;
    for (const msg of memoryFallbackStore.messages) {
      if (msg.conversation_id === convoId) {
        msg.is_deleted = 1;
        changes++;
      }
    }
    persistFallbackStore();
    return { changes };
  }
  if (lower.includes('insert or replace into conversations') || lower.includes('insert into conversations')) {
    const [id, user_id, title, created_at, last_updated_at, sync_status, is_deleted] = params;
    const existingIdx = memoryFallbackStore.conversations.findIndex(c => c.id === id);
    const item = { id, user_id, title, created_at, last_updated_at, sync_status, is_deleted: is_deleted || 0 };
    if (existingIdx >= 0) memoryFallbackStore.conversations[existingIdx] = item;
    else memoryFallbackStore.conversations.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into messages') || lower.includes('insert into messages')) {
    const [id, conversation_id, user_id, sender, text, attachments_json, image_url, timestamp, sync_status, is_deleted] = params;
    const existingIdx = memoryFallbackStore.messages.findIndex(m => m.id === id);
    const item = { id, conversation_id, user_id, sender, text, attachments_json, image_url, timestamp, sync_status, is_deleted: is_deleted || 0 };
    if (existingIdx >= 0) memoryFallbackStore.messages[existingIdx] = item;
    else memoryFallbackStore.messages.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into exams') || lower.includes('insert into exams')) {
    const [id, user_id, department_id, exam_type, score, total_questions, questions_json, timestamp, sync_status, is_deleted] = params;
    const existingIdx = memoryFallbackStore.exams.findIndex(e => e.id === id);
    const item = { id, user_id, department_id, exam_type, score, total_questions, questions_json, timestamp, sync_status, is_deleted: is_deleted || 0 };
    if (existingIdx >= 0) memoryFallbackStore.exams[existingIdx] = item;
    else memoryFallbackStore.exams.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into flashcards') || lower.includes('insert into flashcards')) {
    const [id, user_id, title, course_id, department_id, level, cards_json, created_at, sync_status, is_deleted] = params;
    const existingIdx = memoryFallbackStore.flashcards.findIndex(f => f.id === id);
    const item = { id, user_id, title, course_id, department_id, level, cards_json, created_at, sync_status, is_deleted: is_deleted || 0 };
    if (existingIdx >= 0) memoryFallbackStore.flashcards[existingIdx] = item;
    else memoryFallbackStore.flashcards.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into past_questions') || lower.includes('insert into past_questions')) {
    const [id, user_id, department_id, level, course_id, year, questions_json, updated_at] = params;
    const existingIdx = memoryFallbackStore.past_questions.findIndex(pq => pq.id === id);
    const item = { id, user_id, department_id, level, course_id, year, questions_json, updated_at };
    if (existingIdx >= 0) memoryFallbackStore.past_questions[existingIdx] = item;
    else memoryFallbackStore.past_questions.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into user_materials') || lower.includes('insert into user_materials')) {
    const [id, user_id, type, title, data_json, created_at, sync_status, is_deleted] = params;
    const existingIdx = memoryFallbackStore.user_materials.findIndex(m => m.id === id);
    const item = { id, user_id, type, title, data_json, created_at, sync_status, is_deleted: is_deleted || 0 };
    if (existingIdx >= 0) memoryFallbackStore.user_materials[existingIdx] = item;
    else memoryFallbackStore.user_materials.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into voice_tutorials') || lower.includes('insert into voice_tutorials')) {
    const [id, user_id, course_id, topic_id, concept_idx, sub_step, is_completed, blueprint_json, updated_at, sync_status] = params;
    const existingIdx = memoryFallbackStore.voice_tutorials.findIndex(v => v.id === id);
    const item = { id, user_id, course_id, topic_id, concept_idx, sub_step, is_completed: is_completed || 0, blueprint_json, updated_at, sync_status: sync_status || 'synced' };
    if (existingIdx >= 0) memoryFallbackStore.voice_tutorials[existingIdx] = item;
    else memoryFallbackStore.voice_tutorials.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into app_state') || lower.includes('insert into app_state')) {
    const [key, user_id, category, payload_json, updated_at, sync_status] = params;
    const existingIdx = memoryFallbackStore.app_state.findIndex(s => s.key === key);
    const item = { key, user_id, category, payload_json, updated_at, sync_status };
    if (existingIdx >= 0) memoryFallbackStore.app_state[existingIdx] = item;
    else memoryFallbackStore.app_state.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into ai_semantic_cache')) {
    const [query_hash, query_text, course_key, context_type, result_json, hit_count, created_at, expires_at] = params;
    const idx = memoryFallbackStore.ai_semantic_cache.findIndex(c => c.query_hash === query_hash);
    const item = { query_hash, query_text, course_key, context_type, result_json, hit_count, created_at, expires_at };
    if (idx >= 0) memoryFallbackStore.ai_semantic_cache[idx] = item;
    else memoryFallbackStore.ai_semantic_cache.push(item);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('insert or replace into sync_queue') || lower.includes('insert into sync_queue')) {
    const [id, entity_type, entity_id, action, payload_json, retry_count, created_at, last_error] = params;
    memoryFallbackStore.sync_queue.push({ id, entity_type, entity_id, action, payload_json, retry_count, created_at, last_error });
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('delete from sync_queue')) {
    const id = params[0];
    memoryFallbackStore.sync_queue = memoryFallbackStore.sync_queue.filter(q => q.id !== id);
    persistFallbackStore();
    return { changes: 1 };
  }
  if (lower.includes('delete from app_state')) {
    const key = params[0];
    memoryFallbackStore.app_state = memoryFallbackStore.app_state.filter(s => s.key !== key);
    persistFallbackStore();
    return { changes: 1 };
  }
  return { changes: 0 };
}
